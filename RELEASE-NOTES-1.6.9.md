## Premium workspaces and public membership connection

- Added a single server-verified feature access system, integrated with existing subscriptions. Existing tools and access to Torn API data remain free.
- Added optional advanced appearance profiles, combined helper filters/player comparisons, event goals and history, travel strategies/profit analysis and saved merit plans.
- Saved advanced settings survive expiry and can return after renewal. Calculation and profile endpoints check identity, permission and subscription validity on the server.
- The membership connection now uses https://lrxe8.com/torn-premium over public HTTPS. End users do not need Tailscale. Connection and analysis-data consent are separate; remembering a connection is optional.
- Simplified Premium administration, member search and remaining-day displays. Ezlira [4037017] has permanent membership after account verification.
- Hardened payment deduplication, worker coordination, retry state, migrations, data limits and privacy disclosures. Real Xanax collection remains disabled; payment tests use synthetic events only.
- Added the public application website, actual demonstration screenshots, Windows download, Mac development status and community creator credits.
- Clarified licensing for new original contributions while preserving earlier MIT grants and third-party licenses.

## Installation

- Existing users: use the in-app update button. The updater verifies SHA-256, preserves local settings/data, closes the app and restarts it.
- New users: download `LRX-Torn-Tracker-win32-x64-1.6.9.zip`, extract it and open `TornTracker.exe`.
- Mac remains in development. This release contains a Windows build only.
- Premium access requires a verified account and active server membership. Real payments are closed; do not send Xanax for this test rollout.

## Validation

71 automated tests, Vitest runner, JavaScript syntax checks and isolated application/UI checks cover Free/Premium/expired/renewed access, API failures, payment replay, concurrent workers, persistence, themes and the public website. Game observations and transfers in tests are synthetic. No real payment was accepted for validation.
