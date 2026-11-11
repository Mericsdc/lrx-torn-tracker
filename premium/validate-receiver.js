// Explicit operator command: read-only format check, independent of collection.
// It never enables billing, creates a payment checkpoint or retains event text.
const { readConfig } = require('./config');
const { createStore } = require('./store');
const { createTornClient } = require('./torn-client');
const { normalizeEvents, parseEvent } = require('./parser');
const { normalizeLogs, parseItemLog } = require('./payment-logs');

async function validateReceiver(config) {
  const store = createStore(':memory:', { mode: 'test', receiverId: config.receiverId });
  try {
    const client = createTornClient(store);
    const identity = await client.identity(config.receiverKey);
    if (identity.tornId !== config.receiverId) throw new Error('RECEIVER_ID_OR_PERMISSION');
    const now = await client.timestamp(config.receiverKey);
    if (identity.itemLogAccess) {
      const logs = normalizeLogs(await client.itemLogs(config.receiverKey));
      const incoming = logs.map((log) => parseItemLog(log, now)).filter(Boolean);
      return { ownerVerified: true, itemLogAccess: true, sampled: logs.length, verifiedIncoming: incoming.length,
        containsVerifiableSample: incoming.length > 0, billingEnabled: false, rawEventsRetained: false };
    }
    if (!identity.selections.includes('events')) throw new Error('RECEIVER_ID_OR_PERMISSION');
    const events = normalizeEvents(await client.page(config.receiverKey));
    const candidates = events.filter((event) => typeof event.event === 'string' && /\bXanax\b/.test(event.event) && /\b(?:sent|received)\b/.test(event.event));
    const results = candidates.map((event) => parseEvent(event, now));
    return { ownerVerified: true, sampled: events.length, xanaxCandidates: results.length, verifiedIncoming: results.filter((event) => event.verified).length,
      reviewRequired: results.filter((event) => !event.verified && event.status === 'review').length, containsVerifiableSample: results.some((event) => event.verified),
      billingEnabled: false, rawEventsRetained: false };
  } finally { store.close(); }
}
if (require.main === module) validateReceiver(readConfig()).then((result) => console.log(JSON.stringify(result))).catch(() => { console.error('Receiver verification failed. Check the configured owner, Limited events permission and API availability. No billing state was changed.'); process.exitCode = 1; });
module.exports = { validateReceiver };
