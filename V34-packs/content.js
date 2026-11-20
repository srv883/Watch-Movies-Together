(() => {
  if (window.__watchTogetherLoaded) return;
  window.__watchTogetherLoaded = true;

  // v24: streaming-only build. The manifest already restricts injection to
  // the whitelisted sites; this runtime guard is defence-in-depth in case the
  // matches are ever broadened (e.g. editing the unpacked extension).
  const SITE_HOSTS = ["netflix.com", "hotstar.com", "jiohotstar.com", "primevideo.com", "jiotv.com", "jiocinema.com"];
  try {
    const m = /^https?:\/\/([^/:?#]+)/i.exec(location.href || "");
    const host = m ? m[1].replace(/^www\./i, "").toLowerCase() : "";
    if (!SITE_HOSTS.some(d => host === d || host.endsWith("." + d))) return;
  } catch (_) { return; }

  const PEER_PREFIX = "wtp-v1-";
  const EXT_VER = "1.34.0";
  const HB_MS = 4000;
  const GUEST_RETRY_MS = 3500;
  const MAX_GUEST_RETRIES = 20;
  const CONNECT_TIMEOUT_MS = 10000; // v14: a dial that never opens = zombie signaling
  // v26: voice calls are signaled over our own data link (PeerJS conn or the
  // Direct-connect channel) instead of the PeerJS cloud server. Friends on
  // older builds still get the legacy PeerJS call.
  const DC_VOICE_MIN_VER = "1.26.0";
  // v31: always the newest build (the popup checks latest.json next to it)
  const UPDATE_URL = "https://github.com/srv883/Watch-Movies-Together/raw/main/wt-latest.zip";
  // same STUN/TURN set PeerJS uses, so voice traverses the same NATs as data
  const VOICE_ICE = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" }
    ],
    sdpSemantics: "unified-plan"
  };

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
    friendPid: null,     // v14: last known friend peer id (host re-dial target)
    failStreak: 0,       // v14: consecutive failed dial windows (guest hard-rejoin)
    hostRedialAt: 0,     // v14: guard for host-side data re-offers
    lastHardRejoin: 0,   // v14: guard so we rebuild the registration sparingly
    connOpenTimer: null, // v14: dial timeout handle
    stopping: false,
    micEnabled: false,
    micStream: null,
    voiceConn: null,
    lastRxAt: 0,
    wdTimer: null,
    friendName: null,
    friendVer: null,
    friendTime: 0,       // v15: friend's last known playback time (from hb/actions)
    friendPaused: true,   // v15: friend's last known paused state
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
    _lastLocalTime: 0,
    _lastLocalActionAt: 0,
    echo: { paused: null, time: null, rate: null }, // v30: events WE caused
    lastUserActAt: 0,     // v30: last real user play/pause/seek/rate
    lastRemoteActAt: 0,   // v30: last friend action we applied
    reconcileStreak: 0,   // v30: heartbeats in a row that disagree with the host
    histTickAt: 0,
    histSavedAt: 0,
    gateTimer: null,
    gateMuted: false,
    silentCtx: null,
    silentTrack: null,
    vb: null,             // v27: friend-voice boost graph
    vbCtx: null,
    duck: null,           // v28: movie ducking state while the friend talks
    duckOff: false,
    duckSpeechAt: 0,
    dcCalls: {},          // v26: data-link voice calls by id
    voiceHealAt: 0,       // v26: last automatic voice re-dial
    bufSince: 0,          // v31: our video has been starved of data since
    bufSent: false,       // v31: we told the friend we're buffering
    friendBuf: false,     // v31: the friend's video is buffering
    friendBufTime: null,
    holdIgnore: false,    // v31: user chose to play on during this buffering
    hold: null,           // v31: we paused to wait for the friend's buffering
    navKey: null,         // v31: what we are watching (site + path), null = browsing
    navPrev: null,
    navChangedAt: 0,
    follow: null,         // v31: pending "follow the friend" countdown
    offered: {}           // v31: follow offers already shown, by key
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

  // ---------- v32: the linked tab wins ----------
  // The party lives in extension storage, so EVERY open Hotstar/Netflix tab
  // used to start its own copy: a second host tab got "Room code already in
  // use", a second guest tab kept dialing, and after a link drop the backup
  // route could hand the friend to the wrong tab. Now the tab that holds the
  // link says so every heartbeat (wt_live); any other tab stands by quietly
  // and only takes over when that tab has been gone for 10 s.
  const LIVE_STALE_MS = 10000;
  const TAB_ID = (() => {
    const mk = () => Math.random().toString(36).slice(2, 12);
    try {
      let t = sessionStorage.getItem("wt_tab");   // survives reloads of this tab
      if (!t) { t = mk(); sessionStorage.setItem("wt_tab", t); }
      return t;
    } catch (_) { return mk(); }
  })();
  function noteLive(v) {
    if (v && typeof v.tab === "string" && v.tab !== TAB_ID && typeof v.at === "number") S.otherLiveAt = v.at;
  }
  function yielding() {
    return !isOpen() && !!S.otherLiveAt && Date.now() - S.otherLiveAt < LIVE_STALE_MS;
  }
  function announceLive() {
    try { chrome.storage.local.set({ wt_live: { tab: TAB_ID, at: Date.now() } }); } catch (_) {}
  }
  function liveTick() {
    const y = !!S.roomId && yielding();
    if (y && !S.wasYielding) setStatus("waiting", "");   // paints the stand-by line
    if (!y && S.wasYielding && S.roomId && !isOpen() && !S.stopping) {
      // the other tab is gone: this tab becomes the party
      S.wasYielding = false;
      startParty({ id: S.roomId, role: S.role, name: S.name });
      return;
    }
    S.wasYielding = y;
  }

  function setStatus(state, detail) {
    if (yielding()) {
      // stand-by tab: never overwrite the real party's status in storage
      // (not even with the "idle" a party restart passes through)
      lastStatus = S.roomId ? { state: "waiting", detail: "The party is running in your other tab" } : { state, detail: detail || "" };
      renderStatus();
      return;
    }
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
    S._lastLocalTime = v.currentTime || 0;
    v.addEventListener("play", onPlayPause);
    v.addEventListener("pause", onPlayPause);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("ratechange", onRateChange);
    v.addEventListener("emptied", onMediaReload);   // v32
    v.addEventListener("loadstart", onMediaReload);
    // v32: a player that appears while the party is on is a newcomer - it
    // takes the party's position instead of imposing its own start point
    if (S.roomId) { markFresh(); askState(); }
  }

  function unbindVideo() {
    const v = S.video;
    if (!v) return;
    v.removeEventListener("play", onPlayPause);
    v.removeEventListener("pause", onPlayPause);
    v.removeEventListener("seeked", onSeeked);
    v.removeEventListener("ratechange", onRateChange);
    v.removeEventListener("emptied", onMediaReload);
    v.removeEventListener("loadstart", onMediaReload);
    S.video = null;
  }

  // ---------- v32: newcomers adopt the party's position ----------
  // A freshly loaded player (tab reload, following to the next episode, a
  // late join, the site loading the next episode) autoplays from ITS start or
  // resume point and fires play/seek events nobody asked for. Those used to be
  // broadcast - whoever loaded last dragged the other one around (a host
  // reloading mid-episode rewound the guest). Now, for a few seconds after a
  // player (re)loads, only real clicks/keys are broadcast, its state is marked
  // "fresh" so a settled friend ignores it, and it asks for the party's state.
  const JOIN_GRACE_MS = 6000;
  const GESTURE_MS = 1500;
  const YOUNG_PAGE_MS = 45000;

  function gestured() { return Date.now() - (S.gestureAt || 0) < GESTURE_MS; }
  function isFresh() { return Date.now() < (S.freshUntil || 0); }
  function markFresh() { S.freshUntil = Date.now() + JOIN_GRACE_MS; }
  function pageYoung() {
    try { return typeof performance !== "undefined" && performance.now() < YOUNG_PAGE_MS; } catch (_) { return false; }
  }
  function askState() {
    const now = Date.now();
    if (!isOpen() || now - (S.askedAt || 0) < 1500) return;
    S.askedAt = now;
    send({ t: "needstate" });
  }
  function onMediaReload() {
    if (S.roomId) markFresh();
  }
  // autoplay / resume-point noise from a fresh player: not a user action
  function freshNoise() {
    if (!isFresh() || gestured()) return false;
    askState();
    return true;
  }
  try {
    const onGesture = () => { S.gestureAt = Date.now(); };
    // (pointerup/click too: a long drag on the seek bar ends well after its pointerdown)
    for (const t of ["pointerdown", "pointerup", "click", "keydown", "touchend"]) document.addEventListener(t, onGesture, true);
  } catch (_) {}

  // ---------- v32: sync only on the same title ----------
  // The catalogue's auto-playing trailers and a friend's OTHER episode must
  // never drive our playback (their history shows party time on Hotstar's
  // home page: every trailer play/seek went to the friend).
  const NAV_FAMILIES = { hotstar: ["hotstar.com", "jiohotstar.com"], netflix: ["netflix.com"] };
  const TRAILER_MAX_S = 300;

  function hostFamily(host) {
    const h = String(host || "").replace(/^www\./, "").toLowerCase();
    for (const f in NAV_FAMILIES) {
      if (NAV_FAMILIES[f].some((d) => h === d || h.endsWith("." + d))) return f;
    }
    return null;
  }

  function curKey() { return watchKey(cleanHref(hereHref())); }

  // On sites whose watch pages we can tell apart (Hotstar, Netflix): a page
  // without a watch URL whose video is short (or missing) is the catalogue.
  // Anything long or live still syncs, whatever its URL looks like.
  function browsingNow() {
    const u = parseHref(hereHref());
    if (!u || !hostFamily(u.host)) return false;
    if (watchKey(cleanHref(hereHref()))) return false;
    const v = S.video;
    if (!v) return true;
    const d = v.duration;
    return !(d === Infinity || d >= TRAILER_MAX_S);
  }

  // is this message about another title than the one we're on?
  function otherTitle(m) {
    if (browsingNow()) return true;
    if (m && m.away) return true;
    const mine = curKey();
    const theirs = m && typeof m.k === "string" ? m.k : (S.friendKey || null);
    return !!(mine && theirs && mine !== theirs);
  }

  function noteFriendTitle(m) {
    if (!m) return;
    if (typeof m.k === "string") S.friendKey = m.k.slice(0, 200);
    if (m.t === "hb") S.friendAway = !!m.away;
    else if (typeof m.k === "string") S.friendAway = false;
    refreshSyncMode();
  }

  // "same" | "me" (we're in the catalogue) | "away" (they are) | "other" (different titles)
  function refreshSyncMode() {
    let mode = "same";
    if (browsingNow()) mode = "me";
    else if (S.friendAway) mode = "away";
    else {
      const mine = curKey();
      if (mine && S.friendKey && mine !== S.friendKey) mode = "other";
    }
    if (mode === (S.syncMode || "same")) return;
    const was = S.syncMode || "same";
    S.syncMode = mode;
    S.reconcileStreak = 0;
    if (mode !== "same") {
      // nothing to wait for on another title
      S.friendBuf = false;
      if (S.hold) endHold(true, null);
    }
    if (!isOpen()) return;
    const who = S.friendName || "Your friend";
    if (mode === "same") sysMsg("✅ Same video again – synced with " + who);
    else if (mode === "away") sysMsg("⏸ " + who + " is browsing – sync is paused until you're on the same video");
    else if (mode === "other") sysMsg("⏸ You and " + who + " are on different videos – sync is paused");
    else if (was === "same") sysMsg("⏸ You're browsing – sync is paused until you open the video");
    updateConnectedStatus();
  }

  function withKey(o) {
    const k = curKey();
    if (k) o.k = k;
    return o;
  }

  // v30: precise echo suppression. The old 400 ms "applyingRemote" window
  // also swallowed REAL clicks made right after a friend's action (friend
  // seeks, you press play 0.3 s later -> your play was never sent -> one side
  // playing, the other paused, forever - caught by the real-Chrome e2e test).
  // Now we remember exactly which change WE caused and ignore only that one
  // event (one-shot, 2.5 s max - streaming seeks can take a while).
  const ECHO_MS = 2500;
  function expectEcho(kind, val) {
    S.echo[kind] = { val, until: Date.now() + ECHO_MS };
  }
  function isEcho(kind, actual) {
    const e = S.echo[kind];
    if (!e || Date.now() > e.until) return false;
    // a seek may land a little off the requested time (keyframes), but a user
    // seek somewhere else entirely is never ours
    const hit = kind === "time" ? Math.abs(actual - e.val) < 2 : actual === e.val;
    if (hit) S.echo[kind] = null;
    return hit;
  }

  // v31: the user acted while we were waiting for the friend's buffering -
  // their choice wins for the rest of this buffering episode
  function userOverridesHold() {
    if (S.hold) endHold(false);
    if (S.friendBuf) S.holdIgnore = true;
  }

  function onPlayPause(e) {
    if (!isOpen()) return;
    const v = e.target;
    if (isEcho("paused", v.paused)) return;
    if (browsingNow() || freshNoise()) return; // v32: trailers / autoplay of a fresh player
    S.lastUserActAt = Date.now();
    userOverridesHold();
    if (!v.paused && S.remoteAt && !S.remotePaused && Date.now() - S.remoteAt < 10000 && (S.syncMode || "same") === "same") {
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
    send(withKey({ t: v.paused ? "pause" : "play", time: v.currentTime, from: S.name }));
    const label = v.paused ? "paused" : "playing";
    const icon  = v.paused ? "⏸️" : "▶️";
    activity(icon, `You ${label}`, v.currentTime, { local: true });
    syncSysMsg(`You ${v.paused ? "⏸ paused" : "▶ played"}`, v.currentTime);
    S._lastLocalTime = v.currentTime;
  }

  function onSeeked(e) {
    if (!isOpen()) return;
    const v = e.target;
    if (isEcho("time", v.currentTime)) { S._lastLocalTime = v.currentTime; return; }
    if (browsingNow() || freshNoise()) { S._lastLocalTime = v.currentTime; return; } // v32
    S.lastUserActAt = Date.now();
    userOverridesHold();
    const newTime = v.currentTime;
    send(withKey({ t: "seek", time: newTime, paused: v.paused, from: S.name }));
    const diff = newTime - (S._lastLocalTime || newTime);
    S._lastLocalTime = newTime;
    if (Math.abs(diff) > 1.0) {
      const label = diff > 0 ? `Skipped +${fmtTime(Math.abs(diff))}` : `Skipped -${fmtTime(Math.abs(diff))}`;
      const icon  = diff > 0 ? "⏭️" : "⏮️";
      activity(icon, `You ${label}`, newTime, { local: true });
      syncSysMsg(`You ${diff > 0 ? "⏩ skipped" : "⏪ skipped"} ${diff > 0 ? "+" : "-"}${fmtTime(Math.abs(diff))}`, newTime);
    } else {
      activity("⏭️", `You jumped to ${fmtTime(newTime)}`, newTime, { local: true });
      syncSysMsg(`You → ${fmtTime(newTime)}`, newTime);
    }
  }

  function onRateChange(e) {
    if (!isOpen()) return;
    if (isEcho("rate", e.target.playbackRate)) return;
    if (browsingNow() || freshNoise()) return; // v32
    S.lastUserActAt = Date.now();
    send(withKey({ t: "rate", r: e.target.playbackRate || 1, time: e.target.currentTime, from: S.name }));
  }

  // ---------- remote application ----------

  // only ever called for friend-driven / corrective seeks (never user seeks)
  function seekTo(v, t) {
    if (!isFinite(t) || t < 0) return;
    if (Math.abs(v.currentTime - t) < 0.25) return;
    expectEcho("time", t);
    try { v.currentTime = t; } catch (_) {}
  }

  // v30: remote play/pause go through these so their own events are ignored
  function remotePlay(v) {
    if (v.paused) expectEcho("paused", false);
    safePlay(v);
  }
  function remotePause(v) {
    if (!v.paused) { expectEcho("paused", true); v.pause(); }
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
    noteFriendTitle(m);
    const v = S.video;
    if (!v) return;
    // v32: another title (or one of us is in the catalogue) -> not ours to follow
    if (otherTitle(m)) return;
    // v32: a freshly loaded friend's state never moves a settled player or the host
    if (m.t === "state" && m.fresh && (S.role === "host" || !isFresh())) return;
    // v15: track friend's playback position for sync display
    const rt = num(m.time);
    if (rt !== null) { S.friendTime = rt; S.friendPaused = m.t === "pause" || m.paused === true; }
    // activity popup: who did what (initial state sync stays quiet)
    if (m.t === "play" || m.t === "pause" || m.t === "seek") {
      const who = String(m.from || "Friend").slice(0, 24);
      const t = num(m.time);
      const ts = isFinite(t) ? t : null;
      if (m.t === "play") {
        activity("▶️", `${who} played`, ts);
        syncSysMsg(`${who} ▶ played`, ts);
      } else if (m.t === "pause") {
        activity("⏸️", `${who} paused`, ts);
        syncSysMsg(`${who} ⏸ paused`, ts);
      } else {
        const diff = ts !== null ? ts - v.currentTime : 0;
        if (diff > 15) {
          activity("⏭️", `${who} skipped forward ${fmtTime(Math.abs(diff))}`, ts);
          syncSysMsg(`${who} ⏩ +${fmtTime(Math.abs(diff))}`, ts);
        } else if (diff < -15) {
          activity("⏮️", `${who} skipped back ${fmtTime(Math.abs(diff))}`, ts);
          syncSysMsg(`${who} ⏪ -${fmtTime(Math.abs(diff))}`, ts);
        } else if (Math.abs(diff) > 0.3) {
          activity("⏭️", `${who} jumped to ${fmtTime(ts)}`, ts);
          syncSysMsg(`${who} → ${fmtTime(ts)}`, ts);
        }
      }
    }
    // v31: the friend pressing play/pause ends any buffering wait (a seek
    // keeps it: we follow the seek and keep waiting for their video)
    if ((m.t === "play" || m.t === "pause") && S.hold) endHold(false);
    S.applyingRemote = true;
    clearTimeout(applyRemote._t);
    applyRemote._t = setTimeout(() => {
      S.applyingRemote = false;
    }, 400);
    S.lastRemoteActAt = Date.now();
    S.reconcileStreak = 0;
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
          if (m.paused) remotePause(v);
          else if (!S.hold) remotePlay(v); // v31: still waiting for their buffering
          break;
        case "seek":
          break;
        case "pause":
          remotePause(v);
          break;
        case "play":
          if (Math.abs(v.currentTime - time) > 1.2) seekTo(v, time);
          remotePlay(v);
          break;
        case "rate": {
          const rr = num(m.r);
          if (rr !== null && rr >= 0.25 && rr <= 4) {
            S.remoteRate = rr;
            if (v.playbackRate !== rr) expectEcho("rate", rr);
            try { v.playbackRate = rr; } catch (_) {}
          }
          break;
        }
      }
    } catch (_) {}
  }

  function pushState() {
    const v = S.video;
    if (!v || browsingNow()) return; // v32: a trailer is not the party's state
    const st = withKey({ t: "state", time: v.currentTime, paused: v.paused, from: S.name });
    if (isFresh()) st.fresh = true;  // v32: "I just loaded - don't follow me"
    send(st);
  }

  function driftCheck() {
    const v = S.video;
    if (!v || S.applyingRemote || !isOpen()) return;
    // v31: while either side is buffering, positions are frozen on purpose
    if (S.hold || S.bufSent || S.friendBuf) return;
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

  // v30: safety net. If play/pause or speed ever disagree with the host (a
  // lost or swallowed action), the GUEST adopts the host's state after two
  // heartbeats in a row (~8 s) - but never while either side just acted.
  function reconcileWithHost(m, t) {
    const v = S.video;
    if (S.role !== "guest" || !v || !isOpen()) { S.reconcileStreak = 0; return; }
    // v31: a buffering wait makes play/pause differ on purpose
    if (m.buf || m.hold || S.hold || S.bufSent || S.friendBuf) { S.reconcileStreak = 0; return; }
    const now = Date.now();
    const busy = now - (S.lastUserActAt || 0) < 4000 || now - (S.lastRemoteActAt || 0) < 4000;
    const hr = typeof m.r === "number" ? Math.min(4, Math.max(0.25, m.r)) : null;
    const pausedOff = !!m.paused !== !!v.paused;
    const rateOff = hr !== null && Math.abs((v.playbackRate || 1) - hr) > 0.01;
    if (busy || (!pausedOff && !rateOff)) { S.reconcileStreak = 0; return; }
    if (++S.reconcileStreak < 2) return;
    S.reconcileStreak = 0;
    S.lastRemoteActAt = now;
    if (rateOff) { expectEcho("rate", hr); try { v.playbackRate = hr; } catch (_) {} }
    if (pausedOff) {
      seekTo(v, t);
      if (m.paused) remotePause(v); else remotePlay(v);
    }
    sysMsg("🔄 Re-synced with " + (S.friendName || "host") + " (" + (m.paused ? "paused" : "playing") + (rateOff ? ", " + hr + "x" : "") + ")");
  }

  // v31: hello also says what we're watching, so a joining guest can go there
  function helloMsg() {
    const h = { t: "hello", name: S.name, v: EXT_VER };
    const ni = navInfo();
    if (ni) { h.at = ni.href; h.atTitle = ni.title; }
    return h;
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
      send(helloMsg());
    }
    const v = S.video;
    announceLive(); // v32: this tab holds the party
    refreshSyncMode();
    let hb;
    if (browsingNow()) {
      // v32: in the catalogue - keep the link warm, but a trailer's clock is nobody's business
      hb = { t: "hb", time: null, paused: true, r: 1, away: true, from: S.name };
    } else {
      hb = withKey({ t: "hb", time: v ? v.currentTime : null, paused: v ? v.paused : true, r: v ? (v.playbackRate || 1) : 1, from: S.name });
      if (isFresh()) hb.fresh = true; // v32: just loaded - not the party's clock yet
    }
    if (S.bufSent) hb.buf = true;   // v31: we're buffering
    if (S.hold) hb.hold = true;     // v31: we paused to wait for the friend
    send(hb);
    healVoice();
  }

  // ---------- v31: buffering hold ----------
  // When one side's video runs out of data (readyState below
  // HAVE_FUTURE_DATA while "playing") for 1.5 s, it tells the friend ("buf");
  // the friend pauses right there, and both resume together - from the same
  // spot - when that buffering ends. Before, the healthy side kept playing
  // and the drift check dragged the pair around: a buffering HOST even
  // rewound the guest by ~4 s on every heartbeat.
  const BUF_ARM_MS = 1500;
  const HOLD_MAX_MS = 45000;   // never wait for a friend's buffering longer

  function isStalled(v) {
    return !!v && !v.paused && !v.ended && typeof v.readyState === "number" && v.readyState < 3;
  }

  function bufTick() {
    const v = S.video;
    const now = Date.now();
    if (!isOpen()) { S.bufSince = 0; S.bufSent = false; return; }
    if (isStalled(v) && !browsingNow()) {
      if (!S.bufSince) S.bufSince = now;
      if (!S.bufSent && now - S.bufSince >= BUF_ARM_MS) {
        S.bufSent = true;
        send(withKey({ t: "buf", on: true, time: v.currentTime, from: S.name }));
      }
    } else {
      S.bufSince = 0;
      if (S.bufSent) {
        S.bufSent = false;
        send({ t: "buf", on: false, time: v ? v.currentTime : null, paused: v ? v.paused : true, from: S.name });
      }
      // our own buffering is over but the friend's isn't: wait for them now
      if (S.friendBuf && !S.holdIgnore && !S.hold && v && !v.paused) startHold();
    }
    if (S.hold && now - S.hold.since > HOLD_MAX_MS) {
      const who = S.friendName || "Your friend";
      S.holdIgnore = true;
      endHold(true, null);
      sysMsg("⏳ " + who + " is still buffering – playing on without them");
    }
  }

  function startHold() {
    const v = S.video;
    if (!v || v.paused || S.hold) return;
    S.hold = { since: Date.now() };
    remotePause(v);
    const who = S.friendName || "your friend";
    showBanner("hold", "⏳ Waiting for " + who + " – their video is buffering…",
      [{ label: "Play anyway", act: () => { userOverridesHold(); if (S.video) safePlay(S.video); } }]);
    sysMsg("⏳ Paused for " + who + " – their video is buffering");
  }

  // resume: carry on together from the friend's spot (t) or where we are
  function endHold(resume, t) {
    const h = S.hold;
    S.hold = null;
    hideBanner("hold");
    if (!h || !resume) return;
    const v = S.video;
    if (!v) return;
    const ft = num(t);
    if (ft !== null) seekTo(v, ft);
    remotePlay(v);
  }

  function onFriendBuf(m) {
    const on = !!m.on;
    // v32: their buffering on another title is no reason for us to stop
    if (on && otherTitle(m)) { S.friendBuf = false; return; }
    S.friendBuf = on;
    S.friendBufTime = num(m.time);
    S.holdIgnore = false;
    if (on) {
      const v = S.video;
      // if we're buffering too we wait for our own data first (bufTick)
      if (v && !v.paused && !isStalled(v)) startHold();
    } else if (S.hold) {
      endHold(m.paused !== true, m.time);
    }
  }

  // ---------- v31: banners (buffering wait, follow-the-friend) ----------
  function showBanner(kind, text, buttons) {
    if (!ui.root) return null;
    let box = ui.root.querySelector("#wt-banners");
    if (!box) {
      box = document.createElement("div");
      box.id = "wt-banners";
      ui.root.appendChild(box);
    }
    hideBanner(kind);
    const b = document.createElement("div");
    b.className = "wt-banner";
    b.dataset.kind = kind;
    const t = document.createElement("span");
    t.className = "wt-banner-text";
    t.textContent = text;
    b.appendChild(t);
    for (const x of buttons || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wt-banner-btn";
      btn.textContent = x.label;
      btn.addEventListener("click", (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        try { x.act(); } catch (_) {}
      });
      b.appendChild(btn);
    }
    box.appendChild(b);
    return b;
  }

  function findBanner(kind) {
    const box = ui.root && ui.root.querySelector("#wt-banners");
    if (!box) return null;
    for (const c of box.children) { if (c.dataset && c.dataset.kind === kind) return c; }
    return null;
  }

  function hideBanner(kind) {
    const b = findBanner(kind);
    if (b) { try { b.remove(); } catch (_) {} }
  }

  // ---------- v31: follow each other to the next episode ----------
  // We watch what page the video is on (site + path). When the friend moves
  // to another episode/title, we follow after a 5 s countdown (cancellable)
  // - the party itself survives the page load (it lives in storage).
  const FOLLOW_SECS = 5;
  const NAV_CONFLICT_MS = 8000;   // both picked something within this -> nobody is dragged
  const OFFER_SHOW_MS = 20000;    // v32: an untaken "Go there" offer leaves the screen
  const SLUG_SKIP = /^(in|en|us|uk|shows?|tv|movies?|watch|play|player|detail|dp|gp|video|tv-shows|series|episodes?|seasons?|region|eu|na|fe|title|browse)$/i;

  function parseHref(href) {
    const m = /^(https?):\/\/([^/?#:]+)(:\d{1,5})?([^?#]*)/i.exec(String(href || "").slice(0, 600));
    if (!m) return null;
    return { proto: m[1].toLowerCase(), host: m[2].toLowerCase(), port: m[3] || "", path: m[4] || "/" };
  }

  // origin + path only: the friend never gets our query string (tracking
  // ids, tokens) and we never follow theirs
  function cleanHref(href) {
    const u = parseHref(href);
    return u ? u.proto + "://" + u.host + u.port + u.path : "";
  }

  function onSupportedHost(host) {
    const h = String(host || "").replace(/^www\./, "");
    return SITE_HOSTS.some((d) => h === d || h.endsWith("." + d));
  }

  // "site + path" of a page that plays a title, or null for browse pages
  function watchKey(href) {
    const u = parseHref(href);
    if (!u || !onSupportedHost(u.host)) return null;
    let p = u.path.replace(/\/ref=[^/]*$/i, "").replace(/\/+$/, "");
    // v32: where the site has a content id, THAT is the title - the same
    // episode stays the same title whatever the rest of the URL looks like
    const fam = hostFamily(u.host);
    if (fam === "hotstar") {
      const m = /\/(\d{4,})\/watch$/i.exec(p);
      if (m) return "hotstar:" + m[1];
    } else if (fam === "netflix") {
      const m = /\/watch\/(\d+)/i.exec(p);
      if (m) return "netflix:" + m[1];
    }
    return legacyKey(href);
  }

  // v31's key (site + path): still sent as "prev" so a v1.31 friend can tell
  // we were on the same title
  function legacyKey(href) {
    const u = parseHref(href);
    if (!u || !onSupportedHost(u.host)) return null;
    const p = u.path.replace(/\/ref=[^/]*$/i, "").replace(/\/+$/, "");
    const isWatch = /\/watch(\/|$)/i.test(p) || /\/play\//i.test(p) || /\/detail\//i.test(p) ||
      (/^\/(movies|tv-shows)\//i.test(p) && p.split("/").length >= 4);
    if (!isWatch) return null;
    return u.host.replace(/^www\./, "") + p;
  }

  // "night-out" -> "Night Out"; Hotstar paths carry show + episode slugs
  function navLabel(href) {
    const u = parseHref(href);
    if (!u) return "";
    const segs = u.path.split("/").filter((s) => s && !SLUG_SKIP.test(s) && !/^[0-9]+$/.test(s) && !/^ref=/i.test(s) && /[a-z]/i.test(s) && s.length < 80);
    const nice = (s) => decodeURIComponentSafe(s).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
    if (!segs.length) return "";
    if (segs.length >= 2) return nice(segs[segs.length - 2]) + " · " + nice(segs[segs.length - 1]);
    return nice(segs[0]);
  }

  function decodeURIComponentSafe(s) {
    try { return decodeURIComponent(s); } catch (_) { return s; }
  }

  function hereHref() {
    try { return String(location.href || ""); } catch (_) { return ""; }
  }

  function navInfo() {
    const href = cleanHref(hereHref());
    const key = watchKey(href);
    if (!key) return null;
    let title = navLabel(href) || extractNowPlaying() || "";
    if (/^(netflix|hotstar|jiohotstar|disney\+ hotstar|prime video|jiocinema|jiotv)$/i.test(title.trim())) title = ""; // just the site's name
    return { href, key, title: title.slice(0, 120) };
  }

  // polled every second: SPA sites (Hotstar, Netflix) change episode without a page load
  function navTick() {
    const href = cleanHref(hereHref());
    const key = watchKey(href);
    if (key === S.navKey) return;
    const prevLegacy = S.navLegacy || null;
    S.navPrev = S.navKey;
    S.navKey = key;
    S.navLegacy = legacyKey(href);
    // arriving where we followed the friend to is not "our own pick"
    S.navChangedAt = key && key === S.navFollowKey ? 0 : Date.now();
    S.navFollowKey = null;
    if (S.follow && S.follow.key === key) cancelFollow(); // we got there ourselves
    if (key && S.offerKey === key) { S.offerKey = null; hideBanner("follow"); } // v32: went there by ourselves
    if (key && isOpen()) {
      const ni = navInfo();
      // prev = v31's format (a v1.31 friend compares it), pk = this version's
      send({ t: "nav", href: ni.href, key, prev: prevLegacy, pk: S.navPrev, title: ni.title, from: S.name });
    }
    // v32: on a new title WE are the newcomer: take the party's position if the
    // friend is already there, and never push this player's start-up noise
    if (key && S.roomId) { markFresh(); askState(); }
    // tell the friend at once whether our clock still counts
    refreshSyncMode();
    if (isOpen()) { S.lastHbSent = 0; sendHb(); }
  }

  // m: { href, key, title, prev } from the friend; auto = may follow on its own
  function offerFollow(m, auto) {
    const u = parseHref(m && m.href);
    if (!u || (u.proto !== "https" && u.proto !== "http")) return;
    const key = watchKey(m.href);
    if (!key || key === S.navKey) { cancelFollow(); return; }
    if (S.offered[key] || (S.follow && S.follow.key === key)) return; // already asked / counting down
    const target = u.proto + "://" + u.host + u.port + u.path; // no query: never carry the friend's tokens
    const who = S.friendName || String(m.from || "Your friend").slice(0, 24);
    const title = String(m.title || navLabel(m.href) || "another title").slice(0, 120);
    cancelFollow();
    const go = () => { cancelFollow(); S.navFollowKey = key; navigateTo(target); };
    if (!auto) {
      if (S.offered[key]) return;
      S.offered[key] = true;
      S.offerKey = key;
      showBanner("follow", "▶ " + who + " is watching " + title, [
        { label: "Go there", act: go },
        { label: "×", act: () => { S.offerKey = null; hideBanner("follow"); } },
      ]);
      sysMsg("▶ " + who + " is watching " + title + " – " + target);
      // v32: an offer nobody takes should not sit on the video forever (the chat keeps the link)
      setTimeout(() => {
        if (S.offerKey === key && !S.follow) { S.offerKey = null; hideBanner("follow"); }
      }, OFFER_SHOW_MS);
      return;
    }
    const f = S.follow = { key, target, left: FOLLOW_SECS, timer: null };
    const verb = m.joining ? " is watching " : " moved to ";
    const paint = () => {
      showBanner("follow", "▶ " + who + verb + title + " – " + (m.joining ? "going there" : "following") + " in " + f.left + "…", [
        { label: "Go now", act: go },
        { label: "Stay here", act: () => { cancelFollow(); S.offered[key] = true; sysMsg("Staying here – " + who + " is on " + title + ": " + target); } },
      ]);
    };
    paint();
    sysMsg("▶ " + who + verb + title);
    f.timer = setInterval(() => {
      if (S.follow !== f) { clearInterval(f.timer); return; }
      f.left -= 1;
      if (f.left <= 0) { go(); return; }
      paint();
    }, 1000);
  }

  function cancelFollow() {
    const f = S.follow;
    S.follow = null;
    if (f) clearInterval(f.timer);
    hideBanner("follow");
  }

  function navigateTo(url) {
    sysMsg("▶ Following…");
    try { location.assign(url); } catch (_) { try { location.href = url; } catch (__) {} }
  }

  // friend changed title mid-party
  function onFriendNav(m) {
    const key = watchKey(m && m.href);
    const mine = curKey();
    if (!key || key === mine) { if (key) { cancelFollow(); S.offerKey = null; hideBanner("follow"); } return; }
    // we were watching the same thing (or nothing) and didn't just pick something
    // ourselves -> follow automatically; otherwise only offer it
    // (pk = the friend's previous title in this version's format, prev = v1.31's)
    const together = !mine || (typeof m.pk === "string" ? mine === m.pk
      : (m.pk === undefined && legacyKey(cleanHref(hereHref())) === m.prev));
    const ownPick = S.navChangedAt && Date.now() - S.navChangedAt < NAV_CONFLICT_MS && !!S.navKey;
    offerFollow(m, together && !ownPick);
  }

  // first hello of a link: the guest goes where the host is (the host is
  // only offered the guest's title)
  function onFriendAt(m) {
    if (!m || !m.at) return;
    const key = watchKey(m.at);
    if (!key || key === S.navKey) return;
    const ownPick = S.navChangedAt && Date.now() - S.navChangedAt < NAV_CONFLICT_MS && !!S.navKey;
    offerFollow({ href: m.at, title: m.atTitle, from: m.name, joining: true }, S.role === "guest" && !ownPick);
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
    bufTick(); // v31: throttled background tabs still report buffering
    sendHb();
    reconnectPeer();
    tryHostDataRedial();
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

  // v14 LONG-SESSION FIX (the ~45 min drop): PeerJS cloud registrations decay
  // (NAT rebinding, broker socket death) and a half-dead data channel used to
  // strand whoever noticed first - the HOST just sat on "share the code again"
  // while the guest retried into a void, until somebody gave up and rejoined.
  // Three self-healing pieces:
  //   1. tryHostDataRedial  - the HOST actively re-offers the data link to the
  //      friend's last known peer id instead of waiting passively.
  //   2. CONNECT_TIMEOUT_MS - a dial that never opens is treated as a failure
  //      (zombie signaling), feeding the retry/hard-rejoin logic.
  //   3. maybeHardRejoin    - a guest whose dials keep failing rebuilds her
  //      whole peer registration WITHOUT touching panel/chat/history.
  function tryHostDataRedial() {
    if (S.role !== "host" || S.stopping || !S.peer || !S.roomId) return;
    if (isOpen()) return;
    if (!S.peer.open || S.peer.disconnected) return;
    const now = Date.now();
    if (S.hostRedialAt && now - S.hostRedialAt < 6000) return;
    S.hostRedialAt = now;
    setStatus("waiting", "Connection lost \u2013 restoring\u2026");
    connectToHost();
  }

  function maybeHardRejoin() {
    if (S.role !== "guest" || S.stopping || !S.roomId) return false;
    if (S.failStreak > 0 && S.failStreak % 5 !== 0) return false;
    const now = Date.now();
    if (now - S.lastHardRejoin < 15000) return false;
    S.lastHardRejoin = now;
    try { console.warn("WT: rebuilding peer registration (failStreak " + S.failStreak + ")"); } catch (_) {}
    teardownConn();
    try { if (S.peer) S.peer.destroy(); } catch (_) {}
    const p = new Peer({ debug: 0 });
    S.peer = p;
    p.on("open", () => { if (!isOpen()) connectToHost(); });
    wirePeer(p);
    setStatus("waiting", "Refreshing connection\u2026");
    return true;
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
        setStatus("waiting", "Connection lost \u2013 restoring\u2026");
        S.hostRedialAt = 0;
        tryHostDataRedial();
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
      a.volume = Math.min(1, S.voiceVol);
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
    // v27: a gesture also unlocks the voice-boost graph (the element covers
    // playback until then, so this never needs the tap pill)
    if (S.vb && S.vb.ctx && S.vb.ctx.state === "suspended") {
      try { Promise.resolve(S.vb.ctx.resume()).then(vbRouting, () => {}); } catch (_) {}
    }
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

  // v18: fullscreen support — reparent floating elements into the fullscreen container
  // so they remain visible when the video goes native fullscreen
  const FLOAT_SEL = "#wt-quick, #wt-float-msgs, #wt-qtype";
  function reparentFloats(target) {
    const root = target || document.documentElement;
    document.querySelectorAll(FLOAT_SEL).forEach((el) => {
      if (el.parentElement !== root) root.appendChild(el);
    });
  }
  function handleFullscreenChange() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl && fsEl !== document.documentElement) {
      reparentFloats(fsEl);
    } else {
      reparentFloats(document.documentElement);
    }
  }
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

  function applyVoiceVol(pct, save) {
    // v27: 0..200% - above 100% only the Web Audio boost path can deliver it
    const v = Math.min(VB_MAX_MANUAL, Math.max(0, Number(pct) || 0));
    S.voiceVol = v;
    const a = ui.root && ui.root.querySelector("#wt-remote-audio");
    if (a) {
      try { a.volume = Math.min(1, v); } catch (_) {}
    }
    applyVbGain();
    if (ui.volSlider) ui.volSlider.value = Math.round(v * 100);
    if (save) {
      try { chrome.storage.local.set({ wt_voice_vol: v }); } catch (_) {}
    }
  }

  // ---------- v27/v28: friend's voice auto-level + movie ducking ----------
  // The friend's remote stream plays through Web Audio:
  //   source -> gain (auto-level x manual slider) -> limiter -> makeup fix -> speakers
  // The <audio> element stays attached (Chrome only delivers remote WebRTC
  // audio to Web Audio while a media element holds the stream) but is muted
  // while the graph runs; if the AudioContext is suspended (no user gesture
  // yet) the element plays instead.
  // v28 - tuned on a real-Chrome rig (two headless Chromes, TTS voices on
  // fake mics at -20/-38/-48 dBFS, scored against the source recordings):
  //  - speech is detected RELATIVE TO THE FRIEND'S NOISE FLOOR (min-tracker)
  //    instead of a fixed -48 dBFS gate: a very quiet raw mic sat right on
  //    the old gate and only reached -26 dBFS through the old x8 cap
  //  - cap x16 (+24 dB), but their noise floor is never lifted above ~-54 dBFS
  //  - limiter threshold -4 dBFS with Chrome's automatic makeup gain cancelled
  //    (v27's -10 dB / 12:1 compressor leaned on that makeup gain for ~+4 dB)
  //  - the movie ducks while the friend talks, so they are not buried under it
  // v29: the rig showed v28 played an AGC-levelled voice (-20 dBFS) ~4 dB
  // QUIETER than v27 did (its makeup gain had been doing useful work against
  // the movie). Target raised so every voice lands around -17.5 dBFS.
  const VB_TARGET_RMS = 0.13;      // ~ -17.7 dBFS: speech that sits over a movie
  const VB_MAX_AUTO = 16;          // up to +24 dB for very quiet mics
  // speech detector, tuned on rig recordings: noise-suppressed room noise
  // spreads -73..-61 dBFS, a very quiet raw mic's speech sits at -47..-45 over
  // a -79 floor. Floor = 10th percentile of the last 5 s (a running minimum
  // got dragged down by noise-suppression dips and called hiss bursts speech)
  const VB_SPEECH_MIN = 0.00126;   // never call anything below -58 dBFS speech
  const VB_SPEECH_OVER_FLOOR = 6.3; // speech = at least +16 dB over their floor
  const VB_FLOOR_TICKS = 50;       // 5 s of 100 ms ticks
  const VB_NOISE_CEIL = 0.002;     // boosted noise floor stays <= ~-54 dBFS
  const VB_MAX_MANUAL = 2;         // slider goes to 200%
  const LIM_THRESHOLD = -4;
  const LIM_RATIO = 20;
  // Chrome's DynamicsCompressor auto-applies makeup gain of 0.6 x the gain
  // reduction it would apply to a 0 dBFS input - undo it so normal voices pass
  // at unity
  const LIM_MAKEUP_UNDO = Math.pow(10, -(0.6 * -LIM_THRESHOLD * (1 - 1 / LIM_RATIO)) / 20);
  const DUCK_LEVEL = 0.4;          // movie at 40% of its volume while they talk
  const DUCK_HOLD_MS = 900;        // back up after this much friend silence

  function vbContext() {
    if (S.vbCtx && S.vbCtx.state !== "closed") return S.vbCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (typeof AC !== "function") return null;
    try { S.vbCtx = new AC(); } catch (_) { S.vbCtx = null; }
    return S.vbCtx;
  }

  function vbRunning() {
    return !!(S.vb && S.vb.ctx && S.vb.ctx.state === "running");
  }

  // exactly one of (element, boost graph) is audible at any time
  function vbRouting() {
    const a = ui.root && ui.root.querySelector("#wt-remote-audio");
    if (!a) return;
    try { a.muted = vbRunning(); } catch (_) {}
  }

  function applyVbGain() {
    const vb = S.vb;
    if (!vb) return;
    const g = Math.max(0, vb.auto * S.voiceVol);
    const p = vb.gain.gain;
    try {
      if (typeof p.setTargetAtTime === "function") p.setTargetAtTime(g, vb.ctx.currentTime || 0, 0.08);
      else p.value = g;
    } catch (_) { try { p.value = g; } catch (__) {} }
    vb.applied = g;
  }

  // v31: the speaker icon glows while the friend is talking (so you can tell
  // "she's talking but quiet" from "nothing is arriving")
  function showTalking(on) {
    const w = ui.root && ui.root.querySelector("#wt-voice-wrap");
    if (w) w.classList.toggle("wt-talking", !!on);
    if (ui.pill) ui.pill.classList.toggle("wt-talking", !!on);
  }

  function teardownVoiceBoost() {
    const vb = S.vb;
    S.vb = null;
    unduck();
    showTalking(false);
    if (!vb) return;
    clearInterval(vb.timer);
    for (const n of [vb.src, vb.analyser, vb.gain, vb.comp, vb.fix, vb.post]) {
      try { if (n) n.disconnect(); } catch (_) {}
    }
    vbRouting();
  }

  function rmsOf(analyser, buf) {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  // ---- movie ducking ----
  // Lowers the movie while the friend talks and puts it back exactly where it
  // was. If the user (or the site) changes the volume meanwhile, we stop
  // touching it - their choice wins.
  function unduck() {
    const d = S.duck;
    S.duck = null;
    if (!d || !d.video) return;
    try {
      if (Math.abs(d.video.volume - d.set) < 0.02) d.video.volume = d.base;
    } catch (_) {}
  }

  function duckTick(speaking, now) {
    const v = S.video;
    if (S.duck && S.duck.video !== v) unduck();
    if (!v || S.duckOff) return;
    if (speaking) S.duckSpeechAt = now;
    const talking = now - (S.duckSpeechAt || 0) < DUCK_HOLD_MS;
    let d = S.duck;
    if (d && Math.abs(v.volume - d.set) > 0.02) { S.duck = null; return; } // user took over
    if (!d) {
      if (!talking || v.paused || v.muted || !(v.volume > 0.05)) return;
      d = S.duck = { video: v, base: v.volume, set: v.volume, f: 1 };
    }
    const target = talking && !v.paused ? DUCK_LEVEL : 1;
    // down fast (~0.2 s), up gently (~0.8 s)
    d.f += (target - d.f) * (target < d.f ? 0.5 : 0.15);
    if (target === 1 && d.f > 0.985) { unduck(); return; }
    const nv = Math.max(0, Math.min(1, d.base * d.f));
    try { v.volume = nv; d.set = v.volume; } catch (_) {}
  }

  function vbTick(vb) {
    if (S.vb !== vb) return;
    if (vb.ctx.state !== vb.lastState) { vb.lastState = vb.ctx.state; vbRouting(); }
    try {
      const rms = rmsOf(vb.analyser, vb.buf);
      vb.hist.push(rms);
      if (vb.hist.length > VB_FLOOR_TICKS) vb.hist.shift();
      const sorted = vb.hist.slice().sort((x, y) => x - y);
      vb.floor = Math.max(sorted[Math.floor((sorted.length - 1) * 0.1)], 1e-6);
      const loud = rms >= Math.max(VB_SPEECH_MIN, vb.floor * VB_SPEECH_OVER_FLOOR);
      vb.run = loud ? vb.run + 1 : 0;
      const speaking = vb.run >= 2; // two ticks in a row: no lone bursts
      if (speaking !== vb.speaking) showTalking(speaking);
      vb.speaking = speaking;
      duckTick(speaking, Date.now());
      if (!speaking) return; // silence / room noise: hold whatever gain we had
      vb.level = vb.level ? vb.level * 0.9 + rms * 0.1 : rms;
      let want = Math.min(VB_MAX_AUTO, Math.max(1, VB_TARGET_RMS / vb.level));
      want = Math.min(want, Math.max(1, VB_NOISE_CEIL / vb.floor));
      vb.auto += (want - vb.auto) * 0.2;
      applyVbGain();
      if (!vb.told && vb.auto >= 2.5) {
        vb.told = true;
        sysMsg("🔊 " + (S.friendName || "Friend") + "'s mic is quiet – auto-boosting their voice");
      }
    } catch (_) {}
  }

  function setupVoiceBoost(stream) {
    teardownVoiceBoost();
    const ctx = vbContext();
    if (!ctx || !stream) return;
    try {
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const gain = ctx.createGain();
      let comp = null, fix = null;
      if (typeof ctx.createDynamicsCompressor === "function") {
        // peak limiter: boosted speech must never clip or blast
        comp = ctx.createDynamicsCompressor();
        try {
          comp.threshold.value = LIM_THRESHOLD;
          comp.knee.value = 0;
          comp.ratio.value = LIM_RATIO;
          comp.attack.value = 0.002;
          comp.release.value = 0.12;
        } catch (_) {}
        fix = ctx.createGain();
        fix.gain.value = LIM_MAKEUP_UNDO;
      }
      const post = ctx.createAnalyser();
      post.fftSize = 1024;
      src.connect(analyser);
      src.connect(gain);
      let out = gain;
      if (comp) { gain.connect(comp); comp.connect(fix); out = fix; }
      out.connect(ctx.destination);
      out.connect(post);
      const vb = {
        ctx, src, analyser, gain, comp, fix, post,
        auto: 1, level: 0, floor: 0, hist: [], run: 0, speaking: false, applied: 1, told: false, lastState: ctx.state,
        buf: new Float32Array(analyser.fftSize), timer: null
      };
      S.vb = vb;
      applyVbGain();
      vb.timer = setInterval(() => vbTick(vb), 100);
      if (ctx.state !== "running") {
        try { Promise.resolve(ctx.resume()).then(vbRouting, () => {}); } catch (_) {}
      }
      vbRouting();
    } catch (e) {
      try { console.warn("WT: voice boost unavailable, using plain playback", e); } catch (_) {}
      teardownVoiceBoost();
    }
  }

  // v28: ONE switch for Chrome's full voice processing - echo cancellation +
  // noise suppression + auto gain (what Meet / Discord use). Echo
  // cancellation was forced OFF since v19 (blamed for "beeping" that was
  // really the v18-v21 redial storm). Without it, on laptop speakers each
  // side's mic sent the other's voice straight back (echo - and v27 then
  // boosted that echo of a quiet mic x8) plus their movie soundtrack. Chrome's
  // echo canceller also removes the movie playing in this browser from the
  // mic. NC off = raw mic, as an escape hatch.
  function micConstraints() {
    const on = !!S.nc;
    return {
      audio: {
        echoCancellation: on,
        noiseSuppression: on,
        autoGainControl: on,
        channelCount: 1
      }
    };
  }

  async function getMicStream() {
    if (S.micStream && S.micStream.active) return S.micStream;
    // v22: Chrome's native noise suppression follows the NC toggle (default
    // ON). Without it every fan/keyboard/room sound goes straight to the
    // friend's ears. NS was hard-disabled since v15 over "car engine"
    // artifacts - now it is user-controllable instead of forced.
    // v23: AGC follows NS as well. Chrome's NS attenuates the captured signal,
    // and with autoGainControl off (v15 choice) quiet laptop mics arrived
    // "clear but low" on the other side. AGC normalizes speech level back up.
    // v28: echo cancellation joins NS + AGC (see micConstraints)
    const stream = await navigator.mediaDevices.getUserMedia(micConstraints());
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
      b.title = S.nc ? "Voice processing ON (echo + noise cancellation, auto level) \u2013 click for raw mic" : "Voice processing OFF (raw mic) \u2013 click to turn echo + noise cancellation on";
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
        // v22/v23/v28: EC+NS+AGC follow the toggle live when Chrome allows it;
        // if it silently keeps the old processing, rebuild the mic below
        const want = micConstraints().audio;
        await track.applyConstraints({ echoCancellation: want.echoCancellation, noiseSuppression: want.noiseSuppression, autoGainControl: want.autoGainControl });
        const got = typeof track.getSettings === "function" ? track.getSettings() : null;
        applied = !got || got.echoCancellation === undefined || got.echoCancellation === want.echoCancellation;
      } catch (_) {}
    }
    if (!applied) {
      // fallback: rebuild the stream from scratch with new constraints
      try {
        stopGate();
        for (const t of stream.getTracks()) { try { t.stop(); } catch (_) {} }
        const fresh = await navigator.mediaDevices.getUserMedia(micConstraints());
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

  async function hotSwapMicTrack(stream) {
    // v12: resolves TRUE only if a slot was actually claimed. Callers use this
    // to trigger a one-shot re-dial fallback instead of trusting a silent
    // failure that leaves one side permanently mute on the wire.
    // v26: replaceTrack() is ASYNC - Chrome only updates sender.track once its
    // promise resolves. The old code checked sender.track synchronously, saw
    // the old track, reported failure and tore the whole line down on EVERY
    // mic-on (the "redial storm" behind the garbled/beeping voice bugs).
    try {
      const pc = S.voiceConn && S.voiceConn.peerConnection;
      if (!pc || typeof pc.getSenders !== "function") return false;
      const nt = stream && stream.getAudioTracks()[0] || null;
      const senders = pc.getSenders();
      const targets = senders.filter((s) => s.track && s.track.kind === "audio" && typeof s.replaceTrack === "function");
      // v11: our voice lines are AUDIO-ONLY, so an empty sender slot is still
      // the mic slot. Needed after a mute left the sender trackless.
      if (!targets.length && nt) {
        const empty = senders.find((s) => !s.track && typeof s.replaceTrack === "function");
        if (empty) targets.push(empty);
      }
      if (!targets.length && nt && typeof pc.getTransceivers === "function") {
        for (const tr of pc.getTransceivers()) {
          const kind = (tr.receiver && tr.receiver.track && tr.receiver.track.kind) || tr.mid;
          if (kind === "audio" && tr.sender && typeof tr.sender.replaceTrack === "function") { targets.push(tr.sender); break; }
        }
      }
      if (!targets.length) return !nt; // muting with no claimable slot is harmless
      let landed = false;
      for (const s of targets) {
        try {
          if (s.track !== nt) await s.replaceTrack(nt);
          if (s.track === nt) landed = true;
        } catch (_) {}
      }
      return !nt || landed;
    } catch (_) { return false; }
  }

  // v26: fire-and-forget swap with the old "re-dial once if it really failed"
  // fallback, ignoring results for a line that was replaced meanwhile.
  function swapMicOrRedial(stream, reason) {
    const line = S.voiceConn;
    hotSwapMicTrack(stream).then((ok) => {
      if (!ok && line && S.voiceConn === line) requestVoiceRedial(reason);
    });
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
    // v15: gate DISABLED — the rapid mute/unmute cycle (every 120ms tick)
    // creates exactly the "car engine" warble artifact the user hears.
    // With NS+AGC off at the constraint level, the raw mic is clean enough.
    return;
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

  // v19: replace entire Opus fmtp line. Chrome defaults (~24kbps VBR + DTX)
  // produce swirl artifacts and garbled voice. We force mono CBR 128kbps,
  // no DTX, no stereo mismatch with the mono mic capture.
  function mungeOpus(sdp) {
    try {
      if (!sdp) return sdp;
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
          // v28: 64 kbps VBR + in-band FEC. v19's 128 kbps CBR was 2x what
          // mono speech needs and fragile on congested mobile links (Jio).
          return "a=fmtp:" + pt + " minptime=10; useinbandfec=1; stereo=0; sprop-stereo=0; maxaveragebitrate=64000; usedtx=0";
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
    sysMsg(S.nc ? "\ud83c\udfa7 Echo + noise cancellation ON" : "\ud83d\udd07\ud83c\udfa4 Echo + noise cancellation OFF (raw mic)");
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
    S.voiceAttachedAt = Date.now();
    S.voiceGotStream = false;
    // v21: immediate hot-swap so the mic track lands on the wire right away.
    // The 5-second debounce inside requestVoiceRedial prevents a redial storm
    // if senders aren't ready yet (rare edge-case on slow ICE).
    try {
      if (S.micEnabled && S.micStream && S.micStream.active) swapMicOrRedial(S.micStream, "attach-reconcile");
      else if (!S.micEnabled) hotSwapMicTrack(null);
    } catch (_) {}
    clampVoiceJitter(call);
    call.on("stream", (remote) => {
      if (S.voiceConn === call) S.voiceGotStream = true;
      const a = ensureRemoteAudio();
      wireVoiceResume();
      a.srcObject = remote;
      setupVoiceBoost(remote); // v27: auto-level + up to 200% manual
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

  // ---------- v26: voice calls signaled over our own data link ----------
  // PeerJS media calls are signaled through the PeerJS cloud server, which
  // ad blockers / flaky Wi-Fi can cut while the P2P data link keeps working
  // (sync + chat fine, voice dead) - and Direct mode had no voice at all.
  // Now the offer/answer/ICE ride the data link itself ("voffer", "vanswer",
  // "vice", "vbye"). The call object mimics the PeerJS MediaConnection bits
  // attachVoiceCall uses: peerConnection, on(), close().
  function verAtLeast(v, min) {
    const a = String(v || "").split(".").map((x) => parseInt(x, 10) || 0);
    const b = String(min).split(".").map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return true;
  }

  function useDcVoice() {
    return S.directMode || verAtLeast(S.friendVer, DC_VOICE_MIN_VER);
  }

  function makeDcCall(id) {
    const h = {};
    const call = {
      __wtDc: true,
      id,
      peerConnection: null,
      open: false,
      remote: null,
      closed: false,
      remoteSet: false,
      iceQ: [],
      on(t, f) {
        (h[t] = h[t] || []).push(f);
        // ontrack can fire before attachVoiceCall subscribes (answer side)
        if (t === "stream" && call.remote) { try { f(call.remote); } catch (_) {} }
      },
      emit(t, x) {
        (h[t] || []).slice().forEach((f) => { try { f(x); } catch (_) {} });
      },
      close() { finish(true); },
      remoteBye() { finish(false); },
      addIce(c) {
        if (!c || call.closed) return;
        if (!call.remoteSet) { call.iceQ.push(c); return; }
        try { Promise.resolve(call.peerConnection.addIceCandidate(c)).catch(() => {}); } catch (_) {}
      },
      async setRemote(desc) {
        await call.peerConnection.setRemoteDescription(desc);
        call.remoteSet = true;
        for (const c of call.iceQ.splice(0)) {
          try { await call.peerConnection.addIceCandidate(c); } catch (_) {}
        }
      }
    };
    function finish(notify) {
      if (call.closed) return;
      call.closed = true;
      call.open = false;
      if (S.dcCalls[id] === call) delete S.dcCalls[id];
      if (notify) send({ t: "vbye", id });
      try { call.peerConnection.close(); } catch (_) {}
      call.emit("close");
    }
    const pc = new RTCPeerConnection(VOICE_ICE);
    call.peerConnection = pc;
    pc.onicecandidate = (e) => {
      if (!e || !e.candidate || call.closed) return;
      const c = typeof e.candidate.toJSON === "function" ? e.candidate.toJSON() : e.candidate;
      send({ t: "vice", id, c });
    };
    pc.ontrack = (e) => {
      if (call.remote || call.closed) return;
      let st = e && e.streams && e.streams[0];
      if (!st && e && e.track && typeof MediaStream === "function") {
        try { st = new MediaStream([e.track]); } catch (_) {}
      }
      if (!st) return;
      call.remote = st;
      call.emit("stream", st);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") call.open = true;
      else if (st === "failed") { call.emit("error", new Error("voice ICE failed")); finish(true); }
    };
    S.dcCalls[id] = call;
    return call;
  }

  function firstAudioTrack(stream) {
    try { return (stream && typeof stream.getAudioTracks === "function" && stream.getAudioTracks()[0]) || null; }
    catch (_) { return null; }
  }

  function dialDcCall(stream) {
    const id = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const call = makeDcCall(id);
    const pc = call.peerConnection;
    const t = firstAudioTrack(stream);
    if (t) pc.addTrack(t, stream);
    // no mic and no silent track: still reserve a sendrecv slot so a mic can
    // be attached later with replaceTrack() (no renegotiation)
    else if (typeof pc.addTransceiver === "function") pc.addTransceiver("audio", { direction: "sendrecv" });
    (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (call.closed) return;
        send({ t: "voffer", id, sdp: pc.localDescription.sdp });
      } catch (e) {
        try { console.warn("WT: voice offer failed", e); } catch (_) {}
        call.close();
      }
    })();
    return call;
  }

  async function answerDcCall(m) {
    const id = String(m.id || "").slice(0, 40);
    if (!id || typeof m.sdp !== "string" || S.dcCalls[id]) return;
    let call;
    try {
      call = makeDcCall(id);
      const pc = call.peerConnection;
      await call.setRemote({ type: "offer", sdp: m.sdp });
      await ensureMicIfWanted();
      if (call.closed) return;
      const stream = getAnswerStream();
      const t = firstAudioTrack(stream);
      if (t) pc.addTrack(t, stream);
      // v11 rule carried over: ALWAYS answer with a sendrecv audio slot so
      // either side can attach their mic later without renegotiation
      if (typeof pc.getTransceivers === "function") {
        for (const tr of pc.getTransceivers()) {
          try { if (tr.direction !== "sendrecv") tr.direction = "sendrecv"; } catch (_) {}
        }
      }
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      if (call.closed) return;
      send({ t: "vanswer", id, sdp: pc.localDescription.sdp });
      attachVoiceCall(call);
    } catch (e) {
      try { console.warn("WT: voice answer failed", e); } catch (_) {}
      if (call) call.close();
      sysMsg("⚠ Voice link glitch – toggle 🎤 to retry");
    }
  }

  // half-negotiated calls die with the data link that was signaling them
  function dropAllDcCalls() {
    for (const id of Object.keys(S.dcCalls)) {
      try { S.dcCalls[id].remoteBye(); } catch (_) {}
    }
  }

  // v26: a voice line that died (ICE failure, Wi-Fi blip, friend's tab
  // reloaded) used to stay dead until somebody toggled their mic. The host
  // now re-dials on its own from the heartbeat.
  function healVoice() {
    if (S.role !== "host" || S.stopping || !isOpen()) return;
    if (!(S.micEnabled || S.friendVoiceOn)) return;
    const now = Date.now();
    const c = S.voiceConn;
    if (c) {
      const st = c.peerConnection && c.peerConnection.connectionState;
      const dead = st === "failed" || st === "closed";
      const silent = !S.voiceGotStream && now - (S.voiceAttachedAt || now) > 15000;
      if (!dead && !silent) return;
    }
    if (now - (S.voiceHealAt || 0) < 8000) return;
    S.voiceHealAt = now;
    try { console.warn("WT: voice line down - re-dialing"); } catch (_) {}
    endVoiceCall();
    doSyncVoice();
  }

  function micErrorText(e) {
    const n = e && e.name;
    if (n === "NotAllowedError" || n === "SecurityError") {
      return "🎤 Mic blocked for this site – click the icon left of the address bar → Microphone → Allow, then tap 🎤 again";
    }
    if (n === "NotFoundError" || n === "OverconstrainedError") {
      return "🎤 No microphone found – check Windows sound settings";
    }
    if (n === "NotReadableError" || n === "AbortError") {
      return "🎤 Mic is busy in another app (Zoom / Teams / Discord?) – close it and tap 🎤 again";
    }
    return "Microphone blocked – check site permissions";
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
      if (S.voiceConn) swapMicOrRedial(S.micStream, "ensure-mic");
      if (!!S.nc) startGate();
    } catch (e) {
      try { console.warn("WT: mic restore failed", e); } catch (_) {}
    }
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
    if (!isOpen() || S.voiceConn) return;
    if (useDcVoice()) {
      try { attachVoiceCall(dialDcCall(stream)); } catch (e) {
        try { console.warn("WT: voice dial failed", e); } catch (_) {}
      }
      return;
    }
    // legacy path for friends on builds older than v1.26 (PeerJS media call)
    if (!S.peer) return;
    try {
      const call = S.peer.call(S.conn.peer, stream);
      if (call) attachVoiceCall(call);
    } catch (_) {}
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
    if (!isOpen()) {
      sysMsg("Not connected \u2013 cannot use voice");
      return;
    }
    // v26: a first-time mic prompt can sit unnoticed in the address bar
    // (especially over a fullscreen player) - point at it instead of
    // silently waiting forever.
    const promptHint = setTimeout(() => {
      sysMsg("\ud83c\udfa4 Click \u201cAllow\u201d on the microphone prompt at the top of the browser");
    }, 2500);
    try {
      await getMicStream();
      clearTimeout(promptHint);
      watchMicStream(S.micStream);
      S.micEnabled = true;
      setMicUi(true);
      saveMicState(true);
      // v21: if a line is already open (e.g. we answered with the silent
      // track), attach the live mic to it instead of tearing it down.
      if (S.voiceConn) swapMicOrRedial(S.micStream, "toggle-on");
      if (!!S.nc) startGate();
      notifyVoiceState();
      syncVoice();
      sysMsg("Microphone on \ud83c\udf99\ufe0f");
    } catch (e) {
      clearTimeout(promptHint);
      S.micEnabled = false;
      setMicUi(false);
      sysMsg(micErrorText(e));
    }
  }

  // ---------- peer lifecycle ----------

  function startParty(party) {
    stopParty();
    S.role = party.role;
    S.roomId = String(party.id || "").toUpperCase();
    S.name = String(party.name || (party.role === "host" ? "Host" : "Guest")).slice(0, 24);
    S.retries = 0;
    S.friendPid = null;
    S.failStreak = 0;
    S.hostRedialAt = 0;
    S.lastHardRejoin = 0;
    clearTimeout(S.connOpenTimer);
    S.connOpenTimer = null;
    S.friendVoiceOn = null;
    S.friendVer = null; // v26: decides the voice signaling path - per party
    S.directMode = false;
    S.friendTime = 0;
    S.friendPaused = true;
    S._lastLocalTime = 0;
    // restore last-session mic choice
    try {
      chrome.storage.local.get("wt_mic_state").then((r) => {
        if (r.wt_mic_state) S.micEnabled = true;
      });
    } catch (_) {}
    ensureUi();
    chatLog = [];
    restoreChat(S.roomId); // v31: conversation survives the page load
    showUi(true);
    updatePanel();
    alStart(S.roomId); // v30: backup route (only used if PeerJS can't link us)

    try {
      if (party.role === "host") {
        const p = new Peer(PEER_PREFIX + S.roomId, { debug: 0 });
        S.peer = p;
        p.on("open", () => setStatus("waiting", "Waiting for your friend\u2026"));
        p.on("connection", acceptIncoming);
        wirePeer(p);
      } else {
        const p = new Peer({ debug: 0 });
        S.peer = p;
        p.on("open", () => connectToHost());
        // v14: guests accept inbound re-offers too. Recovery used to be
        // single-direction (guest dials, host waits); with BOTH sides able to
        // heal, a simultaneous re-dial can't leave one side talking to a dead
        // socket - extra connections are closed when a line is already open.
        p.on("connection", acceptIncoming);
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
    if (yielding()) { scheduleRetry(); return; } // v32: stand by while our other tab is linked
    teardownConn();
    let c;
    try {
      c = S.peer.connect(PEER_PREFIX + S.roomId, { reliable: true });
    } catch (e) {
      scheduleRetry();
      return;
    }
    // v26: PeerJS returns undefined (no throw) while its server is
    // unreachable - the old code crashed on c.on() and stopped retrying
    if (!c) { scheduleRetry(); return; }
    attachConn(c);
    // v14: if this dial never opens, the signaling path is a zombie - count
    // the failure and fall back to retry / hard-rejoin instead of hanging.
    clearTimeout(S.connOpenTimer);
    S.connOpenTimer = setTimeout(() => {
      if (S.stopping || isOpen()) return;
      try { console.warn("WT: data dial timed out"); } catch (_) {}
      S.failStreak++;
      const rebuilt = maybeHardRejoin();
      if (!rebuilt && !S.stopping) {
        if (S.role === "host") { S.hostRedialAt = 0; tryHostDataRedial(); }
        else scheduleRetry();
      }
    }, CONNECT_TIMEOUT_MS);
  }

  function scheduleRetry() {
    if (S.role !== "guest" || S.stopping) return;
    clearTimeout(S.retryTimer);
    // retry forever while the party is active; slow down after the first burst
    const delay = S.retries >= MAX_GUEST_RETRIES ? 8000 : GUEST_RETRY_MS;
    S.retryTimer = setTimeout(() => {
      if (!S.peer || S.stopping) return;
      S.retries++;
      if (!isOpen()) {
        S.failStreak++;
        const rebuilt = maybeHardRejoin();
        if (!rebuilt) connectToHost();
      }
    }, delay);
  }

  // v30: a friend who re-dials while we still think the old link is up has
  // already lost it (Wi-Fi blip, crashed/reloaded tab). We used to refuse them
  // until ICE gave up on the dead link - ~40 s of "Connection lost" in the
  // real-Chrome e2e test. Same friend (or a silent link) -> replace it now.
  function acceptIncoming(c) {
    if (!c) return;
    if (!isOpen()) { attachConn(c); return; }
    const sameFriend = !!(c.peer && S.friendPid && String(c.peer) === S.friendPid);
    const silent = Date.now() - (S.lastRxAt || 0) > 6000;
    if (!sameFriend && !silent) {
      try { c.close(); } catch (_) {}
      return;
    }
    try { console.warn("WT: friend re-dialed - replacing the old link"); } catch (_) {}
    const old = S.conn;
    detachConn();
    try { if (old) old.close(); } catch (_) {}
    stopHb();
    endVoiceCall();
    dropAllDcCalls();
    if (S.directMode) { closeDirectPC(); S.directMode = false; }
    attachConn(c);
  }

  function handleErr(err) {
    const type = err && err.type;
    // v30: the PeerJS server only brokers NEW links. Losing it while the party
    // link is up changes nothing for the user - it used to flip the panel to
    // "Network hiccup - waiting..." over a perfectly working party.
    if (isOpen() && type !== "unavailable-id") {
      try { console.warn("WT: signaling server issue while connected (" + type + ") - ignored"); } catch (_) {}
      return;
    }
    if (type === "peer-unavailable") {
      S.netErrStreak = 0;
      setStatus("waiting", S.role === "host" ? "Friend unreachable \u2013 restoring\u2026" : "Room not found \u2013 waiting for host\u2026");
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
    try { if (c && c.peer) S.friendPid = String(c.peer); } catch (_) {}
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
    clearTimeout(S.connOpenTimer);
    S.connOpenTimer = null;
    if (c) {
      try { c.close(); } catch (_) {}
    }
  }

  function onConnOpen() {
    S.retries = 0;
    S.failStreak = 0;
    S.helloStateSent = false;
    S.netErrStreak = 0;
    S.reconnecting = false;
    clearTimeout(S.retryTimer);
    clearTimeout(S.connOpenTimer);
    touchRx();
    S.atDone = false; // v31: compare titles on this link's first hello
    S.triviaShared = false; // v33: share our trivia once on every new link
    // v32: nothing known about the friend's title yet; a page that only just
    // loaded (reload, follow) is the newcomer on this link
    S.friendKey = null; S.friendAway = false; S.syncMode = "same"; S.askedAt = 0;
    // (only on this page's FIRST link: when the friend reloads 20 s after we
    // loaded, they are the newcomer, not us - caught by the real-Chrome test)
    const firstLink = !S.everOpen;
    S.everOpen = true;
    if (firstLink && pageYoung()) markFresh();
    setStatus("connected", "Playback synced");
    sysMsg(S.role === "host" ? "Your friend connected" : "Connected to your friend");
    if (S.role === "guest") send(helloMsg());
    else { pushState(); if (isFresh()) askState(); }
    if (S.role === "guest") notifyVoiceState();
    else syncVoice();
    startHb();
  }

  function onConnClose() {
    stopHb();
    endVoiceCall();
    dropAllDcCalls();
    S.friendVoiceOn = null;
    if (S.directMode) { cleanupLinkPC(); closeDirectPC(); }
    S.conn = null;
    S.friendName = null;
    hideTyping();
    // v31: no friend, no buffering wait (we stay paused where we are)
    S.friendBuf = false;
    S.bufSent = false;
    S.bufSince = 0;
    if (S.hold) endHold(false);
    S.friendKey = null; S.friendAway = false; S.syncMode = "same"; // v32
    if (S.stopping) return;
    if (S.role === "guest") {
      setStatus("waiting", "Connection lost \u2013 reconnecting\u2026");
      scheduleRetry();
    } else {
      // v14: never strand the host - actively re-offer the data link
      setStatus("waiting", "Connection lost \u2013 restoring\u2026");
      S.hostRedialAt = 0;
      tryHostDataRedial();
    }
  }

  function stopParty() {
    S.stopping = true;
    alStop();
    clearTimeout(S.retryTimer);
    clearTimeout(S.connOpenTimer);
    S.connOpenTimer = null;
    S.failStreak = 0;
    S.friendPid = null;
    stopHb();
    S.directMode = false;
    cleanupLinkPC();
    closeDirectPC();
    S.friendVoiceOn = null;
    S.friendTime = 0;
    S.friendPaused = true;
    S._lastLocalTime = 0;
    S._lastLocalActionAt = 0;
    // v31
    if (S.hold) endHold(false);
    S.friendBuf = false; S.bufSent = false; S.bufSince = 0; S.holdIgnore = false;
    cancelFollow();
    S.offered = {};
    stopMic();
    teardownVoiceBoost();
    // v26: data-link voice calls are not owned by the Peer, so destroying the
    // Peer below no longer closes them - end them explicitly
    endVoiceCall();
    dropAllDcCalls();
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
            // v31: say WHO is behind and where the update is
            const fw = String(m.name || S.friendName || "Your friend").slice(0, 24);
            if (verAtLeast(hv, EXT_VER)) {
              sysMsg("\u26a0 " + fw + " has a newer version (v" + hv + ", you have v" + EXT_VER + ") \u2013 update: " + UPDATE_URL);
            } else {
              sysMsg("\u26a0 " + fw + " is on an older version (v" + hv + ", you have v" + EXT_VER + ") \u2013 send them the update: " + UPDATE_URL);
            }
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
          send(helloMsg());
          // full state only on the first hello of a connection; later hellos
          // are just name/version refreshers and must not fight playback
          if (!S.helloStateSent) {
            S.helloStateSent = true;
            pushState();
          }
          // v26: a line dialed before we knew the friend's build went over
          // PeerJS - move it onto the data link now that we know they can
          if (S.voiceConn && !S.voiceConn.__wtDc && useDcVoice()) {
            endVoiceCall();
            syncVoice();
          }
        } else {
          const who2 = String(m.name || "").slice(0, 24);
          if (who2 && who2 !== S.friendName) {
            S.friendName = who2;
          }
        }
        if (m.at) { const fk = watchKey(m.at); if (fk) S.friendKey = fk; } // v32
        refreshSyncMode();
        updateConnectedStatus();
        if (!S.atDone) { S.atDone = true; onFriendAt(m); } // v31
        break;
      case "buf": // v31: friend's video is (no longer) buffering
        noteFriendTitle(m);
        onFriendBuf(m);
        break;
      case "nav": { // v31: friend moved to another episode / title
        const fk = watchKey(m.href);
        if (fk) { S.friendKey = fk; S.friendAway = false; }
        refreshSyncMode();
        onFriendNav(m);
        break;
      }
      case "state":
      case "seek":
      case "play":
      case "pause":
      case "rate":
        applyRemote(m);
        break;
      case "hb": {
        noteFriendTitle(m); // v32
        // v31: heartbeats repeat the buffering flag (self-heals a lost "buf")
        if (!!m.buf !== !!S.friendBuf) onFriendBuf({ on: !!m.buf, time: m.time, paused: m.paused });
        const t = num(m.time);
        // v32: only a clock on OUR title counts, and a freshly loaded friend's
        // clock is not the party's yet (unless we're the guest and just as new)
        const lead = !m.fresh || (S.role === "guest" && isFresh());
        if (t !== null && lead && !otherTitle(m)) {
          // A stalled player keeps broadcasting a frozen timestamp; never let
          // heartbeats rewind the pair - only explicit actions do that.
          const back = t < S.remoteTime - 2 && !m.paused && !!S.remoteAt;
          if (!back) {
            S.remoteTime = t;
            S.remotePaused = !!m.paused;
            S.remoteAt = Date.now();
            if (typeof m.r === "number") S.remoteRate = Math.min(4, Math.max(0.25, m.r));
            // v15: only update display time when remoteTime is accepted
            S.friendTime = t;
            S.friendPaused = !!m.paused;
            reconcileWithHost(m, t);
          } else {
            // frozen heartbeat while claiming to play: ignore completely
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
      // v26: voice signaling over the data link
      case "voffer":
        answerDcCall(m);
        break;
      case "vanswer": {
        const vc = S.dcCalls[String(m.id || "")];
        if (vc && typeof m.sdp === "string") {
          vc.setRemote({ type: "answer", sdp: m.sdp }).catch((e) => {
            try { console.warn("WT: voice answer rejected", e); } catch (_) {}
            vc.close();
          });
        }
        break;
      }
      case "vice": {
        const vc = S.dcCalls[String(m.id || "")];
        if (vc) vc.addIce(m.c);
        break;
      }
      case "vbye": {
        const vc = S.dcCalls[String(m.id || "")];
        if (vc) vc.remoteBye();
        break;
      }
      case "trivia": // v33: friend's AI trivia for the title we're both on
        onFriendTrivia(m);
        break;
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
      '<button id="wt-trivia-btn" type="button" title="AI trivia">\ud83e\udde0</button>' +
      '<button id="wt-code" title="Copy code">\u2013\u2013\u2013\u2013\u2013\u2013</button>' +
      '<button id="wt-close" title="Hide">\u00d7</button>' +
      "</div>" +
      '<div id="wt-now" class="wt-now"></div>' +
      '<div class="wt-statusline"><span class="wt-dot"></span><span id="wt-status-text">Idle</span>' +
      '<span id="wt-voice-wrap" title="Friend\'s voice volume (auto-boost on, up to 200%)">\ud83d\udd0a<input id="wt-voice-vol" type="range" min="0" max="200" value="100" /></span></div>' +
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
      "</div>" +
      '<div id="wt-float-msgs"></div>' +
      '<div id="wt-quick" class="wt-quick">' +
      '<div id="wt-quick-bar"></div>' +
      '<form id="wt-qtype-form" class="wt-qtype-form">' +
      '<input id="wt-qtype-input" maxlength="300" placeholder="Say something\u2026" autocomplete="off" />' +
      "</form>" +
      '<div id="wt-qtype-picker" class="wt-qtype-picker wt-hide">' +
      '<input id="wt-qtype-emoji-search" maxlength="40" placeholder="Search emojis\ud83d\udd0d" autocomplete="off" />' +
      '<div id="wt-qtype-emoji-grid"></div>' +
      "</div>" +
      "</div>";
    document.documentElement.appendChild(ui.root);
    // v16: move float-msgs and quick bar OUTSIDE #wt-root so they don't overlap chat panel
    const detachedFloats = ui.root.querySelector("#wt-float-msgs");
    const detachedQuick = ui.root.querySelector("#wt-quick");
    if (detachedFloats) document.documentElement.appendChild(detachedFloats);
    if (detachedQuick) document.documentElement.appendChild(detachedQuick);
    // v17: quick-type overlay (press T or / to chat instantly)
    const qtypeEl = document.createElement("div");
    qtypeEl.id = "wt-qtype";
    qtypeEl.className = "wt-hide";
    qtypeEl.innerHTML =
      '<div id="wt-qtype-bar">' +
      '<span id="wt-qtype-icon">\ud83d\udcac</span>' +
      '<input id="wt-qtype-overlay-input" maxlength="300" placeholder="Say something\u2026" autocomplete="off" />' +
      '<span id="wt-qtype-hint">Enter \u21b5</span>' +
      "</div>";
    document.documentElement.appendChild(qtypeEl);
    ui.qtype = qtypeEl;
    ui.qtypeInput = qtypeEl.querySelector("#wt-qtype-overlay-input");
    qtypeEl.addEventListener("click", (e) => {
      if (e.target === ui.qtype) { try { e.preventDefault(); } catch (_) {} hideQtype(); }
    });

    ui.pill = ui.root.querySelector("#wt-pill");
    ui.panel = ui.root.querySelector("#wt-panel");
    ui.msgs = ui.root.querySelector("#wt-msgs");
    ui.input = ui.root.querySelector("#wt-input");
    ui.toasts = ui.root.querySelector("#wt-toasts");
    ui.typing = ui.root.querySelector("#wt-typing");
    ui.volSlider = ui.root.querySelector("#wt-voice-vol");
    ui.floatMsgs = document.querySelector("#wt-float-msgs");

    ui.input.addEventListener("input", sendTyping);

    ui.volSlider.addEventListener("input", () => {
      applyVoiceVol(ui.volSlider.value / 100, true);
    });
    ui.codeBtn = ui.root.querySelector("#wt-code");
    ui.micBtn = ui.root.querySelector("#wt-mic");
    ui.picker = ui.root.querySelector("#wt-picker");
    ui.search = ui.root.querySelector("#wt-emoji-search");
    ui.grid = ui.root.querySelector("#wt-emoji-grid");
    ui.quickPanel = document.querySelector("#wt-quick");
    ui.quickBar = document.querySelector("#wt-quick-bar");
    ui.quickPanel.addEventListener("mouseenter", () => bumpQuickActivity());
    // v19: chat input + emoji picker attached to the quick bar
    ui.qtypeForm = document.querySelector("#wt-qtype-form");
    ui.qBarInput = document.querySelector("#wt-qtype-form input");
    ui.qtypePicker = document.querySelector("#wt-qtype-picker");
    ui.qtypeSearch = document.querySelector("#wt-qtype-emoji-search");
    ui.qtypeGrid = document.querySelector("#wt-qtype-emoji-grid");
    if (ui.qtypeForm) {
      ui.qtypeForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = ui.qBarInput.value.trim();
        if (!text) return;
        ui.qBarInput.value = "";
        sendChatText(text);
        ui.qBarInput.focus();
      });
    }
    if (ui.qtypeSearch) {
      ui.qtypeSearch.addEventListener("input", () => {
        buildQtypeEmojiGrid(ui.qtypeSearch.value);
      });
    }
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
    // v33: AI trivia on/off
    ui.root.querySelector("#wt-trivia-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      setTriviaOn(!TV.on, true);
      toast(TV.on ? "🧠 Trivia ON" : "🧠 Trivia OFF");
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
      target.style.transform = "none";
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
    el.style.transform = "none";
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
    if (ui.quickPanel) ui.quickPanel.classList.toggle("wt-glass", !!S.glass);
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
      // v32: say so when playback is NOT linked right now
      const mode = S.syncMode || "same";
      const detail = mode === "away" ? `${S.friendName} is browsing – sync paused`
        : mode === "other" ? `${S.friendName} is on another video – sync paused`
        : mode === "me" ? `Connected to ${S.friendName} – open the video to sync`
        : `Synced with ${S.friendName}`;
      if (detail !== lastStatus.detail) setStatus("connected", detail);
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

  // v17: quick-type overlay — press T or / to chat instantly
  function showQtype() {
    if (!ui.qtype || !ui.qtypeInput) return;
    ui.qtype.classList.remove("wt-hide");
    ui.qtypeInput.value = "";
    setTimeout(() => { try { ui.qtypeInput.focus(); } catch (_) {} }, 30);
  }
  function hideQtype() {
    if (!ui.qtype) return;
    ui.qtype.classList.add("wt-hide");
    if (ui.qtypeInput) ui.qtypeInput.value = "";
  }
  function submitQtype() {
    if (!ui.qtypeInput) return;
    const text = ui.qtypeInput.value.trim();
    if (text) sendChatText(text);
    hideQtype();
  }
  (function initQtype() {
    document.addEventListener("keydown", (e) => {
      if (!ui.qtype || ui.qtype.classList.contains("wt-hide")) {
        if ((e.key === "t" || e.key === "T" || e.key === "/") && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const tag = String((e.target && (e.target.tagName || e.target.tag)) || "").toUpperCase();
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
          try { e.preventDefault(); } catch (_) {}
          showQtype();
        }
        return;
      }
      if (e.key === "Escape") { try { e.preventDefault(); } catch (_) {} hideQtype(); }
      else if (e.key === "Enter") { try { e.preventDefault(); } catch (_) {} submitQtype(); }
    });
  })();

  function msgRow(kind, from, text) {
    const row = document.createElement("div");
    if (kind === "s") {
      row.className = "wt-sys";
      appendRichText(row, text);
      return row;
    }
    row.className = "wt-msg" + (kind === "me" ? " wt-me" : "");
    const b = document.createElement("b");
    b.textContent = from + ": ";
    row.appendChild(b);
    appendRichText(row, text);
    return row;
  }

  function addMsg(from, text, self) {
    if (!ui.msgs) return;
    ui.msgs.appendChild(msgRow(self ? "me" : "f", from, text));
    trimMsgs();
    logLine(self ? "me" : "f", from, text);
    floatChatMsg(from, text, self);
  }

  function sysMsg(text) {
    if (!ui.msgs) return;
    ui.msgs.appendChild(msgRow("s", "", text));
    trimMsgs();
    logLine("s", "", text);
  }

  // ---------- v31: the chat survives page loads ----------
  // Following the friend to the next episode loads a new page; the party
  // rejoins on its own, and now the conversation comes back with it.
  const CHAT_KEEP = 80;
  const CHAT_MAX_AGE = 6 * 3600 * 1000;
  let chatLog = [];
  let chatSaveTimer = null;

  function logLine(kind, from, text) {
    if (!S.roomId) return;
    chatLog.push({ k: kind, f: String(from || "").slice(0, 24), x: String(text).slice(0, 400), at: Date.now() });
    if (chatLog.length > CHAT_KEEP) chatLog.splice(0, chatLog.length - CHAT_KEEP);
    clearTimeout(chatSaveTimer);
    chatSaveTimer = setTimeout(saveChat, 800);
  }

  function saveChat() {
    chatSaveTimer = null;
    // v32: only a tab that actually had the party link writes the log (a
    // second, unlinked tab must not overwrite the real conversation)
    if (!S.roomId || !S.everOpen) return;
    try { chrome.storage.local.set({ wt_chat: { room: S.roomId, items: chatLog.slice(-CHAT_KEEP) } }); } catch (_) {}
  }

  async function restoreChat(room) {
    let saved = null;
    try { saved = (await chrome.storage.local.get("wt_chat")).wt_chat; } catch (_) {}
    if (S.roomId !== room || !ui.msgs) return;
    if (!saved || saved.room !== room || !Array.isArray(saved.items)) return;
    const now = Date.now();
    const old = saved.items.filter((i) => i && typeof i.x === "string" && now - (i.at || 0) < CHAT_MAX_AGE).slice(-CHAT_KEEP);
    if (!old.length) return;
    // earlier lines go ABOVE whatever this page printed already
    const fresh = ui.msgs.children.slice ? ui.msgs.children.slice() : Array.prototype.slice.call(ui.msgs.children);
    for (const r of old) {
      const row = msgRow(r.k === "me" || r.k === "f" ? r.k : "s", r.f, r.x);
      row.classList.add("wt-restored");
      ui.msgs.appendChild(row);
    }
    for (const n of fresh) ui.msgs.appendChild(n);
    chatLog = old.concat(chatLog).slice(-CHAT_KEEP);
    trimMsgs();
  }

  function trimMsgs() {
    while (ui.msgs.childElementCount > 150) ui.msgs.firstElementChild.remove();
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
  }

  function floatChatMsg(from, text, self) {
    if (!ui.floatMsgs) return;
    const el = document.createElement("div");
    el.className = "wt-float-msg" + (self ? " wt-float-self" : "");
    const nameEl = document.createElement("span");
    nameEl.className = "wt-float-from";
    nameEl.textContent = from + ":";
    el.appendChild(nameEl);
    const txtEl = document.createElement("span");
    txtEl.textContent = " " + String(text).slice(0, 120);
    el.appendChild(txtEl);
    ui.floatMsgs.appendChild(el);
    while (ui.floatMsgs.childElementCount > 3) ui.floatMsgs.firstElementChild.remove();
    el.addEventListener("click", () => { try { el.remove(); } catch (_) {} });
    setTimeout(() => { try { el.remove(); } catch (_) {} }, 4600);
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

  // v19: emoji picker attached to quick bar
  function buildQtypeEmojiGrid(filter) {
    if (!ui.qtypeGrid) return;
    ui.qtypeGrid.textContent = "";
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
        closeQtypePicker();
      });
      ui.qtypeGrid.appendChild(b);
      count++;
    }
    if (!count) {
      const d = document.createElement("div");
      d.className = "wt-sys";
      d.textContent = "No matching emoji";
      ui.qtypeGrid.appendChild(d);
    }
  }
  function openQtypePicker() {
    if (!ui.qtypePicker) return;
    ui.qtypePicker.classList.remove("wt-hide");
    ui.qtypeSearch.value = "";
    buildQtypeEmojiGrid("");
    setTimeout(() => { try { ui.qtypeSearch.focus(); } catch (_) {} }, 0);
  }
  function closeQtypePicker() {
    if (ui.qtypePicker) ui.qtypePicker.classList.add("wt-hide");
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
      if (ui.qtypePicker && !ui.qtypePicker.classList.contains("wt-hide")) { closeQtypePicker(); return; }
      openQtypePicker();
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
    if (browsingNow()) { S.histTickAt = 0; return; } // v32: trailers are not "watched"
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

  function activity(icon, text, time, opts) {
    toast(`${icon} ${text}`);
    const isLocal = opts && opts.local;
    if (time != null) {
      if (isLocal) {
        S._lastLocalActionAt = Date.now();
        showActionOverlay(`You ${text.replace(/^[^ ]+ /, "").trim()} at ${fmtTime(time)}`);
      } else if (Date.now() - (S._lastLocalActionAt || 0) > 200) {
        showActionOverlay(`${text} at ${fmtTime(time)}`);
      }
    }
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }

  function showActionOverlay(text) {
    const host = document.fullscreenElement || document.documentElement;
    if (!host) return;
    const el = document.createElement("div");
    el.className = "wt-action-overlay";
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => { try { el.remove(); } catch (_) {} }, 2800);
  }

  function syncSysMsg(actionText, remoteTime) {
    if (!ui.msgs) return;
    const v = S.video;
    const myTime = v ? v.currentTime : 0;
    const ft = isFinite(remoteTime) ? fmtTime(remoteTime) : "?";
    const yt = fmtTime(myTime);
    sysMsg(actionText + "  [" + ft + " | you " + yt + "]");
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

  // v26: the live Direct link's RTCPeerConnection. finishLink() used to close
  // it (cleanupLinkPC), killing the data channel it carries in real Chrome.
  function closeDirectPC() {
    if (S.directPC) {
      try { S.directPC.close(); } catch (_) {}
      S.directPC = null;
    }
  }

  function finishLink(dc) {
    closeDirectPC();
    S.directPC = S.linkPC;
    S.linkPC = null;
    endVoiceCall();
    teardownConn();
    clearTimeout(S.retryTimer);
    if (S.peer) {
      try { S.peer.destroy(); } catch (_) {}
      S.peer = null;
    }
    S.directMode = true;
    const dconn = makeDataConn(dc);
    attachConn(dconn);
    closeLinkBox();
    sysMsg("\ud83d\udd17 Direct connection established \u2013 no server involved");
    // v26: channel is already open (we got here FROM its onopen), so
    // makeDataConn never emits "open" - run the connect handshake ourselves
    if (dconn.open) onConnOpen();
  }

// ---------- v30: automatic backup route (no manual codes) ----------
  // Every party used to depend on ONE free server (0.peerjs.com) to start or
  // re-start a link. The user's history shows whole evenings where it was
  // unreachable ("Network hiccup..." / friend never got through) and the only
  // way out was Direct connect with hand-pasted codes. Now, if the party has
  // no live link for AL_AFTER_MS, both sides also meet on public MQTT relays
  // (several, in parallel) on a topic derived from the party code, exchange
  // an offer/answer there and bring up the same direct RTCPeerConnection the
  // Direct-connect button uses - automatically. Everything on the relays is
  // AES-GCM encrypted with a key derived from the party code; the relays only
  // see random-looking blobs. PeerJS stays the primary route.
  const AL_RELAYS = [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://test.mosquitto.org:8081/mqtt",
    "wss://broker.hivemq.com:8884/mqtt"
  ];
  const AL_AFTER_MS = 6000;       // PeerJS gets this long first
  const AL_HERE_MS = 3000;        // presence beacon while waiting
  const AL_OFFER_TIMEOUT = 15000; // give up on an unanswered handshake
  const AL_SOCK_RETRY_MS = 10000;

  const AL = {
    on: false, id: "", room: "", topic: "", key: null, socks: [], seen: [],
    timer: null, needSince: 0, okSince: 0, lastHere: 0, pend: null, told: false
  };

  function alB64(u8) { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function alUnB64(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

  async function alDerive(room) {
    const te = new TextEncoder();
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode("watch-together/autolink/topic/" + room)));
    let hex = ""; for (let i = 0; i < 16; i++) hex += h[i].toString(16).padStart(2, "0");
    const base = await crypto.subtle.importKey("raw", te.encode("wt:" + room), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: te.encode("watch-together/autolink/v1"), iterations: 60000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return { topic: "wt-autolink/" + hex, key };
  }

  // minimal MQTT 3.1.1 over WebSocket: CONNECT, SUBSCRIBE (QoS 0), PUBLISH
  // (QoS 0), PINGREQ - all this route needs
  function alSocket(url) {
    const te = new TextEncoder(), td = new TextDecoder();
    const sock = { url, ws: null, ok: false, dead: false, diedAt: 0, ping: null, buf: new Uint8Array(0) };
    const u16 = (n) => [(n >> 8) & 255, n & 255];
    const str = (s) => { const b = te.encode(s); return u16(b.length).concat(Array.from(b)); };
    const remLen = (n) => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; };
    const pkt = (h, body) => new Uint8Array([h].concat(remLen(body.length), body));
    const die = () => {
      if (sock.dead) return;
      sock.ok = false; sock.dead = true; sock.diedAt = Date.now();
      clearInterval(sock.ping);
    };
    sock.publish = (text) => {
      if (!sock.ok) return;
      try { sock.ws.send(pkt(0x30, str(AL.topic).concat(Array.from(te.encode(text))))); } catch (_) { die(); }
    };
    sock.close = () => { die(); try { sock.ws.close(); } catch (_) {} };
    function onPacket(b0, body) {
      const type = b0 & 0xf0;
      if (type === 0x20) { // CONNACK
        if (body[1] !== 0) { sock.close(); return; }
        sock.ws.send(pkt(0x82, [0, 1].concat(str(AL.topic), [0])));
      } else if (type === 0x90) { // SUBACK
        sock.ok = true;
        sock.ping = setInterval(() => { try { sock.ws.send(new Uint8Array([0xc0, 0])); } catch (_) { die(); } }, 30000);
      } else if (type === 0x30) { // PUBLISH
        const qos = (b0 >> 1) & 3;
        const tl = (body[0] << 8) | body[1];
        let p = 2 + tl + (qos > 0 ? 2 : 0);
        try { alOnRelay(td.decode(body.subarray(p))); } catch (_) {}
      }
    }
    try {
      sock.ws = new WebSocket(url, ["mqtt"]);
      sock.ws.binaryType = "arraybuffer";
    } catch (_) { die(); return sock; }
    sock.ws.onopen = () => {
      try { sock.ws.send(pkt(0x10, str("MQTT").concat([4, 2, 0, 60], str("wt" + AL.id + Math.random().toString(36).slice(2, 7))))); }
      catch (_) { die(); }
    };
    sock.ws.onmessage = (ev) => {
      const add = new Uint8Array(ev.data);
      const merged = new Uint8Array(sock.buf.length + add.length);
      merged.set(sock.buf); merged.set(add, sock.buf.length);
      let b = merged;
      while (b.length >= 2) {
        let mult = 1, len = 0, i = 1, d;
        do { if (i >= b.length) { i = -1; break; } d = b[i++]; len += (d & 127) * mult; mult *= 128; } while (d & 128);
        if (i < 0 || b.length < i + len) break;
        onPacket(b[0], b.subarray(i, i + len));
        b = b.subarray(i + len);
      }
      sock.buf = b.slice();
    };
    sock.ws.onclose = die;
    sock.ws.onerror = die;
    return sock;
  }

  async function alPublish(obj) {
    if (!AL.on || !AL.key) return;
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const pt = new TextEncoder().encode(JSON.stringify(Object.assign({}, obj, { f: AL.id, r: S.role, ts: Date.now() })));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, AL.key, pt));
      const text = JSON.stringify({ v: 1, iv: alB64(iv), d: alB64(ct) });
      for (const s of AL.socks) s.publish(text);
    } catch (_) {}
  }

  async function alOnRelay(text) {
    if (!AL.on || !AL.key) return;
    let env;
    try { env = JSON.parse(text); } catch (_) { return; }
    if (!env || env.v !== 1 || typeof env.iv !== "string" || typeof env.d !== "string") return;
    if (AL.seen.indexOf(env.iv) !== -1) return; // same message via another relay
    AL.seen.push(env.iv);
    if (AL.seen.length > 200) AL.seen.splice(0, 100);
    let m;
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: alUnB64(env.iv) }, AL.key, alUnB64(env.d));
      m = JSON.parse(new TextDecoder().decode(pt));
    } catch (_) { return; } // not our party (or tampered)
    if (!m || m.f === AL.id || Math.abs(Date.now() - (m.ts || 0)) > 120000) return;
    const need = alNeedLink();
    if (m.t === "here") {
      // answer a beacon with our own right away so the pair finds each other fast
      if (need && Date.now() - AL.lastHere > 1000) { AL.lastHere = Date.now(); alPublish({ t: "here" }); }
      if (S.role === "host" && m.r === "guest" && need) {
        if (AL.pend && AL.pend.to === m.f && Date.now() - AL.pend.at < AL_OFFER_TIMEOUT) return;
        alOffer(m.f);
      }
    } else if (m.t === "offer" && S.role === "guest" && m.to === AL.id && typeof m.sdp === "string") {
      if (need) alAnswer(m);
    } else if (m.t === "answer" && S.role === "host" && m.to === AL.id && typeof m.sdp === "string") {
      const p = AL.pend;
      if (p && p.to === m.f && !p.answered) {
        p.answered = true;
        try { await p.pc.setRemoteDescription({ type: "answer", sdp: m.sdp }); } catch (_) { alDropPend(); }
      }
    }
  }

  function alNeedLink() {
    if (!S.roomId || S.stopping) return false;
    if (yielding()) return false; // v32: another tab of ours has the party
    return !isOpen() || (!!S.lastRxAt && Date.now() - S.lastRxAt > 9000);
  }

  function alDropPend() {
    const p = AL.pend;
    AL.pend = null;
    if (p) { try { p.pc.close(); } catch (_) {} }
  }

  async function alOffer(to) {
    alDropPend();
    try {
      const pc = new RTCPeerConnection(VOICE_ICE);
      const dc = pc.createDataChannel("wt", { ordered: true });
      const p = AL.pend = { pc, to, at: Date.now(), answered: false };
      dc.onopen = () => alLinkUp(pc, dc);
      await pc.setLocalDescription(await pc.createOffer());
      await gatherDone(pc);
      if (AL.pend !== p) return;
      alPublish({ t: "offer", to, sdp: pc.localDescription.sdp });
    } catch (e) {
      try { console.warn("WT: backup-route offer failed", e); } catch (_) {}
      alDropPend();
    }
  }

  async function alAnswer(m) {
    alDropPend();
    try {
      const pc = new RTCPeerConnection(VOICE_ICE);
      const p = AL.pend = { pc, to: m.f, at: Date.now(), answered: true };
      pc.ondatachannel = (ev) => {
        const dc = ev.channel;
        if (dc.readyState === "open") alLinkUp(pc, dc);
        else dc.onopen = () => alLinkUp(pc, dc);
      };
      await pc.setRemoteDescription({ type: "offer", sdp: m.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gatherDone(pc);
      if (AL.pend !== p) return;
      alPublish({ t: "answer", to: m.f, sdp: pc.localDescription.sdp });
    } catch (e) {
      try { console.warn("WT: backup-route answer failed", e); } catch (_) {}
      alDropPend();
    }
  }

  function alLinkUp(pc, dc) {
    if (AL.pend && AL.pend.pc === pc) AL.pend = null;
    if (!alNeedLink()) { // a PeerJS link came up meanwhile - keep that one
      try { pc.close(); } catch (_) {}
      return;
    }
    const old = S.conn;
    detachConn();
    try { if (old) old.close(); } catch (_) {}
    stopHb();
    endVoiceCall();
    dropAllDcCalls();
    closeDirectPC();
    clearTimeout(S.retryTimer);
    clearTimeout(S.connOpenTimer);
    S.connOpenTimer = null;
    S.directPC = pc;
    S.directMode = true; // same data path as Direct connect (voice included)
    const c = makeDataConn(dc);
    attachConn(c);
    sysMsg("🛟 Connected through the backup route (PeerJS server unreachable)");
    if (c.open) onConnOpen();
  }

  function alTick() {
    if (!AL.on) return;
    const now = Date.now();
    const need = alNeedLink();
    if (need) { AL.okSince = 0; if (!AL.needSince) AL.needSince = now; }
    else { AL.needSince = 0; AL.told = false; if (!AL.okSince) AL.okSince = now; }
    const active = need && now - AL.needSince >= AL_AFTER_MS;
    if (active && AL.key) {
      AL.socks = AL.socks.filter((s) => !(s.dead && now - s.diedAt > AL_SOCK_RETRY_MS));
      for (const url of AL_RELAYS) {
        if (!AL.socks.some((s) => s.url === url)) AL.socks.push(alSocket(url));
      }
      if (now - AL.lastHere >= AL_HERE_MS) { AL.lastHere = now; alPublish({ t: "here" }); }
      if (!AL.told) { AL.told = true; sysMsg("🛟 Normal route is slow – also trying the backup route…"); }
    } else if (!need && AL.socks.length && now - AL.okSince > 30000) {
      AL.socks.forEach((s) => s.close());
      AL.socks = [];
    }
    if (AL.pend && now - AL.pend.at > AL_OFFER_TIMEOUT) alDropPend();
  }

  function alStart(room) {
    alStop();
    if (!room || typeof WebSocket !== "function" || !(window.crypto && crypto.subtle)) return;
    AL.on = true;
    AL.room = room;
    AL.id = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
    AL.needSince = 0; AL.okSince = 0; AL.lastHere = 0; AL.told = false; AL.seen = [];
    alDerive(room).then((d) => {
      if (!AL.on || AL.room !== room) return;
      AL.topic = d.topic;
      AL.key = d.key;
    }).catch(() => { AL.on = false; });
    AL.timer = setInterval(alTick, 1000);
  }

  function alStop() {
    AL.on = false;
    clearInterval(AL.timer);
    AL.timer = null;
    AL.socks.forEach((s) => s.close());
    AL.socks = [];
    alDropPend();
    AL.key = null;
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

  // ---------- v33: AI scene trivia ----------
  // Once per episode/film the background worker asks Claude for trivia tied
  // to moments of the runtime (the user's own API key, set in the popup;
  // cached per title). While the video plays, each item floats in on the
  // left or right when its moment comes. A friend without a key gets the
  // same items over the party link.
  const TRIVIA_MIN_DUR = 600;    // episodes and films only - no trailers, no live TV
  const TRIVIA_WINDOW_S = 20;    // an item still shows up to 20 s after its moment
  const TRIVIA_GAP_MS = 15000;   // never two cards within 15 s
  const TRIVIA_SHOW_MS = 12000;
  const TRIVIA_RETRY_MS = 120000;
  const TV = { on: true, hasKey: false, key: null, items: null, title: "", shown: {}, asked: {}, lastT: 0, lastShowAt: 0, side: 0, told: {} };

  function triviaKey() {
    const v = S.video;
    if (!v || !(v.duration >= TRIVIA_MIN_DUR) || v.duration === Infinity) return null;
    if (browsingNow()) return null;
    return curKey() || ("page:" + cleanHref(hereHref()).slice(0, 180));
  }

  function triviaTellOnce(id, text) {
    if (TV.told[id]) return;
    TV.told[id] = true;
    toast(text);
    sysMsg(text);
  }

  function cleanTriviaItems(items) {
    return (Array.isArray(items) ? items : [])
      .filter((i) => i && typeof i.fact === "string" && typeof i.t === "number" && isFinite(i.t))
      .map((i) => ({ t: Math.max(0, i.t), scene: String(i.scene || "").slice(0, 80), fact: String(i.fact).slice(0, 300) }))
      .sort((a, b) => a.t - b.t)
      .slice(0, 30);
  }

  function setTriviaItems(key, items, title, from) {
    if (key !== TV.key) return;
    TV.items = cleanTriviaItems(items);
    TV.title = String(title || "").slice(0, 120);
    TV.shown = {};
    const t = S.video ? S.video.currentTime : 0;
    for (const it of TV.items) if (it.t < t - TRIVIA_WINDOW_S) TV.shown[it.t] = true; // already past
    if (TV.items.length) {
      const src = { pack: "trivia pack", wikipedia: "Wikipedia", claude: "Claude" }[TV.source] || "";
      triviaTellOnce("ready:" + key, "🧠 Trivia ready" + (TV.title ? " for " + TV.title : "") +
        " – " + TV.items.length + " moments" + (from ? " (from " + from + ")" : (src ? " (" + src + ")" : "")));
    }
    S.triviaShared = false;
  }

  // v34: everything on the page that names what's playing - the background
  // matches it against the trivia packs and searches Wikipedia with it
  function titleHints() {
    const out = [];
    const add = (x) => { const s = String(x || "").replace(/\s+/g, " ").trim(); if (s && s.length < 300 && out.indexOf(s) === -1) out.push(s); };
    try { add(document.title); } catch (_) {}
    try { add(extractNowPlaying()); } catch (_) {}
    const href = cleanHref(hereHref());
    add(navLabel(href));
    const u = parseHref(href);
    if (u) add(u.path.split("/").filter((p) => p && /[a-z]/i.test(p) && !/^\d+$/.test(p)).join(" ").replace(/[-_]+/g, " "));
    // Netflix's on-screen title is <h4>Show</h4><span>E1</span><span>Pilot</span>:
    // its textContent glues the parts ("Breaking BadE1Pilot") - read each leaf separately
    const leaves = (el) => {
      const parts = [];
      (function walk(n) {
        const kids = n.children ? Array.prototype.slice.call(n.children) : [];
        if (!kids.length) { const t = String(n.textContent || "").trim(); if (t) parts.push(t); return; }
        for (const k of kids) walk(k);
      })(el);
      return parts.join(" ");
    };
    for (const sel of ['[data-uia="video-title"]', 'meta[property="og:title"]', "h1"]) {
      try {
        const el = document.querySelector(sel);
        if (el) add((el.getAttribute && el.getAttribute("content")) || leaves(el));
      } catch (_) {}
    }
    return out.slice(0, 8);
  }

  function askTrivia(key) {
    if (TV.asked[key]) return;
    TV.asked[key] = true;
    const href = cleanHref(hereHref());
    const u = parseHref(href);
    const req = {
      t: "wt-trivia", key, hints: titleHints(),
      title: extractNowPlaying(), pageTitle: String(document.title || "").slice(0, 200),
      slug: navLabel(href), site: u ? u.host : "", duration: S.video ? S.video.duration : 0,
    };
    try {
      if (typeof chrome === "undefined" || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") return;
      chrome.runtime.sendMessage(req, (resp) => {
        try { void (chrome.runtime && chrome.runtime.lastError); } catch (_) {}
        onTriviaAnswer(key, resp);
      });
    } catch (_) {
      // extension was reloaded under this page: nothing to talk to until the page reloads
    }
  }

  function onTriviaAnswer(key, resp) {
    if (!resp) { setTimeout(() => { delete TV.asked[key]; }, TRIVIA_RETRY_MS); return; }
    if (Array.isArray(resp.items)) {
      if (!resp.items.length) return; // nothing known about this title
      if (!TV.items || !TV.items.length) { TV.source = resp.source || ""; setTriviaItems(key, resp.items, resp.title, null); }
      return;
    }
    const err = resp.error;
    if (err === "no-key" || err === "unknown") return; // nothing for this title (a friend may still share)
    if (err === "bad-key") { triviaTellOnce("badkey", "🧠 AI trivia: the API key was rejected – check it in the extension popup"); return; }
    if (err === "declined") return;
    // busy / offline / failed: try again later
    setTimeout(() => { delete TV.asked[key]; }, TRIVIA_RETRY_MS);
  }

  function triviaTick() {
    if (!TV.on) return;
    const key = triviaKey();
    if (!key) return;
    if (key !== TV.key) {
      TV.key = key; TV.items = null; TV.shown = {}; TV.title = ""; TV.lastT = 0;
    }
    if (!TV.items) askTrivia(key); // v34: packs + Wikipedia need no key
    if (!TV.items) return;
    // share with the friend once per link (they may have no key)
    if (isOpen() && !S.triviaShared && TV.items.length && (S.syncMode || "same") === "same") {
      S.triviaShared = true;
      send({ t: "trivia", k: key, items: TV.items, title: TV.title, from: S.name });
    }
    const v = S.video;
    if (!v || v.paused) return;
    const t = v.currentTime;
    if (t < TV.lastT - 5) { for (const it of TV.items) if (it.t > t) delete TV.shown[it.t]; } // seeked back
    TV.lastT = t;
    let due = null;
    for (const it of TV.items) {
      if (TV.shown[it.t]) continue;
      if (it.t > t) break;
      if (t - it.t > TRIVIA_WINDOW_S) { TV.shown[it.t] = true; continue; } // skipped past it
      due = it;
    }
    if (!due || Date.now() - TV.lastShowAt < TRIVIA_GAP_MS) return;
    TV.shown[due.t] = true;
    TV.lastShowAt = Date.now();
    showTriviaCard(due);
  }

  function showTriviaCard(it) {
    const host = document.fullscreenElement || document.documentElement;
    if (!host) return;
    const card = document.createElement("div");
    card.className = "wt-trivia " + (TV.side++ % 2 ? "wt-trivia-right" : "wt-trivia-left");
    const head = document.createElement("div");
    head.className = "wt-trivia-head";
    head.textContent = "🧠 " + (it.scene || "Trivia");
    const x = document.createElement("button");
    x.type = "button";
    x.className = "wt-trivia-x";
    x.textContent = "×";
    x.addEventListener("click", (e) => { try { e.stopPropagation(); } catch (_) {} try { card.remove(); } catch (_) {} });
    head.appendChild(x);
    const body = document.createElement("div");
    body.className = "wt-trivia-text";
    body.textContent = it.fact;
    card.appendChild(head);
    card.appendChild(body);
    host.appendChild(card);
    setTimeout(() => { try { card.classList.add("wt-trivia-out"); } catch (_) {} }, TRIVIA_SHOW_MS - 600);
    setTimeout(() => { try { card.remove(); } catch (_) {} }, TRIVIA_SHOW_MS);
  }

  function clearTriviaCards() {
    try { for (const c of document.querySelectorAll(".wt-trivia")) c.remove(); } catch (_) {}
  }

  function onFriendTrivia(m) {
    if (!m || typeof m.k !== "string" || !Array.isArray(m.items)) return;
    const key = triviaKey();
    if (!key || m.k !== key || (TV.items && TV.items.length)) return;
    TV.key = key;
    const who = String(m.from || S.friendName || "your friend").slice(0, 24);
    setTriviaItems(key, m.items, m.title, who);
    S.triviaShared = true; // they already have it
    try {
      if (chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
        chrome.runtime.sendMessage({ t: "wt-trivia-store", key, items: TV.items, title: TV.title }, () => {
          try { void chrome.runtime.lastError; } catch (_) {}
        });
      }
    } catch (_) {}
  }

  function setTriviaOn(on, save) {
    TV.on = !!on;
    if (!TV.on) clearTriviaCards();
    const b = ui.root && ui.root.querySelector("#wt-trivia-btn");
    if (b) {
      b.classList.toggle("wt-on", TV.on);
      b.title = TV.on ? "AI trivia ON – click to turn off" : "AI trivia OFF – click to turn on";
    }
    if (save) { try { chrome.storage.local.set({ wt_trivia_on: TV.on }); } catch (_) {} }
  }

  // ---------- boot ----------

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && ch.wt_live) noteLive(ch.wt_live.newValue); // v32
    if (area === "local" && ch.wt_trivia_on) setTriviaOn(ch.wt_trivia_on.newValue !== false, false); // v33
    if (area === "local" && ch.wt_anthropic_key) { TV.hasKey = !!ch.wt_anthropic_key.newValue; TV.asked = {}; }
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
      path: S.voiceConn ? (S.voiceConn.__wtDc ? "link" : "peerjs") : null,
      route: isOpen() ? (S.directMode ? "direct" : "peerjs") : null, relays: AL.socks.filter((x) => x.ok).length,
      gotStream: !!S.voiceGotStream, friendVer: S.friendVer,
      boost: S.vb ? { ctx: S.vb.ctx.state, auto: +S.vb.auto.toFixed(2), gain: +S.vb.applied.toFixed(2), inRms: +S.vb.level.toFixed(4),
        floor: +S.vb.floor.toFixed(5), speaking: !!S.vb.speaking, duck: S.duck ? { base: S.duck.base, vol: S.video ? +S.video.volume.toFixed(3) : null } : null,
        outRms: (() => { try { return +rmsOf(S.vb.post, new Float32Array(S.vb.post.fftSize)).toFixed(4); } catch (_) { return null; } })() } : null,
      gate: !!S.gateTimer, gateMuted: !!S.gateMuted,
      histEntries: S.hist.length,
      // v31
      buf: { me: !!S.bufSent, friend: !!S.friendBuf, hold: !!S.hold, ignore: !!S.holdIgnore,
        rs: S.video && typeof S.video.readyState === "number" ? S.video.readyState : null },
      nav: { key: S.navKey, follow: S.follow ? { key: S.follow.key, left: S.follow.left } : null },
      // v32
      sync: { mode: S.syncMode || "same", mine: curKey(), friend: S.friendKey || null, friendAway: !!S.friendAway,
        browsing: browsingNow(), fresh: isFresh() }
    });
  } catch (_) {}

  (async () => {
    ensureUi();
    relocateRoot();
    document.addEventListener("fullscreenchange", relocateRoot);
    setInterval(bindVideo, 1500);
    setInterval(updateNowPlaying, 10000);
    // v31: buffering hold + follow-the-friend
    S.navKey = watchKey(hereHref().split("#")[0]);
    S.navLegacy = legacyKey(cleanHref(hereHref())); // v32: v1.31-format key of the same page
    setInterval(bufTick, 500);
    setInterval(navTick, 1000);
    setInterval(liveTick, 1000); // v32: stand by while another tab has the party
    setInterval(triviaTick, 1000); // v33
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
    try { noteLive((await chrome.storage.local.get("wt_live")).wt_live); } catch (_) {} // v32
    try {
      const tv = await chrome.storage.local.get(["wt_trivia_on", "wt_anthropic_key"]); // v33
      TV.hasKey = !!tv.wt_anthropic_key;
      setTriviaOn(tv.wt_trivia_on !== false, false);
    } catch (_) {}
    if (party) startParty(party);
  })();
})();
