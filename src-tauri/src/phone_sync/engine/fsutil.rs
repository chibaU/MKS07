// أدوات ملفات: كتابة ذرّية (ملف مؤقت ثم إعادة تسمية) حتى لا يبقى ملف نصف مكتوب
// عند انقطاع الكهرباء أو إغلاق التطبيق أثناء الكتابة.

use serde::de::DeserializeOwned;
use std::fs;
#[cfg(unix)]
use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

fn tmp_path_for(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(format!(".tmp-{}", std::process::id()));
    path.with_file_name(name)
}

fn rename_with_retry(from: &Path, to: &Path) -> io::Result<()> {
    // على ويندوز قد ترفض إعادة التسمية لحظياً إن كان مضاد الفيروسات يفحص الملف الهدف.
    let mut last: Option<io::Error> = None;
    for attempt in 0..5 {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = Some(e);
                std::thread::sleep(Duration::from_millis(30 * (attempt + 1)));
            }
        }
    }
    Err(last.unwrap_or_else(|| io::Error::new(io::ErrorKind::Other, "rename failed")))
}

fn write_atomic_inner(path: &Path, bytes: &[u8], private: bool) -> io::Result<()> {
    let tmp = tmp_path_for(path);
    {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        if private {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        #[cfg(not(unix))]
        let _ = private;
        let mut f = opts.open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    if let Err(e) = rename_with_retry(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    #[cfg(unix)]
    {
        if let Some(dir) = path.parent() {
            if let Ok(d) = File::open(dir) {
                let _ = d.sync_all();
            }
        }
    }
    Ok(())
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_atomic_inner(path, bytes, false)
}

/// للمفاتيح الخاصة: صلاحيات 0600 على يونكس (على ويندوز تكفي صلاحيات مجلد AppData الخاص بالمستخدم).
pub fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_atomic_inner(path, bytes, true)
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<T>(&bytes)
            .map(Some)
            .map_err(|e| format!("ملف تالف {}: {}", path.display(), e)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("تعذر قراءة {}: {}", path.display(), e)),
    }
}

pub fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    write_atomic(path, &bytes).map_err(|e| format!("تعذرت الكتابة إلى {}: {}", path.display(), e))
}

pub fn now_rfc3339() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

pub fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}
