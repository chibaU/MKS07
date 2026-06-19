import { Upload, Download, FileText, CheckCircle } from "lucide-react";
import { useState } from "react";

const s = {
  page: { padding: "32px", direction: "rtl" as const },
  h1: { color: "#1E293B", fontSize: "24px", fontWeight: 700, margin: 0 },
  subtitle: { color: "#64748B", fontSize: "14px", marginTop: "4px" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "24px",
    marginTop: "24px",
  },
  card: {
    backgroundColor: "white",
    borderRadius: "14px",
    border: "1px solid #E2E8F0",
    padding: "32px 28px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-start",
    gap: "0",
  },
  iconWrap: (color: string) => ({
    width: "56px",
    height: "56px",
    borderRadius: "14px",
    backgroundColor: color,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "20px",
  }),
  cardTitle: {
    color: "#1E293B",
    fontSize: "17px",
    fontWeight: 700,
    marginBottom: "10px",
  },
  cardDesc: {
    color: "#64748B",
    fontSize: "14px",
    lineHeight: 1.6,
    marginBottom: "28px",
    flex: 1,
  },
  primaryBtn: {
    backgroundColor: "#2563EB",
    color: "white",
    border: "none",
    borderRadius: "8px",
    padding: "11px 22px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontFamily: "'Cairo', sans-serif",
    width: "100%",
    justifyContent: "center",
  },
  outlineBtn: {
    backgroundColor: "white",
    color: "#2563EB",
    border: "2px solid #2563EB",
    borderRadius: "8px",
    padding: "10px 22px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontFamily: "'Cairo', sans-serif",
    width: "100%",
    justifyContent: "center",
  },
  successToast: {
    position: "fixed" as const,
    bottom: "32px",
    left: "50%",
    transform: "translateX(-50%)",
    backgroundColor: "#10B981",
    color: "white",
    padding: "14px 24px",
    borderRadius: "10px",
    boxShadow: "0 4px 20px rgba(16,185,129,0.3)",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "14px",
    fontWeight: 500,
    zIndex: 1000,
    direction: "rtl" as const,
  },
  infoCard: {
    backgroundColor: "#EFF6FF",
    borderRadius: "12px",
    border: "1px solid #DBEAFE",
    padding: "20px 24px",
    marginTop: "24px",
    display: "flex",
    gap: "14px",
    alignItems: "flex-start",
  },
};

export function SettingsPage() {
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  return (
    <div style={s.page}>
      <div>
        <h1 style={s.h1}>الإعدادات</h1>
        <p style={s.subtitle}>إدارة النسخ الاحتياطية ونماذج الفواتير</p>
      </div>

      <div style={s.grid}>
        {/* Card 1: Upload Backup */}
        <div style={s.card}>
          <div style={s.iconWrap("#EFF6FF")}>
            <Upload size={26} color="#2563EB" />
          </div>
          <div style={s.cardTitle}>رفع نسخة احتياطية</div>
          <div style={s.cardDesc}>
            استيراد بيانات من ملف نسخ احتياطي سابق لاستعادة جميع السجلات والمعلومات المحفوظة.
          </div>
          <label style={{ width: "100%", cursor: "pointer" }}>
            <input
              type="file"
              accept=".json,.bak"
              style={{ display: "none" }}
              onChange={() => showToast("تم رفع ملف النسخة الاحتياطية بنجاح ✓")}
            />
            <div style={s.outlineBtn}>
              <Upload size={16} />
              رفع ملف
            </div>
          </label>
        </div>

        {/* Card 2: Download Backup */}
        <div style={s.card}>
          <div style={s.iconWrap("#F0FDF4")}>
            <Download size={26} color="#16A34A" />
          </div>
          <div style={s.cardTitle}>تحميل نسخة احتياطية</div>
          <div style={s.cardDesc}>
            تصدير جميع البيانات الحالية كملف نسخ احتياطي كامل يمكن استعادته في أي وقت.
          </div>
          <button
            style={{ ...s.primaryBtn, backgroundColor: "#16A34A" }}
            onClick={() => showToast("جاري تحميل النسخة الاحتياطية...")}
          >
            <Download size={16} />
            تحميل النسخة الاحتياطية
          </button>
        </div>

        {/* Card 3: Invoice Template */}
        <div style={s.card}>
          <div style={s.iconWrap("#FFF7ED")}>
            <FileText size={26} color="#EA580C" />
          </div>
          <div style={s.cardTitle}>تحميل نموذج الفاتورة</div>
          <div style={s.cardDesc}>
            تحميل نموذج الفاتورة الفارغ بصيغة PDF جاهز للطباعة وتعبئة البيانات يدوياً.
          </div>
          <button
            style={{ ...s.outlineBtn, color: "#EA580C", border: "2px solid #EA580C" }}
            onClick={() => showToast("جاري تحضير نموذج الفاتورة...")}
          >
            <FileText size={16} />
            تحميل النموذج
          </button>
        </div>
      </div>

      {/* Info Section */}
      <div style={s.infoCard}>
        <div
          style={{
            width: "36px",
            height: "36px",
            minWidth: "36px",
            borderRadius: "8px",
            backgroundColor: "#DBEAFE",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ color: "#2563EB", fontSize: "16px", fontWeight: 700 }}>ℹ</span>
        </div>
        <div>
          <div style={{ color: "#1D4ED8", fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>
            معلومات النظام
          </div>
          <div style={{ color: "#3B82F6", fontSize: "13px", lineHeight: 1.7 }}>
            يُنصح بأخذ نسخة احتياطية بشكل منتظم للحفاظ على بياناتك. الملفات المدعومة: JSON، BAK.
            <br />
            الإصدار الحالي: <strong>v1.0.0</strong> — تاريخ التحديث: 18/06/2026
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={s.successToast}>
          <CheckCircle size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
