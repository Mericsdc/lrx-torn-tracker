/* LRX Yumurta Bulucu — Easter Egg Hunt (tüm torn.com sayfaları)
   • Baktığın sayfada yumurta varsa onu ekranın ortasına büyütüp kırmızı çerçeveyle gösterir ve üstte kısa bir şerit çıkarır
   • Sahte / gizli yumurtalara (hidden-egg) dokunmaz: onlara tıklamak sonraki yumurta şansını düşürür
   Torn kuralları: yalnızca görünür ve odaktaki sayfada çalışır (arka plan sekmesinden uyarı vermez),
   Torn'a istek atmaz ve asla tıklamaz — yumurtayı toplamak için tıklamak oyuncuya kalır. */
(() => {
  if (window.__lrxEgg) return;
  window.__lrxEgg = true;
  const L = (t, e) => (window.__lrxLang === 'tr' ? t : e);

  const style = document.createElement('style');
  style.id = 'lrx-egg-css';
  style.textContent = `
    .lrx-egg-found { position: fixed !important; top: 40% !important; left: 40% !important; width: 20vw !important; height: 20vw !important;
      max-width: 220px !important; max-height: 220px !important; z-index: 2147483000 !important; border: 5px solid #e53935 !important;
      border-radius: 12px !important; background-color: rgba(255,255,255,.85) !important; opacity: 1 !important; visibility: visible !important;
      transform: none !important; box-shadow: 0 0 0 9999px rgba(0,0,0,.35) !important; }
    .lrx-egg-found img, .lrx-egg-found svg { width: 100% !important; height: 100% !important; object-fit: contain !important; }
    #lrx-egg-banner { position: fixed; top: 0; left: 50%; transform: translateX(-50%); z-index: 2147483001; padding: 6px 16px;
      border-radius: 0 0 10px 10px; background: #e53935; color: #fff; font: 700 13px/1.4 Arial, sans-serif; box-shadow: 0 3px 12px rgba(0,0,0,.35); }`;
  document.head.appendChild(style);

  const viewing = () => document.visibilityState === 'visible' && document.hasFocus();
  const isDecoy = (el) => /hidden-egg/i.test(`${el.className || ''} ${el.parentElement?.className || ''}`);

  let shown = false;
  const check = () => {
    if (!viewing()) return;
    const root = document.getElementById('easter-egg-hunt-root');
    if (!root) return;
    const eggs = [...root.querySelectorAll('button')].filter((b) => !isDecoy(b));
    if (!eggs.length) { document.getElementById('lrx-egg-banner')?.remove(); return; }
    for (const b of eggs) b.classList.add('lrx-egg-found');
    if (!shown && !document.getElementById('lrx-egg-banner')) {
      const bar = document.createElement('div');
      bar.id = 'lrx-egg-banner';
      bar.textContent = L('🥚 LRX · Bu sayfada yumurta var! Ortadaki kırmızı çerçevede (toplamak için kendin tıkla)',
        "🥚 LRX · There's an egg on this page! It's in the red frame in the center (click it yourself to collect it)");
      document.body.appendChild(bar);
      shown = true;
      setTimeout(() => bar.remove(), 15000);
    }
  };

  // Yumurta sayfa yüklenince belirir: ilk 30 sn sık, sonra seyrek bak; sekme odağa gelince de bak
  let n = 0;
  const fast = setInterval(() => { check(); if (++n > 30) clearInterval(fast); }, 1000);
  setInterval(check, 5000);
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  check();
})();
