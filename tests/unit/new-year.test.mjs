import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import newYear from '../../public/new-year.js';

describe('website copy', () => {
  it('site copy is identical to public/new-year.js', () => {
    const app = fs.readFileSync(new URL('../../public/new-year.js', import.meta.url), 'utf8');
    const site = fs.readFileSync(new URL('../../website/site/assets/LRXe8-tt-newyear.js', import.meta.url), 'utf8');
    expect(site).toBe(app);
  });
});

// A canvas stand-in for Node: every 2D call is a no-op, and drawing calls are counted.
function stubCanvas(width = 800, height = 600) {
  let draws = 0;
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        if (key === 'fillText' || key === 'fillRect') draws++;
        return key.startsWith?.('create') ? gradient : undefined;
      };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  let sizeSets = 0, w = 0, h = 0;
  const canvas = {
    get width() { return w; },
    set width(v) { sizeSets++; w = v; },
    get height() { return h; },
    set height(v) { sizeSets++; h = v; },
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: width, bottom: height, width, height }),
  };
  return { canvas, draws: () => draws, sizeSets: () => sizeSets };
}

const IN_SEASON = () => new Date(2026, 11, 24, 20, 0);

describe('season', () => {
  it('starts on 20 December at local midnight', () => {
    expect(newYear.isSeason(new Date(2026, 11, 19, 23, 59))).toBe(false);
    expect(newYear.isSeason(new Date(2026, 11, 20, 0, 0))).toBe(true);
    expect(newYear.isSeason(new Date(2026, 11, 31, 12, 0))).toBe(true);
  });

  it('ends after 6 January', () => {
    expect(newYear.isSeason(new Date(2027, 0, 6, 23, 59))).toBe(true);
    expect(newYear.isSeason(new Date(2027, 0, 7, 0, 0))).toBe(false);
    expect(newYear.isSeason(new Date(2026, 6, 1))).toBe(false);
  });
});

describe('greeting', () => {
  it('names next year in December and this year in January', () => {
    expect(newYear.greeting(new Date(2026, 11, 24), 'en')).toBe('HAPPY NEW YEAR 2027');
    expect(newYear.greeting(new Date(2027, 0, 3), 'tr')).toBe('MUTLU YILLAR 2027');
  });

  it('names the coming year in a forced preview before the season', () => {
    expect(newYear.greeting(new Date(2026, 10, 13), 'en')).toBe('HAPPY NEW YEAR 2027');
  });

  it('falls back to English for an unknown language', () => {
    expect(newYear.greeting(new Date(2026, 11, 24), 'de')).toBe('HAPPY NEW YEAR 2027');
  });
});

describe('preview override', () => {
  it('is on only for newyear=1', () => {
    expect(newYear.forced('?newyear=1')).toBe(true);
    expect(newYear.forced('?lang=tr&newyear=1')).toBe(true);
    expect(newYear.forced('')).toBe(false);
    expect(newYear.forced('?newyear=0')).toBe(false);
  });
});

describe('layout beside the card', () => {
  it('centres the tree in the free space left of the card without touching it', () => {
    const { tree } = newYear.layout(1440, 900, { left: 540, top: 120, width: 360, height: 640 });
    expect(tree).not.toBeNull();
    expect(tree.cx).toBeGreaterThan(0);
    expect(tree.cx).toBeLessThan(540);
    expect(tree.cx - tree.width / 2).toBeGreaterThanOrEqual(0);
    expect(tree.cx + tree.width / 2).toBeLessThanOrEqual(540 - 16);
    expect(tree.height).toBeGreaterThan(0.55 * 900 * 0.9);
    expect(tree.height).toBeLessThan(0.55 * 900 * 1.1);
  });

  it('shrinks the tree when the free space is narrow', () => {
    const { tree } = newYear.layout(1000, 1000, { left: 300, top: 100, width: 400, height: 700 });
    expect(tree).not.toBeNull();
    expect(tree.cx + tree.width / 2).toBeLessThanOrEqual(300 - 16);
    expect(tree.height).toBeLessThan(0.55 * 1000);
  });

  it('leaves the tree out when there is less than 190 px beside the card', () => {
    expect(newYear.layout(1000, 700, { left: 180, top: 100, width: 640, height: 500 }).tree).toBeNull();
    expect(newYear.layout(390, 844, { left: 16, top: 80, width: 358, height: 600 }).tree).toBeNull();
  });
});

describe('scene', () => {
  it('draws one still frame and schedules nothing when motion is reduced', () => {
    const { canvas, draws } = stubCanvas();
    const raf = vi.fn(() => 1);
    const scene = newYear.create(canvas, { now: IN_SEASON, reduced: () => true, raf, caf: vi.fn() });
    scene.start();
    expect(draws()).toBeGreaterThan(0);
    expect(raf).not.toHaveBeenCalled();
  });

  it('schedules no frame after stop(), even from a frame already queued', () => {
    const { canvas } = stubCanvas();
    let queued = null;
    const raf = vi.fn((fn) => { queued = fn; return 7; });
    const caf = vi.fn();
    const scene = newYear.create(canvas, { now: IN_SEASON, reduced: () => false, raf, caf });
    scene.start();
    scene.start();
    expect(raf).toHaveBeenCalledTimes(1);
    scene.stop();
    expect(caf).toHaveBeenCalledWith(7);
    queued(16);
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('draws nothing before the first frame of a build, so the finished tree never flashes first', () => {
    const { canvas, draws } = stubCanvas();
    const scene = newYear.create(canvas, { now: IN_SEASON, reduced: () => false, raf: vi.fn(() => 1), caf: vi.fn() });
    scene.start('build');
    expect(draws()).toBe(0);
  });

  it('keeps the canvas bitmap when a resize does not change its size (the card grew)', () => {
    const { canvas, sizeSets } = stubCanvas();
    const scene = newYear.create(canvas, { now: IN_SEASON, reduced: () => false, raf: vi.fn(() => 1), caf: vi.fn() });
    scene.start('build');
    const before = sizeSets();
    scene.resize();
    expect(sizeSets()).toBe(before);
  });

  it('redraws at once after a resize while running, so no blank frame is painted', () => {
    const { canvas, draws } = stubCanvas();
    const scene = newYear.create(canvas, { now: IN_SEASON, reduced: () => false, raf: vi.fn(() => 1), caf: vi.fn() });
    scene.start('finished');
    const before = draws();
    scene.resize();
    expect(draws()).toBeGreaterThan(before);
  });

  it('does nothing outside the season unless forced', () => {
    const { canvas, draws } = stubCanvas();
    const raf = vi.fn(() => 1);
    const opts = { now: () => new Date(2026, 6, 1), reduced: () => false, raf, caf: vi.fn() };
    newYear.create(canvas, opts).start();
    expect(draws()).toBe(0);
    expect(raf).not.toHaveBeenCalled();
    newYear.create(canvas, { ...opts, force: true }).start();
    expect(raf).toHaveBeenCalledTimes(1);
  });
});
