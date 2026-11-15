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

## Addendum 1 (2026-11-14): a shorter profile card, Edit in the header

The owner found the profile card too tall and the Edit row above the grid too wasteful.

- **Profile card sizes.** The profile has S, M and L (Premium members change them in edit mode, like every other widget's sizes); it is always 1 column and its size sets its height.
  - **S** (the default; old saved `P` entries become S): 2 rows, so in the default layout it ends with the Bars card.
  - **M**: the whole photo, as wide as the card and at its own shape (nothing cut off, no empty sides). At 4 columns the card fills its 3 rows, so it ends with Battle Stats beside it and nothing is left empty below it: the room under the photo holds profile details from the same overview reply (rank, job, faction and position, spouse, property, age, awards; lines Torn did not send are left out). The details only take the room the photo leaves and show whole lines only; on a wide card the last lines are left out. At 2 columns it is 3 rows like the other sizes, without the details.
  - **L**: 3 rows, the earlier tall card.
  - At 2 columns every size is 3 rows, which fills the space beside the three timers and leaves no hole before Bars. At 1 column the card is as tall as its content (the photo beside the name).
  - The small player card that sat at the bottom of the sidebar (`#me-chip`) is gone: the profile card shows the same and more.
- **Edit and the layout picker.** They sit in the page header beside Refresh (`#ow-head`), and only on the Overview. Outside edit mode there is no toolbar row above the grid.
- **Edit mode.** The edit tools (name, Duplicate, Delete, Reset to default, Add widget, Done) get their own row above the grid (`#ow-bar`) only while editing.

## Addendum 2 (2026-11-14): the live timer strip

**Intent.** The owner wants the three timer cards (Xanax/drug cooldown, education, day reset) to feel live, combined into one card, with a nicer look. The countdowns already tick every second from the local clock and the overview already refreshes every 30 s while the tracker is visible; what is missing is a look that says so.

**Approaches.** (A) one combined strip with a live header and a draining bar per timer; (B) the three cards kept, with live rings; (C) a 24-hour timeline. The owner picked A. B keeps the cards apart (not combined); C cannot fit multi-day education on a 24-hour line and makes exact times hard to read.

**Design.**
- **A new free widget, `timers` ("Live timers" / "Canlı sayaçlar")**, sizes L (3 columns, the default) and W (4 columns). It holds three segments side by side, each with its icon and label, the countdown, the line under it (ends at, course, local time) and a thin bar that drains every second: drug against the usual maximum (as the ring does), education against the course length, day reset against 24 hours. A finished timer reads READY / IDLE like today and its bar is full in the accent colour.
- **The live header.** A pulsing dot with LIVE / CANLI on the left; on the right "updated 12 s ago". The label is honest: when the last overview is older than 90 s (three refreshes missed) the dot turns amber, the label reads DELAYED / GECİKMELİ and the right side says how old the data is.
- **Same data, no new request.** Everything comes from the overview the app already fetches and the local clock. The pulse and the bar movement follow the existing Animations switch and the system's reduced-motion setting.
- **Default layout:** the strip replaces the three timer cards (`profile, timers, bars, chips, battle, company`). The three separate cards stay in the Add widget list. The classic screen (layout switch off) is unchanged.
- **Saved layouts move to the strip once (owner's call to confirm):** a saved set from before this change (v 1) that has all three timer cards gets them replaced by one strip (size L) where the first of them was; the set is saved as v 2 and never changed again, so putting the three cards back later sticks.
- **Narrow widths.** At 2 columns the strip is 1 column and 3 rows with its segments stacked, so it sits beside the profile exactly where the three cards were. At 1 column it is full width; its segments stack whenever the strip is too narrow for three.
- **On/off.** Like every widget, Edit removes it; the classic switch brings back the fixed screen.
