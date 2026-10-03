// ============================================================================
// الشهادة المحلية لـ HTTPS (قرار نهائي: HTTPS محلي، بلا HTTP كحل نهائي، بلا
// أعلام خاصة في Chrome).
//
// المبدأ: شهادة جذرية محلية (CA) تُنشأ مرة واحدة فقط وتُحفَظ، ويثبّتها
// المستخدم على الهاتف عند أول إعداد. أما شهادة الخادم نفسها (leaf) فتُعاد
// إصدارها تلقائياً كلما تغيّرت عناوين الشبكة (DHCP) أو اقترب انتهاؤها، دون أن
// يحتاج الهاتف إلى أي إجراء جديد — لأنه يثق بالـ CA لا بالـ leaf.
//
// المفاتيح الخاصة تبقى في مجلد بيانات التطبيق فقط ولا تُرسَل لأي جهة.
// ============================================================================

use rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose,
    IsCa, Issuer, KeyPair, KeyUsagePurpose,
};
use rustls::pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, net::Ipv4Addr, path::Path, sync::Arc};
use time::{Duration, OffsetDateTime};

const CA_VALIDITY_DAYS: i64 = 3650;
// أقل من 398 يوماً: حد الأجهزة الصارمة (Apple) لشهادات الخوادم.
const LEAF_VALIDITY_DAYS: i64 = 397;
// نُعيد إصدار شهادة الخادم قبل هذا العمر، فتبقى صالحة 3 أشهر على الأقل.
const LEAF_REFRESH_AFTER_DAYS: i64 = 300;

const CA_CERT_FILE: &str = "ca.crt";
const CA_KEY_FILE: &str = "ca.key";
const LEAF_CERT_FILE: &str = "server.crt";
const LEAF_KEY_FILE: &str = "server.key";
const LEAF_META_FILE: &str = "server.meta.json";

#[derive(Serialize, Deserialize)]
struct LeafMeta {
    sans: Vec<String>,
    issued_at: i64,
    ca_fingerprint: String,
}

pub struct TlsMaterial {
    /// الشهادة الجذرية بصيغة PEM (هي التي يحمّلها الهاتف من /ca.crt).
    pub ca_pem: String,
    /// بصمة SHA-256 للـ CA بصيغة AA:BB:CC...
    pub ca_fingerprint: String,
    pub server_config: Arc<rustls::ServerConfig>,
}

fn err<E: std::fmt::Display>(ctx: &str) -> impl Fn(E) -> String + '_ {
    move |e| format!("{ctx}: {e}")
}

/// بصمة SHA-256 لشهادة DER بصيغة مقروءة (AA:BB:...).
pub fn fingerprint_der(der: &[u8]) -> String {
    Sha256::digest(der)
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn pem_to_der(pem: &str) -> Result<CertificateDer<'static>, String> {
    CertificateDer::from_pem_slice(pem.as_bytes()).map_err(err("تعذر قراءة الشهادة"))
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}

fn write_secret(path: &Path, content: &str) -> Result<(), String> {
    fs::write(path, content).map_err(err("تعذرت كتابة ملف الشهادة"))?;
    restrict_permissions(path);
    Ok(())
}

fn distinguished(cn: &str) -> DistinguishedName {
    let mut dn = DistinguishedName::new();
    dn.push(DnType::OrganizationName, "MKS");
    dn.push(DnType::CommonName, cn);
    dn
}

fn generate_ca(dir: &Path) -> Result<(), String> {
    let key = KeyPair::generate().map_err(err("توليد مفتاح الـ CA"))?;
    let mut params = CertificateParams::new(Vec::<String>::new()).map_err(err("إعداد الـ CA"))?;
    let now = OffsetDateTime::now_utc();
    params.distinguished_name = distinguished("MKS Local CA");
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    params.not_before = now - Duration::days(1);
    params.not_after = now + Duration::days(CA_VALIDITY_DAYS);
    let cert = params.self_signed(&key).map_err(err("توقيع الـ CA"))?;
    // المفتاح أولاً: لو انقطع التيار بين الكتابتين لا يبقى cert بلا مفتاح.
    write_secret(&dir.join(CA_KEY_FILE), &key.serialize_pem())?;
    fs::write(dir.join(CA_CERT_FILE), cert.pem()).map_err(err("كتابة شهادة الـ CA"))?;
    Ok(())
}

fn ca_files_valid(dir: &Path) -> bool {
    let (Ok(cert), Ok(key)) = (
        fs::read_to_string(dir.join(CA_CERT_FILE)),
        fs::read_to_string(dir.join(CA_KEY_FILE)),
    ) else {
        return false;
    };
    pem_to_der(&cert).is_ok() && KeyPair::from_pem(&key).is_ok()
}

/// بصمة الـ CA إن كانت موجودة (لعرضها في الواجهة قبل تشغيل الخدمة).
pub fn existing_ca_fingerprint(dir: &Path) -> Option<String> {
    let pem = fs::read_to_string(dir.join(CA_CERT_FILE)).ok()?;
    Some(fingerprint_der(pem_to_der(&pem).ok()?.as_ref()))
}

/// الأسماء التي تُضمَّن في شهادة الخادم: localhost + كل عناوين الشبكة المحلية.
pub fn wanted_sans(ips: &[Ipv4Addr]) -> Vec<String> {
    let mut sans: Vec<String> = vec!["localhost".into(), "127.0.0.1".into()];
    let mut ip_list: Vec<String> = ips.iter().map(|ip| ip.to_string()).collect();
    ip_list.sort();
    ip_list.dedup();
    sans.extend(ip_list);
    sans
}

fn leaf_is_current(dir: &Path, sans: &[String], ca_fp: &str) -> bool {
    let Ok(raw) = fs::read_to_string(dir.join(LEAF_META_FILE)) else {
        return false;
    };
    let Ok(meta) = serde_json::from_str::<LeafMeta>(&raw) else {
        return false;
    };
    let age_days = (OffsetDateTime::now_utc().unix_timestamp() - meta.issued_at) / 86_400;
    meta.sans == sans
        && meta.ca_fingerprint == ca_fp
        && (0..LEAF_REFRESH_AFTER_DAYS).contains(&age_days)
        && dir.join(LEAF_CERT_FILE).exists()
        && dir.join(LEAF_KEY_FILE).exists()
}

fn generate_leaf(dir: &Path, sans: &[String], ca_fp: &str) -> Result<(), String> {
    let ca_pem = fs::read_to_string(dir.join(CA_CERT_FILE)).map_err(err("قراءة شهادة الـ CA"))?;
    let ca_key_pem = fs::read_to_string(dir.join(CA_KEY_FILE)).map_err(err("قراءة مفتاح الـ CA"))?;
    let ca_key = KeyPair::from_pem(&ca_key_pem).map_err(err("تحليل مفتاح الـ CA"))?;
    let issuer = Issuer::from_ca_cert_pem(&ca_pem, ca_key).map_err(err("تحليل شهادة الـ CA"))?;

    let leaf_key = KeyPair::generate().map_err(err("توليد مفتاح الخادم"))?;
    let mut params = CertificateParams::new(sans.to_vec()).map_err(err("أسماء شهادة الخادم"))?;
    let now = OffsetDateTime::now_utc();
    params.distinguished_name = distinguished("MKS Phone Sync");
    params.is_ca = IsCa::NoCa;
    params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    params.use_authority_key_identifier_extension = true;
    params.not_before = now - Duration::days(1);
    params.not_after = now + Duration::days(LEAF_VALIDITY_DAYS);
    let cert = params.signed_by(&leaf_key, &issuer).map_err(err("توقيع شهادة الخادم"))?;

    write_secret(&dir.join(LEAF_KEY_FILE), &leaf_key.serialize_pem())?;
    fs::write(dir.join(LEAF_CERT_FILE), cert.pem()).map_err(err("كتابة شهادة الخادم"))?;
    let meta = LeafMeta {
        sans: sans.to_vec(),
        issued_at: now.unix_timestamp(),
        ca_fingerprint: ca_fp.to_string(),
    };
    // الميتا آخراً: لا تُعتبَر الشهادة «حالية» إلا بعد اكتمال كتابة كل ملفاتها.
    fs::write(
        dir.join(LEAF_META_FILE),
        serde_json::to_string(&meta).map_err(err("ميتا الشهادة"))?,
    )
    .map_err(err("كتابة ميتا الشهادة"))?;
    Ok(())
}

/// يضمن وجود CA وشهادة خادم صالحة لعناوين الشبكة الحالية، ويبني إعداد TLS.
pub fn load_or_create(dir: &Path, ips: &[Ipv4Addr]) -> Result<TlsMaterial, String> {
    fs::create_dir_all(dir).map_err(err("إنشاء مجلد الشهادات"))?;

    if !ca_files_valid(dir) {
        // CA جديدة تعني أن كل شهادات الخادم القديمة لم تعد صالحة.
        for f in [LEAF_CERT_FILE, LEAF_KEY_FILE, LEAF_META_FILE] {
            let _ = fs::remove_file(dir.join(f));
        }
        generate_ca(dir)?;
    }

    let ca_pem = fs::read_to_string(dir.join(CA_CERT_FILE)).map_err(err("قراءة شهادة الـ CA"))?;
    let ca_fp = fingerprint_der(pem_to_der(&ca_pem)?.as_ref());

    let sans = wanted_sans(ips);
    if !leaf_is_current(dir, &sans, &ca_fp) {
        generate_leaf(dir, &sans, &ca_fp)?;
    }

    let leaf_pem = fs::read_to_string(dir.join(LEAF_CERT_FILE)).map_err(err("قراءة شهادة الخادم"))?;
    let leaf_key_pem = fs::read_to_string(dir.join(LEAF_KEY_FILE)).map_err(err("قراءة مفتاح الخادم"))?;
    let leaf_der = pem_to_der(&leaf_pem)?;
    let key_der = PrivateKeyDer::from_pem_slice(leaf_key_pem.as_bytes())
        .map_err(err("تحليل مفتاح الخادم"))?;

    // مزوّد ring صراحةً (بلا أي حالة عامة process-wide) — يتجنب الحاجة إلى
    // aws-lc/cmake عند بناء نسخة Windows، ولا يتعارض مع أي مزوّد آخر في التطبيق.
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(err("إعداد إصدارات TLS"))?
        .with_no_client_auth()
        .with_single_cert(vec![leaf_der], key_der)
        .map_err(err("إعداد شهادة الخادم"))?;
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

    Ok(TlsMaterial {
        ca_pem,
        ca_fingerprint: ca_fp,
        server_config: Arc::new(config),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_ca_once_and_reuses_it() {
        let dir = tempfile::tempdir().unwrap();
        let ips = [Ipv4Addr::new(192, 168, 1, 20)];
        let a = load_or_create(dir.path(), &ips).unwrap();
        let b = load_or_create(dir.path(), &ips).unwrap();
        assert_eq!(a.ca_fingerprint, b.ca_fingerprint);
        assert_eq!(a.ca_pem, b.ca_pem);
        assert_eq!(a.ca_fingerprint.split(':').count(), 32);
    }

    #[test]
    fn leaf_is_reissued_when_ips_change_but_ca_stays() {
        let dir = tempfile::tempdir().unwrap();
        let a = load_or_create(dir.path(), &[Ipv4Addr::new(192, 168, 1, 20)]).unwrap();
        let leaf1 = fs::read_to_string(dir.path().join(LEAF_CERT_FILE)).unwrap();
        // نفس العناوين: لا إعادة إصدار.
        let _ = load_or_create(dir.path(), &[Ipv4Addr::new(192, 168, 1, 20)]).unwrap();
        assert_eq!(leaf1, fs::read_to_string(dir.path().join(LEAF_CERT_FILE)).unwrap());
        // عنوان جديد: leaf جديدة، CA نفسها (الهاتف لا يحتاج أي إجراء).
        let b = load_or_create(dir.path(), &[Ipv4Addr::new(192, 168, 1, 77)]).unwrap();
        assert_ne!(leaf1, fs::read_to_string(dir.path().join(LEAF_CERT_FILE)).unwrap());
        assert_eq!(a.ca_fingerprint, b.ca_fingerprint);
    }

    #[test]
    fn corrupt_ca_is_regenerated() {
        let dir = tempfile::tempdir().unwrap();
        let ips = [Ipv4Addr::new(10, 0, 0, 4)];
        let a = load_or_create(dir.path(), &ips).unwrap();
        fs::write(dir.path().join(CA_KEY_FILE), "garbage").unwrap();
        let b = load_or_create(dir.path(), &ips).unwrap();
        assert_ne!(a.ca_fingerprint, b.ca_fingerprint);
    }

    #[test]
    fn sans_are_sorted_and_deduped() {
        let s = wanted_sans(&[
            Ipv4Addr::new(192, 168, 1, 9),
            Ipv4Addr::new(10, 0, 0, 1),
            Ipv4Addr::new(192, 168, 1, 9),
        ]);
        assert_eq!(s, vec!["localhost", "127.0.0.1", "10.0.0.1", "192.168.1.9"]);
    }
}
