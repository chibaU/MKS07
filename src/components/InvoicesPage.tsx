/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Eye,
  Trash2,
  Search,
  ChevronRight,
  ChevronLeft,
  ChevronsRight,
  ChevronsLeft,
  Pencil,
  Printer,
} from "lucide-react";
import {
  invoiceService,
  type InvoiceWithMerchant,
  type InvoiceFullDetails,
} from "../services/db";
import { printInvoice } from "../services/print";
import { formatMoney } from "./InvoiceShared";

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
  dateFilterGroup: { display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 },
  dateFilterLabel: { fontSize: "13px", color: "#64748B", fontWeight: 600, whiteSpace: "nowrap" as const },
  dateInput: { padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: "8px", fontSize: "13px", fontFamily: "'Cairo', sans-serif", outline: "none", colorScheme: "light" as const },
  dateClearBtn: { border: "1px solid #E2E8F0", backgroundColor: "#F8FAFC", color: "#64748B", borderRadius: "8px", padding: "9px 12px", fontSize: "13px", fontFamily: "'Cairo', sans-serif", cursor: "pointer", flexShrink: 0 },
  tableCard: { backgroundColor: "white", borderRadius: "12px", border: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(0,0,0,0.02)", overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse" as const, textAlign: "right" as const },
  th: { backgroundColor: "#F8FAFC", color: "#64748B", fontWeight: 650, fontSize: "13px", padding: "14px 20px", borderBottom: "1px solid #E2E8F0" },
  td: { padding: "14px 20px", borderBottom: "1px solid #E2E8F0", color: "#334155", fontSize: "14px" },
  actionBtn: { border: "none", background: "none", cursor: "pointer", padding: "4px", borderRadius: "4px", display: "inline-flex", alignItems: "center", justifyContent: "center" },

  // أنماط معاينة تفاصيل الفاتورة
  detailPanel: { marginTop: "24px", backgroundColor: "#F8FAFC", padding: "24px", borderRadius: "12px", border: "1px solid #E2E8F0" },

  // الترقيم (Pagination)
  paginationBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "20px",
    flexWrap: "wrap" as const,
    gap: "12px",
  },
  paginationInfo: { color: "#64748B", fontSize: "13px" },
  pageBtn: {
    border: "1px solid #E2E8F0",
    borderRadius: "6px",
    padding: "6px 12px",
    backgroundColor: "white",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontFamily: "'Cairo', sans-serif",
    fontSize: "13px",
    color: "#334155",
  },
  pageBtnDisabled: { cursor: "not-allowed", opacity: 0.45 },
  pageBtnEnabled: { cursor: "pointer" },
  pageJumpWrap: { display: "flex", alignItems: "center", gap: "6px" },
  pageJumpInput: {
    width: "52px",
    padding: "6px 8px",
    border: "1px solid #E2E8F0",
    borderRadius: "6px",
    fontSize: "13px",
    textAlign: "center" as const,
    fontFamily: "'Cairo', sans-serif",
    outline: "none",
  },
};

const ITEMS_PER_PAGE = 15;
// تأخير تطبيق البحث الفعلي على القاعدة بعد آخر ضغطة مفتاح — يمنع إطلاق استعلام
// جديد مع كل حرف يكتبه المستخدم (القسم "البحث الذكي" من مهمة هذا الجزء).
const SEARCH_DEBOUNCE_MS = 250;

interface InvoicesPageProps {
  onOpenInvoiceForEdit: (id: number) => void;
  // حالة البحث ورقم الصفحة مرفوعتان إلى App.tsx (لا local state هنا) كي لا
  // تُصفَّرا عند مغادرة هذه الصفحة والعودة إليها — InvoicesPage تُزال من الـ DOM
  // بالكامل عند التنقل (شرط activePage === "invoices" في App.tsx).
  search: string;
  onSearchChange: (value: string) => void;
  page: number;
  onPageChange: (page: number) => void;
  // نطاق تاريخ اختياري (شامل للطرفين) — "" يعني بلا حد لهذا الطرف. مرفوعة
  // إلى App.tsx لنفس سبب search/page أعلاه (راجع التعليق هناك).
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
}

export function InvoicesPage({
  onOpenInvoiceForEdit,
  search,
  onSearchChange,
  page,
  onPageChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
}: InvoicesPageProps) {
  const [invoices, setInvoices] = useState<InvoiceWithMerchant[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceFullDetails | null>(null);
  const [printingId, setPrintingId] = useState<number | null>(null);

  // نسخة "مؤخَّرة" (debounced) من نص البحث المرفوع — تُهيَّأ بقيمة search نفسها
  // عند التركيب (لا نص فارغ) كي لا تُعاد صفحة الأرشيف لحالة "بلا بحث" لحظياً كل
  // مرة يُعاد فيها تركيب المكوّن (التنقل بعيداً ثم العودة).
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  // حقل "الانتقال السريع" لرقم صفحة — نص خام يكتبه المستخدم، يُطبَّق فقط عند
  // Enter أو فقدان التركيز (blur)، ويُعاد مزامنته مع page الفعلي في أي وقت آخر.
  const [pageJumpInput, setPageJumpInput] = useState(String(page));

  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  // فلتر جديد فعلياً (نص بحث بعد التأخير، أو نطاق تاريخ — لا يُؤخَّر لأن
  // input[type=date] لا يُطلق onChange إلا بقيمة كاملة صالحة أو بالمسح) =
  // العودة لأول صفحة؛ لا يُطلَق عند مجرد إعادة تركيب المكوّن بنفس القيم
  // السابقة (previousFiltersRef مُهيَّأة لنفس القيم).
  const previousFiltersRef = useRef({ search, dateFrom, dateTo });
  useEffect(() => {
    const prev = previousFiltersRef.current;
    const changed =
      prev.search !== debouncedSearch ||
      prev.dateFrom !== dateFrom ||
      prev.dateTo !== dateTo;
    if (changed) {
      previousFiltersRef.current = { search: debouncedSearch, dateFrom, dateTo };
      if (page !== 1) onPageChange(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, dateFrom, dateTo]);

  useEffect(() => {
    setPageJumpInput(String(page));
  }, [page]);

  // 1. جلب الفواتير من قاعدة البيانات: البحث والعدّ الحقيقي كلاهما في القاعدة
  // (invoiceService.searchInvoices) — لا فلترة على صفوف محمَّلة جزئياً في
  // المتصفح بعد الآن.
  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * ITEMS_PER_PAGE;
      const { items, totalCount: count } = await invoiceService.searchInvoices({
        search: debouncedSearch,
        limit: ITEMS_PER_PAGE,
        offset,
        dateFrom,
        dateTo,
      });

      // حالة حدّية: الصفحة الحالية تجاوزت العدد الحقيقي للنتائج (حذف آخر عنصر
      // في آخر صفحة، أو بحث جديد قلَّص النتائج، أو عدد الفواتير مضاعف بالضبط
      // لحجم الصفحة) — نتراجع للصفحة الأخيرة الصالحة فعلياً بدل عرض صفحة فارغة
      // برسالة "لا توجد نتائج" مضلِّلة. تغيّر page سيُعيد تشغيل هذا effect من
      // جديد فيجلب المحتوى الصحيح؛ loading يبقى true عمداً (لا نستدعي
      // setLoading(false) هنا) كي لا يومض الجدول ببيانات الصفحة القديمة غير
      // الصالحة قبل أن تصل بيانات الصفحة الصحيحة مباشرة بعدها.
      const clampedTotalPages = Math.max(1, Math.ceil(count / ITEMS_PER_PAGE));
      if (page > clampedTotalPages) {
        onPageChange(clampedTotalPages);
        return;
      }

      setInvoices(items);
      setTotalCount(count);
      setLoading(false);
    } catch (error) {
      console.error("خطأ أثناء جلب الفواتير:", error);
      setLoading(false);
    }
  }, [page, debouncedSearch, dateFrom, dateTo, onPageChange]);

  useEffect(() => {
    loadInvoices();
    setSelectedInvoice(null); // إعادة تعيين الفاتورة المفتوحة عند تغيير الصفحة/البحث
  }, [loadInvoices]);

  const handlePrint = async (id: number) => {
    if (printingId !== null) return;
    setPrintingId(id);
    try {
      await printInvoice(id);
    } catch (error) {
      console.error("خطأ أثناء طباعة الفاتورة:", error);
      alert(
        error instanceof Error
          ? error.message
          : "تعذّر توليد ملف الطباعة لهذه الفاتورة.",
      );
    } finally {
      setPrintingId(null);
    }
  };

  // 2. جلب التفاصيل الكاملة لفاتورة معينة لعرضها
  const handleViewDetails = async (id: number) => {
    try {
      const fullDetails = await invoiceService.getInvoiceFullDetails(id);
      setSelectedInvoice(fullDetails);
    } catch (error) {
      console.error("خطأ في جلب تفاصيل الفاتورة:", error);
    }
  };

  // 3. حذف الفاتورة نهائياً
  const handleDeleteInvoice = async (inv: InvoiceWithMerchant) => {
    const displayNumber = inv.invoice_number ?? `#${inv.id}`;

    // حماية سلامة بيانات: فاتورة مفتوحة حالياً في تبويب بالصفحة الرئيسية
    // (is_open === 1) قد يُدرِج فيها الوزّان بنداً جديداً بعد حذفها هنا مباشرة —
    // appendDetail حينها لن تجد فاتورة تحدّثها فيُدرَج البند بمعرّف فاتورة غير
    // موجود (صف يتيم لا يظهر لأحد، بلا أي خطأ ظاهر). القيد FOREIGN KEY لا يمنع
    // ذلك لأنه معطَّل عمداً (راجع القسم 4 نقطة 7 من AI_CONTEXT.md). الحل الأبسط:
    // is_open نفسه، موجود أصلاً في كل صف مُحمَّل من searchInvoices — لا حاجة
    // لاستعلام فحص إضافي.
    if (inv.is_open === 1) {
      alert(
        `الفاتورة ${displayNumber} مفتوحة حالياً في أحد تبويبات الصفحة الرئيسية. ` +
        `أغلقها من هناك أولاً (زر "حفظ" أو "حفظ وطباعة" داخل ذلك التبويب) قبل حذفها من الأرشيف.`,
      );
      return;
    }

    if (
      !confirm(
        `هل أنت متأكد من حذف الفاتورة ${displayNumber} نهائياً؟ سيتم حذف كافة الصناديق والأوزان المسجلة فيها.`,
      )
    ) {
      return;
    }

    try {
      await invoiceService.deleteInvoice(inv.id);
      if (selectedInvoice?.id === inv.id) {
        setSelectedInvoice(null);
      }
      await loadInvoices();
    } catch (error) {
      console.error("خطأ أثناء حذف الفاتورة:", error);
      alert("تعذر حذف الفاتورة، يرجى مراجعة سجل الأخطاء.");
    }
  };

  const goToPage = (target: number) => {
    const clamped = Math.min(Math.max(1, target), totalPages);
    if (clamped !== page) onPageChange(clamped);
  };

  const commitPageJump = () => {
    const parsed = Number(pageJumpInput);
    if (Number.isFinite(parsed) && parsed >= 1) {
      goToPage(Math.trunc(parsed));
    } else {
      setPageJumpInput(String(page)); // إدخال غير صالح — تراجع للقيمة الحالية
    }
  };

  const hasActiveSearch =
    debouncedSearch.trim().length > 0 || dateFrom !== "" || dateTo !== "";
  const hasDateFilter = dateFrom !== "" || dateTo !== "";
  const clearDateFilter = () => {
    onDateFromChange("");
    onDateToChange("");
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
            placeholder="بحث برقم الفاتورة أو اسم التاجر أو هاتفه..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div style={s.dateFilterGroup}>
          <span style={s.dateFilterLabel}>من</span>
          <input
            type="date"
            style={s.dateInput}
            value={dateFrom}
            // حد أقصى لـ"من" هو "إلى" إن كانت محدَّدة، كي لا يختار المستخدم
            // نطاقاً معكوساً غير قابل لإرجاع أي نتيجة أصلاً.
            max={dateTo || undefined}
            onChange={(e) => onDateFromChange(e.target.value)}
            title="بداية نطاق تاريخ الفاتورة"
          />
          <span style={s.dateFilterLabel}>إلى</span>
          <input
            type="date"
            style={s.dateInput}
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => onDateToChange(e.target.value)}
            title="نهاية نطاق تاريخ الفاتورة"
          />
        </div>

        {hasDateFilter && (
          <button style={s.dateClearBtn} onClick={clearDateFilter} title="مسح فلتر التاريخ">
            مسح التاريخ
          </button>
        )}
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
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...s.td, textAlign: "center", color: "#94A3B8" }}>
                  {hasActiveSearch
                    ? "لا توجد فواتير مطابقة لهذا البحث."
                    : "لا توجد فواتير مسجلة بعد."}
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id}>
                  <td style={{ ...s.td, fontFamily: "monospace", fontWeight: 600 }}>{inv.invoice_number ?? `#${inv.id}`}</td>
                  <td style={{ ...s.td, fontWeight: 600, color: "#1E293B" }}>{inv.merchant_name || "تاجر عام / نقدي"}</td>
                  <td style={s.td}>{inv.invoice_date || "—"}</td>
                  <td style={{ ...s.td, fontWeight: 700, color: "#16A34A" }}>{formatMoney(inv.total_amount)} دج</td>
                  <td style={{ ...s.td, textAlign: "center" }}>
                    <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                      <button style={{ ...s.actionBtn, color: "#2563EB" }} onClick={() => handleViewDetails(inv.id)} title="عرض التفاصيل والوزن">
                        <Eye size={16} />
                      </button>
                      <button
                        style={{ ...s.actionBtn, color: "#D97706" }}
                        onClick={() => onOpenInvoiceForEdit(inv.id)}
                        title="تعديل الفاتورة"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        style={{ ...s.actionBtn, color: "#EF4444" }}
                        onClick={() => handleDeleteInvoice(inv)}
                        title="حذف الفاتورة"
                      >
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

      {/* شريط الترقيم: معلومات العدد الحقيقي + أزرار الأولى/السابق/الانتقال/التالي/الأخيرة */}
      <div style={s.paginationBar}>
        <span style={s.paginationInfo}>
          الصفحة {page} من {totalPages} — إجمالي {totalCount} فاتورة
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            disabled={loading || page === 1}
            onClick={() => goToPage(1)}
            style={{ ...s.pageBtn, ...(loading || page === 1 ? s.pageBtnDisabled : s.pageBtnEnabled) }}
            title="الصفحة الأولى"
          >
            <ChevronsRight size={14} /> الأولى
          </button>
          <button
            disabled={loading || page === 1}
            onClick={() => goToPage(page - 1)}
            style={{ ...s.pageBtn, ...(loading || page === 1 ? s.pageBtnDisabled : s.pageBtnEnabled) }}
          >
            <ChevronRight size={14} /> السابق
          </button>

          <div style={s.pageJumpWrap}>
            <input
              style={s.pageJumpInput}
              value={pageJumpInput}
              onChange={(e) => setPageJumpInput(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitPageJump();
              }}
              onBlur={commitPageJump}
              inputMode="numeric"
              title="انتقال إلى صفحة"
            />
          </div>

          <button
            disabled={loading || page === totalPages}
            onClick={() => goToPage(page + 1)}
            style={{ ...s.pageBtn, ...(loading || page === totalPages ? s.pageBtnDisabled : s.pageBtnEnabled) }}
          >
            التالي <ChevronLeft size={14} />
          </button>
          <button
            disabled={loading || page === totalPages}
            onClick={() => goToPage(totalPages)}
            style={{ ...s.pageBtn, ...(loading || page === totalPages ? s.pageBtnDisabled : s.pageBtnEnabled) }}
            title="الصفحة الأخيرة"
          >
            الأخيرة <ChevronsLeft size={14} />
          </button>
        </div>
      </div>

      {/* ─── لوحة عرض التفاصيل العميقة للفاتورة المحددة ─── */}
      {selectedInvoice && (
        <div style={s.detailPanel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "2px solid #E2E8F0", paddingBottom: "12px" }}>
            <h3 style={{ margin: 0, color: "#1E293B", fontSize: "16px", fontWeight: 700 }}>🔍 تفاصيل الفاتورة {selectedInvoice.invoice_number ?? `#${selectedInvoice.id}`}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <span style={{ fontSize: "14px", color: "#64748B" }}>التاجر: <strong>{selectedInvoice.merchant_name || "نقدي"}</strong></span>
              <button
                onClick={() => handlePrint(selectedInvoice.id)}
                disabled={printingId === selectedInvoice.id}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  border: "1px solid #BFDBFE", backgroundColor: "#EFF6FF", color: "#1D4ED8",
                  borderRadius: "8px", padding: "8px 14px", fontSize: "13px", fontWeight: 600,
                  cursor: printingId === selectedInvoice.id ? "not-allowed" : "pointer",
                  opacity: printingId === selectedInvoice.id ? 0.6 : 1,
                  fontFamily: "'Cairo', sans-serif",
                }}
              >
                <Printer size={14} /> {printingId === selectedInvoice.id ? "جارٍ التوليد..." : "طباعة"}
              </button>
              <button
                onClick={() => onOpenInvoiceForEdit(selectedInvoice.id)}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  border: "1px solid #FDE68A", backgroundColor: "#FFFBEB", color: "#B45309",
                  borderRadius: "8px", padding: "8px 14px", fontSize: "13px", fontWeight: 600,
                  cursor: "pointer", fontFamily: "'Cairo', sans-serif",
                }}
              >
                <Pencil size={14} /> تعديل الفاتورة
              </button>
            </div>
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
                    <td style={s.td}>{formatMoney(det.price)} دج</td>
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
                    <td style={{ ...s.td, fontWeight: 600, color: "#1E293B" }}>{formatMoney(det.subtotal)} دج</td>
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