import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_COPIES,
  getPrintUiState,
  hidePrintPreparing,
  normalizeDigits,
  requestPrintOptions,
  resolveCopies,
  resolveSelection,
  showPrintPreparing,
  subscribePrintUi,
  type SelectionInput,
} from "../src/services/printOptions.ts";

const sel = (over: Partial<SelectionInput>): SelectionInput => ({ mode: "all", single: "", from: "", to: "", ...over });

test("normalizeDigits converts Arabic-Indic digits and drops everything else", () => {
  assert.equal(normalizeDigits("٣"), "3");
  assert.equal(normalizeDigits("۱۲"), "12");
  assert.equal(normalizeDigits("a1-b2 .٣"), "123");
  assert.equal(normalizeDigits("1234567890"), "123456");
  assert.equal(normalizeDigits(""), "");
});

test("all pages is always valid, and a single-page invoice ignores the mode", () => {
  assert.deepEqual(resolveSelection(sel({ mode: "all" }), 5), { ok: true, value: { mode: "all" } });
  assert.deepEqual(resolveSelection(sel({ mode: "single", single: "9" }), 1), { ok: true, value: { mode: "all" } });
});

test("single page", () => {
  assert.deepEqual(resolveSelection(sel({ mode: "single", single: "3" }), 5), {
    ok: true,
    value: { mode: "pages", from: 3, to: 3 },
  });
  const empty = resolveSelection(sel({ mode: "single" }), 5);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.empty, true);
  for (const bad of ["0", "6", "999999"]) {
    const r = resolveSelection(sel({ mode: "single", single: bad }), 5);
    assert.equal(r.ok, false, bad);
    if (!r.ok) {
      assert.equal(r.empty, false);
      assert.match(r.error, /بين 1 و5/);
    }
  }
});

test("consecutive range", () => {
  assert.deepEqual(resolveSelection(sel({ mode: "range", from: "2", to: "4" }), 5), {
    ok: true,
    value: { mode: "pages", from: 2, to: 4 },
  });
  assert.deepEqual(resolveSelection(sel({ mode: "range", from: "3", to: "3" }), 5), {
    ok: true,
    value: { mode: "pages", from: 3, to: 3 },
  });
});

test("a range covering the whole invoice collapses to all", () => {
  assert.deepEqual(resolveSelection(sel({ mode: "range", from: "1", to: "5" }), 5), { ok: true, value: { mode: "all" } });
});

test("invalid ranges are rejected with the right kind of message", () => {
  const both = resolveSelection(sel({ mode: "range" }), 5);
  assert.equal(both.ok, false);
  if (!both.ok) assert.equal(both.empty, true);

  const half = resolveSelection(sel({ mode: "range", from: "2" }), 5);
  assert.equal(half.ok, false);
  if (!half.ok) assert.equal(half.empty, false);

  for (const [from, to] of [["4", "2"], ["0", "2"], ["1", "6"], ["6", "6"]]) {
    assert.equal(resolveSelection(sel({ mode: "range", from, to }), 5).ok, false, `${from}-${to}`);
  }
});

test("copies are limited to 1..MAX_COPIES", () => {
  assert.deepEqual(resolveCopies("1"), { ok: true, value: 1 });
  assert.deepEqual(resolveCopies(String(MAX_COPIES)), { ok: true, value: MAX_COPIES });
  for (const bad of ["0", String(MAX_COPIES + 1), "abc", "-1", "1.5"]) {
    assert.equal(resolveCopies(bad).ok, false, bad);
  }
  const empty = resolveCopies("");
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.empty, true);
});

test("store: preparing indicator, then options dialog, resolved by finish()", async () => {
  let notified = 0;
  const unsubscribe = subscribePrintUi(() => notified++);

  assert.equal(getPrintUiState(), null);
  showPrintPreparing();
  assert.equal(getPrintUiState()?.kind, "preparing");
  hidePrintPreparing();
  assert.equal(getPrintUiState(), null);

  showPrintPreparing();
  const done = requestPrintOptions(
    { invoiceLabel: "2610-1-1", pageCount: 3, printers: ["P"], savedPrinter: "" },
    async () => {},
  );
  const ui = getPrintUiState();
  assert.equal(ui?.kind, "options", "النافذة تحلّ محل مؤشر التجهيز");
  if (ui?.kind === "options") ui.finish(true);
  assert.equal(await done, true);
  assert.equal(getPrintUiState(), null);

  const cancelled = requestPrintOptions({ invoiceLabel: "x", pageCount: 1, printers: [], savedPrinter: "" }, async () => {});
  const ui2 = getPrintUiState();
  if (ui2?.kind === "options") ui2.finish(false);
  assert.equal(await cancelled, false);

  // hidePrintPreparing لا يُغلق نافذة الخيارات
  const open = requestPrintOptions({ invoiceLabel: "x", pageCount: 2, printers: [], savedPrinter: "" }, async () => {});
  hidePrintPreparing();
  assert.equal(getPrintUiState()?.kind, "options");
  const ui3 = getPrintUiState();
  if (ui3?.kind === "options") ui3.finish(false);
  await open;

  assert.ok(notified > 0);
  unsubscribe();
});
