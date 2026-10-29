// Pairing secret stays on the devices. The server receives only a separate bearer key.
const encoder=new TextEncoder(),decoder=new TextDecoder();
const bytesTo64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')};
const from64=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export function newPairCode(){return 'LL1-'+bytesTo64(crypto.getRandomValues(new Uint8Array(32)))}
export function checkPairCode(code){
  const text=String(code??'').replace(/[\u200B-\u200F\u2060\uFEFF]/g,'').trim();
  const compact=text.replace(/\s/g,'');
  const matches=/^LL1-[A-Za-z0-9_-]{43}$/.test(compact)?[compact]:[...text.matchAll(/(?<![A-Za-z0-9_-])LL1-[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g)].map(m=>m[0]);
  if(matches.length!==1)throw Error(matches.length>1?'Birden fazla kod bulundu. Yalnız kendi bağlantı kodunu kullan.':'Kod eksik veya geçersiz. Kopyalamak yerine aşağıdaki Kod dosyasını seç düğmesini kullanabilirsin.');
  const value=matches[0];if(bytesTo64(from64(value.slice(4)))!==value.slice(4))throw Error('Kodda değişmiş bir karakter var. Kod dosyasını seçerek yeniden dene.');return value;
}
export async function keysFor(code){code=checkPairCode(code);const digest=label=>crypto.subtle.digest('SHA-256',encoder.encode(label+code));const auth=[...new Uint8Array(await digest('laterlab-auth:'))].map(n=>n.toString(16).padStart(2,'0')).join('');const key=await crypto.subtle.importKey('raw',await digest('laterlab-encryption:'),'AES-GCM',false,['encrypt','decrypt']);return {auth,key}}
export async function encryptDocument(doc,key){const iv=crypto.getRandomValues(new Uint8Array(12));const plaintext=encoder.encode(JSON.stringify(doc));if(plaintext.length>20*1024*1024)throw Error('Eşitleme verisi 20 MB sınırını aşıyor. Yerel yedeğin korunuyor.');const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('laterlab-sync-v1')},key,plaintext);return {iv:bytesTo64(iv),ciphertext:bytesTo64(new Uint8Array(encrypted))}}
export async function decryptDocument(payload,key){try{const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(payload.iv),additionalData:encoder.encode('laterlab-sync-v1')},key,from64(payload.ciphertext));const doc=JSON.parse(decoder.decode(clear));if(doc.format!=='laterlab-sync-v1'||!Array.isArray(doc.videos)||!doc.studio||!doc.settings)throw Error('shape');return doc}catch{throw Error('Bulut kaydı bu kodla doğrulanamadı. Yerel verilerin değiştirilmedi.')}}
export function documentOf(state){return {format:'laterlab-sync-v1',videos:structuredClone(state.videos),studio:structuredClone(state.studio),settings:structuredClone(state.settings),history:structuredClone(state.history||{}),plans:structuredClone(state.plans||{}),importedAt:state.importedAt||null,youtubeSync:structuredClone(state.youtubeSync||null),longWatch:structuredClone(state.longWatch||null)}}
const keyed=new Set(['videos','rules','events']);
function canonical(value,key=''){
  if(Array.isArray(value)){if(keyed.has(key))return Object.fromEntries(value.map(v=>[v.id,canonical(v)]));if(key==='exceptions')return Object.fromEntries(value.map(id=>[id,true]));return value.map(v=>canonical(v))}
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,canonical(v,k)]));return value;
}
function unpack(value,key=''){
  if(value&&typeof value==='object'&&!Array.isArray(value)){if(keyed.has(key))return Object.values(value).map(v=>unpack(v));if(key==='exceptions')return Object.keys(value).filter(k=>value[k]);return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,unpack(v,k)]))}return value;
}
function equal(a,b){if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;if(Array.isArray(a)!==Array.isArray(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]))}
export const sameDocument=(a,b)=>equal(canonical(a),canonical(b));
export function mergeDocuments(base,local,remote,preference=null){
  const conflicts=[];
  function merge(b,l,r,path=[]){
    if(equal(l,r))return l;if(equal(l,b))return r;if(equal(r,b))return l;
    if(path.length===1&&path[0]==='youtubeSync')return (l?.checkedAt||'')>(r?.checkedAt||'')?l:r;
    if(path[0]==='longWatch'&&path[1]==='playback'&&path.length===3)return (l?.observedAt||0)>(r?.observedAt||0)?l:r;
    if(path[0]==='longWatch'&&path[1]==='logs'&&path[2]?.startsWith('long:yt:')&&path.length===3)return (l?.seconds||0)>(r?.seconds||0)?l:r;
    if(path[0]==='longWatch'&&path[1]==='positions'&&path.length===3&&l&&r&&((l.source==='youtube'&&r.source==='youtube')||(l.seconds===r.seconds&&l.progress===r.progress&&l.duration===r.duration&&l.source===r.source)))return (l.updatedAt||0)>(r.updatedAt||0)?l:r;
    if(path[0]==='videos'&&path.length===3&&['progress','progressSource','duration','durationSource'].includes(path[2])){
      const id=path[1],lv=local.videos?.find(v=>v.id===id),rv=remote.videos?.find(v=>v.id===id);
      if(lv?.progressSource==='youtube'&&rv?.progressSource==='youtube')return (local.longWatch?.positions?.[id]?.updatedAt||0)>(remote.longWatch?.positions?.[id]?.updatedAt||0)?l:r;
    }
    if(path[0]==='longWatch'&&path[1]==='plans'&&path[3]==='segments'&&path.length===5&&l?.automatic&&r?.automatic&&l.start===r.start&&l.end===r.end)return {...r,watched:Math.max(l.watched||0,r.watched||0),done:l.done||r.done};
    if(path[0]==='longWatch'&&((path[1]==='positions'&&path.length===3)||(path[1]==='plans'&&path[3]==='segments'&&path.length===5))){conflicts.push(path.join('.'));return preference==='remote'?r:l;}
    if(path[0]==='longWatch'&&path[1]==='plans'&&path.at(-1)==='ids')return r;
    const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
    if(object(l)&&object(r)&&(object(b)||b===undefined)){
      const result=Object.create(null);for(const key of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){const v=merge(b?.[key],l[key],r[key],[...path,key]);if(v!==undefined)result[key]=v}return result;
    }
    // Selections and recency are derived, not user-authored records.
    if(path[0]==='plans')return r;
    if(path[0]==='history'||path[0]==='importedAt')return [l,r].filter(Boolean).sort().at(-1);
    if(path.at(-1)==='baselineExcluded')return l===true||r===true;
    conflicts.push(path.join('.'));return preference==='remote'?r:l;
  }
  return {document:unpack(merge(canonical(base),canonical(local),canonical(remote))),conflicts};
}
