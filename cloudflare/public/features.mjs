import {norm,exclusion as builtIn,dayKey,compareAdded,recommend,remainingSeconds} from './core.mjs?v=5.9';

const validDay=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;
export function cleanStudio(raw={}) {
  if(!raw||typeof raw!=='object')raw={};
  const rules=Array.isArray(raw.rules)?raw.rules.filter(r=>r&&typeof r.id==='string'&&['channel','title'].includes(r.type)&&typeof r.value==='string'&&r.value.trim()).map(r=>({id:r.id.slice(0,100),type:r.type,value:r.value.trim().slice(0,200),enabled:r.enabled!==false})):[];
  const feedback={};for(const [id,f] of Object.entries(raw.feedback||{}))if(/^[\w-]{11}$/.test(id)&&f&&['dislike','later','watched'].includes(f.kind))feedback[id]={kind:f.kind,until:/^\d{4}-\d{2}-\d{2}$/.test(f.until||'')?f.until:null};
  const events=Array.isArray(raw.events)?raw.events.filter(e=>e&&typeof e.id==='string'&&['complete','minutes','added'].includes(e.type)&&validDay(e.day)&&Number.isInteger(e.amount)&&e.amount>0&&(e.type!=='minutes'||e.amount<=1440)&&(e.type==='minutes'||/^[\w-]{11}$/.test(e.videoId||''))).map(e=>({id:e.id,type:e.type,day:e.day,videoId:e.videoId||null,amount:e.amount,english:!!e.english})):[];
  const difficulties={};for(const [id,level] of Object.entries(raw.difficulties||{}))if(/^[\w-]{11}$/.test(id)&&['easy','medium','hard'].includes(level))difficulties[id]=level;
  return {excludeWatched:raw.excludeWatched===true,rules,exceptions:Array.isArray(raw.exceptions)?raw.exceptions.filter(id=>/^[\w-]{11}$/.test(id)):[],feedback,events:events.filter((e,i)=>events.findIndex(x=>x.id===e.id)===i),difficulties,weeklyGoal:Number.isInteger(raw.weeklyGoal)&&raw.weeklyGoal>=5&&raw.weeklyGoal<=10080?raw.weeklyGoal:60,mode:['balanced','english','light'].includes(raw.mode)?raw.mode:'balanced'};
}
export function ruleMatches(v,r){if(r.enabled===false)return false;const needle=norm(r.value).trim();return !!needle&&(r.type==='channel'?norm(v.channel).trim()===needle:norm(v.title).includes(needle));}
export function reason(v,studio={}) {
  if(v.baselineExcluded)return 'İlk 1274';
  if(v.hidden)return 'Sen gizledin';
  if(studio.excludeWatched&&(v.progress??0)>=100)return 'İzlendi · tamamlandı';
  if(studio.exceptions?.includes(v.id))return '';
  const rule=studio.rules?.find(r=>ruleMatches(v,r));
  return rule?`Kuralın · ${rule.type==='channel'?'Kanal':'Başlık'}: ${rule.value}`:builtIn(v);
}
export function previewRule(videos,rule,studio){const matches=videos.filter(v=>ruleMatches(v,rule));return {matches,newlyHidden:matches.filter(v=>!reason(v,studio)&&!studio.exceptions?.includes(v.id)).length};}
export function cleanPlace(raw){
  if(raw?.enabled!==true)return null;
  const view=['library','english','continue','daily','long','archive','rules','settings','import','progress'].includes(raw.view)?raw.view:'library';
  const filters={query:'',category:'',language:'',type:'',progress:'',duration:'',sort:'newest',tag:'',difficulty:''};
  for(const key of Object.keys(filters))if(typeof raw.filters?.[key]==='string')filters[key]=raw.filters[key].slice(0,300);
  if(!['newest','oldest','smart','shortest','title'].includes(filters.sort))filters.sort='newest';
  return {enabled:true,view,filters,page:Number.isInteger(raw.page)&&raw.page>0?Math.min(raw.page,10000):1,scroll:Number.isFinite(raw.scroll)?Math.max(0,Math.min(raw.scroll,100000)):0};
}
export function shiftDay(day,n){const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10)}
export function weekSummary(studio,date=dayKey(),longWatch=null){
  const weekday=new Date(date+'T12:00:00Z').getUTCDay(),start=shiftDay(date,-((weekday+6)%7)),end=shiftDay(start,6);
  const events=(studio.events||[]).filter(e=>e.day>=start&&e.day<=date);
  const slices=Object.values(longWatch?.logs||{}).filter(e=>e.day>=start&&e.day<=date);
  const logged=english=>Math.round((events.filter(e=>e.type==='minutes'&&(!english||e.english)).reduce((n,e)=>n+e.amount*60,0)+slices.filter(e=>!english||e.english).reduce((n,e)=>n+e.seconds,0))/60*100)/100;
  return {start,end,completed:new Set(events.filter(e=>e.type==='complete').map(e=>e.videoId)).size,added:new Set(events.filter(e=>e.type==='added').map(e=>e.videoId)).size,minutes:logged(false),englishMinutes:logged(true)};
}
export function watchedToday(longWatch,date=dayKey()){
  const videos=new Set(Object.entries(longWatch?.watchDays?.[date]||{}).filter(([id,seen])=>seen===true&&/^[\w-]{11}$/.test(id)).map(([id])=>id));
  for(const entry of Object.values(longWatch?.playback||{})){
    if(entry?.day===date&&entry.seconds>0&&/^[\w-]{11}$/.test(entry.videoId||''))videos.add(entry.videoId);
  }
  return videos.size;
}
export function watchedPeriod(longWatch,period,date=dayKey()){
  if(!validDay(date)||!['week','month'].includes(period))throw Error('İzleme dönemi geçersiz.');
  const start=period==='week'?shiftDay(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7)):date.slice(0,7)+'-01';
  const days=new Map(),idOK=id=>/^[\w-]{11}$/.test(id);
  const add=(day,id)=>{
    if(!validDay(day)||day<start||day>date||!idOK(id))return;
    if(!days.has(day))days.set(day,new Set());
    days.get(day).add(id);
  };
  for(const [day,ids] of Object.entries(longWatch?.watchDays||{}))for(const [id,seen] of Object.entries(ids||{}))if(seen===true)add(day,id);
  for(const entry of Object.values(longWatch?.playback||{}))if(entry?.seconds>0)add(entry.day,entry.videoId);
  return [...days.values()].reduce((total,ids)=>total+ids.size,0);
}
export function recordAdditions(before,next,date=dayKey()){
  const studio=cleanStudio(next.studio);
  if(!before.videos.length)return studio;
  const known=new Set(before.videos.map(v=>v.id));
  for(const v of next.videos)if(!known.has(v.id)&&!reason(v,studio))studio.events.push({id:crypto.randomUUID(),type:'added',videoId:v.id,day:date,amount:1,english:v.language==='en'});
  return studio;
}
export function recordCompletion(studio,v,oldProgress,date=dayKey()){
  if((v.progress??0)>=100&&(oldProgress??0)<100&&!studio.events.some(e=>e.type==='complete'&&e.videoId===v.id&&e.day===date))studio.events.push({id:crypto.randomUUID(),type:'complete',videoId:v.id,day:date,amount:1,english:v.language==='en'});
  if((v.progress??0)<100){if(studio.feedback[v.id]?.kind==='watched')delete studio.feedback[v.id];studio.events=studio.events.filter(e=>e.type!=='complete'||e.videoId!==v.id||e.day<weekSummary(studio,date).start)}
}
export function eligible(v,state,date=dayKey()){
  const s=state.studio||{},f=s.feedback?.[v.id];
  return !reason(v,s)&&(v.progress??0)<100&&f?.kind!=='dislike'&&f?.kind!=='watched'&&!(f?.kind==='later'&&f.until>date)&&(s.mode!=='english'||v.language==='en')&&(s.mode!=='light'||v.duration>0&&v.duration<=900);
}
export function selectDaily(state,{date=dayKey(),exclude=[]}={}){
  const rejected=state.videos.filter(v=>state.studio?.feedback?.[v.id]?.kind==='dislike');
  const channels=new Map(),categories=new Map();for(const v of rejected){if(v.channel)channels.set(v.channel,(channels.get(v.channel)||0)+1);categories.set(v.category,(categories.get(v.category)||0)+1)}
  const pool=state.videos.filter(v=>eligible(v,state,date)&&!exclude.includes(v.id));
  return recommend(pool,{...state.settings,date,history:state.history||{},exclusionFn:v=>reason(v,state.studio),scoreAdjustment:v=>-Math.min(60,(channels.get(v.channel)||0)*15+(categories.get(v.category)||0)*5)});
}

export function preparePlan(state,date=dayKey()) {
  prepareLongPlan(state,date);
  state.plans ||= {}; state.history ||= {};
  if(!Array.isArray(state.plans[date])) {
    state.plans[date]=selectDaily(state,{date}).map(v=>v.id);
    for(const id of state.plans[date])state.history[id]=date;
  } else {
    const eligibleIds=new Set(state.videos.filter(v=>eligible(v,state,date)).map(v=>v.id));
    let used=0;const byId=new Map(state.videos.map(v=>[v.id,v]));
    state.plans[date]=[...new Set(state.plans[date])].filter(id=>{if(!eligibleIds.has(id))return false;const seconds=remainingSeconds(byId.get(id));if(used+seconds>state.settings.budget*60)return false;used+=seconds;return true}).slice(0,state.settings.count);
  }
  for(const key of Object.keys(state.plans))if(key<shiftDay(date,-30))delete state.plans[key];
}

// Long videos use confirmed time ranges. Opening YouTube never records a watch.
export function cleanLongWatch(raw={}) {
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
  raw=object(raw);const preferences=object(raw.preferences),positions={},plans={},logs={},playback={},watchDays={};
  const idOK=id=>/^[\w-]{11}$/.test(id);
  const seconds=n=>Number.isSafeInteger(n)&&n>=0&&n<=6000000;
  const today=dayKey();
  for(const [day,ids] of Object.entries(object(raw.watchDays))){
    if(!validDay(day)||day<shiftDay(today,-30)||day>today)continue;
    const kept=Object.keys(object(ids)).filter(id=>idOK(id)&&ids[id]===true).slice(0,2000);
    if(kept.length)watchDays[day]=Object.fromEntries(kept.map(id=>[id,true]));
  }
  for(const [id,p] of Object.entries(object(raw.positions)))if(idOK(id)&&p&&seconds(p.seconds)&&Number.isFinite(p.progress)&&p.progress>=0&&p.progress<=100&&Number.isFinite(p.duration)&&p.duration>0)positions[id]={seconds:p.seconds,progress:p.progress,duration:p.duration,...(Number.isFinite(p.updatedAt)?{updatedAt:p.updatedAt}:{}),...(p.source==='youtube'?{source:'youtube'}:{})};
  for(const [date,p] of Object.entries(object(raw.plans))){
    if(!validDay(date)||!p||!Array.isArray(p.ids))continue;const segments={};
    for(const id of [...new Set(p.ids)].filter(idOK).slice(0,5)){const s=object(p.segments)[id];if(s&&seconds(s.start)&&seconds(s.end)&&s.end>s.start&&s.end-s.start<=900)segments[id]={start:s.start,end:s.end,done:s.done===true,...(s.automatic===true?{automatic:true,watched:Math.max(0,Math.min(s.end-s.start,Number(s.watched)||0))}:{})};}
    plans[date]={ids:Object.keys(segments),segments};
  }
  for(const [id,e] of Object.entries(object(raw.logs)))if(/^long:[\w:-]{1,100}$/.test(id)&&e&&validDay(e.day)&&idOK(e.videoId)&&seconds(e.seconds)&&e.seconds>0&&e.seconds<=(id.startsWith('long:yt:')?86400:900))logs[id]={day:e.day,videoId:e.videoId,seconds:e.seconds,english:e.english===true};
  for(const [id,e] of Object.entries(object(raw.playback)))if(/^[a-f0-9-]{36}:\d{4}-\d{2}-\d{2}$/.test(id)&&e&&validDay(e.day)&&idOK(e.videoId)&&seconds(e.seconds)&&e.seconds<=86400&&seconds(e.mediaSeconds)&&e.mediaSeconds<=345600&&Number.isFinite(e.observedAt))playback[id]={videoId:e.videoId,day:e.day,seconds:e.seconds,mediaSeconds:e.mediaSeconds,observedAt:e.observedAt};
  return {preferences:{count:[1,2,3,4,5].includes(preferences.count)?preferences.count:3,minutes:[10,15].includes(preferences.minutes)?preferences.minutes:15,minimum:[30,45,60,90].includes(preferences.minimum)?preferences.minimum:45},positions,plans,logs,playback,watchDays};
}
export function longPosition(v,longWatch) {
  const end=Math.floor(v.duration||0),saved=longWatch?.positions?.[v.id];
  if(saved&&saved.progress===v.progress&&saved.duration===v.duration)return Math.min(end,saved.seconds);
  return Math.min(end,Math.max(0,Math.floor(end*(v.progress||0)/100)));
}
export function longEligible(v,state,date=dayKey()) {
  const f=state.studio?.feedback?.[v.id];
  return !reason(v,state.studio)&&!v.availability&&v.type!=='short'&&Number.isFinite(v.duration)&&v.duration>=state.longWatch.preferences.minimum*60&&(v.progress??0)<100&&f?.kind!=='dislike'&&f?.kind!=='watched'&&!(f?.kind==='later'&&f.until>date);
}
export function prepareLongPlan(state,date=dayKey()) {
  state.longWatch=cleanLongWatch(state.longWatch);const long=state.longWatch,p=long.preferences;
  const byId=new Map(state.videos.map(v=>[v.id,v]));
  const previous=Object.keys(long.plans).filter(d=>d<date).sort().at(-1);
  const today=long.plans[date];
  // Keep a small ongoing set until completion; new arrivals fill the free slots.
  const continuing=today?.ids||long.plans[previous]?.ids||[];
  const ids=[...new Set([...continuing,...state.videos.filter(v=>longEligible(v,state,date)).sort((a,b)=>compareAdded(b,a)).map(v=>v.id)])];
  const segments={},selected=[];
  // Confirmed segments stay visible for the day even when watched videos are excluded.
  for(const id of today?.ids||[]){const v=byId.get(id),s=today.segments[id];if(v&&s.done){segments[id]=s;selected.push(id);}}
  for(const id of ids){
    if(selected.includes(id)||selected.length>=p.count)continue;
    const v=byId.get(id);if(!v||!longEligible(v,state,date))continue;
    const active=today?.segments?.[id];
    if(active?.automatic&&!active.done){segments[id]=active;selected.push(id);continue;}
    const start=longPosition(v,long),end=Math.min(Math.floor(v.duration),start+p.minutes*60);
    if(end<=start)continue;segments[id]={start,end,done:false};selected.push(id);
  }
  long.plans[date]={ids:selected,segments};
  for(const d of Object.keys(long.plans))if(d<shiftDay(date,-30))delete long.plans[d];
  return long.plans[date];
}
export function completeLongSegment(state,id,{date=dayKey(),start,end}={}) {
  if(date!==dayKey())throw Error('Gün değişti. Bugünün planını açıp tekrar dene.');
  const long=state.longWatch,segment=long?.plans?.[date]?.segments?.[id],v=state.videos.find(v=>v.id===id);
  if(!segment||!v)throw Error('Bu parça artık planda yok. Sayfayı yenile.');
  if(segment.done)return false;
  if(segment.start!==start||segment.end!==end||(!segment.automatic&&longPosition(v,long)!==start)||!longEligible(v,state,date)||end>Math.floor(v.duration))throw Error('İlerleme veya plan değişti. Güncel parçayı kontrol edip tekrar dene.');
  const resume=segment.automatic?Math.max(end,longPosition(v,long)):end;
  const oldProgress=v.progress;v.progress=resume>=Math.floor(v.duration)?100:resume/v.duration*100;v.progressSource='manual';
  long.positions[id]={seconds:resume,progress:v.progress,duration:v.duration,updatedAt:Date.now()};segment.done=true;
  long.logs[`long:${date}:${id}:${start}:${end}`]={day:date,videoId:id,seconds:Math.max(0,end-start-(segment.watched||0)),english:v.language==='en'};
  recordCompletion(state.studio,v,oldProgress,date);return true;
}
export function timecode(seconds){seconds=Math.max(0,Math.floor(seconds));const h=Math.floor(seconds/3600),m=Math.floor(seconds/60)%60,s=seconds%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(s).padStart(2,'0');}
export function setLongPosition(state,v,text){
  if(!/^\d{1,4}:[0-5]\d(?::[0-5]\d)?$/.test(text))throw Error('Dakika:saniye veya saat:dakika:saniye yaz. Örnek: 23:40.');
  const seconds=text.split(':').reduce((n,part)=>n*60+Number(part),0);
  if(!v.duration||seconds>Math.floor(v.duration))throw Error('Kaldığın yer video süresini aşamaz.');
  const old=v.progress;v.progress=seconds===Math.floor(v.duration)?100:seconds/v.duration*100;v.progressSource='manual';
  state.longWatch=cleanLongWatch(state.longWatch);state.longWatch.positions[v.id]={seconds,progress:v.progress,duration:v.duration,updatedAt:Date.now()};
  const current=state.longWatch.plans[dayKey()]?.segments?.[v.id];if(current&&!current.done){delete current.automatic;delete current.watched;}
  recordCompletion(state.studio,v,old);return seconds;
}
export function applyVideoEdit(v,values){
  const progress=values.progress===''?null:Number(values.progress);
  const duration=values.duration===''?null:Number(values.duration)*60;
  if(progress!==null&&(!Number.isFinite(progress)||progress<0||progress>100))throw Error('İzleme yüzdesi 0–100 arasında olmalı.');
  if(duration!==null&&(!Number.isFinite(duration)||duration<=0))throw Error('Süre sıfırdan büyük olmalı.');
  if(String(values.progress)!==(v.progress===null?'':String(v.progress))){v.progress=progress;v.progressSource='manual'}
  if(String(values.duration)!==(v.duration?String(Number((v.duration/60).toFixed(2))):'')){v.duration=duration;v.durationSource='manual'}
  for(const key of ['category','language','type','notes','verified','hidden'])v[key]=values[key];
  v.tags=String(values.tags).split(',').map(t=>t.trim()).filter(Boolean).slice(0,20);
}

// Idempotent cumulative receipts survive retries, offline delivery and browser restarts.
export function applyPlayback(document,events){
  const state=structuredClone(document);state.longWatch=cleanLongWatch(state.longWatch);state.studio=cleanStudio(state.studio);
  let long=state.longWatch,changed=false,updated=0;
  for(const event of [...events].sort((a,b)=>a.observedAt-b.observedAt)){
    const e=event,key=e.sessionId+':'+e.day;
    if(!/^[a-f0-9-]{36}$/.test(e.sessionId||'')||!validDay(e.day)||e.day>dayKey()||e.day<shiftDay(dayKey(),-30)||!Number.isFinite(e.observedAt)||e.observedAt>Date.now()+60000||e.observedAt<Date.now()-30*86400000)continue;
    if(!['seconds','mediaSeconds','position','duration'].every(k=>Number.isSafeInteger(e[k])&&e[k]>=0)||e.seconds>86400||e.mediaSeconds>345600||!e.duration||e.duration>6000000||e.position>e.duration)continue;
    if(!/^[\w-]{11}$/.test(e.videoId||''))continue;
    if(e.seconds>0){
      const day=long.watchDays[e.day]||={};
      if(!day[e.videoId]&&Object.keys(day).length<2000){day[e.videoId]=true;changed=true;}
    }
    const v=state.videos.find(v=>v.id===e.videoId);if(!v||v.baselineExcluded||v.hidden||v.availability)continue;
    const receipt=long.playback[key];if(receipt&&(receipt.videoId!==v.id||e.observedAt<=receipt.observedAt||e.seconds<receipt.seconds||e.mediaSeconds<receipt.mediaSeconds))continue;
    if(!long.plans[e.day]){prepareLongPlan(state,e.day);long=state.longWatch;}
    const seconds=e.seconds-(receipt?.seconds||0),media=e.mediaSeconds-(receipt?.mediaSeconds||0);
    long.playback[key]={videoId:v.id,day:e.day,seconds:e.seconds,mediaSeconds:e.mediaSeconds,observedAt:e.observedAt};changed=true;
    const logKey='long:yt:'+key;
    if(seconds>0)long.logs[logKey]={day:e.day,videoId:v.id,seconds:(long.logs[logKey]?.seconds||0)+seconds,english:v.language==='en'};
    // Do not let an old offline checkpoint replace a more recent manual or device position.
    const position=long.positions[v.id],fresh=e.observedAt>(position?.updatedAt||0);
    if(fresh){
      const old=v.progress;if(v.durationSource!=='manual'){v.duration=e.duration;v.durationSource='youtube';}
      const end=Math.floor(v.duration),at=Math.min(end,e.position);
      v.progress=e.ended&&e.duration-e.position<=2?100:Math.min(99.999,at/v.duration*100);v.progressSource='youtube';
      long.positions[v.id]={seconds:at,progress:v.progress,duration:v.duration,source:'youtube',updatedAt:e.observedAt};
      recordCompletion(state.studio,v,old,e.day);updated++;
    }
    const segment=long.plans[e.day]?.segments?.[v.id];
    if(segment&&!segment.done&&media>0){segment.automatic=true;segment.watched=Math.min(segment.end-segment.start,(segment.watched||0)+media);segment.done=segment.watched>=segment.end-segment.start||(fresh&&v.progress===100);}
  }
  return {document:state,changed,updated};
}
