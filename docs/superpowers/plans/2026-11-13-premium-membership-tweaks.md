# Premium Membership Tweaks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Premium page shows:
- the plan each member paid for;
- the total Xanax received (admin only);
- member payment history without transaction IDs;
- the viewer's own Torn profile beside the membership card.

**Architecture:**
- One read-only field is added to the Premium service's `me()` snapshot.
- Everything else is rendering in `public/premium.js` and `public/premium.css`, plus one hook from `renderOverview()` in `public/app.js`.
- The profile card reads `state.overview.player`, which the app already fetches.

**Tech Stack:** Node 24, node:sqlite (Premium service), vanilla browser JS, Playwright smoke tests, node:test.

**Spec:** docs/superpowers/specs/2026-11-13-premium-membership-tweaks-design.md

## Global Constraints

- No new Torn request. The profile data comes only from `state.overview.player`.
- Every visible text has TR and EN, using `tr('…', '…')`. English is the default.
- Escape every Torn-supplied string with `esc(decode(...))`. Use an image URL only if it parses as `https:`.
- New switch: `app.premiumProfile` in group `app`, `def: true`. Register it in `public/features.js` FEATURE_DEFS and in the `public/feature-catalog.js` legacy list.
- The member CSV export, prices, plan quantities `[1, 2, 4, 10]` and payment processing stay unchanged.
- Strict page CSP: no inline handlers or inline `<script>`. Style attributes are allowed but not needed.

## Review Focus

1. **App opened straight on `#premium` before the first overview arrives.** The card must appear once the overview renders, without repainting the page. Owner: Task 2. Test: call the hook after injecting the overview and assert that the card appears.
2. **The profile photo fails to load.** Expected: the card keeps the name and a placeholder, with no broken-image icon. Owner: Task 2. Test: the smoke route aborts the Torn image request; assert that the card gets `is-missing`.
3. **A player name containing markup.** It must show as text. Owner: Task 2. Test: name `<b>Bold</b>`; assert no `b` element in the card and that its text contains `<b>`.
4. **The admin is on an older service without `receivedTotal`.** The stat falls back to the admin's own balance (code path `d.receivedTotal ?? d.balance?.total_received`). Covered by review only.
5. **An overview player different from the Premium account.** Expected: no card. Owner: Task 2. Test: inject another ID; assert that the card is hidden.

---

### Task 1: Total Xanax received in the admin snapshot

**Files:**
- Modify: `premium/store.js`: export `receivedTotal()` next to `balance` (around line 317).
- Modify: `premium/service.js`: `me(actor)` (line 30).
- Test: `tests/premium/membership.test.js`.

**Interfaces:**
- Produces: `store.receivedTotal(): number`, which is `SELECT coalesce(sum(total_received),0)` over `premium_payment_balances`.
- Produces: `me(actor).receivedTotal`, which is present only when `actor.admin` is true.

- [ ] **Step 1: Write the failing test** `admin snapshot carries the Xanax received from every member; a member snapshot does not`. Its steps:
  - register the admin;
  - make `test-payment` calls of 2 and 4;
  - check that `service.me(ADMIN).receivedTotal === 6`;
  - check that `'receivedTotal' in service.me({ tornId: secondPayer, admin: false })` is false.
- [ ] **Step 2: Run** `node --test tests/premium/membership.test.js`.
  Expected: FAIL (`undefined !== 6`).
- [ ] **Step 3: Implement** `receivedTotal` in the store and spread `...(actor.admin ? { receivedTotal: store.receivedTotal() } : {})` into `me()`.
- [ ] **Step 4: Run** `npm run test:premium`.
  Expected: all pass, 84 tests.

### Task 2: Premium page rendering and profile card

**Files:**
- Modify: `public/premium.js`: `hero()`, `membership()`, `paymentTable()`, the new `profileCard()` and `paintProfile()`, and the `window.onOverviewRendered` hook.
- Modify: `public/premium.css`: `.pm-hero-cards` and `.pm-profile*`, plus the breakpoints at 1100 px and 760 px.
- Modify: `public/app.js`: the end of `renderOverview()`, which calls `window.onOverviewRendered?.()`.
- Modify: `public/features.js` and `public/feature-catalog.js`: add `app.premiumProfile`.
- Test: `tests/premium-ui-smoke.js`.

**Interfaces:**
- Consumes: `snapshot.receivedTotal` from Task 1.
- Produces:
  - `.pm-plan.featured[data-plan="<q>"]`, with `data-plan` set on every plan card;
  - `.pm-plan-label` text "YOUR PLAN" / "SON PLANINIZ";
  - `[data-pm-profile]` slot inside `.pm-hero-cards`;
  - `.pm-profile.is-missing` when the photo fails;
  - `img.pm-profile-photo`.

- [ ] **Step 1: Extend the smoke test (failing first).** Add these assertions after the existing ones and before the language switch:
  - the user's `#premium-content .pm-event-id` count is 0, and the admin Payments tab still contains `xss_review`;
  - the admin, after **Refresh**, has `.pm-overview-stats` text matching `/Total Xanax received\s*3/`. The payments so far are 2 (the UI test payment) and 1 (`xss_review`, sender unknown, so it is not counted). Use the real value printed by the service, `service.store.receivedTotal()`, rather than a hard-coded number;
  - `service.adminAction(ADMIN, 'test-payment', { torn_id: tornId, quantity: 4 })`, then a user refresh, gives `.pm-plan.featured[data-plan="4"]` with the label `YOUR PLAN`;
  - profile, injected with `page.evaluate`: set `state.overview = { player: { id: tornId, name: '<b>Bold</b>', level: 15, image: 'https://profileimages.torn.com/x.png', status: { state: 'Okay', description: 'Okay' }, faction: { faction_tag: 'TAG' } } }`, then call `onOverviewRendered()`. Then check:
    - `[data-pm-profile] .pm-profile` is visible;
    - its text contains `<b>Bold</b>` and it has no `b` element;
    - `img.pm-profile-photo` src is that URL, and the card gets `is-missing` after the aborted load;
  - a different `id` hides the card. `image: 'javascript:alert(1)'` produces no `img`. `state.config.features['app.premiumProfile'] = false` plus the hook hides the card.
- [ ] **Step 2: Run** the smoke test with `PLAYWRIGHT_MODULE` set.
  Expected: FAIL on the first new assertion.
- [ ] **Step 3: Implement.** Follow the spec's "Builder's calls" exactly:
  - the plan comes from the most recent `applied` row in `d.transactions`;
  - the label is admin `Toplam alınan Xanax` / `Total Xanax received` and member `Toplam Xanax` / `Total Xanax`;
  - the event ID is shown only when `manage`;
  - the profile card shows the photo, `name [id]`, `Lv N`, the status from `statusInfo()` and the faction tag. It has `data-open-url` and `data-tab-label`, like `#me-chip`;
  - photo errors are handled with `addEventListener('error')` after paint.
- [ ] **Step 4: Run** the smoke test.
  Expected: PASS. Then look at the screenshots `premium-obsidian.png`, `premium-admin.png` and `premium-640.png`.
- [ ] **Step 5: Run** `npm run check`, `npm run test:all` and `node tests/electron-smoke.js`.
  Expected: all green. Update the Premium test count in `docs/TESTING.md`.
