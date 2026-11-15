# New Year Celebration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On 31 December and 1 January, show a full-screen celebration over the app once a day, with a greeting, confetti and fireworks. If the tracker is on screen at midnight, count down from 10 first.

**Architecture:** A new app-only UMD script, `public/new-year-welcome.js` (`LRXNewYearWelcome`), holds three parts:
- pure date and schedule logic: `scheduler`;
- a canvas engine: `create`;
- a small DOM overlay controller: `mount`.

`app.js` starts it once and calls `check()` when the sign-in screen closes, when the tracker comes back on screen, and every 30 s.

**Tech Stack:** Plain browser JS (UMD), canvas 2D, vitest (node environment) for units, the Playwright `tests/ui-smoke.js` for the overlay.

**Spec:** `docs/superpowers/specs/2026-11-13-new-year-sign-in-design.md`, "Addendum 2 (2026-11-14): New Year celebration".

## Global Constraints

- Days: 31 December and 1 January only, local time, once a day, the first time the tracker is on screen that day.
- Midnight: from 23:59:50 on 31 December, if the tracker is on screen, a countdown runs 10…1, then the celebration plays (about 10 s). If the countdown is missed, the 1 January welcome shows later.
- Welcome lasts about 6 s, then fades. A click, Esc or Enter closes it at once.
- Reduced motion (Animations off or OS): one still frame, no moving countdown, closed by a click or after 6 s.
- Switch `app.newYearWelcome`, group `app`, default true:
  - TR: "Yılbaşı kutlaması" – "31 Aralık ve 1 Ocak'ta açılışta konfeti ve havai fişek; gece 00:00'da geri sayım".
  - EN: "New Year celebration" – "Confetti and fireworks when the app opens on 31 Dec and 1 Jan, with a countdown at midnight".
- Previews:
  - `?newyear=1` (`--newyear-preview`): shows on every start.
  - `?newyear=midnight` (`--newyear-midnight-preview`): the same, plus the countdown 15 s after start.
- Never covers sign-in. No sound, no network request, nothing drawn on Torn pages.
- Every visible text has TR and EN; English is the default.
- The site copy of `new-year.js` stays identical to `public/new-year.js`.
- No commits unless the owner asks.

## Review Focus

- The app is left open across days (30 Dec → 31 Dec → 1 Jan): the welcome must still show once on each day. It must not show every 30 s, and must not be skipped because it already showed earlier in this run.
- `localStorage` throws or is empty (private mode, another port): the welcome must still show at most once per run per day.
- A Torn tab is active at midnight: there is no countdown and nothing over Torn. The 1 January welcome shows when the tracker is back.
- The switch is turned off while the celebration plays: it closes at once and its timers stop.
- Enter or Esc pressed while the overlay is open must not also reach a focused field or button underneath.

---

### Task 1: Date and schedule logic

**Files:**
- Create: `public/new-year-welcome.js`
- Test: `tests/unit/new-year-welcome.test.mjs`

**Interfaces:**
- Produces:
  - `isCelebrationDay(date) -> boolean`.
  - `dayKey(date) -> 'YYYY-MM-DD'` (local date).
  - `msToNewYear(date) -> number|null`: null unless `date` is 31 December.
  - `previewClock(search, realNow?) -> { preview: boolean, now: () => Date }`. For `newyear=midnight`, `now()` starts at this year's 31 Dec 23:59:35 and advances in real time.
  - `scheduler({ now, enabled, visible, reduced, preview, storage: { get, set }, setTimeout?, clearTimeout?, onShow(kind), onCount(n), onStop }) -> { check(), stop() }`. `kind` is `'welcome' | 'midnight'`.

- [ ] **Step 1: Write the failing tests.** Each test name below lists its assertions:
  - `isCelebrationDay`: 30 Dec 23:59 → false; 31 Dec 00:00 → true; 1 Jan 23:59 → true; 2 Jan 00:00 → false.
  - `msToNewYear`: 31 Dec 23:59:20 → 40000; 30 Dec → null; 1 Jan → null.
  - `previewClock`:
    - `'?newyear=1'` → preview true;
    - `''` → preview false;
    - `'?newyear=midnight'` → preview true, and `now()` is 31 Dec 23:59:35, then 1 s later when the real clock moves 1 s.
  - `shows the welcome once a day on the celebration days`:
    - checking twice on 31 Dec calls `onShow('welcome')` once;
    - moving the clock to 1 Jan and checking calls it a second time;
    - 2 Jan calls nothing;
    - `storage.set` receives `'2026-12-31'` and then `'2027-01-01'`.
  - `shows at most once per run per day when storage throws`: get and set throw; three checks on 31 Dec give one `onShow`.
  - `waits until the tracker is on screen`: `visible` false → nothing; then true → `onShow('welcome')`.
  - `counts down from 10 and celebrates at midnight` (fake timers):
    - check at 23:59:30 after the day's welcome was already stored;
    - advance to 23:59:50 → `onCount(10)`;
    - each second → 9…1;
    - at 00:00 → `onShow('midnight')`, and `storage.set('2027-01-01')`.
  - `skips the countdown when the tracker is not on screen, and the 1 January welcome shows later`: `visible` false at 23:59:50 → no `onCount`; a check on 1 Jan 10:00 with `visible` true → `onShow('welcome')`.
  - `reduced motion has no moving countdown but still celebrates at midnight`: no `onCount` calls; `onShow('midnight')` at 00:00.
  - `preview shows on every start`: two schedulers with `preview: true` on 14 Nov → each shows once; a second check on the same scheduler shows nothing.
  - `switching off stops the timers`: `enabled` → false and check → `onStop` is called; advancing past midnight → no `onShow('midnight')`.
- [ ] **Step 2: Run the tests and see them fail.** Run `npx vitest run tests/unit/new-year-welcome.test.mjs`. Expected: FAIL, because the module does not exist.
- [ ] **Step 3: Implement the five exports in `public/new-year-welcome.js`.** It is UMD like `new-year.js`.
  - Constants: `COUNT_FROM = 10`, `LOOKAHEAD_MS = 40000`.
  - In-memory fallback: the last shown day key is kept in memory as well, so storage errors never repeat the welcome.
  - `scheduler.check()` shows the welcome only when no countdown is pending, then arms a countdown when `msToNewYear(now) <= LOOKAHEAD_MS`.
  - Each countdown tick re-reads `now()`, aborts if the switch is off or the tracker is not on screen, and schedules the next whole second.
- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: all pass.

### Task 2: Confetti and fireworks engine

**Files:**
- Modify: `public/new-year-welcome.js`
- Test: `tests/unit/new-year-welcome.test.mjs`

**Interfaces:**
- Produces: `create(canvas, { reduced, raf?, caf?, random? }) -> { start(kind), stop() }`.
  - The palette is gold `#c9a96a`/`#e3cc97`, red `#d6455a`, blue `#5b8def`, green `#5ec474` and white `#f4f7fb`.
  - Confetti bursts from both bottom corners as turning paper rectangles.
  - Rockets burst into `*`, `+` and `·` sparks.
  - The midnight kind has more rockets and opens with a triple burst.

- [ ] **Step 1: Write the failing tests.** They use the stub canvas pattern from `new-year.test.mjs`:
  - `draws one still frame and schedules nothing with reduced motion`: draws > 0 and raf is not called.
  - `animates confetti and fireworks until stopped`: after several queued frames, draws grow and sparks are drawn with `fillText`. `stop()` cancels the queued id, a queued frame schedules nothing more, and the canvas is cleared.
  - `midnight draws more than the welcome`: over the same frames, midnight has more draw calls than the welcome.
- [ ] **Step 2: Run the tests and see them fail.** Run `npx vitest run tests/unit/new-year-welcome.test.mjs`. Expected: FAIL, because `create` is not defined.
- [ ] **Step 3: Implement `create`.**
  - DPR is capped at 1.5, the size is measured on `start`, and `dt` is capped at 50 ms.
  - Each piece's motion uses a timed event plan, gravity and air drag.
  - Sparks fade over about 1.5 s and are drawn with additive blending.
- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: all pass.

### Task 3: Overlay, app wiring, switch and previews

**Files:**
- Modify:
  - `public/new-year-welcome.js`: add `mount`;
  - `public/index.html`: the `#ny-welcome` overlay and the script tag after `new-year.js`;
  - `public/styles.css`: the `.ny-welcome` styles;
  - `public/app.js`: `checkNewYearWelcome()`, plus calls in `hideAuth`, `catchUpTracker` and a 30 s interval;
  - `public/features.js`: the `app.newYearWelcome` entry;
  - `public/feature-catalog.js`: the legacy list, after `app.newYearSnow`;
  - `public/new-year.js` and its site copy: `forced()` also accepts `midnight`;
  - `src/main/electron-main.js`: `--newyear-midnight-preview`.
- Test:
  - `tests/ui-smoke.js`;
  - `tests/unit/new-year.test.mjs`: `forced('?newyear=midnight')` is true.

**Interfaces:**
- Consumes: Task 1 and Task 2 exports, and `LRXNewYear.greeting(date, lang)`.
- Produces:
  - `mount(root, { reduced, lang, name, now }) -> { show(kind), count(n), close(), isOpen() }`;
  - the global `checkNewYearWelcome()` in `app.js`.

- [ ] **Step 1: Write the failing checks.**
  - Unit: `forced('?newyear=midnight')` is true.
  - ui-smoke, after the second sign-in, with `history.replaceState` to `/?newyear=1` and a call to `checkNewYearWelcome()`:
    - `#ny-welcome` is visible, with the text `HAPPY NEW YEAR 2027`;
    - its canvas has lit pixels;
    - the z-index is above `.app` and below `#auth-screen`;
    - Esc closes it (hidden), and the Esc does not reach a listener on `document` bubbling below;
    - with `app.newYearWelcome` false, a new run shows nothing;
    - restore the URL.
- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run tests/unit/new-year.test.mjs` and `node tests/ui-smoke.js` (with `PLAYWRIGHT_MODULE`). Expected: both FAIL.
- [ ] **Step 3: Implement.**
  - **Overlay:**
    - Markup: a scrim, the canvas, a countdown line ("New year in" / "Yeni yıla") with a large number, the greeting in alternating gold and red letters, the name (from `state.overview.player.name` when known) and a hint ("Click to close" / "Kapatmak için tıkla").
    - Attributes: `role="dialog"`, `aria-modal="true"`.
    - z-index: 1050.
    - Keys: capture-phase Esc/Enter.
    - Timing: auto-close after 6000 ms (`welcome`) or 10000 ms (`midnight`), with a 500 ms fade.
    - Focus returns to where it was.
  - **Switch:** off closes the overlay through `onStop`. `FEATURE_HOOKS` calls `checkNewYearWelcome()`.
- [ ] **Step 4: Run all the checks.** Run `npm run check`, `npm test` and all five smokes. Expected: all PASS.
- [ ] **Step 5: Review the visuals.** Take screenshots of the welcome and of a countdown frame (`?newyear=midnight`). Refresh the TEST copy and add a "Yilbasi geri sayim onizleme" shortcut with `--newyear-midnight-preview`.
