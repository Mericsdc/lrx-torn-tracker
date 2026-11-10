const STATS = ['strength', 'defense', 'speed', 'dexterity'];
const XANAX_PENALTY = 35;
function parseInfo(lines) {
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const text = String(line);
    const normalized = text.replace(/[−–]/g, '-').replace(/&#(?:8722|45);|&minus;/g, '-');
    const match = normalized.match(/([+-]?)\s*(\d+(?:\.\d+)?)\s*%/);
    return { text, pct: match ? Number((match[1] || '') + match[2]) : 0, xanax: /\bxanax\b/i.test(text) && !/addiction/i.test(text) };
  });
}
function buildBattleStats(user) {
  const parsed = Object.fromEntries(STATS.map((key) => [key, parseInfo(user[`${key}_info`])]));
  const drugIcon = Object.values(user.icons || {}).map(String).find((text) => /^drug\b|drug cooldown/i.test(text)) || '';
  const fromIcon = /\bxanax\b/i.test(drugIcon) && Number(user.cooldowns?.drug) > 0;
  // The v1 info array may say "from Drugs", without naming Xanax. Require
  // the -35% pattern on ALL four stats, so Cannabis's -35% speed is not Xanax.
  const genericXanax = Number(user.cooldowns?.drug) > 0 && STATS.every((key) => parsed[key].some((i) =>
    i.pct === -35 && /\bdrugs?\b/i.test(i.text) && !/addiction/i.test(i.text)));
  const explicitXanax = STATS.some((key) => parsed[key].some((i) => i.xanax && i.pct < 0));
  const xanaxActive = fromIcon || genericXanax || explicitXanax;
  const out = { stats: {}, totals: { base: 0, current: 0, noXanax: 0, withXanax: 0 }, xanaxActive, calculationVersion: 2 };
  for (const key of STATS) {
    const raw = Math.max(0, Number(user[key]) || 0);
    const modifier = Number(user[`${key}_modifier`]) || 0;
    const info = parsed[key];
    // modifier already includes the active drug. Remove it once, then build
    // both scenarios from raw stats. Keep addiction and all other modifiers.
    const namedPenalty = info.filter((i) => i.xanax && i.pct < 0).reduce((total, i) => total + i.pct, 0);
    const appliedPenalty = namedPenalty || (xanaxActive ? -XANAX_PENALTY : 0);
    const noXanaxModifier = modifier - appliedPenalty;
    const withXanaxModifier = noXanaxModifier - XANAX_PENALTY;
    const effective = (mod) => Math.round(raw * Math.max(0, 1 + mod / 100));
    const stat = { base: raw, modifier, info, current: effective(modifier), noXanax: effective(noXanaxModifier), withXanax: effective(withXanaxModifier), noXanaxModifier, withXanaxModifier };
    out.stats[key] = stat;
    for (const total of Object.keys(out.totals)) out.totals[total] += stat[total];
  }
  return out;
}
module.exports = { buildBattleStats, parseInfo };
