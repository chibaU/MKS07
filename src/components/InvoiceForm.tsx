import { useState, useRef, useEffect, useMemo, memo } from "react";
import { Trash2, Plus, Save, Printer } from "lucide-react";
import type { Draft, DraftRow } from "./invoice";
import { type Merchant, type Product } from "../services/db";

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
  label: {
    color: "#374151",
    fontSize: "13px",
    fontWeight: 600,
    display: "block",
    marginBottom: "6px",
  },
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

// ─── Autocomplete Component ───────────────────────────────────────────────────

interface AutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  onSelect: (val: string, id?: number) => void;
  suggestions: { id: number; label: string }[];
  placeholder?: string;
  style?: React.CSSProperties;
}

const VISIBLE_LIMIT = 10; // Maximum number of suggestions to show

function AutocompleteInner({
  value,
  onChange,
  onSelect,
  suggestions,
  placeholder,
  style,
}: AutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHighlighted(-1);
  }, [suggestions]);

  const filtered = useMemo(() => {
    if (!value.trim()) return suggestions.slice(0, VISIBLE_LIMIT);
    const q = value.toLowerCase();
    const results: typeof suggestions = [];
    for (const s of suggestions) {
      if (s.label.toLowerCase().includes(q)) {
        results.push(s);
        if (results.length >= VISIBLE_LIMIT) break;
      }
    }
    return results;
  }, [value, suggestions]);

  const handleBlur = (e: React.FocusEvent) => {
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && !wrapRef.current?.contains(relatedTarget)) {
      setOpen(false);
    } else if (!relatedTarget) {
      setTimeout(() => {
        setOpen(false);
      }, 150);
    }
  };

  useEffect(() => {
    if (highlighted >= 0 && highlighted < filtered.length && listRef.current) {
      const activeEl = listRef.current.children[highlighted] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [filtered.length, highlighted]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && highlighted >= 0) {
      e.preventDefault();
      const item = filtered[highlighted];
      if (!item) return;
      onSelect(item.label, item.id);
      setOpen(false);
      setHighlighted(-1);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div
      ref={wrapRef}
      onBlur={handleBlur}
      style={{ position: "relative", width: "100%" }}
    >
      <input
        style={{ ...c.input, ...style }}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlighted(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            left: 0,
            zIndex: 500,
            backgroundColor: "white",
            border: "1px solid #E2E8F0",
            borderRadius: "8px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          {filtered.map((item, idx) => (
            <div
              key={item.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item.label, item.id);
                setOpen(false);
                setHighlighted(-1);
              }}
              onMouseEnter={() => setHighlighted(idx)}
              style={{
                padding: "10px 14px",
                cursor: "pointer",
                fontSize: "14px",
                color: "#1E293B",
                fontFamily: "'Cairo', sans-serif",
                backgroundColor: idx === highlighted ? "#EFF6FF" : "white",
                borderBottom:
                  idx < filtered.length - 1 ? "1px solid #F1F5F9" : "none",
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component Props ─────────────────────────────────────────────────────

interface InvoiceFormProps {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onSave: (andPrint?: boolean) => void;
  merchants: Merchant[];
  products: Product[];
}

const Autocomplete = memo(AutocompleteInner);

export function InvoiceForm({
  draft,
  onChange,
  onSave,
  merchants,
  products,
}: InvoiceFormProps) {
  const [isSaving] = useState(false);

  // ── Merchant / Product suggestion lists ─────────────────────────────────────

  const merchantSuggestions = useMemo(() => {
    return merchants?.map((m) => ({ id: m.id, label: m.name })) || [];
  }, [merchants]);

  const productSuggestions = useMemo(() => {
    return products?.map((p) => ({ id: p.id, label: p.name })) || [];
  }, [products]);

  // ── Box inputs ──────────────────────────────────────────────────────────────

  const updateBox = (boxId: number, val: string) =>
    onChange({
      boxes: draft.boxes.map((b) =>
        b.id === boxId ? { ...b, grossInput: parseFloat(val) || 0 } : b,
      ),
    });

  const totalNetWeight = draft.boxes.reduce(
    (sum, b) => sum + Math.max(0, b.grossInput - b.emptyWeight),
    0,
  );

  // ── Row insert ──────────────────────────────────────────────────────────────

  const handleInsert = () => {
    if (!draft.productInput.trim() || !draft.weightInput) return;

    const row: DraftRow = {
      id: Date.now() + Math.random(),
      product: draft.productInput,
      productId: draft.productId ?? null,
      weight: parseFloat(draft.weightInput) || 0,
      price: parseFloat(draft.priceInput) || 0,
      boxesSnapshot: draft.boxes
        .filter((b) => b.grossInput > 0)
        .map((b) => ({
          id: b.id,
          boxCount: b.grossInput,
        })),
    };

    onChange({
      rows: [...draft.rows, row],
      productInput: "",
      productId: undefined,
      weightInput: "",
      priceInput: "",
      boxes: draft.boxes.map((b) => ({ ...b, grossInput: 0 })),
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
        <div
          style={{
            color: "#1E293B",
            fontSize: "16px",
            fontWeight: 600,
            marginBottom: "18px",
          }}
        >
          إنشاء فاتورة جديدة
        </div>

        {/* Row 1: Merchant Name with Autocomplete */}
        <div style={{ marginBottom: "18px" }}>
          <label style={c.label}>اسم التاجر</label>
          <Autocomplete
            value={draft.merchantName}
            onChange={(val) =>
              onChange({ merchantName: val, merchantId: undefined })
            }
            onSelect={(label, id) =>
              onChange({ merchantName: label, merchantId: id })
            }
            suggestions={merchantSuggestions}
            placeholder="أدخل اسم التاجر أو ابحث عن موجود..."
          />
          {draft.merchantId && (
            <div
              style={{
                marginTop: "5px",
                fontSize: "12px",
                color: "#10B981",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              ✓ تاجر محفوظ — سيتم ربط الفاتورة بحسابه
            </div>
          )}
        </div>

        {/* Row 2: Two-column layout */}
        <div style={{ display: "flex", gap: "20px" }}>
          {/* RIGHT column: Boxes */}
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
            <div
              style={{
                color: "#374151",
                fontSize: "13px",
                fontWeight: 600,
                marginBottom: "10px",
              }}
            >
              الصناديق النشطة
            </div>

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
                    <th
                      style={{
                        ...c.th,
                        padding: "8px 12px",
                        fontSize: "12px",
                        position: "sticky",
                        top: 0,
                      }}
                    >
                      الصندوق
                    </th>
                    <th
                      style={{
                        ...c.th,
                        padding: "8px 12px",
                        fontSize: "12px",
                        position: "sticky",
                        top: 0,
                      }}
                    >
                      الوزن (كغ)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {draft.boxes.map((box) => (
                    <tr key={box.id}>
                      <td
                        style={{
                          ...c.td,
                          padding: "8px 12px",
                          fontSize: "13px",
                          fontWeight: 500,
                        }}
                      >
                        {box.name}
                        <div
                          style={{
                            fontSize: "11px",
                            color: "#94A3B8",
                            fontWeight: 400,
                          }}
                        >
                          فارغ: {box.emptyWeight} كغ
                        </div>
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
                <div
                  style={{
                    padding: "16px",
                    textAlign: "center",
                    color: "#94A3B8",
                    fontSize: "12px",
                  }}
                >
                  لا توجد صناديق نشطة — أضف صناديق من صفحة الصناديق
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
              <span
                style={{ color: "#3B82F6", fontSize: "12px", fontWeight: 600 }}
              >
                الوزن الصافي
              </span>
              <span
                style={{
                  color: "#1D4ED8",
                  fontSize: "14px",
                  fontWeight: 700,
                }}
              >
                {totalNetWeight.toFixed(2)} كغ
              </span>
            </div>
          </div>

          {/* LEFT column: Product fields with Autocomplete */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            <div>
              <label style={c.label}>اسم المنتج</label>
              <Autocomplete
                value={draft.productInput}
                onChange={(val) =>
                  onChange({ productInput: val, productId: null })
                }
                onSelect={(label, id) =>
                  onChange({ productInput: label, productId: id })
                }
                suggestions={productSuggestions}
                placeholder="أدخل اسم المنتج أو ابحث..."
              />
              {draft.productId && (
                <div
                  style={{
                    marginTop: "4px",
                    fontSize: "12px",
                    color: "#10B981",
                  }}
                >
                  ✓ منتج محفوظ
                </div>
              )}
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
              <label style={c.label}>سعر المنتج (دج/كغ)</label>
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
            {totalNetWeight > 0 && (
              <div
                style={{
                  padding: "10px 14px",
                  backgroundColor: "#F0FDF4",
                  border: "1px solid #BBF7D0",
                  borderRadius: "8px",
                  fontSize: "13px",
                  color: "#166534",
                }}
              >
                الوزن الصافي من الصناديق:{" "}
                <strong>{totalNetWeight.toFixed(2)} كغ</strong> — سيُسجَّل مع
                هذا السطر
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── INSERT BUTTON ── */}
      <button
        onClick={handleInsert}
        disabled={!draft.productInput.trim() || !draft.weightInput}
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
      >
        <Plus size={22} strokeWidth={2.5} />
        إدراج السطر
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
              <span
                style={{
                  color: "#2563EB",
                  marginRight: "8px",
                  fontSize: "14px",
                  fontWeight: 500,
                }}
              >
                — {draft.merchantName}
              </span>
            )}
          </span>
          <span style={{ color: "#94A3B8", fontSize: "13px" }}>
            {draft.rows.length} بند
          </span>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {[
                "#",
                "اسم المنتج",
                "الوزن (كغ)",
                "سعر المنتج",
                "صناديق",
                "الإجمالي",
                "الإجراءات",
              ].map((h) => (
                <th key={h} style={c.th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, i) => (
              <tr
                key={row.id}
                style={{ backgroundColor: i % 2 === 0 ? "white" : "#FAFBFC" }}
              >
                <td style={{ ...c.td, color: "#94A3B8", width: "50px" }}>
                  {i + 1}
                </td>
                <td style={{ ...c.td, fontWeight: 500 }}>{row.product}</td>
                <td style={c.td}>{row.weight.toFixed(1)}</td>
                <td style={{ ...c.td, color: "#0F766E", fontWeight: 600 }}>
                  {row.price.toFixed(2)} دج
                </td>
                <td style={{ ...c.td, fontSize: "12px", color: "#64748B" }}>
                  {row.boxesSnapshot && row.boxesSnapshot.length > 0 ? (
                    <div
                      style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}
                    >
                      {row.boxesSnapshot.map((bs, idx) => {
                        const boxDef = draft.boxes.find((b) => b.id === bs.id);
                        return (
                          <span
                            key={idx}
                            style={{
                              backgroundColor: "#F1F5F9",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              fontSize: "11px",
                            }}
                          >
                            {boxDef?.name ?? `#${bs.id}`} ×{bs.boxCount}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <span style={{ color: "#CBD5E1" }}>—</span>
                  )}
                </td>
                <td style={{ ...c.td, color: "#2563EB", fontWeight: 700 }}>
                  {(row.weight * row.price).toLocaleString("ar-DZ", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  دج
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
              <tr
                style={{
                  backgroundColor: "#EFF6FF",
                  borderTop: "2px solid #BFDBFE",
                }}
              >
                <td
                  style={{ ...c.td, fontWeight: 700, color: "#1E40AF" }}
                  colSpan={5}
                >
                  الإجمالي الكلي
                </td>
                <td
                  style={{
                    ...c.td,
                    fontWeight: 800,
                    color: "#1E40AF",
                    fontSize: "15px",
                  }}
                  colSpan={2}
                >
                  {grandTotal.toLocaleString("ar-DZ", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  دج
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {draft.rows.length === 0 && (
          <div
            style={{
              padding: "40px",
              textAlign: "center",
              color: "#94A3B8",
              fontSize: "14px",
            }}
          >
            لا توجد بنود — أضف منتجاً باستخدام النموذج أعلاه
          </div>
        )}
      </div>

      {/* ── SAVE BUTTONS ── */}
      <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
        <button
          onClick={() => onSave(true)}
          disabled={draft.rows.length === 0}
          style={{
            backgroundColor: "white",
            color: draft.rows.length === 0 ? "#94A3B8" : "#374151",
            border: "1px solid #CBD5E1",
            borderRadius: "8px",
            padding: "12px 28px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: draft.rows.length === 0 ? "not-allowed" : "pointer",
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
          disabled={draft.rows.length === 0}
          style={{
            backgroundColor: draft.rows.length === 0 ? "#93C5FD" : "#2563EB",
            color: "white",
            border: "none",
            borderRadius: "8px",
            padding: "12px 28px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: draft.rows.length === 0 ? "not-allowed" : "pointer",
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