import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import welcome from '../../public/new-year-welcome.js';

const at = (y, mo, d, h = 12, mi = 0, s = 0) => new Date(y, mo, d, h, mi, s);
const memStore = (initial = null) => { let v = initial; return { get: vi.fn(() => v), set: vi.fn((x) => { v = x; }) }; };

function makeScheduler(over = {}) {
  const calls = { show: 0, stop: 0 };
  const opts = {
    now: () => new Date(),
    enabled: () => true,
    visible: () => true,
    preview: false,
    storage: memStore(),
    onShow: () => { calls.show++; },
    onStop: () => { calls.stop++; },
    ...over,
  };
  return { s: welcome.scheduler(opts), calls, opts };
}

// A canvas stand-in for Node: every 2D call is a no-op; rectangles (confetti), text (sparks) and clears are counted.
function stubCanvas(width = 1200, height = 800) {
  const n = { rects: 0, texts: 0, clears: 0 };
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      return () => {
        if (key === 'fillRect') n.rects++;
        if (key === 'fillText') n.texts++;
        if (key === 'clearRect') n.clears++;
        return String(key).startsWith('create') ? gradient : undefined;
      };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) };
  return { canvas, rects: () => n.rects, texts: () => n.texts, clears: () => n.clears, draws: () => n.rects + n.texts };
}
const frames = () => {
  const q = []; let id = 0;
  return { raf: vi.fn((fn) => { q.push(fn); return ++id; }), run(ts) { const fn = q.shift(); if (fn) fn(ts); }, queued: () => q.length };
};
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe('confetti and fireworks', () => {
  it('draws one still frame and schedules nothing with reduced motion', () => {
    const c = stubCanvas();
    const f = frames();
    welcome.create(c.canvas, { reduced: () => true, raf: f.raf, caf: vi.fn(), random: seeded() }).start();
    expect(c.rects()).toBeGreaterThan(0);
    expect(c.texts()).toBeGreaterThan(0);
    expect(f.raf).not.toHaveBeenCalled();
  });

  it('animates confetti and fireworks until stopped', () => {
    const c = stubCanvas();
    const f = frames();
    const caf = vi.fn();
    const engine = welcome.create(c.canvas, { reduced: () => false, raf: f.raf, caf, random: seeded() });
    engine.start();
    for (let ts = 0; ts <= 3000; ts += 16) f.run(ts);
    expect(c.rects()).toBeGreaterThan(0);
    expect(c.texts()).toBeGreaterThan(0);
    const queuedId = f.raf.mock.results.at(-1).value;
    const clears = c.clears();
    engine.stop();
    expect(caf).toHaveBeenCalledWith(queuedId);
    expect(c.clears()).toBeGreaterThan(clears);
    const scheduled = f.raf.mock.calls.length;
    f.run(3016);
    expect(f.raf.mock.calls.length).toBe(scheduled);
  });
});

describe('celebration day', () => {
  it('is 1 January, local time', () => {
    expect(welcome.isCelebrationDay(at(2026, 11, 31, 23, 59))).toBe(false);
    expect(welcome.isCelebrationDay(at(2027, 0, 1, 0, 0))).toBe(true);
    expect(welcome.isCelebrationDay(at(2027, 0, 1, 23, 59))).toBe(true);
    expect(welcome.isCelebrationDay(at(2027, 0, 2, 0, 0))).toBe(false);
  });

  it('has no midnight countdown left', () => {
    expect(welcome.msToNewYear).toBeUndefined();
    expect(welcome.previewClock).toBeUndefined();
  });
});

describe('scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the celebration once on 1 January, even when the app stays open', () => {
    vi.setSystemTime(at(2026, 11, 31, 10));
    const { s, calls, opts } = makeScheduler();
    s.check();
    expect(calls.show).toBe(0);
    vi.setSystemTime(at(2027, 0, 1, 10));
    s.check(); s.check();
    expect(calls.show).toBe(1);
    vi.setSystemTime(at(2027, 0, 2, 10));
    s.check();
    expect(calls.show).toBe(1);
    expect(opts.storage.set.mock.calls.map((c) => c[0])).toEqual(['2027-01-01']);
  });

  it('shows it at the first check after midnight when the app is open, with no countdown before', () => {
    vi.setSystemTime(at(2026, 11, 31, 23, 59, 50));
    const { s, calls } = makeScheduler();
    s.check();
    expect(calls.show).toBe(0);
    vi.setSystemTime(at(2027, 0, 1, 0, 0, 20));
    s.check();
    expect(calls.show).toBe(1);
  });

  it('is not blocked by a 31 December celebration stored by an older build', () => {
    vi.setSystemTime(at(2027, 0, 1, 10));
    const { s, calls } = makeScheduler({ storage: memStore('2026-12-31') });
    s.check();
    expect(calls.show).toBe(1);
  });

  it('shows once when storage still reads an older day but can no longer be written', () => {
    vi.setSystemTime(at(2027, 0, 1, 10));
    const stuck = { get: () => '2026-12-31', set: () => { throw new Error('quota'); } };
    const { s, calls } = makeScheduler({ storage: stuck });
    s.check(); s.check(); s.check();
    expect(calls.show).toBe(1);
  });

  it('shows at most once per run when storage throws', () => {
    vi.setSystemTime(at(2027, 0, 1, 10));
    const broken = { get: () => { throw new Error('blocked'); }, set: () => { throw new Error('blocked'); } };
    const { s, calls } = makeScheduler({ storage: broken });
    s.check(); s.check(); s.check();
    expect(calls.show).toBe(1);
  });

  it('does nothing on other days', () => {
    for (const day of [at(2026, 11, 24, 10), at(2026, 11, 31, 10), at(2027, 0, 6, 10)]) {
      vi.setSystemTime(day);
      const { s, calls } = makeScheduler();
      s.check();
      expect(calls.show).toBe(0);
    }
  });

  it('waits until the tracker is on screen', () => {
    vi.setSystemTime(at(2027, 0, 1, 10));
    let vis = false;
    const { s, calls, opts } = makeScheduler({ visible: () => vis });
    s.check();
    expect(calls.show).toBe(0);
    expect(opts.storage.set).not.toHaveBeenCalled();
    vis = true;
    s.check();
    expect(calls.show).toBe(1);
  });

  it('shows the preview on every start, once per start, without remembering the day', () => {
    vi.setSystemTime(at(2026, 10, 14, 12));
    const a = makeScheduler({ preview: true });
    a.s.check(); a.s.check();
    const b = makeScheduler({ preview: true });
    b.s.check();
    expect(a.calls.show).toBe(1);
    expect(b.calls.show).toBe(1);
    expect(a.opts.storage.set).not.toHaveBeenCalled();
  });

  it('reads a preview function on every check, so a preview turned on later is seen', () => {
    vi.setSystemTime(at(2026, 10, 14, 12));
    let on = false;
    const { s, calls } = makeScheduler({ preview: () => on });
    s.check();
    expect(calls.show).toBe(0);
    on = true;
    s.check();
    expect(calls.show).toBe(1);
  });

  it('closes the celebration and shows nothing when switched off', () => {
    vi.setSystemTime(at(2027, 0, 1, 10));
    const { s, calls } = makeScheduler({ enabled: () => false });
    s.check();
    expect(calls.stop).toBe(1);
    expect(calls.show).toBe(0);
  });
});
