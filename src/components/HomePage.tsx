import { useState, useCallback, memo } from "react";
import { Plus, X } from "lucide-react";
import type { Draft, DraftRow } from "./invoice";
import { InvoiceForm } from "./InvoiceForm";
import { makeDraft, draftFromInvoice } from "./InvoiceManager";
import { round2 } from "./InvoiceShared";
import { invoiceService, type Merchant, type Product, type Box } from "../services/db";
import { printInvoice } from "../services/print";

const newId = () => `d${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

interface HomePageProps {
  realBoxes:  Box[];
  drafts:     Draft[];
  setDrafts:  React.Dispatch<React.SetStateAction<Draft[]>>;
  activeId:   string;
  setActiveId:(id: string) => void;
  merchants:  Merchant[];
  products:   Product[];
  // تحديث قائمة الصناديق النشطة في App وإرجاع القائمة المحدَّثة (تُستخدَم في
  // نسخ بند يحتوي صندوقاً مخفياً — InvoiceForm.tsx).
  onRefreshBoxes: () => Promise<Box[] | null>;
}

const MemoInvoiceForm = memo(InvoiceForm);

export function HomePage({
  realBoxes,
  drafts,
  setDrafts,
  activeId,
  setActiveId,
  merchants,
  products,
  onRefreshBoxes,
}: HomePageProps) {
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);

  const activeDraft = drafts.find((d) => d.id === activeId) ?? drafts[0];

  const patchDraft = useCallback((id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d))),
  [setDrafts]);

  const handleChange = useCallback((patch: Partial<Draft>) =>
    patchDraft(activeId, patch),
  [patchDraft, activeId]);

  const addDraft = useCallback(() => {
    const id = newId();
    setDrafts((prev) => [...prev, makeDraft(id, realBoxes)]);
    setActiveId(id);
  }, [realBoxes, setDrafts, setActiveId]);

  // القسم 6: إغلاق فعلي لتبويب — يُنفَّذ setOpenState(invoiceId, false) أولاً
  // إن كانت الفاتورة محفوظة فعلياً (invoiceId !== null)، قبل إزالة التبويب.
  const doClose = useCallback(async (id: string) => {
    setConfirmCloseId(null);

    const target = drafts.find((d) => d.id === id);
    if (target && target.invoiceId !== null) {
      try {
        await invoiceService.setOpenState(target.invoiceId, 0);
      } catch (error) {
        console.error("خطأ أثناء إغلاق الفاتورة:", error);
      }
    }

    setDrafts((prev) => {
      const remaining = prev.filter((d) => d.id !== id);
      if (remaining.length === 0) {
        const newDraft = makeDraft(newId(), realBoxes);
        setActiveId(newDraft.id);
        return [newDraft];
      }
      if (activeId === id) setActiveId(remaining[remaining.length - 1].id);
      return remaining;
    });
  }, [drafts, activeId, realBoxes, setDrafts, setActiveId]);

  // القسم 6: الشرط الجديد لإظهار حوار التأكيد هو invoiceId !== null فقط (بدل
  // isDirty القديمة المبنية على merchantName/rows.length) — البيانات تُحفَظ
  // فوراً أولاً بأول الآن، فلا يوجد شيء "يُفقَد" فعلياً بالإغلاق؛ الحوار يؤكّد
  // إجراءً تجارياً متعمَّداً (إنهاء فاتورة نشطة) لا منع فقدان بيانات.
  const requestClose = useCallback((id: string) => {
    const draft = drafts.find((d) => d.id === id);
    if (draft && draft.invoiceId !== null) {
      setConfirmCloseId(id);
    } else {
      doClose(id);
    }
  }, [drafts, doClose]);

  // ── إدراج بند (أول بند أو بند لاحق) — القلب التشغيلي لدمج الشاشتين ──
  // ملاحظة حرجة (القسم 3 نقطة 1): row الواردة من InvoiceLineEntry تحمل id
  // مؤقتاً محلياً (Date.now() + Math.random())؛ يجب استبداله بالـ detailId
  // الحقيقي المُرجَع من createInvoiceWithFirstDetail/appendDetail قبل إضافة
  // الصف إلى draft.rows، وإلا تُبطَل قدرة deleteDetailAndTouch على استهداف
  // الصف الصحيح لاحقاً.
  const handleInsertRow = useCallback(async (row: DraftRow) => {
    if (!activeDraft) return;
    if (!activeDraft.merchantId) {
      // احترازي: زر الإدراج معطَّل أصلاً بلا تاجر محدَّد فعلياً (نقطة 15) —
      // هذا المسار لا يجب أن يُستدعى عملياً، لكن نرفض بوضوح إن حدث.
      throw new Error("لا يمكن إدراج بند بدون تاجر محدَّد فعلياً.");
    }

    const targetId = activeDraft.id;
    patchDraft(targetId, { isSavingLine: true });

    // نفس تقريب round2 المستخدَم سابقاً في handleSave القديمة
    const detail = {
      product_name: row.product,
      quantity: round2(row.weight),
      price: round2(row.price),
      subtotal: round2(row.weight * row.price),
      boxes: row.boxesSnapshot.map((b) => ({ box_id: b.id, box_count: b.boxCount })),
    };

    try {
      if (activeDraft.invoiceId === null) {
        // أول بند فعلي — يُنشئ الفاتورة فعلياً في القاعدة (القاعدة الثابتة، القسم 2)
        const result = await invoiceService.createInvoiceWithFirstDetail(
          activeDraft.merchantId,
          new Date().toISOString().split("T")[0],
          detail,
        );

        patchDraft(targetId, {
          invoiceId: result.invoiceId,
          invoiceNumberInput: result.invoiceNumber,
          isNumberLocked: true,
          rows: [{ ...row, id: result.detailId }],
          isSavingLine: false,
        });
      } else {
        const totalAmount = round2(
          [...activeDraft.rows, row].reduce((sum, r) => sum + r.weight * r.price, 0),
        );

        const detailId = await invoiceService.appendDetail(
          activeDraft.invoiceId,
          activeDraft.merchantId,
          totalAmount,
          detail,
        );

        patchDraft(targetId, {
          rows: [...activeDraft.rows, { ...row, id: detailId }],
          isSavingLine: false,
        });
      }
    } catch (error) {
      patchDraft(targetId, { isSavingLine: false });
      // إعادة رمي الخطأ لازمة: InvoiceLineEntry.tsx يتلقّط هذا الاستثناء
      // ليعرض رسالة الخطأ المحلية ويحافظ على قيم الحقول (لا يُصفِّرها).
      throw error;
    }
  }, [activeDraft, patchDraft]);

  // ── دورة حياة حقل رقم الفاتورة (القسم 4) + منع فتح نفس الفاتورة في أكثر من
  // تبويب (القسم 5)، من مصدر حقل الرقم داخل الصفحة الرئيسية تحديداً ──
  const onResolveInvoiceNumber = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !activeDraft) return;

    const targetId = activeDraft.id;

    try {
      const matched = await invoiceService.getInvoiceFullDetailsByNumber(trimmed);
      if (!matched) return; // لا تطابق — الحقل يبقى نصاً حراً (القسم 4)

      const existingTab = drafts.find(
        (d) => d.invoiceId === matched.id && d.id !== targetId,
      );
      if (existingTab) {
        setActiveId(existingTab.id);
        alert("هذه الفاتورة مفتوحة بالفعل في تبويب آخر");
        patchDraft(targetId, { invoiceNumberInput: "" });
        return;
      }

      // نقطة 13: ترقيم كسول قبل العرض إن كانت بلا رقم بعد
      let finalInvoice = matched;
      if (matched.invoice_number === null) {
        const numbered = await invoiceService.ensureInvoiceNumbered(matched.id);
        finalInvoice = { ...matched, invoice_number: numbered.invoiceNumber };
      }

      // نقطة 12: إعادة فتح الفواتير المغلقة تتحول فوراً إلى is_open=1 عند التحميل
      await invoiceService.setOpenState(matched.id, 1);

      const newDraft = draftFromInvoice(finalInvoice, realBoxes);
      setDrafts((prev) =>
        prev.map((d) => (d.id === targetId ? { ...newDraft, id: targetId } : d)),
      );
    } catch (error) {
      console.error("خطأ أثناء تحميل الفاتورة برقمها:", error);
      alert("تعذر تحميل الفاتورة، يرجى مراجعة سجل الأخطاء.");
    }
  }, [activeDraft, drafts, realBoxes, patchDraft, setDrafts, setActiveId]);

  // ── الوظيفة الجديدة لزر "حفظ" (القسم 3 نقطة 7): إغلاق الفاتورة النشطة ثم
  // إعادة تعيين نفس التبويب لمسودة عذراء جديدة (لا حفظ فعلي، يحدث تلقائياً
  // من أول بند) ──
  const onCloseInvoice = useCallback(async (andPrint = false) => {
    if (!activeDraft || activeDraft.invoiceId === null || activeDraft.isClosing) return;

    const targetId = activeDraft.id;
    const invoiceId = activeDraft.invoiceId;
    patchDraft(targetId, { isClosing: true });

    try {
      await invoiceService.setOpenState(invoiceId, 0);

      if (andPrint) {
        // مهمة 2/2 من ميزة الطباعة: توليد PDF فعلي وفتحه، بدل window.print()
        // القديم. لا ننتظر (await) هذا قبل تصفير التبويب لمسودة جديدة أدناه —
        // الفاتورة نفسها أُغلقت وحُفظت بالفعل (setOpenState أعلاه)، فطباعتها
        // عملية منفصلة تماماً لا يجب أن تُعطّل تجربة المستخدم بانتظارها.
        printInvoice(invoiceId).catch((error) => {
          console.error("خطأ أثناء توليد PDF الفاتورة:", error);
          alert(
            error instanceof Error
              ? error.message
              : "تعذّر توليد ملف الطباعة لهذه الفاتورة.",
          );
        });
      }

      setDrafts((prev) =>
        prev.map((d) => (d.id === targetId ? makeDraft(targetId, realBoxes) : d)),
      );
    } catch (error) {
      console.error("خطأ أثناء إغلاق الفاتورة:", error);
      patchDraft(targetId, { isClosing: false });
      alert("تعذر إغلاق الفاتورة، يرجى مراجعة سجل الأخطاء.");
    }
  }, [activeDraft, realBoxes, patchDraft, setDrafts]);

  if (!activeDraft) {
    return (
      <div style={{ padding: "40px", textAlign: "center", fontFamily: "'Cairo', sans-serif", color: "#475569", fontSize: "16px" }}>
        جاري تحميل البيانات...
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
          // القسم 7 (نقطة 14): تعطيل زر إغلاق التبويب أثناء أي عملية حفظ
          // متعلقة ببند أو بإغلاق فاتورة لنفس التبويب تحديداً.
          const tabBusy = draft.isSavingLine || draft.isClosing;
          return (
            <div
              key={draft.id}
              onClick={() => setActiveId(draft.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "14px 18px 13px",
                cursor: "pointer",
                borderBottom: isActive ? "3px solid #2563EB" : "3px solid transparent",
                backgroundColor: isActive ? "white" : "#F1F5F9",
                borderRadius: "8px 8px 0 0",
                color: isActive ? "#1D4ED8" : "#334155",
                fontWeight: isActive ? 700 : 500,
                fontSize: "16px",
                whiteSpace: "nowrap",
                userSelect: "none",
                transition: "all 0.15s",
                marginBottom: isActive ? "-2px" : "0",
              }}
            >
              <span>{label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!tabBusy) requestClose(draft.id);
                }}
                disabled={tabBusy}
                style={{
                  border: "none",
                  background: "none",
                  cursor: tabBusy ? "not-allowed" : "pointer",
                  color: tabBusy ? "#CBD5E1" : (isActive ? "#60A5FA" : "#94A3B8"),
                  display: "flex",
                  alignItems: "center",
                  padding: "3px",
                  borderRadius: "4px",
                }}
                onMouseEnter={(e) => { if (!tabBusy) (e.currentTarget as HTMLButtonElement).style.color = "#EF4444"; }}
                onMouseLeave={(e) => { if (!tabBusy) (e.currentTarget as HTMLButtonElement).style.color = isActive ? "#60A5FA" : "#94A3B8"; }}
              >
                <X size={16} />
              </button>
            </div>
          );
        })}

        <button
          onClick={addDraft}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "12px 16px",
            border: "2px dashed #94A3B8",
            borderBottom: "none",
            borderRadius: "8px 8px 0 0",
            backgroundColor: "transparent",
            color: "#334155",
            fontSize: "15px",
            fontWeight: 500,
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
            (e.currentTarget as HTMLButtonElement).style.color = "#334155";
          }}
        >
          <Plus size={16} />
          فاتورة جديدة
        </button>
      </div>

      <MemoInvoiceForm
        draft={activeDraft}
        onChange={handleChange}
        handleInsertRow={handleInsertRow}
        onResolveInvoiceNumber={onResolveInvoiceNumber}
        onCloseInvoice={onCloseInvoice}
        merchants={merchants}
        products={products}
        onRefreshBoxes={onRefreshBoxes}
      />

      {confirmCloseId && (
        <ConfirmDialog
          invoiceNumber={drafts.find((d) => d.id === confirmCloseId)?.invoiceNumberInput ?? ""}
          onConfirm={() => doClose(confirmCloseId)}
          onCancel={() => setConfirmCloseId(null)}
        />
      )}
    </div>
  );
}

// القسم 6: نص/زر جديدان — الحوار يؤكّد إجراءً تجارياً متعمَّداً (إغلاق فاتورة
// نشطة)، لا "منع فقدان بيانات" كما كان سابقاً.
function ConfirmDialog({
  invoiceNumber,
  onConfirm,
  onCancel,
}: {
  invoiceNumber: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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
        <div style={{ fontSize: "32px", marginBottom: "14px" }}>⚠️</div>
        <div style={{ color: "#1E293B", fontSize: "19px", fontWeight: 700, marginBottom: "10px" }}>
          إغلاق الفاتورة رقم #{invoiceNumber}
        </div>
        <div style={{ color: "#334155", fontSize: "16px", lineHeight: 1.6, marginBottom: "28px" }}>
          سيتم تعليم هذه الفاتورة كمنتهية. يمكنك فتحها لاحقاً من أرشيف الفواتير للتعديل عليها في أي وقت.
        </div>
        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              backgroundColor: "white", color: "#1E293B", border: "2px solid #94A3B8",
              borderRadius: "8px", padding: "12px 22px", fontSize: "16px", cursor: "pointer",
              fontFamily: "'Cairo', sans-serif", fontWeight: 600,
            }}
          >
            إلغاء
          </button>
          <button
            onClick={onConfirm}
            style={{
              backgroundColor: "#2563EB", color: "white", border: "none",
              borderRadius: "8px", padding: "12px 22px", fontSize: "16px", cursor: "pointer",
              fontFamily: "'Cairo', sans-serif", fontWeight: 700,
            }}
          >
            إغلاق الفاتورة
          </button>
        </div>
      </div>
    </div>
  );
}