/* =========================================================
   LRX New Year logo: a Santa hat, an ice frame with icicles
   and a string of Christmas lights around the sign-in logo,
   while Christmas Town is open (LRXNewYear.isSeason). One
   SVG laid over the logo; app.js inserts it and styles.css
   makes the lights twinkle. App only.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXNewYearLogo = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  // Logo units: the logo box is 0..100 on both axes. The metal frame of logo.png spans x 5.9..93.4 and
  // y 7.4..94.1, with corners of radius about 20. The SVG reaches past the box (the hat rises above it).
  const FRAME = { x0: 5.9, y0: 7.4, x1: 93.4, y1: 94.1, r: 20 };
  const VIEW = { x: -25, y: -38, w: 150, h: 160 };
  const BULBS = 28;
  const COLORS = ['#ff5a6b', '#ffd56b', '#5fe39a', '#6cb8ff'];

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const n2 = (v) => (Math.round(v * 100) / 100).toString();

  // A point on the frame outline and its outward normal, s in 0..1, clockwise from the top edge's left end.
  function outline(s) {
    const { x0, y0, x1, y1, r } = FRAME, w = x1 - x0 - 2 * r, h = y1 - y0 - 2 * r, q = (Math.PI * r) / 2;
    const arc = (cx, cy, from) => (u) => { const a = from + (u * Math.PI) / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a), Math.cos(a), Math.sin(a)]; };
    const segs = [
      [w, (u) => [x0 + r + u * w, y0, 0, -1]],
      [q, arc(x1 - r, y0 + r, -Math.PI / 2)],
      [h, (u) => [x1, y0 + r + u * h, 1, 0]],
      [q, arc(x1 - r, y1 - r, 0)],
      [w, (u) => [x1 - r - u * w, y1, 0, 1]],
      [q, arc(x0 + r, y1 - r, Math.PI / 2)],
      [h, (u) => [x0, y1 - r - u * h, -1, 0]],
      [q, arc(x0 + r, y0 + r, Math.PI)],
    ];
    let d = (((s % 1) + 1) % 1) * segs.reduce((sum, [len]) => sum + len, 0);
    for (const [len, at] of segs) { if (d <= len) return at(d / len); d -= len; }
    return segs[0][1](0);
  }

  // Frost: the inner edge lies a little over the metal rim, the outer edge is jagged like ice crystals
  // (thinner along the top, where the hat sits).
  function iceRing(rand) {
    const outer = [], inner = [], N = 150;
    for (let i = 0; i < N; i++) {
      const [x, y, nx, ny] = outline(i / N);
      const top = ny < -0.5 ? 0.55 : 1;
      const out = top * (1.6 + (i % 2 ? 1.2 + rand() * 2.2 : rand() * 0.8) + (rand() < 0.07 ? 2.5 + rand() * 2 : 0));
      outer.push(n2(x + nx * out) + ' ' + n2(y + ny * out));
      inner.push(n2(x - nx * 1.4) + ' ' + n2(y - ny * 1.4));
    }
    return 'M' + outer.join('L') + 'ZM' + inner.reverse().join('L') + 'Z';
  }

  // Icicles under the bottom edge, between the bulbs there, longer towards the middle.
  function icicles(rand) {
    let out = '';
    const { y1 } = FRAME, y = y1 + 1.6;
    for (let i = 0; i < 12; i++) {
      const x = 15 + i * 6.3 + (rand() - 0.5) * 1.2;
      const len = 3 + (1 - Math.abs(x - 50) / 45) * 6 + rand() * 4, w = 1.1 + rand() * 0.9;
      out += '<path d="M' + n2(x - w) + ' ' + n2(y) + 'Q' + n2(x - w * 0.3) + ' ' + n2(y + len * 0.6) + ' ' + n2(x) + ' ' + n2(y + len)
        + 'Q' + n2(x + w * 0.4) + ' ' + n2(y + len * 0.5) + ' ' + n2(x + w) + ' ' + n2(y) + 'Z"/>';
    }
    return out;
  }

  function glint(x, y, s) {
    const k = s * 0.22;
    return '<path class="nyl-glint" d="M' + [[x, y - s], [x + k, y - k], [x + s, y], [x + k, y + k], [x, y + s], [x - k, y + k], [x - s, y], [x - k, y - k]].map((p) => n2(p[0]) + ' ' + n2(p[1])).join('L') + 'Z"/>';
  }

  // The string of lights: a wire that waves around the frame, with a bulb pointing outwards at each crest.
  function lights() {
    const wave = (s) => 2.6 + 1.1 * Math.cos(2 * Math.PI * BULBS * s);
    const pts = [];
    for (let i = 0; i <= BULBS * 8; i++) {
      const s = i / (BULBS * 8), [x, y, nx, ny] = outline(s), o = wave(s);
      pts.push(n2(x + nx * o) + ' ' + n2(y + ny * o));
    }
    let bulbs = '';
    for (let i = 0; i < BULBS; i++) {
      const s = i / BULBS, [x, y, nx, ny] = outline(s), o = wave(s);
      const angle = (Math.atan2(-nx, ny) * 180) / Math.PI; // the bulb is drawn hanging down (+y); turn it outwards
      const c = i % COLORS.length;
      bulbs += '<g class="nyl-bulb nyl-c' + c + '" transform="translate(' + n2(x + nx * o) + ' ' + n2(y + ny * o) + ') rotate(' + n2(angle) + ')">'
        + '<circle class="nyl-glow" cy="4.6" r="6.6" fill="url(#nyl-halo' + c + ')"/>'
        + '<rect x="-1.3" y="-0.3" width="2.6" height="2.2" rx=".5" fill="#26352b"/>'
        + '<ellipse class="nyl-glass" cy="4.8" rx="2.3" ry="3.4" fill="' + COLORS[c] + '"/>'
        + '<ellipse cx="-.7" cy="3.8" rx=".55" ry="1.15" fill="#fff" opacity=".65"/></g>';
    }
    return '<path class="nyl-wire" d="M' + pts.join('L') + '" fill="none" stroke="#1f2b23" stroke-width="1" stroke-linejoin="round"/>' + bulbs;
  }

  // The Santa hat on the top-right corner, tilted, its tip flopping over to the right.
  function hat() {
    let fur = '';
    for (let i = 0; i < 11; i++) fur += '<circle cx="' + (-20 + i * 4) + '" cy="' + n2(-5.6 + (i % 2) * 0.6) + '" r="1.5"/><circle cx="' + (-18 + i * 4) + '" cy="' + n2(5.4 - (i % 2) * 0.6) + '" r="1.3" opacity=".75"/>';
    return '<g class="nyl-hat" transform="translate(75 10) rotate(27) scale(.9)">'
      + '<path d="M-20 -4C-17 -26 -4 -42 14 -42C28 -42 38 -33 41 -20L36 -19C33 -28 26 -31 19 -28C16 -19 17 -11 20 -4Z" fill="url(#nyl-red)"/>'
      + '<path d="M14 -42C28 -42 38 -33 41 -20L36 -19C33 -28 26 -31 19 -28C16 -19 17 -11 20 -4L9 -4C12 -16 10 -30 14 -42Z" fill="#000" opacity=".18"/>'
      + '<path d="M-14 -10C-11 -24 -3 -34 7 -37" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".28"/>'
      + '<rect x="-23.5" y="-6" width="47" height="12" rx="6" fill="url(#nyl-fur)"/>'
      + '<g fill="#fff" opacity=".9">' + fur + '</g>'
      + '<circle cx="39" cy="-17" r="6.5" fill="url(#nyl-pom)"/></g>';
  }

  // The whole decoration as SVG markup. It is the same every time (seeded), so it can be tested and cached.
  function markup() {
    const rand = rng(2027);
    const halos = COLORS.map((c, i) => '<radialGradient id="nyl-halo' + i + '"><stop offset="0" stop-color="' + c + '" stop-opacity=".7"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></radialGradient>').join('');
    return '<svg class="auth-logo-xmas" viewBox="' + [VIEW.x, VIEW.y, VIEW.w, VIEW.h].join(' ') + '" aria-hidden="true" focusable="false">'
      + '<defs>'
      + '<linearGradient id="nyl-ice" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6fcff" stop-opacity=".95"/><stop offset=".5" stop-color="#9fd6f3" stop-opacity=".82"/><stop offset="1" stop-color="#e3f5ff" stop-opacity=".95"/></linearGradient>'
      + '<linearGradient id="nyl-icicle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6fcff" stop-opacity=".95"/><stop offset=".55" stop-color="#a6dbf6" stop-opacity=".85"/><stop offset="1" stop-color="#d8f2ff" stop-opacity=".2"/></linearGradient>'
      + '<linearGradient id="nyl-red" x1="0" y1="-42" x2="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ef4459"/><stop offset="1" stop-color="#a3172b"/></linearGradient>'
      + '<linearGradient id="nyl-fur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#d6e1ec"/></linearGradient>'
      + '<radialGradient id="nyl-pom" cx=".38" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#cfdbe7"/></radialGradient>'
      + halos + '</defs>'
      + '<g class="nyl-ice"><path d="' + iceRing(rand) + '" fill="url(#nyl-ice)" fill-rule="evenodd"/>'
      + '<g fill="url(#nyl-icicle)">' + icicles(rand) + '</g>'
      + '<g fill="#fff">' + glint(3.5, 62, 3.2) + glint(97, 50, 2.6) + glint(9.5, 93, 2.4) + glint(90, 91, 3) + '</g></g>'
      + lights() + hat() + '</svg>';
  }

  return Object.freeze({ FRAME, BULBS, COLORS, outline, markup });
});
