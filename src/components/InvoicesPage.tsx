import { useState } from "react";
import { Eye, Pencil, Trash2, Search, ArrowRight, ChevronRight, ChevronLeft, Plus, X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceItem {
  product: string;
  weight: number;
  netWeight: number;
  price: number;
}

interface InvoiceBox {
  name: string;
  gross: number;
}

interface Invoice {
  id: number;
  invoiceNum: string;
  merchant: string;
  date: string;
  items: InvoiceItem[];
  boxes: InvoiceBox[];
}

// ─── Sample Data ──────────────────────────────────────────────────────────────

const INITIAL_INVOICES: Invoice[] = [
  {
    id: 1, invoiceNum: "INV-2026-001", merchant: "أحمد محمد العلي", date: "2026-06-15",
    items: [
      { product: "تمر مجدول", weight: 50.0, netWeight: 47.5, price: 28.5 },
      { product: "زيت زيتون", weight: 25.0, netWeight: 22.5, price: 35.0 },
    ],
    boxes: [{ name: "صندوق A", gross: 52.5 }, { name: "صندوق B", gross: 28.0 }],
  },
  {
    id: 2, invoiceNum: "INV-2026-002", merchant: "خالد سعد الغامدي", date: "2026-06-14",
    items: [{ product: "عسل طبيعي", weight: 40.0, netWeight: 38.0, price: 95.0 }],
    boxes: [{ name: "صندوق C", gross: 42.0 }],
  },
  {
    id: 3, invoiceNum: "INV-2026-003", merchant: "فهد العتيبي", date: "2026-06-13",
    items: [
      { product: "تمر سكري", weight: 75.0, netWeight: 73.5, price: 22.0 },
      { product: "زعفران", weight: 15.0, netWeight: 13.5, price: 450.0 },
    ],
    boxes: [{ name: "صندوق D", gross: 76.5 }, { name: "صندوق A", gross: 16.5 }],
  },
  {
    id: 4, invoiceNum: "INV-2026-004", merchant: "سعد الزهراني", date: "2026-06-12",
    items: [{ product: "قهوة عربية", weight: 98.0, netWeight: 96.0, price: 18.5 }],
    boxes: [{ name: "صندوق B", gross: 100.0 }],
  },
  {
    id: 5, invoiceNum: "INV-2026-005", merchant: "عمر القحطاني", date: "2026-06-11",
    items: [
      { product: "تمر مجدول", weight: 30.0, netWeight: 28.5, price: 28.5 },
      { product: "عسل طبيعي", weight: 20.0, netWeight: 18.5, price: 95.0 },
      { product: "زيت زيتون", weight: 15.0, netWeight: 13.5, price: 35.0 },
    ],
    boxes: [{ name: "صندوق A", gross: 32.5 }, { name: "صندوق E", gross: 22.0 }],
  },
  {
    id: 6, invoiceNum: "INV-2026-006", merchant: "ناصر الدوسري", date: "2026-06-10",
    items: [{ product: "زعفران", weight: 5.0, netWeight: 3.5, price: 450.0 }],
    boxes: [{ name: "صندوق C", gross: 7.0 }],
  },
  {
    id: 7, invoiceNum: "INV-2026-007", merchant: "أحمد محمد العلي", date: "2026-06-09",
    items: [{ product: "تمر سكري", weight: 60.0, netWeight: 58.0, price: 22.0 }],
    boxes: [{ name: "صندوق D", gross: 61.5 }],
  },
  {
    id: 8, invoiceNum: "INV-2026-008", merchant: "خالد سعد الغامدي", date: "2026-06-08",
    items: [
      { product: "عسل طبيعي", weight: 29.0, netWeight: 27.0, price: 95.0 },
      { product: "قهوة عربية", weight: 50.0, netWeight: 48.0, price: 18.5 },
    ],
    boxes: [{ name: "صندوق B", gross: 32.0 }, { name: "صندوق A", gross: 52.5 }],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

// ─── Shared Styles ────────────────────────────────────────────────────────────

const sh = {
  input: {
    padding: "8px 12px",
    borderRadius: "7px",
    border: "1px solid #E2E8F0",
    backgroundColor: "#F8FAFC",
    color: "#1E293B",
    fontSize: "13px",
    outline: "none",
    fontFamily: "'Cairo', sans-serif",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  th: {
    backgroundColor: "#F8FAFC",
    color: "#64748B",
    padding: "11px 14px",
    textAlign: "right" as const,
    fontSize: "13px",
    fontWeight: 600,
    borderBottom: "1px solid #E2E8F0",
  },
  td: {
    padding: "12px 14px",
    borderBottom: "1px solid #F1F5F9",
    color: "#1E293B",
    fontSize: "14px",
  },
  card: {
    backgroundColor: "white",
    borderRadius: "12px",
    border: "1px solid #E2E8F0",
    padding: "24px",
    marginBottom: "20px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
};

// ─── ConfirmDialog ────────────────────────────────────────────────────────────

function ConfirmDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 2000, direction: "rtl",
      }}
    >
      <div style={{ backgroundColor: "white", borderRadius: "14px", padding: "32px", width: "380px", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize: "28px", marginBottom: "12px" }}>⚠️</div>
        <div style={{ color: "#1E293B", fontSize: "17px", fontWeight: 700, marginBottom: "8px" }}>تغييرات غير محفوظة</div>
        <div style={{ color: "#64748B", fontSize: "14px", lineHeight: 1.6, marginBottom: "28px" }}>
          هناك تغييرات غير محفوظة، هل تريد الخروج؟
        </div>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ backgroundColor: "white", color: "#374151", border: "1px solid #E2E8F0", borderRadius: "8px", padding: "10px 20px", fontSize: "14px", cursor: "pointer", fontFamily: "'Cairo', sans-serif", fontWeight: 500 }}>إلغاء</button>
          <button onClick={onConfirm} style={{ backgroundColor: "#EF4444", color: "white", border: "none", borderRadius: "8px", padding: "10px 20px", fontSize: "14px", cursor: "pointer", fontFamily: "'Cairo', sans-serif", fontWeight: 600 }}>خروج بدون حفظ</button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail View ──────────────────────────────────────────────────────────────

interface DetailViewProps {
  invoice: Invoice;
  onBack: () => void;
  onSave: (updated: Invoice) => void;
}

function DetailView({ invoice, onBack, onSave }: DetailViewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<"back" | null>(null);

  // Edit state
  const [editMerchant, setEditMerchant] = useState(invoice.merchant);
  const [editItems, setEditItems] = useState<InvoiceItem[]>(invoice.items.map((it) => ({ ...it })));
  const [editBoxes, setEditBoxes] = useState<InvoiceBox[]>(invoice.boxes.map((b) => ({ ...b })));

  // New item form state
  const [newProduct, setNewProduct] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [newPrice, setNewPrice] = useState("");

  const hasChanges =
    editMerchant !== invoice.merchant ||
    JSON.stringify(editItems) !== JSON.stringify(invoice.items) ||
    JSON.stringify(editBoxes) !== JSON.stringify(invoice.boxes);

  const enterEditMode = () => {
    setEditMerchant(invoice.merchant);
    setEditItems(invoice.items.map((it) => ({ ...it })));
    setEditBoxes(invoice.boxes.map((b) => ({ ...b })));
    setNewProduct(""); setNewWeight(""); setNewPrice("");
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditMerchant(invoice.merchant);
    setEditItems(invoice.items.map((it) => ({ ...it })));
    setEditBoxes(invoice.boxes.map((b) => ({ ...b })));
  };

  const saveEdit = () => {
    onSave({ ...invoice, merchant: editMerchant, items: editItems, boxes: editBoxes });
    setIsEditing(false);
  };

  const tryBack = () => {
    if (isEditing && hasChanges) {
      setPendingLeave("back");
      setShowConfirmLeave(true);
    } else {
      onBack();
    }
  };

  const confirmLeave = () => {
    setShowConfirmLeave(false);
    if (pendingLeave === "back") onBack();
  };

  const insertItem = () => {
    if (!newProduct || !newWeight) return;
    const w = parseFloat(newWeight) || 0;
    const p = parseFloat(newPrice) || 0;
    setEditItems((prev) => [...prev, { product: newProduct, weight: w, netWeight: w, price: p }]);
    setNewProduct(""); setNewWeight(""); setNewPrice("");
  };

  const updateItem = (idx: number, field: keyof InvoiceItem, val: string) => {
    setEditItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, [field]: field === "product" ? val : parseFloat(val) || 0 } : it
      )
    );
  };

  const deleteItem = (idx: number) => setEditItems((prev) => prev.filter((_, i) => i !== idx));

  const updateBox = (idx: number, val: string) =>
    setEditBoxes((prev) => prev.map((b, i) => (i === idx ? { ...b, gross: parseFloat(val) || 0 } : b)));

  const grandTotal = editItems.reduce((s, it) => s + it.netWeight * it.price, 0);
  const totalNetWeight = editItems.reduce((s, it) => s + it.netWeight, 0);

  return (
    <div style={{ padding: "32px", direction: "rtl" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={tryBack}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              color: "#2563EB", border: "none", background: "none",
              cursor: "pointer", fontSize: "14px",
              fontFamily: "'Cairo', sans-serif", fontWeight: 600,
            }}
          >
            <ArrowRight size={16} />
            العودة
          </button>
          <span style={{ color: "#CBD5E1" }}>|</span>
          <div>
            <span style={{ color: "#1E293B", fontSize: "20px", fontWeight: 700 }}>تفاصيل الفاتورة</span>
            <span style={{ color: "#2563EB", fontSize: "14px", fontFamily: "monospace", marginRight: "10px" }}>
              {invoice.invoiceNum}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {!isEditing ? (
            <button
              onClick={enterEditMode}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                backgroundColor: "#2563EB", color: "white",
                border: "none", borderRadius: "8px",
                padding: "10px 20px", fontSize: "14px", fontWeight: 600,
                cursor: "pointer", fontFamily: "'Cairo', sans-serif",
              }}
            >
              <Pencil size={15} />
              تعديل
            </button>
          ) : (
            <>
              <button
                onClick={cancelEdit}
                style={{
                  backgroundColor: "white", color: "#374151",
                  border: "1px solid #E2E8F0", borderRadius: "8px",
                  padding: "10px 20px", fontSize: "14px", fontWeight: 600,
                  cursor: "pointer", fontFamily: "'Cairo', sans-serif",
                }}
              >
                إلغاء
              </button>
              <button
                onClick={saveEdit}
                style={{
                  backgroundColor: "#10B981", color: "white",
                  border: "none", borderRadius: "8px",
                  padding: "10px 20px", fontSize: "14px", fontWeight: 600,
                  cursor: "pointer", fontFamily: "'Cairo', sans-serif",
                  display: "flex", alignItems: "center", gap: "6px",
                }}
              >
                حفظ التعديلات
              </button>
            </>
          )}
          <div
            style={{
              backgroundColor: "#F0FDF4", color: "#16A34A",
              padding: "6px 14px", borderRadius: "20px",
              fontSize: "13px", fontWeight: 600,
              border: "1px solid #BBF7D0",
            }}
          >
            مكتملة
          </div>
        </div>
      </div>

      {/* Meta Card */}
      <div style={sh.card}>
        <div style={{ color: "#64748B", fontSize: "12px", fontWeight: 700, marginBottom: "16px", letterSpacing: "0.05em" }}>
          بيانات الفاتورة
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" }}>
          {[
            { label: "رقم الفاتورة", value: invoice.invoiceNum, mono: true },
            { label: "التاريخ", value: formatDate(invoice.date) },
            { label: "عدد البنود", value: `${editItems.length} بنود` },
            { label: "إجمالي الوزن الصافي", value: `${totalNetWeight.toFixed(2)} كغ`, color: "#0F766E" },
            { label: "الإجمالي الكلي", value: `${grandTotal.toLocaleString("ar-SA", { minimumFractionDigits: 2 })} ريال`, color: "#1D4ED8" },
          ].map((f) => (
            <div key={f.label} style={{ backgroundColor: "#F8FAFC", borderRadius: "8px", padding: "14px", border: "1px solid #E2E8F0" }}>
              <div style={{ color: "#64748B", fontSize: "11px", marginBottom: "5px" }}>{f.label}</div>
              <div style={{ color: f.color ?? "#1E293B", fontSize: "15px", fontWeight: 600, fontFamily: f.mono ? "monospace" : "'Cairo', sans-serif" }}>
                {f.value}
              </div>
            </div>
          ))}
          {/* Merchant — editable in edit mode */}
          <div style={{ backgroundColor: isEditing ? "#EFF6FF" : "#F8FAFC", borderRadius: "8px", padding: isEditing ? "10px 14px" : "14px", border: `1px solid ${isEditing ? "#BFDBFE" : "#E2E8F0"}` }}>
            <div style={{ color: "#64748B", fontSize: "11px", marginBottom: "5px" }}>اسم التاجر</div>
            {isEditing ? (
              <input
                style={{ ...sh.input, backgroundColor: "white", fontWeight: 600 }}
                value={editMerchant}
                onChange={(e) => setEditMerchant(e.target.value)}
              />
            ) : (
              <div style={{ color: "#1E293B", fontSize: "15px", fontWeight: 600 }}>{invoice.merchant}</div>
            )}
          </div>
        </div>
      </div>

      {/* In edit mode: new item form + large insert button */}
      {isEditing && (
        <>
          <div style={{ ...sh.card, backgroundColor: "#FAFBFF", border: "1px solid #DBEAFE" }}>
            <div style={{ color: "#1D4ED8", fontSize: "13px", fontWeight: 600, marginBottom: "14px" }}>
              إضافة بند جديد
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ flex: 2 }}>
                <div style={{ color: "#374151", fontSize: "12px", fontWeight: 600, marginBottom: "5px" }}>اسم المنتج</div>
                <input style={sh.input} placeholder="اسم المنتج" value={newProduct} onChange={(e) => setNewProduct(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#374151", fontSize: "12px", fontWeight: 600, marginBottom: "5px" }}>الوزن (كغ)</div>
                <input type="number" style={sh.input} placeholder="0.0" value={newWeight} onChange={(e) => setNewWeight(e.target.value)} min="0" step="0.1" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#374151", fontSize: "12px", fontWeight: 600, marginBottom: "5px" }}>السعر (ريال/كغ)</div>
                <input type="number" style={sh.input} placeholder="0.00" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} min="0" step="0.01" />
              </div>
            </div>
          </div>
          <button
            onClick={insertItem}
            style={{
              width: "100%", height: "56px",
              backgroundColor: newProduct && newWeight ? "#2563EB" : "#93C5FD",
              color: "white", border: "none", borderRadius: "10px",
              fontSize: "16px", fontWeight: 700,
              cursor: newProduct && newWeight ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
              fontFamily: "'Cairo', sans-serif", marginBottom: "16px",
              boxShadow: newProduct && newWeight ? "0 4px 14px rgba(37,99,235,0.3)" : "none",
            }}
          >
            <Plus size={20} strokeWidth={2.5} />
            إدراج
          </button>
        </>
      )}

      {/* Items Table */}
      <div style={{ backgroundColor: "white", borderRadius: "12px", border: "1px solid #E2E8F0", overflow: "hidden", marginBottom: "20px" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0", color: "#1E293B", fontSize: "15px", fontWeight: 600 }}>
          بنود الفاتورة
          {isEditing && (
            <span style={{ color: "#2563EB", fontSize: "12px", fontWeight: 400, marginRight: "8px" }}>
              — وضع التعديل
            </span>
          )}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["#", "اسم المنتج", "الوزن (كغ)", "الوزن الصافي (كغ)", "السعر", "الإجمالي", ...(isEditing ? [""] : [])].map((h) => (
                <th key={h} style={sh.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {editItems.map((item, i) => (
              <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "white" : "#FAFBFC" }}>
                <td style={{ ...sh.td, color: "#94A3B8", width: "50px" }}>{i + 1}</td>
                <td style={sh.td}>
                  {isEditing ? (
                    <input style={{ ...sh.input, fontWeight: 500 }} value={item.product} onChange={(e) => updateItem(i, "product", e.target.value)} />
                  ) : (
                    <span style={{ fontWeight: 500 }}>{item.product}</span>
                  )}
                </td>
                <td style={sh.td}>
                  {isEditing ? (
                    <input type="number" style={{ ...sh.input, width: "90px" }} value={item.weight} onChange={(e) => updateItem(i, "weight", e.target.value)} step="0.1" />
                  ) : item.weight.toFixed(1)}
                </td>
                <td style={{ ...sh.td, color: "#0F766E", fontWeight: 600 }}>
                  {isEditing ? (
                    <input type="number" style={{ ...sh.input, width: "90px" }} value={item.netWeight} onChange={(e) => updateItem(i, "netWeight", e.target.value)} step="0.1" />
                  ) : item.netWeight.toFixed(1)}
                </td>
                <td style={{ ...sh.td, color: "#64748B" }}>
                  {isEditing ? (
                    <input type="number" style={{ ...sh.input, width: "100px" }} value={item.price} onChange={(e) => updateItem(i, "price", e.target.value)} step="0.01" />
                  ) : `${item.price.toFixed(2)} ريال`}
                </td>
                <td style={{ ...sh.td, color: "#2563EB", fontWeight: 700 }}>
                  {(item.netWeight * item.price).toLocaleString("ar-SA", { minimumFractionDigits: 2 })} ريال
                </td>
                {isEditing && (
                  <td style={sh.td}>
                    <button
                      onClick={() => deleteItem(i)}
                      style={{
                        border: "none", borderRadius: "6px", padding: "5px 10px",
                        cursor: "pointer", backgroundColor: "#FEF2F2", color: "#EF4444",
                        display: "inline-flex", alignItems: "center", gap: "4px",
                        fontSize: "12px", fontFamily: "'Cairo', sans-serif",
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                )}
              </tr>
            ))}

            {/* Total row */}
            <tr style={{ backgroundColor: "#EFF6FF", borderTop: "2px solid #BFDBFE" }}>
              <td style={{ ...sh.td, fontWeight: 700, color: "#1E40AF" }} colSpan={isEditing ? 6 : 5}>
                الإجمالي الكلي
              </td>
              <td style={{ ...sh.td, fontWeight: 800, color: "#1E40AF", fontSize: "15px" }}>
                {grandTotal.toLocaleString("ar-SA", { minimumFractionDigits: 2 })} ريال
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Boxes Section */}
      <div style={sh.card}>
        <div style={{ color: "#64748B", fontSize: "13px", fontWeight: 600, marginBottom: "14px" }}>
          الصناديق المستخدمة
          {isEditing && (
            <span style={{ color: "#2563EB", fontSize: "11px", marginRight: "8px" }}>— قابلة للتعديل</span>
          )}
        </div>
        {isEditing ? (
          <div
            style={{
              maxHeight: "200px", overflowY: "auto",
              border: "1px solid #E2E8F0", borderRadius: "8px", backgroundColor: "#F8FAFC",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...sh.th, fontSize: "12px" }}>اسم الصندوق</th>
                  <th style={{ ...sh.th, fontSize: "12px" }}>الوزن الإجمالي (كغ)</th>
                </tr>
              </thead>
              <tbody>
                {editBoxes.map((b, i) => (
                  <tr key={i}>
                    <td style={{ ...sh.td, fontWeight: 600 }}>{b.name}</td>
                    <td style={sh.td}>
                      <input
                        type="number"
                        value={b.gross}
                        onChange={(e) => updateBox(i, e.target.value)}
                        step="0.1"
                        style={{
                          padding: "5px 8px", borderRadius: "6px", border: "1px solid #CBD5E1",
                          backgroundColor: "white", fontSize: "13px", width: "80px",
                          textAlign: "center", fontFamily: "'Cairo', sans-serif", outline: "none",
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {invoice.boxes.map((b, i) => (
              <div
                key={i}
                style={{
                  backgroundColor: "#F0F9FF", border: "1px solid #BAE6FD",
                  borderRadius: "8px", padding: "10px 18px",
                  fontSize: "13px", fontWeight: 600, color: "#0369A1",
                  display: "flex", alignItems: "center", gap: "8px",
                }}
              >
                <span>{b.name}</span>
                {b.gross > 0 && <span style={{ color: "#0EA5E9", fontWeight: 400 }}>{b.gross} كغ</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit-mode save/cancel at bottom */}
      {isEditing && (
        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginTop: "8px" }}>
          <button
            onClick={cancelEdit}
            style={{
              backgroundColor: "white", color: "#374151", border: "1px solid #E2E8F0",
              borderRadius: "8px", padding: "12px 28px", fontSize: "14px", fontWeight: 600,
              cursor: "pointer", fontFamily: "'Cairo', sans-serif",
            }}
          >
            إلغاء
          </button>
          <button
            onClick={saveEdit}
            style={{
              backgroundColor: "#10B981", color: "white", border: "none",
              borderRadius: "8px", padding: "12px 28px", fontSize: "14px", fontWeight: 600,
              cursor: "pointer", fontFamily: "'Cairo', sans-serif",
              display: "flex", alignItems: "center", gap: "8px",
            }}
          >
            حفظ التعديلات
          </button>
        </div>
      )}

      {showConfirmLeave && (
        <ConfirmDialog onConfirm={confirmLeave} onCancel={() => setShowConfirmLeave(false)} />
      )}
    </div>
  );
}

// ─── List View ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 5;

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>(INITIAL_INVOICES);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [detailInvoice, setDetailInvoice] = useState<Invoice | null>(null);

  const handleSaveInvoice = (updated: Invoice) => {
    setInvoices((prev) => prev.map((inv) => (inv.id === updated.id ? updated : inv)));
    setDetailInvoice(updated);
  };

  if (detailInvoice) {
    const live = invoices.find((inv) => inv.id === detailInvoice.id) ?? detailInvoice;
    return (
      <DetailView
        invoice={live}
        onBack={() => setDetailInvoice(null)}
        onSave={handleSaveInvoice}
      />
    );
  }

  const filtered = invoices.filter((inv) => {
    const matchSearch = inv.invoiceNum.includes(search) || inv.merchant.includes(search);
    const matchFrom = !fromDate || inv.date >= fromDate;
    const matchTo = !toDate || inv.date <= toDate;
    return matchSearch && matchFrom && matchTo;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const listTh = {
    backgroundColor: "#F8FAFC", color: "#64748B",
    padding: "12px 16px", textAlign: "right" as const,
    fontSize: "13px", fontWeight: 600, borderBottom: "1px solid #E2E8F0",
  };
  const listTd = {
    padding: "14px 16px", borderBottom: "1px solid #F1F5F9",
    color: "#1E293B", fontSize: "14px",
  };
  const aBtn = {
    border: "none", borderRadius: "6px", padding: "6px 10px",
    cursor: "pointer", display: "inline-flex", alignItems: "center",
    gap: "4px", fontSize: "12px", fontFamily: "'Cairo', sans-serif",
    fontWeight: 500, marginLeft: "4px",
  };

  return (
    <div style={{ padding: "32px", direction: "rtl" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ color: "#1E293B", fontSize: "24px", fontWeight: 700, margin: 0 }}>إدارة الفواتير</h1>
        <p style={{ color: "#64748B", fontSize: "14px", marginTop: "4px" }}>عرض وتصفية جميع الفواتير الصادرة</p>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          backgroundColor: "white", borderRadius: "10px", border: "1px solid #E2E8F0",
          padding: "16px 20px", marginBottom: "20px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap",
        }}
      >
        <div style={{ position: "relative", flex: "2", minWidth: "200px" }}>
          <Search size={16} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
          <input
            style={{
              width: "100%", padding: "10px 40px 10px 14px", borderRadius: "8px",
              border: "1px solid #E2E8F0", backgroundColor: "#F8FAFC",
              color: "#1E293B", fontSize: "14px", outline: "none",
              fontFamily: "'Cairo', sans-serif", boxSizing: "border-box",
            }}
            placeholder="بحث في الفواتير..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#64748B", fontSize: "13px", whiteSpace: "nowrap" }}>من تاريخ</span>
          <input type="date" style={{ padding: "10px 14px", borderRadius: "8px", border: "1px solid #E2E8F0", backgroundColor: "#F8FAFC", color: "#1E293B", fontSize: "14px", outline: "none" }} value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#64748B", fontSize: "13px", whiteSpace: "nowrap" }}>إلى تاريخ</span>
          <input type="date" style={{ padding: "10px 14px", borderRadius: "8px", border: "1px solid #E2E8F0", backgroundColor: "#F8FAFC", color: "#1E293B", fontSize: "14px", outline: "none" }} value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} />
        </div>
        {(search || fromDate || toDate) && (
          <button onClick={() => { setSearch(""); setFromDate(""); setToDate(""); setPage(1); }} style={{ border: "1px solid #E2E8F0", borderRadius: "8px", padding: "10px 16px", backgroundColor: "white", color: "#64748B", fontSize: "13px", cursor: "pointer", fontFamily: "'Cairo', sans-serif", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "6px" }}>
            <X size={14} />
            إعادة تعيين
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ backgroundColor: "white", borderRadius: "12px", border: "1px solid #E2E8F0", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["#", "رقم الفاتورة", "اسم التاجر", "التاريخ", "الإجراءات"].map((h) => (
                <th key={h} style={listTh}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.map((inv, i) => (
              <tr key={inv.id} style={{ backgroundColor: i % 2 === 0 ? "white" : "#FAFBFC" }}>
                <td style={{ ...listTd, color: "#94A3B8", width: "50px" }}>{(page - 1) * ITEMS_PER_PAGE + i + 1}</td>
                <td style={{ ...listTd, fontFamily: "monospace", fontWeight: 600, color: "#2563EB" }}>{inv.invoiceNum}</td>
                <td style={{ ...listTd, fontWeight: 500 }}>{inv.merchant}</td>
                <td style={{ ...listTd, color: "#64748B" }}>{formatDate(inv.date)}</td>
                <td style={listTd}>
                  <button style={{ ...aBtn, backgroundColor: "#F0FDF4", color: "#16A34A" }} onClick={() => setDetailInvoice(inv)}>
                    <Eye size={13} />عرض
                  </button>
                  <button style={{ ...aBtn, backgroundColor: "#EFF6FF", color: "#2563EB" }} onClick={() => setDetailInvoice(inv)}>
                    <Pencil size={13} />تعديل
                  </button>
                  <button style={{ ...aBtn, backgroundColor: "#FEF2F2", color: "#EF4444" }} onClick={() => setInvoices((prev) => prev.filter((x) => x.id !== inv.id))}>
                    <Trash2 size={13} />حذف
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {paginated.length === 0 && (
          <div style={{ padding: "40px", textAlign: "center", color: "#94A3B8", fontSize: "14px" }}>
            لا توجد فواتير مطابقة للبحث
          </div>
        )}

        {/* Pagination */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderTop: "1px solid #E2E8F0" }}>
          <span style={{ color: "#64748B", fontSize: "13px" }}>عرض {paginated.length} من {filtered.length} فاتورة</span>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              style={{ border: "1px solid #E2E8F0", borderRadius: "6px", padding: "6px 12px", cursor: page === 1 ? "not-allowed" : "pointer", backgroundColor: "white", color: "#374151", fontSize: "13px", display: "flex", alignItems: "center", gap: "4px", fontFamily: "'Cairo', sans-serif", opacity: page === 1 ? 0.5 : 1 }}>
              <ChevronRight size={14} />السابق
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button key={p} onClick={() => setPage(p)}
                style={{ border: `1px solid ${p === page ? "#2563EB" : "#E2E8F0"}`, borderRadius: "6px", padding: "6px 12px", cursor: "pointer", backgroundColor: p === page ? "#2563EB" : "white", color: p === page ? "white" : "#374151", fontSize: "13px", fontFamily: "'Cairo', sans-serif", minWidth: "36px", justifyContent: "center", display: "flex" }}>
                {p}
              </button>
            ))}
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              style={{ border: "1px solid #E2E8F0", borderRadius: "6px", padding: "6px 12px", cursor: page === totalPages ? "not-allowed" : "pointer", backgroundColor: "white", color: "#374151", fontSize: "13px", display: "flex", alignItems: "center", gap: "4px", fontFamily: "'Cairo', sans-serif", opacity: page === totalPages ? 0.5 : 1 }}>
              التالي<ChevronLeft size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
