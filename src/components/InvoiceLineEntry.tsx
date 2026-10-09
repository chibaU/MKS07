/* eslint-disable react-refresh/only-export-components */
import { useMemo, useCallback, useState, memo } from "react";
import { Plus, Package, Tag, Scale, Banknote } from "lucide-react";
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

// بناء حالة إدخال فارغة من قائمة الصناديق النشطة — بنفس نمط makeDraft في
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

// ─── بطاقة صندوق واحد ────────────────────────────────────────────────────────
// memo: عند الكتابة في أي حقل آخر (منتج، وزن، سعر) أو تغيير عدد صندوق آخر لا
// تتغير بيانات هذه البطاقة (الكائن box يحتفظ بهويته في updateBox)، فلا يُعاد
// رسمها. كان كل حرف يُكتب يُعيد رسم كل البطاقات بأيقوناتها.
const BoxCard = memo(function BoxCard({
  box,
  onCountChange,
}: {
  box: DraftBox;
  onCountChange: (boxId: number, val: string) => void;
}) {
  const active = box.countInput > 0;
  return (
    <div
      className="le-box-card"
      title={`${box.name} — فارغ: ${box.emptyWeight} كغ`}
      style={{
        minWidth: 0,
        padding: "10px",
        borderRadius: "10px",
        border: active ? "1.5px solid #0F766E" : "1.5px solid #E2E8F0",
        backgroundColor: active ? "#F0FDFA" : "#FFFFFF",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "7px" }}>
          <Package
            size={20}
            strokeWidth={2}
            aria-hidden="true"
            style={{ flexShrink: 0, marginTop: "2px", color: active ? "#0F766E" : "#94A3B8" }}
          />
          <div
            style={{
              minWidth: 0,
              color: active ? "#134E4A" : "#1E293B",
              fontSize: "18px",
              fontWeight: 700,
              lineHeight: "24px",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              wordBreak: "break-word",
            }}
          >
            {box.name}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "6px",
            fontSize: "12px",
            lineHeight: "16px",
            color: "#64748B",
            fontWeight: 500,
          }}
        >
          <span>فارغ: {box.emptyWeight} كغ</span>
          {active && (
            <span style={{ color: "#0F766E", fontWeight: 700 }}>
              {round2(box.countInput * box.emptyWeight).toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* العدد: كتابة مباشرة، و↑/↓ للزيادة والإنقاص بالكيبورد */}
      <input
        className="le-box-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={`عدد ${box.name}`}
        value={box.countInput || ""}
        placeholder="0"
        onFocus={(e) => e.target.select()}
        onChange={(e) => onCountChange(box.id, e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onCountChange(box.id, String(box.countInput + (e.key === "ArrowUp" ? 1 : -1)));
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
          fontFamily: "'Cairo', sans-serif",
        }}
      />
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
    <div>
      <div style={{ display: "flex", gap: "24px" }}>
        {/* عمود الصناديق */}
        <style>{`
          .le-box-input:focus { outline: 2px solid #2563EB; outline-offset: 1px; }
          .le-box-card { transition: background-color .12s, border-color .12s; }
          @media (prefers-reduced-motion: reduce) { .le-box-card { transition: none; } }
          ${FIELD_CSS}
        `}</style>
        <div
          style={{
            width: "360px",
            flexShrink: 0,
            backgroundColor: "#F8FAFC",
            borderRadius: "12px",
            border: "1px solid #E2E8F0",
            padding: "14px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: "24px" }}>
            <span style={{ color: "#0F172A", fontSize: "15px", fontWeight: 700 }}>الصناديق</span>
            {totalBoxCount > 0 && (
              <button
                type="button"
                onClick={resetBoxes}
                style={{
                  border: "none",
                  background: "none",
                  color: "#B91C1C",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "'Cairo', sans-serif",
                  padding: "2px 6px",
                }}
              >
                تصفير الكل
              </button>
            )}
          </div>

          <div style={{ maxHeight: "340px", overflowY: "auto", margin: "-2px", padding: "2px" }}>
            {entry.boxes.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
                {entry.boxes.map((box) => (
                  <BoxCard key={box.id} box={box} onCountChange={updateBox} />
                ))}
              </div>
            ) : (
              <div style={{ padding: "16px", textAlign: "center", color: "#475569", fontSize: "14px" }}>
                لا توجد صناديق نشطة — أضف صناديق من صفحة الصناديق
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 14px",
              backgroundColor: "#0F766E",
              borderRadius: "10px",
              color: "#FFFFFF",
            }}
          >
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700 }}>وزن الصناديق الفارغة</div>
              <div style={{ fontSize: "12px", color: "#CCFBF1" }}>{totalBoxCount} صندوق</div>
            </div>
            <span style={{ fontSize: "20px", fontWeight: 700, direction: "ltr" }}>
              {round2(totalEmptyWeight).toFixed(2)} كغ
            </span>
          </div>
        </div>

        {/* عمود المنتج */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div className="le-f" style={FIELD_VARS}>
            <FieldLabel icon={<Tag size={17} />}>اسم المنتج</FieldLabel>
            <Autocomplete
              value={entry.productInput}
              onChange={handleProductChange}
              onSelect={handleProductSelect}
              suggestions={productSuggestions}
              placeholder="أدخل اسم المنتج مباشرة أو اختر المقترح..."
            />
            {entry.productId && (
              <div
                style={{ marginTop: "6px", fontSize: "14px", fontWeight: 600, color: "#047857" }}
              >
                ✓ منتج محفوظ
              </div>
            )}
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
            {weightInputError && (
              <div
                style={{
                  marginTop: "8px",
                  padding: "12px 16px",
                  backgroundColor: "#FEF2F2",
                  border: "2px solid #FECACA",
                  borderRadius: "8px",
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#B91C1C",
                }}
              >
                ⚠ {weightInputError}
              </div>
            )}
            {!weightInputError && scaleWeightEntered && boxesExceedScale && (
              <div
                style={{
                  marginTop: "8px",
                  padding: "12px 16px",
                  backgroundColor: "#FEF2F2",
                  border: "2px solid #FECACA",
                  borderRadius: "8px",
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#B91C1C",
                }}
              >
                ⚠ وزن الصناديق ({round2(totalEmptyWeight).toFixed(2)} كغ)
                يفوق الوزن المُدرَج على الميزان ({scaleWeight.toFixed(2)}{" "}
                كغ) — صحّح عدد الصناديق أو الوزن المُدرَج قبل الإدراج
              </div>
            )}
            {!weightInputError && scaleWeightEntered && !boxesExceedScale && (
              <div
                style={{
                  marginTop: "8px",
                  padding: "12px 16px",
                  backgroundColor: "#F0FDF4",
                  border: "2px solid #BBF7D0",
                  borderRadius: "8px",
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#166534",
                }}
              >
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
        </div>
      </div>

      {insertError && (
        <div
          style={{
            marginTop: "14px",
            padding: "12px 16px",
            backgroundColor: "#FEF2F2",
            border: "2px solid #FECACA",
            borderRadius: "8px",
            fontSize: "15px",
            fontWeight: 600,
            color: "#B91C1C",
          }}
        >
          ⚠ {insertError}
        </div>
      )}

      <button
        onClick={handleInsert}
        disabled={insertDisabled}
        style={{
          width: "100%",
          height: "56px",
          backgroundColor: insertDisabled ? "#93C5FD" : "#2563EB",
          color: "white",
          border: "none",
          borderRadius: "10px",
          fontSize: "17px",
          fontWeight: 700,
          cursor: insertDisabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          fontFamily: "'Cairo', sans-serif",
          marginTop: "14px",
          boxShadow: insertDisabled ? "none" : "0 4px 14px rgba(37,99,235,0.35)",
          transition: "all 0.15s",
        }}
      >
        <Plus size={20} strokeWidth={2.5} />
        {isBusy ? "جارٍ الإدراج..." : "إدراج السطر"}
      </button>
    </div>
  );
}
