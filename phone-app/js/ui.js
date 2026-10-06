// عناصر واجهة مشتركة: إشعارات عابرة، نوافذ تأكيد، شارات، تنسيقات.
import { h } from "./dom.js";

let toastTimer = null;

export function toast(message, kind = "info") {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast", role: "status", "aria-live": "polite" });
    document.body.appendChild(el);
  }
  el.className = "toast " + kind + " show";
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), kind === "error" ? 6000 : 3200);
}

/** نافذة تأكيد بديلة عن confirm() (التي قد تُحجب أو تبدو غريبة في التطبيق المثبَّت). */
export function confirmDialog({ title, body, okText = "تأكيد", cancelText = "إلغاء", danger = false }) {
  return new Promise((resolve) => {
    const done = (v) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === "Escape") done(false); };
    const overlay = h(
      "div",
      { class: "overlay", onclick: (e) => { if (e.target === overlay) done(false); } },
      h(
        "div",
        { class: "dialog", role: "dialog", "aria-modal": "true" },
        h("h3", null, title),
        body ? h("p", { class: "dlg-body" }, body) : null,
        h(
          "div",
          { class: "dlg-actions" },
          h("button", { class: "btn", onclick: () => done(false) }, cancelText),
          h("button", { class: "btn " + (danger ? "danger" : "primary"), onclick: () => done(true) }, okText),
        ),
      ),
    );
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
  });
}

export function chip(text, kind = "gray") {
  return h("span", { class: "chip " + kind }, text);
}

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return "لم تُحدَّث بعد";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "الآن";
  const m = Math.round(s / 60);
  if (m < 60) return `قبل ${m} دقيقة`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `قبل ${hr} ساعة`;
  const d = Math.round(hr / 24);
  return `قبل ${d} يوماً`;
}

const p2 = (n) => String(n).padStart(2, "0");
export function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
