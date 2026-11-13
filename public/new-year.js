/* =========================================================
   LRX New Year: a self-building ASCII tree, snow and stars
   beside the sign-in card. Shown only from 20 December to
   6 January (local time). Shared by the app's sign-in screen
   and lrxe8.com/torn-tracker, where it is LRXe8-tt-newyear.js
   (a test keeps the two copies identical).
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

  function isSeason(date) {
    const m = date.getMonth(), d = date.getDate();
    return (m === 11 && d >= 20) || (m === 0 && d <= 6);
  }

  // The coming year: next year from July on (December, or a forced preview), this year in January.
  function greeting(date, lang) {
    const year = date.getMonth() >= 6 ? date.getFullYear() + 1 : date.getFullYear();
    return (lang === 'tr' ? 'MUTLU YILLAR ' : 'HAPPY NEW YEAR ') + year;
  }

  function forced(search) {
    try { return new URLSearchParams(search || '').get('newyear') === '1'; } catch { return false; }
  }

  // Where the tree goes: centred in the free space left of the card, never closer than GAP to it.
  function layout(w, h, card) {
    const free = (card ? card.left : w * 0.5) - GAP;
    if (!(free >= MIN_FREE) || !(h > 0)) return { tree: null };
    let height = h * TREE_H, width = height * ASPECT;
    const maxWidth = free - 24;
    if (width > maxWidth) { width = maxWidth; height = width / ASPECT; }
    return { tree: { cx: free / 2, baseY: h * BASE_Y, width, height } };
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

  function create(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    const now = opts.now || (() => new Date());
    const raf = opts.raf || ((fn) => requestAnimationFrame(fn));
    const caf = opts.caf || ((id) => cancelAnimationFrame(id));
    const reduced = opts.reduced || (() => false);
    const langOf = opts.lang || (() => 'en');
    const cardOf = opts.card || (() => null);
    let mode = opts.mode === 'finished' ? 'finished' : 'build';
    let W = 0, H = 0, dpr = 1, geo = null, flakes = [], stars = [];
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
      const { tree } = layout(W, H, card);
      geo = tree ? buildTree(tree) : null;
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

    function draw(t, ts, dt) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!(W > 0 && H > 0)) return;
      drawStars(ts);
      if (geo) drawTree(t, ts);
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

  return Object.freeze({ isSeason, greeting, forced, layout, create });
});
