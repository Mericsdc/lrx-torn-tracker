# Customisable Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the fixed Overview into an ordered widget grid. Every player can move, hide and re-add the current cards and a Torn profile card. Premium members also get 11 page widgets, S/M/L sizes and up to 5 saved layouts.

**Architecture:**
- A pure UMD layout module owns the data rules: the default layout, repairing a saved layout, edit operations, and what is shown for each Premium access state.
- The local server stores one layout set per Torn player in the app config.
- In the page:
  - a host module places the existing Overview elements, which keep their IDs, plus Premium tiles in a CSS grid;
  - an edit module adds drag and drop, the keyboard controls and the add list;
  - a widgets module renders the Premium summaries from endpoints the app already has.

**Tech Stack:** Plain browser JS (no framework, strict CSP), Node `http` server, Vitest 5 for pure modules, `node:test` for the server, Playwright 1.62 for UI smokes.

**Spec:** `docs/superpowers/specs/2026-11-13-overview-widgets-design.md`

**Branch and commits:** work on `main`, as the previous plans in this repo did. Each task ends with a local commit. Nothing is pushed, released or deployed without the owner's word.

## Global Constraints

- Every user-visible text has TR and EN (`tr('…','…')` in page code). English is the default.
- Strict page CSP: no inline scripts or `on*` handlers and no grid library. `style=""` attributes are allowed.
- These elements must exist in the DOM at all times, shown or not: `#t-drug`, `#t-edu`, `#t-day`, `[data-timer="drug|edu|day"]`, `#bars`, `#mini-row`, `#status-chip`, `#xan-chip`, `#bs-totals`, `#bs-table` and `#ov-company`.
- The new switch `app.overviewLayout` is in group `app`, on by default:
  - TR: "Genel Bakış düzeni" – "Genel Bakış'ı widget'larla düzenle; kapalıyken klasik sabit ekran";
  - EN: "Overview layout" – "Arrange the Overview with widgets; off shows the classic fixed screen".
- The new Premium catalogue entry is `overview_widgets`, with `tier: 'premium'` and `module: 'overview'`:
  - title "Genel Bakış widget'ları" / "Overview widgets";
  - description "Diğer sayfalardan widget'lar, S/M/L boyut ve kayıtlı düzenler." / "Widgets from other pages, S/M/L sizes and saved layouts.".
- Locked tile text: "Premium ile açılır" / "Unlocks with Premium". Checking placeholder: "Üyelik kontrol ediliyor…" / "Checking membership…".
- Torn rules:
  - widgets only display data;
  - Premium widgets fetch only while `state.view === 'overview'` and `trackerVisible()`;
  - each widget fetches at most once per 60 s, and only from endpoints the pages already call;
  - never `POST /api/stock-order`, never `/api/faction/report`, never `/api/targets`.
- Caps: 5 layouts per player, 24 characters per layout name, each widget id at most once per layout.

## Review Focus

- **The player changes while the Overview is open.** A key of another player is saved in Settings, or another player signs in after Log Out. That player sees their own layout or the default, and the previous player's set is never shown to them or saved under their id. (Task 2: server tests. Task 3: smoke "another player in the overview sees the default layout".)
- **Edit mode is left without pressing Done.** The player opens another page, hides the window, or switches `app.overviewLayout` off. The edits are saved and edit mode closes; nothing is lost and nothing stays half-dragged. (Task 4: smoke "leaving the Overview while editing saves and closes edit mode".)
- **Company mode is off while company widgets are in the layout.** The Company summary stays hidden, as today, and leaves no blank tile. Daily order hint shows a one-line "company mode only" note and makes no request. (Task 3 and Task 5 smokes.)
- **Markup in player-controlled text.** A layout name or Torn data such as `<img src=x onerror=alert(1)>` or `<b>Bold</b>` is shown as text and never parsed. (Task 4: layout-name smoke. Task 5: widget-data smoke.)
- **A narrow window with the add list open.** At 640 px the drawer sits below the grid with no sideways scrolling. (Task 4: smoke at 640 px.)

---

### Task 1: Pure layout module

**Files:**
- Create: `public/overview-layout.js` (UMD like `public/travel-math.js`; global `LRXOverviewLayout`)
- Test: `tests/unit/overview-layout.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported, frozen):
  - `Set = { v: 1, active: number, layouts: [{ name: string, widgets: [{ id: string, size: string }] }] }`
  - `Access = 'active' | 'lapsed' | 'unknown' | 'off'`
  - `WIDGETS: [{ id, tier: 'free'|'premium', sizes: string[], size: string }]` in catalogue order; `byId`
  - `SPAN = { S: 1, M: 2, L: 3, W: 4, P: 1 }` (columns); `P` also spans 3 rows
  - `MAX_LAYOUTS = 5`, `MAX_NAME = 24`
  - `defaultSet(): Set`
  - `normalize(raw: unknown): Set` (never throws, never returns a blank set for unreadable input)
  - `view(set, access): { index, name, widgets: [{ id, size, locked: null|'premium'|'checking'|'unavailable' }] }`
  - `move(set, index, id, position)`, `remove(set, index, id)`, `add(set, index, id, access)`, `resize(set, index, id, size, access)`, `select(set, index, access)`, `duplicate(set, index, name, access)`, `rename(set, index, name, access)`, `removeLayout(set, index, access)`, `reset(set, index)`. Each returns a new normalized `Set` and never mutates its input. A refused operation returns an equal set.

**Widget table (decided here; the grid metrics are the builder's call):**

| id | tier | sizes | default |
| --- | --- | --- | --- |
| profile | free | P | P |
| drug, edu, day | free | S | S |
| bars | free | M, L | M |
| chips | free | S, M, L | S |
| battle | free | M, L | L |
| company | free | W | W |
| gym, travel, crimes, war | premium | S, M, L | M |
| networth, job, jail, awards, oc, events | premium | S, M | S |
| orders | premium | M, L | M |

**Default layout:** profile P, drug S, edu S, day S, bars M, chips S, battle L, company W. At 4 columns this fills rows 1–3 beside the tall profile with no gaps.

**Rules:**
- `normalize` does the following:
  - drops unknown ids (including `__proto__`) and duplicates;
  - replaces a size the widget does not have with the widget's default;
  - strips control characters from names, trims them and caps them at 24;
  - keeps at most 5 layouts;
  - resets an out-of-range `active` to 0;
  - gives a layout whose `widgets` is not an array the default widgets;
  - keeps an empty widget list, because the player removed everything on purpose.
- `view` per access:
  - `active`: `set.active`, stored sizes, nothing locked;
  - `lapsed`: index 0, every size at the widget's default, Premium widgets locked `'premium'`;
  - `unknown`: `set.active`, stored sizes, Premium widgets locked `'checking'`;
  - `off`: `set.active`, stored sizes, Premium widgets locked `'unavailable'`.
- Only an `active` member can `add` a Premium widget or use `resize`, `select`, `duplicate`, `rename` and `removeLayout`. `move`, `remove` and `reset` work under every access and keep Premium entries and stored sizes untouched.
- `duplicate` copies the layout at `index`, appends it with the given name, makes it active, and refuses at 5 layouts. `removeLayout` refuses the last layout and keeps `active` pointing at a remaining layout. `move` clamps `position` to the list.

- [ ] **Step 1: Write the failing tests** in `tests/unit/overview-layout.test.mjs` (`import layout from '../../public/overview-layout.js'`), with these cases:
  - `default set is today's Overview with the tall profile first`:
    - ids are `['profile','drug','edu','day','bars','chips','battle','company']`;
    - sizes are `['P','S','S','S','M','S','L','W']`;
    - `active` is 0.
  - `unreadable input falls back to the default set`: each of `null, 'x', 42, [], {layouts:'x'}, {layouts:[]}` gives `toEqual(defaultSet())`.
  - `unknown and duplicate ids are dropped and bad sizes repaired`:
    - input widgets `[{id:'drug',size:'S'},{id:'drug'},{id:'__proto__'},{id:'nope'},{id:'bars',size:'XL'},{id:'gym',size:'L'}]`;
    - expected `[{id:'drug',size:'S'},{id:'bars',size:'M'},{id:'gym',size:'L'}]`.
  - `at most five layouts, 24-character names, active index reset`:
    - 7 layouts give length 5;
    - a 40-character name gives length 24;
    - `'a\u0000b'` gives `'ab'`;
    - `active: 9` gives 0.
  - `a layout whose widgets are not a list gets the default widgets; an empty list stays empty`.
  - `a member sees the chosen layout at its saved sizes`: active 1, gym L gives `index 1`, gym `size 'L'`, `locked null`.
  - `after Premium ends the first layout shows at default sizes with Premium widgets locked`:
    - `view(set,'lapsed')` gives index 0, bars `'M'` (saved `'L'`), gym locked `'premium'`;
    - the input set is deep-equal to its copy taken before the call.
  - `unknown access keeps the saved layout and sizes and marks Premium widgets as checking`.
  - `Premium switched off marks Premium widgets as not available`.
  - `a hand-edited set gives a free user no working Premium widget`: every Premium id in the set; `view(set,'lapsed')` and `view(set,'unknown')` lock all 11.
  - `add refuses Premium widgets unless active and refuses ids already present`:
    - `add(set,0,'gym','lapsed')` equals `set`;
    - `'active'` appends `{id:'gym',size:'M'}`.
  - `resize needs an active member and a size the widget has`:
    - `('bars','L','lapsed')` changes nothing;
    - `('bars','L','active')` gives `L`;
    - `('bars','S','active')` changes nothing.
  - `move places a widget and keeps the others in order`:
    - `move(defaultSet(),0,'battle',0)` puts battle first and leaves the rest in the default order;
    - position 99 places it last.
  - `remove, move and reset keep Premium widgets and saved sizes under unknown access`.
  - `layouts: duplicate, rename, select and delete are for active members; the last layout stays`:
    - duplicate at 5 layouts is refused;
    - `removeLayout` on a single layout is refused.
  - `operations never mutate a deeply frozen input`.
- [ ] **Step 2: Run the tests and verify they fail.** Run `npx vitest run tests/unit/overview-layout.test.mjs`. Expected: FAIL (cannot resolve `../../public/overview-layout.js`).
- [ ] **Step 3: Implement `public/overview-layout.js`** with the interfaces and rules above.
- [ ] **Step 4: Run the tests and verify they pass.** Run `npx vitest run tests/unit/overview-layout.test.mjs`, then `npm run check`. Expected: all pass, and the syntax check counts one more file.
- [ ] **Step 5: Commit** `public/overview-layout.js`, `tests/unit/overview-layout.test.mjs` and the spec `docs/superpowers/specs/2026-11-13-overview-widgets-design.md` with the message "Overview layout rules: defaults, repair, edits, Premium access".

### Task 2: Per-player layout storage in the local server

**Files:**
- Modify: `src/server/server.js` (next to `POST /api/features`, about line 1925)
- Test: `tests/account.test.js` (append; it already signs players 111 and 222 in and out against a Torn stub)

**Interfaces:**
- Consumes: `normalize` from Task 1, through `require('../../public/overview-layout')`.
- Produces:
  - `GET /api/overview-layouts` returns `200 { playerId: number|null, layouts: Set|null }`:
    - `playerId` is `historyOwner()`, the server's player and never the client's;
    - `layouts` is the normalized `config.overviewLayouts[String(playerId)]`, or `null` if nothing is saved.
  - `POST /api/overview-layouts` with body `{ playerId, layouts }`:
    - if `playerId` is not `historyOwner()`, or the owner is null, it returns `409 { error, code: 'PLAYER_CHANGED' }` and saves nothing;
    - otherwise it stores `normalize(layouts)` under `config.overviewLayouts[String(playerId)]`, calls `saveConfig()` and returns `200 { ok: true, playerId, layouts }`.
  - Other players' entries are never touched or returned.

- [ ] **Step 1: Write the failing tests** at the end of `tests/account.test.js`:
  - `each player gets back only their own Overview layouts`:
    1. Log out, then sign in with `KEY_A`.
    2. POST `{playerId:111, layouts:{v:1,active:0,layouts:[{name:'Daily',widgets:[{id:'battle',size:'M'}]}]}}`. Expect 200.
    3. GET returns `playerId 111` and that set.
    4. Log out, then sign in with `KEY_B`. GET returns `{playerId:222, layouts:null}`.
    5. POST with `playerId:111` returns 409 with `code 'PLAYER_CHANGED'`.
    6. Log out, then sign in with `KEY_A`. GET returns the `Daily` set again.
  - `a hostile saved layout is repaired before it is stored`:
    - POST 7 layouts, a name `'<img src=x onerror=alert(1)>'.repeat(3)`, the ids `'__proto__'` and `'nope'`, and a string as `widgets`;
    - `savedConfig().overviewLayouts['111']` has 5 layouts, names of at most 24 characters, no unknown ids, and default widgets where `widgets` was a string.
- [ ] **Step 2: Run the tests and verify they fail.** Run `node --test --test-reporter=tap tests/account.test.js`. Expected: the two new tests fail with status 404, not 200.
- [ ] **Step 3: Implement both routes** in `src/server/server.js` as specified. `readBody` already caps bodies at 100 KB.
- [ ] **Step 4: Run the tests and verify they pass.** Run `npm run test:node`. Expected: all pass.
- [ ] **Step 5: Commit** `src/server/server.js` and `tests/account.test.js` with the message "Save Overview layouts per Torn player in the app config".

### Task 3: Widget grid, free widgets, shared profile card and the classic switch

**Files:**
- Create: `public/profile-card.js` (global `LRXProfileCard`; loaded before `premium.js`)
- Modify: `public/premium.js:50-76` (`profileCard()` keeps its account and `app.premiumProfile` checks; the markup and photo handling move to `LRXProfileCard`)
- Modify: `public/index.html:211-268` (Overview markup), plus the `<link>` and `<script>` tags
- Create: `public/overview.css` (linked after `premium.css`)
- Create: `public/overview-host.js` (loaded after `feature-access.js` and `premium.js`)
- Modify: `public/feature-access.js` (the `window.PremiumAccess = {…}` line: add `fresh: () => performance.now() < deadline`)
- Modify: `public/features.js:71` (switch `app.overviewLayout` right after `app.premiumProfile`)
- Modify: `public/feature-catalog.js` (add `app.overviewLayout` to the legacy list)
- Test: `tests/overview-ui-smoke.js` (new)

**Interfaces:**
- Consumes: `LRXOverviewLayout` from Task 1, and both routes from Task 2.
- Produces:
  - `LRXProfileCard.html(player): string` returns `''` when `player` is missing. Its markup and `pm-profile*` classes are exactly those of today's `profileCard()`, including `data-open-url` and `data-tab-label`.
  - `LRXProfileCard.paint(slot, html): boolean` skips an unchanged `html`, marks a failed photo `is-missing`, and returns whether it painted.
  - `window.LRXOverview`:
    - `current(): Set`;
    - `access(): Access`;
    - `shown(): View` (the last `view()` result);
    - `owner(): number|null`;
    - `commit(set, { save = true } = {}): Promise<void>`;
    - `apply(): void`;
    - `tiles: { [premiumId]: (el, locked) => void }`, a registry Task 5 fills (until then a locked Premium tile shows its lock state, and an unlocked one shows only its title);
    - `onApplied: Array<() => void>`, hooks Task 4 uses to redraw edit controls.

**Markup:**
- `#view-overview` holds `#ow-bar`, then `.ow-wrap` with the grid `#ow-grid` and an empty `<aside id="ow-drawer" hidden>`.
- Grid children, each with `class="ow-w"` and `data-widget`:
  - `article[data-widget=profile]`;
  - the three existing timer articles, unchanged inside;
  - `bars`: an article with the "Bars" head, `#status-chip` and `#bars`;
  - `chips`: an article with the head "Durum / Status" and `#mini-row`;
  - `battle`: the existing card;
  - `company`: `#ov-company`, which keeps `class="grid three"`.
- Premium tiles are `article.glass.card.ow-w.ow-premium[data-widget]`, created and removed by the host.

**Behaviour:**
- `access()`:
  - `'off'` if `!feat('app.premium') || !feat('app.premiumPromos')`;
  - `'active'` if `PremiumAccess.can('overview_widgets')`;
  - `'unknown'` if `!PremiumAccess.fresh()`;
  - otherwise `'lapsed'`. A fresh grant without this module also counts as lapsed; that covers the time before the Premium service knows the module.
- `apply()`, with the layout switch on:
  - takes `view(current, access())`;
  - appends the widget elements to `#ow-grid` in that order;
  - sets `data-size` to the shown size;
  - gives elements that are not in the view the class `ow-off` (`display:none`), and never touches `hidden`, which company mode owns;
  - paints the profile with `LRXProfileCard`;
  - shows the hint "Bu düzende widget yok. Eklemek için Düzenle'ye bas." / "This layout has no widgets. Press Edit to add some." when the view is empty.
- `apply()`, with the switch off (classic):
  - adds `ow-classic` to the grid;
  - moves `#mini-row` back into the bars card and hides profile, chips and Premium tiles;
  - with the switch on again, `#mini-row` returns to the chips card.
- **Grid CSS:**
  - `grid-template-columns: repeat(4, minmax(0,1fr))` with `grid-auto-rows: minmax(110px, auto)`;
  - spans come from `SPAN`;
  - `@media (max-width: 1200px)`: 2 columns, with L and W capped to 2;
  - `@media (max-width: 639px)`: 1 column; every span is 1 and the profile row span is `auto`;
  - classic: 6 columns, timers span 2, bars and battle span 3, company spans 6. Below 1200 px it follows today's `.grid.timers` and `.grid.two` rules.
- **Loading:**
  - At start, `current` is the copy saved in `localStorage['tt.cache.overviewLayouts.' + id]`, normalized, when `state.overview.player.id` is known. Otherwise it is `defaultSet()`.
  - The host then GETs `/api/overview-layouts`. If the reply's `playerId` is not the overview's player id, it uses `defaultSet()` and saves nothing.
  - The chained `window.onOverviewRendered` reloads when the overview's player id changes.
  - `lrx-premium-reset` resets to `defaultSet()` and sets `owner` to null.
  - A failed GET keeps the current set with no alert.
- **Saving:**
  - `commit` POSTs one save at a time;
  - a 409 reloads from the server and shows a toast: "Düzen başka bir oyuncuya ait; yeniden yüklendi." / "The layout belonged to another player; reloaded.";
  - other errors show a toast: "Düzen kaydedilemedi: " / "Could not save the layout: " followed by the message;
  - after a successful save, the localStorage copy is updated.
- `window.onLangChanged` is chained to `apply()`, and the host's `apply` is pushed into `FEATURE_HOOKS`.

- [ ] **Step 1: Write the failing smoke** `tests/overview-ui-smoke.js`.
  - **Harness**, taken from `tests/premium-ui-smoke.js:1-40`:
    - a real Premium service in test mode, and `desktop(tornId)` forking `tests/preview-server.js`;
    - before the fork, write `history.json` as `{ ownerId: tornId, days: [], addiction: {}, user: {}, stockOrders: {} }`;
    - route `/api/overview` to a full fixture for `tornId` 4037017 with name `'<b>Bold</b>'` and the image `https://…/ok.png`, fulfilled with `public/logo.png`.
  - **Assertions:**
    - `default layout`:
      - the visible `#ow-grid > .ow-w:not(.ow-off)` ids are `profile, drug, edu, day, bars, chips, battle`;
      - `#ov-company` is hidden because the player is not a director;
      - the profile shows `<b>Bold</b>` as text and carries `data-open-url` ending `XID=4037017`.
    - `fixed IDs`: each listed in Global Constraints has `count() === 1`.
    - `saved layout`: POST `[{id:'battle',size:'M'},{id:'drug',size:'S'}]` through `page.evaluate(fetch)`. After a reload the visible ids are `battle, drug`, and `#bars` still exists.
    - `corrupt cached copy`: `localStorage['tt.cache.overviewLayouts.4037017'] = '{bad'` and a GET routed to 500 give the default ids after a reload.
    - `free cards first`: with the GET delayed 1500 ms, `#t-drug` is visible before the GET answers.
    - `another player in the overview sees the default layout`: switch the fixture's id to 3000001, then `loadOverview(true)`. The default ids show and no POST is sent.
    - `classic switch`: `setFeature('app.overviewLayout', false)`:
      - `#mini-row` is inside `[data-widget=bars]`;
      - the profile is not visible;
      - at 1440 px the three timer cards share one `top`;
      - switching it on restores the chips card.
    - `widths`: at 1440, 1100, 760, 640 and 600 px:
      - `scrollWidth <= innerWidth`;
      - the column counts are 4, 2, 2, 2 and 1;
      - each width gets a screenshot.
    - `themes`: the five themes, switched the way `tests/ui-smoke.js:224` does, each get a screenshot with no overflow.
    - No `pageerror` and no CSP console messages.
- [ ] **Step 2: Run the smoke and verify it fails.** Run `PLAYWRIGHT_MODULE=C:/Users/LRX/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/overview-ui-smoke.js`. Expected: FAIL at `default layout` (no `#ow-grid`).
- [ ] **Step 3: Extract `LRXProfileCard`** and switch `premium.js` to it. Then run `node tests/premium-ui-smoke.js` (same env). Expected: PASS, including the profile checks.
- [ ] **Step 4: Build the markup, CSS, host, switch, `fresh` and catalogue key** as specified.
- [ ] **Step 5: Run everything and verify it passes:**
  - `npm run check`
  - `npm test`
  - `node tests/overview-ui-smoke.js`
  - `node tests/ui-smoke.js`
  - `node tests/premium-ui-smoke.js`
  - `node tests/electron-smoke.js`

  Expected: all PASS. Open the screenshots: the profile is tall on the left, and the 1100 and 640 px shots have no overflow.
- [ ] **Step 6: Commit** the files above with the message "Overview widget grid with profile card; classic layout switch".

### Task 4: Edit mode

**Files:**
- Create: `public/overview-edit.js` (global `LRXOverviewEdit`, loaded after `overview-host.js`)
- Modify: `public/overview.css` (edit styles)
- Modify: `public/app.js:361-372` (`showView` calls `LRXOverviewEdit.stop()` when leaving `overview`)
- Test: `tests/overview-ui-smoke.js`

**Interfaces:**
- Consumes: `LRXOverview` (Task 3) and the layout operations (Task 1).
- Produces: `window.LRXOverviewEdit = { start(): void, stop(): Promise<void>, active(): boolean }`. Task 5's opener calls `start()`.

**Behaviour:**
- **`#ow-bar` outside edit mode:**
  - a `<select id="ow-layout">`, shown only when access is `active` and there is more than one layout. Choosing a layout calls `commit(select(...))` and saves.
  - the button `#ow-edit`, "Düzenle" / "Edit", hidden when `app.overviewLayout` is off.
- **`#ow-bar` in edit mode:** the select, plus:
  - `#ow-name` input (maxlength 24): rename on change;
  - "Çoğalt" / "Duplicate", disabled at 5 layouts;
  - "Sil" / "Delete", disabled with 1 layout.

  These three show only when access is `active`. Then come:
  - "Varsayılana dön" / "Reset to default": a two-step button whose first click relabels it "Emin misin?" / "Sure?" for 4 s;
  - "+ Widget ekle" / "+ Add widget";
  - "Bitti" / "Done".

  The default layout name, shown when the stored name is `''`, is "Ana düzen" / "Main". Names are set with `textContent` and `value`, never `innerHTML`.
- **Widget controls:**
  - the grid gets `ow-editing`, and every shown widget gets dashed edit controls:
    - `button.ow-handle`, with the label "Taşı: <title>" / "Move: <title>";
    - `button.ow-remove` "×", with the label "Kaldır" / "Remove";
    - when access is `active` and the widget has more than one size, `.ow-sizes` buttons S/M/L with `aria-pressed`;
  - titles come from `LRXOverviewWidgets.titles` once Task 5 lands, and from a local fallback map of the 8 free titles until then.
- **Drag and drop:** HTML5 drag and drop that starts only from `.ow-handle`.
  - With 2 or more columns, the drop goes before or after the target by its horizontal midpoint; with 1 column, by its vertical midpoint.
  - An indicator class `ow-drop-before` or `ow-drop-after` marks the spot.
  - No transition under `body.no-anim` or `prefers-reduced-motion`.
- **Keyboard on the handle:**
  - ArrowLeft/ArrowUp moves the widget one place earlier; ArrowRight/ArrowDown one place later;
  - Delete/Backspace removes it;
  - after the redraw, focus returns to the same widget's handle, or to the next handle when the widget was removed.
- **Add drawer `#ow-drawer`:**
  - group "Ücretsiz" / "Free": the free widgets not in the layout. `company` is listed only when `state.companyMode && feat('page.company')`.
  - group "Premium 👑", absent when access is `off`: the Premium widgets not in the layout. Unless access is `active`, they are disabled with 🔒 and the note "Premium".
  - At 900 px and narrower the drawer sits below the grid.
- Edits made in edit mode use `commit(set, { save: false })`. Done, leaving the view, `visibilitychange` to hidden, and `app.overviewLayout` switched off all call `stop()`, which saves once. `lrx-premium-reset` closes edit mode without saving.

- [ ] **Step 1: Add the failing smoke cases** (free player 3000001, no Premium):
  - `edit mode shows a handle and × for each shown widget`.
  - `× removes chips and #mini-row stays in the DOM`.
  - `keyboard: ArrowLeft twice on battle moves it two places; Delete on day removes it`.
  - `drag drug onto edu moves drug after edu` (`locator.dragTo` with the target position past its midpoint).
  - `add list: chips comes back last; Premium items are disabled with a lock`.
  - `Done saves: after a reload the order is the same`.
  - `leaving the Overview while editing saves and closes edit mode` (`showView('settings')`, then back).
  - `640 px with the drawer open: no sideways scrolling; the drawer is below the grid`.
- [ ] **Step 2: Run the smoke and verify it fails.** Run `node tests/overview-ui-smoke.js`. Expected: FAIL at `edit mode shows…` (no `#ow-edit`).
- [ ] **Step 3: Implement `public/overview-edit.js`, its CSS and the `showView` hook.**
- [ ] **Step 4: Run and verify it passes.** Run `npm run check` and `node tests/overview-ui-smoke.js`, then `node tests/ui-smoke.js`. Expected: PASS. Check the edit-mode screenshots at 1440 and 640 px in the five themes: dashed frames, readable controls, and in Light enough contrast for the controls.
- [ ] **Step 5: Commit** with the message "Overview edit mode: drag, keyboard, add list, reset".

### Task 5: Premium widgets, catalogue entry and opener

**Files:**
- Create: `public/overview-widgets.js` (global `LRXOverviewWidgets`, loaded before `overview-host.js`)
- Modify: `public/overview-host.js` (render `active` tiles through the registry; refresh loop)
- Modify: `public/feature-catalog.js:14` (definition `overview_widgets`)
- Modify: `public/feature-access.js:104-109` (`window.PremiumOpeners?.[id]` runs instead of `LRXAdvanced.open` when present)
- Modify: `tests/premium/features.test.js:37` (5 → 6, and assert `byId.overview_widgets` has `tier 'premium'`)
- Modify: `tests/feature-modules-ui-smoke.js:64` (5 → 6)
- Modify: `docs/TESTING.md` ("five Premium modules" becomes six; add the `overview-ui-smoke.js` command and what it covers)
- Test: `tests/overview-ui-smoke.js`

**Interfaces:**
- Consumes: `LRXOverview.tiles`, `access()` and `shown()` (Task 3), and `LRXOverviewEdit.start()` (Task 4).
- Produces: `LRXOverviewWidgets`:
  - `titles: { [id]: [tr, en] }` for all 19 widgets, with the names from the spec table;
  - `premium: { [id]: { needs: string[], view: string, load: (() => Promise<any>)|null, html: (data, size) => string } }`;
  - `window.PremiumOpeners.overview_widgets = () => { showView('overview'); LRXOverviewEdit.start(); }`.

**Premium widgets:** each reads an endpoint its page already calls. Field meanings are taken from the named renderer. S shows the one-liner below; M and L add the next lines of the same data. All Torn text goes through `esc()`.

| id | needs | view | data | S line |
| --- | --- | --- | --- | --- |
| gym | page.gym | gym | `GET /api/stats` (`renderGym`, features.js:447) | gain of the top two stats in the last 24 h |
| networth | page.networth | networth | `GET /api/networth` (`renderNetworth`, :496) | total · change today |
| travel | page.travel | travel | `GET /api/travel` (`renderTravelResults`, :684) | best country · item · $/hour |
| job | page.job | job | `GET /api/job` (`renderJob`, :373) | job points · positions that fit |
| crimes | page.crimes | crimes | `GET /api/shoplifting` if `crimes.shoplift`, `GET /api/crime-value` if `crimes.value` (`renderCrimes`, extras.js:176) | shops without security · best $/nerve crime |
| jail | page.crimes, crimes.jail | crimes | `GET /api/jail` | busts 24 h · 72 h · penalty |
| awards | page.awards | awards | `GET /api/awards` (`renderAwards`, extras.js:226) | closest missing award and % |
| oc | page.faction | faction | `GET /api/faction` only, using `myOc` (faction.js:58) | next OC time · readiness |
| war | page.war | war | `GET /api/wars`; the targets count only from an already loaded `state.targets` | ranked war score · suitable targets |
| events | page.tools, tools.events | tools | `GET /api/events` | next event · countdown |
| orders | page.company | report | `state.company` only (`load: null`) | lowest days left · what to order today |

**Tile states:**
- `locked 'premium'` shows "Premium ile açılır" / "Unlocks with Premium" and a small button `data-goto-view="premium"`.
- `'checking'` shows the checking placeholder.
- `'unavailable'` shows "Kullanılamıyor" / "Not available", with no sales text and no link.
- An unlocked tile shows one of three notes and makes no request:
  - if a key in `needs` is off: "Ayarlarda kapalı" / "Turned off in Settings";
  - else if `viewHidden(view)`: "Bu sayfa şu an senin için gizli" / "This page is hidden for you right now";
  - for `orders` without `state.companyMode`: "Yalnızca şirket modunda" / "Company mode only".
- An error shows one escaped line inside the frame.
- Clicking the tile body, outside the edit controls, opens the page with `showView(view)`.

**Refresh:**
- The refresh check runs on `onViewShown('overview')`, after `apply()`, and every 15 s.
- It does nothing unless `state.view === 'overview' && trackerVisible()`.
- For each unlocked, enabled tile whose last attempt is at least 60 s old, it runs `load()` once and records the attempt time whether it succeeds or fails.
- `orders` re-renders on `onOverviewRendered` and when the company report changes; it never fetches.

- [ ] **Step 1: Update the counts and write the failing tests.**
  - In `tests/premium/features.test.js`, assert `catalog.premium.length === 6` and the `overview_widgets` entry.
  - Add to `tests/overview-ui-smoke.js`:
    - `member: networth and travel tiles render escaped data`: the member cases use 4037017, a permanent member; the routed `/api/networth` and `/api/travel` fixtures contain `<b>x</b>`.
    - `member: S/M/L chips resize and a second layout is saved and switched`.
    - `member: a layout name with markup is shown as text`.
    - `fetch policy`: with `page.clock`, none of the counted `/api/networth` requests happen while another view is shown; within 59 s there is 1; after 61 s there are 2.
    - `page off`: `setFeature('page.networth', false)` shows the Settings note and no request follows.
    - `never requested`: zero `POST /api/stock-order`, `/api/faction/report` and `/api/targets`.
    - `lapsed`: player 3000002 (4037017 is permanent and cannot lapse) does the following:
      1. becomes a member with `service.adminAction({tornId:4037017,admin:true},'test-payment',{torn_id:3000002,quantity:1})`;
      2. saves a second layout with sizes and makes it active;
      3. lapses with `service.adminAction({tornId:4037017,admin:true},'subscription',{torn_id:3000002,days:-1000,reason:'QA lapse'})`. Layout 1 shows at default sizes with locked tiles, and the saved config still holds layout 2 as active.
      4. renews with another `test-payment`. The chosen layout and sizes return.
    - `unknown`: with `/api/premium/status` routed to 503, Premium tiles show the checking placeholder and no widget request is made.
    - `off`: with `app.premiumPromos` off, the Premium group is gone from the add list and tiles read "Not available".
    - `orders without company mode` shows the note.
    - `Premium page Open goes to the Overview edit mode`.
  - Change `tests/feature-modules-ui-smoke.js:64` to 6.
- [ ] **Step 2: Run the tests and verify they fail.** Run `npm run test:premium` and `node tests/overview-ui-smoke.js`. Expected: `catalog.premium.length` is 5, not 6, and the member smoke fails at the networth tile.
- [ ] **Step 3: Implement the widgets, the refresh loop, the catalogue entry and the opener.**
- [ ] **Step 4: Run the full verification and confirm it passes:**
  - `npm run check`
  - `npm run test:all`
  - `node tests/overview-ui-smoke.js`
  - `node tests/ui-smoke.js`
  - `node tests/premium-ui-smoke.js`
  - `node tests/feature-modules-ui-smoke.js`
  - `node tests/electron-smoke.js`

  Expected: every one passes. Look at the member, lapsed and narrow-width screenshots.
- [ ] **Step 5: Commit** with the message "Premium Overview widgets, saved layouts and module entry". The Premium service needs a redeploy before members can use the module; until then members see locked tiles. Deploy only when the owner asks.
