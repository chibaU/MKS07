// ============================================================================
// طباعة الفاتورة — واجهة رقيقة فوق محرك الطباعة العام (src/print/). تُستدعى من:
//   - HomePage.tsx: أزرار «طباعة» / «طباعة مع الملخّص» للفاتورة المفتوحة.
//   - InvoicesPage.tsx: «طباعة» في الأرشيف.
//
// البيانات تُجلَب طازجة وموثوقة من القاعدة (invoiceService.getInvoiceFullDetails)
// عند كل طباعة، فيتطابق المطبوع تماماً مع ما في الأرشيف لا مع حالة مسودة مؤقتة.
// بيانات الوزّان (خاتمة الفاتورة) تُقرأ طازجة أيضاً من الإعدادات؛ فشل قراءتها لا
// يمنع الطباعة (تُطبَع الفاتورة بلا خاتمة الوزّان).
//
// ⚠️ في وضع «نافذة النظام» تُنجَز الوعدة عند **فتح** النافذة لا عند انتهاء الطباعة:
// لا توجد إشارة اكتمال ولا إلغاء من WebView2. أي استدعاء يفترض «طُبعت فعلاً»
// يجب مراجعته (راجع PRINTING.md).
// ============================================================================

import { invoiceService, type InvoiceFullDetails } from "./db";
import { round2, formatMoney } from "../components/InvoiceShared";
import { calculateRepeatedProductSummaries, type RepeatedProductSummary } from "./repeatedProductsSummary";
import { loadWeigherInfo } from "./weigherSettings";
import { printDocument } from "../print";
import { EMPTY_WEIGHER, type WeigherInfo } from "../print/weigher.ts";
import type { InvoiceA4Data } from "../print/documents/InvoiceA4.tsx";

interface InvoiceLineItemPayload {
  product: string;
  weight: string;
  price: string;
  subtotal: string;
  boxes: string;
}

interface InvoicePrintPayload {
  invoiceNumber: string;
  invoiceDate: string;
  merchantName: string;
  merchantPhone: string;
  merchantAddress: string;
  grandTotal: string;
  totalWeight: string;
  totalBoxes: string;
  items: InvoiceLineItemPayload[];
  /** فارغ ما لم يُطلَب الملخّص صراحةً. */
  repeatedProductSummary: RepeatedProductSummary[];
}

function buildPayload(full: InvoiceFullDetails, includeRepeatedProductSummary: boolean): InvoicePrintPayload {
  // الإجمالي الكلي: **نفس منطق InvoiceForm.tsx تماماً** — مجموع كل
  // (الوزن × السعر) الخام أولاً، ثم round2 مرة واحدة على المجموع. عمداً لا
  // نستخدم عمود subtotal المخزَّن لكل بند (مقرَّب مسبقاً فردياً عند الحفظ —
  // راجع HomePage.tsx) لحساب الإجمالي، لأن round2(مجموع مقرَّبات فردية) قد
  // يختلف عن round2(مجموع خام) في حالات نادرة بفروق تقريب — والمعيار الصريح
  // هنا مطابقة تامة لما ظهر على الشاشة عند الإغلاق، لا مجرد قيمة قريبة.
  const grandTotal = round2(
    full.details.reduce((sum, d) => sum + d.quantity * d.price, 0),
  );
  const totalWeight = round2(full.details.reduce((sum, d) => sum + d.quantity, 0));
  const totalBoxes = full.details.reduce(
    (sum, d) => sum + d.boxes.reduce((s2, b) => s2 + b.box_count, 0),
    0,
  );

  const items: InvoiceLineItemPayload[] = full.details.map((d) => ({
    product: d.product_name,
    weight: d.quantity.toFixed(2), // نفس تنسيق عرض الوزن في InvoiceForm.tsx
    // كل المبالغ بصيغة نظام المال الموحَّدة "100.000,00" (formatMoney) — نصوص
    // جاهزة للعرض؛ المستند يرسمها حرفياً بلا تفسير.
    price: formatMoney(d.price),
    subtotal: formatMoney(d.subtotal), // مقرَّب مسبقاً عند الحفظ (round2) — راجع HomePage.tsx
    boxes: d.boxes.map((b) => `${b.box_name} ×${b.box_count}`).join("\n"),
  }));

  // المصدر هنا هو *النص المطبوع* لكل وزن ومبلغ، لا الأعداد العشرية الخام.
  // وهكذا يطابق مجموع الملخّص ما يجمعه قارئ الفاتورة يدوياً حرفياً.
  const repeatedProductSummary = includeRepeatedProductSummary
    ? calculateRepeatedProductSummaries(
        full.details.map((d) => ({
          product: d.product_name,
          weight: d.quantity.toFixed(2),
          subtotal: formatMoney(d.subtotal),
        })),
      )
    : [];

  return {
    invoiceNumber: full.invoice_number ?? "",
    invoiceDate: full.invoice_date ?? "",
    merchantName: full.merchant_name ?? "",
    merchantPhone: full.merchant_phone ?? "",
    merchantAddress: full.merchant_address ?? "",
    grandTotal: formatMoney(grandTotal),
    totalWeight: totalWeight.toFixed(2),
    totalBoxes: String(totalBoxes),
    items,
    repeatedProductSummary,
  };
}

/**
 * يجلب بيانات الفاتورة الكاملة والموثوقة ويطبعها بحسب إعدادات الطباعة المحفوظة
 * (نافذة النظام أو مباشرة). تُلقي خطأً عربياً واضحاً (Error.message جاهزة للعرض) إن
 * لم توجد الفاتورة أو خلت من البنود أو فشلت الطباعة.
 */
export async function printInvoice(
  invoiceId: number,
  includeRepeatedProductSummary = false,
): Promise<void> {
  const full = await invoiceService.getInvoiceFullDetails(invoiceId);
  if (!full) {
    throw new Error("تعذّر العثور على بيانات هذه الفاتورة لطباعتها.");
  }
  if (full.details.length === 0) {
    throw new Error("هذه الفاتورة لا تحتوي على أي بنود — لا يمكن طباعتها.");
  }

  let weigher: WeigherInfo = EMPTY_WEIGHER;
  try {
    weigher = await loadWeigherInfo();
  } catch (error) {
    console.error("تعذّرت قراءة بيانات الوزّان — ستُطبَع الفاتورة بلا خاتمة الوزّان:", error);
  }

  const data: InvoiceA4Data = { ...buildPayload(full, includeRepeatedProductSummary), weigher };
  await printDocument({
    type: "invoice",
    title: `فاتورة ${full.invoice_number ?? `#${full.id}`}`,
    data,
  });
}
