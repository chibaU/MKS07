// ============================================================================
// نافذة الطباعة الخاصة بالتطبيق (AI_CONTEXT.md القسم 6.7) — تحلّ محل نافذة
// ويندوز القياسية: الطابعة، عدد النسخ، والصفحات (الكل / صفحة واحدة / مجال من–إلى).
//
// تُركَّب مرة واحدة في App.tsx (`<PrintOptionsHost />`) وتبقى بلا أثر حتى يطلبها
// `print.ts` عبر `requestPrintOptions` (services/printOptions.ts). منطق التحقق في
// ذلك الملف (يُختبَر بـnode)؛ هنا عرض فقط، بأنماط inline وخط Cairo كبقية المشروع.
//
// الضغط على "طباعة" لا يُغلق النافذة: تبقى مفتوحة بحالة "جارٍ الإرسال" حتى تنتهي
// الطباعة؛ فإن فشلت (طابعة غير متصلة مثلاً) يظهر السبب داخلها ويمكن تغيير الطابعة
// وإعادة المحاولة دون إعادة تجهيز الفاتورة. لا إغلاق بالنقر خارجها (تفادياً للإلغاء
// بالخطأ)؛ Escape للإلغاء، وEnter داخل خانة رقمية للطباعة.
// ============================================================================

import { useEffect, useState, useSyncExternalStore } from "react";
import { Loader2, Printer, TriangleAlert } from "lucide-react";
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
  select: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #CBD5E1",
    fontSize: "14px",
    fontFamily: font,
    color: "#1E293B",
    backgroundColor: "white",
    boxSizing: "border-box" as const,
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

  const [printer, setPrinter] = useState(info.printers.includes(info.savedPrinter) ? info.savedPrinter : "");
  const [copies, setCopies] = useState("1");
  const [mode, setMode] = useState<SelectionMode>("all");
  const [single, setSingle] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const multiPage = info.pageCount > 1;
  const copiesResult = resolveCopies(copies);
  const selection = resolveSelection({ mode, single, from, to }, info.pageCount);
  const canPrint = !busy && copiesResult.ok && selection.ok;

  const handlePrint = async () => {
    if (busy || !copiesResult.ok || !selection.ok) return;
    setBusy(true);
    setError(null);
    try {
      await submit({ printerName: printer, copies: copiesResult.value, range: selection.value });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
      return;
    }
    finish(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) finish(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, finish]);

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
            <label style={s.label} htmlFor="mks-print-printer">الطابعة</label>
            <select id="mks-print-printer" style={s.select} value={printer} disabled={busy} autoFocus onChange={(e) => setPrinter(e.target.value)}>
              <option value="">طابعة النظام الافتراضية</option>
              {info.printers.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            {info.printers.length === 0 && (
              <div style={{ ...s.warn, marginTop: "8px" }}>لم يُعثر على طابعات مثبَّتة — سيُستخدَم إعداد طابعة النظام الافتراضية.</div>
            )}
          </div>

          <div>
            <label style={s.label} htmlFor="mks-print-copies">عدد النسخ</label>
            <input
              id="mks-print-copies"
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
              </>
            ) : (
              <div style={s.muted}>الفاتورة من صفحة واحدة — ستُطبَع كاملة.</div>
            )}
          </div>

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
            onClick={() => finish(false)}
            disabled={busy}
            style={{ ...s.btn, backgroundColor: "white", color: "#475569", borderColor: "#CBD5E1", opacity: busy ? 0.55 : 1, cursor: busy ? "not-allowed" : "pointer" }}
          >
            إلغاء
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
