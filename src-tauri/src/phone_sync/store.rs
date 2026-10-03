// ============================================================================
// التخزين المعلَّق للفواتير القادمة من الهاتف (Pending) — مستقل تماماً عن
// SQLite الرئيسية (المتطلبان 21 و24).
//
// كل فاتورة = ملف JSON واحد باسم معرّفها الفريد (client id). الكتابة ذرية
// (ملف مؤقت → fsync → rename)، فلا يبقى ملف نصف مكتوب عند انقطاع التيار.
// الخادم لا يردّ «received» للهاتف إلا بعد نجاح هذه الكتابة فعلياً على القرص،
// ولذلك إغلاق واجهة الميزة أو التطبيق لا يُفقِد أي فاتورة سبق أن وصلت.
// ============================================================================

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// وصلت وبانتظار مراجعة المستخدم وتأكيده.
    Pending,
    /// حُفظت فعلياً في قاعدة البيانات الرئيسية بعد تأكيد المستخدم.
    Confirmed,
    /// رفضها المستخدم (مع سبب).
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceRecord {
    pub client_id: String,
    pub received_at: String,
    pub status: Status,
    pub device_label: Option<String>,
    /// الفاتورة كما أرسلها الهاتف حرفياً (لا تُعدَّل أبداً).
    pub payload: Value,
    pub decided_at: Option<String>,
    pub invoice_number: Option<String>,
    pub desktop_invoice_id: Option<i64>,
    pub reject_reason: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum InsertOutcome {
    Inserted,
    /// المعرّف موجود مسبقاً — لا نسخة ثانية (منع التكرار، المتطلب 19).
    Exists(Status, Option<String>, Option<String>),
}

pub struct Store {
    dir: PathBuf,
    lock: Mutex<()>,
}

pub fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

/// المعرّف يُستخدم اسم ملف: أحرف آمنة فقط (يمنع path traversal).
pub fn is_valid_client_id(id: &str) -> bool {
    (8..=64).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn io_err(ctx: &str, e: std::io::Error) -> String {
    format!("{ctx}: {e}")
}

impl Store {
    pub fn open(dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(dir).map_err(|e| io_err("تعذر إنشاء مجلد الفواتير المعلَّقة", e))?;
        // ملفات مؤقتة يتيمة من انقطاع سابق — آمنة الحذف (لم تُعتمَد بـ rename).
        if let Ok(rd) = fs::read_dir(dir) {
            for e in rd.flatten() {
                if e.path().extension().is_some_and(|x| x == "tmp") {
                    let _ = fs::remove_file(e.path());
                }
            }
        }
        Ok(Self {
            dir: dir.to_path_buf(),
            lock: Mutex::new(()),
        })
    }

    fn path_of(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.json"))
    }

    fn read(&self, id: &str) -> Option<InvoiceRecord> {
        let raw = fs::read_to_string(self.path_of(id)).ok()?;
        serde_json::from_str(&raw).ok()
    }

    fn write_atomic(&self, rec: &InvoiceRecord) -> Result<(), String> {
        let final_path = self.path_of(&rec.client_id);
        let tmp_path = self.dir.join(format!("{}.json.tmp", rec.client_id));
        let bytes = serde_json::to_vec_pretty(rec).map_err(|e| format!("تسلسل الفاتورة: {e}"))?;
        {
            let mut f = fs::File::create(&tmp_path).map_err(|e| io_err("إنشاء الملف المؤقت", e))?;
            f.write_all(&bytes).map_err(|e| io_err("كتابة الفاتورة", e))?;
            f.sync_all().map_err(|e| io_err("مزامنة الملف مع القرص", e))?;
        }
        fs::rename(&tmp_path, &final_path).map_err(|e| io_err("اعتماد الملف", e))?;
        #[cfg(unix)]
        if let Ok(d) = fs::File::open(&self.dir) {
            let _ = d.sync_all();
        }
        Ok(())
    }

    pub fn insert_if_absent(&self, rec: InvoiceRecord) -> Result<InsertOutcome, String> {
        let _g = self.lock.lock().map_err(|_| "قفل التخزين معطوب".to_string())?;
        if let Some(existing) = self.read(&rec.client_id) {
            return Ok(InsertOutcome::Exists(
                existing.status,
                existing.invoice_number,
                existing.reject_reason,
            ));
        }
        // ملف موجود لكنه تالف: لا نكتب فوقه بصمت.
        if self.path_of(&rec.client_id).exists() {
            return Err("سجل الفاتورة موجود لكنه تالف — راجع مجلد البيانات".into());
        }
        self.write_atomic(&rec)?;
        Ok(InsertOutcome::Inserted)
    }

    pub fn get(&self, id: &str) -> Option<InvoiceRecord> {
        if !is_valid_client_id(id) {
            return None;
        }
        let _g = self.lock.lock().ok()?;
        self.read(id)
    }

    /// كل السجلات: المعلَّقة أولاً (الأقدم أولاً)، ثم البقية (الأحدث قراراً أولاً).
    pub fn list(&self) -> Vec<InvoiceRecord> {
        let Ok(_g) = self.lock.lock() else {
            return vec![];
        };
        let mut out = Vec::new();
        if let Ok(rd) = fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().is_none_or(|x| x != "json") {
                    continue;
                }
                match fs::read_to_string(&p)
                    .ok()
                    .and_then(|r| serde_json::from_str::<InvoiceRecord>(&r).ok())
                {
                    Some(rec) => out.push(rec),
                    None => {
                        // لا نحذف شيئاً: نعزل الملف التالف جانباً ليبقى قابلاً للفحص.
                        let _ = fs::rename(&p, p.with_extension("json.corrupt"));
                        log::warn!("phone_sync: سجل تالف عُزل: {}", p.display());
                    }
                }
            }
        }
        out.sort_by(|a, b| {
            let pa = a.status != Status::Pending;
            let pb = b.status != Status::Pending;
            pa.cmp(&pb).then_with(|| {
                if !pa {
                    a.received_at.cmp(&b.received_at)
                } else {
                    b.decided_at.cmp(&a.decided_at)
                }
            })
        });
        out
    }

    fn update<F>(&self, id: &str, f: F) -> Result<InvoiceRecord, String>
    where
        F: FnOnce(&mut InvoiceRecord) -> Result<(), String>,
    {
        if !is_valid_client_id(id) {
            return Err("معرّف فاتورة غير صالح".into());
        }
        let _g = self.lock.lock().map_err(|_| "قفل التخزين معطوب".to_string())?;
        let mut rec = self.read(id).ok_or_else(|| "الفاتورة غير موجودة في الانتظار".to_string())?;
        f(&mut rec)?;
        self.write_atomic(&rec)?;
        Ok(rec)
    }

    pub fn set_confirmed(
        &self,
        id: &str,
        invoice_number: &str,
        desktop_invoice_id: i64,
    ) -> Result<InvoiceRecord, String> {
        self.update(id, |r| {
            match r.status {
                Status::Rejected => return Err("الفاتورة مرفوضة — أعدها إلى الانتظار أولاً".into()),
                Status::Confirmed => {
                    // تأكيد مكرَّر لنفس النتيجة: آمن (idempotent).
                    if r.desktop_invoice_id == Some(desktop_invoice_id) {
                        return Ok(());
                    }
                    return Err("الفاتورة مؤكَّدة سابقاً بنتيجة مختلفة".into());
                }
                Status::Pending => {}
            }
            r.status = Status::Confirmed;
            r.decided_at = Some(now_rfc3339());
            r.invoice_number = Some(invoice_number.to_string());
            r.desktop_invoice_id = Some(desktop_invoice_id);
            r.reject_reason = None;
            Ok(())
        })
    }

    pub fn set_rejected(&self, id: &str, reason: &str) -> Result<InvoiceRecord, String> {
        self.update(id, |r| {
            if r.status == Status::Confirmed {
                return Err("لا يمكن رفض فاتورة اعتُمدت وحُفظت فعلياً".into());
            }
            r.status = Status::Rejected;
            r.decided_at = Some(now_rfc3339());
            r.reject_reason = Some(reason.chars().take(300).collect());
            Ok(())
        })
    }

    /// تراجع عن الرفض (خطأ بشري): تعود إلى Pending.
    pub fn reopen(&self, id: &str) -> Result<InvoiceRecord, String> {
        self.update(id, |r| {
            if r.status != Status::Rejected {
                return Err("يمكن إعادة المرفوضة فقط إلى الانتظار".into());
            }
            r.status = Status::Pending;
            r.decided_at = None;
            r.reject_reason = None;
            Ok(())
        })
    }

    /// حذف سجل منتهٍ (مؤكَّد/مرفوض) من الكمبيوتر. المعلَّقة لا تُحذَف أبداً.
    pub fn delete_finished(&self, id: &str) -> Result<(), String> {
        if !is_valid_client_id(id) {
            return Err("معرّف فاتورة غير صالح".into());
        }
        let _g = self.lock.lock().map_err(|_| "قفل التخزين معطوب".to_string())?;
        match self.read(id) {
            None => Ok(()),
            Some(r) if r.status == Status::Pending => {
                Err("لا يمكن حذف فاتورة معلَّقة لم تُراجَع بعد".into())
            }
            Some(_) => fs::remove_file(self.path_of(id)).map_err(|e| io_err("حذف السجل", e)),
        }
    }

    /// تنظيف دوري للمؤكَّدة القديمة. آمن لأن علامة الاستيراد الدائمة في قاعدة
    /// البيانات الرئيسية تمنع التكرار حتى لو أعاد هاتف إرسال فاتورة قديمة.
    pub fn prune_confirmed_older_than(&self, days: i64) -> usize {
        let cutoff = OffsetDateTime::now_utc() - time::Duration::days(days);
        let mut removed = 0;
        for r in self.list() {
            if r.status != Status::Confirmed {
                continue;
            }
            let old = r
                .decided_at
                .as_deref()
                .and_then(|d| OffsetDateTime::parse(d, &Rfc3339).ok())
                .is_some_and(|d| d < cutoff);
            if old && self.delete_finished(&r.client_id).is_ok() {
                removed += 1;
            }
        }
        removed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rec(id: &str) -> InvoiceRecord {
        InvoiceRecord {
            client_id: id.into(),
            received_at: now_rfc3339(),
            status: Status::Pending,
            device_label: Some("هاتف 1".into()),
            payload: json!({"id": id, "x": 1}),
            decided_at: None,
            invoice_number: None,
            desktop_invoice_id: None,
            reject_reason: None,
        }
    }

    #[test]
    fn id_validation_blocks_traversal() {
        assert!(is_valid_client_id("a1b2c3d4-e5f6-4789-a012-b3c4d5e6f708"));
        assert!(!is_valid_client_id("../../etc/passwd"));
        assert!(!is_valid_client_id("short"));
        assert!(!is_valid_client_id("has space in it 123"));
        assert!(!is_valid_client_id(&"a".repeat(65)));
    }

    #[test]
    fn insert_is_idempotent_and_never_overwrites() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::open(d.path()).unwrap();
        assert_eq!(s.insert_if_absent(rec("inv-00000001")).unwrap(), InsertOutcome::Inserted);
        let mut again = rec("inv-00000001");
        again.payload = json!({"changed": true});
        assert!(matches!(
            s.insert_if_absent(again).unwrap(),
            InsertOutcome::Exists(Status::Pending, None, None)
        ));
        // الأصل لم يُستبدَل.
        assert_eq!(s.get("inv-00000001").unwrap().payload["x"], 1);
    }

    #[test]
    fn confirm_reject_reopen_rules() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::open(d.path()).unwrap();
        s.insert_if_absent(rec("inv-00000002")).unwrap();
        s.set_rejected("inv-00000002", "تاجر محذوف").unwrap();
        assert!(s.set_confirmed("inv-00000002", "2610-1-1", 5).is_err());
        s.reopen("inv-00000002").unwrap();
        let c = s.set_confirmed("inv-00000002", "2610-1-1", 5).unwrap();
        assert_eq!(c.status, Status::Confirmed);
        // تأكيد مكرَّر بنفس النتيجة مقبول، بنتيجة مختلفة مرفوض.
        assert!(s.set_confirmed("inv-00000002", "2610-1-1", 5).is_ok());
        assert!(s.set_confirmed("inv-00000002", "2610-1-2", 6).is_err());
        assert!(s.set_rejected("inv-00000002", "x").is_err());
        assert!(s.reopen("inv-00000002").is_err());
    }

    #[test]
    fn pending_cannot_be_deleted_but_finished_can() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::open(d.path()).unwrap();
        s.insert_if_absent(rec("inv-00000003")).unwrap();
        assert!(s.delete_finished("inv-00000003").is_err());
        s.set_rejected("inv-00000003", "x").unwrap();
        assert!(s.delete_finished("inv-00000003").is_ok());
        assert!(s.get("inv-00000003").is_none());
    }

    #[test]
    fn records_survive_reopen_of_store() {
        let d = tempfile::tempdir().unwrap();
        {
            let s = Store::open(d.path()).unwrap();
            s.insert_if_absent(rec("inv-00000004")).unwrap();
        }
        let s2 = Store::open(d.path()).unwrap();
        assert_eq!(s2.list().iter().filter(|r| r.status == Status::Pending).count(), 1);
    }

    #[test]
    fn corrupt_file_is_quarantined_not_deleted() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::open(d.path()).unwrap();
        fs::write(d.path().join("inv-00000005.json"), "{ not json").unwrap();
        assert!(s.list().is_empty());
        assert!(d.path().join("inv-00000005.json.corrupt").exists());
    }

    #[test]
    fn orphan_tmp_files_are_cleaned_on_open() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("inv-00000006.json.tmp"), "partial").unwrap();
        let _ = Store::open(d.path()).unwrap();
        assert!(!d.path().join("inv-00000006.json.tmp").exists());
    }
}
