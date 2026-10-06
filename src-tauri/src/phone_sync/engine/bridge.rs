// جسر الكتالوج بين خادم الهاتف (Rust) وواجهة سطح المكتب (JS).
//
// لماذا جسر؟ قاعدة بيانات MKS يملكها JS وحده عبر tauri-plugin-sql وdb.ts (قرار
// معماري ثابت في المشروع). فلا يقرأ Rust التجار والصناديق بنفسه؛ عندما يطلبها
// هاتف، يرسل Rust حدثاً إلى الواجهة فتقرأ الحقيقة الحالية من db.ts وتردّ.
//
// إن لم تردّ الواجهة في المهلة (مغلقة أو معلّقة) يُقدَّم آخر نسخة نشرتها الواجهة
// (snapshot) مع وسمها بأنها قديمة — فيبقى الهاتف قادراً على العمل لا أن يفشل.

use super::fsutil::now_rfc3339;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, RwLock};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, Clone)]
pub enum BridgeEvent {
    CatalogRequest { id: u64 },
    InboxChanged,
    StatusChanged,
}

pub enum CatalogReply {
    Ok(Value),
    Err(String),
}

#[derive(Debug, Clone)]
pub enum CatalogResult {
    Live { catalog: Value, at: String },
    Snapshot { catalog: Value, at: String, note: Option<String> },
    Unavailable(String),
}

struct Snapshot {
    catalog: Value,
    at: String,
}

pub struct CatalogBridge {
    next_id: AtomicU64,
    waiting: Mutex<HashMap<u64, oneshot::Sender<CatalogReply>>>,
    snapshot: RwLock<Option<Snapshot>>,
    provider_ready: AtomicBool,
    tx: mpsc::UnboundedSender<BridgeEvent>,
}

/// كتالوج صالح = كائن فيه مصفوفتا merchants وboxes.
pub fn catalog_is_valid(v: &Value) -> bool {
    v.get("merchants").map_or(false, |m| m.is_array()) && v.get("boxes").map_or(false, |b| b.is_array())
}

impl CatalogBridge {
    pub fn new(tx: mpsc::UnboundedSender<BridgeEvent>) -> Self {
        CatalogBridge {
            next_id: AtomicU64::new(1),
            waiting: Mutex::new(HashMap::new()),
            snapshot: RwLock::new(None),
            provider_ready: AtomicBool::new(false),
            tx,
        }
    }

    pub fn set_provider_ready(&self, ready: bool) {
        self.provider_ready.store(ready, Ordering::SeqCst);
    }

    pub fn provider_ready(&self) -> bool {
        self.provider_ready.load(Ordering::SeqCst)
    }

    pub fn publish(&self, catalog: Value) -> Result<(), String> {
        if !catalog_is_valid(&catalog) {
            return Err("شكل الكتالوج غير صالح".into());
        }
        *self.snapshot.write().unwrap_or_else(|e| e.into_inner()) =
            Some(Snapshot { catalog, at: now_rfc3339() });
        Ok(())
    }

    pub fn provide(&self, id: u64, reply: CatalogReply) {
        // نسخة جديدة وصلت — حتى لو تأخرت عن مهلة الطلب، تُحدّث الـsnapshot.
        if let CatalogReply::Ok(v) = &reply {
            if catalog_is_valid(v) {
                let _ = self.publish(v.clone());
                self.provider_ready.store(true, Ordering::SeqCst);
            }
        }
        let tx = self.waiting.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        if let Some(tx) = tx {
            let _ = tx.send(reply);
        }
    }

    fn snapshot_result(&self, note: Option<String>) -> CatalogResult {
        match &*self.snapshot.read().unwrap_or_else(|e| e.into_inner()) {
            Some(s) => CatalogResult::Snapshot { catalog: s.catalog.clone(), at: s.at.clone(), note },
            None => CatalogResult::Unavailable(
                note.unwrap_or_else(|| "لا تتوفر بيانات بعد — افتح صفحة مزامنة الهاتف على الكمبيوتر".into()),
            ),
        }
    }

    pub async fn request(&self, wait: Duration) -> CatalogResult {
        if !self.provider_ready() {
            return self.snapshot_result(None);
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (otx, orx) = oneshot::channel();
        self.waiting.lock().unwrap_or_else(|e| e.into_inner()).insert(id, otx);
        if self.tx.send(BridgeEvent::CatalogRequest { id }).is_err() {
            self.waiting.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            return self.snapshot_result(None);
        }
        match tokio::time::timeout(wait, orx).await {
            Ok(Ok(CatalogReply::Ok(v))) if catalog_is_valid(&v) => {
                CatalogResult::Live { catalog: v, at: now_rfc3339() }
            }
            Ok(Ok(CatalogReply::Err(e))) => self.snapshot_result(Some(e)),
            Ok(Ok(CatalogReply::Ok(_))) => self.snapshot_result(Some("شكل الكتالوج المستلم غير صالح".into())),
            _ => {
                self.waiting.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
                // الواجهة لا تستجيب: لا ننتظر المهلة كاملة مع كل طلب لاحق حتى تعود.
                self.provider_ready.store(false, Ordering::SeqCst);
                self.snapshot_result(None)
            }
        }
    }
}
