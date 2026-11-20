// ============================================================================
// تقسيم الفاتورة إلى صفحات A4 — دوال بحتة (بلا React ولا DOM) فتُختبَر بـnode مباشرة
// (tests/paginate.test.ts). القياس الفعلي للارتفاعات في InvoiceA4.tsx.
//
// لماذا نقسّم بأنفسنا ولا نترك المتصفح؟ لأن ترقيم الصفحات وتذييلها يحتاجان صناديق هوامش
// @page (@bottom-center…)، وهذه لا يدعمها WebKit (WebKitGTK على لينكس، WKWebView على ماك)
// وتحتاج Chromium 131+ على ويندوز؛ وكسر الصفحات الأصلي يتصرّف باختلاف بين المحركات (الإجماليات
// تنفرد بصفحة، فراغات في آخر الصفحة…). هنا كل صفحة صندوق بارتفاع ثابت يُرسَم فيه التذييل
// (رقم الفاتورة والوزّان ورقم الصفحة) كنص عادي، فتخرج الصفحات متطابقة في كل المحركات.
//
// القواعد:
//  - صفوف البنود تتوزّع بالترتيب بلا انقسام، وآخر بند يلازم الإجماليات (لا تنفرد صفحة بالإجماليات).
//  - عنوان ملخّص المنتجات المتكررة يلازم أول صف منه؛ ورأس كل جدول يتكرر في كل صفحة يظهر فيها.
//  - التذييل (رقم الفاتورة | الوزّان | رقم الصفحة) يُرسَم في أسفل كل صفحة خارج التدفّق، فيُحجَز
//    ارتفاعه في كل الصفحات سواء. بيانات الوزّان لا تُلصَق بالإجماليات: كانت كتلة بلا انقسام
//    بطول ~50mm لا تتّسع فتُترَك الصفحة الأولى نصف فارغة.
// ============================================================================

/** هندسة الصفحة بالمليمتر المشتركة بين المحركات — مصدر الحقيقة الوحيد (InvoiceA4.tsx يقرأ منها). */
export const PAGE_MM = {
  /** عرض ورقة A4؛ المحتوى يشغل العرض كله ناقص الهامشين الجانبيين. */
  width: 210,
  top: 10,
  side: 12,
  /** أدنى فراغ بين آخر المحتوى والتذييل. */
  footerGap: 2.5,
  /** هامش أمان لفروق القياس بين الشاشة والطباعة (التفاف سطر، تقريب بكسل…). */
  safety: 1.5,
  /** زيادة تُضاف لكل جدول عند الجمع (حدود الجداول المدموجة). */
  tableSlack: 0.3,
} as const;

/**
 * هندسة الصفحة حسب المحرّك: ارتفاع صندوق الصفحة، وبُعد التذييل عن أسفله، وعرض المحتوى (للقياس).
 *
 *  - Chromium (WebView2 على ويندوز): يطبع على ورقة A4 كاملة (210×297) بهوامش طباعة صفرية من
 *    Rust؛ والطابعة تقصّ المنطقة غير القابلة للطباعة (~4–5mm). الصندوق 296mm (هامش mm واحد ضد
 *    التقريب فلا تُطبع صفحة فارغة بعد كل صفحة) والتذييل 8mm فوق حافته.
 *  - غيره (WebKitGTK على لينكس…): قِيس على طباعة حقيقية إلى PDF أن WebKitGTK يرتّب الصفحة
 *    بعرض ≈197.3mm وارتفاع ≈279mm (CSS) — أي A4 ناقص هوامش GTK الافتراضية 0.25in — ثم يكبّرها
 *    ≈6.4% لتملأ الورقة. فصندوق 282mm تجاوز الصفحة (خرج التذييل مقصوصاً وطُبعت صفحة فارغة)،
 *    والعنوان 26pt (179.7mm) لم يتّسع في 173.3mm فالتفّ. لذلك: الصندوق 274mm (هامش ~5mm تحت
 *    279mm) وعرض المحتوى 173.3mm. لو بدّل المستخدم الهوامش في حوار الطباعة تغيّرت هذه الأرقام.
 *    لو خرج التذييل مقصوصاً أو طُبعت صفحة فارغة في طابعة معيّنة فصغّر `height` هنا.
 */
export interface PageProfile {
  height: number;
  footerBottom: number;
  /** عرض منطقة المحتوى (بين الهامشين الجانبيين) الذي تُقاس عليه الارتفاعات. */
  contentWidth: number;
}

export const CHROMIUM_PROFILE: PageProfile = {
  height: 296,
  footerBottom: 8,
  contentWidth: PAGE_MM.width - 2 * PAGE_MM.side,
};
const WEBKITGTK_LAYOUT_WIDTH_MM = 197.3;
export const CONSERVATIVE_PROFILE: PageProfile = {
  height: 274,
  footerBottom: 3,
  contentWidth: WEBKITGTK_LAYOUT_WIDTH_MM - 2 * PAGE_MM.side,
};

/** Chromium/Edge (بما فيها HeadlessChrome) ← ملف Chromium؛ وأي شيء آخر أو مجهول ← المتحفّظ. */
export function pageProfile(userAgent: string): PageProfile {
  return /Chrome\/|Chromium\/|Edg\//.test(userAgent) ? CHROMIUM_PROFILE : CONSERVATIVE_PROFILE;
}

/** ارتفاعات (mm) مقيسة من DOM. */
export interface PaginateInput {
  profile: PageProfile;
  /** ترويسة الصفحة الأولى (اسم السوق + التاجر + رقم الفاتورة) بما فيها هوامشها. */
  headerH: number;
  items: { headH: number; rowsH: number[] };
  /** صندوق الإجماليات بما فيه الفراغ الذي فوقه. */
  totalsH: number;
  summary: null | { titleH: number; headH: number; rowsH: number[] };
  /** التذييل في أسفل كل صفحة (رقم الفاتورة | الوزّان | رقم الصفحة)؛ يُحجَز في كل الصفحات. */
  footerH: number;
}

export interface PagePlan {
  /** [من، إلى) من البنود؛ [0,0] = جدول بلا صفوف (فاتورة بلا بنود)؛ null = لا جدول بنود في هذه الصفحة. */
  rows: readonly [number, number] | null;
  totals: boolean;
  summaryTitle: boolean;
  summaryRows: readonly [number, number] | null;
}

type TableId = "items" | "summary";

interface Piece {
  kind: "row" | "items-empty" | "totals" | "summary-title" | "summary-row";
  index: number;
  h: number;
  table: TableId | null;
  /** لا تنتهِ الصفحة بعد هذه القطعة: تلازم التي بعدها. */
  keepNext: boolean;
}

function buildPieces(input: PaginateInput): Piece[] {
  const pieces: Piece[] = [];
  const { rowsH } = input.items;

  if (rowsH.length === 0) {
    // فاتورة بلا بنود: يُرسَم رأس الجدول وحده ثم الإجماليات.
    pieces.push({ kind: "items-empty", index: 0, h: 0, table: "items", keepNext: true });
  }
  rowsH.forEach((h, index) => {
    pieces.push({ kind: "row", index, h, table: "items", keepNext: index === rowsH.length - 1 });
  });

  pieces.push({ kind: "totals", index: 0, h: input.totalsH, table: null, keepNext: false });

  if (input.summary) {
    pieces.push({ kind: "summary-title", index: 0, h: input.summary.titleH, table: null, keepNext: true });
    input.summary.rowsH.forEach((h, index) => {
      pieces.push({ kind: "summary-row", index, h, table: "summary", keepNext: false });
    });
  }
  return pieces;
}

const EPS = 1e-6;

export function planPages(input: PaginateInput): PagePlan[] {
  const pieces = buildPieces(input);
  const n = pieces.length;
  const headH: Record<TableId, number> = {
    items: input.items.headH + PAGE_MM.tableSlack,
    summary: (input.summary?.headH ?? 0) + PAGE_MM.tableSlack,
  };

  const capNormal =
    input.profile.height -
    PAGE_MM.top -
    input.profile.footerBottom -
    input.footerH -
    PAGE_MM.footerGap -
    PAGE_MM.safety;

  /** كلفة قطعة في صفحة: ارتفاعها + رأس جدولها إن كانت أول قطعة من ذلك الجدول في الصفحة. */
  const cost = (piece: Piece, prev: TableId | null): number =>
    piece.h + (piece.table !== null && piece.table !== prev ? headH[piece.table] : 0);

  /** أبعد نقطة نهاية (حصرية) تتّسع من start في صفحة سعتها cap وقد استُهلك منها base. */
  const fill = (start: number, base: number, cap: number): number => {
    let y = base;
    let prev: TableId | null = null;
    let end = start;
    while (end < n) {
      const c = cost(pieces[end], prev);
      if (y + c > cap + EPS) break;
      y += c;
      prev = pieces[end].table;
      end++;
    }
    return end;
  };

  const ranges: Array<[number, number]> = [];
  let start = 0;
  while (start < n) {
    const base = ranges.length === 0 ? input.headerH : 0;
    let end = fill(start, base, capNormal);
    if (end < n) {
      // لا تنتهِ الصفحة بقطعة تلازم التالية.
      while (end > start && pieces[end - 1].keepNext) end--;
      // لم يتّسع شيء (قطعة أطول من الصفحة، أو سلسلة ملازمة أطول منها): فرضٌ كي لا نتوقف.
      if (end === start) {
        end = start + 1;
        while (end < n && pieces[end - 1].keepNext) end++;
      }
    }
    ranges.push([start, end]);
    start = end;
  }

  return ranges.map(([from, to]) => toPlan(pieces.slice(from, to)));
}

function toPlan(slice: Piece[]): PagePlan {
  const rows = slice.filter((p) => p.kind === "row");
  const hasEmpty = slice.some((p) => p.kind === "items-empty");
  const summaryRows = slice.filter((p) => p.kind === "summary-row");
  return {
    rows: rows.length > 0 ? [rows[0].index, rows[rows.length - 1].index + 1] : hasEmpty ? [0, 0] : null,
    totals: slice.some((p) => p.kind === "totals"),
    summaryTitle: slice.some((p) => p.kind === "summary-title"),
    summaryRows:
      summaryRows.length > 0
        ? [summaryRows[0].index, summaryRows[summaryRows.length - 1].index + 1]
        : null,
  };
}
