/* LRX · Şirket stok sayfası okuyucu
   Torn'un "Current Shipments Due / Delivered" listesindeki "Delivered in HH:MM:SS" sayaçlarını okur.
   Electron ana süreci bunu `(...)(ürünAdları)` şeklinde çağırır ve sonucu yerel sunucuya verir.
   Dönüş: [{ name, amount, secs }] · sevkiyat yoksa [] · sayfada liste bulunamazsa null. */
(async (names) => {
  if (!Array.isArray(names) || !names.length || window.__lrxStockBusy) return null;
  window.__lrxStockBusy = true;
  try {
    const TIMER = /Delivered\s+in\s*:?\s*(?:(\d+)\s*(?:d|days?)[\s,]*)?(\d{1,3}):(\d{2}):(\d{2})/i;
    const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matchers = names.map((n) => [n, new RegExp(`(^|[^a-z])${escRe(n.toLowerCase())}([^a-z]|$)`)]);
    // Satırı tam olarak bir ürün adı içeren en yakın üst öğe belirler
    const productIn = (text) => {
      const t = text.toLowerCase();
      const hits = matchers.filter(([, re]) => re.test(t));
      return hits.length === 1 ? hits[0][0] : null;
    };
    const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();

    const read = () => {
      const rows = [];
      const used = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!/Delivered\s+in/i.test(n.nodeValue)) continue;
        let el = n.parentElement;
        for (let depth = 0; el && depth < 8; depth++, el = el.parentElement) {
          const text = textOf(el);
          const m = text.match(TIMER);
          const name = m && productIn(text);
          if (!name) continue;
          if (!used.has(el)) {
            used.add(el);
            const secs = (+m[1] || 0) * 86400 + +m[2] * 3600 + +m[3] * 60 + +m[4];
            const qty = text.replace(m[0], ' ').match(/\d{1,3}(?:,\d{3})+|\d+/);
            rows.push({ name, amount: qty ? Number(qty[0].replace(/,/g, '')) : 0, secs });
          }
          break;
        }
      }
      return rows;
    };

    const started = Date.now();
    while (Date.now() - started < 20000) {
      const rows = read();
      if (rows.length) return rows;
      // Liste başlığı göründüyse ve sayaç yoksa: yolda sevkiyat yok
      if (Date.now() - started > 3000 && /Current\s+Shipments/i.test(document.body.innerText || '')) return [];
      await new Promise((r) => setTimeout(r, 700));
    }
    return null;
  } finally {
    window.__lrxStockBusy = false;
  }
})
