# Torn Tracker public website

Published 2026-11-11 at **https://lrxe8.com/torn-premium**.

## Source and publication

- Authoring source: `website/index.html`, `website/site.js`, `website/styles/`, `website/assets/`.
- Build: `node website/build.mjs`. No added runtime dependencies. The output has both `/index.html` and `/torn-premium/index.html`; assets live under `/torn-premium/site/`.
- Hosting project: `appgprj_6af48d4a02f08191876cef57ddb83580`, public.
- Hosting source checkout: `D:/Meric/TORN/updates/torn-tracker-website-hosted` (sanitized standalone repository; excludes the application, keys and databases).
- Published source commit: `1e4c115adb578b06f6da44abc5fe25fec2364d52`.
- Saved version: `appgprj_6af48d4a02f08191876cef57ddb83580~appgver_41b3dff23c48819181f663a4ab9b027d`.
- Successful deployment: `appgdep_6af48f6986488191ba49abf6ea7cf5a2`.
- Static origin: `https://lrx-torn-tracker.workspace-433160.chatgpt.site`.

The source helper commits/pushes the sanitized site and packages exactly that state. For changes, sync only the website source into the same checkout, retain `.openai/hosting.json` and project identity, then use the Sites source/version/deploy workflow. Never copy application data or environment files into it.

## Cloudflare route order

The existing tunnel `lrxe8.com` has these routes, in this exact order:

1. `lrxe8.com`, regex `^/torn-premium/?$|^/torn-premium/site/` -> the HTTPS static origin above. HTTP Host Header and TLS Origin Server Name both equal `lrx-torn-tracker.workspace-433160.chatgpt.site`. TLS certificate verification stays enabled.
2. `lrxe8.com`, regex `^/torn-premium(/.*)?$` -> `http://127.0.0.1:3742`, the existing membership API.
3. Existing catch-all -> `http://localhost:3002`, the main website.

Only the landing page and its assets go to static hosting. `/v1/*`, `/health` and `/terms` retain the existing backend. Visitors need neither Tailscale nor SSH. SSH was unavailable while publishing; no remote backend release, database migration, payment setting or API credential was changed.

Removing only the first route rolls back the landing page while retaining the previous API. Do not remove the API or the main website route.

`premium/site.js` also supports self-hosting the same source with the Node backend; this local addition was tested but is **not deployed on the remote server**. Its download redirect points to the same official ZIP as the static build.

## Content and rights

The page includes actual app QA captures with synthetic demonstration data, gallery/lightbox, EN/TR preference, below-level-15 guidance, Windows download instructions, Mac-in-development status, player-request development statement and animated accessible creator credits. Profile links identify Glasnost [1844049], Weav3r [1853324] and DeKleineKobini [2114440]. No endorsement is claimed.

The public Windows download remains **v1.6.8**. No desktop release was created. Advanced workspaces under development are explicitly marked as a future-release preview. Existing free tools stay free. Real Xanax payments remain disabled.

Original-additions licensing was published separately on GitHub in commit `7ee74bbc8e57e9e419d3af7f22cb647a0f05fa55`, changing only LICENSE, legacy MIT notice, README licensing text and package license metadata. Earlier MIT grants and third-party licenses remain valid. Licensing is not technical copy protection. The application worktree's other pending Premium changes were not pushed.

Mona Sans is self-hosted with `website/assets/OFL.txt`; third-party userscript notices remain unchanged. No analytics, payment form or API-key input is present on the landing page. Only the language preference is stored in browser localStorage.

## Validation

- `npm run test:all`: 71 passing tests (12 Node, 1 Vitest, 58 Premium), including new safe static routes and retained API authentication.
- Automated site UI checks: seven widths from 320 to 1920 pixels; no horizontal overflow; EN/TR persistence; keyboard gallery and modal dismissal; all three profile links; Windows/license links; no-JavaScript content and reduced-motion support.
- The same site UI suite passed against the public custom domain after publication. `npm run check` validated 85 maintained JavaScript files; `npm run build:preview` created the isolated preview archive successfully.
- Visual renders: 1280x800, 1440x900, 1920x1080 and mobile full page. Fresh reviewer findings resolved: mobile hero screenshot scale, visible demonstration-data caption, disclosure cues for creator panels and Torn-specific update heading.
- Design scan: 0 failures, 0 reflex findings; one reviewed advisory (94 words across adjacent sections in a desktop viewport). The concise updates are needed to represent the requested improvements; no blocking issue remains.
- Live HTTPS: page, CSS, images, fonts, metadata and health respond successfully; admin remains 401, public synthetic login remains 403, `livePayments=false`; main root remains HTTP 200 with title LRXe8. Static hosting does not apply the optional `_headers` file; no response-header hardening claim is made for that origin.

For browser regression checks, use existing test tooling rather than adding app dependencies:

```powershell
$env:UI_VALIDATION_DEPS='D:\Meric\TORN\updates\ui-validation-deps\node_modules'
node tests/site-preview.js
# In another terminal:
node tests/site-ui-smoke.cjs
```

Set `SITE_TEST_URL=https://lrxe8.com/torn-premium` for the public route; no login or game request is made.
