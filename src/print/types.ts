// ============================================================================
// أنواع محرك الطباعة (src/print/). بلا React ولا Tauri — فتُختبَر بـnode مباشرة.
// ============================================================================

/** dialog = نافذة طباعة النظام (الافتراضي). direct = إرسال صامت بلا أي واجهة. */
export type PrintMode = "dialog" | "direct";

export type DuplexMode = "default" | "one-sided" | "long-edge" | "short-edge";

/** ماذا نفعل في الوضع المباشر إن لم توجد الطابعة المطلوبة. */
export type PrinterUnavailableAction = "dialog" | "error";

export interface PrintBehavior {
  mode: PrintMode;
  onPrinterUnavailable: PrinterUnavailableAction;
  /** فارغ/غائب = طابعة ويندوز الافتراضية. يُمرَّر كما حُفظ تماماً. */
  printerName?: string;
  copies?: number;
  duplex?: DuplexMode;
}

export interface PrintConfig {
  default: PrintBehavior;
  /** تجاوز لكل نوع مستند (يعلو الافتراضي ويعلوه الإعداد المحفوظ ثم طلب الاستدعاء). */
  byDocument?: Record<string, Partial<PrintBehavior>>;
}

/** مستند واحد للطباعة: النوع يحدد المكوّن في السجل، والبيانات جاهزة التنسيق. */
export interface PrintDocument<T = unknown> {
  type: string;
  /** يصير اسم صفحة التطبيق أثناء المهمة، فيظهر اسماً لمهمة الطباعة في الطابعة. */
  title: string;
  data: T;
}

/** ما يُرسَل إلى أمر Rust print_webview (يطابق src-tauri/src/print/request.rs). */
export interface NativePrintRequest {
  mode: PrintMode;
  printerName?: string;
  copies?: number;
  duplex?: DuplexMode;
}

export type PrintErrorCode =
  | "PRINTER_UNAVAILABLE"
  | "NATIVE"
  | "NOT_READY"
  | "INVALID_DOCUMENT";

/** خطأ طباعة رسالته عربية جاهزة للعرض للمستخدم كما هي. */
export class PrintError extends Error {
  readonly code: PrintErrorCode;

  constructor(code: PrintErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PrintError";
    this.code = code;
  }
}

/** رموز الأخطاء التي يرسلها Rust حرفياً (src-tauri/src/print/mod.rs). */
export const NATIVE_UNSUPPORTED = "UNSUPPORTED";
export const NATIVE_PRINTER_UNAVAILABLE = "PRINTER_UNAVAILABLE";
