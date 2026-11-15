# Premium Page Redesign ("Seal / editorial") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Premium page's markup and styles into the approved centred "seal / editorial" design. Every
existing Premium action, state and gate keeps working.

**Architecture:**
- **Markup:** `public/premium.js` keeps its data flow (snapshot → `render()` → `paintHost()`) and its event
  handlers. Only the HTML builders (`hero`, `nav`, `membership`, `privacy`, the disabled/not-configured blocks)
  are rewritten.
- **Helpers:** three small helpers are exposed on `window.PremiumView` so the smoke can check them.
- **Styles:** `public/premium.css` is rewritten for the new layout. The `.pm-profile*` base rules, which the
  Overview widget shares, stay byte-identical.
- **Modules:** they keep the `feature-access.js` markup and are restyled by CSS scoped to `.pm-collection`.

**Tech Stack:** vanilla JS (browser IIFE), CSS, Playwright smoke (`tests/premium-ui-smoke.js`) against the real
preview server and an in-memory Premium service.

**Spec:** `docs/superpowers/specs/2026-11-15-premium-page-redesign-design.md`

## Global Constraints

- Touch only `public/premium.js`, `public/premium.css`, `tests/premium-ui-smoke.js`. Leave `app.js`, `index.html`,
  `styles.css`, `themes.css`, `feature-access.js`, `profile-card.js` and `advanced-modules.js` unchanged.
- Every new UI string is a `tr('TR', 'EN')` pair, English default.
- Every new inline `<svg>` sets its own `width`, `height`, `fill` and `stroke` (`styles.css:43` makes every svg a
  17 px stroked icon).
- Theme accent only via `--pm-accent` / `--pm-soft` / `--pm-border`. The five themes must give five different
  hero backgrounds.
- No new network requests. No API keys in source or output.
- Do not commit (owner rule). Instead of commit steps: run the listed checks.
- Seal arc: `min(max(remainingDays,0),30)/30` when active, `1` when lifetime, `0` otherwise.
- Motion only on the first paint after the view is shown or the identity changes. It is off with `body.no-anim`
  and `prefers-reduced-motion: reduce`.

## Review Focus

1. **Service unreachable while a member.** The hero must show the "unknown" state (`—`, MEMBERSHIP STATUS), never
   "Not active". Pinned in Task 1.
2. **15-second auto-refresh re-render.** No entrance animation replays, and an open module workbench or open
   `<details>` survives. Pinned in Task 3; the workbench part in Task 2.
3. **Lifetime owner.** No "Extend" button, no "until" lines, `∞` in the seal. The admin tabs still work. Pinned
   in Tasks 1 and 2.
4. **640 px, TR text** (longer Turkish labels). No sideways scroll, and the seal and ledger stack. Pinned in
   Task 3 (existing overflow check, run after switching to TR as well).
5. **Light theme.** Gold-gradient text must stay readable on a light background; Light uses the solid dark-gold
   accent. Pinned in Task 3 by the theme screenshots plus a computed-colour check.

---

### Task 1: Hero — seal, states, holder, ledger, actions, tabs

**Files:**
- Modify: `public/premium.js` (`hero()`, `nav()`, `profileCard()`/`paintProfile()` slot location, the stats
  part of `membership()`, the click handler for the new `plans` action)
- Modify: `public/premium.css` (hero, seal, ledger, tabs)
- Test: `tests/premium-ui-smoke.js`

**Interfaces:**
- Produces: `window.PremiumView = { sealFraction(sub) → number 0..1, heroState(snapshot) →
  'active'|'lifetime'|'expired'|'none'|'unknown', extendUntil(sub, days, nowSeconds) → seconds }`.
- Markup:
  - `.pm-hero[data-state]`, `.pm-seal`, `circle.pm-seal-arc[data-fraction]`, `.pm-seal-number`, `.pm-seal-label`.
  - `.pm-holder` (gets `.has-profile`), `[data-pm-profile]` inside `.pm-holder`, `.pm-holder-text`.
  - `.pm-ledger`, and `.pm-connection-status` inside `.pm-hero`.
  - The action button `[data-premium-action="plans"]` scrolls `#pm-plans` into view.

- [ ] **Step 1: Write the failing assertions** in `tests/premium-ui-smoke.js`
  - **Selector moves:**
    - `.pm-card-number` → `.pm-seal-number` (lines 46, 62, 107);
    - `.pm-card-bottom` → `.pm-holder` (line 59);
    - `.pm-overview-stats` → `.pm-ledger` (line 121);
    - `.pm-hero-cards.has-profile` → `.pm-holder.has-profile` (line 164).
  - **Admin (lifetime):** `.pm-hero[data-state="lifetime"]`, arc `data-fraction` `'1'`, and
    `[data-premium-action="plans"]` count 0.
  - **Member:**
    - `.pm-hero[data-state="active"]`;
    - arc `data-fraction` `'1'`;
    - the plans button text is `Extend membership`;
    - `[data-premium-tab]` count is 0.
  - **Helpers:**
    - `PremiumView.sealFraction({active:true,remainingDays:15}) === 0.5`;
    - `({active:true,remainingDays:45}) === 1`;
    - `({permanent:true,active:true}) === 1`;
    - `({active:false,status:'expired',remainingDays:0}) === 0`;
    - `PremiumView.extendUntil({active:true,expiresAt:2e9}, 30, 1e9) === 2e9 + 30*86400`;
    - `extendUntil({active:false}, 15, 1e9) === 1e9 + 15*86400`.
  - **Unknown** (at the end, member page):
    - Route `/api/premium/status` to a copy of the real snapshot with `account`, `subscription`, `balance` and
      `transactions` removed, `connected:false` and `connectionError:'PREMIUM_SERVICE_UNREACHABLE'`, then click
      Refresh.
    - Expect `.pm-hero[data-state="unknown"]` and `.pm-seal-number` `—`.
    - Expect the hero text to have no `Not active`, and `.pm-hero .pm-connection-status` to be visible.
    - Expect `[data-premium-action="plans"]` count 0.
    - Unroute afterwards.
  - **Non-member:**
    - A third desktop with a fresh synthetic ID `9000555666`, created after the member-list count assertion at
      line 91.
    - Expect `.pm-hero[data-state="none"]` and the seal label to include `NOT ACTIVE`.
    - Expect the plans button text `See plans`. After clicking it, `#pm-plans` top is `< innerHeight` within
      2 s.

- [ ] **Step 2: Run to verify it fails**
  Run: `PLAYWRIGHT_MODULE=D:/Meric/TORN/updates/ui-validation-deps/node_modules/playwright node tests/premium-ui-smoke.js`
  Expected: FAIL at the first `.pm-seal-number` wait/assert.

- [ ] **Step 3: Implement**
  - Rewrite `hero()` per the spec's Hero section, using the state from `heroState()`.
  - Seal SVG: viewBox `0 0 236 236`, r=100, the arc as `stroke-dasharray: <c*f> <c>`, rotated −90°.
  - The holder slot keeps `data-pm-profile`, and `paintProfile()` toggles `.has-profile` on `.pm-holder`.
  - `nav()` returns `''` when there is only one tab.
  - Ledger content is today's stats-row content.
  - The `plans` action calls `scrollIntoView` (`behavior: 'auto'` under no-anim or reduced motion).
  - Headlines and labels exactly as in the spec, as TR/EN pairs:
    - `GÜN KALDI/DAYS REMAINING`, `ÖMÜR BOYU/LIFETIME ACCESS`, `ÜYELİK SONA ERDİ/MEMBERSHIP EXPIRED`,
      `AKTİF DEĞİL/NOT ACTIVE`, `ÜYELİK DURUMU/MEMBERSHIP STATUS`;
    - buttons `Üyeliği uzat/Extend membership`, `Üyeliği yenile/Renew membership`, `Planları gör/See plans`;
    - non-member headline `${n} gelişmiş araç./${n} advanced tools.` + `Tek üyelik./One membership.`
  - Scoped `#view-premium .pm-holder .pm-profile` turns the shared card into a horizontal plate (round 56 px
    photo, gold ring).

- [ ] **Step 4: Run to verify it passes** (same command). Expected: `{"ok":true,...}`.

### Task 2: Collection, plans, account, privacy, footer, other states

**Files:**
- Modify: `public/premium.js` (`membership()`, `privacy()`, the disabled/not-configured blocks in `render()`,
  `sectionTitle()` → chapter heading)
- Modify: `public/premium.css`
- Test: `tests/premium-ui-smoke.js`

**Interfaces:**
- Consumes: `PremiumView.extendUntil` and `heroState` from Task 1.
- Markup:
  - `.pm-chapter` sections, each with `.pm-divider` (label) and `h3.pm-chapter-title`.
  - `.pm-collection` holds the `[data-feature-slot]` hosts.
  - `section#pm-plans`, with `.pm-plan` / `.featured` / `[data-plan]` / `.pm-plan-label` kept.
  - New `.pm-plan-until` and `.pm-receiver`.

- [ ] **Step 1: Write the failing assertions**
  - **Member:**
    - `.pm-collection .fx-entry` count 6;
    - `.pm-plan-until` count 4, the 2-Xanax one containing the date of `expiresAt + 30 d` (compare to
      `toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'})`);
    - `.pm-receiver` includes `4037017`.
  - **Admin (lifetime):** `.pm-plan-until` count 0.
  - **Non-member:** `.pm-collection .fx-entry.is-locked` count 6.
  - **Workbench** (member):
    - Click `[data-feature-slot="travel_advanced"] [data-advanced-open]` and wait for
      `[data-feature-slot="travel_advanced"][data-feature-open]`.
    - Its width must be ≥ 0.95 × `.pm-collection` width.
    - Click Refresh: the workbench is still there.
    - Close it with `[data-fx-action="close"]`.
  - The existing plan assertions (lines 123–129) stay unchanged.

- [ ] **Step 2: Run to verify it fails** (same command). Expected: FAIL at `.pm-collection`.

- [ ] **Step 3: Implement** per the spec sections Collection / Plans / Account / Privacy / Other states.
  - **Counter:** `.pm-collection{counter-reset:pm-tool}`, slot `counter-increment:pm-tool`,
    `.fx-entry::before{content:counter(pm-tool, upper-roman)}`.
  - **Hidden on this page:** `.fx-entry-mark` and `.fx-badge`.
  - **Workbench:** `.pm-collection > [data-feature-open]{grid-column:1/-1}`.
  - **Plan labels:** `RECOMMENDED/ÖNERİLEN` replaces `N DAY OPTION`.
  - **Plan dates:** with the same locale formatting as `date()`, date only.
  - **Admin tab surfaces** (`.pm-surface`, `.pm-section-heading h3`): finer border and a serif title only; their
    markup is unchanged.

- [ ] **Step 4: Run to verify it passes.** Also run
  `PLAYWRIGHT_MODULE=… node tests/feature-modules-ui-smoke.js`. Expected: both `ok:true`.

### Task 3: Motion, narrow widths, themes, full verification, TEST copy

**Files:**
- Modify: `public/premium.js` (`render()` wraps the output in `.pm-page`; `animateNext` flag)
- Modify: `public/premium.css` (keyframes, reduced motion, ≤760 / ≤520 rules, light-theme overrides)
- Test: `tests/premium-ui-smoke.js`

**Interfaces:**
- `let animateNext` is set `true` by `onViewShown('premium')` and `lrx-feature-identity-changed`, and consumed by
  the next `render()`. `.pm-page.pm-enter` carries the animations.

- [ ] **Step 1: Write the failing assertions**
  - **Entrance class:**
    - After `showView('overview'); showView('premium')`, `.pm-page.pm-enter` exists.
    - After a Refresh click, `.pm-page:not(.pm-enter)` exists.
  - **Animation on:** remove `no-anim` from body, re-show the view, and expect
    `getComputedStyle(.pm-seal-arc).animationName !== 'none'`.
  - **Reduced motion:** `page.emulateMedia({reducedMotion:'reduce'})`, re-show, and expect `'none'`. Restore
    afterwards.
  - **Themes:** the theme loop reads `.pm-hero` `backgroundImage` and expects 5 distinct values. On the Light theme,
    `getComputedStyle(.pm-seal-number).color` must not be transparent, i.e. no gradient text there.
  - **Overflow:** the 640 px overflow check runs again after switching to TR.

- [ ] **Step 2: Run to verify it fails.** Expected: FAIL at `.pm-page.pm-enter`.

- [ ] **Step 3: Implement**
  - **Keyframes:** `pmArc` (stroke-dashoffset from the circumference to 0, 1.2 s ease-out), and `pmRise` (opacity
    0 → 1 with translateY 10 px → 0, 0.6 s; `.pm-chapter` stagger 80 ms).
  - **Reduced motion:** `@media (prefers-reduced-motion: reduce){.pm-page *{animation:none!important;transition:none!important}}`.
  - **≤760 px:** single-column collection, 2×2 plans, stacked ledger, 190 px seal.
  - **≤520 px:** smaller headline.

- [ ] **Step 4: Full verification**
  - Run `npm run check`, `npm test` and `npm run test:premium`.
  - Run each smoke with `PLAYWRIGHT_MODULE=D:/Meric/TORN/updates/ui-validation-deps/node_modules/playwright`:
    `tests/ui-smoke.js`, `tests/overview-ui-smoke.js`, `tests/premium-ui-smoke.js`,
    `tests/feature-modules-ui-smoke.js`, `tests/electron-smoke.js`.
  - Expected: all pass; each smoke prints `ok:true`.
  - Review the screenshots (`QA_OUTPUT`): the five themes, the admin tabs, 640 px, and the profile plate.

- [ ] **Step 5: Copy to TEST**
  - Copy `public/premium.js`, `public/premium.css`, `tests/premium-ui-smoke.js` to
    `D:\Meric\TORN\LRX-Torn-Tracker-TEST\resources\app\` (same relative paths).
  - Run `cmp` on each pair. Expected: no output.
