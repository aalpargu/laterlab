import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizeVideo,dayKey,importSnapshot} from '../cloudflare/public/core.mjs';
import {cleanStudio,cleanLongWatch,prepareLongPlan,completeLongSegment,longPosition,setLongPosition,weekSummary,shiftDay,reason} from '../cloudflare/public/features.mjs';
import {documentOf,mergeDocuments,newPairCode,keysFor,encryptDocument,decryptDocument} from '../cloudflare/public/sync-core.mjs';
const today=dayKey(),id=n=>String(n).padStart(11,'0');
const video=(n,extra={})=>normalizeVideo({id:id(n),title:'Uzay keşfi '+n,duration:5400,libraryOrder:n,progress:0,...extra});
const state=()=>({videos:[video(1),video(2,{type:'live'}),video(3),video(4),video(5,{duration:null}),video(6,{duration:600}),video(7,{hidden:true}),video(8,{baselineExcluded:true}),video(9,{progress:100}),video(10,{availability:'private'})],studio:cleanStudio(),settings:{count:3,budget:60},plans:{},history:{}});
const s=state();s.studio.mode='light';
// Watched exclusion must retain unfinished long videos and replays, even very near the end.
for(const type of ['video','live'])for(const progress of [0,25,95,99,99.999]){
  const partial=state();partial.studio.excludeWatched=true;partial.videos=[video(1,{duration:21600,type,progress,notes:'Keep this note'})];
  assert.equal(reason(partial.videos[0],partial.studio),'');
  const plan=prepareLongPlan(partial,today);assert.deepEqual(plan.ids,[id(1)]);
  const slice=plan.segments[id(1)];completeLongSegment(partial,id(1),{date:today,...slice});
  const finished=slice.end===21600;
  assert.equal(!!reason(partial.videos[0],partial.studio),finished);
  assert.equal(partial.videos.length,1);assert.equal(partial.videos[0].notes,'Keep this note');
  partial.studio.excludeWatched=false;assert.equal(reason(partial.videos[0],partial.studio),'');
}
let p=prepareLongPlan(s,today);assert.deepEqual(p.ids,[id(4),id(3),id(2)]);assert.equal(p.segments[id(2)].end,900);assert.equal(s.videos[3].progress,0);assert.equal(Object.keys(s.longWatch.logs).length,0);
// New imports do not replace an unfinished set; completion needs an explicit confirmation.
s.videos.push(video(11));prepareLongPlan(s,today);assert.deepEqual(s.longWatch.plans[today].ids,p.ids);
assert.throws(()=>completeLongSegment(s,id(4),{date:today,start:0,end:600}),/değişti/);
assert.equal(completeLongSegment(s,id(4),{date:today,start:0,end:900}),true);
assert.equal(completeLongSegment(s,id(4),{date:today,start:0,end:900}),false);
assert.equal(Object.keys(s.longWatch.logs).length,1);assert.equal(weekSummary(s.studio,today,s.longWatch).minutes,15);
assert.equal(longPosition(s.videos[3],s.longWatch),900);
p=prepareLongPlan(s,shiftDay(today,1));assert.deepEqual(p.ids,[id(4),id(3),id(2)]);assert.equal(p.segments[id(4)].start,900);assert.equal(p.segments[id(4)].end,1800);
// Imported percentages are only a starting estimate; manual position is exact and import-safe.
setLongPosition(s,s.videos[3],'1:23:40');assert.equal(longPosition(s.videos[3],s.longWatch),5020);
assert.throws(()=>setLongPosition(s,s.videos[3],'23:99'));assert.throws(()=>setLongPosition(s,s.videos[3],'2:00:00'));
s.videos[3].progress=20;assert.equal(longPosition(s.videos[3],s.longWatch),1080);
const tail=state();tail.videos=[video(1,{duration:2707,progress:99,language:'en'})];tail.studio.excludeWatched=true;
p=prepareLongPlan(tail,today);const segment=p.segments[id(1)];assert.equal(segment.end-segment.start,28);
completeLongSegment(tail,id(1),{date:today,...segment});assert.equal(tail.videos[0].progress,100);assert.equal(tail.longWatch.logs[`long:${today}:${id(1)}:${segment.start}:${segment.end}`].seconds,28);
assert.equal(weekSummary(tail.studio,today,tail.longWatch).englishMinutes,0.47);assert.equal(weekSummary(tail.studio,today,tail.longWatch).completed,1);
prepareLongPlan(tail,today);assert.equal(tail.longWatch.plans[today].segments[id(1)].done,true);assert.deepEqual(prepareLongPlan(tail,shiftDay(today,1)).ids,[]);
// Settings change only pending ranges; decreasing count cannot erase today's confirmations.
const settings=state();prepareLongPlan(settings,today);completeLongSegment(settings,id(4),{date:today,start:0,end:900});settings.longWatch.preferences={count:1,minutes:10,minimum:60};p=prepareLongPlan(settings,today);assert.deepEqual(p.ids,[id(4)]);assert.equal(p.segments[id(4)].end,900);
settings.longWatch.preferences.count=3;p=prepareLongPlan(settings,today);assert.equal(p.segments[id(3)].end,600);
settings.studio.feedback[id(3)]={kind:'later',until:shiftDay(today,7)};p=prepareLongPlan(settings,today);assert(!p.ids.includes(id(3)));assert(p.ids.includes(id(1)));
const malformed=cleanLongWatch({preferences:{count:99,minutes:-1},plans:{[today]:{ids:[id(1)],segments:{[id(1)]:{start:500,end:400}}}}});assert.equal(malformed.preferences.minutes,15);assert.deepEqual(malformed.plans[today].ids,[]);
// Two devices confirming the same segment must not double the recorded minutes.
const shared=state();prepareLongPlan(shared,today);const base=documentOf(shared),a=structuredClone(base),b=structuredClone(base);
completeLongSegment(a,id(4),{date:today,start:0,end:900});completeLongSegment(b,id(4),{date:today,start:0,end:900});let merged=mergeDocuments(base,a,b);assert.equal(merged.conflicts.length,0);assert.equal(Object.keys(merged.document.longWatch.logs).length,1);
// Independent video work merges; conflicting endpoints must never form a hybrid.
completeLongSegment(b,id(3),{date:today,start:0,end:900});merged=mergeDocuments(base,a,b);assert.equal(Object.keys(merged.document.longWatch.logs).length,2);
const x=structuredClone(base),y=structuredClone(base);x.longWatch.plans[today].segments[id(4)]={start:0,end:600,done:false};y.longWatch.plans[today].segments[id(4)].done=true;merged=mergeDocuments(base,x,y);assert(merged.conflicts.some(c=>c.endsWith('segments.'+id(4))));assert.deepEqual(merged.document.longWatch.plans[today].segments[id(4)],x.longWatch.plans[today].segments[id(4)]);
const key=(await keysFor(newPairCode())).key;assert.deepEqual(await decryptDocument(await encryptDocument(documentOf(settings),key),key),documentOf(settings));assert.deepEqual(cleanLongWatch(JSON.parse(JSON.stringify(settings)).longWatch),settings.longWatch);
// The already-submitted extension bundle (v1.0.0) must retain the new root state.
let old=fs.readFileSync('firefox-extension/background.js','utf8');old=old.replace(/\}\)\(\);\s*$/, 'globalThis.__addDelta=addDelta;})();');
const noop=()=>{},browser={runtime:{onMessage:{addListener:noop},onStartup:{addListener:noop},onInstalled:{addListener:noop}},action:{onClicked:{addListener:noop}},alarms:{onAlarm:{addListener:noop}},storage:{local:{get:async()=>({})},session:{get:async()=>({})}}};
const context={browser,TextEncoder,TextDecoder,crypto,console,structuredClone,URL,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(old,context);
const delta={format:'siradaki-delta-v1',scope:'new-only',order:'newest',complete:true,scanned:2,total:settings.videos.length+1,stopReason:'known-page',baseIds:settings.videos.map(v=>v.id),matchedIds:[settings.videos[0].id],videos:[{id:id(20),title:'New video',duration:600}]};
const updated=context.__addDelta(documentOf(settings),delta).document;assert.deepEqual(updated.longWatch,documentOf(settings).longWatch);assert.equal(updated.videos.find(v=>v.id===id(4)).progress,settings.videos[3].progress);
console.log('PASS long video plan: newest first, ongoing set, replay inclusion, exclusions, exact offsets, short final slice, explicit/idempotent confirmation, settings, deferral, backup/encryption, cross-device merge, old extension preservation.');

