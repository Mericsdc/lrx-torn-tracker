# lrxe8.com deployment — 11 November 2026

Public service: **https://lrxe8.com/torn-premium**. Health: `/health`; metadata: `/v1/info`; disclosure: `/terms`, relative to that service URL. Clients use ordinary HTTPS and need no Tailscale, SSH, Cloudflare client or local billing service. Only the operator's server runs the existing Cloudflare connector. [Cloudflare published-application documentation](https://developers.cloudflare.com/cloudflare-one/networks/routes/add-routes/).

## Deployed service

- Host: `lrx@100.73.60.83` (operator management address only).
- User unit: `lrx-torn-premium-public.service`, enabled for startup, `Restart=on-failure`.
- Runtime: existing Node 24; no new runtime dependencies.
- Source: `/home/lrx/.local/share/lrx-torn-premium-public/current`, release `bb3dee5f2eeb`.
- Private configuration: `/home/lrx/.local/share/lrx-torn-premium-public/service.env`.
- Independent database: `/home/lrx/.local/share/lrx-torn-premium-public/state/premium-live.sqlite`, schema 4. No synthetic payment records were imported.
- Listener: **127.0.0.1:3742**, reachable publicly only through the configured HTTPS route.
- Identity mode: `live`, meaning official Torn key-owner verification. **Real Xanax collection remains disabled**, receiver key and test login secret are empty. The synthetic login endpoint returns 403.
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
- GitHub was not pushed and no new release was published. Existing distributed copies need the updated application package to receive the publisher default.

Torn ID, subscription periods, payment reconciliation metadata and separately opted-in profiles/observations are data, even when no API key is retained. The service disclosure reflects these actual categories. Verified identity records start at connection; subscription/payment history starts at purchase. The operator has not specified a fixed month/year deletion period. The configured policy describes membership-account lifetime, duplicate/dispute needs and manual Feedback erasure assessment; it does **not** promise automatic deletion after a newly invented period. Observation and raw-review limits remain 730 and 30 days respectively. The operator must process erasure requests and backups as documented in `PRIVACY.md`.

## Operations / rollback

```sh
systemctl --user status lrx-torn-premium-public.service
systemctl --user restart lrx-torn-premium-public.service
systemctl --user stop lrx-torn-premium-public.service
```

To remove public membership API access, remove only the second, API-specific `/torn-premium` route from the existing Cloudflare tunnel. To roll back only the landing page, remove only the first, static-page route. Keep the site's original catch-all route. Disabling this service does not stop the website or the separate synthetic test service. Use SQLite's backup mechanism for the live database; do not copy only the main file during WAL activity. There is no change to real payment approval gates.
