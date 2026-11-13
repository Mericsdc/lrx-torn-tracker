'use strict';
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const LANG_KEY = 'lrxe8-locale';
  const GH = 'https://github.com/Mericsdc/lrx-torn-tracker';

  /* ---------- Turkish text (English lives in the HTML) ---------- */
  const TR = {
    skip: 'İçeriğe geç', navScreens: 'Uygulama', navFeatures: 'Özellikler', navRules: 'Torn kuralları', navCredits: 'Teşekkürler', navReleases: 'Sürüm notları', navDownload: 'İndir',
    getIt: 'İndir', menu: 'Menü',
    heroTitle: 'Torn günün tek ekranda.',
    heroSub: 'Süreler, savaş hedefleri, seyahat kârı ve Torn\'un kendisi tek bir Windows uygulamasında. <b>Kendi Limited Access API key\'inle</b> çalışır ve key bilgisayarında kalır.',
    download: 'Windows için indir', factFree: 'Ücretsiz', factEnTr: 'English · Türkçe', development: 'Geliştirme',
    screensEyebrow: 'Uygulamanın içi', screensTitle: 'Torn nasıl oynanıyorsa öyle yapıldı.', screensLead: 'Uygulamadan gerçek ekranlar, örnek verilerle. Aralarında geçiş yap.',
    shotOverview: 'Genel bakış', shotWar: 'Savaş hedefleri', shotTravel: 'Seyahat kârı', shotSettings: 'Torn yardımcıları', shotLogin: 'Giriş',
    featEyebrow: 'Özellikler', featTitle: 'Daha az uğraş. Daha çok Torn.',
    f1t: 'Önemli süreler', f1d: 'Drug, booster, medical ve eğitim süreleri, barlar ve gün sıfırlaması Torn saatiyle (TCT).',
    f2t: 'Adil dövüş seç', f2d: 'FFScouter tahminleri, fair fight puanları, hastane sayaçları ve her faction için kendi hedef grupların.',
    f3t: 'Kâr için uç', f3d: 'Her ülke için saatlik kâr, varışta stok ve restock zamanları, kalkış uyarılarıyla.',
    f4t: 'Sekmelerde Torn', f4d: 'Torn yerleşik sekmelerde açılır. TornTools, FF Scouter ve TornW3B isteğe bağlı eklentiler olarak hazır.',
    f5t: 'Sadece gösteren yardımcılar', f5d: 'Savaş ve hastane sayaçları, suç ipuçları ve fiyat uyarıları baktığın Torn sayfasında görünür.',
    f6t: 'Ve fazlası', f6d: 'Crime Hub, merit planlayıcı, networth geçmişi, gym ve level rehberleri, faction raporları.',
    premiumNote: '<b>Premium isteğe bağlı.</b> Gelişmiş çalışma alanları ekler, oyun içi Xanax ile ödenir. Yukarıdakilerin hepsi ücretsiz kalır.',
    rulesEyebrow: 'Torn kuralları', rulesTitle: 'Kurallara uyar. Her düğmeye sen basarsın.',
    r1t: 'Key\'in bilgisayarında kalır', r1d: 'Limited Access key yerelde saklanır; Torn API ve FFScouter ile kullanılır. Premium bağlantısı açıkken (varsayılan) Torn ID\'ni doğrulamak için lrxe8.com\'a da gönderilir ve orada saklanmaz.',
    r2t: 'Sadece gösterir', r2d: 'Yardımcılar senin yerine asla tıklamaz, saldırmaz, satın almaz ya da bir şey göndermez. Sayfaya yalnızca bilgi eklerler.',
    r3t: 'Sadece baktığın sekme', r3d: 'Yardımcılar odaktaki Torn sekmesinde çalışır ve Torn sayfalarına fazladan istek atmaz.',
    r4t: 'Her şeye bir düğme', r4d: 'Her yardımcı, eklenti ve bağlantı Ayarlar\'dan kapatılabilir.',
    credEyebrow: 'Teşekkürler', credTitle: 'İyi araçlar. Arkalarında harika insanlar.', credLead: 'Emekleriyle bunu mümkün kılan oyunculara teşekkürler.',
    prev: 'Önceki', next: 'Sonraki', profile: 'Torn profilini gör',
    credNote: `Bağımsız projeler, teşekkürle anılır. Herhangi bir onay ima edilmez ve lisansları geçerliliğini korur. <a href="${GH}/blob/main/userscripts/NOTICE.txt" rel="noopener">Üçüncü taraf bildirimleri</a>`,
    relEyebrow: 'Sürüm notları', relTitle: 'Sürüm sürüm neler değişti.', relLead: 'Güncellemeler uygulamanın içinden kurulur. Key\'in, ayarların ve verilerin yerinde kalır.',
    relLatest: 'En yeni',
    rel13t: 'Daha güvenli güncellemeler ve eklentiler',
    rel13: '<li>Yarıda kalan bir güncelleme önceki sürümü kendiliğinden geri yükler.</li>'
      + '<li>TornTools yalnızca paketi TornTools\'un kendi imzasını taşıyorsa kurulur; Chrome da böyle denetler.</li>'
      + '<li>Kendi kendine sürekli sayfa değiştiren Torn sekmesi, sen sayfaya tıklayana kadar durdurulur. Bunun kendi ayarı var.</li>'
      + '<li>Bugün Xanax yalnızca kesin olduğunda kesin sayı gösterir; değilse ≥ ya da ≤ ile belirtir.</li>'
      + '<li>Sen ya da bir hedef hastaneden erken çıkınca da bildirim gelir.</li>'
      + '<li>Yeni key kaydetme, "1,500k" gibi fiyatlar, FFScouter kaydı ve poker oranı etiketleri düzeltildi.</li>',
    rel12t: 'Torn kuralları ve gizlilik',
    rel12: '<li>Rehab mesajı düğmesi artık Torn\'da hiçbir şeye tıklamıyor. Açtığın chat kutusuna yazar, Enter\'a sen basarsın.</li>'
      + '<li>Yeni ayar <b>Ayarlar → Uygulama → Premium üyelik bağlantısı</b>. Kapatırsan key\'in üyelik servisine hiç gönderilmez.</li>'
      + '<li>Torn ToS tablosu ve giriş notu artık neyin kiminle paylaşıldığını tek tek gösteriyor.</li>'
      + '<li>Torn oturumu aktarırken tek bir çerez reddedilirse artık oturumun kapanmıyor.</li>'
      + '<li>Oturum koruması açıkken Torn\'un kendi menüleri yine çalışıyor; korumanın artık kendi ayarı var.</li>'
      + '<li>API key değiştirince başka bir oyuncunun verisi artık geçmişine karışamaz.</li>'
      + '<li>Açık temada giriş ekranı artık rahat okunuyor.</li>',
    rel11t: 'Otomatik üyelik',
    rel11: '<li>Uygulamaya giriş yapınca Premium kayıtlı Torn hesabınla bağlanır. Ek düğme ya da onay kutusu yok.</li>'
      + '<li>Üyelik oturumu süresi dolunca ya da uygulama yeniden açılınca kendiliğinden yenilenir. Geçici hatalar ücretsiz araçları hiç etkilemez.</li>'
      + '<li>Xanax gönderince üyelik hemen açılır; gönderen uygulamayı hiç açmamış olsa bile. İki Xanax 30 gün ekler.</li>'
      + '<li>Bir transfer asla iki kez sayılmaz ve üyeliğini başka bir hesap sahiplenemez.</li>',
    rel10t: 'Otomatik Xanax ödemeleri',
    rel10: '<li>Xanax ödemeleri Torn\'un resmî eşya kayıtlarından eşleştiriliyor; yalnızca "some Xanax" yazan bildirimler de dahil.</li>'
      + '<li>Eşleşmemiş eski transferler, gönderildikleri andaki fiyatla otomatik olarak sonuçlandırıldı.</li>'
      + '<li>Üyelik kartları ve üye listesi gerçek Torn isimlerini gösteriyor. İsim ya da ID ile arama yapılabiliyor.</li>'
      + '<li>Premium araçlar üyeler için doğrudan açılıyor. Kayıtlı profiller duraklatma, süre bitimi ve yenilemeden sonra korunuyor.</li>',
    rel9t: 'Premium çalışma alanları',
    rel9: '<li>İsteğe bağlı Premium çalışma alanları: görünüm profilleri, yardımcı filtreleri, oyuncu karşılaştırma, etkinlik hedefleri, seyahat stratejileri ve kayıtlı merit planları.</li>'
      + '<li>Üyelik bağlantısı lrxe8.com üzerinden herkese açık HTTPS ile çalışıyor; VPN ya da ek kurulum gerekmiyor.</li>'
      + '<li>Kayıtlı Premium ayarların üyeliği yenileyince geri geliyor.</li>'
      + '<li>Mevcut tüm araçlar ücretsiz kalıyor.</li>',
    dlEyebrow: 'İndir', dlTitle: 'İndirmeden Torn\'a bir dakikada.',
    s1: 'ZIP\'i istediğin yere çıkar.', s2: 'TornTracker.exe\'yi aç.', s3: 'Kendi <b>Limited Access</b> API key\'ini yapıştır.',
    notes: 'Sürüm notları', dlSmall: 'Windows 10/11, ZIP. Güncellemeler uygulamanın içinden kurulur. Mac sürümü geliştiriliyor.',
    q1: 'Ücretsiz mi?', a1: 'Evet. Mevcut tüm araçlar ve Torn API verisine erişim ücretsiz. Premium isteğe bağlıdır ve oyun içi Xanax ile ödenir.',
    q2: 'Hangi API key gerekiyor?', a2: 'Torn ayarlarından oluşturduğun bir Limited Access key. Uygulama giriş ekranında seni oraya yönlendirir.',
    q3: 'Torn\'da serbest mi?', a3: 'Kendi key\'inle resmi API\'yi kullanır ve yardımcıları yalnızca bilgi gösterir. Bağımsız bir projedir, resmi bir Torn ürünü değildir.',
    q4: 'Mac\'te kullanabilir miyim?', a4: 'Henüz değil. Mac sürümü geliştiriliyor; şimdilik yalnızca Windows sürümü indirilebilir.',
    q5: 'Fikir ya da hata nasıl gönderirim?', a5: `Uygulamadaki Geri bildirim butonunu kullan ya da <a href="${GH}/issues" rel="noopener">GitHub</a>'da bir issue aç.`,
    license: 'Lisans', terms: 'Üyelik gizliliği', notices: 'Üçüncü taraf bildirimleri',
    footNote: '<a href="https://www.torn.com/profiles.php?XID=4037017" rel="noopener">Ezlira [4037017]</a> tarafından yapıldı. Bağımsız bir Torn yardımcısıdır, resmi bir Torn ürünü değildir.',
  };
  const ARIA_TR = { Sections: 'Bölümler', Language: 'Dil', 'App screens': 'Uygulama ekranları', 'Credited players': 'Teşekkür edilen oyuncular', Facts: 'Bilgiler', Links: 'Bağlantılar' };

  const SHOTS = {
    overview: {
      en: ['Drug, booster and education cooldowns, bars and the 18:00 TCT reset, next to your battle stats with and without the Xanax penalty.', 'Overview screen: drug, education and day-reset timers, bars and battle stats'],
      tr: ['Drug, booster ve eğitim süreleri, barlar ve 18:00 TCT sıfırlaması; yanında Xanax cezalı ve cezasız battle stat\'ların.', 'Genel bakış ekranı: drug, eğitim ve gün sıfırlama sayaçları, barlar ve battle stat\'lar'],
    },
    war: {
      en: ['FFScouter estimates turn an enemy faction into a ranked list: fair-fight value, win chance and points for every target.', 'War targets screen: ranked enemy list with estimated battle stats, fair fight and points'],
      tr: ['FFScouter tahminleriyle rakip faction sıralı bir listeye dönüşür: her hedef için fair fight değeri, kazanma ihtimali ve puan.', 'Savaş hedefleri ekranı: tahmini battle stat, fair fight ve puanla sıralı rakip listesi'],
    },
    travel: {
      en: ['Profit per hour for every country, with stock on arrival and the next restocks, so you land as the shelves fill.', 'Travel profit screen: profit per hour by country and upcoming restocks'],
      tr: ['Her ülke için saatlik kâr, varışta stok ve sıradaki restock\'lar; raflar dolarken inersin.', 'Seyahat kârı ekranı: ülkelere göre saatlik kâr ve yaklaşan restock\'lar'],
    },
    settings: {
      en: ['Every Torn helper has its own switch. Helpers show information on the page you are viewing and never click for you.', 'Settings screen: a switch for every Torn helper'],
      tr: ['Her Torn yardımcısının kendi düğmesi var. Yardımcılar baktığın sayfada bilgi gösterir, senin yerine asla tıklamaz.', 'Ayarlar ekranı: her Torn yardımcısı için bir düğme'],
    },
    login: {
      en: ['Sign in with your own Limited Access key. It is saved on your PC.', 'Sign-in screen with the LRX logo over a pixel city at night'],
      tr: ['Kendi Limited Access key\'inle giriş yaparsın. Key bilgisayarında saklanır.', 'Gece piksel şehir üzerinde LRX logolu giriş ekranı'],
    },
  };

  /* ---------- Language ---------- */
  const EN = {};
  $$('[data-i18n]').forEach((el) => { EN[el.dataset.i18n] = el.textContent; });
  $$('[data-i18n-html]').forEach((el) => { EN[el.dataset.i18nHtml] = el.innerHTML; });
  const ARIA_EN = new Map($$('[aria-label]').map((el) => [el, el.getAttribute('aria-label')]));
  let lang = 'en';
  try { lang = localStorage.getItem(LANG_KEY) === 'tr' ? 'tr' : 'en'; } catch {}
  let shot = 'overview';

  function applyLang(next, save) {
    lang = next === 'tr' ? 'tr' : 'en';
    document.documentElement.lang = lang;
    const dict = lang === 'tr' ? TR : EN;
    $$('[data-i18n]').forEach((el) => { const v = dict[el.dataset.i18n] ?? EN[el.dataset.i18n]; if (v != null) el.textContent = v; });
    $$('[data-i18n-html]').forEach((el) => { const v = dict[el.dataset.i18nHtml] ?? EN[el.dataset.i18nHtml]; if (v != null) el.innerHTML = v; });
    ARIA_EN.forEach((en, el) => { if (!el.classList.contains('brand')) el.setAttribute('aria-label', lang === 'tr' ? (ARIA_TR[en] || en) : en); });
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    $$('.people li').forEach((li) => { li.querySelector('small').textContent = li.dataset['role' + (lang === 'tr' ? 'Tr' : 'En')]; });
    showShot(shot, false);
    flex?.setRoles(people.map((p) => p.li.dataset['role' + (lang === 'tr' ? 'Tr' : 'En')]));
    updateFlexCaption();
    if (save) { try { localStorage.setItem(LANG_KEY, lang); } catch {} }
    document.documentElement.classList.remove('lang-wait');
  }
  $$('.lang button').forEach((b) => b.addEventListener('click', () => applyLang(b.dataset.lang, true)));

  /* ---------- Screens ---------- */
  const shotImg = $('#shot-img'), shotCap = $('#shot-cap'), panel = $('#shot-panel');
  const tabs = $$('.shot-tabs [role="tab"]');
  function showShot(name, animate = true) {
    shot = name;
    const sfx = lang === 'tr' ? '-tr' : '';
    const src = `/assets/LRXe8-tt-${name}-1600${sfx}.webp`;
    const set = `/assets/LRXe8-tt-${name}-960${sfx}.webp 960w, ${src} 1600w`;
    const [cap, alt] = SHOTS[name][lang];
    tabs.forEach((t) => { const on = t.dataset.shot === name; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on) panel.setAttribute('aria-labelledby', t.id); });
    shotCap.textContent = cap;
    if (shotImg.getAttribute('src') === src) { shotImg.alt = alt; return; }
    const swap = () => { shotImg.srcset = set; shotImg.src = src; shotImg.alt = alt; };
    if (!animate || reduced) { swap(); return; }
    shotImg.classList.add('swap');
    const pre = new Image(); pre.srcset = set; pre.sizes = shotImg.sizes; pre.src = src;
    const done = () => { swap(); requestAnimationFrame(() => shotImg.classList.remove('swap')); };
    (pre.decode ? pre.decode() : Promise.resolve()).then(done, done);
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => showShot(t.dataset.shot));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -i : e.key === 'End' ? tabs.length - 1 - i : 0;
      if (!d) return; e.preventDefault();
      const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); showShot(n.dataset.shot);
    });
  });
  // warm the cache for the other screens once the page is idle
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
  idle(() => Object.keys(SHOTS).forEach((n) => { const i = new Image(); i.src = `/assets/LRXe8-tt-${n}-${window.innerWidth > 980 ? 1600 : 960}${lang === 'tr' ? '-tr' : ''}.webp`; }));

  /* ---------- Header, menu, reveal ---------- */
  const top = $('#top');
  const onScroll = () => top.classList.toggle('scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const menu = $('#menu'), nav = $('#nav');
  menu.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; menu.setAttribute('aria-expanded', String(open)); nav.classList.toggle('open', open); });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) { menu.setAttribute('aria-expanded', 'false'); nav.classList.remove('open'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { menu.setAttribute('aria-expanded', 'false'); nav.classList.remove('open'); menu.focus(); } });

  if ('IntersectionObserver' in window) {
    $$('.screens .head, .shot, .features .head, .card, .premium-note, .rules-card, .credits .head, .releases .head, .rel, .dl-card').forEach((el) => el.classList.add('reveal'));
    const io = new IntersectionObserver((list) => list.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
    $$('.reveal').forEach((el) => io.observe(el));
    const links = new Map($$('.nav a').map((a) => [a.getAttribute('href').slice(1), a]));
    const spy = new IntersectionObserver((list) => list.forEach((en) => {
      if (!en.isIntersecting) return;
      links.forEach((a, id) => a.setAttribute('aria-current', String(id === en.target.id)));
    }), { rootMargin: '-45% 0px -50% 0px' });
    links.forEach((a, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });
  }

  /* ---------- Hero: the app's pixel city ---------- */
  const heroCanvas = $('#hero-waves');
  if (window.LRXShapeWaves && heroCanvas) {
    try {
      const waves = window.LRXShapeWaves.create(heroCanvas, reduced ? { intro: false, speed: 0.25 } : {});
      waves.start();
      if ('IntersectionObserver' in window) new IntersectionObserver((en) => (en[0].isIntersecting ? waves.start() : waves.stop())).observe($('#hero'));
      document.addEventListener('visibilitychange', () => (document.hidden ? waves.stop() : waves.start()));
    } catch (e) { console.warn('waves', e); }
  }

  /* ---------- Credits ---------- */
  const people = $$('.people li').map((li) => ({
    li, id: li.dataset.id, name: li.querySelector('b').textContent.trim(),
    role: li.dataset.roleEn, initials: li.querySelector('.pic').dataset.initials,
    src: li.querySelector('.pic img')?.getAttribute('src') || null,
  }));
  const flexBox = $('#flex');
  let flex = null, flexIndex = 0;
  function updateFlexCaption() {
    const p = people[flexIndex]; if (!p || !flex) return;
    const title = $('#flex-title');
    title.textContent = '';
    const small = document.createElement('small'); small.textContent = p.li.dataset['role' + (lang === 'tr' ? 'Tr' : 'En')];
    const id = document.createElement('span'); id.className = 'mono'; id.textContent = `[${p.id}]`;
    title.append(small, document.createTextNode(p.name), id);
    $('#flex-count').textContent = `${flexIndex + 1} / ${people.length}`;
    $('#flex-link').href = `https://www.torn.com/profiles.php?XID=${p.id}`;
  }
  async function startFlex() {
    if (reduced || !window.LRXFlex) return;
    try { await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1200))]); } catch {}
    try {
      flex = window.LRXFlex.create({
        stage: $('.flex-stage'), canvas: $('#flex-gl'), people,
        fonts: { sans: '"Inter", "Segoe UI", system-ui, sans-serif', mono: '"LRX TT Mono", ui-monospace, monospace' },
        onChange: (i) => { flexIndex = i; updateFlexCaption(); },
      });
    } catch (e) { console.warn('flex', e); flex = null; }
    if (!flex) return;
    flex.onLost = () => { flexBox.dataset.ready = 'false'; };
    flexBox.dataset.ready = 'true';
    flex.setRoles(people.map((p) => p.li.dataset['role' + (lang === 'tr' ? 'Tr' : 'En')]));
    $('#flex-prev').addEventListener('click', () => flex.prev());
    $('#flex-next').addEventListener('click', () => flex.next());
    flexBox.addEventListener('keydown', (e) => {
      if (e.target.closest('a')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); flex.next(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); flex.prev(); }
    });
    updateFlexCaption();
    document.fonts?.ready.then(() => flex?.redraw());
  }

  applyLang(lang, false);
  startFlex();
})();
