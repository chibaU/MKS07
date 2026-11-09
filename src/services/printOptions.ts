// ============================================================================
// منطق نافذة الطباعة — بلا React ولا Tauri، فيُختبَر بـnode مباشرة
// (tests/printOptions.test.ts). ثلاثة أجزاء:
//  1) الأنواع المتبادلة مع أوامر Rust `print_prepare` / `print_execute`
//     (راجع src-tauri/src/print_dialog.rs؛ الأسماء camelCase كما تصل من/إلى JSON).
//  2) التحقق من اختيار الصفحات وعدد النسخ. الصفحات: الكل، أو صفحة واحدة، أو مجال
//     متتالٍ (من–إلى) — لا صفحات متقطعة. Rust يعيد التحقق ثانية فلا يُوثَق بهذا.
//  3) متجر صغير على مستوى الوحدة يربط `print.ts` (يطلب النافذة وينتظر قرار
//     المستخدم) بـ`PrintOptionsHost` (يعرضها) — نفس نمط features/phoneSync/store.ts.
// ============================================================================

/** يطابق MAX_COPIES في print_dialog.rs. */
export const MAX_COPIES = 20;

/** ما يُرسَل إلى Rust كما هو (`range` في print_execute). */
export type PrintRange = { mode: "all" } | { mode: "pages"; from: number; to: number };

export interface PrintChoice {
  /** فارغ = طابعة النظام الافتراضية. */
  printerName: string;
  copies: number;
  range: PrintRange;
}

export interface PrintRequestInfo {
  invoiceLabel: string;
  pageCount: number;
  printers: string[];
  /** الطابعة المحفوظة في الإعدادات ("" إن لم تُحفَظ) — تُحدَّد مسبقاً إن كانت موجودة. */
  savedPrinter: string;
}

export type SelectionMode = "all" | "single" | "range";

export interface SelectionInput {
  mode: SelectionMode;
  single: string;
  from: string;
  to: string;
}

/** نتيجة تحقق: `empty` يعني أن المستخدم لم يكتب شيئاً بعد (تلميح لا خطأ أحمر). */
export type Resolved<T> = { ok: true; value: T } | { ok: false; error: string; empty: boolean };

const ok = <T,>(value: T): Resolved<T> => ({ ok: true, value });
const fail = (error: string, empty: boolean): Resolved<never> => ({ ok: false, error, empty });

/** أرقام هندية/فارسية → لاتينية، وأي محرف غير رقمي يُحذف، بحد أقصى 6 أرقام. */
export function normalizeDigits(raw: string): string {
  return raw
    .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) & 0xf))
    .replace(/\D/g, "")
    .slice(0, 6);
}

function parseWhole(text: string): number | null {
  return /^\d{1,6}$/.test(text) ? Number(text) : null;
}

function toRange(from: number, to: number, pageCount: number): PrintRange {
  // مجال يغطي الفاتورة كلها = "الكل": يأخذ مسار الطباعة المتجهية بدل رسم الصور.
  return from === 1 && to === pageCount ? { mode: "all" } : { mode: "pages", from, to };
}

export function resolveSelection(input: SelectionInput, pageCount: number): Resolved<PrintRange> {
  if (input.mode === "all" || pageCount <= 1) return ok<PrintRange>({ mode: "all" });

  const outside = `رقم الصفحة يجب أن يكون بين 1 و${pageCount}.`;

  if (input.mode === "single") {
    if (input.single.trim() === "") return fail("اكتب رقم الصفحة.", true);
    const n = parseWhole(input.single.trim());
    if (n === null || n < 1 || n > pageCount) return fail(outside, false);
    return ok(toRange(n, n, pageCount));
  }

  const fromText = input.from.trim();
  const toText = input.to.trim();
  if (fromText === "" && toText === "") return fail("اكتب رقم صفحة البداية والنهاية.", true);
  if (fromText === "" || toText === "") return fail("أكمل رقمَي صفحة البداية والنهاية.", false);
  const from = parseWhole(fromText);
  const to = parseWhole(toText);
  if (from === null || to === null || from < 1 || to < 1 || from > pageCount || to > pageCount) {
    return fail(outside, false);
  }
  if (from > to) return fail("رقم صفحة البداية يجب ألا يتجاوز رقم صفحة النهاية.", false);
  return ok(toRange(from, to, pageCount));
}

export function resolveCopies(text: string): Resolved<number> {
  if (text.trim() === "") return fail("اكتب عدد النسخ.", true);
  const n = parseWhole(text.trim());
  if (n === null || n < 1 || n > MAX_COPIES) return fail(`عدد النسخ يجب أن يكون بين 1 و${MAX_COPIES}.`, false);
  return ok(n);
}

// ───────── المتجر: print.ts ↔ PrintOptionsHost ─────────

export type PrintUiState =
  | { kind: "preparing" }
  | {
      kind: "options";
      id: number;
      info: PrintRequestInfo;
      /** يُنفِّذ الطباعة فعلاً؛ فشله يُعرَض داخل النافذة وتبقى مفتوحة لإعادة المحاولة. */
      submit: (choice: PrintChoice) => Promise<void>;
      /** يُغلق النافذة: true = طُبعت، false = ألغى المستخدم. */
      finish: (printed: boolean) => void;
    };

let state: PrintUiState | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function setState(next: PrintUiState | null): void {
  state = next;
  listeners.forEach((l) => l());
}

export function getPrintUiState(): PrintUiState | null {
  return state;
}

export function subscribePrintUi(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** مؤشر "جارٍ تجهيز الفاتورة…" أثناء التحويل إلى PDF قبل ظهور النافذة. */
export function showPrintPreparing(): void {
  if (state === null) setState({ kind: "preparing" });
}

export function hidePrintPreparing(): void {
  if (state?.kind === "preparing") setState(null);
}

/** يعرض النافذة (بدل مؤشر التجهيز) ويُنجَز عند الطباعة (true) أو الإلغاء (false). */
export function requestPrintOptions(
  info: PrintRequestInfo,
  submit: (choice: PrintChoice) => Promise<void>,
): Promise<boolean> {
  if (state?.kind === "options") state.finish(false); // احترازي: print.ts يُسلسِل الطلبات
  return new Promise<boolean>((resolve) => {
    const id = ++seq;
    const finish = (printed: boolean) => {
      if (state?.kind === "options" && state.id === id) setState(null);
      resolve(printed);
    };
    setState({ kind: "options", id, info, submit, finish });
  });
}
