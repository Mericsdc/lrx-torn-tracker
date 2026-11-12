const crypto = require('node:crypto');
class TornError extends Error {
  constructor(code, { retryable = true, retryAfter = 60 } = {}) {
    super(code); this.code = code; this.retryable = retryable; this.retryAfter = retryAfter;
  }
}
const retrySeconds = (header, now) => {
  const value = /^\d+$/.test(header || '') ? Number(header) : Math.ceil((Date.parse(header || '') / 1000) - now);
  return Math.max(5, Math.min(3600, Number.isFinite(value) ? value : 60));
};
async function limitedJson(response) {
  const chunks = []; let length = 0;
  if (!response.body?.getReader) return response.json();
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 1024 * 1024) { await reader.cancel(); throw new TornError('UPSTREAM_BODY_LIMIT'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new TornError('UPSTREAM_JSON'); }
}
function createTornClient(store, { fetchImpl = fetch } = {}) {
  async function request(pathname, key, params = {}) {
    if (!/^[A-Za-z0-9]{16}$/.test(key || '')) throw new TornError('TORN_KEY_INVALID', { retryable: false });
    const digest = crypto.createHash('sha256').update(key).digest('hex');
    const blocked = store.db.prepare('SELECT value FROM premium_metadata WHERE key=?').get('invalid-key:' + digest);
    if (blocked && Number(blocked.value) > store.now()) throw new TornError('TORN_KEY_BLOCKED', { retryable: false });
    const wait = store.apiBudget(key, 20);
    if (wait) throw new TornError('LOCAL_API_BUDGET', { retryAfter: wait });
    const owner = store.db.prepare('SELECT value FROM premium_metadata WHERE key=?').get('key-owner:' + digest);
    const accountWait = owner ? store.apiBudget('player:' + owner.value, 20) : 0;
    if (accountWait) throw new TornError('LOCAL_API_BUDGET', { retryAfter: accountWait });
    const ipWait = store.apiBudget('service:all-keys', 2000);
    if (ipWait) throw new TornError('LOCAL_API_BUDGET', { retryAfter: ipWait });
    const allowed = new Set(['/v2/key/info', '/v2/user/events', '/v2/user/timestamp']);
    if (!allowed.has(pathname) && !/^\/v2\/user\/[1-9]\d{0,9}\/basic$/.test(pathname) && pathname !== '/v2/user/log') throw new TornError('UPSTREAM_PATH', { retryable: false });
    const url = new URL(pathname, 'https://api.torn.com');
    url.searchParams.set('comment', 'LRXPremium');
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    let response;
    try {
      response = await fetchImpl(url.toString(), { headers: { Authorization: 'ApiKey ' + key, 'User-Agent': 'LRX-TornTracker-Premium/1.0' }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    } catch { throw new TornError('UPSTREAM_NETWORK'); }
    if (response.status === 429) throw new TornError('UPSTREAM_RATE_LIMIT', { retryAfter: retrySeconds(response.headers.get('retry-after'), store.now()) });
    // Torn reports key problems as JSON error codes; an HTTP error page (e.g. a CDN 403) is transient
    if (!response.ok) throw new TornError('UPSTREAM_HTTP_' + response.status);
    const data = await limitedJson(response);
    if (data?.error) {
      const code = Number(data.error.code);
      const fatal = [1, 2, 10, 13, 16, 18].includes(code);
      if (fatal) store.db.prepare('INSERT INTO premium_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('invalid-key:' + digest, String(store.now() + 600));
      throw new TornError('TORN_' + (Number.isSafeInteger(code) ? code : 'ERROR'), { retryable: !fatal, retryAfter: [5, 8].includes(code) ? 120 : 60 });
    }
    return data;
  }
  async function identity(key) {
    const data = await request('/v2/key/info', key);
    const id = data?.info?.user?.id;
    if (!Number.isSafeInteger(id) || id <= 0) throw new TornError('IDENTITY_SCHEMA');
    const digest = crypto.createHash('sha256').update(key).digest('hex');
    const existing = store.db.prepare('SELECT value FROM premium_metadata WHERE key=?').get('key-owner:' + digest);
    if (!existing) {
      const wait = store.apiBudget('player:' + id, 20);
      if (wait) throw new TornError('LOCAL_API_BUDGET', { retryAfter: wait });
    }
    store.db.prepare('INSERT INTO premium_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('key-owner:' + digest, String(id));
    const available = data.info.access?.log?.available || [];
    return { tornId: id, selections: data.info.selections?.user || [], itemLogAccess: (data.info.selections?.user || []).includes('log') || available.some((entry) => entry.log_ids?.includes(4103)) };
  }
  async function profile(key, id) {
    if (!Number.isSafeInteger(id) || id <= 0 || id > 9999999999) throw new TornError('PROFILE_ID', { retryable: false });
    const cached = store.player(id);
    if (cached.nameCheckedAt && cached.nameCheckedAt > store.now() - 21600) return cached;
    const data = await request('/v2/user/' + id + '/basic', key);
    if (data?.profile?.id !== id || typeof data.profile.name !== 'string' || !data.profile.name.trim()) throw new TornError('PROFILE_SCHEMA');
    return store.cachePlayerName(id, data.profile.name);
  }
  async function timestamp(key) {
    const data = await request('/v2/user/timestamp', key);
    if (!Number.isSafeInteger(data?.timestamp) || data.timestamp <= 0) throw new TornError('TIMESTAMP_SCHEMA');
    return data.timestamp;
  }
  function page(key, params = {}) { return request('/v2/user/events', key, { limit: 100, striptags: false, ...params }); }
  function itemLogs(key, params = {}) { return request('/v2/user/log', key, { log: 4103, limit: 100, ...params }); }
  function previousParams(data, current) {
    if (!data?._metadata?.links || !Object.hasOwn(data._metadata.links, 'prev')) throw new TornError('PAGINATION_SCHEMA');
    const link = data._metadata.links.prev;
    if (link === null) return null;
    if (typeof link !== 'string') throw new TornError('PAGINATION_SCHEMA');
    let url;
    try { url = new URL(link); } catch { throw new TornError('PAGINATION_LINK'); }
    if (url.origin !== 'https://api.torn.com' || url.pathname !== '/v2/user/events' || url.username || url.password || url.hash) throw new TornError('PAGINATION_LINK');
    const to = url.searchParams.get('to');
    if (!/^\d+$/.test(to || '') || !Number.isSafeInteger(Number(to)) || current.to != null && Number(to) >= current.to) throw new TornError('PAGINATION_STALLED');
    return { to: Number(to) };
  }
  return { request, identity, timestamp, page, previousParams, profile, itemLogs };
}
module.exports = { createTornClient, TornError, retrySeconds };
