/* =========================================================
   LRX yıllık etkinlikler (tools.js'ten sonra yüklenir)
   - Easter Egg Hunt, Trick or Treat, Christmas Town: tarihler her yıl Torn takviminden (API) gelir,
     oyuncunun kişisel başlangıç saati (user/calendar) hesaba katılır. Sabit tarih yok.
   - Etkinlik günlerinde: Torn sayfa yardımcıları kendiliğinden açılır (electron-main), Genel Bakış'ta
     kısa uyarı, Araçlar'da rehber (ne alınır / ne yapılır), istenirse masaüstü bildirimi.
   Torn kuralları: veriler yalnızca Torn API'den; hiçbir şey kullanıcı yerine tıklanmaz ya da satın alınmaz.
   ========================================================= */

(() => { // events.js kapsamı: adlar diğer dosyalarla çakışmasın
const SEASONAL_INFO = {
  easter: { icon: '🥚', name: 'Easter Egg Hunt', helper: 'torn.eggFinder',
    what: ['Yumurta bulucu (bütün Torn sayfaları) · rehber', 'Egg finder (every Torn page) · guide'] },
  halloween: { icon: '🎃', name: 'Trick or Treat', helper: 'torn.halloweenHelper',
    what: ["Sepetler satışa çıkınca (bir gün önce 12:00 TCT) Sweet Shop işareti · ayrıntılı rehber, yükseltme sırası ve sepet takibi", 'From basket sale time (12:00 TCT the day before): Sweet Shop marker · detailed guide, upgrade order and basket tracking'] },
  christmas: { icon: '🎄', name: 'Christmas Town', helper: 'torn.ctHelper',
    what: ['Christmas Town yardımcısı ve sandık çözücü · rehber', 'Christmas Town helper and chest solver · guide'] },
};
// Trick or Treat sepet seviyeleri: [ad, gereken toplam şeker, temel şans %] (topluluk rehberleri)
const HW_BASKETS = [['Spooky', 0, 35], ['Creepy', 5, 40], ['Freaky', 15, 45], ['Frightful', 40, 50], ['Haunting', 90, 55],
  ['Shocking', 190, 60], ['Terrifying', 440, 65], ['Horrifying', 940, 70], ['Petrifying', 1940, 75], ['Nightmarish', 4440, 80]];
const T_URL = 'https://www.torn.com/';

const evData = { d: null, err: null, at: 0, busy: null, timer: null };
async function fetchEvents(force = false) {
  if (!force && evData.d && Date.now() - evData.at < 5 * 60_000) return evData.d;
  if (evData.busy) return evData.busy;
  evData.busy = api('/api/events' + (force ? '?force=1' : ''))
    .then((d) => { evData.d = d; evData.err = null; evData.at = Date.now(); onEventsData(); return d; },
      (e) => { evData.err = e; throw e; })
    .finally(() => { evData.busy = null; });
  return evData.busy;
}
const nowSec = () => Math.floor(Date.now() / 1000);
const seasonal = () => evData.d?.seasonal || [];
// "02 Nis 16:00" (Torn saati = UTC)
const tct = (ts) => new Date(ts * 1000).toLocaleString(state.lang === 'en' ? 'en-GB' : 'tr-TR', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const localTime = (ts) => new Date(ts * 1000).toLocaleString(state.lang === 'en' ? 'en-GB' : 'tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const span = (sec) => {
  const s = Math.max(0, sec); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600);
  return d ? `${d}${tr('g', 'd')} ${h}${tr('s', 'h')}` : `${h}${tr('s', 'h')} ${Math.floor((s % 3600) / 60)}${tr('dk', 'm')}`;
};
function windowText(s) {
  if (!s.start) return '';
  return `<span class="mono" title="${tr('Senin saatinle', 'Your local time')}: ${esc(localTime(s.start))} → ${esc(localTime(s.end))}">${esc(tct(s.start))} → ${esc(tct(s.end))} TCT</span>${s.exact ? '' : ` <span class="muted">(${tr('olası en geniş aralık', 'widest possible range')})</span>`}`;
}
function statusChip(s) {
  const n = nowSec();
  if (s.status === 'active') return `<span class="chip green">● ${tr('şimdi', 'now')} · ${tr('bitişe', 'ends in')} ${span(s.end - n)}</span>`;
  if (s.status === 'upcoming') return `<span class="chip ${s.start - n < 2 * 86400 ? 'warn' : 'blue'}">${tr('başlamasına', 'starts in')} ${span(s.start - n)}</span>`;
  if (s.status === 'past') return `<span class="chip dim">${tr('bu yıl bitti', 'over for this year')}</span>`;
  return `<span class="chip dim">${tr('takvimde yok', 'not on the calendar')}</span>`;
}

/* ---------- Rehberler: ne alınır, ne yapılır ---------- */
const step = (icon, title, text, extra = '') => `<li class="eg-step"><span class="eg-ico">${icon}</span><div><b>${title}</b><div class="muted">${text}</div>${extra}</div></li>`;
const openBtn = (path, label, tab) => `<button class="btn sm ghost" data-open-url="${T_URL}${path}" data-tab-label="${esc(tab || label)}">${label} ↗</button>`;
const helperChip = (key) => (feat(key) ? `<span class="chip green">${tr('yardımcı açık', 'helper on')}</span>` : `<span class="chip dim">${tr('yardımcı kapalı', 'helper off')}</span>`);

function easterGuide(d) {
  const e = d?.easter;
  return {
    stats: e ? `<div class="grid kpis">${kpi(tr('Bu etkinlikte bulunan', 'Found this event'), n0(e.score))}${kpi(tr('Toplam', 'Total'), n0(e.total))}</div>` : '',
    buy: tr('Satın alman gereken bir şey yok.', 'There is nothing you need to buy.'),
    steps: [
      step('🔎', tr("Torn'u normal gez", 'Browse Torn as usual'), tr('Yumurtalar herhangi bir Torn sayfasında rastgele belirir; ne kadar çok sayfa açarsan o kadar çok şans.', 'Eggs appear at random on any Torn page; the more pages you open, the more chances.')),
      step('🥚', tr('Yumurta bulucu', 'Egg finder'), feat('torn.eggFinder')
        ? tr('Baktığın sayfada yumurta varsa ortada büyütülüp kırmızı çerçeveyle gösterilir ve uygulama haber verir. Tıklamak sana kalmış; LRX tıklamaz.', 'If the page you are viewing has an egg, it is shown enlarged in the middle with a red border and the app tells you. Clicking is up to you; LRX never clicks.')
        : tr('Kapalı. Ayarlar → Etkinlikler sekmesinden açabilirsin.', 'Off. Turn it on in Settings → Events.')),
      step('🚫', tr('Sahte yumurtalar', 'Fake eggs'), tr('Sayfada görünmeyen sahte yumurtalar gösterilmez.', 'Hidden fake eggs on the page are not shown.')),
      step('🎒', tr('Topladıkların', 'What you collect'), tr('Bulduğun yumurtalar envanterine (Items) eklenir; kullanabilir ya da satabilirsin.', 'Eggs you find go to your inventory (Items); you can use or sell them.'), openBtn('item.php', tr('Eşyalar', 'Items'), 'Items')),
    ],
  };
}

// Trick or Treat rehberi verisi: IceBlueFire'ın "Halloween Trick or Treat Guide" konusu ve
// Andyman'ın yükseltme sırası (Torn forumları). Canlı bedel / açıklama / sahiplik Torn API'den gelir.
const HW_SHOP = 'shops.php?step=candy';
const HW_TIER_UNLOCK = { 1: 0, 2: 40, 3: 190, 4: 940 }; // Frightful, Shocking, Horrifying
const HW_TIER_NAME = { 1: '', 2: 'Frightful', 3: 'Shocking', 4: 'Horrifying' };
// [ad, bedel, katman, TR etkisi, EN etkisi]
const HW_ORDER = [
  ['I See Dead People', 3, 1, 'Spooky kıyafetle saldırınca +%10 şeker şansı', '+10% treat chance while wearing spooky clothing'],
  ["Here's Johnny", 5, 1, 'Son vuruşu spooky silahla yaparsan +%10 şans', '+10% chance when you finish with a spooky weapon'],
  ['Doubler', 25, 1, '%20 ihtimalle şeker ×2', '20% chance to double treats'],
  ['Tripler', 50, 1, '%10 ihtimalle ×3', '10% chance to triple treats'],
  ['Quadrupler', 75, 1, '%5 ihtimalle ×4', '5% chance to quadruple treats'],
  ['Cat in Hell', 13, 3, 'Her saldırıda 1/500.000 ihtimalle 1.000 şeker', '1 in 500,000 chance per attack for 1,000 treats'],
  ['Quintupler', 100, 1, '%1 ihtimalle ×5', '1% chance to quintuple treats'],
  ['Shadow of Doubt', 1000, 4, 'Anında 1.100 şeker; sepet ilerlemesine sayılır. 7 → 8 arası yaklaşık bütün bir etkinlik saldırısı ister', 'Gives 1,100 treats at once, counting toward basket progress. 7 → 8 takes about a whole event of attacking'],
  ['Multipack', 180, 4, 'Takasta tüketimlik eşyaların bir kısmı multipack olur', 'Some consumables become multipacks on exchange'],
  ['Deal with the Devil', 320, 4, 'Takasta %3 ihtimalle booster / özel eşya (Erotic DVD, Feathery Hotel Coupon, Business Class, Casino Pass)', '3% chance of boosters / special items on exchange (Erotic DVD, Feathery Hotel Coupon, Business Class, Casino Pass)'],
  ['Dark Power', 285, 3, 'Takas edilen her şeker için +5 enerji (en çok 1.000)', '+5 energy per treat exchanged (up to 1,000)'],
  ['Freebie', 120, 3, 'Her 10 şekere 1 bedava', 'One free treat for every 10 exchanged'],
  ['Bloody Mary', 15, 2, 'Orta seviye alkol (Bottle of Wicked Witch)', 'Medium alcohol (Bottle of Wicked Witch)'],
  ['Nice Chianti', 30, 2, 'Yüksek seviye alkol (Bottle of Stinky Swamp Punch)', 'High alcohol (Bottle of Stinky Swamp Punch)'],
  ['Nightcrawler', 45, 2, 'Orta enerji içeceği (Can of Munster)', 'Medium energy drink (Can of Munster)'],
  ["It's Alive", 90, 2, 'Yüksek enerji içeceği (Can of Red Cow)', 'High energy drink (Can of Red Cow)'],
  ['Cashback', 230, 3, 'Takastan sonra şekerlerin %10\'u geri', '10% of treats back after an exchange'],
  ['Candyman', 5, 2, 'Orta seviye şeker (Bag of Bloody Eyeballs)', 'Medium candy (Bag of Bloody Eyeballs)'],
  ['Sweet Release', 10, 2, 'Yüksek seviye şeker (Bag of Chocolate Truffles)', 'High candy (Bag of Chocolate Truffles)'],
  ['Cold Sweat', 170, 3, 'Takas edilen her şeker için +1 nerve (suçlar için)', '+1 nerve per treat exchanged (for crimes)'],
];
const HW_NEVER = [
  ['Save Your Tears', 95, 3, 'Takasta şeker başına +500 mutluluk', '+500 happiness per treat exchanged'],
  ['Mortal Coil', 500, 4, 'Etkinlikte saatte 1 bedava şeker; yılda 168 şeker, kârı 3. yılda çıkar (isteğe bağlı)', '1 free treat per hour during the event; 168 a year, breaks even in year 3 (optional)'],
  ['Inflation', 777, 4, 'Etkinlikte sepetteki şekerler saatte %0,1 artar', 'Treats in the basket grow 0.1% per hour during the event'],
  ['Summon Cthulhu', 9999, 4, "M'aol'u çağırır (ileri seviye, aşağıya bak)", "Summons M'aol (advanced, see below)"],
];
const HW_CLOTHES = ['Kabuki Mask', 'Medieval Helmet', "Witch's Hat", 'Straitjacket', 'Marauder Face Mask', "Duke's Gimp Mask", 'Psycho Clown Mask', 'Nun Mask', 'Hook Hand', 'Torso Bandage', 'Head Bandage', 'Bloody Apron', 'Devil Horns'];
const HW_WEAPONS = ['Axe', 'Blood Spattered Sickle', 'Chainsaw', "Devil's Pitchfork", 'Golden Broomstick', 'Petrified Humerus', 'Wand of Destruction', 'Meat Hook', 'Cleaver', 'Bone Saw'];
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

function halloweenGuide(d, s) {
  const h = d?.halloween;
  const has = h?.hasBasket;
  const total = h?.treats?.total;
  const cur = h?.treats?.current;
  const prep = s?.stage === 'prep';
  const tierIdx = total == null ? -1 : HW_BASKETS.reduce((i, b, k) => (total >= b[1] ? k : i), 0);
  const nextTier = tierIdx >= 0 ? HW_BASKETS[tierIdx + 1] : null;
  // API'deki yükseltmeleri ada göre eşle (sahiplik ve canlı bedel)
  const api = new Map((h?.upgrades || []).map((u) => [normName(u.name), u]));
  const owned = (name) => !!api.get(normName(name))?.owned;
  const costOf = (name, def) => api.get(normName(name))?.cost ?? def;
  const L = state.lang === 'en' ? 1 : 0;
  const nextIdx = h ? HW_ORDER.findIndex(([n]) => !owned(n)) : -1;
  const tierName = h?.basket ? String(h.basket).replace(/^halloween basket\s*:\s*/i, '') : '';

  // 1) Sepet: herkesi doğrudan Sweet Shop'a yönlendir
  const shopBtn = `<button class="btn primary sm" data-open-url="${T_URL}${HW_SHOP}" data-tab-label="Sweet Shop">🍬 ${tr("Sweet Shop'a git", 'Go to the Sweet Shop')} ↗</button>`;
  const cta = has === true
    ? `<div class="eg-cta ok"><div><b>✓ ${tr('Sepetin var', 'You have a basket')}${tierName ? `: ${esc(tierName)}` : ''}</b>
        <div class="muted">${tr('Saldırı kazandıkça şeker topla; ikinci sepet gerekmez.', 'Collect treats by winning attacks; you do not need a second basket.')}</div></div></div>`
    : `<div class="eg-cta"><div><b>🧺 ${tr('1. adım: Halloween Basket al', 'Step 1: buy a Halloween Basket')}${has === false ? ` <span class="chip danger">${tr('sepetin yok', 'no basket yet')}</span>` : ''}</b>
        <div class="muted">${prep
          ? tr('Sepetler satışta, etkinlik başlamadan al. ', 'Baskets are on sale; get one before the event starts. ')
          : ''}${tr("Sepet olmadan saldırılardan şeker düşmez. Sally's Sweet Shop'ta $35; seviye 5 gerekir.", "Attacks drop no treats without a basket. $35 in Sally's Sweet Shop; requires level 5.")}</div></div>${shopBtn}</div>`;

  const order = HW_ORDER.map(([n, c, tier, te, ee], i) => {
    const o = owned(n); const cost = costOf(n, c);
    const locked = !o && total != null && total < HW_TIER_UNLOCK[tier];
    const st = o ? `<span class="chip green">✓</span>`
      : locked ? `<span class="chip dim" title="${tr('Açılması için sepet', 'Unlocks at basket')}: ${HW_TIER_NAME[tier]}">🔒 ${HW_TIER_NAME[tier]}</span>`
      : cur != null && cur >= cost ? `<span class="chip tq">${tr('alınabilir', 'affordable')}</span>` : '';
    return `<tr class="${i === nextIdx ? 'hw-next' : ''} ${o ? 'hw-own' : ''}"><td class="num"><b>${i + 1}</b></td><td><b>${esc(n)}</b>${i === nextIdx ? ` <span class="chip warn">${tr('sıradaki', 'next')}</span>` : ''}<div class="muted aw-desc">${esc(L ? ee : te)}</div></td>
      <td class="num">${n0(cost)}</td><td class="muted">${['I', 'II', 'III', 'IV'][tier - 1]}</td><td>${st}</td></tr>`;
  }).join('');
  const never = HW_NEVER.map(([n, c, tier, te, ee]) => `<li><b>${esc(n)}</b> <span class="muted">(${n0(costOf(n, c))} · ${['I', 'II', 'III', 'IV'][tier - 1]}) — ${esc(L ? ee : te)}</span></li>`).join('');
  const nextLine = nextIdx >= 0
    ? (() => { const [n, c] = HW_ORDER[nextIdx]; const cost = costOf(n, c); const need = cur != null ? Math.max(0, cost - cur) : null;
      return `<p class="eg-next">➡️ ${tr('Sıradaki yükseltme', 'Next upgrade')}: <b>#${nextIdx + 1} ${esc(n)}</b> (${n0(cost)} ${tr('şeker', 'treats')})${need != null ? ` · ${need ? `${n0(need)} ${tr('şeker daha lazım', 'more treats needed')}` : tr('şimdi alabilirsin', 'you can buy it now')}` : ''}</p>`; })()
    : (h ? `<p class="eg-next">🏁 ${tr('Önerilen 20 yükseltmenin hepsi tamam. Artık şekerleri takas edebilirsin.', 'All 20 recommended upgrades are done. You can now exchange treats.')}</p>` : '');
  const tiers = HW_BASKETS.map(([n, need, pct], k) => `<span class="eg-tier ${k === tierIdx ? 'cur' : ''}" title="${n0(need)} ${tr('toplam şeker', 'total treats')}">${n} ${pct}%</span>`).join('');

  return {
    stats: h ? `<div class="grid kpis">
        ${kpi(tr('Sepet', 'Basket'), has === true ? esc(tierName || '✓') : has === false ? tr('yok', 'none') : '—')}
        ${kpi(tr('Elindeki şeker', 'Treats now'), cur != null ? n0(cur) : '—')}
        ${kpi(tr('Toplam toplanan', 'Total collected'), total != null ? n0(total) : '—', nextTier ? `${tr('sonraki', 'next')}: ${nextTier[0]} · ${n0(nextTier[1] - total)} ${tr('şeker', 'treats')}` : '')}
        ${kpi(tr('Yükseltmeler', 'Upgrades'), `${n0((h.upgrades || []).filter((u) => u.owned).length)} <small class="muted">/ ${n0((h.upgrades || []).length)}</small>`)}
      </div>` : '',
    cta,
    buy: tr('Alınacaklar: <b>Halloween Basket</b> (zorunlu, $35) · bol <b>enerji</b> · isteğe bağlı <b>spooky kıyafet</b> ve <b>spooky silah</b>.', 'Shopping list: <b>Halloween Basket</b> (required, $35) · plenty of <b>energy</b> · optional <b>spooky clothing</b> and a <b>spooky weapon</b>.'),
    steps: [
      step('🧺', tr('Sepeti doğru zamanda al', 'Buy the basket at the right time'),
        tr("Sepetler etkinlikten bir gün önce 12:00 TCT'de satışa çıkar. Tükenirse her 15 dakikada 1.000 adet yenilenir: bekleyip sayfayı yenile. Günlük 100 eşyalık şehir alışveriş limitini doldurmuş olsan bile sepeti alabilirsin; önce sepeti alırsan o gün 99 eşya daha alabilirsin. Bu yüzden önce günlük limitini kullan, sonra sepeti al.",
          'Baskets go on sale at 12:00 TCT the day before the event. If they sell out, 1,000 restock every 15 minutes: wait and refresh. You can still buy one after using your 100-item daily city limit, but buying the basket first leaves only 99 other items that day. So use your daily limit first, then buy the basket.'),
        `<div class="eg-btns">${shopBtn}</div><div class="muted eg-small">${tr("Satın alamıyorsan zaten bir sepetin vardır: envanterde ya da Display Cabinet'te ara.", 'If you cannot buy one, you already own a basket: check your inventory or Display Cabinet.')}</div>`),
      step('⚔️', tr('Saldır, şeker topla', 'Attack to collect treats'),
        tr("Şeker yalnızca senin başlattığın saldırılardan düşer (savunma vermez); herhangi bir oyuncuya saldırabilirsin. Yurt dışında da çalışır; sepet Torn'da kalsa bile şeker gelir. Etkinlik süresince enerji = şeker: Xanax, FHC, enerji içeceği ve günlük enerji yenilemesini buna ayır, etkinlikten önce enerji biriktir.",
          'Treats only drop from attacks you start (not from defends); any player works. It also works abroad; you still collect even though the basket stays in Torn. During the event energy = treats: save Xanax, FHCs, energy drinks and your daily refill for it, and stack energy before the event.'),
        `<div class="eg-btns">${openBtn('page.php?sid=ItemMarket', 'Item Market')}</div>`),
      step('🎭', tr('Spooky kıyafet ve silah', 'Spooky clothing and weapon'),
        tr(`"I See Dead People" alındıktan sonra spooky kıyafetle +%10, "Here's Johnny" alındıktan sonra son vuruşu spooky silahla yaparsan +%10 şans. Bu yükseltmeler olmadan bonus yok. Etkinlik başlayınca eşya açıklamasında "Spooky: Yes" yazar.`,
          `After "I See Dead People", spooky clothing gives +10%; after "Here's Johnny", finishing with a spooky weapon gives +10%. No bonus without these upgrades. Once the event starts, item descriptions show "Spooky: Yes".`),
        `<div class="eg-chips"><span class="muted">${tr('Kıyafet', 'Clothing')}:</span> ${HW_CLOTHES.map((x) => `<span class="eg-tag">${esc(x)}</span>`).join('')}</div>
         <div class="eg-chips"><span class="muted">${tr('Silah', 'Weapon')}:</span> ${HW_WEAPONS.map((x) => `<span class="eg-tag">${esc(x)}</span>`).join('')}</div>
         <div class="eg-btns"><button class="btn sm ghost" data-open-url="https://wiki.torn.com/wiki/Scary_Clothing" data-tab-label="Wiki">${tr('Bütün kıyafetler (Wiki)', 'All clothing (Wiki)')} ↗</button><button class="btn sm ghost" data-open-url="https://wiki.torn.com/wiki/Scary_Weapon" data-tab-label="Wiki">${tr('Bütün silahlar (Wiki)', 'All weapons (Wiki)')} ↗</button></div>`),
      step('📈', tr('Sepet kendiliğinden büyür', 'The basket levels up by itself'),
        tr('Toplam topladığın şeker (harcanmış ya da harcanmamış) arttıkça sepet bir üst seviyeye geçer; seviye atlamak şeker harcamaz. Seviye atlama ancak bir saldırıdan şeker kazandığında olur. Her seviye temel şansı %5 artırır.',
          'Your basket levels up as your total treats (spent or not) grow; levelling costs nothing. It only levels up when you earn a treat from an attack. Each level adds 5% base chance.'),
        `<div class="eg-tiers">${tiers}</div>`),
      step('⬆️', tr('Yükseltmeleri sırayla al', 'Buy upgrades in order'),
        tr('Yükseltmeler şeker harcar. Items → Special Items → Halloween Basket → "Use Item" ile açılır. Aşağıdaki 1–20 sırasını izle; kilitli katmanlar sepet seviyesiyle açılır (II: Frightful, III: Shocking, IV: Horrifying). Yükseltmeler yeni sepete ve sonraki yıla taşınır.',
          'Upgrades cost treats. Open them via Items → Special Items → Halloween Basket → "Use Item". Follow the 1–20 order below; locked tiers open with basket level (II: Frightful, III: Shocking, IV: Horrifying). Upgrades carry over to new baskets and the next year.'),
        `<div class="eg-btns">${openBtn('item.php', tr('Eşyalar', 'Items'), 'Items')}</div>`),
      step('🔄', tr('Şekerleri en son takas et', 'Exchange treats last'),
        tr('"Exchange All Treats" elindeki bütün şekerleri şeker, alkol ve enerji içeceğine çevirir. Bunu yükseltmeleri bitirdikten sonra yap; 10\'un katlarıyla, en iyisi 100\'er 100\'er (Freebie bonusu, enerji taşmaz). Şekerler sonraki yıla taşınır: yükseltmeye devam edeceksen yıl sonunda takas etme.',
          '"Exchange All Treats" turns all your treats into candy, alcohol and energy drinks. Do it after finishing upgrades; in multiples of 10, ideally 100 at a time (Freebie bonus, no energy overflow). Treats carry over to next year: if you will keep upgrading, do not exchange at year end.')),
    ],
    extra: `${nextLine}
      <div class="tbl-wrap"><table class="tbl compact hw-order">
        <thead><tr><th class="num">#</th><th>${tr('Önerilen yükseltme sırası', 'Recommended upgrade order')}</th><th class="num">${tr('Bedel', 'Cost')}</th><th>${tr('Katman', 'Tier')}</th><th></th></tr></thead>
        <tbody>${order}</tbody></table></div>
      <details class="eg-more"><summary>🚫 ${tr('Önerilmeyenler ("Never")', 'Not recommended ("Never")')}</summary><ul class="eg-list">${never}</ul></details>
      <details class="eg-more"><summary>🏅 ${tr('Honor\'lar', 'Honors')}</summary><ul class="eg-list">
        <li><b>Phantastic</b> <span class="muted">— ${tr('sepeti Frightful yap', 'upgrade your basket to Frightful')}</span></li>
        <li><b>Something Humerus</b> <span class="muted">— ${tr('sepeti Terrifying yap', 'upgrade your basket to Terrifying')}</span></li>
        <li><b>Oh My Gourd!</b> <span class="muted">— ${tr('sepeti Nightmarish yap', 'upgrade your basket to Nightmarish')}</span></li></ul></details>
      <details class="eg-more"><summary>👹 ${tr("İleri seviye: M'aol", "Advanced: M'aol")}</summary><ul class="eg-list">
        <li>${tr("Sepette 9.999 şekerle \"Summon Cthulhu\" M'aol'u çağırır. Etkinliğin ilk 24 saatinde çağrılamaz; yenildikten sonra 48 saat yeniden çağrılamaz.", "\"Summon Cthulhu\" with 9,999 treats in the basket summons M'aol. Not possible in the first 24 hours of the event, and not again within 48 hours of his defeat.")}</li>
        <li>${tr("M'aol ve 5 muhafızı (Praetorian) rastgele ülkelerde belirir; \"Astral Guard\" yüzünden yalnızca Crystalline Falcata ile ya da biri Stygian Darkness attıktan sonraki 20 saniyede hasar alırlar.", 'M\'aol and his 5 Praetorians appear in random countries; because of "Astral Guard" they only take damage from a Crystalline Falcata or within 20 seconds after someone throws a Stygian Darkness.')}</li>
        <li>${tr('Uyarı: Stygian Darkness normal saldırıda yanlışlıkla kullanılabilir ve geri gelmez (yalnızca 5 tane). Saldırı ayarlarında geçici eşyaları kapat.', 'Warning: Stygian Darkness can be used by accident in normal attacks and is not refunded (only 5 ever). Turn off temporary items in your attack settings.')}</li>
        <li>${tr('Yenilen muhafızlar relic ve Arca Fortunae (şeker) düşürür; relic\'ler bir yıl çalışır.', 'Defeated Praetorians drop relics and Arca Fortunae (treats); relics work for one year.')}</li></ul></details>`,
    source: tr("Kaynak: IceBlueFire'ın \"Halloween Trick or Treat Guide\" konusu ve Andyman'ın yükseltme sırası (Torn forumları). Bedeller ve sahip olduğun yükseltmeler Torn API'den canlı gelir.", 'Source: IceBlueFire\'s "Halloween Trick or Treat Guide" thread and Andyman\'s upgrade order (Torn forums). Costs and your owned upgrades come live from the Torn API.'),
  };
}

function christmasGuide() {
  return {
    stats: '',
    buy: tr('Zorunlu bir alışveriş yok: giriş ücretsiz, haritada yürümek enerji ya da nerve harcamaz.', 'Nothing to buy: entry is free and walking the map costs no energy or nerve.'),
    steps: [
      step('🎄', tr("Christmas Town'a gir", 'Enter Christmas Town'), tr('Etkinlik boyunca haritalarda dolaş; farklı haritalar farklı ödüller saklar.', 'Walk the maps during the event; different maps hide different rewards.'), openBtn('christmas_town.php', 'Christmas Town')),
      step('🎁', tr('Hediye ve eşyalar', 'Gifts and items'), feat('torn.ctHelper')
        ? tr('Üstüne geldiğin eşyayı toplarsın. LRX haritadaki hediye, sandık ve anahtarları renkle işaretler ve yakındakileri listeler.', 'You pick up what you step on. LRX colors gifts, chests and keys on the map and lists the nearby ones.')
        : tr('Üstüne geldiğin eşyayı toplarsın. CT yardımcısı kapalı; Ayarlar → Etkinlikler sekmesinden açabilirsin.', 'You pick up what you step on. The CT helper is off; turn it on in Settings → Events.')),
      step('🗝️', tr('Anahtar ve sandıklar', 'Keys and chests'), tr('Haritada bulduğun anahtarlar sandıkları açar (bronz, gümüş, altın). Kombinasyon sandığında LRX çözücüsü sıradaki en iyi tahmini önerir; kodu sen girersin.', 'Keys you find on the map open chests (bronze, silver, gold). On a combination chest the LRX solver suggests the best next guess; you enter the code.')),
    ],
  };
}
const GUIDES = { easter: easterGuide, halloween: halloweenGuide, christmas: christmasGuide };

function eventGuideCard(s) {
  const info = SEASONAL_INFO[s.id]; const g = GUIDES[s.id](evData.d, s);
  return `<article class="glass card eg-card eg-${s.id}">
    <div class="card-head wrap"><h3>${info.icon} ${esc(info.name)} · ${tr('rehber', 'guide')}</h3>
      <div class="eg-head-r">${statusChip(s)} ${helperChip(info.helper)}</div></div>
    <div class="muted eg-when">${windowText(s)}</div>
    ${g.stats}
    ${g.cta || ''}
    <p class="eg-buy">🛒 ${g.buy}</p>
    <ol class="eg-steps">${g.steps.join('')}</ol>
    ${g.extra || ''}
    ${g.table || ''}
    <p class="muted sl-note">${g.source ? `${g.source} ` : `${tr('Topluluk rehberlerinden derlendi.', 'Compiled from community guides.')} `}${tr('Torn kuralları her yıl değiştirebilir. LRX yalnızca gösterir: tıklamaz, satın almaz.', 'Torn may change the rules each year. LRX only shows: it never clicks or buys.')}</p>
  </article>`;
}
// Araçlar sayfası: aktif ya da 7 gün içinde başlayacak etkinliklerin rehberleri
function eventGuideCards() {
  if (!feat('event.guide')) return '';
  const n = nowSec();
  const rank = (s) => (s.stage === 'live' ? 0 : s.stage === 'prep' ? 1 : 2);
  return seasonal().filter((s) => s.status === 'active' || (s.status === 'upcoming' && s.start - n < 7 * 86400))
    .sort((x, y) => rank(x) - rank(y)).map(eventGuideCard).join('');
}

/* ---------- Ayarlar → Etkinlikler ---------- */
function renderEventSettings() {
  const el = $('#set-events'); if (!el) return;
  const d = evData.d;
  const rows = Object.entries(SEASONAL_INFO).map(([id, info]) => {
    const s = seasonal().find((x) => x.id === id) || { id, status: 'unknown' };
    const f = FEATURE_DEF_MAP[info.helper];
    return `<div class="evs-row ${s.status === 'active' ? 'live' : ''}">
      <div class="evs-ico">${info.icon}</div>
      <div class="evs-main"><div class="evs-title"><b>${esc(info.name)}</b> ${statusChip(s)}</div>
        <div class="muted">${s.start ? windowText(s) : tr('Torn takviminde bu yıl için tarih yok; yayınlanınca kendiliğinden eklenir.', 'No date on the Torn calendar yet; it is added automatically once published.')}</div>
        ${s.status === 'past' ? `<div class="muted">${tr('Gelecek yılın tarihi Torn takvimi yayınlayınca kendiliğinden gelir.', "Next year's date arrives automatically once Torn publishes the calendar.")}</div>` : ''}
        <div class="evs-what"><small>${tr('Etkinlik günlerinde açılır', 'Turns on during the event')}: ${esc(info.what[state.lang === 'en' ? 1 : 0])}</small></div></div>
      ${f ? featRow(f) : ''}
    </div>`;
  }).join('');
  const notifyOn = feat('notify');
  el.innerHTML = `<article class="glass card">
      <div class="card-head wrap"><h3>🎉 ${tr('Yıllık etkinlikler', 'Yearly events')}</h3>
        <div class="eg-head-r">${d?.startTime ? `<span class="chip dim" title="${tr("Torn'da seçtiğin kişisel başlangıç saati", 'The personal start time you picked in Torn')}">${tr('Başlangıç saatin', 'Your start time')}: ${esc(d.startTime)}</span>` : ''}
          <button class="btn sm ghost" id="evs-refresh" type="button">↻ ${tr('Takvimi yenile', 'Refresh calendar')}</button></div></div>
      ${d ? `<div class="evs-list">${rows}</div>` : evData.err ? errorBox(evData.err) : loadingBox()}
      <p class="muted sl-note">${tr('Tarihler sabit değil: her yıl Torn takviminden (API) okunur ve senin kişisel başlangıç saatine göre hesaplanır. Yardımcılar yalnızca etkinlik penceresinde çalışır; ayar kapalıysa o günlerde de çalışmaz.', 'Dates are not fixed: they are read from the Torn calendar (API) every year and adjusted to your personal start time. Helpers run only inside the event window; if a switch is off they stay off on those days too.')}</p>
    </article>
    <article class="glass card"><div class="card-head"><h3>${tr('Rehber ve bildirim', 'Guide and notification')}</h3></div>
      <div class="feat-list">${featRow(FEATURE_DEF_MAP['event.guide'])}${featRow(FEATURE_DEF_MAP['notify.events'], !notifyOn)}</div>
      ${notifyOn ? '' : `<small class="muted">${tr('Masaüstü bildirimleri kapalı (Bildirimler sekmesi).', 'Desktop notifications are off (Notifications tab).')}</small>`}
    </article>`;
}
function loadEventSettings() { fetchEvents().catch(() => {}).finally(renderEventSettings); }

/* ---------- Genel Bakış uyarısı + bildirim ---------- */
function updateEventBanner() {
  if (typeof setAlert !== 'function') return;
  const n = nowSec();
  const hw = evData.d?.halloween;
  const lines = [];
  for (const s of seasonal()) {
    const info = SEASONAL_INFO[s.id];
    const live = s.status === 'active';
    const prep = s.stage === 'prep';
    const soon = s.status === 'upcoming' && s.start - n < 86400;
    if (!live && !prep && !soon) continue;
    const when = live ? tr('başladı', 'is on') : `${tr('başlamasına', 'starts in')} ${span(s.start - n)}`;
    let tip = ''; let btn = '';
    if (s.id === 'easter') tip = feat('torn.eggFinder') ? tr('Yumurta bulucu açık: baktığın sayfada yumurta varsa ortada gösterilir.', 'Egg finder is on: if the page you view has an egg, it is shown in the middle.') : tr('Yumurta bulucu kapalı.', 'Egg finder is off.');
    else if (s.id === 'halloween') {
      if (hw?.hasBasket === true) tip = tr('Sepetin hazır; saldırı kazandıkça şeker topla, yükseltmeleri sırayla al.', 'Basket ready; win attacks for treats and buy upgrades in order.');
      else {
        tip = prep ? tr('Sepetler satışta! Etkinlik başlamadan Halloween Basket al ($35).', 'Baskets are on sale! Get a Halloween Basket ($35) before the event starts.')
          : tr('Şeker toplamak için önce Halloween Basket al ($35).', 'Buy a Halloween Basket ($35) first to collect treats.');
        btn = `<button class="btn sm primary" type="button" data-open-url="${T_URL}${HW_SHOP}" data-tab-label="Sweet Shop">🍬 Sweet Shop ↗</button>`;
      }
    } else tip = tr("Christmas Town'a gir; hediye ve sandıklar haritada işaretlenir.", 'Enter Christmas Town; gifts and chests are marked on the map.');
    lines.push(`<div class="ev-alert-row"><span>${info.icon} <b>${esc(info.name)}</b> ${when} · ${tip}</span><span class="ev-alert-btns">${btn}<button class="btn sm ghost" type="button" data-view-go="tools">${tr('Rehber', 'Guide')}</button></span></div>`);
  }
  if (!feat('event.guide') || !lines.length) { setAlert('event-guide', null); return; }
  setAlert('event-guide', `<div class="ev-alert">${lines.join('')}</div>`, 'info');
}
function notifyOnce(key, val, title, body, url) {
  let seen = null; try { seen = localStorage.getItem(key); } catch {}
  if (seen === String(val)) return;
  try { localStorage.setItem(key, String(val)); } catch {}
  notify(key, title, body, url ? { url } : {});
}
function notifyEventStarts() {
  if (!feat('notify') || !feat('notify.events')) return;
  const noBasket = evData.d?.halloween?.hasBasket !== true;
  for (const s of seasonal()) {
    const info = SEASONAL_INFO[s.id];
    const shop = s.id === 'halloween' && noBasket ? T_URL + HW_SHOP : null;
    if (s.stage === 'prep' && s.id === 'halloween' && noBasket) {
      notifyOnce(`lrx.evNote.${s.id}.prep`, s.start, `${info.icon} ${tr('Halloween sepetleri satışta', 'Halloween baskets are on sale')}`,
        tr(`Trick or Treat ${tct(s.start)} TCT'de başlıyor. Tıkla: Sweet Shop'ta Halloween Basket al ($35).`, `Trick or Treat starts ${tct(s.start)} TCT. Click: buy a Halloween Basket in the Sweet Shop ($35).`), shop);
    }
    if (s.status === 'active') {
      notifyOnce(`lrx.evNote.${s.id}`, s.start, `${info.icon} ${info.name} ${tr('başladı', 'has started')}`,
        shop ? tr("Sepetin yok: tıkla, Sweet Shop'ta Halloween Basket al ($35).", "No basket yet: click to buy a Halloween Basket in the Sweet Shop ($35).")
          : tr(`Bitiş: ${tct(s.end)} TCT · rehber Araçlar sayfasında`, `Ends ${tct(s.end)} TCT · guide on the Tools page`), shop);
    }
  }
}
// Bir sonraki başlangıç / bitiş anında veriyi tazele (yardımcılar ve uyarı tam zamanında değişsin)
function scheduleBoundary() {
  clearTimeout(evData.timer);
  const n = nowSec();
  const next = seasonal().flatMap((s) => [s.prepStart, s.start, s.end]).filter((t) => t && t > n).sort((a, b) => a - b)[0];
  if (next && next - n < 86400) evData.timer = setTimeout(() => fetchEvents(true).catch(() => {}), (next - n + 60) * 1000);
}
function onEventsData() {
  updateEventBanner();
  notifyEventStarts();
  scheduleBoundary();
  if (state.view === 'settings') renderEventSettings();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#evs-refresh')) { fetchEvents(true).catch((err) => toast(err.message)).finally(renderEventSettings); return; }
  const go = e.target.closest('#alert-area [data-view-go]');
  if (go) document.querySelector(`.nav-item[data-view="${go.dataset.viewGo}"]`)?.click();
});
// Açılışta ve 30 dakikada bir (sunucu takvimi 3 saatte bir, sepeti 5 dakikada bir yeniler)
const pollSeasonal = () => { if (state.config?.hasKey) fetchEvents().catch(() => {}); };
setTimeout(pollSeasonal, 4000);
setInterval(pollSeasonal, 30 * 60_000);
FEATURE_HOOKS.push(() => { updateEventBanner(); });
Object.assign(window, { renderEventSettings, loadEventSettings, fetchEvents, eventGuideCards });
})();
