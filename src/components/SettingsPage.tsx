import { CheckCircle, XCircle, AlertTriangle, Printer, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { settingsService, SETTINGS_KEY_PRINTER_NAME } from "../services/db";
import { SETTINGS_KEY_PRINT_MODE, savePrintMode } from "../services/printSettings";
import { loadWeigherInfo, saveWeigherInfo } from "../services/weigherSettings";
import { parsePrintMode } from "../print/behavior.ts";
import { printConfig } from "../print/print.config.ts";
import type { PrintMode } from "../print/types.ts";
import {
  EMPTY_WEIGHER,
  WEIGHER_LIMITS,
  type WeigherInfo,
} from "../print/weigher.ts";

const s = {
  page: { padding: "32px", direction: "rtl" as const },
  h1: { color: "#1E293B", fontSize: "24px", fontWeight: 700, margin: 0 },
  subtitle: { color: "#64748B", fontSize: "14px", marginTop: "4px" },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 460px)",
    gap: "24px",
    marginTop: "24px",
  },
  card: {
    backgroundColor: "white",
    borderRadius: "14px",
    border: "1px solid #E2E8F0",
    padding: "32px 28px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-start",
    gap: "0",
  },
  iconWrap: (color: string) => ({
    width: "56px",
    height: "56px",
    borderRadius: "14px",
    backgroundColor: color,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "20px",
  }),
  cardTitle: {
    color: "#1E293B",
    fontSize: "17px",
    fontWeight: 700,
    marginBottom: "10px",
  },
  cardDesc: {
    color: "#64748B",
    fontSize: "14px",
    lineHeight: 1.6,
    marginBottom: "20px",
  },
  successToast: {
    position: "fixed" as const,
    bottom: "32px",
    left: "50%",
    transform: "translateX(-50%)",
    backgroundColor: "#10B981",
    color: "white",
    padding: "14px 24px",
    borderRadius: "10px",
    boxShadow: "0 4px 20px rgba(16,185,129,0.3)",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "14px",
    fontWeight: 500,
    zIndex: 1000,
    direction: "rtl" as const,
  },
  infoCard: {
    backgroundColor: "#EFF6FF",
    borderRadius: "12px",
    border: "1px solid #DBEAFE",
    padding: "20px 24px",
    marginTop: "24px",
    display: "flex",
    gap: "14px",
    alignItems: "flex-start",
  },
  statusBox: {
    width: "100%",
    boxSizing: "border-box" as const,
    backgroundColor: "#F8FAFC",
    border: "1px solid #E2E8F0",
    borderRadius: "10px",
    padding: "12px 14px",
    marginBottom: "16px",
    fontSize: "13px",
    lineHeight: 1.7,
    color: "#475569",
  },
  fieldGroup: { width: "100%", marginBottom: "16px" },
  label: { display: "block", color: "#475569", fontSize: "13px", fontWeight: 600, marginBottom: "6px" },
  input: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #CBD5E1",
    borderRadius: "8px",
    fontSize: "14px",
    fontFamily: "'Cairo', sans-serif",
    boxSizing: "border-box" as const,
    outline: "none",
  },
  saveBtn: {
    backgroundColor: "#2563EB",
    color: "white",
    border: "none",
    borderRadius: "8px",
    padding: "10px 24px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Cairo', sans-serif",
  },
  radioRow: (selected: boolean) => ({
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    width: "100%",
    boxSizing: "border-box" as const,
    padding: "14px 16px",
    marginBottom: "10px",
    borderRadius: "10px",
    border: selected ? "2px solid #2563EB" : "1px solid #CBD5E1",
    backgroundColor: selected ? "#EFF6FF" : "white",
    cursor: "pointer",
  }),
  radioTitle: { color: "#1E293B", fontSize: "14px", fontWeight: 700 },
  radioDesc: { color: "#64748B", fontSize: "13px", lineHeight: 1.6, marginTop: "2px" },
};

export function SettingsPage() {
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --- بيانات الوزّان (خاتمة الفاتورة) ---
  const [weigher, setWeigher] = useState<WeigherInfo>(EMPTY_WEIGHER);
  const [weigherLoading, setWeigherLoading] = useState(true);
  const [savingWeigher, setSavingWeigher] = useState(false);

  // --- طريقة الطباعة ---
  const [printMode, setPrintMode] = useState<PrintMode>(printConfig.default.mode);
  const [savingMode, setSavingMode] = useState(false);

  // --- منتقي الطابعة (يظهر في وضع «طباعة مباشرة» فقط). قيمة فارغة ("") تعني
  // "طابعة النظام الافتراضية" — لا تُفرض أي طابعة تحديداً. ---
  const [printers, setPrinters] = useState<string[]>([]);
  const [printersLoading, setPrintersLoading] = useState(true);
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [savingPrinter, setSavingPrinter] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [names, saved] = await Promise.all([
          invoke<string[]>("list_system_printers"),
          settingsService.get(SETTINGS_KEY_PRINTER_NAME),
        ]);
        if (!cancelled) {
          setPrinters(names);
          setSelectedPrinter(saved ?? "");
        }
      } catch {
        // فشل الاستعلام عن الطابعات لا يمنع استخدام الصفحة — يبقى الخيار
        // على "طابعة النظام الافتراضية" فقط بلا قائمة.
      } finally {
        if (!cancelled) setPrintersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const savedMode = await settingsService.get(SETTINGS_KEY_PRINT_MODE);
        if (!cancelled) setPrintMode(parsePrintMode(savedMode) ?? printConfig.default.mode);
      } catch (error) {
        console.error("تعذّرت قراءة طريقة الطباعة:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await loadWeigherInfo();
        if (!cancelled) setWeigher(info);
      } catch (error) {
        console.error("تعذّرت قراءة بيانات الوزّان:", error);
      } finally {
        if (!cancelled) setWeigherLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveWeigher = async () => {
    setSavingWeigher(true);
    try {
      const saved = await saveWeigherInfo(weigher);
      setWeigher(saved);
      showToast("تم حفظ بيانات الوزّان ✓");
    } catch (error) {
      console.error("تعذّر حفظ بيانات الوزّان:", error);
      showToast("تعذّر حفظ بيانات الوزّان، يرجى المحاولة مجدداً", "error");
    } finally {
      setSavingWeigher(false);
    }
  };

  const handleModeChange = async (mode: PrintMode) => {
    if (mode === printMode || savingMode) return;
    const previous = printMode;
    setPrintMode(mode);
    setSavingMode(true);
    try {
      await savePrintMode(mode);
      showToast(mode === "direct" ? "تم اعتماد الطباعة المباشرة ✓" : "تم اعتماد نافذة طباعة النظام ✓");
    } catch {
      setPrintMode(previous);
      showToast("تعذّر حفظ طريقة الطباعة، يرجى المحاولة مجدداً", "error");
    } finally {
      setSavingMode(false);
    }
  };

  const handlePrinterChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedPrinter(value);
    setSavingPrinter(true);
    try {
      await settingsService.update(SETTINGS_KEY_PRINTER_NAME, value);
      showToast(value === "" ? "تم اعتماد طابعة النظام الافتراضية ✓" : `تم اعتماد "${value}" لطباعة الفواتير ✓`);
    } catch {
      showToast("تعذّر حفظ اختيار الطابعة، يرجى المحاولة مجدداً", "error");
    } finally {
      setSavingPrinter(false);
    }
  };

  const setWeigherField = (field: keyof WeigherInfo, value: string) =>
    setWeigher((prev) => ({ ...prev, [field]: value }));

  return (
    <div style={s.page}>
      <div>
        <h1 style={s.h1}>الإعدادات</h1>
        <p style={s.subtitle}>بيانات الوزّان وطريقة طباعة الفاتورة</p>
      </div>

      <div style={s.grid}>
        {/* Card A: بيانات الوزّان (خاتمة الفاتورة) */}
        <div style={s.card}>
          <div style={s.iconWrap("#FFF7ED")}>
            <Store size={26} color="#EA580C" />
          </div>
          <div style={s.cardTitle}>بيانات الوزّان (تظهر في آخر الفاتورة)</div>
          <div style={s.cardDesc}>
            تُطبَع في آخر كل فاتورة بالصيغة «ميزان (الاسم)» ثم «للاتصال (الهاتف)». كل الحقول اختيارية؛ الحقل الفارغ لا يُطبَع ولا يترك فراغاً.
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>اسم الوزّان</label>
            <input
              style={s.input}
              value={weigher.name}
              maxLength={WEIGHER_LIMITS.name}
              disabled={weigherLoading}
              placeholder="اسم المؤسسة أو الوزّان"
              onChange={(e) => setWeigherField("name", e.target.value)}
            />
          </div>
          <div style={s.fieldGroup}>
            <label style={s.label}>رقم الهاتف 1</label>
            <input
              style={{ ...s.input, direction: "ltr", textAlign: "right" }}
              value={weigher.phone1}
              maxLength={WEIGHER_LIMITS.phone}
              disabled={weigherLoading}
              inputMode="tel"
              onChange={(e) => setWeigherField("phone1", e.target.value)}
            />
          </div>
          <div style={s.fieldGroup}>
            <label style={s.label}>رقم الهاتف 2 (اختياري)</label>
            <input
              style={{ ...s.input, direction: "ltr", textAlign: "right" }}
              value={weigher.phone2}
              maxLength={WEIGHER_LIMITS.phone}
              disabled={weigherLoading}
              inputMode="tel"
              onChange={(e) => setWeigherField("phone2", e.target.value)}
            />
          </div>

          <button
            style={{ ...s.saveBtn, opacity: weigherLoading || savingWeigher ? 0.6 : 1 }}
            onClick={handleSaveWeigher}
            disabled={weigherLoading || savingWeigher}
          >
            {savingWeigher ? "جاري الحفظ..." : "حفظ البيانات"}
          </button>
        </div>

        {/* Card B: طريقة الطباعة */}
        <div style={s.card}>
          <div style={s.iconWrap("#EFF6FF")}>
            <Printer size={26} color="#2563EB" />
          </div>
          <div style={s.cardTitle}>طريقة الطباعة</div>
          <div style={s.cardDesc}>
            تُطبَّق على كل طباعة لاحقة فوراً، بلا إعادة تشغيل. لا توجد معاينة داخل التطبيق.
          </div>

          <label style={s.radioRow(printMode === "dialog")}>
            <input
              type="radio"
              name="print-mode"
              checked={printMode === "dialog"}
              disabled={savingMode}
              onChange={() => handleModeChange("dialog")}
            />
            <div>
              <div style={s.radioTitle}>نافذة طباعة النظام (الافتراضي)</div>
              <div style={s.radioDesc}>
                تظهر نافذة ويندوز لاختيار الطابعة والصفحات وعدد النسخ والطباعة على الوجهين.
              </div>
            </div>
          </label>

          <label style={s.radioRow(printMode === "direct")}>
            <input
              type="radio"
              name="print-mode"
              checked={printMode === "direct"}
              disabled={savingMode}
              onChange={() => handleModeChange("direct")}
            />
            <div>
              <div style={s.radioTitle}>طباعة مباشرة</div>
              <div style={s.radioDesc}>تُرسَل الفاتورة إلى الطابعة فوراً دون أي نافذة.</div>
            </div>
          </label>

          {printMode === "direct" && (
            <div style={{ ...s.statusBox, marginTop: "6px", marginBottom: 0 }}>
              {printersLoading ? (
                "جاري البحث عن الطابعات المتصلة بالجهاز..."
              ) : (
                <>
                  <select
                    value={selectedPrinter}
                    onChange={handlePrinterChange}
                    disabled={savingPrinter}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid #CBD5E1",
                      fontSize: "14px",
                      fontFamily: "'Cairo', sans-serif",
                      color: "#1E293B",
                      backgroundColor: "white",
                      cursor: savingPrinter ? "default" : "pointer",
                    }}
                  >
                    <option value="">طابعة النظام الافتراضية</option>
                    {printers.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>

                  {printers.length === 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#92400E", marginTop: "10px" }}>
                      <AlertTriangle size={14} />
                      لم يتم العثور على أي طابعة مثبَّتة — سيُستخدَم إعداد طابعة النظام الافتراضية تلقائياً.
                    </div>
                  )}

                  <div style={{ color: "#64748B", marginTop: "10px" }}>
                    إن لم يُعثر على الطابعة المحفوظة تُفتح نافذة طباعة النظام بدلاً منها.
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Info Section */}
      <div style={s.infoCard}>
        <div
          style={{
            width: "36px",
            height: "36px",
            minWidth: "36px",
            borderRadius: "8px",
            backgroundColor: "#DBEAFE",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ color: "#2563EB", fontSize: "16px", fontWeight: 700 }}>ℹ</span>
        </div>
        <div>
          <div style={{ color: "#1D4ED8", fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>
            معلومات النظام
          </div>
          <div style={{ color: "#3B82F6", fontSize: "13px", lineHeight: 1.7 }}>
            الإصدار الحالي: <strong>v1.0.0</strong> — تاريخ التحديث: 18/06/2026
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            ...s.successToast,
            backgroundColor: toast.type === "error" ? "#DC2626" : "#10B981",
            boxShadow: toast.type === "error" ? "0 4px 20px rgba(220,38,38,0.3)" : "0 4px 20px rgba(16,185,129,0.3)",
          }}
        >
          {toast.type === "error" ? <XCircle size={18} /> : <CheckCircle size={18} />}
          {toast.message}
        </div>
      )}
    </div>
  );
}