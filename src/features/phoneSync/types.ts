// أنواع ميزة مزامنة الهاتف — مشتركة بين طبقة Rust (JSON camelCase) والواجهة.
// لا تستورد من أي ملف خارج هذا المجلد (الميزة مستقلة).

// ───────── ما يرسله الهاتف (يطابق WireInvoice في store.rs) ─────────
export interface WireBox {
  boxId: number;
  boxCount: number;
}

export interface WireLine {
  lid?: string | null;
  productName: string;
  scaleWeight: number;
  price: number;
  boxes: WireBox[];
  // قيم حسبها الهاتف — للمقارنة والتنبيه فقط، لا تُعتمَد أبداً.
  phoneNetWeight?: number | null;
  phoneSubtotal?: number | null;
}

export interface WireInvoice {
  uid: string;
  createdAt: string;
  invoiceDate: string;
  merchantId: number;
  merchantNameHint?: string | null;
  lines: WireLine[];
  phoneTotal?: number | null;
}

// ───────── المخزن المعلّق على الكمبيوتر (يطابق Record / LedgerEntry) ─────────
export type RecordState = "pending" | "saving" | "confirmed" | "rejected";

export interface SavingInfo {
  startedAt: string;
  invoiceId?: number | null;
  invoiceNumber?: string | null;
}

export interface InboxRecord {
  uid: string;
  state: RecordState;
  receivedAt: string;
  receiveCount: number;
  contentHash: string;
  deviceLabel?: string | null;
  remoteIp?: string | null;
  invoice: WireInvoice;
  saving?: SavingInfo | null;
}

export interface LedgerEntry {
  uid: string;
  state: RecordState;
  at: string;
  finalInvoiceId?: number | null;
  finalInvoiceNumber?: string | null;
  reason?: string | null;
  merchantName?: string | null;
  total?: number | null;
}

// ───────── حالة الخدمة (يطابق Status في engine/mod.rs) ─────────
export interface ServiceAddress {
  ip: string;
  iface: string;
  url: string;
  qrSvg: string;
  recommended: boolean;
}

export interface ServiceEvent {
  seq: number;
  at: string;
  kind: string;
  ip?: string | null;
  message: string;
}

export interface ServiceStatus {
  running: boolean;
  port?: number | null;
  portChanged: boolean;
  addresses: ServiceAddress[];
  noNetwork: boolean;
  accessKey: string;
  accessKeyDisplay: string;
  caFingerprint: string;
  caNotAfter: string;
  startedAt?: string | null;
  providerReady: boolean;
  inbox: { pending: number; saving: number };
  events: ServiceEvent[];
  lastError?: string | null;
  apiVersion: number;
  dataDir: string;
}

// ───────── الكتالوج الذي يُرسَل للهاتف ─────────
export interface Catalog {
  merchants: { id: number; name: string }[];
  boxes: { id: number; name: string; weight: number }[];
  generatedAt: string;
}
