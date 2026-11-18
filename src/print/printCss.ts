// قواعد @page و@media print التي لا يمكن كتابتها inline — يعرضها <PrintRoot/> في
// عنصر <style> واحد.
//
// الهوامش (PAGE_MARGIN_MM — مصدر الحقيقة الوحيد):
//  - الجانبان (يمين/يسار): داخل المستند نفسه (padding في InvoiceA4) وليس في @page، لأن
//    WebKit (WebKitGTK على لينكس، WKWebView على ماك) يتجاهل هوامش @page تماماً — ظهر ذلك
//    في PDF طُبع من «Save as PDF» على لينكس: المحتوى ملاصق لحافة الورقة. الـpadding يعمل في
//    كل المحركات بالنتيجة نفسها.
//  - الأعلى والأسفل: هنا في @page، لأنها وحدها تُطبَّق على كل صفحة من فاتورة متعددة
//    الصفحات. Chromium (WebView2) يحترمها حتى حين تُمرَّر هوامش طباعة صفرية من Rust
//    (جُرِّب ذلك). أما المحركات التي تتجاهلها فيضيف InvoiceA4 هامش أعلى الصفحة الأولى
//    فقط (padding)؛ صفحات التتمّة وأسفل الصفحات بلا هامش رأسي في تلك المحركات.
//
// ترقيم الصفحات: صندوق هامش @bottom-center (يدعمه Chromium منذ 131). إن كان
// WebView2 Runtime أقدم من ذلك يُتجاهَل بصمت — لا يتأثر شيء آخر. وبالطريقة نفسها
// تضيف الفاتورة رقمها في @top-center لصفحات التتمّة (InvoiceA4.tsx).

export const PAGE_MARGIN_MM = { top: 14, right: 12, bottom: 16, left: 12 } as const;

const m = PAGE_MARGIN_MM;

export const PRINT_CSS = `
@page {
  size: A4;
  margin: ${m.top}mm 0 ${m.bottom}mm 0;
  @bottom-center {
    content: "صفحة " counter(page) " من " counter(pages);
    font-family: 'Cairo', sans-serif;
    font-size: 9pt;
    font-weight: 600;
    color: #000;
    direction: rtl;
    vertical-align: middle;
  }
}
#print-root { display: none; }
@media print {
  html, body, #root { height: auto !important; min-height: 0 !important; overflow: visible !important; background: #fff !important; }
  body > *:not(#root) { display: none !important; }
  #app-shell { display: none !important; }
  #print-root { display: block !important; }
  #print-root, #print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;