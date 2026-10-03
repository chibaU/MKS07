// Service Worker: يُخزِّن واجهة التطبيق على الهاتف ليعمل Offline بعد انتهاء الاتصال
// بالكمبيوتر (المتطلب 6). النسخة والقائمة تُحقَنان من الخادم عند الطلب
// (__ASSET_VERSION__ = بصمة محتوى كل الملفات)، فيتجدد الكاش تلقائياً مع تحديث البرنامج.
// لا يعترض أبداً طلبات /api/ — الاتصال بالكمبيوتر دائماً مباشر وطازج.

const VERSION = "__ASSET_VERSION__";
const CACHE = `mks-phone-${VERSION}`;
const PRECACHE = __PRECACHE_LIST__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll ذرّي: فشل ملف واحد يُفشل التثبيت كله فتبقى النسخة القديمة سليمة.
      await cache.addAll(PRECACHE.map((p) => new Request(p, { cache: "reload" })));
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
  if (url.pathname.startsWith("/api/") || url.pathname === "/ca.crt" || url.pathname === "/setup") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const key = req.mode === "navigate" ? "/" : url.pathname;
      const hit = await cache.match(key);
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch {
        if (req.mode === "navigate") {
          const shell = await cache.match("/");
          if (shell) return shell;
        }
        return new Response("غير متاح دون اتصال", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })(),
  );
});
