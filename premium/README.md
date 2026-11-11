# Application Premium — implementation and operations

Reliability follow-up: synthetic test requests wait for their own worker run instead of borrowing an in-flight result. Baseline resets reject active worker leases. SQLite explicitly uses FULL synchronous commits, verifies test/live separation before migration work, and refuses schemas newer than this service understands. GitNexus metadata and test artifacts are excluded from update packages.

The original `LRX-Torn-Tracker` GitNexus map points at the separate installed application in `D:/Meric/TORN/LRX-Torn-Tracker`, which has no application Premium module. The maintained source is registered separately as `LRX-Torn-Tracker-Premium`. Its graph excludes bundled third-party userscripts and includes project tests; it supplements source inspection and does not prove complete runtime call coverage.

Status, 11 November 2026: five advanced modules are implemented and tested. The shared service is published at **https://lrxe8.com/torn-premium**, with verified-account identity and collection controlled by explicit operator opt-in. Receiver: **Ezlira [4037017]**. All existing features and Torn API data access remain free. The previous remote synthetic-test deployment remains separate on schema 3; the public service has its own schema-4 database. See [public deployment and verification](PUBLIC-DEPLOYMENT.md).

The membership screen now has a themed membership card and separate Membership, Members, Payments, Test lab and Settings tabs. The large closed-payments notice was removed; test mode is identified by a compact badge. Ezlira [4037017] receives a permanent server-side membership after identity verification. It has no expiry and cannot be removed through manual time adjustments. The admin member directory supports search, status filters and pagination, and shows remaining days or lifetime access.

Migration `003-membership-management.sql` adds permanent-member policy records and durable synthetic test scenarios. The Test lab creates a synthetic player, queues a 2-Xanax transfer through the normal parser/award worker and can replay the identical server-generated event. It reports days added, remaining days and record count. These endpoints require an administrator, reject real player IDs, exist only in test mode, and do not enable the collector or call Torn.

## Architecture and changed files

The existing application uses a dependency-free Node HTTP server, local `data/config.json` / history files, and saved-key authentication. It has no ORM, shared user database or central scheduler. These local files are not a trustworthy authority for paid access.

The optional central service in this folder uses Node's built-in SQLite API, with no new runtime package dependency. Run it on **Node 24 LTS**; the desktop server continues to support Node 18+. The desktop does not import SQLite or possess the receiver API key. `premium-client.js` proxies a fixed list of operations to the configured service. It keeps its bearer token only in memory and clears it on logout/key changes. App login automatically connects the saved Torn identity to the publisher-configured HTTPS membership service. There is no separate verification, acceptance, connection button or remember checkbox. Identity ownership is still checked in the background using the official API. A service-scoped key fingerprint is stored locally; server tokens remain memory-only and entitlements are always fetched from the server. Test connections send no Torn key.

| Files | Responsibility |
| --- | --- |
| `config.js`, `config.example.env` | Closed-by-default configuration and test/live separation |
| `database.js`, `migrations/001-premium.sql`, `002-privacy.sql`, `003-membership-management.sql` | Versioned SQLite migrations, transactional setup, permanent membership and test scenarios |
| `parser.js`, `torn-client.js`, `validate-receiver.js` | Conservative transfer validation, official read-only API calls and an explicit receiver-format check |
| `store.js` | Atomic awards, balances, versioned prices, subscriptions, audit, exports and privacy queue |
| `auth.js`, `service.js`, `server.js`, `worker.js` | Verified identities, roles, HTTP API and scheduled polling |
| `feature-service.js`, `insights.js`, `migrations/004-feature-modules.sql` | Central feature authorization, advanced calculations, data notices, pause preferences, profiles and bounded observations |
| `../premium-client.js`, `../server.js` | Desktop connection and owner/session isolation |
| `../public/premium.js`, `premium.css`, `index.html`, `themes.css` | User/admin screens, membership card, five existing themes, narrow layout |
| `../public/feature-catalog.js`, `feature-access.js/css`, `advanced-modules.js/css`, `travel-math.js` | Shared catalog/arithmetic, lightweight access display and on-demand module panels |
| `../public/app.js`, `../README.md` | Updated optional-service disclosures |
| `../tests/premium/*.test.js`, `../tests/premium-ui-smoke.js` | Automated billing, authorization and integrated UI checks |
| `../package.json`, `../.gitignore`, `../tools/make-update.js` | Service/test commands; prevent committing or packaging private databases/env files |

SQLite migrations run automatically and atomically on startup. Tables include `premium_users`, `premium_subscriptions`, `premium_transactions` (UNIQUE `event_id`), `premium_settings`, `premium_price_versions`, `premium_payment_balances`, `premium_sessions`, `premium_checkpoint`, worker leases, API budgets, audit/errors, test batches and privacy requests. A database's test/live mode is immutable. Back up the database with SQLite's backup mechanism; do not copy only its main file during WAL writes. Multiple workers must share the **same local SQLite database** on one host. Do not place it on a network filesystem or run independent billing databases.

## API selection and format evidence

The official [OpenAPI schema](https://www.torn.com/swagger/openapi.json) and [API documentation](https://www.torn.com/api.html) were checked on 11 November 2026.

| Method | Format / access | Decision |
| --- | --- | --- |
| v1 user `events` | Object keyed by event ID, HTML/text events; Limited | Normalizer covered by fixtures, not used by the collector |
| v2 `/user/events` | `events: [{id,timestamp,event}]`, page size at most 100, `from`/`to`, metadata links; Limited | Selected; retains HTML for verifying sender links |
| v2 `/user/log` | Structured logs with dynamic data, Full Access, nanostamp pagination | Higher privilege; no guessed log-data mapping used for billing |
| v2 `/key/info` | Actual key owner's `info.user.id`; Public | Identity proof; submitted IDs/admin flags are ignored |
| v2 `/user/timestamp` | Server timestamp | First-install baseline |

A read-only check against the configured receiver's real v2 response verified owner ID, array/envelope fields and metadata. Rechecking the final parser against 100 events found three Xanax-transfer candidates: **two were verifiable incoming payments; one unfamiliar format required review**. No transfer was made, no live award was enabled, and no raw private events or sender details were retained in source. The external research report records only shape/counts and a response digest. This validates observed grammar, not every possible future event format. New deployments must validate their receiver before setting `PREMIUM_RECEIVER_FORMAT_VERIFIED=true`.

For an explicit read-only check, configure the receiver secret privately and run `node --env-file=/private/path/premium.env premium/validate-receiver.js`. This command intentionally contacts only the official API, even while billing is closed. It reports aggregate counts, never event contents, and does not change billing configuration, create a payment baseline or grant premium. A sample that requires review must not be treated as an automatically verified payment.

The parser accepts the observed incoming-transfer grammar with exactly one valid Torn profile link and an integer Xanax quantity. Foreign/duplicate/broken links, unsupported markup, missing sender and ambiguous text are review cases. Non-Xanax/unrelated events are discarded. HTML is never rendered. Invalid event IDs/timestamps stop a poll rather than advancing a checkpoint past untrustworthy data.

## Payment guarantees and limits

- Default: 1 Xanax → 15 days; 2 → 30; 4 → 60; 10 → 150. Price units and days are admin settings. Fractional proportional days are represented in integer seconds; invalid non-integral-second rates are rejected.
- Each event is separately recorded. Verified sender ID maps only to the same API-verified account. Unknown senders retain a pending balance until that exact account signs in. Administrators cannot reassign a sender or invent one from malformed HTML.
- `BEGIN IMMEDIATE`, UNIQUE event IDs, balance debit, award and audit are atomic. A 90-second fenced worker lease prevents competing collectors. Restart/replay cannot award an event twice. Changed content under an existing ID halts processing.
- Awards extend `max(now, active expiry)`. Server-side entitlement checks enforce expiry even before a maintenance tick. A reusable `requirePremium` guard and `/v1/premium/access-check` demonstrate enforcement. Existing features and personal-data/receipt exports are not gated.
- Every payment stores its price version. New prices take effect after one second; delayed discovery uses transfer time, and subsequent changes never rewrite completed/pending award rates.
- Check interval defaults to 60 seconds; admin range 60–3600. Error backoff and Retry-After survive restart. Manual checks cannot bypass an error backoff. Fatal key/permission errors disable polling. Secrets, raw upstream errors and request URLs with keys are not logged.
- The central service budgets 20 calls/minute per known Torn owner across keys, 20 per key and 2,000 service calls/minute. Initial unknown-key identity probes are additionally limited to 10 logins/minute per remote address. These budgets do not coordinate other applications; Torn's own 100/player/minute limit still applies across every tool/key. The desktop reserves a separate 80/minute maximum.
- First live collection stores a server-time baseline and never retroactively credits old events. Later collection must rediscover the saved newest event (the anchor) before applying the snapshot.
- Pagination rereads the inclusive oldest second before going further back, preventing a timestamp-minus-one link from skipping transfers. A full 100 events in a single second cannot prove completeness, so it pauses. Missing anchors, non-advancing pages, changed IDs and a 10-page catch-up limit also pause, rather than silently skipping payments.
- The [official Events wiki](https://wiki.torn.com/wiki/Events) describes retained but deletable in-game events; it does not promise complete API retention. Deleted events or an extended outage can therefore require manual reconciliation. The admin rebaseline action requires an explicit skipped-transfer acknowledgement and audit reason. It starts a new baseline; it does not recover missing transfers. Do not advertise guaranteed recovery from unlimited outages.

## Run a local synthetic test

Use Node 24. Keep private env files outside this checkout. The service binds loopback in test mode, and its database cannot later be opened in live mode.

1. Copy `config.example.env` to a private path. Generate a random test token, for example with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
2. Set `PREMIUM_TEST_AUTH_TOKEN` to that token. Leave live payment flags false and receiver key empty.
3. Start `node --env-file=/private/path/premium.env premium/server.js`.
4. For the desktop process, set `TORN_PREMIUM_SERVICE_URL=http://127.0.0.1:3740`, `TORN_PREMIUM_TEST_MODE=1`, `TORN_PREMIUM_TEST_TOKEN` to the same token and `TORN_PREMIUM_TEST_TORN_ID=4037017`. These are **local operator test credentials**, not distribution defaults. Start `npm start` or `npm run web` from this environment.
5. Open Premium; the test identity connects automatically. Open the administrator panel. Enable synthetic checks and submit a synthetic transfer. Use another synthetic ID such as 123456; receiver self-transfers require review. The sender account is credited after that same test identity is registered; tests demonstrate this automatically.

The built-in **synthetic transfer** form never calls Torn or sends items. The publisher default is https://lrxe8.com/torn-premium; an explicit empty TORN_PREMIUM_SERVICE_URL disables the optional service. The local test shortcut overrides the default with its loopback service. Saved login keys are forwarded only when the user chooses Connect account after the visible notice. The service is not automatically bundled as a background payment authority on each user's computer.

## Environment variables

| Variable | Default / use |
| --- | --- |
| `PREMIUM_MODE` | `test`; `live` uses a separate DB |
| `PREMIUM_HOST`, `PREMIUM_PORT` | `127.0.0.1`, `3740`; test must bind loopback |
| `PREMIUM_DB_PATH` | `data/premium-{mode}.sqlite` |
| `PREMIUM_RECEIVER_TORN_ID` | `4037017`; must match DB and actual receiver key owner |
| `PREMIUM_ADMIN_TORN_IDS` | `4037017`; comma-separated verified owner IDs |
| `PREMIUM_TEST_AUTH_TOKEN` | Empty; random ≥32 characters required for local test login |
| `PREMIUM_REVIEW_RETENTION_DAYS` | `30`, range 1–90, raw review text only |
| `PREMIUM_ALLOW_LIVE_PAYMENTS` | `false`; explicit operator gate |
| `PREMIUM_RECEIVER_FORMAT_VERIFIED` | `false`; operator's completed real-shape verification |
| `PREMIUM_RECEIVER_API_KEY` | Empty; server-only receiver secret with Item receive (4103) log access; ordinary app keys remain Limited |
| `PREMIUM_PUBLIC_URL` | Empty; live HTTPS public origin / terms link |
| `PREMIUM_CONTROLLER_NAME` | Empty; live privacy controller identity |
| `PREMIUM_PRIVACY_CONTACT` | Empty; live rights-request contact |
| `PREMIUM_RECORD_RETENTION_POLICY` | Empty; operator's concrete structured-record/backup retention and deletion policy |
| `TORN_PREMIUM_SERVICE_URL` | Overrides package.json premiumServiceUrl; HTTPS in live mode, optional service path; explicit empty disables |
| `TORN_PREMIUM_TEST_MODE` | Off; `1` permits an explicit loopback HTTP test service |
| `TORN_PREMIUM_TEST_TOKEN`, `TORN_PREMIUM_TEST_TORN_ID` | Empty; local synthetic identity only |

## Before public operation

Real collection needs all environment gates above **and** the admin's enabled flag. Merely toggling the UI cannot bypass them. Payment permission has **not** been obtained. The public identity/entitlement service is https://lrxe8.com/torn-premium; collection is still closed. A host/domain means the always-on service address used by all installations; it continues checking transfers when the desktop app is closed.

Deploy one central service on an operator-controlled host with persistent local storage, HTTPS reverse proxy, OS secret management, restricted database/backups, process restart supervision, and monitoring of health, error and gap status. Keep the SQLite/API port private to the reverse proxy. Do not put the receiver key, test identity token, DB or backups in a desktop ZIP, Git or release asset. Review retention/rights handling and the controller's actual jurisdiction before opening collection. A plain env string is an operational gate, not proof of legal authorization.

See [privacy and Torn monetisation findings](PRIVACY.md). No game scraping, automatic sending, clicking or other write operation is part of this service.

## Validation

`npm test`: 12 existing regression tests plus one Vitest starter test. `npm run test:premium`: 74 tests covering public service paths, payments, pricing, identity, concurrency, feature permissions, consent, profile retention, schema 3→4 upgrades, expiry/renewal, calculation accuracy and remembered connection isolation. `npm run test:all` runs all 87. See [testing instructions](../TESTING.md).

Integrated `tests/premium-ui-smoke.js` exercises the actual desktop HTTP bridge and central in-memory SQLite service: automatic connection, test authentication without a Torn key, admin settings, synthetic transfer, 30-day activation, private history, admin isolation, escaped review text, five themes, 640px layout, TR/EN and automatic reconnection. Existing `tests/ui-smoke.js` and the packaged `tests/electron-smoke.js` also pass. All automated payment tests use synthetic events and isolated databases, never real transfers. QA images are stored outside the source checkout. Real collection is active; automated tests do not send real items. The read-only receipt validation is described in PUBLIC-DEPLOYMENT.md.

## Operator-enabled in-game Xanax collection

On 11 November 2026 the operator explicitly requested removal of the mandatory Torn approval-reference field. The collector no longer reads that field. This records an operator configuration decision, not a claim of official Torn approval. Receiver identity, events permission, real-format verification, explicit live-payment opt-in, privacy configuration, first-run baseline and atomic event deduplication remain required. The desktop continues to use the shared HTTPS service; this server change does not require a new desktop release.

## v1.6.10 — automatic quantities, player names and notices

The live collector uses `/v2/user/log?log=4103` and strictly validates the official sender and item quantities. Notifications such as `You were sent some Xanax` cannot establish a quantity. A receiver key must have Item receive log access; naming a key does not grant permissions. Raw log messages and unrelated items are not retained. Log IDs and event aliases share atomic duplicate prevention, so an already credited event is never paid again. Existing unresolved notifications are automatically linked to their matching official log and use the original transfer-time price.

Verified player names are fetched from the official public basic profile and cached in existing private metadata for six hours. Name search, member cards and exports use that cache. No schema migration is needed; database schema 4 is retained.

Connection and analysis screens now show informational notices without acceptance checkboxes. The earlier explicit connection step was removed in v1.6.11; app login now connects automatically. Analysis is available to verified Premium members after the notice; users can pause/resume it without losing saved profiles. Existing explicit pauses are preserved. The legacy consent endpoint/response field remains for older clients, but new requests do not create a legal-consent record.

Validation: 81 automated tests and integrated desktop/service UI checks, including notification-to-log repair, a preserved trial day, log/event replay, nanosecond pagination, player names, no acceptance controls, pause/expiry/renewal and escaped display text.

## Automatic membership policy — v1.6.11

App login is the only account entry step. Do not reintroduce a separate Premium verification/acceptance/connect form or remember checkbox. Data use is disclosed in the login copy and a collapsed informational Privacy section, without recording an invented legal-consent action. Background ownership checks, HTTPS destination restrictions, server authorization, key-change isolation and expiry checks remain mandatory.

Official Item receive logs immediately reserve and activate membership for their exact sender Torn ID, even before first app login. Such payment-created user rows have verified_at=0 until the actual owner logs in with their own key; a payment never creates a session or grants access to a different ID. Existing pending official-log receipts settle once under the worker lease. Ambiguous notifications and unverified legacy event rows cannot activate a new identity without authoritative log proof. No database schema migration is needed.
