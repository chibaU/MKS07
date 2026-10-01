import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { Trash2, Copy, Save, Printer, X } from "lucide-react";
import type { Draft, DraftBox, DraftRow } from "./invoice";
import {
  type Merchant,
  type Product,
  type Box,
  invoiceService,
  boxService,
  StaleReferenceError,
} from "../services/db";
import { formStyles as c, round2, formatMoney, Autocomplete, type Suggestion } from "./InvoiceShared";
import { InvoiceLineEntry } from "./InvoiceLineEntry";

// ─── InvoiceForm ──────────────────────────────────────────────────────────────
// الشاشة الموحَّدة لإنشاء فاتورة جديدة وتعديل فاتورة محفوظة معاً (الجزء الثاني
// من المهمة — يحل المشكلة الأولى: توحيد ما كان مقسَّماً بين هذا الملف
// وInvoiceEditPanel.tsx المحذوف). لا فرق بين المسارين على مستوى هذا المكوّن؛
// draft.invoiceId هو ما يحدد إن كانت الفاتورة محفوظة فعلياً أم لا (القاعدة
// الثابتة في القسم 2: invoiceId !== null ⟺ rows.length > 0). الأنماط ومكوّن
// الـ Autocomplete مستوردة الآن من InvoiceShared.tsx بدل نسخة مكرَّرة محلية.

// عدد شارات "الصناديق حسب النوع" الظاهرة قبل الطيّ التلقائي في صف الإجماليات؛
// ما زاد عنه يُخفى خلف زر "+N أخرى" لتبقى الإجماليات قريبة من أسفل الجدول.
const BOX_TYPES_COLLAPSED_LIMIT = 8;

interface InvoiceFormProps {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  handleInsertRow: (row: DraftRow) => Promise<void>;
  onResolveInvoiceNumber: (text: string) => void;
  onCloseInvoice: (andPrint?: boolean) => void;
  merchants: Merchant[];
  products: Product[];
  // يحدّث قائمة الصناديق النشطة العامة (App) ويُرجع القائمة المحدَّثة، أو null عند الفشل.
  onRefreshBoxes: () => Promise<Box[] | null>;
}

export function InvoiceForm({
  draft,
  onChange,
  handleInsertRow,
  onResolveInvoiceNumber,
  onCloseInvoice,
  merchants,
  products,
  onRefreshBoxes,
}: InvoiceFormProps) {
  const merchantSuggestions = useMemo<Suggestion[]>(
    () =>
      merchants.map((m) => ({
        id: m.id,
        label: m.name,
        labelLower: m.name.toLowerCase(),
      })),
    [merchants],
  );

  const handleMerchantChange = useCallback(
    (val: string) => onChange({ merchantName: val, merchantId: undefined }),
    [onChange],
  );

  // نقطة 10 (القسم 3): حفظ التاجر فوراً عند الاختيار من قائمة الاقتراحات، إن
  // كانت الفاتورة محفوظة فعلياً — بالإضافة إلى (لا بديلاً عن) تحديث
  // merchantId/merchantName المحلي في المسودة كما هو الآن.
  const handleMerchantSelect = useCallback(
    (label: string, id?: number) => {
      onChange({ merchantName: label, merchantId: id });
      if (id !== undefined && draft.invoiceId !== null) {
        invoiceService.updateMerchant(draft.invoiceId, id).catch((error) => {
          console.error("خطأ أثناء تحديث التاجر:", error);
          if (error instanceof StaleReferenceError) {
            alert(error.message);
          }
        });
      }
    },
    [onChange, draft.invoiceId],
  );

  // حذف بند — حماية البند الوحيد: لا يمكن إفراغ الفاتورة من بنودها، فالقاعدة
  // الثابتة (القسم 2) invoiceId !== null ⟺ rows.length > 0 تبقى صحيحة دائماً.
  // الحذف الكامل للفاتورة متاح فقط من أرشيف الفواتير (invoiceService.deleteInvoice).
  // زر "نسخ" لا يخضع لهذه القاعدة إطلاقاً (لا يحذف ولا يُضيف شيئاً).
  const deleteRow = useCallback(
    async (rowId: number) => {
      if (draft.rows.length === 1) {
        alert("لا يمكن حذف البند الوحيد في الفاتورة.");
        return;
      }

      if (draft.invoiceId === null || !draft.merchantId) {
        // احترازي بحت: لا يجب أن يحدث فعلياً بحكم القاعدة الثابتة في القسم 2
        onChange({ rows: draft.rows.filter((r) => r.id !== rowId) });
        return;
      }

      onChange({ isSavingLine: true });
      try {
        const remainingRows = draft.rows.filter((r) => r.id !== rowId);
        const totalAmount = round2(
          remainingRows.reduce((sum, r) => sum + r.weight * r.price, 0),
        );
        await invoiceService.deleteDetailAndTouch(
          draft.invoiceId,
          rowId,
          draft.merchantId,
          totalAmount,
        );
        onChange({ rows: remainingRows, isSavingLine: false });
      } catch (error) {
        console.error("خطأ أثناء حذف البند:", error);
        onChange({ isSavingLine: false });
        alert("تعذر حذف البند، يرجى مراجعة سجل الأخطاء.");
      }
    },
    [draft, onChange],
  );

  // ─── نسخ بند إلى نموذج الإدخال ───────────────────────────────────────────
  // لا يُعدِّل الجدول ولا الفاتورة ولا رأسها (التاجر/الرقم): يملأ حقول نموذج
  // السطر العلوي فقط (منتج، وزن ميزان، سعر، أعداد صناديق) ليراجعها المستخدم
  // ويُدرجها بنفسه بزر "إدراج السطر". الاستبدال كامل: كل حقل من الحقول الخمسة
  // يُكتَب من جديد، وأعداد كل الصناديق تُصفَّر أولاً ثم تُوضَع أعداد البند فقط.
  //
  // الصناديق المخفية (is_visible = 0) المستخدَمة في البند تُظهَر في القاعدة
  // (revealBoxes) ثم تُحدَّث قائمة الصناديق العامة (onRefreshBoxes → realBoxes في
  // App) فتراها أي تبويب يُفتَح لاحقاً. لقطة boxes الخاصة بهذا التبويب وحده تُبنى
  // من تلك القائمة الحديثة؛ التبويبات الأخرى لا تُلمَس أبداً (onChange يستهدف
  // التبويب النشط وقت الضغط فقط).
  //
  // lineEntryKey: InvoiceLineEntry يحتفظ برسالتي خطأ محليتين (insertError،
  // weightInputError) لا تُصفَّران عند تعديل الـ draft من الخارج، وخطأ قديم
  // منهما قد يبقى ظاهراً ويمنع الإدراج بعد النسخ — فتغيير المفتاح يعيد تركيب
  // المكوّن بحالة محلية نظيفة (لا يعطّل أي حقل ولا يلمس بيانات الـ draft).
  const [lineEntryKey, setLineEntryKey] = useState(0);
  const lineEntryRef = useRef<HTMLDivElement>(null);
  const duplicatingRef = useRef(false); // يمنع تداخل نسختين متتاليتين أثناء الانتظار على القاعدة

  const handleDuplicateRow = useCallback(
    async (row: DraftRow) => {
      if (duplicatingRef.current) return;
      duplicatingRef.current = true;

      try {
        const usedBoxes = row.boxesSnapshot ?? [];

        // قائمة الصناديق التي سيُبنى منها نموذج الإدخال (مرتبة بالاسم كما في makeDraft)
        let boxList: Pick<DraftBox, "id" | "name" | "emptyWeight">[];

        if (usedBoxes.length === 0) {
          // بند بلا صناديق: لا حاجة لأي عملية قاعدة، فقط تصفير كل الأعداد
          boxList = draft.boxes;
        } else {
          await boxService.revealBoxes(usedBoxes.map((b) => b.id));
          const freshBoxes = await onRefreshBoxes();
          if (freshBoxes === null) {
            alert("تعذر نسخ البند، يرجى مراجعة سجل الأخطاء.");
            return;
          }
          boxList = freshBoxes.map((b) => ({
            id: b.id,
            name: b.name,
            emptyWeight: b.weight,
          }));

          // صندوق مستخدَم لا يوجد في القاعدة إطلاقاً (حُذف) — لا يمكن إعادة بناء
          // وزن الميزان بدقة، فنوقف النسخ بدل ملء نموذج بقيم خاطئة.
          const known = new Set(boxList.map((b) => b.id));
          if (usedBoxes.some((b) => !known.has(b.id))) {
            alert("أحد الصناديق المستخدمة في هذا البند لم يعد موجوداً في النظام — تعذر نسخ البند.");
            return;
          }
        }

        // تصفير كل الأعداد ثم وضع أعداد البند المنسوخ فقط
        const copiedCounts = new Map(usedBoxes.map((b) => [b.id, b.boxCount]));
        const nextBoxes: DraftBox[] = boxList.map((b) => ({
          id: b.id,
          name: b.name,
          emptyWeight: b.emptyWeight,
          countInput: copiedCounts.get(b.id) ?? 0,
        }));

        // وزن الميزان = الوزن الصافي + مجموع (عدد × وزن فارغ) للصناديق المستخدمة،
        // بنفس صيغة totalEmptyWeight في InvoiceLineEntry ونفس round2.
        const totalEmptyWeight = nextBoxes.reduce(
          (sum, b) => sum + b.countInput * b.emptyWeight,
          0,
        );
        const scaleWeight = round2(row.weight + totalEmptyWeight);

        onChange({
          productInput: row.product,
          productId: row.productId ?? undefined,
          scaleWeightInput: String(scaleWeight),
          // priceInput أرقام فقط = دنانير كاملة (MoneyInput)؛ سعر صفري = حقل فارغ كما أُدرج
          priceInput: row.price > 0 ? String(Math.round(row.price)) : "",
          boxes: nextBoxes,
        });
        setLineEntryKey((k) => k + 1);

        // الجدول أسفل النموذج: بدون هذا قد يبدو الزر بلا أثر لمن ضغطه من أسفل صفحة طويلة
        lineEntryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        console.error("خطأ أثناء نسخ البند:", error);
        alert("تعذر نسخ البند، يرجى مراجعة سجل الأخطاء.");
      } finally {
        duplicatingRef.current = false;
      }
    },
    [draft.boxes, onChange, onRefreshBoxes],
  );

  const grandTotal = useMemo(
    () => draft.rows.reduce((sum, r) => sum + r.weight * r.price, 0),
    [draft.rows],
  );

  // إجمالي الوزن الصافي وعدد الصناديق الكلي — **نفس منطق buildPayload في print.ts
  // تماماً** (الوزن: round2 مرة واحدة على المجموع الخام، الصناديق: مجموع boxCount
  // عبر كل البنود) ليتطابق المعروض على الشاشة مع ما يُطبَع في {{الوزن_الكلي}}
  // و{{عدد_الصناديق_الكلي}}. عرض فقط — لا يُحفَظ في القاعدة ولا في الـ Draft.
  //
  // boxTypes: تفصيل عدد الصناديق لكل نوع عبر كل البنود (تجميع بمعرّف الصندوق).
  // الاسم يأتي من لقطة البند نفسها (bs.name) لا من قائمة الصناديق النشطة، فتظهر
  // الصناديق المخفية (is_visible = 0) بأسمائها في الفواتير القديمة. مجموع أعداد
  // boxTypes يساوي totals.boxes دائماً. عرض فقط — لا يدخل في الطباعة ولا القاعدة.
  const totals = useMemo(() => {
    let weight = 0;
    let boxes = 0;
    const perType = new Map<number, { id: number; name: string; count: number }>();
    for (const r of draft.rows) {
      weight += r.weight;
      for (const bs of r.boxesSnapshot ?? []) {
        boxes += bs.boxCount;
        const existing = perType.get(bs.id);
        if (existing) {
          existing.count += bs.boxCount;
        } else {
          perType.set(bs.id, {
            id: bs.id,
            name: bs.name ?? `#${bs.id}`,
            count: bs.boxCount,
          });
        }
      }
    }
    const boxTypes = [...perType.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "ar"),
    );
    return { weight: round2(weight), boxes, boxTypes };
  }, [draft.rows]);

  // ─── تحديد بنود الجدول (Select/Highlight) — ميزة عرض فقط، لا تُرسَل للقاعدة ولا للـ Draft ──
  // نقرة عادية: تحديد هذا البند فقط (أو إلغاء تحديده إن كان محدَّداً وحيداً بالفعل).
  // Ctrl/Cmd+نقرة: تبديل هذا البند داخل التحديد الحالي دون التأثير على البقية (بنود متفرقة).
  // Shift+نقرة: تحديد نطاق متصل بين آخر بند تم "تثبيته" (anchor) وهذا البند (بنود متتالية).
  // التحديد يُحفَظ بمعرّفات البنود الحقيقية (row.id من القاعدة) لا بالفهرس، فيبقى
  // صالحاً حتى لو تغيّر ترتيب الصفوف؛ ويُنظَّف تلقائياً أدناه عند حذف بند أو عند
  // تبديل التبويب/الفاتورة المعروضة (معرّفات البنود فريدة عالمياً في القاعدة).
  // حالة توسيع قائمة الصناديق حسب النوع — تُحفَظ بمعرّف المسودة، فتعود مطويّة
  // تلقائياً عند التبديل لتبويب آخر بلا الحاجة إلى effect. عرض فقط.
  const [expandedBoxTypesFor, setExpandedBoxTypesFor] = useState<string | null>(null);
  const boxTypesExpanded = expandedBoxTypesFor === draft.id;
  const hiddenBoxTypesCount = Math.max(0, totals.boxTypes.length - BOX_TYPES_COLLAPSED_LIMIT);
  const visibleBoxTypes = boxTypesExpanded
    ? totals.boxTypes
    : totals.boxTypes.slice(0, BOX_TYPES_COLLAPSED_LIMIT);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [anchorRowId, setAnchorRowId] = useState<number | null>(null);

  useEffect(() => {
    const idSet = new Set(draft.rows.map((r) => r.id));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<number>();
      prev.forEach((id) => {
        if (idSet.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
    setAnchorRowId((prev) => (prev !== null && !idSet.has(prev) ? null : prev));
  }, [draft.rows]);

  const handleRowClick = useCallback(
    (e: React.MouseEvent<HTMLTableRowElement>, rowId: number, index: number) => {
      if (e.shiftKey) {
        const anchorIdx =
          anchorRowId !== null ? draft.rows.findIndex((r) => r.id === anchorRowId) : -1;
        if (anchorIdx !== -1) {
          const [start, end] = anchorIdx <= index ? [anchorIdx, index] : [index, anchorIdx];
          setSelectedIds(new Set(draft.rows.slice(start, end + 1).map((r) => r.id)));
          return; // النطاق فقط يتغيّر — anchor يبقى كما هو (سلوك Shift القياسي)
        }
      }
      if (e.ctrlKey || e.metaKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(rowId)) next.delete(rowId);
          else next.add(rowId);
          return next;
        });
        setAnchorRowId(rowId);
        return;
      }
      setSelectedIds((prev) => (prev.size === 1 && prev.has(rowId) ? new Set() : new Set([rowId])));
      setAnchorRowId(rowId);
    },
    [anchorRowId, draft.rows],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setAnchorRowId(null);
  }, []);

  const selectedTotal = useMemo(
    () =>
      round2(
        draft.rows
          .filter((r) => selectedIds.has(r.id))
          .reduce((sum, r) => sum + r.weight * r.price, 0),
      ),
    [draft.rows, selectedIds],
  );

  // زر "حفظ"/"حفظ وطباعة" الآن يُغلِق الفاتورة (القسم 3 نقطة 7) بدل حفظها
  // فعلياً (يحدث تلقائياً من أول بند) — يُفعَّل فقط إن كانت هناك فاتورة محفوظة
  // فعلياً لإغلاقها، وفق القاعدة الثابتة الحاكمة لكل تفعيل/تعطيل في هذا الجزء.
  const canClose = draft.invoiceId !== null && !draft.isClosing;

  return (
    <div style={{ padding: "28px 32px" }}>
      <div style={c.card}>
        <div
          style={{
            color: "#1E293B",
            fontSize: "20px",
            fontWeight: 700,
            marginBottom: "20px",
          }}
        >
          {draft.invoiceId !== null
            ? `فاتورة رقم #${draft.invoiceNumberInput}`
            : "إنشاء فاتورة جديدة"}
        </div>

        {/* رقم الفاتورة (القسم 4) */}
        <div style={{ marginBottom: "18px" }}>
          <label style={c.label}>رقم الفاتورة</label>
          <input
            type="text"
            style={{
              ...c.input,
              backgroundColor: draft.isNumberLocked ? "#F1F5F9" : c.input.backgroundColor,
              color: draft.isNumberLocked ? "#64748B" : c.input.color,
              cursor: draft.isNumberLocked ? "not-allowed" : "text",
            }}
            placeholder="اكتب رقم فاتورة موجودة لفتحها، أو اتركه فارغاً ليُولَّد تلقائياً"
            value={draft.invoiceNumberInput}
            readOnly={draft.isNumberLocked}
            onChange={(e) => onChange({ invoiceNumberInput: e.target.value })}
            onBlur={(e) => {
              if (!draft.isNumberLocked) onResolveInvoiceNumber(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !draft.isNumberLocked) {
                e.preventDefault();
                onResolveInvoiceNumber(draft.invoiceNumberInput);
              }
            }}
          />
          {draft.isNumberLocked && (
            <div style={{ marginTop: "6px", fontSize: "14px", fontWeight: 600, color: "#047857" }}>
              ✓ الرقم مؤكَّد — غير قابل للتعديل
            </div>
          )}
        </div>

        {/* التاجر */}
        <div style={{ marginBottom: "18px" }}>
          <label style={c.label}>اسم التاجر</label>
          <Autocomplete
            value={draft.merchantName}
            onChange={handleMerchantChange}
            onSelect={handleMerchantSelect}
            suggestions={merchantSuggestions}
            placeholder="أدخل اسم التاجر أو ابحث عن موجود..."
          />
          {draft.merchantId && (
            <div
              style={{
                marginTop: "6px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#047857",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              ✓ تاجر محفوظ — سيتم ربط الفاتورة بحسابه
            </div>
          )}
          {!draft.merchantId && draft.merchantName.trim() !== "" && (
            <div
              style={{
                marginTop: "6px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#DC2626",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              ⚠ هذا الاسم غير مسجَّل — اختر تاجراً من القائمة أو سجّله أولاً من
              صفحة "التجار"
            </div>
          )}
        </div>

        {/* إدراج بند جديد — مسار موحَّد مع تعديل الفاتورة المحفوظة عبر InvoiceLineEntry
            (نفس المكوّن المستخدَم سابقاً في InvoiceEditPanel.tsx المحذوف الآن) */}
        <div ref={lineEntryRef}>
          <InvoiceLineEntry
            key={lineEntryKey}
            entry={draft}
            onChange={onChange}
            onInsert={handleInsertRow}
            isBusy={draft.isSavingLine}
            merchantSelected={Boolean(draft.merchantId)}
            products={products}
          />
        </div>
      </div>

      {/* جدول الفاتورة */}
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
          <span style={{ color: "#1E293B", fontSize: "17px", fontWeight: 700 }}>
            بنود الفاتورة
            {draft.merchantName && (
              <span
                style={{
                  color: "#2563EB",
                  marginRight: "8px",
                  fontSize: "16px",
                  fontWeight: 600,
                }}
              >
                — {draft.merchantName}
              </span>
            )}
          </span>
          <span style={{ color: "#475569", fontSize: "15px", fontWeight: 500 }}>
            {draft.rows.length} بند
            {selectedIds.size > 0 && (
              <span style={{ color: "#B45309", fontWeight: 700, marginRight: "8px" }}>
                · {selectedIds.size} محدَّد
              </span>
            )}
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
            {draft.rows.map((row, i) => {
              const isSelected = selectedIds.has(row.id);
              return (
                <tr
                  key={row.id}
                  onClick={(e) => handleRowClick(e, row.id, i)}
                  onMouseDown={(e) => {
                    // يمنع تحديد نص المتصفح الافتراضي أثناء Shift+ضغط لتحديد نطاق
                    if (e.shiftKey) e.preventDefault();
                  }}
                  title="اضغط للتحديد — Ctrl+ضغط لتحديد بنود متفرقة، Shift+ضغط لتحديد نطاق متتالٍ"
                  style={{
                    backgroundColor: isSelected ? "#DBEAFE" : i % 2 === 0 ? "white" : "#FAFBFC",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <td style={{ ...c.td, color: "#475569", fontWeight: 600, width: "56px" }}>
                    {i + 1}
                  </td>
                  <td style={{ ...c.td, fontWeight: 600 }}>{row.product}</td>
                  <td style={c.td}>{row.weight.toFixed(1)}</td>
                  <td style={{ ...c.td, color: "#0F766E", fontWeight: 700 }}>
                    {formatMoney(row.price)} دج
                  </td>
                  <td style={{ ...c.td, fontSize: "14px", color: "#334155" }}>
                    {row.boxesSnapshot && row.boxesSnapshot.length > 0 ? (
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}
                      >
                        {row.boxesSnapshot.map((bs, idx) => {
                          return (
                            <span
                              key={idx}
                              style={{
                                backgroundColor: "#F1F5F9",
                                border: "1px solid #E2E8F0",
                                padding: "4px 8px",
                                borderRadius: "4px",
                                fontSize: "13px",
                                fontWeight: 500,
                              }}
                            >
                              {bs.name ?? `#${bs.id}`} ×{bs.boxCount}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span style={{ color: "#94A3B8" }}>—</span>
                    )}
                  </td>
                  <td style={{ ...c.td, color: "#2563EB", fontWeight: 700, fontSize: "17px" }}>
                    {formatMoney(row.weight * row.price)} دج
                  </td>
                  <td style={c.td}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {/* نسخ: يملأ نموذج الإدخال فقط (لا يضيف ولا يحذف) — متاح لكل البنود
                          حتى البند الوحيد. يُعطَّل فقط أثناء حفظ بند جارٍ (isSavingLine)
                          كي لا يُمحى المنسوخ بتصفير النموذج الذي يعقب نجاح ذلك الحفظ. */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDuplicateRow(row);
                        }}
                        disabled={draft.isSavingLine}
                        title="نسخ البند إلى نموذج الإدخال"
                        style={{
                          border: "none",
                          borderRadius: "6px",
                          padding: "8px 14px",
                          cursor: draft.isSavingLine ? "not-allowed" : "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          fontSize: "14px",
                          fontFamily: "'Cairo', sans-serif",
                          fontWeight: 600,
                          backgroundColor: draft.isSavingLine ? "#F1F5F9" : "#EFF6FF",
                          color: draft.isSavingLine ? "#94A3B8" : "#2563EB",
                        }}
                      >
                        <Copy size={15} />
                        نسخ
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRow(row.id);
                        }}
                        disabled={draft.isSavingLine}
                        style={{
                          border: "none",
                          borderRadius: "6px",
                          padding: "8px 14px",
                          cursor: draft.isSavingLine ? "not-allowed" : "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          fontSize: "14px",
                          fontFamily: "'Cairo', sans-serif",
                          fontWeight: 600,
                          backgroundColor: draft.isSavingLine ? "#F1F5F9" : "#FEF2F2",
                          color: draft.isSavingLine ? "#94A3B8" : "#DC2626",
                        }}
                      >
                        <Trash2 size={15} />
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {/* المجموع اللحظي للبنود المحددة — يظهر فقط عند وجود تحديد فعلي،
                ويُحسَب فوراً عند أي تغيير في التحديد (إضافة/إلغاء بند) عبر
                useMemo أعلاه، بلا أي زر أو تأخير */}
            {selectedIds.size > 0 && (
              <tr style={{ backgroundColor: "#FFFBEB", borderTop: "2px solid #FDE68A" }}>
                <td
                  style={{ ...c.td, fontWeight: 700, color: "#92400E" }}
                  colSpan={5}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
                    إجمالي البنود المحددة ({selectedIds.size})
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        clearSelection();
                      }}
                      style={{
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        color: "#B45309",
                        fontSize: "14px",
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3px",
                        padding: "3px 9px",
                        borderRadius: "4px",
                        fontFamily: "'Cairo', sans-serif",
                      }}
                    >
                      <X size={14} />
                      مسح التحديد
                    </button>
                  </span>
                </td>
                <td
                  style={{
                    ...c.td,
                    fontWeight: 800,
                    color: "#92400E",
                    fontSize: "18px",
                  }}
                  colSpan={2}
                >
                  {formatMoney(selectedTotal)} دج
                </td>
              </tr>
            )}

            {draft.rows.length > 0 && (
              <tr
                style={{
                  backgroundColor: "#EFF6FF",
                  borderTop: "2px solid #BFDBFE",
                }}
              >
                {/* صف الإجماليات: الوزن الصافي + عدد الصناديق (يمين) ثم المبلغ الكلي
                    (يسار، في مكانه المعتاد). خلية واحدة بعرض الجدول كله كي لا ترتبط
                    الإجماليات بأعمدة الجدول المتغيّرة العرض. */}
                <td style={{ ...c.td, color: "#1E40AF" }} colSpan={7}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "12px 32px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "12px 32px",
                      }}
                    >
                      <span>
                        <span style={{ fontWeight: 700 }}>إجمالي الوزن الصافي: </span>
                        <span style={{ fontWeight: 800, fontSize: "18px" }}>
                          {totals.weight.toFixed(2)} كغ
                        </span>
                      </span>
                      <span>
                        <span style={{ fontWeight: 700 }}>عدد الصناديق الكلي: </span>
                        <span style={{ fontWeight: 800, fontSize: "18px" }}>
                          {totals.boxes}
                        </span>
                      </span>
                    </div>
                    <span>
                      <span style={{ fontWeight: 700 }}>الإجمالي الكلي: </span>
                      <span style={{ fontWeight: 800, fontSize: "18px" }}>
                        {formatMoney(grandTotal)} دج
                      </span>
                    </span>
                  </div>

                  {/* تفصيل الصناديق حسب النوع — نفس شكل شارات الصناديق داخل البنود
                      (الاسم ×العدد)، بخلفية بيضاء لتتضح فوق خلفية صف الإجماليات */}
                  {totals.boxTypes.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "8px",
                        marginTop: "12px",
                        paddingTop: "12px",
                        borderTop: "1px dashed #BFDBFE",
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>الصناديق حسب النوع:</span>
                      {visibleBoxTypes.map((bt) => (
                        <span
                          key={bt.id}
                          style={{
                            backgroundColor: "white",
                            border: "1px solid #BFDBFE",
                            padding: "4px 10px",
                            borderRadius: "4px",
                            fontSize: "14px",
                            fontWeight: 600,
                            color: "#1E40AF",
                          }}
                        >
                          {bt.name} ×{bt.count}
                        </span>
                      ))}
                      {hiddenBoxTypesCount > 0 && (
                        <button
                          onClick={() =>
                            setExpandedBoxTypesFor(boxTypesExpanded ? null : draft.id)
                          }
                          style={{
                            backgroundColor: "transparent",
                            border: "1px dashed #93C5FD",
                            padding: "4px 10px",
                            borderRadius: "4px",
                            fontSize: "14px",
                            fontWeight: 700,
                            color: "#1E40AF",
                            cursor: "pointer",
                            fontFamily: "'Cairo', sans-serif",
                          }}
                        >
                          {boxTypesExpanded ? "إخفاء" : `+${hiddenBoxTypesCount} أخرى`}
                        </button>
                      )}
                    </div>
                  )}
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
              color: "#64748B",
              fontSize: "16px",
            }}
          >
            لا توجد بنود — أضف منتجاً باستخدام النموذج أعلاه
          </div>
        )}
      </div>

      {/* أزرار "حفظ"/"حفظ وطباعة" — أصبحت تُغلِق الفاتورة (is_open=false) بدل
          حفظها فعلياً (القسم 3 نقطة 7)؛ تُعطَّل حسب draft.isClosing فقط */}
      <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
        <button
          onClick={() => onCloseInvoice(true)}
          disabled={!canClose}
          style={{
            backgroundColor: "white",
            color: !canClose ? "#94A3B8" : "#1E293B",
            border: `2px solid ${!canClose ? "#CBD5E1" : "#64748B"}`,
            borderRadius: "8px",
            padding: "14px 32px",
            fontSize: "16px",
            fontWeight: 700,
            cursor: !canClose ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "9px",
            fontFamily: "'Cairo', sans-serif",
          }}
        >
          <Printer size={18} />
          {draft.isClosing ? "جارٍ الإغلاق..." : "حفظ وطباعة"}
        </button>
        <button
          onClick={() => onCloseInvoice(false)}
          disabled={!canClose}
          style={{
            backgroundColor: !canClose ? "#93C5FD" : "#2563EB",
            color: "white",
            border: "none",
            borderRadius: "8px",
            padding: "14px 32px",
            fontSize: "16px",
            fontWeight: 700,
            cursor: !canClose ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "9px",
            fontFamily: "'Cairo', sans-serif",
          }}
        >
          <Save size={18} />
          {draft.isClosing ? "جارٍ الإغلاق..." : "حفظ"}
        </button>
      </div>
    </div>
  );
}