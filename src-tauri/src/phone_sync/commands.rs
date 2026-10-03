// ============================================================================
// طبقة Tauri الرقيقة لميزة مزامنة الهاتف: أوامر تستدعيها الواجهة + جسر لطلب
// بيانات التجار/الصناديق من الواجهة (SQLite تبقى حصراً من جهة JS — db.ts —
// حسب قاعدة المشروع «لا استدعاءات DB من Rust»، AI_CONTEXT.md القسم 8/9).
//
// آلية الجسر: حين يطلب هاتف البيانات الأساسية، يبثّ Rust حدث
// `phone-sync:snapshot-request` برقم طلب؛ تقرأ الواجهة التجار/الصناديق عبر
// db.ts وتردّ بـ `phone_sync_provide_snapshot`. إن لم تردّ خلال مهلة قصيرة تُعاد
// آخر لقطة ناجحة (مع علامة stale) بدل فشل الطلب.
// ============================================================================

use super::{
    cert,
    dto::{AddressInfo, ServiceInfo, Snapshot},
    net,
    server::{self, SnapshotFn},
    store::{InvoiceRecord, Store},
};
use qrcode::{render::svg, EcLevel, QrCode};
use ring::rand::{SecureRandom, SystemRandom};
use std::{
    collections::HashMap,
    net::Ipv4Addr,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

pub const HTTPS_PORT: u16 = 47443;
pub const SETUP_PORT: u16 = 47480;
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(4);
const PRUNE_CONFIRMED_AFTER_DAYS: i64 = 365;

const EVT_SNAPSHOT_REQUEST: &str = "phone-sync:snapshot-request";
const EVT_INVOICES_RECEIVED: &str = "phone-sync:invoices-received";

// ───────────────────────── الجسر مع الواجهة ─────────────────────────

#[derive(Default)]
struct Bridge {
    next: AtomicU64,
    waiting: Mutex<HashMap<u64, oneshot::Sender<Snapshot>>>,
    cache: Mutex<Option<Snapshot>>,
}

impl Bridge {
    fn cached(&self) -> Option<Snapshot> {
        self.cache.lock().ok().and_then(|c| c.clone())
    }

    fn remember(&self, snap: &Snapshot) {
        if let Ok(mut c) = self.cache.lock() {
            *c = Some(snap.clone());
        }
    }

    fn fallback(&self, why: &str) -> Result<(Snapshot, bool), String> {
        match self.cached() {
            Some(s) => {
                log::warn!("phone_sync: استُخدمت لقطة قديمة ({why})");
                Ok((s, true))
            }
            None => Err(format!("لا توجد بيانات متاحة ({why})")),
        }
    }

    async fn request(&self, app: &AppHandle) -> Result<(Snapshot, bool), String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = oneshot::channel();
        if let Ok(mut w) = self.waiting.lock() {
            w.insert(id, tx);
        }
        if let Err(e) = app.emit(EVT_SNAPSHOT_REQUEST, id) {
            self.drop_waiter(id);
            return self.fallback(&format!("تعذر إرسال الطلب للواجهة: {e}"));
        }
        match tokio::time::timeout(SNAPSHOT_TIMEOUT, rx).await {
            Ok(Ok(snap)) => {
                self.remember(&snap);
                Ok((snap, false))
            }
            _ => {
                self.drop_waiter(id);
                self.fallback("الواجهة لم تردّ في الوقت المحدد")
            }
        }
    }

    fn drop_waiter(&self, id: u64) {
        if let Ok(mut w) = self.waiting.lock() {
            w.remove(&id);
        }
    }
}

// ───────────────────────── الحالة العامة ─────────────────────────

#[derive(Default)]
struct Inner {
    running: Option<server::RunningServer>,
    store: Option<Arc<Store>>,
    key: Option<Arc<RwLock<String>>>,
}

#[derive(Default)]
pub struct PhoneSyncState {
    inner: Mutex<Inner>,
    bridge: Arc<Bridge>,
}

fn lock<'a>(state: &'a PhoneSyncState) -> Result<std::sync::MutexGuard<'a, Inner>, String> {
    state.inner.lock().map_err(|_| "حالة الخدمة معطوبة".to_string())
}

fn base_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // مجلد بيانات التطبيق عبر واجهة Tauri القياسية (يعمل على Windows وLinux).
    let d = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("تعذر تحديد مجلد بيانات التطبيق: {e}"))?
        .join("phone_sync");
    std::fs::create_dir_all(&d).map_err(|e| format!("تعذر إنشاء مجلد الميزة: {e}"))?;
    Ok(d)
}

fn open_store(app: &AppHandle, inner: &mut Inner) -> Result<Arc<Store>, String> {
    if let Some(s) = &inner.store {
        return Ok(s.clone());
    }
    let store = Arc::new(Store::open(&base_dir(app)?.join("pending"))?);
    let removed = store.prune_confirmed_older_than(PRUNE_CONFIRMED_AFTER_DAYS);
    if removed > 0 {
        log::info!("phone_sync: حُذفت {removed} فاتورة مؤكَّدة قديمة من السجل");
    }
    inner.store = Some(store.clone());
    Ok(store)
}

fn is_hex_key(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn new_key() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "تعذر توليد مفتاح عشوائي".to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn write_key(dir: &std::path::Path, key: &str) -> Result<(), String> {
    let p = dir.join("access_key.txt");
    std::fs::write(&p, key).map_err(|e| format!("تعذر حفظ مفتاح الوصول: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn read_key(dir: &std::path::Path) -> Option<String> {
    let s = std::fs::read_to_string(dir.join("access_key.txt")).ok()?;
    let s = s.trim().to_string();
    is_hex_key(&s).then_some(s)
}

fn ensure_key(dir: &std::path::Path) -> Result<String, String> {
    if let Some(k) = read_key(dir) {
        return Ok(k);
    }
    let k = new_key()?;
    write_key(dir, &k)?;
    Ok(k)
}

fn build_info(dir: &std::path::Path, running: bool, addresses: Vec<AddressInfo>) -> ServiceInfo {
    ServiceInfo {
        running,
        https_port: HTTPS_PORT,
        setup_port: SETUP_PORT,
        addresses,
        ca_fingerprint: cert::existing_ca_fingerprint(&dir.join("certs")),
        access_key: read_key(dir),
        data_dir: dir.display().to_string(),
    }
}

// ───────────────────────── الأوامر ─────────────────────────

#[tauri::command]
pub fn phone_sync_info(app: AppHandle, state: State<'_, PhoneSyncState>) -> Result<ServiceInfo, String> {
    let dir = base_dir(&app)?;
    let running = lock(&state)?.running.is_some();
    Ok(build_info(&dir, running, net::lan_addresses()))
}

#[tauri::command]
pub fn phone_sync_start(app: AppHandle, state: State<'_, PhoneSyncState>) -> Result<ServiceInfo, String> {
    let dir = base_dir(&app)?;
    let addresses = net::lan_addresses();
    let mut inner = lock(&state)?;
    if inner.running.is_some() {
        return Ok(build_info(&dir, true, addresses));
    }

    let ips: Vec<Ipv4Addr> = addresses.iter().filter_map(|a| a.ip.parse().ok()).collect();
    let tls = cert::load_or_create(&dir.join("certs"), &ips)?;
    let store = open_store(&app, &mut inner)?;
    let key = Arc::new(RwLock::new(ensure_key(&dir)?));

    let bridge = state.bridge.clone();
    let app_for_snapshot = app.clone();
    let snapshot: SnapshotFn = Arc::new(move || {
        let bridge = bridge.clone();
        let app = app_for_snapshot.clone();
        Box::pin(async move { bridge.request(&app).await })
    });
    let app_for_events = app.clone();
    let on_received = Arc::new(move |n: usize| {
        let _ = app_for_events.emit(EVT_INVOICES_RECEIVED, n);
    });

    let running = server::start(server::StartParams {
        https_port: HTTPS_PORT,
        setup_port: SETUP_PORT,
        tls: tls.server_config,
        ca_pem: tls.ca_pem,
        ca_fingerprint: tls.ca_fingerprint,
        store,
        key: key.clone(),
        snapshot,
        on_received,
    })?;
    inner.running = Some(running);
    inner.key = Some(key);
    log::info!("phone_sync: بدأت الخدمة على المنفذين {HTTPS_PORT}/{SETUP_PORT}");
    Ok(build_info(&dir, true, addresses))
}

#[tauri::command]
pub async fn phone_sync_stop(app: AppHandle, state: State<'_, PhoneSyncState>) -> Result<ServiceInfo, String> {
    let dir = base_dir(&app)?;
    let taken = {
        let mut inner = lock(&state)?;
        inner.key = None;
        inner.running.take()
    };
    if let Some(mut srv) = taken {
        // الإيقاف قد ينتظر ثوانٍ لإنهاء الاتصالات الجارية — خارج خيط الواجهة.
        let _ = tauri::async_runtime::spawn_blocking(move || srv.stop()).await;
        log::info!("phone_sync: أُوقفت الخدمة");
    }
    Ok(build_info(&dir, false, net::lan_addresses()))
}

/// يولّد مفتاح وصول جديداً: كل الهواتف التي تحمل المفتاح القديم تحتاج مسح QR مجدداً.
#[tauri::command]
pub fn phone_sync_regenerate_key(app: AppHandle, state: State<'_, PhoneSyncState>) -> Result<ServiceInfo, String> {
    let dir = base_dir(&app)?;
    let k = new_key()?;
    write_key(&dir, &k)?;
    let inner = lock(&state)?;
    if let Some(shared) = &inner.key {
        if let Ok(mut w) = shared.write() {
            *w = k;
        }
    }
    Ok(build_info(&dir, inner.running.is_some(), net::lan_addresses()))
}

#[tauri::command]
pub fn phone_sync_provide_snapshot(
    state: State<'_, PhoneSyncState>,
    request_id: Option<u64>,
    snapshot: Snapshot,
) -> Result<(), String> {
    state.bridge.remember(&snapshot);
    if let Some(id) = request_id {
        let waiter = state.bridge.waiting.lock().ok().and_then(|mut w| w.remove(&id));
        if let Some(tx) = waiter {
            let _ = tx.send(snapshot);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn phone_sync_list(app: AppHandle, state: State<'_, PhoneSyncState>) -> Result<Vec<InvoiceRecord>, String> {
    let store = {
        let mut inner = lock(&state)?;
        open_store(&app, &mut inner)?
    };
    Ok(store.list())
}

fn with_store<T>(
    app: &AppHandle,
    state: &PhoneSyncState,
    f: impl FnOnce(&Store) -> Result<T, String>,
) -> Result<T, String> {
    let store = {
        let mut inner = lock(state)?;
        open_store(app, &mut inner)?
    };
    f(&store)
}

#[tauri::command]
pub fn phone_sync_confirm(
    app: AppHandle,
    state: State<'_, PhoneSyncState>,
    client_id: String,
    invoice_number: String,
    desktop_invoice_id: i64,
) -> Result<InvoiceRecord, String> {
    with_store(&app, &state, |s| s.set_confirmed(&client_id, &invoice_number, desktop_invoice_id))
}

#[tauri::command]
pub fn phone_sync_reject(
    app: AppHandle,
    state: State<'_, PhoneSyncState>,
    client_id: String,
    reason: String,
) -> Result<InvoiceRecord, String> {
    with_store(&app, &state, |s| s.set_rejected(&client_id, reason.trim()))
}

#[tauri::command]
pub fn phone_sync_reopen(
    app: AppHandle,
    state: State<'_, PhoneSyncState>,
    client_id: String,
) -> Result<InvoiceRecord, String> {
    with_store(&app, &state, |s| s.reopen(&client_id))
}

#[tauri::command]
pub fn phone_sync_delete_finished(
    app: AppHandle,
    state: State<'_, PhoneSyncState>,
    client_id: String,
) -> Result<(), String> {
    with_store(&app, &state, |s| s.delete_finished(&client_id))
}

/// رمز QR كـ SVG (نص). يُعرَض في الواجهة كصورة data: بلا innerHTML.
#[tauri::command]
pub fn phone_sync_qr(text: String) -> Result<String, String> {
    if text.is_empty() || text.len() > 1000 {
        return Err("نص رمز QR غير صالح".into());
    }
    let code = QrCode::with_error_correction_level(text.as_bytes(), EcLevel::M)
        .map_err(|e| format!("تعذر توليد رمز QR: {e}"))?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(240, 240)
        .quiet_zone(true)
        .dark_color(svg::Color("#0F172A"))
        .light_color(svg::Color("#FFFFFF"))
        .build())
}
