// ============================================================================
// خلفية ويندوز: WebView2 (ICoreWebView2_16، يتطلب WebView2 Runtime 1.0.1518.46+).
//
// ⚠️ هذا الملف لا يُترجَم ولا يُنفَّذ على Ubuntu؛ تحقَّقنا منه بـ`cargo check
// --target x86_64-pc-windows-msvc` فقط. سلوكه الفعلي (النافذة، الطباعة الصامتة،
// الهوامش، رمز PRINTER_UNAVAILABLE) غير مُجرَّب حتى يُختبَر على ويندوز 10.
//
// الخيوط: `with_webview` ينفّذ الإغلاق على خيط الواجهة (UI thread) — شرط COM.
// النتيجة تعود عبر قناة std واحدة؛ ننتظرها في spawn_blocking كي لا نحجز خيطاً
// من خيوط الـasync. كل مسار يرسل نتيجة واحدة بالضبط.
//
// الأنواع (ICoreWebView2Controller…) هي أنواع نسخة webview2-com التي يستعملها
// tauri نفسه؛ لذلك يجب أن تطابق نسختا webview2-com/windows في Cargo.toml ما
// يحلّه tauri (تحقق: cargo tree -i webview2-com).
// ============================================================================

use std::sync::mpsc::{self, Sender};
use std::time::Duration;

use tauri::webview::PlatformWebview;
use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2PrintSettings2, ICoreWebView2Environment6, ICoreWebView2_16,
    COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM, COREWEBVIEW2_PRINT_DUPLEX,
    COREWEBVIEW2_PRINT_DUPLEX_DEFAULT, COREWEBVIEW2_PRINT_DUPLEX_ONE_SIDED,
    COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_LONG_EDGE, COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_SHORT_EDGE,
    COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT, COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE,
    COREWEBVIEW2_PRINT_STATUS_SUCCEEDED,
};
use webview2_com::PrintCompletedHandler;
use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::E_ABORT;

use crate::print::request::{Duplex, PrintMode, PrintRequest};
use crate::print::ERR_PRINTER_UNAVAILABLE;

/// A4 بالبوصة (210×297 مم). الهوامش الحقيقية تأتي من `@page` في CSS الصفحة؛
/// هنا نصفّرها كي لا تتراكم فوقها.
const A4_WIDTH_IN: f64 = 8.27;
const A4_HEIGHT_IN: f64 = 11.69;

/// مهلة انتظار إشعار اكتمال الطباعة الصامتة (إرسالها إلى الـspooler، لا خروج الورقة).
const PRINT_TIMEOUT: Duration = Duration::from_secs(180);

type Outcome = Result<(), String>;

pub async fn print(window: WebviewWindow, req: PrintRequest) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Outcome>();

    window
        .with_webview(move |webview| start(webview, req, tx))
        .map_err(|e| format!("تعذّر الوصول إلى مكوّن WebView2 للطباعة: {e}"))?;

    tauri::async_runtime::spawn_blocking(move || match rx.recv_timeout(PRINT_TIMEOUT) {
        Ok(outcome) => outcome,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(
            "تجاوزت الطباعة المهلة المسموحة (3 دقائق) — تحقّق من أن الطابعة متصلة وجاهزة.".to_string(),
        ),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("انقطع مسار الطباعة قبل أن يصل أي إشعار من WebView2.".to_string())
        }
    })
    .await
    .map_err(|e| format!("تعذّر تنفيذ الطباعة: {e}"))?
}

/// يعمل على خيط الواجهة. يضمن إرسال نتيجة واحدة على `tx` في كل المسارات.
fn start(webview: PlatformWebview, req: PrintRequest, tx: Sender<Outcome>) {
    // SAFETY: استدعاءات COM على خيط الواجهة الذي يملك الـWebView.
    let started = unsafe { begin(&webview, &req, &tx) };
    match started {
        Ok(Started::Done) => {
            let _ = tx.send(Ok(()));
        }
        // المعالج سيرسل النتيجة عند اكتمال الطباعة.
        Ok(Started::Pending) => {}
        Err(message) => {
            let _ = tx.send(Err(message));
        }
    }
}

enum Started {
    /// انتهى العمل المتزامن (نافذة النظام فُتحت).
    Done,
    /// الطباعة الصامتة بدأت؛ النتيجة تأتي من معالج الاكتمال.
    Pending,
}

fn hresult_text(e: &windows::core::Error) -> String {
    format!("{:#010X}", e.code().0 as u32)
}

fn step<T>(what: &str, r: windows::core::Result<T>) -> Result<T, String> {
    r.map_err(|e| format!("تعذّرت الطباعة ({what}، رمز {}).", hresult_text(&e)))
}

fn to_wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn duplex_to_native(duplex: Duplex) -> COREWEBVIEW2_PRINT_DUPLEX {
    match duplex {
        Duplex::Default => COREWEBVIEW2_PRINT_DUPLEX_DEFAULT,
        Duplex::OneSided => COREWEBVIEW2_PRINT_DUPLEX_ONE_SIDED,
        Duplex::LongEdge => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_LONG_EDGE,
        Duplex::ShortEdge => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_SHORT_EDGE,
    }
}

unsafe fn begin(
    webview: &PlatformWebview,
    req: &PrintRequest,
    tx: &Sender<Outcome>,
) -> Result<Started, String> {
    let core = step("CoreWebView2", webview.controller().CoreWebView2())?;
    let core16: ICoreWebView2_16 = core.cast().map_err(|_| {
        "إصدار مكوّن WebView2 Runtime على هذا الجهاز قديم؛ حدّثه (يلزم 1.0.1518.46 أو أحدث)."
            .to_string()
    })?;

    match req.mode {
        PrintMode::Dialog => {
            // لا إشارة اكتمال/إلغاء: نعود فور فتح النافذة. النسخ/الطابعة/الوجهين
            // يختارها المستخدم داخل النافذة، فتُهمَل هنا عمداً.
            step("ShowPrintUI", core16.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM))?;
            Ok(Started::Done)
        }
        PrintMode::Direct => {
            let env6: ICoreWebView2Environment6 = webview.environment().cast().map_err(|_| {
                "إصدار مكوّن WebView2 Runtime على هذا الجهاز قديم؛ حدّثه (يلزم 1.0.1518.46 أو أحدث)."
                    .to_string()
            })?;
            let settings = step("CreatePrintSettings", env6.CreatePrintSettings())?;
            step("Orientation", settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT))?;
            step("PageWidth", settings.SetPageWidth(A4_WIDTH_IN))?;
            step("PageHeight", settings.SetPageHeight(A4_HEIGHT_IN))?;
            step("ScaleFactor", settings.SetScaleFactor(1.0))?;
            step("MarginTop", settings.SetMarginTop(0.0))?;
            step("MarginBottom", settings.SetMarginBottom(0.0))?;
            step("MarginLeft", settings.SetMarginLeft(0.0))?;
            step("MarginRight", settings.SetMarginRight(0.0))?;
            step("Backgrounds", settings.SetShouldPrintBackgrounds(true))?;
            step("HeaderFooter", settings.SetShouldPrintHeaderAndFooter(false))?;

            let settings2: ICoreWebView2PrintSettings2 = settings.cast().map_err(|_| {
                "إصدار مكوّن WebView2 Runtime على هذا الجهاز قديم؛ حدّثه (يلزم 1.0.1518.46 أو أحدث)."
                    .to_string()
            })?;
            step("Copies", settings2.SetCopies(req.copies_clamped() as i32))?;
            step("Duplex", settings2.SetDuplex(duplex_to_native(req.duplex_or_default())))?;

            // اسم الطابعة يُمرَّر كما حُفظ تماماً؛ الفارغ لا يُضبط (طابعة ويندوز
            // الافتراضية). `wide` يبقى حياً حتى انتهاء SetPrinterName.
            let wide = req.printer().map(to_wide);
            if let Some(wide) = wide.as_ref() {
                step("PrinterName", settings2.SetPrinterName(PCWSTR(wide.as_ptr())))?;
            }

            let done = tx.clone();
            let handler = PrintCompletedHandler::create(Box::new(move |error_code, status| {
                let outcome = if status == COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE {
                    Err(ERR_PRINTER_UNAVAILABLE.to_string())
                } else if let Err(e) = error_code {
                    Err(format!("فشلت الطباعة المباشرة (رمز {}).", hresult_text(&e)))
                } else if status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED {
                    Ok(())
                } else {
                    Err("فشلت الطباعة المباشرة (خطأ غير محدد من WebView2).".to_string())
                };
                let _ = done.send(outcome);
                Ok(())
            }));

            match core16.Print(&settings, &handler) {
                Ok(()) => Ok(Started::Pending),
                Err(e) if e.code() == E_ABORT => Err(
                    "هناك مهمة طباعة أخرى جارية — انتظر انتهاءها ثم أعد المحاولة.".to_string(),
                ),
                Err(e) => Err(format!("تعذّر بدء الطباعة المباشرة (رمز {}).", hresult_text(&e))),
            }
        }
    }
}
