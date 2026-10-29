import assert from 'node:assert/strict';
import {exclusion,normalizeVideo,recommend} from '../cloudflare/public/core.mjs';
const v=(title,channel='',tags=[])=>normalizeVideo({id:'00000009999',title,channel,tags});
const titles=['Cümlenin Ögeleri','Paragrafta Ana Düşünce','Türev - 1','Polinomlar 3','Soru çözmeden izleme','Sorusu çok çıkan konular','Soruları beraber inceleyelim','Sorular ve cevaplar','📚 SORULAR: 15','MSÜ 2026','2026MSÜ soruları','Harika bir video #ayt','#yks2026 #tytmatematik','Kimya #AYT #YKS #TYT','TYT2026','9. sınıf fizik','12.sınıf İngilizce','Paragraf taktikleri','Fonksiyonlar konu anlatımı','Türev soru çözümü','Matematik kampı','Fizik ders 5','Türkçe yazılı hazırlığı','Trigonometri tekrar','Dil bilgisi test çözümü','Geometri çözümlü sorular','[Private video]','[Deleted video]','Gizli video','Silinmiş video','Kullanılamayan video','LARS yeni video','TaoWB yayın özeti'];
for(const title of titles)assert(exclusion(v(title)),title);
for(const channel of ['Rüştü Hoca ile Türkçe','RÜŞTÜ HOCA İLE TÜRKÇE','@rustuhocaileturkce','LynxÇerezzTw','Vechiron','TaoWB','LARS','@LARS'])assert(exclusion(v('Bugün beraberiz',channel)),channel);
for(const title of ['How to learn Python','Matematiğin tarihi','Fizik evreni nasıl açıklar','JavaScript konu anlatımı','Sorun çözme sanatı','Scholars discuss science','Gizli video nasıl yüklenir?','Silinmiş video kurtarma rehberi'])assert.equal(exclusion(v(title)),'',title);
assert(exclusion(v('Başlık','','#tyt'.split(' '))));
assert(exclusion({...v('Eski başlık'),availability:'deleted'}));
assert.equal(exclusion({...v('MSÜ'),baselineExcluded:true}),'İlk 1274');
assert.equal(recommend(titles.map((t,i)=>({...v(t),id:String(i).padStart(11,'0')}))).length,0);
console.log(`PASS: ${titles.length} excluded titles, 8 channel variants, 8 unrelated titles retained, tags/status/baseline and recommendations.`);

