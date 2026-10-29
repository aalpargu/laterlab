import {uploadPlayback} from './cloud.mjs';
let chain=Promise.resolve(),flushing=false;
const locked=fn=>{const next=chain.then(fn);chain=next.catch(()=>{});return next;};
const config=async()=>(await browser.storage.local.get('config')).config;
const allowed=(a,b)=>b?.enabled&&a.connectionId===b.connectionId&&a.account===b.account;

export async function acceptPlayback(message,sender){
  if(sender.id!==browser.runtime.id||sender.frameId!==0||!sender.tab||sender.tab.incognito||sender.tab.cookieStoreId&&sender.tab.cookieStoreId!=='firefox-default')return;
  let url;try{url=new URL(sender.url);}catch{return;}
  if(url.origin!=='https://www.youtube.com'||url.pathname!=='/watch'||url.searchParams.get('v')!==message.event?.videoId)return;
  const c=await config();if(!c?.enabled||!c.account)return {ok:false,reset:true};
  if(!/^[\w-]{11}$/.test(message.event.videoId||''))return {ok:false,reset:true};
  try{
    // Only a local script may read the account/player. No secret enters the page.
    const result=await browser.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[0]},world:'MAIN',func:async()=>{
      const get=key=>window.ytcfg?.get?.(key)??window.ytcfg?.data_?.[key],identity=get('DATASYNC_ID')||get('DELEGATED_SESSION_ID');
      const player=document.getElementById('movie_player'),video=player?.querySelector('video.html5-main-video'),id=new URL(location.href).searchParams.get('v');
      if(!identity||!video||player.classList.contains('ad-showing')||player.classList.contains('ad-interrupting')||player.getVideoData?.().video_id!==id||player.getPlayerResponse?.()?.videoDetails?.isLive===true||!Number.isFinite(video.duration)||video.duration<=0)return null;
      const account=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('laterlab-youtube:'+identity)))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(identity!==(get('DATASYNC_ID')||get('DELEGATED_SESSION_ID')))return null;
      return {account,id,position:Math.floor(video.currentTime),duration:Math.floor(video.duration),ended:video.ended};
    }});
    const snapshot=result[0]?.result,e=message.event;
    if(snapshot?.account!==c.account||snapshot.id!==e.videoId)return {ok:false,reset:true};
    if(!/^[a-f0-9-]{36}$/.test(e.sessionId||'')||!/^\d{4}-\d{2}-\d{2}$/.test(e.day||'')||!['seconds','mediaSeconds'].every(k=>Number.isSafeInteger(e[k])&&e[k]>=0)||e.seconds>86400||e.mediaSeconds>345600)return {ok:false};
    const event={sessionId:e.sessionId,day:e.day,videoId:snapshot.id,position:snapshot.position,duration:snapshot.duration,ended:snapshot.ended,seconds:e.seconds,mediaSeconds:e.mediaSeconds,observedAt:Date.now()},key=e.sessionId+':'+e.day;
    await locked(async()=>{
      if(!allowed(c,await config()))return;
      const {playbackQueue={}}=await browser.storage.local.get('playbackQueue');
      if(Object.keys(playbackQueue).length>=500&&!playbackQueue[key])throw Error('Bekleyen izleme kayıtları doldu. İnternet bağlantını kontrol et.');
      const old=playbackQueue[key];if(old&&(old.seconds>event.seconds||old.mediaSeconds>event.mediaSeconds))return;
      playbackQueue[key]=event;await browser.storage.local.set({playbackQueue});
      // Keep the original deadline while new samples arrive; paused playback gets an early flush.
      const pending=await browser.alarms.get('playback');
      if(!pending||message.urgent&&pending.scheduledTime>Date.now()+5000)await browser.alarms.create('playback',{delayInMinutes:message.urgent?0.0834:2});
    });
    return {ok:true};
  }catch(error){await browser.storage.local.set({playbackStatus:{phase:'error',message:error.message}});return {ok:false};}
}

export async function flushPlayback(){
  if(flushing)return;flushing=true;
  try{
    const c=await config();if(!c?.enabled||!c.account)return;
    const {playbackQueue={}}=await browser.storage.local.get('playbackQueue');
    const entries=Object.entries(playbackQueue);if(!entries.length)return;
    await uploadPlayback(c.code,entries.map(([,e])=>e),{stillAllowed:async()=>allowed(c,await config())});
    await locked(async()=>{
      if(!allowed(c,await config()))return;
      const {playbackQueue:latest={}}=await browser.storage.local.get('playbackQueue');
      for(const [key,e] of entries)if(latest[key]?.observedAt===e.observedAt)delete latest[key];
      await browser.storage.local.set({playbackQueue:latest,playbackStatus:{phase:'success',checkedAt:new Date().toISOString(),message:'YouTube konumu ve izlenen süre eşitlendi.'}});
    });
  }catch(error){await browser.storage.local.set({playbackStatus:{phase:'error',message:error.message}});}
  finally{
    flushing=false;const c=await config(),{playbackQueue={}}=await browser.storage.local.get('playbackQueue');
    if(c?.enabled&&Object.keys(playbackQueue).length)await browser.alarms.create('playback',{delayInMinutes:2});
  }
}

export async function resumePlayback(){
  await browser.alarms.clear('playback');const c=await config(),{playbackQueue={}}=await browser.storage.local.get('playbackQueue');
  if(c?.enabled&&Object.keys(playbackQueue).length)await browser.alarms.create('playback',{delayInMinutes:0.5});
}
