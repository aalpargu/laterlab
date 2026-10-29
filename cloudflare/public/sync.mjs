import {checkPairCode,keysFor,encryptDocument,decryptDocument,documentOf,sameDocument,mergeDocuments} from './sync-core.mjs?v=5.9';

export function createSync(ctx){
  let draftCode='',config=null,running=false,timer,pendingPreference=null,status='Eşitleme kapalı',conflict=null,lastError='';
  const esc=ctx.esc;
  async function readConfig(){return new Promise((resolve,reject)=>{const r=ctx.db().transaction('data').objectStore('data').get('sync');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}
  async function writeConfig(value){await new Promise((resolve,reject)=>{const tx=ctx.db().transaction('data','readwrite');if(value)tx.objectStore('data').put(value,'sync');else tx.objectStore('data').delete('sync');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});config=value}
  function update(message){status=message;const el=document.querySelector('#sync-status');if(el)el.textContent=message;const error=document.querySelector('#sync-error');if(error)error.textContent=lastError}
  async function request(keys,method='GET',body=null){
    const response=await fetch('/api/sync',{method,headers:{Authorization:'Bearer '+keys.auth,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(response.status===409){const e=Error('Kayıt başka cihazda değişti; yeniden deneniyor.');e.retry=true;throw e}
    if(!response.ok){let message='Eşitleme sunucusuna ulaşılamıyor ('+response.status+').';try{message=(await response.json()).error||message}catch{}throw Error(message)}
    const data=await response.json();if(!Number.isSafeInteger(data.revision))throw Error('Eşitleme sunucusunun yanıtı geçersiz.');return data;
  }
  function schedule(delay=1200){clearTimeout(timer);if(config)timer=setTimeout(()=>sync(),delay)}
  async function sync(preference=null){
    if(running)return;running=true;try{config=await readConfig()}catch(error){running=false;lastError=error.message;update('Eşitleme kaydı okunamadı');return}if(!config){running=false;return}preference=preference||pendingPreference;pendingPreference=null;
    if(conflict&&!preference){running=false;update('Çakışma var · Tercihler’den çöz');return}
    running=true;lastError='';update('Eşitleniyor…');
    try{
      const startingCode=config.code,keys=await keysFor(startingCode),local=documentOf(ctx.state()),remote=await request(keys);
      const remoteDoc=remote.payload?await decryptDocument(remote.payload,keys.key):null;
      let merged=local;
      if(remoteDoc){
        const empty=local.videos.length===0&&!local.studio.rules?.length&&!local.studio.events?.length;
        if(!config.base&&empty)merged=remoteDoc;
        else {const result=mergeDocuments(config.base||undefined,local,remoteDoc,preference);if(result.conflicts.length&&!preference){conflict=result.conflicts;update('Çakışma var · Tercihler’den çöz');ctx.render();return}merged=result.document}
      }else if(!local.videos.length&&!config.base){update('Cihaz bağlandı · bilgisayarındaki liste bekleniyor');return}else if(config.base)throw Error('Bulut kaydı bulunamadı. Yerel verin korunuyor; yeniden bağlamadan önce yedek al.');
      let remoteRevision=remote.revision;
      if(!remoteDoc||!sameDocument(merged,remoteDoc))remoteRevision=(await request(keys,'PUT',{expectedRevision:remote.revision,payload:await encryptDocument(merged,keys.key)})).revision;
      // User changes made while the network was busy must never be overwritten.
      if((await readConfig())?.code!==startingCode)return;
      if(!sameDocument(documentOf(ctx.state()),local)){pendingPreference=preference;schedule();update('Yeni yerel değişiklikler bekliyor');return}
      if(!sameDocument(local,merged)&&!await ctx.apply(merged,local)){pendingPreference=preference;schedule();update('Yerel kayıt bekleniyor');return}
      await writeConfig({...config,base:merged,revision:remoteRevision,lastSync:new Date().toISOString()});
      conflict=null;lastError='';update('Eşitlendi · '+new Date(config.lastSync).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}));
      const last=document.querySelector('#sync-last');if(last)last.textContent='Son başarılı eşitleme: '+new Date(config.lastSync).toLocaleString('tr-TR');if(preference)ctx.render();
    }catch(error){lastError=error.retry?'Başka cihazdaki değişiklikler yeniden okunacak.':'Değişiklikler bu cihazda duruyor. '+error.message;update(navigator.onLine?'Eşitleme bekliyor':'Çevrimdışı · cihazda kayıtlı');if(error.retry)schedule(1500)}finally{running=false}
  }
  function panel(){return `<div class="panel"><h2>Cihazlar arası eşitleme</h2>${ctx.state().youtubeSync?.checkedAt?`<p class="help">YouTube otomatik kontrol: ${esc(new Date(ctx.state().youtubeSync.checkedAt).toLocaleString("tr-TR"))} · ${esc(ctx.state().youtubeSync.added)} yeni video eklendi. Liste kontrolü yeni videoları getirir. Firefox eklentisi 1.1.1, kütüphane konumunu ve günlük YouTube sayısını otomatik günceller.</p>`:""}<p id="sync-status" role="status">${esc(status)}</p><p id="sync-error" class="error">${esc(lastError)}</p>${config?`<p class="help">Liste, notlar, ilerleme, dışlamalar ve tercihler şifrelenerek eşitlenir. Uygulama açıkken internet kesilirse değişikliklerin cihazda saklanır. Bu cihazdaki görünüm ve kaydırma konumu ayrı kalır.</p><div class="button-row"><button data-sync="now">Şimdi eşitle</button><button data-sync="code">Başka cihaz bağla / kodu göster</button><button data-sync="disconnect">Bu cihazın bağlantısını kes</button></div>${config.lastSync?`<p id="sync-last" class="help">Son başarılı eşitleme: ${esc(new Date(config.lastSync).toLocaleString('tr-TR'))}</p>`:''}`:`<p>Telefonunda ve tabletinde aynı LaterLab adresini aç. Kurulumda verilen özel kodu önce kütüphanenin bulunduğu cihazda, ardından diğer cihazlarında gir.</p><label class="field">Kod dosyasını seç<input id="sync-code-file" type="file" accept=".txt,text/plain"></label><p class="help">Sana verilen kod dosyasını seç; kod otomatik okunur ve bu cihaz bağlanır. İstersen aşağıya yapıştırabilirsin.</p><form id="sync-connect" class="field"><label class="field">Özel eşitleme kodun<input name="code" type="password" value="${esc(draftCode)}" autocomplete="off" autocapitalize="none" spellcheck="false" required placeholder="LL1-…"></label><button class="primary" type="submit">Kodu kaydet ve bu cihazı bağla</button><p class="help">Bu düğmeye basman yeterli; cihaz başına bir kez bağlanırsın. Aşağıdaki Tercihleri kaydet düğmesi de girdiğin kodu kaydeder.</p></form><p class="help">Kod kütüphanenin anahtarıdır. Güvenli bir yerde sakla; kod olmadan bulut kopyası açılamaz. Kod veya liste başka bir kullanıcıyla paylaşılmaz.</p>`}${conflict?`<div class="notice warning"><strong>${conflict.length} alanda iki cihaz farklı değişiklik yapmış.</strong><p>Her iki tarafın diğer değişiklikleri birleşecek. Çakışan alanlar için hangi sürümü koruyacağını seç. Önce bu cihazın yedeğini alabilirsin.</p><p class="help">${conflict.slice(0,8).map(esc).join(' · ')}</p><div class="button-row"><button data-sync="local">Çakışmalarda bu cihazı kullan</button><button data-sync="remote">Çakışmalarda bulutu kullan</button><button data-action="backup">Önce yedek al</button></div></div>`:''}</div>`}
  async function available(){const response=await fetch('/api/sync-status',{cache:'no-store',signal:AbortSignal.timeout(10000)});let data;try{data=await response.json()}catch{}if(!response.ok||!data?.available)throw Error('Eşitleme sunucusu henüz yayınlanmamış. Bu özellik sunucuyla birlikte yayınlanınca açılacak.')}
  async function handle(button){
    const action=button.dataset.sync;if(!action)return false;
    if(running){ctx.toast('Eşitlemenin tamamlanmasını bekle.');return true}
    if(action==='now')schedule(10);
    if(action==='code')showCode();
    if(action==='copy'){try{await navigator.clipboard.writeText(config.code);ctx.toast('Eşitleme kodu kopyalandı.')}catch{document.querySelector('#pair-code')?.select();ctx.toast('Kodu seçtim; kopyalayıp diğer cihazına aktar.')}}
    if(action==='disconnect'){await writeConfig(null);conflict=null;clearTimeout(timer);lastError='';update('Eşitleme kapalı');ctx.render();ctx.toast('Bu cihazın bağlantısı kesildi. Yerel ve bulut kopyaları korunuyor.')}
    if(action==='local'||action==='remote'){ctx.backup();pendingPreference=action;schedule(10)}
    return true;
  }
  function showCode(){if(!config)return;ctx.modal(`<div class="dialog-head"><h2>Diğer cihazını bağla</h2><button data-action="close" aria-label="Kapat">✕</button></div><p>Diğer cihazda aynı LaterLab adresini aç → Tercihler → Mevcut kütüphaneye bağlan.</p><label class="field">Özel eşitleme kodun<input id="pair-code" readonly value="${esc(config.code)}" autocomplete="off" spellcheck="false"></label><p class="help">Bu kodu bilen kişi kütüphaneni açabilir. Güvenli sakla. Kod hiçbir bağlantı adresine eklenmez ve yedek JSON’a dahil edilmez.</p><button class="primary" data-sync="copy">Kodu kopyala</button>`)}
  async function submit(form,codeFromFile){
    const direct=form.id==='sync-connect',settings=form.id==='settings-form';
    if(!direct&&!(settings&&!config&&draftCode.trim()))return false;
    if(direct)draftCode=String(codeFromFile??new FormData(form).get('code')??'');
    lastError='';update('Kod kontrol ediliyor…');
    try{
      const code=checkPairCode(draftCode);await available();const keys=await keysFor(code),remote=await request(keys);
      if(remote.payload)await decryptDocument(remote.payload,keys.key);
      await writeConfig({code,base:null,revision:remote.revision,lastSync:null});draftCode='';
      update(remote.payload||ctx.state().videos.length?'Cihaz bağlandı · ilk eşitleme başlıyor…':'Cihaz bağlandı · bilgisayarındaki liste bekleniyor');
      ctx.render();schedule(10);return direct;
    }catch(error){lastError=error.message;update('Cihaz bağlanamadı');ctx.toast('Bağlantı kurulamadı. Kod kutusunun altındaki açıklamayı kontrol et.');return true}
  }
  async function change(input){
    if(input.id!=='sync-code-file')return false;
    const file=input.files?.[0];if(!file)return true;
    try{if(file.size>16384)throw Error('Bu dosya bağlantı kodu için çok büyük. Sana verilen küçük TXT dosyasını seç.');await submit({id:'sync-connect'},await file.text())}
    catch(error){lastError=error.message;update('Cihaz bağlanamadı')}
    finally{input.value=''}return true;
  }
  async function init(){document.addEventListener('paste',e=>{if(!e.target.matches?.('#sync-connect input[name=code]'))return;try{const value=checkPairCode(e.clipboardData.getData('text'));e.preventDefault();e.target.value=value;draftCode=value}catch{}});document.addEventListener('input',e=>{if(e.target.matches?.('#sync-connect input[name=code]'))draftCode=e.target.value});config=await readConfig();if(config){checkPairCode(config.code);update('Eşitleme hazır');schedule(50)}window.addEventListener('online',()=>schedule(50));document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(50)});setInterval(()=>{if(!document.hidden&&config&&!running)sync()},60000)}
  return {panel,handle,submit,change,init,schedule,connected:()=>!!config,metadataAuth:async()=>config?(await keysFor(config.code)).auth:null};
}

