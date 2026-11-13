# Premium page: your plan, total received, quieter history, profile card

Status: approved by the owner (2026-11-13)

## Intent

The owner looked at the Premium page as a member would and asked for four changes. The goal is for the page to speak about the person viewing it:

- the plan they actually paid for;
- the Xanax the owner has received;
- no technical noise in a member's payment history;
- their own Torn profile next to their membership card.

## Decided by the owner

1. **Plan cards.** The card that matches what the member paid lights up. Members who have not paid see the 30-day card highlighted as before.
2. **Total Xanax.** The owner sees the total Xanax received from all members so far, from the Premium service.
3. **Payment history.** Members still see the date of each payment. The long transaction ID under it is removed for them.
4. **Profile card.** The member's Torn profile sits right next to the membership card.

## Builder's calls (stated to the owner with the design)

- **Which payment sets the plan.**
  - The most recent payment with status `applied` decides.
  - Quantities 1, 2, 4 and 10 Xanax map to the four cards. That card gets the highlight and the label "SON PLANINIZ" / "YOUR PLAN".
  - No payment, or an amount without a card (for example 3 Xanax), keeps today's 30-day highlight and label.
- **Total received.**
  - `service.me(actor)` returns `receivedTotal` only for admins. It is the sum of `premium_payment_balances.total_received`, which counts verified Xanax received from every sender.
  - For admins, the stat reads "Toplam alınan Xanax" / "Total Xanax received". Members keep seeing their own paid total under "Toplam Xanax" / "Total Xanax".
  - Until the service is deployed, an app without `receivedTotal` falls back to today's value.
- **Transaction ID.**
  - Hidden only in the member view (`paymentTable(rows, false)`). The admin Payments tab keeps it, because it is used to match Torn logs.
  - The member CSV export is unchanged.
- **Profile card content.**
  - Photo, name [ID], level, status and faction tag. All of it comes from `state.overview.player`, which the app already fetches, so no new Torn request is made.
  - The card shows only when that player's ID equals the Premium account's Torn ID.
  - The photo is used only when its URL is `https:`. It is drawn with an `<img>`; the page CSP already allows `img-src https:`.
  - No FairFight value: a player's FF against themselves means nothing.
  - Clicking the card opens the Torn profile in a tab, the same way the sidebar name chip does.
- **Profile card setting.**
  - New switch `app.premiumProfile` in group `app`, on by default, registered in `features.js` and `feature-catalog.js`.
  - TR: "Premium profil kartı" – "Premium sayfasında üyelik kartının yanında Torn profilin".
  - EN: "Premium profile card" – "Your Torn profile next to the membership card on the Premium page".
- **Layout.**
  - The hero's right column holds the profile card and the membership card side by side.
  - Narrow widths stack them, following the existing 1100 px and 760 px breakpoints.
- **Live update.** `renderOverview()` calls a `window.onOverviewRendered` hook. The Premium page then updates only the profile slot, so open forms are never re-rendered.

## Non-goals

- No change to prices, plan quantities, payment processing or the CSV.
- No other Torn request, and no profile of anyone other than the viewer.
- The Overview widget dashboard is a separate project with its own design.

## Anti-goals

- A member sees another player's profile or totals.
- A failed or missing profile image breaks the layout.
- Markup from Torn data (name, faction, image URL) is ever inserted unescaped.

## Approaches

1. **Small edits in `premium.js` plus one service field (chosen).** It is the smallest change, and the page already holds every other piece of data.
2. **A client-side sum of `admin.transactions`.** Dropped: that list stops at 200 rows and loads only with the admin tabs.
3. **A separate profile request to Torn for the card.** Dropped: it is an extra Torn request, and the overview already has the data.

## Tests

- **Service (node:test):**
  - an admin's `me()` carries `receivedTotal` equal to the sum of every member's verified Xanax;
  - a member's `me()` has no `receivedTotal`.
- **Premium UI smoke (Playwright):**
  - the member's history has no `.pm-event-id`, while the admin Payments tab still shows the event ID;
  - after a 4-Xanax payment the 60-day card is highlighted with "YOUR PLAN";
  - the admin stat shows the total received;
  - the profile card appears for a matching overview player, and stays hidden for a different player and when the setting is off;
  - a non-https image is never used.

## Shipping

- The app changes ship in v1.6.14.
- The service change goes out with the usual Premium deploy (user systemd unit, no sudo), only when the owner asks.
