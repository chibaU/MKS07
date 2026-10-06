// حلقة الاستقبال: TCP → مصافحة TLS → HTTP/1.1. كل اتصال مهمة مستقلة؛ أي خطأ أو
// panic في اتصال واحد لا يمسّ غيره ولا يمسّ بقية التطبيق (الخادم يعمل في runtime
// خاص به منفصل عن runtime الخاص بـ Tauri).

use super::api::{self, Ctx};
use super::certs::{self, Ca, SwapCert};
use super::consts::*;
use super::netinfo::{self, LocalIp};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::{TokioIo, TokioTimer};
use std::net::{Ipv4Addr, SocketAddr, TcpListener as StdListener};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use time::OffsetDateTime;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, Semaphore};
use tokio_rustls::TlsAcceptor;

pub struct Live {
    pub ips: Vec<LocalIp>,
    pub leaf_not_after: OffsetDateTime,
}

/// يحاول المنفذ المفضّل ثم ما يليه. العنوان 0.0.0.0 ليصل الهاتف عبر الشبكة المحلية.
pub fn bind_with_fallback(preferred: u16) -> Result<(StdListener, u16), String> {
    let mut last_err = String::new();
    for offset in 0..=PORT_FALLBACK_TRIES {
        let Some(port) = preferred.checked_add(offset) else { break };
        match StdListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, port))) {
            Ok(l) => {
                l.set_nonblocking(true).map_err(|e| format!("إعداد المنفذ: {e}"))?;
                return Ok((l, port));
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(format!(
        "تعذّر فتح منفذ للخدمة (من {preferred} إلى {}): {last_err}. ربما برنامج آخر يستخدم هذه المنافذ.",
        preferred.saturating_add(PORT_FALLBACK_TRIES)
    ))
}

pub async fn accept_loop(
    listener: TcpListener,
    acceptor: TlsAcceptor,
    ctx: Arc<Ctx>,
    mut shutdown: watch::Receiver<bool>,
) {
    let sem = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            res = listener.accept() => match res {
                Ok((tcp, peer)) => {
                    // سقف الاتصالات المتزامنة: ما يزيد يُغلق فوراً بدل أن يستهلك الذاكرة.
                    let Ok(permit) = sem.clone().try_acquire_owned() else {
                        drop(tcp);
                        continue;
                    };
                    let acceptor = acceptor.clone();
                    let ctx = ctx.clone();
                    tokio::spawn(async move {
                        serve_conn(tcp, peer, acceptor, ctx).await;
                        drop(permit);
                    });
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
    }
}

async fn serve_conn(tcp: TcpStream, peer: SocketAddr, acceptor: TlsAcceptor, ctx: Arc<Ctx>) {
    let _ = tcp.set_nodelay(true);
    let tls = match tokio::time::timeout(Duration::from_secs(HANDSHAKE_TIMEOUT_SECS), acceptor.accept(tcp)).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            ctx.note_tls_failure(peer.ip(), &e);
            return;
        }
        Err(_) => return,
    };
    let ip = peer.ip();
    let svc = service_fn(move |req| {
        let ctx = ctx.clone();
        async move { api::handle(ctx, ip, req).await }
    });
    let mut builder = http1::Builder::new();
    builder
        .timer(TokioTimer::new())
        .header_read_timeout(Duration::from_secs(HEADER_TIMEOUT_SECS))
        .keep_alive(true);
    let _ = builder.serve_connection(TokioIo::new(tls), svc).await;
}

/// يراقب تغيّر عناوين الشبكة (DHCP/تبديل الواي فاي) ويُجدّد شهادة الخادم فوراً
/// لتشمل العنوان الجديد — الهاتف يثق بالجذر فلا يحتاج أي إجراء إضافي.
pub async fn watch_network(
    ca: Arc<Ca>,
    resolver: Arc<SwapCert>,
    live: Arc<Mutex<Live>>,
    ctx: Arc<Ctx>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut ticker = tokio::time::interval(Duration::from_secs(15));
    ticker.tick().await;
    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            _ = ticker.tick() => {}
        }
        let ips = tokio::task::spawn_blocking(netinfo::list_local_ipv4).await.unwrap_or_default();
        let (changed, near_expiry) = {
            let l = live.lock().unwrap_or_else(|e| e.into_inner());
            let mut a: Vec<_> = l.ips.iter().map(|x| x.ip).collect();
            let mut b: Vec<_> = ips.iter().map(|x| x.ip).collect();
            a.sort();
            b.sort();
            (a != b, OffsetDateTime::now_utc() + time::Duration::days(LEAF_RENEW_BEFORE_DAYS) > l.leaf_not_after)
        };
        if !changed && !near_expiry {
            continue;
        }
        let v4: Vec<Ipv4Addr> = ips.iter().map(|x| x.ip).collect();
        match certs::generate_leaf(&ca, &v4) {
            Ok(leaf) => {
                resolver.swap(leaf.key.clone());
                {
                    let mut l = live.lock().unwrap_or_else(|e| e.into_inner());
                    l.ips = ips;
                    l.leaf_not_after = leaf.not_after;
                }
                if changed {
                    ctx.events.push("network", None, "تغيّر عنوان الكمبيوتر على الشبكة — حُدّثت الشهادة. امسح رمز QR الجديد على الهاتف.");
                }
                let _ = ctx.tx.send(super::bridge::BridgeEvent::StatusChanged);
            }
            Err(e) => ctx.events.push("error", None, format!("تعذّر تجديد الشهادة: {e}")),
        }
    }
}
