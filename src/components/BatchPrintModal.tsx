// ============================================================================
// نافذة "طباعة جماعية (PDF)" في صفحة أرشيف الفواتير (AI_CONTEXT.md القسم 6.5).
//
// تختار تاجراً مسجَّلاً + فترة (من/إلى شاملتين) ← "معاينة" (قراءة فقط) ← "إنشاء
// ملف PDF" الذي يدمج كل فواتير التاجر في الفترة بترتيب (التاريخ ثم id) في ملف
// واحد يُحفَظ في التنزيلات. كل المنطق في services/batchPrint.ts؛ هنا عرض فقط.
//
// قواعد العرض:
//  - لا فواتير في الفترة ← رسالة واضحة والزر معطَّل.
//  - فواتير مفتوحة (is_open = 1) ← رسالة منع + قائمة أرقامها والزر معطَّل.
//  - أثناء التوليد: شريط تقدم صادق، تُعطَّل بقية عناصر النافذة، ولا يمكن
//    إغلاقها إلا بـ"إلغاء" (يوقف بعد الخطوة الجارية وينظّف المؤقتات).
//  - مغادرة الصفحة (إزالة المكوّن) أثناء العمل تُعامَل كإلغاء مع تنظيف.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { X, FileText, Search, FolderOpen } from "lucide-react";
import { merchantService, type Merchant } from "../services/db";
import { Autocomplete, formatMoney, type Suggestion } from "./InvoiceShared";
import {
  BatchBlockedError,
  BatchCancelledError,
  blockedMessage,
  createBatchPdf,
  invoiceDisplayNumber,
  loadBatchPreview,
  revealBatchPdf,
  validateRange,
  type BatchPdfResult,
  type BatchPreview,
  type BatchProgress,
} from "../services/batchPrint";

const s = {
  overlay: {
    position: "fixed" as const,
    inset: 0,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    direction: "rtl" as const,
    fontFamily: "'Cairo', sans-serif",
  },
  dialog: {
    width: "min(700px, 94vw)",
    maxHeight: "92vh",
    backgroundColor: "white",
    borderRadius: "14px",
    boxShadow: "0 20px 50px rgba(0,0,0,0.30)",
    display: "flex",
    flexDirection: "column" as const,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 22px",
    borderBottom: "1px solid #E2E8F0",
  },
  title: { margin: 0, color: "#1E293B", fontSize: "18px", fontWeight: 700 },
  closeBtn: { border: "none", background: "none", cursor: "pointer", color: "#64748B", padding: "4px", display: "inline-flex" },
  body: { padding: "18px 22px", display: "flex", flexDirection: "column" as const, gap: "16px", overflowY: "auto" as const },
  label: { display: "block", color: "#334155", fontSize: "14px", fontWeight: 700, marginBottom: "6px" },
  dateRow: { display: "flex", gap: "14px", flexWrap: "wrap" as const, alignItems: "flex-end" },
  dateField: { display: "flex", flexDirection: "column" as const, flex: 1, minWidth: "170px" },
  dateInput: {
    padding: "10px 12px",
    border: "2px solid #94A3B8",
    borderRadius: "8px",
    fontSize: "15px",
    fontFamily: "'Cairo', sans-serif",
    outline: "none",
    colorScheme: "light" as const,
    boxSizing: "border-box" as const,
    width: "100%",
  },
  hint: { color: "#B45309", fontSize: "13px", marginTop: "6px" },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    borderRadius: "8px",
    padding: "10px 18px",
    fontSize: "14px",
    fontWeight: 700,
    fontFamily: "'Cairo', sans-serif",
    cursor: "pointer",
    border: "1px solid transparent",
  },
  btnPrimary: { backgroundColor: "#2563EB", color: "white", borderColor: "#2563EB" },
  btnSecondary: { backgroundColor: "#EFF6FF", color: "#1D4ED8", borderColor: "#BFDBFE" },
  btnGhost: { backgroundColor: "white", color: "#475569", borderColor: "#CBD5E1" },
  btnDanger: { backgroundColor: "#FEF2F2", color: "#B91C1C", borderColor: "#FECACA" },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed" },
  box: { borderRadius: "10px", padding: "12px 14px", fontSize: "14px", lineHeight: 1.8 },
  boxInfo: { backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", color: "#334155" },
  boxWarn: { backgroundColor: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E" },
  boxError: { backgroundColor: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B" },
  boxOk: { backgroundColor: "#F0FDF4", border: "1px solid #BBF7D0", color: "#166534" },
  summaryRow: { display: "flex", gap: "22px", flexWrap: "wrap" as const, fontSize: "15px", color: "#1E293B" },
  listWrap: { border: "1px solid #E2E8F0", borderRadius: "10px", maxHeight: "min(260px, 32vh)", overflowY: "auto" as const },
  table: { width: "100%", borderCollapse: "collapse" as const, textAlign: "right" as const },
  th: { backgroundColor: "#F8FAFC", color: "#64748B", fontWeight: 700, fontSize: "13px", padding: "9px 14px", borderBottom: "1px solid #E2E8F0", position: "sticky" as const, top: 0 },
  td: { padding: "8px 14px", borderBottom: "1px solid #F1F5F9", color: "#334155", fontSize: "14px" },
  progressTrack: { height: "14px", backgroundColor: "#E2E8F0", borderRadius: "7px", overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#2563EB", transition: "width 0.25s ease" },
  footer: { display: "flex", gap: "10px", justifyContent: "flex-start", padding: "14px 22px", borderTop: "1px solid #E2E8F0", flexWrap: "wrap" as const },
  pathLabel: { fontSize: "12px", color: "#15803D", marginTop: "8px" },
  pathBox: { wordBreak: "break-all" as const, userSelect: "text" as const, fontSize: "14px", backgroundColor: "white", border: "1px solid #BBF7D0", borderRadius: "6px", padding: "6px 10px", marginTop: "2px" },
};

// اسم الملف بعربي + ذيل لاتيني (التاريخان والامتداد): نعزل الذيل كمقطع LTR كي لا
// تنقلب أجزاؤه (2026-10-01 … .pdf) داخل الفقرة العربية؛ الاسم الفعلي لم يتغيّر.
function FileNameView({ name }: { name: string }) {
  const m = name.match(/^(.*?)(_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}(?: \(\d+\))?\.pdf)$/);
  if (!m) return <>{name}</>;
  return (
    <>
      <span>{m[1]}</span>
      <bdi dir="ltr">{m[2]}</bdi>
    </>
  );
}

// يفصل المسار الكامل إلى مجلد + اسم ملف للعرض فقط: اسم الملف عربي والمسار لاتيني،
// وعرضهما في سطر واحد يبعثر ترتيب الأجزاء (الخوارزمية الثنائية الاتجاه) فيُعرَض كلٌّ في سطره.
function splitPath(full: string): { dir: string; name: string } {
  const i = Math.max(full.lastIndexOf("\\"), full.lastIndexOf("/"));
  return i < 0 ? { dir: "", name: full } : { dir: full.slice(0, i + 1), name: full.slice(i + 1) };
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; preview: BatchPreview }
  | { status: "error"; message: string };

type RunState =
  | { status: "idle"; notice?: string }
  | { status: "running"; progress: BatchProgress; cancelling: boolean }
  | { status: "success"; result: BatchPdfResult }
  | { status: "error"; message: string };

interface BatchPrintModalProps {
  onClose: () => void;
}

export function BatchPrintModal({ onClose }: BatchPrintModalProps) {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantsState, setMerchantsState] = useState<"loading" | "ready" | "error">("loading");
  const [merchantText, setMerchantText] = useState("");
  const [merchantId, setMerchantId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [previewState, setPreviewState] = useState<PreviewState>({ status: "idle" });
  const [run, setRun] = useState<RunState>({ status: "idle" });
  // زر "فتح مكان الملف" بعد النجاح: busy يمنع تكرار الضغط، وerror رسالة تعذّر الفتح.
  const [reveal, setReveal] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  // طلب إلغاء العملية الجارية: تقرأه الحلقة بين الخطوات (isCancelled) — ref لا state
  // كي تراه فوراً دون انتظار إعادة رسم.
  const cancelRef = useRef(false);
  // رقم تسلسلي لطلبات المعاينة: نتيجة طلب قديم (تغيّرت المدخلات بعده) تُهمَل.
  const previewSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    merchantService
      .getAll()
      .then((list) => {
        if (!alive) return;
        setMerchants(list);
        setMerchantsState("ready");
      })
      .catch((error) => {
        console.error("تعذّر تحميل قائمة التجار:", error);
        if (alive) setMerchantsState("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  // مغادرة الصفحة/إزالة النافذة أثناء العمل = إلغاء (الحلقة تنظّف المؤقتات).
  useEffect(() => {
    return () => {
      cancelRef.current = true;
    };
  }, []);

  const suggestions: Suggestion[] = useMemo(
    () => merchants.map((m) => ({ id: m.id, label: m.name, labelLower: m.name.toLowerCase() })),
    [merchants],
  );

  const selectedMerchant = useMemo(
    () => merchants.find((m) => m.id === merchantId) ?? null,
    [merchants, merchantId],
  );

  const running = run.status === "running";
  const rangeError = validateRange(dateFrom, dateTo);
  const canPreview =
    selectedMerchant !== null && rangeError === null && previewState.status !== "loading" && !running;
  const preview = previewState.status === "ready" ? previewState.preview : null;
  const canGenerate =
    preview !== null &&
    preview.invoices.length > 0 &&
    preview.openInvoices.length === 0 &&
    selectedMerchant !== null &&
    run.status !== "running" &&
    run.status !== "success";

  // أي تغيير في المدخلات يُبطل المعاينة الحالية (لا يُنشأ ملف إلا من معاينة مطابقة).
  const invalidatePreview = () => {
    previewSeq.current += 1;
    setPreviewState({ status: "idle" });
    setRun((prev) => (prev.status === "running" ? prev : { status: "idle" }));
    setReveal({ busy: false, error: null });
  };

  const handleMerchantTextChange = (value: string) => {
    setMerchantText(value);
    setMerchantId(null); // أي تعديل يدوي بعد الاختيار يُلغيه: لا بد من اختيار تاجر مسجَّل من القائمة
    invalidatePreview();
  };

  const handleMerchantSelect = (label: string, id?: number) => {
    setMerchantText(label);
    setMerchantId(id ?? null);
    invalidatePreview();
  };

  const handlePreview = async () => {
    if (!canPreview || selectedMerchant === null) return;
    const seq = ++previewSeq.current;
    setPreviewState({ status: "loading" });
    setRun({ status: "idle" });
    try {
      const result = await loadBatchPreview(selectedMerchant.id, dateFrom, dateTo);
      if (seq === previewSeq.current) setPreviewState({ status: "ready", preview: result });
    } catch (error) {
      console.error("خطأ أثناء معاينة الفواتير:", error);
      if (seq === previewSeq.current) {
        setPreviewState({
          status: "error",
          message: error instanceof Error ? error.message : "تعذّر جلب فواتير هذه الفترة.",
        });
      }
    }
  };

  const handleReveal = async () => {
    if (run.status !== "success" || reveal.busy) return;
    setReveal({ busy: true, error: null });
    try {
      await revealBatchPdf(run.result.path);
      setReveal({ busy: false, error: null });
    } catch (error) {
      console.error("تعذّر فتح مكان ملف PDF:", error);
      setReveal({
        busy: false,
        error: error instanceof Error ? error.message : "تعذّر فتح مكان الملف.",
      });
    }
  };

  const handleGenerate = async () => {
    if (!canGenerate || preview === null || selectedMerchant === null) return;
    cancelRef.current = false;
    setReveal({ busy: false, error: null });
    setRun({
      status: "running",
      progress: { phase: "build", fraction: 0, text: "جارٍ البدء…" },
      cancelling: false,
    });
    try {
      const result = await createBatchPdf({
        merchantId: selectedMerchant.id,
        merchantName: selectedMerchant.name,
        dateFrom,
        dateTo,
        previewSignature: preview.signature,
        onProgress: (progress) =>
          setRun((prev) => (prev.status === "running" ? { ...prev, progress } : prev)),
        isCancelled: () => cancelRef.current,
      });
      setRun({ status: "success", result });
    } catch (error) {
      if (error instanceof BatchCancelledError) {
        setRun({ status: "idle", notice: "أُلغيت العملية ولم يُنشأ أي ملف." });
        return;
      }
      console.error("خطأ أثناء إنشاء ملف PDF الجماعي:", error);
      if (error instanceof BatchBlockedError) {
        // الحالة تغيّرت منذ المعاينة (فُتحت فاتورة) — نُبطل المعاينة ليعيدها المستخدم.
        previewSeq.current += 1;
        setPreviewState({ status: "idle" });
      }
      setRun({
        status: "error",
        message: error instanceof Error ? error.message : "تعذّر إنشاء ملف PDF.",
      });
    }
  };

  const handleCancel = () => {
    cancelRef.current = true;
    setRun((prev) => (prev.status === "running" ? { ...prev, cancelling: true } : prev));
  };

  const disabledStyle = (disabled: boolean) => (disabled ? s.btnDisabled : {});

  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-label="طباعة جماعية لفواتير تاجر">
      <div style={s.dialog}>
        <div style={s.header}>
          <h2 style={s.title}>🖨️ طباعة جماعية لفواتير تاجر (ملف PDF واحد)</h2>
          {!running && (
            <button style={s.closeBtn} onClick={onClose} title="إغلاق" aria-label="إغلاق">
              <X size={20} />
            </button>
          )}
        </div>

        <div style={s.body}>
          {/* النموذج: يُعطَّل بالكامل أثناء التوليد */}
          <div
            inert={running}
            style={{ display: "flex", flexDirection: "column", gap: "16px", opacity: running ? 0.55 : 1 }}
          >
            <div>
              <label style={s.label}>التاجر</label>
              <Autocomplete
                value={merchantText}
                onChange={handleMerchantTextChange}
                onSelect={handleMerchantSelect}
                suggestions={suggestions}
                placeholder="ابحث عن تاجر مسجَّل واخترْه من القائمة"
                style={{ fontSize: "15px", padding: "10px 14px" }}
              />
              {merchantsState === "loading" && <div style={{ ...s.hint, color: "#64748B" }}>جاري تحميل التجار…</div>}
              {merchantsState === "error" && <div style={{ ...s.hint, color: "#B91C1C" }}>تعذّر تحميل قائمة التجار.</div>}
              {merchantsState === "ready" && merchants.length === 0 && (
                <div style={s.hint}>لا يوجد تجار مسجَّلون بعد.</div>
              )}
              {merchantText.trim() !== "" && merchantId === null && merchants.length > 0 && (
                <div style={s.hint}>اختر التاجر من القائمة المنسدلة — يجب أن يكون تاجراً مسجَّلاً.</div>
              )}
            </div>

            <div style={s.dateRow}>
              <div style={s.dateField}>
                <label style={s.label}>من تاريخ</label>
                <input
                  type="date"
                  style={s.dateInput}
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    invalidatePreview();
                  }}
                />
              </div>
              <div style={s.dateField}>
                <label style={s.label}>إلى تاريخ (شامل)</label>
                <input
                  type="date"
                  style={s.dateInput}
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    invalidatePreview();
                  }}
                />
              </div>
              <button
                style={{ ...s.btn, ...s.btnSecondary, ...disabledStyle(!canPreview) }}
                onClick={handlePreview}
                disabled={!canPreview}
              >
                <Search size={16} /> {previewState.status === "loading" ? "جارٍ الجلب…" : "معاينة"}
              </button>
            </div>
            {dateFrom !== "" && dateTo !== "" && rangeError !== null && (
              <div style={{ ...s.hint, marginTop: 0 }}>{rangeError}</div>
            )}
          </div>

          {/* نتيجة المعاينة */}
          {previewState.status === "error" && (
            <div style={{ ...s.box, ...s.boxError }}>{previewState.message}</div>
          )}

          {preview !== null && preview.invoices.length === 0 && (
            <div style={{ ...s.box, ...s.boxWarn }}>لا توجد فواتير لهذا التاجر في هذه الفترة.</div>
          )}

          {preview !== null && preview.invoices.length > 0 && (
            <>
              <div style={s.summaryRow}>
                <span>
                  عدد الفواتير: <strong>{preview.invoices.length}</strong>
                </span>
                <span>
                  الإجمالي العام: <strong>{formatMoney(preview.grandTotal)} دج</strong>
                </span>
              </div>

              {preview.openInvoices.length > 0 && (
                <div style={{ ...s.box, ...s.boxError }}>
                  {blockedMessage(preview.openInvoices.map(invoiceDisplayNumber))}
                </div>
              )}

              <div style={s.listWrap}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>رقم الفاتورة</th>
                      <th style={s.th}>التاريخ</th>
                      <th style={s.th}>الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td style={{ ...s.td, fontFamily: "monospace", fontWeight: 600 }}>
                          {invoiceDisplayNumber(inv)}
                          {inv.is_open === 1 && (
                            <span style={{ color: "#B91C1C", fontFamily: "'Cairo', sans-serif", marginRight: "8px", fontSize: "12px" }}>
                              (مفتوحة)
                            </span>
                          )}
                        </td>
                        <td style={s.td}>{inv.invoice_date || "—"}</td>
                        <td style={{ ...s.td, fontWeight: 600 }}>{formatMoney(inv.total_amount)} دج</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* التوليد الجاري */}
          {run.status === "running" && (
            <div style={{ ...s.box, ...s.boxInfo }}>
              <div style={s.progressTrack}>
                <div style={{ ...s.progressFill, width: `${Math.round(run.progress.fraction * 100)}%` }} />
              </div>
              <div style={{ marginTop: "8px", fontWeight: 600 }}>
                {run.cancelling ? "جارٍ الإلغاء بعد إنهاء الخطوة الجارية…" : run.progress.text}
              </div>
            </div>
          )}

          {run.status === "idle" && run.notice && (
            <div style={{ ...s.box, ...s.boxWarn }}>{run.notice}</div>
          )}

          {run.status === "error" && <div style={{ ...s.box, ...s.boxError }}>{run.message}</div>}

          {run.status === "success" && (
            <div style={{ ...s.box, ...s.boxOk }}>
              <strong>✓ تم إنشاء الملف</strong>
              <div>
                {run.result.invoiceCount} فاتورة — {run.result.pages} صفحة. حُفظ الملف في مجلد التنزيلات (المسار الكامل أدناه):
              </div>
              <div style={s.pathLabel}>المجلد</div>
              <div style={{ ...s.pathBox, direction: "ltr", textAlign: "left", fontFamily: "monospace", fontSize: "13px" }}>
                {splitPath(run.result.path).dir}
              </div>
              <div style={s.pathLabel}>اسم الملف</div>
              <div style={{ ...s.pathBox, direction: "rtl", textAlign: "right" }}>
                <FileNameView name={splitPath(run.result.path).name} />
              </div>
              <div style={{ ...s.pathLabel, marginTop: "10px" }}>
                إن أُغلق المستكشف أو اختفى، اضغط «فتح مكان الملف» لإظهار الملف محدَّداً.
              </div>
            </div>
          )}

          {run.status === "success" && reveal.error && (
            <div style={{ ...s.box, ...s.boxError }}>{reveal.error}</div>
          )}
        </div>

        <div style={s.footer}>
          {run.status === "running" ? (
            <button
              style={{ ...s.btn, ...s.btnDanger, ...disabledStyle(run.cancelling) }}
              onClick={handleCancel}
              disabled={run.cancelling}
            >
              {run.cancelling ? "جارٍ الإلغاء…" : "إلغاء"}
            </button>
          ) : (
            <>
              {run.status !== "success" && (
                <button
                  style={{ ...s.btn, ...s.btnPrimary, ...disabledStyle(!canGenerate) }}
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                >
                  <FileText size={16} /> إنشاء ملف PDF
                </button>
              )}
              {run.status === "success" && (
                <button
                  style={{ ...s.btn, ...s.btnPrimary, ...disabledStyle(reveal.busy) }}
                  onClick={handleReveal}
                  disabled={reveal.busy}
                >
                  <FolderOpen size={16} /> فتح مكان الملف
                </button>
              )}
              <button style={{ ...s.btn, ...s.btnGhost }} onClick={onClose}>
                إغلاق
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
