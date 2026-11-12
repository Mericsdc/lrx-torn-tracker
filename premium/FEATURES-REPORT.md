# Free / Premium geliştirme raporu

11 Kasım 2026. Çalışma aktif kaynak klasöründe yapıldı. Modüller yerelde tamamlandı. Sonraki kullanıcı talebiyle ortak servis **https://lrxe8.com/torn-premium** adresinde, ayrı bir veritabanıyla yayınlandı. Önceki uzak sentetik test servisi değiştirilmedi. Gerçek Xanax kabulü kapalıdır.

## Korunan özellikler

[Özellik matrisi](FEATURE-MATRIX.md) mevcut modülleri, bağımlılıkları ve Free kalan işlevleri listeler. Eski beş tema; seyahat kapasitesi, saatlik kâr, ülke filtreleri ve stok uyarıları; mevcut merit/ödül takibi; TornTools, FF Scouter, TornW3B ve tüm yardımcı scriptler; savaş grupları; şirket, faction/OC, suçlar, gym, networth, levelling ve güncelleme sistemi ücretsiz kaldı. Kullanıcı ayarları sıfırlanmadı. Mevcut level/director/faction yetkileri de korunuyor.

## Eklenen modüller

| Modül | Yeni işlevler | Erişim ID |
| --- | --- | --- |
| Görünüm | Eclipse/Aurora/Rose paketleri; özel beş renk; kontrast kontrolü; yoğunluk, kart stili ve köşeler; kayıtlı profiller ve tek seçimle geçiş | `appearance_custom_themes` |
| Torn yardımcıları / Savaş | Seviye, stat, FF, durum ve grup koşullarını birleştirme; dört oyuncuya kadar karşılaştırma; seçilebilir sütunlar; kayıtlı filtreler; özel eşik uyarısı | `helpers_advanced` |
| Etkinlikler | Resmî takvimden etkinlik seçme; API'nin verdiği ölçüm veya açıkça işaretlenmiş elle ilerleme; hedef, gerekli günlük hız, gözlenen ilerleme hızı ve kayıtlı dönemler; başlangıç/hedef uyarıları | `events_advanced` |
| Seyahat | Kayıtlı stratejiler; bekleme, satış kesintisi, fiyat değişimi ve sabit masraf senaryoları; ülke/rota karşılaştırması; gözlenen alış fiyatı grafiği; fiyat veya saatlik kâr eşikleri | `travel_advanced` |
| Merit | Resmî API'den rank/bakiye okuma; elle senaryo girişi; hedef ve ağırlıklarla bütçeli optimizasyon; A/B dağılım karşılaştırması; eksik merit hesabı; kayıtlı planlar ve gözlem geçmişi | `merits_optimizer` |

Merit hesabı rank başına 1…10 artan maliyeti kullanır; tek dalın toplam maliyeti 55'tir. Öneri, kullanıcının öncelik puanını bütçe içinde en yükseğe çıkarır. Oyun için evrensel bir en iyi strateji iddiası yoktur. Oyunda sıfırlama veya dağıtım yapılmaz. Güncel rank ve açıklamalar resmî `/v2/user/merits` ve `/v2/torn/merits` yanıtından alınır; alınamazsa senaryo elle giriş olarak gösterilir. Kaynak: https://wiki.torn.com/wiki/Merit.

## Erişim, veri ve performans

- Aynı kullanıcı, oturum, Xanax defteri, süre ve kalıcı Ezlira politikası kullanılır. İkinci abonelik altyapısı oluşturulmadı.
- `public/feature-catalog.js` merkezi kimlik ve Free/Premium kataloğudur. Gerçek yetki `premium/feature-service.js` tarafından doğrulanmış oturum, sunucu saati, aktif abonelik ve modül izniyle değerlendirilir. Kullanıcıdan gelen `premium`, `admin` veya Torn ID iddiaları yetki vermez.
- Her gelişmiş hesap ve profil değişikliği sunucuda kontrol edilir. Süre bitince erişim kesilir; profiller korunur. Yenilemede aynı profiller geri gelir. Ezlira [4037017] kalıcıdır.
- Yönetici panelinde modül bazında izin/istisna formu ve mevcut istisnalar bulunur. İşlemler audit kaydına girer. Bir modüle izin vermek, süresi bitmiş aboneliği etkinleştirmez; Free modüller buradan kapatılamaz.
- Analiz verileri için ayrı izin gerekir. Seçilen fiyat/oyuncu/merit/etkinlik ölçümleri gönderilir; analiz isteklerine API anahtarı eklenmez. İzin geri çekilince hesaplama/veri gönderimi durur, profiller silinmez. Kişisel dışa aktarım üyelik bitse de kullanılabilir.
- Profil yazımları transaction ve revision denetimi kullanır; başka cihazdaki değişiklikler sessizce ezilmez. Kullanıcı/modül başına 12 profil, 1000 gözlem, en çok iki yıl gözlem saklama, seri başına en sık beş dakikada bir kayıt ve kullanıcı başına dakikada 60 analiz/yazım sınırı vardır.
- Gelişmiş arayüz ihtiyaç halinde yüklenir. Aktif özel uyarılar varsa açılışta o modüller hazırlanır. Mevcut veri önbellekleri kullanılır; arka plan uyarıları ayrıca Torn oyuncusu taramaz. Bildirimler uygulama açık, ilgili veri mevcut ve yeterince güncelken çalışır.
- Oyuncu listesi ve enerji/can verisinin güncelliği ayrı kontrol edilir; yeni liste eski enerji bilgisini güncel göstermez. Uyarıların tekrar aralığı yeniden açılışta da korunur.
- Üyelik bağlantısını hatırlama isteğe bağlıdır. Yeniden açılışta tekrar sunucudan doğrular; diskten Premium hakkı okunmaz. Bağlantıyı kesmek bu tercihi de siler.
- Masaüstünde kullanıcı kendi CSS'ini veya JavaScript'ini değiştirebilir. Görsel kişiselleştirmeyi bununla mutlak olarak engellemek mümkün değildir; güvenlik sınırı sunucudaki hesaplama, profil ve üyelik işlemleridir. Değiştirilmiş frontend bu işlemlerden yetkisiz sonuç alamaz.

## Veritabanı

`premium/migrations/004-feature-modules.sql` dört tablo ekler:

1. `premium_feature_consents`: kullanıcıya ait analiz izni ve sürümü.
2. `premium_feature_overrides`: kullanıcı/modül izin istisnası.
3. `premium_feature_workspaces`: profiller, etkin profil, revision ve tarih.
4. `premium_feature_observations`: kullanıcı/modül/seri/zaman ile tekilleştirilmiş ölçümler.

Mevcut ödeme ve abonelik tabloları değiştirilmez. 3→4 geçişinin abonelikleri ve ödeme ayarlarını koruduğu test edildi. Eski servis şema 4'ü açamaz; ileride uzak aktarımda önce SQLite yedeği alınmalı. Yerel testler ayrı, geçici veritabanlarında çalıştı.

## Dosyalar

- Merkezi servis: `premium/feature-service.js`, `premium/insights.js`, `premium/service.js`, `premium/server.js`, `premium/database.js`, `premium/store.js`, migration 004.
- Köprü ve Free API: `src/server/premium-client.js`, `src/server/premium-url.js`, `src/server/server.js`. Ortak HTTPS adresinin alt yolunu korur; hatırlanan izin tam servis adresine bağlıdır.
- Arayüz: `public/feature-catalog.js`, `feature-access.js/css`, `advanced-modules.js/css`, `travel-math.js`, `features.js`, `events.js`, `app.js`, `premium.js`, `workspace.js`, `war-groups-ui.js`, `index.html`.
- Testler: `tests/premium/features.test.js`, `tests/premium/client.test.js`, `tests/feature-modules-ui-smoke.js`, `tests/unit/travel-math.test.mjs`, `vitest.config.mjs`.
- Geliştirme/paketleme: `package.json`, `package-lock.json`, `.gitignore`, `.github/workflows/tests.yml`, `tools/check-syntax.js`, `tools/build-preview.js`, `tools/make-update.js`.
- Belgeler: `docs/TESTING.md`, `premium/FEATURE-MATRIX.md`, `premium/FEATURES-REPORT.md`, `premium/PUBLIC-DEPLOYMENT.md`, `premium/README.md`, `premium/PRIVACY.md`.

Bu liste bu geliştirmeyi kapsar; çalışma ağacında önceki Premium işinden kalan değişiklikler de bulunur.

## Test ve derleme

- 69 mevcut/yeni Node testi + 1 Vitest testi: toplam 70.
- Free araçlar, sahte yetki reddi, kullanıcı izolasyonu, süre dolumu, yenileme, saklanan profiller, SQL geçişi, hesapların doğruluğu, izin geri alma, eşzamanlı profil yazımı ve servis kesintisi test edildi.
- Üç browser kontrolü: mevcut uygulama regresyonu, Premium ödeme paneli ve beş gelişmiş modül. 390/640/1440 px, TR/EN, özel palet, tema geri dönüşü, profil seçimi ve XSS metni kontrol edildi.
- Bildirim kontrolünde kayıtlı fiyat eşiği bir kez tetiklendi, aynı kontrol tekrar bildirim üretmedi; sayfa yeniden açılınca kural geri geldi ve bekleme süresi korunarak yinelenme engellendi. Süre dolumu simülasyonunda kural yeniden tetiklendi. İşletim sistemi bildirim penceresi yerine kontrollü test alıcısı kullanıldı.
- Paketli Electron kontrolü: açılış, manuel anahtar/yapıştırma, pencere boyutu, native sekmeler ve mevcut FF Scouter/TornW3B yüklenmesi geçti.
- `npm run check`: JavaScript sözdizimi. TypeScript yapılandırması bulunmadığından ayrı bir TypeScript typecheck çalıştırılmadı.
- `npm run build:preview`: güncelleme içerik paketi; gerçek kurulum veya GitHub yayını yapmaz. Paket `.env`, kullanıcı verisi, SQLite, log, node_modules, GitNexus ve test raporlarını içermez.
- Vitest 5.1.0 kuruldu; ilk test ortak `tripMetrics()` fonksiyonunun 15 × $400 / 1 saat = $6000 hesabını doğrular. `npm run test:unit`, `npm run test:watch`, `npm run test:all` kullanılabilir. Kurulumdaki geçersiz Packager sürümü düzeltildi. Ayrıntılar: [TESTING.md](../TESTING.md).

## Kalan sınırlar ve aktarım

- Yerel çalışma sonrasında kullanıcı ortak erişim için lrxe8.com adresini seçti. Ayrı ortak servis yayınlandı; [yayın notları](PUBLIC-DEPLOYMENT.md) bağlantıyı ve doğrulamaları açıklar. GitHub'a push/release yapılmadı; mevcut dağıtılmış sürümlerin yeni varsayılan adresi alması için güncellenmesi gerekir.
- Yerel test servisi `127.0.0.1:43741` üzerinde hazırlandı. Beş modül, kapalı ödeme kabulü ve kalıcı Ezlira politikası kontrol edildi. Ayrı yerel test veritabanı kullanılır. Başlatıcı ve kullanım notları kaynak/paket dışında `D:/Meric/TORN/premium-test/Start-Premium-Local.ps1`, `Start-Premium-Local.vbs`, `LOCAL-TEST.md` dosyalarındadır. Kullanıcının açık talebinden sonra masaüstü Premium Test kısayolu yerel başlatıcıya bağlandı. Gerçek uygulama açılışı, genel bakış ve Premium ekranı kontrol edildi. Zaten yerel modda açıkken ikinci tıklamanın aynı pencereyi koruduğu doğrulandı.
- GitNexus'un aktif kaynak haritası tam taramayla yenilendi: `LRX-Torn-Tracker-Premium`. Artımlı taramadaki arama indeksi tutarsızlığı tam yeniden oluşturmayla giderildi. Eski kurulu kopyanın haritası ayrı kalır.
- Genel HTTPS servisi için sağlık, yetkisiz isteklerin reddi, test girişinin kapalı olması ve masaüstü köprüsü kontrol edildi. Gerçek ödeme kabulü ve yeni modüllerin gerçek hesapla uçtan uca canlı kabul testi yapılmadı. Otomatik testlerde sahte oyun verisi kullanıldı.
- Fiyat geçmişi ölçüm toplandıkça oluşur; eski yılların fiyatları üretilmez. Stok/fiyatlar gerçek zaman garantisi taşımaz. Grafik için iki farklı ölçüm gerekir.
- Etkinliklerde API ölçümü yoksa bilinmiyor gösterilir; elle değer girilebilir. Halloween için arayüz, toplam treat sayacını gösterdiğini ve bu dönemde kazanılan miktarı hesaplamadığını açıklar. Başlangıcı kesin olmayan etkinlikte saat bildirimi gönderilmez.
- Masaüstü uygulaması kapalıyken bildirim verilmez. Arka planda yeni oyun verisi taranmaz; mevcut cache kullanılır.
- Yeni environment variable eklenmedi. Mevcut Premium servis/masaüstü değişkenleri kullanılır; `premium/config.example.env` ve README'deki test/HTTPS ayarları geçerlidir. Vitest için Node 24 önerilir.
