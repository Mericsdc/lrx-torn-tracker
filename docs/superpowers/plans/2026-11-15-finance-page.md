# Finance Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Networth and Income Statement pages with one Finance page (Networth tab + Company tab) that shows
more detail from data the app already has.

**Architecture:** Pure calculations live in a UMD module `public/finance-math.js` (unit-tested with vitest). The view,
tab cards and both tabs' HTML live in `public/finance.js`, loaded after `features.js`, reusing the app's helpers
(`tr`, `money`, `cmoney`, `pct`, `kpi`, `signed`, `deltaCls`, `lineChart`, `mountChart`, `incomeChart`, `PALETTE`).
`app.js` / `features.js` / `index.html` only lose the two old pages and gain small hooks.

**Tech Stack:** Vanilla JS in the browser (Electron renderer), Node test runner, vitest, Playwright smokes.

**Spec:** `docs/superpowers/specs/2026-11-15-finance-page-design.md`

## Global Constraints

- English default; every string a TR/EN pair through `tr()` or `I18N` keys.
- New switch `finance.milestone` in `FEATURE_DEFS` (parent `page.networth`, default on) and in the catalog `legacy` list.
- Inline SVGs reset `stroke`, `fill`, `width`, `height` (global 17 px icon rule in `styles.css`).
- No new Torn requests; no server change.
- Shared files: re-read right before each edit, touch only Finance / Networth / Income code; sidebar: only the Income
  and Networth items.
- No commits (owner's instruction). Copy changed files to `D:\Meric\TORN\LRX-Torn-Tracker-TEST\resources\app` and `cmp`.

## Review Focus

1. Networth history with gaps (app not run every day): periods, previous period, best/worst must use dates, not
   record counts — pinned in Task 1 (`gappy history` tests).
2. A brand-new user with 0 or 1 networth record / 0 or 1 company day: every card shows an empty state, never `NaN`,
   `Infinity` or `undefined` — Task 1 (`single record` tests) and Task 2 (`assertClean` with a one-record fixture).
3. Company mode switching off while the Company tab is open (and `page.networth` off at the same time) — Task 2
   (falls back to Networth, then to Overview).
4. Unknown networth parts Torn may add, and negative parts (loan, unpaid fees) — Task 1 (`nwGroups` puts unknown
   numeric keys in `other`, keeps sign).
5. Revenue of 0 or COGS ≥ revenue (break-even undefined) — Task 1 (`breakEven` returns null).

---

### Task 1: `finance-math.js` (pure calculations)

**Files:**
- Create: `public/finance-math.js` (UMD: `module.exports` in Node, `window.LRXFinanceMath` in the browser)
- Test: `tests/unit/finance-math.test.mjs`

**Interfaces — Produces** (all records are `{ date: 'YYYY-MM-DD', ... }`, sorted oldest first):
- `NW_GROUPS: [['cash', [...]], ['market', [...]], ['invest', [...]], ['other', [...]]]` with the spec's part lists.
- `NW_TRIGGERS = [5e6, 5e7, 5e8, 5e9, 5e10]`
- `periodStart(hist, days) -> record | null` — `days === 1`: the record dated exactly one day before the last;
  otherwise the oldest record dated ≥ last − days that is not the last; `days >= 365` behaves the same (1Y).
- `nwChange(hist, total, days) -> { start, change, pct, perDay, covered } | null` — `covered` = days between start
  and last record; `perDay = change / covered`.
- `nwPrevChange(hist, days) -> number | null` — change over the same-length window ending at `periodStart(hist, days)`;
  `null` for `days >= 365` or when no record reaches back.
- `nwGroups(current, start) -> [{ key, total, change, parts: [{ key, value, change }] }]` — parts shown when
  `value !== 0 || change` (non-zero); `change` is `null` without `start`; unknown numeric keys (not `total`, `at`,
  `date`, `parsetime`, `timestamp`) go to `other`; parts sorted by `|value|` desc.
- `nwMovers(current, start, limit = 5) -> [{ key, change }]` — non-zero changes by `|change|` desc.
- `recordChanges(hist) -> [{ date, total, change, mover: { key, change } | null }]` — one per record after the first.
- `nwStats(hist, start) -> { best, worst, up, count }` over `recordChanges` dated after `start.date`;
  `best` / `worst` are `{ date, change } | null`.
- `nextMilestone(total, perDay) -> { done: true } | { target, from, progress, days }` — `days` null when
  `perDay <= 0`.
- `coWindow(days, n) -> rows` (records with date > lastDate − n; `n = Infinity` → all) and
  `coPrevWindow(days, n) -> rows` (the n days before that; `[]` for `Infinity`).
- `coTotals(rows) -> { days, revenue, cogs, gross, wages, ads, net, customers, estimated }`
- `pctChange(now, before) -> number | null`
- `breakEven(totals) -> { perDay, avgRevenue, gap } | null`
- `productSeries(days, name, n = 30) -> [{ date, v }]` (only days that have that product's record)
- `chartDays(days, n) -> rows` — window of `clamp(n, 7, 90)` days (`1 → 7`, `Infinity → 90`).

- [ ] **Step 1: Write the failing tests** — `describe` blocks per function with fixed numbers, including:
  `periodStart` exact-1D vs window semantics; `gappy history` (records on days 1, 2, 9, 30 of a month);
  `single record` (every function returns null / empty without throwing); `nwGroups` unknown key `newthing: 7`
  lands in `other`, `loan: -500` keeps its sign, zero parts with zero change are dropped; `nwPrevChange(...,365)`
  is null; `nextMilestone(2.61e9, 8.8e6)` → target 5e9, from 5e8, progress ≈ 0.4689, days 272;
  `nextMilestone(6e10, 1)` → done; `breakEven({ days: 7, revenue: 14.3e6, cogs: 6.006e6, wages: 3.15e6, ads: 5.6e6 })`
  → perDay ≈ 2.155e6; `breakEven` with revenue 0 → null; `coWindow` 7 / 1 / Infinity; `chartDays` clamps.
- [ ] **Step 2: Run** `npx vitest run tests/unit/finance-math.test.mjs` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `public/finance-math.js` with the interfaces above (dates via `Date.parse(d + 'T00:00:00Z')`).
- [ ] **Step 4: Run** the same command — Expected: PASS. Then `npm run check` — Expected: syntax OK.

### Task 2: Finance view (`finance.js`, HTML, CSS, hooks) driven by a UI smoke

**Files:**
- Create: `public/finance.js`, `tests/finance-ui-smoke.js`, `tests/finance-fixture.js`
- Modify: `public/index.html` (nav item `income` → `finance`, remove `networth` item; replace `#view-income` and
  `#view-networth` with `<section class="view" id="view-finance"><div class="stack fin" id="finance-body"></div></section>`;
  add `/finance-math.js` and `/finance.js` scripts after `/features.js`)
- Modify: `public/app.js` (drop `'income'` from `COMPANY_VIEWS`; `renderCompany()` calls `window.renderFinanceCompany?.()`
  instead of `renderIncome(c)`; remove `renderIncome`, `incomeChartDays`, `renderIncomeChart`, its ResizeObserver, the
  `nav.income` / `inc.*` I18N keys and `VIEW_META.income`; `showView(v)` resolves `networth` / `income` through
  `window.LRXFinance?.alias(v)`; the start-up hash accepts aliases; `applyCompanyMode()` calls `window.syncFinance?.()`)
- Modify: `public/features.js` (remove `NW_PARTS`, `loadNetworth`, `renderNetworth`, `nav.networth`,
  `VIEW_META.networth`, `EXTRA_VIEWS.networth`; `EXTRA_LOADERS.finance = loadFinance`; `viewHidden('finance')` =
  neither tab available; `applyNavVisibility` includes `finance`; relabel `page.networth` / `page.company`; add
  `finance.milestone`)
- Modify: `public/feature-catalog.js` (`finance.milestone` after `page.networth` in `legacy`)
- Modify: `public/styles.css` (replace the `/* Networth */` block with a `/* Finance */` block; drop `.pnl*`,
  `.donut-*`, `#income-chart` rules if nothing else uses them)

**Interfaces — Consumes:** Task 1's `LRXFinanceMath`. **Produces:**
- `window.LRXFinance = { alias(view) -> 'finance' | view, setTab(tab), tabs() -> { wealth, company } }`
- `loadFinance(force)`, `window.renderFinanceCompany()`, `window.syncFinance()`
- DOM contract: `#finance-body`; `.fin-tabs[role=tablist]` with `button.fin-tab[role=tab][data-fin-tab="wealth"|"company"]`
  and `aria-selected`; panels `#fin-wealth` / `#fin-company` (`role=tabpanel`); period pickers
  `[data-fin-period="nw"|"co"] button[data-days]`; Networth cards `.fin-alloc details[data-group]`,
  `.fin-movers`, `#fin-nw-chart`, `.fin-milestone`, `#fin-nw-table`; Company cards `#fin-pnl`, `.fin-products`,
  `#fin-co-chart`, `#fin-funds`, `#fin-co-table`.
- localStorage keys `tt.finance.tab`, `tt.finance.nwPeriod`, `tt.finance.coPeriod`.

- [ ] **Step 1: Write the failing smoke** `tests/finance-ui-smoke.js` (pattern of `tests/stock-ui-smoke.js`: fixture
  server, every non-local request aborted, `/api/networth` fulfilled from `tests/finance-fixture.js`, company from
  `stockCompany()` plus 40 synthetic `days` with `products` and `funds`). Assertions:
  - nav has `[data-view="finance"]`, no `networth` / `income` items; `showView('networth')` → `state.view === 'finance'`,
    Networth tab selected; `showView('income')` → Company tab selected; hash `#finance`.
  - Networth tab: tab cards show `$2.61B`-style totals, period default 30D, 4 allocation groups, `newthing` part listed,
    movers ≤ 5, milestone text, 1D/7D/30D/1Y chips; switching to 1D changes the allocation change column; 90D shows
    "records cover"; Company tab: P&L has this / previous / change columns, products rows = fixture products,
    `Last day` P&L revenue equals `c.income.revenue`.
  - `finance.milestone` off → no `.fin-milestone`; `page.networth` off → Company tab only; company mode off on the
    Company tab → Networth tab; both off → Overview and nav item hidden.
  - One-record fixture: no `NaN|undefined|Infinity|null` text in `#view-finance`, empty states shown.
  - EN and TR labels (`Finance`/`Finans`), widths 1440/1100/640 with no sideways scroll; screenshots to `QA_OUTPUT`.
- [ ] **Step 2: Run** `node tests/finance-ui-smoke.js` (with `PLAYWRIGHT_MODULE`) — Expected: FAIL (no finance nav).
- [ ] **Step 3: Implement** the HTML, hooks, `finance.js` and CSS listed above.
- [ ] **Step 4: Run** the smoke — Expected: PASS; look at the screenshots in EN/TR and at 640 px.

### Task 3: Links and other tests

**Files:**
- Modify: `tests/overview-ui-smoke.js` (Networth tile click: `state.view === 'finance'` and the Networth tab selected)
- Modify: `tests/report-nav-ui-smoke.js` (`showView('income')` → `showView('employees')`, its `assertOnActive` too;
  the sidebar session is idle; leave a note in the shared notes folder)

- [ ] **Step 1:** Update the two tests; run both — Expected: PASS.
- [ ] **Step 2:** Run `npm run check`, `npm test`, `npm run test:premium`, and every smoke (`ui-smoke`, `overview-ui-smoke`,
  `premium-ui-smoke`, `feature-modules-ui-smoke`, `stock-ui-smoke`, `employees-ui-smoke`, `awards-ui-smoke`,
  `report-nav-ui-smoke`, `finance-ui-smoke`, `electron-smoke`) — Expected: all pass.
- [ ] **Step 3:** Copy changed files to TEST, `cmp` each; write a hand-over note in the shared notes folder.
