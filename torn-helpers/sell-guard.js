/* LRX Alış Fiyatı Koruması — Item Market "Add listing" ve bazaar ekle / yönet sayfaları
   • Alış fiyatını bildiğin eşyanın satırında: "Alış $X · başa baş $Y"
   • Girdiğin fiyat başa başın altındaysa satır kırmızı uyarı verir ("adet başı −$Z zarar"), üstündeyse yeşil kâr gösterir
   • Başa baş = alış / (1 − komisyon): Item Market %5, bazaar %0
   Alış fiyatları uygulamadan gelir (window.__lrxCosts: eşya ID → fiyat; Torn log'u ya da Araçlar sayfasında elle girilen).
   Yalnızca açık sayfayı okur ve boyar: Torn'a istek atmaz, hiçbir şeye tıklamaz, ilanı engellemez ya da değiştirmez. */
(() => {
  if (window.__lrxSellGuard) return;
  window.__lrxSellGuard = true;
  const L = (t, e) => (window.__lrxLang === 'tr' ? t : e);

  const style = document.createElement('style');
  style.id = 'lrx-sell-css';
  style.textContent = `
    .lrx-sg { display: block; margin: 3px 0; padding: 2px 8px; border-radius: 6px; font-size: 11px; line-height: 16px; font-weight: 600;
      background: rgba(127,127,127,.14); color: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lrx-sg.ok { background: rgba(63,165,42,.16); color: #3fa52a; }
    .lrx-sg.loss { background: rgba(232,72,72,.18); color: #e04848; }
    [data-lrx-loss] input { box-shadow: 0 0 0 2px #e04848 !important; }`;
  document.head.appendChild(style);

  const money = (v) => (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
  const priceOf = (input) => {
    if (!input) return null;
    const v = Number(String(input.value || '').replace(/[^\d.]/g, ''));
    return v > 0 ? v : null;
  };
  const itemId = (row) => {
    const img = row.querySelector('img[src*="/images/items/"]');
    const m = img && (img.getAttribute('src') || '').match(/\/images\/items\/(\d+)\//);
    return m ? m[1] : null;
  };

  // Sayfaya göre satır, fiyat kutusu ve komisyon
  const contexts = () => {
    const h = location.hash.toLowerCase();
    const out = [];
    if (/sid=itemmarket/i.test(location.search) && h.includes('addlisting')) {
      const root = document.querySelector('#item-market-root') || document;
      for (const row of root.querySelectorAll('[class*="itemRowWrapper"]')) {
        const input = row.querySelector('input[aria-label$=" price" i], input[placeholder="Price"]');
        out.push({ row, input, host: input?.closest('[class*="priceInputWrapper"]') || input?.parentElement, fee: 0.05, where: 'Item Market' });
      }
    } else if (location.pathname.startsWith('/bazaar.php') && (h.startsWith('#/add') || h.startsWith('#/manage'))) {
      if (h.startsWith('#/add')) {
        const root = document.querySelector('#bazaarRoot') || document;
        for (const row of root.querySelectorAll('ul.items-cont > li')) {
          const input = row.querySelector('div.price input.input-money:not([type="hidden"])') || row.querySelector('div.price input');
          out.push({ row, input, host: row.querySelector('div.price') || input?.parentElement, fee: 0, where: 'bazaar' });
        }
      } else {
        for (const row of document.querySelectorAll('[data-testid="sortable-item"], [class*="row___"]')) {
          const wrap = row.querySelector('[class*="price___"]');
          const input = wrap?.querySelector('input:not([type="hidden"])') || wrap?.querySelector('input');
          out.push({ row, input, host: wrap, fee: 0, where: 'bazaar' });
        }
      }
    }
    return out;
  };

  let queued = false;
  const scan = () => {
    queued = false;
    if (document.hidden) return;
    const costs = window.__lrxCosts || {};
    for (const { row, input, host, fee, where } of contexts()) {
      const id = itemId(row);
      const cost = id ? Number(costs[id]) : 0;
      let tag = row.querySelector('.lrx-sg');
      if (!cost || !host) { tag?.remove(); row.removeAttribute('data-lrx-loss'); continue; }
      if (!tag) { tag = document.createElement('div'); tag.className = 'lrx-sg'; host.after(tag); }
      const be = Math.ceil(cost / (1 - fee));
      const price = priceOf(input);
      const pct = Math.round(fee * 100);
      let text = L(`LRX · alış ${money(cost)} · başa baş ${money(be)}${fee ? ` (${where} %${pct})` : ''}`,
        `LRX · bought at ${money(cost)} · break-even ${money(be)}${fee ? ` (${where} ${pct}% fee)` : ''}`);
      let cls = 'lrx-sg';
      if (price) {
        const net = price * (1 - fee) - cost;
        if (net < 0) {
          cls += ' loss';
          text = L(`⚠ LRX · alış fiyatının altında: adet başı ${money(net)} zarar · başa baş ${money(be)}`,
            `⚠ LRX · below your buy price: loss of ${money(-net)} per item · break-even ${money(be)}`);
        } else { cls += ' ok'; text = L(`LRX · adet başı ${money(net)} kâr · alış ${money(cost)}`, `LRX · ${money(net)} profit per item · bought at ${money(cost)}`); }
        if (net < 0) row.setAttribute('data-lrx-loss', ''); else row.removeAttribute('data-lrx-loss');
      } else row.removeAttribute('data-lrx-loss');
      if (tag.textContent !== text) tag.textContent = text;
      if (tag.className !== cls) tag.className = cls;
    }
  };
  const queue = () => { if (!queued) { queued = true; setTimeout(scan, 80); } };

  // Fiyat yazıldıkça güncelle (yalnızca okur)
  document.addEventListener('input', queue, true);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.target.nodeType === 1 && m.target.closest('.lrx-sg')) continue;
      for (const n of m.addedNodes) if (!(n.nodeType === 1 && n.classList.contains('lrx-sg'))) return queue();
    }
  }).observe(document.body, { childList: true, subtree: true });
  setInterval(queue, 2000);
  window.addEventListener('hashchange', queue);
  document.addEventListener('visibilitychange', queue);
  queue();
})();
