# LaterLab 5.8 / Firefox 1.1.3

## Otomatikleşenler

- Firefox’ta bağlı YouTube hesabınla gerçekten oynattığın farklı normal videolar günlük sayılır. LaterLab kütüphanesi dışındaki videolar, ana sayfadan veya aboneliklerden açıldığında da sayılır. Aynı video aynı İstanbul gününde bir kez sayılır.
- Kütüphanendeki videolar için kaldığın saniye ve gerçek oynatma süresi ayrıca alınır. Uzun video ve normal kütüphane bağlantıları kayıtlı konumdan açılır. Kütüphane dışı videolar kütüphaneye veya haftalık dakika toplamına eklenmez.
- Kütüphane videolarının gerçek oynatma süresi haftalık toplama, İngilizce işaretlenmiş olanlarda İngilizce hedefine eklenir. Reklam, bekleme, duraklama ve ileri sarma süreye eklenmez.
- Daha Sonra İzle liste kontrolü varsayılan 6 saatte birdir. Ayardan 30 dakika veya 12 saat seçilebilir; “Şimdi kontrol et” de kullanılabilir.
- İzleme örnekleri yaklaşık 15 saniyede bir yerel kuyruğa alınır; buluta yaklaşık 2 dakikada bir, duraklatmada birkaç saniye sonra gönderilir. İnternet kesildiğinde kuyruk sonraki denemeye saklanır.
- YouTube’da video açıldığında Bora Özkent 1,25×; Kanal Finans, Yatırım 101 ve diğer kanallar 1,5× başlar. Varsayılan ses parçası İngilizceyse video, kanalından bağımsız 1× başlar. Ses parçası dili yoksa yalnız tek dildeki otomatik altyazı ipucu kullanılır; çok dilli altyazı sırası dil sayılmaz. Dil belirlenemezse kanal kuralı, diğer kanallarda 1,5× kullanılır. 1.1.3, çok dilli Yatırım 101 videolarındaki yanlış 1× seçimini ve YouTube’un açılışta hızı geri almasını düzeltir; aynı videoda elle seçtiğin hız korunur.

## Firefox eklentisini güncelle

Mozilla yönetim ekranı: https://addons.mozilla.org/tr/developers/addon/87b570aa56384d989b3d/versions

“Yeni sürüm gönder” ile `laterlab-firefox-1.1.3-imzalama.zip` dosyasını yükle. Kaynak kod istenirse `laterlab-firefox-1.1.3-kaynak.zip` dosyasını seç. Mozilla’nın imzaladığı güncelleme kurulduktan sonra açık YouTube sekmelerini ve LaterLab’i yenile. Eklenti kimliği aynı kaldığı için mevcut bağlantı korunur. Kurulu sürümü Firefox’ta `about:addons` → Uzantılar → LaterLab → Ayrıntılar bölümünde görebilirsin; ayrıca eklentinin ayar sayfasının üstünde görünür.

## Kapsam ve veriler

Firefox masaüstü 142+, standart profil ve LaterLab’e bağlı YouTube hesabı gerekir. Sayım, bu Firefox profilinde gerçekten oynatılan normal `/watch` sayfaları içindir; Shorts, özel/kapsayıcı sekmeler, telefon/TV ve eklenti güncellenmeden önceki geçmiş doğrudan alınmaz. Canlı yayın sürerken ölçüm alınmaz; bitmiş yayın kayıtları desteklenir. Firefox kapalıyken yeni oynatma kaydedilemez.

Kütüphane dışı videolarda günlük tekilleştirme için yalnız video kimliği ve gün şifreli LaterLab belgesinde yaklaşık 30 gün tutulur. Başlık, kanal, ilerleme ve dakika kütüphaneye eklenmez. Kütüphane videolarındaki mevcut ilerleme davranışı sürer; ilk 1274 dışlaması ve gizli/erişilemeyen kayıtların kütüphanede görünme kuralları değişmez. YouTube çerezleri LaterLab’e gönderilmez.

Ani tarayıcı kapanışında son yerel örnekten sonraki yaklaşık 15 saniye kaybolabilir. Uzun süre askıya alınan sekmede doğrulanamayan oynatma sayılmaz. Çevrimdışı kuyruk 500 oturum/gün kaydıyla sınırlıdır; 30 günden eski bekleyen olaylar uygulanmaz. Kişisel kalite/dil/zorluk kararları tahmin edilerek değiştirilmez.

## Doğrulama

Kaynakta `node work/test-all.mjs` testleri, paket kontrolü ve `web-ext lint` çalıştırılır. Gerçek YouTube hesabıyla uçtan uca doğrulama, imzalı güncelleme kurulduktan sonra yapılır.
