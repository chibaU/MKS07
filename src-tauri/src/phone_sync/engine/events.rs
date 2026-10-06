// سجل أنشطة قصير في الذاكرة (آخر 100 حدث) يعرضه تطبيق سطح المكتب للمستخدم
// ليعرف ماذا يحدث: طلب بيانات، استلام فواتير، محاولة اتصال فاشلة بسبب الشهادة...
// لا يُخزَّن على القرص ولا يحوي بيانات فواتير — أسطر وصفية فقط.

use super::fsutil::now_rfc3339;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const CAPACITY: usize = 100;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub seq: u64,
    pub at: String,
    pub kind: String,
    pub ip: Option<String>,
    pub message: String,
}

#[derive(Default)]
pub struct EventLog {
    inner: Mutex<VecDeque<Event>>,
    seq: AtomicU64,
}

impl EventLog {
    pub fn push(&self, kind: &str, ip: Option<String>, message: impl Into<String>) {
        let ev = Event {
            seq: self.seq.fetch_add(1, Ordering::Relaxed) + 1,
            at: now_rfc3339(),
            kind: kind.to_string(),
            ip,
            message: message.into(),
        };
        let mut q = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if q.len() >= CAPACITY {
            q.pop_front();
        }
        q.push_back(ev);
    }

    /// الأحدث أولاً.
    pub fn recent(&self, n: usize) -> Vec<Event> {
        let q = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        q.iter().rev().take(n).cloned().collect()
    }
}
