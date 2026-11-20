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
//   4) تذييل كل صفحة بخط صغير في ثلاثة أماكن: يمين = رقم الفاتورة، وسط = «ميزان (اسم الوزّان)» ثم
//      «للاتصال (الهاتف / الهاتف)» (يُحذف سطر الهاتف إن لم يوجد، ولا يُرسَم شيء إن لم يوجد اسم ولا
//      هاتف)، يسار = «صفحة x من y». لا بيانات وزّان في أعلى الفاتورة، ولا عنوان للوزّان (عنوانه
//      هو اسم السوق).
//
// البيانات جاهزة التنسيق (مخرجات buildPayload في services/print.ts + بيانات الوزّان):
// لا يُعاد هنا حساب أي مجموع ولا تنسيق أي مبلغ، ولا يُعدَّل أي نص أدخله المستخدم (أسماء
// وعناوين وهواتف ومنتجات): تُعرَض كما وصلت. الاستثناءان الوحيدان: تحويل التاريخ
// YYYY-MM-DD إلى DD/MM/YYYY، وطباعة «/» مكان أي حقل تاجر/تاريخ غير مُدرَج (انظر MISSING).
// لا شيء يُفشل الطباعة.
//
// الصفحات: لا نترك كسر الصفحات للمتصفح — تُقاس ارتفاعات الكتل في DOM مخفيّ ثم تُوزَّع بدالة
// بحتة (paginate.ts) على صفحات صناديق بارتفاع ثابت. كل صفحة تحمل في أسفلها «رقم الفاتورة»
// وبيانات الوزّان و«صفحة x من y» كنص عادي، فتظهر في كل المحركات (WebKitGTK لا يدعم
// صناديق هوامش @page). رأس الجدول يتكرر في كل صفحة، والإجماليات تلازم آخر
// بند فلا تنفرد بصفحة. الهوامش كلها داخل صندوق الصفحة (و@page بلا هوامش، انظر printCss.ts).
// ============================================================================

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import type { WeigherInfo } from "../weigher.ts";
import { PAGE_MM, pageProfile, planPages, type PagePlan, type PageProfile, type PaginateInput } from "../paginate.ts";

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

/** غلاف يمنع انهيار الهوامش فيدخل هامش الابن في ارتفاع الغلاف المقيس. */
const FLOW_ROOT: CSSProperties = { display: "flow-root" };

/** الفراغ بين جدول البنود وصندوق الإجماليات. */
const TOTALS_GAP = "3.5mm";

/**
 * ارتفاع سطر التذييل بوحدة مطلقة (لا نسبة): سطرا الوزّان بُعدهما ثابت ولا يتأثر بحسابات الخط في
 * المحرك. ظهر في WebKitGTK بعد اعتماد رقم نسبي (1.5) فراغٌ بحجم سطر بين اسم الوزّان وهاتفه.
 */
const FOOTER_LINE = "4.75mm";

// السطر الأول من الفاتورة: اسم السوق (ثابت). غيّره هنا إن لزم.
const MARKET_TITLE = "سوق الجملة للخضر والفواكه ببلدية الغروس";
// اسم السوق: عند 26pt يبلغ الاسم 179.7mm، ويتّسع في Chromium (186mm) لكنه التفّ في WebKitGTK
// (عرض المحتوى فيه 173.3mm، انظر paginate.ts) فنزل «الغروس» لسطر ثانٍ. عند 24pt يبلغ 165.9mm
// فيتّسع في المحرّكين؛ فإن طال الاسم فصغّر هذه القيمة.
const MARKET_TITLE_PT = 24;
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
    // احتياط: لو التفّ الاسم لسبب ما تتوازن السطور بدل أن ينفرد «الغروس» بسطر.
    textWrap: "balance",
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
  // — بيانات الوزّان في التذييل: ميزان (الاسم) / للاتصال (الهاتف) — صغيرة ومتوسطة الوزن كي لا تزعج —
  weigherFooter: {
    textAlign: "center",
    fontSize: "9pt",
    fontWeight: 600,
    lineHeight: FOOTER_LINE,
  },
  summaryTitle: {
    fontSize: "11.5pt",
    fontWeight: 800,
    marginTop: "6mm",
    marginBottom: "2mm",
  },
  // — الصفحات: صندوق بارتفاع ثابت (ملف المحرّك في paginate.ts) والتذييل مثبَّت في أسفله —
  // يُفصَل بين الصفحات بكسر صريح؛ الأخيرة بلا كسر فلا تُطبع صفحة فارغة بعدها.
  pageBreak: { breakAfter: "page", pageBreakAfter: "always" },
  // التذييل جدول من ثلاث خانات: رقم الفاتورة (يمين) | الوزّان (وسط) | رقم الصفحة (يسار). الوسط ضعف
  // الجانبين فيبقى مركز الصفحة مركزَه ويلتفّ اسم طويل داخله. جدول (لا grid) وعرض أعمدته ثابت
  // لأن تخطيطه أثبت المحركات، والمحاذاة للأعلى فيقع رقم الفاتورة ورقم الصفحة على سطر اسم الوزّان.
  footerTable: {
    width: "100%",
    tableLayout: "fixed",
    borderCollapse: "collapse",
    fontSize: "8.5pt",
    fontWeight: 600,
    lineHeight: FOOTER_LINE,
  },
  footerCell: { padding: 0, verticalAlign: "top" },
  // بيانات الوزّان في الوضع الاحتياطي (تدفّق بلا صفحات): بعد آخر المحتوى.
  weigherInFlow: { marginTop: "9mm" },
  // نسخة مخفية خارج الشاشة بعرض محتوى الصفحة نفسه تُقاس منها ارتفاعات الكتل (لا تُطبع أبداً:
  // مخفية على الشاشة، ويُخفي printCss.ts كل ما هو خارج #root وقت الطباعة).
  measureHost: {
    position: "fixed",
    top: 0,
    left: "-10000px",
    visibility: "hidden",
    pointerEvents: "none",
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
 * (يسار) بخط واحد ← خط رفيع. لا بيانات وزّان هنا: مكانها تذييل كل صفحة (PageFooter).
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
 * خاتمة الوزّان (مرة واحدة، في المنتصف بخط صغير):
 *   ميزان (اسم الوزّان)
 *   للاتصال (هاتف) / (هاتف)
 * سطر الهاتف يُحذف إن لم يوجد هاتف، ولا يُرسَم شيء إن لم يوجد اسم ولا هاتف. تُرسَم في وسط تذييل
 * كل صفحة (خارج تدفّق المحتوى) فلا تنفرد بصفحة ولا تُلصَق بكتلة تُحدث فراغاً — وهي نص عادي لا
 * صندوق هامش @page، فتظهر في كل المحركات.
 */
function WeigherFooter({ weigher, style }: { weigher: WeigherInfo; style?: CSSProperties }) {
  const phones = [weigher.phone1, weigher.phone2].filter((p) => !isBlank(p));
  const hasName = !isBlank(weigher.name);
  if (!hasName && phones.length === 0) return null;
  return (
    <div style={{ ...s.weigherFooter, ...style }}>
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
    </div>
  );
}

// ─── جدول البنود ────────────────────────────────────────────────────────────
/**
 * جدول البنود (أو جزء منه في صفحة): `start` ترتيب أول بند في `items` ضمن الفاتورة كلها، فيبقى
 * الترقيم (#) والتظليل متصلَين عبر الصفحات. `marker` يضع وسماً يقرؤه القياس.
 */
function ItemsTable({
  items,
  start,
  hasBoxes,
  marker,
}: {
  items: InvoiceA4Item[];
  start: number;
  hasBoxes: boolean;
  marker?: string;
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
    <table style={s.table} data-m={marker}>
      <colgroup>
        {heads.map((h, i) => (
          <col key={i} style={h.width ? { width: h.width } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {heads.map((h, i) => (
            <th key={i} style={{ ...headCell, ...frame(i, count) }}>
              {h.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item, k) => {
          const n = start + k;
          // الصف الأول أبيض (فوقه رأس الجدول الرمادي) والثاني رمادي فاتح جداً وهكذا.
          const rowCell: CSSProperties = n % 2 === 1 ? { backgroundColor: ZEBRA } : {};
          let c = 0;
          return (
            <tr key={n}>
              <td style={{ ...cell, ...rowCell, ...frame(c++, count), textAlign: "center", fontWeight: 600 }}>
                <Num>{n + 1}</Num>
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

/** الإجماليات مع الفراغ الذي فوقها (يُقاس معها كقطعة واحدة). */
function TotalsBlock({ data, hasBoxes, marker }: { data: InvoiceA4Data; hasBoxes: boolean; marker?: string }) {
  return (
    <div style={{ ...FLOW_ROOT, paddingTop: TOTALS_GAP }} data-m={marker}>
      <Totals data={data} hasBoxes={hasBoxes} />
    </div>
  );
}

// ─── الملخّص الاختياري ──────────────────────────────────────────────────────
function SummaryTitle({ marker }: { marker?: string }) {
  return (
    <div style={FLOW_ROOT} data-m={marker}>
      <div style={s.summaryTitle}>ملخّص المنتجات المتكررة</div>
    </div>
  );
}

function SummaryTable({ rows, marker }: { rows: InvoiceA4Summary[]; marker?: string }) {
  const heads = ["المنتج", "الوزن الكلي (كغ)", "سعر التعادل (دج/كغ)", "المبلغ الكلي (دج)"];
  return (
    <table style={s.table} data-m={marker}>
      <colgroup>
        <col />
        <col style={{ width: "32mm" }} />
        <col style={{ width: "38mm" }} />
        <col style={{ width: "36mm" }} />
      </colgroup>
      <thead>
        <tr>
          {heads.map((h, i) => (
            <th key={i} style={{ ...headCell, ...frame(i, heads.length) }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td style={{ ...cell, ...frame(0, 4), fontWeight: 700, fontSize: "10.5pt" }}>{row.product}</td>
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
        ))}
      </tbody>
    </table>
  );
}

// ─── تذييل الصفحة ───────────────────────────────────────────────────────────
/**
 * أسفل كل صفحة بخط صغير: رقم الفاتورة (يمين) | ميزان واسمه وهاتفه (وسط) | «صفحة x من y» (يسار)،
 * كي لا تختلط أوراق فاتورتين ويُعرَف الوزّان من أي ورقة. الفارغ لا يُرسَم (رقم فاتورة فارغ أو
 * وزّان بلا اسم ولا هاتف) ويبقى مكانه محفوظاً فلا تتحرك بقية الخانات.
 */
function PageFooter({
  data,
  page,
  total,
  marker,
}: {
  data: InvoiceA4Data;
  page: number;
  total: number;
  marker?: string;
}) {
  return (
    <table style={s.footerTable} data-m={marker}>
      <colgroup>
        <col style={{ width: "25%" }} />
        <col style={{ width: "50%" }} />
        <col style={{ width: "25%" }} />
      </colgroup>
      <tbody>
        <tr>
          <td style={{ ...s.footerCell, textAlign: "start" }}>
            {!isBlank(data.invoiceNumber) && (
              <>
                رقم الفاتورة: <span style={s.numWrap}>{data.invoiceNumber}</span>
              </>
            )}
          </td>
          <td style={s.footerCell}>
            <WeigherFooter weigher={data.weigher} />
          </td>
          <td style={{ ...s.footerCell, textAlign: "end" }}>
            صفحة <Num>{page}</Num> من <Num>{total}</Num>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** صندوق الصفحة وتذييلها حسب ملف المحرّك (انظر pageProfile في paginate.ts). */
function pageBoxStyle(profile: PageProfile): CSSProperties {
  return {
    position: "relative",
    boxSizing: "border-box",
    height: `${profile.height}mm`,
    padding: `${PAGE_MM.top}mm ${PAGE_MM.side}mm 0`,
  };
}

function footerZoneStyle(profile: PageProfile): CSSProperties {
  return {
    position: "absolute",
    left: `${PAGE_MM.side}mm`,
    right: `${PAGE_MM.side}mm`,
    bottom: `${profile.footerBottom}mm`,
  };
}

// ─── القياس والتقسيم ────────────────────────────────────────────────────────
const MM_PER_PX = 25.4 / 96;

/** ارتفاعات رأس جدول وصفوفه (mm) من مواضع الصفوف: مجموعها يساوي ارتفاع الجدول تماماً. */
function measureTable(table: Element | null): { headH: number; rowsH: number[] } | null {
  const head = table?.querySelector("thead tr");
  if (!table || !head) return null;
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  const tableRect = table.getBoundingClientRect();
  const headRect = head.getBoundingClientRect();
  const tops = rows.map((row) => row.getBoundingClientRect().top);
  const headPx = tops.length > 0 ? tops[0] - headRect.top : headRect.height;
  const rowsPx = tops.map((top, i) => (i + 1 < tops.length ? tops[i + 1] : tableRect.bottom) - top);
  return { headH: headPx * MM_PER_PX, rowsH: rowsPx.map((px) => px * MM_PER_PX) };
}

/**
 * يقيس الكتل في النسخة المخفية. null إن لم يكن التخطيط محسوباً (عنصر مخفي بـdisplay:none، أو
 * قيم صفرية) — عندئذ تُعرَض الفاتورة في الوضع الاحتياطي بلا ترقيم بدل أن تُقسَّم على أرقام خاطئة.
 */
function measureLayout(root: HTMLElement, hasSummary: boolean, profile: PageProfile): PaginateInput | null {
  if (root.getBoundingClientRect().width <= 0) return null;
  const height = (marker: string): number => {
    const el = root.querySelector(`[data-m="${marker}"]`);
    return el ? el.getBoundingClientRect().height * MM_PER_PX : 0;
  };
  const items = measureTable(root.querySelector('[data-m="items"]'));
  const summary = hasSummary ? measureTable(root.querySelector('[data-m="summary"]')) : null;
  const headerH = height("header");
  const totalsH = height("totals");
  const footerH = height("footer");
  const titleH = height("summary-title");

  if (!items || items.headH <= 0 || items.rowsH.some((h) => !(h > 0))) return null;
  if (hasSummary && (!summary || summary.headH <= 0 || summary.rowsH.some((h) => !(h > 0)) || titleH <= 0)) {
    return null;
  }
  if (!(headerH > 0) || !(totalsH > 0) || !(footerH > 0)) return null;

  return {
    profile,
    headerH,
    items,
    totalsH,
    summary: summary ? { titleH, headH: summary.headH, rowsH: summary.rowsH } : null,
    footerH,
  };
}

// ─── المستند ────────────────────────────────────────────────────────────────
function Pages({
  data,
  items,
  summary,
  hasBoxes,
  plan,
  profile,
}: {
  data: InvoiceA4Data;
  items: InvoiceA4Item[];
  summary: InvoiceA4Summary[];
  hasBoxes: boolean;
  plan: PagePlan[];
  profile: PageProfile;
}) {
  return (
    <div style={s.page} lang="ar" dir="rtl">
      {plan.map((p, i) => {
        const last = i === plan.length - 1;
        return (
          <section key={i} data-page={i + 1} style={{ ...pageBoxStyle(profile), ...(last ? null : s.pageBreak) }}>
            {i === 0 && (
              <div style={FLOW_ROOT}>
                <Header data={data} />
              </div>
            )}
            {p.rows && (
              <ItemsTable items={items.slice(p.rows[0], p.rows[1])} start={p.rows[0]} hasBoxes={hasBoxes} />
            )}
            {p.totals && <TotalsBlock data={data} hasBoxes={hasBoxes} />}
            {p.summaryTitle && <SummaryTitle />}
            {p.summaryRows && <SummaryTable rows={summary.slice(p.summaryRows[0], p.summaryRows[1])} />}
            <div style={footerZoneStyle(profile)}>
              <PageFooter data={data} page={i + 1} total={plan.length} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * الوضع الاحتياطي (لا قياس: خادم/اختبار، أو تعذّر القياس): كل المحتوى في تدفّق واحد وكسر
 * الصفحات للمتصفح. بلا ترقيم ولا تذييل، لكن لا يضيع شيء من الفاتورة.
 */
function FlowSheet({
  data,
  items,
  summary,
  hasBoxes,
}: {
  data: InvoiceA4Data;
  items: InvoiceA4Item[];
  summary: InvoiceA4Summary[];
  hasBoxes: boolean;
}) {
  return (
    <div style={{ ...s.page, padding: `${PAGE_MM.top}mm ${PAGE_MM.side}mm 0` }} lang="ar" dir="rtl">
      <Header data={data} />
      <ItemsTable items={items} start={0} hasBoxes={hasBoxes} />
      <TotalsBlock data={data} hasBoxes={hasBoxes} />
      {summary.length > 0 && (
        <>
          <SummaryTitle />
          <SummaryTable rows={summary} />
        </>
      )}
      <WeigherFooter weigher={data.weigher} style={s.weigherInFlow} />
    </div>
  );
}

export function InvoiceA4({ data }: { data: InvoiceA4Data }) {
  const items = data.items ?? [];
  const summary = data.repeatedProductSummary ?? [];
  const hasBoxes = items.some((item) => !isBlank(item.boxes));
  const hasSummary = summary.length > 0;
  const profile = pageProfile(typeof navigator === "undefined" ? "" : navigator.userAgent);

  // الخطة تُحفَظ مع البيانات التي حُسبت لها: تغيّرت البيانات ولم تُحسَب الجديدة بعد ← الوضع الاحتياطي.
  const [state, setState] = useState<{ data: InvoiceA4Data; plan: PagePlan[] } | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const canMeasure = typeof document !== "undefined";

  // يقيس قبل الرسم الأول (فلا تظهر صفحة غير مقسَّمة)؛ ثم يعيد القياس إن كانت الخطوط ما زالت
  // تُحمَّل وقت القياس الأول (ارتفاعات خط بديل خاطئة). flushSync كي يكتمل الرسم قبل الطباعة.
  useLayoutEffect(() => {
    let alive = true;
    const run = () => {
      const root = measureRef.current;
      const input = root ? measureLayout(root, hasSummary, profile) : null;
      const plan = input ? planPages(input) : null;
      setState((prev) => {
        if (!plan) return null;
        if (prev && prev.data === data && JSON.stringify(prev.plan) === JSON.stringify(plan)) return prev;
        return { data, plan };
      });
    };
    run();
    if (document.fonts && document.fonts.status !== "loaded") {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2500));
      void Promise.race([document.fonts.ready, timeout]).then(() => {
        if (alive) flushSync(run);
      });
    }
    return () => {
      alive = false;
    };
  }, [data, hasSummary, profile]);

  const plan = state && state.data === data ? state.plan : null;

  return (
    <>
      {plan ? (
        <Pages data={data} items={items} summary={summary} hasBoxes={hasBoxes} plan={plan} profile={profile} />
      ) : (
        <FlowSheet data={data} items={items} summary={summary} hasBoxes={hasBoxes} />
      )}
      {canMeasure &&
        createPortal(
          <div
            ref={measureRef}
            style={{ ...s.page, ...s.measureHost, width: `${profile.contentWidth}mm` }}
            aria-hidden="true"
            lang="ar"
            dir="rtl"
          >
            <div style={FLOW_ROOT} data-m="header">
              <Header data={data} />
            </div>
            <ItemsTable items={items} start={0} hasBoxes={hasBoxes} marker="items" />
            <TotalsBlock data={data} hasBoxes={hasBoxes} marker="totals" />
            {hasSummary && (
              <>
                <SummaryTitle marker="summary-title" />
                <SummaryTable rows={summary} marker="summary" />
              </>
            )}
            <PageFooter data={data} page={1} total={1} marker="footer" />
          </div>,
          document.body,
        )}
    </>
  );
}
