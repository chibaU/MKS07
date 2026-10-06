// Service Worker لتطبيق الهاتف — يجعل التطبيق يعمل بدون اتصال بالكمبيوتر.
//
// هذا الملف **قالب**: يخدمه الكمبيوتر على /sw.js بعد استبدال الرمزين التاليين بنسخة
// (hash) تتغير بتغيّر أي ملف، وبقائمة كل ملفات التطبيق (راجع engine/assets.rs).
// لذلك عندما يُحدَّث MKS يحصل الهاتف على النسخة الجديدة تلقائياً عند أول اتصال.
//
// ما يُخزَّن: ملفات التطبيق فقط (واجهة، خط، أيقونات). لا يُخزَّن أي طلب /api/ إطلاقاً —
// البيانات والفواتير يحفظها التطبيق في IndexedDB وليس هنا.

const VERSION = "__MKS_VERSION__";
const PRECACHE = /*__MKS_PRECACHE__*/[];
const CACHE = "mks-phone-" + VERSION;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // الكل أو لا شيء: إن فشل ملف واحد لا يُفعَّل هذا الإصدار ويبقى السابق سليماً.
      await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("mks-phone-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // لا نعترض: الخدمة نفسها، شهادة الجذر، وأي طلب API — كلها مباشرة من الشبكة.
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js" || url.pathname === "/mks-local-ca.crt") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === "navigate") {
        const page = await cache.match("/", { ignoreSearch: true });
        if (page) return page;
        return fetch(req);
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      return hit || fetch(req);
    })(),
  );
});
