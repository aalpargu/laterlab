import assert from 'node:assert/strict';
import {matchVideoSearch,prepareSearchQuery,searchVideos} from '../cloudflare/public/content-search.mjs';

const videos=[
  {id:'turkish-title',title:'Türk borsasında yatırım',channel:'Örnek kanal'},
  {id:'turkish-description',title:'Haftalık piyasa değerlendirmesi',channel:'Örnek kanal',description:'Türkiye Borsa İstanbul şirketleri ve BIST 100 üzerine güncel değerlendirme.'},
  {id:'general',title:'Borsa nasıl çalışır?',channel:'Örnek kanal',description:'Hisse alım satımının temel kavramları.'},
  {id:'cross-field',title:'Borsa rehberi',channel:'Örnek kanal',notes:'Türkiye üzerine bir bölüm.'},
  {id:'other-topic',title:'Antik kent gezisi',channel:'Tarih kanalı',description:'Roma forumu ve antik mimari.'},
];

assert.deepEqual(searchVideos(videos,'borsa').map(row=>row.video.id),['general','cross-field','turkish-title','turkish-description']);
assert.deepEqual(searchVideos(videos,'Türk borsası').map(row=>row.video.id),['turkish-title','turkish-description','cross-field']);
assert(!matchVideoSearch(videos[2],'Türk borsası'));
assert(matchVideoSearch(videos[4],'antik roma'));
assert(!matchVideoSearch(videos[4],'borsa'));

const cross=matchVideoSearch(videos[3],prepareSearchQuery('Türk borsası'));
assert.equal(cross.evidence.length,2);
assert(cross.evidence.some(item=>item.field==='title'));
assert(cross.evidence.some(item=>item.field==='notes'));

const tags={title:'Piyasa sohbeti',tags:['yerel ekonomi'],creatorTags:['Türk borsası','BIST']};
assert.equal(matchVideoSearch(tags,'türk borsası').evidence[0].field,'creatorTags');
assert.equal(matchVideoSearch({...tags,creatorTags:[]},'yerel ekonomi').evidence[0].field,'tags');

const metadata=new Map([['cached',{description:'Türk borsası ve BIST 100 üzerine bir değerlendirme.',creatorTags:['İstanbul']}]]);
const cachedVideo={id:'cached',title:'Haftalık değerlendirme',channel:'Örnek kanal'};
assert.equal(matchVideoSearch(cachedVideo,'Türk borsası',metadata).evidence[0].field,'description');
assert.equal(searchVideos([cachedVideo],'İstanbul',{cached:metadata.get('cached')})[0].evidence[0].field,'creatorTags');
metadata.set('cached',{description:'Antik Roma mimarisi.',creatorTags:[]});
assert(!matchVideoSearch(cachedVideo,'Türk borsası',metadata));
assert(matchVideoSearch(cachedVideo,'antik roma',metadata));

const withBoilerplate={title:'Genel piyasa videosu',description:'Dünya piyasaları ele alınıyor.\nhttps://example.test/turk-borsasi\n#borsa #Türk #yatırım #borsa #finans'};
const contentFirst={title:'Genel piyasa videosu',description:'Türk borsası ve BIST 100 şirketlerinin performansı.'};
assert(!matchVideoSearch({...withBoilerplate,description:'Dünya piyasaları ele alınıyor.\nhttps://example.test/turk-borsasi'},'Türk borsası'));
assert(matchVideoSearch(contentFirst,'Türk borsası').score>matchVideoSearch(withBoilerplate,'Türk borsası').score);

const editable={title:'Bir video',description:'Makine öğrenmesi hakkında.'};
assert(matchVideoSearch(editable,'makine öğrenmesi'));
editable.description='Antik Roma hakkında.';
assert(!matchVideoSearch(editable,'makine öğrenmesi'));
assert(matchVideoSearch(editable,'antik roma'));

assert.deepEqual(searchVideos(videos,''),[]);
assert.equal(matchVideoSearch({title:'Örnek'},''),null);
console.log('PASS: metadata content search');
