// نقطة الدخول الوحيدة التي يعرفها بقية التطبيق (App.tsx تستورد هذا الملف فقط).
//
// عزل الأعطال:
//  • الصفحة تُحمَّل بـ React.lazy → ملفّ JS مستقل لا يُحمَّل ولا يُنفَّذ إلا عند فتح
//    الصفحة. من لا يستخدم الميزة لا يمرّ عبر أي سطر منها.
//  • حدّ أخطاء (Error Boundary) يلتقط أي خطأ رسم أو تحميل داخل الميزة ويعرض رسالة
//    بدل أن يُسقط React شجرة التطبيق كلها (السلوك الافتراضي لخطأ غير ملتقَط).

import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";

const PhoneSyncPage = lazy(() => import("./PhoneSyncPage.tsx"));

const box = {
  padding: "40px",
  fontFamily: "'Cairo', sans-serif",
  direction: "rtl" as const,
  textAlign: "center" as const,
  color: "#64748B",
};

interface BoundaryState {
  error: Error | null;
}

class Boundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[phone-sync] خطأ في واجهة ميزة مزامنة الهاتف:", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div style={box}>
        <div style={{ fontSize: "18px", fontWeight: 700, color: "#B91C1C", marginBottom: "8px" }}>
          تعذّر عرض صفحة مزامنة الهاتف
        </div>
        <div style={{ fontSize: "14px", marginBottom: "6px" }}>
          هذا لا يؤثر على بقية النظام — الفواتير والتجار والطباعة تعمل كالمعتاد، والفواتير الواردة من الهاتف محفوظة.
        </div>
        <div style={{ fontSize: "12px", direction: "ltr", color: "#94A3B8", marginBottom: "16px" }}>
          {this.state.error.message}
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            padding: "8px 18px",
            borderRadius: "8px",
            border: "1px solid #CBD5E1",
            backgroundColor: "white",
            cursor: "pointer",
            fontFamily: "'Cairo', sans-serif",
            fontSize: "14px",
          }}
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }
}

export function PhoneSyncEntry() {
  return (
    <Boundary>
      <Suspense fallback={<div style={box}>جاري تحميل صفحة مزامنة الهاتف...</div>}>
        <PhoneSyncPage />
      </Suspense>
    </Boundary>
  );
}
