# Themes Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat five-swatch Themes grid with a theme list and a large live preview of the app (design B).

**Architecture:** The theme variable blocks in `themes.css` also match `[data-preview-theme="…"]`, so any element can
render in any theme's real colours. A scoped base block supplies the Obsidian and shared values that the Light theme
overrides. `workspace.js` builds the list, the preview skeleton and the caption, and moves the preview on hover and
focus. Applying and saving keep the existing `/api/config` flow.

**Tech Stack:** Plain browser JS (no build), CSS, Playwright smoke tests (`tests/ui-smoke.js`).

**Spec:** `docs/superpowers/specs/2026-11-15-themes-picker-design.md`

## Global Constraints
- Every visible string uses `tr('TR', 'EN')`, and English is the default.
- The five theme ids, their colours, `config.theme`, `localStorage['tt.theme']` and `theme-init.js` stay unchanged.
- Keep `#theme-options`, `.theme-choice`, `[data-theme-choice]` and `#theme-save-status`, because other smokes use them.
- No transition with `prefers-reduced-motion: reduce` or `body.no-anim`.
- No inline `<svg>`: `styles.css` styles every svg as an icon.
- Other sessions are editing `index.html`, `themes.css` and `ui-smoke.js`. Make only targeted Edit-tool changes.
  Never rewrite those files.

## Review Focus
- Keyboard focus after applying a theme: rebuilding the list or disabling buttons must not drop focus to `<body>`.
  Test: after Enter, `document.activeElement` is the same `[data-theme-choice]`.
- Language switch while "Theme saved" is showing: the status must re-translate. Test: switch to TR and read
  "Tema kaydedildi".
- Preview colour drift from the real themes. Test: parity of the normalized variables, preview against `<html>`, for
  all five themes.
- Narrow card (640 px window): the list stacks above the preview and nothing scrolls sideways. Test: geometry check,
  and the existing `scrollWidth` check.
- Pointer leaves the list after hovering another theme: the preview returns to the active theme. Test: hover, then
  move away.

---

### Task 1: Preview variable scoping

**Files:**
- Modify: `public/themes.css`: the theme blocks at the `:root[data-theme="ocean"]` … `"light"` lines, and the
  `--gold` mapping line.
- Test: `tests/ui-smoke.js`, in the Appearance block after the `for (const theme of [...])` click loop.

**Interfaces:**
- Produces: `[data-preview-theme="<id>"]` on any element gives it that theme's variables (`--bg --bg-2 --panel
  --panel-end --workspace-chrome --field --text --muted --muted-2 --tq --tq-2 --tq-soft --tq-border --stroke
  --stroke-2 --ok --warn --danger --gold --gold-2 --gold-soft --gold-border --surface --surface-2`).

- [ ] **Step 1: Write the failing test.** In `page.evaluate`, create a probe div. For each of the five ids, set
  `html.dataset.theme = id`, and set `probe.dataset.previewTheme = id` on a div appended to `.app` under `html`.
  Normalize every variable above through `probe2.style.color = value` → `getComputedStyle(probe2).color`. Assert
  that the html and preview values are equal (`assert.deepEqual(mismatches, [])`), then restore the theme.
- [ ] **Step 2: Run `node tests/ui-smoke.js`.** Expected: FAIL. The mismatches list the non-Obsidian variables.
- [ ] **Step 3: Implement.** Add `[data-preview-theme] { …all variables above with the :root / Obsidian values from
  styles.css and themes.css line 1… }` before the theme blocks. Add `, [data-preview-theme="<id>"]` to each
  `:root[data-theme="<id>"]` selector. Add `[data-preview-theme]:not([data-preview-theme="obsidian"])` to the
  `--gold` mapping rule.
- [ ] **Step 4: Run `node tests/ui-smoke.js`.** Expected: parity passes. The run may still fail later, at Task 2's
  assertions, if those are already written.

### Task 2: List, preview, caption, keyboard and status

**Files:**
- Modify: `public/index.html`, the Themes article in `data-set-panel="appearance"`.
- Modify: `public/workspace.js`, lines 1–44 (strings, `themes`, `applyTheme`, click handler).
- Modify: `public/themes.css`, replacing the `.theme-grid` / `.theme-choice` / `.theme-swatch` rules.
- Test: `tests/ui-smoke.js`, in the same Appearance block.

**Interfaces:**
- Consumes: `[data-preview-theme]` from Task 1.
- Produces: markup `#theme-options` (list), `#theme-preview[data-preview-theme]` (skeleton), `#theme-caption`,
  `#theme-save-status`. Each choice is `button.theme-choice[data-theme-choice][aria-pressed][tabindex]` containing
  `.theme-dots`, `.theme-name strong`, `.theme-kind`, and `.theme-active` (on the selected choice only).

- [ ] **Step 1: Write the failing tests.** In EN, at 1440 px:
  - the names are `['Obsidian','Ocean','Forest','Amethyst','Light']`;
  - `.theme-kind` is `Dark` ×4 and `Light` for `light`;
  - exactly one `[aria-pressed="true"]`, with `.theme-active` = `Active` and `tabindex="0"`; all others have
    `tabindex="-1"`;
  - `#theme-preview` `data-preview-theme` equals the html theme;
  - hover `forest` → the preview is `forest`, `#theme-caption` contains `Dark green, easy on the eyes at night`, and
    the html theme is unchanged;
  - move the mouse to the card heading → the preview is back to the active theme;
  - focus the active choice and press `ArrowDown` → focus and preview move to the next id; `End` → `light`;
    `Home` → `obsidian`;
  - press `ArrowDown`, then `Enter` → wait for `Theme saved`, the html theme is that id, and `activeElement` is still
    that button;
  - `#theme-save-status` is empty within 6 s;
  - apply a theme, wait for `Theme saved`, click `#lang-toggle [data-lang="tr"]` → the status is `Tema kaydedildi`,
    the names start with `Obsidyen`, and the badge is `Aktif`; then switch back to EN;
  - reduced motion: with `emulateMedia({ reducedMotion: 'reduce' })`, the `.tp-card` `transitionDuration` is `0s`;
    with `no-preference` and `no-anim` removed, it is `> 0`.
  In the existing 640 px block, after Light is applied: `#theme-preview`'s top ≥ `#theme-options`' bottom.
- [ ] **Step 2: Run `node tests/ui-smoke.js`.** Expected: FAIL at the names or kind assertion.
- [ ] **Step 3: Implement the markup.** The article keeps its heading and hint. Under them:
  `<div class="theme-picker"><div class="theme-list" id="theme-options"></div><div class="theme-stage"><div
  class="theme-preview" id="theme-preview" aria-hidden="true"></div><div class="theme-caption"
  id="theme-caption"></div><p class="theme-status muted" id="theme-save-status" role="status"></p></div></div>`.
- [ ] **Step 4: Implement `workspace.js`.**
  - `themes` rows: `[id, trName, enName, kind, trDesc, enDesc]`, with the spec's copy. Kind is `'dark'` or `'light'`.
  - `renderChoices(active)` restores focus by id after it rebuilds. Use no `disabled`; `savingTheme` guards instead.
  - `renderPreview()` builds the skeleton (`.tp-bar`, `.tp-side`, `.tp-main`, three `.tp-card` tiles with meters,
    a `.tp-btn`). Its text is `I18N['nav.overview']` plus numbers only. It runs on init and on a language change.
  - `showPreview(id)` sets `data-preview-theme` and the caption: name, kind, description, and the note
    `Active theme` / `Etkin tema`, or `Preview · select to apply` / `Önizleme · uygulamak için seç`.
  - `setStatus(kind, message)`: `'saving'`, `'saved'` (cleared after 4000 ms) or `'error'`. It re-renders on
    `onLangChanged`.
  - Listeners on `#theme-options`:
    - `pointerover` and `focusin` → `showPreview(id)`;
    - `pointerleave`, and `focusout` with a `relatedTarget` outside the list → `showPreview(active)` (on pointer
      leave, only if focus is not inside the list);
    - `keydown` with ArrowUp/Left, ArrowDown/Right, Home and End → move focus (wrap), with `preventDefault`.
  - Keep the click flow: `lrx-base-theme-selected`, the optimistic `applyTheme`, `/api/config`, and revert on
    error.
  - The list's `aria-label` is `tr('Temalar', 'Themes')`.
- [ ] **Step 5: Implement the CSS.**
  - `.theme-picker`: a two-column grid (`minmax(220px,280px) minmax(0,1fr)`) with `container-type:inline-size` on
    its wrapper. Stack below 640 px of container width.
  - `.theme-choice` rows: dots, name and kind, Active badge. The selected row uses `--tq-soft` / `--tq-border`;
    `:focus-visible` uses a `--tq` outline.
  - The preview uses solid `var(--panel)` cards, so `background-color` transitions over 0.2 s. Add
    `@media (prefers-reduced-motion:reduce)` with `transition:none`.
- [ ] **Step 6: Run `node tests/ui-smoke.js`.** Expected: PASS (exit 0, `errors` empty).

### Task 3: Verification and TEST copy
- [ ] **Step 1:** Run `npm run check`, `npm test` and `npm run test:premium`. Expected: all pass.
- [ ] **Step 2:** Run `ui-smoke.js`, `overview-ui-smoke.js`, `premium-ui-smoke.js`, `feature-modules-ui-smoke.js`
  and `electron-smoke.js`, with `PLAYWRIGHT_MODULE` set. Expected: each exits 0.
- [ ] **Step 3:** Take screenshots in EN and TR for all five themes, at 1440 px and 640 px. Review them by eye.
- [ ] **Step 4:** Copy `public/index.html`, `public/workspace.js`, `public/themes.css` and the test files to
  `D:\Meric\TORN\LRX-Torn-Tracker-TEST\resources\app\…`, then run `cmp` on each. Expected: no output.
- No commit (the owner said not to commit yet).
