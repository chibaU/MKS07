import { memo } from "react";
import { Home, Users, Package, FileText, Archive, Settings, Smartphone } from "lucide-react";

type Page = "home" | "merchants" | "products" | "invoices" | "boxes" | "phoneSync" | "settings";

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

const navItems = [
  { id: "home" as Page, label: "الرئيسية", icon: Home },
  { id: "merchants" as Page, label: "التجار", icon: Users },
  { id: "products" as Page, label: "المنتجات", icon: Package },
  { id: "invoices" as Page, label: "الفواتير", icon: FileText },
  { id: "boxes" as Page, label: "الصناديق", icon: Archive },
  { id: "phoneSync" as Page, label: "مزامنة الهاتف", icon: Smartphone },
  { id: "settings" as Page, label: "الإعدادات", icon: Settings },
];

export const Sidebar = memo(function Sidebar({ activePage, onNavigate }: SidebarProps) {
  return (
    <aside
      style={{
        width: "240px",
        minWidth: "240px",
        backgroundColor: "#1E293B",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        position: "fixed",
        right: 0,
        top: 0,
        zIndex: 100,
        boxShadow: "-2px 0 10px rgba(0,0,0,0.15)",
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: "24px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "40px",
            backgroundColor: "#2563EB",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <FileText size={22} color="white" />
        </div>
        <div>
          <div style={{ color: "white", fontSize: "15px", fontWeight: 700, lineHeight: 1.2 }}>
            نظام الفواتير
          </div>
          <div style={{ color: "#94A3B8", fontSize: "12px" }}>الإدارة المالية</div>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", gap: "4px" }}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "12px 14px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                width: "100%",
                textAlign: "right",
                transition: "all 0.15s",
                backgroundColor: isActive ? "#2563EB" : "transparent",
                color: isActive ? "white" : "#94A3B8",
                fontFamily: "'Cairo', sans-serif",
                fontSize: "14px",
                fontWeight: isActive ? 600 : 400,
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(255,255,255,0.08)";
                  (e.currentTarget as HTMLButtonElement).style.color = "white";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.color = "#94A3B8";
                }
              }}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        style={{
          padding: "16px 20px",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          color: "#64748B",
          fontSize: "12px",
          textAlign: "center",
        }}
      >
        © 2026 نظام الفواتير
      </div>
    </aside>
  );
});
