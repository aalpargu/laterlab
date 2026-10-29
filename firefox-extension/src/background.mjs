import {acceptPlayback,flushPlayback,resumePlayback} from './playback-background.mjs';
import {getSpeedInfo,setSpeed} from './speed-background.mjs';
import {APP,cloudRequest,uploadDelta} from './cloud.mjs';
import {checkPairCode} from '../../cloudflare/public/sync-core.mjs';

const WL='https://www.youtube.com/playlist?list=WL';
let running=false,ownedTab=null,cancelled=false;
const getConfig=async()=>(await browser.storage.local.get('config')).config;
async function status(value){await browser.storage.local.set({status:value});await browser.action.setBadgeText({text:value.phase==='error'?'!':value.phase==='running'?'…':''});await browser.action.setBadgeBackgroundColor({color:'#806324'});}
function waitLoaded(id){return new Promise((resolve,reject)=>{
  const finish=error=>{clearTimeout(timer);browser.tabs.onUpdated.removeListener(updated);browser.tabs.onRemoved.removeListener(removed);error?reject(error):resolve()};
  const updated=(tabId,info)=>{if(tabId===id&&info.status==='complete')finish()};
  const removed=tabId=>{if(tabId===id)finish(Error('Güncelleme sekmesi kapatıldı.'))};
  const timer=setTimeout(()=>finish(Error('Sayfa zamanında açılmadı. İnternet bağlantını kontrol et.')),45000);
  browser.tabs.onUpdated.addListener(updated);browser.tabs.onRemoved.addListener(removed);
  browser.tabs.get(id).then(tab=>{if(tab.status==='complete')finish()},finish);
})}
async function removeOwned(){const record=(await browser.storage.session.get('ownedTab')).ownedTab;const id=ownedTab??record?.id;ownedTab=null;if(id!=null){try{const tab=await browser.tabs.get(id);if(tab.url?.startsWith(WL))await browser.tabs.remove(id)}catch{}}await browser.storage.session.remove('ownedTab');}
export async function run(){
  if(running)return;
  const config=await getConfig();if(!config?.enabled||!config.code)return;
  if(running)return;running=true;cancelled=false;
  const stillAllowed=async()=>{const now=await getConfig();return !cancelled&&now?.enabled&&now.connectionId===config.connectionId};
  try{
    await browser.storage.local.set({lastAttempt:Date.now()});
    await removeOwned();
    await status({phase:'running',message:'YouTube listesi kontrol ediliyor…',startedAt:new Date().toISOString()});
    const cloud=await cloudRequest(config.code);
    if(!cloud.document?.videos?.length)throw Error('Önce Firefox’taki LaterLab kütüphanende Eşitlendi yazısını gör.');
    const ids=cloud.document.videos.map(v=>v.id);
    if(ids.length>20000||ids.some(id=>!/^[-\w]{11}$/.test(id)))throw Error('LaterLab kütüphanesi doğrulanamadı.');
    if(!await stillAllowed())throw Error('Otomatik güncelleme durduruldu.');
    const tab=await browser.tabs.create({url:WL,active:false});ownedTab=tab.id;
    await browser.storage.session.set({ownedTab:{id:tab.id,startedAt:Date.now()}});
    await browser.alarms.create('cleanup',{delayInMinutes:6});
    await waitLoaded(tab.id);
    if(!await stillAllowed())throw Error('Otomatik güncelleme durduruldu.');
    await browser.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['youtube.js']});
    const results=await browser.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:async(ids,account)=>{try{return {ok:true,value:await globalThis.__laterlabCollect(ids,account)}}catch(error){return {ok:false,error:error.message}}finally{delete globalThis.__laterlabCollect}},args:[ids,config.account||null]});
    const result=results[0]?.result;if(!result?.ok)throw Error(result?.error||'YouTube listesi okunamadı.');
    const {account,delta}=result.value;
    if(!/^[a-f0-9]{64}$/.test(account)||config.account&&config.account!==account)throw Error('YouTube hesap eşleşmesi doğrulanamadı.');
    if(!Array.isArray(delta?.baseIds)||delta.baseIds.length!==ids.length||new Set(delta.baseIds).size!==ids.length||delta.baseIds.some(id=>!ids.includes(id)))throw Error('Aktarım referansı değişti. Güncelleme yapılmadı.');
    const saved=await uploadDelta(config.code,delta,{stillAllowed,backup:payload=>browser.storage.local.set({lastCloudBackup:{payload,savedAt:new Date().toISOString()}})});
    const latest=await getConfig();if(latest?.connectionId===config.connectionId){await browser.storage.local.set({config:{...latest,account},lastSuccess:saved});}
    await status({phase:'success',message:saved.added?`${saved.added} yeni video LaterLab’e eklendi.`:'Liste kontrol edildi; yeni video yok.',...saved});
  }catch(error){await status({phase:'error',message:error.message,attemptedAt:new Date().toISOString()})}
  finally{await removeOwned();await browser.alarms.clear('cleanup');running=false;}
}
async function connectFromApp(){
  const tabs=await browser.tabs.query({url:APP+'/*'});
  let tab=tabs.find(t=>!t.incognito&&(!t.cookieStoreId||t.cookieStoreId==='firefox-default')),created=false;
  if(!tab){tab=await browser.tabs.create({url:APP+'/',active:false});created=true;}
  try{
    await waitLoaded(tab.id);
    const result=await browser.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:async()=>{
      if(location.origin!=='https://siradaki.alpargu37.workers.dev')return null;
      return new Promise((resolve,reject)=>{const request=indexedDB.open('siradaki-v1',1);request.onupgradeneeded=()=>{request.transaction.abort();resolve(null)};request.onerror=()=>reject(Error('LaterLab tarayıcı kaydı okunamadı.'));request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('data')){db.close();resolve(null);return}const r=db.transaction('data').objectStore('data').get('sync');r.onsuccess=()=>{db.close();resolve(r.result?.code||null)};r.onerror=()=>{db.close();reject(Error('LaterLab bağlantısı okunamadı.'))}};});
    }});
    const code=result[0]?.result;if(!code)throw Error('Bu Firefox profilinde LaterLab bağlı değil. Önce LaterLab → Tercihler bölümünde cihazını bağla veya aşağıdan kod dosyasını seç.');
    return code;
  }finally{if(created)await browser.tabs.remove(tab.id).catch(()=>{});}
}
async function connect(raw){
  if(running)throw Error('Kontrolün bitmesini bekle.');
  const code=checkPairCode(raw),cloud=await cloudRequest(code);
  if(!cloud.document?.videos?.length)throw Error('Bulutta henüz kütüphane yok. Önce LaterLab’de mevcut listeni eşitle.');
  const config={code,enabled:true,account:null,intervalMinutes:360,connectionId:crypto.randomUUID()};
  await browser.storage.local.remove(['playbackQueue','playbackStatus']);await browser.storage.local.set({config,lastAttempt:Date.now()});await schedule();void run();
}
async function schedule(){
  const config=await getConfig(),{lastAttempt,lastSuccess}=await browser.storage.local.get(['lastAttempt','lastSuccess']);
  await browser.alarms.clear('sync');
  if(config?.enabled){const interval=[30,360,720].includes(config.intervalMinutes)?config.intervalMinutes:360;const last=lastAttempt||Date.parse(lastSuccess?.checkedAt)||0;await browser.alarms.create('sync',{delayInMinutes:Math.max(1,(last+interval*60000-Date.now())/60000),periodInMinutes:interval});}
  await resumePlayback();
}
browser.runtime.onMessage.addListener(async(message,sender)=>{
  if(message?.action==='playback')return acceptPlayback(message,sender);
  if(message?.action==='speed-info')return getSpeedInfo(message,sender);
  if(message?.action==='set-speed')return setSpeed(message,sender);
  if(sender.id!==browser.runtime.id||sender.url!==browser.runtime.getURL('options.html'))return;
  try{
    if(message.action==='state'){const {config,status,lastSuccess,playbackStatus,playbackQueue}=await browser.storage.local.get(['config','status','lastSuccess','playbackStatus','playbackQueue']);return {ok:true,connected:!!config?.code,enabled:!!config?.enabled,running,status,lastSuccess,playbackStatus,pendingPlayback:Object.keys(playbackQueue||{}).length,intervalMinutes:config?.intervalMinutes||360};}
    if(message.action==='connect-app'){await connect(await connectFromApp());return {ok:true};}
    if(message.action==='connect-file'){await connect(message.code);return {ok:true};}
    if(message.action==='interval'){const config=await getConfig();if(!config||![30,360,720].includes(message.minutes))throw Error('Kontrol sıklığı geçersiz.');await browser.storage.local.set({config:{...config,intervalMinutes:message.minutes}});await schedule();return {ok:true};}
    if(message.action==='now'){if(!(await getConfig())?.enabled)throw Error('Önce otomatik güncellemeyi aç.');void run();return {ok:true};}
    if(message.action==='enabled'){const config=await getConfig();if(!config)throw Error('Önce LaterLab’i bağla.');if(!message.enabled)cancelled=true;await browser.storage.local.set({config:{...config,enabled:message.enabled===true}});await schedule();if(!message.enabled)await removeOwned();else void run();return {ok:true};}
    if(message.action==='disconnect'){if(running)throw Error('Kontrolün bitmesini bekle veya önce otomatik güncellemeyi duraklat.');await browser.storage.local.remove(['config','lastCloudBackup','status','lastSuccess','knownVideoIds','lastAttempt','playbackQueue','playbackStatus']);await schedule();await browser.action.setBadgeText({text:''});return {ok:true};}
    throw Error('İşlem tanınmadı.');
  }catch(error){return {ok:false,error:error.message};}
});
browser.action.onClicked.addListener(()=>browser.runtime.openOptionsPage());
browser.runtime.onInstalled.addListener(async details=>{await browser.storage.local.remove('knownVideoIds');await schedule();if(details.reason==='install')await browser.runtime.openOptionsPage();});
browser.runtime.onStartup.addListener(schedule);
browser.alarms.onAlarm.addListener(async alarm=>{
  if(alarm.name==='playback')await flushPlayback();
  if(alarm.name==='sync')await run();
  if(alarm.name==='cleanup'){
    cancelled=true;await removeOwned();
    if(!running)await status({phase:'error',message:'Önceki tarama yarım kaldı. Sonraki kontrolde yeniden denenecek.'});
  }
});
