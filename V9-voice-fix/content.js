(() => {
  if (window.__watchTogetherLoaded) return;
  window.__watchTogetherLoaded = true;

  const PEER_PREFIX = "wtp-v1-";
  const EXT_VER = "1.9.3";
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
    quickIdleTimer: null
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
    sendHb();
    if (S.peer && S.peer.disconnected) { try { S.peer.reconnect(); } catch (_) {} }
    checkZombie();
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
      if (S.peer && S.peer.disconnected) {
        try { S.peer.reconnect(); } catch (_) {}
      }
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
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    S.micStream = stream;
    return stream;
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
    endVoiceCall();
    if (S.micStream) {
      for (const track of S.micStream.getTracks()) {
        try { track.stop(); } catch (_) {}
      }
      S.micStream = null;
    }
    S.micEnabled = false;
    S.voiceAnnounced = false;
    setMicUi(false);
  }

  function attachVoiceCall(call) {
    endVoiceCall();
    S.voiceConn = call;
    call.on("stream", (remote) => {
      const a = ensureRemoteAudio();
      a.srcObject = remote;
      try {
        a.play().catch(() => {
          toast("\ud83d\udd07 Click anywhere to enable " + (S.friendName || "friend") + "'s voice");
        });
      } catch (_) {}
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
  async function doSyncVoice() {
    if (S.role !== "host" || !isOpen()) return;
    endVoiceCall();
    const want = S.micEnabled || S.friendVoiceOn;
    if (!want) return;
    let stream = null;
    try { stream = await getMicStream(); } catch (_) {}
    if (!isOpen()) return;
    if (!stream || !stream.active) {
      // host mic unavailable: still open the line so the friend can speak
      try { stream = new MediaStream(); } catch (_) { return; }
    }
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
      try {
        call.answer(S.micStream && S.micStream.active ? S.micStream : undefined);
        attachVoiceCall(call);
      } catch (_) {}
    });
    p.on("disconnected", () => {
      try { p.reconnect(); } catch (_) {}
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
      setStatus("waiting", "Room not found \u2013 waiting for host\u2026");
      scheduleRetry();
    } else if (type === "unavailable-id") {
      setStatus("error", "Room code already in use");
    } else if (type === "network" || type === "server-error" || type === "socket-error" || type === "browser-incompatible") {
      setStatus("error", "Connection blocked \u2013 ad blocker? Try \ud83d\udd17 Direct connect");
      scheduleRetry();
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
    if (next.id !== S.roomId || next.role !== S.role || !S.peer) startParty(next);
  });

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
      if (S.peer && S.peer.disconnected) {
        try { S.peer.reconnect(); } catch (_) {}
      }
      if (!isOpen()) {
        // kick the reconnect chain immediately instead of waiting for the timer
        if (S.role === "guest" && !S.retryTimer && !S.stopping && S.peer) scheduleRetry();
        return;
      }
      if (S.role === "guest") send({ t: "needstate" });
      else pushState();
    });
    const { wt_party: party, wt_voice_vol: savedVol, wt_react_freq: savedFreq, wt_react_recent: savedRecent, wt_glass: savedGlass, wt_pos_root: posRoot, wt_pos_quick: posQuick } = await chrome.storage.local.get(["wt_party", "wt_voice_vol", "wt_react_freq", "wt_react_recent", "wt_glass", "wt_pos_root", "wt_pos_quick"]);
    if (typeof savedVol === "number") applyVoiceVol(savedVol, false);
    if (savedFreq && typeof savedFreq === "object") S.reactFreq = savedFreq;
    if (Array.isArray(savedRecent)) S.reactRecent = savedRecent.slice(0, 3);
    S.glass = typeof savedGlass === "boolean" ? savedGlass : true;
    applySavedPos(ui.root, posRoot);
    applySavedPos(ui.quickPanel, posQuick);
    if (party) startParty(party);
  })();
})();
