/* eslint-disable react-refresh/only-export-components */
import {
  useState,
  useRef,
  useEffect,
  useMemo,
  memo,
  type ChangeEvent,
  type ClipboardEvent,
} from "react";

// ─── وحدة مشتركة ─────────────────────────────────────────────────────────────
// هذا الملف يجمع القطع القابلة لإعادة الاستخدام دون علاقة بمنطق أعمال معيّن:
// أنماط تنسيق الحقول، دالة التقريب، نظام المال (formatMoney + MoneyInput)،
// ومكوّن الـ Autocomplete العام.
// تُستخدَم الآن من كل من InvoiceForm.tsx (الشاشة الموحَّدة لإنشاء/تعديل
// الفاتورة) وInvoiceLineEntry.tsx وHomePage.tsx — مصدر واحد مشترك بدل نسخ
// مكرَّرة من نفس الأنماط/المنطق (الجزء الثاني من المهمة: دمج شاشتي الإنشاء
// والتعديل، وحذف InvoiceEditPanel.tsx الذي كان يستخدمها سابقاً بمفرده).

// نفس كائن الأنماط (c) المُعرَّف في InvoiceForm.tsx — يُصدَّر هنا باسم formStyles
export const formStyles = {
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
} as const;

// تقريب موحّد لمنزلتين عشريتين — نفس المنطق المستخدَم في
// InvoiceForm.tsx و HomePage.tsx (القسم 6.1 من AI_CONTEXT.md).
export const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── نظام المال: دج بالسنتيم ────────────────────────────────────────────────
// نظام جزائري: كل مبلغ في التطبيق يُعرض بصيغة موحَّدة واحدة — فاصل آلاف "."،
// فاصلة عشرية ","، ومنزلتان عشريتان دائماً (السنتيم):  100.000,00
//
// • العرض: أي مبلغ (الفاتورة، الأرشيف، الطباعة) يمر عبر formatMoney حصراً —
//   لا toFixed ولا toLocaleString لأي مبلغ. الدالة مكتوبة يدوياً عمداً (بلا Intl)
//   كي لا يتغيّر الناتج باختلاف بيانات اللغة المثبَّتة في WebView2 على Windows.
// • الإدخال: المستخدم يكتب الدنانير الكاملة فقط، والسنتيم ",00" تُضاف دائماً
//   ولا يكتبها (100 ← 100,00 ، 1000 ← 1.000,00) — انظر MoneyInput أدناه.
// • التخزين لم يتغيّر: REAL بالدينار مقرَّب لمنزلتين عبر round2؛ لا migration.

// أقصى عدد أرقام لمبلغ مُدخَل (9 أرقام = حتى 999.999.999 دج) — يبقي الحساب
// (وزن × سعر ثم الجمع) بعيداً عن حدود دقة الأعداد العشرية بفارق كبير.
export const MONEY_MAX_DIGITS = 9;

// "1234567" → "1.234.567" (نص أرقام فقط بدون إشارة أو كسر)
export const groupThousands = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// صيغة العرض الموحَّدة لأي مبلغ: formatMoney(100000) → "100.000,00".
// نفس تقريب round2 تماماً (Math.round(n * 100)) كي يطابق المعروضُ المحفوظَ.
export function formatMoney(amount: number): string {
  if (!Number.isFinite(amount)) return "0,00";
  const centimes = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(centimes / 100);
  const fraction = centimes % 100;
  const sign = amount < 0 && centimes > 0 ? "-" : "";
  return `${sign}${groupThousands(String(whole))},${String(fraction).padStart(2, "0")}`;
}

// الأرقام الهندية (٠-٩) والفارسية (۰-۹) → لاتينية، بنفس الطول حرفاً بحرف
// (فيبقى موضع المؤشر صالحاً)، كي لا تُهمَل بصمت إن كتبها لوح مفاتيح عربي.
const toLatinDigits = (s: string): string =>
  s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) & 0xf));

// نص حقل المال الخام (بأي فواصل عرض) → أرقام صحيحة فقط، مع عدد الأرقام الواقعة
// يسار المؤشر بعد التنظيف (لاستعادة المؤشر بعد إعادة التنسيق). أي محرف غير رقمي
// (نقطة، فاصلة، حروف) يُتجاهَل: المستخدم لا يكتب الكسر أبداً.
// الأصفار البادئة تُحذف ("007" → "7") مع إبقاء "0" وحدها كقيمة صالحة.
export function parseMoneyInput(
  raw: string,
  caret: number,
): { digits: string; digitsLeftOfCaret: number } {
  const latin = toLatinDigits(raw);
  const allDigits = latin.replace(/\D/g, "");
  const before = latin.slice(0, caret).replace(/\D/g, "").length;
  const stripped = allDigits.replace(/^0+(?=\d)/, "");
  const removedLeadingZeros = allDigits.length - stripped.length;
  const digits = stripped.slice(0, MONEY_MAX_DIGITS);
  return {
    digits,
    digitsLeftOfCaret: Math.min(Math.max(before - removedLeadingZeros, 0), digits.length),
  };
}

// موضع المؤشر في النص المنسَّق بحيث يسبقه بالضبط digitCount رقماً.
function caretForDigitCount(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (formatted[i] >= "0" && formatted[i] <= "9") {
      seen++;
      if (seen === digitCount) return i + 1;
    }
  }
  return formatted.length;
}

// الدنانير الكاملة فقط من نص ملصوق: "1.500,00" و"1500.50" و"1.500" كلها ← "1500".
// خانة المال لا تقبل سنتيماً، والفصل هنا ضروري كي لا تُقرأ ",00" المنسوخة من
// مبلغ منسَّق كرقمين إضافيين (فيتضاعف المبلغ ×100 بصمت). فاصلة/نقطة يليها رقم أو
// رقمان في آخر النص = كسر يُهمَل؛ ثلاثة أرقام بعد الفاصل = فاصل آلاف.
function wholeDinarsFromText(text: string): string {
  const t = toLatinDigits(text).trim();
  const withoutFraction = t.replace(/[.,]\d{1,2}$/, "");
  return withoutFraction.replace(/\D/g, "");
}

interface MoneyInputProps {
  /** أرقام صحيحة فقط بلا فواصل — دنانير كاملة ("1000" تعني 1.000,00). */
  value: string;
  /** يُستدعى بالأرقام النظيفة فقط، لا بالنص المنسَّق. */
  onChange: (digits: string) => void;
  placeholder?: string;
}

// خانة إدخال مبلغ بالدينار: يكتب المستخدم الدنانير الكاملة فقط فتظهر فوراً
// بفواصل الآلاف (1000 → 1.000)، بينما ",00" (السنتيم) ثابتة تُعرَض بجانبها ولا
// تُكتَب — فهي جزء من النظام لا من الإدخال. الحالة الخارجية (value) أرقام فقط.
export function MoneyInput({ value, onChange, placeholder = "0" }: MoneyInputProps) {
  // نكتب النص المنسَّق وموضع المؤشر مباشرةً داخل معالج الحدث (متزامناً)، لا لاحقاً.
  // السبب: React يعيد تعيين قيمة الحقل المتحكَّم به بعد كل إعادة تنسيق فيقفز المؤشر
  // إلى آخره، وأي إصلاح مؤجَّل (requestAnimationFrame/effect) يتسابق مع ما يأتي
  // بعده — ضغطة أخرى أو تحديد (Ctrl+A) أو نقرة — فيُفسده (ثبت بالاختبار على
  // Chromium حقيقي: تحديد الكل ثم كتابة رقم كان يُلغي التحديد). هنا يطابق DOM
  // بالضبط ما سيرسمه React فلا يعيد كتابته ويبقى المؤشر في مكانه.
  const commit = (el: HTMLInputElement, digits: string, digitsLeft: number) => {
    const formatted = groupThousands(digits);
    if (el.value !== formatted) el.value = formatted;
    const pos = caretForDigitCount(formatted, digitsLeft);
    el.setSelectionRange(pos, pos);
    // إدخال لم يغيّر الأرقام (محرف غير رقمي تم تجاهله، صفر بادئ زائد، حذف فاصل
    // آلاف) = لا عملية: لا نستدعي onChange كي لا تُمسح رسائل الخطأ الظاهرة في
    // حقول أخرى (handleFieldChange).
    if (digits !== value) onChange(digits);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const { digits, digitsLeftOfCaret } = parseMoneyInput(
      el.value,
      el.selectionStart ?? el.value.length,
    );
    commit(el, digits, digitsLeftOfCaret);
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = wholeDinarsFromText(e.clipboardData.getData("text"));
    if (!pasted) return;

    // استبدال المحدَّد (أو الإدراج عند المؤشر) داخل الأرقام النظيفة.
    const el = e.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const countDigits = (text: string) => toLatinDigits(text).replace(/\D/g, "").length;
    const left = countDigits(el.value.slice(0, start));
    const right = countDigits(el.value.slice(end));
    const merged =
      value.slice(0, left) + pasted + (right > 0 ? value.slice(value.length - right) : "");

    const { digits, digitsLeftOfCaret } = parseMoneyInput(merged, left + pasted.length);
    commit(el, digits, digitsLeftOfCaret);
  };

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={groupThousands(value)}
        placeholder={placeholder}
        onChange={handleChange}
        onPaste={handlePaste}
        // إفلات نص بالسحب يتجاوز معالجة اللصق فيُقرأ "1.500,00" كـ150000 — يُمنع.
        onDrop={(e) => e.preventDefault()}
        // الأرقام تُقرأ يساراً-إلى-يمين حتى داخل صفحة RTL؛ محاذاة يمين مع حشوة
        // تفسح مكان ",00" الثابتة (عرضها ≈ 20px + 14px هامش) بفراغ صغير فتُقرأ كمبلغ واحد: 1.000,00
        style={{
          ...formStyles.input,
          direction: "ltr",
          textAlign: "right",
          paddingRight: "40px",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: "14px",
          display: "flex",
          alignItems: "center",
          direction: "ltr",
          color: "#94A3B8",
          fontSize: "14px",
          fontFamily: "'Cairo', sans-serif",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        ,00
      </span>
    </div>
  );
}

// ─── تقييم آمن لتعبير حسابي بسيط ────────────────────────────────────────────
// يُستخدَم من حقل "الوزن المُدرَج على الميزان" في InvoiceLineEntry.tsx لدعم
// كتابة تعبيرات مثل "10+20+30" أو "50*2" بدل رقم مباشر فقط.
//
// تنبيه أمني متعمَّد: هذا محلِّل (parser) مكتوب يدوياً بالكامل — لا يستخدم
// eval() ولا new Function() إطلاقاً. أي نص لا يتطابق حرفياً مع أرقام/عمليات/
// أقواس مسموحة يُرفَض فوراً قبل أي محاولة تقييم، لذلك لا يوجد أي مسار يسمح
// بتنفيذ كود JS عشوائي مهما كان محتوى الحقل.
//
// النحو المدعوم: أرقام عشرية، + - * /، أقواس، وعامل أحادي (+/-) قبل رقم أو قوس.
// القسمة على صفر تُعامَل كتعبير غير صالح (null) بدل إرجاع Infinity/NaN.
// إرجاع null يعني "تعبير غير صالح" — على المستدعي إظهار رسالة خطأ مناسبة
// بدل استخدام الناتج.

type ExprToken =
  | { kind: "num"; value: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "paren"; value: "(" | ")" };

function tokenizeExpression(input: string): ExprToken[] | null {
  const tokens: ExprToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let j = i;
      let seenDot = false;
      while (j < input.length && ((input[j] >= "0" && input[j] <= "9") || input[j] === ".")) {
        if (input[j] === ".") {
          if (seenDot) return null; // نقطتان عشريتان في نفس الرقم
          seenDot = true;
        }
        j++;
      }
      const numStr = input.slice(i, j);
      if (numStr === ".") return null;
      const value = Number(numStr);
      if (!Number.isFinite(value)) return null;
      tokens.push({ kind: "num", value });
      i = j;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ kind: "paren", value: ch });
      i++;
      continue;
    }
    return null; // محرف غير مدعوم — رفض فوري
  }
  return tokens;
}

// Recursive-descent parser: expression := term (('+'|'-') term)*
//                            term       := unary (('*'|'/') unary)*
//                            unary      := ('+'|'-')? primary
//                            primary    := number | '(' expression ')'
function parseTokens(tokens: ExprToken[]): number | null {
  let pos = 0;
  const peek = () => tokens[pos];

  function parsePrimary(): number | null {
    const tok = peek();
    if (!tok) return null;
    if (tok.kind === "num") {
      pos++;
      return tok.value;
    }
    if (tok.kind === "paren" && tok.value === "(") {
      pos++;
      const inner = parseExpr();
      if (inner === null) return null;
      const close = peek();
      if (!close || close.kind !== "paren" || close.value !== ")") return null;
      pos++;
      return inner;
    }
    return null;
  }

  function parseUnary(): number | null {
    const tok = peek();
    if (tok && tok.kind === "op" && (tok.value === "+" || tok.value === "-")) {
      pos++;
      const val = parseUnary();
      if (val === null) return null;
      return tok.value === "-" ? -val : val;
    }
    return parsePrimary();
  }

  function parseTerm(): number | null {
    let left = parseUnary();
    if (left === null) return null;
    for (;;) {
      const tok = peek();
      if (tok && tok.kind === "op" && (tok.value === "*" || tok.value === "/")) {
        pos++;
        const right = parseUnary();
        if (right === null) return null;
        if (tok.value === "*") {
          left = left * right;
        } else {
          if (right === 0) return null; // قسمة على صفر — تعبير غير صالح
          left = left / right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  function parseExpr(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    for (;;) {
      const tok = peek();
      if (tok && tok.kind === "op" && (tok.value === "+" || tok.value === "-")) {
        pos++;
        const right = parseTerm();
        if (right === null) return null;
        left = tok.value === "+" ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  }

  const result = parseExpr();
  if (result === null) return null;
  if (pos !== tokens.length) return null; // رموز متبقية غير مُستهلَكة — تعبير غير صالح
  if (!Number.isFinite(result)) return null;
  return result;
}

/**
 * يُقيِّم تعبيراً حسابياً بسيطاً (أرقام + - * / وأقواس) بأمان تام دون eval.
 * يُرجع الناتج الرقمي عند النجاح، أو null عند أي تعبير غير صالح (محارف غير
 * مسموحة، صياغة خاطئة، قسمة على صفر، ...).
 */
export function safeEvaluateExpression(raw: string): number | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  // قائمة سماح صريحة للمحارف قبل أي محاولة تحليل — دفاع إضافي (defense in
  // depth) فوق رفض tokenizeExpression لأي محرف غير معروف أصلاً.
  if (!/^[0-9.+\-*/()\s]+$/.test(cleaned)) return null;

  const tokens = tokenizeExpression(cleaned);
  if (!tokens || tokens.length === 0) return null;
  return parseTokens(tokens);
}

export interface Suggestion {
  id: number;
  label: string;
  labelLower: string;
}

interface AutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  onSelect: (val: string, id?: number) => void;
  suggestions: Suggestion[];
  placeholder?: string;
  style?: React.CSSProperties;
}

const VISIBLE_LIMIT = 10;

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

  const suggestionsLen = suggestions.length;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlighted(-1);
  }, [suggestionsLen]);

  const filtered = useMemo(() => {
    if (!value.trim()) return suggestions.slice(0, VISIBLE_LIMIT);
    const q = value.toLowerCase();
    const results: Suggestion[] = [];
    for (const s of suggestions) {
      if (s.labelLower.includes(q)) {
        results.push(s);
        if (results.length >= VISIBLE_LIMIT) break;
      }
    }
    return results;
  }, [value, suggestions]);

  const handleBlur = (e: React.FocusEvent) => {
    const rel = e.relatedTarget as Node | null;
    if (rel && !wrapRef.current?.contains(rel)) {
      setOpen(false);
    } else if (!rel) {
      setTimeout(() => setOpen(false), 150);
    }
  };

  useEffect(() => {
    if (highlighted >= 0 && highlighted < filtered.length && listRef.current) {
      const el = listRef.current.children[highlighted] as HTMLElement;
      el?.scrollIntoView({ block: "nearest" });
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
        style={{ ...formStyles.input, ...style }}
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

export const Autocomplete = memo(AutocompleteInner);