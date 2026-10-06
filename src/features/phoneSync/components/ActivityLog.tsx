import { useState } from "react";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { formatMoney } from "../../../components/InvoiceShared";
import type { PhoneSyncState } from "../store.ts";
import { Chip } from "./ui.tsx";
import { fmtDateTime, fmtTime, s } from "./styles.ts";

const kindLabel: Record<string, string> = {
  catalog: "بيانات",
  submit: "استلام",
  status: "استعلام",
  auth: "مصادقة",
  tls: "شهادة",
  network: "شبكة",
  service: "خدمة",
  confirm: "اعتماد",
  reject: "رفض",
  error: "خطأ",
  warn: "تنبيه",
};

export function ActivityLog({ st }: { st: PhoneSyncState }) {
  const [open, setOpen] = useState(false);
  const events = st.status?.events ?? [];
  return (
    <div style={s.card}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
      >
        <span style={{ ...s.cardTitle, margin: 0, flex: 1 }}>
          <Activity size={18} color="#64748B" /> سجل الأنشطة
        </span>
        {open ? <ChevronUp size={18} color="#64748B" /> : <ChevronDown size={18} color="#64748B" />}
      </button>
      {open && (
        <div style={{ marginTop: "14px" }}>
          <div style={{ ...s.muted, marginBottom: "8px" }}>
            ما حدث مؤخراً على الخدمة (محفوظ في الذاكرة فقط). مفيد لمعرفة هل وصل طلب الهاتف إلى الكمبيوتر أم لا.
          </div>
          {events.length === 0 ? (
            <div style={s.muted}>لا أنشطة بعد.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "16px" }}>
              {events.map((e) => (
                <div key={e.seq} style={{ display: "flex", gap: "10px", alignItems: "baseline", fontSize: "13px", color: "#1E293B" }}>
                  <span style={{ ...s.num, color: "#94A3B8", fontSize: "12px" }}>{fmtTime(e.at)}</span>
                  <Chip kind={e.kind === "error" || e.kind === "tls" || e.kind === "auth" ? "red" : e.kind === "submit" || e.kind === "confirm" ? "green" : "gray"}>
                    {kindLabel[e.kind] ?? e.kind}
                  </Chip>
                  <span>{e.message}</span>
                  {e.ip && <span style={{ ...s.mono, color: "#94A3B8", fontSize: "11px" }}>{e.ip}</span>}
                </div>
              ))}
            </div>
          )}

          <div style={{ ...s.cardTitle, fontSize: "14px" }}>آخر القرارات على فواتير الهاتف</div>
          {st.recent.length === 0 ? (
            <div style={s.muted}>لا قرارات بعد.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {st.recent.map((r) => (
                <div key={r.uid + r.at} style={{ display: "flex", gap: "10px", alignItems: "baseline", fontSize: "13px" }}>
                  <span style={{ ...s.num, color: "#94A3B8", fontSize: "12px" }}>{fmtDateTime(r.at)}</span>
                  {r.state === "confirmed" ? <Chip kind="green">اعتُمدت</Chip> : <Chip kind="red">رُفضت</Chip>}
                  <span>
                    {r.state === "confirmed" ? (
                      <>
                        رقم <span style={{ ...s.mono, fontWeight: 600 }}>{r.finalInvoiceNumber}</span>
                        {r.merchantName ? ` — ${r.merchantName}` : ""}
                        {typeof r.total === "number" ? ` — ${formatMoney(r.total)} دج` : ""}
                      </>
                    ) : (
                      <>{r.reason ? r.reason : "بدون سبب مذكور"}</>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
