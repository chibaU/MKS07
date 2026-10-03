// مكوّن خفي يبقى مُركَّباً طوال عمر التطبيق (يُرسَم في App.tsx) لسببين فقط:
//  ١) الإجابة عن طلب الهاتف للبيانات الأساسية (التجار + الصناديق النشطة) حتى لو
//     كان المستخدم في صفحة أخرى — يقرأ عبر db.ts القائمة (قراءة فقط) ويردّ لـ Rust.
//  ٢) إظهار شريط تنبيه صغير حين تصل فواتير من الهاتف والمستخدم خارج صفحة المزامنة.
// لا يكتب في القاعدة إطلاقاً. أي فشل هنا يُسجَّل في console فقط (المتطلب 26).
import { useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { boxService, merchantService } from "../../services/db";
import { errText, onInvoicesReceived, onSnapshotRequest, phoneSyncApi } from "./bridge";
import type { PhoneSnapshot } from "./types";

interface Props {
  pageActive: boolean;
  onOpenPage: () => void;
}

async function readSnapshot(): Promise<PhoneSnapshot> {
  const [merchants, boxes] = await Promise.all([merchantService.getAll(), boxService.getVisible()]);
  return {
    merchants: merchants.map((m) => ({ id: m.id, name: m.name })),
    boxes: boxes.map((b) => ({ id: b.id, name: b.name, weight: b.weight })),
  };
}

export function PhoneSyncHost({ pageActive, onOpenPage }: Props) {
  const [received, setReceived] = useState(0);
  const pageActiveRef = useRef(pageActive);
  useEffect(() => {
    pageActiveRef.current = pageActive;
  }, [pageActive]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    const attach = (p: Promise<UnlistenFn>) => {
      p.then((un) => {
        if (disposed) un();
        else unlisteners.push(un);
      }).catch((e) => console.error("phone-sync: تعذر الاشتراك في الأحداث:", errText(e)));
    };

    attach(
      onSnapshotRequest(async (requestId) => {
        try {
          await phoneSyncApi.provideSnapshot(requestId, await readSnapshot());
        } catch (e) {
          console.error("phone-sync: تعذر تجهيز البيانات للهاتف:", errText(e));
        }
      }),
    );
    attach(
      onInvoicesReceived((count) => {
        if (!pageActiveRef.current) setReceived((n) => n + count);
      }),
    );

    // تهيئة الذاكرة المؤقتة في Rust: لو تأخّرت الواجهة يوماً عن الردّ، تُخدَم آخر لقطة.
    const prime = setTimeout(() => {
      readSnapshot()
        .then((snap) => phoneSyncApi.provideSnapshot(null, snap))
        .catch(() => { /* خارج Tauri (متصفح التطوير) أو الخدمة غير جاهزة — لا يهم */ });
    }, 2500);

    return () => {
      disposed = true;
      clearTimeout(prime);
      unlisteners.forEach((un) => un());
    };
  }, []);

  useEffect(() => {
    if (pageActive) setReceived(0);
  }, [pageActive]);

  if (received === 0 || pageActive) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed", bottom: 20, left: 20, zIndex: 300, direction: "rtl",
        background: "#1E293B", color: "#fff", borderRadius: 12, padding: "14px 18px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)", fontFamily: "'Cairo', sans-serif",
        display: "flex", alignItems: "center", gap: 14, fontSize: 15,
      }}
    >
      <span>📱 وصلت {received} فاتورة من الهاتف وتنتظر مراجعتك</span>
      <button
        type="button"
        onClick={onOpenPage}
        style={{ background: "#2563EB", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontFamily: "'Cairo', sans-serif", fontWeight: 700 }}
      >
        مراجعة
      </button>
      <button
        type="button"
        aria-label="إغلاق"
        onClick={() => setReceived(0)}
        style={{ background: "transparent", color: "#94A3B8", border: "none", cursor: "pointer", fontSize: 18 }}
      >
        ✕
      </button>
    </div>
  );
}
