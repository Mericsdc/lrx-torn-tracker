/* =========================================================
   LRX New Year: a self-building ASCII tree (left of the
   sign-in card), an ASCII snowman (right of it), snow and
   stars. Shown only while Torn's Christmas Town is open:
   19 December 16:00 to 31 December 16:00 Torn time (TCT,
   which is UTC). Shared by the app's sign-in screen and
   lrxe8.com/torn-tracker, where it is LRXe8-tt-newyear.js
   (a test keeps the two copies identical). snowfall() is the
   light snow behind the app's cards.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXNewYear = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const GOLD = '#c9a96a', GOLD_2 = '#e3cc97', RED = '#d6455a', BLUE = '#5b8def', SNOW = '#f4f7fb';
  const GREENS = ['#1f5a32', '#28743f', '#32904d', '#3faa5c', '#5ec474', '#a3e8ae'];
  const TRUNK = '#8a6040';
  const BACKING = 'rgba(3,5,7,0.86)';
  const RAMP = '.:-=+*%#&M';
  const GAP = 16, MIN_FREE = 190, ASPECT = 0.7, TREE_H = 0.55, BASE_Y = 0.8;
  // Build timeline in ms: the cone, garlands, ornaments, gifts, the star, then the greeting.
  const T_CONE = 3000, T_GARLAND = 3800, T_ORNAMENT = 4400, T_GIFT = 5000, T_STAR = 5000, T_TEXT = 5200, T_TEXT_END = 6400, T_DONE = 6600;
  const FRAME_MS = 33;
  // The snowman: size, colours and its build timeline (it builds while the tree does).
  const SNOWMAN_H = 0.48, SNOWMAN_ASPECT = 0.62;
  const SNOW_SHADES = ['#6f7c8b', '#93a1b0', '#b9c4cf', '#dbe2e9', '#f4f7fb'];
  const CARROT = '#e8892b', COAL = '#15171b', HAT = '#3b414d', HAT_EDGE = '#6b7383', STICK = '#9a6b45';
  const S_BODY = 2800, S_HAT = 3400, S_FACE = 4000, S_SCARF = 4600, S_ARMS = 5200;

  // Christmas Town's dates: 19 December 16:00 up to (not including) 31 December 16:00, Torn time (UTC).
  function isSeason(date) {
    const t = date.getTime(), y = date.getUTCFullYear();
    return t >= Date.UTC(y, 11, 19, 16) && t < Date.UTC(y, 11, 31, 16);
  }

  // The coming year: next year from July on (December, or a forced preview), this year in January.
  function greeting(date, lang) {
    const year = date.getMonth() >= 6 ? date.getFullYear() + 1 : date.getFullYear();
    return (lang === 'tr' ? 'MUTLU YILLAR ' : 'HAPPY NEW YEAR ') + year;
  }

  // ?newyear=1 forces the scene on outside the season, for previews and checks.
  function forced(search) {
    try { return new URLSearchParams(search || '').get('newyear') === '1'; } catch { return false; }
  }

  // Where the tree and the snowman go: each centred in the free space on its side of the card (tree left,
  // snowman right), never closer than GAP to it, on one ground line. A side narrower than MIN_FREE stays empty.
  function layout(w, h, card) {
    const out = { tree: null, snowman: null };
    if (!(h > 0)) return out;
    const fit = (free, share, aspect) => {
      let height = h * share, width = height * aspect;
      const maxWidth = free - 24;
      if (width > maxWidth) { width = maxWidth; height = width / aspect; }
      return { width, height };
    };
    const free = (card ? card.left : w * 0.5) - GAP;
    if (free >= MIN_FREE) out.tree = { cx: free / 2, baseY: h * BASE_Y, ...fit(free, TREE_H, ASPECT) };
    const start = (card ? card.left + card.width : w * 0.5) + GAP;
    const right = w - start;
    if (right >= MIN_FREE) out.snowman = { cx: start + right / 2, baseY: h * BASE_Y, ...fit(right, SNOWMAN_H, SNOWMAN_ASPECT) };
    return out;
  }

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (v) => clamp(v, 0, 1);

  // The tree in grid cells: foliage rows with tiers, garland and ornament cells, trunk and gift boxes.
  function buildTree(tree) {
    const ch = clamp(tree.height / 42, 8, 15);
    const cw = ch * 0.62;
    const rows = Math.max(12, Math.floor(tree.height / ch) - 5);
    const maxHw = Math.max(5, Math.floor(tree.width / 2 / cw));
    const top = tree.baseY - (rows + 3) * ch; // star space above, trunk below
    const cells = [];
    const spans = [];
    const ornaments = [];
    const tiers = 4;
    for (let r = 0; r < rows; r++) {
      const y = r / (rows - 1);
      const tier = Math.min(tiers - 1, Math.floor(y * tiers));
      const u = y * tiers - tier;
      const jag = (hash(r, 7) - 0.5) * 1.2;
      const hw = Math.max(0.6, maxHw * (0.1 + 0.9 * y) * (0.7 + 0.3 * u) + jag);
      const span = Math.round(hw);
      spans.push(span);
      for (let c = -span; c <= span; c++) {
        const s = clamp(c / (hw + 0.5), -1, 1);
        const a = Math.asin(s) / Math.PI;
        const g = y * 3.6 + a * 1.6;
        const garland = y > 0.07 && Math.abs(g - Math.round(g)) < 0.085;
        const snowy = u < 0.16 && hash(c + 40, r) < 0.4 * (1 - y * 0.6);
        const cell = { r, c, y, s, garland, snowy };
        cells.push(cell);
        if (!garland && y > 0.1 && Math.abs(s) < 0.92 && hash(c + 99, r * 3 + 1) < 0.06) {
          const k = hash(c, r + 500);
          ornaments.push({ r, c, color: k < 0.45 ? RED : k < 0.75 ? GOLD_2 : BLUE, ch: k < 0.6 ? 'o' : '@', seed: k * 10 });
        }
      }
    }
    ornaments.sort((p, q) => q.r - p.r);
    const trunkHw = Math.max(1, Math.round(maxHw * 0.1));
    const gifts = [
      { dx: -Math.round(maxHw * 0.62), w: 7, h: 3, color: RED },
      { dx: Math.round(maxHw * 0.6), w: 7, h: 4, color: BLUE },
      { dx: Math.round(maxHw * 0.12), w: 5, h: 3, color: GOLD },
    ];
    return { ch, cw, rows, maxHw, top, cx: tree.cx, baseY: tree.baseY, cells, spans, ornaments, trunkHw, gifts };
  }

  // The snowman in grid cells. Rows (k) count up from the ground line, columns (c) from the centre line.
  // Three shaded snowballs, then a top hat, coal eyes and buttons, a carrot nose pointing at the card,
  // a red scarf with a hanging end, and two stick arms (the right one waves).
  function buildSnowman(man) {
    const hs = man.height;
    const ch = clamp(hs / 34, 8, 15);
    const cw = ch * 0.62;
    const rb = 0.195 * hs, rm = 0.145 * hs, rh = 0.105 * hs;
    // Ball centres, px above the ground. They overlap only a little, so the three balls read as separate.
    const yb = rb, ym = yb + (rb + rm) * 0.92, yh = ym + (rm + rh) * 0.92;
    const row = (px) => Math.round(px / ch), col = (px) => Math.max(1, Math.round(px / cw));
    const balls = [{ y: yb, r: rb }, { y: ym, r: rm }, { y: yh, r: rh }];
    const byCell = new Map();
    const bodyTop = Math.ceil((yh + rh) / ch);
    for (let k = 1; k <= bodyTop; k++) {
      balls.forEach((b, i) => {
        const dy = (k * ch - b.y) / b.r;
        if (Math.abs(dy) >= 1) return;
        const span = Math.floor((b.r * Math.sqrt(1 - dy * dy)) / cw);
        for (let c = -span; c <= span; c++) {
          const nx = (c * cw) / b.r;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - dy * dy));
          const lum = clamp(0.3 + 0.5 * nz - 0.18 * nx + 0.12 * dy + (hash(c + 13 * i, k) - 0.5) * 0.14, 0, 0.999);
          byCell.set(k + ',' + c, { k, c, lum });
        }
      });
    }
    const body = [...byCell.values()];
    const spans = new Map();
    for (const { k, c } of body) { const s = spans.get(k) || [c, c]; spans.set(k, [Math.min(s[0], c), Math.max(s[1], c)]); }
    const brim = row(yh + rh * 0.88), hatW = col(rh * 0.72), hatRows = Math.max(2, row(0.11 * hs));
    const neck = row(ym + rm * 0.9), shoulder = row(ym + rm * 0.35);
    return {
      ch, cw, cx: man.cx, baseY: man.baseY, body, spans, bodyTop,
      drift: col(rb * 1.35),
      hat: { brim, brimW: col(rh * 1.2), w: hatW, rows: hatRows },
      eyes: { k: row(yh + rh * 0.3), dc: col(rh * 0.38) },
      nose: { k: row(yh - rh * 0.05), len: Math.max(2, col(rh * 0.55)) },
      mouth: { k: row(yh - rh * 0.45) },
      buttons: [row(ym + rm * 0.4), row(ym), row(ym - rm * 0.4), row(yb + rb * 0.25)],
      scarf: { k: neck, w: col(rh * 0.95), tail: col(rh * 0.5) },
      arms: { k: shoulder, from: col(rm * 0.88), len: Math.max(3, col(0.13 * hs)) },
    };
  }

  function create(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    const now = opts.now || (() => new Date());
    const raf = opts.raf || ((fn) => requestAnimationFrame(fn));
    const caf = opts.caf || ((id) => cancelAnimationFrame(id));
    const reduced = opts.reduced || (() => false);
    const langOf = opts.lang || (() => 'en');
    const cardOf = opts.card || (() => null);
    let mode = opts.mode === 'finished' ? 'finished' : 'build';
    let W = 0, H = 0, dpr = 1, geo = null, man = null, flakes = [], stars = [];
    let running = false, frameId = null, lastTs = null, elapsed = mode === 'finished' ? T_DONE : 0, still = false, observer = null, sized = false;

    // Reads the scene and card sizes. Assigning canvas.width clears the bitmap even to the same value, so the
    // bitmap and the snow are rebuilt only when the scene itself changes size; a card change only moves the tree.
    function measure() {
      const rect = canvas.getBoundingClientRect();
      const nextDpr = Math.min(1.5, opts.dpr || (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
      if (!sized || rect.width !== W || rect.height !== H || nextDpr !== dpr) {
        sized = true;
        W = rect.width; H = rect.height; dpr = nextDpr;
        canvas.width = Math.max(1, Math.round(W * dpr));
        canvas.height = Math.max(1, Math.round(H * dpr));
        scatter();
      }
      const el = cardOf();
      let card = null;
      if (el && el.getBoundingClientRect) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) card = { left: r.left - rect.left, top: r.top - rect.top, width: r.width, height: r.height };
      }
      const { tree, snowman } = layout(W, H, card);
      geo = tree ? buildTree(tree) : null;
      man = snowman ? buildSnowman(snowman) : null;
    }

    // Snow and stars for the current scene size (seeded, so the same size always gives the same sky).
    function scatter() {
      const rand = rng(Math.round(W) * 31 + Math.round(H));
      const area = W * H;
      flakes = Array.from({ length: Math.round(area / 9000) }, () => ({
        x: rand() * W, y: rand() * H, v: 12 + rand() * 30, sway: rand() * Math.PI * 2,
        ch: rand() < 0.6 ? '·' : rand() < 0.5 ? '*' : '+', a: 0.35 + rand() * 0.45, size: 9 + rand() * 5,
      }));
      stars = Array.from({ length: Math.round(area / 6000) }, () => ({
        x: rand() * W, y: rand() * H * 0.55, ch: rand() < 0.55 ? '+' : '·', phase: rand() * 7, speed: 0.6 + rand() * 1.6,
      }));
    }

    function drawStars(ts) {
      ctx.font = '10px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = SNOW;
      for (const s of stars) {
        ctx.globalAlpha = 0.18 + 0.55 * (0.5 + 0.5 * Math.sin(ts * 0.001 * s.speed + s.phase));
        ctx.fillText(s.ch, s.x, s.y);
      }
      ctx.globalAlpha = 1;
    }

    function drawSnow(dt) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = SNOW;
      for (const f of flakes) {
        if (dt) {
          f.y += f.v * dt / 1000;
          f.sway += dt / 1000;
          if (f.y > H + 8) { f.y = -8; }
        }
        ctx.globalAlpha = f.a;
        ctx.font = f.size.toFixed(0) + 'px ui-monospace, Consolas, monospace';
        ctx.fillText(f.ch, f.x + Math.sin(f.sway) * 6, f.y);
      }
      ctx.globalAlpha = 1;
    }

    function drawTree(t, ts) {
      const g = geo, phase = ts * 0.0009;
      const x = (c) => g.cx + c * g.cw;
      const y = (r) => g.top + (r + 2) * g.ch; // two rows of star space above the foliage
      // A soft dark halo, taller than wide, so the tree reads clearly over the lit town.
      const midY = (g.top + g.baseY) / 2, haloR = (g.baseY - g.top) * 0.62;
      ctx.save();
      ctx.translate(g.cx, midY); ctx.scale(0.8, 1);
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
      halo.addColorStop(0, 'rgba(0,0,0,0.7)');
      halo.addColorStop(0.7, 'rgba(0,0,0,0.45)');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(-haloR, -haloR, haloR * 2, haloR * 2);
      ctx.restore();

      // Cone: rows appear from the bottom up; freshly built rows flash pale.
      const shown = ease(t / T_CONE) * g.rows;
      // An opaque backing under every built row, so the characters never mix with the town's dots.
      ctx.fillStyle = BACKING;
      for (let r = 0; r < g.rows; r++) {
        if (g.rows - 1 - r >= shown) continue;
        const span = g.spans[r] + 0.5;
        ctx.fillRect(x(-span), y(r) - g.ch / 2, span * 2 * g.cw, g.ch + 0.5);
      }
      if (shown > 0) ctx.fillRect(x(-g.trunkHw - 0.5), y(g.rows) - g.ch / 2, (g.trunkHw * 2 + 1) * g.cw, g.ch * 2);

      ctx.font = '600 ' + (g.ch * 1.02).toFixed(1) + 'px ui-monospace, "JetBrains Mono", Consolas, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const garlandOn = ease((t - T_CONE) / (T_GARLAND - T_CONE));
      const buckets = new Map();
      const put = (color, ch, px, py) => { let b = buckets.get(color); if (!b) buckets.set(color, (b = [])); b.push(ch, px, py); };
      for (const cell of g.cells) {
        const fromBottom = g.rows - 1 - cell.r;
        if (fromBottom >= shown) continue;
        const px = x(cell.c), py = y(cell.r);
        if (shown - fromBottom < 1.5 && t < T_CONE) { put('#d9f5de', RAMP[6 + (cell.c & 3)], px, py); continue; }
        if (cell.garland && garlandOn > 0 && (1 - cell.y) <= garlandOn * 1.05) {
          put(Math.sin(ts * 0.004 + cell.c * 0.9 + cell.r) > 0 ? GOLD_2 : GOLD, (cell.c + cell.r) % 3 ? '*' : '+', px, py);
          continue;
        }
        if (cell.snowy) { put('#e8f0ec', (cell.c & 1) ? '*' : '.', px, py); continue; }
        const nz = Math.sqrt(1 - cell.s * cell.s);
        const tex = 0.5 + 0.5 * Math.sin(Math.asin(cell.s) * 3 + phase + cell.y * 9);
        const lum = clamp(0.22 + 0.55 * nz - 0.12 * cell.s + 0.3 * tex, 0, 0.999);
        put(GREENS[Math.floor(lum * GREENS.length)], RAMP[Math.floor(lum * RAMP.length)], px, py);
      }
      // Trunk under the foliage.
      if (shown > 0) {
        for (let r = 0; r < 2; r++) for (let c = -g.trunkHw; c <= g.trunkHw; c++) put(TRUNK, (c + r) & 1 ? '|' : '#', x(c), y(g.rows + r));
      }
      for (const [color, list] of buckets) {
        ctx.fillStyle = color;
        for (let i = 0; i < list.length; i += 3) ctx.fillText(list[i], list[i + 1], list[i + 2]);
      }

      // Ornaments, bottom first, then they blink gently.
      const orn = Math.floor(ease((t - T_GARLAND) / (T_ORNAMENT - T_GARLAND)) * g.ornaments.length);
      ctx.save();
      ctx.shadowBlur = 6;
      for (let i = 0; i < orn; i++) {
        const o = g.ornaments[i];
        ctx.globalAlpha = 0.65 + 0.35 * Math.sin(ts * 0.003 + o.seed);
        ctx.fillStyle = o.color; ctx.shadowColor = o.color;
        ctx.fillText(o.ch, x(o.c), y(o.r));
      }
      ctx.restore();

      // Gift boxes on the ground, each with a ribbon cross and a bow.
      const giftOn = ease((t - T_ORNAMENT) / (T_GIFT - T_ORNAMENT));
      g.gifts.forEach((box, i) => {
        if (giftOn * g.gifts.length <= i) return;
        const left = box.dx - Math.floor(box.w / 2), midC = box.dx, bottomRow = g.rows + 1, midR = bottomRow - Math.floor(box.h / 2);
        ctx.fillStyle = BACKING;
        ctx.fillRect(x(left - 0.5), y(bottomRow - box.h) - g.ch / 2, (box.w + 1) * g.cw, (box.h + 1) * g.ch);
        for (let r = 0; r < box.h; r++) {
          for (let c = 0; c < box.w; c++) {
            const col = left + c, row = bottomRow - r;
            const ribbon = col === midC || row === midR;
            ctx.fillStyle = ribbon ? GOLD_2 : box.color;
            ctx.fillText(ribbon ? (col === midC && row === midR ? '+' : col === midC ? '|' : '=') : '#', x(col), y(row));
          }
        }
        ctx.fillStyle = GOLD_2;
        ctx.fillText('8', x(midC), y(bottomRow - box.h));
      });

      // The star on top, with rays.
      if (t >= T_STAR) {
        const glow = 0.75 + 0.25 * Math.sin(ts * 0.004);
        const sx = g.cx, sy = y(-1);
        const flash = clamp(1 - (t - T_STAR) / 600, 0, 1);
        ctx.save();
        ctx.shadowColor = GOLD_2; ctx.shadowBlur = 16 + 14 * flash;
        ctx.globalAlpha = glow;
        ctx.fillStyle = GOLD_2;
        ctx.font = '700 ' + (g.ch * 2.4).toFixed(1) + 'px ui-monospace, Consolas, monospace';
        ctx.fillText('*', sx, sy + g.ch * 0.35);
        ctx.font = '600 ' + (g.ch * 1.02).toFixed(1) + 'px ui-monospace, Consolas, monospace';
        ctx.globalAlpha = glow * 0.85;
        const rays = [[-2.2, 0, '-'], [-3.4, 0, '-'], [2.2, 0, '-'], [3.4, 0, '-'], [0, -1.4, '|'], [0, -2.5, '|'], [0, -3.5, '.'],
          [-1.8, -1.1, '\\'], [1.8, -1.1, '/'], [-1.8, 1.1, '/'], [1.8, 1.1, '\\'], [-4.5, 0, '.'], [4.5, 0, '.']];
        for (const [dx, dy, chr] of rays) ctx.fillText(chr, sx + dx * g.cw, sy + dy * g.ch);
        ctx.restore();
      }

      // The greeting, typed in letter by letter in gold and red.
      if (t >= T_TEXT) {
        const text = greeting(now(), langOf());
        const n = Math.floor(ease((t - T_TEXT) / (T_TEXT_END - T_TEXT)) * text.length + (t >= T_TEXT_END ? text.length : 0));
        const size = Math.min(g.ch * 1.35, ((g.cx * 2 - 24) / text.length) / 0.78);
        const step = size * 0.78;
        const gy = g.baseY + g.ch * 1.8;
        ctx.save();
        ctx.fillStyle = BACKING;
        ctx.fillRect(g.cx - (text.length / 2 + 0.6) * step, gy - size * 0.75, (text.length + 1.2) * step, size * 1.5);
        ctx.font = '700 ' + size.toFixed(1) + 'px ui-monospace, "JetBrains Mono", Consolas, monospace';
        ctx.shadowBlur = 8;
        let letter = 0;
        for (let i = 0; i < Math.min(n, text.length); i++) {
          if (text[i] === ' ') continue;
          const color = letter++ % 2 ? RED : GOLD_2;
          ctx.fillStyle = color; ctx.shadowColor = color;
          ctx.fillText(text[i], g.cx + (i - (text.length - 1) / 2) * step, gy);
        }
        ctx.restore();
      }
    }

    // The snowman: snowballs build bottom to top, the hat drops on, then the face, the scarf and the arms.
    // Afterwards the right arm waves, the eyes blink now and then and the scarf end flutters.
    function drawSnowman(t, ts) {
      const m = man;
      const x = (c) => m.cx + c * m.cw;
      const y = (k) => m.baseY - k * m.ch;
      const shown = ease(t / S_BODY) * (m.bodyTop + 1);
      if (!(shown > 0)) return;
      const midY = y(m.bodyTop / 2), haloR = m.bodyTop * m.ch * 0.62;
      ctx.save();
      ctx.translate(m.cx, midY); ctx.scale(0.8, 1);
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
      halo.addColorStop(0, 'rgba(0,0,0,0.65)');
      halo.addColorStop(0.7, 'rgba(0,0,0,0.4)');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(-haloR, -haloR, haloR * 2, haloR * 2);
      ctx.restore();

      // Opaque backing under the built rows, the drift and the hat, so the town's dots never mix in.
      ctx.fillStyle = BACKING;
      const back = (k, c0, c1, dy = 0) => ctx.fillRect(x(c0 - 0.5), y(k) - m.ch / 2 - dy, (c1 - c0 + 1) * m.cw, m.ch + 0.5);
      for (const [k, [c0, c1]] of m.spans) if (k < shown) back(k, c0, c1);
      back(0, -m.drift, m.drift);
      const h = m.hat, hat = [];
      if (t >= S_BODY) {
        for (let c = -h.brimW; c <= h.brimW; c++) hat.push([h.brim, c, HAT_EDGE, '=']);
        for (let c = -h.w; c <= h.w; c++) hat.push([h.brim + 1, c, RED, c === 0 ? '*' : '=']);
        // A solid crown, lit from the left like the snowballs (a framed '#' grid read as a window).
        for (let r = 2; r <= h.rows + 2; r++) for (let c = -h.w; c <= h.w; c++) hat.push([h.brim + r, c, c < -h.w / 3 ? HAT_EDGE : HAT, 'M']);
      }
      const drop = Math.max(0, (1 - ease((t - S_BODY) / (S_HAT - S_BODY))) * 4 * m.ch); // px the hat still has to fall
      if (hat.length) {
        back(h.brim, -h.brimW, h.brimW, drop);
        for (let r = 1; r <= h.rows + 2; r++) back(h.brim + r, -h.w, h.w, drop);
      }

      // Everything drawn over the snowballs; those cells skip their snow character.
      const over = new Map();
      const add = (k, c, color, chr) => over.set(k + ',' + c, [k, c, color, chr]);
      if (!drop) for (const [k, c, color, chr] of hat) add(k, c, color, chr);
      if (t >= S_HAT) {
        const blink = ts > 0 && ts % 4200 < 160;
        for (const s of [-1, 1]) add(m.eyes.k, s * m.eyes.dc, COAL, blink ? '-' : '●');
      }
      if (t >= S_HAT + 200) for (let i = 0; i <= m.nose.len; i++) add(m.nose.k, -i, CARROT, i === m.nose.len ? '<' : '=');
      if (t >= S_HAT + 400) for (let c = -2; c <= 2; c++) add(m.mouth.k + (Math.abs(c) === 2 ? 1 : 0), c, COAL, '•');
      if (t >= S_HAT + 500) for (const k of m.buttons) add(k, 0, COAL, '●');
      if (t >= S_FACE) {
        const w = Math.round(ease((t - S_FACE) / (S_SCARF - S_FACE)) * m.scarf.w);
        for (let c = -w; c <= w; c++) add(m.scarf.k, c, c & 1 ? '#f07a8b' : RED, c & 1 ? '=' : '#');
        if (t >= S_SCARF) {
          const flutter = ts > 0 && Math.sin(ts * 0.005) > 0.35 ? 1 : 0;
          for (let i = 1; i <= 3; i++) add(m.scarf.k - i, m.scarf.tail + (i === 3 ? flutter : 0), i === 3 ? '#f07a8b' : RED, i === 3 ? '"' : '|');
        }
      }
      if (t >= S_SCARF) {
        const grown = Math.round(ease((t - S_SCARF) / (S_ARMS - S_SCARF)) * m.arms.len);
        const arm = (side, slope) => {
          let k = m.arms.k, c = side * m.arms.from;
          const chr = slope < 0.36 ? '-' : side > 0 ? '/' : '\\';
          for (let i = 1; i <= grown; i++) {
            c = side * (m.arms.from + i);
            k = m.arms.k + Math.round((i * slope * m.cw) / m.ch);
            back(k, c, c);
            add(k, c, STICK, chr);
          }
          if (grown === m.arms.len) {
            back(k + 1, c + side, c + side); back(k, c + side, c + side);
            add(k + 1, c + side, STICK, side > 0 ? '/' : '\\');
            add(k, c + side, STICK, '-');
          }
        };
        const wave = t >= S_ARMS && ts > 0 ? 0.5 + 0.5 * Math.sin(ts * 0.004) : 0.5;
        arm(-1, 0.62);
        arm(1, 0.3 + 0.9 * wave);
      }

      ctx.font = '600 ' + (m.ch * 1.02).toFixed(1) + 'px ui-monospace, "JetBrains Mono", Consolas, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const buckets = new Map();
      const put = (color, chr, px, py) => { let b = buckets.get(color); if (!b) buckets.set(color, (b = [])); b.push(chr, px, py); };
      for (let c = -m.drift; c <= m.drift; c++) put(SNOW_SHADES[hash(c, 3) < 0.5 ? 2 : 3], Math.abs(c) === m.drift ? '.' : c & 1 ? '~' : '_', x(c), y(0));
      for (const cell of m.body) {
        if (cell.k >= shown || over.has(cell.k + ',' + cell.c)) continue;
        if (shown - cell.k < 1.5 && t < S_BODY) { put('#ffffff', RAMP[6 + (cell.c & 3)], x(cell.c), y(cell.k)); continue; }
        put(SNOW_SHADES[Math.floor(cell.lum * SNOW_SHADES.length)], RAMP[Math.floor(cell.lum * RAMP.length)], x(cell.c), y(cell.k));
      }
      for (const [k, c, color, chr] of over.values()) put(color, chr, x(c), y(k));
      if (drop) for (const [k, c, color, chr] of hat) put(color, chr, x(c), y(k) - drop);
      // Coal (eyes, mouth, buttons) would vanish on the dark backing, so each piece gets a thin snow-white rim.
      ctx.lineWidth = Math.max(1.5, m.ch * 0.18); ctx.lineJoin = 'round'; ctx.strokeStyle = SNOW_SHADES[4];
      for (const [k, c, color, chr] of over.values()) if (color === COAL) ctx.strokeText(chr, x(c), y(k));
      for (const [color, list] of buckets) {
        ctx.fillStyle = color;
        for (let i = 0; i < list.length; i += 3) ctx.fillText(list[i], list[i + 1], list[i + 2]);
      }
    }

    function draw(t, ts, dt) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!(W > 0 && H > 0)) return;
      drawStars(ts);
      if (geo) drawTree(t, ts);
      if (man) drawSnowman(t, ts);
      drawSnow(dt);
    }

    function drawStill() { still = true; draw(T_DONE, 0, 0); }

    // After a size change, draw again right away: a resize callback runs before paint, and waiting for the
    // next frame would paint a blank canvas.
    function resize() {
      measure();
      if (running) draw(elapsed, lastTs || 0, 0);
      else if (still) drawStill();
    }

    // Time only advances while running, so a scene that was stopped (hidden tab, hero scrolled away)
    // resumes where it was instead of building the tree again.
    function loop(ts) {
      if (!running) return;
      frameId = raf(loop);
      if (lastTs === null) lastTs = ts - FRAME_MS;
      const dt = ts - lastTs;
      if (dt < FRAME_MS) return;
      lastTs = ts;
      elapsed += Math.min(100, dt);
      draw(elapsed, ts, Math.min(100, dt));
    }

    function observe() {
      if (observer || typeof ResizeObserver !== 'function') return;
      observer = new ResizeObserver(() => resize());
      observer.observe(canvas);
      const el = cardOf();
      if (el) observer.observe(el);
    }

    return {
      // start('build' | 'finished') plays the scene from that point; start() without a mode resumes it.
      // A scene that is already running keeps going.
      start(nextMode) {
        if (!opts.force && !isSeason(now())) return;
        if (nextMode === 'build' || nextMode === 'finished') { mode = nextMode; elapsed = mode === 'finished' ? T_DONE : 0; }
        if (running) return;
        observe();
        measure();
        if (reduced()) { drawStill(); return; }
        still = false; running = true; lastTs = null;
        frameId = raf(loop);
      },
      stop() {
        running = false;
        if (frameId !== null) caf(frameId);
        frameId = null;
      },
      finish() { mode = 'finished'; elapsed = Math.max(elapsed, T_DONE); if (!running) drawStill(); },
      resize,
    };
  }

  // Light snow for the app's own background, behind its cards: no tree, no stars, about 30 fps.
  // It draws only while visible() says the page is on screen and never when motion is reduced.
  function snowfall(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    const now = opts.now || (() => new Date());
    const raf = opts.raf || ((fn) => requestAnimationFrame(fn));
    const caf = opts.caf || ((id) => cancelAnimationFrame(id));
    const reduced = opts.reduced || (() => false);
    const visible = opts.visible || (() => true);
    const colorOf = opts.color || (() => SNOW);
    let W = 0, H = 0, flakes = [], running = false, frameId = null, lastTs = null, blank = true, observer = null;

    function measure() {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === W && rect.height === H && flakes.length) return;
      W = rect.width; H = rect.height;
      canvas.width = Math.max(1, Math.round(W));
      canvas.height = Math.max(1, Math.round(H));
      const rand = rng(Math.round(W) * 17 + Math.round(H));
      flakes = Array.from({ length: Math.min(160, Math.round((W * H) / 16000)) }, () => ({
        x: rand() * W, y: rand() * H, v: 10 + rand() * 22, sway: rand() * Math.PI * 2,
        ch: rand() < 0.65 ? '·' : rand() < 0.5 ? '*' : '+', a: 0.2 + rand() * 0.35, size: 8 + rand() * 5,
      }));
      blank = true;
    }

    function clear() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      blank = true;
    }

    function draw(dt) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      blank = false;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = colorOf();
      for (const f of flakes) {
        f.y += (f.v * dt) / 1000;
        f.sway += dt / 1000;
        if (f.y > H + 8) f.y = -8;
        ctx.globalAlpha = f.a;
        ctx.font = f.size.toFixed(0) + 'px ui-monospace, Consolas, monospace';
        ctx.fillText(f.ch, f.x + Math.sin(f.sway) * 6, f.y);
      }
      ctx.globalAlpha = 1;
    }

    function frame(ts) {
      if (!running) return;
      frameId = raf(frame);
      if (!visible()) { if (!blank) clear(); lastTs = null; return; }
      if (lastTs === null) lastTs = ts - FRAME_MS;
      const dt = ts - lastTs;
      if (dt < FRAME_MS) return;
      lastTs = ts;
      draw(Math.min(100, dt));
    }

    function stop() {
      running = false;
      if (frameId !== null) caf(frameId);
      frameId = null;
      clear();
    }

    return {
      // Starts the snow in the season (or when forced); outside it, or with motion reduced, it stops and clears
      // instead, so calling start() now and then ends the snow when Christmas Town closes in a running app.
      // force may be a function, read on every start, so a preview switched on after creation is seen.
      start() {
        const force = typeof opts.force === 'function' ? opts.force() : Boolean(opts.force);
        if (!force && !isSeason(now())) { if (running || !blank) stop(); return; }
        if (reduced()) { if (running || !blank) stop(); return; }
        if (running) return;
        if (!observer && typeof ResizeObserver === 'function') { observer = new ResizeObserver(() => { if (running) measure(); }); observer.observe(canvas); }
        measure();
        running = true; lastTs = null;
        frameId = raf(frame);
      },
      stop,
      resize() { if (running) measure(); },
    };
  }

  return Object.freeze({ isSeason, greeting, forced, layout, create, snowfall });
});
