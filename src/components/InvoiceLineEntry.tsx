/* eslint-disable react-refresh/only-export-components */
import { useMemo, useCallback, useState, memo, type CSSProperties } from "react";
import { Plus, Tag, Scale, Banknote } from "lucide-react";
import type { DraftBox, DraftRow } from "./invoice";
import { StaleReferenceError, type Product } from "../services/db";
import {
  formStyles as c,
  FieldLabel,
  FIELD_CSS,
  FIELD_VARS,
  round2,
  Autocomplete,
  MoneyInput,
  useStableCallback,
  type Suggestion,
  safeEvaluateExpression,
} from "./InvoiceShared";

// ─── InvoiceLineEntry ────────────────────────────────────────────────────────
// مكوّن "إضافة بند جديد" — يطبّق بالضبط نفس منطق الوزن/الصناديق الموصوف في
// AI_CONTEXT.md القسم 6.1:
//   1. الوزّان يكتب الوزن المُدرَج على الميزان.
//   2. يحدد عدد كل نوع صندوق مستخدَم (عدد صحيح).
//   3. وزن الصناديق الفارغة = مجموع (عدد كل نوع × وزنه الفارغ).
//   4. الوزن الصافي = الوزن المُدرَج − وزن الصناديق الفارغة.
//   5. إذا فاق وزن الصناديق الوزن المُدرَج: رسالة تحذير حمراء + تعطيل الإدراج.
//   6. يلزم اسم منتج مكتوب وتاجر محدَّد فعلياً (merchantSelected) لتفعيل الإدراج.
//   7. الإدراج الآن عملية غير متزامنة تصل فعلياً لقاعدة البيانات (onInsert)؛
//      تصفير الحقول يحدث فقط عند نجاحها — لا فوراً عند الضغط.
//
// يُستخدَم من InvoiceForm.tsx (الصفحة الرئيسية) لكل من إنشاء فاتورة جديدة
// وتعديل فاتورة محفوظة — مسار واحد موحَّد بلا تكرار (الجزء الثاني من المهمة).

export interface EntryState {
  productInput: string;
  productId?: number;
  scaleWeightInput: string;
  // سعر الكيلوغرام: أرقام فقط = دنانير كاملة، بلا فواصل ولا كسر ("1000" تعني
  // 1.000,00 دج — السنتيم ",00" تُضاف دائماً، راجع MoneyInput في InvoiceShared.tsx)
  priceInput: string;
  boxes: DraftBox[];
}

// بناء حالة إدخال فارغة من قائمة الصناديق — بنفس نمط makeDraft في
// InvoiceManager.tsx (لكن للجزء الخاص بسطر واحد فقط، لا فاتورة كاملة).
export function emptyEntry(
  boxes: { id: number; name: string; weight: number }[],
): EntryState {
  return {
    productInput: "",
    scaleWeightInput: "",
    priceInput: "",
    boxes: boxes.map((b) => ({
      id: b.id,
      name: b.name,
      emptyWeight: b.weight,
      countInput: 0,
    })),
  };
}

// ─── حقل عدد الصناديق: أرقام و + و − فقط ─────────────────────────────────
// القيمة المعتمدة في الـ draft تبقى عدداً صحيحاً ≥ 0. أما نص الحقل أثناء الكتابة فقد ينتهي
// بعلامة معلَّقة ("5+") ولا يُحفَظ إلا محلياً داخل البطاقة.
// السقف 6 خانات: يمنع أن يتحول عدد ضخم إلى صيغة علمية ("1e+21") تدخل فيها علامة +.
const BOX_COUNT_MAX_DIGITS = 6;
const BOX_COUNT_MAX = 999999;

const clampBoxCount = (n: number) => Math.min(Math.max(n, 0), BOX_COUNT_MAX);

// تُنفَّذ العملية فور اكتمال طرفيها ("1+1" ← "2")، ويبقى آخر علامة معلَّقة ("2+").
// علامة قبل أي رقم تُهمَل، وعلامتان متتاليتان: الأخيرة تغلب. الناتج السالب يصير 0.
function evaluateBoxCountInput(raw: string): { text: string; count: number } {
  const tokens = raw.replace(/[^0-9+-]/g, "").match(/\d+|[+-]/g) ?? [];
  let acc: number | null = null;
  let op: "+" | "-" | null = null;

  for (const tok of tokens) {
    if (tok === "+" || tok === "-") {
      if (acc !== null) op = tok;
      continue;
    }
    const n = Number(tok.replace(/^0+(?=\d)/, "").slice(0, BOX_COUNT_MAX_DIGITS));
    acc = acc === null || op === null ? n : clampBoxCount(op === "+" ? acc + n : acc - n);
    op = null;
  }

  return { text: acc === null ? "" : `${acc}${op ?? ""}`, count: acc ?? 0 };
}

// ─── بطاقة صندوق واحد ────────────────────────────────────────────────────────
// memo: عند الكتابة في أي حقل آخر (منتج، وزن، سعر) أو تغيير عدد صندوق آخر لا
// تتغير بيانات هذه البطاقة (الكائن box يحتفظ بهويته في updateBox)، فلا يُعاد
// رسمها.
const BoxCard = memo(function BoxCard({
  box,
  onCountChange,
}: {
  box: DraftBox;
  onCountChange: (boxId: number, val: string) => void;
}) {
  const active = box.countInput > 0;
  // الوزن الكلي لهذا النوع = وزن الصندوق الفارغ × العدد المُدخل (بنفس round2 المستخدمة في بقية الشاشة)
  const totalWeight = round2(box.emptyWeight * box.countInput);
  // يُخفى عند عدد فارغ/0، وكذلك لو كان وزن الصندوق الفارغ 0 (لا فائدة من عرض "0 كغ")
  const showTotal = active && totalWeight > 0;

  // النص المؤقت أثناء الكتابة (مثل "5+"). null = غير قيد التحرير، فيُعرَض العدد المعتمد.
  // محلي للبطاقة وحدها، فلا يُعاد رسم غيرها عند كتابة علامة معلَّقة.
  const [draftText, setDraftText] = useState<string | null>(null);
  const shown = draftText ?? (box.countInput > 0 ? String(box.countInput) : "");

  return (
    <div
      className="le-box-card"
      title={box.name}
      style={{
        minWidth: 0,
        padding: "10px 8px",
        borderRadius: "10px",
        border: active ? "1.5px solid #0F766E" : "1.5px solid #E2E8F0",
        backgroundColor: active ? "#F0FDFA" : "#FFFFFF",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div
        style={{
          minWidth: 0,
          minHeight: "48px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: active ? "#134E4A" : "#1E293B",
          fontSize: "20px",
          fontWeight: 800,
          lineHeight: "26px",
          textAlign: "center",
          overflowWrap: "anywhere",
        }}
      >
        {box.name}
      </div>

      {/* فتحة ثابتة الارتفاع بين الاسم وخانة العدد: تبقى محجوزة حتى حين يكون النص مخفياً،
          فلا تقفز البطاقات ولا يتغيّر ارتفاع الصفوف أثناء الكتابة.
          الهامش السالب يعوّض جزءاً من مسافتَي gap حول الفتحة كي لا يتضخّم ارتفاع البطاقة. */}
      <div
        aria-hidden={!showTotal}
        title={showTotal ? `الإجمالي: ${totalWeight} كغ` : undefined}
        style={{
          height: "18px",
          margin: "-3px 0",
          fontSize: "12px", // يعادل text-xs
          lineHeight: "18px",
          fontWeight: 600,
          color: "#0F766E",
          textAlign: "center",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {showTotal && (
          <>
            الإجمالي: <bdi>{totalWeight}</bdi> كغ
          </>
        )}
      </div>

      {/* العدد: أرقام و + و − فقط، وتُنفَّذ العملية فور اكتمال طرفيها.
          ↑/↓ للزيادة والإنقاص بالكيبورد */}
      <input
        className="le-box-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={`عدد ${box.name}`}
        value={shown}
        placeholder="0"
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          let raw = e.target.value.replace(/[^0-9+-]/g, "");
          // الحقل يُحدَّد بالكامل عند التركيز، فضغط "+" أو "-" وحدها كان سيمسح العدد.
          // نكمل من الرقم الحالي بدل ذلك ("5" ثم "+" ← "5+").
          if (raw === "+" || raw === "-") {
            const base = /^\d+/.exec(shown)?.[0];
            if (base) raw = base + raw;
          }
          const { text, count } = evaluateBoxCountInput(raw);
          setDraftText(text);
          if (count !== box.countInput) onCountChange(box.id, String(count));
        }}
        onBlur={(e) => {
          // الحساب النهائي من نص الحقل نفسه، ثم إسقاط أي علامة معلَّقة ("2+" ← "2")
          const { count } = evaluateBoxCountInput(e.currentTarget.value);
          if (count !== box.countInput) onCountChange(box.id, String(count));
          setDraftText(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const next = clampBoxCount(box.countInput + (e.key === "ArrowUp" ? 1 : -1));
            setDraftText(null); // يعرض العدد المعتمد ويُسقط أي علامة معلَّقة
            if (next !== box.countInput) onCountChange(box.id, String(next));
          }
        }}
        style={{
          width: "100%",
          height: "38px",
          boxSizing: "border-box",
          borderRadius: "8px",
          border: active ? "1.5px solid #0F766E" : "1.5px solid #CBD5E1",
          backgroundColor: "#FFFFFF",
          color: "#0F172A",
          fontSize: "17px",
          fontWeight: 700,
          textAlign: "center",
          direction: "ltr",
          fontFamily: "'Cairo', sans-serif",
        }}
      />
    </div>
  );
});

// ─── التخطيط (CSS فقط: لا state ولا مستمعات resize) ─────────────────────────
// • في RTL أول عنصر في DOM يظهر يميناً: الحقول أولاً (يمين) ثم الصناديق (يسار).
// • الصناديق: 4 في السطر، و3 حين يضيق عرض العمود نفسه (container query لا عرض النافذة).
// • الارتفاع: يتبع ارتفاع الشاشة بين 360 و600px (نحو 4 صفوف كاملة)؛ ما زاد يُمرَّر بالـ scroll.
// • أقل من 1100px (النافذة كلها): يُكدَّس العمودان.
const LINE_ENTRY_CSS = `
  .le-row {
    --le-action-h: 60px;  /* ارتفاع زر الإدراج وبطاقة وزن الصناديق الفارغة معاً */
    --le-pad: 14px;       /* حشوة لوحة الصناديق */
    --le-border: 1px;     /* حدّ لوحة الصناديق */
    display: flex; align-items: stretch; gap: 24px;
  }
  /* الحشوة السفلية = حشوة اللوحة + حدّها، فيقع الزر على خط البطاقة نفسه */
  .le-fields {
    flex: 2 1 340px; min-width: 0; display: flex; flex-direction: column; gap: 16px;
    padding-bottom: calc(var(--le-pad) + var(--le-border));
  }
  .le-boxes {
    flex: 3 1 520px; min-width: 0; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 12px; padding: var(--le-pad);
    background-color: #F8FAFC; border: var(--le-border) solid #E2E8F0; border-radius: 12px;
  }
  .le-box-scroll {
    flex: 1 1 auto; min-height: 0;
    max-height: clamp(360px, calc(100vh - 340px), 600px);
    overflow-y: auto; margin: -2px; padding: 2px;
    container-type: inline-size;
  }
  .le-box-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  @container (max-width: 480px) {
    .le-box-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  @media (max-width: 1100px) {
    .le-row { flex-direction: column; }
    .le-fields, .le-boxes { flex: 0 0 auto; }
    .le-fields { padding-bottom: 0; }
  }
  .le-box-input:focus { outline: 2px solid #2563EB; outline-offset: 1px; }
  .le-box-card { transition: background-color .12s, border-color .12s; }
  @media (prefers-reduced-motion: reduce) { .le-box-card { transition: none; } }
  ${FIELD_CSS}
`;

const feedbackBase: CSSProperties = {
  padding: "12px 16px",
  borderRadius: "8px",
  fontSize: "15px",
  fontWeight: 600,
};
const insertBtnBase: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: "var(--le-action-h)",
  color: "white",
  border: "none",
  borderRadius: "10px",
  fontSize: "17px",
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "10px",
  fontFamily: "'Cairo', sans-serif",
  transition: "all 0.15s",
};

const ui = {
  savedNote: { marginTop: "6px", fontSize: "14px", fontWeight: 600, color: "#047857" },
  weightError: { ...feedbackBase, marginTop: "8px", backgroundColor: "#FEF2F2", border: "2px solid #FECACA", color: "#B91C1C" },
  weightOk: { ...feedbackBase, marginTop: "8px", backgroundColor: "#F0FDF4", border: "2px solid #BBF7D0", color: "#166534" },
  insertArea: { marginTop: "auto", paddingTop: "4px" },
  insertError: { ...feedbackBase, marginBottom: "12px", backgroundColor: "#FEF2F2", border: "2px solid #FECACA", color: "#B91C1C" },
  insertBtn: { ...insertBtnBase, backgroundColor: "#2563EB", cursor: "pointer", boxShadow: "0 4px 14px rgba(37,99,235,0.35)" },
  insertBtnOff: { ...insertBtnBase, backgroundColor: "#93C5FD", cursor: "not-allowed", boxShadow: "none" },
  panelHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: "24px" },
  panelTitle: { color: "#0F172A", fontSize: "15px", fontWeight: 700 },
  resetBtn: { border: "none", background: "none", color: "#B91C1C", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "'Cairo', sans-serif", padding: "2px 6px" },
  emptyNote: { padding: "16px", textAlign: "center", color: "#475569", fontSize: "14px" },
  totalBar: { display: "flex", justifyContent: "space-between", alignItems: "center", boxSizing: "border-box", height: "var(--le-action-h)", marginTop: "auto", padding: "0 14px", backgroundColor: "#0F766E", borderRadius: "10px", color: "#FFFFFF" },
  totalTitle: { fontSize: "14px", fontWeight: 700 },
  totalSub: { fontSize: "12px", color: "#CCFBF1" },
  totalValue: { fontSize: "20px", fontWeight: 700, direction: "ltr" },
} satisfies Record<string, CSSProperties>;

// memo: props كلها قيم بسيطة أو دوال ثابتة الهوية، و`boxes` يحتفظ بهويته ما لم يتغيّر
// عدد صندوق. فلا تُعاد رسم اللوحة (ولا حلقة map على الصناديق) أثناء الكتابة في
// المنتج/الوزن/السعر، بل فقط عند تغيير عدد صندوق أو تصفيرها.
const BoxesPanel = memo(function BoxesPanel({
  boxes,
  totalBoxCount,
  totalEmptyWeight,
  onCountChange,
  onReset,
}: {
  boxes: DraftBox[];
  totalBoxCount: number;
  totalEmptyWeight: number;
  onCountChange: (boxId: number, val: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="le-boxes">
      <div style={ui.panelHeader}>
        <span style={ui.panelTitle}>الصناديق</span>
        {totalBoxCount > 0 && (
          <button type="button" onClick={onReset} style={ui.resetBtn}>
            تصفير الكل
          </button>
        )}
      </div>

      <div className="le-box-scroll">
        {boxes.length > 0 ? (
          <div className="le-box-grid">
            {boxes.map((box) => (
              <BoxCard key={box.id} box={box} onCountChange={onCountChange} />
            ))}
          </div>
        ) : (
          <div style={ui.emptyNote}>لا توجد صناديق — أضف صناديق من صفحة الصناديق</div>
        )}
      </div>

      <div style={ui.totalBar}>
        <div>
          <div style={ui.totalTitle}>وزن الصناديق الفارغة</div>
          <div style={ui.totalSub}>{totalBoxCount} صندوق</div>
        </div>
        <span style={ui.totalValue}>{round2(totalEmptyWeight).toFixed(2)} كغ</span>
      </div>
    </div>
  );
});

interface InvoiceLineEntryProps {
  entry: EntryState;
  onChange: (patch: Partial<EntryState>) => void;
  onInsert: (row: DraftRow) => Promise<void>;
  isBusy: boolean;
  merchantSelected: boolean;
  products: Product[];
}

export function InvoiceLineEntry({
  entry,
  onChange,
  onInsert,
  isBusy,
  merchantSelected,
  products,
}: InvoiceLineEntryProps) {
  const [insertError, setInsertError] = useState<string | null>(null);
  // رسالة خطأ خاصة بتقييم حقل "الوزن المُدرَج على الميزان" عند كتابة تعبير
  // حسابي غير صالح (محارف غير مدعومة، صياغة خاطئة، قسمة على صفر، ناتج سالب).
  // منفصلة عن insertError (أخطاء الحفظ في القاعدة)، وتُصفَّر أيضاً مع أي
  // تعديل لأي حقل عبر handleFieldChange (نفس نمط insertError أدناه).
  const [weightInputError, setWeightInputError] = useState<string | null>(null);

  const productSuggestions: Suggestion[] = useMemo(
    () =>
      products.map((p) => ({
        id: p.id,
        label: p.name,
        labelLower: p.name.toLowerCase(),
      })),
    [products],
  );

  // كل تغيير حقل يُصفِّر رسالة خطأ الإدراج السابقة (كما هو مطلوب)، عبر تمرير
  // كل تعديلات الحقول من هنا بدل استدعاء onChange مباشرة.
  const handleFieldChange = useCallback(
    (patch: Partial<EntryState>) => {
      setInsertError(null);
      setWeightInputError(null);
      onChange(patch);
    },
    [onChange],
  );

  // يُستدعى عند onBlur لحقل الوزن المُدرَج، أو عند ضغط Enter داخله (القاعدة
  // المطلوبة: تقييم عند خروج التركيز أو Enter، لا مع كل ضغطة حرف).
  // - نص فارغ: لا شيء يُقيَّم، لا خطأ.
  // - رقم مباشر بسيط (بلا عمليات): يُترَك كما هو دون تغيير — "يُعامل كقيمة
  //   نموذجية للوزن" كما هو مطلوب.
  // - غير ذلك: يُمرَّر لـ safeEvaluateExpression (آمن تماماً، بلا eval).
  //   نتيجة null → تعبير غير صالح. نتيجة سالبة → مرفوضة لأن الوزن لا يمكن أن
  //   يكون سالباً. في الحالتين يبقى النص كما كتبه المستخدم (لا فقدان لما
  //   كتبه، بنفس فلسفة معالجة أخطاء الإدراج في هذا الملف) مع رسالة توضيحية،
  //   ويُمنع "إدراج السطر" (canInsert أدناه) حتى يصحَّح.
  const evaluateScaleWeightInput = useCallback(() => {
    const raw = entry.scaleWeightInput;
    if (!raw.trim()) {
      setWeightInputError(null);
      return;
    }

    if (/^\d+(\.\d+)?$/.test(raw.trim())) {
      // رقم مباشر صحيح/عشري — لا حاجة لتقييم تعبير
      setWeightInputError(null);
      return;
    }

    const result = safeEvaluateExpression(raw);

    if (result === null) {
      setWeightInputError("تعبير غير صالح — تحقّق من الأرقام والعمليات المكتوبة");
      return;
    }
    if (result < 0) {
      setWeightInputError("لا يمكن أن يكون ناتج الوزن سالباً");
      return;
    }

    setWeightInputError(null);
    onChange({ scaleWeightInput: String(round2(result)) });
  }, [entry.scaleWeightInput, onChange]);

  const handleScaleWeightKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        evaluateScaleWeightInput();
      }
    },
    [evaluateScaleWeightInput],
  );

  // هوية ثابتة (useStableCallback) كي تعمل memo على BoxCard؛ الجسم يقرأ دائماً
  // أحدث entry.boxes. الكائنات غير المعدَّلة تحتفظ بهويتها في map.
  const updateBox = useStableCallback((boxId: number, val: string) =>
    handleFieldChange({
      boxes: entry.boxes.map((b) =>
        b.id === boxId
          ? { ...b, countInput: Math.max(0, Math.floor(Number(val) || 0)) }
          : b,
      ),
    }),
  );

  const scaleWeight = useMemo(
    () => parseFloat(entry.scaleWeightInput) || 0,
    [entry.scaleWeightInput],
  );
  const scaleWeightEntered = entry.scaleWeightInput.trim() !== "";

  const totalEmptyWeight = useMemo(
    () => entry.boxes.reduce((sum, b) => sum + b.countInput * b.emptyWeight, 0),
    [entry.boxes],
  );

  const totalBoxCount = useMemo(
    () => entry.boxes.reduce((sum, b) => sum + b.countInput, 0),
    [entry.boxes],
  );

  const resetBoxes = useCallback(
    () => handleFieldChange({ boxes: entry.boxes.map((b) => ({ ...b, countInput: 0 })) }),
    [entry.boxes, handleFieldChange],
  );

  const boxesExceedScale = scaleWeightEntered && totalEmptyWeight > scaleWeight;

  const netWeight = useMemo(
    () => round2(scaleWeight - totalEmptyWeight),
    [scaleWeight, totalEmptyWeight],
  );

  // شرط اختيار التاجر إلزامي (نقطة 15 من مهمة الجزء الثاني): بلا تاجر محدَّد
  // فعلياً (merchantSelected) لا يُفعَّل الزر مهما كانت بقية الحقول صحيحة.
  const canInsert = Boolean(
    merchantSelected &&
      entry.productInput.trim() &&
      scaleWeightEntered &&
      !boxesExceedScale &&
      !weightInputError,
  );

  const handleProductChange = useCallback(
    (val: string) => handleFieldChange({ productInput: val, productId: undefined }),
    [handleFieldChange],
  );

  const handleProductSelect = useCallback(
    (label: string, id?: number) =>
      handleFieldChange({ productInput: label, productId: id }),
    [handleFieldChange],
  );

  const handleInsert = useCallback(async () => {
    if (!canInsert || isBusy) {
      return;
    }

    const row: DraftRow = {
      id: Date.now() + Math.random(), // معرّف محلي مؤقت — يُستبدَل بمعرّف حقيقي من القاعدة بعد نجاح onInsert
      product: entry.productInput,
      productId: entry.productId ?? null,
      weight: netWeight,
      price: Number(entry.priceInput) || 0, // أرقام فقط (دنانير كاملة) — انظر EntryState
      boxesSnapshot: entry.boxes
        .filter((b) => b.countInput > 0)
        .map((b) => ({ id: b.id, boxCount: b.countInput, name: b.name })),
    };

    try {
      await onInsert(row);

      // تصفير الحقول فقط في حالة النجاح
      setInsertError(null);
      onChange({
        productInput: "",
        productId: undefined,
        scaleWeightInput: "",
        priceInput: "",
        boxes: entry.boxes.map((b) => ({ ...b, countInput: 0 })),
      });
    } catch (error) {
      console.error("خطأ أثناء إدراج البند:", error);
      // رسالة StaleReferenceError مصمَّمة أصلاً لتُعرَض مباشرة للمستخدم (تشرح
      // بالضبط أن تاجراً أو صندوقاً استُخدِم هنا حُذف في الأثناء)؛ أي خطأ آخر
      // (تقني بحت) يبقى بالرسالة العامة كما كانت.
      setInsertError(
        error instanceof StaleReferenceError
          ? error.message
          : "تعذر إدراج البند، يرجى المحاولة مرة أخرى.",
      );
    }
  }, [entry, netWeight, canInsert, isBusy, onInsert, onChange]);

  const insertDisabled = !canInsert || isBusy;

  return (
    <>
      <style>{LINE_ENTRY_CSS}</style>

      <div className="le-row">
        {/* يمين الشاشة (RTL): الحقول الدائمة، وزر الإدراج مثبَّت أسفل العمود */}
        <div className="le-fields">
          <div className="le-f" style={FIELD_VARS}>
            <FieldLabel icon={<Tag size={17} />}>اسم المنتج</FieldLabel>
            <Autocomplete
              value={entry.productInput}
              onChange={handleProductChange}
              onSelect={handleProductSelect}
              suggestions={productSuggestions}
              placeholder="أدخل اسم المنتج مباشرة أو اختر المقترح..."
            />
            {entry.productId && <div style={ui.savedNote}>✓ منتج محفوظ</div>}
          </div>

          <div className="le-f" style={FIELD_VARS}>
            <FieldLabel icon={<Scale size={17} />}>الوزن المُدرَج على الميزان (كغ)</FieldLabel>
            <input
              type="text"
              inputMode="decimal"
              style={c.input}
              placeholder="مثال: 100 أو 10+20+30"
              value={entry.scaleWeightInput}
              onChange={(e) => handleFieldChange({ scaleWeightInput: e.target.value })}
              onBlur={evaluateScaleWeightInput}
              onKeyDown={handleScaleWeightKeyDown}
            />
            {weightInputError && <div style={ui.weightError}>⚠ {weightInputError}</div>}
            {!weightInputError && scaleWeightEntered && boxesExceedScale && (
              <div style={ui.weightError}>
                ⚠ وزن الصناديق ({round2(totalEmptyWeight).toFixed(2)} كغ)
                يفوق الوزن المُدرَج على الميزان ({scaleWeight.toFixed(2)}{" "}
                كغ) — صحّح عدد الصناديق أو الوزن المُدرَج قبل الإدراج
              </div>
            )}
            {!weightInputError && scaleWeightEntered && !boxesExceedScale && (
              <div style={ui.weightOk}>
                الوزن الصافي: <strong>{netWeight.toFixed(2)} كغ</strong> —
                سيُسجَّل مع هذا السطر
              </div>
            )}
          </div>

          <div className="le-f" style={FIELD_VARS}>
            <FieldLabel icon={<Banknote size={17} />}>سعر المنتج (دج/كغ)</FieldLabel>
            <MoneyInput
              value={entry.priceInput}
              onChange={(digits) => handleFieldChange({ priceInput: digits })}
            />
          </div>

          <div style={ui.insertArea}>
            {insertError && <div style={ui.insertError}>⚠ {insertError}</div>}
            <button
              onClick={handleInsert}
              disabled={insertDisabled}
              style={insertDisabled ? ui.insertBtnOff : ui.insertBtn}
            >
              <Plus size={20} strokeWidth={2.5} />
              {isBusy ? "جارٍ الإدراج..." : "إدراج السطر"}
            </button>
          </div>
        </div>

        {/* يسار الشاشة: الصناديق */}
        <BoxesPanel
          boxes={entry.boxes}
          totalBoxCount={totalBoxCount}
          totalEmptyWeight={totalEmptyWeight}
          onCountChange={updateBox}
          onReset={resetBoxes}
        />
      </div>
    </>
  );
}
