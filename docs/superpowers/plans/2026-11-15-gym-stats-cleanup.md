# Gym & Stats Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `renderGym()` into the owner-approved layout A: 4 KPIs, "Your stats" beside a 180 px chart, the day table collapsed; fix the shared line chart's stroke, label overlap and repeated y labels.

**Architecture:** Plain DOM strings in `public/features.js` (as today), Gym-only CSS in `public/styles.css` scoped under `#gym-body` with a container query. A new browser smoke `tests/gym-ui-smoke.js` drives the real page on the fixture server with `/api/stats` routed to synthetic data.

**Tech Stack:** Vanilla JS/CSS, Playwright (installed Chrome) via `PLAYWRIGHT_MODULE`.

**Spec:** `docs/superpowers/specs/2026-11-15-gym-stats-cleanup-design.md`

## Global Constraints

- English default, Turkish via `tr(tr, en)`; Torn stat names (Strength, Defense, Speed, Dexterity) stay English in both.
- No new Torn or server requests; energy comes from `state.overview?.bars?.energy` only.
- Edits stay in the Gym parts of shared files; `lineChart()` changes must keep every other caller's output the same apart from the three bug fixes.
- No new animation; nothing to add for reduced motion / `body.no-anim`.
- localStorage access wrapped (`lsGet` / `lsSet` in `features.js`).
- Do not commit, push or release.

## Review Focus

- No history at all (fresh install): KPIs show the total from `d.battle`, the stats card says "No records yet", no day card, no NaN/undefined.
- One record: "Building history" box instead of the chart, every gain cell "—".
- Older records without `xantaken` / `refills` (null): "—", never NaN.
- A nearly flat 2-record history (gain of a few hundred on millions): every y label distinct and fully inside the SVG.
- Narrow window (520 px): no sideways page scroll; tables may scroll inside `.tbl-wrap` only.

---

### Task 1: Gym smoke test (failing first)

**Files:**
- Create: `tests/gym-ui-smoke.js` (pattern: `tests/employees-ui-smoke.js` — fork `tests/preview-server.js`, abort every non-local request, `tt.lang` via init script, screenshots to `QA_OUTPUT`)

**DOM contract the test asserts (Task 2 produces it):**
- `#gym-body .gym-kpis > .kpi` ×4, labels EN `Total battle stats · Since yesterday · Last 7 days · Last 30 days`, TR `Toplam battle stat · Dünden beri · 7 günde · 30 günde`.
- `#gym-stats` card: `.storage-bar > i` ×4; `tbody tr[data-stat]` for `str, def, spd, dex`, cells: name, value, share, 24h gain, 7-day gain.
- `#gym-foot [data-gym="energy"]` = `Energy 120/150` (TR `Enerji 120/150`); `[data-gym="usage"]` contains the 7-day Xanax and refill counts.
- `#gym-chart svg`: rendered height 150–200 px at every width; the area `path[fill^="url("]` has computed stroke `none`; x labels inside the SVG and not overlapping; y labels distinct.
- `details#gym-days`: closed by default, 30 `tbody tr`; opening it sets `localStorage['tt.gym.days'] = '1'` and it stays open after `loadGym()` re-renders.
- Widths 1440/1100/760/520: no sideways page scroll; at 1440 `#gym-stats` and the chart card share a top edge; at 760 the chart card is below.
- 1440 px, day table closed: `#gym-body` shorter than 700 px.
- Edge data (Review Focus lines 1–4) render without NaN/undefined/null/Infinity.

- [ ] Step 1: write the test; Step 2: run `node tests/gym-ui-smoke.js` — expect FAIL on the KPI count (5 today).

### Task 2: New `renderGym()`, Gym CSS, chart fixes

**Files:**
- Modify: `public/features.js` — `lineChart()` (area `stroke="none"`; option `tickFmt = (v, step) => fmt(v)` used for y labels; last x label `text-anchor="end"`, a regular label dropped when within 60 px of the last); new `gymTick(v, step)` (unit by magnitude of `v`, decimals `clamp(ceil(log10(unit / step)), 0, 4)`, `n0` under 1,000); `renderGym(d)` rewritten to the contract above, chart `height: 180`, `tickFmt: gymTick`, dot titles `n0`.
- Modify: `public/styles.css` — Gym block: `#gym-body { container-type: inline-size }`, `.gym-kpis` 4 columns (2 at ≤ 640 px container), `.gym-main` 2 columns (1 at ≤ 860 px), `.chart.gym-chart svg { height: auto }`, footer and `<details>` summary styles.

- [ ] Step 1: implement; Step 2: `node tests/gym-ui-smoke.js` PASS; Step 3: `npm run check`, `npm test`, `npm run test:premium`, every UI smoke (`ui`, `overview`, `premium`, `feature-modules`, `electron`) PASS.

### Task 3: TEST copy

- [ ] Copy `public/features.js` and `public/styles.css` to `D:\Meric\TORN\LRX-Torn-Tracker-TEST\resources\app\public\`, check each with `cmp`.
