/* LRX Trick or Treat Yardımcısı — shops.php?step=candy (Sally's Sweet Shop)
   • Yalnızca Trick or Treat penceresinde yüklenir (tarih Torn takviminden, her yıl API'den)
   • Şeker toplamak için gereken Halloween Basket'i turuncu çerçeveyle işaretler, üstte kısa not gösterir
   • Sepetin varsa (Torn API: user/competition) bunu söyler
   Yalnızca açık sayfayı boyar: Torn'a istek atmaz, hiçbir şeye tıklamaz, satın almaz, satırları gizlemez. */
(() => {
  if (window.__lrxHw) return;
  window.__lrxHw = true;
  const L = (t, e) => (window.__lrxLang === 'tr' ? t : e);
  const info = window.__lrxHalloween || {};

  const style = document.createElement('style');
  style.id = 'lrx-hw-css';
  style.textContent = `
    .lrx-hw-item { outline: 2px solid #f07a1a !important; outline-offset: 2px; border-radius: 6px; }
    .lrx-hw-tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 8px; font-size: 11px; line-height: 16px;
      font-weight: 700; white-space: nowrap; vertical-align: middle; background: rgba(240,122,26,.18); color: #e0731a; }
    #lrx-hw { margin: 8px 0; padding: 8px 12px; border-radius: 6px; font-size: 12.5px; line-height: 1.45;
      background: rgba(240,122,26,.12); border-left: 3px solid #f07a1a; color: inherit; }
    #lrx-hw.ok { background: rgba(63,165,42,.12); border-left-color: #3fa52a; }
    #lrx-hw small { opacity: .75; }`;
  document.head.appendChild(style);

  const note = () => {
    const foot = L('LRX · bilgi amaçlı, hiçbir şeye tıklamaz', 'LRX · for info only, never clicks anything');
    if (info.hasBasket === true) {
      const name = info.basket ? `: ${esc(info.basket)}` : '';
      return { ok: true, html: L(`🎃 <b>Sepetin var${name}.</b> Şekerler saldırı kazandıkça düşer; ikinci sepet gerekmez.`,
        `🎃 <b>You have a basket${name}.</b> Treats drop as you win attacks; you don't need a second basket.`) + `<br><small>${foot}</small>` };
    }
    const lead = info.stage === 'prep' ? L('Sepetler satışta, etkinlik yakında başlıyor. ', 'Baskets are on sale; the event starts soon. ')
      : info.hasBasket === false ? L('Henüz sepetin yok. ', "You don't have a basket yet. ") : '';
    return { ok: false, html: L(`🎃 <b>Trick or Treat:</b> ${lead}Şeker (treat) toplamak için <b>Halloween Basket</b> gerekli ($35, seviye 5) — aşağıda turuncu çerçeveyle işaretli. Satın almayı sen yaparsın.<br>
      <small>Tükendiyse her 15 dakikada 1.000 adet gelir, sayfayı yenile · Günlük 100 eşyalık şehir limitini önce kullan, sonra sepeti al (sepet limitten sayılır) · Satın alamıyorsan zaten sepetin vardır: envanter ya da Display Cabinet<br>${foot}</small>`,
    `🎃 <b>Trick or Treat:</b> ${lead}You need a <b>Halloween Basket</b> to collect treats ($35, level 5). It's marked with an orange frame below. You make the purchase yourself.<br>
      <small>If it's sold out, 1,000 are restocked every 15 minutes; refresh the page · Use your daily 100-item city shop limit first, then buy the basket (it counts toward the limit) · If you can't buy one, you already have a basket: check your inventory or Display Cabinet<br>${foot}</small>`) };
  };
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // "Halloween Basket" yazan en küçük ürün kutusunu bul
  const findBasket = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/halloween basket/i.test(n.nodeValue) && !n.parentElement?.closest('#lrx-hw, .lrx-hw-tag') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const out = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n.parentElement);
    return out;
  };

  let queued = false;
  const scan = () => {
    queued = false;
    if (document.hidden) return;
    const names = findBasket();
    for (const el of names) {
      const box = el.closest('li') || el.closest('[class*="item"]') || el;
      box.classList.add('lrx-hw-item');
      if (!el.querySelector('.lrx-hw-tag') && !el.nextElementSibling?.classList?.contains('lrx-hw-tag')) {
        const tag = document.createElement('span');
        tag.className = 'lrx-hw-tag';
        tag.textContent = info.hasBasket === true ? L('sepetin var ✓', 'you have one ✓') : L('şeker için gerekli', 'needed for treats');
        el.insertAdjacentElement('afterend', tag);
      }
    }
    if (!document.getElementById('lrx-hw')) {
      const n = note();
      const div = document.createElement('div');
      div.id = 'lrx-hw';
      if (n.ok) div.className = 'ok';
      div.innerHTML = n.html;
      const anchor = document.querySelector('.content-title') || document.querySelector('.content-wrapper > *') || null;
      if (anchor) anchor.insertAdjacentElement('afterend', div);
      else { div.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;max-width:340px;background:#2b2015;color:#f4e3cf'; document.body.appendChild(div); }
    }
  };
  const queue = () => { if (!queued) { queued = true; setTimeout(scan, 250); } };
  new MutationObserver((muts) => {
    // kendi eklediğimiz düğümler yeniden taramayı tetiklemesin
    if (muts.every((m) => [...m.addedNodes].every((n) => n.nodeType === 1 && (n.id === 'lrx-hw' || n.classList?.contains('lrx-hw-tag'))))) return;
    queue();
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
