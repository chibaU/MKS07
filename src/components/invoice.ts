export interface DraftBox {
  id: number;
  name: string;
  emptyWeight: number;
  countInput: number; // عدد الصناديق المستخدمة من هذا النوع (عدد صحيح — وليس وزناً)
}

export interface DraftRowBox {
  id: number;
  boxCount: number;
}

export interface DraftRow {
  id: number;
  product: string;
  productId: number | null;
  weight: number; // الوزن الصافي (الوزن المُدرَج على الميزان ناقص وزن الصناديق الفارغة)
  price: number;
  boxesSnapshot: DraftRowBox[];
}

export interface Draft {
  id: string;
  merchantName: string;
  merchantId?: number;
  productInput: string;
  productId?: number;
  scaleWeightInput: string; // الوزن المُدرَج على الميزان (بضاعة + صناديق معاً) — حقل واحد فقط
  priceInput: string; // أرقام فقط = دنانير كاملة ("1000" = 1.000,00 دج) — راجع MoneyInput
  boxes: DraftBox[];
  rows: DraftRow[];
  // ── دورة حياة الفاتورة (حفظ تلقائي تدريجي) — القسم 6 من مهمة الجزء 1 ──
  invoiceId: number | null; // null دائماً لمسودة جديدة فارغة؛ يُطابق القاعدة الثابتة invoiceId !== null ⟺ rows.length > 0
  invoiceNumberInput: string; // نص حقل رقم الفاتورة
  isNumberLocked: boolean; // true عند تحميل فاتورة موجودة فعلياً برقمها الحقيقي
  isSavingLine: boolean; // true أثناء أي عملية DB متعلقة ببند (إدراج أول/لاحق، حذف بند) — عابر، لا يُرسَل للقاعدة
  isClosing: boolean; // true أثناء عملية setOpenState — عابر، لا يُرسَل للقاعدة
}