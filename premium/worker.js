const crypto = require('node:crypto');
const { normalizeEvents, parseEvent } = require('./parser');
const { TornError } = require('./torn-client');

function liveGate(config) {
  if (config.mode === 'test') return { allowed: true, livePayments: false, reason: 'TEST_MODE' };
  if (!config.livePaymentsAllowed) return { allowed: false, livePayments: false, reason: 'LIVE_PAYMENTS_DISABLED' };
  if (!config.approvalReference) return { allowed: false, livePayments: false, reason: 'TORN_APPROVAL_REQUIRED' };
  if (!config.formatVerified) return { allowed: false, livePayments: false, reason: 'RECEIVER_FORMAT_VALIDATION_REQUIRED' };
  if (!config.receiverKey) return { allowed: false, livePayments: false, reason: 'RECEIVER_KEY_REQUIRED' };
  if (!config.controllerName || !config.privacyContact || !config.publicUrl || !config.recordRetentionPolicy) return { allowed: false, livePayments: false, reason: 'PRIVACY_NOTICE_NOT_CONFIGURED' };
  return { allowed: true, livePayments: true, reason: null };
}
function createWorker(store, client, config, { random = Math.random, maxPages = 10 } = {}) {
  const owner = crypto.randomBytes(18).toString('hex');
  let inFlight = null, timer = null, stopped = true;
  const gate = () => liveGate(config);

  async function collectLive(checkpoint) {
    const identity = await client.identity(config.receiverKey);
    if (identity.tornId !== store.settings().payment_receiver_torn_id) throw new TornError('RECEIVER_ID_MISMATCH', { retryable: false });
    if (!identity.selections.includes('events')) throw new TornError('EVENTS_PERMISSION_REQUIRED', { retryable: false });
    const serverTime = await client.timestamp(config.receiverKey);
    const events = [], seen = new Set();
    let params = {}, newest = null, covered = checkpoint.baseline_at == null;
    for (let count = 0; count < maxPages; count++) {
      if (!store.acquireLease(owner)) throw new TornError('LEASE_LOST');
      const response = await client.page(config.receiverKey, params);
      const page = normalizeEvents(response);
      if (!page.length) { covered = !checkpoint.anchor_event_id; break; }
      let previousTimestamp = params.to ?? Infinity;
      for (const event of page) {
        if (!Number.isSafeInteger(event.timestamp) || event.timestamp > previousTimestamp) throw new TornError('EVENT_ORDER');
        previousTimestamp = event.timestamp;
        if (!newest) newest = event;
        if (event.id === checkpoint.anchor_event_id) covered = true;
        if (!seen.has(event.id)) { events.push(event); seen.add(event.id); }
      }
      if (checkpoint.baseline_at == null) { covered = true; break; }
      // Events have no stable same-second cursor. A full second is ambiguous even
      // if the old anchor happens to be in this page; never guess which IDs are missing.
      if (page.length === 100 && page[0].timestamp === page.at(-1).timestamp) throw new TornError('EVENT_BOUNDARY_SATURATED');
      if (covered || !checkpoint.anchor_event_id && page.at(-1).timestamp <= checkpoint.baseline_at) { covered = true; break; }
      const next = client.previousParams(response, params);
      if (page.length === 100) {
        // Re-read the inclusive oldest second before moving back. Following a
        // timestamp-1 link directly could silently skip other events in that second.
        const boundary = page.at(-1).timestamp;
        if (params.to != null && boundary >= params.to) throw new TornError('PAGINATION_STALLED');
        params = { to: boundary };
      } else if (next) params = next;
      else { covered = !checkpoint.anchor_event_id; break; }
    }
    if (!covered) throw new TornError('EVENT_HISTORY_GAP');
    return { events, newest, serverTime };
  }
  function collectTest(checkpoint) {
    const batches = store.db.prepare('SELECT * FROM premium_test_batches WHERE consumed_at IS NULL ORDER BY id LIMIT 20').all();
    const events = batches.flatMap((batch) => normalizeEvents(JSON.parse(batch.payload)));
    events.sort((a, b) => b.timestamp - a.timestamp);
    // Synthetic batches are explicitly submitted by an operator. Unlike live
    // history, they must not be silently dropped if the first tick is delayed.
    const timestamps = events.map((event) => event.timestamp).filter((value) => Number.isSafeInteger(value) && value > 0);
    const baselineAt = Math.min(store.now() - 1, ...timestamps.map((value) => value - 1));
    return { events, newest: events[0] || null, serverTime: store.now(), baselineAt, batches: batches.map((b) => b.id) };
  }
  async function pollOnce({ force = false, syntheticTest = false } = {}) {
    store.expire();
    store.maintenance(config.reviewRetentionDays || 30);
    const cfg = store.settings(), before = store.checkpoint();
    if (!cfg.enabled && !(config.mode === 'test' && syntheticTest)) return { status: 'disabled' };
    const access = gate();
    if (!access.allowed) return { status: 'blocked', reason: access.reason };
    if (before.gap_detected) return { status: 'blocked', reason: before.last_error_code || 'EVENT_HISTORY_GAP' };
    if (before.next_check_at > store.now() && (!force || before.consecutive_failures > 0)) return { status: 'waiting' };
    if (!store.acquireLease(owner)) return { status: 'busy' };
    try {
      const snapshot = config.mode === 'test' ? collectTest(before) : await collectLive(before);
      if (!store.ownsLease(owner)) throw new TornError('LEASE_LOST');
      if (before.baseline_at == null) {
        store.checkpointUpdate(owner, { baseline_at: snapshot.baselineAt ?? snapshot.serverTime, watermark_at: snapshot.serverTime, anchor_event_id: snapshot.newest?.id || null });
      }
      const parsed = snapshot.events.map((event) => parseEvent(event, snapshot.serverTime + 1));
      let applied = 0;
      for (const event of parsed.toSorted ? parsed.toSorted((a, b) => a.timestamp - b.timestamp) : parsed.sort((a, b) => a.timestamp - b.timestamp)) {
        const result = store.ingest(event, config.mode === 'test' ? 'synthetic-test' : 'torn-v2-events', owner);
        if (result.status === 'conflict') throw new TornError('EVENT_ID_CHANGED');
        if (result.status === 'applied') applied++;
      }
      if (snapshot.batches) store.transaction(() => {
        if (!store.ownsLease(owner)) throw new TornError('LEASE_LOST');
        for (const id of snapshot.batches) store.db.prepare('UPDATE premium_test_batches SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(store.now(), id);
      });
      store.checkpointUpdate(owner, { watermark_at: snapshot.serverTime, anchor_event_id: snapshot.newest?.id || before.anchor_event_id, last_checked_at: store.now(), last_success_at: store.now(), next_check_at: store.now() + cfg.check_interval, consecutive_failures: 0, last_error_code: null, gap_detected: 0 });
      return { status: 'ok', applied, observed: parsed.length };
    } catch (error) {
      const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'PAYMENT_CHECK_FAILED';
      if (store.ownsLease(owner)) {
        const failures = Math.min(20, before.consecutive_failures + 1);
        const gap = ['EVENT_HISTORY_GAP', 'EVENT_BOUNDARY_SATURATED', 'PAGINATION_STALLED', 'EVENT_ORDER', 'EVENT_ID_CHANGED'].includes(code);
        const wait = Math.min(3600, Math.max(error.retryAfter || 0, cfg.check_interval * 2 ** Math.min(failures - 1, 5))) + Math.floor(random() * 5);
        store.checkpointUpdate(owner, { last_checked_at: store.now(), next_check_at: store.now() + wait, consecutive_failures: failures, last_error_code: code, gap_detected: gap ? 1 : 0 });
        if (error.retryable === false) store.transaction(() => {
          store.db.prepare('UPDATE premium_settings SET enabled=0,revision=revision+1,updated_at=? WHERE id=1').run(store.now());
          store.audit(null, 'payments.disabled', 'receiver-key', code, null, { enabled: false });
        });
        store.recordError(code);
      }
      return { status: 'error', code };
    } finally { store.releaseLease(owner); }
  }
  function tick(options) {
    // A synthetic request has its own durable queued batch. Sharing an older
    // poll's result could report success before this request was processed.
    if (inFlight && options?.syntheticTest) {
      return inFlight.catch(() => {}).then(() => tick(options));
    }
    if (inFlight) return inFlight;
    inFlight = pollOnce(options).finally(() => { inFlight = null; });
    return inFlight;
  }
  function start() {
    if (!stopped) return;
    stopped = false;
    const loop = async () => {
      if (stopped) return;
      try { await tick(); } catch { store.recordError('WORKER_FAILED'); }
      if (!stopped) { timer = setTimeout(loop, 1000); timer.unref?.(); }
    };
    loop();
  }
  async function stop() { stopped = true; clearTimeout(timer); if (inFlight) await inFlight; }
  return { tick, start, stop, gate, owner };
}
module.exports = { createWorker, liveGate };
