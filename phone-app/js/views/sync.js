// شاشة "المزامنة": جلب البيانات، إرسال الفواتير، حالة الجاهزية للعمل دون اتصال، الإعدادات.
// لا شيء هنا يعمل تلقائياً في الخلفية: كل اتصال يبدأ بضغطة من المستخدم، قصير ومستقل.
import { h } from "../dom.js";
import { formatMoney } from "../calc.js";
import { normalizeBase, normalizeKey } from "../api.js";
import { S } from "../invoices.js";
import { downloadCa, detectPlatform } from "../cert.js";
import { chip, confirmDialog, fmtDateTime, timeAgo, toast } from "../ui.js";

function summaryText(sum) {
  const parts = [];
  if (sum.sent) parts.push(`أُرسلت ${sum.sent} فاتورة`);
  if (sum.pending) parts.push(`${sum.pending} بانتظار مراجعة الكمبيوتر`);
  if (sum.confirmed) parts.push(`${sum.confirmed} أكّدها الكمبيوتر ✓`);
  if (sum.rejected) parts.push(`${sum.rejected} رفضها الكمبيوتر`);
  if (sum.invalid) parts.push(`${sum.invalid} غير صالحة`);
  if (sum.requeued) parts.push(`${sum.requeued} أُعيدت للإرسال`);
  if (sum.failed) parts.push(`${sum.failed} لم يصل ردّ بشأنها`);
  return parts.join(" — ");
}

function certSteps(platform) {
  const android = h(
    "ol",
    { class: "steps" },
    h("li", null, "افتح ", h("b", null, "الإعدادات"), " ← ", h("b", null, "الأمان"), " (أو «الأمان والخصوصية») ← ", h("b", null, "المزيد من الأمان"), " ← ", h("b", null, "التشفير وبيانات الاعتماد"), " ← ", h("b", null, "تثبيت شهادة"), " ← ", h("b", null, "شهادة CA"), "."),
    h("li", null, "اضغط «التثبيت على أي حال» ثم اختر الملف ", h("span", { class: "fname" }, "mks-local-ca.crt"), " من «التنزيلات»."),
    h("li", null, "إن طلب الهاتف تعيين قفل شاشة (رقم سري/نمط) فافعل — شرط من أندرويد لتثبيت أي شهادة. وإشعار «قد تكون الشبكة مراقَبة» بعد التثبيت أمر طبيعي."),
  );
  const ios = h(
    "ol",
    { class: "steps" },
    h("li", null, "اضغط «فتح ملف الشهادة (آيفون)» أدناه ← «سماح» ← «إغلاق»."),
    h("li", null, "الإعدادات ← «تم تنزيل ملف تعريف» ← تثبيت."),
    h("li", null, "ثم الإعدادات ← عام ← حول ← إعدادات الثقة بالشهادة ← فعّل الثقة لشهادة MKS."),
  );
  if (platform === "android") return [android, h("details", { class: "alt" }, h("summary", null, "خطوات آيفون"), ios)];
  if (platform === "ios") return [ios, h("details", { class: "alt" }, h("summary", null, "خطوات أندرويد"), android)];
  return [h("div", { class: "muted small" }, "أندرويد:"), android, h("div", { class: "muted small" }, "آيفون:"), ios];
}

function certCard(ctx) {
  const sw = ctx.env.sw;
  if (sw.ok) {
    return h("div", { class: "card okcard" }, h("b", null, "✓ جاهز للعمل بدون اتصال"), h("div", { class: "muted small" }, "التطبيق محفوظ على هذا الهاتف ويعمل حتى لو كان الكمبيوتر مغلقاً."));
  }
  const platform = detectPlatform();
  const status = h("div", { class: "cert-status", role: "status" });
  const showStatus = (kind, text) => {
    status.className = "cert-status banner " + kind;
    status.textContent = text;
  };
  const fp = h("div", { class: "mono fp" }, ctx.env.fingerprint || "");
  const fpBox = h("div", { class: "muted small", style: { display: ctx.env.fingerprint ? "" : "none" } }, "بصمة الشهادة (SHA-256) — يجب أن تطابق ما تعرضه صفحة «مزامنة الهاتف» على الكمبيوتر:", fp);

  const saveBtn = h("button", { class: "btn primary block", onclick: async () => {
    saveBtn.disabled = true;
    showStatus("info", "جاري تجهيز الملف...");
    try {
      const r = await downloadCa();
      ctx.env.fingerprint = r.fingerprint;
      fp.textContent = r.fingerprint;
      fpBox.style.display = "";
      showStatus("ok", `تم تجهيز الملف ${r.filename}. ابحث عنه في «التنزيلات» (يظهر إشعار تنزيل عادةً). إن لم يظهر شيء فجرّب «طرق بديلة» أدناه.`);
    } catch (e) {
      showStatus("bad", e.message);
    }
    saveBtn.disabled = false;
  } }, "١) حفظ شهادة الأمان على الهاتف");

  return h(
    "div",
    { class: "card warncard" },
    h("h2", null, "⚠ ثبّت شهادة الأمان أولاً (مرة واحدة)"),
    h("p", { class: "muted" }, "لكي يحفظ الهاتف التطبيق ويعمل بدون اتصال، يجب أن يثق بشهادة الأمان الخاصة بكمبيوترك. لن تحتاج لتكرار هذا حتى لو تغيّر عنوان الكمبيوتر."),
    saveBtn,
    status,
    h("h3", { class: "cert-h" }, "٢) ثبّتها من إعدادات الهاتف"),
    certSteps(platform),
    h("button", { class: "btn block", onclick: () => location.reload() }, "٣) ثبّتُّ الشهادة — أعد تحميل التطبيق"),
    fpBox,
    h(
      "details",
      { class: "alt" },
      h("summary", null, "لم ينجح الحفظ؟ طرق بديلة"),
      h("ul", { class: "steps" },
        h("li", null, h("b", null, "افتح الرابط في Chrome مباشرةً"), " (وليس داخل تطبيق الكاميرا أو أي تطبيق آخر) — انسخ العنوان وألصقه في المتصفح."),
        h("li", null, "تنزيل مباشر: ", h("a", { href: "/download/mks-local-ca.crt", download: "mks-local-ca.crt" }, "mks-local-ca.crt")),
        h("li", null, "آيفون: ", h("a", { href: "/mks-local-ca.crt" }, "فتح ملف الشهادة (آيفون)")),
        h("li", null, h("b", null, "من الكمبيوتر:"), " في صفحة «مزامنة الهاتف» على الكمبيوتر اضغط «تصدير ملف الشهادة»، ثم أرسل الملف إلى الهاتف (كابل USB أو بلوتوث أو واتساب أو بريد إلكتروني) وثبّته من الإعدادات كما في الخطوة ٢."),
      ),
    ),
    sw.message ? h("div", { class: "muted small mono" }, sw.message) : null,
  );
}

export function renderSync(ctx) {
  const { svc, api } = ctx;
  const catalog = svc.getCatalog();
  const counts = svc.counts();
  const settings = svc.getSettings();
  const toSend = counts.ready + counts.uncertain;
  const waiting = counts.pending + counts.uncertain;
  const result = h("div", { class: "result" });
  if (ctx.lastResult) result.replaceChildren(ctx.lastResult);

  const setResult = (kind, text) => {
    ctx.lastResult = h("div", { class: "banner " + kind }, text);
    result.replaceChildren(ctx.lastResult);
  };

  async function guarded(btn, label, fn) {
    if (btn.disabled) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = label;
    try { await fn(); } finally { btn.disabled = false; btn.textContent = old; }
  }

  const pullBtn = h("button", { class: "btn primary block", onclick: () => guarded(pullBtn, "جاري الجلب...", async () => {
    try {
      const c = await svc.refreshCatalog();
      setResult(c.stale ? "warn" : "ok", `تم تحديث البيانات: ${c.merchants.length} تاجر و${c.boxes.length} صندوق.` + (c.stale ? " (نسخة محفوظة على الكمبيوتر — واجهته لم تردّ)" : ""));
      navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {});
    } catch (e) { setResult("bad", e.message); }
    ctx.refresh();
  }) }, "تحديث البيانات من الكمبيوتر");

  const sendBtn = h("button", { class: "btn ok block", disabled: toSend === 0 && waiting === 0, onclick: () => guarded(sendBtn, "جاري الإرسال...", async () => {
    try {
      const sum = await svc.syncAll();
      const txt = summaryText(sum);
      if (sum.error) setResult("bad", (txt ? txt + " — " : "") + sum.error.message);
      else if (!txt) setResult("info", "لا جديد: لا توجد فواتير للإرسال أو بانتظار التأكيد.");
      else setResult(sum.rejected || sum.invalid ? "warn" : "ok", txt);
    } catch (e) { setResult("bad", e.message); }
    ctx.refresh();
  }) }, toSend > 0 ? `إرسال ${toSend} فاتورة وتحديث الحالة` : waiting > 0 ? "تحديث حالة الفواتير" : "إرسال الفواتير");

  const label = h("input", { class: "inp", value: settings.deviceLabel || "", placeholder: "مثال: هاتف أحمد (اختياري)", maxlength: 60 });
  const base = h("input", { class: "inp mono", dir: "ltr", value: settings.serverBase || "", placeholder: "https://192.168.1.20:47613", autocomplete: "off", inputmode: "url" });
  const key = h("input", { class: "inp mono", dir: "ltr", type: "password", value: settings.accessKey || "", placeholder: "XXXX-XXXX-XXXX-XXXX", autocomplete: "off" });
  const showKey = h("button", { class: "btn sm", type: "button", onclick: () => { key.type = key.type === "password" ? "text" : "password"; } }, "إظهار/إخفاء");

  const stats = h(
    "div",
    { class: "stats" },
    [["ready", "جاهزة"], ["uncertain", "غير مؤكدة"], ["pending", "عند الكمبيوتر"], ["confirmed", "مؤكَّدة"], ["rejected", "مرفوضة"]].map(([k, t]) =>
      h("div", { class: "stat" }, h("b", { class: "num" }, String(counts[k] || 0)), h("span", null, t)),
    ),
  );

  return h(
    "div",
    null,
    certCard(ctx),
    h(
      "div",
      { class: "card" },
      h("h2", null, "1) بيانات التجار والصناديق"),
      catalog
        ? h("div", { class: "muted" }, `${catalog.merchants.length} تاجر · ${catalog.boxes.length} صندوق — آخر تحديث ${timeAgo(catalog.fetchedAt)}`, catalog.stale ? " (نسخة قديمة)" : "")
        : h("div", { class: "muted" }, "لم تُجلب بعد."),
      pullBtn,
      h("div", { class: "muted small" }, "اتصال قصير: الكمبيوتر يرسل البيانات وتنتهي العملية. بعدها يمكنك فصل الهاتف والعمل بدون اتصال."),
    ),
    h(
      "div",
      { class: "card" },
      h("h2", null, "2) إرسال الفواتير"),
      stats,
      sendBtn,
      h("div", { class: "muted small" }, "الفواتير تبقى على هاتفك بعد الإرسال، ولا تُعتبر منقولة بأمان إلا بعد أن يراجعها الكمبيوتر ويحفظها ويؤكّد لك ذلك. إعادة الإرسال آمنة ولا تُكرّر الفاتورة."),
    ),
    result,
    h(
      "details",
      { class: "card settings" },
      h("summary", null, "إعدادات الاتصال والنسخ الاحتياطي"),
      h("label", { class: "label" }, "اسم هذا الهاتف (يظهر للمراجع على الكمبيوتر)"),
      label,
      h("label", { class: "label" }, "عنوان خدمة الكمبيوتر"),
      base,
      h("label", { class: "label" }, "مفتاح الوصول"),
      h("div", { class: "row-inp" }, key, showKey),
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: async () => {
          const nb = normalizeBase(base.value);
          if (base.value.trim() && !nb) return toast("عنوان غير صالح", "error");
          await svc.saveSettings({ deviceLabel: label.value.trim().slice(0, 60), serverBase: nb, accessKey: normalizeKey(key.value) });
          toast("حُفظت الإعدادات", "ok");
        } }, "حفظ"),
        h("button", { class: "btn", onclick: async () => {
          try {
            const p = await api.ping();
            toast(`الكمبيوتر يردّ ✓ (نسخة الواجهة ${p.api})`, "ok");
            if (p.caFingerprint) { ctx.env.fingerprint = p.caFingerprint; }
          } catch (e) { toast(e.message, "error"); }
        } }, "اختبار الاتصال"),
      ),
      h("p", { class: "muted small" }, "إذا تغيّر عنوان الكمبيوتر على الشبكة فأدخل العنوان الجديد هنا (أو امسح رمز QR الجديد) — فواتيرك المحفوظة على الهاتف لا تتأثر."),
      h("hr"),
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: () => {
          const blob = new Blob([svc.exportBackup()], { type: "application/json" });
          const a = h("a", { href: URL.createObjectURL(blob), download: `mks-phone-backup-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        } }, "تصدير نسخة احتياطية"),
        h("label", { class: "btn" }, "استيراد نسخة",
          h("input", { type: "file", accept: "application/json,.json", style: { display: "none" }, onchange: async (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            try {
              const r = await svc.importBackup(await f.text());
              toast(`استُوردت ${r.added} فاتورة (تخطّي ${r.skipped})`, "ok");
              ctx.refresh();
            } catch (err) { toast(err.message, "error"); }
          } }),
        ),
      ),
      counts.confirmed > 0
        ? h("button", { class: "btn danger-o block", onclick: async () => {
            const ok = await confirmDialog({ title: `حذف ${counts.confirmed} فاتورة مؤكَّدة من الهاتف؟`, body: "كلها محفوظة بأمان في قاعدة بيانات الكمبيوتر.", okText: "حذف المؤكَّدة", danger: true });
            if (!ok) return;
            for (const inv of svc.list().filter((i) => i.state === S.CONFIRMED)) await svc.deleteInvoice(inv.uid);
            toast("حُذفت الفواتير المؤكَّدة", "ok");
            ctx.refresh();
          } }, "حذف الفواتير المؤكَّدة من الهاتف")
        : null,
      catalog ? h("div", { class: "muted small" }, `آخر بيانات من الكمبيوتر: ${fmtDateTime(catalog.generatedAt || catalog.fetchedAt)}`) : null,
    ),
    h("div", { class: "muted small foot" }, "إجمالي الفواتير غير المؤكَّدة بعد: ", chip(String(counts.ready + counts.uncertain + counts.pending + counts.draft), "gray"), " · ", `${formatMoney(svc.list().filter((i) => i.state !== S.CONFIRMED && i.state !== S.REJECTED && i.state !== S.DRAFT).reduce((s, i) => s + i.total, 0))} دج`),
  );
}
