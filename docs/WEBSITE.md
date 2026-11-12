# Website

The public page is **https://lrxe8.com/torn-tracker**. Its source is in [`website/`](../website).

## What is where

| Path | Purpose |
| --- | --- |
| `website/site/LRXe8-torn-tracker.html` | The page. English text lives in the HTML. |
| `website/site/assets/LRXe8-tt.js` | Turkish text, language switch, screenshot tabs, scroll effects |
| `website/site/assets/LRXe8-tt-carousel.js` | WebGL credits carousel (falls back to a plain list) |
| `website/site/assets/LRXe8-tt-shape-waves.js` | The app's pixel-city background |
| `website/site/assets/*.webp` | App screenshots (EN and TR) and the credited players' Torn profile pictures |
| `website/tools/` | Preview, checks, screenshots and avatar tools (below) |
| `website/OFL.txt` | License of the bundled JetBrains Mono font subset |

The page is served by the lrxe8.com site under a strict Content Security Policy: no inline scripts or styles, and no requests to other hosts. Everything it needs is in `site/`. Only the language choice is stored in the browser (`lrxe8-locale`). There is no analytics, form or API-key input.

## Editing

- **Text:** change the English in the HTML and the matching Turkish key in the `TR` object of `LRXe8-tt.js`. Every new text needs both.
- **Release notes:** the "Release notes" section is static HTML. When a version ships, add a `<details class="rel">` block at the top (and move the `Latest` badge), plus `relNNt` / `relNN` keys in `TR`. Write it for players, from `docs/releases/<version>.md`.
- **Version:** update the `v1.x.y` fact in the hero.

## Tools

Set `PLAYWRIGHT_MODULE` to a Playwright install. Chrome is used from its default Windows path; set `CHROME_EXE` to change it.

```sh
node website/tools/serve.js                 # preview with the live CSP: http://127.0.0.1:4810/torn-tracker
node website/tools/check.js                 # desktop + mobile, EN + TR: CSP violations, console errors, overflow
node website/tools/capture.js               # new app screenshots from the fixture server (SHOT_LANG=tr for Turkish)
node website/tools/fetch-avatars.js         # Torn profile pictures of the credited players (asks for a key, hidden)
node website/tools/shrink-avatars.js        # turns them into 320x440 WebP files in site/assets
node website/tools/apply-avatars.js         # puts them into the credits list
```

`capture.js` runs the app's own preview server with demo data, a temporary data folder and no API key, so it makes no Torn requests. `fetch-avatars.js` uses only the official Torn API, one profile call per player; the key is typed hidden, kept in memory and never saved. Tool output (`shots/`, `checks/`, `originals/`) is ignored by Git.

## Publishing

The page and its `LRXe8-tt-*` assets are copied into the lrxe8.com static site, which serves `/torn-tracker`. Files are read on each request, so no restart is needed. The site's owner keeps a timestamped backup of the previous files for rollback.

The older landing page at `lrxe8.com/torn-premium` (hosted separately) is retired. Its source was removed from this repository; it remains in Git history. The bare `/torn-premium` path should redirect to `/torn-tracker` in Cloudflare, while `/torn-premium/v1/*` and `/torn-premium/health` keep going to the Premium API.
