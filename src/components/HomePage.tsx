/* eslint-disable react-hooks/refs */
import { useRef, useState } from "react";
import { Trash2, Plus, Save, Printer, X } from "lucide-react";
import type { SharedBox } from "../App";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DraftBox {
  id: number;
  name: string;
  emptyWeight: number;
  grossInput: number;
}

interface DraftRow {
  id: number;
  product: string;
  weight: number;
  price: number;
}

interface Draft {
  id: string;
  merchantName: string;
  productInput: string;
  weightInput: string;
  priceInput: string;
  boxes: DraftBox[];
  rows: DraftRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDraft(id: string, sharedBoxes: SharedBox[]): Draft {
  return {
    id,
    merchantName: "",
    productInput: "",
    weightInput: "",
    priceInput: "",
    boxes: sharedBoxes
      .filter((b) => b.visible)
      .map((b) => ({ id: b.id, name: b.name, emptyWeight: b.emptyWeight, grossInput: 0 })),
    rows: [],
  };
}

const isDirty = (d: Draft) => d.merchantName.trim() !== "" || d.rows.length > 0;

const newId = () => `d${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

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
      <div
        style={{
          backgroundColor: "white", borderRadius: "14px", padding: "32px",
          width: "380px", boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ fontSize: "28px", marginBottom: "12px" }}>⚠️</div>
        <div style={{ color: "#1E293B", fontSize: "17px", fontWeight: 700, marginBottom: "8px" }}>
          تغييرات غير محفوظة
        </div>
        <div style={{ color: "#64748B", fontSize: "14px", lineHeight: 1.6, marginBottom: "28px" }}>
          هناك تغييرات غير محفوظة، هل تريد الخروج؟
        </div>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              backgroundColor: "white", color: "#374151", border: "1px solid #E2E8F0",
              borderRadius: "8px", padding: "10px 20px", fontSize: "14px", cursor: "pointer",
              fontFamily: "'Cairo', sans-serif", fontWeight: 500,
            }}
          >
            إلغاء
          </button>
          <button
            onClick={onConfirm}
            style={{
              backgroundColor: "#EF4444", color: "white", border: "none",
              borderRadius: "8px", padding: "10px 20px", fontSize: "14px", cursor: "pointer",
              fontFamily: "'Cairo', sans-serif", fontWeight: 600,
            }}
          >
            خروج بدون حفظ
          </button>
        </div>
      </div>
    </div>
  );
}

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

// ─── Component ────────────────────────────────────────────────────────────────

export function HomePage({ sharedBoxes }: { sharedBoxes: SharedBox[] }) {
  // Stable initial draft ID using useRef (safe in StrictMode)
  const initialIdRef = useRef<string | null>(null);
  if (!initialIdRef.current) initialIdRef.current = newId();

  const [drafts, setDrafts] = useState<Draft[]>(() => [
    makeDraft(initialIdRef.current!, sharedBoxes),
  ]);
  const [activeId, setActiveId] = useState<string>(initialIdRef.current);
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);
  const [savedTabId, setSavedTabId] = useState<string | null>(null);

  const activeDraft = drafts.find((d) => d.id === activeId) ?? drafts[0];

  // ── Draft Mutators ──────────────────────────────────────────────────────────

  const patchDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const patchActive = (patch: Partial<Draft>) => patchDraft(activeId, patch);

  const addDraft = () => {
    const id = newId();
    setDrafts((prev) => [...prev, makeDraft(id, sharedBoxes)]);
    setActiveId(id);
  };

  const requestClose = (id: string) => {
    const draft = drafts.find((d) => d.id === id);
    if (draft && isDirty(draft)) {
      setConfirmCloseId(id);
    } else {
      doClose(id);
    }
  };

  const doClose = (id: string) => {
    setConfirmCloseId(null);
    const remaining = drafts.filter((d) => d.id !== id);
    if (remaining.length === 0) {
      const newDraft = makeDraft(newId(), sharedBoxes);
      setDrafts([newDraft]);
      setActiveId(newDraft.id);
    } else {
      setDrafts(remaining);
      if (activeId === id) setActiveId(remaining[remaining.length - 1].id);
    }
  };

  // ── Box inputs ──────────────────────────────────────────────────────────────

  const updateBox = (boxId: number, val: string) =>
    patchActive({
      boxes: activeDraft.boxes.map((b) =>
        b.id === boxId ? { ...b, grossInput: parseFloat(val) || 0 } : b
      ),
    });

  const totalNetWeight = activeDraft.boxes.reduce(
    (sum, b) => sum + Math.max(0, b.grossInput - b.emptyWeight),
    0
  );

  // ── Row insert ──────────────────────────────────────────────────────────────

  const handleInsert = () => {
    if (!activeDraft.productInput || !activeDraft.weightInput) return;
    const row: DraftRow = {
      id: Date.now(),
      product: activeDraft.productInput,
      weight: parseFloat(activeDraft.weightInput) || 0,
      price: parseFloat(activeDraft.priceInput) || 0,
    };
    patchActive({
      rows: [...activeDraft.rows, row],
      productInput: "",
      weightInput: "",
      priceInput: "",
    });
  };

  const deleteRow = (rowId: number) =>
    patchActive({ rows: activeDraft.rows.filter((r) => r.id !== rowId) });

  const grandTotal = activeDraft.rows.reduce((sum, r) => sum + r.weight * r.price, 0);

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = (andPrint = false) => {
    setSavedTabId(activeId);
    setTimeout(() => setSavedTabId(null), 2000);
    if (andPrint) window.print();
    // After 1.5s close the tab
    setTimeout(() => doClose(activeId), 1500);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ direction: "rtl", fontFamily: "'Cairo', sans-serif" }}>

      {/* ── TAB BAR ── */}
      <div
        style={{
          backgroundColor: "white",
          borderBottom: "2px solid #E2E8F0",
          display: "flex",
          alignItems: "flex-end",
          padding: "0 24px",
          gap: "4px",
          overflowX: "auto",
          flexWrap: "nowrap",
        }}
      >
        {drafts.map((draft) => {
          const isActive = draft.id === activeId;
          const label = draft.merchantName.trim() || "فاتورة جديدة";
          return (
            <div
              key={draft.id}
              onClick={() => setActiveId(draft.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 16px 11px",
                cursor: "pointer",
                borderBottom: isActive ? "3px solid #2563EB" : "3px solid transparent",
                backgroundColor: isActive ? "white" : "#F1F5F9",
                borderRadius: "8px 8px 0 0",
                color: isActive ? "#1D4ED8" : "#64748B",
                fontWeight: isActive ? 700 : 400,
                fontSize: "14px",
                whiteSpace: "nowrap",
                userSelect: "none",
                transition: "all 0.15s",
                marginBottom: isActive ? "-2px" : "0",
              }}
            >
              <span>{label}</span>
              {savedTabId === draft.id && (
                <span style={{ color: "#10B981", fontSize: "12px", fontWeight: 600 }}>✓ تم الحفظ</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); requestClose(draft.id); }}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: isActive ? "#93C5FD" : "#CBD5E1",
                  display: "flex",
                  alignItems: "center",
                  padding: "2px",
                  borderRadius: "4px",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = isActive ? "#93C5FD" : "#CBD5E1")}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}

        {/* Add Tab */}
        <button
          onClick={addDraft}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "10px 14px",
            border: "1px dashed #CBD5E1",
            borderBottom: "none",
            borderRadius: "8px 8px 0 0",
            backgroundColor: "transparent",
            color: "#64748B",
            fontSize: "13px",
            cursor: "pointer",
            fontFamily: "'Cairo', sans-serif",
            marginBottom: "2px",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#EFF6FF";
            (e.currentTarget as HTMLButtonElement).style.color = "#2563EB";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
            (e.currentTarget as HTMLButtonElement).style.color = "#64748B";
          }}
        >
          <Plus size={14} />
          فاتورة جديدة
        </button>
      </div>

      {/* ── PAGE CONTENT ── */}
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
              value={activeDraft.merchantName}
              onChange={(e) => patchActive({ merchantName: e.target.value })}
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
                    {activeDraft.boxes.map((box) => (
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
                {activeDraft.boxes.length === 0 && (
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
                  value={activeDraft.productInput}
                  onChange={(e) => patchActive({ productInput: e.target.value })}
                />
              </div>
              <div>
                <label style={c.label}>الوزن (كغ)</label>
                <input
                  type="number"
                  style={c.input}
                  placeholder="0.0"
                  value={activeDraft.weightInput}
                  onChange={(e) => patchActive({ weightInput: e.target.value })}
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
                  value={activeDraft.priceInput}
                  onChange={(e) => patchActive({ priceInput: e.target.value })}
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
            backgroundColor: activeDraft.productInput && activeDraft.weightInput ? "#2563EB" : "#93C5FD",
            color: "white",
            border: "none",
            borderRadius: "10px",
            fontSize: "17px",
            fontWeight: 700,
            cursor: activeDraft.productInput && activeDraft.weightInput ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            fontFamily: "'Cairo', sans-serif",
            marginBottom: "16px",
            boxShadow: activeDraft.productInput && activeDraft.weightInput
              ? "0 4px 14px rgba(37,99,235,0.35)"
              : "none",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            if (activeDraft.productInput && activeDraft.weightInput)
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1D4ED8";
          }}
          onMouseLeave={(e) => {
            if (activeDraft.productInput && activeDraft.weightInput)
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#2563EB";
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
              {activeDraft.merchantName && (
                <span style={{ color: "#2563EB", marginRight: "8px", fontSize: "14px", fontWeight: 500 }}>
                  — {activeDraft.merchantName}
                </span>
              )}
            </span>
            <span style={{ color: "#94A3B8", fontSize: "13px" }}>{activeDraft.rows.length} بند</span>
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
              {activeDraft.rows.map((row, i) => (
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
              {activeDraft.rows.length > 0 && (
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

          {activeDraft.rows.length === 0 && (
            <div style={{ padding: "40px", textAlign: "center", color: "#94A3B8", fontSize: "14px" }}>
              لا توجد بنود — أضف منتجاً باستخدام النموذج أعلاه
            </div>
          )}
        </div>

        {/* ── SAVE BUTTONS ── */}
        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          <button
            onClick={() => handleSave(true)}
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
            onClick={() => handleSave(false)}
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

      {/* ── CONFIRM CLOSE DIALOG ── */}
      {confirmCloseId && (
        <ConfirmDialog
          onConfirm={() => doClose(confirmCloseId)}
          onCancel={() => setConfirmCloseId(null)}
        />
      )}
    </div>
  );
}
