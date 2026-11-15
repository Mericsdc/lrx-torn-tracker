import { describe, expect, it } from 'vitest';
import m from '../../public/merit-guide.js';

// Merit Tracker guidance: groups, how-to lines, series tiers, order, easy wins and empty-list reasons.
// Award objects have the /api/awards shape; stat / what come from the server's award rules.
const fmt = { num: (n) => Math.round(n).toLocaleString('en-US'), money: (n) => '$' + Math.round(n).toLocaleString('en-US') };
const NOW = Date.UTC(2026, 10, 14, 12); // 14 Nov 2026, 12:00 TCT
let nextId = 1;
function aw(o) {
  const a = { id: nextId++, kind: 'honor', name: 'Award', description: '', type: '', rarity: '', circulation: 0, owned: false,
    goal: null, cur: null, pct: null, stat: null, what: null, ...o };
  if (a.goal != null && a.cur != null && o.pct === undefined) a.pct = Math.min(1, a.cur / a.goal);
  return a;
}
const isPair = (p) => Array.isArray(p) && p.length === 2 && p.every((t) => typeof t === 'string' && t.trim().length > 0);
const g = (o, now = NOW) => m.guide(aw(o), fmt, now);

const THEFT = { name: 'Looting Luminary', description: 'Commit 4,000 Theft offenses', type: 'crime', stat: 'crimes.offenses.theft', what: 'Theft', goal: 4000, cur: 3829, circulation: 100591 };
const SMG = { name: 'Act Of Faith', description: 'Achieve 100 finishing hits with SMGs', type: 'weapons', stat: 'finishing_hits.sub_machine_guns', what: 'SMGs', goal: 100, cur: 92, circulation: 66281 };
const FRAUD = { name: 'Fraudster', description: 'Commit 100 Fraud offenses', type: 'crime', stat: 'crimes.offenses.fraud', what: 'Fraud', goal: 100, cur: 2, circulation: 50000 };
const YEAR = { kind: 'medal', name: 'One Year of Service', description: 'Live in Torn for one year', type: 'commitment', stat: 'age', goal: 365, cur: 326, circulation: 387758 };
const PROTEGE = { name: 'Protege', description: 'Complete the mission Introduction: Duke', type: 'missions', circulation: 275340 };
const TROUT = { name: 'Gone Fishing', description: 'Be defeated by a trout', type: 'weapons', circulation: 193957 };
const RNG = { name: 'RNG', description: 'Who knows?', type: 'misc', circulation: 51226 };
const MUG = { name: 'Blood Money', description: 'Make $1,000,000 from a single mugging', type: 'attacking', stat: 'attacking.networth.largest_mug', goal: 1_000_000, cur: 826_937, circulation: 100647 };
const L45 = { kind: 'medal', name: 'Level Forty Five', description: 'Reach level Forty Five', type: 'level', stat: 'level', goal: 45, cur: 42, circulation: 68973 };
const L50H = { name: 'Half Way There', description: 'Reach level 50', type: 'level', stat: 'level', goal: 50, cur: 42, circulation: 58957 };
const L50M = { kind: 'medal', name: 'Level Fifty', description: 'Reach level Fifty', type: 'level', stat: 'level', goal: 50, cur: 42, circulation: 58955 };
const MASTER = { kind: 'medal', name: 'Master', description: 'Reach the rank of Master', type: 'rank', stat: 'rank', what: 'Master', goal: 16, cur: 15, circulation: 68009 };
const TOKEN = { name: 'Globule', description: 'Purchased from Token Shop or Points Building', type: 'competitions', circulation: 42902 };
const EASTER = { name: 'Good Friday', description: 'Find and collect 10 Easter eggs', type: 'competitions', circulation: 66504 };
const BACHELOR = { name: 'Sports Bachelor', description: 'Complete all classes in Sports Science', type: 'education', circulation: 98494 };
const TORNIVERSARY = { name: 'Torniversary', description: 'Login on November 15th', type: 'commitment', circulation: 176128 };

describe('every text is a TR/EN pair', () => {
  it('group labels, show labels and empty reasons', () => {
    for (const k of ['all', ...m.GROUPS]) expect(isPair(m.GROUP_LABEL[k]), k).toBe(true);
    for (const k of m.GROUPS) expect(isPair(m.EMPTY[k]), k).toBe(true);
    for (const k of ['count', 'time', 'once']) expect(isPair(m.EASY_EMPTY[k]), k).toBe(true);
    expect(isPair(m.EMPTY.all)).toBe(true);
    expect(isPair(m.EMPTY.filtered)).toBe(true);
  });
  it('every how-line and place label', () => {
    for (const o of [THEFT, SMG, YEAR, PROTEGE, RNG, MUG, L45, MASTER, TOKEN, EASTER, BACHELOR, TORNIVERSARY]) {
      const r = g(o);
      expect(isPair(r.how), o.name).toBe(true);
      if (r.place) expect(isPair(r.place.label), o.name).toBe(true);
    }
  });
});

describe('groups', () => {
  it('a counter you raise by doing things is "count"', () => {
    expect(g(THEFT).group).toBe('count');
    expect(g(SMG).group).toBe('count');
    expect(g(FRAUD).group).toBe('count');
  });
  it('days that pass by themselves are "time"', () => {
    expect(g(YEAR).group).toBe('time');
    expect(g({ ...YEAR, stat: 'married', goal: 300, cur: 261 }).group).toBe('time');
    expect(g({ ...YEAR, stat: 'faction', goal: 300, cur: 7 }).group).toBe('time');
    expect(g({ ...YEAR, stat: 'other.donator_days', goal: 500, cur: 312 }).group).toBe('time');
    expect(g({ ...YEAR, stat: 'other.activity.streak.best', goal: 100, cur: 30 }).group).toBe('time');
    expect(g(TORNIVERSARY).group).toBe('time');
  });
  it('awards without a counter are "once"; Torn\'s secret ones are flagged', () => {
    expect(g(PROTEGE).group).toBe('once');
    expect(g(PROTEGE).secret).toBe(false);
    expect(g(RNG).group).toBe('once');
    expect(g(RNG).secret).toBe(true);
    expect(g({ name: 'Nice', description: 'Nice', type: 'misc' }).secret).toBe(true);
  });
  it('single-best stats are "record"', () => {
    expect(g(MUG).group).toBe('record');
    expect(g({ stat: 'attacking.killstreak.best', goal: 100, cur: 56 }).group).toBe('record');
    expect(g({ stat: 'attacking.damage.best', goal: 5000, cur: 2478 }).group).toBe('record');
  });
  it('level, rank, gym and other grinds are "long"', () => {
    for (const stat of ['level', 'rank', 'education', 'other.awards', 'networth.total', 'battle_stats.strength', 'battle_stats.total',
      'jobs.stats.endurance', 'crimes.skills.graffiti', 'racing.skill', 'travel.hunting.skill', 'travel.time_spent', 'investments.stocks.profits']) {
      expect(g({ stat, goal: 100, cur: 10 }).group, stat).toBe('long');
    }
    expect(g(BACHELOR).group).toBe('long');
    expect(g({ stat: 'jobs.stats.endurance|jobs.stats.intelligence|jobs.stats.manual', goal: 10000, cur: 9000 }).group).toBe('long');
  });
  it('a stat without goal or current value does not break the page', () => {
    expect(() => g({ stat: 'level', goal: null, cur: null, description: 'Reach level 50' })).not.toThrow();
    expect(() => g({ stat: 'age', goal: null, cur: null, description: 'Live in Torn for one year' })).not.toThrow();
  });
  it('a counter without a stat id (an older server) is still "count", with Torn\'s text and the amount left', () => {
    const r = g({ ...THEFT, stat: null, what: null });
    expect(r.group).toBe('count');
    expect(r.how[1]).toBe('171 more to go: Commit 4,000 Theft offenses');
  });
  it('competitions and Token Shop bars are "event"', () => {
    expect(g(TOKEN).group).toBe('event');
    expect(g(EASTER).group).toBe('event');
  });
});

describe('how-to lines', () => {
  it('say how many more and of what, in both languages', () => {
    const r = g(THEFT);
    expect(r.how[1]).toBe('Commit 171 more Theft offenses.');
    expect(r.how[0]).toContain('171');
    expect(r.how[0]).toContain('Theft');
    expect(g(SMG).how[1]).toBe('Finish 8 more fights with SMGs (finishing hits).');
    expect(g({ ...THEFT, stat: 'travel.japan', what: 'Japan', goal: 50, cur: 12 }).how[1]).toBe('Fly to Japan 38 more times.');
  });
  it('format money stats as money', () => {
    expect(g(MUG).how[1]).toContain('$1,000,000');
    expect(g(MUG).how[1]).toContain('$826,937');
    expect(g({ stat: 'bounties.collected.value', goal: 10_000_000, cur: 720_021 }).how[1]).toContain('$9,279,979');
  });
  it('time awards say the days left', () => {
    const r = g(YEAR);
    expect(r.days).toBe(39);
    expect(r.how[1]).toBe('Comes by itself in 39 days.');
    expect(r.side[1]).toBe('in 39 days');
    expect(g({ ...YEAR, stat: 'married', goal: 300, cur: 261 }).how[1]).toBe('Stay married 39 more days.');
  });
  it('no countdown when the counter is not running or the days cannot be known', () => {
    expect(g({ ...YEAR, stat: 'married', goal: 50, cur: 0 }).days).toBe(null); // not married
    expect(g({ ...YEAR, stat: 'faction', goal: 100, cur: 0 }).days).toBe(null); // no faction
    expect(g({ ...YEAR, stat: 'other.donator_days', goal: 500, cur: 312 }).days).toBe(null); // donator status unknown
    expect(g({ ...YEAR, stat: 'other.activity.streak.best', goal: 100, cur: 95 }).days).toBe(null); // best, not current streak
    const e = m.easyWins([{ ...YEAR, name: 'Single', stat: 'married', goal: 50, cur: 0 }, { ...YEAR, name: 'Streak', stat: 'other.activity.streak.best', goal: 100, cur: 95 }].map(aw), fmt, NOW);
    expect(e.time).toEqual([]);
  });
  it('English says 1 day / 1 more offense / 1 more time', () => {
    expect(g({ ...YEAR, cur: 364 }).how[1]).toBe('Comes by itself in 1 day.');
    expect(g({ ...THEFT, cur: 3999 }).how[1]).toBe('Commit 1 more Theft offense.');
    expect(g({ ...THEFT, stat: 'travel.japan', what: 'Japan', goal: 50, cur: 49 }).how[1]).toBe('Fly to Japan 1 more time.');
    expect(g({ stat: 'jail.busts.success', goal: 100, cur: 99 }).how[1]).toBe('Bust 1 more person out of jail.');
    expect(g({ stat: 'bounties.collected.amount', goal: 25, cur: 24 }).how[1]).toBe('Collect 1 more bounty.');
  });
  it('a login date counts the days to the next one (TCT)', () => {
    expect(g(TORNIVERSARY).days).toBe(1);
    expect(g(TORNIVERSARY).how[1]).toBe('Log in to Torn tomorrow (15 November).');
    expect(g(TORNIVERSARY, Date.UTC(2026, 10, 15, 23)).days).toBe(0);
    expect(g(TORNIVERSARY, Date.UTC(2026, 10, 16, 1)).days).toBe(364);
    expect(g({ ...TORNIVERSARY, description: 'Login on January 1st' }, Date.UTC(2026, 11, 31, 8)).days).toBe(1);
  });
  it('one-time awards quote Torn\'s own text; secret ones say Torn does not tell', () => {
    expect(g(PROTEGE).how[1]).toBe('Complete the mission Introduction: Duke');
    expect(g(PROTEGE).side[1]).toBe('275,340 players have it');
    expect(g(RNG).how[1]).toBe('Secret award: Torn does not say how to get it.');
  });
  it('rank and level say where they stand', () => {
    expect(g(MASTER).how[1]).toContain('Master');
    expect(g(L45).how[1]).toBe('Reach level 45 (now 42): 3 levels to go.');
  });
  it('an unknown stat falls back to Torn\'s text with the remaining amount', () => {
    expect(g({ description: 'Do 50 strange things', stat: 'other.strange', goal: 50, cur: 20 }).how[1]).toBe('30 more to go: Do 50 strange things');
  });
  it('every stat the server rules read has its own line', () => {
    const stats = ['attacking.hits.critical', 'attacking.hits.success', 'attacking.hits.one_hit_kills', 'attacking.attacks.assist',
      'bounties.collected.amount', 'attacking.damage.total', 'attacking.ammunition.total', 'attacking.attacks.stealth',
      'attacking.attacks.stalemate|attacking.defends.stalemate', 'attacking.defends.won', 'attacking.unarmored_wins',
      'attacking.attacks.won', 'attacking.faction.respect', 'attacking.escapes.foes', 'attacking.escapes.player',
      'other.activity.time', 'crimes.offenses.total', 'crimes.offenses.organized_crimes', 'drugs.xanax',
      'jobs.stats.endurance|jobs.stats.intelligence|jobs.stats.manual', 'hospital.blood_withdrawn', 'hospital.times_hospitalized',
      'hospital.reviving.revives', 'hospital.medical_items_used', 'items.used.alcohol', 'items.used.energy_drinks', 'items.used.candy',
      'items.found.city', 'items.found.dump', 'trading.bazaar.customers', 'items.used.books', 'items.trashed', 'trading.items.auctions.won',
      'jail.busts.success', 'jail.times_jailed', 'jail.bails.amount', 'items.viruses_coded', 'racing.points', 'racing.races.won',
      'other.refills.energy', 'other.refills.nerve', 'other.refills.token', 'trading.points.sold', 'jobs.job_points_used',
      'missions.contracts.total', 'missions.credits', 'investments.stocks.losses', 'investments.stocks.payouts', 'travel.attacks_won',
      'travel.items_bought', 'travel.total', 'attacking.ammunition.special', 'attacking.ammunition.hollow_point',
      'finishing_hits.heavy_artillery|finishing_hits.machine_guns', 'faction', 'married', 'other.donator_days'];
    for (const stat of stats) {
      const r = g({ description: 'Raw Torn text', stat, what: 'Thing', goal: 100, cur: 10 });
      expect(r.how[1], stat).not.toContain('Raw Torn text');
      expect(r.how[0], stat).not.toContain('Raw Torn text');
    }
  });
});

// Turkish lines never carry an English sentence or a plain English word; Torn's own names (crimes, drugs, ranks, award
// names) stay, game terms get the English in brackets so the player finds them in Torn.
describe('Turkish lines are Turkish', () => {
  const ENGLISH_DESC = /\b(the|with|your|while|someone|from)\b/i; // checked after Torn names like "Torn of the Dead" are taken out
  it('one-time awards get a Turkish line; English keeps Torn\'s text', () => {
    expect(g(PROTEGE).how).toEqual(['“Introduction: Duke” görevini tamamla.', 'Complete the mission Introduction: Duke']);
    expect(g(TROUT).how[0]).toBe('Bir alabalığa (trout) yenil.');
    expect(g({ name: 'Lame', description: 'Won while spinning the Wheel of Lame', type: 'casino' }).how[0]).toBe('Wheel of Lame çarkını çevirirken kazan.');
  });
  it('Torn\'s text matches without extra spaces or a final period', () => {
    expect(g({ description: 'Hospitalize yourself by using the wrong blood bag or drinking some Ipecac Syrup.', type: 'hospital' }).how[0])
      .toBe('Yanlış kan torbası kullanarak ya da Ipecac Syrup içerek kendini hastanelik et.');
    expect(g({ description: 'Defeat someone who has more battle stats than you in a solo attack   ', type: 'attacking' }).how[1])
      .toBe('Defeat someone who has more battle stats than you in a solo attack');
  });
  it('an award the app does not know yet shows Torn\'s text as a quote, not inside a Turkish sentence', () => {
    expect(g({ description: 'Pet a dragon', type: 'misc' }).how).toEqual(['Torn\'un açıklaması: “Pet a dragon”', 'Pet a dragon']);
  });
  it('event awards', () => {
    expect(g(EASTER).how).toEqual(['Etkinlik ödülü, yalnızca etkinlik sürerken alınır: 10 Paskalya yumurtası bul ve topla.',
      'Event award, only while the event runs: Find and collect 10 Easter eggs']);
  });
  it('every Turkish award line is a full sentence of its own', () => {
    const entries = Object.entries(m.DESC_TR);
    expect(entries.length).toBeGreaterThan(140);
    for (const [en, trLine] of entries) {
      expect(trLine.trim(), en).toBe(trLine);
      expect(trLine.endsWith('.'), en).toBe(true);
      expect(trLine, en).not.toBe(en);
      expect(trLine.replace(/Torn of the Dead/g, ''), en).not.toMatch(ENGLISH_DESC);
    }
  });
  it('an older server\'s counter without a stat says the amount left in Turkish', () => {
    expect(g({ ...THEFT, stat: null, what: null }).how[0]).toBe('Hedefe 171 kaldı.');
  });
  it('countries', () => {
    expect(g({ stat: 'travel.japan', what: 'Japan', goal: 50, cur: 12 }).how[0]).toBe('Japonya\'ya 38 kez daha uç.');
    expect(g({ stat: 'travel.united_kingdom', what: 'United Kingdom', goal: 50, cur: 48 }).how)
      .toEqual(['Birleşik Krallık\'a 2 kez daha uç.', 'Fly to the United Kingdom 2 more times.']);
    for (const c of ['Mexico', 'Cayman Islands', 'Canada', 'United Kingdom', 'Argentina', 'Switzerland', 'Japan', 'China',
      'United Arab Emirates', 'South Africa']) {
      expect(g({ stat: 'travel.x', what: c, goal: 50, cur: 1 }).how[0], c).not.toContain(c);
    }
  });
  it('weapon classes', () => {
    expect(g(SMG).how[0]).toBe('SMG\'lerle 8 dövüşü daha bitir (finishing hit).');
    expect(g({ stat: 'finishing_hits.hand_to_hand', what: 'fists or kick', goal: 100, cur: 90 }).how[0]).toBe('Yumruk ya da tekmeyle 10 dövüşü daha bitir (finishing hit).');
    for (const w of ['mechanical weapons', 'heavy artillery', 'clubbing weapons', 'temporary weapons', 'machine guns', 'pistols', 'rifles',
      'shotguns', 'piercing weapons', 'slashing weapons']) {
      expect(g({ stat: 'finishing_hits.x', what: w, goal: 100, cur: 1 }).how[0], w).not.toMatch(new RegExp(`${w} ile`));
    }
  });
  it('crime categories, battle stats, working stats and education fields', () => {
    expect(g(THEFT).how[0]).toBe('Hırsızlık (Theft) türünde 171 suç daha işle.');
    expect(g({ stat: 'battle_stats.speed', what: 'speed', goal: 10, cur: 1 }).how[0]).toBe('Gym\'de 9 hız (speed) daha kazan.');
    expect(g({ stat: 'jobs.stats.manual', goal: 100, cur: 10 }).how[0]).toBe('İşinde her gün çalışarak 90 el emeği (manual labor) daha kazan.');
    expect(g({ stat: 'battle_stats.total', goal: 100, cur: 10 }).how[0]).toBe('Gym\'de toplam 90 savaş statı (battle stat) daha kazan.');
    expect(g(BACHELOR).how[0]).toBe('Eğitim sayfasında Spor Bilimi (Sports Science) bölümündeki bütün kursları bitir.');
  });
  it('the ending after a number follows how it is read: 10\'a, 50\'ye, 100\'e', () => {
    const cases = [[0, 'a'], [1, 'e'], [2, 'ye'], [3, 'e'], [6, 'ya'], [7, 'ye'], [9, 'a'], [10, 'a'], [20, 'ye'], [25, 'e'], [30, 'a'],
      [40, 'a'], [50, 'ye'], [60, 'a'], [70, 'e'], [80, 'e'], [90, 'a'], [100, 'e'], [250, 'ye'], [1000, 'e'], [10000, 'e'],
      [1_000_000, 'a'], [2_500_000, 'e'], [1_000_000_000, 'a']];
    for (const [n, s] of cases) expect(m.trDative(n), String(n)).toBe(s);
    expect(g({ stat: 'racing.skill', goal: 10, cur: 3 }).how[0]).toBe('Yarışarak racing skill\'ini 10\'a çıkar (şu an 3).');
    expect(g({ stat: 'travel.hunting.skill', goal: 50, cur: 3 }).how[0]).toContain('50\'ye çıkar');
    expect(g({ stat: 'crimes.skills.graffiti', what: 'Graffiti', goal: 100, cur: 3 }).how[0]).toContain('100\'e çıkar');
  });
  it('personal bests say "en iyi sonucun"', () => {
    expect(g(MUG).how[0]).toBe('Tek bir mug\'da $1,000,000 kazan (en iyi sonucun: $826,937).');
  });
  it('place buttons are Turkish', () => {
    expect(g(THEFT).place.label).toEqual(['Suçlar', 'Crimes']);
    expect(g(PROTEGE).place.label).toEqual(['Görevler', 'Missions']);
    expect(g({ stat: 'jail.busts.success', goal: 100, cur: 99 }).place.label).toEqual(['Hapishane', 'Jail']);
  });
  it('award types and rarities have TR/EN labels', () => {
    expect(m.typeLabel('attacking')).toEqual(['Saldırı', 'Attacking']);
    expect(m.typeLabel('zzz')).toEqual(['zzz', 'zzz']);
    for (const t of ['items', 'money', 'misc', 'hospital', 'travel', 'level', 'attacking', 'drugs', 'weapons', 'camo', 'education', 'commitment',
      'competitions', 'gym', 'casino', 'jail', 'crimes', 'missions', 'rank', 'miscellaneous', 'networth', 'combat', 'crime']) {
      const p = m.typeLabel(t);
      expect(isPair(p), t).toBe(true);
      expect(p[0], t).not.toBe(t);
    }
    expect(m.rarityLabel('Very Rare')).toEqual(['Çok nadir', 'Very Rare']);
    expect(m.rarityLabel('')).toBe(null);
    for (const r of ['Very Common', 'Common', 'Extremely Rare', 'Uncommon', 'Rare', 'Limited', 'Very Rare', 'Unknown Rarity']) {
      expect(m.rarityLabel(r)[0], r).not.toBe(r);
    }
  });
});

describe('places', () => {
  it('link the Torn page where the work is done when the app knows it', () => {
    expect(g(THEFT).place.url).toBe('https://www.torn.com/page.php?sid=crimes');
    expect(g(PROTEGE).place.label[1]).toBe('Missions');
    expect(g({ stat: 'battle_stats.speed', what: 'speed', goal: 10, cur: 1 }).place.url).toBe('https://www.torn.com/gym.php');
  });
  it('attacks have a label but no link', () => {
    expect(g(SMG).place.label[1]).toBe('Attacks');
    expect(g(SMG).place.url).toBe(null);
  });
  it('a secret award has no place', () => {
    expect(g(RNG).place).toBe(null);
  });
});

describe('series and tiers', () => {
  const list = [L45, L50H, L50M, { ...L50H, name: 'Level Fifty Five', goal: 55 }, THEFT].map(aw);
  it('only the lowest missing goal of a series is shown by default; ties stay', () => {
    const v = m.view(list, { show: 'all' }, fmt, NOW);
    expect(v.rows.map((r) => r.name)).toEqual(expect.arrayContaining(['Level Forty Five', 'Looting Luminary']));
    expect(v.rows.map((r) => r.name)).not.toContain('Half Way There');
    expect(v.hidden).toBe(3);
  });
  it('the tiers switch shows the higher ones too', () => {
    const v = m.view(list, { show: 'all', tiers: true }, fmt, NOW);
    expect(v.rows).toHaveLength(5);
    expect(v.hidden).toBe(0);
  });
  it('a filter that hides the lowest tier makes the next one "next"', () => {
    const v = m.view(list, { show: 'all', kind: 'honor' }, fmt, NOW);
    expect(v.rows.map((r) => r.name)).toEqual(expect.arrayContaining(['Half Way There']));
  });
  it('an honor and a medal with the same goal are both next', () => {
    const v = m.view([L50H, L50M].map(aw), { show: 'all' }, fmt, NOW);
    expect(v.rows).toHaveLength(2);
  });
  it('owned awards never show', () => {
    const v = m.view([aw({ ...THEFT, owned: true })], { show: 'all' }, fmt, NOW);
    expect(v.rows).toHaveLength(0);
  });
});

describe('order', () => {
  it('groups go count, time, once, record, long, event', () => {
    const v = m.view([TOKEN, L45, MUG, PROTEGE, YEAR, THEFT].map(aw), { show: 'all' }, fmt, NOW);
    expect(v.rows.map((r) => r.g.group)).toEqual(['count', 'time', 'once', 'record', 'long', 'event']);
  });
  it('counted ones by percentage, one-time ones by how many players have them, secret ones last', () => {
    const c = m.view([FRAUD, THEFT, SMG].map(aw), { show: 'count' }, fmt, NOW);
    expect(c.rows.map((r) => r.name)).toEqual(['Looting Luminary', 'Act Of Faith', 'Fraudster']);
    const o = m.view([RNG, TROUT, PROTEGE].map(aw), { show: 'once' }, fmt, NOW);
    expect(o.rows.map((r) => r.name)).toEqual(['Protege', 'Gone Fishing', 'RNG']);
  });
});

describe('easy wins', () => {
  const all = [THEFT, SMG, FRAUD, YEAR, { ...YEAR, name: 'Two Years', goal: 730 }, TORNIVERSARY, PROTEGE, TROUT, RNG, MUG, L45, MASTER, TOKEN, BACHELOR,
    { ...YEAR, name: 'Long Marriage', stat: 'married', goal: 750, cur: 261 }].map(aw);
  const e = m.easyWins(all, fmt, NOW);
  it('closest counters first, never level, rank or records', () => {
    expect(e.count.map((r) => r.name)).toEqual(['Looting Luminary', 'Act Of Faith', 'Fraudster']);
  });
  it('time awards within 60 days, soonest first', () => {
    expect(e.time.map((r) => r.name)).toEqual(['Torniversary', 'One Year of Service']);
  });
  it('one-time awards most players have, not secret and not event ones', () => {
    expect(e.once.map((r) => r.name)).toEqual(['Protege', 'Gone Fishing']);
  });
  it('at most 5 / 3 / 4 entries', () => {
    const many = Array.from({ length: 9 }, (_, i) => aw({ ...THEFT, stat: `crimes.offenses.t${i}`, name: `C${i}` }))
      .concat(Array.from({ length: 9 }, (_, i) => aw({ ...PROTEGE, name: `O${i}` })))
      .concat(['age', 'married', 'faction', 'other.donator_days', 'other.activity.streak.best']
        .map((stat, i) => aw({ ...YEAR, stat, name: `T${i}`, goal: 340 + i })));
    const r = m.easyWins(many, fmt, NOW);
    expect([r.count.length, r.time.length, r.once.length]).toEqual([5, 3, 4]);
  });
  it('almostDone counts next-tier counters at 75% or more', () => {
    expect(m.almostDone(all)).toBe(2);
  });
});

describe('empty lists say why', () => {
  it('a group with nothing in it gives that group\'s reason', () => {
    const v = m.view([THEFT].map(aw), { show: 'record' }, fmt, NOW);
    expect(v.rows).toHaveLength(0);
    expect(v.empty).toEqual(m.EMPTY.record);
    expect(v.narrowed).toBe(false);
  });
  it('a search or type that empties the list says the filters did it', () => {
    const v = m.view([THEFT].map(aw), { show: 'count', q: 'zebra' }, fmt, NOW);
    expect(v.empty).toEqual(m.EMPTY.filtered);
    expect(v.narrowed).toBe(true);
    expect(m.view([THEFT].map(aw), { show: 'all', type: 'gym' }, fmt, NOW).narrowed).toBe(true);
  });
  it('no missing awards at all says so', () => {
    const v = m.view([], { show: 'all' }, fmt, NOW);
    expect(v.empty).toEqual(m.EMPTY.all);
  });
  it('a list with rows has no reason', () => {
    expect(m.view([THEFT].map(aw), { show: 'all' }, fmt, NOW).empty).toBe(null);
  });
  it('search looks at the name, Torn\'s text and the how-line', () => {
    expect(m.view([THEFT].map(aw), { show: 'all', q: 'luminary' }, fmt, NOW).rows).toHaveLength(1);
    expect(m.view([SMG].map(aw), { show: 'all', q: 'finish 8 more' }, fmt, NOW).rows).toHaveLength(1);
  });
});
