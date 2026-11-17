// ============================================================================
// متجر صغير على مستوى الوحدة: المستند الحالي المعروض في #print-root. المحرك
// يكتبه (setJob/clearJob) و<PrintRoot/> يقرؤه عبر useSyncExternalStore ويُبلِغ
// بأنه رسمه (reportRendered) فينتظر المحرك الإشعار بدل التخمين بالمؤقتات.
// ============================================================================

import { PrintError, type PrintDocument } from "./types.ts";

export interface PrintJob {
  id: number;
  doc: PrintDocument;
}

let current: PrintJob | null = null;
let seq = 0;
let renderedId = 0;
const listeners = new Set<() => void>();
const waiters = new Map<number, () => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function getJob(): PrintJob | null {
  return current;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setJob(doc: PrintDocument): PrintJob {
  current = { id: ++seq, doc };
  emit();
  return current;
}

export function clearJob(): void {
  if (current === null) return;
  current = null;
  emit();
}

/** يستدعيها <PrintRoot/> بعد أن يُركَّب المستند في DOM. */
export function reportRendered(id: number): void {
  renderedId = id;
  const waiter = waiters.get(id);
  if (waiter) {
    waiters.delete(id);
    waiter();
  }
}

/** يُنجَز حين يُركَّب المستند ذو المعرّف `id`؛ يرفض إن لم يظهر (PrintRoot غير مركَّب). */
export function waitRendered(id: number, timeoutMs: number): Promise<void> {
  if (renderedId === id) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(id);
      reject(
        new PrintError(
          "NOT_READY",
          "تعذّر تجهيز المستند للطباعة (لم يُركَّب عنصر الطباعة). أعد تشغيل التطبيق وحاول مجدداً.",
        ),
      );
    }, timeoutMs);
    waiters.set(id, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
