# LRX Torn Tracker v1.6.12

## Torn rules and privacy

- The Rehab message button no longer clicks anything on Torn. It types the message into a chat box you already opened, and you press Enter yourself. If no chat box is open, the message is copied so you can paste it.
- New setting **Settings → App → Premium membership connection** (on by default). It controls whether your API key is sent to lrxe8.com/torn-premium to verify your Torn ID; the key is not stored there. When it is off, nothing is sent to the membership service.
- The Torn ToS table and the sign-in notice now describe exactly what is shared: Torn API, FFScouter, the Premium connection and the TornW3B sync to weav3r.dev.
- The FF Scouter bridge only serves the FF Scouter endpoints and Torn API lookups that the bundled script uses, and never returns your key in response headers.

## Fixes

- Importing a Torn session no longer signs you out when a single cookie is rejected; the previous session is restored.
- Session guard: Torn's own menu toggles work again, form posts with an old security token no longer fail, and the guard has its own setting.
- The main window only shows the app's own page; a dropped link opens in a Torn tab.
- Stock Status stops reading the page as soon as you leave it, and the "WebFrame was removed" log noise is gone.
- Switching API keys can no longer mix the previous player's data into the new player's history.
- Premium page: safer rendering of service data, open sections and workbenches survive the automatic refresh, lifetime members see their own name, and more Turkish text.
- New settings for target groups, the Weav3r shortcut and the Premium module cards.
- The light theme no longer makes the sign-in screen hard to read.

## Update

Existing users can install through the app's update button. Local keys, settings and profiles are preserved. New users can download `LRX-Torn-Tracker-Windows-x64.zip`, extract it and run TornTracker.exe.

## Türkçe

- Rehab mesajı artık Torn'da hiçbir şeye tıklamıyor: açık chat kutusuna yazar ya da panoya kopyalar, göndermeyi sen yaparsın.
- Yeni ayar **Ayarlar → Uygulama → Premium üyelik bağlantısı** (varsayılan açık). Kapalıyken API key'in üyelik servisine gönderilmez.
- Oturum aktarımında bir çerez reddedilirse eski oturum geri yüklenir; Torn menüleri ve stok okuyucu düzeltildi; Premium sayfası daha güvenli ve Türkçe metinleri tamamlandı.
