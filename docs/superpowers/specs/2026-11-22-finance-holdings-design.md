# Finance › Networth: Holdings card (which items the money sits in)

Date: 2026-11-22 · Owner request (TR): "Finans bölümünde paramın tam olarak hangi eşyalara yatırıldığını görebilmek.
Örneğin Bazaar'da 5 milyar dolarlık varlığım olduğunu gösteriyorsa, bu 5 milyarın 4 milyarının belirli bir eşyaya
yatırılıp yatırılmadığını da görmek istiyorum." Builds on the Finance page
(`docs/superpowers/specs/2026-11-15-finance-page-design.md`).

## Intent

The Allocation card says *where* the networth sits (Bazaar $5B, Items $600M…), not *what* it is. The player wants to
see, per place, which items make up the value, so a concentration like "$4B of the $5B bazaar is one item" is
obvious at a glance.

- **Goal:** a "Holdings" card on the Networth tab listing every item (and stock) the player holds, valued, sorted by
  value, filterable by place, with each row's share of the selected place.
- **Non-goals:** price history per item, buy/sell advice, alerts, editing listings, items held in trades / auction
  house / bookie / pending (Torn gives no per-item API for these), properties.
- **Anti-goals:** no requests to Torn pages (API only, own key); no background polling (load only while the
  Networth tab is open); no new data written to disk (holdings stay in memory); nothing that looks exact when it is an
  estimate.

## Approaches (owner picked A)

- **A. Separate Holdings card** with place filters (All / Items / Bazaar / Display Case / Item Market / Stocks). "All"
  merges one item across places (Xanax in inventory + bazaar). Clicking a part in Allocation opens the card on that
  place. **Chosen** ("Ayrı Varlıklar kartı").
- B. Expand each Allocation row into its top items. Simpler, but no cross-place totals and cramped at 640 px.

## Data (Torn API, the player's own key)

| Place (networth part)        | Request                                   | Access  | Value used                         |
|------------------------------|-------------------------------------------|---------|------------------------------------|
| Items (`items`)              | `v2/user/inventory?limit=250&offset=N`    | Minimal | catalog `market_value` × amount    |
| Bazaar (`bazaar`)            | `user/?selections=bazaar` (v1 fallback)   | Public  | `market_price` (else catalog) × qty; also the player's `price` |
| Display Case (`displaycase`) | `user/?selections=display` (v1 fallback)  | Public  | `market_price` (else catalog) × qty |
| Item Market (`itemmarket`)   | `v2/user/itemmarket?offset=N`             | Limited | catalog `market_value` × qty (see below); also the listing `price` |
| Stock Market (`stockmarket`) | `user/?selections=stocks` + `torn/?selections=stocks` | Limited | `total_shares` × `current_price` |
| prices                       | `torn/?selections=items` (already cached 1 h by the app) | Public | `market_value` per item id |

- The app already makes the two stocks calls and the items call (Stock Market page): the same cache keys are reused.
- Inventory is paged (250 per page) until a page has fewer than 250 rows or no `next` link; at most 8 pages.
  Torn itself caches inventory 15 minutes per category, so the card says so. *(My call)* When the cap is hit the
  place is marked `partial: true`: its total shows with "~", a note says only the first 2,000 rows are counted, and
  the comparison line with Torn's figure is left out.
- *(My call)* Item Market quantity = `min(amount, available)` when `available` is a number, else `amount`
  (`available` is documented as "amount remaining in the inventory", so the minimum never counts more than the
  player still has). Paging by `offset` until a page is empty or has no `next` link; at most 8 pages, same `partial`
  rule. To check on the first live run: Items + Item Market against Torn's two figures (if Torn also keeps listed
  items in the inventory reply, listed rows would count twice and must be taken out of Items).
- Rows with `faction_owned: true` (armory loans) are left out. Equipped items stay in.
- Unique items (weapons, armour: one row per `uid`) are merged by item id and valued at the catalog market value;
  the card notes that bonuses and quality are not priced.
- v1 bazaar / display replies are parsed defensively: `ID|id`, `quantity|amount`, `market_price|market_value`,
  missing price → catalog price, unknown shapes → that place shows an error instead of wrong numbers.
- Each place loads on its own: one failing place (access level, Torn error, rate limit) shows its reason in the
  card; the others still show.
- *(My call)* Cache: the whole `Holdings` object is cached 10 minutes as one entry (`cached('holdings', …)`); on a
  miss every place is asked fresh (ttl 0), except the 1-hour items catalog and the stocks calls shared with the Stock
  Market page (60 s). So `Holdings.at` is when the data was fetched; the Items place also carries Torn's own
  `inventory.timestamp`. Refresh (`force`) skips our cache. About 5–8 requests per load, well under the app's
  80/min throttle.
- The key change path (`resetKeyCaches`) already clears these caches.

## Server

- New pure module `src/server/holdings.js` (CommonJS, no I/O):
  - `loadHoldings({ get, force })` → `Promise<Holdings>`; `get(pathq, ttl)` is injected (server passes `torn`).
  - `Holdings = { at, places: { inventory, bazaar, display, itemmarket, stocks } }`, each place
    `{ ok: true, total, rows: [{ id, name, type, qty, unit, value, listed? }] }` or `{ ok: false, error }`.
    `listed` = the player's own price per unit (bazaar, item market). Stocks rows: `id` = `'s' + stock_id`,
    `name` = acronym + name, `type: 'Stock'`.
- `src/server/server.js`: `GET /api/holdings[?force=1]` → `loadHoldings({ get: torn-with-ttl, force })`.

## Client (Finance › Networth tab)

- Switch `finance.holdings` (parent `page.networth`, default on) in `public/features.js` and in the free `legacy`
  list of `feature-catalog.js` (owner: "Ücretsiz"). Off: no card, no `/api/holdings` request.
- Not in this build: splitting a networth change into a price effect and a buy/sell effect. It needs a daily
  per-item record on disk; proposed as a later step.
- Loaded after `/api/networth` (never delays the rest of the tab), only while the Networth tab is shown; Refresh
  passes `force`.
- Card **Holdings / Varlıklar**, placed right after the Allocation / What moved row:
  - Head: title; right side "market value · updated HH:MM".
  - Place chips (`role=group`, `aria-pressed`), each with its total: All · Items · Bazaar · Display Case · Item Market
    · Stocks. Places with no rows and no error are hidden. Choice remembered in `tt.finance.holdingsPlace`
    (default All).
  - Summary line for the selected place: total, Torn's networth figure for that place, and the biggest row with its
    share ("Biggest: Xanax 80%"). When our total and Torn's figure differ by more than 2 %, one neutral line says
    so ("$X differs from Torn's figure: Torn prices and times its networth itself"). "All" compares with the sum of
    the five matching networth parts. Left out for a `partial` place or when `/api/networth` failed.
  - Table: Item · Place (All only: the places it sits in) · Qty · Unit value · Value · Share (bar + %). Bazaar and
    Item Market add "Your price" (listed per unit). Sorted by value, top 25, then "Show all N".
    Zero-value rows (no market value) count in a footnote instead of the table's top.
  - A place that failed shows its reason as a muted line under the chips.
- Allocation: the part names Items, Bazaar, Display Case, Item Market, Stock Market become buttons that select that
  place in Holdings and scroll the card into view.
- Client math in `public/finance-math.js`: `holdingsView(holdings, place)` → `{ total, rows, biggest, places }`
  (merging by id for All, shares, sort). Escaping of every Torn name.
- EN default, TR pair for every text. Global `<svg>` rule untouched (no new SVG except the existing icon set).

## Tests

- `tests/unit/holdings.test.mjs` (vitest): normalisation of each source, paging stop, `faction_owned`, uid merge,
  missing prices, one place failing, stocks valuation.
- `tests/unit/finance-math.test.mjs`: `holdingsView` (All merge, shares, biggest, empty).
- `tests/finance-ui-smoke.js`: `/api/holdings` routed: chips, rows, share, Allocation click selects Bazaar, Show
  all, a failed place's reason, switch off → no request, TR, 640 px no sideways scroll, no NaN.

## Settled during the builder check (my calls)

- Force = ttl 0 to `torn()`; the uid merge applies to bazaar, display and item market rows too.
- Holdings load again when the player comes back to the Networth tab; the chosen chip and "Show all" survive
  `renderFinance()` re-renders.
- With the switch off, Allocation part names stay plain text. Holdings still load when `/api/networth` failed.
- The CommonJS module is imported from vitest the same way `finance-math.js` is.

## Left to the builder

Exact column widths and the "Show all" wording; whether a long Item name truncates or wraps.
