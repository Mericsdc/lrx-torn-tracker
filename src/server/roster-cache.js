/* Shared Faction Roster Cache & In-Flight Deduplication (P0.1).
   Ensures Activity, Travel Radar, OC, and Report share one Torn roster fetch
   (2-minute TTL), never advance observedAt on cache reads, mark snapshots stale
   after 5 minutes, isolate account/faction switches cleanly, wipe private cache
   on auth/permission revocation, and fall back to stale cache ONLY on transient
   upstream errors within the same session and faction scope. */
'use strict';

const travelRadar = require('../../public/travel-radar');

const AUTH_REVOKED_CODES = new Set([1, 2, 7, 10, 16, 18, 'NO_KEY', 'KEY_ACCESS', 'FAC_DENIED', 'UNAUTHORIZED', 'FORBIDDEN']);

function isAuthRevokedError(err) {
  if (!err) return false;
  if (err.status === 401 || err.status === 403) return true;
  const code = err.code;
  if (AUTH_REVOKED_CODES.has(code) || AUTH_REVOKED_CODES.has(Number(code))) return true;
  return false;
}

function normalizeMemberRow(m) {
  return {
    id: Number(m.id) || 0,
    name: String(m.name || ''),
    level: Number(m.level) || 0,
    position: String(m.position || ''),
    days: Number(m.days_in_faction ?? m.days) || 0,
    inOc: Boolean(m.is_in_oc ?? m.inOc),
    last: Number(m.last_action?.timestamp ?? m.last) || 0,
    lastRel: String(m.last_action?.relative ?? m.lastRel ?? ''),
    lastStatus: String(m.last_action?.status ?? m.lastStatus ?? ''),
    state: String(m.status?.state ?? m.state ?? ''),
    until: m.status?.until ?? m.until ?? null,
    desc: String(m.status?.description ?? m.desc ?? ''),
    statusDesc: String(m.status?.description ?? m.statusDesc ?? m.desc ?? ''),
    flightArrivalAt: Number(m.travel?.arrival_at ?? m.travel?.timestamp ?? m.flightArrivalAt) || null,
  };
}

function createRosterCache({
  fetchMembers,
  getFactionId = () => null,
  getKeyGen = () => 0,
  now = () => Date.now(),
  cacheTtlMs = travelRadar.CACHE_TTL_MS,
  staleAfterMs = travelRadar.STALE_THRESHOLD_MS,
  onSnapshot = null,
} = {}) {
  const state = {
    keyGen: -1,
    factionId: null,
    cache: null, // { keyGen, factionId, observedAtMs, receivedAtMs, members, radar }
    inflight: null, // { keyGen, factionId, promise }
    prevByPlayer: new Map(),
    prevObservedAtMs: 0,
    activeTransitions: new Map(),
  };

  function reset() {
    state.keyGen = -1;
    state.factionId = null;
    state.cache = null;
    state.inflight = null;
    state.prevByPlayer = new Map();
    state.prevObservedAtMs = 0;
    state.activeTransitions = new Map();
  }

  function snapshotWithFreshness(entry, extraFreshness = null) {
    const nowMs = now();
    const ageSec = Math.max(0, Math.floor((nowMs - entry.observedAtMs) / 1000));
    const isStale = (nowMs - entry.observedAtMs) > staleAfterMs;
    const freshness = {
      source: entry.radar.freshness.source,
      observedAt: entry.radar.freshness.observedAt,
      receivedAt: entry.radar.freshness.receivedAt,
      ageSec,
      state: isStale ? 'stale' : 'fresh',
      ...(extraFreshness || {}),
    };
    return {
      factionId: entry.factionId,
      observedAtMs: entry.observedAtMs,
      receivedAtMs: entry.receivedAtMs,
      members: entry.members,
      travel: entry.radar.travel,
      travelSummary: entry.radar.summary,
      transitions: entry.radar.transitions,
      freshness,
      fromCache: Boolean(extraFreshness?.fromCache),
    };
  }

  async function load({ force = false } = {}) {
    const gen = Number(getKeyGen()) || 0;
    const expectedFactionId = Number(getFactionId()) || null;

    // Account switch or faction switch wipes prior state before reading cache
    if (state.keyGen !== -1 && state.keyGen !== gen) reset();
    if (expectedFactionId && state.factionId && state.factionId !== expectedFactionId) reset();

    const nowMs = now();
    if (!force && state.cache && state.cache.keyGen === gen
      && (!expectedFactionId || !state.cache.factionId || state.cache.factionId === expectedFactionId)
      && (nowMs - state.cache.observedAtMs) < cacheTtlMs) {
      return snapshotWithFreshness(state.cache, { fromCache: true });
    }

    // Deduplicate concurrent in-flight fetches for the same account & faction scope
    if (state.inflight && state.inflight.keyGen === gen && state.inflight.factionId === expectedFactionId) {
      return state.inflight.promise;
    }

    const req = (async () => {
      try {
        const raw = await fetchMembers();
        if ((Number(getKeyGen()) || 0) !== gen) {
          const err = new Error('API key changed while fetching faction roster.');
          err.code = 'KEY_CHANGED';
          throw err;
        }

        const resolvedFactionId = Number(raw?.factionId ?? raw?.faction_id ?? raw?.faction?.id ?? getFactionId() ?? expectedFactionId) || null;
        if (resolvedFactionId && state.factionId && state.factionId !== resolvedFactionId) {
          // Faction changed since previous snapshot: wipe transition history so factions never mix
          state.prevByPlayer = new Map();
          state.prevObservedAtMs = 0;
          state.activeTransitions = new Map();
          state.cache = null;
        }

        const receivedAtMs = now();
        const rawObs = Number(raw?.observedAtMs ?? raw?.timestamp_ms ?? (Number(raw?.timestamp) > 0 ? Number(raw.timestamp) * 1000 : 0));
        const observedAtMs = rawObs > 0 ? rawObs : receivedAtMs;
        const rawMembers = Array.isArray(raw?.members) ? raw.members : Array.isArray(raw) ? raw : [];
        const members = rawMembers.map(normalizeMemberRow).sort((a, b) => b.last - a.last);

        const radar = travelRadar.buildRadarPayload({
          factionId: resolvedFactionId,
          members,
          prevByPlayer: state.prevByPlayer,
          prevObservedAtMs: state.prevObservedAtMs,
          activeTransitions: state.activeTransitions,
          observedAtMs,
          receivedAtMs,
          source: 'torn_roster',
          staleAfterMs,
          nowMs: receivedAtMs,
        });

        state.keyGen = gen;
        state.factionId = resolvedFactionId;
        state.prevByPlayer = radar.nextByPlayer;
        state.prevObservedAtMs = observedAtMs;
        state.activeTransitions = radar.nextActiveTransitions;
        state.cache = {
          keyGen: gen,
          factionId: resolvedFactionId,
          observedAtMs,
          receivedAtMs,
          members,
          radar,
        };

        if (typeof onSnapshot === 'function') {
          try { onSnapshot(state.cache); } catch { /* telemetry/history hook errors never break roster load */ }
        }

        return snapshotWithFreshness(state.cache, { fromCache: false });
      } catch (err) {
        // A reply (or refusal) for a key that is no longer the current one: the state now belongs to the new key,
        // so it is left alone and only this stale request fails.
        if (err?.code === 'KEY_CHANGED' || (Number(getKeyGen()) || 0) !== gen) throw err;
        if (isAuthRevokedError(err)) {
          // Never serve stale private data after auth/permission revocation
          reset();
          throw err;
        }
        // Transient upstream failure: serve stale cache ONLY if same account & same faction scope
        const stillSameKey = (Number(getKeyGen()) || 0) === gen;
        const curFac = Number(getFactionId()) || expectedFactionId || null;
        if (stillSameKey && state.cache && state.cache.keyGen === gen
          && (!curFac || !state.cache.factionId || state.cache.factionId === curFac)) {
          return snapshotWithFreshness(state.cache, {
            fromCache: true,
            staleFallback: true,
            staleReason: String(err?.code || err?.name || 'TRANSIENT_ERROR'),
            staleMessage: String(err?.message || 'Upstream temporarily unavailable'),
          });
        }
        throw err;
      } finally {
        if (state.inflight && state.inflight.promise === req) state.inflight = null;
      }
    })();

    state.inflight = { keyGen: gen, factionId: expectedFactionId, promise: req };
    return req;
  }

  function peek() {
    if (!state.cache) return null;
    return {
      factionId: state.cache.factionId,
      observedAtMs: state.cache.observedAtMs,
      receivedAtMs: state.cache.receivedAtMs,
      membersCount: state.cache.members.length,
      travelCount: state.cache.radar.travel.length,
      freshness: snapshotWithFreshness(state.cache, { fromCache: true }).freshness,
    };
  }

  return { load, reset, peek, isAuthRevokedError };
}

module.exports = { createRosterCache, normalizeMemberRow, isAuthRevokedError };
