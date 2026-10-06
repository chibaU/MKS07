// نافذة المراجعة: تعرض **النتيجة النهائية التي سيحفظها النظام فعلاً** (بعد إعادة الحساب
// من بيانات الكمبيوتر الحالية) — لا ما حسبه الهاتف. لا اعتماد مع وجود تعارض.

import { useCallback, useEffect, useState } from "react";
import { CircleCheck, CircleX, Info, RefreshCw, TriangleAlert, X } from "lucide-react";
import { formatMoney } from "../../../components/InvoiceShared";
import { errText } from "../bridge.ts";
import type { Issue, ReviewResult } from "../domain/review.ts";
import { reviewFor } from "../services/confirm.ts";
import { loadReferenceData } from "../services/data.ts";
import { confirmInvoice, releaseStuck, rejectInvoice, usePhoneSync } from "../store.ts";
import { Banner, Btn, Chip } from "./ui.tsx";
import { fmtDateTime, font, s, w2 } from "./styles.ts";

function IssueRow({ issue }: { issue: Issue }) {
  const map = {
    conflict: { icon: <CircleX size={15} color="#DC2626" />, color: "#991B1B", bg: "#FEF2F2" },
    warning: { icon: <TriangleAlert size={15} color="#D97706" />, color: "#92400E", bg: "#FFFBEB" },
    info: { icon: <Info size={15} color="#2563EB" />, color: "#1E40AF", bg: "#EFF6FF" },
  }[issue.level];
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", padding: "7px 10px", backgroundColor: map.bg, borderRadius: "8px", color: map.color, fontSize: "13px", lineHeight: 1.7 }}>
      <span style={{ marginTop: "3px" }}>{map.icon}</span>
      <span>{issue.message}</span>
    </div>
  );
}

export function ReviewDialog({ uid, onClose }: { uid: string; onClose: () => void }) {
  const st = usePhoneSync();
  const rec = st.inbox.find((r) => r.uid === uid) ?? null;
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const busy = st.busy !== null;
  const attention = st.attention[uid];

  // محرّك إعادة الحساب: كل زيادة في reloadTick تعيد قراءة بيانات النظام الحالية وحساب المراجعة.
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  useEffect(() => {
    if (!rec) return;
    let cancelled = false;
    (async () => {
      try {
        const next = reviewFor(rec, await loadReferenceData());
        if (!cancelled) {
          setReview(next);
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) setLoadError(errText(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rec, reloadTick]);

  // الفاتورة اختفت من القائمة (اعتُمدت أو رُفضت) → أغلق.
  useEffect(() => {
    if (st.loaded && !rec) onClose();
  }, [st.loaded, rec, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  if (!rec) return null;
  const isSaving = rec.state === "saving";

  return (
    <div
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(15,23,42,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        dir="rtl"
        style={{ backgroundColor: "white", borderRadius: "14px", width: "min(1000px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", fontFamily: font, boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}
      >
        <div style={{ ...s.row, justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #E2E8F0" }}>
          <div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: "#1E293B" }}>مراجعة فاتورة واردة من الهاتف</div>
            <div style={s.muted}>
              وصلت {fmtDateTime(rec.receivedAt)}
              {rec.deviceLabel ? ` — ${rec.deviceLabel}` : ""}
              {rec.receiveCount > 1 ? ` — أُرسلت ${rec.receiveCount} مرات (لم تتكرر)` : ""}
            </div>
          </div>
          <div style={s.row}>
            <Btn small onClick={reload} title="إعادة الحساب من بيانات النظام الحالية">
              <RefreshCw size={13} /> إعادة الحساب
            </Btn>
            <Btn small kind="ghost" disabled={busy} onClick={onClose}>
              <X size={16} />
            </Btn>
          </div>
        </div>

        <div style={{ padding: "16px 20px", overflowY: "auto" }}>
          {loadError && <Banner kind="error">تعذّرت قراءة بيانات النظام الحالية لإعادة الحساب: {loadError}</Banner>}
          {attention && (
            <Banner kind="error">
              {attention}
              {isSaving && !rec.saving?.invoiceId && (
                <div style={{ marginTop: "8px" }}>
                  <Btn small disabled={busy} onClick={() => void releaseStuck(uid)}>
                    تحقّقتُ من الأرشيف — أعدها إلى قائمة الانتظار
                  </Btn>
                </div>
              )}
            </Banner>
          )}
          {!review ? (
            <div style={s.muted}>جاري إعادة الحساب من بيانات الكمبيوتر الحالية...</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: "28px", flexWrap: "wrap", marginBottom: "14px" }}>
                <div>
                  <div style={s.muted}>التاجر (الاسم الحالي في النظام)</div>
                  <div style={{ fontSize: "17px", fontWeight: 700, color: review.merchantMissing ? "#B91C1C" : "#1E293B" }}>
                    {review.merchantMissing ? "غير موجود" : review.merchantName}
                  </div>
                </div>
                <div>
                  <div style={s.muted}>تاريخ الفاتورة</div>
                  <div style={{ fontSize: "17px", fontWeight: 700 }}>
                    <span style={s.num}>{review.invoiceDate}</span>
                  </div>
                </div>
                <div>
                  <div style={s.muted}>رقم الفاتورة</div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#475569" }}>يُولَّد عند الاعتماد بنظام الترقيم الحالي</div>
                </div>
              </div>

              {review.issues.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
                  {review.issues.map((i, k) => (
                    <IssueRow key={`${i.code}-${k}`} issue={i} />
                  ))}
                </div>
              )}

              <div style={{ overflowX: "auto", border: "1px solid #E2E8F0", borderRadius: "10px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={s.th}>#</th>
                      <th style={s.th}>المنتج</th>
                      <th style={s.th}>وزن الميزان</th>
                      <th style={s.th}>الصناديق (وزنها الحالي)</th>
                      <th style={s.th}>وزن الصناديق</th>
                      <th style={s.th}>الوزن الصافي</th>
                      <th style={s.th}>السعر</th>
                      <th style={s.th}>الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.lines.map((l) => {
                      const bad = review.issues.some((i) => i.level === "conflict" && i.lineIndex === l.index);
                      return (
                        <tr key={l.index} style={bad ? { backgroundColor: "#FEF2F2" } : undefined}>
                          <td style={s.td}>{l.index + 1}</td>
                          <td style={s.td}>{l.productName || <span style={{ color: "#B91C1C" }}>—</span>}</td>
                          <td style={s.td}>
                            <span style={s.num}>{w2(l.scaleWeight)}</span>
                          </td>
                          <td style={s.td}>
                            {l.boxes.length === 0 ? (
                              <span style={s.muted}>بدون صناديق</span>
                            ) : (
                              l.boxes.map((b) => (
                                <div key={b.boxId} style={{ whiteSpace: "nowrap" }}>
                                  {b.missing ? (
                                    <span style={{ color: "#B91C1C" }}>
                                      صندوق #{b.boxId} <b>غير موجود</b> × {b.boxCount}
                                    </span>
                                  ) : (
                                    <>
                                      {b.boxName} × {b.boxCount} <span style={s.muted}>
                                        (<span style={s.num}>{w2(b.emptyWeight ?? 0)}</span> كغ)
                                      </span>{" "}
                                      {b.hidden && <Chip kind="gray">مخفي</Chip>}
                                    </>
                                  )}
                                </div>
                              ))
                            )}
                          </td>
                          <td style={s.td}>
                            <span style={s.num}>{w2(l.totalEmptyWeight)}</span>
                          </td>
                          <td style={{ ...s.td, fontWeight: 700 }}>
                            <span style={s.num}>{w2(l.netWeight)}</span>
                          </td>
                          <td style={s.td}>
                            <span style={s.num}>{formatMoney(l.price)}</span>
                          </td>
                          <td style={{ ...s.td, fontWeight: 700 }}>
                            <span style={s.num}>{formatMoney(l.subtotal)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", gap: "28px", flexWrap: "wrap", justifyContent: "flex-end", marginTop: "14px" }}>
                <div>
                  <div style={s.muted}>إجمالي الوزن الصافي</div>
                  <div style={{ fontSize: "17px", fontWeight: 700 }}>
                    <span style={s.num}>{w2(review.totalNetWeight)}</span> كغ
                  </div>
                </div>
                <div>
                  <div style={s.muted}>عدد الصناديق</div>
                  <div style={{ fontSize: "17px", fontWeight: 700 }}>{review.totalBoxes}</div>
                </div>
                <div>
                  <div style={s.muted}>الإجمالي الكلي (سيُحفظ)</div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#1D4ED8" }}>
                    <span style={s.num}>{formatMoney(review.grandTotal)}</span> دج
                  </div>
                  {review.phoneTotal !== null && Math.abs(review.phoneTotal - review.grandTotal) > 0.005 && (
                    <div style={s.muted}>
                      حسبه الهاتف: <span style={s.num}>{formatMoney(review.phoneTotal)}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{ ...s.row, justifyContent: "space-between", padding: "14px 20px", borderTop: "1px solid #E2E8F0", backgroundColor: "#F8FAFC", borderRadius: "0 0 14px 14px" }}>
          {rejecting ? (
            <div style={{ ...s.row, flex: 1 }}>
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                placeholder="سبب الرفض (اختياري — يظهر على الهاتف)"
                style={{ flex: 1, minWidth: "220px", padding: "8px 10px", borderRadius: "8px", border: "1px solid #CBD5E1", fontFamily: "inherit", fontSize: "13px" }}
              />
              <Btn
                kind="danger"
                disabled={busy}
                onClick={() => {
                  void rejectInvoice(uid, reason).then((ok) => ok && onClose());
                }}
              >
                تأكيد الرفض
              </Btn>
              <Btn disabled={busy} onClick={() => setRejecting(false)}>
                تراجع
              </Btn>
            </div>
          ) : (
            <>
              <Btn kind="danger" disabled={busy || isSaving} onClick={() => setRejecting(true)} title={isSaving ? "الفاتورة قيد الحفظ" : "تبقى نسختها على الهاتف"}>
                رفض الفاتورة
              </Btn>
              <div style={s.row}>
                {review && !review.canConfirm && <span style={{ ...s.muted, color: "#991B1B" }}>لا يمكن الاعتماد مع وجود تعارض: عالج السبب في النظام ثم اضغط «إعادة الحساب»، أو ارفض الفاتورة</span>}
                <Btn disabled={busy} onClick={onClose}>
                  إغلاق
                </Btn>
                <Btn
                  kind="success"
                  disabled={busy || !review || !review.canConfirm}
                  onClick={() => {
                    void confirmInvoice(uid).then((ok) => ok && onClose());
                  }}
                >
                  <CircleCheck size={16} /> {st.busy === `confirm:${uid}` ? "جاري الحفظ..." : isSaving ? "إتمام الحفظ" : "تأكيد وحفظ في النظام"}
                </Btn>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
