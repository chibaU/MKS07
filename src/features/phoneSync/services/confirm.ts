// ============================================================================
// الاعتماد النهائي: من "فاتورة معلّقة" إلى فاتورة حقيقية في SQLite — **بخدمات db.ts
// الحالية فقط** (نفس الترقيم ونفس التحققات المرجعية ونفس حساب total_amount).
//
// لا توجد معاملة واحدة تشمل مخزن الفواتير المعلّقة (ملفات) وSQLite، لذلك التسلسل
// مصمَّم ليكون قابلاً للاستئناف بعد أي انقطاع:
//   1) pending → saving            (مثبَّت على القرص قبل لمس القاعدة)
//   2) إنشاء الفاتورة + أول بند    ثم تسجيل invoiceId/الرقم فوراً في حالة saving
//   3) إلحاق بقية البنود، تحقق، إغلاقها (is_open = 0)
//   4) saving → confirmed          (سجل القرارات النهائي — هنا فقط تُعدّ "منقولة بأمان")
// فشل قبل (4): الفاتورة الجزئية التي أنشأناها نحن تُحذف ونعود إلى pending؛ وإن تعذّر
// الحذف تبقى saving بمعرّف الفاتورة فيُستأنف/يُتحقّق منها عند فتح الصفحة لاحقاً.
// ============================================================================

import { round2 } from "../../../components/InvoiceShared";
import { invoiceService, StaleReferenceError, type InvoiceFullDetails } from "../../../services/db";
import { bridge, errText } from "../bridge.ts";
import { buildReview, runningTotals, toDetailsToSave, type DetailToSave, type ReferenceData, type ReviewResult } from "../domain/review.ts";
import type { InboxRecord } from "../types.ts";
import { loadReferenceData } from "./data.ts";

const EPS = 0.005;

export function todayLocal(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function reviewFor(rec: InboxRecord, ref: ReferenceData): ReviewResult {
  return buildReview(rec.invoice, ref, { round2, today: todayLocal() });
}

export class ConfirmBlockedError extends Error {
  review: ReviewResult;
  constructor(review: ReviewResult) {
    super("لا يمكن اعتماد الفاتورة: توجد تعارضات تحتاج قرارك");
    this.name = "ConfirmBlockedError";
    this.review = review;
  }
}

export class NeedsAttentionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeedsAttentionError";
  }
}

export type RecoveryOutcome =
  | { kind: "confirmed"; invoiceId: number; invoiceNumber: string }
  | { kind: "reverted" }
  | { kind: "attention"; reason: string };

export interface ConfirmResult {
  invoiceId: number;
  invoiceNumber: string;
}

function friendly(err: unknown): Error {
  if (err instanceof StaleReferenceError) {
    return new Error("تغيّرت بيانات التاجر أو الصناديق أثناء الحفظ. لم يُحفَظ شيء — راجع الفاتورة من جديد.");
  }
  return new Error(errText(err));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await sleep(150 * (i + 1));
    }
  }
  throw last;
}

function sameBoxes(a: { box_id: number; box_count: number }[], b: { box_id: number; box_count: number }[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x.box_id - y.box_id);
  const sb = [...b].sort((x, y) => x.box_id - y.box_id);
  return sa.every((x, i) => x.box_id === sb[i].box_id && x.box_count === sb[i].box_count);
}

function detailMatches(have: InvoiceFullDetails["details"][number], want: DetailToSave): boolean {
  return (
    have.product_name === want.product_name &&
    Math.abs(have.quantity - want.quantity) < EPS &&
    Math.abs(have.price - want.price) < EPS &&
    Math.abs(have.subtotal - want.subtotal) < EPS &&
    sameBoxes(
      have.boxes.map((b) => ({ box_id: b.box_id, box_count: b.box_count })),
      want.boxes,
    )
  );
}

function sortedDetails(full: InvoiceFullDetails) {
  return [...full.details].sort((a, b) => a.id - b.id);
}

async function verifyComplete(invoiceId: number, merchantId: number, details: DetailToSave[], total: number): Promise<void> {
  const full = await invoiceService.getInvoiceFullDetails(invoiceId);
  if (!full) throw new Error("لم يُعثر على الفاتورة بعد حفظها");
  const have = sortedDetails(full);
  if (full.merchant_id !== merchantId) throw new Error("التاجر المحفوظ لا يطابق المتوقّع");
  if (have.length !== details.length) throw new Error("عدد البنود المحفوظة لا يطابق المتوقّع");
  if (!have.every((h, i) => detailMatches(h, details[i]))) throw new Error("بنود الفاتورة المحفوظة لا تطابق المتوقّع");
  if (Math.abs((full.total_amount ?? 0) - total) >= EPS) throw new Error("إجمالي الفاتورة المحفوظ لا يطابق المتوقّع");
}

async function finalize(uid: string, invoiceId: number, invoiceNumber: string, review: ReviewResult): Promise<ConfirmResult> {
  await withRetry(() => bridge.markConfirmed(uid, invoiceId, invoiceNumber, review.merchantName, review.grandTotal));
  return { invoiceId, invoiceNumber };
}

/** يحذف الفاتورة الجزئية التي أنشأناها نحن (فقط) ثم يعيد السجل إلى pending. */
async function rollbackPartial(uid: string, invoiceId: number | null): Promise<void> {
  if (invoiceId !== null) {
    try {
      await invoiceService.deleteInvoice(invoiceId);
    } catch {
      return; // تبقى saving بمعرّفها — يُستأنف لاحقاً بدل التخمين
    }
  }
  try {
    await bridge.abortSave(uid);
  } catch {
    /* يُعاد الفحص عند فتح الصفحة */
  }
}

async function createAndFinish(rec: InboxRecord, review: ReviewResult): Promise<ConfirmResult> {
  const details = toDetailsToSave(review);
  const totals = runningTotals(review, round2);
  let createdId: number | null = null;
  let saved: ConfirmResult;
  try {
    const first = await invoiceService.createInvoiceWithFirstDetail(review.merchantId, review.invoiceDate, details[0]);
    createdId = first.invoiceId;
    await withRetry(() => bridge.recordSaved(rec.uid, first.invoiceId, first.invoiceNumber));
    for (let i = 1; i < details.length; i++) {
      await invoiceService.appendDetail(first.invoiceId, review.merchantId, totals[i], details[i]);
    }
    await verifyComplete(first.invoiceId, review.merchantId, details, totals[totals.length - 1]);
    await invoiceService.setOpenState(first.invoiceId, 0);
    saved = { invoiceId: first.invoiceId, invoiceNumber: first.invoiceNumber };
  } catch (err) {
    await rollbackPartial(rec.uid, createdId);
    throw friendly(err);
  }
  return await finalize(rec.uid, saved.invoiceId, saved.invoiceNumber, review);
}

/** استئناف/إتمام فاتورة حُفظت جزئياً أو كلياً قبل انقطاع، بمعرّفها المسجَّل. */
async function finishExisting(rec: InboxRecord, review: ReviewResult): Promise<RecoveryOutcome> {
  const invoiceId = rec.saving?.invoiceId;
  if (!invoiceId) return { kind: "attention", reason: "لا يوجد معرّف لفاتورة محفوظة جزئياً" };
  const full = await invoiceService.getInvoiceFullDetails(invoiceId);
  if (!full) {
    await bridge.abortSave(rec.uid); // اختفت الفاتورة (حُذفت يدوياً مثلاً) → نعود لـ pending
    return { kind: "reverted" };
  }
  if (!review.canConfirm) {
    return { kind: "attention", reason: "الفاتورة المحفوظة جزئياً لا يمكن إكمالها لأن بيانات الكمبيوتر تغيّرت وظهرت تعارضات — راجع الأرشيف" };
  }
  const details = toDetailsToSave(review);
  const totals = runningTotals(review, round2);
  const have = sortedDetails(full);
  const mismatch =
    full.merchant_id !== review.merchantId ||
    have.length > details.length ||
    !have.every((h, i) => detailMatches(h, details[i]));
  if (mismatch) {
    return { kind: "attention", reason: "الفاتورة المحفوظة جزئياً لا تطابق ما كان متوقعاً (ربما عُدِّلت بعد الانقطاع) — راجعها في الأرشيف" };
  }
  try {
    for (let i = have.length; i < details.length; i++) {
      await invoiceService.appendDetail(invoiceId, review.merchantId, totals[i], details[i]);
    }
    await verifyComplete(invoiceId, review.merchantId, details, totals[totals.length - 1]);
    if (full.is_open) await invoiceService.setOpenState(invoiceId, 0);
  } catch (err) {
    return { kind: "attention", reason: `تعذّر إتمام الحفظ: ${friendly(err).message}` };
  }
  const number = rec.saving?.invoiceNumber ?? full.invoice_number ?? "";
  await finalize(rec.uid, invoiceId, number, review);
  return { kind: "confirmed", invoiceId, invoiceNumber: number };
}

/** الاعتماد من زر "تأكيد وحفظ". يُعيد المراجعة على بيانات اللحظة (لا يثق بمراجعة قديمة). */
export async function confirmRecord(rec: InboxRecord): Promise<ConfirmResult> {
  const ref = await loadReferenceData();
  const review = reviewFor(rec, ref);
  if (!review.canConfirm) throw new ConfirmBlockedError(review);

  const begun = await bridge.beginSave(rec.uid);
  if (rec.state === "saving" || begun.saving?.invoiceId) {
    if (!begun.saving?.invoiceId) {
      throw new NeedsAttentionError("حالة حفظ هذه الفاتورة غير معروفة بعد إغلاق مفاجئ — تحقّق من أرشيف الفواتير قبل إعادة المحاولة");
    }
    const out = await finishExisting(begun, review);
    if (out.kind === "confirmed") return { invoiceId: out.invoiceId, invoiceNumber: out.invoiceNumber };
    if (out.kind === "reverted") return await confirmRecord({ ...rec, state: "pending", saving: null });
    throw new NeedsAttentionError(out.reason);
  }
  return await createAndFinish(begun, review);
}

/** يُشغَّل عند فتح الصفحة لكل سجل بقي saving بعد انقطاع. لا يخمّن أبداً. */
export async function recoverSaving(rec: InboxRecord): Promise<RecoveryOutcome> {
  if (!rec.saving?.invoiceId) {
    return { kind: "attention", reason: "توقّف حفظ هذه الفاتورة فجأة قبل تسجيل رقمها — تحقّق من أرشيف الفواتير ثم اختر إعادة المحاولة أو الرفض" };
  }
  const ref = await loadReferenceData();
  return await finishExisting(rec, reviewFor(rec, ref));
}
