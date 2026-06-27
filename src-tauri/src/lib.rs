use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use std::fs;

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

                -- فهارس (Indexes) لضمان سرعة البحث الفورية
                CREATE INDEX IF NOT EXISTS idx_invoices_merchant ON invoices(merchant_id);
                CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
                CREATE INDEX IF NOT EXISTS idx_details_invoice ON invoice_details(invoice_id);
            ",
            kind: MigrationKind::Up,
        }
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:mks.db", migrations)
                .build(),
        )
        .setup(|app| {
            // 🚀 فقط نتأكد من أن مجلد التطبيق موجود ليتم إنشاء قاعدة البيانات بداخله بنجاح
            if let Ok(app_dir) = app.handle().path().app_data_dir() {
                if !app_dir.exists() {
                    let _ = fs::create_dir_all(&app_dir);
                }
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}