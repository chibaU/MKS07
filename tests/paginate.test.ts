import test from "node:test";
import assert from "node:assert/strict";
import {
  CHROMIUM_PROFILE,
  CONSERVATIVE_PROFILE,
  PAGE_MM,
  pageProfile,
  planPages,
  type PaginateInput,
  type PagePlan,
} from "../src/print/paginate.ts";

const PROFILE = CONSERVATIVE_PROFILE;
const FOOTER_H = 9.5;

function input(over: Partial<PaginateInput> & { rows?: number; rowH?: number } = {}): PaginateInput {
  const { rows = 5, rowH = 11, ...rest } = over;
  return {
    profile: PROFILE,
    headerH: 52,
    items: { headH: 12, rowsH: Array.from({ length: rows }, () => rowH) },
    totalsH: 32,
    summary: null,
    footerH: FOOTER_H,
    ...rest,
  };
}

/** سعة محتوى الصفحة (mm) كما تحسبها planPages — لفحص أن لا صفحة تتجاوزها. */
function capacity(inp: PaginateInput): number {
  return inp.profile.height - PAGE_MM.top - inp.profile.footerBottom - inp.footerH - PAGE_MM.footerGap - PAGE_MM.safety;
}

/** ارتفاع ما تحمله صفحة بحسب خطتها (يُعيد حساب ما تحسبه planPages). */
function used(inp: PaginateInput, plan: PagePlan, first: boolean): number {
  let y = first ? inp.headerH : 0;
  if (plan.rows) {
    y += inp.items.headH + PAGE_MM.tableSlack;
    for (let i = plan.rows[0]; i < plan.rows[1]; i++) y += inp.items.rowsH[i];
  }
  if (plan.totals) y += inp.totalsH;
  if (plan.summaryTitle && inp.summary) y += inp.summary.titleH;
  if (plan.summaryRows && inp.summary) {
    y += inp.summary.headH + PAGE_MM.tableSlack;
    for (let i = plan.summaryRows[0]; i < plan.summaryRows[1]; i++) y += inp.summary.rowsH[i];
  }
  return y;
}

function flatten(plans: PagePlan[], key: "rows" | "summaryRows"): number[] {
  return plans.flatMap((p) => {
    const r = p[key];
    return r ? Array.from({ length: r[1] - r[0] }, (_, i) => r[0] + i) : [];
  });
}

test("فاتورة قصيرة: صفحة واحدة بكل البنود والإجماليات", () => {
  const plans = planPages(input({ rows: 5 }));
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].rows, [0, 5]);
  assert.equal(plans[0].totals, true);
  assert.equal(plans[0].summaryTitle, false);
  assert.equal(plans[0].summaryRows, null);
});

test("كل بند يظهر مرة واحدة وبالترتيب، ولا صفحة تتجاوز سعتها", () => {
  for (const rows of [1, 9, 17, 18, 19, 20, 25, 40, 60]) {
    const inp = input({ rows });
    const plans = planPages(inp);
    assert.deepEqual(flatten(plans, "rows"), Array.from({ length: rows }, (_, i) => i), `rows=${rows}`);
    assert.equal(plans.filter((p) => p.totals).length, 1, `rows=${rows}`);
    plans.forEach((p, i) => {
      assert.ok(used(inp, p, i === 0) <= capacity(inp) + 1e-6, `rows=${rows} page=${i + 1}`);
    });
  }
});

test("الإجماليات في الصفحة الأخيرة ومعها بند واحد على الأقل", () => {
  for (let rows = 1; rows <= 70; rows++) {
    const plans = planPages(input({ rows }));
    const last = plans[plans.length - 1];
    assert.equal(last.totals, true, `rows=${rows}`);
    assert.ok(last.rows && last.rows[1] > last.rows[0], `rows=${rows}: الإجماليات منفردة`);
  }
});

test("لا يتّسع آخر بند مع الإجماليات: ينتقل البند معها (لا تنفرد الإجماليات)", () => {
  const rowH = 10;
  const base = input({ rows: 1, rowH });
  const cap = capacity(base);
  const fixed = base.headerH + base.items.headH + PAGE_MM.tableSlack;
  const fit = Math.floor((cap - fixed - base.totalsH) / rowH); // أكبر عدد يتّسع مع الإجماليات
  const rows = fit + 1; // بند زائد: يتّسع وحده لكن لا يتّسع مع الإجماليات
  const plans = planPages(input({ rows, rowH }));
  assert.equal(plans.length, 2);
  assert.deepEqual(plans[0].rows, [0, rows - 1]);
  assert.equal(plans[0].totals, false);
  assert.deepEqual(plans[1].rows, [rows - 1, rows]);
  assert.equal(plans[1].totals, true);
});

test("ارتفاع التذييل يُحجَز في كل الصفحات", () => {
  const small = planPages(input({ rows: 60, footerH: 4.5 }));
  const big = planPages(input({ rows: 60, footerH: 20 }));
  const firstRows = (plans: PagePlan[]) => (plans[0].rows ? plans[0].rows[1] - plans[0].rows[0] : 0);
  const secondRows = (plans: PagePlan[]) => (plans[1].rows ? plans[1].rows[1] - plans[1].rows[0] : 0);
  assert.ok(firstRows(big) < firstRows(small), "الصفحة الأولى تحمل بنوداً أقل");
  assert.ok(secondRows(big) < secondRows(small), "الصفحة الثانية تحمل بنوداً أقل");
  const inp = input({ rows: 60, footerH: 20 });
  planPages(inp).forEach((p, i) => assert.ok(used(inp, p, i === 0) <= capacity(inp) + 1e-6, `page=${i + 1}`));
});

test("فاتورة بلا بنود: رأس الجدول وحده ثم الإجماليات", () => {
  const plans = planPages(input({ rows: 0 }));
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].rows, [0, 0]);
  assert.equal(plans[0].totals, true);
});

test("ملخّص المنتجات: العنوان مع أول صف، وكل صف مرة واحدة", () => {
  for (let items = 1; items <= 45; items++) {
    for (const sRows of [1, 2, 6, 14, 40]) {
      const inp = input({
        rows: items,
        summary: { titleH: 12, headH: 9, rowsH: Array.from({ length: sRows }, () => 8) },
      });
      const plans = planPages(inp);
      const tag = `items=${items} summary=${sRows}`;
      assert.deepEqual(flatten(plans, "summaryRows"), Array.from({ length: sRows }, (_, i) => i), tag);
      assert.equal(plans.filter((p) => p.summaryTitle).length, 1, tag);
      for (const p of plans) {
        if (p.summaryTitle) assert.ok(p.summaryRows, `${tag}: العنوان بلا صفوف`);
      }
      // الملخّص بعد الإجماليات دائماً:
      const totalsPage = plans.findIndex((p) => p.totals);
      const titlePage = plans.findIndex((p) => p.summaryTitle);
      assert.ok(titlePage >= totalsPage, tag);
      plans.forEach((p, i) => {
        assert.ok(used(inp, p, i === 0) <= capacity(inp) + 1e-6, `${tag} page=${i + 1}`);
      });
    }
  }
});

test("قطعة أطول من الصفحة تُفرَض ولا تُعلِّق الخوارزمية", () => {
  const plans = planPages(input({ rows: 3, rowH: 400 }));
  assert.deepEqual(flatten(plans, "rows"), [0, 1, 2]);
  assert.ok(plans.length >= 1 && plans.length <= 10);
});

test("ملف الصفحة حسب المحرّك", () => {
  assert.equal(
    pageProfile("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0"),
    CHROMIUM_PROFILE,
  );
  assert.equal(pageProfile("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/139.0.0.0 Safari/537.36"), CHROMIUM_PROFILE);
  assert.equal(
    pageProfile("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"),
    CONSERVATIVE_PROFILE,
  );
  assert.equal(pageProfile(""), CONSERVATIVE_PROFILE);
  // صندوق Chromium لا يتجاوز ورقة A4، والمتحفّظ أقصر منه وعرض محتواه أضيق:
  assert.ok(CHROMIUM_PROFILE.height <= 297);
  assert.ok(CONSERVATIVE_PROFILE.height < CHROMIUM_PROFILE.height);
  assert.equal(CHROMIUM_PROFILE.contentWidth, PAGE_MM.width - 2 * PAGE_MM.side);
  assert.ok(CONSERVATIVE_PROFILE.contentWidth < CHROMIUM_PROFILE.contentWidth);
  // WebKitGTK يرتّب الصفحة بارتفاع ≈279mm (قياس حقيقي): الصندوق المتحفّظ يجب أن يبقى تحته بهامش:
  assert.ok(CONSERVATIVE_PROFILE.height <= 279 - 3);
});
