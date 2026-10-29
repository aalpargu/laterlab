const $=id=>document.getElementById(id);
$('extension-version').textContent='v'+browser.runtime.getManifest().version;
let busy=false;
async function send(action,data={}){const result=await browser.runtime.sendMessage({action,...data});if(!result?.ok)throw Error(result?.error||'Eklenti yanıt vermedi.');return result;}
async function refresh(){try{const state=await send('state');$('setup').hidden=state.connected;$('connected').hidden=!state.connected;$('enabled').checked=state.enabled;$('interval').value=String(state.intervalMinutes);$('playback-status').textContent=state.playbackStatus?.message||(state.pendingPlayback?'İzleme kayıtları gönderilmeyi bekliyor.':'Kütüphane konumu ve günlük YouTube sayısı otomatik kaydedilecek.');$('now').disabled=busy||state.running||!state.enabled;$('disconnect').disabled=busy||state.running;$('connect').disabled=busy;$('code-file').disabled=busy;$('status').textContent=!state.enabled?'Otomatik güncelleme duraklatıldı.':state.status?.message||'İlk kontrol bekleniyor.';$('last').textContent=state.lastSuccess?.checkedAt?'Son başarılı kontrol: '+new Date(state.lastSuccess.checkedAt).toLocaleString('tr-TR'):'';}catch(error){$('error').textContent=error.message}}
async function action(fn){if(busy)return;busy=true;$('error').textContent='';await refresh();try{await fn()}catch(error){$('error').textContent=error.message}finally{busy=false;await refresh()}}
$('connect').onclick=()=>action(()=>send('connect-app'));
$('interval').onchange=()=>{const minutes=Number($('interval').value);void action(()=>send('interval',{minutes}))};
$('now').onclick=()=>action(()=>send('now'));
$('enabled').onchange=()=>{const enabled=$('enabled').checked;void action(()=>send('enabled',{enabled}))};
$('disconnect').onclick=()=>action(()=>send('disconnect'));
$('code-file').onchange=()=>action(async()=>{const file=$('code-file').files?.[0];if(!file)return;if(file.size>16384)throw Error('Sana verilen küçük TXT kod dosyasını seç.');await send('connect-file',{code:await file.text()});$('code-file').value='';});
await refresh();setInterval(()=>{if(!document.hidden&&!busy)void refresh()},2000);
