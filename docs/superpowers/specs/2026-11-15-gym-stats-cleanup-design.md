# Gym & Stats cleanup — short design (2026-11-15)

Approved by the owner on 2026-11-15 ("Evet, A'yı uygula") after seeing before/after screenshots with sample data.

## Intent
The owner said the Gym & Stats page looks cluttered and the chart is far too big. The page should read at a glance:
key numbers first, a sensibly sized chart, secondary detail grouped or collapsed. Nothing the page shows today may be lost.

## Today (`renderGym()` in `public/features.js`)
Five KPI cards (total, since yesterday, 7 days, 30 days, Xanax/refills 7 days), then a full-width 240 px area chart,
a whole card for one stat-distribution bar, and an always-open "Day by day" table of up to 30 rows (~1650 px tall at
1440 px). Chart bugs: the area path inherits the global `svg { stroke: currentColor }` (white line on the right and
bottom), the last two x labels overlap and the last one is clipped, and a small range repeats the same y label.

## Approaches
- **A — chosen.** 4 KPIs; a two-column row with "Your stats" (distribution bar + per-stat table) beside a short chart;
  the day table collapsed. One screen at 1440 px.
- B — chart kept full width as a ~140 px strip with the stats card under it. Less change, page still long.
- (Dropped) showing the active gym: needs an extra Torn `gym` selection, which the Torn rules here forbid.

## Design (A)
1. KPI row, 4 cards: Total battle stats · Since yesterday · Last 7 days (daily avg, records-cover hint) · Last 30 days.
   4 columns; 2×2 when the page body is narrow (container query on `#gym-body`).
2. Two columns (one column when `#gym-body` is ≤ 860 px wide):
   - **Your stats** card: thin distribution bar; table Stat · Value · Share · 24h · 7 days (per-stat gains, from the
     same records); a footer line: Energy now (from `state.overview.bars.energy`, already loaded, no request) ·
     Xanax, last 7 days · Refills, last 7 days (moved from the 5th KPI).
   - **Total stats history** card: the chart at 170–180 px tall, scaling with its width (`height: auto`), and a short
     "Building history" box under 2 records.
3. **Day by day** becomes a `<details>` card, closed by default, with the same columns and the last 30 records. Its
   open state is remembered per viewer in localStorage (`tt.gym.days`, try/catch).
4. Shared `lineChart()` fixes (also help Networth): `stroke="none"` on the area fill, the last x label anchored at the
   end, and a regular label dropped when it would touch the last one. The gym chart uses an axis format whose
   precision follows the tick step so no two y labels match.

## Constraints
EN default + TR via `tr()`; inline SVGs reset stroke/fill/size; respect reduced motion / `body.no-anim` (no new
animation); display only, no new Torn or server requests; edits limited to the Gym parts of shared files.

## Left to the builder
Exact spacing and class names; test layout: a new `tests/gym-ui-smoke.js` (fixture server, routed `/api/stats`).
