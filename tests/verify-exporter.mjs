import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createPlaylistTools, exportWatchLater, bookmarklet} from '../cloudflare/public/exporter.mjs';
import {importSnapshot, exclusion} from '../cloudflare/public/core.mjs';

const kit = createPlaylistTools();
const item = (i, overrides={}) => ({playlistVideoRenderer:{videoId:String(i).padStart(11,'0'),setVideoId:'entry-'+i,index:{simpleText:String(i)},title:{runs:[{text:'How to learn '},{text:String(i)}]},shortBylineText:{runs:[{text:'Example'}]},lengthText:{simpleText:'10:30'},...overrides}});
const continuation = token => ({continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token}}}});
const sort = (order=2) => ({sortFilterSubMenuRenderer:{subMenuItems:[{title:'Date added (oldest)',selected:true,serviceEndpoint:{playlistEditEndpoint:{actions:[{action:'ACTION_SET_PLAYLIST_VIDEO_ORDER',playlistVideoOrder:order}]}}}]}});
function fixture(start=1, end=100, total=3100, head=false) {
  const items = Array.from({length:end-start+1},(_,i)=>item(start+i));
  if (end < total) items.push(continuation('page-'+(end+1)));
  return head ? {header:sort(),contents:{sectionListRenderer:{contents:[{itemSectionRenderer:{contents:[{playlistVideoListRenderer:{contents:items}}]}}]}}} : {onResponseReceivedActions:[{appendContinuationItemsAction:{targetId:'playlist-video-list',continuationItems:items}}]};
}
function fakeRequest({total=3100, hook=()=>{}}={}) {
  const calls = [];
  const request = async body => {
    calls.push(body); const start = body.continuation ? Number(body.continuation.slice(5)) : 1;
    const data = fixture(start,Math.min(start+99,total),total,!body.continuation);
    return await hook(data,body,calls.length) || data;
  };
  return {request,calls};
}

const base = fakeRequest(), cp = {};
const result = await kit.scan({request:base.request,expected:3100,checkpoint:cp});
assert.equal(result.videos.length,3100); assert.equal(base.calls.length,32); assert.equal(cp.pages,31);
assert.equal(result.method,'innertube-v3'); assert.equal(result.videos[1273].position,1274);
assert.equal(result.videos[1274].position,1275);
assert.equal(importSnapshot(result).filter(v=>!exclusion(v)).length,1826);
assert(!JSON.stringify(result).includes('entryKey')); assert(!JSON.stringify(result).includes('continuation'));

const sample = fixture(1,2,2,true);
const list = sample.contents.sectionListRenderer.contents[0].itemSectionRenderer.contents[0].playlistVideoListRenderer.contents;
list[0] = item(1,{thumbnailOverlays:[{thumbnailOverlayResumePlaybackRenderer:{percentDurationWatched:42}}]});
list[1] = item(2,{videoId:undefined,title:{simpleText:'Deleted video'}});
const parsed = kit.page(sample);
assert.equal(parsed.rows[0].progress,42); assert.equal(parsed.rows[1].progress,null); assert.equal(parsed.rows[1].id,null);
assert.equal(parsed.rows[0].title,'How to learn 1');
const legacy = {continuationContents:{playlistVideoListContinuation:{contents:[item(1)],continuations:[{nextContinuationData:{continuation:'next'}}]}}};
assert.equal(kit.page(legacy).next,'next');
const reload = {onResponseReceivedEndpoints:[{reloadContinuationItemsCommand:{targetId:'playlist-video-list',continuationItems:[item(1)]}}]};
assert.equal(kit.page(reload).rows.length,1);
const withRecommendations = structuredClone(reload);
withRecommendations.onResponseReceivedEndpoints.push({appendContinuationItemsAction:{targetId:'playlist-recommendations',continuationItems:[item(9999),continuation('wrong')]}});
assert.equal(kit.page(withRecommendations).rows.length,1); assert.equal(kit.page(withRecommendations).next,null);
assert.throws(()=>kit.page({contents:{playlistVideoListRenderer:{contents:[{newUnknownRenderer:{}}]}}}),/tanınmayan/);
assert.throws(()=>kit.assertOldest({header:sort(1)}),/sıralaması/);
assert.throws(()=>kit.assertOldest({}),/sıralaması/);
kit.assertOldest({header:{sortFilterSubMenuRenderer:{subMenuItems:[{title:{simpleText:'Eklendiği tarih (en eski)'},selected:true}]}}});
for (const [name,hook,pattern] of [
  ['wrong order',(data,body)=>{if(!body.continuation)data.header=sort(1);},/sıralaması/],
  ['index gap',(data,body)=>{if(body.continuation==='page-101')data.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems[0].playlistVideoRenderer.index.simpleText='102';},/boşluk/],
  ['duplicate video',(data,body)=>{if(body.continuation==='page-101')data.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems[0].playlistVideoRenderer.videoId='00000000001';},/Tekrarlanan/],
  ['sort changes at finish',(data,body,n)=>{if(n===32)data.header=sort(1);},/sıralaması/],
  ['head changes at finish',(data,body,n)=>{if(n===32)data.contents.sectionListRenderer.contents[0].itemSectionRenderer.contents[0].playlistVideoListRenderer.contents[0]=item(1,{videoId:'newnewnew00'});},/değişti/]
]) {
  const server=fakeRequest({hook});
  await assert.rejects(kit.scan({request:server.request,expected:3100,checkpoint:{}}),pattern,name);
}
await assert.rejects(kit.scan({request:fakeRequest({total:3000}).request,expected:3100,checkpoint:{}}),/eksik/);
await assert.rejects(kit.scan({request:fakeRequest().request,expected:3000,checkpoint:{}}),/daha fazla/);

let fail = true;
const flaky = fakeRequest({hook:(data,body)=>{if(fail && body.continuation==='page-201')throw Error('offline');}}), saved = {};
await assert.rejects(kit.scan({request:flaky.request,expected:3100,checkpoint:saved}),/offline/);
assert.equal(saved.rows.length,200); fail=false;
assert.equal((await kit.scan({request:flaky.request,expected:3100,checkpoint:saved})).videos.length,3100);
assert.equal(flaky.calls.filter(b=>b.continuation==='page-101').length,1);
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(kit.scan({request:base.request,expected:3100,checkpoint:{},signal:cancelled.signal}),{name:'AbortError'});
const looping = fakeRequest({hook:(data,body)=>{if(body.continuation==='page-101'){const items=data.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems;items[items.length-1]=continuation('page-101');}}});
await assert.rejects(kit.scan({request:looping.request,expected:3100,checkpoint:{}}),/tekrarladı/);

// Execute the actual exported bookmark in an isolated fake browser, including
// authentication, fetch, UI, download and cancellation. No real account data.
function fakeBrowser({fetchHook, origin='https://www.youtube.com'}={}) {
  const nodes=[], downloads=[], calls=[], alerts=[];
  const body={append(el){nodes.push(el);}};
  function element(tag){return {tag,style:{},children:[],append(el){this.children.push(el);nodes.push(el);},setAttribute(){},remove(){this.removed=true;},click(){if(tag==='a')downloads.push(this.href);}};}
  const urlClass=class extends URL {static createObjectURL(blob){downloads.push(blob);return 'blob:fixture';} static revokeObjectURL(){}};
  const server=fakeRequest();
  const cfg={INNERTUBE_CONTEXT:{client:{clientName:'WEB',clientVersion:'fixture-version'}},SESSION_INDEX:1,INNERTUBE_CONTEXT_CLIENT_NAME:1};
  const sandbox={URL:urlClass,Blob,AbortController,DOMException,TextEncoder,Uint8Array,crypto:webcrypto,Date,
    location:{origin,href:origin+'/playlist?list=WL'},
    document:{body,cookie:'SAPISID=synthetic-session-only',getElementById(){return null;},querySelector(){return null;},createElement:element},
    window:{ytcfg:{get:key=>cfg[key]}},prompt:()=> '3100',alert:s=>alerts.push(s),
    setTimeout:(fn,ms)=>{if(ms===60000)return 0;return setTimeout(fn,ms);},clearTimeout,
    fetch:async (url,options)=>{
      calls.push({url,options});
      assert.equal(url,'/youtubei/v1/browse?prettyPrint=false');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');
      assert.equal(options.headers['X-Goog-Authuser'],'1');assert.match(options.headers.Authorization,/^SAPISIDHASH \d+_[a-f0-9]{40}$/);
      const custom=await fetchHook?.(options,nodes,cfg);if(custom)return custom;
      return {ok:true,json:()=>server.request(JSON.parse(options.body))};
    }};
  return {sandbox,nodes,downloads,calls,alerts};
}
const browser=fakeBrowser();
const script=decodeURIComponent(bookmarklet.slice('javascript:'.length));
new vm.Script(script); // Ensure encoded bookmark serializes without module imports.
const context=vm.createContext(browser.sandbox);
// Capture the async task while using exactly the function expressions in the URL.
await vm.runInContext(script.replace(/^void /,''),context);
assert.equal(browser.calls.length,32);assert.equal(browser.downloads.length,2);
const exportedText=await browser.downloads[0].text();
assert(!exportedText.includes('synthetic-session'));assert(!exportedText.includes('SAPISID'));assert(!exportedText.includes('context'));
assert.equal(JSON.parse(exportedText).videos.length,3100);
assert(browser.nodes.some(n=>n.textContent?.includes('3100 video hazır')));
const denied=fakeBrowser({fetchHook:()=>({ok:false,status:403})});
await vm.runInNewContext(script.replace(/^void /,''),denied.sandbox);
assert.equal(denied.calls.length,1);assert.equal(denied.downloads.length,0);
assert(denied.nodes.some(n=>n.textContent?.includes('oturumu isteği reddetti')));
const switched=fakeBrowser({fetchHook:async(options,nodes,cfg)=>{cfg.SESSION_INDEX=2;}});
await vm.runInNewContext(script.replace(/^void /,''),switched.sandbox);
assert.equal(switched.downloads.length,0);
const stopped=fakeBrowser({fetchHook:async(options,nodes)=>{nodes.find(n=>n.textContent==='İptal et').onclick();}});
await vm.runInNewContext(script.replace(/^void /,''),stopped.sandbox);
assert.equal(stopped.calls.length,1);assert.equal(stopped.downloads.length,0);
const wrongSite=fakeBrowser({origin:'https://example.org'});
await vm.runInNewContext(script.replace(/^void /,''),wrongSite.sandbox);
assert.equal(wrongSite.calls.length,0);assert.equal(wrongSite.alerts.length,1);
console.log('PASS: 3,100 entries / 31 data pages + 1 verification; cutoff, progress, unavailable rows, recommendations, legacy/reload, duplicates, gaps, sort drift, missing/extra counts, loops, resume, encoded bookmark execution, same-origin auth, no credentials in export, denied auth, account switch and cancellation.');
