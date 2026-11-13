# Customisable Overview with widgets

Status: approved by the owner (2026-11-13), including the builder's calls after the design review

## Intent

Today the Overview is a fixed screen: three timers, a bars card with status chips, a battle-stats card and, in company mode, a company row. The owner wants every player to put on their home screen what they actually want to see, add a Torn profile card like Torn's own profile page, and fill the rest with widgets from the app's other pages.

Basic customisation is free. Premium unlocks the extra widgets and more layout control, which gives Premium a visible, everyday benefit.

## Decided by the owner

- **Who gets what (mixed model).**
  - **Free:** move, hide and re-add the current Overview cards and the profile card. Sizes are fixed and there is one layout.
  - **Premium:** widgets from other pages, an S/M/L size per widget, and several saved layouts with a switcher.
- **How editing works: drag and drop on the screen itself.**
  - An **Edit** button turns every widget's frame dashed.
  - A widget is moved by dragging and removed with ×.
  - **+ Add widget** opens a side list grouped "Free" / "Premium 👑".
  - **Done** saves.
  - In the mockup the owner picked, Premium widgets show S/M/L size chips while editing.
- **The widget catalogue: all 19 widgets.**

| # | Widget | Tier | Data (already in the app) |
| --- | --- | --- | --- |
| 1 | Profile card: photo, name [ID], level, status, faction; opens the Torn profile | Free | `state.overview.player` |
| 2 | Xanax / drug timer | Free | overview |
| 3 | Education timer | Free | overview |
| 4 | Day reset (18:00 TCT) | Free | clock |
| 5 | Bars: energy, nerve, happy, life, with full-in times and the status chip | Free | overview |
| 6 | Status chips: Xanax today and total, refills, booster and medical CD, chain, bank, travel | Free | overview |
| 7 | Battle stats: base, without Xanax, with Xanax, stat table | Free | overview |
| 8 | Company summary (company mode only) | Free | `state.company` |
| 9 | Gym gains: last 24 h per stat | Premium | `GET /api/stats`, local history, no Torn call |
| 10 | Networth: total and change today | Premium | `GET /api/networth` |
| 11 | Travel profit: best item, country, $/hour | Premium | `GET /api/travel` |
| 12 | Job assistant: job points, positions that fit | Premium | `GET /api/job` |
| 13 | Crime hub: shoplifting security alerts, best money per nerve | Premium | `GET /api/shoplifting`, `GET /api/crime-value` |
| 14 | Jail busts: last 24 h and 72 h, estimated penalty | Premium | `GET /api/jail` |
| 15 | Merit tracker: closest missing honor or medal | Premium | `GET /api/awards` |
| 16 | Faction OC: next OC, readiness | Premium | `GET /api/faction` (the `myOc`/`oc` parts) |
| 17 | War: ranked war score, number of suitable targets | Premium | `GET /api/wars`; the targets count only if already loaded |
| 18 | Event calendar: next event countdown | Premium | `GET /api/events` |
| 19 | Company stock / report: lowest days left, order hint | Premium | `state.company`, already polled in company mode |

## Behaviour (proposed by the builder, accepted with the catalogue)

- **Default layout.**
  - Today's Overview, with the tall profile card on its left.
  - Existing users see this layout after the update, so nobody loses a card.
  - **Reset to default** restores it at any time.
- **Free user.**
  - Moves and hides the free widgets and re-adds hidden ones from the side list.
  - Premium widgets appear in the list with a lock and a short "Premium" note. They cannot be added.
- **Premium member.**
  - Adds Premium widgets and picks S/M/L where a widget supports it.
  - Keeps up to **5 named layouts** (for example "Daily" or "War"), switched from a menu at the top of the Overview. The member can rename, duplicate and delete layouts; the last one cannot be deleted.
- **When Premium ends.**
  - Nothing is deleted. The first layout becomes active.
  - Premium widgets in it show as locked tiles reading "Premium ile açılır" / "Unlocks with Premium", and they can be removed.
  - The S/M/L choices are kept but drawn at the widget's default size.
  - Renewing restores everything.
- **Refresh and Torn rules.**
  - Premium widgets fetch data only while the Overview is the visible view and the tracker is not covered by a Torn tab, using the same check as today's polling.
  - Each widget fetches at most once a minute. It uses the existing endpoint, so the server's existing caches (30 s–1 h) apply.
  - The widgets only display data: no clicks in Torn and no new kind of Torn request. They make the same requests that opening those pages already makes.
  - A widget whose page is switched off in Settings (for example `page.networth`) shows a short "turned off in Settings" note instead of fetching.
- **Errors.**
  - A failing widget shows a one-line error inside its own frame. The other widgets keep working.
  - A saved layout that cannot be read falls back to the default and is never shown blank.
- **Narrow windows.**
  - The grid has 4 columns at wide sizes, 2 columns from about 640 px, and 1 column below that.
  - Order is kept; sizes are capped to the available columns. There is never sideways scrolling.
- **Keyboard.**
  - In edit mode each widget's drag handle is a button.
  - Arrow keys move the widget earlier or later, and Delete removes it.
- **Setting.**
  - New switch `app.overviewLayout` in group `app`, on by default, in `features.js` and `feature-catalog.js`.
  - TR: "Genel Bakış düzeni" – "Genel Bakış'ı widget'larla düzenle; kapalıyken klasik sabit ekran".
  - EN: "Overview layout" – "Arrange the Overview with widgets; off shows the classic fixed screen".
- **Premium module.**
  - A new catalogue entry `overview_widgets` with `tier: 'premium'` and `module: 'overview'`.
  - Title: "Genel Bakış widget'ları" / "Overview widgets".
  - Description: "Diğer sayfalardan widget'lar, S/M/L boyut ve kayıtlı düzenler." / "Widgets from other pages, S/M/L sizes and saved layouts."
  - The Premium service decides access, exactly as for the other Premium modules. Its card on the Premium page opens the Overview in edit mode.

## Builder's calls after the design review (for the owner to check)

1. **"Premium ended" means the service says so. "Unknown" is a different state.**
   - Premium tiles lock only when the Premium snapshot is connected and reports the subscription as not active (`expired` or `inactive`).
   - Access counts as unknown in four cases, which are not a lapse:
     - the first seconds after launch;
     - a stale 60 s grant after the window was hidden;
     - a service outage;
     - `app.premium` switched off.
   - While access is unknown:
     - the layout and the S/M/L choices stay as saved;
     - Premium widgets show a quiet "checking membership…" placeholder and make no request.
   - The fallback to the first layout after a lapse is display only. It is never written back, so the member's chosen layout returns on renewal.
2. **Premium members can resize every widget that has more than one size, the free ones included** (for example battle stats M/L, bars M/L).
   - Free users always see each widget's default size.
3. **Layouts are stored per Torn player ID**, inside the app config.
   - Another account on the same computer starts from the default layout and never sees or edits a member's layouts.
4. **The company cards.**
   - Today's three company cards (income, stock/order timers, addiction/rehab) stay together in the free "Company summary" widget (L, full width), so nothing is lost.
   - Premium #19 becomes **"Daily order hint"**: what sold and what to order today. It does not repeat the stock timers.
     - It is rendered from `state.company`, the data the Daily Report page already uses and the app already polls in company mode, so it makes no request.
     - It must never call `POST /api/stock-order`, because that request changes the delivery settings.
5. **When `app.premiumPromos` or `app.premium` is off:**
   - the "Premium 👑" group is hidden from the add list;
   - a Premium widget already in a layout shows a plain "not available" tile, with no sales text and no link.

## Goals

- Every player can shape the Overview, and the free tier stays at least as useful as today's screen.
- Premium members get the 11 page widgets, sizes and saved layouts.
- The profile card on the Overview and the one on the Premium page are the same component.

## Non-goals

- No sync between computers. Layouts live in this app's config on this computer.
- No user-made widgets, no free positioning (it is an ordered grid, not pixel placement), and no new data sources or Torn selections.
- No change to the pages the widgets summarise.

## Anti-goals

- Opening the Overview gets slower, or a widget blocks the first paint of the free cards.
- Widgets fetch while the app is hidden or a Torn tab covers the tracker, or more often than once a minute.
- After the update a player is missing a card they had before.
- A corrupt or old saved layout leaves the Overview empty or broken.
- A widget's error or Torn data breaks out of its frame: unescaped markup, layout overflow.
- Free users can use Premium widgets by editing the saved layout.

## Constraints

- Strict page CSP: no inline scripts or handlers, no third-party grid library. Style attributes are fine.
- Every visible text has TR and EN; English is the default.
- The existing Overview render code (`renderOverview`, `tick`, `renderOverviewCompany`, `syncCompanyMode`) writes to fixed element IDs: `#t-drug`, `#t-edu`, `#t-day`, `[data-timer]`, `#bars`, `#mini-row`, `#status-chip`, `#xan-chip`, `#bs-totals`, `#bs-table` and `#ov-company`.
  - Those elements must exist whether or not their widget is shown. Hidden widgets stay in the DOM but are not displayed.
  - Today's bars card is split into "Bars" (`#bars` and `#status-chip`) and "Status chips" (`#mini-row`).
- `tests/ui-smoke.js` and `tests/electron-smoke.js` use those IDs and must keep passing unchanged, or be updated only where the split card moved an element.
- The Premium catalogue (`public/feature-catalog.js`) is shared with the Premium service. A new Premium module goes live only after the service is redeployed. Until then the Premium widgets show as locked for everyone, which is safe.
- The advanced-modules workbench on the Premium page must handle the new module: its **Open** action goes to the Overview edit mode instead of a workbench.

## Approaches

1. **Our own widget grid (chosen by the owner).**
   - The Overview becomes a host that lays out widget modules. Each module has an id, a tier, its allowed sizes, a default size and a render function.
   - The current cards are moved into modules. Drag and drop is our own code on a CSS grid.
   - There is no dependency and we keep full control over themes and the CSP.
   - It costs the most refactoring.
2. **Patching the current screen** (show/hide and reorder only). Rejected: bars and chips cannot be separated, and sizes and saved layouts would be awkward.
3. **A grid library such as GridStack.** Rejected: about 100 KB more to maintain and theme, for a simple fixed-column grid.

## Left to the builder

- File split, as long as the following are separate units:
  - a pure layout module (UMD like `travel-math.js`): default layout, validation of a saved layout, move/remove/add/resize and tier enforcement;
  - the widget host and edit UI;
  - the widget definitions;
  - a shared profile-card renderer.
- **Exact grid metrics.** Proposed starting point:
  - row height about 110 px;
  - S = 1×1, M = 2×1, L = 2×2;
  - the profile card is 1 column × 3 rows;
  - timers are S;
  - bars, chips and company are M;
  - battle stats is M or L.
- **Storage.** In the app config through a small endpoint, the same way features are saved. The server validates and caps the saved data (for example 5 layouts × 40 widgets).
- The drag feedback and animation (respecting the Animations setting and reduced motion) and the exact text of each widget, within the colours and style of the app's themes.
- **Tests.**
  - Vitest tests for the layout module: defaults, a corrupt layout, unknown or duplicate ids, Premium widgets locked for free users, size limits and moving.
  - Playwright UI checks: edit mode, drag and keyboard moves, remove and add, persistence after reload, locked tiles for a free user, the five themes, and widths of 1440, 1100, 760 and 640 px with no overflow or CSP errors.
  - The existing UI and Electron smokes stay green.

## Shipping

- The app ships in a release the owner chooses: v1.6.14 must go out before 20 December. If this is not ready by then, 1.6.14 ships without it.
- The Premium service is redeployed with the new catalogue entry, only when the owner asks.
