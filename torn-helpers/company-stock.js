/* LRX · Şirket stok sayfası okuyucu (yalnızca okur, sayfada hiçbir şeye tıklamaz)
   Torn'un "Current Shipments Due / Delivered" listesindeki sayaçları ve stok tablosundaki
   "Delivery: 24 hours" teslim sürelerini okur.
   Torn'daki yapı: ".order-list-wrap ul.order-list > li" içinde ".name" | ".amount" | ".status"
   (".status" yolda olanlarda "23:56:06", gelmiş olanlarda "Delivered"). "Delivered in" yazısı
   yalnızca sütun başlığında bir kez geçer, satırlarda geçmez.
   Electron ana süreci bunu `(...)(ürünAdları)` şeklinde çağırır ve sonucu yerel sunucuya verir.
   Dönüş: { shipments: [{ name, amount, secs }], deliveryHours: { ürün: saat } }
          · yolda sevkiyat yoksa shipments: [] · sayfada liste bulunamazsa null. */
(async (names) => {
  if (!Array.isArray(names) || !names.length || window.__lrxStockBusy) return null;
  window.__lrxStockBusy = true;
  try {
    // "23:56:06", "1 day 02:00:00", "1d 02:00:00"
    const TIMER = /^(?:(\d+)\s*(?:d|days?)[\s,]*)?(\d{1,3}):(\d{2}):(\d{2})$/i;
    const textOf = (el) => (el ? (el.innerText || el.textContent || '') : '').replace(/\s+/g, ' ').trim();
    const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
    const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matchers = names.map((n) => [n, new RegExp(`(^|[^a-z])${escRe(n.toLowerCase())}([^a-z]|$)`)]);
    const productIn = (text) => {
      const t = text.toLowerCase();
      const hits = matchers.filter(([, re]) => re.test(t));
      return hits.length === 1 ? hits[0][0] : null;
    };
    const secsOf = (m) => (+m[1] || 0) * 86400 + +m[2] * 3600 + +m[3] * 60 + +m[4];
    const numOf = (s) => { const m = String(s).match(/\d{1,3}(?:,\d{3})+|\d+/); return m ? Number(m[0].replace(/,/g, '')) : 0; };

    // Sevkiyat listesinin kapsayıcısı: Torn'un sınıfı, yoksa "Current Shipments" başlığının üst öğesi
    const shipmentsRoot = () => {
      const wrap = document.querySelector('.order-list-wrap');
      if (wrap) return wrap;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!/Current\s+Shipments/i.test(n.nodeValue)) continue;
        let el = n.parentElement;
        for (let i = 0; el && i < 4; i++, el = el.parentElement) if (el.querySelectorAll('li').length > 1) return el;
      }
      return null;
    };

    const readShipments = (root) => {
      const rows = [];
      // 1) Torn'un satır yapısı
      for (const li of root.querySelectorAll('ul.order-list > li')) {
        const st = textOf(li.querySelector('.status'));
        const m = st.match(TIMER);
        if (!m) continue; // "Delivered" (gelmiş) satırlar
        const name = byLower.get(textOf(li.querySelector('.name')).toLowerCase());
        if (!name) continue;
        rows.push({ name, amount: numOf(textOf(li.querySelector('.amount'))), secs: secsOf(m) });
      }
      if (rows.length) return rows;
      // 2) Yedek: yalnızca sayaç içeren öğeden yukarı çıkıp tek bir ürün adı içeren satırı bul
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const used = new Set();
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const m = n.nodeValue.trim().match(TIMER);
        if (!m) continue;
        let el = n.parentElement;
        for (let i = 0; el && el !== root && i < 4; i++, el = el.parentElement) {
          const text = textOf(el);
          const name = productIn(text);
          if (!name) continue;
          if (!used.has(el)) {
            used.add(el);
            rows.push({ name, amount: numOf(text.replace(m[0], ' ').replace(name, ' ')), secs: secsOf(m) });
          }
          break;
        }
      }
      return rows;
    };

    // Stok tablosu: "Delivery: 24 hours" → ürün başına teslim süresi (saat)
    const readDeliveryHours = () => {
      const out = {};
      for (const el of document.querySelectorAll('.delivery')) {
        const hm = textOf(el).match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|days?|d)\b/i);
        if (!hm) continue;
        const hours = Number(hm[1]) * (/^d/i.test(hm[2]) ? 24 : 1);
        const row = el.closest('li, tr');
        const nameEl = row && row.querySelector('.name');
        const name = (nameEl && byLower.get((nameEl.getAttribute('title') || textOf(nameEl)).trim().toLowerCase()))
          || (row && productIn(textOf(row)));
        if (name && hours > 0) out[name] = hours;
      }
      return out;
    };

    // Torn'un sayaçları akmaz: listenin geldiği andaki kalan süreyi gösterir. Bu yüzden süreyi listenin
    // yüklendiği ana göre düzeltiriz (sayfa sonradan okunursa teslim zamanı kaymasın).
    // Yükleme anı: stok sekmesini getiren "companies.php?step=stock" isteğinin bitişi (yoksa sayfanın kendisi);
    // bulunamazsa ya da şüpheliyse listeyi ilk gördüğümüz an.
    const seen = (window.__lrxStockSeen ||= new WeakMap());
    const loadedAt = (root) => {
      const key = root.querySelector('ul.order-list > li') || root;
      if (!seen.has(key)) seen.set(key, Date.now());
      const firstSeen = seen.get(key);
      const t0 = performance.timeOrigin;
      const res = performance.getEntriesByType('resource');
      const ends = res.filter((e) => /companies\.php\?(.*&)?step=stock/i.test(e.name)).map((e) => t0 + e.responseEnd);
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav && /companies\.php/i.test(location.href)) ends.push(t0 + nav.responseEnd);
      const best = Math.max(0, ...ends.filter((t) => t <= firstSeen + 1000));
      // Kayıt tamponu (250) dolduysa yeni istekler kaydedilmez; en son kayıt eski olabilir → yalnızca yakınsa güven
      const bufferFull = res.length >= 250;
      return best && (!bufferFull || firstSeen - best < 60_000) ? best : firstSeen;
    };

    const started = Date.now();
    while (Date.now() - started < 20000) {
      const root = shipmentsRoot();
      if (root) {
        let shipments = readShipments(root);
        if (shipments.length) {
          // Sayaç akıyor mu? 1,3 sn sonra tekrar oku: değiştiyse ekrandaki değer zaten şimdiki kalan süredir;
          // değişmediyse sayaç sabittir ve listenin yüklendiği andan beri geçen süre düşülür.
          const anchor = loadedAt(root);
          await new Promise((r) => setTimeout(r, 1300));
          const again = readShipments(root);
          const ticking = again.length === shipments.length && again.some((s, i) => s.secs !== shipments[i].secs);
          if (ticking) shipments = again;
          else {
            const elapsed = (Date.now() - anchor) / 1000;
            shipments = shipments.map((s) => ({ ...s, secs: Math.round(s.secs - elapsed) }));
          }
        }
        // Liste dolduysa sonucu ver; satırlar var ama sayaç yoksa yolda sevkiyat yok demektir
        const listed = root.querySelector('ul.order-list > li') || (Date.now() - started > 8000 && root.querySelector('li'));
        if (shipments.length || (Date.now() - started > 1500 && listed)) {
          return { shipments, deliveryHours: readDeliveryHours() };
        }
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    return null;
  } finally {
    window.__lrxStockBusy = false;
  }
})
