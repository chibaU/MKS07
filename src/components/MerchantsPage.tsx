import { useState } from "react";
import { Pencil, Trash2, Plus, Search, X } from "lucide-react";

interface Merchant {
  id: number;
  name: string;
  address: string;
  phone: string;
}

const initialMerchants: Merchant[] = [
  { id: 1, name: "أحمد محمد العلي", address: "الرياض، حي النزهة", phone: "0501234567" },
  { id: 2, name: "خالد سعد الغامدي", address: "جدة، حي الروضة", phone: "0512345678" },
  { id: 3, name: "فهد عبدالله العتيبي", address: "مكة المكرمة، العزيزية", phone: "0523456789" },
  { id: 4, name: "سعد محمد الزهراني", address: "المدينة المنورة، العوالي", phone: "0534567890" },
  { id: 5, name: "عمر علي القحطاني", address: "الدمام، حي الشاطئ", phone: "0545678901" },
  { id: 6, name: "ناصر خالد الدوسري", address: "الخبر، حي اليرموك", phone: "0556789012" },
];

const s = {
  page: { padding: "32px", direction: "rtl" as const },
  header: { marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  h1: { color: "#1E293B", fontSize: "24px", fontWeight: 700, margin: 0 },
  subtitle: { color: "#64748B", fontSize: "14px", marginTop: "4px" },
  topBar: {
    display: "flex",
    gap: "12px",
    marginBottom: "20px",
    alignItems: "center",
    backgroundColor: "white",
    padding: "16px 20px",
    borderRadius: "10px",
    border: "1px solid #E2E8F0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  searchWrap: { position: "relative" as const, flex: 1 },
  searchIcon: { position: "absolute" as const, right: "12px", top: "50%", transform: "translateY(-50%)", color: "#94A3B8" },
  searchInput: {
    width: "100%",
    padding: "10px 40px 10px 14px",
    borderRadius: "8px",
    border: "1px solid #E2E8F0",
    backgroundColor: "#F8FAFC",
    color: "#1E293B",
    fontSize: "14px",
    outline: "none",
    fontFamily: "'Cairo', sans-serif",
    boxSizing: "border-box" as const,
  },
  addBtn: {
    backgroundColor: "#2563EB",
    color: "white",
    border: "none",
    borderRadius: "8px",
    padding: "10px 20px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontFamily: "'Cairo', sans-serif",
    whiteSpace: "nowrap" as const,
  },
  tableCard: {
    backgroundColor: "white",
    borderRadius: "12px",
    border: "1px solid #E2E8F0",
    overflow: "hidden",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
  table: { width: "100%", borderCollapse: "collapse" as const },
  th: {
    backgroundColor: "#F8FAFC",
    color: "#64748B",
    padding: "12px 16px",
    textAlign: "right" as const,
    fontSize: "13px",
    fontWeight: 600,
    borderBottom: "1px solid #E2E8F0",
  },
  td: {
    padding: "14px 16px",
    borderBottom: "1px solid #F1F5F9",
    color: "#1E293B",
    fontSize: "14px",
  },
  actionBtn: {
    border: "none",
    borderRadius: "6px",
    padding: "6px 12px",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "12px",
    fontFamily: "'Cairo', sans-serif",
    fontWeight: 500,
    marginLeft: "6px",
  },
  overlay: {
    position: "fixed" as const,
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    direction: "rtl" as const,
  },
  modal: {
    backgroundColor: "white",
    borderRadius: "14px",
    padding: "32px",
    width: "440px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" },
  modalTitle: { color: "#1E293B", fontSize: "18px", fontWeight: 700 },
  closeBtn: { border: "none", background: "none", cursor: "pointer", color: "#94A3B8", padding: "4px" },
  fieldGroup: { marginBottom: "16px", display: "flex", flexDirection: "column" as const, gap: "6px" },
  label: { color: "#374151", fontSize: "13px", fontWeight: 600 },
  input: {
    padding: "10px 14px",
    borderRadius: "8px",
    border: "1px solid #E2E8F0",
    backgroundColor: "#F8FAFC",
    color: "#1E293B",
    fontSize: "14px",
    outline: "none",
    fontFamily: "'Cairo', sans-serif",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  modalFooter: { display: "flex", gap: "12px", marginTop: "24px", justifyContent: "flex-end" },
  saveBtn: {
    backgroundColor: "#2563EB",
    color: "white",
    border: "none",
    borderRadius: "8px",
    padding: "10px 24px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Cairo', sans-serif",
  },
  cancelBtn: {
    backgroundColor: "white",
    color: "#64748B",
    border: "1px solid #E2E8F0",
    borderRadius: "8px",
    padding: "10px 24px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "'Cairo', sans-serif",
  },
};

export function MerchantsPage() {
  const [merchants, setMerchants] = useState(initialMerchants);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Merchant | null>(null);
  const [form, setForm] = useState({ name: "", address: "", phone: "" });

  const filtered = merchants.filter(
    (m) => m.name.includes(search) || m.address.includes(search) || m.phone.includes(search)
  );

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", address: "", phone: "" });
    setShowModal(true);
  };

  const openEdit = (m: Merchant) => {
    setEditing(m);
    setForm({ name: m.name, address: m.address, phone: m.phone });
    setShowModal(true);
  };

  const handleSave = () => {
    if (!form.name) return;
    if (editing) {
      setMerchants((prev) => prev.map((m) => (m.id === editing.id ? { ...m, ...form } : m)));
    } else {
      setMerchants((prev) => [...prev, { id: Date.now(), ...form }]);
    }
    setShowModal(false);
  };

  const handleDelete = (id: number) => {
    setMerchants((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>إدارة التجار</h1>
          <p style={s.subtitle}>عرض وإدارة جميع التجار المسجلين</p>
        </div>
      </div>

      <div style={s.topBar}>
        <div style={s.searchWrap}>
          <Search size={16} style={s.searchIcon} />
          <input
            style={s.searchInput}
            placeholder="بحث عن تاجر..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button style={s.addBtn} onClick={openAdd}>
          <Plus size={16} />
          إضافة تاجر
        </button>
      </div>

      <div style={s.tableCard}>
        <table style={s.table}>
          <thead>
            <tr>
              {["#", "اسم التاجر", "العنوان", "رقم الهاتف", "الإجراءات"].map((h) => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((m, i) => (
              <tr key={m.id} style={{ backgroundColor: i % 2 === 0 ? "white" : "#FAFBFC" }}>
                <td style={{ ...s.td, color: "#94A3B8", width: "50px" }}>{i + 1}</td>
                <td style={{ ...s.td, fontWeight: 600 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                      style={{
                        width: "34px",
                        height: "34px",
                        borderRadius: "50%",
                        backgroundColor: "#EFF6FF",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#2563EB",
                        fontSize: "13px",
                        fontWeight: 700,
                      }}
                    >
                      {m.name.charAt(0)}
                    </div>
                    {m.name}
                  </div>
                </td>
                <td style={{ ...s.td, color: "#64748B" }}>{m.address}</td>
                <td style={{ ...s.td, direction: "ltr", textAlign: "right" as const }}>{m.phone}</td>
                <td style={s.td}>
                  <button
                    style={{ ...s.actionBtn, backgroundColor: "#EFF6FF", color: "#2563EB" }}
                    onClick={() => openEdit(m)}
                  >
                    <Pencil size={13} />
                    تعديل
                  </button>
                  <button
                    style={{ ...s.actionBtn, backgroundColor: "#FEF2F2", color: "#EF4444" }}
                    onClick={() => handleDelete(m.id)}
                  >
                    <Trash2 size={13} />
                    حذف
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: "40px", textAlign: "center", color: "#94A3B8", fontSize: "14px" }}>
            لا توجد نتائج مطابقة
          </div>
        )}
      </div>

      {showModal && (
        <div style={s.overlay} onClick={() => setShowModal(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>
                {editing ? "تعديل بيانات التاجر" : "إضافة تاجر جديد"}
              </span>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div style={s.fieldGroup}>
              <label style={s.label}>اسم التاجر</label>
              <input
                style={s.input}
                placeholder="أدخل اسم التاجر"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div style={s.fieldGroup}>
              <label style={s.label}>العنوان</label>
              <input
                style={s.input}
                placeholder="المدينة، الحي"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div style={s.fieldGroup}>
              <label style={s.label}>رقم الهاتف</label>
              <input
                style={s.input}
                placeholder="05XXXXXXXX"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => setShowModal(false)}>إلغاء</button>
              <button style={s.saveBtn} onClick={handleSave}>حفظ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
