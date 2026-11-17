// ============================================================================
// بيانات الوزّان (ترويسة الفاتورة) في جدول `settings` — الدوال البحتة
// (التنقيح والحدود والقيم المؤقتة المزروعة) في src/print/weigher.ts.
// ============================================================================

import {
  WEIGHER_KEYS,
  normalizeWeigher,
  type WeigherInfo,
} from "../print/weigher.ts";
import { settingsService } from "./db";

export async function loadWeigherInfo(): Promise<WeigherInfo> {
  const [name, phone1, phone2, address] = await Promise.all([
    settingsService.get(WEIGHER_KEYS.name),
    settingsService.get(WEIGHER_KEYS.phone1),
    settingsService.get(WEIGHER_KEYS.phone2),
    settingsService.get(WEIGHER_KEYS.address),
  ]);
  return normalizeWeigher({ name, phone1, phone2, address });
}

/** يحفظ القيم بعد تنقيحها (الفارغ يُحفَظ نصاً فارغاً) ويُرجع ما حُفظ فعلاً. */
export async function saveWeigherInfo(input: WeigherInfo): Promise<WeigherInfo> {
  const clean = normalizeWeigher(input);
  await settingsService.update(WEIGHER_KEYS.name, clean.name);
  await settingsService.update(WEIGHER_KEYS.phone1, clean.phone1);
  await settingsService.update(WEIGHER_KEYS.phone2, clean.phone2);
  await settingsService.update(WEIGHER_KEYS.address, clean.address);
  return clean;
}
