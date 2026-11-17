// ============================================================================
// الطباعة الأصلية لصفحة التطبيق نفسها (WebView2) — أمر واحد: `print_webview`.
//
// الواجهة (src/print/) تُركِّب المستند في #print-root ثم تستدعي هذا الأمر؛
// Rust لا يعرف قاعدة البيانات ولا شكل الفاتورة، ينفّذ الطباعة فقط:
//   - Dialog : نافذة طباعة النظام (ShowPrintUI/SYSTEM). لا إشارة اكتمال أو إلغاء
//              من WebView2، فيعود الأمر فور استدعاء ShowPrintUI.
//   - Direct : Print(settings) صامتة على الطابعة المحددة (أو الافتراضية)؛ يعود
//              الأمر بعد إشعار اكتمال WebView2.
// رموز الأخطاء التي تفهمها الواجهة (نص حرفي): UNSUPPORTED، PRINTER_UNAVAILABLE.
// أي خطأ آخر نص عربي وصفي.
// ============================================================================

mod backend;
mod request;

use request::PrintRequest;

/// غير ويندوز: لا طباعة أصلية، تعود الواجهة إلى window.print().
#[cfg_attr(windows, allow(dead_code))]
pub const ERR_UNSUPPORTED: &str = "UNSUPPORTED";
/// الطابعة المطلوبة غير متاحة (وضع Direct فقط). تُنتجها خلفية ويندوز وحدها.
#[cfg_attr(not(windows), allow(dead_code))]
pub const ERR_PRINTER_UNAVAILABLE: &str = "PRINTER_UNAVAILABLE";

/// الأمر الوحيد المسجَّل في lib.rs. `async` عمداً: لا يحجز الخيط الرئيسي أثناء
/// انتظار إشعار اكتمال الطباعة.
#[tauri::command]
pub async fn print_webview(
    window: tauri::WebviewWindow,
    req: PrintRequest,
) -> Result<(), String> {
    backend::print(window, req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// الواجهة (src/print/engine.ts) تقارن بهذين النصين حرفياً.
    #[test]
    fn error_codes_match_the_frontend_contract() {
        assert_eq!(ERR_UNSUPPORTED, "UNSUPPORTED");
        assert_eq!(ERR_PRINTER_UNAVAILABLE, "PRINTER_UNAVAILABLE");
    }
}
