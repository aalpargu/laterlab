(() => {
  // firefox-extension/src/speed.mjs
  var channelSpeed = /* @__PURE__ */ new Map([
    ["bora ozkent", 1.25],
    ["kanal finans", 1.5],
    ["yatirim 101", 1.5]
  ]);
  function channelKey(value) {
    return String(value || "").normalize("NFKD").replace(new RegExp("\\p{M}", "gu"), "").replace(/ı/g, "i").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function spokenLanguage({ audioLanguage, captionTracks } = {}) {
    if (typeof audioLanguage === "string" && audioLanguage.trim()) return audioLanguage.trim();
    const automatic = Array.isArray(captionTracks) ? captionTracks.filter((track) => track?.kind === "asr" && typeof track.languageCode === "string").map((track) => track.languageCode.toLowerCase().split(/[-_]/)[0]) : [];
    return new Set(automatic).size === 1 ? automatic[0] : "";
  }
  function choosePlaybackSpeed({ channelName, audioLanguage, captionTracks } = {}) {
    const language = spokenLanguage({ audioLanguage, captionTracks });
    if (/^en(?:[-_]|$)/i.test(language)) return 1;
    return channelSpeed.get(channelKey(channelName)) ?? 1.5;
  }

  // firefox-extension/src/playback.mjs
  function measure(previous, current) {
    if (!previous || !previous.playing || !current.valid || !previous.valid || current.seeking || previous.seeking || previous.src !== current.src) return { seconds: 0, media: 0 };
    const wall = (current.at - previous.at) / 1e3, advance = current.position - previous.position;
    if (wall <= 0 || wall > 10 || advance <= 0 || advance > wall * previous.rate + 1.5) return { seconds: 0, media: 0 };
    return { seconds: Math.min(wall, advance / previous.rate), media: Math.min(advance, wall * previous.rate) };
  }
  function startTracking() {
    if (globalThis.__laterlabTracking) return;
    globalThis.__laterlabTracking = true;
    let video = null, previous = null, session = null, lastSent = 0, busy = false, navigating = false, pendingUrgent = false;
    let speed = { video: null, id: null, applied: false, manual: false, inFlight: false, requestedAt: 0, expectedRate: null, firstAppliedAt: 0, originalRate: null, desiredRate: null, retries: 0, userSpeedIntent: false };
    const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" });
    const day = () => dayFormatter.format(/* @__PURE__ */ new Date());
    const videoId = () => location.pathname === "/watch" ? new URL(location.href).searchParams.get("v") : null;
    const newSpeedState = () => {
      speed = { video: null, id: null, applied: false, manual: false, inFlight: false, requestedAt: 0, expectedRate: null, firstAppliedAt: 0, originalRate: null, desiredRate: null, retries: 0, userSpeedIntent: false };
    };
    function maybeSetSpeed() {
      const id = videoId(), player = document.getElementById("movie_player");
      if (navigating || !video || !/^[-\w]{11}$/.test(id || "") || video.readyState < 2 || !Number.isFinite(video.duration) || video.duration <= 0 || player?.classList.contains("ad-showing") || player?.classList.contains("ad-interrupting")) return;
      if (speed.video !== video || speed.id !== id) speed = { video, id, applied: false, manual: false, inFlight: false, requestedAt: 0, expectedRate: null, firstAppliedAt: 0, originalRate: null, desiredRate: null, retries: 0, userSpeedIntent: false };
      if (speed.applied || speed.manual || speed.inFlight || Date.now() - speed.requestedAt < 1e3) return;
      const current = speed;
      current.inFlight = true;
      current.requestedAt = Date.now();
      void (async () => {
        try {
          const info = await browser.runtime.sendMessage({ action: "speed-info", videoId: id });
          if (speed !== current || navigating || current.manual || video !== current.video || videoId() !== id || info?.videoId !== id) return;
          const rate = choosePlaybackSpeed(info);
          current.desiredRate = rate;
          if (current.originalRate === null) current.originalRate = video.playbackRate;
          current.expectedRate = rate;
          const applied = await browser.runtime.sendMessage({ action: "set-speed", videoId: id, rate });
          if (speed !== current || navigating || current.manual || video !== current.video || videoId() !== id) return;
          if (applied?.ok && applied.videoId === id && Math.abs(video.playbackRate - rate) < 1e-3) {
            if (!current.firstAppliedAt) current.firstAppliedAt = Date.now();
            current.applied = true;
            previous = null;
          } else current.expectedRate = null;
        } catch {
          current.expectedRate = null;
        } finally {
          current.inFlight = false;
        }
      })();
    }
    function sample() {
      if (Date.now() < lastSent) {
        previous = null;
        return false;
      }
      const id = videoId(), player = document.getElementById("movie_player");
      const valid = !navigating && /^[-\w]{11}$/.test(id || "") && video && Number.isFinite(video.duration) && video.duration > 0 && video.readyState >= 2 && !player?.classList.contains("ad-showing") && !player?.classList.contains("ad-interrupting");
      if (!valid) {
        previous = null;
        return false;
      }
      if (!session || session.videoId !== id || session.day !== day()) {
        session = { sessionId: crypto.randomUUID(), videoId: id, day: day(), seconds: 0, mediaSeconds: 0 };
        previous = null;
        lastSent = 0;
      }
      const current = { at: performance.now(), position: video.currentTime, rate: video.playbackRate || 1, playing: !video.paused && !video.ended, valid: true, seeking: video.seeking, src: video.currentSrc };
      const delta = measure(previous, current);
      session.seconds += delta.seconds;
      session.mediaSeconds += delta.media;
      session.position = Math.floor(video.currentTime);
      session.duration = Math.floor(video.duration);
      session.ended = video.ended;
      previous = current;
      return true;
    }
    async function report(urgent = false) {
      if (busy) {
        pendingUrgent = pendingUrgent || urgent;
        return;
      }
      if (!sample() || session.position === 0 && session.seconds < 1 || Date.now() < lastSent || !urgent && Date.now() - lastSent < 15e3) return;
      busy = true;
      const payload = { ...session, seconds: Math.floor(session.seconds), mediaSeconds: Math.floor(session.mediaSeconds), observedAt: Date.now() };
      try {
        const result = await browser.runtime.sendMessage({ action: "playback", event: payload, urgent });
        if (result?.ok) lastSent = Date.now();
        else {
          lastSent = Date.now() + 45e3;
          if (result?.reset && session?.sessionId === payload.sessionId) {
            session = { ...session, sessionId: crypto.randomUUID(), seconds: 0, mediaSeconds: 0 };
            previous = null;
          }
        }
      } catch {
        lastSent = Date.now() + 45e3;
      } finally {
        busy = false;
        if (pendingUrgent) {
          pendingUrgent = false;
          void report(true);
        }
      }
    }
    const tick = () => {
      maybeSetSpeed();
      sample();
      void report();
    };
    const pause = () => {
      sample();
      void report(true);
    };
    const reset = () => {
      previous = null;
    };
    const rateChanged = () => {
      previous = null;
      if (speed.video !== video) return;
      if (speed.expectedRate !== null && Math.abs(video.playbackRate - speed.expectedRate) < 1e-3) {
        speed.expectedRate = null;
        return;
      }
      speed.expectedRate = null;
      if (speed.userSpeedIntent) {
        speed.manual = true;
        speed.applied = false;
        return;
      }
      if (!speed.applied) return;
      if (Date.now() - speed.firstAppliedAt < 8e3 && speed.retries < 3 && Math.abs(video.playbackRate - speed.originalRate) < 1e-3) {
        speed.applied = false;
        speed.retries++;
        speed.requestedAt = 0;
        maybeSetSpeed();
        return;
      }
      speed.manual = true;
    };
    function attach() {
      const found = document.querySelector("#movie_player video.html5-main-video");
      if (found === video) {
        maybeSetSpeed();
        return;
      }
      if (video) for (const [event, fn] of [["timeupdate", tick], ["playing", maybeSetSpeed], ["pause", pause], ["ended", pause], ["seeking", reset], ["emptied", reset], ["loadedmetadata", tick], ["ratechange", rateChanged]]) video.removeEventListener(event, fn);
      video = found;
      previous = null;
      newSpeedState();
      if (video) for (const [event, fn] of [["timeupdate", tick], ["playing", maybeSetSpeed], ["pause", pause], ["ended", pause], ["seeking", reset], ["emptied", reset], ["loadedmetadata", tick], ["ratechange", rateChanged]]) video.addEventListener(event, fn);
      if (video) {
        maybeSetSpeed();
        void report();
      }
    }
    document.addEventListener("yt-navigate-start", () => {
      void report(true);
      navigating = true;
      previous = null;
      session = null;
      newSpeedState();
    });
    document.addEventListener("yt-navigate-finish", () => {
      navigating = false;
      previous = null;
      attach();
      void report();
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.target?.closest?.(".ytp-settings-button,.ytp-settings-menu")) speed.userSpeedIntent = true;
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "<" || event.key === ">" || event.shiftKey && [".", ","].includes(event.key)) speed.userSpeedIntent = true;
    }, true);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void report(true);
      else attach();
    });
    window.addEventListener("pagehide", () => {
      void report(true);
    });
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        attach();
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
    attach();
  }
  if (typeof document !== "undefined" && typeof browser !== "undefined") startTracking();
})();
