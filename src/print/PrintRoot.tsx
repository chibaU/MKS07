// ============================================================================
// <PrintRoot/> — يُركَّب مرة واحدة في main.tsx (داخل ActivationGate، بجانب
// #app-shell). يعرض المستند الحالي في #print-root: مخفي على الشاشة، وهو الوحيد
// الظاهر وقت الطباعة.
//
// الـ<style> الوحيد في المشروع الذي يحمل CSS: قواعد @page و@media print لا يمكن
// كتابتها inline. كل ما عداها أنماط inline داخل المستندات نفسها.
//
// هوامش الصفحة في @page (لا حشوة في غلاف) فتتكرر نفسها في كل صفحة من الفاتورة
// الطويلة. html/body/#root تُفرَض height:auto + overflow:visible وقت الطباعة وإلا
// طُبعت الصفحة الأولى وحدها.
// ============================================================================

import { useLayoutEffect, useSyncExternalStore } from "react";
import { getJob, reportRendered, subscribe } from "./store.ts";
import { renderDocument } from "./registry.tsx";
import { PRINT_CSS } from "./printCss.ts";

export function PrintRoot() {
  const job = useSyncExternalStore(subscribe, getJob, getJob);
  const jobId = job?.id ?? null;

  // قبل الرسم مباشرة: المحرك ينتظر هذا الإشعار قبل أن يطلب الطباعة.
  useLayoutEffect(() => {
    if (jobId !== null) reportRendered(jobId);
  }, [jobId]);

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div id="print-root" dir="rtl">
        {job ? renderDocument(job.doc.type, job.doc.data) : null}
      </div>
    </>
  );
}
