# Live Timer Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One free Overview widget, `timers`, that shows the drug, education and day-reset countdowns side by side under a LIVE header, replaces the three timer cards in the default layout, and takes their place once in saved layouts.

**Architecture:** The layout module (`public/overview-layout.js`, shared with the desktop server) gains the widget, the new default and a one-time v1 → v2 migration inside `normalize`. The strip is static markup in `index.html` like the other free widgets; `app.js`'s one-second `tick()` paints every copy of a timer (card and strip) through one function and paints the live header from the overview's age. Styles live in `overview.css`.

**Tech Stack:** plain browser JS (UMD module for the layout rules), CSS container queries, vitest (unit), node:test (server), Playwright smokes.

**Spec:** `docs/superpowers/specs/2026-11-13-overview-widgets-design.md`, Addendum 2.

## Global Constraints

- No new Torn request: only the overview the app already fetches and the local clock.
- Every new UI text has TR and EN (`tr()`), English is the default language.
- The pulse and the bar movement stop under the Animations switch (`body.no-anim`) and `prefers-reduced-motion`.
- Torn text goes through `esc()`/`textContent`, never markup.
- `timers`: tier `free`, sizes `L` and `W`, default `L`; label "Live timers" / "Canlı sayaçlar".
- Default layout: `profile, timers, bars, chips, battle, company`.
- LIVE turns DELAYED when the overview is older than 90 s.
- Saved sets from before (v 1 or no v) with all three of `drug`, `edu`, `day` get one `timers` (L) where the first of them was; output sets are v 2 and are never migrated again.
- The classic screen (layout switch off) is unchanged.

## Review Focus

1. Before the first overview arrives the header must not claim LIVE: no `is-live`/`is-stale` class, label `—` (Task 2 test).
2. A v1 set whose three timer cards are apart (drug first, day last) still becomes one strip at drug's place (Task 1 test).
3. A member who puts the three cards back after the migration keeps them: a v2 set is never migrated (Task 1 test).
4. The education value ("12d 05:12:56") stays on one line in the strip at 1280, 1366 and 1440 (Task 2 test).
5. At 2 columns the strip sits beside the profile with no hole (profile and strip end together) (Task 2 test).

---

### Task 1: Layout rules — the `timers` widget, the new default and the migration

**Files:**
- Modify: `public/overview-layout.js` (WIDGETS, DEFAULT_IDS, defaultSet, normalize)
- Test: `tests/unit/overview-layout.test.mjs`, `tests/account.test.js` (sets come back as v 2)

**Interfaces:**
- Produces: `byId.timers = { id: 'timers', tier: 'free', sizes: ['L', 'W'], size: 'L' }`, placed after `day` in `WIDGETS`; `defaultSet()` → `{ v: 2, active: 0, layouts: [{ name: '', widgets: [profile S, timers L, bars M, chips S, battle L, company W] }] }`; `normalize(raw)` always returns `v: 2`.

- [ ] **Step 1: Write the failing tests** in `overview-layout.test.mjs`:
  - default set ids `['profile','timers','bars','chips','battle','company']`, sizes `['S','L','M','S','L','W']`, `v` 2; the widgets beside the S profile (`slice(1, 4)`) fill 6 cells.
  - catalogue: free ids `['profile','drug','edu','day','timers','bars','chips','battle','company']`; `row('timers')` is `{ tier: 'free', sizes: ['L','W'], size: 'L' }`.
  - `it('a saved set from before the strip gets one strip where the first timer card was')`: `normalize({ v: 1, active: 0, layouts: [{ name: 'A', widgets: [drug S, bars M, edu S, chips S, day S] }, { name: 'B', widgets: [drug S, edu S] }] })` → layout A ids `['timers','bars','chips']` with timers `L`; layout B unchanged; result `v` 2. Same for a set with no `v`.
  - `it('a set saved after the strip is never migrated')`: `normalize({ v: 2, ..., widgets: [drug, edu, day] })` keeps the three cards; `normalize(normalize(x))` equals `normalize(x)` for the v1 input above.
  - Update the existing expectations that read `v` 1 or the old default ids to the new values.
- [ ] **Step 2: Run** `npx vitest run tests/unit/overview-layout.test.mjs`. Expected: the new tests FAIL (no `timers`, v 1).
- [ ] **Step 3: Implement** in `overview-layout.js`: the row, the default ids, `v: 2` in `defaultSet` and `normalize`, and in `normalize` a `migrate(widgets)` applied to each layout's cleaned list only when `raw.v !== 2`: when ids include drug, edu and day, put `{ id: 'timers', size: 'L' }` at the first of them and drop the three (skip if `timers` is already there).
- [ ] **Step 4: Run** the vitest file, then `node --test tests/account.test.js` after changing its expected sets to `{ ...set, v: 2 }`. Expected: PASS.

### Task 2: The strip — markup, live painting and styles

**Files:**
- Modify: `public/index.html` (the `timers` article after `#t-day`), `public/app.js` (`tick()`), `public/overview.css`
- Test: `tests/overview-ui-smoke.js` (and any other smoke that assumes the old default; grep for `t-drug`, `data-timer`, `'drug'`)

**Interfaces:**
- Consumes: Task 1's `timers` widget and default layout.
- Produces: markup `article.glass.card.ow-w.ls-card[data-widget="timers"]` containing `.ls-head` (`#ls-live` with `.ls-dot` and `[data-ls-label]`, `#ls-fresh`) and `.ls-row` with three `section.ls-seg[data-ls="drug|edu|day"]`, each holding an icon + `.eyebrow` label, `.ls-value.mono[data-timer=key]`, `.timer-sub[data-sub=key]`, `.ls-bar > i`. In `app.js`: `paintTimer(key, { value, sub, frac, ready })` writes every `[data-timer=key]`/`[data-sub=key]`, toggles `.ready`, calls `setRing('#t-' + key, frac, ready)`, sets the strip bar width to `frac` and `.done` on the segment; `paintLive()` sets `#ls-live` to `is-live` (label `tr('CANLI','LIVE')`, fresh text `tr('N sn önce güncellendi','updated N s ago')`, minutes past 60 s: `N dk`/`N min`) or, past `LIVE_STALE_S = 90`, `is-stale` (label `tr('GECİKMELİ','DELAYED')`, text `tr('son veri … önce','last data … ago')`); with no overview yet, no class and label `—`.

- [ ] **Step 1: Write the failing smoke checks** in `overview-ui-smoke.js`:
  - `DEFAULT_IDS` becomes `['profile','timers','bars','chips','battle']`; the fixed-ID check accepts the timer values in both the cards and the strip.
  - At 1440: the strip is in row 1 beside the profile; three segments share one top; values match `/^\d\d:\d\d:\d\d$/` (drug, day) and `/^12d \d\d:\d\d:\d\d$/` (edu), each on one line; after 1.2 s the day value has changed; `#ls-live` has `is-live`, label `LIVE`, `#ls-fresh` matches `/^updated \d+ s ago$/`.
  - Stale: set `state.overviewAt = Date.now() - 200_000`; next tick → `is-stale`, `DELAYED`, `/^last data 3 min ago$/`; restore and see `LIVE` again.
  - Before data: on a fresh page before the overview reply, `#ls-live` has neither class and the label is `—` (Review Focus 1).
  - The education one-line check at 1280/1366/1440 measures the strip's `[data-timer="edu"]` (Review Focus 4).
  - At 1100: the strip is 1 column and 3 rows, its segments stacked, and it ends with the profile within 2 px (Review Focus 5).
  - Adapt the sections that relied on the three cards in the default layout (free-player edit and drag tests, add list order) to the new default; tests that need movable single-column widgets show them through an explicit set.
- [ ] **Step 2: Run** the overview smoke. Expected: FAIL on the default ids / missing strip.
- [ ] **Step 3: Implement** the markup, `paintTimer`/`paintLive` (replacing the three timer blocks in `tick()`, same values and texts as today), and the CSS: three columns with dividers, value size from the segment width (container units, 12 mono characters fit), 3 px bars with a 1 s linear width transition, pulsing dot (keyframes), amber when stale, accent bar and value when done; `@container` stacks the segments when the strip is narrower than about 520 px; at `max-width:1200px` the strip is `span 1` columns and `span 3` rows.
- [ ] **Step 4: Run** the overview smoke, then every suite: `npm run check`, `npm test`, `npm run test:premium`, and the five smokes. Expected: all pass. Copy the changed files to the TEST install.
