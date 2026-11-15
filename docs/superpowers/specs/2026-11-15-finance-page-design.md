# Finance page (Networth + Company income) — design

Date: 2026-11-15 · Status: draft for the owner's approval · Not committed (the owner asked for no commits yet).

## Intent

The owner said the Networth page and the Income Statement page "look like the same thing" and asked to put them in one
place, better organised and more detailed, with a premium feel overall.

What we found: they answer different questions.

- **Income Statement** (`#view-income`, `renderIncome()` in `public/app.js`) is the daily profit and loss of the company
  the player directs: revenue, cost of goods, wages, ads, net profit, revenue by product, a revenue/cost chart and a
  day-by-day table. Data: `state.company` from `/api/company` (`buildCompanyReport()` in `src/server/server.js`). Only
  directors see it (company mode, `page.company`).
- **Networth** (`#view-networth`, `renderNetworth()` in `public/features.js`) is the player's personal wealth: total,
  change since yesterday / 7 / 30 days, cash, a breakdown of Torn's 20 networth parts and a history line. Data:
  `/api/networth` (`getNetworth()`), one record per day kept for 365 days. Everyone sees it (`page.networth`).
- They look alike because both are "a money total plus a history chart" and the names don't say whose money it is. The
  only shared figure is Networth's `company` part (the company's value).

The owner was shown two ways: two clearly distinct pages, or one Finance page with two tabs. **The owner chose one
Finance page.**

## Goals

- One sidebar entry, **Finance / Finans**, with two tabs: **Networth** (personal) and **Company** (company income,
  directors only).
- More detail from data the app already stores, with a period picker and a comparison against the previous period.
- A premium feel inside the app's existing look (dark glass cards, gold accent, mono numbers): headline numbers up
  front, one question per card, no clutter.
- **No data lost**: every figure the two pages show today still appears on the Finance page.
- Every old way in still works: the sidebar, the Overview Networth tile, `#networth` / `#income` hashes and
  `showView('networth' | 'income')` calls.

## Non-goals

- No new Torn requests, selections or polling; no new server endpoint. Opening Finance loads `/api/networth` exactly
  as opening Networth did (5-minute server cache) and reads the company report the app already keeps.
- No change to Stock Status, Daily Report or Employees.
- No paywall: the whole page stays free. "Premium feel" is about how it looks and reads, not the tier.
- No other sidebar items change.

## Anti-goals

- Clutter: more cards than questions, or numbers without a label saying what period they cover.
- Blurring personal and company money (company profit is not the player's networth). Each tab says whose money it is.
- Showing estimates as facts: days whose cost of goods is estimated keep their "~" mark and caption.

## Constraints

- English is the default language; every string has a TR/EN pair through `tr()` (or `I18N` keys for static HTML).
- Feature switches: every new feature needs a switch in `public/features.js` (`FEATURE_DEFS`) and in
  `public/feature-catalog.js` (the `legacy` list).
- `styles.css` turns every `<svg>` into a 17 px stroked icon: new inline SVGs (sparklines, bars) reset stroke, fill
  and size.
- Other sessions edit `public/app.js`, `public/index.html`, `public/styles.css` and `public/features.js` at the same
  time (Premium page, Gym & Stats, Daily Report + sidebar animation). Edits stay inside the Finance / Networth /
  Income code, are re-read right before each edit, and never reformat other code. In the sidebar only the Income and
  Networth items change.
- Torn rules: display only, no extra requests.
- `npm run check`, `npm test`, `npm run test:premium` and every UI smoke pass; changed files are copied to the TEST
  copy and checked with `cmp`.

## Approaches

1. **Two distinct pages** (rename Income Statement to "Company income", enrich both, cross-link). Lowest risk, keeps
   the company group intact. *Not chosen by the owner.*
2. **One Finance page with two tabs.** One sidebar entry, one place for money. Costs: the Company tab must still
   follow the director / company-mode rule, the two existing switches now govern tabs, and old links need aliases.
   **Chosen by the owner.**
3. One Finance page as a single long scroll (both sections stacked). Rejected: very long, and half of it disappears
   for non-directors anyway.

## Design

### Navigation, visibility and routing

- New view **`finance`** (`section#view-finance`). In the sidebar the Income Statement item becomes the Finance item
  (`data-view="finance"`, same slot after Employees, same chart icon); the Networth item is removed.
- Tab availability:
  - `wealthOn = feat('page.networth')`
  - `companyOn = feat('page.company') && state.companyMode !== false` (today's rule for company pages)
  - The Finance item and view are shown when `wealthOn || companyOn`.
  - With only one tab available, the tab cards still show (one card), so the page reads the same; the switcher has
    nothing to switch to.
- Aliases: `showView('networth')` opens Finance on the Networth tab, `showView('income')` on the Company tab. The
  start-up hash (`#networth`, `#income`) follows the same aliases. `state.view` is `'finance'` afterwards and the hash
  becomes `#finance`.
- If the requested tab is unavailable, the other tab opens; if neither is available, the Overview opens.
- When company mode turns off (or `page.company` is switched off) while the Company tab is shown, the page falls back
  to the Networth tab, or to the Overview when Networth is off too.
- The last tab used is remembered in `localStorage` (`tt.finance.tab`); the first visit opens Networth.
- `'income'` leaves `COMPANY_VIEWS`; the Finance item's visibility is decided by the rule above.
- Header **Refresh** on Finance reloads networth (`force=1`) and, as today, the company report.

### Tab cards (the page header)

Two large tab buttons side by side (ARIA tabs: `role="tablist"`, `role="tab"`, `aria-selected`, arrow keys move between
them). Each carries its headline number, so the header doubles as a summary:

- **Networth** — total networth (compact), and "+$8.65M today" in green / red.
- **Company** — the company name, last day's net profit, and "revenue $1.41M · last day".

The active card has the gold accent; the other is quiet. Before data arrives a card shows "—", never `NaN`.

### Networth tab

Data: `/api/networth` → `{ current, timestamp, history }`; `history` holds up to 365 daily records with every part.

**Period picker**: 1D · 7D · 30D · 90D · 1Y, default 30D, remembered (`tt.finance.nwPeriod`). 1D is the change since
yesterday's record (`recordBack(hist, 1, true)`, as the old page); the others start at the oldest record inside the
last *n* days (`recordBack(hist, n)` semantics). When records cover fewer days than the period, the card says
"records cover N days". *(Builder-check call: 1D is in the picker so the old per-part "change vs yesterday" column
survives in Allocation.)*

1. **Hero row** — total networth (with "updated HH:MM"), change over the period (amount, %, average per day) with
   "vs previous period" (the change over the same-length window right before it, shown when records reach back that
   far; 1D compares with the day before; never for 1Y, whose previous year isn't stored), and cash (wallet + bank +
   Cayman + vault + piggy bank). Under it a strip of change chips: **1D · 7D · 30D · 1Y**, so the old Since yesterday
   / 7 days / 30 days figures stay visible whatever period is picked. *(Builder-check call: the Networth tab gets a
   previous-period comparison too, as the goals promise.)*
2. **Allocation** — a stacked bar of four groups, then one expandable row per group (`<details>`), each listing its
   parts with value, share of the total and change over the period. Parts worth 0 stay hidden (as today); negative
   values (loan, unpaid fees) are red.
   - Cash: wallet, bank, cayman, vault, piggybank
   - Items and market: items, displaycase, bazaar, itemmarket, trade, auctionhouse, points
   - Investments: stockmarket, properties, company, enlistedcars, bookie
   - Pending and debts: pending, loan, unpaidfees, plus any numeric part Torn adds later that the list doesn't know
     (shown under its API name), so nothing is dropped.
3. **What moved** — the five parts with the largest absolute change over the period, signed, with a small bar. Empty
   state when there is no record at the period start.
4. **History** — the total as a line over the period (existing `lineChart`), and under it: best day, worst day
   (largest record-to-record rise / fall, with its date), days up out of days recorded, and the average change per day.
5. **Next networth milestone** (switch `finance.milestone`) — the next of Torn's networth rank triggers
   ($5M, $50M, $500M, $5B, $50B; the same list `rankEstimate()` uses on the server), a progress bar from the
   previous trigger (or $0), and an ETA at the 30-day average daily growth ("~4 months"). When growth is zero or
   negative: "not at the current pace". Above $50B: "every networth rank trigger reached".
6. **Day by day** — date, total, change since the previous record, and the part that moved most that day; newest
   first, limited to the period.

### Company tab

Data: `state.company` (the report the app already loads and keeps); nothing new is fetched.

**Period picker**: Last day · 7D · 30D · All, default 7D, remembered (`tt.finance.coPeriod`). A window holds the day
records dated within the last *n* days of the latest record; the previous window is the same length right before it.

1. **KPI row** — revenue for the period (and % vs the previous period), net profit (and margin), revenue per customer,
   and break-even revenue per day = average daily (wages + ads) ÷ (1 − cost-of-goods share), with "covered" or
   "short by $X" against the average daily revenue.
2. **Profit and loss** — rows Revenue, Cost of goods (with % of revenue), Gross profit, Wages (N employees),
   Advertising, Net profit; columns **this period · previous period · change**. For *Last day*, "this period" is
   `c.income` (the same live figures the old page showed) and "previous" is the record before the latest. Old sub-rows
   stay: customers (day / week), 7-day revenue · daily average (Torn's figure), monthly net projection (average daily
   net × 30). A "~" marks a period that includes estimated cost of goods.
3. **Products** — last day's product economics (from `c.products`): revenue, share of revenue (bar in the product's
   palette colour; this replaces the donut and keeps its percentages), units sold, profit and margin, plus a 30-day
   revenue sparkline from `c.days[].products[name].worth` (shown from 2 points). This card is always "last day"
   because profit needs current costs; its heading says so.
4. **Income history** — the existing revenue / cost stack / net line chart and its summary row, over the period
   window; at least the last 7 days (so *Last day* still shows a trend), at most the last 90 days.
5. **Funds and popularity** — company funds as a line over the window (`days[].funds`) with the current value and the
   change, and popularity with its change. Empty state below 2 records.
6. **Day by day** — today's columns (date, customers, revenue, cost of goods, wages, ads, net, popularity) plus revenue
   per customer and margin, limited to the period (*All* shows every record, as today), keeping the "~" caption.

### Overview and Settings

- The Overview **Networth** tile opens Finance on the Networth tab (its widget definition keeps `view: 'networth'`,
  which the alias resolves).
- The Overview company card is unchanged.
- Settings → Pages: `page.networth` is relabelled "Finance: Networth tab" / "Finans: Networth sekmesi"; the
  `page.company` description says "Stock, report, employees and the Finance company tab (directors only)". Keys don't
  change, so saved settings carry over.
- New switch **`finance.milestone`** (parent `page.networth`, default on, free): the milestone card. It is the only
  part that is an opinion rather than a view of the data, so it is the part that gets its own switch.

### Text

- `I18N['nav.finance'] = ['Finans', 'Finance']`; `VIEW_META.finance` = EN `['Finance', 'Your networth and your
  company's income']`, TR `['Finans', 'Networth ve şirket gelir tablosu']`.
- Tab names: EN Networth / Company, TR Networth / Şirket.
- Torn place names (Item Market, Bazaar, Stock Market…) stay English in both languages, as today.
- I18N keys only the removed pages used (`nav.income`, `nav.networth`, `inc.*`) are removed.

### Look

- Existing glass cards, gold accent, mono numbers, `pos` / `neg` colours, theme variables only, so all five themes
  work.
- The period picker matches the existing segmented `.toggle` style.
- Two-column card grid that drops to one column under ~860 px (container query); at 640 px nothing scrolls sideways
  and tables read as cards or scroll inside their wrapper as the other pages do.
- Inline SVGs reset `stroke`, `fill`, `width` and `height`.
- No new motion beyond what the app already does when cards appear (respecting Animations off and reduced motion).

### Code layout

- `public/finance-math.js` (new, UMD like `travel-math.js`, pure functions, no DOM): period windows, sums and
  previous-period comparison, networth grouping (with unknown parts), movers, record-to-record changes / best / worst
  / up-days, milestone and ETA, break-even, per-product revenue series. Unit tests in
  `tests/unit/finance-math.test.mjs` (vitest), written first.
- `public/finance.js` (new, loaded after `features.js`): the Finance view, tab cards, both tabs' rendering and
  state. It takes over `renderNetworth()` / `NW_PARTS` from `features.js` and `renderIncome()` from `app.js`;
  `incomeChart()` is reused.
- `public/index.html`: the Finance nav item and `section#view-finance`; `#view-income` and `#view-networth` go.
- `public/styles.css`: one Finance block; styles only the removed pages used are removed.
- `public/app.js`: `COMPANY_VIEWS` without `'income'`, `renderCompany()` renders the Company tab instead of
  `renderIncome()`, view aliases in `showView()` and the start-up hash.
- `public/features.js`: `EXTRA_VIEWS` / `EXTRA_LOADERS` / `viewHidden()` know `finance`; the switch labels.
- Tests: new `tests/finance-ui-smoke.js` (synthetic data only, every outside request aborted: both tabs, EN and TR,
  1440 / 1100 / 640 px, period pickers, aliases, switches and company mode, no `NaN` / `undefined` / `Infinity` on the
  page, no sideways scroll, screenshots); `tests/overview-ui-smoke.js` updated where it expects `state.view ===
  'networth'`. `tests/report-nav-ui-smoke.js` (the sidebar session's test) calls `showView('income')` and expects
  an `income` nav item. That session is told first; if it is no longer working on the file, the Finance work changes
  those calls to `employees` (another company tab, so the test keeps its meaning). "Done" includes this smoke
  passing. *(Builder-check call.)*

### Left to the builder

- Spacing, exact sizes and colours within the theme variables.
- Whether `incomeChart()` moves into `finance.js` or stays in `app.js`.
- How the tables collapse at 640 px, matching the Stock / Employees pages.

## Changes after the final review

- Company "vs previous period" (KPI and the P&L change column) compares revenue and costs **per recorded day**,
  so a previous window with fewer day records (a new company, days the app was off) is not shown as a jump.
  A note under the P&L says how many days each window has ("previous period: 2 of 7 days recorded").
- Networth "previous period" is shown only when the older records cover at least as many days as the period's own change.
- A Networth period with no start record (the app was off) says "No earlier record in this period" and draws no
  chart, instead of "Building history".
