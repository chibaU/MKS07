// قواعد @page و@media print التي لا يمكن كتابتها inline — يعرضها <PrintRoot/> في
// عنصر <style> واحد. هوامش الصفحة هنا (لا حشوة في غلاف) فتتطابق في كل صفحة.
export const PRINT_CSS = `
@page { size: A4; margin: 12mm 10mm; }
#print-root { display: none; }
@media print {
  html, body, #root { height: auto !important; min-height: 0 !important; overflow: visible !important; background: #fff !important; }
  body > *:not(#root) { display: none !important; }
  #app-shell { display: none !important; }
  #print-root { display: block !important; }
  #print-root, #print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
