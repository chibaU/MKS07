// ============================================================================
// قائمة الطابعات المثبَّتة على الجهاز — تغذّي منتقي الطابعة في صفحة الإعدادات
// (SettingsPage.tsx ← بطاقة «طريقة الطباعة»، وضع «طباعة مباشرة»).
//
// ⚠️ هذا الكود **منقول حرفياً** من وحدة الطباعة السابقة (نفس الأمر
// `list_system_printers` ونفس السلوك ونفس القيمة المُعادة) كي يبقى المنتقي
// يعمل كما كان. لا علاقة له بالطباعة نفسها (راجع `print/`): مهمته فقط ملء
// القائمة. فشل الاستعلام يُعيد قائمة فارغة، وغيابها لا يمنع الطباعة.
// ============================================================================

use std::process::Command;

/// يمنع ظهور أي نافذة (حتى نافذة الطرفية السوداء المؤقتة) عند تشغيل عملية
/// فرعية على Windows تحديداً.
#[cfg(target_os = "windows")]
fn suppress_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

/// يُعيد أسماء الطابعات المثبَّتة فعلياً على الجهاز — تُستخدَم في صفحة
/// الإعدادات لملء قائمة اختيار الطابعة (بدل كتابة الاسم يدوياً، وهو عرضة
/// لأخطاء إملائية). فشل الاستعلام نفسه (PowerShell غير متاح، صلاحيات، إلخ)
/// يُعيد قائمة فارغة بدل خطأ يوقف الصفحة بأكملها.
#[tauri::command]
pub fn list_system_printers() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Printer | Select-Object -ExpandProperty Name",
        ]);
        suppress_window(&mut cmd);
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                return String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty())
                    .collect();
            }
        }
        Vec::new()
    }
    #[cfg(not(target_os = "windows"))]
    {
        // بيئة التطوير (Ubuntu/CUPS) فقط — للتحقق السريع أثناء البناء، لا
        // تُستخدَم فعلياً لدى المستخدم النهائي (Windows).
        if let Ok(out) = Command::new("lpstat").arg("-a").output() {
            if out.status.success() {
                return String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .filter_map(|l| l.split_whitespace().next())
                    .map(|s| s.to_string())
                    .collect();
            }
        }
        Vec::new()
    }
}
