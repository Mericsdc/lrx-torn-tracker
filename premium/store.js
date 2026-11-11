const crypto = require('node:crypto');
const { openDatabase } = require('./database');
const DAY = 86400;
const MAX_GRANT = 36500 * DAY;
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const positiveId = (id) => Number.isSafeInteger(id) && id > 0;

function createStore(filename, options = {}) {
  const database = openDatabase(filename, options);
  const { db, transaction, now, mode } = database;
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const settings = () => one('SELECT * FROM premium_settings WHERE id=1');
  const checkpoint = () => one('SELECT * FROM premium_checkpoint WHERE id=1');
  const audit = (actor, action, target, reason, before, after) => run(
    'INSERT INTO premium_audit_log(actor_torn_id,action,target,reason,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)',
    actor?.tornId ?? null, action, String(target), reason, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), now());
  const assertAdmin = (actor) => { if (!actor?.admin || !positiveId(actor.tornId)) fail('ADMIN_REQUIRED', 403); };
  const reasonFor = (value) => { if (typeof value !== 'string' || value.trim().length < 5 || value.length > 500) fail('REASON_REQUIRED'); return value.trim(); };

  function entitlement(tornId) {
    const permanent = one('SELECT p.* FROM premium_permanent_members p JOIN premium_users u ON u.torn_id=p.torn_id WHERE p.torn_id=?', tornId);
    if (permanent) return { tornId, active: true, permanent: true, status: 'active', startedAt: permanent.created_at, expiresAt: null, remainingDays: null };
    const row = one('SELECT * FROM premium_subscriptions WHERE torn_id=?', tornId);
    const active = !!row && row.status === 'active' && row.expires_at > now();
    return { tornId, active, permanent: false, status: active ? 'active' : row ? 'expired' : 'inactive', startedAt: row?.started_at ?? null, expiresAt: row?.expires_at ?? null, remainingDays: active ? Math.ceil((row.expires_at - now()) / DAY) : 0 };
  }
  function grant(tornId, seconds) {
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > MAX_GRANT) fail('DURATION_REQUIRES_REVIEW');
    const user = one('SELECT * FROM premium_users WHERE torn_id=?', tornId);
    if (!user) fail('IDENTITY_NOT_VERIFIED', 409);
    const previous = one('SELECT * FROM premium_subscriptions WHERE torn_id=?', tornId);
    const active = previous?.status === 'active' && previous.expires_at > now();
    const starts = active ? previous.started_at : now();
    const expires = (active ? previous.expires_at : now()) + seconds;
    if (!Number.isSafeInteger(expires) || expires > 253402300799) fail('DURATION_REQUIRES_REVIEW');
    run(`INSERT INTO premium_subscriptions(user_id,torn_id,status,started_at,expires_at,updated_at) VALUES(?,?,'active',?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET status='active',started_at=excluded.started_at,expires_at=excluded.expires_at,updated_at=excluded.updated_at`, user.id, tornId, starts, expires, now());
  }
  function applyTransaction(row) {
    if (!row.parsed_verified || !['pending_identity', 'review'].includes(row.status)) return false;
    if (!one('SELECT id FROM premium_users WHERE torn_id=?', row.torn_sender_id)) return false;
    const rate = one('SELECT * FROM premium_price_versions WHERE id=?', row.price_version_id);
    if (!rate) fail('PRICE_VERSION_MISSING', 409);
    const seconds = row.quantity * (rate.days_per_xanax * DAY / rate.xanax_price);
    grant(row.torn_sender_id, seconds);
    const debit = run('UPDATE premium_payment_balances SET available_xanax=available_xanax-?,updated_at=? WHERE torn_id=? AND available_xanax>=?', row.quantity, now(), row.torn_sender_id, row.quantity);
    if (Number(debit.changes) !== 1) fail('BALANCE_INVARIANT', 409);
    run("UPDATE premium_transactions SET status='applied',reason=NULL,awarded_seconds=?,premium_days=?,processed_at=? WHERE id=?", seconds, seconds / DAY, now(), row.id);
    audit(null, 'payment.applied', row.event_id, 'Verified receiver event and verified sender identity', null, { tornId: row.torn_sender_id, quantity: row.quantity, seconds, priceVersion: row.price_version_id });
    return true;
  }
  function registerVerifiedUser(tornId) {
    if (!positiveId(tornId)) fail('IDENTITY_INVALID', 401);
    return transaction(() => {
      run('INSERT INTO premium_users(torn_id,verified_at,created_at) VALUES(?,?,?) ON CONFLICT(torn_id) DO UPDATE SET verified_at=excluded.verified_at', tornId, now(), now());
      for (const row of all("SELECT * FROM premium_transactions WHERE torn_sender_id=? AND status='pending_identity' ORDER BY event_timestamp,id", tornId)) applyTransaction(row);
      return one('SELECT * FROM premium_users WHERE torn_id=?', tornId);
    });
  }
  function ingest(parsed, source = 'torn-v2-events', leaseOwner = null) {
    return transaction(() => {
      if (leaseOwner && !ownsLease(leaseOwner)) fail('LEASE_LOST', 409);
      const previous = one('SELECT * FROM premium_transactions WHERE event_id=?', parsed.eventId);
      if (previous) {
        if (previous.payload_hash !== parsed.payloadHash) {
          recordError('EVENT_ID_CHANGED');
          return { status: 'conflict', id: previous.id };
        }
        return { status: 'duplicate', id: previous.id };
      }
      if (parsed.status === 'ignored') return { status: 'ignored' };
      const cutoff = checkpoint().baseline_at;
      if (cutoff == null) fail('CHECKPOINT_REQUIRED', 409);
      if (parsed.timestamp <= cutoff) return { status: 'baseline' };
      const cfg = settings();
      const rate = one('SELECT * FROM premium_price_versions WHERE effective_at<=? ORDER BY effective_at DESC,id DESC LIMIT 1', parsed.timestamp);
      if (!rate) fail('PRICE_VERSION_MISSING', 409);
      let status = parsed.verified ? 'pending_identity' : parsed.status;
      let reason = parsed.reason;
      const seconds = parsed.verified ? parsed.quantity * (rate.days_per_xanax * DAY / rate.xanax_price) : 0;
      if (parsed.verified && (seconds > MAX_GRANT || parsed.senderId === cfg.payment_receiver_torn_id)) {
        status = 'review'; reason = seconds > MAX_GRANT ? 'duration_requires_review' : 'self_transfer';
      }
      const inserted = run(`INSERT INTO premium_transactions(event_id,source,receiver_torn_id,torn_sender_id,item_id,item_name,quantity,premium_days,price_version_id,status,reason,event_timestamp,observed_at,payload_hash,event_text,parsed_verified)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, parsed.eventId, source, cfg.payment_receiver_torn_id, parsed.senderId, parsed.itemId, parsed.itemName, parsed.quantity, seconds / DAY, rate.id, status, reason, parsed.timestamp, now(), parsed.payloadHash, parsed.verified ? '' : parsed.text, parsed.verified ? 1 : 0);
      const id = Number(inserted.lastInsertRowid);
      if (parsed.verified) run(`INSERT INTO premium_payment_balances(torn_id,available_xanax,total_received,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(torn_id) DO UPDATE SET available_xanax=available_xanax+excluded.available_xanax,total_received=total_received+excluded.total_received,updated_at=excluded.updated_at`, parsed.senderId, parsed.quantity, parsed.quantity, now());
      if (status === 'pending_identity') applyTransaction(one('SELECT * FROM premium_transactions WHERE id=?', id));
      return { id, status: one('SELECT status FROM premium_transactions WHERE id=?', id).status };
    });
  }
  function historyFor(tornId, limit = 100) {
    return all(`SELECT event_id AS eventId,item_id AS itemId,item_name AS itemName,quantity,premium_days AS premiumDays,status,reason,event_timestamp AS eventTimestamp,processed_at AS processedAt,price_version_id AS priceVersion
      FROM premium_transactions WHERE torn_sender_id=? ORDER BY event_timestamp DESC,id DESC LIMIT ?`, tornId, Math.min(100, limit));
  }
  function updateSettings(actor, body) {
    assertAdmin(actor);
    const reason = reasonFor(body.reason);
    const allowed = new Set(['revision', 'xanax_price', 'days_per_xanax', 'check_interval', 'enabled', 'reason']);
    if (Object.keys(body).some((key) => !allowed.has(key))) fail('UNKNOWN_SETTING');
    return transaction(() => {
      const previous = settings();
      if (body.revision !== previous.revision) fail('SETTINGS_CHANGED', 409);
      const next = { ...previous };
      for (const key of ['xanax_price', 'days_per_xanax', 'check_interval']) if (body[key] != null) next[key] = body[key];
      if (!Number.isSafeInteger(next.xanax_price) || next.xanax_price < 1 || next.xanax_price > 1000 || !Number.isSafeInteger(next.days_per_xanax) || next.days_per_xanax < 1 || next.days_per_xanax > 3650 || next.days_per_xanax * DAY % next.xanax_price !== 0) fail('INVALID_PRICE');
      if (!Number.isSafeInteger(next.check_interval) || next.check_interval < 60 || next.check_interval > 3600) fail('INVALID_INTERVAL');
      if (body.enabled != null && typeof body.enabled !== 'boolean') fail('INVALID_ENABLED');
      next.enabled = body.enabled == null ? previous.enabled : body.enabled ? 1 : 0;
      if (next.xanax_price !== previous.xanax_price || next.days_per_xanax !== previous.days_per_xanax) run('INSERT INTO premium_price_versions(effective_at,xanax_price,days_per_xanax,created_by,created_at) VALUES(?,?,?,?,?)', now() + 1, next.xanax_price, next.days_per_xanax, actor.tornId, now());
      run('UPDATE premium_settings SET xanax_price=?,days_per_xanax=?,check_interval=?,enabled=?,revision=revision+1,updated_at=? WHERE id=1', next.xanax_price, next.days_per_xanax, next.check_interval, next.enabled, now());
      audit(actor, 'settings.update', 'premium_settings', reason, previous, settings());
      return settings();
    });
  }
  function adjustSubscription(actor, body) {
    assertAdmin(actor);
    const reason = reasonFor(body.reason);
    if (!positiveId(body.torn_id) || !Number.isSafeInteger(body.days) || !body.days || Math.abs(body.days) > 36500) fail('INVALID_ADJUSTMENT');
    if (one('SELECT 1 FROM premium_permanent_members WHERE torn_id=?', body.torn_id)) fail('PERMANENT_MEMBERSHIP_PROTECTED', 409);
    return transaction(() => {
      if (!one('SELECT id FROM premium_users WHERE torn_id=?', body.torn_id)) fail('IDENTITY_NOT_VERIFIED', 409);
      const before = entitlement(body.torn_id);
      if (body.days > 0) grant(body.torn_id, body.days * DAY);
      else {
        if (!before.expiresAt) fail('NO_SUBSCRIPTION', 409);
        const expires = Math.max(now(), before.expiresAt + body.days * DAY);
        run('UPDATE premium_subscriptions SET expires_at=?,status=?,updated_at=? WHERE torn_id=?', expires, expires > now() ? 'active' : 'expired', now(), body.torn_id);
      }
      const after = entitlement(body.torn_id);
      audit(actor, 'subscription.adjust', body.torn_id, reason, before, after);
      return after;
    });
  }
  function review(actor, id, action, reason) {
    assertAdmin(actor); reason = reasonFor(reason);
    return transaction(() => {
      const row = one('SELECT * FROM premium_transactions WHERE id=?', id);
      if (!row || !['review', 'pending_identity'].includes(row.status)) fail('NOT_REVIEWABLE', 409);
      if (action === 'retry') {
        if (!row.parsed_verified || row.reason === 'self_transfer') fail('TRANSFER_NOT_VERIFIED', 409);
        if (!applyTransaction(row)) fail('IDENTITY_NOT_VERIFIED', 409);
      } else if (action === 'reject') {
        if (row.parsed_verified) run('UPDATE premium_payment_balances SET available_xanax=available_xanax-?,updated_at=? WHERE torn_id=?', row.quantity, now(), row.torn_sender_id);
        run("UPDATE premium_transactions SET status='rejected',reason=?,processed_at=? WHERE id=?", reason, now(), id);
      } else fail('INVALID_REVIEW_ACTION');
      const after = one('SELECT * FROM premium_transactions WHERE id=?', id);
      audit(actor, 'transaction.' + action, row.event_id, reason, { status: row.status }, { status: after.status });
      return { id, status: after.status };
    });
  }
  function acquireLease(owner, ttl = 90) {
    return transaction(() => {
      run(`INSERT INTO premium_worker_leases(name,owner,expires_at) VALUES('payments',?,?)
        ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE premium_worker_leases.expires_at<=? OR premium_worker_leases.owner=?`, owner, now() + ttl, now(), owner);
      return ownsLease(owner);
    });
  }
  function ownsLease(owner) { return !!one("SELECT 1 FROM premium_worker_leases WHERE name='payments' AND owner=? AND expires_at>?", owner, now()); }
  function releaseLease(owner) { run("DELETE FROM premium_worker_leases WHERE name='payments' AND owner=?", owner); }
  function checkpointUpdate(owner, values) {
    return transaction(() => {
      if (!ownsLease(owner)) fail('LEASE_LOST', 409);
      const allowed = new Set(['baseline_at', 'watermark_at', 'anchor_event_id', 'last_checked_at', 'last_success_at', 'next_check_at', 'consecutive_failures', 'last_error_code', 'gap_detected']);
      for (const [key, value] of Object.entries(values)) {
        if (!allowed.has(key)) fail('INVALID_CHECKPOINT');
        run(`UPDATE premium_checkpoint SET ${key}=? WHERE id=1`, value);
      }
    });
  }
  function recordError(code) { run('INSERT INTO premium_system_errors(code,created_at) VALUES(?,?)', String(code).replace(/[^A-Z0-9_]/g, '_').slice(0, 80), now()); }
  function apiBudget(key, maximum = 30) {
    return transaction(() => {
      const digest = crypto.createHash('sha256').update(key).digest('hex');
      const row = one('SELECT * FROM premium_api_budget WHERE key_hash=?', digest);
      if (row && row.window_start + 60 > now() && row.requests >= maximum) return row.window_start + 60 - now();
      if (!row || row.window_start + 60 <= now()) run('INSERT INTO premium_api_budget VALUES(?,?,1) ON CONFLICT(key_hash) DO UPDATE SET window_start=excluded.window_start,requests=1', digest, now());
      else run('UPDATE premium_api_budget SET requests=requests+1 WHERE key_hash=?', digest);
      return 0;
    });
  }
  function rebaseline(actor, reason) {
    assertAdmin(actor); reason = reasonFor(reason);
    return transaction(() => {
      if (one("SELECT 1 FROM premium_worker_leases WHERE name='payments' AND expires_at>?", now())) fail('PAYMENT_CHECK_IN_PROGRESS', 409);
      const before = checkpoint();
      run('UPDATE premium_checkpoint SET baseline_at=NULL,watermark_at=NULL,anchor_event_id=NULL,gap_detected=0,next_check_at=0 WHERE id=1');
      audit(actor, 'checkpoint.rebaseline', 'payments', reason, before, checkpoint());
    });
  }
  function requestErasure(actor) {
    return transaction(() => {
      run("INSERT OR IGNORE INTO premium_privacy_requests(torn_id,requested_at,updated_at) VALUES(?,?,?)", actor.tornId, now(), now());
      const row = one("SELECT id,status,requested_at FROM premium_privacy_requests WHERE torn_id=? AND status='pending'", actor.tornId);
      audit(actor, 'privacy.erasure_requested', actor.tornId, 'Verified account requested erasure assessment', null, { requestId: row.id });
      return row;
    });
  }
  function exportData(tornId) {
    return { exportedAt: now(), mode, account: one('SELECT torn_id,verified_at,created_at FROM premium_users WHERE torn_id=?', tornId),
      subscription: entitlement(tornId), balance: one('SELECT * FROM premium_payment_balances WHERE torn_id=?', tornId) || null,
      transactions: all('SELECT event_id,item_id,item_name,quantity,premium_days,status,reason,event_timestamp,processed_at,price_version_id FROM premium_transactions WHERE torn_sender_id=? ORDER BY id', tornId),
      privacyRequests: all('SELECT id,requested_at,status,updated_at,resolution FROM premium_privacy_requests WHERE torn_id=? ORDER BY id', tornId) };
  }
  function members(body = {}) {
    const search = String(body.search || '').trim().slice(0, 60), filter = body.filter || 'all';
    if (!['all', 'active', 'expired', 'inactive', 'permanent'].includes(filter)) fail('INVALID_MEMBER_FILTER');
    const page = body.page == null ? 1 : body.page, limit = 25;
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail('INVALID_PAGE');
    const base = ' FROM premium_users u LEFT JOIN premium_subscriptions s ON s.user_id=u.id LEFT JOIN premium_permanent_members p ON p.torn_id=u.torn_id';
    const active = "(p.torn_id IS NOT NULL OR (s.status='active' AND s.expires_at>?))";
    let where = ' WHERE 1=1', args = [];
    if (search) { where += ' AND (CAST(u.torn_id AS TEXT) LIKE ? OR (?=1 AND u.torn_id=4037017))'; args.push('%' + search + '%', 'ezlira'.includes(search.toLowerCase()) ? 1 : 0); }
    if (filter === 'active') { where += ' AND ' + active; args.push(now()); }
    if (filter === 'permanent') where += ' AND p.torn_id IS NOT NULL';
    if (filter === 'expired') { where += ' AND p.torn_id IS NULL AND s.expires_at<=?'; args.push(now()); }
    if (filter === 'inactive') where += ' AND p.torn_id IS NULL AND s.user_id IS NULL';
    const total = one('SELECT count(*) AS n' + base + where, ...args).n;
    const rows = all('SELECT u.torn_id,u.created_at' + base + where + ' ORDER BY (p.torn_id IS NOT NULL) DESC,u.id DESC LIMIT ? OFFSET ?', ...args, limit, (page - 1) * limit);
    const counts = one('SELECT count(*) AS total, sum(CASE WHEN ' + active + ' THEN 1 ELSE 0 END) AS active, sum(CASE WHEN p.torn_id IS NOT NULL THEN 1 ELSE 0 END) AS permanent' + base, now());
    return { members: rows.map((row) => ({ ...entitlement(row.torn_id), name: row.torn_id === 4037017 ? 'Ezlira' : mode === 'test' && row.torn_id >= 9000000000 ? 'Test player' : 'Torn player', joinedAt: row.created_at })), page, pageSize: limit, total, pages: Math.max(1, Math.ceil(total / limit)), counts: { total: counts.total, active: counts.active || 0, permanent: counts.permanent || 0 } };
  }
  return {
    db, transaction, mode, now, settings, checkpoint, entitlement, registerVerifiedUser, ingest, historyFor,
    balance: (id) => one('SELECT * FROM premium_payment_balances WHERE torn_id=?', id) || { torn_id: id, available_xanax: 0, total_received: 0 },
    updateSettings, adjustSubscription, review, acquireLease, ownsLease, releaseLease, checkpointUpdate, recordError, apiBudget, rebaseline,
    expire: () => run("UPDATE premium_subscriptions SET status='expired',updated_at=? WHERE status='active' AND expires_at<=?", now(), now()),
    audit, assertAdmin, requestErasure, exportData, members, close: database.close,
    maintenance: (reviewDays = 30) => transaction(() => {
      run("UPDATE premium_transactions SET event_text='' WHERE event_text<>'' AND observed_at<?", now() - reviewDays * DAY);
      run('DELETE FROM premium_sessions WHERE expires_at<=? OR revoked=1', now());
      run('DELETE FROM premium_api_budget WHERE window_start<?', now() - DAY);
      run('DELETE FROM premium_metadata WHERE key LIKE ? AND CAST(value AS INTEGER)<?', 'invalid-key:%', now());
      run('DELETE FROM premium_test_batches WHERE consumed_at IS NOT NULL AND consumed_at<?', now() - DAY);
      run('DELETE FROM premium_system_errors WHERE created_at<?', now() - 30 * DAY);
      run('DELETE FROM premium_feature_observations WHERE recorded_at<?', now() - 730 * DAY);
    }),
    adminData: () => ({ settings: settings(), checkpoint: checkpoint(), memberSummary: members(), users: members().members, testScenarios: all('SELECT * FROM premium_test_scenarios ORDER BY created_at DESC,rowid DESC LIMIT 20'), transactions: all('SELECT * FROM premium_transactions ORDER BY id DESC LIMIT 200'), errors: all('SELECT * FROM premium_system_errors ORDER BY id DESC LIMIT 100'), audit: all('SELECT * FROM premium_audit_log ORDER BY id DESC LIMIT 100'), privacyRequests: all('SELECT * FROM premium_privacy_requests ORDER BY id DESC LIMIT 100') }),
  };
}
module.exports = { createStore, DAY, MAX_GRANT, fail, positiveId };
