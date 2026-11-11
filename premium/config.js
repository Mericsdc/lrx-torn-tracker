const path = require('node:path');
const { serviceUrl } = require('../premium-url');
const bool = (value) => value === '1' || value === 'true';
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
  return {
    mode, host, port, receiverId, adminIds, publicUrl, testAuthToken, reviewRetentionDays,
    dbPath: env.PREMIUM_DB_PATH === ':memory:' ? ':memory:' : path.resolve(env.PREMIUM_DB_PATH || path.join(__dirname, '..', 'data', 'premium-' + mode + '.sqlite')),
    receiverKey: env.PREMIUM_RECEIVER_API_KEY || '',
    livePaymentsAllowed: bool(env.PREMIUM_ALLOW_LIVE_PAYMENTS),
    approvalReference: String(env.PREMIUM_TORN_APPROVAL_REFERENCE || '').trim(),
    formatVerified: bool(env.PREMIUM_RECEIVER_FORMAT_VERIFIED),
    privacyContact: String(env.PREMIUM_PRIVACY_CONTACT || '').trim(),
    controllerName: String(env.PREMIUM_CONTROLLER_NAME || '').trim(),
    recordRetentionPolicy: String(env.PREMIUM_RECORD_RETENTION_POLICY || '').trim(),
  };
}
module.exports = { readConfig };
