// اختبارات المحرّك: وحدات للتخزين والمفاتيح + اختبار تكاملي حقيقي (TLS فعلي على
// منفذ محلي، عميل يثق بشهادة الجذر، ومحاكاة لواجهة JS عبر الجسر).

use super::bridge::{BridgeEvent, CatalogReply};
use super::config::{self, Config};
use super::store::{is_uuid, State, Store};
use super::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::rustls::pki_types::{CertificateDer, ServerName};
use tokio_rustls::TlsConnector;

static COUNTER: AtomicU32 = AtomicU32::new(0);

fn tmp_dir(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let mut d = std::env::temp_dir();
    d.push(format!("mks-ps-test-{}-{}-{}", std::process::id(), tag, n));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn uid(n: u32) -> String {
    format!("{:08x}-1111-4222-8333-{:012x}", n, n)
}

fn invoice(uid: &str) -> Value {
    json!({
        "uid": uid,
        "createdAt": "2026-10-03T09:00:00.000Z",
        "invoiceDate": "2026-10-03",
        "merchantId": 7,
        "merchantNameHint": "أحمد",
        "lines": [{
            "lid": "l1", "productName": "طماطم", "scaleWeight": 120.5, "price": 100,
            "boxes": [{"boxId": 2, "boxCount": 4}],
            "phoneNetWeight": 118.9, "phoneSubtotal": 11890.0
        }],
        "phoneTotal": 11890.0
    })
}

fn free_port() -> u16 {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    l.local_addr().unwrap().port()
}

fn engine_on_free_port(dir: &Path) -> (Engine, u16) {
    let port = free_port();
    let mut cfg = Config::load_or_create(dir).unwrap();
    cfg.preferred_port = port;
    cfg.save(dir).unwrap();
    (Engine::new(dir.to_path_buf()).unwrap(), port)
}

// ───────────────────────── مفاتيح الوصول ─────────────────────────

#[test]
fn keys_generate_normalize_format() {
    let k = config::generate_key().unwrap();
    assert!(config::is_valid_key(&k), "{k}");
    let shown = config::format_key(&k);
    assert_eq!(shown.len(), 19);
    assert_eq!(config::normalize_key(&shown.to_lowercase()), k);
    assert_eq!(config::normalize_key("o1il-0000"), "01110000");
    assert!(config::keys_equal(&k, &k.clone()));
    assert!(!config::keys_equal(&k, "AAAA"));
    let other = config::generate_key().unwrap();
    assert_ne!(k, other);
}

// ───────────────────────── التخزين ─────────────────────────

#[test]
fn store_submit_is_idempotent_and_survives_restart() {
    let dir = tmp_dir("store1");
    let (s, w) = Store::open(&dir).unwrap();
    assert!(w.is_empty());
    let u = uid(1);
    let out = s.submit(vec![invoice(&u)], Some("هاتف 1".into()), Some("192.168.1.9".into()));
    assert_eq!(out.new_count, 1);
    assert_eq!(out.receipts[0].status, "pending");
    assert!(!out.receipts[0].duplicate);

    let again = s.submit(vec![invoice(&u)], None, None);
    assert_eq!(again.new_count, 0);
    assert!(again.receipts[0].duplicate);
    assert!(!again.receipts[0].content_changed);
    assert_eq!(s.list_inbox().len(), 1);

    let mut changed = invoice(&u);
    changed["lines"][0]["price"] = json!(150);
    let chg = s.submit(vec![changed], None, None);
    assert!(chg.receipts[0].duplicate && chg.receipts[0].content_changed);
    assert_eq!(s.list_inbox()[0].invoice.lines[0].price, 100.0, "النسخة الأولى هي المحفوظة");
    drop(s);

    let (s2, _) = Store::open(&dir).unwrap();
    assert_eq!(s2.list_inbox().len(), 1, "الفاتورة المعلّقة تبقى بعد إعادة التشغيل");
    assert_eq!(s2.list_inbox()[0].device_label.as_deref(), Some("هاتف 1"));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn store_batch_one_bad_invoice_does_not_affect_others() {
    let dir = tmp_dir("store2");
    let (s, _) = Store::open(&dir).unwrap();
    let mut bad = invoice(&uid(2));
    bad["lines"] = json!([]);
    let mut nan = invoice(&uid(3));
    nan["lines"][0]["price"] = json!(-5);
    let traversal = {
        let mut v = invoice("../../etc/passwd");
        v["uid"] = json!("../../etc/passwd");
        v
    };
    let out = s.submit(vec![invoice(&uid(1)), bad, nan, traversal, invoice(&uid(4))], None, None);
    let st: Vec<&str> = out.receipts.iter().map(|r| r.status.as_str()).collect();
    assert_eq!(st, ["pending", "invalid", "invalid", "invalid", "pending"]);
    assert_eq!(out.new_count, 2);
    assert_eq!(s.list_inbox().len(), 2);
    assert_eq!(out.receipts[3].uid, "", "معرّف غير صالح لا يُعاد صدى");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn store_confirm_reject_and_dedupe_forever() {
    let dir = tmp_dir("store3");
    let (s, _) = Store::open(&dir).unwrap();
    let (a, b, c) = (uid(10), uid(11), uid(12));
    s.submit(vec![invoice(&a), invoice(&b), invoice(&c)], None, None);

    // لا اعتماد دون المرور بحالة الحفظ
    assert!(s.begin_save(&a).is_ok());
    assert_eq!(s.counts().saving, 1);
    s.record_saved(&a, 55, "2610-7-1").unwrap();
    s.mark_confirmed(&a, 55, "2610-7-1", Some("أحمد".into()), Some(11890.0)).unwrap();
    assert!(s.reject(&a, None).is_err(), "قرار نهائي لا يُنقض");

    // رفض
    assert!(s.reject(&b, Some("  مكررة  ".into())).is_ok());

    // إعادة الإرسال بعد الاعتماد/الرفض لا تُنشئ شيئاً
    let r = s.submit(vec![invoice(&a), invoice(&b)], None, None);
    assert_eq!(r.new_count, 0);
    assert_eq!(r.receipts[0].status, "confirmed");
    assert_eq!(r.receipts[0].final_number.as_deref(), Some("2610-7-1"));
    assert_eq!(r.receipts[1].status, "rejected");
    assert_eq!(r.receipts[1].reason.as_deref(), Some("مكررة"));

    let st = s.status(&[a.clone(), b.clone(), c.clone(), uid(99)]);
    let names: Vec<&str> = st.iter().map(|x| x.status.as_str()).collect();
    assert_eq!(names, ["confirmed", "rejected", "pending", "unknown"]);
    drop(s);

    // بعد إعادة التشغيل: القرارات باقية، والمعلّقة باقية
    let (s2, _) = Store::open(&dir).unwrap();
    assert_eq!(s2.list_inbox().len(), 1);
    assert_eq!(s2.status(&[a.clone()])[0].status, "confirmed");
    assert_eq!(s2.recent_decisions(10).len(), 2);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn store_abort_save_returns_to_pending_and_saving_survives_restart() {
    let dir = tmp_dir("store4");
    let (s, _) = Store::open(&dir).unwrap();
    let (a, b) = (uid(20), uid(21));
    s.submit(vec![invoice(&a), invoice(&b)], None, None);
    s.begin_save(&a).unwrap();
    s.abort_save(&a).unwrap();
    assert_eq!(s.list_inbox().iter().find(|r| r.uid == a).unwrap().state, State::Pending);

    s.begin_save(&b).unwrap();
    s.record_saved(&b, 9, "2610-7-3").unwrap();
    assert!(s.reject(&b, None).is_err(), "لا رفض أثناء الحفظ");
    drop(s);
    let (s2, _) = Store::open(&dir).unwrap();
    let rec = s2.list_inbox().into_iter().find(|r| r.uid == b).unwrap();
    assert_eq!(rec.state, State::Saving);
    assert_eq!(rec.saving.unwrap().invoice_id, Some(9), "معرّف الفاتورة المنشأة محفوظ للاستئناف");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn store_recovers_from_crash_between_ledger_and_inbox_delete() {
    let dir = tmp_dir("store5");
    let (s, _) = Store::open(&dir).unwrap();
    let a = uid(30);
    s.submit(vec![invoice(&a)], None, None);
    let inbox_file = dir.join("inbox").join(format!("{a}.json"));
    let backup = std::fs::read(&inbox_file).unwrap();
    s.begin_save(&a).unwrap();
    s.mark_confirmed(&a, 1, "2610-7-1", None, None).unwrap();
    drop(s);
    // محاكاة الانقطاع: ملف inbox ما زال موجوداً رغم أن القرار مسجَّل
    std::fs::write(&inbox_file, backup).unwrap();
    let (s2, _) = Store::open(&dir).unwrap();
    assert!(s2.list_inbox().is_empty(), "السجل هو المرجع");
    assert!(!inbox_file.exists(), "تُنظَّف بقايا الملف");
    assert_eq!(s2.status(&[a])[0].status, "confirmed");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn store_tolerates_corrupt_files_and_partial_ledger_line() {
    let dir = tmp_dir("store6");
    let (s, _) = Store::open(&dir).unwrap();
    let a = uid(40);
    s.submit(vec![invoice(&a)], None, None);
    s.begin_save(&a).unwrap();
    s.mark_confirmed(&a, 3, "2610-7-9", None, None).unwrap();
    drop(s);
    // سطر ناقص في نهاية السجل + ملف فاتورة تالف + ملف مؤقت يتيم
    let mut led = std::fs::OpenOptions::new().append(true).open(dir.join("ledger.jsonl")).unwrap();
    use std::io::Write;
    led.write_all(b"{\"uid\":\"broken").unwrap();
    drop(led);
    std::fs::write(dir.join("inbox").join(format!("{}.json", uid(41))), b"{not json").unwrap();
    std::fs::write(dir.join("inbox").join(format!("{}.json.tmp-123", uid(42))), b"x").unwrap();

    let (s2, warnings) = Store::open(&dir).unwrap();
    assert_eq!(warnings.len(), 2, "{warnings:?}");
    assert_eq!(s2.status(&[a.clone()])[0].status, "confirmed");
    // الإلحاق التالي لا يلتصق بالسطر الناقص
    let b = uid(43);
    s2.submit(vec![invoice(&b)], None, None);
    s2.begin_save(&b).unwrap();
    s2.mark_confirmed(&b, 4, "2610-7-10", None, None).unwrap();
    drop(s2);
    let (s3, _) = Store::open(&dir).unwrap();
    assert_eq!(s3.status(&[a, b])[1].status, "confirmed");
    assert!(is_uuid(&uid(1)));
    assert!(!is_uuid("ABCDEFAB-1111-4222-8333-000000000001"), "أحرف كبيرة مرفوضة");
    let _ = std::fs::remove_dir_all(dir);
}

// ───────────────────────── الشهادات ─────────────────────────

#[test]
fn ca_persists_and_signs_leaf_for_ips() {
    let dir = tmp_dir("ca1");
    let ca1 = certs::Ca::load_or_create(&dir).unwrap();
    let ca2 = certs::Ca::load_or_create(&dir).unwrap();
    assert_eq!(ca1.fingerprint, ca2.fingerprint, "الجذر ثابت عبر التشغيلات");
    assert_eq!(ca1.fingerprint.len(), 32 * 3 - 1);
    let leaf = certs::generate_leaf(&ca2, &[std::net::Ipv4Addr::new(192, 168, 1, 20)]).unwrap();
    assert!(leaf.not_after > time::OffsetDateTime::now_utc());
    assert!(leaf.not_after > time::OffsetDateTime::now_utc() + time::Duration::days(LEAF_RENEW_BEFORE_DAYS), "لا تحتاج تجديداً فور توليدها");
    let _ = std::fs::remove_dir_all(dir);
}

// ───────────────────────── عميل TLS للاختبار ─────────────────────────

fn client_config(ca_der: &[u8]) -> Arc<tokio_rustls::rustls::ClientConfig> {
    let mut roots = tokio_rustls::rustls::RootCertStore::empty();
    roots.add(CertificateDer::from(ca_der.to_vec())).unwrap();
    let provider = Arc::new(tokio_rustls::rustls::crypto::ring::default_provider());
    Arc::new(
        tokio_rustls::rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(roots)
            .with_no_client_auth(),
    )
}

struct Reply {
    status: u16,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|_| panic!("ليس JSON: {}", String::from_utf8_lossy(&self.body)))
    }
}

async fn request(
    port: u16,
    ca_der: &[u8],
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<&[u8]>,
) -> Reply {
    request_to("127.0.0.1", port, ca_der, method, path, headers, body).await
}

async fn request_to(
    host: &str,
    port: u16,
    ca_der: &[u8],
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<&[u8]>,
) -> Reply {
    let tcp = TcpStream::connect((host, port)).await.unwrap();
    let name = match host.parse::<std::net::IpAddr>() {
        Ok(ip) => ServerName::IpAddress(ip.into()),
        Err(_) => ServerName::try_from(host.to_string()).unwrap(),
    };
    let mut tls = TlsConnector::from(client_config(ca_der)).connect(name, tcp).await.expect("مصافحة TLS ناجحة بالثقة بالجذر");
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n");
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    if let Some(b) = body {
        req.push_str(&format!("Content-Length: {}\r\n", b.len()));
    }
    req.push_str("\r\n");
    tls.write_all(req.as_bytes()).await.unwrap();
    if let Some(b) = body {
        // الخادم قد يردّ ويُغلق قبل أن نُنهي كتابة جسم ضخم (413 المبكر) — سلوك صحيح؛
        // العميل الحقيقي (fetch) يقرأ الردّ رغم ذلك، فنفعل مثله هنا.
        let _ = tls.write_all(b).await;
    }
    let mut raw = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        match tls.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => raw.extend_from_slice(&buf[..n]),
            Err(_) => break,
        }
    }
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").expect("رأس HTTP");
    let head = String::from_utf8_lossy(&raw[..split]).to_string();
    let mut lines = head.lines();
    let status: u16 = lines.next().unwrap().split_whitespace().nth(1).unwrap().parse().unwrap();
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string()))
        .collect();
    Reply { status, headers, body: raw[split + 4..].to_vec() }
}

/// يحاكي واجهة JS: يردّ على كل طلب كتالوج من الجسر.
fn spawn_js_simulator(engine: &Engine, catalog: Value) -> tokio::task::JoinHandle<()> {
    let mut rx = engine.take_events_rx().unwrap();
    let bridge = engine.bridge();
    bridge.set_provider_ready(true);
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            if let BridgeEvent::CatalogRequest { id } = ev {
                bridge.provide(id, CatalogReply::Ok(catalog.clone()));
            }
        }
    })
}

fn catalog() -> Value {
    json!({
        "merchants": [{"id": 7, "name": "أحمد"}, {"id": 8, "name": "سعيد"}],
        "boxes": [{"id": 2, "name": "صندوق كبير", "weight": 1.8}]
    })
}

// ───────────────────────── الاختبار التكاملي الرئيسي ─────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn full_flow_over_real_tls() {
    let dir = tmp_dir("e2e");
    let (engine, port) = engine_on_free_port(&dir);
    let _sim = spawn_js_simulator(&engine, catalog());
    engine.start().unwrap();
    assert!(engine.is_running());
    let st = engine.status();
    assert_eq!(st.port, Some(port));
    assert!(!st.port_changed);
    let ca = engine.ca.cert_der.clone();
    let key = st.access_key.clone();
    let auth = format!("Bearer {key}");

    // ping بلا مفتاح
    let r = request(port, &ca, "GET", "/api/v1/ping", &[], None).await;
    assert_eq!(r.status, 200);
    assert_eq!(r.json()["api"], 1);
    assert_eq!(r.headers["access-control-allow-origin"], "*");

    // SAN: localhost أيضاً مقبول
    let r = request_to("localhost", port, &ca, "GET", "/api/v1/ping", &[], None).await;
    assert_eq!(r.status, 200);

    // بدون مفتاح / بمفتاح خاطئ
    assert_eq!(request(port, &ca, "GET", "/api/v1/catalog", &[], None).await.status, 401);
    assert_eq!(request(port, &ca, "GET", "/api/v1/catalog", &[("Authorization", "Bearer WRONGKEY")], None).await.status, 401);

    // كتالوج حي — ويقبل المفتاح بصيغة العرض (فواصل وأحرف صغيرة)
    let spaced = format!("Bearer {}", st.access_key_display.to_lowercase());
    let r = request(port, &ca, "GET", "/api/v1/catalog", &[("Authorization", spaced.as_str())], None).await;
    assert_eq!(r.status, 200);
    let j = r.json();
    assert_eq!(j["source"], "live");
    assert_eq!(j["stale"], false);
    assert_eq!(j["merchants"].as_array().unwrap().len(), 2);
    assert_eq!(j["boxes"][0]["weight"], 1.8);
    assert!(j["generatedAt"].is_string());

    // إرسال دفعة: صالحة + غير صالحة + صالحة
    let (u1, u2, u3) = (uid(101), uid(102), uid(103));
    let mut bad = invoice(&u2);
    bad["lines"] = json!([]);
    let batch = json!({"schema": 1, "deviceLabel": "هاتف المحل", "invoices": [invoice(&u1), bad, invoice(&u3)]});
    let body = serde_json::to_vec(&batch).unwrap();
    let r = request(port, &ca, "POST", "/api/v1/invoices", &[("Authorization", auth.as_str()), ("Content-Type", "application/json")], Some(&body)).await;
    assert_eq!(r.status, 200);
    let res = r.json()["results"].clone();
    assert_eq!(res[0]["status"], "pending");
    assert_eq!(res[1]["status"], "invalid");
    assert_eq!(res[2]["status"], "pending");
    assert_eq!(engine.store().list_inbox().len(), 2);

    // إعادة إرسال نفس الدفعة: لا تكرار
    let r = request(port, &ca, "POST", "/api/v1/invoices", &[("Authorization", auth.as_str())], Some(&body)).await;
    let res = r.json()["results"].clone();
    assert_eq!(res[0]["duplicate"], true);
    assert_eq!(engine.store().list_inbox().len(), 2, "لا نسخة ثانية");

    // اعتماد u1 على الكمبيوتر ثم استعلام الحالة من الهاتف
    engine.store().begin_save(&u1).unwrap();
    engine.store().mark_confirmed(&u1, 77, "2610-7-4", Some("أحمد".into()), Some(11890.0)).unwrap();
    let q = serde_json::to_vec(&json!({"uids": [u1, u3, uid(999), "not-a-uuid"]})).unwrap();
    let r = request(port, &ca, "POST", "/api/v1/invoices/status", &[("Authorization", auth.as_str())], Some(&q)).await;
    let res = r.json()["results"].clone();
    let by: HashMap<String, Value> = res.as_array().unwrap().iter().map(|x| (x["uid"].as_str().unwrap().to_string(), x.clone())).collect();
    assert_eq!(by[&u1]["status"], "confirmed");
    assert_eq!(by[&u1]["finalNumber"], "2610-7-4");
    assert_eq!(by[&u3]["status"], "pending");
    assert_eq!(by[&uid(999)]["status"], "unknown");
    assert_eq!(by["not-a-uuid"]["status"], "invalid");

    // أخطاء الطلب
    let hdr = [("Authorization", auth.as_str())];
    assert_eq!(request(port, &ca, "POST", "/api/v1/invoices", &hdr, Some(b"{oops")).await.status, 400);
    let wrong = serde_json::to_vec(&json!({"schema": 99, "invoices": []})).unwrap();
    let r = request(port, &ca, "POST", "/api/v1/invoices", &hdr, Some(&wrong)).await;
    assert_eq!((r.status, r.json()["error"]["code"].clone()), (400, json!("unsupported_schema")));
    let many: Vec<Value> = (0..101).map(|i| invoice(&uid(2000 + i))).collect();
    let big = serde_json::to_vec(&json!({"schema": 1, "invoices": many})).unwrap();
    assert_eq!(request(port, &ca, "POST", "/api/v1/invoices", &hdr, Some(&big)).await.status, 400);
    let huge = vec![b' '; MAX_BODY_BYTES + 10];
    assert_eq!(request(port, &ca, "POST", "/api/v1/invoices", &hdr, Some(&huge)).await.status, 413);
    assert_eq!(request(port, &ca, "DELETE", "/api/v1/invoices", &hdr, None).await.status, 405);
    assert_eq!(request(port, &ca, "GET", "/api/v1/nope", &hdr, None).await.status, 404);

    // CORS preflight
    let r = request(port, &ca, "OPTIONS", "/api/v1/invoices", &[("Origin", "https://192.168.1.5:47613"), ("Access-Control-Request-Method", "POST")], None).await;
    assert_eq!(r.status, 204);
    assert!(r.headers["access-control-allow-headers"].contains("authorization"));

    // الملفات الثابتة
    let r = request(port, &ca, "GET", "/", &[], None).await;
    assert_eq!(r.status, 200);
    assert!(r.headers["content-type"].starts_with("text/html"));
    assert!(r.headers["content-security-policy"].contains("default-src 'self'"));
    let etag = r.headers["etag"].clone();
    let r = request(port, &ca, "GET", "/", &[("If-None-Match", etag.as_str())], None).await;
    assert_eq!(r.status, 304);
    let r = request(port, &ca, "GET", "/sw.js", &[], None).await;
    assert_eq!(r.status, 200);
    let sw = String::from_utf8(r.body).unwrap();
    assert!(!sw.contains("__MKS_VERSION__") && !sw.contains("__MKS_PRECACHE__"), "{sw}");
    assert_eq!(request(port, &ca, "GET", "/%2e%2e/Cargo.toml", &[], None).await.status, 404);
    assert_eq!(request(port, &ca, "GET", "/..%5cCargo.toml", &[], None).await.status, 404);
    assert_eq!(request(port, &ca, "GET", "/nothing.js", &[], None).await.status, 404);
    assert_eq!(request(port, &ca, "POST", "/", &[], Some(b"x")).await.status, 405);

    // شهادة الجذر تُنزَّل بلا مفتاح وهي نفسها المثبَّتة
    let r = request(port, &ca, "GET", "/mks-local-ca.crt", &[], None).await;
    assert_eq!(r.status, 200);
    assert_eq!(r.headers["content-type"], "application/x-x509-ca-cert");
    assert_eq!(r.body, ca);

    // نسخة التنزيل العامة: نفس البايتات بنوع MIME عام (لا تعترضه متصفحات أندرويد كشهادة)
    let r = request(port, &ca, "GET", "/download/mks-local-ca.crt", &[], None).await;
    assert_eq!(r.status, 200);
    assert_eq!(r.headers["content-type"], "application/octet-stream");
    assert!(r.headers["content-disposition"].contains("mks-local-ca.crt"));
    assert_ne!(r.headers.get("cache-control").map(String::as_str), Some("no-store"), "no-store يربك مديري التنزيل");
    assert_eq!(r.body, ca);

    // الشهادة كنص JSON: يبني منها التطبيق الملف محلياً (جلب الصفحة يحترم استثناء الشهادة، بخلاف التنزيل)
    let r = request(port, &ca, "GET", "/api/v1/ca", &[], None).await;
    assert_eq!(r.status, 200, "بلا مفتاح وصول");
    assert_eq!(r.headers["access-control-allow-origin"], "*");
    let j = r.json();
    assert_eq!(j["filename"], "mks-local-ca.crt");
    assert_eq!(j["fingerprint"], st.ca_fingerprint);
    assert_eq!(j["derBase64"], b64::encode(&ca), "نفس بايتات ملف الشهادة تماماً");
    assert!(j["pem"].as_str().unwrap().starts_with("-----BEGIN CERTIFICATE-----"));
    assert!(!j.to_string().contains("PRIVATE"), "المفتاح الخاص لا يُكشف أبداً");
    assert_eq!(request(port, &ca, "POST", "/api/v1/ca", &[], Some(b"x")).await.status, 405);

    // تدوير المفتاح يُبطل القديم فوراً ويقبل الجديد
    engine.rotate_key().unwrap();
    assert_eq!(request(port, &ca, "GET", "/api/v1/catalog", &hdr, None).await.status, 401);
    let new_auth = format!("Bearer {}", engine.status().access_key);
    assert_eq!(request(port, &ca, "GET", "/api/v1/catalog", &[("Authorization", new_auth.as_str())], None).await.status, 200);

    // سجل الأنشطة يعكس ما حدث
    let kinds: Vec<String> = engine.status().events.iter().map(|e| e.kind.clone()).collect();
    for k in ["catalog", "submit", "status", "auth", "service"] {
        assert!(kinds.contains(&k.to_string()), "{k} ∉ {kinds:?}");
    }

    // إيقاف ثم تشغيل على نفس المنفذ
    engine.stop();
    assert!(!engine.is_running());
    assert!(TcpStream::connect(("127.0.0.1", port)).await.is_err(), "المنفذ أُغلق");
    engine.start().unwrap();
    assert_eq!(engine.status().port, Some(port), "المنفذ نفسه بعد إعادة التشغيل");
    assert_eq!(request(port, &ca, "GET", "/api/v1/ping", &[], None).await.status, 200);
    engine.stop();
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn catalog_fallbacks_snapshot_then_unavailable() {
    let dir = tmp_dir("cat");
    let (engine, port) = engine_on_free_port(&dir);
    engine.start().unwrap();
    let ca = engine.ca.cert_der.clone();
    let auth = format!("Bearer {}", engine.status().access_key);
    let a = [("Authorization", auth.as_str())];

    // لا مزوّد ولا نسخة: 503 بدل أي شيء مضلّل
    let r = request(port, &ca, "GET", "/api/v1/catalog", &a, None).await;
    assert_eq!(r.status, 503);
    assert_eq!(r.json()["error"]["code"], "catalog_unavailable");

    // نسخة منشورة لكن الواجهة لا تردّ: تُقدَّم النسخة موسومة قديمة
    assert!(engine.bridge().publish(json!({"nope": 1})).is_err(), "شكل غير صالح مرفوض");
    engine.bridge().publish(catalog()).unwrap();
    let r = request(port, &ca, "GET", "/api/v1/catalog", &a, None).await;
    assert_eq!(r.status, 200);
    let j = r.json();
    assert_eq!((j["source"].clone(), j["stale"].clone()), (json!("snapshot"), json!(true)));

    // مزوّد جاهز لكنه صامت: ننتظر المهلة ثم نقدّم النسخة، وبعدها لا ننتظر مجدداً
    engine.bridge().set_provider_ready(true);
    let t = std::time::Instant::now();
    let r = request(port, &ca, "GET", "/api/v1/catalog", &a, None).await;
    assert_eq!(r.json()["source"], "snapshot");
    assert!(t.elapsed().as_millis() >= (CATALOG_PULL_WAIT_MS as u128) - 200);
    let t = std::time::Instant::now();
    let r = request(port, &ca, "GET", "/api/v1/catalog", &a, None).await;
    assert_eq!(r.json()["source"], "snapshot");
    assert!(t.elapsed().as_millis() < 1000, "بعد الإخفاق لا انتظار");

    // خطأ قراءة قاعدة البيانات من الواجهة → النسخة المحفوظة مع ملاحظة
    let mut rx = engine.take_events_rx().unwrap();
    let bridge = engine.bridge();
    bridge.set_provider_ready(true);
    let h = tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            if let BridgeEvent::CatalogRequest { id } = ev {
                bridge.provide(id, CatalogReply::Err("تعذّرت القراءة".into()));
            }
        }
    });
    let r = request(port, &ca, "GET", "/api/v1/catalog", &a, None).await;
    let j = r.json();
    assert_eq!(j["source"], "snapshot");
    assert_eq!(j["note"], "تعذّرت القراءة");
    h.abort();
    engine.stop();
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn wrong_key_flood_is_throttled_and_plain_http_is_diagnosed() {
    let dir = tmp_dir("thr");
    let (engine, port) = engine_on_free_port(&dir);
    engine.start().unwrap();
    let ca = engine.ca.cert_der.clone();
    let good = format!("Bearer {}", engine.status().access_key);
    for _ in 0..(THROTTLE_MAX_FAILURES) {
        let r = request(port, &ca, "GET", "/api/v1/catalog", &[("Authorization", "Bearer 0000000000000000")], None).await;
        assert_eq!(r.status, 401);
    }
    let r = request(port, &ca, "GET", "/api/v1/catalog", &[("Authorization", good.as_str())], None).await;
    assert_eq!(r.status, 429);
    assert!(r.headers.contains_key("retry-after"));
    // الملفات الثابتة والـping لا يتأثران بالحظر
    assert_eq!(request(port, &ca, "GET", "/api/v1/ping", &[], None).await.status, 200);

    // http عادي على منفذ https → حدث تشخيصي واضح
    let mut tcp = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    tcp.write_all(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n").await.unwrap();
    let mut sink = Vec::new();
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), tcp.read_to_end(&mut sink)).await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert!(engine.status().events.iter().any(|e| e.kind == "tls"), "{:?}", engine.status().events);
    engine.stop();
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lan_ip_in_san_is_trusted_without_new_install() {
    let ips = netinfo::list_local_ipv4();
    let Some(first) = ips.first() else {
        eprintln!("لا توجد عناوين خاصة في هذه البيئة — تخطّي");
        return;
    };
    let dir = tmp_dir("lan");
    let (engine, port) = engine_on_free_port(&dir);
    engine.start().unwrap();
    let ca = engine.ca.cert_der.clone();
    let host = first.ip.to_string();
    let r = request_to(&host, port, &ca, "GET", "/api/v1/ping", &[], None).await;
    assert_eq!(r.status, 200, "الشهادة تغطي عنوان الشبكة {host}");
    let st = engine.status();
    assert!(st.addresses.iter().any(|a| a.ip == host && a.qr_svg.contains("<svg")));
    assert!(st.addresses[0].recommended);
    engine.stop();
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn port_in_use_falls_back_and_reports_it() {
    let dir = tmp_dir("port");
    let (engine, port) = engine_on_free_port(&dir);
    let _hog = std::net::TcpListener::bind(("0.0.0.0", port)).unwrap();
    engine.start().unwrap();
    let st = engine.status();
    assert!(st.port_changed);
    assert!(st.port.unwrap() > port);
    engine.stop();
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn export_ca_writes_installable_file() {
    let dir = tmp_dir("export");
    let engine = Engine::new(dir.clone()).unwrap();
    let out = dir.join("Downloads");
    let path = engine.export_ca(&out).unwrap();
    assert_eq!(path.file_name().unwrap(), "mks-local-ca.crt");
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(bytes, engine.ca.cert_der, "DER مطابق لما يخدمه الخادم");
    assert_eq!(bytes[0], 0x30, "بداية DER صحيحة (SEQUENCE)");
    // إعادة التصدير تستبدل الملف بلا خطأ
    assert!(engine.export_ca(&out).is_ok());
    assert!(engine.events().recent(5).iter().any(|e| e.message.contains("صُدِّر")));
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn engine_restart_keeps_ca_key_and_pending_invoices() {
    let dir = tmp_dir("persist");
    let (e1, port) = engine_on_free_port(&dir);
    let fp1 = e1.status().ca_fingerprint;
    let key1 = e1.status().access_key;
    e1.start().unwrap();
    let ca = e1.ca.cert_der.clone();
    let auth = format!("Bearer {key1}");
    let body = serde_json::to_vec(&json!({"schema": 1, "invoices": [invoice(&uid(500))]})).unwrap();
    let r = request(port, &ca, "POST", "/api/v1/invoices", &[("Authorization", auth.as_str())], Some(&body)).await;
    assert_eq!(r.json()["results"][0]["status"], "pending");
    drop(e1); // إغلاق التطبيق فجأة (Drop يوقف الخدمة)

    let e2 = Engine::new(dir.clone()).unwrap();
    assert_eq!(e2.status().ca_fingerprint, fp1, "نفس الشهادة — لا حاجة لإعادة تثبيتها على الهاتف");
    assert_eq!(e2.status().access_key, key1, "نفس المفتاح — QR القديم ما زال صالحاً");
    assert_eq!(e2.store().list_inbox().len(), 1, "الفاتورة المعلّقة لم تضِع");
    let _ = std::fs::remove_dir_all(dir);
}
