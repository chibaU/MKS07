// واجهة تطبيق الهاتف (PWA) — شبيهة بالصفحة الرئيسية في سطح المكتب وبأقل العناصر.
// الشاشة الرئيسية = محرر الفاتورة (تبويبات + تاجر + بند + صناديق + بنود + إجماليات + حفظ).
// كل ما يخص الاتصال بالكمبيوتر (جلب البيانات، الإرسال، الحالة، الإعدادات) في شاشة «المزامنة».
// لا innerHTML إطلاقاً: كل النصوص (أسماء التجار/المنتجات) تُدرَج بـ textContent.
//
// حالات الفاتورة (المتطلب 18): لا تُحذَف تلقائياً أبداً.
//   draft (مفتوحة في تبويب) → ready (محفوظة بانتظار الإرسال) → sent (وصلت للكمبيوتر، بانتظار مراجعته)
//   → confirmed | rejected.   «sent» لا تُحذَف ولا تُعدَّل؛ «confirmed» وحدها = منقولة بأمان.

import {
  round2, formatMoney, formatKg, parseMoneyDigits, newId, boxMapOf, boxInfo,
  lineCalc, lineSubtotal, invoiceTotals, todayLocal, evalWeightInput,
} from "./calc.js";
import { kv, invoices as invStore, requestPersistence } from "./store.js";
import { api, ApiError, parseConnection } from "./api.js";
import { icon } from "./icons.js";

const $app = document.getElementById("app");
const $toast = document.getElementById("toast");

const S = {
  conn: null,            // {base, key}
  snapshot: null,        // {merchants, boxes, fetchedAt, stale}
  deviceLabel: "",
  list: [],              // كل الفواتير المحفوظة في IndexedDB
  fresh: null,           // فاتورة جديدة فارغة لم تُحفَظ بعد (لا تُكتَب للتخزين حتى يظهر فيها محتوى)
  activeId: null,
  view: { name: "home" },
  busy: false,
  persisted: false,
  syncMsg: null,
};

// ───────────────────────── مساعدات DOM ─────────────────────────
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
    else if (k === "disabled" || k === "checked" || k === "selected" || k === "hidden") el[k] = !!v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let toastTimer = null;
function toast(text, ms = 3500) {
  $toast.replaceChildren(h("div", { text }));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.replaceChildren(), ms);
}

function draw({ top = false } = {}) {
  const y = window.scrollY;
  const parts = VIEWS[S.view.name]();
  const wrap = h("div");
  for (const p of parts) if (p) wrap.append(p);
  if (!wrap.childNodes.length) return;
  $app.replaceChildren(wrap);
  window.scrollTo(0, top ? 0 : y);
  const on = $app.querySelector(".tab.on");
  if (on && on.scrollIntoView) on.scrollIntoView({ inline: "center", block: "nearest" });
}

function go(name, extra = {}) {
  S.view = { name, ...extra };
  draw({ top: true });
}

const STATE_LABEL = { ready: "جاهزة للإرسال", sent: "بانتظار مراجعة الكمبيوتر", confirmed: "مؤكَّدة ومحفوظة", rejected: "مرفوضة" };
const badge = (s) => h("span", { class: `badge b-${s}`, text: STATE_LABEL[s] || s });

// ───────────────────────── البيانات المرجعية (لقطة الكمبيوتر) ─────────────────────────
const merchants = () => S.snapshot?.merchants || [];
const boxMap = () => boxMapOf(S.snapshot?.boxes);
const merchantName = (inv) => {
  const m = merchants().find((x) => x.id === inv.merchantId);
  if (m) return m.name;
  if (inv.merchantNameHint) return `${inv.merchantNameHint} (غير موجود في آخر بيانات)`;
  return inv.merchantId ? `تاجر #${inv.merchantId}` : "";
};

function productSuggestions() {
  const set = new Set();
  for (const inv of S.list) for (const l of inv.lines) if (l.productName) set.add(l.productName);
  return [...set].sort((a, b) => a.localeCompare(b, "ar")).slice(0, 200);
}

// ───────────────────────── الفواتير: إنشاء/حفظ/تبويبات ─────────────────────────
function newInvoice() {
  return {
    id: newId(), createdAt: Date.now(), updatedAt: Date.now(), state: "draft",
    invoiceDate: todayLocal(), merchantId: null, merchantNameHint: null,
    lines: [], entry: null, message: null,
  };
}

const emptyEntry = () => ({ product: "", scale: "", price: "", counts: {} });
const hasContent = (inv) =>
  !!inv.merchantId || inv.lines.length > 0 ||
  !!(inv.entry && (inv.entry.product || inv.entry.scale || inv.entry.price || Object.keys(inv.entry.counts).length));

const drafts = () => S.list.filter((i) => i.state === "draft").sort((a, b) => a.createdAt - b.createdAt);

async function save(inv) {
  inv.updatedAt = Date.now();
  await invStore.put(inv);
  const i = S.list.findIndex((x) => x.id === inv.id);
  if (i >= 0) S.list[i] = inv; else S.list.push(inv);
  if (S.fresh && S.fresh.id === inv.id) S.fresh = null;
}

// الفاتورة المفتوحة حالياً في المحرر: دائماً يوجد واحدة (مثل الصفحة الرئيسية في سطح المكتب).
function activeInvoice() {
  let inv = S.list.find((i) => i.id === S.activeId && i.state === "draft") || (S.fresh && S.fresh.id === S.activeId ? S.fresh : null);
  if (!inv) {
    const ds = drafts();
    inv = ds.length ? ds[ds.length - 1] : (S.fresh ||= newInvoice());
    S.activeId = inv.id;
  }
  return inv;
}

function startNewTab() {
  if (S.fresh && !hasContent(S.fresh)) { S.activeId = S.fresh.id; draw({ top: true }); return; }
  S.fresh = newInvoice();
  S.activeId = S.fresh.id;
  draw({ top: true });
}

// ───────────────────────── التحويل لصيغة الإرسال ─────────────────────────
// المراجع (merchantId/boxId/boxCount) + القيم المُدخَلة فقط. الأسماء/الأوزان «تلميحات» للعرض
// عند التعارض ولا يعتمد عليها الكمبيوتر في الحساب (المتطلبان 11 و12).
function toWire(inv) {
  return {
    id: inv.id,
    invoiceDate: inv.invoiceDate,
    merchantId: inv.merchantId,
    merchantNameHint: inv.merchantNameHint || undefined,
    createdAt: new Date(inv.createdAt).toISOString(),
    lines: inv.lines.map((l) => ({
      productName: l.productName,
      scaleWeight: l.scaleWeight,
      price: l.price,
      boxes: l.boxes.map((b) => ({ boxId: b.boxId, boxCount: b.boxCount, nameHint: b.nameHint || undefined, weightHint: b.weightHint })),
    })),
  };
}

// ───────────────────────── المزامنة ─────────────────────────
function explain(e) {
  if (e instanceof ApiError) {
    if (e.kind === "unauthorized") {
      return "مفتاح الوصول غير صحيح أو تغيّر — امسح رمز QR («فتح التطبيق») من صفحة «مزامنة الهاتف» في برنامج الكمبيوتر مرة أخرى.";
    }
    return e.message;
  }
  return "حدث خطأ غير متوقع.";
}

async function fetchBootstrap() {
  if (S.busy) return false;
  S.busy = true; draw();
  try {
    const data = await api.bootstrap(S.conn);
    S.snapshot = { merchants: data.merchants, boxes: data.boxes, fetchedAt: Date.now(), stale: !!data.stale };
    await kv.set("snapshot", S.snapshot);
    S.syncMsg = data.stale
      ? { kind: "warn", text: "تم الجلب لكن الكمبيوتر أرسل آخر نسخة محفوظة لديه — تأكد أن برنامج MKS مفتوح." }
      : { kind: "ok", text: `تم جلب ${data.merchants.length} تاجر و${data.boxes.length} صندوق. يمكنك الآن العمل دون اتصال.` };
    return true;
  } catch (e) {
    S.syncMsg = { kind: "err", text: explain(e) };
    return false;
  } finally {
    S.busy = false; draw();
  }
}

function applyServerResult(inv, r) {
  switch (r.state) {
    case "received":
      if (inv.state === "ready" || inv.state === "sent") { inv.state = "sent"; inv.sentAt ||= Date.now(); }
      break;
    case "confirmed": inv.state = "confirmed"; inv.serverNumber = r.invoiceNumber || inv.serverNumber; break;
    case "rejected": inv.state = "rejected"; inv.rejectReason = r.reason || ""; break;
    // رفضها الكمبيوتر شكلياً: ترجع مسودة مفتوحة في تبويب لتصحيحها (لا تضيع).
    case "invalid": inv.state = "draft"; inv.message = r.message || "رفضها الكمبيوتر لخطأ في البيانات"; break;
    // لا أثر لها على الكمبيوتر → تُرسَل ثانية بأمان (المعرّف الفريد يمنع التكرار)
    case "unknown": if (inv.state === "sent") inv.state = "ready"; break;
    default: break; // error: تبقى كما هي على الهاتف
  }
}

async function syncAll() {
  if (S.busy) return;
  const ready = S.list.filter((i) => i.state === "ready");
  const waiting = S.list.filter((i) => i.state === "sent");
  if (!ready.length && !waiting.length) { toast("لا توجد فواتير للإرسال أو المتابعة"); return; }
  S.busy = true; draw();
  try {
    let sentOk = 0;
    let failed = 0;
    if (ready.length) {
      const res = await api.sendInvoices(S.conn, ready.map(toWire), S.deviceLabel);
      for (const r of res.results || []) {
        const inv = S.list.find((i) => i.id === r.id);
        if (!inv) continue;
        const before = inv.state;
        applyServerResult(inv, r);
        if (r.state === "error" || r.state === "invalid") failed++;
        else if (before === "ready") sentOk++;
        await save(inv);
      }
    }
    const ids = S.list.filter((i) => i.state === "sent").map((i) => i.id);
    if (ids.length) {
      const st = await api.statuses(S.conn, ids);
      for (const id of ids) {
        const inv = S.list.find((i) => i.id === id);
        const r = st.statuses?.[id];
        if (inv && r) { applyServerResult(inv, r); await save(inv); }
      }
    }
    const confirmed = S.list.filter((i) => i.state === "confirmed").length;
    S.syncMsg = {
      kind: failed ? "warn" : "ok",
      text: `أُرسلت ${sentOk} فاتورة.` + (failed ? ` ${failed} منها تحتاج تصحيحاً (ستجدها في تبويب مفتوح).` : "") +
        ` ${confirmed} مؤكَّدة. ما بقي «بانتظار المراجعة» يتأكد بعد أن يراجعه المستخدم على الكمبيوتر؛ أعد المحاولة لاحقاً لمعرفة النتيجة.`,
    };
  } catch (e) {
    S.syncMsg = { kind: "err", text: `${explain(e)} — فواتيرك ما زالت محفوظة على الهاتف.` };
  } finally {
    S.busy = false; draw();
  }
}

// ───────────────────────── نوافذ مساعدة ─────────────────────────
function pickFromList(title, items, selectedId) {
  return new Promise((resolve) => {
    const input = h("input", { class: "inp", type: "search", placeholder: "بحث…", autocomplete: "off" });
    const list = h("div", { class: "list" });
    const close = (v) => { overlay.remove(); resolve(v); };
    const fill = () => {
      const q = input.value.trim();
      list.replaceChildren(
        ...items.filter((x) => !q || x.name.includes(q)).map((x) =>
          h("button", { class: `opt${x.id === selectedId ? " sel" : ""}`, type: "button", onclick: () => close(x), text: x.name })),
      );
      if (!list.childNodes.length) list.append(h("div", { class: "empty", text: "لا نتائج" }));
    };
    input.addEventListener("input", fill);
    const overlay = h("div", { class: "modal", onclick: (e) => { if (e.target === overlay) close(null); } },
      h("div", { class: "sheet" },
        h("header", {}, h("div", { class: "grow", text: title }),
          h("button", { class: "btn alt sm", type: "button", onclick: () => close(null), text: "إغلاق" })),
        h("div", { style: "padding:0 14px 10px" }, input), list));
    document.body.append(overlay);
    fill();
  });
}

function confirmBox(text, okLabel = "نعم", danger = false) {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); resolve(v); };
    const overlay = h("div", { class: "modal", onclick: (e) => { if (e.target === overlay) close(false); } },
      h("div", { class: "sheet" },
        h("header", { text }),
        h("div", { class: "list row" },
          h("button", { class: `btn grow ${danger ? "danger" : ""}`, type: "button", onclick: () => close(true), text: okLabel }),
          h("button", { class: "btn alt grow", type: "button", onclick: () => close(false), text: "إلغاء" }))));
    document.body.append(overlay);
  });
}

function fieldLabel(iconName, text) {
  return h("label", {}, h("span", { class: "tile" }, icon(iconName, 17)), text);
}

// ───────────────────────── الشاشة الرئيسية: محرر الفاتورة ─────────────────────────
function homeView() {
  const inv = activeInvoice();
  const bm = boxMap();
  inv.entry ||= emptyEntry();
  const E = inv.entry;

  const persist = async () => {
    if (!hasContent(inv)) return;
    try { await save(inv); } catch { toast("تعذر الحفظ على الهاتف!"); }
  };
  let timer = null;
  const persistSoon = () => { clearTimeout(timer); timer = setTimeout(persist, 400); };
  const redraw = () => { clearTimeout(timer); draw(); };

  const pending = S.list.filter((i) => i.state === "ready" || i.state === "sent").length;
  const totals = invoiceTotals(inv, bm);

  // ── الرأس + التبويبات (مثل شريط تبويبات الصفحة الرئيسية) ──
  const header = h("div", { class: "stick" },
    h("div", { class: "top" },
      h("h1", { text: "فواتير MKS" }),
      h("button", { class: "hbtn", type: "button", onclick: () => go("sync"), "aria-label": "المزامنة" },
        icon("refresh-cw", 18), "مزامنة", pending ? h("span", { class: "cnt", text: String(pending) }) : null)),
    h("div", { class: "tabs" },
      ...[...drafts(), ...(S.fresh && !S.list.some((i) => i.id === S.fresh.id) ? [S.fresh] : [])].map((d) =>
        h("div", { class: `tab${d.id === inv.id ? " on" : ""}`, onclick: () => { if (d.id !== inv.id) { clearTimeout(timer); S.activeId = d.id; draw({ top: true }); } } },
          h("span", { class: "l", text: merchantName(d) || "فاتورة جديدة" }),
          h("button", {
            class: "x", type: "button", "aria-label": "إغلاق التبويب",
            onclick: async (e) => {
              e.stopPropagation();
              if (hasContent(d) && !(await confirmBox("حذف هذه الفاتورة غير المُرسَلة نهائياً من الهاتف؟", "حذف", true))) return;
              clearTimeout(timer);
              if (S.fresh && S.fresh.id === d.id) S.fresh = null;
              if (S.list.some((i) => i.id === d.id)) { await invStore.remove(d.id); S.list = S.list.filter((i) => i.id !== d.id); }
              S.activeId = null; draw({ top: true });
            },
          }, icon("x", 16))),
      ),
      h("button", { class: "tab add", type: "button", onclick: startNewTab }, icon("plus", 16), "فاتورة جديدة")));

  // ── التاجر ──
  const merchantBtn = h("button", {
    class: "inp", type: "button",
    onclick: async () => {
      if (!merchants().length) { toast("اجلب التجار من الكمبيوتر أولاً (زر «مزامنة»)"); return; }
      const m = await pickFromList("اختيار التاجر", merchants(), inv.merchantId);
      if (!m) return;
      inv.merchantId = m.id; inv.merchantNameHint = m.name;
      await persist(); redraw();
    },
  }, inv.merchantId ? h("span", { text: merchantName(inv) }) : h("span", { class: "ph", text: "اختر التاجر…" }), icon("store", 18));

  // ── البنود المُدرَجة ──
  const loadCopy = (l) => {
    E.product = l.productName; E.scale = ""; E.price = l.price ? String(l.price) : "";
    E.counts = Object.fromEntries(l.boxes.map((b) => [b.boxId, b.boxCount]));
    persist(); redraw();
    const f = document.getElementById("entry");
    if (f && f.scrollIntoView) f.scrollIntoView({ block: "start" });
  };
  const lineEls = inv.lines.map((l, idx) => {
    const c = lineCalc(l.scaleWeight, l.boxes, bm);
    return h("div", { class: "line" },
      h("div", { class: "row" },
        h("div", { class: "grow" },
          h("div", { class: "p", text: `${idx + 1}. ${l.productName}` }),
          h("div", { class: "m", text: `الميزان ${formatKg(l.scaleWeight)} — الصافي ${formatKg(c.net)} × ${formatMoney(l.price)}` }),
          h("div", {}, ...l.boxes.map((b) => h("span", { class: "chip", text: `${boxInfo(bm, b).name} ×${b.boxCount}` }))),
          c.exceeds ? h("div", { class: "err", text: "وزن الصناديق يفوق وزن الميزان — احذف البند وأعد إدخاله" }) : null),
        h("div", { class: "amt", text: `${formatMoney(lineSubtotal(c.net, l.price))} دج` })),
      h("div", { class: "row", style: "margin-top:8px" },
        h("button", { class: "lbtn cp", type: "button", onclick: () => loadCopy(l) }, icon("copy", 15), "نسخ"),
        h("button", {
          class: "lbtn rm", type: "button",
          onclick: async () => {
            if (!(await confirmBox(`حذف البند «${l.productName}»؟`, "حذف", true))) return;
            inv.lines.splice(idx, 1); await persist(); redraw();
          },
        }, icon("trash", 15), "حذف")));
  });

  // ── نموذج إدخال البند ──
  const entryBoxes = () => {
    const sels = [];
    for (const [id, n] of Object.entries(E.counts)) {
      const boxId = Number(id);
      if (n > 0) {
        const live = bm.get(boxId);
        const prev = inv.lines.flatMap((l) => l.boxes).find((b) => b.boxId === boxId);
        sels.push({ boxId, boxCount: n, nameHint: live?.name || prev?.nameHint, weightHint: live?.weight ?? prev?.weightHint });
      }
    }
    return sels;
  };
  const priceText = () => (E.price ? formatMoney(Number(E.price)).replace(/,00$/, "") : "");

  const weightNote = h("div");
  const resBox = h("div");
  const emptyVal = h("span", { class: "v" });
  const emptyCnt = h("div", { class: "b" });
  const clearBtn = h("button", { class: "clr", type: "button", text: "تصفير الكل", onclick: () => {
    E.counts = {}; persistSoon(); redraw();
  } });
  const addBtn = h("button", { class: "btn block", type: "button" });
  const cards = new Map();

  function refreshPreview() {
    const w = evalWeightInput(E.scale);
    const sels = entryBoxes();
    const entered = w.state === "ok";
    const calc = lineCalc(entered ? w.value : 0, sels, bm);
    const exceeds = entered && calc.empties > w.value + 1e-9;
    const count = sels.reduce((s, b) => s + b.boxCount, 0);

    emptyVal.textContent = formatKg(calc.empties);
    emptyCnt.textContent = `${count} صندوق`;
    clearBtn.hidden = count === 0;
    for (const [id, el] of cards) el.classList.toggle("on", (E.counts[id] || 0) > 0);

    weightNote.replaceChildren(
      w.state === "invalid" ? h("div", { class: "err", text: "تعبير غير صالح — تحقّق من الأرقام والعمليات" }) : null,
      w.state === "negative" ? h("div", { class: "err", text: "لا يمكن أن يكون الوزن سالباً" }) : null,
      entered && w.isExpr ? h("div", { class: "hint", text: `= ${formatKg(w.value)}` }) : null);

    resBox.replaceChildren(
      exceeds ? h("div", { class: "res bad", text: `⚠ وزن الصناديق (${formatKg(calc.empties)}) يفوق وزن الميزان` }) : null,
      entered && !exceeds
        ? h("div", { class: "res ok", text: `الوزن الصافي: ${formatKg(calc.net)}` + (E.price ? ` — المجموع ${formatMoney(lineSubtotal(calc.net, Number(E.price) || 0))} دج` : "") })
        : null);

    addBtn.disabled = !(inv.merchantId && E.product.trim() !== "" && entered && !exceeds);
  }

  addBtn.append(icon("plus", 18), "إدراج البند");
  addBtn.addEventListener("click", async () => {
    const w = evalWeightInput(E.scale);
    const sels = entryBoxes();
    if (w.state !== "ok" || lineCalc(w.value, sels, bm).empties > w.value + 1e-9) return;
    if (inv.lines.length === 0) inv.invoiceDate = todayLocal(); // تاريخ الفاتورة = يوم أول بند (كسطح المكتب)
    inv.lines.push({ productName: E.product.trim(), scaleWeight: round2(w.value), price: Number(E.price) || 0, boxes: sels });
    inv.entry = emptyEntry();
    inv.message = null;
    await persist(); redraw();
    const t = document.getElementById("lines");
    if (t && t.scrollIntoView) t.scrollIntoView({ block: "start" });
  });

  const boxRows = (S.snapshot?.boxes || []).map((b) => {
    const cnt = h("input", { type: "text", inputmode: "numeric", value: String(E.counts[b.id] || 0), "aria-label": `عدد ${b.name}` });
    const set = (n) => {
      n = Math.max(0, Math.min(100000, Math.floor(n) || 0));
      if (n) E.counts[b.id] = n; else delete E.counts[b.id];
      cnt.value = String(n); refreshPreview(); persistSoon();
    };
    cnt.addEventListener("input", () => set(parseInt(parseMoneyDigits(cnt.value) || "0", 10)));
    cnt.addEventListener("focus", () => cnt.select());
    const card = h("div", { class: "boxcard" },
      h("div", { class: "grow" }, h("div", { class: "nm", text: b.name }), h("div", { class: "wt", text: `فارغ: ${formatKg(b.weight)}` })),
      h("div", { class: "stepper" },
        h("button", { type: "button", "aria-label": "إنقاص", onclick: () => set((E.counts[b.id] || 0) - 1), text: "−" }), cnt,
        h("button", { type: "button", "aria-label": "زيادة", onclick: () => set((E.counts[b.id] || 0) + 1), text: "+" })));
    cards.set(b.id, card);
    return card;
  });

  const prodInp = h("input", {
    class: "inp", type: "text", list: "prods", value: E.product, placeholder: "اسم المنتج", autocomplete: "off", maxlength: "200",
    oninput: (e) => { E.product = e.target.value; refreshPreview(); persistSoon(); },
  });
  const prodList = h("datalist", { id: "prods" }, ...productSuggestions().map((p) => h("option", { value: p })));
  const scaleInp = h("input", {
    class: "inp ltr", type: "text", inputmode: "decimal", value: E.scale, placeholder: "مثال: 100 أو 10+20+30",
    oninput: (e) => { E.scale = e.target.value; refreshPreview(); persistSoon(); },
    onblur: () => { // مثل سطح المكتب: عند الخروج يُستبدَل التعبير بناتجه
      const w = evalWeightInput(E.scale);
      if (w.state === "ok" && w.isExpr) { E.scale = String(w.value); scaleInp.value = E.scale; refreshPreview(); persistSoon(); }
    },
  });
  const plusBtn = h("button", { class: "plusbtn", type: "button", "aria-label": "جمع", onclick: () => {
    E.scale = E.scale.replace(/\s+$/, "") + "+"; scaleInp.value = E.scale; scaleInp.focus(); refreshPreview(); persistSoon();
  }, text: "+" });
  const priceInp = h("input", {
    class: "inp ltr", type: "text", inputmode: "numeric", value: priceText(), placeholder: "0",
    oninput: (e) => { E.price = parseMoneyDigits(e.target.value); e.target.value = priceText(); refreshPreview(); persistSoon(); },
  });

  const form = h("div", { id: "entry", class: "scrollm" },
    h("div", { class: "fld" }, fieldLabel("tag", "اسم المنتج"), prodInp, prodList),
    h("div", { class: "fld" }, fieldLabel("scale", "الوزن على الميزان (كغ)"),
      h("div", { class: "row" }, h("div", { class: "grow" }, scaleInp), plusBtn), weightNote),
    h("div", { class: "boxes" },
      h("div", { class: "hd" }, h("span", { text: "الصناديق" }), clearBtn),
      boxRows.length ? boxRows : h("div", { class: "muted", text: "لا توجد صناديق نشطة — أضفها من صفحة الصناديق في الكمبيوتر ثم اجلب البيانات." }),
      h("div", { class: "emptybar" }, h("div", {}, h("div", { class: "a", text: "وزن الصناديق الفارغة" }), emptyCnt), emptyVal)),
    h("div", { class: "fld" }, fieldLabel("banknote", "السعر (دج / كغ)"),
      h("div", { class: "row" }, h("div", { class: "grow" }, priceInp), h("span", { class: "sfx", text: ",00" }))),
    resBox, addBtn);

  // ── الحفظ ──
  const canSave = !!inv.merchantId && inv.lines.length > 0 && totals.problems === 0;
  const saveBtn = h("button", {
    class: "btn", type: "button", disabled: !canSave,
    onclick: async () => {
      const E2 = inv.entry;
      if (E2 && (E2.product.trim() || E2.scale.trim())) {
        if (!(await confirmBox("في نموذج البند بيانات لم تُدرَج، وستُتجاهَل عند الحفظ. متابعة؟", "حفظ بدونها"))) return;
      }
      clearTimeout(timer);
      inv.state = "ready"; inv.message = null; inv.entry = null;
      try { await save(inv); } catch { toast("تعذر الحفظ على الهاتف!"); inv.state = "draft"; return; }
      S.activeId = null;
      toast("تم حفظ الفاتورة — اضغط «مزامنة» لإرسالها");
      draw({ top: true });
    },
  }, icon("check", 18), "حفظ الفاتورة");

  setTimeout(refreshPreview, 0);

  return [
    header,
    h("div", { class: "page" },
      !S.snapshot ? h("div", { class: "msg warn" },
        S.conn ? "لم تُجلَب التجار والصناديق بعد — اضغط «مزامنة» ثم «جلب التجار والصناديق»." : "الهاتف غير مرتبط بالكمبيوتر — امسح رمز QR («فتح التطبيق») من صفحة «مزامنة الهاتف» في برنامج MKS.") : null,
      inv.message ? h("div", { class: "msg err", text: inv.message }) : null,
      h("div", { class: "card" },
        h("h2", { class: "title", text: "إنشاء فاتورة جديدة" }),
        h("div", { class: "fld" }, fieldLabel("store", "اسم التاجر"), merchantBtn),
        form),
      inv.lines.length ? h("div", { id: "lines", class: "card scrollm" }, h("h2", { class: "sub", text: `بنود الفاتورة (${inv.lines.length})` }), ...lineEls,
        h("div", { class: "totals" },
          h("div", { class: "r" }, h("span", { text: "إجمالي الوزن الصافي" }), h("b", { text: formatKg(totals.net) })),
          h("div", { class: "r" }, h("span", { text: "عدد الصناديق الكلي" }), h("b", { text: String(totals.boxes) })),
          h("div", { class: "r g" }, h("span", { text: "الإجمالي الكلي" }), h("b", { text: `${formatMoney(totals.total)} دج` })))) : null,
      h("div", { class: "muted", text: "الحسابات هنا للعرض فقط؛ يعيد الكمبيوتر حسابها ببياناته الحالية ثم تراجعها قبل الحفظ النهائي." })),
    h("div", { class: "bar" }, saveBtn),
  ];
}

// ───────────────────────── شاشة المزامنة ─────────────────────────
function topbar(title, onBack) {
  return h("div", { class: "stick" }, h("div", { class: "top" },
    onBack ? h("button", { class: "back", type: "button", onclick: onBack, "aria-label": "رجوع" }, icon("arrow-right", 24)) : null,
    h("h1", { text: title })));
}

function itemCard(inv) {
  const t = invoiceTotals(inv, boxMap());
  return h("button", { class: "item", type: "button", onclick: () => go("view", { id: inv.id }) },
    h("div", { class: "row" }, h("div", { class: "t grow", text: merchantName(inv) || "—" }), badge(inv.state)),
    h("div", { class: "muted", text: `${inv.invoiceDate} — ${inv.lines.length} بند — ${formatMoney(t.total)} دج` + (inv.serverNumber ? ` — رقم ${inv.serverNumber}` : "") }),
    inv.state === "rejected" ? h("div", { class: "err", text: `رفضها المستخدم${inv.rejectReason ? `: ${inv.rejectReason}` : ""}` }) : null);
}

function syncView() {
  const ready = S.list.filter((i) => i.state === "ready").length;
  const waiting = S.list.filter((i) => i.state === "sent").length;
  const groups = [["جاهزة للإرسال", "ready"], ["بانتظار مراجعة الكمبيوتر", "sent"], ["مرفوضة", "rejected"], ["مؤكَّدة ومحفوظة في الكمبيوتر", "confirmed"]];
  const openDrafts = drafts().length;

  const fetched = S.snapshot
    ? `آخر جلب: ${new Date(S.snapshot.fetchedAt).toLocaleString("ar-DZ-u-nu-latn")} — ${S.snapshot.merchants.length} تاجر، ${S.snapshot.boxes.length} صندوق`
    : "لم تُجلَب البيانات بعد.";

  return [
    topbar("المزامنة", () => go("home")),
    h("div", { class: "page" },
      S.syncMsg ? h("div", { class: `msg ${S.syncMsg.kind}`, text: S.syncMsg.text }) : null,
      !S.conn ? h("div", { class: "msg warn", text: "الهاتف غير مرتبط بالكمبيوتر بعد. افتح «مزامنة الهاتف» في برنامج MKS وامسح رمز QR الخاص بـ«فتح التطبيق»، أو أدخل العنوان من الإعدادات." }) : null,
      h("div", { class: "card" },
        h("h2", { class: "sub", text: "1) بيانات الكمبيوتر" }),
        h("div", { class: "muted", style: "margin-bottom:10px", text: fetched }),
        h("button", { class: "btn alt block", type: "button", disabled: S.busy || !S.conn, onclick: fetchBootstrap },
          S.busy ? h("span", { class: "spin" }) : icon("refresh-cw", 18), "جلب التجار والصناديق")),
      h("div", { class: "card" },
        h("h2", { class: "sub", text: "2) إرسال الفواتير" }),
        h("div", { class: "muted", style: "margin-bottom:10px", text: ready || waiting
          ? "تبقى الفاتورة على هاتفك حتى يؤكدها الكمبيوتر بعد المراجعة."
          : openDrafts ? "احفظ الفاتورة المفتوحة أولاً ليمكن إرسالها." : "لا توجد فواتير بانتظار الإرسال." }),
        h("button", { class: "btn good block", type: "button", disabled: S.busy || !S.conn || (!ready && !waiting), onclick: syncAll },
          S.busy ? h("span", { class: "spin" }) : icon("send", 18),
          ready ? `إرسال ${ready} فاتورة${waiting ? ` ومتابعة ${waiting}` : ""}` : waiting ? `متابعة حالة ${waiting} فاتورة` : "إرسال")),
      ...groups.map(([title, st]) => {
        const items = S.list.filter((i) => i.state === st).sort((a, b) => b.updatedAt - a.updatedAt);
        if (!items.length) return null;
        return h("div", {}, h("h3", { text: `${title} (${items.length})`, style: "margin:16px 2px 8px;font-size:16px" }), ...items.map(itemCard));
      }),
      h("button", { class: "btn alt block", style: "margin-top:18px", type: "button", onclick: () => go("settings") }, icon("settings", 18), "إعدادات الاتصال")),
  ];
}

// ───────────────────────── عرض فاتورة محفوظة/مُرسَلة ─────────────────────────
function viewView() {
  const inv = S.list.find((i) => i.id === S.view.id);
  if (!inv) { go("sync"); return []; }
  const bm = boxMap();
  const t = invoiceTotals(inv, bm);
  const remove = async () => {
    const msg = inv.state === "confirmed" ? "حُفظت هذه الفاتورة في الكمبيوتر. حذف نسختها من الهاتف؟"
      : inv.state === "rejected" ? "حذف هذه الفاتورة المرفوضة من الهاتف نهائياً؟" : "حذف هذه الفاتورة (لم تُرسَل بعد) نهائياً؟";
    if (!(await confirmBox(msg, "حذف من الهاتف", true))) return;
    await invStore.remove(inv.id);
    S.list = S.list.filter((i) => i.id !== inv.id);
    go("sync");
  };
  const actions = [];
  if (inv.state === "ready") {
    actions.push(h("button", { class: "btn", type: "button", onclick: async () => {
      inv.state = "draft"; inv.entry = null; await save(inv); S.activeId = inv.id; go("home");
    } }, icon("pencil", 18), "تعديل"));
    actions.push(h("button", { class: "btn danger", type: "button", onclick: remove }, "حذف"));
  }
  if (inv.state === "rejected") {
    actions.push(h("button", { class: "btn", type: "button", onclick: async () => {
      const copy = { ...structuredClone(inv), id: newId(), createdAt: Date.now(), state: "draft", rejectReason: null, serverNumber: null, sentAt: null, message: null, entry: null };
      await save(copy); S.activeId = copy.id; go("home");
    } }, icon("copy", 18), "نسخ كفاتورة جديدة"));
  }
  if (inv.state === "confirmed" || inv.state === "rejected") actions.push(h("button", { class: "btn danger", type: "button", onclick: remove }, "حذف من الهاتف"));
  if (inv.state === "sent") actions.push(h("button", { class: "btn good", type: "button", disabled: S.busy || !S.conn, onclick: async () => { await syncAll(); } }, icon("refresh-cw", 18), "متابعة الحالة"));

  return [
    topbar("الفاتورة", () => go("sync")),
    h("div", { class: "page" },
      h("div", { class: "card" },
        h("div", { class: "row" }, h("div", { class: "t grow", style: "font-weight:700;font-size:18px", text: merchantName(inv) }), badge(inv.state)),
        h("div", { class: "kv" }, h("span", { text: "التاريخ" }), h("span", { text: inv.invoiceDate })),
        inv.serverNumber ? h("div", { class: "kv" }, h("span", { text: "رقم الفاتورة في الكمبيوتر" }), h("b", { text: inv.serverNumber })) : null,
        inv.state === "sent" ? h("div", { class: "msg warn", style: "margin-top:8px", text: "وصلت للكمبيوتر وتنتظر مراجعة المستخدم. تبقى نسختها هنا حتى التأكيد النهائي." }) : null,
        inv.state === "confirmed" ? h("div", { class: "msg ok", style: "margin-top:8px", text: "تم حفظها في قاعدة بيانات الكمبيوتر — نُقلت بأمان." }) : null,
        inv.state === "rejected" ? h("div", { class: "msg err", style: "margin-top:8px", text: `رفضها المستخدم${inv.rejectReason ? `: ${inv.rejectReason}` : ""}` }) : null),
      h("div", { class: "card" }, h("h2", { class: "sub", text: "البنود" }),
        ...inv.lines.map((l, i) => h("div", { class: "line" },
          h("div", { class: "p", text: `${i + 1}. ${l.productName}` }),
          h("div", { class: "m", text: `الميزان ${formatKg(l.scaleWeight)} — السعر ${formatMoney(l.price)}` }),
          h("div", {}, ...l.boxes.map((b) => h("span", { class: "chip", text: `${boxInfo(bm, b).name} ×${b.boxCount}` }))))),
        h("div", { class: "totals" },
          h("div", { class: "r" }, h("span", { text: "الوزن الصافي" }), h("b", { text: formatKg(t.net) })),
          h("div", { class: "r" }, h("span", { text: "عدد الصناديق" }), h("b", { text: String(t.boxes) })),
          h("div", { class: "r g" }, h("span", { text: "الإجمالي" }), h("b", { text: `${formatMoney(t.total)} دج` })))),
      h("div", { class: "muted", text: "الأرقام النهائية هي ما حُفظ في الكمبيوتر (قد تختلف إن تغيّرت أوزان الصناديق هناك)." })),
    actions.length ? h("div", { class: "bar" }, ...actions) : null,
  ];
}

// ───────────────────────── الإعدادات ─────────────────────────
function settingsView() {
  const addr = h("input", { class: "inp ltr", type: "text", value: S.conn?.base || "", placeholder: "https://192.168.1.10:47443", autocomplete: "off" });
  const key = h("input", { class: "inp ltr", type: "password", value: "", placeholder: S.conn?.key ? "•••••• (محفوظ)" : "الصق الرابط أو المفتاح", autocomplete: "off" });
  const label = h("input", { class: "inp", type: "text", value: S.deviceLabel, maxlength: "60" });
  const msg = h("div");
  return [
    topbar("الإعدادات", () => go("sync")),
    h("div", { class: "page" },
      h("div", { class: "card" }, h("h2", { class: "sub", text: "عنوان الكمبيوتر" }),
        h("div", { class: "muted", style: "margin-bottom:8px", text: "إن تغيّر عنوان الكمبيوتر على الشبكة اكتب العنوان الجديد (يظهر في صفحة «مزامنة الهاتف»). فواتيرك لا تتأثر." }),
        h("div", { class: "fld" }, h("label", { text: "العنوان" }), addr),
        h("div", { class: "fld" }, h("label", { text: "مفتاح الوصول (أو رابط QR كاملاً)" }), key),
        msg,
        h("button", {
          class: "btn block", type: "button",
          onclick: async () => {
            const pasted = parseConnection(key.value);
            const fromAddr = parseConnection(addr.value);
            const base = fromAddr.base || pasted.base;
            const raw = key.value.trim();
            const k = pasted.key || fromAddr.key || (/^[0-9a-fA-F]{64}$/.test(raw) ? raw.toLowerCase() : S.conn?.key);
            if (!base || !k) { msg.replaceChildren(h("div", { class: "msg err", text: "تحقق من العنوان والمفتاح." })); return; }
            S.conn = { base, key: k };
            await kv.set("conn", S.conn);
            try {
              await api.hello(S.conn);
              msg.replaceChildren(h("div", { class: "msg ok", text: "تم الاتصال بالكمبيوتر بنجاح ✓" }));
            } catch (e) {
              msg.replaceChildren(h("div", { class: "msg err", text: `حُفظ الإعداد لكن: ${explain(e)}` }));
            }
          }, text: "حفظ واختبار الاتصال",
        })),
      h("div", { class: "card" }, h("h2", { class: "sub", text: "اسم هذا الهاتف" }),
        h("div", { class: "muted", style: "margin-bottom:8px", text: "يظهر على الكمبيوتر عند مراجعة الفواتير (لمعرفة مصدرها فقط)." }), label,
        h("button", {
          class: "btn alt block", style: "margin-top:10px", type: "button",
          onclick: async () => { S.deviceLabel = label.value.trim().slice(0, 60) || S.deviceLabel; await kv.set("deviceLabel", S.deviceLabel); toast("تم الحفظ"); },
          text: "حفظ الاسم",
        })),
      h("div", { class: "card" }, h("h2", { class: "sub", text: "التخزين" }),
        h("div", { class: "kv" }, h("span", { text: "عدد الفواتير على الهاتف" }), h("b", { text: String(S.list.length) })),
        h("div", { class: "kv" }, h("span", { text: "محمي من المسح التلقائي" }), h("b", { text: S.persisted ? "نعم" : "غير مضمون" })),
        !S.persisted ? h("div", { class: "muted", style: "margin-top:6px", text: "نصيحة: أضف التطبيق إلى الشاشة الرئيسية لحماية فواتيرك، وأرسلها للكمبيوتر بانتظام." }) : null)),
  ];
}

const VIEWS = { home: homeView, sync: syncView, view: viewView, settings: settingsView };

// ───────────────────────── الإقلاع ─────────────────────────
function fatal(text) {
  $app.replaceChildren(h("div", { class: "page" }, h("div", { class: "msg err", text })));
}

async function boot() {
  try {
    S.persisted = await requestPersistence();
    S.conn = (await kv.get("conn")) || null;
    S.snapshot = (await kv.get("snapshot")) || null;
    const savedLabel = await kv.get("deviceLabel");
    S.deviceLabel = savedLabel || `هاتف-${newId().slice(0, 4)}`;
    if (!savedLabel) await kv.set("deviceLabel", S.deviceLabel);
    S.list = await invStore.all();
  } catch (e) {
    fatal(`تعذر فتح التخزين المحلي على هذا المتصفح: ${e.message}. لن تُحفَظ الفواتير — جرّب Chrome أو Safari خارج وضع التصفح الخفي.`);
    return;
  }

  // رابط QR: https://ip:port/#k=KEY — الجزء بعد # لا يُرسَل للخادم أصلاً، ونمسحه من الشريط فوراً.
  let autoFetch = false;
  const m = location.hash.match(/[#&]k=([0-9a-fA-F]{64})/);
  if (m) {
    S.conn = { base: location.origin, key: m[1].toLowerCase() };
    await kv.set("conn", S.conn);
    history.replaceState(null, "", location.pathname);
    autoFetch = true;
  }

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    let had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (had) toast("تم تحديث التطبيق — أعد فتحه لتفعيل النسخة الجديدة", 6000);
      had = true;
    });
  }

  draw({ top: true });
  if (autoFetch) {
    await fetchBootstrap();
    if (S.syncMsg) toast(S.syncMsg.text, 5000);
  }
}

boot();
