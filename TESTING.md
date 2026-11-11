# Tests

Use Node 24 for development and the central Premium service. This workspace also verifies successfully on Node 22.14. The desktop application itself keeps its existing Node/Electron runtime requirements; Vitest is a development dependency, not a shipped runtime dependency.

```sh
npm ci --ignore-scripts
npm run test:unit
npm run test:watch
npm test
npm run test:all
npm run check
npm run build:preview
```

- `test:unit`: Vitest 5.1.0, one starter suite/test in `tests/unit/travel-math.test.mjs`. Tests the real shared function: 15 items × $400 margin gives $6,000 profit for a one-hour round trip.
- `test:watch`: reruns the Vitest suite as its inputs change.
- `npm test`: the existing 12 core/session/userscript tests plus the Vitest starter test.
- `test:premium`: Node's existing runner, 57 tests for the payment service, identity, features, migrations, concurrency and public HTTPS service paths.
- `test:all`: all 70 unit/integration tests. The runners use separate include patterns; Vitest does not collect Node's `node:test` suites.
- `check`: syntax validation of maintained JavaScript, including `.mjs`; this JavaScript project has no TypeScript compilation/typecheck configuration.
- `build:preview`: creates an application update payload under the adjacent `updates/premium-feature-build` folder. It does not publish a release or replace `latest.json`.

`npm ci --ignore-scripts` avoids downloading an additional Electron binary for Node-only tests. If developing with `npm start`, run `npm rebuild electron` once or use normal `npm ci` to install that development runtime. The existing packaged `TornTracker.exe` is independent of this development download.

Vitest configuration: `vitest.config.mjs`, Node environment, explicit imports, only `tests/unit/**/*.test.mjs`. Installation also corrected the pre-existing nonexistent `@electron/packager` version range from `^19.1.2` to `^19.1.1`. `package-lock.json` fixes the resolved dependency graph. Reference: https://vitest.dev/guide/ and https://vitest.dev/config/.

## Browser and packaged application checks

The browser checks use the already installed external Playwright QA dependency. Set `PLAYWRIGHT_MODULE` to its module directory and optionally `QA_OUTPUT` to a screenshot folder, then run:

```sh
node tests/ui-smoke.js
node tests/premium-ui-smoke.js
node tests/feature-modules-ui-smoke.js
node tests/electron-smoke.js
```

Windows QA uses the installed Chrome executable. The Electron check starts the packaged app with a separate temporary profile. Every payment/feature test uses synthetic game observations and isolated databases; no real Xanax is sent or collected. UI checks cover actual desktop-to-service requests, Free/expired/renewed states, consent, editable themes, saved profiles, five modules, escaping, responsive layouts (390, 640, 1440 pixels), and transport failure. Screenshots and temporary QA files are outside Git and update payloads.

The GitHub test workflow is configured in `.github/workflows/tests.yml`. It has not been run on GitHub as part of this change. The public service deployment and external HTTPS checks are recorded in `premium/PUBLIC-DEPLOYMENT.md`.
