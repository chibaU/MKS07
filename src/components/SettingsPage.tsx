import { Upload, FileText, CheckCircle, XCircle, AlertTriangle, Clock, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { settingsService, SETTINGS_KEY_PRINTER_NAME } from "../services/db";

// ============================================================================
// مهمة 1/2 من ميزة طباعة الفاتورة: نظام الكلمات المفتاحية ونتيجة الفحص.
// هذه الأنواع تُطابِق تماماً TemplateUploadResult / KeywordStatus في
// invoice_template.rs (بعد #[serde(rename_all = "camelCase")]). لا تعديل
// هنا يجب أن يفلت من مزامنة يدوية مع الطرف الآخر (Rust) إن تغيّر هناك.
// ============================================================================
interface KeywordStatus {
  keyword: string;
  found: boolean;
}

interface TemplateUploadResult {
  bandMarkerCount: number;
  rowKeywords: KeywordStatus[];
  rowOptionalKeywords: KeywordStatus[];
  singleValueKeywords: KeywordStatus[];
}

const SETTINGS_KEY_UPLOADED_AT = "invoice_template_uploaded_at";
const SETTINGS_KEY_ORIGINAL_NAME = "invoice_template_original_name";

// تنسيق ثابت DD/MM/YYYY HH:MM بدون الاعتماد على locale المتصفح (يطابق نمط
// "تاريخ التحديث" الموجود أصلاً أسفل هذه الصفحة).
function formatUploadedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
    marginBottom: "28px",
    flex: 1,
  },
  outlineBtn: {
    backgroundColor: "white",
    color: "#2563EB",
    border: "2px solid #2563EB",
    borderRadius: "8px",
    padding: "10px 22px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontFamily: "'Cairo', sans-serif",
    width: "100%",
    justifyContent: "center",
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
  // --- مهمة 1/2: أنماط جديدة لبطاقة رفع القالب + قسم القواعد + قسم الفحص ---
  templateStatusBox: {
    width: "100%",
    backgroundColor: "#F8FAFC",
    border: "1px solid #E2E8F0",
    borderRadius: "10px",
    padding: "12px 14px",
    marginBottom: "16px",
    fontSize: "13px",
    lineHeight: 1.7,
    color: "#475569",
  },
  templateErrorBox: {
    width: "100%",
    backgroundColor: "#FEF2F2",
    border: "1px solid #FECACA",
    borderRadius: "10px",
    padding: "12px 14px",
    marginTop: "12px",
    fontSize: "13px",
    lineHeight: 1.7,
    color: "#B91C1C",
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
  },
  rulesBox: {
    backgroundColor: "#FFF7ED",
    borderRadius: "12px",
    border: "1px solid #FED7AA",
    padding: "20px 24px",
    marginTop: "24px",
    display: "flex",
    gap: "14px",
    alignItems: "flex-start",
  },
  scanBox: {
    backgroundColor: "white",
    borderRadius: "12px",
    border: "1px solid #E2E8F0",
    padding: "20px 24px",
    marginTop: "24px",
  },
  scanSectionTitle: {
    color: "#1E293B",
    fontSize: "14px",
    fontWeight: 700,
    marginBottom: "10px",
    marginTop: "16px",
  },
  scanRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "13px",
    color: "#334155",
    padding: "4px 0",
  },
};

export function SettingsPage() {
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // --- مهمة 1/2: حالة قالب الفاتورة ---
  const [statusLoading, setStatusLoading] = useState(true);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templateUploadedAt, setTemplateUploadedAt] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<TemplateUploadResult | null>(null);

  // --- مهمة 3/2 من ميزة الطباعة: اختيار طابعة الفواتير للطباعة الصامتة
  // المباشرة (راجع تعليق print_invoice_direct في invoice_template.rs). قيمة
  // فارغة ("") تعني "طابعة النظام الافتراضية" — لا تُفرض أي طابعة تحديداً. ---
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

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [name, uploadedAt] = await Promise.all([
          settingsService.get(SETTINGS_KEY_ORIGINAL_NAME),
          settingsService.get(SETTINGS_KEY_UPLOADED_AT),
        ]);
        if (!cancelled) {
          setTemplateName(name);
          setTemplateUploadedAt(uploadedAt);
        }
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTemplateFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    setScanResult(null);

    try {
      const buffer = await file.arrayBuffer();
      const fileBytes = Array.from(new Uint8Array(buffer));

      const result = await invoke<TemplateUploadResult>("upload_invoice_template", {
        fileBytes,
      });

      const nowIso = new Date().toISOString();
      await settingsService.update(SETTINGS_KEY_UPLOADED_AT, nowIso);
      await settingsService.update(SETTINGS_KEY_ORIGINAL_NAME, file.name);

      setTemplateName(file.name);
      setTemplateUploadedAt(nowIso);
      setScanResult(result);
      showToast("تم رفع القالب وحفظه بنجاح ✓", "success");
    } catch (err) {
      const message =
        typeof err === "string" ? err : err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء رفع الملف";
      setUploadError(message);
    } finally {
      setUploading(false);
      input.value = "";
    }
  };

  return (
    <div style={s.page}>
      <div>
        <h1 style={s.h1}>الإعدادات</h1>
        <p style={s.subtitle}>إدارة نموذج طباعة الفاتورة</p>
      </div>

      <div style={s.grid}>
        {/* Card: Invoice Template (مهمة 1/2 — رفع حقيقي بدل الزر الوهمي السابق) */}
        <div style={s.card}>
          <div style={s.iconWrap("#FFF7ED")}>
            <FileText size={26} color="#EA580C" />
          </div>
          <div style={s.cardTitle}>رفع نموذج الفاتورة</div>
          <div style={s.cardDesc}>
            ارفع ملف Excel (xlsx) صممته بنفسك ليكون نموذج الفاتورة الرسمي، بالاعتماد على الكلمات المفتاحية الموضّحة أدناه.
          </div>

          {/* حالة القالب الحالي */}
          <div style={s.templateStatusBox}>
            {statusLoading ? (
              "جاري التحقق من حالة القالب..."
            ) : templateName ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#166534", fontWeight: 600 }}>
                  <CheckCircle size={14} />
                  يوجد قالب مرفوع حالياً
                </div>
                <div style={{ marginTop: "4px" }}>الملف: {templateName}</div>
                {templateUploadedAt && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                    <Clock size={12} />
                    آخر رفع: {formatUploadedAt(templateUploadedAt)}
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#92400E" }}>
                <AlertTriangle size={14} />
                لا يوجد قالب مرفوع حالياً
              </div>
            )}
          </div>

          <label style={{ width: "100%", cursor: uploading ? "default" : "pointer" }}>
            <input
              type="file"
              accept=".xlsx"
              style={{ display: "none" }}
              disabled={uploading}
              onChange={handleTemplateFileChange}
            />
            <div
              style={{
                ...s.outlineBtn,
                color: "#EA580C",
                border: "2px solid #EA580C",
                opacity: uploading ? 0.6 : 1,
              }}
            >
              <Upload size={16} />
              {uploading ? "جاري الرفع والفحص..." : templateName ? "استبدال القالب" : "رفع القالب"}
            </div>
          </label>

          {uploadError && (
            <div style={s.templateErrorBox}>
              <XCircle size={16} style={{ flexShrink: 0, marginTop: "1px" }} />
              <div>{uploadError}</div>
            </div>
          )}
        </div>

        {/* Card: طابعة الفواتير (مهمة 3/2 — طباعة صامتة مباشرة) */}
        <div style={s.card}>
          <div style={s.iconWrap("#EFF6FF")}>
            <Printer size={26} color="#2563EB" />
          </div>
          <div style={s.cardTitle}>طابعة الفواتير</div>
          <div style={s.cardDesc}>
            عند الضغط على "طباعة" أو "حفظ وطباعة"، تُطبع الفاتورة مباشرة وبصمت على الطابعة المختارة هنا — بلا فتح أي
            نافذة Excel أو LibreOffice. اترك الخيار على القيمة الافتراضية لاستخدام طابعة النظام الافتراضية.
          </div>

          <div style={s.templateStatusBox}>
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
              </>
            )}
          </div>
        </div>
      </div>

      {/* قسم القواعد الملزمة لتصميم القالب — مهمة 1/2 (يجب أن يبقى ظاهراً بجانب الرفع) */}
      <div style={s.rulesBox}>
        <div
          style={{
            width: "36px",
            height: "36px",
            minWidth: "36px",
            borderRadius: "8px",
            backgroundColor: "#FED7AA",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AlertTriangle size={18} color="#C2410C" />
        </div>
        <div>
          <div style={{ color: "#C2410C", fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>
            إرشادات تصميم قالب الفاتورة
          </div>
          <div style={{ color: "#9A3412", fontSize: "13px", lineHeight: 1.9 }}>
            1. يعتمد التطبيق على <strong>الورقة الأولى فقط</strong> من ملف Excel المرفوع — أي أوراق إضافية يتم تجاهلها كلياً.
            <br />
            2. خلية <strong>{"{{بند}}"}</strong> (بدون أي نص آخر معها في نفس الخلية) يُفضَّل أن تظهر <strong>مرة واحدة فقط</strong> في كامل الورقة، فهي التي تُعرّف صف تكرار بنود الفاتورة. كل الكلمات المفتاحية في هذا النظام اختيارية دون استثناء (راجع القسم أدناه) — فحتى غياب {"{{بند}}"} بالكامل لا يمنع الطباعة، فقط لن يظهر جدول بنود. وإن ظهرت أكثر من خلية واحدة، يُعتمَد أعلى صف بها ترتيباً تلقائياً بلا توقف.
            <br />
            3. <strong>يُمنع استخدام أي صيغة Excel</strong> (مثل <code>SUM</code> أو غيرها) تعتمد على نطاق صفوف داخل القالب، وخصوصاً خانة الإجمالي — لأن الصف سيتكرر ديناميكياً لاحقاً عند التعبئة الفعلية، وستُفسَد أي صيغة من هذا النوع. كل قيمة تُملأ جاهزة من التطبيق مباشرة.
          </div>
        </div>
      </div>

      {/* نتيجة فحص الكلمات المفتاحية — تظهر فور نجاح رفع قالب صالح (تحذيرية فقط، لا تمنع الحفظ) */}
      {scanResult && (
        <div style={s.scanBox}>
          <div style={{ color: "#1E293B", fontSize: "15px", fontWeight: 700 }}>نتيجة فحص الكلمات المفتاحية</div>

          <div style={s.scanSectionTitle}>صف بنود الفاتورة المتكرر</div>
          {scanResult.bandMarkerCount === 0 && (
            <div style={{ ...s.scanRow, color: "#B91C1C" }}>
              <XCircle size={15} />
              لم يتم العثور على خلية {"{{بند}}"} في الورقة — لن يعمل تكرار صف البنود.
            </div>
          )}
          {scanResult.bandMarkerCount > 1 && (
            <div style={{ ...s.scanRow, color: "#B91C1C" }}>
              <AlertTriangle size={15} />
              تم العثور على {scanResult.bandMarkerCount} خلايا {"{{بند}}"} — سيُعتمَد أعلى صف بها ترتيباً تلقائياً عند الطباعة، وبقية الخلايا ستبقى كنص حرفي. يُفضَّل إبقاء خلية واحدة فقط لتفادي أي التباس.
            </div>
          )}
          {scanResult.bandMarkerCount === 1 && (
            <>
              <div style={{ ...s.scanRow, color: "#166534" }}>
                <CheckCircle size={15} />
                تم العثور على خلية {"{{بند}}"} واحدة بشكل صحيح.
              </div>
              {scanResult.rowKeywords.map((k) => (
                <div key={k.keyword} style={{ ...s.scanRow, color: k.found ? "#166534" : "#B91C1C" }}>
                  {k.found ? <CheckCircle size={15} /> : <XCircle size={15} />}
                  {k.keyword} — {k.found ? "موجودة" : "غير موجودة"}
                </div>
              ))}
              {scanResult.rowOptionalKeywords.length > 0 && (
                <>
                  <div style={{ ...s.scanSectionTitle, fontSize: "13px", color: "#64748B" }}>
                    حقول اختيارية إضافية داخل صف البند
                  </div>
                  {scanResult.rowOptionalKeywords.map((k) => (
                    <div key={k.keyword} style={{ ...s.scanRow, color: k.found ? "#166534" : "#94A3B8" }}>
                      {k.found ? <CheckCircle size={15} /> : <XCircle size={15} />}
                      {k.keyword} — {k.found ? "موجودة" : "غير موجودة"}
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          <div style={s.scanSectionTitle}>الحقول أحادية القيمة</div>
          {scanResult.singleValueKeywords.map((k) => (
            <div key={k.keyword} style={{ ...s.scanRow, color: k.found ? "#166534" : "#94A3B8" }}>
              {k.found ? <CheckCircle size={15} /> : <XCircle size={15} />}
              {k.keyword} — {k.found ? "موجودة" : "غير موجودة"}
            </div>
          ))}
        </div>
      )}

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