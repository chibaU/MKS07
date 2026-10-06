// ============================================================================
// الجسر مع Rust — الملف الوحيد في الميزة الذي يستورد @tauri-apps/api.
// كل أوامر Rust هنا بالبادئة phone_sync_ (راجع src-tauri/src/phone_sync/mod.rs).
// وسائط invoke تُكتب camelCase وتتحوّل تلقائياً إلى snake_case في Rust.
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Catalog, InboxRecord, LedgerEntry, ServiceStatus } from "./types.ts";

export const bridge = {
  status: () => invoke<ServiceStatus>("phone_sync_status"),
  start: () => invoke<ServiceStatus>("phone_sync_start"),
  stop: () => invoke<ServiceStatus>("phone_sync_stop"),
  rotateKey: () => invoke<ServiceStatus>("phone_sync_rotate_key"),
  /** يحفظ ملف شهادة الأمان في مجلد التنزيلات ويُرجع مساره (نقل يدوي إلى الهاتف). */
  exportCa: () => invoke<string>("phone_sync_export_ca"),

  setProviderReady: (ready: boolean) => invoke<void>("phone_sync_set_provider_ready", { ready }),
  publishCatalog: (catalog: Catalog) => invoke<void>("phone_sync_publish_catalog", { catalog }),
  provideCatalog: (requestId: number, catalog: Catalog) =>
    invoke<void>("phone_sync_provide_catalog", { requestId, catalog }),
  provideCatalogError: (requestId: number, error: string) =>
    invoke<void>("phone_sync_provide_catalog", { requestId, error }),

  listInbox: () => invoke<InboxRecord[]>("phone_sync_list_inbox"),
  recentDecisions: (limit: number) => invoke<LedgerEntry[]>("phone_sync_recent_decisions", { limit }),
  beginSave: (uid: string) => invoke<InboxRecord>("phone_sync_begin_save", { uid }),
  recordSaved: (uid: string, invoiceId: number, invoiceNumber: string) =>
    invoke<void>("phone_sync_record_saved", { uid, invoiceId, invoiceNumber }),
  abortSave: (uid: string) => invoke<void>("phone_sync_abort_save", { uid }),
  markConfirmed: (uid: string, invoiceId: number, invoiceNumber: string, merchantName: string | null, total: number | null) =>
    invoke<void>("phone_sync_mark_confirmed", { uid, invoiceId, invoiceNumber, merchantName, total }),
  reject: (uid: string, reason: string | null) => invoke<void>("phone_sync_reject", { uid, reason }),

  onCatalogRequest: (cb: (requestId: number) => void): Promise<UnlistenFn> =>
    listen<{ requestId: number }>("phone-sync://catalog-request", (e) => cb(e.payload.requestId)),
  onInboxChanged: (cb: () => void): Promise<UnlistenFn> => listen("phone-sync://inbox-changed", () => cb()),
  onStatusChanged: (cb: () => void): Promise<UnlistenFn> => listen("phone-sync://status-changed", () => cb()),
};

/** رسالة عربية مفهومة من أي خطأ قادم من invoke (نص) أو من JS (Error). */
export function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
