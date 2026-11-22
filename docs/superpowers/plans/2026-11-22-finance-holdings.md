# Finance Holdings Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Holdings" card on Finance › Networth listing the items and stocks behind the networth, valued, filterable by place.

**Architecture:** A pure CommonJS module `src/server/holdings.js` turns Torn API replies into one `Holdings` object
(`GET /api/holdings`, cached 10 min in memory). `public/finance-math.js` gets `holdingsView` / `holdingsCompare`;
`public/finance.js` renders the card and links the Allocation parts to it.

**Tech Stack:** Node (server), vanilla JS renderer, vitest, Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-11-22-finance-holdings-design.md`

## Global Constraints

- Every UI text through `tr(TR, EN)`; English default.
- New switch `finance.holdings` (parent `page.networth`, def true) in `public/features.js` FEATURE_DEFS and the free
  `legacy` list of `public/feature-catalog.js` (right after `finance.milestone`).
- Torn API only, the player's own key; requests only while the Networth tab is shown; nothing written to disk.
- Every Torn string (item, stock names, error text) through `esc()` before innerHTML.
- Global `svg` rule: no new inline SVG.
- Other sessions edit `features.js`, `styles.css`, `server.js`, `package.json`: re-read right before each edit;
  don't reformat other code. Don't commit.

## Review Focus

1. Inventory past the 8-page cap → place `partial`, total with "~", no Torn comparison — Task 1 + Task 2 tests.
2. Item names with markup (`<b>`) → shown as text — Task 3 smoke fixture.
3. A key whose access level refuses one place (Torn error 16) → that place shows its reason, others render — Task 1 + Task 3.
4. A refresh that fails after a good load → previous rows stay, error line shown — Task 3 smoke.
5. Switch off → no `/api/holdings` request at all — Task 3 smoke.

---

### Task 1: Server holdings module and route

**Files:**
- Create: `src/server/holdings.js`, `tests/unit/holdings.test.mjs`
- Modify: `src/server/server.js` (require near the other `./` requires; `getHoldings` after `getNetworth`; route after `/api/networth`)

**Interfaces:**
- Produces `loadHoldings({ get, force = false, now = () => Date.now() }) → Promise<Holdings>`, `PLACES`, `PAGE_CAP = 8`.
  - `get(pathq, ttl)` → Promise of the parsed Torn reply (throws `Error` with message on Torn errors).
  - `Holdings = { at: ms, places: { inventory, bazaar, display, itemmarket, stocks } }`
  - Place `{ ok: true, total, rows: Row[], partial?: true, tornAt?: seconds }` | `{ ok: false, error: string }`
  - `Row = { id, name, type, qty, unit, value, listed? }`, rows sorted by value desc; `unit = value / qty`.
- Requests and TTLs: catalog `torn/?selections=items` 3 600 000; `user/?selections=stocks` and
  `torn/?selections=stocks` 60 000 (0 with force); `v2/user/inventory?limit=250&offset=N`, `user/?selections=bazaar`,
  `user/?selections=display`, `v2/user/itemmarket?offset=N` all ttl 0.
- server.js: `getHoldings(force)` = `cached('holdings', 600_000, () => holdings.loadHoldings({ get: torn, force }))`,
  `cache.delete('holdings')` first when forced; route `GET /api/holdings[?force=1]`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/holdings.test.mjs` (import `h from '../../src/server/holdings.js'`, a fake `get` that maps pathq → reply or throws, and records `[pathq, ttl]`):
  - `inventory: catalog market value, uid rows merged by id, faction-owned left out` — two `Kitchen Knife` rows (uid) + one faction_owned Xanax → one knife row qty 2, no Xanax; type from catalog; `tornAt` = reply `inventory.timestamp`.
  - `inventory paging stops on a short page; 8 full pages mark the place partial` — offsets 0,250,…; 9th page never asked.
  - `bazaar and display: v1 arrays, listed price kept, catalog price when market_price is missing` — bazaar `{ID, quantity, price, market_price}`, display `{ID, quantity}` → catalog.
  - `item market: qty = min(amount, available), pages by offset until empty or no next link`.
  - `stocks: total_shares × current_price, zero holdings skipped, name "Name (ACR)"`, id `'s' + stock_id`.
  - `one failing place does not stop the others; catalog failure fails inventory and item market only`.
  - `an unexpected reply shape is an error, not zeros` — `{ foo: 1 }` for bazaar → `ok: false`.
  - `force asks stocks with ttl 0; the catalog keeps 3 600 000`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/holdings.test.mjs` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `src/server/holdings.js`** (`module.exports = { loadHoldings, PLACES, PAGE_CAP }`); every place in its own try/catch (`Promise.allSettled`-style), parsing defensively (`ID|id`, `quantity|amount`, `market_price|market_value`, array or object values).
- [ ] **Step 4: Run** the test — Expected: PASS. Then wire `server.js` (require, `getHoldings`, route) and run `node --check src/server/server.js` and `npm run check` — Expected: OK.

### Task 2: Client math

**Files:** Modify `public/finance-math.js`, `tests/unit/finance-math.test.mjs`

**Interfaces:**
- Consumes `Holdings` from Task 1.
- Produces `HOLD_PLACES = ['inventory','bazaar','display','itemmarket','stocks']`, `HOLD_PART = { inventory: 'items', bazaar: 'bazaar', display: 'displaycase', itemmarket: 'itemmarket', stocks: 'stockmarket' }`,
  `holdingsView(h, place = 'all') → { place, total, rows, biggest, partial, zero, places, error? }`
  - `rows[i] = { id, name, type, qty, unit, value, listed?, places: string[], share }` (value > 0 only, sorted desc);
    `zero` = count of rows with value 0; `places` = `[{ key, ok, total, count, partial, error }]` for every place in `h`.
  - `'all'` merges rows of ok places by id (sums qty and value; no `listed`).
  `holdingsCompare(view, current) → { torn, diff, off } | null` — `torn` = matching networth part(s) (All: sum of the five),
  `diff = view.total - torn`, `off = |diff| > 0.02 × |torn|`; null when `view.partial`, `!current`, or the place failed.

- [ ] **Step 1: Failing tests** `holdingsView: All merges one item across places with shares`, `a single place keeps listed price`, `zero-value rows are counted, not listed`, `a failed place has its error and no rows`, `holdingsCompare: off over 2 %, null when partial or without networth`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/finance-math.test.mjs` — Expected: FAIL (`holdingsView is not a function`).
- [ ] **Step 3: Implement** and export both.
- [ ] **Step 4: Run** — Expected: PASS.

### Task 3: Holdings card, switch, Allocation links, CSS, smoke

**Files:**
- Modify: `public/finance.js`, `public/features.js`, `public/feature-catalog.js`, `public/styles.css` (Finance block), `tests/finance-fixture.js`, `tests/finance-ui-smoke.js`

**Interfaces:**
- Consumes Task 2 exports and `GET /api/holdings[?force=1]`.
- DOM contract (smoke): `#fin-holdings` card; chips `[data-hold-place="all|inventory|bazaar|display|itemmarket|stocks"]`
  with `aria-pressed`; table `#fin-hold-table tbody tr[data-item]`; `.fin-hold-sum`; `.fin-hold-err [data-place]`;
  button `[data-hold-all]`; Allocation part buttons `.fin-part-go[data-hold-go]`; localStorage `tt.finance.holdingsPlace`.
- Labels: All/Tümü, Items/Eşyalar, Bazaar, Display Case, Item Market, Stocks/Hisseler; card title Holdings/Varlıklar.

- [ ] **Step 1: Fixture** `holdingsData()` in `tests/finance-fixture.js`: inventory with 30 priced rows + 2 zero-value rows
  (one name `<b>Bold</b> Plushie`), bazaar where Xanax is 80 % of the place, display, item market `ok: false`
  (`'Torn API: Access level of this key is not high enough'`), stocks with two holdings.
- [ ] **Step 2: Failing smoke assertions** (route `/api/holdings`, count requests, record the last URL):
  card + six chips minus none, All pressed by default; Bazaar summary says `Xanax` and `80.0%`; Allocation
  `.fin-part-go[data-hold-go="bazaar"]` click → Bazaar chip pressed, remembered, `#fin-holdings` in the viewport;
  All shows 25 rows then `[data-hold-all]` shows all priced rows; zero-value footnote says `2`; item-market reason
  shown; `<b>` shown as text (no `b` element in the table); a failing refresh keeps rows and shows an error;
  `loadFinance(true)` sends `?force=1`; switch off → card gone and request count unchanged after a reload;
  TR: `Varlıklar`, `Tümü`; existing `checkWidths` (1440/1100/640) and `assertClean` stay green.
- [ ] **Step 3: Run** `node tests/finance-ui-smoke.js` — Expected: FAIL at the first holdings assertion.
- [ ] **Step 4: Implement** switch (features.js + catalog), card and handlers in `finance.js` (state `hold`, `holdErr`,
  `holdPlace`, `holdAll`; load after networth and on return to the Networth tab, only when the switch is on),
  Allocation buttons (switch on only), CSS (`.fin-hold-*`, `.fin-part-go`).
- [ ] **Step 5: Run** the smoke — Expected: `{"ok":true,…}`; review the EN/TR 1440/640 screenshots.
