// ============================================================================
// بيانات الوزّان المطبوعة في ترويسة الفاتورة — دوال بحتة (التخزين في
// src/services/weigherSettings.ts). الحقول كلها اختيارية: الفارغ لا يُطبَع.
// ============================================================================

export interface WeigherInfo {
  name: string;
  phone1: string;
  phone2: string;
  address: string;
}

export const EMPTY_WEIGHER: WeigherInfo = { name: "", phone1: "", phone2: "", address: "" };

export const WEIGHER_LIMITS = {
  name: 80,
  phone: 30,
  /** سطران كحد أقصى، وكل سطر لا يتجاوز هذا الطول. */
  addressLines: 2,
  addressLineLength: 80,
} as const;

/**
 * مفاتيح `settings`. owner_name / owner_phone / owner_address مزروعة أصلاً بقيم
 * مؤقتة في migration نسخة 1 (lib.rs) ولا يقرؤها أي كود آخر فأُعيد استعمالها؛
 * owner_phone_2 مفتاح جديد (upsert بلا migration).
 */
export const WEIGHER_KEYS = {
  name: "owner_name",
  phone1: "owner_phone",
  phone2: "owner_phone_2",
  address: "owner_address",
} as const;

/**
 * القيم المؤقتة التي يزرعها migration نسخة 1. لو بقيت كما هي تعني «لم يُدخَل شيء»،
 * وإلا طُبع «اسم صاحب المؤسسة» و«0600000000» على فواتير حقيقية.
 */
const SEEDED_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "اسم صاحب المؤسسة",
  "0600000000",
  "العنوان، بسكرة",
]);

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanLine(value: string, max: number): string {
  return collapse(value).slice(0, max).trim();
}

/** عنوان من سطرين كحد أقصى: يقص الفراغات ويحذف الأسطر الفارغة ويقصّ الزائد. */
export function normalizeAddress(raw: string | null | undefined): string {
  return (raw ?? "")
    .split(/\r?\n/)
    .map((line) => cleanLine(line, WEIGHER_LIMITS.addressLineLength))
    .filter((line) => line !== "")
    .slice(0, WEIGHER_LIMITS.addressLines)
    .join("\n");
}

/** نص خانة العنوان أثناء الكتابة: لا يسمح بأكثر من سطرين (لا قص ولا حذف أسطر فارغة). */
export function limitAddressInput(raw: string): string {
  return raw.replace(/\r\n/g, "\n").split("\n").slice(0, WEIGHER_LIMITS.addressLines).join("\n");
}

export function normalizeWeigherField(
  field: keyof WeigherInfo,
  raw: string | null | undefined,
): string {
  const text = raw ?? "";
  if (SEEDED_PLACEHOLDERS.has(collapse(text))) return "";
  switch (field) {
    case "name":
      return cleanLine(text, WEIGHER_LIMITS.name);
    case "phone1":
    case "phone2":
      return cleanLine(text, WEIGHER_LIMITS.phone);
    case "address":
      return normalizeAddress(text);
  }
}

export function normalizeWeigher(input: Partial<Record<keyof WeigherInfo, string | null>>): WeigherInfo {
  return {
    name: normalizeWeigherField("name", input.name),
    phone1: normalizeWeigherField("phone1", input.phone1),
    phone2: normalizeWeigherField("phone2", input.phone2),
    address: normalizeWeigherField("address", input.address),
  };
}
