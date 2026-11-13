# Tests

Use Node 24 for development and for the Premium service (Node 22.14 also works). The desktop app keeps its own Electron runtime; Vitest is a development dependency and is not shipped.

```sh
npm ci --ignore-scripts   # Node-only install; no Electron download needed for the tests
npm run check             # syntax check of every maintained .js/.cjs/.mjs file
npm test                  # core, session and FF Scouter tests (node:test) + Vitest unit tests
npm run test:premium      # Premium service: payments, identity, features, migrations, HTTP
npm run test:all          # both of the above
npm run build:preview     # app update payload in ../../../updates/premium-feature-build (does not publish)
```

| Command | What it covers |
| --- | --- |
| `npm test` | 51 `node:test` tests and 19 Vitest tests (`tests/unit/**/*.test.mjs`): `core` (battle stats, local API, page security policy), `account` (one player's records never reach another), `torn-api` (broken or sparse Torn replies, rate limit, feedback), `session` and `session-guard` (Torn cookies and request tokens), `ff-script` (FF Scouter bridge), `updater` (verified install, damaged packages, rollback), `torntools` (TornTools package signatures), `nav-guard` (tabs that keep navigating by themselves); Vitest: `travel-math` and `new-year` (season dates, greeting year, tree placement beside the card, no frames when stopped or with animations off, the website copy matches) |
| `npm run test:premium` | `tests/premium/*.test.js` (85 tests): payment logs, pricing, identity, sessions, concurrency, migrations and the public HTTPS paths |
| `npm run test:watch` | reruns the Vitest suite while you edit |

The two runners use separate file patterns, so Vitest never collects the `node:test` suites. Vitest settings live in `vitest.config.mjs`.

For `npm start` (Electron from source), run a normal `npm ci` or `npm rebuild electron` once. The packaged `TornTracker.exe` does not depend on that download.

## Browser and packaged app checks

These use an existing Playwright install. Set `PLAYWRIGHT_MODULE` to its module folder (and optionally `QA_OUTPUT` for screenshots), then run:

```sh
node tests/ui-smoke.js
node tests/premium-ui-smoke.js
node tests/feature-modules-ui-smoke.js
node tests/overview-ui-smoke.js
node tests/electron-smoke.js
```

- They use the installed Chrome. `electron-smoke.js` starts the packaged app with its own temporary profile and data folder.
- Every payment and feature test uses synthetic game data and throwaway databases. No real Xanax is sent or collected, and no Torn request is made.
- The UI checks cover Free, expired and renewed states, automatic reconnection, themes (including text contrast in the Light theme), saved profiles, the six Premium modules, escaping, layouts at 390/640/1440 px and network failures. Any script or handler the page's Content-Security-Policy blocks fails the run.
- `overview-ui-smoke.js` checks the customizable Overview: the default and saved layouts, the classic switch, edit mode (drag, keyboard, add list, Done and Reset) for a free player, and the Premium widgets for a member: escaped Torn data, S/M/L sizes, a second saved layout, a layout name shown as text, the lapsed, unknown and switched-off states, and the fetch policy (a tile loads only while the Overview is on screen, at most once a minute, never while its page is off, and never from the target, faction report or stock order endpoints). It uses Playwright's page clock for the timing.
- `electron-smoke.js` also checks that a Torn tab stays lined up with the top bars when the app is zoomed, that Reload acts on the tab being viewed, that open tabs survive a reload of the app page, that a tab never loads a script or file URL, that page helpers run only on their own page, that a tab which keeps navigating by itself is stopped until you click in it, and that the app page comes back after its renderer process dies.
- Screenshots and temporary files stay outside Git and outside update packages.

## Website

See [WEBSITE.md](WEBSITE.md): `website/tools/serve.js` previews the page with the live Content Security Policy and `website/tools/check.js` checks it on desktop and mobile in English and Turkish.

## CI

`.github/workflows/tests.yml` runs `npm run check` and `npm run test:all` on every push and pull request. The manual `release.yml` workflow runs the same suite before it builds anything.
