import { test } from "node:test";
import assert from "node:assert/strict";
import { definePrintConfig, parsePrintMode, resolveBehavior, sanitizeCopies } from "../src/print/behavior.ts";
import { DIALOG_SETTLE_MS, createPrintEngine, type EngineDeps } from "../src/print/engine.ts";
import { PrintError, type NativePrintRequest, type PrintDocument } from "../src/print/types.ts";
import {
  EMPTY_WEIGHER,
  normalizeWeigher,
} from "../src/print/weigher.ts";

const config = definePrintConfig({
  default: { mode: "dialog", onPrinterUnavailable: "dialog" },
  byDocument: { invoice: { copies: 2 } },
});

// ───────── الأولوية ─────────

test("الأولوية: طلب الاستدعاء > الإعدادات > byDocument > الافتراضي", () => {
  assert.deepEqual(resolveBehavior(config, "other"), {
    mode: "dialog",
    onPrinterUnavailable: "dialog",
  });
  assert.equal(resolveBehavior(config, "invoice").copies, 2);
  assert.equal(resolveBehavior(config, "invoice", { copies: 3 }).copies, 3);
  assert.equal(resolveBehavior(config, "invoice", { copies: 3 }, { copies: 4 }).copies, 4);
  assert.equal(resolveBehavior(config, "invoice", { mode: "direct" }).mode, "direct");
  assert.equal(resolveBehavior(config, "invoice", { mode: "direct" }, { mode: "dialog" }).mode, "dialog");
});

test("الإعدادات الغائبة (undefined) لا تطغى على الافتراضي", () => {
  const direct = definePrintConfig({ default: { mode: "direct", onPrinterUnavailable: "error" } });
  const b = resolveBehavior(direct, "invoice", { mode: undefined, printerName: undefined });
  assert.equal(b.mode, "direct");
  assert.equal(b.onPrinterUnavailable, "error");
});

test("اسم الطابعة: الإعداد المحفوظ يغلب، و'' في الطلب تعني الافتراضية وتغلب المحفوظ", () => {
  assert.equal(resolveBehavior(config, "invoice", { printerName: "HP" }).printerName, "HP");
  assert.equal(resolveBehavior(config, "invoice", { printerName: "HP" }, { printerName: "" }).printerName, "");
});

test("القيم الفاسدة تُهمَل بدل إفساد الطباعة", () => {
  const b = resolveBehavior(
    config,
    "other",
    { mode: "silent" as never, copies: 0, duplex: "both" as never },
    { copies: 1.5, onPrinterUnavailable: "ignore" as never },
  );
  assert.deepEqual(b, { mode: "dialog", onPrinterUnavailable: "dialog" });
  assert.equal(sanitizeCopies(99), 99);
  assert.equal(sanitizeCopies(100), undefined);
  assert.equal(sanitizeCopies("2"), undefined);
});

test("print_mode: الغائب أو الفاسد = undefined (يحكم الافتراضي 'dialog')", () => {
  assert.equal(parsePrintMode(null), undefined);
  assert.equal(parsePrintMode(""), undefined);
  assert.equal(parsePrintMode("silent"), undefined);
  assert.equal(parsePrintMode(" direct "), "direct");
  assert.equal(parsePrintMode("dialog"), "dialog");
});

// ───────── المحرك ─────────

interface Harness {
  calls: string[];
  native: NativePrintRequest[];
  deps: EngineDeps;
  engine: ReturnType<typeof createPrintEngine>;
}

function harness(opts: {
  settings?: Partial<import("../src/print/types.ts").PrintBehavior> | Error;
  invokeNative?: (req: NativePrintRequest, n: number) => Promise<void>;
  browserPrint?: () => void | Promise<void>;
  mount?: (doc: PrintDocument) => Promise<void>;
} = {}): Harness {
  const calls: string[] = [];
  const native: NativePrintRequest[] = [];
  const deps: EngineDeps = {
    config,
    readSettings: async () => {
      if (opts.settings instanceof Error) throw opts.settings;
      return opts.settings ?? {};
    },
    mount: async (doc) => {
      calls.push(`mount:${doc.title}`);
      await opts.mount?.(doc);
    },
    unmount: () => calls.push("unmount"),
    invokeNative: async (req) => {
      native.push(req);
      calls.push(`native:${req.mode}`);
      await opts.invokeNative?.(req, native.length);
    },
    browserPrint: async () => {
      calls.push("browser");
      await opts.browserPrint?.();
    },
    sleep: async (ms) => {
      calls.push(`sleep:${ms}`);
    },
  };
  return { calls, native, deps, engine: createPrintEngine(deps) };
}

const doc = (title = "A", data: unknown = { n: 1 }): PrintDocument => ({ type: "invoice", title, data });

test("dialog (الافتراضي): يبقى المستند مركَّباً ويُنتظر DIALOG_SETTLE_MS", async () => {
  const h = harness();
  await h.engine.printDocument(doc());
  assert.deepEqual(h.native, [{ mode: "dialog" }]);
  assert.deepEqual(h.calls, ["mount:A", "native:dialog", `sleep:${DIALOG_SETTLE_MS}`]);
  assert.ok(!h.calls.includes("unmount"), "لا مسح مبكر في وضع النافذة");
});

test("direct: يمرّر الطابعة كما حُفظت + النسخ، ويمسح المستند بعد الإرسال", async () => {
  const h = harness({ settings: { mode: "direct", printerName: "HP LaserJet (شبكة)" } });
  await h.engine.printDocument(doc());
  assert.deepEqual(h.native, [
    { mode: "direct", printerName: "HP LaserJet (شبكة)", copies: 2, duplex: undefined },
  ]);
  assert.deepEqual(h.calls, ["mount:A", "native:direct", "unmount"]);
});

test("direct بلا طابعة محفوظة: تُحذف printerName (طابعة ويندوز الافتراضية)", async () => {
  const h = harness({ settings: { mode: "direct" } });
  await h.engine.printDocument(doc());
  assert.equal(h.native[0].printerName, undefined);
});

test("طلب الاستدعاء يغلب الإعدادات", async () => {
  const h = harness({ settings: { mode: "direct" } });
  await h.engine.printDocument(doc(), { mode: "dialog" });
  assert.deepEqual(h.native, [{ mode: "dialog" }]);
});

test("UNSUPPORTED ← window.print() ويبقى المستند", async () => {
  const h = harness({ settings: { mode: "direct" }, invokeNative: async () => { throw "UNSUPPORTED"; } });
  await h.engine.printDocument(doc());
  assert.deepEqual(h.calls, ["mount:A", "native:direct", "browser", `sleep:${DIALOG_SETTLE_MS}`]);
});

test("فشل window.print() بعد UNSUPPORTED = خطأ عربي ومسح المستند", async () => {
  const h = harness({
    invokeNative: async () => { throw "UNSUPPORTED"; },
    browserPrint: () => { throw new Error("denied"); },
  });
  await assert.rejects(h.engine.printDocument(doc()), (e: unknown) => e instanceof PrintError && /denied/.test(e.message));
  assert.ok(h.calls.includes("unmount"));
});

test("PRINTER_UNAVAILABLE + onPrinterUnavailable='dialog' ← تُفتح نافذة النظام", async () => {
  const h = harness({
    settings: { mode: "direct", printerName: "Gone" },
    invokeNative: async (req) => { if (req.mode === "direct") throw "PRINTER_UNAVAILABLE"; },
  });
  await h.engine.printDocument(doc());
  assert.deepEqual(h.native.map((r) => r.mode), ["direct", "dialog"]);
  assert.deepEqual(h.calls, ["mount:A", "native:direct", "native:dialog", `sleep:${DIALOG_SETTLE_MS}`]);
});

test("PRINTER_UNAVAILABLE + 'error' ← خطأ عربي يذكر الطابعة ويُمسح المستند", async () => {
  const h = harness({
    settings: { mode: "direct", printerName: "Gone" },
    invokeNative: async () => { throw "PRINTER_UNAVAILABLE"; },
  });
  await assert.rejects(
    h.engine.printDocument(doc(), { onPrinterUnavailable: "error" }),
    (e: unknown) => e instanceof PrintError && e.code === "PRINTER_UNAVAILABLE" && e.message.includes("Gone"),
  );
  assert.deepEqual(h.native.map((r) => r.mode), ["direct"]);
  assert.equal(h.calls.at(-1), "unmount");
});

test("خطأ أصلي آخر ← رسالة عربية تحمل النص، دون محاولة ثانية", async () => {
  const h = harness({
    settings: { mode: "direct" },
    invokeNative: async () => { throw "فشلت الطباعة المباشرة (رمز 0x80004005)."; },
  });
  await assert.rejects(h.engine.printDocument(doc()), /0x80004005/);
  assert.equal(h.native.length, 1);
});

test("فشل قراءة الإعدادات لا يمنع الطباعة (يحكم الافتراضي)", async () => {
  const h = harness({ settings: new Error("db down") });
  await h.engine.printDocument(doc());
  assert.deepEqual(h.native, [{ mode: "dialog" }]);
});

test("فشل التركيب ← خطأ PrintError ومسح", async () => {
  const h = harness({ mount: async () => { throw new Error("boom"); } });
  await assert.rejects(h.engine.printDocument(doc()), (e: unknown) => e instanceof PrintError && e.code === "NOT_READY");
  assert.equal(h.native.length, 0);
  assert.ok(h.calls.includes("unmount"));
});

test("الطابور: مهمتان مختلفتان بالتتابع، وفشل الأولى لا يوقف الثانية ولا تُسقَط أي منهما", async () => {
  const h = harness({
    settings: { mode: "direct" },
    invokeNative: async (_req, n) => { if (n === 1) throw "boom"; },
  });
  const first = h.engine.printDocument(doc("A", { id: 1 }));
  const second = h.engine.printDocument(doc("B", { id: 2 }));
  await assert.rejects(first, /boom/);
  await second;
  assert.deepEqual(h.calls.filter((c) => c.startsWith("mount:")), ["mount:A", "mount:B"]);
  assert.equal(h.native.length, 2);
  // لا تداخل: تركيب B بعد مسح A
  assert.ok(h.calls.indexOf("mount:B") > h.calls.indexOf("unmount"));
});

test("نقرتان متتاليتان على الفاتورة نفسها = طباعة واحدة وكلتاهما تستلم النتيجة", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const h = harness({ settings: { mode: "direct" }, invokeNative: () => gate });
  const a = h.engine.printDocument(doc("A", { id: 7 }));
  const b = h.engine.printDocument(doc("A", { id: 7 }));
  assert.equal(a, b, "نفس الوعدة المشتركة");
  release();
  await Promise.all([a, b]);
  assert.equal(h.native.length, 1);
});

test("نفس الفاتورة بعد اكتمال الأولى = مهمة جديدة (لا ابتلاع)", async () => {
  const h = harness({ settings: { mode: "direct" } });
  await h.engine.printDocument(doc("A", { id: 7 }));
  await h.engine.printDocument(doc("A", { id: 7 }));
  assert.equal(h.native.length, 2);
});

test("بيانات مختلفة أو تجاوز مختلف = لا دمج", async () => {
  const h = harness({ settings: { mode: "direct" } });
  const a = h.engine.printDocument(doc("A", { id: 1 }));
  const b = h.engine.printDocument(doc("A", { id: 2 }));
  const c = h.engine.printDocument(doc("A", { id: 1 }), { copies: 3 });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  await Promise.all([a, b, c]);
  assert.equal(h.native.length, 3);
});

// ───────── بيانات الوزّان ─────────

test("الوزّان: القيم المؤقتة المزروعة تُعامَل كفارغة، والباقي يُقصّ", () => {
  assert.deepEqual(
    normalizeWeigher({
      name: "اسم صاحب المؤسسة",
      phone1: "0600000000",
      phone2: null,
    }),
    EMPTY_WEIGHER,
  );
  const w = normalizeWeigher({ name: "  وزّان   الأمل ", phone1: " 0555 12 34 56 ", phone2: "" });
  assert.equal(w.name, "وزّان الأمل");
  assert.equal(w.phone1, "0555 12 34 56");
  assert.equal("address" in w, false, "لا عنوان للوزّان");
});

test("الوزّان: حدود الأطوال", () => {
  assert.equal(normalizeWeigher({ name: "x".repeat(200) }).name.length, 80);
  assert.equal(normalizeWeigher({ phone1: "1".repeat(99) }).phone1.length, 30);
});
