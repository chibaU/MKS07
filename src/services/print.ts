// ============================================================================
// خدمة طباعة الفاتورة (مهمة 2/2). نقطة دخول واحدة مشتركة تُستخدَم من كل من:
//   - HomePage.tsx: زر "حفظ وطباعة" عند إغلاق فاتورة جديدة.
//   - InvoicesPage.tsx: زر "طباعة" لإعادة طباعة فاتورة مؤرشفة.
//
// **قرار مقصود يستحق التوثيق:** توثيق المهمة افترض أن بيانات كل طباعة متوفرة
// بالكامل بالذاكرة أصلاً (Draft الحالي أو selectedInvoice) بلا حاجة لأي
// استعلام DB جديد. بمراجعة الكود فعلياً وُجدت ثغرتان حقيقيتان بهذا الافتراض:
//   1) Draft لا يحمل تاريخ الفاتورة (invoice_date) بعد إنشائها إطلاقاً —
//      يُمرَّر مرة واحدة عند الإنشاء الأول ولا يُخزَّن بالمسودة نفسها.
//   2) InvoiceWithMerchant (المصدر الوحيد لـselectedInvoice) لم يكن يجلب
//      هاتف/عنوان التاجر أصلاً (أُصلحت الاستعلامات في db.ts بجانب هذا الملف).
// الحل الأبسط والأكثر أماناً لكلتا الثغرتين معاً: كلا مساري الطباعة يجلبان
// بيانات الفاتورة الكاملة والموثوقة عبر invoiceService.getInvoiceFullDetails
// مباشرة قبل التوليد — استعلام واحد خفيف، ويضمن تطابق المطبوع تماماً مع ما
// سيظهر لاحقاً في الأرشيف (لا اعتماد على حالة Draft المؤقتة بالذاكرة). هذا
// يبقى متوافقاً مع نية القرار المعماري الأصلي (لا استعلامات DB إضافية
// *متعددة*)، لكنه يصحح افتراضاً غير دقيق حول ما هو متوفر فعلاً بلا استعلام.
//
// **قرار مقصود (٢) — تغيير معماري لاحق:** التنفيذ الأول ولّد PDF عبر محرك
// رسم مخصَّص بالكامل (تشكيل نص عربي يدوي + رسم شبكة خلايا يدوياً). نجح ذاك
// المحرك تقنياً لكن تبيَّن أنه لا يطابق تنسيق القالب الأصلي طبق الأصل (لون
// الخط، المحاذاة العمودية، التفاف النص، الصور المضمَّنة — أي شيء لم تتم
// إعادة تنفيذه يدوياً). استُبدل بالكامل بهذا المسار: تعبئة القالب فقط، ثم
// فتح ملف xlsx الناتج بتطبيق الجداول الافتراضي (Excel أو LibreOffice Calc)
// — فيُطبَع من هناك يدوياً بمحرك عرض حقيقي يطبّق كل شيء بدقة تامة.
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoiceService, type InvoiceFullDetails } from "./db";
import { round2, formatMoney } from "../components/InvoiceShared";

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
}

interface GenerateInvoiceFileResult {
  path: string;
}

function buildPayload(full: InvoiceFullDetails): InvoicePrintPayload {
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
    // جاهزة للعرض؛ Rust يكتبها في الخلايا حرفياً (set_value_string) بلا تفسير.
    price: formatMoney(d.price),
    subtotal: formatMoney(d.subtotal), // مقرَّب مسبقاً عند الحفظ (round2) — راجع HomePage.tsx
    boxes: d.boxes.map((b) => `${b.box_name} ×${b.box_count}`).join("، "),
  }));

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
  };
}

/// يجلب بيانات الفاتورة الكاملة والموثوقة، يملأ القالب عبر أمر Rust، ثم يفتح
/// ملف xlsx الناتج بتطبيق الجداول الافتراضي على الجهاز (Excel أو LibreOffice
/// Calc) عبر tauri-plugin-opener — **لا طباعة صامتة أو برمجية إطلاقاً هنا**،
/// فقط فتح الملف؛ المستخدم من يضغط طباعة يدوياً من داخل ذلك التطبيق.
///
/// يُلقي (throw) رسالة خطأ عربية واضحة عند الفشل (قالب مفقود/فاسد، فاتورة
/// غير موجودة، إلخ) — على المستدعي (المكوّن) عرضها للمستخدم بطريقته المعتادة
/// (alert/toast)، بدل فشل صامت.
export async function printInvoice(invoiceId: number): Promise<void> {
  const full = await invoiceService.getInvoiceFullDetails(invoiceId);
  if (!full) {
    throw new Error("تعذّر العثور على بيانات هذه الفاتورة لطباعتها.");
  }
  if (full.details.length === 0) {
    throw new Error("هذه الفاتورة لا تحتوي على أي بنود — لا يمكن طباعتها.");
  }

  const payload = buildPayload(full);

  const result = await invoke<GenerateInvoiceFileResult>("generate_invoice_file", {
    data: payload,
  });

  await openPath(result.path);
}