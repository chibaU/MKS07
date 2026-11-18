// ============================================================================
// الفاتورة: مستند A4 عمودي ثابت التصميم (لا يعدّله المستخدم). RTL، خط Cairo المحلي،
// أنماط inline فقط (قواعد @page/@media في printCss.ts).
//
// مصمَّمة للطابعة بالأبيض والأسود (ليزر/حبر أحادي):
//  - كل النصوص والخطوط سوداء #000 — لا أزرق ولا رمادي نصّاً (الرمادي يُطبع منقَّطاً
//    ويضعف وضوح الأرقام). التسلسل البصري بالحجم والوزن والخطوط لا باللون.
//  - تعبئة رمادية فاتحة جداً (FILL) لرؤوس الجداول وصف الإجمالي فقط، وكل عنصر يبقى
//    مقروءاً ومحدَّداً بخطوطه لو لم تُطبع التعبئة (وضع توفير الحبر).
//  - عروض الخطوط بالبكسل الصحيح (1px / 2px): Chromium يُقرِّب عرض الحد إلى عدد صحيح من
//    البكسلات، فكان 0.6pt و1.3pt يُطبعان بالسماكة نفسها وتضيع فروق التسلسل.
//
// البنية (من الأعلى):
//   1) بيانات الوزّان (يمين)
//   2) خط مزدوج
//   3) كلمة «فاتورة» في المنتصف
//   4) [ بيانات التاجر في عمود واحد بنمط واحد: الاسم / العنوان (سطر واحد) / الهاتف (يمين)
//        | رقم الفاتورة والتاريخ — نص عادي بلا جدول ولا إطار (يسار) ]
//   5) خط رفيع ← جدول البنود ← الإجماليات (عرضها = عرض آخر ثلاثة أعمدة في الجدول)
//      ← (ملخّص اختياري).
//
// البيانات جاهزة التنسيق (مخرجات buildPayload في services/print.ts + بيانات الوزّان):
// لا يُعاد هنا حساب أي مجموع ولا تنسيق أي مبلغ — تُعرَض النصوص كما وصلت. الاستثناء
// الوحيد تحويل التاريخ YYYY-MM-DD إلى DD/MM/YYYY للعرض، وجمع أسطر عنوان التاجر في سطر
// واحد. أي قيمة فارغة لا تُرسَم ولا تُفشل الطباعة (رقم الفاتورة الفارغ يظهر «—»).
//
// الصفحات: الترويسة في الصفحة الأولى فقط، و<thead> الجدول يتكرر في كل صفحة، والصفوف لا
// تنقسم. الإجماليات صف أخير في <tbody> نفسه (break-before: avoid) وآخر بند
// (break-after: avoid) فلا تنفرد الإجماليات بصفحة بل يُسحَب معها آخر بند. رقم الفاتورة
// يظهر أعلى كل صفحة تتمّة (@page :first يُخفيه في الأولى).
//
// الهوامش: الجانبان padding داخل المستند (pageStyle) ليعملا في كل المحركات؛ الأعلى والأسفل
// عبر @page في printCss.ts، ومع محرّك يتجاهل @page (WebKit) يُضاف هامش الأعلى padding في
// الصفحة الأولى فقط. ترقيم الصفحات في printCss.ts أيضاً.
// ============================================================================

import type { CSSProperties, ReactNode } from "react";
import type { WeigherInfo } from "../weigher.ts";
import { PAGE_MARGIN_MM } from "../printCss.ts";

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

// ─── ثوابت التصميم ──────────────────────────────────────────────────────────
const INK = "#000000";
// الوحيدة غير السوداء: تعبئة رمادية فاتحة جداً (~9%) لرؤوس الجداول وصف الإجمالي.
const FILL = "#E9E9E9";
const THIN = `1px solid ${INK}`; // ≈ 0.75pt
const HEAVY = `2px solid ${INK}`; // ≈ 1.5pt

const AVOID_BREAK: CSSProperties = { breakInside: "avoid", pageBreakInside: "avoid" };

// أعمدة جدول البنود الثلاثة الأخيرة (الوزن / السعر / المبلغ) بالمليمتر. صندوق الإجماليات
// يأخذ مجموعها عرضاً فيصطف تحت هذه الأعمدة تماماً — فمصدر الأرقام واحد للجدول والصندوق.
const COL_WEIGHT_MM = 27;
const COL_PRICE_MM = 27;
const COL_AMOUNT_MM = 32;
const TOTALS_WIDTH_MM = COL_WEIGHT_MM + COL_PRICE_MM + COL_AMOUNT_MM;

const cell: CSSProperties = {
  padding: "1.2mm 2mm",
  borderBottom: THIN,
  borderInlineEnd: THIN,
  fontSize: "10pt",
  verticalAlign: "middle",
  overflowWrap: "anywhere",
};

const headCell: CSSProperties = {
  padding: "1.5mm 2mm",
  backgroundColor: FILL,
  borderTop: HEAVY,
  borderBottom: HEAVY,
  borderInlineEnd: THIN,
  fontSize: "9.5pt",
  fontWeight: 700,
  textAlign: "center",
  verticalAlign: "middle",
  lineHeight: 1.3,
};

const s = {
  page: {
    direction: "rtl",
    fontFamily: "'Cairo', sans-serif",
    color: INK,
    fontSize: "10pt",
    lineHeight: 1.45,
    backgroundColor: "#fff",
    boxSizing: "border-box",
    // الهوامش الجانبية تُحدَّد في pageStyle() أدناه (داخل المستند، لا في @page).
  },
  // — بيانات الوزّان —
  identity: { paddingTop: "0.5mm" },
  businessName: { fontSize: "19pt", fontWeight: 800, lineHeight: 1.25, overflowWrap: "anywhere" },
  businessLine: { fontSize: "10.5pt", fontWeight: 500, marginTop: "0.6mm", overflowWrap: "anywhere" },
  phoneRow: { fontSize: "10.5pt", fontWeight: 500, marginTop: "0.6mm", display: "flex", gap: "4mm", flexWrap: "wrap" },
  // خط مزدوج مرسوم بخطّين صريحين: border-style: double يُرسَم خطاً سميكاً واحداً في WebKit.
  doubleRule: {
    boxSizing: "content-box",
    height: 0,
    paddingTop: "3px",
    borderTop: HEAVY,
    borderBottom: THIN,
    margin: "3.5mm 0 0",
  },
  docTitle: {
    textAlign: "center",
    fontSize: "28pt",
    fontWeight: 800,
    lineHeight: 1.2,
    letterSpacing: "0.6mm",
    margin: "2.5mm 0 3mm",
  },
  // — الشريط الثاني: التاجر (يمين) | رقم الفاتورة والتاريخ (يسار) —
  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "10mm",
    paddingBottom: "3.5mm",
    borderBottom: THIN,
    marginBottom: "5mm",
    ...AVOID_BREAK,
  },
  merchantCol: {
    flex: 1,
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    columnGap: "3mm",
    rowGap: "1.2mm",
    alignItems: "baseline",
  },
  merchantLabel: { fontSize: "9.5pt", fontWeight: 600, whiteSpace: "nowrap" },
  merchantValue: { fontSize: "11pt", fontWeight: 600, overflowWrap: "anywhere" },
  metaCol: { width: "60mm", flexShrink: 0, marginInlineStart: "auto" },
  metaLine: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "4mm",
  },
  metaLineGap: { marginTop: "1.6mm" },
  metaLabel: { fontSize: "9.5pt", fontWeight: 600, whiteSpace: "nowrap" },
  metaValue: { fontSize: "13pt", fontWeight: 800 },
  // — الجداول —
  table: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" },
  thead: { display: "table-header-group" },
  num: {
    display: "inline-block",
    direction: "ltr",
    unicodeBidi: "isolate",
    whiteSpace: "nowrap",
  },
  // — الإجماليات —
  totalsWrap: {
    ...AVOID_BREAK,
    boxSizing: "border-box",
    // حدود الجدول مدموجة (collapse) فتتمركز على حواف الأعمدة بينما حد الصندوق داخل
    // إطاره؛ فرق ~0.3mm قِيس في Chromium. نوسّع الصندوق 0.4mm ونُزيحه 0.25mm نحو الحافة
    // كي تنطبق خطوطه على خطوط الأعمدة الثلاثة بالمليمتر.
    width: `calc(${TOTALS_WIDTH_MM}mm + 0.4mm)`,
    marginInlineStart: "auto",
    marginInlineEnd: "-0.25mm",
    border: HEAVY,
  },
  // flexWrap: لو طال مبلغ استثنائي نزلت القيمة تحت عنوانها بدل أن تتجاوز الصندوق.
  totalsRow: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "baseline",
    columnGap: "4mm",
    padding: "1.2mm 3mm",
    borderBottom: THIN,
  },
  totalsLabel: { fontSize: "10pt", fontWeight: 600 },
  totalsValue: { fontSize: "11.5pt", fontWeight: 800 },
  grandRow: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "baseline",
    columnGap: "4mm",
    padding: "1.8mm 3mm",
    backgroundColor: FILL,
  },
  grandLabel: { fontSize: "12pt", fontWeight: 800 },
  grandValue: { fontSize: "15pt", fontWeight: 800 },
  summaryTitle: {
    fontSize: "11.5pt",
    fontWeight: 800,
    marginTop: "6mm",
    marginBottom: "2mm",
    breakAfter: "avoid",
  },
} satisfies Record<string, CSSProperties>;

// ─── أدوات صغيرة ────────────────────────────────────────────────────────────
const clean = (value: string | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
const linesOf = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/\r?\n/)
    .map(clean)
    .filter((line) => line !== "");

/** YYYY-MM-DD → DD/MM/YYYY (الصيغة المعتمدة محلياً). أي نص آخر يُعرَض كما هو. */
function displayDate(value: string | undefined): string {
  const text = clean(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

/** رقم/مبلغ/تاريخ: عزل LTR كي لا يُعاد ترتيب 100.000,00 داخل نص عربي. */
function Num({ children }: { children: ReactNode }) {
  return <span style={s.num}>{children}</span>;
}

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

/**
 * حدود الإطار الخارجي لجدول: الخلية الأولى (يمين) تأخذ الحد الأيمن الثقيل والأخيرة
 * (يسار) الحد الأيسر الثقيل. الحدود على مستوى الخلية لا الجدول، كي لا يمتد الإطار
 * على صف الإجماليات الأخير (وهو داخل الجدول لكن بلا إطار).
 */
function frame(index: number, count: number): CSSProperties {
  return {
    ...(index === 0 ? { borderInlineStart: HEAVY } : null),
    ...(index === count - 1 ? { borderInlineEnd: HEAVY } : null),
  };
}

// ─── الترويسة ───────────────────────────────────────────────────────────────
/** سطر «عنوان: قيمة» في عمود رقم الفاتورة/التاريخ — نص عادي بلا إطار. */
function MetaLine({ label, children, first }: { label: string; children: ReactNode; first?: boolean }) {
  return (
    <div style={{ ...s.metaLine, ...(first ? null : s.metaLineGap) }}>
      <span style={s.metaLabel}>{label}</span>
      <span style={s.metaValue}>{children}</span>
    </div>
  );
}

/**
 * عمود التاجر: الاسم ثم العنوان (سطر واحد: يُجمَع إن كُتب على أسطر، وغالباً يحوي الولاية
 * والبلدية فقط) ثم الهاتف، كلٌّ بعنوانه. الحقل الفارغ لا يُرسَم.
 */
function MerchantColumn({ data }: { data: InvoiceA4Data }) {
  const name = clean(data.merchantName);
  const address = linesOf(data.merchantAddress).join("، ");
  const phone = clean(data.merchantPhone);

  return (
    <div style={s.merchantCol}>
      {name !== "" && (
        <>
          <span style={s.merchantLabel}>اسم التاجر:</span>
          <span style={s.merchantValue}>{name}</span>
        </>
      )}
      {address !== "" && (
        <>
          <span style={s.merchantLabel}>العنوان:</span>
          <span style={s.merchantValue}>{address}</span>
        </>
      )}
      {phone !== "" && (
        <>
          <span style={s.merchantLabel}>الهاتف:</span>
          <span style={s.merchantValue}>
            <Num>{phone}</Num>
          </span>
        </>
      )}
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
  const date = displayDate(data.invoiceDate);

  return (
    <header>
      {hasBusiness && (
        <div style={s.identity}>
          {name !== "" && <div style={s.businessName}>{name}</div>}
          {addressLines.map((line, i) => (
            <div key={i} style={s.businessLine}>
              {line}
            </div>
          ))}
          {phones.length > 0 && (
            <div style={s.phoneRow}>
              <span>الهاتف:</span>
              {phones.map((p, i) => (
                <Num key={i}>{p}</Num>
              ))}
            </div>
          )}
        </div>
      )}

      {hasBusiness && <div style={s.doubleRule} />}
      <div style={s.docTitle}>فاتورة</div>

      <div style={s.infoRow}>
        <MerchantColumn data={data} />
        <div style={s.metaCol}>
          <MetaLine label="رقم الفاتورة" first>
            <Num>{number !== "" ? number : "—"}</Num>
          </MetaLine>
          {date !== "" && (
            <MetaLine label="التاريخ">
              <Num>{date}</Num>
            </MetaLine>
          )}
        </div>
      </div>
    </header>
  );
}

// ─── جدول البنود ────────────────────────────────────────────────────────────
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
  const heads = [
    { label: "#", width: "9mm" },
    { label: "المنتج", width: undefined },
    ...(hasBoxes ? [{ label: "الصناديق", width: "33mm" }] : []),
    { label: "الوزن الصافي (كغ)", width: `${COL_WEIGHT_MM}mm` },
    { label: "السعر (دج/كغ)", width: `${COL_PRICE_MM}mm` },
    { label: "المبلغ (دج)", width: `${COL_AMOUNT_MM}mm` },
  ];
  const count = heads.length;

  return (
    <table style={s.table}>
      <colgroup>
        {heads.map((h, i) => (
          <col key={i} style={h.width ? { width: h.width } : undefined} />
        ))}
      </colgroup>
      <thead style={s.thead}>
        <tr>
          {heads.map((h, i) => (
            <th key={i} style={{ ...headCell, ...frame(i, count) }}>
              {h.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          const rowStyle: CSSProperties = {
            ...AVOID_BREAK,
            ...(isLast ? { breakAfter: "avoid" } : null),
          };
          const last: CSSProperties = isLast ? { borderBottom: HEAVY } : {};
          let c = 0;
          return (
            <tr key={i} style={rowStyle}>
              <td style={{ ...cell, ...last, ...frame(c++, count), textAlign: "center", fontWeight: 600 }}>
                <Num>{i + 1}</Num>
              </td>
              <td style={{ ...cell, ...last, ...frame(c++, count), fontWeight: 700, fontSize: "10.5pt" }}>
                {clean(item.product)}
              </td>
              {hasBoxes && (
                <td style={{ ...cell, ...last, ...frame(c++, count), fontSize: "9pt", fontWeight: 600, lineHeight: 1.3 }}>
                  {linesOf(item.boxes).map((line, j) => (
                    <BoxLine key={j} line={line} />
                  ))}
                </td>
              )}
              <td style={{ ...cell, ...last, ...frame(c++, count), textAlign: "right" }}>
                <Num>{item.weight}</Num>
              </td>
              <td style={{ ...cell, ...last, ...frame(c++, count), textAlign: "right" }}>
                <Num>{item.price}</Num>
              </td>
              <td style={{ ...cell, ...last, ...frame(c++, count), textAlign: "right", fontWeight: 800 }}>
                <Num>{item.subtotal}</Num>
              </td>
            </tr>
          );
        })}
        <tr style={{ ...AVOID_BREAK, breakBefore: "avoid" }}>
          <td colSpan={count} style={{ padding: 0, border: "none" }}>
            <div style={{ paddingTop: "3.5mm" }}>{footer}</div>
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
        <span style={s.totalsLabel}>إجمالي الوزن الصافي</span>
        <span style={s.totalsValue}>
          <Num>{data.totalWeight}</Num> كغ
        </span>
      </div>
      {hasBoxes && (
        <div style={s.totalsRow}>
          <span style={s.totalsLabel}>عدد الصناديق</span>
          <span style={s.totalsValue}>
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

// ─── الملخّص الاختياري ──────────────────────────────────────────────────────
function RepeatedSummary({ rows }: { rows: InvoiceA4Summary[] }) {
  const heads = ["المنتج", "الوزن الكلي (كغ)", "سعر التعادل (دج/كغ)", "المبلغ الكلي (دج)"];
  return (
    <section>
      <div style={s.summaryTitle}>ملخّص المنتجات المتكررة</div>
      <table style={s.table}>
        <colgroup>
          <col />
          <col style={{ width: "32mm" }} />
          <col style={{ width: "38mm" }} />
          <col style={{ width: "36mm" }} />
        </colgroup>
        <thead style={s.thead}>
          <tr>
            {heads.map((h, i) => (
              <th key={i} style={{ ...headCell, ...frame(i, heads.length) }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const last: CSSProperties = i === rows.length - 1 ? { borderBottom: HEAVY } : {};
            return (
              <tr key={i} style={AVOID_BREAK}>
                <td style={{ ...cell, ...last, ...frame(0, 4), fontWeight: 700, fontSize: "10.5pt" }}>
                  {clean(row.product)}
                </td>
                <td style={{ ...cell, ...last, ...frame(1, 4), textAlign: "right" }}>
                  <Num>{row.totalWeight}</Num>
                </td>
                <td style={{ ...cell, ...last, ...frame(2, 4), textAlign: "right" }}>
                  <Num>{row.breakEvenPrice}</Num>
                </td>
                <td style={{ ...cell, ...last, ...frame(3, 4), textAlign: "right", fontWeight: 800 }}>
                  <Num>{row.totalAmount}</Num>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ─── رقم الفاتورة في صفحات التتمّة ──────────────────────────────────────────
/**
 * يُكتب في صندوق هامش @page (لا يستهلك مساحة من المحتوى) ويُخفى في الصفحة الأولى لأن
 * ترويستها تحمل الرقم. يُتجاهَل بصمت إن لم يدعم المحرّك صناديق الهوامش (الشرط نفسه
 * لترقيم الصفحات في printCss.ts). الرقم يُنظَّف من محارف قد تكسر نص CSS.
 */
function ContinuationHeader({ number }: { number: string }) {
  const safe = clean(number).replace(/[\\"<>]/g, "");
  if (safe === "") return null;
  const css =
    `@page { @top-center { content: "فاتورة رقم ${safe} — تتمّة"; ` +
    `font-family: 'Cairo', sans-serif; font-size: 9pt; font-weight: 700; color: #000; ` +
    `direction: rtl; vertical-align: middle; } } ` +
    `@page :first { @top-center { content: none; } }`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

// ─── الهوامش ────────────────────────────────────────────────────────────────
/**
 * هل يطبّق المحرّك هوامش @page؟ Chromium (WebView2 على ويندوز) نعم؛ WebKit (WebKitGTK
 * على لينكس، WKWebView على ماك) يتجاهلها فتخرج الفاتورة ملاصقة لحافة الورقة، وهذا ما
 * ظهر في PDF طُبع على لينكس. يُقرأ وقت العرض داخل نافذة التطبيق نفسها.
 */
function engineHonorsPageMargins(): boolean {
  if (typeof navigator === "undefined") return true;
  return /\b(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent);
}

/**
 * الجانبان داخل المستند دائماً (يعمل في كل المحركات). أما الأعلى والأسفل فتتكفّل بهما
 * @page (printCss.ts) في Chromium — وهي وحدها التي تتكرر على كل صفحة. حيث تُتجاهَل
 * نضيف هامش الأعلى padding في الصفحة الأولى فقط. الهامش السفلي لا يُضاف: padding في آخر
 * المستند يُنتج صفحة فارغة حين ينتهي المحتوى قرب أسفل الصفحة (جُرِّب)، ولا طريقة موثوقة
 * لحجز مساحة أسفل كل صفحة بلا @page.
 */
function pageStyle(): CSSProperties {
  const m = PAGE_MARGIN_MM;
  return {
    ...s.page,
    paddingLeft: `${m.left}mm`,
    paddingRight: `${m.right}mm`,
    ...(engineHonorsPageMargins() ? null : { paddingTop: `${m.top}mm` }),
  };
}

export function InvoiceA4({ data }: { data: InvoiceA4Data }) {
  const items = data.items ?? [];
  const hasBoxes = items.some((item) => clean(item.boxes) !== "");
  const summary = data.repeatedProductSummary ?? [];

  return (
    <div style={pageStyle()} lang="ar" dir="rtl">
      <ContinuationHeader number={data.invoiceNumber} />
      <Header data={data} />
      <ItemsTable items={items} hasBoxes={hasBoxes} footer={<Totals data={data} hasBoxes={hasBoxes} />} />
      {summary.length > 0 && <RepeatedSummary rows={summary} />}
    </div>
  );
}