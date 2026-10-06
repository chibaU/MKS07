// محرّك مزامنة الهاتف — لا يعرف Tauri إطلاقاً (يُختبَر منفصلاً)، وأي مكتبة واجهة
// تغلّفه من الخارج. راجع phone_sync/mod.rs للطبقة الرقيقة التي تربطه بـ Tauri.

pub mod api;
pub mod assets;
pub mod b64;
pub mod bridge;
pub mod certs;
pub mod config;
pub mod consts;
pub mod events;
pub mod fsutil;
pub mod netinfo;
pub mod qr;
pub mod server;
pub mod store;
pub mod throttle;

#[cfg(test)]
mod tests;

use api::Ctx;
use bridge::{BridgeEvent, CatalogBridge};
use certs::{Ca, SwapCert};
use config::Config;
use consts::*;
use events::{Event, EventLog};
use serde::Serialize;
use server::Live;
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use store::{Counts, Store};
use tokio::sync::{mpsc, watch};
use tokio_rustls::TlsAcceptor;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Address {
    pub ip: String,
    pub iface: String,
    pub url: String,
    pub qr_svg: String,
    pub recommended: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub port: Option<u16>,
    pub port_changed: bool,
    pub addresses: Vec<Address>,
    pub no_network: bool,
    pub access_key: String,
    pub access_key_display: String,
    pub ca_fingerprint: String,
    pub ca_not_after: String,
    pub started_at: Option<String>,
    pub provider_ready: bool,
    pub inbox: Counts,
    pub events: Vec<Event>,
    pub last_error: Option<String>,
    pub api_version: u32,
    pub data_dir: String,
}

struct Running {
    runtime: Option<tokio::runtime::Runtime>,
    shutdown: watch::Sender<bool>,
    port: u16,
    started_at: String,
    live: Arc<Mutex<Live>>,
}

pub struct Engine {
    root: PathBuf,
    config: Mutex<Config>,
    ca: Arc<Ca>,
    ctx: Arc<Ctx>,
    events: Arc<EventLog>,
    run: Mutex<Option<Running>>,
    last_error: Mutex<Option<String>>,
    rx: Mutex<Option<mpsc::UnboundedReceiver<BridgeEvent>>>,
    qr_cache: Mutex<HashMap<String, String>>,
}

impl Engine {
    pub fn new(root: PathBuf) -> Result<Engine, String> {
        std::fs::create_dir_all(&root).map_err(|e| format!("تعذّر إنشاء مجلد بيانات المزامنة: {e}"))?;
        let config = Config::load_or_create(&root)?;
        let ca = Arc::new(Ca::load_or_create(&root)?);
        let (store, warnings) = Store::open(&root)?;
        let (tx, rx) = mpsc::unbounded_channel();
        let events = Arc::new(EventLog::default());
        for w in warnings {
            events.push("warn", None, w);
        }
        let bridge = Arc::new(CatalogBridge::new(tx.clone()));
        let ctx = Arc::new(Ctx::new(
            config.access_key.clone(),
            Arc::new(store),
            bridge,
            events.clone(),
            ca.cert_der.clone(),
            ca.cert_pem.clone(),
            ca.fingerprint.clone(),
            ca.not_after.clone(),
            tx,
        ));
        Ok(Engine {
            root,
            config: Mutex::new(config),
            ca,
            ctx,
            events,
            run: Mutex::new(None),
            last_error: Mutex::new(None),
            rx: Mutex::new(Some(rx)),
            qr_cache: Mutex::new(HashMap::new()),
        })
    }

    pub fn store(&self) -> Arc<Store> {
        self.ctx.store.clone()
    }

    pub fn bridge(&self) -> Arc<CatalogBridge> {
        self.ctx.bridge.clone()
    }

    pub fn events(&self) -> Arc<EventLog> {
        self.events.clone()
    }

    /// تُستهلك مرة واحدة من الطبقة الخارجية لتمرير الأحداث إلى الواجهة.
    pub fn take_events_rx(&self) -> Option<mpsc::UnboundedReceiver<BridgeEvent>> {
        lock(&self.rx).take()
    }

    #[cfg(test)]
    pub fn is_running(&self) -> bool {
        lock(&self.run).is_some()
    }

    pub fn start(&self) -> Result<(), String> {
        let result = self.start_inner();
        match &result {
            Ok(()) => *lock(&self.last_error) = None,
            Err(e) => {
                *lock(&self.last_error) = Some(e.clone());
                self.events.push("error", None, format!("تعذّر تشغيل الخدمة: {e}"));
            }
        }
        result
    }

    fn start_inner(&self) -> Result<(), String> {
        let mut slot = lock(&self.run);
        if slot.is_some() {
            return Ok(());
        }
        let ips = netinfo::list_local_ipv4();
        let v4: Vec<Ipv4Addr> = ips.iter().map(|x| x.ip).collect();
        let leaf = certs::generate_leaf(&self.ca, &v4)?;
        let resolver = Arc::new(SwapCert::new(leaf.key.clone()));
        let tls_cfg = certs::build_server_config(resolver.clone())?;
        let acceptor = TlsAcceptor::from(tls_cfg);

        let preferred = lock(&self.config).preferred_port;
        let (std_listener, port) = server::bind_with_fallback(preferred)?;

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("mks-phone-sync")
            .enable_all()
            .build()
            .map_err(|e| format!("تعذّر تهيئة بيئة التشغيل: {e}"))?;
        let listener = {
            let _guard = runtime.enter();
            tokio::net::TcpListener::from_std(std_listener).map_err(|e| format!("تعذّر استخدام المنفذ: {e}"))?
        };

        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let live = Arc::new(Mutex::new(Live { ips, leaf_not_after: leaf.not_after }));
        runtime.spawn(server::accept_loop(listener, acceptor, self.ctx.clone(), shutdown_rx.clone()));
        runtime.spawn(server::watch_network(
            self.ca.clone(),
            resolver,
            live.clone(),
            self.ctx.clone(),
            shutdown_rx,
        ));

        self.events.push("service", None, format!("بدأت الخدمة على المنفذ {port}"));
        *slot = Some(Running {
            runtime: Some(runtime),
            shutdown: shutdown_tx,
            port,
            started_at: fsutil::now_rfc3339(),
            live,
        });
        let _ = self.ctx.tx.send(BridgeEvent::StatusChanged);
        Ok(())
    }

    pub fn stop(&self) {
        let taken = lock(&self.run).take();
        if let Some(mut r) = taken {
            let _ = r.shutdown.send(true);
            if let Some(rt) = r.runtime.take() {
                rt.shutdown_background();
            }
            self.events.push("service", None, "أُوقفت الخدمة");
            let _ = self.ctx.tx.send(BridgeEvent::StatusChanged);
        }
    }

    pub fn rotate_key(&self) -> Result<(), String> {
        let key = config::generate_key()?;
        {
            let mut cfg = lock(&self.config);
            cfg.access_key = key.clone();
            cfg.key_rotated_at = Some(fsutil::now_rfc3339());
            cfg.save(&self.root)?;
        }
        self.ctx.set_key(key);
        self.events.push("service", None, "جُدِّد مفتاح الوصول — الهواتف القديمة تحتاج مسح رمز QR الجديد");
        let _ = self.ctx.tx.send(BridgeEvent::StatusChanged);
        Ok(())
    }

    /// يحفظ شهادة الجذر (DER، الاسم mks-local-ca.crt) في مجلد يختاره المستدعي — طريقة نقل يدوية
    /// (كابل/بلوتوث/واتساب...) لا تعتمد على أي متصفح، إن تعذّر تنزيلها من الهاتف مباشرة.
    pub fn export_ca(&self, dir: &Path) -> Result<PathBuf, String> {
        std::fs::create_dir_all(dir).map_err(|e| format!("تعذّر إنشاء مجلد الحفظ: {e}"))?;
        let path = dir.join("mks-local-ca.crt");
        fsutil::write_atomic(&path, &self.ca.cert_der).map_err(|e| format!("تعذّر حفظ ملف الشهادة: {e}"))?;
        self.events.push("service", None, format!("صُدِّر ملف شهادة الأمان إلى {}", path.display()));
        Ok(path)
    }

    fn qr_for(&self, data: &str) -> String {
        let mut cache = lock(&self.qr_cache);
        if cache.len() > 16 {
            cache.clear();
        }
        if let Some(s) = cache.get(data) {
            return s.clone();
        }
        let svg = qr::svg_for(data).unwrap_or_default();
        cache.insert(data.to_string(), svg.clone());
        svg
    }

    pub fn status(&self) -> Status {
        let (key, preferred) = {
            let c = lock(&self.config);
            (c.access_key.clone(), c.preferred_port)
        };
        let run = lock(&self.run);
        let (running, port, started_at, ips) = match &*run {
            Some(r) => (true, Some(r.port), Some(r.started_at.clone()), lock(&r.live).ips.clone()),
            None => (false, None, None, Vec::new()),
        };
        drop(run);

        let addresses: Vec<Address> = match port {
            Some(p) => ips
                .iter()
                .enumerate()
                .map(|(i, x)| Address {
                    ip: x.ip.to_string(),
                    iface: x.iface.clone(),
                    url: format!("https://{}:{}/", x.ip, p),
                    qr_svg: self.qr_for(&format!("https://{}:{}/#k={}", x.ip, p, key)),
                    recommended: i == 0,
                })
                .collect(),
            None => Vec::new(),
        };
        Status {
            running,
            port,
            port_changed: port.map_or(false, |p| p != preferred),
            no_network: running && addresses.is_empty(),
            addresses,
            access_key_display: config::format_key(&key),
            access_key: key,
            ca_fingerprint: self.ca.fingerprint.clone(),
            ca_not_after: self.ca.not_after.clone(),
            started_at,
            provider_ready: self.ctx.bridge.provider_ready(),
            inbox: self.ctx.store.counts(),
            events: self.events.recent(30),
            last_error: lock(&self.last_error).clone(),
            api_version: API_VERSION,
            data_dir: self.root.display().to_string(),
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.stop();
    }
}
