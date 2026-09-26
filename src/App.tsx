import { useState, useEffect, useCallback, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { HomePage } from "./components/HomePage";
import { MerchantsPage } from "./components/MerchantsPage";
import { ProductsPage } from "./components/ProductsPage";
import { InvoicesPage } from "./components/InvoicesPage";
import { BoxesPage } from "./components/BoxesPage";
import { SettingsPage } from "./components/SettingsPage";
import { boxService, merchantService, productService, invoiceService, type Box, type Merchant, type Product } from "./services/db";
import { makeDraft, draftFromInvoice } from "./components/InvoiceManager";
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
  // تبقى حالة الأرشيف عند العودة إليه بدل أن تتصفّر عند إزالة InvoicesPage من DOM.
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoicePage, setInvoicePage] = useState(1);
  // نطاق تاريخ اختياري لأرشيف الفواتير — "" يعني بلا حد لهذا الطرف. مرفوعة
  // هنا لنفس سبب invoiceSearch/invoicePage: لا تتصفّر عند مغادرة صفحة
  // الأرشيف والعودة إليها.
  const [invoiceDateFrom, setInvoiceDateFrom] = useState("");
  const [invoiceDateTo, setInvoiceDateTo] = useState("");
  // يمنع StrictMode في التطوير من تشغيل تنظيف الأرشيف مرتين في نفس الجلسة.
  const archiveMaintenanceStarted = useRef(false);

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

        // ── استرجاع تلقائي عند إعادة التشغيل (القسم 3 نقطة 3) ──
        // كل فاتورة is_open=1 تُفتَح من جديد بنفس حالتها، كل منها في تبويبها
        // الخاص. الفواتير القديمة بلا رقم بعد تُرقَّم كسولاً قبل التحويل.
        const openInvoices = await invoiceService.getOpenInvoices();

        const numberedInvoices = await Promise.all(
          openInvoices.map(async (invoice) => {
            if (invoice.invoice_number !== null) return invoice;
            const numbered = await invoiceService.ensureInvoiceNumbered(invoice.id);
            return { ...invoice, invoice_number: numbered.invoiceNumber };
          }),
        );

        if (numberedInvoices.length > 0) {
          const restoredDrafts = numberedInvoices.map((invoice) =>
            draftFromInvoice(invoice, visibleBoxes),
          );
          setDrafts(restoredDrafts);
          setActiveId(restoredDrafts[0].id);
        } else {
          const firstId = newId();
          setDrafts([makeDraft(firstId, visibleBoxes)]);
          setActiveId(firstId);
        }

        // ── صيانة صامتة للأرشيف (القسم 6.8) ──
        // بلا await عمداً: لا تُؤخِّر ظهور الواجهة، وتأتي بعد استرجاع الفواتير
        // المفتوحة فلا تسبقها في طابور DB. أي خطأ يُسجَّل في الـ console فقط —
        // لا alert ولا Toast. آمنة تحت StrictMode (استدعاء ثانٍ = no-op).
        if (!archiveMaintenanceStarted.current) {
          archiveMaintenanceStarted.current = true;
          invoiceService.pruneArchiveIfNeeded().catch((err) => {
            console.error("خطأ أثناء صيانة الأرشيف:", err);
          });
        }
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

  // نفس النمط، لإكمال تحديث قائمة الصناديق النشطة فوراً بعد أي إضافة/تعديل/
  // حذف/تبديل رؤية من BoxesPage — getVisible() نفسها المستخدمة في التحميل
  // الأولي (القسم 6.4 من AI_CONTEXT.md: النشطة فقط هي ما يظهر للوزّان).
  const refreshBoxes = useCallback(async () => {
    try {
      const data = await boxService.getVisible();
      setRealBoxes(data);
    } catch (err) {
      console.error("خطأ أثناء تحديث الصناديق:", err);
    }
  }, []);

  // فتح فاتورة موجودة للتعديل (من أرشيف الفواتير) — القسم 8 من مهمة الجزء
  // الثاني: setOpenState(id, true) → getInvoiceFullDetails → ترقيم كسول إن لزم
  // → فحص تكرار (القسم 5) → تحميل عبر draftFromInvoice في تبويب جديد.
  const onOpenInvoiceForEdit = useCallback(async (invoiceId: number) => {
    const existingTab = drafts.find((d) => d.invoiceId === invoiceId);
    if (existingTab) {
      setActiveId(existingTab.id);
      setActivePage("home");
      alert("هذه الفاتورة مفتوحة بالفعل في تبويب آخر");
      return;
    }

    try {
      // نقطة 12: إعادة فتح فاتورة مغلقة تتحول فوراً إلى is_open=1 عند التحميل
      await invoiceService.setOpenState(invoiceId, 1);

      const invoice = await invoiceService.getInvoiceFullDetails(invoiceId);
      if (!invoice) return;

      let finalInvoice = invoice;
      if (invoice.invoice_number === null) {
        const numbered = await invoiceService.ensureInvoiceNumbered(invoice.id);
        finalInvoice = { ...invoice, invoice_number: numbered.invoiceNumber };
      }

      const newDraft = draftFromInvoice(finalInvoice, realBoxes);
      setDrafts((prev) => [...prev, newDraft]);
      setActiveId(newDraft.id);
      setActivePage("home");
    } catch (error) {
      console.error("خطأ أثناء فتح الفاتورة للتعديل:", error);
      alert("تعذر فتح الفاتورة، يرجى مراجعة سجل الأخطاء.");
    }
  }, [drafts, realBoxes]);

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
        {activePage === "invoices"  && (
          <InvoicesPage
            onOpenInvoiceForEdit={onOpenInvoiceForEdit}
            search={invoiceSearch}
            onSearchChange={setInvoiceSearch}
            page={invoicePage}
            onPageChange={setInvoicePage}
            dateFrom={invoiceDateFrom}
            onDateFromChange={setInvoiceDateFrom}
            dateTo={invoiceDateTo}
            onDateToChange={setInvoiceDateTo}
          />
        )}
        {activePage === "boxes"     && <BoxesPage onDataChange={refreshBoxes} />}
        {activePage === "settings"  && <SettingsPage />}
      </main>
    </div>
  );
}