# Free and Premium module inventory

Reviewed 2026-11-11 against the active source tree, not the older installed copy.
Codebase-memory transport was unavailable; GitNexus and direct source inspection were used. No existing product function is reassigned to Premium.

| Module / implementation | Existing Free functionality and data | New Premium scope |
| --- | --- | --- |
| Appearance (`app.js`, `themes.css`) | All five existing themes, animations, splash, language, window/tab preferences | Custom palettes, new theme packs, density/card style, saved appearance profiles |
| Travel (`features.js`, `server.js`) | YATA/Prometheus stock, Torn item market value, country/product filters, capacity, flight method, hourly profit, watch list, restock estimates/alerts | Saved strategies, fee/delay/price-change scenarios, side-by-side routes, recorded price charts, price thresholds |
| Merit tracker (`extras.js`, `server.js`) | Torn honors/medals, owned/missing categories, measured progress, sorting/filtering | Budgeted allocation planner, priorities, comparison, saved plans, observed progress history |
| Torn helpers (`features.js`, `torn-helpers/*`) | War attack links/timers/groups, passive fight overlay, pickpocket XP, crime value/rank, burglary advice, jail difficulty, sale guard, poker odds, fast slots, stock delivery sync | Combined target filters, saved profiles, player comparison, configurable analysis columns, custom threshold alerts |
| Seasonal events (`events.js`, `tools.js`) | Official calendar and personal start time, counters, guides, basket/egg data where API supplies it; Easter/Christmas/Halloween scripts | Personal reminders, measured or explicitly manual goals, progress records, comparison between event runs, pace analysis |
| Overview / gym | Bars, cooldowns, education/bank/status counters, base/effective stats, Xanax adjustment, daily stat history | Remains Free; no artificial restriction |
| War / faction | FFScouter estimates, recommendations, faction rosters, groups, OC permissions and reports | Advanced target comparison shares the helpers module; all current recommendations stay Free |
| Company | Stock/delivery, shopping reports, employees, income/history, rehab message action | Remains Free; director eligibility remains the existing Torn rule |
| Job / networth | Job-position matching, working stats, wealth breakdown/history | Remains Free |
| Crimes / purchases | Shoplifting watch alerts, community $/nerve, burglary, jail history, purchase-price records and sale guard | Remains Free |
| Levelling / beginner guide | Baldr lists/status checks, below-level-15 guidance | Remains Free; existing level visibility rules retained |
| Browser / bundled scripts | TornTools, FF Scouter V2, TornW3B Bazaar, tabs, quick links, session repair, sleep, external login | Remains Free; no entitlement check added to script injection |
| Updates / notifications / feedback | Existing automatic update flow and every current notification | Remains Free; only newly defined personal rules are Premium |
| Premium account/admin | Existing verified identity, Xanax ledger, sessions, expiry, permanent Ezlira policy, test lab, admin audit | Reused for feature access; no second billing service |

## Integration contract

The public feature catalog describes access; the existing central service decides it using the verified session and current subscription. A feature override can deny an individual advanced module without restricting Free functionality. All advanced calculations and profile writes are checked on the server. Plans remain stored when a subscription expires. A local UI preference or edited JavaScript is never accepted as proof of membership.

Advanced tools send only the selected, bounded analysis inputs after a separate opt-in. Existing Torn requests and caches remain local and Free. Histories are observations recorded after opting in, not reconstructed historical prices or guaranteed live data. Desktop reminders run only while the app is open and relevant data is available. No game action is automated.

The merit planner uses the official incremental cost (rank 1 through 10; 55 total), and maximizes the user's priority score under a budget. It is not a claim of an objectively optimal game strategy. Source: https://wiki.torn.com/wiki/Merit (checked 2026-11-11); current upgrade labels/levels are loaded from official `/v2/torn/merits` and `/v2/user/merits` where available. A manual scenario is explicitly identified when API data is missing.

Live payment collection remains disabled pending the previously required official permission. These features do not sell Torn Premium or block access to Torn API data.
