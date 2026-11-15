/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { Pencil, Trash2, Plus, Search, X, Eye, EyeOff } from "lucide-react";
import { boxService, invoiceService, type Box } from "../services/db";

type Filter = "all" | "visible" | "hidden";

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
  filterBtn: (active: boolean) => ({
    padding: "8px 16px",
    borderRadius: "6px",
    border: "1px solid #E2E8F0",
    backgroundColor: active ? "#F1F5F9" : "white",
    color: active ? "#1E293B" : "#64748B",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    fontSize: "13px",
    fontFamily: "'Cairo', sans-serif",
  }),
  tableCard: { backgroundColor: "white", borderRadius: "12px", border: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(0,0,0,0.02)", overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse" as const, textAlign: "right" as const },
  th: { backgroundColor: "#F8FAFC", color: "#64748B", fontWeight: 650, fontSize: "13px", padding: "14px 20px", borderBottom: "1px solid #E2E8F0" },
  td: { padding: "14px 20px", borderBottom: "1px solid #E2E8F0", color: "#334155", fontSize: "14px" },
  actionBtn: { border: "none", background: "none", cursor: "pointer", padding: "4px", borderRadius: "4px", display: "inline-flex", alignItems: "center", justifyContent: "center" },
  overlay: { position: "fixed" as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(15, 23, 42, 0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(2px)" },
  modal: { backgroundColor: "white", borderRadius: "16px", width: "400px", padding: "28px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", border: "1px solid #E2E8F0" },
  fieldGroup: { marginBottom: "16px" },
  label: { display: "block", color: "#475569", fontSize: "13px", fontWeight: 600, marginBottom: "6px" },
  input: { width: "100%", padding: "10px 12px", border: "1px solid #CBD5E1", borderRadius: "8px", fontSize: "14px", fontFamily: "'Cairo', sans-serif", boxSizing: "border-box" as const, outline: "none" },
  cancelBtn: { backgroundColor: "white", color: "#475569", border: "1px solid #CBD5E1", borderRadius: "8px", padding: "10px 20px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "'Cairo', sans-serif" },
  saveBtn: { backgroundColor: "#2563EB", color: "white", border: "none", borderRadius: "8px", padding: "10px 24px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "'Cairo', sans-serif" },
  closeBtn: { border: "none", background: "none", color: "#94A3B8", cursor: "pointer", display: "flex", alignItems: "center" },
};

interface BoxesPageProps {
  onDataChange?: () => void;
}

export function BoxesPage({ onDataChange }: BoxesPageProps) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    name: "",
    weight: "",
  });

  // 1. جلب الصناديق من قاعدة البيانات
  const loadBoxes = async () => {
    try {
      setLoading(true);
      const data = await boxService.getAll();
      setBoxes(data);
    } catch (error) {
      console.error("خطأ في جلب الصناديق:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBoxes();
  }, []);

  // 2. تصفية البيانات حسب الفلتر والبحث
  const filtered = boxes.filter((b) => {
    const matchesSearch = b.name.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;

    if (filter === "visible") return b.is_visible === 1;
    if (filter === "hidden") return b.is_visible === 0;
    return true;
  });

  // 3. فتح نافذة الإضافة
  const handleAddNew = () => {
    setEditing(null);
    setForm({ name: "", weight: "" });
    setShowModal(true);
  };

  // 4. فتح نافذة التعديل ببيانات الصندوق المختار
  const handleEditClick = (b: Box) => {
    setEditing(b.id);
    setForm({
      name: b.name,
      weight: b.weight.toString(),
    });
    setShowModal(true);
  };

  // 5. حفظ البيانات (إضافة أو تعديل) في SQLite
  const handleSave = async () => {
    const parsedWeight = parseFloat(form.weight);
    if (!form.name.trim() || isNaN(parsedWeight)) return;

    try {
      if (editing === null) {
        await boxService.create(form.name.trim(), parsedWeight);
      } else {
        // نجد الحالة الحالية للرؤية للحفاظ عليها عند التعديل العادي
        const currentBox = boxes.find((b) => b.id === editing);
        const isVisible = currentBox ? currentBox.is_visible : 1;
        await boxService.update(editing, form.name.trim(), parsedWeight, isVisible);
      }
      setShowModal(false);
      await loadBoxes();
      onDataChange?.(); // إعلام App.tsx بالتغيير (نفس نمط MerchantsPage)
    } catch (error) {
      console.error("خطأ أثناء حفظ الصندوق:", error);
    }
  };

  // 6. تبديل حالة الرؤية (إظهار / إخفاء) مباشرة وضغطها في قاعدة البيانات
  const toggleVisibility = async (b: Box) => {
    try {
      const nextVisible = b.is_visible === 1 ? 0 : 1;
      await boxService.update(b.id, b.name, b.weight, nextVisible);
      await loadBoxes();
      onDataChange?.(); // إعلام App.tsx — هذا يغيّر مباشرة قائمة الصناديق الظاهرة في نموذج الفاتورة
    } catch (error) {
      console.error("خطأ في تبديل رؤية الصندوق:", error);
    }
  };

  // 7. حذف صندوق نهائياً — نقطة 17 (القسم 3): يُمنع صراحة على مستوى التطبيق
  // حذف صندوق مُستخدَم في أي فاتورة (مفتوحة أو مغلقة). لا اعتماد على أن
  // boxService.delete نفسها سترفض العملية (PRAGMA foreign_keys غير مفعَّل
  // عمداً، راجع تعليق القسم 4.1 أعلى getDB في db.ts).
  const handleDelete = async (id: number) => {
    if (!confirm("هل أنت متأكد من حذف هذا الصندوق؟")) return;

    try {
      const hasReferences = await invoiceService.boxHasInvoiceReferences(id);
      if (hasReferences) {
        alert(
          "لا يمكن حذف الصناديق المستعملة في فواتير محفوظة؛ يجب حذف البنود المرتبطة بها أو تعديل الفواتير أولاً.",
        );
        return;
      }

      await boxService.delete(id);
      await loadBoxes();
      onDataChange?.(); // إعلام App.tsx بالتغيير (نفس نمط MerchantsPage)
    } catch (error) {
      console.error("خطأ أثناء حذف الصندوق:", error);
    }
  };

  return (
    <div style={s.page}>
      <div style={{ marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={s.h1}>📦 إدارة الصناديق</h1>
          <div style={s.subtitle}>تحديد وتعديل أوزان الصناديق الفارغة (العبوات) وحالة ظهورها</div>
        </div>
        <button style={s.addBtn} onClick={handleAddNew}>
          <Plus size={16} />
          إضافة صندوق جديد
        </button>
      </div>

      <div style={s.topBar}>
        <div style={s.searchWrap}>
          <Search size={18} style={s.searchIcon} />
          <input
            style={s.searchInput}
            placeholder="بحث باسم الصندوق..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button style={s.filterBtn(filter === "all")} onClick={() => setFilter("all")}>الكل</button>
          <button style={s.filterBtn(filter === "visible")} onClick={() => setFilter("visible")}>النشطة</button>
          <button style={s.filterBtn(filter === "hidden")} onClick={() => setFilter("hidden")}>المخفية</button>
        </div>
      </div>

      <div style={s.tableCard}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>اسم الصندوق</th>
              <th style={s.th}>الوزن الفارغ (كغ)</th>
              <th style={s.th}>الحالة</th>
              <th style={{ ...s.th, width: "120px", textAlign: "center" }}>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} style={{ ...s.td, textAlign: "center", color: "#64748B" }}>
                  جاري جلب البيانات من قاعدة البيانات...
                </td>
              </tr>
            ) : filtered.map((b) => (
              <tr key={b.id} style={{ opacity: b.is_visible === 0 ? 0.6 : 1 }}>
                <td style={{ ...s.td, fontWeight: 600, color: "#1E293B" }}>{b.name}</td>
                <td style={{ ...s.td, fontFamily: "monospace" }}>{b.weight.toFixed(2)} كغ</td>
                <td style={s.td}>
                  <span
                    style={{
                      inlineSize: "max-content",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      fontWeight: 600,
                      backgroundColor: b.is_visible === 1 ? "#DCFCE7" : "#F1F5F9",
                      color: b.is_visible === 1 ? "#15803D" : "#475569",
                    }}
                  >
                    {b.is_visible === 1 ? "نشط" : "مخفي"}
                  </span>
                </td>
                <td style={{ ...s.td, textAlign: "center" }}>
                  <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                    <button
                      style={{ ...s.actionBtn, color: "#475569" }}
                      onClick={() => toggleVisibility(b)}
                      title={b.is_visible === 1 ? "إخفاء من قائمة فواتير البيع" : "إظهار"}
                    >
                      {b.is_visible === 1 ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                    <button
                      style={{ ...s.actionBtn, color: "#2563EB" }}
                      onClick={() => handleEditClick(b)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      style={{ ...s.actionBtn, color: "#EF4444" }}
                      onClick={() => handleDelete(b.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <span style={{ color: "#1E293B", fontSize: "18px", fontWeight: 700 }}>
                {editing !== null ? "تعديل الصندوق" : "إضافة صندوق جديد"}
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
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
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