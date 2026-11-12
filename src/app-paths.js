'use strict';
// Paths and message language shared by the Electron main process (src/main) and the local server (src/server).
const fs = require('node:fs');
const path = require('node:path');

/** The application folder (resources/app): package.json, public/, assets/, torn-helpers/, userscripts/ ... */
const APP_ROOT = path.join(__dirname, '..');

/** Folder holding config.json. electron-main sets TORN_DATA_DIR before it loads the other modules. */
const dataDir = () => process.env.TORN_DATA_DIR || path.join(APP_ROOT, 'data');

/** User-facing text: English by default, Turkish when the app language is set to TR. */
function T(trStr, enStr) {
  let lang = 'en';
  try { lang = JSON.parse(fs.readFileSync(path.join(dataDir(), 'config.json'), 'utf8')).lang; } catch {}
  return lang === 'tr' ? trStr : enStr;
}

module.exports = { APP_ROOT, dataDir, T };
