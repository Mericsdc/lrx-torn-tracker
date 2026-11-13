# New Year decoration on the sign-in screens

Status: approved by the owner (2026-11-13)

## Intent

During the New Year holidays, both "first screens" get a festive scene inspired by an ASCII-art Christmas tree reel the owner shared: a tree made of text characters that builds itself on a starry sky, then gets gold garlands, ornaments, gifts, a shining star and a greeting line.

- The hero of https://lrxe8.com/torn-tracker
- The app's sign-in screen (`#auth-screen`), in both its login and splash modes

Both already draw the same pixel-city background (`shape-waves.js`). Its dot grid and moon are already close to the reel's look, so the decoration is added on top of it instead of replacing it.

## Decided by the owner

- The tree stands **beside the centred card**. The card stays usable from the first moment and nobody waits for the animation.

## Goals

- A self-building ASCII tree on the left of the card:
  - a green cone of characters (`. : - = + * % # & M`) shaded like the reel;
  - gold garland spirals, blinking red, gold and blue ornaments, gift boxes at the base and a gold star with rays;
  - the greeting typed under the tree in alternating gold and red letters.
- Slow falling snow and twinkling `+` stars across the whole scene.
- The greeting follows the page language: `HAPPY NEW YEAR 2027` / `MUTLU YILLAR 2027`. In December the year shown is next year; in January it is the current year.
- Active from 20 December 00:00 to 6 January 23:59 in the viewer's local time. On all other days the script returns early and nothing changes.

## Non-goals

- No change to the pixel town itself (no snow on roofs).
- No decoration anywhere else in the app.
- No music or sound.
- No code, frames or audio from the reel. The scene is our own code, drawn on our own grid.

## Anti-goals (a failure even if it works)

- It covers or overlaps the card, the key field or the buttons.
- It shows outside the date window.
- It makes sign-in slower, or makes the app wait before it opens.
- It makes a network request (the site CSP forbids it, and the app must not need one).
- It keeps animating with animations turned off, or after the sign-in screen has closed.

## Constraints

- The site runs under a strict CSP: no inline scripts or styles. The new file must be named `LRXe8-tt-*`, because `install.sh` copies only those assets.
- The app shows the login form only to people without a saved key. Everyone else sees the 1.4 s splash on the same screen.
- Every app feature needs a Settings switch in both `public/features.js` and `public/feature-catalog.js`, with TR and EN text.
- English is the default; every visible text needs TR and EN.

## Approaches

1. **A separate overlay script, shared by both screens (chosen).** One file draws on its own canvas above the town and below the card. The same source is copied to the site as `LRXe8-tt-newyear.js`. The town code is untouched, so the seasonal code is easy to switch off or remove. It runs a second animation loop, but only for 18 days a year and only on the first screen.
2. **Extending `shape-waves.js`.** This would share the town's grid and loop and could put snow on roofs. However, the two copies of that file already differ, it makes the town code more complex all year, and a mistake would break the background on every day of the year.
3. **A pre-rendered video or GIF.** This would be heavy and blurry when scaled, could not follow the language or the year, and could not stop for reduced motion. It was dropped.

The owner handed the "how" to the builder; approach 1 is the builder's call.

## Design

- **File:** `public/new-year.js` defines `window.LRXNewYear`:
  - `isSeason(date)` and `greeting(date, lang)` are pure functions, for tests;
  - `create(canvas, opts)` returns `{ start, stop, finish }`.
  - The site copy is `website/site/assets/LRXe8-tt-newyear.js`, kept identical by a test.
- **Placement:**
  - The tree is centred in the free space left of the card. Its height is about 55% of the scene.
  - If that space is narrower than about 190 px (phones, narrow windows), there is no tree and no greeting, only snow and stars.
  - The layout is recomputed on resize.
- **Sequence (login mode and the site):**
  1. Stars and snow from the start.
  2. The cone builds bottom to top in about 3 s.
  3. Garlands, then ornaments, then gifts.
  4. The star lights up at about 5 s.
  5. The greeting types in.
  6. After that the tree keeps a slow shimmer, the ornaments blink and the snow falls.
- **Splash mode (app):** the finished tree is drawn at once, because the splash lasts only 1.4 s.
- **Reduced motion:** applies when the OS asks for reduced motion, or when the app's **Animations** setting is off. One finished frame is drawn with a few still snowflakes, and there is no loop.
- **Performance:**
  - About 30 fps, with the device pixel ratio capped at 1.5.
  - It stops when the tab is hidden and when the hero scrolls out of view (site, the same pattern as the town).
  - It stops when the sign-in screen closes (app).
- **Colours:** green shades for the tree, the site's gold (`#c9a96a` / `#e3cc97`), red `#d6455a`, ornament blue `#5b8def`, white snow.
- **App setting:** `app.newYear` in group `app`, on by default.
  - TR: "Yılbaşı süsü" – "20 Aralık – 6 Ocak arası giriş ekranında yılbaşı ağacı ve kar".
  - EN: "New Year decoration" – "Christmas tree and snow on the sign-in screen, 20 Dec – 6 Jan".
- **Site:**
  - A `<canvas class="hero-newyear">` sits in the hero, styled in `LRXe8-tt.css`.
  - The script tag is `defer`.
  - The greeting follows the EN/TR switch live.
  - A `?newyear=1` query forces the scene on, for previews and checks. It does nothing else.
- **Tests:**
  - Unit tests for the dates (19 Dec off, 20 Dec on, 6 Jan on, 7 Jan off), the greeting and year, and the placement.
  - A test that the site copy equals `public/new-year.js`.
  - `website/tools/check.js` passes with `?newyear=1`: CSP, console and overflow, desktop and mobile, EN and TR.
  - Screenshots of both screens for the owner.
- **Shipping (only when the owner asks):**
  - The site is deployed with the usual sudo install.
  - The app ships in v1.6.14, which must be released before 20 December.

## Left to the builder

The exact character ramp and shading, the garland and ornament layout, the snow density and the type size of the greeting. These are tuned by eye against the reel's frames, within the colours and timing above.
