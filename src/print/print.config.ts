// ============================================================================
// إعداد الطباعة الافتراضي للمشروع. الأولوية وقت الطباعة:
//   طلب الاستدعاء > الإعدادات المحفوظة (print_mode + طابعة الإعدادات)
//   > byDocument[type] > default (هذا الملف).
// ============================================================================

import { definePrintConfig } from "./behavior.ts";

export const printConfig = definePrintConfig({
  default: {
    mode: "dialog",
    onPrinterUnavailable: "dialog",
    // copies: 1,
    // duplex: "default", // 'one-sided' | 'long-edge' | 'short-edge'
  },
  // byDocument: { invoice: { copies: 2 } },
});
