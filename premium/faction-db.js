const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const LATEST_VERSION = 2;

function openFactionDatabase(filename, { mode = 'test', now = () => Math.floor(Date.now() / 1000) } = {}) {
  if (!['test', 'live'].includes(mode)) throw new Error('Invalid faction hub mode');
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);

  function assertCompatible() {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='faction_hub_metadata'").get()) {
      const saved = db.prepare("SELECT value FROM faction_hub_metadata WHERE key='mode'").get();
      if (saved && saved.value !== mode) throw new Error('Test and live faction hub databases must be separate');
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='faction_hub_migrations'").get()) {
      const latest = db.prepare('SELECT max(version) AS version FROM faction_hub_migrations').get();
      if (latest && latest.version > LATEST_VERSION) throw new Error('Faction hub database requires a newer service version');
    }
  }

  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  };

  try {
    db.exec('PRAGMA busy_timeout=5000');
    assertCompatible();
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    transaction(() => {
      assertCompatible();
      db.exec('CREATE TABLE IF NOT EXISTS faction_hub_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
      for (const [version, file] of [[1, '001-faction-hub.sql'], [2, '002-erasure-retention.sql']]) {
        if (!db.prepare('SELECT 1 FROM faction_hub_migrations WHERE version=?').get(version)) {
          db.exec(fs.readFileSync(path.join(__dirname, 'migrations-faction', file), 'utf8'));
          db.prepare('INSERT INTO faction_hub_migrations VALUES(?,?)').run(version, now());
        }
      }
      const storedMode = db.prepare("SELECT value FROM faction_hub_metadata WHERE key='mode'").get();
      if (storedMode && storedMode.value !== mode) throw new Error('Test and live faction hub databases must be separate');
      db.prepare("INSERT OR IGNORE INTO faction_hub_metadata VALUES('mode',?)").run(mode);
    });
  } catch (error) {
    db.close();
    throw error;
  }

  return { db, transaction, mode, now, close: () => db.close() };
}

module.exports = { openFactionDatabase, LATEST_VERSION };
