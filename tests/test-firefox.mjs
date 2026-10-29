import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {collect,totalOf,newestItem} from '../firefox-extension/src/youtube.mjs';
import {addDelta,uploadDelta,cloudRequest} from '../firefox-extension/src/cloud.mjs';
import {newPairCode,keysFor,encryptDocument,decryptDocument,documentOf} from '../cloudflare/public/sync-core.mjs';
import {normalizeVideo} from '../cloudflare/public/core.mjs';
import {cleanStudio} from '../cloudflare/public/features.mjs';
import worker from '../cloudflare/sync-worker.mjs';
const id=n=>String(n).padStart(11,'0'),known=[id(1),id(2)],newId=id(3);
const config={INNERTUBE_CONTEXT:{client:{clientVersion:'test-version',visitorData:'visitor'}},DATASYNC_ID:'test-account',SESSION_INDEX:0};
globalThis.window={ytcfg:{get:key=>config[key]}};globalThis.location={origin:'https://www.youtube.com',href:'https://www.youtube.com/playlist?list=WL'};globalThis.document={cookie:'SAPISID=test-cookie'};
const page=(ids,{order='newest',total=3,next=null}={})=>({header:{playlistHeaderRenderer:{numVideosText:{simpleText:total+' video'}},sortFilterSubMenuRenderer:{subMenuItems:[{title:'Eklendiği tarih (en yeni)',selected:order==='newest',serviceEndpoint:{commandMetadata:{webCommandMetadata:{apiUrl:'/youtubei/v1/browse/edit_playlist'}},playlistEditEndpoint:{playlistId:'WL',actions:[{action:'ACTION_SET_PLAYLIST_VIDEO_ORDER',playlistVideoOrder:1}]}}},{title:'Eklendiği tarih (en eski)',selected:order==='oldest'}]}},contents:{playlistVideoListRenderer:{contents:[...ids.map((videoId,i)=>({playlistVideoRenderer:{videoId,title:{simpleText:'Learn '+videoId},index:{simpleText:String(i+1)},setVideoId:'entry-'+videoId,lengthText:{simpleText:'10:00'}}})),...(next?[{continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:next}}}}]:[])]}}});
assert.equal(totalOf(page(known,{total:3100})),3100);
assert.equal(totalOf({header:{playlistSidebarPrimaryInfoRenderer:{stats:[{simpleText:'3.100 video'}]}}}),3100);
assert.throws(()=>totalOf({header:{numVideosText:{simpleText:'3.1K videos'}}}));
assert.throws(()=>totalOf({header:{numVideosText:{simpleText:'3 videos'}},other:{numVideosText:{simpleText:'4 videos'}}}));
assert.throws(()=>newestItem({}));
let requests=[],sort='oldest',changes=0,drift=false,accountSwitch=false;
globalThis.fetch=async(path,options)=>{
  assert(!path.startsWith('http'),'YouTube requests must remain same-origin');assert.equal(options.credentials,'same-origin');
  const body=JSON.parse(options.body);requests.push({path,body});assert.match(options.headers.Authorization,/^SAPISIDHASH /);
  if(path.startsWith('/youtubei/v1/browse/edit_playlist')){assert.equal(body.actions.length,1);assert.equal(body.actions[0].action,'ACTION_SET_PLAYLIST_VIDEO_ORDER');sort='newest';changes++;return Response.json({});}
  if(accountSwitch)config.DATASYNC_ID='different-account';
  return Response.json(page([newId,...known],{order:sort,total:drift&&requests.length>1?4:3}));
};
const collected=await collect(known);assert.equal(changes,1);assert.equal(collected.delta.videos.length,1);assert.equal(collected.delta.videos[0].id,newId);assert.equal(collected.delta.total,3);assert.equal(requests.length,4);assert(!JSON.stringify(collected).includes('test-cookie'));assert(!JSON.stringify(collected).includes('test-account'));
const firstAccount=collected.account;await assert.rejects(collect(known,'a'.repeat(64)),/hesabı değişmiş/);
requests=[];drift=true;await assert.rejects(collect(known,firstAccount),/sayısı değişti/);drift=false;
requests=[];accountSwitch=true;await assert.rejects(collect(known,firstAccount),/hesabı veya sayfa değişti/);accountSwitch=false;config.DATASYNC_ID='test-account';
const base=documentOf({videos:known.map((x,i)=>normalizeVideo({id:x,title:'Keep title',position:i+1,libraryOrder:i+1,notes:'my note',starred:true,progress:61,progressSource:'manual',baselineExcluded:i===0})),studio:cleanStudio({excludeWatched:true}),settings:{count:3,budget:60,english:true},plans:{today:[id(2)]}});
const merged=addDelta(base,collected.delta);assert.equal(merged.added,1);assert.deepEqual(merged.document.videos.slice(0,2),base.videos);assert.deepEqual(merged.document.plans,base.plans);assert.equal(merged.document.studio.excludeWatched,true);assert.equal(addDelta(merged.document,collected.delta).added,0);
const code=newPairCode(),keys=await keysFor(code);let saved=base,revision=1,attempts=0,backups=0;
const cloudFetch=async(url,options)=>{assert.equal(url,'https://siradaki.alpargu37.workers.dev/api/sync');assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,'Bearer '+keys.auth);if(options.method==='PUT'){const body=JSON.parse(options.body);attempts++;if(attempts===1){saved=structuredClone(saved);saved.videos[0].notes='phone note';revision++;return Response.json({},{status:409});}assert.equal(body.expectedRevision,revision);saved=await decryptDocument(body.payload,keys.key);return Response.json({revision:++revision});}return Response.json({revision,payload:await encryptDocument(saved,keys.key)})};
const result=await uploadDelta(code,collected.delta,{fetcher:cloudFetch,backup:async payload=>{assert(!JSON.stringify(payload).includes('my note'));backups++}});assert.equal(result.added,1);assert.equal(saved.videos[0].notes,'phone note');assert.equal(saved.videos.length,3);assert.equal(attempts,2);assert.equal(backups,2);
await assert.rejects(uploadDelta(code,collected.delta,{fetcher:cloudFetch,stillAllowed:async()=>false}),/durduruldu/);
await assert.rejects(cloudRequest(code,'GET',undefined,async()=>Response.json({},{status:401})),/geçersiz/);
// Add-on origin remains behind the same owner credential check.
const authHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(keys.auth)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const env={SYNC_AUTH_HASH:authHash,LIBRARIES:{idFromName:x=>x,get:()=>({fetch:()=>Response.json({revision:1})})}};
const extensionOrigin='moz-extension://11111111-2222-3333-4444-555555555555';
assert.equal((await worker.fetch(new Request('https://laterlab.test/api/sync',{headers:{Origin:extensionOrigin,Authorization:'Bearer '+keys.auth}}),env)).status,200);
assert.equal((await worker.fetch(new Request('https://laterlab.test/api/sync',{headers:{Origin:extensionOrigin}}),env)).status,401);
assert.equal((await worker.fetch(new Request('https://laterlab.test/api/sync',{headers:{Origin:'https://other.test',Authorization:'Bearer '+keys.auth}}),env)).status,403);
// Validate the bundled collector actually exposes its entry point with no eval/remote code.
const bundled=fs.readFileSync(new URL('../firefox-extension/youtube.js',import.meta.url),'utf8'),sandbox={};vm.runInNewContext(bundled,sandbox);assert.equal(typeof sandbox.__laterlabCollect,'function');
const manifest=JSON.parse(fs.readFileSync(new URL('../firefox-extension/manifest.json',import.meta.url)));assert.deepEqual(manifest.permissions,['storage','alarms','scripting']);assert.equal(manifest.host_permissions.length,2);assert(!manifest.host_permissions.includes('<all_urls>'));
const playSource=fs.readFileSync(new URL('../cloudflare/public/app.mjs',import.meta.url),'utf8');assert(playSource.includes('href="https://www.youtube.com/watch?v=${v.id}'));assert(playSource.includes('&amp;t='));assert(!playSource.includes('<iframe'));assert(!playSource.includes('data-play='));
console.log('PASS Firefox: exact totals, newest sort command, count drift, account mismatch/change, no session leakage, new-only/idempotent merge, notes/baseline/plans preserved, cloud CAS retries preserve phone edits, pause, owner-auth extension origin, bundled entry and limited permissions.');

