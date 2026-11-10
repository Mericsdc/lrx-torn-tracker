<p align="center"><img src="assets/logo-512.png" width="160" alt="LRX Torn Tracker"></p>

<h1 align="center">LRX Torn Tracker</h1>

<p align="center">A Windows desktop companion for <a href="https://www.torn.com">Torn City</a>: company stock, daily reports, employees, income, timers, Fair Fight war-target suggestions, TornTools and a built-in Torn browser in one window.</p>

---

## Features

### Version 1.6.7

- Redesigned the update window to use the same card surfaces, fonts and buttons as the main interface in all five themes.
- Current and latest versions appear together; release notes render headings, lists, bold text and code without accepting upstream HTML.
- Long notes scroll inside the window, keeping actions visible down to 480×400. Download progress and recoverable errors stay in the same dialog.
- The top update button and Settings → Updates open the same screen, including an up-to-date state. Keyboard navigation includes the notes area and restores focus when the window closes.

### Version 1.6.6

- FF Scouter now automatically uses the saved FFScouter key, falling back to the saved Torn API key. Its Torn API calls use the main Torn key. Changes and logout take effect for subsequent requests without entering another key.
- Keys are added by an authenticated local proxy; the upstream script receives an opaque marker. The original vendor source is preserved, and its generated adapter displays a read-only managed-key field.
- Verified on real Torn profile and active ranked-war pages: displayed Fair Fight scores and stat estimates match live FFScouter responses.

### Version 1.6.5

- Torn sidebar navigation is handled once per click, with a navigation-loop limit. Cookie imports replace old session/RFC cookies; duplicate cookies are normalized before opening Torn. The guard updates existing RFC tokens on outgoing Torn requests and forms without retrying failed actions.
- Updates use a dialog styled with the selected app theme. After installation, storage is flushed, native views and windows are destroyed, the old process exits and Electron relaunches the app.
- FF Scouter V2 3.4 and TornW3B Bazaars 4.1.8 are bundled from the requested upstream sources. Switches are under Settings → Torn helpers; restart after changing them. FF Scouter uses the app's saved key automatically. Its React dependency is isolated from Torn's React globals. Scripts, hashes and licenses are under `userscripts/`.
- This release also includes all of the 1.6.4 changes below.

### Version 1.6.4

- Weav3r opens in a built-in tab from the top shortcuts. Opening a second browser tab collapses the shortcuts with an animation; the menu button restores them.
- War Targets supports named groups for each faction, individual or bulk assignment, filtering, renaming and removal. Groups are saved locally in `data/war-groups.json`; assigned labels also appear on the viewed Torn war roster.
- Settings → Appearance offers Obsidian, Ocean, Forest, Amethyst and Light themes, saved across restarts.
- Settings → Torn helpers → Live fight analysis shows both players' life and observed life loss/recovery on the attack page. It pauses while the page is not focused. It uses the viewed page or Torn responses already requested by that page, and makes no game actions or additional requests. Values are health changes, not attributed hit damage or win predictions. Real combat verification remains outstanding; DOM/schema changes may require an adapter update.
- API-key entry preserves case, cursor position and every typed character. The login has a character counter, Caps Lock warning, Paste button and native editing context menu. Network/time-out errors are distinguished from invalid keys.
- Windows can be resized down to 480×400 and start within the current display's work area.
- Active Xanax is removed from the current modifier once before calculating both scenarios from base stats. Generic Drugs descriptions and the active Xanax icon are supported; addiction remains in the calculation.
- Fixed stale faction responses, zero-stat ratios, malformed local requests, cross-origin local writes, sleeping-tab titles, modal view visibility on resize and duplicate initialization when a port is occupied.

Validation: `npm test` runs isolated server and calculation tests. `tests/ui-smoke.js` and `tests/electron-smoke.js` use Playwright (set `PLAYWRIGHT_MODULE` to the installed module path). They use temporary profiles and fixture data, not the installed account. Restart the app after updating these files.

- **Overview**: Xanax/drug cooldown, education, end-of-day timers, bars, and battle stats with and without Xanax.
- **Company**: stock levels with a target cover (days), daily report, employee addiction alerts, and an income statement.
- **War targets**: FFScouter estimates, a hospital-release countdown next to each name, and a **Fair Fight payout** ranking (`expected points = win chance × FF`). The best Ideal, Easy and Risky targets are highlighted.
- **Faction**: your own Organized Crime status (role, item, planning). The leader, the co-leader and positions with the **Organised Crimes** permission also see members outside an OC, delayed OCs with missing items, and weekly top-10 tables (activity, gym energy, Xanax, crimes, blood bags, OCs).
- **Crime Hub**: shoplifting security alerts, money per nerve for every crime (Emforus sheet), burglary targets and a jail bust tracker.
- **Merit Tracker**: missing honors and medals with your progress, closest first.
- **Tools and events**: the Torn calendar with your personal start times, yearly event guides (Easter Egg Hunt, Trick or Treat, Christmas Town) and a purchase price guard.
- **Torn page helpers** (they only add colors and labels to the page you are viewing and never click anything): crime XP and $/N badges, crime buttons colored from worst to best, burglary notes, jail bust difficulty, poker odds, a below-cost listing warning and event helpers.
- **Settings**: every page, notification and helper can be turned on or off.
- **Languages**: English by default, Turkish optional (EN / TR switch in the top bar). The switch also applies to the Torn page helpers.
- **Feedback**: the 💬 button in the top bar sends a request, a suggestion or a bug report to the developer by email. Only the form fields and the app version are sent, never your API key.
- **Built-in Torn browser**: tabs you can drag to reorder, a context bar (Profile / Attack), and Google sign-in through your own Chrome or Edge.
- **TornTools**: the Chrome Web Store extension is downloaded and loaded inside the app.
- **Updates**: the update button downloads the newest GitHub release, checks its SHA-256 and installs it.

## Setup (users)

1. Download `LRX-Torn-Tracker-win32-x64-<version>.zip` from [Releases](https://github.com/Mericsdc/lrx-torn-tracker/releases/latest).
2. Extract it to any folder and run `TornTracker.exe`.
3. On the login screen, enter your own **Limited Access** Torn API key.
   - To create a key: Torn → Preferences → API Keys → Add new key → choose **Limited Access**.
   - The "Limited API key oluştur →" link on the login screen opens this page with the fields already filled in.

> 🔒 Your API key is stored only in `data/config.json` next to the app on your own computer, and it is sent only to `api.torn.com` (and to `ffscouter.com` for war estimates). Feedback messages go through `formsubmit.co` and contain only what you type in the form. Use **Settings → Çıkış Yap** to remove the key.

## Development

```bash
npm install
npm start          # Electron app
npm run web        # Server only: http://localhost:3737
npm run build:exe  # Windows package into dist/
```

To publish an update package:

```bash
node tools/make-update.js "Release notes"
```

This writes `torntracker-app-<version>.zip` and `latest.json` to the `updates/` folder. Upload both files to a GitHub Release. The app reads `releases/latest/download/latest.json` by default.

## Privacy

- The repository contains **no** API keys or personal data. The `data/` folder is in `.gitignore`.
- Each user enters their own key and their data stays on their own computer.

## License

MIT
