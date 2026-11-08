<p align="center"><img src="assets/logo-512.png" width="160" alt="LRX Torn Tracker"></p>

<h1 align="center">LRX Torn Tracker</h1>

<p align="center">A Windows desktop companion for <a href="https://www.torn.com">Torn City</a>: company stock, daily reports, employees, income, timers, Fair Fight war-target suggestions, TornTools and a built-in Torn browser in one window.</p>

---

## Features

- **Overview**: Xanax/drug cooldown, education, end-of-day timers, bars, and battle stats with and without Xanax.
- **Company**: stock levels with a target cover (days), daily report, employee addiction alerts, and an income statement.
- **War targets**: FFScouter estimates, a hospital-release countdown next to each name, and a **Fair Fight payout** ranking (`expected points = win chance × FF`). The best Ideal, Easy and Risky targets are highlighted.
- **Built-in Torn browser**: tabs you can drag to reorder, a context bar (Profile / Attack), and Google sign-in through your own Chrome or Edge.
- **TornTools**: the Chrome Web Store extension is downloaded and loaded inside the app.
- **Updates**: the update button downloads the newest GitHub release, checks its SHA-256 and installs it.

## Setup (users)

1. Download `LRX-Torn-Tracker-win32-x64-<version>.zip` from [Releases](https://github.com/ati-space/lrx-torn-tracker/releases/latest).
2. Extract it to any folder and run `TornTracker.exe`.
3. On the login screen, enter your own **Limited Access** Torn API key.
   - To create a key: Torn → Preferences → API Keys → Add new key → choose **Limited Access**.
   - The "Limited API key oluştur →" link on the login screen opens this page with the fields already filled in.

> 🔒 Your API key is stored only in `data/config.json` next to the app on your own computer, and it is sent only to `api.torn.com` (and to `ffscouter.com` for war estimates). Use **Settings → Çıkış Yap** to remove the key.

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
