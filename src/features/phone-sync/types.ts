// أنواع ميزة «مزامنة الهاتف» — تطابق ما تُرجعه أوامر Rust في src-tauri/src/phone_sync
// (serde camelCase). لا تعتمد هذه الأنواع على أي نوع من بقية التطبيق.

export interface AddressInfo {
  ip: string;
  interface: string;
  likely: boolean;
}

export interface ServiceInfo {
  running: boolean;
  httpsPort: number;
  setupPort: number;
  addresses: AddressInfo[];
  caFingerprint: string | null;
  accessKey: string | null;
  dataDir: string;
}

export type RecordStatus = "pending" | "confirmed" | "rejected";

export interface PhoneInvoiceRecord {
  clientId: string;
  receivedAt: string;
  status: RecordStatus;
  deviceLabel: string | null;
  /** الفاتورة كما أرسلها الهاتف حرفياً — غير موثوقة، تُفحَص دائماً قبل الاستخدام. */
  payload: unknown;
  decidedAt: string | null;
  invoiceNumber: string | null;
  desktopInvoiceId: number | null;
  rejectReason: string | null;
}

/** لقطة التجار والصناديق التي تُرسَل للهاتف (المتطلب 8: معرّف + اسم + وزن فقط). */
export interface PhoneSnapshot {
  merchants: { id: number; name: string }[];
  boxes: { id: number; name: string; weight: number }[];
}

export const SNAPSHOT_REQUEST_EVENT = "phone-sync:snapshot-request";
export const INVOICES_RECEIVED_EVENT = "phone-sync:invoices-received";
