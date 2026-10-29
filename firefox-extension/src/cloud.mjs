import {keysFor,encryptDocument,decryptDocument,checkPairCode} from '../../cloudflare/public/sync-core.mjs';
import {importSnapshot} from '../../cloudflare/public/core.mjs';
import {recordAdditions,applyPlayback} from '../../cloudflare/public/features.mjs';

export const APP='https://siradaki.alpargu37.workers.dev';
export async function cloudRequest(code,method='GET',body,fetcher=fetch){
  const keys=await keysFor(checkPairCode(code));
  const response=await fetcher(APP+'/api/sync',{method,headers:{Authorization:'Bearer '+keys.auth,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(30000)});
  if(response.status===409)return {conflict:true};
  if(!response.ok)throw Error(response.status===401?'LaterLab bağlantısı geçersiz. Eklentiyi yeniden bağla.':'LaterLab sunucusuna ulaşılamadı ('+response.status+').');
  const data=await response.json();if(!Number.isSafeInteger(data.revision)||data.revision<0)throw Error('Sunucu sürüm bilgisi geçersiz.');
  return {...data,document:data.payload?await decryptDocument(data.payload,keys.key):null};
}
export function addDelta(document,delta,checkedAt=new Date().toISOString()){
  if(!document?.videos?.length)throw Error('Önce LaterLab’de mevcut kütüphaneni eşitle.');
  if(delta?.format!=='siradaki-delta-v1'||delta.scope!=='new-only')throw Error('Yalnız yeni-videolar güncellemesi kabul edilir.');
  const videos=importSnapshot(delta,document.videos),added=videos.length-document.videos.length;
  const next={...document,videos,youtubeSync:{checkedAt,added,total:delta.total,source:'firefox',scope:'new-only'}};
  if(added){next.studio=recordAdditions(document,next);next.importedAt=checkedAt;}
  return {document:next,added};
}
// Re-read on every retry: a simultaneous phone edit must not be overwritten.
export async function uploadDelta(code,delta,{fetcher=fetch,stillAllowed=async()=>true,backup=async()=>{}}={}){
  const keys=await keysFor(code);
  for(let attempt=0;attempt<4;attempt++){
    if(!await stillAllowed())throw Error('Otomatik güncelleme durduruldu.');
    const current=await cloudRequest(code,'GET',undefined,fetcher);
    const next=addDelta(current.document,delta);
    const payload=await encryptDocument(next.document,keys.key);
    await backup(current.payload);
    if(!await stillAllowed())throw Error('Otomatik güncelleme durduruldu.');
    const saved=await cloudRequest(code,'PUT',{expectedRevision:current.revision,payload},fetcher);
    if(!saved.conflict)return {added:next.added,checkedAt:next.document.youtubeSync.checkedAt};
  }
  throw Error('Kütüphane diğer cihazda değişiyor. Sonraki kontrolde tekrar denenecek.');
}

export async function uploadPlayback(code,events,{fetcher=fetch,stillAllowed=async()=>true}={}){
  const keys=await keysFor(code);
  for(let attempt=0;attempt<4;attempt++){
    if(!await stillAllowed())throw Error('İzleme eşitlemesi duraklatıldı.');
    const current=await cloudRequest(code,'GET',undefined,fetcher);
    if(!current.document?.videos?.length)throw Error('LaterLab kütüphanesi bekleniyor.');
    const next=applyPlayback(current.document,events);
    if(!next.changed)return {updated:0};
    const payload=await encryptDocument(next.document,keys.key);
    if(!await stillAllowed())throw Error('İzleme eşitlemesi duraklatıldı.');
    const saved=await cloudRequest(code,'PUT',{expectedRevision:current.revision,payload},fetcher);
    if(!saved.conflict)return {updated:next.updated};
  }
  throw Error('Diğer cihazdaki değişiklik bekleniyor; izleme kaydı yeniden denenecek.');
}
