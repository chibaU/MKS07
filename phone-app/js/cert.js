// تثبيت شهادة الأمان على الهاتف — أصعب خطوة في الإعداد، ولها قيد جوهري:
//
//   قبل أن يثق الهاتف بالشهادة، لا يمكنه الوثوق بالاتصال الذي سيُنزِّلها منه. المتصفح يسمح
//   بعرض الصفحة بعد «المتابعة رغم التحذير»، لكن **تنزيل الملفات** في متصفحات أندرويد يمرّ بمدير
//   تنزيلات لا يرى ذلك الاستثناء، فيبدأ ثم يفشل. ونوع MIME الرسمي للشهادات قد تعترضه المتصفحات
//   أيضاً وتسلّمه لمثبّت النظام (الذي يرفضه أندرويد 11+).
//
//   الحل: نجلب الشهادة بـ fetch (طلبات الصفحة تحترم الاستثناء) كنص base64 من /api/v1/ca، ثم
//   نبني الملف **محلياً في ذاكرة الصفحة** (Blob) ونحفظه بنوع عام — فلا يوجد تنزيل شبكي أصلاً.

export function b64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 'ios' | 'android' | 'other' */
export function detectPlatform(nav = globalThis.navigator) {
  const ua = (nav && nav.userAgent) || "";
  if (/iPad|iPhone|iPod/.test(ua) || (nav && nav.platform === "MacIntel" && nav.maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** DER لشهادة X.509: يبدأ بـ SEQUENCE (0x30) ولها حجم معقول. نتأكد قبل تسليمها للمستخدم. */
export function looksLikeDerCertificate(bytes) {
  return bytes instanceof Uint8Array && bytes.length >= 200 && bytes.length <= 4096 && bytes[0] === 0x30;
}

/** يحفظ بايتات كملف على الهاتف دون أي طلب شبكة (Blob + رابط تنزيل). */
export function saveBytesAsFile(bytes, filename, { mime = "application/octet-stream", doc = globalThis.document, urlApi = globalThis.URL } = {}) {
  const blob = new Blob([bytes], { type: mime });
  const url = urlApi.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  doc.body.appendChild(a);
  a.click();
  // لا نُلغي الرابط فوراً: بعض المتصفحات تبدأ القراءة بعد النقر بلحظات.
  const timer = setTimeout(() => {
    urlApi.revokeObjectURL(url);
    a.remove();
  }, 60000);
  if (timer && typeof timer.unref === "function") timer.unref(); // في الاختبارات (Node) لا يُبقي المؤقّت العملية حيّة
  return { size: bytes.length };
}

/** يجلب الشهادة من الخدمة ويحفظها. يرمي خطأ بعربية مفهومة. */
export async function downloadCa({ fetchImpl = (...a) => globalThis.fetch(...a), base = "", save = saveBytesAsFile } = {}) {
  let res;
  try {
    res = await fetchImpl(base + "/api/v1/ca", { cache: "no-store", credentials: "omit" });
  } catch {
    throw new Error("تعذّر الاتصال بالكمبيوتر لجلب الشهادة. تأكد أن الخدمة تعمل وأن الهاتف على نفس شبكة الواي فاي.");
  }
  let info = null;
  try {
    info = await res.json();
  } catch {
    info = null;
  }
  if (!res.ok || !info || typeof info.derBase64 !== "string") {
    throw new Error("ردّ الكمبيوتر على طلب الشهادة غير صالح — حدّث التطبيق من الكمبيوتر ثم أعد المحاولة.");
  }
  let bytes;
  try {
    bytes = b64ToBytes(info.derBase64);
  } catch {
    throw new Error("الشهادة المستلمة تالفة. أعد المحاولة.");
  }
  if (!looksLikeDerCertificate(bytes)) throw new Error("الملف المستلم ليس شهادة صالحة. أعد المحاولة.");
  const filename = /^[\w.-]{1,60}$/.test(info.filename || "") ? info.filename : "mks-local-ca.crt";
  save(bytes, filename);
  return { filename, fingerprint: info.fingerprint || "", size: bytes.length };
}
