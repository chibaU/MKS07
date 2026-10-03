// مراجعة فاتورة قادمة من الهاتف قبل الحفظ (المتطلبان 14–16 و18).
// تعرض «النتيجة النهائية» المحسوبة ببيانات الكمبيوتر الحالية، وبعد تأكيد المستخدم
// فقط تُحفَظ عبر phoneImportService (db.ts). عند التأكيد تُعاد المراجعة ببيانات
// طازجة أولاً — فلو تغيّر تاجر/صندوق بين العرض والضغط لا يُحفَظ شيء بصمت.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { formatMoney } from "../../components/InvoiceShared";
import { boxService, merchantService, phoneImportService, StaleReferenceError } from "../../services/db";
import { errText, phoneSyncApi } from "./bridge";
import { buildReview, parsePayload, toImportInput, type Review } from "./review";
import type { PhoneInvoiceRecord } from "./types";

const r = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, direction: "rtl", fontFamily: "'Cairo', sans-serif" } as CSSProperties,
  sheet: { background: "#F8FAFC", borderRadius: 14, width: "min(980px, 100%)", maxHeight: "92vh", overflow: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.35)" } as CSSProperties,
  head: { padding: "16px 22px", background: "#1E293B", color: "#fff", display: "flex", alignItems: "center", gap: 12, borderRadius: "14px 14px 0 0", position: "sticky", top: 0, zIndex: 1 } as CSSProperties,
  body: { padding: "18px 22px 22px" } as CSSProperties,
  card: { background: "#fff", border: "1px solid #CBD5E1", borderRadius: 10, padding: "14px 16px", marginBottom: 14 } as CSSProperties,
  th: { background: "#F1F5F9", padding: "9px 10px", textAlign: "right", fontSize: 13, borderBottom: "2px solid #CBD5E1", whiteSpace: "nowrap" } as CSSProperties,
  td: { padding: "9px 10px", borderBottom: "1px solid #E2E8F0", fontSize: 14, verticalAlign: "top" } as CSSProperties,
  btn: { padding: "10px 20px", borderRadius: 8, border: "none", background: "#059669", color: "#fff", cursor: "pointer", fontFamily: "'Cairo', sans-serif", fontSize: 15, fontWeight: 700 } as CSSProperties,
  btnAlt: { padding: "10px 16px", borderRadius: 8, border: "1.5px solid #64748B", background: "#fff", color: "#1E293B", cursor: "pointer", fontFamily: "'Cairo', sans-serif", fontSize: 14 } as CSSProperties,
  btnDanger: { padding: "10px 16px", borderRadius: 8, border: "1.5px solid #B91C1C", background: "#fff", color: "#B91C1C", cursor: "pointer", fontFamily: "'Cairo', sans-serif", fontSize: 14 } as CSSProperties,
};

const kg = (n: number) => `${n.toFixed(2)} كغ`;

const Box = ({ kind, children }: { kind: "err" | "warn" | "ok"; children: React.ReactNode }) => {
  const t = { err: ["#FEE2E2", "#991B1B"], warn: ["#FEF3C7", "#92400E"], ok: ["#D1FAE5", "#065F46"] }[kind];
  return <div style={{ background: t[0], color: t[1], borderRadius: 8, padding: "9px 12px", margin: "6px 0", fontSize: 14, lineHeight: 1.7 }}>{children}</div>;
};

interface Props {
  record: PhoneInvoiceRecord;
  onClose: () => void;
  onChanged: () => void;
}

export function ReviewPanel({ record, onClose, onChanged }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "warn" | "ok"; text: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [doneNumber, setDoneNumber] = useState<string | null>(null);
  const confirmingRef = useRef(false); // يمنع الضغط المزدوج قبل أن تتحدّث الحالة
  const isPending = record.status === "pending";

  const compute = useCallback(async (): Promise<Review | null> => {
    const parsed = parsePayload(record.payload);
    if (!parsed.ok) {
      setParseError(parsed.error);
      return null;
    }
    setParseError(null);
    const [merchants, boxes] = await Promise.all([merchantService.getAll(), boxService.getAll()]);
    return buildReview(parsed.payload, merchants, boxes);
  }, [record.payload]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setReview(await compute());
    } catch (e) {
      setMsg({ kind: "err", text: `تعذر قراءة بيانات النظام: ${errText(e)}` });
    } finally {
      setLoading(false);
    }
  }, [compute]);

  useEffect(() => { void refresh(); }, [refresh]);

  const confirm = async () => {
    if (confirmingRef.current || !isPending) return;
    confirmingRef.current = true;
    setBusy(true);
    setMsg(null);
    try {
      // مراجعة طازجة لحظة التأكيد.
      const fresh = await compute();
      if (!fresh) return;
      setReview(fresh);
      if (!fresh.canConfirm) {
        setMsg({ kind: "err", text: "تغيّرت بيانات النظام منذ آخر عرض وظهر تعارض — راجع التفاصيل أدناه. لم يُحفَظ شيء." });
        return;
      }
      const result = await phoneImportService.importInvoice(toImportInput(fresh));
      try {
        await phoneSyncApi.confirm(record.clientId, result.invoiceNumber, result.invoiceId);
      } catch (e) {
        // الفاتورة محفوظة فعلاً في القاعدة؛ فقط تسجيل التأكيد تعثّر. إعادة الضغط آمنة (لا تكرار).
        setMsg({
          kind: "warn",
          text: `حُفظت الفاتورة برقم ${result.invoiceNumber} لكن تعذر تسجيل التأكيد (${errText(e)}). اضغط «تأكيد» مرة أخرى لإكمال التسجيل — لن تتكرر الفاتورة.`,
        });
        return;
      }
      setDoneNumber(result.invoiceNumber);
      onChanged();
    } catch (e) {
      if (e instanceof StaleReferenceError) {
        setMsg({ kind: "err", text: e.message });
        await refresh();
      } else {
        setMsg({ kind: "err", text: `تعذر حفظ الفاتورة: ${errText(e)} — لم يتغيّر شيء، ونسخة الهاتف باقية.` });
      }
    } finally {
      confirmingRef.current = false;
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await phoneSyncApi.reject(record.clientId, reason.trim());
      onChanged();
      onClose();
    } catch (e) {
      setMsg({ kind: "err", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const simple = async (fn: () => Promise<unknown>, close: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      onChanged();
      if (close) onClose();
    } catch (e) {
      setMsg({ kind: "err", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={r.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={r.sheet} role="dialog" aria-modal="true" aria-label="مراجعة فاتورة من الهاتف">
        <div style={r.head}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 17 }}>
            مراجعة فاتورة من الهاتف{record.deviceLabel ? ` — ${record.deviceLabel}` : ""}
          </div>
          <button type="button" onClick={onClose} disabled={busy} style={{ background: "transparent", border: "none", color: "#fff", fontSize: 20, cursor: "pointer" }} aria-label="إغلاق">✕</button>
        </div>

        <div style={r.body}>
          {doneNumber && (
            <Box kind="ok">
              ✓ تم الحفظ في النظام برقم <strong dir="ltr">{doneNumber}</strong>، وأُرسل التأكيد للهاتف عند اتصاله القادم.
              <div style={{ marginTop: 8 }}><button type="button" style={r.btnAlt} onClick={onClose}>إغلاق</button></div>
            </Box>
          )}
          {msg && <Box kind={msg.kind}>{msg.text}</Box>}
          {parseError && <Box kind="err">بيانات هذه الفاتورة تالفة: {parseError}. يمكنك رفضها فقط.</Box>}

          {record.status === "confirmed" && (
            <Box kind="ok">اعتُمدت وحُفظت برقم <strong dir="ltr">{record.invoiceNumber}</strong>.</Box>
          )}
          {record.status === "rejected" && (
            <Box kind="err">رُفضت{record.rejectReason ? `: ${record.rejectReason}` : ""}.</Box>
          )}

          {loading && <div style={{ padding: 20, color: "#64748B" }}>جاري الفحص…</div>}

          {review && !doneNumber && (
            <>
              <div style={r.card}>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  <div><div style={{ color: "#64748B", fontSize: 13 }}>التاجر (الحالي في النظام)</div>
                    <div style={{ fontWeight: 700, fontSize: 17, color: review.merchant.exists ? "#0F172A" : "#B91C1C" }}>{review.merchant.name}{!review.merchant.exists && " — غير موجود"}</div></div>
                  <div><div style={{ color: "#64748B", fontSize: 13 }}>تاريخ الفاتورة</div><div style={{ fontWeight: 700, fontSize: 17 }} dir="ltr">{review.invoiceDate}</div></div>
                  <div><div style={{ color: "#64748B", fontSize: 13 }}>رقم الفاتورة</div><div style={{ fontSize: 15 }}>يُولَّد عند الاعتماد</div></div>
                </div>
              </div>

              {review.conflicts.map((t, i) => <Box key={`c${i}`} kind="err">⛔ {t}</Box>)}
              {review.warnings.map((t, i) => <Box key={`w${i}`} kind="warn">⚠ {t}</Box>)}

              <div style={{ ...r.card, padding: 0, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                  <thead>
                    <tr>
                      {["#", "المنتج", "وزن الميزان", "الصناديق (الأوزان الحالية)", "وزن الصناديق", "الوزن الصافي", "السعر", "المجموع"].map((t) => <th key={t} style={r.th}>{t}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {review.lines.map((l) => (
                      <tr key={l.index} style={{ background: l.problems.length ? "#FEF2F2" : undefined }}>
                        <td style={r.td}>{l.index}</td>
                        <td style={r.td}>
                          <strong>{l.productName || "—"}</strong>
                          {l.problems.map((t, i) => <div key={`p${i}`} style={{ color: "#B91C1C", fontSize: 13 }}>⛔ {t}</div>)}
                          {l.warnings.map((t, i) => <div key={`n${i}`} style={{ color: "#92400E", fontSize: 13 }}>⚠ {t}</div>)}
                        </td>
                        <td style={r.td}>{kg(l.scaleWeight)}</td>
                        <td style={r.td}>
                          {l.boxes.length === 0 ? "—" : l.boxes.map((b) => (
                            <div key={b.boxId} style={{ color: b.exists ? undefined : "#B91C1C" }}>
                              {b.name} × {b.boxCount}{b.exists ? ` @ ${kg(b.weight)}` : " (غير موجود)"}
                            </div>
                          ))}
                        </td>
                        <td style={r.td}>{kg(l.emptiesWeight)}</td>
                        <td style={{ ...r.td, fontWeight: 700, color: l.netWeight < 0 ? "#B91C1C" : "#065F46" }}>{kg(l.netWeight)}</td>
                        <td style={r.td}>{formatMoney(l.price)}</td>
                        <td style={{ ...r.td, fontWeight: 700 }}>{formatMoney(l.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={8} style={{ ...r.td, background: "#F1F5F9", fontWeight: 700 }}>
                        إجمالي الوزن الصافي: {kg(review.totalNet)} — عدد الصناديق: {review.totalBoxes} — الإجمالي الكلي: {formatMoney(review.total)} دج
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div style={{ color: "#64748B", fontSize: 13, marginBottom: 12 }}>
                هذه هي النتيجة التي ستُحفَظ: أُعيد حسابها ببيانات النظام الحالية (وليس بما كان على الهاتف).
              </div>
            </>
          )}

          {isPending && !doneNumber && !rejecting && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" style={{ ...r.btn, opacity: !review?.canConfirm || busy ? 0.45 : 1, cursor: !review?.canConfirm || busy ? "not-allowed" : "pointer" }} disabled={!review?.canConfirm || busy} onClick={confirm}>
                {busy ? "جاري الحفظ…" : "✓ تأكيد وحفظ في النظام"}
              </button>
              <button type="button" style={r.btnAlt} disabled={busy} onClick={() => void refresh()}>إعادة الفحص</button>
              <button type="button" style={r.btnDanger} disabled={busy} onClick={() => setRejecting(true)}>رفض الفاتورة</button>
            </div>
          )}

          {isPending && rejecting && (
            <div style={r.card}>
              <label htmlFor="rj" style={{ fontWeight: 700 }}>سبب الرفض (يظهر على الهاتف)</label>
              <input id="rj" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="مثال: التاجر محذوف"
                style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 8, border: "1.5px solid #64748B", fontFamily: "inherit", fontSize: 15, boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button type="button" style={r.btnDanger} disabled={busy} onClick={reject}>تأكيد الرفض</button>
                <button type="button" style={r.btnAlt} disabled={busy} onClick={() => setRejecting(false)}>تراجع</button>
              </div>
              <div style={{ color: "#64748B", fontSize: 13, marginTop: 8 }}>ستبقى نسخة الفاتورة على الهاتف (مرفوضة) ليصححها صاحبها.</div>
            </div>
          )}

          {record.status === "rejected" && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" style={r.btnAlt} disabled={busy} onClick={() => void simple(() => phoneSyncApi.reopen(record.clientId), true)}>إعادتها إلى الانتظار</button>
              <button type="button" style={r.btnDanger} disabled={busy} onClick={() => { if (window.confirm("حذف سجل هذه الفاتورة المرفوضة من الكمبيوتر؟")) void simple(() => phoneSyncApi.deleteFinished(record.clientId), true); }}>حذف السجل</button>
            </div>
          )}
          {record.status === "confirmed" && (
            <button type="button" style={r.btnAlt} disabled={busy} onClick={() => { if (window.confirm("حذف سجل التأكيد من هذه القائمة؟ الفاتورة نفسها تبقى محفوظة في النظام.")) void simple(() => phoneSyncApi.deleteFinished(record.clientId), true); }}>حذف من القائمة</button>
          )}
        </div>
      </div>
    </div>
  );
}
