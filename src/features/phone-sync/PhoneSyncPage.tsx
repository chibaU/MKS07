// صفحة «مزامنة الهاتف» — ميزة مستقلة (AI_CONTEXT.md القسم 10). لا تُدمَج في أي صفحة
// أخرى ولا تعتمد عليها صفحة أخرى. تحتوي: لوحة الاتصال (QR) + قائمة الفواتير الواردة
// للمراجعة. الحالة كلها داخلية (usePhoneSync) لا في App.tsx.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { merchantService, type Merchant } from "../../services/db";
import { ConnectionPanel } from "./ConnectionPanel";
import { ReviewPanel } from "./ReviewPanel";
import { parsePayload } from "./review";
import type { PhoneInvoiceRecord, RecordStatus } from "./types";
import { usePhoneSync } from "./usePhoneSync";

const p = {
  page: { padding: "28px 32px", direction: "rtl", fontFamily: "'Cairo', sans-serif", maxWidth: 1100, margin: "0 auto" } as CSSProperties,
  title: { margin: "0 0 4px", fontSize: 26, color: "#0F172A" } as CSSProperties,
  sub: { margin: "0 0 20px", color: "#475569", fontSize: 15 } as CSSProperties,
  card: { background: "#fff", border: "1px solid #CBD5E1", borderRadius: 12, padding: "18px 20px", marginBottom: 18 } as CSSProperties,
  err: { background: "#FEE2E2", color: "#991B1B", borderRadius: 10, padding: "12px 16px", marginBottom: 16, lineHeight: 1.8 } as CSSProperties,
};

const TABS: { id: RecordStatus; label: string }[] = [
  { id: "pending", label: "بانتظار المراجعة" },
  { id: "confirmed", label: "المؤكَّدة" },
  { id: "rejected", label: "المرفوضة" },
];

const STATUS_STYLE: Record<RecordStatus, [string, string, string]> = {
  pending: ["#FEF3C7", "#92400E", "بانتظار المراجعة"],
  confirmed: ["#D1FAE5", "#065F46", "مؤكَّدة"],
  rejected: ["#FEE2E2", "#991B1B", "مرفوضة"],
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ar-DZ-u-nu-latn", { dateStyle: "medium", timeStyle: "short" });
}

export function PhoneSyncPage() {
  const { info, records, error, busy, loaded, reload, start, stop, regenerateKey, setError } = usePhoneSync();
  const [tab, setTab] = useState<RecordStatus>("pending");
  const [openId, setOpenId] = useState<string | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  // أسماء التجار الحالية للعرض في القائمة فقط (قراءة).
  useEffect(() => {
    let alive = true;
    merchantService.getAll().then((m) => { if (alive) setMerchants(m); }).catch(() => {});
    return () => { alive = false; };
  }, [records.length]);

  const counts = useMemo(() => {
    const c: Record<RecordStatus, number> = { pending: 0, confirmed: 0, rejected: 0 };
    for (const r of records) c[r.status]++;
    return c;
  }, [records]);

  const shown = records.filter((r) => r.status === tab);
  const open = openId ? records.find((r) => r.clientId === openId) ?? null : null;

  const describe = (r: PhoneInvoiceRecord) => {
    const parsed = parsePayload(r.payload);
    if (!parsed.ok) return { merchant: "فاتورة تالفة", date: "—", lines: 0 };
    const m = merchants.find((x) => x.id === parsed.payload.merchantId);
    return {
      merchant: m ? m.name : `${parsed.payload.merchantNameHint ?? "تاجر"} (غير موجود)`,
      date: parsed.payload.invoiceDate,
      lines: parsed.payload.lines.length,
    };
  };

  return (
    <div style={p.page}>
      <h1 style={p.title}>📱 مزامنة الهاتف</h1>
      <p style={p.sub}>
        تطبيق ويب على الهاتف ينشئ فواتير جديدة دون إنترنت، ثم يرسلها إلى هنا عبر شبكة Wi-Fi المحلية لتراجعها وتؤكدها.
      </p>

      {error && (
        <div style={p.err}>
          {error}
          <button type="button" onClick={() => setError(null)} style={{ marginInlineStart: 12, background: "transparent", border: "none", color: "#991B1B", cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>إخفاء</button>
        </div>
      )}

      {!loaded && <div style={{ color: "#64748B" }}>جاري التحميل…</div>}

      {info && <ConnectionPanel info={info} busy={busy} onStart={start} onStop={stop} onRegenerate={regenerateKey} />}

      <div style={p.card}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t.id} type="button" onClick={() => setTab(t.id)}
              style={{
                padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 700,
                border: tab === t.id ? "2px solid #2563EB" : "1.5px solid #CBD5E1",
                background: tab === t.id ? "#EFF6FF" : "#fff", color: tab === t.id ? "#1D4ED8" : "#334155",
              }}
            >
              {t.label} ({counts[t.id]})
            </button>
          ))}
          <button type="button" onClick={() => void reload()} style={{ marginInlineStart: "auto", padding: "9px 14px", borderRadius: 8, border: "1.5px solid #CBD5E1", background: "#fff", cursor: "pointer", fontFamily: "inherit" }}>↻ تحديث</button>
        </div>

        {shown.length === 0 ? (
          <div style={{ textAlign: "center", color: "#64748B", padding: "26px 10px" }}>
            {tab === "pending" ? "لا توجد فواتير بانتظار المراجعة." : "لا توجد فواتير في هذه القائمة."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shown.map((r) => {
              const d = describe(r);
              const [bg, fg, label] = STATUS_STYLE[r.status];
              return (
                <button
                  key={r.clientId} type="button" onClick={() => setOpenId(r.clientId)}
                  style={{ display: "flex", alignItems: "center", gap: 14, textAlign: "right", padding: "12px 16px", borderRadius: 10, border: "1.5px solid #CBD5E1", background: "#fff", cursor: "pointer", fontFamily: "inherit", width: "100%" }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: "#0F172A" }}>{d.merchant}</div>
                    <div style={{ color: "#64748B", fontSize: 13 }}>
                      {d.date} — {d.lines} بند — وصلت {when(r.receivedAt)}{r.deviceLabel ? ` — ${r.deviceLabel}` : ""}
                      {r.invoiceNumber ? ` — رقم ${r.invoiceNumber}` : ""}
                    </div>
                  </div>
                  <span style={{ background: bg, color: fg, borderRadius: 999, padding: "3px 12px", fontSize: 13, fontWeight: 700 }}>{label}</span>
                  <span style={{ color: "#2563EB", fontWeight: 700 }}>{r.status === "pending" ? "مراجعة ←" : "عرض ←"}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {open && <ReviewPanel key={open.clientId} record={open} onClose={() => setOpenId(null)} onChanged={() => void reload()} />}
    </div>
  );
}
