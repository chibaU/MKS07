// ============================================================================
// حالة الميزة (State مستقل) — متجر على مستوى الوحدة + useSyncExternalStore.
// لا Redux ولا Context ولا رفع حالة إلى App.tsx: الميزة تملك حالتها بالكامل.
//
// لماذا على مستوى الوحدة لا داخل المكوّن؟ لأن الخدمة تبقى تعمل حين ينتقل المستخدم
// إلى صفحة أخرى (تُنزَع الصفحة من DOM)، ويجب أن يبقى مستمع طلبات الكتالوج حيّاً
// ليردّ على الهواتف بأحدث بيانات. المكوّن مجرّد عرض لهذه الحالة.
// الحقيقة نفسها (الفواتير المعلّقة، القرارات) محفوظة في Rust على القرص — هذا المتجر
// نسخة عرض يمكن إعادة بنائها في أي لحظة من refreshAll().
// ============================================================================

import { useSyncExternalStore } from "react";
import { bridge, errText } from "./bridge.ts";
import type { ReviewResult } from "./domain/review.ts";
import { ConfirmBlockedError, confirmRecord, NeedsAttentionError, recoverSaving, reviewFor } from "./services/confirm.ts";
import { buildCatalog, loadReferenceData } from "./services/data.ts";
import type { InboxRecord, LedgerEntry, ServiceStatus } from "./types.ts";

export interface Notice {
  id: number;
  kind: "ok" | "error" | "info";
  text: string;
}

export interface PhoneSyncState {
  loaded: boolean;
  status: ServiceStatus | null;
  statusError: string | null;
  inbox: InboxRecord[];
  reviews: Record<string, ReviewResult>;
  recent: LedgerEntry[];
  /** uid → سبب يحتاج تدخلاً يدوياً (حفظ انقطع في منتصفه ولا يمكن الجزم بحالته). */
  attention: Record<string, string>;
  busy: string | null;
  notice: Notice | null;
}

let state: PhoneSyncState = {
  loaded: false,
  status: null,
  statusError: null,
  inbox: [],
  reviews: {},
  recent: [],
  attention: {},
  busy: null,
  notice: null,
};

const listeners = new Set<() => void>();

function set(patch: Partial<PhoneSyncState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getState(): PhoneSyncState {
  return state;
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function usePhoneSync(): PhoneSyncState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ───────── إشعارات ─────────
let noticeSeq = 0;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

export function notify(kind: Notice["kind"], text: string): void {
  const id = ++noticeSeq;
  set({ notice: { id, kind, text } });
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    if (state.notice?.id === id) set({ notice: null });
  }, kind === "error" ? 12000 : 7000);
}

export function dismissNotice(): void {
  set({ notice: null });
}

// ───────── مزوّد الكتالوج (يردّ على طلبات الهواتف) ─────────
let providerActive = false;

async function ensureProvider(): Promise<void> {
  if (providerActive) return;
  providerActive = true;
  try {
    await bridge.setProviderReady(true);
    await bridge.publishCatalog(await buildCatalog());
  } catch (e) {
    providerActive = false;
    notify("error", `تعذّر تجهيز بيانات الهاتف: ${errText(e)}`);
  }
}

async function answerCatalogRequest(requestId: number): Promise<void> {
  try {
    await bridge.provideCatalog(requestId, await buildCatalog());
  } catch (e) {
    try {
      await bridge.provideCatalogError(requestId, `تعذّرت قراءة التجار والصناديق من قاعدة البيانات: ${errText(e)}`);
    } catch {
      /* لا شيء — الهاتف سيحصل على النسخة المحفوظة */
    }
  }
}

// ───────── التحديث ─────────
let refreshing = false;
let refreshAgain = false;
const recovering = new Set<string>();

async function recoverPending(inbox: InboxRecord[]): Promise<void> {
  for (const rec of inbox) {
    if (rec.state !== "saving" || recovering.has(rec.uid)) continue;
    recovering.add(rec.uid);
    try {
      const out = await recoverSaving(rec);
      if (out.kind === "confirmed") {
        notify("ok", `أُكمل حفظ فاتورة كانت قيد الحفظ عند الإغلاق — رقمها ${out.invoiceNumber}`);
        void refreshAll();
      } else if (out.kind === "reverted") {
        void refreshAll();
      } else {
        set({ attention: { ...state.attention, [rec.uid]: out.reason } });
      }
    } catch (e) {
      set({ attention: { ...state.attention, [rec.uid]: errText(e) } });
    }
  }
}

export async function refreshAll(): Promise<void> {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    do {
      refreshAgain = false;
      const [status, inbox, recent] = await Promise.all([bridge.status(), bridge.listInbox(), bridge.recentDecisions(15)]);
      let reviews = state.reviews;
      try {
        const ref = await loadReferenceData();
        reviews = Object.fromEntries(inbox.map((r) => [r.uid, reviewFor(r, ref)]));
      } catch {
        /* نُبقي المراجعات السابقة؛ يظهر الخطأ عند فتح المراجعة نفسها */
      }
      set({ status, inbox, recent, reviews, statusError: null, loaded: true });
      if (status.running) void ensureProvider();
      void recoverPending(inbox);
    } while (refreshAgain);
  } catch (e) {
    set({ statusError: errText(e), loaded: true });
  } finally {
    refreshing = false;
  }
}

async function pollStatus(): Promise<void> {
  try {
    const status = await bridge.status();
    const known = state.inbox.length;
    set({ status, statusError: null });
    if (status.inbox.pending + status.inbox.saving !== known) void refreshAll();
  } catch (e) {
    set({ statusError: errText(e) });
  }
}

// ───────── دورة الحياة ─────────
let attachCount = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let listening: Promise<void> | null = null;

function ensureListeners(): Promise<void> {
  if (listening) return listening;
  listening = (async () => {
    // لا نزيل هذا المستمع أبداً: يجب أن تردّ الخدمة على الهواتف حتى والصفحة مغلقة.
    await bridge.onCatalogRequest((id) => void answerCatalogRequest(id));
    await bridge.onInboxChanged(() => {
      if (attachCount > 0) void refreshAll();
    });
    await bridge.onStatusChanged(() => {
      if (attachCount > 0) void pollStatus();
    });
  })().catch((e) => {
    listening = null;
    set({ statusError: `تعذّر الاستماع لأحداث الخدمة: ${errText(e)}` });
  });
  return listening;
}

/** تستدعيها الصفحة عند التركيب؛ تُرجع دالة التنظيف. */
export function attach(): () => void {
  attachCount++;
  void ensureListeners().then(() => refreshAll());
  if (!pollTimer) pollTimer = setInterval(() => void pollStatus(), 4000);
  return () => {
    attachCount--;
    if (attachCount <= 0) {
      attachCount = 0;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

// ───────── الإجراءات ─────────
async function withBusy(key: string, fn: () => Promise<void>): Promise<void> {
  if (state.busy) return;
  set({ busy: key });
  try {
    await fn();
  } finally {
    set({ busy: null });
  }
}

export function startService(): Promise<void> {
  return withBusy("start", async () => {
    try {
      providerActive = false;
      const status = await bridge.start();
      set({ status });
      await ensureProvider();
      notify("ok", "بدأت خدمة مزامنة الهاتف");
    } catch (e) {
      notify("error", errText(e));
      await refreshAll();
    }
  });
}

export function stopService(): Promise<void> {
  return withBusy("stop", async () => {
    try {
      await bridge.setProviderReady(false).catch(() => undefined);
      providerActive = false;
      set({ status: await bridge.stop() });
      notify("info", "أُوقفت الخدمة — الفواتير المعلّقة محفوظة ولن تضيع");
    } catch (e) {
      notify("error", errText(e));
    }
  });
}

export function rotateKey(): Promise<void> {
  return withBusy("rotate", async () => {
    try {
      set({ status: await bridge.rotateKey() });
      notify("ok", "جُدِّد مفتاح الوصول. امسح رمز QR الجديد على الهواتف.");
    } catch (e) {
      notify("error", errText(e));
    }
  });
}

export function exportCaFile(): Promise<void> {
  return withBusy("export", async () => {
    try {
      const path = await bridge.exportCa();
      notify("ok", `حُفظ ملف شهادة الأمان في: ${path} — أرسله إلى الهاتف (كابل USB أو بلوتوث أو واتساب أو بريد) ثم ثبّته من إعدادات الهاتف.`);
    } catch (e) {
      notify("error", errText(e));
    }
  });
}

const inFlight = new Set<string>();

export async function confirmInvoice(uid: string): Promise<boolean> {
  const rec = state.inbox.find((r) => r.uid === uid);
  if (!rec || inFlight.has(uid)) return false;
  inFlight.add(uid);
  set({ busy: `confirm:${uid}` });
  try {
    const res = await confirmRecord(rec);
    const rest = { ...state.attention };
    delete rest[uid];
    set({ attention: rest });
    notify("ok", `حُفظت الفاتورة في النظام برقم ${res.invoiceNumber}`);
    await refreshAll();
    return true;
  } catch (e) {
    if (e instanceof NeedsAttentionError) {
      set({ attention: { ...state.attention, [uid]: e.message } });
      notify("error", e.message);
    } else if (e instanceof ConfirmBlockedError) {
      set({ reviews: { ...state.reviews, [uid]: e.review } });
      notify("error", e.message);
    } else {
      notify("error", errText(e));
    }
    await refreshAll();
    return false;
  } finally {
    inFlight.delete(uid);
    set({ busy: null });
  }
}

export async function rejectInvoice(uid: string, reason: string): Promise<boolean> {
  if (inFlight.has(uid)) return false;
  inFlight.add(uid);
  set({ busy: `reject:${uid}` });
  try {
    await bridge.reject(uid, reason.trim() || null);
    notify("info", "رُفضت الفاتورة. تبقى نسختها على الهاتف وتظهر هناك كمرفوضة.");
    await refreshAll();
    return true;
  } catch (e) {
    notify("error", errText(e));
    return false;
  } finally {
    inFlight.delete(uid);
    set({ busy: null });
  }
}

/** إعادة محاولة فاتورة عالقة بحالة "saving" دون معرّف محفوظ بعد أن تحقّق المستخدم من الأرشيف. */
export async function releaseStuck(uid: string): Promise<void> {
  try {
    await bridge.abortSave(uid);
    const rest = { ...state.attention };
    delete rest[uid];
    set({ attention: rest });
    await refreshAll();
    notify("info", "أُعيدت الفاتورة إلى قائمة الانتظار. راجعها ثم أكّدها.");
  } catch (e) {
    notify("error", errText(e));
  }
}
