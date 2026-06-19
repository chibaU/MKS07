import { useState } from "react";
import { Pencil, Trash2, Plus, Search, X, Package } from "lucide-react";

interface Product {
  id: number;
  name: string;
}

const initialProducts: Product[] = [
  { id: 1, name: "تمر مجدول" },
  { id: 2, name: "زيت زيتون بكر ممتاز" },
  { id: 3, name: "عسل طبيعي" },
  { id: 4, name: "تمر سكري" },
  { id: 5, name: "زعفران إيراني" },
  { id: 6, name: "قهوة عربية" },
];

const s = {
  page: { padding: "32px", direction: "rtl" as const },
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
    width: "400px",
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

const productColors = ["#EFF6FF", "#F0FDF4", "#FFF7ED", "#FDF4FF", "#F0F9FF", "#FFFBEB"];
const productTextColors = ["#2563EB", "#16A34A", "#EA580C", "#9333EA", "#0284C7", "#D97706"];

export function ProductsPage() {
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [formName, setFormName] = useState("");

  const filtered = products.filter((p) => p.name.includes(search));

  const openAdd = () => {
    setEditing(null);
    setFormName("");
    setShowModal(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setFormName(p.name);
    setShowModal(true);
  };

  const handleSave = () => {
    if (!formName) return;
    if (editing) {
      setProducts((prev) => prev.map((p) => (p.id === editing.id ? { ...p, name: formName } : p)));
    } else {
      setProducts((prev) => [...prev, { id: Date.now(), name: formName }]);
    }
    setShowModal(false);
  };

  return (
    <div style={s.page}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={s.h1}>إدارة المنتجات</h1>
        <p style={s.subtitle}>عرض وإدارة جميع المنتجات المتاحة</p>
      </div>

      <div style={s.topBar}>
        <div style={s.searchWrap}>
          <Search size={16} style={s.searchIcon} />
          <input
            style={s.searchInput}
            placeholder="بحث عن منتج..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button style={s.addBtn} onClick={openAdd}>
          <Plus size={16} />
          إضافة منتج
        </button>
      </div>

      <div style={s.tableCard}>
        <table style={s.table}>
          <thead>
            <tr>
              {["#", "اسم المنتج", "الإجراءات"].map((h) => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => {
              const bg = productColors[i % productColors.length];
              const tc = productTextColors[i % productTextColors.length];
              return (
                <tr key={p.id} style={{ backgroundColor: i % 2 === 0 ? "white" : "#FAFBFC" }}>
                  <td style={{ ...s.td, color: "#94A3B8", width: "50px" }}>{i + 1}</td>
                  <td style={{ ...s.td, fontWeight: 600 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div
                        style={{
                          width: "34px",
                          height: "34px",
                          borderRadius: "8px",
                          backgroundColor: bg,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Package size={16} color={tc} />
                      </div>
                      {p.name}
                    </div>
                  </td>
                  <td style={s.td}>
                    <button
                      style={{ ...s.actionBtn, backgroundColor: "#EFF6FF", color: "#2563EB" }}
                      onClick={() => openEdit(p)}
                    >
                      <Pencil size={13} />
                      تعديل
                    </button>
                    <button
                      style={{ ...s.actionBtn, backgroundColor: "#FEF2F2", color: "#EF4444" }}
                      onClick={() => setProducts((prev) => prev.filter((x) => x.id !== p.id))}
                    >
                      <Trash2 size={13} />
                      حذف
                    </button>
                  </td>
                </tr>
              );
            })}
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
                {editing ? "تعديل المنتج" : "إضافة منتج جديد"}
              </span>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div style={s.fieldGroup}>
              <label style={s.label}>اسم المنتج</label>
              <input
                style={s.input}
                placeholder="أدخل اسم المنتج"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
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
