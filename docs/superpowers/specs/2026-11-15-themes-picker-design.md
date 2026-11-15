# Themes picker — short design (2026-11-15)

Status: approved by the owner on 2026-11-15 ("Yes, build it"), without "Match system".

## Intent
The owner said the Themes section "looks too basic" and should look more professional. Settings → Appearance →
Themes is the free theme picker: five themes (Obsidian, Ocean, Forest, Amethyst, Light). Today it shows five flat
buttons, each with a coloured box holding three lines and a name. That box does not show what the app will look like.
The selected theme is marked only by an outline and a small ✓, and the Obsidian swatch blends into its own card.
The "Theme saved" line stays under the grid for good and is not translated when the language changes.

## Goals
- A picker that shows what the app will look like in each theme before the user commits to it.
- Clear current-theme state, a short description per theme and a Dark/Light label.
- Keyboard friendly: arrow keys move between themes.
- English by default, Turkish with `tr()`.

## Non-goals and anti-goals
- No accent, density, radius or custom-palette controls. Premium's Appearance studio sells those, and giving them
  away for free would undercut it.
- No new themes and no changes to the five themes' colours.
- Saved theme choices (`config.theme`, `localStorage` `tt.theme`), the server's theme list and the Premium appearance
  behaviour stay as they are.
- "Match system" (follow the Windows light/dark setting) is not included. It would need the server, `theme-init.js`
  and a feature toggle. It can come later if the owner wants it.

## Approaches
- **B — list and a large live preview (the owner chose this on 2026-11-15).** A list of themes on the left and one
  large preview of the app on the right. Hovering over or focusing a theme previews it; clicking applies and saves it.
- A — a gallery of mini app previews, one card per theme. All themes are visible at once, but each preview is small.

## Design (B)
Same card ("Themes" heading and hint), two columns inside it. Below about 640 px of card width, the list stacks above
the preview.

1. **Theme list** (`#theme-options`, still made of `button.theme-choice[data-theme-choice]`, so existing tests and
   hooks keep working). Each row has three colour dots (background, panel, accent), the name, a Dark/Light label and,
   on the current theme, an "Active" badge and accent border. Roving tabindex: arrow keys, Home and End move focus;
   Enter, Space or a click apply the theme.
2. **Large preview.** A small replica of the app drawn with divs: a workspace bar with tabs, a sidebar with the brand
   line and nav items (one active), a page title, three stat tiles, a progress bar and a primary button. Its colours
   come from the real theme variables. The theme blocks in `themes.css` also match `[data-preview-theme="…"]`, plus a
   scoped Obsidian block, so there is one source of truth. A test checks that the preview's variables equal the
   page's variables for every theme.
3. **Caption under the preview.** Theme name, a one-line description, Dark/Light, and the save status (`role=status`).
   "Saving…" changes to "Theme saved", which clears after a few seconds and is re-translated when the language
   changes.
4. **Preview follows hover and focus.** When the pointer leaves the list or focus leaves it, the preview returns to
   the active theme. Colour changes cross-fade in 0.2 s. There is no transition with `prefers-reduced-motion` or
   `body.no-anim`.
5. The picker shows the preview under Premium appearance too. Clicking a theme keeps today's behaviour: it fires
   `lrx-base-theme-selected` and saves through `/api/config`.

Descriptions (EN / TR):
- Obsidian: "Graphite and gold, the original look" / "Grafit ve altın; uygulamanın özgün görünümü"
- Ocean: "Deep navy with sky-blue highlights" / "Gece mavisi üzerinde gök mavisi vurgular"
- Forest: "Dark green, easy on the eyes at night" / "Koyu yeşil; gece kullanımında göz yormaz"
- Amethyst: "Plum with soft violet accents" / "Mürdüm tonları ve yumuşak mor vurgular"
- Light: "Bright and clean for daytime use" / "Gündüz kullanımı için aydınlık ve sade"

## Files
`public/workspace.js` (picker logic and strings), `public/themes.css` (picker styles and preview scoping), and
`public/index.html` (the card markup, about five lines). Tests go in `tests/ui-smoke.js` (behaviour, Turkish,
keyboard, narrow width) and `tests/feature-modules-ui-smoke.js`, which still expects five `.theme-choice` buttons.

## Left to the builder
The exact preview proportions and spacing, the Active badge styling, and the cross-fade details.
