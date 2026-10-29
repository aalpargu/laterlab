import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createPlaylistTools,incrementalBookmarklet} from '../cloudflare/public/exporter.mjs';
import {importSnapshot,importDelta,syncReference,exclusion} from '../cloudflare/public/core.mjs';
const kit=createPlaylistTools(),id=n=>String(n).padStart(11,'0');
const snapshot={format:'siradaki-export-v1',order:'oldest',complete:true,total:3087,videos:Array.from({length:3087},(_,i)=>({id:id(i+1),position:i+1,title:'How to learn Python',progress:null}))};
const existing=importSnapshot(snapshot),reference=syncReference(existing),knownIds=reference.ids;
assert.deepEqual(kit.referenceIds(reference),knownIds);
assert.deepEqual(kit.referenceIds(snapshot),knownIds);
assert.deepEqual(kit.referenceIds({format:'siradaki-backup-v1',videos:existing}),knownIds);
assert.throws(()=>kit.referenceIds({...snapshot,complete:false}));
assert.throws(()=>kit.referenceIds({...reference,ids:[id(1),id(1)]}));
function server(ids,{pageSize=100,order='newest',hook=()=>{}}={}){
  const calls=[];
  return {calls,request:async body=>{
    calls.push(body); const start=body.continuation?Number(body.continuation):0;
    const contents=ids.slice(start,start+pageSize).map((v,i)=>({playlistVideoRenderer:{videoId:v,index:{simpleText:String(start+i+1)},title:{simpleText:'How to learn Python'},setVideoId:'entry-'+(start+i+1)}}));
    if(start+pageSize<ids.length)contents.push({continuationItemRenderer:{continuationEndpoint:{commandExecutorCommand:{commands:[{continuationCommand:{token:String(start+pageSize)}}]}}}});
    const result=body.continuation?{onResponseReceivedActions:[{appendContinuationItemsAction:{targetId:'playlist-video-list',continuationItems:contents}}]}:{header:{sortFilterSubMenuRenderer:{subMenuItems:[{title:order==='newest'?'Eklendiği tarih (en yeni)':'Eklendiği tarih (en eski)',selected:true}]}},contents:{playlistVideoListRenderer:{contents}}};
    return await hook(result,body,calls.length)||result;
  }};
}
const oldNewest=[...knownIds].reverse();
const newIds=Array.from({length:12},(_,i)=>id(4000+i));
const testServer=server([...newIds,...oldNewest]);
const delta=await kit.scanNew({request:testServer.request,knownIds,expected:3099,checkpoint:{}});
assert.equal(testServer.calls.length,3); // 2 data pages + fresh-head verification
assert.equal(delta.scanned,200);assert.equal(delta.videos.length,12);assert.equal(delta.stopReason,'known-page');
assert.equal(testServer.calls.some(c=>c.continuation==='200'),false);
const edited=structuredClone(existing);edited[2000].notes='keep';edited[2000].language='tr';edited[2000].progress=55;edited[2000].progressSource='manual';
const merged=importSnapshot(delta,edited);
assert.equal(merged.length,3099);assert.deepEqual(merged.slice(0,3087),edited);
assert.equal(merged.filter(v=>v.baselineExcluded).length,1274);assert.equal(merged[3087].position,null);
assert.equal(merged[3087].baselineExcluded,false);
assert.deepEqual(importDelta(delta,merged),merged); // repeat import is a no-op
assert.throws(()=>importDelta(delta,[]),/ilk aktarım/);
assert.throws(()=>importDelta(delta,existing.slice(1)),/farklı/);
for(const broken of [{...delta,complete:false},{...delta,scope:'full'},{...delta,order:'oldest'},{...delta,matchedIds:[]},{...delta,matchedIds:[id(9999)]},{...delta,scanned:1},{...delta,videos:[delta.videos[0],delta.videos[0]]},{...delta,videos:[{id:id(1)}]}])assert.throws(()=>importDelta(broken,existing));
const excluded=importDelta({...delta,videos:[{...delta.videos[0],title:'League of Legends'}]},existing);
assert.equal(exclusion(excluded.at(-1)),'League of Legends');

const noNew=server(oldNewest),noNewResult=await kit.scanNew({request:noNew.request,knownIds,expected:3087,checkpoint:{}});
assert.equal(noNew.calls.length,2);assert.equal(noNewResult.videos.length,0);assert.deepEqual(importDelta(noNewResult,edited),edited);
const many=Array.from({length:250},(_,i)=>id(5000+i)),manyServer=server([...many,...oldNewest]);
assert.equal((await kit.scanNew({request:manyServer.request,knownIds,expected:3337,checkpoint:{}})).videos.length,250);assert.equal(manyServer.calls.length,5);
// A known video re-added at the front must not stop before following new IDs.
const readded=server([oldNewest[200],...newIds,...oldNewest.filter(v=>v!==oldNewest[200])]);
assert.equal((await kit.scanNew({request:readded.request,knownIds,expected:3099,checkpoint:{}})).videos.length,12);
const small=server([...newIds,...oldNewest.slice(0,5)]);
const smallDelta=await kit.scanNew({request:small.request,knownIds,expected:17,checkpoint:{}});
assert.equal(smallDelta.stopReason,'end');assert.equal(importDelta(smallDelta,existing).length,3099);
await assert.rejects(kit.scanNew({request:server(newIds).request,knownIds,expected:12,checkpoint:{}}),/ortak video/);
await assert.rejects(kit.scanNew({request:server(oldNewest,{order:'oldest'}).request,knownIds,expected:3087,checkpoint:{}}),/En yeni/);
await assert.rejects(kit.scanNew({request:server(newIds).request,knownIds,expected:13,checkpoint:{}}),/eksik/);
const drift=server([...newIds,...oldNewest],{hook:(data,body,n)=>{if(n===3)data.header.sortFilterSubMenuRenderer.subMenuItems[0].title='Eklendiği tarih (en eski)';}});
await assert.rejects(kit.scanNew({request:drift.request,knownIds,expected:3099,checkpoint:{}}),/En yeni/);
let offline=true;const cp={};const interrupted=server([...many,...oldNewest],{hook:(data,body)=>{if(offline&&body.continuation==='100')throw Error('offline');}});
await assert.rejects(kit.scanNew({request:interrupted.request,knownIds,expected:3337,checkpoint:cp}),/offline/);assert.equal(cp.rows.length,100);
offline=false;assert.equal((await kit.scanNew({request:interrupted.request,knownIds,expected:3337,checkpoint:cp})).videos.length,250);
const abort=new AbortController();abort.abort();await assert.rejects(kit.scanNew({request:noNew.request,knownIds,expected:3087,checkpoint:{},signal:abort.signal}),{name:'AbortError'});

// Execute the actual new bookmark with the file picker and authenticated transport.
const nodes=[],blobs=[],requests=[];const transport=server([...newIds,...oldNewest]);
const element=tag=>({tag,style:{},append(el){nodes.push(el);},setAttribute(){},remove(){},click(){}});
const cfg={INNERTUBE_CONTEXT:{client:{clientVersion:'test'}},SESSION_INDEX:0};
const URLFake=class extends URL{static createObjectURL(blob){blobs.push(blob);return 'blob:test';}static revokeObjectURL(){}};
const sandbox={URL:URLFake,Blob,AbortController,DOMException,TextEncoder,Uint8Array,crypto:webcrypto,Date,
  location:{origin:'https://www.youtube.com',href:'https://www.youtube.com/playlist?list=WL'},
  window:{ytcfg:{get:key=>cfg[key]}},document:{body:{append(el){nodes.push(el);}},cookie:'SAPISID=fake-secret',createElement:element,getElementById(){return null;},querySelector(){return null;}},
  prompt:()=> '3099',alert:()=>assert.fail('unexpected alert'),setTimeout:(fn,ms)=>ms===60000?0:setTimeout(fn,ms),clearTimeout,
  fetch:async(url,options)=>{requests.push(url);assert.equal(url,'/youtubei/v1/browse?prettyPrint=false');const body=JSON.parse(options.body);assert(!('baseIds' in body));assert(!('knownIds' in body));return {ok:true,json:()=>transport.request(body)};}};
await vm.runInNewContext(decodeURIComponent(incrementalBookmarklet.slice(11)).replace(/^void /,''),sandbox);
assert.equal(requests.length,0); // Nothing goes to YouTube before file choice.
const input=nodes.find(n=>n.tag==='input');assert(input);
input.files=[{size:200,text:async()=>JSON.stringify(reference)}];await input.onchange();
assert.equal(requests.length,3);assert.equal(blobs.length,1);
const file=await blobs[0].text();assert(!file.includes('fake-secret'));assert.equal(JSON.parse(file).videos.length,12);
assert(nodes.some(n=>n.textContent?.startsWith('12 yeni video hazır')));
console.log('PASS: incremental scan, no-new/many-new/re-added records, known-page stop, wrong order/account/reference, count mismatch, cancellation/resume, idempotent import, preserved 1–1274/manual edits, file-picker bookmark end-to-end (mock). 12 new / 3087 existing => 2 data pages + 1 verification.');
