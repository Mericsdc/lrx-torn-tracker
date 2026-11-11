(() => {
  document.documentElement.classList.add('js');
  const english = Object.fromEntries([...document.querySelectorAll('[data-i18n]')].map(el => [el.dataset.i18n, el.innerHTML]));
  const turkish = {
    skip:'İçeriğe geç',navScreens:'Uygulama',navUpdates:'Yenilikler',navCommunity:'Topluluk',heroTitle:'Tek tık.<br>Bütün Torn.',heroLead:'Günlük Torn rutinin, tek bir masaüstü uygulamasında.',download:'Windows için indir',explore:'Uygulamayı keşfet',windowsNote:'Windows 64-bit',macNote:'Mac sürümü geliştirme aşamasında.',demoCaption:'Gerçek uygulama ekranları. Örnek veriler.',
    screensTitle:'Daha az sekme.<br>Daha çok oyun.',screensLead:'Büyük resmi kaybetmeden sıradaki hamleni bul.',tabWar:'Savaş hedefleri',tabTravel:'Seyahat kârı',tabThemes:'Çalışma alanın',enlarge:'Ekranı büyüt',warCaption:'Hedeflerin. Önceliklerin.',warDescription:'Hedefleri grupla, Fair Fight tahminlerini karşılaştır ve hastane sürelerini takip et.',travelCaption:'Yola çıkmadan önce karşılaştır.',travelDescription:'Ülke, stok, kapasite ve saatlik kâr aynı ekranda.',themesCaption:'Kendi düzenini kur.',themesDescription:'Beş mevcut tema, düzenlenebilir pencereler ve Türkçe veya İngilizce arayüz.',
    levelLabel:'İlk büyük hedefin.',beginnerTitle:'Torn’a yeni mi başladın?<br>Yalnız değilsin.',beginnerLead:'15 seviye altındayken nereden başlayacağını gösteren bir rehberin var.',beginnerOne:'Yeni oyuncu ve seviye geliştirme rehberini izle.',beginnerTwo:'Antrenman, bekleme süreleri ve merit ilerlemeni takip et.',beginnerThree:'15. seviyede seyahat kârı araçlarını keşfet.',travelRules:'Torn’un seyahat rehberini oku',
    updatesTitle:'Torn tarayıcın.<br>Birlikte çalışan araçların.',updatesLead:'İlk girişinden itibaren Windows uygulamasının içinde.',updateBrowser:'Torn’un, kendi sekmelerinde',updateBrowserText:'Dahili tarayıcı, Weav3r kısayolu ve kendini toparlayan araç çubuğu.',updateHelpers:'Birlikte çalışan yardımcılar',updateHelpersText:'FF Scouter kayıtlı anahtarını kullanır. TornTools ve TornW3B uygulamanın içinde.',updateTracking:'Önemli ayrıntılar gözünün önünde',updateTrackingText:'Xanax etkisini gözeten statlar, şirket stoku, faction araçları, suçlar ve etkinlikler.',updateComfort:'Sana uyan bir çalışma alanı',updateComfortText:'Beş tema, esnek pencereler, yapıştırmalı giriş ve Türkçe veya İngilizce.',updateUpdates:'Güncellemeyi aramana gerek yok',updateUpdatesText:'Açılış bildirimi, görünür güncelleme düğmesi ve doğrulanan güncelleme paketleri.',previewTitle:'Gelişmiş çalışma alanları',previewLabel:'Premium',previewText:'Özel görünüm profilleri, oyuncu karşılaştırmaları, etkinlik hedefleri, seyahat stratejileri ve merit planlayıcısı. Bu eklemeler yeni sürümde yer alıyor. İsteğe bağlı Premium çalışma alanları aktif üyelik gerektirir. Mevcut ücretsiz araçlar ücretsiz kalıyor.',
    communityTitle:'Siz isteyin.<br>Ben geliştireyim.',communityLead:'“Torn Tracker’ı oyuncuların istekleri doğrultusunda yaptım. Aynı şekilde geliştirmeye devam edeceğim: tek tık, daha az uğraş, Torn’a daha çok zaman.”',feedbackText:'Bir isteğin mi var? Uygulamadaki Feedback’i kullan veya GitHub’da paylaş.',feedbackLink:'Fikrini GitHub’da paylaş',thanksTitle:'İyi araçlar.<br>Arkasında harika insanlar.',thanksLead:'Bu deneyime katkı veren araçların geliştiricilerine teşekkürler.',thanksFF:'Oyuncuların savaş seçimlerine daha bilinçli yaklaşmasını sağladığı için.',thanksWeav3r:'Torn’un pazarlarını, verilerini ve faydalı keşiflerini bir araya getirdiği için.',thanksTornTools:'Günlük Torn deneyimini daha kullanışlı hale getirdiği için.',profile:'Torn profilini aç',creditsNote:'Bağımsız projelere teşekkür ediyoruz. Bu, resmî destek ortaklığı anlamına gelmez. Kendi lisansları geçerlidir.',
    downloadTitle:'Oyuna<br>yer aç.',releaseNote:'İndirme: en güncel Windows sürümü, ZIP arşivi. Mac sürümü geliştirme aşamasında.',installTitle:'İndirmeden Torn’a.',installOne:'ZIP dosyasını çıkart.',installTwo:'TornTracker.exe dosyasını aç.',installThree:'Kendi Limited Access Torn API anahtarınla bağlan.',releases:'Sürüm notları ve indirmeler',questionsTitle:'Açmadan önce.',questionFree:'Mevcut araçlar ücretsiz mi?',answerFree:'Evet. Mevcut araçlar ve Torn API verilerine erişim ücretsiz kalıyor. Premium, oyun içi Xanax karşılığında isteğe bağlı gelişmiş analizler ekler. Güncel fiyat ve ödeme durumunu uygulamadaki Premium sayfasından kontrol edin.',questionKey:'API anahtarım nereye gider?',answerKey:'Anahtarın yerelde saklanır. İlgili veriler Torn ve FFscouter’dan alınır. İsteğe bağlı üyelik servisine kimlik doğrulamak için bağlanmadan önce ayrı onay gerekir.',questionMac:'Mac’te kullanabilir miyim?',answerMac:'Mac sürümü geliştirme aşamasında. Şu an yalnızca Windows sürümü indirilebilir. Mac için açıklanmış bir çıkış tarihi yok.',license:'Lisans',privacy:'Üyelik verileri ve gizlilik',notices:'Üçüncü taraf katkıları',footerNote:'Ezlira [4037017] tarafından geliştirildi. Bağımsız bir Torn yardımcısıdır; resmî Torn ürünü değildir.',close:'Kapat'
  };
  const screens = {
    war:{file:'war.png',caption:'warCaption',description:'warDescription',alt:'Torn Tracker war targets with demonstration data'},
    travel:{file:'travel.png',caption:'travelCaption',description:'travelDescription',alt:'Torn Tracker travel profit with demonstration data'},
    themes:{file:'themes.png',caption:'themesCaption',description:'themesDescription',alt:'Torn Tracker appearance settings'}
  };
  let language='en', selected='war';
  const text = key => language==='tr' ? turkish[key] || english[key] : english[key];
  function caption() { const item=screens[selected]; document.getElementById('screen-caption').textContent=text(item.caption); document.getElementById('screen-description').textContent=text(item.description); }
  // Extra switcher copy is owned by this page, never supplied by an API.
  Object.assign(english,{travelCaption:'Compare before you take off.',travelDescription:'Countries, stock, carrying capacity and hourly profit, together.',themesCaption:'Make the workspace yours.',themesDescription:'Five existing themes, flexible windows and an English or Turkish interface.'});
  function setLanguage(lang) {
    language=lang==='tr'?'tr':'en'; document.documentElement.lang=language;
    document.querySelectorAll('[data-i18n]').forEach(el=>{el.innerHTML=text(el.dataset.i18n)});
    document.querySelectorAll('[data-language]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.language===language)));
    caption(); try{localStorage.setItem('lrx.site.language',language)}catch{}
  }
  document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>setLanguage(button.dataset.language)));
  try { if(localStorage.getItem('lrx.site.language')==='tr')setLanguage('tr'); } catch{}
  function selectScreen(name,focus=false) {
    selected=name; const image=document.getElementById('feature-screen'); image.src='/torn-premium/site/assets/'+screens[name].file; image.alt=screens[name].alt; document.querySelector('.screen-zoom').href=image.src;
    document.querySelectorAll('[data-screen]').forEach(button=>{const active=button.dataset.screen===name;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;if(active&&focus)button.focus({preventScroll:true});});
    document.getElementById('screen-panel').setAttribute('aria-labelledby','screen-'+name); caption();
  }
  document.querySelectorAll('[data-screen]').forEach(button=>{
    button.addEventListener('click',()=>selectScreen(button.dataset.screen));
    button.addEventListener('keydown',event=>{const names=Object.keys(screens);let next=names.indexOf(selected);if(event.key==='ArrowRight')next=(next+1)%names.length;else if(event.key==='ArrowLeft')next=(next+names.length-1)%names.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=names.length-1;else return;event.preventDefault();selectScreen(names[next],true);});
  });
  const dialog=document.getElementById('screen-dialog');
  document.querySelector('.screen-zoom').addEventListener('click',event=>{event.preventDefault();dialog.querySelector('img').src=document.getElementById('feature-screen').src;dialog.showModal();});
  dialog.querySelector('button').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
  const panels=[...document.querySelectorAll('.credit-panel')];
  function selectCredit(index) {
    if(panels[index].classList.contains('is-active'))return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const before=panels.map(panel=>panel.getBoundingClientRect());
    panels.forEach((panel,n)=>{panel.classList.toggle('is-active',n===index);panel.querySelector('button').setAttribute('aria-expanded',String(n===index));});
    // FLIP keeps the expanding-panel effect on transforms, without animating widths.
    if(!reduced&&innerWidth>=640)panels.forEach((panel,n)=>{const after=panel.getBoundingClientRect();panel.animate([{transformOrigin:'0 50%',transform:`translateX(${before[n].left-after.left}px) scaleX(${before[n].width/after.width})`},{transformOrigin:'0 50%',transform:'none'}],{duration:420,easing:'cubic-bezier(.16,1,.3,1)'});});
    if(!reduced)panels[index].querySelector('.credit-detail').animate([{opacity:0},{opacity:1}],{duration:420});
  }
  panels.forEach((panel,index)=>{panel.querySelector('button').addEventListener('click',()=>selectCredit(index));panel.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse'&&innerWidth>=960)selectCredit(index)});});
})();
