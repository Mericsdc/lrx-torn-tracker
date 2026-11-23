const path = require('node:path');
const { serviceUrl } = require('../src/server/premium-url');
const bool = (value) => value === '1' || value === 'true';
// Fixed, publicly known secret for synthetic test installations only. A per-process random secret would make
// stored faction keys unreadable after every restart. The faction hub refuses this value in live mode.
const TEST_FACTION_KEY_SECRET = 'lrx-faction-hub-fixed-test-mode-secret-never-use-live';
function readConfig(env = process.env) {
  const mode = env.PREMIUM_MODE || 'test';
  if (!['test', 'live'].includes(mode)) throw new Error('PREMIUM_MODE must be test or live');
  const host = env.PREMIUM_HOST || '127.0.0.1';
  if (mode === 'test' && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Test premium service must bind to loopback');
  const port = Number(env.PREMIUM_PORT || 3740);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('PREMIUM_PORT is invalid');
  const receiverId = Number(env.PREMIUM_RECEIVER_TORN_ID || 4037017);
  if (!Number.isSafeInteger(receiverId) || receiverId <= 0) throw new Error('PREMIUM_RECEIVER_TORN_ID is invalid');
  const adminIds = new Set(String(env.PREMIUM_ADMIN_TORN_IDS || receiverId).split(',').map((id) => Number(id.trim())));
  if ([...adminIds].some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error('PREMIUM_ADMIN_TORN_IDS is invalid');
  const publicUrl = env.PREMIUM_PUBLIC_URL ? serviceUrl(env.PREMIUM_PUBLIC_URL).href.replace(/\/$/, '') : '';
  const testAuthToken = env.PREMIUM_TEST_AUTH_TOKEN || '';
  if (testAuthToken && (testAuthToken.length < 32 || /replace|change.?me/i.test(testAuthToken))) throw new Error('Configure a random PREMIUM_TEST_AUTH_TOKEN of at least 32 characters');
  const reviewRetentionDays = Number(env.PREMIUM_REVIEW_RETENTION_DAYS || 30);
  if (!Number.isSafeInteger(reviewRetentionDays) || reviewRetentionDays < 1 || reviewRetentionDays > 90) throw new Error('Review retention must be 1 to 90 days');
  const dbPath = env.PREMIUM_DB_PATH === ':memory:' ? ':memory:' : path.resolve(env.PREMIUM_DB_PATH || path.join(__dirname, '..', 'data', 'premium-' + mode + '.sqlite'));
  return {
    mode, host, port, receiverId, adminIds, publicUrl, testAuthToken, reviewRetentionDays,
    dbPath,
    // The hub database lives beside the premium database (the persistent state directory in live), never inside a release folder.
    factionDbPath: (env.PREMIUM_FACTION_DB_PATH === ':memory:' || dbPath === ':memory:') ? ':memory:' : path.resolve(env.PREMIUM_FACTION_DB_PATH || path.join(path.dirname(dbPath), 'faction-hub-' + mode + '.sqlite')),
    factionKeySecret: env.PREMIUM_FACTION_KEY_SECRET || (mode === 'test' ? TEST_FACTION_KEY_SECRET : ''),
    receiverKey: env.PREMIUM_RECEIVER_API_KEY || '',
    livePaymentsAllowed: bool(env.PREMIUM_ALLOW_LIVE_PAYMENTS),
    formatVerified: bool(env.PREMIUM_RECEIVER_FORMAT_VERIFIED),
    privacyContact: String(env.PREMIUM_PRIVACY_CONTACT || '').trim(),
    controllerName: String(env.PREMIUM_CONTROLLER_NAME || '').trim(),
    recordRetentionPolicy: String(env.PREMIUM_RECORD_RETENTION_POLICY || '').trim(),
    // Behind the local Cloudflare connector every request comes from loopback; the real client is in CF-Connecting-IP.
    // Trusted only for loopback sockets. Set PREMIUM_TRUST_PROXY=0 to always use the socket address.
    trustProxy: env.PREMIUM_TRUST_PROXY !== '0' && env.PREMIUM_TRUST_PROXY !== 'false',
  };
}
module.exports = { readConfig, TEST_FACTION_KEY_SECRET };
