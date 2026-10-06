// واجهة HTTP للخدمة المحلية. كل طلب مستقل بذاته: لا جلسات، لا رموز مرتبطة بهاتف،
// لا حالة اتصال. المصادقة = مفتاح الوصول (سرّ مشترك يحمله QR) يُرسَل مع كل طلب.
//
//   GET  /api/v1/ping             بلا مفتاح — اختبار الوصول فقط
//   GET  /api/v1/catalog          التجار + الصناديق النشطة (عملية "الحصول على البيانات")
//   POST /api/v1/invoices         دفعة فواتير جديدة      (عملية "إرسال الفواتير")
//   POST /api/v1/invoices/status  حالة فواتير معروفة بمعرّفاتها (يتحقق منها الهاتف لاحقاً)
//   GET  /api/v1/ca               شهادة الجذر العامة كنص (base64) — يبني منه التطبيق الملف محلياً (بلا مفتاح)
//   GET  /mks-local-ca.crt        شهادة الجذر بنوعها الرسمي (آيفون يحتاجه لعرض «تثبيت الملف الشخصي»)
//   GET  /download/mks-local-ca.crt  نفس البايتات بنوع MIME عام (بديل لأندرويد)
//
// لماذا ثلاث طرق لشهادة واحدة؟ قبل أن يثق الهاتف بالشهادة لا يمكنه الوثوق بالاتصال الذي
// سيُنزِّلها منه (مشكلة البيضة والدجاجة). تنزيل الملفات في متصفحات أندرويد يمرّ بمدير تنزيلات
// لا يشارك استثناء «المتابعة رغم التحذير» الذي ضغطه المستخدم، فيفشل بعد أن يبدأ. أما طلبات
// الصفحة نفسها (fetch) فتحترم الاستثناء — لذلك يجلب التطبيق الشهادة بـ fetch من /api/v1/ca
// ويحفظها من الذاكرة (Blob)، بلا أي تنزيل شبكي.
//   GET  /، /sw.js، ...           ملفات تطبيق الهاتف (بلا مفتاح؛ لا تحوي أي بيانات)

use super::assets;
use super::bridge::{BridgeEvent, CatalogBridge, CatalogResult};
use super::config::{keys_equal, normalize_key};
use super::consts::*;
use super::events::EventLog;
use super::fsutil::now_rfc3339;
use super::store::{Receipt, Store};
use super::throttle::Throttle;
use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Incoming;
use hyper::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use hyper::{Method, Request, Response, StatusCode};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::convert::Infallible;
use std::net::IpAddr;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

pub type Resp = Response<Full<Bytes>>;

pub struct Ctx {
    pub key: RwLock<String>,
    pub store: Arc<Store>,
    pub bridge: Arc<CatalogBridge>,
    pub events: Arc<EventLog>,
    pub throttle: Throttle,
    pub ca_der: Vec<u8>,
    ca_b64: String,
    ca_pem: String,
    pub ca_fingerprint: String,
    ca_not_after: String,
    pub tx: mpsc::UnboundedSender<BridgeEvent>,
    tls_notes: Mutex<HashMap<IpAddr, Instant>>,
}

impl Ctx {
    pub fn new(
        key: String,
        store: Arc<Store>,
        bridge: Arc<CatalogBridge>,
        events: Arc<EventLog>,
        ca_der: Vec<u8>,
        ca_pem: String,
        ca_fingerprint: String,
        ca_not_after: String,
        tx: mpsc::UnboundedSender<BridgeEvent>,
    ) -> Ctx {
        Ctx {
            key: RwLock::new(key),
            store,
            bridge,
            events,
            throttle: Throttle::default(),
            ca_b64: super::b64::encode(&ca_der),
            ca_der,
            ca_pem,
            ca_fingerprint,
            ca_not_after,
            tx,
            tls_notes: Mutex::new(HashMap::new()),
        }
    }

    pub fn set_key(&self, key: String) {
        *self.key.write().unwrap_or_else(|e| e.into_inner()) = key;
    }

    /// يسجّل (مرة كل دقيقة لكل عنوان) أن اتصالاً فشلت مصافحة TLS فيه — غالباً لأن
    /// الهاتف لم يثبّت شهادة الجذر بعد؛ هذا أهم دليل تشخيصي للمستخدم على الكمبيوتر.
    pub fn note_tls_failure(&self, ip: IpAddr, err: &std::io::Error) {
        let now = Instant::now();
        {
            let mut m = self.tls_notes.lock().unwrap_or_else(|e| e.into_inner());
            if m.len() > 500 {
                m.retain(|_, t| now.duration_since(*t) < Duration::from_secs(60));
            }
            if let Some(t) = m.get(&ip) {
                if now.duration_since(*t) < Duration::from_secs(60) {
                    return;
                }
            }
            m.insert(ip, now);
        }
        let rustls_err = err.get_ref().and_then(|i| i.downcast_ref::<rustls::Error>());
        let msg = match rustls_err {
            Some(rustls::Error::AlertReceived(_)) => {
                "رفض الهاتف شهادة الأمان — ثبّت شهادة MKS على الهاتف (انظر دليل الإعداد)"
            }
            Some(rustls::Error::InvalidMessage(_)) => {
                "محاولة اتصال بدون تشفير — يجب فتح العنوان بـ https:// وليس http://"
            }
            _ if err.kind() == std::io::ErrorKind::UnexpectedEof => {
                "اتصال أُغلق قبل اكتمال التشفير — غالباً الهاتف لا يثق بشهادة MKS بعد"
            }
            _ => "تعذّرت مصافحة التشفير مع جهاز على الشبكة",
        };
        self.events.push("tls", Some(ip.to_string()), msg);
        let _ = self.tx.send(BridgeEvent::StatusChanged);
    }
}

// ───────────────────────── مساعدات الاستجابة ─────────────────────────

fn with_headers(mut r: Resp, pairs: &[(&'static str, &str)]) -> Resp {
    for (k, v) in pairs {
        if let Ok(val) = HeaderValue::from_str(v) {
            r.headers_mut().insert(*k, val);
        }
    }
    r
}

fn json_resp(status: StatusCode, v: Value) -> Resp {
    let body = serde_json::to_vec(&v).unwrap_or_else(|_| b"{}".to_vec());
    let mut r = Response::new(Full::new(Bytes::from(body)));
    *r.status_mut() = status;
    with_headers(
        r,
        &[
            ("content-type", "application/json; charset=utf-8"),
            ("cache-control", "no-store"),
            ("x-content-type-options", "nosniff"),
        ],
    )
}

fn err_resp(status: StatusCode, code: &str, message: &str) -> Resp {
    json_resp(status, json!({ "ok": false, "error": { "code": code, "message": message } }))
}

fn cors(r: Resp) -> Resp {
    with_headers(
        r,
        &[
            ("access-control-allow-origin", "*"),
            ("access-control-expose-headers", "retry-after"),
        ],
    )
}

fn preflight() -> Resp {
    let mut r = Response::new(Full::new(Bytes::new()));
    *r.status_mut() = StatusCode::NO_CONTENT;
    with_headers(
        r,
        &[
            ("access-control-allow-origin", "*"),
            ("access-control-allow-methods", "GET, POST, OPTIONS"),
            ("access-control-allow-headers", "authorization, content-type, x-mks-key"),
            ("access-control-allow-private-network", "true"),
            ("access-control-max-age", "600"),
        ],
    )
}

// ───────────────────────── المصادقة وقراءة الجسم ─────────────────────────

fn extract_key(h: &HeaderMap) -> Option<String> {
    if let Some(v) = h.get("authorization").and_then(|v| v.to_str().ok()) {
        let v = v.trim();
        if v.len() > 7 && v[..7].eq_ignore_ascii_case("bearer ") {
            return Some(v[7..].trim().to_string());
        }
    }
    h.get("x-mks-key").and_then(|v| v.to_str().ok()).map(|s| s.trim().to_string())
}

fn authorize(ctx: &Ctx, peer: IpAddr, h: &HeaderMap) -> Result<(), Resp> {
    if let Err(wait) = ctx.throttle.check(peer) {
        let r = err_resp(StatusCode::TOO_MANY_REQUESTS, "throttled", "محاولات خاطئة كثيرة — انتظر قليلاً ثم أعد المحاولة");
        return Err(with_headers(r, &[("retry-after", &wait.to_string())]));
    }
    let provided = extract_key(h).map(|k| normalize_key(&k)).unwrap_or_default();
    let current = ctx.key.read().unwrap_or_else(|e| e.into_inner()).clone();
    if !provided.is_empty() && keys_equal(&provided, &current) {
        ctx.throttle.record_success(peer);
        return Ok(());
    }
    let locked = ctx.throttle.record_failure(peer);
    if locked {
        ctx.events.push("auth", Some(peer.to_string()), "محاولات متكررة بمفتاح وصول خاطئ — حُظر العنوان دقيقة واحدة");
        let _ = ctx.tx.send(BridgeEvent::StatusChanged);
    } else {
        ctx.events.push("auth", Some(peer.to_string()), "طلب بمفتاح وصول غير صحيح (امسح رمز QR من جديد)");
    }
    Err(err_resp(StatusCode::UNAUTHORIZED, "unauthorized", "مفتاح الوصول غير صحيح"))
}

async fn read_body(req: Request<Incoming>) -> Result<Bytes, Resp> {
    if let Some(len) = req
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<usize>().ok())
    {
        if len > MAX_BODY_BYTES {
            return Err(err_resp(StatusCode::PAYLOAD_TOO_LARGE, "too_large", "حجم الطلب كبير جداً"));
        }
    }
    let limited = Limited::new(req.into_body(), MAX_BODY_BYTES);
    match tokio::time::timeout(Duration::from_secs(30), limited.collect()).await {
        Ok(Ok(c)) => Ok(c.to_bytes()),
        Ok(Err(e)) => {
            if e.downcast_ref::<http_body_util::LengthLimitError>().is_some() {
                Err(err_resp(StatusCode::PAYLOAD_TOO_LARGE, "too_large", "حجم الطلب كبير جداً"))
            } else {
                Err(err_resp(StatusCode::BAD_REQUEST, "bad_body", "تعذّرت قراءة الطلب"))
            }
        }
        Err(_) => Err(err_resp(StatusCode::REQUEST_TIMEOUT, "timeout", "انتهت مهلة استلام الطلب")),
    }
}

fn clean_label(v: Option<&Value>) -> Option<String> {
    let s = v?.as_str()?.trim();
    if s.is_empty() || s.chars().any(|c| c.is_control()) {
        return None;
    }
    Some(s.chars().take(60).collect())
}

// ───────────────────────── نقاط النهاية ─────────────────────────

fn ping(ctx: &Ctx) -> Resp {
    json_resp(
        StatusCode::OK,
        json!({
            "ok": true,
            "app": "mks-phone-sync",
            "api": API_VERSION,
            "schema": SCHEMA_VERSION,
            "serverTime": now_rfc3339(),
            "caFingerprint": ctx.ca_fingerprint,
        }),
    )
}

/// الشهادة العامة كنص: لا سرّ فيها (المفتاح الخاص لا يغادر الكمبيوتر أبداً)، فلا تحتاج مصادقة.
fn ca_info(ctx: &Ctx) -> Resp {
    json_resp(
        StatusCode::OK,
        json!({
            "ok": true,
            "filename": "mks-local-ca.crt",
            "fingerprint": ctx.ca_fingerprint,
            "notAfter": ctx.ca_not_after,
            "derBase64": ctx.ca_b64,
            "pem": ctx.ca_pem,
        }),
    )
}

async fn catalog(ctx: &Ctx, peer: IpAddr) -> Resp {
    let result = ctx.bridge.request(Duration::from_millis(CATALOG_PULL_WAIT_MS)).await;
    let (catalog, at, source, note) = match result {
        CatalogResult::Live { catalog, at } => (catalog, at, "live", None),
        CatalogResult::Snapshot { catalog, at, note } => (catalog, at, "snapshot", note),
        CatalogResult::Unavailable(msg) => {
            ctx.events.push("catalog", Some(peer.to_string()), format!("طلب بيانات تعذّر: {msg}"));
            let _ = ctx.tx.send(BridgeEvent::StatusChanged);
            return err_resp(StatusCode::SERVICE_UNAVAILABLE, "catalog_unavailable", &msg);
        }
    };
    let merchants = catalog.get("merchants").cloned().unwrap_or_else(|| json!([]));
    let boxes = catalog.get("boxes").cloned().unwrap_or_else(|| json!([]));
    let n_m = merchants.as_array().map_or(0, |a| a.len());
    let n_b = boxes.as_array().map_or(0, |a| a.len());
    ctx.events.push(
        "catalog",
        Some(peer.to_string()),
        format!(
            "أُرسلت البيانات إلى هاتف: {n_m} تاجر و{n_b} صندوق{}",
            if source == "snapshot" { " (نسخة محفوظة — واجهة الكمبيوتر لم تردّ)" } else { "" }
        ),
    );
    let _ = ctx.tx.send(BridgeEvent::StatusChanged);
    json_resp(
        StatusCode::OK,
        json!({
            "ok": true,
            "api": API_VERSION,
            "source": source,
            "stale": source == "snapshot",
            "note": note,
            "generatedAt": at,
            "merchants": merchants,
            "boxes": boxes,
        }),
    )
}

async fn submit(ctx: &Ctx, peer: IpAddr, req: Request<Incoming>) -> Resp {
    let body = match read_body(req).await {
        Ok(b) => b,
        Err(r) => return r,
    };
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return err_resp(StatusCode::BAD_REQUEST, "bad_json", "صيغة JSON غير صالحة"),
    };
    if parsed.get("schema").and_then(|v| v.as_u64()) != Some(SCHEMA_VERSION as u64) {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "unsupported_schema",
            "نسخة تطبيق الهاتف لا تطابق نسخة الكمبيوتر — حدّث تطبيق الهاتف (افتحه وأنت متصل بالكمبيوتر)",
        );
    }
    let label = clean_label(parsed.get("deviceLabel"));
    let items: Vec<Value> = match parsed.get("invoices").and_then(|v| v.as_array()) {
        Some(a) => a.clone(),
        None => return err_resp(StatusCode::BAD_REQUEST, "bad_request", "قائمة الفواتير مفقودة"),
    };
    if items.len() > MAX_INVOICES_PER_REQUEST {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "too_many_invoices",
            "عدد الفواتير في الدفعة الواحدة كبير — أرسلها على دفعات",
        );
    }
    let total = items.len();
    let store = ctx.store.clone();
    let ip = peer.to_string();
    let joined = tokio::task::spawn_blocking(move || store.submit(items, label, Some(ip))).await;
    let outcome = match joined {
        Ok(o) => o,
        Err(_) => return err_resp(StatusCode::INTERNAL_SERVER_ERROR, "internal", "خطأ داخلي أثناء حفظ الفواتير"),
    };
    let invalid = outcome.receipts.iter().filter(|r| r.status == "invalid").count();
    let errors = outcome.receipts.iter().filter(|r| r.status == "error").count();
    let mut msg = format!("استُلمت {} فاتورة جديدة من أصل {} مرسلة", outcome.new_count, total);
    if invalid > 0 {
        msg.push_str(&format!(" — {invalid} غير صالحة"));
    }
    if errors > 0 {
        msg.push_str(&format!(" — {errors} تعذّر حفظها"));
    }
    ctx.events.push("submit", Some(peer.to_string()), msg);
    if outcome.new_count > 0 {
        let _ = ctx.tx.send(BridgeEvent::InboxChanged);
    }
    let _ = ctx.tx.send(BridgeEvent::StatusChanged);
    json_resp(StatusCode::OK, json!({ "ok": true, "api": API_VERSION, "results": outcome.receipts }))
}

async fn status(ctx: &Ctx, peer: IpAddr, req: Request<Incoming>) -> Resp {
    let body = match read_body(req).await {
        Ok(b) => b,
        Err(r) => return r,
    };
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return err_resp(StatusCode::BAD_REQUEST, "bad_json", "صيغة JSON غير صالحة"),
    };
    let Some(arr) = parsed.get("uids").and_then(|v| v.as_array()) else {
        return err_resp(StatusCode::BAD_REQUEST, "bad_request", "قائمة المعرّفات مفقودة");
    };
    if arr.len() > MAX_STATUS_IDS {
        return err_resp(StatusCode::BAD_REQUEST, "too_many", "عدد المعرّفات كبير");
    }
    let mut valid: Vec<String> = Vec::with_capacity(arr.len());
    let mut results: Vec<Receipt> = Vec::new();
    for v in arr {
        match v.as_str() {
            Some(s) if super::store::is_uuid(s) => valid.push(s.to_string()),
            _ => results.push(Receipt {
                uid: v.as_str().unwrap_or("").chars().take(64).collect(),
                status: "invalid".into(),
                duplicate: false,
                content_changed: false,
                final_number: None,
                reason: None,
                code: Some("bad_uid".into()),
                message: Some("معرّف غير صالح".into()),
            }),
        }
    }
    results.extend(ctx.store.status(&valid));
    ctx.events.push("status", Some(peer.to_string()), format!("استعلام عن حالة {} فاتورة", arr.len()));
    json_resp(StatusCode::OK, json!({ "ok": true, "api": API_VERSION, "results": results }))
}

// ───────────────────────── الملفات الثابتة ─────────────────────────

const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src https:; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

fn static_resp(ctx: &Ctx, method: &Method, path: &str, headers: &HeaderMap) -> Resp {
    if path == "/mks-local-ca.crt" || path == "/download/mks-local-ca.crt" {
        // الأول بنوع الشهادات الرسمي (لآيفون)، والثاني بنوع عام: بعض متصفحات أندرويد تعترض
        // النوع الرسمي وتحاول تسليمه لمثبّت الشهادات فتفشل (أندرويد 11+ يمنع ذلك).
        let mime = if path == "/mks-local-ca.crt" { "application/x-x509-ca-cert" } else { "application/octet-stream" };
        let mut r = Response::new(Full::new(if *method == Method::HEAD {
            Bytes::new()
        } else {
            Bytes::from(ctx.ca_der.clone())
        }));
        *r.status_mut() = StatusCode::OK;
        return with_headers(
            r,
            &[
                ("content-type", mime),
                ("content-disposition", "attachment; filename=\"mks-local-ca.crt\""),
                ("cache-control", "no-cache"),
                ("x-content-type-options", "nosniff"),
            ],
        );
    }
    let asset = if !assets::has_app() && (path == "/" || path == "/index.html") {
        None
    } else {
        assets::get(path)
    };
    let Some(asset) = asset else {
        if !assets::has_app() && (path == "/" || path == "/index.html") {
            let mut r = Response::new(Full::new(Bytes::from_static(assets::MISSING_APP_HTML.as_bytes())));
            *r.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
            return with_headers(r, &[("content-type", "text/html; charset=utf-8"), ("cache-control", "no-store")]);
        }
        let mut r = Response::new(Full::new(Bytes::from_static(b"Not found")));
        *r.status_mut() = StatusCode::NOT_FOUND;
        return with_headers(r, &[("content-type", "text/plain; charset=utf-8"), ("cache-control", "no-store")]);
    };
    if headers.get("if-none-match").and_then(|v| v.to_str().ok()) == Some(asset.etag.as_str()) {
        let mut r = Response::new(Full::new(Bytes::new()));
        *r.status_mut() = StatusCode::NOT_MODIFIED;
        return with_headers(r, &[("etag", &asset.etag), ("cache-control", "no-cache")]);
    }
    let is_html = asset.mime.starts_with("text/html");
    let body = if *method == Method::HEAD { Bytes::new() } else { Bytes::from(asset.bytes.into_owned()) };
    let mut r = Response::new(Full::new(body));
    *r.status_mut() = StatusCode::OK;
    let r = with_headers(
        r,
        &[
            ("content-type", asset.mime),
            ("etag", &asset.etag),
            // no-cache = "أعد التحقق دائماً" (ETag) — والعمل دون اتصال تتكفّل به Service Worker.
            ("cache-control", "no-cache"),
            ("x-content-type-options", "nosniff"),
            ("referrer-policy", "no-referrer"),
        ],
    );
    if is_html {
        with_headers(r, &[("content-security-policy", CSP)])
    } else if path == "/sw.js" {
        with_headers(r, &[("service-worker-allowed", "/")])
    } else {
        r
    }
}

// ───────────────────────── التوجيه ─────────────────────────

pub async fn handle(ctx: Arc<Ctx>, peer: IpAddr, req: Request<Incoming>) -> Result<Resp, Infallible> {
    Ok(route(&ctx, peer, req).await)
}

async fn route(ctx: &Ctx, peer: IpAddr, req: Request<Incoming>) -> Resp {
    let method = req.method().clone();
    let path = req.uri().path().to_string();

    if path.starts_with("/api/") {
        if method == Method::OPTIONS {
            return preflight();
        }
        let resp = match (method.clone(), path.as_str()) {
            (Method::GET, "/api/v1/ping") => ping(ctx),
            (Method::GET, "/api/v1/ca") => ca_info(ctx),
            (Method::GET, "/api/v1/catalog") => match authorize(ctx, peer, req.headers()) {
                Ok(()) => catalog(ctx, peer).await,
                Err(r) => r,
            },
            (Method::POST, "/api/v1/invoices") => match authorize(ctx, peer, req.headers()) {
                Ok(()) => submit(ctx, peer, req).await,
                Err(r) => r,
            },
            (Method::POST, "/api/v1/invoices/status") => match authorize(ctx, peer, req.headers()) {
                Ok(()) => status(ctx, peer, req).await,
                Err(r) => r,
            },
            (_, "/api/v1/ping" | "/api/v1/ca" | "/api/v1/catalog" | "/api/v1/invoices" | "/api/v1/invoices/status") => {
                err_resp(StatusCode::METHOD_NOT_ALLOWED, "method_not_allowed", "طريقة الطلب غير مسموحة")
            }
            _ => err_resp(StatusCode::NOT_FOUND, "not_found", "المسار غير موجود"),
        };
        return cors(resp);
    }

    if method != Method::GET && method != Method::HEAD {
        let mut r = Response::new(Full::new(Bytes::from_static(b"Method not allowed")));
        *r.status_mut() = StatusCode::METHOD_NOT_ALLOWED;
        return with_headers(r, &[("content-type", "text/plain; charset=utf-8")]);
    }
    let mut r = static_resp(ctx, &method, &path, req.headers());
    if r.headers().get(CONTENT_TYPE).is_none() {
        r = with_headers(r, &[("content-type", "application/octet-stream")]);
    }
    r
}
