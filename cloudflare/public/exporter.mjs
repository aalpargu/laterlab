// Serialized into the bookmark: no remote scripts, libraries or server required.
export function createPlaylistTools() {
  const text = v => typeof v === 'string' ? v : v?.simpleText ?? v?.runs?.map(r => r.text || '').join('') ?? '';
  function findAll(root, key) {
    const found = [], stack = [root], seen = new Set();
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      if (node[key]) found.push(node[key]);
      for (const value of Object.values(node)) if (value && typeof value === 'object') stack.push(value);
    }
    return found;
  }
  function assertOrder(data, order = 'oldest') {
    const items = findAll(data, 'sortFilterSubMenuRenderer').flatMap(m => m.subMenuItems || []);
    const selected = items.filter(i => i.selected === true);
    const oldest = selected.some(item => {
      const action = item.serviceEndpoint?.playlistEditEndpoint?.actions?.find(a => a.action === 'ACTION_SET_PLAYLIST_VIDEO_ORDER');
      if (order === 'oldest' && action?.playlistVideoOrder != null) return Number(action.playlistVideoOrder) === 2;
      const label = text(item.title).toLocaleLowerCase('tr');
      return (order === 'newest' ? /date added.*newest|eklendiği tarih.*en yeni|eklenme tarihi.*en yeni/ : /date added.*oldest|eklendiği tarih.*en eski|eklenme tarihi.*en eski/).test(label);
    });
    if (!oldest || selected.length !== 1) throw Error(`${order === 'newest' ? 'En yeni' : 'En eski'} sıralaması doğrulanamadı. YouTube’da “Eklendiği tarih (${order === 'newest' ? 'en yeni' : 'en eski'})” seç, sayfanın güncellenmesini bekle ve yeniden dene.`);
  }
  const assertOldest = data => assertOrder(data, 'oldest');
  function referenceIds(data) {
    let ids;
    if (data?.format === 'siradaki-sync-reference-v1') ids = data.ids;
    else if (data?.format === 'siradaki-backup-v1') ids = data.videos?.map(v => v.id);
    else if (data?.format === 'siradaki-export-v1' && data.complete === true && data.order === 'oldest' && Array.isArray(data.videos) && data.videos.length >= 1275 && data.videos.every((v,i) => v.position === i+1)) ids = data.videos.filter(v => v.id !== null).map(v => v.id);
    if (!Array.isArray(ids) || !ids.length || ids.length > 20000 || ids.some(id => typeof id !== 'string' || !/^[\w-]{11}$/.test(id)) || new Set(ids).size !== ids.length) throw Error('Güncel LaterLab referansını, yedeğini veya ilk tam aktarım JSON’unu seç. Yeni-videolar dosyası referans olarak kullanılamaz.');
    return ids;
  }
  // YouTube may wrap the command in an executor or a load-more button.
  // Follow only known command wrappers inside this list's continuation item;
  // never search the whole response for an arbitrary token (menus/recommendations).
  function continuationTokens(item) {
    const renderer = item.continuationItemRenderer;
    const button = renderer?.button?.buttonRenderer;
    const stack = [renderer?.continuationEndpoint, button?.command,
      button?.serviceEndpoint, button?.navigationEndpoint,
      item.continuationItemViewModel?.continuationCommand?.innertubeCommand];
    const tokens = new Set(), seen = new Set();
    while (stack.length) {
      const endpoint = stack.pop();
      if (!endpoint || typeof endpoint !== 'object' || seen.has(endpoint)) continue;
      seen.add(endpoint);
      const token = endpoint.continuationCommand?.token;
      if (typeof token === 'string' && token.trim()) tokens.add(token);
      if (endpoint.innertubeCommand) stack.push(endpoint.innertubeCommand);
      const commands = endpoint.commandExecutorCommand?.commands;
      if (Array.isArray(commands)) stack.push(...commands);
    }
    if (!tokens.size) throw Error('Sonraki liste sayfasının anahtarı okunamadı. v3 aktarım yer iminin güncel olduğundan emin ol.');
    return [...tokens];
  }
  function page(data) {
    if (data?.error || findAll(data, 'alertRenderer').some(a => a.type === 'ERROR')) throw Error('YouTube listeyi vermedi. Doğru hesapla oturum açıldığını kontrol et.');
    const initial = findAll(data?.contents, 'playlistVideoListRenderer');
    let blocks = initial.map(p => ({items:p.contents, legacy:p.continuations}));
    if (!blocks.length) {
      const legacy = data?.continuationContents?.playlistVideoListContinuation;
      if (legacy) blocks.push({items:legacy.contents, legacy:legacy.continuations});
      for (const command of [...(data?.onResponseReceivedActions || []), ...(data?.onResponseReceivedEndpoints || []), ...(data?.onResponseReceivedCommands || [])]) {
        const action = command.appendContinuationItemsAction || command.reloadContinuationItemsCommand;
        if (!action || /recommend/i.test(action.targetId || '')) continue;
        const items = action.continuationItems;
        if (Array.isArray(items) && (items.some(i => i.playlistVideoRenderer) || /playlist.*video.*list/i.test(action.targetId || ''))) blocks.push({items});
      }
    }
    if (blocks.length !== 1 || !Array.isArray(blocks[0].items)) throw Error('YouTube liste biçimi tanınmadı. Eksik dosya oluşturulmadı.');
    const rows = [], tokens = [];
    for (const item of blocks[0].items) {
      const r = item.playlistVideoRenderer;
      if (r) {
        if (/RECOMMENDED/.test(r.style || '')) continue;
        const raw = text(r.index).trim(), position = raw ? Number(raw.replace(/[.,\s]/g, '')) : null;
        if (raw && (!Number.isInteger(position) || position < 1)) throw Error('Video sıra numarası okunamadı.');
        const overlays = r.thumbnailOverlays || [];
        const progress = overlays.find(o => o.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer?.percentDurationWatched;
        rows.push({id:/^[\w-]{11}$/.test(r.videoId || '') ? r.videoId : null,
          title:text(r.title) || 'Kullanılamayan video', channel:text(r.shortBylineText || r.longBylineText), position,
          duration:text(r.lengthText) || text(overlays.find(o => o.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text),
          progress:typeof progress === 'number' && Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null,
          entryKey:r.setVideoId || r.playlistSetVideoId || null});
      } else if (item.continuationItemRenderer || item.continuationItemViewModel) {
        tokens.push(...continuationTokens(item));
      } else throw Error('Listede tanınmayan bir kayıt var; ilk 1274 sınırını korumak için aktarım durduruldu.');
    }
    for (const c of blocks[0].legacy || []) if (c.nextContinuationData?.continuation) tokens.push(c.nextContinuationData.continuation);
    const unique = [...new Set(tokens)];
    if (unique.length > 1) throw Error('Birden fazla liste devamı bulundu; aktarım durduruldu.');
    return {rows, next:unique[0] || null};
  }
  const signature = rows => JSON.stringify(rows.map(r => [r.id, r.entryKey, r.position]));
  function append(cp, batch, expected) {
    const ids = new Set(), keys = new Set();
    const incoming = [];
    for (const row of batch.rows) {
      const position = cp.rows.length + incoming.length + 1;
      if (row.position !== null && row.position !== position) throw Error('Liste sırasında boşluk veya değişiklik bulundu. Sıralamayı/listeni değiştirmeden yeniden başlat.');
      if ((row.id && (cp.ids.has(row.id) || ids.has(row.id))) || (row.entryKey && (cp.keys.has(row.entryKey) || keys.has(row.entryKey)))) throw Error('Tekrarlanan video bulundu. Liste aktarım sırasında değişmiş olabilir; yeniden başlat.');
      if (row.id) ids.add(row.id);
      if (row.entryKey) keys.add(row.entryKey);
      incoming.push({...row, position});
    }
    if (cp.rows.length + incoming.length > expected) throw Error('Girilen toplamdan daha fazla video var. Toplam sayıyı kontrol edip yeniden başlat.');
    cp.rows.push(...incoming); cp.next = batch.next; cp.pages++;
    for (const id of ids) cp.ids.add(id);
    for (const key of keys) cp.keys.add(key);
  }
  async function scan({request, expected, checkpoint:cp, onProgress = () => {}, signal, firstBody = {browseId:'VLWL'}}) {
    const checkAbort = () => { if (signal?.aborted) throw new DOMException('İptal edildi', 'AbortError'); };
    checkAbort();
    const first = await request(firstBody); checkAbort(); assertOldest(first);
    const firstPage = page(first), stamp = signature(firstPage.rows);
    if (cp.started) {
      if (cp.signature !== stamp) throw Error('Listenin başlangıcı değişti. Kapatıp aktarımı yeniden başlat.');
    } else {
      cp.rows = []; cp.tokens = new Set(); cp.ids = new Set(); cp.keys = new Set(); cp.pages = 0;
      append(cp, firstPage, expected); cp.signature = stamp; cp.started = true;
    }
    onProgress(cp);
    while (cp.next) {
      checkAbort();
      const token = cp.next;
      if (cp.tokens.has(token) || cp.pages >= 200) throw Error('YouTube aynı liste sayfasını tekrarladı. Kapatıp yeniden başlat.');
      const response = await request({continuation:token}); checkAbort();
      append(cp, page(response), expected); cp.tokens.add(token); onProgress(cp);
    }
    if (cp.rows.length !== expected) throw Error(`Liste eksik: ${cp.rows.length} / ${expected}. Toplam sayıyı kontrol et; YouTube menüsünden kullanılamayan videoları gösterip yeniden başlat.`);
    const last = await request(firstBody); checkAbort(); assertOldest(last);
    if (signature(page(last).rows) !== cp.signature) throw Error('Liste aktarım sırasında değişti. Dosya kaydedilmedi; yeniden başlat.');
    return {format:'siradaki-export-v1',method:'innertube-v3',order:'oldest',complete:true,total:expected,exportedAt:new Date().toISOString(),videos:cp.rows.map(({entryKey,...row}) => row)};
  }
  async function scanNew({request, knownIds, expected, checkpoint:cp, onProgress = () => {}, signal, firstBody = {browseId:'VLWL'}}) {
    const known = new Set(referenceIds({format:'siradaki-sync-reference-v1',ids:knownIds}));
    const checkAbort = () => { if (signal?.aborted) throw new DOMException('İptal edildi','AbortError'); };
    checkAbort();
    const first = await request(firstBody); checkAbort(); assertOrder(first,'newest');
    const firstPage = page(first), stamp = signature(firstPage.rows);
    if (cp.started) {
      if (cp.signature !== stamp) throw Error('Listenin başlangıcı değişti. Kapatıp güncellemeyi yeniden başlat.');
    } else {
      cp.rows=[]; cp.tokens=new Set(); cp.ids=new Set(); cp.keys=new Set(); cp.pages=0;
      cp.signature=stamp; cp.stopReason=null; cp.matchedIds=[];
      append(cp,firstPage,expected); inspect(firstPage); cp.started=true;
    }
    function inspect(batch) {
      // Require a whole non-empty data page of known IDs, not just one match:
      // a re-added known video at the head must not hide new videos after it.
      if (batch.rows.length && batch.rows.every(r => r.id && known.has(r.id))) {
        cp.stopReason='known-page'; cp.matchedIds=batch.rows.map(r=>r.id);
      } else if (!batch.next) cp.stopReason='end';
    }
    onProgress(cp);
    while (!cp.stopReason && cp.next) {
      checkAbort();
      const token=cp.next;
      if (cp.tokens.has(token) || cp.pages>=200) throw Error('YouTube aynı liste sayfasını tekrarladı. Güncelleme durduruldu.');
      const response=await request({continuation:token}); checkAbort();
      const batch=page(response); append(cp,batch,expected); cp.tokens.add(token); inspect(batch); onProgress(cp);
    }
    if (!cp.next && cp.rows.length!==expected) throw Error(`Liste eksik: ${cp.rows.length} / ${expected}. Tam sayıyı ve kullanılamayan videoları kontrol et.`);
    if (!cp.stopReason) throw Error('Güncellemenin bitişi doğrulanamadı.');
    if (cp.stopReason==='end') cp.matchedIds=cp.rows.filter(r=>r.id&&known.has(r.id)).slice(0,100).map(r=>r.id);
    if (!cp.matchedIds.length) throw Error('Referansınla ortak video bulunamadı. Doğru YouTube hesabını ve referans dosyasını kontrol et; gerekirse tam aktarım kullan.');
    const last=await request(firstBody); checkAbort(); assertOrder(last,'newest');
    if (signature(page(last).rows)!==cp.signature) throw Error('Liste güncelleme sırasında değişti. Dosya kaydedilmedi; yeniden başlat.');
    return {format:'siradaki-delta-v1',method:'innertube-v3',scope:'new-only',order:'newest',complete:true,
      baseIds:[...known],stopReason:cp.stopReason,matchedIds:cp.matchedIds,total:expected,scanned:cp.rows.length,
      exportedAt:new Date().toISOString(),videos:cp.rows.filter(r=>r.id&&!known.has(r.id)).map(({entryKey,...row})=>({...row,position:null}))};
  }
  return {text,findAll,assertOldest,page,scan,scanNew,referenceIds};
}

// Invoked only in the user's YouTube tab. Session material stays in memory and
// goes only to YouTube's same-origin browse endpoint, never into the export.
export async function exportWatchLater(makeTools, mode = 'full') {
  if (location.origin !== 'https://www.youtube.com' || new URL(location.href).searchParams.get('list') !== 'WL') { alert('YouTube Daha Sonra İzle listesini aç, sonra bu yer imine tıkla.'); return; }
  if (document.getElementById('siradaki-export-panel')) { alert('Aktarım paneli zaten açık.'); return; }
  const incremental = mode === 'new';
  const raw = prompt(incremental ? 'Yeni videoları almak için “Eklendiği tarih (en yeni)” seç. YouTube’da yazan güncel toplam video sayısını gir. Sonraki adımda LaterLab referans dosyanı seçeceksin.' : 'Önce “Eklendiği tarih (en eski)” sıralamasını seç. YouTube’da yazan tam video sayısını gir (ör. 3128). İlk 1274 bu sıraya göre dışlanacak.');
  if (raw === null) return;
  const expected = Number(raw.replace(/[.,\s]/g,''));
  if (!Number.isInteger(expected) || expected < 1 || expected > 10000) { alert('Listedeki gerçek toplam sayıyı gir (1–10000). İlk kurulum için en az 1275 sıra gerekir; mevcut kütüphane daha kısa bir listeyle de yenilenebilir.'); return; }
  const box = document.createElement('div'); box.id = 'siradaki-export-panel';
  Object.assign(box.style,{position:'fixed',top:'80px',right:'24px',zIndex:'2147483647',background:'#172019',color:'#eff8e8',padding:'22px',border:'1px solid #a7cd71',borderRadius:'12px',fontFamily:'system-ui',fontSize:'16px',width:'340px',maxWidth:'85vw',boxShadow:'0 8px 40px #0008'});
  const label = document.createElement('p'); label.setAttribute('role','status'); box.append(label);
  const detail = document.createElement('p'); detail.style.fontSize = '13px'; box.append(detail);
  const retry = document.createElement('button'); retry.textContent = 'Kaldığı yerden tekrar dene'; retry.hidden = true; box.append(retry);
  const stop = document.createElement('button'); stop.textContent = 'İptal et'; box.append(stop);
  for (const b of [retry,stop]) Object.assign(b.style,{padding:'8px 12px',margin:'4px',cursor:'pointer'});
  document.body.append(box);
  const controller = new AbortController(), checkpoint = {}, started = Date.now();
  stop.onclick = () => { controller.abort(); box.remove(); };
  const kit = makeTools(), get = key => window.ytcfg?.get?.(key) ?? window.ytcfg?.data_?.[key];
  let knownIds = null;
  const choose = incremental ? document.createElement('input') : null;
  if (choose) { choose.type='file'; choose.accept='.json,application/json'; choose.setAttribute('aria-label','LaterLab güncelleme referansı'); box.append(choose); }
  const session = String(get('SESSION_INDEX') ?? 0), delegated = get('DELEGATED_SESSION_ID') || '';
  const context = get('INNERTUBE_CONTEXT') ? JSON.parse(JSON.stringify(get('INNERTUBE_CONTEXT'))) : null;
  const firstBody = {browseId:'VLWL'};
  const currentData = document.querySelector('ytd-browse[page-subtype="playlist"]')?.data || window.ytInitialData;
  const endpoint = kit.findAll(currentData,'browseEndpoint').find(e => e.browseId === 'VLWL' && e.params);
  if (endpoint) firstBody.params = endpoint.params;
  function checkSession() {
    if (location.origin !== 'https://www.youtube.com' || new URL(location.href).searchParams.get('list') !== 'WL' || String(get('SESSION_INDEX') ?? 0) !== session || (get('DELEGATED_SESSION_ID') || '') !== delegated) throw Error('Sayfa veya hesap değişti. Daha Sonra İzle’yi yeniden açıp aktarımı başlat.');
  }
  async function authHeader() {
    const cookies = Object.fromEntries(document.cookie.split(';').map(s => { const i=s.indexOf('='); return [s.slice(0,i).trim(),s.slice(i+1)]; }));
    const sid = cookies.SAPISID || cookies['__Secure-3PAPISID'];
    if (!sid) throw Error('YouTube oturumu okunamadı. Firefox’ta doğru hesabınla giriş yapıp sayfayı yenile.');
    const time = Math.floor(Date.now()/1000);
    const digest = await crypto.subtle.digest('SHA-1',new TextEncoder().encode(`${time} ${sid} https://www.youtube.com`));
    return `SAPISIDHASH ${time}_${Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}`;
  }
  function wait(ms) {
    return new Promise((resolve,reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('İptal edildi','AbortError')); };
      const timer = setTimeout(() => { controller.signal.removeEventListener('abort',abort); resolve(); },ms);
      if (controller.signal.aborted) abort(); else controller.signal.addEventListener('abort',abort,{once:true});
    });
  }
  async function request(body) {
    if (!context?.client?.clientVersion) throw Error('YouTube yapılandırması hazır değil. Sayfayı yenileyip yeniden başlat.');
    for (let attempt=0; attempt<3; attempt++) {
      checkSession();
      if (controller.signal.aborted) throw new DOMException('İptal edildi','AbortError');
      const headers = {'Content-Type':'application/json','X-Youtube-Client-Name':String(get('INNERTUBE_CONTEXT_CLIENT_NAME') || 1),'X-Youtube-Client-Version':context.client.clientVersion,'X-Goog-Authuser':session,'X-Origin':location.origin,Authorization:await authHeader()};
      if (delegated) headers['X-Goog-PageId'] = delegated;
      if (context.client.visitorData) headers['X-Goog-Visitor-Id'] = context.client.visitorData;
      if (controller.signal.aborted) throw new DOMException('İptal edildi','AbortError');
      const deadline = new AbortController(), abort = () => deadline.abort();
      controller.signal.addEventListener('abort',abort,{once:true});
      const timeout = setTimeout(abort,25000);
      try {
        const response = await fetch('/youtubei/v1/browse?prettyPrint=false',{method:'POST',credentials:'same-origin',redirect:'error',headers,body:JSON.stringify({context,...body}),signal:deadline.signal});
        if (!response.ok) {
          const error = Error(response.status === 401 || response.status === 403 ? 'YouTube oturumu isteği reddetti. Doğru hesabı açıp sayfayı yenile.' : `YouTube yanıtı: HTTP ${response.status}.`);
          error.retryable = response.status === 429 || response.status >= 500; throw error;
        }
        const result = await response.json(); checkSession();
        if (result.responseContext?.visitorData) context.client.visitorData = result.responseContext.visitorData;
        return result;
      } catch (error) {
        if (controller.signal.aborted) throw new DOMException('İptal edildi','AbortError');
        const retryable = error.retryable || error.name === 'TypeError' || error.name === 'AbortError';
        if (!retryable || attempt === 2) throw Error(retryable ? 'Bağlantı tamamlanamadı. Okunan kayıtlar panelde tutuluyor; tekrar deneyebilirsin.' : error.message);
        detail.textContent = 'YouTube yanıtı gecikti; kısa bir beklemeden sonra yeniden deneniyor…';
      } finally { clearTimeout(timeout); controller.signal.removeEventListener('abort',abort); }
      await wait(1000 * 2 ** attempt);
    }
  }
  let running = false;
  async function run() {
    if (running || controller.signal.aborted || (incremental && !knownIds)) return;
    running = true; retry.hidden = true;
    label.textContent = `LaterLab · ${incremental ? 'Yeni videolar v3' : 'Tam aktarım v3'} · Sıralama doğrulanıyor…`;
    detail.textContent = 'Liste verisi doğrudan alınıyor. Sayfayı kaydırmana gerek yok; hesabı veya sıralamayı değiştirme.';
    try {
      const data = await (incremental ? kit.scanNew : kit.scan)({request,knownIds,expected,checkpoint,firstBody,signal:controller.signal,onProgress:cp => {
        label.textContent = `LaterLab · ${cp.rows.length} / ${expected} kayıt kontrol edildi · ${cp.pages} veri paketi`;
        detail.textContent = `Kaydırmasız aktarım · ${Math.round((Date.now()-started)/1000)} saniye · YouTube listesini açık tut.`;
      }});
      checkSession(); if (controller.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
      const filename = incremental ? 'laterlab-yeni-videolar.json' : 'laterlab-watch-later.json';
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      label.textContent = `${incremental ? data.videos.length + ' yeni video' : data.total + ' video'} hazır · ${checkpoint.pages} veri paketi · ${Math.round((Date.now()-started)/1000)} saniye`;
      detail.textContent = `${filename} dosyasını LaterLab’de içe aktar. ${incremental ? 'Eski videoların ilerlemesi ve silinmeleri bu modda güncellenmez.' : 'Oturum bilgileri dosyaya dahil edilmedi.'}`;
      stop.textContent = 'Kapat';
    } catch (error) {
      if (controller.signal.aborted) return;
      label.textContent = 'Aktarım durdu: ' + error.message;
      detail.textContent = `${checkpoint.rows?.length || 0} / ${expected} kayıt alındı. Eksik dosya kaydedilmedi.`;
      retry.hidden = false; stop.textContent = 'Kapat';
    } finally { running = false; }
  }
  retry.onclick = run;
  if (choose) {
    label.textContent='LaterLab · Yeni videolar v3 · Referans dosyanı seç';
    detail.textContent='LaterLab’den indirdiğin güncel referansı seç. İlk tam aktarım JSON’u veya güncel LaterLab yedeği de kullanılabilir. Dosya yalnızca bu sekmede okunur.';
    choose.onchange = async () => {
      const file=choose.files?.[0]; if (!file || running || knownIds) return;
      try {
        if(file.size>30*1024*1024) throw Error('Dosya 30 MB sınırını aşıyor.');
        knownIds=kit.referenceIds(JSON.parse(await file.text()));
        if(controller.signal.aborted) return;
        choose.disabled=true; choose.hidden=true; await run();
      } catch(error) { label.textContent='Referans okunamadı: '+error.message; }
    };
  } else await run();
}

// Preserve newlines/comments, percent signs and Unicode inside the bookmark URL.
export const bookmarklet = 'javascript:' + encodeURIComponent(`void (${exportWatchLater.toString()})(${createPlaylistTools.toString()});`);
export const incrementalBookmarklet = 'javascript:' + encodeURIComponent(`void (${exportWatchLater.toString()})(${createPlaylistTools.toString()},'new');`);
