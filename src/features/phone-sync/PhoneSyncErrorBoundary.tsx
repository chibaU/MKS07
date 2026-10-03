// حاجز أخطاء مخصَّص لهذه الميزة: أي استثناء في رسم مكوناتها يُحتوى هنا فلا يُسقِط
// بقية التطبيق (المتطلبان 1 و26). يعرض رسالة بديلة بدل شاشة بيضاء.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** true = لا يعرض شيئاً عند الفشل (للمكوّن الخفي PhoneSyncHost). */
  silent?: boolean;
}
interface State { failed: boolean }

export class PhoneSyncErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("خطأ في ميزة مزامنة الهاتف (معزول عن بقية التطبيق):", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.silent) return null;
    return (
      <div style={{ padding: "40px", direction: "rtl", fontFamily: "'Cairo', sans-serif", color: "#991B1B" }}>
        <h2 style={{ margin: "0 0 8px" }}>تعذّر عرض صفحة مزامنة الهاتف</h2>
        <p style={{ margin: "0 0 14px", color: "#475569" }}>
          حدث خطأ داخل هذه الميزة فقط — بقية البرنامج (الفواتير والتجار والطباعة) تعمل بشكل طبيعي.
          الفواتير التي وصلت من الهاتف محفوظة ولن تضيع.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#2563EB", color: "#fff", cursor: "pointer", fontFamily: "'Cairo', sans-serif", fontSize: 15 }}
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }
}
