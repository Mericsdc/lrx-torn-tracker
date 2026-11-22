/* Pure Faction Members, Personal Series & Extended Workspace Engine (N3 & N4 · UMD).
   Implements:
   - N3: Members table with customizable columns, source/permission separation, inline member
     detail drawer series (Battle Stats, Activity, War/OC/Chain Contribution, Travel Transitions),
     Value vs Gain modes, 7d/30d/90d/6m/1y/2y/All/Custom ranges, strict guard against splitting
     a single estimated Total into synthetic STR/SPD/DEX/DEF sub-stats, same-source daily average,
     outage gap & source-change segmentation.
   - N4: Faction Stats (membership tenure filtering so a new member's prior-faction totals are
     never attributed to this faction), Faction Gym (verified contributors & share %), Bank,
     Recruitment/Applications, Transfers (observation interval [seenFrom, seenTo] never shown as
     exact transfer timestamp), Alliance/Family & Graffiti. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXFactionWorkspace = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const RANGE_TO_MS = Object.freeze({
    '7d': 7 * 86400_000,
    '30d': 30 * 86400_000,
    '90d': 90 * 86400_000,
    '6m': 180 * 86400_000,
    '1y': 365 * 86400_000,
    '2y': 730 * 86400_000,
  });

  function evaluateRestrictedField({
    hasPermission = false,
    hasSource = false,
    isShared = false,
    value = null,
    source = null,
  } = {}) {
    if (!hasPermission && !isShared) {
      return {
        status: 'permission_required',
        label: ['İzin gerekli', 'Permission required'],
        value: null,
        source: null,
      };
    }
    if (!hasSource) {
      return {
        status: 'not_shared',
        label: ['Paylaşılmıyor', 'Not shared'],
        value: null,
        source: null,
      };
    }
    if (value == null) {
      return {
        status: 'no_data',
        label: ['Veri yok', 'No data'],
        value: null,
        source,
      };
    }
    return {
      status: 'ok',
      label: ['Doğrulanmış', 'Verified'],
      value,
      source,
    };
  }

  /* Strict Rule (N3): A single estimated Total (e.g. FFScouter bs_estimate) is NEVER
     synthetically divided into STR, SPD, DEX, DEF sub-stats. */
  function normalizeBattleStatsPoint(raw = {}) {
    const source = String(raw.source || 'unknown');
    const verified = Boolean(raw.verified || source === 'torn_self' || source === 'member_shared');
    const total = Number(raw.total ?? raw.bs) > 0 ? Number(raw.total ?? raw.bs) : null;
    const str = verified && Number(raw.str ?? raw.strength) >= 0 ? Number(raw.str ?? raw.strength) : null;
    const spd = verified && Number(raw.spd ?? raw.speed) >= 0 ? Number(raw.spd ?? raw.speed) : null;
    const dex = verified && Number(raw.dex ?? raw.dexterity) >= 0 ? Number(raw.dex ?? raw.dexterity) : null;
    const def = verified && Number(raw.def ?? raw.defense) >= 0 ? Number(raw.def ?? raw.defense) : null;
    return {
      at: Number(raw.at) || Date.now(),
      observedAt: raw.observedAt || new Date(Number(raw.at) || Date.now()).toISOString(),
      source,
      verified,
      totalOnlyEstimate: !verified && total != null,
      total,
      str,
      spd,
      dex,
      def,
    };
  }

  function buildMemberSeries(rawPoints = [], {
    metric = 'battlestats',
    mode = 'value',
    rangeKey = '30d',
    fromMs = null,
    toMs = null,
    nowMs = Date.now(),
    statKey = 'total',
  } = {}) {
    const endMs = Number(toMs) > 0 ? Number(toMs) : nowMs;
    const startMs = Number(fromMs) > 0
      ? Number(fromMs)
      : (RANGE_TO_MS[rangeKey] ? endMs - RANGE_TO_MS[rangeKey] : 0);

    const normalized = (Array.isArray(rawPoints) ? rawPoints : [])
      .map((p) => {
        if (metric === 'battlestats') {
          const b = normalizeBattleStatsPoint(p);
          return {
            ...b,
            value: b[statKey] != null ? b[statKey] : null,
          };
        }
        return {
          at: Number(p.at) || 0,
          observedAt: p.observedAt || new Date(Number(p.at) || Date.now()).toISOString(),
          source: String(p.source || 'torn_api'),
          verified: p.verified !== false,
          totalOnlyEstimate: false,
          value: p.value != null && Number.isFinite(Number(p.value)) ? Number(p.value) : null,
        };
      })
      .filter((p) => p.at >= startMs && p.at <= endMs + 60_000 && p.value != null)
      .sort((a, b) => a.at - b.at);

    if (metric === 'battlestats' && statKey !== 'total' && !normalized.length) {
      const hasTotalOnly = (Array.isArray(rawPoints) ? rawPoints : []).some((p) => {
        const b = normalizeBattleStatsPoint(p);
        return b.totalOnlyEstimate && b.at >= startMs && b.at <= endMs + 60_000;
      });
      if (hasTotalOnly) {
        return {
          metric,
          statKey,
          mode,
          rangeKey,
          points: [],
          segments: [],
          singlePoint: false,
          totalOnlyRestricted: true,
          notice: [
            'FFScouter yalnızca toplam stat tahmini sunar; alt statlar (STR/SPD/DEX/DEF) yapay olarak bölünmez.',
            'FFScouter only provides a total stat estimate; sub-stats (STR/SPD/DEX/DEF) are never synthetically split.',
          ],
          dailyAverage: null,
          totalGain: null,
        };
      }
    }

    const baseBySource = new Map();
    const displayPoints = normalized.map((p, idx) => {
      if (!baseBySource.has(p.source)) baseBySource.set(p.source, p.value);
      const baseVal = baseBySource.get(p.source);
      const prev = idx > 0 ? normalized[idx - 1] : null;
      const sourceChanged = Boolean(prev && prev.source !== p.source);
      return {
        ...p,
        rawValue: p.value,
        value: mode === 'gain' ? (p.value - baseVal) : p.value,
        sourceChanged,
      };
    });

    const GAP_MS = 36 * 3600_000;
    const segments = [];
    let curSeg = [];
    for (let i = 0; i < displayPoints.length; i++) {
      const pt = displayPoints[i];
      if (i > 0) {
        const prev = displayPoints[i - 1];
        if (pt.sourceChanged || (pt.at - prev.at) > GAP_MS) {
          if (curSeg.length) segments.push(curSeg);
          curSeg = [];
        }
      }
      curSeg.push(pt);
    }
    if (curSeg.length) segments.push(curSeg);

    const singlePoint = displayPoints.length === 1;
    let dailyAverage = null;
    let totalGain = null;
    if (displayPoints.length >= 2) {
      const first = displayPoints[0];
      const last = displayPoints[displayPoints.length - 1];
      if (first.source === last.source && last.at > first.at) {
        totalGain = last.rawValue - first.rawValue;
        const elapsedDays = (last.at - first.at) / 86400_000;
        if (elapsedDays >= 0.25) {
          dailyAverage = Math.round((totalGain / elapsedDays) * 100) / 100;
        }
      }
    }

    return {
      metric,
      statKey,
      mode,
      rangeKey,
      startMs,
      endMs,
      points: displayPoints,
      segments,
      singlePoint,
      totalOnlyRestricted: false,
      notice: singlePoint
        ? ['Trend için veri birikmesi bekleniyor', 'Waiting for more data points to build a trend']
        : null,
      dailyAverage,
      totalGain,
      latestValue: displayPoints.length ? displayPoints[displayPoints.length - 1].rawValue : null,
    };
  }

  function buildMembersTable({
    members = [],
    freshness = null,
    hasOfficerAccess = false,
  } = {}) {
    const rows = (Array.isArray(members) ? members : []).map((m) => {
      const bs = m.battleStats ? normalizeBattleStatsPoint(m.battleStats) : null;
      const bsBadge = bs?.verified
        ? { kind: 'verified', label: ['Doğrulanmış', 'Verified'], source: bs.source }
        : bs?.total != null
          ? { kind: 'estimate', label: ['Tahmin (FFScouter)', 'Estimate (FFScouter)'], source: bs.source || 'ffscouter' }
          : { kind: 'pending', label: ['Geçmiş birikiyor', 'Accumulating history'], source: null };

      return {
        playerId: Number(m.id ?? m.playerId) || 0,
        name: String(m.name || ''),
        level: Number(m.level) || 0,
        position: String(m.position || ''),
        days: Number(m.days ?? m.days_in_faction) || 0,
        activityStatus: String(m.lastStatus || 'Offline').toLowerCase(),
        lastActionTs: Number(m.last) || 0,
        lastActionRel: String(m.lastRel || ''),
        gameState: String(m.state || 'Okay'),
        statusDesc: String(m.statusDesc || m.desc || ''),
        inOc: Boolean(m.inOc),
        travel: m.countryCode || m.state === 'Traveling' || m.state === 'Abroad'
          ? {
              state: m.travelState || (m.state === 'Abroad' ? 'abroad' : 'outbound'),
              countryCode: m.countryCode || null,
              country: m.country || null,
              etaSec: m.etaSec ?? null,
              etaSource: m.etaSource || 'none',
            }
          : null,
        battleStats: {
          total: bs?.total ?? null,
          str: bs?.str ?? null,
          spd: bs?.spd ?? null,
          dex: bs?.dex ?? null,
          def: bs?.def ?? null,
          badge: bsBadge.kind,
          label: bsBadge.label,
          source: bsBadge.source,
          totalOnly: Boolean(bs?.totalOnlyEstimate),
        },
        activity7d: m.activity7d ?? null,
        xanax7d: m.xanax7d ?? null,
        gym7d: m.gym7d ?? null,
        crimes7d: m.crimes7d ?? null,
        oc7d: m.oc7d ?? null,
        warScore: m.warScore ?? null,
        restricted: {
          activity: evaluateRestrictedField({ hasPermission: hasOfficerAccess, hasSource: m.activity7d != null, value: m.activity7d, source: 'torn_personalstats' }),
          xanax: evaluateRestrictedField({ hasPermission: hasOfficerAccess, hasSource: m.xanax7d != null, value: m.xanax7d, source: 'torn_personalstats' }),
          gym: evaluateRestrictedField({ hasPermission: hasOfficerAccess, hasSource: m.gym7d != null, value: m.gym7d, source: 'torn_contributors' }),
        },
      };
    });

    return {
      freshness,
      totalCount: rows.length,
      rows,
    };
  }

  function buildFactionStatsView({
    members = [],
    reportRows = [],
    windowDays = 7,
    tenureFilter = true,
    range = null,
  } = {}) {
    const span = [7, 30, 90].includes(Number(windowDays)) ? Number(windowDays) : 7;
    const byId = new Map((Array.isArray(reportRows) ? reportRows : []).map((r) => [Number(r.id), r]));
    const rows = [];
    let excludedNewMembers = 0;
    let measuredCount = 0;
    let activeCount = 0;

    for (const m of Array.isArray(members) ? members : []) {
      const pid = Number(m.id ?? m.playerId) || 0;
      const daysInFaction = Number(m.days ?? m.days_in_faction) || 0;
      const r = byId.get(pid) || {};
      const tenureEligible = !tenureFilter || daysInFaction >= span;
      if (!tenureEligible) excludedNewMembers++;

      const activitySec = tenureEligible && r.activity != null ? Number(r.activity) : null;
      const xanax = tenureEligible && r.xanax != null ? Number(r.xanax) : null;
      const gym = tenureEligible && r.gym != null ? Number(r.gym) : null;
      const crimes = tenureEligible && r.crimes != null ? Number(r.crimes) : null;
      const oc = tenureEligible && r.oc != null ? Number(r.oc) : null;

      if (tenureEligible && activitySec != null) {
        measuredCount++;
        if (activitySec >= 300 * (span / 7)) activeCount++;
      }

      rows.push({
        id: pid,
        name: String(m.name || `#${pid}`),
        level: Number(m.level) || 0,
        position: String(m.position || ''),
        days: daysInFaction,
        tenureEligible,
        tenureNote: !tenureEligible
          ? [`Üyelik süresi (${daysInFaction}g) < ${span}g olduğu için dönem toplamına dahil edilmedi`, `Excluded from ${span}d delta because tenure (${daysInFaction}d) < ${span}d`]
          : null,
        activity: activitySec,
        xanax,
        gym,
        crimes,
        oc,
      });
    }

    const activeRatePct = measuredCount > 0 ? Math.round((activeCount / measuredCount) * 1000) / 10 : null;
    const totals = rows.reduce((acc, r) => {
      if (!r.tenureEligible) return acc;
      if (r.activity != null) acc.activity += r.activity;
      if (r.xanax != null) acc.xanax += r.xanax;
      if (r.gym != null) acc.gym += r.gym;
      if (r.crimes != null) acc.crimes += r.crimes;
      if (r.oc != null) acc.oc += r.oc;
      return acc;
    }, { activity: 0, xanax: 0, gym: 0, crimes: 0, oc: 0 });

    return {
      windowDays: span,
      tenureFilter,
      range,
      activeRate: {
        pct: activeRatePct,
        numerator: activeCount,
        denominator: measuredCount,
        totalMembers: members.length,
        excludedNewMembers,
        filterLabel: tenureFilter
          ? [`Üyelik ≥ ${span}g · En az ${Math.round(5 * (span / 7))} dk oynama`, `Tenure ≥ ${span}d · At least ${Math.round(5 * (span / 7))}m played`]
          : [`Tüm üyeler · En az ${Math.round(5 * (span / 7))} dk oynama`, `All members · At least ${Math.round(5 * (span / 7))}m played`],
        source: 'torn_personalstats_timeplayed',
      },
      totals,
      rows,
    };
  }

  function buildFactionGymView({
    members = [],
    gymSnaps = {},
    windowDays = 7,
  } = {}) {
    const days = Object.keys(gymSnaps || {}).sort();
    const to = days[days.length - 1] || null;
    const dayTs = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000);
    const utcDay = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
    const from = to
      ? (days.filter((d) => d <= utcDay(dayTs(to) - windowDays * 86400)).pop() || days[0])
      : null;
    const G1 = from ? gymSnaps[from] : null;
    const G2 = to ? gymSnaps[to] : null;
    const hasDiff = Boolean(from && to && from !== to && G1 && G2);

    const rawRows = (Array.isArray(members) ? members : []).map((m) => {
      const pid = Number(m.id ?? m.playerId) || 0;
      const curTotal = G2?.[pid] != null ? Number(G2[pid]) : null;
      const gain = hasDiff && G1?.[pid] != null && G2?.[pid] != null
        ? Math.max(0, Number(G2[pid]) - Number(G1[pid]))
        : null;
      return {
        playerId: pid,
        name: String(m.name || `#${pid}`),
        level: Number(m.level) || 0,
        position: String(m.position || ''),
        days: Number(m.days) || 0,
        currentTotal: curTotal,
        periodGain: gain,
      };
    });

    const totalGain = rawRows.reduce((s, r) => s + (r.periodGain || 0), 0);
    const totalCurrent = rawRows.reduce((s, r) => s + (r.currentTotal || 0), 0);
    const denom = hasDiff && totalGain > 0 ? totalGain : Math.max(1, totalCurrent);

    const rows = rawRows.map((r) => {
      const val = hasDiff ? (r.periodGain || 0) : (r.currentTotal || 0);
      return {
        ...r,
        sharePct: denom > 0 && val > 0 ? Math.round((val / denom) * 1000) / 10 : 0,
      };
    }).sort((a, b) => ((b.periodGain ?? b.currentTotal ?? 0) - (a.periodGain ?? a.currentTotal ?? 0)));

    return {
      source: 'torn_faction_contributors_gymenergy',
      from: hasDiff ? from : null,
      to,
      actualDays: hasDiff ? Math.round((dayTs(to) - dayTs(from)) / 86400) : 0,
      totalGain: hasDiff ? totalGain : null,
      totalCurrent,
      contributorCount: rows.filter((r) => (r.periodGain ?? r.currentTotal ?? 0) > 0).length,
      rows,
    };
  }

  function detectRosterTransfers(prevMembers = [], currMembers = [], {
    prevObservedAt = null,
    currObservedAt = null,
    factionId = null,
  } = {}) {
    if (!Array.isArray(prevMembers) || !prevMembers.length || !Array.isArray(currMembers) || !currMembers.length) {
      return [];
    }
    const prevById = new Map(prevMembers.map((m) => [Number(m.id ?? m.playerId), m]));
    const currById = new Map(currMembers.map((m) => [Number(m.id ?? m.playerId), m]));
    const seenFrom = prevObservedAt || new Date().toISOString();
    const seenTo = currObservedAt || new Date().toISOString();
    const events = [];

    for (const [id, m] of currById.entries()) {
      if (!id || prevById.has(id)) continue;
      events.push({
        id: `join:${factionId || 0}:${id}:${seenTo}`,
        type: 'joined',
        playerId: id,
        name: String(m.name || `#${id}`),
        level: Number(m.level) || 0,
        position: String(m.position || ''),
        days: Number(m.days) || 0,
        observation_interval: { seenFrom, seenTo },
        timestampKind: 'observation_interval',
      });
    }
    for (const [id, m] of prevById.entries()) {
      if (!id || currById.has(id)) continue;
      events.push({
        id: `left:${factionId || 0}:${id}:${seenTo}`,
        type: 'left',
        playerId: id,
        name: String(m.name || `#${id}`),
        level: Number(m.level) || 0,
        position: String(m.position || ''),
        days: Number(m.days) || 0,
        observation_interval: { seenFrom, seenTo },
        timestampKind: 'observation_interval',
      });
    }
    return events;
  }

  return Object.freeze({
    RANGE_TO_MS,
    evaluateRestrictedField,
    normalizeBattleStatsPoint,
    buildMemberSeries,
    buildMembersTable,
    buildFactionStatsView,
    buildFactionGymView,
    detectRosterTransfers,
  });
});
