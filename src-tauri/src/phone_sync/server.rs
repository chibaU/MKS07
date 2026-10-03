// ============================================================================
// خادم المزامنة المحلي (HTTPS) — كل الاتصالات قصيرة ومستقلة (المتطلب 4/23):
//   • لا Session، لا WebSocket، لا Heartbeat. كل طلب يحمل مفتاح الوصول ويُجاب
//     ثم ينتهي. الكمبيوتر لا يتذكر «هاتفاً متصلاً».
//   • GET  /api/v1/bootstrap        ← الهاتف يطلب التجار والصناديق النشطة
//   • POST /api/v1/invoices         ← الهاتف يرسل فواتير جاهزة (آمن للتكرار)
//   • POST /api/v1/invoices/status  ← الهاتف يسأل: هل أُكِّدت فواتيري؟
// الفاتورة لا تدخل SQLite هنا إطلاقاً؛ تُحفَظ Pending فقط (store.rs).
//
// منفذ HTTP ثانٍ (setup) يخدم فقط صفحة تعليمات + الشهادة الجذرية العامة
// /ca.crt — بلا أي API وبلا أي بيانات — لأن الهاتف لا يستطيع الوثوق بـ HTTPS
// قبل تثبيت هذه الشهادة. لا يُستخدَم لأي شيء آخر (قرار HTTPS نهائي).
// ============================================================================

use super::dto::Snapshot;
use super::store::{self, InsertOutcome, InvoiceRecord, Status, Store};
use super::web_assets;
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use axum_server::{tls_rustls::RustlsConfig, Handle};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    future::Future,
    net::{SocketAddr, TcpListener},
    pin::Pin,
    sync::{Arc, RwLock},
    time::Duration,
};

pub const PROTOCOL_VERSION: u32 = 1;
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
const MAX_INVOICES_PER_REQUEST: usize = 300;
const MAX_LINES_PER_INVOICE: usize = 500;
const MAX_BOXES_PER_LINE: usize = 100;
const MAX_STATUS_IDS: usize = 1000;

pub type SnapshotFuture = Pin<Box<dyn Future<Output = Result<(Snapshot, bool), String>> + Send>>;
/// يجلب لقطة التجار/الصناديق الحالية. القيمة الثانية: stale = true إن كانت من
/// ذاكرة مؤقتة قديمة لأن واجهة التطبيق لم تُجب في الوقت المناسب.
pub type SnapshotFn = Arc<dyn Fn() -> SnapshotFuture + Send + Sync>;

pub struct Ctx {
    pub store: Arc<Store>,
    pub key: Arc<RwLock<String>>,
    pub snapshot: SnapshotFn,
    pub ca_pem: String,
    pub ca_fingerprint: String,
    pub https_port: u16,
    pub on_received: Arc<dyn Fn(usize) + Send + Sync>,
}

// ───────────────────────── مساعدات الاستجابة ─────────────────────────

fn json_response(status: StatusCode, v: Value) -> Response {
    let mut r = (status, Json(v)).into_response();
    r.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

fn api_error(status: StatusCode, code: &str, message: &str) -> Response {
    json_response(status, json!({ "ok": false, "error": code, "message": message }))
}

fn authorized(ctx: &Ctx, headers: &HeaderMap) -> bool {
    let Some(value) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let Some(token) = value.strip_prefix("Bearer ") else {
        return false;
    };
    let Ok(key) = ctx.key.read() else {
        return false;
    };
    constant_time_eq(token.as_bytes(), key.as_bytes())
}

/// مقارنة بزمن ثابت: نقارن بصمتي SHA-256 للقيمتين (طول موحَّد) فلا يُسرَّب طول
/// المفتاح ولا موضع أول اختلاف.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let ha = Sha256::digest(a);
    let hb = Sha256::digest(b);
    ha.iter().zip(hb.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn unauthorized() -> Response {
    api_error(
        StatusCode::UNAUTHORIZED,
        "unauthorized",
        "مفتاح الوصول غير صحيح — امسح رمز QR من برنامج الكمبيوتر مرة أخرى.",
    )
}

// CORS: مطلوب لأن الـ PWA قد تعمل من عنوان الكمبيوتر القديم (Origin مختلف) بعد أن
// يغيّر الراوتر عنوانه، فتتصل بالعنوان الجديد (راجع AI_CONTEXT.md القسم 10).
// آمن لأن المصادقة بمفتاح في الترويسة، لا بملفات تعريف ارتباط.
fn add_cors(headers: &mut HeaderMap) {
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("authorization, content-type"),
    );
    headers.insert(header::ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("600"));
}

async fn cors_layer(req: Request, next: Next) -> Response {
    if req.method() == Method::OPTIONS {
        let mut r = Response::new(Body::empty());
        *r.status_mut() = StatusCode::NO_CONTENT;
        add_cors(r.headers_mut());
        r.headers_mut().insert(
            "access-control-allow-private-network",
            HeaderValue::from_static("true"),
        );
        return r;
    }
    let mut r = next.run(req).await;
    add_cors(r.headers_mut());
    r.headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    r
}

// ───────────────────────── التحقق البنيوي من الفاتورة ─────────────────────────
// فحص «شكل» فقط (أنواع وحدود معقولة) ليُحفَظ في Pending. أما التحقق الحقيقي
// (التاجر موجود؟ الصناديق؟ الوزن الصافي؟) فيتم على الكمبيوتر وقت المراجعة
// ببيانات القاعدة الحالية (المتطلبان 12 و14) — لا هنا.

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn num_in(v: &Value, key: &str, min: f64, max: f64) -> bool {
    v.get(key)
        .and_then(Value::as_f64)
        .is_some_and(|n| n.is_finite() && n >= min && n <= max)
}

fn int_in(v: &Value, key: &str, min: i64, max: i64) -> bool {
    v.get(key)
        .and_then(Value::as_i64)
        .is_some_and(|n| n >= min && n <= max)
}

/// يعيد معرّف الفاتورة إن كان شكلها سليماً، أو سبب الرفض.
pub fn validate_invoice_shape(v: &Value) -> Result<String, String> {
    let obj = v.as_object().ok_or("الفاتورة ليست كائناً")?;
    let id = obj
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| store::is_valid_client_id(s))
        .ok_or("معرّف الفاتورة غير صالح")?;
    if !obj
        .get("invoiceDate")
        .and_then(Value::as_str)
        .is_some_and(is_date)
    {
        return Err("تاريخ الفاتورة غير صالح".into());
    }
    if !int_in(v, "merchantId", 1, i64::MAX / 2) {
        return Err("التاجر غير محدَّد".into());
    }
    let lines = obj
        .get("lines")
        .and_then(Value::as_array)
        .filter(|l| !l.is_empty() && l.len() <= MAX_LINES_PER_INVOICE)
        .ok_or("الفاتورة بلا بنود (أو عدد البنود غير معقول)")?;
    for (i, line) in lines.iter().enumerate() {
        let n = i + 1;
        let name_ok = line
            .get("productName")
            .and_then(Value::as_str)
            .is_some_and(|s| !s.trim().is_empty() && s.chars().count() <= 200);
        if !name_ok {
            return Err(format!("البند {n}: اسم المنتج غير صالح"));
        }
        if !num_in(line, "scaleWeight", 0.0, 10_000_000.0) {
            return Err(format!("البند {n}: وزن الميزان غير صالح"));
        }
        if !num_in(line, "price", 0.0, 1_000_000_000.0) {
            return Err(format!("البند {n}: السعر غير صالح"));
        }
        let boxes = line
            .get("boxes")
            .and_then(Value::as_array)
            .filter(|b| b.len() <= MAX_BOXES_PER_LINE)
            .ok_or_else(|| format!("البند {n}: قائمة الصناديق غير صالحة"))?;
        for b in boxes {
            if !int_in(b, "boxId", 1, i64::MAX / 2) || !int_in(b, "boxCount", 1, 1_000_000) {
                return Err(format!("البند {n}: صندوق أو عدد صناديق غير صالح"));
            }
        }
    }
    Ok(id.to_string())
}

fn sanitize_label(v: Option<&Value>) -> Option<String> {
    let s = v?.as_str()?.trim();
    if s.is_empty() {
        return None;
    }
    Some(s.chars().filter(|c| !c.is_control()).take(60).collect())
}

fn state_json(id: &str, state: &str, number: Option<&str>, reason: Option<&str>) -> Value {
    let mut m = json!({ "id": id, "state": state });
    if let Some(n) = number {
        m["invoiceNumber"] = json!(n);
    }
    if let Some(r) = reason {
        m["reason"] = json!(r);
    }
    m
}

fn status_state(s: Status) -> &'static str {
    match s {
        Status::Pending => "received",
        Status::Confirmed => "confirmed",
        Status::Rejected => "rejected",
    }
}

// ───────────────────────── معالجات API ─────────────────────────

async fn hello() -> Response {
    json_response(
        StatusCode::OK,
        json!({ "ok": true, "service": "mks-phone-sync", "protocol": PROTOCOL_VERSION,
                "version": env!("CARGO_PKG_VERSION") }),
    )
}

async fn bootstrap(State(ctx): State<Arc<Ctx>>, headers: HeaderMap) -> Response {
    if !authorized(&ctx, &headers) {
        return unauthorized();
    }
    match (ctx.snapshot)().await {
        Ok((snap, stale)) => json_response(
            StatusCode::OK,
            json!({
                "ok": true,
                "protocol": PROTOCOL_VERSION,
                "generatedAt": store::now_rfc3339(),
                "stale": stale,
                "merchants": snap.merchants,
                "boxes": snap.boxes,
            }),
        ),
        Err(e) => {
            log::warn!("phone_sync: تعذر جلب البيانات الأساسية: {e}");
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "data_unavailable",
                "تعذر على برنامج الكمبيوتر قراءة بياناته الآن — جرّب بعد قليل.",
            )
        }
    }
}

async fn post_invoices(State(ctx): State<Arc<Ctx>>, headers: HeaderMap, body: Bytes) -> Response {
    if !authorized(&ctx, &headers) {
        return unauthorized();
    }
    let Ok(parsed) = serde_json::from_slice::<Value>(&body) else {
        return api_error(StatusCode::BAD_REQUEST, "bad_json", "الطلب ليس JSON صالحاً");
    };
    let Some(invoices) = parsed.get("invoices").and_then(Value::as_array).cloned() else {
        return api_error(StatusCode::BAD_REQUEST, "bad_request", "حقل invoices مفقود");
    };
    if invoices.len() > MAX_INVOICES_PER_REQUEST {
        return api_error(StatusCode::PAYLOAD_TOO_LARGE, "too_many", "عدد الفواتير في الطلب كبير جداً");
    }
    let label = sanitize_label(parsed.get("deviceLabel"));

    let ctx2 = ctx.clone();
    let joined = tokio::task::spawn_blocking(move || {
        let mut results = Vec::with_capacity(invoices.len());
        let mut inserted = 0usize;
        for inv in invoices {
            let raw_id = inv.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let id = match validate_invoice_shape(&inv) {
                Ok(id) => id,
                Err(msg) => {
                    let mut r = state_json(&raw_id, "invalid", None, None);
                    r["message"] = json!(msg);
                    results.push(r);
                    continue;
                }
            };
            let rec = InvoiceRecord {
                client_id: id.clone(),
                received_at: store::now_rfc3339(),
                status: Status::Pending,
                device_label: label.clone(),
                payload: inv,
                decided_at: None,
                invoice_number: None,
                desktop_invoice_id: None,
                reject_reason: None,
            };
            match ctx2.store.insert_if_absent(rec) {
                Ok(InsertOutcome::Inserted) => {
                    inserted += 1;
                    results.push(state_json(&id, "received", None, None));
                }
                Ok(InsertOutcome::Exists(status, number, reason)) => {
                    results.push(state_json(&id, status_state(status), number.as_deref(), reason.as_deref()));
                }
                Err(e) => {
                    // فشل الكتابة على القرص: لا نقول «received» أبداً — تبقى النسخة على الهاتف.
                    log::error!("phone_sync: فشل حفظ فاتورة واردة: {e}");
                    let mut r = state_json(&id, "error", None, None);
                    r["message"] = json!("تعذر حفظ الفاتورة على الكمبيوتر — أعد المحاولة");
                    results.push(r);
                }
            }
        }
        (results, inserted)
    })
    .await;

    match joined {
        Ok((results, inserted)) => {
            if inserted > 0 {
                (ctx.on_received)(inserted);
            }
            json_response(StatusCode::OK, json!({ "ok": true, "results": results }))
        }
        Err(_) => api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal", "خطأ داخلي"),
    }
}

async fn post_status(State(ctx): State<Arc<Ctx>>, headers: HeaderMap, body: Bytes) -> Response {
    if !authorized(&ctx, &headers) {
        return unauthorized();
    }
    let ids: Vec<String> = match serde_json::from_slice::<Value>(&body)
        .ok()
        .and_then(|v| v.get("ids").and_then(Value::as_array).cloned())
    {
        Some(a) => a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect(),
        None => return api_error(StatusCode::BAD_REQUEST, "bad_request", "حقل ids مفقود"),
    };
    if ids.len() > MAX_STATUS_IDS {
        return api_error(StatusCode::PAYLOAD_TOO_LARGE, "too_many", "عدد المعرّفات كبير جداً");
    }
    let ctx2 = ctx.clone();
    let out = tokio::task::spawn_blocking(move || {
        let mut m = serde_json::Map::new();
        for id in ids {
            let v = match ctx2.store.get(&id) {
                Some(r) => state_json(&id, status_state(r.status), r.invoice_number.as_deref(), r.reject_reason.as_deref()),
                None => state_json(&id, "unknown", None, None),
            };
            m.insert(id, v);
        }
        m
    })
    .await;
    match out {
        Ok(m) => json_response(StatusCode::OK, json!({ "ok": true, "statuses": m })),
        Err(_) => api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal", "خطأ داخلي"),
    }
}

// ───────────────────────── صفحة الإعداد + الشهادة ─────────────────────────

const SETUP_TEMPLATE: &str = include_str!("setup_page.html");

pub fn setup_page(ca_fingerprint: &str, https_port: u16) -> String {
    SETUP_TEMPLATE
        .replace("{{FINGERPRINT}}", ca_fingerprint)
        .replace("{{HTTPS_PORT}}", &https_port.to_string())
}

fn html_response(body: String) -> Response {
    let mut r = Response::new(Body::from(body));
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

fn ca_response(ctx: &Ctx) -> Response {
    let mut r = Response::new(Body::from(ctx.ca_pem.clone()));
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/x-x509-ca-cert"));
    h.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"MKS-Local-CA.crt\""),
    );
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "غير موجود").into_response()
}

async fn app_fallback(State(ctx): State<Arc<Ctx>>, req: Request) -> Response {
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return (StatusCode::METHOD_NOT_ALLOWED, "غير مسموح").into_response();
    }
    let path = req.uri().path();
    match path {
        "/setup" => return html_response(setup_page(&ctx.ca_fingerprint, ctx.https_port)),
        "/ca.crt" => return ca_response(&ctx),
        _ => {}
    }
    let Some(asset) = web_assets::find(path) else {
        return not_found();
    };
    let body: Vec<u8> = if asset.path == "/sw.js" {
        let precache = serde_json::to_string(&web_assets::precache_paths()).unwrap_or("[]".into());
        String::from_utf8_lossy(asset.body)
            .replace("__ASSET_VERSION__", web_assets::content_version())
            .replace("__PRECACHE_LIST__", &precache)
            .into_bytes()
    } else {
        asset.body.to_vec()
    };
    let mut r = Response::new(Body::from(body));
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(asset.mime));
    // لا كاش عبر HTTP: الكاش مسؤولية الـ Service Worker وحده (نسخ مُرقَّمة).
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    if asset.mime.starts_with("text/html") {
        h.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
                 img-src 'self' data: blob:; font-src 'self'; connect-src https:; \
                 media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
            ),
        );
    }
    r
}

pub fn https_router(ctx: Arc<Ctx>) -> Router {
    Router::new()
        .route("/api/v1/hello", get(hello))
        .route("/api/v1/bootstrap", get(bootstrap))
        .route("/api/v1/invoices", post(post_invoices))
        .route("/api/v1/invoices/status", post(post_status))
        .fallback(app_fallback)
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(middleware::from_fn(cors_layer))
        .with_state(ctx)
}

/// موجّه منفذ الإعداد (HTTP): صفحة التعليمات + الشهادة العامة فقط. لا API.
pub fn setup_router(ctx: Arc<Ctx>) -> Router {
    async fn setup_only(State(ctx): State<Arc<Ctx>>, req: Request) -> Response {
        match req.uri().path() {
            "/" | "/setup" => html_response(setup_page(&ctx.ca_fingerprint, ctx.https_port)),
            "/ca.crt" => ca_response(&ctx),
            _ => not_found(),
        }
    }
    Router::new().fallback(setup_only).with_state(ctx)
}

// ───────────────────────── التشغيل والإيقاف ─────────────────────────

pub struct StartParams {
    pub https_port: u16,
    pub setup_port: u16,
    pub tls: Arc<rustls::ServerConfig>,
    pub ca_pem: String,
    pub ca_fingerprint: String,
    pub store: Arc<Store>,
    pub key: Arc<RwLock<String>>,
    pub snapshot: SnapshotFn,
    pub on_received: Arc<dyn Fn(usize) + Send + Sync>,
}

pub struct RunningServer {
    https: Handle<SocketAddr>,
    setup: Handle<SocketAddr>,
    runtime: Option<tokio::runtime::Runtime>,
}

fn bind_all(port: u16) -> Result<TcpListener, String> {
    let l = TcpListener::bind(("0.0.0.0", port)).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AddrInUse {
            format!("المنفذ {port} مشغول بتطبيق آخر — أغلق التطبيق الذي يستخدمه ثم أعد المحاولة.")
        } else {
            format!("تعذر فتح المنفذ {port}: {e}")
        }
    })?;
    l.set_nonblocking(true)
        .map_err(|e| format!("تعذر إعداد المنفذ {port}: {e}"))?;
    Ok(l)
}

pub fn start(p: StartParams) -> Result<RunningServer, String> {
    // ربط المنفذين متزامناً أولاً: أي فشل (منفذ مشغول) يصل للمستخدم فوراً.
    let https_listener = bind_all(p.https_port)?;
    let setup_listener = bind_all(p.setup_port)?;

    // runtime مستقل بخيطين: لا يزاحم runtime التطبيق الرئيسي ولا يتأثر به.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .thread_name("mks-phone-sync")
        .enable_all()
        .build()
        .map_err(|e| format!("تعذر تشغيل محرك الخدمة: {e}"))?;

    let ctx = Arc::new(Ctx {
        store: p.store,
        key: p.key,
        snapshot: p.snapshot,
        ca_pem: p.ca_pem,
        ca_fingerprint: p.ca_fingerprint,
        https_port: p.https_port,
        on_received: p.on_received,
    });

    let https_handle: Handle<SocketAddr> = Handle::new();
    let setup_handle: Handle<SocketAddr> = Handle::new();

    {
        let _enter = runtime.enter();
        let https_server = axum_server::from_tcp_rustls(https_listener, RustlsConfig::from_config(p.tls))
            .map_err(|e| format!("تعذر تشغيل HTTPS: {e}"))?
            .handle(https_handle.clone());
        let setup_server = axum_server::from_tcp(setup_listener)
            .map_err(|e| format!("تعذر تشغيل منفذ الإعداد: {e}"))?
            .handle(setup_handle.clone());

        let https_app = https_router(ctx.clone()).into_make_service();
        let setup_app = setup_router(ctx).into_make_service();

        runtime.spawn(async move {
            if let Err(e) = https_server.serve(https_app).await {
                log::error!("phone_sync: خادم HTTPS توقف: {e}");
            }
        });
        runtime.spawn(async move {
            if let Err(e) = setup_server.serve(setup_app).await {
                log::error!("phone_sync: خادم الإعداد توقف: {e}");
            }
        });
    }

    Ok(RunningServer {
        https: https_handle,
        setup: setup_handle,
        runtime: Some(runtime),
    })
}

impl RunningServer {
    pub fn stop(&mut self) {
        self.https.graceful_shutdown(Some(Duration::from_secs(2)));
        self.setup.graceful_shutdown(Some(Duration::from_secs(1)));
        if let Some(rt) = self.runtime.take() {
            rt.shutdown_timeout(Duration::from_secs(3));
        }
    }
}

impl Drop for RunningServer {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn good() -> Value {
        json!({
            "id": "a1b2c3d4-e5f6-4789-a012-b3c4d5e6f708",
            "invoiceDate": "2026-10-02",
            "merchantId": 3,
            "lines": [{
                "productName": "طماطم", "scaleWeight": 52.5, "price": 120,
                "boxes": [{"boxId": 1, "boxCount": 3}]
            }]
        })
    }

    #[test]
    fn accepts_well_formed_invoice() {
        assert_eq!(validate_invoice_shape(&good()).unwrap(), "a1b2c3d4-e5f6-4789-a012-b3c4d5e6f708");
    }

    #[test]
    fn rejects_malformed_invoices() {
        let mut v = good();
        v["id"] = json!("../etc");
        assert!(validate_invoice_shape(&v).is_err());
        let mut v = good();
        v["invoiceDate"] = json!("2026/10/02");
        assert!(validate_invoice_shape(&v).is_err());
        let mut v = good();
        v["merchantId"] = json!(0);
        assert!(validate_invoice_shape(&v).is_err());
        let mut v = good();
        v["lines"] = json!([]);
        assert!(validate_invoice_shape(&v).is_err());
        let mut v = good();
        v["lines"][0]["scaleWeight"] = json!(-1);
        assert!(validate_invoice_shape(&v).is_err());
        let mut v = good();
        v["lines"][0]["productName"] = json!("   ");
        assert!(validate_invoice_shape(&v).is_err());
        let mut v = good();
        v["lines"][0]["boxes"][0]["boxCount"] = json!(0);
        assert!(validate_invoice_shape(&v).is_err());
    }

    #[test]
    fn label_is_sanitized() {
        assert_eq!(sanitize_label(Some(&json!("  هاتف أحمد\n"))), Some("هاتف أحمد".into()));
        assert_eq!(sanitize_label(Some(&json!("   "))), None);
        assert_eq!(sanitize_label(None), None);
    }

    #[test]
    fn key_comparison() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"", b"x"));
    }

    #[test]
    fn date_check() {
        assert!(is_date("2026-10-02"));
        assert!(!is_date("2026-1-02"));
        assert!(!is_date("20261002xx"));
    }
}
