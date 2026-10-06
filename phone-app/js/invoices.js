// ============================================================================
// دورة حياة الفاتورة على الهاتف + المزامنة. المنطق الحاكم (القاعدتان 18 و19):
//
//   draft ──إنهاء──▶ ready ──إرسال──▶ uncertain ──ردّ الكمبيوتر──▶ pending ──اعتماد──▶ confirmed
//     ▲                │                  │                         │  └──رفض──▶ rejected
//     └─── تعديل ──────┘                  └─ "unknown" عند الكمبيوتر ─▶ ready (لم تصله فعلاً)
//
//  • "الإرسال ≠ النقل بأمان": بعد الإرسال تبقى الفاتورة على الهاتف ولا تُحذف تلقائياً.
//    وحدها حالة confirmed (حفظ فعلي في قاعدة الكمبيوتر الرئيسية) تعني أنها منقولة بأمان.
//  • قبل أول محاولة إرسال تُثبَّت الحالة uncertain على الهاتف (قبل أي شبكة) — فإن انقطع
//    الاتصال بعد وصول الطلب للكمبيوتر وقبل وصول الردّ لا نعتبرها "غير مُرسلة" خطأً.
//  • بعد أي محاولة إرسال لا يُسمح بتعديل الفاتورة (المحتوى ثابت)؛ المعرّف uid يمنع التكرار
//    عند إعادة الإرسال.
//  • كل فاتورة مستقلة: فشل/رفض واحدة لا يمسّ البقية، ولا يُحذف شيء تلقائياً أبداً.
// ============================================================================

import { computeLine, invoiceTotal, round2, todayLocal } from "./calc.js";
import { validateCatalog } from "./api.js";

export const S = Object.freeze({
  DRAFT: "draft",
  READY: "ready",
  UNCERTAIN: "uncertain",
  PENDING: "pending",
  CONFIRMED: "confirmed",
  REJECTED: "rejected",
});
const ALL_STATES = new Set(Object.values(S));
const TERMINAL = new Set([S.CONFIRMED, S.REJECTED]);

export class AppError extends Error {
  constructor(message, code = "") {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export function uuidv4(c = globalThis.crypto) {
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const isUuid = (s) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);

export const canEdit = (inv) => (inv.state === S.DRAFT || inv.state === S.READY) && !(inv.sendAttempts > 0);
/** حذف عادي مسموح؛ غيره يحتاج تأكيداً قوياً لأن الكمبيوتر قد يكون الوحيد الذي يملك نسخة. */
export const isSafeToDelete = (inv) => canEdit(inv) || inv.state === S.CONFIRMED || inv.state === S.REJECTED;

/** الشكل الذي يُرسَل للكمبيوتر — بلا أسماء/أوزان صناديق (تُؤخذ من بياناته الحالية). */
export function toWire(inv) {
  return {
    uid: inv.uid,
    createdAt: inv.createdAt,
    invoiceDate: inv.invoiceDate,
    merchantId: inv.merchantId,
    merchantNameHint: inv.merchantName || undefined,
    lines: inv.lines.map((l) => ({
      lid: l.lid,
      productName: l.productName,
      scaleWeight: l.scaleWeight,
      price: l.price,
      boxes: l.boxes.map((b) => ({ boxId: b.boxId, boxCount: b.boxCount })),
      phoneNetWeight: l.netWeight,
      phoneSubtotal: l.subtotal,
    })),
    phoneTotal: inv.total,
  };
}

function applyReceipt(inv, r, iso) {
  if (TERMINAL.has(inv.state)) return inv; // القرار النهائي لا يُنقض
  switch (r.status) {
    case "pending":
      return { ...inv, state: S.PENDING, sentAt: inv.sentAt || iso, lastCheckedAt: iso, note: null, lastError: null };
    case "confirmed":
      return { ...inv, state: S.CONFIRMED, finalNumber: r.finalNumber || null, confirmedAt: iso, lastCheckedAt: iso, note: null, lastError: null };
    case "rejected":
      return { ...inv, state: S.REJECTED, rejectReason: r.reason || null, rejectedAt: iso, lastCheckedAt: iso, note: null };
    case "invalid":
      return { ...inv, state: S.REJECTED, rejectReason: r.message || "رفض الكمبيوتر بيانات الفاتورة", invalidAtServer: true, rejectedAt: iso };
    case "error":
      // الكمبيوتر أعلن صراحةً أنه لم يحفظها → تعود جاهزة للإرسال.
      return { ...inv, state: S.READY, lastError: r.message || "تعذّر حفظ الفاتورة على الكمبيوتر", lastCheckedAt: iso };
    case "unknown":
      if (inv.state === S.UNCERTAIN || inv.state === S.PENDING) {
        return { ...inv, state: S.READY, note: "الكمبيوتر لا يملك هذه الفاتورة — ستُرسَل من جديد", lastCheckedAt: iso };
      }
      return inv;
    default:
      return inv;
  }
}

export function createService({ db, api, now = () => new Date(), uuid = uuidv4 }) {
  const iso = () => now().toISOString();
  let settings = {};
  let catalog = null;
  let ui = {};
  const invoices = new Map();
  const listeners = new Set();
  let syncBusy = false;

  const emit = () => listeners.forEach((l) => { try { l(); } catch { /* مشترك معطوب لا يوقف البقية */ } });

  async function save(inv) {
    await db.putInvoice(inv);
    invoices.set(inv.uid, inv);
  }

  function need(uid) {
    const inv = invoices.get(uid);
    if (!inv) throw new AppError("الفاتورة غير موجودة", "not_found");
    return inv;
  }

  const svc = {
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },

    async init() {
      settings = (await db.kvGet("settings")) || {};
      catalog = (await db.kvGet("catalog")) || null;
      ui = (await db.kvGet("ui")) || {};
      invoices.clear();
      for (const inv of await db.allInvoices()) {
        // طلب أُرسل ثم أُغلق التطبيق قبل الردّ: لا نعرف مصيره → غير مؤكَّدة (تُراجَع عند المزامنة).
        invoices.set(inv.uid, inv);
      }
      emit();
    },

    getSettings: () => settings,
    async saveSettings(patch) {
      settings = { ...settings, ...patch };
      await db.kvSet("settings", settings);
      emit();
    },
    getCatalog: () => catalog,

    list() {
      return [...invoices.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    },
    get: (uid) => invoices.get(uid) || null,
    counts() {
      const c = { draft: 0, ready: 0, uncertain: 0, pending: 0, confirmed: 0, rejected: 0 };
      for (const i of invoices.values()) c[i.state] = (c[i.state] || 0) + 1;
      return c;
    },
    productNames() {
      const seen = new Map();
      for (const i of invoices.values()) for (const l of i.lines) seen.set(l.productName, (seen.get(l.productName) || 0) + 1);
      return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 200);
    },

    // ───────── حقول السطر قيد الإدخال (تُحفظ كي لا تضيع عند إغلاق المتصفح) ─────────
    getEntry: () => ui.entry || null,
    async setEntry(entry) {
      ui = { ...ui, entry: entry || null };
      await db.kvSet("ui", ui);
    },

    // ───────── المسودة الحالية ─────────
    currentDraft() {
      const inv = ui.currentUid ? invoices.get(ui.currentUid) : null;
      return inv && inv.state === S.DRAFT ? inv : null;
    },
    async setCurrent(uid) {
      ui = { ...ui, currentUid: uid || null };
      await db.kvSet("ui", ui);
      emit();
    },
    async startDraft(merchantId) {
      const m = catalog && catalog.merchants.find((x) => x.id === merchantId);
      if (!m) throw new AppError("التاجر غير موجود في بيانات الهاتف — حدّث البيانات من الكمبيوتر", "no_merchant");
      const t = iso();
      const inv = {
        uid: uuid(), createdAt: t, updatedAt: t, invoiceDate: todayLocal(now()),
        merchantId: m.id, merchantName: m.name, lines: [], total: 0, state: S.DRAFT, sendAttempts: 0,
      };
      await save(inv);
      await svc.setCurrent(inv.uid);
      return inv;
    },
    async changeMerchant(uid, merchantId) {
      const inv = need(uid);
      if (!canEdit(inv)) throw new AppError("لا يمكن تعديل هذه الفاتورة", "locked");
      const m = catalog && catalog.merchants.find((x) => x.id === merchantId);
      if (!m) throw new AppError("التاجر غير موجود في بيانات الهاتف", "no_merchant");
      await save({ ...inv, merchantId: m.id, merchantName: m.name, updatedAt: iso() });
      emit();
    },

    /** line = { productName, scaleWeight, price, boxes:[{boxId, boxCount}] } */
    async addLine(uid, line) {
      const inv = need(uid);
      if (!canEdit(inv)) throw new AppError("لا يمكن تعديل هذه الفاتورة", "locked");
      const productName = String(line.productName ?? "").trim();
      if (!productName) throw new AppError("اكتب اسم المنتج", "product");
      if (productName.length > 200) throw new AppError("اسم المنتج طويل جداً", "product");
      const scaleWeight = round2(Number(line.scaleWeight));
      if (!Number.isFinite(scaleWeight) || scaleWeight <= 0) throw new AppError("أدخل وزن الميزان", "weight");
      if (scaleWeight > 10_000_000) throw new AppError("وزن الميزان كبير جداً", "weight");
      const price = Number(line.price);
      if (!Number.isInteger(price) || price < 0 || price > 999_999_999) throw new AppError("أدخل السعر (دينار صحيح)", "price");

      const boxes = [];
      const seen = new Set();
      for (const b of line.boxes || []) {
        if (!b || !(b.boxCount > 0)) continue;
        if (!Number.isInteger(b.boxCount) || b.boxCount > 100000) throw new AppError("عدد الصناديق غير صالح", "boxes");
        if (seen.has(b.boxId)) throw new AppError("صندوق مكرر في السطر", "boxes");
        seen.add(b.boxId);
        const cb = catalog && catalog.boxes.find((x) => x.id === b.boxId);
        if (!cb) throw new AppError("صندوق غير موجود في بيانات الهاتف — حدّث البيانات", "boxes");
        boxes.push({ boxId: cb.id, boxCount: b.boxCount, name: cb.name, weight: cb.weight });
      }
      const calc = computeLine({ scaleWeight, price, boxes });
      if (calc.exceeds) throw new AppError("وزن الصناديق أكبر من وزن الميزان", "exceeds");

      const l = { lid: uuid(), productName, scaleWeight, price, boxes, netWeight: calc.netWeight, subtotal: calc.subtotal };
      const lines = [...inv.lines, l];
      await save({
        ...inv,
        lines,
        total: invoiceTotal(lines),
        invoiceDate: inv.lines.length === 0 ? todayLocal(now()) : inv.invoiceDate,
        updatedAt: iso(),
      });
      emit();
      return l;
    },
    async removeLine(uid, lid) {
      const inv = need(uid);
      if (!canEdit(inv)) throw new AppError("لا يمكن تعديل هذه الفاتورة", "locked");
      const lines = inv.lines.filter((l) => l.lid !== lid);
      await save({ ...inv, lines, total: invoiceTotal(lines), updatedAt: iso() });
      emit();
    },
    async finish(uid) {
      const inv = need(uid);
      if (inv.state !== S.DRAFT) throw new AppError("الفاتورة ليست مسودة", "state");
      if (inv.lines.length === 0) throw new AppError("أضف بنداً واحداً على الأقل", "empty");
      if (!inv.merchantId) throw new AppError("اختر التاجر", "no_merchant");
      await save({ ...inv, state: S.READY, finishedAt: iso(), updatedAt: iso() });
      if (ui.currentUid === uid) await svc.setCurrent(null);
      emit();
    },
    async reopen(uid) {
      const inv = need(uid);
      if (!canEdit(inv) || inv.state !== S.READY) throw new AppError("لا يمكن إعادة فتح هذه الفاتورة بعد محاولة الإرسال", "locked");
      await save({ ...inv, state: S.DRAFT, updatedAt: iso() });
      await svc.setCurrent(uid);
      emit();
    },
    async deleteInvoice(uid, { force = false } = {}) {
      const inv = need(uid);
      if (!isSafeToDelete(inv) && !force) {
        throw new AppError("لم يؤكّد الكمبيوتر هذه الفاتورة بعد — الحذف قد يفقدها نهائياً", "unsafe");
      }
      await db.deleteInvoice(uid);
      invoices.delete(uid);
      if (ui.currentUid === uid) await svc.setCurrent(null);
      emit();
    },
    /** نسخة جديدة (uid جديد) من فاتورة مرفوضة لإصلاحها وإعادة إرسالها. */
    async duplicateAsDraft(uid) {
      const inv = need(uid);
      const t = iso();
      const copy = {
        uid: uuid(), createdAt: t, updatedAt: t, invoiceDate: todayLocal(now()),
        merchantId: inv.merchantId, merchantName: inv.merchantName,
        lines: inv.lines.map((l) => ({ ...l, lid: uuid(), boxes: l.boxes.map((b) => ({ ...b })) })),
        total: inv.total, state: S.DRAFT, sendAttempts: 0,
      };
      await save(copy);
      await svc.setCurrent(copy.uid);
      emit();
      return copy;
    },

    // ───────── المزامنة ─────────
    async refreshCatalog() {
      const res = await api.catalog();
      const { merchants, boxes } = validateCatalog(res);
      catalog = {
        merchants, boxes,
        generatedAt: res.generatedAt || null,
        fetchedAt: iso(),
        source: res.source || "live",
        stale: !!res.stale,
        note: res.note || null,
      };
      await db.kvSet("catalog", catalog);
      emit();
      return catalog;
    },

    /** إرسال كل الجاهزة وغير المؤكَّدة، ثم الاستعلام عن حالة المعلّقة. */
    async syncAll() {
      if (syncBusy) throw new AppError("عملية مزامنة جارية بالفعل", "busy");
      syncBusy = true;
      const summary = { sent: 0, pending: 0, confirmed: 0, rejected: 0, invalid: 0, failed: 0, requeued: 0, error: null };
      try {
        const toSend = svc.list().filter((i) => i.state === S.READY || i.state === S.UNCERTAIN);
        const fresh = toSend.length > 0 ? await sendBatch(toSend, summary) : new Set();
        // فشل الإرسال (شبكة/مهلة/رفض) يعني أن الكمبيوتر غير متاح الآن: لا نُضيف مهلة انتظار
        // ثانية باستعلام الحالة. الاستعلام يجري فقط حين تنجح عملية الإرسال أو لا يوجد ما يُرسَل،
        // وللفواتير الأخرى فقط (التي وصل ردّها في هذه الجولة معلوماتها أحدث).
        if (!summary.error) await checkStatusInner(summary, fresh);
      } finally {
        syncBusy = false;
        emit();
      }
      return summary;
    },

    async checkStatus() {
      if (syncBusy) throw new AppError("عملية مزامنة جارية بالفعل", "busy");
      syncBusy = true;
      const summary = { sent: 0, pending: 0, confirmed: 0, rejected: 0, invalid: 0, failed: 0, requeued: 0, error: null };
      try {
        await checkStatusInner(summary);
      } finally {
        syncBusy = false;
        emit();
      }
      return summary;
    },

    // ───────── نسخ احتياطي ─────────
    exportBackup() {
      return JSON.stringify({ app: "mks-phone", version: 1, exportedAt: iso(), invoices: svc.list() }, null, 1);
    },
    async importBackup(text) {
      let data;
      try { data = JSON.parse(text); } catch { throw new AppError("الملف ليس نسخة احتياطية صالحة", "bad_backup"); }
      if (!data || data.app !== "mks-phone" || !Array.isArray(data.invoices)) throw new AppError("الملف ليس نسخة احتياطية من تطبيق الهاتف", "bad_backup");
      let added = 0, skipped = 0;
      for (const inv of data.invoices) {
        const ok = inv && isUuid(inv.uid) && ALL_STATES.has(inv.state) && Array.isArray(inv.lines) && Number.isInteger(inv.merchantId) && typeof inv.invoiceDate === "string";
        if (!ok || invoices.has(inv.uid)) { skipped++; continue; } // لا نستبدل فاتورة موجودة أبداً
        await save(inv);
        added++;
      }
      emit();
      return { added, skipped };
    },
  };

  async function sendBatch(list, summary) {
    const answered = new Set();
    const t = iso();
    const prev = new Map(list.map((i) => [i.uid, i.state]));
    // 1) تثبيت "محاولة إرسال" على الهاتف قبل أي شبكة.
    for (const inv of list) {
      await save({ ...inv, state: S.UNCERTAIN, sendAttempts: (inv.sendAttempts || 0) + 1, lastAttemptAt: t });
    }
    summary.sent = list.length;
    // 2) الإرسال (دفعة واحدة، كل فاتورة مستقلة النتيجة).
    let res;
    try {
      res = await api.submit(list.map(toWire), settings.deviceLabel);
    } catch (e) {
      summary.error = e;
      if (e && e.definitive) {
        // رفض قبل المعالجة (مفتاح خاطئ، نسخة غير مطابقة...) → لم يُحفظ شيء، نرجع للحالة السابقة.
        for (const inv of list) {
          const cur = invoices.get(inv.uid);
          await save({ ...cur, state: prev.get(inv.uid), sendAttempts: Math.max(0, (cur.sendAttempts || 1) - 1), lastAttemptAt: inv.lastAttemptAt || null });
        }
        summary.sent = 0;
      }
      return answered;
    }
    // 3) تطبيق نتائج كل فاتورة على حدة.
    const byUid = new Map((res.results || []).map((r) => [r.uid, r]));
    for (const inv of list) {
      const r = byUid.get(inv.uid);
      const cur = invoices.get(inv.uid);
      if (!r) { summary.failed++; continue; } // لم يذكرها الردّ: تبقى غير مؤكَّدة
      const next = applyReceipt(cur, r, iso());
      if (next !== cur) await save(next);
      answered.add(inv.uid);
      tally(summary, r);
    }
    return answered;
  }

  async function checkStatusInner(summary, exclude = new Set()) {
    const list = svc.list().filter((i) => (i.state === S.PENDING || i.state === S.UNCERTAIN) && !exclude.has(i.uid));
    if (list.length === 0) return;
    let res;
    try {
      res = await api.status(list.map((i) => i.uid).slice(0, 500));
    } catch (e) {
      summary.error = summary.error || e;
      return;
    }
    const byUid = new Map((res.results || []).map((r) => [r.uid, r]));
    for (const inv of list) {
      const r = byUid.get(inv.uid);
      const cur = invoices.get(inv.uid);
      if (!r || !cur) continue;
      const next = applyReceipt(cur, r, iso());
      if (next !== cur) await save(next);
      if (r.status === "confirmed") summary.confirmed++;
      else if (r.status === "rejected") summary.rejected++;
      else if (r.status === "unknown") summary.requeued++;
    }
  }

  function tally(summary, r) {
    if (r.status === "pending") summary.pending++;
    else if (r.status === "confirmed") summary.confirmed++;
    else if (r.status === "rejected") summary.rejected++;
    else if (r.status === "invalid") summary.invalid++;
    else if (r.status === "error") summary.requeued++;
  }

  return svc;
}
