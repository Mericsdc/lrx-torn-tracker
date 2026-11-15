# Premium page redesign: "Seal / editorial" — design

Date: 2026-11-15 · Status: draft for owner approval

## Intent

The owner: "Redesign the Premium page from scratch. Its UI doesn't feel premium; overall it should feel premium."

Today the page is a stack of identical dark boxes: a plain membership card (a non-member sees only "—"), a thin
stats row, four plan boxes whose arrows look clickable but aren't, six identical module rows that fill half the
page, then the payment table and privacy box. Nothing feels special.

Success: opening the Premium page feels like opening a luxury membership brochure, in the app's black and gold,
while everything that works today still works.

## Approaches considered

Three directions were mocked inside the running app (member, 30 days left, 1440 px):

- **A. Black card**: a metal membership card (chip, embossed name, "valid thru"), a 3×2 module gallery, plan cards
  with a 3-step "how to pay" strip. Strong and functional, closest to a dashboard.
- **B. Seal / editorial**: centred, box-less; a gold ring "seal" with the remaining days in serif; hairline gold
  dividers; modules as a numbered I–VI list; plans as four serif columns. The most "luxury brochure".
- **C. Bento**: a dense grid of tiles (days ring, expiry, Xanax, a plan calculator) and module tiles. The most
  practical, the least premium.

**The owner picked B.**

## Goals

- A centred hero whose seal shows the membership state at a glance, for every state.
- The six Premium tools presented as a curated, numbered collection.
- Plans that read as a price list, with the receiver and the copy-ID action right under them.
- Calm, tasteful motion on arrival only.
- English (default) and Turkish; 1440 down to 640 px wide; all five app themes.

## Non-goals

- No change to Premium logic, the service, pricing, gating or what data is shown or sent.
- No change to `feature-access.js` markup (`.fx-entry`, `[data-advanced-open]`), the module workbenches
  (`advanced-modules.js`) or the shared profile-card component (`profile-card.js`).
- No new Torn or service requests.

## Anti-goals (a failure even if it "works")

- Any existing action, state or gate stops working or disappears.
- The page animates again on each 15-second auto-refresh, or animates with Animations off / reduced motion.
- The Overview's profile widget (which reuses `.pm-profile` styles from `premium.css`) changes.
- Sideways scrolling at any width; text that only reads well in one theme.

## Constraints

- Files: `public/premium.js`, `public/premium.css`, `tests/premium-ui-smoke.js`. Shared files (`app.js`,
  `index.html`, `styles.css`, `themes.css`) are not touched. Other sessions are editing those.
- Every new text is a `tr(TR, EN)` pair.
- `styles.css` makes every `<svg>` a 17 px stroked icon: each new SVG sets its own size, fill and stroke.
- `.pm-profile*` base rules stay as they are; Premium-page variations are scoped to `#view-premium`.
- Theme accent stays on `--pm-accent/--pm-soft/--pm-border` (gold on Obsidian, `--tq` on Ocean/Forest/Amethyst,
  dark gold on Light), so the page follows all five themes.

## The design

### Hero (centred, no box)

Top to bottom, centred, over a soft radial glow in the theme accent:

1. **Eyebrow**: `LRX PREMIUM · MEMBER` / `· LIFETIME` / `· EXPIRED`, or just `LRX PREMIUM` for a non-member,
   plus the existing "Test workspace" badge in test mode.
2. **Seal**: a 236 px SVG ring (smaller on narrow screens).
   - The track is a faint full circle, with a fine dotted outer ring.
   - The gold arc is a 30-day gauge: `min(remainingDays, 30) / 30`. *(Builder's call: `startedAt` is the start of
     an unbroken membership, so "share of the period" would leave long-time members with a nearly empty ring.)*
     A full ring means a month or more is left, and it empties over the last 30 days, which is a natural
     "time to renew" cue.
   - Lifetime: a full ring with a soft glow. Non-member and expired: track only.
   - Inside the ring: a crown, then a serif number (days left, `∞`, `0` when expired, a crown-only seal for a
     non-member), then a letter-spaced label: DAYS REMAINING · LIFETIME ACCESS · MEMBERSHIP EXPIRED · NOT ACTIVE.
   - **Status unknown** (configured but not connected: the service is unreachable or connecting, the session is
     renewing, or there is no key; the snapshot has no `subscription`/`account`). *(Builder's call.)*
     - Track only, a crown, `—`, the label MEMBERSHIP STATUS, and the neutral member headline.
     - The ledger reads `—`, and there is no primary button.
     - The existing connection-status line (`role="status"`, today printed above privacy) moves under the holder
       line, so a paying member never sees "Not active" during an outage.
3. **Headline** in serif:
   - Member: "Your membership. *Elevated.*"
   - Lifetime: "Your membership. *Always yours.*"
   - Non-member and expired: "{n} advanced tools. *One membership.*", where n is the catalog count.
4. **Holder**: when the viewer's own Torn profile is known (same rule as today, `app.premiumProfile`), the
   existing profile card is shown here, restyled by scoped CSS into a compact horizontal plate: round photo with
   a gold ring, name `[id]`, level · status · faction tag. It is still clickable and opens the Torn profile.
   Otherwise a plain text line shows the name `[id]`, or "Membership updates automatically" if there is no account.
5. **Ledger**: three centred facts separated by hairlines. These are today's stats row:
   - Membership: Premium / Lifetime Premium / Standard.
   - Expires: a date, or "Never expires".
   - Total Xanax, or "Total Xanax received" for the owner.
6. **Actions**:
   - A gold primary button that scrolls smoothly to the plans: "Extend membership" for a member, "Renew
     membership" when expired, "See plans" for a non-member. Lifetime members get no primary button.
   - The existing "Refresh" ghost button.

### Admin tabs

Only when there is more than one tab (owner/admins), as a centred pill segmented control under the hero. A regular
member no longer sees a lone "My membership" tab.

### The collection (modules)

- A divider labelled THE COLLECTION, then a serif title: "Six advanced tools, included" for a member, "Six
  advanced tools" plus a short "Unlocked with Premium" line otherwise.
- The existing `[data-feature-slot]` hosts sit in a two-column list. Scoped CSS turns each `.fx-entry` into a
  numbered row: a serif roman numeral from a CSS counter, the title, the description, the status line and the
  button as a gold text link ("Open ↗", or a muted "Details ↗" when locked).
- The ◇ mark and the "Premium" badge are hidden on this page only.
- An open workbench (`[data-feature-open]`) spans both columns.

### Plans

- A divider labelled EXTEND, then a serif title "Add time with Xanax".
- Four columns separated by hairlines. Each shows a small label, a large serif number of days, then
  "days · N Xanax".
- Labels: the last paid plan is "YOUR PLAN". Otherwise the 30-day card is "RECOMMENDED". Today's selection logic
  stays the same.
- The featured column has a gold numeral and a glowing underline.
- Under each number, a quiet line "until 14 Jan 2027". It adds the plan's days to the current expiry for an
  active member, or to now otherwise. Lifetime members get no line.
- Under the columns, centred: "Send to **Ezlira [4037017]**" with the existing "Copy ID" button, then the existing
  explanation and fine print.
- The plan columns are not buttons, and nothing on them suggests a click.

### Account (payment history), privacy, footer

- A divider labelled ACCOUNT, then "Your payment history" with "Download CSV", shown only when connected as today.
  The table becomes a box-less hairline ledger.
- Privacy keeps the same `<details>` with the same content and actions, restyled as a hairline row.
- The service line (last check, mode) becomes a small centred footer.

### Other states

- Connection off / not configured: the same copy and buttons, laid out as a centred seal emblem with a muted
  ring and a serif headline.
- Loading: as today.
- The admin tabs (Members, Payments, Test lab, Settings) keep their markup. Surfaces get finer borders and serif
  section titles, so they match.

### Motion

- On the first paint after the Premium view is shown, or after the identity changes, but never on auto-refresh
  re-renders:
  - the seal arc draws in (~1.2 s);
  - the number and headline fade up;
  - the sections fade up in a short stagger.
- Hover: the collection numeral brightens, and plan columns lift their numeral slightly.
- Everything is off with `body.no-anim` (the global rule) and under `prefers-reduced-motion: reduce`. The
  smooth scroll to the plans is instant under either.

### Narrow widths

- ≤ 760 px: the collection becomes one column, the plans a 2×2 grid, the ledger stacks, and the seal is 190 px.
- ≤ 520 px: smaller headline.
- No sideways scrolling at 640 px (asserted today).

## Tests (written first, in `tests/premium-ui-smoke.js`)

Existing assertions move to the new selectors, and these are added:

- **Hero**: the seal shows `∞` for the lifetime owner and `30` for the member, with an arc that is full for 30 days
  and half for 15 (the arc ratio is a small pure function, tested directly). An unreachable service shows `—` and
  MEMBERSHIP STATUS, never "Not active". A non-member sees "Not active" and a "See plans" button that brings `#pm-plans`
  into view. "Extend membership" for a member.
- **Lone tab hidden**: a regular member sees no `[data-premium-tab]`; the owner still does.
- **Collection**: six numbered rows; locked rows for the non-member (the `fx-entry.is-locked` count stays in the
  feature-modules smoke); an opened workbench spans the full width.
- **Plans**: the "until" date line for a member; the `.pm-plan` / `.featured` / `data-plan` /
  `.pm-plan-label` assertions stay.
- **Motion**: a re-render by auto-refresh does not carry the entrance class; with `no-anim` the computed
  `animation-name` is `none`.
- **Kept**: the five themes give five different hero backgrounds; 640 px has no overflow; TR/EN; the profile
  plate shows only the viewer's own profile, as text, and the setting turns it off.

## Left to the builder

Exact spacing, font sizes and colour stops; the SVG icon for the crown; the numeral style; how the seal sizes
between breakpoints; the exact entrance timings within the limits above.
