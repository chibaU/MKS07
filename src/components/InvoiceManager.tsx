import type { Box } from "../services/db";
import type { Draft } from "./invoice";

// ── دالة مساعدة لبناء مسودة فاتورة جديدة بناءً على الصناديق المتاحة ──
// تُستخدم من App.tsx و HomePage.tsx
export function makeDraft(id: string, realBoxes: Box[]): Draft {
  return {
    id,
    merchantName: "",
    productInput: "",
    weightInput: "",
    priceInput: "",
    boxes: realBoxes.map((b) => ({
      id: b.id,
      name: b.name,
      emptyWeight: b.weight,
      grossInput: 0,
    })),
    rows: [],
  };
}
