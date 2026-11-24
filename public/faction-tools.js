/* Pure Faction Intelligence helpers (UMD: browser global + Node/Vitest require):
   - Safe Armory News parser & categorizer (strips HTML without innerHTML)
   - 7x24 UTC/TCT Activity Heatmap aggregator
   - Chain milestone summarizer
   - Faction Upgrade Respect Cost Simulator (Core = 1x, active branches ordered by base cost -> 1x/2x/4x/8x/16x/32x) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXFactionTools = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
  const decodeHtml = (s) => String(s || '').replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] || m);
  const stripHtml = (s) => decodeHtml(String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());

  const ARMORY_CATS = ['used', 'loaned', 'returned', 'filled', 'deposited', 'retrieved', 'other'];

  function classifyArmoryAction(text) {
    const t = String(text || '').toLowerCase();
    if (/\bfilled\b/.test(t)) return 'filled';
    if (/\bloaned\b/.test(t)) return 'loaned';
    if (/\breturned\b/.test(t)) return 'returned';
    if (/\bdeposited\b|\bdonated\b|\badded\b/.test(t)) return 'deposited';
    if (/\bretrieved\b|\btook\b|\bgave\b/.test(t)) return 'retrieved';
    if (/\bused\b/.test(t)) return 'used';
    return 'other';
  }

  function parseArmoryNews(rawList = []) {
    const arr = Array.isArray(rawList)
      ? rawList
      : Object.entries(rawList || {}).map(([id, v]) => ({ id, ...(v || {}) }));
    const entries = arr.map((e) => {
      const raw = String(e.text ?? e.news ?? '');
      const idMatch = raw.match(/XID=(\d+)/i);
      const actorId = idMatch ? Number(idMatch[1]) : null;
      const text = stripHtml(raw);
      const actorMatch = text.match(/^([A-Za-z0-9_-]{2,24})\s+(?:used|loaned|returned|filled|deposited|donated|retrieved|took|gave)/i);
      const actorName = actorMatch ? actorMatch[1] : null;
      const category = classifyArmoryAction(text);
      return {
        id: String(e.id || `${e.timestamp || 0}:${text.slice(0, 24)}`),
        timestamp: Number(e.timestamp) || 0,
        actorId,
        actorName,
        category,
        text,
      };
    }).filter((e) => e.text).sort((a, b) => b.timestamp - a.timestamp);

    const counts = Object.fromEntries(ARMORY_CATS.map((c) => [c, 0]));
    const byActor = new Map();
    for (const e of entries) {
      counts[e.category] = (counts[e.category] || 0) + 1;
      if (e.actorName) {
        const cur = byActor.get(e.actorName) || { name: e.actorName, id: e.actorId, total: 0, used: 0, loaned: 0, filled: 0 };
        cur.total++;
        if (e.category === 'used') cur.used++;
        if (e.category === 'loaned') cur.loaned++;
        if (e.category === 'filled') cur.filled++;
        byActor.set(e.actorName, cur);
      }
    }
    const topActors = [...byActor.values()].sort((a, b) => b.total - a.total).slice(0, 8);
    return { entries, counts, topActors };
  }

  // Activity Heatmap: 7 days (0=Sun..6=Sat UTC/TCT) x 24 hours (0..23)
  // Expects map keyed by "dow:hour" -> { samples, onlineSum, idleSum, totalSum }
  function buildActivityHeatmap(buckets = {}) {
    const grid = [];
    let maxAvg = 0;
    let totalSamples = 0;
    const hourTotals = Array.from({ length: 24 }, () => ({ active: 0, samples: 0 }));

    for (let d = 0; d < 7; d++) {
      const row = [];
      for (let h = 0; h < 24; h++) {
        const b = buckets[`${d}:${h}`];
        const samples = Number(b?.samples) || 0;
        const avgOnline = samples ? (Number(b.onlineSum) || 0) / samples : 0;
        const avgIdle = samples ? (Number(b.idleSum) || 0) / samples : 0;
        const avgActive = avgOnline + avgIdle * 0.5;
        const avgTotal = samples ? (Number(b.totalSum) || 0) / samples : 0;
        if (samples) {
          totalSamples += samples;
          hourTotals[h].active += avgOnline + avgIdle;
          hourTotals[h].samples += 1;
          if (avgActive > maxAvg) maxAvg = avgActive;
        }
        row.push({ day: d, hour: h, samples, avgOnline, avgIdle, avgActive, avgTotal });
      }
      grid.push(row);
    }

    const hourRank = hourTotals
      .map((x, hour) => ({ hour, avg: x.samples ? x.active / x.samples : null }))
      .filter((x) => x.avg != null);
    const peakHour = hourRank.length ? [...hourRank].sort((a, b) => b.avg - a.avg)[0] : null;
    const quietHour = hourRank.length ? [...hourRank].sort((a, b) => a.avg - b.avg)[0] : null;

    return { grid, maxAvg, totalSamples, peakHour, quietHour };
  }

  const CHAIN_MILESTONES = [100000, 50000, 25000, 10000, 5000, 2500, 1000, 500, 250, 100, 50, 25, 10];
  function chainMilestone(hits) {
    const n = Number(hits) || 0;
    return CHAIN_MILESTONES.find((m) => n >= m) || null;
  }

  function nextChainMilestone(hits, max) {
    return CHAIN_MILESTONES.findLast((milestone) => milestone > hits && milestone <= max) ?? null;
  }

  function summarizeChains(rawChains = []) {
    const arr = Array.isArray(rawChains)
      ? rawChains
      : Object.entries(rawChains || {}).map(([id, c]) => ({ id: Number(id) || id, ...(c || {}) }));
    return arr.map((c) => {
      const chain = Number(c.chain) || 0;
      const respect = Number(c.respect) || 0;
      const start = Number(c.start) || 0;
      const end = Number(c.end) || 0;
      const duration = end > start ? end - start : 0;
      return {
        id: Number(c.id) || 0,
        chain,
        respect,
        respectPerHit: chain > 0 ? respect / chain : 0,
        milestone: chainMilestone(chain),
        start,
        end,
        duration,
      };
    }).sort((a, b) => b.start - a.start);
  }

  // Faction Upgrade Respect Cost Simulator
  // `tree` is Torn's `factiontree` ({ [branchId]: { [level]: { branch, name, ability, challenge, base_cost } } } OR flat array of branches).
  // Normalized branches: [{ id, branch, upgrades: [{ key, name, maxLevel, levels: [{ level, baseCost, ability, challenge }] }] }]
  function normalizeFactionTree(rawTree) {
    if (!rawTree || typeof rawTree !== 'object') return [];
    const byBranch = new Map();
    const pushNode = (branchName, name, level, baseCost, ability, challenge) => {
      const bKey = String(branchName || 'Other');
      if (!byBranch.has(bKey)) byBranch.set(bKey, new Map());
      const uMap = byBranch.get(bKey);
      const uName = String(name || 'Upgrade');
      if (!uMap.has(uName)) uMap.set(uName, []);
      uMap.get(uName).push({
        level: Number(level) || 1,
        baseCost: Number(baseCost) || 0,
        ability: String(ability || ''),
        challenge: String(challenge || ''),
      });
    };

    if (Array.isArray(rawTree)) {
      for (const br of rawTree) {
        for (const up of br.upgrades || []) {
          pushNode(br.name || br.branch, up.name, up.level, up.cost ?? up.base_cost, up.ability, up.challenge);
        }
      }
    } else {
      for (const group of Object.values(rawTree)) {
        if (!group || typeof group !== 'object') continue;
        for (const [lvlKey, node] of Object.entries(group)) {
          if (!node || typeof node !== 'object') continue;
          pushNode(node.branch, node.name, node.level ?? lvlKey, node.base_cost ?? node.cost, node.ability, node.challenge);
        }
      }
    }

    const branches = [];
    for (const [branch, uMap] of byBranch.entries()) {
      const upgrades = [];
      for (const [name, levels] of uMap.entries()) {
        levels.sort((a, b) => a.level - b.level);
        const key = `${branch}::${name}`;
        upgrades.push({ key, branch, name, maxLevel: levels[levels.length - 1]?.level || levels.length, levels });
      }
      upgrades.sort((a, b) => a.name.localeCompare(b.name));
      branches.push({ branch, isCore: branch.toLowerCase() === 'core', upgrades });
    }
    branches.sort((a, b) => (a.isCore ? -1 : b.isCore ? 1 : a.branch.localeCompare(b.branch)));
    return branches;
  }

  // Exact Torn branch-order respect calculation:
  // Core branch multiplier is always 1x.
  // Active non-core branches are sorted by descending base cost and get multipliers 1x, 2x, 4x, 8x, 16x, 32x...
  function simulateUpgrades(branches = [], selectedLevels = {}, availableRespect = 0) {
    const branchTotals = branches.map((b) => {
      let baseCost = 0;
      const items = [];
      for (const u of b.upgrades || []) {
        const target = Math.max(0, Math.min(u.maxLevel, Number(selectedLevels[u.key]) || 0));
        let uBase = 0;
        let currentAbility = '';
        for (const lv of u.levels) {
          if (lv.level <= target) {
            uBase += lv.baseCost;
            currentAbility = lv.ability;
          }
        }
        baseCost += uBase;
        items.push({ key: u.key, name: u.name, level: target, maxLevel: u.maxLevel, baseCost: uBase, ability: currentAbility });
      }
      return { branch: b.branch, isCore: b.isCore, baseCost, items };
    });

    const activeNonCore = branchTotals
      .filter((b) => !b.isCore && b.baseCost > 0)
      .sort((a, b) => b.baseCost - a.baseCost);

    const orderMap = new Map();
    activeNonCore.forEach((b, idx) => orderMap.set(b.branch, idx + 1));

    let totalRespectCost = 0;
    const breakdown = branchTotals.map((b) => {
      const order = b.isCore ? 0 : (orderMap.get(b.branch) || 0);
      const multiplier = b.isCore ? 1 : order > 0 ? Math.pow(2, order - 1) : 1;
      const respectCost = b.baseCost * multiplier;
      totalRespectCost += respectCost;
      return { ...b, order, multiplier, respectCost };
    });

    const avail = Math.max(0, Number(availableRespect) || 0);
    return {
      breakdown,
      activeNonCoreCount: activeNonCore.length,
      totalRespectCost,
      availableRespect: avail,
      remainingRespect: avail - totalRespectCost,
      affordable: avail >= totalRespectCost,
    };
  }

  return Object.freeze({
    ARMORY_CATS: Object.freeze(ARMORY_CATS),
    stripHtml,
    classifyArmoryAction,
    parseArmoryNews,
    buildActivityHeatmap,
    chainMilestone,
    nextChainMilestone,
    summarizeChains,
    normalizeFactionTree,
    simulateUpgrades,
  });
});
