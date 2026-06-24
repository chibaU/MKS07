import { useRef, useState, useEffect } from "react";
import { Plus, X } from "lucide-react";
import type { SharedBox } from "../App";
import type { Draft } from "./invoice";
import { InvoiceForm } from "./InvoiceForm";
// 1. استيراد الخدمات الخاصة بقاعدة البيانات لجلب وحفظ الفواتير والتجار والمنتجات
import { merchantService, productService, invoiceService, type Merchant, type Product } from "../services/db";

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
  const initialIdRef = useRef<string | null>(null);
  if (!initialIdRef.current) initialIdRef.current = newId();

  const [drafts, setDrafts] = useState<Draft[]>(() => [
    makeDraft(initialIdRef.current!, sharedBoxes),
  ]);
  const [activeId, setActiveId] = useState<string>(initialIdRef.current);
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);
  const [savedTabId, setSavedTabId] = useState<string | null>(null);

  // 2. تعريف حالات (States) لتخزين قائمة التجار والمنتجات القادمة من قاعدة البيانات
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // 3. جلب البيانات الفورية من الداتابيز بمجرد تحميل الصفحة
  useEffect(() => {
    async function loadData() {
      try {
        const allMerchants = await merchantService.getAll();
        const allProducts = await productService.getAll();
        setMerchants(allMerchants);
        setProducts(allProducts);
      } catch (err) {
        console.error("خطأ أثناء جلب بيانات التجار والمنتجات التلقائية:", err);
      }
    }
    loadData();
  }, []);

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

  // ── Save Action ─────────────────────────────────────────────────────────────

  const handleSave = async (andPrint = false) => {
    if (activeDraft.rows.length === 0) return;

    try {
      // أ) حساب المجموع الكلي للفاتورة الحالية
      const totalAmount = activeDraft.rows.reduce((sum, r) => sum + r.weight * r.price, 0);

      // ب) تجهيز البيانات الفوقية للفاتورة
      const invoiceData = {
        merchant_id: activeDraft.merchantId ?? null, // يحفظ كـ null إن كان التاجر مكتوباً يدوياً وغير محفوظ
        invoice_type: "VEG_FRUIT", // نوع الفاتورة الافتراضي، يمكنك تعديله حسب الحاجة
        invoice_date: new Date().toISOString().split("T")[0], // التاريخ الحالي بصيغة YYYY-MM-DD
        total_amount: totalAmount,
      };

      // ج) تحويل السطور والهياكل المتوافقة مع الإدخال الحر للـ تفاصيل
      const details = activeDraft.rows.map((row) => ({
        product_id: row.productId, // رقم المعرف المحفوظ أو null في حال الكتابة اليدوية المباشرة
        product_name: row.product, // نص اسم المنتج المباشر الذي سيسجل ثابتاً في تفاصيل الفاتورة
        quantity: row.weight,
        price: row.price,
        subtotal: row.weight * row.price,
        boxes: row.boxesSnapshot.map((b) => ({
          box_id: b.id,
          box_count: b.boxCount,
        })),
      }));

      // د) استدعاء الخدمة لإرسال البيانات وحفظها في المعاملة البرمجية لقاعدة البيانات
      await invoiceService.createInvoice(invoiceData, details);

      // هـ) إظهار إشعار تم الحفظ بنجاح مؤقتاً
      setSavedTabId(activeId);
      setTimeout(() => setSavedTabId(null), 2000);

      // و) تشغيل الطباعة عند الطلب
      if (andPrint) {
        setTimeout(() => {
          window.print();
        }, 100);
      }

      // ز) تصفير بيانات التبويب الحالي لتهيئته للفاتورة القادمة
      setDrafts((prev) =>
        prev.map((d) => (d.id === activeId ? makeDraft(activeId, sharedBoxes) : d))
      );

    } catch (error) {
      console.error("خطأ حدث أثناء حفظ الفاتورة في قاعدة البيانات:", error);
      alert("تعذر حفظ الفاتورة، يرجى مراجعة سجل الأخطاء.");
    }
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
      <InvoiceForm
        draft={activeDraft}
        onChange={(patch) => patchDraft(activeId, patch)}
        onSave={handleSave}
        merchants={merchants}
        products={products}
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