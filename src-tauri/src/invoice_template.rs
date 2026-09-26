// ============================================================================
// مهمة 1/2 — استقبال نموذج Excel للفاتورة + فحص الكلمات المفتاحية.
// مهمة 2/2 — طباعة فاتورة فعلية: تعبئة نفس القالب وفتحه مباشرة (أُضيفت أسفل
// هذا التعليق، بعد دالة `upload_invoice_template`، ضمن نفس الوحدة عمداً —
// راجع تعليق كل قسم لاحقاً لتفاصيل نطاقه).
//
// نطاق القسم الأول (لا تتجاوزه): استقبال بايتات ملف xlsx مرفوع من الواجهة،
// التحقق من صلاحيته الفعلية عبر umya-spreadsheet (لا فقط امتداد الملف)،
// حفظه بشكل دائم كملف وحيد ثابت الاسم/المسار داخل AppData (يستبدل أي قالب
// سابق بالكامل)، وفحص الكلمات المفتاحية {{...}} المستخدَمة داخل الورقة
// الأولى فقط. لا يوجد هنا أي منطق تعبئة بيانات فعلية أو توليد ملف طباعة —
// هذا كان محظوراً صراحة في نطاق مهمة الرفع، ونُفِّذ لاحقاً بالقسم الثاني أدناه.
//
// metadata العرض (اسم الملف الأصلي/تاريخ آخر رفع) لا تُكتب من هنا؛ الواجهة
// (JS) هي من تكتبها عبر settingsService الموجود أصلاً في db.ts بعد نجاح هذا
// الاستدعاء مباشرة — راجع AI_CONTEXT.md، طبقة الخدمات معزولة بالكامل هناك.
//
// **ملاحظة معمارية مهمة حول القسم الثاني (اقرأها قبل أي تعديل عليه):**
// أول تنفيذ لهذه الميزة بنى محرّك رسم PDF مخصَّص بالكامل من الصفر (قراءة
// أنماط كل خلية + تشكيل نص عربي حقيقي عبر rustybuzz + خوارزمية اتجاه UAX #9
// عبر unicode-bidi + بحث عن خطوط Windows + رسم شبكة خلايا يدوياً بـpdf-writer
// + صيغة تقسيم صفحات صريحة). نجح ذاك التنفيذ فعلياً واجتاز مرحلة إثبات جدوى
// مستقلة معتمدة بصرياً — **لكن تبيَّن لاحقاً أنه لا يطابق تنسيق القالب الأصلي
// طبق الأصل** (فقدان لون الخط، المحاذاة العمودية، التفاف النص، الصور
// المضمَّنة، تنسيقات الأرقام — أي شيء لم تتم إعادة تنفيذه يدوياً بمحرك الرسم
// المخصَّص). بعد نقاش مباشر، **استُبدل ذاك المسار بالكامل بهذا المسار الأبسط
// والأكثر أماناً**: تعبئة القالب (نفس منطق `fill_template` المُتحقَّق منه
// فعلياً، بلا أي تغيير) ثم حفظه كملف xlsx حقيقي وفتحه بتطبيق الجداول
// الافتراضي على جهاز المستخدم (Excel أو LibreOffice Calc) — فيُطبَع من هناك
// يدوياً بمحرك عرض حقيقي يطبّق كل شيء بشكل طبيعي: الخط ولونه، المحاذاة،
// التفاف النص، الصور، اتجاه RTL، وحتى إعدادات الطباعة نفسها. هذا يزيل الحاجة
// الكاملة لمحرك الرسم المخصَّص، البحث عن الخطوط، والتشكيل اليدوي — أبسط بكثير
// وأدق بكثير، بثمن وحيد: يتطلب وجود Excel أو تطبيق جداول بيانات متوافق
// (كـLibreOffice Calc) مثبَّتاً ومرتبطاً بامتداد xlsx على جهاز المستخدم.
// ============================================================================

use std::io::Cursor;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use umya_spreadsheet::{reader, writer, OrientationValues, Style, Worksheet};

// zip: يُستخدَم فقط لمعالجة سطر واحد من خاصية <sheetView> الخام مباشرة —
// راجع تعليق `preserve_rtl_view` أدناه لسبب الحاجة الحقيقية لهذا التحايل
// المحدود على واجهة umya-spreadsheet العليا.
use std::io::{Read, Write};

/// اسم مجلد وملف القالب الثابتين داخل AppData. رفع قالب جديد صالح يستبدل هذا
/// الملف بالكامل دائماً — لا أرشفة لنسخ سابقة (قرار معماري ملزم، راجع توثيق
/// المهمة).
const TEMPLATE_SUBDIR: &str = "templates";
const TEMPLATE_FILENAME: &str = "invoice_template.xlsx";

/// علامة تفعيل الصف المتكرر لبنود الفاتورة. مطابقتها **تامة** بعد إزالة
/// المسافات الزائدة من محتوى الخلية — لا substring هنا خلافاً لبقية الكلمات
/// المفتاحية، لأنها يجب أن تبقى لا لبس فيها.
const ROW_MARKER: &str = "{{بند}}";

/// الحقول أحادية القيمة. الستة الأولى من جدول "نظام الكلمات المفتاحية" في
/// توثيق المهمة 1؛ الاثنتان الأخيرتان (الوزن الكلي وعدد الصناديق الكلي)
/// أُضيفتا لاحقاً بطلب صريح — كانتا مفقودتين من نظام الكلمات المفتاحية رغم
/// وجودهما كأسطر ختامية في الفاتورة. المطابقة substring داخل محتوى الخلية،
/// لا يُشترط تطابق الخلية بالكامل — بنفس منطق بقية هذه القائمة.
const SINGLE_VALUE_KEYWORDS: [&str; 8] = [
    "{{رقم_الفاتورة}}",
    "{{تاريخ_الفاتورة}}",
    "{{اسم_التاجر}}",
    "{{هاتف_التاجر}}",
    "{{عنوان_التاجر}}",
    "{{الاجمالي_الكلي}}",
    "{{الوزن_الكلي}}",
    "{{عدد_الصناديق_الكلي}}",
];

/// كلمات صف البند "الأساسية" (غير {{بند}} نفسها) — **الاسم تاريخي فقط،
/// لم تعد إلزامية لا بالرفع ولا بالطباعة** (راجع القرار المعماري رقم 7).
/// تُستخدَم حصراً لعرض حالة (موجودة/غير موجودة) لكل واحدة بالاسم في تقرير
/// فحص الرفع التحذيري (`scan_keywords`)، ولا تُفرض إطلاقاً عند التوليد
/// الفعلي في `fill_template` — أي منها غائبة تعني فقط أن عمودها لن يظهر.
const ROW_REQUIRED_KEYWORDS: [&str; 4] = [
    "{{بند_المنتج}}",
    "{{بند_الوزن}}",
    "{{بند_السعر}}",
    "{{بند_المجموع_الجزئي}}",
];

/// كلمة اختيارية لعمود الصناديق داخل صف البند — موصى بها فقط (راجع تعليق
/// `ROW_REQUIRED_KEYWORDS` أعلاه)، لكنها تُستبدَل فعلياً إن وُجدت.
const ROW_OPTIONAL_KEYWORD: &str = "{{بند_الصناديق}}";

/// مهمة 3 — كلمة مفتاحية جديدة: الترقيم التسلسلي لصفوف البنود (1، 2، 3، ...
/// بحسب ترتيب البنود في هذه الفاتورة تحديداً، يبدأ من 1 دائماً). خلافاً لكل
/// كلمات صف البند الأخرى، قيمتها **لا تأتي من `InvoicePrintInput`/الواجهة
/// إطلاقاً** — تُحسب داخلياً بحتاً من موضع البند في الحلقة (`i + 1`) وقت
/// التعبئة في `fill_template` مباشرة، لأنها لا تعتمد على أي بيانات فعلية
/// للبند نفسه، فقط على ترتيبه. يمكن للمستخدم وضعها في أي خلية من صف
/// {{بند}} (العمود الأول عادةً، لكن بلا أي قيد فعلي على الموضع — بنفس
/// معاملة بقية كلمات الصف). اختيارية بالكامل كبقية النظام (القرار المعماري
/// رقم 7): غيابها من القالب يعني فقط عدم ظهور عمود الترقيم، بلا أي أثر آخر.
const ROW_NUMBERING_KEYWORD: &str = "{{بند_الترقيم}}";

/// تجميع كل كلمات صف البند **الاختيارية** (بخلاف ROW_REQUIRED_KEYWORDS، وهي
/// أيضاً غير إلزامية فعلياً بعد القرار المعماري رقم 7، لكن تُعرَض في قسم
/// منفصل بالواجهة لتمييزها بصرياً — راجع مهمة 4 أدناه) — تُستخدَم فقط لبناء
/// تقرير الفحص التحذيري عند الرفع (`scan_keywords`)، لا في التوليد الفعلي
/// (`fill_template` تستبدلها مباشرة عبر ثوابتها المفردة أعلاه بصرف النظر عن
/// هذه القائمة). أي كلمة اختيارية جديدة لصف البند تُضاف مستقبلاً تُدرَج هنا
/// فقط لتظهر في تقرير الفحص — لا تغيير آخر مطلوب لتفعيلها في التقرير.
const ROW_OPTIONAL_KEYWORDS: [&str; 2] = [ROW_NUMBERING_KEYWORD, ROW_OPTIONAL_KEYWORD];

/// حالة كلمة مفتاحية واحدة ضمن نتيجة الفحص المُعادة للواجهة.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeywordStatus {
    pub keyword: String,
    pub found: bool,
}

/// نتيجة فحص الكلمات المفتاحية الكاملة، تُعاد للواجهة فور نجاح رفع قالب صالح.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateUploadResult {
    /// عدد خلايا {{بند}} الموجودة (مطابقة تامة) في الورقة الأولى فقط.
    /// 0 = لا توجد، 1 = الحالة الطبيعية، أكثر من 1 = غموض — لا يُوقِف
    /// الطباعة (راجع القرار المعماري رقم 7)، لكن يبقى يستحق تنبيه المستخدم
    /// هنا لأن الأعلى ترتيباً فقط هو من سيُستخدَم فعلياً.
    pub band_marker_count: usize,
    /// نتيجة فحص كلمات صف البند "الأساسية" (ROW_REQUIRED_KEYWORDS) — تُملأ
    /// فقط عندما band_marker_count == 1 (الحالة الوحيدة التي يوجد فيها صف
    /// واحد لا لبس فيه لفحصه)، وإلا تبقى قائمة فارغة. الاسم تاريخي فقط، لا
    /// يعني إلزاماً فعلياً — راجع تعليق ROW_REQUIRED_KEYWORDS.
    pub row_keywords: Vec<KeywordStatus>,
    /// مهمة 4 — نتيجة فحص كلمات صف البند **الاختيارية صراحة**
    /// (ROW_OPTIONAL_KEYWORDS: الترقيم والصناديق) — نفس شرط التعبئة أعلاه
    /// (band_marker_count == 1 فقط)، لكن في قائمة منفصلة كي تعرضها الواجهة
    /// بتنسيق محايد غير تحذيري (فهذه، خلافاً لسابقتها، لم تُصمَّم كـ"متوقَّعة
    /// عادةً" أصلاً — غيابها طبيعي تماماً في كثير من القوالب).
    pub row_optional_keywords: Vec<KeywordStatus>,
    /// نتيجة فحص الحقول أحادية القيمة، تُحسب دائماً بصرف النظر عن حالة
    /// {{بند}}.
    pub single_value_keywords: Vec<KeywordStatus>,
}

/// يحسب مسار ملف القالب الثابت داخل AppData (عبر path API القياسي لـ Tauri،
/// لا مسارات نصية يدوية — توافقاً مع AI_CONTEXT.md القسم 2). هذه الدالة
/// عامة (`pub`) عمداً لتُستخدَم لاحقاً من مهمة الطباعة عند قراءة نفس الملف
/// للتعبئة.
pub fn template_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("تعذّر تحديد مجلد بيانات التطبيق: {e}"))?;
    Ok(app_dir.join(TEMPLATE_SUBDIR).join(TEMPLATE_FILENAME))
}

/// يفحص الورقة الأولى فقط (index 0 — قرار ثابت يعتمد عليه مستقبلاً منطق
/// الطباعة بنفس الشكل تماماً، لا تُغيّره) من ملف مُحلَّل بالفعل، ويُرجع نتيجة
/// فحص الكلمات المفتاحية الكاملة.
fn scan_keywords(book: &umya_spreadsheet::Spreadsheet) -> Result<TemplateUploadResult, String> {
    let sheet0 = book
        .get_sheet(&0)
        .ok_or_else(|| "الملف لا يحتوي على أي ورقة عمل قابلة للقراءة".to_string())?;

    let cells = sheet0.get_cell_collection();

    // مطابقة {{بند}}: تامة بعد trim فقط — علامة تفعيل صف لا لبس فيها.
    let band_cells: Vec<_> = cells
        .iter()
        .filter(|c| c.get_value().trim() == ROW_MARKER)
        .collect();
    let band_marker_count = band_cells.len();

    let mut row_keywords = Vec::new();
    let mut row_optional_keywords = Vec::new();
    if band_marker_count == 1 {
        let band_row = *band_cells[0].get_coordinate().get_row_num();
        for kw in ROW_REQUIRED_KEYWORDS {
            let found = cells.iter().any(|c| {
                *c.get_coordinate().get_row_num() == band_row && c.get_value().contains(kw)
            });
            row_keywords.push(KeywordStatus {
                keyword: kw.to_string(),
                found,
            });
        }
        // مهمة 4: نفس الفحص بالضبط، لكن لقائمة الكلمات الاختيارية صراحة —
        // موضوعة في حقل منفصل بالنتيجة كي تُعرَض بتنسيق محايد لا تحذيري.
        for kw in ROW_OPTIONAL_KEYWORDS {
            let found = cells.iter().any(|c| {
                *c.get_coordinate().get_row_num() == band_row && c.get_value().contains(kw)
            });
            row_optional_keywords.push(KeywordStatus {
                keyword: kw.to_string(),
                found,
            });
        }
    }

    let mut single_value_keywords = Vec::new();
    for kw in SINGLE_VALUE_KEYWORDS {
        let found = cells.iter().any(|c| c.get_value().contains(kw));
        single_value_keywords.push(KeywordStatus {
            keyword: kw.to_string(),
            found,
        });
    }

    Ok(TemplateUploadResult {
        band_marker_count,
        row_keywords,
        row_optional_keywords,
        single_value_keywords,
    })
}

/// Rust command جديد (أول أمر مخصَّص في المشروع، مسجَّل في lib.rs). يستقبل
/// بايتات ملف xlsx خام كما قرأتها الواجهة عبر `file.arrayBuffer()`.
///
/// الترتيب الملزم:
/// 1) تحقق من الصلاحية الفعلية عبر umya-spreadsheet **قبل أي كتابة على
///    القرص** — ملف تالف أو من نوع خاطئ يُرفض كلياً برسالة واضحة، ولا يُستبدل
///    به أي قالب سابق موجود.
/// 2) احسب نتيجة فحص الكلمات المفتاحية (تحذيري فقط — لا يمنع الحفظ إطلاقاً
///    طالما الملف نفسه صالح تقنياً).
/// 3) لا يُكتب الملف على القرص إلا الآن، بعد أن ثبتت صلاحيته — فيستبدل أي
///    قالب سابق بالكامل، بنفس الاسم والمسار الثابتين.
///
/// لا تُكتب أي metadata لقاعدة البيانات هنا (راجع تعليق الوحدة أعلاه).
#[tauri::command]
pub fn upload_invoice_template(
    app: AppHandle,
    file_bytes: Vec<u8>,
) -> Result<TemplateUploadResult, String> {
    // 1) التحقق أولاً — بدون لمس القرص إطلاقاً في حال الفشل.
    let book = reader::xlsx::read_reader(Cursor::new(file_bytes.as_slice()), true)
        .map_err(|e| format!("الملف غير صالح أو تالف، تعذّر تحليله كملف Excel (xlsx): {e}"))?;

    // 2) فحص الكلمات المفتاحية (تحذيري فقط).
    let scan_result = scan_keywords(&book)?;

    // 3) الملف صالح فعلياً — الآن فقط نحفظه، فيستبدل القديم بالكامل.
    let dest = template_path(&app)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("تعذّر إنشاء مجلد القوالب داخل بيانات التطبيق: {e}"))?;
    }
    std::fs::write(&dest, &file_bytes)
        .map_err(|e| format!("تعذّر حفظ ملف القالب على القرص: {e}"))?;

    Ok(scan_result)
}

// ============================================================================
// مهمة 2/2 — طباعة فاتورة فعلية (تعبئة القالب المخزَّن + فتحه مباشرة).
//
// نطاق هذا القسم: قراءة نفس القالب المخزَّن (مسار `template_path` أعلاه،
// الورقة الأولى فقط)، تعبئته ببيانات فاتورة حقيقية أُرسلت جاهزة التنسيق من
// الواجهة (JS)، فرض مقاس A4 + تكرار صف رأس الجدول عبر إعدادات صفحة Excel
// نفسها (لا رسم يدوي)، حفظه كملف xlsx حقيقي، وإرجاع مساره للواجهة لتفتحه
// بتطبيق الجداول الافتراضي على الجهاز (Excel أو LibreOffice Calc) عبر
// tauri-plugin-opener — لا طباعة صامتة/برمجية إطلاقاً هنا، المستخدم يطبع
// يدوياً من داخل ذلك التطبيق.
//
// راجع الملاحظة المعمارية أعلى رأس هذا الملف لشرح سبب الانتقال لهذا المسار
// الأبسط بدل محرك رسم PDF مخصَّص. منطق التحقق/التعبئة أدناه (`fill_template`
// وما حولها) لم يتغيّر إطلاقاً عن ذلك التنفيذ السابق — مُتحقَّق منه فعلياً
// بتشغيل حقيقي (لا قراءة كود فقط) على قالب اصطناعي واقعي، بما في ذلك حالات
// حدّية بإدراج الصفوف والدمج، قبل تبسيط ما بعد التعبئة إلى هذا المسار.
// ============================================================================

// ----------------------------------------------------------------------
// نموذج البيانات الوارد من الواجهة (JS). كل قيمة هنا نص جاهز للطباعة
// حرفياً — منسَّق ومقرَّب (round2 وغيره) بالكامل من طرف JS/TS مسبقاً. هذه
// الوحدة "منفّذ تنسيق غبي" فقط، لا طبقة منطق أعمال — لا تُعِد حساب أو
// تقريب أي رقم هنا مهما بدا مغرياً.
// ----------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceLineItemInput {
    pub product: String,
    pub weight: String,
    pub price: String,
    pub subtotal: String,
    /// قد تكون فارغة إن لم يحتوِ القالب على عمود صناديق أصلاً — هذا سليم،
    /// الكلمة المفتاحية المقابلة اختيارية أصلاً (`ROW_OPTIONAL_KEYWORD`).
    #[serde(default)]
    pub boxes: String,
    // ملاحظة: كلمة الترقيم `ROW_NUMBERING_KEYWORD` ({{بند_الترقيم}}) عمداً
    // **لا** حقل لها هنا — خلافاً لـ`boxes`، قيمتها لا تصل أبداً من الواجهة؛
    // تُحسب داخلياً بالكامل في `fill_template` من موضع البند في الحلقة.
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoicePrintInput {
    pub invoice_number: String,
    pub invoice_date: String,
    pub merchant_name: String,
    pub merchant_phone: String,
    pub merchant_address: String,
    /// {{الاجمالي_الكلي}} — محسوب بدالة round2 نفسها المستخدمة في
    /// InvoiceShared.tsx، من طرف JS. لا تُعِد حسابه هنا.
    pub grand_total: String,
    /// {{الوزن_الكلي}} — مجموع الوزن عبر كل البنود، محسوب في JS.
    pub total_weight: String,
    /// {{عدد_الصناديق_الكلي}} — مجموع عدد الصناديق عبر كل الصناديق في كل
    /// البنود، محسوب في JS.
    pub total_boxes: String,
    pub items: Vec<InvoiceLineItemInput>,
}

// ----------------------------------------------------------------------
// أدوات إحداثيات وتحويل وحدات صغيرة.
// ----------------------------------------------------------------------

fn col_letter(mut n: u32) -> String {
    let mut s = Vec::new();
    while n > 0 {
        let rem = ((n - 1) % 26) as u8;
        s.push(b'A' + rem);
        n = (n - 1) / 26;
    }
    s.reverse();
    String::from_utf8(s).unwrap()
}
// ----------------------------------------------------------------------
// التعبئة وقت الطباعة.
//
// **القرار المعماري رقم 7 (مُحدَّث):** كل كلمة مفتاحية — الحالية (كل ما في
// SINGLE_VALUE_KEYWORDS و ROW_REQUIRED_KEYWORDS و ROW_OPTIONAL_KEYWORD)
// وحتى علامة تفعيل صف البند {{بند}} نفسها — **اختيارية بالكامل دائماً**،
// عمداً، بلا استثناء. لا توجد أي كلمة مفتاحية يمكن أن توقف توليد ملف
// الطباعة أو تُفشِله. غياب أي منها يعني فقط أن تلك القيمة/العمود لن يظهر في
// الناتج، لا أكثر:
//   - غياب {{بند}} بالكامل من القالب → لا يوجد صف يتكرر، فقط الحقول
//     أحادية القيمة الموجودة فعلاً تُملأ، ويُولَّد الملف بنجاح بلا أي جدول
//     بنود.
//   - وجود أكثر من خلية {{بند}} واحدة (غموض) → لا يُوقَف التوليد أيضاً؛
//     يُعتمَد أول صف بها (الأعلى ترتيباً) بلا نقاش، وبقية الخلايا المطابقة
//     تبقى كما هي حرفياً (لا تُعامَل كصف بند، ولا تُمسَح).
//   - غياب أي من كلمات صف البند (بند_المنتج/بند_الوزن/...) من صف {{بند}}
//     الفعلي → تلك القيمة تحديداً لا تظهر في أي خلية (لأنه لا توجد خلية
//     أصلاً تحتوي كلمتها المفتاحية لتُستبدَل)، وباقي الصف يُملأ طبيعياً.
// نتيجة فحص الرفع (`scan_keywords`) تبقى تحذيرية بحتة كما كانت — الغرض
// الوحيد لأي فحص كلمات مفتاحية في كامل هذا الملف (رفعاً أو طباعةً) هو
// إعلام مصمم القالب بما هو موجود/ناقص، لا فرض أي شيء إلزامي على الإطلاق.
// أي كلمة مفتاحية تُضاف مستقبلاً يجب أن تتبع نفس المبدأ: substitution إن
// وُجدت، تجاهل صامت إن غابت — لا فحص Err جديد يوقف `generate_invoice_file`.
// ----------------------------------------------------------------------

struct RowTemplateCell {
    col: u32,
    text: String,
    style: Style,
}

struct RowMergeSpan {
    start_col: u32,
    end_col: u32,
}

/// يبحث عن صف {{بند}} **بلا أي تحقق قاطع** — لا خطأ إطلاقاً مهما كانت
/// الحالة، اتساقاً مع كون كل الكلمات المفتاحية اختيارية دائماً (راجع تعليق
/// القرار المعماري رقم 7 أعلاه). `None` يعني ببساطة "لا يوجد جدول بنود
/// يُملأ في هذا القالب" — حالة صالحة تماماً، لا عطل.
///
/// عند وجود أكثر من خلية {{بند}} واحدة (غموض)، يُعتمَد **أعلى صف بها
/// ترتيباً** (الأصغر رقماً) دون تحذير أو رفض — قرار حتمي وبسيط بدل تعقيد
/// نقاش أي مطابقة "أصح" من الأخرى؛ الخلايا الأخرى المطابقة تبقى بنصها كما
/// هي حرفياً في الناتج النهائي (لا تُعامَل كصف بند، ولا تُمسَح).
fn find_band_row(sheet: &Worksheet) -> Option<u32> {
    let cells = sheet.get_cell_collection();
    let mut band_rows: Vec<u32> = cells
        .iter()
        .filter(|c| c.get_value().trim() == ROW_MARKER)
        .map(|c| *c.get_coordinate().get_row_num())
        .collect();
    band_rows.sort_unstable();
    band_rows.first().copied()
}

/// يحفظ نسخة من نص/نمط/دمج صف {{بند}} **قبل** أي تعديل — لازم لأن
/// `insert_new_row` (أدناه) يُزيح الصفوف الموجودة صحيحاً لكن لا يملأ
/// الصفوف الجديدة المُدرَجة بأي تنسيق تلقائياً (تأكَّدنا من هذا بفحص مصدر
/// umya-spreadsheet مباشرة، لا افتراضاً).
fn capture_row_template(sheet: &Worksheet, band_row: u32) -> (Vec<RowTemplateCell>, Vec<RowMergeSpan>) {
    let cells: Vec<RowTemplateCell> = sheet
        .get_collection_by_row(&band_row)
        .into_iter()
        .map(|c| RowTemplateCell {
            col: *c.get_coordinate().get_col_num(),
            text: c.get_value().to_string(),
            style: c.get_style().clone(),
        })
        .collect();

    let merges: Vec<RowMergeSpan> = sheet
        .get_merge_cells()
        .iter()
        .filter_map(|r| {
            let start_row = r.get_coordinate_start_row()?.get_num();
            if *start_row != band_row {
                return None;
            }
            let start_col = *r.get_coordinate_start_col()?.get_num();
            let end_col = *r.get_coordinate_end_col()?.get_num();
            Some(RowMergeSpan { start_col, end_col })
        })
        .collect();

    (cells, merges)
}

/// استبدال substring لكل كلمة مفتاحية داخل نص الخلية، مع الحفاظ على أي نص
/// ثابت آخر مجاور لها في نفس الخلية — قاعدة المطابقة المعتمدة من مهمة
/// الرفع، مطبَّقة هنا بنفس الشكل تماماً (لا قاعدة مختلفة مُخترَعة).
fn substitute(mut text: String, replacements: &[(&str, &str)]) -> String {
    for (kw, val) in replacements {
        if text.contains(kw) {
            text = text.replace(kw, val);
        }
    }
    text
}

/// يملأ القالب بالكامل: الحقول أحادية القيمة أولاً في الورقة كاملة (أينما
/// وُجدت، إن وُجدت)، ثم — فقط إن كان القالب يحتوي فعلياً على صف {{بند}}
/// (راجع `find_band_row`؛ غيابه ليس خطأً) — صف البند يُدرَج (N-1) مرة عبر
/// `insert_new_row` ويُملأ من نسخة الصف المحفوظة قبل أي تعديل. يُعدِّل
/// `sheet` في مكانه. تُعيد رقم صف البند المُستخدَم فعلياً إن وُجد (ليستخدمه
/// المستدعي لاحقاً في `apply_print_setup` لتكرار صف الرأس)، أو `None` إن لم
/// يوجد جدول بنود في هذا القالب أصلاً.
fn fill_template(sheet: &mut Worksheet, data: &InvoicePrintInput) -> Result<Option<u32>, String> {
    let single_value_replacements: Vec<(&str, &str)> = vec![
        ("{{رقم_الفاتورة}}", data.invoice_number.as_str()),
        ("{{تاريخ_الفاتورة}}", data.invoice_date.as_str()),
        ("{{اسم_التاجر}}", data.merchant_name.as_str()),
        ("{{هاتف_التاجر}}", data.merchant_phone.as_str()),
        ("{{عنوان_التاجر}}", data.merchant_address.as_str()),
        ("{{الاجمالي_الكلي}}", data.grand_total.as_str()),
        ("{{الوزن_الكلي}}", data.total_weight.as_str()),
        ("{{عدد_الصناديق_الكلي}}", data.total_boxes.as_str()),
    ];
    for cell in sheet.get_cell_collection_mut() {
        let original = cell.get_value().to_string();
        if single_value_replacements.iter().any(|(kw, _)| original.contains(kw)) {
            let replaced = substitute(original, &single_value_replacements);
            // set_value_string عمداً، لا set_value: الأخيرة تُخمِّن نوع القيمة
            // تلقائياً (umya_spreadsheet::CellValue::guess_typed_data) وتحوّل
            // أي نص يُفسَّر بنجاح كـf64 إلى خلية رقمية فعلية — يحذف بصمت أي
          // صفر بادئ (رقم هاتف "0555..." يصبح "555...")، وقد يُغيّر كيفية
            // عرض Excel لقيم كتاريخ/رقم فاتورة صرفة الأرقام. ثغرة حقيقية
            // مؤكَّدة باختبار مباشر فشل قبل هذا الإصلاح، لا افتراضاً نظرياً.
            cell.get_cell_value_mut().set_value_string(replaced);
        }
    }

    // شرط عمل حقيقي عن بيانات الفاتورة نفسها، لا عن كلمات القالب المفتاحية
    // (تلك جميعها اختيارية دائماً، راجع القرار المعماري رقم 7) — فاتورة
    // بلا أي بند لا معنى لطباعتها أياً كان القالب. يبقى هذا الفحص كما هو،
    // ولا علاقة له بمهمة "جعل كل كلمة مفتاحية اختيارية".
    let n = data.items.len() as u32;
    if n == 0 {
        return Err("لا توجد بنود لهذه الفاتورة — لا يمكن توليد ملف الطباعة بدون بنود.".to_string());
    }

    // صف {{بند}} اختياري بالكامل — إن لم يوجد في القالب، لا يوجد جدول بنود
    // لملئه، وينتهي التوليد هنا بنجاح بالحقول أحادية القيمة فقط (Ok(None)).
    let Some(band_row) = find_band_row(sheet) else {
        return Ok(None);
    };

    let (row_template, row_merges) = capture_row_template(sheet, band_row);

    if n > 1 {
        sheet.insert_new_row(&(band_row + 1), &(n - 1));
    }

    for (i, item) in data.items.iter().enumerate() {
        let target_row = band_row + i as u32;
        // ترقيم تسلسلي محسوب داخلياً من موضع البند في هذه الحلقة تحديداً —
        // يبدأ من 1 دائماً (i يبدأ من 0)، لا علاقة له ببيانات item نفسها،
        // ولا يأتي من الواجهة (راجع تعليق ROW_NUMBERING_KEYWORD أعلاه).
        let row_number = (i + 1).to_string();

        // كل كلمة هنا اختيارية أيضاً: substitute() لا تفعل شيئاً لأي كلمة
        // غير موجودة أصلاً في نص الخلية — عمود بلا كلمته المفتاحية في
        // القالب يبقى فارغاً/كما هو، لا خطأ ولا توقف (راجع القرار المعماري
        // رقم 7).
        let item_replacements: Vec<(&str, &str)> = vec![
            (ROW_NUMBERING_KEYWORD, row_number.as_str()),
            ("{{بند_المنتج}}", item.product.as_str()),
            ("{{بند_الوزن}}", item.weight.as_str()),
            ("{{بند_السعر}}", item.price.as_str()),
            ("{{بند_المجموع_الجزئي}}", item.subtotal.as_str()),
            (ROW_OPTIONAL_KEYWORD, item.boxes.as_str()),
        ];

        for tmpl_cell in &row_template {
            let is_marker = tmpl_cell.text.trim() == ROW_MARKER;
            let new_text = if is_marker {
                // علامة {{بند}} علامة تفعيل بحتة، ليست كلمة مفتاحية تُعرَض —
                // تُمسَح كي لا تظهر حرفياً بفاتورة حقيقية تُسلَّم لعميل (لم
                // يرد نص صريح بالتوثيق حول هذه النقطة تحديداً، لكن ترك
                // "{{بند}}" ظاهراً بكل صف بند خطأ واضح لا يحتمل نقاشاً).
                String::new()
            } else {
                substitute(tmpl_cell.text.clone(), &item_replacements)
            };

            if target_row != band_row {
                sheet.set_style((tmpl_cell.col, target_row), tmpl_cell.style.clone());
            }
            sheet
                .get_cell_mut((tmpl_cell.col, target_row))
                // set_value_string لنفس السبب أعلاه — راجع تعليق التعبئة
                // أحادية القيمة قليلاً فوق هذا الموضع.
                .set_value_string(new_text);
        }

        if target_row != band_row {
            for m in &row_merges {
                let range = format!(
                    "{}{}:{}{}",
                    col_letter(m.start_col),
                    target_row,
                    col_letter(m.end_col),
                    target_row
                );
                sheet.add_merge_cells(range);
            }
        }
    }

    Ok(Some(band_row))
}

// ----------------------------------------------------------------------
// إعداد صفحة Excel نفسها: مقاس A4 + اتجاه عمودي (القرار المعماري رقم 1 —
// نفس الإلزام السابق، محقَّق الآن عبر إعدادات الطباعة الأصلية في xlsx بدل
// رسم يدوي)، وتكرار صف رأس الجدول أعلى كل صفحة مطبوعة عبر Print Titles —
// آلية Excel الأصلية لهذا الغرض بالضبط، بدل صيغة تقسيم صفحات مخصَّصة.
// ----------------------------------------------------------------------

/// كود مقاس الورق A4 بمعيار OOXML (`ST_PaperSize`) — ثابت مستقر منذ صيغة
/// Excel الثنائية القديمة، لا علاقة له بإصدار umya-spreadsheet.
const OOXML_PAPER_SIZE_A4: u32 = 9;
const PRINT_TITLES_NAME: &str = "_xlnm.Print_Titles";

/// يفرض A4 + عمودي دائماً (لا خيار للقالب هنا — قرار معماري ملزم، ولا علاقة
/// له بمنظومة الكلمات المفتاحية أصلاً)، ويضبط تكرار صف رأس الجدول (الصف
/// *مباشرة فوق* {{بند}} — نفس الافتراض الموثَّق بالتنفيذ السابق، لا كلمة
/// مفتاحية تحدده صراحة) على كل صفحة مطبوعة، **فقط إن لم يكن المستخدم قد
/// ضبط Print Titles بنفسه مسبقاً بالقالب** — نحترم اختياره الصريح إن وُجد
/// بدل الكتابة فوقه. `band_row` اختياري الآن (`None` إن لم يحتوِ القالب على
/// صف {{بند}} أصلاً — راجع `find_band_row`/`fill_template`): في هذه الحالة
/// نكتفي بفرض A4+عمودي ونتخطى إعداد تكرار الرأس بهدوء، إذ لا يوجد جدول
/// بنود يتكرر أصلاً ليُفيده.
fn apply_print_setup(sheet: &mut Worksheet, band_row: Option<u32>) {
    sheet
        .get_page_setup_mut()
        .set_paper_size(OOXML_PAPER_SIZE_A4)
        .set_orientation(OrientationValues::Portrait);

    let Some(band_row) = band_row else {
        return;
    };

    let already_set = sheet
        .get_defined_names()
        .iter()
        .any(|d| d.get_name() == PRINT_TITLES_NAME);
    if already_set {
        return;
    }

    if band_row >= 2 {
        let header_row = band_row - 1;
        let sheet_name = sheet.get_name().to_string();
        let address = format!("'{sheet_name}'!${header_row}:${header_row}");

        // ملاحظة مصحَّحة بالاختبار الفعلي (لا افتراضاً): استدعاء
        // add_defined_name(name, address) وحده لا يكفي — Excel/LibreOffice
        // لا يعتبران _xlnm.Print_Titles مرتبطاً بهذه الورقة تحديداً بدون
        // localSheetId صراحة (معيار OOXML يتطلبه للأسماء المحجوزة كي تُقرأ
        // كنطاق محلي للورقة، لا عام بالمصنَّف). DefinedName::set_name نفسها
        // `pub(crate)` (غير متاحة من خارج الحزمة)، فلا يمكن بناء الكائن
        // يدوياً هنا — لذا نضيفه بالدالة المختصرة العامة أولاً، ثم نضبط
        // localSheetId على المرجع القابل للتعديل من قائمة الورقة. الورقة
        // الأولى دائماً index 0 (نفس قيد "الورقة الأولى فقط" المعتمد بكل
        // هذا الملف)، فـ0 صحيحة دوماً هنا.
        if sheet.add_defined_name(PRINT_TITLES_NAME, &address).is_ok() {
            if let Some(added) = sheet
                .get_defined_names_mut()
                .iter_mut()
                .find(|d| d.get_name() == PRINT_TITLES_NAME)
            {
                added.set_local_sheet_id(0);
            }
        }
    }
}

// ----------------------------------------------------------------------
// **إصلاح ثغرة حقيقية اكتُشفت بالاختبار المباشر لملف الناتج الفعلي، لا
// بالمراجعة النظرية للكود** — وتنطبق على أي تنفيذ يمرّ بدورة قراءة/تعديل/
// كتابة عبر umya-spreadsheet لهذا الغرض تحديداً، لا على هذا الملف فقط:
//
// umya-spreadsheet's `SheetView` (`src/structs/sheet_view.rs`) لا يملك حقل
// `rightToLeft` إطلاقاً بنموذج بياناته الداخلي (نفس ما وثّقناه سابقاً بخصوص
// عدم توفّر *قراءته* من الواجهة العليا) — لكن الأثر الأخطر لم يكن واضحاً
// إلا بفحص ملف xlsx الناتج الفعلي بايتاً ببايت: بما أن الحقل غير موجود في
// النموذج الداخلي، فإن umya-spreadsheet **يُسقطه بصمت عند إعادة الكتابة**،
// حتى لو كان القالب الأصلي المقروء يحتوي عليه صراحة! أي قالب فاتورة حقيقي
// صُمِّم بعرض Excel "من اليمين لليسار" (الحالة الطبيعية لقالب عربي) يفقد
// هذه الخاصية بالكامل في *كل* ملف فاتورة يُولَّد من التطبيق — يفتح Excel أو
// LibreOffice Calc الناتج بترتيب أعمدة معكوس (من اليسار لليمين) مقارنةً بما
// صمَّمه المستخدم ورآه فعلياً في Excel، رغم صحة كل شيء آخر بالملف.
//
// **الحل:** قراءة بايتات القالب *الأصلية* (قبل أي معالجة عبر umya-spreadsheet)
// مباشرة كأرشيف zip خام واستخراج `rightToLeft` من `<sheetView>` الحقيقي بها
// بأنفسنا (تجاوز محدود ومحدَّد الغرض لواجهة umya-spreadsheet العليا لخاصية
// واحدة فقط تنقصها تماماً، لا إعادة تنفيذ لقراءة xlsx عموماً) — ثم، **بعد**
// أن يكتب umya-spreadsheet ملف الفاتورة النهائي، إن كان القالب الأصلي RTL:
// نفتح ذلك الملف الناتج بدورنا كأرشيف zip خام ونحقن `rightToLeft="1"` داخل
// وسم `<sheetView>` الخاص به مباشرة، متجاوزين umya-spreadsheet للحظة أخيرة
// فقط. هذا يضمن نجاة الخاصية عبر دورة القراءة/التعديل/الكتابة الكاملة رغم
// أن المكتبة نفسها لا تدعمها إطلاقاً في أي من طرفَي هذه الدورة.
// ----------------------------------------------------------------------

fn find_attr<'a>(tag: &'a str, attr: &str) -> Option<&'a str> {
    let needle = format!("{attr}=\"");
    let start = tag.find(&needle)? + needle.len();
    let end = tag[start..].find('"')? + start;
    Some(&tag[start..end])
}

fn read_zip_entry_to_string<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Option<String> {
    let mut file = archive.by_name(name).ok()?;
    let mut s = String::new();
    file.read_to_string(&mut s).ok()?;
    Some(s)
}

/// يحدد الملف الفعلي داخل الأرشيف المطابق لورقة العمل رقم `sheet_index`
/// (0-based)، عبر تتبّع workbook.xml -> workbook.xml.rels -> اسم الملف
/// الحقيقي — لا نفترض "sheet1.xml" مباشرة (قد لا يطابق الترتيب الفعلي دوماً
/// نظرياً، رغم أنه الحالة الشائعة).
fn resolve_sheet_xml_path<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    sheet_index: usize,
) -> Option<String> {
    let workbook_xml = read_zip_entry_to_string(archive, "xl/workbook.xml")?;
    let mut search_from = 0usize;
    let mut r_id = None;
    for i in 0..=sheet_index {
        let tag_start = workbook_xml[search_from..].find("<sheet ")? + search_from;
        let tag_end = workbook_xml[tag_start..].find("/>")? + tag_start;
        let tag = &workbook_xml[tag_start..tag_end];
        if i == sheet_index {
            r_id = find_attr(tag, "r:id").map(|s| s.to_string());
        }
        search_from = tag_end + 2;
    }
    let r_id = r_id?;

    let rels_xml = read_zip_entry_to_string(archive, "xl/_rels/workbook.xml.rels")?;
    let mut search_from = 0usize;
    loop {
        let rel_start = rels_xml[search_from..].find("<Relationship ")? + search_from;
        let rel_end = rels_xml[rel_start..].find("/>").map(|e| e + rel_start)?;
        let tag = &rels_xml[rel_start..rel_end];
        if find_attr(tag, "Id") == Some(r_id.as_str()) {
            let target = find_attr(tag, "Target")?;
            return Some(if target.starts_with("worksheets/") {
                format!("xl/{target}")
            } else {
                format!("xl/{}", target.trim_start_matches("/xl/"))
            });
        }
        search_from = rel_end + 2;
    }
}

/// يقرأ خاصية `rightToLeft` من `<sheetView>` الحقيقية داخل `xlsx_bytes` —
/// راجع الشرح أعلى هذا القسم لسبب عدم إمكانية الاعتماد على umya-spreadsheet
/// لهذا الغرض إطلاقاً. `false` عند أي فشل بالقراءة (ملف غير متوقَّع الشكل
/// مثلاً) — سلوك آمن افتراضي، لا تخمين ولا انهيار.
/// يجد بداية وسم `<sheetView` **المفرد** تحديداً (لا `<sheetViews>` الحاوي
/// له، الذي يبدأ بنفس السلسلة النصية حرفياً فيطابقها بحث بسيط خطأً) — يتحقق
/// أن الحرف التالي مباشرة ليس حرفاً/رقماً (أي فعلاً حد نهاية الوسم: مسافة،
/// `/`، أو `>`)، لا يفترض مسافة ثابتة (بعض الأوراق تكتب `<sheetView/>` بلا
/// أي خاصية إطلاقاً إن لم تكن الورقة بحاجة لأي إعداد عرض مخصَّص).
fn find_singular_sheet_view_tag_start(xml: &str) -> Option<usize> {
    let mut search_from = 0usize;
    loop {
        let idx = xml[search_from..].find("<sheetView")? + search_from;
        let after = idx + "<sheetView".len();
        match xml.as_bytes().get(after) {
            Some(b' ') | Some(b'/') | Some(b'>') => return Some(idx),
            _ => search_from = after,
        }
    }
}

fn detect_sheet_rtl(xlsx_bytes: &[u8]) -> bool {
    (|| -> Option<bool> {
        let cursor = Cursor::new(xlsx_bytes);
        let mut archive = zip::ZipArchive::new(cursor).ok()?;
        let sheet_path = resolve_sheet_xml_path(&mut archive, 0)?;
        let sheet_xml = read_zip_entry_to_string(&mut archive, &sheet_path)?;
        let sv_start = find_singular_sheet_view_tag_start(&sheet_xml)?;
        let sv_end = sheet_xml[sv_start..].find('>').map(|e| e + sv_start)?;
        let tag = &sheet_xml[sv_start..sv_end];
        Some(find_attr(tag, "rightToLeft") == Some("1") || find_attr(tag, "rightToLeft") == Some("true"))
    })()
    .unwrap_or(false)
}

/// يحقن `rightToLeft="1"` داخل `<sheetView>` لملف xlsx **مكتوب بالفعل على
/// القرص** في `path` — يُستدعى بعد `writer::xlsx::write` مباشرة، فقط عندما
/// أثبت `detect_sheet_rtl` أن القالب الأصلي كان RTL. فشل هذه الخطوة (ملف
/// بشكل غير متوقَّع مثلاً) لا يجب أن يُسقِط عملية التوليد بأكملها — الملف
/// الأساسي الصحيح المحتوى موجود بالفعل على القرص، مجرد فقدان تفضيل عرض
/// واحد أفضل من فشل التوليد كلياً؛ نسجّل الفشل صامتاً هنا عمداً.
fn apply_rtl_view_to_output(path: &std::path::Path) {
    let Ok(bytes) = std::fs::read(path) else {
        return;
    };
    let cursor = Cursor::new(bytes);
    let Ok(mut archive) = zip::ZipArchive::new(cursor) else {
        return;
    };
    let Some(sheet_path) = resolve_sheet_xml_path(&mut archive, 0) else {
        return;
    };

    let mut entries: Vec<(String, Vec<u8>, zip::CompressionMethod)> = Vec::new();
    for i in 0..archive.len() {
        let Ok(mut f) = archive.by_index(i) else { continue };
        let name = f.name().to_string();
        let compression = f.compression();
        let mut buf = Vec::new();
        if f.read_to_end(&mut buf).is_err() {
            continue;
        }
        if name == sheet_path {
            if let Ok(mut s) = String::from_utf8(buf.clone()) {
                if let Some(sv_start) = find_singular_sheet_view_tag_start(&s) {
                    let tag_prefix_end = sv_start + "<sheetView".len();
                    if !s[tag_prefix_end..].trim_start().starts_with("rightToLeft") {
                        // بعد "<sheetView" مباشرة، بصرف النظر عمّا يليها (مسافة
                        // ثم خصائص، أو `/` أو `>` لوسم بلا أي خاصية إطلاقاً).
                        let next_char = s.as_bytes().get(tag_prefix_end).copied();
                        let insertion = if next_char == Some(b' ') {
                            " rightToLeft=\"1\"".to_string()
                        } else {
                            // `<sheetView/>` أو `<sheetView>` بلا مسافة قبل
                            // أي شيء — نضيف مسافة نحن أنفسنا كي يبقى XML صالحاً.
                            " rightToLeft=\"1\" ".to_string()
                        };
                        s.insert_str(tag_prefix_end, &insertion);
                        buf = s.into_bytes();
                    }
                }
            }
        }
        entries.push((name, buf, compression));
    }

    let Ok(out_file) = std::fs::File::create(path) else {
        return;
    };
    let mut writer = zip::ZipWriter::new(out_file);
    for (name, buf, compression) in entries {
        let options: zip::write::FileOptions<'_, ()> =
            zip::write::FileOptions::default().compression_method(compression);
        if writer.start_file(name, options).is_err() {
            return;
        }
        if writer.write_all(&buf).is_err() {
            return;
        }
    }
    let _ = writer.finish();
}

// ----------------------------------------------------------------------
// مجلد التوليد + سياسة التنظيف (القرار المعماري رقم 5) — بلا تغيير عن
// التنفيذ السابق، فقط لملفات xlsx بدل PDF الآن.
// ----------------------------------------------------------------------

fn generated_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("تعذّر تحديد مجلد بيانات التطبيق: {e}"))?;
    Ok(app_dir.join("generated"))
}

fn cleanup_generated_dir(dir: &std::path::Path) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir).map_err(|e| format!("تعذّر قراءة مجلد ملفات الطباعة: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            // فشل حذف ملف واحد (قد يكون مفتوحاً حالياً بـExcel/LibreOffice
            // Calc مثلاً) لا يجب أن يُسقِط عملية الطباعة بالكامل.
            let _ = std::fs::remove_file(&path);
        }
    }
    Ok(())
}

// ----------------------------------------------------------------------
// أمر Tauri الرئيسي لهذه المهمة.
// ----------------------------------------------------------------------

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GenerateInvoiceFileResult {
    /// المسار الكامل لملف xlsx المولَّد — الواجهة (JS) هي من تفتحه عبر
    /// `tauri-plugin-opener` (`openPath`)، لا هذا الكود. يُفتَح بتطبيق
    /// الجداول الافتراضي على جهاز المستخدم (Excel أو LibreOffice Calc)،
    /// والمستخدم يطبع يدوياً من هناك بمحرك عرض حقيقي — لا رسم مخصَّص، لا
    /// طباعة صامتة/برمجية.
    pub path: String,
}

/// يقرأ القالب المخزَّن، يتحقق منه وقت الطباعة تحديداً (القرار المعماري
/// رقم 7)، يملؤه ببيانات `data` (المُجمَّعة والمنسَّقة بالكامل من طرف JS
/// مسبقاً — راجع تعليق `InvoicePrintInput` أعلاه)، يفرض A4 + تكرار صف
/// الرأس، يحفظه كملف xlsx داخل مجلد التوليد بـAppData (بعد تطبيق سياسة
/// التنظيف)، ويُعيد مساره للواجهة.
#[tauri::command]
pub fn generate_invoice_file(app: AppHandle, data: InvoicePrintInput) -> Result<GenerateInvoiceFileResult, String> {
    let template_file = template_path(&app)?;
    if !template_file.exists() {
        return Err(
            "لم يتم رفع أي قالب فاتورة بعد — الرجاء رفع قالب من صفحة الإعدادات أولاً قبل الطباعة."
                .to_string(),
        );
    }
    let template_bytes = std::fs::read(&template_file)
        .map_err(|e| format!("تعذّر قراءة ملف القالب المخزَّن: {e}"))?;

    // يجب استخراج هذا **من البايتات الخام الأصلية مباشرة**، قبل أي معالجة
    // عبر umya-spreadsheet — راجع الشرح المفصَّل أعلى `detect_sheet_rtl` عن
    // سبب فقدان هذه الخاصية بصمت لو اعتمدنا على المكتبة نفسها لحفظها.
    let is_rtl_sheet = detect_sheet_rtl(&template_bytes);

    let mut book = reader::xlsx::read_reader(Cursor::new(template_bytes.as_slice()), true)
        .map_err(|e| format!("تعذّر تحليل القالب المخزَّن كملف Excel صالح: {e}"))?;
    let sheet = book
        .get_sheet_mut(&0)
        .ok_or_else(|| "القالب المخزَّن لا يحتوي على أي ورقة عمل قابلة للقراءة".to_string())?;

    // fill_template لا تخفق أبداً بسبب كلمة مفتاحية ناقصة (راجع القرار
    // المعماري رقم 7) — الخطأ الوحيد الممكن منها الآن هو فاتورة بلا بنود
    // إطلاقاً (شرط بيانات، لا شرط قالب). تُعيد رقم صف {{بند}} إن وُجد
    // فعلياً في القالب، لنستخدمه في apply_print_setup أدناه.
    let band_row = fill_template(sheet, &data)?;
    apply_print_setup(sheet, band_row);

    let out_dir = generated_dir(&app)?;
    cleanup_generated_dir(&out_dir)?;

    let safe_number: String = data
        .invoice_number
        .chars()
        .filter(|c| !"\\/:*?\"<>|".contains(*c))
        .collect();
    let file_name = if safe_number.trim().is_empty() {
        "فاتورة.xlsx".to_string()
    } else {
        format!("{safe_number}.xlsx")
    };
    let out_path = out_dir.join(file_name);

    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("تعذّر إنشاء مجلد ملفات الطباعة: {e}"))?;
    }
    writer::xlsx::write(&book, &out_path)
        .map_err(|e| format!("تعذّر كتابة ملف الفاتورة النهائي على القرص: {e}"))?;

    if is_rtl_sheet {
        apply_rtl_view_to_output(&out_path);
    }

    Ok(GenerateInvoiceFileResult {
        path: out_path.to_string_lossy().to_string(),
    })
}