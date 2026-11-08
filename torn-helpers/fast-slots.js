/* LRX Hızlı Slot — Torn kumarhane slot makinesi (page.php?sid=slots)
   Makara animasyonunu atlar: bahis butonuna her basış = Torn'a TEK spin isteği, sonuç anında gösterilir.
   Otomatik çevirme yoktur; her istek kullanıcının bir tıklaması ya da tuşuyla gönderilir. */
(() => {
  if (window.__lrxFastSlots) return;
  window.__lrxFastSlots = true;

  const start = () => {
    const $ = window.jQuery;
    if (!$ || typeof window.getRFC !== 'function' || !document.querySelector('.betbtn')) return false;

    const BTN = '.betbtn';
    const SKIP_KEYS = 'input, textarea, select, button:not(.betbtn), a, [contenteditable], .btn-sound, .btn-pay-table';
    const $id = (id) => document.getElementById(id);
    const num = (t) => Number(String(t ?? '').replace(/[^\d.-]/g, '')) || 0;
    const fmt = (n) => (typeof window.toNumberFormat === 'function' ? window.toNumberFormat(n) : Number(n || 0).toLocaleString('en-US'));
    const imgName = (src) => String(src || '').match(/\/([^/]+)\.[^./]+$/)?.[1] || null;

    const S = {
      stake: 0,
      tokens: $id('tokens')?.textContent.trim() ? num($id('tokens').textContent) : null,
      money: $id('moneyAmount')?.textContent.trim() ? num($id('moneyAmount').textContent) : null,
      inFlight: false,
      nextAt: 0,
      delay: 500, // Torn'un spin kilidine göre kendini ayarlar
      spins: 0,
    };

    // Yalnızca orta sıradaki sembolleri göster (animasyonsuz sonuç)
    const style = document.createElement('style');
    style.id = 'lrx-fast-slots-css';
    style.textContent = `
      :is(.notblured, .blured):not(:is(#barrel0, #barrel1, #barrel2) > :nth-child(2) :is(.notblured, .blured)) { display: none !important; }
      .lrx-slots-badge { position: absolute; top: 6px; right: 8px; z-index: 5; padding: 2px 8px; border-radius: 10px;
        font: 600 10px/16px Arial, sans-serif; letter-spacing: .4px; color: #04110f; background: #2ee6c8; box-shadow: 0 0 8px #2ee6c866; pointer-events: none; }`;
    document.head.appendChild(style);
    const wrap = document.querySelector('.slots-main-wrap') || document.querySelector(BTN).closest('div');
    if (wrap) {
      if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
      const badge = document.createElement('div');
      badge.className = 'lrx-slots-badge';
      badge.textContent = '⚡ LRX HIZLI SLOT';
      wrap.appendChild(badge);
    }

    // Torn'un kendi slot istekleri (sayfa açılışı vb.) jeton/para bilgisini günceller
    $(document).ajaxSuccess((_e, xhr, settings) => {
      if (!String(settings?.url || '').includes('sid=slotsData')) return;
      try {
        const r = JSON.parse(xhr.responseText);
        if (r && !r.error) { S.tokens = r.tokens; S.money = r.money; }
      } catch {}
    });

    // Sesler (Torn'un buzz kütüphanesi; ses kapalıysa çalmaz)
    const sounds = {};
    const sound = (id) => {
      if (document.querySelector('li[class*=btn-sound]')?.getAttribute('aria-pressed') === 'false' || !window.buzz) return;
      const s = (sounds[id] ||= new window.buzz.sound(`/casino/slots/audio/${id}`, { formats: ['ogg', 'mp3'], preload: true, autoplay: false }));
      try { s.stop(); s.setVolume(25); s.play(); } catch {}
    };

    const showResult = (kind, message, srText) => {
      const box = $id('gameResult');
      if (box) {
        box.style.fontSize = kind === 'error' ? '16px' : '34px';
        box.innerHTML = '<span id="grv"></span><span id="grh"></span>';
        box.querySelector('#grv').textContent = message;
      }
      const sr = $id('gameResultSr');
      if (sr) sr.textContent = srText || message;
    };

    const refreshButtons = () => {
      document.querySelectorAll(BTN).forEach((b) => {
        const off = (S.tokens != null && S.tokens <= 0) || (S.money != null && Number(b.dataset.bet) > S.money);
        b.classList.toggle('disabled', off);
        b.setAttribute('aria-disabled', off ? 'true' : 'false');
      });
    };

    const applySpin = (stake, r) => {
      S.tokens = r.tokens;
      S.money = r.money;
      refreshButtons();
      if ($id('moneyAmount')) $id('moneyAmount').textContent = fmt(r.money);
      if ($id('tokens')) $id('tokens').textContent = r.tokens;
      if ($id('moneyWon')) $id('moneyWon').textContent = fmt(r.moneyWon);
      [0, 1, 2].forEach((i) => {
        const cell = document.querySelector(`#barrel${i} > :nth-child(2) .notblured`);
        const name = imgName(r.images?.[i]);
        if (!cell || !name) return;
        const old = cell.classList[2];
        if (old) cell.classList.replace(old, name); else cell.classList.add(name);
      });
      if (++S.spins % 5 === 0) S.delay = Math.max(500, S.delay - 10);
      if (r.comboTitle != null) {
        const rate = stake ? r.moneyWon / stake : 0;
        sound(`won${rate < 4 ? 1 : rate < 8 ? 2 : rate < 200 ? 3 : rate < 2000 ? 4 : 5}`);
        sound('cashout');
        showResult('win', r.comboTitle, `${r.comboTitle}. Won $${fmt(r.moneyWon)}. Money $${fmt(r.moneyTotal)}. Tokens left: ${r.tokens}.`);
      } else {
        sound('reelspinend0');
        showResult('lose', `JACKPOT: $${fmt(r.currentJackpot)}`, `No win. Money $${fmt(r.moneyTotal)}. Tokens left: ${r.tokens}.`);
      }
    };

    const spin = (stake) => {
      const now = performance.now();
      if (S.inFlight || now < S.nextAt) return; // tek seferde tek istek
      if (!stake) return showResult('error', 'PLEASE SELECT A STAKE!');
      if (S.tokens != null && S.tokens <= 0) return showResult('error', 'YOU HAVE ALREADY USED YOUR TOKENS FOR TODAY!');
      if (S.money != null && S.money < stake) return showResult('error', "YOU DON'T HAVE ENOUGH MONEY TO MAKE THIS STAKE!");
      S.inFlight = true;
      S.nextAt = now + S.delay;
      $.getJSON(`/page.php?rfcv=${window.getRFC()}&sid=slotsData&step=play&stake=${encodeURIComponent(stake)}`)
        .done((r) => {
          if (!r || r.error) {
            const msg = String(r?.error || 'Unknown error');
            if (/spin is already in/i.test(msg)) S.delay += 100;
            sound('clickstart');
            return showResult('error', msg);
          }
          applySpin(stake, r);
        })
        .fail(() => showResult('error', 'CONNECTION ERROR — TRY AGAIN'))
        .always(() => { S.inFlight = false; });
    };

    const pressed = (on) => document.querySelectorAll(`${BTN}[data-bet="${S.stake}"]`).forEach((b) => b.classList.toggle('pressed', on));
    const fromBtn = (e) => (e.button === 2 ? null : e.target.closest?.(BTN));

    // Torn'un yavaş (animasyonlu) bahis akışını tamamen devre dışı bırak
    const swallow = (e) => { if (fromBtn(e)) { e.preventDefault(); e.stopImmediatePropagation(); } };
    ['mousedown', 'mouseup', 'click', 'touchstart', 'touchend'].forEach((t) => window.addEventListener(t, swallow, { capture: true, passive: false }));

    window.addEventListener('pointerdown', (e) => {
      const btn = fromBtn(e);
      if (!btn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      S.stake = Number(btn.dataset.bet) || 0;
      btn.classList.add('pressed');
      spin(S.stake);
    }, true);
    window.addEventListener('pointerup', (e) => { const btn = fromBtn(e); if (btn) btn.classList.remove('pressed'); }, true);

    // Boşluk / Enter = son bahisle bir kez çevir (basılı tutmak tekrar etmez)
    const keyOk = (e) => (e.key === ' ' || e.key === 'Enter') && !e.target.closest?.(SKIP_KEYS);
    window.addEventListener('keydown', (e) => {
      if (!keyOk(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      pressed(true);
      spin(S.stake);
    }, true);
    window.addEventListener('keyup', (e) => { if (keyOk(e)) pressed(false); }, true);

    refreshButtons();
    return true;
  };

  // Sayfa betikleri (jQuery, getRFC, butonlar) hazır olana kadar kısa süre bekle
  let tries = 0;
  const boot = () => {
    if (start()) return;
    if (++tries < 60) setTimeout(boot, 250);
    else window.__lrxFastSlots = false;
  };
  boot();
})();
