// YouTube API metadata is a short-lived, device-local cache. It is never added to
// the encrypted library document or JSON backups. API policy requires refreshing
// or deleting non-authorized metadata within 30 days.
const CACHE_KEY='video-metadata-v1',MAX_AGE=25*24*60*60*1000;
const validId=id=>typeof id==='string'&&/^[\w-]{11}$/.test(id);

export function cleanMetadataCache(raw,now=Date.now()){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  const result={};
  for(const [id,item] of Object.entries(raw)){
    if(!validId(id)||!item||typeof item!=='object'||!Number.isFinite(item.fetchedAt)||item.fetchedAt>now||now-item.fetchedAt>=MAX_AGE||!['ready','missing'].includes(item.status))continue;
    result[id]={status:item.status,description:item.status==='ready'?String(item.description||'').slice(0,5000):'',creatorTags:item.status==='ready'&&Array.isArray(item.creatorTags)?item.creatorTags.map(t=>String(t).slice(0,100)).slice(0,30):[],fetchedAt:item.fetchedAt};
  }
  return result;
}

export function createMetadata(ctx){
  let cache={},running=false,cancelled=false,done=0,total=0,lastError='',lastResult='';
  const read=()=>new Promise((resolve,reject)=>{const r=ctx.db().transaction('data').objectStore('data').get(CACHE_KEY);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  async function persist(){
    const now=Date.now();
    await new Promise((resolve,reject)=>{
      const tx=ctx.db().transaction('data','readwrite'),store=tx.objectStore('data'),request=store.get(CACHE_KEY);
      request.onsuccess=()=>{
        const merged=cleanMetadataCache(request.result,now);
        for(const [id,item] of Object.entries(cleanMetadataCache(cache,now)))if(!merged[id]||item.fetchedAt>=merged[id].fetchedAt)merged[id]=item;
        cache=merged;store.put(merged,CACHE_KEY);
      };
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
  async function init(){
    const raw=await read();cache=cleanMetadataCache(raw);
    if(raw&&Object.keys(cache).length!==Object.keys(raw).length)await persist();
    setInterval(async()=>{try{const fresh=cleanMetadataCache(cache);if(Object.keys(fresh).length!==Object.keys(cache).length){cache=fresh;await persist();ctx.render()}}catch{}},60*60*1000);
  }
  function get(id){const item=cache[id];return item&&Date.now()-item.fetchedAt<MAX_AGE?item:null}
  function counts(){const rows=ctx.active(),ready=rows.filter(v=>get(v.id)?.status==='ready').length,missing=rows.filter(v=>get(v.id)?.status==='missing').length;return {total:rows.length,ready,missing,pending:rows.length-ready-missing}}
  function statusText(){if(running)return `Açıklamalar alınıyor: ${done} / ${total} video kontrol edildi.`;return lastError||lastResult}
  function panel(){const c=counts();if(!c.total)return '';return `<div class="content-search-panel"><div><strong>İçerik araması</strong><p class="help">${c.ready} / ${c.total} video için YouTube açıklaması ve varsa videoyu yükleyenin konu etiketleri hazır.${c.missing?` ${c.missing} videonun bilgisine ulaşılamadı.`:''} Arama başlık, kanal, not ve bu bilgilerde çalışır.</p><p class="help">Bilgiler yalnız bu cihazda tutulur; 25 gün sonra silinir. İçerik araması için YouTube API hizmeti kullanılır. <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Koşulları</a> · <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Gizlilik Politikası</a></p><p id="metadata-status" class="help" role="status">${ctx.esc(statusText())}</p></div><div class="button-row">${running?'<button class="small ghost" data-action="cancel-metadata">Durdur</button>':`<button class="small" data-action="fetch-metadata" ${!c.pending?'disabled':''}>${c.pending?'Eksik bilgileri getir':'Bilgiler güncel'}</button>${c.ready||c.missing?'<button class="small ghost" data-action="refresh-metadata">Tümünü yenile</button>':''}`}</div></div>`}
  function updateStatus(){const el=document.querySelector('#metadata-status');if(el)el.textContent=statusText()}
  function cancel(){cancelled=true;lastResult='İşlem durduruluyor; alınan bilgiler korundu.';updateStatus()}
  async function collect({force=false,quiet=false}={}){
    if(running)return;
    const targets=ctx.active().filter(v=>force||!get(v.id));
    if(!targets.length){if(!quiet){lastResult='Yeni bilgi gerekmiyor.';ctx.render()}return}
    running=true;cancelled=false;done=0;total=targets.length;lastError='';lastResult='';if(!quiet)ctx.render();
    try{
      const token=await ctx.auth();
      if(!token)throw Error('Açıklamaları getirmek için önce Tercihler bölümünden cihaz eşitlemesini bağla.');
      for(let i=0;i<targets.length&&!cancelled;i+=50){
        const ids=targets.slice(i,i+50).map(v=>v.id);
        const response=await fetch('/api/video-metadata',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({ids}),cache:'no-store',signal:AbortSignal.timeout(30000)});
        if(!response.ok){let message='YouTube bilgileri alınamadı ('+response.status+').';try{message=(await response.json()).error||message}catch{}throw Error(message)}
        const data=await response.json();
        if(!Array.isArray(data.videos)||!Array.isArray(data.missingIds))throw Error('YouTube bilgi yanıtı geçersiz.');
        const allowed=new Set(ids),seen=new Set(),now=Date.now();
        for(const row of data.videos){if(!allowed.has(row?.id)||seen.has(row.id))throw Error('YouTube bilgi yanıtında beklenmeyen video var.');seen.add(row.id);cache[row.id]={status:'ready',description:String(row.description||'').slice(0,5000),creatorTags:Array.isArray(row.tags)?row.tags.map(t=>String(t).slice(0,100)).slice(0,30):[],fetchedAt:now}}
        for(const id of data.missingIds){if(!allowed.has(id)||seen.has(id))throw Error('YouTube bilgi yanıtında beklenmeyen video var.');seen.add(id);cache[id]={status:'missing',description:'',creatorTags:[],fetchedAt:now}}
        if(seen.size!==ids.length)throw Error('YouTube bilgi yanıtı eksik.');
        await persist();done+=ids.length;updateStatus();
      }
      lastResult=cancelled?`${done} video kontrol edildi; daha sonra devam edebilirsin.`:`${done} video kontrol edildi. İçerik araması hazır.`;
    }catch(error){lastError=error.message;if(!quiet)ctx.toast(lastError)}
    finally{running=false;ctx.render()}
  }
  function start(options){void collect(options)}
  function handle(action){if(action==='fetch-metadata'){start();return true}if(action==='refresh-metadata'){start({force:true});return true}if(action==='cancel-metadata'){cancel();return true}return false}
  return {init,get,counts,panel,handle,start,cancel};
}
