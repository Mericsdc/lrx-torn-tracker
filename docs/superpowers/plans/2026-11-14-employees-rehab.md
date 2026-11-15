# Employees page and Rehab messages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One polite English rehab message for employees at addiction -8 or worse, copy only, and a calmer Employees page.

**Architecture:** Renderer-only change in `public/app.js` (`renderEmployees`, `addictionChip`, the rehab helpers and
click handlers), the Employees section of `public/index.html` and `public/styles.css`; the unused chat-typing IPC is
removed from `src/main/electron-main.js` and `src/main/preload.js`.

**Tech Stack:** Plain JS renderer, Electron main, node:test, Playwright smoke (`PLAYWRIGHT_MODULE`).

**Spec:** `docs/superpowers/specs/2026-11-14-employees-rehab-design.md`

## Global Constraints
- EN default; every new UI string through `tr('TR', 'EN')`. The rehab message itself is always English.
- Message (exact): `Hi {name}, your addiction is at {addiction} right now, which lowers your work effectiveness. When you get a chance, could you please fly to Switzerland and do a Rehab? Thank you!`
- Threshold: addiction `<= -8` (one constant `REHAB_AT = -8`).
- Copy only; nothing typed into, clicked on or sent to Torn. Every non-local request aborted in the smoke.
- Do not edit `public/themes.css`; keep the `.rehab-msg-box` class. Re-read shared files before each edit; touch only Employees parts.
- No commit, push or release.

## Review Focus
- Copying from the Overview list or the browser bar uses the same message and threshold. → smoke counts Overview copy buttons.
- Nobody at -8 or worse: card collapses to one line, KPI tile not red, nav badge hidden. → smoke empty-state step.
- An employee abroad in Switzerland at -8: still listed, status shows In Switzerland. → fixture Ben.
- Narrow widths: no sideways scroll, table rows become cards with labels. → smoke widths 1440/1100/640.
- Old `tt.rehabTplEn` custom template in localStorage must not change the message. → smoke seeds an old template.

---

### Task 1: Smoke test for the new Employees page (red)

**Files:**
- Create: `tests/employees-ui-smoke.js` (pattern: `tests/stock-ui-smoke.js`), `tests/employees-fixture.js` (done)
- Modify: `tests/torn-api.test.js` or a new static check in `tests/core.test.js`: no `torn-chat-send` / `tornChatSend` in `src/main`

Assertions (EN): `#emp-kpis > .kpi` labels `['Employees', 'Daily wages', 'Avg. effectiveness', 'Needs rehab (≤ -8)']`;
`#rehab-card [data-rehab-emp]` ids `[9000001, 9000002, 9000003]`; `#rehab-card .rehab-msg-box` = message for
Fixture_Ava -11; copy on 9000002 puts the exact message for `-9` on the clipboard; none of `[data-rf]`, `[data-tpl]`,
`#rehab-tpl-input`, `[data-send-rehab]` in the document; table heads have no "Rehab"; every `td` `data-label` = its
head; `tr.emp-crit` count 3; addiction cells: `-11 · Rehab`, `-6` (no Warning), `0` (no Clean); Overview
`#ov-company [data-copy-rehab]` count 3; `#badge-emp` = 3; empty staff (all ≥ -7): `.rehab-clear`, no rows, badge
hidden; TR: Turkish heads and title, copied message still English; widths 1440/1100/640 no sideways scroll, thead
hidden at 640; no NaN/undefined; no page errors; no Torn requests.

- [ ] Write the smoke and the static check; run both; expect FAIL on the KPI labels and the IPC check.

### Task 2: Renderer — rehab card, KPIs, table, removed code (green)

**Files:** `public/app.js` (rehab helpers ~L247-290, `renderCompany` badge ~L695, `renderOverviewCompany` copy button,
`addictionChip` / `renderEmployees` ~L927-1046, click handler ~L1612-1645, input handler ~L2410, browser bar button ~L1930),
`public/index.html` (`#view-employees`), `public/styles.css` (Rehab block ~L412-423, `.spark`/`.eff-bar`).

**Interfaces:** `REHAB_AT = -8`; `needsRehab(e) -> boolean`; `rehabMessage(name, addiction) -> string` (decoded name,
English); `addictionChip(v) -> html`.

- [ ] Implement; remove `REHAB_TEMPLATES`, `state.rehabTpl*`, `state.rehabFilter`, `sendRehabChat`, `chatSending`,
  the `data-rf` / `data-tpl` / `data-send-rehab` / `rehab-tpl-input` handlers; clear `tt.rehabFilter`, `tt.rehabTplEn`,
  `tt.rehabTplEnKey` once on load; nav badge counts only `needsRehab`.
- [ ] Remove the `torn-chat-send` handler, `chatJs`, `waitProfileLoaded` (if unused) and `tornChatSend` from preload.
- [ ] Container query on the table card for card rows; screenshots 1440/1100/640 EN+TR.
- [ ] Run the smoke and static check: PASS.

### Task 3: Verification and TEST copy
- [ ] `npm run check`, `npm test`, `npm run test:premium`, the five UI smokes + stock and employees smokes.
- [ ] Copy changed files to `D:\Meric\TORN\LRX-Torn-Tracker-TEST\resources\app` and `cmp` each.
