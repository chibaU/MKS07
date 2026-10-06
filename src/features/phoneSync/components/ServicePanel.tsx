import { useState } from "react";
import { Check, Copy, Download, Eye, EyeOff, KeyRound, Play, Square, TriangleAlert, Wifi } from "lucide-react";
import { exportCaFile, rotateKey, startService, stopService, type PhoneSyncState } from "../store.ts";
import { Banner, Btn, Chip } from "./ui.tsx";
import { copyText, s } from "./styles.ts";

function svgSrc(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function ServicePanel({ st }: { st: PhoneSyncState }) {
  const status = st.status;
  const [chosenIp, setChosenIp] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const busy = st.busy !== null;

  const flash = async (what: string, text: string) => {
    if (await copyText(text)) {
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1500);
    }
  };

  if (!status) {
    return (
      <div style={s.card}>
        <div style={s.muted}>{st.statusError ? `تعذّر قراءة حالة الخدمة: ${st.statusError}` : "جاري قراءة حالة الخدمة..."}</div>
      </div>
    );
  }

  if (!status.running) {
    return (
      <div style={s.card}>
        <h3 style={s.cardTitle}>
          <Wifi size={18} color="#2563EB" /> الخدمة متوقفة
        </h3>
        <div style={{ ...s.muted, marginBottom: "14px" }}>
          عند التشغيل يعرض هذا الكمبيوتر رمز QR على الشبكة المحلية. يفتح الهاتف تطبيق الفواتير، ويحصل على التجار والصناديق، ثم يعمل
          بدون اتصال. لا يلزم إنترنت، ولا يوجد اتصال دائم: كل عملية (جلب البيانات أو إرسال الفواتير) اتصال قصير مستقل.
        </div>
        {status.lastError && <Banner kind="error">{status.lastError}</Banner>}
        <Btn kind="primary" disabled={busy} onClick={() => void startService()}>
          <Play size={16} /> {st.busy === "start" ? "جاري التشغيل..." : "تشغيل الخدمة"}
        </Btn>
        <div style={{ ...s.muted, marginTop: "12px" }}>
          الفواتير المعلّقة محفوظة على القرص وتظهر أدناه حتى والخدمة متوقفة.
        </div>
      </div>
    );
  }

  const addr = status.addresses.find((a) => a.ip === chosenIp) ?? status.addresses.find((a) => a.recommended) ?? status.addresses[0];

  return (
    <div style={s.card}>
      <div style={{ ...s.row, justifyContent: "space-between", marginBottom: "12px" }}>
        <h3 style={{ ...s.cardTitle, margin: 0 }}>
          <Wifi size={18} color="#16A34A" /> الخدمة تعمل <Chip kind="green">المنفذ {status.port}</Chip>
        </h3>
        <Btn disabled={busy} onClick={() => void stopService()}>
          <Square size={14} /> إيقاف الخدمة
        </Btn>
      </div>

      {status.noNetwork && (
        <Banner kind="error">
          <TriangleAlert size={14} style={{ verticalAlign: "-2px" }} /> لم يُعثر على شبكة محلية (واي فاي أو كابل). اتصل بشبكة ثم أعد تشغيل الخدمة.
        </Banner>
      )}
      {status.portChanged && (
        <Banner kind="warn">
          المنفذ الافتراضي مشغول فاستُخدم منفذ آخر ({status.port}). الهواتف التي ثبّتت التطبيق على المنفذ القديم تحتاج مسح الرمز الجديد.
        </Banner>
      )}
      {!status.providerReady && (
        <Banner kind="info">
          واجهة الكمبيوتر لا تردّ على طلبات الهاتف حالياً، فسيحصل الهاتف على آخر نسخة محفوظة من التجار والصناديق. يتجدّد هذا تلقائياً.
        </Banner>
      )}

      {addr && (
        <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ textAlign: "center" }}>
            <img
              src={svgSrc(addr.qrSvg)}
              alt="رمز QR للوصول إلى خدمة الكمبيوتر"
              width={220}
              height={220}
              style={{ border: "1px solid #E2E8F0", borderRadius: "12px", padding: "6px", backgroundColor: "white" }}
            />
            <div style={{ ...s.muted, marginTop: "6px" }}>امسحه بكاميرا الهاتف</div>
          </div>

          <div style={{ flex: 1, minWidth: "280px" }}>
            {status.addresses.length > 1 && (
              <div style={{ marginBottom: "12px" }}>
                <div style={s.muted}>الشبكة (اختر شبكة الواي فاي التي يتصل بها الهاتف):</div>
                <select
                  value={addr.ip}
                  onChange={(e) => setChosenIp(e.target.value)}
                  style={{ marginTop: "4px", padding: "8px 10px", borderRadius: "8px", border: "1px solid #CBD5E1", fontFamily: "inherit", fontSize: "13px", minWidth: "260px" }}
                >
                  {status.addresses.map((a) => (
                    <option key={a.ip} value={a.ip}>
                      {a.ip} — {a.iface}
                      {a.recommended ? " (مقترحة)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginBottom: "12px" }}>
              <div style={s.muted}>العنوان:</div>
              <div style={s.row}>
                <span style={{ ...s.mono, fontSize: "15px", fontWeight: 600, color: "#1E293B" }}>{addr.url}</span>
                <Btn small onClick={() => void flash("url", addr.url)}>
                  {copied === "url" ? <Check size={13} /> : <Copy size={13} />} نسخ
                </Btn>
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={s.muted}>مفتاح الوصول (يُكتب يدوياً على الهاتف إن تعذّر مسح الرمز):</div>
              <div style={s.row}>
                <span style={{ ...s.mono, fontSize: "15px", fontWeight: 600, letterSpacing: "1px" }}>
                  {showKey ? status.accessKeyDisplay : "••••-••••-••••-••••"}
                </span>
                <Btn small onClick={() => setShowKey((v) => !v)}>
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />} {showKey ? "إخفاء" : "إظهار"}
                </Btn>
                <Btn small onClick={() => void flash("key", status.accessKeyDisplay)}>
                  {copied === "key" ? <Check size={13} /> : <Copy size={13} />} نسخ
                </Btn>
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={s.muted}>بصمة شهادة الأمان (للمطابقة مع ما يظهر على الهاتف عند التثبيت):</div>
              <div style={{ ...s.mono, fontSize: "11px", color: "#475569", wordBreak: "break-all" }}>{status.caFingerprint}</div>
              <div style={{ ...s.row, marginTop: "6px" }}>
                <Btn small disabled={busy} onClick={() => void exportCaFile()} title="يحفظ الملف في مجلد التنزيلات ويفتح المجلد">
                  <Download size={13} /> تصدير ملف الشهادة
                </Btn>
                <span style={s.muted}>إن تعذّر تنزيلها من الهاتف: انقل الملف يدوياً (كابل/بلوتوث/واتساب).</span>
              </div>
            </div>

            {!confirmRotate ? (
              <Btn small disabled={busy} onClick={() => setConfirmRotate(true)}>
                <KeyRound size={13} /> تجديد مفتاح الوصول
              </Btn>
            ) : (
              <Banner kind="warn">
                سيتوقف كل هاتف يحمل المفتاح الحالي عن الوصول حتى يمسح الرمز الجديد. الفواتير المحفوظة على الهواتف لا تتأثر.
                <div style={{ ...s.row, marginTop: "8px" }}>
                  <Btn
                    small
                    kind="danger"
                    onClick={() => {
                      setConfirmRotate(false);
                      void rotateKey();
                    }}
                  >
                    نعم، جدّد المفتاح
                  </Btn>
                  <Btn small onClick={() => setConfirmRotate(false)}>
                    إلغاء
                  </Btn>
                </div>
              </Banner>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
