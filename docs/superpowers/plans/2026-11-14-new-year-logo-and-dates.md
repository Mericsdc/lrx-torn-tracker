# New Year: Christmas Town dates, no countdown, dressed-up logo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The New Year decorations follow Torn's Christmas Town dates. The midnight countdown is gone, and the celebration plays once on 1 January. The sign-in logo wears a Santa hat, an ice frame and Christmas lights during the season.

**Architecture:**
- `LRXNewYear.isSeason` (shared with the site copy) switches to the Christmas Town window in UTC.
- `LRXNewYearWelcome` loses every countdown part.
- A new app-only `LRXNewYearLogo.markup()` returns one deterministic SVG. `app.js` inserts it into a new `.auth-logo-stage` and toggles `#auth-screen.ny-dressed`.

**Tech Stack:** Plain browser JS (UMD), inline SVG + CSS animations, vitest (node), the Playwright `tests/ui-smoke.js`.

**Spec:** `docs/superpowers/specs/2026-11-13-new-year-sign-in-design.md`, "Addendum 3 (2026-11-14)".

## Global Constraints

- Season: from 19 December 16:00 UTC (inclusive) to 31 December 16:00 UTC (exclusive), every year.
- Celebration: 1 January local time only, once per computer per day, when the tracker is on screen. `?newyear=1` shows it on every start.
- No countdown, no `?newyear=midnight` and no `--newyear-midnight-preview` anywhere in the code, tests or docs comments.
- `website/site/assets/LRXe8-tt-newyear.js` stays byte-identical to `public/new-year.js`.
- Every visible text has TR and EN, with English as the default. The switch texts are verbatim from the spec addendum.
- Lights do not twinkle under `body.no-anim` or `prefers-reduced-motion`. Their resting state is lit.
- Shared files (`app.js`, `index.html`, `styles.css`, `electron-main.js`): touch only the New Year parts. Another session edits themes. Re-read before each edit.
- No commits.

## Review Focus

- A machine east or west of UTC, at 19 Dec 15:59 UTC compared with 16:00 UTC: the season follows UTC, not local midnight (unit test with `Date.UTC`).
- A celebration already stored for '2026-12-31' (from the old build) must not block the 1 January celebration (unit test: storage holds `'2026-12-31'`, 1 Jan check shows).
- Splash mode (168 px logo): the decoration scales with the logo and the hat stays inside the window (ui-smoke checks the SVG box against the stage box).
- `app.newYear` switched off: no `ny-dressed` class, so the logo is plain (ui-smoke).
- Animations off: the bulbs have `animation-name: none` (ui-smoke).

---

### Task 1: Christmas Town season (shared scene)

**Files:** Modify `public/new-year.js` (header comment, `isSeason`, `forced`), copy it to `website/site/assets/LRXe8-tt-newyear.js`. Test: `tests/unit/new-year.test.mjs`.

- [ ] **Step 1: Change the tests.**
  - `season` → `follows Christmas Town: 19 Dec 16:00 to 31 Dec 16:00 TCT (UTC)`:
    - `Date.UTC(2026,11,19,15,59)` → false; `Date.UTC(2026,11,19,16)` → true;
    - `Date.UTC(2026,11,31,15,59)` → true; `Date.UTC(2026,11,31,16)` → false;
    - `Date.UTC(2027,0,3)` → false; `new Date(2026,6,1)` → false.
  - `preview override`: `forced('?newyear=midnight')` → false.
- [ ] **Step 2:** Run `npx vitest run tests/unit/new-year.test.mjs`. Expected: these two FAIL.
- [ ] **Step 3:** Implement `isSeason(date)` as `t >= Date.UTC(y,11,19,16) && t < Date.UTC(y,11,31,16)`, where `y = date.getUTCFullYear()`. `forced(search)` accepts only `'1'`. Copy the file to the site path.
- [ ] **Step 4:** Run the same command. Expected: all PASS, including the site-copy test.

### Task 2: Celebration without countdown

**Files:** Modify `public/new-year-welcome.js`, `public/index.html` (`#ny-welcome` loses `.ny-count`), `public/styles.css` (drop the `.ny-count*`, `.counting` and `nyPop` rules), `public/app.js` (`buildNewYearWelcome`), `src/main/electron-main.js` (drop the midnight switch). Test: `tests/unit/new-year-welcome.test.mjs` and `tests/ui-smoke.js` (the "fails to start" stub).

**Interfaces:**
- Produces:
  - `isCelebrationDay(date)`: true on 1 January, local time.
  - `dayKey(date)`.
  - `scheduler({ now, enabled, visible, preview, storage, onShow(), onStop }) -> { check() }`.
  - `create(canvas, { reduced, raf?, caf?, random? }) -> { start(), stop() }`.
  - `mount(root, { reduced, lang, name, now, greeting }) -> { show(), close(), isOpen() }`.
- Removed: `msToNewYear` and `previewClock`, together with `onCount`, `count`, `kind` and `PLANS.midnight`.

- [ ] **Step 1: Rewrite the tests.**
  - The engine tests use `start()`. The "more at midnight" test is deleted.
  - `celebration day is 1 January, local time`:
    - 31 Dec 23:59 → false;
    - 1 Jan 00:00 → true;
    - 1 Jan 23:59 → true;
    - 2 Jan 00:00 → false.
  - Scheduler:
    - once on 1 Jan even when checked twice, then nothing on 2 Jan; `storage.set` receives `['2027-01-01']`;
    - nothing on 31 Dec;
    - a stored `'2026-12-31'` does not block 1 Jan;
    - storage that throws gives one show;
    - it waits until visible;
    - preview shows once per start, without storing;
    - a preview function is read on every check;
    - switched off: `onStop`, and no show.
  - The ui-smoke stub becomes `window.LRXNewYearWelcome = { mount() { throw … } }`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/new-year-welcome.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The `app.js` wiring uses `now: () => new Date()` and `preview: () => LRXNewYear.forced(location.search)`, and drops `onCount` and `reduced` from the scheduler.
  - `electron-main.js` keeps only `--newyear-preview` → `/?newyear=1`.
- [ ] **Step 4:** Run the units and `node tests/ui-smoke.js`. Expected: PASS.

### Task 3: Dressed-up logo

**Files:**
- Create `public/new-year-logo.js` (from the approved mockup).
- Modify:
  - `public/index.html`: the `.auth-logo-stage` wrapper, and a script tag after `new-year.js`;
  - `public/styles.css`: the stage, `.auth-logo-xmas` and twinkle rules, `ny-dressed` spacing;
  - `public/app.js`: `startAuthNewYear` toggles `ny-dressed` and inserts the SVG once;
  - `public/features.js` and the spec texts for all three switches.
- Test: `tests/unit/new-year-logo.test.mjs` and `tests/ui-smoke.js`.

**Interfaces:** `LRXNewYearLogo.markup() -> string` (the `<svg class="auth-logo-xmas">`), plus `BULBS = 28`, `COLORS` and `outline(s) -> [x, y, nx, ny]`.

- [ ] **Step 1: Write the tests.**
  - Unit:
    - `markup()` is identical across calls;
    - it has exactly 28 `nyl-bulb` groups, one `nyl-hat`, one `nyl-ice`, and icicle paths;
    - every `url(#id)` it references is defined in it;
    - `outline(0)` is on the top edge with normal `[0, -1]`, and `outline(0.5)` is on the bottom edge with normal `[0, 1]`.
  - ui-smoke, on the login screen with `?newyear=1`:
    - `#auth-screen` has `ny-dressed`;
    - the SVG is displayed and contains the hat;
    - the stage is the logo's parent;
    - the SVG box stays inside the viewport and does not overlap `#auth-key`;
    - with `no-anim`, the bulb glass has `animation-name: none`;
    - with `app.newYear` off and `startAuthNewYear('login')` called, there is no `ny-dressed`.
- [ ] **Step 2:** Run them. Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement.**
  - `startAuthNewYear(mode)` works out `dressed = feat('app.newYear') && (forced || isSeason(new Date()))`.
  - It inserts the markup into `#auth-logo-stage` only once.
  - It sets or removes `ny-dressed` on `#auth-screen`, also on the switch-off path.
- [ ] **Step 4:** Run `npm run check`, `npm test`, `npm run test:premium` and all five smokes. Expected: PASS. Take screenshots of the login and splash screens with `?newyear=1`.
- [ ] **Step 5:** Copy the changed files to `D:\Meric\TORN\LRX-Torn-Tracker-TEST\resources\app` and check them with `cmp`. Delete `LRX Torn Tracker TEST - Geri sayim onizleme.lnk`.
