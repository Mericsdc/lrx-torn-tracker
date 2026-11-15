(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXLevelling = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  // Baldr's Levelling Targets rules, shared by the server (which target its slow status scan checks next) and the page
  // (what it shows). A target is a list row { id, lvl, total, str, def, spd, dex } with, on the page, its last known
  // `status` { state, until } (until in seconds) or null when not checked yet. Attack EXP grows with the target's level,
  // and a lost attack gives none, so the best targets are the highest-level ones you can beat.
  const BEST = 3;                 // targets marked "Best EXP"
  const TOP = 10;                 // the first rows of the page, kept the freshest
  const TOP_MS = 45_000;          // a top attackable target is checked again after this
  const OKAY_MS = 180_000;        // any other attackable target
  const OTHER_MS = 360_000;       // travelling, unknown and the like
  const HOT_MS = 15_000;          // a target you just attacked, while it is hot
  const HOT_FOR_MS = 120_000;     // how long a target stays hot after you press Attack
  const FRESH_TTL_MS = 10_000;    // the scan's own cache for one status reply: shorter than every wait above

  // A known state in which the target cannot be attacked now. A hospital or jail stay that is over is not: the target
  // is shown again and checked soon. Unknown means the check failed, so the target stays in the list.
  function blocked(status, nowSec) {
    const s = status?.state;
    if (!s || s === 'Okay' || s === 'Unknown' || s === '?') return false;
    if ((s === 'Hospital' || s === 'Jail') && status.until) return status.until > nowSec;
    return true;
  }
  // Each of the target's stats that is at or above the one of yours it faces: its defense against your strength, its
  // dexterity against your speed, its strength against your defense and its speed against your dexterity.
  const FACES = [['str', 'def'], ['def', 'str'], ['spd', 'dex'], ['dex', 'spd']];
  function stronger(t, mine) {
    if (!mine) return [];
    return FACES.filter(([theirs, yours]) => Number(t[theirs]) >= mine[yours]).map(([theirs]) => theirs);
  }
  // Your effective stats now (overview battle stats), or null when any is missing.
  function mineFrom(battle) {
    const s = battle?.stats, v = (k) => Number(s?.[k]?.current) || 0;
    const mine = { str: v('strength'), def: v('defense'), spd: v('speed'), dex: v('dexterity') };
    return Object.values(mine).every((n) => n > 0) ? mine : null;
  }
  // The page's rows: attackable targets you can beat (highest level first, the lower total on a tie), then attackable
  // ones whose stats match or beat yours, then those not checked yet. Targets that cannot be attacked now are left out.
  function order(targets, mine, nowSec) {
    const shown = targets.filter((t) => !blocked(t.status, nowSec));
    const group = (t) => (t.status?.state === 'Okay' ? (stronger(t, mine).length ? 1 : 0) : 2);
    const rows = shown.map((t) => ({ t, g: group(t) }))
      .sort((a, b) => a.g - b.g || b.t.lvl - a.t.lvl || a.t.total - b.t.total)
      .map((x) => x.t);
    const best = rows.filter((t) => group(t) === 0).slice(0, BEST).map((t) => t.id);
    return { rows, best, blocked: targets.length - shown.length };
  }
  // The scan's next target, or null when every status is fresh enough. `statusOf(id)` gives the last check
  // { state, until, at } (at in ms); `hot` maps the ids you just attacked to when they stop being hot.
  function nextToCheck(list, statusOf, { mine = null, nowMs, hot = new Map() } = {}) {
    const nowSec = nowMs / 1000;
    const known = list.map((r) => {
      const rec = statusOf(r.id);
      return { ...r, rec, status: rec && rec.state !== 'Unknown' ? { state: rec.state, until: rec.until } : null };
    });
    const top = new Set(order(known, mine, nowSec).rows.slice(0, TOP).map((t) => t.id));
    const isHot = (id) => (hot.get(id) || 0) > nowMs;
    const stale = (t) => {
      const rec = t.rec;
      if (!rec) return true;
      if ((rec.state === 'Hospital' || rec.state === 'Jail') && rec.until) return rec.until * 1000 <= nowMs;
      const age = nowMs - rec.at;
      if (rec.state === 'Okay') return age > (isHot(t.id) ? HOT_MS : top.has(t.id) ? TOP_MS : OKAY_MS);
      return age > (isHot(t.id) ? HOT_MS : OTHER_MS);
    };
    const byLevel = (a, b) => b.lvl - a.lvl;
    const due = known.filter(stale);
    const pick = due.filter((t) => isHot(t.id)).sort(byLevel)[0]
      || due.filter((t) => t.rec && top.has(t.id)).sort(byLevel)[0]
      || due.filter((t) => !t.rec).sort(byLevel)[0]
      || due.sort(byLevel)[0];
    return pick ? pick.id : null;
  }

  return Object.freeze({ BEST, TOP, TOP_MS, OKAY_MS, OTHER_MS, HOT_MS, HOT_FOR_MS, FRESH_TTL_MS, blocked, stronger, mineFrom, order, nextToCheck });
});
