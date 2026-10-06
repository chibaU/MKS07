// خادم اختبار: يشغّل المحرّك الحقيقي ويحاكي واجهة سطح المكتب (JS) عبر stdin — يستخدمه tests/phone-sync/e2e.test.mjs.
// الأوامر عبر stdin: catalog <json> | inbox | confirm <uid> <number> | reject <uid> <reason> | quit
use phone_sync_harness::engine::bridge::{BridgeEvent, CatalogReply};
use phone_sync_harness::engine::config::Config;
use phone_sync_harness::engine::Engine;
use serde_json::{json, Value};
use std::io::BufRead;
use std::sync::{Arc, Mutex};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir = std::path::PathBuf::from(&args[1]);
    let port: u16 = args[2].parse().unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    let mut cfg = Config::load_or_create(&dir).unwrap();
    cfg.preferred_port = port;
    cfg.save(&dir).unwrap();

    let engine = Arc::new(Engine::new(dir.clone()).unwrap());
    let catalog: Arc<Mutex<Value>> = Arc::new(Mutex::new(json!({
        "merchants": [{"id": 7, "name": "أحمد"}, {"id": 8, "name": "سعيد"}],
        "boxes": [{"id": 2, "name": "صندوق كبير", "weight": 1.8}, {"id": 3, "name": "صندوق صغير", "weight": 0.9}]
    })));

    let mut rx = engine.take_events_rx().unwrap();
    let bridge = engine.bridge();
    bridge.set_provider_ready(true);
    let cat2 = catalog.clone();
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(1).enable_all().build().unwrap();
    rt.spawn(async move {
        while let Some(ev) = rx.recv().await {
            if let BridgeEvent::CatalogRequest { id } = ev {
                let mut c = cat2.lock().unwrap().clone();
                c["generatedAt"] = json!("2026-10-03T10:00:00Z");
                bridge.provide(id, CatalogReply::Ok(c));
            }
        }
    });

    engine.start().unwrap();
    let st = engine.status();
    println!("READY {} {}", st.port.unwrap(), st.access_key);
    let store = engine.store();
    for line in std::io::stdin().lock().lines() {
        let line = line.unwrap();
        if let Some(json) = line.strip_prefix("catalog ") {
            // الـJSON قد يحوي مسافات (أسماء عربية) فنأخذ بقية السطر كاملاً.
            *catalog.lock().unwrap() = serde_json::from_str(json).unwrap();
            println!("OK catalog");
            continue;
        }
        let mut it = line.splitn(3, ' ');
        match it.next().unwrap_or("") {
            "inbox" => println!("INBOX {}", serde_json::to_string(&store.list_inbox()).unwrap()),
            "confirm" => {
                let uid = it.next().unwrap();
                let num = it.next().unwrap();
                store.begin_save(uid).unwrap();
                store.mark_confirmed(uid, 1, num, None, None).unwrap();
                println!("OK confirm");
            }
            "reject" => {
                let uid = it.next().unwrap();
                store.reject(uid, it.next().map(|s| s.to_string())).unwrap();
                println!("OK reject");
            }
            "quit" => break,
            _ => println!("ERR unknown"),
        }
    }
    engine.stop();
}
