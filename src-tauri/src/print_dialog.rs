// ============================================================================
// الطباعة العادية للفاتورة بنافذة التطبيق نفسه (AI_CONTEXT.md القسمان 6.7 و8).
//
// يقود `print.ts` ثلاث خطوات بالتتابع، وكلها `async` + `spawn_blocking` عمداً
// (أمر Tauri غير الـasync يعمل على الخيط الرئيسي فكان التحويل يجمّد الواجهة):
//
//   1) `print_prepare`     ← يبني xlsx المُعبَّأ في مجلد مهمة مؤقت، يحوّله إلى PDF
//      بـLibreOffice، ويعدّ صفحاته بـ`lopdf`، ويُرجع عدد الصفحات وقائمة الطابعات.
//      لا يطبع شيئاً. (العدد لا يُعرف إلا بعد التحويل، وهذا سبب انتظار الثواني.)
//   2) نافذة التطبيق (`PrintOptionsDialog.tsx`): الطابعة وعدد النسخ والصفحات.
//   3) `print_execute`     ← يطبع على اختيار المستخدم:
//        - **الكل**: المسار المجرَّب كما هو، LibreOffice headless على ملف xlsx
//          (`run_soffice_headless_print`) — طباعة متجهية بلا أي تغيير.
//        - **صفحة أو مجال متتالٍ**: PowerShell يرسم الصفحات المختارة من الـPDF عبر
//          `Windows.Data.Pdf` (مدمج في ويندوز 10+) ويرسلها للطابعة عبر
//          `System.Drawing.Printing.PrintDocument`. لا برنامج PDF ولا مكتبة ولا ترخيص.
//          سبب هذا المسار: LibreOffice لا يقبل نطاق صفحات لملف xlsx من سطر الأوامر،
//          وويندوز لا يطبع PDF بصمت دون برنامج PDF.
//   4) `print_job_cleanup` ← يحذف مجلد المهمة (تستدعيه الواجهة دائماً في finally).
//
// حدود معروفة (موثَّقة عمداً):
//   - الصفحات المحددة تُطبَع **صوراً** بدقة 300 نقطة/بوصة (لا نصاً متجهاً) وتُلائَم
//     منطقة الطباعة الفعلية للطابعة (قد يصغر المحتوى نحو 4%). "الكل" يبقى متجهياً.
//   - عدة نسخ = تكرار الطباعة (كل نسخة مهمة مستقلة بالتتابع).
//   - على غير ويندوز (Ubuntu للتطوير) يُرجع `print_prepare` الحالة `unsupported`
//     فتعود الواجهة إلى `print_invoice_direct` القديم الذي لم يُمَس.
//
// قواعد سكربت PowerShell: ASCII فقط، بلا علامة اقتباس مزدوجة ولا `#` ولا CR، كي
// يمرّ كوسيط `-Command` واحد دون مشاكل ترميز/اقتباس. المسار والطابعة والمجال تصله
// عبر متغيرات بيئة (تحمل العربية سليمة)، ومخرجاته سطر واحد: `OK` أو `ERR:<hex>`
// (hex لرسالة UTF-8 يتفادى ترميز طرفية ويندوز). لا تستدعِ canonicalize على مسار
// الـPDF: بادئة `\\?\` ترفضها `StorageFile.GetFileFromPathAsync`.
//
// نواة الحساب البحتة (عدّ الصفحات والتحقق من المجال) في `batch_pdf_core.rs`.
// ============================================================================

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::batch_pdf_core as bcore;
use crate::invoice_template::{
    build_invoice_xlsx_to, generated_dir, list_system_printers, run_soffice_headless_print,
    template_path, InvoicePrintInput, MSG_NO_TEMPLATE,
};

/// أقصى عدد نسخ نقبله (حماية من إدخال خاطئ يكرّر الطباعة عشرات المرات).
pub const MAX_COPIES: u32 = 20;

/// أقصى انتظار لسكربت طباعة الصفحات المحددة قبل إنهائه.
#[cfg(target_os = "windows")]
const PAGES_TIMEOUT_SECS: u64 = 5 * 60;

/// ملف تعريف LibreOffice مستقل لتحويل الفاتورة إلى PDF هنا: لا يتشارك قفلاً مع
/// الطباعة الجماعية (`lo_batch_pdf_profile`) ولا مع الطباعة الصامتة.
const PRINT_PDF_PROFILE_DIR: &str = "lo_print_pdf_profile";

/// ما يُرجعه `print_prepare` للواجهة.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PrintPrepareResult {
    /// غير ويندوز: لا نافذة ولا تجهيز، تعود الواجهة للطباعة الصامتة القديمة.
    Unsupported,
    Ready {
        #[serde(rename = "jobId")]
        job_id: String,
        #[serde(rename = "pageCount")]
        page_count: usize,
        /// أسماء الطابعات المثبَّتة (قد تكون فارغة إن تعذّر الاستعلام — لا يمنع الطباعة).
        printers: Vec<String>,
    },
}

/// المجال الذي تختاره النافذة. لا يُوثَق به: يُتحقَّق منه ثانية في Rust.
#[derive(Deserialize, Debug, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum PrintRangeInput {
    All,
    Pages { from: u32, to: u32 },
}

/// يحصر عدد النسخ بين 1 و`MAX_COPIES`.
pub fn clamp_copies(copies: u32) -> u32 {
    copies.clamp(1, MAX_COPIES)
}

/// اسم الطابعة كوسيط لـLibreOffice: فارغ = طابعة النظام الافتراضية (`None`).
fn printer_arg(name: &str) -> Option<&str> {
    let name = name.trim();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// اسم ملف xlsx المطبوع: رقم الفاتورة منظَّفاً (فيظهر في طابور الطابعة كما كان قبل
/// هذا التغيير)، أو `فاتورة.xlsx` إن لم يوجد رقم.
fn print_file_name(invoice_number: &str) -> String {
    let safe = bcore::sanitize_file_name_part(invoice_number, 60);
    if safe.is_empty() {
        "فاتورة.xlsx".to_string()
    } else {
        format!("{safe}.xlsx")
    }
}

/// ينسخ xlsx المهمة إلى اسم الفاتورة داخل مجلد المهمة نفسه ويُرجع مسار النسخة؛
/// فشل النسخ لا يمنع الطباعة (نطبع الملف الأصلي). لا ينسخ فوق نفسه أبداً.
fn named_print_copy(dir: &Path, xlsx: &Path, invoice_number: &str) -> PathBuf {
    let named = dir.join(print_file_name(invoice_number));
    if named != xlsx && std::fs::copy(xlsx, &named).is_ok() {
        named
    } else {
        xlsx.to_path_buf()
    }
}

/// يحوّل اختيار الواجهة إلى `PageSelection` بعد التحقق منه من العدد الفعلي للصفحات.
fn resolve_selection(range: &PrintRangeInput, total: usize) -> Result<bcore::PageSelection, String> {
    match range {
        PrintRangeInput::All => Ok(bcore::PageSelection::All),
        PrintRangeInput::Pages { from, to } => bcore::page_selection(*from, *to, total),
    }
}

// ───────────────────────── سكربت طباعة صفحات من PDF ─────────────────────────

/// يقرأ المسار والطابعة والمجال والنسخ من MKS_PDF وMKS_PRINTER وMKS_FROM وMKS_TO
/// وMKS_COPIES، يرسم الصفحات من..إلى بدقة 300 DPI ويطبعها (الطابعة الفارغة =
/// الافتراضية، A4 إن توفّر، ملاءمة منطقة الطباعة). المخرجات: `OK` أو `ERR:<hex>`.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const PAGES_SCRIPT: &str = r#"$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  Add-Type -AssemblyName System.Drawing
  $null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
  $null = [Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime]
  $null = [Windows.Data.Pdf.PdfPageRenderOptions,Windows.Data.Pdf,ContentType=WindowsRuntime]
  $pdfPath = $env:MKS_PDF
  $printer = $env:MKS_PRINTER
  $from = [int]$env:MKS_FROM
  $to = [int]$env:MKS_TO
  $copies = [int]$env:MKS_COPIES
  if ($from -lt 1 -or $to -lt $from -or $copies -lt 1) { throw 'invalid arguments' }
  $methods = [System.WindowsRuntimeSystemExtensions].GetMethods()
  $asOp = ($methods | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $asAct = ($methods | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and -not $_.IsGenericMethod })[0]
  function Wait-Op($op, $type) {
    $task = $asOp.MakeGenericMethod($type).Invoke($null, @($op))
    $null = $task.Wait(-1)
    return $task.Result
  }
  function Wait-Act($act) {
    $task = $asAct.Invoke($null, @($act))
    $null = $task.Wait(-1)
  }
  $file = Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($pdfPath)) ([Windows.Storage.StorageFile])
  $doc = Wait-Op ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  if ($to -gt [int]$doc.PageCount) { throw 'page range is outside the document' }
  $pngs = New-Object System.Collections.ArrayList
  for ($p = $from; $p -le $to; $p++) {
    $page = $doc.GetPage([uint32]($p - 1))
    $w = [uint32][Math]::Round($page.Size.Width * 300 / 96)
    $h = [uint32][Math]::Round($page.Size.Height * 300 / 96)
    $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $opts.DestinationWidth = $w
    $opts.DestinationHeight = $h
    $ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    Wait-Act ($page.RenderToStreamAsync($ras, $opts))
    $null = $ras.Seek([uint64]0)
    $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($ras)
    $mem = New-Object System.IO.MemoryStream
    $net.CopyTo($mem)
    $null = $pngs.Add(@{ bytes = $mem.ToArray(); w = [double]$page.Size.Width; h = [double]$page.Size.Height })
  }
  $pd = New-Object System.Drawing.Printing.PrintDocument
  if ($printer) {
    $pd.PrinterSettings.PrinterName = $printer
    if (-not $pd.PrinterSettings.IsValid) { throw 'printer not found' }
  }
  $pd.DocumentName = 'MKS invoice'
  $pd.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $a4 = $null
  foreach ($sz in $pd.PrinterSettings.PaperSizes) {
    if ($sz.Kind.ToString() -eq 'A4') { $a4 = $sz; break }
  }
  if ($a4 -ne $null) { $pd.DefaultPageSettings.PaperSize = $a4 }
  $pd.DefaultPageSettings.Landscape = ($pngs[0]['w'] -gt $pngs[0]['h'])
  $state = @{ i = 0 }
  $pd.add_PrintPage({
    param($sender, $ev)
    $g = $ev.Graphics
    $g.PageUnit = 'Display'
    $g.InterpolationMode = 'HighQualityBicubic'
    $item = $pngs[$state['i']]
    $pw = [double]$item['w'] * 100 / 96
    $ph = [double]$item['h'] * 100 / 96
    $clip = $g.VisibleClipBounds
    if ($clip.Width -le 1 -or $clip.Height -le 1) { $clip = New-Object System.Drawing.RectangleF -ArgumentList 0, 0, $pw, $ph }
    $scale = [Math]::Min([Math]::Min($clip.Width / $pw, $clip.Height / $ph), 1.0)
    $dw = $pw * $scale
    $dh = $ph * $scale
    $dx = $clip.X + ($clip.Width - $dw) / 2
    $dy = $clip.Y + ($clip.Height - $dh) / 2
    $ms = [System.IO.MemoryStream]::new([byte[]]$item['bytes'])
    $img = [System.Drawing.Image]::FromStream($ms)
    $g.DrawImage($img, [single]$dx, [single]$dy, [single]$dw, [single]$dh)
    $img.Dispose()
    $ms.Dispose()
    $state['i'] = $state['i'] + 1
    $ev.HasMorePages = ($state['i'] -lt $pngs.Count)
  })
  for ($c = 1; $c -le $copies; $c++) {
    $state['i'] = 0
    $pd.Print()
  }
  [Console]::Out.Write('OK')
} catch {
  $msg = [string]$_.Exception.GetBaseException().Message
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
  $hex = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  [Console]::Out.Write('ERR:' + $hex)
  exit 1
}
"#;

/// يفكّ نصاً سداسياً (hex) إلى نص UTF-8.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn hex_decode_utf8(hex: &str) -> Result<String, String> {
    let hex = hex.trim();
    if hex.is_empty() || hex.len() % 2 != 0 {
        return Err("طول غير زوجي".to_string());
    }
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for pair in hex.as_bytes().chunks(2) {
        let hi = (pair[0] as char).to_digit(16);
        let lo = (pair[1] as char).to_digit(16);
        match (hi, lo) {
            (Some(h), Some(l)) => bytes.push((h * 16 + l) as u8),
            _ => return Err("محرف غير سداسي".to_string()),
        }
    }
    String::from_utf8(bytes).map_err(|_| "ليس UTF-8 صالحاً".to_string())
}

fn truncate(s: &str, max_chars: usize) -> String {
    let mut out: String = s.chars().take(max_chars).collect();
    if s.chars().count() > max_chars {
        out.push('…');
    }
    out
}

/// يفسّر نتيجة تشغيل السكربت: `OK` نجاح، `ERR:<hex>` رسالة الاستثناء، وغير ذلك
/// خطأ غير متوقع (يُرفَق stderr لتسهيل التشخيص).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn interpret_pages_result(stdout: &str, stderr: &str) -> Result<(), String> {
    let text = stdout.trim();
    if text == "OK" {
        return Ok(());
    }
    if let Some(hex) = text.strip_prefix("ERR:") {
        let message = hex_decode_utf8(hex).unwrap_or_else(|_| "سبب غير معروف".to_string());
        return Err(format!("تعذّرت طباعة الصفحات المحددة: {message}"));
    }
    Err(format!(
        "تعذّرت طباعة الصفحات المحددة (مخرجات غير متوقعة: {}). {}",
        truncate(text, 120),
        truncate(stderr.trim(), 300)
    )
    .trim()
    .to_string())
}

#[cfg(target_os = "windows")]
fn print_pdf_pages(pdf: &Path, printer: &str, from: u32, to: u32, copies: u32) -> Result<(), String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", PAGES_SCRIPT]);
    cmd.env("MKS_PDF", pdf)
        .env("MKS_PRINTER", printer)
        .env("MKS_FROM", from.to_string())
        .env("MKS_TO", to.to_string())
        .env("MKS_COPIES", copies.to_string());
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    crate::invoice_template::suppress_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("تعذّر تشغيل PowerShell لطباعة الصفحات المحددة: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(PAGES_TIMEOUT_SECS);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "تجاوزت طباعة الصفحات المحددة المهلة الزمنية المسموحة ({} ثانية) — تحقّق من الطابعة.",
                        PAGES_TIMEOUT_SECS
                    ));
                }
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(format!("تعذّر متابعة عملية طباعة الصفحات: {e}")),
        }
    }

    let mut out = String::new();
    if let Some(mut s) = child.stdout.take() {
        let _ = s.read_to_string(&mut out);
    }
    let mut err = String::new();
    if let Some(mut s) = child.stderr.take() {
        let _ = s.read_to_string(&mut err);
    }
    interpret_pages_result(&out, &err)
}

#[cfg(not(target_os = "windows"))]
fn print_pdf_pages(_pdf: &Path, _printer: &str, _from: u32, _to: u32, _copies: u32) -> Result<(), String> {
    Err("طباعة صفحات محددة مدعومة على ويندوز فقط.".to_string())
}

// ───────────────────────── مجلد المهمة ─────────────────────────

/// مجلد المهمة بعد التحقق من صيغة المعرّف (يصل من الواجهة — لا يُضَم نص حر إلى
/// مسار قبل التحقق، حمايةً من اجتياز المسارات).
fn job_dir(app: &AppHandle, job_id: &str) -> Result<PathBuf, String> {
    if !bcore::is_valid_batch_id(job_id) {
        return Err("معرّف مهمة الطباعة غير صالح.".to_string());
    }
    let dir = generated_dir(app)?.join(job_id);
    if !dir.is_dir() {
        return Err("انتهت مهمة الطباعة (حُذفت ملفاتها المؤقتة) — أعد المحاولة من البداية.".to_string());
    }
    Ok(dir)
}

/// يبني xlsx المهمة ويحوّله إلى PDF ويعدّ صفحاته. `Err` يعني أن المستدعي يحذف المجلد.
fn build_job_files(app: &AppHandle, data: &InvoicePrintInput, template: &Path, dir: &Path) -> Result<usize, String> {
    build_invoice_xlsx_to(template, data, &dir.join(bcore::batch_xlsx_name(0)))?;

    let profile_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("تعذّر تحديد مجلد بيانات التطبيق: {e}"))?
        .join(PRINT_PDF_PROFILE_DIR);
    let report = bcore::convert_xlsx_batch(dir, &profile_dir, &[0]).map_err(|e| e.message)?;
    if !report.failed.is_empty() {
        return Err(format!("تعذّر تحويل الفاتورة إلى PDF لحساب عدد صفحاتها: {}", report.reason));
    }
    bcore::count_pdf_pages(&dir.join(bcore::batch_pdf_name(0))).map_err(|e| e.message)
}

fn prepare_blocking(app: &AppHandle, data: &InvoicePrintInput) -> Result<PrintPrepareResult, String> {
    let template = template_path(app)?;
    if !template.exists() {
        return Err(MSG_NO_TEMPLATE.to_string());
    }
    let generated = generated_dir(app)?;
    std::fs::create_dir_all(&generated).map_err(|e| format!("تعذّر إنشاء مجلد ملفات الطباعة: {e}"))?;
    bcore::remove_stale_batch_dirs(&generated);

    let job_id = bcore::new_batch_id();
    let dir = generated.join(&job_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("تعذّر إنشاء مجلد مهمة الطباعة المؤقت: {e}"))?;

    match build_job_files(app, data, &template, &dir) {
        Ok(page_count) => Ok(PrintPrepareResult::Ready {
            job_id,
            page_count,
            printers: list_system_printers(),
        }),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir);
            Err(e)
        }
    }
}

fn execute_blocking(
    app: &AppHandle,
    job_id: &str,
    printer_name: &str,
    copies: u32,
    range: &PrintRangeInput,
    doc_name: &str,
) -> Result<(), String> {
    let dir = job_dir(app, job_id)?;
    let xlsx = dir.join(bcore::batch_xlsx_name(0));
    let pdf = dir.join(bcore::batch_pdf_name(0));
    if !xlsx.is_file() || !pdf.is_file() {
        return Err("ملفات مهمة الطباعة غير مكتملة — أعد المحاولة من البداية.".to_string());
    }

    let total = bcore::count_pdf_pages(&pdf).map_err(|e| e.message)?;
    let selection = resolve_selection(range, total)?;
    let copies = clamp_copies(copies);

    match selection {
        bcore::PageSelection::All => {
            let printer = printer_arg(printer_name);
            let to_print = named_print_copy(&dir, &xlsx, doc_name);
            for n in 1..=copies {
                run_soffice_headless_print(app, &to_print, printer).map_err(|e| {
                    if copies > 1 {
                        format!("تعذّرت طباعة النسخة {n} من {copies}: {e}")
                    } else {
                        e
                    }
                })?;
            }
            Ok(())
        }
        bcore::PageSelection::Range { from, to } => {
            print_pdf_pages(&pdf, printer_name.trim(), from, to, copies)
        }
    }
}

// ───────────────────────── أوامر Tauri ─────────────────────────

/// يجهّز مهمة الطباعة (xlsx ← PDF ← عدد الصفحات) دون طباعة. على غير ويندوز يُرجع
/// `unsupported` فوراً. أي خطأ يحذف مجلد المهمة قبل إرجاعه.
#[tauri::command]
pub async fn print_prepare(app: AppHandle, data: InvoicePrintInput) -> Result<PrintPrepareResult, String> {
    if !cfg!(target_os = "windows") {
        return Ok(PrintPrepareResult::Unsupported);
    }
    tauri::async_runtime::spawn_blocking(move || prepare_blocking(&app, &data))
        .await
        .map_err(|e| format!("تعذّر تجهيز الطباعة: {e}"))?
}

/// يطبع مهمة جُهِّزت بـ`print_prepare` على اختيار المستخدم. `printer_name` فارغ =
/// طابعة النظام الافتراضية. `doc_name` رقم الفاتورة (لاسم الملف في طابور الطابعة).
#[tauri::command]
pub async fn print_execute(
    app: AppHandle,
    job_id: String,
    printer_name: String,
    copies: u32,
    range: PrintRangeInput,
    doc_name: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        execute_blocking(&app, &job_id, &printer_name, copies, &range, &doc_name)
    })
        .await
        .map_err(|e| format!("تعذّر تنفيذ الطباعة: {e}"))?
}

/// يحذف مجلد المهمة المؤقت. على Windows قد يُمسك LibreOffice بملف لحظات بعد
/// انتهائه فنعيد المحاولة قليلاً؛ ما يبقى تحذفه `remove_stale_batch_dirs` لاحقاً.
#[tauri::command]
pub async fn print_job_cleanup(app: AppHandle, job_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !bcore::is_valid_batch_id(&job_id) {
            return Err("معرّف مهمة الطباعة غير صالح.".to_string());
        }
        let dir = generated_dir(&app)?.join(&job_id);
        if !dir.exists() {
            return Ok(());
        }
        let mut last_err = String::new();
        for _ in 0..5 {
            match std::fs::remove_dir_all(&dir) {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last_err = e.to_string();
                    std::thread::sleep(std::time::Duration::from_millis(300));
                }
            }
        }
        Err(format!("تعذّر حذف الملفات المؤقتة لمهمة الطباعة: {last_err}"))
    })
    .await
    .map_err(|e| format!("تعذّر حذف مهمة الطباعة: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex_of(s: &str) -> String {
        s.as_bytes().iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn script_obeys_powershell_argument_rules() {
        assert!(PAGES_SCRIPT.is_ascii(), "السكربت يجب أن يكون ASCII فقط");
        assert!(!PAGES_SCRIPT.contains('"'), "لا علامات اقتباس مزدوجة (تُفسد وسيط -Command)");
        assert!(!PAGES_SCRIPT.contains('\r'));
        assert!(!PAGES_SCRIPT.contains('#'), "لا تعليقات داخل السكربت");
        for needle in [
            "Windows.Data.Pdf",
            "PrintDocument",
            "StandardPrintController",
            "MKS_PDF",
            "MKS_PRINTER",
            "MKS_FROM",
            "MKS_TO",
            "MKS_COPIES",
            "'OK'",
            "'ERR:'",
        ] {
            assert!(PAGES_SCRIPT.contains(needle), "ينقص السكربت: {needle}");
        }
    }

    #[test]
    fn script_brackets_and_quotes_are_balanced() {
        let count = |c: char| PAGES_SCRIPT.matches(c).count();
        assert_eq!(count('{'), count('}'), "أقواس معقوصة");
        assert_eq!(count('('), count(')'), "أقواس دائرية");
        assert_eq!(count('['), count(']'), "أقواس مربعة");
        assert_eq!(count('\'') % 2, 0, "علامات اقتباس مفردة");
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
    fn printer_arg_empty_means_system_default() {
        assert_eq!(printer_arg(""), None);
        assert_eq!(printer_arg("   "), None);
        assert_eq!(printer_arg("  HP LaserJet  "), Some("HP LaserJet"));
        assert_eq!(printer_arg("طابعة المكتب"), Some("طابعة المكتب"));
    }

    #[test]
    fn print_file_name_uses_sanitized_invoice_number() {
        assert_eq!(print_file_name("2610-1-7"), "2610-1-7.xlsx");
        assert_eq!(print_file_name("26/10:1*7"), "26_10_1_7.xlsx");
        assert_eq!(print_file_name(""), "فاتورة.xlsx");
        assert_eq!(print_file_name("  ...  "), "فاتورة.xlsx");
    }

    #[test]
    fn named_copy_is_made_next_to_the_job_files_and_never_over_itself() {
        let dir = std::env::temp_dir().join(format!("mks_named_copy_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let xlsx = dir.join("inv_00000.xlsx");
        std::fs::write(&xlsx, b"XLSX-BYTES").unwrap();

        let copy = named_print_copy(&dir, &xlsx, "2610-1-7");
        assert_eq!(copy, dir.join("2610-1-7.xlsx"));
        assert_eq!(std::fs::read(&copy).unwrap(), b"XLSX-BYTES");
        assert!(xlsx.exists(), "الأصل يبقى");

        // اسم يطابق الأصل نفسه: لا نسخ فوق النفس (كان سيُفرغ الملف)
        let same = named_print_copy(&dir, &xlsx, "inv_00000");
        assert_eq!(same, xlsx);
        assert_eq!(std::fs::read(&xlsx).unwrap(), b"XLSX-BYTES");

        // مصدر غير موجود: يُرجَع المصدر نفسه ولا يُنشأ شيء
        let missing = dir.join("nope.xlsx");
        assert_eq!(named_print_copy(&dir, &missing, "9-9-9"), missing);
        assert!(!dir.join("9-9-9.xlsx").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn range_input_deserializes_from_frontend_json() {
        let all: PrintRangeInput = serde_json::from_str(r#"{"mode":"all"}"#).unwrap();
        assert_eq!(all, PrintRangeInput::All);
        let pages: PrintRangeInput = serde_json::from_str(r#"{"mode":"pages","from":2,"to":3}"#).unwrap();
        assert_eq!(pages, PrintRangeInput::Pages { from: 2, to: 3 });
        for bad in [
            r#"{"mode":"odd"}"#,
            r#"{"mode":"pages","from":2}"#,
            r#"{"mode":"pages","from":-1,"to":2}"#,
            r#"{"mode":"pages","from":"a","to":2}"#,
            r#"{"from":1,"to":2}"#,
        ] {
            assert!(serde_json::from_str::<PrintRangeInput>(bad).is_err(), "يجب رفض: {bad}");
        }
    }

    #[test]
    fn prepare_result_serializes_with_status_tag_and_camel_case() {
        assert_eq!(
            serde_json::to_value(PrintPrepareResult::Unsupported).unwrap(),
            serde_json::json!({ "status": "unsupported" })
        );
        let ready = PrintPrepareResult::Ready {
            job_id: "batch_1_0".to_string(),
            page_count: 3,
            printers: vec!["طابعة".to_string()],
        };
        assert_eq!(
            serde_json::to_value(ready).unwrap(),
            serde_json::json!({ "status": "ready", "jobId": "batch_1_0", "pageCount": 3, "printers": ["طابعة"] })
        );
    }

    #[test]
    fn selection_is_validated_against_real_page_count() {
        assert_eq!(resolve_selection(&PrintRangeInput::All, 4).unwrap(), bcore::PageSelection::All);
        assert_eq!(
            resolve_selection(&PrintRangeInput::Pages { from: 2, to: 3 }, 4).unwrap(),
            bcore::PageSelection::Range { from: 2, to: 3 }
        );
        assert_eq!(
            resolve_selection(&PrintRangeInput::Pages { from: 1, to: 4 }, 4).unwrap(),
            bcore::PageSelection::All
        );
        assert!(resolve_selection(&PrintRangeInput::Pages { from: 3, to: 5 }, 4).is_err());
        assert!(resolve_selection(&PrintRangeInput::Pages { from: 0, to: 1 }, 4).is_err());
        assert!(resolve_selection(&PrintRangeInput::Pages { from: 3, to: 2 }, 4).is_err());
    }

    #[test]
    fn interprets_script_output() {
        assert!(interpret_pages_result("OK", "").is_ok());
        assert!(interpret_pages_result("OK\r\n", "").is_ok());

        let hex = hex_of("The printer name is invalid");
        let err = interpret_pages_result(&format!("ERR:{hex}"), "").unwrap_err();
        assert!(err.contains("The printer name is invalid"), "{err}");

        let arabic = interpret_pages_result(&format!("ERR:{}", hex_of("لا توجد طابعة")), "").unwrap_err();
        assert!(arabic.contains("لا توجد طابعة"), "{arabic}");

        // مخرجات غير متوقعة (مثلاً تعطّل PowerShell قبل تنفيذ السكربت): يُرفَق stderr
        let unexpected = interpret_pages_result("", "ParserError: boom").unwrap_err();
        assert!(unexpected.contains("ParserError: boom"), "{unexpected}");
        assert!(interpret_pages_result("garbage", "").is_err());
        assert!(interpret_pages_result("ERR:zz", "").is_err(), "hex تالف يبقى خطأ لا نجاحاً");
        assert!(interpret_pages_result("ERR:", "").is_err());
    }

    #[test]
    fn hex_decoding_rules() {
        assert_eq!(hex_decode_utf8(&hex_of("abc")).unwrap(), "abc");
        assert_eq!(hex_decode_utf8(&hex_of("عربي")).unwrap(), "عربي");
        for bad in ["", "abc", "zz", "ff"] {
            assert!(hex_decode_utf8(bad).is_err(), "{bad:?}");
        }
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn non_windows_cannot_print_pages() {
        assert!(print_pdf_pages(Path::new("/x.pdf"), "", 1, 1, 1).is_err());
    }
}
