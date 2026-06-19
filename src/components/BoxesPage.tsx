import { useState } from "react";
import { Pencil, Trash2, Plus, Search, X, Eye, EyeOff } from "lucide-react";
import type { SharedBox } from "../App";

// ─── Types ────────────────────────────────────────────────────────────────────

type Filter = "all" | "visible" | "hidden";

interface BoxesPageProps {
  sharedBoxes: SharedBox[];
  setSharedBoxes: React.Dispatch<React.SetStateAction<SharedBox[]>>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export function BoxesPage({ sharedBoxes, setSharedBoxes }: BoxesPageProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("visible");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SharedBox | null>(null);
  const [form, setForm] = useState({ name: "", weight: "" });

  // Apply search + visibility filter
  const filtered = sharedBoxes.filter((b) => {
    const matchSearch = b.name.includes(search);
    if (filter === "visible") return matchSearch && b.visible;
    if (filter === "hidden") return matchSearch && !b.visible;
    return matchSearch;
  });

  const visibleCount = sharedBoxes.filter((b) => b.visible).length;
  const hiddenCount = sharedBoxes.filter((b) => !b.visible).length;

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", weight: "" });
    setShowModal(true);
  };

  const openEdit = (b: SharedBox) => {
    setEditing(b);
    setForm({ name: b.name, weight: String(b.emptyWeight) });
    setShowModal(true);
  };

  const handleSave = () => {
    if (!form.name || !form.weight) return;
    const emptyWeight = parseFloat(form.weight) || 0;
    if (editing) {
      setSharedBoxes((prev) =>
        prev.map((b) => (b.id === editing.id ? { ...b, name: form.name, emptyWeight } : b))
      );
    } else {
      setSharedBoxes((prev) => [
        ...prev,
        { id: Date.now(), name: form.name, emptyWeight, visible: true },
      ]);
    }
    setShowModal(false);
  };

  const handleDelete = (id: number) =>
    setSharedBoxes((prev) => prev.filter((b) => b.id !== id));

  const toggleVisibility = (id: number) =>
    setSharedBoxes((prev) =>
      prev.map((b) => (b.id === id ? { ...b, visible: !b.visible } : b))
    );

  const getWeightColor = (w: number) => {
    if (w <= 2) return { bg: "#F0FDF4", text: "#16A34A" };
    if (w <= 3.5) return { bg: "#FFFBEB", text: "#D97706" };
    return { bg: "#FEF2F2", text: "#DC2626" };
  };

  const filterBtnStyle = (f: Filter) => ({
    padding: "8px 16px",
    borderRadius: "8px",
    border: filter === f ? "1px solid #2563EB" : "1px solid #E2E8F0",
    backgroundColor: filter === f ? "#EFF6FF" : "white",
    color: filter === f ? "#2563EB" : "#64748B",
    fontSize: "13px",
    fontWeight: filter === f ? 600 : 400,
    cursor: "pointer",
    fontFamily: "'Cairo', sans-serif",
    display: "inline-flex" as const,
    alignItems: "center" as const,
    gap: "6px",
  });

  return (
    <div style={s.page}>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={s.h1}>إدارة الصناديق</h1>
        <p style={s.subtitle}>عرض وإدارة أوزان الصناديق المستخدمة في الفواتير</p>
      </div>

      {/* Filter + Search Bar */}
      <div style={s.topBar}>
        {/* Visibility Filter */}
        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          <button style={filterBtnStyle("visible")} onClick={() => setFilter("visible")}>
            <Eye size={14} />
            النشط فقط
            <span
              style={{
                backgroundColor: "#DBEAFE",
                color: "#1D4ED8",
                borderRadius: "10px",
                padding: "1px 7px",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              {visibleCount}
            </span>
          </button>
          <button style={filterBtnStyle("hidden")} onClick={() => setFilter("hidden")}>
            <EyeOff size={14} />
            المخفي فقط
            <span
              style={{
                backgroundColor: "#FCE7F3",
                color: "#9D174D",
                borderRadius: "10px",
                padding: "1px 7px",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              {hiddenCount}
            </span>
          </button>
          <button style={filterBtnStyle("all")} onClick={() => setFilter("all")}>
            عرض الكل
            <span
              style={{
                backgroundColor: "#F1F5F9",
                color: "#475569",
                borderRadius: "10px",
                padding: "1px 7px",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              {sharedBoxes.length}
            </span>
          </button>
        </div>

        <div style={{ flex: 1, ...s.searchWrap }}>
          <Search size={16} style={s.searchIcon} />
          <input
            style={s.searchInput}
            placeholder="بحث عن صندوق..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <button style={s.addBtn} onClick={openAdd}>
          <Plus size={16} />
          إضافة صندوق
        </button>
      </div>

      {/* Table */}
      <div style={s.tableCard}>
        <table style={s.table}>
          <thead>
            <tr>
              {["#", "اسم الصندوق", "الوزن (كغ)", "الحالة", "الإجراءات"].map((h) => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((b, i) => {
              const colors = getWeightColor(b.emptyWeight);
              const isHidden = !b.visible;
              return (
                <tr
                  key={b.id}
                  style={{
                    backgroundColor: i % 2 === 0 ? "white" : "#FAFBFC",
                    opacity: isHidden ? 0.55 : 1,
                    transition: "opacity 0.15s",
                  }}
                >
                  <td style={{ ...s.td, color: "#94A3B8", width: "50px" }}>{i + 1}</td>

                  {/* Box Name */}
                  <td style={{ ...s.td, fontWeight: 600 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div
                        style={{
                          width: "34px", height: "34px", borderRadius: "8px",
                          backgroundColor: isHidden ? "#F1F5F9" : "#EFF6FF",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: isHidden ? "#94A3B8" : "#2563EB",
                          fontSize: "12px", fontWeight: 700,
                        }}
                      >
                        {b.name.split(" ").pop()}
                      </div>
                      <span style={{ color: isHidden ? "#94A3B8" : "#1E293B" }}>{b.name}</span>
                      {isHidden && (
                        <span
                          style={{
                            backgroundColor: "#F1F5F9",
                            color: "#64748B",
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: "10px",
                            border: "1px solid #E2E8F0",
                          }}
                        >
                          مخفي
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Weight */}
                  <td style={s.td}>
                    <span
                      style={{
                        backgroundColor: isHidden ? "#F8FAFC" : colors.bg,
                        color: isHidden ? "#94A3B8" : colors.text,
                        padding: "4px 12px",
                        borderRadius: "6px",
                        fontSize: "13px",
                        fontWeight: 600,
                      }}
                    >
                      {b.emptyWeight} كغ
                    </span>
                  </td>

                  {/* Visibility Toggle */}
                  <td style={s.td}>
                    <button
                      onClick={() => toggleVisibility(b.id)}
                      title={b.visible ? "إخفاء من قائمة الإنشاء" : "إظهار في قائمة الإنشاء"}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "6px 14px",
                        borderRadius: "20px",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontFamily: "'Cairo', sans-serif",
                        fontWeight: 600,
                        backgroundColor: b.visible ? "#F0FDF4" : "#F8FAFC",
                        color: b.visible ? "#16A34A" : "#64748B",
                        transition: "all 0.15s",
                      }}
                    >
                      {b.visible ? (
                        <>
                          <Eye size={13} />
                          نشط
                        </>
                      ) : (
                        <>
                          <EyeOff size={13} />
                          مخفي
                        </>
                      )}
                    </button>
                  </td>

                  {/* Actions */}
                  <td style={s.td}>
                    <button
                      style={{ ...s.actionBtn, backgroundColor: "#EFF6FF", color: "#2563EB" }}
                      onClick={() => openEdit(b)}
                    >
                      <Pencil size={13} />
                      تعديل
                    </button>
                    <button
                      style={{ ...s.actionBtn, backgroundColor: "#FEF2F2", color: "#EF4444" }}
                      onClick={() => handleDelete(b.id)}
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
            {filter === "hidden" ? "لا توجد صناديق مخفية" :
             filter === "visible" ? "لا توجد صناديق نشطة" :
             "لا توجد نتائج مطابقة"}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div style={s.overlay} onClick={() => setShowModal(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <span style={{ color: "#1E293B", fontSize: "18px", fontWeight: 700 }}>
                {editing ? "تعديل الصندوق" : "إضافة صندوق جديد"}
              </span>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div style={s.fieldGroup}>
              <label style={s.label}>اسم الصندوق</label>
              <input
                style={s.input}
                placeholder="مثال: صندوق A"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div style={s.fieldGroup}>
              <label style={s.label}>الوزن الفارغ (كغ)</label>
              <input
                type="number"
                style={s.input}
                placeholder="0.0"
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })}
                min="0"
                step="0.1"
              />
            </div>
            <div style={{ display: "flex", gap: "12px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button style={s.cancelBtn} onClick={() => setShowModal(false)}>إلغاء</button>
              <button style={s.saveBtn} onClick={handleSave}>حفظ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
