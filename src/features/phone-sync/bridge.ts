// الجسر بين واجهة هذه الميزة وأوامر Rust. كل استدعاء هنا يُرجع خطأً نصياً
// مفهوماً بدل رمي استثناءات خام، فلا يتسرب فشل الميزة إلى بقية التطبيق (المتطلب 26).
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  INVOICES_RECEIVED_EVENT,
  SNAPSHOT_REQUEST_EVENT,
  type PhoneInvoiceRecord,
  type PhoneSnapshot,
  type ServiceInfo,
} from "./types";

export function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "حدث خطأ غير متوقع";
}

export const phoneSyncApi = {
  info: () => invoke<ServiceInfo>("phone_sync_info"),
  start: () => invoke<ServiceInfo>("phone_sync_start"),
  stop: () => invoke<ServiceInfo>("phone_sync_stop"),
  regenerateKey: () => invoke<ServiceInfo>("phone_sync_regenerate_key"),
  list: () => invoke<PhoneInvoiceRecord[]>("phone_sync_list"),
  confirm: (clientId: string, invoiceNumber: string, desktopInvoiceId: number) =>
    invoke<PhoneInvoiceRecord>("phone_sync_confirm", { clientId, invoiceNumber, desktopInvoiceId }),
  reject: (clientId: string, reason: string) =>
    invoke<PhoneInvoiceRecord>("phone_sync_reject", { clientId, reason }),
  reopen: (clientId: string) => invoke<PhoneInvoiceRecord>("phone_sync_reopen", { clientId }),
  deleteFinished: (clientId: string) => invoke<void>("phone_sync_delete_finished", { clientId }),
  qr: (text: string) => invoke<string>("phone_sync_qr", { text }),
  provideSnapshot: (requestId: number | null, snapshot: PhoneSnapshot) =>
    invoke<void>("phone_sync_provide_snapshot", { requestId, snapshot }),
};

export function onSnapshotRequest(handler: (requestId: number) => void): Promise<UnlistenFn> {
  return listen<number>(SNAPSHOT_REQUEST_EVENT, (e) => handler(e.payload));
}

export function onInvoicesReceived(handler: (count: number) => void): Promise<UnlistenFn> {
  return listen<number>(INVOICES_RECEIVED_EVENT, (e) => handler(e.payload));
}
