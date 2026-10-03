// اتصال قصير مستقل بخدمة الكمبيوتر: كل دالة هنا = طلب واحد وينتهي. لا Session ولا
// WebSocket ولا Heartbeat (المتطلبان 4 و23). المصادقة بمفتاح وصول في كل طلب.

const TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind; // network | unauthorized | server | bad
    this.status = status;
  }
}

export function normalizeBase(input) {
  let t = String(input || "").trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:") return null;
    if (!u.port) u.port = "47443";
    return u.origin;
  } catch {
    return null;
  }
}

// يقبل رابط QR كاملاً (https://ip:port/#k=KEY) أو عنواناً فقط.
export function parseConnection(text) {
  const raw = String(text || "").trim();
  let key = null;
  const m = raw.match(/[#&?]k=([0-9a-fA-F]{64})/);
  if (m) key = m[1].toLowerCase();
  const base = normalizeBase(raw.replace(/#.*$/, ""));
  return { base, key };
}

async function call(conn, path, { method = "GET", body } = {}) {
  if (!conn || !conn.base || !conn.key) throw new ApiError("bad", "لم يُضبَط الاتصال بالكمبيوتر بعد");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(conn.base + path, {
      method,
      headers: {
        Authorization: `Bearer ${conn.key}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: ctl.signal,
    });
  } catch {
    throw new ApiError(
      "network",
      "تعذر الوصول إلى الكمبيوتر. تأكد أن الهاتف والكمبيوتر على نفس شبكة Wi-Fi وأن «مزامنة الهاتف» تعمل في البرنامج.",
    );
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* غير JSON */ }
  if (res.status === 401) throw new ApiError("unauthorized", data?.message || "مفتاح الوصول غير صحيح", 401);
  if (!res.ok || !data || data.ok === false) {
    throw new ApiError("server", data?.message || `خطأ من الكمبيوتر (${res.status})`, res.status);
  }
  return data;
}

export const api = {
  hello: (conn) => call(conn, "/api/v1/hello"),
  bootstrap: (conn) => call(conn, "/api/v1/bootstrap"),
  sendInvoices: (conn, invoices, deviceLabel) =>
    call(conn, "/api/v1/invoices", { method: "POST", body: { deviceLabel, invoices } }),
  statuses: (conn, ids) => call(conn, "/api/v1/invoices/status", { method: "POST", body: { ids } }),
};
