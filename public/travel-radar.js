/* Pure Faction Travel Radar & Transition Engine (UMD: browser global + Node/Vitest require).
   Normalizes Torn faction member roster rows into strict travel states (outbound, abroad,
   inbound, none_observed, unknown), separates activity & health axes, tracks transitions
   between snapshots, and computes nullable ETA windows only from verified transitions or
   explicit flight arrival timestamps (never treating status.until as flight ETA). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXTravelRadar = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const STALE_THRESHOLD_MS = 5 * 60_000; // 5 minutes per integration spec
  const CACHE_TTL_MS = 2 * 60_000;       // 2 minutes shared roster cache

  const COUNTRIES = Object.freeze({
    torn: Object.freeze({ code: 'torn', name: 'Torn', abbr: 'TC', minutes: 0 }),
    mex: Object.freeze({ code: 'mex', name: 'Mexico', abbr: 'MX', minutes: 26 }),
    cay: Object.freeze({ code: 'cay', name: 'Cayman Islands', abbr: 'KY', minutes: 35 }),
    can: Object.freeze({ code: 'can', name: 'Canada', abbr: 'CA', minutes: 41 }),
    haw: Object.freeze({ code: 'haw', name: 'Hawaii', abbr: 'HI', minutes: 134 }),
    uni: Object.freeze({ code: 'uni', name: 'United Kingdom', abbr: 'UK', minutes: 159 }),
    arg: Object.freeze({ code: 'arg', name: 'Argentina', abbr: 'AR', minutes: 167 }),
    swi: Object.freeze({ code: 'swi', name: 'Switzerland', abbr: 'CH', minutes: 175 }),
    jap: Object.freeze({ code: 'jap', name: 'Japan', abbr: 'JP', minutes: 225 }),
    chi: Object.freeze({ code: 'chi', name: 'China', abbr: 'CN', minutes: 242 }),
    uae: Object.freeze({ code: 'uae', name: 'UAE', abbr: 'AE', minutes: 271 }),
    sou: Object.freeze({ code: 'sou', name: 'South Africa', abbr: 'ZA', minutes: 297 }),
  });

  const COUNTRY_ALIASES = Object.freeze({
    torn: 'torn', 'torn city': 'torn',
    mexico: 'mex', mex: 'mex',
    'cayman islands': 'cay', cayman: 'cay', cay: 'cay',
    canada: 'can', can: 'can',
    hawaii: 'haw', haw: 'haw',
    'united kingdom': 'uni', uk: 'uni', britain: 'uni', uni: 'uni',
    argentina: 'arg', arg: 'arg',
    switzerland: 'swi', swi: 'swi',
    japan: 'jap', jap: 'jap',
    china: 'chi', chi: 'chi',
    'united arab emirates': 'uae', uae: 'uae', dubai: 'uae',
    'south africa': 'sou', sa: 'sou', sou: 'sou',
  });

  const VALID_TRAVEL_STATES = Object.freeze(['outbound', 'abroad', 'inbound', 'none_observed', 'unknown']);

  const isoUtc = (ms) => {
    const n = Number(ms);
    return Number.isFinite(n) && n > 0 ? new Date(n).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
  };

  function resolveCountryCode(raw) {
    if (!raw) return null;
    const cleaned = String(raw).trim().toLowerCase().replace(/^the\s+/, '').replace(/[.!?,]+$/, '');
    return COUNTRY_ALIASES[cleaned] || null;
  }

  function countryName(code) {
    return COUNTRIES[code]?.name || null;
  }

  function normalizeActivity(raw) {
    const s = String(raw?.lastStatus ?? raw?.last_action?.status ?? raw?.activityStatus ?? '').trim().toLowerCase();
    if (s === 'online') return 'Online';
    if (s === 'idle') return 'Idle';
    return 'Offline';
  }

  function normalizeHealth(stateStr, descStr) {
    const s = String(stateStr || '').trim().toLowerCase();
    const d = String(descStr || '').trim().toLowerCase();
    if (s === 'hospital' || /\bin\s+(?:a\s+)?(?:[a-z\s]+)?hospital\b|\bhospitalized\b/.test(d)) return 'hospital';
    if (s === 'jail' || /\bin\s+(?:a\s+)?(?:[a-z\s]+)?jail\b/.test(d)) return 'jail';
    if (s === 'federal' || /\bfederal\s+jail\b/.test(d)) return 'federal';
    if (s === 'fallen') return 'fallen';
    if (s === 'okay') return 'okay';
    return 'unknown';
  }

  function parseRoute(stateStr, descStr) {
    const state = String(stateStr || '').trim();
    const desc = String(descStr || '').trim();

    // 1. Returning to Torn from <Country>  /  Traveling from <Country> to Torn
    let m = /^(?:returning|traveling)\s+to\s+torn(?:\s+city)?\s+from\s+(.+)$/i.exec(desc)
      || /^traveling\s+from\s+(.+?)\s+to\s+torn(?:\s+city)?$/i.exec(desc);
    if (m) {
      const origin = resolveCountryCode(m[1]);
      if (origin && origin !== 'torn') {
        return { travelState: 'inbound', origin, destination: 'torn', rawDescription: '' };
      }
      return { travelState: 'unknown', origin: null, destination: null, rawDescription: desc };
    }

    // 2. Traveling to <Country>
    m = /^traveling\s+to\s+(.+)$/i.exec(desc);
    if (m) {
      const dest = resolveCountryCode(m[1]);
      if (dest === 'torn') return { travelState: 'inbound', origin: null, destination: 'torn', rawDescription: '' };
      if (dest) return { travelState: 'outbound', origin: 'torn', destination: dest, rawDescription: '' };
      return { travelState: 'unknown', origin: null, destination: null, rawDescription: desc };
    }

    // 3. In hospital/jail in <Country> or In a <Country> hospital
    m = /^in\s+(?:hospital|jail)\s+in\s+(.+)$/i.exec(desc)
      || /^in\s+a\s+(.+?)\s+(?:hospital|jail)$/i.exec(desc);
    if (m) {
      const code = resolveCountryCode(m[1]);
      if (code && code !== 'torn') {
        return { travelState: 'abroad', origin: null, destination: code, rawDescription: '' };
      }
    }

    // 4. In <Country>
    m = /^in\s+(.+)$/i.exec(desc);
    if (m) {
      const code = resolveCountryCode(m[1]);
      if (code && code !== 'torn') {
        return { travelState: 'abroad', origin: null, destination: code, rawDescription: '' };
      }
    }

    // 5. Fallback when Torn explicitly marks Traveling / Abroad with an unrecognized description
    if (state === 'Traveling' || state === 'Abroad') {
      return { travelState: 'unknown', origin: null, destination: null, rawDescription: desc || state };
    }

    return { travelState: 'none_observed', origin: null, destination: null, rawDescription: '' };
  }

  function parseMemberTravel(raw, opts = {}) {
    const playerId = Math.floor(Number(raw?.id ?? raw?.playerId) || 0);
    const displayName = String(raw?.name ?? raw?.displayName ?? '').trim() || (playerId ? `#${playerId}` : '');
    const statusState = raw?.state ?? raw?.status?.state ?? '';
    const statusDesc = raw?.statusDesc ?? raw?.status?.description ?? raw?.rawDescription ?? '';
    const route = parseRoute(statusState, statusDesc);
    const activityStatus = normalizeActivity(raw);
    const healthStatus = normalizeHealth(statusState, statusDesc);

    // ETA: ONLY exact if source gives an explicit verified flight arrival field (NEVER status.until!)
    let etaKind = 'unknown';
    let etaFrom = null;
    let etaTo = null;
    let etaAt = null;

    const explicitArrival = Number(raw?.flightArrivalAt ?? raw?.travel?.arrival_at ?? raw?.travel?.timestamp) || 0;
    if ((route.travelState === 'outbound' || route.travelState === 'inbound') && explicitArrival > 0) {
      etaKind = 'exact';
      etaAt = isoUtc(explicitArrival > 1e12 ? explicitArrival : explicitArrival * 1000);
    } else if ((route.travelState === 'outbound' || route.travelState === 'inbound') && opts.transition) {
      const tr = opts.transition;
      const countryCode = route.travelState === 'outbound' ? route.destination : route.origin;
      const mins = COUNTRIES[countryCode]?.minutes || 0;
      const seenFromMs = Number(tr.seenFromMs) || 0;
      const seenToMs = Number(tr.seenToMs) || 0;
      const mult = Number(opts.flightMultiplier) > 0 ? Number(opts.flightMultiplier) : 1;
      if (mins > 0 && seenFromMs > 0 && seenToMs >= seenFromMs) {
        const flightMs = Math.round(mins * mult * 60_000);
        etaKind = 'estimate';
        etaFrom = isoUtc(seenFromMs + flightMs);
        etaTo = isoUtc(seenToMs + flightMs);
      }
    }

    return {
      playerId,
      displayName,
      level: Number(raw?.level) || 0,
      position: String(raw?.position || ''),
      inOc: Boolean(raw?.inOc ?? raw?.is_in_oc),
      lastRel: String(raw?.lastRel ?? raw?.last_action?.relative ?? ''),
      travelState: route.travelState,
      destination: route.destination,
      origin: route.origin,
      rawDescription: route.rawDescription,
      activityStatus,
      healthStatus,
      etaKind,
      etaFrom,
      etaTo,
      etaAt,
    };
  }

  function legKey(row) {
    return `${row.travelState}:${row.origin || ''}:${row.destination || ''}`;
  }

  function buildRadarPayload({
    factionId = null,
    members = [],
    prevByPlayer = null,
    prevObservedAtMs = 0,
    activeTransitions = null,
    observedAtMs = Date.now(),
    receivedAtMs = null,
    source = 'torn_roster',
    staleAfterMs = STALE_THRESHOLD_MS,
    nowMs = Date.now(),
    flightMultiplier = 1,
  } = {}) {
    const obsMs = Number(observedAtMs) > 0 ? Number(observedAtMs) : nowMs;
    const recMs = Number(receivedAtMs) > 0 ? Number(receivedAtMs) : obsMs;
    const prevMap = prevByPlayer instanceof Map
      ? prevByPlayer
      : new Map(Object.entries(prevByPlayer || {}).map(([k, v]) => [Number(k), v]));
    const activeMap = activeTransitions instanceof Map
      ? new Map(activeTransitions)
      : new Map(Object.entries(activeTransitions || {}).map(([k, v]) => [Number(k), v]));

    const transitions = [];
    const nextByPlayer = new Map();
    const nextActiveTransitions = new Map();
    const allMembers = [];
    const travel = [];
    const summary = { outbound: 0, abroad: 0, inbound: 0, unknown: 0, totalTravel: 0 };

    for (const raw of members || []) {
      const prelim = parseMemberTravel(raw);
      if (!(prelim.playerId > 0)) continue;
      const pid = prelim.playerId;
      const prev = prevMap.get(pid) || null;
      let trForEta = null;

      if (prev && prevObservedAtMs > 0 && obsMs >= prevObservedAtMs) {
        const changed = legKey(prev) !== legKey(prelim);
        if (changed) {
          const transition = {
            transitionId: `${pid}:${prev.travelState}->${prelim.travelState}:${prelim.destination || prelim.origin || 'none'}:${Math.floor(obsMs / 1000)}`,
            playerId: pid,
            fromState: prev.travelState,
            toState: prelim.travelState,
            destination: prelim.destination,
            origin: prelim.origin,
            seenFrom: isoUtc(prevObservedAtMs),
            seenTo: isoUtc(obsMs),
            seenFromMs: prevObservedAtMs,
            seenToMs: obsMs,
          };
          transitions.push(transition);
          if (prelim.travelState === 'outbound' || prelim.travelState === 'inbound') {
            trForEta = { leg: legKey(prelim), seenFromMs: prevObservedAtMs, seenToMs: obsMs };
            nextActiveTransitions.set(pid, trForEta);
          }
        } else if (prelim.travelState === 'outbound' || prelim.travelState === 'inbound') {
          const existing = activeMap.get(pid);
          if (existing && existing.leg === legKey(prelim)) {
            trForEta = existing;
            nextActiveTransitions.set(pid, existing);
          }
        }
      }

      const row = trForEta ? parseMemberTravel(raw, { transition: trForEta, flightMultiplier }) : prelim;
      nextByPlayer.set(pid, {
        travelState: row.travelState,
        origin: row.origin,
        destination: row.destination,
      });
      allMembers.push(row);

      if (row.travelState !== 'none_observed') {
        travel.push(row);
        summary.totalTravel++;
        if (row.travelState === 'outbound') summary.outbound++;
        else if (row.travelState === 'abroad') summary.abroad++;
        else if (row.travelState === 'inbound') summary.inbound++;
        else summary.unknown++;
      }
    }

    // Sort travel rows: inbound soonest first, outbound next, abroad, unknown
    const order = { inbound: 0, outbound: 1, abroad: 2, unknown: 3 };
    travel.sort((a, b) => {
      const oa = order[a.travelState] ?? 9;
      const ob = order[b.travelState] ?? 9;
      if (oa !== ob) return oa - ob;
      const ta = Date.parse(a.etaAt || a.etaFrom || '') || Infinity;
      const tb = Date.parse(b.etaAt || b.etaFrom || '') || Infinity;
      if (ta !== tb) return ta - tb;
      return a.displayName.localeCompare(b.displayName);
    });

    const ageSec = Math.max(0, Math.floor((nowMs - obsMs) / 1000));
    const state = (nowMs - obsMs) > staleAfterMs ? 'stale' : 'fresh';

    return {
      factionId: factionId ? Number(factionId) : null,
      freshness: {
        source: String(source || 'torn_roster'),
        observedAt: isoUtc(obsMs),
        receivedAt: isoUtc(recMs),
        ageSec,
        state,
      },
      travel,
      summary,
      allMembers,
      transitions,
      nextByPlayer,
      nextActiveTransitions,
    };
  }

  return Object.freeze({
    STALE_THRESHOLD_MS,
    CACHE_TTL_MS,
    COUNTRIES,
    VALID_TRAVEL_STATES,
    isoUtc,
    resolveCountryCode,
    countryName,
    normalizeActivity,
    normalizeHealth,
    parseRoute,
    parseMemberTravel,
    buildRadarPayload,
  });
});
