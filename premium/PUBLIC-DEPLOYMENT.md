# lrxe8.com deployment — 11 November 2026

Public service: **https://lrxe8.com/torn-premium**. Health: `/health`; metadata: `/v1/info`; disclosure: `/terms`, relative to that service URL. Clients use ordinary HTTPS and need no Tailscale, SSH, Cloudflare client or local billing service. Only the operator's server runs the existing Cloudflare connector. [Cloudflare published-application documentation](https://developers.cloudflare.com/cloudflare-one/networks/routes/add-routes/).

## Deployed service

- Host: `lrx@100.73.60.83` (operator management address only).
- User unit: `lrx-torn-premium-public.service`, enabled for startup, `Restart=on-failure`.
- Runtime: existing Node 24; no new runtime dependencies.
- Source: `/home/lrx/.local/share/lrx-torn-premium-public/current`, release `xanax-045ba501bddc`.
- Private configuration: `/home/lrx/.local/share/lrx-torn-premium-public/service.env`.
- Independent database: `/home/lrx/.local/share/lrx-torn-premium-public/state/premium-live.sqlite`, schema 4. No synthetic payment records were imported.
- Listener: **127.0.0.1:3742**, reachable publicly only through the configured HTTPS route.
- Identity mode: `live`, meaning official Torn key-owner verification. **Automatic in-game Xanax collection is enabled** from 2026-11-11 17:41:03 UTC. The receiver key is stored only in the private server environment (mode 0600); the test login secret remains empty. The synthetic login endpoint returns 403.
- Controller display: `Ezlira [4037017]`; contact: the application's Feedback channel, as requested by the operator.

The existing remote synthetic-test unit/database was left unchanged. The desktop Premium Test shortcut instead uses its independent local service at `127.0.0.1:43741`.

## Cloudflare route

The already-running `lrxe8.com` tunnel was configured through the operator's authenticated Cloudflare dashboard. No root password, Cloudflare API credential, new DNS zone, firewall change or new tunnel was needed.

The landing page was added on 2026-11-11; see `../WEBSITE.md` for publication IDs and maintenance. Current route order:

1. Hostname `lrxe8.com`, path `^/torn-premium/?$|^/torn-premium/site/`, service `https://lrx-torn-tracker.workspace-433160.chatgpt.site` (Host header and TLS origin name equal that hostname, certificate verification on).
2. Hostname `lrxe8.com`, path `^/torn-premium(/.*)?$`, service `http://127.0.0.1:3742`.
3. Existing hostname `lrxe8.com`, any other path, existing service `http://localhost:3002`.

The specific path must precede the site's general rule. Cloudflare forwards the path intact; the membership API recognizes its configured prefix. The root site's HTTP 200 and `LRXe8` title were verified after publishing. TLS verification was enabled throughout.

The current `package.json` contains `premiumServiceUrl=https://lrxe8.com/torn-premium`. The desktop uses that publisher default and never sends a saved key until the user explicitly connects after disclosure. `TORN_PREMIUM_SERVICE_URL` can override it; an explicit empty value disables it. The Premium Test launcher overrides it with its loopback test service. Remembered consent is scoped to the complete service URL, including its path; changing the path does not silently forward a key to another service.

## Verification and limits

- Public health: HTTP 200, `ok=true`, identity mode `live`.
- Public metadata: five modules, real payments false, Ezlira display and Feedback contact.
- Unauthenticated membership/admin endpoints: HTTP 401.
- Synthetic login on the public service: HTTP 403.
- The actual desktop bridge successfully read the public service with an empty environment and the publisher default, without reading a saved Torn key.
- 70 local unit/integration tests passed, including HTTPS prefixes, remembered-consent path isolation, prefixed server routes, normal identity verification and disabled synthetic public login. Integrated module UI QA passed again after the bridge changes.
- No real account login through the public service and no real payment acceptance test was performed in this deployment. Remote unit-test execution could not be completed after SSH became intermittent; external HTTPS checks continued to pass.
- Desktop v1.6.9 is published with the shared service URL. The Xanax activation below is a server update and does not require another desktop release.

Torn ID, subscription periods, payment reconciliation metadata and separately opted-in profiles/observations are data, even when no API key is retained. The service disclosure reflects these actual categories. Verified identity records start at connection; subscription/payment history starts at purchase. The operator has not specified a fixed month/year deletion period. The configured policy describes membership-account lifetime, duplicate/dispute needs and manual Feedback erasure assessment; it does **not** promise automatic deletion after a newly invented period. Observation and raw-review limits remain 730 and 30 days respectively. The operator must process erasure requests and backups as documented in `PRIVACY.md`.

## Operations / rollback

```sh
systemctl --user status lrx-torn-premium-public.service
systemctl --user restart lrx-torn-premium-public.service
systemctl --user stop lrx-torn-premium-public.service
```

To remove public membership API access, remove only the second, API-specific `/torn-premium` route from the existing Cloudflare tunnel. To roll back only the landing page, remove only the first, static-page route. Keep the site's original catch-all route. Disabling this service does not stop the website or the separate synthetic test service. Use SQLite's backup mechanism for the live database; do not copy only the main file during WAL activity. The mandatory approval-reference field was removed at the operator's explicit request; receiver identity, events access, real-format verification and privacy gates remain enforced.

## In-game Xanax activation — 11 November 2026

The operator explicitly authorized removing the approval-reference requirement and enabling in-game Xanax subscriptions. This is an operator configuration decision; no official Torn approval is claimed. The receiver remains Ezlira [4037017]. Default pricing remains 1 Xanax = 15 days, checked every 60 seconds.

The remote Node 24 service verified the receiver key owner and events access, sampled 100 real events and parsed two verified incoming Xanax events. One ambiguous candidate stays a review case. No event text was retained by that read-only validation.

A private SQLite backup was taken before activation. A fenced initial checkpoint at **2026-11-11 17:41:03 UTC** excludes existing transfers. The first real collection check succeeded with zero historical credits. No synthetic payment was inserted into the live database. Unknown senders remain pending until that same Torn account verifies its identity; they are never assigned to another user.

Only `premium/worker.js` and `premium/config.js` changed in the remote source release. Existing API source, state, routes and test service were preserved. The live environment has explicit collection opt-in and verified-format flags enabled. Both the environment and backups are private; no receiver secret is in Git or public metadata. Public membership/admin routes continue to require authentication, and public synthetic login stays disabled.

Local validation: 73 passing tests, including operator activation without a reference, retained technical gates, initial historical exclusion, two-Xanax/30-day activation and replay deduplication. A post-activation new real payment has not been initiated for testing; only the official read-only API was used.
