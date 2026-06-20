import { Trash2, Plus, Save, Printer } from "lucide-react";
import type { Draft } from "./invoice";

// ─── Styles ───────────────────────────────────────────────────────────────────


const c = {
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
  label: { color: "#374151", fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "6px" },
  card: {
    backgroundColor: "white",
    borderRadius: "12px",
    border: "1px solid #E2E8F0",
    padding: "20px 24px",
    marginBottom: "16px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
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
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface InvoiceFormProps {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onSave: (andPrint: boolean) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InvoiceForm({ draft, onChange, onSave }: InvoiceFormProps) {
  // ── Box inputs ──────────────────────────────────────────────────────────────

  const updateBox = (boxId: number, val: string) =>
    onChange({
      boxes: draft.boxes.map((b) =>
        b.id === boxId ? { ...b, grossInput: parseFloat(val) || 0 } : b
      ),
    });

  const totalNetWeight = draft.boxes.reduce(
    (sum, b) => sum + Math.max(0, b.grossInput - b.emptyWeight),
    0
  );

  // ── Row insert ──────────────────────────────────────────────────────────────

  const handleInsert = () => {
    if (!draft.productInput || !draft.weightInput) return;
    const row = {
      id: Date.now(),
      product: draft.productInput,
      weight: parseFloat(draft.weightInput) || 0,
      price: parseFloat(draft.priceInput) || 0,
    };
    onChange({
      rows: [...draft.rows, row],
      productInput: "",
      weightInput: "",
      priceInput: "",
    });
  };

  const deleteRow = (rowId: number) =>
    onChange({ rows: draft.rows.filter((r) => r.id !== rowId) });

  const grandTotal = draft.rows.reduce((sum, r) => sum + r.weight * r.price, 0);

  const canInsert = Boolean(draft.productInput && draft.weightInput);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: "28px 32px" }}>

      {/* ── INVOICE FORM CARD ── */}
      <div style={c.card}>
        <div style={{ color: "#1E293B", fontSize: "16px", fontWeight: 600, marginBottom: "18px" }}>
          إنشاء فاتورة جديدة
        </div>

        {/* Row 1: Merchant Name */}
        <div style={{ marginBottom: "18px" }}>
          <label style={c.label}>اسم التاجر</label>
          <input
            style={c.input}
            placeholder="أدخل اسم التاجر"
            value={draft.merchantName}
            onChange={(e) => onChange({ merchantName: e.target.value })}
          />
        </div>

        {/* Row 2: Two-column layout (boxes RIGHT | products LEFT in RTL) */}
        <div style={{ display: "flex", gap: "20px", marginBottom: "0" }}>

          {/* RIGHT column (RTL first = right): Boxes */}
          <div
            style={{
              width: "270px",
              flexShrink: 0,
              backgroundColor: "#F8FAFC",
              borderRadius: "10px",
              border: "1px solid #E2E8F0",
              padding: "14px",
            }}
          >
            <div style={{ color: "#374151", fontSize: "13px", fontWeight: 600, marginBottom: "10px" }}>
              الصناديق
            </div>

            {/* Scrollable box list */}
            <div
              style={{
                maxHeight: "220px",
                overflowY: "auto",
                borderRadius: "8px",
                border: "1px solid #E2E8F0",
                backgroundColor: "white",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...c.th, padding: "8px 12px", fontSize: "12px", position: "sticky", top: 0 }}>
                      الصندوق
                    </th>
                    <th style={{ ...c.th, padding: "8px 12px", fontSize: "12px", position: "sticky", top: 0 }}>
                      الوزن (كغ)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {draft.boxes.map((box) => (
                    <tr key={box.id}>
                      <td style={{ ...c.td, padding: "8px 12px", fontSize: "13px", fontWeight: 500 }}>
                        {box.name}
                      </td>
                      <td style={{ ...c.td, padding: "6px 12px" }}>
                        <input
                          type="number"
                          value={box.grossInput || ""}
                          placeholder="0"
                          onChange={(e) => updateBox(box.id, e.target.value)}
                          min="0"
                          step="0.1"
                          style={{
                            padding: "5px 8px",
                            borderRadius: "6px",
                            border: "1px solid #CBD5E1",
                            backgroundColor: "#F8FAFC",
                            fontSize: "13px",
                            width: "75px",
                            textAlign: "center",
                            fontFamily: "'Cairo', sans-serif",
                            outline: "none",
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {draft.boxes.length === 0 && (
                <div style={{ padding: "16px", textAlign: "center", color: "#94A3B8", fontSize: "12px" }}>
                  لا توجد صناديق نشطة
                </div>
              )}
            </div>

            {/* Net weight total */}
            <div
              style={{
                marginTop: "10px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                backgroundColor: "#EFF6FF",
                borderRadius: "8px",
                border: "1px solid #DBEAFE",
              }}
            >
              <span style={{ color: "#3B82F6", fontSize: "12px", fontWeight: 600 }}>الوزن الصافي الإجمالي</span>
              <span style={{ color: "#1D4ED8", fontSize: "14px", fontWeight: 700 }}>
                {totalNetWeight.toFixed(2)} كغ
              </span>
            </div>
          </div>

          {/* LEFT column (RTL second = left): Product fields */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label style={c.label}>اسم المنتج</label>
              <input
                style={c.input}
                placeholder="أدخل اسم المنتج"
                value={draft.productInput}
                onChange={(e) => onChange({ productInput: e.target.value })}
              />
            </div>
            <div>
              <label style={c.label}>الوزن (كغ)</label>
              <input
                type="number"
                style={c.input}
                placeholder="0.0"
                value={draft.weightInput}
                onChange={(e) => onChange({ weightInput: e.target.value })}
                min="0"
                step="0.1"
              />
            </div>
            <div>
              <label style={c.label}>سعر المنتج (ريال/كغ)</label>
              <input
                type="number"
                style={c.input}
                placeholder="0.00"
                value={draft.priceInput}
                onChange={(e) => onChange({ priceInput: e.target.value })}
                min="0"
                step="0.01"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── LARGE INSERT BUTTON ── */}
      <button
        onClick={handleInsert}
        style={{
          width: "100%",
          height: "58px",
          backgroundColor: canInsert ? "#2563EB" : "#93C5FD",
          color: "white",
          border: "none",
          borderRadius: "10px",
          fontSize: "17px",
          fontWeight: 700,
          cursor: canInsert ? "pointer" : "not-allowed",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          fontFamily: "'Cairo', sans-serif",
          marginBottom: "16px",
          boxShadow: canInsert ? "0 4px 14px rgba(37,99,235,0.35)" : "none",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          if (canInsert) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1D4ED8";
        }}
        onMouseLeave={(e) => {
          if (canInsert) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#2563EB";
        }}
      >
        <Plus size={22} strokeWidth={2.5} />
        إدراج
      </button>

      {/* ── INVOICE TABLE ── */}
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          border: "1px solid #E2E8F0",
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          marginBottom: "20px",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #E2E8F0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ color: "#1E293B", fontSize: "15px", fontWeight: 600 }}>
            بنود الفاتورة
            {draft.merchantName && (
              <span style={{ color: "#2563EB", marginRight: "8px", fontSize: "14px", fontWeight: 500 }}>
                — {draft.merchantName}
              </span>
            )}
          </span>
          <span style={{ color: "#94A3B8", fontSize: "13px" }}>{draft.rows.length} بند</span>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["#", "اسم المنتج", "الوزن (كغ)", "سعر المنتج", "الإجمالي", "الإجراءات"].map((h) => (
                <th key={h} style={c.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, i) => (
              <tr key={row.id} style={{ backgroundColor: i % 2 === 0 ? "white" : "#FAFBFC" }}>
                <td style={{ ...c.td, color: "#94A3B8", width: "50px" }}>{i + 1}</td>
                <td style={{ ...c.td, fontWeight: 500 }}>{row.product}</td>
                <td style={c.td}>{row.weight.toFixed(1)}</td>
                <td style={{ ...c.td, color: "#0F766E", fontWeight: 600 }}>
                  {row.price.toFixed(2)} ريال
                </td>
                <td style={{ ...c.td, color: "#2563EB", fontWeight: 700 }}>
                  {(row.weight * row.price).toLocaleString("ar-SA", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} ريال
                </td>
                <td style={c.td}>
                  <button
                    onClick={() => deleteRow(row.id)}
                    style={{
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
                      backgroundColor: "#FEF2F2",
                      color: "#EF4444",
                    }}
                  >
                    <Trash2 size={13} />
                    حذف
                  </button>
                </td>
              </tr>
            ))}

            {/* Grand Total Row */}
            {draft.rows.length > 0 && (
              <tr style={{ backgroundColor: "#EFF6FF", borderTop: "2px solid #BFDBFE" }}>
                <td style={{ ...c.td, fontWeight: 700, color: "#1E40AF" }} colSpan={4}>
                  الإجمالي الكلي
                </td>
                <td style={{ ...c.td, fontWeight: 800, color: "#1E40AF", fontSize: "15px" }} colSpan={2}>
                  {grandTotal.toLocaleString("ar-SA", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} ريال
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {draft.rows.length === 0 && (
          <div style={{ padding: "40px", textAlign: "center", color: "#94A3B8", fontSize: "14px" }}>
            لا توجد بنود — أضف منتجاً باستخدام النموذج أعلاه
          </div>
        )}
      </div>

      {/* ── SAVE BUTTONS ── */}
      <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
        <button
          onClick={() => onSave(true)}
          style={{
            backgroundColor: "white",
            color: "#374151",
            border: "1px solid #CBD5E1",
            borderRadius: "8px",
            padding: "12px 28px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontFamily: "'Cairo', sans-serif",
          }}
        >
          <Printer size={16} />
          حفظ وطباعة
        </button>
        <button
          onClick={() => onSave(false)}
          style={{
            backgroundColor: "#2563EB",
            color: "white",
            border: "none",
            borderRadius: "8px",
            padding: "12px 28px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontFamily: "'Cairo', sans-serif",
          }}
        >
          <Save size={16} />
          حفظ
        </button>
      </div>
    </div>
  );
}
