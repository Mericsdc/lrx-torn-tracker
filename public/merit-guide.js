(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./merit-desc-tr.js'));
  else root.LRXMerit = factory(root.LRXMeritDescTR);
})(typeof globalThis === 'object' ? globalThis : this, function (DESC_TR = {}) {
  // Merit Tracker guidance. Turns /api/awards rows into groups, "how to get it" lines, series tiers, an order and the
  // Easy wins picks. Texts are [tr, en] pairs; the page picks one with tr(). The server says which personal stat a
  // rule reads (award.stat) and the rule's text capture (award.what, e.g. Theft, SMGs, Japan).
  // A Turkish line never carries an English sentence: Torn's texts without a counter come from public/merit-desc-tr.js,
  // and the words the rules capture (countries, weapon classes, crime types …) have Turkish names below.
  // LRX only shows information: the player does everything in Torn; links just open the Torn page.
  const GROUPS = ['count', 'time', 'once', 'record', 'long', 'event'];
  const GROUP_LABEL = {
    all: ['Tüm eksikler', 'All missing'],
    count: ['Sayaçlı işler', 'Counted actions'],
    time: ['Zamanla gelir', 'Comes with time'],
    once: ['Tek seferlik', 'One-time'],
    record: ['Kişisel rekor', 'Personal best'],
    long: ['Uzun vadeli', 'Long-term'],
    event: ['Etkinlik / mağaza', 'Event / shop'],
  };
  const EMPTY = {
    all: ['Eksik ödül yok, hepsini almışsın!', 'No missing awards: you have them all!'],
    filtered: ['Bu filtrelerle eşleşen ödül yok.', 'No award matches these filters.'],
    count: ['Sayaçlı eksik ödül yok.', 'No missing award with a counter.'],
    time: ['Zamanla gelecek eksik ödül yok.', 'No missing award that comes with time.'],
    once: ['Tek seferlik eksik ödül yok.', 'No missing one-time award.'],
    record: ['Kişisel rekor ödülü eksik değil.', 'No missing personal-best award.'],
    long: ['Uzun vadeli eksik ödül yok.', 'No missing long-term award.'],
    event: ['Etkinlik ya da mağaza ödülü eksik değil.', 'No missing event or shop award.'],
  };
  const EASY_EMPTY = {
    count: ['Sayaçlı ödüllerde henüz ilerleme yok.', 'No progress on any counted award yet.'],
    time: ['Önümüzdeki 60 günde kendiliğinden gelecek ödül yok.', 'Nothing comes by itself in the next 60 days.'],
    once: ['Kolay tek seferlik ödül kalmadı.', 'No easy one-time awards left.'],
  };
  const EASY_MAX = { count: 5, time: 3, once: 4 };
  const SOON_DAYS = 60;
  const ALMOST = 0.75;

  const PLACES = {
    crimes: [['Suçlar', 'Crimes'], 'https://www.torn.com/page.php?sid=crimes'],
    gym: [['Gym', 'Gym'], 'https://www.torn.com/gym.php'],
    travel: [['Seyahat', 'Travel'], 'https://www.torn.com/travelagency.php'],
    education: [['Eğitim', 'Education'], 'https://www.torn.com/page.php?sid=education'],
    jail: [['Hapishane', 'Jail'], 'https://www.torn.com/jailview.php'],
    hospital: [['Hastane', 'Hospital'], 'https://www.torn.com/hospitalview.php'],
    missions: [['Görevler', 'Missions'], 'https://www.torn.com/page.php?sid=missions'],
    racing: [['Yarışlar', 'Racing'], 'https://www.torn.com/page.php?sid=racing'],
    casino: [['Kumarhane', 'Casino'], 'https://www.torn.com/casino.php'],
    points: [['Points Building', 'Points Building'], 'https://www.torn.com/points.php'],
    pmarket: [['Points pazarı', 'Points market'], 'https://www.torn.com/pmarket.php'],
    bounties: [['Bounty listesi', 'Bounties'], 'https://www.torn.com/bounties.php'],
    items: [['Eşyalar', 'Items'], 'https://www.torn.com/item.php'],
    auction: [['Açık artırma', 'Auction House'], 'https://www.torn.com/amarket.php'],
    stocks: [['Borsa', 'Stock Market'], 'https://www.torn.com/page.php?sid=stocks'],
    city: [['Şehir', 'City'], 'https://www.torn.com/city.php'],
    dump: [['Çöplük', 'Dump'], 'https://www.torn.com/dump.php'],
    attacks: [['Saldırılar', 'Attacks'], null],
    faction: [['Faction', 'Faction'], null],
    job: [['İş', 'Job'], null],
    bazaar: [['Bazaar', 'Bazaar'], null],
  };
  const place = (key) => (PLACES[key] ? { label: PLACES[key][0], url: PLACES[key][1] } : null);
  // Award type (Torn's category) → place, for awards without a counter
  const TYPE_PLACE = { crime: 'crimes', crimes: 'crimes', casino: 'casino', missions: 'missions', education: 'education', travel: 'travel',
    jail: 'jail', hospital: 'hospital', gym: 'gym', items: 'items', attacking: 'attacks', combat: 'attacks', weapons: 'attacks', camo: 'attacks' };

  const TIME = new Set(['age', 'married', 'faction', 'other.donator_days', 'other.activity.streak.best', 'other.activity.time']);
  // Time awards with a real countdown: age always runs; marriage and faction days only while the counter is above 0.
  // Donator days (status unknown here) and the best login streak (not the current one) get no countdown.
  const COUNTDOWN = { age: () => true, married: (a) => a.cur > 0, faction: (a) => a.cur > 0 };
  const RECORD = new Set(['attacking.killstreak.best', 'attacking.damage.best', 'attacking.networth.largest_mug']);
  const LONG = new Set(['level', 'rank', 'education', 'other.awards', 'networth.total', 'racing.skill', 'travel.hunting.skill',
    'travel.time_spent', 'investments.stocks.profits', 'investments.stocks.losses', 'jobs.stats.endurance|jobs.stats.intelligence|jobs.stats.manual']);
  const LONG_PREFIX = ['battle_stats.', 'jobs.stats.', 'crimes.skills.'];
  const MONEY = new Set(['bounties.collected.value', 'attacking.networth.largest_mug', 'networth.total', 'investments.stocks.profits', 'investments.stocks.losses']);

  // Turkish names for the words the server rules capture (award.what) and for stat ids. [tr, en]; the Turkish one is
  // already in the form the sentence needs (Japonya'ya = "to Japan", Tabancalarla = "with pistols").
  const WORK = { endurance: ['dayanıklılık (endurance)', 'endurance'], intelligence: ['zekâ (intelligence)', 'intelligence'],
    manual: ['el emeği (manual labor)', 'manual labor'] };
  const BATTLE = { strength: 'güç (strength)', defense: 'savunma (defense)', speed: 'hız (speed)', dexterity: 'çeviklik (dexterity)' };
  const COUNTRY = {
    'Mexico': ['Meksika\'ya', 'Mexico'], 'Cayman Islands': ['Cayman Adaları\'na', 'the Cayman Islands'], 'Canada': ['Kanada\'ya', 'Canada'],
    'Hawaii': ['Hawaii\'ye', 'Hawaii'], 'United Kingdom': ['Birleşik Krallık\'a', 'the United Kingdom'], 'Argentina': ['Arjantin\'e', 'Argentina'],
    'Switzerland': ['İsviçre\'ye', 'Switzerland'], 'Japan': ['Japonya\'ya', 'Japan'], 'China': ['Çin\'e', 'China'],
    'United Arab Emirates': ['Birleşik Arap Emirlikleri\'ne', 'the United Arab Emirates'], 'South Africa': ['Güney Afrika\'ya', 'South Africa'],
  };
  const WEAPON = {
    'mechanical weapons': 'Mekanik silahlarla', 'heavy artillery': 'Ağır silahlarla (heavy artillery)',
    'clubbing weapons': 'Darbe silahlarıyla (clubbing)', 'temporary weapons': 'Geçici silahlarla (temporary)',
    'machine guns': 'Makineli tüfeklerle', 'pistols': 'Tabancalarla', 'rifles': 'Tüfeklerle', 'shotguns': 'Pompalı tüfeklerle (shotgun)',
    'SMGs': 'SMG\'lerle', 'piercing weapons': 'Delici silahlarla (piercing)', 'slashing weapons': 'Kesici silahlarla (slashing)',
    'fists or kick': 'Yumruk ya da tekmeyle',
  };
  const CRIME_TYPE = {
    'Vandalism': 'Vandalizm (Vandalism)', 'Theft': 'Hırsızlık (Theft)', 'Counterfeiting': 'Kalpazanlık (Counterfeiting)',
    'Fraud': 'Dolandırıcılık (Fraud)', 'Illicit Service': 'Yasa dışı hizmet (Illicit Service)', 'Cybercrime': 'Siber suç (Cybercrime)',
    'Extortion': 'Haraç (Extortion)', 'Illegal Production': 'Yasa dışı üretim (Illegal Production)',
  };
  const EDU_FIELD = {
    'Biology': 'Biyoloji', 'Business': 'İşletme', 'Business Management': 'İşletme', 'Combat': 'Dövüş', 'Combat Training': 'Dövüş',
    'ICT': 'Bilişim', 'Defense': 'Savunma', 'General Studies': 'Genel Bilgi', 'Health & Fitness': 'Sağlık ve Fitness', 'History': 'Tarih',
    'Law': 'Hukuk', 'Mathematics': 'Matematik', 'Psychology': 'Psikoloji', 'Sports Science': 'Spor Bilimi',
  };
  // Torn's award categories (award.type) and rarities
  const TYPE_LABEL = {
    attacking: ['Saldırı', 'Attacking'], camo: ['Kamuflaj', 'Camo'], casino: ['Kumarhane', 'Casino'], combat: ['Dövüş', 'Combat'],
    commitment: ['Bağlılık', 'Commitment'], competitions: ['Yarışmalar', 'Competitions'], crime: ['Suç', 'Crime'], crimes: ['Suçlar', 'Crimes'],
    drugs: ['Uyuşturucu', 'Drugs'], education: ['Eğitim', 'Education'], gym: ['Gym', 'Gym'], hospital: ['Hastane', 'Hospital'],
    items: ['Eşyalar', 'Items'], jail: ['Hapishane', 'Jail'], level: ['Seviye', 'Level'], misc: ['Diğer', 'Misc'],
    miscellaneous: ['Çeşitli', 'Miscellaneous'], missions: ['Görevler', 'Missions'], money: ['Para', 'Money'], networth: ['Networth', 'Networth'],
    rank: ['Rütbe', 'Rank'], travel: ['Seyahat', 'Travel'], weapons: ['Silahlar', 'Weapons'],
  };
  const RARITY_LABEL = {
    'Very Common': 'Çok yaygın', 'Common': 'Yaygın', 'Uncommon': 'Az bulunur', 'Rare': 'Nadir', 'Very Rare': 'Çok nadir',
    'Extremely Rare': 'Son derece nadir', 'Limited': 'Sınırlı', 'Unknown Rarity': 'Nadirliği bilinmiyor',
  };
  const typeLabel = (t) => TYPE_LABEL[t] || [String(t || ''), String(t || '')];
  const rarityLabel = (r) => (r ? [RARITY_LABEL[r] || r, r] : null);

  // The Turkish dative ending for a number as it is read out: 10'a (on), 50'ye (elli), 100'e (yüz), 1,000'e (bin),
  // 1,000,000'a (milyon). Only the last word read matters.
  const ONES = ['a', 'e', 'ye', 'e', 'e', 'e', 'ya', 'ye', 'e', 'a']; // sıfır bir iki üç dört beş altı yedi sekiz dokuz
  const TENS = ['', 'a', 'ye', 'a', 'a', 'ye', 'a', 'e', 'e', 'a']; // on yirmi otuz kırk elli altmış yetmiş seksen doksan
  function trDative(value) {
    let n = Math.abs(Math.round(Number(value) || 0));
    if (n === 0) return 'a';
    if (n % 10) return ONES[n % 10];
    if (n % 100) return TENS[(n % 100) / 10];
    if (n % 1000) return 'e'; // yüz
    for (const big of ['e', 'a', 'a', 'a']) { // bin, milyon, milyar, trilyon
      n = Math.floor(n / 1000);
      if (n % 1000) return big;
    }
    return 'a';
  }
  // Torn's text without extra spaces or a final period: the key of DESC_TR
  const descKey = (desc) => String(desc || '').trim().replace(/\s+/g, ' ').replace(/\.$/, '');

  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MONTH_NAME = [['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
    ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']];
  const LOGIN_RE = /^Log ?in on ([A-Za-z]+) (\d{1,2})(?:st|nd|rd|th)?$/i;
  const TOKEN_RE = /Purchased from Token Shop or Points Building/i;
  const BACHELOR_RE = /^Complete all classes in (.+)$/i;
  const DAY = 86_400_000;

  // How-lines by stat id. v: n (remaining), goal, cur (formatted), what (the rule's capture), nr (remaining, raw),
  // p(one, many): the English noun for nr (1 day / 2 days); Turkish nouns do not change.
  const H = (place, fn) => ({ place, fn });
  const HOW = {
    'attacking.hits.critical': H('attacks', (v) => [`Saldırılarda ${v.n} kritik vuruş daha yap.`, `Land ${v.n} more ${v.p('critical hit')} in attacks.`]),
    'attacking.hits.success': H('attacks', (v) => [`${v.n} başarılı vuruş daha yap.`, `Land ${v.n} more successful ${v.p('hit')}.`]),
    'attacking.hits.one_hit_kills': H('attacks', (v) => [`Tek vuruşta ${v.n} öldürme daha yap.`, `Get ${v.n} more one-hit ${v.p('kill')}.`]),
    'attacking.killstreak.best': H('attacks', (v) => [`Tek seferde ${v.goal} kill streak yap (en iyi sonucun: ${v.cur}).`, `Reach a kill streak of ${v.goal} in one run (your best: ${v.cur}).`]),
    'attacking.attacks.assist': H('attacks', (v) => [`${v.n} saldırıya daha yardım et (assist).`, `Assist in ${v.n} more ${v.p('attack')}.`]),
    'bounties.collected.amount': H('bounties', (v) => [`${v.n} bounty daha topla.`, `Collect ${v.n} more ${v.p('bounty', 'bounties')}.`]),
    'bounties.collected.value': H('bounties', (v) => [`Bounty avından ${v.n} daha kazan.`, `Earn ${v.n} more from bounty hunting.`]),
    'attacking.damage.total': H('attacks', (v) => [`Toplam ${v.n} hasar daha ver.`, `Deal ${v.n} more total damage.`]),
    'attacking.damage.best': H('attacks', (v) => [`Tek vuruşta en az ${v.goal} hasar ver (en iyi sonucun: ${v.cur}).`, `Deal at least ${v.goal} damage in a single hit (your best: ${v.cur}).`]),
    'attacking.ammunition.total': H('attacks', (v) => [`${v.n} mermi daha ateşle.`, `Fire ${v.n} more ${v.p('round')}.`]),
    'attacking.networth.largest_mug': H('attacks', (v) => [`Tek bir mug'da ${v.goal} kazan (en iyi sonucun: ${v.cur}).`, `Make ${v.goal} from a single mugging (your best: ${v.cur}).`]),
    'attacking.attacks.stealth': H('attacks', (v) => [`${v.n} gizli (stealth) saldırı daha yap.`, `Make ${v.n} more stealthed ${v.p('attack')}.`]),
    'attacking.attacks.stalemate|attacking.defends.stalemate': H('attacks', (v) => [`${v.n} beraberlik (stalemate) daha; saldırı ya da savunma sayılır.`, `${v.n} more ${v.p('stalemate')}; attacks and defends both count.`]),
    'attacking.defends.won': H('attacks', (v) => [`${v.n} savunma daha kazan (sana saldırıldığında).`, `Win ${v.n} more ${v.p('defend')} (when you are attacked).`]),
    'attacking.unarmored_wins': H('attacks', (v) => [`Zırhsız ${v.n} dövüş daha kazan.`, `Win ${v.n} more ${v.p('fight')} without armor.`]),
    'attacking.attacks.won': H('attacks', (v) => [`${v.n} saldırı daha kazan.`, `Win ${v.n} more ${v.p('attack')}.`]),
    'attacking.faction.respect': H('faction', (v) => [`Faction'ın için ${v.n} respect daha kazan.`, `Earn ${v.n} more respect for your faction.`]),
    'attacking.escapes.foes': H('attacks', (v) => [`${v.n} rakibin daha senden kaçsın.`, `Let ${v.n} more ${v.p('enemy', 'enemies')} escape from you.`]),
    'attacking.escapes.player': H('attacks', (v) => [`${v.n} dövüşten daha kaç.`, `Escape from ${v.n} more ${v.p('fight')}.`]),
    'attacking.ammunition.special': H('attacks', (v) => [`${v.n} özel mermi daha kullan.`, `Fire ${v.n} more ${v.p('round')} of special ammo.`]),
    'travel.hunting.skill': H('travel', (v) => [`Yurt dışında avlanarak hunting skill'ini ${v.to} çıkar (şu an ${v.cur}).`, `Raise your hunting skill to ${v.goal} by hunting abroad (now ${v.cur}).`]),
    'other.activity.time': H(null, (v) => [`Torn'da ${v.n} saat daha aktif ol.`, `Be active in Torn for ${v.n} more ${v.p('hour')}.`]),
    'other.activity.streak.best': H(null, (v) => [`Her gün giriş yap: en uzun serin ${v.cur} gün, hedef ${v.goal} gün.`, `Log in every day: your best streak is ${v.cur}, the goal is ${v.goal} days.`]),
    'other.donator_days': H(null, (v) => [`${v.n} gün daha donator ol (yalnızca donator günleri sayılır).`, `Be a donator ${v.n} more ${v.p('day')} (only donator days count).`]),
    'crimes.offenses.total': H('crimes', (v) => [`${v.n} suç daha işle.`, `Commit ${v.n} more ${v.p('crime')}.`]),
    'crimes.offenses.organized_crimes': H('faction', (v) => [`${v.n} organize suça (OC) daha katıl.`, `Join ${v.n} more organized ${v.p('crime')} (OC).`]),
    'jobs.stats.endurance|jobs.stats.intelligence|jobs.stats.manual': H('job', (v) => [`Herhangi bir çalışma statını ${v.to} çıkar (en yüksek olanı: ${v.cur}).`, `Get any working stat to ${v.goal} (your highest: ${v.cur}).`]),
    'education': H('education', (v) => [`${v.n} eğitim kursu daha bitir.`, `Finish ${v.n} more education ${v.p('course')}.`]),
    'battle_stats.total': H('gym', (v) => [`Gym'de toplam ${v.n} savaş statı (battle stat) daha kazan.`, `Gain ${v.n} more total battle stats in the gym.`]),
    'hospital.blood_withdrawn': H('items', (v) => [`${v.n} boş kan torbası daha doldur.`, `Fill ${v.n} more empty blood ${v.p('bag')}.`]),
    'hospital.times_hospitalized': H('hospital', (v) => [`${v.n} kez daha hastaneye düş.`, `Go to hospital ${v.n} more ${v.p('time')}.`]),
    'hospital.reviving.revives': H('hospital', (v) => [`${v.n} kişiyi daha canlandır (revive).`, `Revive ${v.n} more ${v.p('person', 'people')}.`]),
    'hospital.medical_items_used': H('items', (v) => [`${v.n} tıbbi eşya daha kullan.`, `Use ${v.n} more medical ${v.p('item')}.`]),
    'items.used.alcohol': H('items', (v) => [`${v.n} şişe alkol daha iç.`, `Drink ${v.n} more ${v.p('bottle')} of alcohol.`]),
    'items.used.energy_drinks': H('items', (v) => [`${v.n} kutu enerji içeceği daha iç.`, `Drink ${v.n} more ${v.p('can')} of energy drink.`]),
    'items.used.candy': H('items', (v) => [`${v.n} paket şeker daha ye.`, `Eat ${v.n} more ${v.p('bag')} of candy.`]),
    'items.found.city': H('city', (v) => [`Şehir haritasında ${v.n} eşya daha bul.`, `Find ${v.n} more ${v.p('item')} on the City map.`]),
    'items.found.dump': H('dump', (v) => [`Çöplükte ${v.n} eşya daha bul.`, `Find ${v.n} more ${v.p('item')} in the dump.`]),
    'trading.bazaar.customers': H('bazaar', (v) => [`Bazaar'ını açık tut: ${v.n} müşteri daha.`, `Keep your bazaar open: ${v.n} more ${v.p('customer')}.`]),
    'items.used.books': H('items', (v) => [`${v.n} kitap daha oku.`, `Read ${v.n} more ${v.p('book')}.`]),
    'items.trashed': H('items', (v) => [`${v.n} eşya daha çöpe at.`, `Trash ${v.n} more ${v.p('item')}.`]),
    'trading.items.auctions.won': H('auction', (v) => [`${v.n} açık artırma daha kazan.`, `Win ${v.n} more ${v.p('auction')}.`]),
    'jail.busts.success': H('jail', (v) => [`Jail'den ${v.n} kişi daha çıkar (bust).`, `Bust ${v.n} more ${v.p('person', 'people')} out of jail.`]),
    'jail.times_jailed': H('jail', (v) => [`${v.n} kez daha hapse gir.`, `Go to jail ${v.n} more ${v.p('time')}.`]),
    'jail.bails.amount': H('jail', (v) => [`${v.n} kişiye daha kefalet öde (bail).`, `Bail out ${v.n} more ${v.p('person', 'people')}.`]),
    'level': H(null, (v) => [`${v.goal}. seviyeye çık (şu an ${v.cur}): ${v.n} seviye kaldı.`, `Reach level ${v.goal} (now ${v.cur}): ${v.n} ${v.p('level')} to go.`]),
    'rank': H(null, (v) => [`${v.what} rütbesine çık: rütbe seviyen, suç sayın ve networth'ün arttıkça yükselir.`, `Reach the rank of ${v.what}: your rank rises as your level, crime count and networth grow.`]),
    'other.awards': H(null, (v) => [`${v.n} ödül daha kazan; diğer ödülleri aldıkça kendiliğinden gelir.`, `Earn ${v.n} more ${v.p('award')}; it comes as you collect the others.`]),
    'items.viruses_coded': H(null, (v) => [`${v.n} virüs daha yaz.`, `Code ${v.n} more ${v.p('virus', 'viruses')}.`]),
    'racing.points': H('racing', (v) => [`${v.n} yarış puanı (racing point) daha kazan.`, `Earn ${v.n} more racing ${v.p('point')}.`]),
    'racing.skill': H('racing', (v) => [`Yarışarak racing skill'ini ${v.to} çıkar (şu an ${v.cur}).`, `Raise your racing skill to ${v.goal} by racing (now ${v.cur}).`]),
    'racing.races.won': H('racing', (v) => [`${v.n} yarış daha kazan.`, `Win ${v.n} more ${v.p('race')}.`]),
    'other.refills.energy': H('points', (v) => [`Enerji barını ${v.n} kez daha doldur (refill).`, `Refill your energy bar ${v.n} more ${v.p('time')}.`]),
    'other.refills.nerve': H('points', (v) => [`Nerve barını ${v.n} kez daha doldur (refill).`, `Refill your nerve bar ${v.n} more ${v.p('time')}.`]),
    'other.refills.token': H('points', (v) => [`Casino token'larını ${v.n} kez daha doldur.`, `Refill your casino tokens ${v.n} more ${v.p('time')}.`]),
    'trading.points.sold': H('pmarket', (v) => [`Points market'te ${v.n} puan daha sat.`, `Sell ${v.n} more ${v.p('point')} on the market.`]),
    'jobs.job_points_used': H('job', (v) => [`${v.n} iş puanı (job point) daha kullan.`, `Use ${v.n} more job ${v.p('point')}.`]),
    'missions.contracts.total': H('missions', (v) => [`${v.n} görev (contract) daha bitir.`, `Complete ${v.n} more mission ${v.p('contract')}.`]),
    'missions.credits': H('missions', (v) => [`${v.n} görev kredisi (mission credit) daha kazan.`, `Earn ${v.n} more mission ${v.p('credit')}.`]),
    'investments.stocks.losses': H('stocks', (v) => [`Borsada ${v.n} daha zarar et.`, `Lose ${v.n} more on the stock market.`]),
    'investments.stocks.profits': H('stocks', (v) => [`Borsada ${v.n} daha kâr et.`, `Make ${v.n} more profit on the stock market.`]),
    'investments.stocks.payouts': H('stocks', (v) => [`${v.n} hisse temettüsü (payout) daha al.`, `Collect ${v.n} more stock ${v.p('payout')}.`]),
    'travel.attacks_won': H('travel', (v) => [`Yurt dışındayken ${v.n} kişiyi daha yen.`, `Defeat ${v.n} more ${v.p('person', 'people')} while abroad.`]),
    'travel.items_bought': H('travel', (v) => [`Yurt dışından ${v.n} eşya daha getir.`, `Bring back ${v.n} more ${v.p('item')} from abroad.`]),
    'travel.time_spent': H('travel', (v) => [`${v.n} gün daha uçakta geçir (uzun uçuşlar daha hızlı doldurur).`, `Spend ${v.n} more ${v.p('day')} in the air (long flights fill it faster).`]),
    'travel.total': H('travel', (v) => [`${v.n} kez daha yurt dışına uç.`, `Fly abroad ${v.n} more ${v.p('time')}.`]),
    'networth.total': H(null, (v) => [`Networth'ünü ${v.n} daha artır.`, `Grow your networth by ${v.n} more.`]),
    'age': H(null, (v) => [`${v.n} gün sonra kendiliğinden gelir.`, `Comes by itself in ${v.n} ${v.p('day')}.`]),
    'married': H(null, (v) => [`${v.n} gün daha evli kal.`, `Stay married ${v.n} more ${v.p('day')}.`]),
    'faction': H('faction', (v) => [`Aynı faction'da ${v.n} gün daha kal.`, `Stay in the same faction ${v.n} more ${v.p('day')}.`]),
  };
  // Stat families (checked in order when there is no exact entry)
  const HOW_PREFIX = [
    ['finishing_hits.', (s) => s.includes('|'), H('attacks', (v) => [`Her silah türünde ${v.goal} finishing hit'e ulaş (en düşük olanı: ${v.cur}).`, `Reach ${v.goal} finishing hits in every weapon class (your weakest: ${v.cur}).`])],
    ['finishing_hits.', null, H('attacks', (v) => [`${WEAPON[v.what] || `${v.what} ile`} ${v.n} dövüşü daha bitir (finishing hit).`, `Finish ${v.n} more ${v.p('fight')} with ${v.what} (finishing hits).`])],
    ['crimes.offenses.', null, H('crimes', (v) => [`${CRIME_TYPE[v.what] || v.what} türünde ${v.n} suç daha işle.`, `Commit ${v.n} more ${v.what} ${v.p('offense')}.`])],
    ['crimes.skills.', null, H('crimes', (v) => [`${v.what} suçunu işleyerek skill'ini ${v.to} çıkar (şu an ${v.cur}).`, `Raise your ${v.what} skill to ${v.goal} by doing that crime (now ${v.cur}).`])],
    ['drugs.', null, H('items', (v) => [`${v.n} ${v.what} daha kullan.`, `Use ${v.n} more ${v.what}.`])],
    ['battle_stats.', null, H('gym', (v) => [`Gym'de ${v.n} ${BATTLE[v.what] || v.what} daha kazan.`, `Gain ${v.n} more ${v.what} in the gym.`])],
    ['jobs.stats.', null, H('job', (v) => [`İşinde her gün çalışarak ${v.n} ${v.work[0]} daha kazan.`, `Gain ${v.n} more ${v.work[1]} by working your job every day.`])],
    ['attacking.ammunition.', null, H('attacks', (v) => [`${v.n} ${v.what} mermi daha kullan.`, `Fire ${v.n} more ${v.what} ${v.p('round')}.`])],
    ['travel.', null, H('travel', (v) => {
      const [to, name] = COUNTRY[v.what] || [`${v.what} ülkesine`, v.what];
      return [`${to} ${v.n} kez daha uç.`, `Fly to ${name} ${v.n} more ${v.p('time')}.`];
    })],
  ];
  function howEntry(stat) {
    if (HOW[stat]) return HOW[stat];
    for (const [prefix, test, entry] of HOW_PREFIX) if (stat.startsWith(prefix) && (!test || test(stat))) return entry;
    return null;
  }

  function groupOf(a) {
    const desc = String(a.description || '');
    if (a.stat && a.goal != null && a.cur != null) {
      if (TIME.has(a.stat)) return 'time';
      if (RECORD.has(a.stat)) return 'record';
      if (LONG.has(a.stat) || LONG_PREFIX.some((p) => a.stat.startsWith(p) && !a.stat.includes('|'))) return 'long';
      return 'count';
    }
    if (a.goal != null && a.cur != null) return 'count'; // a counter the server did not name (older server)
    if (a.type === 'competitions' || TOKEN_RE.test(desc)) return 'event';
    if (BACHELOR_RE.test(desc)) return 'long';
    if (LOGIN_RE.test(desc) && MONTHS.includes(desc.match(LOGIN_RE)[1].toLowerCase())) return 'time';
    return 'once';
  }
  const isSecret = (a) => {
    const d = String(a.description || '').trim();
    return !d || /\?$/.test(d) || d.toLowerCase() === String(a.name || '').trim().toLowerCase();
  };
  // Days from today (TCT = UTC) to the next <month> <day>; 0 on the day itself
  function daysToDate(month, day, now) {
    const t = new Date(now);
    const today = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
    let target = Date.UTC(t.getUTCFullYear(), month, day);
    if (target < today) target = Date.UTC(t.getUTCFullYear() + 1, month, day);
    return Math.round((target - today) / DAY);
  }
  const dayWord = (d) => (d === 0 ? ['bugün', 'today'] : d === 1 ? ['yarın', 'tomorrow'] : [`${d} gün sonra`, `in ${d} days`]);

  // Torn's text as a [tr, en] pair: the Turkish line from DESC_TR, or Torn's English as a quote when the app has none
  const descPair = (desc) => {
    const en = descKey(desc);
    return [DESC_TR[en] || `Torn'un açıklaması: “${en}”`, en];
  };

  // { group, how: [tr, en], place: { label, url } | null, days: number | null, side: [tr, en] | null, secret }
  function guide(a, fmt, now = Date.now()) {
    const group = groupOf(a);
    const desc = String(a.description || '');
    const holders = (n) => [`${fmt.num(n)} oyuncuda var`, `${fmt.num(n)} ${n === 1 ? 'player has' : 'players have'} it`];
    const out = { group, how: null, place: null, days: null, side: null, secret: false };
    if (a.goal != null && a.cur != null) {
      const stat = a.stat || '';
      const money = MONEY.has(stat) ? fmt.money : fmt.num;
      const nr = Math.max(0, a.goal - a.cur);
      const work = WORK[stat.split('.').pop()] || ['', ''];
      const p = (one, many = one + 's') => (nr === 1 ? one : many);
      const v = { n: money(nr), nr, goal: money(a.goal), cur: money(a.cur), what: a.what || '', work, p, to: `${money(a.goal)}'${trDative(a.goal)}` };
      const entry = stat ? howEntry(stat) : null;
      out.how = entry ? entry.fn(v) : [`Hedefe ${v.n} kaldı.`, `${v.n} more to go: ${descKey(desc)}`];
      out.place = entry ? place(entry.place) : null;
      if (group === 'time' && COUNTDOWN[stat]?.(a)) { out.days = nr; out.side = dayWord(nr); }
      if (stat === 'other.activity.time') out.side = [`${v.n} saat kaldı`, `${v.n} ${p('hour')} left`];
      return out;
    }
    if (group === 'event') {
      const [dTr, dEn] = descPair(desc);
      out.how = TOKEN_RE.test(desc)
        ? ['Token Shop ya da Points Building\'den satın alınır.', 'Bought from the Token Shop or the Points Building.']
        : [`Etkinlik ödülü, yalnızca etkinlik sürerken alınır: ${dTr}`, `Event award, only while the event runs: ${dEn}`];
      out.place = TOKEN_RE.test(desc) ? place('points') : null;
      out.side = holders(a.circulation || 0);
      return out;
    }
    if (group === 'long') { // an education bachelor
      const what = descKey(desc).match(BACHELOR_RE)[1];
      const field = EDU_FIELD[what] ? `${EDU_FIELD[what]} (${what})` : what;
      out.how = [`Eğitim sayfasında ${field} bölümündeki bütün kursları bitir.`, `Finish every course in ${what} on the Education page.`];
      out.place = place('education');
      out.side = holders(a.circulation || 0);
      return out;
    }
    if (group === 'time') { // Login on <month> <day>
      const [, mon, day] = desc.match(LOGIN_RE);
      const mi = MONTHS.indexOf(mon.toLowerCase());
      const d = daysToDate(mi, Number(day), now);
      const date = [`${Number(day)} ${MONTH_NAME[0][mi]}`, `${Number(day)} ${MONTH_NAME[1][mi]}`];
      out.days = d;
      out.side = dayWord(d);
      out.how = d === 0 ? ['Bugün Torn\'a giriş yap.', 'Log in to Torn today.']
        : d === 1 ? [`Yarın Torn'a giriş yap (${date[0]}).`, `Log in to Torn tomorrow (${date[1]}).`]
          : [`${date[0]} günü Torn'a giriş yap (${d} gün sonra).`, `Log in to Torn on ${date[1]} (in ${d} days).`];
      return out;
    }
    out.secret = isSecret(a);
    out.how = out.secret ? ['Gizli ödül: Torn nasıl alınacağını söylemiyor.', 'Secret award: Torn does not say how to get it.']
      : descPair(desc);
    out.place = out.secret ? null : place(TYPE_PLACE[a.type]);
    out.side = holders(a.circulation || 0);
    return out;
  }

  // Same stat = same series (level 45/50/55 …, every Theft tier, every rank); awards without a stat stand alone.
  const seriesKey = (a) => a.stat || null;

  // Missing awards with their guide and a `higher` flag (a higher tier of a series whose lowest missing goal is lower)
  function annotate(list, fmt, now) {
    const rows = list.filter((a) => !a.owned).map((a) => ({ ...a, g: guide(a, fmt, now) }));
    const next = new Map();
    for (const r of rows) {
      const k = seriesKey(r);
      if (k && r.goal != null && !(next.get(k) <= r.goal)) next.set(k, r.goal);
    }
    for (const r of rows) { const k = seriesKey(r); r.higher = !!k && r.goal != null && r.goal > next.get(k); }
    return rows;
  }
  const byPct = (a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.circulation - a.circulation;
  const byHolders = (a, b) => b.circulation - a.circulation;
  function compare(a, b) {
    const ga = GROUPS.indexOf(a.g.group), gb = GROUPS.indexOf(b.g.group);
    if (ga !== gb) return ga - gb;
    if (a.g.group === 'time') return (a.g.days ?? Infinity) - (b.g.days ?? Infinity) || byPct(a, b);
    if (a.g.group === 'once') return (a.g.secret - b.g.secret) || byHolders(a, b);
    if (a.g.group === 'event') return byHolders(a, b);
    return a.pct == null && b.pct == null ? byHolders(a, b) : byPct(a, b);
  }

  // opts: { show: 'all' | group, kind: 'all' | 'honor' | 'medal', type: '', q: '', tiers: false }
  // → { rows, hidden (higher tiers left out), empty: [tr, en] | null, narrowed (filters emptied it) }
  function view(awards, opts = {}, fmt, now = Date.now()) {
    const show = opts.show || 'all';
    const missing = (awards || []).filter((a) => !a.owned);
    const inGroup = missing.filter((a) => show === 'all' || groupOf(a) === show);
    const q = String(opts.q || '').trim().toLowerCase();
    const kind = opts.kind && opts.kind !== 'all' ? opts.kind : '';
    const narrowing = !!(kind || opts.type || q);
    const picked = inGroup.filter((a) => (!kind || a.kind === kind) && (!opts.type || a.type === opts.type));
    let rows = annotate(picked, fmt, now);
    if (q) rows = rows.filter((r) => `${r.name} ${r.description} ${r.g.how[0]} ${r.g.how[1]}`.toLowerCase().includes(q));
    if (q) rows = annotate(rows, fmt, now); // the lowest match of a series is "next" again
    const hidden = opts.tiers ? 0 : rows.filter((r) => r.higher).length;
    if (!opts.tiers) rows = rows.filter((r) => !r.higher);
    rows.sort(compare);
    let empty = null, narrowed = false;
    if (!rows.length) {
      if (inGroup.length && narrowing) { empty = EMPTY.filtered; narrowed = true; }
      else empty = show === 'all' ? EMPTY.all : EMPTY[show];
    }
    return { rows, hidden, empty, narrowed };
  }

  // The Easy wins card: closest counters, what comes by itself soon, one-time awards most players have
  function easyWins(awards, fmt, now = Date.now()) {
    const rows = annotate(awards || [], fmt, now).filter((r) => !r.higher);
    return {
      count: rows.filter((r) => r.g.group === 'count' && r.pct > 0).sort(byPct).slice(0, EASY_MAX.count),
      time: rows.filter((r) => r.g.group === 'time' && r.g.days != null && r.g.days <= SOON_DAYS)
        .sort((a, b) => a.g.days - b.g.days || byPct(a, b)).slice(0, EASY_MAX.time),
      once: rows.filter((r) => r.g.group === 'once' && !r.g.secret).sort(byHolders).slice(0, EASY_MAX.once),
    };
  }
  // Next-tier counted awards at 75 % or more
  const almostDone = (awards) => annotate(awards || [], { num: String, money: String }, Date.now())
    .filter((r) => !r.higher && r.g.group === 'count' && r.pct >= ALMOST).length;

  return Object.freeze({ GROUPS, GROUP_LABEL, EMPTY, EASY_EMPTY, ALMOST, SOON_DAYS, DESC_TR, guide, seriesKey, view, easyWins, almostDone,
    typeLabel, rarityLabel, trDative });
});
