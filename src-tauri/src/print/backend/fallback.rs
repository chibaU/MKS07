// غير ويندوز (بما فيه جهاز التطوير Ubuntu): لا طباعة أصلية. الواجهة تلتقط
// `UNSUPPORTED` وترجع إلى `window.print()` (تحتاج صلاحية core:webview:allow-print).

use tauri::WebviewWindow;

use crate::print::request::PrintRequest;
use crate::print::ERR_UNSUPPORTED;

pub async fn print(_window: WebviewWindow, _req: PrintRequest) -> Result<(), String> {
    Err(ERR_UNSUPPORTED.to_string())
}
