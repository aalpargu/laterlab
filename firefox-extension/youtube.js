(() => {
  // cloudflare/public/exporter.mjs
  function createPlaylistTools() {
    const text = (v) => typeof v === "string" ? v : v?.simpleText ?? v?.runs?.map((r) => r.text || "").join("") ?? "";
    function findAll(root, key) {
      const found = [], stack = [root], seen = /* @__PURE__ */ new Set();
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== "object" || seen.has(node)) continue;
        seen.add(node);
        if (node[key]) found.push(node[key]);
        for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
      }
      return found;
    }
    function assertOrder(data, order = "oldest") {
      const items = findAll(data, "sortFilterSubMenuRenderer").flatMap((m) => m.subMenuItems || []);
      const selected = items.filter((i) => i.selected === true);
      const oldest = selected.some((item) => {
        const action = item.serviceEndpoint?.playlistEditEndpoint?.actions?.find((a) => a.action === "ACTION_SET_PLAYLIST_VIDEO_ORDER");
        if (order === "oldest" && action?.playlistVideoOrder != null) return Number(action.playlistVideoOrder) === 2;
        const label = text(item.title).toLocaleLowerCase("tr");
        return (order === "newest" ? /date added.*newest|eklendiği tarih.*en yeni|eklenme tarihi.*en yeni/ : /date added.*oldest|eklendiği tarih.*en eski|eklenme tarihi.*en eski/).test(label);
      });
      if (!oldest || selected.length !== 1) throw Error(`${order === "newest" ? "En yeni" : "En eski"} s\u0131ralamas\u0131 do\u011Frulanamad\u0131. YouTube\u2019da \u201CEklendi\u011Fi tarih (${order === "newest" ? "en yeni" : "en eski"})\u201D se\xE7, sayfan\u0131n g\xFCncellenmesini bekle ve yeniden dene.`);
    }
    const assertOldest = (data) => assertOrder(data, "oldest");
    function referenceIds(data) {
      let ids;
      if (data?.format === "siradaki-sync-reference-v1") ids = data.ids;
      else if (data?.format === "siradaki-backup-v1") ids = data.videos?.map((v) => v.id);
      else if (data?.format === "siradaki-export-v1" && data.complete === true && data.order === "oldest" && Array.isArray(data.videos) && data.videos.length >= 1275 && data.videos.every((v, i) => v.position === i + 1)) ids = data.videos.filter((v) => v.id !== null).map((v) => v.id);
      if (!Array.isArray(ids) || !ids.length || ids.length > 2e4 || ids.some((id) => typeof id !== "string" || !/^[\w-]{11}$/.test(id)) || new Set(ids).size !== ids.length) throw Error("G\xFCncel LaterLab referans\u0131n\u0131, yede\u011Fini veya ilk tam aktar\u0131m JSON\u2019unu se\xE7. Yeni-videolar dosyas\u0131 referans olarak kullan\u0131lamaz.");
      return ids;
    }
    function continuationTokens(item) {
      const renderer = item.continuationItemRenderer;
      const button = renderer?.button?.buttonRenderer;
      const stack = [
        renderer?.continuationEndpoint,
        button?.command,
        button?.serviceEndpoint,
        button?.navigationEndpoint,
        item.continuationItemViewModel?.continuationCommand?.innertubeCommand
      ];
      const tokens = /* @__PURE__ */ new Set(), seen = /* @__PURE__ */ new Set();
      while (stack.length) {
        const endpoint = stack.pop();
        if (!endpoint || typeof endpoint !== "object" || seen.has(endpoint)) continue;
        seen.add(endpoint);
        const token = endpoint.continuationCommand?.token;
        if (typeof token === "string" && token.trim()) tokens.add(token);
        if (endpoint.innertubeCommand) stack.push(endpoint.innertubeCommand);
        const commands = endpoint.commandExecutorCommand?.commands;
        if (Array.isArray(commands)) stack.push(...commands);
      }
      if (!tokens.size) throw Error("Sonraki liste sayfas\u0131n\u0131n anahtar\u0131 okunamad\u0131. v3 aktar\u0131m yer iminin g\xFCncel oldu\u011Fundan emin ol.");
      return [...tokens];
    }
    function page(data) {
      if (data?.error || findAll(data, "alertRenderer").some((a) => a.type === "ERROR")) throw Error("YouTube listeyi vermedi. Do\u011Fru hesapla oturum a\xE7\u0131ld\u0131\u011F\u0131n\u0131 kontrol et.");
      const initial = findAll(data?.contents, "playlistVideoListRenderer");
      let blocks = initial.map((p) => ({ items: p.contents, legacy: p.continuations }));
      if (!blocks.length) {
        const legacy = data?.continuationContents?.playlistVideoListContinuation;
        if (legacy) blocks.push({ items: legacy.contents, legacy: legacy.continuations });
        for (const command of [...data?.onResponseReceivedActions || [], ...data?.onResponseReceivedEndpoints || [], ...data?.onResponseReceivedCommands || []]) {
          const action = command.appendContinuationItemsAction || command.reloadContinuationItemsCommand;
          if (!action || /recommend/i.test(action.targetId || "")) continue;
          const items = action.continuationItems;
          if (Array.isArray(items) && (items.some((i) => i.playlistVideoRenderer) || /playlist.*video.*list/i.test(action.targetId || ""))) blocks.push({ items });
        }
      }
      if (blocks.length !== 1 || !Array.isArray(blocks[0].items)) throw Error("YouTube liste bi\xE7imi tan\u0131nmad\u0131. Eksik dosya olu\u015Fturulmad\u0131.");
      const rows = [], tokens = [];
      for (const item of blocks[0].items) {
        const r = item.playlistVideoRenderer;
        if (r) {
          if (/RECOMMENDED/.test(r.style || "")) continue;
          const raw = text(r.index).trim(), position = raw ? Number(raw.replace(/[.,\s]/g, "")) : null;
          if (raw && (!Number.isInteger(position) || position < 1)) throw Error("Video s\u0131ra numaras\u0131 okunamad\u0131.");
          const overlays = r.thumbnailOverlays || [];
          const progress = overlays.find((o) => o.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer?.percentDurationWatched;
          rows.push({
            id: /^[\w-]{11}$/.test(r.videoId || "") ? r.videoId : null,
            title: text(r.title) || "Kullan\u0131lamayan video",
            channel: text(r.shortBylineText || r.longBylineText),
            position,
            duration: text(r.lengthText) || text(overlays.find((o) => o.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text),
            progress: typeof progress === "number" && Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null,
            entryKey: r.setVideoId || r.playlistSetVideoId || null
          });
        } else if (item.continuationItemRenderer || item.continuationItemViewModel) {
          tokens.push(...continuationTokens(item));
        } else throw Error("Listede tan\u0131nmayan bir kay\u0131t var; ilk 1274 s\u0131n\u0131r\u0131n\u0131 korumak i\xE7in aktar\u0131m durduruldu.");
      }
      for (const c of blocks[0].legacy || []) if (c.nextContinuationData?.continuation) tokens.push(c.nextContinuationData.continuation);
      const unique = [...new Set(tokens)];
      if (unique.length > 1) throw Error("Birden fazla liste devam\u0131 bulundu; aktar\u0131m durduruldu.");
      return { rows, next: unique[0] || null };
    }
    const signature = (rows) => JSON.stringify(rows.map((r) => [r.id, r.entryKey, r.position]));
    function append(cp, batch, expected) {
      const ids = /* @__PURE__ */ new Set(), keys = /* @__PURE__ */ new Set();
      const incoming = [];
      for (const row of batch.rows) {
        const position = cp.rows.length + incoming.length + 1;
        if (row.position !== null && row.position !== position) throw Error("Liste s\u0131ras\u0131nda bo\u015Fluk veya de\u011Fi\u015Fiklik bulundu. S\u0131ralamay\u0131/listeni de\u011Fi\u015Ftirmeden yeniden ba\u015Flat.");
        if (row.id && (cp.ids.has(row.id) || ids.has(row.id)) || row.entryKey && (cp.keys.has(row.entryKey) || keys.has(row.entryKey))) throw Error("Tekrarlanan video bulundu. Liste aktar\u0131m s\u0131ras\u0131nda de\u011Fi\u015Fmi\u015F olabilir; yeniden ba\u015Flat.");
        if (row.id) ids.add(row.id);
        if (row.entryKey) keys.add(row.entryKey);
        incoming.push({ ...row, position });
      }
      if (cp.rows.length + incoming.length > expected) throw Error("Girilen toplamdan daha fazla video var. Toplam say\u0131y\u0131 kontrol edip yeniden ba\u015Flat.");
      cp.rows.push(...incoming);
      cp.next = batch.next;
      cp.pages++;
      for (const id of ids) cp.ids.add(id);
      for (const key of keys) cp.keys.add(key);
    }
    async function scan({ request, expected, checkpoint: cp, onProgress = () => {
    }, signal, firstBody = { browseId: "VLWL" } }) {
      const checkAbort = () => {
        if (signal?.aborted) throw new DOMException("\u0130ptal edildi", "AbortError");
      };
      checkAbort();
      const first = await request(firstBody);
      checkAbort();
      assertOldest(first);
      const firstPage = page(first), stamp = signature(firstPage.rows);
      if (cp.started) {
        if (cp.signature !== stamp) throw Error("Listenin ba\u015Flang\u0131c\u0131 de\u011Fi\u015Fti. Kapat\u0131p aktar\u0131m\u0131 yeniden ba\u015Flat.");
      } else {
        cp.rows = [];
        cp.tokens = /* @__PURE__ */ new Set();
        cp.ids = /* @__PURE__ */ new Set();
        cp.keys = /* @__PURE__ */ new Set();
        cp.pages = 0;
        append(cp, firstPage, expected);
        cp.signature = stamp;
        cp.started = true;
      }
      onProgress(cp);
      while (cp.next) {
        checkAbort();
        const token = cp.next;
        if (cp.tokens.has(token) || cp.pages >= 200) throw Error("YouTube ayn\u0131 liste sayfas\u0131n\u0131 tekrarlad\u0131. Kapat\u0131p yeniden ba\u015Flat.");
        const response = await request({ continuation: token });
        checkAbort();
        append(cp, page(response), expected);
        cp.tokens.add(token);
        onProgress(cp);
      }
      if (cp.rows.length !== expected) throw Error(`Liste eksik: ${cp.rows.length} / ${expected}. Toplam say\u0131y\u0131 kontrol et; YouTube men\xFCs\xFCnden kullan\u0131lamayan videolar\u0131 g\xF6sterip yeniden ba\u015Flat.`);
      const last = await request(firstBody);
      checkAbort();
      assertOldest(last);
      if (signature(page(last).rows) !== cp.signature) throw Error("Liste aktar\u0131m s\u0131ras\u0131nda de\u011Fi\u015Fti. Dosya kaydedilmedi; yeniden ba\u015Flat.");
      return { format: "siradaki-export-v1", method: "innertube-v3", order: "oldest", complete: true, total: expected, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), videos: cp.rows.map(({ entryKey, ...row }) => row) };
    }
    async function scanNew({ request, knownIds, expected, checkpoint: cp, onProgress = () => {
    }, signal, firstBody = { browseId: "VLWL" } }) {
      const known = new Set(referenceIds({ format: "siradaki-sync-reference-v1", ids: knownIds }));
      const checkAbort = () => {
        if (signal?.aborted) throw new DOMException("\u0130ptal edildi", "AbortError");
      };
      checkAbort();
      const first = await request(firstBody);
      checkAbort();
      assertOrder(first, "newest");
      const firstPage = page(first), stamp = signature(firstPage.rows);
      if (cp.started) {
        if (cp.signature !== stamp) throw Error("Listenin ba\u015Flang\u0131c\u0131 de\u011Fi\u015Fti. Kapat\u0131p g\xFCncellemeyi yeniden ba\u015Flat.");
      } else {
        cp.rows = [];
        cp.tokens = /* @__PURE__ */ new Set();
        cp.ids = /* @__PURE__ */ new Set();
        cp.keys = /* @__PURE__ */ new Set();
        cp.pages = 0;
        cp.signature = stamp;
        cp.stopReason = null;
        cp.matchedIds = [];
        append(cp, firstPage, expected);
        inspect(firstPage);
        cp.started = true;
      }
      function inspect(batch) {
        if (batch.rows.length && batch.rows.every((r) => r.id && known.has(r.id))) {
          cp.stopReason = "known-page";
          cp.matchedIds = batch.rows.map((r) => r.id);
        } else if (!batch.next) cp.stopReason = "end";
      }
      onProgress(cp);
      while (!cp.stopReason && cp.next) {
        checkAbort();
        const token = cp.next;
        if (cp.tokens.has(token) || cp.pages >= 200) throw Error("YouTube ayn\u0131 liste sayfas\u0131n\u0131 tekrarlad\u0131. G\xFCncelleme durduruldu.");
        const response = await request({ continuation: token });
        checkAbort();
        const batch = page(response);
        append(cp, batch, expected);
        cp.tokens.add(token);
        inspect(batch);
        onProgress(cp);
      }
      if (!cp.next && cp.rows.length !== expected) throw Error(`Liste eksik: ${cp.rows.length} / ${expected}. Tam say\u0131y\u0131 ve kullan\u0131lamayan videolar\u0131 kontrol et.`);
      if (!cp.stopReason) throw Error("G\xFCncellemenin biti\u015Fi do\u011Frulanamad\u0131.");
      if (cp.stopReason === "end") cp.matchedIds = cp.rows.filter((r) => r.id && known.has(r.id)).slice(0, 100).map((r) => r.id);
      if (!cp.matchedIds.length) throw Error("Referans\u0131nla ortak video bulunamad\u0131. Do\u011Fru YouTube hesab\u0131n\u0131 ve referans dosyas\u0131n\u0131 kontrol et; gerekirse tam aktar\u0131m kullan.");
      const last = await request(firstBody);
      checkAbort();
      assertOrder(last, "newest");
      if (signature(page(last).rows) !== cp.signature) throw Error("Liste g\xFCncelleme s\u0131ras\u0131nda de\u011Fi\u015Fti. Dosya kaydedilmedi; yeniden ba\u015Flat.");
      return {
        format: "siradaki-delta-v1",
        method: "innertube-v3",
        scope: "new-only",
        order: "newest",
        complete: true,
        baseIds: [...known],
        stopReason: cp.stopReason,
        matchedIds: cp.matchedIds,
        total: expected,
        scanned: cp.rows.length,
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        videos: cp.rows.filter((r) => r.id && !known.has(r.id)).map(({ entryKey, ...row }) => ({ ...row, position: null }))
      };
    }
    return { text, findAll, assertOldest, page, scan, scanNew, referenceIds };
  }
  async function exportWatchLater(makeTools, mode = "full") {
    if (location.origin !== "https://www.youtube.com" || new URL(location.href).searchParams.get("list") !== "WL") {
      alert("YouTube Daha Sonra \u0130zle listesini a\xE7, sonra bu yer imine t\u0131kla.");
      return;
    }
    if (document.getElementById("siradaki-export-panel")) {
      alert("Aktar\u0131m paneli zaten a\xE7\u0131k.");
      return;
    }
    const incremental = mode === "new";
    const raw = prompt(incremental ? "Yeni videolar\u0131 almak i\xE7in \u201CEklendi\u011Fi tarih (en yeni)\u201D se\xE7. YouTube\u2019da yazan g\xFCncel toplam video say\u0131s\u0131n\u0131 gir. Sonraki ad\u0131mda LaterLab referans dosyan\u0131 se\xE7eceksin." : "\xD6nce \u201CEklendi\u011Fi tarih (en eski)\u201D s\u0131ralamas\u0131n\u0131 se\xE7. YouTube\u2019da yazan tam video say\u0131s\u0131n\u0131 gir (\xF6r. 3128). \u0130lk 1274 bu s\u0131raya g\xF6re d\u0131\u015Flanacak.");
    if (raw === null) return;
    const expected = Number(raw.replace(/[.,\s]/g, ""));
    if (!Number.isInteger(expected) || expected < 1 || expected > 1e4) {
      alert("Listedeki ger\xE7ek toplam say\u0131y\u0131 gir (1\u201310000). \u0130lk kurulum i\xE7in en az 1275 s\u0131ra gerekir; mevcut k\xFCt\xFCphane daha k\u0131sa bir listeyle de yenilenebilir.");
      return;
    }
    const box = document.createElement("div");
    box.id = "siradaki-export-panel";
    Object.assign(box.style, { position: "fixed", top: "80px", right: "24px", zIndex: "2147483647", background: "#172019", color: "#eff8e8", padding: "22px", border: "1px solid #a7cd71", borderRadius: "12px", fontFamily: "system-ui", fontSize: "16px", width: "340px", maxWidth: "85vw", boxShadow: "0 8px 40px #0008" });
    const label = document.createElement("p");
    label.setAttribute("role", "status");
    box.append(label);
    const detail = document.createElement("p");
    detail.style.fontSize = "13px";
    box.append(detail);
    const retry = document.createElement("button");
    retry.textContent = "Kald\u0131\u011F\u0131 yerden tekrar dene";
    retry.hidden = true;
    box.append(retry);
    const stop = document.createElement("button");
    stop.textContent = "\u0130ptal et";
    box.append(stop);
    for (const b of [retry, stop]) Object.assign(b.style, { padding: "8px 12px", margin: "4px", cursor: "pointer" });
    document.body.append(box);
    const controller = new AbortController(), checkpoint = {}, started = Date.now();
    stop.onclick = () => {
      controller.abort();
      box.remove();
    };
    const kit = makeTools(), get = (key) => window.ytcfg?.get?.(key) ?? window.ytcfg?.data_?.[key];
    let knownIds = null;
    const choose = incremental ? document.createElement("input") : null;
    if (choose) {
      choose.type = "file";
      choose.accept = ".json,application/json";
      choose.setAttribute("aria-label", "LaterLab g\xFCncelleme referans\u0131");
      box.append(choose);
    }
    const session = String(get("SESSION_INDEX") ?? 0), delegated = get("DELEGATED_SESSION_ID") || "";
    const context = get("INNERTUBE_CONTEXT") ? JSON.parse(JSON.stringify(get("INNERTUBE_CONTEXT"))) : null;
    const firstBody = { browseId: "VLWL" };
    const currentData = document.querySelector('ytd-browse[page-subtype="playlist"]')?.data || window.ytInitialData;
    const endpoint = kit.findAll(currentData, "browseEndpoint").find((e) => e.browseId === "VLWL" && e.params);
    if (endpoint) firstBody.params = endpoint.params;
    function checkSession() {
      if (location.origin !== "https://www.youtube.com" || new URL(location.href).searchParams.get("list") !== "WL" || String(get("SESSION_INDEX") ?? 0) !== session || (get("DELEGATED_SESSION_ID") || "") !== delegated) throw Error("Sayfa veya hesap de\u011Fi\u015Fti. Daha Sonra \u0130zle\u2019yi yeniden a\xE7\u0131p aktar\u0131m\u0131 ba\u015Flat.");
    }
    async function authHeader() {
      const cookies = Object.fromEntries(document.cookie.split(";").map((s) => {
        const i = s.indexOf("=");
        return [s.slice(0, i).trim(), s.slice(i + 1)];
      }));
      const sid = cookies.SAPISID || cookies["__Secure-3PAPISID"];
      if (!sid) throw Error("YouTube oturumu okunamad\u0131. Firefox\u2019ta do\u011Fru hesab\u0131nla giri\u015F yap\u0131p sayfay\u0131 yenile.");
      const time = Math.floor(Date.now() / 1e3);
      const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${time} ${sid} https://www.youtube.com`));
      return `SAPISIDHASH ${time}_${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
    }
    function wait(ms) {
      return new Promise((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException("\u0130ptal edildi", "AbortError"));
        };
        const timer = setTimeout(() => {
          controller.signal.removeEventListener("abort", abort);
          resolve();
        }, ms);
        if (controller.signal.aborted) abort();
        else controller.signal.addEventListener("abort", abort, { once: true });
      });
    }
    async function request(body) {
      if (!context?.client?.clientVersion) throw Error("YouTube yap\u0131land\u0131rmas\u0131 haz\u0131r de\u011Fil. Sayfay\u0131 yenileyip yeniden ba\u015Flat.");
      for (let attempt = 0; attempt < 3; attempt++) {
        checkSession();
        if (controller.signal.aborted) throw new DOMException("\u0130ptal edildi", "AbortError");
        const headers = { "Content-Type": "application/json", "X-Youtube-Client-Name": String(get("INNERTUBE_CONTEXT_CLIENT_NAME") || 1), "X-Youtube-Client-Version": context.client.clientVersion, "X-Goog-Authuser": session, "X-Origin": location.origin, Authorization: await authHeader() };
        if (delegated) headers["X-Goog-PageId"] = delegated;
        if (context.client.visitorData) headers["X-Goog-Visitor-Id"] = context.client.visitorData;
        if (controller.signal.aborted) throw new DOMException("\u0130ptal edildi", "AbortError");
        const deadline = new AbortController(), abort = () => deadline.abort();
        controller.signal.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(abort, 25e3);
        try {
          const response = await fetch("/youtubei/v1/browse?prettyPrint=false", { method: "POST", credentials: "same-origin", redirect: "error", headers, body: JSON.stringify({ context, ...body }), signal: deadline.signal });
          if (!response.ok) {
            const error = Error(response.status === 401 || response.status === 403 ? "YouTube oturumu iste\u011Fi reddetti. Do\u011Fru hesab\u0131 a\xE7\u0131p sayfay\u0131 yenile." : `YouTube yan\u0131t\u0131: HTTP ${response.status}.`);
            error.retryable = response.status === 429 || response.status >= 500;
            throw error;
          }
          const result = await response.json();
          checkSession();
          if (result.responseContext?.visitorData) context.client.visitorData = result.responseContext.visitorData;
          return result;
        } catch (error) {
          if (controller.signal.aborted) throw new DOMException("\u0130ptal edildi", "AbortError");
          const retryable = error.retryable || error.name === "TypeError" || error.name === "AbortError";
          if (!retryable || attempt === 2) throw Error(retryable ? "Ba\u011Flant\u0131 tamamlanamad\u0131. Okunan kay\u0131tlar panelde tutuluyor; tekrar deneyebilirsin." : error.message);
          detail.textContent = "YouTube yan\u0131t\u0131 gecikti; k\u0131sa bir beklemeden sonra yeniden deneniyor\u2026";
        } finally {
          clearTimeout(timeout);
          controller.signal.removeEventListener("abort", abort);
        }
        await wait(1e3 * 2 ** attempt);
      }
    }
    let running = false;
    async function run() {
      if (running || controller.signal.aborted || incremental && !knownIds) return;
      running = true;
      retry.hidden = true;
      label.textContent = `LaterLab \xB7 ${incremental ? "Yeni videolar v3" : "Tam aktar\u0131m v3"} \xB7 S\u0131ralama do\u011Frulan\u0131yor\u2026`;
      detail.textContent = "Liste verisi do\u011Frudan al\u0131n\u0131yor. Sayfay\u0131 kayd\u0131rmana gerek yok; hesab\u0131 veya s\u0131ralamay\u0131 de\u011Fi\u015Ftirme.";
      try {
        const data = await (incremental ? kit.scanNew : kit.scan)({ request, knownIds, expected, checkpoint, firstBody, signal: controller.signal, onProgress: (cp) => {
          label.textContent = `LaterLab \xB7 ${cp.rows.length} / ${expected} kay\u0131t kontrol edildi \xB7 ${cp.pages} veri paketi`;
          detail.textContent = `Kayd\u0131rmas\u0131z aktar\u0131m \xB7 ${Math.round((Date.now() - started) / 1e3)} saniye \xB7 YouTube listesini a\xE7\u0131k tut.`;
        } });
        checkSession();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
        const filename = incremental ? "laterlab-yeni-videolar.json" : "laterlab-watch-later.json";
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 6e4);
        label.textContent = `${incremental ? data.videos.length + " yeni video" : data.total + " video"} haz\u0131r \xB7 ${checkpoint.pages} veri paketi \xB7 ${Math.round((Date.now() - started) / 1e3)} saniye`;
        detail.textContent = `${filename} dosyas\u0131n\u0131 LaterLab\u2019de i\xE7e aktar. ${incremental ? "Eski videolar\u0131n ilerlemesi ve silinmeleri bu modda g\xFCncellenmez." : "Oturum bilgileri dosyaya dahil edilmedi."}`;
        stop.textContent = "Kapat";
      } catch (error) {
        if (controller.signal.aborted) return;
        label.textContent = "Aktar\u0131m durdu: " + error.message;
        detail.textContent = `${checkpoint.rows?.length || 0} / ${expected} kay\u0131t al\u0131nd\u0131. Eksik dosya kaydedilmedi.`;
        retry.hidden = false;
        stop.textContent = "Kapat";
      } finally {
        running = false;
      }
    }
    retry.onclick = run;
    if (choose) {
      label.textContent = "LaterLab \xB7 Yeni videolar v3 \xB7 Referans dosyan\u0131 se\xE7";
      detail.textContent = "LaterLab\u2019den indirdi\u011Fin g\xFCncel referans\u0131 se\xE7. \u0130lk tam aktar\u0131m JSON\u2019u veya g\xFCncel LaterLab yede\u011Fi de kullan\u0131labilir. Dosya yaln\u0131zca bu sekmede okunur.";
      choose.onchange = async () => {
        const file = choose.files?.[0];
        if (!file || running || knownIds) return;
        try {
          if (file.size > 30 * 1024 * 1024) throw Error("Dosya 30 MB s\u0131n\u0131r\u0131n\u0131 a\u015F\u0131yor.");
          knownIds = kit.referenceIds(JSON.parse(await file.text()));
          if (controller.signal.aborted) return;
          choose.disabled = true;
          choose.hidden = true;
          await run();
        } catch (error) {
          label.textContent = "Referans okunamad\u0131: " + error.message;
        }
      };
    } else await run();
  }
  var bookmarklet = "javascript:" + encodeURIComponent(`void (${exportWatchLater.toString()})(${createPlaylistTools.toString()});`);
  var incrementalBookmarklet = "javascript:" + encodeURIComponent(`void (${exportWatchLater.toString()})(${createPlaylistTools.toString()},'new');`);

  // firefox-extension/src/youtube.mjs
  function totalOf(data, kit = createPlaylistTools()) {
    const candidates = [...kit.findAll(data, "playlistSidebarPrimaryInfoRenderer").map((x) => x.stats?.[0]), ...kit.findAll(data, "playlistHeaderRenderer").map((x) => x.numVideosText), ...kit.findAll(data, "numVideosText")];
    const numbers = candidates.map((x) => kit.text(x).trim()).filter((x) => /^\d[\d.,\s\u00a0]*\s+(?:videos?|video|videolar)(?:\s|$)/i.test(x)).map((x) => Number(x.match(/^[\d.,\s\u00a0]+/)[0].replace(/[.,\s\u00a0]/g, "")));
    const unique = [...new Set(numbers)];
    if (unique.length !== 1 || !Number.isInteger(unique[0]) || unique[0] < 1 || unique[0] > 1e4) throw Error("YouTube toplam video say\u0131s\u0131 kesin okunamad\u0131. Eksik liste g\xF6nderilmedi; Daha Sonra \u0130zle sayfas\u0131n\u0131 kontrol et.");
    return unique[0];
  }
  function newestItem(data, kit = createPlaylistTools()) {
    const items = kit.findAll(data, "sortFilterSubMenuRenderer").flatMap((m) => m.subMenuItems || []);
    const item = items.find((x) => /date added.*newest|eklendiği tarih.*en yeni|eklenme tarihi.*en yeni/i.test(kit.text(x.title)));
    if (!item) throw Error("YouTube s\u0131ralama men\xFCs\xFC tan\u0131nmad\u0131. Daha Sonra \u0130zle sayfas\u0131nda Eklendi\u011Fi tarih (en yeni) se\xE7.");
    return item;
  }
  async function collect(knownIds, expectedAccount) {
    const kit = createPlaylistTools(), get = (key) => window.ytcfg?.get?.(key) ?? window.ytcfg?.data_?.[key];
    const origin = "https://www.youtube.com";
    if (location.origin !== origin || new URL(location.href).searchParams.get("list") !== "WL") throw Error("Daha Sonra \u0130zle sayfas\u0131 a\xE7\u0131lmad\u0131. YouTube oturumunu kontrol et.");
    for (let i = 0; i < 60 && !get("INNERTUBE_CONTEXT")?.client?.clientVersion; i++) await new Promise((r) => setTimeout(r, 250));
    const context = structuredClone(get("INNERTUBE_CONTEXT"));
    if (!context?.client?.clientVersion) throw Error("YouTube haz\u0131r de\u011Fil. Oturum veya \xE7erez onay ekran\u0131n\u0131 kontrol et.");
    const session = String(get("SESSION_INDEX") ?? 0), delegated = get("DELEGATED_SESSION_ID") || "", identity = get("DATASYNC_ID") || delegated;
    if (!identity) throw Error("YouTube hesap kimli\u011Fi do\u011Frulanamad\u0131. Do\u011Fru hesapla oturum a\xE7.");
    const account = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("laterlab-youtube:" + identity)))].map((x) => x.toString(16).padStart(2, "0")).join("");
    if (expectedAccount && account !== expectedAccount) throw Error("YouTube hesab\u0131 de\u011Fi\u015Fmi\u015F. Yanl\u0131\u015F hesaptan video aktar\u0131lmad\u0131; ba\u011Fl\u0131 YouTube hesab\u0131n\u0131 a\xE7.");
    const check = () => {
      if (location.origin !== origin || new URL(location.href).searchParams.get("list") !== "WL" || session !== String(get("SESSION_INDEX") ?? 0) || delegated !== (get("DELEGATED_SESSION_ID") || "") || identity !== (get("DATASYNC_ID") || get("DELEGATED_SESSION_ID") || "")) throw Error("Tarama s\u0131ras\u0131nda YouTube hesab\u0131 veya sayfa de\u011Fi\u015Fti. G\xFCncelleme iptal edildi.");
    };
    async function request(body, path = "/youtubei/v1/browse") {
      check();
      const cookies = Object.fromEntries(document.cookie.split(";").map((s) => {
        const i = s.indexOf("=");
        return [s.slice(0, i).trim(), s.slice(i + 1)];
      }));
      const sid = cookies.SAPISID || cookies["__Secure-3PAPISID"];
      if (!sid) throw Error("YouTube oturumu bulunamad\u0131. Firefox\u2019ta YouTube\u2019a giri\u015F yap.");
      const time = Math.floor(Date.now() / 1e3), digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${time} ${sid} ${origin}`));
      const auth = `SAPISIDHASH ${time}_${[...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
      const headers = { "Content-Type": "application/json", "X-Youtube-Client-Name": String(get("INNERTUBE_CONTEXT_CLIENT_NAME") || 1), "X-Youtube-Client-Version": context.client.clientVersion, "X-Goog-Authuser": session, "X-Origin": origin, Authorization: auth };
      if (delegated) headers["X-Goog-PageId"] = delegated;
      if (context.client.visitorData) headers["X-Goog-Visitor-Id"] = context.client.visitorData;
      const response = await fetch(path + "?prettyPrint=false", { method: "POST", credentials: "same-origin", redirect: "error", headers, body: JSON.stringify({ context, ...body }), signal: AbortSignal.timeout(25e3) });
      if (!response.ok) throw Error("YouTube iste\u011Fi tamamlanamad\u0131 (" + response.status + "). Sonraki kontrolde tekrar denenecek.");
      const result = await response.json();
      check();
      if (result.error) throw Error("YouTube liste iste\u011Fini reddetti.");
      if (result.responseContext?.visitorData) context.client.visitorData = result.responseContext.visitorData;
      return result;
    }
    let firstBody = { browseId: "VLWL" }, first = await request(firstBody);
    const item = newestItem(first, kit);
    if (!item.selected) {
      const endpoint = item.serviceEndpoint || item.navigationEndpoint;
      const browse = endpoint?.browseEndpoint;
      if (browse?.browseId === "VLWL" && typeof browse.params === "string") firstBody = { browseId: "VLWL", params: browse.params };
      else {
        const edit = endpoint?.playlistEditEndpoint, actions = edit?.actions, path = endpoint?.commandMetadata?.webCommandMetadata?.apiUrl;
        if (edit?.playlistId !== "WL" || !Array.isArray(actions) || actions.length !== 1 || actions[0].action !== "ACTION_SET_PLAYLIST_VIDEO_ORDER" || !Number.isInteger(Number(actions[0].playlistVideoOrder)) || !/^\/youtubei\/v1\/(?:browse\/edit_playlist|playlist\/edit)$/.test(path || "")) throw Error("YouTube s\u0131ralamas\u0131 otomatik de\u011Fi\u015Ftirilemedi. Bir kez Eklendi\u011Fi tarih (en yeni) se\xE7ip tekrar dene.");
        await request({ playlistId: "WL", actions: [{ action: "ACTION_SET_PLAYLIST_VIDEO_ORDER", playlistVideoOrder: actions[0].playlistVideoOrder }] }, path);
      }
      first = await request(firstBody);
    }
    if (!newestItem(first, kit).selected) throw Error("En yeni s\u0131ralamas\u0131 do\u011Frulanmad\u0131. G\xFCncelleme yap\u0131lmad\u0131.");
    const expected = totalOf(first, kit);
    let useFirst = true;
    const scanRequest = async (body) => {
      if (useFirst && !body.continuation) {
        useFirst = false;
        return first;
      }
      const result = await request(body);
      if (!body.continuation && totalOf(result, kit) !== expected) throw Error("Tarama s\u0131ras\u0131nda liste say\u0131s\u0131 de\u011Fi\u015Fti. Sonraki kontrolde tekrar denenecek.");
      return result;
    };
    const delta = await kit.scanNew({ request: scanRequest, knownIds, expected, checkpoint: {}, firstBody });
    check();
    return { account, delta };
  }
  globalThis.__laterlabCollect = collect;
})();
