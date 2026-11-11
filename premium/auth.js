const crypto = require('node:crypto');
const { fail, positiveId } = require('./store');
const digest = (token) => crypto.createHash('sha256').update(token).digest('hex');
function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || b.length < 32) return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function createAuth(store, client, config) {
  function issue(tornId) {
    const user = store.registerVerifiedUser(tornId);
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = store.now() + 86400;
    store.db.prepare('INSERT INTO premium_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(digest(token), user.id, store.now(), expiresAt);
    return { token, tornId, expiresAt, mode: config.mode, admin: config.adminIds.has(tornId) };
  }
  async function login(key) {
    if (config.mode !== 'live') fail('TEST_MODE_USE_TEST_LOGIN', 409);
    if (!config.controllerName || !config.privacyContact || !config.publicUrl || !config.recordRetentionPolicy) fail('PRIVACY_NOTICE_NOT_CONFIGURED', 503);
    const identity = await client.identity(key);
    try { await client.profile?.(key, identity.tornId); } catch { /* A profile outage must not block verified identity. */ }
    return issue(identity.tornId);
  }
  function loginTest(secret, tornId) {
    if (config.mode !== 'test' || !equalSecret(secret, config.testAuthToken)) fail('TEST_AUTH_DENIED', 403);
    if (!positiveId(tornId)) fail('IDENTITY_INVALID', 400);
    return issue(tornId);
  }
  function authenticate(authorization) {
    const match = String(authorization || '').match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    if (!match) fail('AUTH_REQUIRED', 401);
    const session = store.db.prepare(`SELECT s.expires_at,u.id AS user_id,u.torn_id FROM premium_sessions s JOIN premium_users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>?`).get(digest(match[1]), store.now());
    if (!session) fail('SESSION_EXPIRED', 401);
    return { userId: session.user_id, tornId: session.torn_id, admin: config.adminIds.has(session.torn_id), expiresAt: session.expires_at, mode: config.mode };
  }
  function logout(authorization) {
    authenticate(authorization);
    const token = authorization.slice(7);
    store.db.prepare('UPDATE premium_sessions SET revoked=1 WHERE token_hash=?').run(digest(token));
  }
  return { login, loginTest, authenticate, logout };
}
module.exports = { createAuth, equalSecret };
