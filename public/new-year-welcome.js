/* =========================================================
   LRX New Year celebration: a full-screen greeting with
   confetti and fireworks over the app, on 1 January (local
   time), once, the first time the tracker is on screen that
   day. There is no countdown: players open the app at
   different times. App only (the site does not load it).
   Settings -> App -> New Year celebration.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXNewYearWelcome = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  function isCelebrationDay(date) {
    return date.getMonth() === 0 && date.getDate() === 1;
  }

  function dayKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  // Decides when to show it. check() is cheap and safe to call often: on start, when the tracker comes back on
  // screen and every 30 s, so an app left open over midnight shows it soon after. onShow() and onStop() drive the
  // overlay. A preview (?newyear=1) shows it once per start and never stores the day.
  function scheduler(o) {
    const preview = () => (typeof o.preview === 'function' ? Boolean(o.preview()) : Boolean(o.preview));
    let memKey = null, previewShown = false;

    // Shown already: in this run (memory) or in an earlier one (storage). Memory is checked on its own, so storage
    // that still reads an older day but can no longer be written never repeats the celebration.
    const shown = (key) => {
      if (memKey === key) return true;
      try { return Boolean(o.storage) && o.storage.get() === key; } catch { return false; }
    };
    const remember = (key) => {
      memKey = key; // kept in memory too, so a storage error never repeats the celebration in this run
      try { if (o.storage) o.storage.set(key); } catch { /* storage blocked: memory is enough for this run */ }
    };

    function check() {
      if (!o.enabled()) { if (o.onStop) o.onStop(); return; }
      if (!o.visible()) return;
      const now = o.now();
      if (preview()) {
        if (!previewShown) { previewShown = true; o.onShow(); }
      } else if (isCelebrationDay(now) && !shown(dayKey(now))) {
        remember(dayKey(now));
        o.onShow();
      }
    }

    return { check };
  }

  // The scene's colours: gold, light gold, red, ornament blue, green, snow white.
  const COLORS = ['#c9a96a', '#e3cc97', '#d6455a', '#5b8def', '#5ec474', '#f4f7fb'];
  const SPARK_CHARS = ['*', '+', '·'];
  const FONT = ' ui-monospace, "JetBrains Mono", Consolas, monospace';
  // What fires when, in ms from the start: confetti from both bottom corners, then rockets.
  const PLAN = { confetti: [0, 1500], rockets: [150, 600, 1100, 1600, 2200, 2700, 3300, 3900, 4500] };

  // Confetti (turning paper pieces) and fireworks (rockets that burst into character sparks) on one canvas.
  // It runs until everything has landed or faded, or until stop(); with motion reduced it draws one still frame.
  function create(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    const raf = opts.raf || ((fn) => requestAnimationFrame(fn));
    const caf = opts.caf || ((id) => cancelAnimationFrame(id));
    const reduced = opts.reduced || (() => false);
    const random = opts.random || Math.random;
    let W = 0, H = 0, dpr = 1, running = false, frameId = null, t0 = null, last = 0;
    let pieces = [], rockets = [], sparks = [], flashes = [], events = [];
    const pick = (list) => list[Math.floor(random() * list.length)];

    function measure() {
      const rect = canvas.getBoundingClientRect();
      W = rect.width; H = rect.height;
      dpr = Math.min(1.5, opts.dpr || (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
    }

    function piece(x, y, vx, vy) {
      return {
        x, y, vx, vy, w: 5 + random() * 5, h: 8 + random() * 7, rot: random() * Math.PI * 2, spin: (random() - 0.5) * 10,
        flip: random() * Math.PI * 2, flipSpeed: 5 + random() * 8, sway: random() * Math.PI * 2, color: pick(COLORS),
      };
    }

    // A burst of paper from one bottom corner, thrown up and towards the middle.
    function confetti(side) {
      const n = Math.round(Math.min(110, Math.max(50, (W * H) / 12000)));
      const dir = side === 'left' ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const a = ((52 + random() * 30) * Math.PI) / 180;
        const speed = H * (1.5 + random() * 1.1);
        pieces.push(piece(side === 'left' ? W * 0.02 : W * 0.98, H + 8, dir * Math.cos(a) * speed, -Math.sin(a) * speed));
      }
    }

    function rocket() {
      rockets.push({ x: W * (0.1 + random() * 0.8), y: H + 6, vy: -H * (1.05 + random() * 0.3), top: H * (0.1 + random() * 0.28), color: pick(COLORS.slice(0, 5)) });
    }

    function burst(x, y, color) {
      // Two shells: a wide outer ring and a slower inner one, so the burst reads as round and full.
      const n = 60 + Math.floor(random() * 30);
      const base = Math.min(W, H) * (0.4 + random() * 0.14);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + random() * 0.15;
        const sp = base * (i % 3 === 0 ? 0.35 + random() * 0.2 : 0.75 + random() * 0.3);
        sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: 1.4 + random() * 0.8, ch: pick(SPARK_CHARS), color: random() < 0.75 ? color : pick(['#f4f7fb', '#e3cc97']) });
      }
      flashes.push({ x, y, age: 0 });
    }

    function fire(e) {
      if (e.type === 'confetti') { confetti('left'); confetti('right'); }
      else rocket();
    }

    function update(dt) {
      const drag = Math.exp(-3 * dt), g = H * 0.9; // paper: falls at about g / 3 once the throw is spent
      for (const p of pieces) {
        p.vy += g * dt; p.vx *= drag; p.vy *= drag; p.sway += dt * 2;
        p.x += (p.vx + Math.sin(p.sway) * H * 0.04) * dt; p.y += p.vy * dt;
        p.rot += p.spin * dt; p.flip += p.flipSpeed * dt;
      }
      pieces = pieces.filter((p) => !(p.y > H + 40 && p.vy > 0));
      for (const r of rockets) {
        r.y += r.vy * dt; r.vy += H * 0.35 * dt;
        if (r.y <= r.top || r.vy >= -H * 0.15) { r.done = true; burst(r.x, r.y, r.color); }
      }
      rockets = rockets.filter((r) => !r.done);
      const sd = Math.exp(-1.4 * dt);
      for (const s of sparks) { s.vx *= sd; s.vy = s.vy * sd + H * 0.22 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.age += dt; }
      sparks = sparks.filter((s) => s.age < s.life);
      for (const f of flashes) f.age += dt;
      flashes = flashes.filter((f) => f.age < 0.35);
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const f of flashes) {
        const r = Math.min(W, H) * 0.12, a = 1 - f.age / 0.35;
        const glow = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        glow.addColorStop(0, 'rgba(255,236,190,' + (0.35 * a).toFixed(3) + ')');
        glow.addColorStop(1, 'rgba(255,236,190,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 17px' + FONT;
      for (const s of sparks) {
        ctx.globalAlpha = Math.pow(1 - s.age / s.life, 1.2);
        ctx.fillStyle = s.color;
        ctx.fillText(s.ch, s.x, s.y);
      }
      for (const r of rockets) {
        ctx.fillStyle = r.color;
        ctx.globalAlpha = 1; ctx.fillText('|', r.x, r.y);
        ctx.globalAlpha = 0.55; ctx.fillText('·', r.x, r.y + 12);
        ctx.globalAlpha = 0.25; ctx.fillText('·', r.x, r.y + 24);
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const p of pieces) drawPiece(p);
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // One paper piece, turned by rot and flipped around its long axis (the flip squashes it, so it flutters).
    function drawPiece(p) {
      const c = Math.cos(p.rot), s = Math.sin(p.rot), fy = Math.cos(p.flip);
      ctx.setTransform(dpr * c, dpr * s, -dpr * s * fy, dpr * c * fy, dpr * p.x, dpr * p.y);
      ctx.globalAlpha = 0.7 + 0.3 * Math.abs(fy);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }

    // Reduced motion: paper lying across the screen and three opened fireworks, drawn once.
    function still() {
      for (let i = 0; i < 140; i++) pieces.push(piece(random() * W, H * (0.08 + random() * 0.9), 0, 0));
      for (const [fx, fy] of [[0.2, 0.22], [0.8, 0.2], [0.5, 0.12]]) {
        const color = pick(COLORS.slice(0, 5)), r = Math.min(W, H) * 0.13;
        for (let i = 0; i < 36; i++) {
          const a = (i / 36) * Math.PI * 2, d = r * (0.55 + random() * 0.45);
          sparks.push({ x: W * fx + Math.cos(a) * d, y: H * fy + Math.sin(a) * d, age: 0.3, life: 1.5, ch: pick(SPARK_CHARS), color: random() < 0.75 ? color : '#e3cc97' });
        }
      }
      draw();
    }

    function frame(ts) {
      if (!running) return;
      frameId = raf(frame);
      if (t0 === null) { t0 = ts; last = ts; }
      const dt = Math.min(0.05, Math.max(0, ts - last) / 1000);
      last = ts;
      while (events.length && events[0].at <= ts - t0) fire(events.shift());
      update(dt);
      draw();
      if (!events.length && !pieces.length && !rockets.length && !sparks.length && !flashes.length) {
        running = false; caf(frameId); frameId = null; // everything has landed or faded
      }
    }

    function stop() {
      running = false;
      if (frameId !== null) caf(frameId);
      frameId = null;
      pieces = []; rockets = []; sparks = []; flashes = []; events = [];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    return {
      start() {
        stop();
        measure();
        if (reduced()) { still(); return; }
        events = [
          ...PLAN.confetti.map((at) => ({ at, type: 'confetti' })),
          ...PLAN.rockets.map((at) => ({ at, type: 'rocket' })),
        ].sort((a, b) => a.at - b.at);
        running = true; t0 = null;
        frameId = raf(frame);
      },
      stop,
    };
  }

  const TEXT = {
    en: { hint: 'Click or press Esc to close' },
    tr: { hint: "Kapatmak için tıkla ya da Esc'ye bas" },
  };

  // The overlay in the page (#ny-welcome in index.html): the greeting in alternating gold and red letters, the
  // player's name and the canvas. A click, Esc or Enter closes it; those keys never reach the page underneath
  // while it is open. o: { reduced, lang, name, now, greeting(date, lang) }.
  function mount(root, o) {
    const doc = root.ownerDocument;
    const find = (sel) => root.querySelector(sel);
    const engine = create(find('.ny-canvas'), { reduced: o.reduced });
    const lang = () => (o.lang && o.lang() === 'tr' ? 'tr' : 'en');
    let closeTimer = null, hideTimer = null, prevFocus = null, listening = false;

    function open() {
      clearTimeout(hideTimer); hideTimer = null; // reopened while fading out
      if (root.hidden) {
        prevFocus = doc.activeElement;
        root.hidden = false;
      }
      if (!listening) { doc.addEventListener('keydown', onKey, true); listening = true; }
      root.classList.remove('leaving');
      find('.ny-hint').textContent = TEXT[lang()].hint;
      try { root.focus({ preventScroll: true }); } catch { /* focus is a nicety */ }
    }

    function writeGreeting() {
      const box = find('.ny-greet');
      box.textContent = '';
      let n = 0;
      [...o.greeting(o.now(), lang())].forEach((ch, i) => {
        const span = doc.createElement('span');
        span.textContent = ch;
        span.className = ch === ' ' ? 'sp' : n++ % 2 ? 'red' : 'gold';
        span.style.animationDelay = i * 45 + 'ms';
        box.appendChild(span);
      });
      find('.ny-name').textContent = (o.name && o.name()) || '';
    }

    function show() {
      open();
      root.classList.add('celebrating');
      writeGreeting();
      engine.start();
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => close(), 6000);
    }

    function close() {
      clearTimeout(closeTimer); closeTimer = null;
      if (root.hidden || hideTimer !== null) return;
      if (listening) { doc.removeEventListener('keydown', onKey, true); listening = false; }
      root.classList.add('leaving');
      hideTimer = setTimeout(() => {
        hideTimer = null;
        root.hidden = true;
        root.classList.remove('leaving', 'celebrating');
        engine.stop();
        if (prevFocus && prevFocus !== doc.body && doc.contains(prevFocus)) { try { prevFocus.focus({ preventScroll: true }); } catch { /* gone */ } }
        prevFocus = null;
      }, o.reduced && o.reduced() ? 0 : 500);
    }

    function onKey(e) {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    }

    root.addEventListener('click', () => close());
    return { show, close, isOpen: () => !root.hidden && hideTimer === null };
  }

  return Object.freeze({ isCelebrationDay, dayKey, scheduler, create, mount });
});
