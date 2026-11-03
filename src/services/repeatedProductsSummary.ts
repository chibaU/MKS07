// ============================================================================
// ملخّص المنتجات المتكرّرة للطباعة فقط.
//
// جميع القيم هنا نصوص ممثلة للقيم المعروضة في الفاتورة. نحولها إلى وحدات
// صحيحة (سنتيم/جزء من مئة كغ) قبل أي عملية جمع أو قسمة، لذلك لا تدخل أعداد
// JavaScript الثنائية العشرية في الحساب المالي إطلاقاً.
// ============================================================================

export interface RepeatedProductSummaryInput {
  product: string;
  /** الوزن كما سيظهر في الفاتورة، بمنزلتين عشريتين. */
  weight: string;
  /** المبلغ كما سيظهر في الفاتورة، بصيغة 1.234,56. */
  subtotal: string;
}

export interface RepeatedProductSummary {
  product: string;
  totalWeight: string;
  breakEvenPrice: string;
  totalAmount: string;
}

interface SummaryAccumulator {
  product: string;
  count: number;
  weightHundredths: bigint;
  amountCentimes: bigint;
}

/** يوحّد الاسم للتجميع والعرض، مع إبقاء أول تهجئة ذات معنى ظهرت في الفاتورة. */
export function normalizeProductName(product: string): string {
  return product.trim().replace(/\s+/g, " ");
}

function parseFixedDecimal(value: string, decimalSeparator: string = ".", thousandsSeparator?: string): bigint {
  let text = value.trim();
  if (thousandsSeparator) text = text.split(thousandsSeparator).join("");
  if (decimalSeparator !== ".") text = text.replace(decimalSeparator, ".");

  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`قيمة عشرية غير صالحة للملخّص: ${value}`);

  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = (match[3] ?? "").padEnd(2, "0");
  return sign * (BigInt(match[2]) * 100n + BigInt(fraction));
}

function formatFixedDecimal(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function formatMoneyCentimes(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = String(absolute / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${whole},${String(absolute % 100n).padStart(2, "0")}`;
}

/**
 * يجمع المنتجات المتكررة بترتيب أول ظهورها. القسمة الصحيحة هنا مقصودة: الناتج
 * هو عدد السنتيمات في سعر التعادل بعد القص عند منزلتين، لا تقريباً.
 */
export function calculateRepeatedProductSummaries(
  lines: readonly RepeatedProductSummaryInput[],
): RepeatedProductSummary[] {
  const groups = new Map<string, SummaryAccumulator>();

  for (const line of lines) {
    const product = normalizeProductName(line.product);
    const existing = groups.get(product);
    const group = existing ?? {
      product,
      count: 0,
      weightHundredths: 0n,
      amountCentimes: 0n,
    };

    group.count += 1;
    group.weightHundredths += parseFixedDecimal(line.weight);
    group.amountCentimes += parseFixedDecimal(line.subtotal, ",", ".");
    if (!existing) groups.set(product, group);
  }

  return [...groups.values()]
    .filter((group) => group.count > 1 && group.weightHundredths !== 0n)
    .map((group) => ({
      product: group.product,
      totalWeight: formatFixedDecimal(group.weightHundredths),
      // amount dinar / weight kg = centimes / hundredth-kg. نضرب في 100
      // للحصول على سنتيمات سعر الكيلو، ثم نقسم قسمة صحيحة (قص، لا تقريب).
      breakEvenPrice: formatMoneyCentimes((group.amountCentimes * 100n) / group.weightHundredths),
      totalAmount: formatMoneyCentimes(group.amountCentimes),
    }));
}
