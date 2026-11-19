# نظام الطباعة

الفاتورة مكوّن React ثابت التصميم (A4 عمودي، `src/print/documents/InvoiceA4.tsx`) يُرسَم داخل
صفحة التطبيق نفسها في `#print-root`، ثم تطبعه WebView2 مباشرة. لا قالب Excel ولا LibreOffice ولا
ملفات مؤقتة ولا معاينة داخل التطبيق.

## الوضعان (من الإعدادات ← «طريقة الطباعة»)
- **dialog** (الافتراضي): نافذة طباعة ويندوز (الطابعة، الصفحات، النسخ، الوجهان).
- **direct**: إرسال صامت بلا نافذة إلى الطابعة المختارة في الإعدادات (لا طابعة محفوظة = طابعة ويندوز
  الافتراضية). إن لم تُوجَد الطابعة تُفتح نافذة النظام (`onPrinterUnavailable: 'dialog'`).

## الأولوية والإعدادات
طلب الاستدعاء `printDocument(doc, override)` ‹ الإعدادات المحفوظة ‹ `config.byDocument[type]` ‹
`config.default` (`src/print/print.config.ts`). تُقرأ الإعدادات **طازجة** في كل طباعة.
مفاتيح جدول `settings`: `print_mode` (`dialog`|`direct`، الغائب = الافتراضي)، `invoice_printer_name`
(المفتاح القديم للطابعة)، وبيانات الوزّان `owner_name`، `owner_phone`، `owner_phone_2`
(الأولان مزروعان بقيم مؤقتة في migration 1 فيُعامَلان كفارغين إن لم يُعدَّلا). يُطبَعان (مع الاسم)
في **آخر الفاتورة** بصيغة «ميزان (الاسم)» ثم «للاتصال (الهاتف)»، لا في أعلاها. لا عنوان للوزّان:
عنوانه هو اسم السوق الثابت في أعلى الفاتورة (`MARKET_TITLE` في `InvoiceA4.tsx`)، وmigration 2 يحذف
الصف `owner_address` القديم.

## التدفق
`printInvoice(id, withSummary?)` (`services/print.ts`) تجلب الفاتورة طازجة وبيانات الوزّان ← `printDocument`
(`src/print/index.ts`) ← طابور (مهمة واحدة في كل مرة، وطلب مطابق قيد التنفيذ يُدمَج) ← `store` يضع المستند ←
`<PrintRoot/>` يرسمه ← انتظار الرسم + إطاران + الخطوط + الصور ← أمر Rust `print_webview`
(`src-tauri/src/print/`). `<PrintRoot/>` مركَّب مرة واحدة في `main.tsx` بجانب `#app-shell`
(`display: contents`)، وعنصر `<style>` الوحيد فيه يحمل `@page` و`@media print`. هوامش الصفحة في `@page`.
أخطاء Rust: `UNSUPPORTED` (غير ويندوز) ← `window.print()`؛ `PRINTER_UNAVAILABLE` ← نافذة النظام أو رسالة خطأ.

## تحفّظات معروفة
- **وضع dialog لا يعطي إشارة اكتمال ولا إلغاء**: الوعدة تُنجَز عند فتح النافذة (+400ms). المستند يبقى مركَّباً
  بعدها (النظام يبني مستند الطباعة بعد تأكيد المستخدم) ويُمسَح عند الطباعة التالية.
- وضع direct يُنجِز الوعدة بعد إشعار WebView2 (إرسال المهمة إلى الـspooler، لا خروج الورقة).
- في dialog تُهمَل `copies`/`duplex`/`printerName` (يختارها المستخدم في النافذة).
- مسار ويندوز (`backend/webview2.rs`) لا يُنفَّذ على Ubuntu؛ يُترجَم فقط. اختبره يدوياً على ويندوز 10.
- يتطلب WebView2 Runtime ‏1.0.1518.46+ (`ICoreWebView2_16`).
- نسختا `webview2-com`/`windows` في `Cargo.toml` يجب أن تطابقا ما يحلّه tauri
  (`cargo tree -i webview2-com`): tauri 2.11 ← 0.38/0.61، tauri 2.12 ← 0.39/0.62.

## الاختبارات
`npm run test:print` (المحرك والأولوية وبيانات الوزّان) و`cargo test` (تحقق طلب Rust).

## نقل النظام إلى مشروع Tauri آخر
انسخ `src/print/` (و`src/print/index.ts` بعد استبدال `loadPrintSettings` بقراءة إعداداتك) و
`src-tauri/src/print/`؛ سجّل `print::print_webview` في `invoke_handler`؛ أضف تحت `[target.'cfg(windows)'.dependencies]`
الحزمتين `webview2-com` و`windows` (ميزة `Win32_Foundation`) بنسخ مطابقة لـtauri؛ أضف صلاحية
`core:webview:allow-print`؛ ركّب `<PrintRoot/>` مرة واحدة بجانب غلاف التطبيق `<div id="app-shell" style={{display:'contents'}}>`؛
وأضف مستنداً جديداً بمكوّن في `src/print/documents/` + سطر في `registry.tsx`، ثم استدعِ `printDocument({type,title,data})`.