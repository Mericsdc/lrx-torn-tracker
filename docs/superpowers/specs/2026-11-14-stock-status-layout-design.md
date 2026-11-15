# Stock Status layout — design (short)

## Intent
The owner finds the Stock Status page cluttered: every product card repeats the same delivery box, six labelled
numbers of equal weight, a price line and a "None needed" chip, and the Order Timing panel spreads a long note and
seven buttons over two lines. The page should read like a professional stock screen: the question "will anything
run out, and when does the order land?" answered at a glance.

## Goals
- One product per row (table) so all products fit on one screen at desktop width.
- The most important number per product first: how long the stock lasts, now and with the order.
- One shared delivery line instead of a delivery box per product.
- Secondary text (price, RRP, cost, last-day sales, hours) quieter, never removed.
- EN default, TR pair for every string; narrow and wide widths; reduced motion and `body.no-anim` respected.

## Non-goals / anti-goals
- No change to server data, `/api/company`, `/api/stock-order` or the Torn "Delivered in" reading.
- No new Torn requests, no clicks on Torn. "Get exact times from Torn" still only opens the stock page tab.
- Nothing dropped: every number, both actions, all six manual sync options and every countdown stays.
- No edits to `public/themes.css` (owned by the Themes session); colours come from existing CSS variables.

## Approaches (picked in conversation)
- **A · Table** — picked. Densest, all products visible; at narrow widths each row becomes a small card. Trade-off:
  it resembles the Daily Report table, so the "lasts" cover bar is the row's visual anchor.
- B · Compact cards — keeps the card look at half the height; still one card per product, more scrolling.
- Manual sync: **"Set order time ▾" menu** — picked (vs. a visible quiet button row).

## Design
1. **KPI row: 4 tiles** — In stock (N products) · On order (hint: "next in" countdown, or "no active orders") ·
   Storage used (free space) · Company funds (ads/day). The First delivery tile goes; its countdown lives in the
   On order hint and the delivery line.
2. **Delivery line** (`#delivery-card`, one row, wraps on narrow screens): truck icon, "Next delivery", countdown,
   meta "· N products · ~18:42 · estimate|Torn timer ✓ · reset 18:00 TCT (countdown)", a thin progress bar for
   the next delivery; right side: "Get exact times from Torn" (primary while times are estimates, Electron only)
   and a "Set order time ▾" `<details>` menu with the six existing buttons (`data-order-sync` 0–4,
   `data-order-mode="18tct"`). The long "Times are estimates…" sentence moves into the estimate tag's and the
   button's tooltip. Menu: closed by default, Escape or an outside click closes it, keeps its open state across a
   re-render.
3. **Products card**: header "Products" + "Storage used / space"; the storage bar (solid = in stock, striped = on
   order) with a one-line muted legend; then the table:
   Product (colour dot, name; muted "Price · RRP · Cost" line) · Status chip · In stock · Sales/day (muted "last
   day N") · Lasts → with order (days, muted hours, cover bar with a target marker at the cover-days setting) · On
   order · Arrives (countdown, muted "~18:42 · estimate", Safe ✓ / Runs out ⚠) · Suggested (units, muted cost; "—"
   when none needed).
4. **Narrow**: a container query on the products card turns rows into two-column cards with inline labels.
5. Old product-card CSS (`.product`, `.pgrid`, `.product-delivery`, …) is removed from `styles.css`.

## Left to the builder
Exact spacing, column widths and the container-query breakpoint, chosen from screenshots at 1440 / 1100 / 640.

## Tests
New `tests/stock-ui-smoke.js` (fixture `tests/stock-fixture.js`, synthetic numbers, no Torn requests): tiles,
delivery line, menu open/close and a manual sync POST, Torn-sync opening the stock tab, one row per product with
the right values, countdown ticking, TR strings, widths 1440/1100/640 without sideways scroll, no page errors.
