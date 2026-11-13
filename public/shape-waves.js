/* =========================================================
   LRX ShapeWaves — canvas dot-grid wave field + Torn-style town
   Vanilla port of the "ShapeWaves" look (mixed shapes, white on
   black, glow, intro) with houses/buildings drawn from the grid.
   ========================================================= */
(function () {
  const OPTS = {
    shapes: 'mixed',
    cellSize: 10,
    dotSize: 0.5,
    color: '#ffffff',
    windowColor: '#e3cc97', // LRX champagne for lit windows
    speed: 1,
    scale: 0.3,
    contrast: 1,
    brightness: 0.4,
    fade: 0.25,
    glow: 0.35,
    intro: true,
    introDuration: 1.6,
    fps: 40,
  };

  // Cell types
  const SKY = 0, BACK = 1, BACK_LIT = 2, WALL = 3, LIT = 4, DARK = 5, ROOF = 6, GROUND = 7, TREE = 8, MOON = 9;

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  /* ---------- Town layout (in grid cells) ---------- */
  function buildTown(cols, rows) {
    const type = new Uint8Array(cols * rows);
    const phase = new Float32Array(cols * rows);
    const R = rng(cols * 7919 + rows * 104729 + 1337);
    const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
    const set = (x, y, t) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      const i = y * cols + x;
      // front layer wins over back layer, never overwrite with BACK
      if ((t === BACK || t === BACK_LIT) && type[i] !== SKY) return;
      type[i] = t;
      phase[i] = R() * Math.PI * 2;
    };
    const ground = rows - 3; // first ground row
    for (let y = ground; y < rows; y++) for (let x = 0; x < cols; x++) set(x, y, GROUND);

    // --- back layer: tall city blocks ---
    const maxBack = Math.max(10, Math.floor(rows * 0.46));
    for (let x = ri(-3, 0); x < cols; ) {
      const w = ri(4, 9), h = ri(Math.floor(rows * 0.2), maxBack);
      const top = ground - h;
      for (let yy = top; yy < ground; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          const interior = xx > x && xx < x + w - 1 && yy > top + 1;
          const win = interior && (xx - x) % 2 === 1 && (yy - top) % 3 !== 0;
          set(xx, yy, win ? (R() < 0.22 ? BACK_LIT : SKY) : BACK);
        }
      }
      if (R() < 0.35) { // antenna
        const ax = x + Math.floor(w / 2);
        for (let k = 1; k <= ri(2, 5); k++) set(ax, top - k, BACK);
      }
      x += w + ri(0, 2);
    }

    // --- front layer: houses, apartments, trees ---
    for (let x = ri(-4, 1); x < cols; ) {
      const pick = R();
      if (pick < 0.62) {
        // pitched-roof house
        let w = ri(9, 15); if (w % 2 === 0) w++;
        const wallH = ri(5, 8);
        const top = ground - wallH;
        for (let yy = top; yy < ground; yy++) for (let xx = x; xx < x + w; xx++) set(xx, yy, WALL);
        // windows (2x2) left + right, door in the middle
        const wy = top + 2;
        const lit1 = R() < 0.7, lit2 = R() < 0.55;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          set(x + 2 + dx, wy + dy, lit1 ? LIT : DARK);
          set(x + w - 4 + dx, wy + dy, lit2 ? LIT : DARK);
        }
        const dx0 = x + Math.floor(w / 2);
        for (let yy = ground - 3; yy < ground; yy++) set(dx0, yy, R() < 0.25 ? LIT : DARK);
        // roof with 1-cell overhang
        let l = x - 1, r = x + w, y = top - 1;
        while (l <= r) { for (let xx = l; xx <= r; xx++) set(xx, y, ROOF); l++; r--; y--; }
        // chimney
        if (R() < 0.6) {
          const cx = R() < 0.5 ? x + 2 : x + w - 3;
          const cTop = top - Math.floor(w / 2) + 1;
          for (let yy = cTop; yy < top - 1; yy++) set(cx, yy, ROOF);
        }
        // attic window
        if (wallH >= 6 && R() < 0.5) set(x + Math.floor(w / 2), top - 2, R() < 0.6 ? LIT : DARK);
        x += w + ri(1, 3);
      } else if (pick < 0.84) {
        // small apartment block
        const w = ri(8, 12), h = ri(10, Math.max(11, Math.floor(rows * 0.3)));
        const top = ground - h;
        for (let yy = top; yy < ground; yy++) for (let xx = x; xx < x + w; xx++) {
          const interior = xx > x && xx < x + w - 1 && yy > top && yy < ground - 1;
          const win = interior && (xx - x) % 3 !== 0 && (yy - top) % 3 !== 0;
          set(xx, yy, win ? (R() < 0.45 ? LIT : DARK) : WALL);
        }
        for (let xx = x - 1; xx <= x + w; xx++) set(xx, top - 1, ROOF); // parapet
        x += w + ri(1, 3);
      } else {
        // tree
        const trunk = ri(2, 3), rad = ri(2, 3);
        const cx = x + rad;
        for (let yy = ground - trunk; yy < ground; yy++) set(cx, yy, WALL);
        const cy = ground - trunk - rad;
        for (let yy = -rad; yy <= rad; yy++) for (let xx = -rad; xx <= rad; xx++) {
          if (xx * xx + yy * yy <= rad * rad + 1) set(cx + xx, cy + yy, TREE);
        }
        x += rad * 2 + ri(1, 3);
      }
    }

    // moon (upper right, behind the fade)
    const mr = Math.max(4, Math.round(rows * 0.06));
    const mx = Math.round(cols * 0.84), my = Math.round(rows * 0.16);
    for (let yy = -mr; yy <= mr; yy++) for (let xx = -mr; xx <= mr; xx++) {
      const d = xx * xx + yy * yy;
      const ox = xx + mr * 0.55, oy = yy + mr * 0.1;
      if (d <= mr * mr + mr && ox * ox + oy * oy > mr * mr * 0.42) {
        const i = (my + yy) * cols + (mx + xx);
        if (i >= 0 && i < type.length && type[i] === SKY) type[i] = MOON;
      }
    }
    return { type, phase };
  }

  /* ---------- Renderer ---------- */
  function create2D(canvas, opts = {}) {
    const o = { ...OPTS, ...opts };
    const ctx = canvas.getContext('2d');
    const buf = document.createElement('canvas');
    const bctx = buf.getContext('2d');
    const glowC = document.createElement('canvas');
    const gctx = glowC.getContext('2d');
    let W = 0, H = 0, dpr = 1, cols = 0, rows = 0, town = null;
    let raf = 0, running = false, t0 = 0, introStart = 0, last = 0;
    const reduce = () => document.body.classList.contains('no-anim') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    const LEVELS = 10;

    // Sprite atlas: [color][kind][level] pre-rendered once per resize → per-cell blit
    let atlas = null, cellPx = 0;
    function levelSize(l) { const I = (l + 0.5) / LEVELS; return Math.min(0.94, (0.2 + 0.8 * I) * (o.dotSize * 2)); }
    function levelAlpha(l) { return 0.06 + 0.94 * ((l + 1) / LEVELS); }
    function buildAtlas() {
      cellPx = Math.max(2, Math.round(o.cellSize * dpr));
      atlas = document.createElement('canvas');
      atlas.width = cellPx * LEVELS; atlas.height = cellPx * 8;
      const a = atlas.getContext('2d');
      [o.color, o.windowColor].forEach((col, ci) => {
        for (let k = 0; k < 4; k++) for (let l = 0; l < LEVELS; l++) {
          const p = new Path2D();
          shapePath(p, k, l * cellPx + cellPx / 2, (ci * 4 + k) * cellPx + cellPx / 2, cellPx * levelSize(l));
          a.globalAlpha = levelAlpha(l); a.fillStyle = col; a.fill(p);
        }
      });
    }

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(1.25, window.devicePixelRatio || 1);
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      for (const c of [canvas, buf]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      glowC.width = Math.max(1, Math.round(W / 4)); glowC.height = Math.max(1, Math.round(H / 4));
      cols = Math.ceil(W / o.cellSize); rows = Math.ceil(H / o.cellSize);
      town = buildTown(cols, rows);
      buildAtlas();
      if (!running) draw(performance.now());
    }

    function shapePath(p, kind, cx, cy, s) {
      const h = s / 2;
      switch (kind) {
        case 0: p.moveTo(cx + h, cy); p.arc(cx, cy, h, 0, Math.PI * 2); break;
        case 1: p.rect(cx - h, cy - h, s, s); break;
        case 2: p.moveTo(cx, cy - h); p.lineTo(cx + h, cy + h * 0.85); p.lineTo(cx - h, cy + h * 0.85); p.closePath(); break;
        default: p.moveTo(cx, cy - h); p.lineTo(cx + h, cy); p.lineTo(cx, cy + h); p.lineTo(cx - h, cy); p.closePath();
      }
    }

    function draw(now) {
      if (!town || !atlas) return;
      const t = ((now - t0) / 1000) * o.speed;
      const introP = o.intro && !reduce() ? clamp((now - introStart) / (o.introDuration * 1000)) : 1;
      const eased = 1 - Math.pow(1 - introP, 3);
      const cs = o.cellSize;
      const f = o.scale * 0.055;
      const cxm = W * 0.5, cym = H * 0.42;
      const fadeRows = Math.max(1, rows * o.fade * 2.6);
      const { type, phase } = town;
      const step = cs * dpr;

      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.clearRect(0, 0, buf.width, buf.height);
      for (let y = 0; y < rows; y++) {
        const py = y * cs + cs / 2;
        const fromBottom = 1 - y / rows;
        const reveal = introP >= 1 ? 1 : clamp((eased * 1.25 - fromBottom) / 0.18);
        if (reveal <= 0) continue;
        const skyFade = clamp(y / fadeRows);
        const sy0 = Math.round(y * step);
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const px = x * cs + cs / 2;
          const k = type[i];
          const dx = px - cxm, dy = py - cym;
          const v = Math.sin(px * f + t * 0.9)
            + Math.sin(py * f * 1.3 - t * 0.7)
            + Math.sin((px + py) * f * 0.7 + t * 0.5)
            + Math.sin(Math.sqrt(dx * dx + dy * dy) * f * 0.9 - t * 1.2);
          const wave = clamp((v / 8) * o.contrast * 1.7 + 0.5);
          let I, ci = 0, kind;
          const hsh = hash(x, y);
          switch (k) {
            case SKY: {
              if (skyFade <= 0) continue;
              const w2 = wave * wave * wave;
              I = o.brightness * w2 * 0.9 * skyFade;
              kind = hsh < 0.45 ? 0 : hsh < 0.7 ? 1 : hsh < 0.88 ? 2 : 3;
              break;
            }
            case MOON: I = 0.6 + 0.25 * wave; kind = 0; break;
            case BACK: I = 0.15 + 0.18 * wave; kind = hsh < 0.7 ? 1 : 3; break;
            case BACK_LIT: I = 0.36 + 0.22 * (0.5 + 0.5 * Math.sin(t * 0.8 + phase[i])); ci = 1; kind = 1; break;
            case WALL: I = 0.42 + 0.3 * wave; kind = hsh < 0.8 ? 1 : 0; break;
            case ROOF: I = 0.55 + 0.38 * wave; kind = hsh < 0.6 ? 2 : 1; break;
            case LIT: I = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(t * 1.3 + phase[i])); ci = 1; kind = 1; break;
            case DARK: I = 0.04; kind = 1; break;
            case GROUND: I = 0.12 + 0.18 * wave; kind = hsh < 0.5 ? 1 : 0; break;
            case TREE: I = 0.3 + 0.34 * wave; kind = 0; break;
            default: continue;
          }
          I *= reveal;
          if (I < 0.035) continue;
          const lvl = Math.min(LEVELS - 1, Math.floor(I * LEVELS));
          bctx.drawImage(atlas, lvl * cellPx, (ci * 4 + kind) * cellPx, cellPx, cellPx, Math.round(x * step), sy0, cellPx, cellPx);
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (o.glow > 0) {
        gctx.clearRect(0, 0, glowC.width, glowC.height);
        gctx.filter = 'blur(2px)';
        gctx.drawImage(buf, 0, 0, glowC.width, glowC.height);
        gctx.filter = 'none';
        ctx.globalAlpha = o.glow;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(glowC, 0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(buf, 0, 0);
    }

    function loop(now) {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / o.fps) return;
      last = now;
      draw(now);
    }

    let ro = null;
    function start() {
      if (running) return;
      resize();
      t0 = t0 || performance.now();
      introStart = performance.now();
      if (reduce()) { draw(performance.now()); return; }
      running = true; last = 0;
      raf = requestAnimationFrame(loop);
    }
    function stop() { running = false; cancelAnimationFrame(raf); }

    if (window.ResizeObserver) {
      let to = 0;
      ro = new ResizeObserver(() => { clearTimeout(to); to = setTimeout(resize, 80); });
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }
    return { start, stop, resize, frame: () => draw(performance.now()) };
  }

  /* ---------- WebGL2 renderer (GPU, used when available) ---------- */
  const hex3 = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const VS = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;
  const FS = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform vec2 uGrid;
uniform float uDpr, uCell, uTime, uIntro, uBright, uContrast, uF, uFade, uGlow, uDot;
uniform vec3 uColor, uGold; uniform sampler2D uTex;
out vec4 outColor;
float hash(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r; p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 cell = floor(p / uCell);
  if (cell.x >= uGrid.x || cell.y >= uGrid.y) { outColor = vec4(0.0); return; }
  vec2 lc = (p - cell * uCell) / uCell - 0.5;
  vec4 tx = texelFetch(uTex, ivec2(cell), 0);
  int k = int(tx.r * 255.0 + 0.5);
  float ph = tx.g * 6.2831853;
  vec2 c = (cell + 0.5) * uCell;
  vec2 cm = vec2(uRes.x / uDpr * 0.5, uRes.y / uDpr * 0.42);
  float v = sin(c.x * uF + uTime * 0.9) + sin(c.y * uF * 1.3 - uTime * 0.7)
          + sin((c.x + c.y) * uF * 0.7 + uTime * 0.5) + sin(length(c - cm) * uF * 0.9 - uTime * 1.2);
  float wave = clamp(v / 8.0 * uContrast * 1.7 + 0.5, 0.0, 1.0);
  float h = hash(cell);
  float I = 0.0; int kind = 0; float gold = 0.0;
  if (k == 0) {
    float sf = clamp(cell.y / max(1.0, uGrid.y * uFade * 2.6), 0.0, 1.0);
    I = uBright * wave * wave * wave * 0.9 * sf;
    kind = h < 0.45 ? 0 : (h < 0.7 ? 1 : (h < 0.88 ? 2 : 3));
  }
  else if (k == 9) { I = 0.6 + 0.25 * wave; kind = 0; }
  else if (k == 1) { I = 0.15 + 0.18 * wave; kind = h < 0.7 ? 1 : 3; }
  else if (k == 2) { I = 0.36 + 0.22 * (0.5 + 0.5 * sin(uTime * 0.8 + ph)); gold = 1.0; kind = 1; }
  else if (k == 3) { I = 0.42 + 0.3 * wave; kind = h < 0.8 ? 1 : 0; }
  else if (k == 6) { I = 0.55 + 0.38 * wave; kind = h < 0.6 ? 2 : 1; }
  else if (k == 4) { I = 0.72 + 0.28 * (0.5 + 0.5 * sin(uTime * 1.3 + ph)); gold = 1.0; kind = 1; }
  else if (k == 5) { I = 0.04; kind = 1; }
  else if (k == 7) { I = 0.12 + 0.18 * wave; kind = h < 0.5 ? 1 : 0; }
  else if (k == 8) { I = 0.3 + 0.34 * wave; kind = 0; }
  float fromBottom = 1.0 - cell.y / uGrid.y;
  float reveal = uIntro >= 1.0 ? 1.0 : clamp((uIntro * 1.25 - fromBottom) / 0.18, 0.0, 1.0);
  I *= reveal;
  if (I < 0.035) { outColor = vec4(0.0); return; }
  float hh = min(0.94, (0.2 + 0.8 * I) * uDot * 2.0) * 0.5;
  float d;
  if (kind == 0) d = length(lc) - hh;
  else if (kind == 1) { vec2 q = abs(lc) - hh; d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
  else if (kind == 2) d = sdTri(vec2(lc.x, -lc.y - hh * 0.12), hh);
  else d = (abs(lc.x) + abs(lc.y) - hh) * 0.7071;
  float aa = 1.0 / (uCell * uDpr);
  float a = (0.06 + 0.94 * I) * (1.0 - smoothstep(-aa, aa, d));
  float g = uGlow * I * exp(-max(d, 0.0) * 9.0) * 0.55 * step(0.0, d);
  float A = clamp(a + g, 0.0, 1.0);
  vec3 col = mix(uColor, uGold, gold);
  outColor = vec4(col * A, A);
}`;

  function createGL(canvas, gl, o) {
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    for (const n of ['uRes', 'uGrid', 'uDpr', 'uCell', 'uTime', 'uIntro', 'uBright', 'uContrast', 'uF', 'uFade', 'uGlow', 'uDot', 'uColor', 'uGold', 'uTex']) U[n] = gl.getUniformLocation(prog, n);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
    gl.uniform1i(U.uTex, 0);
    gl.uniform3fv(U.uColor, hex3(o.color)); gl.uniform3fv(U.uGold, hex3(o.windowColor));
    gl.uniform1f(U.uBright, o.brightness); gl.uniform1f(U.uContrast, o.contrast);
    gl.uniform1f(U.uF, o.scale * 0.055); gl.uniform1f(U.uFade, o.fade);
    gl.uniform1f(U.uGlow, o.glow); gl.uniform1f(U.uDot, o.dotSize); gl.uniform1f(U.uCell, o.cellSize);
    gl.clearColor(0, 0, 0, 0);

    let W = 0, H = 0, dpr = 1, cols = 0, rows = 0, ready = false;
    let raf = 0, running = false, t0 = 0, introStart = 0, last = 0;
    const reduce = () => document.body.classList.contains('no-anim') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      cols = Math.ceil(W / o.cellSize); rows = Math.ceil(H / o.cellSize);
      const { type, phase } = buildTown(cols, rows);
      const data = new Uint8Array(cols * rows * 4);
      for (let i = 0; i < type.length; i++) { data[i * 4] = type[i]; data[i * 4 + 1] = Math.round((phase[i] / (Math.PI * 2)) * 255) & 255; data[i * 4 + 3] = 255; }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform2f(U.uGrid, cols, rows);
      gl.uniform1f(U.uDpr, canvas.width / W);
      ready = true;
      if (!running) draw(performance.now());
    }
    function draw(now) {
      if (!ready) return;
      const introP = o.intro && !reduce() ? clamp((now - introStart) / (o.introDuration * 1000)) : 1;
      gl.uniform1f(U.uTime, ((now - t0) / 1000) * o.speed);
      gl.uniform1f(U.uIntro, introP >= 1 ? 1 : 1 - Math.pow(1 - introP, 3));
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function loop(now) {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / o.fps) return;
      last = now;
      draw(now);
    }
    function start() {
      if (running) return;
      t0 = t0 || performance.now();
      introStart = performance.now();
      resize();
      if (reduce()) return;
      running = true; last = 0;
      raf = requestAnimationFrame(loop);
    }
    function stop() { running = false; cancelAnimationFrame(raf); }
    if (window.ResizeObserver) {
      let to = 0;
      new ResizeObserver(() => { clearTimeout(to); to = setTimeout(() => { if (canvas.getBoundingClientRect().width) resize(); }, 80); }).observe(canvas);
    }
    return { start, stop, resize, frame: () => { draw(performance.now()); gl.finish(); }, mode: 'webgl2' };
  }

  function create(canvas, opts = {}) {
    const o = { ...OPTS, ...opts };
    let gl = null;
    try { gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' }); } catch {}
    if (gl) {
      try { return createGL(canvas, gl, o); }
      catch (e) { console.warn('ShapeWaves WebGL failed', e); return { start() {}, stop() {}, resize() {}, frame() {}, mode: 'none' }; }
    }
    return create2D(canvas, o);
  }

  window.LRXShapeWaves = { create };
})();
