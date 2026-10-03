// ============================================================================
// ميزة «مزامنة الهاتف» — أنواع البيانات المشتركة بين طبقات Rust.
// راجع AI_CONTEXT.md القسم 10 قبل تعديل أي ملف في هذا المجلد.
//
// هذه الوحدة لا تعتمد على Tauri إطلاقاً (كل ما في phone_sync عدا commands.rs
// كذلك)، حتى يمكن اختبارها كمكتبة عادية بمعزل عن التطبيق.
// ============================================================================

use serde::{Deserialize, Serialize};

/// تاجر كما يراه الهاتف: المعرّف والاسم فقط (البند 8 من المتطلبات).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MerchantDto {
    pub id: i64,
    pub name: String,
}

/// صندوق نشط/مرئي كما يراه الهاتف: المعرّف والاسم والوزن الفارغ.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BoxDto {
    pub id: i64,
    pub name: String,
    pub weight: f64,
}

/// لقطة البيانات الأساسية التي يُرسلها الكمبيوتر للهاتف عند الطلب.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Snapshot {
    pub merchants: Vec<MerchantDto>,
    pub boxes: Vec<BoxDto>,
}

/// عنوان شبكة محلية للكمبيوتر يصلح أن يوجَّه إليه الهاتف.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddressInfo {
    pub ip: String,
    pub interface: String,
    /// true = أرجح أن يكون هو شبكة Wi-Fi/Ethernet الحقيقية (لا محوّل افتراضي).
    pub likely: bool,
}

/// حالة الخدمة كما تُعرَض في الواجهة.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub running: bool,
    pub https_port: u16,
    pub setup_port: u16,
    pub addresses: Vec<AddressInfo>,
    /// بصمة SHA-256 للشهادة الجذرية المحلية (للتحقق اليدوي على الهاتف).
    pub ca_fingerprint: Option<String>,
    /// مفتاح الوصول الحالي (يُضمَّن في QR الخاص بفتح التطبيق).
    pub access_key: Option<String>,
    pub data_dir: String,
}
