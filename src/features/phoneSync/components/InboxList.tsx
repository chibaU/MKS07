import { CircleCheck, Inbox, TriangleAlert } from "lucide-react";
import { formatMoney } from "../../../components/InvoiceShared";
import type { PhoneSyncState } from "../store.ts";
import { Banner, Btn, Chip } from "./ui.tsx";
import { fmtDateTime, s } from "./styles.ts";

export function InboxList({ st, onReview }: { st: PhoneSyncState; onReview: (uid: string) => void }) {
  return (
    <div style={s.card}>
      <h3 style={s.cardTitle}>
        <Inbox size={18} color="#2563EB" /> فواتير واردة من الهاتف {st.inbox.length > 0 && <Chip kind="blue">{st.inbox.length}</Chip>}
      </h3>
      {st.inbox.length === 0 ? (
        <div style={s.muted}>
          لا توجد فواتير بانتظار المراجعة. الفواتير التي ترسلها الهواتف تظهر هنا، ولا تدخل قاعدة بيانات النظام إلا بعد مراجعتك وتأكيدك.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={s.th}>وصلت</th>
                <th style={s.th}>التاجر (الحالي)</th>
                <th style={s.th}>التاريخ</th>
                <th style={s.th}>البنود</th>
                <th style={s.th}>الإجمالي بعد إعادة الحساب</th>
                <th style={s.th}>الحالة</th>
                <th style={s.th} />
              </tr>
            </thead>
            <tbody>
              {st.inbox.map((rec) => {
                const rv = st.reviews[rec.uid];
                const attention = st.attention[rec.uid];
                return (
                  <tr key={rec.uid}>
                    <td style={s.td}>
                      {fmtDateTime(rec.receivedAt)}
                      {rec.deviceLabel && <div style={s.muted}>{rec.deviceLabel}</div>}
                    </td>
                    <td style={s.td}>
                      {rv ? (
                        rv.merchantMissing ? (
                          <span style={{ color: "#B91C1C" }}>غير موجود{rv.phoneMerchantName ? ` («${rv.phoneMerchantName}»)` : ""}</span>
                        ) : (
                          rv.merchantName
                        )
                      ) : (
                        "…"
                      )}
                    </td>
                    <td style={s.td}>
                      <span style={s.num}>{rec.invoice.invoiceDate}</span>
                    </td>
                    <td style={s.td}>{rec.invoice.lines.length}</td>
                    <td style={s.td}>{rv ? <span style={s.num}>{formatMoney(rv.grandTotal)}</span> : "…"}</td>
                    <td style={s.td}>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        {rec.state === "saving" && <Chip kind="blue">قيد الحفظ</Chip>}
                        {attention && (
                          <Chip kind="red">
                            <TriangleAlert size={11} /> تحتاج انتباهك
                          </Chip>
                        )}
                        {rv && rv.conflictCount > 0 && <Chip kind="red">{rv.conflictCount} تعارض</Chip>}
                        {rv && rv.warningCount > 0 && <Chip kind="amber">{rv.warningCount} تنبيه</Chip>}
                        {rv && rv.canConfirm && rec.state === "pending" && (
                          <Chip kind="green">
                            <CircleCheck size={11} /> جاهزة للمراجعة
                          </Chip>
                        )}
                      </div>
                      {attention && (
                        <div style={{ marginTop: "8px" }}>
                          <Banner kind="error">{attention}</Banner>
                        </div>
                      )}
                    </td>
                    <td style={s.td}>
                      <Btn small kind="primary" onClick={() => onReview(rec.uid)}>
                        مراجعة
                      </Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
