(() => {
  if (window.__watchTogetherLoaded) return;
  window.__watchTogetherLoaded = true;

  const PEER_PREFIX = "wtp-v1-";
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
    stopping: false
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
      }
    } catch (_) {}
  }

  function pushState() {
    const v = S.video;
    if (!v) return;
    send({ t: "state", time: v.currentTime, paused: v.paused });
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

  // ---------- peer lifecycle ----------

  function startParty(party) {
    stopParty();
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
      setStatus("connecting", "Connecting\u2026");
    } catch (e) {
      setStatus("error", "Could not start party");
    }
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
      setStatus("waiting", "Room not found \u2013 waiting for host\u2026");
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
    clearTimeout(S.retryTimer);
    setStatus("connected", "Playback synced");
    sysMsg(S.role === "host" ? "Your friend connected" : "Connected to your friend");
    if (S.role === "guest") send({ t: "hello", name: S.name });
    else pushState();
    startHb();
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
    stopHb();
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
    let m = raw;
    if (typeof raw === "string") {
      try { m = JSON.parse(raw); } catch (_) { return; }
    }
    if (!m || typeof m !== "object") return;
    switch (m.t) {
      case "hello":
        if (S.role === "host") {
          const who = String(m.name || "").slice(0, 24);
          if (who) sysMsg(`${who} says hi`);
          pushState();
        }
        break;
      case "state":
      case "seek":
      case "play":
      case "pause":
        applyRemote(m);
        break;
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
    }
  }

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
      '<span class="wt-title">Watch Together</span>' +
      '<button id="wt-code" title="Copy code">\u2013\u2013\u2013\u2013\u2013\u2013</button>' +
      '<button id="wt-close" title="Hide">\u00d7</button>' +
      "</div>" +
      '<div class="wt-statusline"><span class="wt-dot"></span><span id="wt-status-text">Idle</span></div>' +
      '<div id="wt-msgs"></div>' +
      '<form id="wt-form">' +
      '<input id="wt-input" maxlength="300" placeholder="Say hi\u2026" autocomplete="off" />' +
      '<button id="wt-send" type="submit">Send</button>' +
      "</form>" +
      "</div>";
    document.documentElement.appendChild(ui.root);

    ui.pill = ui.root.querySelector("#wt-pill");
    ui.panel = ui.root.querySelector("#wt-panel");
    ui.msgs = ui.root.querySelector("#wt-msgs");
    ui.input = ui.root.querySelector("#wt-input");
    ui.codeBtn = ui.root.querySelector("#wt-code");

    ui.pill.addEventListener("click", () => ui.root.classList.toggle("wt-open"));
    ui.root.querySelector("#wt-close").addEventListener("click", (e) => {
      e.stopPropagation();
      ui.root.classList.remove("wt-open");
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
    if (dot) {
      dot.dataset.s = lastStatus.state;
    }
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
    if (!ui.root) return;
    const t = document.createElement("div");
    t.className = "wt-toast";
    t.textContent = text;
    ui.root.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  function relocateRoot() {
    if (!ui.root) return;
    (document.fullscreenElement || document.documentElement).appendChild(ui.root);
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
    const { wt_party: party } = await chrome.storage.local.get("wt_party");
    if (party) startParty(party);
  })();
})();
