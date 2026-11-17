// ============================================================================
// الفاتورة: مستند A4 عمودي ثابت التصميم (لا يعدّله المستخدم). RTL، خط Cairo المحلي،
// أنماط inline فقط (قواعد @page/@media في printCss.ts).
//
// البيانات جاهزة التنسيق (مخرجات buildPayload في services/print.ts + بيانات الوزّان):
// لا يُعاد هنا حساب أي مجموع ولا تنسيق أي مبلغ — تُعرَض النصوص كما وصلت.
// أي قيمة فارغة لا تُرسَم ولا تُفشل الطباعة (رقم الفاتورة الفارغ يظهر «—»).
//
// الصفحات: الترويسة في الصفحة الأولى فقط، و<thead> يتكرر في كل صفحة
// (table-header-group)، والصفوف لا تنقسم (break-inside: avoid)، ولا <tfoot> (يتكرر).
// الإجماليات (ثم التوقيعان) صف أخير في <tbody> نفسه بـbreak-before: avoid، فلا
// تنفرد بصفحة: يُسحَب معها آخر بند.
// ============================================================================

import type { CSSProperties, ReactNode } from "react";
import type { WeigherInfo } from "../weigher.ts";

export interface InvoiceA4Item {
  product: string;
  weight: string;
  price: string;
  subtotal: string;
  /** أسطر مفصولة بـ"\n" (مثل «صندوق A ×5»). */
  boxes: string;
}

export interface InvoiceA4Summary {
  product: string;
  totalWeight: string;
  breakEvenPrice: string;
  totalAmount: string;
}

export interface InvoiceA4Data {
  invoiceNumber: string;
  invoiceDate: string;
  merchantName: string;
  merchantPhone: string;
  merchantAddress: string;
  grandTotal: string;
  totalWeight: string;
  totalBoxes: string;
  items: InvoiceA4Item[];
  /** ملخّص المنتجات المتكررة (اختياري؛ فارغ = لا قسم). */
  repeatedProductSummary: InvoiceA4Summary[];
  weigher: WeigherInfo;
}

const INK = "#111827";
const MUTED = "#4B5563";
const LINE = "#CBD5E1";
const ACCENT = "#1E3A8A"; // لون التمييز الوحيد
const HEAD_BG = "#F1F5F9";
const ZEBRA = "#F8FAFC";

const AVOID_BREAK: CSSProperties = { breakInside: "avoid", pageBreakInside: "avoid" };

const cell: CSSProperties = {
  padding: "1.6mm 2mm",
  borderBottom: `0.5pt solid ${LINE}`,
  fontSize: "9.5pt",
  verticalAlign: "top",
  overflowWrap: "anywhere",
};

const headCell: CSSProperties = {
  padding: "1.8mm 2mm",
  backgroundColor: HEAD_BG,
  borderTop: `1pt solid ${INK}`,
  borderBottom: `1pt solid ${INK}`,
  fontSize: "9pt",
  fontWeight: 700,
  textAlign: "right",
  verticalAlign: "middle",
};

const s = {
  page: {
    direction: "rtl",
    fontFamily: "'Cairo', sans-serif",
    color: INK,
    fontSize: "10pt",
    lineHeight: 1.5,
    backgroundColor: "#fff",
    boxSizing: "border-box",
  },
  businessName: { fontSize: "17pt", fontWeight: 700, lineHeight: 1.3 },
  businessLine: { fontSize: "9.5pt", color: MUTED },
  rule: { borderTop: `1.2pt solid ${ACCENT}`, margin: "3mm 0 4mm" },
  titleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "8mm",
    marginBottom: "4mm",
  },
  docTitle: { fontSize: "22pt", fontWeight: 700, color: ACCENT, lineHeight: 1.2 },
  metaBox: {
    minWidth: "62mm",
    border: `0.75pt solid ${LINE}`,
    borderRadius: "1.5mm",
    padding: "1.5mm 3.5mm",
  },
  metaRow: { display: "flex", justifyContent: "space-between", gap: "6mm", padding: "0.4mm 0" },
  label: { color: MUTED, fontSize: "9pt" },
  value: { fontWeight: 600, fontSize: "10pt" },
  merchantBox: {
    border: `0.75pt solid ${LINE}`,
    borderRadius: "1.5mm",
    padding: "2mm 4mm",
    marginBottom: "5mm",
  },
  merchantRow: { display: "flex", gap: "4mm", padding: "0.4mm 0" },
  merchantLabel: { color: MUTED, fontSize: "9pt", width: "20mm", flexShrink: 0 },
  num: {
    display: "inline-block",
    direction: "ltr",
    unicodeBidi: "isolate",
    whiteSpace: "nowrap",
  },
  table: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" },
  thead: { display: "table-header-group" },
  tdNum: { ...cell, textAlign: "left" },
  thNum: { ...headCell, textAlign: "left" },
  totalsWrap: {
    ...AVOID_BREAK,
    marginTop: "5mm",
    width: "88mm",
    marginInlineStart: "auto",
  },
  totalsRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "6mm",
    padding: "1.3mm 0",
    borderBottom: `0.5pt solid ${LINE}`,
  },
  grandRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "6mm",
    padding: "2mm 0 1mm",
    borderTop: `1.2pt solid ${INK}`,
    marginTop: "0.5mm",
  },
  grandLabel: { fontSize: "12pt", fontWeight: 700 },
  grandValue: { fontSize: "15pt", fontWeight: 700, color: ACCENT },
  summaryTitle: {
    fontSize: "11pt",
    fontWeight: 700,
    marginTop: "7mm",
    marginBottom: "2mm",
    breakAfter: "avoid",
  },
  signatures: {
    ...AVOID_BREAK,
    display: "flex",
    justifyContent: "space-between",
    marginTop: "16mm",
  },
  signature: {
    width: "55mm",
    borderTop: `0.75pt solid ${INK}`,
    paddingTop: "1.5mm",
    textAlign: "center",
    fontSize: "9pt",
    color: MUTED,
  },
} satisfies Record<string, CSSProperties>;

const clean = (value: string | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
const linesOf = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/\r?\n/)
    .map(clean)
    .filter((line) => line !== "");

/**
 * سطر صندوق «الاسم ×العدد» (صيغة buildPayload). الاسم والعدد يُعزلان اتجاهياً كلٌّ
 * على حدة، وإلا قلبت الخوارزمية الثنائية الاتجاه ترتيب «صندوق A ×12» حين يحوي
 * الاسم حروفاً لاتينية. سطر لا يطابق الصيغة يُعرَض كما هو.
 */
function BoxLine({ line }: { line: string }) {
  const match = /^(.*\S)\s*×\s*(\d+)$/.exec(line);
  if (!match) return <div>{line}</div>;
  return (
    <div>
      <bdi>{match[1]}</bdi> <Num>×{match[2]}</Num>
    </div>
  );
}

/** رقم/مبلغ/تاريخ: عزل LTR كي لا يُعاد ترتيب 100.000,00 داخل نص عربي. */
function Num({ children }: { children: ReactNode }) {
  return <span style={s.num}>{children}</span>;
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={s.metaRow}>
      <span style={s.label}>{label}</span>
      <span style={s.value}>{children}</span>
    </div>
  );
}

function Header({ data }: { data: InvoiceA4Data }) {
  const w = data.weigher;
  const name = clean(w.name);
  const addressLines = linesOf(w.address);
  const phones = [clean(w.phone1), clean(w.phone2)].filter((p) => p !== "");
  const hasBusiness = name !== "" || addressLines.length > 0 || phones.length > 0;

  const number = clean(data.invoiceNumber);
  const date = clean(data.invoiceDate);
  const merchantName = clean(data.merchantName);
  const merchantPhone = clean(data.merchantPhone);
  const merchantAddress = linesOf(data.merchantAddress);
  const hasMerchant = merchantName !== "" || merchantPhone !== "" || merchantAddress.length > 0;

  return (
    <header>
      {hasBusiness && (
        <>
          <div>
            {name !== "" && <div style={s.businessName}>{name}</div>}
            {addressLines.map((line, i) => (
              <div key={i} style={s.businessLine}>
                {line}
              </div>
            ))}
            {phones.length > 0 && (
              <div style={{ ...s.businessLine, display: "flex", gap: "4mm", flexWrap: "wrap" }}>
                <span>الهاتف:</span>
                {phones.map((p, i) => (
                  <Num key={i}>{p}</Num>
                ))}
              </div>
            )}
          </div>
          <div style={s.rule} />
        </>
      )}

      <div style={s.titleRow}>
        <div style={s.docTitle}>فاتورة</div>
        <div style={s.metaBox}>
          <MetaRow label="رقم الفاتورة">
            <Num>{number !== "" ? number : "—"}</Num>
          </MetaRow>
          {date !== "" && (
            <MetaRow label="التاريخ">
              <Num>{date}</Num>
            </MetaRow>
          )}
        </div>
      </div>

      {hasMerchant && (
        <div style={s.merchantBox}>
          {merchantName !== "" && (
            <div style={s.merchantRow}>
              <span style={s.merchantLabel}>اسم التاجر</span>
              <span style={{ ...s.value, fontSize: "11pt", overflowWrap: "anywhere" }}>
                {merchantName}
              </span>
            </div>
          )}
          {merchantPhone !== "" && (
            <div style={s.merchantRow}>
              <span style={s.merchantLabel}>الهاتف</span>
              <Num>{merchantPhone}</Num>
            </div>
          )}
          {merchantAddress.length > 0 && (
            <div style={s.merchantRow}>
              <span style={s.merchantLabel}>العنوان</span>
              <span style={{ overflowWrap: "anywhere" }}>
                {merchantAddress.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </span>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

/**
 * الإجماليات صف أخير في <tbody> نفسه (لا <tfoot>: يتكرر في كل صفحة) مع
 * break-before: avoid على صفها وbreak-after: avoid على آخر بند — فلا تبقى
 * الإجماليات وحدها في صفحة، بل يُسحَب معها آخر بند.
 */
function ItemsTable({
  items,
  hasBoxes,
  footer,
}: {
  items: InvoiceA4Item[];
  hasBoxes: boolean;
  footer: ReactNode;
}) {
  return (
    <table style={s.table}>
      <colgroup>
        <col style={{ width: "8mm" }} />
        <col />
        {hasBoxes && <col style={{ width: "30mm" }} />}
        <col style={{ width: "28mm" }} />
        <col style={{ width: "26mm" }} />
        <col style={{ width: "30mm" }} />
      </colgroup>
      <thead style={s.thead}>
        <tr>
          <th style={{ ...headCell, textAlign: "center" }}>#</th>
          <th style={headCell}>المنتج</th>
          {hasBoxes && <th style={headCell}>الصناديق</th>}
          <th style={s.thNum}>الوزن الصافي (كغ)</th>
          <th style={s.thNum}>السعر (دج/كغ)</th>
          <th style={s.thNum}>المجموع (دج)</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          const rowStyle: CSSProperties = {
            ...AVOID_BREAK,
            ...(i % 2 === 1 ? { backgroundColor: ZEBRA } : null),
            ...(isLast ? { breakAfter: "avoid" } : null),
          };
          return (
            <tr key={i} style={rowStyle}>
              <td style={{ ...cell, textAlign: "center", color: MUTED }}>
                <Num>{i + 1}</Num>
              </td>
              <td style={{ ...cell, fontWeight: 600 }}>{clean(item.product)}</td>
              {hasBoxes && (
                <td style={{ ...cell, fontSize: "8.5pt", color: MUTED }}>
                  {linesOf(item.boxes).map((line, j) => (
                    <BoxLine key={j} line={line} />
                  ))}
                </td>
              )}
              <td style={s.tdNum}>
                <Num>{item.weight}</Num>
              </td>
              <td style={s.tdNum}>
                <Num>{item.price}</Num>
              </td>
              <td style={{ ...s.tdNum, fontWeight: 700 }}>
                <Num>{item.subtotal}</Num>
              </td>
            </tr>
          );
        })}
        <tr style={{ ...AVOID_BREAK, breakBefore: "avoid" }}>
          <td colSpan={hasBoxes ? 6 : 5} style={{ padding: 0, border: "none" }}>
            {footer}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function Totals({ data, hasBoxes }: { data: InvoiceA4Data; hasBoxes: boolean }) {
  return (
    <section style={s.totalsWrap}>
      <div style={s.totalsRow}>
        <span style={s.label}>إجمالي الوزن الصافي</span>
        <span style={s.value}>
          <Num>{data.totalWeight}</Num> كغ
        </span>
      </div>
      {hasBoxes && (
        <div style={s.totalsRow}>
          <span style={s.label}>عدد الصناديق</span>
          <span style={s.value}>
            <Num>{data.totalBoxes}</Num>
          </span>
        </div>
      )}
      <div style={s.grandRow}>
        <span style={s.grandLabel}>الإجمالي الكلي</span>
        <span style={s.grandValue}>
          <Num>{data.grandTotal}</Num> دج
        </span>
      </div>
    </section>
  );
}

/** التوقيعان ثابتان (توقيع الوزّان / توقيع التاجر)؛ يعيشان داخل آخر صف في آخر جدول. */
function Signatures() {
  return (
    <div style={s.signatures}>
      <div style={s.signature}>توقيع الوزّان</div>
      <div style={s.signature}>توقيع التاجر</div>
    </div>
  );
}

function RepeatedSummary({ rows, footer }: { rows: InvoiceA4Summary[]; footer: ReactNode }) {
  return (
    <section>
      <div style={s.summaryTitle}>ملخّص المنتجات المتكررة</div>
      <table style={s.table}>
        <colgroup>
          <col />
          <col style={{ width: "30mm" }} />
          <col style={{ width: "34mm" }} />
          <col style={{ width: "34mm" }} />
        </colgroup>
        <thead style={s.thead}>
          <tr>
            <th style={headCell}>المنتج</th>
            <th style={s.thNum}>الوزن الكلي (كغ)</th>
            <th style={s.thNum}>سعر التعادل (دج/كغ)</th>
            <th style={s.thNum}>المبلغ الكلي (دج)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              style={{ ...AVOID_BREAK, ...(i % 2 === 1 ? { backgroundColor: ZEBRA } : null) }}
            >
              <td style={{ ...cell, fontWeight: 600 }}>{clean(row.product)}</td>
              <td style={s.tdNum}>
                <Num>{row.totalWeight}</Num>
              </td>
              <td style={s.tdNum}>
                <Num>{row.breakEvenPrice}</Num>
              </td>
              <td style={{ ...s.tdNum, fontWeight: 700 }}>
                <Num>{row.totalAmount}</Num>
              </td>
            </tr>
          ))}
          <tr style={{ ...AVOID_BREAK, breakBefore: "avoid" }}>
            <td colSpan={4} style={{ padding: 0, border: "none" }}>
              {footer}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export function InvoiceA4({ data }: { data: InvoiceA4Data }) {
  const items = data.items ?? [];
  const hasBoxes = items.some((item) => clean(item.boxes) !== "");
  const summary = data.repeatedProductSummary ?? [];

  return (
    <div style={s.page} lang="ar" dir="rtl">
      <Header data={data} />
      <ItemsTable
        items={items}
        hasBoxes={hasBoxes}
        footer={
          <>
            <Totals data={data} hasBoxes={hasBoxes} />
            {summary.length === 0 && <Signatures />}
          </>
        }
      />
      {summary.length > 0 && <RepeatedSummary rows={summary} footer={<Signatures />} />}
    </div>
  );
}
