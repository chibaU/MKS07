// ============================================================================
// التحقق وإعادة الحساب — المنطق الصافي لقواعد المراجعة (بلا React ولا قاعدة بيانات).
//
// القاعدة الحاكمة (القسمان 12 و13 من المتطلبات): الفاتورة القادمة من الهاتف لا تُعتمَد
// بقيمها هي. كل شيء يُعاد حسابه هنا من **بيانات الكمبيوتر الحالية** (اسم التاجر،
// أوزان الصناديق...) وفق قواعد MKS الحالية:
//   الوزن الصافي = round2(وزن الميزان − Σ(عدد الصناديق × وزن الصندوق الحالي))
//   إجمالي السطر = round2(الصافي × السعر)
//   الإجمالي الكلي = round2(Σ(الصافي × السعر))   ← جمع خام ثم تقريب مرة واحدة
//                    (نفس منطق InvoiceForm/print.ts تماماً)
// والحالات التي تمنع الاعتماد ("تعارضات") لا تُصلَح تلقائياً أبداً — تُعرَض للمستخدم.
//
// round2 تُمرَّر من الخارج (حقن) لتبقى دالة التقريب الوحيدة في المشروع هي المعتمدة
// (components/InvoiceShared.tsx) دون أن يستورد هذا الملف أي شيء — فيُختبَر بمعزل.
// ============================================================================

import type { WireInvoice } from "../types.ts";

export interface RefMerchant {
  id: number;
  name: string;
}

export interface RefBox {
  id: number;
  name: string;
  weight: number;
  isVisible: boolean;
}

export interface ReferenceData {
  merchants: Map<number, RefMerchant>;
  boxes: Map<number, RefBox>;
}

export type IssueLevel = "conflict" | "warning" | "info";

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  lineIndex?: number;
}

export interface ReviewBox {
  boxId: number;
  boxName: string | null;
  boxCount: number;
  emptyWeight: number | null;
  hidden: boolean;
  missing: boolean;
  totalWeight: number;
}

export interface ReviewLine {
  index: number;
  productName: string;
  scaleWeight: number;
  price: number;
  boxes: ReviewBox[];
  totalEmptyWeight: number;
  netWeight: number;
  subtotal: number;
  phoneNetWeight: number | null;
  phoneSubtotal: number | null;
}

export interface ReviewResult {
  uid: string;
  merchantId: number;
  merchantName: string | null;
  merchantMissing: boolean;
  phoneMerchantName: string | null;
  invoiceDate: string;
  lines: ReviewLine[];
  totalNetWeight: number;
  totalBoxes: number;
  grandTotal: number;
  phoneTotal: number | null;
  issues: Issue[];
  conflictCount: number;
  warningCount: number;
  canConfirm: boolean;
}

export interface ReviewOptions {
  round2: (n: number) => number;
  /** تاريخ اليوم المحلي بصيغة YYYY-MM-DD (يُمرَّر للاختبار الحتمي). */
  today: string;
}

const EPS = 0.005;
export const DATE_OLD_DAYS = 45;
export const DATE_FUTURE_DAYS = 1;

export function parseIsoDate(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2100) return null;
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t;
}

const DAY_MS = 86_400_000;

function fmt(n: number): string {
  return n.toFixed(2);
}

export function buildReview(inv: WireInvoice, ref: ReferenceData, opts: ReviewOptions): ReviewResult {
  const { round2 } = opts;
  const issues: Issue[] = [];
  const push = (level: IssueLevel, code: string, message: string, lineIndex?: number) =>
    issues.push({ level, code, message, ...(lineIndex === undefined ? {} : { lineIndex }) });

  // ── التاريخ ──
  const dateMs = parseIsoDate(inv.invoiceDate);
  if (dateMs === null) {
    push("conflict", "invalid_date", `تاريخ الفاتورة غير صالح (${inv.invoiceDate})`);
  } else {
    const todayMs = parseIsoDate(opts.today);
    if (todayMs !== null) {
      const diffDays = Math.round((dateMs - todayMs) / DAY_MS);
      if (diffDays > DATE_FUTURE_DAYS) {
        push("warning", "date_future", `تاريخ الفاتورة (${inv.invoiceDate}) في المستقبل — تحقّق من ساعة الهاتف`);
      } else if (diffDays < -DATE_OLD_DAYS) {
        push("warning", "date_old", `تاريخ الفاتورة قديم (${inv.invoiceDate}) — سيُرقَّم رقمها حسب شهر هذا التاريخ`);
      }
    }
  }

  // ── التاجر (مرجع: merchantId فقط؛ الاسم الحالي من الكمبيوتر) ──
  const merchant = ref.merchants.get(inv.merchantId) ?? null;
  const phoneMerchantName = inv.merchantNameHint?.trim() || null;
  if (!merchant) {
    push(
      "conflict",
      "merchant_missing",
      `التاجر${phoneMerchantName ? ` «${phoneMerchantName}»` : ""} (معرّف ${inv.merchantId}) لم يعد موجوداً في النظام`,
    );
  } else if (phoneMerchantName && phoneMerchantName !== merchant.name.trim()) {
    push("info", "merchant_renamed", `تغيّر اسم التاجر منذ آخر مزامنة: «${phoneMerchantName}» ← «${merchant.name}» (يُستخدم الاسم الحالي)`);
  }

  // ── البنود ──
  if (inv.lines.length === 0) push("conflict", "no_lines", "الفاتورة بلا بنود");

  const lines: ReviewLine[] = inv.lines.map((l, index) => {
    const n = index + 1;
    const productName = l.productName.trim();
    if (!productName) push("conflict", "product_empty", `اسم المنتج فارغ في البند ${n}`, index);

    const scaleWeight = round2(l.scaleWeight);
    if (!Number.isFinite(l.scaleWeight) || l.scaleWeight < 0) {
      push("conflict", "invalid_weight", `وزن الميزان غير صالح في البند ${n}`, index);
    }
    if (!Number.isFinite(l.price) || l.price < 0 || !Number.isInteger(l.price)) {
      push("conflict", "invalid_price", `السعر في البند ${n} يجب أن يكون عدداً صحيحاً (دينار) غير سالب`, index);
    }

    const seen = new Set<number>();
    const boxes: ReviewBox[] = [];
    for (const b of l.boxes) {
      if (!Number.isInteger(b.boxCount) || b.boxCount < 0) {
        push("conflict", "invalid_box_count", `عدد الصناديق غير صالح في البند ${n}`, index);
        continue;
      }
      if (b.boxCount === 0) continue; // لا أثر له
      if (seen.has(b.boxId)) {
        push("conflict", "duplicate_box", `الصندوق #${b.boxId} مكرّر داخل البند ${n}`, index);
        continue;
      }
      seen.add(b.boxId);
      const box = ref.boxes.get(b.boxId) ?? null;
      if (!box) {
        push("conflict", "box_missing", `الصندوق #${b.boxId} المستخدم في البند ${n} لم يعد موجوداً في النظام`, index);
        boxes.push({ boxId: b.boxId, boxName: null, boxCount: b.boxCount, emptyWeight: null, hidden: false, missing: true, totalWeight: 0 });
        continue;
      }
      // مخفي ≠ غير صالح (القسم 15): يُقبل، مع ملاحظة معلوماتية فقط.
      if (!box.isVisible) {
        push("info", "hidden_box", `الصندوق «${box.name}» مخفي حالياً — مقبول، لا يمنع الاعتماد`, index);
      }
      boxes.push({
        boxId: box.id,
        boxName: box.name,
        boxCount: b.boxCount,
        emptyWeight: box.weight,
        hidden: !box.isVisible,
        missing: false,
        totalWeight: b.boxCount * box.weight,
      });
    }

    const totalEmptyRaw = boxes.reduce((s, b) => s + b.totalWeight, 0);
    const totalEmptyWeight = round2(totalEmptyRaw);
    // نفس شرط المنع في الإدخال اليدوي (boxesExceedScale): الصناديق > وزن الميزان.
    if (totalEmptyRaw > scaleWeight) {
      push(
        "conflict",
        "net_negative",
        `الوزن الصافي سالب في البند ${n}: وزن الصناديق الحالي (${fmt(totalEmptyWeight)}) يتجاوز وزن الميزان (${fmt(scaleWeight)})`,
        index,
      );
    }
    const netWeight = round2(scaleWeight - totalEmptyRaw);
    const price = l.price;
    const subtotal = round2(netWeight * price);

    if (netWeight === 0 && !issues.some((i) => i.lineIndex === index && i.level === "conflict")) {
      push("warning", "net_zero", `الوزن الصافي في البند ${n} يساوي صفراً`, index);
    }

    const phoneNet = l.phoneNetWeight ?? null;
    const phoneSub = l.phoneSubtotal ?? null;
    if (phoneNet !== null && Math.abs(phoneNet - netWeight) > EPS) {
      push(
        "warning",
        "net_changed",
        `الوزن الصافي في البند ${n} تغيّر عمّا حسبه الهاتف (${fmt(phoneNet)} ← ${fmt(netWeight)}) بسبب بيانات الكمبيوتر الحالية`,
        index,
      );
    } else if (phoneSub !== null && Math.abs(phoneSub - subtotal) > EPS) {
      push("warning", "subtotal_changed", `إجمالي البند ${n} تغيّر عمّا حسبه الهاتف (${fmt(phoneSub)} ← ${fmt(subtotal)})`, index);
    }

    return {
      index,
      productName,
      scaleWeight,
      price,
      boxes,
      totalEmptyWeight,
      netWeight,
      subtotal,
      phoneNetWeight: phoneNet,
      phoneSubtotal: phoneSub,
    };
  });

  const totalNetWeight = round2(lines.reduce((s, l) => s + l.netWeight, 0));
  const totalBoxes = lines.reduce((s, l) => s + l.boxes.reduce((x, b) => x + b.boxCount, 0), 0);
  const grandTotal = round2(lines.reduce((s, l) => s + l.netWeight * l.price, 0));
  const phoneTotal = inv.phoneTotal ?? null;
  if (phoneTotal !== null && Math.abs(phoneTotal - grandTotal) > EPS && !issues.some((i) => i.code === "net_changed" || i.code === "subtotal_changed")) {
    push("warning", "total_changed", `الإجمالي تغيّر عمّا حسبه الهاتف (${fmt(phoneTotal)} ← ${fmt(grandTotal)})`);
  }

  const conflictCount = issues.filter((i) => i.level === "conflict").length;
  const warningCount = issues.filter((i) => i.level === "warning").length;
  // التعارضات أولاً ثم التحذيرات ثم المعلومات.
  const order: Record<IssueLevel, number> = { conflict: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);

  return {
    uid: inv.uid,
    merchantId: inv.merchantId,
    merchantName: merchant?.name ?? null,
    merchantMissing: !merchant,
    phoneMerchantName,
    invoiceDate: inv.invoiceDate,
    lines,
    totalNetWeight,
    totalBoxes,
    grandTotal,
    phoneTotal,
    issues,
    conflictCount,
    warningCount,
    canConfirm: conflictCount === 0 && lines.length > 0,
  };
}

// ───────── التحويل إلى شكل الإدراج في قاعدة MKS (يطابق CreateInvoiceDetail) ─────────

export interface DetailToSave {
  product_name: string;
  quantity: number;
  price: number;
  subtotal: number;
  boxes: { box_id: number; box_count: number }[];
}

/** نفس ما يبنيه handleInsertRow في HomePage للبند اليدوي: الصافي كمية، وsubtotal مقرَّب. */
export function toDetailsToSave(review: ReviewResult): DetailToSave[] {
  return review.lines.map((l) => ({
    product_name: l.productName,
    quantity: l.netWeight,
    price: l.price,
    subtotal: l.subtotal,
    boxes: l.boxes.filter((b) => !b.missing && b.boxCount > 0).map((b) => ({ box_id: b.boxId, box_count: b.boxCount })),
  }));
}

/** total_amount المخزَّن بعد إضافة البنود الأولى i+1 — نفس حساب HomePage (جمع خام ثم round2). */
export function runningTotals(review: ReviewResult, round2: (n: number) => number): number[] {
  const out: number[] = [];
  let raw = 0;
  for (const l of review.lines) {
    raw += l.netWeight * l.price;
    out.push(round2(raw));
  }
  return out;
}
