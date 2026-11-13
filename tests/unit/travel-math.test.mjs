import { describe, expect, it } from 'vitest';
import travelMath from '../../public/travel-math.js';

describe('basic travel profit', () => {
  it('calculates one round trip and profit per hour from available stock', () => {
    // $400 margin, 15 available bag slots, a 30-minute flight each way.
    expect(travelMath.tripMetrics(400, 15, 100, 30)).toEqual({
      units: 15,
      trip: 6000,
      round: 60,
      perHour: 6000,
    });
  });
});

describe('price typed by the player', () => {
  it('reads thousands separators and k/m/b suffixes as whole dollars', () => {
    expect(travelMath.parsePrice('830000')).toBe(830000);
    expect(travelMath.parsePrice('830.000')).toBe(830000); // Turkish / European grouping
    expect(travelMath.parsePrice('830,000')).toBe(830000);
    expect(travelMath.parsePrice('1 250 000')).toBe(1250000);
    expect(travelMath.parsePrice('$1.250.000')).toBe(1250000);
    expect(travelMath.parsePrice('830k')).toBe(830000);
    expect(travelMath.parsePrice('1.5m')).toBe(1500000);
    expect(travelMath.parsePrice('1,5 M')).toBe(1500000);
    expect(travelMath.parsePrice('2b')).toBe(2000000000);
    expect(travelMath.parsePrice('1.25m')).toBe(1250000);
    expect(travelMath.parsePrice('1.2345m')).toBe(1234500);
  });
  it('refuses anything it cannot read exactly instead of saving a smaller number', () => {
    for (const text of ['', 'abc', '12.5', '1.5.m', '830.00', '-5', '1e6', '5 dollars']) expect(travelMath.parsePrice(text)).toBeNaN();
    // grouped number with a suffix: 1,500k is 1.5 thousand or 1.5 million depending on the reader
    for (const text of ['1,500k', '2.500k', '1.500m', '1,500,000k']) expect(travelMath.parsePrice(text)).toBeNaN();
  });
});
