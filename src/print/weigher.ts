// ============================================================================
// بيانات الوزّان المطبوعة في خاتمة الفاتورة — دوال بحتة (التخزين في
// src/services/weigherSettings.ts). الحقول كلها اختيارية: الفارغ لا يُطبَع.
// ============================================================================

export interface WeigherInfo {
  name: string;
  phone1: string;
  phone2: string;
}

export const EMPTY_WEIGHER: WeigherInfo = { name: "", phone1: "", phone2: "" };

export const WEIGHER_LIMITS = {
  name: 80,
  phone: 30,
} as const;

/**
 * مفاتيح `settings`. owner_name / owner_phone مزروعة أصلاً بقيم مؤقتة في migration
 * نسخة 1 (lib.rs) ولا يقرؤها أي كود آخر فأُعيد استعمالها؛ owner_phone_2 مفتاح جديد
 * (upsert بلا migration). لا عنوان للوزّان: عنوانه هو اسم السوق المطبوع في أعلى الفاتورة
 * (والصف owner_address القديم يحذفه migration نسخة 2).
 */
export const WEIGHER_KEYS = {
  name: "owner_name",
  phone1: "owner_phone",
  phone2: "owner_phone_2",
} as const;

/**
 * القيم المؤقتة التي يزرعها migration نسخة 1. لو بقيت كما هي تعني «لم يُدخَل شيء»،
 * وإلا طُبع «اسم صاحب المؤسسة» و«0600000000» على فواتير حقيقية.
 */
const SEEDED_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "اسم صاحب المؤسسة",
  "0600000000",
]);

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanLine(value: string, max: number): string {
  return collapse(value).slice(0, max).trim();
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
  }
}

export function normalizeWeigher(input: Partial<Record<keyof WeigherInfo, string | null>>): WeigherInfo {
  return {
    name: normalizeWeigherField("name", input.name),
    phone1: normalizeWeigherField("phone1", input.phone1),
    phone2: normalizeWeigherField("phone2", input.phone2),
  };
}