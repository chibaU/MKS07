// ============================================================================
// نواة الطباعة الجماعية إلى ملف PDF واحد — الجزء "البحت" (بلا أي اعتماد على
// tauri: لا AppHandle ولا مسارات تطبيق) ليبقى قابلاً للاختبار المستقل.
// أوامر Tauri نفسها في `batch_invoice_pdf.rs`، وهي رقيقة وتستدعي ما هنا.
//
// المبادئ الملزِمة (راجع AI_CONTEXT.md القسم 6.7 والقسم 8):
//  - **للقراءة فقط على قاعدة البيانات** — هذه الوحدة لا تعرف القاعدة أصلاً.
//  - **الكل أو لا شيء**: أي فشل يُرجَع كخطأ يحمل (إن أمكن) فهرس الفاتورة
//    الفاشلة؛ لا تُنتَج نتيجة جزئية. مجلد الدفعة المؤقت يُحذف كاملاً دائماً
//    (نجاحاً أو فشلاً) من طرف المستدعي.
//  - **لا علاقة بمسار الطباعة الصامتة** (`print_invoice_direct`): التحويل هنا
//    `soffice --convert-to pdf` بملف تعريف مستخدم منفصل (`lo_batch_pdf_profile`)
//    فلا يتشارك قفلاً ولا إعدادات مع الطباعة الصامتة ولا مع أي LibreOffice
//    مفتوح لدى المستخدم.
//  - تسمية الملفات الوسيطة بالفهرس فقط (`inv_00000.xlsx`) — لا أرقام فواتير
//    ولا أسماء تجار: لا تصادم ولا محارف غير مسموحة ولا فواتير بلا رقم.
// ============================================================================

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use lopdf::{Document, Object, ObjectId};

use crate::invoice_template::{soffice_candidates, suppress_window, to_file_uri};

/// خطأ نواة الدفعة: رسالة عربية + فهرس الفاتورة الفاشلة داخل الدفعة إن عُرف
/// (الواجهة تحوّل الفهرس إلى رقم الفاتورة وتصيغ الرسالة النهائية للمستخدم).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreError {
    pub index: Option<usize>,
    pub message: String,
}

impl CoreError {
    pub fn new(message: impl Into<String>) -> Self {
        Self { index: None, message: message.into() }
    }
    pub fn at(index: usize, message: impl Into<String>) -> Self {
        Self { index: Some(index), message: message.into() }
    }
}

// ───────────────────────── هوية مجلد الدفعة ─────────────────────────

/// بادئة أسماء مجلدات الدفعات داخل `AppData/generated`. المجلد الفرعي لا
/// تمسّه `cleanup_generated_dir` (تحذف الملفات فقط، `path.is_file()`).
pub const BATCH_DIR_PREFIX: &str = "batch_";

/// مجلد دفعة أقدم من هذا (بالمللي ثانية، من الطابع الزمني داخل اسمه نفسه) يُعدّ
/// مخلّفاً من إغلاق مفاجئ ويُحذف عند بدء دفعة جديدة (6 ساعات).
const STALE_BATCH_MAX_AGE_MS: u128 = 6 * 60 * 60 * 1000;

static BATCH_COUNTER: AtomicU32 = AtomicU32::new(0);

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// معرّف دفعة جديد بالصيغة `batch_{millis}_{n}` — فريد حتى لو بدأت دفعتان في
/// نفس المللي ثانية (العدّاد داخل العملية).
pub fn new_batch_id() -> String {
    let n = BATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{BATCH_DIR_PREFIX}{}_{n}", now_millis())
}

/// يتحقق أن النص معرّف دفعة سليم الصيغة **قبل** ضمّه إلى أي مسار — حماية من
/// اجتياز المسارات (`..`، فواصل، مسارات مطلقة) لأن المعرّف يصل من الواجهة.
pub fn is_valid_batch_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix(BATCH_DIR_PREFIX) else {
        return false;
    };
    if id.len() > 48 {
        return false;
    }
    let mut parts = rest.split('_');
    let (Some(a), Some(b), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    let all_digits = |s: &str| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit());
    all_digits(a) && all_digits(b)
}

/// هل معرّف الدفعة قديم بما يكفي ليُعدّ مخلّفاً؟ (صيغة غير سليمة ← `false`
/// دائماً: لا نحذف أي شيء لا نعرف أنه من صنعنا.)
pub fn is_stale_batch_id(id: &str, now_ms: u128) -> bool {
    if !is_valid_batch_id(id) {
        return false;
    }
    let millis: u128 = id[BATCH_DIR_PREFIX.len()..]
        .split('_')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(u128::MAX);
    now_ms.saturating_sub(millis) > STALE_BATCH_MAX_AGE_MS && millis != u128::MAX
}

/// يحذف مجلدات الدفعات المخلَّفة (الأقدم من 6 ساعات) داخل `generated` فقط —
/// أخطاء الحذف تُتجاهَل (محاولة تنظيف، لا شرط نجاح). لا يلمس أي ملف ولا أي
/// مجلد لا يطابق صيغة معرّف الدفعة.
pub fn remove_stale_batch_dirs(generated: &Path) {
    let now = now_millis();
    let Ok(entries) = fs::read_dir(generated) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if is_stale_batch_id(name, now) {
            let _ = fs::remove_dir_all(&path);
        }
    }
}

// ───────────────────────── أسماء الملفات والمسارات ─────────────────────────

/// اسم ملف xlsx الوسيط للفاتورة ذات الفهرس `index` (ترتيبها في الدفعة).
/// الترقيم بخمس خانات مُصفَّرة: الترتيب النصي = الترتيب الرقمي حتى 99999.
pub fn batch_xlsx_name(index: usize) -> String {
    format!("inv_{index:05}.xlsx")
}

/// اسم ملف PDF الناتج عن تحويل `batch_xlsx_name(index)` (يُنتجه soffice بنفس
/// الاسم الأساسي في مجلد الإخراج).
pub fn batch_pdf_name(index: usize) -> String {
    format!("inv_{index:05}.pdf")
}

/// مسارات PDF الفواتير **بترتيب الدفعة** (الفهرس 0..count) — هذا الترتيب هو
/// ترتيب صفحات الملف النهائي (التاريخ تصاعدياً ثم id، يحدده الاستعلام).
pub fn ordered_pdf_paths(dir: &Path, count: usize) -> Vec<PathBuf> {
    (0..count).map(|i| dir.join(batch_pdf_name(i))).collect()
}

const WINDOWS_ILLEGAL_CHARS: &str = "\\/:*?\"<>|";

/// ينظّف جزءاً من اسم ملف (اسم تاجر أو تاريخ): كل محرف غير مسموح في ويندوز
/// (`\ / : * ? " < > |`) وكل محرف تحكّم يُستبدَل بـ`_`، المسافات المتتالية تُدمَج
/// في مسافة واحدة، وتُزال `_` والمسافات والنقاط من الطرفين (ويندوز يرفض/يبتلع
/// النقطة أو المسافة الأخيرة)، ثم يُقصّ الناتج إلى `max_chars` محرفاً. قد يكون
/// الناتج فارغاً — المستدعي يتولى البديل.
pub fn sanitize_file_name_part(raw: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut prev_space = false;
    for ch in raw.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
            continue;
        }
        prev_space = false;
        if ch.is_control() || WINDOWS_ILLEGAL_CHARS.contains(ch) {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    let is_edge = |c: char| c == '_' || c == ' ' || c == '.';
    let trimmed: String = out.trim_matches(is_edge).chars().take(max_chars).collect();
    trimmed.trim_matches(is_edge).to_string()
}

/// `YYYY-MM-DD` صارم (أرقام لاتينية فقط، شهر 01–12، يوم 01–31). يصل من
/// الواجهة، فيُتحقَّق منه هنا أيضاً قبل أن يدخل اسم الملف.
pub fn is_valid_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(|c| c.is_ascii_digit());
    if !(digits(0..4) && digits(5..7) && digits(8..10)) {
        return false;
    }
    let month: u32 = s[5..7].parse().unwrap_or(0);
    let day: u32 = s[8..10].parse().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

/// اسم الملف النهائي: `فواتير_{اسم التاجر}_{من}_{إلى}.pdf` (اسم التاجر منظَّف
/// ومقصوص إلى 60 محرفاً؛ بديل "تاجر" إن فرغ بعد التنظيف).
pub fn build_pdf_file_name(merchant_name: &str, date_from: &str, date_to: &str) -> String {
    let merchant = sanitize_file_name_part(merchant_name, 60);
    let merchant = if merchant.is_empty() { "تاجر".to_string() } else { merchant };
    format!(
        "فواتير_{merchant}_{}_{}.pdf",
        sanitize_file_name_part(date_from, 10),
        sanitize_file_name_part(date_to, 10)
    )
}

/// `n <= 1` → الاسم كما هو؛ `n >= 2` → رقم تسلسلي قبل الامتداد: `الاسم (2).pdf`.
pub fn numbered_file_name(file_name: &str, n: u32) -> String {
    if n <= 1 {
        return file_name.to_string();
    }
    match file_name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({n}){}", &file_name[..dot], &file_name[dot..]),
        _ => format!("{file_name} ({n})"),
    }
}

/// يحجز اسماً غير موجود في `dir` بإنشاء ملف فارغ بـ`create_new` (ذرّي: يفشل إن
/// وُجد الملف) — **لا يستبدل أي ملف موجود أبداً**، حتى لو ظهر ملف بنفس الاسم
/// بين الفحص والحجز؛ يجرّب الأسماء المرقَّمة بالتتابع (2، 3، ...).
pub fn reserve_unique_file(dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    for n in 1..=9999u32 {
        let candidate = dir.join(numbered_file_name(file_name, n));
        match OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(_) => return Ok(candidate),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("تعذّر إنشاء ملف الإخراج في '{}': {e}", dir.display())),
        }
    }
    Err("تعذّر إيجاد اسم غير مستخدم للملف النهائي في مجلد الحفظ.".to_string())
}

/// بادئة اسم ملف هذه الميزة (`فواتير_…pdf`)، يستخدمها التحقق أدناه كي لا يُوجَّه
/// "فتح المكان" إلا لملفات الطباعة الجماعية.
pub const PDF_FILE_PREFIX: &str = "فواتير_";

/// يتحقق من مسار يصل من الواجهة لزر "فتح مكان الملف" ويُعيد المسار الذي يجوز
/// كشفه في المستكشف. الشروط كلها معاً (أي إخلال = خطأ عربي):
///   - مسار مطلق بلا علامة اقتباس مزدوجة ولا محارف تحكّم (يُمرَّر لاحقاً إلى
///     `explorer.exe /select,"…"` كنص خام، فلا يجوز أن يخرج أي محرف من الاقتباس)؛
///   - اسم الملف يبدأ بـ`فواتير_` وينتهي بـ`.pdf`؛
///   - مجلده **هو نفسه** (بعد حل `..` والروابط) أحد المجلدات المسموحة
///     `allowed_dirs` (التنزيلات/سطح المكتب — مجلد الحفظ الفعلي)؛
///   - الملف موجود فعلاً وهو ملف لا مجلد.
/// المُعاد = `المجلد المسموح (كما أعطاه النظام) + اسم الملف` وليس النص الوارد،
/// فلا يصل المستكشف أي جزء من مسار الواجهة سوى اسم الملف المتحقَّق منه.
pub fn resolve_reveal_target(path: &str, allowed_dirs: &[PathBuf]) -> Result<PathBuf, String> {
    let raw = path.trim();
    if raw.is_empty() || raw.chars().any(|c| c == '"' || c.is_control()) {
        return Err("مسار الملف غير صالح.".to_string());
    }
    let given = Path::new(raw);
    if !given.is_absolute() {
        return Err("مسار الملف غير صالح (ليس مساراً كاملاً).".to_string());
    }
    let file_name = given
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "مسار الملف غير صالح.".to_string())?;
    let is_pdf = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !file_name.starts_with(PDF_FILE_PREFIX) || !is_pdf {
        return Err("هذا ليس ملف PDF ناتجاً عن الطباعة الجماعية.".to_string());
    }
    let parent = given
        .parent()
        .ok_or_else(|| "مسار الملف غير صالح.".to_string())?;
    let parent_canon = fs::canonicalize(parent)
        .map_err(|_| "مجلد الملف لم يعد موجوداً.".to_string())?;
    for dir in allowed_dirs {
        let same = match fs::canonicalize(dir) {
            Ok(c) => c == parent_canon,
            Err(_) => dir.as_path() == parent,
        };
        if same {
            let target = dir.join(file_name);
            return match fs::metadata(&target) {
                Ok(m) if m.is_file() => Ok(target),
                _ => Err("الملف لم يعد موجوداً في مكانه (ربما نُقل أو حُذف).".to_string()),
            };
        }
    }
    Err("مسار الملف خارج مجلد حفظ الطباعة الجماعية.".to_string())
}

// ───────────────────────── التحويل: xlsx → PDF عبر LibreOffice ─────────────────────────

/// نتيجة تحويل مجموعة ملفات: فهارس الفواتير التي لم يُنتَج لها PDF سليم، وسبب
/// الفشل (نص فارغ عند نجاح الكل).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConvertReport {
    pub failed: Vec<usize>,
    pub reason: String,
}

/// مهلة تحويل مجموعة من `n` ملفاً: 90 ثانية (إقلاع LibreOffice وأول تشغيل
/// لملف تعريف جديد على Windows قد يطولان) + 30 ثانية لكل ملف، بحد أعلى 15 دقيقة.
fn convert_timeout(n: usize) -> Duration {
    Duration::from_secs((90 + 30 * n as u64).min(900))
}

/// ملف PDF "مكتمل" ظاهرياً: يبدأ بـ`%PDF-` وفي آخر ألف بايت `%%EOF`. يُستخدَم
/// للتأكد أن soffice أنهى الكتابة (لا ملف فارغ ولا مقطوع).
pub fn pdf_looks_complete(path: &Path) -> bool {
    let Ok(mut f) = File::open(path) else {
        return false;
    };
    let Ok(len) = f.metadata().map(|m| m.len()) else {
        return false;
    };
    if len < 64 {
        return false;
    }
    let mut head = [0u8; 5];
    if f.read_exact(&mut head).is_err() || &head != b"%PDF-" {
        return false;
    }
    let tail_len = len.min(1024);
    if f.seek(SeekFrom::End(-(tail_len as i64))).is_err() {
        return false;
    }
    let mut tail = Vec::with_capacity(tail_len as usize);
    if f.read_to_end(&mut tail).is_err() {
        return false;
    }
    tail.windows(5).any(|w| w == b"%%EOF")
}

fn tail_of(path: &Path, max_chars: usize) -> String {
    let text = fs::read_to_string(path).unwrap_or_default();
    let text = text.trim();
    let count = text.chars().count();
    if count <= max_chars {
        text.to_string()
    } else {
        text.chars().skip(count - max_chars).collect()
    }
}

fn failed_indices(batch_dir: &Path, indices: &[usize]) -> Vec<usize> {
    indices
        .iter()
        .copied()
        .filter(|i| !pdf_looks_complete(&batch_dir.join(batch_pdf_name(*i))))
        .collect()
}

/// يحوّل ملفات xlsx الوسيطة ذات الفهارس `indices` (موجودة في `batch_dir`) إلى
/// PDF في المجلد نفسه، **باستدعاء soffice واحد لكل المجموعة** (كلفة إقلاع
/// LibreOffice تُدفع مرة واحدة لا لكل فاتورة)، ثم يتحقق من وجود PDF سليم لكل
/// فهرس. `Err` فقط عند تعذّر تشغيل LibreOffice أصلاً؛ أي فاتورة بلا PDF سليم
/// تظهر في `failed` مع السبب (الكل أو لا شيء يُطبَّق من المستدعي).
///
/// مهلة أمان مناسبة لحجم المجموعة (`convert_timeout`)؛ عند تجاوزها تُقتَل
/// العملية ويُحسب الناقص. وبعد خروج العملية نمهل الملفات فترة سماح قصيرة
/// (15 ثانية) قبل الحكم عليها بالنقص — يغطي أي إطلاق مغلِّف (launcher) يعود
/// قبل اكتمال كتابة الملفات.
pub fn convert_xlsx_batch(
    batch_dir: &Path,
    profile_dir: &Path,
    indices: &[usize],
) -> Result<ConvertReport, CoreError> {
    if indices.is_empty() {
        return Ok(ConvertReport { failed: Vec::new(), reason: String::new() });
    }

    let mut inputs: Vec<PathBuf> = Vec::with_capacity(indices.len());
    for &i in indices {
        let xlsx = batch_dir.join(batch_xlsx_name(i));
        if !xlsx.is_file() {
            return Err(CoreError::at(i, "ملف الفاتورة الوسيط (xlsx) غير موجود — لم يُجهَّز بعد."));
        }
        // حالة نظيفة: لا PDF قديم يُحسب نجاحاً زائفاً.
        let _ = fs::remove_file(batch_dir.join(batch_pdf_name(i)));
        inputs.push(xlsx);
    }

    let _ = fs::create_dir_all(profile_dir);
    let profile_uri = to_file_uri(profile_dir);
    let stderr_log = batch_dir.join("soffice_stderr.log");
    let timeout = convert_timeout(indices.len());

    let mut last_err: Option<String> = None;
    let mut reason = String::new();
    let mut ran = false;

    for candidate in soffice_candidates() {
        let mut cmd = Command::new(&candidate);
        cmd.arg("--headless")
            .arg("--invisible")
            .arg("--norestore")
            .arg("--nologo")
            .arg("--nofirststartwizard")
            .arg(format!("-env:UserInstallation={profile_uri}"))
            // مرشِّح الاستيراد صريح: بدونه يخمّن LibreOffice نوع الملف، وملف xlsx
            // تالف قد يُستورَد "نصاً" فيُنتج PDF صفحاته هراء ويبدو نجاحاً زائفاً
            // (جُرِّب فعلياً). بالمرشِّح الصريح يفشل تحميل أي ملف ليس xlsx سليماً،
            // فلا يُنتَج له PDF ويُنسَب الفشل لفاتورته (الكل أو لا شيء).
            .arg("--infilter=Calc MS Excel 2007 XML")
            .arg("--convert-to")
            .arg("pdf:calc_pdf_Export")
            .arg("--outdir")
            .arg(batch_dir);
        for p in &inputs {
            cmd.arg(p);
        }
        let stderr_target = match File::create(&stderr_log) {
            Ok(f) => Stdio::from(f),
            Err(_) => Stdio::null(),
        };
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(stderr_target);
        suppress_window(&mut cmd);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                last_err = Some(format!(
                    "لم يتم العثور على LibreOffice عبر '{}': {e}",
                    candidate.display()
                ));
                continue;
            }
            Err(e) => return Err(CoreError::new(format!("تعذّر تشغيل LibreOffice للتحويل إلى PDF: {e}"))),
        };
        ran = true;

        let deadline = Instant::now() + timeout;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        reason = format!(
                            "فشل LibreOffice في التحويل (رمز الخروج: {status}). {}",
                            tail_of(&stderr_log, 300)
                        );
                    }
                    break;
                }
                Ok(None) => {
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        reason = format!(
                            "تجاوز تحويل الملفات إلى PDF المهلة الزمنية المسموحة ({} ثانية).",
                            timeout.as_secs()
                        );
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                Err(e) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(CoreError::new(format!("تعذّر متابعة حالة عملية التحويل: {e}")));
                }
            }
        }
        break;
    }

    if !ran {
        return Err(CoreError::new(last_err.unwrap_or_else(|| {
            "تعذّر العثور على LibreOffice على هذا الجهاز — هو لازم لتحويل الفواتير إلى PDF.".to_string()
        })));
    }

    // فترة سماح: نعيد الفحص حتى تكتمل كل الملفات أو تنتهي المهلة القصيرة.
    let grace_deadline = Instant::now() + Duration::from_secs(15);
    let mut failed = failed_indices(batch_dir, indices);
    while !failed.is_empty() && Instant::now() < grace_deadline {
        std::thread::sleep(Duration::from_millis(250));
        failed = failed_indices(batch_dir, indices);
    }

    if failed.is_empty() {
        return Ok(ConvertReport { failed, reason: String::new() });
    }
    if reason.is_empty() {
        reason = format!("لم يُنتج LibreOffice ملف PDF سليماً لهذه الفاتورة. {}", tail_of(&stderr_log, 300))
            .trim()
            .to_string();
    }
    Ok(ConvertReport { failed, reason })
}

// ───────────────────────── الدمج: ملفات PDF → ملف واحد ─────────────────────────

/// نتيجة دمج ناجح: مجموع الصفحات وعدد صفحات كل مدخل (بترتيب المدخلات).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeReport {
    pub total_pages: usize,
    pub per_file_pages: Vec<usize>,
}

/// الخصائص التي يجوز أن ترثها الصفحة من عقدة `Pages` الأب. عند الدمج تُحذف
/// عقد `Pages` الأصلية فتُنسَخ هذه إلى الصفحة نفسها قبل ذلك كي لا تفقد
/// مواردها (الخطوط!) أو مقاسها.
const INHERITABLE_PAGE_KEYS: [&[u8]; 4] = [b"Resources", b"MediaBox", b"CropBox", b"Rotate"];

fn materialize_inherited_page_attrs(doc: &mut Document, page_id: ObjectId) {
    for key in INHERITABLE_PAGE_KEYS {
        let page_has = doc
            .get_object(page_id)
            .ok()
            .and_then(|o| o.as_dict().ok())
            .map(|d| d.has(key))
            .unwrap_or(true);
        if page_has {
            continue;
        }
        let mut current = page_id;
        let mut found: Option<Object> = None;
        for _ in 0..64 {
            let parent = doc
                .get_object(current)
                .ok()
                .and_then(|o| o.as_dict().ok())
                .and_then(|d| d.get(b"Parent").ok())
                .and_then(|p| p.as_reference().ok());
            let Some(parent_id) = parent else { break };
            if let Some(value) = doc
                .get_object(parent_id)
                .ok()
                .and_then(|o| o.as_dict().ok())
                .and_then(|d| d.get(key).ok())
            {
                found = Some(value.clone());
                break;
            }
            current = parent_id;
        }
        if let Some(value) = found {
            if let Ok(Object::Dictionary(d)) = doc.get_object_mut(page_id) {
                d.set(key.to_vec(), value);
            }
        }
    }
}

/// يدمج `inputs` (بالترتيب المعطى بالضبط) في ملف PDF واحد `output`.
///
/// الأسلوب: يُحمَّل كل PDF، تُثبَّت الخصائص الموروثة على صفحاته، ثم تُعاد
/// ترقيم كائناته بإزاحة فريدة وتُنسَخ **كلها كما هي** (خطوط، صور، محتوى) إلى
/// المستند المدمج — فلا يُعاد ترميز أي شيء، وتبقى الخطوط العربية المضمَّنة
/// وكل صفحات كل فاتورة. تُبنى عقدة `Pages` وكتالوج جديدان وتُربَط الصفحات بها
/// بالترتيب، وتُحذف الكائنات اليتيمة. وبعد الحفظ يُعاد فتح الملف الناتج
/// ويُتحقَّق أن عدد صفحاته = مجموع صفحات المدخلات (وإلا خطأ، لا تسليم).
pub fn merge_pdfs(inputs: &[PathBuf], output: &Path) -> Result<MergeReport, CoreError> {
    if inputs.is_empty() {
        return Err(CoreError::new("لا توجد ملفات PDF للدمج."));
    }

    let mut max_id: u32 = 1;
    let mut ordered_pages: Vec<ObjectId> = Vec::new();
    let mut objects: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut per_file_pages: Vec<usize> = Vec::with_capacity(inputs.len());

    for (i, path) in inputs.iter().enumerate() {
        let mut doc = Document::load(path)
            .map_err(|e| CoreError::at(i, format!("تعذّرت قراءة ملف PDF الناتج عن التحويل: {e}")))?;
        if doc.is_encrypted() {
            return Err(CoreError::at(i, "ملف PDF الناتج مشفَّر بصورة غير متوقعة."));
        }
        let first_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
        if first_ids.is_empty() {
            return Err(CoreError::at(i, "ملف PDF الناتج لا يحتوي أي صفحة."));
        }
        for pid in &first_ids {
            materialize_inherited_page_attrs(&mut doc, *pid);
        }

        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;

        // بعد إعادة الترقيم تتغير هويات الصفحات — نعيد قراءتها (الترتيب داخل
        // المستند يتبع رقم الصفحة، لا رقم الكائن).
        let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
        per_file_pages.push(page_ids.len());
        ordered_pages.extend(page_ids);
        objects.extend(doc.objects);
    }

    let mut merged = Document::with_version("1.5");
    let pages_root_id: ObjectId = (max_id, 0);
    let catalog_id: ObjectId = (max_id + 1, 0);

    for (id, object) in objects {
        // الكتالوج وعقد Pages القديمة والمخطط (Outlines) تُستبدَل ببنية جديدة.
        match object.type_name().unwrap_or(b"") {
            b"Catalog" | b"Pages" | b"Outlines" | b"Outline" => continue,
            _ => {}
        }
        merged.objects.insert(id, object);
    }

    for page_id in &ordered_pages {
        if let Some(Object::Dictionary(d)) = merged.objects.get_mut(page_id) {
            d.set("Parent", Object::Reference(pages_root_id));
        } else {
            return Err(CoreError::new("تعذّر ربط إحدى الصفحات أثناء الدمج (كائن الصفحة مفقود)."));
        }
    }

    let kids: Vec<Object> = ordered_pages.iter().map(|id| Object::Reference(*id)).collect();
    let mut pages_dict = lopdf::Dictionary::new();
    pages_dict.set("Type", "Pages");
    pages_dict.set("Count", ordered_pages.len() as i64);
    pages_dict.set("Kids", kids);
    merged.objects.insert(pages_root_id, Object::Dictionary(pages_dict));

    let mut catalog = lopdf::Dictionary::new();
    catalog.set("Type", "Catalog");
    catalog.set("Pages", Object::Reference(pages_root_id));
    merged.objects.insert(catalog_id, Object::Dictionary(catalog));

    merged.trailer.set("Root", Object::Reference(catalog_id));
    merged.max_id = catalog_id.0;
    merged.prune_objects();
    merged.renumber_objects();

    merged
        .save(output)
        .map_err(|e| CoreError::new(format!("تعذّرت كتابة ملف PDF المدمج: {e}")))?;

    // تحقق نهائي من الملف المكتوب فعلاً (لا من الذاكرة).
    let total: usize = per_file_pages.iter().sum();
    let reloaded = Document::load(output)
        .map_err(|e| CoreError::new(format!("الملف المدمج لا يُفتح سليماً: {e}")))?;
    let reloaded_pages = reloaded.get_pages().len();
    if reloaded_pages != total {
        return Err(CoreError::new(format!(
            "عدد صفحات الملف المدمج ({reloaded_pages}) لا يطابق مجموع صفحات الفواتير ({total})."
        )));
    }

    Ok(MergeReport { total_pages: total, per_file_pages })
}

// ───────────────────────── الاختبارات (الأجزاء البحتة + دمج PDF حقيقي صغير) ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Stream};

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mks_batch_test_{tag}_{}_{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ── تنظيف أسماء الملفات ──

    #[test]
    fn sanitize_replaces_windows_illegal_chars() {
        assert_eq!(sanitize_file_name_part("a\\b/c:d*e?f\"g<h>i|j", 60), "a_b_c_d_e_f_g_h_i_j");
    }

    #[test]
    fn sanitize_trims_edges_and_collapses_spaces() {
        assert_eq!(sanitize_file_name_part("  تاجر   الأمل.. ", 60), "تاجر الأمل");
        assert_eq!(sanitize_file_name_part("...", 60), "");
        assert_eq!(sanitize_file_name_part("***", 60), "");
        assert_eq!(sanitize_file_name_part("a\tb\nc", 60), "a b c");
    }

    #[test]
    fn sanitize_replaces_control_chars_and_caps_length() {
        assert_eq!(sanitize_file_name_part("a\u{0007}b", 60), "a_b");
        assert_eq!(sanitize_file_name_part("abcdefghij", 4), "abcd");
        // القصّ بالمحارف لا بالبايتات (العربية متعددة البايتات).
        assert_eq!(sanitize_file_name_part("تاجرالأمل", 4), "تاجر");
        // القصّ لا يترك مسافة/نقطة في الطرف.
        assert_eq!(sanitize_file_name_part("ab. cd", 3), "ab");
    }

    #[test]
    fn file_name_follows_required_pattern() {
        assert_eq!(
            build_pdf_file_name("تاجر الأمل", "2026-10-01", "2026-10-31"),
            "فواتير_تاجر الأمل_2026-10-01_2026-10-31.pdf"
        );
        // محارف ويندوز غير المسموحة تصير "_" (المسافة العادية تبقى).
        assert_eq!(
            build_pdf_file_name("شركة \"الفجر\"/فرع", "2026-01-01", "2026-01-31"),
            "فواتير_شركة _الفجر__فرع_2026-01-01_2026-01-31.pdf"
        );
    }

    #[test]
    fn file_name_falls_back_when_merchant_name_empties() {
        assert_eq!(
            build_pdf_file_name("???", "2026-10-01", "2026-10-31"),
            "فواتير_تاجر_2026-10-01_2026-10-31.pdf"
        );
    }

    #[test]
    fn numbered_names_are_sequential() {
        assert_eq!(numbered_file_name("x.pdf", 1), "x.pdf");
        assert_eq!(numbered_file_name("x.pdf", 2), "x (2).pdf");
        assert_eq!(numbered_file_name("x.y.pdf", 10), "x.y (10).pdf");
        assert_eq!(numbered_file_name("noext", 3), "noext (3)");
    }

    #[test]
    fn reserve_unique_file_never_overwrites() {
        let dir = temp_dir("reserve");
        let first = reserve_unique_file(&dir, "فواتير_س_2026-10-01_2026-10-31.pdf").unwrap();
        fs::write(&first, b"ORIGINAL").unwrap();
        let second = reserve_unique_file(&dir, "فواتير_س_2026-10-01_2026-10-31.pdf").unwrap();
        let third = reserve_unique_file(&dir, "فواتير_س_2026-10-01_2026-10-31.pdf").unwrap();
        assert!(first.to_string_lossy().ends_with("2026-10-31.pdf"));
        assert!(second.to_string_lossy().ends_with("2026-10-31 (2).pdf"));
        assert!(third.to_string_lossy().ends_with("2026-10-31 (3).pdf"));
        assert_eq!(fs::read(&first).unwrap(), b"ORIGINAL", "الملف الموجود لا يُستبدَل");
        let _ = fs::remove_dir_all(&dir);
    }

    // ── ترتيب المسارات ──

    #[test]
    fn ordered_pdf_paths_follow_batch_order() {
        let dir = Path::new("/x");
        let paths = ordered_pdf_paths(dir, 12);
        assert_eq!(paths.len(), 12);
        assert_eq!(paths[0], dir.join("inv_00000.pdf"));
        assert_eq!(paths[2], dir.join("inv_00002.pdf"));
        assert_eq!(paths[10], dir.join("inv_00010.pdf"));
        assert_eq!(paths[11], dir.join("inv_00011.pdf"));
    }

    #[test]
    fn padded_names_sort_lexicographically_like_numbers() {
        let mut names: Vec<String> = (0..1200).map(batch_pdf_name).collect();
        let original = names.clone();
        names.sort();
        assert_eq!(names, original, "الترتيب النصي يجب أن يطابق الرقمي");
        assert_eq!(batch_xlsx_name(7), "inv_00007.xlsx");
    }

    // ── معرّف الدفعة والتنظيف ──

    #[test]
    fn batch_id_validation_blocks_path_tricks() {
        assert!(is_valid_batch_id("batch_1730000000000_0"));
        assert!(is_valid_batch_id(&new_batch_id()));
        for bad in [
            "", "batch_", "batch_1", "batch_1_2_3", "batch_a_b", "batch__1", "batch_1_",
            "../batch_1_2", "batch_1_2/..", "batch_1_2\\x", "/etc/passwd", "C:\\Windows",
            "xbatch_1_2", "batch_1 _2", "batch_١٢_٣",
        ] {
            assert!(!is_valid_batch_id(bad), "يجب رفض: {bad:?}");
        }
        assert!(!is_valid_batch_id(&format!("batch_{}_1", "9".repeat(60))));
    }

    #[test]
    fn stale_detection_uses_embedded_timestamp_only() {
        let now: u128 = 2_000_000_000_000;
        let old = format!("batch_{}_0", now - STALE_BATCH_MAX_AGE_MS - 1);
        let fresh = format!("batch_{}_0", now - STALE_BATCH_MAX_AGE_MS + 1_000);
        let future = format!("batch_{}_0", now + 5_000);
        assert!(is_stale_batch_id(&old, now));
        assert!(!is_stale_batch_id(&fresh, now));
        assert!(!is_stale_batch_id(&future, now));
        assert!(!is_stale_batch_id("generated", now));
        assert!(!is_stale_batch_id("batch_x_y", now));
    }

    #[test]
    fn remove_stale_batch_dirs_touches_only_old_batch_dirs() {
        let generated = temp_dir("stale");
        let now = now_millis();
        let old = generated.join(format!("batch_{}_0", now - STALE_BATCH_MAX_AGE_MS - 10_000));
        let fresh = generated.join(format!("batch_{now}_1"));
        let other_dir = generated.join("something_else");
        let file = generated.join("2610-7-1.xlsx");
        for d in [&old, &fresh, &other_dir] {
            fs::create_dir_all(d).unwrap();
            fs::write(d.join("f.txt"), b"x").unwrap();
        }
        fs::write(&file, b"x").unwrap();

        remove_stale_batch_dirs(&generated);

        assert!(!old.exists(), "المخلَّف القديم يُحذف");
        assert!(fresh.exists(), "الدفعة الحديثة لا تُمَس");
        assert!(other_dir.exists(), "مجلد لا يطابق الصيغة لا يُمَس");
        assert!(file.exists(), "الملفات لا تُمَس");
        let _ = fs::remove_dir_all(&generated);
    }

    #[test]
    fn iso_date_validation() {
        assert!(is_valid_iso_date("2026-10-31"));
        assert!(is_valid_iso_date("2026-02-30")); // التحقق شكلي (النطاق يحدده المستدعي)
        for bad in ["", "2026-1-01", "2026/10/31", "26-10-31", "2026-13-01", "2026-00-10", "2026-10-00", "2026-10-32", "٢٠٢٦-١٠-٣١", "2026-10-311"] {
            assert!(!is_valid_iso_date(bad), "يجب رفض: {bad:?}");
        }
    }

    // ── اكتمال ملف PDF ──

    #[test]
    fn pdf_completeness_check() {
        let dir = temp_dir("complete");
        let good = dir.join("good.pdf");
        let mut body = b"%PDF-1.4\n".to_vec();
        body.extend(std::iter::repeat(b'x').take(100));
        body.extend(b"\n%%EOF\n");
        fs::write(&good, &body).unwrap();
        assert!(pdf_looks_complete(&good));

        let truncated = dir.join("truncated.pdf");
        fs::write(&truncated, &body[..body.len() - 10]).unwrap();
        assert!(!pdf_looks_complete(&truncated));

        let empty = dir.join("empty.pdf");
        fs::write(&empty, b"").unwrap();
        assert!(!pdf_looks_complete(&empty));

        let not_pdf = dir.join("not.pdf");
        fs::write(&not_pdf, vec![b'z'; 500]).unwrap();
        assert!(!pdf_looks_complete(&not_pdf));
        assert!(!pdf_looks_complete(&dir.join("missing.pdf")));
        let _ = fs::remove_dir_all(&dir);
    }

    // ── دمج PDF حقيقي صغير (مستندات تُولَّد بـlopdf نفسها) ──

    /// مستند بصفحات `pages`، في كل صفحة نص فريد `{marker}-p{n}`. عند
    /// `inherit = true` توضع Resources/MediaBox على عقدة Pages فقط (وراثة).
    fn media_box() -> Vec<Object> {
        vec![Object::Integer(0), Object::Integer(0), Object::Integer(595), Object::Integer(842)]
    }

    fn fake_pdf(marker: &str, pages: usize, inherit: bool) -> Document {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Courier",
        });
        let resources = dictionary! { "Font" => dictionary! { "F1" => font_id } };
        let mut kids: Vec<Object> = Vec::new();
        for n in 1..=pages {
            let text = format!("BT /F1 12 Tf 50 700 Td ({marker}-p{n}) Tj ET");
            let content_id = doc.add_object(Stream::new(dictionary! {}, text.into_bytes()));
            let mut page = dictionary! {
                "Type" => "Page", "Parent" => pages_id, "Contents" => content_id,
            };
            if !inherit {
                page.set("Resources", resources.clone());
                page.set("MediaBox", media_box());
            }
            kids.push(doc.add_object(page).into());
        }
        let mut pages_dict = dictionary! {
            "Type" => "Pages", "Kids" => kids, "Count" => pages as i64,
        };
        if inherit {
            pages_dict.set("Resources", resources);
            pages_dict.set("MediaBox", media_box());
        }
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        doc
    }

    fn page_markers(doc: &Document) -> Vec<String> {
        doc.get_pages()
            .into_values()
            .map(|pid| String::from_utf8_lossy(&doc.get_page_content(pid).unwrap()).to_string())
            .collect()
    }

    #[test]
    fn merge_keeps_order_pages_and_inherited_attrs() {
        let dir = temp_dir("merge");
        // مدخلات بأعداد صفحات مختلفة (فاتورة متعددة الصفحات) وبعضها بخصائص موروثة.
        let specs = [("A", 1usize, false), ("B", 3, true), ("C", 2, false), ("D", 1, true)];
        let mut inputs = Vec::new();
        for (i, (marker, pages, inherit)) in specs.iter().enumerate() {
            let mut doc = fake_pdf(marker, *pages, *inherit);
            let path = dir.join(batch_pdf_name(i));
            doc.save(&path).unwrap();
            inputs.push(path);
        }
        let out = dir.join("merged.pdf");
        let report = merge_pdfs(&inputs, &out).unwrap();
        assert_eq!(report.total_pages, 7);
        assert_eq!(report.per_file_pages, vec![1, 3, 2, 1]);

        let merged = Document::load(&out).unwrap();
        let markers = page_markers(&merged);
        let expected = ["A-p1", "B-p1", "B-p2", "B-p3", "C-p1", "C-p2", "D-p1"];
        assert_eq!(markers.len(), expected.len());
        for (got, want) in markers.iter().zip(expected) {
            assert!(got.contains(want), "ترتيب الصفحات: توقعنا {want} فوجدنا {got}");
        }
        // كل صفحة (حتى الموروثة) تملك موارد ومقاساً صريحين بعد الدمج.
        for pid in merged.get_pages().into_values() {
            let page = merged.get_object(pid).unwrap().as_dict().unwrap();
            assert!(page.has(b"Resources"), "Resources مفقودة بعد الدمج");
            assert!(page.has(b"MediaBox"), "MediaBox مفقودة بعد الدمج");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_reports_failing_input_index() {
        let dir = temp_dir("merge_err");
        let good = dir.join("g.pdf");
        fake_pdf("G", 1, false).save(&good).unwrap();
        let bad = dir.join("bad.pdf");
        fs::write(&bad, b"this is not a pdf at all").unwrap();
        let missing = dir.join("nope.pdf");
        let out = dir.join("out.pdf");

        let err = merge_pdfs(&[good.clone(), bad.clone()], &out).unwrap_err();
        assert_eq!(err.index, Some(1));
        let err = merge_pdfs(&[good.clone(), good.clone(), missing], &out).unwrap_err();
        assert_eq!(err.index, Some(2));
        assert!(!out.exists(), "لا ملف ناتج عند الفشل");
        assert!(merge_pdfs(&[], &out).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    // ── التحقق من مسار "فتح مكان الملف" ──

    const OK_NAME: &str = "فواتير_تاجر الأمل_2026-10-01_2026-10-31.pdf";

    fn touch(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, b"%PDF-1.4\n%%EOF").unwrap();
        p
    }

    #[test]
    fn reveal_accepts_batch_pdf_in_allowed_dir() {
        let dl = temp_dir("rv_ok");
        let f = touch(&dl, OK_NAME);
        let got = resolve_reveal_target(&f.display().to_string(), &[dl.clone()]).unwrap();
        assert_eq!(got, dl.join(OK_NAME));
        // رقم تسلسلي " (2)" واسم بامتداد كبير أيضاً مقبولان
        let f2 = touch(&dl, "فواتير_س_2026-10-01_2026-10-31 (2).PDF");
        assert!(resolve_reveal_target(&f2.display().to_string(), &[dl.clone()]).is_ok());
    }

    #[test]
    fn reveal_accepts_second_allowed_dir_like_desktop_fallback() {
        let dl = temp_dir("rv_dl");
        let desk = temp_dir("rv_desk");
        let f = touch(&desk, OK_NAME);
        let got = resolve_reveal_target(&f.display().to_string(), &[dl, desk.clone()]).unwrap();
        assert_eq!(got, desk.join(OK_NAME));
    }

    #[test]
    fn reveal_rejects_dir_outside_allowed() {
        let dl = temp_dir("rv_in");
        let other = temp_dir("rv_out");
        let f = touch(&other, OK_NAME);
        assert!(resolve_reveal_target(&f.display().to_string(), &[dl]).is_err());
    }

    #[test]
    fn reveal_rejects_path_traversal_into_other_dir() {
        let dl = temp_dir("rv_tr_in");
        let other = temp_dir("rv_tr_out");
        touch(&other, OK_NAME);
        let sneaky = format!(
            "{}/../{}/{}",
            dl.display(),
            other.file_name().unwrap().to_str().unwrap(),
            OK_NAME
        );
        // المسار الملتوي يحلّ إلى مجلد آخر → مرفوض، رغم أن بدايته داخل المسموح
        let other_parent = other.parent().unwrap().to_path_buf();
        assert_eq!(dl.parent().unwrap(), other_parent.as_path());
        assert!(resolve_reveal_target(&sneaky, &[dl]).is_err());
    }

    #[test]
    fn reveal_accepts_dotdot_that_resolves_back_to_allowed_dir() {
        let dl = temp_dir("rv_dd");
        fs::create_dir_all(dl.join("sub")).unwrap();
        touch(&dl, OK_NAME);
        let p = format!("{}/sub/../{}", dl.display(), OK_NAME);
        // يحلّ إلى المجلد المسموح نفسه؛ والمُعاد مسار نظيف بلا ".."
        let got = resolve_reveal_target(&p, &[dl.clone()]).unwrap();
        assert_eq!(got, dl.join(OK_NAME));
        assert!(!got.display().to_string().contains(".."));
    }

    #[test]
    fn reveal_rejects_wrong_name_or_extension() {
        let dl = temp_dir("rv_name");
        let a = touch(&dl, "تقرير_2026.pdf");
        let b = touch(&dl, "فواتير_س_2026-10-01_2026-10-31.txt");
        let c = touch(&dl, "فواتير_س_2026-10-01_2026-10-31.pdf.exe");
        for f in [a, b, c] {
            assert!(resolve_reveal_target(&f.display().to_string(), &[dl.clone()]).is_err(), "{f:?}");
        }
    }

    #[test]
    fn reveal_rejects_missing_file_directory_and_bad_input() {
        let dl = temp_dir("rv_bad");
        let missing = dl.join(OK_NAME);
        assert!(resolve_reveal_target(&missing.display().to_string(), &[dl.clone()]).is_err());
        // مجلد باسم يطابق الشروط ليس ملفاً
        let dir_named = dl.join("فواتير_مجلد_2026-10-01_2026-10-31.pdf");
        fs::create_dir_all(&dir_named).unwrap();
        assert!(resolve_reveal_target(&dir_named.display().to_string(), &[dl.clone()]).is_err());
        for bad in ["", "   ", "relative/فواتير_س.pdf", "فواتير_س.pdf"] {
            assert!(resolve_reveal_target(bad, &[dl.clone()]).is_err(), "{bad:?}");
        }
        // اقتباس مزدوج أو محرف تحكّم (حقن في وسائط explorer)
        let quoted = format!("{}/فواتير_\" /select,C:\\x.pdf", dl.display());
        assert!(resolve_reveal_target(&quoted, &[dl.clone()]).is_err());
        let ctrl = format!("{}/{}\u{0}", dl.display(), OK_NAME);
        assert!(resolve_reveal_target(&ctrl, &[dl.clone()]).is_err());
        // لا مجلدات مسموحة أصلاً
        let f = touch(&dl, "فواتير_ب_2026-10-01_2026-10-31.pdf");
        assert!(resolve_reveal_target(&f.display().to_string(), &[]).is_err());
    }
}
