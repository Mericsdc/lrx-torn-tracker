const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(filename, { mode = 'test', receiverId = 4037017, now = () => Math.floor(Date.now() / 1000) } = {}) {
  if (!['test', 'live'].includes(mode)) throw new Error('Invalid premium mode');
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  function assertCompatible() {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='premium_metadata'").get()) {
      const saved = db.prepare("SELECT value FROM premium_metadata WHERE key='mode'").get();
      if (saved && saved.value !== mode) throw new Error('Test and live premium databases must be separate');
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='premium_migrations'").get()) {
      const latest = db.prepare('SELECT max(version) AS version FROM premium_migrations').get();
      if (latest.version > 4) throw new Error('Premium database requires a newer service version');
    }
  }
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  try {
    db.exec('PRAGMA busy_timeout=5000');
    assertCompatible();
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    transaction(() => {
    assertCompatible();
    db.exec('CREATE TABLE IF NOT EXISTS premium_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
    for (const [version, file] of [[1, '001-premium.sql'], [2, '002-privacy.sql'], [3, '003-membership-management.sql'], [4, '004-feature-modules.sql']]) {
      if (!db.prepare('SELECT 1 FROM premium_migrations WHERE version=?').get(version)) {
        db.exec(fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8'));
        db.prepare('INSERT INTO premium_migrations VALUES(?,?)').run(version, now());
      }
    }
    const storedMode = db.prepare("SELECT value FROM premium_metadata WHERE key='mode'").get();
    if (storedMode && storedMode.value !== mode) throw new Error('Test and live premium databases must be separate');
    db.prepare("INSERT OR IGNORE INTO premium_metadata VALUES('mode',?)").run(mode);
    db.prepare('INSERT OR IGNORE INTO premium_settings(id,payment_receiver_torn_id,updated_at) VALUES(1,?,?)').run(receiverId, now());
    db.prepare('INSERT OR IGNORE INTO premium_checkpoint(id) VALUES(1)').run();
    const permanent = db.prepare('INSERT OR IGNORE INTO premium_permanent_members(torn_id,reason,created_at) VALUES(4037017,?,?)').run('Ezlira — permanent application membership', now());
    if (Number(permanent.changes)) db.prepare('INSERT INTO premium_audit_log(actor_torn_id,action,target,reason,after_json,created_at) VALUES(NULL,?,?,?,?,?)').run('subscription.permanent', '4037017', 'Owner-requested permanent membership policy', JSON.stringify({ permanent: true }), now());
    if (!db.prepare('SELECT 1 FROM premium_price_versions LIMIT 1').get()) {
      db.prepare('INSERT INTO premium_price_versions(effective_at,xanax_price,days_per_xanax,created_at) VALUES(0,1,15,?)').run(now());
    }
  }); } catch (error) { db.close(); throw error; }
  return { db, transaction, mode, now, close: () => db.close() };
}
module.exports = { openDatabase };
