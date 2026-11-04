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
//
// **قرار مقصود (٣) — تحديث لاحق يُلغي جزئياً القرار رقم ٢ أعلاه:** بطلب
// صريح لاحق من صاحب المشروع، الشرط الفعلي لم يكن "ممنوع أي طباعة صامتة"
// كمبدأ مطلق، بل تحديداً: **لا تظهر نافذة LibreOffice أو Excel نفسها** (أي
// نافذة أخرى، كحوار طباعة نظام التشغيل، كانت لتكون مقبولة لو احتجناها).
// `printInvoice` أدناه الآن تطبع مباشرة وصامتة عبر أمر Rust جديد
// (`print_invoice_direct`، راجع الملاحظة المعمارية في invoice_template.rs)
// يشغّل LibreOffice في وضع `--headless` من سطر الأوامر — بلا فتح أي تطبيق
// جداول مرئي إطلاقاً، وبلا حتى حوار طباعة (طباعة صامتة كاملة على الطابعة
// المختارة في الإعدادات، أو طابعة النظام الافتراضية).
// **مسار احتياطي متعمَّد:** لو فشلت الطباعة الصامتة (LibreOffice غير مثبَّت
// على جهاز المستخدم، طابعة غير موجودة بهذا الاسم، إلخ)، نرجع تلقائياً للمسار
// القديم (توليد الملف ثم فتحه بتطبيق الجداول الافتراضي عبر `openPath`) بدل
// إفشال الطباعة بالكامل بصمت — مع رسالة توضيحية للمستخدم عبر الخطأ المُلقى.
//
// **قرار مقصود (٤) — نافذة الطباعة (Print Dialog) قبل الطباعة، بطلب صريح لاحق:**
// لم تعد `printInvoice` تطبع فوراً على الطابعة المحفوظة؛ تعرض أولاً نافذة الطباعة
// القياسية لويندوز (أمر Rust `print_dialog_show`، راجع print_dialog.rs) ليختار
// المستخدم الطابعة وعدد النسخ، ثم تطبع بالمسار الصامت نفسه على اختياره
// (`print_invoice_chosen`). "إلغاء" = لا طباعة ولا رسالة خطأ. الطابعة المحفوظة في
// الإعدادات صارت **الاختيار الأولي** داخل النافذة فقط. إن تعذّر إظهار النافذة
// تقنياً (أو على Linux، جهاز التطوير) يُستخدَم `print_invoice_direct` القديم كما
// كان تماماً، فلا يتعطل أي شيء. الطباعات تُسلسَل بطابور (نافذة واحدة في كل مرة).
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoiceService, type InvoiceFullDetails, settingsService, SETTINGS_KEY_PRINTER_NAME } from "./db";
import { round2, formatMoney } from "../components/InvoiceShared";
import { calculateRepeatedProductSummaries, type RepeatedProductSummary } from "./repeatedProductsSummary";

interface InvoiceLineItemPayload {
  product: string;
  weight: string;
  price: string;
  subtotal: string;
  boxes: string;
}

export interface InvoicePrintPayload {
  invoiceNumber: string;
  invoiceDate: string;
  merchantName: string;
  merchantPhone: string;
  merchantAddress: string;
  grandTotal: string;
  totalWeight: string;
  totalBoxes: string;
  items: InvoiceLineItemPayload[];
  /** اختيارية حتى تبقى طباعة الزر القديم مطابقة تماماً للسلوك السابق. */
  repeatedProductSummary: RepeatedProductSummary[];
}

interface GenerateInvoiceFileResult {
  path: string;
}

// مُصدَّرة (export) فقط كي تعيد الطباعة الجماعية (batchPrint.ts) استخدام
// المنطق نفسه حرفياً بدل نسخه — لا تغيير في أي سلوك. المسار العادي
// (printInvoice) لم يتغيّر.
export function buildPayload(full: InvoiceFullDetails, includeRepeatedProductSummary = false): InvoicePrintPayload {
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

/// نتيجة أمر \`print_invoice_with_dialog\` (راجع print_dialog.rs).
type PrintInvoiceOutcome =
  | { status: "printed" }
  | { status: "cancelled" }
  | { status: "unsupported" }
  | { status: "noPrinters" }
  | { status: "dialogUnavailable"; message: string }
  | { status: "printFailed"; message: string };

let printQueue: Promise<unknown> = Promise.resolve();

/// يجلب بيانات الفاتورة الكاملة والموثوقة، ثم ينفّذ الطباعة التفاعلية:
/// يبني XLSX من القالب الحالي، يحوّله إلى PDF لمعرفة عدد الصفحات، يعرض نافذة
/// Windows مع نطاق صالح، ثم يصدّر النطاق المختار إلى PDF ويطبعه عبر LibreOffice.
/// على Linux أو عند تعذّر تجهيز نافذة النطاق نرجع للمسار الصامت السابق.
/// لا تتغير الطباعة الجماعية ولا قالب الفاتورة.
export function printInvoice(invoiceId: number, includeRepeatedProductSummary = false): Promise<void> {
  // طابور: تظهر نافذة طباعة واحدة في كل مرة ولا تتزاحم الملفات المؤقتة.
  const run = printQueue.then(() => printInvoiceNow(invoiceId, includeRepeatedProductSummary));
  printQueue = run.catch(() => undefined);
  return run;
}

async function openInvoiceFileManually(
  payload: InvoicePrintPayload,
): Promise<boolean> {
  try {
    const result = await invoke<GenerateInvoiceFileResult>("generate_invoice_file", {
      data: payload,
    });
    await openPath(result.path);
    return true;
  } catch {
    return false;
  }
}

/// المسار القديم محفوظ كرجوع احتياطي عند عدم دعم نافذة Windows أو تعذّر تجهيزها.
/// لا يُستخدم هذا الرجوع بعد أن يختار المستخدم نطاقاً ثم تفشل طباعته، كي لا
/// نطبع الفاتورة كاملة خلافاً لاختياره.
async function printInvoiceDirectFallback(
  payload: InvoicePrintPayload,
  savedPrinter: string | null,
): Promise<void> {
  try {
    await invoke("print_invoice_direct", {
      data: payload,
      printerName: savedPrinter,
    });
  } catch (directPrintError) {
    const openedManually = await openInvoiceFileManually(payload);
    const directMessage =
      directPrintError instanceof Error ? directPrintError.message : String(directPrintError);
    if (openedManually) {
      throw new Error(
        \`تعذّرت الطباعة المباشرة الصامتة (\${directMessage}) — تم فتح ملف الفاتورة يدوياً بدلاً من ذلك، يمكنك الطباعة منه الآن.\`,
      );
    }
    throw new Error(directMessage || "تعذّرت طباعة الفاتورة.");
  }
}

async function printInvoiceNow(invoiceId: number, includeRepeatedProductSummary: boolean): Promise<void> {
  const full = await invoiceService.getInvoiceFullDetails(invoiceId);
  if (!full) {
    throw new Error("تعذّر العثور على بيانات هذه الفاتورة لطباعتها.");
  }
  if (full.details.length === 0) {
    throw new Error("هذه الفاتورة لا تحتوي على أي بنود — لا يمكن طباعتها.");
  }

  const payload = buildPayload(full, includeRepeatedProductSummary);

  const printerName = (await settingsService.get(SETTINGS_KEY_PRINTER_NAME)) ?? "";
  const savedPrinter = printerName.trim() === "" ? null : printerName.trim();

  let outcome: PrintInvoiceOutcome;
  try {
    outcome = await invoke<PrintInvoiceOutcome>("print_invoice_with_dialog", {
      data: payload,
      defaultPrinter: savedPrinter,
    });
  } catch (dialogError) {
    console.error("تعذّر تنفيذ مسار الطباعة بنطاق الصفحات — الرجوع للطباعة الصامتة:", dialogError);
    await printInvoiceDirectFallback(payload, savedPrinter);
    return;
  }

  switch (outcome.status) {
    case "printed":
    case "cancelled":
      return;

    case "unsupported":
      // Ubuntu وبيئات غير Windows تحتفظ بسلوك التطوير السابق.
      await printInvoiceDirectFallback(payload, savedPrinter);
      return;

    case "dialogUnavailable":
      // لم يُكمل المستخدم اختياراً؛ نحافظ على الرجوع القديم بدلاً من تعطيل الطباعة.
      console.error("تعذّر تجهيز نافذة الطباعة ذات نطاق الصفحات:", outcome.message);
      await printInvoiceDirectFallback(payload, savedPrinter);
      return;

    case "noPrinters":
      throw new Error("لا توجد أي طابعة مثبَّتة على هذا الجهاز. ثبّت طابعة ثم أعد المحاولة.");

    case "printFailed": {
      // المستخدم اختار نطاقاً بالفعل. لا نرجع للطباعة الكاملة بصمت؛ نفتح XLSX
      // يدوياً كي يستطيع مراجعته أو طباعته بنفسه، مع إظهار سبب فشل النطاق.
      const openedManually = await openInvoiceFileManually(payload);
      if (openedManually) {
        throw new Error(
          \`\${outcome.message} — تم فتح ملف الفاتورة يدوياً بدلاً من ذلك، ويمكنك الطباعة منه الآن.\`,
        );
      }
      throw new Error(outcome.message || "تعذّرت طباعة الصفحات المختارة.");
    }
  }
}
