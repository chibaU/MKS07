import type { Box, InvoiceFullDetails } from "../services/db";
import type { Draft, DraftRow, DraftRowBox } from "./invoice";

// ── دالة مساعدة لبناء مسودة فاتورة جديدة بناءً على الصناديق المتاحة ──
// تُستخدم من App.tsx و HomePage.tsx
export function makeDraft(id: string, realBoxes: Box[]): Draft {
  return {
    id,
    merchantName: "",
    productInput: "",
    scaleWeightInput: "",
    priceInput: "",
    boxes: realBoxes.map((b) => ({
      id: b.id,
      name: b.name,
      emptyWeight: b.weight,
      countInput: 0,
    })),
    rows: [],
    invoiceId: null,
    invoiceNumberInput: "",
    isNumberLocked: false,
    isSavingLine: false,
    isClosing: false,
  };
}

// ── بناء مسودة كاملة من فاتورة مُحمَّلة فعلياً من القاعدة (القسم 6) ──
// مسار موحَّد واحد ستستخدمه لاحقاً ثلاثة مصادر مختلفة (الجزء الثاني):
// الاسترجاع عند الإقلاع (getOpenInvoices)، فتح فاتورة من الأرشيف
// (getInvoiceFullDetails)، وتحميل فاتورة عبر حقل الرقم (getInvoiceFullDetailsByNumber).
export function draftFromInvoice(
  invoice: InvoiceFullDetails,
  realBoxes: Box[]
): Draft {
  const rows: DraftRow[] = invoice.details.map((detail) => ({
    id: detail.id, // معرّف حقيقي من القاعدة، لا معرّف محلي مؤقت
    product: detail.product_name,
    productId: null,
    weight: detail.quantity, // الوزن الصافي المخزَّن فعلياً
    price: detail.price,
    boxesSnapshot: detail.boxes.map(
      (box): DraftRowBox => ({
        id: box.box_id,
        boxCount: box.box_count,
      })
    ),
  }));

  return {
    id: `inv${invoice.id}`,
    merchantName: invoice.merchant_name ?? "",
    merchantId: invoice.merchant_id ?? undefined,
    productInput: "",
    scaleWeightInput: "",
    priceInput: "",
    boxes: realBoxes.map((b) => ({
      id: b.id,
      name: b.name,
      emptyWeight: b.weight,
      countInput: 0,
    })),
    rows,
    invoiceId: invoice.id,
    invoiceNumberInput: invoice.invoice_number ?? "",
    isNumberLocked: true,
    isSavingLine: false,
    isClosing: false,
  };
}