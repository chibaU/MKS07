// مكوّنات عرض صغيرة مشتركة داخل الميزة (أنماط inline كبقية المشروع، خط Cairo، ألوان MKS).

import type { ReactNode } from "react";
import { font } from "./styles.ts";

type BtnKind = "primary" | "default" | "danger" | "ghost" | "success";

const btnColors: Record<BtnKind, { bg: string; fg: string; border: string }> = {
  primary: { bg: "#2563EB", fg: "white", border: "#2563EB" },
  success: { bg: "#16A34A", fg: "white", border: "#16A34A" },
  danger: { bg: "#DC2626", fg: "white", border: "#DC2626" },
  default: { bg: "white", fg: "#1E293B", border: "#CBD5E1" },
  ghost: { bg: "transparent", fg: "#475569", border: "transparent" },
};

export function Btn(props: {
  kind?: BtnKind;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
  small?: boolean;
}) {
  const c = btnColors[props.kind ?? "default"];
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: props.small ? "6px 12px" : "9px 18px",
        borderRadius: "8px",
        border: `1px solid ${c.border}`,
        backgroundColor: c.bg,
        color: c.fg,
        fontFamily: font,
        fontSize: props.small ? "13px" : "14px",
        fontWeight: 600,
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.55 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {props.children}
    </button>
  );
}

type ChipKind = "green" | "red" | "amber" | "blue" | "gray";
const chipColors: Record<ChipKind, { bg: string; fg: string }> = {
  green: { bg: "#DCFCE7", fg: "#166534" },
  red: { bg: "#FEE2E2", fg: "#991B1B" },
  amber: { bg: "#FEF3C7", fg: "#92400E" },
  blue: { bg: "#DBEAFE", fg: "#1E40AF" },
  gray: { bg: "#F1F5F9", fg: "#475569" },
};

export function Chip({ kind, children }: { kind: ChipKind; children: ReactNode }) {
  const c = chipColors[kind];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 10px",
        borderRadius: "999px",
        backgroundColor: c.bg,
        color: c.fg,
        fontSize: "12px",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function Banner({ kind, children }: { kind: "error" | "warn" | "info" | "ok"; children: ReactNode }) {
  const map = {
    error: { bg: "#FEF2F2", border: "#FECACA", fg: "#991B1B" },
    warn: { bg: "#FFFBEB", border: "#FDE68A", fg: "#92400E" },
    info: { bg: "#EFF6FF", border: "#BFDBFE", fg: "#1E40AF" },
    ok: { bg: "#F0FDF4", border: "#BBF7D0", fg: "#166534" },
  }[kind];
  return (
    <div
      style={{
        backgroundColor: map.bg,
        border: `1px solid ${map.border}`,
        color: map.fg,
        borderRadius: "10px",
        padding: "10px 14px",
        fontSize: "13px",
        lineHeight: 1.8,
        marginBottom: "12px",
      }}
    >
      {children}
    </div>
  );
}
