// ============================================================================
// الطباعة الفردية مع اختيار نطاق الصفحات.
// المسار: XLSX من القالب الحالي -> PDF كامل لمعرفة عدد الصفحات -> PrintDialog
// -> PDF مقيّد بالنطاق المختار -> طباعة PDF عبر LibreOffice على الطابعة المختارة.
//
// لا توجد أي مكتبة أو أداة خارجية جديدة:
// - LibreOffice موجود مسبقاً ويُستخدم هنا للتحويل والطباعة.
// - lopdf اعتماد موجود مسبقاً ويُستخدم فقط لقراءة عدد صفحات PDF.
// - نافذة Windows ما زالت System.Windows.Forms.PrintDialog عبر PowerShell.
// - الطباعة الجماعية لا تستدعي هذه الوحدة ولا تتغير.
//
// أمر Tauri واحد async + spawn_blocking يقود العملية كلها، كي لا يبقى ملف مؤقت
// معلّقاً عند إلغاء النافذة، وكي لا تُعرض النافذة قبل معرفة العدد الحقيقي للصفحات.
// ============================================================================

use serde::Serialize;
use tauri::AppHandle;

use crate::invoice_template::InvoicePrintInput;

#[cfg(target_os = "windows")]
use crate::invoice_template::{
    build_invoice_xlsx, run_soffice_headless_print, soffice_candidates, suppress_window,
    to_file_uri,
};
#[cfg(target_os = "windows")]
use std::fs::{self, File};
#[cfg(target_os = "windows")]
use std::io::Read;
#[cfg(target_os = "windows")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "windows")]
use std::process::{Command, Stdio};
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicU32, Ordering};
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
#[cfg(target_os = "windows")]
use tauri::Manager;

/// أقصى عدد نسخ نقبله (حماية من إدخال خاطئ يكرّر الطباعة عشرات المرات).
pub const MAX_COPIES: u32 = 20;

/// أقصى انتظار لبقاء نافذة الطباعة مفتوحة قبل إنهائها.
#[cfg(target_os = "windows")]
const DIALOG_TIMEOUT_SECS: u64 = 30 * 60;

/// مهلة تحويل XLSX إلى PDF، ثم فترة سماح قصيرة لاكتمال كتابة الملف.
#[cfg(target_os = "windows")]
const PDF_CONVERT_TIMEOUT_SECS: u64 = 120;
#[cfg(target_os = "windows")]
const PDF_OUTPUT_GRACE_SECS: u64 = 15;

/// نتيجة عملية الطباعة التي تصل إلى TypeScript.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PrintInvoiceOutcome {
    /// اكتملت الطباعة على الطابعة والنطاق المختارين.
    Printed,
    /// ألغى المستخدم نافذة الطباعة.
    Cancelled,
    /// لا توجد نافذة طباعة نظام هنا (Linux أثناء التطوير): استخدم المسار القديم.
    Unsupported,
    /// لا توجد طابعة مثبّتة.
    NoPrinters,
    /// تعذّر تجهيز PDF أو عرض النافذة؛ تسمح الواجهة بالرجوع للطباعة المباشرة القديمة.
    DialogUnavailable { message: String },
    /// اختار المستخدم الطباعة، لكن تعذّر إنشاء/طباعة نطاق PDF؛ افتح XLSX يدوياً كاحتياط.
    PrintFailed { message: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PageRange {
    from_page: u32,
    to_page: u32,
}

#[derive(Debug, PartialEq, Eq)]
enum DialogSelection {
    Ok {
        printer_name: String,
        copies: u32,
        page_range: Option<PageRange>,
    },
    Cancelled,
    Unsupported,
    NoPrinters,
}

/// يحصر عدد النسخ بين 1 وMAX_COPIES.
pub fn clamp_copies(copies: u32) -> u32 {
    copies.clamp(1, MAX_COPIES)
}

fn validate_page_range(from_page: u32, to_page: u32, page_count: u32) -> Result<PageRange, String> {
    if page_count == 0 {
        return Err("ملف الفاتورة لا يحتوي على أي صفحة قابلة للطباعة.".to_string());
    }
    if from_page < 1 || to_page < from_page || to_page > page_count {
        return Err(format!(
            "نطاق الصفحات غير صالح: من {from_page} إلى {to_page}، بينما عدد صفحات الفاتورة {page_count}."
        ));
    }
    Ok(PageRange { from_page, to_page })
}

/// سكربت PowerShell ASCII فقط وبلا علامات اقتباس مزدوجة.
/// نفعّل Pages فقط؛ Selection وCurrent Page تبقيان معطّلتين لأنهما لا تناسبان
/// مسار الطباعة هذا. حدود النافذة مأخوذة من عدد صفحات PDF الفعلي.
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
  $pageCount = [int]$env:MKS_PAGE_COUNT
  if ($pageCount -lt 1) { throw 'Invalid page count' }
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
  $ps.MinimumPage = 1
  $ps.MaximumPage = $pageCount
  $ps.FromPage = 1
  $ps.ToPage = $pageCount
  $dlg = New-Object System.Windows.Forms.PrintDialog
  $dlg.UseEXDialog = $true
  $dlg.AllowPrintToFile = $false
  $dlg.AllowSomePages = $true
  $dlg.AllowSelection = $false
  $dlg.AllowCurrentPage = $false
  $dlg.PrinterSettings = $ps
  $res = $dlg.ShowDialog($owner)
  $owner.Close()
  if ($res -ne [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.Write('CANCEL')
    exit 0
  }
  $copies = [int]$dlg.PrinterSettings.Copies
  if ($copies -lt 1) { $copies = 1 }
  $printRange = [string]$dlg.PrinterSettings.PrintRange
  $fromPage = [int]$dlg.PrinterSettings.FromPage
  $toPage = [int]$dlg.PrinterSettings.ToPage
  $json = @{
    printer = $dlg.PrinterSettings.PrinterName
    copies = $copies
    printRange = $printRange
    fromPage = $fromPage
    toPage = $toPage
  } | ConvertTo-Json -Compress
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

/// يحوّل مخرجات نافذة Windows إلى اختيار موثوق، ويتحقق من النطاق مرة أخرى في Rust.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_dialog_output(stdout: &str, page_count: u32) -> Result<DialogSelection, String> {
    let text = stdout.trim();
    if text == "CANCEL" {
        return Ok(DialogSelection::Cancelled);
    }
    if text == "NOPRINTER" {
        return Ok(DialogSelection::NoPrinters);
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

    let print_range = value
        .get("printRange")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "لم تُرجع نافذة الطباعة نوع نطاق الصفحات.".to_string())?;

    let page_range = match print_range {
        "AllPages" => None,
        "SomePages" => {
            let from_page = value
                .get("fromPage")
                .and_then(|v| v.as_u64())
                .and_then(|v| u32::try_from(v).ok())
                .ok_or_else(|| "لم تُرجع نافذة الطباعة رقم الصفحة الأولى.".to_string())?;
            let to_page = value
                .get("toPage")
                .and_then(|v| v.as_u64())
                .and_then(|v| u32::try_from(v).ok())
                .ok_or_else(|| "لم تُرجع نافذة الطباعة رقم الصفحة الأخيرة.".to_string())?;
            Some(validate_page_range(from_page, to_page, page_count)?)
        }
        other => return Err(format!("نوع نطاق الصفحات المُعاد من Windows غير معروف: {other}")),
    };

    Ok(DialogSelection::Ok { printer_name, copies, page_range })
}

fn truncate(s: &str, max_chars: usize) -> String {
    let mut out: String = s.chars().take(max_chars).collect();
    if s.chars().count() > max_chars {
        out.push('…');
    }
    out
}

#[cfg(target_os = "windows")]
fn show_dialog_blocking(
    default_printer: Option<&str>,
    page_count: u32,
) -> Result<DialogSelection, String> {
    use std::process::Command;

    let mut cmd = Command::new("powershell");
    // -STA إلزامي: مربعات حوار WinForms تتطلب خيطاً أحادي الشقة (STA).
    cmd.args(["-STA", "-NoProfile", "-NonInteractive", "-Command", DIALOG_SCRIPT]);
    cmd.env("MKS_PAGE_COUNT", page_count.to_string());
    if let Some(name) = default_printer.map(str::trim).filter(|n| !n.is_empty()) {
        cmd.env("MKS_DEFAULT_PRINTER", name);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // لا يؤثر على نافذة الطباعة نفسها؛ يمنع فقط ظهور نافذة الطرفية.
    suppress_window(&mut cmd);

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
                    return Ok(DialogSelection::Cancelled);
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
    parse_dialog_output(&out, page_count)
}

#[cfg(not(target_os = "windows"))]
fn show_dialog_blocking(
    _default_printer: Option<&str>,
    _page_count: u32,
) -> Result<DialogSelection, String> {
    Ok(DialogSelection::Unsupported)
}

#[cfg(target_os = "windows")]
struct PrintJobDir(PathBuf);

#[cfg(target_os = "windows")]
impl PrintJobDir {
    fn path(&self) -> &Path {
        &self.0
    }
}

#[cfg(target_os = "windows")]
impl Drop for PrintJobDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(target_os = "windows")]
static PRINT_JOB_COUNTER: AtomicU32 = AtomicU32::new(0);

/// مجلد مؤقت فريد لكل عملية طباعة؛ يحذف تلقائياً حتى عند الإلغاء أو الفشل.
#[cfg(target_os = "windows")]
fn create_print_job_dir(app: &AppHandle) -> Result<PrintJobDir, String> {
    let generated = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("تعذّر تحديد مجلد بيانات التطبيق: {e}"))?
        .join("generated");
    fs::create_dir_all(&generated)
        .map_err(|e| format!("تعذّر إنشاء مجلد ملفات الطباعة: {e}"))?;

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    for _ in 0..10 {
        let counter = PRINT_JOB_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = generated.join(format!("interactive_print_{millis}_{counter}"));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(PrintJobDir(path)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("تعذّر إنشاء مجلد الطباعة المؤقت: {e}")),
        }
    }
    Err("تعذّر إنشاء مجلد مؤقت فريد للطباعة.".to_string())
}

#[cfg(target_os = "windows")]
fn read_pdf_page_count(path: &Path) -> Result<u32, String> {
    if !path.is_file() {
        return Err("لم يُنشئ LibreOffice ملف PDF المطلوب.".to_string());
    }
    let document = lopdf::Document::load(path)
        .map_err(|e| format!("ملف PDF الناتج غير صالح أو غير مكتمل: {e}"))?;
    let count = document.get_pages().len();
    if count == 0 {
        return Err("ملف PDF الناتج لا يحتوي على أي صفحة.".to_string());
    }
    u32::try_from(count).map_err(|_| "عدد صفحات الفاتورة يتجاوز الحد المدعوم.".to_string())
}

#[cfg(target_os = "windows")]
fn read_stderr(path: &Path) -> String {
    let text = fs::read_to_string(path).unwrap_or_default();
    truncate(text.trim(), 400)
}

/// يحوّل XLSX إلى PDF باستعمال LibreOffice الموجود مسبقاً.
/// عند تمرير page_range، يصدر LibreOffice الصفحات المختارة فقط عبر PageRange.
#[cfg(target_os = "windows")]
fn convert_xlsx_to_pdf(
    app: &AppHandle,
    xlsx_path: &Path,
    output_dir: &Path,
    page_range: Option<PageRange>,
) -> Result<(PathBuf, u32), String> {
    fs::create_dir_all(output_dir)
        .map_err(|e| format!("تعذّر إنشاء مجلد PDF المؤقت: {e}"))?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("تعذّر تحديد مجلد بيانات التطبيق: {e}"))?;
    let profile_dir = app_data.join("lo_interactive_print_profile");
    fs::create_dir_all(&profile_dir)
        .map_err(|e| format!("تعذّر إنشاء ملف تعريف LibreOffice للطباعة: {e}"))?;
    let profile_uri = to_file_uri(&profile_dir);

    let stem = xlsx_path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("invoice");
    let pdf_path = output_dir.join(format!("{stem}.pdf"));
    let _ = fs::remove_file(&pdf_path);

    let output_filter = match page_range {
        Some(range) => {
            let value = format!("{}-{}", range.from_page, range.to_page);
            let options = serde_json::json!({
                "PageRange": { "type": "string", "value": value }
            });
            format!("pdf:calc_pdf_Export:{options}")
        }
        None => "pdf:calc_pdf_Export".to_string(),
    };

    let stderr_log = output_dir.join("soffice_stderr.log");
    let mut last_not_found: Option<String> = None;

    for candidate in soffice_candidates() {
        let stderr_file = File::create(&stderr_log)
            .map_err(|e| format!("تعذّر إنشاء سجل تحويل PDF المؤقت: {e}"))?;
        let mut cmd = Command::new(&candidate);
        cmd.arg("--headless")
            .arg("--invisible")
            .arg("--norestore")
            .arg("--nologo")
            .arg("--nofirststartwizard")
            .arg(format!("-env:UserInstallation={profile_uri}"))
            .arg("--infilter=Calc MS Excel 2007 XML")
            .arg("--convert-to")
            .arg(&output_filter)
            .arg("--outdir")
            .arg(output_dir)
            .arg(xlsx_path);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::from(stderr_file));
        suppress_window(&mut cmd);

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                last_not_found = Some(format!(
                    "لم يتم العثور على LibreOffice عبر '{}': {e}",
                    candidate.display()
                ));
                continue;
            }
            Err(e) => return Err(format!("تعذّر تشغيل LibreOffice للتحويل إلى PDF: {e}")),
        };

        let deadline = Instant::now() + Duration::from_secs(PDF_CONVERT_TIMEOUT_SECS);
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err("تجاوز تحويل الفاتورة إلى PDF المهلة الزمنية (120 ثانية).".to_string());
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                Err(e) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("تعذّرت متابعة عملية تحويل PDF: {e}"));
                }
            }
        };

        if !status.success() {
            return Err(format!(
                "فشل LibreOffice في تحويل الفاتورة إلى PDF (رمز الخروج: {status}). {}",
                read_stderr(&stderr_log)
            ));
        }

        let grace_deadline = Instant::now() + Duration::from_secs(PDF_OUTPUT_GRACE_SECS);
        let mut last_pdf_error = None;
        loop {
            if pdf_path.is_file() {
                match read_pdf_page_count(&pdf_path) {
                    Ok(count) => return Ok((pdf_path, count)),
                    Err(e) => last_pdf_error = Some(e),
                }
            }
            if Instant::now() >= grace_deadline {
                let detail = last_pdf_error.unwrap_or_else(|| read_stderr(&stderr_log));
                return Err(format!(
                    "لم يكتمل إنشاء PDF صالح من LibreOffice خلال فترة السماح. {detail}"
                ));
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }

    Err(last_not_found.unwrap_or_else(|| {
        "تعذّر العثور على LibreOffice على هذا الجهاز لتحويل الفاتورة إلى PDF.".to_string()
    }))
}

#[cfg(target_os = "windows")]
fn print_invoice_interactive_blocking(
    app: &AppHandle,
    data: &InvoicePrintInput,
    default_printer: Option<&str>,
) -> PrintInvoiceOutcome {
    // أولاً: نبني XLSX من القالب نفسه المستخدم في الطباعة الحالية.
    let xlsx_path = match build_invoice_xlsx(app, data) {
        Ok(path) => path,
        Err(message) => return PrintInvoiceOutcome::DialogUnavailable { message },
    };

    let job_dir = match create_print_job_dir(app) {
        Ok(dir) => dir,
        Err(message) => return PrintInvoiceOutcome::DialogUnavailable { message },
    };
    let job_xlsx = job_dir.path().join("invoice.xlsx");
    if let Err(e) = fs::copy(&xlsx_path, &job_xlsx) {
        return PrintInvoiceOutcome::DialogUnavailable {
            message: format!("تعذّر تجهيز نسخة مؤقتة من ملف الفاتورة: {e}"),
        };
    }

    // نصدّر PDF كاملاً أولاً كي نعرف عدد الصفحات الحقيقي قبل فتح PrintDialog.
    let full_dir = job_dir.path().join("full");
    let (full_pdf, page_count) = match convert_xlsx_to_pdf(app, &job_xlsx, &full_dir, None) {
        Ok(result) => result,
        Err(message) => return PrintInvoiceOutcome::DialogUnavailable { message },
    };

    let selection = match show_dialog_blocking(default_printer, page_count) {
        Ok(selection) => selection,
        Err(message) => return PrintInvoiceOutcome::DialogUnavailable { message },
    };

    let (printer_name, copies, page_range) = match selection {
        DialogSelection::Cancelled => return PrintInvoiceOutcome::Cancelled,
        DialogSelection::Unsupported => return PrintInvoiceOutcome::Unsupported,
        DialogSelection::NoPrinters => return PrintInvoiceOutcome::NoPrinters,
        DialogSelection::Ok { printer_name, copies, page_range } => {
            (printer_name, copies, page_range)
        }
    };

    // All يستخدم PDF الكامل. Pages يعيد تصدير XLSX نفسه مع PageRange، فلا نغيّر
    // ملف الفاتورة أو إعدادات الطباعة الجماعية، ولا نضيف محرك PDF جديداً.
    let selected_pdf = if let Some(range) = page_range {
        let selected_dir = job_dir.path().join("selected");
        match convert_xlsx_to_pdf(app, &job_xlsx, &selected_dir, Some(range)) {
            Ok((path, selected_count)) => {
                let expected = range.to_page - range.from_page + 1;
                if selected_count != expected {
                    return PrintInvoiceOutcome::PrintFailed {
                        message: format!(
                            "عدد صفحات PDF المصفّى ({selected_count}) لا يطابق النطاق المختار ({expected}). لم تُرسل الفاتورة إلى الطابعة."
                        ),
                    };
                }
                path
            }
            Err(message) => return PrintInvoiceOutcome::PrintFailed { message },
        }
    } else {
        full_pdf
    };

    let total_copies = clamp_copies(copies);
    for copy in 1..=total_copies {
        if let Err(e) = run_soffice_headless_print(app, &selected_pdf, Some(&printer_name)) {
            let message = if total_copies > 1 {
                format!("تعذّرت طباعة النسخة {copy} من {total_copies}: {e}")
            } else {
                e
            };
            return PrintInvoiceOutcome::PrintFailed { message };
        }
    }

    PrintInvoiceOutcome::Printed
}

#[cfg(not(target_os = "windows"))]
fn print_invoice_interactive_blocking(
    _app: &AppHandle,
    _data: &InvoicePrintInput,
    _default_printer: Option<&str>,
) -> PrintInvoiceOutcome {
    PrintInvoiceOutcome::Unsupported
}

/// ينفّذ مسار الطباعة الفردية كاملاً بعيداً عن خيط الواجهة:
/// تجهيز PDF وعدّ صفحاته، عرض نافذة Windows بنطاق صفحات صالح، ثم طباعة PDF
/// الكامل أو المصفّى بالنطاق المختار. على Linux تعيد الواجهة للمسار القديم.
#[tauri::command]
pub async fn print_invoice_with_dialog(
    app: AppHandle,
    data: InvoicePrintInput,
    default_printer: Option<String>,
) -> Result<PrintInvoiceOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        print_invoice_interactive_blocking(&app, &data, default_printer.as_deref())
    })
    .await
    .map_err(|e| format!("تعذّر تنفيذ مسار الطباعة: {e}"))
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
        for needle in [
            "PrintDialog",
            "UseEXDialog",
            "AllowSomePages",
            "AllowSelection",
            "AllowCurrentPage",
            "MinimumPage",
            "MaximumPage",
            "FromPage",
            "ToPage",
            "MKS_PAGE_COUNT",
            "ShowDialog($owner)",
            "OK:",
        ] {
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
    fn validates_page_ranges() {
        assert_eq!(
            validate_page_range(1, 4, 4).unwrap(),
            PageRange { from_page: 1, to_page: 4 }
        );
        assert_eq!(
            validate_page_range(3, 3, 4).unwrap(),
            PageRange { from_page: 3, to_page: 3 }
        );
        assert!(validate_page_range(0, 1, 4).is_err());
        assert!(validate_page_range(3, 2, 4).is_err());
        assert!(validate_page_range(1, 5, 4).is_err());
        assert!(validate_page_range(1, 1, 0).is_err());
    }

    #[test]
    fn parses_cancel_and_no_printers() {
        assert_eq!(parse_dialog_output("CANCEL", 4).unwrap(), DialogSelection::Cancelled);
        assert_eq!(parse_dialog_output("CANCEL\r\n", 4).unwrap(), DialogSelection::Cancelled);
        assert_eq!(parse_dialog_output(" NOPRINTER ", 4).unwrap(), DialogSelection::NoPrinters);
    }

    #[test]
    fn parses_all_pages_with_arabic_printer_name_and_copies() {
        let json = r#"{"printer":"طابعة المكتب HP LaserJet","copies":2,"printRange":"AllPages","fromPage":1,"toPage":4}"#;
        let out = format!("OK:{}\r\n", hex_of(json));
        assert_eq!(
            parse_dialog_output(&out, 4).unwrap(),
            DialogSelection::Ok {
                printer_name: "طابعة المكتب HP LaserJet".to_string(),
                copies: 2,
                page_range: None,
            }
        );
    }

    #[test]
    fn parses_selected_page_range() {
        let json = r#"{"printer":"P","copies":2,"printRange":"SomePages","fromPage":2,"toPage":3}"#;
        let out = format!("OK:{}", hex_of(json));
        assert_eq!(
            parse_dialog_output(&out, 4).unwrap(),
            DialogSelection::Ok {
                printer_name: "P".to_string(),
                copies: 2,
                page_range: Some(PageRange { from_page: 2, to_page: 3 }),
            }
        );
    }

    #[test]
    fn clamps_copies_and_rejects_invalid_selected_ranges() {
        let big = format!(
            "OK:{}",
            hex_of(r#"{"printer":"P","copies":500,"printRange":"SomePages","fromPage":1,"toPage":4}"#)
        );
        assert_eq!(
            parse_dialog_output(&big, 4).unwrap(),
            DialogSelection::Ok {
                printer_name: "P".to_string(),
                copies: MAX_COPIES,
                page_range: Some(PageRange { from_page: 1, to_page: 4 }),
            }
        );

        let invalid = format!(
            "OK:{}",
            hex_of(r#"{"printer":"P","copies":1,"printRange":"SomePages","fromPage":2,"toPage":5}"#)
        );
        assert!(parse_dialog_output(&invalid, 4).is_err());
    }

    #[test]
    fn rejects_malformed_outputs() {
        assert!(parse_dialog_output("", 4).is_err());
        assert!(parse_dialog_output("garbage", 4).is_err());
        assert!(parse_dialog_output("OK:", 4).is_err());
        assert!(parse_dialog_output("OK:abc", 4).is_err(), "طول فردي");
        assert!(parse_dialog_output("OK:zz", 4).is_err(), "محرف غير سداسي");
        assert!(parse_dialog_output(&format!("OK:{}", hex_of("not json")), 4).is_err());
        assert!(parse_dialog_output(
            &format!("OK:{}", hex_of(r#"{"copies":1,"printRange":"AllPages"}"#)),
            4
        ).is_err(), "بلا اسم طابعة");
        assert!(parse_dialog_output(
            &format!("OK:{}", hex_of(r#"{"printer":"  ","copies":1,"printRange":"AllPages"}"#)),
            4
        ).is_err());
        assert!(parse_dialog_output("OK:ff", 4).is_err(), "بايتات UTF-8 غير صالحة");
    }

    #[test]
    fn result_serializes_with_status_tag() {
        assert_eq!(
            serde_json::to_value(PrintInvoiceOutcome::Printed).unwrap(),
            serde_json::json!({ "status": "printed" })
        );
        assert_eq!(
            serde_json::to_value(PrintInvoiceOutcome::Cancelled).unwrap(),
            serde_json::json!({ "status": "cancelled" })
        );
        assert_eq!(
            serde_json::to_value(PrintInvoiceOutcome::Unsupported).unwrap(),
            serde_json::json!({ "status": "unsupported" })
        );
        assert_eq!(
            serde_json::to_value(PrintInvoiceOutcome::NoPrinters).unwrap(),
            serde_json::json!({ "status": "noPrinters" })
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn non_windows_reports_unsupported() {
        assert_eq!(show_dialog_blocking(None, 2).unwrap(), DialogSelection::Unsupported);
    }
}
