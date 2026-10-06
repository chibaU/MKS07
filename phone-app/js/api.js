// عميل خدمة الكمبيوتر. كل استدعاء اتصال قصير مستقل — لا جلسة ولا رمز مرتبط بالهاتف؛
// مفتاح الوصول يُرسَل مع كل طلب (Authorization: Bearer). لا أي اتصال بالإنترنت.

export const SCHEMA = 1;

export class ApiError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind; // network | timeout | auth | throttled | server | client | unavailable | schema | config
    this.status = extra.status ?? 0;
    this.code = extra.code ?? "";
    // true = الكمبيوتر رفض الطلب قبل معالجته: لم يُحفَظ شيء هناك.
    this.definitive = !!extra.definitive;
  }
}

export function normalizeBase(input) {
  let s = String(input ?? "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return u.origin;
  } catch {
    return "";
  }
}

export function normalizeKey(input) {
  return String(input ?? "")
    .toUpperCase()
    .replace(/[-\s_]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

const MESSAGES = {
  network: "تعذّر الوصول إلى الكمبيوتر. تأكد أن الهاتف على نفس شبكة الواي فاي وأن الخدمة تعمل على الكمبيوتر.",
  timeout: "انتهت مهلة الاتصال بالكمبيوتر. حاول مرة أخرى.",
  auth: "مفتاح الوصول غير صحيح أو جُدِّد على الكمبيوتر. امسح رمز QR من جديد أو أدخل المفتاح الجديد.",
  throttled: "محاولات خاطئة كثيرة. انتظر دقيقة ثم أعد المحاولة.",
  config: "لم يُضبط عنوان الكمبيوتر أو مفتاح الوصول بعد. امسح رمز QR الظاهر على الكمبيوتر.",
  schema: "نسخة التطبيق على الهاتف لا تطابق نسخة الكمبيوتر. افتح التطبيق وأنت متصل بالكمبيوتر ليتحدّث.",
};

export function createApi({ getSettings, fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = {} }) {
  async function call(path, { method = "GET", body, auth = true, timeout = 15000 } = {}) {
    const s = (await getSettings()) || {};
    const base = normalizeBase(s.serverBase);
    if (!base) throw new ApiError("config", MESSAGES.config, { definitive: true });
    const key = normalizeKey(s.accessKey);
    if (auth && !key) throw new ApiError("config", MESSAGES.config, { definitive: true });

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs[path] ?? timeout);
    let res;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: {
          ...(auth ? { Authorization: "Bearer " + key } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
        cache: "no-store",
        credentials: "omit",
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === "AbortError") throw new ApiError("timeout", MESSAGES.timeout);
      throw new ApiError("network", MESSAGES.network);
    }
    clearTimeout(timer);

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.ok && data) return data;

    const code = data && data.error && data.error.code ? data.error.code : "";
    const serverMsg = data && data.error && data.error.message ? data.error.message : "";
    if (res.status === 401) throw new ApiError("auth", MESSAGES.auth, { status: 401, code, definitive: true });
    if (res.status === 429) throw new ApiError("throttled", MESSAGES.throttled, { status: 429, code, definitive: true });
    if (code === "unsupported_schema") throw new ApiError("schema", MESSAGES.schema, { status: res.status, code, definitive: true });
    if (res.status === 503) throw new ApiError("unavailable", serverMsg || "الخدمة غير جاهزة على الكمبيوتر", { status: 503, code });
    if (res.status >= 400 && res.status < 500) {
      throw new ApiError("client", serverMsg || `رفض الكمبيوتر الطلب (${res.status})`, { status: res.status, code, definitive: true });
    }
    throw new ApiError("server", serverMsg || `خطأ من الكمبيوتر (${res.status})`, { status: res.status, code });
  }

  return {
    ping: () => call("/api/v1/ping", { auth: false, timeout: 6000 }),
    catalog: () => call("/api/v1/catalog", { timeout: 15000 }),
    submit: (invoices, deviceLabel) =>
      call("/api/v1/invoices", { method: "POST", body: { schema: SCHEMA, deviceLabel: deviceLabel || undefined, invoices }, timeout: 45000 }),
    status: (uids) => call("/api/v1/invoices/status", { method: "POST", body: { uids }, timeout: 20000 }),
  };
}

export function validateCatalog(c) {
  if (!c || !Array.isArray(c.merchants) || !Array.isArray(c.boxes)) throw new ApiError("server", "ردّ الكتالوج من الكمبيوتر غير صالح");
  const merchants = c.merchants
    .filter((m) => m && Number.isInteger(m.id) && typeof m.name === "string")
    .map((m) => ({ id: m.id, name: m.name }));
  const boxes = c.boxes
    .filter((b) => b && Number.isInteger(b.id) && typeof b.name === "string" && Number.isFinite(b.weight) && b.weight >= 0)
    .map((b) => ({ id: b.id, name: b.name, weight: b.weight }));
  return { merchants, boxes };
}
