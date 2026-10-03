import Database, { type QueryResult } from '@tauri-apps/plugin-sql';

type NullableString = string | null;
type NullableNumber = number | null;
type RawDatabaseConnection = Awaited<ReturnType<typeof Database.load>>;

export interface Setting {
  key: string;
  value: string;
}

// ── ميزة تفعيل الجهاز (راجع AI_CONTEXT.md القسم 9) ──
// device_id هذا الجهاز تحديداً يُخزَّن كسطر عادي في settings (لا عمود/جدول
// خاص به) لأنه بيانات فردية بسيطة تماماً كبيانات صاحب المؤسسة الموجودة أصلاً
// في نفس الجدول. trusted_devices (أدناه) منفصل تماماً: يحمل فقط قائمة
// معرّفات الأجهزة المسموح لها بالعمل، لا أي بيانات عن الجهاز الحالي بعينه.
const SETTINGS_KEY_DEVICE_ID = 'device_id';

// ── مهمة 3/2 من ميزة طباعة الفاتورة: الطباعة الصامتة المباشرة ──
// اسم الطابعة التي يختارها المستخدم من صفحة الإعدادات لتُستخدَم في كل طباعة
// مباشرة لاحقة. قيمة فارغة/غائبة تعني "استخدم طابعة النظام الافتراضية" —
// راجع تعليق `print_invoice_direct` في invoice_template.rs (Rust) للتفاصيل
// الكاملة لما يحدث بهذا الاسم فعلياً.
export const SETTINGS_KEY_PRINTER_NAME = 'invoice_printer_name';

export interface TrustedDevice {
  device_id: string;
  activated_at: string;
}

export interface Merchant {
  id: number;
  name: string;
  address: NullableString;
  phone: NullableString;
  created_at: NullableString;
}

export interface Product {
  id: number;
  name: string;
}

export interface Box {
  id: number;
  name: string;
  weight: number;
  is_visible: number;
}

export interface Invoice {
  id: number;
  merchant_id: NullableNumber;
  invoice_date: NullableString;
  total_amount: number;
  // ── دورة حياة الفاتورة + الترقيم المجمَّد (راجع AI_CONTEXT.md والمهمة
  // المرجعية لهذا الجزء) — أعمدة migration نسخة 2 في lib.rs. تبقى NULL/0
  // للفواتير القديمة إلى أن تُعالَج (is_open) أو تُرقَّم كسولاً (باقي الحقول).
  is_open: number;
  invoice_number: NullableString;
  number_year: NullableNumber;
  number_month: NullableNumber;
  number_merchant_id: NullableNumber;
  number_counter: NullableNumber;
}

export interface InvoiceDetail {
  id: number;
  invoice_id: number;
  product_name: string;
  quantity: number;
  price: number;
  subtotal: number;
}

export interface InvoiceDetailBox {
  invoice_detail_id: number;
  box_id: number;
  box_count: number;
}

export interface CreateInvoiceDetailBox {
  box_id: number;
  box_count: number;
}

export interface CreateInvoiceDetail {
  product_name: string;       // Elاسم المكتوب مباشرة في حقل الإدخال
  quantity: number;
  price: number;
  subtotal: number;
  boxes: CreateInvoiceDetailBox[];
}

export interface InvoiceWithMerchant extends Invoice {
  merchant_name: NullableString;
  // مضافة لطباعة الفاتورة (مهمة 2/2): {{هاتف_التاجر}} و{{عنوان_التاجر}} —
  // كانتا مفقودتين من هذا النوع رغم وجود merchant_name، رغم أن كل الاستعلامات
  // أدناه تُنفّذ أصلاً LEFT JOIN مع جدول merchants الذي يحتوي عليهما. أُضيفتا
  // لقائمة الأعمدة في الاستعلامات الأربعة التي تبني هذا النوع (لا استعلام
  // DB جديد وقت الطباعة نفسه — التمديد هنا يحدث في تعريف الاستعلام الموجود
  // أصلاً، لا في نقطة استدعاء إضافية عند الطباعة).
  merchant_phone: NullableString;
  merchant_address: NullableString;
}

export interface InvoiceDetailBoxFull extends InvoiceDetailBox {
  box_name: string;
  box_weight: number;
  is_visible: number;
}

export interface InvoiceDetailFull extends InvoiceDetail {
  boxes: InvoiceDetailBoxFull[];
}

export interface InvoiceFullDetails extends InvoiceWithMerchant {
  details: InvoiceDetailFull[];
}

export interface SearchInvoicesOptions {
  search: string;
  limit: number;
  offset: number;
  // نطاق تاريخ اختياري (شامل للطرفين)، بصيغة YYYY-MM-DD — نفس صيغة تخزين
  // invoice_date (راجع deriveYearMonth أدناه)، فتصح المقارنة النصية المباشرة
  // بلا تحويل. undefined أو "" يعني "بلا حد" لهذا الطرف تحديداً.
  dateFrom?: string;
  dateTo?: string;
}

export interface SearchInvoicesResult {
  items: InvoiceWithMerchant[];
  totalCount: number;
}

// نتيجة إنشاء فاتورة جديدة مع أول بند فيها — detailId هو الـ id الحقيقي لصف
// invoice_details المُدرَج (لا أي صف آخر أُدرِج بعده ضمن نفس المعاملة).
export interface CreateInvoiceWithFirstDetailResult {
  invoiceId: number;
  invoiceNumber: string;
  year: number;
  month: number;
  counter: number;
  detailId: number;
}

// نتيجة الترقيم (سواء وُجد الرقم مسبقاً أو تم توليده الآن كسولاً).
export interface EnsureInvoiceNumberedResult {
  invoiceNumber: string;
  year: number;
  month: number;
  counter: number;
  merchantId: number;
}

// ── صيانة الأرشيف الصامتة (AI_CONTEXT.md القسم 6.8) ──
// عتبة إجمالي الفواتير (مفتوحة + مغلقة) التي يُفعَّل التنظيف عند تجاوزها، وحجم
// الدفعة المحذوفة في كل تشغيل.
const ARCHIVE_PRUNE_THRESHOLD = 2000;
const ARCHIVE_PRUNE_BATCH = 500;

export interface ArchivePruneResult {
  deleted: number;    // عدد الفواتير المحذوفة فعلياً (0 = لم يتحقق شرط التنظيف)
  vacuumed: boolean;  // هل نجح VACUUM بعد الحذف (فشله لا يُبطل الحذف المُثبَّت)
}

type InvoiceDetailRow = InvoiceDetail;

interface InvoiceDetailBoxRow extends InvoiceDetailBox {
  detail_id: number;
  box_name: string;
  box_weight: number;
  is_visible: number;
}

// خطأ مخصص يُرفَع فقط حين يشير مرجع (تاجر أو صندوق) اخترته الواجهة من لقطة
// محلية (draft.merchantId أو draft.boxes) إلى صف لم يعد موجوداً فعلياً في
// القاعدة وقت الكتابة — أي حُذف من صفحة التجار/الصناديق بعد أن أُخذت اللقطة
// وقبل أن يُستخدَم في إدراج/تعديل فعلي. صنف منفصل (لا Error عادي) كي تستطيع
// الواجهة تمييزه بأمان عن أي خطأ تقني آخر (اتصال، IPC...) وتعرض رسالته
// مباشرة للمستخدم بدل رسالة عامة، لأن رسالته مصمَّمة لتكون مفهومة له مباشرة.
export class StaleReferenceError extends Error {}

const DB_PATH = 'sqlite:mks.db';

let dbPromise: Promise<RawDatabaseConnection> | null = null;

// ⚠️ قرار معماري متعمد: PRAGMA foreign_keys غير مفعَّل عمداً على هذا الاتصال.
// SQLite لا يفرض قيود المفاتيح الأجنبية افتراضياً إلا بتفعيل هذا الـ pragma
// صراحة لكل اتصال. تفعيله الآن — دون تعديل ON DELETE CASCADE الحالي على
// invoices.merchant_id (مُعرَّف منذ migration نسخة 1 في lib.rs) — سيجعل أي حذف
// خاطئ لتاجر (لو تجاوز فحص invoiceService.merchantHasInvoices بالخطأ) يحذف
// صامتاً كل فواتير ذلك التاجر عبر الـ CASCADE، بدل رفض العملية بخطأ واضح
// قابل للاكتشاف. تصحيح هذا يتطلب أولاً تغيير ON DELETE CASCADE إلى ما يعادل
// RESTRICT، وهو تعديل على قيد جدول قائم يستلزم إعادة بناء الجدول بالكامل في
// SQLite — خارج نطاق هذا الجزء. الحماية الوحيدة الفعلية حالياً من حذف تاجر
// له فواتير هي invoiceService.merchantHasInvoices() على مستوى التطبيق.
async function loadRawDb(): Promise<RawDatabaseConnection> {
  dbPromise ??= Database.load(DB_PATH);
  return await dbPromise;
}

// ── حصرية إلزامية على مستوى "الوحدة المنطقية الكاملة" (يحل خطأ "cannot
// rollback - no transaction is active" عند إدراج بند فاتورة) ──
// tauri-plugin-sql (v2.4.0) يفتح connection pool حقيقي متعدد الاتصالات من جهة
// Rust (sqlx::Pool، حتى 10 اتصالات افتراضياً — تحقّقنا من مصدر المكتبة نفسها
// على crates.io). كل استدعاء execute/select من جهة JS هو أمر IPC مستقل، يسحب
// Rust له أي اتصال متاح من الـ pool وقتها، ينفّذ عليه وحده، ثم يعيده فوراً —
// بلا أي ضمان استمرارية بين الاستدعاءات المتتالية، ولا يوجد API رسمي في
// المكتبة لتثبيت الاتصال أو لتصغير حجم الـ pool إلى 1.
//
// ⚠️ ملاحظة جوهرية (تصحيح لتصميم سابق أُرسِل بالخطأ): تسلسل كل استدعاء
// execute/select بمفرده (queue على مستوى العبارة الواحدة) *لا يكفي*. يمنع
// ذلك تنفيذ استدعاءي IPC في آن واحد فعلياً، لكنه لا يمنع تسلل عبارة تابعة
// لمعاملة أخرى (مثلاً BEGIN B) بين عبارتين تابعتين لنفس المعاملة (BEGIN A ثم
// SELECT A) — وهذا بالضبط سيناريو App.tsx (فواتير مفتوحة متعددة بلا رقم عند
// الإقلاع، تُرقَّم بالتوازي عبر Promise.all). لذا يجب حجز الحصرية لكامل مدة
// الوحدة المنطقية (معاملة BEGIN..COMMIT كاملة بكل عباراتها، أو استعلام مفرد)
// دفعة واحدة عبر runExclusive، لا لكل عبارة SQL بمفردها.
//
// القاعدة الوحيدة الواجب الالتزام بها في باقي هذا الملف: runExclusive لا
// يُستدعى أبداً من داخل work تابع لاستدعاء runExclusive آخر (سيُسبِّب انسداداً
// تاماً لأن الطابور غير قابل لإعادة الدخول عمداً). أي عملية DB إضافية مطلوبة
// ضمن نفس الوحدة المنطقية (مثل عبارات BEGIN/COMMIT داخل executeInTransaction،
// أو حلقة إعادة المحاولة في withInvoiceNumberRetry، أو نداء
// fetchInvoiceDetailsFull من getInvoiceFullDetails) تُنفَّذ عبر raw المُمرَّرة
// مباشرة، لا عبر استدعاء جديد لـ runExclusive. كل دالة مُصدَّرة في هذا الملف
// تستدعي runExclusive مرة واحدة بالضبط على مستواها الأعلى (باستثناء الحلقات
// التي تستدعي دوالاً أخرى مُصدَّرة بالتتابع، مثل getOpenInvoices).
let dbQueue: Promise<unknown> = Promise.resolve();

function runExclusive<T>(
  work: (raw: RawDatabaseConnection) => Promise<T>
): Promise<T> {
  const task = () => loadRawDb().then(work);
  const result = dbQueue.then(task, task);
  // نلتقط الخطأ هنا فقط لمنع Unhandled Promise Rejection على سلسلة الطابور
  // الداخلية؛ الخطأ الحقيقي يصل كاملاً للمستدعي عبر `result` نفسها أدناه.
  dbQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function requireLastInsertId(result: QueryResult, entityName: string): number {
  if (typeof result.lastInsertId !== 'number') {
    throw new Error(`Failed to read inserted ${entityName} id.`);
  }

  return result.lastInsertId;
}

// تُنفَّذ العمليات المركبة تحت runExclusive كي لا تتداخل طلبات الواجهة.
// لا تدعم @tauri-apps/plugin-sql معاملة موزَّعة على استدعاءات IPC متتالية:
// كل execute/select قد يستعير اتصالاً مختلفاً من pool، لذا BEGIN/COMMIT هنا
// كانا يتركان إنشاء الفاتورة يفشل. الذرية الحقيقية عبر هذا الـ plugin تتطلب
// Rust command يحتفظ بالاتصال؛ إلى أن توجد تلك الحاجة، نستخدم تسلسلاً حصرياً
// ونضع جميع فحوصات المراجع قبل أول كتابة.
async function executeInTransaction<T>(
  _raw: RawDatabaseConnection,
  operation: () => Promise<T>
): Promise<T> {
  return await operation();
}

// اشتقاق year/month من نص تاريخ بصيغة YYYY-MM-DD (نفس الصيغة التي يُنتجها
// `new Date().toISOString().split("T")[0]` في HomePage.tsx). يُقسَّم النص
// مباشرة بدل تمريره إلى `new Date(...)` لتفادي أي انزياح محتمل بسبب المنطقة
// الزمنية المحلية — المصدر دائماً هو نص invoice_date نفسه، لا ساعة النظام.
function deriveYearMonth(dateStr: string): { year: number; month: number } {
  const [yearPart, monthPart] = dateStr.split('-');
  return {
    year: Number(yearPart),
    month: Number(monthPart)
  };
}

// صيغة العرض: {YY}{MM}-{merchantId}-{counter} — الفاصل إلزامي لتفادي الغموض
// البصري عند تعدد الأرقام (القسم 3 من مهمة هذا الجزء).
function formatInvoiceNumber(
  year: number,
  month: number,
  merchantId: number,
  counter: number
): string {
  const yy = String(year % 100).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return `${yy}${mm}-${merchantId}-${counter}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('UNIQUE constraint failed');
}

// تُستدعى دوماً من داخل عمل مُجدوَل عبر runExclusive بالفعل — لا تحجز
// حصرية خاصة بها (راجع التعليق أعلى runExclusive). خوارزمية توليد رقم فاتورة
// فريد بحلقة إعادة محاولة (حتى 5 محاولات)، مشتركة بين createInvoiceWithFirstDetail
// وensureInvoiceNumbered كما هي منصوصة في القسم 3 و5.2 من مهمة هذا الجزء:
// نحسب nextCounter داخل معاملة جديدة في كل محاولة، نُنفِّذ الكتابة الفعلية
// (INSERT أو UPDATE حسب المستدعي عبر performWrite)، فإن فشلت بتعارض UNIQUE
// تحديداً نُعيد المحاولة من رأس الحلقة، وأي خطأ آخر يُرفَع فوراً دون إعادة
// محاولة. حلقة إعادة المحاولة بأكملها تبقى تحت نفس استدعاء runExclusive
// الواحد الذي استدعى هذه الدالة (لا حصرية منفصلة لكل محاولة) — فلا يمكن لأي
// معاملة ترقيم أخرى أن تتداخل بين محاولاتها.
async function withInvoiceNumberRetry<T>(
  raw: RawDatabaseConnection,
  merchantId: number,
  year: number,
  month: number,
  performWrite: (nextCounter: number, invoiceNumber: string) => Promise<T>
): Promise<T> {
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const counterRows = await raw.select<{ next_counter: number }[]>(
        `SELECT COALESCE(MAX(number_counter), 0) + 1 AS next_counter
         FROM invoices
         WHERE number_merchant_id = $1 AND number_year = $2 AND number_month = $3`,
        [merchantId, year, month]
      );
      const nextCounter = counterRows[0]?.next_counter ?? 1;
      const invoiceNumber = formatInvoiceNumber(year, month, merchantId, nextCounter);

      const result = await performWrite(nextCounter, invoiceNumber);

      return result;
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      // تعارض UNIQUE على تركيبة الترقيم (مثلاً تبويبان بنفس التاجر يُدرَج
      // فيهما أول بند بفارق زمني قصير جداً) — أعد المحاولة من رأس الحلقة،
      // سيُعاد حساب nextCounter من جديد ضمن معاملة جديدة.
    }
  }

  throw new Error('تعذر توليد رقم فاتورة فريد، حاول مرة أخرى');
}

// تُستدعى دوماً من داخل عمل مُجدوَل عبر runExclusive بالفعل — لا تحجز
// حصرية خاصة بها (راجع التعليق أعلى runExclusive). جلب تفاصيل الفاتورة
// الكاملة (البنود + صناديق كل بند) — مستخرجة من داخل getInvoiceFullDetails
// لإعادة استخدام نفس المنطق حرفياً في getInvoiceFullDetailsByNumber دون
// تكرار.
async function fetchInvoiceDetailsFull(
  raw: RawDatabaseConnection,
  invoiceId: number
): Promise<InvoiceDetailFull[]> {
  const detailRows = await raw.select<InvoiceDetailRow[]>(
    `SELECT
      invoice_details.id,
      invoice_details.invoice_id,
      invoice_details.product_name,
      invoice_details.quantity,
      invoice_details.price,
      invoice_details.subtotal
    FROM invoice_details
    WHERE invoice_details.invoice_id = $1
    ORDER BY invoice_details.id ASC`,
    [invoiceId]
  );

  const boxRows = await raw.select<InvoiceDetailBoxRow[]>(
    `SELECT
      invoice_detail_boxes.invoice_detail_id,
      invoice_detail_boxes.invoice_detail_id AS detail_id,
      invoice_detail_boxes.box_id,
      invoice_detail_boxes.box_count,
      boxes.name AS box_name,
      boxes.weight AS box_weight,
      boxes.is_visible
    FROM invoice_detail_boxes
    INNER JOIN invoice_details ON invoice_details.id = invoice_detail_boxes.invoice_detail_id
    INNER JOIN boxes ON boxes.id = invoice_detail_boxes.box_id
    WHERE invoice_details.invoice_id = $1
    ORDER BY invoice_detail_boxes.invoice_detail_id ASC, boxes.name ASC`,
    [invoiceId]
  );

  return detailRows.map((detail): InvoiceDetailFull => ({
    ...detail,
    boxes: boxRows
      .filter((box) => box.detail_id === detail.id)
      .map((box): InvoiceDetailBoxFull => ({
        invoice_detail_id: box.invoice_detail_id,
        box_id: box.box_id,
        box_count: box.box_count,
        box_name: box.box_name,
        box_weight: box.box_weight,
        is_visible: box.is_visible
      }))
  }));
}

// ── الحماية المضادة لثغرة "مرجع محذوف أثناء وجود تبويب مفتوح" ──
// السبب الجذري: draft.merchantId يُؤخَذ من قائمة merchants حيّة نسبياً، لكن
// draft.boxes هي لقطة مجمَّدة بالكامل عند فتح/تصفير التبويب (makeDraft/
// draftFromInvoice في InvoiceManager.tsx) ولا ترتبط حيّاً بجدول boxes بعد
// ذلك؛ وفي الحالتين، الفاصل الزمني بين اختيار المرجع في الواجهة وتنفيذ
// الإدراج الفعلي قد يتسع كفاية ليُحذَف المرجع من DB في الأثناء (صندوق حُذف من
// BoxesPage، أو تاجر حُذف من MerchantsPage قبل أن يُستخدَم في أي فاتورة محفوظة
// فعلياً — merchantHasInvoices لا يمنع حذفه في هذه الحالة). بما أن
// PRAGMA foreign_keys معطَّل عمداً (تعليق القسم 4.1 أعلى loadRawDb)، القاعدة
// نفسها لن ترفض إدراجاً كهذا، وسينتج عنه صف orphan في invoice_detail_boxes أو
// invoices.merchant_id يختفي بصمت من أي عرض لاحق (INNER JOIN مع boxes/
// merchants). الحل: تحقّق صريح من وجود كل مرجع فعلياً، داخل نفس المعاملة التي
// تُنفِّذ الكتابة (لا قبلها بحصرية منفصلة، تفادياً لأي فجوة زمنية جديدة)، قبل
// أي INSERT/UPDATE يعتمد عليه. فشل التحقق يرفع StaleReferenceError، فتُلغى
// المعاملة بالكامل (ROLLBACK) ولا يُكتَب أي شيء — لا حاجة لأي تغيير في طريقة
// بناء draft.boxes أو مزامنتها الحيّة، هذا هو الحل الأقل تعقيداً والآمن دائماً
// بصرف النظر عن أي تأخّر لاحق في أي لقطة محلية أخرى مستقبلاً.

// تُستدعى دوماً من داخل عمل مُجدوَل عبر runExclusive/executeInTransaction
// بالفعل — لا تحجز حصرية أو معاملة خاصة بها.
async function assertMerchantExists(
  raw: RawDatabaseConnection,
  merchantId: number
): Promise<void> {
  const rows = await raw.select<{ id: number }[]>(
    'SELECT id FROM merchants WHERE id = $1 LIMIT 1',
    [merchantId]
  );
  if (rows.length === 0) {
    throw new StaleReferenceError(
      'التاجر المحدَّد لم يعد موجوداً في النظام (رُبما حُذف للتو) — يرجى اختيار تاجر آخر والمحاولة من جديد.'
    );
  }
}

// نفس الفكرة لكل الصناديق المرجعية دفعة واحدة (استعلام IN وحيد بدل استعلام
// منفصل لكل box_id) — يتحقق من الوجود فقط (لا is_visible)، لأن صندوقاً
// مخفياً يبقى مرجعاً صالحاً تماماً؛ الإخفاء والحذف أمران مختلفان عمداً في هذا
// التطبيق (راجع toggleVisibility مقابل handleDelete في BoxesPage.tsx).
async function assertBoxesExist(
  raw: RawDatabaseConnection,
  boxIds: number[]
): Promise<void> {
  const uniqueIds = [...new Set(boxIds)];
  if (uniqueIds.length === 0) return;

  const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await raw.select<{ id: number }[]>(
    `SELECT id FROM boxes WHERE id IN (${placeholders})`,
    uniqueIds
  );

  if (rows.length !== uniqueIds.length) {
    throw new StaleReferenceError(
      'أحد الصناديق المستخدَمة في هذا البند لم يعد موجوداً في النظام (رُبما حُذف للتو) — يرجى تحديث الصفحة وإعادة اختيار الصناديق.'
    );
  }
}

export const settingsService = {
  async get(key: string): Promise<string | null> {
    return await runExclusive(async (raw) => {
      const rows = await raw.select<Setting[]>(
        'SELECT key, value FROM settings WHERE key = $1 LIMIT 1',
        [key]
      );

      return rows[0]?.value ?? null;
    });
  },

  async update(key: string, value: string): Promise<QueryResult> {
    return await runExclusive((raw) =>
      raw.execute(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value]
      )
    );
  }
};

// ── ميزة تفعيل الجهاز (راجع AI_CONTEXT.md القسم 9) ──
// كود التحقق من كود التفعيل السري نفسه (verify_activation_code) موجود فقط
// في Rust (src-tauri/src/activation.rs) عمداً — هذه الخدمة لا تتحقق من أي
// كود، فقط تدير معرّف الجهاز وقائمة الموثوقين محلياً بعد أن يُتحقَّق من
// الكود من جهة Rust.
export const activationService = {
  // يولّد معرّف جهاز عشوائياً (UUID) مرة واحدة فقط ويثبته دائماً في settings،
  // أو يعيد نفس القيمة المولَّدة سابقاً إن كانت موجودة أصلاً. لا يتغيّر هذا
  // المعرّف بعد أول توليد له طوال عمر ملف mks.db هذا.
  async getOrCreateDeviceId(): Promise<string> {
    const existing = await settingsService.get(SETTINGS_KEY_DEVICE_ID);
    if (existing) return existing;

    const generated = crypto.randomUUID();
    await settingsService.update(SETTINGS_KEY_DEVICE_ID, generated);
    return generated;
  },

  async isDeviceTrusted(deviceId: string): Promise<boolean> {
    return await runExclusive(async (raw) => {
      const rows = await raw.select<{ device_id: string }[]>(
        'SELECT device_id FROM trusted_devices WHERE device_id = $1 LIMIT 1',
        [deviceId]
      );
      return rows.length > 0;
    });
  },

  // تُستدعى فقط بعد نجاح verify_activation_code من جهة Rust. INSERT OR
  // IGNORE بدل INSERT عادي: استدعاء مزدوج غير متوقَّع (مثلاً StrictMode في
  // التطوير) لا يجب أن يفشل بخطأ UNIQUE.
  async trustDevice(deviceId: string): Promise<QueryResult> {
    return await runExclusive((raw) =>
      raw.execute(
        'INSERT OR IGNORE INTO trusted_devices (device_id, activated_at) VALUES ($1, $2)',
        [deviceId, new Date().toISOString()]
      )
    );
  }
};

export const merchantService = {
  async getAll(): Promise<Merchant[]> {
    return await runExclusive((raw) =>
      raw.select<Merchant[]>(
        'SELECT id, name, address, phone, created_at FROM merchants ORDER BY name ASC'
      )
    );
  },

  async create(
    name: string,
    address: NullableString,
    phone: NullableString
  ): Promise<QueryResult> {
    return await runExclusive((raw) =>
      raw.execute(
        'INSERT INTO merchants (name, address, phone) VALUES ($1, $2, $3)',
        [name, address, phone]
      )
    );
  },

  async update(
    id: number,
    name: string,
    address: NullableString,
    phone: NullableString
  ): Promise<QueryResult> {
    return await runExclusive((raw) =>
      raw.execute(
        'UPDATE merchants SET name = $1, address = $2, phone = $3 WHERE id = $4',
        [name, address, phone, id]
      )
    );
  },

  async delete(id: number): Promise<QueryResult> {
    return await runExclusive((raw) =>
      raw.execute('DELETE FROM merchants WHERE id = $1', [id])
    );
  }
};

export const productService = {
  async getAll(): Promise<Product[]> {
    return await runExclusive((raw) =>
      raw.select<Product[]>('SELECT id, name FROM products ORDER BY name ASC')
    );
  },

  async create(name: string): Promise<QueryResult> {
    return await runExclusive((raw) =>
      raw.execute('INSERT INTO products (name) VALUES ($1)', [name])
    );
  },

  async update(id: number, name: string): Promise<QueryResult> {
    return await runExclusive((raw) =>
      raw.execute('UPDATE products SET name = $1 WHERE id = $2', [name, id])
    );
  },

  async delete(id: number): Promise<QueryResult> {
    return await runExclusive((raw) =>
      raw.execute('DELETE FROM products WHERE id = $1', [id])
    );
  }
};

export const boxService = {
  async getAll(): Promise<Box[]> {
    return await runExclusive((raw) =>
      raw.select<Box[]>(
        'SELECT id, name, weight, is_visible FROM boxes ORDER BY name ASC'
      )
    );
  },

  async getVisible(): Promise<Box[]> {
    return await runExclusive((raw) =>
      raw.select<Box[]>(
        'SELECT id, name, weight, is_visible FROM boxes WHERE is_visible = 1 ORDER BY name ASC'
      )
    );
  },

  async create(name: string, weight: number): Promise<QueryResult> {
    return await runExclusive((raw) =>
      raw.execute('INSERT INTO boxes (name, weight) VALUES ($1, $2)', [name, weight])
    );
  },

  async update(
    id: number,
    name: string,
    weight: number,
    is_visible: number
  ): Promise<QueryResult> {
    return await runExclusive((raw) =>
      raw.execute(
        'UPDATE boxes SET name = $1, weight = $2, is_visible = $3 WHERE id = $4',
        [name, weight, is_visible, id]
      )
    );
  },

  // إظهار صناديق مخفية (is_visible: 0 → 1) دون المساس باسمها أو وزنها — تُستخدَم
  // من ميزة "نسخ بند إلى نموذج الإدخال" (InvoiceForm.tsx) لإرجاع الصناديق
  // المخفية المستخدَمة في البند المنسوخ إلى قائمة الصناديق النشطة. الشرط
  // `AND is_visible = 0` يجعل العملية no-op فعلية للصناديق الظاهرة أصلاً، فلا
  // يُكتَب شيء إلا لما يلزم إظهاره فعلاً. تُعيد عدد الصفوف التي تغيّرت.
  async revealBoxes(ids: number[]): Promise<number> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return 0;

    const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(', ');
    const result = await runExclusive((raw) =>
      raw.execute(
        `UPDATE boxes SET is_visible = 1 WHERE id IN (${placeholders}) AND is_visible = 0`,
        uniqueIds
      )
    );
    return result.rowsAffected;
  },

  async delete(id: number): Promise<QueryResult> {
    return await runExclusive((raw) =>
      raw.execute('DELETE FROM boxes WHERE id = $1', [id])
    );
  }
};

export const invoiceService = {
  // ── دورة حياة الفاتورة + الترقيم المجمَّد (القسم 3 و5.2 من مهمة هذا الجزء) ──
  // تُستدعى عند إدراج أول بند فعلي في فاتورة جديدة قيد الإنشاء. القاعدة
  // الثابتة المعتمَدة: invoiceId !== null ⟺ rows.length > 0، لذا وجود أول بند
  // هو ما يُنشئ الفاتورة فعلياً في القاعدة (لا قبل ذلك). كامل العملية —
  // بما فيها حلقة withInvoiceNumberRetry — تحت استدعاء runExclusive واحد.
  async createInvoiceWithFirstDetail(
    merchantId: number,
    invoiceDate: string,
    detail: CreateInvoiceDetail
  ): Promise<CreateInvoiceWithFirstDetailResult> {
    const { year, month } = deriveYearMonth(invoiceDate);

    return await runExclusive((raw) =>
      withInvoiceNumberRetry(
        raw,
        merchantId,
        year,
        month,
        async (nextCounter, invoiceNumber) => {
          // تحقّق مرجعي (راجع التعليق أعلى assertMerchantExists) قبل أي كتابة —
          // داخل نفس معاملة هذه المحاولة تحديداً، فيُلغى كل شيء نظيفاً بـ
          // ROLLBACK (ضمن withInvoiceNumberRetry) إن فشل، بلا أي أثر جزئي.
          await assertMerchantExists(raw, merchantId);
          await assertBoxesExist(raw, detail.boxes.map((box) => box.box_id));

          const invoiceResult = await raw.execute(
            `INSERT INTO invoices (
              merchant_id, invoice_date, total_amount, is_open,
              number_year, number_month, number_merchant_id, number_counter, invoice_number
            ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8)`,
            [
              merchantId,
              invoiceDate,
              detail.subtotal,
              year,
              month,
              merchantId,
              nextCounter,
              invoiceNumber
            ]
          );
          const invoiceId = requireLastInsertId(invoiceResult, 'invoice');

          // نلتقط detailId فوراً من هذا الـ INSERT تحديداً، قبل إدراج صفوف
          // صناديقه، لأن lastInsertId يتغيّر مع كل إدراج تالٍ ضمن نفس المعاملة.
          const detailResult = await raw.execute(
            'INSERT INTO invoice_details (invoice_id, product_name, quantity, price, subtotal) VALUES ($1, $2, $3, $4, $5)',
            [invoiceId, detail.product_name, detail.quantity, detail.price, detail.subtotal]
          );
          const detailId = requireLastInsertId(detailResult, 'invoice detail');

          for (const box of detail.boxes) {
            await raw.execute(
              'INSERT INTO invoice_detail_boxes (invoice_detail_id, box_id, box_count) VALUES ($1, $2, $3)',
              [detailId, box.box_id, box.box_count]
            );
          }

          return { invoiceId, invoiceNumber, year, month, counter: nextCounter, detailId };
        }
      )
    );
  },

  // تُستخدَم لكل بند بعد الأول، سواء في إنشاء فاتورة جديدة أو تعديل موجودة —
  // بلا فرق، هذا هو التوحيد الفعلي على مستوى البيانات (سيُستهلَك من الجزء
  // الثاني). لاحظ: merchant_id الحي فقط، لا أعمدة الترقيم المجمَّدة.
  async appendDetail(
    invoiceId: number,
    merchantId: number,
    totalAmount: number,
    detail: CreateInvoiceDetail
  ): Promise<number> {
    return await runExclusive((raw) =>
      executeInTransaction(raw, async () => {
        // تحقّق مرجعي (راجع التعليق أعلى assertMerchantExists) قبل أي كتابة —
        // ضمن نفس المعاملة، فيُلغى كل شيء نظيفاً بـ ROLLBACK إن فشل.
        await assertMerchantExists(raw, merchantId);
        await assertBoxesExist(raw, detail.boxes.map((box) => box.box_id));

        await raw.execute(
          'UPDATE invoices SET merchant_id = $1, total_amount = $2 WHERE id = $3',
          [merchantId, totalAmount, invoiceId]
        );

        // نلتقط id الحقيقي لصف invoice_details فور إدراجه، قبل إدراج صفوف
        // صناديقه — بنفس آلية الالتقاط في createInvoiceWithFirstDetail أعلاه.
        const detailResult = await raw.execute(
          'INSERT INTO invoice_details (invoice_id, product_name, quantity, price, subtotal) VALUES ($1, $2, $3, $4, $5)',
          [invoiceId, detail.product_name, detail.quantity, detail.price, detail.subtotal]
        );
        const detailId = requireLastInsertId(detailResult, 'invoice detail');

        for (const box of detail.boxes) {
          await raw.execute(
            'INSERT INTO invoice_detail_boxes (invoice_detail_id, box_id, box_count) VALUES ($1, $2, $3)',
            [detailId, box.box_id, box.box_count]
          );
        }

        return detailId;
      })
    );
  },

  // حذف تفصيل واحد (غير الأخير في الفاتورة) + تحديث merchant_id/total_amount،
  // ضمن معاملة واحدة. حماية إلزامية: نرفض الحذف صراحة إن كان هذا آخر بند
  // متبقٍّ، لضمان القاعدة الثابتة (invoiceId !== null ⟺ rows.length > 0) على
  // مستوى قاعدة البيانات نفسها، لا الاعتماد فقط على انضباط واجهة الجزء الثاني.
  async deleteDetailAndTouch(
    invoiceId: number,
    detailId: number,
    merchantId: number,
    totalAmount: number
  ): Promise<QueryResult> {
    return await runExclusive((raw) =>
      executeInTransaction(raw, async () => {
        const countRows = await raw.select<{ count: number }[]>(
          'SELECT COUNT(*) AS count FROM invoice_details WHERE invoice_id = $1',
          [invoiceId]
        );
        const detailsCount = countRows[0]?.count ?? 0;

        if (detailsCount <= 1) {
          throw new Error(
            'لا يمكن حذف آخر بند متبقٍّ في الفاتورة عبر deleteDetailAndTouch — ' +
            'استخدم invoiceService.deleteInvoice لحذف الفاتورة بالكامل بدلاً من ذلك.'
          );
        }

        await raw.execute(
          'DELETE FROM invoice_detail_boxes WHERE invoice_detail_id = $1',
          [detailId]
        );
        const deleteResult = await raw.execute(
          'DELETE FROM invoice_details WHERE id = $1 AND invoice_id = $2',
          [detailId, invoiceId]
        );

        await raw.execute(
          'UPDATE invoices SET merchant_id = $1, total_amount = $2 WHERE id = $3',
          [merchantId, totalAmount, invoiceId]
        );

        return deleteResult;
      })
    );
  },

  async setOpenState(invoiceId: number, isOpen: number): Promise<QueryResult> {
    return await runExclusive((raw) =>
      raw.execute('UPDATE invoices SET is_open = $1 WHERE id = $2', [isOpen, invoiceId])
    );
  },

  // كل فاتورة is_open=1 بتفاصيلها الكاملة. تستدعي getInvoiceFullDetails لكل id
  // ضمن حلقة بسيطة — كافٍ تماماً لحجم بيانات هذا التطبيق (قاعدة SQLite محلية،
  // وعدد الفواتير المفتوحة محدود بعدد تبويبات وزّان واحد). الاستعلام الأولي
  // فقط محجوز بـ runExclusive خاص به؛ الحلقة نفسها تبقى خارج أي حصرية لأن كل
  // نداء getInvoiceFullDetails يحجز حصريته الخاصة به بالتتابع (لا تداخل ممكن
  // لأن هذه دالة مُصدَّرة أخرى تُستدعى تباعاً، لا من داخل work لاستدعاء
  // runExclusive قائم بالفعل).
  async getOpenInvoices(): Promise<InvoiceFullDetails[]> {
    const openRows = await runExclusive((raw) =>
      raw.select<{ id: number }[]>(
        'SELECT id FROM invoices WHERE is_open = 1 ORDER BY invoice_date DESC, id DESC'
      )
    );

    const results: InvoiceFullDetails[] = [];
    for (const row of openRows) {
      const full = await invoiceService.getInvoiceFullDetails(row.id);
      if (full) {
        results.push(full);
      }
    }
    return results;
  },

  // نفس منطق جلب التفاصيل الكاملة في getInvoiceFullDetails، لكن المطابقة على
  // invoice_number (مطابقة تامة) بدل id.
  async getInvoiceFullDetailsByNumber(
    invoiceNumber: string
  ): Promise<InvoiceFullDetails | null> {
    return await runExclusive(async (raw) => {
      const invoices = await raw.select<InvoiceWithMerchant[]>(
        `SELECT
          invoices.id,
          invoices.merchant_id,
          invoices.invoice_date,
          invoices.total_amount,
          invoices.is_open,
          invoices.invoice_number,
          invoices.number_year,
          invoices.number_month,
          invoices.number_merchant_id,
          invoices.number_counter,
          merchants.name AS merchant_name,
          merchants.phone AS merchant_phone,
          merchants.address AS merchant_address
        FROM invoices
        LEFT JOIN merchants ON merchants.id = invoices.merchant_id
        WHERE invoices.invoice_number = $1
        LIMIT 1`,
        [invoiceNumber]
      );
      const invoice = invoices[0];

      if (!invoice) {
        return null;
      }

      const details = await fetchInvoiceDetailsFull(raw, invoice.id);

      return {
        ...invoice,
        details
      };
    });
  },

  // مستقلة تماماً عن أي عملية بند — تُستدعى فور اختيار تاجر جديد من قائمة
  // الاقتراحات في فاتورة محفوظة بالفعل.
  async updateMerchant(invoiceId: number, merchantId: number): Promise<QueryResult> {
    return await runExclusive((raw) =>
      executeInTransaction(raw, async () => {
        // نفس التحقّق المرجعي المطبَّق على الإدراج (راجع التعليق أعلى
        // assertMerchantExists) — دفاع إضافي منخفض الكلفة لنفس فئة الثغرة، رغم
        // أن قائمة الاقتراحات هنا حيّة أصلاً (merchants مُحدَّثة عبر
        // refreshMerchants في App.tsx)، فاحتمال التعارض الزمني أضيق بكثير من
        // حالة draft.boxes المجمَّدة.
        await assertMerchantExists(raw, merchantId);
        return await raw.execute(
          'UPDATE invoices SET merchant_id = $1 WHERE id = $2',
          [merchantId, invoiceId]
        );
      })
    );
  },

  // الحماية الوحيدة الفعلية حالياً ضد حذف تاجر له فواتير (راجع تعليق القسم 4.1
  // أعلى loadRawDb) — تحقّق من استدعائها فعلياً قبل أي حذف تاجر مستقبلاً.
  async merchantHasInvoices(merchantId: number): Promise<boolean> {
    return await runExclusive(async (raw) => {
      const rows = await raw.select<{ count: number }[]>(
        'SELECT COUNT(*) AS count FROM invoices WHERE merchant_id = $1',
        [merchantId]
      );
      return (rows[0]?.count ?? 0) > 0;
    });
  },

  // الحماية الوحيدة الفعلية حالياً ضد حذف صندوق مُستخدَم في أي فاتورة (مفتوحة
  // أو مغلقة) — القسم 3 نقطة 17 من مهمة الجزء الثاني. لا اعتماد على أن قاعدة
  // البيانات سترفض العملية تلقائياً (PRAGMA foreign_keys غير مفعَّل عمداً،
  // راجع تعليق القسم 4.1 أعلى loadRawDb). تحقّق من استدعائها فعلياً قبل أي حذف
  // صندوق مستقبلاً (BoxesPage.tsx).
  async boxHasInvoiceReferences(boxId: number): Promise<boolean> {
    return await runExclusive(async (raw) => {
      const rows = await raw.select<{ count: number }[]>(
        'SELECT COUNT(*) AS count FROM invoice_detail_boxes WHERE box_id = $1',
        [boxId]
      );
      return (rows[0]?.count ?? 0) > 0;
    });
  },

  // الترقيم الكسول للفواتير القديمة (بلا رقم بعد). إن كان invoice_number
  // موجوداً بالفعل تُرجِعه فوراً بلا أي كتابة. وإلا، تشتق year/month من
  // invoice_date المخزَّن فعلياً في هذا الصف نفسه (تاريخ إصدار الفاتورة
  // الأصلي) — لا من تاريخ اليوم وقت هذا الاستدعاء — وتستخدم merchant_id
  // الحالي كلقطة تجميد جديدة (أفضل تقريب متاح لفاتورة قديمة بلا لقطة أصلية).
  // الفحص الأولي وحلقة withInvoiceNumberRetry معاً تحت استدعاء runExclusive
  // واحد — لا فجوة زمنية بينهما يمكن أن تتسلل خلالها معاملة أخرى (بخلاف تصميم
  // بديل يُقفِل الفحص الأولي بمعزل عن الحلقة).
  async ensureInvoiceNumbered(invoiceId: number): Promise<EnsureInvoiceNumberedResult> {
    return await runExclusive(async (raw) => {
      const rows = await raw.select<{
        invoice_number: NullableString;
        invoice_date: string;
        merchant_id: number;
        number_year: NullableNumber;
        number_month: NullableNumber;
        number_counter: NullableNumber;
      }[]>(
        `SELECT invoice_number, invoice_date, merchant_id, number_year, number_month, number_counter
         FROM invoices WHERE id = $1 LIMIT 1`,
        [invoiceId]
      );
      const row = rows[0];

      if (!row) {
        throw new Error(`Invoice ${invoiceId} not found.`);
      }

      if (row.invoice_number !== null) {
        return {
          invoiceNumber: row.invoice_number,
          // مضمونة الوجود لأنها تُكتب دوماً مع invoice_number في نفس العملية.
          year: row.number_year as number,
          month: row.number_month as number,
          counter: row.number_counter as number,
          merchantId: row.merchant_id
        };
      }

      const { year, month } = deriveYearMonth(row.invoice_date);
      const merchantId = row.merchant_id;

      return await withInvoiceNumberRetry(
        raw,
        merchantId,
        year,
        month,
        async (nextCounter, invoiceNumber) => {
          await raw.execute(
            `UPDATE invoices
             SET number_year = $1, number_month = $2, number_merchant_id = $3,
                 number_counter = $4, invoice_number = $5
             WHERE id = $6`,
            [year, month, merchantId, nextCounter, invoiceNumber, invoiceId]
          );

          return { invoiceNumber, year, month, counter: nextCounter, merchantId };
        }
      );
    });
  },

  async getInvoicesWithPagination(
    limit: number,
    offset: number
  ): Promise<InvoiceWithMerchant[]> {
    return await runExclusive((raw) =>
      raw.select<InvoiceWithMerchant[]>(
        `SELECT
          invoices.id,
          invoices.merchant_id,
          invoices.invoice_date,
          invoices.total_amount,
          invoices.is_open,
          invoices.invoice_number,
          invoices.number_year,
          invoices.number_month,
          invoices.number_merchant_id,
          invoices.number_counter,
          merchants.name AS merchant_name,
          merchants.phone AS merchant_phone,
          merchants.address AS merchant_address
        FROM invoices
        LEFT JOIN merchants ON merchants.id = invoices.merchant_id
        ORDER BY invoices.invoice_date DESC, invoices.id DESC
        LIMIT $1 OFFSET $2`,
        [limit, offset]
      )
    );
  },

  // البحث والعدّ يتمان في قاعدة البيانات نفسها، حتى لا يظهر للمستخدم أن
  // الأرشيف فارغ لمجرد أن النتيجة المطلوبة تقع في صفحة أخرى.
  async searchInvoices({
    search,
    limit,
    offset,
    dateFrom,
    dateTo,
  }: SearchInvoicesOptions): Promise<SearchInvoicesResult> {
    return await runExclusive(async (raw) => {
      const term = `%${search.trim()}%`;
      // "" تُعامَل معاملة "بلا حد" تماماً كـ undefined — الواجهة تمرر نصاً
      // فارغاً عند عدم اختيار المستخدم لأي طرف من الحقلين.
      const from = dateFrom?.trim() ? dateFrom.trim() : null;
      const to = dateTo?.trim() ? dateTo.trim() : null;
      // شرط النص (OR بين الحقول) وشرط نطاق التاريخ (AND مستقل) — الفلترتان
      // تعملان معاً تراكمياً، لا بديلتان عن بعضهما. $2 IS NULL / $3 IS NULL
      // يجعلان كل طرف من النطاق اختيارياً حقاً على مستوى SQL نفسه، بدل بناء
      // نص الاستعلام شرطياً بالجافاسكريبت.
      const where = `
        (
          CAST(invoices.id AS TEXT) LIKE $1
          OR COALESCE(invoices.invoice_number, '') LIKE $1
          OR COALESCE(merchants.name, '') LIKE $1
          OR COALESCE(merchants.phone, '') LIKE $1
        )
        AND ($2 IS NULL OR invoices.invoice_date >= $2)
        AND ($3 IS NULL OR invoices.invoice_date <= $3)
      `;

      const items = await raw.select<InvoiceWithMerchant[]>(
          `SELECT
            invoices.id,
            invoices.merchant_id,
            invoices.invoice_date,
            invoices.total_amount,
            invoices.is_open,
            invoices.invoice_number,
            invoices.number_year,
            invoices.number_month,
            invoices.number_merchant_id,
            invoices.number_counter,
            merchants.name AS merchant_name,
            merchants.phone AS merchant_phone,
            merchants.address AS merchant_address
          FROM invoices
          LEFT JOIN merchants ON merchants.id = invoices.merchant_id
          WHERE ${where}
          ORDER BY invoices.invoice_date DESC, invoices.id DESC
          LIMIT $4 OFFSET $5`,
          [term, from, to, limit, offset]
        );
      const countRows = await raw.select<{ total: number }[]>(
          `SELECT COUNT(*) AS total
           FROM invoices
           LEFT JOIN merchants ON merchants.id = invoices.merchant_id
           WHERE ${where}`,
          [term, from, to]
        );

      return { items, totalCount: countRows[0]?.total ?? 0 };
    });
  },

  async getMerchantInvoices(merchantId: number): Promise<InvoiceWithMerchant[]> {
    return await runExclusive((raw) =>
      raw.select<InvoiceWithMerchant[]>(
        `SELECT
          invoices.id,
          invoices.merchant_id,
          invoices.invoice_date,
          invoices.total_amount,
          merchants.name AS merchant_name,
          merchants.phone AS merchant_phone,
          merchants.address AS merchant_address
        FROM invoices
        LEFT JOIN merchants ON merchants.id = invoices.merchant_id
        WHERE invoices.merchant_id = $1
        ORDER BY invoices.invoice_date DESC, invoices.id DESC`,
        [merchantId]
      )
    );
  },

  async getInvoiceFullDetails(
    invoiceId: number
  ): Promise<InvoiceFullDetails | null> {
    return await runExclusive(async (raw) => {
      const invoices = await raw.select<InvoiceWithMerchant[]>(
        `SELECT
          invoices.id,
          invoices.merchant_id,
          invoices.invoice_date,
          invoices.total_amount,
          invoices.is_open,
          invoices.invoice_number,
          invoices.number_year,
          invoices.number_month,
          invoices.number_merchant_id,
          invoices.number_counter,
          merchants.name AS merchant_name,
          merchants.phone AS merchant_phone,
          merchants.address AS merchant_address
        FROM invoices
        LEFT JOIN merchants ON merchants.id = invoices.merchant_id
        WHERE invoices.id = $1
        LIMIT 1`,
        [invoiceId]
      );
      const invoice = invoices[0];

      if (!invoice) {
        return null;
      }

      // هنا قمنا بالاعتماد المباشر على الحقل المخزن بالجدول invoice_details.product_name
      // دون الحاجة لربط مصلحي (LEFT JOIN products) لإحضار الاسم
      const details = await fetchInvoiceDetailsFull(raw, invoiceId);

      return {
        ...invoice,
        details
      };
    });
  },

  async deleteInvoice(id: number): Promise<QueryResult> {
    return await runExclusive((raw) =>
      executeInTransaction(raw, async () => {
        await raw.execute(
          `DELETE FROM invoice_detail_boxes
          WHERE invoice_detail_id IN (
            SELECT id FROM invoice_details WHERE invoice_id = $1
          )`,
          [id]
        );
        await raw.execute('DELETE FROM invoice_details WHERE invoice_id = $1', [id]);
        return await raw.execute('DELETE FROM invoices WHERE id = $1', [id]);
      })
    );
  },

  // ── صيانة الأرشيف الصامتة (AI_CONTEXT.md القسم 6.8) ──
  // تُستدعى مرة واحدة عند إقلاع التطبيق من App.tsx، بلا أي تفاعل مع المستخدم.
  // إن تجاوز إجمالي الفواتير (مفتوحة + مغلقة) العتبة، تحذف أقدم دفعة من الفواتير
  // المغلقة فقط (is_open = 0) بترتيب id ASC حصراً — المفتوحة مستثناة تماماً.
  //
  // الفحص والحذف و VACUUM كلها تحت استدعاء runExclusive واحد: لا يمكن لأي عملية
  // DB أخرى أن تتسلل بين العدّ والحذف، ولا أن تكون معاملة أخرى مفتوحة أثناء VACUUM
  // (يتطلب VACUUM عدم وجود معاملات نشطة على أي اتصال في الـ pool).
  //
  // ⚠️ VACUUM لا يعمل داخل معاملة في SQLite ("cannot VACUUM from within a
  // transaction") — لذا يُنفَّذ مباشرة بعد COMMIT لا قبله. الحذف يكون مُثبَّتاً
  // ودائماً بحلول ذلك الوقت، فأي فشل في VACUUM (مثلاً مساحة قرص غير كافية) يُسجَّل
  // فقط ولا يُلغي الحذف ولا يُرفَع للمستدعي.
  async pruneArchiveIfNeeded(): Promise<ArchivePruneResult> {
    return await runExclusive(async (raw) => {
      const totalRows = await raw.select<{ total: number }[]>(
        'SELECT COUNT(*) AS total FROM invoices'
      );
      if ((totalRows[0]?.total ?? 0) <= ARCHIVE_PRUNE_THRESHOLD) {
        return { deleted: 0, vacuumed: false };
      }

      const deleted = await executeInTransaction(raw, async () => {
        // اختيار المعرّفات مرة واحدة داخل المعاملة نفسها، ثم استخدام نفس القائمة
        // في الجداول الثلاثة — تضمن أن كل الجداول تُنظَّف لنفس المجموعة تماماً.
        const idRows = await raw.select<{ id: number }[]>(
          'SELECT id FROM invoices WHERE is_open = 0 ORDER BY id ASC LIMIT $1',
          [ARCHIVE_PRUNE_BATCH]
        );
        if (idRows.length === 0) {
          return 0;
        }

        const ids = idRows.map((row) => row.id);
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');

        // الترتيب: الأبناء الأعمق أولاً ثم الآباء (نفس ترتيب deleteInvoice).
        await raw.execute(
          `DELETE FROM invoice_detail_boxes
           WHERE invoice_detail_id IN (
             SELECT id FROM invoice_details WHERE invoice_id IN (${placeholders})
           )`,
          ids
        );
        await raw.execute(
          `DELETE FROM invoice_details WHERE invoice_id IN (${placeholders})`,
          ids
        );
        await raw.execute(
          `DELETE FROM invoices WHERE id IN (${placeholders})`,
          ids
        );

        return ids.length;
      });

      if (deleted === 0) {
        return { deleted: 0, vacuumed: false };
      }

      let vacuumed = false;
      try {
        await raw.execute('VACUUM');
        vacuumed = true;
      } catch (error: unknown) {
        console.error('تعذّر تنفيذ VACUUM بعد تنظيف الأرشيف (الحذف تمّ بنجاح):', error);
      }

      return { deleted, vacuumed };
    });
  }
};
// ============================================================================
// ميزة «مزامنة الهاتف» (AI_CONTEXT.md القسم 10) — الجزء الوحيد منها الذي يكتب في
// SQLite الرئيسية، وهو دالة واحدة تُستدعى حصراً بعد مراجعة المستخدم وتأكيده.
// بقية الميزة (src/features/phone-sync/) لا تلمس القاعدة إطلاقاً. وُضعت الدالة
// هنا — لا داخل مجلد الميزة — لأن قاعدة المشروع (القسم 8): كل SQL في db.ts، وهي
// تحتاج مساعدات هذا الملف الداخلية (runExclusive، withInvoiceNumberRetry،
// assertMerchantExists...) لتولّد رقم الفاتورة بنفس النظام الحالي تماماً.
// ============================================================================

export interface PhoneImportLine {
  productName: string;
  quantity: number; // الوزن الصافي بعد إعادة الحساب ببيانات الكمبيوتر الحالية
  price: number;
  subtotal: number;
  boxes: CreateInvoiceDetailBox[];
}

export interface PhoneImportInput {
  clientId: string; // المعرّف الفريد للفاتورة على الهاتف (منع التكرار)
  merchantId: number;
  invoiceDate: string; // YYYY-MM-DD
  totalAmount: number;
  lines: PhoneImportLine[];
}

export interface PhoneImportResult {
  invoiceId: number;
  invoiceNumber: string;
  // true = كانت الفاتورة محفوظة فعلاً من محاولة سابقة (انقطع التأكيد بعد الحفظ)؛
  // لم يُكتَب شيء جديد.
  alreadyImported: boolean;
}

// حذف صفوف فاتورة (وبنودها وصناديق بنودها) — داخلياً فقط، تحت runExclusive قائم.
async function deleteInvoiceRowsRaw(raw: RawDatabaseConnection, invoiceId: number): Promise<void> {
  await raw.execute(
    `DELETE FROM invoice_detail_boxes
     WHERE invoice_detail_id IN (SELECT id FROM invoice_details WHERE invoice_id = $1)`,
    [invoiceId]
  );
  await raw.execute('DELETE FROM invoice_details WHERE invoice_id = $1', [invoiceId]);
  await raw.execute('DELETE FROM invoices WHERE id = $1', [invoiceId]);
}

export const phoneImportService = {
  // هل سبق استيراد هذه الفاتورة (بمعرّف الهاتف) كاملةً؟ للقراءة فقط.
  async findImported(clientId: string): Promise<{ invoiceId: number; invoiceNumber: string | null } | null> {
    return await runExclusive(async (raw) => {
      const rows = await raw.select<{ id: number; invoice_number: NullableString }[]>(
        'SELECT id, invoice_number FROM invoices WHERE source_client_id = $1 LIMIT 1',
        [clientId]
      );
      return rows[0] ? { invoiceId: rows[0].id, invoiceNumber: rows[0].invoice_number } : null;
    });
  },

  // يحفظ فاتورة قادمة من الهاتف كفاتورة حقيقية مغلقة (is_open = 0) برقم جديد من
  // نظام الترقيم الحالي. آمنة لإعادة الاستدعاء بنفس clientId:
  //  • الوسم source_client_id يُكتَب داخل نفس عبارة INSERT للفاتورة (ذرّي)، والفهرس
  //    الفريد uq_invoices_source_client يمنع أي نسخة ثانية.
  //  • tauri-plugin-sql لا يقدّم معاملة حقيقية عبر استدعاءات متتالية (راجع تعليق
  //    executeInTransaction)، فقد ينقطع التيار بعد إدراج الفاتورة وقبل اكتمال
  //    بنودها. لذلك: عند وجود فاتورة بهذا الوسم نتحقق من اكتمال بنودها وصناديقها؛
  //    إن اكتملت تُعاد كما هي (alreadyImported)، وإن لم تكتمل تُحذَف بقاياها
  //    (فاتورة وسمناها نحن ولم تُفتَح قط) ثم تُعاد المحاولة من الصفر.
  //  • فحوصات المراجع (تاجر/صناديق) قبل أي كتابة، كباقي الدوال (StaleReferenceError).
  async importInvoice(input: PhoneImportInput): Promise<PhoneImportResult> {
    const { year, month } = deriveYearMonth(input.invoiceDate);
    const expectedBoxRows = input.lines.reduce((n, l) => n + l.boxes.length, 0);

    return await runExclusive(async (raw) => {
      const existing = await raw.select<{ id: number; invoice_number: NullableString }[]>(
        'SELECT id, invoice_number FROM invoices WHERE source_client_id = $1 LIMIT 1',
        [input.clientId]
      );

      if (existing.length > 0) {
        const ex = existing[0];
        const d = await raw.select<{ n: number }[]>(
          'SELECT COUNT(*) AS n FROM invoice_details WHERE invoice_id = $1',
          [ex.id]
        );
        const b = await raw.select<{ n: number }[]>(
          `SELECT COUNT(*) AS n FROM invoice_detail_boxes
           WHERE invoice_detail_id IN (SELECT id FROM invoice_details WHERE invoice_id = $1)`,
          [ex.id]
        );
        if (
          ex.invoice_number &&
          (d[0]?.n ?? 0) === input.lines.length &&
          (b[0]?.n ?? 0) === expectedBoxRows
        ) {
          return { invoiceId: ex.id, invoiceNumber: ex.invoice_number, alreadyImported: true };
        }
        await deleteInvoiceRowsRaw(raw, ex.id); // بقايا استيراد منقطع
      }

      return await withInvoiceNumberRetry(
        raw,
        input.merchantId,
        year,
        month,
        async (nextCounter, invoiceNumber): Promise<PhoneImportResult> => {
          await assertMerchantExists(raw, input.merchantId);
          await assertBoxesExist(
            raw,
            input.lines.flatMap((l) => l.boxes.map((box) => box.box_id))
          );

          const invoiceResult = await raw.execute(
            `INSERT INTO invoices (
              merchant_id, invoice_date, total_amount, is_open,
              number_year, number_month, number_merchant_id, number_counter, invoice_number,
              source_client_id
            ) VALUES ($1, $2, $3, 0, $4, $5, $6, $7, $8, $9)`,
            [
              input.merchantId,
              input.invoiceDate,
              input.totalAmount,
              year,
              month,
              input.merchantId,
              nextCounter,
              invoiceNumber,
              input.clientId
            ]
          );
          const invoiceId = requireLastInsertId(invoiceResult, 'invoice');

          try {
            for (const line of input.lines) {
              const detailResult = await raw.execute(
                'INSERT INTO invoice_details (invoice_id, product_name, quantity, price, subtotal) VALUES ($1, $2, $3, $4, $5)',
                [invoiceId, line.productName, line.quantity, line.price, line.subtotal]
              );
              const detailId = requireLastInsertId(detailResult, 'invoice detail');
              for (const box of line.boxes) {
                await raw.execute(
                  'INSERT INTO invoice_detail_boxes (invoice_detail_id, box_id, box_count) VALUES ($1, $2, $3)',
                  [detailId, box.box_id, box.box_count]
                );
              }
            }
          } catch (error: unknown) {
            // فشل في منتصف البنود: لا نترك فاتورة ناقصة وسمناها بمعرّف الهاتف.
            try {
              await deleteInvoiceRowsRaw(raw, invoiceId);
            } catch (cleanupError: unknown) {
              console.error('تعذر تنظيف فاتورة مستوردة ناقصة (ستُنظَّف عند المحاولة التالية):', cleanupError);
            }
            throw error;
          }

          return { invoiceId, invoiceNumber, alreadyImported: false };
        }
      );
    });
  }
};
