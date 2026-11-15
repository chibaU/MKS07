// ============================================================================
// أوامر Tauri للطباعة الجماعية لفواتير تاجر إلى **ملف PDF واحد** (ميزة معزولة
// تماماً عن مسار الطباعة العادية/الصامتة — راجع AI_CONTEXT.md القسمين 6.5
// و6.7، والقاعدة الجديدة في القسم 8).
//
// الأوامر رقيقة عمداً (كل منطقها البحت واختباراته في `batch_pdf_core.rs`).
// الواجهة (`src/services/batchPrint.ts`) هي من تقود الحلقة بالتتابع كي يكون
// التقدم صادقاً والإلغاء ممكناً بين الخطوات:
//
//   prepare      ← ينشئ مجلد الدفعة المؤقت `AppData/generated/batch_<ts>_<n>`
//   add_invoice  ← فاتورة واحدة: يبني xlsx مُعبَّأ بنفس منطق الطباعة العادية
//   convert      ← يحوّل مجموعة xlsx إلى PDF بـLibreOffice (استدعاء واحد/مجموعة)
//   finalize     ← يدمج PDF بالترتيب ويحفظه في التنزيلات ويكشفه في المستكشف
//   cleanup      ← يحذف مجلد الدفعة كاملاً (تستدعيه الواجهة نجاحاً أو فشلاً)
//   reveal       ← زر "فتح مكان الملف": يكشف PDF الناتج في المستكشف (بعد التحقق من مساره)
//
// **كلها `async` + `spawn_blocking` عمداً:** أوامر Tauri v2 غير الـasync تعمل
// على الخيط الرئيسي، فكان التحويل (دقائق) سيجمّد الواجهة فلا يتحرك شريط
// التقدم ولا يعمل زر "إلغاء". (الأوامر الحالية للطباعة لم تُمَس.)
//
// **للقراءة فقط على القاعدة:** لا شيء هنا يعرف قاعدة البيانات أصلاً — كل
// البيانات تصل جاهزة من الواجهة (نفس `buildPayload` المستخدمة للطباعة العادية).
// **لا مسار "فتح Excel" الاحتياطي** هنا: أي فشل يُنهي الدفعة كلها.
// ============================================================================

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::batch_pdf_core as bcore;
use crate::invoice_template::{
    build_invoice_xlsx_to, generated_dir, template_path, InvoicePrintInput, MSG_NO_TEMPLATE,
};

/// أقصى فهرس فاتورة داخل الدفعة (يتسق مع ترقيم الملفات المُصفَّر بخمس خانات).
const MAX_INVOICE_INDEX: usize = 99_999;
/// أقصى عدد ملفات في استدعاء تحويل واحد (حماية من سطر أوامر ضخم على Windows؛
/// الواجهة ترسل 10 فقط في كل مرة).
const MAX_CONVERT_FILES: usize = 50;

/// خطأ أوامر الدفعة كما يصل للواجهة: رسالة عربية + فهرس الفاتورة الفاشلة داخل
/// الدفعة إن عُرف (الواجهة تحوّله إلى رقم الفاتورة وتصيغ الرسالة النهائية).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BatchCmdError {
    pub index: Option<usize>,
    pub message: String,
}

impl BatchCmdError {
    fn at(index: usize, message: impl Into<String>) -> Self {
        Self { index: Some(index), message: message.into() }
    }
}

impl From<String> for BatchCmdError {
    fn from(message: String) -> Self {
        Self { index: None, message }
    }
}

impl From<bcore::CoreError> for BatchCmdError {
    fn from(e: bcore::CoreError) -> Self {
        Self { index: e.index, message: e.message }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareResult {
    pub batch_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertResult {
    /// فهارس الفواتير التي لم يُنتَج لها PDF سليم (فارغة = نجح الكل).
    pub failed: Vec<usize>,
    /// سبب الفشل (فارغ عند النجاح).
    pub reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeResult {
    /// المسار الكامل للملف النهائي في مجلد التنزيلات (أو سطح المكتب بديلاً).
    pub path: String,
    pub pages: usize,
}

/// يشغّل عملاً حاجزاً على خيط مخصَّص بعيداً عن الخيط الرئيسي ومن دون تجميد
/// الواجهة، ويحوّل فشل المهمة نفسها (panic مثلاً) إلى خطأ عربي.
async fn run_blocking<T, F>(work: F) -> Result<T, BatchCmdError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, BatchCmdError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| BatchCmdError::from(format!("تعذّر تنفيذ خطوة الطباعة الجماعية: {e}")))?
}

/// مجلد الدفعة بعد التحقق من صيغة المعرّف (الواجهة هي مصدره — لا نضمّ نصاً
/// حراً إلى أي مسار قبل التحقق، حمايةً من اجتياز المسارات).
fn resolve_batch_dir(app: &AppHandle, batch_id: &str) -> Result<std::path::PathBuf, BatchCmdError> {
    if !bcore::is_valid_batch_id(batch_id) {
        return Err(BatchCmdError::from("معرّف الدفعة غير صالح.".to_string()));
    }
    Ok(generated_dir(app)?.join(batch_id))
}

/// يبدأ دفعة جديدة: يتحقق من وجود القالب المرفوع (برسالة الطباعة العادية نفسها)،
/// يحذف مخلَّفات دفعات قديمة (> 6 ساعات) إن وُجدت، وينشئ مجلد الدفعة المؤقت.
#[tauri::command]
pub async fn batch_invoice_pdf_prepare(app: AppHandle) -> Result<PrepareResult, BatchCmdError> {
    run_blocking(move || {
        let template = template_path(&app)?;
        if !template.exists() {
            return Err(BatchCmdError::from(MSG_NO_TEMPLATE.to_string()));
        }
        let generated = generated_dir(&app)?;
        std::fs::create_dir_all(&generated)
            .map_err(|e| format!("تعذّر إنشاء مجلد ملفات الطباعة: {e}"))?;
        bcore::remove_stale_batch_dirs(&generated);

        let batch_id = bcore::new_batch_id();
        std::fs::create_dir_all(generated.join(&batch_id))
            .map_err(|e| format!("تعذّر إنشاء مجلد الدفعة المؤقت: {e}"))?;
        Ok(PrepareResult { batch_id })
    })
    .await
}

/// يبني ملف xlsx المُعبَّأ لفاتورة واحدة (الفهرس `index` = ترتيبها في الدفعة)
/// داخل مجلد الدفعة، بنفس منطق الطباعة العادية حرفياً (`prepare_invoice_book`
/// + `write_invoice_book`) ودون `cleanup_generated_dir`.
#[tauri::command]
pub async fn batch_invoice_pdf_add_invoice(
    app: AppHandle,
    batch_id: String,
    index: usize,
    data: InvoicePrintInput,
) -> Result<(), BatchCmdError> {
    run_blocking(move || {
        if index > MAX_INVOICE_INDEX {
            return Err(BatchCmdError::at(index, "عدد الفواتير في الدفعة يتجاوز الحد المسموح."));
        }
        let dir = resolve_batch_dir(&app, &batch_id)?;
        if !dir.is_dir() {
            return Err(BatchCmdError::at(index, "مجلد الدفعة المؤقت غير موجود."));
        }
        let template = template_path(&app).map_err(|m| BatchCmdError::at(index, m))?;
        build_invoice_xlsx_to(&template, &data, &dir.join(bcore::batch_xlsx_name(index)))
            .map_err(|m| BatchCmdError::at(index, m))
    })
    .await
}

/// يحوّل ملفات xlsx ذات الفهارس `indices` إلى PDF (استدعاء LibreOffice واحد
/// للمجموعة كلها) ثم يتحقق من وجود PDF سليم لكل فهرس. نجاح الأمر لا يعني نجاح
/// كل الفواتير: على المستدعي فحص `failed` (غير فارغة = يُلغى كل شيء).
#[tauri::command]
pub async fn batch_invoice_pdf_convert(
    app: AppHandle,
    batch_id: String,
    indices: Vec<usize>,
) -> Result<ConvertResult, BatchCmdError> {
    run_blocking(move || {
        if indices.len() > MAX_CONVERT_FILES {
            return Err(BatchCmdError::from(
                "عدد الملفات في دفعة التحويل الواحدة يتجاوز الحد المسموح.".to_string(),
            ));
        }
        let dir = resolve_batch_dir(&app, &batch_id)?;
        let profile_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("تعذّر تحديد مجلد بيانات التطبيق: {e}"))?
            .join("lo_batch_pdf_profile");
        let report = bcore::convert_xlsx_batch(&dir, &profile_dir, &indices)?;
        Ok(ConvertResult { failed: report.failed, reason: report.reason })
    })
    .await
}

/// يدمج ملفات PDF الفواتير (`count` ملفاً بترتيب الدفعة) في ملف واحد، يتحقق منه،
/// ثم يحفظه في مجلد التنزيلات أو سطح المكتب
/// باسم `فواتير_{التاجر}_{من}_{إلى}.pdf` دون استبدال أي ملف موجود، ويكشفه في
/// مستكشف ويندوز. لا يحذف مجلد الدفعة (`cleanup` مسؤولية المستدعي دائماً).
#[tauri::command]
pub async fn batch_invoice_pdf_finalize(
    app: AppHandle,
    batch_id: String,
    count: usize,
    merchant_name: String,
    date_from: String,
    date_to: String,
) -> Result<FinalizeResult, BatchCmdError> {
    run_blocking(move || {
        if count == 0 || count > MAX_INVOICE_INDEX + 1 {
            return Err(BatchCmdError::from("عدد الفواتير غير صالح للدمج.".to_string()));
        }
        if !bcore::is_valid_iso_date(&date_from)
            || !bcore::is_valid_iso_date(&date_to)
            || date_from > date_to
        {
            return Err(BatchCmdError::from("نطاق التاريخ غير صالح.".to_string()));
        }
        let dir = resolve_batch_dir(&app, &batch_id)?;

        let merged_tmp = dir.join("merged.pdf");
        let report = bcore::merge_pdfs(&bcore::ordered_pdf_paths(&dir, count), &merged_tmp)?;

        let target_dir = app
            .path()
            .download_dir()
            .or_else(|_| app.path().desktop_dir())
            .map_err(|e| format!("تعذّر تحديد مجلد الحفظ: {e}"))?;
        std::fs::create_dir_all(&target_dir)
            .map_err(|e| format!("تعذّر الوصول إلى مجلد الحفظ '{}': {e}", target_dir.display()))?;

        let file_name = bcore::build_pdf_file_name(&merchant_name, &date_from, &date_to);
        // الحجز ذرّي (create_new): لا استبدال لملف موجود مهما حدث.
        let final_path = bcore::reserve_unique_file(&target_dir, &file_name)?;
        if let Err(e) = std::fs::copy(&merged_tmp, &final_path) {
            let _ = std::fs::remove_file(&final_path);
            return Err(BatchCmdError::from(format!("تعذّر حفظ الملف النهائي: {e}")));
        }
        let same_size = std::fs::metadata(&merged_tmp).map(|m| m.len()).ok()
            == std::fs::metadata(&final_path).map(|m| m.len()).ok();
        if !same_size {
            let _ = std::fs::remove_file(&final_path);
            return Err(BatchCmdError::from(
                "الملف المحفوظ لا يطابق الملف المدمج (حجم مختلف) — أُلغي الحفظ.".to_string(),
            ));
        }

        reveal_in_explorer(&final_path);
        Ok(FinalizeResult {
            path: final_path.display().to_string(),
            pages: report.total_pages,
        })
    })
    .await
}

/// يحذف مجلد الدفعة المؤقت كاملاً (xlsx وPDF وسجلات). تستدعيه الواجهة في كل
/// الحالات (نجاح/فشل/إلغاء). على Windows قد يُمسك LibreOffice بملف لحظات بعد
/// انتهائه، فنعيد المحاولة قليلاً؛ ما يبقى رغم ذلك يحذفه تلقائياً بدء دفعة
/// لاحقة (`remove_stale_batch_dirs`) بعد 6 ساعات.
#[tauri::command]
pub async fn batch_invoice_pdf_cleanup(app: AppHandle, batch_id: String) -> Result<(), BatchCmdError> {
    run_blocking(move || {
        let dir = resolve_batch_dir(&app, &batch_id)?;
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
        Err(BatchCmdError::from(format!("تعذّر حذف الملفات المؤقتة للدفعة: {last_err}")))
    })
    .await
}

/// زر "فتح مكان الملف" بعد نجاح الدفعة: يكشف ملف PDF الناتج في مستكشف ويندوز
/// محدَّداً (نفس `explorer.exe /select` الذي يُستدعى تلقائياً عند الإنهاء، وهذا
/// الأمر لإعادته إن أُغلقت النافذة أو اختفت). المسار يأتي من الواجهة، فلا يُكشَف
/// إلا ملف `فواتير_…pdf` موجود داخل مجلد حفظ الميزة نفسه (التنزيلات/سطح المكتب)
/// بعد `resolve_reveal_target` — لا اقتباس ولا `..` ولا مجلد آخر. للقراءة فقط.
#[tauri::command]
pub async fn batch_invoice_pdf_reveal(app: AppHandle, path: String) -> Result<(), BatchCmdError> {
    run_blocking(move || {
        let mut allowed: Vec<std::path::PathBuf> = Vec::new();
        if let Ok(dir) = app.path().download_dir() {
            allowed.push(dir);
        }
        if let Ok(dir) = app.path().desktop_dir() {
            allowed.push(dir);
        }
        let target = bcore::resolve_reveal_target(&path, &allowed)?;
        reveal_in_explorer(&target);
        Ok(())
    })
    .await
}

// يكشف الملف في مستكشف ويندوز.
#[cfg(windows)]
fn reveal_in_explorer(path: &std::path::Path) {
    use std::os::windows::process::CommandExt;
    // raw_arg: يمرّ النص كما هو (مع علامات الاقتباس حول المسار) فيحدّد المستكشف الملف حتى مع المسافات.
    let _ = std::process::Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{}\"", path.display()))
        .spawn();
}

#[cfg(not(windows))]
fn reveal_in_explorer(_path: &std::path::Path) {}
