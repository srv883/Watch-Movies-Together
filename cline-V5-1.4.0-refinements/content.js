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
    stopping: false,
    micEnabled: false,
    micStream: null,
    voiceConn: null,
    lastRxAt: 0,
    wdTimer: null,
    friendName: null,
    typingTimer: null,
    typingSentAt: 0,
    voiceVol: 1,
    nowLabel: ""
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
    send({ t: v.paused ? "pause" : "play", time: v.currentTime, from: S.name });
  }

  function onSeeked(e) {
    if (S.applyingRemote || !isOpen()) return;
    send({ t: "seek", time: e.target.currentTime, paused: e.target.paused, from: S.name });
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
    send({ t: "state", time: v.currentTime, paused: v.paused, from: S.name });
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
      if (!isOpen()) return;
      const v = S.video;
      send({ t: "hb", time: v ? v.currentTime : null, paused: v ? v.paused : true });
    }, HB_MS);
  }

  function stopHb() {
    clearInterval(S.hbTimer);
    S.hbTimer = null;
  }

  // ---------- connection watchdog ----------
  // Detects a silently-dead data channel (conn.open but no packets flowing)
  // and rebuilds it. Also keeps the PeerJS signaling socket alive.

  const WATCHDOG_MS = 12000;

  function touchRx() {
    S.lastRxAt = Date.now();
  }

  function startWatchdog() {
    if (S.wdTimer) return;
    S.wdTimer = setInterval(() => {
      if (S.stopping) return;
      // keep signaling socket connected (it decays after long idle)
      if (S.peer && S.peer.disconnected) {
        try { S.peer.reconnect(); } catch (_) {}
      }
      // detect zombie data channel
      if (isOpen() && Date.now() - S.lastRxAt > WATCHDOG_MS) {
        teardownConn();
        if (S.role === "guest") {
          setStatus("waiting", "Connection stalled \u2013 restoring\u2026");
          scheduleRetry();
        } else {
          setStatus("waiting", "Connection lost \u2013 waiting for your friend\u2026");
        }
      }
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
    setMicUi(false);
  }

  function attachVoiceCall(call) {
    endVoiceCall();
    S.voiceConn = call;
    call.on("stream", (remote) => {
      const a = ensureRemoteAudio();
      a.srcObject = remote;
      a.play().catch(() => {});
    });
    call.on("close", () => {
      if (S.voiceConn === call) S.voiceConn = null;
    });
    call.on("error", () => {
      if (S.voiceConn === call) S.voiceConn = null;
    });
  }

  function startVoiceCall() {
    if (!S.peer || !S.peer.open || !isOpen()) return;
    endVoiceCall();
    try {
      const call = S.peer.call(S.conn.peer, S.micStream && S.micStream.active ? S.micStream : new MediaStream());
      attachVoiceCall(call);
    } catch (_) {}
  }

  function saveMicState(on) {
    try { chrome.storage.local.set({ wt_mic_state: !!on }); } catch (_) {}
  }

  async function toggleMic() {
    if (S.micEnabled) {
      stopMic();
      saveMicState(false);
      sysMsg("Microphone off");
      return;
    }
    if (!isOpen()) {
      sysMsg("Not connected \u2013 cannot use voice");
      return;
    }
    try {
      await getMicStream();
      S.micEnabled = true;
      setMicUi(true);
      startVoiceCall();
      saveMicState(true);
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
    touchRx();
    setStatus("connected", "Playback synced");
    sysMsg(S.role === "host" ? "Your friend connected" : "Connected to your friend");
    if (S.role === "guest") send({ t: "hello", name: S.name });
    else pushState();
    if (S.micEnabled) {
      getMicStream()
        .then(() => {
          setMicUi(true);
          startVoiceCall();
        })
        .catch(() => {
          S.micEnabled = false;
          setMicUi(false);
          sysMsg("Microphone blocked \u2013 check site permissions");
        });
    }
    startHb();
  }

  function onConnClose() {
    stopHb();
    endVoiceCall();
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
        if (S.role === "host") {
          const who = String(m.name || "").slice(0, 24);
          if (who && who !== S.friendName) {
            S.friendName = who;
            sysMsg(`${who} joined`);
          }
          send({ t: "hello", name: S.name });
          pushState();
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
        hideTyping();
        addMsg(from, text, false);
        break;
      }
      case "react": {
        const e = String(m.e || "").slice(0, 8);
        const who = String(m.from || "Friend").slice(0, 24);
        if (e) {
          floatReaction(e);
          sysMsg(`${who} reacted ${e}`);
        }
        break;
      }
      case "typing": {
        const who = String(m.from || "Friend").slice(0, 24);
        showTyping(who);
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
      '<span class="wt-title">Watch Together</span>' +
      '<button id="wt-code" title="Copy code">\u2013\u2013\u2013\u2013\u2013\u2013</button>' +
      '<button id="wt-close" title="Hide">\u00d7</button>' +
      "</div>" +
      '<div id="wt-now" class="wt-now"></div>' +
      '<div class="wt-statusline"><span class="wt-dot"></span><span id="wt-status-text">Idle</span>' +
      '<span id="wt-voice-wrap" title="Friend\'s voice volume">\ud83d\udd0a<input id="wt-voice-vol" type="range" min="0" max="100" value="100" /></span></div>' +
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
      '<div id="wt-toasts"></div>';
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

    for (const el of [ui.input, ui.panel, ui.search]) {
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
  }

  function updateConnectedStatus() {
    if (lastStatus.state === "connected" && S.friendName) {
      setStatus("connected", `Synced with ${S.friendName}`);
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
    // popup preview when panel is hidden
    if (!self && ui.root && !ui.root.classList.contains("wt-open")) {
      toast(`\ud83d\udcac ${from}: ${String(text).slice(0, 60)}`);
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

  function floatReaction(emoji) {
    // attach to fullscreen element when in fullscreen so it stays visible
    const host = document.fullscreenElement || document.documentElement;
    if (!host || !emoji) return;
    const el = document.createElement("div");
    el.className = "wt-float";
    el.textContent = emoji;
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
    const { wt_party: party, wt_voice_vol: savedVol } = await chrome.storage.local.get(["wt_party", "wt_voice_vol"]);
    if (typeof savedVol === "number") applyVoiceVol(savedVol, false);
    if (party) startParty(party);
  })();
})();
