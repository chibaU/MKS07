import { useState, useEffect } from "react";
import { Plus, X } from "lucide-react";
import type { Draft } from "./invoice";
import { InvoiceForm } from "./InvoiceForm";
import { makeDraft } from "./InvoiceManager"; // استيراد دالة البناء النظيفة المحدثة من ملف App
import { merchantService, productService, invoiceService, type Merchant, type Product, type Box } from "../services/db";

const isDirty = (d: Draft) => d.merchantName.trim() !== "" || d.rows.length > 0;
const newId = () => `d${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

interface HomePageProps {
  realBoxes: Box[]; // الصناديق الآتية مباشرة من الـ SQLite
  drafts: Draft[];
  setDrafts: React.Dispatch<React.SetStateAction<Draft[]>>;
  activeId: string;
  setActiveId: (id: string) => void;
}

export function HomePage({ realBoxes, drafts, setDrafts, activeId, setActiveId }: HomePageProps) {
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);
  const [savedTabId, setSavedTabId] = useState<string | null>(null);

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // جلب التجار والمنتجات للتلميحات التلقائية
  useEffect(() => {
    async function loadData() {
      try {
        const allMerchants = await merchantService.getAll();
        const allProducts = await productService.getAll();
        setMerchants(allMerchants);
        setProducts(allProducts);
      } catch (err) {
        console.error("خطأ أثناء جلب بيانات التجار والمنتجات:", err);
      }
    }
    loadData();
  }, []);

  const activeDraft = drafts.find((d) => d.id === activeId) ?? drafts[0];

  const patchDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  // كفاءة وسرعة عالية: عند الضغط على زر زائد، ننشئ الفاتورة من ذاكرة الكاش الممررة (realBoxes) دون استدعاء للداتابيز
  const addDraft = () => {
    const id = newId();
    setDrafts((prev) => [...prev, makeDraft(id, realBoxes)]);
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
      const newDraft = makeDraft(newId(), realBoxes);
      setDrafts([newDraft]);
      setActiveId(newDraft.id);
    } else {
      setDrafts(remaining);
      if (activeId === id) setActiveId(remaining[remaining.length - 1].id);
    }
  };

  const handleSave = async (andPrint = false) => {
    if (!activeDraft || activeDraft.rows.length === 0) return;

    try {
      const totalAmount = activeDraft.rows.reduce((sum, r) => sum + r.weight * r.price, 0);

      const invoiceData = {
        merchant_id: activeDraft.merchantId ?? null,
        invoice_type: "VEG_FRUIT",
        invoice_date: new Date().toISOString().split("T")[0],
        total_amount: totalAmount,
      };

      const details = activeDraft.rows.map((row) => ({
        product_id: row.productId,
        product_name: row.product,
        quantity: row.weight,
        price: row.price,
        subtotal: row.weight * row.price,
        boxes: row.boxesSnapshot.map((b) => ({
          box_id: b.id,
          box_count: b.boxCount,
        })),
      }));

      await invoiceService.createInvoice(invoiceData, details);

      setSavedTabId(activeId);
      setTimeout(() => setSavedTabId(null), 2000);

      if (andPrint) {
        setTimeout(() => {
          window.print();
        }, 100);
      }

      // تصفير بيانات التبويب الحالي باستخدام الصناديق الحقيقية المستقرة
      setDrafts((prev) =>
        prev.map((d) => (d.id === activeId ? makeDraft(activeId, realBoxes) : d))
      );

    } catch (error) {
      console.error("خطأ حدث أثناء حفظ الفاتورة:", error);
      alert("تعذر حفظ الفاتورة، يرجى مراجعة سجل الأخطاء.");
    }
  };

  // حماية للتطبيق في حالة تأخر الـ تحميل الأولي للصناديق
  if (!activeDraft) {
    return (
      <div style={{ padding: "40px", textAlign: "center", fontFamily: "'Cairo', sans-serif", color: "#64748B" }}>
        جاري تحميل نظام الصناديق والبيانات...
      </div>
    );
  }

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

      <InvoiceForm
        draft={activeDraft}
        onChange={(patch) => patchDraft(activeId, patch)}
        onSave={handleSave}
        merchants={merchants}
        products={products}
      />

      {confirmCloseId && (
        <ConfirmDialog
          onConfirm={() => doClose(confirmCloseId)}
          onCancel={() => setConfirmCloseId(null)}
        />
      )}
    </div>
  );
}

// ── ConfirmDialog ──
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