// الشهادات المحلية — قلب قرار "HTTPS محلي":
//
//  • شهادة جذر (CA) خاصة بهذا التثبيت، تُولَّد مرة واحدة وتُحفَظ في AppData. هذه
//    وحدها ما يثبّته المستخدم على الهاتف (مرة واحدة عند أول إعداد). صلاحيتها 10 سنوات.
//  • شهادة خادم (leaf) تُولَّد في الذاكرة عند كل تشغيل للخدمة (وتُجدَّد تلقائياً إن
//    تغيّر عنوان IP للكمبيوتر)، وتشمل كل عناوين الشبكة المحلية الحالية كـ SAN —
//    فلا يحتاج الهاتف لأي تثبيت جديد عندما يتغيّر عنوان الكمبيوتر، فهو يثق بالجذر.
//
// الخوارزمية ECDSA P-256 / SHA-256 (مدعومة على كل متصفحات الهواتف الحديثة).
// مزوّد التشفير ring صراحةً (لا نعتمد على المزوّد الافتراضي للعملية حتى لا يتعارض
// مع أي مزوّد آخر تجلبه مكتبات أخرى في المشروع).

use super::config::random_bytes;
use super::consts::*;
use super::fsutil;
use rcgen::{
    BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair,
    KeyUsagePurpose, SanType, SerialNumber,
};
use rustls::pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use rustls::server::{ClientHello, ResolvesServerCert};
use rustls::sign::CertifiedKey;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::net::{IpAddr, Ipv4Addr};
use std::path::Path;
use std::sync::{Arc, RwLock};
use time::{Duration, OffsetDateTime};

/// هامش رجوع لتاريخ البدء: ساعات الهواتف قد تتأخر عن الحقيقة بأيام.
const BACKDATE_DAYS: i64 = 7;

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CaMeta {
    created_at: String,
    not_after: String,
}

pub struct Ca {
    pub cert_pem: String,
    pub cert_der: Vec<u8>,
    key_pem: String,
    /// بصمة SHA-256 بصيغة AB:CD:… للمطابقة البصرية بين الكمبيوتر والهاتف.
    pub fingerprint: String,
    pub not_after: String,
}

pub fn fingerprint_of(der: &[u8]) -> String {
    let digest = Sha256::digest(der);
    digest
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(":")
}

fn random_serial() -> Result<SerialNumber, String> {
    let mut bytes = [0u8; 16];
    random_bytes(&mut bytes)?;
    bytes[0] &= 0x7f; // موجب
    if bytes[0] == 0 {
        bytes[0] = 0x01;
    }
    Ok(SerialNumber::from_slice(&bytes))
}

impl Ca {
    pub fn load_or_create(dir: &Path) -> Result<Ca, String> {
        let ca_dir = dir.join("ca");
        std::fs::create_dir_all(&ca_dir).map_err(|e| format!("تعذّر إنشاء مجلد الشهادة: {e}"))?;
        let cert_path = ca_dir.join("mks-local-ca.crt");
        let key_path = ca_dir.join("mks-local-ca.key");
        let meta_path = ca_dir.join("meta.json");

        if let (Ok(cert_pem), Ok(key_pem)) = (
            std::fs::read_to_string(&cert_path),
            std::fs::read_to_string(&key_path),
        ) {
            let meta = fsutil::read_json::<CaMeta>(&meta_path).ok().flatten().unwrap_or_default();
            if let Ok(ca) = Ca::from_pems(cert_pem, key_pem, meta.not_after) {
                return Ok(ca);
            }
            // ملف تالف: نولّد جذراً جديداً (سيحتاج المستخدم لتثبيته على الهواتف من جديد).
        }

        let key = KeyPair::generate().map_err(|e| format!("تعذّر توليد مفتاح الشهادة: {e}"))?;
        let mut id = [0u8; 3];
        random_bytes(&mut id)?;
        let label = format!("MKS Local CA {:02X}{:02X}{:02X}", id[0], id[1], id[2]);

        let mut params = CertificateParams::new(Vec::<String>::new())
            .map_err(|e| format!("إعداد الشهادة: {e}"))?;
        params.distinguished_name.push(DnType::CommonName, label);
        params.distinguished_name.push(DnType::OrganizationName, "MKS");
        params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
        params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
        let now = OffsetDateTime::now_utc();
        params.not_before = now - Duration::days(BACKDATE_DAYS);
        let not_after = now + Duration::days(CA_VALIDITY_DAYS);
        params.not_after = not_after;
        params.serial_number = Some(random_serial()?);
        let cert = params.self_signed(&key).map_err(|e| format!("توقيع شهادة الجذر: {e}"))?;

        let cert_pem = cert.pem();
        let key_pem = key.serialize_pem();
        let not_after_s = not_after
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default();

        fsutil::write_atomic(&cert_path, cert_pem.as_bytes())
            .map_err(|e| format!("تعذّر حفظ الشهادة: {e}"))?;
        fsutil::write_private(&key_path, key_pem.as_bytes())
            .map_err(|e| format!("تعذّر حفظ مفتاح الشهادة: {e}"))?;
        let _ = fsutil::write_json(
            &meta_path,
            &CaMeta { created_at: fsutil::now_rfc3339(), not_after: not_after_s.clone() },
        );
        Ca::from_pems(cert_pem, key_pem, not_after_s)
    }

    fn from_pems(cert_pem: String, key_pem: String, not_after: String) -> Result<Ca, String> {
        let der = CertificateDer::from_pem_slice(cert_pem.as_bytes())
            .map_err(|e| format!("شهادة تالفة: {e}"))?;
        // نتأكد أن المفتاح يطابق الشهادة وأن الشهادة قابلة للاستخدام كمُصدِر.
        let kp = KeyPair::from_pem(&key_pem).map_err(|e| format!("مفتاح تالف: {e}"))?;
        Issuer::from_ca_cert_pem(&cert_pem, kp).map_err(|e| format!("شهادة جذر غير صالحة: {e}"))?;
        let cert_der = der.as_ref().to_vec();
        Ok(Ca { fingerprint: fingerprint_of(&cert_der), cert_pem, cert_der, key_pem, not_after })
    }

    fn issuer(&self) -> Result<Issuer<'static, KeyPair>, String> {
        let kp = KeyPair::from_pem(&self.key_pem).map_err(|e| format!("مفتاح الجذر: {e}"))?;
        Issuer::from_ca_cert_pem(&self.cert_pem, kp).map_err(|e| format!("شهادة الجذر: {e}"))
    }
}

pub struct Leaf {
    pub key: Arc<CertifiedKey>,
    pub not_after: OffsetDateTime,
}

pub fn generate_leaf(ca: &Ca, ips: &[Ipv4Addr]) -> Result<Leaf, String> {
    let issuer = ca.issuer()?;
    let leaf_key = KeyPair::generate().map_err(|e| format!("مفتاح الخادم: {e}"))?;

    let mut params = CertificateParams::new(vec!["localhost".to_string()])
        .map_err(|e| format!("إعداد شهادة الخادم: {e}"))?;
    params
        .subject_alt_names
        .push(SanType::IpAddress(IpAddr::V4(Ipv4Addr::LOCALHOST)));
    let mut sorted: Vec<Ipv4Addr> = ips.to_vec();
    sorted.sort();
    sorted.dedup();
    for ip in &sorted {
        params.subject_alt_names.push(SanType::IpAddress(IpAddr::V4(*ip)));
    }
    params.distinguished_name.push(DnType::CommonName, "MKS Phone Sync");
    params.is_ca = IsCa::NoCa;
    params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    params.use_authority_key_identifier_extension = true;
    let now = OffsetDateTime::now_utc();
    params.not_before = now - Duration::days(BACKDATE_DAYS);
    let not_after = now + Duration::days(LEAF_VALIDITY_DAYS);
    params.not_after = not_after;
    params.serial_number = Some(random_serial()?);

    let cert = params
        .signed_by(&leaf_key, &issuer)
        .map_err(|e| format!("توقيع شهادة الخادم: {e}"))?;

    let key_der = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(leaf_key.serialize_der()));
    let signing = rustls::crypto::ring::sign::any_supported_type(&key_der)
        .map_err(|e| format!("مفتاح الخادم غير مدعوم: {e}"))?;
    let certified = CertifiedKey::new(vec![cert.der().clone()], signing);
    Ok(Leaf { key: Arc::new(certified), not_after })
}

/// يقدّم شهادة الخادم الحالية ويسمح باستبدالها أثناء التشغيل (تغيّر IP) دون إعادة
/// تشغيل الخادم. العملاء الذين يتصلون بعنوان IP لا يرسلون SNI، فلا نعتمد عليه.
pub struct SwapCert {
    inner: RwLock<Arc<CertifiedKey>>,
}

impl SwapCert {
    pub fn new(key: Arc<CertifiedKey>) -> Self {
        SwapCert { inner: RwLock::new(key) }
    }
    pub fn swap(&self, key: Arc<CertifiedKey>) {
        *self.inner.write().unwrap_or_else(|e| e.into_inner()) = key;
    }
}

impl fmt::Debug for SwapCert {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SwapCert").finish()
    }
}

impl ResolvesServerCert for SwapCert {
    fn resolve(&self, _hello: ClientHello<'_>) -> Option<Arc<CertifiedKey>> {
        Some(self.inner.read().unwrap_or_else(|e| e.into_inner()).clone())
    }
}

pub fn build_server_config(resolver: Arc<SwapCert>) -> Result<Arc<rustls::ServerConfig>, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut cfg = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("إعداد TLS: {e}"))?
        .with_no_client_auth()
        .with_cert_resolver(resolver);
    cfg.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(Arc::new(cfg))
}
