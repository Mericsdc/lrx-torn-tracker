/* LRX Jail Yardımcısı — jailview.php
   • Her mahkûmun yanında bust zorluk puanı: seviye × (kalan saat + 3)  (TornTools / BUSTR ile aynı topluluk formülü)
   • Puan rengine göre: yeşil kolay, sarı orta, turuncu zor, kırmızı çok zor · üstte küçük özet
   • İpucunda indirimsiz tahmini kefalet (100 × dakika × seviye)
   Yalnızca açık sayfayı okur ve boyar: Torn'a istek atmaz, hiçbir şeye tıklamaz, onay ekranını atlatmaz,
   satırları gizlemez ya da sıralamaz. Torn başarı oranını yayımlamaz; puan yalnızca karşılaştırma içindir. */
(() => {
  if (window.__lrxJail) return;
  window.__lrxJail = true;

  const style = document.createElement('style');
  style.id = 'lrx-jail-css';
  style.textContent = `
    .lrx-jail { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 8px; font-size: 11px; line-height: 16px;
      font-weight: 700; white-space: nowrap; vertical-align: middle; }
    .lrx-jail.k0 { background: rgba(63,165,42,.18); color: #3fa52a; }
    .lrx-jail.k1 { background: rgba(214,170,30,.2); color: #b8901a; }
    .lrx-jail.k2 { background: rgba(230,120,30,.2); color: #d9731a; }
    .lrx-jail.k3 { background: rgba(240,90,90,.18); color: #e05555; }
    .lrx-jail-sum { margin: 6px 0; padding: 6px 10px; border-radius: 6px; font-size: 12px; background: rgba(127,127,127,.12); }
    .lrx-jail-sum b { margin-right: 10px; }`;
  document.head.appendChild(style);

  const BANDS = [[100, 'kolay'], [250, 'orta'], [460, 'zor'], [Infinity, 'çok zor']];
  const band = (score) => BANDS.findIndex(([max]) => score < max);

  // "1d 2h 30m", "2h 5m", "45m" → saat
  const hoursOf = (text) => {
    const t = (text || '').toLowerCase();
    const n = (re) => Number((t.match(re) || [])[1]) || 0;
    return n(/(\d+)\s*d/) * 24 + n(/(\d+)\s*h/) + n(/(\d+)\s*m(?!s)/) / 60;
  };
  const num = (text) => Number(((text || '').match(/(\d[\d,]*)/) || [])[1]?.replace(/,/g, '')) || 0;
  const money = (v) => '$' + Math.round(v).toLocaleString('en-US');

  let queued = false;
  const scan = () => {
    queued = false;
    if (document.hidden) return;
    const list = document.querySelector('ul.user-info-list-wrap') || document.querySelector('.users-list');
    if (!list) return;
    const counts = [0, 0, 0, 0];
    for (const li of list.children) {
      if (li.tagName !== 'LI' || li.classList.contains('last')) continue;
      const timeEl = li.querySelector('.time'); const levelEl = li.querySelector('.level');
      if (!timeEl || !levelEl) continue;
      const h = hoursOf(timeEl.textContent.replace(/time:?/i, ''));
      const lvl = num(levelEl.textContent);
      if (!lvl) continue;
      const score = Math.round(lvl * (h + 3));
      const k = band(score);
      counts[k]++;
      const host = li.querySelector('.reason') || li.querySelector('.info-wrap') || levelEl;
      let b = li.querySelector('.lrx-jail');
      if (!b) { b = document.createElement('span'); host.after(b); }
      const text = `${score}`;
      if (b.textContent !== text) b.textContent = text;
      const cls = `lrx-jail k${k}`;
      if (b.className !== cls) b.className = cls;
      b.title = `LRX · Bust zorluğu ${score} (${BANDS[k][1]}) = seviye ${lvl} × (${h.toFixed(1)} saat + 3). Düşük puan daha kolay.`
        + ` Tahmini kefalet (indirimsiz) ~${money(100 * h * 60 * lvl)}. Topluluk formülü; Torn resmî oran yayımlamaz.`;
    }
    let sum = document.querySelector('.lrx-jail-sum');
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) { sum?.remove(); return; }
    if (!sum) {
      sum = document.createElement('div');
      sum.className = 'lrx-jail-sum';
      (document.querySelector('.users-list-title') || list).before(sum);
    }
    const key = counts.join(',');
    if (sum.dataset.k !== key) {
      sum.dataset.k = key;
      sum.innerHTML = `<b>LRX · bust zorluğu</b>`
        + ['k0', 'k1', 'k2', 'k3'].map((c, i) => `<span class="lrx-jail ${c}">${BANDS[i][1]}: ${counts[i]}</span>`).join('');
    }
  };
  const queue = () => { if (!queued) { queued = true; setTimeout(scan, 120); } };

  // Kendi eklediğimiz düğümler gözlemciyi yeniden tetiklemesin
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && !n.closest('.lrx-jail, .lrx-jail-sum')) return queue();
    }
  }).observe(document.body, { childList: true, subtree: true });
  setInterval(queue, 5000); // kalan süreler azaldıkça puanlar güncellensin
  window.addEventListener('hashchange', queue);
  document.addEventListener('visibilitychange', queue);
  queue();
})();
