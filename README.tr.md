# LaterLab

YouTube Daha Sonra İzle arşivini düzenlemek, not ve etiket eklemek, günlük izleme planları yapmak için geliştirdiğim kişisel uygulama. Web uygulaması ile Firefox eklentisi birlikte çalışır.

[English and detailed setup](README.md)

## Teknoloji

JavaScript modülleri, Firefox WebExtensions, Web Crypto, Cloudflare Workers ve SQLite Durable Objects.

## Çalıştırma

`npm test` ile 22 taşınabilir test programı çalışır. Eklenti paketlerini yeniden üretmek için `npm ci` ve `npm run build:extension` kullanılır. Web geliştirmesi: `npx wrangler dev --config cloudflare/wrangler.jsonc`.

## Kapsam ve durum

Başlık/kanal/not/etiket araması ve isteğe bağlı açıklama araması metin tabanlıdır. Konuşma dökümü aranmaz. Firefox dışındaki cihazların izleme geçmişi otomatik alınmaz. Kişisel arşivler ve eşitleme kodları repoya dahil değildir.
