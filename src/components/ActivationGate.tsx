// ============================================================================
// ميزة تفعيل الجهاز (Device Activation) — راجع AI_CONTEXT.md القسم 9 للتصميم
// الكامل قبل أي تعديل هنا.
//
// نطاق هذا الملف: مكوّن حاجز واحد يلفّ كامل التطبيق من main.tsx. عند التحميل
// يتحقق إن كان معرّف هذا الجهاز موجوداً في trusted_devices؛ إن كان كذلك يعرض
// children (التطبيق كاملاً) مباشرة بلا أي احتكاك، وإلا يحجب كل شيء بشاشة
// تفعيل كاملة حتى يُدخَل الكود الصحيح مرة واحدة فقط لهذا الجهاز.
//
// لا علاقة لهذا الملف بـ App.tsx إطلاقاً ولا بأي state فيه — التفعيل طبقة
// أعلى تماماً وأسبق زمنياً من أي تحميل لبيانات التطبيق (تجار/منتجات/صناديق).
// ============================================================================

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ShieldCheck } from "lucide-react";
import { activationService } from "../services/db";

const s = {
  overlay: {
    direction: "rtl" as const,
    fontFamily: "'Cairo', sans-serif",
    minHeight: "100vh",
    backgroundColor: "#F8FAFC",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
  },
  card: {
    backgroundColor: "white",
    borderRadius: "16px",
    border: "1px solid #E2E8F0",
    boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
    padding: "40px 36px",
    width: "100%",
    maxWidth: "380px",
    textAlign: "center" as const,
    boxSizing: "border-box" as const,
  },
  iconWrap: {
    width: "60px",
    height: "60px",
    borderRadius: "14px",
    backgroundColor: "#EFF6FF",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 20px",
  },
  title: { color: "#1E293B", fontSize: "19px", fontWeight: 700, margin: "0 0 8px" },
  desc: { color: "#64748B", fontSize: "13.5px", lineHeight: 1.7, marginBottom: "24px" },
  input: {
    width: "100%",
    boxSizing: "border-box" as const,
    padding: "12px 14px",
    borderRadius: "10px",
    border: "1.5px solid #E2E8F0",
    fontSize: "15px",
    fontFamily: "'Cairo', sans-serif",
    textAlign: "center" as const,
    outline: "none",
  },
  inputError: { borderColor: "#FCA5A5" },
  btn: {
    width: "100%",
    marginTop: "14px",
    padding: "12px",
    borderRadius: "10px",
    border: "none",
    backgroundColor: "#2563EB",
    color: "white",
    fontSize: "15px",
    fontWeight: 700,
    fontFamily: "'Cairo', sans-serif",
    cursor: "pointer",
  },
  btnDisabled: { opacity: 0.6, cursor: "not-allowed" as const },
  error: { color: "#DC2626", fontSize: "13px", marginTop: "10px" },
  deviceIdBox: {
    marginTop: "26px",
    paddingTop: "18px",
    borderTop: "1px solid #F1F5F9",
    fontSize: "11.5px",
    color: "#94A3B8",
    lineHeight: 1.6,
  },
  deviceIdValue: {
    fontFamily: "monospace",
    fontSize: "12px",
    color: "#475569",
    userSelect: "all" as const,
    wordBreak: "break-all" as const,
    marginTop: "4px",
  },
  loadingText: { color: "#64748B", fontSize: "14px" },
};

export function ActivationGate({ children }: { children: ReactNode }) {
  // checking: لا نعرف بعد هل الجهاز موثوق أم لا (طلب DB أول لم يكتمل).
  const [checking, setChecking] = useState(true);
  const [trusted, setTrusted] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const id = await activationService.getOrCreateDeviceId();
        const ok = await activationService.isDeviceTrusted(id);
        if (cancelled) return;
        setDeviceId(id);
        setTrusted(ok);
      } catch (err) {
        // فشل التحقق (مثلاً خطأ اتصال DB عابر) يُبقي الشاشة على حالة "غير
        // موثوق" افتراضياً بدل فتح التطبيق خطأً — أكثر أماناً، ويستطيع
        // المستخدم إعادة المحاولة بإعادة تشغيل التطبيق.
        console.error("خطأ أثناء التحقق من تفعيل الجهاز:", err);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const ok = await invoke<boolean>("verify_activation_code", {
        code: code.trim(),
      });
      if (!ok) {
        setError("كود غير صحيح، حاول مرة أخرى");
        return;
      }
      await activationService.trustDevice(deviceId);
      setTrusted(true);
    } catch (err) {
      console.error("خطأ أثناء التحقق من كود التفعيل:", err);
      setError("تعذر التحقق من الكود، حاول مرة أخرى");
    } finally {
      setSubmitting(false);
    }
  }, [code, deviceId, submitting]);

  if (checking) {
    return (
      <div style={s.overlay}>
        <span style={s.loadingText}>جاري التحقق من التفعيل...</span>
      </div>
    );
  }

  if (trusted) {
    return <>{children}</>;
  }

  return (
    <div style={s.overlay}>
      <div style={s.card}>
        <div style={s.iconWrap}>
          <ShieldCheck size={28} color="#2563EB" />
        </div>
        <h1 style={s.title}>تفعيل التطبيق</h1>
        <p style={s.desc}>
          هذا الجهاز غير مفعَّل بعد. أدخل كود التفعيل الذي حصلت عليه لتشغيل
          التطبيق على هذا الحاسوب — تُطلَب هذه الخطوة مرة واحدة فقط لكل جهاز.
        </p>
        <input
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="كود التفعيل"
          style={{ ...s.input, ...(error ? s.inputError : {}) }}
          disabled={submitting}
          autoFocus
        />
        <button
          onClick={handleSubmit}
          disabled={!code.trim() || submitting}
          style={{
            ...s.btn,
            ...(!code.trim() || submitting ? s.btnDisabled : {}),
          }}
        >
          {submitting ? "جاري التحقق..." : "تفعيل"}
        </button>
        {error && <div style={s.error}>{error}</div>}
        <div style={s.deviceIdBox}>
          معرف هذا الجهاز (أرسله للمطوّر إن احتجت تفعيلاً يدوياً)
          <div style={s.deviceIdValue}>{deviceId}</div>
        </div>
      </div>
    </div>
  );
}