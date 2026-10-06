// إعدادات الخدمة المحفوظة: مفتاح الوصول والمنفذ المفضّل.
//
// مفتاح الوصول سرّ ثابت واحد للتثبيت كله (مثل كلمة سر الواي فاي) يحمله QR — ليس
// جلسة ولا مرتبطاً بهاتف: أي هاتف يملكه يستطيع استخدام الخدمة، ويستطيع المستخدم
// تدويره (فيتوقف كل من يحمل المفتاح القديم) من صفحة مزامنة الهاتف.

use super::consts::DEFAULT_PORT;
use super::fsutil;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::path::Path;

const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
pub const KEY_LEN: usize = 16; // 16 محرفاً × 5 بتات = 80 بت عشوائية

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub access_key: String,
    pub preferred_port: u16,
    pub created_at: String,
    #[serde(default)]
    pub key_rotated_at: Option<String>,
}

pub fn random_bytes(buf: &mut [u8]) -> Result<(), String> {
    SystemRandom::new()
        .fill(buf)
        .map_err(|_| "تعذّر توليد قيم عشوائية آمنة من النظام".to_string())
}

pub fn generate_key() -> Result<String, String> {
    let mut bytes = [0u8; 10];
    random_bytes(&mut bytes)?;
    let mut out = String::with_capacity(KEY_LEN);
    let mut acc: u32 = 0;
    let mut bits = 0u32;
    for b in bytes {
        acc = (acc << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(CROCKFORD[((acc >> bits) & 31) as usize] as char);
        }
    }
    debug_assert_eq!(out.len(), KEY_LEN);
    Ok(out)
}

/// يوحّد شكل المفتاح المكتوب يدوياً: أحرف كبيرة، بلا فواصل/مسافات، ومع قبول
/// الالتباس الشائع (O→0، I/L→1) كما في ترميز Crockford.
pub fn normalize_key(input: &str) -> String {
    input
        .chars()
        .filter(|c| !matches!(c, '-' | ' ' | '_' | '\t' | '\n' | '\r'))
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .filter(|c| CROCKFORD.contains(&(*c as u8)) && c.is_ascii())
        .collect()
}

pub fn is_valid_key(key: &str) -> bool {
    key.len() == KEY_LEN && key.bytes().all(|b| CROCKFORD.contains(&b))
}

/// "ABCDEFGHJKMNPQRS" → "ABCD-EFGH-JKMN-PQRS"
pub fn format_key(key: &str) -> String {
    key.as_bytes()
        .chunks(4)
        .map(|c| String::from_utf8_lossy(c).to_string())
        .collect::<Vec<_>>()
        .join("-")
}

/// مقارنة بزمن ثابت — لا تكشف طول التطابق الجزئي عبر فروق التوقيت.
pub fn keys_equal(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

impl Config {
    pub fn load_or_create(dir: &Path) -> Result<Config, String> {
        let path = dir.join("config.json");
        if let Some(mut cfg) = fsutil::read_json::<Config>(&path).unwrap_or(None) {
            if is_valid_key(&cfg.access_key) {
                if cfg.preferred_port == 0 {
                    cfg.preferred_port = DEFAULT_PORT;
                }
                return Ok(cfg);
            }
        }
        let cfg = Config {
            access_key: generate_key()?,
            preferred_port: DEFAULT_PORT,
            created_at: fsutil::now_rfc3339(),
            key_rotated_at: None,
        };
        cfg.save(dir)?;
        Ok(cfg)
    }

    pub fn save(&self, dir: &Path) -> Result<(), String> {
        fsutil::write_json(&dir.join("config.json"), self)
    }
}
