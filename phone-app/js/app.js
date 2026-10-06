// نقطة تشغيل تطبيق الهاتف: تهيئة التخزين، التقاط مفتاح الوصول من QR، تسجيل Service Worker
// (للعمل دون اتصال)، والتنقل بين الشاشات الثلاث. لا اتصال شبكة عند الإقلاع إطلاقاً.
import { createDb } from "./db.js";
import { createApi, normalizeKey } from "./api.js";
import { createService } from "./invoices.js";
import { h, mount } from "./dom.js";
import { chip, toast, timeAgo } from "./ui.js";
import { renderInvoice } from "./views/invoice.js";
import { renderList } from "./views/list.js";
import { renderSync } from "./views/sync.js";

const TABS = [
  ["invoice", "فاتورة", "🧾"],
  ["list", "فواتيري", "🗂"],
  ["sync", "المزامنة", "🔄"],
];

const env = { sw: { ok: false, reason: "pending", message: "" }, fingerprint: "" };

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    env.sw = { ok: false, reason: "unsupported", message: window.isSecureContext ? "" : "الصفحة ليست في سياق آمن (HTTPS موثوق)" };
    return;
  }
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    env.sw = { ok: keys.some((k) => k.startsWith("mks-phone-")), reason: "ok", message: "" };
  } catch (e) {
    env.sw = { ok: false, reason: "error", message: String((e && e.message) || e) };
  }
}

async function main() {
  const root = document.getElementById("app");
  const db = createDb();
  let svc;
  const api = createApi({ getSettings: () => (svc ? svc.getSettings() : {}) });
  svc = createService({ db, api });

  try {
    await svc.init();
  } catch (e) {
    mount(root, h("div", { class: "card warncard" }, h("h2", null, "تعذّر فتح التخزين على الهاتف"), h("p", null, String((e && e.message) || e)), h("p", { class: "muted" }, "تأكد أنك لا تستخدم التصفح الخفي، وأن مساحة التخزين غير ممتلئة.")));
    return;
  }

  // مفتاح الوصول القادم من QR (في الجزء بعد # فلا يُرسَل للخادم ولا يُسجَّل في أي سجل).
  let bootstrapPull = false;
  const frag = new URLSearchParams(location.hash.replace(/^#/, ""));
  const qk = frag.get("k");
  if (qk && location.protocol === "https:") {
    await svc.saveSettings({ serverBase: location.origin, accessKey: normalizeKey(qk) });
    history.replaceState(null, "", location.pathname + location.search);
    bootstrapPull = true;
  } else if (!svc.getSettings().serverBase && location.protocol === "https:") {
    await svc.saveSettings({ serverBase: location.origin });
  }

  let tab = svc.currentDraft() ? "invoice" : svc.getCatalog() ? "invoice" : "sync";
  const ctx = {
    svc,
    api,
    env,
    lastResult: null,
    listOpen: new Set(),
    go(t) { tab = t; render(); },
    refresh(opts) { render(opts); },
  };

  const topbar = h("header", { class: "topbar" });
  const main = h("main", { id: "main" });
  const nav = h("nav", { class: "nav" });
  mount(root, topbar, main, nav);

  function renderTop() {
    const c = svc.getCatalog();
    const counts = svc.counts();
    const unsent = counts.ready + counts.uncertain;
    mount(
      topbar,
      h("div", { class: "brand" }, h("span", { class: "logo" }, "M"), h("span", null, "MKS — فواتير الهاتف")),
      h(
        "div",
        { class: "top-chips" },
        env.sw.ok ? null : chip("غير جاهز للعمل بدون اتصال", "warn"),
        unsent ? chip(`${unsent} للإرسال`, "info") : null,
        c ? chip(`بيانات ${timeAgo(c.fetchedAt)}`, c.stale ? "warn" : "gray") : chip("بلا بيانات", "bad"),
      ),
    );
  }

  function renderNav() {
    const counts = svc.counts();
    const badge = { invoice: 0, list: counts.ready + counts.uncertain, sync: counts.pending + counts.uncertain };
    mount(
      nav,
      TABS.map(([id, label, ico]) =>
        h(
          "button",
          { class: "tab" + (tab === id ? " active" : ""), onclick: () => ctx.go(id), "aria-current": tab === id ? "page" : null },
          h("span", { class: "ico", "aria-hidden": "true" }, ico),
          h("span", null, label),
          badge[id] ? h("span", { class: "badge" }, String(badge[id])) : null,
        ),
      ),
    );
  }

  function render(opts) {
    renderTop();
    renderNav();
    const scroll = main.scrollTop;
    let view;
    try {
      view = tab === "invoice" ? renderInvoice(ctx) : tab === "list" ? renderList(ctx) : renderSync(ctx);
    } catch (e) {
      console.error(e);
      view = h("div", { class: "card warncard" }, h("h2", null, "حدث خطأ في عرض الشاشة"), h("p", { class: "mono" }, String((e && e.message) || e)), h("p", { class: "muted" }, "فواتيرك محفوظة. جرّب فتح شاشة أخرى."));
    }
    mount(main, view);
    if (opts && opts.focus) {
      const el = document.getElementById(opts.focus);
      if (el) el.focus();
      main.scrollTop = 0;
    } else {
      main.scrollTop = scroll;
    }
  }

  svc.subscribe(() => { renderTop(); renderNav(); });
  render();

  // السجل المنتهي هنا لا يمنع التطبيق من العمل: التسجيل غير متزامن ولا ينتظره شيء.
  registerServiceWorker().then(() => { renderTop(); if (tab === "sync") render(); });

  if (bootstrapPull) {
    // المستخدم مسح QR للتوّ: هذا هو طلب "الحصول على البيانات" الأول.
    tab = "sync";
    render();
    try {
      const c = await svc.refreshCatalog();
      ctx.lastResult = h("div", { class: "banner ok" }, `تم الربط وجلب البيانات: ${c.merchants.length} تاجر و${c.boxes.length} صندوق.`);
      toast("تم جلب البيانات من الكمبيوتر", "ok");
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      tab = "invoice";
    } catch (e) {
      ctx.lastResult = h("div", { class: "banner bad" }, e.message);
    }
    render();
  }
}

main().catch((e) => {
  const root = document.getElementById("app");
  if (root) root.textContent = "تعذّر تشغيل التطبيق: " + ((e && e.message) || e);
});
