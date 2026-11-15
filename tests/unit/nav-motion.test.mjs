import { describe, expect, it } from 'vitest';
import motion from '../../public/nav-motion.js';

// A stand-in for a laid-out nav button: [left, top, width, height] inside the nav.
const item = ([x, y, w, h], extra = {}) => ({ hidden: false, offsetParent: {}, offsetLeft: x, offsetTop: y, offsetWidth: w, offsetHeight: h, ...extra });

describe('sidebar highlight', () => {
  it('measures a laid-out item inside the nav', () => {
    expect(motion.boxOf(item([0, 44, 212, 40]))).toEqual({ x: 0, y: 44, w: 212, h: 40 });
  });

  it('has no box for a missing, hidden or collapsed item', () => {
    expect(motion.boxOf(null)).toBe(null);
    expect(motion.boxOf(item([0, 0, 212, 40], { hidden: true }))).toBe(null);
    expect(motion.boxOf(item([0, 0, 212, 40], { offsetParent: null }))).toBe(null); // display:none or detached
    expect(motion.boxOf(item([0, 0, 0, 0]))).toBe(null);
  });

  it('glides only on a tab switch; a first placement or a layout change jumps', () => {
    const a = item([0, 0, 212, 40]), b = item([0, 44, 212, 40]);
    expect(motion.moveFor(null, a, motion.boxOf(a))).toBe('jump');
    expect(motion.moveFor({ shown: false, item: null }, a, motion.boxOf(a))).toBe('jump');
    expect(motion.moveFor({ shown: false, item: a }, b, motion.boxOf(b))).toBe('jump'); // was hidden: appear in place
    expect(motion.moveFor({ shown: true, item: a }, b, motion.boxOf(b))).toBe('glide');
    expect(motion.moveFor({ shown: true, item: a }, a, { x: 0, y: 88, w: 212, h: 40 })).toBe('jump'); // an item above was shown
    expect(motion.moveFor({ shown: true, item: a }, null, null)).toBe('hide');
    expect(motion.moveFor({ shown: true, item: a }, b, null)).toBe('hide'); // the new active item is hidden
  });

  it('places the highlight with a transform and a size', () => {
    expect(motion.styleFor({ x: 4, y: 88, w: 212, h: 40 })).toEqual({ transform: 'translate(4px, 88px)', width: '212px', height: '40px' });
  });

  it('attaches to nothing without a nav', () => {
    expect(motion.attach(null)).toBe(null);
  });
});
