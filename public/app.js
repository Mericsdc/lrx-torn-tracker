/* =========================================================
   Torn Tracker – frontend
   ========================================================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  view: 'overview',
  lang: localStorage.getItem('tt.lang') === 'tr' ? 'tr' : 'en', // English is the default; Turkish is optional
  activeWsTab: 'tracker',
  browserTabs: [],
  nextTabSeq: 1,
  overview: null, overviewAt: 0, skew: 0,
  company: null,
  wars: null,
  targets: null, targetsAt: 0,
  factionId: Number(localStorage.getItem('tt.faction')) || null,
  mode: localStorage.getItem('tt.mode') || 'noXanax',
  sort: { key: 'smart', dir: 1 },
  config: null,
  playerInfo: {}, // xid -> { data, at, loading }
  tornLoggedIn: null,
  tornTools: null,
};

const tr = (trStr, enStr) => (state.lang === 'en' ? enStr : trStr);
// Locale for clock times shown in the UI (24-hour in both languages)
const timeLocale = () => (state.lang === 'en' ? 'en-GB' : 'tr-TR');

const I18N = {
  'nav.overview': ['Genel Bakış', 'Overview'],
  'nav.stock': ['Stok Durumu', 'Stock Status'],
  'nav.report': ['Günlük Rapor', 'Daily Report'],
  'nav.employees': ['Çalışanlar', 'Employees'],
  'nav.income': ['Gelir Tablosu', 'Income Statement'],
  'nav.war': ['Savaş Hedefleri', 'War Targets'],
  'nav.settings': ['Ayarlar', 'Settings'],
  'top.refresh': ['Yenile', 'Refresh'],
  'ws.tornHome': ['Torn Ana Sayfa', 'Torn Home'],
  'ws.company': ['Şirketim', 'My Company'],
  'ws.travel': ['Rehab / Seyahat', 'Rehab / Travel'],
  'ws.newTab': ['Yeni Torn Sekmesi Aç (Torn Ana Sayfa)', 'Open a new Torn tab (Torn Home)'],
  'ws.back': ['Geri', 'Back'],
  'ws.forward': ['İleri', 'Forward'],
  'ws.reload': ['Yenile', 'Reload'],
  'ws.urlPh': ["Torn URL veya Oyuncu ID (XID) yazıp Enter'a basın…", 'Enter a Torn URL or player ID (XID) and press Enter…'],
  'ws.go': ['Git', 'Go'],
  'ws.loginHelp': ['Oturum Aktar', 'Login Help'],
  'ws.loginHelpTitle': ['Google Giriş & Oturum Aktarma', 'Google sign-in & session import'],
  'ws.ext': ['Tarayıcıda', 'In Browser'],
  'ws.extTitle': ['Harici Tarayıcıda Aç', 'Open in your external browser'],
  'ov.edu': ['Eğitim', 'Education'],
  'ov.dayReset': ['Günün Bitmesine (18:00 TCT)', 'Until Day Reset (18:00 TCT)'],
  'ov.bars': ['Barlar', 'Bars'],
  'ov.battlePower': ['Savaş Gücü', 'Battle Stats'],
  'stock.capacity': ['Depo Kapasitesi', 'Storage Capacity'],
  'report.eyebrow': ['Günlük Satış & Sipariş Raporu', 'Daily Sales & Order Report'],
  'report.targetStock': ['Hedef stok', 'Target stock'],
  'report.copyBtn': ['Raporu Kopyala', 'Copy Report'],
  'report.tableTitle': ['Ürün Bazlı Satış', 'Sales by Product'],
  'report.tableSub': ['Son gün verisi · ortalama son 7 kayıt', 'Last day · average of the last 7 records'],
  'report.orderList': ['Sipariş Listesi', 'Order List'],
  'emp.tableTitle': ['Çalışanlar & Addiction', 'Employees & Addiction'],
  'emp.tableSub': ['Addiction etkinliği düşürür · -8 ve sonrası için REHAB önerilir', 'Addiction lowers effectiveness · Rehab recommended at -8 or worse'],
  'inc.pnlTitle': ['Günlük Gelir Tablosu', 'Daily Income Statement'],
  'inc.lastDay': ['Son gün', 'Last day'],
  'inc.donutTitle': ['Ürün Gelir Dağılımı', 'Revenue by Product'],
  'inc.histTitle': ['Gelir Geçmişi', 'Income History'],
  'inc.dayByDay': ['Gün Gün', 'Day by Day'],
  'war.enemyFaction': ['Rakip Faction', 'Enemy Faction'],
  'war.factionPh': ['Faction ID gir (örn. 8205)', 'Enter faction ID (e.g. 8205)'],
  'war.scanBtn': ['Tara', 'Scan'],
  'war.noXanax': ['Xanaxsız', 'No Xanax'],
  'war.withXanax': ['Xanaxlı', 'With Xanax'],
  'war.onlyOkay': ['Sadece müsait', 'Okay only'],
  'war.onlyFit': ['Sadece uygun', 'Good fit only'],
  'set.title': ['API Ayarları', 'API Settings'],
  'set.apiKeyLabel': ['Torn API Key (Limited)', 'Torn API Key (Limited)'],
  'set.keyPh': ['Değiştirmek için yeni key gir', 'Enter a new key to change it'],
  'set.ffKeyLabel': ['FFScouter Key (boşsa Torn key kullanılır)', 'FFScouter Key (uses the Torn key if blank)'],
  'set.optionalPh': ['Opsiyonel', 'Optional'],
  'set.coverLabel': ['Hedef stok (gün)', 'Target stock (days)'],
  'set.pollLabel': ['Arka plan kayıt (dk)', 'Background refresh (min)'],
  'set.saveBtn': ['Kaydet', 'Save'],
  'auth.sub': ["Devam etmek için Torn <b>Limited Access</b> API key'ini gir.", 'Enter your Torn <b>Limited Access</b> API key to continue.'],
  'auth.showHide': ['Göster / gizle', 'Show / hide'],
  'auth.login': ['Giriş Yap', 'Log In'],
  'auth.getKey': ['Limited API key oluştur →', 'Create a Limited API key →'],
  'auth.privacy': ["Key yalnızca bu bilgisayarda saklanır ve api.torn.com'a gönderilir. Ayrı bir FFScouter key girmezsen Savaş Hedefleri için ffscouter.com'a da gönderilir.", 'Your key is stored only on this computer and sent to api.torn.com. Unless you enter a separate FFScouter key, it is also sent to ffscouter.com for War Targets.'],
  'auth.creditTitle': ['Torn profili', 'Torn profile'],
  // Torn API kullanım koşulları (ToS) tablosu — key'in girildiği ekranda gösterilmesi gerekir
  'tos.title': ['API kullanım koşulları (Torn ToS)', 'API terms of use (Torn ToS)'],
  'tos.storage': ['Veri saklama', 'Data storage'],
  'tos.storageV': ['Yalnızca bu bilgisayarda, uygulamanın data klasöründe. Uygulamanın sunucusu yoktur.', "Only on this computer, in the app's data folder. The app has no server."],
  'tos.sharing': ['Veri paylaşımı', 'Data sharing'],
  'tos.sharingV': ["Kimseyle paylaşılmaz. Yalnızca Savaş Hedefleri için oyuncu ID'leri ffscouter.com'a gönderilir.", 'Not shared with anyone. Only player IDs are sent to ffscouter.com for War Targets.'],
  'tos.purpose': ['Kullanım amacı', 'Purpose of use'],
  'tos.purposeV': ['Kişisel takip: şirket, stok, istatistik, suç ve bildirimler.', 'Personal tracking: company, stock, stats, crimes and notifications.'],
  'tos.keyStorage': ['Key saklama ve paylaşım', 'Key storage & sharing'],
  'tos.keyStorageV': ["Bu bilgisayarda config.json içinde. api.torn.com'a, ayrı FFScouter key yoksa ffscouter.com'a gönderilir. Başka yere gönderilmez.", 'In config.json on this computer. Sent to api.torn.com, and to ffscouter.com if no separate FFScouter key is set. Sent nowhere else.'],
  'tos.access': ['Key erişim seviyesi', 'Key access level'],
  'tos.accessV': ['Limited Access. Log okuyan özellikler için isteğe bağlı ayrı bir "log" key.', 'Limited Access. An optional separate "log" key for features that read logs.'],
  'set.logout': ['Çıkış Yap', 'Log Out'],
  'set.tab.account': ['Hesap', 'Account'],
  'set.tab.general': ['Genel', 'General'],
  'set.tab.pages': ['Sayfalar', 'Pages'],
  'set.tab.notify': ['Bildirimler', 'Notifications'],
  'set.tab.torn': ['Torn yardımcıları', 'Torn helpers'],
  'set.tab.events': ['Etkinlikler', 'Events'],
  'set.keysTitle': ['API anahtarları', 'API keys'],
  'set.logKeyLabel': ['Log key (isteğe bağlı)', 'Log key (optional)'],
  'set.logKeyCreate': ["Torn'da log key oluştur ↗", 'Create a log key in Torn ↗'],
  'set.logKeyRemove': ["Log key'i sil", 'Remove log key'],
  'set.trackTitle': ['Takip', 'Tracking'],
  'set.updateTitle': ['Güncelleme', 'Updates'],
  'set.updateCheck': ['Şimdi kontrol et', 'Check now'],
  'set.appTitle': ['Uygulama', 'App'],
  'set.pagesHint': ['Kapattığın sayfa menüden kalkar; alt seçenekler sayfadaki kartları açıp kapatır', 'Pages you turn off are removed from the menu; sub-options show or hide cards on that page'],
  'set.notifyHint': ['Masaüstü bildirimleri', 'Desktop notifications'],
  'set.tornHint': ['Torn sekmelerinde çalışır · değişiklik sayfa yenilenince geçerli olur', 'Runs in Torn tabs · changes apply when the page reloads'],
  'set.ffStatusTitle': ['FFScouter Durumu', 'FFScouter Status'],
  'set.checkBtn': ['Kontrol et', 'Check'],
  // Torn giriş / oturum aktarma penceresi (gömülü tarayıcı)
  'login.title': ['🔑 Torn Giriş & Oturum Aktarma (Google Hesabı İçin)', '🔑 Torn Login & Session Import (for Google Accounts)'],
  'login.close': ['Kapat', 'Close'],
  'login.why': [
    `<b>Neden Google "Oturumunuz açılamadı / Bu tarayıcı güvenli olmayabilir" diyor?</b><br>
            Google, masaüstü <code>.exe</code> uygulamalarının (Electron) içindeki gömülü tarayıcılarda Google hesabıyla girişi engeller. TornTracker bu yüzden Google girişini <b>bilgisayarındaki Chrome/Edge'de</b> yaptırıp oturumu otomatik olarak uygulamaya aktarır.`,
    `<b>Why does Google say "Couldn't sign you in / This browser or app may not be secure"?</b><br>
            Google blocks Google-account sign-in inside browsers embedded in desktop <code>.exe</code> apps (Electron). So TornTracker has you sign in with Google <b>in Chrome/Edge on your computer</b> and then imports the session into the app automatically.`,
  ],
  'login.m1Title': ['Yöntem 1 · Google ile Giriş (Chrome/Edge üzerinden) — Önerilen', 'Method 1 · Sign in with Google (via Chrome/Edge) — Recommended'],
  'login.m1Body': [
    `Butona bas → Chrome (yoksa Edge) TornTracker'a özel ayrı bir pencerede Torn'u açar → orada <b>Google ile giriş</b> yap → Torn ana sayfan açılınca <b>o pencereyi kapat</b>. Pencere kapanınca oturum buraya aktarılır. Torn'daki Google (G) butonuna basınca da bu akış otomatik başlar.`,
    `Press the button → Chrome (or Edge if Chrome isn't installed) opens Torn in a separate window just for TornTracker → <b>sign in with Google</b> there → once your Torn home page appears, <b>close that window</b>. When it closes, the session is imported here. Pressing the Google (G) button on Torn also starts this flow automatically.`,
  ],
  'login.m1Btn': ['🔐 Google ile Giriş Yap', '🔐 Sign in with Google'],
  'login.m2Title': ['Yöntem 2 · Torn E-posta & Şifre', 'Method 2 · Torn Email & Password'],
  'login.m2Body': [
    `Torn giriş ekranında Google (G) butonu yerine doğrudan <b>E-posta ve Şifrenizi</b> yazarak giriş yapın.<br><br>
              Hesabınızı Google ile açtıysanız ve Torn şifreniz yoksa, Torn giriş ekranında bir kez <b>"Forgot Password?"</b> diyerek e-postanıza şifre tanımlayabilirsiniz.`,
    `On the Torn login screen, type your <b>email and password</b> instead of using the Google (G) button.<br><br>
              If you created your account with Google and have no Torn password, click <b>"Forgot Password?"</b> once on the Torn login screen to set one by email.`,
  ],
  'login.m3Title': ['Yöntem 3 · Tarayıcıdaki Açık Oturumu Elle Aktar', 'Method 3 · Import an Open Browser Session Manually'],
  'login.m3Body': [
    `Normal tarayıcınızda (Chrome/Edge) Torn açıkken <b>F12</b> → <b>Application</b> → <b>Cookies</b> → <code>https://www.torn.com</code> bölümünden <code>PHPSESSID</code> (ve varsa <code>uid</code> / <code>pass</code>) değerini aşağıya yapıştırın:`,
    `With Torn open in your normal browser (Chrome/Edge), go to <b>F12</b> → <b>Application</b> → <b>Cookies</b> → <code>https://www.torn.com</code> and paste the <code>PHPSESSID</code> value (plus <code>uid</code> / <code>pass</code> if present) below:`,
  ],
  'login.sessLabel': ['PHPSESSID (Zorunlu)', 'PHPSESSID (required)'],
  'login.sessPh': ['Örn: a1b2c3d4e5f6...', 'e.g. a1b2c3d4e5f6...'],
  'login.uidLabel': ['uid (Opsiyonel - Kalıcı Oturum)', 'uid (optional, keeps you logged in)'],
  'login.uidPh': ['Örn: 1234567', 'e.g. 1234567'],
  'login.passLabel': ['pass (Opsiyonel) veya Tüm Cookie Metni', 'pass (optional) or the full cookie string'],
  'login.passPh': ['pass değeri veya PHPSESSID=...; uid=...; pass=...', 'pass value or PHPSESSID=...; uid=...; pass=...'],
  'login.apply': ['✓ Oturumu Uygula & Yenile', '✓ Apply Session & Reload'],
};

const VIEW_META = {
  overview: { tr: ['Genel Bakış', 'Anlık durum, sayaçlar ve savaş gücü'], en: ['Overview', 'Live status, timers and battle stats'] },
  stock: { tr: ['Stok Durumu', 'Şirket deposu, ürün stokları ve kalan gün'], en: ['Stock Status', 'Company storage, product stock and days left'] },
  report: { tr: ['Günlük Rapor', 'Ne kadar satıldı, ne kadar sipariş vermelisin'], en: ['Daily Report', 'What sold and how much you should order'] },
  employees: { tr: ['Çalışanlar', 'Addiction, effectiveness ve aktivite takibi'], en: ['Employees', 'Addiction, effectiveness and activity tracking'] },
  income: { tr: ['Gelir Tablosu', 'Gelir, maliyet, maaş ve net kâr'], en: ['Income Statement', 'Revenue, COGS, wages and net profit'] },
  war: { tr: ['Savaş Hedefleri', 'Savaş gücüne uygun rakipler · FFScouter'], en: ['War Targets', 'Opponents that suit your battle stats · FFScouter'] },
  settings: { tr: ['Ayarlar', 'API key ve rapor tercihleri'], en: ['Settings', 'API keys and reporting preferences'] },
};

function applyLang() {
  document.documentElement.lang = state.lang;
  $$('#lang-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.lang === state.lang));
  // Static text in index.html: data-i18n (text), data-i18n-html (markup), data-i18n-title, data-i18n-placeholder
  const pick = (key) => { const p = I18N[key]; return p ? (state.lang === 'en' ? p[1] : p[0]) : null; };
  $$('[data-i18n]').forEach((el) => { const v = pick(el.dataset.i18n); if (v != null) el.textContent = v; });
  $$('[data-i18n-html]').forEach((el) => { const v = pick(el.dataset.i18nHtml); if (v != null) el.innerHTML = v; });
  $$('[data-i18n-title]').forEach((el) => { const v = pick(el.dataset.i18nTitle); if (v != null) el.title = v; });
  $$('[data-i18n-placeholder]').forEach((el) => { const v = pick(el.dataset.i18nPlaceholder); if (v != null) el.placeholder = v; });
  const vm = VIEW_META[state.view]?.[state.lang] || VIEW_META.overview[state.lang];
  $('#view-title').textContent = vm[0];
  $('#view-sub').textContent = vm[1];
  $$('#cover-days option').forEach((opt) => {
    const v = opt.value;
    opt.textContent = state.lang === 'en' ? `${v} ${v === '1' ? 'day' : 'days'}` : `${v} gün`;
  });
  // Placeholder texts that live data replaces later
  if (!state.overview) $$('[data-sub="drug"], [data-sub="edu"]').forEach((el) => { el.textContent = tr('Yükleniyor…', 'Loading…'); });
  if (!state.targets) { const wt = $('#war-title'); if (wt) wt.textContent = tr('Hedefler', 'Targets'); }
  const ub = $('#update-btn');
  if (ub && !state.update) ub.title = tr('Güncellemeleri denetle', 'Check for updates');
  $$('[data-close-tab]').forEach((b) => { b.title = tr('Sekmeyi kapat', 'Close tab'); });

  const wf = $('#war-footnote');
  if (wf) wf.innerHTML = tr(
    '<b>Oran</b> = Rakip tahmini toplam BS ÷ senin seçili efektif toplam BS. <b>FF</b> ≈ 1 + 8/3·√oran (en fazla 3; oran ≥ 0.56 → FF 3). <b>Puan</b> = tahmini kazanma × FF (ödeme payın buna göre). <span class="fit easy">Kolay</span> &lt; 0.35 · <span class="fit ideal">İdeal</span> 0.35–0.80 (FF 2.6–3.0) · <span class="fit risk">Riskli</span> 0.80–1.10 · <span class="fit avoid">Kaçın</span> &gt; 1.10. Kazanma yüzdesi stat tahminine dayalı kaba bir tahmindir.',
    '<b>Ratio</b> = opponent\'s estimated total BS ÷ your selected effective total BS. <b>FF</b> ≈ 1 + 8/3·√ratio (max 3; ratio ≥ 0.56 → FF 3). <b>Points</b> = est. win chance × FF (your payout share follows this). <span class="fit easy">Easy</span> &lt; 0.35 · <span class="fit ideal">Ideal</span> 0.35–0.80 (FF 2.6–3.0) · <span class="fit risk">Risky</span> 0.80–1.10 · <span class="fit avoid">Avoid</span> &gt; 1.10. Win % is a rough guess based on estimated stats.'
  );
  const sil = $('#set-info-list');
  if (sil) sil.innerHTML = tr(
    `<div><span>Veri dosyası</span><span class="mono">data/history.json</span></div>
     <div><span>Ayar dosyası</span><span class="mono">data/config.json</span></div>
     <div><span>Savaş gücü kaynağı</span><span>FFScouter API + Torn rank tahmini</span></div>`,
    `<div><span>History file</span><span class="mono">data/history.json</span></div>
     <div><span>Config file</span><span class="mono">data/config.json</span></div>
     <div><span>Battle stats source</span><span>FFScouter API + Torn rank estimate</span></div>`
  );
}

const PALETTE = ['#c9a96a', '#d4d9df', '#8fa3b8', '#b08d6e', '#7d8894', '#6f8f86', '#a89a86', '#b67a6a', '#9aa7c7', '#5d6670'];

/* ---------------- helpers ---------------- */
const decoder = document.createElement('textarea');
const decode = (s) => { decoder.innerHTML = String(s ?? ''); return decoder.value; };
const esc = (s) => decode(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = (v) => (v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US'));
const money = (v) => (v == null || isNaN(v) ? '—' : (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US'));
const pct = (v, d = 0) => (v == null || isNaN(v) ? '—' : (v * 100).toFixed(d) + '%');
function compact(v, d = 2) {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v);
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [u, s] of units) if (a >= u) return (v / u).toFixed(a / u >= 100 ? 0 : a / u >= 10 ? 1 : d) + s;
  return String(Math.round(v));
}
const cmoney = (v) => (v == null ? '—' : (v < 0 ? '-$' : '$') + compact(Math.abs(v)));
const pad = (x) => String(Math.floor(x)).padStart(2, '0');
function clock(s) {
  s = Math.max(0, Math.floor(s));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (d ? `${d}${tr('g', 'd')} ` : '') + `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
function human(s) {
  s = Math.max(0, Math.floor(s));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}${tr('g', 'd')} ${h}${tr('sa', 'h')}`;
  if (h) return `${h}${tr('sa', 'h')} ${m}${tr('dk', 'm')}`;
  if (m) return `${m}${tr('dk', 'm')}`;
  return `${s}${tr('sn', 's')}`;
}
const nowTct = () => Date.now() + state.skew;
const tctTime = (ms) => new Date(ms).toISOString().slice(11, 19);
const tctDateStr = (ms) => new Date(ms - 18 * 3600_000).toISOString().slice(0, 10);

const REHAB_TEMPLATES = {
  en_polite: 'Hey {name}, I see your addiction is at {addiction} right now. Could you please go to REHAB as soon as possible? Thanks!',
  en_firm: 'Hi {name}, your company addiction is currently at {addiction}, which is hurting our effectiveness. Please fly to Switzerland and go to REHAB as soon as possible. Thank you!',
  en_short: 'Hey {name}, your addiction is at {addiction} — could you please do a quick REHAB run when you can? Appreciate it!',
};
state.rehabTplKey = REHAB_TEMPLATES[localStorage.getItem('tt.rehabTplEnKey')] ? localStorage.getItem('tt.rehabTplEnKey') : 'en_polite';
state.rehabTpl = localStorage.getItem('tt.rehabTplEn') || REHAB_TEMPLATES[state.rehabTplKey];
state.rehabFilter = localStorage.getItem('tt.rehabFilter') || 'crit';

function formatRehabMsg(name, addiction) {
  return (state.rehabTpl || REHAB_TEMPLATES.en_polite)
    .replace(/\{name\}/gi, decode(name))
    .replace(/\{addiction\}/gi, String(addiction));
}
/* Rehab mesajını Torn private chat'ten gönder (Electron). Olmazsa Mesaj ekranı + pano. */
const chatSending = new Set();
async function sendRehabChat(emp, btn) {
  const name = decode(emp.name);
  const msg = formatRehabMsg(emp.name, emp.addiction);
  const fallback = async (why) => {
    await copyText(msg, tr(`Chat açılamadı (${why}) · Mesaj kopyalandı, Ctrl+V ile yapıştır`, `Couldn't open chat (${why}) · Message copied, paste with Ctrl+V`));
    openInTab(`https://www.torn.com/messages.php#/p=compose&XID=${emp.id}`, { activate: true });
  };
  if (!window.electronAPI?.tornChatSend) return fallback(tr('tarayıcı modu', 'browser mode'));
  if (chatSending.has(emp.id)) return;
  chatSending.add(emp.id);
  btn?.classList.add('spin');
  toast(tr(`${name} için chat açılıyor…`, `Opening chat with ${name}…`));
  try {
    const url = `https://www.torn.com/profiles.php?XID=${emp.id}`;
    const tab = openInTab(url, { activate: true, reuse: true });
    const r = await window.electronAPI.tornChatSend({ tabId: tab.id, name, message: msg });
    if (r?.ok && r.sent !== false) toast(tr(`✓ Rehab mesajı ${name} kişisine chat'ten gönderildi`, `✓ Rehab message sent to ${name} via chat`));
    else if (r?.ok) toast(tr(`Mesaj chat kutusuna yazıldı · Enter ile gönder`, `Message typed into chat · press Enter to send`));
    else if (r?.step === 'load' && state.tornLoggedIn === false) await fallback(tr("Torn'a giriş yapılmamış", 'not logged in to Torn'));
    else await fallback(r?.step || tr('hata', 'error'));
  } catch (e) {
    await fallback(e.message);
  } finally {
    chatSending.delete(emp.id);
    btn?.classList.remove('spin');
  }
}

async function copyText(txt, okMsg = tr('Kopyalandı', 'Copied')) {
  try { await navigator.clipboard.writeText(txt); } catch {
    const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast(okMsg);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

const alerts = new Map();
function setAlert(key, html, type = 'danger') {
  if (html) alerts.set(key, { html, type }); else alerts.delete(key);
  $('#alert-area').innerHTML = [...alerts.values()].map((a) => `<div class="alert ${a.type}">${a.html}</div>`).join('');
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60_000), ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(json.error || `HTTP ${res.status}`); e.status = res.status; e.code = json.code; throw e; }
  return json;
}

function statusInfo(st) {
  if (!st) return { cls: 'dim', text: '—', color: 'var(--muted)' };
  const s = st.state;
  if (s === 'Okay') return { cls: 'green', text: tr('Müsait', 'Okay'), color: 'var(--ok)' };
  if (s === 'Hospital') return { cls: 'danger', text: tr('Hastanede', 'Hospital'), color: 'var(--danger)', until: st.until };
  if (s === 'Jail') return { cls: 'orange', text: tr('Hapiste', 'Jail'), color: 'var(--orange)', until: st.until };
  if (s === 'Traveling') return { cls: 'blue', text: tr('Seyahatte', 'Traveling'), color: 'var(--blue)' };
  if (s === 'Abroad') return { cls: 'blue', text: tr('Yurt dışı', 'Abroad'), color: 'var(--blue)' };
  if (s === 'Federal') return { cls: 'danger', text: 'Federal', color: 'var(--danger)' };
  if (s === 'Fallen') return { cls: 'dim', text: 'Fallen', color: 'var(--muted)' };
  return { cls: 'dim', text: s, color: 'var(--muted)' };
}
/* Hastane / hapis çıkış sayacı çipi. withOkay=true ise müsait durumunu da gösterir. */
function statusTimerChip(st, withOkay = false) {
  if (!st) return '';
  const si = statusInfo(st);
  const until = Number(st.until) || 0;
  if ((st.state === 'Hospital' || st.state === 'Jail') && until > nowTct() / 1000) {
    const icon = st.state === 'Hospital' ? '🏥' : '⛓';
    return `<span class="chip ${si.cls} mono hosp-timer" title="${esc(st.description || si.text)} · ${tr('çıkış', 'out at')} ${new Date((until * 1000) - state.skew).toLocaleTimeString(timeLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}">${icon} <span data-until="${until}">${clock(until - nowTct() / 1000)}</span></span>`;
  }
  if (!withOkay) return '';
  return `<span class="chip ${si.cls}" title="${esc(st.description || '')}">${si.text}</span>`;
}

function lastActionChip(la) {
  if (!la) return '—';
  const c = la.status === 'Online' ? 'var(--ok)' : la.status === 'Idle' ? 'var(--warn)' : 'var(--muted-2)';
  return `<span class="status-dot" style="background:${c}"></span><span class="sub-text">${esc(la.relative)}</span>`;
}

/* ---------------- navigation ---------------- */
function showView(v) {
  state.view = v;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === `view-${v}`));
  const vm = VIEW_META[v]?.[state.lang] || VIEW_META.overview[state.lang];
  $('#view-title').textContent = vm[0];
  $('#view-sub').textContent = vm[1];
  location.hash = v;
  if (v === 'war') { if (!state.wars) loadWars(); if (state.factionId && !state.targets) loadTargets(); window.loadWarGroups?.(); }
  if (v === 'settings') loadConfig();
  window.onViewShown?.(v);
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('.nav-item'); if (b) showView(b.dataset.view); });
$('#lang-toggle').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lang]'); if (!b) return;
  state.lang = b.dataset.lang === 'tr' ? 'tr' : 'en';
  localStorage.setItem('tt.lang', state.lang);
  syncLangToServer();
  applyLang();
  if (state.overview) renderOverview();
  if (state.company) renderCompany();
  if (state.wars) renderWarChips();
  if (state.targets) renderTargets();
  if (state.config) loadConfig();
  if (state.update) renderUpdateBtn();
  renderTornToolsBtn();
  window.onLangChanged?.();
  tick();
});

/* =========================================================
   OVERVIEW
   ========================================================= */
async function loadOverview(force = false) {
  try {
    const o = await api('/api/overview' + (force ? '?force=1' : ''));
    state.overview = o; state.overviewAt = Date.now();
    state.skew = o.serverTime * 1000 - Date.now();
    try { localStorage.setItem('tt.cache.overview', JSON.stringify({ data: o, at: state.overviewAt })); } catch {}
    setAlert('overview', null);
    renderOverview();
  } catch (e) {
    if (!state.overview) {
      setAlert('overview', `<b>${tr('Kullanıcı verisi alınamadı:', 'Failed to load user data:')}</b>&nbsp;${esc(e.message)}${e.status === 412 ? ` <button class="btn sm" onclick="showView('settings')">${tr('Ayarlar', 'Settings')}</button>` : ''}`);
    }
  }
}

function setRing(card, frac, done) {
  const c = $(card + ' .ring-fg'), C = 326.73;
  c.style.strokeDashoffset = C * (1 - Math.max(0, Math.min(1, frac)));
  $(card).classList.toggle('done', !!done);
}

function renderOverview() {
  const o = state.overview; if (!o) return;
  // sidebar me
  const p = o.player;
  $('#me-chip').style.cursor = 'pointer';
  $('#me-chip').dataset.openUrl = `https://www.torn.com/profiles.php?XID=${p.id}`;
  $('#me-chip').dataset.tabLabel = `${decode(p.name)} [${p.id}]`;
  $('#me-chip').title = tr('Profilimi sekmede aç', 'Open my profile in a tab');
  const fac = p.faction || {};
  const ftag = fac.faction_tag && fac.faction_tag !== 'None' ? fac.faction_tag : '';
  $('#me-chip').innerHTML = `<div class="avatar" style="background-image:url('${esc(p.image || '')}')"></div>
    <div class="me-meta"><strong>${esc(p.name)} <span class="muted">[${p.id}]</span></strong>
      <small>Lv ${p.level}${ftag ? ` · <b class="me-ftag" title="Faction: ${esc(decode(fac.faction_name || ftag))}${fac.position ? ` · ${esc(fac.position)}` : ''}">${esc(ftag)}</b>` : ''}</small>
      <small class="me-job" title="${tr('İş', 'Job')}: ${esc(jobLabel(p.job))}">💼 ${esc(jobLabel(p.job))}</small></div>`;
  syncCompanyMode();

  // status chip
  const si = statusInfo(p.status);
  $('#status-chip').className = `chip ${si.cls}`;
  $('#status-chip').textContent = decode(p.status?.description || si.text);

  // bars
  const barDef = [['energy', 'Energy', '#d6dce3'], ['nerve', 'Nerve', '#c4495f'], ['happy', 'Happy', '#c79228'], ['life', 'Life', '#26b880']];
  $('#bars').innerHTML = barDef.map(([k, label, col]) => {
    const b = o.bars[k]; if (!b) return '';
    const w = Math.min(100, (b.current / b.maximum) * 100);
    return `<div class="bar-row"><div class="bar-top"><span>${label}</span><span class="mono">${n0(b.current)} / ${n0(b.maximum)} <span class="muted" data-full="${k}">${b.fulltime ? '· ' + human(b.fulltime) : '· ' + tr('dolu', 'full')}</span></span></div>
      <div class="bar"><i style="width:${w}%;background:${col}"></i></div></div>`;
  }).join('');

  const chips = [];
  if (o.travel) chips.push(`<span class="chip blue">✈ ${esc(o.travel.description)}</span>`);
  if (o.drug.xanToday != null) chips.push(`<span class="chip tq">${tr('Bugün Xanax', 'Xanax Today')}: ${o.drug.xanToday}</span>`);
  if (o.drug.xantaken != null) chips.push(`<span class="chip">${tr('Toplam Xanax', 'Total Xanax')}: ${n0(o.drug.xantaken)}</span>`);
  if (o.drug.refills != null) chips.push(`<span class="chip">${tr('Refill', 'Refills')}: ${n0(o.drug.refills)}</span>`);
  chips.push(`<span class="chip ${o.cooldowns.booster ? 'warn' : ''}">Booster CD: <span data-cd="booster">${o.cooldowns.booster ? human(o.cooldowns.booster) : tr('yok', 'none')}</span></span>`);
  chips.push(`<span class="chip ${o.cooldowns.medical ? 'warn' : ''}">Medical CD: <span data-cd="medical">${o.cooldowns.medical ? human(o.cooldowns.medical) : tr('yok', 'none')}</span></span>`);
  if (o.bars.chain?.current) chips.push(`<span class="chip orange">Chain: ${o.bars.chain.current}</span>`);
  if (o.bank) chips.push(`<span class="chip ${o.bank.timeLeft > 0 ? '' : 'green'}">🏦 ${tr('Banka', 'Bank')}: ${cmoney(o.bank.amount)} · ${o.bank.timeLeft > 0 ? `${human(o.bank.timeLeft)} ${tr('kaldı', 'left')}` : tr('bitti, çekilebilir', 'done, ready to withdraw')}</span>`);
  $('#mini-row').innerHTML = chips.join('');

  // battle stats
  const bt = o.battle, t = bt.totals;
  $('#xan-chip').className = `chip ${o.drug.xanaxActive ? 'warn' : 'tq'}`;
  $('#xan-chip').textContent = o.drug.xanaxActive ? tr('Xanax etkisi aktif (-35%)', 'Xanax penalty active (-35%)') : tr('Xanax etkisi yok', 'No Xanax penalty');
  $('#bs-totals').innerHTML = `
    <div class="bs-total"><small>${tr('Ham Toplam', 'Base Total')}</small><strong>${compact(t.base)}</strong></div>
    <div class="bs-total tq"><small>${tr('Xanaxsız (efektif)', 'No Xanax (effective)')}</small><strong>${compact(t.noXanax)}</strong></div>
    <div class="bs-total warn"><small>${tr('Xanaxlı (efektif)', 'With Xanax (effective)')}</small><strong>${compact(t.withXanax)}</strong></div>`;
  const names = { strength: 'Strength', defense: 'Defense', speed: 'Speed', dexterity: 'Dexterity' };
  $('#bs-table').innerHTML = `<thead><tr><th>Stat</th><th class="num">${tr('Ham', 'Base')}</th><th class="num">Mod</th><th class="num">${tr('Xanaxsız', 'No Xanax')}</th><th class="num">${tr('Xanaxlı', 'With Xanax')}</th></tr></thead><tbody>${
    Object.entries(bt.stats).map(([k, s]) => `<tr title="${esc(s.info.map((i) => i.text).join('\n'))}"><td>${names[k]}</td><td class="num">${n0(s.base)}</td><td class="num ${s.modifier >= 0 ? 'pos' : 'neg'}" title="${tr('API mevcut modifier (aktif etkiler dahil)', 'Current API modifier (includes active effects)')}">${s.modifier >= 0 ? '+' : ''}${s.modifier}%</td><td class="num tq-text" title="${s.noXanaxModifier ?? '—'}%">${n0(s.noXanax)}</td><td class="num" style="color:var(--warn)" title="${s.withXanaxModifier ?? '—'}%">${n0(s.withXanax)}</td></tr>`).join('')
  }</tbody>`;

  // drug max memory for ring
  const cd = o.drug.cooldown;
  let max = Number(localStorage.getItem('tt.drugMax')) || 0;
  if (!cd) max = 0; else if (cd > max) max = cd;
  localStorage.setItem('tt.drugMax', max);

  tick();
  renderWarMe();
  animateNumbers($('#view-overview'));
}

// Takip ekranı gerçekten görünüyor mu? (pencere küçültülmemiş ve bir Torn sekmesi üstünü kapatmıyor)
const trackerVisible = () => !document.hidden && state.activeWsTab === 'tracker';

function tick() {
  if (!trackerVisible()) return; // görünmezken sayaç güncellemek boşuna CPU
  const now = Date.now();
  // TCT clock
  $('#tct-clock').textContent = tctTime(nowTct());

  // day end (18:00 TCT daily company & Torn reset)
  const secOfDay = ((nowTct() / 1000) % 86400 + 86400) % 86400;
  const resetSec = 18 * 3600; // 18:00 TCT
  const left = secOfDay < resetSec ? (resetSec - secOfDay) : (86400 - secOfDay + resetSec);
  $('[data-timer="day"]').textContent = clock(left);
  $('[data-sub="day"]').textContent = `18:00 TCT · ${tr('yerel', 'local')} ${new Date(Date.now() + left * 1000).toLocaleTimeString(timeLocale(), { hour: '2-digit', minute: '2-digit' })}`;
  setRing('#t-day', left / 86400, false);

  // stock order delivery countdowns
  $$('[data-eta]').forEach((el) => {
    const rem = (Number(el.dataset.eta) - now) / 1000;
    el.textContent = rem > 0 ? clock(rem) : tr('Teslimatta', 'Arriving');
  });
  $$('[data-eta-bar]').forEach((el) => {
    const eta = Number(el.dataset.etaBar);
    const total = Number(el.dataset.etaTotal) || 6 * 3600_000;
    const rem = Math.max(0, eta - now);
    const pctDone = Math.max(5, Math.min(100, (1 - rem / total) * 100));
    el.style.width = pctDone + '%';
  });

  const o = state.overview;
  if (o) {
    const el = (now - state.overviewAt) / 1000;
    // drug
    const d = Math.max(0, o.drug.cooldown - el);
    const dv = $('[data-timer="drug"]');
    const max = Number(localStorage.getItem('tt.drugMax')) || 8 * 3600;
    if (d > 0) {
      dv.textContent = clock(d); dv.classList.remove('ready');
      const end = new Date(Date.now() + d * 1000).toLocaleTimeString(timeLocale(), { hour: '2-digit', minute: '2-digit' });
      $('[data-sub="drug"]').textContent = `${o.drug.xanaxActive ? tr('Xanax aktif', 'Xanax active') : (o.drug.icon ? decode(o.drug.icon).split(' - ')[1] || tr('Drug aktif', 'Drug active') : tr('Drug aktif', 'Drug active'))} · ${tr('biter', 'ends')} ${end}`;
      setRing('#t-drug', d / max, false);
    } else {
      dv.textContent = tr('HAZIR', 'READY'); dv.classList.add('ready');
      $('[data-sub="drug"]').textContent = tr('Xanax alabilirsin', 'Ready to take Xanax');
      setRing('#t-drug', 1, true);
    }
    // education
    const e = Math.max(0, o.education.timeLeft - el);
    const ev = $('[data-timer="edu"]');
    if (o.education.currentId && e > 0) {
      ev.textContent = clock(e); ev.classList.remove('ready');
      $('[data-sub="edu"]').textContent = `${o.education.current}${o.education.code ? ' · ' + o.education.code : ''}`;
      setRing('#t-edu', o.education.duration ? e / o.education.duration : 0.5, false);
    } else {
      ev.textContent = tr('BOŞTA', 'IDLE'); ev.classList.add('ready');
      $('[data-sub="edu"]').textContent = `${tr('Yeni kurs başlat', 'Start a new course')} · ${o.education.completed}${o.education.totalCourses ? '/' + o.education.totalCourses : ''} ${tr('tamamlandı', 'completed')}`;
      setRing('#t-edu', 1, true);
    }
    // cooldown chips
    for (const k of ['booster', 'medical']) {
      const elc = $(`[data-cd="${k}"]`);
      if (elc && o.cooldowns[k]) { const r = o.cooldowns[k] - el; elc.textContent = r > 0 ? clock(r) : tr('yok', 'none'); }
    }
  }
  // hospital countdowns in war table
  $$('[data-until]').forEach((x) => {
    const r = Number(x.dataset.until) - nowTct() / 1000;
    x.textContent = r > 0 ? (x.dataset.short ? shortClock(r) : clock(r)) : tr('çıktı', 'out');
  });
}

/* =========================================================
   COMPANY (stock / report / employees / income)
   ========================================================= */
/* Şirket sekmeleri yalnızca şirket direktörleri için.
   Profildeki iş pozisyonu Director değilse ya da şirket API'si yetki hatası verirse gizlenir. */
const COMPANY_VIEWS = ['stock', 'report', 'employees', 'income'];
const NOT_DIRECTOR_CODES = [6, 7, 16]; // Incorrect ID · ID-entity relation · access level
state.companyMode = (() => { try { return localStorage.getItem('tt.cache.companyMode') !== 'off'; } catch { return true; } })();

function jobLabel(j) {
  if (!j) return '—';
  if (Number(j.company_id) > 0) return [j.position, j.company_name].filter((x) => x && x !== 'None').map(decode).join(' · ');
  if (j.job && j.job !== 'None') return [j.job, j.position !== j.job ? j.position : null].filter((x) => x && x !== 'None').map(decode).join(' · ');
  return tr('İşsiz', 'No job');
}
function directorKnown() {
  const j = state.overview?.player?.job;
  if (!j) return null;
  return j.position === 'Director' && Number(j.company_id) > 0;
}
function applyCompanyMode(on) {
  state.companyMode = on;
  try { localStorage.setItem('tt.cache.companyMode', on ? 'on' : 'off'); } catch {}
  const vis = on && (typeof feat !== 'function' || feat('page.company'));
  for (const v of COMPANY_VIEWS) { const b = $(`.nav-item[data-view="${v}"]`); if (b) b.hidden = !vis; }
  const ov = $('#ov-company'); if (ov) ov.hidden = !vis;
  if (!on) {
    setAlert('company', null);
    state.company = null;
    try { localStorage.removeItem('tt.cache.company'); } catch {}
    if (COMPANY_VIEWS.includes(state.view)) { showView('overview'); try { history.replaceState(null, '', '#overview'); } catch {} }
  }
}
function syncCompanyMode() {
  const j = state.overview?.player?.job;
  const coBtn = $('.ws-quick-btn[data-open-url="https://www.torn.com/companies.php"]');
  if (coBtn && j) coBtn.hidden = !(Number(j.company_id) > 0);
  window.applyNavVisibility?.(); // İş Asistanı: işi varsa gizle
  const d = directorKnown();
  if (d === false && state.companyMode) applyCompanyMode(false);
  else if (d === true && !state.companyMode) { applyCompanyMode(true); loadCompany(true); }
}

async function loadCompany(force = false) {
  if (directorKnown() === false) { if (state.companyMode) applyCompanyMode(false); return; }
  try {
    const c = await api('/api/company' + (force ? '?force=1' : ''));
    state.company = c;
    try { localStorage.setItem('tt.cache.company', JSON.stringify(c)); } catch {}
    setAlert('company', null);
    if (!state.companyMode) applyCompanyMode(true);
    renderCompany();
  } catch (e) {
    if (NOT_DIRECTOR_CODES.includes(Number(e.code))) { applyCompanyMode(false); return; }
    if (!state.company) {
      setAlert('company', `<b>${tr('Şirket verisi alınamadı:', 'Failed to load company data:')}</b>&nbsp;${esc(e.message)} <span class="muted">${tr('(Stok ve detaylar için şirket direktörü olmalısın.)', '(You need to be a company director to see stock and details.)')}</span>`, 'warn');
    }
  }
}

const statusLabel = (s) => ({
  critical: [tr('Kritik', 'Critical'), 'danger'],
  low: [tr('Düşük', 'Low'), 'warn'],
  ok: [tr('İyi', 'Good'), 'green'],
  over: [tr('Fazla', 'Excess'), 'blue'],
}[s] || [s, 'dim']);

const daysTxt = (d) => (d == null ? '∞' : d >= 100 ? '99+' : d.toFixed(1));
const hoursTxt = (h) => {
  if (h == null || !isFinite(h)) return '∞';
  const tot = Math.max(0, Math.round(h));
  return `${tot}${tr('sa', 'h')}`;
};

function renderCompany() {
  const c = state.company; if (!c) return;
  renderOverviewCompany(c);
  renderStock(c);
  renderReport(c);
  renderEmployees(c);
  renderIncome(c);
  $('#cover-days').value = String(c.coverDays);
  const bad = c.products.filter((p) => p.status === 'critical' || p.status === 'low').length;
  $('#badge-stock').hidden = !bad; $('#badge-stock').textContent = bad;
  const addCrit = c.employees.filter((e) => e.addiction <= -8).length;
  const addWarn = c.employees.filter((e) => e.addiction <= -5).length;
  const badgeVal = addCrit || addWarn;
  $('#badge-emp').hidden = !badgeVal; $('#badge-emp').textContent = badgeVal;
  tick();
  animateNumbers();
}

function kpi(label, value, hint = '', cls = '') {
  return `<div class="glass kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}

function renderOverviewCompany(c) {
  const alertsP = c.products.filter((p) => p.status === 'critical' || p.status === 'low');
  const critAddicts = c.employees.filter((e) => e.addiction <= -8);
  const warnAddicts = c.employees.filter((e) => e.addiction <= -5);
  $('#ov-company').innerHTML = `
    <article class="glass card">
      <div class="card-head"><h3>${esc(c.company.name)}</h3><span class="chip tq">${'★'.repeat(c.company.rating || 0)}</span></div>
      <span class="eyebrow">${tr('Son gün gelir (18:00 TCT)', "Last day's revenue (18:00 TCT)")}</span>
      <div class="big-num">${money(c.company.dailyIncome)}</div>
      <div class="ov-list">
        <div><span class="muted">${tr('Net kâr (tahmini)', 'Net profit (est.)')}</span><span class="mono ${c.income.net >= 0 ? 'pos' : 'neg'}">${money(c.income.net)}</span></div>
        <div><span class="muted">${tr('Müşteri', 'Customers')}</span><span class="mono">${n0(c.company.dailyCustomers)}</span></div>
        <div><span class="muted">${tr('7 gün gelir', '7-day revenue')}</span><span class="mono">${money(c.company.weeklyIncome)}</span></div>
        <div><span class="muted">${tr('Şirket fonu', 'Company funds')}</span><span class="mono">${money(c.company.funds)}</span></div>
      </div>
    </article>
    <article class="glass card">
      <div class="card-head"><h3>${tr('Stok & Sipariş Süreleri', 'Stock & Order Timers')}</h3><span class="chip ${alertsP.length ? 'warn' : 'green'}">${alertsP.length ? alertsP.length + tr(' ürün düşük', ' low on stock') : tr('Hepsi iyi', 'All good')}</span></div>
      <div class="ov-list">${c.products.map((p) => {
        const od = p.orderDelivery;
        const eta = od ? `<span class="mono tq-text" data-eta="${od.etaMs}">—</span>` : `<span class="muted">${tr('yok', 'none')}</span>`;
        const [, sCls] = statusLabel(p.status);
        return `<div><span>${esc(p.name)} <span class="sub-text">(${hoursTxt(p.hoursLeft)} ${tr('stok', 'stock')})</span></span><span><span class="sub-text">${tr('teslim:', 'ETA:')}</span> ${eta} &nbsp;<span class="chip ${sCls}">${daysTxt(p.daysLeftWithOrder)}${tr('g', 'd')}</span></span></div>`;
      }).join('')}</div>
    </article>
    <article class="glass card">
      <div class="card-head"><h3>Addiction & Rehab</h3><span class="chip ${critAddicts.length ? 'danger' : warnAddicts.length ? 'orange' : 'green'}">${critAddicts.length ? critAddicts.length + tr(' kişi ≤ -8 (Rehab)', ' at ≤ -8 (Rehab)') : warnAddicts.length ? warnAddicts.length + tr(' kişi ≤ -5', ' at ≤ -5') : tr('Temiz', 'Clean')}</span></div>
      <div class="ov-list">${c.employees.slice(0, 6).map((e) => `<div><span>${esc(e.name)} <span class="sub-text">${esc(e.position)}</span></span><span style="display:inline-flex;align-items:center;gap:6px">${addictionChip(e.addiction)}${e.addiction < 0 ? `<button class="btn sm ghost" data-copy-rehab="${e.id}" title="${tr('Rehab mesajını kopyala (EN)', 'Copy Rehab message (EN)')}">📋</button>` : ''}</span></div>`).join('')}</div>
    </article>`;
}

/* ---------- Stock ---------- */
function renderStock(c) {
  const s = c.storage;
  const onOrderProds = c.products.filter((p) => p.on_order > 0 && p.orderDelivery)
    .sort((a, b) => a.orderDelivery.etaMs - b.orderDelivery.etaMs);
  const firstEta = onOrderProds[0]?.orderDelivery;
  const estH = c.estDeliveryHours || c.deliveryHours || 6;
  const etaHint = (od) => (od.source === 'torn' ? tr('Torn sayacı ✓', 'Torn timer ✓')
    : od.mode === '18tct' ? tr('tahmini · 18:00 TCT', 'estimate · 18:00 TCT')
      : `${tr('tahmini', 'estimate')} · ${od.deliveryHours}${tr('sa kargo', 'h transit')}`);
  const hasEstimates = onOrderProds.some((p) => p.orderDelivery.source !== 'torn');
  const canSync = !!window.electronAPI?.tabCreate;
  const seenAt = c.deliveriesSeenAt ? new Date(c.deliveriesSeenAt).toLocaleTimeString(timeLocale(), { hour: '2-digit', minute: '2-digit' }) : null;
  $('#stock-kpis').innerHTML = [
    kpi(tr('Stoktaki ürün', 'In stock'), n0(c.totals.inStock), `${c.products.length} ${tr('çeşit', c.products.length === 1 ? 'product' : 'products')}`),
    kpi(tr('Siparişte (Yolda)', 'On order (in transit)'), n0(c.totals.onOrder), firstEta ? `${tr('Teslim', 'ETA')}: ${firstEta.source === 'torn' ? '' : '~'}${new Date(firstEta.etaMs).toLocaleTimeString(timeLocale(), { hour: '2-digit', minute: '2-digit' })}` : tr('aktif sipariş yok', 'no active orders')),
    kpi(tr('İlk teslimat', 'First delivery'), firstEta ? `<span data-eta="${firstEta.etaMs}">${clock((firstEta.etaMs - Date.now()) / 1000)}</span>` : '—', firstEta ? etaHint(firstEta) : tr('Sipariş yok', 'No orders'), 'tq'),
    kpi(tr('Depo doluluğu', 'Storage used'), s.space ? pct(s.used / s.space) : '—', s.space ? `${n0(s.free)} ${tr('boş alan', 'free space')}` : ''),
    kpi(tr('Şirket fonu', 'Company funds'), cmoney(c.company.funds), `${tr('Reklam', 'Ads')} ${cmoney(c.company.ads)}/${tr('gün', 'day')}`),
  ].join('');

  // Delivery tracking card
  $('#delivery-card').innerHTML = `
    <div class="card-head wrap">
      <div>
        <h3>🚚 ${tr('Sipariş Zamanı', 'Order Timing')}</h3>
        <span class="muted">${onOrderProds.length ? tr(`${onOrderProds.length} üründe toplam ${n0(c.totals.onOrder)} adet sipariş yolda · Şirket gün sonu: 18:00 TCT (<span class="mono" data-eta="${c.nextResetMs}">—</span> kaldı)`, `${n0(c.totals.onOrder)} units on order across ${onOrderProds.length} ${onOrderProds.length === 1 ? 'product' : 'products'} · Company reset: 18:00 TCT (<span class="mono" data-eta="${c.nextResetMs}">—</span> left)`) : tr('Şu an yolda olan sipariş bulunmuyor.', 'No stock orders currently in transit.')}</span>
        ${onOrderProds.length ? `<div class="sub-text" style="margin-top:4px">${hasEstimates
          ? `⚠ ${tr('Süreler tahmini. Kesin süre için Torn\'da şirket stok sayfasını aç; LRX "Delivered in" sayaçlarını otomatik okur.', 'Times are estimates. For exact times, open the company stock page in Torn; LRX reads the "Delivered in" timers automatically.')}`
          : `✓ ${tr(`Süreler Torn'un kendi sayacından${seenAt ? ` (okundu ${seenAt})` : ''}`, `Times from Torn's own timers${seenAt ? ` (read ${seenAt})` : ''}`)}`}</div>` : ''}
      </div>
      <div class="delivery-controls">
        ${canSync ? `<button class="btn sm ${hasEstimates ? 'primary' : ''}" data-stock-torn-sync>🔄 ${tr('Torn\'dan kesin süreyi al', 'Get exact times from Torn')}</button>` : ''}
        <span class="sub-text">${tr('Elle senkronize et:', 'Manual sync:')}</span>
        <button class="btn sm ${!canSync && c.deliveryMode !== '18tct' ? 'primary' : ''}" data-order-sync="0">${tr(`Şimdi verdim (${estH}sa)`, `Just ordered (${estH}h)`)}</button>
        <button class="btn sm" data-order-sync="1">${tr('1sa önce', '1h ago')}</button>
        <button class="btn sm" data-order-sync="2">${tr('2sa önce', '2h ago')}</button>
        <button class="btn sm" data-order-sync="3">${tr('3sa önce', '3h ago')}</button>
        <button class="btn sm" data-order-sync="4">${tr('4sa önce', '4h ago')}</button>
        <button class="btn sm ${c.deliveryMode === '18tct' ? 'primary' : ''}" data-order-mode="18tct" title="${tr('18:00 TCT günlük şirket yenilenmesine göre sayaç', 'Timer anchored to 18:00 TCT daily company reset')}">18:00 TCT</button>
      </div>
    </div>`;

  const total = s.space || c.totals.inStock + c.totals.onOrder || 1;
  $('#storage-label').textContent = s.space ? `${n0(s.used)} / ${n0(s.space)}` : n0(s.used);
  $('#storage-bar').innerHTML = c.products.map((p, i) => {
    const col = PALETTE[i % PALETTE.length];
    return `<i style="width:${(p.in_stock / total) * 100}%;background:${col}" title="${esc(p.name)} ${tr('stok', 'stock')}: ${n0(p.in_stock)}"></i>` +
      `<i style="width:${(p.on_order / total) * 100}%;background:repeating-linear-gradient(45deg, ${col}55 0 4px, ${col}22 4px 8px)" title="${esc(p.name)} ${tr('sipariş', 'on order')}: ${n0(p.on_order)}"></i>`;
  }).join('');
  $('#storage-legend').innerHTML = c.products.map((p, i) => `<span><b style="background:${PALETTE[i % PALETTE.length]}"></b>${esc(p.name)}</span>`).join('') + `<span class="muted">· ${tr('taralı = siparişte', 'striped = on order')}</span>`;

  $('#product-cards').innerHTML = c.products.map((p, i) => {
    const [lbl, cls] = statusLabel(p.status);
    const col = PALETTE[i % PALETTE.length];
    const cap = Math.max(p.in_stock + p.on_order, p.target, 1);
    const od = p.orderDelivery;
    return `<article class="glass product">
      <div class="product-top"><div><h4><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${col};margin-right:7px;vertical-align:middle"></span>${esc(p.name)}</h4><small>${tr('Fiyat', 'Price')} ${money(p.price)} · RRP ${money(p.rrp)} · ${tr('Maliyet', 'Cost')} ${money(p.cost)}</small></div><span class="chip ${cls}">${lbl}</span></div>
      <div class="stock-gauge"><i style="width:${(p.in_stock / cap) * 100}%;background:${col}"></i><i style="width:${(p.on_order / cap) * 100}%;background:${col}44"></i></div>
      <div class="pgrid">
        <div><small>${tr('Stokta', 'In Stock')}</small><strong>${n0(p.in_stock)}</strong></div>
        <div><small>${tr('Siparişte', 'On Order')}</small><strong>${n0(p.on_order)}</strong></div>
        <div><small>${tr('Ort. satış / gün', 'Avg. Sales / Day')}</small><strong>${n0(p.avgDaily)}</strong></div>
        <div><small>${tr('Son gün satış', 'Last Day Sales')}</small><strong>${n0(p.sold_amount)}</strong></div>
        <div><small>${tr('Stok süresi', 'Stock Duration')}</small><strong>${daysTxt(p.daysLeft)}${tr('g', 'd')} <span class="muted">(${hoursTxt(p.hoursLeft)})</span></strong></div>
        <div><small>${tr('+ Sipariş ile', '+ With Order')}</small><strong>${daysTxt(p.daysLeftWithOrder)}${tr('g', 'd')} <span class="muted">(${hoursTxt(p.hoursLeftWithOrder)})</span></strong></div>
      </div>
      <div class="product-delivery">
        ${od ? `<div class="pd-row"><span>🚚 ${tr('Teslimata kalan', 'Delivery ETA')} <span class="chip tq mono">+${n0(p.on_order)}</span></span><strong class="mono tq-text" data-eta="${od.etaMs}">${clock((od.etaMs - Date.now()) / 1000)}</strong></div>
          <div class="bar" style="height:4px;margin-top:6px"><i data-eta-bar="${od.etaMs}" data-eta-total="${od.cycleTotalMs}" style="width:50%;background:var(--tq)"></i></div>
          <div class="pd-row" style="margin-top:7px"><span class="sub-text">${tr('Varış', 'Arrives')} <b class="mono">${od.source === 'torn' ? '' : '~'}${new Date(od.etaMs).toLocaleTimeString(timeLocale(), { hour: '2-digit', minute: '2-digit' })}</b> · ${etaHint(od)}</span><span class="chip ${od.safeUntilDelivery ? 'green' : 'danger'}">${od.safeUntilDelivery ? tr('Yeterli ✓', 'Safe ✓') : tr('Önce biter ⚠', 'Runs out ⚠')}</span></div>` : `<div class="pd-row"><span class="muted">${tr('Yolda sipariş yok', 'No order in transit')}</span><span class="muted">—</span></div>`}
      </div>
      <div class="product-foot"><span class="muted">${tr('Önerilen sipariş', 'Suggested order')}</span>${p.need ? `<strong class="tq-text mono">${n0(p.need)} ${tr('adet', 'units')} · ${cmoney(p.orderCost)}</strong>` : `<span class="chip green">${tr('Gerek yok', 'None needed')}</span>`}</div>
    </article>`;
  }).join('');
}

/* ---------- Report ---------- */
function renderReport(c) {
  const t = c.totals;
  $('#report-date').textContent = `${c.company.name} · ${tctDateStr(nowTct())} (${tr('18:00 TCT Döngüsü', '18:00 TCT Cycle')})`;
  const samples = Math.max(...c.products.map((p) => p.samples), 0);
  $('#report-note').textContent = tr(
    `Ortalama satış ${samples || 1} günlük kayıttan hesaplandı · Hedef: ${c.coverDays} günlük stok · Sonraki yenilenme: 18:00 TCT${c.storage.limited ? ' · ⚠ Depo kapasitesi nedeniyle siparişler orantılı azaltıldı' : ''}`,
    `Average sales based on ${samples || 1} daily ${(samples || 1) === 1 ? 'record' : 'records'} · Target: ${c.coverDays} ${Number(c.coverDays) === 1 ? 'day' : 'days'} of stock · Next reset: 18:00 TCT${c.storage.limited ? ' · ⚠ Orders scaled down to fit storage capacity' : ''}`
  );
  $('#report-kpis').innerHTML = [
    kpi(tr('Satılan ürün', 'Units sold'), n0(t.sold), `${n0(c.company.dailyCustomers)} ${tr('müşteri', 'customers')}`),
    kpi(tr('Gelir', 'Revenue'), money(t.revenue), '', 'tq'),
    kpi(tr('Ürün maliyeti', 'COGS'), money(t.cogs), pct(t.revenue ? t.cogs / t.revenue : 0) + tr(' gelirin', ' of revenue')),
    kpi(tr('Brüt kâr', 'Gross profit'), money(t.profit), pct(t.revenue ? t.profit / t.revenue : 0) + tr(' marj', ' margin'), t.profit >= 0 ? 'pos' : 'neg'),
    kpi(tr('Verilecek sipariş', 'Order to place'), n0(t.need) + ' ' + tr('adet', 'units'), money(t.orderCost) + (c.company.funds != null && t.orderCost > c.company.funds ? tr(' · fon yetersiz!', ' · insufficient funds!') : '')),
  ].join('');

  $('#report-table').innerHTML = `<thead><tr>
      <th>${tr('Ürün', 'Product')}</th><th class="num">${tr('Satılan', 'Sold')}</th><th class="num">${tr('Ort./gün', 'Avg/day')}</th><th class="num">${tr('Ort. fiyat', 'Avg price')}</th><th class="num">${tr('Gelir', 'Revenue')}</th>
      <th class="num">${tr('Maliyet', 'COGS')}</th><th class="num">${tr('Kâr', 'Profit')}</th><th class="num">${tr('Marj', 'Margin')}</th><th class="num">${tr('Stok', 'Stock')}</th><th class="num">${tr('Sipariş', 'On Order')}</th><th class="num">${tr('Sipariş Teslim', 'Delivery ETA')}</th><th class="num">${tr('Toplam Süre', 'Total Duration')}</th><th class="num">${tr('Önerilen', 'Suggested')}</th><th>${tr('Durum', 'Status')}</th>
    </tr></thead><tbody>${c.products.map((p, i) => {
      const [sLbl, sCls] = statusLabel(p.status);
      return `<tr>
      <td><b style="color:${PALETTE[i % PALETTE.length]}">●</b> ${esc(p.name)}</td>
      <td class="num">${n0(p.sold_amount)}</td><td class="num muted">${n0(p.avgDaily)}</td><td class="num">${money(p.avgPrice)}</td>
      <td class="num">${money(p.sold_worth)}</td><td class="num muted">${money(p.cogs)}</td><td class="num ${p.profit >= 0 ? 'pos' : 'neg'}">${money(p.profit)}</td>
      <td class="num">${pct(p.margin)}</td><td class="num">${n0(p.in_stock)} <span class="sub-text">(${hoursTxt(p.hoursLeft)})</span></td><td class="num muted">${n0(p.on_order)}</td>
      <td class="num">${p.orderDelivery ? `<span class="mono tq-text" data-eta="${p.orderDelivery.etaMs}">${clock((p.orderDelivery.etaMs - Date.now()) / 1000)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="num">${daysTxt(p.daysLeftWithOrder)}${tr('g', 'd')} <span class="sub-text">(${hoursTxt(p.hoursLeftWithOrder)})</span></td><td class="num tq-text"><b>${p.need ? n0(p.need) : '—'}</b></td>
      <td><span class="chip ${sCls}">${sLbl}</span></td></tr>`;
    }).join('')}
    </tbody><tfoot><tr><td>${tr('Toplam', 'Total')}</td><td class="num">${n0(t.sold)}</td><td></td><td></td><td class="num">${money(t.revenue)}</td><td class="num">${money(t.cogs)}</td>
      <td class="num pos">${money(t.profit)}</td><td class="num">${pct(t.revenue ? t.profit / t.revenue : 0)}</td><td class="num">${n0(t.inStock)}</td><td class="num">${n0(t.onOrder)}</td><td></td><td></td><td class="num tq-text">${n0(t.need)}</td><td></td></tr></tfoot>`;

  $('#order-total').textContent = t.need ? `${n0(t.need)} ${tr('adet', 'units')} · ${money(t.orderCost)}` : tr('Sipariş gerekmiyor', 'No order needed');
  $('#order-list').innerHTML = c.products.map((p) => `<div class="order-item ${p.need ? 'need' : ''}">
      <div><strong>${esc(p.name)}</strong><div class="sub-text">${n0(p.in_stock + p.on_order)} ${tr('mevcut', 'available')} (${hoursTxt(p.hoursLeftWithOrder)}) · ${tr('hedef', 'target')} ${n0(p.target)}</div></div>
      <div class="qty">${p.need ? n0(p.need) : '0'}<small>${p.need ? money(p.orderCost) : tr('yeterli', 'sufficient')}</small></div></div>`).join('');
}

function reportText(c) {
  const L = [];
  L.push(`📦 ${decode(c.company.name)} – ${tr('Günlük Rapor', 'Daily Report')} (${tctDateStr(nowTct())} · 18:00 TCT)`);
  L.push(`${tr('Gelir', 'Revenue')}: ${money(c.totals.revenue)} | ${tr('Müşteri', 'Customers')}: ${n0(c.company.dailyCustomers)} | ${tr('Brüt kâr', 'Gross profit')}: ${money(c.totals.profit)} | Net: ${money(c.income.net)}`);
  L.push('');
  L.push(tr('Satışlar & Stok Süreleri:', 'Sales & Stock Duration:'));
  c.products.forEach((p) => {
    const eta = p.orderDelivery ? ` · ${tr('teslimata', 'ETA')} ${clock((p.orderDelivery.etaMs - Date.now()) / 1000)}` : '';
    L.push(`• ${p.name}: ${n0(p.sold_amount)} ${tr('satıldı', 'sold')} (${money(p.sold_worth)}) · ${tr('stok', 'stock')} ${n0(p.in_stock)} (${hoursTxt(p.hoursLeft)}) + ${n0(p.on_order)} ${tr('siparişte', 'on order')}${eta} -> ${tr('toplam', 'total')} ${daysTxt(p.daysLeftWithOrder)} ${tr('gün', 'days')} (${hoursTxt(p.hoursLeftWithOrder)})`);
  });
  L.push('');
  L.push(tr(`Sipariş (${c.coverDays} günlük hedef):`, `Restock Order (${c.coverDays}-day target):`));
  const need = c.products.filter((p) => p.need);
  if (!need.length) L.push(tr('• Sipariş gerekmiyor ✅', '• No order needed ✅'));
  need.forEach((p) => L.push(`• ${p.name}: ${n0(p.need)} ${tr('adet', 'units')} (${money(p.orderCost)})`));
  if (need.length) L.push(`${tr('Toplam', 'Total')}: ${n0(c.totals.need)} ${tr('adet', 'units')} · ${money(c.totals.orderCost)}`);
  return L.join('\n');
}
$('#copy-report').addEventListener('click', async () => {
  if (!state.company) return;
  await copyText(reportText(state.company), tr('Rapor panoya kopyalandı', 'Report copied to clipboard'));
});
$('#cover-days').addEventListener('change', async (e) => {
  await api('/api/config', { method: 'POST', body: JSON.stringify({ coverDays: Number(e.target.value) }) });
  await loadCompany(); toast(tr(`Hedef stok: ${e.target.value} gün`, `Target stock: ${e.target.value} ${e.target.value === '1' ? 'day' : 'days'}`));
});

/* ---------- Employees & Rehab Messages ---------- */
function addictionChip(v) {
  if (v >= 0) return `<span class="chip green">${tr('Temiz', 'Clean')}</span>`;
  if (v > -5) return `<span class="chip warn">${v}</span>`;
  if (v > -8) return `<span class="chip orange">${v} · ${tr('Uyarı', 'Warning')}</span>`;
  return `<span class="chip danger">${v} · ${tr('Rehab Şart', 'Rehab Now')}</span>`;
}
function sparkline(arr) {
  if (!arr || arr.length < 2) return `<span class="sub-text">${tr('veri birikiyor', 'collecting data')}</span>`;
  const vals = arr.map((a) => a.value); const min = Math.min(...vals, -1), max = Math.max(...vals, 0);
  const W = 90, H = 26, step = W / (vals.length - 1);
  const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(H - 3 - ((v - min) / (max - min || 1)) * (H - 6)).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}"><path d="M${pts.join(' L')}"/></svg>`;
}
function renderEmployees(c) {
  const e = c.employees;
  const eff = e.map((x) => x.effectiveness.total || 0);
  const critList = e.filter((x) => x.addiction <= -8);
  const warnList = e.filter((x) => x.addiction <= -5);
  const anyAddict = e.filter((x) => x.addiction < 0);

  $('#emp-kpis').innerHTML = [
    kpi(tr('Çalışan', 'Employees'), `${c.company.hired}/${c.company.capacity}`),
    kpi(tr('Günlük maaş', 'Daily wages'), money(c.income.wages)),
    kpi(tr('Ort. effectiveness', 'Avg. effectiveness'), n0(eff.length ? eff.reduce((a, b) => a + b, 0) / eff.length : 0), '', 'tq'),
    kpi(tr('Addiction olan', 'With addiction'), anyAddict.length, tr(`toplam ${e.reduce((a, x) => a + x.addiction, 0)} puan kayıp`, `${e.reduce((a, x) => a + x.addiction, 0)} total points lost`)),
    kpi(tr('Rehab gereken (≤ -8)', 'Needs Rehab (≤ -8)'), critList.length, critList.length ? tr('Hemen mesaj gönder!', 'Send a message now!') : tr(`${warnList.length} kişi -5..-7 arasında`, `${warnList.length} between -5 and -7`), critList.length ? 'neg' : warnList.length ? 'tq' : 'pos'),
  ].join('');

  // Filter targets for rehab message generator
  let msgTargets = critList;
  let autoNote = '';
  if (state.rehabFilter === 'crit') {
    if (!critList.length && anyAddict.length) {
      msgTargets = anyAddict;
      autoNote = tr(
        `Şu an <b>-8 ve altında</b> kritik çalışan yok (en yüksek: <b>${esc(anyAddict[0].name)} ${anyAddict[0].addiction}</b>). İstersen aşağıdan mevcut addiction'lı çalışanlara erken uyarı mesajı (İngilizce) atabilir veya -8 şablonunu kullanabilirsin.`,
        `No employees are currently at <b>-8 or worse</b> (highest: <b>${esc(anyAddict[0].name)} ${anyAddict[0].addiction}</b>). Showing employees with negative addiction below so you can send an early reminder if needed.`
      );
    }
  } else if (state.rehabFilter === 'warn') {
    msgTargets = warnList.length ? warnList : anyAddict;
  } else {
    msgTargets = anyAddict;
  }

  $('#rehab-card').innerHTML = `
    <div class="card-head wrap">
      <div>
        <h3>💬 ${tr('Rehab Mesaj Oluşturucu (-8 ve Sonrası Kritik · EN)', 'Rehab Message Generator (-8 or worse is critical · EN)')}</h3>
        <span class="muted">${tr('Addiction yüksek çalışanlara tek tıkla kopyalayıp Torn üzerinden gönderebileceğin hazır İngilizce mesajlar', 'Ready-made English messages for employees with high addiction: copy one or send it through Torn in one click')}</span>
      </div>
      <div class="rehab-tools">
        <div class="toggle" id="rehab-filter-toggle">
          <button data-rf="crit" class="${state.rehabFilter === 'crit' ? 'active' : ''}">${tr('Kritik', 'Critical')} (≤ -8) [${critList.length}]</button>
          <button data-rf="warn" class="${state.rehabFilter === 'warn' ? 'active' : ''}">${tr('Uyarı', 'Warning')} (≤ -5) [${warnList.length}]</button>
          <button data-rf="all" class="${state.rehabFilter === 'all' ? 'active' : ''}">${tr('Tümü', 'All')} (&lt; 0) [${anyAddict.length}]</button>
        </div>
      </div>
    </div>

    <div class="rehab-tpl-bar">
      <div class="rehab-presets">
        <span class="sub-text">${tr('Şablon (EN):', 'Template (EN):')}</span>
        <button class="btn sm ${state.rehabTplKey === 'en_polite' ? 'primary' : ''}" data-tpl="en_polite">${tr('EN · Kibar (Varsayılan)', 'EN · Polite (Default)')}</button>
        <button class="btn sm ${state.rehabTplKey === 'en_firm' ? 'primary' : ''}" data-tpl="en_firm">${tr('EN · Acil (-8 Kritik)', 'EN · Urgent (-8 Critical)')}</button>
        <button class="btn sm ${state.rehabTplKey === 'en_short' ? 'primary' : ''}" data-tpl="en_short">${tr('EN · Kısa & Samimi', 'EN · Short & Casual')}</button>
      </div>
      <div class="rehab-custom">
        <input class="input" id="rehab-tpl-input" value="${esc(state.rehabTpl)}" placeholder="${tr('Mesaj şablonu ({name} ve {addiction} otomatik doldurulur)', 'Message template ({name} and {addiction} are filled in automatically)')}" />
      </div>
    </div>

    ${autoNote ? `<div class="alert info" style="margin-bottom:12px"><div>${autoNote}<br><span class="sub-text">${tr('Örnek -8 mesajı:', 'Sample -8 message:')} "${esc(formatRehabMsg('Player', -8))}"</span></div></div>` : ''}

    ${msgTargets.length ? `<div class="rehab-grid">${msgTargets.map((x) => {
      const msg = formatRehabMsg(x.name, x.addiction);
      const isCrit = x.addiction <= -8;
      const inSwitz = /switzerland/i.test(x.status?.description || '');
      return `<div class="rehab-item ${isCrit ? 'crit' : ''}">
        <div class="rehab-item-head">
          <div>
            <a href="https://www.torn.com/profiles.php?XID=${x.id}" target="_blank" rel="noopener"><strong>${esc(x.name)}</strong></a>
            <span class="sub-text">[${x.id}] · ${esc(x.position)}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            ${inSwitz ? `<span class="chip blue">✈ ${tr("İsviçre'de", 'In Switzerland')}</span>` : ''}
            ${addictionChip(x.addiction)}
          </div>
        </div>
        <div class="rehab-msg-box" data-emp-msg="${x.id}">${esc(msg)}</div>
        <div class="rehab-actions">
          <button class="btn sm" data-copy-rehab="${x.id}">📋 ${tr('Mesajı Kopyala', 'Copy Message')}</button>
          <button class="btn sm primary" data-send-rehab="${x.id}" title="${tr('Torn private chat üzerinden gönder', 'Send via Torn private chat')}">💬 ${tr('Chat ile Gönder', 'Send via Chat')}</button>
        </div>
      </div>`;
    }).join('')}</div>` : `<div class="empty-state">${tr('Addiction değeri negatif olan çalışan bulunmuyor.', 'No employees with negative addiction.')}</div>`}`;

  const effParts = [['working_stats', '#c9a96a'], ['settled_in', '#d4d9df'], ['merits', '#3d78c9'], ['director_education', '#607d8b'], ['management', '#26b880']];
  const effNames = { working_stats: tr('Çalışma statları', 'Working stats'), settled_in: tr('Alışma', 'Settled in'), merits: 'Merits', director_education: tr('Direktör eğitimi', 'Director education'), management: tr('Yönetim', 'Management') };
  $('#emp-table').innerHTML = `<thead><tr><th>${tr('Çalışan', 'Employee')}</th><th>${tr('Durum', 'Status')}</th><th>${tr('Son aktivite', 'Last action')}</th><th class="num">${tr('Gün', 'Days')}</th><th class="num">${tr('Maaş', 'Wage')}</th><th class="num">MAN / INT / END</th><th>Effectiveness</th><th>Addiction</th><th>${tr('Trend (14g)', 'Trend (14d)')}</th><th class="num">${tr('İnaktif', 'Inactive')}</th><th>${tr('Rehab Mesajı', 'Rehab Message')}</th></tr></thead><tbody>${
    e.map((x) => {
      const si = statusInfo(x.status);
      const total = x.effectiveness.total || 0;
      const bar = effParts.map(([k, col]) => x.effectiveness[k] ? `<i style="width:${(x.effectiveness[k] / Math.max(total, 150)) * 100}%;background:${col}" title="${effNames[k] || k}: ${x.effectiveness[k]}"></i>` : '').join('');
      return `<tr>
        <td><div class="name-cell"><a href="https://www.torn.com/profiles.php?XID=${x.id}" target="_blank" rel="noopener">${esc(x.name)}</a></div><div class="sub-text">${esc(x.position)}</div></td>
        <td><span class="chip ${si.cls}" title="${esc(x.status?.description)}">${si.text}</span></td>
        <td>${lastActionChip(x.lastAction)}</td>
        <td class="num">${x.days}</td><td class="num">${money(x.wage)}</td>
        <td class="num muted">${compact(x.manual_labor, 1)} / ${compact(x.intelligence, 1)} / ${compact(x.endurance, 1)}</td>
        <td><div style="display:flex;align-items:center;gap:10px"><div class="eff-bar">${bar}</div><b class="mono">${total}</b></div></td>
        <td>${addictionChip(x.addiction)}</td>
        <td>${sparkline(x.addictionHistory)}</td>
        <td class="num ${x.inactivity < 0 ? 'neg' : 'muted'}">${x.inactivity || 0}</td>
        <td>${x.addiction < 0 ? `<div style="display:flex;gap:6px"><button class="btn sm ${x.addiction <= -8 ? 'primary' : ''}" data-copy-rehab="${x.id}" title="${esc(formatRehabMsg(x.name, x.addiction))}">📋 ${tr('Kopyala', 'Copy')}</button><button class="btn sm ghost" data-send-rehab="${x.id}" title="${tr('Torn private chat üzerinden gönder', 'Send via Torn private chat')}">💬 ${tr('Gönder', 'Send')}</button></div>` : '<span class="muted">—</span>'}</td></tr>`;
    }).join('')
  }</tbody>`;
}

/* ---------- Income ---------- */
function renderIncome(c) {
  const i = c.income;
  const gross = i.revenue - i.cogs;
  $('#pnl').innerHTML = `
    <div class="pnl-row"><span>${tr('Satış geliri', 'Sales revenue')}</span><span>${money(i.revenue)}</span></div>
    <div class="pnl-row minus"><span>${tr('Ürün maliyeti', 'Cost of goods (COGS)')}</span><span>-${money(i.cogs)}</span></div>
    <div class="pnl-row"><span><b>${tr('Brüt kâr', 'Gross profit')}</b></span><span><b>${money(gross)}</b></span></div>
    <div class="pnl-row minus"><span>${tr(`Maaşlar (${c.employees.length} çalışan)`, `Wages (${c.employees.length} ${c.employees.length === 1 ? 'employee' : 'employees'})`)}</span><span>-${money(i.wages)}</span></div>
    <div class="pnl-row minus"><span>${tr('Reklam bütçesi', 'Advertising budget')}</span><span>-${money(i.ads)}</span></div>
    <div class="pnl-row total ${i.net >= 0 ? 'pos' : 'neg'}"><span>${tr('Net kâr', 'Net profit')}</span><span>${money(i.net)}</span></div>
    <div class="pnl-row sub"><span>${tr('Müşteri (gün / hafta)', 'Customers (day / week)')}</span><span>${n0(i.customers)} / ${n0(i.weeklyCustomers)}</span></div>
    <div class="pnl-row sub"><span>${tr('7 günlük gelir · günlük ortalama', '7-day revenue · daily average')}</span><span>${money(i.weeklyRevenue)} · ${money(i.weeklyAvg)}</span></div>
    <div class="pnl-row sub"><span>${tr('Aylık net projeksiyon (×30)', 'Monthly net projection (×30)')}</span><span>${money(i.net * 30)}</span></div>`;

  // donut
  const prods = c.products.filter((p) => p.sold_worth > 0);
  const sum = prods.reduce((a, p) => a + p.sold_worth, 0) || 1;
  let acc = 0; const R = 70, C = 2 * Math.PI * R;
  const arcs = prods.map((p) => {
    const frac = p.sold_worth / sum, len = frac * C;
    const s = `<circle cx="90" cy="90" r="${R}" fill="none" stroke="${PALETTE[c.products.indexOf(p) % PALETTE.length]}" stroke-width="18" stroke-dasharray="${Math.max(0, len - 2)} ${C}" stroke-dashoffset="${-acc}" transform="rotate(-90 90 90)"/>`;
    acc += len; return s;
  }).join('');
  $('#donut').innerHTML = `<svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="${R}" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="18"/>${arcs}
      <text x="90" y="84" text-anchor="middle" fill="#829096" font-size="10" font-weight="600" letter-spacing="1.5" font-family="Inter">${tr('TOPLAM GELİR', 'TOTAL REVENUE')}</text>
      <text x="90" y="105" text-anchor="middle" fill="#eef2f3" font-size="17" font-weight="600" font-family="JetBrains Mono">${cmoney(sum)}</text></svg>
    <div class="donut-legend">${prods.map((p) => `<div><b style="background:${PALETTE[c.products.indexOf(p) % PALETTE.length]}"></b><span>${esc(p.name)}</span><span>${pct(p.sold_worth / sum, 1)}</span></div>`).join('')}</div>`;

  // chart
  const days = c.days.slice(-30);
  $('#hist-note').textContent = tr(`${c.days.length} gün kayıtlı`, `${c.days.length} ${c.days.length === 1 ? 'day' : 'days'} recorded`);
  incomeChartDays = days.length >= 2 ? days : null;
  if (incomeChartDays) renderIncomeChart();
  else $('#income-chart').innerHTML =
    `<div class="empty"><div><b class="tq-text">${tr('Geçmiş birikiyor', 'Building history')}</b><br>${tr('Sunucu açık kaldıkça her gün otomatik kayıt alınır.', 'Daily snapshots are recorded automatically while the app is running.')}<br><span class="muted">${tr('Şimdilik 7 günlük ortalama:', '7-day average for now:')} ${money(i.weeklyAvg)} / ${tr('gün', 'day')}</span></div></div>`;

  $('#income-table').innerHTML = `<thead><tr><th>${tr('Tarih', 'Date')}</th><th class="num">${tr('Müşteri', 'Customers')}</th><th class="num">${tr('Gelir', 'Revenue')}</th><th class="num">${tr('Ürün maliyeti', 'COGS')}</th><th class="num">${tr('Maaş', 'Wages')}</th><th class="num">${tr('Reklam', 'Ads')}</th><th class="num">Net</th><th class="num">${tr('Popülerlik', 'Popularity')}</th></tr></thead><tbody>${
    c.days.slice().reverse().map((d) => `<tr><td class="mono">${d.date}</td><td class="num">${n0(d.customers)}</td><td class="num">${money(d.revenue)}</td><td class="num muted">${money(d.cogs)}</td><td class="num muted">${money(d.wages)}</td><td class="num muted">${money(d.ads)}</td><td class="num ${d.net >= 0 ? 'pos' : 'neg'}">${money(d.net)}</td><td class="num">${d.popularity ?? '—'}</td></tr>`).join('')
  }</tbody>`;
}

/* ---------- Gelir Geçmişi grafiği ----------
   Gerçek piksel genişliğinde çizilir (esneme yok). Her gün: Gelir çubuğu + gider yığını
   (ürün maliyeti / maaş / reklam), net kâr çizgisi, sıfır çizgisi ve zarar bölgesi. */
let incomeChartDays = null, incomeChartW = 0;
const IC_COLORS = { rev: '#c9a96a', cogs: '#8f9aa6', wages: '#646e79', ads: '#3f4852', pos: '#5fd39a', neg: '#ef7d8f' };
function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1))));
  const m = x / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
function shortDate(iso) {
  const [, m, d] = String(iso).split('-');
  const tr_ = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const en_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(d)} ${(state.lang === 'en' ? en_ : tr_)[Number(m) - 1] || ''}`;
}
function renderIncomeChart() {
  const el = $('#income-chart');
  if (!el || !incomeChartDays) return;
  incomeChartW = el.clientWidth || incomeChartW || 900;
  el.innerHTML = incomeChart(incomeChartDays, Math.max(320, Math.round(incomeChartW)));
}
if (window.ResizeObserver && $('#income-chart')) {
  new ResizeObserver(() => {
    const w = $('#income-chart').clientWidth;
    if (w && Math.abs(w - incomeChartW) > 2) renderIncomeChart();
  }).observe($('#income-chart'));
}

function incomeChart(days, W) {
  const H = 290, pl = 66, pr = 14, pt = 22, pb = 34;
  const cost = (d) => (d.cogs || 0) + (d.wages || 0) + (d.ads || 0);
  const hi = Math.max(...days.map((d) => Math.max(d.revenue || 0, cost(d))), 1);
  const lo = Math.min(0, ...days.map((d) => d.net || 0));
  const step = niceStep((hi - lo) / 4);
  const top = Math.ceil(hi / step) * step, bot = Math.floor(lo / step) * step;
  const y = (v) => pt + ((top - v) / (top - bot || 1)) * (H - pt - pb);
  const gw = (W - pl - pr) / days.length;
  const bw = Math.max(4, Math.min(30, gw * 0.3));
  const showVals = gw >= 70;
  const mono = 'font-family="JetBrains Mono, monospace"';

  let grid = '';
  for (let v = bot; v <= top + 1e-6; v += step) {
    const zero = Math.abs(v) < 1e-6;
    grid += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="${zero ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.05)'}" ${zero ? '' : 'stroke-dasharray="3 4"'}/>`
      + `<text x="${pl - 10}" y="${y(v) + 4}" text-anchor="end" fill="${zero ? '#c3c9cf' : '#5f6870'}" font-size="11" ${mono}>${cmoney(v)}</text>`;
  }
  const lossZone = bot < 0 ? `<rect x="${pl}" y="${y(0)}" width="${W - pl - pr}" height="${y(bot) - y(0)}" fill="rgba(220,76,100,.05)"/>
    <text x="${W - pr - 6}" y="${y(bot) - 6}" text-anchor="end" fill="rgba(239,125,143,.55)" font-size="10" letter-spacing="1.5" font-weight="600">${tr('ZARAR', 'LOSS')}</text>` : '';

  let bars = '', hits = '', labels = '', vals = '';
  const pts = [];
  days.forEach((d, i) => {
    const cx = pl + gw * (i + 0.5);
    const rx = cx - bw - 2, kx = cx + 2;
    // revenue
    bars += `<rect x="${rx}" y="${y(d.revenue)}" width="${bw}" height="${Math.max(0, y(0) - y(d.revenue))}" rx="3" fill="url(#icRev)"/>`;
    // cost stack
    let base = 0;
    for (const [k, v] of [['cogs', d.cogs || 0], ['wages', d.wages || 0], ['ads', d.ads || 0]]) {
      if (v <= 0) continue;
      bars += `<rect x="${kx}" y="${y(base + v)}" width="${bw}" height="${Math.max(0, y(base) - y(base + v))}" fill="${IC_COLORS[k]}" opacity=".9"/>`;
      base += v;
    }
    pts.push([cx, y(d.net)]);
    if (showVals) {
      vals += `<text x="${rx + bw / 2}" y="${y(d.revenue) - 6}" text-anchor="middle" fill="${IC_COLORS.rev}" font-size="10.5" font-weight="600" ${mono}>${cmoney(d.revenue)}</text>`;
      const ny = y(d.net) + (d.net < 0 ? 18 : -10);
      vals += `<text x="${cx}" y="${ny}" text-anchor="middle" fill="${d.net >= 0 ? IC_COLORS.pos : IC_COLORS.neg}" font-size="10.5" font-weight="600" ${mono}>${d.net >= 0 ? '+' : ''}${cmoney(d.net)}</text>`;
    }
    const every = Math.ceil(days.length / Math.max(1, Math.floor((W - pl - pr) / 58)));
    if (i % every === 0 || i === days.length - 1) labels += `<text x="${cx}" y="${H - 10}" text-anchor="middle" fill="#7d8790" font-size="11">${shortDate(d.date)}</text>`;
    const tip = [`${d.date}`, `${tr('Gelir', 'Revenue')}: ${money(d.revenue)}`, `${tr('Ürün maliyeti', 'COGS')}: ${money(d.cogs)}`, `${tr('Maaş', 'Wages')}: ${money(d.wages)}`, `${tr('Reklam', 'Ads')}: ${money(d.ads)}`, `Net: ${money(d.net)}`, `${tr('Müşteri', 'Customers')}: ${n0(d.customers)}`].join('\n');
    hits += `<rect class="ic-hit" x="${pl + gw * i}" y="${pt}" width="${gw}" height="${H - pt - pb}"><title>${esc(tip)}</title></rect>`;
  });
  const netPath = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const dots = days.map((d, i) => `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="4" fill="#0b0c0e" stroke="${d.net >= 0 ? IC_COLORS.pos : IC_COLORS.neg}" stroke-width="2"/>`).join('');

  // summary
  const n = days.length;
  const avgRev = days.reduce((a, d) => a + d.revenue, 0) / n;
  const avgNet = days.reduce((a, d) => a + d.net, 0) / n;
  const best = days.reduce((a, d) => (d.revenue > a.revenue ? d : a), days[0]);
  const last = days[n - 1], prev = days[n - 2];
  const chg = prev?.revenue ? (last.revenue - prev.revenue) / prev.revenue : 0;
  const margin = avgRev ? avgNet / avgRev : 0;
  const summary = `<div class="ic-summary">
    <div><small>${tr('Ort. günlük gelir', 'Avg daily revenue')}</small><strong class="mono">${money(avgRev)}</strong></div>
    <div><small>${tr('Ort. net kâr', 'Avg net profit')}</small><strong class="mono ${avgNet >= 0 ? 'pos' : 'neg'}">${money(avgNet)}</strong><em>${pct(margin, 1)} ${tr('marj', 'margin')}</em></div>
    <div><small>${tr('En iyi gün', 'Best day')}</small><strong class="mono">${money(best.revenue)}</strong><em>${shortDate(best.date)}</em></div>
    <div><small>${tr('Son gün değişim', 'Last day change')}</small><strong class="mono ${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? '▲' : '▼'} ${pct(Math.abs(chg), 1)}</strong><em>${tr('önceki güne göre gelir', 'revenue vs previous day')}</em></div>
  </div>`;

  return `${summary}<svg class="ic-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="icRev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3cc97"/><stop offset="1" stop-color="#8a7243"/></linearGradient></defs>
    ${lossZone}${grid}${hits}${bars}
    <path d="${netPath}" fill="none" stroke="rgba(233,237,240,.8)" stroke-width="1.8" stroke-linejoin="round"/>${dots}${vals}${labels}</svg>
    <div class="legend">
      <span><b style="background:${IC_COLORS.rev}"></b>${tr('Gelir', 'Revenue')}</span>
      <span><b style="background:${IC_COLORS.cogs}"></b>${tr('Ürün maliyeti', 'COGS')}</span>
      <span><b style="background:${IC_COLORS.wages}"></b>${tr('Maaş', 'Wages')}</span>
      <span><b style="background:${IC_COLORS.ads}"></b>${tr('Reklam', 'Ads')}</span>
      <span><b style="background:#e9edf0;border-radius:50%"></b>${tr('Net kâr (çizgi)', 'Net profit (line)')}</span>
    </div>`;
}

/* =========================================================
   WAR / TARGETS
   ========================================================= */
async function loadWars() {
  try {
    state.wars = await api('/api/wars');
    renderWarChips();
    if (!state.factionId && state.wars.wars.length) { state.factionId = state.wars.wars[0].factionId; loadTargets(); }
  } catch (e) {
    $('#war-chips').innerHTML = `<span class="muted">${tr('Faction savaşları alınamadı:', 'Failed to load faction wars:')} ${esc(e.message)}</span>`;
  }
}
function renderWarChips() {
  const w = state.wars; if (!w) return;
  $('#war-chips').innerHTML = w.wars.length
    ? w.wars.map((x) => `<button class="war-chip ${x.factionId === state.factionId ? 'active' : ''}" data-fid="${x.factionId}">⚔ ${esc(x.name)} <small>${x.type}${x.score != null ? ` · ${x.myScore ?? 0}–${x.score}` : ''}</small></button>`).join('')
    : `<span class="muted">${esc(w.faction.name)} ${tr('şu an aktif bir savaşta değil. Manuel faction ID girebilirsin.', 'is not in an active war right now. Enter a faction ID manually.')}</span>`;
}
$('#war-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.war-chip'); if (!b) return;
  state.factionId = Number(b.dataset.fid); state.targets = null; loadTargets(); renderWarChips();
});
$('#faction-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = Number($('#faction-input').value.trim());
  if (!v) return toast(tr('Geçerli bir faction ID gir', 'Enter a valid faction ID'));
  state.factionId = v; state.targets = null; loadTargets(); renderWarChips();
});
$('#mode-toggle').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.mode = b.dataset.mode; localStorage.setItem('tt.mode', state.mode);
  $$('#mode-toggle button').forEach((x) => x.classList.toggle('active', x === b));
  renderTargets();
});
$('#f-okay').addEventListener('change', renderTargets);
$('#f-fit').addEventListener('change', renderTargets);

let targetsLoading = false;
async function loadTargets() {
  if (!state.factionId || targetsLoading) return;
  const factionId = state.factionId;
  window.loadWarGroups?.();
  localStorage.setItem('tt.faction', state.factionId);
  targetsLoading = true;
  if (!state.targets) $('#war-table').innerHTML = `<tbody><tr><td class="empty-state">${tr('Rakip üyeler ve savaş güçleri yükleniyor…', 'Loading opponent members and battle stats…')}</td></tr></tbody>`;
  try {
    const targets = await api('/api/targets?faction=' + factionId);
    if (state.factionId !== factionId) return;
    state.targets = targets;
    state.targetsAt = Date.now();
    renderTargets();
  } catch (e) {
    if (state.factionId !== factionId) return;
    $('#war-table').innerHTML = `<tbody><tr><td class="empty-state">${tr('Hata:', 'Error:')} ${esc(e.message)}</td></tr></tbody>`;
  } finally {
    targetsLoading = false;
    if (state.factionId !== factionId) loadTargets();
  }
}

function renderWarMe() {
  const o = state.overview; if (!o) return;
  const t = o.battle.totals;
  $('#war-me').innerHTML = `
    <div class="bs-total tq"><small>${tr('Xanaxsız gücün', 'Your BS (No Xanax)')}</small><strong>${compact(t.noXanax)}</strong></div>
    <div class="bs-total warn"><small>${tr('Xanaxlı gücün', 'Your BS (With Xanax)')}</small><strong>${compact(t.withXanax)}</strong></div>`;
}

const FIT_ORDER = { ideal: 0, easy: 1, risk: 2, avoid: 3, unknown: 4 };
// Oran = rakip tahmini BS ÷ senin BS. FF ≈ 1 + 8/3·√oran (en fazla 3) → oran ≥ 0.5625'te FF 3.00 (maks).
// İdeal bölge: FF ≥ ~2.6 olurken kazanma ihtimali hâlâ yüksek (oran 0.35–0.80).
function fitOf(ratio) {
  if (ratio == null || !isFinite(ratio)) return 'unknown';
  if (ratio < 0.35) return 'easy'; if (ratio < 0.8) return 'ideal'; if (ratio < 1.1) return 'risk'; return 'avoid';
}
const ffOf = (ratio) => (ratio == null || !isFinite(ratio) ? null : Math.min(3, 1 + (8 / 3) * Math.sqrt(ratio)));
// Kaba kazanma tahmini (stat oranına göre lojistik eğri). Saldıran tarafın avantajı için merkez 1.05.
const winOf = (ratio) => (ratio == null || !isFinite(ratio) ? null : 1 / (1 + Math.pow(ratio / 1.05, 6)));
const winPct = (w) => (state.lang === 'en' ? `${Math.round(w * 100)}%` : `%${Math.round(w * 100)}`);
// Faction ödeme kuralı: savaş vuruşu (mug'sız) = 1 × FF puan, mug = 0.75 × FF, assist = 1, dış chain = 1.
const HIT_POINTS = { warHit: 1, mug: 0.75, assist: 1, outsideChain: 1 };
const fitLabel = (f) => ({
  easy: tr('Kolay', 'Easy'),
  ideal: tr('İdeal', 'Ideal'),
  risk: tr('Riskli', 'Risky'),
  avoid: tr('Kaçın', 'Avoid'),
  unknown: tr('Bilinmiyor', 'Unknown'),
}[f] || f);
const fitBadge = (f) => `<span class="fit ${f}">${fitLabel(f)}</span>`;
const fitColor = { easy: 'var(--blue)', ideal: 'var(--tq)', risk: 'var(--warn)', avoid: 'var(--danger)', unknown: 'var(--muted)' };

function computeTargets() {
  const t = state.targets; if (!t) return [];
  const mineNo = t.me.totals.noXanax, mineXan = t.me.totals.withXanax;
  return t.members.map((m) => {
    const rNo = m.bs && mineNo > 0 ? m.bs / mineNo : null, rX = m.bs && mineXan > 0 ? m.bs / mineXan : null;
    const r = state.mode === 'withXanax' ? rX : rNo;
    const ff = ffOf(r), win = winOf(r);
    // Beklenen puan = kazanma ihtimali × FF (Leave/Hosp ile, mug yapmadan)
    const exp = ff != null && win != null ? ff * win * HIT_POINTS.warHit : null;
    return { ...m, rNo, rX, ratio: r, fitNo: fitOf(rNo), fitX: fitOf(rX), fit: fitOf(r), ff, win, exp };
  });
}

/* Ödeme sistemine göre (Fair Fight) önerilen hedefler */
function renderRecommendations(all) {
  const box = $('#war-reco');
  if (!box) return;
  const now = nowTct() / 1000;
  const scored = all.filter((m) => m.exp != null);
  if (!scored.length) { box.hidden = true; return; }
  box.hidden = false;

  const avail = scored.filter((m) => m.status?.state === 'Okay').sort((a, b) => b.exp - a.exp);
  const top = avail.slice(0, 6);
  const soon = scored
    .filter((m) => m.status?.state === 'Hospital' && Number(m.status.until) > now && m.status.until - now <= 20 * 60 && m.exp >= 1.5)
    .sort((a, b) => a.status.until - b.status.until)
    .slice(0, 6);
  const best = top[0];
  const allWeak = avail.length > 0 && avail.every((m) => m.ff != null && m.ff < 2);

  let advice;
  if (!best) {
    advice = tr('Şu an müsait (Okay) hedef yok. Aşağıda hastaneden çıkmak üzere olanlar var; bu sürede <b>assist</b> veya <b>dış chain hit</b> (1’er puan) ile chain’e katkı ver.',
      'No targets are Okay right now. Upcoming hospital releases are listed below; meanwhile help with <b>assists</b> or <b>outside chain hits</b> (1 point each).');
  } else if (best.exp < 1.2) {
    advice = tr(`Müsait hedeflerin beklenen puanı düşük (en iyi ${best.exp.toFixed(2)}). Assist veya dış chain hit (1 puan) daha verimli; iyi hedefleri bekle.`,
      `Available targets have low expected points (best ${best.exp.toFixed(2)}). Assists or outside chain hits (1 point) are better; wait for good targets.`);
  } else {
    advice = tr(`En iyi hedef: <b>${esc(best.name)}</b> · FF ${best.ff.toFixed(2)} · tahmini kazanma %${Math.round(best.win * 100)} → <b>${best.exp.toFixed(2)} puan</b> (assist/chain hit = 1 puan).`,
      `Best target: <b>${esc(best.name)}</b> · FF ${best.ff.toFixed(2)} · est. win ${Math.round(best.win * 100)}% → <b>${best.exp.toFixed(2)} points</b> (assist/chain hit = 1 point).`);
  }

  const attackBtn = (m) => `<a class="attack-btn" href="https://www.torn.com/page.php?sid=attack&user2ID=${m.id}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M14.5 4.5l5 5L9 20H4v-5zM4 4l4 4"/></svg>${tr('Saldır', 'Attack')}</a>`;
  const nameCell = (m) => `<a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank" rel="noopener">${esc(m.name)}</a> <span class="sub-text">Lv${m.level}</span>`;
  const bsCell = (m) => (m.source === 'rank' ? '~' + esc(m.bsLabel) : compact(m.bs));
  const row = (m, extra) => `<tr>
      <td>${nameCell(m)}</td>${extra}
      <td class="num">${bsCell(m)}</td>
      <td class="num">${m.ratio.toFixed(2)}</td>
      <td class="num"><b>${m.ff.toFixed(2)}</b></td>
      <td class="num">${winPct(m.win)}</td>
      <td class="num"><b class="tq-text">${m.exp.toFixed(2)}</b></td>
      <td>${attackBtn(m)}</td></tr>`;
  const head = (extraTh) => `<thead><tr><th>${tr('Oyuncu', 'Player')}</th>${extraTh}<th class="num">${tr('Tahmini BS', 'Est. BS')}</th><th class="num">${tr('Oran', 'Ratio')}</th><th class="num">FF</th><th class="num">${tr('Kazanma', 'Win %')}</th><th class="num">${tr('Puan', 'Points')}</th><th></th></tr></thead>`;

  box.innerHTML = `
    <div class="card-head wrap">
      <div>
        <h3>💰 ${tr('Ödeme Odaklı Öneriler · Fair Fight', 'Payout-Focused Picks · Fair Fight')}</h3>
        <span class="muted">${tr('Puan = kazanma ihtimali × FF. Ödeme payın = senin puanın ÷ faction toplam puanı.', 'Points = win chance × FF. Your payout share = your points ÷ faction total points.')}</span>
      </div>
      <div class="reco-rules">
        <span class="chip tq">${tr('Savaş vuruşu', 'War hit')} = 1×FF (1–3)</span>
        <span class="chip warn">Mug = 0.75×FF</span>
        <span class="chip">Assist = 1</span>
        <span class="chip">${tr('Dış chain', 'Outside chain')} = 1</span>
      </div>
    </div>
    <div class="alert ${best && best.exp >= 1.2 ? 'info' : 'warn'}" style="margin-bottom:12px"><div>${advice}
      <br><span class="sub-text">${tr('⚠ Mug yapma: puanın %25 düşer. Saldırı sonunda <b>Leave</b> veya <b>Hospitalize</b> seç.', '⚠ Don’t mug: you lose 25% of the points. Choose <b>Leave</b> or <b>Hospitalize</b>.')}</span>
      ${allWeak ? `<br><span class="sub-text">${tr('Müsait rakiplerin hepsi senden çok zayıf (FF &lt; 2). Kurallar gereği bunları düşük statlı üyelere bırakıp assist / chain’e odaklanman önerilir.', 'All available opponents are far weaker than you (FF &lt; 2). Consider leaving them to lower-stat members and focusing on assists / chain.')}</span>` : ''}
    </div></div>
    <div class="grid two reco-grid">
      <div>
        <span class="eyebrow">${tr('Şimdi saldırılabilir · en yüksek puan', 'Attackable now · highest points')}</span>
        ${top.length ? `<div class="tbl-wrap"><table class="tbl compact">${head('')}<tbody>${top.map((m) => row(m, '')).join('')}</tbody></table></div>` : `<div class="empty-state">${tr('Müsait hedef yok', 'No available targets')}</div>`}
      </div>
      <div>
        <span class="eyebrow">${tr('Hastaneden çıkmak üzere (≤ 20 dk)', 'Leaving hospital soon (≤ 20 min)')}</span>
        ${soon.length ? `<div class="tbl-wrap"><table class="tbl compact">${head(`<th>${tr('Çıkış', 'Out in')}</th>`)}<tbody>${soon.map((m) => row(m, `<td>${statusTimerChip(m.status)}</td>`)).join('')}</tbody></table></div>` : `<div class="empty-state">${tr('Yakında çıkacak iyi hedef yok', 'No good targets leaving soon')}</div>`}
      </div>
    </div>`;
}

function renderTargets() {
  const t = state.targets; if (!t) return;
  const ff = t.ffscouter || {};
  // FFScouter / estimate alert
  const job = t.estimateJob;
  let ffHtml = '';
  if (ff.ok === false) {
    ffHtml = `<div class="alert warn"><div><b>${tr('FFScouter verisi alınamadı.', 'FFScouter data unavailable.')}</b> ${esc(ff.error || '')}<br><span class="muted">${tr('Kayıt için <a href="https://ffscouter.com/" target="_blank" rel="noopener">ffscouter.com</a>\'a git → Torn Limited API key\'inle giriş yap. Bu sırada rank tabanlı tahmin kullanabilirsin.', 'Visit <a href="https://ffscouter.com/" target="_blank" rel="noopener">ffscouter.com</a> and register with your Torn Limited API key. Meanwhile, you can scan using rank-based estimation.')}</span></div>
      ${job && job.running ? `<span class="chip tq">${tr('Tahmin', 'Estimating')}: ${job.done}/${job.total}</span>` : `<button class="btn sm" id="est-btn">${tr('Rank tahmini ile tara', 'Scan with rank estimate')}</button>`}</div>`;
  } else if (job && job.running) {
    ffHtml = `<div class="alert info">${tr('Rank tahmini çalışıyor:', 'Rank estimation running:')} ${job.done}/${job.total}</div>`;
  }
  $('#ff-alert').innerHTML = ffHtml;
  const eb = $('#est-btn'); if (eb) eb.onclick = startEstimate;
  if (job && job.running) { clearTimeout(renderTargets._p); renderTargets._p = setTimeout(loadTargets, 5000); }

  $('#war-title').innerHTML = `${esc(t.faction.name)} <span class="muted">[${t.faction.tag ? esc(t.faction.tag) : t.faction.id}]</span>`;
  $('#war-sub').textContent = `${t.faction.members} ${tr('üye', 'members')} · ${t.faction.rank?.name ? decode(t.faction.rank.name) + ' · ' : ''}${n0(t.faction.respect)} respect · ${tr('güncellendi', 'updated')} ${new Date(state.targetsAt).toLocaleTimeString(timeLocale())}`;

  const all = computeTargets();
  const groupedTargets = window.filterWarTargets ? window.filterWarTargets(all) : all;
  renderRecommendations(groupedTargets);
  requestAnimationFrame(() => animateNumbers($('#view-war')));
  const known = all.filter((m) => m.bs);
  const okay = all.filter((m) => m.status?.state === 'Okay');
  $('#war-kpis').innerHTML = [
    kpi(tr('Üye / Verisi olan', 'Members / With stats'), `${all.length} / ${known.length}`, known.length ? `${known.filter((m) => m.source === 'ffscouter').length} FFScouter` : tr('stat verisi yok', 'no stat data')),
    kpi(tr('Müsait', 'Okay'), okay.length, tr('hastane/seyahatte değil', 'not in hospital or traveling')),
    kpi(tr('İdeal · Xanaxsız', 'Ideal · No Xanax'), all.filter((m) => m.fitNo === 'ideal').length, `+${all.filter((m) => m.fitNo === 'easy').length} ${tr('kolay', 'easy')}`, 'tq'),
    (() => { const b = okay.filter((m) => m.exp != null).sort((x, y) => y.exp - x.exp)[0]; return kpi(tr('En iyi puan (müsait)', 'Best points (Okay)'), b ? b.exp.toFixed(2) : '—', b ? `${esc(b.name)} · FF ${b.ff.toFixed(2)}` : tr('müsait hedef yok', 'no Okay targets'), 'tq'); })(),
    kpi(tr('Şu an saldırılabilir', 'Attackable now'), okay.filter((m) => m.fit === 'ideal' || m.fit === 'easy').length, state.mode === 'withXanax' ? tr('Xanaxlı moda göre', 'in With Xanax mode') : tr('Xanaxsız moda göre', 'in No Xanax mode'), 'pos'),
  ].join('');

  let rows = groupedTargets;
  if ($('#f-okay').checked) rows = rows.filter((m) => m.status?.state === 'Okay');
  if ($('#f-fit').checked) rows = rows.filter((m) => m.fit === 'ideal' || m.fit === 'easy');

  const { key, dir } = state.sort;
  const stOrder = (m) => (m.status?.state === 'Okay' ? 0 : m.status?.state === 'Hospital' ? 1 : 2);
  const cmp = {
    smart: (a, b) => stOrder(a) - stOrder(b) || (b.exp ?? -1) - (a.exp ?? -1) || FIT_ORDER[a.fit] - FIT_ORDER[b.fit],
    exp: (a, b) => (a.exp ?? -1) - (b.exp ?? -1),
    name: (a, b) => a.name.localeCompare(b.name),
    level: (a, b) => a.level - b.level,
    status: (a, b) => stOrder(a) - stOrder(b),
    bs: (a, b) => (a.bs || 0) - (b.bs || 0),
    ratio: (a, b) => (a.ratio ?? 99) - (b.ratio ?? 99),
    ff: (a, b) => (a.ff || 0) - (b.ff || 0),
  }[key];
  rows = rows.slice().sort((a, b) => cmp(a, b) * dir);

  const th = (k, label, cls = '') => `<th class="sortable ${cls} ${key === k ? 'sorted' : ''}" data-sort="${k}">${label}${key === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  const head = `<thead><tr>${th('smart', tr('Uygunluk', 'Fit'))}${th('name', tr('Oyuncu', 'Player'))}${th('level', 'Lv', 'num')}${th('status', tr('Durum', 'Status'))}<th>${tr('Son aktivite', 'Last action')}</th>${th('bs', tr('Tahmini BS', 'Est. BS'), 'num')}${th('ratio', tr('Oran', 'Ratio'), 'num')}<th>${tr('Xanaxsız / Xanaxlı', 'No Xanax / With Xanax')}</th>${th('ff', 'FF', 'num')}${th('exp', tr('Puan', 'Points'), 'num')}<th></th></tr></thead>`;

  if (!rows.length) {
    $('#war-table').innerHTML = head + `<tbody><tr><td colspan="11" class="empty-state">${known.length ? tr('Filtreye uyan hedef yok. Filtreleri gevşetmeyi dene.', 'No targets match current filters. Try relaxing the filters.') : tr('Savaş gücü verisi yok – FFScouter kaydı yap veya rank tahmini ile tara.', 'No battle stat data — register on FFScouter or scan with rank estimate.')}</td></tr></tbody>`;
  } else {
    $('#war-table').innerHTML = head + `<tbody>${rows.map((m) => {
      const si = statusInfo(m.status);
      const desc = m.status?.state !== 'Okay' ? `<div class="sub-text">${esc(m.status?.description || '')}</div>` : '';
      const r = m.ratio;
      const bsTxt = m.bs ? `<span title="${m.source === 'ffscouter' ? 'FFScouter' : tr('Rank tahmini: ', 'Rank est.: ') + esc(m.bsLabel)}">${m.source === 'rank' ? '~' : ''}${m.source === 'rank' ? esc(m.bsLabel) : compact(m.bs)}</span><div class="sub-text">${m.source === 'ffscouter' ? 'FFScouter' : tr('rank tahmini', 'rank est.')}</div>` : '<span class="muted">—</span>';
      return `<tr>
        <td>${fitBadge(m.fit)}</td>
        <td><div class="name-cell"><a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank" rel="noopener">${esc(m.name)}</a><span class="sub-text">[${m.id}]</span>${statusTimerChip(m.status)}</div><div class="sub-text">${esc(m.position || '')}</div></td>
        <td class="num">${m.level}</td>
        <td><span class="chip ${si.cls}">${si.text}</span>${desc}</td>
        <td>${lastActionChip(m.lastAction)}</td>
        <td class="num">${bsTxt}</td>
        <td class="num">${r != null ? r.toFixed(2) : '—'}${r != null ? `<span class="ratio-bar"><i style="width:${Math.min(100, (r / 1.5) * 100)}%;background:${fitColor[m.fit]}"></i></span>` : ''}</td>
        <td>${fitBadge(m.fitNo)} ${fitBadge(m.fitX)}</td>
        <td class="num">${m.ff ? m.ff.toFixed(2) : '—'}${m.ffRemote ? `<div class="sub-text">FFS ${Number(m.ffRemote).toFixed(2)}</div>` : ''}</td>
        <td class="num">${m.exp != null ? `<b class="tq-text">${m.exp.toFixed(2)}</b><div class="sub-text">${winPct(m.win)} ${tr('kazanma', 'win')}</div>` : '—'}</td>
        <td><a class="attack-btn" href="https://www.torn.com/page.php?sid=attack&user2ID=${m.id}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M14.5 4.5l5 5L9 20H4v-5zM4 4l4 4"/></svg>${tr('Saldır', 'Attack')}</a></td></tr>`;
    }).join('')}</tbody>`;
  }
  $$('#war-table th.sortable').forEach((h) => h.addEventListener('click', () => {
    const k = h.dataset.sort;
    state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: k === 'smart' || k === 'name' || k === 'status' || k === 'ratio' ? 1 : -1 };
    renderTargets();
  }));
  window.decorateWarGroups?.(rows);
  tick();
}

async function startEstimate() {
  try {
    const j = await api('/api/estimate?faction=' + state.factionId, { method: 'POST' });
    toast(j.total ? tr(`${j.total} oyuncu için tahmin başlatıldı (~${Math.ceil(j.total * 0.9 / 60)} dk)`, `Started estimation for ${j.total} players (~${Math.ceil(j.total * 0.9 / 60)} min)`) : tr('Tahminler zaten güncel', 'Estimates already up to date'));
    setTimeout(loadTargets, 1500);
  } catch (e) { toast(tr('Hata: ', 'Error: ') + e.message); }
}

/* =========================================================
   SETTINGS
   ========================================================= */
// The server, the main process and the Torn page helpers read the language from config.json
function syncLangToServer() {
  api('/api/lang', { method: 'POST', body: JSON.stringify({ lang: state.lang }) }).catch(() => {});
}
async function loadConfig() {
  try {
    const c = await api('/api/config'); state.config = c; window.applyFeatures?.();
    if (c.lang !== state.lang) syncLangToServer();
    $('#s-key-current').textContent = c.hasKey ? `${tr('Kayıtlı', 'Saved')}: ${c.apiKeyMasked}` : tr('Key kayıtlı değil', 'No key saved');
    $('#s-ff-current').textContent = c.ffscouterKeyMasked ? `${tr('Kayıtlı', 'Saved')}: ${c.ffscouterKeyMasked}` : tr('Torn key kullanılıyor', 'Using Torn key');
    $('#s-cover').value = c.coverDays; $('#s-poll').value = c.pollMinutes;
    $('#s-log-current').textContent = c.logKeyMasked
      ? `${tr('Kayıtlı', 'Saved')}: ${c.logKeyMasked}`
      : tr('Yok · yalnızca "log" izinli özel key; alış fiyatlarını ve bust zamanlarını okumak için. Bu bilgisayarda saklanır, yalnızca api.torn.com\'a gider.', 'None · a custom key with only "log" access, used to read purchase prices and bust times. Stored on this computer, sent only to api.torn.com.');
    $('#s-log-remove').hidden = !c.logKeyMasked;
    renderUpdateInfo();
    return c;
  } catch { return null; }
}
// Güncelleme adresi sabit (resmi GitHub sürümü); burada yalnızca bilgi gösterilir
function renderUpdateInfo() {
  const el = $('#set-update-info'); if (!el) return;
  const c = state.config || {}; const u = state.update || {};
  const repo = (String(c.updateUrl || '').match(/github\.com\/([^/]+\/[^/]+)/) || [])[1];
  const status = u.available ? `<span class="chip tq">v${esc(u.latest)} ${tr('hazır', 'ready')}</span>`
    : u.error ? `<span class="chip warn">${tr('kontrol edilemedi', 'check failed')}</span>`
    : u.current ? `<span class="chip green">${tr('güncel', 'up to date')}</span>` : '—';
  el.innerHTML = `
    <div><span>${tr('Sürüm', 'Version')}</span><span class="mono">v${esc(u.current || c.version || '—')}</span></div>
    <div><span>${tr('Durum', 'Status')}</span><span>${status}</span></div>
    <div><span>${tr('Kaynak', 'Source')}</span><span class="mono">${repo ? `GitHub · ${esc(repo)}` : '—'}</span></div>
    <div><span>${tr('Kontrol', 'Checks')}</span><span>${feat('app.updates') ? tr('Açılışta ve 6 saatte bir', 'On startup and every 6 hours') : tr('Otomatik kontrol kapalı', 'Automatic checks off')}</span></div>
    <small class="muted">${tr('Güncellemeler yalnızca resmi sürüm adresinden gelir; bu adres değiştirilemez.', 'Updates come only from the official release address; it cannot be changed.')}</small>`;
}
async function postConfig(body, okText) {
  try {
    await api('/api/config', { method: 'POST', body: JSON.stringify(body) });
    toast(okText || tr('Ayarlar kaydedildi', 'Settings saved'));
    await loadConfig();
    return true;
  } catch (err) { toast(err.message); return false; }
}
$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {};
  if ($('#s-key').value.trim()) body.apiKey = $('#s-key').value.trim();
  if ($('#s-ff').value.trim()) body.ffscouterKey = $('#s-ff').value.trim();
  const lk = $('#s-log').value.trim();
  if (lk) {
    if (!/^[A-Za-z0-9]{16}$/.test(lk)) return toast(tr('Log key 16 karakterlik harf/rakam olmalı.', 'The log key must be 16 letters or digits.'));
    body.logKey = lk;
  }
  if (!Object.keys(body).length) return toast(tr('Değişiklik yok', 'No changes to save'));
  if (await postConfig(body)) { $('#s-key').value = ''; $('#s-ff').value = ''; $('#s-log').value = ''; refreshAll(true); }
});
$('#general-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (await postConfig({ coverDays: Number($('#s-cover').value), pollMinutes: Number($('#s-poll').value) })) refreshAll(true);
});
$('#s-log-remove').addEventListener('click', () => postConfig({ logKey: '' }, tr('Log key silindi', 'Log key removed')));
$('#s-log-create').addEventListener('click', () => openInTab('https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=LRX%20Log&user=log,personalstats', { activate: true }));
$('#set-update-check').addEventListener('click', async () => { await checkUpdate(true); renderUpdateInfo(); });
$('#ff-check').addEventListener('click', async () => {
  $('#ff-status').textContent = tr('Kontrol ediliyor…', 'Checking…');
  try {
    const r = await api('/api/ffscouter/check');
    $('#ff-status').innerHTML = r.registered
      ? `<span class="chip green">${tr('Kayıtlı ✓', 'Registered ✓')}</span> ${r.premium ? '<span class="chip tq">Premium</span>' : ''}`
      : `<span class="chip danger">${tr('Kayıtlı değil', 'Not registered')}</span> <span class="muted">${tr("ffscouter.com'da key'inle giriş yapıp kaydol.", 'Log in and register your key on ffscouter.com.')}</span>`;
  } catch (e) { $('#ff-status').textContent = tr('Hata: ', 'Error: ') + e.message; }
});

/* =========================================================
   BOOT
   ========================================================= */
async function refreshAll(force = false) {
  const btn = $('#refresh-btn'); btn.classList.add('spin');
  await Promise.allSettled([loadOverview(force), loadCompany(force), state.view === 'war' && state.factionId ? loadTargets() : null]);
  btn.classList.remove('spin');
}
$('#refresh-btn').addEventListener('click', () => refreshAll(true));

// Delegated interactions for Stock Delivery & Rehab Message Generator
document.addEventListener('click', async (e) => {
  const syncBtn = e.target.closest('[data-order-sync]');
  if (syncBtn) {
    const hoursAgo = Number(syncBtn.dataset.orderSync) || 0;
    const c = await api('/api/stock-order', { method: 'POST', body: JSON.stringify({ hoursAgo, deliveryMode: 'hours' }) });
    state.company = c; renderCompany();
    const h = c.estDeliveryHours || c.deliveryHours || 6;
    toast(hoursAgo === 0 ? tr(`Sipariş sayacı başlatıldı (${h} saat, tahmini)`, `Order timer started (${h} hours, estimate)`) : tr(`Sipariş zamanı ${hoursAgo} saat öncesi olarak ayarlandı`, `Order time set to ${hoursAgo}h ago`));
    return;
  }
  if (e.target.closest('[data-stock-torn-sync]')) {
    openInTab('https://www.torn.com/companies.php#/option=stock', { activate: true, reuse: true });
    toast(tr('Torn stok sayfası açıldı · teslim süreleri otomatik okunacak', 'Torn stock page opened · delivery times will be read automatically'));
    return;
  }
  const modeBtn = e.target.closest('[data-order-mode]');
  if (modeBtn) {
    const deliveryMode = modeBtn.dataset.orderMode;
    const c = await api('/api/stock-order', { method: 'POST', body: JSON.stringify({ deliveryMode }) });
    state.company = c; renderCompany();
    toast(tr('Teslimat sayacı 18:00 TCT günlük yenilenmesine göre ayarlandı', 'Delivery timer anchored to 18:00 TCT daily reset'));
    return;
  }
  const rfBtn = e.target.closest('[data-rf]');
  if (rfBtn && state.company) {
    state.rehabFilter = rfBtn.dataset.rf;
    localStorage.setItem('tt.rehabFilter', state.rehabFilter);
    renderEmployees(state.company);
    return;
  }
  const tplBtn = e.target.closest('[data-tpl]');
  if (tplBtn && state.company) {
    const k = tplBtn.dataset.tpl;
    state.rehabTplKey = k;
    state.rehabTpl = REHAB_TEMPLATES[k] || REHAB_TEMPLATES.en_polite;
    localStorage.setItem('tt.rehabTplEnKey', state.rehabTplKey);
    localStorage.setItem('tt.rehabTplEn', state.rehabTpl);
    renderEmployees(state.company);
    return;
  }
  const copyBtn = e.target.closest('[data-copy-rehab]');
  if (copyBtn && state.company) {
    const id = Number(copyBtn.dataset.copyRehab);
    const emp = state.company.employees.find((x) => x.id === id);
    if (emp) await copyText(formatRehabMsg(emp.name, emp.addiction), tr(`${decode(emp.name)} için rehab mesajı kopyalandı`, `Rehab message copied for ${decode(emp.name)}`));
    return;
  }
  const sendBtn = e.target.closest('[data-send-rehab]');
  if (sendBtn && state.company) {
    e.preventDefault();
    const id = Number(sendBtn.dataset.sendRehab);
    const emp = state.company.employees.find((x) => x.id === id);
    if (!emp) return;
    sendRehabChat(emp, sendBtn);
    return;
  }
  const quickBtn = e.target.closest('[data-open-url]');
  if (quickBtn) {
    e.preventDefault();
    openInTab(quickBtn.dataset.openUrl, { activate: true, label: quickBtn.dataset.tabLabel || null, reuse: true });
    return;
  }
  const extLink = e.target.closest('a[href^="https://www.torn.com"], a[href^="https://ffscouter.com"]');
  if (extLink) {
    e.preventDefault();
    openInTab(extLink.href, { activate: !e.ctrlKey && !e.metaKey });
  }
});

/* =========================================================
   MULTI-TAB WORKSPACE & EMBEDDED TORN BROWSER (.exe)
   ========================================================= */
const isElectronApp = () => Boolean(window.electronAPI?.isElectron || /Electron/i.test(navigator.userAgent));

function lookupPlayerName(xid) {
  const id = Number(xid);
  if (!id) return null;
  if (state.overview?.player?.id === id) return decode(state.overview.player.name);
  const emp = state.company?.employees?.find((x) => x.id === id);
  if (emp) return decode(emp.name);
  const mem = state.targets?.members?.find((x) => x.id === id);
  if (mem) return decode(mem.name);
  return null;
}

function extractPlayerId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:XID|user2ID)=(\d+)/i);
  return m ? Number(m[1]) : null;
}

function describeTornUrl(url, customLabel = null) {
  const u = String(url || '');
  const xid = extractPlayerId(u);
  const pname = xid ? lookupPlayerName(xid) : null;
  const tag = pname ? `${pname} [${xid}]` : xid ? `[${xid}]` : '';

  if (/^chrome-extension:\/\//i.test(u)) return { icon: '🧰', title: customLabel || 'TornTools' };
  if (/(loader|page)\.php\?sid=attack/i.test(u)) return { icon: '⚔', title: `${tr('Saldırı', 'Attack')} ${tag}`.trim() };
  if (/messages\.php/i.test(u)) return { icon: '✉', title: `${tr('Mesaj', 'Message')} ${tag}`.trim() };
  if (/profiles\.php/i.test(u)) return { icon: '👤', title: tag || tr('Oyuncu Profili', 'Player Profile') };
  if (/companies\.php/i.test(u)) return { icon: '🏢', title: customLabel || tr('Şirketim (JOB)', 'My Company (JOB)') };
  if (/factions\.php/i.test(u)) return { icon: '⚔', title: customLabel || 'Faction' };
  if (/travelagency\.php/i.test(u)) return { icon: '✈', title: customLabel || 'Rehab / Travel' };
  if (/ffscouter\.com/i.test(u)) return { icon: '📊', title: customLabel || 'FFScouter' };
  if (/torn\.com/i.test(u)) return { icon: '🌐', title: customLabel || 'Torn City' };
  try {
    return { icon: '🌐', title: customLabel || new URL(u).hostname };
  } catch {
    return { icon: '🌐', title: customLabel || tr('Sekme', 'Tab') };
  }
}

function openInTab(url, opts = {}) {
  const { activate = true, label = null, reuse = false } = opts;
  if (!url) return;

  if (reuse) {
    const existing = state.browserTabs.find((t) => t.url === url);
    if (existing) {
      if (activate) activateWorkspaceTab(existing.id);
      return existing;
    }
  }

  const id = `tab-${state.nextTabSeq++}`;
  const meta = describeTornUrl(url, label);
  const tab = { id, url, title: meta.title, icon: meta.icon, loading: isElectronApp(), wv: null };
  const deck = $('#webview-deck');

  state.browserTabs.push(tab);
  renderBrowserTabs();

  if (window.electronAPI?.tabCreate) {
    if (activate) {
      state.activeWsTab = id;
      $('#tracker-app').classList.add('stage-hidden');
      $('#browser-stage').classList.remove('stage-hidden');
      $('#tab-btn-tracker').classList.remove('active');
      renderBrowserTabs();
      updateBrowserToolbar();
    }
    window.electronAPI.tabCreate({ id, url, activate });
    return tab;
  }

  const fb = document.createElement('div');
  fb.className = 'tab-webview wv-hidden browser-fallback';
  fb.innerHTML = `<div class="glass card" style="max-width:520px">
    <h3>${esc(tab.icon)} ${esc(tab.title)}</h3>
    <p class="muted" style="margin:10px 0 16px">${tr('Torn.com güvenlik politikası (X-Frame-Options) nedeniyle normal web tarayıcısında gömülü sekme yerine masaüstü <b>TornTracker.exe</b> uygulaması içinde yerleşik sekme olarak açılır.', 'Torn.com blocks standard browser iframes via X-Frame-Options. Run the <b>TornTracker.exe</b> desktop app to use embedded Torn tabs.')}</p>
    <div class="mono muted" style="font-size:11.5px;margin-bottom:14px;word-break:break-all">${esc(url)}</div>
    <a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">↗ ${tr('Yeni Sekmede Aç', 'Open in New Tab')}</a>
  </div>`;
  deck.appendChild(fb);
  tab.wv = fb;

  if (activate) activateWorkspaceTab(tab.id);
  return tab;
}

function activateWorkspaceTab(tabId) {
  state.activeWsTab = tabId;
  const isTracker = tabId === 'tracker';
  $('#tracker-app').classList.toggle('stage-hidden', !isTracker);
  $('#browser-stage').classList.toggle('stage-hidden', isTracker);
  $('#tab-btn-tracker').classList.toggle('active', isTracker);

  if (window.electronAPI?.tabActivate) {
    window.electronAPI.tabActivate(tabId);
  } else {
    for (const t of state.browserTabs) {
      if (t.wv) {
        t.wv.classList.toggle('wv-active', t.id === tabId);
        t.wv.classList.toggle('wv-hidden', t.id !== tabId);
      }
    }
  }
  renderBrowserTabs();
  if (!isTracker) updateBrowserToolbar();
  else catchUpTracker();
}

// Takip ekranına dönünce: sayaçları hemen düzelt, uzun süre gizli kaldıysa veriyi tazele
function catchUpTracker() {
  tick();
  if (Date.now() - (state.overviewAt || 0) > 60_000) loadOverview(false);
}
document.addEventListener('visibilitychange', () => { if (trackerVisible()) catchUpTracker(); });

function closeBrowserTab(tabId) {
  const idx = state.browserTabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;
  const [removed] = state.browserTabs.splice(idx, 1);
  if (removed.wv) removed.wv.remove();
  if (window.electronAPI?.tabClose) {
    window.electronAPI.tabClose(tabId);
  }

  if (state.activeWsTab === tabId) {
    const next = state.browserTabs[idx] || state.browserTabs[idx - 1];
    activateWorkspaceTab(next ? next.id : 'tracker');
  } else {
    renderBrowserTabs();
  }
}

/* Sekmeleri sürükle-bırak ile yeniden sırala */
const tabDrag = { id: null, pendingRender: false };
function clearDropMarks() {
  $$('#browser-tabs .ws-tab').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'dragging'));
}
(() => {
  const wrap = $('#browser-tabs');
  if (!wrap) return;
  wrap.addEventListener('dragstart', (e) => {
    const el = e.target.closest('[data-ws-tab]');
    if (!el) return;
    tabDrag.id = el.dataset.wsTab;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', tabDrag.id); } catch {}
    requestAnimationFrame(() => el.classList.add('dragging'));
  });
  wrap.addEventListener('dragover', (e) => {
    if (!tabDrag.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const el = e.target.closest('[data-ws-tab]');
    $$('#browser-tabs .ws-tab').forEach((x) => { if (x !== el) x.classList.remove('drop-before', 'drop-after'); });
    if (!el || el.dataset.wsTab === tabDrag.id) return;
    const r = el.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    el.classList.toggle('drop-after', after);
    el.classList.toggle('drop-before', !after);
  });
  wrap.addEventListener('drop', (e) => {
    if (!tabDrag.id) return;
    e.preventDefault();
    const el = e.target.closest('[data-ws-tab]');
    const from = state.browserTabs.findIndex((t) => t.id === tabDrag.id);
    if (from !== -1) {
      const [moved] = state.browserTabs.splice(from, 1);
      let to = state.browserTabs.length; // boş alana bırakılırsa sona
      if (el && el.dataset.wsTab !== moved.id) {
        const r = el.getBoundingClientRect();
        to = state.browserTabs.findIndex((t) => t.id === el.dataset.wsTab) + (e.clientX > r.left + r.width / 2 ? 1 : 0);
      } else if (el) {
        to = from;
      }
      state.browserTabs.splice(to, 0, moved);
    }
    tabDrag.id = null;
    renderBrowserTabs();
  });
  wrap.addEventListener('dragend', () => {
    tabDrag.id = null;
    clearDropMarks();
    if (tabDrag.pendingRender) { tabDrag.pendingRender = false; renderBrowserTabs(); }
  });
})();

/* Sekme başlığındaki hastane / hapis sayacı */
function tabStatusTimer(url) {
  const xid = extractPlayerId(url);
  if (!xid) return '';
  const st = state.playerInfo[xid]?.data?.status;
  const until = Number(st?.until) || 0;
  if (!st || (st.state !== 'Hospital' && st.state !== 'Jail') || until <= nowTct() / 1000) return '';
  const hosp = st.state === 'Hospital';
  return `<span class="ws-tab-timer ${hosp ? 'hosp' : 'jail'}" title="${esc(st.description || st.state)}">${hosp ? '🏥' : '⛓'}<span class="mono" data-short="1" data-until="${until}">${shortClock(until - nowTct() / 1000)}</span></span>`;
}
function shortClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (v) => String(v).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

const seenWsTabs = new Set();
function renderBrowserTabs() {
  const wrap = $('#browser-tabs');
  if (!wrap) return;
  window.updateWorkspaceShortcuts?.();
  // Sürükleme sırasında yeniden çizmek sürüklemeyi iptal eder → bitince çiz
  if (tabDrag.id) { tabDrag.pendingRender = true; return; }
  wrap.innerHTML = state.browserTabs.map((t) => `
    <div class="ws-tab ${state.activeWsTab === t.id ? 'active' : ''} ${seenWsTabs.has(t.id) ? '' : 'ws-tab-new'}" draggable="true" data-ws-tab="${t.id}" title="${esc(t.title)} — ${esc(t.url)}">
      ${t.loading ? '<span class="ws-tab-spin"></span>' : `<span class="ws-tab-mark">${esc(t.icon)}</span>`}
      <span class="ws-tab-title">${esc(t.title)}</span>
      ${tabStatusTimer(t.url)}
      <button class="ws-tab-close" data-close-tab="${t.id}" title="${tr('Sekmeyi kapat', 'Close tab')}">×</button>
    </div>
  `).join('');
  for (const t of state.browserTabs) {
    seenWsTabs.add(t.id);
    const x = extractPlayerId(t.url);
    if (x) refreshPlayerInfo(x);
  }
}
// Açık profil / saldırı sekmelerindeki oyuncuların durumunu tazele (yeni hastane süresi vb.)
setInterval(() => {
  for (const t of state.browserTabs) { const x = extractPlayerId(t.url); if (x) refreshPlayerInfo(x, 25_000); }
}, 15_000);

function updateBrowserToolbar() {
  const tab = state.browserTabs.find((t) => t.id === state.activeWsTab);
  if (!tab) return;
  const urlInput = $('#browser-url');
  if (urlInput && document.activeElement !== urlInput) {
    urlInput.value = tab.url || '';
  }
  const ctx = $('#browser-context-actions');
  if (!ctx) return;
  const xid = extractPlayerId(tab.url);
  if (xid) {
    const info = state.playerInfo[xid]?.data;
    const pname = lookupPlayerName(xid) || (info?.name ? decode(info.name) : `#${xid}`);
    const emp = state.company?.employees?.find((x) => x.id === xid);
    const status = info?.status || state.targets?.members?.find((x) => x.id === xid)?.status || null;
    ctx.innerHTML = `
      <span class="chip tq mono">${esc(pname)}</span>
      ${status ? statusTimerChip(status, true) : ''}
      <button class="btn sm ghost" data-nav-active="https://www.torn.com/profiles.php?XID=${xid}">👤 ${tr('Profil', 'Profile')}</button>
      <button class="btn sm ghost" data-nav-active="https://www.torn.com/page.php?sid=attack&user2ID=${xid}">⚔ ${tr('Saldır', 'Attack')}</button>
      ${emp && emp.addiction < 0 ? `<button class="btn sm primary" data-copy-rehab="${emp.id}">📋 ${tr('Rehab Mesajı Kopyala', 'Copy Rehab Message')}</button>` : ''}
    `;
    refreshPlayerInfo(xid);
  } else {
    ctx.innerHTML = '';
  }
  tick();
}

/* Profil / saldırı sekmesindeki oyuncunun durumu (hastane çıkış sayacı) */
async function refreshPlayerInfo(xid, maxAgeMs = 20_000) {
  const cur = state.playerInfo[xid];
  if (cur && (cur.loading || Date.now() - cur.at < maxAgeMs)) return;
  state.playerInfo[xid] = { ...(cur || {}), loading: true, at: cur?.at || 0 };
  try {
    const data = await api('/api/player?id=' + xid);
    state.playerInfo[xid] = { data, at: Date.now(), loading: false };
  } catch {
    state.playerInfo[xid] = { ...(cur || {}), at: Date.now(), loading: false };
    return;
  }
  const tab = state.browserTabs.find((t) => t.id === state.activeWsTab);
  if (tab && extractPlayerId(tab.url) === xid) updateBrowserToolbar();
  if (state.browserTabs.some((t) => extractPlayerId(t.url) === xid)) renderBrowserTabs();
}

function updateLoginHelpVisibility() {
  const btn = $('#b-login-help');
  if (btn) btn.style.display = state.tornLoggedIn === true ? 'none' : '';
}

$('#tab-btn-tracker').addEventListener('click', () => activateWorkspaceTab('tracker'));
$('#new-tab-btn').addEventListener('click', () => openInTab('https://www.torn.com/index.php', { activate: true, label: 'Torn City' }));

$('#browser-tabs').addEventListener('click', (e) => {
  const closeBtn = e.target.closest('[data-close-tab]');
  if (closeBtn) {
    e.stopPropagation();
    closeBrowserTab(closeBtn.dataset.closeTab);
    return;
  }
  const tabEl = e.target.closest('[data-ws-tab]');
  if (tabEl) activateWorkspaceTab(tabEl.dataset.wsTab);
});
$('#browser-tabs').addEventListener('auxclick', (e) => {
  if (e.button === 1) {
    const tabEl = e.target.closest('[data-ws-tab]');
    if (tabEl) { e.preventDefault(); closeBrowserTab(tabEl.dataset.wsTab); }
  }
});

function navigateActiveTab(targetUrl) {
  const tab = state.browserTabs.find((t) => t.id === state.activeWsTab);
  if (!tab) return openInTab(targetUrl, { activate: true });
  tab.url = targetUrl;
  const m = describeTornUrl(targetUrl);
  tab.icon = m.icon; tab.title = m.title;
  if (window.electronAPI?.tabNavigate) {
    window.electronAPI.tabNavigate(tab.id, targetUrl);
  } else if (tab.wv) {
    tab.wv.setAttribute('src', targetUrl);
  }
  renderBrowserTabs();
  updateBrowserToolbar();
}

$('#b-back').addEventListener('click', () => {
  if (window.electronAPI?.tabAction && state.activeWsTab !== 'tracker') window.electronAPI.tabAction(state.activeWsTab, 'back');
});
$('#b-fwd').addEventListener('click', () => {
  if (window.electronAPI?.tabAction && state.activeWsTab !== 'tracker') window.electronAPI.tabAction(state.activeWsTab, 'forward');
});
$('#b-reload').addEventListener('click', () => {
  if (window.electronAPI?.tabAction && state.activeWsTab !== 'tracker') window.electronAPI.tabAction(state.activeWsTab, 'reload');
});
$('#b-home').addEventListener('click', () => navigateActiveTab('https://www.torn.com/index.php'));
$('#b-external').addEventListener('click', () => {
  const tab = state.browserTabs.find((t) => t.id === state.activeWsTab);
  if (!tab?.url) return;
  if (window.electronAPI?.openExternal) window.electronAPI.openExternal(tab.url);
  else window.open(tab.url, '_blank', 'noopener');
});

function toggleLoginModal(show) {
  const m = $('#login-modal');
  if (!m) return;
  m.hidden = !show;
  if (window.electronAPI?.setViewVisibility) {
    window.electronAPI.setViewVisibility(!show);
  }
}
$('#b-login-help')?.addEventListener('click', () => toggleLoginModal(true));
$('#ext-login-btn')?.addEventListener('click', () => {
  if (!window.electronAPI?.externalLogin) return toast(tr('Bu özellik masaüstü uygulamasında çalışır', 'This feature only works in the desktop app'));
  window.electronAPI.externalLogin();
});
window.electronAPI?.onLoginStatus?.((s) => {
  const el = $('#ext-login-status');
  if (el) el.innerHTML = `<span class="chip ${s.state === 'done' ? 'green' : s.state === 'error' ? 'danger' : 'tq'}">${s.state === 'done' ? '✓' : s.state === 'error' ? '!' : '…'}</span> ${esc(s.message)}`;
  toast(s.message);
  if (s.state === 'done') {
    state.tornLoggedIn = true;
    updateLoginHelpVisibility();
    toggleLoginModal(false);
  }
});
$('#login-modal-close')?.addEventListener('click', () => toggleLoginModal(false));
$('#login-modal-cancel')?.addEventListener('click', () => toggleLoginModal(false));
$('#cookie-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const phpSessId = ($('#c-sess')?.value || '').trim();
  const uid = ($('#c-uid')?.value || '').trim();
  const passOrRaw = ($('#c-pass')?.value || '').trim();
  if (!phpSessId && !passOrRaw) {
    return toast(tr('Lütfen PHPSESSID veya Cookie metni girin', 'Please enter a PHPSESSID or a cookie string'));
  }
  const isRaw = passOrRaw.includes('=');
  if (window.electronAPI?.setTornCookies) {
    await window.electronAPI.setTornCookies({
      phpSessId,
      uid,
      pass: isRaw ? '' : passOrRaw,
      raw: isRaw ? passOrRaw : '',
    });
    toggleLoginModal(false);
    toast(tr('Torn oturum çerezleri uygulandı ve sekme yenilendi ✓', 'Torn session cookies applied and tab reloaded ✓'));
  }
});
$('#browser-context-actions').addEventListener('click', (e) => {
  const navBtn = e.target.closest('[data-nav-active]');
  if (navBtn) navigateActiveTab(navBtn.dataset.navActive);
});
$('#browser-url-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = ($('#browser-url').value || '').trim();
  if (!raw) return;
  let targetUrl = raw;
  if (/^\d+$/.test(raw)) {
    targetUrl = `https://www.torn.com/profiles.php?XID=${raw}`;
  } else if (!/^(https?|chrome-extension):\/\//i.test(raw)) {
    targetUrl = 'https://' + raw;
  }
  navigateActiveTab(targetUrl);
});

/* ---------- Uygulama güncelleme ---------- */
state.update = null;
function renderUpdateBtn() {
  const u = state.update;
  const label = $('#update-label'), dot = $('#update-dot'), btn = $('#update-btn');
  if (!btn) return;
  label.textContent = u?.restartOnly ? `v${u.latest} · ${tr('yeniden başlat', 'restart')}` : u?.available ? `v${u.latest} ${tr('hazır', 'ready')}` : `v${u?.current || '—'}`;
  dot.hidden = !u?.available;
  btn.classList.toggle('has-update', !!u?.available);
  btn.title = !u ? '' : u.restartOnly ? tr(`v${u.latest} kuruldu ama çalışan sürüm v${u.current} — yeniden başlatmak için tıkla`, `v${u.latest} is installed but v${u.current} is running — click to restart`)
    : u.available ? tr(`Yeni sürüm v${u.latest} — kurmak için tıkla`, `New version v${u.latest} — click to install`)
    : u.error ? tr('Güncelleme kontrolü başarısız: ', 'Update check failed: ') + u.error
      : u.configured === false ? tr('Güncelleme adresi ayarlı değil', 'No update URL set')
        : tr('En güncel sürüm — tekrar kontrol için tıkla', 'Up to date — click to check again');
}
async function checkUpdate(manual, force = false) {
  if (!manual && !force && state.config?.features?.['app.updates'] === false) return;
  if (!window.electronAPI?.updateCheck) { const b = $('#update-btn'); if (b) b.hidden = true; return; }
  state.update = await window.electronAPI.updateCheck().catch((e) => ({ error: e.message }));
  renderUpdateBtn();
  renderUpdateInfo();
  if (manual) {
    const u = state.update;
    if (u.configured === false) toast(tr('Bu kurulumda güncelleme adresi yok', 'This build has no update address'));
    else if (u.error) toast(tr('Güncelleme kontrolü başarısız: ', 'Update check failed: ') + u.error);
    else if (!u.available) toast(tr(`En güncel sürümdesin (v${u.current})`, `You're on the latest version (v${u.current})`));
  }
}
let updateInstalling = false;
function closeUpdateDialog() {
  if (updateInstalling) return;
  $('#update-modal').hidden = true;
  window.electronAPI?.setViewVisibility?.(true);
  $('#update-btn').focus();
}
$('#update-btn')?.addEventListener('click', () => {
  const u = state.update;
  if (!u?.available) return checkUpdate(true);
  $('#update-dialog-title').textContent = u.restartOnly ? tr('Yeniden başlat', 'Restart application') : tr('Uygulamayı güncelle', 'Update application');
  $('#update-dialog-description').textContent = 'v' + u.latest + ' · ' + tr('Kurulumdan sonra uygulama tamamen kapanıp tekrar açılacak.', 'The app will fully close and reopen after installation.');
  $('#update-dialog-notes').textContent = u.notes || '';
  $('#update-dialog-status').textContent = '';
  $('#update-dialog-progress').hidden = true;
  $('#update-dialog-cancel').textContent = tr('Vazgeç', 'Cancel');
  $('#update-dialog-install').textContent = u.restartOnly ? tr('Yeniden başlat', 'Restart') : tr('Kur ve yeniden başlat', 'Install and restart');
  $('#update-modal').hidden = false;
  window.electronAPI?.setViewVisibility?.(false);
  $('#update-dialog-install').focus();
});
$('#update-dialog-close').addEventListener('click', closeUpdateDialog);
$('#update-dialog-cancel').addEventListener('click', closeUpdateDialog);
$('#update-modal').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeUpdateDialog(); }
  if (e.key === 'Tab') {
    const buttons = [...$('#update-modal').querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) return e.preventDefault();
    const i = buttons.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); buttons.at(-1).focus(); }
    else if (!e.shiftKey && i === buttons.length - 1) { e.preventDefault(); buttons[0].focus(); }
  }
});
$('#update-dialog-install').addEventListener('click', async () => {
  if (updateInstalling) return;
  updateInstalling = true;
  $$('#update-modal button').forEach((b) => b.disabled = true);
  $('#update-dialog-status').textContent = tr('Hazırlanıyor…', 'Preparing…');
  try {
    const result = await window.electronAPI.updateApply();
    if (!result.ok) throw new Error(result.error);
  } catch (error) {
    updateInstalling = false;
    $('#update-dialog-status').textContent = tr('Güncelleme başarısız: ', 'Update failed: ') + error.message;
    $$('#update-modal button').forEach((b) => b.disabled = false);
  }
});
window.electronAPI?.onUpdateProgress?.((p) => {
  $('#update-label').textContent = p.message;
  $('#update-dialog-status').textContent = p.message;
  const progress = $('#update-dialog-progress'); progress.hidden = false;
  progress.value = ({ download: 1, extract: 2, install: 3, done: 4, restart: 5 })[p.step] || 0;
});
window.electronAPI?.onUpdatePending?.(() => checkUpdate(false, true)); // kurulu ama çalışmayan sürüm: ayar kapalı olsa da göster
setTimeout(() => checkUpdate(false), 2500); // config yüklensin (app.updates ayarı)
setInterval(() => checkUpdate(false), 6 * 3600_000);

/* ---------- TornTools (Chrome eklentisi) ---------- */
function renderTornToolsBtn() {
  const b = $('#tt-open-btn');
  if (!b) return;
  const s = state.tornTools;
  const sub = $('#tt-open-state');
  b.classList.toggle('loading', s?.status === 'loading');
  b.title = !isElectronApp()
    ? tr('TornTools yalnızca masaüstü uygulamasında çalışır', 'TornTools only runs in the desktop app')
    : s?.status === 'ready' ? `TornTools v${s.version} · ${tr('ayarları aç', 'open settings')}`
      : s?.status === 'error' ? `${tr('TornTools yüklenemedi', 'TornTools failed to load')}: ${s.error}`
        : tr('TornTools indiriliyor / yükleniyor…', 'TornTools downloading / loading…');
  if (sub) sub.textContent = s?.status === 'ready' ? `v${s.version}` : s?.status === 'error' ? '!' : '…';
}
$('#tt-open-btn')?.addEventListener('click', async () => {
  if (!window.electronAPI?.tornToolsInfo) {
    return openInTab('https://chromewebstore.google.com/detail/torntools/hjpaapdjcgbmeikfnahipphknonhlhib', { activate: true });
  }
  state.tornTools = await window.electronAPI.tornToolsInfo();
  renderTornToolsBtn();
  const s = state.tornTools;
  if (s.status === 'ready') {
    openInTab(`chrome-extension://${s.id}/options.html`, { activate: true, label: 'TornTools', reuse: true });
  } else if (s.status === 'error') {
    toast(tr('TornTools yüklenemedi: ', 'TornTools failed to load: ') + s.error);
  } else {
    toast(tr('TornTools indiriliyor, birkaç saniye sonra tekrar dene…', 'TornTools is downloading, try again in a few seconds…'));
  }
});
if (window.electronAPI?.tornToolsInfo) {
  window.electronAPI.tornToolsInfo().then((s) => { state.tornTools = s; renderTornToolsBtn(); }).catch(() => {});
  window.electronAPI.onTornToolsStatus?.((s) => {
    state.tornTools = s; renderTornToolsBtn();
    if (s.status === 'ready') toast(`TornTools v${s.version} ${tr('hazır', 'ready')} ✓`);
  });
} else {
  renderTornToolsBtn();
}

// Aktif profil/saldırı sekmesindeki oyuncunun durumunu periyodik tazele
setInterval(() => {
  if (state.activeWsTab === 'tracker') return;
  const tab = state.browserTabs.find((t) => t.id === state.activeWsTab);
  const xid = tab && extractPlayerId(tab.url);
  if (xid) refreshPlayerInfo(xid);
}, 15_000);

if (window.electronAPI?.onOpenTab) {
  window.electronAPI.onOpenTab((url) => {
    openInTab(url, { activate: true });
  });
}
// Torn sekmesinden gelen veriler (ör. şirket stok sayfasındaki gerçek teslim sayaçları)
if (window.electronAPI?.onTornData) {
  window.electronAPI.onTornData((data) => {
    if (data.type === 'navigation-loop-stopped') toast(tr('Hızlı gezinme döngüsü durduruldu. İstediğin sayfayı tekrar açabilirsin.', 'Rapid navigation loop stopped. You can reopen the page.'));
    if (data?.type !== 'stock-deliveries') return;
    loadCompany(false).catch(() => {});
    toast(data.count
      ? tr(`Torn'dan ${data.count} sevkiyatın teslim süresi alındı ✓`, `Got delivery times for ${data.count} shipments from Torn ✓`)
      : tr('Torn stok sayfasında yolda sevkiyat yok', 'No shipments in transit on the Torn stock page'));
  });
}
if (window.electronAPI?.onTabUpdated) {
  window.electronAPI.onTabUpdated((data) => {
    const tab = state.browserTabs.find((t) => t.id === data.id);
    if (!tab) return;
    tab.loading = !!data.loading;
    if (typeof data.loggedIn === 'boolean' && /torn\.com/i.test(data.url || '')) {
      state.tornLoggedIn = data.loggedIn;
      updateLoginHelpVisibility();
    }
    if (data.url && /^(https?|chrome-extension):\/\//i.test(data.url)) {
      tab.url = data.url;
      const m = describeTornUrl(data.url);
      tab.icon = m.icon;
    }
    const cleanTitle = String(data.title || '').replace(/\s*\|\s*TORN\s*$/i, '').trim();
    if (cleanTitle && !/^https?:\/\//i.test(cleanTitle)) {
      tab.title = cleanTitle;
    }
    renderBrowserTabs();
    if (state.activeWsTab === tab.id) updateBrowserToolbar();
  });
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'rehab-tpl-input' && state.company) {
    state.rehabTpl = e.target.value;
    state.rehabTplKey = 'custom';
    localStorage.setItem('tt.rehabTplEnKey', 'custom');
    localStorage.setItem('tt.rehabTplEn', state.rehabTpl);
    $$('[data-emp-msg]').forEach((box) => {
      const id = Number(box.dataset.empMsg);
      const emp = state.company.employees.find((x) => x.id === id);
      if (emp) box.textContent = formatRehabMsg(emp.name, emp.addiction);
    });
  }
});

/* =========================================================
   LRX LOGIN / SPLASH
   ========================================================= */
const prefersReducedMotion = () => document.body.classList.contains('no-anim') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const NEW_KEY_URL = 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=LRX%20Torn%20Tracker&type=3';

let authWaves = null;
function showAuth(mode = 'login') {
  const scr = $('#auth-screen');
  scr.hidden = false;
  try {
    if (!authWaves && window.LRXShapeWaves) authWaves = window.LRXShapeWaves.create($('#auth-waves'));
    authWaves?.start();
  } catch (e) { console.warn('ShapeWaves', e); }
  scr.classList.remove('leaving', 'splash', 'login');
  scr.classList.add(mode);
  document.body.classList.add('auth-open');
  $('#auth-welcome').textContent = '';
  $('#auth-error').textContent = '';
  if (mode === 'login') setTimeout(() => $('#auth-key')?.focus(), 450);
}
function hideAuth(delay = 0) {
  const scr = $('#auth-screen');
  return new Promise((resolve) => setTimeout(() => {
    scr.classList.add('leaving');
    document.body.classList.remove('auth-open');
    document.body.classList.add('app-enter');
    setTimeout(() => { scr.hidden = true; scr.classList.remove('leaving'); authWaves?.stop(); resolve(); }, prefersReducedMotion() ? 0 : 650);
    setTimeout(() => document.body.classList.remove('app-enter'), 1600);
  }, delay));
}

$('#auth-eye')?.addEventListener('click', () => {
  const i = $('#auth-key');
  i.type = i.type === 'password' ? 'text' : 'password';
  i.focus();
});
$('#auth-get-key')?.addEventListener('click', (e) => {
  e.preventDefault();
  if (window.electronAPI?.openExternal) window.electronAPI.openExternal(NEW_KEY_URL);
  else window.open(NEW_KEY_URL, '_blank', 'noopener');
});
$('#auth-credit')?.addEventListener('click', (e) => {
  e.preventDefault();
  const url = e.currentTarget.href;
  if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
  else window.open(url, '_blank', 'noopener');
});
$('#auth-key')?.addEventListener('input', (e) => {
  // Preserve typing, cursor position and case. Never silently truncate or rewrite a key.
  const key = e.target.value.trim();
  $('#auth-key-count').textContent = `${key.length} / 16`;
  e.target.setAttribute('aria-invalid', String(key.length > 0 && !/^[A-Za-z0-9]{16}$/.test(key)));
  $('#auth-error').textContent = '';
  $('#auth-card').classList.remove('shake');
});
$('#auth-key')?.addEventListener('keydown', (e) => {
  const caps = $('#auth-caps');
  caps.hidden = !e.getModifierState('CapsLock');
  caps.textContent = tr('Caps Lock açık · API anahtarı büyük/küçük harfe duyarlıdır.', 'Caps Lock is on · API keys are case-sensitive.');
});
$('#auth-paste')?.addEventListener('click', async () => {
  try {
    const value = window.electronAPI?.readClipboard ? await window.electronAPI.readClipboard() : await navigator.clipboard.readText();
    $('#auth-key').value = String(value).trim();
    $('#auth-key').dispatchEvent(new Event('input', { bubbles: true }));
    $('#auth-key').focus();
  } catch { $('#auth-error').textContent = tr('Ctrl+V veya sağ tık → Yapıştır kullan.', 'Use Ctrl+V or right-click → Paste.'); }
});
function shakeAuth() {
  const card = $('#auth-card');
  card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
}
$('#auth-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = $('#auth-key').value.trim();
  const btn = $('#auth-submit'), err = $('#auth-error'), card = $('#auth-card');
  if (!/^[A-Za-z0-9]{16}$/.test(key)) {
    err.textContent = tr('API key tam 16 harf/rakam olmalı. Büyük/küçük harfleri kontrol et.', 'API key must be exactly 16 letters or digits. Check uppercase and lowercase letters.');
    return shakeAuth();
  }
  btn.classList.add('loading'); btn.disabled = true;
  try {
    const r = await api('/api/auth', { method: 'POST', body: JSON.stringify({ apiKey: key }) });
    $('#auth-key').value = '';
    if (r.resetData) { try { localStorage.removeItem('tt.cache.overview'); localStorage.removeItem('tt.cache.company'); } catch {} }
    card.classList.add('success');
    $('#auth-welcome').innerHTML = `${tr('Hoş geldin,', 'Welcome,')} <b>${esc(r.player.name)}</b>`;
    startApp(null, true);
    await hideAuth(prefersReducedMotion() ? 0 : 1300);
    card.classList.remove('success');
  } catch (ex) {
    err.textContent = ex.name === 'TimeoutError'
      ? tr('Bağlantı zaman aşımına uğradı. Tekrar dene.', 'Connection timed out. Please try again.')
      : ex.message;
    shakeAuth();
  } finally {
    btn.classList.remove('loading'); btn.disabled = false;
  }
});

async function logout() {
  if (!confirm(tr('Çıkış yapılsın mı? API key bu bilgisayardan silinecek.', 'Log out? The API key will be removed from this computer.'))) return;
  for (const t of [...state.browserTabs]) closeBrowserTab(t.id);
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('tt.cache.')) localStorage.removeItem(k); } catch {}
  location.hash = '';
  location.reload();
}
$('#logout-btn')?.addEventListener('click', logout);

/* Sayıların yumuşak sayaçla değişmesi (KPI, büyük rakamlar) */
const numMemory = new Map();
function animateNumbers(root = document) {
  if (prefersReducedMotion() || !root) return;
  const els = $$('.kpi .value, .big-num, .bs-total strong', root);
  const counters = new Map();
  for (const el of els) {
    if (el.children.length) continue;
    const box = el.closest('[id]')?.id || 'doc';
    const idx = counters.get(box) || 0;
    counters.set(box, idx + 1);
    const key = `${box}:${idx}`;
    const txt = el.textContent.trim();
    const m = txt.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
    if (!m) { numMemory.set(key, null); continue; }
    const [, pre, numStr, suf] = m;
    const to = Number(numStr.replace(/,/g, ''));
    const prev = numMemory.get(key);
    numMemory.set(key, { to, suf });
    if (!isFinite(to)) continue;
    const from = prev === undefined ? 0 : prev && prev.suf === suf ? prev.to : to;
    if (from === to) continue;
    const dec = (numStr.split('.')[1] || '').length;
    const grouped = numStr.includes(',');
    const fmt = (v) => {
      const [i, d] = Math.abs(v).toFixed(dec).split('.');
      return (v < 0 ? '-' : '') + (grouped ? Number(i).toLocaleString('en-US') : i) + (d ? '.' + d : '');
    };
    const t0 = performance.now(), dur = 750;
    const step = (now) => {
      if (!el.isConnected) return;
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = pre + fmt(from + (to - from) * eased) + suf;
      if (p < 1) requestAnimationFrame(step); else el.textContent = txt;
    };
    requestAnimationFrame(step);
  }
}

let appStarted = false;
function startApp(b, fresh = false) {
  if (appStarted) { if (fresh) refreshAll(true); return; }
  appStarted = true;
  $$('#mode-toggle button').forEach((x) => x.classList.toggle('active', x.dataset.mode === state.mode));
  const qf = Number(new URLSearchParams(location.search).get('faction'));
  if (qf) state.factionId = qf;

  // 1. Instant render from localStorage cache
  if (!fresh) {
    try {
      const cachedOv = JSON.parse(localStorage.getItem('tt.cache.overview') || 'null');
      if (cachedOv?.data?.battle?.calculationVersion === 2) {
        state.overview = cachedOv.data;
        state.overviewAt = cachedOv.at || Date.now();
        renderOverview();
      }
      const cachedCo = JSON.parse(localStorage.getItem('tt.cache.company') || 'null');
      if (cachedCo?.company) {
        state.company = cachedCo;
        renderCompany();
      }
    } catch {}
  }

  const initial = (location.hash || '').slice(1);
  if (VIEW_META[initial]) showView(initial);
  applyCompanyMode(state.companyMode);
  tick();
  setInterval(tick, 1000);

  // 2. Local disk bootstrap
  if (b) {
    if (b.config) { state.config = b.config; window.applyFeatures?.(); }
    if (b.overview && (!state.overview || (b.overviewAt && b.overviewAt > state.overviewAt))) {
      state.overview = b.overview;
      state.overviewAt = b.overviewAt || Date.now();
      try { localStorage.setItem('tt.cache.overview', JSON.stringify({ data: b.overview, at: state.overviewAt })); } catch {}
      renderOverview();
    }
    if (b.company && (!state.company || (b.companyAt && b.companyAt > (state.company.fetchedAt || 0)))) {
      state.company = b.company;
      try { localStorage.setItem('tt.cache.company', JSON.stringify(b.company)); } catch {}
      renderCompany();
    }
  }

  // 3. Live Torn API update
  refreshAll(true);

  // Görünürken sık, gizliyken seyrek (bildirim tahminleri için genel bakış yine de 2 dk'da bir tazelenir)
  setInterval(() => { if (trackerVisible() || Date.now() - (state.overviewAt || 0) > 120_000) loadOverview(false); }, 30_000);
  setInterval(() => { if (trackerVisible()) loadCompany(false); }, 120_000);
  setInterval(() => { if (trackerVisible() && state.view === 'war' && state.factionId && Date.now() - state.targetsAt > 30_000) loadTargets(); }, 10_000);
}

(async function boot() {
  applyLang();
  let b = null;
  try { b = await api('/api/bootstrap'); } catch {}
  if (b?.config) { state.config = b.config; window.applyFeatures?.(); }
  if (b?.config && !b.config.hasKey) {
    showAuth('login');
    return;
  }
  let splashSeen = false;
  try { splashSeen = !!sessionStorage.getItem('tt.splashShown'); sessionStorage.setItem('tt.splashShown', '1'); } catch {}
  document.body.classList.toggle('no-anim', b?.config?.features?.['app.animations'] === false);
  if (!prefersReducedMotion() && !splashSeen && b?.config?.features?.['app.splash'] !== false) {
    showAuth('splash');
    startApp(b);
    hideAuth(1400);
  } else {
    startApp(b);
  }
})();
