// ملفات تطبيق الهاتف (PWA) — مضمَّنة داخل ملف MKS التنفيذي من مجلد phone-app/.
// بلا خطوة بناء: ما يُكتب في phone-app هو ما يصل إلى الهاتف حرفياً.
//
// `allow_missing`: لو غاب المجلد وقت التجميع لا ينكسر بناء MKS الأساسي — تعمل
// الخدمة وتعرض صفحة توضّح أن ملفات تطبيق الهاتف غير موجودة.

use super::fsutil::hex;
use rust_embed::Embed;
use sha2::{Digest, Sha256};
use std::borrow::Cow;

#[derive(Embed)]
#[folder = "../phone-app/"]
#[allow_missing = true]
struct PhoneApp;

pub struct Asset {
    pub bytes: Cow<'static, [u8]>,
    pub mime: &'static str,
    pub etag: String,
}

pub fn mime_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "webmanifest" => "application/manifest+json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "ttf" => "font/ttf",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn safe_path(p: &str) -> Option<String> {
    let p = p.trim_start_matches('/');
    let p = if p.is_empty() { "index.html" } else { p };
    if p.contains("..") || p.contains('\\') || p.contains('\0') || p.starts_with('.') {
        return None;
    }
    Some(p.to_string())
}

fn etag_of(bytes: &[u8]) -> String {
    format!("\"{}\"", &hex(&Sha256::digest(bytes))[..20])
}

/// (path, etag) لكل ملف مضمَّن ما عدا قالب sw.js نفسه — يغذّي قائمة التخزين المسبق.
fn listing() -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = PhoneApp::iter()
        .filter(|p| p.as_ref() != "sw.js")
        .filter_map(|p| {
            let f = PhoneApp::get(&p)?;
            Some((p.to_string(), hex(&f.metadata.sha256_hash())))
        })
        .collect();
    v.sort();
    v
}

pub fn has_app() -> bool {
    PhoneApp::get("index.html").is_some()
}

/// يُنتج sw.js الفعلي: يحقن قائمة الملفات ونسخة (hash) تتغير بتغيّر أي ملف،
/// فيُحدّث الهاتف نسخته المحفوظة تلقائياً عند أول اتصال بعد تحديث MKS.
pub fn render_sw() -> Option<Vec<u8>> {
    let tpl = PhoneApp::get("sw.js")?;
    let text = String::from_utf8_lossy(&tpl.data).to_string();
    let files = listing();
    let mut h = Sha256::new();
    for (p, e) in &files {
        h.update(p.as_bytes());
        h.update(e.as_bytes());
    }
    h.update(&tpl.data);
    let version = hex(&h.finalize())[..16].to_string();

    let mut list: Vec<String> = vec!["/".to_string()];
    for (p, _) in &files {
        if p == "index.html" {
            continue;
        }
        list.push(format!("/{p}"));
    }
    let list_json = serde_json::to_string(&list).unwrap_or_else(|_| "[]".into());
    let out = text
        .replace("\"__MKS_VERSION__\"", &format!("\"{version}\""))
        .replace("/*__MKS_PRECACHE__*/[]", &list_json);
    Some(out.into_bytes())
}

pub fn get(path: &str) -> Option<Asset> {
    let p = safe_path(path)?;
    if p == "sw.js" {
        let bytes = render_sw()?;
        return Some(Asset { etag: etag_of(&bytes), mime: mime_for("sw.js"), bytes: Cow::Owned(bytes) });
    }
    let f = PhoneApp::get(&p)?;
    Some(Asset { etag: format!("\"{}\"", &hex(&f.metadata.sha256_hash())[..20]), mime: mime_for(&p), bytes: f.data })
}

pub const MISSING_APP_HTML: &str = "<!doctype html><html lang=\"ar\" dir=\"rtl\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>MKS</title><body style=\"font-family:sans-serif;padding:24px\"><h2>ملفات تطبيق الهاتف غير موجودة</h2><p>مجلد <code>phone-app</code> لم يُضمَّن وقت بناء MKS. أعد بناء التطبيق بعد التأكد من وجوده بجوار مجلد src-tauri.</p></body></html>";
