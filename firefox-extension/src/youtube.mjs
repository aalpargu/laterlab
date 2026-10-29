import {createPlaylistTools} from '../../cloudflare/public/exporter.mjs';

export function totalOf(data,kit=createPlaylistTools()){
  const candidates=[...kit.findAll(data,'playlistSidebarPrimaryInfoRenderer').map(x=>x.stats?.[0]),...kit.findAll(data,'playlistHeaderRenderer').map(x=>x.numVideosText),...kit.findAll(data,'numVideosText')];
  const numbers=candidates.map(x=>kit.text(x).trim()).filter(x=>/^\d[\d.,\s\u00a0]*\s+(?:videos?|video|videolar)(?:\s|$)/i.test(x)).map(x=>Number(x.match(/^[\d.,\s\u00a0]+/)[0].replace(/[.,\s\u00a0]/g,'')));
  const unique=[...new Set(numbers)];
  if(unique.length!==1||!Number.isInteger(unique[0])||unique[0]<1||unique[0]>10000)throw Error('YouTube toplam video sayısı kesin okunamadı. Eksik liste gönderilmedi; Daha Sonra İzle sayfasını kontrol et.');
  return unique[0];
}
export function newestItem(data,kit=createPlaylistTools()){
  const items=kit.findAll(data,'sortFilterSubMenuRenderer').flatMap(m=>m.subMenuItems||[]);
  const item=items.find(x=>/date added.*newest|eklendiği tarih.*en yeni|eklenme tarihi.*en yeni/i.test(kit.text(x.title)));
  if(!item)throw Error('YouTube sıralama menüsü tanınmadı. Daha Sonra İzle sayfasında Eklendiği tarih (en yeni) seç.');
  return item;
}
export async function collect(knownIds,expectedAccount){
  const kit=createPlaylistTools(),get=key=>window.ytcfg?.get?.(key)??window.ytcfg?.data_?.[key];
  const origin='https://www.youtube.com';
  if(location.origin!==origin||new URL(location.href).searchParams.get('list')!=='WL')throw Error('Daha Sonra İzle sayfası açılmadı. YouTube oturumunu kontrol et.');
  // A dedicated background tab is used; never read cookies outside YouTube.
  for(let i=0;i<60&&!get('INNERTUBE_CONTEXT')?.client?.clientVersion;i++)await new Promise(r=>setTimeout(r,250));
  const context=structuredClone(get('INNERTUBE_CONTEXT'));
  if(!context?.client?.clientVersion)throw Error('YouTube hazır değil. Oturum veya çerez onay ekranını kontrol et.');
  const session=String(get('SESSION_INDEX')??0),delegated=get('DELEGATED_SESSION_ID')||'',identity=get('DATASYNC_ID')||delegated;
  if(!identity)throw Error('YouTube hesap kimliği doğrulanamadı. Doğru hesapla oturum aç.');
  const account=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('laterlab-youtube:'+identity)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(expectedAccount&&account!==expectedAccount)throw Error('YouTube hesabı değişmiş. Yanlış hesaptan video aktarılmadı; bağlı YouTube hesabını aç.');
  const check=()=>{if(location.origin!==origin||new URL(location.href).searchParams.get('list')!=='WL'||session!==String(get('SESSION_INDEX')??0)||delegated!==(get('DELEGATED_SESSION_ID')||'')||identity!==(get('DATASYNC_ID')||get('DELEGATED_SESSION_ID')||''))throw Error('Tarama sırasında YouTube hesabı veya sayfa değişti. Güncelleme iptal edildi.');};
  async function request(body,path='/youtubei/v1/browse'){
    check();
    const cookies=Object.fromEntries(document.cookie.split(';').map(s=>{const i=s.indexOf('=');return [s.slice(0,i).trim(),s.slice(i+1)]}));
    const sid=cookies.SAPISID||cookies['__Secure-3PAPISID'];if(!sid)throw Error('YouTube oturumu bulunamadı. Firefox’ta YouTube’a giriş yap.');
    const time=Math.floor(Date.now()/1000),digest=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(`${time} ${sid} ${origin}`));
    const auth=`SAPISIDHASH ${time}_${[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}`;
    const headers={'Content-Type':'application/json','X-Youtube-Client-Name':String(get('INNERTUBE_CONTEXT_CLIENT_NAME')||1),'X-Youtube-Client-Version':context.client.clientVersion,'X-Goog-Authuser':session,'X-Origin':origin,Authorization:auth};
    if(delegated)headers['X-Goog-PageId']=delegated;
    if(context.client.visitorData)headers['X-Goog-Visitor-Id']=context.client.visitorData;
    const response=await fetch(path+'?prettyPrint=false',{method:'POST',credentials:'same-origin',redirect:'error',headers,body:JSON.stringify({context,...body}),signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw Error('YouTube isteği tamamlanamadı ('+response.status+'). Sonraki kontrolde tekrar denenecek.');
    const result=await response.json();check();if(result.error)throw Error('YouTube liste isteğini reddetti.');
    if(result.responseContext?.visitorData)context.client.visitorData=result.responseContext.visitorData;
    return result;
  }
  let firstBody={browseId:'VLWL'},first=await request(firstBody);
  const item=newestItem(first,kit);
  if(!item.selected){
    const endpoint=item.serviceEndpoint||item.navigationEndpoint;
    const browse=endpoint?.browseEndpoint;
    if(browse?.browseId==='VLWL'&&typeof browse.params==='string')firstBody={browseId:'VLWL',params:browse.params};
    else {
      const edit=endpoint?.playlistEditEndpoint,actions=edit?.actions,path=endpoint?.commandMetadata?.webCommandMetadata?.apiUrl;
      if(edit?.playlistId!=='WL'||!Array.isArray(actions)||actions.length!==1||actions[0].action!=='ACTION_SET_PLAYLIST_VIDEO_ORDER'||!Number.isInteger(Number(actions[0].playlistVideoOrder))||!/^\/youtubei\/v1\/(?:browse\/edit_playlist|playlist\/edit)$/.test(path||''))throw Error('YouTube sıralaması otomatik değiştirilemedi. Bir kez Eklendiği tarih (en yeni) seçip tekrar dene.');
      await request({playlistId:'WL',actions:[{action:'ACTION_SET_PLAYLIST_VIDEO_ORDER',playlistVideoOrder:actions[0].playlistVideoOrder}]},path);
    }
    first=await request(firstBody);
  }
  if(!newestItem(first,kit).selected)throw Error('En yeni sıralaması doğrulanmadı. Güncelleme yapılmadı.');
  const expected=totalOf(first,kit);
  // Always fetch the head again at the end; reuse the verified first response once.
  let useFirst=true;
  const scanRequest=async body=>{if(useFirst&&!body.continuation){useFirst=false;return first}const result=await request(body);if(!body.continuation&&totalOf(result,kit)!==expected)throw Error('Tarama sırasında liste sayısı değişti. Sonraki kontrolde tekrar denenecek.');return result};
  const delta=await kit.scanNew({request:scanRequest,knownIds,expected,checkpoint:{},firstBody});check();
  return {account,delta};
}

// Installed in YouTube MAIN world from this locally bundled extension file.
globalThis.__laterlabCollect=collect;
