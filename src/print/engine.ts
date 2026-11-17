// ============================================================================
// محرك الطباعة — بلا React ولا Tauri (كل اعتماد خارجي يدخل عبر EngineDeps) فيُختبَر
// بـnode مباشرة (tests/printEngine.test.ts). التوصيل الفعلي في src/print/index.ts.
//
// الضمانات:
//  - **طابور**: مهمة واحدة في كل مرة؛ فشل مهمة لا يوقف اللاحقة، ولا تُسقَط أي مكالمة.
//  - **دمج التكرار**: طلب مطابق تماماً (النوع + البيانات + التجاوز) وصل بينما مهمة
//    مثلها ما زالت في الطابور أو قيد التنفيذ يشارك نتيجتها ولا يُنشئ مهمة ثانية
//    (نقرتان متتاليتان = طباعة واحدة). ليس إسقاطاً: كل مستدعٍ يستلم النتيجة الحقيقية.
//  - **وضع dialog**: المستند يبقى مركَّباً بعد العودة (النظام يبني مستند الطباعة بعد
//    تأكيد المستخدم، والمسح المبكر يطبع صفحة فارغة)، ويُمسَح عند المهمة التالية.
//    لا توجد إشارة اكتمال/إلغاء، فالوعد يُنجَز عند فتح النافذة (+ DIALOG_SETTLE_MS).
//  - **وضع direct**: المستند يُمسَح بعد الإرسال.
// ============================================================================

import { resolveBehavior } from "./behavior.ts";
import {
  NATIVE_PRINTER_UNAVAILABLE,
  NATIVE_UNSUPPORTED,
  PrintError,
  type NativePrintRequest,
  type PrintBehavior,
  type PrintConfig,
  type PrintDocument,
  type PrintMode,
} from "./types.ts";

/** انتظار قصير بعد فتح نافذة النظام: يستوعب نقرة ثانية تصل أثناء ظهور النافذة. */
export const DIALOG_SETTLE_MS = 400;

export interface EngineDeps {
  config: PrintConfig;
  /** يقرأ الإعدادات المحفوظة (print_mode + الطابعة) طازجة من القاعدة في كل مهمة. */
  readSettings(): Promise<Partial<PrintBehavior>>;
  /** يركّب المستند في #print-root ويُنجَز حين يصير جاهزاً للطباعة (تخطيط + خطوط + صور). */
  mount(doc: PrintDocument): Promise<void>;
  unmount(): void;
  /** يستدعي أمر Rust؛ يرفض بنص الخطأ الحرفي (مثل "UNSUPPORTED"). */
  invokeNative(req: NativePrintRequest): Promise<void>;
  /** window.print() — احتياطي لغير ويندوز. */
  browserPrint(): void | Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface PrintEngine {
  printDocument(doc: PrintDocument, override?: Partial<PrintBehavior>): Promise<void>;
}

/** نص الخطأ القادم من invoke (Tauri يرفض بالنص الذي أعاده Rust). */
export function nativeErrorText(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function jobKey(doc: PrintDocument, override: Partial<PrintBehavior> | undefined): string | null {
  try {
    return JSON.stringify([doc.type, doc.data, override ?? null]);
  } catch {
    return null; // بيانات غير قابلة للتسلسل: لا دمج، تُنفَّذ كمهمة مستقلة
  }
}

export function createPrintEngine(deps: EngineDeps): PrintEngine {
  let tail: Promise<unknown> = Promise.resolve();
  const inFlight = new Map<string, Promise<void>>();

  async function browserPrint(): Promise<void> {
    try {
      await deps.browserPrint();
    } catch (error) {
      throw new PrintError(
        "NATIVE",
        `تعذّر فتح نافذة الطباعة: ${nativeErrorText(error)}`,
        { cause: error },
      );
    }
  }

  /** يُرجع الوضع الذي ظهر فعلاً (direct = أُرسلت صامتة، dialog = ظهرت نافذة). */
  async function dispatch(behavior: PrintBehavior): Promise<PrintMode> {
    const printerName = behavior.printerName?.trim() || undefined;
    const request: NativePrintRequest =
      behavior.mode === "direct"
        ? { mode: "direct", printerName, copies: behavior.copies, duplex: behavior.duplex }
        : { mode: "dialog" };

    try {
      await deps.invokeNative(request);
      return behavior.mode;
    } catch (error) {
      const code = nativeErrorText(error);

      if (code === NATIVE_UNSUPPORTED) {
        await browserPrint();
        return "dialog";
      }

      if (code === NATIVE_PRINTER_UNAVAILABLE && behavior.mode === "direct") {
        if (behavior.onPrinterUnavailable === "dialog") {
          return dispatch({ ...behavior, mode: "dialog" });
        }
        throw new PrintError(
          "PRINTER_UNAVAILABLE",
          printerName
            ? `تعذّرت الطباعة: الطابعة «${printerName}» غير متاحة. تحقّق من اتصالها أو اختر طابعة أخرى من الإعدادات.`
            : "تعذّرت الطباعة: طابعة النظام الافتراضية غير متاحة.",
          { cause: error },
        );
      }

      throw new PrintError("NATIVE", `تعذّرت الطباعة: ${code}`, { cause: error });
    }
  }

  async function execute(
    doc: PrintDocument,
    override: Partial<PrintBehavior> | undefined,
  ): Promise<void> {
    let settings: Partial<PrintBehavior> = {};
    try {
      settings = await deps.readSettings();
    } catch (error) {
      // فشل قراءة الإعدادات لا يمنع الطباعة: تحكم القيم الافتراضية.
      console.error("تعذّرت قراءة إعدادات الطباعة — استُخدمت القيم الافتراضية:", error);
    }
    const behavior = resolveBehavior(deps.config, doc.type, settings, override);

    try {
      await deps.mount(doc);
    } catch (error) {
      deps.unmount();
      throw error instanceof PrintError
        ? error
        : new PrintError("NOT_READY", `تعذّر تجهيز المستند للطباعة: ${nativeErrorText(error)}`, {
            cause: error,
          });
    }

    try {
      const shown = await dispatch(behavior);
      if (shown === "direct") {
        deps.unmount();
      } else {
        await deps.sleep(DIALOG_SETTLE_MS);
      }
    } catch (error) {
      deps.unmount();
      throw error;
    }
  }

  function printDocument(
    doc: PrintDocument,
    override?: Partial<PrintBehavior>,
  ): Promise<void> {
    const key = jobKey(doc, override);
    if (key !== null) {
      const existing = inFlight.get(key);
      if (existing) return existing;
    }

    const run = tail.then(() => execute(doc, override));
    tail = run.catch(() => undefined); // فشل هذه المهمة لا يعطّل ما بعدها

    if (key === null) return run;
    const tracked: Promise<void> = run.finally(() => {
      if (inFlight.get(key) === tracked) inFlight.delete(key);
    });
    inFlight.set(key, tracked);
    return tracked;
  }

  return { printDocument };
}
