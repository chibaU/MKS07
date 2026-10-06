// قراءة بيانات النظام الرئيسي عبر خدمات db.ts الحالية (قراءة فقط). لا SQL هنا —
// كل الاستعلامات تبقى في طبقة الخدمات الوحيدة المعتمدة في المشروع.

import { boxService, merchantService } from "../../../services/db";
import type { ReferenceData } from "../domain/review.ts";
import type { Catalog } from "../types.ts";

/** كل التجار وكل الصناديق (المخفية أيضاً): مرجع التحقق وقت المراجعة. */
export async function loadReferenceData(): Promise<ReferenceData> {
  const [merchants, boxes] = await Promise.all([merchantService.getAll(), boxService.getAll()]);
  return {
    merchants: new Map(merchants.map((m) => [m.id, { id: m.id, name: m.name }])),
    boxes: new Map(
      boxes.map((b) => [b.id, { id: b.id, name: b.name, weight: Number(b.weight), isVisible: Number(b.is_visible) !== 0 }]),
    ),
  };
}

/** ما يُرسَل للهاتف: التجار + الصناديق الظاهرة فقط، وحقول الاقتراح فقط (لا هاتف/عنوان). */
export async function buildCatalog(): Promise<Catalog> {
  const [merchants, boxes] = await Promise.all([merchantService.getAll(), boxService.getVisible()]);
  return {
    merchants: merchants.map((m) => ({ id: m.id, name: m.name })),
    boxes: boxes.map((b) => ({ id: b.id, name: b.name, weight: Number(b.weight) })),
    generatedAt: new Date().toISOString(),
  };
}
