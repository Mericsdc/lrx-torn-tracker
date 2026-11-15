# Merit Tracker easy wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pointless "Only with progress" filter with an Easy wins card, grouped "Show" filter and TR/EN how-to lines.

**Architecture:** The server tags each measurable award with the personal stat it reads (`stat`) and the rule's text capture
(`what`). A pure browser/Node module `public/merit-guide.js` (`LRXMerit`) turns awards into groups, how-lines, series and
views; `public/extras.js` renders it.

**Tech Stack:** Node `node:test`, vitest, Playwright (UI smoke), plain browser JS.

**Spec:** `docs/superpowers/specs/2026-11-14-merit-tracker-easy-wins-design.md`

## Global Constraints
- Every UI text is a `[tr, en]` pair; English is the default language.
- No new Torn requests; `/api/awards` stays the only call. Tests use synthetic data only.
- Only Merit parts of shared files (`extras.js`, `styles.css`, `index.html`, `package.json`); re-read before each edit.
- Do not touch `public/themes.css`; new CSS uses variables so the light theme works.
- No commits (owner's rule).

## Review Focus
- An award whose description matches no rule (pct null) must still render with a how-line (once/event/secret) — unit test.
- Search/kind/type that empties a group must say so and offer "Clear filters" — unit + UI test.
- A series where honor and medal share the same goal (level 50 honor + medal) must show both — unit test.
- Days-left for "Login on November 15th" across the year end (asked on 31 Dec) — unit test.
- Money stats format as money, not plain numbers — unit test.

---

### Task 1: Server tags `stat` and `what`
**Files:** Modify `src/server/server.js` (`AWARD_RULES` map, `awardProgress`, `getAwards`); Create `tests/awards.test.js`;
Modify `package.json` (`test:node` list).
**Produces:** each award `{ ..., stat: string|null, what: string|null }`.
- [ ] Test: `/api/awards` with synthetic honors/medals → Theft rule gives `stat 'crimes.offenses.theft'`, `what 'Theft'`;
  "Reach level Forty Five" → `stat 'level'`; rank → `stat 'rank'`, `what 'Master'`; stalemate → `stat` with `|`;
  one-time honor → `stat null`; owned → `stat null`.
- [ ] Run, see FAIL; implement (recording `g`, explicit `stat` for profile rules); run, PASS.

### Task 2: `LRXMerit` module
**Files:** Create `public/merit-guide.js`, `tests/unit/merit-guide.test.mjs`.
**Produces:** `GROUPS`, `GROUP_LABEL`, `guide(a, fmt, now)`, `seriesKey(a)`, `markTiers(list)`, `sortRows(rows)`,
`view(awards, opts, fmt, now)`, `easyWins(awards, fmt, now)`; `fmt = { num, money }`.
- [ ] Tests for groups, how pairs with numbers, places, days, series/tiers, order, easy wins, empty reasons; FAIL; implement; PASS.

### Task 3: Page
**Files:** Modify `public/extras.js` (Merit section), `public/styles.css` (`.aw-*`), `public/index.html` (script tag);
Create `tests/awards-ui-smoke.js`.
- [ ] Smoke: Easy wins card, Show filter empty reasons + Clear filters, tiers switch, TR/EN, 1440/640 px; FAIL; implement; PASS.

### Task 4: Verify and ship to TEST
- [ ] `npm run check`, `npm test`, `npm run test:premium`, the five UI smokes + awards smoke; copy changed files to TEST; `cmp`.
