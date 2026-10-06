// ثوابت ميزة مزامنة الهاتف — كل الأرقام التشغيلية في مكان واحد.

pub const API_VERSION: u32 = 1;
pub const SCHEMA_VERSION: u32 = 1;

/// المنفذ الافتراضي. ثابت عمداً: أصل (origin) تطبيق الهاتف = عنوان IP + المنفذ،
/// وتغيّره يعني تخزيناً محلياً جديداً على الهاتف.
pub const DEFAULT_PORT: u16 = 47613;
pub const PORT_FALLBACK_TRIES: u16 = 10;

pub const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_INVOICES_PER_REQUEST: usize = 100;
pub const MAX_STATUS_IDS: usize = 500;
pub const MAX_LINES_PER_INVOICE: usize = 200;
pub const MAX_BOXES_PER_LINE: usize = 60;
pub const MAX_CONNECTIONS: usize = 48;

pub const HANDSHAKE_TIMEOUT_SECS: u64 = 10;
pub const HEADER_TIMEOUT_SECS: u64 = 15;

pub const CATALOG_PULL_WAIT_MS: u64 = 3000;

pub const CA_VALIDITY_DAYS: i64 = 3650;
/// أقصى عمر مقبول لشهادات الخوادم لدى متصفحات الهواتف (398 يوماً).
pub const LEAF_VALIDITY_DAYS: i64 = 397;
pub const LEAF_RENEW_BEFORE_DAYS: i64 = 30;

pub const THROTTLE_MAX_FAILURES: usize = 8;
pub const THROTTLE_WINDOW_SECS: u64 = 60;
pub const THROTTLE_LOCK_SECS: u64 = 60;

