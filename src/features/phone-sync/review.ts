// ============================================================================
// مراجعة الفاتورة القادمة من الهاتف قبل الحفظ (المتطلبات 12–16).
//
// دوال نقية بلا أي وصول لقاعدة البيانات أو لـ Tauri: تأخذ حمولة الهاتف + بيانات
// الكمبيوتر الحالية (تجار/صناديق) وتُنتج «النتيجة النهائية» التي سيحفظها النظام
// مع التعارضات والتحذيرات. الحماية الحقيقية تتكرر لحظة التأكيد بإعادة استدعاء
// buildReview ببيانات طازجة (انظر ReviewPanel).
//
// قواعد الحساب مطابقة لـ MKS الحالي (AI_CONTEXT.md القسم 6.1):
//   وزن الصناديق = Σ (عدد × الوزن الحالي في قاعدة الكمبيوتر)
//   الوزن الصافي = round2(وزن الميزان − وزن الصناديق)  — سالب = تعارض
//   subtotal = round2(الصافي × السعر) ، الإجمالي = round2(Σ الصافي × السعر)
// ============================================================================

import { round2 } from "../../components/InvoiceShared";

// ───────────────────────── الحمولة القادمة من الهاتف (غير موثوقة) ─────────────────────────

export interface PhoneBoxSel {
  boxId: number;
  boxCount: number;
  nameHint?: string;
  weightHint?: number;
}

export interface PhoneLine {
  productName: string;
  scaleWeight: number;
  price: number;
  boxes: PhoneBoxSel[];
}

export interface PhonePayload {
  id: string;
  invoiceDate: string;
  merchantId: number;
  merchantNameHint?: string;
  lines: PhoneLine[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPosInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v > 0;

/** يحوّل JSON الخام إلى حمولة مُنمَّطة، أو يُرجع سبب التلف. لا يرمي أبداً. */
export function parsePayload(raw: unknown): { ok: true; payload: PhonePayload } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: "بيانات الفاتورة تالفة (ليست كائناً)" };
  if (typeof raw.id !== "string" || raw.id === "") return { ok: false, error: "معرّف الفاتورة مفقود" };
  if (typeof raw.invoiceDate !== "string") return { ok: false, error: "تاريخ الفاتورة مفقود" };
  if (!isPosInt(raw.merchantId)) return { ok: false, error: "التاجر غير محدَّد في الفاتورة" };
  if (!Array.isArray(raw.lines)) return { ok: false, error: "بنود الفاتورة مفقودة" };

  const lines: PhoneLine[] = [];
  for (const [i, l] of raw.lines.entries()) {
    if (!isObj(l)) return { ok: false, error: `البند ${i + 1} تالف` };
    if (typeof l.productName !== "string") return { ok: false, error: `البند ${i + 1}: اسم المنتج مفقود` };
    if (!isNum(l.scaleWeight)) return { ok: false, error: `البند ${i + 1}: وزن الميزان غير صالح` };
    if (!isNum(l.price)) return { ok: false, error: `البند ${i + 1}: السعر غير صالح` };
    if (!Array.isArray(l.boxes)) return { ok: false, error: `البند ${i + 1}: الصناديق مفقودة` };
    const boxes: PhoneBoxSel[] = [];
    for (const b of l.boxes) {
      if (!isObj(b) || !isNum(b.boxId) || !isNum(b.boxCount)) {
        return { ok: false, error: `البند ${i + 1}: صندوق غير صالح` };
      }
      boxes.push({
        boxId: b.boxId,
        boxCount: b.boxCount,
        nameHint: typeof b.nameHint === "string" ? b.nameHint : undefined,
        weightHint: isNum(b.weightHint) ? b.weightHint : undefined,
      });
    }
    lines.push({ productName: l.productName, scaleWeight: l.scaleWeight, price: l.price, boxes });
  }
  return {
    ok: true,
    payload: {
      id: raw.id,
      invoiceDate: raw.invoiceDate,
      merchantId: raw.merchantId,
      merchantNameHint: typeof raw.merchantNameHint === "string" ? raw.merchantNameHint : undefined,
      lines,
    },
  };
}

// ───────────────────────── نتيجة المراجعة ─────────────────────────

export interface CurrentMerchant { id: number; name: string }
export interface CurrentBox { id: number; name: string; weight: number; is_visible: number }

export interface ReviewBox {
  boxId: number;
  boxCount: number;
  exists: boolean;
  name: string;
  weight: number; // الوزن الحالي في الكمبيوتر (0 إن لم يعد الصندوق موجوداً)
  hidden: boolean;
  emptiesWeight: number; // boxCount × weight
}

export interface ReviewLine {
  index: number; // 1-based
  productName: string;
  scaleWeight: number;
  price: number;
  boxes: ReviewBox[];
  emptiesWeight: number;
  netWeight: number;
  subtotal: number;
  problems: string[]; // تعارضات تمنع الاعتماد
  warnings: string[];
}

export interface Review {
  clientId: string;
  invoiceDate: string;
  merchant: { id: number; exists: boolean; name: string };
  lines: ReviewLine[];
  totalNet: number;
  totalBoxes: number;
  total: number;
  conflicts: string[]; // على مستوى الفاتورة (بنود كل بند في ReviewLine.problems)
  warnings: string[];
  /** true فقط إن لم يوجد أي تعارض في الفاتورة أو بنودها. */
  canConfirm: boolean;
}

const PRICE_MAX = 999_999_999; // نفس حد MoneyInput (9 أرقام)
const SCALE_MAX = 1_000_000;
const PRODUCT_MAX = 200;
const fmt = (n: number) => round2(n).toFixed(2);

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** today بصيغة YYYY-MM-DD محلياً — تُمرَّر للاختبار. */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function buildReview(
  p: PhonePayload,
  merchants: CurrentMerchant[],
  boxes: CurrentBox[],
  today: string = localToday(),
): Review {
  const conflicts: string[] = [];
  const warnings: string[] = [];

  // ── التاجر: يُؤخَذ من قاعدة الكمبيوتر الحالية ولا يُنشأ بديل تلقائياً (المتطلبان 15 و27) ──
  const m = merchants.find((x) => x.id === p.merchantId);
  if (!m) {
    conflicts.push(
      `التاجر${p.merchantNameHint ? ` «${p.merchantNameHint}»` : ""} (رقم ${p.merchantId}) لم يعد موجوداً في النظام. ` +
        "لن يُنشأ تاجر بديل تلقائياً — ارفض الفاتورة أو أعد إنشاء التاجر ثم أعد الفحص.",
    );
  } else if (p.merchantNameHint && p.merchantNameHint.trim() !== m.name.trim()) {
    warnings.push(`اسم التاجر تغيّر: «${p.merchantNameHint}» ← «${m.name}» (سيُستخدَم الاسم الحالي).`);
  }

  // ── التاريخ ──
  if (!isRealDate(p.invoiceDate)) {
    conflicts.push(`تاريخ الفاتورة غير صالح: «${p.invoiceDate}».`);
  } else if (p.invoiceDate > today) {
    warnings.push(`تاريخ الفاتورة (${p.invoiceDate}) في المستقبل.`);
  } else {
    const [ty, tm, td] = today.split("-").map(Number);
    const limit = new Date(Date.UTC(ty - 1, tm - 1, td)).toISOString().slice(0, 10);
    if (p.invoiceDate < limit) warnings.push(`تاريخ الفاتورة (${p.invoiceDate}) أقدم من سنة.`);
  }

  if (p.lines.length === 0) conflicts.push("الفاتورة بلا أي بند.");

  const boxById = new Map(boxes.map((b) => [b.id, b]));

  // ── البنود: إعادة الحساب ببيانات الكمبيوتر الحالية (المتطلبان 12 و13) ──
  let totalNet = 0;
  let totalBoxes = 0;
  let totalRaw = 0;

  const lines: ReviewLine[] = p.lines.map((l, i) => {
    const problems: string[] = [];
    const lineWarnings: string[] = [];

    const name = l.productName.trim();
    if (name === "") problems.push("اسم المنتج فارغ.");
    else if (name.length > PRODUCT_MAX) problems.push(`اسم المنتج أطول من ${PRODUCT_MAX} حرفاً.`);

    if (!(l.scaleWeight >= 0) || l.scaleWeight > SCALE_MAX) problems.push(`وزن الميزان غير صالح (${l.scaleWeight}).`);
    else if (l.scaleWeight === 0) lineWarnings.push("وزن الميزان صفر.");

    if (!Number.isInteger(l.price) || l.price < 0 || l.price > PRICE_MAX) {
      problems.push(`السعر غير صالح (${l.price}) — يجب أن يكون عدداً صحيحاً من الدنانير بين 0 و${PRICE_MAX}.`);
    }

    const seen = new Set<number>();
    const rbs: ReviewBox[] = l.boxes.map((b) => {
      const cur = boxById.get(b.boxId);
      if (!isPosInt(b.boxCount)) problems.push(`عدد الصناديق غير صالح (${b.boxCount}).`);
      if (seen.has(b.boxId)) problems.push(`الصندوق رقم ${b.boxId} مكرَّر في نفس البند.`);
      seen.add(b.boxId);

      if (!cur) {
        problems.push(
          `الصندوق${b.nameHint ? ` «${b.nameHint}»` : ""} (رقم ${b.boxId}) لم يعد موجوداً في النظام. لن يُنشأ صندوق بديل تلقائياً.`,
        );
      } else {
        if (cur.is_visible === 0) {
          // الصندوق المخفي صالح (المتطلب 15) — تنبيه معلوماتي فقط.
          lineWarnings.push(`الصندوق «${cur.name}» مخفي حالياً (يبقى صالحاً للاستخدام).`);
        }
        if (b.weightHint !== undefined && Math.abs(b.weightHint - cur.weight) > 1e-9) {
          lineWarnings.push(
            `وزن الصندوق «${cur.name}» تغيّر: ${fmt(b.weightHint)} ← ${fmt(cur.weight)} كغ (سيُستخدَم ${fmt(cur.weight)}).`,
          );
        }
        if (b.nameHint && b.nameHint.trim() !== cur.name.trim()) {
          lineWarnings.push(`اسم الصندوق تغيّر: «${b.nameHint}» ← «${cur.name}».`);
        }
      }

      const weight = cur ? cur.weight : 0;
      const count = isPosInt(b.boxCount) ? b.boxCount : 0;
      return {
        boxId: b.boxId,
        boxCount: b.boxCount,
        exists: !!cur,
        name: cur ? cur.name : b.nameHint || `صندوق #${b.boxId}`,
        weight,
        hidden: cur ? cur.is_visible === 0 : false,
        emptiesWeight: round2(count * weight),
      };
    });

    const empties = rbs.reduce((s, b) => s + (isPosInt(b.boxCount) ? b.boxCount * b.weight : 0), 0);
    const net = round2(l.scaleWeight - empties);
    if (empties > l.scaleWeight + 1e-9) {
      problems.push(
        `وزن الصناديق الحالي (${fmt(empties)} كغ) يفوق وزن الميزان (${fmt(l.scaleWeight)} كغ) — الوزن الصافي سيصبح سالباً (${fmt(net)}).`,
      );
    }
    const price = Number.isFinite(l.price) ? l.price : 0;
    const subtotal = round2(net * price);

    totalNet += net;
    totalBoxes += rbs.reduce((s, b) => s + (isPosInt(b.boxCount) ? b.boxCount : 0), 0);
    totalRaw += net * price;

    return {
      index: i + 1,
      productName: name,
      scaleWeight: l.scaleWeight,
      price,
      boxes: rbs,
      emptiesWeight: round2(empties),
      netWeight: net,
      subtotal,
      problems,
      warnings: lineWarnings,
    };
  });

  const total = round2(totalRaw);
  const canConfirm = conflicts.length === 0 && lines.every((l) => l.problems.length === 0);

  return {
    clientId: p.id,
    invoiceDate: p.invoiceDate,
    merchant: { id: p.merchantId, exists: !!m, name: m ? m.name : p.merchantNameHint || `تاجر #${p.merchantId}` },
    lines,
    totalNet: round2(totalNet),
    totalBoxes,
    total,
    conflicts,
    warnings,
    canConfirm,
  };
}

/** يحوّل نتيجة مراجعة سليمة إلى مُدخَل db.ts (phoneImportService.importInvoice). */
export function toImportInput(r: Review) {
  return {
    clientId: r.clientId,
    merchantId: r.merchant.id,
    invoiceDate: r.invoiceDate,
    totalAmount: r.total,
    lines: r.lines.map((l) => ({
      productName: l.productName,
      quantity: l.netWeight,
      price: l.price,
      subtotal: l.subtotal,
      boxes: l.boxes.map((b) => ({ box_id: b.boxId, box_count: b.boxCount })),
    })),
  };
}
