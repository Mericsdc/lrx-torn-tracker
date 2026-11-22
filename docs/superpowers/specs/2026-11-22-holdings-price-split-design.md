# Finance › Networth › Holdings: price effect vs trading

Date: 2026-11-22 · Builds on the Holdings card (`docs/superpowers/specs/2026-11-22-finance-holdings-design.md`),
which left this split out as a later step.

## Intent

The owner (a Torn player) asked why their networth falls even when they sell above market value. The answer is the
price effect on the stock they still hold: if 4,700 Xanax stay in the bazaar and Torn's market value drops $10K each,
that is −$47M, while each sale only adds (sale price − market value). Today the app cannot show this: Holdings shows
what the items are worth *now*, nothing about how that value moved.

- **Goal:** for each item (and each place), split the value change over the chosen period into
  - **price effect** = what Torn's market value moving did to what is held, and
  - **bought / sold** = what changing the quantity did (buying, selling, listing, moving between places),
  and tie the total back to the networth change: "Networth −$40M = price effect −$47M + rest +$7M".
- **Non-goals:** per-sale profit (sale prices are not visible: the owner's key is Limited, no logs), price history
  charts per item, alerts, buy/sell advice, items in trades / auction house / bookie (not in Holdings either).
- **Anti-goals:** no new Torn requests and no background polling (records are taken only when the Holdings card loads,
  which already happens only while it is shown); nothing that looks exact when it is an estimate; no surprise data on
  disk when the feature is off.

## Decisions with the owner

- **Periods (owner picked A):** the Networth tab's own period bar (1D / 7D / 30D / 90D / 1Y), so the split sits next to
  the tab's "Change" figure. Records are kept 365 days, like the networth record.
  (B, "since I last looked", was turned down: it would not line up with the period bar.)
- **Look (owner picked B):** a **Value | Change** switch inside the Holdings card. "Change" shows its own table sorted
  by the size of the change. (A, two more columns in the value table, was turned down: 8 columns at 640 px, the biggest
  movers can fall below the top 25, fully sold items would show as $0 rows.)
- **Item Market listings leave the inventory** (owner, answering the Holdings spec's open live-run check): Items and
  Item Market do not count the same items twice, so listing or moving items between places nets to about $0 in All.
  No change to `holdings.js` is needed for this.
- Everything below marked *(my call)* was played back to the owner and not objected to.

## Approaches

- **Chosen: daily per-item record on disk + split in the client.** The server writes one compact record per Torn day
  when Holdings load; `/api/holdings` sends back the few past records the periods need; `finance-math.js` does the
  split. One place for the math (pure, unit-tested), nothing new asked from Torn.
- Rejected: storing only daily item *prices* and taking the bought/sold part as "networth part change − price effect".
  Smaller file, but no per-item quantities (no "5,000 → 4,700"), and it mixes Torn's own timing/pricing with ours.
- Rejected: keeping records in `history.json`. That file is rewritten every few minutes by unrelated pollers; ~2 MB of
  item records would be rewritten with it. A separate file is written only when Holdings load.

## Data on disk *(my call)*

New file `data/holdings-days.json` (in `dataDir()`, next to `history.json`):

```json
{
  "v": 1,
  "ownerId": 123456,
  "names": { "206": ["Xanax", "Drug"], "s25": ["Torn City Investments (TCI)", "Stock"] },
  "days": {
    "2026-11-21": {
      "at": 1763740800000,
      "nw": 12500000000,
      "places": { "inventory": { "206": [10, 830000] }, "bazaar": { "206": [4700, 830000] }, "stocks": { "s25": [1000, 1200.5] } }
    }
  }
}
```

- One record per **Torn day** (`tctDate(h.at)`, the same 18:00 TCT boundary the networth record uses). Each fresh
  Holdings load (not a cache hit) updates that day's record: a place that loaded (`ok`, not `partial`) replaces that
  place; a place that failed or is partial keeps the day's earlier list (or stays absent).
- Row = `[qty, unit]`, `unit` = `value / qty` rounded to cents; only rows with `qty > 0`. Ids as Holdings uses them
  (item id; stocks `'s' + stock_id`). A place that loaded with nothing in it is stored as an empty place `{}`, so it
  never shows later as "no record". *(my call)*
- `nw` = the networth total at the moment of the record: the current `history.networth[tctDate()]` record's `total`
  when that record was written in the last 15 minutes (the Networth tab loads `/api/networth` right before Holdings);
  otherwise left out. A later load the same day replaces `nw` when it has a fresh one and removes it otherwise (an
  old `nw` would not match the updated places). *(my call)*
- No record is written while the history owner is not known yet. *(my call)*
- `names` = name and type of every id in any kept record (so fully sold items can still be named); refreshed from each
  load, pruned to ids still referenced.
- Kept **366 days** by date (records dated before today − 366 days are dropped), so 1Y always has its start.
- Size: ~6 KB a day for ~300 item types, ~2 MB a year at most.
- **Owner:** the file belongs to one player. `ownerId` is the history owner when written; a file whose `ownerId` is not
  the current owner is treated as empty. When `adoptPlayer()` drops the previous player's history, this file is
  emptied too.
- Written with the existing `writeJson` (tmp + rename), right after a record changes. Fresh Holdings loads are at most
  one per 30 s (Refresh) and normally one per 10 min, so this is rare.
- **Switch off** (`finance.priceSplit` or `finance.holdings` false in `config.features`): no record is written and
  `/api/holdings` sends no `split`. Existing records are kept (not deleted) so turning it back on resumes.

## Server

- New pure module `src/server/holdings-days.js` (CommonJS, no I/O):
  - `snapshot(holdings)` → `{ at, places, names }` from a `loadHoldings()` reply.
  - `record(file, day, snap, { nw })` → a new file object (merge into that day, prune by date, refresh/prune names).
  - `starts(file, today, periods = [1, 7, 30, 90, 365])` → `{ today, starts: [...], names }`: the start record each
    period would use, deduplicated, oldest first, only records dated before `today`, plus `names` for every id in them.
    The start rule is the networth one (`LRXFinanceMath.periodStart`): 1D = the record dated exactly the day before
    `today`; otherwise the oldest record dated within the last n days.
  - `empty(ownerId)` and `forOwner(file, ownerId)` (a file of another owner → empty).
- `src/server/server.js`:
  - `HOLD_DAYS_FILE = path.join(DATA, 'holdings-days.json')`, loaded lazily with `readJson`.
  - `getHoldings(force)` keeps its cache as it is; after it has the reply, when the switch is on: if this reply's `at`
    has not been recorded yet and the API key generation did not change while loading, record it and write the file;
    then return `{ ...reply, split: starts(...) }` (a new object, the cached reply is not changed).
  - `adoptPlayer()`: when the player changed, empty the file.
- `/api/holdings` reply gains `split: { today: 'YYYY-MM-DD', starts: [{ date, at, nw?, places }], names }`.

## Client math (`public/finance-math.js`)

`holdingsChange(h, start, names, place = 'all')` → `{ place, rows, price, trade, total, counted, excluded, unchanged }`

- `h` = the Holdings reply as the card holds it (after `holdingsMerge`, so a stale place still has its last rows);
  `start` = a record from `split.starts`; `names` = `split.names`.
- **Counted places:** places that are `ok`, not `partial`, not `stale` now, and present in `start.places`. Every other
  place that has rows now or at the start goes to `excluded: [{ key, why: 'failed' | 'partial' | 'nostart' }]`
  (a `stale` place — it failed on this load and shows its last list — counts as `failed`: its rows are older prices).
  *(my call)*
- Per counted place `k`, per id in the union of the start rows and the current rows:
  - `q0, u0` from the start (`[qty, unit]`), `q1, v1` now (`u1 = v1 / q1`); an item not held at the start has
    `q0 = 0, u0 = u1` (all of it is bought / moved in); an item no longer held has `q1 = 0` and no `u1`.
  - **price** = `q1 × (u1 − u0)` (what is still held, re-priced: the owner's 4,700 × −$10K example);
  - **trade** = `(q1 − q0) × u0` (the quantity change at the start price);
  - **total** = `q1·u1 − q0·u0` = price + trade (exact, no remainder).
- One place: rows are that place's items. `all`: per id summed over counted places (`places` = where it sits now or
  sat at the start), so moving 100 Xanax from Items to the Bazaar nets to ~0. Display units for a merged row:
  `u0 = V0 / Q0`, `u1 = V1 / Q1` (null when the quantity is 0).
- Name / type: the current row's, else `names[id]`, else `#id`.
- Rows whose price, trade and total all round to $0 are counted in `unchanged`, not listed. Sort by |total|, then
  |price|, then name.
- Networth tie (only for `all`, in the card code): `nwStart = start.nw ?? (networth history record dated start.date)?.total`
  (the fallback is marked "~"), `nwNow = st.nw.current.total`; **rest** = `(nwNow − nwStart) − price`. Left out when
  either side is missing, `/api/networth` failed, **or any place is excluded** — an excluded place's whole change
  (its price effect too) would land in Rest and make it read as trading, the very misreading this feature fixes.
  The card then shows the place-style summary (Value change · Price effect · Bought / sold) and a note
  "Rest needs every place: Bazaar could not load". *(my call)*

## Card (`public/finance.js`)

- Switch `finance.priceSplit` (parent `page.networth`, default on; free, `legacy` list in `feature-catalog.js`).
  Works only with `finance.holdings` on. Settings text: EN "Price effect vs trading" / "Splits the Holdings change into
  Torn's price moves and your buying and selling; keeps a daily item record on this computer", TR pair.
- The **Value | Change** switch (`role=group`, buttons `data-hold-mode="value|change"`, `aria-pressed`) sits in the
  card head; shown only when the switch is on and the reply has `split`. Choice remembered in
  `tt.finance.holdingsMode` (default Value). Place chips, "Show all" and the chosen place are shared by both views.
- **Change view** for the tab's period `st.nwDays`; start = `periodStart([...split.starts, { date: split.today }], n)`.
  - Head right side: "30D · since 3 Nov" (`nwLabel`, `shortDate`).
  - Chips show each place's signed **total change** ("—" for an excluded place). The All chip sums counted places.
    A place held at the start but empty now (all sold) still gets a chip in this view. *(my call)*
  - Summary (`.ic-summary.fin-hold-sum`):
    - All with networth: **Networth · since 3 Nov** (signed change) · **Price effect** ("Torn's prices, on what you
      hold") · **Rest** ("your trading profit, income and spending").
    - A place, or All without networth: **Value change** · **Price effect** · **Bought / sold**.
  - Table `#fin-hold-change`: Item · Place (All only) · Qty ("5,000 → 4,700") · Unit change (signed, "—" when a side
    is missing) · Price effect · Bought / sold · Total, coloured with `deltaCls`. Top 25, then "Show all N".
    Places column and Unit change hide at ≤ 700 px (the existing container query).
  - Notes (muted, under the table): "Sold items move their value into cash; a sale's profit is in Rest" (All) ·
    "Torn market value; bought / sold uses the start price" · "N items unchanged" · one line per excluded place
    ("Item Market: no record on 3 Nov" / "could not load" / "long list, not counted").
  - Empty states: `split.starts` empty → "Building history: a Holdings record is saved each day you open this tab;
    the change view fills from tomorrow." Records exist but none in this period → "No Holdings record in this period:
    records are saved only on days you open the Networth tab. Pick a longer period." (1D: "No record from yesterday.")
- Value view: unchanged from today.
- Every text EN default with a TR pair (`tr()`); item names stay escaped (`esc(decode(...))`).

## Tests

- `tests/unit/holdings-days.test.mjs` (vitest): snapshot (ok places only, partial and failed skipped, qty > 0, unit
  rounding, names incl. stocks); record (same-day merge keeps a failed place's earlier list, new day, prune by date,
  names pruned); starts (1D exact yesterday, 7D/30D oldest in window, today excluded, dedupe, names for the starts,
  empty file); owner mismatch → empty.
- `tests/unit/finance-math.test.mjs`: `holdingsChange` — the owner's Xanax example (5,000 @ $840K → 4,700 @ $830K:
  price −$47M, trade −$252M, total −$299M); new item; fully sold item named from `names`; Items → Bazaar move nets to
  0 in All; excluded places (failed / partial / no start); unchanged rows counted; sort.
- `tests/core.test.js` (or a new node test): `/api/holdings` with stubbed Torn replies writes `holdings-days.json` and
  returns `split`; a second call from the cache does not rewrite; switch off → no file, no `split`.
- `tests/finance-ui-smoke.js`: the switch shows; Change view rows, chips, summary with Rest, "since" label, period
  change re-picks the start, empty states (no starts / none in period), fully sold row, `finance.priceSplit` off → no
  switch, TR texts, 640 px without sideways scroll, no NaN.

## Left to the builder

Exact wording of short labels, column widths, whether Qty shows "→" or two columns at narrow widths, toggle styling
(reuse `.toggle`).
