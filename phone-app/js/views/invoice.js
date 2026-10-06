// شاشة "فاتورة": اختيار التاجر ← إضافة بنود ← إنهاء. كل شيء يُحفَظ محلياً بعد كل خطوة.
import { h } from "../dom.js";
import { computeLine, evalExpression, formatMoney, fmtW, invoiceTotal, normalizeArabic, normalizeDigits, parsePrice, parseWeight, totalBoxes, totalNet } from "../calc.js";
import { chip, confirmDialog, toast } from "../ui.js";
import { AppError } from "../invoices.js";

function emptyCatalog(ctx) {
  return h(
    "div",
    { class: "card empty" },
    h("div", { class: "empty-ico" }, "📥"),
    h("h2", null, "لا توجد بيانات من الكمبيوتر بعد"),
    h("p", { class: "muted" }, "تحتاج مرة واحدة إلى جلب التجار والصناديق من الكمبيوتر. بعدها تعمل بدون أي اتصال."),
    h("button", { class: "btn primary", onclick: () => ctx.go("sync") }, "الذهاب إلى المزامنة"),
  );
}

function merchantPicker(ctx, { onPick, onCancel }) {
  const merchants = ctx.svc.getCatalog().merchants;
  const list = h("div", { class: "pick-list" });
  const search = h("input", {
    class: "inp",
    type: "search",
    placeholder: "ابحث عن التاجر...",
    autocomplete: "off",
    enterkeyhint: "search",
    oninput: () => draw(),
  });
  function draw() {
    const q = normalizeArabic(search.value);
    const rows = merchants.filter((m) => !q || normalizeArabic(m.name).includes(q)).slice(0, 60);
    list.replaceChildren(
      ...(rows.length
        ? rows.map((m) => h("button", { class: "pick", onclick: () => onPick(m.id) }, m.name))
        : [h("div", { class: "muted pad" }, "لا يوجد تاجر بهذا الاسم")]),
    );
  }
  draw();
  return h(
    "div",
    { class: "card" },
    h("h2", null, "اختر التاجر"),
    search,
    list,
    onCancel ? h("button", { class: "btn ghost", onclick: onCancel }, "إلغاء") : null,
  );
}

function lineCard(ctx, draft, l, editable) {
  return h(
    "div",
    { class: "line" },
    h(
      "div",
      { class: "line-top" },
      h("strong", null, l.productName),
      editable
        ? h(
            "button",
            {
              class: "x",
              "aria-label": "حذف البند",
              onclick: async () => {
                const ok = await confirmDialog({ title: "حذف هذا البند؟", body: `${l.productName} — ${fmtW(l.netWeight)} كغ`, okText: "حذف", danger: true });
                if (!ok) return;
                try {
                  await ctx.svc.removeLine(draft.uid, l.lid);
                  ctx.refresh();
                } catch (e) { toast(e.message, "error"); }
              },
            },
            "✕",
          )
        : null,
    ),
    h(
      "div",
      { class: "line-calc num" },
      `${fmtW(l.scaleWeight)}`,
      l.boxes.length ? ` − ${fmtW(l.scaleWeight - l.netWeight)}` : "",
      ` = `,
      h("b", null, `${fmtW(l.netWeight)} كغ`),
    ),
    l.boxes.length
      ? h("div", { class: "line-boxes muted" }, l.boxes.map((b) => `${b.name} × ${b.boxCount}`).join("، "))
      : null,
    h("div", { class: "line-price num" }, `${formatMoney(l.price)} × ${fmtW(l.netWeight)} = `, h("b", null, `${formatMoney(l.subtotal)} دج`)),
  );
}

function entryForm(ctx, draft) {
  const { svc } = ctx;
  const catalog = svc.getCatalog();
  const entry = Object.assign({ product: "", weight: "", price: "", counts: {} }, svc.getEntry() || {});
  entry.counts = entry.counts || {};

  let saveTimer = null;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { svc.setEntry(entry).catch(() => {}); }, 350);
  };

  const preview = h("div", { class: "preview" });
  const weightHint = h("div", { class: "hint" });
  const priceHint = h("div", { class: "hint" });

  const countOf = (id) => Math.max(0, Math.min(9999, Math.trunc(Number(normalizeDigits(entry.counts[id])) || 0)));

  function currentCalc() {
    const w = parseWeight(entry.weight);
    const price = parsePrice(entry.price);
    const boxes = catalog.boxes.map((b) => ({ boxId: b.id, boxCount: countOf(b.id), weight: b.weight }));
    const c = w === null ? null : computeLine({ scaleWeight: w, price: price ?? 0, boxes });
    return { w, price, boxes, c };
  }

  function updatePreview() {
    const { w, price, c } = currentCalc();
    const raw = entry.weight.trim();
    if (raw) {
      const v = evalExpression(raw);
      weightHint.textContent = v === null || v < 0 ? "قيمة غير صالحة" : /[+\-*/x×÷()]/.test(raw.replace(/^-/, "")) ? `المجموع = ${fmtW(v)}` : "";
      weightHint.className = "hint" + (v === null || v < 0 ? " bad" : "");
    } else { weightHint.textContent = ""; weightHint.className = "hint"; }
    priceHint.textContent = entry.price.trim() && price !== null ? `${formatMoney(price)} دج للكيلوغرام` : entry.price.trim() ? "سعر غير صالح" : "";
    priceHint.className = "hint" + (entry.price.trim() && price === null ? " bad" : "");

    if (!c) { preview.className = "preview"; preview.textContent = "أدخل وزن الميزان"; return; }
    if (c.exceeds) {
      preview.className = "preview bad";
      preview.textContent = `وزن الصناديق (${fmtW(c.totalEmpty)}) أكبر من وزن الميزان`;
      return;
    }
    preview.className = "preview ok";
    // القاعدة: .num للأرقام وحدها؛ الكلمات والوحدات العربية خارجه وإلا اختلط ترتيب الاتجاهين.
    preview.replaceChildren(
      h("span", null, "الصافي ", h("b", { class: "num" }, fmtW(c.netWeight)), " كغ"),
      price !== null ? h("span", null, " — ", h("b", { class: "num" }, formatMoney(c.subtotal)), " دج") : null,
    );
  }

  const product = h("input", {
    class: "inp",
    id: "f-product",
    placeholder: "اسم المنتج",
    list: "products",
    autocomplete: "off",
    enterkeyhint: "next",
    value: entry.product,
    maxlength: 200,
    oninput: () => { entry.product = product.value; persist(); },
  });
  const weight = h("input", {
    class: "inp num",
    id: "f-weight",
    placeholder: "وزن الميزان — مثال 45.5+38",
    inputmode: "decimal",
    autocomplete: "off",
    enterkeyhint: "next",
    value: entry.weight,
    oninput: () => { entry.weight = weight.value; persist(); updatePreview(); },
  });
  const plus = h("button", { class: "btn sm plus", type: "button", "aria-label": "إضافة وزنة", onclick: () => {
    if (weight.value.trim() && !/[+\-*/]$/.test(weight.value.trim())) weight.value = weight.value.trim() + "+";
    entry.weight = weight.value; persist(); updatePreview(); weight.focus();
  } }, "+");
  const price = h("input", {
    class: "inp num",
    id: "f-price",
    placeholder: "السعر (دج للكيلوغرام)",
    inputmode: "numeric",
    autocomplete: "off",
    enterkeyhint: "done",
    value: entry.price,
    oninput: () => { entry.price = price.value; persist(); updatePreview(); },
  });

  const stepRows = catalog.boxes.map((b) => {
    const val = h("input", {
      class: "inp step-val num",
      inputmode: "numeric",
      value: String(countOf(b.id)),
      "aria-label": `عدد ${b.name}`,
      onfocus: () => val.select(),
      oninput: () => {
        entry.counts[b.id] = Math.max(0, Math.min(9999, Math.trunc(Number(normalizeDigits(val.value)) || 0)));
        persist();
        updatePreview();
      },
    });
    const set = (n) => { n = Math.max(0, Math.min(9999, n)); entry.counts[b.id] = n; val.value = String(n); persist(); updatePreview(); };
    return h(
      "div",
      { class: "step-row" },
      h("div", { class: "step-name" }, b.name, h("span", { class: "muted" }, " (", h("span", { class: "num" }, fmtW(b.weight)), " كغ)")),
      h(
        "div",
        { class: "stepper" },
        h("button", { class: "step-btn", type: "button", "aria-label": "إنقاص", onclick: () => set(countOf(b.id) - 1) }, "−"),
        val,
        h("button", { class: "step-btn", type: "button", "aria-label": "زيادة", onclick: () => set(countOf(b.id) + 1) }, "+"),
      ),
    );
  });

  async function add() {
    const { w, price: p, boxes } = currentCalc();
    try {
      if (w === null) throw new AppError("أدخل وزن ميزان صالحاً", "weight");
      if (p === null) throw new AppError("أدخل السعر (أرقام فقط)", "price");
      await svc.addLine(draft.uid, { productName: entry.product, scaleWeight: w, price: p, boxes: boxes.filter((b) => b.boxCount > 0).map((b) => ({ boxId: b.boxId, boxCount: b.boxCount })) });
    } catch (e) {
      toast(e.message || "تعذّرت إضافة البند", "error");
      return;
    }
    await svc.setEntry(null).catch(() => {});
    toast("أُضيف البند", "ok");
    ctx.refresh({ focus: "f-product" });
  }

  updatePreview();
  return h(
    "div",
    { class: "card form" },
    h("h2", null, "بند جديد"),
    product,
    h("div", { class: "row-inp" }, weight, plus),
    weightHint,
    catalog.boxes.length ? h("div", { class: "boxes" }, h("div", { class: "label" }, "الصناديق"), stepRows) : null,
    price,
    priceHint,
    preview,
    h("button", { class: "btn primary block", onclick: add }, "إضافة البند"),
  );
}

function draftView(ctx, draft) {
  const { svc } = ctx;
  const root = h("div");
  let changing = false;

  const header = h(
    "div",
    { class: "card head" },
    h(
      "div",
      null,
      h("div", { class: "muted" }, "التاجر"),
      h("div", { class: "merchant" }, draft.merchantName),
    ),
    h(
      "div",
      { class: "head-actions" },
      h("button", { class: "btn sm", onclick: () => { changing = true; draw(); } }, "تغيير"),
      h("button", { class: "btn sm danger-o", onclick: async () => {
        const ok = await confirmDialog({ title: "حذف هذه المسودة؟", body: draft.lines.length ? `ستُحذف ${draft.lines.length} بنود غير مُرسلة.` : "", okText: "حذف", danger: true });
        if (!ok) return;
        try { await svc.deleteInvoice(draft.uid); ctx.refresh(); } catch (e) { toast(e.message, "error"); }
      } }, "حذف"),
    ),
  );

  function draw() {
    if (changing) {
      root.replaceChildren(merchantPicker(ctx, {
        onPick: async (id) => { try { await svc.changeMerchant(draft.uid, id); changing = false; ctx.refresh(); } catch (e) { toast(e.message, "error"); } },
        onCancel: () => { changing = false; draw(); },
      }));
      return;
    }
    const lines = draft.lines;
    root.replaceChildren(
      header,
      lines.length
        ? h("div", { class: "card" }, h("h2", null, `البنود (${lines.length})`), lines.map((l) => lineCard(ctx, draft, l, true)))
        : null,
      entryForm(ctx, draft),
      h(
        "div",
        { class: "totalbar" },
        h(
          "div",
          { class: "totals" },
          h("div", null, h("span", { class: "muted" }, "الصافي "), h("b", null, h("span", { class: "num" }, fmtW(totalNet(lines))), " كغ")),
          h("div", null, h("span", { class: "muted" }, "الصناديق "), h("b", { class: "num" }, String(totalBoxes(lines)))),
          h("div", { class: "grand" }, h("span", { class: "muted" }, "الإجمالي "), h("b", null, h("span", { class: "num" }, formatMoney(invoiceTotal(lines))), " دج")),
        ),
        h("button", { class: "btn ok", disabled: lines.length === 0, onclick: async () => {
          const ok = await confirmDialog({
            title: "إنهاء الفاتورة؟",
            body: "تصبح جاهزة للإرسال إلى الكمبيوتر، وتبقى محفوظة على هذا الهاتف حتى يؤكّدها الكمبيوتر.",
            okText: "إنهاء",
          });
          if (!ok) return;
          try { await svc.finish(draft.uid); toast("الفاتورة جاهزة للإرسال", "ok"); ctx.refresh(); } catch (e) { toast(e.message, "error"); }
        } }, "إنهاء الفاتورة"),
      ),
    );
  }
  draw();
  return root;
}

export function renderInvoice(ctx) {
  const { svc } = ctx;
  const catalog = svc.getCatalog();
  if (!catalog || catalog.merchants.length === 0) return emptyCatalog(ctx);
  const draft = svc.currentDraft();
  const datalist = h("datalist", { id: "products" }, svc.productNames().map((n) => h("option", { value: n })));
  if (!draft) {
    const ready = svc.counts().ready;
    return h(
      "div",
      null,
      ready ? h("div", { class: "note" }, chip(`${ready} جاهزة للإرسال`, "info"), " ", h("button", { class: "link", onclick: () => ctx.go("sync") }, "اذهب للمزامنة")) : null,
      merchantPicker(ctx, {
        onPick: async (id) => { try { await svc.startDraft(id); ctx.refresh({ focus: "f-product" }); } catch (e) { toast(e.message, "error"); } },
      }),
    );
  }
  return h("div", null, datalist, draftView(ctx, draft));
}
