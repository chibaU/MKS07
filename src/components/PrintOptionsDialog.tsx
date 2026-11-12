// ============================================================================
// نافذة الطباعة الخاصة بالتطبيق (AI_CONTEXT.md القسم 6.7) — تحلّ محل نافذة
// ويندوز القياسية: عدد النسخ والصفحات (الطابعة تُؤخذ من الإعدادات).
//
// تُركَّب مرة واحدة في App.tsx (`<PrintOptionsHost />`) وتبقى بلا أثر حتى يطلبها
// `print.ts` عبر `requestPrintOptions` (services/printOptions.ts). منطق التحقق في
// ذلك الملف (يُختبَر بـnode)؛ هنا عرض فقط، بأنماط inline وخط Cairo كبقية المشروع.
//
// الضغط على "طباعة" لا يُغلق النافذة إلا عند طباعة "الكل". طباعة صفحة أو مجال جزئي
// تُبقيها مفتوحة بعد النجاح (مع رسالة تأكيد) ليطبع المستخدم صفحة أخرى دون العودة
// للأرشيف. تُغلق النافذة في حالتين فقط: (1) طباعة "الكل" (الكل، أو مجال يغطي كل
// الصفحات، أو فاتورة من صفحة واحدة)، (2) خروج متعمَّد: زر "إغلاق" أو Escape.
// أثناء الإرسال تبقى بحالة "جارٍ الإرسال"؛ فإن فشلت الطباعة (طابعة غير متصلة مثلاً)
// يظهر السبب داخلها مع إمكانية تعديل الخيارات وإعادة المحاولة دون إعادة تجهيز الفاتورة.
// لا إغلاق بالنقر خارجها (تفادياً للإلغاء بالخطأ)؛ Enter داخل خانة رقمية للطباعة.
// ============================================================================

import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle, Loader2, Printer, TriangleAlert } from "lucide-react";
import {
  MAX_COPIES,
  getPrintUiState,
  normalizeDigits,
  resolveCopies,
  resolveSelection,
  subscribePrintUi,
  type PrintUiState,
  type SelectionMode,
} from "../services/printOptions";

type OptionsState = Extract<PrintUiState, { kind: "options" }>;

const font = "'Cairo', sans-serif";

const s = {
  overlay: {
    position: "fixed" as const,
    inset: 0,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3000,
    direction: "rtl" as const,
    fontFamily: font,
    padding: "20px",
  },
  dialog: {
    width: "min(480px, 100%)",
    maxHeight: "92vh",
    backgroundColor: "white",
    borderRadius: "14px",
    boxShadow: "0 20px 50px rgba(0,0,0,0.30)",
    display: "flex",
    flexDirection: "column" as const,
  },
  header: { display: "flex", alignItems: "center", gap: "10px", padding: "16px 22px", borderBottom: "1px solid #E2E8F0" },
  title: { margin: 0, color: "#1E293B", fontSize: "18px", fontWeight: 700 },
  subtitle: { color: "#64748B", fontSize: "13px", marginTop: "2px" },
  body: { padding: "18px 22px", display: "flex", flexDirection: "column" as const, gap: "18px", overflowY: "auto" as const },
  label: { display: "block", color: "#334155", fontSize: "14px", fontWeight: 700, marginBottom: "6px" },
  printerBox: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #E2E8F0",
    backgroundColor: "#F8FAFC",
    color: "#1E293B",
    fontSize: "14px",
    fontWeight: 600,
    wordBreak: "break-word" as const,
  },
  numInput: {
    width: "74px",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid #CBD5E1",
    fontSize: "15px",
    fontFamily: font,
    textAlign: "center" as const,
    direction: "ltr" as const,
    boxSizing: "border-box" as const,
  },
  radioRow: { display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", fontSize: "14px", color: "#1E293B", cursor: "pointer" },
  muted: { color: "#64748B", fontSize: "13px", lineHeight: 1.8 },
  hintBad: { color: "#B91C1C", fontSize: "13px", fontWeight: 600, marginTop: "4px" },
  warn: { backgroundColor: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: "10px", padding: "10px 14px", fontSize: "13px", lineHeight: 1.8 },
  error: { backgroundColor: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", borderRadius: "10px", padding: "10px 14px", fontSize: "13px", lineHeight: 1.8, display: "flex", gap: "8px", alignItems: "flex-start", wordBreak: "break-word" as const },
  ok: { backgroundColor: "#F0FDF4", border: "1px solid #BBF7D0", color: "#166534", borderRadius: "10px", padding: "10px 14px", fontSize: "13px", lineHeight: 1.8, display: "flex", gap: "8px", alignItems: "flex-start" },
  footer: { display: "flex", gap: "10px", justifyContent: "flex-start", padding: "14px 22px", borderTop: "1px solid #E2E8F0", backgroundColor: "#F8FAFC", borderRadius: "0 0 14px 14px" },
  btn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", borderRadius: "8px", padding: "10px 22px", fontSize: "15px", fontWeight: 700, fontFamily: font, border: "1px solid transparent" },
};

const SPIN_CSS = `@keyframes mks-print-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .mks-print-spin { animation: none !important; } }`;

function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function PreparingToast() {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: "32px",
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: "#1E293B",
        color: "white",
        padding: "14px 24px",
        borderRadius: "10px",
        boxShadow: "0 4px 20px rgba(15,23,42,0.35)",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        fontSize: "14px",
        fontWeight: 500,
        zIndex: 3000,
        direction: "rtl",
        fontFamily: font,
      }}
    >
      <style>{SPIN_CSS}</style>
      <Loader2 size={18} className="mks-print-spin" style={{ animation: "mks-print-spin 0.9s linear infinite" }} />
      جارٍ تجهيز الفاتورة للطباعة…
    </div>
  );
}

function PrintOptionsDialog({ request }: { request: OptionsState }) {
  const { info, submit, finish } = request;

  const savedPrinter = info.savedPrinter.trim();
  const savedPrinterMissing =
    savedPrinter !== "" && info.printers.length > 0 && !info.printers.includes(savedPrinter);
  const printer = savedPrinterMissing ? "" : savedPrinter;
  const [copies, setCopies] = useState("1");
  const [mode, setMode] = useState<SelectionMode>("all");
  const [single, setSingle] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printedAny, setPrintedAny] = useState(false); // طُبعت صفحة/مجال واحد على الأقل في هذه الجلسة
  const [lastPrinted, setLastPrinted] = useState<{ key: string; text: string } | null>(null);

  const multiPage = info.pageCount > 1;
  const copiesResult = resolveCopies(copies);
  const selection = resolveSelection({ mode, single, from, to }, info.pageCount);
  const canPrint = !busy && copiesResult.ok && selection.ok;
  // مفتاح يلخّص اختيارات المستخدم: رسالة "تم الإرسال" تظهر ما دام الاختيار لم يتغيّر
  // (تختفي تلقائياً بمجرد تعديل أي حقل، دون الحاجة إلى effect).
  const selectionKey = `${copies}|${mode}|${single}|${from}|${to}`;
  const printedNotice = !busy && lastPrinted?.key === selectionKey ? lastPrinted.text : null;

  const handlePrint = async () => {
    if (busy || !copiesResult.ok || !selection.ok) return;
    const range = selection.value;
    setBusy(true);
    setError(null);
    try {
      await submit({ printerName: printer, copies: copiesResult.value, range });
    } catch (e) {
      setError(errorText(e));
      setLastPrinted(null);
      setBusy(false);
      return;
    }

    // طباعة "الكل" = انتهت المهمة، تُغلق النافذة.
    if (range.mode === "all") {
      finish(true);
      return;
    }

    // صفحة أو مجال جزئي: تبقى النافذة مفتوحة لطباعة صفحات أخرى.
    setPrintedAny(true);
    setLastPrinted({
      key: selectionKey,
      text:
        range.from === range.to
          ? `تم إرسال الصفحة ${range.from} إلى الطابعة ✓`
          : `تم إرسال الصفحات ${range.from}–${range.to} إلى الطابعة ✓`,
    });
    setBusy(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) finish(printedAny);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, finish, printedAny]);

  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handlePrint();
    }
  };

  const radio = (value: SelectionMode, text: string, field?: React.ReactNode) => (
    <label style={s.radioRow}>
      <input type="radio" name="mks-print-pages" checked={mode === value} disabled={busy} onChange={() => setMode(value)} />
      <span>{text}</span>
      {field}
    </label>
  );

  const pageInput = (value: string, set: (v: string) => void, label: string, forMode: SelectionMode) => (
    <input
      aria-label={label}
      inputMode="numeric"
      autoComplete="off"
      style={s.numInput}
      value={value}
      disabled={busy}
      onFocus={() => setMode(forMode)}
      onChange={(e) => {
        set(normalizeDigits(e.target.value));
        setMode(forMode);
      }}
      onKeyDown={onEnter}
    />
  );

  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-label="طباعة الفاتورة" dir="rtl">
      <style>{SPIN_CSS}</style>
      <div style={s.dialog}>
        <div style={s.header}>
          <Printer size={22} color="#2563EB" />
          <div>
            <h2 style={s.title}>طباعة الفاتورة</h2>
            <div style={s.subtitle}>
              {info.invoiceLabel} — {multiPage ? `${info.pageCount} صفحات` : "صفحة واحدة"}
            </div>
          </div>
        </div>

        <div style={s.body}>
          <div>
            <span style={s.label}>الطابعة</span>
            <div style={s.printerBox}>
              <Printer size={16} color="#2563EB" />
              <span>{printer !== "" ? printer : "طابعة النظام الافتراضية"}</span>
            </div>
            <div style={{ ...s.muted, marginTop: "4px" }}>
              لتغيير الطابعة: الإعدادات ← طابعة الفواتير.
            </div>
            {savedPrinterMissing && (
              <div style={{ ...s.warn, marginTop: "8px" }}>
                الطابعة المحفوظة في الإعدادات («{savedPrinter}») غير موجودة على هذا الجهاز — ستُستخدَم طابعة النظام الافتراضية.
              </div>
            )}
          </div>

          <div>
            <label style={s.label} htmlFor="mks-print-copies">عدد النسخ</label>
            <input
              id="mks-print-copies"
              autoFocus
              inputMode="numeric"
              autoComplete="off"
              style={s.numInput}
              value={copies}
              disabled={busy}
              onChange={(e) => setCopies(normalizeDigits(e.target.value))}
              onFocus={(e) => e.target.select()}
              onKeyDown={onEnter}
            />
            {!copiesResult.ok && !copiesResult.empty && <div style={s.hintBad}>{copiesResult.error}</div>}
            {!copiesResult.ok && copiesResult.empty && <div style={{ ...s.muted, marginTop: "4px" }}>{copiesResult.error} (الحد الأقصى {MAX_COPIES}).</div>}
          </div>

          <div>
            <span style={s.label}>الصفحات</span>
            {multiPage ? (
              <>
                {radio("all", `الكل (${info.pageCount} صفحات)`)}
                {radio("single", "صفحة واحدة", pageInput(single, setSingle, "رقم الصفحة", "single"))}
                {radio(
                  "range",
                  "مجال من",
                  <>
                    {pageInput(from, setFrom, "من الصفحة", "range")}
                    <span>إلى</span>
                    {pageInput(to, setTo, "إلى الصفحة", "range")}
                  </>,
                )}
                {!selection.ok && !selection.empty && <div style={s.hintBad}>{selection.error}</div>}
                {!selection.ok && selection.empty && <div style={{ ...s.muted, marginTop: "4px" }}>{selection.error}</div>}
                {selection.ok && selection.value.mode === "pages" && (
                  <div style={{ ...s.muted, marginTop: "6px" }}>
                    تُطبَع الصفحات المحددة كصور عالية الدقة (300 نقطة/بوصة) وتُلائَم منطقة الطباعة، أما «الكل» فتُطبَع بجودة النص الكاملة.
                  </div>
                )}
                <div style={{ ...s.muted, marginTop: "6px" }}>
                  بعد طباعة صفحة أو مجال تبقى هذه النافذة مفتوحة لتطبع صفحات أخرى، وتُغلق عند طباعة «الكل» أو عند الضغط على «إغلاق».
                </div>
              </>
            ) : (
              <div style={s.muted}>الفاتورة من صفحة واحدة — ستُطبَع كاملة.</div>
            )}
          </div>

          {printedNotice && (
            <div style={s.ok} role="status">
              <CheckCircle size={16} style={{ flexShrink: 0, marginTop: "4px" }} />
              <span>{printedNotice}</span>
            </div>
          )}

          {error && (
            <div style={s.error} role="alert">
              <TriangleAlert size={16} style={{ flexShrink: 0, marginTop: "4px" }} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div style={s.footer}>
          <button
            type="button"
            onClick={() => void handlePrint()}
            disabled={!canPrint}
            style={{ ...s.btn, backgroundColor: "#2563EB", color: "white", borderColor: "#2563EB", opacity: canPrint ? 1 : 0.55, cursor: canPrint ? "pointer" : "not-allowed" }}
          >
            {busy ? <Loader2 size={16} className="mks-print-spin" style={{ animation: "mks-print-spin 0.9s linear infinite" }} /> : <Printer size={16} />}
            {busy ? "جارٍ الإرسال إلى الطابعة…" : error ? "إعادة المحاولة" : "طباعة"}
          </button>
          <button
            type="button"
            onClick={() => finish(printedAny)}
            disabled={busy}
            style={{ ...s.btn, backgroundColor: "white", color: "#475569", borderColor: "#CBD5E1", opacity: busy ? 0.55 : 1, cursor: busy ? "not-allowed" : "pointer" }}
          >
            {printedAny ? "إغلاق" : "إلغاء"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PrintOptionsHost() {
  const ui = useSyncExternalStore(subscribePrintUi, getPrintUiState, getPrintUiState);
  if (ui === null) return null;
  if (ui.kind === "preparing") return <PreparingToast />;
  return <PrintOptionsDialog key={ui.id} request={ui} />;
}
