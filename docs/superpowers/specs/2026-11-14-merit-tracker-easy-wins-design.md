# Merit Tracker: easy wins and how-to lines (design)

Date: 2026-11-14. Approved by the owner (approach A). Not committed (owner's rule).

## Why
The owner: "Only with progress" is pointless, the page does not show which awards are easy to get now, and it does not
say what to do to get them.

What the live data showed (owner's account, TEST copy): 450 missing awards, 311 with a number, 88 of them at 0 %.
The checkbox hides only the 139 one-time awards, so it barely filters. The order is "highest % first", so long grinds
(Master rank 94 %, level 45 93 %, marriage days) sit on top while real quick ones ("171 more Theft offenses",
"8 more SMG finishing hits") get lost, and popular one-time honors (Protege, 275k holders) are always at the bottom.
No row shows the remaining amount or where in Torn the work is done.

## Goals
- An "Easy wins" card on top: closest to done (countable actions), comes with time (days left), one-time honors most
  players have.
- Every row has a "how" line: what to do, how many more, and where in Torn (with a link where the app already knows the
  page URL). TR/EN, English by default.
- Replace "Only with progress" with a "Show" selector over meaningful groups; an empty list always says why.
- Higher tiers of the same series (level 50, 55, 60 … when 45 is next) are hidden by default, with a count and a switch.

## Non-goals / anti-goals
- No new Torn requests; the page still uses the one `/api/awards` call.
- No strategy tips that are not verified. How-lines name the action, the remaining number and the place only.
- The Overview "Merit tracker" tile keeps its current logic (follow-up).
- LRX never clicks or submits on Torn; links only open the Torn page.

## Approaches considered
- **A (picked):** classify each missing award into a group from what the server already knows (which personal stat the
  rule reads), rank inside each group, add how-lines. No history needed, works on first open.
- B: A plus pace tracking (daily progress snapshots, "~3 days at your pace"). More accurate, but empty for the first
  days and touches the server history file. Possible later.
- C: hide 0 % rows and show the remaining number. Cheap, but does not answer "how".

## Design
Server (`src/server/server.js`, `getAwards`/`awardProgress`): each measurable award also gets `stat` (the personal stat
id the rule reads, e.g. `crimes.offenses.theft`; `a|b` when it reads several; `level`, `rank`, `age`, `married`,
`faction`, `education` for profile-based rules) and `what` (the rule's text capture, e.g. `Theft`, `SMGs`, `Japan`).

Client module `public/merit-guide.js` (`LRXMerit`, pure, unit-tested):
- groups: `count` (actions with a counter), `time` (age, marriage, faction days, donator days, login streak, activity
  hours, "Login on <date>"), `once` (one-time, no counter), `record` (single best: kill streak, best hit, largest mug),
  `long` (level, rank, battle/working stats, networth, skills, course totals, total awards, education bachelors),
  `event` (competitions, Token Shop / Points Building).
- `guide(award)`: group, how-line pair, place (label + URL), days left for time awards. Secret honors ("Who knows?")
  say Torn does not tell how.
- series: same `stat` (+ `what`); only the lowest missing goal is "next", the rest are higher tiers.
- order: group order count → time → once → record → long → event; count/record/long by % desc, time by days asc,
  once/event by holders desc.
- `easyWins`: top 5 count (by %), top 3 time (days ≤ 60), top 4 once (not secret).
- `view(opts)`: rows + hidden tier count + empty reason (with "Clear filters" when kind/type/search narrowed it).

Page (`public/extras.js` Merit section, `public/styles.css` `.aw-*`): KPI "With progress" → "Almost done (75 %+)";
Easy wins card; list with Show / Honors-Medals / type / search / "Higher tiers" controls; rows with how-line and place
link. Light theme works through CSS variables (themes.css belongs to the Themes session and is not touched).

## Tests
- `tests/awards.test.js` (node): `/api/awards` with synthetic Torn replies returns `stat`/`what`.
- `tests/unit/merit-guide.test.mjs` (vitest): groups, how-lines (TR/EN pairs with numbers), series, order, easy wins,
  empty reasons.
- `tests/awards-ui-smoke.js` (Playwright, synthetic data, no Torn requests): card, filters, empty states, TR/EN,
  1440/640 px with no sideways scroll.

## Left to the builder
Exact wording, CSS details, which Torn URLs to link (only ones the app already uses or that are standard pages).

## Addendum (same day): Overview tile and translations
- The Overview "Merit tracker" tile uses `easyWins`. It shows the closest counter, then the soonest time award, then the
  most-held one-time award, each with its how-line. Long grinds never lead.
- The owner flagged a Turkish line with Torn's English text inside it ("Bir kez yap: Complete the mission …"). The rule
  now is that a Turkish line never carries an English sentence:
  - Torn's texts without a counter have Turkish lines in `public/merit-desc-tr.js`, keyed by Torn's text without extra
    spaces or a final period. A text not listed there shows as a quote: `Torn'un açıklaması: “…”`.
  - Captured words get Turkish forms: countries in the dative, weapon classes in the instrumental, crime types and stats
    with the English in brackets. Number endings follow how the number is read (`trDative`).
  - Torn's names stay as they are: crime names, items, ranks, competitions and award names.
  - In Turkish, the English Torn text under a row becomes the how-line's tooltip. In English, a one-time row's line is
    Torn's text itself.
  - Award types, rarities, place buttons and Medal are labelled in both languages.
