// ============================================================================
// ميزة تفعيل الجهاز (Device Activation) — راجع AI_CONTEXT.md القسم 9 قبل
// تعديل هذه الوحدة.
//
// هذا الأمر لا يصل إلى قاعدة البيانات ولا يعرف معرّف الجهاز. مهمته الوحيدة
// هي التحقق من كود التفعيل قبل أن تسمح الواجهة بإضافة الجهاز إلى قائمة
// trusted_devices.
// ============================================================================

use sha2::{Digest, Sha256};


// لا تضع الكود الصريح في هذا الملف.
// مطور : لقدر غيرة الكود بالفعل
const ACTIVATION_CODE_SHA256: &str =
    "3043e9f7b695b472b74e85ea0830c409014f799c110f12a4a783bc730c2cacb4";

#[tauri::command]
pub fn verify_activation_code(code: String) -> bool {
    let code = code.trim();
    if code.is_empty() {
        return false;
    }

    let hash = format!("{:x}", Sha256::digest(code.as_bytes()));
    hash == ACTIVATION_CODE_SHA256
}
