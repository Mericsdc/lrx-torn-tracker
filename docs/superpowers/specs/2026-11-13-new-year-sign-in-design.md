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
  - The app ships in v1.6.14, which must be released before Christmas Town opens (19 December 16:00 TCT, see Addendum 3).

## Addendum (2026-11-14): snowman and snow in the app

Asked by the owner after trying the test build: a snowman (inspired by an ASCII snowman reel they shared), snow around the card, and snow inside the app too.

- **Decided by the owner:**
  - The tree stays on the left of the card; an ASCII snowman stands on the right. The card stays in the middle.
  - In the app, light snow falls **behind the cards**, never over numbers or buttons.
- **Builder's calls:**
  - The snowman lives in `new-year.js` (so the site hero gets it too) and follows the tree's rules: centred in the free space right of the card, about 48% of the scene high, on the same ground line, left out when that space is under 190 px.
  - It is drawn in the same character style: three shaded snowballs, a black top hat with a red band, coal eyes and buttons, a carrot nose, a red scarf and stick arms. It builds bottom to top while the tree builds; afterwards one arm waves, the eyes blink and the scarf end flutters.
  - Splash mode and reduced motion draw the finished snowman, as for the tree.
  - The in-app snow is `LRXNewYear.snowfall(canvas)`, drawn on a canvas inside the fixed page background (`.bg`), so the glass cards blur it. About 30 fps, light density, dots and small `*`/`+`.
    - It runs only in the season (or with `?newyear=1`), only while the tracker is the visible tab (`trackerVisible()`), and not at all when Animations are off or the OS asks for reduced motion.
    - In the Light theme the flakes are blue-grey so they stay visible.
  - New switch `app.newYearSnow` in group `app`, on by default, in `features.js` and `feature-catalog.js`:
    - TR: "Uygulama içinde kar" – "20 Aralık – 6 Ocak arası kartların arkasında hafif kar yağar".
    - EN: "Snow in the app" – "Light snow behind the cards, 20 Dec – 6 Jan".
  - The `app.newYear` text now mentions the snowman: "…yılbaşı ağacı, kardan adam ve kar" / "Christmas tree, snowman and snow…".
  - For checking before the season, the app accepts `--newyear-preview` on its command line and then opens its page with `?newyear=1`.
- **Fixed alongside:** the sign-in screen is scrollable for small windows (`themes.css`), and the turning glow behind the card reached past its bottom edge at some angles, so a scrollbar came and went and the town was redrawn every few seconds. The glow now sits in its own clipped layer.

## Addendum 2 (2026-11-14): New Year celebration

Asked by the owner after trying the snowman in the test build: a welcome screen at New Year, with confetti bursting and fireworks around it.

- **Decided by the owner:**
  - It shows only on **31 December and 1 January**, once a day, the first time the tracker is on screen that day.
  - If the app is open at midnight, it counts down from 10 and the fireworks burst at 00:00.
- **Builder's calls** (shown to the owner for approval):
  - **Placement:** a full-screen layer over the app, not the sign-in screen. It comes after the splash or the "Welcome" line, so it never delays sign-in or the app's data.
  - **Text:** the centre shows `greeting()` (`HAPPY NEW YEAR 2027` / `MUTLU YILLAR 2027`) in the tree greeting's alternating gold and red letters. The player's name sits under it when it is known.
  - **Confetti:** bursts from both bottom corners. Paper pieces in gold, red, blue, green and white turn and flutter down.
  - **Fireworks:** rockets rise from the bottom and burst into character sparks (`*`, `+`, `·`) in the same colours, matching the tree's style.
  - **Timing and closing:** it lasts about 6 s, then fades out. A click, Esc or Enter closes it at once.
  - **Midnight:** on 31 December from 23:59:50 local time, if the tracker is on screen, a large countdown runs 10…1, then the celebration plays (about 10 s). If the tracker is not on screen at midnight (a Torn tab is open, or the app is minimised), the 1 January welcome shows the next time it is.
  - **Reduced motion:** with Animations off, or when the OS asks for reduced motion, it shows one still frame (the greeting and still confetti), closed by a click or after 6 s. There is no moving countdown.
  - **Memory:** "shown today" is remembered in the page's `localStorage`, keyed by local date. If that is lost (another local port, cleared data), it may show once more that day, which is harmless.
  - **File:** `public/new-year-welcome.js` (`window.LRXNewYearWelcome`), app only. The site copy of `new-year.js` is untouched. It uses `LRXNewYear.greeting` for the text and year.
  - **Switch:** `app.newYearWelcome` in group `app`, on by default, in `features.js` and `feature-catalog.js`:
    - TR: "Yılbaşı kutlaması" – "31 Aralık ve 1 Ocak'ta açılışta konfeti ve havai fişek; gece 00:00'da geri sayım".
    - EN: "New Year celebration" – "Confetti and fireworks when the app opens on 31 Dec and 1 Jan, with a countdown at midnight".
  - **Previews:**
    - With `?newyear=1` (`--newyear-preview`) the celebration shows on every start instead of once a day.
    - `?newyear=midnight` (`--newyear-midnight-preview`) forces the same things and also starts the midnight countdown 15 s after the app opens.
- **Anti-goals:**
  - It delays sign-in or the first data load.
  - It shows on any other day, or more than once a day outside previews.
  - It cannot be closed, or keeps animating after it closes.
  - It draws anything over a Torn page.
  - It plays a sound or makes a network request.
- **Approaches:**
  1. **A separate app-only script drawing on one canvas (chosen).** It is easy to switch off and to unit-test, and the site is not touched.
  2. **Adding it to `new-year.js`.** This would ship unused code to the site, because the site copy must stay identical.
  3. **DOM/CSS confetti.** Hundreds of moving elements are heavier, harder to stop at once and harder to test. Dropped.

## Addendum 3 (2026-11-14): Christmas Town dates, no countdown, a dressed-up logo

Asked by the owner after trying the celebration in the test build:
- Players do not all open the app at midnight, so the countdown is not needed. A burst of confetti when the app is opened in the new year is enough.
- On the sign-in screen, the logo gets a Santa hat, an ice frame, and Christmas lights wrapped all around it.
- The dates follow Torn's Christmas Town event, "and no more than that".

- **Decided by the owner:**
  - **Season:** the decorations show while Christmas Town is open. That runs from 19 December 16:00 to 31 December 16:00 Torn time (TCT, which is UTC). This covers the tree, the snowman, the snow on the sign-in screen, the snow in the app and the new logo decoration. The old window, 20 December to 6 January in local time, is replaced.
  - **No countdown:** the midnight countdown, the `?newyear=midnight` preview and the `--newyear-midnight-preview` switch are removed completely.
  - **Logo:** a Santa hat, an ice frame with icicles, and a string of Christmas lights all around the logo, as in the approved mockup.
- **Builder's calls** (shown to the owner):
  - **Confetti day:** 1 January, local time, the first time the tracker is on screen that day. It plays once per computer. On 31 December nothing plays. The owner said "no more than that" to the 1–6 January window. Players celebrate at their own midnight, so the date is local rather than TCT. If the app is open over midnight, the celebration shows at the next check (every 30 s) once the tracker is on screen. There is no countdown before it.
  - **Celebration:** it stays as built. The greeting reads `HAPPY NEW YEAR 2027` / `MUTLU YILLAR 2027`, with confetti and fireworks for about 6 s. A click, Esc or Enter closes it.
  - **Logo decoration file:** `public/new-year-logo.js` (`window.LRXNewYearLogo`), app only. Its `markup()` returns one SVG, the same every time, laid over the logo in logo units.
    - The ice ring is a jagged, translucent band of frost over the metal rim, with a few twinkling glints.
    - Icicles hang under the bottom edge.
    - 28 bulbs in red, gold, green and blue sit on a wire that waves around the frame. They twinkle in a chase.
    - The hat sits tilted on the top-right corner.
  - **Placement:** the logo is wrapped in `.auth-logo-stage`, and the SVG sits in that stage. The existing `.auth-logo-wrap` keeps its clipping and sheen. In the season, `#auth-screen` gets `ny-dressed`, which shows the SVG and adds space above and below the logo, so the hat and icicles never touch the card edge or the title. It shows in both login and splash modes.
  - **Switch:** it uses the existing `app.newYear` ("New Year decoration"). Its text now names Christmas Town and the logo.
  - **Motion:** with Animations off (`body.no-anim`) or with the OS asking for reduced motion, the lights stay lit and nothing twinkles.
  - **Previews:** `?newyear=1` (`--newyear-preview`) forces everything: the scene, the logo, the snow, and the celebration on every start. The TEST copy's "Geri sayim onizleme" shortcut is deleted, because its switch no longer exists.
  - **Site:** `website/site/assets/LRXe8-tt-newyear.js` stays identical to `public/new-year.js`, so the site hero follows the Christmas Town dates too. It ships with the next site deploy.
- **Switch texts:**
  - `app.newYear`:
    - TR: "Yılbaşı süsü" – "Christmas Town boyunca (19 Aralık 16:00 – 31 Aralık 16:00 TCT) giriş ekranında yılbaşı ağacı, kardan adam, kar ve süslü logo".
    - EN: "New Year decoration" – "Christmas tree, snowman, snow and a dressed-up logo on the sign-in screen while Christmas Town is open (19 Dec 16:00 – 31 Dec 16:00 TCT)".
  - `app.newYearSnow`:
    - TR: "Uygulama içinde kar" – "Christmas Town boyunca kartların arkasında hafif kar yağar".
    - EN: "Snow in the app" – "Light snow behind the cards while Christmas Town is open".
  - `app.newYearWelcome`:
    - TR: "Yılbaşı kutlaması" – "1 Ocak'ta uygulama ilk açıldığında konfeti ve havai fişek".
    - EN: "New Year celebration" – "Confetti and fireworks the first time the app opens on 1 January".
- **Anti-goals:**
  - The decoration covers the key field or the buttons.
  - It shows outside Christmas Town.
  - The lights keep twinkling with Animations off.
  - Any trace of the countdown is left.

## Left to the builder

The exact character ramp and shading, the garland and ornament layout, the snow density and the type size of the greeting. These are tuned by eye against the reel's frames, within the colours and timing above.
