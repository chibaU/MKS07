// حسابات الفاتورة على الهاتف — للعرض أثناء العمل فقط. المصدر النهائي للحقيقة هو
// الكمبيوتر الذي يعيد الحساب ببياناته الحالية عند الاستيراد (المتطلب 13).
// الصيغ هنا مطابقة لقواعد MKS (AI_CONTEXT.md القسم 6.1): نفس round2 ونفس منطق
// الوزن الصافي ونفس تنسيق المال، كي يتطابق المعروض على الهاتف مع ما سيراه الكمبيوتر.

export const round2 = (n) => Math.round(n * 100) / 100;

export const MONEY_MAX_DIGITS = 9;

const groupThousands = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// نفس formatMoney في InvoiceShared.tsx: 100.000,00 (بلا Intl عمداً).
export function formatMoney(amount) {
  if (!Number.isFinite(amount)) return "0,00";
  const centimes = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(centimes / 100);
  const fraction = centimes % 100;
  const sign = amount < 0 && centimes > 0 ? "-" : "";
  return `${sign}${groupThousands(String(whole))},${String(fraction).padStart(2, "0")}`;
}

export const formatKg = (n) => `${round2(n).toFixed(2)} كغ`;

// الأرقام الهندية/الفارسية → لاتينية (لوحة مفاتيح عربية).
export const toLatinDigits = (s) =>
  String(s).replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) & 0xf));

// يقبل "52.5" و"52,5" و"٥٢٫٥". يعيد NaN إن كان النص غير رقمي، و0 للفارغ لا يُعتبَر هنا.
export function parseDecimal(text) {
  const t = toLatinDigits(text).replace(/[٫,]/g, ".").trim();
  if (t === "" || !/^\d*\.?\d*$/.test(t) || t === ".") return NaN;
  return parseFloat(t);
}

// السعر: دنانير كاملة فقط، بحد أقصى 9 أرقام (نفس MoneyInput).
export function parseMoneyDigits(text) {
  const d = toLatinDigits(text).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return d.slice(0, MONEY_MAX_DIGITS);
}

export function newId() {
  if (globalThis.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// خريطة boxId → {name, weight}: بيانات الكمبيوتر الأخيرة تتقدّم، وتلميحات البند
// (المحفوظة وقت الإدخال) احتياط فقط لصندوق اختفى من القائمة النشطة.
export function boxMapOf(snapshotBoxes) {
  const m = new Map();
  for (const b of snapshotBoxes || []) m.set(b.id, { name: b.name, weight: b.weight });
  return m;
}

export function boxInfo(boxMap, sel) {
  const live = boxMap.get(sel.boxId);
  if (live) return live;
  return { name: sel.nameHint || `صندوق #${sel.boxId}`, weight: Number(sel.weightHint) || 0, unknown: true };
}

export function lineCalc(scaleWeight, boxSels, boxMap) {
  const empties = boxSels.reduce((s, b) => s + b.boxCount * boxInfo(boxMap, b).weight, 0);
  const exceeds = scaleWeight > 0 && empties > scaleWeight + 1e-9;
  const net = round2(scaleWeight - empties);
  return { empties: round2(empties), net, exceeds };
}

export function lineSubtotal(net, price) {
  return round2(net * price);
}

export function invoiceTotals(inv, boxMap) {
  let net = 0;
  let boxes = 0;
  let total = 0;
  let problems = 0;
  for (const l of inv.lines) {
    const c = lineCalc(l.scaleWeight, l.boxes, boxMap);
    if (c.exceeds || c.net < 0) problems++;
    net += c.net;
    total += c.net * l.price;
    boxes += l.boxes.reduce((s, b) => s + b.boxCount, 0);
  }
  return { net: round2(net), boxes, total: round2(total), problems };
}

export function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ─── تقييم آمن لتعبير حسابي بسيط (نفس safeEvaluateExpression في سطح المكتب) ───
// يدعم "10+20+30" و"50*2" وأقواس. لا eval ولا new Function: محلّل يدوي بقائمة سماح.
// null = تعبير غير صالح.
function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let j = i;
      let dot = false;
      while (j < input.length && ((input[j] >= "0" && input[j] <= "9") || input[j] === ".")) {
        if (input[j] === ".") { if (dot) return null; dot = true; }
        j++;
      }
      const s = input.slice(i, j);
      if (s === ".") return null;
      const v = Number(s);
      if (!Number.isFinite(v)) return null;
      tokens.push({ k: "n", v });
      i = j;
      continue;
    }
    if ("+-*/".includes(ch)) { tokens.push({ k: "o", v: ch }); i++; continue; }
    if (ch === "(" || ch === ")") { tokens.push({ k: "p", v: ch }); i++; continue; }
    return null;
  }
  return tokens;
}

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const primary = () => {
    const t = peek();
    if (!t) return null;
    if (t.k === "n") { pos++; return t.v; }
    if (t.k === "p" && t.v === "(") {
      pos++;
      const inner = expr();
      if (inner === null) return null;
      const c = peek();
      if (!c || c.k !== "p" || c.v !== ")") return null;
      pos++;
      return inner;
    }
    return null;
  };
  const unary = () => {
    const t = peek();
    if (t && t.k === "o" && (t.v === "+" || t.v === "-")) {
      pos++;
      const v = unary();
      return v === null ? null : t.v === "-" ? -v : v;
    }
    return primary();
  };
  const term = () => {
    let l = unary();
    if (l === null) return null;
    for (;;) {
      const t = peek();
      if (t && t.k === "o" && (t.v === "*" || t.v === "/")) {
        pos++;
        const r = unary();
        if (r === null) return null;
        if (t.v === "/") { if (r === 0) return null; l /= r; } else l *= r;
      } else break;
    }
    return l;
  };
  function expr() {
    let l = term();
    if (l === null) return null;
    for (;;) {
      const t = peek();
      if (t && t.k === "o" && (t.v === "+" || t.v === "-")) {
        pos++;
        const r = term();
        if (r === null) return null;
        l = t.v === "+" ? l + r : l - r;
      } else break;
    }
    return l;
  }
  const result = expr();
  if (result === null || pos !== tokens.length || !Number.isFinite(result)) return null;
  return result;
}

export function safeEvaluateExpression(raw) {
  const cleaned = String(raw).trim();
  if (!cleaned || !/^[0-9.+\-*/()\s]+$/.test(cleaned)) return null;
  const tokens = tokenize(cleaned);
  return tokens && tokens.length ? parse(tokens) : null;
}

// حقل «وزن الميزان»: رقم مباشر أو تعبير. يعيد {state, value, isExpr}:
//   empty (لم يُدخَل) | ok | invalid | negative
export function evalWeightInput(text) {
  const raw = toLatinDigits(text).replace(/[٫,]/g, ".").replace(/[×xX]/g, "*").replace(/÷/g, "/").trim();
  if (raw === "") return { state: "empty", value: 0, isExpr: false };
  if (/^\d+(\.\d+)?$/.test(raw)) return { state: "ok", value: parseFloat(raw), isExpr: false };
  const v = safeEvaluateExpression(raw);
  if (v === null) return { state: "invalid", value: 0, isExpr: true };
  if (v < 0) return { state: "negative", value: 0, isExpr: true };
  return { state: "ok", value: round2(v), isExpr: true };
}
