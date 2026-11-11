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
