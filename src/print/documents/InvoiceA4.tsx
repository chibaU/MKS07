// ============================================================================
// الفاتورة: مستند A4 عمودي ثابت التصميم (لا يعدّله المستخدم). RTL، خط Cairo المحلي،
// أنماط inline فقط (قواعد @page/@media في printCss.ts).
//
// مصمَّمة للطابعة بالأبيض والأسود (ليزر/حبر أحادي):
//  - كل النصوص والخطوط سوداء #000 — لا أزرق ولا رمادي نصّاً (الرمادي يُطبع منقَّطاً
//    ويضعف وضوح الأرقام). التسلسل البصري بالحجم والوزن والخطوط لا باللون.
//  - تعبئة رمادية فاتحة جداً (FILL) لرؤوس الجداول وصف الإجمالي، وأخفّ منها (ZEBRA) لكل
//    صف بند ثانٍ ليسهل تتبّع السطر؛ وكل عنصر يبقى مقروءاً ومحدَّداً بخطوطه لو لم تُطبع
//    التعبئة (وضع توفير الحبر).
//  - عروض الخطوط بالبكسل الصحيح: Chromium يُقرِّب عرض الحد إلى عدد صحيح من البكسلات، فلا
//    وسط بين 1px و2px. حدود الجداول كلها 1px (الإطار الخارجي كان 2px = ضعف الشبكة الداخلية
//    وبدا غليظاً: قِيس 0.53mm مقابل 0.26mm)؛ والخط المزدوج تحت اسم السوق وحده يستعمل 2px.
//
// البنية (من الأعلى):
//   1) اسم السوق (MARKET_TITLE) في المنتصف بأكبر خط في الصفحة ← خط مزدوج
//   2) عمودان بنص عادي بلا جدول ولا إطار ولا ترويسة وبخط واحد (اسم كل حقل يحمل صاحبه):
//        يمين: اسم التاجر، هاتف التاجر، عنوان التاجر (سطر واحد)
//        يسار: رقم الفاتورة، تاريخ الفاتورة
//      ← خط رفيع
//   3) جدول البنود ← الإجماليات (عرضها = عرض آخر ثلاثة أعمدة في الجدول) ← (ملخّص اختياري).
//   4) في آخر الفاتورة، في المنتصف بخط صغير: «ميزان (اسم الوزّان)» ثم «للاتصال (الهاتف / الهاتف)»؛
//      يُحذف سطر الهاتف إن لم يوجد، ولا يُرسَم شيء إن لم يوجد اسم ولا هاتف. لا بيانات وزّان
//      في أعلى الفاتورة، ولا عنوان للوزّان (عنوانه هو اسم السوق).
//
// البيانات جاهزة التنسيق (مخرجات buildPayload في services/print.ts + بيانات الوزّان):
// لا يُعاد هنا حساب أي مجموع ولا تنسيق أي مبلغ، ولا يُعدَّل أي نص أدخله المستخدم (أسماء
// وعناوين وهواتف ومنتجات): تُعرَض كما وصلت. الاستثناءان الوحيدان: تحويل التاريخ
// YYYY-MM-DD إلى DD/MM/YYYY، وطباعة «/» مكان أي حقل تاجر/تاريخ غير مُدرَج (انظر MISSING).
// لا شيء يُفشل الطباعة.
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
// عروض الخطوط بالبكسل الصحيح (Chromium يُسقِط الكسور). كل حدود الجداول والخلايا والإطار الخارجي
// THIN (≈ 0.26mm)؛ HEAVY لم يعد يُستعمل إلا في الخط المزدوج تحت اسم السوق.
const THIN = `1px solid ${INK}`; // ≈ 0.75pt
const HEAVY = `2px solid ${INK}`; // ≈ 1.5pt

const AVOID_BREAK: CSSProperties = { breakInside: "avoid", pageBreakInside: "avoid" };

// السطر الأول من الفاتورة: اسم السوق (ثابت). غيّره هنا إن لزم.
const MARKET_TITLE = "سوق الجملة للخضر والفواكه ببلدية الغروس";
// اسم السوق: 26pt هو الأكبر الذي يتّسع فيه الاسم الحالي في سطر واحد (قِيس 179.7mm من
// 186mm؛ عند 27pt ينزل «الغروس» لسطر ثانٍ) — فإن طال الاسم فصغّر هذه القيمة.
const MARKET_TITLE_PT = 26;
// خلفية الصف الثاني والرابع… في جدول البنود (الأول أبيض): أخفّ من FILL ليبقى رأس الجدول
// الأغمق مميَّزاً. على طابعة أحادية اللون تُطبع منقَّطة بخفّة؛ ارفعها أو اجعلها "#fff" حسب الطابعة.
const ZEBRA = "#F2F2F2";

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
  borderTop: THIN,
  borderBottom: THIN,
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
  // — السطر الأول: اسم السوق (الأكبر في الصفحة) —
  marketTitle: {
    textAlign: "center",
    fontSize: `${MARKET_TITLE_PT}pt`,
    fontWeight: 800,
    lineHeight: 1.25,
    paddingTop: "0.5mm",
    overflowWrap: "anywhere",
  },
  // خط مزدوج مرسوم بخطّين صريحين: border-style: double يُرسَم خطاً سميكاً واحداً في WebKit.
  doubleRule: {
    boxSizing: "content-box",
    height: 0,
    paddingTop: "3px",
    borderTop: HEAVY,
    borderBottom: THIN,
    margin: "2mm 0 3.5mm",
  },
  // — عمودان: التاجر (يمين) | رقم الفاتورة وتاريخها (يسار)، بلا ترويسة: اسم كل حقل يحمل صاحبه —
  parties: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    columnGap: "10mm",
    alignItems: "start",
    paddingBottom: "3.5mm",
    borderBottom: THIN,
    marginBottom: "4.5mm",
    ...AVOID_BREAK,
  },
  partyBlock: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    columnGap: "3mm",
    rowGap: "1mm",
    alignItems: "baseline",
  },
  fieldLabel: { fontSize: "9.5pt", fontWeight: 600, whiteSpace: "nowrap" },
  fieldValue: { fontSize: "11pt", fontWeight: 600, overflowWrap: "anywhere" },
  phoneList: { display: "flex", flexWrap: "wrap", columnGap: "4mm" },
  // رقم الفاتورة: يُسمَح له بالالتفاف (بخلاف Num) كي لا يتجاوز عمودَه رقمٌ طويل جداً؛ الأرقام
  // المعتادة تتّسع في سطر واحد فلا يتغيّر شيء.
  numWrap: { display: "inline-block", direction: "ltr", unicodeBidi: "isolate", overflowWrap: "anywhere" },
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
    border: THIN,
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
  // — خاتمة الفاتورة: ميزان (الاسم) / للاتصال (الهاتف) — صغيرة ومتوسطة الوزن كي لا تزعج —
  weigherFooter: {
    ...AVOID_BREAK,
    marginTop: "9mm",
    textAlign: "center",
    fontSize: "9pt",
    fontWeight: 600,
    lineHeight: 1.6,
  },
  summaryTitle: {
    fontSize: "11.5pt",
    fontWeight: 800,
    marginTop: "6mm",
    marginBottom: "2mm",
    breakAfter: "avoid",
  },
} satisfies Record<string, CSSProperties>;

// ─── أدوات صغيرة ────────────────────────────────────────────────────────────
// لا تُعدَّل هنا أي قيمة نصية أدخلها المستخدم (لا تنظيف مسافات ولا دمج أسطر ولا حذف
// محارف): تُعرَض كما هي. الدالتان التاليتان للفحص والتقسيم فقط.

/** هل القيمة فارغة (لم تُدخَل)؟ فحص فقط — النص المعروض لا يتغيّر. */
const isBlank = (value: string | undefined): boolean => (value ?? "").trim() === "";

/** أسطر نص متعدد الأسطر (حقل الصناديق من buildPayload): تُحذف الأسطر الفارغة فقط، ومحتوى كل سطر كما هو. */
const splitLines = (value: string | undefined): string[] =>
  (value ?? "").split(/\r?\n/).filter((line) => !isBlank(line));

/** YYYY-MM-DD → DD/MM/YYYY (الصيغة المعتمدة محلياً). أي نص آخر يُعرَض كما هو. */
function displayDate(value: string | undefined): string {
  const text = value ?? "";
  const match = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

/** رقم/مبلغ/تاريخ: عزل LTR كي لا يُعاد ترتيب 100.000,00 داخل نص عربي. */
function Num({ children }: { children: ReactNode }) {
  return <span style={s.num}>{children}</span>;
}

/**
 * سطر صندوق «الاسم ×العدد» (صيغة buildPayload) يُعرَض: اسم الصندوق ثم علامة الضرب ثم العدد
 * بهذا الترتيب عند القراءة من اليمين («صندوق A × 5»). الاسم والعدد يُعزلان اتجاهياً كلٌّ
 * على حدة وعلامة الضرب خارجهما: وضعُ «×5» معاً داخل عزل LTR يعرضها «5×» (العدد قبل
 * العلامة)، ودون عزل تقلب الخوارزمية الثنائية الاتجاه الترتيب حين يحوي الاسم حروفاً
 * لاتينية. سطر لا يطابق الصيغة يُعرَض كما هو.
 */
function BoxLine({ line }: { line: string }) {
  const match = /^(.*\S)\s*×\s*(\d+)$/.exec(line);
  if (!match) return <div>{line}</div>;
  return (
    <div>
      <bdi>{match[1]}</bdi> × <Num>{match[2]}</Num>
    </div>
  );
}

/**
 * حدود الإطار الخارجي لجدول: الخلية الأولى (يمين) تأخذ الحد الأيمن والأخيرة (يسار) الحد
 * الأيسر، بالسماكة نفسها لبقية الشبكة. الحدود على مستوى الخلية لا الجدول، كي لا يمتد الإطار
 * على صف الإجماليات الأخير (وهو داخل الجدول لكن بلا إطار).
 */
function frame(index: number, count: number): CSSProperties {
  return {
    ...(index === 0 ? { borderInlineStart: THIN } : null),
    ...(index === count - 1 ? { borderInlineEnd: THIN } : null),
  };
}

// ─── الترويسة ───────────────────────────────────────────────────────────────
/**
 * ما يُطبَع مكان بيان تاجر (أو تاريخ) غير مُدرَج. يُعالَج عند الطباعة لا في قاعدة البيانات:
 * القاعدة تبقى نظيفة (فارغ = لم يُدخَل) فلا تظهر «/» في نماذج التعديل ولا تلوّث البحث أو
 * التحقق من رقم الهاتف، ويتغيّر الرمز من مكان واحد دون ترحيل بيانات.
 */
const MISSING = "/";
const orMissing = (value: string | undefined): string => (isBlank(value) ? MISSING : (value ?? ""));

/** زوج «عنوان: قيمة» داخل كتلة بيانات (شبكة: عمود للعنوان وعمود للقيمة). */
function Field({
  label,
  children,
  valueStyle,
}: {
  label: string;
  children: ReactNode;
  valueStyle?: CSSProperties;
}) {
  return (
    <>
      <span style={s.fieldLabel}>{label}</span>
      <span style={valueStyle ?? s.fieldValue}>{children}</span>
    </>
  );
}

/**
 * كتلة حقول (التاجر أو الفاتورة). لا عنوان للكتلة: كل حقل يحمل صاحبه في اسمه («اسم التاجر»،
 * «رقم الفاتورة»…) فلا حاجة لترويسة ولا لخط تحتها. كل الحقول بخط واحد (fieldLabel/fieldValue).
 */
function Party({ children }: { children: ReactNode }) {
  return <div style={s.partyBlock}>{children}</div>;
}

/**
 * بيانات التاجر (العمود الأيمن): اسم التاجر ثم هاتفه ثم عنوانه، وتُرسَم الثلاثة دائماً («/»
 * مكان غير المُدرَج). القيم كما أُدخلت بلا أي تعديل؛ والعنوان يظهر في سطر واحد لأن CSS يعامل
 * الأسطر الجديدة كمسافة عادية (لا نصّ يُدمَج أو يُستبدَل في الكود).
 */
function MerchantParty({ data }: { data: InvoiceA4Data }) {
  return (
    <Party>
      <Field label="اسم التاجر:">{orMissing(data.merchantName)}</Field>
      <Field label="هاتف التاجر:">
        {isBlank(data.merchantPhone) ? MISSING : <Num>{data.merchantPhone}</Num>}
      </Field>
      <Field label="عنوان التاجر:">{orMissing(data.merchantAddress)}</Field>
    </Party>
  );
}

/** رقم الفاتورة وتاريخها (العمود الأيسر). رقم الفاتورة الفارغ لا يُرسَم؛ التاريخ يُرسَم دائماً. */
function InvoiceMetaParty({ data }: { data: InvoiceA4Data }) {
  return (
    <Party>
      {!isBlank(data.invoiceNumber) && (
        <Field label="رقم الفاتورة:">
          <span style={s.numWrap}>{data.invoiceNumber}</span>
        </Field>
      )}
      <Field label="تاريخ الفاتورة:">
        {isBlank(data.invoiceDate) ? MISSING : <Num>{displayDate(data.invoiceDate)}</Num>}
      </Field>
    </Party>
  );
}

/**
 * الترويسة (الصفحة الأولى فقط): اسم السوق ← خط مزدوج ← التاجر (يمين) | رقم الفاتورة وتاريخها
 * (يسار) بخط واحد ← خط رفيع. لا بيانات وزّان هنا: مكانها خاتمة الفاتورة (WeigherFooter).
 */
function Header({ data }: { data: InvoiceA4Data }) {
  return (
    <header>
      <div style={s.marketTitle}>{MARKET_TITLE}</div>
      <div style={s.doubleRule} />

      {/* العمود الأول في RTL هو اليمين. */}
      <div style={s.parties}>
        <MerchantParty data={data} />
        <InvoiceMetaParty data={data} />
      </div>
    </header>
  );
}

/**
 * خاتمة الفاتورة (مرة واحدة في آخرها، في المنتصف بخط صغير):
 *   ميزان (اسم الوزّان)
 *   للاتصال (هاتف) / (هاتف)
 * سطر الهاتف يُحذف إن لم يوجد هاتف، ولا يُرسَم شيء إن لم يوجد اسم ولا هاتف. هي في تدفّق
 * المستند لا في صندوق هامش @page عمداً: صناديق الهوامش تُتجاهَل في WebView2 الأقدم من 131
 * وفي WebKit، فتضيع بيانات الوزّان من الفاتورة كلياً بعد إزالتها من أعلاها.
 * تُوضَع داخل آخر كتلة غير قابلة للانقسام (صف الإجماليات، أو قسم الملخّص إن وُجد) لا بعدها:
 * ككتلة مستقلة بـbreak-before: avoid كانت تنفرد بصفحة وحدها حين تمتلئ الصفحة قبلها (قِيس).
 */
function WeigherFooter({ weigher }: { weigher: WeigherInfo }) {
  const phones = [weigher.phone1, weigher.phone2].filter((p) => !isBlank(p));
  const hasName = !isBlank(weigher.name);
  if (!hasName && phones.length === 0) return null;
  return (
    <footer style={s.weigherFooter}>
      {hasName && (
        <div>
          ميزان <bdi>{weigher.name}</bdi>
        </div>
      )}
      {phones.length > 0 && (
        <div>
          للاتصال{" "}
          {phones.map((p, i) => (
            <span key={i}>
              {i > 0 && " / "}
              <Num>{p}</Num>
            </span>
          ))}
        </div>
      )}
    </footer>
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
          // الصف الأول أبيض (فوقه رأس الجدول الرمادي) والثاني رمادي فاتح جداً وهكذا.
          const rowCell: CSSProperties = i % 2 === 1 ? { backgroundColor: ZEBRA } : {};
          let c = 0;
          return (
            <tr key={i} style={rowStyle}>
              <td style={{ ...cell, ...rowCell, ...frame(c++, count), textAlign: "center", fontWeight: 600 }}>
                <Num>{i + 1}</Num>
              </td>
              <td style={{ ...cell, ...rowCell, ...frame(c++, count), fontWeight: 700, fontSize: "10.5pt" }}>
                {item.product}
              </td>
              {hasBoxes && (
                <td style={{ ...cell, ...rowCell, ...frame(c++, count), fontSize: "9pt", fontWeight: 600, lineHeight: 1.3 }}>
                  {splitLines(item.boxes).map((line, j) => (
                    <BoxLine key={j} line={line} />
                  ))}
                </td>
              )}
              <td style={{ ...cell, ...rowCell, ...frame(c++, count), textAlign: "right" }}>
                <Num>{item.weight}</Num>
              </td>
              <td style={{ ...cell, ...rowCell, ...frame(c++, count), textAlign: "right" }}>
                <Num>{item.price}</Num>
              </td>
              <td style={{ ...cell, ...rowCell, ...frame(c, count), textAlign: "right", fontWeight: 800 }}>
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
function RepeatedSummary({ rows, footer }: { rows: InvoiceA4Summary[]; footer?: ReactNode }) {
  const heads = ["المنتج", "الوزن الكلي (كغ)", "سعر التعادل (دج/كغ)", "المبلغ الكلي (دج)"];
  return (
    // جدول صغير عادةً: يبقى مع عنوانه في صفحة واحدة بدل أن يُشطر صفّه الأخير إلى صفحة تالية.
    <section style={AVOID_BREAK}>
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
            return (
              <tr key={i} style={AVOID_BREAK}>
                <td style={{ ...cell, ...frame(0, 4), fontWeight: 700, fontSize: "10.5pt" }}>
                  {row.product}
                </td>
                <td style={{ ...cell, ...frame(1, 4), textAlign: "right" }}>
                  <Num>{row.totalWeight}</Num>
                </td>
                <td style={{ ...cell, ...frame(2, 4), textAlign: "right" }}>
                  <Num>{row.breakEvenPrice}</Num>
                </td>
                <td style={{ ...cell, ...frame(3, 4), textAlign: "right", fontWeight: 800 }}>
                  <Num>{row.totalAmount}</Num>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer}
    </section>
  );
}

// ─── رقم الفاتورة في صفحات التتمّة ──────────────────────────────────────────
/**
 * تهريب نص ليوضع داخل "..." في CSS دون حذف أي محرف منه: \ و " والسطر الجديد، و< و>
 * (كي لا يُغلق </style> العنصر المحيط). الرقم يظهر كما أُدخل.
 */
function cssString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\A ")
    .replace(/</g, "\\3C ")
    .replace(/>/g, "\\3E ");
}

/**
 * يُكتب في صندوق هامش @page (لا يستهلك مساحة من المحتوى) ويُخفى في الصفحة الأولى لأن
 * ترويستها تحمل الرقم. يُتجاهَل بصمت إن لم يدعم المحرّك صناديق الهوامش (الشرط نفسه
 * لترقيم الصفحات في printCss.ts).
 */
function ContinuationHeader({ number }: { number: string }) {
  if (isBlank(number)) return null;
  const css =
    `@page { @top-center { content: "فاتورة رقم ${cssString(number)} — تتمّة"; ` +
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
  const hasBoxes = items.some((item) => !isBlank(item.boxes));
  const summary = data.repeatedProductSummary ?? [];

  // الخاتمة آخر شيء في الفاتورة: بعد الإجماليات إن لم يوجد ملخّص، وإلا بعد الملخّص.
  const weigherFooter = <WeigherFooter weigher={data.weigher} />;

  return (
    <div style={pageStyle()} lang="ar" dir="rtl">
      <ContinuationHeader number={data.invoiceNumber} />
      <Header data={data} />
      <ItemsTable
        items={items}
        hasBoxes={hasBoxes}
        footer={
          <>
            <Totals data={data} hasBoxes={hasBoxes} />
            {summary.length === 0 && weigherFooter}
          </>
        }
      />
      {summary.length > 0 && <RepeatedSummary rows={summary} footer={weigherFooter} />}
    </div>
  );
}