import { useEffect, useState } from "react";
import { Eye, Trash2, Search, ChevronRight, ChevronLeft } from "lucide-react";
import { invoiceService, type InvoiceWithMerchant, type InvoiceFullDetails } from "../services/db";

const s = {
  page: { padding: "32px", direction: "rtl" as const },
  h1: { color: "#1E293B", fontSize: "24px", fontWeight: 700, margin: 0 },
  subtitle: { color: "#64748B", fontSize: "14px", marginTop: "4px" },
  topBar: {
    display: "flex",
    gap: "12px",
    marginBottom: "20px",
    alignItems: "center",
    backgroundColor: "white",
    padding: "16px 20px",
    borderRadius: "10px",
    border: "1px solid #E2E8F0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  searchWrap: { position: "relative" as const, flex: 1 },
  searchIcon: { position: "absolute" as const, right: "12px", top: "50%", transform: "translateY(-50%)", color: "#94A3B8" },
  searchInput: { width: "100%", padding: "10px 38px 10px 12px", border: "1px solid #CBD5E1", borderRadius: "8px", fontSize: "14px", fontFamily: "'Cairo', sans-serif", boxSizing: "border-box" as const, outline: "none" },
  tableCard: { backgroundColor: "white", borderRadius: "12px", border: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(0,0,0,0.02)", overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse" as const, textAlign: "right" as const },
  th: { backgroundColor: "#F8FAFC", color: "#64748B", fontWeight: 650, fontSize: "13px", padding: "14px 20px", borderBottom: "1px solid #E2E8F0" },
  td: { padding: "14px 20px", borderBottom: "1px solid #E2E8F0", color: "#334155", fontSize: "14px" },
  actionBtn: { border: "none", background: "none", cursor: "pointer", padding: "4px", borderRadius: "4px", display: "inline-flex", alignItems: "center", justifyContent: "center" },
  
  // أنماط معاينة تفاصيل الفاتورة
  detailPanel: { marginTop: "24px", backgroundColor: "#F8FAFC", padding: "24px", borderRadius: "12px", border: "1px solid #E2E8F0" },
  
  // الترقيم (Pagination)
  paginationBar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "20px" }
};

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceWithMerchant[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceFullDetails | null>(null);

  const ITEMS_PER_PAGE = 8;

  // 1. جلب الفواتير من قاعدة البيانات بنظام الصفحات
  const loadInvoices = async () => {
    try {
      setLoading(true);
      const offset = (page - 1) * ITEMS_PER_PAGE;
      const data = await invoiceService.getInvoicesWithPagination(ITEMS_PER_PAGE, offset);
      setInvoices(data);
    } catch (error) {
      console.error("خطأ أثناء جلب الفواتير:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
    setSelectedInvoice(null); // إعادة تعيين الفاتورة المفتوحة عند تغيير الصفحة
  }, [page]);

  // 2. تصفية الفواتير في الصفحة الحالية حسب البحث (اسم التاجر أو رقم الفاتورة)
  const filteredInvoices = invoices.filter((inv) => {
    const term = search.toLowerCase();
    return (
      inv.id.toString().includes(term) ||
      (inv.merchant_name && inv.merchant_name.toLowerCase().includes(term))
    );
  });

  // 3. جلب التفاصيل الكاملة لفاتورة معينة لعرضها
  const handleViewDetails = async (id: number) => {
    try {
      const fullDetails = await invoiceService.getInvoiceFullDetails(id);
      setSelectedInvoice(fullDetails);
    } catch (error) {
      console.error("خطأ في جلب تفاصيل الفاتورة:", error);
    }
  };

  // 4. حذف الفاتورة نهائياً
  const handleDeleteInvoice = async (id: number) => {
    if (confirm(`هل أنت متأكد من حذف الفاتورة رقم #${id} نهائياً؟ سيتم استرجاع وحذف كافة الصناديق والأوزان المسجلة فيها.`)) {
      try {
        await invoiceService.deleteInvoice(id);
        if (selectedInvoice?.id === id) setSelectedInvoice(null);
        await loadInvoices();
      } catch (error) {
        console.error("خطأ أثناء حذف الفاتورة:", error);
      }
    }
  };

  return (
    <div style={s.page}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={s.h1}>📄 أرشيف الفواتير</h1>
        <div style={s.subtitle}>عرض وفحص عمليات البيع والشراء المسجلة في النظام</div>
      </div>

      <div style={s.topBar}>
        <div style={s.searchWrap}>
          <Search size={18} style={s.searchIcon} />
          <input
            style={s.searchInput}
            placeholder="بحث برقم الفاتورة أو اسم التاجر..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div style={s.tableCard}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={{ ...s.th, width: "100px" }}>رقم الفاتورة</th>
              <th style={s.th}>التاجر</th>
              <th style={s.th}>التاريخ</th>
              <th style={s.th}>المبلغ الإجمالي</th>
              <th style={{ ...s.th, width: "120px", textAlign: "center" }}>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ ...s.td, textAlign: "center", color: "#64748B" }}>
                  جاري تحميل الفواتير من قاعدة البيانات...
                </td>
              </tr>
            ) : filteredInvoices.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...s.td, textAlign: "center", color: "#94A3B8" }}>
                  لا توجد فواتير مسجلة مطابقة للبحث.
                </td>
              </tr>
            ) : (
              filteredInvoices.map((inv) => (
                <tr key={inv.id}>
                  <td style={{ ...s.td, fontFamily: "monospace", fontWeight: 600 }}>#{inv.id}</td>
                  <td style={{ ...s.td, fontWeight: 600, color: "#1E293B" }}>{inv.merchant_name || "تاجر عام / نقدي"}</td>
                  <td style={s.td}>{inv.invoice_date || "—"}</td>
                  <td style={{ ...s.td, fontWeight: 700, color: "#16A34A" }}>{inv.total_amount.toLocaleString()} دج</td>
                  <td style={{ ...s.td, textAlign: "center" }}>
                    <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                      <button style={{ ...s.actionBtn, color: "#2563EB" }} onClick={() => handleViewDetails(inv.id)} title="عرض التفاصيل والوزن">
                        <Eye size={16} />
                      </button>
                      <button style={{ ...s.actionBtn, color: "#EF4444" }} onClick={() => handleDeleteInvoice(inv.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* شريط الانتقال بين الصفحات التلقائي */}
      <div style={s.paginationBar}>
        <span style={{ color: "#64748B", fontSize: "13px" }}>الصفحة الحالية: {page}</span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{ border: "1px solid #E2E8F0", borderRadius: "6px", padding: "6px 12px", cursor: page === 1 ? "not-allowed" : "pointer", backgroundColor: "white", display: "flex", alignItems: "center", gap: "4px", fontFamily: "'Cairo', sans-serif" }}
          >
            <ChevronRight size={14} /> السابق
          </button>
          <button
            disabled={invoices.length < ITEMS_PER_PAGE}
            onClick={() => setPage((p) => p + 1)}
            style={{ border: "1px solid #E2E8F0", borderRadius: "6px", padding: "6px 12px", cursor: invoices.length < ITEMS_PER_PAGE ? "not-allowed" : "pointer", backgroundColor: "white", display: "flex", alignItems: "center", gap: "4px", fontFamily: "'Cairo', sans-serif" }}
          >
            التالي <ChevronLeft size={14} />
          </button>
        </div>
      </div>

      {/* ─── لوحة عرض التفاصيل العميقة للفاتورة المحددة ─── */}
      {selectedInvoice && (
        <div style={s.detailPanel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "2px solid #E2E8F0", paddingBottom: "12px" }}>
            <h3 style={{ margin: 0, color: "#1E293B", fontSize: "16px", fontWeight: 700 }}>🔍 تفاصيل الفاتورة رقم #{selectedInvoice.id}</h3>
            <span style={{ fontSize: "14px", color: "#64748B" }}>التاجر: <strong>{selectedInvoice.merchant_name || "نقدي"}</strong></span>
          </div>

          <div style={{ backgroundColor: "white", borderRadius: "8px", border: "1px solid #E2E8F0", overflow: "hidden" }}>
            <table style={s.table}>
              <thead>
                <tr style={{ backgroundColor: "#F1F5F9" }}>
                  <th style={s.th}>المنتج</th>
                  <th style={s.th}>الكمية (الوزن الكلي)</th>
                  <th style={s.th}>سعر الوحدة</th>
                  <th style={s.th}>تفاصيل الصناديق التابعة للمنتج</th>
                  <th style={s.th}>المجموع الفرعي</th>
                </tr>
              </thead>
              <tbody>
                {selectedInvoice.details.map((det) => (
                  <tr key={det.id}>
                    <td style={{ ...s.td, fontWeight: 600 }}>{det.product_name || "منتج غير معروف"}</td>
                    <td style={s.td}>{det.quantity} كغ</td>
                    <td style={s.td}>{det.price} دج</td>
                    <td style={s.td}>
                      {det.boxes && det.boxes.length > 0 ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {det.boxes.map((box, idx) => (
                            <span key={idx} style={{ backgroundColor: "#F1F5F9", padding: "2px 6px", borderRadius: "4px", fontSize: "12px", color: "#475569" }}>
                              {box.box_name} ({box.box_count} صناديق)
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: "#94A3B8", fontSize: "12px" }}>بدون صناديق</span>
                      )}
                    </td>
                    <td style={{ ...s.td, fontWeight: 600, color: "#1E293B" }}>{det.subtotal.toLocaleString()} دج</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}