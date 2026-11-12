// Official Item receive (4103) supplies quantities that notification text can omit.
const crypto = require('node:crypto');
const { TornError } = require('./torn-client');
function normalizeLogs(payload) {
  if (!payload || !Array.isArray(payload.log) || payload.log.length > 100) throw new TornError('ITEM_LOG_SCHEMA');
  return payload.log;
}
function parseItemLog(log, now) {
  if (!log || typeof log.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(log.id) || !Number.isSafeInteger(log.timestamp) || log.timestamp <= 0 || log.timestamp > now + 60) throw new TornError('ITEM_LOG_SCHEMA');
  if (log.details?.id !== 4103) throw new TornError('ITEM_LOG_TYPE');
  if (!Array.isArray(log.data?.items) || !log.data.items.some((item) => item?.id === 206)) return null;
  const senderId = log.data?.sender, items = log.data?.items;
  if (!Number.isSafeInteger(senderId) || senderId <= 0 || !Array.isArray(items) || !items.length || items.length > 1000) throw new TornError('ITEM_LOG_SCHEMA');
  let quantity = 0;
  for (const item of items) {
    if (!Number.isSafeInteger(item.id) || item.id <= 0 || !Number.isSafeInteger(item.qty) || item.qty <= 0) throw new TornError('ITEM_LOG_SCHEMA');
    if (item.id === 206) quantity += item.qty;
  }
  if (!quantity) return null;
  if (!Number.isSafeInteger(quantity) || quantity > 1_000_000) throw new TornError('ITEM_LOG_QUANTITY');
  return { eventId: 'log_' + log.id, logId: log.id, timestamp: log.timestamp, senderId, itemId: 206, itemName: 'Xanax', quantity,
    verified: true, status: 'verified', reason: null, text: '',
    payloadHash: crypto.createHash('sha256').update(JSON.stringify([log.id, log.timestamp, senderId, 206, quantity])).digest('hex') };
}
async function collectItemLogs(store, client, key, checkpoint, now, owner, maxPages = 10) {
  const saved = store.db.prepare('SELECT value FROM premium_metadata WHERE key=?').get('item-log-watermark');
  const unresolved = store.db.prepare("SELECT min(event_timestamp) AS at FROM premium_transactions WHERE source='torn-v2-events' AND parsed_verified=0 AND status='review'").get().at;
  const baseline = checkpoint.baseline_at ?? now;
  let from = Math.max(baseline + 1, Number(saved?.value || baseline) - 120);
  if (!saved && unresolved != null && unresolved > baseline) from = Math.min(from, unresolved);
  let params = { from }, covered = false;
  const logs = [], seen = new Set();
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    if (!store.acquireLease(owner)) throw new TornError('LEASE_LOST');
    const response = await client.itemLogs(key, params), page = normalizeLogs(response);
    let previous = Infinity;
    for (const log of page) {
      if (log.timestamp > previous) throw new TornError('ITEM_LOG_ORDER');
      previous = log.timestamp;
      if (!seen.has(log.id)) { const parsed = parseItemLog(log, now); if (parsed) logs.push(parsed); seen.add(log.id); }
    }
    if (!page.length) { covered = true; break; }
    if (!response?._metadata?.links || !Object.hasOwn(response._metadata.links, 'prev')) throw new TornError('ITEM_LOG_PAGINATION');
    const link = response._metadata.links.prev;
    if (link === null) { covered = true; break; }
    let url; try { url = new URL(link); } catch { throw new TornError('ITEM_LOG_PAGINATION'); }
    const cursor = url.searchParams.get('nanostamp');
    if (url.origin !== 'https://api.torn.com' || url.pathname !== '/v2/user/log' || url.username || url.password || url.hash || !/^\d{10,25}$/.test(cursor || '') || params.nanostamp && BigInt(cursor) >= BigInt(params.nanostamp)) throw new TornError('ITEM_LOG_PAGINATION');
    params = { from, nanostamp: cursor };
  }
  if (!covered) throw new TornError('ITEM_LOG_HISTORY_GAP');
  return logs;
}
module.exports = { parseItemLog, normalizeLogs, collectItemLogs };
