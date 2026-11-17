// ============================================================================
// حلّ سلوك الطباعة — دوال بحتة:
//   أولوية الطبقات (الأعلى يغلب):  طلب الاستدعاء  >  الإعدادات المحفوظة
//   >  config.byDocument[type]  >  config.default.
// الطبقة تغلب فقط بالمفاتيح التي تعرّفها (undefined = لا رأي لها). قيمة غير صالحة
// في أي طبقة تُهمَل بدل أن تُفسد الطباعة.
// ============================================================================

import type {
  DuplexMode,
  PrintBehavior,
  PrintConfig,
  PrintMode,
  PrinterUnavailableAction,
} from "./types.ts";

export const MAX_COPIES = 99;

const MODES: readonly PrintMode[] = ["dialog", "direct"];
const DUPLEXES: readonly DuplexMode[] = ["default", "one-sided", "long-edge", "short-edge"];
const UNAVAILABLE_ACTIONS: readonly PrinterUnavailableAction[] = ["dialog", "error"];

export function definePrintConfig(config: PrintConfig): PrintConfig {
  return config;
}

/** قيمة print_mode المحفوظة → وضع صالح، أو undefined إن غابت/فسدت (فيحكم الافتراضي). */
export function parsePrintMode(value: string | null | undefined): PrintMode | undefined {
  const text = (value ?? "").trim();
  return (MODES as readonly string[]).includes(text) ? (text as PrintMode) : undefined;
}

export function sanitizeCopies(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value >= 1 && value <= MAX_COPIES ? value : undefined;
}

function applyLayer(target: PrintBehavior, layer: Partial<PrintBehavior> | undefined): void {
  if (!layer) return;
  if (layer.mode !== undefined && MODES.includes(layer.mode)) target.mode = layer.mode;
  if (
    layer.onPrinterUnavailable !== undefined &&
    UNAVAILABLE_ACTIONS.includes(layer.onPrinterUnavailable)
  ) {
    target.onPrinterUnavailable = layer.onPrinterUnavailable;
  }
  // "" مقبولة عمداً: تعني «طابعة النظام الافتراضية» وتغلب اسماً أدنى منها.
  if (typeof layer.printerName === "string") target.printerName = layer.printerName;
  const copies = sanitizeCopies(layer.copies);
  if (copies !== undefined) target.copies = copies;
  if (layer.duplex !== undefined && DUPLEXES.includes(layer.duplex)) target.duplex = layer.duplex;
}

export function resolveBehavior(
  config: PrintConfig,
  documentType: string,
  settings?: Partial<PrintBehavior>,
  override?: Partial<PrintBehavior>,
): PrintBehavior {
  const resolved: PrintBehavior = { mode: "dialog", onPrinterUnavailable: "dialog" };
  applyLayer(resolved, config.default);
  applyLayer(resolved, config.byDocument?.[documentType]);
  applyLayer(resolved, settings);
  applyLayer(resolved, override);
  return resolved;
}
