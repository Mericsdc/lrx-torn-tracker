import { describe, expect, it } from 'vitest';
import logo from '../../public/new-year-logo.js';

const count = (text, re) => (text.match(re) || []).length;

describe('dressed-up sign-in logo', () => {
  it('builds the same SVG every time', () => {
    expect(logo.markup()).toBe(logo.markup());
    expect(logo.markup().startsWith('<svg class="auth-logo-xmas"')).toBe(true);
  });

  it('has a Santa hat, an ice frame with icicles and 28 lights all around', () => {
    const svg = logo.markup();
    expect(count(svg, /class="nyl-hat"/g)).toBe(1);
    expect(count(svg, /class="nyl-ice"/g)).toBe(1);
    expect(count(svg, /fill="url\(#nyl-icicle\)"/g)).toBe(1);
    expect(count(svg, /class="nyl-bulb /g)).toBe(28);
    expect(logo.BULBS).toBe(28);
    // Bulbs on every side of the frame, not only the top.
    const at = [...svg.matchAll(/class="nyl-bulb [^"]*" transform="translate\(([-\d.]+) ([-\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(at.some(([, y]) => y < 6)).toBe(true);
    expect(at.some(([, y]) => y > 95)).toBe(true);
    expect(at.some(([x]) => x < 5)).toBe(true);
    expect(at.some(([x]) => x > 95)).toBe(true);
  });

  it('defines every gradient it uses', () => {
    const svg = logo.markup();
    const used = new Set([...svg.matchAll(/url\(#([\w-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(0);
    for (const id of used) expect(svg).toContain('id="' + id + '"');
  });

  it('follows the logo frame: top edge faces up, bottom edge faces down', () => {
    const [, y0, nx0, ny0] = logo.outline(0);
    expect(y0).toBeCloseTo(logo.FRAME.y0);
    expect([nx0, ny0]).toEqual([0, -1]);
    const [, y1, nx1, ny1] = logo.outline(0.5);
    expect(y1).toBeCloseTo(logo.FRAME.y1);
    expect(nx1).toBeCloseTo(0);
    expect(ny1).toBeCloseTo(1);
  });
});
