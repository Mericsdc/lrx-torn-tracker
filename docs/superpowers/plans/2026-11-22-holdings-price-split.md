# Holdings price effect vs trading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Value | Change switch on the Finance › Networth › Holdings card that splits each item's value change over the tab's period into price effect and bought / sold, tied back to the networth change.

**Architecture:** The server writes one compact per-item record per Torn day (`data/holdings-days.json`) whenever Holdings load fresh, and adds the period start records to the `/api/holdings` reply as `split`. `public/finance-math.js` does the split (pure); `public/finance.js` draws the Change view.

**Tech Stack:** Node 18+ CommonJS server, vanilla JS renderer (UMD helpers), vitest (`tests/unit/*.test.mjs`), `node --test`, Playwright smoke (`tests/finance-ui-smoke.js`).

**Spec:** `docs/superpowers/specs/2026-11-22-holdings-price-split-design.md` (read it first; this plan does not repeat its reasoning).

## Global Constraints

- Every UI text: `tr('TR', 'EN')`, English default; Torn place names (Bazaar, Item Market, Display Case) stay English in TR.
- Item names always through `esc(decode(name))`.
- No new Torn requests; nothing is recorded unless `/api/holdings` is called (card shown) and both `finance.holdings` and `finance.priceSplit` are not `false` in `config.features`.
- Never read `data/config.json`, `.env`, `*.sqlite` or key files.
- No commits, pushes or releases (owner rule): every "Commit" step below is "leave uncommitted".
- Other sessions edit `server.js`, `finance.js`, `styles.css`, `features.js`, `package.json`: re-read the region right before each edit, change only the lines named, no reformatting.
- Code containing backslashes is written with Write/Edit, never a Bash heredoc.
- Record day = `tctDate(ms)` from `server.js` (18:00 TCT boundary); keep 366 days by date; row `[qty, unit]`, unit rounded to cents.

## Review Focus

1. A Refresh where one place is rate-limited or stale → that place is excluded, Rest is not shown, a note names the place (Task 3 test `excluded places and no tie`; Task 5 smoke "Rest needs every place").
2. A half-written, foreign or garbage `holdings-days.json` (bad JSON, array, other `ownerId`) → treated as empty, no crash, no foreign data shown (Task 1 test `forOwner`).
3. An item whose market value is 0 at the start or now → no NaN / Infinity in unit change or totals (Task 3 test `zero unit price`).
4. A sold-out item whose stored name contains markup → shown as text (Task 5 smoke `<i>Gone</i> Box`).
5. Records older than 366 days and names only they used → dropped, so the file does not grow forever (Task 1 test `prunes by date and names`).

---

### Task 1: Server record module `holdings-days.js`

**Files:**
- Create: `src/server/holdings-days.js`
- Test: `tests/unit/holdings-days.test.mjs` (import like `tests/unit/holdings.test.mjs`: `import hd from '../../src/server/holdings-days.js'`)

**Interfaces:**
- Consumes: `require('../../public/finance-math').periodStart(hist, days)`; a `loadHoldings()` reply `{ at, places: { [k]: { ok, partial?, rows: [{ id, name, type, qty, value }] } | { ok: false } } }`.
- Produces (all pure, never mutate inputs):
  - `empty(ownerId) → { v: 1, ownerId, names: {}, days: {} }`
  - `forOwner(file, ownerId) → file` when it is an object with `v === 1`, `ownerId === ownerId`, object `days` and `names`; else `empty(ownerId)`
  - `snapshot(h) → { at, places: { [k]: { [id]: [qty, unit] } }, names: { [id]: [name, type] } }`
  - `record(file, day, snap, { nw } = {}) → file` (same object back when `snap.places` is empty)
  - `starts(file, today, periods = [1, 7, 30, 90, 365]) → { today, starts: [{ date, at, nw?, places }], names }`
  - `KEEP_DAYS = 366`, `PERIODS`

- [ ] **Step 1: Write the failing tests**

```js
describe('snapshot', () => {
  // inventory ok: 206 qty 10 value 8_300_000, 1 qty 0, 7 qty 3 value 1000; bazaar partial; display failed;
  // itemmarket ok rows []; stocks ok 's25' qty 1000 value 1_200_500
  it('keeps loaded, complete places and rows with qty', () => {
    expect(s.places).toEqual({ inventory: { 206: [10, 830000], 7: [3, 333.33] }, itemmarket: {}, stocks: { s25: [1000, 1200.5] } });
    expect(s.names).toEqual({ 206: ['Xanax', 'Drug'], 7: ['Box', 'Other'], s25: ['Torn City Investments (TCI)', 'Stock'] });
    expect(s.at).toBe(H.at);
  });
});
describe('record', () => {
  it('adds a day and keeps nw', () => expect(hd.record(hd.empty(1), '2026-11-22', snap, { nw: 5e9 }).days['2026-11-22']).toEqual({ at: snap.at, nw: 5e9, places: snap.places }));
  it('merges the same day: a place missing from the new load keeps its earlier list', () => {
    // earlier: { display: { 500: [1, 150e6] }, inventory: { 206: [1, 1] } }, nw 1; new snap: inventory only, no nw
    expect(day.places.display).toEqual({ 500: [1, 150e6] });
    expect(day.places.inventory).toEqual(snap.places.inventory);
    expect('nw' in day).toBe(false);
  });
  it('returns the same file when nothing loaded', () => expect(hd.record(f, '2026-11-22', { at: 1, places: {}, names: {} })).toBe(f));
  it('prunes by date and names', () => {
    // existing days 2025-11-20 (only id 999) and 2025-11-21; record 2026-11-22
    expect(Object.keys(out.days).sort()).toEqual(['2025-11-21', '2026-11-22']);
    expect(out.names[999]).toBeUndefined();
  });
});
describe('starts', () => {
  // days 2026-10-01, 2026-11-15, 2026-11-21, 2026-11-22; today 2026-11-22
  it('picks each period start like the networth tab, dedupes, oldest first, never today', () => {
    expect(hd.starts(f, '2026-11-22').starts.map((r) => r.date)).toEqual(['2026-10-01', '2026-11-15', '2026-11-21']);
  });
  it('1D needs the exact day before', () => {
    // days 2026-11-20 only, today 2026-11-22
    expect(hd.starts(f2, '2026-11-22').starts.map((r) => r.date)).toEqual(['2026-11-20']); // from 7D, not 1D
  });
  it('sends names only for ids in the starts', () => expect(Object.keys(out.names).sort()).toEqual([...]));
  it('empty file → no starts', () => expect(hd.starts(hd.empty(1), '2026-11-22')).toEqual({ today: '2026-11-22', starts: [], names: {} }));
});
describe('forOwner', () => {
  it('treats another owner, garbage and arrays as empty', () => {
    for (const bad of [null, [], 'x', { v: 1, ownerId: 2, days: {}, names: {} }, { v: 1, ownerId: 1, days: [] }]) expect(hd.forOwner(bad, 1)).toEqual(hd.empty(1));
  });
  it('keeps the owner\'s file', () => expect(hd.forOwner(f, 1)).toBe(f));
});
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tests/unit/holdings-days.test.mjs` (from `resources/app`)
Expected: FAIL, cannot find module `holdings-days.js`.

- [ ] **Step 3: Implement `src/server/holdings-days.js`**

Header comment in the style of `holdings.js` (what it is, pure, spec path). `snapshot`: places with `ok && !partial`; rows `qty > 0`, `unit = Math.round(value / qty * 100) / 100`; ids as strings keys. `record`: day record `{ at: snap.at, ...(Number.isFinite(nw) ? { nw } : {}), places: { ...old?.places, ...snap.places } }`; drop dates `< isoDay(dayMs(day) - KEEP_DAYS * DAY)`; `names = { ...file.names, ...snap.names }` kept only for ids present in some kept day. `starts`: `hist = [...dates < today sorted].map((date) => ({ date, ...days[date] }))`, then `FM.periodStart([...hist, { date: today }], p)` for each period, dedupe by date, sort by date.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run tests/unit/holdings-days.test.mjs`
Expected: PASS (all).

- [ ] **Step 5: Leave uncommitted** (owner rule).

---

### Task 2: Server wiring — record on load, `split` in `/api/holdings`

**Files:**
- Modify: `src/server/server.js` — near line 19 (`HISTORY_FILE`), `adoptPlayer` (~line 119 `if (changed)` block), `getHoldings` (~line 357-364)
- Create: `tests/holdings-split.test.js` (node:test)
- Modify: `package.json` `scripts.test:node` — append ` tests/holdings-split.test.js`

**Interfaces:**
- Consumes: Task 1 exports; `tctDate`, `historyOwner`, `history.networth`, `keyGen`, `readJson`, `writeJson`, `config.features`.
- Produces: `/api/holdings` reply `{ at, places, split?: { today, starts, names } }`; file `DATA/holdings-days.json`.

- [ ] **Step 1: Write the failing test `tests/holdings-split.test.js`**

Set up like `tests/core.test.js` (temp `TORN_DATA_DIR`, `TORN_API_KEY = 'test-key'`, stub `global.fetch` before `require('../src/server/server')`, cleanup in `after`). Before requiring, write `history.json` = `{ ownerId: 123, networth: { [today]: { total: 1e9, at: Date.now() } } }` and `holdings-days.json` = `{ v: 1, ownerId: 123, names: { 206: ['Xanax', 'Drug'] }, days: { [yesterday]: { at: Date.now() - 864e5, nw: 9e8, places: { bazaar: { 206: [5000, 840000] } } } } }`, with `today = new Date(Date.now() - 18 * 3600e3).toISOString().slice(0, 10)`. The fetch stub answers the seven Holdings paths (strip `key`/`comment` from the query) with small valid replies (bazaar Xanax qty 4700, `market_price` 830000) as `{ status: 200, text: async () => JSON.stringify(body) }`, and counts calls.

```js
test('switch off: no split and nothing recorded', async () => {
  await request('/api/features', { features: { 'finance.priceSplit': false } });
  const r = await request('/api/holdings');
  assert.equal(r.status, 200); assert.equal(r.data.split, undefined);
  assert.deepEqual(Object.keys(readDays().days), [yesterday]);
});
test('switch on: the reply is recorded once and split carries the start', async () => {
  await request('/api/features', { features: { 'finance.priceSplit': true } });
  const calls = fetchCalls;
  const r = await request('/api/holdings');
  assert.equal(fetchCalls, calls, 'answered from the cache, no Torn call');
  assert.equal(r.data.split.today, today);
  assert.deepEqual(r.data.split.starts.map((s) => s.date), [yesterday]);
  assert.deepEqual(r.data.split.names[206], ['Xanax', 'Drug']);
  const d = readDays().days[today];
  assert.deepEqual(d.places.bazaar['206'], [4700, 830000]);
  assert.equal(d.nw, 1e9);
  const again = await request('/api/holdings');
  assert.equal(readDays().days[today].at, d.at); assert.equal(again.data.at, r.data.at);
});
```

- [ ] **Step 2: Run and see it fail**

Run: `node --test tests/holdings-split.test.js`
Expected: FAIL on `r.data.split.today` (undefined).

- [ ] **Step 3: Implement in `server.js`**

- `const holdingsDays = require('./holdings-days');` next to `require('./holdings')`; `const HOLD_DAYS_FILE = path.join(DATA, 'holdings-days.json');` next to `HISTORY_FILE`; `let holdDays = null, holdDaysAt = 0;` next to `history`.
- `adoptPlayer`, inside `if (changed)`: `holdDays = null; holdDaysAt = 0;` and, when the file exists, `writeJson(HOLD_DAYS_FILE, holdingsDays.empty(id))` in a try/catch with `console.warn('[holdings-days]', e.message)`.
- `getHoldings(force)`: take `const gen = keyGen` before `cached(...)`; after it resolves, return the reply unchanged when `config.features?.['finance.holdings'] === false || config.features?.['finance.priceSplit'] === false` or `historyOwner() == null`. Otherwise `holdDays = holdingsDays.forOwner(holdDays ?? readJson(HOLD_DAYS_FILE, null), owner)`; `day = tctDate(data.at)`; when `gen === keyGen && data.at !== holdDaysAt`: set `holdDaysAt = data.at`; `nw` = `history.networth?.[day]?.total` when that record's `at` is within 15 minutes of `data.at`; `next = holdingsDays.record(holdDays, day, holdingsDays.snapshot(data), { nw })`; if `next !== holdDays`, store and `writeJson(HOLD_DAYS_FILE, next)` (try/catch + warn). Return `{ ...data, split: holdingsDays.starts(holdDays, day) }` (never change the cached object). Update the comment above `getHoldings` (it now says "never written to disk": say the per-item day record goes to `holdings-days.json`).
- `package.json`: re-read, append the test file to `test:node` only.

- [ ] **Step 4: Run and see it pass**

Run: `node --test tests/holdings-split.test.js` then `npm run test:node`
Expected: PASS; no other node test broken.

- [ ] **Step 5: Leave uncommitted.**

---

### Task 3: Client math `holdingsChange` and `holdingsTie`

**Files:**
- Modify: `public/finance-math.js` (after `holdingsMerge`, add both to the frozen export list)
- Test: `tests/unit/finance-math.test.mjs` (new `describe('holdingsChange and holdingsTie')`)

**Interfaces:**
- Consumes: `HOLD_PLACES`, `num`; a Holdings reply after `holdingsMerge` (places may carry `stale`); a start record `{ date, at, nw?, places }`; `names`.
- Produces:
  - `holdingsChange(h, start, names = {}, place = 'all') → { place, rows, price, trade, total, byPlace: { [k]: number }, counted: string[], excluded: [{ key, why: 'failed'|'partial'|'nostart' }], unchanged }`; row `{ id, name, type, places, q0, q1, u0, u1, price, trade, total }` (`u0`/`u1` null when that side's quantity is 0).
  - `holdingsTie(chg, nwNow, nwStart) → { change, price, rest } | null` (null unless `chg.place === 'all'`, `chg.excluded.length === 0`, both numbers finite).

- [ ] **Step 1: Write the failing tests**

```js
const cur = (places) => ({ at: 1, places }); const ok = (rows, extra) => ({ ok: true, rows, ...extra });
const row = (id, name, qty, unit) => ({ id, name, type: 'Drug', qty, value: qty * unit });
it("the owner's Xanax example", () => {
  const c = fm.holdingsChange(cur({ bazaar: ok([row(206, 'Xanax', 4700, 830000)]) }), { date: 'd', places: { bazaar: { 206: [5000, 840000] } } }, {}, 'bazaar');
  expect(c.rows[0]).toMatchObject({ q0: 5000, q1: 4700, u0: 840000, u1: 830000, price: -47e6, trade: -252e6, total: -299e6 });
  expect([c.price, c.trade, c.total]).toEqual([-47e6, -252e6, -299e6]);
});
it('a new item is all bought; a sold-out item is named from names', () => {
  // now inventory 186 qty 10 value 500, start inventory { s25: [1000, 1200.5] }, names { s25: ['TCI', 'Stock'] }
  expect(byId[186]).toMatchObject({ q0: 0, u0: null, price: 0, trade: 500, total: 500 });
  expect(byId.s25).toMatchObject({ name: 'TCI', q1: 0, u1: null, price: 0, trade: -1200500 });
});
it('moving items from Items to the Bazaar nets to nothing in All', () => {
  // start inventory { 206: [100, 830000] }, now bazaar 206 qty 100 @ 830000, inventory ok []
  expect(all.rows).toEqual([]); expect(all.unchanged).toBe(1); expect(all.byPlace).toEqual({ inventory: -83e6, bazaar: 83e6 });
});
it('excluded places and no tie', () => {
  // now: inventory failed, bazaar ok but stale, display partial, itemmarket ok with a row but no start, stocks ok and started
  expect(c.excluded).toEqual([{ key: 'inventory', why: 'failed' }, { key: 'bazaar', why: 'failed' }, { key: 'display', why: 'partial' }, { key: 'itemmarket', why: 'nostart' }]);
  expect(c.counted).toEqual(['stocks']);
  expect(fm.holdingsTie(c, 10e9, 10.04e9)).toBeNull();
});
it('ties to the networth: rest = networth change − price effect', () => {
  expect(fm.holdingsTie(allCounted /* price -47e6 */, 10e9, 10.04e9)).toEqual({ change: -40e6, price: -47e6, rest: 7e6 });
  expect(fm.holdingsTie(allCounted, 10e9, undefined)).toBeNull();
  expect(fm.holdingsTie({ ...allCounted, place: 'bazaar' }, 10e9, 10.04e9)).toBeNull();
});
it('zero unit price at either side gives numbers, never NaN', () => {
  // start { 7: [5, 0] }, now 7 qty 5 value 1000 → price 1000, trade 0; start { 8: [2, 50] }, now 8 qty 2 value 0 → price -100
  expect(c.rows.every((r) => [r.price, r.trade, r.total].every(Number.isFinite))).toBe(true);
});
it('sorts by the size of the change', () => expect(c.rows.map((r) => r.id)).toEqual([/* |total| desc, then |price|, then name */]));
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tests/unit/finance-math.test.mjs`
Expected: FAIL, `fm.holdingsChange is not a function`.

- [ ] **Step 3: Implement both in `public/finance-math.js`**

Per spec "Client math": place states in `HOLD_PLACES` order over places present in `h.places` or `start.places` — `failed` when now missing/not ok/`stale` (missing only counts when the start has rows), `partial` when `partial`, `nostart` when ok with rows now and absent from `start.places` (ok, no rows, absent → skipped). Per counted place and id: `q0, u0` from `[qty, unit]`; `q1 = num(row.qty)`, `v1 = num(row.value)`, `u1 = q1 ? v1 / q1 : null`; `u0` for a new id = `u1`; `price = q1 * (u1 - u0)` (0 when `q1 === 0`), `trade = (q1 - q0) * u0`, `total = v1 - q0 * u0`. `byPlace[k]` = sum of totals. For `place === 'all'` merge by id (sum q, V0, V1, price, trade, total; `places` in order); otherwise that place's rows only (an excluded place → no rows). Rows with |price|, |trade|, |total| all `< 0.5` go to `unchanged`. Sort |total| desc, |price| desc, `String(name).localeCompare`. Name / type: current row, else `names[id]`, else `#id` / `''`.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run tests/unit/finance-math.test.mjs`
Expected: PASS (old and new).

- [ ] **Step 5: Leave uncommitted.**

---

### Task 4: Feature switch

**Files:**
- Modify: `public/features.js:15` (add a line after `finance.holdings`)
- Modify: `public/feature-catalog.js` `legacy` list (insert `finance.priceSplit` after `finance.holdings`)

**Interfaces:**
- Produces: `feat('finance.priceSplit')` (default true).

- [ ] **Step 1: Add the definition**

```js
{ group: 'pages', parent: 'page.networth', key: 'finance.priceSplit', def: true, tr: ['Fiyat etkisi ve alım-satım', "Varlıklar kartında değişimi Torn fiyat hareketleri ve senin alım-satımın olarak ayırır; bu bilgisayarda günlük eşya kaydı tutar (Varlıklar açıkken)"], en: ['Price effect vs trading', "Splits the Holdings change into Torn's price moves and your buying and selling; keeps a daily item record on this computer (needs Holdings)"] },
```

- [ ] **Step 2: Verify**

Run: `npm run check` and `npm run test:premium`
Expected: both pass (the catalog is shared with the premium service).

- [ ] **Step 3: Leave uncommitted.**

---

### Task 5: Change view in the Holdings card + smoke

**Files:**
- Modify: `public/finance.js` (`st`, `holdingsCard`, click handler; no other function)
- Modify: `public/styles.css` (the `/* holdings: ... */` block and its `@container (max-width: 700px)` rule)
- Modify: `tests/finance-fixture.js` (add and export `holdingsSplit`)
- Test: `tests/finance-ui-smoke.js` (new section after the Holdings section; DOM contract comment at the top gets the new selectors)

**Interfaces:**
- Consumes: `FM.holdingsChange`, `FM.holdingsTie`, `FM.periodStart`, `split` from Task 2, `feat('finance.priceSplit')`.
- Produces (DOM contract): `#fin-holdings .fin-hold-mode[role=group] button[data-hold-mode="value"|"change"][aria-pressed]`; `#fin-hold-change tbody tr[data-item]`; `.fin-hold-sum`; `.fin-hold-since`; localStorage `tt.finance.holdingsMode`.

- [ ] **Step 1: Fixture `holdingsSplit({ now })`**

Returns `{ today: iso(now), starts: [S20, S3], names }` built against `holdingsData`: `S20` (20 days ago) and `S3` (3 days ago, `nw` = networth fixture total that day) with `inventory` = same rows as now except Item 01 qty +5, `bazaar` = `{ 206: [5000, 1_010_000], 370: [12, 25_000_000], 186: [100, 7_000_000] }`, `display` = now, `stocks` = `{ s25: [1000, 1100], s1: [2_000_000, 1000] }`, no `itemmarket`, plus a sold-out `inventory` id `3001` named `<i>Gone</i> Box` in `names` (`[4, 2_000_000]`). `S20` like `S3` with bazaar Xanax `[6000, 1_020_000]`.

- [ ] **Step 2: Write the failing smoke section**

```js
// Price effect vs trading: the Change view (split from /api/holdings).
holdings = { ...holdingsData({ now }), split: holdingsSplit({ now }) };
await page.evaluate(() => loadFinance(true));
assert.equal(await count('#fin-holdings [data-hold-mode]'), 2, 'Value | Change switch');
assert.equal(await page.locator('#fin-holdings [data-hold-mode="value"]').getAttribute('aria-pressed'), 'true', 'Value by default');
await page.locator('#fin-holdings [data-hold-mode="change"]').click();
assert.equal(await page.evaluate(() => localStorage.getItem('tt.finance.holdingsMode')), 'change');
assert.ok((await textOf('#fin-holdings .fin-hold-since')).includes('since'), 'the start date');
assert.ok((await textOf('#fin-hold-change tbody tr[data-item="206"]')).includes('→'), 'Xanax qty start → now');
assert.ok((await textOf('#fin-holdings')).includes('Rest needs every place') && (await textOf('#fin-holdings')).includes('Item Market'), 'no Rest while the item market failed');
assert.equal(await count('#fin-hold-change i'), 0, 'stored names are text');
assert.ok((await textOf('#fin-hold-change')).includes('<i>Gone</i> Box'), 'the sold-out item is listed');
// Every place loaded: the networth tie.
holdings = { ...holdings, places: { ...holdings.places, itemmarket: { ok: true, total: 0, rows: [] } } };
holdings.split = { ...holdings.split, starts: holdings.split.starts.map((s) => ({ ...s, places: { ...s.places, itemmarket: {} } })) };
await page.evaluate(() => loadFinance(true));
for (const w of ['Networth', 'Price effect', 'Rest']) assert.ok((await textOf('#fin-holdings .fin-hold-sum')).includes(w), 'tie tile ' + w);
// Period picks its own start; 1D without yesterday; no records at all.
const since30 = await textOf('#fin-holdings .fin-hold-since');
await page.locator('[data-fin-period="nw"] button[data-days="7"]').click();
assert.notEqual(await textOf('#fin-holdings .fin-hold-since'), since30, '7D starts later than 30D');
await page.locator('[data-fin-period="nw"] button[data-days="1"]').click();
assert.ok((await textOf('#fin-holdings')).includes('No record from yesterday'));
await page.locator('[data-fin-period="nw"] button[data-days="30"]').click();
await assertClean('EN holdings change');
holdings = { ...holdings, split: { ...holdings.split, starts: [] } };
await page.evaluate(() => loadFinance(true));
assert.ok((await textOf('#fin-holdings')).includes('Building history'));
// Switch off: value view only.
await setFeat('finance.priceSplit', false);
assert.equal(await count('#fin-holdings [data-hold-mode]'), 0); assert.equal(await count('#fin-hold-table'), 1);
await setFeat('finance.priceSplit', true);
holdings = { ...holdings, split: holdingsSplit({ now }) }; // keep for the widths check below
```

Widths: before `checkWidths('en')` leave the Change view on (and `holdings` with `split`); before the TR section click `[data-hold-mode="value"]`, and in TR assert the switch reads `Değer` / `Değişim`.

- [ ] **Step 3: Run and see it fail**

Run (PowerShell, from `resources/app`): `$env:PLAYWRIGHT_MODULE='D:\Meric\TORN\updates\ui-validation-deps\node_modules\playwright'; node tests/finance-ui-smoke.js`
Expected: FAIL at "Value | Change switch".

- [ ] **Step 4: Implement the Change view in `finance.js`**

- `st.holdMode` from `lsGet('tt.finance.holdingsMode', 'value')` (`'change'` or `'value'`); click on `[data-hold-mode]` sets it, `lsSet`, `st.holdAll = false`, `redrawHoldings()`, focuses the pressed mode button.
- `holdingsCard()`: `split = feat('finance.priceSplit') && st.hold?.split`; when present the head gets `<div class="toggle fin-hold-mode" role="group" aria-label="${tr('Görünüm', 'View')}">` with the two buttons (`class="active"` + `aria-pressed` like `periodBar`). With `split && st.holdMode === 'change'` return the Change card from a new local function `holdingsChangeCard(h, split)`; the Value card stays as it is.
- `holdingsChangeCard`: `start = FM.periodStart([...split.starts, { date: split.today }], st.nwDays)`; no start → `emptyBox` ("Building history" when `split.starts` is empty, "No record from yesterday" for 1D, else "No Holdings record in this period", texts in the spec); else `all = FM.holdingsChange(h, start, split.names, 'all')`, chips = All + `counted` places with a row or a nonzero `byPlace` + excluded places (`—`), the selected place falls back to All; `v = place === 'all' ? all : FM.holdingsChange(h, start, split.names, place)`; `nwStart = start.nw ?? st.nw?.history?.find((r) => r.date === start.date)?.total` (`~` when from history); `tie = st.nwErr ? null : FM.holdingsTie(v, st.nw?.current?.total, nwStart)`; head sub `<span class="fin-hold-since">${nwLabel(st.nwDays)} · ${tr(`başlangıç ${shortDate(start.date)}`, `since ${shortDate(start.date)}`)}</span>`; summary tiles, table `#fin-hold-change` (class `tbl compact fin-hold-table`; Place `th/td.fin-hold-where`, Unit change `.fin-hold-unit`; qty `${n0(q0)} → ${n0(q1)}`; money cells `signed()` + `deltaCls()`), Show all (reuse `HOLD_TOP`, `data-hold-all`), notes and excluded-place lines as in the spec. Use only `money/cmoney/signed/deltaCls/n0/esc/decode/shortDate/emptyBox/L/tr`, already in scope.
- `styles.css`: `.fin-holdings .card-head` wraps (`flex-wrap: wrap; gap: 8px`), `.fin-hold-mode` margin-left auto; `.fin-hold-where` added to the existing `@container (max-width: 700px)` hide rule.

- [ ] **Step 5: Run and see it pass**

Run: the smoke command from Step 3, then `npm test`
Expected: smoke prints `{"ok":true,...}`; `npm test` passes. Look at `finance-en-wealth-640.png` in `QA_OUTPUT` (Change view) for clipped columns.

- [ ] **Step 6: Leave uncommitted;** add a hand-over note `holdings-price-split.md` in the shared notes folder (files changed, what to check on the first live run: a record appears in `holdings-days.json` after opening the Networth tab, the next day's 1D view).
