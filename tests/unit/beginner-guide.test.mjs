import { describe, expect, it } from 'vitest';
import g from '../../public/beginner-guide.js';

// Plain formatters, so the texts can be checked for the values they carry.
const fmt = { num: (n) => String(n), dur: (s) => `${s}s`, time: (sec) => `T${sec}` };
const NOW = 1_800_000_000_000; // ms, a quarter-hour tick exactly (1_800_000_000 s / 900 = 2_000_000)
const base = (b) => ({ base: b });
const stats = (str, def = str, spd = str, dex = str) => ({ stats: { strength: base(str), defense: base(def), speed: base(spd), dexterity: base(dex) } });
// A level 10 player in a faction, in a Penthouse, with no job and no course, happy under max, nothing full.
function ov(over = {}) {
  return {
    fetchedAt: NOW,
    player: { level: 10, status: { state: 'Okay' }, job: {}, faction: { faction_id: 5, faction_name: 'QA Faction' }, property: 'Penthouse', ...over.player },
    bars: { energy: { current: 50, maximum: 150 }, nerve: { current: 10, maximum: 60 }, happy: { current: 4000, maximum: 5000 }, ...over.bars },
    cooldowns: { drug: 0, booster: 0, medical: 0, ...over.cooldowns },
    battle: over.battle || stats(500),
    education: over.education || { currentId: 0 },
  };
}
const ids = (o) => g.steps(o, fmt).map((s) => [s.id, s.done]);
const step = (o, id) => g.steps(o, fmt).find((s) => s.id === id);
const isPair = (p) => Array.isArray(p) && p.length === 2 && p.every((t) => typeof t === 'string' && t.trim().length > 0);

describe('every text is a TR/EN pair', () => {
  it('the lead, the jump note, the roadmap and every section', () => {
    const all = [g.LEAD, g.JUMP_NOTE];
    for (const ph of g.ROADMAP) all.push(ph.title, ...ph.items);
    for (const s of g.SECTIONS) {
      all.push(s.title, ...s.summary);
      for (const d of s.details) { if (d.head) all.push(d.head); all.push(...d.items); }
    }
    const bad = all.filter((p) => !isPair(p));
    expect(bad).toEqual([]);
  });
  it('every personal step and every phase line', () => {
    const o = ov({ player: { faction: { faction_id: 0 }, property: 'Shack' }, bars: { energy: { current: 400, maximum: 150 }, nerve: { current: 60, maximum: 60 } }, battle: stats(100) });
    for (const s of g.steps(o, fmt)) { expect(isPair(s.text), s.id).toBe(true); if (s.action?.label) expect(isPair(s.action.label), s.id).toBe(true); }
    for (const phase of ['unknown', 'blocked', 'ecstasy', 'train', 'waitDrug', 'waitBooster', 'ready']) {
      const r = { phase, checks: { energy: { current: 400, max: 150 }, drug: { left: 60 }, booster: { left: 120 }, happy: { current: 9000, max: 5000 }, status: { ok: phase !== 'blocked' } }, nextTick: 900, state: phase === 'blocked' ? 'Hospital' : 'Okay' };
      expect(isPair(g.phaseText(r, fmt)), phase).toBe(true);
    }
  });
});

describe('what the guide holds', () => {
  it('ten topic cards in order, each with a 2-3 line summary and details', () => {
    expect(g.SECTIONS.map((s) => s.id)).toEqual(['jump', 'energy', 'gym', 'crimes', 'faction', 'job', 'education', 'buy', 'tools', 'after15']);
    for (const s of g.SECTIONS) {
      expect(s.summary.length, s.id).toBeGreaterThanOrEqual(2);
      expect(s.summary.length, s.id).toBeLessThanOrEqual(3);
      expect(s.details.length, s.id).toBeGreaterThanOrEqual(1);
      for (const d of s.details) expect(d.items.length, s.id).toBeGreaterThanOrEqual(1);
    }
  });
  it('the happy jump explains the full jump, the budget jump, the risks and when it is worth it', () => {
    const jump = g.SECTIONS.find((s) => s.id === 'jump');
    expect(jump.details.length).toBe(4);
    for (const d of jump.details) expect(isPair(d.head)).toBe(true);
  });
  it('a roadmap of three phases: day 1, first week, until level 15', () => {
    expect(g.ROADMAP.map((p) => p.id)).toEqual(['day1', 'week1', 'to15']);
    for (const p of g.ROADMAP) expect(p.items.length, p.id).toBeGreaterThanOrEqual(3);
  });
});

describe('the personal steps', () => {
  it('nothing before the overview has loaded', () => {
    expect(g.steps(null, fmt)).toEqual([]);
    expect(g.steps({}, fmt)).toEqual([]);
  });
  it('a player with all stats at 300+, no job and no course, happy at base, in a faction', () => {
    expect(ids(ov())).toEqual([['stats', true], ['job', false], ['course', false], ['happy', false], ['faction', true]]);
    expect(step(ov(), 'stats').action).toEqual({ view: 'level' });
    expect(step(ov(), 'job').action).toEqual({ view: 'job' });
    expect(step(ov(), 'course').action.url).toBe('https://www.torn.com/page.php?sid=education');
    expect(step(ov(), 'faction').text[1]).toContain('QA Faction');
  });
  it('names each stat still under 300', () => {
    const s = step(ov({ battle: stats(120, 300, 299, 800) }), 'stats');
    expect(s.done).toBe(false);
    expect(s.text[1]).toContain('Strength 120');
    expect(s.text[1]).toContain('Speed 299');
    expect(s.text[1]).not.toContain('Defense');
    expect(s.action).toBeUndefined();
  });
  it('a job in a company or a city job counts as a job', () => {
    expect(step(ov({ player: { job: { company_id: 7, company_name: 'QA Co', position: 'Clerk' } } }), 'job')).toMatchObject({ done: true });
    expect(step(ov({ player: { job: { company_id: 7, company_name: 'QA Co', position: 'Clerk' } } }), 'job').text[1]).toContain('QA Co');
    expect(step(ov({ player: { job: { job: 'Education', company_id: 0 } } }), 'job').done).toBe(true);
    expect(step(ov({ player: { job: { job: 'None', company_id: 0 } } }), 'job').done).toBe(false);
  });
  it('a running course is done', () => {
    const s = step(ov({ education: { currentId: 12, current: 'Introduction to Biochemistry' } }), 'course');
    expect(s.done).toBe(true);
    expect(s.text[1]).toContain('Introduction to Biochemistry');
  });
  it('happy above max is a good time to train', () => {
    expect(step(ov({ bars: { happy: { current: 5100, maximum: 5000 } } }), 'happy').done).toBe(true);
  });
  it('energy stacked above max points to the jump card; a full bar says spend it', () => {
    const stacked = ov({ bars: { energy: { current: 400, maximum: 150 } } });
    expect(ids(stacked).map(([id]) => id)).toContain('energyStacked');
    expect(ids(stacked).map(([id]) => id)).not.toContain('energyFull');
    expect(step(stacked, 'energyStacked').text[1]).toContain('400');
    const full = ov({ bars: { energy: { current: 150, maximum: 150 } } });
    expect(step(full, 'energyFull')).toMatchObject({ done: false });
    expect(ids(full).map(([id]) => id)).not.toContain('energyStacked');
  });
  it('a full nerve bar says do a crime, with the Crimes page', () => {
    const s = step(ov({ bars: { nerve: { current: 60, maximum: 60 } } }), 'nerveFull');
    expect(s.done).toBe(false);
    expect(s.action.url).toBe('https://www.torn.com/page.php?sid=crimes');
    expect(step(ov({ bars: { nerve: { current: 59, maximum: 60 } } }), 'nerveFull')).toBeUndefined();
  });
  it('no faction and a Shack each get a step', () => {
    expect(step(ov({ player: { faction: { faction_id: 0 } } }), 'faction').done).toBe(false);
    expect(step(ov({ player: { property: 'Shack' } }), 'home').done).toBe(false);
    expect(step(ov(), 'home')).toBeUndefined();
  });
  it('the new steps come after the old ones', () => {
    const o = ov({ player: { faction: { faction_id: 0 }, property: 'Shack' }, bars: { energy: { current: 150, maximum: 150 }, nerve: { current: 60, maximum: 60 } } });
    expect(ids(o).map(([id]) => id)).toEqual(['stats', 'job', 'course', 'happy', 'energyFull', 'nerveFull', 'faction', 'home']);
  });
  it('missing parts of the overview are skipped', () => {
    const o = { player: { level: 3, job: {} }, education: {} };
    expect(ids(o)).toEqual([['job', false], ['course', false]]);
  });
});

describe('the next quarter-hour tick', () => {
  it('is strictly after now', () => {
    expect(g.nextTick(1_800_000_000)).toBe(1_800_000_900);
    expect(g.nextTick(1_800_000_001)).toBe(1_800_000_900);
    expect(g.nextTick(1_800_000_899)).toBe(1_800_000_900);
  });
});

describe('happy jump readiness', () => {
  const at = (o, nowMs = NOW, skewMs = 0) => g.jumpReadiness(o, { nowMs, skewMs });
  const ready = () => ov({ bars: { energy: { current: 1000, maximum: 150 }, happy: { current: 5000, maximum: 5000 } } });

  it('unknown before the bars have loaded', () => {
    expect(at({}).phase).toBe('unknown');
    expect(at(null).phase).toBe('unknown');
  });
  it('ready: stacked, cooldowns clear, happy at max, okay', () => {
    const r = at(ready());
    expect(r.phase).toBe('ready');
    expect(r.checks.energy).toMatchObject({ ok: true, current: 1000, max: 150 });
    expect(r.checks.happy).toMatchObject({ ok: false, current: 5000, max: 5000 });
    expect(r.checks.drug).toMatchObject({ ok: true, left: 0 });
    expect(r.checks.booster).toMatchObject({ ok: true, left: 0 });
    expect(r.checks.status.ok).toBe(true);
    expect(r.nextTick).toBe(1_800_000_900);
  });
  it('a budget jump from a full bar is ready too; under a full bar the energy check is open', () => {
    expect(at(ov({ bars: { energy: { current: 150, maximum: 150 }, happy: { current: 5000, maximum: 5000 } } })).phase).toBe('ready');
    expect(at(ov({ bars: { energy: { current: 149, maximum: 150 } } })).checks.energy.ok).toBe(false);
  });
  it('waits for a running drug cooldown, then a running booster cooldown', () => {
    expect(at(ov({ cooldowns: { drug: 3600, booster: 600 } })).phase).toBe('waitDrug');
    expect(at(ov({ cooldowns: { drug: 0, booster: 600 } })).phase).toBe('waitBooster');
  });
  it('in hospital while stacking: the stacking advice stays; with nothing to wait for: blocked', () => {
    const hosp = { status: { state: 'Hospital' } };
    expect(at(ov({ player: hosp, cooldowns: { drug: 3600 } })).phase).toBe('waitDrug');
    const r = at(ov({ player: hosp }));
    expect(r.phase).toBe('blocked');
    expect(r.state).toBe('Hospital');
    expect(r.checks.status.ok).toBe(false);
  });
  it('boosted with the drug cooldown clear: take Ecstasy', () => {
    expect(at(ov({ bars: { happy: { current: 17500, maximum: 5000 } } })).phase).toBe('ecstasy');
  });
  it('happy at 2x max with the Ecstasy cooldown running: train, even after the energy is spent', () => {
    expect(at(ov({ bars: { energy: { current: 1000, maximum: 150 }, happy: { current: 35000, maximum: 5000 } }, cooldowns: { drug: 12000 } })).phase).toBe('train');
    expect(at(ov({ bars: { energy: { current: 0, maximum: 150 }, happy: { current: 35000, maximum: 5000 } }, cooldowns: { drug: 12000 } })).phase).toBe('train');
    expect(at(ov({ bars: { happy: { current: 10000, maximum: 5000 } }, cooldowns: { drug: 12000 } })).phase).toBe('train');
  });
  it("a Xanax's +75 happy is not a boost", () => {
    expect(at(ov({ bars: { happy: { current: 5075, maximum: 5000 } }, cooldowns: { drug: 20000 } })).phase).toBe('waitDrug');
  });
  it('an Ecstasy-only jump in progress says train, also after the first train and after the refill', () => {
    // Happy a little under max before the Ecstasy, so it ends under 2x max; the Ecstasy cooldown runs.
    const eco = (energy, happy, drug) => ({ ...ov({ bars: { energy: { current: energy, maximum: 150 }, happy: { current: happy, maximum: 5000 } }, cooldowns: { drug: 12000 } }), drug });
    expect(at(eco(0, 9950)).phase).toBe('train');
    expect(at(eco(150, 9950)).phase).toBe('train');
    expect(at(eco(150, 6000)).phase).toBe('train');
    expect(at(eco(150, 6000, { xanaxActive: false })).phase).toBe('train');
  });
  it('while Xanax is active only happy within its +75 is the Xanax; without Xanax any happy above max is a boost', () => {
    const shack = (happy, xanaxActive) => ({ ...ov({ bars: { happy: { current: happy, maximum: 100 } }, cooldowns: { drug: 12000 } }), drug: { xanaxActive } });
    expect(at(shack(175, true)).phase).toBe('waitDrug');
    expect(at(shack(150, false)).phase).toBe('train');
  });
  it('boosted while jailed or travelling: blocked', () => {
    expect(at(ov({ player: { status: { state: 'Jail' } }, bars: { happy: { current: 35000, maximum: 5000 } }, cooldowns: { drug: 12000 } })).phase).toBe('blocked');
    expect(at(ov({ player: { status: { state: 'Traveling' } }, bars: { happy: { current: 17500, maximum: 5000 } } })).phase).toBe('blocked');
  });
  it('cooldowns count down from when the overview was fetched, never below zero', () => {
    const o = ov({ cooldowns: { drug: 3600, booster: 100 } });
    o.fetchedAt = NOW - 600_000;
    const r = at(o);
    expect(r.checks.drug.left).toBe(3000);
    expect(r.checks.booster.left).toBe(0);
    expect(r.checks.booster.ok).toBe(true);
    delete o.fetchedAt;
    expect(at(o).checks.drug.left).toBe(3600);
  });
  it('the next tick is on Torn time', () => {
    expect(at(ready(), NOW - 1000, 1000).nextTick).toBe(1_800_000_900);
    expect(at(ready(), NOW + 899_000, 0).nextTick).toBe(1_800_000_900);
  });
});

describe('the phase line carries its values', () => {
  const r = (phase, extra = {}) => ({ phase, checks: { energy: { ok: true, current: 400, max: 150 }, drug: { ok: false, left: 3600 }, booster: { ok: false, left: 7200 }, happy: { ok: true, current: 35000, max: 5000 }, status: { ok: true } }, nextTick: 1_800_000_900, state: 'Okay', ...extra });
  it('ready, Ecstasy and train name the next tick', () => {
    for (const phase of ['ready', 'ecstasy', 'train']) for (const t of g.phaseText(r(phase), fmt)) expect(t, phase).toContain('T1800000900');
  });
  it('waiting names the time left and the stack so far', () => {
    for (const t of g.phaseText(r('waitDrug'), fmt)) { expect(t).toContain('3600s'); expect(t).toContain('400'); }
    for (const t of g.phaseText(r('waitBooster'), fmt)) expect(t).toContain('7200s');
  });
  it('at the 1,000 stacking cap it never says take another Xanax', () => {
    const atCap = (phase) => { const x = r(phase); x.checks.energy = { ok: true, current: 1000, max: 150 }; return x; };
    for (const phase of ['waitDrug', 'ready']) for (const t of g.phaseText(atCap(phase), fmt)) expect(t, phase).not.toMatch(/Xanax/);
    for (const t of g.phaseText(atCap('waitDrug'), fmt)) expect(t).toContain('3600s');
  });
  it('blocked says why: hospital, jail or away', () => {
    expect(g.phaseText(r('blocked', { state: 'Hospital' }), fmt)[1]).toMatch(/hospital/i);
    expect(g.phaseText(r('blocked', { state: 'Jail' }), fmt)[1]).toMatch(/jail/i);
    expect(g.phaseText(r('blocked', { state: 'Abroad' }), fmt)[1]).toMatch(/abroad|travel/i);
  });
});
