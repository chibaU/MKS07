// حالة صفحة «مزامنة الهاتف» — مستقلة تماماً عن حالة App.tsx (المتطلب 1).
import { useCallback, useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { errText, onInvoicesReceived, phoneSyncApi } from "./bridge";
import type { PhoneInvoiceRecord, ServiceInfo } from "./types";

export function usePhoneSync() {
  const [info, setInfo] = useState<ServiceInfo | null>(null);
  const [records, setRecords] = useState<PhoneInvoiceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    try {
      const list = await phoneSyncApi.list();
      if (mounted.current) setRecords(list);
    } catch (e) {
      if (mounted.current) setError(`تعذر قراءة الفواتير المعلَّقة: ${errText(e)}`);
    }
  }, []);

  const run = useCallback(async (fn: () => Promise<ServiceInfo>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (mounted.current) setInfo(next);
    } catch (e) {
      if (mounted.current) setError(errText(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  const start = useCallback(() => run(phoneSyncApi.start), [run]);
  const stop = useCallback(() => run(phoneSyncApi.stop), [run]);
  const regenerateKey = useCallback(() => run(phoneSyncApi.regenerateKey), [run]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    (async () => {
      try {
        const current = await phoneSyncApi.info();
        if (disposed) return;
        setInfo(current);
        await reload();
        // فتح الصفحة = نية استخدام الميزة: نشغّل الخدمة تلقائياً إن لم تكن تعمل.
        if (!current.running && !disposed) await run(phoneSyncApi.start);
      } catch (e) {
        if (!disposed) setError(errText(e));
      } finally {
        if (!disposed) setLoaded(true);
      }
      try {
        const un = await onInvoicesReceived(() => { void reload(); });
        if (disposed) un();
        else unlisten = un;
      } catch { /* خارج Tauri */ }
    })();

    return () => {
      disposed = true;
      mounted.current = false;
      unlisten?.();
    };
  }, [reload, run]);

  return { info, records, error, busy, loaded, reload, start, stop, regenerateKey, setError };
}
