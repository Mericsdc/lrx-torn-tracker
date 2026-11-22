import { describe, expect, it } from 'vitest';
import h from '../../src/server/holdings.js';

const CATALOG = { items: {
  1: { name: 'Kitchen Knife', type: 'Melee', market_value: 1000 },
  186: { name: 'Sheep Plushie', type: 'Plushie', market_value: 50 },
  206: { name: 'Xanax', type: 'Drug', market_value: 830000 },
} };
const inv = (items, next = null, timestamp = 1700000000) => ({ inventory: { items, timestamp }, _metadata: { links: { next, prev: null }, total: items.length } });
const invRow = (id, amount, extra = {}) => ({ id, amount, equipped: false, name: CATALOG.items[id].name, faction_owned: false, uid: null, ...extra });
const base = () => ({
  'torn/?selections=items': CATALOG,
  'v2/user/inventory?limit=250&offset=0': inv([invRow(1, 1, { uid: 11 }), invRow(1, 1, { uid: 12, equipped: true }), invRow(206, 5, { faction_owned: true }), invRow(186, 10)]),
  'user/?selections=bazaar': { bazaar: [
    { ID: 206, UID: null, name: 'Xanax', type: 'Drug', quantity: 4, price: 850000, market_price: 830000 },
    { ID: 186, UID: null, name: 'Sheep Plushie', type: 'Plushie', quantity: 2, price: 70 },
  ] },
  'user/?selections=display': { display: [{ ID: 186, UID: null, name: 'Sheep Plushie', type: 'Plushie', quantity: 3, circulation: 1 }] },
  'v2/user/itemmarket?offset=0': { itemmarket: [{ id: 9, price: 900000, average_price: 0, amount: 3, is_anonymous: false, available: 2, item: { id: 206, name: 'Xanax', type: 'Drug', uid: null } }], _metadata: { links: { next: null, prev: null } } },
  'user/?selections=stocks': { stocks: { 25: { stock_id: 25, total_shares: 1000 }, 3: { stock_id: 3, total_shares: 0 } } },
  'torn/?selections=stocks': { stocks: { 25: { stock_id: 25, name: 'Torn City Investments', acronym: 'TCI', current_price: 1200.5 }, 3: { stock_id: 3, name: 'Other', acronym: 'OTH', current_price: 5 } } },
});
// A fake get(pathq, ttl): answers from a map or a function, throws on Error values, records every call.
function fake(source) {
  const calls = [];
  const get = async (q, ttl) => {
    calls.push([q, ttl]);
    const r = typeof source === 'function' ? source(q) : source[q];
    if (r instanceof Error) throw r;
    if (r === undefined) throw new Error('no fixture for ' + q);
    return structuredClone(r);
  };
  return { get, calls };
}

describe('loadHoldings', () => {
  it('inventory: catalog market value, uid rows merged by id, faction-owned left out', async () => {
    const r = await h.loadHoldings({ get: fake(base()).get, now: () => 5 });
    expect(r.at).toBe(5);
    expect(r.places.inventory).toEqual({
      ok: true, total: 2500, tornAt: 1700000000,
      rows: [
        { id: 1, name: 'Kitchen Knife', type: 'Melee', qty: 2, unit: 1000, value: 2000 },
        { id: 186, name: 'Sheep Plushie', type: 'Plushie', qty: 10, unit: 50, value: 500 },
      ],
    });
  });

  it('inventory paging stops on a short page; 8 full pages mark the place partial', async () => {
    const full = inv(Array.from({ length: 250 }, () => invRow(186, 1)), 'next');
    const short = fake((q) => (q.startsWith('v2/user/inventory') ? (q.endsWith('offset=500') ? inv(Array.from({ length: 10 }, () => invRow(186, 1))) : full) : base()[q]));
    const r = await h.loadHoldings({ get: short.get });
    expect(short.calls.map(([q]) => q).filter((q) => q.startsWith('v2/user/inventory'))).toEqual(['v2/user/inventory?limit=250&offset=0', 'v2/user/inventory?limit=250&offset=250', 'v2/user/inventory?limit=250&offset=500']);
    expect(r.places.inventory.rows[0].qty).toBe(510);
    expect(r.places.inventory.partial).toBeUndefined();

    const endless = fake((q) => (q.startsWith('v2/user/inventory') ? full : base()[q]));
    const capped = await h.loadHoldings({ get: endless.get });
    expect(endless.calls.filter(([q]) => q.startsWith('v2/user/inventory')).length).toBe(h.PAGE_CAP);
    expect(h.PAGE_CAP).toBe(8);
    expect(capped.places.inventory.partial).toBe(true);
    expect(capped.places.inventory.rows[0].qty).toBe(2000);
  });

  it('bazaar and display: v1 arrays, listed price kept, catalog price when market_price is missing', async () => {
    const r = await h.loadHoldings({ get: fake(base()).get });
    expect(r.places.bazaar).toEqual({
      ok: true, total: 3320100,
      rows: [
        { id: 206, name: 'Xanax', type: 'Drug', qty: 4, unit: 830000, value: 3320000, listed: 850000 },
        { id: 186, name: 'Sheep Plushie', type: 'Plushie', qty: 2, unit: 50, value: 100, listed: 70 },
      ],
    });
    expect(r.places.display).toEqual({ ok: true, total: 150, rows: [{ id: 186, name: 'Sheep Plushie', type: 'Plushie', qty: 3, unit: 50, value: 150 }] });
  });

  it('item market: qty = min(amount, available), pages by offset until empty or no next link', async () => {
    const src = { ...base(),
      'v2/user/itemmarket?offset=0': { itemmarket: [{ id: 9, price: 900000, amount: 3, available: 2, item: { id: 206, name: 'Xanax', type: 'Drug', uid: null } }], _metadata: { links: { next: 'next', prev: null } } },
      'v2/user/itemmarket?offset=1': { itemmarket: [{ id: 10, price: 60, amount: 4, item: { id: 186, name: 'Sheep Plushie', type: 'Plushie', uid: null } }], _metadata: { links: { next: 'next', prev: null } } },
      'v2/user/itemmarket?offset=2': { itemmarket: [], _metadata: { links: { next: null, prev: null } } },
    };
    const f = fake(src);
    const r = await h.loadHoldings({ get: f.get });
    expect(f.calls.map(([q]) => q).filter((q) => q.startsWith('v2/user/itemmarket'))).toEqual(['v2/user/itemmarket?offset=0', 'v2/user/itemmarket?offset=1', 'v2/user/itemmarket?offset=2']);
    expect(r.places.itemmarket).toEqual({
      ok: true, total: 1660200,
      rows: [
        { id: 206, name: 'Xanax', type: 'Drug', qty: 2, unit: 830000, value: 1660000, listed: 900000 },
        { id: 186, name: 'Sheep Plushie', type: 'Plushie', qty: 4, unit: 50, value: 200, listed: 60 },
      ],
    });
  });

  it('stocks: total_shares × current_price, zero holdings skipped, name "Name (ACR)"', async () => {
    const r = await h.loadHoldings({ get: fake(base()).get });
    expect(r.places.stocks).toEqual({ ok: true, total: 1200500, rows: [{ id: 's25', name: 'Torn City Investments (TCI)', type: 'Stock', qty: 1000, unit: 1200.5, value: 1200500 }] });
  });

  it('one failing place does not stop the others; catalog failure fails inventory and item market only', async () => {
    const denied = new Error('Torn API: Access level of this key is not high enough');
    const r = await h.loadHoldings({ get: fake({ ...base(), 'user/?selections=bazaar': denied }).get });
    expect(r.places.bazaar).toEqual({ ok: false, error: denied.message });
    expect(r.places.inventory.ok).toBe(true);
    expect(r.places.stocks.ok).toBe(true);

    const noCatalog = await h.loadHoldings({ get: fake({ ...base(), 'torn/?selections=items': new Error('Torn API: down') }).get });
    expect(noCatalog.places.inventory).toEqual({ ok: false, error: 'Torn API: down' });
    expect(noCatalog.places.itemmarket).toEqual({ ok: false, error: 'Torn API: down' });
    expect(noCatalog.places.bazaar.ok).toBe(true);
    expect(noCatalog.places.bazaar.rows.find((x) => x.id === 186).unit).toBe(0);
    expect(noCatalog.places.display.ok).toBe(true);
  });

  it('an unexpected reply shape is an error, not zeros; an empty v1 list is an empty place', async () => {
    const r = await h.loadHoldings({ get: fake({ ...base(), 'user/?selections=bazaar': { foo: 1 }, 'user/?selections=display': { display: null } }).get });
    expect(r.places.bazaar.ok).toBe(false);
    expect(r.places.bazaar.code).toBe('BAD_SHAPE');
    expect(r.places.display).toEqual({ ok: true, total: 0, rows: [] });
  });

  it('force asks stocks with ttl 0; the catalog keeps its hour; places are always asked fresh', async () => {
    const normal = fake(base());
    await h.loadHoldings({ get: normal.get });
    const ttl = (calls, q) => calls.find(([x]) => x === q)?.[1];
    expect(ttl(normal.calls, 'torn/?selections=items')).toBe(3_600_000);
    expect(ttl(normal.calls, 'user/?selections=stocks')).toBe(60_000);
    expect(ttl(normal.calls, 'torn/?selections=stocks')).toBe(60_000);
    expect(ttl(normal.calls, 'user/?selections=bazaar')).toBe(0);
    expect(ttl(normal.calls, 'v2/user/inventory?limit=250&offset=0')).toBe(0);
    const forced = fake(base());
    await h.loadHoldings({ get: forced.get, force: true });
    expect(ttl(forced.calls, 'user/?selections=stocks')).toBe(0);
    expect(ttl(forced.calls, 'torn/?selections=stocks')).toBe(0);
    expect(ttl(forced.calls, 'torn/?selections=items')).toBe(3_600_000);
  });

  it('a Torn error code travels with the reason', async () => {
    const denied = Object.assign(new Error('Torn API: Access level of this key is not high enough'), { code: 16 });
    const r = await h.loadHoldings({ get: fake({ ...base(), 'user/?selections=bazaar': denied }).get });
    expect(r.places.bazaar).toEqual({ ok: false, error: denied.message, code: 16 });
  });
});

describe('cachePolicy (server.js getHoldings)', () => {
  const MIN = 60_000, now = 1_000_000_000;
  const ok = { ok: true, total: 0, rows: [] };
  const reply = (bazaar) => ({ at: 1, places: { inventory: ok, bazaar } });
  const refused = reply({ ok: false, error: 'Torn API: Access level of this key is not high enough', code: 16 });
  const limited = reply({ ok: false, error: 'Torn API: Too many requests', code: 5 });
  const timedOut = reply({ ok: false, error: 'The operation was aborted due to timeout' });

  it('a full reply (or one refused for good) is kept 10 minutes; one that may recover soon only 30 seconds', () => {
    expect(h.cachePolicy(undefined, false, now)).toEqual({ drop: false, ttl: 10 * MIN });
    expect(h.cachePolicy({ t: now - 1000, data: reply(ok) }, false, now)).toEqual({ drop: false, ttl: 10 * MIN });
    expect(h.cachePolicy({ t: now - 1000, data: refused }, false, now)).toEqual({ drop: false, ttl: 10 * MIN });
    expect(h.cachePolicy({ t: now - 1000, data: limited }, false, now)).toEqual({ drop: false, ttl: 30_000 });
    expect(h.cachePolicy({ t: now - 1000, data: timedOut }, false, now)).toEqual({ drop: false, ttl: 30_000 });
    expect(h.cachePolicy({ t: now - 1000, data: reply({ ok: false, error: 'x', code: 'BAD_SHAPE' }) }, false, now).ttl).toBe(10 * MIN);
  });

  it('force joins a load in flight, reuses one under 30 seconds old, and otherwise starts a new one', () => {
    expect(h.cachePolicy({ promise: Promise.resolve() }, true, now)).toEqual({ drop: false, ttl: 0 });
    expect(h.cachePolicy({ t: now - 5 * MIN, data: reply(ok), promise: Promise.resolve() }, true, now)).toEqual({ drop: false, ttl: 0 });
    expect(h.cachePolicy({ t: now - 10_000, data: reply(ok) }, true, now)).toEqual({ drop: false, ttl: 30_000 });
    expect(h.cachePolicy({ t: now - 40_000, data: reply(ok) }, true, now).drop).toBe(true);
    expect(h.cachePolicy({ t: now - 40_000, data: limited }, true, now).drop).toBe(true);
    expect(h.cachePolicy(undefined, true, now).drop).toBe(true);
  });
});
