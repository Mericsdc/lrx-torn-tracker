/* Pure Ranked War Payout Planner & CSV Export engine (UMD: browser global + Node/Vitest require).
   Supports pool split (% by respect / % by hits), faction treasury cut, minimum-hit qualification,
   per-member payout caps with fair overflow redistribution, Torn Bank pay links and safe CSV export. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXWarPayout = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function bankPayUrl(playerId, amount) {
    const id = Math.floor(Number(playerId) || 0);
    const money = Math.max(0, Math.round(Number(amount) || 0));
    if (!(id > 0) || !(money > 0)) return null;
    return `https://www.torn.com/factions.php?step=your#/tab=controls&addMoneyTo=${id}&money=${money}`;
  }

  function calculatePayouts(members = [], opts = {}) {
    const mode = opts.mode === 'fixed' ? 'fixed' : 'pool';
    const totalPool = Math.max(0, Number(opts.totalPool) || 0);
    const factionCutPct = Math.min(100, Math.max(0, Number(opts.factionCutPct) || 0));
    const respectWeightPct = Math.min(100, Math.max(0, opts.respectWeightPct == null ? 70 : Number(opts.respectWeightPct)));
    const hitsWeightPct = 100 - respectWeightPct;
    const minHits = Math.max(0, Math.floor(Number(opts.minHits) || 0));
    const maxCap = Number(opts.maxCap) > 0 ? Number(opts.maxCap) : 0;
    const perHit = Math.max(0, Number(opts.perHit) || 0);
    const perRespect = Math.max(0, Number(opts.perRespect) || 0);

    const clean = (members || []).map((m) => ({
      id: Number(m.id) || 0,
      name: String(m.name || `#${m.id || 0}`),
      level: Number(m.level) || 0,
      hits: Math.max(0, Number(m.attacks ?? m.hits) || 0),
      respect: Math.max(0, Number(m.score ?? m.respect) || 0),
    }));

    const factionCut = mode === 'pool' ? Math.round(totalPool * (factionCutPct / 100)) : 0;
    const distributable = mode === 'pool' ? Math.max(0, totalPool - factionCut) : 0;

    const qualified = clean.filter((m) => m.hits >= minHits && (m.hits > 0 || m.respect > 0));
    const totalHits = qualified.reduce((a, m) => a + m.hits, 0);
    const totalRespect = qualified.reduce((a, m) => a + m.respect, 0);

    // Base weight for each qualified member
    const weights = new Map();
    for (const m of qualified) {
      const rShare = totalRespect > 0 ? m.respect / totalRespect : 0;
      const hShare = totalHits > 0 ? m.hits / totalHits : 0;
      let w;
      if (totalRespect > 0 && totalHits > 0) w = (respectWeightPct / 100) * rShare + (hitsWeightPct / 100) * hShare;
      else if (totalRespect > 0) w = rShare;
      else if (totalHits > 0) w = hShare;
      else w = 0;
      weights.set(m.id, w);
    }

    const payouts = new Map();
    const cappedSet = new Set();

    if (mode === 'fixed') {
      for (const m of qualified) {
        let p = m.hits * perHit + m.respect * perRespect;
        if (maxCap > 0 && p > maxCap) { p = maxCap; cappedSet.add(m.id); }
        payouts.set(m.id, Math.round(p));
      }
    } else if (distributable > 0 && qualified.length) {
      // Iterative water-filling so capped members receive maxCap and surplus redistributes proportionally
      let remainingPool = distributable;
      const uncapped = new Set(qualified.map((m) => m.id));
      for (let iter = 0; iter < qualified.length + 1 && uncapped.size > 0; iter++) {
        let wSum = 0;
        for (const id of uncapped) wSum += weights.get(id) || 0;
        if (!(wSum > 0)) break;
        let hitCap = false;
        for (const id of [...uncapped]) {
          const share = remainingPool * ((weights.get(id) || 0) / wSum);
          if (maxCap > 0 && share > maxCap) {
            payouts.set(id, Math.round(maxCap));
            cappedSet.add(id);
            uncapped.delete(id);
            remainingPool = Math.max(0, remainingPool - Math.round(maxCap));
            hitCap = true;
          }
        }
        if (!hitCap) {
          for (const id of uncapped) {
            payouts.set(id, Math.round(remainingPool * ((weights.get(id) || 0) / wSum)));
          }
          remainingPool = 0;
          break;
        }
      }
    }

    const rows = clean.map((m) => {
      const qual = m.hits >= minHits && (m.hits > 0 || m.respect > 0);
      const payout = qual ? (payouts.get(m.id) || 0) : 0;
      const avgRespect = m.hits > 0 ? m.respect / m.hits : 0;
      return {
        ...m,
        avgRespect,
        qualified: qual,
        capped: cappedSet.has(m.id),
        payout,
        sharePct: 0,
        payUrl: bankPayUrl(m.id, payout),
      };
    });

    const totalPaid = rows.reduce((a, r) => a + r.payout, 0);
    for (const r of rows) r.sharePct = totalPaid > 0 ? (r.payout / totalPaid) * 100 : 0;
    rows.sort((a, b) => b.payout - a.payout || b.respect - a.respect || b.hits - a.hits);

    return {
      rows,
      summary: {
        mode,
        totalPool: mode === 'pool' ? totalPool : totalPaid,
        factionCut,
        distributable: mode === 'pool' ? distributable : totalPaid,
        totalPaid,
        unallocated: mode === 'pool' ? Math.max(0, distributable - totalPaid) : 0,
        membersCount: clean.length,
        qualifiedCount: qualified.length,
        cappedCount: cappedSet.size,
        totalHits,
        totalRespect,
      },
    };
  }

  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralize spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(result, meta = {}) {
    const header = ['Rank', 'Player', 'ID', 'Level', 'Hits', 'Respect', 'Avg Respect', 'Share %', 'Payout ($)', 'Status'];
    const lines = [header.map(csvCell).join(',')];
    (result?.rows || []).forEach((r, idx) => {
      const status = !r.qualified ? 'Below min hits' : r.capped ? 'Capped' : 'Qualified';
      lines.push([
        idx + 1, r.name, r.id, r.level, r.hits, r.respect.toFixed(2), r.avgRespect.toFixed(2),
        r.sharePct.toFixed(2), r.payout, status,
      ].map(csvCell).join(','));
    });
    if (meta.warTitle) lines.unshift(`# ${csvCell(meta.warTitle)}`);
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  function toTextSummary(result, warTitle = 'Ranked War Payout') {
    const s = result.summary;
    const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
    const lines = [
      `⚔ ${warTitle}`,
      `Pool: ${money(s.totalPool)} · Faction cut: ${money(s.factionCut)} · Paid: ${money(s.totalPaid)} (${s.qualifiedCount}/${s.membersCount} qualified)`,
      '',
    ];
    for (const r of result.rows) {
      if (!r.payout) continue;
      lines.push(`• ${r.name} [${r.id}]: ${money(r.payout)} (${r.hits} hits · ${r.respect.toFixed(1)} respect${r.capped ? ' · capped' : ''})`);
    }
    return lines.join('\n');
  }

  return Object.freeze({ bankPayUrl, calculatePayouts, toCsv, toTextSummary });
});
