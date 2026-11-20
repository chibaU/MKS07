// قواعد @page و@media print التي لا يمكن كتابتها inline — يعرضها <PrintRoot/> في
// عنصر <style> واحد.
//
// @page بلا هوامش (margin: 0) عمداً: الفاتورة تقسّم صفحاتها بنفسها (src/print/paginate.ts)،
// وكل صفحة صندوق بارتفاع ثابت يحمل هوامشه وتذييله (رقم الصفحة ورقم الفاتورة) كنص عادي في
// InvoiceA4.tsx. لا شيء هنا يعتمد على صناديق هوامش @page (@bottom-center…) التي لا يدعمها
// WebKit (WebKitGTK على لينكس، WKWebView على ماك) ولا WebView2 الأقدم من Chromium 131،
// ولا على كسر الصفحات الأصلي الذي يختلف بين المحركات. فتخرج الفاتورة متطابقة في كلها.

export const PRINT_CSS = `
@page {
  size: A4;
  margin: 0;
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
