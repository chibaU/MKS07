import { useState, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { HomePage } from "./components/HomePage";
import { MerchantsPage } from "./components/MerchantsPage";
import { ProductsPage } from "./components/ProductsPage";
import { InvoicesPage } from "./components/InvoicesPage";
import { BoxesPage } from "./components/BoxesPage";
import { SettingsPage } from "./components/SettingsPage";
import { boxService, type Box } from "./services/db";
import { makeDraft } from "./components/InvoiceManager";
import type { Draft } from "./components/invoice";

type Page = "home" | "merchants" | "products" | "invoices" | "boxes" | "settings";

const SIDEBAR_WIDTH = 240;
const newId = () => `d${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export default function App() {
  const [activePage, setActivePage] = useState<Page>("home");

  // ── حالة الصناديق والمسودات مرفوعة إلى App لتبقى محفوظة عند التنقل بين الصفحات
  const [realBoxes, setRealBoxes] = useState<Box[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [boxesLoading, setBoxesLoading] = useState<boolean>(true);

  // تحميل الصناديق مرة واحدة فقط عند تشغيل التطبيق
  useEffect(() => {
    async function fetchDBBoxes() {
      try {
        const visibleBoxes = await boxService.getVisible();
        setRealBoxes(visibleBoxes);

        const firstId = newId();
        setDrafts([makeDraft(firstId, visibleBoxes)]);
        setActiveId(firstId);
      } catch (err) {
        console.error("خطأ أثناء تحميل الصناديق:", err);
      } finally {
        setBoxesLoading(false);
      }
    }
    fetchDBBoxes();
  }, []);

  return (
    <div
      style={{
        direction: "rtl",
        fontFamily: "'Cairo', sans-serif",
        backgroundColor: "#F8FAFC",
        minHeight: "100vh",
        display: "flex",
      }}
    >
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main
        style={{
          marginRight: `${SIDEBAR_WIDTH}px`,
          flex: 1,
          minHeight: "100vh",
          backgroundColor: "#F8FAFC",
          overflowY: "auto",
        }}
      >
        {/*
          ── نستخدم display:none بدلاً من إزالة المكون من DOM
          ── هذا يبقي الـ state محفوظاً في الذاكرة حتى عند الانتقال لصفحة أخرى
        */}

        {/* الصفحة الرئيسية - تبقى مُحمَّلة دائماً في الخلفية */}
        <div style={{ display: activePage === "home" ? "block" : "none" }}>
          {boxesLoading || drafts.length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", fontFamily: "'Cairo', sans-serif", color: "#64748B" }}>
              جاري تهيئة نظام الصناديق والمسودات الحية...
            </div>
          ) : (
            <HomePage
              realBoxes={realBoxes}
              drafts={drafts}
              setDrafts={setDrafts}
              activeId={activeId}
              setActiveId={setActiveId}
            />
          )}
        </div>

        {/* بقية الصفحات - تُحمَّل فقط عند الحاجة */}
        {activePage === "merchants" && <MerchantsPage />}
        {activePage === "products"  && <ProductsPage />}
        {activePage === "invoices"  && <InvoicesPage />}
        {activePage === "boxes"     && <BoxesPage />}
        {activePage === "settings"  && <SettingsPage />}
      </main>
    </div>
  );
}
