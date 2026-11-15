# Beginner Guide v2 and Happy Jump card: design

Date: 2026-11-14. Status: draft, waiting for the owner's approval. Not committed (the owner asked for no commits yet).

## Intent

The owner: "The under-15 guide needs to explain things in more detail and steer new players. For example, the happy jump is missing."

The guide today (`public/features.js`, `GUIDE_SECTIONS`, `guideSteps()`, `renderGuide()`) is a pile of tips in eight cards plus five personal steps. It never says what to do first, and it has nothing on the happy jump, energy and cooldowns, missions, factions, money safety or housing. A new player should open it and know what to do today, this week and until level 15, and should understand the happy jump well enough to plan one safely.

## Decided with the owner

- Topics: all of them. That means the happy jump, energy and cooldowns, nerve, crimes and Duke missions, faction, money and home, and an ordered roadmap ("Day 1 → First week → Until level 15").
- Adapted to the player: yes. New personal steps come from data the app already has, plus a live "Happy jump readiness" checklist. No new Torn requests.
- Detail: each card shows 2-3 short summary lines, and a "Details" disclosure opens the step-by-step text. The page must not turn into a wall of text.
- The happy jump card is also shown to players at level 15 and above, on the Tools page.

## Goals

1. An ordered roadmap at the top of the guide: Day 1, First week, Until level 15.
2. Topic cards, each with a summary and details:
   - Happy jump (new)
   - Energy and cooldowns (new)
   - Gym (existing)
   - Nerve, crimes and missions (expanded)
   - Faction, money and home (new)
   - Job (existing)
   - Education (existing, one fact fixed)
   - What to buy (existing)
   - Helpful tools (existing)
   - After level 15 (existing)
3. More personal steps, all from the overview the app already loads:
   - nerve is full;
   - not in a faction;
   - living in a Shack;
   - energy stacked above the maximum, pointing to the jump card.

   The existing steps stay: stats under 300, job, course, happy at base, energy full.
4. A Happy jump card with a live readiness checklist and the jump's next step, shown:
   - in the Beginner Guide (under level 15);
   - on the Tools page (level 15+), behind its own feature switch `tools.happyJump`, default on.
5. English by default and Turkish through `tr()`. Every text is a TR/EN pair.

## Non-goals

- No gym gain calculator (the owner chose the checklist without it).
- No live market prices. Costs are given as orders of magnitude, marked "prices change".
- No change to Baldr's Levelling Targets.

## Anti-goals (a failure even if it works)

- A wall of text that a new player will not read.
- Wrong numbers. Every number comes from the fact sheet below. Anything the sources disagree on is written without a number or left out.
- Anything that acts for the player. LRX only shows information. Every step (taking Xanax, using items, training) is done by the player in Torn, and the card says so.
- Opened "Details" that snap shut every time the overview refreshes (about every 30 s).

## Constraints

- Torn rules: display only, no clicks, no extra Torn requests. The card reads `state.overview` only.
- i18n rule: every new text is a TR/EN pair through `tr()`, English by default.
- Feature-switch rule: the new Tools card gets `tools.happyJump` in `FEATURE_DEFS` and in the legacy list of `public/feature-catalog.js`. The test in `tests/premium/features.test.js` already checks that every switch is in the catalog.
- `public/features.js` holds other sessions' uncommitted work, so changes there stay small.
- Tests: `npm run check`, `npm test`, `npm run test:premium` and the UI smokes. Then the changed files are copied to TEST and checked with `cmp`.

## Approaches

| | Approach | Trade-offs |
|---|---|---|
| **A (chosen)** | New UMD module `public/beginner-guide.js` (global `LRXGuide`, `module.exports` for tests), in the style of `levelling.js`. It holds all texts and the pure rules. `features.js` renders the guide and `tools.js` renders the Tools card. | Unit-testable with vitest; both pages share one source; `features.js` shrinks. Costs one new file and one script tag. |
| B | Grow `GUIDE_SECTIONS` inside `features.js`. | Fewest files. But the rules cannot be unit-tested without browser globals, the Tools card has to reach into `features.js` internals, and it adds to a file other sessions are editing. |
| C | Texts in a JSON file loaded with `fetch`. | Works against the `tr()` i18n rule and adds loading states for no gain. |

The owner described outcomes and left the code structure to me, so A is my call.

## Design

### Module `public/beginner-guide.js` (`LRXGuide`)

Data only, no DOM and no `tr()`. Texts are `[tr, en]` pairs. Texts with values are small functions that return a pair.

- `ROADMAP`: three phases `{ id, title: [tr, en], items: [[tr, en], …] }` (`day1`, `week1`, `to15`), plus a one-line lead: "Torn is a marathon …; your first goal is level 15 (travel)".
- `SECTIONS`: `{ id, icon, title, summary: [[tr, en] × 2-3], details: [{ head?: [tr, en], items: [[tr, en], …] }] }`, with ids `jump`, `energy`, `gym`, `crimes`, `faction`, `job`, `education`, `buy`, `tools`, `after15`.
- `steps(o)`: the personal steps as `[{ id, done, text: [tr, en], action? }]`, where `action` is `{ view }` or `{ url, label }`. The text is plain, and the renderer escapes everything (today some step texts carry Torn names that are escaped inline).
- `nextTick(nowSec)`: the next :00/:15/:30/:45 quarter-hour, in seconds.
- `jumpReadiness(o, nowSec)` returns `{ phase, checks, nextTick }`:
  - `checks` holds `status`, `energy`, `drug`, `booster` and `happy`, each `{ ok, current?, max?, left? }`.
  - Stacking is optional. A budget jump starts from a full bar and a full jump from up to 1,000 E, so energy never blocks a phase:
    - The energy check is ok at a full bar or more.
    - It shows "x · stacking cap 1,000".
  - A jump in progress always wins, so the card never says "don't train" in the middle of one (after the first train or a refill, for example). `phase` is decided in this order:
    1. `unknown`: no bars data.
    2. When happy is above max (boosted):
       - status is not Okay: `blocked`;
       - drug cooldown 0: `ecstasy` ("take Ecstasy now, then train before hh:mm");
       - drug cooldown running and happy at least 2× max: `train` ("train all your energy now, plus the daily refill if you use it, before hh:mm");
       - drug cooldown running and happy under 2× max: this is only the Xanax's +75 happy, not a boost, so the not-boosted rules below apply.
    3. When it is not boosted:
       - `waitDrug` while the drug cooldown runs: "ends in X. Then take another Xanax to stack more (x / 1,000), or let it end before the jump, because Ecstasy needs it clear";
       - `waitBooster` while the booster cooldown runs: "boosters need it empty";
       - `blocked` when the status is not Okay. The text says hospital means no boosters and no gym, jail means only the Crims gym, and travelling or abroad means no gym. Stacking can go on.
       - otherwise `ready`: "right after the next tick (hh:mm TCT) use eDVDs or candy, then Ecstasy, then train everything. Or take a Xanax first to stack more."

    The status is checked only where it matters, at boosting and training, so a player who is stacking while flying or in hospital still sees the stacking advice.

  Cooldowns are the seconds left at fetch time. They are corrected by the time since `fetchedAt`, so they do not run late between refreshes.

### Rendering

- **Guide** (`renderGuide` in `features.js`):
  - The static shell is built once per language: roadmap, jump card frame and topic cards with `<details class="gd-more">`.
  - Each overview refresh updates only the parts that change: `#gd-steps` and the jump card's live block `[data-hj-live]`. So an opened Details stays open, and the call site in `applyNavVisibility` stays as it is.
- **Tools** (`tools.js`):
  - `happyJumpCard()` is added to `renderTools()` when `feat('tools.happyJump')` is on and the player is not under 15. It is the same markup as in the guide, built by one shared function.
  - An `onOverviewRendered` hook refreshes only its `[data-hj-live]` block while Tools is open, so the purchase form keeps its focus.
- **Texts that change:**
  - The guide's page subtitle becomes "A step-by-step roadmap to level 15: gym, happy jump, crimes, job and more".
  - The Tools page subtitle and the `page.tools` switch description add "happy jump".
- **Styles:** `.gd-more` (disclosure), `.gd-phase` (roadmap columns that stack on narrow widths) and `.hj-checks` (checklist rows), with light-theme colours in `themes.css` next to `.gd-list`.

### Content (from the fact sheet)

Source: `torn-beginner-facts.md` in the shared notes folder, researched 2026-11-14 from the Torn wiki, weav3r.dev guides, torn.ing, torntraining.com and ffscouter. Number rule (my call, it wins over any number listed below):
- **CONFIRMED** facts are stated plainly.
- **LIKELY** facts may keep their number but are softened with "about" or "players usually". This covers property happy values, the 3-day recruit period and the 100-day lease.
- **UNSURE** facts appear without a number.
- My own calculations are not shown at all. So "when it is worth it" is said in words: at low stats happy is the biggest factor, so a jump can multiply gains; at very high stats it matters much less.
- The hospital "no gym" rule is kept as a fact. It is a long-standing Torn rule, and the wiki confirms that boosters are blocked in hospital.

**Happy jump**
- Summary:
  - what it is;
  - happy matters most while stats are low;
  - a full jump costs tens of millions (prices change), so new players start with a budget candy/Ecstasy jump;
  - you do every step yourself.
- Full jump steps:
  1. Start at 0 energy.
  2. Take Xanax: +250 E, 6-8 h drug cooldown. Four of them reach 1,000 E, the stacking cap, in about 24-36 h. Do not train while stacking.
  3. Let the last drug cooldown end.
  4. Check that the booster cooldown is empty and that you are not in hospital or jail.
  5. Right after a quarter-hour tick, use up to 5 Erotic DVDs (+2,500 happy each, +6 h booster cooldown; you may use one while under 24 h).
  6. Take Ecstasy, which doubles your happy.
  7. Train all your energy in one go before the next tick, because happy above max resets to max at every tick.
  8. Optionally use the daily refill (30 points) and train again.
  9. Worked example: (4,500 + 12,500) × 2 = 34,000.
- Budget jump:
  - Candy is +25 happy (+35 for the Big Box of Chocolate Bars) and adds 30 min of booster cooldown, so about 48 per day.
  - Sally's Sweet Shop sells it cheap.
  - The steps are the same, from a full or stacked bar.
  - An Ecstasy-only jump still doubles happy.
  - Candy gives 3× happy around World Diabetes Day (14 Nov).
- Risks:
  - **Xanax overdose:** lose all energy, nerve and happy, plus a long hospital stay. There is no official chance; players estimate about 2% per dose.
  - **Ecstasy overdose:** lose all energy and happy, which is the whole stack.
  - **Hospital:** no boosters and no gym.
  - **Jail:** only the Crims gym.
  - **Xanax side effects:** −35% battle stats while active, and addiction.
  - **Common mistakes:** missing the tick, taking Ecstasy before the boosters, a drug cooldown that has not cleared.
  - **Sports Science Lab:** players report it needs a low lifetime count of Xanax and Ecstasy.
- When it is worth it:
  - at low stats happy is the biggest factor in gym gains, so a jump can multiply them; at very high stats it matters much less;
  - players usually do full jumps until each stat is roughly 100k-400k;
  - under 15, a cheap Ecstasy or candy jump is the best value.

**Energy and cooldowns**
- Energy: 5 E every 15 min up to 100 (donators every 10 min up to 150).
- Daily refills: energy refill and nerve refill, each 30 points, once a day.
- Energy drinks: 5-30 E, +2 h booster cooldown.
- Drug cooldown: one drug at a time. Xanax 6-8 h, Ecstasy about 3.5 h.
- Booster cooldown: up to 24 h. Candy 30 min, alcohol 1 h, energy drink 2 h, eDVD 6 h. The faction Voracity perk raises the cap.
- Medical cooldown: up to 6 h.
- Addiction:
  - wears off a little each day;
  - lowers battle stats and job efficiency;
  - can get you kicked from a course;
  - when high, training without an active drug cooldown can land you in hospital.
- Rehab: in Switzerland, $250k a session, so it needs level 15.

**Nerve, crimes and missions**
- Nerve: 1 every 5 min. The maximum grows with crime experience.
- Beginner crimes: Search for Cash, Graffiti, Shoplifting, Bootlegging. Level one up, and attempt it while the success chance is good. Being jailed costs some hidden crime experience.
- Do not buy tools.
- Jail: someone can bust you, and busting others costs nerve.
- Duke's contracts:
  - 3 to start, a new one each day at 00:00 TCT, up to 3 held;
  - the first 10 earn the Protégé honor;
  - spend credits on books, weapon mods and special ammo, not on things cash can buy.
- EXP: crimes and missions give a little; attacks give the most.

**Faction, money and home**
- Faction:
  - perks start after the 3-day recruit period; the Steadfast branch raises gym gains;
  - look for about 500k-1M+ respect, through the Faction finder, the recruitment forum or New Player chat;
  - check the leaders first;
  - the faction vault is not fully safe.
- New Player Protection: during your first 14 days, older players cannot attack you (except in faction wars).
- Money:
  - a mug takes 5-10% of cash on hand, so keep your wallet near $0;
  - the City Bank unlocks longer periods step by step;
  - a property vault needs an owned property.
- Home:
  - base happy: Shack 100 … Penthouse 450, Mansion 500, Ranch 600;
  - rent through Estate Agent → Rental; leases run up to 100 days, and tenants still pay staff and upkeep;
  - rent first, buy later;
  - rent at least a Penthouse while levelling.

**Roadmap**
- Day 1:
  - Duke's contracts;
  - the Education city job (Job Assistant);
  - start BIO1340;
  - candy, then train;
  - a beginner crime;
  - keep cash near $0.
- First week:
  - join a faction;
  - rent a better home;
  - never let energy or nerve sit full;
  - New Player Protection ends at day 14;
  - a budget happy jump.
- Until level 15:
  - all four stats at about 300, then Baldr's targets (Leave);
  - **levelling up is not automatic: click [Upgrade] next to your level**;
  - keep courses and contracts running;
  - save for Xanax and plan for travel at 15.

**Fix to existing text:** the Sports Science bachelor (SPT3510) gives +1% to all gym gains, not "+2% to all stats". Each stat ends up at +2% (its own course +1% and the bachelor +1%). BIO2127 takes 3 weeks.

### Tests (written first)

- `tests/unit/beginner-guide.test.mjs` (vitest):
  - Every text pair has non-empty TR and EN.
  - The required section ids are present, each with 2-3 summary lines and at least one details block. The roadmap has its three phases.
  - The old "+2% to all" claim is gone.
  - `steps()` covers each personal step, old and new, with synthetic overviews.
  - `jumpReadiness()` reaches every phase, including the Xanax +75 happy case and cooldowns corrected by `fetchedAt`. `nextTick()` returns the next quarter-hour.
- `tests/ui-smoke.js`:
  - At level 10 the guide shows the roadmap, the jump card and every topic card in English; in Turkish it shows Turkish text.
  - An opened Details stays open after an overview re-render.
  - At level 25 the Tools page shows the jump card. Switching `tools.happyJump` off hides it.
- The existing catalog test covers the new switch.

## Calls I made (for the owner to check)

1. Code structure A: a separate `beginner-guide.js` module.
2. The Tools card has its own switch, `tools.happyJump`, default on, shown only at level 15+.
3. Stacking energy is optional. The card never says "don't train" while a jump is in progress, and the status is checked only for boosting and training.
4. The number rule: confirmed numbers are stated plainly, likely ones say "about", uncertain ones get no number, and my own calculations are not shown.
5. The wrong "+2% to all" text in the existing Education card is fixed.

## Left to the builder

Exact wording, card order within the agreed list, CSS details, and which Torn links get a button. Links are only to pages whose URLs are certain (gym, items, education, missions).
