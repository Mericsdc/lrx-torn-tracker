/* =========================================================
   LRX extra features
   - Ayarlar → Özellikler: her özelliği aç / kapat
   - Masaüstü bildirimleri
   - İş Asistanı, Gym & Statlar, Seyahat Kârı sayfaları (Networth: Finance page, finance.js)
   Bu dosya app.js'ten sonra yüklenir ve onun yardımcılarını kullanır.
   ========================================================= */

/* ---------- Özellik tanımları ---------- */
const FEATURE_DEFS = [
  { group: 'pages', key: 'page.job', def: true, tr: ['İş Asistanı', 'Uygun şirket pozisyonları · bir işin varken gizlenir'], en: ['Job Assistant', 'Positions that fit your working stats · hidden while you have a job'] },
  { group: 'pages', key: 'page.gym', def: true, tr: ['Gym & Statlar', 'Battle stat geçmişi ve günlük artış'], en: ['Gym & Stats', 'Battle stat history and daily gains'] },
  { group: 'pages', key: 'page.networth', def: true, tr: ['Finans: Networth sekmesi', 'Servet dağılımı, dönem değişimi ve geçmiş'], en: ['Finance: Networth tab', 'Wealth allocation, change over a period and history'] },
  { group: 'pages', parent: 'page.networth', key: 'finance.milestone', def: true, tr: ['Sonraki networth eşiği', "Torn'un networth rank eşiklerine ilerleme ve tahmini süre"], en: ['Next networth milestone', "Progress and an estimated time to Torn's networth rank triggers"] },
  { group: 'pages', key: 'page.travel', def: true, tr: ['Seyahat Kârı', "Kâr, stok ve restock zamanları (YATA + Prometheus) · seviye 15'ten itibaren görünür"], en: ['Travel Profit', 'Profit, stock and restock times (YATA + Prometheus) · shown from level 15'] },
  { group: 'pages', key: 'page.war', def: true, tr: ['Savaş Hedefleri', 'Fair Fight hedef önerileri'], en: ['War Targets', 'Fair Fight target suggestions'] },
  { group: 'pages', parent: 'page.war', key: 'war.groups', def: true, tr: ['Hedef grupları', 'Rakipleri gruplara ayır ve gruba göre filtrele · bu bilgisayarda saklanır'], en: ['Target groups', 'Sort enemies into groups and filter by group · saved on this computer'] },
  { group: 'pages', key: 'page.crimes', def: true, tr: ['Suç Merkezi', 'Shoplifting güvenliği (API) ve nerve başına kazanç'], en: ['Crime Hub', 'Shoplifting security (API) and money per nerve'] },
  { group: 'pages', parent: 'page.crimes', key: 'crimes.shoplift', def: true, tr: ["Shoplifting güvenliği", "Mağaza güvenlik durumu ve ★ alarmı"], en: ["Shoplifting security", "Store security status and ★ alerts"] },
  { group: 'pages', parent: 'page.crimes', key: 'crimes.value', def: true, tr: ["Nerve başına kazanç tablosu", "Bütün suçların $/N değerleri (Emforus tablosu)"], en: ["Money per nerve table", "$/N for every crime (Emforus sheet)"] },
  { group: 'pages', parent: 'page.crimes', key: 'crimes.burglary', def: true, tr: ["Burglary hedefleri", "34 hedefin keşif sayısı, nerve ve $/N tablosu"], en: ["Burglary targets", "Casings, nerve and $/N for all 34 targets"] },
  { group: 'pages', parent: 'page.crimes', key: 'crimes.jail', def: true, tr: ["Jail bust takibi", "Son 24 / 72 saatteki bustlar ve tahmini ceza puanı"], en: ["Jail bust tracker", "Busts in the last 24 / 72 hours and estimated penalty score"] },
  { group: 'pages', key: 'page.faction', def: true, tr: ['Faction', "Kendi OC durumun · OC'ye girmeyenler, geciken OC'ler ve haftalık üye raporu (yalnızca lider, eş lider ve Organised Crimes yetkili pozisyonlar)"], en: ['Faction', 'Your OC status · members not in an OC, delayed OCs and the weekly member report (leader, co-leader and positions with the Organised Crimes permission only)'] },
  { group: 'pages', key: 'page.awards', def: true, tr: ['Merit Takibi', 'Eksik honor / medal\'lar ve ilerlemen'], en: ['Merit Tracker', 'Missing honors / medals and your progress'] },
  { group: 'pages', key: 'page.tools', def: true, tr: ['Araçlar', 'Alış fiyatı koruması, etkinlik takvimi ve rehberi, happy jump kartı'], en: ['Tools', 'Purchase price protection, event calendar and guide, happy jump card'] },
  { group: 'pages', parent: 'page.tools', key: 'tools.events', def: true, tr: ["Etkinlik takvimi", "Yaklaşan Torn etkinlikleri ve geri sayım"], en: ["Event calendar", "Upcoming Torn events with countdowns"] },
  { group: 'pages', parent: 'page.tools', key: 'tools.purchases', def: true, tr: ["Alış fiyatı kayıtları", "Alış fiyatlarını kaydet ve listele (Torn'daki uyarı için gerekir)"], en: ["Purchase price records", "Record and list purchase prices (needed for the warning in Torn)"] },
  { group: 'pages', parent: 'page.tools', key: 'tools.happyJump', def: true, tr: ['Happy jump kartı', "Canlı hazırlık listesi ve adım adım happy jump rehberi · seviye 15'ten itibaren (altında Başlangıç Rehberi'nde)"], en: ['Happy jump card', 'Live readiness checklist and a step-by-step happy jump guide · from level 15 (below it, in the Beginner Guide)'] },
  { group: 'pages', parent: 'page.tools', key: 'tools.helpers', def: true, tr: ["Torn yardımcıları listesi", "Torn sayfa yardımcılarının ne yaptığı ve durumu"], en: ["Torn helpers list", "What each Torn page helper does and whether it is on"] },
  { group: 'pages', key: 'page.levelling', def: true, tr: ['Seviye 15 altı', "Baldr's Levelling Targets ve Başlangıç Rehberi · yalnızca seviye 15'in altındayken görünür"], en: ['Under level 15', "Baldr's Levelling Targets and Beginner Guide · shown only below level 15"] },
  { group: 'pages', key: 'page.company', def: true, tr: ['Şirket sayfaları', 'Stok, rapor, çalışanlar ve Finans şirket sekmesi (yalnızca direktör)'], en: ['Company pages', 'Stock, report, employees and the Finance company tab (directors only)'] },

  { group: 'notify', key: 'notify', def: true, master: true, tr: ['Masaüstü bildirimleri', 'Tümünü aç / kapat'], en: ['Desktop notifications', 'Turn all on / off'] },
  { group: 'notify', key: 'notify.energy', def: true, tr: ['Enerji doldu', ''], en: ['Energy full', ''] },
  { group: 'notify', key: 'notify.nerve', def: true, tr: ['Nerve doldu', ''], en: ['Nerve full', ''] },
  { group: 'notify', key: 'notify.drug', def: true, tr: ['Drug cooldown bitti', ''], en: ['Drug cooldown over', ''] },
  { group: 'notify', key: 'notify.booster', def: false, tr: ['Booster cooldown bitti', ''], en: ['Booster cooldown over', ''] },
  { group: 'notify', key: 'notify.medical', def: false, tr: ['Medical cooldown bitti', ''], en: ['Medical cooldown over', ''] },
  { group: 'notify', key: 'notify.education', def: true, tr: ['Eğitim bitti', ''], en: ['Education course finished', ''] },
  { group: 'notify', key: 'notify.travel', def: true, tr: ['Uçak indi', ''], en: ['Plane landed', ''] },
  { group: 'notify', key: 'notify.hospital', def: true, tr: ['Hastaneden çıktın', ''], en: ['Out of hospital', ''] },
  { group: 'notify', key: 'notify.bank', def: true, tr: ['Banka yatırımın bitti', ''], en: ['Bank investment finished', ''] },
  { group: 'notify', key: 'notify.oc', def: true, tr: ["OC: eşyan eksik, planlama bitti ya da OC'n bitti", ''], en: ['OC: your item is missing, planning finished or your OC ended', ''] },
  { group: 'notify', key: 'notify.factionOc', def: true, tr: ["Faction OC: geciken ya da eşyası eksik OC (lider ve yetkililer)", ''], en: ['Faction OC: delayed OCs or OCs missing an item (leader and authorized positions)', ''] },
  { group: 'notify', key: 'notify.restock', def: true, tr: ['Takip ettiğin ürün (★): kalkış zamanı ve restock', ''], en: ['Watched item (★): departure time and restock', ''] },
  { group: 'notify', key: 'notify.shoplift', def: true, tr: ['Shoplifting: takip ettiğin (★) mağazada bütün güvenlik kapandı', ''], en: ['Shoplifting: all security down at a watched (★) store', ''] },
  { group: 'notify', key: 'notify.events', def: true, tr: ['Etkinlik başladı (Easter, Trick or Treat, Christmas Town)', ''], en: ['Event started (Easter, Trick or Treat, Christmas Town)', ''] },
  { group: 'notify', key: 'notify.targets', def: true, tr: ['Açık sekmedeki oyuncu hastaneden çıktı', ''], en: ['Player in an open tab left hospital', ''] },

  { group: 'torn', key: 'torn.warHelper', def: true, tr: ['Savaş: Attack & hastane sayacı', 'Ranked war sayfasında rakibin yanında Attack, iki tarafta hastane geri sayımı'], en: ['War: Attack & hospital timers', 'Attack button next to each enemy and hospital countdowns for both sides on the ranked war page'] },
  { group: 'torn', key: 'torn.liveFight', def: true, tr: ['Canlı savaş analizi', 'Saldırı ekranında iki tarafın canı, gözlenen can kaybı ve iyileşme'], en: ['Live fight analysis', 'Both players’ life, observed life loss and recovery on the attack page'] },
  { group: 'torn', key: 'torn.ffScouterScript', def: true, tr: ['FF Scouter V2 · 3.4', 'Kayıtlı FFScouter anahtarını, yoksa Torn API anahtarını otomatik kullanır · yeniden başlatınca uygulanır'], en: ['FF Scouter V2 · 3.4', 'Automatically uses your saved FFScouter key, or your Torn API key · restart to apply'] },
  { group: 'torn', key: 'torn.tornw3bScript', def: true, tr: ['TornW3B Bazaar · 4.1.8', 'Item Market içinde bazaar teklifleri · açık artırma ilanlarını Weav3r’a senkronlar · yeniden başlatınca uygulanır'], en: ['TornW3B Bazaar · 4.1.8', 'Bazaar offers in Item Market · syncs auction listings to Weav3r · restart to apply'] },
  { group: 'torn', key: 'torn.openMarketScript', def: true, tr: ['OpenMarket · 1.11.9', 'Item Market, bazaar ve açık artırmada silahların kalite yüzdesi ve bonusları · sıralama ve filtre ekleri kapalı · yeniden başlatınca uygulanır'], en: ['OpenMarket · 1.11.9', 'Weapon and armor quality % and bonuses on the Item Market, bazaars and the Auction House · its sort and filter add-ons are off · restart to apply'] },
  { group: 'torn', key: 'torn.crimeHelper', def: true, tr: ['Yankesicilik: XP ve renkler', "Her hedefin yanında Crime XP çarpanı (%100–350) · skill'ine göre en iyi hedef koyu yeşil, riskli olanlar kırmızı"], en: ['Pickpocketing: XP and colors', 'Crime XP multiplier next to each mark (100–350%) · best mark for your skill in dark green, risky ones in red'] },
  { group: 'torn', key: 'torn.crimeValue', def: true, tr: ['Suçlar: nerve başına kazanç', "Suç merkezinde ve seçeneklerde $/N rozeti (Emforus tablosu) · Disposal'da en iyi yöntem yeşil"], en: ['Crimes: money per nerve', '$/N badges on the Torn crimes hub and on each option (Emforus sheet) · best Disposal method in green'] },
  { group: 'torn', key: 'torn.crimeRank', def: true, tr: ['Suçlar: düğme renkleri', "Her seçeneğin sağındaki düğmenin (Search, Shoplift, Disposal yöntemleri…) etrafı $/N sırasına göre: kırmızı en kötü → sarı → yeşil en iyi"], en: ['Crimes: button colors', 'The button on the right of each option (Search, Shoplift, Disposal methods…) is outlined by $/N rank: red worst → yellow → green best'] },
  { group: 'torn', key: 'torn.burglaryHelper', def: true, tr: ['Burglary yardımcısı', 'Her hedefte önerilen keşif (case) sayısı, $/N ve güvenlik notu · satırlar gizlenmez'], en: ['Burglary helper', 'Recommended casings, $/N and safety note for each target · rows are never hidden'] },
  { group: 'torn', key: 'torn.jailHelper', def: true, tr: ['Jail: bust zorluğu', 'Her mahkûmun yanında zorluk puanı (seviye × (saat+3)) ve renk · onay atlatma yok'], en: ['Jail: bust difficulty', 'Difficulty score (level × (hours+3)) and color next to each inmate · never skips the confirmation'] },
  { group: 'torn', key: 'torn.sellGuard', def: true, tr: ['Alış fiyatı koruması', 'Item Market / bazaar ilanında alış fiyatının altına girersen kırmızı uyarı'], en: ['Purchase price protection', 'Red warning on Item Market / bazaar listings priced below what you paid'] },
  { group: 'torn', key: 'torn.bazaarUndercut', def: true, tr: ['Bazaar: $1 altına fiyat', "Bazaar → Add items ve Manage'de her eşyanın yanında −$1 düğmesi: tıkladığın eşyanın fiyat kutusuna weav3r.dev'deki en ucuz diğer bazaar fiyatının $1 altını yazar · miktarı ve Torn'daki onayı (Add / Update) sen verirsin"], en: ['Bazaar: undercut by $1', "A −$1 button next to each item on Bazaar → Add items and Manage: fills the price box of the item you click with $1 under the cheapest other bazaar on weav3r.dev · you enter the amount and confirm on Torn (Add / Update) yourself"] },
  { group: 'torn', key: 'torn.profileWorkStats', def: true, tr: ['Profil: çalışma statları + şirket yıldızı', "Oyuncu profilinde Life satırının üstüne çalışma statları (Hall of Fame) ve şirketin x/10 yıldızı · profil başına 2 Torn API isteği, kayıtlı anahtarınla · bellekte saklanır (oyuncu 12 sa, şirket 24 sa) · yalnızca baktığın sekmede"], en: ['Profile: working stats + company stars', "Working stats (Hall of Fame) and the company's x/10 stars above Life on player profiles · 2 Torn API requests per profile with your saved key · kept in memory (player 12 h, company 24 h) · only in the tab you are viewing"] },
  { group: 'torn', key: 'torn.pokerHelper', def: true, tr: ['Poker oranları', "Hold'em masasında elin adı ve kazanma yüzdesi · tavsiye vermez, oynamaz"], en: ['Poker odds', "Hand name and win chance at the Hold'em table · no advice, never plays"] },
  { group: 'torn', key: 'torn.fastSlots', def: true, tr: ['Hızlı Slot', 'Kumarhane slotunda animasyonsuz spin · her tıklama tek spin'], en: ['Fast Slots', 'Casino slots without the reel animation · one spin per click'] },
  { group: 'torn', key: 'torn.stockSync', def: true, tr: ['Stok teslim süresini Torn\'dan oku', 'Şirket stok sayfasındaki "Delivered in" sayaçları'], en: ['Read stock delivery times from Torn', '"Delivered in" timers on the company stock page'] },
  { group: 'torn', key: 'torn.sessionGuard', def: true, tr: ['Torn oturum koruması', "Oturum aktarıldıktan sonra Torn'un güvenlik anahtarını eşitler; böylece Torn sayfaları oturumunu kapatmaz (yeniden başlatınca)"], en: ['Torn session guard', "Keeps Torn's security token in sync after a session import so Torn pages don't log you out (after restart)"] },

  { group: 'events', event: 'easter', key: 'torn.eggFinder', def: true, tr: ['Yumurta bulucu', 'Baktığın sayfada yumurta varsa ortada büyütüp kırmızı çerçeveyle gösterir · tıklamaz'], en: ['Egg finder', 'If the page you are viewing has an egg, shows it enlarged in the middle with a red border · never clicks'] },
  { group: 'events', event: 'halloween', key: 'torn.halloweenHelper', def: true, tr: ['Şeker dükkânı işareti', "Sweet Shop'ta şeker toplamak için gereken Halloween Basket'i işaretler · satın almaz"], en: ['Sweet Shop marker', 'Marks the Halloween Basket you need for treats in the Sweet Shop · never buys'] },
  { group: 'events', event: 'christmas', key: 'torn.ctHelper', def: true, tr: ['Christmas Town yardımcısı', 'Hediye, sandık ve anahtarları işaretler, yakındakileri listeler · kombinasyon sandığı çözücü'], en: ['Christmas Town helper', 'Highlights gifts, chests and keys, lists nearby ones · combination chest solver'] },
  { group: 'events', key: 'event.guide', def: true, tr: ['Etkinlik rehberi', "Etkinlik günlerinde Genel Bakış'ta kısa uyarı, Araçlar'da ne alman / ne yapman gerektiği"], en: ['Event guide', 'On event days: a short notice on Overview and what to buy / do on Tools'] },

  { group: 'app', key: 'app.animations', def: true, tr: ['Animasyonlar', 'Geçişler, sayaç animasyonları, kart efektleri'], en: ['Animations', 'Transitions, counter animations, card effects'] },
  { group: 'app', key: 'app.splash', def: true, tr: ['Açılış ekranı', 'Uygulama açılırken LRX logosu'], en: ['Splash screen', 'LRX logo on startup'] },
  { group: 'app', key: 'app.newYear', def: true, tr: ['Yılbaşı süsü', 'Christmas Town boyunca (19 Aralık 16:00 – 31 Aralık 16:00 TCT) giriş ekranında yılbaşı ağacı, kardan adam, kar ve süslü logo'], en: ['New Year decoration', 'Christmas tree, snowman, snow and a dressed-up logo on the sign-in screen while Christmas Town is open (19 Dec 16:00 – 31 Dec 16:00 TCT)'] },
  { group: 'app', key: 'app.newYearSnow', def: true, tr: ['Uygulama içinde kar', 'Christmas Town boyunca kartların arkasında hafif kar yağar'], en: ['Snow in the app', 'Light snow behind the cards while Christmas Town is open'] },
  { group: 'app', key: 'app.newYearWelcome', def: true, tr: ['Yılbaşı kutlaması', "1 Ocak'ta uygulama ilk açıldığında konfeti ve havai fişek"], en: ['New Year celebration', 'Confetti and fireworks the first time the app opens on 1 January'] },
  { group: 'app', key: 'app.premiumProfile', def: true, tr: ['Premium profil kartı', 'Premium sayfasında üyelik kartının yanında Torn profilin'], en: ['Premium profile card', 'Your Torn profile next to the membership card on the Premium page'] },
  { group: 'app', key: 'app.overviewLayout', def: true, tr: ['Genel Bakış düzeni', "Genel Bakış'ı widget'larla düzenle; kapalıyken klasik sabit ekran"], en: ['Overview layout', 'Arrange the Overview with widgets; off shows the classic fixed screen'] },
  { group: 'app', key: 'app.torntools', def: true, tr: ['TornTools', 'Yerleşik Torn sekmelerinde TornTools eklentisi (yeniden başlatınca)'], en: ['TornTools', 'TornTools extension in Torn tabs (after restart)'] },
  { group: 'app', key: 'app.tabSleep', def: true, tr: ['Kullanılmayan sekmeleri uyut', '20 dk açılmayan Torn sekmesi RAM\'den boşaltılır, tıklayınca kaldığı yerden açılır'], en: ['Sleep unused tabs', 'Torn tabs unused for 20 min are unloaded from RAM and reopen where you left off when clicked'] },
  { group: 'app', key: 'app.loopGuard', def: true, tr: ['Kendi kendine dönen sekmeyi durdur', "Sen dokunmadan bir dakikada 8'den fazla sayfa açan Torn sekmesini durdurur · çok hızlı döngüler her zaman durdurulur"], en: ['Stop self-navigating tabs', 'Stops a Torn tab that opens more than 8 pages in a minute without you touching it · very fast loops are always stopped'] },
  { group: 'app', key: 'app.feedback', def: true, tr: ['Geri bildirim butonu', 'Üst çubukta: istek, öneri ve hatalar e-posta ile geliştiriciye gider'], en: ['Feedback button', 'In the top bar: requests, suggestions and bugs go to the developer by email'] },
  { group: 'app', key: 'app.updates', def: true, tr: ['Otomatik güncelleme kontrolü', 'Açılışta ve dakikada bir kontrol · yeni sürümde bildirim'], en: ['Automatic update check', 'Checks on startup and every minute · prompts for new versions'] },
  { group: 'app', key: 'app.weav3r', def: true, tr: ['Weav3r kısayolu', 'Üst çubukta weav3r.dev kısayolu'], en: ['Weav3r shortcut', 'weav3r.dev shortcut in the top bar'] },
  { group: 'app', key: 'app.premium', def: true, tr: ['Premium üyelik bağlantısı', "Üyeliğini otomatik eşleştirir: API key'in yalnızca Torn ID'ni doğrulamak için lrxe8.com/torn-premium adresine gönderilir ve orada saklanmaz. Kapalıyken üyelik servisine hiçbir şey gönderilmez."], en: ['Premium membership connection', 'Matches your membership automatically: your API key is sent to lrxe8.com/torn-premium only to verify your Torn ID and is not stored there. Off: nothing is sent to the membership service.'] },
  { group: 'app', key: 'app.premiumPromos', def: true, tr: ['Premium modül kartları', 'Savaş, Seyahat, Merit, Araçlar ve Ayarlar sayfalarındaki Premium kartları · Premium sayfası her zaman açık kalır'], en: ['Premium module cards', 'Premium cards on the War, Travel, Merits, Tools and Settings pages · the Premium page always stays available'] },
];
const FEATURE_DEF_MAP = Object.fromEntries(FEATURE_DEFS.map((f) => [f.key, f]));
const EXTRA_VIEWS = { job: 'page.job', gym: 'page.gym', travel: 'page.travel', war: 'page.war', level: 'page.levelling', guide: 'page.levelling', crimes: 'page.crimes', awards: 'page.awards', tools: 'page.tools', faction: 'page.faction' };
const LEVELLING_VIEWS = ['level', 'guide'];

function feat(key) {
  const v = state.config?.features?.[key];
  return typeof v === 'boolean' ? v : (FEATURE_DEF_MAP[key]?.def ?? true);
}
async function setFeature(key, val) {
  state.config ||= {};
  state.config.features = { ...(state.config.features || {}), [key]: val };
  applyFeatures();
  try { await api('/api/features', { method: 'POST', body: JSON.stringify({ features: { [key]: val } }) }); }
  catch (e) { toast(tr('Ayar kaydedilemedi: ', 'Could not save setting: ') + e.message); }
}

/* Görünürlük / tema ayarlarını uygula */
/* Bir işi var mı? (şirket çalışanı/direktörü ya da şehir işi) — İş Asistanı yalnızca işsizken görünür */
function hasJob() {
  const j = state.overview?.player?.job;
  if (!j) return false;
  return Number(j.company_id) > 0 || Boolean(j.job && j.job !== 'None');
}
/* Seviye 15 altı sekmeleri: seviye bilinmiyorsa ya da 15+ ise gizli */
const myLevel = () => Number(state.overview?.player?.level) || 0;
const underLevel15 = () => myLevel() > 0 && myLevel() < 15;
function viewHidden(v) {
  if (v === 'job' && hasJob()) return true;
  if (LEVELLING_VIEWS.includes(v) && !underLevel15()) return true;
  // Seyahat Kârı seviye 15 altındaki oyunculara gösterilmez (o dönemde Başlangıç Rehberi ve Levelling Targets var)
  if (v === 'travel' && underLevel15()) return true;
  // Faction sayfası yalnızca bir faction'dayken
  if (v === 'faction' && state.overview?.player?.faction && !Number(state.overview.player.faction.faction_id)) return true;
  if (EXTRA_VIEWS[v] && !feat(EXTRA_VIEWS[v])) return true;
  // Finance page (finance.js): shown while either tab is; networth / income are its tabs.
  if (v === 'finance') return !window.LRXFinance?.anyTab();
  if (v === 'networth' || v === 'income') return !window.LRXFinance?.tabs()[v === 'income' ? 'company' : 'wealth'];
  return COMPANY_VIEWS.includes(v) && !(feat('page.company') && state.companyMode !== false);
}
function applyNavVisibility() {
  for (const v of [...Object.keys(EXTRA_VIEWS), ...COMPANY_VIEWS, 'finance']) {
    const b = $(`.nav-item[data-view="${v}"]`);
    if (b) b.hidden = viewHidden(v);
  }
  const ov = $('#ov-company'); if (ov) ov.hidden = viewHidden('stock');
  if (viewHidden(state.view)) showView('overview');
  else if (state.view === 'guide') renderGuide(); // her overview yenilemesinde kişisel adımlar güncellensin
}
const FEATURE_HOOKS = []; // ek sayfalar: özellik açılıp kapanınca yeniden çiz
FEATURE_HOOKS.push(() => { if (typeof syncAppSnow === 'function') syncAppSnow(); }); // New Year snow follows its switch and Animations
FEATURE_HOOKS.push(() => { if (typeof checkNewYearWelcome === 'function') checkNewYearWelcome(); }); // switched off: an open celebration closes
function applyFeatures() {
  applyNavVisibility();
  document.body.classList.toggle('no-anim', !feat('app.animations'));
  const tt = $('#tt-open-btn'); if (tt) tt.hidden = !feat('app.torntools');
  const w3 = $('#weav3r-open-btn'); if (w3) w3.hidden = !feat('app.weav3r');
  const ub = $('#update-btn'); if (ub) ub.hidden = !window.electronAPI?.updateCheck || !feat('app.updates');
  window.renderUpdateBtn?.();
  renderFeatureSettings();
  for (const fn of FEATURE_HOOKS) { try { fn(); } catch (e) { console.warn('[features]', e); } }
}

/* ---------- i18n + görünüm başlıkları ---------- */
Object.assign(I18N, {
  'nav.job': ['İş Asistanı', 'Job Assistant'],
  'nav.gym': ['Gym & Statlar', 'Gym & Stats'],
  'nav.travel': ['Seyahat Kârı', 'Travel Profit'],
  'nav.level': ["Baldr's Levelling Targets", "Baldr's Levelling Targets"],
  'nav.guide': ['Başlangıç Rehberi', 'Beginner Guide'],
});
Object.assign(VIEW_META, {
  job: { tr: ['İş Asistanı', 'Çalışma statlarına göre uygun pozisyonlar'], en: ['Job Assistant', 'Positions that fit your working stats'] },
  gym: { tr: ['Gym & Statlar', 'Battle stat geçmişi ve günlük artış'], en: ['Gym & Stats', 'Battle stat history and daily gains'] },
  travel: { tr: ['Seyahat Kârı', 'Yurt dışından alışverişte en kârlı ürünler'], en: ['Travel Profit', 'Most profitable items to buy abroad'] },
  level: { tr: ["Baldr's Levelling Targets", "Seviye 15'e hızlı çıkmak için düşük statlı hedefler"], en: ["Baldr's Levelling Targets", 'Low-stat targets for a fast climb to level 15'] },
  guide: { tr: ['Başlangıç Rehberi', "Seviye 15'e adım adım yol haritası: gym, happy jump, suçlar, iş ve daha fazlası"], en: ['Beginner Guide', 'A step-by-step roadmap to level 15: gym, happy jump, crimes, job and more'] },
});

/* ---------- Ayarlar: sekmeler ve özellik anahtarları ---------- */
const L10 = (f) => f[state.lang === 'en' ? 'en' : 'tr'];
function featRow(f, disabled = false) {
  return `<label class="feat-row ${f.master ? 'master' : ''} ${f.parent ? 'sub' : ''} ${disabled ? 'disabled' : ''}">
      <span class="feat-text"><b>${esc(L10(f)[0])}</b>${L10(f)[1] ? `<small>${esc(L10(f)[1])}</small>` : ''}</span>
      <span class="switch"><input type="checkbox" data-feature="${f.key}" ${feat(f.key) ? 'checked' : ''} ${disabled ? 'disabled' : ''}><i></i></span>
    </label>`;
}
const SET_TABS = ['account', 'general', 'appearance', 'pages', 'notify', 'torn', 'events'];
function showSettingsTab(t) {
  if (!SET_TABS.includes(t)) t = 'account';
  for (const b of document.querySelectorAll('.set-tab')) { const on = b.dataset.setTab === t; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); }
  for (const p of document.querySelectorAll('.set-panel')) p.classList.toggle('active', p.dataset.setPanel === t);
  try { localStorage.setItem('lrx.setTab', t); } catch {}
  if (t === 'events') window.loadEventSettings?.();
}
window.showSettingsTab = showSettingsTab;
let settingsBound = false;
function bindSettings() {
  const host = $('#view-settings');
  if (!host || settingsBound) return;
  settingsBound = true;
  host.addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-feature]');
    if (!inp) return;
    const key = inp.dataset.feature;
    if (key.startsWith('notify') && inp.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    const saved = setFeature(key, inp.checked);
    // Premium durumu, sunucu yeni ayarı kaydettikten sonra yenilensin
    if (key === 'app.premium') saved.finally(() => window.dispatchEvent(new Event('lrx-premium-reset')));
    if (key === 'app.torntools') toast(tr('TornTools değişikliği uygulama yeniden başlatılınca geçerli olur', 'TornTools change applies after restarting the app'));
    if (key === 'torn.sessionGuard') toast(tr('Torn oturum koruması değişikliği uygulama yeniden başlatılınca geçerli olur', 'Torn session guard change applies after restarting the app'));
  });
  host.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-set-tab]');
    if (tab) { showSettingsTab(tab.dataset.setTab); return; }
    if (e.target.closest('#notify-test')) {
      notify('test', tr('LRX Torn Tracker', 'LRX Torn Tracker'), tr('Bildirimler çalışıyor ✓', 'Notifications are working ✓'));
    }
  });
  let saved = 'account';
  try { saved = localStorage.getItem('lrx.setTab') || 'account'; } catch {}
  showSettingsTab(saved);
}
function renderFeatureSettings() {
  if (!$('#set-feat-pages')) return;
  bindSettings();
  const group = (g) => FEATURE_DEFS.filter((f) => f.group === g);
  // Sayfalar: her sayfa alt seçenekleriyle bir blokta
  $('#set-feat-pages').innerHTML = group('pages').filter((f) => !f.parent).map((p) => `<div class="feat-block">${featRow(p)}${
    FEATURE_DEFS.filter((c) => c.parent === p.key).map((c) => featRow(c, !feat(p.key))).join('')}</div>`).join('');
  const notifyOn = feat('notify');
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#set-feat-notify').innerHTML = group('notify').map((f) => featRow(f, !f.master && !notifyOn)).join('')
    + `<div class="feat-foot"><button class="btn sm ghost" id="notify-test" type="button" ${notifyOn ? '' : 'disabled'}>🔔 ${tr('Test bildirimi', 'Test notification')}</button>
      ${perm === 'denied' ? `<small class="neg">${tr('Bildirim izni engellenmiş', 'Notification permission blocked')}</small>` : ''}</div>`;
  $('#set-feat-torn').innerHTML = group('torn').map((f) => `<div class="feat-block">${featRow(f)}</div>`).join('')
    + `<div class="feat-foot feat-span"><small class="muted">${tr("Etkinlik yardımcıları (yumurta bulucu, Christmas Town, Trick or Treat) Etkinlikler sekmesinde · F12: geliştirici araçları", 'Event helpers (egg finder, Christmas Town, Trick or Treat) are on the Events tab · F12: developer tools')}</small></div>`;
  $('#set-feat-app').innerHTML = group('app').map((f) => featRow(f)).join('');
  window.renderEventSettings?.();
  window.renderUpdateInfo?.();
}

/* ---------- Masaüstü bildirimleri ---------- */
const notified = new Map(); // "tür:id" -> olayın zamanı (ms)
try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem('tt.notified') || '{}'))) notified.set(k, v); } catch {}
function rememberNotified(key, at) {
  notified.set(key, at);
  // Rules of the advanced modules can ask for one alert per event or per year: they are kept that long
  for (const [k, t] of notified) if (Date.now() - t > (k.startsWith('advanced:') ? 400 : 3) * 86400_000) notified.delete(k);
  try { localStorage.setItem('tt.notified', JSON.stringify(Object.fromEntries(notified))); } catch {}
}
function notify(key, title, body, { url = null } = {}) {
  if (!('Notification' in window)) return toast(`${title} · ${body}`);
  const show = () => {
    try {
      const n = new Notification(title, { body, icon: '/logo-64.png', tag: key });
      n.onclick = () => { window.focus(); if (url) openInTab(url, { activate: true, reuse: true }); };
    } catch { toast(`${title} · ${body}`); }
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => (p === 'granted' ? show() : toast(`${title} · ${body}`)));
  else toast(`${title} · ${body}`);
}

/* A hospital stay can end before its planned time (a revive, a medical item). The planned moment then never
   comes, so the change of state itself is the event: remembered once, at the time it was first seen. */
const hospitalWatch = new Map(); // 'me' | player id -> { until, releasedAt }
function earlyRelease(key, status, seenAt) {
  const w = hospitalWatch.get(key);
  if (status?.state === 'Hospital' && status.until) { hospitalWatch.set(key, { until: status.until, releasedAt: 0 }); return null; }
  if (!w || !status) return null;
  if (!w.releasedAt) {
    if (w.until * 1000 - state.skew <= seenAt + 5000) { hospitalWatch.delete(key); return null; } // left on time: the planned event covers it
    w.releasedAt = seenAt;
  }
  if (Date.now() - w.releasedAt > 6 * 60_000) { hospitalWatch.delete(key); return null; }
  return w.releasedAt;
}
/* Olayların zamanını hesapla (ms, yerel saat) */
function notifyEvents() {
  const o = state.overview;
  const ev = [];
  if (o && state.overviewAt) {
    const base = state.overviewAt;
    const bar = (k, name, emoji) => {
      const b = o.bars?.[k];
      if (b && b.fulltime > 0) ev.push({ type: `notify.${k}`, at: base + b.fulltime * 1000, title: `${emoji} ${name}`, body: tr(`${name} doldu (${b.maximum}/${b.maximum})`, `${name} is full (${b.maximum}/${b.maximum})`) });
    };
    bar('energy', tr('Enerji', 'Energy'), '⚡');
    bar('nerve', 'Nerve', '🧠');
    for (const [k, emoji, label] of [['drug', '💊', 'Drug'], ['booster', '🍬', 'Booster'], ['medical', '🩹', 'Medical']]) {
      const s = o.cooldowns?.[k];
      if (s > 0) ev.push({ type: `notify.${k}`, at: base + s * 1000, title: `${emoji} ${label} cooldown`, body: tr(`${label} cooldown bitti`, `${label} cooldown is over`) });
    }
    if (o.education?.timeLeft > 0) ev.push({ type: 'notify.education', at: base + o.education.timeLeft * 1000, title: '🎓 ' + tr('Eğitim', 'Education'), body: tr(`${o.education.current || 'Kurs'} tamamlandı`, `${o.education.current || 'Course'} completed`) });
    if (o.trip?.timeLeft > 0) ev.push({ type: 'notify.travel', at: base + o.trip.timeLeft * 1000, title: '✈ ' + tr('Uçak indi', 'Landed'), body: tr(`Vardığın yer: ${o.trip.destination}`, `Arrived in ${o.trip.destination}`) });
    const st = o.player?.status;
    if (st?.state === 'Hospital' && st.until) ev.push({ type: 'notify.hospital', at: st.until * 1000 - state.skew, title: '🏥 ' + tr('Hastaneden çıktın', 'Out of hospital'), body: tr('Artık müsaitsin', 'You are okay now') });
    const outEarly = earlyRelease('me', st, base);
    if (outEarly) ev.push({ type: 'notify.hospital', at: outEarly, title: '🏥 ' + tr('Hastaneden çıktın', 'Out of hospital'), body: tr('Beklenenden erken çıktın', 'You are out earlier than expected') });
    if (o.bank?.timeLeft > 0) ev.push({ type: 'notify.bank', at: base + o.bank.timeLeft * 1000, title: '🏦 ' + tr('Banka yatırımın bitti', 'Bank investment finished'), body: tr(`${cmoney(o.bank.amount)} ve faizi çekilebilir`, `${cmoney(o.bank.amount)} plus interest is ready to withdraw`), url: 'https://www.torn.com/bank.php' });
  }
  // Açık sekmelerdeki oyuncular
  const seen = new Set();
  for (const t of state.browserTabs || []) {
    const xid = extractPlayerId(t.url);
    if (!xid || seen.has(xid)) continue;
    seen.add(xid);
    const d = state.playerInfo?.[xid]?.data;
    const st = d?.status;
    if (st?.state === 'Hospital' && st.until) {
      ev.push({ type: 'notify.targets', at: st.until * 1000 - state.skew, title: `🏥 ${decode(d.name || '#' + xid)}`, body: tr('Hastaneden çıktı — saldırılabilir', 'Left hospital — attackable'), url: `https://www.torn.com/page.php?sid=attack&user2ID=${xid}`, id: xid });
    }
    const outEarly = earlyRelease(xid, st, state.playerInfo?.[xid]?.at || Date.now());
    if (outEarly && st.state === 'Okay') ev.push({ type: 'notify.targets', at: outEarly, title: `🏥 ${decode(d.name || '#' + xid)}`, body: tr('Hastaneden erken çıktı — saldırılabilir', 'Left hospital early — attackable'), url: `https://www.torn.com/page.php?sid=attack&user2ID=${xid}`, id: xid });
  }
  for (const key of hospitalWatch.keys()) if (key !== 'me' && !seen.has(key)) hospitalWatch.delete(key); // tab closed
  // Takip edilen ürünler: restock anında inecek şekilde kalkış hatırlatması
  // Restock times are estimates from the last stock reading: no "time to fly" from a reading older than 15 minutes
  const td = Date.now() - travelState.at <= 15 * 60_000 ? travelState.data : null;
  if (td && travelState.watch.size) {
    const mult = TRAVEL_METHODS[travelMethod()] || 1;
    for (const c of td.countries) {
      if (!c.minutes) continue;
      for (const it of c.items) {
        const k = `${c.code}:${it.id}`;
        if (!travelState.watch.has(k) || it.qty > 0 || !it.nextRestock) continue;
        ev.push({
          type: 'notify.restock', id: k, at: (it.nextRestock - c.minutes * mult * 60) * 1000 - state.skew,
          title: `✈ ${tr('Kalkış zamanı', 'Time to fly')}: ${c.name}`,
          body: tr(`Şimdi uçarsan ${it.name} restock'una (${hhmm(it.nextRestock)}) yetişirsin`, `Fly now to land at the ${it.name} restock (${hhmm(it.nextRestock)})`),
          url: 'https://www.torn.com/travelagency.php',
        });
      }
    }
  }
  return ev;
}
setInterval(() => {
  if (!feat('notify')) return;
  const now = Date.now();
  for (const e of notifyEvents()) {
    if (!feat(e.type)) continue;
    if (e.at > now || now - e.at > 5 * 60_000) continue; // sadece yeni olaylar (son 5 dk)
    const key = `${e.type}:${e.id || ''}`;
    const prev = notified.get(key);
    if (prev && Math.abs(prev - e.at) < 10 * 60_000) continue; // aynı olay zaten bildirildi
    rememberNotified(key, e.at);
    notify(key, e.title, e.body, { url: e.url });
  }
}, 2000);

/* ---------- Ortak: piksel doğru grafik konteyneri ---------- */
const chartRO = window.ResizeObserver ? new ResizeObserver((entries) => {
  for (const en of entries) { const el = en.target; const w = Math.round(el.clientWidth); if (w && w !== el._w && el._render) { el._w = w; el._render(w); } }
}) : null;
function mountChart(el, render) {
  if (!el) return;
  el._render = (w) => { el.innerHTML = render(Math.max(300, w)); };
  el._w = Math.round(el.clientWidth) || el._w || 900;
  el._render(el._w);
  if (chartRO && !el._observed) { chartRO.observe(el); el._observed = true; }
}
// tickFmt(v, step) labels the y axis (a caller can pick its precision from the tick step); fmt labels the points.
let lineChartSeq = 0;
function lineChart(series, W, { height = 240, color = '#c9a96a', fmt = cmoney, tickFmt = (v) => fmt(v), fill = true } = {}) {
  const H = height, pl = 66, pr = 14, pt = 16, pb = 30;
  const vals = series.map((p) => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { hi += Math.max(1, Math.abs(hi) * 0.05); lo -= Math.max(1, Math.abs(lo) * 0.05); }
  const step = niceStep((hi - lo) / 4);
  const top = Math.ceil(hi / step) * step, bot = Math.floor(lo / step) * step;
  const x = (i) => pl + (series.length === 1 ? (W - pl - pr) / 2 : (i / (series.length - 1)) * (W - pl - pr));
  const y = (v) => pt + ((top - v) / (top - bot || 1)) * (H - pt - pb);
  let grid = '';
  for (let v = bot; v <= top + 1e-6; v += step) grid += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.05)" stroke-dasharray="3 4"/><text x="${pl - 10}" y="${y(v) + 4}" text-anchor="end" fill="#5f6870" font-size="11" font-family="JetBrains Mono, monospace">${tickFmt(v, step)}</text>`;
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  // Every chart gets its own gradient id: with one shared id a chart could pick up another chart's fill colour.
  const fillId = `lcFill${++lineChartSeq}`;
  const area = fill ? `<path d="${path} L${x(series.length - 1)},${y(bot)} L${x(0)},${y(bot)} Z" fill="url(#${fillId})" stroke="none"/>` : ''; // no outline from the global svg stroke
  const every = Math.ceil(series.length / Math.max(1, Math.floor((W - pl - pr) / 64)));
  // The last date ends at the right edge; a regular label too close to it is dropped so the two never overlap.
  const last = series.length - 1;
  const labels = series.map((p, i) => {
    if (i !== last && (i % every !== 0 || x(last) - x(i) < 60)) return '';
    return `<text x="${x(i)}" y="${H - 9}" text-anchor="${i === last && last > 0 ? 'end' : 'middle'}" fill="#7d8790" font-size="11">${shortDate(p.date)}</text>`;
  }).join('');
  const dots = series.length <= 40 ? series.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="3" fill="#0b0c0e" stroke="${color}" stroke-width="1.8"><title>${p.date}: ${fmt(p.v)}</title></circle>`).join('') : '';
  return `<svg class="ic-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${grid}${area}<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}
const emptyBox = (title, text) => `<div class="empty-state"><b class="tq-text">${title}</b><br>${text}</div>`;
const loadingBox = () => `<div class="empty-state">${tr('Yükleniyor…', 'Loading…')}</div>`;
const errorBox = (e) => `<div class="alert danger">${esc(e.message || String(e))}</div>`;
const signed = (v, f = cmoney) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${f(v)}`);
const deltaCls = (v) => (v == null ? '' : v >= 0 ? 'pos' : 'neg');

/* ---------- İş Asistanı ---------- */
const jobState = { data: null, at: 0, q: '' };
async function loadJob(force = false) {
  const el = $('#job-body');
  if (!jobState.data) el.innerHTML = loadingBox();
  if (!force && jobState.data && Date.now() - jobState.at < 60_000) return renderJob();
  try { jobState.data = await api('/api/job'); jobState.at = Date.now(); renderJob(); }
  catch (e) { el.innerHTML = errorBox(e); }
}
function renderJob() {
  const d = jobState.data; if (!d) return;
  const w = d.workstats;
  const total = w.man + w.int + w.end;
  const rows = [];
  for (const [tid, t] of Object.entries(d.types)) {
    for (const [pos, p] of Object.entries(t.positions)) {
      const need = { man: p.man_required || 0, int: p.int_required || 0, end: p.end_required || 0 };
      const miss = { man: Math.max(0, need.man - w.man), int: Math.max(0, need.int - w.int), end: Math.max(0, need.end - w.end) };
      const missTotal = miss.man + miss.int + miss.end;
      const gain = (p.man_gain || 0) + (p.int_gain || 0) + (p.end_gain || 0);
      rows.push({ tid, company: t.name, pos, need, miss, missTotal, gain, p, ok: missTotal === 0 });
    }
  }
  const job = d.job || {};
  const jp = d.jobpoints || {};
  const jpList = [
    ...Object.entries(jp.jobs || {}).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v]),
    ...Object.values(jp.companies || {}).map((c) => [c.name, c.jobpoints]),
  ].filter(([, v]) => v > 0);
  const st = (k, v, need) => `<span class="mono ${need && v < need ? 'neg' : ''}">${n0(need)}</span>`;
  const head = `<thead><tr><th>${tr('Şirket türü', 'Company type')}</th><th>${tr('Pozisyon', 'Position')}</th><th class="num">MAN</th><th class="num">INT</th><th class="num">END</th><th class="num">${tr('Günlük kazanç', 'Daily gain')}</th><th>${tr('Özel yetenek', 'Special')}</th></tr></thead>`;
  const line = (r, missing = false) => `<tr title="${esc(r.p.description || '')}">
      <td>${esc(r.company)}</td><td><b>${esc(r.pos)}</b></td>
      <td class="num">${st('man', w.man, r.need.man)}${missing && r.miss.man ? `<div class="sub-text neg">-${n0(r.miss.man)}</div>` : ''}</td>
      <td class="num">${st('int', w.int, r.need.int)}${missing && r.miss.int ? `<div class="sub-text neg">-${n0(r.miss.int)}</div>` : ''}</td>
      <td class="num">${st('end', w.end, r.need.end)}${missing && r.miss.end ? `<div class="sub-text neg">-${n0(r.miss.end)}</div>` : ''}</td>
      <td class="num mono tq-text">+${n0(r.gain)}</td>
      <td class="muted">${esc(r.p.special_ability && r.p.special_ability !== 'None' ? r.p.special_ability : '—')}</td></tr>`;
  $('#job-body').innerHTML = `
    <div class="grid kpis">
      ${kpi('<span lang="en">Manual Labor</span>', n0(w.man))}${kpi('<span lang="en">Intelligence</span>', n0(w.int))}${kpi('<span lang="en">Endurance</span>', n0(w.end))}
      ${kpi(tr('Toplam çalışma statı', 'Total working stats'), n0(total), '', 'tq')}
      ${kpi(tr('Şu anki iş', 'Current job'), esc(jobLabel(job)), Number(job.company_id) > 0 ? `<a href="https://www.torn.com/companies.php" data-open-url="https://www.torn.com/companies.php">${tr('Şirketi aç ↗', 'Open company ↗')}</a>` : `<a href="https://www.torn.com/joblist.php" data-open-url="https://www.torn.com/joblist.php">${tr('İş ilanlarını aç ↗', 'Open job listings ↗')}</a>`, 'txt')}
    </div>
    ${jpList.length ? `<article class="glass card"><div class="card-head"><h3>${tr('İş puanları', 'Job points')}</h3><span class="muted">${tr('Şirket özel yeteneklerinde harcanır', 'Spent on company specials')}</span></div><div class="chip-row">${jpList.map(([n, v]) => `<span class="chip">${esc(n)} <b class="mono">${n0(v)}</b></span>`).join('')}</div></article>` : ''}
    <article class="glass card">
      <div class="card-head wrap"><div><h3>${tr('Girebileceğin pozisyonlar', 'Positions you qualify for')} <span class="chip green" id="job-ok-n"></span></h3><span class="muted">${tr('Günlük çalışma statı kazancına göre sıralı · satırın üzerine gel: açıklama', 'Sorted by daily working-stat gain · hover a row for details')}</span></div>
        <input class="input" id="job-search" placeholder="${tr('Şirket veya pozisyon ara…', 'Search company or position…')}" value="${esc(jobState.q)}" style="max-width:260px">
      </div>
      <div id="job-ok"></div>
    </article>
    <article class="glass card">
      <div class="card-head"><h3>${tr('En yakın hedefler', 'Closest positions')}</h3><span class="muted">${tr('Kırmızı = eksik stat', 'Red = missing stats')}</span></div>
      <div id="job-near"></div>
    </article>`;
  const fill = () => {
    const q = jobState.q.trim().toLowerCase();
    const match = (r) => !q || r.company.toLowerCase().includes(q) || r.pos.toLowerCase().includes(q);
    const ok = rows.filter((r) => r.ok && match(r)).sort((a, b) => b.gain - a.gain || (b.need.man + b.need.int + b.need.end) - (a.need.man + a.need.int + a.need.end));
    const near = rows.filter((r) => !r.ok && match(r)).sort((a, b) => a.missTotal - b.missTotal).slice(0, 15);
    $('#job-ok-n').textContent = ok.length;
    $('#job-ok').innerHTML = ok.length ? `<div class="tbl-wrap"><table class="tbl compact">${head}<tbody>${ok.slice(0, 40).map((r) => line(r)).join('')}</tbody></table></div>` : emptyBox(tr('Uygun pozisyon yok', 'No qualifying positions'), q ? tr('Aramaya uyan sonuç yok.', 'Nothing matches the search.') : tr('Aşağıdaki en yakın pozisyonlara bak.', 'See the closest positions below.'));
    $('#job-near').innerHTML = near.length ? `<div class="tbl-wrap"><table class="tbl compact">${head}<tbody>${near.map((r) => line(r, true)).join('')}</tbody></table></div>` : emptyBox(q ? tr('Sonuç yok', 'No results') : tr('Hepsine yetiyor', 'You qualify for everything'), '');
  };
  fill();
  $('#job-search')?.addEventListener('input', (e) => { jobState.q = e.target.value; fill(); });
}

/* One record is saved per day the app runs, so "n records back" is not "n days back".
   exact: the record of exactly n days before the latest one; otherwise the oldest record inside the last n days. */
function recordBack(hist, n, exact = false) {
  const last = hist[hist.length - 1];
  if (!last) return null;
  const from = new Date(Date.parse(`${last.date}T00:00:00Z`) - n * 86400_000).toISOString().slice(0, 10);
  return (exact ? hist.find((r) => r.date === from) : hist.find((r) => r.date >= from && r !== last)) || null;
}
const daysApart = (a, b) => Math.round((Date.parse(`${b.date}T00:00:00Z`) - Date.parse(`${a.date}T00:00:00Z`)) / 86400_000);
/* ---------- Gym & Statlar ---------- */
async function loadGym() {
  const el = $('#gym-body');
  if (!el.innerHTML) el.innerHTML = loadingBox();
  try { renderGym(await api('/api/stats')); } catch (e) { el.innerHTML = errorBox(e); }
}
/* y-axis label exact to the tick step: "4.25M" for 50K ticks, "4.2521M" for 100 ticks, so no two labels match.
   A unit that would need more than 4 decimals gives way to the next smaller one. */
function gymTick(v, step) {
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  const [unit, suffix] = units.find(([u]) => Math.abs(v) >= u && step / u >= 1e-4) || [1, ''];
  const s = step / unit;
  let d = 0;
  while (d < 4 && Math.abs(Math.round(s * 10 ** d) - s * 10 ** d) > 1e-6) d++;
  return (v / unit).toFixed(d) + suffix;
}
const GYM_STATS = [['str', 'Strength', '#c9a96a'], ['def', 'Defense', '#d4d9df'], ['spd', 'Speed', '#8fa3b8'], ['dex', 'Dexterity', '#b08d6e']];
/* Key numbers first (4 tiles), then "Your stats" beside a short chart; the day-by-day table is collapsed. */
function renderGym(d) {
  const hist = d.history || [];
  const last = hist[hist.length - 1];
  const ago = (n) => recordBack(hist, n, n === 1);
  const diff = (k, n) => (ago(n) && last && last[k] != null && ago(n)[k] != null ? last[k] - ago(n)[k] : null);
  const span = (n) => (ago(n) && last ? daysApart(ago(n), last) : 0); // days the figure really covers
  const cover = (n) => tr(`kayıt ${span(n)} günlük`, `records cover ${span(n)} ${span(n) === 1 ? 'day' : 'days'}`);
  const delta = (v) => `<span class="${deltaCls(v)}">${signed(v, n0)}</span>`;
  const total = last?.total ?? d.battle?.totals?.base ?? 0;
  const g1 = diff('total', 1), g7 = diff('total', 7), g30 = diff('total', 30);
  const xan = diff('xantaken', 7), refills = diff('refills', 7);
  const energy = state.overview?.bars?.energy; // already loaded by the overview: no request of its own
  const shown = Math.min(30, hist.length);
  $('#gym-body').innerHTML = `
    <div class="grid kpis gym-kpis">
      ${kpi(tr('Toplam battle stat', 'Total battle stats'), n0(total), '', 'tq')}
      ${kpi(tr('Dünden beri', 'Since yesterday'), delta(g1), g1 == null && hist.length > 1 ? tr('dünkü kayıt yok', 'no record from yesterday') : '')}
      ${kpi(tr('7 günde', 'Last 7 days'), delta(g7), g7 != null ? `${tr('günlük ort.', 'daily avg')} ${n0(g7 / span(7))}${span(7) < 7 ? ` · ${cover(7)}` : ''}` : tr('son 7 günde başka kayıt yok', 'no other record in the last 7 days'))}
      ${kpi(tr('30 günde', 'Last 30 days'), delta(g30), g30 != null && span(30) < 30 ? cover(30) : '')}
    </div>
    <div class="gym-main">
      <article class="glass card gym-stats" id="gym-stats">
        <div class="card-head"><h3>${tr('Statların', 'Your stats')}</h3>${last ? `<span class="muted">${shortDate(last.date)}</span>` : ''}</div>
        ${last ? `<div class="storage-bar">${GYM_STATS.map(([k, n, c]) => `<i style="width:${(last[k] / (last.total || 1)) * 100}%;background:${c}" title="${n}: ${n0(last[k])}"></i>`).join('')}</div>
        <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Stat</th><th class="num">${tr('Değer', 'Value')}</th><th class="num">${tr('Pay', 'Share')}</th><th class="num">${tr('Dünden', '24h')}</th><th class="num">${tr('7 gün', '7 days')}</th></tr></thead><tbody>
          ${GYM_STATS.map(([k, n, c]) => `<tr data-stat="${k}"><td><i class="gym-dot" style="background:${c}"></i>${n}</td><td class="num">${n0(last[k])}</td><td class="num muted">${pct(last[k] / (last.total || 1), 1)}</td><td class="num">${delta(diff(k, 1))}</td><td class="num">${delta(diff(k, 7))}</td></tr>`).join('')}
        </tbody></table></div>` : `<p class="muted">${tr('Henüz kayıt yok. Uygulama açık kaldıkça her gün kayıt alınır.', 'No records yet. A snapshot is saved every day while the app runs.')}</p>`}
        <div class="gym-foot" id="gym-foot">
          ${energy ? `<span data-gym="energy">${tr('Enerji', 'Energy')} <b>${n0(energy.current)}/${n0(energy.maximum)}</b></span>` : ''}
          <span data-gym="usage">${tr('Son 7 gün', 'Last 7 days')}: Xanax <b>${xan != null ? n0(xan) : '—'}</b> · ${tr('Refill', 'Refills')} <b>${refills != null ? n0(refills) : '—'}</b></span>
        </div>
      </article>
      <article class="glass card">
        <div class="card-head"><h3>${tr('Toplam stat geçmişi', 'Total stats history')}</h3><span class="muted">${hist.length} ${tr('gün kayıtlı', hist.length === 1 ? 'day recorded' : 'days recorded')}</span></div>
        <div class="chart gym-chart" id="gym-chart"></div>
      </article>
    </div>
    ${hist.length ? `<details class="glass card gym-days" id="gym-days"${lsGet('tt.gym.days', '0') === '1' ? ' open' : ''}>
      <summary><h3>${tr('Gün gün', 'Day by day')}</h3><span class="muted">${tr(`son ${shown} kayıt`, `last ${shown} ${shown === 1 ? 'record' : 'records'}`)}</span></summary>
      <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>${tr('Tarih', 'Date')}</th><th class="num">STR</th><th class="num">DEF</th><th class="num">SPD</th><th class="num">DEX</th><th class="num">${tr('Toplam', 'Total')}</th><th class="num">${tr('Artış', 'Gain')}</th><th class="num">Xanax</th></tr></thead><tbody>
      ${hist.slice().reverse().slice(0, 30).map((r) => {
        const i = hist.indexOf(r); const p = hist[i - 1];
        return `<tr><td class="mono">${r.date}</td><td class="num">${n0(r.str)}</td><td class="num">${n0(r.def)}</td><td class="num">${n0(r.spd)}</td><td class="num">${n0(r.dex)}</td><td class="num"><b>${n0(r.total)}</b></td><td class="num ${p ? deltaCls(r.total - p.total) : ''}">${p ? signed(r.total - p.total, n0) : '—'}</td><td class="num">${p && r.xantaken != null && p.xantaken != null ? n0(r.xantaken - p.xantaken) : '—'}</td></tr>`;
      }).join('')}</tbody></table></div></details>` : ''}`;
  $('#gym-days')?.addEventListener('toggle', (e) => lsSet('tt.gym.days', e.currentTarget.open ? '1' : '0'));
  if (hist.length >= 2) mountChart($('#gym-chart'), (W) => lineChart(hist.map((r) => ({ date: r.date, v: r.total })), W, { height: 180, fmt: n0, tickFmt: gymTick }));
  else $('#gym-chart').innerHTML = emptyBox(tr('Geçmiş birikiyor', 'Building history'), tr('Uygulama açık kaldıkça her gün stat kaydı alınır. Grafik 2. günden itibaren görünür.', 'A snapshot is saved every day while the app runs. The chart appears from day 2.'));
}

/* ---------- Seyahat Kârı ---------- */
const TRAVEL_METHODS = { Standard: 1, Airstrip: 0.7, Private: 0.5, Business: 0.3 };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const lsList = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const travelState = {
  data: null, at: 0, q: '',
  cap: Number(lsGet('tt.travel.cap', 15)) || 15,
  method: lsGet('tt.travel.method', ''),
  stock: lsGet('tt.travel.stock', 'arrival'), // all | now | arrival
  type: lsGet('tt.travel.type', 'all'),
  sort: lsGet('tt.travel.sort', 'perHour'),
  minProfit: Number(lsGet('tt.travel.minProfit', 0)) || 0, // saatlik $
  maxFlight: Number(lsGet('tt.travel.maxFlight', 0)) || 0, // tek yön dk (0 = sınırsız)
  countries: new Set(lsList('tt.travel.countries')), // boş = hepsi
  watch: new Set(lsList('tt.travel.watch')),
  watchOnly: lsGet('tt.travel.watchOnly', '0') === '1',
};
function saveTravelPrefs() {
  const t = travelState;
  lsSet('tt.travel.cap', String(t.cap)); lsSet('tt.travel.method', t.method); lsSet('tt.travel.stock', t.stock);
  lsSet('tt.travel.type', t.type); lsSet('tt.travel.sort', t.sort); lsSet('tt.travel.minProfit', String(t.minProfit));
  lsSet('tt.travel.maxFlight', String(t.maxFlight)); lsSet('tt.travel.countries', JSON.stringify([...t.countries]));
  lsSet('tt.travel.watch', JSON.stringify([...t.watch])); lsSet('tt.travel.watchOnly', t.watchOnly ? '1' : '0');
}
const travelMethod = () => {
  const d = travelState.data;
  return travelState.method || (TRAVEL_METHODS[d?.method] ? d.method : 'Standard');
};
const hhmm = (sec) => new Date(sec * 1000 - state.skew).toLocaleTimeString(state.lang === 'en' ? 'en-GB' : 'tr-TR', { hour: '2-digit', minute: '2-digit' });
const mins = (m) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}${tr('sa', 'h')} ${String(Math.round(m % 60)).padStart(2, '0')}${tr('dk', 'm')}` : `${Math.round(m)}${tr('dk', 'm')}`);
function tvFmt(s) {
  if (s <= 0) return s > -900 ? tr('şimdi', 'now') : tr(`${Math.round(-s / 60)}dk gecikti`, `${Math.round(-s / 60)}m late`);
  s = Math.floor(s);
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 3600)}${tr('sa', 'h')} ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}${tr('dk', 'm')}`;
}
const tvAt = (sec) => `<span class="mono tv-cd" data-tv-at="${sec}">${tvFmt(sec - nowTct() / 1000)}</span>`;

async function fetchTravel() {
  const prev = travelState.data;
  const d = await api('/api/travel');
  travelState.data = d; travelState.at = Date.now(); travelState.error = '';
  // Takip edilen ürün yeniden stoklandıysa haber ver
  if (prev && feat('notify') && feat('notify.restock') && travelState.watch.size) {
    const old = new Map(prev.countries.flatMap((c) => c.items.map((i) => [`${c.code}:${i.id}`, i.qty])));
    for (const c of d.countries) for (const i of c.items) {
      const k = `${c.code}:${i.id}`;
      if (!travelState.watch.has(k) || old.get(k) !== 0 || !(i.qty > 0)) continue;
      const key = `notify.restock.in:${k}`;
      if (Date.now() - (notified.get(key) || 0) < 20 * 60_000) continue;
      rememberNotified(key, Date.now());
      notify(key, `📦 ${i.name} ${tr('stokta', 'in stock')}`, tr(`${c.name}: ${n0(i.qty)} adet`, `${c.name}: ${n0(i.qty)} available`), { url: 'https://www.torn.com/travelagency.php' });
    }
  }
  return d;
}
async function loadTravel(force = false) {
  const el = $('#travel-body');
  if (!travelState.data) el.innerHTML = loadingBox();
  if (force || !travelState.data || Date.now() - travelState.at > 120_000) {
    try { await fetchTravel(); } catch (e) {
      if (!travelState.data) { el.innerHTML = errorBox(e); return; }
      toast(tr('Seyahat verisi yenilenemedi: ', 'Could not refresh travel data: ') + e.message);
    }
  }
  renderTravel();
}

/* Varışta stok durumu */
function stockStatus(it, now, arrive) {
  if (it.qty > 0) return it.emptyAt && it.emptyAt < arrive ? 'risk' : 'ok';
  if (it.nextRestock) {
    if (it.nextRestock <= now) return now - it.nextRestock <= 45 * 60 ? 'due' : 'stale'; // çok gecikmiş tahmin güvenilmez
    return it.nextRestock <= arrive ? 'restock' : 'later';
  }
  return 'no';
}
const STATUS_CHIP = {
  ok: ['green', '✓', ['Varışta stokta', 'In stock on arrival']],
  risk: ['warn', '⚠', ['Varışta bitebilir', 'May sell out before you land']],
  restock: ['blue', '⟳', ['Varışa kadar gelir', 'Restocks before you land']],
  due: ['warn', '⟳', ['Restock her an', 'Restock due any moment']],
  later: ['dim', '⏳', ['Varıştan sonra gelir', 'Restocks after you land']],
  stale: ['dim', '?', ['Tahmin gecikti', 'Estimate overdue']],
  no: ['danger', '✗', ['Stok yok', 'Out of stock']],
};
const statusChip = (s) => { const [cls, ic, label] = STATUS_CHIP[s]; return `<span class="chip ${cls}">${ic} ${tr(label[0], label[1])}</span>`; };

function travelRows({ ignoreStock = false } = {}) {
  const d = travelState.data, t = travelState;
  const mult = TRAVEL_METHODS[travelMethod()] || 1;
  const now = nowTct() / 1000;
  const cap = Math.max(1, t.cap);
  const q = t.q.trim().toLowerCase();
  const rows = [];
  for (const c of d.countries) {
    if (!c.minutes) continue;
    const oneWay = c.minutes * mult;
    if (t.maxFlight && oneWay > t.maxFlight) continue;
    if (t.countries.size && !t.countries.has(c.code)) continue;
    const arrive = now + oneWay * 60;
    for (const it of c.items) {
      const key = `${c.code}:${it.id}`;
      const watched = t.watch.has(key);
      if (t.watchOnly && !watched) continue;
      if (!watched && (it.profit == null || it.profit <= 0)) continue;
      if (t.type !== 'all' && it.type !== t.type) continue;
      if (q && !it.name.toLowerCase().includes(q)) continue;
      const st = stockStatus(it, now, arrive);
      if (!ignoreStock && t.stock === 'now' && it.qty <= 0) continue;
      if (!ignoreStock && t.stock === 'arrival' && (st === 'no' || st === 'later' || st === 'stale')) continue;
      const { units, trip, round, perHour } = LRXTravelMath.tripMetrics(it.profit || 0, cap, it.qty, oneWay);
      if (t.minProfit && perHour < t.minProfit) continue;
      rows.push({ c, it, key, watched, st, units, trip, round, oneWay, perHour, arrive });
    }
  }
  const sorters = {
    perHour: (a, b) => b.perHour - a.perHour,
    trip: (a, b) => b.trip - a.trip,
    unit: (a, b) => (b.it.profit || 0) - (a.it.profit || 0),
    restock: (a, b) => (a.it.nextRestock || Infinity) - (b.it.nextRestock || Infinity) || b.perHour - a.perHour,
    flight: (a, b) => a.oneWay - b.oneWay || b.perHour - a.perHour,
  };
  rows.sort(sorters[t.sort] || sorters.perHour);
  return rows;
}

function renderTravel() {
  const d = travelState.data; if (!d) return;
  const t = travelState;
  const method = travelMethod();
  const mult = TRAVEL_METHODS[method] || 1;
  const types = [...new Set(d.countries.flatMap((c) => c.items.map((i) => i.type)).filter(Boolean))].sort();
  const opt = (v, label, cur) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${label}</option>`;
  const countryChips = d.countries.filter((c) => c.minutes).map((c) => `<button class="tv-cbtn ${t.countries.has(c.code) ? 'active' : ''}" data-country="${c.code}" title="${esc(c.name)}"><span lang="en">${esc(c.name)}</span> <small>${mins(c.minutes * mult)}</small></button>`).join('');
  $('#travel-body').innerHTML = `
    <article class="glass card tv-controls">
      <div class="tv-row">
        <input class="input" id="tv-q" placeholder="${tr('Ürün ara… (ör. Xanax, Plushie)', 'Search items… (e.g. Xanax, Plushie)')}" value="${esc(t.q)}">
        <div class="tv-countries"><button class="tv-cbtn ${t.countries.size ? '' : 'active'}" data-country="*">${tr('Tüm ülkeler', 'All countries')}</button>${countryChips}</div>
      </div>
      <div class="tv-row tv-filters">
        <label>${tr('Kapasite', 'Capacity')} <input class="input mono" id="tv-cap" type="number" min="1" max="100" value="${t.cap}"></label>
        <label>${tr('Uçuş', 'Travel method')} <select id="tv-method">${Object.keys(TRAVEL_METHODS).map((m) => opt(m, `${m} (×${TRAVEL_METHODS[m]})`, method)).join('')}</select></label>
        <label>${tr('Tür', 'Type')} <select id="tv-type">${opt('all', tr('Hepsi', 'All'), t.type)}${types.map((x) => opt(esc(x), esc(x), t.type)).join('')}</select></label>
        <label>${tr('Stok', 'Stock')} <select id="tv-stock">${opt('arrival', tr('Varışta stokta olacak', 'In stock on arrival'), t.stock)}${opt('now', tr('Şu an stokta', 'In stock now'), t.stock)}${opt('all', tr('Hepsi', 'All'), t.stock)}</select></label>
        <label>${tr('Uçuş süresi', 'Flight time')} <select id="tv-maxflight">${opt(0, tr('Hepsi', 'Any'), t.maxFlight)}${[60, 120, 180, 240].map((m) => opt(m, `≤ ${mins(m)}`, t.maxFlight)).join('')}</select></label>
        <label>${tr('Min. saatlik', 'Min. per hour')} <select id="tv-min">${[0, 50e3, 100e3, 250e3, 500e3, 1e6].map((v) => opt(v, v ? cmoney(v) : tr('Hepsi', 'Any'), t.minProfit)).join('')}</select></label>
        <label>${tr('Sırala', 'Sort')} <select id="tv-sort">${opt('perHour', tr('Saatlik kâr', 'Profit / hour'), t.sort)}${opt('trip', tr('Sefer kârı', 'Profit / trip'), t.sort)}${opt('unit', tr('Adet kârı', 'Profit / unit'), t.sort)}${opt('restock', tr('Restock zamanı', 'Restock time'), t.sort)}${opt('flight', tr('Uçuş süresi', 'Flight time'), t.sort)}</select></label>
        <label class="check"><input type="checkbox" id="tv-watchonly" ${t.watchOnly ? 'checked' : ''}> ★ ${tr('Sadece takip ettiklerim', 'Watched only')}</label>
        <button class="btn sm ghost" id="tv-reset">${tr('Filtreleri sıfırla', 'Reset filters')}</button>
      </div>
    </article>
    <div id="tv-results"></div>`;
  renderTravelResults();
}

function renderTravelResults() {
  const d = travelState.data, box = $('#tv-results');
  if (!d || !box) return;
  const now = nowTct() / 1000;
  const rows = travelRows();
  const best = [];
  for (const r of [...rows].sort((a, b) => b.perHour - a.perHour)) if (!best.some((b) => b.c.code === r.c.code)) best.push(r);
  // Yaklaşan restocklar: stok filtresinden bağımsız, şu an stokta olmayan kârlı ürünler
  const upcoming = travelRows({ ignoreStock: true })
    .filter((r) => r.it.qty <= 0 && r.it.nextRestock && r.it.nextRestock > now - 15 * 60 && r.it.nextRestock < now + 6 * 3600)
    .sort((a, b) => a.it.nextRestock - b.it.nextRestock).slice(0, 14);
  const ages = d.countries.map((c) => c.update).filter(Boolean);
  const oldest = ages.length ? Math.min(...ages) : null;
  const age = oldest != null ? Math.max(0, Math.round((now - oldest) / 60)) : null;
  const src = [d.sources?.yata && 'YATA', d.sources?.prom && 'Prometheus'].filter(Boolean).join(' + ') || '—';
  const star = (r) => `<button class="tv-star ${r.watched ? 'on' : ''}" data-watch="${esc(r.key)}" title="${r.watched ? tr('Takipten çıkar', 'Unwatch') : tr('Takip et: restock / kalkış bildirimi', 'Watch: restock / departure alerts')}">${r.watched ? '★' : '☆'}</button>`;
  const stockCell = (r) => {
    const it = r.it;
    const sub = it.qty > 0 && it.emptyAt ? `<div class="sub-text">≈ ${tvAt(it.emptyAt)} ${tr('sonra biter', 'until empty')}${it.rate ? ` · −${n0(it.rate)}/${tr('dk', 'min')}` : ''}</div>` : '';
    return `<span class="${it.qty <= 0 ? 'neg' : ''}">${n0(it.qty)}</span>${sub}`;
  };
  const restockCell = (r) => {
    const it = r.it;
    if (it.nextRestock) return `${tvAt(it.nextRestock)}<div class="sub-text">${hhmm(it.nextRestock)} · ${it.restockSrc === 'Prometheus' ? 'Prometheus' : tr('tahmin', 'estimate')}</div>`;
    if (it.qty > 0 && it.lastRestock) return `<span class="muted">${tr('son', 'last')} ${hhmm(it.lastRestock)}</span>`;
    return '<span class="muted">—</span>';
  };
  box.innerHTML = `
    <div class="grid travel-best">${best.slice(0, 6).map((r) => `<div class="glass kpi"><div class="label"><span lang="en">${esc(r.c.name)}</span> · ${mins(r.oneWay)}</div><div class="value tq">${cmoney(r.perHour)}<span class="sub-text">/${tr('sa', 'h')}</span></div><div class="hint">${esc(r.it.name)} · ${cmoney(r.trip)} ${tr('sefer başı', 'per trip')}</div></div>`).join('') || emptyBox(tr('Filtreye uyan kârlı ürün yok', 'No profitable items match the filters'), '')}</div>
    <article class="glass card">
      <div class="card-head"><div><h3>⟳ ${tr('Yaklaşan restocklar', 'Upcoming restocks')}</h3><span class="muted">${tr('Kalkış saati = restock anında inecek şekilde · ★ ile takip edersen kalkış ve stok bildirimi gelir', 'Departure times are set so you land right at the restock · star (★) an item to get departure and restock alerts')}</span></div></div>
      ${upcoming.length ? `<div class="tv-up">${upcoming.map((r) => {
        const depart = r.it.nextRestock - r.oneWay * 60;
        const go = depart > now
          ? `${tr('Kalkış', 'Depart')} <b class="mono">${hhmm(depart)}</b> · ${tvAt(depart)}`
          : `<b class="pos">${tr('Şimdi kalk', 'Fly now')}</b> · ${tr('varış', 'arrive')} ${hhmm(now + r.oneWay * 60)}`;
        return `<div class="tv-up-row ${r.watched ? 'watched' : ''}">
          ${star(r)}
          <div class="tv-up-time"><b class="mono">${hhmm(r.it.nextRestock)}</b>${tvAt(r.it.nextRestock)}</div>
          <div class="tv-up-item"><b>${esc(r.it.name)}</b><span class="sub-text"><span lang="en">${esc(r.c.name)}</span> · ${mins(r.oneWay)} · ${r.it.restockSrc === 'Prometheus' ? 'Prometheus' : tr('tahmin', 'estimate')}</span></div>
          <div class="tv-up-profit"><span class="pos mono">${money(r.it.profit)}</span><span class="sub-text">${cmoney(r.trip)} ${tr('sefer', 'per trip')}</span></div>
          <div class="tv-up-go">${go}</div>
        </div>`;
      }).join('')}</div>` : emptyBox(tr('Önümüzdeki 6 saatte beklenen restock yok', 'No restocks expected in the next 6 hours'), tr('Filtreleri genişletmeyi dene.', 'Try widening the filters.'))}
    </article>
    <article class="glass card">
      <div class="card-head wrap"><div><h3>${tr('Ürünler', 'Items')} <span class="chip">${rows.length}</span></h3><span class="muted">${tr('Kaynak', 'Source')}: ${src}${age != null ? ` · ${tr('en eski veri', 'oldest data')} <span data-tv-age="${oldest}">${age}</span> ${tr('dk', 'min')}` : ''} · ${tr('market = Torn ortalama değeri (saatlik), satış garantisi değil', "market = Torn's average value (hourly), not a guaranteed sale price")} · ${tr('uçak bileti hariç', 'excludes ticket cost')}</span>${travelState.error ? `<div class="sub-text neg">⚠ ${tr('Son yenileme başarısız', 'The last refresh failed')}: ${esc(travelState.error)}</div>` : ''}</div></div>
      ${rows.length ? `<div class="tbl-wrap"><table class="tbl compact tv-table"><thead><tr><th></th><th>${tr('Ülke', 'Country')}</th><th>${tr('Ürün', 'Item')}</th><th class="num">${tr('Alış → Market', 'Cost → Market')}</th><th class="num">${tr('Adet kârı', 'Profit/unit')}</th><th class="num">${tr('Stok', 'Stock')}</th><th>${tr('Restock', 'Restock')}</th><th>${tr('Varışta', 'On arrival')}</th><th class="num">${tr('Sefer kârı', 'Per trip')}</th><th class="num">${tr('Saatlik', 'Per hour')}</th></tr></thead><tbody>
      ${rows.slice(0, 60).map((r) => `<tr class="${r.watched ? 'watched' : ''}"><td>${star(r)}</td><td><span lang="en">${esc(r.c.name)}</span><div class="sub-text">${mins(r.oneWay)}</div></td><td><b>${esc(r.it.name)}</b> <span class="sub-text">${esc(r.it.type)}</span></td><td class="num">${money(r.it.cost)}<div class="sub-text">${money(r.it.market)}</div></td><td class="num ${(r.it.profit || 0) > 0 ? 'pos' : 'neg'}">${money(r.it.profit || 0)}</td><td class="num">${stockCell(r)}</td><td>${restockCell(r)}</td><td>${statusChip(r.st)}</td><td class="num">${money(r.trip)} <span class="sub-text">×${r.units}</span></td><td class="num tq-text"><b>${cmoney(r.perHour)}</b></td></tr>`).join('')}
      </tbody></table></div>` : emptyBox(tr('Filtreye uyan ürün yok', 'No items match the filters'), tr('Stok filtresini "Hepsi" yapmayı ya da ülke seçimini genişletmeyi dene.', 'Try setting Stock to "All" or selecting more countries.'))}
    </article>`;
}

/* Filtre olayları (tek sefer bağlanır; #travel-body kalıcı) */
(() => {
  const body = $('#travel-body'); if (!body) return;
  const changed = () => { saveTravelPrefs(); renderTravelResults(); };
  body.addEventListener('input', (e) => { if (e.target.id === 'tv-q') { travelState.q = e.target.value; renderTravelResults(); } });
  body.addEventListener('change', (e) => {
    const t = travelState, v = e.target.value;
    switch (e.target.id) {
      case 'tv-cap': t.cap = Math.min(100, Math.max(1, Number(v) || 15)); e.target.value = t.cap; break;
      case 'tv-method': t.method = v; saveTravelPrefs(); return renderTravel(); // uçuş süreleri değişir
      case 'tv-type': t.type = v; break;
      case 'tv-stock': t.stock = v; break;
      case 'tv-maxflight': t.maxFlight = Number(v) || 0; break;
      case 'tv-min': t.minProfit = Number(v) || 0; break;
      case 'tv-sort': t.sort = v; break;
      case 'tv-watchonly': t.watchOnly = e.target.checked; break;
      default: return;
    }
    changed();
  });
  body.addEventListener('click', (e) => {
    const cb = e.target.closest('[data-country]');
    if (cb) {
      const code = cb.dataset.country, set = travelState.countries;
      if (code === '*') set.clear(); else if (set.has(code)) set.delete(code); else set.add(code);
      $$('[data-country]', body).forEach((b) => b.classList.toggle('active', b.dataset.country === '*' ? !set.size : set.has(b.dataset.country)));
      return changed();
    }
    const w = e.target.closest('[data-watch]');
    if (w) {
      const k = w.dataset.watch;
      if (travelState.watch.has(k)) travelState.watch.delete(k); else {
        travelState.watch.add(k);
        if (!feat('notify') || !feat('notify.restock')) toast(tr('Bildirimler kapalı — Ayarlar › Bildirimler', 'Notifications are off — Settings › Notifications'));
        else if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      }
      return changed();
    }
    if (e.target.closest('#tv-reset')) {
      Object.assign(travelState, { q: '', type: 'all', stock: 'arrival', sort: 'perHour', minProfit: 0, maxFlight: 0, watchOnly: false });
      travelState.countries.clear();
      saveTravelPrefs(); renderTravel();
    }
  });
})();

/* Geri sayımlar + otomatik yenileme */
setInterval(() => {
  if (state.view !== 'travel' || !trackerVisible()) return;
  const now = nowTct() / 1000;
  $$('[data-tv-at]').forEach((el) => { const s = Number(el.dataset.tvAt) - now; el.textContent = tvFmt(s); el.classList.toggle('due', s <= 0); });
  $$('[data-tv-age]').forEach((el) => { el.textContent = Math.max(0, Math.round((now - Number(el.dataset.tvAge)) / 60)); });
}, 1000);
setInterval(() => {
  const bg = travelState.watch.size && !viewHidden('travel') && feat('notify') && feat('notify.restock');
  if (state.view !== 'travel' && !bg) return;
  fetchTravel().catch((e) => { travelState.error = e.message || String(e); }).then(() => { if (state.view === 'travel') renderTravelResults(); });
}, 120_000);

/* ---------- Seviye 15 altı: Baldr's Levelling Targets ---------- */
const levelState = {
  data: null,
  list: (() => { try { return localStorage.getItem('tt.level.list') || ''; } catch { return ''; } })(),
  okOnly: false,
  shellFor: null,
};

// The request now running: the 5 s poll waits for it, and a newer request (another list) replaces it,
// so a slow, older reply can never overwrite the newer one.
let levelLoading = null;
async function loadLevel() {
  const el = $('#level-body');
  if (!levelState.data) el.innerHTML = loadingBox();
  const req = api('/api/levelling?list=' + encodeURIComponent(levelState.list));
  levelLoading = req;
  try {
    const data = await req;
    if (levelLoading !== req) return;
    levelState.data = data;
    levelState.list = data.list;
    renderLevel();
  } catch (e) { if (levelLoading === req && !levelState.data) el.innerHTML = errorBox(e); }
  finally { if (levelLoading === req) levelLoading = null; }
}

// What the page shows (public/levelling.js): attackable targets you can beat first, highest level first, then the
// attackable ones whose stats match or beat yours, then those not checked yet. Targets in hospital, jail or travel
// are left out until they can be attacked again.
const levelMine = () => LRXLevelling.mineFrom(state.overview?.battle);
function levelView() {
  const v = LRXLevelling.order(levelState.data.targets, levelMine(), nowTct() / 1000);
  return levelState.okOnly ? { ...v, rows: v.rows.filter((t) => t.status?.state === 'Okay') } : v;
}

function levelShell(d) {
  const lvl = myLevel();
  return `
    <article class="glass card">
      <div class="card-head wrap"><h3>🎯 Baldr's Levelling Targets</h3>
        ${lvl ? `<span class="chip tq">${tr('Seviye', 'Level')} ${lvl} · ${tr(`15'e ${15 - lvl} seviye`, `${15 - lvl} ${15 - lvl === 1 ? 'level' : 'levels'} to 15`)}</span>` : ''}</div>
      <p class="muted lv-lead">${tr(
        'Bu listelerde seviyesi yüksek ama statları çok düşük, uzun süredir oynamayan oyuncular var. Seviye 15\'e en hızlı bu hedeflerle çıkılır.',
        'These lists hold long-inactive players with a high level but very low stats. They are the fastest way to reach level 15.')}</p>
      <div class="alert info"><div><b>⚔ ${tr('Kazanınca LEAVE seç.', 'When you win, choose LEAVE.')}</b> ${tr(
        'En yüksek EXP bu şekilde gelir. Mug para çalmak, Hospitalize rakibi hastanede tutmak içindir; ikisi de daha az EXP verir.',
        'That is how you get the most EXP. Mug is for stealing cash and Hospitalize for keeping them in hospital; both give less EXP.')}</div></div>
      <ul class="lv-tips">
        <li>${tr('Her saldırı 25 enerji harcar. Seviyesi yüksek hedef daha çok EXP verir, kaybedilen saldırı hiç vermez. ⭐ En yüksek EXP: statları seninkini geçmeyen en yüksek seviyeli üç hedef.', 'Each attack costs 25 energy. Higher-level targets give more EXP, and a lost attack gives none. ⭐ Best EXP: the three highest-level targets whose stats do not beat yours.')}</li>
        <li>${tr('Önce dört statını da yaklaşık 300\'e çıkar (Başlangıç Rehberi), sonra enerjini buraya harca.', 'First get all four stats to about 300 (Beginner Guide), then spend your energy here.')}</li>
        <li>${tr('Hastanede, hapiste ya da yolda olan hedefler listede görünmez; çıkınca geri gelir. Saldırdığın hedef birkaç saniye içinde yeniden kontrol edilir.', 'Targets in hospital, in jail or travelling are not listed; they come back once they are out. A target you attack is checked again within seconds.')}</li>
      </ul>
    </article>
    <article class="glass card">
      <div class="card-head wrap">
        <div class="lv-controls">
          <select id="lv-list" aria-label="${tr('Liste', 'List')}">${d.lists.map((n) => `<option value="${esc(n)}" ${n === d.list ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
          <label class="check"><input type="checkbox" id="lv-okonly" ${levelState.okOnly ? 'checked' : ''}> ${tr('Sadece saldırılabilir', 'Attackable only')}</label>
        </div>
        <span class="muted" id="lv-progress"></span>
      </div>
      <div class="tbl-wrap"><table class="tbl compact">
        <thead><tr><th>#</th><th>${tr('Oyuncu', 'Player')}</th><th class="num">${tr('Seviye', 'Level')}</th><th class="num">${tr('Toplam stat', 'Total stats')}</th><th>${tr('Durum', 'Status')}</th><th></th></tr></thead>
        <tbody id="lv-tbody"></tbody>
      </table></div>
      <p class="muted lv-source">${tr('Kaynak', 'Source')}: <a href="https://oran.pw/baldrstargets/" target="_blank" rel="noopener">Baldr's Levelling List</a> · ${tr(
        'durumlar kendi API key\'inle, yalnızca bu sayfa açıkken ve Torn sınırını zorlamadan yavaşça kontrol edilir.',
        'statuses are checked with your own API key, only while this page is open and slowly enough to stay within Torn\'s limit.')}</p>
    </article>`;
}

function renderLevel() {
  const d = levelState.data; if (!d) return;
  const key = `${state.lang}|${d.list}|${d.lists.join('|')}|${myLevel()}`;
  if (levelState.shellFor !== key || !$('#lv-tbody')) { $('#level-body').innerHTML = levelShell(d); levelState.shellFor = key; }
  const v = levelView(), best = new Set(v.best), mine = levelMine();
  const faces = { str: 'def', def: 'str', spd: 'dex', dex: 'spd' };
  const atkIcon = '<svg viewBox="0 0 24 24"><path d="M14.5 4.5l5 5L9 20H4v-5zM4 4l4 4"/></svg>';
  const checking = (t) => `<span class="muted">${t.checkedAt && !t.status ? '?' : tr('kontrol ediliyor…', 'checking…')}</span>`;
  $('#lv-tbody').innerHTML = v.rows.map((t, i) => {
    const st = t.status, okay = st?.state === 'Okay';
    const strong = okay ? LRXLevelling.stronger(t, mine) : [];
    const strongTip = strong.map((k) => `${k.toUpperCase()} ≥ ${tr('senin', 'your')} ${faces[k].toUpperCase()}`).join(' · ');
    const tag = best.has(t.id) ? ` <span class="chip tq">⭐ ${tr('En yüksek EXP', 'Best EXP')}</span>`
      : strong.length ? ` <span class="chip warn" title="${esc(strongTip)}">⚠ ${tr('Güçlü', 'Strong')}</span>` : '';
    return `<tr class="${best.has(t.id) ? 'lv-best' : !okay ? 'lv-dim' : ''}">
      <td class="mono muted">${i + 1}</td>
      <td><a href="https://www.torn.com/profiles.php?XID=${t.id}">${esc(t.name)}</a> <span class="muted mono">[${t.id}]</span>${tag}</td>
      <td class="num">${t.lvl}</td>
      <td class="num" title="STR ${n0(t.str)} · DEF ${n0(t.def)} · SPD ${n0(t.spd)} · DEX ${n0(t.dex)}">${n0(t.total)}</td>
      <td>${okay ? statusTimerChip(st, true) : checking(t)}</td>
      <td><a class="attack-btn" data-lv-id="${t.id}" href="https://www.torn.com/page.php?sid=attack&user2ID=${t.id}">${atkIcon}${tr('Saldır', 'Attack')}</a></td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="muted">${tr('Şu an saldırılabilir hedef yok; filtreyi kapat ya da başka listeye geç.', 'No attackable targets right now; clear the filter or pick another list.')}</td></tr>`;
  const okCount = v.rows.filter((t) => t.status?.state === 'Okay').length;
  $('#lv-progress').innerHTML = d.error
    ? `<span class="neg">${esc(d.error)}</span>`
    : `${tr('Saldırılabilir', 'Attackable')}: <b>${okCount}</b> · ${tr('hastane, hapis ya da yolda (gizli)', 'in hospital, jail or travelling (hidden)')}: ${v.blocked} · ${tr('kontrol edilen', 'checked')} ${d.checked}/${d.targets.length}`;
}

// Attack: the scan checks that target again every few seconds for a while, so it leaves the list once it is in hospital.
$('#level-body')?.addEventListener('click', (e) => {
  const a = e.target.closest('.attack-btn[data-lv-id]');
  if (a) api('/api/levelling/attacked', { method: 'POST', body: JSON.stringify({ id: Number(a.dataset.lvId) }) }).catch(() => {});
});

$('#level-body')?.addEventListener('change', (e) => {
  if (e.target.id === 'lv-list') {
    levelState.list = e.target.value;
    try { localStorage.setItem('tt.level.list', levelState.list); } catch {}
    levelState.data = null;
    loadLevel();
  } else if (e.target.id === 'lv-okonly') {
    levelState.okOnly = e.target.checked;
    renderLevel();
  }
});
// Sayfa açıkken durumları 5 sn'de bir al (sunucu taramayı yalnızca bu istekler gelirken sürdürür)
setInterval(() => { if (state.view === 'level' && trackerVisible() && !levelLoading) loadLevel(); }, 5000);

/* ---------- Seviye 15 altı: Başlangıç Rehberi (metinler ve kurallar: beginner-guide.js) ---------- */
// The shell is drawn once per language; every overview refresh repaints only the personal steps and the Happy jump
// checklist, so an opened Details stays open. Each <details data-gd-id> also remembers being open across redraws
// (a language switch, the Tools page). LRX only shows: every step is done by the player in Torn.
const guideUi = { shell: '', open: new Set() };
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.gdId) return;
  if (d.open) guideUi.open.add(d.dataset.gdId); else guideUi.open.delete(d.dataset.gdId);
}, true); // toggle does not bubble
const L2 = (p) => tr(p[0], p[1]);
const guideFmt = () => ({ num: n0, dur: human, time: (sec) => tctTime(sec * 1000).slice(0, 5) });
const gdList = (items, tag = 'ul') => `<${tag} class="gd-list">${items.map((p) => `<li>${esc(L2(p))}</li>`).join('')}</${tag}>`;
function gdDetails(id, blocks) {
  return `<details class="gd-more" data-gd-id="${id}"${guideUi.open.has(id) ? ' open' : ''}><summary>${tr('Detaylar', 'Details')}</summary>
      ${blocks.map((b) => `${b.head ? `<h4>${esc(L2(b.head))}</h4>` : ''}${gdList(b.items)}`).join('')}</details>`;
}

// The Happy jump card: the guide shows it under level 15, the Tools page from level 15 (tools.happyJump).
function happyJumpCard() {
  const s = LRXGuide.SECTIONS.find((x) => x.id === 'jump');
  return `<article class="glass card hj-card">
      <div class="card-head wrap"><h3>${s.icon} ${esc(L2(s.title))}</h3><span class="chip">${tr('Yalnızca gösterir', 'Display only')}</span></div>
      <div class="hj-live" data-hj-live></div>
      ${gdList(s.summary)}
      ${gdDetails('jump', s.details)}
      <p class="muted sl-note">${esc(L2(LRXGuide.JUMP_NOTE))}</p>
    </article>`;
}
// The live checklist of every Happy jump card under `root`, from the overview the app already has.
function paintJumpLive(root) {
  const slots = root?.querySelectorAll('[data-hj-live]');
  if (!slots?.length) return;
  const r = LRXGuide.jumpReadiness(state.overview, { nowMs: Date.now(), skewMs: state.skew || 0 });
  const c = r.checks;
  const row = (ok, label, value, title = '') => `<li class="${ok ? 'ok' : 'todo'}"${title ? ` title="${esc(title)}"` : ''}><span>${ok ? '✅' : '▫️'}</span><b>${label}</b><span class="mono">${value}</span></li>`;
  const rows = r.phase === 'unknown' ? '' : `<ul class="hj-checks">
      ${row(c.status.ok, tr('Durum', 'Status'), esc(statusInfo({ state: r.state || 'Okay' }).text))}
      ${row(c.energy.ok, tr('Enerji', 'Energy'), `${n0(c.energy.current)} / ${n0(c.energy.max)}`, tr(`Xanax ile biriktirme sınırı: ${n0(LRXGuide.STACK_CAP)}`, `Stacking cap with Xanax: ${n0(LRXGuide.STACK_CAP)}`))}
      ${row(c.drug.ok, 'Drug CD', c.drug.left ? human(c.drug.left) : tr('Hazır', 'Ready'))}
      ${row(c.booster.ok, 'Booster CD', c.booster.left ? human(c.booster.left) : tr('Boş', 'Empty'))}
      ${row(c.happy.ok, 'Happy', `${n0(c.happy.current)} / ${n0(c.happy.max)}`)}
    </ul>`;
  const html = `<div class="hj-next"><b>👉 ${tr('Sıradaki adım', 'Next step')}:</b> ${esc(L2(LRXGuide.phaseText(r, guideFmt())))}</div>${rows}`;
  for (const slot of slots) slot.innerHTML = html;
}

function guideAction(a) {
  if (!a) return '';
  if (a.view === 'level') return `<button class="btn sm" data-goto-view="level">🎯 ${tr('Hedeflere git', 'Open targets')}</button>`;
  if (a.view === 'job') return feat('page.job') ? `<button class="btn sm" data-goto-view="job">💼 ${tr('İş Asistanı', 'Job Assistant')}</button>` : '';
  if (a.url) return `<button class="btn sm ghost" data-open-url="${esc(a.url)}" data-tab-label="${esc(L2(a.label))}">${a.icon || ''} ${esc(L2(a.label))}</button>`;
  return '';
}
function paintGuideLive(body) {
  const lvl = myLevel();
  $('#gd-level').innerHTML = lvl ? `<span class="chip tq">${tr('Seviye', 'Level')} ${lvl} / 15</span>` : '';
  $('#gd-progress').innerHTML = lvl ? `<div class="storage-bar gd-progress"><i style="width:${Math.min(100, (lvl / 15) * 100)}%;background:var(--tq)"></i></div>` : '';
  const steps = LRXGuide.steps(state.overview, guideFmt());
  $('#gd-steps').innerHTML = steps.length
    ? steps.map((s) => `<li class="${s.done ? 'done' : 'todo'}"><span>${s.done ? '✅' : '▫️'}</span><div>${esc(L2(s.text))}</div>${guideAction(s.action)}</li>`).join('')
    : `<li class="muted">${tr('Kişisel öneriler için önce genel bakış verilerinin yüklenmesi gerekiyor.', 'Personal tips appear once your overview data has loaded.')}</li>`;
  paintJumpLive(body);
}
function renderGuide() {
  const body = $('#guide-body');
  if (!body) return;
  if (guideUi.shell !== state.lang || !body.querySelector('#gd-steps')) {
    body.innerHTML = `
    <article class="glass card">
      <div class="card-head wrap"><h3>👉 ${tr('Sıradaki adımların', 'Your next steps')}</h3><span id="gd-level"></span></div>
      <div id="gd-progress"></div>
      <ul class="gd-steps" id="gd-steps"></ul>
    </article>
    <article class="glass card">
      <div class="card-head"><h3>🧭 ${tr('Yol haritası', 'Roadmap')}</h3></div>
      <p class="muted gd-lead">${esc(L2(LRXGuide.LEAD))}</p>
      <div class="gd-road">${LRXGuide.ROADMAP.map((ph) => `<section class="gd-phase"><h4>${esc(L2(ph.title))}</h4>${gdList(ph.items, 'ol')}</section>`).join('')}</div>
    </article>
    ${happyJumpCard()}
    ${LRXGuide.SECTIONS.filter((s) => s.id !== 'jump').map((s) => `
      <article class="glass card" data-gd-section="${s.id}">
        <div class="card-head"><h3>${s.icon} ${esc(L2(s.title))}</h3></div>
        ${gdList(s.summary)}
        ${gdDetails(s.id, s.details)}
      </article>`).join('')}`;
    guideUi.shell = state.lang;
  }
  paintGuideLive(body);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-goto-view]');
  if (b) { e.preventDefault(); showView(b.dataset.gotoView); }
});

/* ---------- Görünüm kancaları ---------- */
const EXTRA_LOADERS = { job: loadJob, gym: loadGym, finance: (force) => window.loadFinance?.(force), travel: loadTravel, level: loadLevel, guide: renderGuide };
window.onViewShown = (v) => {
  if (v === 'settings') renderFeatureSettings();
  if (EXTRA_LOADERS[v]) EXTRA_LOADERS[v]();
};
$('#refresh-btn')?.addEventListener('click', () => { if (EXTRA_LOADERS[state.view]) EXTRA_LOADERS[state.view](true); });
window.onLangChanged = () => { renderFeatureSettings(); if (EXTRA_LOADERS[state.view]) EXTRA_LOADERS[state.view](); };

applyLang();
applyFeatures();
