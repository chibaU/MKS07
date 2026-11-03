// ============================================================================
// الطباعة الجماعية لفواتير تاجر خلال فترة → **ملف PDF واحد** (AI_CONTEXT.md
// القسمان 6.5 و6.7، والقاعدة في القسم 8).
//
// هذه الطبقة تقود العملية بالتتابع (لا توازي) فوق أوامر Rust
// `batch_invoice_pdf_*`، كي يكون التقدم صادقاً (كل خطوة تُنجَز فعلاً قبل أن
// يُعلَن عنها) ويمكن الإلغاء بين الخطوات:
//   1) إعادة جلب قائمة فواتير الفترة (للتأكد من آخر حالة، وأنها لم تتغير منذ
//      المعاينة، وأنه لا فاتورة مفتوحة).
//   2) prepare: مجلد الدفعة المؤقت.
//   3) لكل فاتورة بالتتابع: getInvoiceFullDetails ← buildPayload (نفس دالة
//      الطباعة العادية حرفياً) ← add_invoice (xlsx مُعبَّأ بنفس منطق القالب).
//   4) convert: تحويل الملفات إلى PDF بدفعات من CONVERT_CHUNK_SIZE.
//   5) finalize: دمج بالترتيب + حفظ في التنزيلات + كشف في المستكشف.
//   6) cleanup دائماً (نجاح/فشل/إلغاء) في finally.
//
// **للقراءة فقط على قاعدة البيانات:** لا هنا ولا في Rust أي كتابة: لا ترقيم
// كسول، لا setOpenState، لا migration. فاتورة قديمة بلا invoice_number تُطبع
// برقم فارغ كما تفعل الطباعة العادية (buildPayload).
// **الكل أو لا شيء:** أي فشل في أي مرحلة يرمي BatchError برقم الفاتورة وسببها،
// ولا يُسلَّم أي ملف جزئي (الدمج والحفظ آخر خطوة، بعد نجاح كل ما قبلها).
// **لا مسار "فتح Excel" الاحتياطي ولا طباعة صامتة** هنا إطلاقاً.
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import { invoiceService, type InvoiceFullDetails, type MerchantInvoiceInRange } from "./db";
import { buildPayload } from "./print";
import { round2 } from "../components/InvoiceShared";

/** عدد الفواتير في كل استدعاء تحويل واحد (كلفة إقلاع LibreOffice تُدفع مرة لكل دفعة). */
export const CONVERT_CHUNK_SIZE = 10;

/** خطأ مقصود بنص عربي جاهز للعرض للمستخدم كما هو. */
export class BatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchError";
  }
}

/** أُلغيت العملية من المستخدم (ليست فشلاً). */
export class BatchCancelledError extends Error {
  constructor() {
    super("أُلغيت العملية.");
    this.name = "BatchCancelledError";
  }
}

/** توجد فواتير مفتوحة (is_open = 1) لهذا التاجر في هذه الفترة — منع كلي. */
export class BatchBlockedError extends BatchError {
  readonly openNumbers: string[];
  constructor(openNumbers: string[]) {
    super(blockedMessage(openNumbers));
    this.name = "BatchBlockedError";
    this.openNumbers = openNumbers;
  }
}

/** الرقم المعروض للفاتورة: invoice_number أو #id للفواتير القديمة بلا رقم. */
export function invoiceDisplayNumber(inv: Pick<MerchantInvoiceInRange, "id" | "invoice_number">): string {
  return inv.invoice_number ?? `#${inv.id}`;
}

export function blockedMessage(openNumbers: string[]): string {
  return (
    `لا يمكن إنشاء الملف: توجد فواتير مفتوحة لهذا التاجر في هذه الفترة (${openNumbers.join("، ")}). ` +
    `أغلق كل فاتورة منها (زر "حفظ" داخل تبويبها في الصفحة الرئيسية) ثم أعد المعاينة.`
  );
}

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** رسالة خطأ عربية إن كان نطاق التاريخ غير صالح، وإلا null. */
export function validateRange(dateFrom: string, dateTo: string): string | null {
  if (!ISO_DATE.test(dateFrom) || !ISO_DATE.test(dateTo)) {
    return "اختر تاريخ البداية وتاريخ النهاية.";
  }
  if (dateFrom > dateTo) {
    return "تاريخ البداية يجب أن يسبق تاريخ النهاية أو يساويه.";
  }
  return null;
}

export interface BatchPreview {
  /** كل فواتير التاجر في الفترة بالترتيب النهائي (التاريخ ثم id تصاعدياً). */
  invoices: MerchantInvoiceInRange[];
  /** الفواتير المفتوحة منها (is_open = 1) — إن وُجدت واحدة فالتوليد ممنوع. */
  openInvoices: MerchantInvoiceInRange[];
  /** الإجمالي العام (مجموع total_amount مقرَّباً round2). */
  grandTotal: number;
  /** بصمة القائمة (id + إجمالي لكل فاتورة) لكشف تغيّرها بين المعاينة والتوليد. */
  signature: string;
}

function signatureOf(invoices: MerchantInvoiceInRange[]): string {
  return invoices.map((i) => `${i.id}:${i.total_amount}`).join("|");
}

function toPreview(invoices: MerchantInvoiceInRange[]): BatchPreview {
  return {
    invoices,
    openInvoices: invoices.filter((i) => i.is_open === 1),
    grandTotal: round2(invoices.reduce((sum, i) => sum + i.total_amount, 0)),
    signature: signatureOf(invoices),
  };
}

/** معاينة قراءة فقط: فواتير التاجر في الفترة + الإجمالي + المفتوحة منها. */
export async function loadBatchPreview(
  merchantId: number,
  dateFrom: string,
  dateTo: string,
): Promise<BatchPreview> {
  const rangeError = validateRange(dateFrom, dateTo);
  if (rangeError) throw new BatchError(rangeError);
  return toPreview(await invoiceService.getMerchantInvoicesInRange(merchantId, dateFrom, dateTo));
}

export type BatchPhase = "build" | "convert" | "merge";

export interface BatchProgress {
  phase: BatchPhase;
  /** عدد الوحدات المنجَزة فعلاً من الكل (تجهيز + تحويل + دمج) */
  fraction: number;
  /** نص للمستخدم: "تجهيز فاتورة 12 من 80"، "تحويل ..."، "دمج ..." */
  text: string;
}

export interface BatchPdfResult {
  path: string;
  pages: number;
  invoiceCount: number;
}

interface CmdError {
  index: number | null;
  message: string;
}

/** يحوّل أي رفض من invoke (نص أو كائن {index, message} من BatchCmdError) إلى شكل موحَّد. */
function parseCmdError(e: unknown): CmdError {
  if (typeof e === "string") return { index: null, message: e };
  if (e && typeof e === "object") {
    const o = e as { index?: unknown; message?: unknown };
    return {
      index: typeof o.index === "number" ? o.index : null,
      message: typeof o.message === "string" ? o.message : String(e),
    };
  }
  return { index: null, message: String(e) };
}

/**
 * زر "فتح مكان الملف": يكشف ملف PDF الناتج في مستكشف ويندوز محدَّداً. للقراءة فقط
 * (لا يمسّ قاعدة البيانات ولا الملف). التحقق الأمني من المسار في Rust
 * (`batch_invoice_pdf_reveal`). يرمي BatchError برسالة عربية إن تعذّر.
 */
export async function revealBatchPdf(path: string): Promise<void> {
  try {
    await invoke("batch_invoice_pdf_reveal", { path });
  } catch (e) {
    throw new BatchError(parseCmdError(e).message || "تعذّر فتح مكان الملف.");
  }
}

export interface CreateBatchPdfParams {
  merchantId: number;
  merchantName: string;
  dateFrom: string;
  dateTo: string;
  /** بصمة المعاينة التي رآها المستخدم — إن تغيّرت القائمة بعدها يُرفَض التوليد. */
  previewSignature: string;
  includeRepeatedProductSummary?: boolean;
  onProgress: (p: BatchProgress) => void;
  /** يُستعلَم بين الخطوات؛ true = أوقف بعد الخطوة الجارية ونظّف. */
  isCancelled: () => boolean;
}

/**
 * يولّد ملف PDF واحداً لكل فواتير التاجر في الفترة، كله أو لا شيء. يرمي:
 * BatchBlockedError (فواتير مفتوحة)، BatchCancelledError (إلغاء)، أو BatchError
 * (أي فشل آخر، برسالة تذكر رقم الفاتورة والسبب). مجلد الدفعة المؤقت يُحذف في
 * كل الحالات.
 */
export async function createBatchPdf(params: CreateBatchPdfParams): Promise<BatchPdfResult> {
  const { merchantId, merchantName, dateFrom, dateTo, previewSignature, onProgress, isCancelled, includeRepeatedProductSummary = false } = params;

  const rangeError = validateRange(dateFrom, dateTo);
  if (rangeError) throw new BatchError(rangeError);

  const throwIfCancelled = () => {
    if (isCancelled()) throw new BatchCancelledError();
  };

  // 1) أحدث حالة من القاعدة (قراءة فقط): المنع والتطابق مع المعاينة.
  const fresh = toPreview(await invoiceService.getMerchantInvoicesInRange(merchantId, dateFrom, dateTo));
  if (fresh.invoices.length === 0) {
    throw new BatchError("لا توجد فواتير لهذا التاجر في هذه الفترة.");
  }
  if (fresh.openInvoices.length > 0) {
    throw new BatchBlockedError(fresh.openInvoices.map(invoiceDisplayNumber));
  }
  if (fresh.signature !== previewSignature) {
    throw new BatchError("تغيّرت قائمة الفواتير منذ المعاينة — أعد المعاينة ثم حاول مجدداً.");
  }

  const invoices = fresh.invoices;
  const total = invoices.length;
  const label = (i: number) => invoiceDisplayNumber(invoices[i]);
  // وحدات التقدم: تجهيز n + تحويل n + دمج/حفظ 1.
  const units = 2 * total + 1;

  let batchId: string | null = null;
  try {
    throwIfCancelled();

    try {
      batchId = (await invoke<{ batchId: string }>("batch_invoice_pdf_prepare")).batchId;
    } catch (e) {
      throw new BatchError(parseCmdError(e).message || "تعذّر تجهيز مجلد الدفعة المؤقت.");
    }

    // 3) تجهيز كل فاتورة بالتتابع (بياناتها طازجة من القاعدة، نفس مسار الطباعة العادية).
    for (let i = 0; i < total; i++) {
      throwIfCancelled();
      onProgress({
        phase: "build",
        fraction: i / units,
        text: `تجهيز فاتورة ${i + 1} من ${total} (${label(i)})`,
      });

      let full: InvoiceFullDetails | null;
      try {
        full = await invoiceService.getInvoiceFullDetails(invoices[i].id);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        throw new BatchError(`الفاتورة ${label(i)}: تعذّر قراءة بياناتها من قاعدة البيانات (${reason}).`);
      }
      if (!full) {
        throw new BatchError(`الفاتورة ${label(i)}: لم تعد موجودة في قاعدة البيانات.`);
      }
      if (full.is_open === 1) {
        throw new BatchError(`الفاتورة ${label(i)}: فُتحت للتعديل أثناء التجهيز — أغلقها ثم أعد المعاينة.`);
      }
      if (full.details.length === 0) {
        throw new BatchError(`الفاتورة ${label(i)}: لا تحتوي على أي بنود — لا يمكن طباعتها.`);
      }

      try {
        await invoke("batch_invoice_pdf_add_invoice", {
          batchId,
          index: i,
          data: buildPayload(full, includeRepeatedProductSummary),
        });
      } catch (e) {
        const err = parseCmdError(e);
        throw new BatchError(`الفاتورة ${label(err.index ?? i)}: ${err.message}`);
      }
    }

    // 4) التحويل إلى PDF بدفعات (استدعاء LibreOffice واحد لكل دفعة).
    let converted = 0;
    while (converted < total) {
      throwIfCancelled();
      const end = Math.min(converted + CONVERT_CHUNK_SIZE, total);
      const indices = Array.from({ length: end - converted }, (_, k) => converted + k);
      onProgress({
        phase: "convert",
        fraction: (total + converted) / units,
        text: `تحويل الفواتير إلى PDF — أُنجز ${converted} من ${total}`,
      });

      let result: { failed: number[]; reason: string };
      try {
        result = await invoke<{ failed: number[]; reason: string }>("batch_invoice_pdf_convert", {
          batchId,
          indices,
        });
      } catch (e) {
        const err = parseCmdError(e);
        if (err.index !== null) {
          throw new BatchError(`الفاتورة ${label(err.index)}: ${err.message}`);
        }
        throw new BatchError(
          `تعذّر تحويل الفواتير ${label(indices[0])} إلى ${label(indices[indices.length - 1])} إلى PDF: ${err.message}`,
        );
      }
      if (result.failed.length > 0) {
        const others = result.failed.length - 1;
        throw new BatchError(
          `الفاتورة ${label(result.failed[0])}: تعذّر تحويلها إلى PDF — ${result.reason}` +
            (others > 0 ? ` (وفشلت ${others} فاتورة أخرى في الدفعة نفسها)` : ""),
        );
      }
      converted = end;
    }

    // 5) الدمج + الحفظ: آخر خطوة، بعد نجاح كل ما قبلها. لا إلغاء بعدها (الملف يُنشأ).
    throwIfCancelled();
    onProgress({
      phase: "merge",
      fraction: (2 * total) / units,
      text: "دمج الملفات وحفظ الملف النهائي…",
    });
    try {
      const fin = await invoke<{ path: string; pages: number }>("batch_invoice_pdf_finalize", {
        batchId,
        count: total,
        merchantName,
        dateFrom,
        dateTo,
      });
      onProgress({ phase: "merge", fraction: 1, text: "اكتمل." });
      return { path: fin.path, pages: fin.pages, invoiceCount: total };
    } catch (e) {
      const err = parseCmdError(e);
      throw new BatchError(
        err.index !== null ? `الفاتورة ${label(err.index)}: ${err.message}` : `تعذّر دمج الملفات: ${err.message}`,
      );
    }
  } finally {
    // تنظيف دائم (نجاح/فشل/إلغاء). فشله لا يُخفي نتيجة العملية؛ ما يبقى
    // تحذفه Rust تلقائياً عند بدء دفعة لاحقة بعد 6 ساعات.
    if (batchId !== null) {
      try {
        await invoke("batch_invoice_pdf_cleanup", { batchId });
      } catch (e) {
        console.error("تعذّر حذف الملفات المؤقتة للطباعة الجماعية:", e);
      }
    }
  }
}
