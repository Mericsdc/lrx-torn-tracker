<p align="center"><img src="assets/logo-512.png" width="150" alt="LRX Torn Tracker"></p>

<h1 align="center">LRX Torn Tracker</h1>

<p align="center">
  A free Windows companion for <a href="https://www.torn.com">Torn City</a>: timers, war targets, travel profit, company stock and display-only Torn helpers, with Torn itself in built-in tabs.
</p>

<p align="center">
  <a href="https://github.com/Mericsdc/lrx-torn-tracker/releases/latest/download/LRX-Torn-Tracker-Windows-x64.zip"><b>Download for Windows</b></a>
  &nbsp;·&nbsp; <a href="https://lrxe8.com/torn-tracker">Website</a>
  &nbsp;·&nbsp; <a href="docs/releases">Release notes</a>
  &nbsp;·&nbsp; <a href="https://github.com/Mericsdc/lrx-torn-tracker/issues">Report a bug</a>
</p>

---

## Get started

1. Download [`LRX-Torn-Tracker-Windows-x64.zip`](https://github.com/Mericsdc/lrx-torn-tracker/releases/latest/download/LRX-Torn-Tracker-Windows-x64.zip) (Windows 10/11).
2. Extract it anywhere and open `TornTracker.exe`.
3. Paste your own **Limited Access** Torn API key. The link on the sign-in screen opens Torn's key page with the right options filled in.

Updates install from inside the app: the update button downloads the newest release, checks its SHA-256 and restarts. Your key, settings and data stay where they are. A Mac version is in development.

## Features

| Area | What you get |
| --- | --- |
| **Overview** | Drug, booster, medical and education cooldowns, bars, the 18:00 TCT reset, battle stats with and without the Xanax penalty |
| **War targets** | FFScouter estimates, hospital countdowns, a fair-fight payout ranking (win chance × FF) and your own target groups per faction |
| **Travel** | Profit per hour for every country, stock on arrival, restock times and departure alerts |
| **Company** | Stock against a target cover, daily report, employee addiction alerts and an income statement |
| **Faction** | Your Organized Crime status; with OC permission also members outside an OC, delayed OCs and weekly top-10 tables |
| **Crime Hub** | Shoplifting alerts, money per nerve for every crime, burglary targets and a jail bust tracker |
| **Merits, events, tools** | Missing honors and medals, the Torn calendar, event guides, networth history, gym and level guides, a purchase price guard |
| **Torn in tabs** | Built-in Torn tabs with Profile/Attack shortcuts, Google sign-in through your own Chrome or Edge, and optional TornTools, FF Scouter V2 and TornW3B |
| **Torn page helpers** | Crime XP and $/nerve badges, war and hospital timers, jail bust difficulty, poker odds, below-cost listing warnings, event helpers |

Five themes (Obsidian, Ocean, Forest, Amethyst, Light), English by default with Turkish optional, and a Feedback button that emails the developer (only what you type and the app version are sent).

**Premium is optional.** It adds advanced workspaces (appearance profiles, helper filters, player comparisons, event goals, travel strategies, merit plans) and is paid with in-game Xanax. Every tool listed above stays free.

## Torn rules and your data

- **Your key stays on your PC.** It is saved in the local `data/` folder and used with the Torn API and FFScouter. With **Settings → App → Premium membership connection** on (the default), it is also sent to lrxe8.com to verify your Torn ID and is not stored there. Turn the setting off and nothing is sent to the membership service.
- **Display only.** Helpers never click, attack, buy or send anything. They add information to the Torn page you are looking at; you press every button.
- **Only the tab you look at.** Helpers run on the focused Torn tab and make no extra requests to Torn's pages.
- **A switch for everything.** Every page, notification, helper, add-on and connection can be turned off in Settings.
- **Log Out** in Settings removes the local key and ends the membership session.

This is an independent project, not an official Torn product. Membership data handling is described in [premium/PRIVACY.md](premium/PRIVACY.md).

## Release notes

Each version has its notes in [`docs/releases/`](docs/releases) and on the [website](https://lrxe8.com/torn-tracker#releases). The latest is [v1.6.12](docs/releases/1.6.12.md).

## Project structure

```
src/
  main/            Electron app: windows, Torn tabs, helpers injection, updater, TornTools, Google sign-in bridge
  server/          Local API server (localhost:3737): Torn API calls, FFScouter, war groups, Premium client
  app-paths.js     Shared app folder, data folder and EN/TR message helper
public/            The app's interface (HTML, CSS, browser JavaScript)
torn-helpers/      Display-only scripts shown on Torn pages
userscripts/       Bundled third-party userscripts with pinned hashes and licenses
userscript-extension/, extension-shim/   How userscripts and TornTools run inside the app
premium/           Optional membership service (runs on the server, not in the app)
assets/            Icons and the crime value snapshot
website/           Source of lrxe8.com/torn-tracker
docs/              Release notes, testing and website guides
tests/             Node, Vitest, Playwright and Electron checks
tools/             Syntax check, update packages and release build
```

## Development

Development and CI use Node 24 (22.14 also works; the local server alone runs on Node 18+).

```bash
npm ci             # install (use --ignore-scripts for tests only, without the Electron download)
npm start          # run the Electron app from source
npm run web        # local server only: http://localhost:3737
npm run check      # syntax check
npm run test:all   # all automated tests
```

More in [docs/TESTING.md](docs/TESTING.md). The website is described in [docs/WEBSITE.md](docs/WEBSITE.md) and the membership service in [premium/README.md](premium/README.md).

**Releasing:** bump the version in `package.json` and `package-lock.json`, add `docs/releases/<version>.md`, commit, then run `python tools/build-release.py` (or the manual *Publish release* workflow). It builds the Windows ZIP and the update package from the exact commit and checks them before anything is uploaded.

The repository contains no API keys or personal data. `data/` and environment files are ignored by Git and never packaged.

## License

New original work, including the website, is under the [Original Additions License](LICENSE): personal use of official releases is allowed; redistribution or commercial reuse needs permission. Earlier MIT releases keep their rights ([legacy MIT terms](LICENSES/LEGACY-MIT.txt)). Third-party components keep their own licenses ([notices](userscripts/NOTICE.txt)).

## Türkçe

LRX Torn Tracker, Torn City için ücretsiz bir Windows uygulamasıdır: süreler, savaş hedefleri, seyahat kârı, şirket stoku ve yalnızca bilgi gösteren Torn yardımcıları tek pencerede. ZIP'i [indir](https://github.com/Mericsdc/lrx-torn-tracker/releases/latest/download/LRX-Torn-Tracker-Windows-x64.zip), çıkar, `TornTracker.exe`'yi aç ve kendi **Limited Access** API key'ini gir. Key bilgisayarında kalır; yardımcılar hiçbir şeye tıklamaz ve her özellik Ayarlar'dan kapatılabilir. Uygulama dili varsayılan İngilizcedir, üst çubuktaki EN / TR düğmesiyle Türkçeye geçebilirsin. Sürüm notları [`docs/releases/`](docs/releases) klasöründe ve [web sitesinde](https://lrxe8.com/torn-tracker#releases).
