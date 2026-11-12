'use strict';
// LRX Flex: an endless row of player cards drawn on a 2D canvas, then bent by a WebGL lens shader.
// Cards inside the central lens stay flat; outside it the row curls (left end down, right end up),
// shrinks, compresses and splits colour slightly at the bend. Own implementation, no libraries.
(function () {
  const VERT = 'attribute vec2 p;varying vec2 v;void main(){v=p*0.5+0.5;gl_Position=vec4(p,0.0,1.0);}';
  const FRAG = [
    'precision highp float;',
    'varying vec2 v;',
    'uniform sampler2D tex;',
    'uniform float k, lens, bend, reach, disp, squeeze, comp;',
    'float bendAmt(float x){return clamp(max(abs(x-0.5)-lens,0.0)/max(0.5-lens,0.001),0.0,1.0);}',
    'float warpX(float x){float d=x-0.5;float a=abs(d);float o=max(a-lens,0.0);return 0.5+sign(d)*(a+comp*o*o/max(0.5-lens,0.001));}',
    'vec4 pick(vec2 uv,float shift){',
    '  float o=bendAmt(uv.x);',
    '  float sx=warpX(uv.x)+shift*o*(1.0-o)*4.0;',
    '  float s=max(1.0-reach*o*o-squeeze,0.25);',
    '  float lift=sign(uv.x-0.5)*bend*o*o;',
    '  float sy=0.5+(uv.y-0.5-lift)/s;',
    '  vec2 st=vec2((sx+(k-1.0)*0.5)/k,sy);',
    '  if(st.x<0.0||st.x>1.0||st.y<0.0||st.y>1.0)return vec4(0.0);',
    '  return texture2D(tex,st);',
    '}',
    'void main(){',
    '  float o=bendAmt(v.x);',
    '  float sh=disp*0.0045;',
    '  vec4 c=pick(v,0.0);vec4 r=pick(v,sh);vec4 b=pick(v,-sh);',
    '  vec4 col=vec4(r.r,c.g,b.b,max(c.a,max(r.a,b.a)));',
    '  col*=1.0-smoothstep(0.70,1.0,o);',
    '  col.rgb*=1.0-0.38*o;',
    '  gl_FragColor=col;',
    '}',
  ].join('\n');

  // Torn profile pictures are 400x550; cards keep that shape with three text lines below.
  const PORTRAIT = 550 / 400, RATIO = 0.045 + 0.91 * PORTRAIT + 0.33;
  const OPTS = { bend: 0.30, reach: 0.40, disp: 0.45, squeeze: 0.18, comp: 1.35, autoplay: 3800, maxDpr: 1.75 };

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  }

  function create({ stage, canvas, people, onChange, fonts }) {
    const o = { ...OPTS };
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl || !people.length) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const U = {}; for (const n of ['k', 'lens', 'bend', 'reach', 'disp', 'squeeze', 'comp']) U[n] = gl.getUniformLocation(prog, n);
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;

    const strip = document.createElement('canvas');
    const ctx = strip.getContext('2d');
    const N = people.length;
    for (const p of people) {
      if (!p.src) continue;
      p.img = new Image(); p.img.decoding = 'async';
      p.img.onload = () => { p.ready = true; dirty = true; wake(); };
      p.img.src = p.src;
    }

    let W = 0, H = 0, dpr = 1, k = 1.8, lens = 0.2, cw = 200, ch = 280, gap = 30, spacing = 230, reps = 2;
    let offset = 0, target = 0, vel = 0, prevOffset = 0, dirty = true, raf = 0, visible = true, hover = false, dragging = false;
    let current = -1, timer = 0, lost = false;

    function layout() {
      const r = stage.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr);
      ch = Math.round(Math.min(H * 0.8, W * 0.46 * RATIO)); cw = Math.round(ch / RATIO); gap = Math.round(cw * 0.12); spacing = cw + gap;
      const narrow = Math.min(W / 1000, 1);
      lens = Math.min(0.26, Math.max(0.1, (cw * (0.46 + 0.1 * narrow)) / W));
      o.bend = OPTS.bend * (0.4 + 0.6 * narrow); o.reach = OPTS.reach * (0.6 + 0.4 * narrow); o.comp = OPTS.comp * (0.7 + 0.3 * narrow);
      k = 1 + 2 * o.comp * (0.5 - lens) + 0.06;
      let sw = Math.round(W * k * dpr);
      if (sw > maxTex) { dpr *= maxTex / sw; sw = Math.round(W * k * dpr); }
      strip.width = sw; strip.height = Math.round(H * dpr);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      reps = Math.max(1, Math.ceil((W * k + 2 * spacing) / (N * spacing)));
      const snapped = Math.round(offset / spacing);
      offset = target = snapped * spacing;
      dirty = true;
    }

    function card(person, x, y, focus) {
      const r = cw * 0.075, pad = cw * 0.045, img = cw - pad * 2, imgH = img * PORTRAIT;
      ctx.save();
      if (focus) { ctx.shadowColor = 'rgba(201,169,106,0.55)'; ctx.shadowBlur = cw * 0.16; }
      else { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = cw * 0.1; ctx.shadowOffsetY = cw * 0.04; }
      rr(ctx, x, y, cw, ch, r);
      const g = ctx.createLinearGradient(x, y, x + cw * 0.3, y + ch);
      g.addColorStop(0, '#1d1e22'); g.addColorStop(1, '#08090b');
      ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      // portrait
      ctx.save();
      rr(ctx, x + pad, y + pad, img, imgH, r * 0.7); ctx.clip();
      if (person.ready) {
        const iw = person.img.naturalWidth, ih = person.img.naturalHeight, s = Math.max(img / iw, imgH / ih);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(person.img, x + pad + (img - iw * s) / 2, y + pad + (imgH - ih * s) / 2, iw * s, ih * s);
      } else {
        const m = ctx.createRadialGradient(x + pad + img * 0.3, y + pad + imgH * 0.2, 0, x + pad + img / 2, y + pad + imgH / 2, imgH * 0.8);
        m.addColorStop(0, '#2c271f'); m.addColorStop(1, '#0b0b0c');
        ctx.fillStyle = m; ctx.fillRect(x + pad, y + pad, img, imgH);
        ctx.fillStyle = 'rgba(227,204,151,0.85)'; ctx.font = `700 ${Math.round(img * 0.26)}px ${fonts.sans}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(person.initials, x + cw / 2, y + pad + imgH / 2);
      }
      const fadeG = ctx.createLinearGradient(0, y + pad + imgH * 0.72, 0, y + pad + imgH);
      fadeG.addColorStop(0, 'rgba(8,9,11,0)'); fadeG.addColorStop(1, 'rgba(8,9,11,0.55)');
      ctx.fillStyle = fadeG; ctx.fillRect(x + pad, y + pad, img, imgH);
      ctx.restore();
      // text
      const tx = x + cw / 2; let ty = y + pad + imgH + cw * 0.115;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#eef1f3'; ctx.font = `650 ${Math.round(cw * 0.083)}px ${fonts.sans}`;
      ctx.fillText(person.name, tx, ty, cw - pad * 2);
      ty += cw * 0.075;
      ctx.fillStyle = '#e3cc97'; ctx.font = `500 ${Math.round(cw * 0.056)}px ${fonts.mono}`;
      ctx.fillText(`[${person.id}]`, tx, ty);
      ty += cw * 0.07;
      ctx.fillStyle = '#9aa3ab'; ctx.font = `500 ${Math.round(cw * 0.05)}px ${fonts.sans}`;
      ctx.fillText(person.role, tx, ty, cw - pad * 2);
      // edge: gold to silver hairline, brighter on the focused card
      rr(ctx, x + 0.75, y + 0.75, cw - 1.5, ch - 1.5, r);
      const e = ctx.createLinearGradient(x, y, x + cw, y + ch);
      e.addColorStop(0, focus ? 'rgba(227,204,151,0.95)' : 'rgba(227,204,151,0.45)');
      e.addColorStop(0.4, 'rgba(255,255,255,0.05)'); e.addColorStop(0.7, 'rgba(255,255,255,0.03)');
      e.addColorStop(1, focus ? 'rgba(214,220,227,0.7)' : 'rgba(214,220,227,0.28)');
      ctx.strokeStyle = e; ctx.lineWidth = focus ? 1.6 : 1.1; ctx.stroke();
    }

    function drawStrip() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, strip.width, strip.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sw = W * k, total = N * reps * spacing, origin = sw / 2, top = (H - ch) / 2;
      const focusIdx = Math.round(offset / spacing);
      for (let i = 0; i < N * reps; i++) {
        let p = ((i * spacing - offset) % total + total) % total;
        if (p > total / 2) p -= total;
        if (Math.abs(p) > sw / 2 + cw) continue;
        const absolute = Math.round((offset + p) / spacing);
        card(people[((i % N) + N) % N], origin + p - cw / 2, top, absolute === focusIdx);
      }
    }

    function render() {
      if (lost) return;
      const speed = Math.abs(offset - prevOffset); prevOffset = offset;
      drawStrip();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, strip);
      gl.uniform1f(U.k, k); gl.uniform1f(U.lens, lens); gl.uniform1f(U.bend, o.bend); gl.uniform1f(U.reach, o.reach);
      gl.uniform1f(U.disp, o.disp); gl.uniform1f(U.comp, o.comp);
      gl.uniform1f(U.squeeze, o.squeeze * Math.min(speed / 40, 1));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const idx = ((Math.round(offset / spacing) % N) + N) % N;
      if (idx !== current) { current = idx; onChange?.(idx); }
    }

    function step() {
      raf = 0;
      if (!visible || lost) return;
      let moving = false;
      if (!dragging) {
        if (Math.abs(vel) > 0.35) { offset += vel; vel *= 0.9; moving = true; if (Math.abs(vel) <= 0.35) target = Math.round(offset / spacing) * spacing; }
        else if (Math.abs(target - offset) > 0.25) { offset += (target - offset) * 0.11; moving = true; }
        else if (offset !== target) { offset = target; moving = true; }
      }
      if (moving || dirty || Math.abs(offset - prevOffset) > 0.01) { dirty = false; render(); }
      if (moving || dragging || Math.abs(offset - prevOffset) > 0.01) raf = requestAnimationFrame(step);
    }
    function wake() { if (!raf && visible) raf = requestAnimationFrame(step); }

    function go(cardIndex) { vel = 0; target = cardIndex * spacing; wake(); schedule(); }
    function shiftBy(n) { go(Math.round(target / spacing) + n); }
    function schedule() {
      clearTimeout(timer);
      if (!o.autoplay) return;
      timer = setTimeout(() => { if (!hover && !dragging && visible && !document.hidden) shiftBy(1); else schedule(); }, o.autoplay);
    }

    // inverse of the shader's horizontal warp, to find the card under the pointer
    function sourceX(x) { const d = x - 0.5, a = Math.abs(d), q = Math.max(a - lens, 0); return 0.5 + Math.sign(d) * (a + o.comp * q * q / Math.max(0.5 - lens, 0.001)); }
    function cardAt(clientX) {
      const r = stage.getBoundingClientRect();
      const sx = sourceX((clientX - r.left) / W) * W - W / 2 + offset;
      const idx = Math.round(sx / spacing);
      return Math.abs(sx - idx * spacing) <= cw / 2 ? idx : null;
    }

    let downX = 0, lastX = 0, lastT = 0, moved = 0, pid = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      pid = e.pointerId; stage.setPointerCapture(pid);
      dragging = true; stage.classList.add('dragging'); downX = lastX = e.clientX; lastT = performance.now(); moved = 0; vel = 0;
      clearTimeout(timer); wake();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pid) return;
      const dx = e.clientX - lastX, now = performance.now();
      offset -= dx; moved += Math.abs(dx);
      const dt = Math.max(now - lastT, 1); vel = (-dx / dt) * 16;
      lastX = e.clientX; lastT = now; wake();
    });
    const end = (e) => {
      if (!dragging || e.pointerId !== pid) return;
      dragging = false; stage.classList.remove('dragging');
      try { stage.releasePointerCapture(pid); } catch {}
      if (moved < 6) { const c = cardAt(downX); vel = 0; if (c !== null) go(c); else target = Math.round(offset / spacing) * spacing; }
      else if (performance.now() - lastT > 80) { vel = 0; target = Math.round(offset / spacing) * spacing; }
      else vel = Math.max(-36, Math.min(36, vel));
      wake(); schedule();
    };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    stage.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical wheel keeps scrolling the page
      e.preventDefault(); offset += e.deltaX; vel = 0; target = Math.round(offset / spacing) * spacing; wake(); schedule();
    }, { passive: false });
    stage.addEventListener('pointerenter', () => { hover = true; });
    stage.addEventListener('pointerleave', () => { hover = false; });

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; api.onLost?.(); });
    if (window.ResizeObserver) new ResizeObserver(() => { layout(); wake(); }).observe(stage);
    else window.addEventListener('resize', () => { layout(); wake(); });
    if (window.IntersectionObserver) new IntersectionObserver((en) => { visible = en[0].isIntersecting; if (visible) { dirty = true; wake(); schedule(); } }, { rootMargin: '80px' }).observe(stage);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { dirty = true; wake(); } });

    layout(); render(); schedule();
    const api = {
      next: () => shiftBy(1), prev: () => shiftBy(-1),
      setRoles(roles) { people.forEach((p, i) => { p.role = roles[i]; }); dirty = true; wake(); },
      redraw() { dirty = true; wake(); },
      onLost: null,
    };
    return api;
  }

  window.LRXFlex = { create };
})();
