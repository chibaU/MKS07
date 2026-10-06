// تحديد معدّل محاولات المفتاح الخاطئة لكل عنوان IP — دفاع إضافي رخيص فوق عشوائية
// المفتاح (80 بت). ليس نظام جلسات: لا يحتفظ بشيء عن الأجهزة الناجحة.

use super::consts::*;
use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Default)]
struct Entry {
    failures: VecDeque<Instant>,
    locked_until: Option<Instant>,
}

#[derive(Default)]
pub struct Throttle {
    inner: Mutex<HashMap<IpAddr, Entry>>,
}

impl Throttle {
    /// Err(ثوانٍ متبقية) إن كان هذا العنوان محظوراً مؤقتاً.
    pub fn check(&self, ip: IpAddr) -> Result<(), u64> {
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = map.get_mut(&ip) {
            if let Some(until) = entry.locked_until {
                let now = Instant::now();
                if until > now {
                    return Err((until - now).as_secs().max(1));
                }
                entry.locked_until = None;
                entry.failures.clear();
            }
        }
        Ok(())
    }

    /// يُرجع true إن تسبّبت هذه المحاولة في بدء الحظر.
    pub fn record_failure(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let window = Duration::from_secs(THROTTLE_WINDOW_SECS);
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if map.len() > 2000 {
            map.retain(|_, e| e.locked_until.map_or(false, |u| u > now) || !e.failures.is_empty());
        }
        let entry = map.entry(ip).or_default();
        while let Some(front) = entry.failures.front() {
            if now.duration_since(*front) > window {
                entry.failures.pop_front();
            } else {
                break;
            }
        }
        entry.failures.push_back(now);
        if entry.failures.len() >= THROTTLE_MAX_FAILURES {
            entry.locked_until = Some(now + Duration::from_secs(THROTTLE_LOCK_SECS));
            return true;
        }
        false
    }

    pub fn record_success(&self, ip: IpAddr) {
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(&ip);
    }
}
