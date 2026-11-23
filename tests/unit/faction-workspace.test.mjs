import { describe, expect, it } from 'vitest';
import fw from '../../public/faction-workspace.js';

const member = (id, battleStats, extra = {}) => ({ id, name: `M${id}`, level: 50, position: 'Member', days: 100, battleStats, ...extra });

describe('battle stat provenance (members table)', () => {
  const table = fw.buildMembersTable({
    members: [
      member(1, { source: 'torn_self', verified: true, total: 900, str: 200, spd: 250, dex: 200, def: 250 }),
      member(2, { source: 'verified', total: 800 }),
      member(3, { source: 'ffscouter', verified: false, total: 700 }),
      member(4, { source: 'rank_estimate', verified: false, total: 600 }),
      member(5, null),
    ],
    hasOfficerAccess: true,
  });
  const byId = (id) => table.rows.find((r) => r.playerId === id).battleStats;

  it('labels verified totals as verified, whatever the verified source name', () => {
    expect(byId(1).badge).toBe('verified');
    expect(byId(2).badge).toBe('verified');
    expect(byId(2).label[1]).toBe('Verified');
  });

  it('labels an FFScouter total as an FFScouter estimate and never splits it', () => {
    expect(byId(3).badge).toBe('estimate');
    expect(byId(3).label[1]).toBe('Estimate (FFScouter)');
    expect([byId(3).str, byId(3).spd, byId(3).dex, byId(3).def]).toEqual([null, null, null, null]);
  });

  it('labels a rank midpoint as a rough estimate from rank, not as FFScouter', () => {
    expect(byId(4).badge).toBe('rough');
    expect(byId(4).label[1]).toBe('Rough estimate (from rank)');
    expect(byId(4).label[1]).not.toMatch(/FFScouter/);
    expect(byId(4).label[0]).not.toMatch(/FFScouter/);
    expect(byId(4).source).toBe('rank_estimate');
  });

  it('keeps a member without any total as accumulating history', () => {
    expect(byId(5).badge).toBe('pending');
  });
});

describe('members table 30-day columns', () => {
  it('passes the 30-day values through with the same permission gate as the 7-day ones', () => {
    const t = fw.buildMembersTable({
      members: [member(1, null, { activity30d: 36000, xanax30d: 40, gym30d: 90000, activity7d: 7200 })],
      hasOfficerAccess: true,
    });
    const r = t.rows[0];
    expect([r.activity30d, r.xanax30d, r.gym30d]).toEqual([36000, 40, 90000]);
    expect(r.restricted.xanax30d.status).toBe('ok');
    expect(r.restricted.gym30d.value).toBe(90000);
    const locked = fw.buildMembersTable({ members: [member(1, null, { xanax30d: 40 })], hasOfficerAccess: false });
    expect(locked.rows[0].restricted.xanax30d.status).toBe('permission_required');
  });

  it('reads the travel country from the radar fields', () => {
    const t = fw.buildMembersTable({
      members: [
        member(1, null, { state: 'Traveling', travelState: 'inbound', origin: 'mex', destination: 'torn' }),
        member(2, null, { state: 'Abroad', travelState: 'abroad', destination: 'jap', origin: null }),
        member(3, null, { state: 'Okay' }),
      ],
    });
    expect(t.rows[0].travel).toMatchObject({ state: 'inbound', countryCode: 'mex' });
    expect(t.rows[1].travel).toMatchObject({ state: 'abroad', countryCode: 'jap' });
    expect(t.rows[2].travel).toBe(null);
  });
});

describe('stats window coverage', () => {
  const members = [
    { id: 1, name: 'Veteran', days: 300 },
    { id: 2, name: 'Twenty', days: 20 },
    { id: 3, name: 'Newbie', days: 5 },
  ];
  const reportRows = [
    { id: 1, activity: 36000, xanax: 30 },
    { id: 2, activity: 30000, xanax: 20 },
    { id: 3, activity: 9000, xanax: 5 },
  ];

  it('reports the real days behind a 30-day window when history is short', () => {
    const v = fw.buildFactionStatsView({
      members, reportRows, windowDays: 30, tenureFilter: true,
      range: { from: '2026-11-10', to: '2026-11-22', complete: true, actualDays: 12 },
    });
    expect(v.windowDays).toBe(30);
    expect(v.coverage).toEqual({ requestedDays: 30, actualDays: 12, complete: false });
  });

  it('marks a full window complete', () => {
    const v = fw.buildFactionStatsView({ members, reportRows, windowDays: 7, range: { from: '2026-11-15', to: '2026-11-22', complete: true, actualDays: 7 } });
    expect(v.coverage).toEqual({ requestedDays: 7, actualDays: 7, complete: true });
  });

  it('has zero days and is incomplete without a range', () => {
    const v = fw.buildFactionStatsView({ members, reportRows, windowDays: 90 });
    expect(v.coverage).toEqual({ requestedDays: 90, actualDays: 0, complete: false });
  });

  it('applies the tenure filter to the days the data actually covers', () => {
    const v = fw.buildFactionStatsView({
      members, reportRows, windowDays: 30, tenureFilter: true,
      range: { from: '2026-11-10', to: '2026-11-22', complete: true, actualDays: 12 },
    });
    const row = (id) => v.rows.find((r) => r.id === id);
    expect(row(2).tenureEligible).toBe(true); // 20 days in the faction covers the 12-day diff
    expect(row(3).tenureEligible).toBe(false);
    expect(v.totals.xanax).toBe(50);
  });

  it('builds window labels that name the real coverage in both languages', () => {
    expect(fw.windowLabel(30, { actualDays: 12, complete: false })).toEqual(['30g (12g veri)', '30d (12d data)']);
    expect(fw.windowLabel(30, { actualDays: 30, complete: true })).toEqual(['30g', '30d']);
    expect(fw.windowLabel(7, null)).toEqual(['7g', '7d']);
    expect(fw.windowLabel(90, { actualDays: 0, complete: false })).toEqual(['90g (veri yok)', '90d (no data)']);
  });
});
