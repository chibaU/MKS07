// ============================================================================
// نافذة الطباعة الحقيقية لويندوز (Print Dialog Box) للطباعة العادية للفاتورة
// (AI_CONTEXT.md القسمان 6.7 و8) — بدل الطباعة الصامتة على الطابعة المحفوظة.
//
// الفكرة: خطوتان يقودهما `print.ts` بالتتابع:
//   1) `print_dialog_show`  ← يعرض نافذة الطباعة القياسية (System.Windows.Forms
//      .PrintDialog، بنمط ويندوز 7+) عبر PowerShell ويُعيد الطابعة المختارة وعدد
//      النسخ، أو "ألغى المستخدم". لا يطبع شيئاً.
//   2) `print_invoice_chosen` ← يبني xlsx المُعبَّأ (نفس `build_invoice_xlsx`)
//      ويطبعه بالمسار الصامت الحالي نفسه (`run_soffice_headless_print`) على الطابعة
//      المختارة بعدد النسخ المطلوب.
//
// لماذا PowerShell لا مكتبة `windows`: لا تبعية Cargo جديدة ولا كود unsafe/FFI لا
// يمكن اختباره خارج ويندوز؛ والمشروع يستخدم PowerShell أصلاً (`list_system_printers`).
//
// قيود معروفة (موثَّقة عمداً):
//   - من النافذة نأخذ الطابعة وعدد النسخ فقط. خيارات "تفضيلات" الداخلية للطابعة
//     (ورق، وجهان، جودة) لا تنتقل لأن LibreOffice هو من يطبع بإعدادات الطابعة
//     الافتراضية + A4 عمودي المفروض من القالب.
//   - نطاق الصفحات معطَّل في النافذة (غير مدعوم عبر سطر أوامر LibreOffice).
//   - عدة نسخ = تكرار الطباعة (سطر أوامر LibreOffice لا يدعم عدد نسخ).
//
// **الأوامر `async` + `spawn_blocking` عمداً:** النافذة تبقى مفتوحة ما شاء المستخدم؛
// أمر Tauri غير الـasync يعمل على الخيط الرئيسي فكان سيجمّد نافذة التطبيق كلها.
//
// الأمر القديم `print_invoice_direct` لم يُمَس إطلاقاً: يبقى مساراً احتياطياً
// تستدعيه الواجهة إن تعذّر إظهار النافذة تقنياً، وعلى Linux (جهاز التطوير).
// ============================================================================

use serde::Serialize;
use tauri::AppHandle;

use crate::invoice_template::{build_invoice_xlsx, run_soffice_headless_print, InvoicePrintInput};

/// أقصى عدد نسخ نقبله (حماية من إدخال خاطئ يكرّر الطباعة عشرات المرات).
pub const MAX_COPIES: u32 = 20;

/// أقصى انتظار لبقاء النافذة مفتوحة قبل إنهائها (نافذة منسيّة لا تبقى للأبد).
#[cfg(target_os = "windows")]
const DIALOG_TIMEOUT_SECS: u64 = 30 * 60;

/// نتيجة عرض النافذة كما تصل للواجهة (`status` يحدد الحالة).
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PrintDialogResult {
    /// ضغط المستخدم "طباعة": الطابعة المختارة وعدد النسخ (1..=MAX_COPIES).
    Ok {
        #[serde(rename = "printerName")]
        printer_name: String,
        copies: u32,
    },
    /// ضغط "إلغاء" أو أغلق النافذة: لا تُطبع أي فاتورة ولا يظهر أي خطأ.
    Cancelled,
    /// لا يوجد نظام نوافذ طباعة هنا (غير ويندوز): تعود الواجهة للطباعة الصامتة.
    Unsupported,
    /// لا توجد أي طابعة مثبَّتة على الجهاز.
    NoPrinters,
}

/// يحصر عدد النسخ بين 1 و`MAX_COPIES`.
pub fn clamp_copies(copies: u32) -> u32 {
    copies.clamp(1, MAX_COPIES)
}

/// سكربت PowerShell الذي يعرض النافذة. قيود مقصودة عليه:
///   - ASCII فقط وبلا علامة اقتباس مزدوجة، كي يمرّ كوسيط `-Command` واحد دون
///     أي مشكلة ترميز/اقتباس (اسم الطابعة الافتراضية يصله عبر المتغير
///     `MKS_DEFAULT_PRINTER` لا عبر نص السكربت).
///   - المخرجات سطر واحد: `CANCEL` أو `NOPRINTER` أو `OK:<hex>` حيث hex هو
///     UTF-8 لـJSON `{"printer":..,"copies":..}` (hex يتفادى مشاكل ترميز طرفية
///     ويندوز مع أسماء الطابعات العربية).
///   - نافذة مالكة شفافة صغيرة TopMost في وسط الشاشة تُفعَّل قبل العرض: بدونها
///     قد تظهر نافذة الطباعة خلف نافذة التطبيق لأن العملية الفرعية ليست
///     "الأمامية".
///   - لا نضبط أي خاصية غير مضمونة في كل إصدارات .NET Framework؛ نضبط
///     `UseEXDialog` (نمط ويندوز 7+) و`AllowPrintToFile = false` فقط.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const DIALOG_SCRIPT: &str = r#"$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  if ([System.Drawing.Printing.PrinterSettings]::InstalledPrinters.Count -eq 0) {
    [Console]::Out.Write('NOPRINTER')
    exit 0
  }
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $owner = New-Object System.Windows.Forms.Form
  $owner.FormBorderStyle = 'None'
  $owner.ShowInTaskbar = $false
  $owner.TopMost = $true
  $owner.Opacity = 0
  $owner.StartPosition = 'CenterScreen'
  $owner.Size = New-Object System.Drawing.Size(1, 1)
  $owner.Show()
  $owner.Activate()
  $ps = New-Object System.Drawing.Printing.PrinterSettings
  $wanted = $env:MKS_DEFAULT_PRINTER
  if ($wanted) {
    $candidate = New-Object System.Drawing.Printing.PrinterSettings
    $candidate.PrinterName = $wanted
    if ($candidate.IsValid) { $ps = $candidate }
  }
  $dlg = New-Object System.Windows.Forms.PrintDialog
  $dlg.UseEXDialog = $true
  $dlg.AllowPrintToFile = $false
  $dlg.PrinterSettings = $ps
  $res = $dlg.ShowDialog($owner)
  $owner.Close()
  if ($res -ne [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.Write('CANCEL')
    exit 0
  }
  $copies = [int]$dlg.PrinterSettings.Copies
  if ($copies -lt 1) { $copies = 1 }
  $json = @{ printer = $dlg.PrinterSettings.PrinterName; copies = $copies } | ConvertTo-Json -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $hex = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  [Console]::Out.Write('OK:' + $hex)
} catch {
  [Console]::Error.Write($_.Exception.Message)
  exit 1
}
"#;

/// يفكّ نصاً سداسياً (hex) إلى نص UTF-8.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn hex_decode_utf8(hex: &str) -> Result<String, String> {
    let hex = hex.trim();
    if hex.is_empty() || hex.len() % 2 != 0 {
        return Err("مخرجات نافذة الطباعة غير صالحة (طول غير زوجي).".to_string());
    }
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    let raw = hex.as_bytes();
    for pair in raw.chunks(2) {
        let hi = (pair[0] as char).to_digit(16);
        let lo = (pair[1] as char).to_digit(16);
        match (hi, lo) {
            (Some(h), Some(l)) => bytes.push((h * 16 + l) as u8),
            _ => return Err("مخرجات نافذة الطباعة غير صالحة (محرف غير سداسي).".to_string()),
        }
    }
    String::from_utf8(bytes).map_err(|_| "مخرجات نافذة الطباعة ليست UTF-8 صالحاً.".to_string())
}

/// يحوّل مخرجات سكربت النافذة (stdout) إلى نتيجة. أي شيء غير متوقَّع = خطأ
/// تقني (تعود الواجهة عندها للطباعة الصامتة).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn parse_dialog_output(stdout: &str) -> Result<PrintDialogResult, String> {
    let text = stdout.trim();
    if text == "CANCEL" {
        return Ok(PrintDialogResult::Cancelled);
    }
    if text == "NOPRINTER" {
        return Ok(PrintDialogResult::NoPrinters);
    }
    let Some(hex) = text.strip_prefix("OK:") else {
        return Err(format!("مخرجات نافذة الطباعة غير متوقعة: {}", truncate(text, 120)));
    };
    let json_text = hex_decode_utf8(hex)?;
    let value: serde_json::Value = serde_json::from_str(&json_text)
        .map_err(|e| format!("تعذّر قراءة اختيار نافذة الطباعة: {e}"))?;
    let printer_name = value
        .get("printer")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "لم تُرجع نافذة الطباعة اسم طابعة.".to_string())?;
    let copies_raw = value.get("copies").and_then(|v| v.as_u64()).unwrap_or(1);
    let copies = clamp_copies(u32::try_from(copies_raw).unwrap_or(MAX_COPIES));
    Ok(PrintDialogResult::Ok { printer_name, copies })
}

fn truncate(s: &str, max_chars: usize) -> String {
    let mut out: String = s.chars().take(max_chars).collect();
    if s.chars().count() > max_chars {
        out.push('…');
    }
    out
}

#[cfg(target_os = "windows")]
fn show_dialog_blocking(default_printer: Option<&str>) -> Result<PrintDialogResult, String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let mut cmd = Command::new("powershell");
    // -STA إلزامي: مربعات حوار WinForms تتطلب خيطاً أحادي الشقة (STA).
    cmd.args(["-STA", "-NoProfile", "-NonInteractive", "-Command", DIALOG_SCRIPT]);
    if let Some(name) = default_printer.map(str::trim).filter(|n| !n.is_empty()) {
        cmd.env("MKS_DEFAULT_PRINTER", name);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // لا يؤثر على نافذة الطباعة نفسها (واجهة رسومية)؛ يمنع فقط نافذة الطرفية.
    crate::invoice_template::suppress_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("تعذّر تشغيل PowerShell لعرض نافذة الطباعة: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(DIALOG_TIMEOUT_SECS);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(PrintDialogResult::Cancelled);
                }
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(format!("تعذّر متابعة نافذة الطباعة: {e}")),
        }
    };

    let mut out = String::new();
    if let Some(mut s) = child.stdout.take() {
        let _ = s.read_to_string(&mut out);
    }
    if !status.success() {
        let mut err = String::new();
        if let Some(mut s) = child.stderr.take() {
            let _ = s.read_to_string(&mut err);
        }
        return Err(format!(
            "تعذّر عرض نافذة الطباعة (رمز الخروج: {status}). {}",
            truncate(err.trim(), 300)
        ));
    }
    parse_dialog_output(&out)
}

#[cfg(not(target_os = "windows"))]
fn show_dialog_blocking(_default_printer: Option<&str>) -> Result<PrintDialogResult, String> {
    // جهاز التطوير (Ubuntu): لا نافذة طباعة نظام نعرضها من هنا. الواجهة تعود
    // للطباعة الصامتة القديمة، فيبقى التطوير والاختبار هناك كما كانا.
    Ok(PrintDialogResult::Unsupported)
}

/// يعرض نافذة الطباعة القياسية ويُعيد اختيار المستخدم دون طباعة أي شيء.
/// `default_printer`: الطابعة المحفوظة في الإعدادات — تُحدَّد مسبقاً في النافذة
/// (إن لم تعد موجودة تُستخدم طابعة النظام الافتراضية).
#[tauri::command]
pub async fn print_dialog_show(default_printer: Option<String>) -> Result<PrintDialogResult, String> {
    tauri::async_runtime::spawn_blocking(move || show_dialog_blocking(default_printer.as_deref()))
        .await
        .map_err(|e| format!("تعذّر تنفيذ نافذة الطباعة: {e}"))?
}

/// يبني xlsx الفاتورة المُعبَّأ (نفس منطق الطباعة العادية حرفياً) ويطبعه على
/// الطابعة المختارة `copies` مرة بالتتابع. لا يفتح أي نافذة ولا يمسّ
/// `print_invoice_direct`. أي فشل يوقف الباقي ويذكر رقم النسخة إن تعددت.
#[tauri::command]
pub async fn print_invoice_chosen(
    app: AppHandle,
    data: InvoicePrintInput,
    printer_name: String,
    copies: u32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let xlsx_path = build_invoice_xlsx(&app, &data)?;
        let total = clamp_copies(copies);
        for n in 1..=total {
            run_soffice_headless_print(&app, &xlsx_path, Some(printer_name.as_str())).map_err(|e| {
                if total > 1 {
                    format!("تعذّرت طباعة النسخة {n} من {total}: {e}")
                } else {
                    e
                }
            })?;
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("تعذّر تنفيذ الطباعة: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex_of(s: &str) -> String {
        s.as_bytes().iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn script_is_ascii_without_double_quotes_or_cr() {
        assert!(DIALOG_SCRIPT.is_ascii(), "السكربت يجب أن يكون ASCII فقط");
        assert!(!DIALOG_SCRIPT.contains('"'), "لا علامات اقتباس مزدوجة (تُفسد وسيط -Command)");
        assert!(!DIALOG_SCRIPT.contains('\r'));
        assert!(!DIALOG_SCRIPT.contains('#'), "لا تعليقات داخل السكربت");
        for needle in ["PrintDialog", "UseEXDialog", "ShowDialog($owner)", "MKS_DEFAULT_PRINTER", "OK:"] {
            assert!(DIALOG_SCRIPT.contains(needle), "ينقص السكربت: {needle}");
        }
    }

    #[test]
    fn script_braces_and_quotes_are_balanced() {
        let open = DIALOG_SCRIPT.matches('{').count();
        let close = DIALOG_SCRIPT.matches('}').count();
        assert_eq!(open, close, "أقواس معقوصة غير متوازنة");
        assert_eq!(DIALOG_SCRIPT.matches('\'').count() % 2, 0, "علامات اقتباس مفردة غير متوازنة");
        let p_open = DIALOG_SCRIPT.matches('(').count();
        let p_close = DIALOG_SCRIPT.matches(')').count();
        assert_eq!(p_open, p_close, "أقواس دائرية غير متوازنة");
    }

    #[test]
    fn clamp_copies_bounds() {
        assert_eq!(clamp_copies(0), 1);
        assert_eq!(clamp_copies(1), 1);
        assert_eq!(clamp_copies(3), 3);
        assert_eq!(clamp_copies(20), 20);
        assert_eq!(clamp_copies(21), 20);
        assert_eq!(clamp_copies(u32::MAX), 20);
    }

    #[test]
    fn parses_cancel_and_no_printers() {
        assert_eq!(parse_dialog_output("CANCEL").unwrap(), PrintDialogResult::Cancelled);
        assert_eq!(parse_dialog_output("CANCEL\r\n").unwrap(), PrintDialogResult::Cancelled);
        assert_eq!(parse_dialog_output(" NOPRINTER ").unwrap(), PrintDialogResult::NoPrinters);
    }

    #[test]
    fn parses_ok_with_arabic_printer_name_and_copies() {
        let json = r#"{"printer":"طابعة المكتب HP LaserJet","copies":2}"#;
        let out = format!("OK:{}\r\n", hex_of(json));
        assert_eq!(
            parse_dialog_output(&out).unwrap(),
            PrintDialogResult::Ok { printer_name: "طابعة المكتب HP LaserJet".to_string(), copies: 2 }
        );
    }

    #[test]
    fn ok_clamps_out_of_range_copies_and_defaults_missing() {
        let big = format!("OK:{}", hex_of(r#"{"printer":"P","copies":500}"#));
        assert_eq!(
            parse_dialog_output(&big).unwrap(),
            PrintDialogResult::Ok { printer_name: "P".to_string(), copies: MAX_COPIES }
        );
        let zero = format!("OK:{}", hex_of(r#"{"printer":"P","copies":0}"#));
        assert_eq!(
            parse_dialog_output(&zero).unwrap(),
            PrintDialogResult::Ok { printer_name: "P".to_string(), copies: 1 }
        );
        let missing = format!("OK:{}", hex_of(r#"{"printer":"P"}"#));
        assert_eq!(
            parse_dialog_output(&missing).unwrap(),
            PrintDialogResult::Ok { printer_name: "P".to_string(), copies: 1 }
        );
    }

    #[test]
    fn rejects_malformed_outputs() {
        assert!(parse_dialog_output("").is_err());
        assert!(parse_dialog_output("garbage").is_err());
        assert!(parse_dialog_output("OK:").is_err());
        assert!(parse_dialog_output("OK:abc").is_err(), "طول فردي");
        assert!(parse_dialog_output("OK:zz").is_err(), "محرف غير سداسي");
        assert!(parse_dialog_output(&format!("OK:{}", hex_of("not json"))).is_err());
        assert!(parse_dialog_output(&format!("OK:{}", hex_of(r#"{"copies":1}"#))).is_err(), "بلا اسم طابعة");
        assert!(parse_dialog_output(&format!("OK:{}", hex_of(r#"{"printer":"  ","copies":1}"#))).is_err());
        // بايتات UTF-8 غير صالحة
        assert!(parse_dialog_output("OK:ff").is_err());
    }

    #[test]
    fn result_serializes_with_status_tag_and_camel_case() {
        let ok = serde_json::to_value(PrintDialogResult::Ok { printer_name: "X".into(), copies: 2 }).unwrap();
        assert_eq!(ok, serde_json::json!({ "status": "ok", "printerName": "X", "copies": 2 }));
        assert_eq!(serde_json::to_value(PrintDialogResult::Cancelled).unwrap(), serde_json::json!({ "status": "cancelled" }));
        assert_eq!(serde_json::to_value(PrintDialogResult::Unsupported).unwrap(), serde_json::json!({ "status": "unsupported" }));
        assert_eq!(serde_json::to_value(PrintDialogResult::NoPrinters).unwrap(), serde_json::json!({ "status": "noPrinters" }));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn non_windows_reports_unsupported() {
        assert_eq!(show_dialog_blocking(Some("x")).unwrap(), PrintDialogResult::Unsupported);
    }
}
