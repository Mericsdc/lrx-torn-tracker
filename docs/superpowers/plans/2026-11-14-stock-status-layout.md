# Stock Status Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Stock Status product cards and two-line Order Timing panel with 4 KPI tiles, a one-line delivery bar with a "Set order time" menu, and a products card (storage bar + one row per product).

**Architecture:** Rendering stays in `renderStock(c)` in `public/app.js` (template strings, `tr()` pairs); markup hooks in `public/index.html` `#view-stock`; styles in the Stock section of `public/styles.css`. Existing delegated click handlers (`data-order-sync`, `data-order-mode`, `data-stock-torn-sync`) and `tick()` (`data-eta`, `data-eta-bar`) are reused unchanged.

**Tech Stack:** Vanilla JS + CSS (container queries), Playwright smoke with installed Chrome, Node fixture server `tests/preview-server.js`.

**Spec:** `docs/superpowers/specs/2026-11-14-stock-status-layout-design.md`

## Global Constraints

- English default; every new string through `tr('TR', 'EN')`.
- No new Torn requests; "Get exact times from Torn" only calls `openInTab('https://www.torn.com/companies.php#/option=stock', { activate: true, reuse: true })`.
- Do not edit `public/themes.css`, `public/beginner-guide.js`, `public/levelling.js`; in shared files touch only Stock Status parts.
- No new animations; `body.no-anim` and reduced motion already zero transitions globally.
- Colours from CSS variables (`--text`, `--muted`, `--muted-2`, `--stroke`, `--stroke-2`, `--tq`, `--ok`, `--warn`, `--danger`) plus the product `PALETTE`.
- Do not commit, push or release.

## Review Focus

- `storage.space` null (no storage upgrade data): label shows used only, bar scales to stock + order, table still renders.
- A product with `avgDaily` 0 (`daysLeft` null): "∞" text, cover bar width finite (no `NaN%`).
- No product on order: delivery bar says no orders in transit, menu still present and usable, On order hint "no active orders".
- A re-render (periodic refresh, language switch) while the menu is open keeps it open.
- 640 px in Turkish: no sideways page scroll; rows shown as cards.

---

### Task 1: Failing Stock Status smoke

**Files:**
- Exists: `tests/stock-fixture.js` (`stockCompany({ now, rows, coverDays, space, mode })`, `DEFAULT_ROWS`)
- Create: `tests/stock-ui-smoke.js`

**Interfaces:**
- Produces (DOM contract Task 2 must satisfy):
  - `#stock-kpis > .kpi` × 4; labels EN `In stock`, `On order`, `Storage used`, `Company funds`.
  - `#delivery-card .stock-next [data-eta]` countdown of the earliest order; `#delivery-card [data-eta-bar]` × 1.
  - `#delivery-card details.stock-sync` (closed by default) with `summary` text `Set order time` and inside it `[data-order-sync="0".."4"]` + `[data-order-mode="18tct"]`.
  - `#product-table tbody tr[data-product]` one per product, in fixture order; cells carry `data-label` (column name) for the narrow layout; `td.st-lasts` text contains `1.4d → 3.3d`; `td.st-arrives [data-eta]` for products on order; `.st-cover i` widths finite.
  - `#storage-label`, `#storage-bar` (2 `<i>` per product), `#storage-legend`.

- [ ] **Step 1: Write the smoke.** Fork `preview-server.js` with a temp data dir (features `app.splash`, `app.animations`, `app.updates`, `app.newYearWelcome` off), install a paused page clock at a fixed time, stub `window.electronAPI = { tabCreate }`, route `/api/stock-order` POST to a fixture reply and record its body, hide the auth screen, `applyCompanyMode(true); state.company = stockCompany({ now }); renderCompany(); showView('stock')`. Assert:
  - 4 KPI labels as above; no text `First delivery`.
  - delivery countdown text `00:28:00` (fixture ETA = now + 28 min); after `clock.runFor(1000)` + `tick()` it reads `00:27:59`.
  - menu closed; click summary → open, 6 buttons visible; `Escape` closes; open again, click `[data-order-sync="2"]` → POST body `{ hoursAgo: 2, deliveryMode: 'hours' }`.
  - spy `openInTab`; click `[data-stock-torn-sync]` → called with the stock URL.
  - 6 rows `Bra, Thong, Corset, Knickers, Stockings, Suspenders`; Bra row: `22,789`, `16,825`, `1.4d → 3.3d`, `+33,100`; Stockings row: status `Low`, suggested `5,100`; Suspenders row: status `Critical`, arrives hint contains `Torn timer`.
  - Review Focus: `space: null`; a row with `avgDaily` 0 (cover widths finite, `∞`); a no-order fixture (text `No stock orders currently in transit.`, menu present, KPI hint `no active orders`); menu open + `renderCompany()` → still open.
  - TR: click `#lang-toggle [data-lang="tr"]` → headers include `Ürün`, `Siparişte`; summary `Sipariş zamanını ayarla`; `Sonraki teslimat`.
  - widths 1440, 1100, 640 in EN and TR: `document.documentElement.scrollWidth <= innerWidth`; at 640 the `thead` is not displayed; screenshots to `QA_OUTPUT`.
  - no `pageerror`, no CSP console errors.
- [ ] **Step 2: Run it and see it fail.**
  Run: `PLAYWRIGHT_MODULE=D:/Meric/TORN/updates/ui-validation-deps/node_modules/playwright node tests/stock-ui-smoke.js`
  Expected: FAIL on the KPI count (5 ≠ 4).

### Task 2: New Stock Status layout

**Files:**
- Modify: `public/app.js` — `renderStock(c)` (≈ lines 739–814); a small menu close handler next to the stock click delegation (≈ line 1522).
- Modify: `public/index.html` — `#view-stock` (≈ lines 305–317): replace the storage card + `#product-cards` grid with one `article.glass.card.stock-products` holding the card head (`#storage-label`), `#storage-bar`, `#storage-legend`, `table.tbl#product-table`.
- Modify: `public/styles.css` — replace "Product cards" and "Delivery Tracking Card" rules (≈ lines 326–341) and `#delivery-card .card-head` (≈ line 884).

**Interfaces:**
- Consumes: Task 1 DOM contract; `kpi()`, `statusLabel()`, `daysTxt()`, `hoursTxt()`, `clock()`, `n0()`, `money()`, `cmoney()`, `pct()`, `PALETTE`, `timeLocale()`.

- [ ] **Step 1: Implement** per the spec Design section. Keep `details.stock-sync[open]` across re-renders (read the old element's `open` before replacing `innerHTML`). The menu panel is absolutely positioned under the summary; outside click and `Escape` close it. Cover bar scale = `max(daysLeftWithOrder, coverDays)` with a target marker at `coverDays`; null days → width 0. Narrow layout via `container-type: inline-size` on `.stock-products` and `@container (max-width: 820px)`.
- [ ] **Step 2: Run the smoke** — Expected: `{"ok":true,...}`.
- [ ] **Step 3: Look at the screenshots** (1440/1100/640 × EN/TR) and adjust spacing.

### Task 3: Full verification and TEST copy

- [ ] Run `npm run check`, `npm test`, `npm run test:premium`; then `tests/ui-smoke.js`, `tests/overview-ui-smoke.js`, `tests/premium-ui-smoke.js`, `tests/feature-modules-ui-smoke.js`, `tests/electron-smoke.js`, `tests/stock-ui-smoke.js` with `PLAYWRIGHT_MODULE` and `QA_OUTPUT` set. Expected: all pass.
- [ ] Copy `public/app.js`, `public/index.html`, `public/styles.css`, `tests/stock-fixture.js`, `tests/stock-ui-smoke.js` and the spec/plan docs to `D:\Meric\TORN\LRX-Torn-Tracker-TEST\resources\app\…`; `cmp` each pair. Shared files (`app.js`, `styles.css`, `index.html`) carry other sessions' unreleased edits too — note that in the hand-over.
