import assert from 'node:assert/strict';
import {normalizeVideo,dayKey} from '../cloudflare/public/core.mjs';
import {cleanStudio,cleanLongWatch,prepareLongPlan,applyPlayback,longPosition,weekSummary,watchedToday,watchedPeriod,setLongPosition,completeLongSegment} from '../cloudflare/public/features.mjs';
import {documentOf,newPairCode,keysFor,encryptDocument,decryptDocument,mergeDocuments} from '../cloudflare/public/sync-core.mjs';
import {uploadPlayback} from '../firefox-extension/src/cloud.mjs';
import {measure} from '../firefox-extension/src/playback.mjs';
const id='00000000001',today=dayKey();
const original={videos:[normalizeVideo({id,title:'Space documentary',duration:5400,progress:0,notes:'Preserve',language:'en'})],settings:{},studio:cleanStudio(),history:{},plans:{}};
prepareLongPlan(original,today);
const event={sessionId:crypto.randomUUID(),videoId:id,day:today,position:300,duration:5400,seconds:150,mediaSeconds:300,observedAt:Date.now()-20000};
let result=applyPlayback(documentOf(original),[event]),s=result.document;
assert.equal(longPosition(s.videos[0],s.longWatch),300);assert.equal(s.videos[0].progressSource,'youtube');assert.equal(s.videos[0].notes,'Preserve');
assert.equal(weekSummary(s.studio,today,s.longWatch).minutes,2.5);assert.equal(weekSummary(s.studio,today,s.longWatch).englishMinutes,2.5);
assert.equal(watchedToday(s.longWatch,today),1);
const visits=structuredClone(s.longWatch);
visits.playback.repeat={videoId:id,day:today,seconds:30};
visits.playback.second={videoId:'00000000002',day:today,seconds:30};
visits.playback.unplayed={videoId:'00000000003',day:today,seconds:0};
visits.playback.old={videoId:'00000000004',day:'2000-01-01',seconds:30};
assert.equal(watchedToday(visits,today),2);
assert.equal(watchedToday(visits,'2000-01-01'),1);
// Calendar totals add each day's distinct videos: rewatching on another day counts again.
// The 2024-12-30 week crosses a year boundary; Sunday belongs to that week, Monday to the next.
const watchedAcrossBoundary={
  watchDays:{
    '2024-12-29':{'00000000011':true},
    '2024-12-30':{'00000000011':true},
    '2024-12-31':{'00000000012':true},
    '2025-01-01':{'00000000011':true,'00000000012':true},
    '2025-01-05':{'00000000011':true},
    '2025-01-06':{'00000000013':true},
    '2025-02-01':{'00000000014':true}
  },
  playback:{
    duplicate:{videoId:'00000000011',day:'2025-01-01',seconds:30},
    legacy:{videoId:'00000000013',day:'2025-01-01',seconds:30},
    unplayed:{videoId:'00000000014',day:'2025-01-05',seconds:0}
  }
};
assert.equal(watchedToday(watchedAcrossBoundary,'2025-01-01'),3,'legacy receipts add a video while same-day repeats stay deduplicated');
assert.equal(watchedPeriod(watchedAcrossBoundary,'week','2025-01-05'),6,'Monday through Sunday crosses December and January');
assert.equal(watchedPeriod(watchedAcrossBoundary,'week','2025-01-01'),5,'future days in the same calendar week are not counted');
assert.equal(watchedPeriod(watchedAcrossBoundary,'week','2025-01-06'),1,'a new Monday starts a new week');
assert.equal(watchedPeriod(watchedAcrossBoundary,'month','2024-12-31'),3,'December includes its final Sunday and excludes January');
assert.equal(watchedPeriod(watchedAcrossBoundary,'month','2025-01-05'),4,'January excludes December and later January days');
assert.equal(watchedPeriod(watchedAcrossBoundary,'month','2025-01-06'),5,'January sums daily counts, including a rewatch on a different day');
assert.equal(watchedPeriod(watchedAcrossBoundary,'month','2025-02-01'),1,'a new month starts fresh');
assert.equal(watchedPeriod({},'week','2025-01-01'),0);
assert.equal(prepareLongPlan(s,today).segments[id].start,0);assert.equal(s.longWatch.plans[today].segments[id].end,900);assert.equal(s.longWatch.plans[today].segments[id].watched,300);
assert.equal(applyPlayback(s,[event]).changed,false);assert.equal(weekSummary(s.studio,today,s.longWatch).minutes,2.5);
// Seeking changes the resume point without completing the daily target or adding minutes.
const seek={...event,position:3000,observedAt:event.observedAt+1000};s=applyPlayback(s,[seek]).document;
assert.equal(s.longWatch.plans[today].segments[id].done,false);assert.equal(weekSummary(s.studio,today,s.longWatch).minutes,2.5);
// Remaining real playback completes today's original target, without shifting the goal ahead.
s=applyPlayback(s,[{...event,position:3600,seconds:450,mediaSeconds:900,observedAt:event.observedAt+2000}]).document;
assert.equal(s.longWatch.plans[today].segments[id].done,true);assert.equal(weekSummary(s.studio,today,s.longWatch).minutes,7.5);
assert.equal(prepareLongPlan(s,today).segments[id].done,true);
// Offline checkpoints cannot undo a more recent manual correction.
setLongPosition(s,s.videos[0],'10:00');s=applyPlayback(s,[{...event,position:4000,seconds:460,mediaSeconds:920,observedAt:Date.now()-1000}]).document;
assert.equal(longPosition(s.videos[0],s.longWatch),600);
// Native ended signal is required; merely seeking to the end never means watched.
let end=applyPlayback(documentOf(original),[{...event,position:5400}]).document;assert(end.videos[0].progress<100);
end=applyPlayback(end,[{...event,position:5400,ended:true,observedAt:event.observedAt+3000}]).document;assert.equal(end.videos[0].progress,100);assert.equal(weekSummary(end.studio,today,end.longWatch).completed,1);
// A regular YouTube watch outside LaterLab counts once, but never enters the library or its watch-time plan.
const outsideId='00000000099',outside={...event,sessionId:crypto.randomUUID(),videoId:outsideId};
let outsideResult=applyPlayback(documentOf(original),[outside]);
assert.equal(outsideResult.changed,true);
assert.equal(outsideResult.updated,0);
assert.equal(watchedToday(outsideResult.document.longWatch,today),1);
assert.equal(outsideResult.document.longWatch.watchDays[today][outsideId],true);
assert.equal(outsideResult.document.videos.length,1);
assert.deepEqual(outsideResult.document.videos[0],documentOf(original).videos[0]);
assert.deepEqual(outsideResult.document.longWatch.positions,{});
assert.deepEqual(outsideResult.document.longWatch.playback,{});
assert.deepEqual(outsideResult.document.longWatch.logs,{});
assert.equal(weekSummary(outsideResult.document.studio,today,outsideResult.document.longWatch).minutes,0);
assert.equal(applyPlayback(outsideResult.document,[outside]).changed,false);
outsideResult=applyPlayback(outsideResult.document,[event]);
assert.equal(watchedToday(outsideResult.document.longWatch,today),2);
assert.equal(applyPlayback(outsideResult.document,[{...outside,sessionId:crypto.randomUUID()}]).changed,false);
assert.equal(watchedToday(outsideResult.document.longWatch,today),2);
assert.equal(applyPlayback(documentOf(original),[{...outside,seconds:0}]).changed,false);
assert.equal(applyPlayback(documentOf(original),[{...outside,videoId:'invalid'}]).changed,false);
assert.equal(applyPlayback(documentOf(original),[{...event,seconds:NaN}]).changed,false);
assert.equal(applyPlayback(documentOf(original),[{...event,observedAt:Date.now()+120000}]).changed,false);
const retained=cleanLongWatch({watchDays:{[today]:{[outsideId]:true,invalid:true},'2000-01-01':{'00000000098':true}}});
assert.deepEqual(retained.watchDays,{[today]:{[outsideId]:true}},'non-library daily IDs expire after the retention window');
const excluded=structuredClone(original);excluded.videos[0].baselineExcluded=true;const excludedResult=applyPlayback(excluded,[event]);assert.equal(excludedResult.changed,true);assert.equal(watchedToday(excludedResult.document.longWatch,today),1);assert.equal(excludedResult.document.videos[0].progress,0);
// Manual fallback counts only the remainder after an automatically measured part.
let fallback=applyPlayback(documentOf(original),[{...event,seconds:300,mediaSeconds:300}]).document;
completeLongSegment(fallback,id,{date:today,start:0,end:900});assert.equal(weekSummary(fallback.studio,today,fallback.longWatch).minutes,15);
assert.deepEqual(cleanLongWatch(s.longWatch),s.longWatch);
const code=newPairCode(),keys=await keysFor(code);assert.deepEqual(await decryptDocument(await encryptDocument(s,keys.key),keys.key),s);
// Concurrent observation and a phone note merge without losing either.
const base=documentOf(original),phone=structuredClone(base);phone.videos[0].notes='Phone note';
const auto=applyPlayback(base,[event]).document,merged=mergeDocuments(base,phone,auto);assert.equal(merged.conflicts.length,0);assert.equal(merged.document.videos[0].notes,'Phone note');assert.equal(merged.document.videos[0].progressSource,'youtube');
const auto2=applyPlayback(base,[{...event,position:400,seconds:200,mediaSeconds:400,observedAt:event.observedAt+1000}]).document;
const combined=mergeDocuments(base,auto,auto2);assert.equal(combined.conflicts.length,0);assert.equal(combined.document.longWatch.positions[id].seconds,400);
const manualA=structuredClone(base),manualB=structuredClone(base);
for(const [doc,updatedAt] of [[manualA,10],[manualB,20]])doc.longWatch.positions[id]={seconds:900,progress:900/5400*100,duration:5400,updatedAt};
const sameManual=mergeDocuments(base,manualA,manualB);assert.equal(sameManual.conflicts.length,0);assert.equal(sameManual.document.longWatch.positions[id].updatedAt,20);
// Concurrent Firefox devices observing different non-library videos must keep both IDs.
const outsideA=applyPlayback(base,[outside]).document;
const outsideB=applyPlayback(base,[{...outside,sessionId:crypto.randomUUID(),videoId:'00000000098'}]).document;
const mergedOutside=mergeDocuments(base,outsideA,outsideB);
assert.equal(mergedOutside.conflicts.length,0);
assert.equal(watchedToday(mergedOutside.document.longWatch,today),2);
assert.deepEqual(Object.keys(mergedOutside.document.longWatch.watchDays[today]).sort(),['00000000098',outsideId]);
// Cloud CAS conflict re-reads current data; replaying the delivered receipt performs no write.
let cloud=base,revision=1,puts=0,gets=0;
const fetcher=async(url,options)=>{if(options.method==='GET'){gets++;return Response.json({revision,payload:await encryptDocument(cloud,keys.key)})}puts++;if(puts===1){cloud.videos[0].notes='Concurrent';revision++;return Response.json({}, {status:409})}const body=JSON.parse(options.body);assert.equal(body.expectedRevision,revision);cloud=await decryptDocument(body.payload,keys.key);return Response.json({revision:++revision})};
await uploadPlayback(code,[event],{fetcher});assert.equal(cloud.videos[0].notes,'Concurrent');assert.equal(puts,2);await uploadPlayback(code,[event],{fetcher});assert.equal(puts,2);
await assert.rejects(uploadPlayback(code,[event],{fetcher,stillAllowed:async()=>false}),/duraklat/);
const a={at:1000,position:10,rate:1,playing:true,valid:true,seeking:false,src:'video'},b={...a,at:2000,position:11};
assert.deepEqual(measure(a,b),{seconds:1,media:1});assert.deepEqual(measure({...a,rate:2},{...b,position:12}),{seconds:1,media:2});
for(const pair of [[a,{...b,position:900}],[a,{...b,position:1}],[a,{...b,position:10}],[{...a,playing:false},b],[a,{...b,valid:false}],[a,{...b,seeking:true}],[a,{...b,at:31000}],[a,{...b,src:'ad'}]])assert.deepEqual(measure(...pair),{seconds:0,media:0});
console.log('PASS automation: all-YouTube daily count, library-only progress and watch time, playback vs seeks/ads/pause/buffering/sleep/rate, exact resume, fixed daily target, idempotency, manual fallback, stale offline checkpoint, completion, exclusions, serialization, multi-device merge and encrypted CAS retries.');
