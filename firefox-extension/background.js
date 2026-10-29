(() => {
  // cloudflare/public/sync-core.mjs
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  var bytesTo64 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  };
  var from64 = (s) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
  function checkPairCode(code) {
    const text = String(code ?? "").replace(/[\u200B-\u200F\u2060\uFEFF]/g, "").trim();
    const compact = text.replace(/\s/g, "");
    const matches = /^LL1-[A-Za-z0-9_-]{43}$/.test(compact) ? [compact] : [...text.matchAll(/(?<![A-Za-z0-9_-])LL1-[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g)].map((m) => m[0]);
    if (matches.length !== 1) throw Error(matches.length > 1 ? "Birden fazla kod bulundu. Yaln\u0131z kendi ba\u011Flant\u0131 kodunu kullan." : "Kod eksik veya ge\xE7ersiz. Kopyalamak yerine a\u015Fa\u011F\u0131daki Kod dosyas\u0131n\u0131 se\xE7 d\xFC\u011Fmesini kullanabilirsin.");
    const value = matches[0];
    if (bytesTo64(from64(value.slice(4))) !== value.slice(4)) throw Error("Kodda de\u011Fi\u015Fmi\u015F bir karakter var. Kod dosyas\u0131n\u0131 se\xE7erek yeniden dene.");
    return value;
  }
  async function keysFor(code) {
    code = checkPairCode(code);
    const digest = (label) => crypto.subtle.digest("SHA-256", encoder.encode(label + code));
    const auth = [...new Uint8Array(await digest("laterlab-auth:"))].map((n) => n.toString(16).padStart(2, "0")).join("");
    const key = await crypto.subtle.importKey("raw", await digest("laterlab-encryption:"), "AES-GCM", false, ["encrypt", "decrypt"]);
    return { auth, key };
  }
  async function encryptDocument(doc, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = encoder.encode(JSON.stringify(doc));
    if (plaintext.length > 20 * 1024 * 1024) throw Error("E\u015Fitleme verisi 20 MB s\u0131n\u0131r\u0131n\u0131 a\u015F\u0131yor. Yerel yede\u011Fin korunuyor.");
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode("laterlab-sync-v1") }, key, plaintext);
    return { iv: bytesTo64(iv), ciphertext: bytesTo64(new Uint8Array(encrypted)) };
  }
  async function decryptDocument(payload, key) {
    try {
      const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: from64(payload.iv), additionalData: encoder.encode("laterlab-sync-v1") }, key, from64(payload.ciphertext));
      const doc = JSON.parse(decoder.decode(clear));
      if (doc.format !== "laterlab-sync-v1" || !Array.isArray(doc.videos) || !doc.studio || !doc.settings) throw Error("shape");
      return doc;
    } catch {
      throw Error("Bulut kayd\u0131 bu kodla do\u011Frulanamad\u0131. Yerel verilerin de\u011Fi\u015Ftirilmedi.");
    }
  }

  // cloudflare/public/core.mjs
  var CATEGORIES = ["Yaz\u0131l\u0131m", "Teknoloji", "Ki\u015Fisel geli\u015Fim", "Finans", "Oyun", "Bilim", "Tarih", "Sanat", "Di\u011Fer"];
  var norm = (s) => String(s ?? "").toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
  function classify(title, channel = "") {
    const s = norm(title + " " + channel);
    const cats = [["Yaz\u0131l\u0131m", /\b(code|coding|programming|javascript|python|react|yazilim|kod|kodlama|developer|software|sql|typescript|linux|rust)\b/], ["Teknoloji", /\b(technology|tech|teknoloji|iphone|android|yapay zeka|artificial intelligence|chatgpt|ai|bilgisayar|nvidia)\b/], ["Ki\u015Fisel geli\u015Fim", /\b(productivity|habit|habits|focus|odak|aliskanlik|gelisim|motivation|motivasyon|learning|learn|ogrenme|psychology|psikoloji)\b/], ["Finans", /\b(finance|financial|finans|investing|investment|yatirim|borsa|ekonomi|economy|bitcoin|money|para|stock)\b/], ["Oyun", /\b(game|games|gaming|oyun|oyunlar|gameplay|minecraft|elden ring|steam)\b/], ["Bilim", /\b(science|physics|bilim|fizik|space|uzay|mathematics|matematik)\b/], ["Tarih", /\b(history|tarih|historical|ottoman|osmanli)\b/], ["Sanat", /\b(art|sanat|music|muzik|cinema|sinema|design|tasarim)\b/]];
    const tr = /[çğıöşüİ]/.test(title) || /\b(nasil|neden|icin|ve|bir|ile|nedir|yapilir|turkce)\b/.test(s);
    const en = /\b(the|how|why|your|you|with|this|what|learn|and|for|to|from|is|are)\b/.test(s);
    return { category: cats.find(([, r]) => r.test(s))?.[0] || "Di\u011Fer", language: tr ? "tr" : en ? "en" : "unknown", type: /\b(yayin tekrari|canli yayin|yayin kaydi|livestream|live stream|stream replay|vod)\b/.test(s) ? "live" : /\b(podcast)\b/.test(s) ? "podcast" : "unknown", estimated: true };
  }
  function duration(s) {
    if (typeof s === "number") return Number.isFinite(s) && s > 0 ? s : null;
    const t = String(s || "").trim();
    if (!/^\d{1,3}(:\d{2}){1,2}$/.test(t)) return null;
    const parts = t.split(":").map(Number);
    if (parts.slice(1).some((n) => n >= 60)) return null;
    return parts.reduce((n, v) => n * 60 + v, 0) || null;
  }
  function normalizeVideo(v) {
    if (!v || typeof v !== "object") return null;
    let id = String(v.id || "");
    if (!/^[\w-]{11}$/.test(id)) return null;
    const title = String(v.title || "Ba\u015Fl\u0131k bilinmiyor").slice(0, 600), channel = String(v.channel || "").slice(0, 200);
    const a = classify(title, channel);
    return { ...a, id, title, channel, availability: ["private", "deleted", "unavailable"].includes(v.availability) ? v.availability : null, position: Number.isInteger(v.position) ? v.position : null, libraryOrder: Number.isSafeInteger(v.libraryOrder) && v.libraryOrder > 0 ? v.libraryOrder : null, addedAt: v.addedAt && Number.isFinite(Date.parse(v.addedAt)) ? new Date(v.addedAt).toISOString() : null, duration: duration(v.duration), durationSource: ["manual", "import", "youtube"].includes(v.durationSource) ? v.durationSource : "legacy", progress: typeof v.progress === "number" && Number.isFinite(v.progress) ? Math.min(100, Math.max(0, v.progress)) : null, language: ["en", "tr", "other", "unknown"].includes(v.language) ? v.language : a.language, type: ["video", "live", "podcast", "short", "unknown"].includes(v.type) ? v.type : a.type, category: CATEGORIES.includes(v.category) ? v.category : a.category, tags: Array.isArray(v.tags) ? v.tags.map(String).slice(0, 20) : [], baselineExcluded: !!v.baselineExcluded, hidden: !!v.hidden, verified: !!v.verified, starred: !!v.starred, notes: String(v.notes || "").slice(0, 3e3), progressSource: ["manual", "youtube"].includes(v.progressSource) ? v.progressSource : "import" };
  }
  function ensureLibraryOrder(videos) {
    const max = videos.reduce((n, v) => Math.max(n, v.libraryOrder || v.position || 0), 0);
    return videos.map((v, i) => Number.isSafeInteger(v.libraryOrder) && v.libraryOrder > 0 ? v : { ...v, libraryOrder: v.position > 0 ? v.position : max + videos.length - i });
  }
  function importDelta(data, existing = []) {
    if (!existing.length) throw Error("Yeni-videolar dosyas\u0131 ilk aktar\u0131m yerine ge\xE7mez. \xD6nce tam aktar\u0131m JSON\u2019unu veya yede\u011Fini i\xE7e aktar.");
    if (data.format !== "siradaki-delta-v1" || data.scope !== "new-only" || data.order !== "newest" || data.complete !== true || !Array.isArray(data.videos) || !["known-page", "end"].includes(data.stopReason)) throw Error("Yeni-videolar dosyas\u0131 tamamlanmam\u0131\u015F veya ge\xE7ersiz.");
    const valid = (id) => typeof id === "string" && /^[\w-]{11}$/.test(id), base = data.baseIds, matched = data.matchedIds;
    if (!Array.isArray(base) || !base.length || base.length > 2e4 || base.some((id) => !valid(id)) || new Set(base).size !== base.length) throw Error("G\xFCncellemenin referans kimlikleri ge\xE7ersiz.");
    const baseSet = new Set(base), previous = new Map(ensureLibraryOrder(existing).map((v) => [v.id, v]));
    if (base.some((id) => !previous.has(id))) throw Error("Bu g\xFCncelleme farkl\u0131 veya daha yeni bir k\xFCt\xFCphaneye ait. Referans\u0131n al\u0131nd\u0131\u011F\u0131 k\xFCt\xFCphaneyi/yede\u011Fi kullan.");
    if (!Array.isArray(matched) || !matched.length || new Set(matched).size !== matched.length || matched.some((id) => !baseSet.has(id))) throw Error("Bilinen videolarla e\u015Fle\u015Fme do\u011Frulanamad\u0131.");
    if (!Number.isInteger(data.total) || data.total < 1 || data.total > 1e4 || !Number.isInteger(data.scanned) || data.scanned < 1 || data.scanned > data.total || data.videos.length + matched.length > data.scanned || data.stopReason === "end" && data.scanned !== data.total) throw Error("G\xFCncellemenin kay\u0131t say\u0131lar\u0131 tutars\u0131z.");
    const ids = data.videos.map((v) => v?.id);
    if (ids.some((id) => !valid(id) || baseSet.has(id)) || new Set(ids).size !== ids.length) throw Error("Yeni-videolar dosyas\u0131nda yinelenen veya ge\xE7ersiz kimlik var.");
    const next = new Map(previous);
    let order = Math.max(...[...previous.values()].map((v) => v.libraryOrder)) + data.videos.filter((v) => !previous.has(v.id)).length;
    for (const row of data.videos) {
      if (next.has(row.id)) continue;
      const v = normalizeVideo(row);
      next.set(v.id, { ...v, libraryOrder: order--, position: null, baselineExcluded: false, hidden: false, notes: "", tags: [], starred: false, verified: false, progressSource: "import", durationSource: "import" });
    }
    return [...next.values()];
  }
  function importSnapshot(data, existing = []) {
    if (!data || typeof data !== "object") throw Error("JSON bi\xE7imi ge\xE7ersiz.");
    if (data.format === "siradaki-delta-v1") return importDelta(data, existing);
    if (data.format !== "siradaki-export-v1" || data.order !== "oldest" || data.complete !== true || !Array.isArray(data.videos)) throw Error("En eski s\u0131ralamada, tamamlanm\u0131\u015F LaterLab aktar\u0131m dosyas\u0131 gerekiyor.");
    const rows = data.videos;
    if (!existing.length && rows.length < 1275) throw Error("Aktar\u0131m en az 1275 s\u0131ray\u0131 i\xE7ermeli. Liste tamamen y\xFCklendi\u011Finde yeniden aktar.");
    if (rows.length > 1e4 || rows.some((v) => !v || typeof v !== "object")) throw Error("Aktar\u0131m kay\u0131tlar\u0131 ge\xE7ersiz.");
    if (data.total !== void 0 && data.total !== rows.length) throw Error("Aktar\u0131m toplam\u0131 kay\u0131t say\u0131s\u0131yla uyu\u015Fmuyor.");
    const validRows = rows.filter((v) => v.id !== null);
    if (validRows.some((v) => !normalizeVideo(v)) || new Set(validRows.map((v) => v.id)).size !== validRows.length) throw Error("Aktar\u0131mda ge\xE7ersiz veya yinelenen video kimli\u011Fi var.");
    const positions = new Set(rows.map((v) => v.position));
    if (positions.size !== rows.length || rows.some((v) => !Number.isInteger(v.position) || v.position < 1) || Math.max(...positions) !== rows.length) throw Error("S\u0131ra numaralar\u0131nda bo\u015Fluk veya tekrar var. Tam listeyi yeniden aktar.");
    const prev = new Map(ensureLibraryOrder(existing).map((v) => [v.id, v]));
    const orderOffset = existing.reduce((n, v) => Math.max(n, v.libraryOrder || v.position || 0), 0);
    const first = existing.length === 0;
    let next = new Map(prev);
    for (const row of rows) {
      const v = normalizeVideo(row);
      if (!v) continue;
      const old = prev.get(v.id);
      if (old) {
        next.set(v.id, { ...v, ...old, title: v.title, channel: v.channel, availability: v.availability, libraryOrder: orderOffset + v.position, duration: old.durationSource === "manual" || old.durationSource !== "import" && old.duration != null ? old.duration : v.duration ?? old.duration, progress: ["manual", "youtube"].includes(old.progressSource) ? old.progress : v.progress ?? old.progress });
      } else next.set(v.id, { ...v, durationSource: "import", progressSource: "import", libraryOrder: orderOffset + v.position, baselineExcluded: first && v.position <= 1274, position: first ? v.position : null });
    }
    if (first && next.size === 0) throw Error("Ge\xE7erli video bulunamad\u0131.");
    return [...next.values()];
  }

  // cloudflare/public/core.mjs?v=5.9
  var norm2 = (s) => String(s ?? "").toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
  var rules = [["S\u0131nav haz\u0131rl\u0131\u011F\u0131 (YKS / TYT / AYT / KPSS)", /\b(yks|tyt|ayt|kpss)\b|\b(yuksekogretim kurumlari sinavi|temel yeterlilik testi|alan yeterlilik testleri|kamu personeli secme sinavi)\b/], ["Futbol", /\b(futbol|football|soccer|arda guler|villarreal|fifa|uefa|premier league|champions league|super lig|galatasaray|fenerbahce|besiktas|trabzonspor|messi|ronaldo)\b/], ["League of Legends", /\b(league of legends|lol|summoner.?s rift|wild rift|aram|lck|lec|lcs|tft|teamfight tactics)\b/], ["Yemek", /\b(yemek|sahur|iftar|tarif|tarifi|tarifleri|recipe|recipes|cooking|cook|food|mukbang|asmr eating|mutfak|pasta|pizza|burger|kebap|kahvalti|borek|tatli)\b/], ["B\xF6l\xFCm tan\u0131t\u0131m\u0131", /\b(bolum|episode)\s*\d*\s*(tanitim|tanitimi|fragman|trailer|promo)|\b(tanitim|tanitimi)\b.*\bbolum|\bbolum.{0,25}\b(tanitim|tanitimi)|\b(episode|season)\b.*\b(trailer|promo)|\b(universite|university|universitesi|kampus|campus)\b.*\b(tanitim|tanitimi|tour|introduction|promotional)|\b(tanitim|tanitimi)\b.*\b(universite|universitesi)/], ["\xDCniversite tan\u0131t\u0131m\u0131", /\b(university tour|campus tour|universite tanitim|universite tercih|universitesi tanitim|kampus turu|bolum tanitim)/]];
  var examPattern = /(?:^|[^a-z])(?:yks|tyt|ayt|kpss|msu|ygs|lys|osym)(?=$|[^a-z])|#(?:yks|tyt|ayt|kpss|msu)[a-z0-9_]*|\b(?:yuksekogretim kurumlari sinavi|temel yeterlilik testi|alan yeterlilik testleri|kamu personeli secme sinavi|milli savunma universitesi)\b/;
  var lessonPattern = /\b(?:konu\s*anlatim\w*|soru\w*\s*cozum\w*|cozum\w*\s*soru\w*|ders\w*|kamp\w*|deneme\w*|yazili\w*|test\w*|sinav\w*|tekrar\w*|taktik\w*|pratik\w*)\b/;
  var schoolSubject = /\b(?:matematik|geometri|fizik|kimya|biyoloji|turkce|edebiyat|tarih|cografya|felsefe|din kulturu|trigonometri|logaritma|polinom\w*|parabol\w*|esitsizlik\w*|fonksiyon\w*|integral|turev|limit|problemler|paragraf|sozcuk\w*|cumle\w*|yazim|noktalama|dil bilgisi|anlatim bozukluk\w*|fiilimsi\w*|olas ilik|olasilik|permutasyon|kombinasyon|mol|asit\w*|bazlar|kalitim|hucre|mitoz|mayoz|elektrostatik|optik)\b/;
  function extraExclusion(v) {
    const title = norm2(v.title || ""), channel = norm2(v.channel || ""), tags = norm2((v.tags || []).join(" "));
    const all = title + " " + channel + " " + tags;
    const compactChannel = channel.replace(/[^a-z0-9]/g, "");
    if (["private", "deleted", "unavailable"].includes(v.availability) || /^\W*(?:private video|deleted video|unavailable video|video unavailable|gizli video|ozel video|silinmis video|silinen video|kullanilamayan video|video kullanilamiyor)\W*$/.test(title)) return "Gizli / silinmi\u015F / kullan\u0131lamayan";
    if (compactChannel.includes("rustuhocaileturkce") || /\brustu\s*hoca\s*ile\s*turkce\b/.test(all)) return "D\u0131\u015Flanan kanal \xB7 R\xFC\u015Ft\xFC Hoca ile T\xFCrk\xE7e";
    if (/^lynxcerezz?(?:tw)?$/.test(compactChannel) || ["vechiron", "taowb", "lars"].includes(compactChannel) || /(?:^|[^a-z0-9])(?:lynx\s*cerezz?(?:\s*tw)?|vechiron|taowb|lars)(?=$|[^a-z0-9])/.test(all)) return "D\u0131\u015Flanan LoL kanal\u0131";
    if (/\botpler\b/.test(title) && /\boyun\b/.test(title) || compactChannel === "adro" && /\b(?:gameplay|script)\b/.test(title)) return "League of Legends";
    if (/(?:^|[^a-z])cs[\s._-]*2(?:$|[^a-z0-9])|\bcounter[\s-]*strike(?:\s*2)?\b/.test(all)) return "Counter-Strike / CS 2";
    if (/(?:^|[^a-z])soru(?:$|[^a-z]|su|lar|yu|ya|nun|muz|nuz|dur|yla|dan|da)/.test(title)) return "Ba\u015Fl\u0131\u011F\u0131nda soru ge\xE7en video";
    if (/\b(?:gragas|jhin|kogmaw|anivia|vayne)\b|\b(?:adc|toplane|jungl\w*|mid)\b.*\b(?:build\w*|faker|karma|rank\w*)\b|\bfaker\w*\b.*\b(?:karma|build\w*|ulti)\b/.test(all)) return "League of Legends";
    if (/\b(?:momentumun korunumu|mutlak deger|trigonometrik denklem|trigo logaritma|icerik cumlesi|bicem cumlesi|uslup cumlesi|analitik tekrari)\b|\bfonksiyonlar\s*[-:]?\s*\d|\borijinalden\s+grafik\s+yorumu\b/.test(title)) return "Lise m\xFCfredat\u0131";
    if (/\b(?:matematik|geometri)\b/.test(channel) && /\b(?:kimse yapamamis|bu yorumu kapin|tercihler ve mezunluk)\b/.test(title)) return "Lise / s\u0131nav haz\u0131rl\u0131\u011F\u0131";
    if (examPattern.test(all)) return "S\u0131nav haz\u0131rl\u0131\u011F\u0131 (YKS / TYT / AYT / KPSS / MS\xDC)";
    if (/\b(?:9|10|11|12)\s*\.?\s*sinif\b|\blise\s*(?:ders\w*|mufredat\w*|matematik|fizik|kimya|biyoloji)\b/.test(all)) return "Lise dersi / soru \xE7\xF6z\xFCm\xFC";
    if (/\bsoru\w*\s*cozum\w*|\bcozumlu\s*(?:soru\w*|test\w*|deneme\w*)/.test(title) || schoolSubject.test(all) && lessonPattern.test(title)) return "Lise dersi / soru \xE7\xF6z\xFCm\xFC";
    if (/\b(?:cumle(?:nin|de)?\s+(?:ogeleri|turleri|anlam)|sozcuk(?:te)?\s+(?:anlam|turleri|yapi)|ses bilgisi|yazim kurallari|noktalama isaretleri|fiilimsiler|anlatim bozukluklari|paragrafta\s+(?:anlam|ana dusunce|yardimci dusunce|yapi))\b/.test(title) || /^\W*(?:trigonometri|polinomlar|parabol|turev|integral|logaritma|esitsizlikler|carpanlara ayirma|ikinci dereceden denklemler)\s*(?:$|[-:|–—]|\d)/.test(title)) return "Lise m\xFCfredat\u0131";
    return "";
  }
  function exclusion(v) {
    if (v.baselineExcluded) return "\u0130lk 1274";
    if (v.hidden) return "Sen gizledin";
    const extra = extraExclusion(v);
    if (extra) return extra;
    let s = norm2(v.title + " " + v.channel + " " + (v.tags || []).join(" "));
    return rules.find(([, r]) => r.test(s))?.[0] || "";
  }
  var compareAdded = (a, b) => (a.libraryOrder ?? a.position ?? 0) - (b.libraryOrder ?? b.position ?? 0) || a.id.localeCompare(b.id);
  var dayKey = (date = /* @__PURE__ */ new Date()) => date.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });

  // cloudflare/public/features.mjs
  var validDay = (day) => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day + "T12:00:00Z")) && (/* @__PURE__ */ new Date(day + "T12:00:00Z")).toISOString().slice(0, 10) === day;
  function cleanStudio(raw = {}) {
    if (!raw || typeof raw !== "object") raw = {};
    const rules2 = Array.isArray(raw.rules) ? raw.rules.filter((r) => r && typeof r.id === "string" && ["channel", "title"].includes(r.type) && typeof r.value === "string" && r.value.trim()).map((r) => ({ id: r.id.slice(0, 100), type: r.type, value: r.value.trim().slice(0, 200), enabled: r.enabled !== false })) : [];
    const feedback = {};
    for (const [id, f] of Object.entries(raw.feedback || {})) if (/^[\w-]{11}$/.test(id) && f && ["dislike", "later", "watched"].includes(f.kind)) feedback[id] = { kind: f.kind, until: /^\d{4}-\d{2}-\d{2}$/.test(f.until || "") ? f.until : null };
    const events = Array.isArray(raw.events) ? raw.events.filter((e) => e && typeof e.id === "string" && ["complete", "minutes", "added"].includes(e.type) && validDay(e.day) && Number.isInteger(e.amount) && e.amount > 0 && (e.type !== "minutes" || e.amount <= 1440) && (e.type === "minutes" || /^[\w-]{11}$/.test(e.videoId || ""))).map((e) => ({ id: e.id, type: e.type, day: e.day, videoId: e.videoId || null, amount: e.amount, english: !!e.english })) : [];
    const difficulties = {};
    for (const [id, level] of Object.entries(raw.difficulties || {})) if (/^[\w-]{11}$/.test(id) && ["easy", "medium", "hard"].includes(level)) difficulties[id] = level;
    return { excludeWatched: raw.excludeWatched === true, rules: rules2, exceptions: Array.isArray(raw.exceptions) ? raw.exceptions.filter((id) => /^[\w-]{11}$/.test(id)) : [], feedback, events: events.filter((e, i) => events.findIndex((x) => x.id === e.id) === i), difficulties, weeklyGoal: Number.isInteger(raw.weeklyGoal) && raw.weeklyGoal >= 5 && raw.weeklyGoal <= 10080 ? raw.weeklyGoal : 60, mode: ["balanced", "english", "light"].includes(raw.mode) ? raw.mode : "balanced" };
  }
  function ruleMatches(v, r) {
    if (r.enabled === false) return false;
    const needle = norm2(r.value).trim();
    return !!needle && (r.type === "channel" ? norm2(v.channel).trim() === needle : norm2(v.title).includes(needle));
  }
  function reason(v, studio = {}) {
    if (v.baselineExcluded) return "\u0130lk 1274";
    if (v.hidden) return "Sen gizledin";
    if (studio.excludeWatched && (v.progress ?? 0) >= 100) return "\u0130zlendi \xB7 tamamland\u0131";
    if (studio.exceptions?.includes(v.id)) return "";
    const rule = studio.rules?.find((r) => ruleMatches(v, r));
    return rule ? `Kural\u0131n \xB7 ${rule.type === "channel" ? "Kanal" : "Ba\u015Fl\u0131k"}: ${rule.value}` : exclusion(v);
  }
  function shiftDay(day, n) {
    const date = /* @__PURE__ */ new Date(day + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + n);
    return date.toISOString().slice(0, 10);
  }
  function weekSummary(studio, date = dayKey(), longWatch = null) {
    const weekday = (/* @__PURE__ */ new Date(date + "T12:00:00Z")).getUTCDay(), start = shiftDay(date, -((weekday + 6) % 7)), end = shiftDay(start, 6);
    const events = (studio.events || []).filter((e) => e.day >= start && e.day <= date);
    const slices = Object.values(longWatch?.logs || {}).filter((e) => e.day >= start && e.day <= date);
    const logged = (english) => Math.round((events.filter((e) => e.type === "minutes" && (!english || e.english)).reduce((n, e) => n + e.amount * 60, 0) + slices.filter((e) => !english || e.english).reduce((n, e) => n + e.seconds, 0)) / 60 * 100) / 100;
    return { start, end, completed: new Set(events.filter((e) => e.type === "complete").map((e) => e.videoId)).size, added: new Set(events.filter((e) => e.type === "added").map((e) => e.videoId)).size, minutes: logged(false), englishMinutes: logged(true) };
  }
  function recordAdditions(before, next, date = dayKey()) {
    const studio = cleanStudio(next.studio);
    if (!before.videos.length) return studio;
    const known = new Set(before.videos.map((v) => v.id));
    for (const v of next.videos) if (!known.has(v.id) && !reason(v, studio)) studio.events.push({ id: crypto.randomUUID(), type: "added", videoId: v.id, day: date, amount: 1, english: v.language === "en" });
    return studio;
  }
  function recordCompletion(studio, v, oldProgress, date = dayKey()) {
    if ((v.progress ?? 0) >= 100 && (oldProgress ?? 0) < 100 && !studio.events.some((e) => e.type === "complete" && e.videoId === v.id && e.day === date)) studio.events.push({ id: crypto.randomUUID(), type: "complete", videoId: v.id, day: date, amount: 1, english: v.language === "en" });
    if ((v.progress ?? 0) < 100) {
      if (studio.feedback[v.id]?.kind === "watched") delete studio.feedback[v.id];
      studio.events = studio.events.filter((e) => e.type !== "complete" || e.videoId !== v.id || e.day < weekSummary(studio, date).start);
    }
  }
  function cleanLongWatch(raw = {}) {
    const object = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
    raw = object(raw);
    const preferences = object(raw.preferences), positions = {}, plans = {}, logs = {}, playback = {}, watchDays = {};
    const idOK = (id) => /^[\w-]{11}$/.test(id);
    const seconds = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 6e6;
    const today = dayKey();
    for (const [day, ids] of Object.entries(object(raw.watchDays))) {
      if (!validDay(day) || day < shiftDay(today, -30) || day > today) continue;
      const kept = Object.keys(object(ids)).filter((id) => idOK(id) && ids[id] === true).slice(0, 2e3);
      if (kept.length) watchDays[day] = Object.fromEntries(kept.map((id) => [id, true]));
    }
    for (const [id, p] of Object.entries(object(raw.positions))) if (idOK(id) && p && seconds(p.seconds) && Number.isFinite(p.progress) && p.progress >= 0 && p.progress <= 100 && Number.isFinite(p.duration) && p.duration > 0) positions[id] = { seconds: p.seconds, progress: p.progress, duration: p.duration, ...Number.isFinite(p.updatedAt) ? { updatedAt: p.updatedAt } : {}, ...p.source === "youtube" ? { source: "youtube" } : {} };
    for (const [date, p] of Object.entries(object(raw.plans))) {
      if (!validDay(date) || !p || !Array.isArray(p.ids)) continue;
      const segments = {};
      for (const id of [...new Set(p.ids)].filter(idOK).slice(0, 5)) {
        const s = object(p.segments)[id];
        if (s && seconds(s.start) && seconds(s.end) && s.end > s.start && s.end - s.start <= 900) segments[id] = { start: s.start, end: s.end, done: s.done === true, ...s.automatic === true ? { automatic: true, watched: Math.max(0, Math.min(s.end - s.start, Number(s.watched) || 0)) } : {} };
      }
      plans[date] = { ids: Object.keys(segments), segments };
    }
    for (const [id, e] of Object.entries(object(raw.logs))) if (/^long:[\w:-]{1,100}$/.test(id) && e && validDay(e.day) && idOK(e.videoId) && seconds(e.seconds) && e.seconds > 0 && e.seconds <= (id.startsWith("long:yt:") ? 86400 : 900)) logs[id] = { day: e.day, videoId: e.videoId, seconds: e.seconds, english: e.english === true };
    for (const [id, e] of Object.entries(object(raw.playback))) if (/^[a-f0-9-]{36}:\d{4}-\d{2}-\d{2}$/.test(id) && e && validDay(e.day) && idOK(e.videoId) && seconds(e.seconds) && e.seconds <= 86400 && seconds(e.mediaSeconds) && e.mediaSeconds <= 345600 && Number.isFinite(e.observedAt)) playback[id] = { videoId: e.videoId, day: e.day, seconds: e.seconds, mediaSeconds: e.mediaSeconds, observedAt: e.observedAt };
    return { preferences: { count: [1, 2, 3, 4, 5].includes(preferences.count) ? preferences.count : 3, minutes: [10, 15].includes(preferences.minutes) ? preferences.minutes : 15, minimum: [30, 45, 60, 90].includes(preferences.minimum) ? preferences.minimum : 45 }, positions, plans, logs, playback, watchDays };
  }
  function longPosition(v, longWatch) {
    const end = Math.floor(v.duration || 0), saved = longWatch?.positions?.[v.id];
    if (saved && saved.progress === v.progress && saved.duration === v.duration) return Math.min(end, saved.seconds);
    return Math.min(end, Math.max(0, Math.floor(end * (v.progress || 0) / 100)));
  }
  function longEligible(v, state, date = dayKey()) {
    const f = state.studio?.feedback?.[v.id];
    return !reason(v, state.studio) && !v.availability && v.type !== "short" && Number.isFinite(v.duration) && v.duration >= state.longWatch.preferences.minimum * 60 && (v.progress ?? 0) < 100 && f?.kind !== "dislike" && f?.kind !== "watched" && !(f?.kind === "later" && f.until > date);
  }
  function prepareLongPlan(state, date = dayKey()) {
    state.longWatch = cleanLongWatch(state.longWatch);
    const long = state.longWatch, p = long.preferences;
    const byId = new Map(state.videos.map((v) => [v.id, v]));
    const previous = Object.keys(long.plans).filter((d) => d < date).sort().at(-1);
    const today = long.plans[date];
    const continuing = today?.ids || long.plans[previous]?.ids || [];
    const ids = [.../* @__PURE__ */ new Set([...continuing, ...state.videos.filter((v) => longEligible(v, state, date)).sort((a, b) => compareAdded(b, a)).map((v) => v.id)])];
    const segments = {}, selected = [];
    for (const id of today?.ids || []) {
      const v = byId.get(id), s = today.segments[id];
      if (v && s.done) {
        segments[id] = s;
        selected.push(id);
      }
    }
    for (const id of ids) {
      if (selected.includes(id) || selected.length >= p.count) continue;
      const v = byId.get(id);
      if (!v || !longEligible(v, state, date)) continue;
      const active = today?.segments?.[id];
      if (active?.automatic && !active.done) {
        segments[id] = active;
        selected.push(id);
        continue;
      }
      const start = longPosition(v, long), end = Math.min(Math.floor(v.duration), start + p.minutes * 60);
      if (end <= start) continue;
      segments[id] = { start, end, done: false };
      selected.push(id);
    }
    long.plans[date] = { ids: selected, segments };
    for (const d of Object.keys(long.plans)) if (d < shiftDay(date, -30)) delete long.plans[d];
    return long.plans[date];
  }
  function applyPlayback(document2, events) {
    const state = structuredClone(document2);
    state.longWatch = cleanLongWatch(state.longWatch);
    state.studio = cleanStudio(state.studio);
    let long = state.longWatch, changed = false, updated = 0;
    for (const event of [...events].sort((a, b) => a.observedAt - b.observedAt)) {
      const e = event, key = e.sessionId + ":" + e.day;
      if (!/^[a-f0-9-]{36}$/.test(e.sessionId || "") || !validDay(e.day) || e.day > dayKey() || e.day < shiftDay(dayKey(), -30) || !Number.isFinite(e.observedAt) || e.observedAt > Date.now() + 6e4 || e.observedAt < Date.now() - 30 * 864e5) continue;
      if (!["seconds", "mediaSeconds", "position", "duration"].every((k) => Number.isSafeInteger(e[k]) && e[k] >= 0) || e.seconds > 86400 || e.mediaSeconds > 345600 || !e.duration || e.duration > 6e6 || e.position > e.duration) continue;
      if (!/^[\w-]{11}$/.test(e.videoId || "")) continue;
      if (e.seconds > 0) {
        const day = long.watchDays[e.day] ||= {};
        if (!day[e.videoId] && Object.keys(day).length < 2e3) {
          day[e.videoId] = true;
          changed = true;
        }
      }
      const v = state.videos.find((v2) => v2.id === e.videoId);
      if (!v || v.baselineExcluded || v.hidden || v.availability) continue;
      const receipt = long.playback[key];
      if (receipt && (receipt.videoId !== v.id || e.observedAt <= receipt.observedAt || e.seconds < receipt.seconds || e.mediaSeconds < receipt.mediaSeconds)) continue;
      if (!long.plans[e.day]) {
        prepareLongPlan(state, e.day);
        long = state.longWatch;
      }
      const seconds = e.seconds - (receipt?.seconds || 0), media = e.mediaSeconds - (receipt?.mediaSeconds || 0);
      long.playback[key] = { videoId: v.id, day: e.day, seconds: e.seconds, mediaSeconds: e.mediaSeconds, observedAt: e.observedAt };
      changed = true;
      const logKey = "long:yt:" + key;
      if (seconds > 0) long.logs[logKey] = { day: e.day, videoId: v.id, seconds: (long.logs[logKey]?.seconds || 0) + seconds, english: v.language === "en" };
      const position = long.positions[v.id], fresh = e.observedAt > (position?.updatedAt || 0);
      if (fresh) {
        const old = v.progress;
        if (v.durationSource !== "manual") {
          v.duration = e.duration;
          v.durationSource = "youtube";
        }
        const end = Math.floor(v.duration), at = Math.min(end, e.position);
        v.progress = e.ended && e.duration - e.position <= 2 ? 100 : Math.min(99.999, at / v.duration * 100);
        v.progressSource = "youtube";
        long.positions[v.id] = { seconds: at, progress: v.progress, duration: v.duration, source: "youtube", updatedAt: e.observedAt };
        recordCompletion(state.studio, v, old, e.day);
        updated++;
      }
      const segment = long.plans[e.day]?.segments?.[v.id];
      if (segment && !segment.done && media > 0) {
        segment.automatic = true;
        segment.watched = Math.min(segment.end - segment.start, (segment.watched || 0) + media);
        segment.done = segment.watched >= segment.end - segment.start || fresh && v.progress === 100;
      }
    }
    return { document: state, changed, updated };
  }

  // firefox-extension/src/cloud.mjs
  var APP = "https://siradaki.alpargu37.workers.dev";
  async function cloudRequest(code, method = "GET", body, fetcher = fetch) {
    const keys = await keysFor(checkPairCode(code));
    const response = await fetcher(APP + "/api/sync", { method, headers: { Authorization: "Bearer " + keys.auth, ...body ? { "Content-Type": "application/json" } : {} }, body: body ? JSON.stringify(body) : void 0, cache: "no-store", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(3e4) });
    if (response.status === 409) return { conflict: true };
    if (!response.ok) throw Error(response.status === 401 ? "LaterLab ba\u011Flant\u0131s\u0131 ge\xE7ersiz. Eklentiyi yeniden ba\u011Fla." : "LaterLab sunucusuna ula\u015F\u0131lamad\u0131 (" + response.status + ").");
    const data = await response.json();
    if (!Number.isSafeInteger(data.revision) || data.revision < 0) throw Error("Sunucu s\xFCr\xFCm bilgisi ge\xE7ersiz.");
    return { ...data, document: data.payload ? await decryptDocument(data.payload, keys.key) : null };
  }
  function addDelta(document2, delta, checkedAt = (/* @__PURE__ */ new Date()).toISOString()) {
    if (!document2?.videos?.length) throw Error("\xD6nce LaterLab\u2019de mevcut k\xFCt\xFCphaneni e\u015Fitle.");
    if (delta?.format !== "siradaki-delta-v1" || delta.scope !== "new-only") throw Error("Yaln\u0131z yeni-videolar g\xFCncellemesi kabul edilir.");
    const videos = importSnapshot(delta, document2.videos), added = videos.length - document2.videos.length;
    const next = { ...document2, videos, youtubeSync: { checkedAt, added, total: delta.total, source: "firefox", scope: "new-only" } };
    if (added) {
      next.studio = recordAdditions(document2, next);
      next.importedAt = checkedAt;
    }
    return { document: next, added };
  }
  async function uploadDelta(code, delta, { fetcher = fetch, stillAllowed = async () => true, backup = async () => {
  } } = {}) {
    const keys = await keysFor(code);
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!await stillAllowed()) throw Error("Otomatik g\xFCncelleme durduruldu.");
      const current = await cloudRequest(code, "GET", void 0, fetcher);
      const next = addDelta(current.document, delta);
      const payload = await encryptDocument(next.document, keys.key);
      await backup(current.payload);
      if (!await stillAllowed()) throw Error("Otomatik g\xFCncelleme durduruldu.");
      const saved = await cloudRequest(code, "PUT", { expectedRevision: current.revision, payload }, fetcher);
      if (!saved.conflict) return { added: next.added, checkedAt: next.document.youtubeSync.checkedAt };
    }
    throw Error("K\xFCt\xFCphane di\u011Fer cihazda de\u011Fi\u015Fiyor. Sonraki kontrolde tekrar denenecek.");
  }
  async function uploadPlayback(code, events, { fetcher = fetch, stillAllowed = async () => true } = {}) {
    const keys = await keysFor(code);
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!await stillAllowed()) throw Error("\u0130zleme e\u015Fitlemesi duraklat\u0131ld\u0131.");
      const current = await cloudRequest(code, "GET", void 0, fetcher);
      if (!current.document?.videos?.length) throw Error("LaterLab k\xFCt\xFCphanesi bekleniyor.");
      const next = applyPlayback(current.document, events);
      if (!next.changed) return { updated: 0 };
      const payload = await encryptDocument(next.document, keys.key);
      if (!await stillAllowed()) throw Error("\u0130zleme e\u015Fitlemesi duraklat\u0131ld\u0131.");
      const saved = await cloudRequest(code, "PUT", { expectedRevision: current.revision, payload }, fetcher);
      if (!saved.conflict) return { updated: next.updated };
    }
    throw Error("Di\u011Fer cihazdaki de\u011Fi\u015Fiklik bekleniyor; izleme kayd\u0131 yeniden denenecek.");
  }

  // firefox-extension/src/playback-background.mjs
  var chain = Promise.resolve();
  var flushing = false;
  var locked = (fn) => {
    const next = chain.then(fn);
    chain = next.catch(() => {
    });
    return next;
  };
  var config = async () => (await browser.storage.local.get("config")).config;
  var allowed = (a, b) => b?.enabled && a.connectionId === b.connectionId && a.account === b.account;
  async function acceptPlayback(message, sender) {
    if (sender.id !== browser.runtime.id || sender.frameId !== 0 || !sender.tab || sender.tab.incognito || sender.tab.cookieStoreId && sender.tab.cookieStoreId !== "firefox-default") return;
    let url;
    try {
      url = new URL(sender.url);
    } catch {
      return;
    }
    if (url.origin !== "https://www.youtube.com" || url.pathname !== "/watch" || url.searchParams.get("v") !== message.event?.videoId) return;
    const c = await config();
    if (!c?.enabled || !c.account) return { ok: false, reset: true };
    if (!/^[\w-]{11}$/.test(message.event.videoId || "")) return { ok: false, reset: true };
    try {
      const result = await browser.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [0] }, world: "MAIN", func: async () => {
        const get = (key2) => window.ytcfg?.get?.(key2) ?? window.ytcfg?.data_?.[key2], identity = get("DATASYNC_ID") || get("DELEGATED_SESSION_ID");
        const player = document.getElementById("movie_player"), video = player?.querySelector("video.html5-main-video"), id = new URL(location.href).searchParams.get("v");
        if (!identity || !video || player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting") || player.getVideoData?.().video_id !== id || player.getPlayerResponse?.()?.videoDetails?.isLive === true || !Number.isFinite(video.duration) || video.duration <= 0) return null;
        const account = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("laterlab-youtube:" + identity)))].map((x) => x.toString(16).padStart(2, "0")).join("");
        if (identity !== (get("DATASYNC_ID") || get("DELEGATED_SESSION_ID"))) return null;
        return { account, id, position: Math.floor(video.currentTime), duration: Math.floor(video.duration), ended: video.ended };
      } });
      const snapshot = result[0]?.result, e = message.event;
      if (snapshot?.account !== c.account || snapshot.id !== e.videoId) return { ok: false, reset: true };
      if (!/^[a-f0-9-]{36}$/.test(e.sessionId || "") || !/^\d{4}-\d{2}-\d{2}$/.test(e.day || "") || !["seconds", "mediaSeconds"].every((k) => Number.isSafeInteger(e[k]) && e[k] >= 0) || e.seconds > 86400 || e.mediaSeconds > 345600) return { ok: false };
      const event = { sessionId: e.sessionId, day: e.day, videoId: snapshot.id, position: snapshot.position, duration: snapshot.duration, ended: snapshot.ended, seconds: e.seconds, mediaSeconds: e.mediaSeconds, observedAt: Date.now() }, key = e.sessionId + ":" + e.day;
      await locked(async () => {
        if (!allowed(c, await config())) return;
        const { playbackQueue = {} } = await browser.storage.local.get("playbackQueue");
        if (Object.keys(playbackQueue).length >= 500 && !playbackQueue[key]) throw Error("Bekleyen izleme kay\u0131tlar\u0131 doldu. \u0130nternet ba\u011Flant\u0131n\u0131 kontrol et.");
        const old = playbackQueue[key];
        if (old && (old.seconds > event.seconds || old.mediaSeconds > event.mediaSeconds)) return;
        playbackQueue[key] = event;
        await browser.storage.local.set({ playbackQueue });
        const pending = await browser.alarms.get("playback");
        if (!pending || message.urgent && pending.scheduledTime > Date.now() + 5e3) await browser.alarms.create("playback", { delayInMinutes: message.urgent ? 0.0834 : 2 });
      });
      return { ok: true };
    } catch (error) {
      await browser.storage.local.set({ playbackStatus: { phase: "error", message: error.message } });
      return { ok: false };
    }
  }
  async function flushPlayback() {
    if (flushing) return;
    flushing = true;
    try {
      const c = await config();
      if (!c?.enabled || !c.account) return;
      const { playbackQueue = {} } = await browser.storage.local.get("playbackQueue");
      const entries = Object.entries(playbackQueue);
      if (!entries.length) return;
      await uploadPlayback(c.code, entries.map(([, e]) => e), { stillAllowed: async () => allowed(c, await config()) });
      await locked(async () => {
        if (!allowed(c, await config())) return;
        const { playbackQueue: latest = {} } = await browser.storage.local.get("playbackQueue");
        for (const [key, e] of entries) if (latest[key]?.observedAt === e.observedAt) delete latest[key];
        await browser.storage.local.set({ playbackQueue: latest, playbackStatus: { phase: "success", checkedAt: (/* @__PURE__ */ new Date()).toISOString(), message: "YouTube konumu ve izlenen s\xFCre e\u015Fitlendi." } });
      });
    } catch (error) {
      await browser.storage.local.set({ playbackStatus: { phase: "error", message: error.message } });
    } finally {
      flushing = false;
      const c = await config(), { playbackQueue = {} } = await browser.storage.local.get("playbackQueue");
      if (c?.enabled && Object.keys(playbackQueue).length) await browser.alarms.create("playback", { delayInMinutes: 2 });
    }
  }
  async function resumePlayback() {
    await browser.alarms.clear("playback");
    const c = await config(), { playbackQueue = {} } = await browser.storage.local.get("playbackQueue");
    if (c?.enabled && Object.keys(playbackQueue).length) await browser.alarms.create("playback", { delayInMinutes: 0.5 });
  }

  // firefox-extension/src/speed-background.mjs
  function validSpeedSender(message, sender) {
    if (sender?.id !== browser.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || !/^[-\w]{11}$/.test(message?.videoId || "")) return false;
    let url;
    try {
      url = new URL(sender.url);
    } catch {
      return null;
    }
    return url.origin === "https://www.youtube.com" && url.pathname === "/watch" && url.searchParams.get("v") === message.videoId;
  }
  async function getSpeedInfo(message, sender) {
    if (!validSpeedSender(message, sender)) return null;
    try {
      const result = await browser.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [0] }, world: "MAIN", func: (requestedId) => {
        if (location.origin !== "https://www.youtube.com" || location.pathname !== "/watch" || new URL(location.href).searchParams.get("v") !== requestedId) return null;
        const player = document.getElementById("movie_player");
        if (!player || player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting")) return null;
        const response = player.getPlayerResponse?.() || window.ytInitialPlayerResponse;
        const data = player.getVideoData?.();
        const metadata = document.querySelector("ytd-watch-metadata[video-id]");
        const watch = document.querySelector("ytd-watch-flexy[video-id]");
        const videoId = data?.video_id || response?.videoDetails?.videoId || metadata?.getAttribute("video-id") || watch?.getAttribute("video-id");
        if (videoId !== requestedId || response?.videoDetails?.isLive === true) return null;
        const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        const trackId = response?.streamingData?.adaptiveFormats?.find((format) => format?.audioTrack?.audioIsDefault === true && typeof format.audioTrack.id === "string")?.audioTrack?.id;
        const captionList = response?.captions?.playerCaptionsTracklistRenderer;
        const captionTrackId = captionList?.audioTracks?.[captionList.defaultAudioTrackIndex]?.audioTrackId;
        const trackLanguage = String(trackId || captionTrackId || "").match(/^([a-z]{2,3}(?:-[a-z0-9]+)*)\.\d+$/i)?.[1] || "";
        const audioLanguage = response?.microformat?.playerMicroformatRenderer?.defaultAudioLanguage || response?.videoDetails?.defaultAudioLanguage || response?.videoDetails?.audioLanguage || trackLanguage;
        const author = data?.author || response?.videoDetails?.author || document.querySelector("ytd-watch-metadata ytd-channel-name a")?.textContent || "";
        return {
          videoId,
          channelName: String(author).trim().slice(0, 200),
          audioLanguage: typeof audioLanguage === "string" ? audioLanguage.slice(0, 30) : "",
          captionTracks: Array.isArray(tracks) ? tracks.filter((t) => t?.kind === "asr" && typeof t.languageCode === "string").slice(0, 5).map((t) => ({ kind: "asr", languageCode: t.languageCode.slice(0, 30) })) : []
        };
      }, args: [message.videoId] });
      return result[0]?.result || null;
    } catch {
      return null;
    }
  }
  async function setSpeed(message, sender) {
    if (!validSpeedSender(message, sender) || ![1, 1.25, 1.5].includes(message.rate)) return { ok: false };
    try {
      const result = await browser.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [0] }, world: "MAIN", func: (requestedId, rate) => {
        if (location.origin !== "https://www.youtube.com" || location.pathname !== "/watch" || new URL(location.href).searchParams.get("v") !== requestedId) return null;
        const player = document.getElementById("movie_player"), video = player?.querySelector("video.html5-main-video");
        if (!video || player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting")) return null;
        const knownId = player.getVideoData?.()?.video_id || player.getPlayerResponse?.()?.videoDetails?.videoId || document.querySelector("ytd-watch-metadata[video-id]")?.getAttribute("video-id") || document.querySelector("ytd-watch-flexy[video-id]")?.getAttribute("video-id");
        if (knownId !== requestedId || !Number.isFinite(video.duration) || video.duration <= 0) return null;
        if (typeof player.setPlaybackRate === "function") player.setPlaybackRate(rate);
        if (Math.abs(video.playbackRate - rate) > 1e-3) video.playbackRate = rate;
        return { videoId: requestedId, rate: video.playbackRate };
      }, args: [message.videoId, message.rate] });
      const applied = result[0]?.result;
      return { ok: applied?.videoId === message.videoId && Math.abs(applied.rate - message.rate) < 1e-3, videoId: applied?.videoId, rate: applied?.rate };
    } catch {
      return { ok: false };
    }
  }

  // firefox-extension/src/background.mjs
  var WL = "https://www.youtube.com/playlist?list=WL";
  var running = false;
  var ownedTab = null;
  var cancelled = false;
  var getConfig = async () => (await browser.storage.local.get("config")).config;
  async function status(value) {
    await browser.storage.local.set({ status: value });
    await browser.action.setBadgeText({ text: value.phase === "error" ? "!" : value.phase === "running" ? "\u2026" : "" });
    await browser.action.setBadgeBackgroundColor({ color: "#806324" });
  }
  function waitLoaded(id) {
    return new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(updated);
        browser.tabs.onRemoved.removeListener(removed);
        error ? reject(error) : resolve();
      };
      const updated = (tabId, info) => {
        if (tabId === id && info.status === "complete") finish();
      };
      const removed = (tabId) => {
        if (tabId === id) finish(Error("G\xFCncelleme sekmesi kapat\u0131ld\u0131."));
      };
      const timer = setTimeout(() => finish(Error("Sayfa zaman\u0131nda a\xE7\u0131lmad\u0131. \u0130nternet ba\u011Flant\u0131n\u0131 kontrol et.")), 45e3);
      browser.tabs.onUpdated.addListener(updated);
      browser.tabs.onRemoved.addListener(removed);
      browser.tabs.get(id).then((tab) => {
        if (tab.status === "complete") finish();
      }, finish);
    });
  }
  async function removeOwned() {
    const record = (await browser.storage.session.get("ownedTab")).ownedTab;
    const id = ownedTab ?? record?.id;
    ownedTab = null;
    if (id != null) {
      try {
        const tab = await browser.tabs.get(id);
        if (tab.url?.startsWith(WL)) await browser.tabs.remove(id);
      } catch {
      }
    }
    await browser.storage.session.remove("ownedTab");
  }
  async function run() {
    if (running) return;
    const config2 = await getConfig();
    if (!config2?.enabled || !config2.code) return;
    if (running) return;
    running = true;
    cancelled = false;
    const stillAllowed = async () => {
      const now = await getConfig();
      return !cancelled && now?.enabled && now.connectionId === config2.connectionId;
    };
    try {
      await browser.storage.local.set({ lastAttempt: Date.now() });
      await removeOwned();
      await status({ phase: "running", message: "YouTube listesi kontrol ediliyor\u2026", startedAt: (/* @__PURE__ */ new Date()).toISOString() });
      const cloud = await cloudRequest(config2.code);
      if (!cloud.document?.videos?.length) throw Error("\xD6nce Firefox\u2019taki LaterLab k\xFCt\xFCphanende E\u015Fitlendi yaz\u0131s\u0131n\u0131 g\xF6r.");
      const ids = cloud.document.videos.map((v) => v.id);
      if (ids.length > 2e4 || ids.some((id) => !/^[-\w]{11}$/.test(id))) throw Error("LaterLab k\xFCt\xFCphanesi do\u011Frulanamad\u0131.");
      if (!await stillAllowed()) throw Error("Otomatik g\xFCncelleme durduruldu.");
      const tab = await browser.tabs.create({ url: WL, active: false });
      ownedTab = tab.id;
      await browser.storage.session.set({ ownedTab: { id: tab.id, startedAt: Date.now() } });
      await browser.alarms.create("cleanup", { delayInMinutes: 6 });
      await waitLoaded(tab.id);
      if (!await stillAllowed()) throw Error("Otomatik g\xFCncelleme durduruldu.");
      await browser.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["youtube.js"] });
      const results = await browser.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: async (ids2, account2) => {
        try {
          return { ok: true, value: await globalThis.__laterlabCollect(ids2, account2) };
        } catch (error) {
          return { ok: false, error: error.message };
        } finally {
          delete globalThis.__laterlabCollect;
        }
      }, args: [ids, config2.account || null] });
      const result = results[0]?.result;
      if (!result?.ok) throw Error(result?.error || "YouTube listesi okunamad\u0131.");
      const { account, delta } = result.value;
      if (!/^[a-f0-9]{64}$/.test(account) || config2.account && config2.account !== account) throw Error("YouTube hesap e\u015Fle\u015Fmesi do\u011Frulanamad\u0131.");
      if (!Array.isArray(delta?.baseIds) || delta.baseIds.length !== ids.length || new Set(delta.baseIds).size !== ids.length || delta.baseIds.some((id) => !ids.includes(id))) throw Error("Aktar\u0131m referans\u0131 de\u011Fi\u015Fti. G\xFCncelleme yap\u0131lmad\u0131.");
      const saved = await uploadDelta(config2.code, delta, { stillAllowed, backup: (payload) => browser.storage.local.set({ lastCloudBackup: { payload, savedAt: (/* @__PURE__ */ new Date()).toISOString() } }) });
      const latest = await getConfig();
      if (latest?.connectionId === config2.connectionId) {
        await browser.storage.local.set({ config: { ...latest, account }, lastSuccess: saved });
      }
      await status({ phase: "success", message: saved.added ? `${saved.added} yeni video LaterLab\u2019e eklendi.` : "Liste kontrol edildi; yeni video yok.", ...saved });
    } catch (error) {
      await status({ phase: "error", message: error.message, attemptedAt: (/* @__PURE__ */ new Date()).toISOString() });
    } finally {
      await removeOwned();
      await browser.alarms.clear("cleanup");
      running = false;
    }
  }
  async function connectFromApp() {
    const tabs = await browser.tabs.query({ url: APP + "/*" });
    let tab = tabs.find((t) => !t.incognito && (!t.cookieStoreId || t.cookieStoreId === "firefox-default")), created = false;
    if (!tab) {
      tab = await browser.tabs.create({ url: APP + "/", active: false });
      created = true;
    }
    try {
      await waitLoaded(tab.id);
      const result = await browser.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: async () => {
        if (location.origin !== "https://siradaki.alpargu37.workers.dev") return null;
        return new Promise((resolve, reject) => {
          const request = indexedDB.open("siradaki-v1", 1);
          request.onupgradeneeded = () => {
            request.transaction.abort();
            resolve(null);
          };
          request.onerror = () => reject(Error("LaterLab taray\u0131c\u0131 kayd\u0131 okunamad\u0131."));
          request.onsuccess = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains("data")) {
              db.close();
              resolve(null);
              return;
            }
            const r = db.transaction("data").objectStore("data").get("sync");
            r.onsuccess = () => {
              db.close();
              resolve(r.result?.code || null);
            };
            r.onerror = () => {
              db.close();
              reject(Error("LaterLab ba\u011Flant\u0131s\u0131 okunamad\u0131."));
            };
          };
        });
      } });
      const code = result[0]?.result;
      if (!code) throw Error("Bu Firefox profilinde LaterLab ba\u011Fl\u0131 de\u011Fil. \xD6nce LaterLab \u2192 Tercihler b\xF6l\xFCm\xFCnde cihaz\u0131n\u0131 ba\u011Fla veya a\u015Fa\u011F\u0131dan kod dosyas\u0131n\u0131 se\xE7.");
      return code;
    } finally {
      if (created) await browser.tabs.remove(tab.id).catch(() => {
      });
    }
  }
  async function connect(raw) {
    if (running) throw Error("Kontrol\xFCn bitmesini bekle.");
    const code = checkPairCode(raw), cloud = await cloudRequest(code);
    if (!cloud.document?.videos?.length) throw Error("Bulutta hen\xFCz k\xFCt\xFCphane yok. \xD6nce LaterLab\u2019de mevcut listeni e\u015Fitle.");
    const config2 = { code, enabled: true, account: null, intervalMinutes: 360, connectionId: crypto.randomUUID() };
    await browser.storage.local.remove(["playbackQueue", "playbackStatus"]);
    await browser.storage.local.set({ config: config2, lastAttempt: Date.now() });
    await schedule();
    void run();
  }
  async function schedule() {
    const config2 = await getConfig(), { lastAttempt, lastSuccess } = await browser.storage.local.get(["lastAttempt", "lastSuccess"]);
    await browser.alarms.clear("sync");
    if (config2?.enabled) {
      const interval = [30, 360, 720].includes(config2.intervalMinutes) ? config2.intervalMinutes : 360;
      const last = lastAttempt || Date.parse(lastSuccess?.checkedAt) || 0;
      await browser.alarms.create("sync", { delayInMinutes: Math.max(1, (last + interval * 6e4 - Date.now()) / 6e4), periodInMinutes: interval });
    }
    await resumePlayback();
  }
  browser.runtime.onMessage.addListener(async (message, sender) => {
    if (message?.action === "playback") return acceptPlayback(message, sender);
    if (message?.action === "speed-info") return getSpeedInfo(message, sender);
    if (message?.action === "set-speed") return setSpeed(message, sender);
    if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL("options.html")) return;
    try {
      if (message.action === "state") {
        const { config: config2, status: status2, lastSuccess, playbackStatus, playbackQueue } = await browser.storage.local.get(["config", "status", "lastSuccess", "playbackStatus", "playbackQueue"]);
        return { ok: true, connected: !!config2?.code, enabled: !!config2?.enabled, running, status: status2, lastSuccess, playbackStatus, pendingPlayback: Object.keys(playbackQueue || {}).length, intervalMinutes: config2?.intervalMinutes || 360 };
      }
      if (message.action === "connect-app") {
        await connect(await connectFromApp());
        return { ok: true };
      }
      if (message.action === "connect-file") {
        await connect(message.code);
        return { ok: true };
      }
      if (message.action === "interval") {
        const config2 = await getConfig();
        if (!config2 || ![30, 360, 720].includes(message.minutes)) throw Error("Kontrol s\u0131kl\u0131\u011F\u0131 ge\xE7ersiz.");
        await browser.storage.local.set({ config: { ...config2, intervalMinutes: message.minutes } });
        await schedule();
        return { ok: true };
      }
      if (message.action === "now") {
        if (!(await getConfig())?.enabled) throw Error("\xD6nce otomatik g\xFCncellemeyi a\xE7.");
        void run();
        return { ok: true };
      }
      if (message.action === "enabled") {
        const config2 = await getConfig();
        if (!config2) throw Error("\xD6nce LaterLab\u2019i ba\u011Fla.");
        if (!message.enabled) cancelled = true;
        await browser.storage.local.set({ config: { ...config2, enabled: message.enabled === true } });
        await schedule();
        if (!message.enabled) await removeOwned();
        else void run();
        return { ok: true };
      }
      if (message.action === "disconnect") {
        if (running) throw Error("Kontrol\xFCn bitmesini bekle veya \xF6nce otomatik g\xFCncellemeyi duraklat.");
        await browser.storage.local.remove(["config", "lastCloudBackup", "status", "lastSuccess", "knownVideoIds", "lastAttempt", "playbackQueue", "playbackStatus"]);
        await schedule();
        await browser.action.setBadgeText({ text: "" });
        return { ok: true };
      }
      throw Error("\u0130\u015Flem tan\u0131nmad\u0131.");
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  browser.action.onClicked.addListener(() => browser.runtime.openOptionsPage());
  browser.runtime.onInstalled.addListener(async (details) => {
    await browser.storage.local.remove("knownVideoIds");
    await schedule();
    if (details.reason === "install") await browser.runtime.openOptionsPage();
  });
  browser.runtime.onStartup.addListener(schedule);
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "playback") await flushPlayback();
    if (alarm.name === "sync") await run();
    if (alarm.name === "cleanup") {
      cancelled = true;
      await removeOwned();
      if (!running) await status({ phase: "error", message: "\xD6nceki tarama yar\u0131m kald\u0131. Sonraki kontrolde yeniden denenecek." });
    }
  });
})();
