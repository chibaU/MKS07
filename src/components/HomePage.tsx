import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { SharedBox } from "../App";
import type { Draft } from "./invoice";
import { InvoiceForm } from "./InvoiceForm";

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

      {/* ── PAGE CONTENT: delegated to InvoiceForm ── */}
      <InvoiceForm
        draft={activeDraft}
        onChange={(patch) => patchDraft(activeId, patch)}
        onSave={handleSave}
      />

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
