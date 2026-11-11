const crypto = require('node:crypto');
const catalog = require('../public/feature-catalog');
const { validateParams, analyze } = require('./insights');
const { fail, positiveId } = require('./store');
const CONSENT_VERSION = 1;
function createFeatureService(store) {
  const { db, now, transaction } = store;
  function verified(actor) {
    if (!actor || !positiveId(actor.tornId) || !db.prepare('SELECT 1 FROM premium_users WHERE torn_id=?').get(actor.tornId)) fail('IDENTITY_NOT_VERIFIED', 401);
  }
  function definition(id) { const d = Object.hasOwn(catalog.byId, id || '') && catalog.byId[id]; if (!d) fail('UNKNOWN_FEATURE', 404); return d; }
  function access(actor) {
    const subscription = actor ? store.entitlement(actor.tornId) : { active: false, expiresAt: null };
    const overrides = actor ? Object.fromEntries(db.prepare('SELECT feature_id,allowed FROM premium_feature_overrides WHERE torn_id=?').all(actor.tornId).map((r) => [r.feature_id, !!r.allowed])) : {};
    const permissions = Object.fromEntries(catalog.definitions.map((d) => [d.id, d.tier === 'free' || !!actor && subscription.active && overrides[d.id] !== false]));
    const consent = !!actor && !!db.prepare('SELECT 1 FROM premium_feature_consents WHERE torn_id=? AND version=?').get(actor.tornId, CONSENT_VERSION);
    const automations = consent ? db.prepare('SELECT feature_id,revision,content_json FROM premium_feature_workspaces WHERE torn_id=?').all(actor.tornId).flatMap((row) => {
      if (!permissions[row.feature_id]) return [];
      const w = JSON.parse(row.content_json), p = w.profiles.find((p) => p.id === w.activeProfile);
      return p && (p.params.rule?.enabled || p.params.notifications) ? [{ featureId: row.feature_id, revision: row.revision, profileId: p.id }] : [];
    }) : [];
    return { catalogVersion: catalog.version, serverNow: now(), validUntil: Math.min(now() + 60, actor?.expiresAt || Infinity, subscription.active && !subscription.permanent ? subscription.expiresAt : Infinity), permissions, consent, automations };
  }
  function requireFeature(actor, id) {
    const d = definition(id);
    if (d.tier === 'free') return d;
    verified(actor);
    if (!store.entitlement(actor.tornId).active) fail('PREMIUM_REQUIRED', 403);
    if (db.prepare('SELECT allowed FROM premium_feature_overrides WHERE torn_id=? AND feature_id=?').get(actor.tornId, id)?.allowed === 0) fail('FEATURE_NOT_GRANTED', 403);
    return d;
  }
  function requireConsent(actor) { if (!db.prepare('SELECT 1 FROM premium_feature_consents WHERE torn_id=? AND version=?').get(actor.tornId, CONSENT_VERSION)) fail('FEATURE_DATA_CONSENT_REQUIRED', 403); }
  function workspace(actor, id) {
    verified(actor); definition(id);
    const row = db.prepare('SELECT * FROM premium_feature_workspaces WHERE torn_id=? AND feature_id=?').get(actor.tornId, id);
    return row ? { ...JSON.parse(row.content_json), revision: row.revision, updatedAt: row.updated_at } : { profiles: [], activeProfile: null, revision: 0, updatedAt: null };
  }
  function budget(actor) { if (store.apiBudget('feature-analysis:' + actor.tornId, 60)) fail('FEATURE_RATE_LIMIT', 429); }
  function save(actor, body) {
    requireFeature(actor, body.featureId); requireConsent(actor); budget(actor);
    if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail('INVALID_FEATURE_REVISION');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 60 || /[\u0000-\u001f]/.test(name)) fail('INVALID_PROFILE_NAME');
    const params = validateParams(body.featureId, body.params);
    return transaction(() => {
      const previous = workspace(actor, body.featureId);
      if (body.revision !== previous.revision) fail('FEATURE_PROFILE_CONFLICT', 409);
      let profile;
      if (body.profileId) { profile = previous.profiles.find((p) => p.id === body.profileId); if (!profile) fail('PROFILE_NOT_FOUND', 404); Object.assign(profile, { name, params }); }
      else { if (previous.profiles.length >= 12) fail('PROFILE_LIMIT'); profile = { id: crypto.randomUUID(), name, params }; previous.profiles.push(profile); }
      const content = { profiles: previous.profiles, activeProfile: body.activate === false ? previous.activeProfile : profile.id };
      db.prepare('INSERT INTO premium_feature_workspaces VALUES(?,?,1,?,?) ON CONFLICT(torn_id,feature_id) DO UPDATE SET revision=revision+1,content_json=excluded.content_json,updated_at=excluded.updated_at').run(actor.tornId, body.featureId, JSON.stringify(content), now());
      return { ...workspace(actor, body.featureId), savedId: profile.id };
    });
  }
  function select(actor, body) {
    requireFeature(actor, body.featureId); requireConsent(actor);
    return transaction(() => {
      const w = workspace(actor, body.featureId);
      if (body.revision !== w.revision) fail('FEATURE_PROFILE_CONFLICT', 409);
      if (body.profileId != null && !w.profiles.some((p) => p.id === body.profileId)) fail('PROFILE_NOT_FOUND', 404);
      db.prepare('UPDATE premium_feature_workspaces SET content_json=?,revision=revision+1,updated_at=? WHERE torn_id=? AND feature_id=?').run(JSON.stringify({ profiles: w.profiles, activeProfile: body.profileId ?? null }), now(), actor.tornId, body.featureId);
      return workspace(actor, body.featureId);
    });
  }
  function remove(actor, body) {
    verified(actor); definition(body.featureId);
    return transaction(() => {
      const w = workspace(actor, body.featureId);
      if (body.revision !== w.revision) fail('FEATURE_PROFILE_CONFLICT', 409);
      const profiles = w.profiles.filter((p) => p.id !== body.profileId);
      db.prepare('UPDATE premium_feature_workspaces SET content_json=?,revision=revision+1,updated_at=? WHERE torn_id=? AND feature_id=?').run(JSON.stringify({ profiles, activeProfile: w.activeProfile === body.profileId ? null : w.activeProfile }), now(), actor.tornId, body.featureId);
      return workspace(actor, body.featureId);
    });
  }
  function history(actor, featureId) {
    verified(actor);
    return db.prepare('SELECT series_key,observed_at,recorded_at,content_json FROM premium_feature_observations WHERE torn_id=? AND feature_id=? ORDER BY observed_at,id LIMIT 1000').all(actor.tornId, featureId).map((r) => ({ seriesKey: r.series_key, at: r.observed_at, recordedAt: r.recorded_at, data: JSON.parse(r.content_json) }));
  }
  function run(actor, body) {
    requireFeature(actor, body.featureId); requireConsent(actor); budget(actor);
    const w = workspace(actor, body.featureId), profile = body.profileId ? w.profiles.find((p) => p.id === body.profileId) : null;
    if (body.profileId && !profile) fail('PROFILE_NOT_FOUND', 404);
    const params = validateParams(body.featureId, profile ? profile.params : body.params);
    const previous = history(actor, body.featureId), output = analyze(body.featureId, params, body.input, now(), previous);
    if (body.record === true && output.observations.length) transaction(() => {
      for (const o of output.observations) {
        // A cached snapshot is one point. Sample each series at most every five minutes.
        const last = db.prepare('SELECT max(observed_at) AS at FROM premium_feature_observations WHERE torn_id=? AND feature_id=? AND series_key=?').get(actor.tornId, body.featureId, o.key);
        if (last.at != null && o.at < last.at + 300) continue;
        db.prepare('INSERT OR IGNORE INTO premium_feature_observations(torn_id,feature_id,series_key,observed_at,recorded_at,content_json) VALUES(?,?,?,?,?,?)').run(actor.tornId, body.featureId, o.key, o.at, now(), JSON.stringify(o.data));
      }
      db.prepare('DELETE FROM premium_feature_observations WHERE torn_id=? AND feature_id=? AND (recorded_at<? OR id NOT IN (SELECT id FROM premium_feature_observations WHERE torn_id=? AND feature_id=? ORDER BY recorded_at DESC,id DESC LIMIT 1000))').run(actor.tornId, body.featureId, now() - 730 * 86400, actor.tornId, body.featureId);
    });
    const result = body.record === true && output.observations.length ? analyze(body.featureId, params, body.input, now(), history(actor, body.featureId)).result : output.result;
    return { featureId: body.featureId, params, result, access: access(actor), analyzedAt: now() };
  }
  function consent(actor, body) {
    verified(actor); if (typeof body.accepted !== 'boolean') fail('INVALID_CONSENT');
    transaction(() => {
      if (body.accepted) db.prepare('INSERT INTO premium_feature_consents VALUES(?,?,?) ON CONFLICT(torn_id) DO UPDATE SET accepted_at=excluded.accepted_at,version=excluded.version').run(actor.tornId, now(), CONSENT_VERSION);
      else db.prepare('DELETE FROM premium_feature_consents WHERE torn_id=?').run(actor.tornId);
      store.audit(actor, 'features.consent', actor.tornId, body.accepted ? 'Opted in to storing profiles and selected analysis snapshots' : 'Stopped advanced data sharing; saved profiles retained', null, { version: CONSENT_VERSION, accepted: body.accepted });
    });
    return { access: access(actor) };
  }
  function override(actor, body) {
    store.assertAdmin(actor); const d = definition(body.featureId);
    if (d.tier !== 'premium' || !positiveId(body.tornId) || typeof body.allowed !== 'boolean' || typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 500) fail('INVALID_FEATURE_OVERRIDE');
    if (body.tornId === 4037017 && !body.allowed) fail('PERMANENT_MEMBERSHIP_PROTECTED', 409);
    if (!db.prepare('SELECT 1 FROM premium_users WHERE torn_id=?').get(body.tornId)) fail('IDENTITY_NOT_VERIFIED', 409);
    transaction(() => {
      const before = db.prepare('SELECT allowed FROM premium_feature_overrides WHERE torn_id=? AND feature_id=?').get(body.tornId, d.id);
      db.prepare('INSERT INTO premium_feature_overrides VALUES(?,?,?,?) ON CONFLICT(torn_id,feature_id) DO UPDATE SET allowed=excluded.allowed,updated_at=excluded.updated_at').run(body.tornId, d.id, +body.allowed, now());
      store.audit(actor, 'features.permission', body.tornId + ':' + d.id, body.reason.trim(), before || null, { allowed: body.allowed });
    }); return { ok: true };
  }
  function exportData(actor) { verified(actor); return { consent: db.prepare('SELECT accepted_at,version FROM premium_feature_consents WHERE torn_id=?').get(actor.tornId) || null, modules: Object.fromEntries(catalog.premium.map((d) => [d.id, { workspace: workspace(actor, d.id), history: history(actor, d.id) }])) }; }
  return { access, requireFeature, workspace, save, select, remove, run, consent, override, exportData };
}
module.exports = { createFeatureService };
