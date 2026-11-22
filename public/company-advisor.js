/* Pure Company Staff Position Optimizer (UMD: browser global + Node/Vitest require).
   Uses Torn's official working-stat efficiency formula and an exact Hungarian algorithm
   to find the highest-effectiveness employee-to-position assignment. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXCompanyAdvisor = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  // Official Torn Wiki formula per required stat:
  // FLOOR(MIN(45, (45 / required) * stat) + MAX(0, 5 * LOG2(stat / required)))
  function singleStatEff(stat, required) {
    const req = Number(required) || 0;
    const val = Math.max(0, Number(stat) || 0);
    if (!(req > 0)) return 0;
    if (!(val > 0)) return 0;
    const base = Math.min(45, (45 * val) / req);
    const over = val > req ? 5 * Math.log2(val / req) : 0;
    return base + Math.max(0, over);
  }

  function workStatEfficiency(emp, pos, { directorEduBonus = false } = {}) {
    if (!emp || !pos) return 0;
    const mult = directorEduBonus ? 1.2 : 1; // BUS2110 (+20% effective employee working stats)
    const man = (Number(emp.manual_labor) || 0) * mult;
    const intel = (Number(emp.intelligence) || 0) * mult;
    const end = (Number(emp.endurance) || 0) * mult;
    const pairs = [
      [man, Number(pos.man_required) || 0],
      [intel, Number(pos.int_required) || 0],
      [end, Number(pos.end_required) || 0],
    ].filter(([, req]) => req > 0);
    if (!pairs.length) return 90;
    const raw = pairs.reduce((sum, [stat, req]) => sum + singleStatEff(stat, req), 0);
    // Single-stat positions scale up to 90 at 100% requirement
    const scaled = pairs.length === 1 ? raw * 2 : raw;
    return Math.floor(scaled + 1e-9);
  }

  // Exact Hungarian algorithm for maximizing total weight on an N x N matrix (minimizing max - weight)
  function hungarianMax(weights) {
    const n = weights.length;
    if (!n) return [];
    let maxW = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (weights[i][j] > maxW) maxW = weights[i][j];
    const u = new Array(n + 1).fill(0);
    const v = new Array(n + 1).fill(0);
    const p = new Array(n + 1).fill(0);
    const way = new Array(n + 1).fill(0);

    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Array(n + 1).fill(Infinity);
      const used = new Array(n + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = p[j0];
        let delta = Infinity;
        let j1 = 0;
        for (let j = 1; j <= n; j++) {
          if (used[j]) continue;
          const cost = maxW - weights[i0 - 1][j - 1];
          const cur = cost - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= n; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
          else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do {
        const j1 = way[j0];
        p[j0] = p[j1];
        j0 = j1;
      } while (j0);
    }
    const assign = new Array(n).fill(-1);
    for (let j = 1; j <= n; j++) if (p[j] > 0) assign[p[j] - 1] = j - 1;
    return assign;
  }

  function optimizeStaff(employees = [], positions = {}, slotCounts = null, opts = {}) {
    const posNames = Object.keys(positions || {});
    if (!employees.length || !posNames.length) {
      return { assignments: [], moves: [], currentTotal: 0, optimalTotal: 0, gain: 0, slotCounts: {} };
    }

    // Build target slot list: either custom slotCounts or preserve current distribution
    const slots = [];
    const effectiveCounts = {};
    if (slotCounts && Object.keys(slotCounts).length) {
      for (const name of posNames) {
        const cnt = Math.max(0, Math.floor(Number(slotCounts[name]) || 0));
        if (cnt > 0) effectiveCounts[name] = cnt;
        for (let k = 0; k < cnt; k++) slots.push(name);
      }
    } else {
      for (const e of employees) {
        const p = positions[e.position] ? e.position : posNames[0];
        effectiveCounts[p] = (effectiveCounts[p] || 0) + 1;
        slots.push(p);
      }
    }
    // If slot count differs from employee count, pad with best unrestricted role or trim
    while (slots.length < employees.length) {
      const bestFallback = posNames[0];
      slots.push(bestFallback);
      effectiveCounts[bestFallback] = (effectiveCounts[bestFallback] || 0) + 1;
    }
    const usedSlots = slots.slice(0, employees.length);

    // Build N x N weight matrix (small tie-breaker +0.01 for keeping current position so we never suggest pointless swaps)
    const n = employees.length;
    const matrix = Array.from({ length: n }, (_, i) => {
      const emp = employees[i];
      return usedSlots.map((posName) => {
        const base = workStatEfficiency(emp, positions[posName], opts);
        return base + (emp.position === posName ? 0.01 : 0);
      });
    });

    const match = hungarianMax(matrix);
    let currentTotal = 0;
    let optimalTotal = 0;
    const assignments = employees.map((emp, i) => {
      const recPos = usedSlots[match[i]];
      const curEff = positions[emp.position] ? workStatEfficiency(emp, positions[emp.position], opts) : 0;
      const recEff = workStatEfficiency(emp, positions[recPos], opts);
      // Also find employee's single best unconstrained position
      let bestPos = recPos, bestEff = recEff;
      for (const pn of posNames) {
        const sc = workStatEfficiency(emp, positions[pn], opts);
        if (sc > bestEff) { bestEff = sc; bestPos = pn; }
      }
      currentTotal += curEff;
      optimalTotal += recEff;
      return {
        id: emp.id,
        name: emp.name,
        currentPosition: emp.position,
        recommendedPosition: recPos,
        changed: emp.position !== recPos,
        currentEff: curEff,
        recommendedEff: recEff,
        delta: recEff - curEff,
        bestUnconstrainedPosition: bestPos,
        bestUnconstrainedEff: bestEff,
        actualTotalEff: emp.effectiveness?.total ?? null,
        addiction: emp.addiction ?? 0,
      };
    });

    const moves = assignments.filter((a) => a.changed).sort((a, b) => b.delta - a.delta);
    return {
      assignments,
      moves,
      currentTotal,
      optimalTotal,
      gain: optimalTotal - currentTotal,
      slotCounts: effectiveCounts,
    };
  }

  return Object.freeze({ singleStatEff, workStatEfficiency, hungarianMax, optimizeStaff });
});
