# New Year Sign-in Decoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-building ASCII New Year tree, snow and stars beside the sign-in card on lrxe8.com/torn-tracker and in the app, 20 Dec – 6 Jan only.

**Architecture:** One browser/UMD file, `public/new-year.js`, exposes `window.LRXNewYear` (pure date/greeting/layout helpers plus a canvas scene). The app's auth screen and the site hero each get their own overlay canvas above the pixel town and below the card. The site uses a byte-identical copy named `LRXe8-tt-newyear.js`.

**Tech Stack:** Vanilla JS with Canvas 2D, Vitest for unit tests, Playwright for the site check and screenshots, Electron app (`public/` served by `src/server/server.js`).

**Spec:** `docs/superpowers/specs/2026-11-13-new-year-sign-in-design.md`

## Global Constraints

- **Season:** active from 20 December 00:00 to 6 January 23:59, viewer's local time. Outside it nothing is drawn and no loop runs.
- **Greeting:** `HAPPY NEW YEAR <y>` (EN) or `MUTLU YILLAR <y>` (TR). In December `<y>` is next year; in January it is the current year.
- **Site CSP:** no inline scripts or styles, and no network requests. Asset names start with `LRXe8-tt-`.
- **Overlay:** never covers the card. When the space left of the card is narrower than 190 px there is no tree and no greeting, only snow and stars.
- **Splash mode** draws the finished tree immediately. **Reduced motion** draws one still frame and runs no loop. Reduced motion means `prefers-reduced-motion`, or `body.no-anim` in the app.
- **Frame rate:** about 30 fps, with DPR capped at 1.5. The scene stops when hidden, when off-screen (site) and when the auth screen closes (app).
- **Colours:** gold `#c9a96a` / `#e3cc97`, red `#d6455a`, ornament blue `#5b8def`, green shades for the tree, white snow.
- **App setting:** `app.newYear`, group `app`, default `true`. TR: `['Yılbaşı süsü', '20 Aralık – 6 Ocak arası giriş ekranında yılbaşı ağacı ve kar']`. EN: `['New Year decoration', 'Christmas tree and snow on the sign-in screen, 20 Dec – 6 Jan']`.
- **Preview override:** `?newyear=1` in the page URL forces the scene on (site and app), for previews and checks only.
- **Git:** no commits, pushes, deploys or releases until the owner asks.

## Review Focus

1. **The card moves or changes size** (window resize, app zoom, the EN/TR switch changes its height). The tree must re-layout and never overlap the card. `layout()` is tested with several card positions, and the scene recomputes on resize.
2. **Local-midnight boundaries.** 19 Dec 23:59 must be off, 20 Dec 00:00 on, 6 Jan 23:59 on and 7 Jan 00:00 off, all in local time. This is pinned in Task 1.
3. **The auth screen closes mid-build.** No animation frame may be scheduled after `stop()`. This is pinned in Task 1 with an injected `raf`/`caf`.
4. **Animations off.** The scene must draw exactly once and never schedule a frame. This is pinned in Task 1.
5. **Phone width.** At 390 px with the card spanning the screen, `layout()` must return `tree: null`. This is pinned in Task 1, and checked on the site at mobile width in Task 3.

---

### Task 1: Scene module and its unit tests

**Files:**
- Create: `public/new-year.js`
- Test: `tests/unit/new-year.test.mjs`

**Interfaces:**
- Produces, on `window.LRXNewYear` / `module.exports`:
  - `isSeason(date: Date) -> boolean`
  - `greeting(date: Date, lang: 'en'|'tr') -> string`
  - `forced(search: string) -> boolean`: true when the query has `newyear=1`.
  - `layout(w: number, h: number, card: {left, top, width, height} | null) -> { tree: { cx, baseY, height, width } | null }`
  - `create(canvas: HTMLCanvasElement, opts) -> { start(), stop(), finish(), resize() }`
- `opts` for `create` (every field is optional):
  - `lang: () => 'en'|'tr'`
  - `card: () => Element|null`
  - `mode: 'build'|'finished'`
  - `reduced: () => boolean`
  - `now: () => Date`
  - `raf` / `caf` (default `requestAnimationFrame` / `cancelAnimationFrame`)
- `start()` does nothing outside the season unless `opts.force` is set.

- [ ] **Step 1: Write the failing tests** in `tests/unit/new-year.test.mjs` (Vitest, imports the default export like `travel-math.test.mjs`):
  - `isSeason`: `new Date(2026,11,19,23,59)` → false; `new Date(2026,11,20,0,0)` → true; `new Date(2026,11,31,12)` → true; `new Date(2027,0,6,23,59)` → true; `new Date(2027,0,7,0,0)` → false; `new Date(2026,6,1)` → false.
  - `greeting`: `(new Date(2026,11,24), 'en')` → `'HAPPY NEW YEAR 2027'`; `(new Date(2027,0,3), 'tr')` → `'MUTLU YILLAR 2027'`; an unknown lang falls back to EN.
  - `forced('?newyear=1')` → true; `forced('')` and `forced('?newyear=0')` → false.
  - `layout(1440, 900, {left:540, top:120, width:360, height:640})`:
    - `tree.cx` lies between 0 and 540;
    - `tree.cx - tree.width/2 >= 0` and `tree.cx + tree.width/2 <= 540 - 16`;
    - `tree.height` is about 0.55 × 900, within ±10 %.
  - `layout(390, 844, {left:16, top:80, width:358, height:600}).tree` → null.
  - `layout(1000, 700, {left:300, ...}).tree` is a tree that fits inside 0..284, scaled down; with `left:180` → null.
  - Reduced motion: with a stub canvas (`getContext` returns a no-op 2D stub, `getBoundingClientRect` returns 800×600), `create(..., {force:true, reduced:()=>true, raf})` then `start()` draws, and `raf` is never called.
  - Stop: with `reduced:()=>false`, `start()` calls `raf` once; `stop()` calls `caf` with that id; a frame callback run after `stop()` schedules nothing.
- [ ] **Step 2: Run** `npx vitest run tests/unit/new-year.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `public/new-year.js`** with the same UMD wrapper as `public/travel-math.js`. Layout constants:
  - margin 16 px from the card;
  - tree aspect width/height 0.62;
  - target height 0.55 × h;
  - base at 0.80 × h, leaving room for the greeting below;
  - minimum free width 190.

  Scene details:
  - **Grid:** the cell is 10 px × 14 px at DPR ≤ 1.5, using monospace characters.
  - **Cone:** each cell inside the triangle gets a brightness from a fake 3D normal plus a slowly moving phase, so it seems to turn. The character ramp is `' .:-=+*%#&M'`.
  - **Build (`mode:'build'`):** rows appear bottom→top over 3.0 s. Garland spirals appear from 3.0 to 3.8 s, ornaments from 3.8 to 4.4 s and gifts from 4.4 to 5.0 s. The star with rays appears at 5.0 s and the greeting types in from 5.2 to 6.4 s.
  - **Ongoing:** the ornaments then blink and the star glows.
  - **Snow:** about 1 flake per 9000 px² of `· * +`, drifting down. Stars are about 1 per 6000 px² of `+` and `·`, twinkling.
  - **`finish()`** jumps to the finished state.
  - **Reduced motion:** draws the finished frame once, with still flakes.
  - **`resize()`** re-reads the canvas size and the card rect and re-runs `layout`; a `ResizeObserver` on the canvas calls it.
- [ ] **Step 4: Run** `npx vitest run tests/unit/new-year.test.mjs` and `npm run check`. Expected: all pass, and the syntax check includes the new file.

### Task 2: App sign-in screen and setting

**Files:**
- Modify: `public/index.html`:
  - add `<canvas class="auth-newyear" id="auth-newyear" aria-hidden="true"></canvas>` after `#auth-waves` (line 27);
  - add `<script src="/new-year.js"></script>` before `/app.js` (line 616).
- Modify: `public/styles.css`. Next to `.auth-waves` (line 835), add `.auth-newyear` with the same absolute fill and `pointer-events:none`, stacked above the waves and below `.auth-card`.
- Modify: `public/app.js`, in `showAuth`/`hideAuth` (around lines 2320–2345):
  - in `showAuth(mode)`, create once with `lang: () => state.lang`, `card: () => $('#auth-card')`, `reduced: prefersReducedMotion` and `force: LRXNewYear.forced(location.search)`;
  - set the mode to `'finished'` for splash and `'build'` for login, then call `start()`;
  - skip all of this when `feat('app.newYear') === false`;
  - `hideAuth` calls `stop()` when the screen hides.
- Modify: `public/features.js`. Add the `app.newYear` def from Global Constraints after `app.splash`.
- Modify: `public/feature-catalog.js`. Add `app.newYear` to the legacy list after `app.splash`.

**Interfaces:**
- Consumes: `LRXNewYear.create`, `LRXNewYear.forced`.

- [ ] **Step 1: Run** `npm run test:premium`. Expected: it passes before the change. That suite checks that every feature def is in the catalog, so it guards the new key.
- [ ] **Step 2: Make the changes above.**
- [ ] **Step 3: Run** `npm run check`, `npm run test:node`, `npm run test:premium` and `npx vitest run`. Expected: all pass.
- [ ] **Step 4: Visual check.**
  1. Start the preview server (`tests/preview-server.js` or `npm run web` with a temporary data dir and no key).
  2. Open `/?newyear=1` in Playwright at 1440×900 and 1100×700.
  3. Screenshot the login screen after 7 s. Expected: the tree is left of the card with no overlap, plus snow and the greeting.
  4. Turn the setting off, reload, and confirm no `#auth-newyear` drawing (the canvas is blank).

### Task 3: Website hero

**Files:**
- Create: `website/site/assets/LRXe8-tt-newyear.js`, a byte copy of `public/new-year.js`.
- Modify: `website/site/LRXe8-torn-tracker.html`:
  - add `<canvas class="hero-newyear" id="hero-newyear" aria-hidden="true"></canvas>` after `#hero-waves`;
  - add `<script src="/assets/LRXe8-tt-newyear.js" defer></script>` before `LRXe8-tt.js`.
- Modify: `website/site/assets/LRXe8-tt.css`. Add `.hero-newyear` like `.hero-waves` (absolute fill), with a z-index between the waves (-2) and the card.
- Modify: `website/site/assets/LRXe8-tt.js`. After the hero waves block:
  - create with `lang: () => document.documentElement.lang === 'tr' ? 'tr' : 'en'`, `card: () => $('.hero-card')` and `reduced: () => reduced`;
  - pass `force: LRXNewYear.forced(location.search)` and `mode: 'build'`;
  - reuse the same IntersectionObserver and visibility pattern as the waves.
- Modify: `docs/WEBSITE.md`. Add a row for `LRXe8-tt-newyear.js` and mention `?newyear=1`.
- Test: `tests/unit/new-year.test.mjs`. Add the test `site copy is identical`, which reads both files and expects equal contents.

- [ ] **Step 1: Add the identical-copy test.** Run `npx vitest run tests/unit/new-year.test.mjs`. Expected: FAIL, the file is missing.
- [ ] **Step 2: Make the changes above.** Run the test again. Expected: PASS.
- [ ] **Step 3: Run the site check.** Start `node website/tools/serve.js`, then run `node website/tools/check.js "http://127.0.0.1:4810/torn-tracker?newyear=1" <scratch>/checks`. Expected: no CSP violations, no console errors and `overflowX: false`, on desktop and mobile, in EN and TR. On desktop the hero shows the tree beside the card; on mobile there is no tree.
- [ ] **Step 4: Run the plain check** without `?newyear=1`. Expected: the hero is unchanged from today (outside the season).

### Task 4: Tune, verify everything, show the owner

- [ ] **Step 1: Compare with the reel's frames** at 5 s, 11 s and 18.5 s, and tune the ramp, garland and gift sizes by eye.
- [ ] **Step 2: Run** `npm run check` and `npm run test:all`. Expected: all pass. Update the count in `docs/TESTING.md`.
- [ ] **Step 3: Send the owner screenshots** of the site (desktop EN, desktop TR, mobile) and the app sign-in screen (login and splash).
