import { useMemo, useCallback, useState, useEffect, useRef, memo, type CSSProperties } from "react";
import { Trash2, Copy, Printer, X, Store } from "lucide-react";
import type { Draft, DraftBox, DraftRow } from "./invoice";
import {
  type Merchant,
  type Product,
  invoiceService,
  StaleReferenceError,
} from "../services/db";
import {
  formStyles as c,
  round2,
  formatMoney,
  Autocomplete,
  FieldLabel,
  FIELD_CSS,
  FIELD_VARS,
  useStableCallback,
  type Suggestion,
} from "./InvoiceShared";
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

// ─── رأس البطاقة: التاجر + رقم الفاتورة (عرض فقط) ───────────────────────────
// شبكة من صفين: الصف 1 = عنوان التاجر، الصف 2 = خانة التاجر + شارة الرقم.
// الشارة align-self: stretch في الصف 2 فتأخذ ارتفاع خانة التاجر نفسه تلقائياً
// (بلا رقم ثابت يتأثر بخط Cairo أو حجم الخط).
const CARD_STYLE: CSSProperties = { ...c.card, padding: "20px 24px" };

const HEADER_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) clamp(220px, 24vw, 300px)",
  columnGap: "20px",
  marginBottom: "20px",
};
const LABEL_ROW: CSSProperties = {
  gridColumn: 1,
  gridRow: 1,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "12px",
  minWidth: 0,
};
const MERCHANT_CELL: CSSProperties = { ...FIELD_VARS, gridColumn: 1, gridRow: 2 };
const STATUS_BASE: CSSProperties = {
  display: "block",
  minWidth: 0,
  lineHeight: "28px", // نفس ارتفاع أيقونة العنوان
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "14px",
  fontWeight: 600,
};
const STATUS_OK: CSSProperties = { ...STATUS_BASE, color: "#047857" };
const STATUS_WARN: CSSProperties = { ...STATUS_BASE, color: "#DC2626" };

const BADGE_BASE: CSSProperties = {
  gridColumn: 2,
  gridRow: 2,
  alignSelf: "stretch",
  boxSizing: "border-box",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 14px",
  borderRadius: "8px", // نفس انحناء خانات الإدخال
  overflow: "hidden",
};
const BADGE_SAVED: CSSProperties = { ...BADGE_BASE, border: "2px solid #93C5FD", backgroundColor: "#EFF6FF" };
const BADGE_NEW: CSSProperties = { ...BADGE_BASE, border: "2px dashed #94A3B8", backgroundColor: "#F8FAFC" };
const BADGE_NUMBER: CSSProperties = {
  fontSize: "22px",
  fontWeight: 800,
  color: "#1E40AF",
  lineHeight: 1.2,
  direction: "ltr",
  unicodeBidi: "isolate",
  userSelect: "all", // نقرة واحدة تحدد الرقم كاملاً للنسخ
  whiteSpace: "nowrap",
};
const BADGE_HINT: CSSProperties = {
  minWidth: 0,
  fontSize: "15px",
  fontWeight: 600,
  color: "#64748B",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

// props بسيطة (نص) فلا يُعاد رسمها أثناء الكتابة في بقية الحقول.
const InvoiceNumberBadge = memo(function InvoiceNumberBadge({ number }: { number: string }) {
  return number ? (
    <div style={BADGE_SAVED} title="رقم الفاتورة">
      <span style={BADGE_NUMBER}>{number}</span>
    </div>
  ) : (
    <div style={BADGE_NEW}>
      <span style={BADGE_HINT}>رقم الفاتورة — يُولَّد الرقم تلقائياً</span>
    </div>
  );
});

interface InvoiceHeaderProps {
  merchantName: string;
  merchantId: number | undefined;
  invoiceNumber: string;
  suggestions: Suggestion[];
  onMerchantChange: (val: string) => void;
  onMerchantSelect: (label: string, id?: number) => void;
}

// كل الـ props قيم بسيطة أو دوال بهوية ثابتة، فلا يُعاد رسم الرأس مع ضغطات المنتج/الوزن/السعر.
const InvoiceHeader = memo(function InvoiceHeader({
  merchantName,
  merchantId,
  invoiceNumber,
  suggestions,
  onMerchantChange,
  onMerchantSelect,
}: InvoiceHeaderProps) {
  const unregistered = !merchantId && merchantName.trim() !== "";
  return (
    <>
      <style>{FIELD_CSS}</style>
      <div style={HEADER_GRID}>
        <div style={LABEL_ROW}>
          <FieldLabel icon={<Store size={17} />}>اسم التاجر</FieldLabel>
          {merchantId ? (
            <span style={STATUS_OK}>✓ تاجر محفوظ</span>
          ) : unregistered ? (
            <span
              title='هذا الاسم غير مسجَّل — اختر تاجراً من القائمة أو سجّله أولاً من صفحة "التجار"'
              style={STATUS_WARN}
            >
              ⚠ غير مسجَّل — اختر من القائمة
            </span>
          ) : null}
        </div>

        <div className="le-f" style={MERCHANT_CELL}>
          <Autocomplete
            value={merchantName}
            onChange={onMerchantChange}
            onSelect={onMerchantSelect}
            suggestions={suggestions}
            placeholder="أدخل اسم التاجر أو ابحث عن موجود..."
          />
        </div>

        <InvoiceNumberBadge number={invoiceNumber} />
      </div>
    </>
  );
});

// ─── صف بند واحد في الجدول ───────────────────────────────────────────────────
// memo: عند الكتابة في أي حقل إدخال (كل ضغطة مفتاح) لا تتغير بيانات الصفوف
// (draft.rows يحتفظ بهويته) ولا الدوال الممرَّرة (هويات ثابتة عبر
// useStableCallback)، فلا يُعاد رسم أي صف. كان كل حرف يُعيد رسم كل الصفوف
// بأيقوناتها وأزرارها.
interface InvoiceRowViewProps {
  row: DraftRow;
  index: number;
  isSelected: boolean;
  disabled: boolean;
  onRowClick: (e: React.MouseEvent<HTMLTableRowElement>, rowId: number, index: number) => void;
  onDuplicate: (row: DraftRow) => void;
  onDelete: (rowId: number) => void;
}

const InvoiceRowView = memo(function InvoiceRowView({
  row,
  index,
  isSelected,
  disabled,
  onRowClick,
  onDuplicate,
  onDelete,
}: InvoiceRowViewProps) {
  return (
    <tr
      onClick={(e) => onRowClick(e, row.id, index)}
      onMouseDown={(e) => {
        // يمنع تحديد نص المتصفح الافتراضي أثناء Shift+ضغط لتحديد نطاق
        if (e.shiftKey) e.preventDefault();
      }}
      title="اضغط للتحديد — Ctrl+ضغط لتحديد بنود متفرقة، Shift+ضغط لتحديد نطاق متتالٍ"
      style={{
        backgroundColor: isSelected ? "#DBEAFE" : index % 2 === 0 ? "white" : "#FAFBFC",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <td style={{ ...c.td, color: "#475569", fontWeight: 600, width: "56px" }}>{index + 1}</td>
      <td style={{ ...c.td, fontWeight: 600 }}>{row.product}</td>
      <td style={c.td}>{row.weight.toFixed(2)}</td>
      <td style={{ ...c.td, color: "#0F766E", fontWeight: 700 }}>{formatMoney(row.price)} دج</td>
      <td style={{ ...c.td, fontSize: "14px", color: "#334155" }}>
        {row.boxesSnapshot && row.boxesSnapshot.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {row.boxesSnapshot.map((bs, idx) => (
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
            ))}
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
              onDuplicate(row);
            }}
            disabled={disabled}
            title="نسخ البند إلى نموذج الإدخال"
            style={{
              border: "none",
              borderRadius: "6px",
              padding: "8px 14px",
              cursor: disabled ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              fontSize: "14px",
              fontFamily: "'Cairo', sans-serif",
              fontWeight: 600,
              backgroundColor: disabled ? "#F1F5F9" : "#EFF6FF",
              color: disabled ? "#94A3B8" : "#2563EB",
            }}
          >
            <Copy size={15} />
            نسخ
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(row.id);
            }}
            disabled={disabled}
            style={{
              border: "none",
              borderRadius: "6px",
              padding: "8px 14px",
              cursor: disabled ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              fontSize: "14px",
              fontFamily: "'Cairo', sans-serif",
              fontWeight: 600,
              backgroundColor: disabled ? "#F1F5F9" : "#FEF2F2",
              color: disabled ? "#94A3B8" : "#DC2626",
            }}
          >
            <Trash2 size={15} />
            حذف
          </button>
        </div>
      </td>
    </tr>
  );
});

interface InvoiceFormProps {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  handleInsertRow: (row: DraftRow) => Promise<void>;
  onPrintInvoice: (includeRepeatedProductSummary?: boolean) => void;
  merchants: Merchant[];
  products: Product[];
}

export function InvoiceForm({
  draft,
  onChange,
  handleInsertRow,
  onPrintInvoice,
  merchants,
  products,
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
  //
  // useStableCallback: هوية ثابتة كي تعمل memo على InvoiceRowView؛ الجسم يقرأ
  // دائماً أحدث draft وقت النقر.
  const deleteRow = useStableCallback(async (rowId: number) => {
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
  });

  // ─── نسخ بند إلى نموذج الإدخال ───────────────────────────────────────────
  // لا يُعدِّل الجدول ولا الفاتورة ولا رأسها (التاجر/الرقم): يملأ حقول نموذج
  // السطر العلوي فقط (منتج، وزن ميزان، سعر، أعداد صناديق) ليراجعها المستخدم
  // ويُدرجها بنفسه بزر "إدراج السطر". الاستبدال كامل: كل حقل من الحقول الخمسة
  // يُكتَب من جديد، وأعداد كل الصناديق تُصفَّر أولاً ثم تُوضَع أعداد البند فقط.
  //
  // lineEntryKey: InvoiceLineEntry يحتفظ برسالتي خطأ محليتين (insertError،
  // weightInputError) لا تُصفَّران عند تعديل الـ draft من الخارج، وخطأ قديم
  // منهما قد يبقى ظاهراً ويمنع الإدراج بعد النسخ — فتغيير المفتاح يعيد تركيب
  // المكوّن بحالة محلية نظيفة (لا يعطّل أي حقل ولا يلمس بيانات الـ draft).
  const [lineEntryKey, setLineEntryKey] = useState(0);
  const lineEntryRef = useRef<HTMLDivElement>(null);

  const handleDuplicateRow = useStableCallback((row: DraftRow) => {
    const usedBoxes = row.boxesSnapshot ?? [];

    // وزن الميزان يُعاد بناؤه من أوزان الصناديق الفارغة في نموذج هذا التبويب؛
    // صندوق مستخدَم في البند وغائب عن النموذج يجعل إعادة البناء غير دقيقة،
    // فنوقف النسخ بدل ملء النموذج بقيم خاطئة.
    const known = new Set(draft.boxes.map((b) => b.id));
    if (usedBoxes.some((b) => !known.has(b.id))) {
      alert("أحد الصناديق المستخدمة في هذا البند غير موجود في نموذج الإدخال الحالي — تعذر نسخ البند.");
      return;
    }

    // تصفير كل الأعداد ثم وضع أعداد البند المنسوخ فقط
    const copiedCounts = new Map(usedBoxes.map((b) => [b.id, b.boxCount]));
    const nextBoxes: DraftBox[] = draft.boxes.map((b) => ({
      ...b,
      countInput: copiedCounts.get(b.id) ?? 0,
    }));

    // وزن الميزان = الوزن الصافي + مجموع (عدد × وزن فارغ) للصناديق المستخدمة،
    // بنفس صيغة totalEmptyWeight في InvoiceLineEntry ونفس round2.
    const totalEmptyWeight = nextBoxes.reduce(
      (sum, b) => sum + b.countInput * b.emptyWeight,
      0,
    );
    const scaleWeight = round2(row.weight + totalEmptyWeight);

    // priceInput أرقام فقط = دنانير كاملة (MoneyInput)؛ سعر صفري = حقل فارغ كما أُدرج.
    // سعر بسنتيم غير صفري (بند قديم من قبل MoneyInput، مثل 87,50) لا يُدوَّر أبداً:
    // التدوير يغيّر المبلغ بحجم الكمية (87,5 × 10.000 كغ ← فرق 5.000 دج)، ولا يمكن
    // وضعه كما هو في MoneyInput لأنه يتجاهل الفاصلة فيقرؤه ×10. فيُترك الحقل فارغاً
    // ويُنبَّه المستخدم ليُدخل السعر بنفسه عن قصد.
    const priceIsWhole = Number.isInteger(row.price);
    onChange({
      productInput: row.product,
      productId: row.productId ?? undefined,
      scaleWeightInput: String(scaleWeight),
      priceInput: row.price > 0 && priceIsWhole ? String(row.price) : "",
      boxes: nextBoxes,
    });
    setLineEntryKey((k) => k + 1);

    // الجدول أسفل النموذج: بدون هذا قد يبدو الزر بلا أثر لمن ضغطه من أسفل صفحة طويلة
    lineEntryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    if (row.price > 0 && !priceIsWhole) {
      alert(
        `سعر البند الأصلي (${formatMoney(row.price)} دج) يحتوي سنتيماً ولا يمكن إدخاله في خانة السعر، ` +
          "فتُرك الحقل فارغاً كي لا يُدوَّر السعر بصمت. أدخل السعر يدوياً.",
      );
    }
  });

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
  // الاسم يأتي من لقطة البند نفسها (bs.name). مجموع أعداد boxTypes يساوي
  // totals.boxes دائماً. عرض فقط — لا يدخل في الطباعة ولا القاعدة.
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

  // useStableCallback: هوية ثابتة لتعمل memo على InvoiceRowView؛ الجسم يقرأ دائماً
  // أحدث anchorRowId وdraft.rows وقت النقر.
  const handleRowClick = useStableCallback(
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

  // الطباعة متاحة فقط لفاتورة محفوظة، وخارج عمليات الحفظ أو الإغلاق الجارية.
  const canPrint = draft.invoiceId !== null && !draft.isSavingLine && !draft.isClosing;

  return (
    <div style={{ padding: "28px 32px" }}>
      {/* بطاقة الإدخال: رأس (التاجر + رقم الفاتورة للعرض) ثم نموذج البند */}
      <div style={CARD_STYLE}>
        <InvoiceHeader
          merchantName={draft.merchantName}
          merchantId={draft.merchantId}
          invoiceNumber={draft.invoiceId !== null ? draft.invoiceNumberInput : ""}
          suggestions={merchantSuggestions}
          onMerchantChange={handleMerchantChange}
          onMerchantSelect={handleMerchantSelect}
        />

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
            {draft.rows.map((row, i) => (
              <InvoiceRowView
                key={row.id}
                row={row}
                index={i}
                isSelected={selectedIds.has(row.id)}
                disabled={draft.isSavingLine}
                onRowClick={handleRowClick}
                onDuplicate={handleDuplicateRow}
                onDelete={deleteRow}
              />
            ))}

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

      {/* الطباعة مستقلة عن إغلاق الفاتورة أو التبويبة. */}
      <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
        <button
          onClick={() => onPrintInvoice()}
          disabled={!canPrint}
          style={{
            backgroundColor: "white",
            color: !canPrint ? "#94A3B8" : "#1E293B",
            border: `2px solid ${!canPrint ? "#CBD5E1" : "#64748B"}`,
            borderRadius: "8px",
            padding: "14px 32px",
            fontSize: "16px",
            fontWeight: 700,
            cursor: !canPrint ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "9px",
            fontFamily: "'Cairo', sans-serif",
          }}
        >
          <Printer size={18} />
          طباعة
        </button>
        <button
          onClick={() => onPrintInvoice(true)}
          disabled={!canPrint}
          style={{
            backgroundColor: "#ECFDF5",
            color: !canPrint ? "#94A3B8" : "#047857",
            border: `2px solid ${!canPrint ? "#CBD5E1" : "#6EE7B7"}`,
            borderRadius: "8px",
            padding: "14px 24px",
            fontSize: "16px",
            fontWeight: 700,
            cursor: !canPrint ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "9px",
            fontFamily: "'Cairo', sans-serif",
          }}
        >
          <Printer size={18} />
          طباعة مع الملخّص
        </button>
      </div>
    </div>
  );
}
