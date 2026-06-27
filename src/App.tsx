import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { HomePage } from "./components/HomePage";
import { MerchantsPage } from "./components/MerchantsPage";
import { ProductsPage } from "./components/ProductsPage";
import { InvoicesPage } from "./components/InvoicesPage";
import { BoxesPage } from "./components/BoxesPage";
import { SettingsPage } from "./components/SettingsPage";
import { boxService, merchantService, productService, type Box, type Merchant, type Product } from "./services/db";
import { makeDraft } from "./components/InvoiceManager";
import type { Draft } from "./components/invoice";

type Page = "home" | "merchants" | "products" | "invoices" | "boxes" | "settings";

const SIDEBAR_WIDTH = 240;
const newId = () => `d${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export default function App() {
  const [activePage, setActivePage] = useState<Page>("home");

  // ── حالة الصناديق والمسودات: مرفوعة إلى App لتبقى عند التنقل بين الصفحات
  const [realBoxes, setRealBoxes]   = useState<Box[]>([]);
  const [drafts, setDrafts]         = useState<Draft[]>([]);
  const [activeId, setActiveId]     = useState<string>("");
  const [boxesLoading, setBoxesLoading] = useState<boolean>(true);

  // ── إصلاح 3: merchants و products مرفوعة هنا حتى تتحدث تلقائياً بعد الإضافة
  const [merchants, setMerchants]   = useState<Merchant[]>([]);
  const [products,  setProducts]    = useState<Product[]>([]);

  // تحميل كل البيانات الثابتة مرة واحدة عند تشغيل التطبيق
  useEffect(() => {
    async function init() {
      try {
        const [visibleBoxes, allMerchants, allProducts] = await Promise.all([
          boxService.getVisible(),
          merchantService.getAll(),
          productService.getAll(),
        ]);

        setRealBoxes(visibleBoxes);
        setMerchants(allMerchants);
        setProducts(allProducts);

        const firstId = newId();
        setDrafts([makeDraft(firstId, visibleBoxes)]);
        setActiveId(firstId);
      } catch (err) {
        console.error("خطأ أثناء التهيئة:", err);
      } finally {
        setBoxesLoading(false);
      }
    }
    init();
  }, []);

  // إصلاح 3: دالة لإعادة جلب التجار والمنتجات من الخارج (تُستدعى بعد الإضافة/الحذف)
  const refreshMerchants = useCallback(async () => {
    try {
      const data = await merchantService.getAll();
      setMerchants(data);
    } catch (err) {
      console.error("خطأ أثناء تحديث التجار:", err);
    }
  }, []);

  const refreshProducts = useCallback(async () => {
    try {
      const data = await productService.getAll();
      setProducts(data);
    } catch (err) {
      console.error("خطأ أثناء تحديث المنتجات:", err);
    }
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
        {/* الصفحة الرئيسية — display:none بدل إزالة من DOM لحفظ الـ state */}
        <div style={{ display: activePage === "home" ? "block" : "none" }}>
          {boxesLoading || drafts.length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", fontFamily: "'Cairo', sans-serif", color: "#64748B" }}>
              جاري تهيئة نظام الصناديق والمسودات...
            </div>
          ) : (
            <HomePage
              realBoxes={realBoxes}
              drafts={drafts}
              setDrafts={setDrafts}
              activeId={activeId}
              setActiveId={setActiveId}
              merchants={merchants}
              products={products}
            />
          )}
        </div>

        {/* بقية الصفحات — تُحمَّل عند الحاجة فقط، وتمرر دوال التحديث */}
        {activePage === "merchants" && <MerchantsPage onDataChange={refreshMerchants} />}
        {activePage === "products"  && <ProductsPage  onDataChange={refreshProducts}  />}
        {activePage === "invoices"  && <InvoicesPage />}
        {activePage === "boxes"     && <BoxesPage />}
        {activePage === "settings"  && <SettingsPage />}
      </main>
    </div>
  );
}
