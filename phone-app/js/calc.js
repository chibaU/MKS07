// حسابات الفاتورة على الهاتف — للعرض أثناء العمل فقط.
// المصدر النهائي للحقيقة هو الكمبيوتر: يعيد الحساب بأحدث بياناته عند الاستلام
// (راجع src/features/phoneSync/domain/review.ts). هذه الصيغ مطابقة لقواعد MKS:
//   الصافي = round2(الميزان − Σ(عدد × وزن الصندوق)) · إجمالي البند = round2(الصافي × السعر)
//   الإجمالي الكلي = round2(Σ(الصافي × السعر))

export const round2 = (n) => Math.round(n * 100) / 100;

const AR_DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };

export function normalizeDigits(s) {
  return String(s ?? "")
    .replace(/[٠-٩۰-۹]/g, (c) => AR_DIGITS[c] ?? c)
    .replace(/[٫,،]/g, ".")
    .replace(/[×xX]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[−–—]/g, "-");
}

/**
 * مقيّم تعابير حسابية آمن (لا eval): أرقام و + - * / وأقواس. يستخدمه حقل وزن الميزان
 * ليجمع وزنات متعددة مثل 45.5+38+40.25. يعيد null إن كان التعبير غير صالح.
 */
export function evalExpression(text) {
  const src = normalizeDigits(text).replace(/\s+/g, "");
  if (!src) return null;
  if (!/^[0-9+\-*/().]+$/.test(src)) return null;
  let i = 0;
  const peek = () => src[i];

  function number() {
    const start = i;
    while (i < src.length && /[0-9.]/.test(src[i])) i++;
    const t = src.slice(start, i);
    if (!t || (t.match(/\./g) || []).length > 1 || t === ".") throw new Error("num");
    return Number(t);
  }
  function factor() {
    if (peek() === "-") { i++; return -factor(); }
    if (peek() === "+") { i++; return factor(); }
    if (peek() === "(") {
      i++;
      const v = expr();
      if (peek() !== ")") throw new Error("paren");
      i++;
      return v;
    }
    return number();
  }
  function term() {
    let v = factor();
    while (peek() === "*" || peek() === "/") {
      const op = src[i++];
      const r = factor();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = src[i++];
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  try {
    const v = expr();
    if (i !== src.length || !Number.isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

/** وزن الميزان المكتوب → رقم مقرَّب لمنزلتين، أو null إن كان غير صالح. */
export function parseWeight(text) {
  const v = evalExpression(text);
  if (v === null || v < 0) return null;
  return round2(v);
}

/** السعر: أرقام فقط (دينار صحيح) حتى 9 خانات، كما في MoneyInput على سطح المكتب. */
export function parsePrice(text) {
  const digits = normalizeDigits(text).replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (digits.length > 9) return null;
  return Number(digits);
}

/** boxes: [{boxId, boxCount, weight}] — weight هو وزن الصندوق وقت الإدخال. */
export function computeLine({ scaleWeight, price, boxes }) {
  const totalEmpty = (boxes || []).reduce((s, b) => s + (b.boxCount || 0) * (b.weight || 0), 0);
  const exceeds = totalEmpty > scaleWeight;
  const netWeight = round2(scaleWeight - totalEmpty);
  const subtotal = round2(netWeight * price);
  return { totalEmpty: round2(totalEmpty), netWeight, subtotal, exceeds };
}

export function invoiceTotal(lines) {
  return round2(lines.reduce((s, l) => s + l.netWeight * l.price, 0));
}

export function totalNet(lines) {
  return round2(lines.reduce((s, l) => s + l.netWeight, 0));
}

export function totalBoxes(lines) {
  return lines.reduce((s, l) => s + l.boxes.reduce((x, b) => x + b.boxCount, 0), 0);
}

function group(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** 100.000,00 — نفس صيغة formatMoney في سطح المكتب (فاصل آلاف نقطة، فاصلة عشرية، منزلتان). */
export function formatMoney(amount) {
  if (!Number.isFinite(amount)) return "0,00";
  const centimes = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(centimes / 100);
  const frac = centimes % 100;
  const sign = amount < 0 && centimes > 0 ? "-" : "";
  return `${sign}${group(String(whole))},${String(frac).padStart(2, "0")}`;
}

export const fmtW = (n) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");

export function todayLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** تطبيع نص عربي للبحث: بلا تشكيل/تطويل، وتوحيد الألف والياء. */
export function normalizeArabic(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىئ]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}
