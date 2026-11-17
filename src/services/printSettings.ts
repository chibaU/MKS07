// ============================================================================
// إعدادات الطباعة المحفوظة في جدول `settings` (تُقرأ طازجة في كل طباعة — لا
// إعادة تشغيل). الطابعة تبقى على مفتاحها القديم SETTINGS_KEY_PRINTER_NAME
// (db.ts)، والجديد هنا مفتاح الوضع فقط.
// ============================================================================

import { parsePrintMode } from "../print/behavior.ts";
import type { PrintBehavior, PrintMode } from "../print/types.ts";
import { SETTINGS_KEY_PRINTER_NAME, settingsService } from "./db";

/** 'dialog' | 'direct' — غيابه أو فساده يعني أن الإعداد الافتراضي (print.config.ts) هو الحاكم. */
export const SETTINGS_KEY_PRINT_MODE = "print_mode";

/**
 * قيمتا الإعداد كما حُفظتا. ما غاب يُترك undefined كي لا يطغى على الافتراضي، واسم
 * الطابعة الفارغ يعني «لم تُحفَظ طابعة» (يحكم Windows الافتراضي).
 */
export async function loadPrintSettings(): Promise<Partial<PrintBehavior>> {
  const [mode, printer] = await Promise.all([
    settingsService.get(SETTINGS_KEY_PRINT_MODE),
    settingsService.get(SETTINGS_KEY_PRINTER_NAME),
  ]);
  const printerName = (printer ?? "").trim();
  return {
    mode: parsePrintMode(mode),
    printerName: printerName === "" ? undefined : printerName,
  };
}

export async function savePrintMode(mode: PrintMode): Promise<void> {
  await settingsService.update(SETTINGS_KEY_PRINT_MODE, mode);
}
