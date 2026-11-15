/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { Pencil, Trash2, Plus, Search, X } from "lucide-react";
import { productService, type Product } from "../services/db";

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
  searchInput: { width: "100%", padding: "10px 38px 10px 12px", border: "1px solid #CBD5E1", borderRadius: "8px", fontSize: "14px", fontFamily: "'Cairo', sans-serif", boxSizing: "border-box" as const, outline: "none" },
  addBtn: { backgroundColor: "#2563EB", color: "white", border: "none", borderRadius: "8px", padding: "10px 16px", fontSize: "14px", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontFamily: "'Cairo', sans-serif" },
  tableCard: { backgroundColor: "white", borderRadius: "12px", border: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(0,0,0,0.02)", overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse" as const, textAlign: "right" as const },
  th: { backgroundColor: "#F8FAFC", color: "#64748B", fontWeight: 650, fontSize: "13px", padding: "14px 20px", borderBottom: "1px solid #E2E8F0" },
  td: { padding: "14px 20px", borderBottom: "1px solid #E2E8F0", color: "#334155", fontSize: "14px" },
  actionBtn: { border: "none", background: "none", cursor: "pointer", padding: "4px", borderRadius: "4px", display: "inline-flex", alignItems: "center", justifyContent: "center" },
  overlay: { position: "fixed" as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(15, 23, 42, 0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(2px)" },
  modal: { backgroundColor: "white", borderRadius: "16px", width: "400px", padding: "28px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", border: "1px solid #E2E8F0" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" },
  modalTitle: { color: "#1E293B", fontSize: "18px", fontWeight: 700 },
  closeBtn: { border: "none", background: "none", color: "#94A3B8", cursor: "pointer", display: "flex", alignItems: "center" },
  fieldGroup: { marginBottom: "16px" },
  label: { display: "block", color: "#475569", fontSize: "13px", fontWeight: 600, marginBottom: "6px" },
  input: { width: "100%", padding: "10px 12px", border: "1px solid #CBD5E1", borderRadius: "8px", fontSize: "14px", fontFamily: "'Cairo', sans-serif", boxSizing: "border-box" as const, outline: "none" },
  modalFooter: { display: "flex", gap: "12px", marginTop: "24px", justifyContent: "flex-end" },
  cancelBtn: { backgroundColor: "white", color: "#475569", border: "1px solid #CBD5E1", borderRadius: "8px", padding: "10px 20px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "'Cairo', sans-serif" },
  saveBtn: { backgroundColor: "#2563EB", color: "white", border: "none", borderRadius: "8px", padding: "10px 24px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "'Cairo', sans-serif" },
};

interface ProductsPageProps {
  onDataChange?: () => void;
}

export function ProductsPage({ onDataChange }: ProductsPageProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [loading, setLoading] = useState(true);

  // 1. جلب المنتجات من قاعدة البيانات
  const loadProducts = async () => {
    try {
      setLoading(true);
      const data = await productService.getAll();
      setProducts(data);
    } catch (error) {
      console.error("خطأ في جلب المنتجات:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  // 2. تصفية البحث للجدول
  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  // 3. فتح نافذة الإضافة
  const handleAddNew = () => {
    setEditing(null);
    setFormName("");
    setShowModal(true);
  };

  // 4. فتح نافذة التعديل
  const handleEditClick = (p: Product) => {
    setEditing(p.id);
    setFormName(p.name);
    setShowModal(true);
  };

  // 5. حفظ البيانات (إضافة أو تعديل) في SQLite
  const handleSave = async () => {
    if (!formName.trim()) return;

    try {
      if (editing === null) {
        await productService.create(formName.trim());
      } else {
        await productService.update(editing, formName.trim());
      }
      setShowModal(false);
      await loadProducts(); // تحديث القائمة فوراً
      onDataChange?.(); // إعلام App.tsx بالتغيير (نفس نمط MerchantsPage)
    } catch (error) {
      console.error("خطأ أثناء حفظ المنتج:", error);
    }
  };

  // 6. حذف المنتج
  const handleDelete = async (id: number) => {
    if (confirm("هل أنت متأكد من حذف هذا المنتج؟")) {
      try {
        await productService.delete(id);
        await loadProducts(); // تحديث القائمة فوراً
        onDataChange?.(); // إعلام App.tsx بالتغيير (نفس نمط MerchantsPage)
      } catch (error) {
        console.error("خطأ أثناء حذف المنتج:", error);
      }
    }
  };

  return (
    <div style={s.page}>
      <div style={{ marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={s.h1}>📦 إدارة المنتجات</h1>
          <div style={s.subtitle}>إدارة أصناف السلع والتمور المتوفرة في النظام</div>
        </div>
        <button style={s.addBtn} onClick={handleAddNew}>
          <Plus size={16} />
          إضافة منتج جديد
        </button>
      </div>

      <div style={s.topBar}>
        <div style={s.searchWrap}>
          <Search size={18} style={s.searchIcon} />
          <input
            style={s.searchInput}
            placeholder="بحث باسم المنتج..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div style={s.tableCard}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={{ ...s.th, width: "80px" }}>المعرف</th>
              <th style={s.th}>اسم المنتج</th>
              <th style={{ ...s.th, width: "120px", textAlign: "center" }}>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} style={{ ...s.td, textAlign: "center", color: "#64748B" }}>
                  جاري جلب البيانات من قاعدة البيانات...
                </td>
              </tr>
            ) : filtered.map((p) => {
              return (
                <tr key={p.id}>
                  <td style={{ ...s.td, color: "#64748B", fontFamily: "monospace" }}>#{p.id}</td>
                  <td style={{ ...s.td, fontWeight: 600, color: "#1E293B" }}>{p.name}</td>
                  <td style={{ ...s.td, textAlign: "center" }}>
                    <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                      <button
                        style={{ ...s.actionBtn, color: "#2563EB" }}
                        onClick={() => handleEditClick(p)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        style={{ ...s.actionBtn, color: "#EF4444" }}
                        onClick={() => handleDelete(p.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
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
                {editing !== null ? "تعديل المنتج" : "إضافة منتج جديد"}
              </span>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div style={s.fieldGroup}>
              <label style={s.label}>اسم المنتج</label>
              <input
                style={s.input}
                placeholder="أدخل اسم المنتج (مثال: دقلة نور)"
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