use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use std::fs;

// مهمة 1/2 من ميزة طباعة الفاتورة: أول وحدة Rust command مخصصة في المشروع.
// راجع تعليق رأس الملف نفسه (invoice_template.rs) لتفاصيل النطاق والقرارات.
mod invoice_template;
// ميزة تفعيل الجهاز (راجع AI_CONTEXT.md القسم 9 وتعليق رأس activation.rs).
mod activation;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // تم تحديث الهيكل مباشرة في الـ Version 1 لقطع الترابط نهائياً
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_mks_final_schema",
            sql: "
                -- جدول إعدادات صاحب التطبيق (بياناتك الثابتة)
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );

                -- حشو البيانات الافتراضية لصاحب التطبيق
                INSERT OR IGNORE INTO settings (key, value) VALUES 
                ('owner_name', 'اسم صاحب المؤسسة'),
                ('owner_phone', '0600000000'),
                ('owner_address', 'العنوان، بسكرة');

                -- جدول التجار
                CREATE TABLE IF NOT EXISTS merchants (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    address TEXT,
                    phone TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                -- جدول المنتجات (يعمل كقاعدة للاقتراحات المكتوبة فقط Auto-suggest)
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE
                );

                -- جدول الصناديق
                CREATE TABLE IF NOT EXISTS boxes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    weight REAL NOT NULL,
                    is_visible INTEGER DEFAULT 1
                );

                -- جدول الفواتير
                CREATE TABLE IF NOT EXISTS invoices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    merchant_id INTEGER NOT NULL,
                    invoice_date DATETIME NOT NULL,
                    total_amount REAL DEFAULT 0.0,
                    is_open INTEGER NOT NULL DEFAULT 0,
                    number_year INTEGER,
                    number_month INTEGER,
                    number_merchant_id INTEGER,
                    number_counter INTEGER,
                    invoice_number TEXT,
                    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
                );

                -- جدول تفاصيل الفاتورة (تم تغيير product_id إلى product_name ليكون نصاً حراً)
                CREATE TABLE IF NOT EXISTS invoice_details (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    invoice_id INTEGER NOT NULL,
                    product_name TEXT NOT NULL, -- ✨ نص حر مباشر ولا يعتمد على مفتاح أجنبي
                    quantity REAL NOT NULL,
                    price REAL NOT NULL,
                    subtotal REAL NOT NULL,
                    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
                );

                -- جدول تفاصيل صناديق السطر
                CREATE TABLE IF NOT EXISTS invoice_detail_boxes (
                    invoice_detail_id INTEGER NOT NULL,
                    box_id INTEGER NOT NULL,
                    box_count INTEGER NOT NULL,
                    PRIMARY KEY (invoice_detail_id, box_id),
                    FOREIGN KEY (invoice_detail_id) REFERENCES invoice_details(id) ON DELETE CASCADE,
                    FOREIGN KEY (box_id) REFERENCES boxes(id)
                );

                -- الأجهزة الموثوقة بالتشغيل. معرّف الجهاز نفسه يُخزَّن كسطر
                -- device_id في جدول settings.
                CREATE TABLE IF NOT EXISTS trusted_devices (
                    device_id TEXT PRIMARY KEY,
                    activated_at TEXT NOT NULL
                );

                -- فهارس (Indexes) لضمان سرعة البحث الفورية
                CREATE INDEX IF NOT EXISTS idx_invoices_merchant ON invoices(merchant_id);
                CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
                CREATE INDEX IF NOT EXISTS idx_details_invoice ON invoice_details(invoice_id);
                CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_numbering
                    ON invoices(number_merchant_id, number_year, number_month, number_counter);
                CREATE INDEX IF NOT EXISTS idx_invoices_is_open ON invoices(is_open);
                CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
            ",
            kind: MigrationKind::Up,
        },
    ];

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // حماية من تعدد نسخ التطبيق تصل لنفس ملف قاعدة البيانات المحلي في آن واحد.
    // يجب أن يكون أول plugin مسجَّل في السلسلة (متطلَّب موثَّق رسمياً من Tauri
    // حتى يعترض محاولة فتح نسخة ثانية بشكل صحيح). الـ crate نفسه غير مدعوم على
    // Android/iOS (نفس منطق #[cfg_attr(mobile, ...)] المستخدَم أصلاً في main.rs)،
    // لذا يُسجَّل هنا فقط على سطح المكتب — وهو هدف النشر الفعلي الوحيد لهذا
    // التطبيق أصلاً (راجع AI_CONTEXT.md القسم 2).
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:mks.db", migrations)
                .build(),
        )
        // مهمة 2/2 من ميزة طباعة الفاتورة: يفتح ملف xlsx المولَّد بتطبيق
        // الجداول الافتراضي (Excel/LibreOffice Calc) من طرف الواجهة (JS) —
        // راجع القرار المعماري رقم 2 و4 في توثيق المهمة (ممنوع أي أمر طباعة
        // صامت/برمجي، الفتح فقط؛ المستخدم يطبع يدوياً من داخل ذلك التطبيق).
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            invoice_template::upload_invoice_template,
            invoice_template::generate_invoice_file,
            activation::verify_activation_code
        ])
        .setup(|app| {
            // 🚀 فقط نتأكد من أن مجلد التطبيق موجود ليتم إنشاء قاعدة البيانات بداخله بنجاح
            if let Ok(app_dir) = app.handle().path().app_data_dir() {
                if !app_dir.exists() {
                    let _ = fs::create_dir_all(&app_dir);
                }
            }

            // تسجيل الأحداث (Logging) — شغّال دائماً (تطوير ونسخة نهائية على
            // حد سواء)، حتى نقدر نرى سبب أي مشكلة تصير عند الزبون لاحقاً.
            // LogDir يكتب ملف فعلي دائم على القرص، Stdout مفيد فقط أثناء
            // `tauri dev` من الطرفية.
            // تدوير الملف: عند وصوله 5 ميجابايت يُعاد تسميته كنسخة قديمة واحدة
            // ويبدأ ملف جديد فارغ (RotationStrategy::KeepOne يحذف أي نسخة أقدم
            // من تلك الواحدة تلقائياً) — الحد الأقصى للمساحة المستخدَمة يبقى
            // ثابتاً عند نحو 10 ميجابايت (ملفين كحد أقصى) مهما مرّت السنين،
            // بدل تراكم بلا نهاية.
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .max_file_size(5 * 1024 * 1024)
                    .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::LogDir {
                            file_name: Some("mks".to_string()),
                        },
                    ))
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Stdout,
                    ))
                    .build(),
            )?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}