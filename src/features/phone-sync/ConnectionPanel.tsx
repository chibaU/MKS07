// لوحة الاتصال: تشغيل/إيقاف الخدمة + رمزا QR (إعداد الثقة بالشهادة مرة واحدة، ثم فتح
// التطبيق). QR مجرد وسيلة وصول لعنوان الكمبيوتر — لا ينشئ Session ولا يربط هاتفاً
// بعينه (المتطلب 7): أي هاتف يملك الرابط/المفتاح يستطيع الاستخدام.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { errText, phoneSyncApi } from "./bridge";
import type { ServiceInfo } from "./types";

const c = {
  card: { background: "#fff", border: "1px solid #CBD5E1", borderRadius: 12, padding: "20px 22px", marginBottom: 18 } as CSSProperties,
  h2: { margin: "0 0 6px", fontSize: 18, color: "#0F172A" } as CSSProperties,
  muted: { color: "#475569", fontSize: 14, lineHeight: 1.8, margin: "4px 0 10px" } as CSSProperties,
  btn: { padding: "10px 18px", borderRadius: 8, border: "none", background: "#2563EB", color: "#fff", cursor: "pointer", fontFamily: "'Cairo', sans-serif", fontSize: 15, fontWeight: 700 } as CSSProperties,
  btnAlt: { padding: "8px 14px", borderRadius: 8, border: "1.5px solid #64748B", background: "#fff", color: "#1E293B", cursor: "pointer", fontFamily: "'Cairo', sans-serif", fontSize: 14 } as CSSProperties,
  mono: { direction: "ltr", textAlign: "left", fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12.5, background: "#F1F5F9", borderRadius: 8, padding: "8px 10px", wordBreak: "break-all", userSelect: "all" } as CSSProperties,
};

function useQr(text: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    setErr(null);
    if (!text) return;
    phoneSyncApi
      .qr(text)
      .then((svg) => { if (alive) setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`); })
      .catch((e) => { if (alive) setErr(errText(e)); });
    return () => { alive = false; };
  }, [text]);
  return { src, err };
}

function QrCard({ step, title, hint, url, secret }: { step: number; title: string; hint: string; url: string | null; secret?: boolean }) {
  const { src, err } = useQr(url);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* الحافظة غير متاحة */ }
  };
  return (
    <div style={{ ...c.card, flex: 1, minWidth: 300, marginBottom: 0 }}>
      <h2 style={c.h2}>
        <span style={{ background: "#2563EB", color: "#fff", borderRadius: 999, padding: "1px 10px", marginInlineEnd: 8, fontSize: 15 }}>{step}</span>
        {title}
      </h2>
      <p style={c.muted}>{hint}</p>
      <div style={{ display: "flex", justifyContent: "center", margin: "6px 0 12px", minHeight: 240 }}>
        {src ? <img src={src} alt={title} width={240} height={240} style={{ borderRadius: 8, border: "1px solid #CBD5E1" }} />
          : <div style={{ alignSelf: "center", color: "#64748B" }}>{err ?? "جاري توليد الرمز…"}</div>}
      </div>
      {url && (
        <>
          <div style={c.mono}>{secret ? url.replace(/(#k=)[0-9a-f]{58}/i, "$1••••••••") : url}</div>
          <div style={{ marginTop: 8 }}>
            <button type="button" style={c.btnAlt} onClick={copy}>{copied ? "تم النسخ ✓" : "نسخ الرابط"}</button>
          </div>
        </>
      )}
    </div>
  );
}

interface Props {
  info: ServiceInfo;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onRegenerate: () => void;
}

export function ConnectionPanel({ info, busy, onStart, onStop, onRegenerate }: Props) {
  const [ipIndex, setIpIndex] = useState(0);
  const ip = info.addresses[Math.min(ipIndex, Math.max(info.addresses.length - 1, 0))]?.ip ?? null;

  const setupUrl = useMemo(() => (ip && info.running ? `http://${ip}:${info.setupPort}/setup` : null), [ip, info.running, info.setupPort]);
  const appUrl = useMemo(
    () => (ip && info.running && info.accessKey ? `https://${ip}:${info.httpsPort}/#k=${info.accessKey}` : null),
    [ip, info.running, info.accessKey, info.httpsPort],
  );

  return (
    <div>
      <div style={{ ...c.card, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ width: 12, height: 12, borderRadius: 999, background: info.running ? "#059669" : "#94A3B8" }} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 700, color: "#0F172A" }}>{info.running ? "الخدمة تعمل — الهاتف يستطيع الاتصال" : "الخدمة متوقفة"}</div>
          <div style={{ color: "#475569", fontSize: 13 }}>
            {info.running
              ? "تعمل فقط على الشبكة المحلية، وتُجيب عن الطلبات عند وصولها (لا اتصال دائم)."
              : "لن يستطيع أي هاتف جلب البيانات أو إرسال فواتير حتى تُشغَّل الخدمة."}
          </div>
        </div>
        {info.running
          ? <button type="button" style={c.btnAlt} disabled={busy} onClick={onStop}>إيقاف الخدمة</button>
          : <button type="button" style={c.btn} disabled={busy} onClick={onStart}>{busy ? "جاري التشغيل…" : "تشغيل الخدمة"}</button>}
      </div>

      {info.running && info.addresses.length === 0 && (
        <div style={{ ...c.card, borderColor: "#F59E0B", background: "#FFFBEB", color: "#92400E" }}>
          لم يُعثر على عنوان شبكة محلية لهذا الكمبيوتر. اتصل بشبكة Wi-Fi (أو كابل شبكة) نفسها التي سيتصل بها الهاتف ثم أعد فتح الصفحة.
        </div>
      )}

      {info.running && info.addresses.length > 0 && (
        <>
          {info.addresses.length > 1 && (
            <div style={{ ...c.card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <label htmlFor="ps-ip" style={{ fontWeight: 700 }}>عنوان هذا الكمبيوتر على الشبكة:</label>
              <select
                id="ps-ip" value={ipIndex} onChange={(e) => setIpIndex(Number(e.target.value))}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #64748B", fontFamily: "inherit", fontSize: 15, direction: "ltr" }}
              >
                {info.addresses.map((a, i) => (
                  <option key={a.ip} value={i}>{a.ip} — {a.interface}{a.likely ? "" : " (يبدو افتراضياً)"}</option>
                ))}
              </select>
              <span style={{ color: "#475569", fontSize: 13 }}>اختر العنوان الذي تقع عليه شبكة Wi-Fi التي يتصل بها الهاتف.</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 18 }}>
            <QrCard
              step={1} title="إعداد الثقة (مرة واحدة لكل هاتف)"
              hint="امسح الرمز بكاميرا الهاتف لتنزيل شهادة الأمان المحلية وتثبيتها بالخطوات الظاهرة على الهاتف. لا تُكرَّر إلا عند هاتف جديد."
              url={setupUrl}
            />
            <QrCard
              step={2} title="فتح تطبيق الفواتير"
              hint="بعد تثبيت الشهادة، امسح هذا الرمز لفتح التطبيق وجلب التجار والصناديق. بعدها يعمل الهاتف دون اتصال."
              url={appUrl} secret
            />
          </div>

          <div style={c.card}>
            <h2 style={c.h2}>🔒 بصمة الشهادة (للتحقق)</h2>
            <p style={c.muted}>يجب أن تطابق البصمة الظاهرة في صفحة الإعداد على الهاتف تماماً.</p>
            <div style={c.mono}>{info.caFingerprint ?? "—"}</div>
          </div>

          <div style={c.card}>
            <h2 style={c.h2}>إذا لم يتصل الهاتف</h2>
            <ul style={{ ...c.muted, paddingInlineStart: 22, margin: 0 }}>
              <li>تأكد أن الهاتف والكمبيوتر على <strong>نفس شبكة Wi-Fi</strong> (ليس بيانات الجوال، وليس «شبكة الضيوف»).</li>
              <li>عند أول تشغيل قد يسأل جدار حماية Windows: اختر <strong>«الشبكات الخاصة»</strong> ثم «السماح بالوصول».</li>
              <li>إن كانت شبكتك مُعرَّفة «عامة» في Windows، غيّرها إلى «خاصة» من إعدادات الشبكة.</li>
              <li>استخدم Chrome على أندرويد أو Safari على آيفون. وإن غيّر الراوتر عنوان الكمبيوتر، حدّثه من «الإعدادات» داخل تطبيق الهاتف (فواتيره لا تتأثر)، أو ثبّت للكمبيوتر عنواناً ثابتاً من إعدادات الراوتر.</li>
              <li>المنفذان المستخدمان: <span dir="ltr">{info.httpsPort}</span> (التطبيق) و<span dir="ltr">{info.setupPort}</span> (الشهادة فقط).</li>
            </ul>
          </div>

          <div style={{ ...c.card, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontWeight: 700 }}>مفتاح الوصول</div>
              <div style={{ color: "#475569", fontSize: 13 }}>
                مضمَّن في رمز QR (الخطوة 2). تغييره يُبطل الرمز المطبوع/المخزَّن على الهواتف القديمة، فتحتاج مسح الرمز الجديد (لا تتأثر فواتيرها).
              </div>
            </div>
            <button
              type="button" style={c.btnAlt} disabled={busy}
              onClick={() => { if (window.confirm("توليد مفتاح وصول جديد؟ ستحتاج الهواتف إلى مسح رمز QR الجديد.")) onRegenerate(); }}
            >
              توليد مفتاح جديد
            </button>
          </div>
        </>
      )}
    </div>
  );
}
