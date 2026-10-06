// أنماط ومساعدات عرض مشتركة داخل الميزة (inline كبقية المشروع، خط Cairo، ألوان MKS).
// مفصولة عن ui.tsx لأن Fast Refresh يشترط أن تصدّر ملفات المكوّنات مكوّنات فقط.

import type { CSSProperties } from "react";

export const font = "'Cairo', sans-serif";

export const s: Record<string, CSSProperties> = {
  page: { padding: "28px 32px 60px", fontFamily: font, direction: "rtl", maxWidth: "1100px", margin: "0 auto" },
  title: { fontSize: "24px", fontWeight: 700, color: "#1E293B", margin: 0 },
  subtitle: { fontSize: "14px", color: "#64748B", marginTop: "4px" },
  card: { backgroundColor: "white", border: "1px solid #E2E8F0", borderRadius: "12px", padding: "20px", marginBottom: "16px" },
  cardTitle: { fontSize: "16px", fontWeight: 700, color: "#1E293B", margin: "0 0 12px", display: "flex", alignItems: "center", gap: "8px" },
  muted: { fontSize: "13px", color: "#64748B", lineHeight: 1.8 },
  row: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
  mono: { fontFamily: "ui-monospace, Consolas, monospace", direction: "ltr", unicodeBidi: "embed" },
  th: { textAlign: "right", padding: "10px 12px", fontSize: "12px", fontWeight: 600, color: "#64748B", backgroundColor: "#F8FAFC", borderBottom: "1px solid #E2E8F0", whiteSpace: "nowrap" },
  td: { textAlign: "right", padding: "10px 12px", fontSize: "13px", color: "#1E293B", borderBottom: "1px solid #F1F5F9", verticalAlign: "top" },
  num: { fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "embed", display: "inline-block" },
};

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 03/10/2026 14:05 — بتوقيت الجهاز. */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const w2 = (n: number): string => n.toFixed(2);
