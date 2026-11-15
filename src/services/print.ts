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
// الطباعة تتم عبر LibreOffice في وضع `--headless` من سطر الأوامر (راجع
// الملاحظة المعمارية في invoice_template.rs) — بلا فتح أي تطبيق جداول مرئي.
// **مسار احتياطي متعمَّد:** لو فشل تجهيز النافذة تقنياً (أو على Linux، جهاز
// التطوير)، نرجع للمسار الصامت المباشر `print_invoice_direct` على الطابعة
// المحفوظة في الإعدادات، وإن فشل هو أيضاً (LibreOffice غير مثبَّت، طابعة غير
// موجودة...) نفتح ملف xlsx بتطبيق الجداول الافتراضي ليُطبَع يدوياً.
//
// **قرار مقصود (٤) — نافذة الطباعة الخاصة بالتطبيق، بطلب صريح لاحق:**
// لم تعد الطباعة العادية تعرض نافذة ويندوز القياسية (كانت تُعرَض قبل وجود أي
// مستند فتعجز عن نطاق الصفحات). المسار الآن (التفصيل في print_dialog.rs):
//   1) `print_prepare`: يبني xlsx ويحوّله إلى PDF مؤقت ويعدّ صفحاته (ثوانٍ؛
//      يظهر مؤشر "جارٍ تجهيز الفاتورة للطباعة…" خلالها).
//   2) نافذة التطبيق (PrintOptionsDialog): الطابعة، عدد النسخ، والصفحات —
//      الكل، أو صفحة واحدة، أو مجال متتالٍ. الطابعة المحفوظة في الإعدادات هي
//      الاختيار الأولي فيها.
//   3) `print_execute`: "الكل" = المسار المتجهي المجرَّب (LibreOffice على xlsx)،
//      وصفحات محددة = PowerShell يرسم صفحات الـPDF ويطبعها صوراً بدقة 300 DPI.
//      فشل الطباعة هنا يظهر داخل النافذة التي تبقى مفتوحة لإعادة المحاولة.
//   4) `print_job_cleanup`: حذف مجلد المهمة المؤقت دائماً (finally).
// "إلغاء" من النافذة = لا طباعة ولا رسالة خطأ. الطباعات تُسلسَل بطابور (نافذة
// واحدة في كل مرة).
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoiceService, type InvoiceFullDetails, settingsService, SETTINGS_KEY_PRINTER_NAME } from "./db";
import { round2, formatMoney } from "../components/InvoiceShared";
import { calculateRepeatedProductSummaries, type RepeatedProductSummary } from "./repeatedProductsSummary";
import { hidePrintPreparing, requestPrintOptions, showPrintPreparing } from "./printOptions";

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

/// نتيجة أمر `print_prepare` (راجع print_dialog.rs).
type PrintPrepareResult =
  | { status: "unsupported" }
  | { status: "ready"; jobId: string; pageCount: number; printers: string[] };

let printQueue: Promise<unknown> = Promise.resolve();

/// يجلب بيانات الفاتورة الكاملة والموثوقة، يجهّزها للطباعة، ويعرض **نافذة الطباعة
/// الخاصة بالتطبيق** (القرار المقصود رقم ٤ أعلى الملف) ثم يطبع على اختيار
/// المستخدم. تُنجَز الوعدة بعد الطباعة، أو فور إلغاء المستخدم (بلا خطأ).
///
/// تُلقي (throw) خطأً عربياً واضحاً إن فشل تجهيز الملف نفسه (قالب مفقود/فاسد،
/// فاتورة بلا بنود، إلخ) ولم ينجح المسار الاحتياطي — على المستدعي (المكوّن)
/// عرضه للمستخدم بطريقته المعتادة (alert/toast). أما فشل الطباعة بعد ظهور النافذة
/// فيُعرَض داخل النافذة نفسها ولا يصل المستدعي.
export function printInvoice(invoiceId: number, includeRepeatedProductSummary = false): Promise<void> {
  // طابور: تظهر نافذة طباعة واحدة في كل مرة (ضغطتان متتاليتان لا تفتحان نافذتين
  // معاً، ولا تتزاحم الطباعتان على الملفات المؤقتة). فشل طباعة لا يوقف
  // اللاحقة، والخطأ يصل لمستدعيه وحده.
  const run = printQueue.then(() => printInvoiceNow(invoiceId, includeRepeatedProductSummary));
  printQueue = run.catch(() => undefined);
  return run;
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

  const savedPrinter = ((await settingsService.get(SETTINGS_KEY_PRINTER_NAME)) ?? "").trim();

  // تجهيز المهمة (xlsx ← PDF ← عدد الصفحات). فشله التقني لا يمنع الطباعة: نرجع
  // للمسار الصامت القديم كما كان، ونسجّل السبب فقط. على غير ويندوز يرجع
  // `unsupported` فنسلك المسار نفسه.
  showPrintPreparing();
  let prepared: PrintPrepareResult | null = null;
  try {
    prepared = await invoke<PrintPrepareResult>("print_prepare", { data: payload });
  } catch (prepareError) {
    console.error("تعذّر تجهيز نافذة الطباعة — الرجوع للطباعة الصامتة:", prepareError);
  }

  if (!prepared || prepared.status !== "ready") {
    hidePrintPreparing();
    await printSilentWithManualFallback(payload, savedPrinter === "" ? null : savedPrinter);
    return;
  }

  const { jobId, pageCount, printers } = prepared;
  try {
    await requestPrintOptions(
      {
        invoiceLabel: full.invoice_number ?? `#${full.id}`,
        pageCount,
        printers,
        savedPrinter,
      },
      (choice) =>
        invoke<void>("print_execute", {
          jobId,
          printerName: choice.printerName,
          copies: choice.copies,
          range: choice.range,
          docName: full.invoice_number ?? "",
        }),
    );
  } finally {
    // تنظيف دائم (طباعة/إلغاء/خطأ). فشله لا يُخفي نتيجة الطباعة؛ ما يبقى تحذفه
    // Rust تلقائياً عند تجهيز مهمة لاحقة بعد 6 ساعات.
    invoke("print_job_cleanup", { jobId }).catch((cleanupError) => {
      console.error("تعذّر حذف الملفات المؤقتة لمهمة الطباعة:", cleanupError);
    });
  }
}

/// المسار القديم كما كان (لم يتغيّر): طباعة صامتة مباشرة على الطابعة المحفوظة
/// (أو الافتراضية)، وعند فشلها **مسار احتياطي تلقائي**: توليد الملف ثم فتحه
/// بتطبيق الجداول الافتراضي (Excel/LibreOffice Calc) ليطبعه المستخدم يدوياً بدل
/// إفشال العملية بالكامل.
async function printSilentWithManualFallback(payload: InvoicePrintPayload, printerName: string | null): Promise<void> {
  try {
    await invoke("print_invoice_direct", {
      data: payload,
      printerName,
    });
  } catch (directPrintError) {
    // نبني الملف من جديد بدل إعادة استخدام مسار قديم محتمل حُذف أصلاً عبر سياسة
    // التنظيف (cleanup_generated_dir) — استدعاء رخيص، لا حاجة للتوفير هنا.
    let openedManually = false;
    try {
      const result = await invoke<GenerateInvoiceFileResult>("generate_invoice_file", {
        data: payload,
      });
      await openPath(result.path);
      openedManually = true;
    } catch {
      // تجاهل: الخطأ الأصلي (فشل الطباعة الصامتة) أهم وأوضح للمستخدم أدناه.
    }

    const directMessage =
      directPrintError instanceof Error ? directPrintError.message : String(directPrintError);
    if (openedManually) {
      throw new Error(
        `تعذّرت الطباعة المباشرة الصامتة (${directMessage}) — تم فتح ملف الفاتورة يدوياً بدلاً من ذلك، يمكنك الطباعة منه الآن.`,
        { cause: directPrintError },
      );
    }
    throw new Error(directMessage || "تعذّرت طباعة الفاتورة.", { cause: directPrintError });
  }
}
