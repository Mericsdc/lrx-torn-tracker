const { createStore, fail, positiveId } = require('./store');
const { createTornClient } = require('./torn-client');
const { createAuth } = require('./auth');
const { createWorker } = require('./worker');
const { normalizeEvents } = require('./parser');
const crypto = require('node:crypto');
const { createFeatureService } = require('./feature-service');
const { createFactionHub, createUnavailableFactionHub, RETENTION } = require('./faction-hub');
const featureCatalog = require('../public/feature-catalog');

const API_KEY_STORAGE = "Login keys are sent only to Torn to verify their owner and are not stored. A faction collector key is stored only when a faction leader or co-leader connects it to the Shared Faction Hub with explicit consent: it is encrypted at rest (AES-256-GCM), used only to read that faction's member list while the faction has an active plan, and deleted when it is disconnected or its owner requests erasure.";
const FACTION_HUB_RETENTION = { memberObservationsDays: RETENTION.rawDays, travelTransitionsDays: RETENTION.rawDays, activityRollupsDays: RETENTION.rollupDays, alertDeliveryRecordsDays: RETENTION.outboxDays, auditRecordsDays: RETENTION.auditDays };

function createPremiumService(config, dependencies = {}) {
  const store = createStore(dependencies.filename || config.dbPath, { mode: config.mode, receiverId: config.receiverId, now: dependencies.now });
  if (store.settings().payment_receiver_torn_id !== config.receiverId) { store.close(); fail('RECEIVER_DATABASE_MISMATCH', 503); }
  const client = createTornClient(store, { fetchImpl: dependencies.fetchImpl });
  const auth = createAuth(store, client, config);
  const features = createFeatureService(store);
  const worker = createWorker(store, client, config, { random: dependencies.random, maxPages: dependencies.maxPages });
  // The Shared Faction Hub is optional: if it cannot start (no key secret, unreadable database) only the hub is
  // disabled and its routes answer 503 FACTION_HUB_UNAVAILABLE; login and payments keep working.
  let factionHub;
  try {
    factionHub = createFactionHub(config, { ...dependencies, apiBudget: dependencies.apiBudget || store.apiBudget });
  } catch (error) {
    const reason = /^FACTION_[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'FACTION_HUB_START_FAILED';
    try { store.recordError(reason); } catch {}
    factionHub = createUnavailableFactionHub(reason);
  }
  function info() {
    const settings = store.settings(), checkpoint = store.checkpoint();
    const gate = worker.gate();
    return {
      mode: config.mode, receiver: { tornId: config.receiverId, name: config.receiverId === 4037017 ? 'Ezlira' : null },
      pricing: { xanaxPrice: settings.xanax_price, premiumDays: settings.days_per_xanax },
      enabled: !!settings.enabled, livePayments: gate.livePayments && !!settings.enabled,
      paymentBlockReason: gate.reason || (!settings.enabled ? 'PAYMENTS_PAUSED' : null),
      check: { interval: settings.check_interval, lastCheckedAt: checkpoint.last_checked_at, lastSuccessAt: checkpoint.last_success_at, nextCheckAt: checkpoint.next_check_at, error: checkpoint.last_error_code, gapDetected: !!checkpoint.gap_detected },
      privacy: { controller: config.controllerName || 'Local test service', contact: config.privacyContact || null, termsUrl: config.publicUrl ? config.publicUrl + '/terms' : null, storesApiKeys: true, apiKeyStorage: API_KEY_STORAGE, reviewRetentionDays: config.reviewRetentionDays, recordRetentionPolicy: config.recordRetentionPolicy || null, factionHubRetention: FACTION_HUB_RETENTION, purpose: 'Verified account identity, application subscriptions, payment reconciliation and, for factions whose leader or co-leader connects it, the Shared Faction Hub' },
      freeApiAccess: true, premiumBenefits: featureCatalog.premium, featureAccess: features.access(null),
    };
  }
  function me(actor) {
    store.expire();
    return { ...info(), connected: true, account: { ...store.player(actor.tornId), admin: actor.admin, verified: true }, subscription: store.entitlement(actor.tornId), balance: store.balance(actor.tornId), ...(actor.admin ? { receivedTotal: store.receivedTotal() } : {}), transactions: store.historyFor(actor.tornId), featureAccess: features.access(actor) };
  }
  // Personal export and erasure also cover the caller's own Shared Faction Hub records.
  function exportData(actor) {
    return { ...store.exportData(actor.tornId), advancedFeatures: features.exportData(actor), factionHub: factionHub.exportUserData(actor.tornId) };
  }
  function requestErasure(actor) {
    const request = store.requestErasure(actor);
    let hub;
    try { hub = factionHub.eraseUserData(actor.tornId); } catch (error) { hub = { erased: false, code: /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'FACTION_HUB_ERASURE_FAILED' }; }
    return { ...request, factionHub: hub };
  }
  function requirePremium(actor) {
    const entitlement = store.entitlement(actor.tornId);
    if (!entitlement.active) fail('PREMIUM_REQUIRED', 403);
    return entitlement;
  }
  function exportReceipts(actor) {
    // Access to one's own payment/personal data must not depend on an active plan.
    const rows = store.historyFor(actor.tornId);
    const quote = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    return { filename: 'premium-receipts-' + actor.tornId + '.csv', csv: [['mode', 'event_id', 'item', 'quantity', 'premium_days', 'status', 'event_timestamp'], ...rows.map((row) => [config.mode, row.eventId, row.itemName, row.quantity, row.premiumDays, row.status, row.eventTimestamp])].map((row) => row.map(quote).join(',')).join('\r\n') };
  }
  async function adminAction(actor, action, body) {
    store.assertAdmin(actor);
    if (action === 'feature-permission') return features.override(actor, body);
    if (action === 'members') {
      if (config.mode === 'live' && config.receiverKey) {
        for (const member of store.members(body).members.filter((member) => !member.nameCheckedAt || member.nameCheckedAt < store.now() - 21600).slice(0, 2)) {
          try { await client.profile(config.receiverKey, member.tornId); } catch { break; }
        }
      }
      return store.members(body);
    }
    if (action === 'test-payment' || action === 'test-replay') {
      if (config.mode !== 'test') fail('TEST_ENDPOINT_DISABLED', 403);
      let scenario;
      if (action === 'test-replay') {
        scenario = store.db.prepare('SELECT * FROM premium_test_scenarios WHERE event_id=?').get(String(body.event_id || ''));
        if (!scenario) fail('TEST_SCENARIO_NOT_FOUND', 404);
      } else {
        const tornId = body.torn_id ?? (9000000000 + crypto.randomInt(1, 1000000000)), quantity = body.quantity ?? 2;
        if (!Number.isSafeInteger(tornId) || tornId < 9000000000 || tornId > 9999999999 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) fail('INVALID_SYNTHETIC_PAYMENT');
        scenario = { event_id: 'test_' + crypto.randomUUID(), torn_id: tornId, quantity, event_timestamp: store.now(), created_by: actor.tornId, created_at: store.now() };
        store.db.prepare('INSERT INTO premium_test_scenarios VALUES(?,?,?,?,?,?)').run(scenario.event_id, scenario.torn_id, scenario.quantity, scenario.event_timestamp, scenario.created_by, scenario.created_at);
      }
      const appliedBefore = store.db.prepare('SELECT status FROM premium_transactions WHERE event_id=?').get(scenario.event_id)?.status === 'applied';
      store.registerVerifiedUser(scenario.torn_id); // Explicit synthetic identity; unreachable in live mode.
      const before = store.entitlement(scenario.torn_id);
      const event = { id: scenario.event_id, timestamp: scenario.event_timestamp, event: `You were sent ${scenario.quantity}x Xanax from <a href="profiles.php?XID=${scenario.torn_id}">Synthetic test player</a>` };
      store.transaction(() => {
        store.db.prepare('INSERT INTO premium_test_batches(payload,created_at) VALUES(?,?)').run(JSON.stringify({ events: [event] }), store.now());
        store.audit(actor, action === 'test-replay' ? 'test.payment_replayed' : 'test.payment_created', scenario.event_id, 'Administrator requested an in-app synthetic payment test', null, { tornId: scenario.torn_id, quantity: scenario.quantity });
      });
      let run = await worker.tick({ force: true, syntheticTest: true });
      if (run.status === 'disabled') run = await worker.tick({ force: true, syntheticTest: true });
      const after = store.entitlement(scenario.torn_id);
      const payment = store.db.prepare('SELECT status,awarded_seconds FROM premium_transactions WHERE event_id=?').get(scenario.event_id);
      const addedSeconds = payment?.status === 'applied' && !appliedBefore ? payment.awarded_seconds : 0;
      const count = payment ? 1 : 0;
      return { eventId: scenario.event_id, tornId: scenario.torn_id, quantity: scenario.quantity, replay: action === 'test-replay', addedDays: addedSeconds / 86400, before, subscription: after, recordCount: count, processing: run };
    }
    if (action === 'settings') {
      if (body.enabled === true && !worker.gate().allowed) fail(worker.gate().reason, 409);
      const updated = store.updateSettings(actor, body);
      if (body.enabled === true) store.db.prepare('UPDATE premium_checkpoint SET consecutive_failures=0,next_check_at=0 WHERE id=1 AND gap_detected=0').run();
      return updated;
    }
    if (action === 'subscription') return store.adjustSubscription(actor, body);
    if (action === 'review') {
      if (body.action === 'retry' && !worker.gate().allowed) fail(worker.gate().reason, 409);
      if (!positiveId(body.id)) fail('INVALID_TRANSACTION');
      return store.review(actor, body.id, body.action, body.reason);
    }
    if (action === 'check') {
      store.audit(actor, 'worker.check_requested', 'payments', 'Administrator requested a payment check', null, null);
      return worker.tick({ force: true });
    }
    if (action === 'rebaseline') {
      if (body.acknowledgeSkippedTransfers !== true) fail('GAP_ACKNOWLEDGEMENT_REQUIRED');
      store.rebaseline(actor, body.reason);
      return { ok: true };
    }
    if (action === 'test-events') {
      if (config.mode !== 'test') fail('TEST_ENDPOINT_DISABLED', 403);
      const events = normalizeEvents(body);
      if (!events.length) fail('NO_TEST_EVENTS');
      store.transaction(() => {
        store.db.prepare('INSERT INTO premium_test_batches(payload,created_at) VALUES(?,?)').run(JSON.stringify({ events }), store.now());
        store.audit(actor, 'test.events_queued', 'test-mode', 'Administrator submitted synthetic events', null, { count: events.length });
      });
      return { ok: true, queued: events.length };
    }
    fail('NOT_FOUND', 404);
  }
  return { store, auth, worker, factionHub, config, features, info, me, exportData, requestErasure, requirePremium, exportReceipts, adminAction, close: async () => { await worker.stop(); await factionHub.close(); store.close(); } };
}
module.exports = { createPremiumService };
