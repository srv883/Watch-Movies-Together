(() => {
  if (window.__watchTogetherLoaded) return;
  window.__watchTogetherLoaded = true;

  const PEER_PREFIX = "wtp-v1-";
  const HB_MS = 4000;
  const GUEST_RETRY_MS = 3500;
  const MAX_GUEST_RETRIES = 20;
  const REACTIONS = ["\u2764\uFE0F", "\ud83d\ude02", "\ud83d\ude2e", "\ud83e\udd72", "\ud83d\udd25", "\ud83d\udc4d"];
  const EXT_VER = "1.4.4";

  const EMOJI_DB = typeof WT_EMOJI !== 'undefined' ? WT_EMOJI : { count: 0, cats: [] };

  const S = {
    myTabId: null,
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
    micStream: null,
    remoteAudio: null,
    media: new Map(),
    voiceOn: false,
    live: false,
    ecOn: false,
    micMuted: false,
    friendName: "",
    talkSelf: false,
    talkFriend: false,
    micAna: null,
    remoteAna: null,
    lastParty: null,
    startRetries: 0,
    peerWatch: null
  };

  const ui = {};
  let lastStatus = { state: "idle", detail: "" };
  let pendingPlay = false;

  const num = (x) => (typeof x === "number" && isFinite(x) ? x : null);
  const isOpen = () => !!(S.conn && S.conn.open);

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(sec).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  function whoDid(type, time) {
    const who = S.friendName || "Friend";
    if (type === "pause") toast(`${who} paused`);
    else if (type === "play") toast(`${who} resumed`);
    else if (type === "seek") toast(`${who} seeked \u2192 ${fmtTime(time)}`);
  }

  // ---------- hi-fi opus (sdp munging) ----------

  const VOICE_MAX_BITRATE = 256000;

  function enhanceSdp(sdp) {
    if (!sdp || sdp.indexOf("opus") === -1) return sdp;
    const lines = sdp.split("\r\n");
    let pt = null;
    for (const l of lines) {
      const m = l.match(/^a=rtpmap:(\d+) opus\/48000/i);
      if (m) {
        pt = m[1];
        break;
      }
    }
    if (!pt) return sdp;
    const fmtp = `a=fmtp:${pt} stereo=1;sprop-stereo=1;maxaveragebitrate=${VOICE_MAX_BITRATE};usedtx=0`;
    const out = [];
    let replaced = false;
    for (const l of lines) {
      if (l.startsWith(`a=fmtp:${pt} `)) {
        out.push(fmtp);
        replaced = true;
      } else {
        out.push(l);
      }
    }
    if (!replaced) {
      const i = out.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `));
      out.splice(i + 1, 0, fmtp);
    }
    return out.join("\r\n");
  }

  (function patchPeerConnection() {
    const proto = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!proto || !proto.prototype || proto.prototype.__wtVoicePatched) return;
    proto.prototype.__wtVoicePatched = true;
    for (const m of ["createOffer", "createAnswer"]) {
      const orig = proto.prototype[m];
      if (typeof orig !== "function") continue;
      proto.prototype[m] = async function (...args) {
        const desc = await orig.apply(this, args);
        try {
          if (desc && typeof desc.sdp === "string") desc.sdp = enhanceSdp(desc.sdp);
        } catch (_) {}
        return desc;
      };
    }
  })();

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
  }

  function unbindVideo() {
    const v = S.video;
    if (!v) return;
    v.removeEventListener("play", onPlayPause);
    v.removeEventListener("pause", onPlayPause);
    v.removeEventListener("seeked", onSeeked);
    S.video = null;
  }

  function onPlayPause(e) {
    if (S.applyingRemote || !isOpen()) return;
    const v = e.target;
    send({ t: v.paused ? "pause" : "play", time: v.currentTime });
  }

  function onSeeked(e) {
    if (S.applyingRemote || !isOpen()) return;
    send({ t: "seek", time: e.target.currentTime, paused: e.target.paused });
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
    },
    true
  );

  function applyRemote(m) {
    const v = S.video;
    if (!v) return;
    S.applyingRemote = true;
    clearTimeout(applyRemote._t);
    applyRemote._t = setTimeout(() => {
      S.applyingRemote = false;
    }, 400);
    try {
      const time = num(m.time);
      if (time === null) return;
      if (m.t === "state" || m.t === "seek" || m.t === "pause") {
        if (m.force) {
          try { v.currentTime = time; } catch (_) {}
        } else {
          seekTo(v, time);
        }
      }
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
      }
    } catch (_) {}
  }

  function pushState(force) {
    const v = S.video;
    if (!v) return;
    S.applyingRemote = false;
    send({ t: "state", time: v.currentTime, paused: v.paused, force: !!force });
  }

  function syncNow() {
    if (!isOpen()) {
      toast("Not connected");
      return;
    }
    if (S.role === "host") {
      pushState(true);
      sysMsg("Resync pushed to friend");
      toast("Position synced");
    } else {
      toast("Requesting resync\u2026");
      send({ t: "syncReq", name: S.name });
    }
  }

  function driftCheck() {
    const v = S.video;
    if (!v || S.role !== "guest" || S.applyingRemote || !isOpen()) return;
    if (S.remotePaused || v.paused) return;
    const rate = v.playbackRate || 1;
    const expected = S.remoteTime + ((Date.now() - S.remoteAt) / 1000) * rate;
    if (isFinite(expected) && Math.abs(v.currentTime - expected) > 1.8) seekTo(v, expected);
  }

  function startHb() {
    stopHb();
    S.hbTimer = setInterval(() => {
      const v = S.video;
      if (!v || !isOpen()) return;
      send({ t: "hb", time: v.currentTime, paused: v.paused });
    }, HB_MS);
  }

  function stopHb() {
    clearInterval(S.hbTimer);
    S.hbTimer = null;
  }

  // ---------- voice chat ----------

  function ensureRemoteAudio() {
    if (S.remoteAudio || !ui.root) return;
    S.remoteAudio = document.createElement("audio");
    S.remoteAudio.autoplay = true;
    S.remoteAudio.style.display = "none";
    ui.root.appendChild(S.remoteAudio);
  }

  function applyMicConstraints() {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: S.ecOn,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2
      }
    });
  }

  async function toggleVoice() {
    if (!S.peer) {
      toast("Start a party first");
      return;
    }
    if (S.voiceOn) {
      voiceOff();
      return;
    }
    let stream = null;
    try {
      stream = await applyMicConstraints();
    } catch (_) {
      toast("Microphone blocked \u2013 allow access and retry");
      return;
    }
    S.micStream = stream;
    S.voiceOn = true;
    renderVoice();
    ensureRemoteAudio();
    toast(
      S.ecOn
        ? "Voice on \u2013 Echo Guard active, speakers safe"
        : "Studio voice on \u2013 headphones strongly recommended"
    );
    if (S.micAna) S.micAna.__wtAlive = false;
    S.micAna = watchLevel(stream, (lvl) => {
      const t = lvl > 16;
      if (t !== S.talkSelf) {
        S.talkSelf = t;
        renderTalk();
      }
    });
    callTargets();
  }

  async function toggleEc() {
    S.ecOn = !S.ecOn;
    renderEc();
    toast(S.ecOn ? "Echo Guard ON" : "Echo Guard OFF \u2013 max fidelity");
    if (!S.voiceOn) return;
    if (S.micStream) for (const tr of S.micStream.getTracks()) tr.stop();
    try {
      S.micStream = await applyMicConstraints();
      for (const pid of [...S.media.keys()]) placeCall(pid);
    } catch (_) {
      toast("Microphone error \u2013 toggle VOICE to recover");
    }
  }

  function callTargets() {
    if (S.role === "host") {
      if (isOpen() && S.conn.peer) placeCall(S.conn.peer);
    } else if (S.roomId) {
      placeCall(PEER_PREFIX + S.roomId);
    }
  }

  function placeCall(pid) {
    dropCall(pid);
    if (!S.micStream || !S.peer) return;
    try {
      const call = S.peer.call(pid, S.micStream);
      wireCall(call, pid);
    } catch (_) {}
  }

  function wireCall(call, pid) {
    S.media.set(pid, call);
    call.on("stream", (remote) => {
      ensureRemoteAudio();
      S.remoteAudio.srcObject = remote;
      S.remoteAudio.play().catch(() => {});
      setLive(true);
      if (S.remoteAna) S.remoteAna.__wtAlive = false;
      S.remoteAna = watchLevel(remote, (lvl) => {
        const t = lvl > 16;
        if (t !== S.talkFriend) {
          S.talkFriend = t;
          renderTalk();
        }
      });
    });
    call.on("close", () => {
      if (S.media.get(pid) === call) S.media.delete(pid);
      if (!S.media.size) setLive(false);
    });
    call.on("error", () => {});
  }

  function dropCall(pid) {
    const c = S.media.get(pid);
    if (c) {
      try { c.close(); } catch (_) {}
      S.media.delete(pid);
    }
    if (!S.media.size) setLive(false);
  }

  function wireMediaPeer(p) {
    p.on("call", (inc) => {
      const pid = inc.peer;
      dropCall(pid);
      try {
        inc.answer(S.voiceOn && S.micStream ? S.micStream : undefined);
        wireCall(inc, pid);
      } catch (_) {}
    });
  }

  function voiceOff() {
    S.voiceOn = false;
    S.micMuted = false;
    renderMute();
    if (S.micAna) {
      S.micAna.__wtAlive = false;
      S.micAna = null;
    }
    if (S.remoteAna) {
      S.remoteAna.__wtAlive = false;
      S.remoteAna = null;
    }
    S.talkSelf = false;
    S.talkFriend = false;
    renderTalk();
    if (S.micStream) {
      for (const tr of S.micStream.getTracks()) tr.stop();
      S.micStream = null;
    }
    for (const pid of [...S.media.keys()]) dropCall(pid);
    if (S.remoteAudio) S.remoteAudio.srcObject = null;
    setLive(false);
    renderVoice();
  }

  function setLive(on) {
    S.live = on;
    renderVoice();
  }

  function renderVoice() {
    if (ui.voiceBtn) {
      ui.voiceBtn.dataset.on = S.voiceOn ? "1" : "0";
      ui.voiceBtn.classList.toggle("wt-live", !!S.live);
      ui.voiceBtn.textContent = S.live ? "LIVE" : S.voiceOn ? "RINGING\u2026" : "VOICE";
    }
  }

  function renderEc() {
    if (ui.ecBtn) {
      ui.ecBtn.dataset.on = S.ecOn ? "1" : "0";
      ui.ecBtn.textContent = S.ecOn ? "EC\u2713" : "EC";
    }
  }

  // ---------- peer lifecycle ----------

  function startParty(party) {
    stopParty();
    S.lastParty = party;
    S.role = party.role;
    S.roomId = String(party.id || "").toUpperCase();
    S.name = String(party.name || (party.role === "host" ? "Host" : "Guest")).slice(0, 24);
    S.retries = 0;
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
      wireMediaPeer(S.peer);
      setStatus("connecting", "Connecting\u2026");
      armPeerWatch();
    } catch (_) {
      setStatus("error", "Could not start party");
    }
  }

  function armPeerWatch() {
    clearTimeout(S.peerWatch);
    S.peerWatch = setTimeout(() => {
      if (S.stopping || isOpen() || (S.peer && S.peer.open)) return;
      setStatus(
        "error",
        "Sync server unreachable \u2013 check internet, or allow it in your adblocker"
      );
      if (S.peer) {
        try { S.peer.destroy(); } catch (_) {}
        S.peer = null;
      }
      if (S.startRetries < 8) {
        S.startRetries++;
        setTimeout(() => {
          if (S.lastParty && !S.stopping && !S.peer) startParty(S.lastParty);
        }, 4000);
      }
    }, 12000);
  }

  function wirePeer(p) {
    p.on("error", handleErr);
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
    S.retryTimer = setTimeout(() => {
      if (!S.peer || S.stopping) return;
      if (S.retries >= MAX_GUEST_RETRIES) {
        setStatus("error", "Could not reach the room. Check the code.");
        return;
      }
      S.retries++;
      connectToHost();
    }, GUEST_RETRY_MS);
  }

  function handleErr(err) {
    const type = err && err.type;
    if (type === "peer-unavailable") {
      setStatus("waiting", "Room not found \u2013 re-check the code with your friend");
      scheduleRetry();
    } else if (type === "unavailable-id") {
      setStatus("error", "Room code already in use");
    } else if (type === "network" || type === "server-error" || type === "socket-error" || type === "browser-incompatible") {
      setStatus("error", "Network error \u2013 retrying\u2026");
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
    S.startRetries = 0;
    clearTimeout(S.peerWatch);
    setStatus("connected", "Playback synced");
    sysMsg(S.role === "host" ? "Your friend connected" : "Connected to your friend");
    send({ t: "hello", name: S.name, v: EXT_VER });
    if (S.role === "host") pushState();
    startHb();
    if (S.voiceOn) callTargets();
  }

  function onConnClose() {
    stopHb();
    S.conn = null;
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
    clearTimeout(S.peerWatch);
    stopHb();
    teardownConn();
    if (S.peer) {
      try { S.peer.destroy(); } catch (_) {}
      S.peer = null;
    }
    voiceOff();
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
    let m = raw;
    if (typeof raw === "string") {
      try { m = JSON.parse(raw); } catch (_) { return; }
    }
    if (!m || typeof m !== "object") return;
    switch (m.t) {
      case "hello": {
        const who = String(m.name || "").slice(0, 24);
        if (who) {
          S.friendName = who;
          if (S.role === "host") {
            sysMsg(`${who} joined`);
            pushState();
          }
        }
        if (m.v && m.v !== EXT_VER) {
          sysMsg(`\u26a0 Version mismatch: friend has v${m.v}, you have v${EXT_VER}. Both should update!`);
        }
        break;
      }
      case "syncReq":
        if (S.role === "host") {
          toast(`${String(m.name || "Your friend").slice(0, 24)} requested resync \u2013 sent`);
          sysMsg("Resync sent");
          S.applyingRemote = false;
          pushState(true);
        }
        break;
      case "state":
        applyRemote(m);
        break;
      case "seek":
      case "play":
      case "pause": {
        const t = num(m.time);
        if (t !== null) {
          S.remoteTime = t;
          S.remoteAt = Date.now();
        }
        if (m.t === "play") S.remotePaused = false;
        else if (m.t === "pause") S.remotePaused = true;
        else if (typeof m.paused === "boolean") S.remotePaused = m.paused;
        whoDid(m.t, t);
        applyRemote(m);
        break;
      }
      case "hb": {
        const t = num(m.time);
        if (t !== null) {
          S.remoteTime = t;
          S.remotePaused = !!m.paused;
          S.remoteAt = Date.now();
          driftCheck();
        }
        break;
      }
      case "chat": {
        const text = String(m.text == null ? "" : m.text).slice(0, 300);
        if (!text) return;
        const from = String(m.from || "Friend").slice(0, 24);
        addMsg(from, text, false);
        break;
      }
      case "react": {
        const em = String(m.emoji || "").trim();
        if (em && em.length <= 16) burst(em);
        break;
      }
    }
  }

  // ---------- overlay ui ----------

  const OVERLAY_CSS = `
#wt-root{display:flex;flex-direction:column;align-items:flex-end;gap:10px;font-family:'Segoe UI',system-ui,sans-serif}
#wt-root:not(.wt-active){display:none}
#wt-root:not(.wt-open) #wt-panel{display:none}
#wt-pill{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border:none;border-radius:999px;background:#e53935;color:#fff;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.45)}
#wt-pill:hover{filter:brightness(1.1)}
.wt-dot{width:9px;height:9px;border-radius:50%;background:#888;flex:none}
.wt-dot[data-s="connected"]{background:#43d17a;box-shadow:0 0 6px rgba(67,209,122,.6)}
.wt-dot[data-s="waiting"],.wt-dot[data-s="connecting"]{background:#ffb300}
.wt-dot[data-s="error"]{background:#ff5252}
#wt-panel{position:relative;width:300px;height:400px;display:flex;flex-direction:column;background:rgba(16,16,24,.97);color:#eee;border-radius:14px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.55)}
.wt-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(255,255,255,.04)}
#wt-voice{font-size:10.5px;font-weight:700;letter-spacing:.5px;padding:4px 9px;border-radius:999px;border:none;cursor:pointer;background:#2a2a3a;color:#aeb;flex:none}
#wt-voice[data-on="1"]{background:#2d6cdf;color:#fff}
#wt-voice.wt-live{background:#43d17a;color:#08300f}
#wt-ec{font-size:10.5px;font-weight:700;letter-spacing:.5px;padding:4px 8px;border-radius:999px;border:none;cursor:pointer;background:#2a2a3a;color:#aeb;flex:none}
#wt-ec[data-on="1"]{background:#8e24aa;color:#fff}
.wt-title{font-size:13px;font-weight:700;margin-right:auto}
#wt-code{font-family:Consolas,monospace;font-size:13px;letter-spacing:2px;color:#ffd54f;background:none;border:none;cursor:pointer}
#wt-close{background:none;border:none;color:#999;font-size:16px;cursor:pointer;padding:0 4px}
#wt-close:hover{color:#fff}
.wt-statusline{display:flex;align-items:center;gap:7px;padding:8px 12px;font-size:11.5px;color:#9a9ab0;border-bottom:1px solid rgba(255,255,255,.06)}
#wt-sync{margin-left:auto;font-size:10px;font-weight:700;letter-spacing:1px;padding:3px 10px;border-radius:999px;border:1px solid #4dd0e1;color:#4dd0e1;background:transparent;cursor:pointer}
#wt-sync{margin-left:0;font-size:10px;font-weight:700;letter-spacing:1px;padding:3px 10px;border-radius:999px;border:1px solid #4dd0e1;color:#4dd0e1;background:transparent;cursor:pointer;flex:none}
#wt-sync:hover{background:rgba(77,208,225,.15)}
#wt-delta{margin-left:auto;font-family:Consolas,monospace;font-size:10.5px;color:#9a9ab0}
#wt-delta[data-q="ok"]{color:#43d17a}
#wt-delta[data-q="warn"]{color:#ffb300}
#wt-delta[data-q="bad"]{color:#ff5252}
#wt-voice.wt-speaking{box-shadow:0 0 0 3px rgba(67,209,122,.55);animation:wtPulse 1s infinite}
#wt-pill.wt-friend-talk{box-shadow:0 0 0 3px rgba(77,144,255,.65),0 4px 14px rgba(0,0,0,.45)}
@keyframes wtPulse{50%{box-shadow:0 0 0 7px rgba(67,209,122,.18)}}
#wt-reactbar{display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.06)}
#wt-reactbar button{background:#23232f;border:none;border-radius:8px;font-size:15px;padding:3px 8px;cursor:pointer;transition:transform .12s}
#wt-reactbar button:hover{background:#33334a;transform:scale(1.15)}
#wt-plus{color:#8ab4f8;font-size:13px;font-weight:700}
#wt-picker{position:absolute;left:0;right:0;bottom:52px;height:290px;background:#16161f;display:none;flex-direction:column;border-top:1px solid rgba(255,255,255,.1);z-index:6;border-radius:0 0 14px 14px}
#wt-picker.wt-open{display:flex}
#wt-phead{display:flex;align-items:center;padding:7px 10px 3px;font-size:11px;color:#9a9ab0;text-transform:uppercase;letter-spacing:.5px}
#wt-phead span{flex:1}
#wt-pclose{background:none;border:none;color:#888;font-size:14px;cursor:pointer;padding:0 4px}
#wt-pclose:hover{color:#fff}
#wt-tabs{display:flex;gap:2px;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.07);overflow-x:auto;scrollbar-width:none}
#wt-tabs button{background:none;border:none;font-size:16px;padding:3px 6px;cursor:pointer;opacity:.45;border-radius:6px;flex:none}
#wt-tabs button.on{opacity:1;background:#2a2a3a}
#wt-picker.wt-searching #wt-tabs{display:none}
#wt-psearch{flex:1;min-width:0;background:#23232f;border:1px solid #33333f;border-radius:7px;color:#fff;font-size:12px;padding:5px 8px;outline:none;margin-right:4px}
#wt-psearch:focus{border-color:#8ab4f8}
.wt-empty{grid-column:1/-1;text-align:center;color:#77778c;font-size:12px;padding:18px 0;font-style:italic}
#wt-grid{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(34px,1fr));padding:6px;gap:2px;scrollbar-width:thin;align-content:start}
#wt-grid::-webkit-scrollbar{width:5px}
#wt-grid::-webkit-scrollbar-thumb{background:#333;border-radius:3px}
#wt-grid button{background:none;border:none;font-size:21px;padding:5px 0;cursor:pointer;border-radius:6px;line-height:1.25}
#wt-grid button:hover{background:#2e2e40}
.wt-float{position:absolute;font-size:28px;pointer-events:none;will-change:transform,opacity;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}
#wt-mute{flex:none;width:36px;background:#23232f;border:1px solid #33333f;border-radius:8px;font-size:14px;color:#ddd;cursor:pointer}
#wt-mute.wt-muted{background:#4d1b24;border-color:#7a2a35;color:#ff8a80}
#wt-msgs{flex:1;overflow-y:auto;padding:10px 12px;font-size:13px;line-height:1.45;scrollbar-width:thin}
#wt-msgs::-webkit-scrollbar{width:5px}
#wt-msgs::-webkit-scrollbar-thumb{background:#333;border-radius:3px}
.wt-msg{margin:3px 0;color:#e8e8ee;word-wrap:break-word}
.wt-msg b{color:#8ab4f8}
.wt-msg.wt-me b{color:#43d17a}
.wt-sys{margin:6px 0;font-size:11.5px;color:#77778c;font-style:italic}
#wt-form{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,.06)}
#wt-input{flex:1;min-width:0;background:#23232f;border:1px solid #33333f;border-radius:8px;color:#fff;font-size:13px;padding:7px 10px;outline:none}
#wt-input:focus{border-color:#e53935}
#wt-send{background:#e53935;color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:600;padding:0 12px;cursor:pointer}
.wt-toast{position:absolute;top:46px;right:0;max-width:300px;background:rgba(20,20,30,.95);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:12.5px;padding:8px 12px;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.5)}
`;

  function ensureUi() {
    if (ui.root) return;
    ui.host = document.createElement("div");
    ui.host.style.cssText =
      "all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647;pointer-events:none";
    const shadow = ui.host.attachShadow({ mode: "closed" });
    const styleEl = document.createElement("style");
    styleEl.textContent = OVERLAY_CSS;
    shadow.appendChild(styleEl);

    ui.root = document.createElement("div");
    ui.root.id = "wt-root";
    ui.root.style.pointerEvents = "auto";
    ui.root.innerHTML =
      '<div id="wt-pill">' +
      '<span class="wt-dot"></span><span>Watch Together</span>' +
      "</div>" +
      '<div id="wt-panel">' +
      '<div class="wt-head">' +
      '<span class="wt-title">Watch Together</span>' +
      '<button id="wt-voice" title="Toggle voice chat">VOICE</button>' +
      '<button id="wt-ec" title="Echo Guard: echo cancellation for speaker users">EC</button>' +
      '<button id="wt-code" title="Copy code">\u2013\u2013\u2013\u2013\u2013\u2013</button>' +
      '<button id="wt-close" title="Hide">\u00d7</button>' +
      "</div>" +
      '<div class="wt-statusline"><span class="wt-dot"></span><span id="wt-status-text">Idle</span>' +
      '<span id="wt-delta"></span>' +
      '<button id="wt-sync" title="Force instant resync (Ctrl+Shift+S)">SYNC</button></div>' +
      '<div id="wt-reactbar">' +
      REACTIONS.map((e) => `<button data-e="${e}" title="Send ${e}">${e}</button>`).join("") +
      '<button id="wt-plus" title="All emoji">\u2795</button>' +
      "</div>" +
      '<div id="wt-msgs"></div>' +
      '<form id="wt-form">' +
      '<button type="button" id="wt-mute" title="Mute / unmute mic">\ud83c\udf99</button>' +
      '<input id="wt-input" maxlength="300" placeholder="Say hi\u2026" autocomplete="off" />' +
      '<button id="wt-send" type="submit">Send</button>' +
      "</form>" +
      '<div id="wt-picker">' +
      '<div id="wt-phead"><input id="wt-psearch" placeholder="Search emoji\u2026" maxlength="40" /><button id="wt-pclose">\u00d7</button></div>' +
      '<div id="wt-tabs"></div>' +
      '<div id="wt-grid"></div>' +
      "</div>" +
      "</div>";
    shadow.appendChild(ui.root);
    document.documentElement.appendChild(ui.host);

    ui.pill = ui.root.querySelector("#wt-pill");
    ui.panel = ui.root.querySelector("#wt-panel");
    ui.msgs = ui.root.querySelector("#wt-msgs");
    ui.input = ui.root.querySelector("#wt-input");
    ui.codeBtn = ui.root.querySelector("#wt-code");
    ui.voiceBtn = ui.root.querySelector("#wt-voice");
    ui.ecBtn = ui.root.querySelector("#wt-ec");
    ui.syncBtn = ui.root.querySelector("#wt-sync");
    ui.deltaEl = ui.root.querySelector("#wt-delta");
    ui.reactbar = ui.root.querySelector("#wt-reactbar");
    ui.muteBtn = ui.root.querySelector("#wt-mute");
    ui.plusBtn = ui.root.querySelector("#wt-plus");
    ui.picker = ui.root.querySelector("#wt-picker");
    ui.tabsEl = ui.root.querySelector("#wt-tabs");
    ui.gridEl = ui.root.querySelector("#wt-grid");
    ui.psearch = ui.root.querySelector("#wt-psearch");

    ui.pill.addEventListener("click", () => ui.root.classList.toggle("wt-open"));
    ui.root.querySelector("#wt-close").addEventListener("click", (e) => {
      e.stopPropagation();
      ui.root.classList.remove("wt-open");
    });

    ui.codeBtn.addEventListener("click", () => {
      if (!S.roomId) return;
      navigator.clipboard.writeText(S.roomId).then(() => toast("Code copied"));
    });

    ui.voiceBtn.addEventListener("click", () => toggleVoice());
    ui.ecBtn.addEventListener("click", () => toggleEc());
    ui.syncBtn.addEventListener("click", () => syncNow());
    ui.reactbar.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-e]");
      if (b) sendReact(b.dataset.e);
    });
    ui.muteBtn.addEventListener("click", () => toggleMute());
    ui.plusBtn.addEventListener("click", () => {
      if (!EMOJI_DB.cats.length) {
        toast("Emoji pack failed to load");
        return;
      }
      ui.picker.classList.toggle("wt-open");
      if (ui.picker.classList.contains("wt-open") && !ui.gridEl.childElementCount) setCat(0);
    });
    ui.root.querySelector("#wt-pclose").addEventListener("click", () => {
      ui.picker.classList.remove("wt-open");
    });
    ui.psearch.addEventListener("input", () => renderGrid());

    ui.root.querySelector("#wt-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const text = ui.input.value.trim();
      if (!text) return;
      ui.input.value = "";
      if (!isOpen()) {
        sysMsg("Not connected \u2013 cannot chat");
        return;
      }
      send({ t: "chat", from: S.name, text });
      addMsg(S.name, text, true);
    });

    for (const el of [ui.input, ui.panel]) {
      el.addEventListener("keydown", (e) => e.stopPropagation());
      el.addEventListener("keyup", (e) => e.stopPropagation());
    }
    relocateRoot();
    document.addEventListener("fullscreenchange", relocateRoot);
  }

  function showUi(on) {
    ui.root.classList.toggle("wt-active", on);
    if (on) ui.root.classList.add("wt-open");
  }

  function updatePanel() {
    if (ui.codeBtn) ui.codeBtn.textContent = S.roomId || "\u2013\u2013\u2013\u2013\u2013\u2013";
  }

  function renderStatus() {
    if (!ui.root) return;
    const dot = ui.root.querySelector(".wt-dot");
    const txt = ui.root.querySelector("#wt-status-text");
    if (txt) txt.textContent = lastStatus.detail || lastStatus.state;
    if (dot) dot.dataset.s = lastStatus.state;
  }

  function addMsg(from, text, self) {
    if (!ui.msgs) return;
    const row = document.createElement("div");
    row.className = "wt-msg" + (self ? " wt-me" : "");
    const b = document.createElement("b");
    b.textContent = from + ": ";
    row.appendChild(b);
    row.appendChild(document.createTextNode(text));
    ui.msgs.appendChild(row);
    trimMsgs();
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

  function toast(text) {
    ensureUi();
    const t = document.createElement("div");
    t.className = "wt-toast";
    t.textContent = text;
    ui.root.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  // ---------- reactions ----------

  function burst(emoji) {
    if (!ui.host) return;
    const s = document.createElement("span");
    s.className = "wt-float";
    s.textContent = emoji;
    s.style.right = 50 + Math.random() * 190 + "px";
    s.style.bottom = "70px";
    ui.host.appendChild(s);
    const dx = Math.random() * 140 - 70;
    const dur = 1800 + Math.random() * 900;
    try {
      s.animate(
        [
          { transform: "translateY(0) scale(.6)", opacity: 0 },
          { transform: "translateY(-46px) scale(1.18)", opacity: 1, offset: 0.15 },
          { transform: `translate(${dx}px,-280px) scale(1) rotate(${dx / 8}deg)`, opacity: 0 }
        ],
        { duration: dur, easing: "cubic-bezier(.2,.6,.3,1)" }
      ).onfinish = () => s.remove();
    } catch (_) {
      setTimeout(() => s.remove(), dur);
    }
  }

  function sendReact(em) {
    if (!isOpen()) {
      toast("Not connected");
      return;
    }
    send({ t: "react", emoji: em });
    burst(em);
  }

  // ---------- mic mute ----------

  function toggleMute() {
    if (!S.voiceOn) {
      toast("Voice is off \u2013 press VOICE first");
      return;
    }
    S.micMuted = !S.micMuted;
    if (S.micStream) {
      for (const tr of S.micStream.getAudioTracks()) tr.enabled = !S.micMuted;
    }
    renderMute();
    toast(S.micMuted ? "Mic muted" : "Mic live");
  }

  function renderMute() {
    if (!ui.muteBtn) return;
    ui.muteBtn.classList.toggle("wt-muted", !!S.micMuted);
    ui.muteBtn.textContent = S.micMuted ? "\ud83d\udd07" : "\ud83c\udf99";
  }

  function relocateRoot() {
    if (!ui.host) return;
    (document.fullscreenElement || document.documentElement).appendChild(ui.host);
  }

  // ---------- sync meter & auto-catchup ----------

  function updateDelta() {
    if (!ui.deltaEl) return;
    const v = S.video;
    if (!isOpen() || !v || v.paused || S.remotePaused) {
      ui.deltaEl.textContent = "";
      return;
    }
    const rate = v.playbackRate || 1;
    const remoteNow = S.remoteTime + ((Date.now() - S.remoteAt) / 1000) * rate;
    const d = Math.abs(v.currentTime - remoteNow);
    if (!isFinite(d)) {
      ui.deltaEl.textContent = "";
      return;
    }
    ui.deltaEl.textContent = "\u0394 " + d.toFixed(1) + "s";
    ui.deltaEl.dataset.q = d < 0.6 ? "ok" : d < 1.8 ? "warn" : "bad";
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!isOpen() || !S.roomId || !S.video) return;
    if (S.role === "host") pushState(true);
    else send({ t: "syncReq", name: S.name });
  });

  // ---------- speaking indicator ----------

  let audioCtx = null;

  function watchLevel(stream, cb) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      const src = audioCtx.createMediaStreamSource(stream);
      const an = audioCtx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      an.__wtAlive = true;
      const data = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        if (!an.__wtAlive) {
          try { src.disconnect(); } catch (_) {}
          return;
        }
        an.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        cb(Math.sqrt(sum / data.length));
        requestAnimationFrame(tick);
      };
      tick();
      return an;
    } catch (_) {
      return null;
    }
  }

  function renderTalk() {
    if (ui.voiceBtn) ui.voiceBtn.classList.toggle("wt-speaking", !!S.talkSelf);
    if (ui.pill) ui.pill.classList.toggle("wt-friend-talk", !!S.talkFriend);
  }

  // ---------- emoji picker ----------

  let curCat = 0;

  function buildTabs() {
    EMOJI_DB.cats.forEach((cat, i) => {
      const b = document.createElement("button");
      b.textContent = cat.icon;
      b.title = cat.name;
      b.addEventListener("click", () => setCat(i));
      ui.tabsEl.appendChild(b);
    });
  }

  function fillGrid(items) {
    ui.gridEl.textContent = "";
    if (!items.length) {
      const d = document.createElement("div");
      d.className = "wt-empty";
      d.textContent = "No matches";
      ui.gridEl.appendChild(d);
      return;
    }
    for (const [nm, em] of items) {
      const b = document.createElement("button");
      b.textContent = em;
      b.title = nm;
      b.addEventListener("click", () => sendReact(em));
      ui.gridEl.appendChild(b);
    }
    ui.gridEl.scrollTop = 0;
  }

  function setCat(i) {
    curCat = i;
    if (!ui.tabsEl.childElementCount) buildTabs();
    for (const b of ui.tabsEl.children) b.classList.remove("on");
    if (ui.tabsEl.children[i]) ui.tabsEl.children[i].classList.add("on");
    ui.picker.classList.remove("wt-searching");
    fillGrid(EMOJI_DB.cats[i] ? EMOJI_DB.cats[i].items : []);
  }

  function renderGrid() {
    const q = (ui.psearch.value || "").trim().toLowerCase();
    if (!q) {
      ui.picker.classList.remove("wt-searching");
      setCat(curCat);
      return;
    }
    ui.picker.classList.add("wt-searching");
    for (const b of ui.tabsEl.children) b.classList.remove("on");
    const res = [];
    for (const c of EMOJI_DB.cats) {
      for (const it of c.items) {
        if (it[0].indexOf(q) !== -1) res.push(it);
      }
    }
    fillGrid(res);
  }

  // ---------- ownership & messaging ----------

  document.addEventListener(
    "keydown",
    (e) => {
      if (!S.roomId) return;
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
      const k = (e.key || "").toLowerCase();
      if (k !== "s") return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation();
      syncNow();
    },
    true
  );

  function ownsParty(party) {
    if (!party || party.tabId == null) return true;
    return S.myTabId === party.tabId;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "WT_PING") {
      sendResponse({ ok: true, hasVideo: !!bestVideo() });
    } else if (msg && msg.type === "WT_START" && msg.party) {
      if (!S.myTabId || ownsParty(msg.party)) startParty(msg.party);
      sendResponse({ ok: true });
    }
    return false;
  });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || !ch.wt_party) return;
    const next = ch.wt_party.newValue;
    if (!next) {
      if (S.roomId) stopParty();
      return;
    }
    if (!ownsParty(next)) return;
    if (next.id !== S.roomId || next.role !== S.role || !S.peer) startParty(next);
  });

  // ---------- boot ----------

  (async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: "WT_WHOAMI" });
      S.myTabId = r && r.tabId != null ? r.tabId : null;
    } catch (_) {
      S.myTabId = null;
    }
    setInterval(() => {
      if (S.roomId) bindVideo();
    }, 1500);
    setInterval(updateDelta, 1000);
    const { wt_party: party } = await chrome.storage.local.get("wt_party");
    if (party && ownsParty(party)) {
      startParty(party);
      return;
    }
    const m = location.hash.match(/[#&]wt=([A-Za-z0-9]{6})/i);
    if (!m) return;
    const code = m[1].toUpperCase();
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (_) {}
    const { wt_name: nm } = await chrome.storage.local.get("wt_name");
    const p = { id: code, role: "guest", name: nm || "Guest", tabId: S.myTabId };
    try {
      await chrome.storage.local.set({ wt_party: p, wt_status: { state: "connecting" } });
    } catch (_) {}
  })();
})();
