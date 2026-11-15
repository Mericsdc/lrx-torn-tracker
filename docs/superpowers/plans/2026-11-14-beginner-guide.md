# Beginner Guide v2 and Happy Jump card: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the under-15 Beginner Guide to include:
- an ordered roadmap;
- topic cards with a short summary and expandable details;
- new personal steps;
- a live Happy jump card, which also appears on the Tools page for level 15+.

**Architecture:**
- A new UMD module, `public/beginner-guide.js` (`LRXGuide`), holds every text as a `[tr, en]` pair, along with the pure rules (`steps`, `jumpReadiness`, `nextTick`, `phaseText`).
- `features.js` renders the guide. It builds a static shell once per language, then repaints only the live parts each time the overview refreshes.
- `tools.js` renders the same jump card through the shared `happyJumpCard()` / `paintJumpLive()`.

**Tech Stack:** browser globals (classic scripts), vitest (`tests/unit/*.test.mjs`), Playwright UI smoke.

**Spec:** `docs/superpowers/specs/2026-11-14-beginner-guide-design.md`

## Global Constraints

- English by default and Turkish through `tr(a, b)`. Every text is a non-empty `[tr, en]` pair.
- Display only: no clicks and no new Torn requests. The rules read `state.overview` and nothing else.
- New switch: `tools.happyJump`, def `true`, parent `page.tools`. It is added to `FEATURE_DEFS` and to the legacy string in `public/feature-catalog.js`.
- The owner said not to commit yet, so the commit steps are skipped.
- Code that contains backslashes is written with Write/Edit, never with Bash heredocs.

## Review Focus

1. The overview refreshes (about every 30 s) while a Details section is open. The section must stay open, in the guide and on Tools. → smoke: open one Details, call `renderOverview()`, assert it is still open.
2. A language switch while the guide is open. Every card must re-render in the new language. → smoke: switch to TR and assert TR text, then switch back.
3. Missing overview parts: no `bars`, no `cooldowns`, no `player.faction`, an unknown `property`. Nothing may throw, and the card shows `unknown` or skips that step. → unit: `steps({})`, `jumpReadiness({})`.
4. A cooldown read from an older overview. The time left is reduced by the time since `fetchedAt` and is never below 0. → unit test in Task 1.
5. A jump in progress at less than 1,000 E (after the first train or a refill). The card must say "train", not "stack". → unit test in Task 1.

---

### Task 1: `public/beginner-guide.js`, texts and rules

**Files:**
- Create: `public/beginner-guide.js` (UMD like `public/levelling.js`, global `LRXGuide`)
- Test: `tests/unit/beginner-guide.test.mjs`

**Interfaces (produces):**
- `ROADMAP`: `[{ id: 'day1'|'week1'|'to15', title: [tr, en], items: [[tr, en], …] }]`
- `LEAD`: `[tr, en]`
- `SECTIONS`: `[{ id, icon, title: [tr, en], summary: [[tr, en] × 2-3], details: [{ head?: [tr, en], items: [[tr, en], …] }] }]`, ids in this order: `jump, energy, gym, crimes, faction, job, education, buy, tools, after15`
- `JUMP_NOTE`: `[tr, en]`, the "you do every step yourself in Torn; LRX only shows" line
- `STACK_CAP = 1000`, `TICK_SEC = 900`
- `nextTick(tctSec) → number`, the next multiple of 900 that is strictly greater than `tctSec`
- `steps(o, fmt) → [{ id, done, text: [tr, en], action? }]`
  - `fmt = { num(n) → string, dur(sec) → string }`
  - `action` is one of:
    - `{ view: 'level'|'job' }`
    - `{ url, label: [tr, en], icon }`
- `jumpReadiness(o, { nowMs, skewMs = 0 }) → { phase, checks: { status, energy, drug, booster, happy }, nextTick, state }`
  - `phase` is one of `'unknown'|'blocked'|'ecstasy'|'train'|'waitDrug'|'waitBooster'|'ready'`
  - Each check is `{ ok, current?, max?, left? }`.
  - `left` = max(0, cooldown − (nowMs − o.fetchedAt)/1000). When `fetchedAt` is missing, `left` is the cooldown as given.
  - `nextTick` is in TCT seconds, worked out from `(nowMs + skewMs)/1000`.
- `phaseText(r, fmt) → [tr, en]`
  - `fmt` also has `time(tctSec) → 'hh:mm'`.

**Step order (data the steps read: `o.battle.stats`, `o.player.job`, `o.education`, `o.bars`, `o.player.faction`, `o.player.property`):**

| id | condition | done |
|---|---|---|
| `stats` | any base stat under 300 | done when none is; then the action is `{view:'level'}` |
| `job` | | done when the player has a job; when not, the action is `{view:'job'}` |
| `course` | | done when `education.currentId`; when not, the action is the Education url |
| `happy` | `current <= maximum` | todo |
| `energy` | `current > maximum`, id `energyStacked`, points to the jump card | todo |
| | `current == maximum`, id `energyFull` | todo |
| `nerveFull` | `current >= maximum` | todo, Crimes url |
| `faction` | `faction_id == 0` | todo |
| | in a faction | done (name) |
| `home` | `property === 'Shack'` | todo |

**Phase rules:**
- `unknown`: there is no energy or happy bar.
- When `boosted = happy.current > happy.maximum`:
  - `state !== 'Okay'` → `blocked`;
  - drug left is 0 → `ecstasy`;
  - happy at least 2 × maximum → `train`;
  - otherwise use the not-boosted rules.
- When not boosted:
  - drug left > 0 → `waitDrug`;
  - booster left > 0 → `waitBooster`;
  - `state !== 'Okay'` → `blocked`;
  - otherwise → `ready`.
- The checks' `ok` values:
  - status: `state === 'Okay'`
  - energy: `current >= maximum`
  - drug and booster: `left === 0`
  - happy: `current > maximum`

**Content:** the "Content" section of the spec, following its number rule. Fix the Education card so it says the bachelor's degree gives "+1% to all gym gains".

- [ ] **Step 1: Write the failing tests** in `tests/unit/beginner-guide.test.mjs`:
  - `every text is a TR/EN pair`: walk `LEAD`, `JUMP_NOTE`, `ROADMAP`, `SECTIONS`, and the `steps()`/`phaseText()` outputs for every phase. Every pair has length 2 and two non-empty strings.
  - `sections in order with 2-3 summary lines and details`: the ids equal the list above, `summary.length` is between 2 and 3, and `details.length` is at least 1.
  - `roadmap has day1, week1, to15` and mentions `[Upgrade]` in EN.
  - `jump section covers steps, budget, risks`: the EN details text includes `Xanax`, `Ecstasy`, `Erotic DVD`, `candy`, `overdose` and `:15`.
  - `no "+2% to all" claim`: no EN text matches `/\+2% to all/`.
  - `steps` cases, one per row of the table, each with a synthetic overview, and `steps({}, fmt)` returns `[]` without throwing.
  - `jumpReadiness` cases:
    - `unknown` for `{}`;
    - `ready` (energy 1000/150, happy 5000/5000, cooldowns 0, Okay);
    - `waitDrug` (drug 3600);
    - `waitBooster`;
    - `blocked` for Hospital when not boosted with cooldowns 0;
    - `waitDrug` for Hospital while the drug cooldown runs (stacking continues);
    - `ecstasy` (happy 17500/5000, drug 0);
    - `train` (happy 35000/5000, drug 12000);
    - `train` at energy 0/150 after the refill;
    - `waitDrug` for the Xanax +75 case (happy 5075/5000, drug 20000);
    - `blocked` when boosted in Jail;
    - drug `left` with `fetchedAt` 600 s before `nowMs` and cooldown 3600 gives 3000;
    - cooldown 100 with `fetchedAt` 600 s before gives 0.
  - `nextTick`: `nextTick(900*10) === 900*11` and `nextTick(900*10+1) === 900*11`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/beginner-guide.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `public/beginner-guide.js` with the interfaces above.
- [ ] **Step 4: Run** the same command. Expected: PASS.

### Task 2: Guide rendering in `features.js`

**Files:**
- Modify: `public/features.js`:
  - remove `GUIDE_SECTIONS`, `STAT_NAMES` and `guideSteps()`, and rewrite `renderGuide()`;
  - add the `tools.happyJump` def, the `page.tools` description and the `guide` VIEW_META subtitle.
- Modify: `public/feature-catalog.js`, legacy string (add `tools.happyJump` after `tools.helpers`).
- Modify: `public/index.html`, add `<script src="/beginner-guide.js"></script>` before `/features.js`.
- Modify: `public/styles.css`, add `.gd-more`, `.gd-road`, `.hj-card`, `.hj-checks` next to `.gd-steps`.
- Test: `tests/ui-smoke.js`, after the levelling block.

**Interfaces (produces, all globals in `features.js`):**
- `guideFmt()` → `{ num: n0, dur: human, time }`, where `time` is the `hh:mm` of `tctTime(sec*1000)`.
- `happyJumpCard()` → HTML. It contains:
  - `.hj-card`;
  - a live block `[data-hj-live]`;
  - the summary `ul.gd-list`;
  - the details `<details class="gd-more" data-gd-id="jump">`;
  - the `JUMP_NOTE` line.
- `paintJumpLive(root)` fills every `[data-hj-live]` under `root` with:
  - the phase line, `phaseText`;
  - `ul.hj-checks` holding 5 rows: ✓/▫, a label and a value. Cooldowns use `human(left)`, energy shows `x · cap 1,000`, happy shows `current / max`.
- `guideUi = { shell: '', open: Set }`. A capture `toggle` listener on `document` keeps `open` in sync with `details[data-gd-id]`. Every `<details>` is rendered with `open` when its id is in the set.

**Guide shell order (rendered once per `state.lang`, or when `#gd-steps` is missing):**
1. The next-steps card: `#gd-live-head` (level chip and progress) and `ul#gd-steps`.
2. The roadmap card (`.gd-road`), with `LEAD` and three phases.
3. `happyJumpCard()`.
4. Each other section as `article[data-gd-section=id]` with its summary list and `<details class="gd-more" data-gd-id=id>`.

Each call then repaints `#gd-live-head`, `#gd-steps` (texts through `esc`) and `paintJumpLive($('#guide-body'))`. The `job` action is shown only when `feat('page.job')` is on.

- [ ] **Step 1: Write the failing smoke block.** With `state.overview` set to:
  - level 10, `faction_id: 0`, `property: 'Shack'`;
  - energy 1000/150, nerve 60/60, happy 5000/5000;
  - cooldowns `{drug:0, booster:0}`, `fetchedAt: Date.now()`, status Okay;

  and then `renderOverview(); showView('guide')`, assert:
  - the `#guide-body [data-gd-section]` ids equal `['energy','gym','crimes','faction','job','education','buy','tools','after15']`;
  - `.gd-road` contains `Day 1`;
  - `.hj-card [data-hj-live]` contains `next tick`;
  - `#gd-steps` contains `Nerve is full`, `faction`, `Shack` and `stacked`;
  - after clicking `[data-gd-id="energy"] > summary` and calling `renderOverview()`, `[data-gd-id="energy"]` still has `open`;
  - after clicking `#lang-toggle [data-lang="tr"]`, `.gd-road` contains `İlk gün`; then switch back to EN.

  Afterwards restore level 25, the old bars, cooldowns and faction.
- [ ] **Step 2: Run** the ui smoke. Expected: FAIL at the first guide assertion.
- [ ] **Step 3: Implement** the features.js, catalog, index.html and styles.css changes.
- [ ] **Step 4: Run** `npx vitest run`, `npm run test:premium` and the ui smoke. Expected: PASS.

### Task 3: Tools card for level 15+

**Files:**
- Modify: `public/tools.js`:
  - `renderTools()` puts `happyJumpCard()` first when `feat('tools.happyJump') && !underLevel15()`, then calls `paintJumpLive($('#tools-body'))`;
  - an `onOverviewRendered` chain link repaints only `[data-hj-live]` while `state.view === 'tools'`;
  - the VIEW_META subtitle mentions the happy jump.
- Test: `tests/ui-smoke.js`.

- [ ] **Step 1: Write the failing smoke.**
  - At level 25, `showView('tools')`: `#tools-body .hj-card` is visible.
  - `await setFeature('tools.happyJump', false)` and re-render: no `.hj-card`. Restore with `true`.
  - At level 10, Tools has no `.hj-card`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the ui smoke. Expected: PASS.

### Task 4: Full verification and TEST copy

- [ ] Run `npm run check`, `npm test` and `npm run test:premium`.
- [ ] Run the ui, overview, premium, feature-modules and electron smokes with `PLAYWRIGHT_MODULE=D:/Meric/TORN/updates/ui-validation-deps/node_modules/playwright`. All must PASS.
- [ ] Look at the guide screenshot (EN and TR) for layout.
- [ ] Copy the changed runtime files to `D:\Meric\TORN\LRX-Torn-Tracker-TEST\resources\app`:
  - `public/beginner-guide.js`
  - `public/features.js`
  - `public/feature-catalog.js`
  - `public/tools.js`
  - `public/index.html`
  - `public/styles.css`
- [ ] `cmp` each copy against the dev file.
