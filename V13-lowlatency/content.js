(() => {
  if (window.__watchTogetherLoaded) return;
  window.__watchTogetherLoaded = true;

  const PEER_PREFIX = "wtp-v1-";
  const EXT_VER = "1.13.0";
  const HB_MS = 4000;
  const GUEST_RETRY_MS = 3500;
  const MAX_GUEST_RETRIES = 20;

  const S = {
    peer: null,
    conn: null,
    role: null,
    roomId: null,
    name: "",
    video: null,
    applyingRemote: false,
    remoteTime: 0,
    remotePaused: true,
    remoteAt: 0,
    hbTimer: null,
    retryTimer: null,
    retries: 0,
    stopping: false,
    micEnabled: false,
    micStream: null,
    voiceConn: null,
    lastRxAt: 0,
    wdTimer: null,
    friendName: null,
    friendVer: null,
    verWarned: false,
    voiceCheckTimer: null,
    voiceAnnounced: false,
    remoteRate: 1,
    probeAt: null,
    lastHelloSent: 0,
    helloStateSent: false,
    lastHbSent: 0,
    typingTimer: null,
    typingSentAt: 0,
    voiceVol: 1,
    nowLabel: "",
    reactFreq: {},
    reactRecent: [],
    quickHover: null,
    directMode: false,
    glass: false,
    quickIdleTimer: null,
    nc: true,
    netErrStreak: 0,
    reconnecting: false,
    hist: [],
    histTickAt: 0,
    histSavedAt: 0,
    gateTimer: null,
    gateMuted: false,
    silentCtx: null,
    silentTrack: null
  };

  const ui = {};
  let lastStatus = { state: "idle", detail: "" };
  let pendingPlay = false;

  const num = (x) => (typeof x === "number" && isFinite(x) ? x : null);
  const isOpen = () => !!(S.conn && S.conn.open);

  function send(obj) {
    if (isOpen()) {
      try { S.conn.send(obj); } catch (_) {}
    }
  }

  function setStatus(state, detail) {
    lastStatus = { state, detail: detail || "" };
    try {
      chrome.storage.local.set({ wt_status: { state, detail: detail || "", ts: Date.now() } });
    } catch (_) {}
    renderStatus();
  }

  // ---------- video binding ----------

  function bestVideo() {
    let best = null;
    let bestArea = 0;
    for (const v of document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect();
      if (r.width < 100 || r.height < 80) continue;
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = v;
      }
    }
    return best;
  }

  function bindVideo() {
    const v = bestVideo();
    if (!v || v === S.video) return;
    unbindVideo();
    S.video = v;
    v.addEventListener("play", onPlayPause);
    v.addEventListener("pause", onPlayPause);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("ratechange", onRateChange);
  }

  function unbindVideo() {
    const v = S.video;
    if (!v) return;
    v.removeEventListener("play", onPlayPause);
    v.removeEventListener("pause", onPlayPause);
    v.removeEventListener("seeked", onSeeked);
    v.removeEventListener("ratechange", onRateChange);
    S.video = null;
  }

  function onPlayPause(e) {
    if (S.applyingRemote || !isOpen()) return;
    const v = e.target;
    if (!v.paused && S.remoteAt && !S.remotePaused && Date.now() - S.remoteAt < 10000) {
      // resuming after OUR pause: never rewind the pair to our stale clock -
      // snap ourselves to the friend's live position first, THEN announce play
      const r = S.remoteRate || 1;
      const expected = S.remoteTime + ((Date.now() - S.remoteAt) / 1000) * r;
      if (isFinite(expected)) {
        const off = v.currentTime - expected;
        if (off > 1.5 || off < -1.5) {
          try { v.currentTime = expected; } catch (_) {}
        }
      }
    }
    send({ t: v.paused ? "pause" : "play", time: v.currentTime, from: S.name });
  }

  function onSeeked(e) {
    if (S.applyingRemote || !isOpen()) return;
    send({ t: "seek", time: e.target.currentTime, paused: e.target.paused, from: S.name });
  }

  function onRateChange(e) {
    if (S.applyingRemote || !isOpen()) return;
    send({ t: "rate", r: e.target.playbackRate || 1, time: e.target.currentTime, from: S.name });
  }

  // ---------- remote application ----------

  function seekTo(v, t) {
    if (!isFinite(t) || t < 0) return;
    if (Math.abs(v.currentTime - t) < 0.25) return;
    try { v.currentTime = t; } catch (_) {}
  }

  function safePlay(v) {
    try {
      const p = v.play();
      if (p && p.catch) {
        p.catch(() => {
          pendingPlay = true;
          toast("Click anywhere on the page to resume playback");
        });
      }
    } catch (_) {
      pendingPlay = true;
    }
  }

  document.addEventListener(
    "pointerdown",
    () => {
      if (pendingPlay && S.video) {
        pendingPlay = false;
        safePlay(S.video);
      }
      const ra = document.querySelector("#wt-remote-audio");
      if (ra && ra.srcObject) {
        try { ra.play().catch(() => {}); } catch (_) {}
      }
    },
    true
  );

  function applyRemote(m) {
    const v = S.video;
    if (!v) return;
    // activity popup: who did what (initial state sync stays quiet)
    if (m.t === "play" || m.t === "pause" || m.t === "seek") {
      const who = String(m.from || "Friend").slice(0, 24);
      if (m.t === "play") activity("\u25b6\ufe0f", `${who} played`);
      else if (m.t === "pause") activity("\u23f8\ufe0f", `${who} paused`);
      else {
        const diff = num(m.time) !== null ? m.time - v.currentTime : 0;
        if (diff > 15) activity("\u23e9", `${who} skipped forward`);
        else if (diff < -15) activity("\u23ea", `${who} skipped back`);
      }
    }
    S.applyingRemote = true;
    clearTimeout(applyRemote._t);
    applyRemote._t = setTimeout(() => {
      S.applyingRemote = false;
    }, 400);
    try {
      const time = num(m.time);
      if (time === null) return;
      S.remoteTime = time;
      S.remoteAt = Date.now();
      if (typeof m.paused === "boolean") S.remotePaused = m.paused;
      else if (m.t === "pause") S.remotePaused = true;
      else if (m.t === "play" || m.t === "seek" || m.t === "rate") S.remotePaused = v.paused;
      if (m.t === "state" || m.t === "seek" || m.t === "pause") seekTo(v, time);
      switch (m.t) {
        case "state":
          if (m.paused) {
            if (!v.paused) v.pause();
          } else {
            safePlay(v);
          }
          break;
        case "seek":
          break;
        case "pause":
          if (!v.paused) v.pause();
          break;
        case "play":
          if (Math.abs(v.currentTime - time) > 1.2) seekTo(v, time);
          safePlay(v);
          break;
        case "rate": {
          const rr = num(m.r);
          if (rr !== null && rr >= 0.25 && rr <= 4) {
            S.applyingRemote = true;
            clearTimeout(applyRemote._t);
            applyRemote._t = setTimeout(() => { S.applyingRemote = false; }, 400);
            try { v.playbackRate = rr; } catch (_) {}
          }
          break;
        }
      }
    } catch (_) {}
  }

  function pushState() {
    const v = S.video;
    if (!v) return;
    send({ t: "state", time: v.currentTime, paused: v.paused, from: S.name });
  }

  function driftCheck() {
    const v = S.video;
    if (!v || S.applyingRemote || !isOpen()) return;
    if (S.remotePaused || v.paused) return;
    if (!S.remoteAt || Date.now() - S.remoteAt > 12000) return;
    const rate = S.remoteRate || 1;
    const expected = S.remoteTime + ((Date.now() - S.remoteAt) / 1000) * rate;
    if (!isFinite(expected)) return;
    const diff = Math.abs(v.currentTime - expected);
    // guest obeys tightly; host yields only to big divergences (keeps authority)
    const limit = S.role === "host" ? 3.0 : 1.8;
    if (diff > limit) {
      S.applyingRemote = true;
      setTimeout(() => { S.applyingRemote = false; }, 400);
      seekTo(v, expected);
    }
  }

  function sendHb() {
    accrueWatch();
    const now = Date.now();
    if (now - (S.lastHbSent || 0) < 3800) return;
    if (!isOpen()) return;
    S.lastHbSent = now;
    // self-healing handshake: if a hello was lost (flaky reconnect), re-announce
    if (now - (S.lastHelloSent || 0) > 15000) {
      S.lastHelloSent = now;
      send({ t: "hello", name: S.name, v: EXT_VER });
    }
    const v = S.video;
    send({ t: "hb", time: v ? v.currentTime : null, paused: v ? v.paused : true, r: v ? (v.playbackRate || 1) : 1 });
  }

  // Chrome throttles timers in backgrounded/silent tabs down to ~1/minute,
  // which starves heartbeats and lets NAT mappings die overnight. A dedicated
  // Worker is NEVER throttled, so it keeps the line warm around the clock.
  let kaWorker = null;
  function ensureKeepaliveWorker() {
    if (kaWorker !== null) return;
    try {
      const url = URL.createObjectURL(new Blob(["setInterval(function(){postMessage(1)},4000);"], { type: "text/javascript" }));
      const w = new Worker(url);
      w.onmessage = () => backgroundTick();
      w.onerror = () => { try { w.terminate(); } catch (_) {} kaWorker = false; };
      kaWorker = w;
    } catch (_) { kaWorker = false; }
  }
  function backgroundTick() {
    if (S.stopping || !S.roomId) return;
    accrueWatch();
    sendHb();
    reconnectPeer();
    checkZombie();
  }

  // v10: serialize signaling-socket revival. Wi-Fi drops used to trigger
  // overlapping peer.reconnect() calls from 4 different timers, which made
  // PeerJS emit a storm of network errors and flap the status line.
  function reconnectPeer() {
    const p = S.peer;
    if (!p || !p.disconnected || S.reconnecting || S.stopping) return;
    S.reconnecting = true;
    setTimeout(() => { S.reconnecting = false; }, 5000);
    try { p.reconnect(); } catch (_) { S.reconnecting = false; }
  }

  function startHb() {
    stopHb();
    ensureKeepaliveWorker();
    S.hbTimer = setInterval(sendHb, HB_MS);
  }

  function stopHb() {
    clearInterval(S.hbTimer);
    S.hbTimer = null;
  }

  // ---------- connection watchdog ----------
  // Detects a silently-dead data channel (conn.open but no packets flowing)
  // and rebuilds it. Also keeps the PeerJS signaling socket alive.

  const WATCHDOG_MS = 12000;
  const WATCHDOG_HIDDEN_MS = 120000; // throttled background tabs deserve huge patience
  const PROBE_GRACE_MS = 20000;

  function touchRx() {
    S.lastRxAt = Date.now();
    S.probeAt = null;
  }

  function checkZombie() {
    if (!isOpen()) { S.probeAt = null; return; }
    const hidden = typeof document !== "undefined" && !!document.hidden;
    const limit = hidden ? WATCHDOG_HIDDEN_MS : WATCHDOG_MS;
    const stale = Date.now() - S.lastRxAt;
    if (stale <= limit) { S.probeAt = null; return; }
    // benefit of the doubt first: probe the link explicitly before killing it
    if (!S.probeAt) { S.probeAt = Date.now(); send({ t: "ping" }); return; }
    if (Date.now() - S.probeAt > PROBE_GRACE_MS) {
      S.probeAt = null;
      teardownConn();
      if (S.role === "guest") {
        setStatus("waiting", "Connection stalled \u2013 restoring\u2026");
        scheduleRetry();
      } else {
        setStatus("waiting", "Connection lost \u2013 waiting for your friend\u2026");
      }
    }
  }

  function startWatchdog() {
    if (S.wdTimer) return;
    S.wdTimer = setInterval(() => {
      if (S.stopping) return;
      // keep signaling socket connected (it decays after long idle)
      reconnectPeer();
      checkZombie();
    }, 3000);
  }

  function stopWatchdog() {
    clearInterval(S.wdTimer);
    S.wdTimer = null;
  }

  // ---------- voice chat ----------

  function ensureRemoteAudio() {
    let a = ui.root.querySelector("#wt-remote-audio");
    if (!a) {
      a = document.createElement("audio");
      a.id = "wt-remote-audio";
      a.autoplay = true;
      a.volume = S.voiceVol;
      a.style.display = "none";
      ui.root.appendChild(a);
    }
    return a;
  }

  // v12: Chrome's autoplay policy can leave the remote-audio element paused
  // forever (the old code only toasted "click anywhere" but never actually
  // resumed on click). This wires REAL recovery: retry play(), resume on any
  // user gesture / focus, and show a tappable pill while blocked.
  function wtRemoteEls() {
    return Array.prototype.slice.call(document.querySelectorAll("audio#wt-remote-audio"));
  }

  function hideVoicePill() {
    const p = document.getElementById("wt-voice-pill");
    if (p) p.remove();
  }

  function showVoicePill() {
    if (document.getElementById("wt-voice-pill")) return;
    const p = document.createElement("div");
    p.id = "wt-voice-pill";
    p.textContent = "\ud83d\udd0a Click to enable voice";
    p.addEventListener("click", (e) => {
      try { e.stopPropagation(); } catch (_) {}
      for (const el of wtRemoteEls()) { try { el.play().catch(() => {}); } catch (_) {} }
      setTimeout(hideVoicePill, 250);
    });
    (ui.root || document.body).appendChild(p);
  }

  function resumeRemoteAudio() {
    let anyPaused = false;
    for (const el of wtRemoteEls()) {
      if (!el.srcObject && !el.src) continue;
      try {
        if (el.paused) { anyPaused = true; el.play().catch(() => {}); }
      } catch (_) {}
    }
    if (!anyPaused) hideVoicePill();
    else {
      // give the resume a beat to take effect before re-showing the pill
      setTimeout(() => {
        const stillPaused = wtRemoteEls().some((el) => el.srcObject && el.paused);
        if (stillPaused) showVoicePill(); else hideVoicePill();
      }, 350);
    }
  }

  let voiceResumeWired = false;
  function wireVoiceResume() {
    if (voiceResumeWired) return;
    voiceResumeWired = true;
    const opts = { capture: true, passive: true };
    document.addEventListener("pointerdown", () => { try { resumeRemoteAudio(); } catch (_) {} }, opts);
    document.addEventListener("keydown", () => { try { resumeRemoteAudio(); } catch (_) {} }, { capture: true });
    window.addEventListener("focus", () => { try { resumeRemoteAudio(); } catch (_) {} });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) { try { resumeRemoteAudio(); } catch (_) {} }
    });
  }

  function applyVoiceVol(pct, save) {
    const v = Math.min(1, Math.max(0, Number(pct) || 0));
    S.voiceVol = v;
    const a = ui.root && ui.root.querySelector("#wt-remote-audio");
    if (a) {
      try { a.volume = v; } catch (_) {}
    }
    if (ui.volSlider) ui.volSlider.value = Math.round(v * 100);
    if (save) {
      try { chrome.storage.local.set({ wt_voice_vol: v }); } catch (_) {}
    }
  }

  async function getMicStream() {
    if (S.micStream && S.micStream.active) return S.micStream;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: !!S.nc,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
        sampleSize: 16
      }
    });
    S.micStream = stream;
    return stream;
  }

  // v11: a permanently-live silent audio slot. Every voice call is answered /
  // dialed WITH this when a mic isn't active, so both sides always have a
  // sendrecv audio m-line. That lets us attach/detach the real mic later via
  // replaceTrack() without renegotiation - which is what previously broke
  // ("one side mutes -> other side's voice dies").
  function ensureSilentTrack() {
    if (S.silentTrack && S.silentTrack.readyState === "live") return S.silentTrack;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (typeof AC !== "function") return null;
      if (!S.silentCtx || S.silentCtx.state === "closed") S.silentCtx = new AC();
      const dest = S.silentCtx.createMediaStreamDestination();
      const osc = S.silentCtx.createOscillator();
      const gain = S.silentCtx.createGain();
      gain.gain.value = 0;
      osc.connect(gain); gain.connect(dest);
      try { osc.start(); } catch (_) {}
      S.silentTrack = dest.stream.getAudioTracks()[0] || null;
    } catch (_) { S.silentTrack = null; }
    return S.silentTrack;
  }

  function getAnswerStream() {
    if (S.micStream && S.micStream.active) return S.micStream;
    const st = ensureSilentTrack();
    if (st && typeof MediaStream === "function") {
      try { return new MediaStream([st]); } catch (_) {}
    }
    return undefined;
  }

  // ---------- v10: built-in noise cancellation toggle ----------
  function applyNcUi() {
    if (!ui.root) return;
    const b = ui.ncBtn;
    if (b) {
      b.classList.toggle("wt-on", !!S.nc);
      b.title = S.nc ? "Noise cancellation ON \u2013 click to turn off" : "Noise cancellation OFF \u2013 click to turn on";
    }
  }

  function saveNcState(on) {
    try { chrome.storage.local.set({ wt_nc: !!on }); } catch (_) {}
  }

  async function applyNcToLiveStream() {
    const stream = S.micStream;
    if (!stream || !stream.active) return true;
    const track = stream.getAudioTracks()[0];
    let applied = false;
    if (track && typeof track.applyConstraints === "function") {
      try {
        await track.applyConstraints({ noiseSuppression: !!S.nc });
        applied = true;
      } catch (_) {}
    }
    if (!applied) {
      // fallback: rebuild the stream from scratch with new constraints
      try {
        stopGate();
        for (const t of stream.getTracks()) { try { t.stop(); } catch (_) {} }
        const fresh = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: !!S.nc,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 48000,
            sampleSize: 16
          }
        });
        S.micStream = fresh;
        watchMicStream(fresh);
        hotSwapMicTrack(fresh);
        if (S.micEnabled && !!S.nc) startGate();
      } catch (_) {
        return false;
      }
    }
    return true;
  }

  function hotSwapMicTrack(stream) {
    // v12: returns TRUE only if a slot was actually claimed. Callers use this
    // to trigger a one-shot re-dial fallback instead of trusting a silent
    // failure that leaves one side permanently mute on the wire.
    try {
      const pc = S.voiceConn && S.voiceConn.peerConnection;
      if (!pc || typeof pc.getSenders !== "function") return false;
      const nt = stream && stream.getAudioTracks()[0] || null;
      const senders = pc.getSenders();
      let swapped = false;
      for (const s of senders) {
        if (s.track && s.track.kind === "audio" && typeof s.replaceTrack === "function") {
          try { s.replaceTrack(nt); swapped = true; } catch (_) {}
        }
      }
      // v11: our voice lines are AUDIO-ONLY, so an empty sender slot is still
      // the mic slot. Needed after a mute left the sender trackless.
      if (!swapped && nt) {
        for (const s of senders) {
          if (!s.track && typeof s.replaceTrack === "function") {
            try { s.replaceTrack(nt); swapped = true; break; } catch (_) {}
          }
        }
      }
      if (!swapped && nt && typeof pc.getTransceivers === "function") {
        for (const tr of pc.getTransceivers()) {
          const kind = (tr.receiver && tr.receiver.track && tr.receiver.track.kind) || tr.mid;
          if (kind === "audio" && tr.sender && typeof tr.sender.replaceTrack === "function") {
            try { tr.sender.replaceTrack(nt); swapped = true; break; } catch (_) {}
          }
        }
      }
      if (!swapped) return !nt; // muting with no claimable slot is harmless
      if (!nt) return true;
      // verify the new track really landed in a sender
      try {
        const now = pc.getSenders();
        return now.some((s) => s.track === nt);
      } catch (_) { return true; }
    } catch (_) { return false; }
  }

  // v12: last-resort recovery when a track could not be attached to the live
  // line - drop the MediaConnection once and let the normal sync flow rebuild
  // it WITH the live mic. Host redials directly; guests nudge the host ("vrr").
  function requestVoiceRedial(reason) {
    const now = Date.now();
    if (S.lastVredial && now - S.lastVredial < 5000) return;
    S.lastVredial = now;
    try { console.warn("WT: voice track attach failed (" + reason + ") - rebuilding line"); } catch (_) {}
    if (S.role === "host") {
      endVoiceCall();
      doSyncVoice();
    } else {
      send({ t: "vrr" });
      sysMsg("\u26a0 Voice link repair \u2013 reconnecting mic\u2026");
    }
  }

  // v11: software noise gate. Browser noise suppression misses low-level
  // constant junk (fans, hum, keyboard rumble between words). When NC is on we
  // additionally hard-gate the mic track during TRUE idle only.
  // v13 LATENCY CRITICAL: every enabled=false -> true flip looks like packet
  // loss to the friend's receiver and Chrome's adaptive jitter buffer reacts
  // by INFLATING (cumulative seconds of delay - the "2 second lag" bug).
  // Natural speech pauses must therefore NEVER trip the gate: mute only after
  // ~2.4 s of sustained true quiet, reopen after 2 voiced ticks (~0.24 s) so a
  // single loud blip cannot flap the RTP stream either.
  function stopGate() {
    clearInterval(S.gateTimer);
    S.gateTimer = null;
    // v12 CRITICAL: if the gate had disabled the track, ALWAYS restore it when
    // the gate goes away (NC toggled off, stream rebuilt, mic stopped...).
    // Previously a gate-muted track stayed digitally dead with the mic
    // button showing ON - friend hears nothing at all.
    if (S.gateMuted && S.micStream) {
      S.gateMuted = false;
      for (const t of S.micStream.getAudioTracks()) { try { t.enabled = true; } catch (_) {} }
    }
    S.gateMuted = false;
  }

  function startGate() {
    stopGate();
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (typeof AC !== "function" || !S.micStream || !S.micStream.active) return;
      const ctx = S.silentCtx && S.silentCtx.state !== "closed" ? S.silentCtx : new AC();
      try { if (typeof ctx.resume === "function") ctx.resume(); } catch (_) {}
      const src = ctx.createMediaStreamSource(S.micStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let quietTicks = 0;
      let voicedTicks = 0; // v13: need sustained voice to reopen (no flapping)
      let deadTicks = 0;   // v12: consecutive all-zero frames = broken metering
      let ageTicks = 0;    // v12: warmup - never mute in the first ~1.6s
      const disableTrack = () => {
        if (S.gateMuted) return;
        S.gateMuted = true;
        for (const t of S.micStream.getAudioTracks()) { try { t.enabled = false; } catch (_) {} }
      };
      const enableTrack = () => {
        quietTicks = 0;
        voicedTicks = 0;
        if (!S.gateMuted) return;
        S.gateMuted = false;
        for (const t of S.micStream.getAudioTracks()) { try { t.enabled = true; } catch (_) {} }
      };
      S.gateTimer = setInterval(() => {
        try {
          if (!S.micStream || !S.micStream.active || !S.nc) { stopGate(); return; }
          // v12: suspended/blocked AudioContext reports silence forever -> the
          // old code read that as "user is quiet" and muted them PERMANENTLY.
          // Never gate unless the context is actually running.
          if (typeof ctx.state === "string" && ctx.state !== "running") {
            deadTicks++;
            if (deadTicks > 8) { stopGate(); }
            enableTrack();
            return;
          }
          if (typeof ctx.resume === "function") { try { ctx.resume(); } catch (_) {} }
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          let nonzero = false;
          for (let i = 0; i < buf.length; i++) { sum += buf[i] * buf[i]; if (buf[i] !== 0) { nonzero = true; } }
          const rms = Math.sqrt(sum / buf.length);
          ageTicks++;
          if (!nonzero) {
            // all-exact-zero frames are almost always a dead/suspended audio
            // pipe, NOT real silence (real rooms have a tiny noise floor).
            // Never treat them as "quiet" - count them as broken metering and
            // fail OPEN shortly after.
            deadTicks++;
            voicedTicks = 0;
            if (deadTicks >= 15) { stopGate(); enableTrack(); }
            return;
          }
          deadTicks = 0;
          if (rms < 0.008) {
            voicedTicks = 0;
            if (++quietTicks >= 20 && ageTicks >= 14) disableTrack(); // 2.4s idle
          } else {
            if (++voicedTicks >= 2) enableTrack(); // ~0.24s of voice reopens
          }
        } catch (_) {}
      }, 120);
    } catch (_) { stopGate(); }
  }

  // v11: bump Opus quality. Chrome defaults to ~24-32 kbps mono with DTX-ish
  // behaviour which makes everything sound like a bad phone line and turns
  // background noise into swirl artifacts. We ask for 96 kbps stereo-capable.
  function mungeOpus(sdp) {
    try {
      if (!sdp || sdp.indexOf("maxaveragebitrate") !== -1) return sdp;
      const lines = sdp.split(/\r\n/);
      let pt = null;
      for (const l of lines) {
        const m = /^a=rtpmap:(\d+) opus\/48000/i.exec(l);
        if (m) { pt = m[1]; break; }
      }
      if (pt == null) return sdp;
      let done = false;
      const out = lines.map((l) => {
        if (new RegExp("^a=fmtp:" + pt + " ").test(l)) {
          done = true;
          return l + ";stereo=1;sprop-stereo=1;maxaveragebitrate=96000;usedtx=0";
        }
        return l;
      });
      return done ? out.join("\r\n") : sdp;
    } catch (_) { return sdp; }
  }

  function installOpusBoost() {
    try {
      if (typeof RTCPeerConnection === "undefined" || RTCPeerConnection.prototype.__wtOpus) return;
      const orig = RTCPeerConnection.prototype.setLocalDescription;
      RTCPeerConnection.prototype.setLocalDescription = function (d) {
        try { if (d && typeof d.sdp === "string") d.sdp = mungeOpus(d.sdp); } catch (_) {}
        return orig.call(this, d);
      };
      RTCPeerConnection.prototype.__wtOpus = true;
    } catch (_) {}
  }

  async function toggleNoiseCancel() {
    S.nc = !S.nc;
    applyNcUi();
    saveNcState(S.nc);
    sysMsg(S.nc ? "\ud83c\udfa7 Noise cancellation ON" : "\ud83d\udd07\ud83c\udfa4 Noise cancellation OFF");
    bumpQuickActivity();
    await applyNcToLiveStream();
    // v11: the software gate follows the NC switch
    if (S.micEnabled && !!S.nc) startGate();
    else {
      stopGate();
      if (S.gateMuted) {
        S.gateMuted = false;
        if (S.micStream) for (const t of S.micStream.getAudioTracks()) { try { t.enabled = true; } catch (_) {} }
      }
    }
  }


  function watchMicStream(stream) {
    if (!stream || stream.__wtWatched) return;
    stream.__wtWatched = true;
    for (const track of stream.getTracks()) {
      if (typeof track.addEventListener !== "function") continue;
      track.addEventListener("ended", () => {
        if (S.micEnabled) sysMsg("Mic input lost \u2013 tap \ud83c\udfa4 to retry");
      });
    }
  }

  function endVoiceCall() {
    const c = S.voiceConn;
    S.voiceConn = null;
    if (c) {
      try { c.close(); } catch (_) {}
    }
  }

  function stopMic() {
    stopGate();
    S.micEnabled = false;
    S.gateMuted = false;
    // v11: DO NOT close the voice line here. The MediaConnection carries audio
    // BOTH ways; closing it used to deafen whoever was listening (if neither
    // side wanted to talk, nothing re-dialed and the other side went silent
    // forever). Instead: swap the mic out of the connection for silence, keep
    // the line open, keep the friend's voice flowing.
    if (S.micStream) {
      hotSwapMicTrack(null);
      for (const track of S.micStream.getTracks()) {
        try { track.stop(); } catch (_) {}
      }
      S.micStream = null;
    }
    S.voiceAnnounced = false;
    setMicUi(false);
  }

  // v13: Chrome's adaptive jitter buffer can balloon to seconds after any
  // sender-side hiccup (gate flips, track swaps) and it rarely shrinks back.
  // Clamp the audio receiver to a tight target so the friend's voice stays
  // near-realtime on BOTH sides.
  function clampVoiceJitter(call) {
    try {
      const pc = call && call.peerConnection;
      if (!pc || typeof pc.getReceivers !== "function") return;
      for (const r of pc.getReceivers()) {
        if (r.track && r.track.kind === "audio" && "jitterBufferTarget" in r) {
          try { r.jitterBufferTarget = 60; } catch (_) {}
        }
      }
    } catch (_) {}
  }

  function attachVoiceCall(call) {
    endVoiceCall();
    S.voiceConn = call;
    // v11: if the mic was toggled while this line was still being answered,
    // push the CURRENT desired state into the fresh connection right away so
    // the wire can never disagree with the button.
    try {
      if (S.micEnabled && S.micStream && S.micStream.active) {
        if (!hotSwapMicTrack(S.micStream)) requestVoiceRedial("attach-reconcile");
      } else if (!S.micEnabled) hotSwapMicTrack(null);
    } catch (_) {}
    clampVoiceJitter(call);
    call.on("stream", (remote) => {
      const a = ensureRemoteAudio();
      wireVoiceResume();
      a.srcObject = remote;
      clampVoiceJitter(call);
      try {
        a.play().catch(() => {});
      } catch (_) {}
      // v12: autoplay-blocked? retry on a schedule; every attempt also fires
      // the gesture listeners once the user interacts. If still blocked after
      // ~1.2s, surface the tappable pill instead of a dead toast promise.
      [300, 900, 2500].forEach((ms) => setTimeout(() => { try { resumeRemoteAudio(); } catch (_) {} }, ms));
      setTimeout(() => {
        try { if (a.srcObject && a.paused) showVoicePill(); } catch (_) {}
      }, 1200);
      if (!S.voiceAnnounced) {
        S.voiceAnnounced = true;
        sysMsg("\ud83c\udf99 Voice connected \u2013 say hi!");
      }
    });
    call.on("close", () => {
      if (S.voiceConn === call) S.voiceConn = null;
    });
    call.on("error", () => {
      if (S.voiceConn === call) S.voiceConn = null;
    });
  }

  // The HOST is always the dialer: one MediaConnection carries audio BOTH ways
  // (the callee answers WITH their mic stream). This kills the old race where
  // two sides dialing over each other tore down each other's audio.
  let voiceTimer = null;
  function syncVoice() {
    clearTimeout(voiceTimer);
    voiceTimer = setTimeout(doSyncVoice, 250);
  }
  // v11: mic preference can be restored from storage while no stream exists
  // yet (e.g. party rejoined overnight). Acquire it lazily right before the
  // line opens / gets answered so the friend never gets stuck with silence.
  async function ensureMicIfWanted() {
    if (!S.micEnabled || (S.micStream && S.micStream.active)) return;
    try {
      await getMicStream();
      watchMicStream(S.micStream);
      setMicUi(true);
      if (S.voiceConn && !hotSwapMicTrack(S.micStream)) requestVoiceRedial("ensure-mic");
      if (!!S.nc) startGate();
    } catch (_) {}
  }

  async function doSyncVoice() {
    if (S.role !== "host" || !isOpen()) return;
    const want = S.micEnabled || S.friendVoiceOn;
    if (!want) {
      // nobody wants audio at all -> safe to drop the line
      endVoiceCall();
      return;
    }
    // v11: if the line is already open, NEVER redial. Track attach/detach is
    // handled by hotSwapMicTrack in toggleMic; re-dialing used to tear both
    // directions down on every mic toggle and sometimes left them dead.
    if (S.voiceConn) { await ensureMicIfWanted(); return; }
    await ensureMicIfWanted();
    const stream = getAnswerStream();
    if (!isOpen()) return;
    try { attachVoiceCall(S.peer.call(S.conn.peer, stream)); } catch (_) {}
  }

  function saveMicState(on) {
    try { chrome.storage.local.set({ wt_mic_state: !!on }); } catch (_) {}
  }

  function notifyVoiceState() {
    send({ t: "voice", on: !!S.micEnabled });
  }

  async function toggleMic() {
    if (S.micEnabled) {
      stopMic();
      saveMicState(false);
      notifyVoiceState();
      syncVoice();
      sysMsg("Microphone off");
      return;
    }
    if (S.directMode) {
      sysMsg("\ud83d\udd17 Voice calls need a normal connection \u2013 not available in Direct mode");
      return;
    }
if (!isOpen()) {
      sysMsg("Not connected \u2013 cannot use voice");
      return;
    }
    try {
      await getMicStream();
      watchMicStream(S.micStream);
      S.micEnabled = true;
      setMicUi(true);
      saveMicState(true);
      // v11: if a line is already open (e.g. we answered with the silent
      // track), attach the live mic to it instead of tearing it down.
      if (S.voiceConn && !hotSwapMicTrack(S.micStream)) requestVoiceRedial("toggle-on");
      if (!!S.nc) startGate();
      notifyVoiceState();
      syncVoice();
      sysMsg("Microphone on \ud83c\udf99\ufe0f");
    } catch (_) {
      S.micEnabled = false;
      setMicUi(false);
      sysMsg("Microphone blocked \u2013 check site permissions");
    }
  }

  // ---------- peer lifecycle ----------

  function startParty(party) {
    stopParty();
    S.role = party.role;
    S.roomId = String(party.id || "").toUpperCase();
    S.name = String(party.name || (party.role === "host" ? "Host" : "Guest")).slice(0, 24);
    S.retries = 0;
    S.friendVoiceOn = null;
    S.directMode = false;
    // restore last-session mic choice
    try {
      chrome.storage.local.get("wt_mic_state").then((r) => {
        if (r.wt_mic_state) S.micEnabled = true;
      });
    } catch (_) {}
    ensureUi();
    showUi(true);
    updatePanel();

    try {
      if (party.role === "host") {
        const p = new Peer(PEER_PREFIX + S.roomId, { debug: 0 });
        S.peer = p;
        p.on("open", () => setStatus("waiting", "Waiting for your friend\u2026"));
        p.on("connection", (c) => {
          if (isOpen()) {
            try { c.close(); } catch (_) {}
            return;
          }
          attachConn(c);
        });
        wirePeer(p);
      } else {
        const p = new Peer({ debug: 0 });
        S.peer = p;
        p.on("open", () => connectToHost());
        wirePeer(p);
      }
      setStatus("connecting", "Connecting\u2026");
    } catch (e) {
      setStatus("error", "Could not start party");
    }
  }

  function wirePeer(p) {
    p.on("error", handleErr);
    p.on("call", (call) => {
      // v11: ALWAYS answer with an audio slot (live mic or silent track) so
      // either side can attach their mic later without renegotiation.
      (async () => {
        try {
          await ensureMicIfWanted();
          call.answer(getAnswerStream());
          attachVoiceCall(call);
        } catch (e) {
          // never leave an incoming call unanswered/unattached silently
          try { console.warn("WT: voice answer failed, retrying bare", e); } catch (_) {}
          try { call.answer(getAnswerStream()); attachVoiceCall(call); } catch (e2) {
            try { console.warn("WT: voice answer failed twice", e2); } catch (_) {}
            sysMsg("\u26a0 Voice link glitch \u2013 toggle \ud83c\udfa4 to retry");
          }
        }
      })();
    });
    p.on("disconnected", () => {
      reconnectPeer();
    });
  }

  function connectToHost() {
    if (!S.peer || !S.roomId) return;
    teardownConn();
    const c = S.peer.connect(PEER_PREFIX + S.roomId, { reliable: true });
    attachConn(c);
  }

  function scheduleRetry() {
    if (S.role !== "guest" || S.stopping) return;
    clearTimeout(S.retryTimer);
    // retry forever while the party is active; slow down after the first burst
    const delay = S.retries >= MAX_GUEST_RETRIES ? 8000 : GUEST_RETRY_MS;
    S.retryTimer = setTimeout(() => {
      if (!S.peer || S.stopping) return;
      S.retries++;
      connectToHost();
    }, delay);
  }

  function handleErr(err) {
    const type = err && err.type;
    if (type === "peer-unavailable") {
      S.netErrStreak = 0;
      setStatus("waiting", "Room not found \u2013 waiting for host\u2026");
      scheduleRetry();
    } else if (type === "unavailable-id") {
      setStatus("error", "Room code already in use");
    } else if (type === "network" || type === "server-error" || type === "socket-error" || type === "browser-incompatible") {
      // v10: one calm, stable message while the network is down. The old code
      // alternated between this and "Connection lost – reconnecting…" every few
      // seconds, which looked like the panel was going crazy.
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      S.netErrStreak++;
      setStatus(
        "waiting",
        offline
          ? "Wi-Fi lost \u2013 will reconnect automatically\u2026"
          : (S.netErrStreak >= 4
            ? "Still reconnecting\u2026 (check your internet)"
            : (S.role === "guest" ? "Wi-Fi hiccup \u2013 reconnecting\u2026" : "Network hiccup \u2013 waiting\u2026"))
      );
      scheduleRetry();
    } else {
      return;
    }
  }

  function attachConn(c) {
    detachConn();
    S.conn = c;
    c.on("open", onConnOpen);
    c.on("data", onData);
    c.on("close", onConnClose);
  }

  function detachConn() {
    const c = S.conn;
    if (!c) return;
    try { c.removeAllListeners(); } catch (_) {}
    S.conn = null;
  }

  function teardownConn() {
    const c = S.conn;
    detachConn();
    if (c) {
      try { c.close(); } catch (_) {}
    }
  }

  function onConnOpen() {
    S.retries = 0;
    S.helloStateSent = false;
    S.netErrStreak = 0;
    S.reconnecting = false;
    clearTimeout(S.retryTimer);
    touchRx();
    setStatus("connected", "Playback synced");
    sysMsg(S.role === "host" ? "Your friend connected" : "Connected to your friend");
    if (S.role === "guest") send({ t: "hello", name: S.name, v: EXT_VER });
    else pushState();
    if (S.role === "guest") notifyVoiceState();
    else syncVoice();
    startHb();
  }

  function onConnClose() {
    stopHb();
    endVoiceCall();
    S.friendVoiceOn = null;
    if (S.directMode) { cleanupLinkPC(); }
    S.conn = null;
    S.friendName = null;
    hideTyping();
    if (S.stopping) return;
    if (S.role === "guest") {
      setStatus("waiting", "Connection lost \u2013 reconnecting\u2026");
      scheduleRetry();
    } else {
      setStatus("waiting", "Friend disconnected \u2013 share the code again");
    }
  }

  function stopParty() {
    S.stopping = true;
    clearTimeout(S.retryTimer);
    stopHb();
    S.directMode = false;
    cleanupLinkPC();
    S.friendVoiceOn = null;
    stopMic();
    teardownConn();
    if (S.peer) {
      try { S.peer.destroy(); } catch (_) {}
      S.peer = null;
    }
    unbindVideo();
    S.role = null;
    S.roomId = null;
    S.applyingRemote = false;
    S.stopping = false;
    closeHistory();
    if (ui.msgs) ui.msgs.textContent = "";
    if (ui.root) ui.root.classList.remove("wt-active");
    setStatus("idle", "");
  }

  // ---------- data protocol ----------

  function onData(raw) {
    touchRx();
    let m = raw;
    if (typeof raw === "string") {
      try { m = JSON.parse(raw); } catch (_) { return; }
    }
    if (!m || typeof m !== "object") return;

    switch (m.t) {
      case "hello":
        var hv = m.v ? String(m.v).slice(0, 16) : null;
        if (hv && hv !== S.friendVer) S.friendVer = hv;
        if (!S.verWarned) {
          if (hv && EXT_VER && hv !== EXT_VER) {
            S.verWarned = true;
            sysMsg("\u26a0 Version mismatch \u2013 friend is on v" + hv + ", you are on v" + EXT_VER + ". BOTH install the same latest zip!");
          } else if (!hv) {
            S.verWarned = true;
            sysMsg("\u26a0 Your friend's build is OLDER than v1.9.1 \u2013 both of you install the latest wt zip");
          }
        }
        if (S.role === "host") {
          const who = String(m.name || "").slice(0, 24);
          if (who && who !== S.friendName) {
            S.friendName = who;
            sysMsg(`${who} joined`);
          }
          send({ t: "hello", name: S.name, v: EXT_VER });
          // full state only on the first hello of a connection; later hellos
          // are just name/version refreshers and must not fight playback
          if (!S.helloStateSent) {
            S.helloStateSent = true;
            pushState();
          }
        } else {
          const who2 = String(m.name || "").slice(0, 24);
          if (who2 && who2 !== S.friendName) {
            S.friendName = who2;
          }
        }
        updateConnectedStatus();
        break;
      case "state":
      case "seek":
      case "play":
      case "pause":
      case "rate":
        applyRemote(m);
        break;
      case "hb": {
        const t = num(m.time);
        if (t !== null) {
          // A stalled player keeps broadcasting a frozen timestamp; never let
          // heartbeats rewind the pair - only explicit actions do that.
          const back = t < S.remoteTime - 2 && !m.paused && !!S.remoteAt;
          if (!back) {
            S.remoteTime = t;
            S.remotePaused = !!m.paused;
            S.remoteAt = Date.now();
            if (typeof m.r === "number") S.remoteRate = Math.min(4, Math.max(0.25, m.r));
          } else {
            // frozen heartbeat while claiming to play: ignore it completely
            S.remotePaused = false;
          }
          driftCheck();
        }
        break;
      }
      case "ping":
        send({ t: "pong" });
        break;
      case "pong":
        break;
      case "chat": {
        const text = String(m.text == null ? "" : m.text).slice(0, 300);
        if (!text) return;
        const from = String(m.from || "Friend").slice(0, 24);
        hideTyping();
        addMsg(from, text, false);
        break;
      }
      case "react": {
        const e = String(m.e || "").slice(0, 8);
        const who = String(m.from || "Friend").slice(0, 24);
        if (e) {
          floatReaction(e, who);
          sysMsg(`${who} reacted ${e}`);
        }
        break;
      }
      case "typing": {
        const who = String(m.from || "Friend").slice(0, 24);
        showTyping(who);
        break;
      }
      case "voice": {
        const was = !!S.friendVoiceOn;
        S.friendVoiceOn = !!m.on;
        if (S.role === "host") syncVoice();
        if (S.friendVoiceOn !== was) toast(S.friendVoiceOn ? ("\ud83c\udf99 " + (S.friendName || "Friend") + "'s mic is ON") : ((S.friendName || "Friend") + "'s mic is OFF"));
        if (S.friendVoiceOn) {
          clearTimeout(S.voiceCheckTimer);
          S.voiceCheckTimer = setTimeout(() => {
            if (!S.friendVoiceOn || !isOpen()) return;
            const a = ui.root && ui.root.querySelector("#wt-remote-audio");
            if (!a || !a.srcObject) sysMsg("\u26a0 No audio arriving \u2013 allow mic / update BOTH extensions");
          }, 6000);
        } else {
          clearTimeout(S.voiceCheckTimer);
        }
        break;
      }
      case "vrr": {
        // v12: guest could not attach their mic to the live line - rebuild it
        // once (guard inside requestVoiceRedial prevents storms).
        if (S.role === "host") requestVoiceRedial("friend-request");
        break;
      }
      case "needstate":
        pushState();
        break;
    }
  }

  // ---------- emoji data ----------

  const EMOJI = [
    ["😀","grinning face happy smile"],
    ["😃","smiley happy laugh joy"],
    ["😄","smile happy laugh joy"],
    ["😁","beaming grin smile"],
    ["😆","laughing lol haha xd"],
    ["😅","sweat laugh nervous"],
    ["🤣","rofl rolling laughing lol"],
    ["😂","joy tears laughing lol cry"],
    ["🙂","slight smile happy"],
    ["🙃","upside down silly"],
    ["😉","wink flirt"],
    ["😊","blush happy shy smile"],
    ["😇","angel innocent halo"],
    ["🥰","love hearts adore"],
    ["😍","heart eyes love crush"],
    ["🤩","star struck wow amazing"],
    ["😘","kiss love blow"],
    ["😗","kissing"],
    ["😚","kissing closed eyes"],
    ["😙","kissing smiling"],
    ["🥲","tear smile sad happy"],
    ["😋","yum tasty delicious tongue"],
    ["😛","tongue playful"],
    ["😜","wink tongue crazy silly"],
    ["🤪","zany crazy goofy wild"],
    ["😝","squint tongue yuck"],
    ["🤑","money mouth rich greedy"],
    ["🤗","hug warm embrace"],
    ["🤭","giggle oops hand over mouth"],
    ["🫢","gasp surprise hand mouth"],
    ["🤫","shush quiet secret"],
    ["🤔","think hmm consider"],
    ["🫡","salute respect yes sir"],
    ["🤐","zipper mouth silent"],
    ["🤨","raised eyebrow suspicious really"],
    ["😐","neutral blank meh"],
    ["😑","expressionless blank deadpan"],
    ["😶","no mouth speechless silent"],
    ["🫥","dotted invisible hidden lonely"],
    ["😏","smirk smug sly"],
    ["😒","unamused annoyed meh ugh"],
    ["🙄","eye roll whatever ugh"],
    ["😬","grimace awkward yikes"],
    ["🤥","lying pinocchio liar nose"],
    ["😌","relieved calm phew"],
    ["😔","pensive sad down disappointed"],
    ["😪","sleepy tired drowsy"],
    ["🤤","drooling hungry desire"],
    ["😴","sleeping zzz asleep"],
    ["😷","mask sick covid"],
    ["🤒","thermometer sick fever"],
    ["🤕","bandage hurt injured"],
    ["🤢","nauseated sick gross green"],
    ["🤮","vomit puke sick"],
    ["🤧","sneeze sick cold"],
    ["🥵","hot heat sweating summer"],
    ["🥶","cold freezing winter ice"],
    ["🥴","woozy dizzy drunk tipsy"],
    ["😵","dizzy dead knockout"],
    ["🤯","mind blown explosion shock"],
    ["🤠","cowboy hat western"],
    ["🥳","party celebrate birthday"],
    ["🥸","disguise incognito spy"],
    ["😎","cool sunglasses chill"],
    ["🤓","nerd glasses geek"],
    ["🧐","monocle inspect fancy"],
    ["😕","confused unsure meh"],
    ["🫤","diagonal mouth confused meh"],
    ["😟","worried concerned"],
    ["🙁","frown slight sad"],
    ["😮","open mouth wow surprise oh"],
    ["😯","hushed surprised quiet"],
    ["😲","astonished shocked wow"],
    ["🥺","pleading puppy eyes please"],
    ["😦","frowning frown"],
    ["😧","anguished worried"],
    ["😨","fearful scared afraid"],
    ["😰","anxious sweat nervous scared"],
    ["😥","sad relieved downcast"],
    ["😢","cry crying sad tear"],
    ["😭","sob bawling crying loud tears"],
    ["😱","scream fear shocked horror"],
    ["😖","confounded frustrated ugh"],
    ["😣","persevere struggling effort"],
    ["😞","disappointed sad letdown"],
    ["😓","downcast sweat stressed"],
    ["😩","weary exhausted tired done"],
    ["😫","tired yawning exhausted"],
    ["🥱","yawn bored sleepy"],
    ["😤","triumph steam mad determined huff"],
    ["😡","rage angry mad furious red"],
    ["😠","angry mad upset"],
    ["🤬","cursing swear symbols angry"],
    ["😈","devil evil smirk purple"],
    ["👿","imp devil angry"],
    ["💀","skull dead dying lol"],
    ["☠️","skull crossbones danger poison dead"],
    ["💩","poop crap funny"],
    ["🤡","clown circus creepy"],
    ["👹","ogre demon red monster"],
    ["👺","goblin tengu monster"],
    ["👻","ghost boo halloween spooky"],
    ["👽","alien ufo outer space"],
    ["🤖","robot ai bot"],
    ["😺","cat smile happy"],
    ["😹","cat joy laughing lol"],
    ["😻","cat heart eyes love"],
    ["😼","cat smirk smug"],
    ["🙈","see no evil monkey hide shy"],
    ["🙉","hear no evil monkey"],
    ["🙊","speak no evil monkey oops secret"],
    ["💋","lipstick kiss lips makeup"],
    ["💌","love letter heart mail"],
    ["💘","heart arrow cupid love"],
    ["💝","heart gift ribbon love"],
    ["💖","sparkling heart love sparkle"],
    ["💗","growing heart love pulse"],
    ["💓","beating heart love pulse"],
    ["💞","revolving hearts love"],
    ["💕","two hearts love"],
    ["💟","heart decoration purple"],
    ["❣️","heart exclamation love"],
    ["💔","broken heart heartbreak sad breakup"],
    ["❤️‍🔥","heart on fire burning love passion"],
    ["❤️‍🩹","mending heart heal recovery"],
    ["❤️","red heart love"],
    ["🩷","pink heart love"],
    ["🧡","orange heart love"],
    ["💛","yellow heart love"],
    ["💚","green heart love"],
    ["💙","blue heart love"],
    ["🩵","light blue heart love"],
    ["💜","purple heart love"],
    ["🤎","brown heart love"],
    ["🖤","black heart dark love"],
    ["🩶","grey heart love"],
    ["🤍","white heart pure love"],
    ["💯","hundred perfect score legit"],
    ["💢","anger symbol frustration vein"],
    ["💥","collision boom explosion burst"],
    ["💫","dizzy stars sparkle woozy"],
    ["💦","sweat droplets splash water"],
    ["💨","dash wind fast gone puff"],
    ["💬","speech bubble comment talk chat"],
    ["👀","eyes look watch peep"],
    ["👁️","eye look see watch"],
    ["🧠","brain smart mind think"],
    ["👋","wave hi hello bye hand"],
    ["🤚","raised back hand stop"],
    ["🖐️","hand fingers spread five"],
    ["✋","raised hand stop high five"],
    ["🖖","spock vulcan star trek"],
    ["👌","ok perfect nice chef kiss"],
    ["🤌","pinched fingers italian what"],
    ["🤏","pinching small tiny bit"],
    ["✌️","peace victory two deuce"],
    ["🤞","crossed fingers luck hope"],
    ["🫰","finger heart snap love korean"],
    ["🤟","love you sign rock"],
    ["🤘","rock on metal horns"],
    ["🤙","call me shaka hang loose"],
    ["👈","point left"],
    ["👉","point right this"],
    ["👆","point up there"],
    ["👇","point down below"],
    ["☝️","index finger up one point"],
    ["🫵","point at you accuse"],
    ["👍","thumbs up like good yes approve"],
    ["👎","thumbs down dislike bad no"],
    ["✊","fist power bump solidarity"],
    ["👊","punch fist bump bro"],
    ["🤛","left fist punch"],
    ["🤜","right fist punch"],
    ["👏","clap applause bravo well done"],
    ["🙌","raising hands praise hooray celebrate"],
    ["🫶","heart hands love appreciate"],
    ["👐","open hands hug"],
    ["🤲","palms up prayer give"],
    ["🤝","handshake deal agreement hello"],
    ["🙏","pray thanks please namaste gratitude"],
    ["✍️","writing hand note signing"],
    ["💅","nail polish manicure sass beauty"],
    ["🤳","selfie phone camera"],
    ["💪","flex muscle strong gym biceps"],
    ["🦾","mechanical arm prosthetic strong"],
    ["👶","baby infant newborn"],
    ["🧒","child kid young"],
    ["👦","boy kid son"],
    ["👧","girl kid daughter"],
    ["👨","man guy male"],
    ["👩","woman girl female"],
    ["🧓","older person grandparent"],
    ["🕵️","detective spy sleuth investigate"],
    ["💃","dancing woman dance salsa party"],
    ["🕺","dancing man disco party"],
    ["🧘","meditate yoga zen lotus calm"],
    ["🛀","bath tub relax shower"],
    ["🛌","sleep bed night rest"],
    ["👑","crown king queen royal win"],
    ["🎩","top hat fancy gentleman magic"],
    ["🎓","graduation cap college degree school"],
    ["🧢","cap baseball hat"],
    ["🐶","dog puppy pet doggo"],
    ["🐱","cat kitty kitten pet meow"],
    ["🐭","mouse mice rat"],
    ["🐹","hamster pet cute"],
    ["🐰","rabbit bunny hare easter"],
    ["🦊","fox sly"],
    ["🐻","bear grizzly"],
    ["🐼","panda cute china"],
    ["🐨","koala australia cute"],
    ["🐯","tiger bengal roar"],
    ["🦁","lion king mane brave"],
    ["🐮","cow ox moo"],
    ["🐷","pig oink pork"],
    ["🐸","frog toad pepe ribbit"],
    ["🐵","monkey face ape"],
    ["🦍","gorilla ape strong"],
    ["🐔","chicken hen poultry"],
    ["🐧","penguin antarctica cute"],
    ["🐦","bird tweet fly"],
    ["🐤","baby chick yellow cute"],
    ["🦆","duck quack"],
    ["🦅","eagle bird freedom"],
    ["🦉","owl wise night"],
    ["🦇","bat vampire night"],
    ["🐺","wolf howl wild"],
    ["🐗","boar pig wild"],
    ["🐴","horse pony ride"],
    ["🦄","unicorn magical rainbow fantasy"],
    ["🐝","bee honey buzz busy"],
    ["🐛","bug caterpillar worm"],
    ["🦋","butterfly pretty transformation"],
    ["🐌","snail slow"],
    ["🐞","ladybug luck insect"],
    ["🐜","ant insect work"],
    ["🕷️","spider web halloween creepy"],
    ["🦂","scorpion sting desert"],
    ["🐢","turtle tortoise slow shell"],
    ["🐍","snake python hiss sneaky"],
    ["🦖","t-rex dinosaur jurassic rawr"],
    ["🐙","octopus tentacles sea smart"],
    ["🦑","squid sea tentacles"],
    ["🦐","shrimp seafood prawn"],
    ["🐠","tropical fish sea reef"],
    ["🐟","fish sea swim"],
    ["🐬","dolphin sea smart jump"],
    ["🐳","whale sea big spout"],
    ["🦈","shark jaws sea danger"],
    ["🍕","pizza slice italy food"],
    ["🍔","burger hamburger fast food"],
    ["🌮","taco mexican food"],
    ["🌯","burrito wrap mexican"],
    ["🥙","pita wrap food"],
    ["🍜","ramen noodles soup japanese"],
    ["🍝","spaghetti pasta italian noodles"],
    ["🍣","sushi japanese raw fish"],
    ["🍱","bento box japanese lunch"],
    ["🍛","curry rice indian spicy"],
    ["🍚","rice bowl asian"],
    ["🍥","fish cake naruto swirl"],
    ["🥟","dumpling momo gyoza"],
    ["🍦","ice cream cone sweet dessert"],
    ["🍩","doughnut donut sweet dessert"],
    ["🍪","cookie biscuit sweet crumbs"],
    ["🎂","birthday cake celebrate party"],
    ["🍰","cake shortcake dessert slice"],
    ["🍫","chocolate bar sweet candy"],
    ["🍬","candy sweet sugar"],
    ["🍭","lollipop swirl candy sweet"],
    ["🍯","honey pot sweet bee"],
    ["🍿","popcorn movie cinema snack"],
    ["☕","coffee tea hot drink morning"],
    ["🍵","tea green matcha cup"],
    ["🧋","boba bubble tea milk tea"],
    ["🥤","soda cup drink straw cold"],
    ["🍺","beer drink pub cheers alcohol"],
    ["🍻","cheers beers drinks friends"],
    ["🥂","champagne cheers celebration clink"],
    ["🍷","wine glass red alcohol classy"],
    ["🍹","tropical cocktail drink vacation rum"],
    ["⚽","soccer football goal sport"],
    ["🏀","basketball hoop sport dunk"],
    ["🏈","american football sport"],
    ["⚾","baseball sport bat"],
    ["🎾","tennis sport racket"],
    ["🏐","volleyball sport"],
    ["🎱","pool billiards 8ball cue"],
    ["🏓","ping pong table tennis"],
    ["🏸","badminton shuttle sport"],
    ["🥊","boxing glove fight punch"],
    ["🎮","video game controller gaming pad"],
    ["🕹️","joystick arcade retro game"],
    ["🎲","dice random luck board game"],
    ["♟️","chess pawn strategy game"],
    ["🎯","dart bullseye target aim on point"],
    ["🎳","bowling strike pins"],
    ["🎤","microphone sing karaoke mic"],
    ["🎧","headphones music audio listen"],
    ["🎸","guitar rock music instrument"],
    ["🎹","piano keys music instrument"],
    ["🥁","drums beat rhythm music"],
    ["🎬","clapper movie film action cinema"],
    ["🎨","art paint palette creative artist"],
    ["🏆","trophy win champion first prize"],
    ["🥇","gold medal first place win champion"],
    ["🥈","silver medal second place"],
    ["🥉","bronze medal third place"],
    ["🚗","car drive automobile red"],
    ["🚕","taxi cab ride yellow"],
    ["🚌","bus transport public"],
    ["🏎️","race car fast f1 speed"],
    ["🚓","police car siren cop"],
    ["🚑","ambulance emergency medical"],
    ["🚒","fire truck engine emergency"],
    ["🚚","truck delivery lorry"],
    ["🚜","tractor farm agriculture"],
    ["🛵","scooter vespa delivery ride"],
    ["🏍️","motorcycle bike rider speed"],
    ["🚲","bicycle cycle pedal ride"],
    ["✈️","airplane flight travel plane fly"],
    ["🚀","rocket launch fast space ship lol"],
    ["🛸","ufo flying saucer alien"],
    ["🚁","helicopter chopper fly"],
    ["⛵","sailboat sea yacht sail"],
    ["🚢","ship cruise boat big"],
    ["⚓","anchor ship boat sea stable"],
    ["🔥","fire lit hot flame trending"],
    ["⭐","star favorite favorite"],
    ["🌟","glowing star shiny special"],
    ["✨","sparkles shiny magic pretty clean"],
    ["🌈","rainbow lgbt colorful pride"],
    ["☀️","sun sunny hot day bright"],
    ["🌤️","sun behind cloud partly"],
    ["☁️","cloud cloudy grey overcast"],
    ["🌧️","rain raining wet drizzle"],
    ["⛈️","thunderstorm lightning storm"],
    ["❄️","snow snowflake cold winter ice"],
    ["⛄","snowman winter christmas"],
    ["🌊","wave ocean sea water surf"],
    ["🌙","moon night crescent sleep"],
    ["🪐","planet saturn space ring"],
    ["🌍","earth world globe global"],
    ["🧨","firecracker dynamite explosive new year"],
    ["🎆","fireworks celebration new year show"],
    ["🎇","sparkler firework night celebration"],
    ["🎁","gift present birthday surprise wrapped"],
    ["🎈","balloon party birthday float celebrate"],
    ["🎉","party popper celebrate congrats yay tada"],
    ["🎊","confetti celebration party done finish"],
    ["🪄","magic wand transform sparkle"],
    ["🔔","bell notification ring alert"],
    ["🔕","mute bell silent notification off"],
    ["🎵","music note tune song melody"],
    ["🎶","music notes melody song vibes"],
    ["💰","money bag cash rich bag"],
    ["💵","dollar money cash bill"],
    ["💳","credit card pay checkout"],
    ["💎","gem diamond precious fancy valuable"],
    ["⏰","alarm clock wake up morning time"],
    ["⏳","hourglass time waiting sand soon"],
    ["📌","pin important mark note"],
    ["📎","paperclip attach clip"],
    ["🔒","lock locked secure private"],
    ["🔓","unlock open unlocked"],
    ["🔑","key unlock access secret"],
    ["🛡️","shield protect safe defense guard"],
    ["⚔️","swords fight battle duel versus"],
    ["🧿","nazar amulet evil eye protection charm"],
    ["☯️","yin yang balance zen tao"],
    ["☮️","peace sign hippie calm"],
    ["✅","check mark done yes complete ok"],
    ["❌","cross no wrong fail cancel x"],
    ["❓","question mark confused ask unknown"],
    ["❗","exclamation important alert warning"],
    ["⚠️","warning caution careful alert"],
    ["🚫","prohibited no banned forbidden stop"],
    ["♻️","recycle eco green reuse"],
    ["🆗","ok button fine alright"],
    ["🆕","new fresh recent"],
    ["🔝","top up arrow best"],
    ["🔴","red circle dot live recording"],
    ["🟢","green circle dot go online"],
    ["🟡","yellow circle dot pending"],
    ["🇮🇳","flag india indian tiranga"],
    ["🇺🇸","flag usa america united states"],
    ["🇬🇧","flag uk britain united kingdom"],
    ["🇨🇦","flag canada maple"],
    ["🇦🇺","flag australia aussie"],
    ["🇯🇵","flag japan japanese rising sun"],
    ["🇰🇷","flag korea korean"],
    ["🇩🇪","flag germany german"],
    ["🇫🇷","flag france french"],
    ["🇧🇷","flag brazil brazilian"],
    ["🇦🇪","flag uae dubai emirates"],
    ["🇸🇬","flag singapore"],
    ["🇲🇽","flag mexico mexican"],
    ["🇵🇰","flag pakistan"],
    ["🇳🇵","flag nepal"],
    ["🇱🇰","flag sri lanka"],
    ["🏁","checkered flag race finish start"],
    ["🚩","red flag triangular warning mark"]
  ];

  // ---------- overlay ui ----------

  function ensureUi() {
    if (ui.root) return;
    ui.root = document.createElement("div");
    ui.root.id = "wt-root";
    ui.root.innerHTML =
      '<div id="wt-pill">' +
      '<span class="wt-dot"></span><span>Watch Together</span>' +
      "</div>" +
      '<div id="wt-panel">' +
      '<div class="wt-head">' +
      '<span class="wt-drag-handle" title="Drag to move">\u22EE</span>' +
      '<span class="wt-title">Watch Together</span><span id="wt-ver">v' + EXT_VER + '</span>' +
      '<button id="wt-glass-btn" type="button" title="Liquid glass theme">✨</button>' +
      '<button id="wt-nc-btn" type="button" title="Noise cancellation">\ud83c\udfa7</button>' +
      '<button id="wt-hist-btn" type="button" title="Watch history">\ud83d\udd52</button>' +
      '<button id="wt-code" title="Copy code">\u2013\u2013\u2013\u2013\u2013\u2013</button>' +
      '<button id="wt-close" title="Hide">\u00d7</button>' +
      "</div>" +
      '<div id="wt-now" class="wt-now"></div>' +
      '<div class="wt-statusline"><span class="wt-dot"></span><span id="wt-status-text">Idle</span>' +
      '<span id="wt-voice-wrap" title="Friend\'s voice volume">\ud83d\udd0a<input id="wt-voice-vol" type="range" min="0" max="100" value="100" /></span></div>' +
      '<div id="wt-linkbar"><button id="wt-link-btn" type="button">\ud83d\udd17 Direct connect</button>' +
      '<span id="wt-link-hint">join without being blocked by ad blockers</span></div>' +
            '<div id="wt-linkbox" class="wt-hide"></div>' +
      '<div id="wt-msgs"></div>' +
      '<div id="wt-typing"></div>' +
      '<div id="wt-hist" class="wt-hide">' +
      '<div id="wt-hist-head"><span>Watch history</span>' +
      '<button id="wt-hist-back" type="button" title="Back to chat">\u2039 Back</button></div>' +
      '<div id="wt-hist-list"></div>' +
      "</div>" +
      '<div id="wt-react-bar">' +
      '<button class="wt-react" type="button" data-e="\ud83d\ude02">\ud83d\ude02</button>' +
      '<button class="wt-react" type="button" data-e="\u2764\ufe0f">\u2764\ufe0f</button>' +
      '<button class="wt-react" type="button" data-e="\ud83d\ude2e">\ud83d\ude2e</button>' +
      '<button class="wt-react" type="button" data-e="\ud83d\ude22">\ud83d\ude22</button>' +
      '<button class="wt-react" type="button" data-e="\ud83d\udd25">\ud83d\udd25</button>' +
      '<button class="wt-react" type="button" data-e="\ud83d\udc4d">\ud83d\udc4d</button>' +
      '<button id="wt-react-more" type="button" title="All emojis">+</button>' +
      "</div>" +
      '<div id="wt-picker" class="wt-hide">' +
      '<div id="wt-picker-head">' +
      '<input id="wt-emoji-search" maxlength="40" placeholder="Search emojis\ud83d\udd0d" autocomplete="off" />' +
      '<button id="wt-picker-close" type="button" title="Close">\u00d7</button>' +
      "</div>" +
      '<div id="wt-emoji-grid"></div>' +
      "</div>" +
      '<form id="wt-form">' +
      '<button id="wt-mic" type="button" title="Toggle voice chat">\ud83c\udfa4</button>' +
      '<input id="wt-input" maxlength="300" placeholder="Say hi\u2026" autocomplete="off" />' +
      '<button id="wt-send" type="submit">Send</button>' +
      "</form>" +
      "</div>" +
      '<div id="wt-toasts"></div>' +
      '<div id="wt-quick" class="wt-quick">' +
      '<div id="wt-now-label" class="wt-quick-title"></div>' +
      '<div id="wt-quick-bar"></div>' +
      "</div>";
    document.documentElement.appendChild(ui.root);

    ui.pill = ui.root.querySelector("#wt-pill");
    ui.panel = ui.root.querySelector("#wt-panel");
    ui.msgs = ui.root.querySelector("#wt-msgs");
    ui.input = ui.root.querySelector("#wt-input");
    ui.toasts = ui.root.querySelector("#wt-toasts");
    ui.typing = ui.root.querySelector("#wt-typing");
    ui.volSlider = ui.root.querySelector("#wt-voice-vol");

    ui.input.addEventListener("input", sendTyping);

    ui.volSlider.addEventListener("input", () => {
      applyVoiceVol(ui.volSlider.value / 100, true);
    });
    ui.codeBtn = ui.root.querySelector("#wt-code");
    ui.micBtn = ui.root.querySelector("#wt-mic");
    ui.picker = ui.root.querySelector("#wt-picker");
    ui.search = ui.root.querySelector("#wt-emoji-search");
    ui.grid = ui.root.querySelector("#wt-emoji-grid");
    ui.quickPanel = ui.root.querySelector("#wt-quick");
    ui.quickBar = ui.root.querySelector("#wt-quick-bar");
    ui.quickTitle = ui.root.querySelector("#wt-now-label");
    ui.quickPanel.addEventListener("mouseenter", () => bumpQuickActivity());
    ui.glassBtn = ui.root.querySelector("#wt-glass-btn");
    ui.glassBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleGlass();
    });
    ui.ncBtn = ui.root.querySelector("#wt-nc-btn");
    ui.ncBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNoiseCancel();
    });
    applyNcUi();
    const histBtn = ui.root.querySelector("#wt-hist-btn");
    histBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openHistory();
    });
    ui.root.querySelector("#wt-hist-back").addEventListener("click", (e) => {
      e.stopPropagation();
      closeHistory();
    });
    ui.linkBar = ui.root.querySelector("#wt-linkbar");
    ui.linkBox = ui.root.querySelector("#wt-linkbox");
    ui.root.querySelector("#wt-link-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openLinkBox();
    });

    for (const b of ui.root.querySelectorAll(".wt-react")) {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        sendReact(b.dataset.e);
      });
    }

    ui.root.querySelector("#wt-react-more").addEventListener("click", (e) => {
      e.stopPropagation();
      if (ui.picker.classList.contains("wt-hide")) openPicker();
      else closePicker();
    });

    ui.root.querySelector("#wt-picker-close").addEventListener("click", (e) => {
      e.stopPropagation();
      closePicker();
    });

    ui.search.addEventListener("input", () => buildEmojiGrid(ui.search.value));

    ui.micBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMic();
    });

    ui.pill.addEventListener("click", () => {
      if (ui.root.classList.contains("wt-open")) closePanelAnimated();
      else { ui.root.classList.add("wt-open"); bumpQuickActivity(); }
    });
    ui.root.querySelector("#wt-close").addEventListener("click", (e) => {
      e.stopPropagation();
      closePanelAnimated();
    });

    ui.codeBtn.addEventListener("click", () => {
      if (!S.roomId) return;
      navigator.clipboard.writeText(S.roomId).then(() => toast("Code copied"));
    });

    ui.root.querySelector("#wt-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const text = ui.input.value.trim();
      if (!text) return;
      ui.input.value = "";
      sendChatText(text);
    });

    const nowEl = ui.root.querySelector("#wt-now");
    if (nowEl) nowEl.addEventListener("click", (e) => {
      e.stopPropagation();
      shareNowPlaying();
    });

    for (const el of [ui.input, ui.panel, ui.search]) {
      el.addEventListener("keydown", (e) => e.stopPropagation());
      el.addEventListener("keyup", (e) => e.stopPropagation());
    }
  
    makeDraggable(ui.root.querySelector(".wt-drag-handle"), ui.root, "wt_pos_root");
    makeDraggable(ui.quickTitle, ui.quickPanel, "wt_pos_quick");
    makeDraggable(ui.quickBar, ui.quickPanel, "wt_pos_quick");
  }

  function makeDraggable(dragHandle, target, posKey) {
    if (!dragHandle || !target) return;
    let dragging = false;
    let offsetX = 0, offsetY = 0;
    let tw = 300, th = 60;
    let lastX = null, lastY = null, moved = false;

    const isInteractive = (e) => {
      const t = e.target;
      if (!t) return false;
      const tag = t.tag || t.tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return true;
      const cls = t.classList;
      return !!(cls && cls.contains && (cls.contains("wt-input") ||
        cls.contains("wt-emoji-search") || cls.contains("wt-emoji") ||
        cls.contains("wt-react") || cls.contains("wt-quick-emoji")));
    };
    const vw = () => (typeof window !== "undefined" && window.innerWidth) || 1920;
    const vh = () => (typeof window !== "undefined" && window.innerHeight) || 1080;

    dragHandle.addEventListener("mousedown", (e) => {
      if (isInteractive(e)) return;
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true; moved = false;
      try {
        const r = target.getBoundingClientRect();
        tw = r.width || tw;
        th = r.height || th;
        offsetX = e.clientX - (r.left || 0);
        offsetY = e.clientY - (r.top || 0);
      } catch (_) {}
      if (e.preventDefault) e.preventDefault();
      try { document.body.style.userSelect = "none"; } catch (_) {}
    });

    const onMove = (e) => {
      if (!dragging) return;
      let nx = Math.max(0, Math.min(e.clientX - offsetX, vw() - tw));
      let ny = Math.max(0, Math.min(e.clientY - offsetY, vh() - th));
      moved = true; lastX = nx; lastY = ny;
      target.style.position = "fixed";
      target.style.left = nx + "px";
      target.style.top = ny + "px";
      target.style.right = "auto";
      target.style.bottom = "auto";
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      try { document.body.style.userSelect = ""; } catch (_) {}
      if (moved && posKey && lastX !== null) {
        const o = { x: lastX, y: lastY };
        try { chrome.storage.local.set({ [posKey]: o }); } catch (_) {}
        bumpQuickActivity();
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function applySavedPos(el, saved) {
    if (!el || !saved || typeof saved.x !== "number") return;
    el.style.position = "fixed";
    el.style.left = saved.x + "px";
    el.style.top = saved.y + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
  }

  function toggleGlass() {
    S.glass = !S.glass;
    try { chrome.storage.local.set({ wt_glass: !!S.glass }); } catch (_) {}
    applyGlass();
    bumpQuickActivity();
  }

  function applyGlass() {
    if (!ui.root) return;
    ui.root.classList.toggle("wt-glass", !!S.glass);
    if (ui.glassBtn) ui.glassBtn.classList.toggle("wt-on", !!S.glass);
    ui.root.querySelectorAll(".wt-quick-glass").forEach((b) => b.classList.toggle("wt-on", !!S.glass));
  }


    function updatePanel() {
    if (ui.codeBtn) ui.codeBtn.textContent = S.roomId || "\u2013\u2013\u2013\u2013\u2013\u2013";
  }

  function setMicUi(on) {
    if (!ui.root) return;
    const b = ui.root.querySelector("#wt-mic");
    if (b) {
      b.classList.toggle("wt-mic-on", !!on);
      b.title = on ? "Voice chat on \u2013 click to turn off" : "Toggle voice chat";
    }
  }

  function renderStatus() {
    if (!ui.root) return;
    const dot = ui.root.querySelector(".wt-dot");
    const txt = ui.root.querySelector("#wt-status-text");
    if (txt) txt.textContent = lastStatus.detail || lastStatus.state;
    if (dot) {
      dot.dataset.s = lastStatus.state;
    }
  
    if (ui.linkBar && ui.linkBox) {
      const showBar = !!S.roomId && !isOpen() && ui.linkBox.classList.contains("wt-hide");
      ui.linkBar.classList.toggle("wt-show", showBar);
    }
  }

  function updateConnectedStatus() {
    if (lastStatus.state === "connected" && S.friendName) {
      setStatus("connected", `Synced with ${S.friendName}`);
    }
  }

  const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

  function appendRichText(parent, text) {
    const str = String(text);
    let last = 0;
    let m;
    const re = new RegExp(URL_RE.source, "g");
    while ((m = re.exec(str)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(str.slice(last, m.index)));
      const a = document.createElement("a");
      a.href = m[1];
      a.textContent = m[1];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "wt-link";
      parent.appendChild(a);
      last = m.index + m[1].length;
    }
    if (last < str.length) parent.appendChild(document.createTextNode(str.slice(last)));
  }

  function sendChatText(text) {
    if (!isOpen()) {
      sysMsg("Not connected \u2013 cannot chat");
      return false;
    }
    send({ t: "chat", from: S.name, text });
    addMsg(S.name, text, true);
    return true;
  }

  function addMsg(from, text, self) {
    if (!ui.msgs) return;
    const row = document.createElement("div");
    row.className = "wt-msg" + (self ? " wt-me" : "");
    const b = document.createElement("b");
    b.textContent = from + ": ";
    row.appendChild(b);
    appendRichText(row, text);
    ui.msgs.appendChild(row);
    trimMsgs();
    // popup preview when panel is hidden
    if (!self && ui.root && !ui.root.classList.contains("wt-open")) {
      toast("\ud83d\udcac " + from + ": " + String(text).slice(0, 60));
    }
  }

  function sysMsg(text) {
    if (!ui.msgs) return;
    const row = document.createElement("div");
    row.className = "wt-sys";
    row.textContent = text;
    ui.msgs.appendChild(row);
    trimMsgs();
  }

  function trimMsgs() {
    while (ui.msgs.childElementCount > 150) ui.msgs.firstElementChild.remove();
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
  }

  // ---------- emoji reactions ----------

  function floatReaction(emoji, from) {
    const host = document.fullscreenElement || document.documentElement;
    if (!host || !emoji) return;
    const el = document.createElement("div");
    el.className = "wt-float";
    el.textContent = emoji;
    if (from) {
      const nameEl = document.createElement("span");
      nameEl.className = "wt-float-name";
      nameEl.textContent = String(from).slice(0, 24);
      el.appendChild(nameEl);
    }
    el.style.left = 8 + Math.random() * 70 + "vw";
    el.style.fontSize = 26 + Math.random() * 22 + "px";
    el.style.animationDuration = 2.8 + Math.random() * 1.6 + "s";
    el.style.setProperty("--wt-sway", Math.round(Math.random() * 120 - 60) + "px");
    host.appendChild(el);
    setTimeout(() => {
      try { el.remove(); } catch (_) {}
    }, 5200);
  }

  function sendReact(emoji) {
    if (!emoji) return;
    send({ t: "react", e: emoji, from: S.name });
    floatReaction(emoji);
    trackReactUsage(emoji);
    buildQuickBar();
    sysMsg(`You reacted ${emoji}`);
  }

  function buildEmojiGrid(filter) {
    if (!ui.grid) return;
    ui.grid.textContent = "";
    const q = String(filter || "").trim().toLowerCase();
    let count = 0;
    for (const pair of EMOJI) {
      const [e, kw] = pair;
      if (q && kw.indexOf(q) === -1 && !e.includes(q)) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "wt-emoji";
      b.textContent = e;
      b.title = kw;
      b.addEventListener("click", () => {
        sendReact(e);
        closePicker();
      });
      ui.grid.appendChild(b);
      count++;
    }
    if (!count) {
      const d = document.createElement("div");
      d.className = "wt-sys";
      d.textContent = "No matching emoji";
      ui.grid.appendChild(d);
    }
  }

  function openPicker() {
    ui.picker.classList.remove("wt-hide");
    ui.search.value = "";
    buildEmojiGrid("");
    setTimeout(() => {
      try { ui.search.focus(); } catch (_) {}
    }, 0);
  }

  function closePicker() {
    ui.picker.classList.add("wt-hide");
  }

  function trackReactUsage(emoji) {
    S.reactFreq[emoji] = (S.reactFreq[emoji] || 0) + 1;
    S.reactRecent = S.reactRecent.filter((e) => e !== emoji);
    S.reactRecent.unshift(emoji);
    S.reactRecent = S.reactRecent.slice(0, 3);
    try {
      chrome.storage.local.set({ wt_react_freq: S.reactFreq, wt_react_recent: S.reactRecent });
    } catch (_) {}
  }

  function computeQuickBar() {
    const freq = Object.entries(S.reactFreq).sort((a, b) => b[1] - a[1]).map(([e]) => e);
    const set = new Set();
    const top3 = [];
    for (const e of freq) {
      if (top3.length < 3 && !set.has(e)) { top3.push(e); set.add(e); }
    }
    let i = 0;
    while (top3.length < 3 && i < EMOJI.length) {
      const e = EMOJI[i][0];
      if (!set.has(e)) { top3.push(e); set.add(e); }
      i++;
    }
    const recent = [];
    for (const r of S.reactRecent) {
      if (recent.length < 3 && !set.has(r)) { recent.push(r); set.add(r); }
    }
    while (recent.length < 3 && i < EMOJI.length) {
      const e = EMOJI[i][0];
      if (!set.has(e)) { recent.push(e); set.add(e); }
      i++;
    }
    return { top3, recent };
  }

  function buildQuickBar() {
    if (!ui.quickBar) return;
    const { top3, recent } = computeQuickBar();
    ui.quickBar.textContent = "";
    const mk = (e) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "wt-quick-emoji";
      b.textContent = e;
      b.title = "React";
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        sendReact(e);
      });
      ui.quickBar.appendChild(b);
    };
    top3.forEach(mk);
    const sep = document.createElement("div");
    sep.className = "wt-quick-sep";
    ui.quickBar.appendChild(sep);
    recent.forEach(mk);
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "wt-quick-plus";
    plus.textContent = "+";
    plus.title = "More reactions";
    plus.addEventListener("click", (ev) => {
      ev.stopPropagation();
      bumpQuickActivity();
      if (!ui.picker.classList.contains("wt-hide")) { closePicker(); return; }
      if (!ui.root.classList.contains("wt-open")) ui.root.classList.add("wt-open");
      openPicker();
    });
    ui.quickBar.appendChild(plus);
    const gl = document.createElement("button");
    gl.type = "button";
    gl.className = "wt-quick-glass";
    gl.textContent = "\u2728";
    gl.title = "Liquid glass theme";
    gl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleGlass();
    });
    ui.quickBar.appendChild(gl);
  }

  // ---------- typing indicator ----------

  function showTyping(who) {
    if (!ui.typing) return;
    ui.typing.textContent = `${who} is typing\u2026`;
    ui.typing.classList.add("wt-show");
    clearTimeout(S.typingTimer);
    S.typingTimer = setTimeout(hideTyping, 2500);
  }

  function hideTyping() {
    clearTimeout(S.typingTimer);
    S.typingTimer = null;
    if (!ui.typing) return;
    ui.typing.classList.remove("wt-show");
  }

  function sendTyping() {
    if (!isOpen()) return;
    const now = Date.now();
    if (now - S.typingSentAt < 1500) return;
    S.typingSentAt = now;
    send({ t: "typing", from: S.name });
  }

  // ---------- now playing (episode title) ----------

  function extractNowPlaying() {
    const t = String(document.title || "").trim();
    if (!t) return "";
    // strip site suffixes: " | Netflix", " - Prime Video", " | Hotstar", etc.
    let x = t.replace(/\s*\|\s*(Netflix|Prime Video|Hotstar|JioHotstar)\s*.*$/i, "");
    x = x.replace(/\s*-\s*Watch(?: online)?\s*$/i, "");
    x = x.replace(/^Prime Video\s*[:|-]\s*/i, "");
    x = x.replace(/^Hotstar\s*[:|-]\s*/i, "");
    return x.trim();
  }

  function updateNowPlaying() {
    if (!ui.root) return;
    const now = extractNowPlaying();
    const node = ui.root.querySelector("#wt-now");
    if (!node) return;
    if (now && now !== S.nowLabel) {
      S.nowLabel = now;
      node.textContent = "\u25b6 " + now;
      node.classList.add("wt-show");
      if (ui.quickTitle) ui.quickTitle.textContent = "\u25b6 " + now;
    }
  }

  function currentShareUrl() {
    try {
      if (typeof location !== "undefined" && location && /^https?:$/.test(location.protocol)) {
        return location.href.split("#")[0];
      }
    } catch (_) {}
    return "";
  }

  // ---------- v11: watch history ----------
  const HIST_MAX = 60;

  function saveHist(force) {
    const now = Date.now();
    if (!force && now - (S.histSavedAt || 0) < 10000) return;
    S.histSavedAt = now;
    try { chrome.storage.local.set({ wt_history: S.hist.slice(0, HIST_MAX) }); } catch (_) {}
  }

  // Called on every keepalive tick (4s). Accrues real watch time per title/URL
  // while actually watching (connected, playing, tab visible).
  function accrueWatch() {
    if (!isOpen()) { S.histTickAt = 0; return; }
    const v = S.video;
    if (!v || v.paused) { S.histTickAt = 0; return; }
    let hidden = false;
    try { hidden = !!document.hidden; } catch (_) {}
    if (hidden) { S.histTickAt = 0; return; }
    const now = Date.now();
    if (!S.histTickAt) { S.histTickAt = now; return; }
    const dt = (now - S.histTickAt) / 1000;
    S.histTickAt = now;
    if (!(dt > 0) || dt > 15) return; // ignore sleep/wake jumps
    const url = currentShareUrl();
    if (!url) return;
    let title = S.nowLabel || "";
    if (!title) { try { title = String(document.title || "").slice(0, 120); } catch (_) {} }
    if (!title) title = "(untitled)";
    let e = null;
    for (const h of S.hist) { if (h.u === url) { e = h; break; } }
    if (!e) {
      e = { u: url, t: title, d: now, w: 0, l: now };
      S.hist.unshift(e);
    }
    e.w += dt;
    e.l = now;
    if (title !== "(untitled)") e.t = title;
    S.hist.sort((a, b) => b.l - a.l);
    if (S.hist.length > HIST_MAX) S.hist.length = HIST_MAX;
    saveHist(false);
  }

  function fmtWhen(ms) {
    try {
      const d = new Date(ms);
      const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      return date + " \u00b7 " + time;
    } catch (_) { return ""; }
  }

  function fmtDur(sec) {
    sec = Math.round(Number(sec) || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return h + "h " + String(m).padStart(2, "0") + "m";
    if (m > 0) return m + "m " + String(s).padStart(2, "0") + "s";
    return s + "s";
  }

  function openHistory() {
    if (!ui.root) return;
    const view = ui.root.querySelector("#wt-hist");
    if (!view) return;
    const list = view.querySelector("#wt-hist-list");
    while (list.firstChild) list.firstChild.remove();
    if (!S.hist.length) {
      const empty = document.createElement("div");
      empty.className = "wt-hist-empty";
      empty.textContent = "Nothing watched yet \u2013 press play with your friend!";
      list.appendChild(empty);
    }
    for (const e of S.hist.slice(0, HIST_MAX)) {
      const row = document.createElement("div");
      row.className = "wt-hist-row";
      const t1 = document.createElement("div");
      t1.className = "wt-hist-title";
      t1.textContent = "\u25b6 " + (e.t || "(untitled)");
      t1.title = e.u || "";
      const t2 = document.createElement("div");
      t2.className = "wt-hist-meta";
      t2.textContent = fmtWhen(e.l) + " \u00b7 watched " + fmtDur(e.w);
      row.appendChild(t1); row.appendChild(t2);
      row.addEventListener("click", () => {
        try { window.open(e.u, "_blank", "noopener"); } catch (_) {}
      });
      list.appendChild(row);
    }
    for (const sel of ["#wt-msgs", "#wt-typing", "#wt-react-bar", "#wt-form", "#wt-now"]) {
      const n = ui.root.querySelector(sel);
      if (n) n.classList.add("wt-hide");
    }
    view.classList.remove("wt-hide");
  }

  function closeHistory() {
    if (!ui.root) return;
    const view = ui.root.querySelector("#wt-hist");
    if (!view || view.classList.contains("wt-hide")) return;
    view.classList.add("wt-hide");
    for (const sel of ["#wt-msgs", "#wt-react-bar", "#wt-form"]) {
      const n = ui.root.querySelector(sel);
      if (n) n.classList.remove("wt-hide");
    }
  }


  function shareNowPlaying() {
    const url = currentShareUrl();
    if (!url) {
      toast("Nothing to share on this page");
      return;
    }
    const label = S.nowLabel ? ("\u25b6 " + S.nowLabel + " \u2013 " + url) : url;
    if (sendChatText(label)) toast("Link shared \u2713");
  }

function toast(text) {
    if (!ui.toasts) return;
    const t = document.createElement("div");
    t.className = "wt-toast";
    t.textContent = text;
    ui.toasts.appendChild(t);
    setTimeout(() => {
      try { t.remove(); } catch (_) {}
    }, 4000);
    // keep at most 4 stacked
    while (ui.toasts.childElementCount > 4) ui.toasts.firstElementChild.remove();
  }

  function activity(icon, text) {
    toast(`${icon} ${text}`);
  }

  function relocateRoot() {
    if (!ui.root) return;
    (document.fullscreenElement || document.documentElement).appendChild(ui.root);
  }

  
  // ---------- direct connect (ad-block-proof, serverless fallback) ----------
  const LINK_ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

  function makeDataConn(dc) {
    const conn = {
      open: dc.readyState === "open",
      closed: false,
      peer: "direct",
      _h: {},
      on(t, f) { (conn._h[t] = conn._h[t] || []).push(f); },
      emit(t, x) { (conn._h[t] || []).slice().forEach((f) => { try { f(x); } catch (_) {} }); },
      send(o) {
        if (!conn.open || conn.closed) return;
        try { dc.send(JSON.stringify(o)); } catch (_) {}
      },
      close() {
        if (conn.closed) return;
        conn.closed = true; conn.open = false;
        try { dc.close(); } catch (_) {}
        conn.emit("close");
      },
      removeAllListeners() { conn._h = {}; }
    };
    dc.onopen = () => { conn.open = true; conn.emit("open"); };
    dc.onmessage = (e) => {
      let m = null;
      try { m = JSON.parse(e.data); } catch (_) { return; }
      conn.emit("data", m);
    };
    dc.onclose = () => {
      if (conn.closed) return;
      conn.closed = true; conn.open = false;
      conn.emit("close");
    };
    return conn;
  }

  function gatherDone(pc) {
    return new Promise((res) => {
      if (pc.iceGatheringState === "complete") return res();
      const t = setTimeout(res, 2500);
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); }
      });
    });
  }

  function encodeDesc(d) {
    try { return btoa(encodeURIComponent(JSON.stringify({ t: d.type, s: d.sdp }))); }
    catch (_) { return ""; }
  }
  function decodeDesc(code) {
    try {
      const o = JSON.parse(decodeURIComponent(atob(String(code).trim())));
      return o && o.t && o.s ? { type: o.t, sdp: o.s } : null;
    } catch (_) { return null; }
  }

  function cleanupLinkPC() {
    if (S.linkPC) {
      try { S.linkPC.close(); } catch (_) {}
      S.linkPC = null;
    }
  }

  function finishLink(dc) {
    cleanupLinkPC();
    endVoiceCall();
    teardownConn();
    clearTimeout(S.retryTimer);
    if (S.peer) {
      try { S.peer.destroy(); } catch (_) {}
      S.peer = null;
    }
    S.directMode = true;
    attachConn(makeDataConn(dc));
    sysMsg("\ud83d\udd17 Direct connection established \u2013 no server involved");
  }

  function openLinkBox() {
    linkBoxHtml(
      '<div class="wt-lk-title">\ud83d\udd17 Direct connect \u2013 works even with strict ad blockers</div>' +
      '<div id="wt-lk-choose">' +
      '<button id="wt-lk-create" type="button">Show a code</button> ' +
      '<button id="wt-lk-join" type="button">I have a code</button> ' +
      '<button id="wt-link-cancel" type="button">Cancel</button>' +
      '</div><div id="wt-lk-body"></div>'
    );
    ui.linkBox.querySelector("#wt-link-cancel").addEventListener("click", (e) => {
      e.stopPropagation(); closeLinkBox();
    });
    ui.linkBox.querySelector("#wt-lk-create").addEventListener("click", (e) => {
      e.stopPropagation(); startCreateFlow();
    });
    ui.linkBox.querySelector("#wt-lk-join").addEventListener("click", (e) => {
      e.stopPropagation(); startJoinFlow();
    });
  }

  function lkShell(inner) {
    return '<div class="wt-lk-title">\ud83d\udd17 Direct connect</div>' + inner;
  }
  function bindCopy(btnSel, getVal) {
    ui.linkBox.querySelector(btnSel).addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(getVal()).then(() => toast("Copied")).catch(() => {});
    });
  }
  function bindCancel() {
    ui.linkBox.querySelector("#wt-link-cancel").addEventListener("click", (e) => {
      e.stopPropagation(); closeLinkBox();
    });
  }

  async function startCreateFlow() {
    try {
      const pc = new RTCPeerConnection(LINK_ICE);
      S.linkPC = pc;
      const dc = pc.createDataChannel("wt", { ordered: true });
      dc.onopen = () => finishLink(dc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await gatherDone(pc);
      linkBoxHtml(lkShell(
        '<div class="wt-sys">1) Send this code to your friend (any chat app):</div>' +
        '<textarea id="wt-link-code" readonly></textarea>' +
        '<button id="wt-link-copy" type="button">Copy code</button>' +
        '<div class="wt-sys">2) Paste their reply code:</div>' +
        '<textarea id="wt-link-in" placeholder="Paste reply code\u2026"></textarea>' +
        '<button id="wt-link-go" type="button">Connect</button> ' +
        '<button id="wt-link-cancel" type="button">Cancel</button>'
      ));
      ui.linkBox.querySelector("#wt-link-code").value = encodeDesc(pc.localDescription);
      bindCopy("#wt-link-copy", () => ui.linkBox.querySelector("#wt-link-code").value);
      bindCancel();
      ui.linkBox.querySelector("#wt-link-go").addEventListener("click", async (e) => {
        e.stopPropagation();
        const ans = decodeDesc(ui.linkBox.querySelector("#wt-link-in").value);
        if (!ans || ans.type !== "answer") { toast("That is not a reply code"); return; }
        try { await pc.setRemoteDescription(ans); toast("Connecting directly\u2026"); }
        catch (_) { toast("Bad reply code"); }
      });
      } catch (_) {
      toast("Direct connect not supported here");
      closeLinkBox();
    }
  }

  async function startJoinFlow() {
    linkBoxHtml(lkShell(
      '<div class="wt-sys">Paste the invite code you received:</div>' +
      '<textarea id="wt-link-in" placeholder="Paste invite code\u2026"></textarea>' +
      '<button id="wt-link-go2" type="button">Next</button> ' +
      '<button id="wt-link-cancel" type="button">Cancel</button><div id="wt-lk-body"></div>'
    ));
    bindCancel();
    ui.linkBox.querySelector("#wt-link-go2").addEventListener("click", async (e) => {
      e.stopPropagation();
      const offer = decodeDesc(ui.linkBox.querySelector("#wt-link-in").value);
      if (!offer || offer.type !== "offer") { toast("Invalid invite code"); return; }
      try {
        const pc = new RTCPeerConnection(LINK_ICE);
        S.linkPC = pc;
        pc.ondatachannel = (ev) => { ev.channel.onopen = () => finishLink(ev.channel); };
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await gatherDone(pc);
        linkBoxHtml(lkShell(
          '<div class="wt-sys">Send this reply code back:</div>' +
          '<textarea id="wt-link-out" readonly></textarea>' +
          '<button id="wt-link-copy" type="button">Copy reply</button>' +
          '<button id="wt-link-cancel" type="button">Cancel</button>'
        ));
        ui.linkBox.querySelector("#wt-link-out").value = encodeDesc(pc.localDescription);
        bindCopy("#wt-link-copy", () => ui.linkBox.querySelector("#wt-link-out").value);
        bindCancel();
      } catch (_) {
        toast("Could not create reply \u2013 invalid code?");
        closeLinkBox();
      }
    });
  }

  function linkBoxHtml(html) {
    ui.linkBox.innerHTML = html;
    ui.linkBox.classList.remove("wt-hide");
    renderStatus();
  }
  function closeLinkBox() {
    cleanupLinkPC();
    ui.linkBox.classList.add("wt-hide");
    ui.linkBox.textContent = "";
    renderStatus();
  }

  function showUi(on) {
    ui.root.classList.toggle("wt-active", on);
    if (on) ui.root.classList.add("wt-open");
    if (ui.quickPanel) ui.quickPanel.classList.toggle("wt-show", on);
    if (on) { buildQuickBar(); applyGlass(); bumpQuickActivity(); }
  }

  function bumpQuickActivity() {
    if (!ui.quickPanel) return;
    ui.quickPanel.classList.remove("wt-idle");
    clearTimeout(S.quickIdleTimer);
    S.quickIdleTimer = setTimeout(() => {
      if (ui.quickPanel && !ui.quickPanel.matches(":hover")) ui.quickPanel.classList.add("wt-idle");
    }, 15000);
  }

  function closePanelAnimated() {
    if (!ui.root.classList.contains("wt-open")) return;
    ui.root.classList.add("wt-shut");
    setTimeout(() => {
      ui.root.classList.remove("wt-open", "wt-shut");
      try { ui.picker.classList.add("wt-hide"); } catch (_) {}
    }, 150);
  }

  // ---------- boot ----------

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || !ch.wt_party) return;
    const next = ch.wt_party.newValue;
    if (!next) {
      stopParty();
      return;
    }
    // v10: a party already running for THIS id+role must never be restarted by a
    // redundant storage write. The old `|| !S.peer` clause force-restarted the
    // whole UI in direct mode (peer is legitimately null there) and after
    // transient drops, wiping the chat panel mid-conversation.
    const sameParty = S.roomId && !S.stopping &&
      String(next.id || "").toUpperCase() === S.roomId && next.role === S.role;
    if (!sameParty) startParty(next);
  });

  // v11 diagnostic snapshot for support/debugging (harmless in production)
  try {
    window.__wtVoiceDbg = () => ({
      role: S.role, room: S.roomId, open: isOpen(),
      micEnabled: !!S.micEnabled,
      micStreamActive: !!(S.micStream && S.micStream.active),
      line: !!S.voiceConn,
      gate: !!S.gateTimer, gateMuted: !!S.gateMuted,
      histEntries: S.hist.length
    });
  } catch (_) {}

  (async () => {
    ensureUi();
    relocateRoot();
    document.addEventListener("fullscreenchange", relocateRoot);
    setInterval(bindVideo, 1500);
    setInterval(updateNowPlaying, 10000);
    startWatchdog();
    // instant recovery when a slept PC / background tab wakes up
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      reconnectPeer();
      if (!isOpen()) {
        // kick the reconnect chain immediately instead of waiting for the timer
        if (S.role === "guest" && !S.retryTimer && !S.stopping && S.peer) scheduleRetry();
        return;
      }
      if (S.role === "guest") send({ t: "needstate" });
      else pushState();
    });
    // v10: react to the OS network stack coming back instead of waiting out the
    // retry timer; also show one honest status line while offline.
    try {
      window.addEventListener("online", () => {
        if (S.stopping || !S.roomId) return;
        S.reconnecting = false;
        reconnectPeer();
        if (!isOpen() && S.role === "guest") scheduleRetry();
      });
      window.addEventListener("offline", () => {
        if (S.stopping || !S.roomId) return;
        setStatus("waiting", "Wi-Fi lost \u2013 will reconnect automatically\u2026");
      });
    } catch (_) {}
    const { wt_party: party, wt_voice_vol: savedVol, wt_react_freq: savedFreq, wt_react_recent: savedRecent, wt_glass: savedGlass, wt_pos_root: posRoot, wt_pos_quick: posQuick, wt_nc: savedNc, wt_history: savedHist } = await chrome.storage.local.get(["wt_party", "wt_voice_vol", "wt_react_freq", "wt_react_recent", "wt_glass", "wt_pos_root", "wt_pos_quick", "wt_nc", "wt_history"]);    if (typeof savedVol === "number") applyVoiceVol(savedVol, false);
    if (savedFreq && typeof savedFreq === "object") S.reactFreq = savedFreq;
    if (Array.isArray(savedRecent)) S.reactRecent = savedRecent.slice(0, 3);
    S.glass = typeof savedGlass === "boolean" ? savedGlass : true;
    if (typeof savedNc === "boolean") { S.nc = savedNc; applyNcUi(); }
    if (Array.isArray(savedHist)) S.hist = savedHist.filter(h => h && typeof h.u === "string").slice(0, HIST_MAX);
    installOpusBoost();
    applySavedPos(ui.root, posRoot);
    applySavedPos(ui.quickPanel, posQuick);
    if (party) startParty(party);
  })();
})();
