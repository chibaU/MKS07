// ============================================================================
// نقطة الدخول: printDocument(doc, override?). هنا فقط يُوصَل المحرك البحت
// (engine.ts) بالعالم الحقيقي: الإعدادات في قاعدة البيانات، #print-root، أمر Rust.
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import { loadPrintSettings } from "../services/printSettings";
import { createPrintEngine } from "./engine.ts";
import { printConfig } from "./print.config.ts";
import { hasDocumentType } from "./registry.tsx";
import { clearJob, setJob, waitRendered } from "./store.ts";
import { PrintError, type PrintDocument } from "./types.ts";

const RENDER_TIMEOUT_MS = 5000;
const FONTS_TIMEOUT_MS = 3000;
const FRAME_TIMEOUT_MS = 120;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** إطار رسم واحد؛ مؤقت احتياطي لأن rAF يتوقف إن كانت النافذة مصغَّرة/محجوبة. */
function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, FRAME_TIMEOUT_MS);
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      resolve();
    });
  });
}

async function imagesDecoded(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
}

let baseTitle: string | null = null;

async function mount(doc: PrintDocument): Promise<void> {
  if (!hasDocumentType(doc.type)) {
    throw new PrintError("INVALID_DOCUMENT", `نوع مستند الطباعة غير معروف: ${doc.type}`);
  }

  // عنوان الصفحة يصير اسم مهمة الطباعة في الطابعة.
  baseTitle ??= document.title;
  document.title = doc.title;

  const job = setJob(doc);
  await waitRendered(job.id, RENDER_TIMEOUT_MS);
  await nextFrame();
  await nextFrame();
  await Promise.race([document.fonts.ready, sleep(FONTS_TIMEOUT_MS)]);
  const root = document.getElementById("print-root");
  if (root) await imagesDecoded(root);
}

function unmount(): void {
  clearJob();
  if (baseTitle !== null) {
    document.title = baseTitle;
    baseTitle = null;
  }
}

const engine = createPrintEngine({
  config: printConfig,
  readSettings: loadPrintSettings,
  mount,
  unmount,
  invokeNative: (req) => invoke<void>("print_webview", { req }),
  // Tauri يستبدل window.print بأمر plugin:webview|print (يحتاج core:webview:allow-print).
  browserPrint: () => window.print(),
  sleep,
});

export const printDocument = engine.printDocument;
