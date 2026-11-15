(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXGuide = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  // The Beginner Guide (under level 15) and the Happy jump card (also on Tools from level 15). Texts are [tr, en] pairs;
  // the page picks one with tr(). Facts come from the Torn wiki and community guides, checked on 2026-11-14: confirmed
  // numbers are stated, numbers from a single source say "about", uncertain ones have no number.
  // LRX only shows information: every step is done by the player in Torn.
  const STACK_CAP = 1000; // energy can be stacked above the max with Xanax up to this
  const XANAX_HAPPY = 75; // the happy a Xanax adds on its own (not a boost)
  const TICK_SEC = 900;   // happy above the max drops back to the max at every quarter-hour tick (TCT)
  const EDU_URL = 'https://www.torn.com/page.php?sid=education';
  const CRIMES_URL = 'https://www.torn.com/page.php?sid=crimes';

  const LEAD = [
    "Torn bir maratondur: her gün düzenli enerji ve nerve harcamak, her şeyi bir günde yapmaya çalışmaktan çok daha hızlı ilerletir. İlk hedefin seviye 15: yurt dışı seyahat açılır. Hastaneye düşmek ya da hapse girmek oyunun doğal parçası.",
    'Torn is a marathon: spending energy and nerve steadily every day beats trying to do everything at once. Your first goal is level 15, which unlocks travel abroad. Landing in hospital or jail is part of the game.',
  ];
  const JUMP_NOTE = [
    'Her adımı Torn\'da sen yaparsın. LRX yalnızca bu listeyi gösterir; senin yerine eşya kullanmaz, antrenman yapmaz, satın almaz.',
    'You do every step yourself in Torn. LRX only shows this checklist; it never uses items, trains or buys anything for you.',
  ];

  const ROADMAP = [
    { id: 'day1', title: ['İlk gün', 'Day 1'], items: [
      ["Duke'un görevlerini (Missions) aç: başlangıçta mission kredisi veren üç kolay görev seni bekliyor.", "Open Duke's contracts (Missions): three easy tasks that pay mission credits are waiting for you."],
      ['Education şehir işine gir; İş Asistanı sana uygun işleri listeler.', 'Take the Education city job; the Job Assistant lists jobs that fit you.'],
      ["Eğitim sayfasından BIO1340'a başla; bundan sonra hep bir kursun açık olsun.", 'Start BIO1340 on the Education page and keep a course running from now on.'],
      ["Ucuz bir şeker ye, sonra enerjinin hepsini gym'de tek seferde harca.", 'Eat a cheap candy, then spend all your energy in the gym in one go.'],
      ["Nerve'ünü tek bir başlangıç suçuna harca: Search for Cash, Graffiti ya da Shoplifting.", 'Spend your nerve on one beginner crime: Search for Cash, Graffiti or Shoplifting.'],
      ["Üzerindeki nakdi $0'a yakın tut: mug edilirsen %5–10'unu kaybedersin.", 'Keep the cash you carry near $0: a mug takes 5–10% of it.'],
    ] },
    { id: 'week1', title: ['İlk hafta', 'First week'], items: [
      ["Aktif bir faction'a katıl: gym perk'leri, yardım ve soru sorabileceğin insanlar.", 'Join an active faction: gym perks, help and people to ask.'],
      ["Shack'ten çık: Estate Agent → Rental'dan daha iyi bir ev kirala (seviye atlarken en az Penthouse).", 'Move out of the Shack: rent a better home through Estate Agent → Rental (a Penthouse or better while levelling).'],
      ["Enerji ve nerve'ü asla dolu bekletme: dolu bar yenilenmeyi bırakır.", 'Never let energy or nerve sit full: a full bar stops refilling.'],
      ['New Player Protection ilk 14 gününü kapsar: daha eski oyuncular sana henüz saldıramaz. Bu süreyi büyümek için kullan.', 'New Player Protection covers your first 14 days: older players cannot attack you yet. Use that time to grow.'],
      ['Paran yetince ucuz bir happy jump dene: şeker ve Ecstasy.', 'Try a budget happy jump once you can afford it: candy and Ecstasy.'],
    ] },
    { id: 'to15', title: ["Seviye 15'e kadar", 'Until level 15'], items: [
      ["Dört stat da yaklaşık 300 olana kadar antrenman yap, sonra enerjini Baldr's Levelling Targets'a harca ve kazanınca LEAVE seç.", "Train until all four stats are about 300, then spend your energy on Baldr's Levelling Targets and choose LEAVE when you win."],
      ['Seviye kendiliğinden atlamaz: seviyenin yanında [Upgrade] linki çıkınca ona tıkla.', 'Levelling up is not automatic: when an [Upgrade] link appears next to your level, click it.'],
      ["Hep bir kurs açık tut ve Duke'un her gün gelen yeni görevini yap.", "Keep a course running and do Duke's new contract every day."],
      ["Xanax ve daha iyi bir ev için para biriktir. Seviye 15'te seyahat açılır; Seyahat Kârı sayfası ne getireceğini gösterir.", 'Save for Xanax and a better home. Travel opens at level 15, and the Travel Profit page shows what to bring back.'],
    ] },
  ];

  const SECTIONS = [
    { id: 'jump', icon: '🚀', title: ['Happy jump', 'Happy jump'],
      summary: [
        ["Happy jump'ta enerji biriktirir, happy'yi max'ın çok üstüne çıkarır, Ecstasy ile ikiye katlar ve bütün enerjiyi tek antrenmanda harcarsın. Statların düşükken gym kazancını en çok happy belirler, bu yüzden jump kazancı katlayabilir.", 'A happy jump stacks energy, lifts happy far above your max, doubles it with Ecstasy and spends all the energy in one train. While your stats are low, happy is the biggest factor in gym gains, so a jump can multiply them.'],
        ['Tam jump (4 Xanax, 5 Erotic DVD, 1 Ecstasy) market fiyatlarıyla on milyonlarca dolar tutar; fiyatlar değişir. Yeni oyuncular ucuz jump ile başlar: şeker ve Ecstasy.', 'A full jump (4 Xanax, 5 Erotic DVDs, 1 Ecstasy) costs tens of millions at market prices, which change. New players start with a budget jump: candy and Ecstasy.'],
        ["Zamanlama önemli: max'ın üstündeki happy her çeyrek saatte (:00, :15, :30, :45 TCT) max'a geri düşer.", 'Timing matters: happy above your max drops back to max at every quarter-hour tick (:00, :15, :30, :45 TCT).'],
      ],
      details: [
        { head: ['Tam jump adım adım', 'Full jump, step by step'], items: [
          ["0 enerjiyle başla. Drug cooldown her bittiğinde bir Xanax al (+250 enerji, 6–8 saat drug cooldown) ve antrenman yapma. Dört Xanax 1.000 enerji eder, biriktirme sınırı budur; yaklaşık 24–36 saat sürer.", 'Start with 0 energy. Take a Xanax (+250 energy, 6–8 h drug cooldown) each time the drug cooldown ends, and do not train. Four Xanax make 1,000 energy, the stacking cap; this takes about 24–36 hours.'],
          ["Son drug cooldown'un bitmesini bekle: o sürerken Ecstasy alınamaz.", 'Let the last drug cooldown run out: you cannot take Ecstasy while it runs.'],
          ["Booster cooldown'unun boş olduğundan, hastanede ya da hapiste olmadığından emin ol.", 'Check that your booster cooldown is empty and that you are not in hospital or jail.'],
          ['Çeyrek saat geçer geçmez en fazla 5 Erotic DVD kullan (her biri +2.500 happy, +6 saat booster cooldown). Booster cooldown 24 saatin altındayken bir tane daha kullanabildiğin için beşincisi de sığar.', 'Right after a quarter-hour tick, use up to 5 Erotic DVDs (+2,500 happy each, +6 h booster cooldown). You can use one while the booster cooldown is under 24 h, so the fifth still fits.'],
          ["Bir Ecstasy al: o anki happy'ni ikiye katlar.", 'Take one Ecstasy: it doubles your current happy.'],
          ["Bir sonraki çeyrekten önce bütün enerjini en iyi gym'inde tek seferde harca.", 'Train all your energy in one go in your best gym, before the next tick.'],
          ["İsteğe bağlı: günlük enerji refill'ini (30 point) kullan ve çeyrek dolmadan yeniden antrenman yap.", 'Optional: use the daily energy refill (30 points) and train again before the tick.'],
          ['Örnek: 4.500 max happy ile (4.500 + 12.500) × 2 = 34.000 happy, 1.000 enerjinin hepsi için.', 'Example: with 4,500 max happy, (4,500 + 12,500) × 2 = 34,000 happy for all 1,000 energy.'],
        ] },
        { head: ['Yeni oyuncu için ucuz jump', 'Budget jump for new players'], items: [
          ["Şekerler happy verir: Lollipop, Box of Chocolate Bars ve Bag of Bon Bons +25, Big Box of Chocolate Bars +35. Her biri 30 dk booster cooldown ekler; günde yaklaşık 48 tane, kabaca +1.200 happy eder. En ucuzu Sally's Sweet Shop'ta.", "Candy gives happy: Lollipop, Box of Chocolate Bars and Bag of Bon Bons +25 each, Big Box of Chocolate Bars +35. Each adds 30 min of booster cooldown, so about 48 fit in a day, roughly +1,200 happy. Sally's Sweet Shop sells them cheapest."],
          ['Adımlar: dolu ya da biriktirilmiş enerjiyle başla, çeyrek geçer geçmez şekerleri ye, Ecstasy al, sonra bir sonraki çeyrekten önce hepsini antrenmana harca.', 'Steps: start from a full or stacked energy bar, eat your candy right after a tick, take Ecstasy, then train everything before the next tick.'],
          ["Sadece Ecstasy ile yapılan jump bile tek büyük antrenman için happy'ni ikiye katlar.", 'Even an Ecstasy-only jump doubles your happy for one big train.'],
          ['Dünya Diyabet Günü (14 Kasım) civarında şekerler 3 kat happy verir.', 'Around World Diabetes Day (14 November) candy gives 3× happy.'],
        ] },
        { head: ['Riskler', 'Risks'], items: [
          ['Xanax overdose: bütün enerji, nerve ve happy\'ni kaybedersin ve yaklaşık üç buçuk gün hastanede kalırsın. Resmî bir oran yok ama olur.', 'Xanax overdose: you lose all energy, nerve and happy and spend about three and a half days in hospital. There is no official chance, but it happens.'],
          ['Ecstasy overdose: bütün enerjini ve happy\'ni, yani biriktirdiğin her şeyi kaybedersin.', 'Ecstasy overdose: you lose all energy and happy, the whole stack.'],
          ["Hastanede booster kullanılamaz ve antrenman yapılamaz; hapiste yalnızca Crims gym açıktır. Hazırlık sırasında hastaneye düşmek jump'ı bozar.", 'In hospital you cannot use boosters or train; in jail only the Crims gym works. Getting hospitalised during the setup ruins the jump.'],
          ['Xanax etkisi sürerken battle statların %35 düşer ve her Xanax bağımlılık ekler.', 'While Xanax is active your battle stats are 35% lower, and every Xanax adds addiction.'],
          ["Sık yapılan hatalar: çeyreği kaçırmak, Ecstasy'yi boosterlardan önce almak, drug cooldown bitmeden başlamak.", 'Common mistakes: missing the tick, taking Ecstasy before the boosters, or starting before the drug cooldown has ended.'],
          ['Oyuncuların aktardığına göre ileri seviye Sports Science Lab gym\'i ömür boyu yaklaşık 150 ya da daha az Xanax + Ecstasy ister; bunları boşa harcama.', 'Players report that the late Sports Science Lab gym needs about 150 or fewer Xanax and Ecstasy taken in your lifetime, so do not waste them.'],
        ] },
        { head: ['Ne zaman değer', 'When it is worth it'], items: [
          ['Statların düşükken gym kazancını en çok happy belirler, bu yüzden jump kazancı katlayabilir; çok yüksek statlarda etkisi çok daha azdır.', 'At low stats happy is the biggest factor in your gains, so a jump can multiply them; at very high stats it matters much less.'],
          ["Oyuncular genelde her stat kabaca 100k–400k olana kadar tam jump yapar, sonra normal antrenmana geçer.", 'Players usually do full jumps until each stat is roughly 100k–400k, then train normally.'],
          ["Seviye 15 altında en iyi değer ucuz Ecstasy ya da şeker jump'ıdır. eDVD'li jump'ı, gereken şeyleri satmadan karşılayabildiğin zamana sakla.", 'Under level 15 a cheap Ecstasy or candy jump is the best value. Save the eDVD jump for when you can afford it without selling what you need.'],
          ["Daha iyi bir ev max happy'ni yükseltir ve her jump onun üstüne kurulur.", 'A better home raises your max happy, and every jump builds on it.'],
        ] },
      ] },
    { id: 'energy', icon: '⚡', title: ["Enerji ve cooldown'lar", 'Energy and cooldowns'],
      summary: [
        ['Enerji her 15 dakikada 5 yenilenir, 100\'e kadar (donator\'larda 10 dakikada 5, 150\'ye kadar). Dolu bar yenilenmeyi bırakır; harca.', 'Energy refills 5 every 15 minutes up to 100 (donators: every 10 minutes up to 150). A full bar stops refilling, so spend it.'],
        ["Birbirinden ayrı üç cooldown var: drug (aynı anda tek uyuşturucu), booster (şeker, alkol, enerji içeceği, Erotic DVD; 24 saate kadar) ve medical (6 saate kadar).", 'There are three separate cooldowns: drug (one drug at a time), booster (candy, alcohol, energy drinks, Erotic DVDs; up to 24 h) and medical (up to 6 h).'],
      ],
      details: [
        { head: ['Enerji', 'Energy'], items: [
          ["Günlük refill: enerji refill'i ve nerve refill'i, her biri 30 point, günde bir kez. En iyisi jump sırasında ya da zaten antrenman yapacakken kullanmak.", 'Daily refills: an energy refill and a nerve refill, 30 points each, once a day. They are best used during a jump or when you would train anyway.'],
          ['Enerji içecekleri 5–30 enerji verir ve her biri 2 saat booster cooldown ekler.', 'Energy drinks give 5–30 energy each and add 2 h of booster cooldown.'],
          ["Xanax +250 enerji verir ve enerjiyi max'ın üstünde 1.000'e kadar biriktirmeni sağlar.", 'Xanax gives +250 energy and lets you stack energy above your max, up to 1,000.'],
        ] },
        { head: ["Cooldown'lar", 'Cooldowns'], items: [
          ['Drug cooldown: Xanax 6–8 saat, Ecstasy yaklaşık 3,5 saat. Bitene kadar başka uyuşturucu alamazsın.', 'Drug cooldown: Xanax 6–8 h, Ecstasy about 3.5 h. You cannot take another drug until it ends.'],
          ["Booster cooldown: şeker 30 dk, alkol 1 saat, enerji içeceği 2 saat, Erotic DVD 6 saat. 24 saatin altındayken bir booster daha kullanabilirsin, yani sonuncusu sınırı aşabilir. Faction'ın Voracity perk'i sınırı yükseltir.", 'Booster cooldown: candy 30 min, alcohol 1 h, energy drink 2 h, Erotic DVD 6 h. You can use a booster while it is under 24 h, so the last one may push it past. The faction Voracity perk raises the cap.'],
          ['Medical cooldown: 6 saate kadar; ilk yardım çantası gibi tıbbi eşyalar ekler.', 'Medical cooldown: up to 6 h; medical items such as first aid kits add to it.'],
        ] },
        { head: ['Bağımlılık', 'Addiction'], items: [
          ['Uyuşturucular, özellikle Xanax, bağımlılık ekler; her gün biraz azalır.', 'Drugs, especially Xanax, add addiction; it wears off a little every day.'],
          ['Yüksek bağımlılık battle statlarını ve iş verimini düşürür, kurstan atılmana yol açabilir; o durumda drug cooldown yokken antrenman yapmak seni hastaneye düşürebilir.', 'High addiction lowers your battle stats and job efficiency and can get you kicked out of a course; training without an active drug cooldown can then land you in hospital.'],
          ["Rehab İsviçre'de (seans başı $250.000), yani seviye 15'te açılan seyahat gerekir. O zamana kadar uyuşturucuyu ölçülü kullan.", 'Rehab is in Switzerland ($250,000 a session), so it needs travel, which opens at level 15. Use drugs in moderation until then.'],
        ] },
      ] },
    { id: 'gym', icon: '🏋️', title: ["Gym nasıl ilerletilir", 'How to progress in the gym'],
      summary: [
        ["Gym kazancını enerji, happy (mutluluk) ve gym belirler. Happy bir çarpan gibi çalışır; daha iyi ev, daha yüksek taban happy demektir. İlk ara hedef olarak Mansion iyi bir seçimdir; personel tutmak happy'yi artırır ama günlük gideri vardır.", 'Gym gains depend on energy, happy and the gym itself. Happy works like a multiplier, and a better property means a higher base happy. A Mansion is a good first milestone; staff raise happy but cost upkeep every day.'],
        ["Antrenmana taban happy ile başlama. Şehirdeki dükkânlardan alınan ucuz bir şeker ya da lolipop bile happy'yi yükseltir.", 'Never train at base happy. Even a cheap candy or lollipop from a city shop raises it.'],
        ['Enerjini tek seferde harca. Her antrenmandan sonra happy biraz düşer; tüm enerjiyi tek tıkta harcarsan oyun hepsini başlangıçtaki yüksek happy ile hesaplar.', 'Spend all your energy in one go. Happy drops a little after each train; one big train is calculated at your starting, highest happy.'],
      ],
      details: [
        { items: [
          ["Bulunduğun gym'de en çok kazanç veren statı çalış. Statları eşit tutmaya çalışmak verimsizdir; geride kalanları ileride dengeli gym'lerde yakalarsın.", 'Train the stat with the best gain in your current gym. Forcing equal stats is inefficient; you can catch up on the lagging ones later in balanced gyms.'],
          ["Yeni gym'ler belli miktarda enerji harcayınca açılır. Dolu duran enerji barı kayıptır.", 'New gyms unlock after you spend a set amount of energy. A full energy bar sitting idle is wasted progress.'],
          ["Happy'ni çeyrek saat geçer geçmez yükselt ve bir sonraki çeyrekten önce antrenman yap: max'ın üstündeki happy her çeyrekte max'a geri düşer.", 'Boost your happy right after a quarter-hour tick and train before the next one: happy above max drops back to max at every tick.'],
          ["300 kuralı: dört stat da yaklaşık 300 olana kadar enerjini gym'e ver. Sonra enerjiyi saldırılara (Baldr's Levelling Targets) çevir ve seviye atla.", "The 300 rule: train until all four stats are around 300. Then switch your energy to attacks (Baldr's Levelling Targets) and level up."],
          ["Donator Pack en değerli uzun vadeli yatırımlardan biridir: maksimum enerji 150 olur ve daha hızlı yenilenir. Xanax +250 enerji verir ama uzun cooldown'u ve bağımlılığı vardır.", 'A Donator Pack is one of the best long-term buys: max energy becomes 150 and refills faster. Xanax gives +250 energy but has a long cooldown and adds addiction.'],
        ] },
      ] },
    { id: 'crimes', icon: '🕵️', title: ['Nerve, crimes ve görevler', 'Nerve, crimes and missions'],
      summary: [
        ['Nerve her 5 dakikada 1 yenilenir. Bar dolmadan suçlara harca.', 'Nerve refills 1 every 5 minutes. Spend it on crimes before the bar fills.'],
        ['Bir başlangıç suçu seç ve onu ilerlet: Search for Cash, Graffiti, Shoplifting ya da Bootlegging.', 'Pick one beginner crime and level it up: Search for Cash, Graffiti, Shoplifting or Bootlegging.'],
        ["Duke'un görevlerini (Missions) her gün yap: mission kredisi veren kolay işler.", "Do Duke's contracts (Missions) every day: easy tasks that pay mission credits."],
      ],
      details: [
        { head: ['Crimes', 'Crimes'], items: [
          ['Başarı şansı iyiyken dene; hapse girmek gizli suç deneyiminin bir kısmını götürür.', 'Attempt a crime while its success chance is good; getting jailed costs some of your hidden crime experience.'],
          ['Suç deneyimin arttıkça maksimum nerve\'ün de büyür.', 'Your max nerve grows as your crime experience rises.'],
          ['Alet satın alma; ihtiyacın olanlar oynadıkça çıkar.', 'Do not buy crime tools; the ones you need drop as you play.'],
          ['Hapisteyken başkaları seni bust edip çıkarabilir. Başkalarını bust etmek nerve harcar ve biraz EXP verir.', 'In jail others can bust you out. Busting other players costs nerve and gives a little EXP.'],
        ] },
        { head: ["Duke'un görevleri", "Duke's missions"], items: [
          ["3 görevle başlarsın; her gün 00:00 TCT'de bir yenisi gelir ve en fazla 3 tane bekletebilirsin.", 'You start with 3 contracts and get a new one every day at 00:00 TCT, holding up to 3.'],
          ['İlk 10 görevi bitirince Protégé onurunu (honor) kazanırsın.', 'Finishing your first 10 contracts earns the Protégé honor.'],
          ['Mission kredilerini kitaplara, silah modlarına ve özel mermiye harca; parayla alınabilen şeylere harcama.', 'Spend mission credits on books, weapon mods and special ammo, not on things cash can buy.'],
        ] },
        { head: ['EXP', 'EXP'], items: [
          ['Suçlar, bust\'lar ve görevler biraz EXP verir; en çok EXP saldırılardan gelir, en fazlası da kazanınca LEAVE seçince.', 'Crimes, busts and missions give a little EXP; attacks give the most, and choosing LEAVE when you win gives the most of all.'],
        ] },
      ] },
    { id: 'faction', icon: '🤝', title: ['Faction, para ve ev', 'Faction, money and home'],
      summary: [
        ["Aktif bir faction'a katıl: gym perk'leri, yardım ve tavsiye.", 'Join an active faction: gym perks, help and advice.'],
        ["Üzerindeki nakdi $0'a yakın tut: mug edilirsen %5–10'unu kaybedersin.", 'Keep the cash you carry near $0: a mug takes 5–10% of it.'],
        ["Shack'ten çık: en az bir Penthouse kirala.", 'Move out of the Shack: rent a Penthouse or better.'],
      ],
      details: [
        { head: ['Faction', 'Faction'], items: [
          ["Perk'ler genelde 3 günlük acemi (recruit) döneminden sonra başlar. Steadfast dalı gym kazancını artırır.", 'Perks usually start after a 3-day recruit period. The Steadfast branch raises gym gains.'],
          ["Yaklaşık 500k–1M ya da daha fazla respect'i olan bir faction ara. Faction finder'dan, recruitment forumundan ya da New Player sohbetinden bulabilirsin; katılmadan önce liderlerine bak.", 'Look for a faction with about 500k–1M respect or more. Find one in the faction finder, the recruitment forum or New Player chat, and check the leaders before you join.'],
          ["Paranı faction kasasında tutma; tamamen güvenli değildir.", 'Do not keep your money in the faction vault; it is not fully safe.'],
          ["New Player Protection: ilk 14 gününde, 14 günden eski oyuncular sana saldıramaz (faction savaşları hariç).", 'New Player Protection: for your first 14 days, players older than 14 days cannot attack you (except during faction wars).'],
        ] },
        { head: ['Para', 'Money'], items: [
          ["Nakdi üzerinde taşıma; harca ya da yatır. City Bank faiz verir; yeni oyuncular uzun vadeleri adım adım açar.", 'Spend or invest your cash instead of carrying it. The City Bank pays interest; new players unlock the longer periods step by step.'],
          ['Ev kasası (vault) için evin senin olması gerekir; kiralık evde olmaz.', 'A property vault needs a home you own, not a rented one.'],
        ] },
        { head: ['Ev', 'Home'], items: [
          ['Taban happy yaklaşık: Shack 100, Penthouse 450, Mansion 500, Ranch 600. Yükseltmeler ve personel daha fazlasını ekler.', 'Base happy is about: Shack 100, Penthouse 450, Mansion 500, Ranch 600. Upgrades and staff add more.'],
          ['Satın almadan önce kirala: Estate Agent → Rental. Kiralar genelde 100 güne kadardır; kiracı da personel ve bakım giderini öder.', 'Rent before you buy: Estate Agent → Rental. Leases usually run up to 100 days, and tenants still pay staff and upkeep.'],
          ['Uzun vadede hedef pistli bir Private Island.', 'In the long run, aim for a Private Island with an airstrip.'],
        ] },
      ] },
    { id: 'job', icon: '💼', title: ['Hangi işe girmeli', 'Which job to take'],
      summary: [
        ['Şehir işleri (City Jobs) iş puanı (JP) ve rütbe ödülleri verir; son rütbenin ödülü kalıcıdır.', 'City jobs give job points (JP) and rank rewards; the final-rank reward is permanent.'],
        ["Education: başlamak için en iyisi. JP'yi çalışma statlarına çevirebilirsin; son rütbe tüm kurs sürelerini kalıcı olarak %10 kısaltır.", 'Education: the best place to start. JP converts into working stats, and the final rank permanently cuts every course time by 10%.'],
        ['Çalışma statların pozisyon şartının altındaysa daha yavaş artar. İşsizken uygulamadaki İş Asistanı sana uygun pozisyonları listeler.', "Working stats grow slower while they are below a position's requirement. While unemployed, the Job Assistant page lists positions that fit you."],
      ],
      details: [
        { items: [
          ["Army: erken dönemde savaşa katkı verir; JP'yi Strength ya da Defense'e çevirebilirsin.", 'Army: helps your combat early on; JP converts into Strength or Defense.'],
          ["Medical: son rütbe başkalarını revive etme yeteneği verir, bu da iyi bir gelir kaynağıdır. Law: son rütbe crime EXP'sine ve skill kazancına kalıcı %5 ekler.", 'Medical: the final rank lets you revive others, which pays well. Law: the final rank adds a permanent 5% to crime EXP and skill gain.'],
          ['Grocer ve Casino başlangıçta pek değmez.', 'Grocer and Casino are rarely worth it early on.'],
          ["Oyuncu şirketlerinden gym'e yardımcı olanlar: Fitness Center (gym kazancı +%3, happy kaybı azalır), Music Store (gym deneyimi +%30, yeni gym'ler daha hızlı açılır), Gents / Ladies Strip Club (Dexterity / Defense kazancı +%10), Sweet Shop ve Adult Novelties (happy), Pub ve Restaurant (enerji / nerve).", 'Player companies that help training: Fitness Center (+3% gym gains, less happy loss), Music Store (+30% gym experience, gyms unlock faster), Gents / Ladies Strip Club (+10% Dexterity / Defense gains), Sweet Shop and Adult Novelties (happy), Pub and Restaurant (energy / nerve).'],
        ] },
      ] },
    { id: 'education', icon: '🎓', title: ['Eğitim sırası', 'Education order'],
      summary: [
        ['Kurslar gerçek zamanlı ilerler (14 gün = gerçekten 14 gün). Her zaman açık bir kursun olsun.', 'Courses run in real time (14 days really is 14 days). Always keep one running.'],
        ['Sıra: BIO1340 → BIO2127 (blood bag), sonra Sports Science.', 'Order: BIO1340 → BIO2127 (blood bags), then Sports Science.'],
      ],
      details: [
        { items: [
          ['1) BIO1340 (1 hafta) → BIO2127 Intravenous Therapy (3 hafta): blood bag kullanabilirsin; hastanede daha az kalırsın.', '1) BIO1340 (1 week) → BIO2127 Intravenous Therapy (3 weeks): lets you use blood bags, so you spend less time in hospital.'],
          ['2) Sports Science: SPT1430, ardından SPT2440 / 2450 / 2460 / 2470. Her biri bir statın gym kazancına +%1 ekler; bölüm diploması (SPT3510) hepsine +%1 daha ekler, böylece her stat +%2 olur.', "2) Sports Science: SPT1430, then SPT2440 / 2450 / 2460 / 2470. Each adds +1% gym gains to one stat; the bachelor's degree (SPT3510) adds another +1% to all, so each stat ends at +2%."],
          ["Merit'lerini erken dönemde Education perk'lerine harcamak kurs sürelerini kısaltır. West Side University (WSU) hissesinin ödülü de eğitim süresini %10 kısaltır.", 'Spending early merits on Education perks shortens courses. The West Side University (WSU) stock benefit cuts education time by another 10%.'],
          ['Bağımlılığın çok yükselirse kurstan atılabilirsin; uyuşturucuyu ölçülü kullan.', 'If your addiction gets too high you can be kicked out of a course, so use drugs in moderation.'],
        ] },
      ] },
    { id: 'buy', icon: '🛒', title: ['Ne almalı, ne almamalı', 'What to buy, what to skip'],
      summary: [
        ["Al: happy için ucuz şekerler, ev yükseltmeleri, ileride Xanax ve (BIO2127'den sonra) blood bag.", 'Buy: cheap candy for happy, property upgrades, later Xanax and (after BIO2127) blood bags.'],
        ['Alma: statların taşıyamayacağı pahalı silah ve zırhlar, crime aletleri (oynadıkça bulursun) ve kumarhane; kumarhane uzun vadede hep kaybettirir.', 'Skip: expensive weapons and armor your stats cannot use, crime tools (you find them as you play) and the casino, which always loses in the long run.'],
      ],
      details: [
        { items: [
          ['Hiçbir eşyayı çöpe atma: değersiz görünen eşyalar bile markette satılır, önce fiyatına bak.', 'Never trash items: even junk-looking items sell on the market, so check the price first.'],
          ["Uyuşturucuda başta yalnızca Xanax (enerji), Ecstasy (happy'yi ikiye katlar) ve Cannabis (nerve) işe yarar. Speed ve PCP'de overdose kalıcı stat kaybına yol açabilir; uzak dur.", 'Early on only Xanax (energy), Ecstasy (doubles happy) and Cannabis (nerve) matter. Overdosing on Speed or PCP can cost you stats permanently; avoid them.'],
        ] },
      ] },
    { id: 'tools', icon: '🧰', title: ['Yardımcı araçlar', 'Helpful tools'],
      summary: [
        ['TornTools bu uygulamada yerleşik gelir: sayaçlar, market değerleri ve daha fazlası.', 'TornTools is built into this app: timers, market values and more.'],
        ["Torn Stats: API key'inle statlarını ve gelişimini takip eder. Torn PDA: telefonda oynuyorsan çok kullanışlı.", 'Torn Stats tracks your stats and progress via your API key. Torn PDA is very handy if you play on your phone.'],
      ],
      details: [
        { items: [
          ["Uygulamanın kendi sayfaları da yardımcı olur: Gym & Statlar günlük kazancını, İş Asistanı sana uygun pozisyonları, Baldr's Levelling Targets en iyi hedefleri gösterir.", "The app's own pages help too: Gym & Stats shows your daily gains, the Job Assistant lists positions that fit you, and Baldr's Levelling Targets lists the best targets."],
        ] },
      ] },
    { id: 'after15', icon: '✈', title: ['Seviye 15 sonrası', 'After level 15'],
      summary: [
        ['Seyahat açılınca uygulamadaki Seyahat Kârı sayfası hangi üründen ne kazanacağını gösterir.', "Once travel unlocks, the app's Travel Profit page shows what each item earns."],
        ['Başındaysan kısa uçuşlar, uzun süre uzak kalacaksan uzun uçuşlar daha kârlıdır. Üzerinde fazla nakitle iniş yapma; mug edilebilirsin.', 'Short flights pay best while you are at the keyboard, long ones when you will be away. Do not land carrying lots of cash; you can get mugged.'],
      ],
      details: [
        { items: [
          ['Uzun vadeli hedef: pistli bir Private Island (pilotla uçuş daha kısa sürer) ve Large Suitcase (daha çok eşya taşırsın).', 'Long-term goal: a Private Island with an airstrip (a private pilot flies faster) and a Large Suitcase (more items per trip).'],
          ["Bağımlılık için rehab İsviçre'dedir; artık oraya uçabilirsin.", 'Rehab for addiction is in Switzerland, which you can now fly to.'],
        ] },
      ] },
  ];

  const STAT_NAMES = { strength: 'Strength', defense: 'Defense', speed: 'Speed', dexterity: 'Dexterity' };
  const hasJob = (j) => !!j && (Number(j.company_id) > 0 || Boolean(j.job && j.job !== 'None'));

  // The personal steps, from the overview the page already has. Texts are plain; the page escapes them.
  function steps(o, fmt) {
    if (!o || !o.player) return [];
    const out = [], p = o.player, bars = o.bars || {};
    const stats = Object.entries(o.battle?.stats || {}).map(([k, s]) => [STAT_NAMES[k] || k, Number(s?.base) || 0]);
    if (stats.length) {
      const low = stats.filter(([, v]) => v < 300);
      if (low.length) {
        const list = low.map(([n, v]) => `${n} ${fmt.num(v)}`).join(', ');
        out.push({ id: 'stats', done: false, text: [`Gym: ${list} henüz 300'ün altında. Enerjini gym'de harca.`, `Gym: ${list} still below 300. Spend your energy in the gym.`] });
      } else {
        out.push({ id: 'stats', done: true, text: ['Dört stat da 300+: enerjini Levelling hedeflerine harca.', "All four stats are 300+: spend your energy on Baldr's Levelling Targets."], action: { view: 'level' } });
      }
    }
    const job = p.job || {};
    if (hasJob(job)) {
      const name = (Number(job.company_id) > 0 ? job.company_name : job.job) || '';
      const pos = job.position ? ` (${job.position})` : '';
      out.push({ id: 'job', done: true, text: [`İşin var: ${name}${pos}`, `You have a job: ${name}${pos}`] });
    } else {
      out.push({ id: 'job', done: false, text: ['Henüz işin yok: başlangıç için en iyisi Education şehir işi.', 'No job yet: the Education city job is the best start.'], action: { view: 'job' } });
    }
    const edu = o.education;
    if (edu) {
      if (edu.currentId) out.push({ id: 'course', done: true, text: [`Kurs devam ediyor: ${edu.current || ''}`, `Course in progress: ${edu.current || ''}`] });
      else out.push({ id: 'course', done: false, text: ['Şu an kurs okumuyorsun: BIO1340 ile başla, sonra BIO2127 ve Sports Science.', 'You are not taking a course: start with BIO1340, then BIO2127 and Sports Science.'], action: { url: EDU_URL, label: ['Eğitim sayfası', 'Education page'], icon: '🎓' } });
    }
    const happy = bars.happy;
    if (happy && happy.maximum) {
      const h = fmt.num(happy.current);
      if (happy.current <= happy.maximum) out.push({ id: 'happy', done: false, text: [`Happy taban seviyede (${h}). Antrenmandan önce ucuz bir şekerle yükselt.`, `Happy is at base (${h}). Raise it with cheap candy before training.`] });
      else out.push({ id: 'happy', done: true, text: [`Happy tabanın üstünde (${h}): antrenman için iyi an.`, `Happy is above base (${h}): good time to train.`] });
    }
    const en = bars.energy;
    if (en && en.maximum) {
      if (en.current > en.maximum) out.push({ id: 'energyStacked', done: false, text: [`Max'ın üstünde ${fmt.num(en.current)} enerji biriktirdin: antrenmandan önce Happy jump kartına bak.`, `You have ${fmt.num(en.current)} energy stacked above your max: check the Happy jump card before you train.`] });
      else if (en.current >= en.maximum) out.push({ id: 'energyFull', done: false, text: [`Enerjin dolu (${en.current}/${en.maximum}), boşa gidiyor: şimdi harca.`, `Energy is full (${en.current}/${en.maximum}) and going to waste: spend it now.`] });
    }
    const ne = bars.nerve;
    if (ne && ne.maximum && ne.current >= ne.maximum) {
      out.push({ id: 'nerveFull', done: false, text: [`Nerve'ün dolu (${ne.current}/${ne.maximum}), boşa gidiyor: şimdi bir suç işle.`, `Nerve is full (${ne.current}/${ne.maximum}) and going to waste: do a crime now.`], action: { url: CRIMES_URL, label: ['Suçlar', 'Crimes'], icon: '🕵️' } });
    }
    const fac = p.faction;
    if (fac && fac.faction_id != null) {
      if (Number(fac.faction_id) > 0) out.push({ id: 'faction', done: true, text: [`Faction'dasın: ${fac.faction_name || ''}`, `You are in a faction: ${fac.faction_name || ''}`] });
      else out.push({ id: 'faction', done: false, text: ["Henüz bir faction'da değilsin: aktif bir faction gym perk'leri ve yardım sağlar.", 'Not in a faction yet: an active faction gives gym perks and help.'] });
    }
    if (p.property === 'Shack') out.push({ id: 'home', done: false, text: ["Shack'te oturuyorsun (100 happy): daha iyi bir ev kirala; happy gym kazancını doğrudan artırır.", 'You live in a Shack (100 happy): rent a better home; happy feeds your gym gains directly.'] });
    return out;
  }

  // The next quarter-hour tick (TCT seconds), strictly after `tctSec`.
  function nextTick(tctSec) {
    return (Math.floor(tctSec / TICK_SEC) + 1) * TICK_SEC;
  }

  // Where the player stands in a happy jump. Stacking is optional (a budget jump starts from a full bar), and a jump in
  // progress always wins, so the card never says "do not train" halfway through one. Cooldowns are the seconds left when
  // the overview was fetched, counted down to now.
  function jumpReadiness(o, { nowMs = Date.now(), skewMs = 0 } = {}) {
    const tick = nextTick(Math.floor((nowMs + skewMs) / 1000));
    const state = o?.player?.status?.state || '';
    const e = o?.bars?.energy, h = o?.bars?.happy;
    if (!e || !h) return { phase: 'unknown', checks: {}, nextTick: tick, state };
    const since = Number(o.fetchedAt) > 0 ? Math.max(0, (nowMs - Number(o.fetchedAt)) / 1000) : 0;
    const left = (k) => Math.max(0, Math.ceil((Number(o.cooldowns?.[k]) || 0) - since));
    const drug = left('drug'), booster = left('booster');
    const okay = !state || state === 'Okay';
    // Happy above max is a boost (boosters or Ecstasy), except the +75 of a Xanax that is still active: with the drug
    // cooldown running, happy within max + 75 is taken for that unless the overview says no Xanax is active.
    const xanaxBump = o.drug?.xanaxActive !== false && h.current <= h.maximum + XANAX_HAPPY;
    const boosted = h.current > h.maximum && (drug === 0 || !xanaxBump);
    const phase = boosted ? (!okay ? 'blocked' : drug === 0 ? 'ecstasy' : 'train')
      : drug > 0 ? 'waitDrug' : booster > 0 ? 'waitBooster' : !okay ? 'blocked' : 'ready';
    return {
      phase, state, nextTick: tick,
      checks: {
        status: { ok: okay },
        energy: { ok: e.current >= e.maximum, current: e.current, max: e.maximum },
        drug: { ok: drug === 0, left: drug },
        booster: { ok: booster === 0, left: booster },
        happy: { ok: h.current > h.maximum, current: h.current, max: h.maximum },
      },
    };
  }

  // The next step of the jump, as a [tr, en] pair. fmt: { num(n), dur(sec), time(tctSec) }.
  function phaseText(r, fmt) {
    const c = r.checks || {}, at = fmt.time(r.nextTick), cap = fmt.num(STACK_CAP);
    const energy = fmt.num(c.energy?.current ?? 0), happy = fmt.num(c.happy?.current ?? 0);
    const atCap = (c.energy?.current ?? 0) >= STACK_CAP; // another Xanax would be wasted
    switch (r.phase) {
      case 'ready': return [
        `Hazırsın. Bir sonraki çeyrek geçer geçmez (${at} TCT): Erotic DVD'lerini ya da şekerlerini kullan, sonra Ecstasy al, sonra ${energy} enerjinin hepsini antrenmana harca.${atCap ? '' : ` İstersen önce bir Xanax alıp daha fazla biriktir (${cap}'e kadar).`}`,
        `Ready. Right after the next tick (${at} TCT): use your Erotic DVDs or candy, then Ecstasy, then train all ${energy} energy.${atCap ? '' : ` Or take a Xanax first to stack more (up to ${cap}).`}`];
      case 'ecstasy': return [
        `Happy yükseldi (${happy}). Şimdi Ecstasy al, sonra ${at} TCT'den önce bütün enerjini antrenmana harca.`,
        `Happy is boosted (${happy}). Take Ecstasy now, then train all your energy before ${at} TCT.`];
      case 'train': return [
        `Happy ${happy}. Bütün enerjini şimdi harca, kullanacaksan günlük refill'le birlikte, ${at} TCT'den önce; o anda max'ın üstündeki happy geri düşer.`,
        `Happy is ${happy}. Train all your energy now, plus the daily refill if you use it, before ${at} TCT, when happy above max drops back.`];
      case 'waitDrug': return atCap ? [
        `${cap} enerjilik biriktirme sınırındasın. Drug cooldown'un bitmesini bekle (${fmt.dur(c.drug?.left ?? 0)}), sonra jump'a başla: Ecstasy için boş olmalı.`,
        `You are at the ${cap} energy stacking cap. Let the drug cooldown end (${fmt.dur(c.drug?.left ?? 0)}), then start the jump: Ecstasy needs it clear.`] : [
        `Drug cooldown ${fmt.dur(c.drug?.left ?? 0)} sonra biter. Sonra biriktirmeye devam edeceksen bir Xanax daha al (${energy} / ${cap} enerji) ya da jump'tan önce bitmesini bekle: Ecstasy için drug cooldown boş olmalı.`,
        `Drug cooldown ends in ${fmt.dur(c.drug?.left ?? 0)}. Then take another Xanax to keep stacking (${energy} / ${cap} energy), or let it end before the jump: Ecstasy needs it clear.`];
      case 'waitBooster': return [
        `Booster cooldown ${fmt.dur(c.booster?.left ?? 0)} sonra biter. Boosterlar için boş olmalı: 5 Erotic DVD ya da yaklaşık 48 şeker sığar.`,
        `Booster cooldown ends in ${fmt.dur(c.booster?.left ?? 0)}. Boosters need it empty: room for 5 Erotic DVDs or about 48 candies.`];
      case 'blocked':
        if (r.state === 'Hospital') return [
          'Hastanedesin: hastanede booster kullanılamaz ve antrenman yapılamaz. Çıkınca devam et; enerji biriktirmeye devam edebilirsin.',
          'You are in hospital: you cannot use boosters or train there. Carry on once you are out; stacking energy can continue.'];
        if (r.state === 'Jail') return [
          "Hapistesin: orada yalnızca Crims gym açık. Boosterlardan önce çık; enerji biriktirmeye devam edebilirsin.",
          'You are in jail: only the Crims gym works there. Get out before you boost; stacking energy can continue.'];
        if (r.state === 'Traveling' || r.state === 'Abroad') return [
          "Yoldasın ya da yurt dışındasın: orada gym yok. Jump'ı dönüşe planla; enerji biriktirmeye devam edebilirsin.",
          'You are travelling or abroad: there is no gym there. Plan the jump for when you are back; stacking energy can continue.'];
        return [`Şu an antrenman yapamazsın (${r.state}).`, `You cannot train right now (${r.state}).`];
      default: return [
        'Genel bakış verisi yüklenince hazırlık durumu burada görünür.',
        'Your readiness shows here once your overview data has loaded.'];
    }
  }

  return Object.freeze({ STACK_CAP, TICK_SEC, LEAD, JUMP_NOTE, ROADMAP, SECTIONS, steps, nextTick, jumpReadiness, phaseText });
});
