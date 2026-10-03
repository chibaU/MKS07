// ملفات Web App الهاتف مُضمَّنة في الملف التنفيذي نفسه (include_bytes) — لا
// مجلد موارد منفصل ولا خطوة بناء إضافية، وتتطابق نسختها دائماً مع نسخة التطبيق.
// المصدر: src-tauri/phone_web/ (ملفات ثابتة بلا أي build step).

use sha2::{Digest, Sha256};
use std::sync::OnceLock;

pub struct Asset {
    pub path: &'static str,
    pub mime: &'static str,
    pub body: &'static [u8],
}

const HTML: &str = "text/html; charset=utf-8";
const JS: &str = "text/javascript; charset=utf-8";

pub const ASSETS: &[Asset] = &[
    Asset { path: "/", mime: HTML, body: include_bytes!("../../phone_web/index.html") },
    Asset { path: "/index.html", mime: HTML, body: include_bytes!("../../phone_web/index.html") },
    Asset { path: "/app.css", mime: "text/css; charset=utf-8", body: include_bytes!("../../phone_web/app.css") },
    Asset { path: "/js/calc.js", mime: JS, body: include_bytes!("../../phone_web/js/calc.js") },
    Asset { path: "/js/icons.js", mime: JS, body: include_bytes!("../../phone_web/js/icons.js") },
    Asset { path: "/js/store.js", mime: JS, body: include_bytes!("../../phone_web/js/store.js") },
    Asset { path: "/js/api.js", mime: JS, body: include_bytes!("../../phone_web/js/api.js") },
    Asset { path: "/js/main.js", mime: JS, body: include_bytes!("../../phone_web/js/main.js") },
    Asset { path: "/sw.js", mime: JS, body: include_bytes!("../../phone_web/sw.js") },
    Asset { path: "/manifest.webmanifest", mime: "application/manifest+json; charset=utf-8", body: include_bytes!("../../phone_web/manifest.webmanifest") },
    Asset { path: "/icons/icon-192.png", mime: "image/png", body: include_bytes!("../../phone_web/icons/icon-192.png") },
    Asset { path: "/icons/icon-512.png", mime: "image/png", body: include_bytes!("../../phone_web/icons/icon-512.png") },
    // نفس خط Cairo المستخدم في التطبيق نفسه (مضمَّن محلياً — لا CDN).
    Asset { path: "/fonts/cairo.ttf", mime: "font/ttf", body: include_bytes!("../../../src/styles/fonts/Cairo-VariableFont_slnt,wght.ttf") },
];

pub fn find(path: &str) -> Option<&'static Asset> {
    ASSETS.iter().find(|a| a.path == path)
}

/// بصمة محتوى كل الملفات: تُحقَن في sw.js فيتغيّر الـ Service Worker (وبالتالي
/// يتحدّث كاش الهاتف) تلقائياً كلما تغيّر أي ملف، دون إدارة أرقام إصدارات يدوية.
pub fn content_version() -> &'static str {
    static V: OnceLock<String> = OnceLock::new();
    V.get_or_init(|| {
        let mut h = Sha256::new();
        for a in ASSETS {
            h.update(a.path.as_bytes());
            h.update(a.body);
        }
        let d = h.finalize();
        d.iter().take(6).map(|b| format!("{b:02x}")).collect()
    })
}

/// مسارات الـ precache (بلا التكرار «/» و«/index.html»: الأول يكفي مع الثاني).
pub fn precache_paths() -> Vec<&'static str> {
    ASSETS
        .iter()
        .map(|a| a.path)
        .filter(|p| *p != "/sw.js")
        .collect()
}
