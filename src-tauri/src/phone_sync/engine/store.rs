// التخزين المستقل للفواتير الواردة من الهاتف — مستقل تماماً عن SQLite الرئيسية.
//
// التخطيط على القرص (داخل AppData/phone_sync/):
//   inbox/<uid>.json   فاتورة واحدة بحالة "pending" أو "saving" (قيد التأكيد).
//                      كل كتابة ذرّية (ملف مؤقت ثم إعادة تسمية) فلا يبقى نصف ملف.
//   ledger.jsonl       سجل قرارات نهائية فقط (confirmed / rejected)، سطر JSON لكل
//                      قرار، يُلحَق ولا يُعدَّل. هو ما يمنع التكرار إلى الأبد: فاتورة
//                      أُعيد إرسالها بعد اعتمادها تُعطى "confirmed" ولا تُنشأ مرتين.
//
// تسلسل الحالات:  (جديد) → pending → saving → confirmed
//                              ↘ rejected            (saving → pending عند فشل الحفظ)
//
// أمان الانقطاع: عند الاعتماد يُكتب سطر السجل (مع fsync) أولاً ثم يُحذف ملف inbox.
// لو انقطعت الكهرباء بينهما، يعثر الإقلاع التالي على uid في الاثنين فيُعتمَد السجل
// ويُحذَف ملف inbox القديم.

use super::consts::*;
use super::fsutil;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const RECENT_KEEP: usize = 200;

// ───────────────────────── أنواع الحمولة القادمة من الهاتف ─────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WireBox {
    pub box_id: i64,
    pub box_count: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WireLine {
    #[serde(default)]
    pub lid: Option<String>,
    pub product_name: String,
    pub scale_weight: f64,
    pub price: f64,
    #[serde(default)]
    pub boxes: Vec<WireBox>,
    // قيم حسبها الهاتف — للمقارنة والتنبيه فقط، لا تُعتمَد أبداً (القاعدة 13).
    #[serde(default)]
    pub phone_net_weight: Option<f64>,
    #[serde(default)]
    pub phone_subtotal: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WireInvoice {
    pub uid: String,
    pub created_at: String,
    pub invoice_date: String,
    pub merchant_id: i64,
    #[serde(default)]
    pub merchant_name_hint: Option<String>,
    pub lines: Vec<WireLine>,
    #[serde(default)]
    pub phone_total: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct Invalid {
    pub code: &'static str,
    pub message: String,
}

fn bad(code: &'static str, message: &str) -> Invalid {
    Invalid { code, message: message.to_string() }
}

pub fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 36 {
        return false;
    }
    b.iter().enumerate().all(|(i, c)| match i {
        8 | 13 | 18 | 23 => *c == b'-',
        _ => c.is_ascii_digit() || (b'a'..=b'f').contains(c),
    })
}

fn clean(s: &str, max_chars: usize) -> bool {
    s.chars().count() <= max_chars && !s.chars().any(|c| c.is_control())
}

fn date_shape(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        })
}

fn finite_in(x: f64, max: f64) -> bool {
    x.is_finite() && x >= 0.0 && x <= max
}

impl WireInvoice {
    /// فحص بنيوي يحمي الخادم والتخزين (أنواع، أطوال، نطاقات). القواعد التجارية
    /// (وجود التاجر/الصندوق، الوزن الصافي...) تُفحَص على الكمبيوتر وقت المراجعة.
    pub fn validate(&self) -> Result<(), Invalid> {
        if !is_uuid(&self.uid) {
            return Err(bad("bad_uid", "معرّف الفاتورة غير صالح"));
        }
        if !clean(&self.created_at, 40) {
            return Err(bad("bad_created_at", "وقت إنشاء الفاتورة غير صالح"));
        }
        if !date_shape(&self.invoice_date) {
            return Err(bad("bad_date", "تاريخ الفاتورة غير صالح"));
        }
        if self.merchant_id <= 0 {
            return Err(bad("bad_merchant", "معرّف التاجر غير صالح"));
        }
        if let Some(h) = &self.merchant_name_hint {
            if !clean(h, 200) {
                return Err(bad("bad_merchant_hint", "اسم التاجر غير صالح"));
            }
        }
        if self.lines.is_empty() {
            return Err(bad("no_lines", "الفاتورة بلا بنود"));
        }
        if self.lines.len() > MAX_LINES_PER_INVOICE {
            return Err(bad("too_many_lines", "عدد بنود الفاتورة يتجاوز الحد المسموح"));
        }
        for (i, l) in self.lines.iter().enumerate() {
            let n = i + 1;
            if !clean(&l.product_name, 200) {
                return Err(Invalid { code: "bad_product", message: format!("اسم المنتج غير صالح في البند {n}") });
            }
            if let Some(lid) = &l.lid {
                if !clean(lid, 64) {
                    return Err(Invalid { code: "bad_line_id", message: format!("معرّف البند {n} غير صالح") });
                }
            }
            if !finite_in(l.scale_weight, 10_000_000.0) {
                return Err(Invalid { code: "bad_weight", message: format!("وزن الميزان غير صالح في البند {n}") });
            }
            if !finite_in(l.price, 1_000_000_000.0) {
                return Err(Invalid { code: "bad_price", message: format!("السعر غير صالح في البند {n}") });
            }
            if l.boxes.len() > MAX_BOXES_PER_LINE {
                return Err(Invalid { code: "too_many_boxes", message: format!("عدد أنواع الصناديق في البند {n} يتجاوز الحد") });
            }
            for b in &l.boxes {
                if b.box_id <= 0 || b.box_count < 0 || b.box_count > 1_000_000 {
                    return Err(Invalid { code: "bad_box", message: format!("بيانات الصناديق غير صالحة في البند {n}") });
                }
            }
            for v in [l.phone_net_weight, l.phone_subtotal].into_iter().flatten() {
                if !v.is_finite() {
                    return Err(Invalid { code: "bad_phone_value", message: format!("قيمة غير صالحة في البند {n}") });
                }
            }
        }
        if let Some(t) = self.phone_total {
            if !t.is_finite() {
                return Err(bad("bad_phone_value", "قيمة إجمالي غير صالحة"));
            }
        }
        Ok(())
    }

    pub fn content_hash(&self) -> String {
        let bytes = serde_json::to_vec(self).unwrap_or_default();
        fsutil::hex(&Sha256::digest(&bytes))
    }
}

// ───────────────────────── السجلات ─────────────────────────

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Pending,
    Saving,
    Confirmed,
    Rejected,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavingInfo {
    pub started_at: String,
    #[serde(default)]
    pub invoice_id: Option<i64>,
    #[serde(default)]
    pub invoice_number: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub uid: String,
    pub state: State,
    pub received_at: String,
    pub receive_count: u32,
    pub content_hash: String,
    #[serde(default)]
    pub device_label: Option<String>,
    #[serde(default)]
    pub remote_ip: Option<String>,
    pub invoice: WireInvoice,
    #[serde(default)]
    pub saving: Option<SavingInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub uid: String,
    pub state: State,
    pub at: String,
    #[serde(default)]
    pub final_invoice_id: Option<i64>,
    #[serde(default)]
    pub final_invoice_number: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub merchant_name: Option<String>,
    #[serde(default)]
    pub total: Option<f64>,
}

/// ما يراه الهاتف عن فاتورة: نتيجة الاستلام أو نتيجة استعلام الحالة.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub uid: String,
    /// pending | confirmed | rejected | unknown | invalid | error
    pub status: String,
    pub duplicate: bool,
    pub content_changed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl Receipt {
    fn base(uid: &str, status: &str) -> Receipt {
        Receipt {
            uid: uid.to_string(),
            status: status.to_string(),
            duplicate: false,
            content_changed: false,
            final_number: None,
            reason: None,
            code: None,
            message: None,
        }
    }
}

pub struct SubmitOutcome {
    pub receipts: Vec<Receipt>,
    pub new_count: usize,
}

#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub pending: usize,
    pub saving: usize,
}

enum Slot {
    Live(Record),
    Done(LedgerEntry),
}

struct Inner {
    inbox_dir: PathBuf,
    ledger_path: PathBuf,
    index: HashMap<String, Slot>,
    recent: VecDeque<LedgerEntry>,
}

pub struct Store {
    inner: Mutex<Inner>,
}

// ───────────────────────── عمليات الملفات ─────────────────────────

fn record_path(dir: &Path, uid: &str) -> PathBuf {
    dir.join(format!("{uid}.json"))
}

fn write_record(dir: &Path, rec: &Record) -> Result<(), String> {
    fsutil::write_json(&record_path(dir, &rec.uid), rec)
}

fn append_ledger(path: &Path, entry: &LedgerEntry) -> Result<(), String> {
    let mut line = serde_json::to_vec(entry).map_err(|e| e.to_string())?;
    line.push(b'\n');
    let mut f = OpenOptions::new()
        .create(true)
        .read(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("تعذّر فتح سجل القرارات: {e}"))?;
    // سطر أخير ناقص (انقطاع أثناء كتابة سابقة) لا يجب أن يلتصق به السطر الجديد.
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    if len > 0 {
        let mut last = [0u8; 1];
        f.seek(SeekFrom::End(-1)).map_err(|e| e.to_string())?;
        f.read_exact(&mut last).map_err(|e| e.to_string())?;
        if last[0] != b'\n' {
            f.write_all(b"\n").map_err(|e| e.to_string())?;
        }
    }
    f.write_all(&line).map_err(|e| format!("تعذّر الكتابة في سجل القرارات: {e}"))?;
    f.sync_data().map_err(|e| format!("تعذّر تثبيت سجل القرارات: {e}"))?;
    Ok(())
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Store {
    pub fn open(dir: &Path) -> Result<(Store, Vec<String>), String> {
        let inbox_dir = dir.join("inbox");
        fs::create_dir_all(&inbox_dir).map_err(|e| format!("تعذّر إنشاء مجلد الفواتير الواردة: {e}"))?;
        let ledger_path = dir.join("ledger.jsonl");
        let mut warnings: Vec<String> = Vec::new();
        let mut index: HashMap<String, Slot> = HashMap::new();
        let mut recent: VecDeque<LedgerEntry> = VecDeque::new();

        if let Ok(text) = fs::read_to_string(&ledger_path) {
            let mut skipped = 0usize;
            for line in text.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                match serde_json::from_str::<LedgerEntry>(line) {
                    Ok(e) if is_uuid(&e.uid) && matches!(e.state, State::Confirmed | State::Rejected) => {
                        if recent.len() >= RECENT_KEEP {
                            recent.pop_front();
                        }
                        recent.push_back(e.clone());
                        index.insert(e.uid.clone(), Slot::Done(e));
                    }
                    _ => skipped += 1,
                }
            }
            if skipped > 0 {
                warnings.push(format!("تم تجاهل {skipped} سطراً تالفاً في سجل القرارات"));
            }
        }

        if let Ok(rd) = fs::read_dir(&inbox_dir) {
            for entry in rd.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                if name.contains(".tmp-") {
                    let _ = fs::remove_file(&path);
                    continue;
                }
                let Some(stem) = name.strip_suffix(".json") else { continue };
                if !is_uuid(stem) {
                    continue;
                }
                match fsutil::read_json::<Record>(&path) {
                    Ok(Some(rec)) if rec.uid == stem && rec.invoice.validate().is_ok() => {
                        if matches!(index.get(&rec.uid), Some(Slot::Done(_))) {
                            // قرار نهائي موجود في السجل — ملف inbox بقية انقطاع.
                            let _ = fs::remove_file(&path);
                        } else if matches!(rec.state, State::Pending | State::Saving) {
                            index.insert(rec.uid.clone(), Slot::Live(rec));
                        }
                    }
                    _ => {
                        let corrupt = inbox_dir.join(format!("{name}.corrupt"));
                        let _ = fs::rename(&path, &corrupt);
                        warnings.push(format!("ملف فاتورة واردة تالف نُقل جانباً: {name}"));
                    }
                }
            }
        }

        Ok((Store { inner: Mutex::new(Inner { inbox_dir, ledger_path, index, recent }) }, warnings))
    }

    // ───────── من الهاتف ─────────

    pub fn submit(
        &self,
        items: Vec<Value>,
        device_label: Option<String>,
        remote_ip: Option<String>,
    ) -> SubmitOutcome {
        let mut g = lock(&self.inner);
        let mut receipts = Vec::with_capacity(items.len());
        let mut new_count = 0usize;

        for item in items {
            let raw_uid = item.get("uid").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let echo_uid: String = if is_uuid(&raw_uid) { raw_uid.clone() } else { String::new() };

            let invoice: WireInvoice = match serde_json::from_value(item) {
                Ok(i) => i,
                Err(_) => {
                    let mut r = Receipt::base(&echo_uid, "invalid");
                    r.code = Some("bad_shape".into());
                    r.message = Some("تعذّر قراءة بيانات الفاتورة".into());
                    receipts.push(r);
                    continue;
                }
            };
            if let Err(inv) = invoice.validate() {
                let mut r = Receipt::base(&echo_uid, "invalid");
                r.code = Some(inv.code.into());
                r.message = Some(inv.message);
                receipts.push(r);
                continue;
            }

            let uid = invoice.uid.clone();
            let hash = invoice.content_hash();

            match g.index.get(&uid) {
                Some(Slot::Done(entry)) => {
                    let mut r = Receipt::base(
                        &uid,
                        if entry.state == State::Confirmed { "confirmed" } else { "rejected" },
                    );
                    r.duplicate = true;
                    r.final_number = entry.final_invoice_number.clone();
                    r.reason = entry.reason.clone();
                    receipts.push(r);
                }
                Some(Slot::Live(rec)) => {
                    let mut r = Receipt::base(&uid, "pending");
                    r.duplicate = true;
                    r.content_changed = rec.content_hash != hash;
                    receipts.push(r);
                }
                None => {
                    let record = Record {
                        uid: uid.clone(),
                        state: State::Pending,
                        received_at: fsutil::now_rfc3339(),
                        receive_count: 1,
                        content_hash: hash,
                        device_label: device_label.clone(),
                        remote_ip: remote_ip.clone(),
                        invoice,
                        saving: None,
                    };
                    match write_record(&g.inbox_dir, &record) {
                        Ok(()) => {
                            g.index.insert(uid.clone(), Slot::Live(record));
                            new_count += 1;
                            receipts.push(Receipt::base(&uid, "pending"));
                        }
                        Err(e) => {
                            let mut r = Receipt::base(&uid, "error");
                            r.code = Some("store_failed".into());
                            r.message = Some(format!("تعذّر حفظ الفاتورة على الكمبيوتر: {e}"));
                            receipts.push(r);
                        }
                    }
                }
            }
        }
        SubmitOutcome { receipts, new_count }
    }

    pub fn status(&self, uids: &[String]) -> Vec<Receipt> {
        let g = lock(&self.inner);
        uids.iter()
            .map(|uid| match g.index.get(uid) {
                Some(Slot::Done(e)) => {
                    let mut r = Receipt::base(
                        uid,
                        if e.state == State::Confirmed { "confirmed" } else { "rejected" },
                    );
                    r.final_number = e.final_invoice_number.clone();
                    r.reason = e.reason.clone();
                    r
                }
                Some(Slot::Live(_)) => Receipt::base(uid, "pending"),
                None => Receipt::base(uid, "unknown"),
            })
            .collect()
    }

    // ───────── من واجهة سطح المكتب ─────────

    pub fn list_inbox(&self) -> Vec<Record> {
        let g = lock(&self.inner);
        let mut v: Vec<Record> = g
            .index
            .values()
            .filter_map(|s| if let Slot::Live(r) = s { Some(r.clone()) } else { None })
            .collect();
        v.sort_by(|a, b| a.received_at.cmp(&b.received_at).then(a.uid.cmp(&b.uid)));
        v
    }

    pub fn counts(&self) -> Counts {
        let g = lock(&self.inner);
        let mut c = Counts::default();
        for s in g.index.values() {
            if let Slot::Live(r) = s {
                match r.state {
                    State::Pending => c.pending += 1,
                    State::Saving => c.saving += 1,
                    _ => {}
                }
            }
        }
        c
    }

    pub fn recent_decisions(&self, n: usize) -> Vec<LedgerEntry> {
        let g = lock(&self.inner);
        g.recent.iter().rev().take(n).cloned().collect()
    }

    /// pending → saving (يُثبَّت على القرص قبل لمس قاعدة البيانات الرئيسية). إن كانت
    /// saving أصلاً (استئناف بعد انقطاع) تُعاد كما هي ليقرّر المستدعي.
    pub fn begin_save(&self, uid: &str) -> Result<Record, String> {
        let mut g = lock(&self.inner);
        let dir = g.inbox_dir.clone();
        match g.index.get_mut(uid) {
            Some(Slot::Live(rec)) => {
                if rec.state == State::Pending {
                    let mut updated = rec.clone();
                    updated.state = State::Saving;
                    updated.saving = Some(SavingInfo {
                        started_at: fsutil::now_rfc3339(),
                        invoice_id: None,
                        invoice_number: None,
                    });
                    write_record(&dir, &updated)?;
                    *rec = updated;
                }
                Ok(rec.clone())
            }
            Some(Slot::Done(_)) => Err("تم اتخاذ قرار نهائي بشأن هذه الفاتورة من قبل".into()),
            None => Err("الفاتورة غير موجودة بين الفواتير الواردة".into()),
        }
    }

    pub fn record_saved(&self, uid: &str, invoice_id: i64, number: &str) -> Result<(), String> {
        let mut g = lock(&self.inner);
        let dir = g.inbox_dir.clone();
        match g.index.get_mut(uid) {
            Some(Slot::Live(rec)) if rec.state == State::Saving => {
                let mut updated = rec.clone();
                let started = updated
                    .saving
                    .as_ref()
                    .map(|s| s.started_at.clone())
                    .unwrap_or_else(fsutil::now_rfc3339);
                updated.saving = Some(SavingInfo {
                    started_at: started,
                    invoice_id: Some(invoice_id),
                    invoice_number: Some(number.to_string()),
                });
                write_record(&dir, &updated)?;
                *rec = updated;
                Ok(())
            }
            _ => Err("الفاتورة ليست قيد الحفظ".into()),
        }
    }

    pub fn abort_save(&self, uid: &str) -> Result<(), String> {
        let mut g = lock(&self.inner);
        let dir = g.inbox_dir.clone();
        match g.index.get_mut(uid) {
            Some(Slot::Live(rec)) => {
                if rec.state == State::Saving {
                    let mut updated = rec.clone();
                    updated.state = State::Pending;
                    updated.saving = None;
                    write_record(&dir, &updated)?;
                    *rec = updated;
                }
                Ok(())
            }
            _ => Err("الفاتورة غير موجودة بين الفواتير الواردة".into()),
        }
    }

    pub fn mark_confirmed(
        &self,
        uid: &str,
        invoice_id: i64,
        invoice_number: &str,
        merchant_name: Option<String>,
        total: Option<f64>,
    ) -> Result<(), String> {
        let mut g = lock(&self.inner);
        if !matches!(g.index.get(uid), Some(Slot::Live(_))) {
            return Err("الفاتورة غير موجودة بين الفواتير الواردة".into());
        }
        let entry = LedgerEntry {
            uid: uid.to_string(),
            state: State::Confirmed,
            at: fsutil::now_rfc3339(),
            final_invoice_id: Some(invoice_id),
            final_invoice_number: Some(invoice_number.to_string()),
            reason: None,
            merchant_name,
            total,
        };
        // السجل أولاً (مع fsync) ثم حذف ملف inbox — راجع تعليق رأس الملف.
        append_ledger(&g.ledger_path, &entry)?;
        let _ = fs::remove_file(record_path(&g.inbox_dir, uid));
        if g.recent.len() >= RECENT_KEEP {
            g.recent.pop_front();
        }
        g.recent.push_back(entry.clone());
        g.index.insert(uid.to_string(), Slot::Done(entry));
        Ok(())
    }

    pub fn reject(&self, uid: &str, reason: Option<String>) -> Result<(), String> {
        let mut g = lock(&self.inner);
        let (merchant_hint, total) = match g.index.get(uid) {
            Some(Slot::Live(rec)) if rec.state == State::Pending => {
                (rec.invoice.merchant_name_hint.clone(), rec.invoice.phone_total)
            }
            Some(Slot::Live(_)) => return Err("الفاتورة قيد الحفظ حالياً — لا يمكن رفضها".into()),
            _ => return Err("الفاتورة غير موجودة بين الفواتير الواردة".into()),
        };
        let reason = reason
            .map(|r| r.trim().chars().take(300).collect::<String>())
            .filter(|r| !r.is_empty());
        let entry = LedgerEntry {
            uid: uid.to_string(),
            state: State::Rejected,
            at: fsutil::now_rfc3339(),
            final_invoice_id: None,
            final_invoice_number: None,
            reason,
            merchant_name: merchant_hint,
            total,
        };
        append_ledger(&g.ledger_path, &entry)?;
        let _ = fs::remove_file(record_path(&g.inbox_dir, uid));
        if g.recent.len() >= RECENT_KEEP {
            g.recent.pop_front();
        }
        g.recent.push_back(entry.clone());
        g.index.insert(uid.to_string(), Slot::Done(entry));
        Ok(())
    }
}
