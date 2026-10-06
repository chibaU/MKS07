// ============================================================================
// ميزة مزامنة الهاتف — طبقة Tauri الرقيقة (راجع AI_CONTEXT.md القسم 10).
//
// الفكرة في سطرين: هاتف على نفس الشبكة المحلية يفتح تطبيق ويب (PWA) يقدّمه هذا
// التطبيق عبر HTTPS محلي، يحصل على التجار والصناديق، ثم يعمل Offline وينشئ فواتير
// جديدة، ويرسلها لاحقاً دفعة واحدة لتنتظر مراجعة المستخدم هنا قبل دخول SQLite.
//
// **العزل هو الهدف الأول** — ما يضمنه هذا الملف:
//  1. لا شيء يعمل عند إقلاع التطبيق: المحرّك يُنشأ كسولاً عند أول أمر من صفحة
//     "مزامنة الهاتف"، والخادم لا يبدأ إلا بضغطة المستخدم على "تشغيل الخدمة".
//  2. الخادم يعمل في tokio runtime خاص به (خيطان) منفصل عن runtime الخاص بـ Tauri؛
//     أي خلل/توقف فيه لا يجمّد أوامر Tauri الأخرى ولا الواجهة.
//  3. كل الأوامر async وتنفّذ عملها الثقيل في spawn_blocking: لا شيء على الخيط
//     الرئيسي، وأي panic يتحوّل إلى رسالة خطأ بدل إسقاط التطبيق.
//  4. لا يلمس هذا الكود SQLite إطلاقاً. قاعدة MKS يملكها JS (db.ts)؛ الكتالوج
//     يُطلَب من الواجهة عبر حدث، والاعتماد النهائي للفاتورة تنفّذه الواجهة بخدمات
//     db.ts الحالية. هنا فقط: خادم + شهادات + مخزن الفواتير المعلّقة (ملفات JSON
//     مستقلة في AppData/phone_sync/).
//  5. لا يوجد في بقية التطبيق أي اعتماد على هذه الوحدة سوى تسجيل الأوامر في lib.rs.
// ============================================================================

pub mod engine;

use engine::bridge::{BridgeEvent, CatalogReply};
use engine::store::{LedgerEntry, Record};
use engine::{Engine, Status};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

type Slot = Arc<Mutex<Option<Arc<Engine>>>>;

/// الحالة المُدارة من Tauri. فارغة حتى أول أمر (لا قراءة قرص ولا توليد مفاتيح عند الإقلاع).
pub struct PhoneSyncState {
    slot: Slot,
}

impl PhoneSyncState {
    pub fn new() -> Self {
        PhoneSyncState { slot: Arc::new(Mutex::new(None)) }
    }
}

fn get_or_create(app: &AppHandle, slot: &Slot) -> Result<Arc<Engine>, String> {
    let mut guard = slot.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(e) = &*guard {
        return Ok(e.clone());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("تعذّر تحديد مجلد بيانات التطبيق: {e}"))?
        .join("phone_sync");
    let engine = Arc::new(Engine::new(dir)?);
    if let Some(mut rx) = engine.take_events_rx() {
        let app = app.clone();
        // تمرير أحداث المحرّك إلى الواجهة. المهمة تنتهي وحدها حين يُسقَط المحرّك.
        tauri::async_runtime::spawn(async move {
            while let Some(ev) = rx.recv().await {
                let _ = match ev {
                    BridgeEvent::CatalogRequest { id } => {
                        app.emit("phone-sync://catalog-request", json!({ "requestId": id }))
                    }
                    BridgeEvent::InboxChanged => app.emit("phone-sync://inbox-changed", ()),
                    BridgeEvent::StatusChanged => app.emit("phone-sync://status-changed", ()),
                };
            }
        });
    }
    *guard = Some(engine.clone());
    Ok(engine)
}

async fn run<T, F>(app: AppHandle, state: &PhoneSyncState, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(Arc<Engine>) -> Result<T, String> + Send + 'static,
{
    let slot = state.slot.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let engine = get_or_create(&app, &slot)?;
        f(engine)
    })
    .await
    .map_err(|e| format!("خطأ داخلي في ميزة مزامنة الهاتف: {e}"))?
}

// ───────────────────────── الخدمة ─────────────────────────

#[tauri::command]
pub async fn phone_sync_status(app: AppHandle, state: State<'_, PhoneSyncState>) -> Result<Status, String> {
    run(app, &state, |e| Ok(e.status())).await
}

#[tauri::command]
pub async fn phone_sync_start(app: AppHandle, state: State<'_, PhoneSyncState>) -> Result<Status, String> {
    run(app, &state, |e| {
        e.start()?;
        Ok(e.status())
    })
    .await
}

#[tauri::command]
pub async fn phone_sync_stop(app: AppHandle, state: State<'_, PhoneSyncState>) -> Result<Status, String> {
    run(app, &state, |e| {
        e.stop();
        Ok(e.status())
    })
    .await
}

#[tauri::command]
pub async fn phone_sync_rotate_key(app: AppHandle, state: State<'_, PhoneSyncState>) -> Result<Status, String> {
    run(app, &state, |e| {
        e.rotate_key()?;
        Ok(e.status())
    })
    .await
}

/// يحفظ ملف شهادة الأمان (mks-local-ca.crt) في مجلد التنزيلات (وإلا سطح المكتب) ليُنقل إلى الهاتف
/// يدوياً (كابل/بلوتوث/واتساب/بريد) إن تعذّر تنزيله من الهاتف مباشرة. يفتح مستكشف ويندوز عليه.
#[tauri::command]
pub async fn phone_sync_export_ca(app: AppHandle, state: State<'_, PhoneSyncState>) -> Result<String, String> {
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().desktop_dir())
        .map_err(|e| format!("تعذّر تحديد مجلد الحفظ: {e}"))?;
    run(app, &state, move |e| {
        let path = e.export_ca(&dir)?;
        reveal_in_explorer(&path);
        Ok(path.display().to_string())
    })
    .await
}

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

// ───────────────────────── جسر الكتالوج ─────────────────────────

#[tauri::command]
pub async fn phone_sync_set_provider_ready(
    app: AppHandle,
    state: State<'_, PhoneSyncState>,
    ready: bool,
) -> Result<(), String> {
    run(app, &state, move |e| {
        e.bridge().set_provider_ready(ready);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn phone_sync_publish_catalog(
    app: AppHandle,
    state: State<'_, PhoneSyncState>,
    catalog: Value,
) -> Result<(), String> {
    run(app, &state, move |e| e.bridge().publish(catalog)).await
}

/// ردّ الواجهة على حدث phone-sync://catalog-request: كتالوج، أو رسالة خطأ.
#[tauri::command]
pub async fn phone_sync_provide_catalog(
    app: AppHandle,
    state: State<'_, PhoneSyncState>,
    request_id: u64,
    catalog: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    run(app, &state, move |e| {
        let reply = match (catalog, error) {
            (Some(c), _) => CatalogReply::Ok(c),
            (None, Some(msg)) => CatalogReply::Err(msg),
            (None, None) => CatalogReply::Err("ردّ فارغ من واجهة الكمبيوتر".into()),
        };
        e.bridge().provide(request_id, reply);
        Ok(())
    })
    .await
}

// ───────────────────────── الفواتير الواردة ─────────────────────────

#[tauri::command]
pub async fn phone_sync_list_inbox(app: AppHandle, state: State<'_, PhoneSyncState>) -> Result<Vec<Record>, String> {
    run(app, &state, |e| Ok(e.store().list_inbox())).await
}

#[tauri::command]
pub async fn phone_sync_recent_decisions(
    app: AppHandle,
    state: State<'_, PhoneSyncState>,
    limit: usize,
) -> Result<Vec<LedgerEntry>, String> {
    run(app, &state, move |e| Ok(e.store().recent_decisions(limit.min(200)))).await
}

#[tauri::command]
pub async fn phone_sync_begin_save(
    app: AppHandle,
    state: State<'_, PhoneSyncState>,
    uid: String,
) -> Result<Record, String> {
    run(app, &state, move |e| e.store().begin_save(&uid)).await
}

#[tauri::command]
pub async fn phone_sync_record_saved(
    app: AppHandle,
    state: State<'_, PhoneSyncState>,
    uid: String,
    invoice_id: i64,
    invoice_number: String,
) -> Result<(), String> {
    run(app, &state, move |e| e.store().record_saved(&uid, invoice_id, &invoice_number)).await
}

#[tauri::command]
pub async fn phone_sync_abort_save(
    app: AppHandle,
    state: State<'_, PhoneSyncState>,
    uid: String,
) -> Result<(), String> {
    run(app, &state, move |e| e.store().abort_save(&uid)).await
}

#[tauri::command]
pub async fn phone_sync_mark_confirmed(
    app: AppHandle,
    state: State<'_, PhoneSyncState>,
    uid: String,
    invoice_id: i64,
    invoice_number: String,
    merchant_name: Option<String>,
    total: Option<f64>,
) -> Result<(), String> {
    run(app, &state, move |e| {
        e.store().mark_confirmed(&uid, invoice_id, &invoice_number, merchant_name, total)?;
        e.events().push("confirm", None, format!("اعتُمدت فاتورة الهاتف برقم {invoice_number}"));
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn phone_sync_reject(
    app: AppHandle,
    state: State<'_, PhoneSyncState>,
    uid: String,
    reason: Option<String>,
) -> Result<(), String> {
    run(app, &state, move |e| {
        e.store().reject(&uid, reason)?;
        e.events().push("reject", None, "رُفضت فاتورة واردة من الهاتف");
        Ok(())
    })
    .await
}
