// شاشة "فواتيري": كل فاتورة على الهاتف وحالتها الحقيقية. الحذف مسموح فقط حين تكون
// النسخة غير ضرورية للسلامة (مسودة، أو أكّدها الكمبيوتر، أو رفضها) — لا شيء يُحذف تلقائياً.
import { h } from "../dom.js";
import { fmtW, formatMoney } from "../calc.js";
import { S, canEdit } from "../invoices.js";
import { chip, confirmDialog, fmtDateTime, toast } from "../ui.js";

const LABEL = {
  [S.DRAFT]: ["مسودة", "gray"],
  [S.READY]: ["جاهزة للإرسال", "info"],
  [S.UNCERTAIN]: ["أُرسلت — لم يصل التأكيد", "warn"],
  [S.PENDING]: ["بانتظار مراجعة الكمبيوتر", "warn"],
  [S.CONFIRMED]: ["مؤكَّدة ومحفوظة ✓", "ok"],
  [S.REJECTED]: ["رفضها الكمبيوتر", "bad"],
};

const GROUPS = [
  [S.READY, "جاهزة للإرسال"],
  [S.UNCERTAIN, "أُرسلت ولم يصل تأكيد"],
  [S.PENDING, "بانتظار مراجعة الكمبيوتر"],
  [S.DRAFT, "مسودات"],
  [S.REJECTED, "مرفوضة"],
  [S.CONFIRMED, "مؤكَّدة"],
];

function details(ctx, inv) {
  const { svc } = ctx;
  const actions = [];
  const run = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message || "تعذّر تنفيذ الإجراء", "error"); } };

  if (inv.state === S.DRAFT) {
    actions.push(h("button", { class: "btn primary sm", onclick: run(async () => { await svc.setCurrent(inv.uid); ctx.go("invoice"); }) }, "متابعة التحرير"));
  }
  if (inv.state === S.READY && canEdit(inv)) {
    actions.push(h("button", { class: "btn sm", onclick: run(async () => { await svc.reopen(inv.uid); ctx.go("invoice"); }) }, "تعديل"));
  }
  if (inv.state === S.REJECTED) {
    actions.push(h("button", { class: "btn primary sm", onclick: run(async () => {
      await svc.duplicateAsDraft(inv.uid);
      toast("نُسخت كمسودة جديدة — عدّلها ثم أنهِها وأرسلها", "ok");
      ctx.go("invoice");
    }) }, "نسخ كمسودة جديدة"));
  }
  if (svc.get(inv.uid) && (inv.state === S.DRAFT || inv.state === S.READY || inv.state === S.CONFIRMED || inv.state === S.REJECTED)) {
    actions.push(h("button", { class: "btn sm danger-o", onclick: run(async () => {
      const safeNote = inv.state === S.CONFIRMED ? "حُفظت بأمان في قاعدة بيانات الكمبيوتر." : inv.state === S.REJECTED ? "رفضها الكمبيوتر ولم تُحفظ هناك." : "لم تُرسل بعد — ستضيع نهائياً.";
      const ok = await confirmDialog({ title: "حذف الفاتورة من الهاتف؟", body: safeNote, okText: "حذف", danger: true });
      if (!ok) return;
      await svc.deleteInvoice(inv.uid);
      ctx.refresh();
    }) }, "حذف"));
  }

  return h(
    "div",
    { class: "inv-details" },
    inv.state === S.CONFIRMED ? h("div", { class: "okline" }, "رقم الفاتورة في النظام: ", h("b", { class: "num" }, inv.finalNumber || "—")) : null,
    inv.state === S.REJECTED ? h("div", { class: "badline" }, "سبب الرفض: ", inv.rejectReason || "لم يُذكر سبب") : null,
    inv.state === S.UNCERTAIN ? h("div", { class: "warnline" }, "لا نعرف هل وصلت إلى الكمبيوتر. اتصل بالكمبيوتر واضغط «إرسال/تحديث» — إعادة الإرسال آمنة ولن تتكرر الفاتورة.") : null,
    inv.state === S.PENDING ? h("div", { class: "warnline" }, "الكمبيوتر استلمها وتنتظر مراجعته. تبقى هنا حتى يؤكّدها ويحفظها. لا حاجة لإعادة الإرسال.") : null,
    inv.note ? h("div", { class: "warnline" }, inv.note) : null,
    inv.lastError ? h("div", { class: "badline" }, inv.lastError) : null,
    h(
      "div",
      { class: "lines-mini" },
      inv.lines.map((l) =>
        h(
          "div",
          { class: "lm" },
          h("span", null, l.productName),
          h("span", null, h("span", { class: "num" }, fmtW(l.netWeight)), " كغ × ", h("span", { class: "num" }, formatMoney(l.price)), " = ", h("b", { class: "num" }, formatMoney(l.subtotal))),
        ),
      ),
    ),
    h(
      "div",
      { class: "muted small" },
      "أُنشئت ",
      h("span", { class: "num" }, fmtDateTime(inv.createdAt)),
      inv.sentAt ? [" · أُرسلت ", h("span", { class: "num" }, fmtDateTime(inv.sentAt))] : null,
    ),
    actions.length ? h("div", { class: "actions" }, actions) : null,
  );
}

export function renderList(ctx) {
  const { svc } = ctx;
  const all = svc.list();
  if (all.length === 0) {
    return h("div", { class: "card empty" }, h("div", { class: "empty-ico" }, "🧾"), h("h2", null, "لا توجد فواتير بعد"), h("p", { class: "muted" }, "الفواتير التي تنشئها تظهر هنا مع حالتها."));
  }
  const open = ctx.listOpen || (ctx.listOpen = new Set());
  const root = h("div");
  for (const [state, title] of GROUPS) {
    const items = all.filter((i) => i.state === state);
    if (!items.length) continue;
    root.appendChild(
      h(
        "section",
        null,
        h("h3", { class: "grp" }, title, " ", chip(String(items.length), LABEL[state][1])),
        items.map((inv) => {
          const isOpen = open.has(inv.uid);
          return h(
            "div",
            { class: "card inv " + inv.state },
            h(
              "button",
              { class: "inv-head", onclick: () => { isOpen ? open.delete(inv.uid) : open.add(inv.uid); ctx.refresh(); } },
              h("div", null, h("strong", null, inv.merchantName || "—"), h("div", { class: "muted small" }, h("span", { class: "num" }, inv.invoiceDate), ` · ${inv.lines.length} بنود`)),
              h("div", { class: "inv-right" }, h("b", null, h("span", { class: "num" }, formatMoney(inv.total)), " دج"), chip(LABEL[inv.state][0], LABEL[inv.state][1])),
            ),
            isOpen ? details(ctx, inv) : null,
          );
        }),
      ),
    );
  }
  return root;
}
