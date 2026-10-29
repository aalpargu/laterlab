# LaterLab 5.9 — açıklama ve video etiketi araması

## Maliyet ve yayın durumu
5.9 sürümü 27 Eylül 2026'da mevcut `siradaki` Worker'ına yayınlandı. Cloudflare hesabında Workers Free planı etkin; YouTube API projesine ödeme hesabı bağlı değil. YouTube Data API v3 için günlük kota 10.000'den 200 birime indirildi. `videos.list` çağrısı 50 videoya kadar 1 kota birimi kullanır. Kota aşılırsa bilgi alma işlemi hata verir; uygulama kendiliğinden ücretli plana geçmez. İçerik bilgileri yalnız kullanıcı düğmeye basınca çekilir ve cihazda 25 gün tutulur. Cloudflare Workers Free ve SQLite Durable Objects Free sınırları aşılınca işlemler hata verir. Ücretli plan veya ödeme hesabı eklenirse maliyet koşullarını yeniden kontrol etmek gerekir.

Kaynaklar: https://developers.google.com/youtube/v3/getting-started · https://developers.google.com/youtube/v3/docs/videos/list · https://developers.cloudflare.com/workers/platform/pricing/ · https://developers.cloudflare.com/durable-objects/platform/pricing/ · https://developers.cloudflare.com/billing/manage/budget-alerts/

## 5.9 kullanımı — yayında
Kütüphanem, İngilizce odağı ve Yarım kalanlar ekranlarındaki arama başlık, kanal, kişisel notlar, kişisel etiketler, YouTube video açıklaması ve videoyu yükleyenin etiketlerini arar. Birden fazla kelime için hepsi metinde bulunmalıdır; eşleşme nedeni video kartında gösterilir. Bu sürüm metin aramasıdır, videonun konuşmasını veya kesin anlamsal konusunu çözümlemez.

Google Cloud'da **LaterLab YouTube Search** projesinde YouTube Data API v3 etkinleştirildi. Yalnız bu API ile sınırlı anahtar, mevcut Cloudflare Worker'ın Production ortamına `YOUTUBE_API_KEY` secret'ı olarak eklendi. Anahtar kaynak dosyalarında veya ZIP'te bulunmaz. Mevcut `SYNC_AUTH_HASH` secret'ı korundu. İleride Wrangler ile yayın yapılırken bu klasörden `wrangler deploy --keep-vars` kullan; `wrangler.jsonc` aynı Worker'ı hedefler.

Arayüzde **Eksik bilgileri getir** düğmesi, bağlı cihazın mevcut eşitleme yetkisiyle yalnız bu kütüphanedeki görünür videoların kimliklerini 50'şerli gruplar halinde Worker'a gönderir. Worker anahtarı yalnız sunucuda tutarak YouTube'un `videos.list` yönteminden açıklama ve varsa yükleyici etiketlerini alır. Bilgiler cihazın ayrı IndexedDB önbelleğinde tutulur, JSON yedeğine veya şifreli eşitleme belgesine katılmaz. 25 gün sonra yerel kopya silinir; yeniden almak için düğmeye bas. Telefon ve diğer cihazlarda ayrı alınması gerekir. Anahtar veya eşitleme bağlantısı yoksa mevcut başlık/kanal/not araması çalışmaya devam eder.

`node ../test-all.mjs` ve `node build.mjs` çalıştırıldı; 24 test programı geçti. Wrangler kuru derlemesi ve üretim yayını başarılı oldu. Canlıdaki 12 arayüz dosyası yerel sürümle birebir doğrulandı; eşitleme erişilebilir, yetkisiz istekler reddediliyor. Kullanıcının gerçek verisiyle canlı YouTube bilgi alma düğmesi henüz denenmedi.

Mevcut adres: https://siradaki.alpargu37.workers.dev/
Cloudflare hesabı: alpargu37@gmail.com (beefe34643f0c3bfe450870b9e8adb19)

## Kullanım
Önce mevcut videolarının bulunduğu tarayıcıda yedek al. Tercihler > Cihazlar arası eşitleme bölümüne kurulumda verilen özel kodu gir. İlk başarılı eşitlemeden sonra telefon/tablette aynı adresi açıp aynı kodla bağlan. Liste, notlar, ilerleme, kurallar, dışlamalar, günlük planlar ve tercihler eşitlenir. Görünüm/arama/konum cihazda kalır.

Tercihler > İzlenen videoları dışla seçeneği %100 tamamlanan videoları kütüphaneden ve önerilerden kaldırır. Dışlananlar bölümünden ulaşılabilir. Notlar korunur; ayarı kapatmak bu dışlamayı geri alır. YouTube listesinde silme işlemi yapılmaz. Firefox eklentisi 1.1.1, kütüphane videolarında gerçek oynatma süresini ve kaldığın konumu günceller. Aynı Firefox profilinde açılan diğer normal YouTube videoları, günlük farklı video sayısına eklenir; kütüphaneye veya dakika toplamına eklenmez.

LaterLab 5.8, Kütüphanem ve Bu hafta ekranlarında bugünkü, bu haftaki ve bu ayki izlenen video sayılarını gösterir. Hafta Pazartesi başlar, ay takvim ayıdır; aynı video farklı günlerde izlenirse her gün için ayrı sayılır. Tarihler İstanbul saatine göredir ve önceki sürümün günlük kayıtlarından hesaplanır.

Aynı alana farklı cihazlardan yapılan değişikliklerde seçim istenir ve seçim öncesi yerel yedek indirilir. Farklı alanlar otomatik birleşir. Eşitleme uygulama açıkken, yerel değişiklikten sonra, bağlantı geri geldiğinde ve görünür sekmede dakikada bir çalışır. Açık uygulama bağlantısızken yerel kayıt sürer; kapalı uygulamayı internet olmadan yeniden açma desteği yoktur.

## Sunucu ve gizlilik
`public/` on iki arayüz dosyasıdır. Sunucu `sync-worker.mjs`, yapılandırma `wrangler.jsonc` dosyasıdır. SQLite Durable Object şifreli kaydı ve sürüm numarasını saklar. AES-GCM anahtarı özel koddan türetilir; sunucuya kod/anahtar gönderilmez. Sunucuya yalnız doğrulama belirteci ve şifreli veri gönderilir. Günlük sayım için kütüphane dışı videoların video kimliği ve günü yaklaşık 30 gün bu şifreli kayıtta tutulur; başlık, kanal, ilerleme ve dakika eklenmez. Kod cihazın IndexedDB deposunda tutulur, JSON yedeğine dahil edilmez. JSON yedekleri şifresizdir; güvenli saklanmalıdır.

Kodu bilen kütüphaneye erişebilir. Kodu kaybedersen bulut kopyası açılamaz; bağlı cihazdan kodu gösterebilir veya yerel yedek alabilirsin. Sunucu kurulumdaki tek koda izin verir. Cloudflare planının depolama/istek sınırları geçerlidir.

## Yayın
Statik ZIP yüklemek eşitlemeyi kurmaz. Wrangler ile bu klasörden yayın gerekir:
1. `wrangler login` ve `wrangler whoami`: yukarıdaki hesabı doğrula.
2. `wrangler deploy --keep-vars`: sunucuyu ve arayüzü yayınlar; paneldeki değişkenleri korur. Mevcut v1-library-sync SQLite nesnesini kullanır.
3. Yalnız ilk kurulumda `wrangler secret put SYNC_AUTH_HASH` ile özel kodun doğrulama özetini gir. Mevcut yayını güncellerken sırrı yeniden yazma. Rastgele bir değer girme; istemcinin türetimiyle eşleşmelidir.
4. `/api/sync-status` available=true olmalı; kod olmadan `/api/sync` 401 vermeli.

Özet üretimi: sync-core.mjs keysFor(code).auth değerinin UTF-8 SHA-256 hex özeti. Üretim kodunu/özeti public klasörüne, Git'e veya yayın paketine koyma. `.dev.vars` yalnız yerel test içindir. `worker.mjs` eski statik derlemedir; v5 yayınının giriş noktası değildir.

## Doğrulama — 19 Eylül 2026
12 test programı: içe aktarım, hesaplamalar, kayıt geri alma, eşzamanlı yerel kayıt, şifreleme, yanlış kod, alan bazlı birleştirme/çakışma, parçalı depolama, sunucuda atomik sürüm kontrolü ve izlenenleri dışlama geçti. Gerçek yerel Workers/SQLite HTTP testi geçti. İki bağımsız tarayıcı deposunda üç test videosu indirildi; dışlama bir cihazdan diğerine, not değişikliği ters yönde aktarıldı. %95 ilerleme korunurken %100 video dışlandı. Kullanıcının gerçek verisi test sunucusuna aktarılmadı.

## 5.2 bağlantı düzeltmesi — 20 Eylül 2026
Tercihler bölümündeki Kod dosyasını seç alanı verilen TXT dosyasını okuyup cihazı bağlar. Kodun açıklamalı dosyadan yapıştırılması, satır sonları ve görünmez boşluklar desteklenir. Eksik, fazla veya birden çok kod reddedilir. Tercihleri kaydet düğmesi girilen kodu da işler; başarısız bağlantıda kod ve hata açıklaması korunur. Boş cihaz, bilgisayarın ilk yüklemesini bağlı olarak bekler ve boş liste yüklemez.

13 test programı ve yerel gerçek tarayıcıda TXT seçerek eşitleme geçti. Aynı uygulama adresine yayınlandı; 10 canlı dosya ve doğru/yanlış kod yetkilendirmesi doğrulandı. Bu doğrulama kullanıcı verisini değiştirmedi.

## 5.3 — otomatik liste eklentisi desteği
İzle düğmesi artık doğrudan https://www.youtube.com/watch?v=... bağlantısını yeni sekmede açar. Gömülü oynatıcı kaldırıldı; eski kayıt yüzdesi YouTube'un kendi devam konumunu zorlamaz. Firefox eklentisinin yeni-video aktarımı için API kaynak kontrolü moz-extension kaynaklarını da kabul eder; aynı özel kod doğrulaması zorunludur. Eşitleme belgesi son YouTube kontrol sonucunu taşır ve Tercihler'de gösterir. 15 test programı geçti, canlı 10 dosya ve yetkili/yetkisiz eklenti istekleri doğrulandı. Firefox paketi Mozilla imzası ve gerçek hesapta ilk kurulum testini bekliyor.

## 5.4 — uzun video planı
Uzun video planım ekranı varsayılan olarak 45 dakika ve üzeri içerikten en yeni eklenen 3 videoyu seçer; yayın kayıtları dahildir. Her videoya 15 dakika ayrılır. Video sayısı 1–5, parça süresi 10/15 dakika ve uzun video eşiği 30/45/60/90 dakika olarak değiştirilebilir. Genel günlük seçki bütçesinden bağımsızdır.

Seçilen devam seti bitene kadar korunur; boşalan yerlere en yeni uygun video gelir. Gün İstanbul saatine göre yenilenir. Dışlanan, tamamlanan, erişilemeyen, ertelenen ve süresi bilinmeyen videolar seçilmez. İlk 1274 sınırı korunur.

YouTube bağlantısı kayıtlı saniyeden açılır. Oynatma otomatik durmaz. 5.4 sürümünde izleme süresi elle onaylanıyordu; Firefox eklentisi 1.1 ve sonrasında kütüphane videolarının gerçek oynatmasını otomatik ölçer. “Bu bölümü izledim” açık onayı ilerlemeyi, gerçek parça uzunluğunu ve gerekirse tamamlanmayı kaydeder; son parça video süresinde biter. Yinelenen aynı parça onayları aynı kayıt kimliğini kullanır. “Kaldığım dakikayı ayarla” tam saniye belirler; süre eklemez. İşlem sonrasında Geri al kullanılabilir. Bu hafta ekranından yanlış dakika kaydı silinebilir; bu, video ilerlemesini değiştirmez.

Plan, kesin konum ve parça kayıtları longWatch kök alanında taşınır; şifreli cihaz eşitlemesine ve JSON yedeklerine dahildir. Bu alanın Mozilla'ya gönderilmiş 1.0.0 Firefox eklentisinin mevcut derlenmiş paketiyle korunduğu ayrıca test edildi. İmzalama paketleri bu değişiklik için yeniden üretilmedi.
