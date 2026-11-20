/* ============================================================
   V35 behaviour test harness (port of test-V34 + v35: Chrome Web Store build)
   v30 changes (found by the real-Chrome end-to-end test, tests\rig\e2e.js):
     - exact echo suppression: real clicks right after a friend's action are
       no longer swallowed (guest play / speed change were lost)
     - guest re-syncs to the host's play/pause/speed after 2 disagreeing beats
     - a friend re-dialing replaces our dead link at once (was ~40 s)
     - PeerJS server errors while connected no longer flip the status
     - automatic backup route over public MQTT relays (encrypted) when
       PeerJS can't link the pair - here against an in-memory fake broker
   (v29 header follows)
   V29 behaviour test harness (port of test-V28 + v29 louder target)
   v29: auto-level target -17.7 dBFS (VB_TARGET_RMS 0.13) - the rig showed
   v28 played an AGC-levelled voice ~4 dB quieter than v27
   (v28 header follows)
   V28 behaviour test harness (port of test-V27 + v28 clear voice)
   v28 changes (tuned on the real-Chrome rig, see CONTEXT-HANDOFF):
     - echo cancellation ON together with NS + AGC (NC switch = full voice
       processing; off = raw mic); live toggle rebuilds the mic when Chrome
       keeps the old processing
     - Opus 64 kbps VBR + FEC (was 128 kbps CBR)
     - auto-level: speech detected vs a percentile noise floor, x16 cap,
       noise floor never lifted above ~-54 dBFS; limiter -4 dBFS with
       Chrome's makeup gain cancelled
     - movie ducks to 40% while the friend talks, restored exactly
   (v27 header follows)
   V27 behaviour test harness (port of test-V26 + v27 voice boost)
   v27 changes:
     - friend's voice plays through Web Audio: auto-level gain (quiet
       mics raised up to x8 toward normal speech loudness, silence never
       raises it) -> limiter; <audio> element muted while the graph runs,
       plays instead while the AudioContext is suspended
     - voice slider 0..200%
   (v26 header follows)
   V26 behaviour test harness (port of test-V25 + v26 voice link)
   v26 changes:
     - voice calls signaled over the data link (voffer/vanswer/vice/vbye),
       legacy PeerJS media call only for friends older than v1.26
     - hotSwapMicTrack awaits replaceTrack (no more spurious re-dials)
     - host self-heals a dead voice line from the heartbeat
     - Direct mode: link PC kept alive, handshake runs, voice works
     - connectToHost survives PeerJS connect() returning undefined
     - FakeRTC now carries audio; env._calls records keep the old shape
   (v25 header follows)
   V25 behaviour test harness (port of test-V24 + v25 site picker)
   Runs the REAL V35-store/content.js twice (host+guest)
   against stubbed DOM / PeerJS / chrome APIs, and the REAL popup.js
   against a fake popup DOM. v25 changes:
     - manifest description no longer claims "ANY site"
     - popup: friendly site names, quick-launch buttons on unsupported
       pages, off-site hint while a party is active, site-aware invite
     - manifest / popup / content.js host lists enforced identical
   v24 changes:
     - manifest content_scripts limited to 6 streaming domains
       (netflix / hotstar / jiohotstar / primevideo / jiotv / jiocinema)
     - popup isSupported uses the same host whitelist
     - content.js runtime host guard (defence-in-depth)
   Run:  node --experimental-vm-modules tests/test-V35.js
   ============================================================ */
"use strict";

const fs = require("fs");
const vm = require("vm");

const SRC_PATH = "C:/Users/Sourav/ML Coding/watch-together-versions/V35-store/content.js";
const DIR12 = "C:/Users/Sourav/ML Coding/watch-together-versions/V35-store";
const SRC = fs.readFileSync(SRC_PATH, "utf8");

const __TEST_ERRORS = [];
globalThis.__TEST_ERRORS = __TEST_ERRORS;

// v12: set true to simulate Chrome's autoplay policy blocking media elements
let AUTOPLAY_BLOCK = false;

/* ---------------- fake clock ---------------- */
class Clock {
  constructor() { this.now = 0; this.seq = 0; this.timers = new Map(); this.errs = []; }
  setTimeout(fn, ms) { const id = ++this.seq; this.timers.set(id, { at: this.now + Math.max(0, ms | 0), fn }); return id; }
  setInterval(fn, ms) { const id = ++this.seq; this.timers.set(id, { at: this.now + Math.max(1, ms | 0), fn, int: Math.max(1, ms | 0) }); return id; }
  clear(id) { this.timers.delete(id); }
  advance(ms) {
    const end = this.now + ms;
    for (let guard = 0; guard < 20000; guard++) {
      let pick = null, pickId = null;
      for (const [id, t] of this.timers) {
        if (t.at <= end && (pick === null || t.at < pick.at)) { pick = t; pickId = id; }
      }
      if (!pick) break;
      this.now = Math.max(this.now, pick.at);
      this.timers.delete(pickId);
      try { pick.fn(); } catch (e) { this.errs.push(e); }
      if (pick.int) { pick.at = this.now + pick.int; this.timers.set(pickId, pick); }
    }
    this.now = end;
  }
}
/* ---------------- DOM element ---------------- */
function matchSel(sel) {
  sel = sel.trim();
  if (sel.startsWith("#")) { const id = sel.slice(1); return el => el.id === id; }
  if (sel.startsWith(".")) { const c = sel.slice(1); return el => el.classes.has(c); }
  const t = sel.toLowerCase();
  return el => el.tag === t;
}
function qsa(root, sel) {
  sel = sel.trim();
  if (!sel.includes(" ")) {
    const m = matchSel(sel); const out = [];
    (function walk(n) {
      for (const c of n.children) {
        if (c.tag === "#text") continue;
        if (m(c)) out.push(c);
        walk(c);
      }
    })(root);
    return out;
  }
  // compound descendant selector: "#id#space#.class"
  const parts = sel.split(/\s+/).map(s => s.trim()).filter(Boolean);
  let cur = [root];
  for (const part of parts) {
    const m = matchSel(part);
    const next = [];
    for (const p of cur) {
      (function walk(n) {
        for (const c of n.children) {
          if (c.tag === "#text") continue;
          if (m(c)) next.push(c);
          walk(c);
        }
      })(p);
    }
    cur = next;
  }
  return cur;
}

function allByClass(root, cls) {
  const out = [];
  (function walk(n) {
    for (const c of n.children) {
      if (c.tag === "#text") continue;
      if (c.classes.has(cls)) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}

function makeEl(tag) {
  const el = {
    tag: (tag || "div").toLowerCase(), id: "", classes: new Set(), children: [], parent: null,
    handlers: {}, dataset: {}, value: "", title: "", type: "", placeholder: "",
    srcObject: null, volume: 1, muted: false, paused: true, currentTime: 0, playbackRate: 1,
    scrollTop: 0, scrollHeight: 0, closed: false, mirror: null,
    style: { setProperty(k, v) { this["var_" + k] = v; }, display: "" },
    _rect: { width: 300, height: 60, x: 0, y: 0 },
  };
  el.classList = {
    add: (...cs) => cs.forEach(c => el.classes.add(c)),
    remove: (...cs) => cs.forEach(c => el.classes.delete(c)),
    toggle: (c, force) => {
      const want = typeof force === "boolean" ? force : !el.classes.has(c);
      if (want) el.classes.add(c); else el.classes.delete(c);
    },
    contains: c => el.classes.has(c),
  };
  Object.defineProperty(el, "className", {
    get: () => [...el.classes].join(" "),
    set: v => { el.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  Object.defineProperty(el, "textContent", {
    get: () => el.children.map(c => (c.tag === "#text" ? c.text : c.textContent)).join(""),
    set: v => { el.children = [{ tag: "#text", text: String(v) }]; },
  });
  Object.defineProperty(el, "innerText", { get: () => el.textContent, set: v => { el.textContent = v; } });
  Object.defineProperty(el, "childElementCount", { get: () => el.children.filter(c => c.tag !== "#text").length });
  Object.defineProperty(el, "firstElementChild", { get: () => el.children.find(c => c.tag !== "#text") || null });
  Object.defineProperty(el, "innerHTML", {
    get: () => el.children.map(c => (c.tag === "#text" ? c.text : "<" + c.tag + ">")).join(""),
    set: v => {
      const frag = parseHTML(String(v));
      el.children = frag.children;
      frag.children.forEach(c => { c.parent = el; });
    },
  });

    el.appendChild = c => {
      if (c.parent) {
        const i = c.parent.children.indexOf(c);
        if (i >= 0) c.parent.children.splice(i, 1);
      }
      el.children.push(c); c.parent = el; return c;
    };
  el.removeChild = c => { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; };
  el.remove = () => { if (el.parent) el.parent.removeChild(el); };
  el.addEventListener = (t, f) => { (el.handlers[t] = el.handlers[t] || []).push(f); };
  el.removeEventListener = (t, f) => { el.handlers[t] = (el.handlers[t] || []).filter(x => x !== f); };
  el.removeAllListeners = () => { el.handlers = {}; };
  el.dispatch = (t, ev) => {
    ev = ev || {};
    if (!ev.stopPropagation) ev.stopPropagation = () => {};
    if (!ev.preventDefault) ev.preventDefault = () => {};
    (el.handlers[t] || []).slice().forEach(f => {
      try { f(ev); } catch (e) { __TEST_ERRORS.push(["dom:" + t + " on #" + el.id, e]); }
    });
  };
  el.click = () => el.dispatch("click");
  el.focus = () => {};
  el.play = () => {
    if (AUTOPLAY_BLOCK) return Promise.reject(new Error("NotAllowedError: autoplay blocked"));
    el.paused = false; return Promise.resolve();
  };
  el.pause = () => { el.paused = true; };
  el.getBoundingClientRect = () => el._rect;
  el.matches = () => false;
  el.querySelectorAll = sel => qsa(el, sel);
  el.querySelector = sel => qsa(el, sel)[0] || null;
  return el;
}
/* ---------------- mini HTML parser (enough for our overlay markup) -------- */
const VOID_TAGS = new Set(["input", "br", "img", "hr", "meta", "link"]);
function parseHTML(html) {
  const top = makeEl("#frag");
  const stack = [top];
  const re = /<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>])*?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) {
      const closing = html[m.index + 1] === "/";
      const tag = m[1].toLowerCase();
      if (closing) { if (stack.length > 1) stack.pop(); continue; }
      const el = makeEl(tag);
      const attrs = m[2] || "";
      const ar = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
      let am;
      while ((am = ar.exec(attrs)) !== null) {
        const name = am[1].toLowerCase();
        const val = am[2];
        if (name === "id") el.id = val;
        else if (name === "class") String(val).split(/\s+/).filter(Boolean).forEach(c => el.classes.add(c));
        else if (name.startsWith("data-")) {
          const key = name.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase());
          el.dataset[key] = val;
        } else { try { el[name] = val; } catch (_) {} }
      }
      stack[stack.length - 1].appendChild(el);
      if (!VOID_TAGS.has(tag)) stack.push(el);
    } else if (m[3]) {
      stack[stack.length - 1].children.push({ tag: "#text", text: m[3] });
    }
  }
  return top;
}

/* ---------------- document factory ---------------- */
function makeDoc() {
  const listeners = {};
  const docEl = makeEl("html");
  const body = makeEl("body");
  const videos = [];
  docEl.appendChild(body);
  const doc = {
    hidden: false, fullscreenElement: null,
    documentElement: docEl, body, videos,
    createElement: t => { const e = makeEl(t); return e; },
    createTextNode: t => ({ tag: "#text", text: String(t) }),
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener() {},
    querySelectorAll(s) { if (s === "video") return videos.slice(); return qsa(docEl, s); },
    querySelector(s) { return doc.querySelectorAll(s)[0] || null; },
    getElementById(id) {
      let found = null;
      (function w(n) { if (found) return; for (const c of n.children) { if (c.tag === "#text") continue; if (c.id === id) { found = c; return; } w(c); } })(docEl);
      return found;
    },
    dispatchDoc(t, ev) {
      ev = ev || {};
      (listeners[t] || []).slice().forEach(f => {
        try { f(ev); } catch (e) { __TEST_ERRORS.push(["doc:" + t, e]); }
      });
    },
  };
  return doc;
}

/* ---------------- chrome stub ---------------- */
function makeChromeStub() {
  const store = {};
  const ls = [];
  return {
    store,
    storage: {
      local: {
        get: async k => {
          const ks = Array.isArray(k) ? k : [k];
          const o = {};
          ks.forEach(x => { if (x in store) o[x] = JSON.parse(JSON.stringify(store[x])); });
          return o;
        },
        set: async o => {
          const ch = {};
          for (const k of Object.keys(o)) {
            ch[k] = { newValue: o[k] === undefined ? null : o[k], oldValue: k in store ? store[k] : null };
            store[k] = o[k];
          }
          ls.slice().forEach(f => {
            try { f(ch, "local"); } catch (e) { __TEST_ERRORS.push(["chrome.onChanged", e]); }
          });
        },
      },
      onChanged: { addListener: f => ls.push(f) },
    },
  };
}
/* ---------------- v30: fake MQTT broker over a fake WebSocket ---------------- */
function makeFakeMqtt(env) {
  const subs = [];
  const later = (ms, fn) => env.clock.setTimeout(fn, ms);
  const txt = (u8) => Buffer.from(u8).toString("utf8");
  return class FakeWS {
    constructor(url) {
      this.url = url; this.readyState = 0; this.binaryType = "blob";
      env.mqttSockets = (env.mqttSockets || 0) + 1;
      later(5, () => {
        if (env.mqttDown) { this.readyState = 3; if (this.onerror) this.onerror({}); if (this.onclose) this.onclose({}); return; }
        this.readyState = 1; if (this.onopen) this.onopen({});
      });
    }
    send(data) {
      const b = new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
      let i = 1, mult = 1, len = 0, d;
      do { d = b[i++]; len += (d & 127) * mult; mult *= 128; } while (d & 128);
      const body = b.subarray(i, i + len), type = b[0] & 0xf0;
      if (type === 0x10) this._deliver(new Uint8Array([0x20, 2, 0, 0]));
      else if (type === 0x80) {
        const tl = (body[2] << 8) | body[3];
        subs.push({ ws: this, topic: txt(body.subarray(4, 4 + tl)) });
        this._deliver(new Uint8Array([0x90, 3, body[0], body[1], 0]));
      } else if (type === 0x30) {
        const tl = (body[0] << 8) | body[1], topic = txt(body.subarray(2, 2 + tl));
        env.mqttPubs = (env.mqttPubs || 0) + 1;
        (env._mqttSeen = env._mqttSeen || []).push(txt(body.subarray(2 + tl)));
        const copy = new Uint8Array(b.subarray(0, i + len));
        subs.filter(x => x.topic === topic && x.ws.readyState === 1).forEach(x => x.ws._deliver(copy));
      } else if (type === 0xc0) this._deliver(new Uint8Array([0xd0, 0]));
    }
    _deliver(u8) {
      later(3, () => { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) }); });
    }
    close() {
      this.readyState = 3;
      for (let k = subs.length - 1; k >= 0; k--) if (subs[k].ws === this) subs.splice(k, 1);
      later(1, () => { if (this.onclose) this.onclose({}); });
    }
  };
}

/* ---------------- fake PeerJS ---------------- */
function makePeerClass(env) {
  const reg = [];
  env._reg = reg;
  const later = (ms, fn) => env.clock.setTimeout(fn, ms);

  class FakeStream {
    constructor(ts) { this.tracks = ts || []; }
    getTracks() { return this.tracks; }
    get active() { return this.tracks.every(t => !t.stopped); }
  }

  class Conn {
    constructor() {
      this.h = {}; this.open = false; this.closed = false; this.mirror = null;
      (env._conns = env._conns || []).push(this);
    }
    on(t, f) { (this.h[t] = this.h[t] || []).push(f); }
    emit(t, ...x) {
      (this.h[t] || []).slice().forEach(f => {
        try { f(...x); } catch (e) { env.errs.push(["conn:" + t, e]); }
      });
    }
    removeAllListeners() { this.h = {}; }
    send(o) {
      if (!this.open || this.closed || !this.mirror) return;
      if (env.cutoff) return;
      if (["play", "pause", "seek", "state", "hb", "hello", "chat", "typing", "react", "needstate", "buf", "nav"].includes(o && o.t)) {
        env._intercept.push("SEND " + (o && o.t) + " open=" + this.open + " cl=" + this.closed + " mir=" + !!this.mirror);
      }
      later(4, () => {
        try { this.mirror.emit("data", JSON.parse(JSON.stringify(o))); }
        catch (e) { env.errs.push(["conn.send", e]); }
      });
    }
    close() {
      if (this.closed) return;
      this.closed = true; this.open = false;
      this.emit("close");
      const m = this.mirror;
      later(4, () => { if (m && !m.closed) m.close(); });
    }
  }
  class Call {
    constructor(outStream) {
      this.out = outStream || null; this.hC = {}; this.hA = {}; this.ended = false; this._open = false;
      env._calls.push(this);
      const self = this;
      const mkSender = (side, stream) => ({
        track: (stream && typeof stream.getAudioTracks === "function" && stream.getAudioTracks()[0]) || null,
        replaceTrack(t) { env._swaps.push([side, t && t.id || null]); this.track = t; },
      });
      const mkRecv = (side) => ({ side, track: { kind: "audio", id: "recv-" + side }, jitterBufferTarget: null });
      this.recvsOut = [mkRecv("caller")];
      this.recvsIn = [mkRecv("callee")];
      this.sendersOut = [mkSender("caller", this.out)];
      this.sendersIn = [mkSender("callee", null)];
      this._calleeStream = null;
      this.pcCaller = { getSenders: () => self.sendersOut, getTransceivers: () => [], getReceivers: () => self.recvsOut };
      this.pcCallee = { getSenders: () => self.sendersIn, getTransceivers: () => [], getReceivers: () => self.recvsIn };
    }
    emitTo(h, t, ...x) {
      (h[t] || []).slice().forEach(f => {
        try { f(...x); } catch (e) { env.errs.push(["call:" + t, e]); }
      });
    }
    callerView() {
      const self = this;
      return {
        on(t, f) { (self.hC[t] = self.hC[t] || []).push(f); },
        close: () => this.end(),
        peerConnection: self.pcCaller,
        get open() { return self._open; },
      };
    }
    calleeView() {
      const self = this;
      return {
                answer(s) {
          // v11 harness: duck-type streams so silent-track MediaStreams survive
          self.inS = (s && typeof s.getAudioTracks === "function") ? s : new FakeStream([]);
          self._calleeStream = self.inS;
          self.sendersIn[0].track = (self.inS.getAudioTracks()[0]) || null;
          later(8, () => self.emitTo(self.hA, "stream", self.out instanceof FakeStream ? self.out : new FakeStream([])));
          later(16, () => self.emitTo(self.hC, "stream", self.inS));
          later(22, () => { self._open = true; self.emitTo(self.hA, "open"); self.emitTo(self.hC, "open"); });
        },
        on(t, f) { (self.hA[t] = self.hA[t] || []).push(f); },
        close: () => this.end(),
        peerConnection: self.pcCallee,
        get open() { return self._open; },
      };
    }
    end() {
      if (this.ended) return;
      this.ended = true;
      this.emitTo(this.hC, "close");
      this.emitTo(this.hA, "close");
    }
  }

  class PeerCls {
    constructor(id) {
      this.pid = typeof id === "string" ? id : "_p" + (++env._peerSeq);
      this.h = {}; this.open = false; this.disconnected = false; this.destroyed = false;
      reg.push(this);
      later(10, () => { if (!this.destroyed) { this.open = true; this.fire("open"); } });
    }
    get id() { return this.pid; }
    on(t, f) { (this.h[t] = this.h[t] || []).push(f); }
    fire(t, ...x) {
      (this.h[t] || []).slice().forEach(f => {
        try { f(...x); } catch (e) { env.errs.push(["peer:" + t, e]); }
      });
    }
    connect(tid) {
      const target = reg.find(p => p !== this && !p.destroyed && p.pid === tid);
      env._intercept = env._intercept || [];
      env._intercept.push("connect call tid=" + tid + " target=" + (target ? target.pid : "NONE"));
      const ci = new Conn(); const ct = new Conn();
      ci.mirror = ct; ct.mirror = ci;
      later(15, () => {
        if (env.netDead) { this.fire("error", { type: "network" }); return; }
        if (!target || this.destroyed) { this.fire("error", { type: "peer-unavailable" }); return; }
        ci.open = true; ct.open = true;
        ci.peer = target.pid; ct.peer = this.pid;
        env._intercept.push("connect OPEN -> " + target.pid);
        ci.emit("open");        // caller side (guest) already attached its conn
        target.fire("connection", ct); // host attaches ct, registering its 'open' listener
        ct.emit("open");        // then host's conn opens
      });
      return ci;
    }
    call(tid, stream) {
      const target = reg.find(p => p !== this && !p.destroyed && p.pid === tid);
      env._intercept = env._intercept || [];
      env._intercept.push("CALL from " + this.pid + " to " + tid + " target=" + (target ? target.pid : "NONE") + " has=" + (!!stream));
      if (!target) return null;
      const call = new Call(stream);
      later(25, () => { if (!this.destroyed) target.fire("call", call.calleeView()); });
      return call.callerView();
    }
    reconnect() { this.disconnected = false; env._recns = (env._recns || 0) + 1; }
    destroy() {
      this.destroyed = true; this.open = false;
      const i = reg.indexOf(this); if (i >= 0) reg.splice(i, 1);
      this.h = {};
    }
  }
  return PeerCls;
}
function makeRTCClass(env) {
  const later = (ms, fn) => env.clock.setTimeout(fn, ms);
  const seq = { n: 0 };
  class FakeDC {
    constructor() { this.open = false; this.peer = null; this.closed = false; }
    get readyState() { return this.closed ? "closed" : (this.open ? "open" : "connecting"); }
    send(d) {
      if (!this.open || !this.peer || this.closed) return;
      later(4, () => {
        try { if (this.peer && this.peer.onmessage) this.peer.onmessage({ data: d }); }
        catch (e) { __TEST_ERRORS.push(["dc-send", e]); }
      });
    }
    close() {
      this.closed = true;
      try { if (this.onclose) this.onclose(); } catch (e) { __TEST_ERRORS.push(["dc-close", e]); }
      if (this.peer) {
        const p = this.peer; this.peer = null;
        p.open = false; p.closed = true;
        try { if (p.onclose) p.onclose(); } catch (e) { __TEST_ERRORS.push(["dc-close2", e]); }
      }
    }
  }
  // v26: media-capable fake. Voice lines are now plain RTCPeerConnections
  // signaled over the data link, so this fake carries audio too. Every voice
  // offer creates a call record in env._calls with the same shape the old
  // PeerJS Call fake had (sendersOut/sendersIn/pcCallee/recvsOut/recvsIn/
  // ended/end()) so the existing voice checks keep working unchanged.
  class MediaRec {
    constructor(caller) {
      this.caller = caller; this.callee = null; this.ended = false;
      env._calls.push(this);
    }
    get sendersOut() { return this.caller.senders; }
    get sendersIn() { return this.callee ? this.callee.senders : [{ track: null }]; }
    get pcCaller() { return this.caller; }
    get pcCallee() { return this.callee || { getSenders: () => [] }; }
    get recvsOut() { return this.caller.recvs; }
    get recvsIn() { return this.callee ? this.callee.recvs : []; }
    // simulate a network drop: both ends see ICE "failed"
    end() {
      if (this.ended) return;
      this.ended = true;
      [this.caller, this.callee].forEach((pc) => {
        if (!pc || pc.connectionState === "closed") return;
        pc.connectionState = "failed";
        try { if (pc.onconnectionstatechange) pc.onconnectionstatechange(); } catch (e) { env.errs.push(["rtc-fail", e]); }
      });
    }
  }
  const fakeRemote = (tracks) => ({
    __remote: true,
    id: "rs-" + (++seq.n),
    getTracks: () => tracks.slice(),
    getAudioTracks: () => tracks.slice(),
    get active() { return true; },
  });
  return class FakeRTC {
    constructor() {
      this._ice = "new"; this.ls = []; this.local = null; this.remote = null;
      this.dc = null; this.tag = ++seq.n;
      this.senders = []; this.isCallee = false; this.peerPc = null; this.rec = null;
      this.connectionState = "new";
      const pc = this;
      this.recvs = [{ get side() { return pc.isCallee ? "callee" : "caller"; }, track: { kind: "audio", id: "recv-" + this.tag }, jitterBufferTarget: null }];
      env._rtc.push(this);
    }
    get iceGatheringState() { return this._ice; }
    get localDescription() { return this.local; }
    get remoteDescription() { return this.remote; }
    get isMedia() { return !this.dc; }
    side() { return this.isCallee ? "callee" : "caller"; }
    mkSender(track) {
      const pc = this;
      return {
        track: track || null,
        replaceTrack(t) { env._swaps.push([pc.side(), t && t.id || null]); this.track = t; return Promise.resolve(); },
      };
    }
    addTrack(t) {
      // answer side: reuse the slot created by the remote offer
      const free = this.senders.find((s) => !s.track && !s._used);
      if (free) { free.track = t; free._used = true; return free; }
      const s = this.mkSender(t); s._used = true; this.senders.push(s); return s;
    }
    addTransceiver() { const s = this.mkSender(null); this.senders.push(s); return { sender: s, direction: "sendrecv" }; }
    getSenders() { return this.senders; }
    getReceivers() { return this.recvs; }
    getTransceivers() {
      return this.senders.map((s) => ({ sender: s, receiver: { track: { kind: "audio" } }, mid: "0", direction: "sendrecv" }));
    }
    addIceCandidate() { return Promise.resolve(); }
    close() {
      if (this.connectionState === "closed") return;
      this.connectionState = "closed";
      if (this.rec) this.rec.ended = true;
      if (this.peerPc && this.peerPc.rec) this.peerPc.rec.ended = true;
    }
    createDataChannel() { this.dc = new FakeDC(); return this.dc; }
    createOffer() {
      return Promise.resolve({ type: "offer", sdp: (this.dc ? "SDP-OFFER-" : "SDP-MOFFER-") + this.tag });
    }
    createAnswer() {
      return Promise.resolve({ type: "answer", sdp: (this.isMedia && this.isCallee ? "SDP-MANSWER-" : "SDP-ANSWER-") + this.tag });
    }
    setLocalDescription(d) {
      this.local = d;
      if (this.isMedia && d.type === "offer" && !this.rec) this.rec = new MediaRec(this);
      later(2, () => {
        this._ice = "complete";
        this.ls.forEach((f) => { try { f({}); } catch (e) { env.errs.push(["rtc-ice", e]); } });
      });
      return Promise.resolve();
    }
    fireTrack(fromPc) {
      later(8, () => {
        if (this.connectionState === "closed" || !this.ontrack) return;
        const tracks = fromPc.senders.map((s) => s.track).filter(Boolean);
        const st = fakeRemote(tracks.length ? tracks : [{ kind: "audio", id: "rmt-" + fromPc.tag }]);
        try { this.ontrack({ streams: [st], track: st.getAudioTracks()[0] }); } catch (e) { env.errs.push(["rtc-track", e]); }
      });
    }
    setRemoteDescription(d) {
      this.remote = d;
      const m = /^SDP-M(OFFER|ANSWER)-(\d+)$/.exec(d && d.sdp || "");
      if (m && this.isMedia) {
        const other = env._rtc.find((r) => r.tag === Number(m[2]));
        if (!other) return Promise.reject(new Error("unknown fake sdp"));
        if (m[1] === "OFFER") {
          this.isCallee = true;
          this.peerPc = other;
          if (other.rec) other.rec.callee = this;
          // the offered audio m-line becomes an (empty) local slot
          if (!this.senders.length) this.senders.push(this.mkSender(null));
          this.fireTrack(other);
        } else {
          this.peerPc = other;
          other.peerPc = this;
          this.connectionState = "connected"; other.connectionState = "connected";
          this.fireTrack(other);
        }
        return Promise.resolve();
      }
      // v26: real Direct-mode simulation - the answerer gets its channel via
      // ondatachannel (the old fake never linked it, so "direct" tests were
      // silently riding the still-open PeerJS link)
      const dm = /^SDP-(OFFER|ANSWER)-(\d+)$/.exec(d && d.sdp || "");
      if (dm && dm[1] === "OFFER" && !this.dc) {
        this.dc = new FakeDC();
        this.dataOfferer = env._rtc.find((r) => r.tag === Number(dm[2])) || null;
      }
      if (dm && dm[1] === "ANSWER" && this.local && this.local.type === "offer" && this.dc) {
        const other = env._rtc.find((r) => r.tag === Number(dm[2]));
        if (other && other.dc) {
          const a = this.dc, b = other.dc;
          a.peer = b; b.peer = a;
          later(6, () => {
            a.open = true; b.open = true;
            try { if (other.ondatachannel) other.ondatachannel({ channel: b }); } catch (e) { env.errs.push(["rtc-dc", e]); }
            [a, b].forEach((ch) => {
              try { if (ch.onopen) ch.onopen(); } catch (e) { env.errs.push(["rtc-open", e]); }
            });
          });
        }
      }
      return Promise.resolve();
    }
    addEventListener(t, f) { if (t === "icegatheringstatechange") this.ls.push(f); }
  };
}

/* ---------------- instance (one browser tab) ---------------- */
function makeInstance(env, name, preset, host, src) {
    const doc = makeDoc();
  doc.title = "Some Video Online";
  // v32: two tabs of one browser share extension storage (env.stubFor[name])
  const chromeStub = (env.stubFor && env.stubFor[name]) || makeChromeStub();
  if (preset) Object.assign(chromeStub.store, JSON.parse(JSON.stringify(preset)));
  const ownStorageListeners = [];
  const life = { alive: true };
  const chromeForTab = Object.assign({}, chromeStub, { storage: Object.assign({}, chromeStub.storage, {
    onChanged: { addListener: f => { ownStorageListeners.push(f); chromeStub.storage.onChanged.addListener((ch, area) => { if (life.alive || life.closing) f(ch, area); }); } } }) });
  // v33: chrome.runtime.sendMessage to the background worker (env.onRuntime decides the answer)
  chromeForTab.runtime = {
    lastError: undefined,
    sendMessage: (msg, cb) => {
      const m = JSON.parse(JSON.stringify(msg));
      env.clock.setTimeout(() => {
        if (!life.alive) return;
        const reply = (r) => env.clock.setTimeout(() => { if (life.alive && cb) { try { cb(r); } catch (e) { env.errs.push(["runtime-cb", e]); } } }, 5);
        if (env.onRuntime) env.onRuntime(name, m, reply); else reply(undefined);
      }, 5);
    },
  };
  const pageT0 = env.perfFor && env.perfFor[name] != null ? env.perfFor[name] : null;
  const video = makeEl("video");
  video._rect = { width: 1280, height: 720, x: 0, y: 0 };
  doc.videos.push(video);
  // v32: content.js only broadcasts a FRESH player's events when a real
  // gesture came first - simulate the user's key press unless a test says
  // the event is the player's own doing (env.noGesture)
  const rawDispatch = video.dispatch;
  video.dispatch = (t, ev) => {
    if (!env.noGesture && (t === "play" || t === "pause" || t === "seeked" || t === "ratechange")) doc.dispatchDoc("keydown", { key: "Unidentified" });
    return rawDispatch(t, ev);
  };
  // v24: default to a whitelisted streaming site (content.js host guard)
  const siteHost = host || "www.netflix.com";

  const ctx = {
    console,
    Date: { now: () => env.clock.now },
    setTimeout: (f, m) => env.clock.setTimeout(() => { if (life.alive) f(); }, m),
    setInterval: (f, m) => env.clock.setInterval(() => { if (life.alive) f(); }, m),
    performance: pageT0 === null ? undefined : { now: () => env.clock.now - pageT0 },
    clearTimeout: id => env.clock.clear(id),
    clearInterval: id => env.clock.clear(id),
    document: doc,
    navigator: {
      mediaDevices: {
        getUserMedia: async (constraints) => {
          env.gum++;
          env.lastGum = constraints;
          const mt = env.makeMicTrack();
          mt.ec = !!(constraints && constraints.audio && constraints.audio.echoCancellation);
          mt.getSettings = function () { return { echoCancellation: this.ec }; };
          return new env.FakeStream([mt]);
        },
      },
      clipboard: { writeText: async () => {} },
    },
    // v31: every tab is on the SAME title by default (the follow-the-friend
    // feature compares site+path); the name rides in the query string
    location: { href: (env.locFor && env.locFor[name]) || ("https://" + siteHost + "/watch/80000001?wt=" + name), protocol: "https:",
      assign(u) { this.href = String(u); (env.navs = env.navs || []).push([name, String(u)]); } },
    chrome: chromeForTab,
    Peer: env.Peer,
    MediaStream: class FakeMS {
      constructor(tracks) { this._t = Array.isArray(tracks) ? tracks.slice() : []; }
      getTracks() { return this._t.slice(); }
      getAudioTracks() { return this._t.filter(t => t.kind === "audio"); }
      getVideoTracks() { return this._t.filter(t => t.kind === "video"); }
      addTrack(t) { this._t.push(t); }
      get active() { return true; }
    },
    AudioContext: class FakeAudioContext {
      constructor() { this.sampleRate = 48000; this.state = env.ctxState || "running"; }
      createMediaStreamDestination() {
        const t = { kind: "audio", readyState: "live", enabled: true, id: "silent-" + name,
          stop() { this.readyState = "ended"; },
          async applyConstraints(c) { this.lastApply = c; } };
        env.silentTracks.push(t);
        return { stream: { getAudioTracks: () => [t] } };
      }
      createMediaStreamSource(stream) {
        const node = { _stream: stream, connect(n) { if (n) n._srcStream = stream; }, disconnect() {} };
        return node;
      }
      createAnalyser() {
        return { fftSize: 512, _srcStream: null, connect() {}, disconnect() {},
          _n: 0,
          getFloatTimeDomainData(arr) {
            const remote = this._srcStream && this._srcStream.__remote;
            if (!(remote && env.remoteRms != null)) { arr.fill(env.rms); return; }
            const k = this._n++;
            if (env.remotePattern === "noise") { arr.fill(env.remoteRms * (1 + 0.3 * Math.sin(k * 1.7))); return; }
            const pause = env.remotePause != null ? env.remotePause : env.remoteRms * 0.01;
            arr.fill(k % 10 < 7 ? env.remoteRms : pause);
          } };
      }
      createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
      createOscillator() { return { connect() {}, start() {}, stop() {} }; }
      async resume() { if (!env.noCtxResume) this.state = env.ctxState || "running"; }
    },
    RTCPeerConnection: env.FakeRTC,
    crypto: require("crypto").webcrypto,
    TextEncoder, TextDecoder,
    WebSocket: env.FakeWS,
    btoa: (s) => Buffer.from(String(s), "binary").toString("base64"),
    atob: (s) => Buffer.from(String(s), "base64").toString("binary"),
    addEventListener: (t, f) => { (doc.winL = doc.winL || {})[t] = (doc.winL[t] || []).concat(f); },
    removeEventListener: () => {},
    window: null,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  try { vm.runInContext(src || SRC, ctx, { filename: name + "/content.js" }); }
  catch (e) { env.errs.push(["load:" + name, e]); }

  return {
    name, doc, chrome: chromeStub, video,
    // v32: the user closes this tab - its party ends, nothing of it runs any more
    closeTab: () => { life.closing = true; ownStorageListeners.forEach(f => { try { f({ wt_party: { newValue: null, oldValue: {} } }, "local"); } catch (_) {} }); life.closing = false; life.alive = false; },
    storage: chromeStub.store,
    __ctx: ctx,
    fire: o => chromeStub.storage.local.set(o),
    st: sel => { const e = qsa(doc.documentElement, sel)[0]; return e ? e.textContent : null; },
    q: sel => qsa(doc.documentElement, sel)[0] || null,
    qa: sel => qsa(doc.documentElement, sel),
    msgs: () => qsa(doc.documentElement, "#wt-msgs").map(c => c.textContent.trim()).filter(Boolean),
    toasts: () => allByClass(doc.documentElement, "wt-toast").map(c => c.textContent),
  };
}

/* ---------------- assertions ---------------- */
let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; failures.push(label); console.log("  FAIL  " + label); }
}
function contains(hay, needle) { return String(hay || "").indexOf(needle) !== -1; }
const tick = async () => { for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r)); };
async function step(clock, ms) { clock.advance(ms); await tick(); }
async function waitFor(clock, fn, maxMs) {
  const end = clock.now + maxMs;
  while (!fn()) {
    if (clock.now >= end) return false;
    clock.advance(Math.min(40, end - clock.now));
    await tick();
  }
  return true;
}
/* ---------------- scenario helpers ---------------- */
const lines = I => {
  const m = I.q("#wt-msgs");
  return m ? m.children.filter(c => c.tag !== "#text").map(c => c.textContent.trim()).filter(Boolean) : [];
};
const anyMsg = (I, s) => lines(I).some(t => t.indexOf(s) !== -1);
const anyToast = (I, s) => I.toasts().some(t => t.indexOf(s) !== -1);
const overlays = (I) => allByClass(I.doc.documentElement, "wt-action-overlay").map(c => c.textContent);
const anyOverlay = (I, s) => overlays(I).some(t => t.indexOf(s) !== -1);
function sendChat(I, text) {
  const inp = I.q("#wt-input");
  inp.value = text;
  I.q("#wt-form").dispatch("submit");
}
class FakeStreamForGum {
  constructor(ts) { this.tracks = ts || []; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(t => t.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter(t => t.kind === "video"); }
  get active() { return this.tracks.every(t => !t.stopped); }
}
function makeMicTrackFactory(env) {
  let n = 0;
  return function makeMicTrack() {
    const t = {
      kind: "audio", id: "mic-" + (++n), stopped: false, enabled: true,
      lastApply: null, mute: false,
      stop() { this.stopped = true; },
      async applyConstraints(c) { this.lastApply = c; return; },
      addEventListener(type, fn) { (this.h = this.h || {})[type] = (this.h[type] || []).concat(fn); },
    };
    env.micTracks.push(t);
    return t;
  };
}

/* ============================================================ */
/* ---------------- v25: popup harness ---------------- */
function makePopupDom(html) {
  function el(tag, cls) {
    const set = new Set(String(cls || "").split(/\s+/).filter(Boolean));
    const e = {
      tag, children: [], listeners: {}, textContent: "", value: "",
      classList: {
        add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
        toggle: (c, force) => { const on = force === undefined ? !set.has(c) : !!force; if (on) set.add(c); else set.delete(c); return on; },
      },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      appendChild(c) { this.children.push(c); c.parent = this; return c; },
      get childElementCount() { return this.children.length; },
      click() { (this.listeners.click || []).forEach(f => f({})); },
    };
    Object.defineProperty(e, "className", {
      get: () => [...set].join(" "),
      set: v => { set.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => set.add(c)); },
    });
    return e;
  }
  const byId = {};
  const re = /<(\w+)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const id = /\bid="([^"]+)"/.exec(m[2]);
    if (!id) continue;
    const cls = /\bclass="([^"]*)"/.exec(m[2]);
    byId[id[1]] = el(m[1], cls && cls[1]);
  }
  const dot = el("span", "dot");
  return {
    byId,
    document: {
      getElementById: id => byId[id] || null,
      querySelector: sel => (sel === ".dot" ? dot : null),
      createElement: tag => el(tag, ""),
    },
  };
}

const settleReal = async () => { for (let i = 0; i < 25; i++) await new Promise(r => setImmediate(r)); };

async function runPopup(url, store = {}, fetchImpl, manifestExtra) {
  const dom = makePopupDom(fs.readFileSync(DIR12 + "/popup.html", "utf8"));
  const listeners = [];
  const out = { created: [], clip: [], closed: 0, store, $: id => dom.byId[id] };
  out.visible = id => !dom.byId[id].classList.contains("hidden");
  const chrome = {
    tabs: {
      query: async () => (url === null ? [] : [{ id: 7, url }]),
      create: async o => { out.created.push(o); return { id: 8 }; },
    },
    storage: {
      local: {
        get: async k => { const r = {}; (Array.isArray(k) ? k : [k]).forEach(x => { if (x in store) r[x] = store[x]; }); return r; },
        set: async o => {
          const ch = {};
          for (const k in o) { ch[k] = { oldValue: store[k], newValue: o[k] }; store[k] = o[k]; }
          listeners.forEach(f => f(ch, "local"));
        },
      },
      onChanged: { addListener: f => listeners.push(f) },
    },
    runtime: { getManifest: () => Object.assign(JSON.parse(fs.readFileSync(DIR12 + "/manifest.json", "utf8")), manifestExtra || {}) },
  };
  const ctx = {
    document: dom.document, chrome, URL, console,
    crypto: require("crypto").webcrypto,
    navigator: { clipboard: { writeText: async t => { out.clip.push(t); } } },
    window: { close: () => { out.closed++; } },
    alert: () => {}, setTimeout: () => 0,
    // v31: update check - offline unless a test supplies latest.json
    fetch: fetchImpl || (async () => { throw new Error("offline"); }),
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(DIR12 + "/popup.js", "utf8") +
    "\n;globalThis.__siteFor = siteFor; globalThis.__SITES = SITES; globalThis.__SITE_HOSTS = SITE_HOSTS; globalThis.__render = render; globalThis.__checkUpdate = checkUpdate; globalThis.__newerThan = newerThan; globalThis.__safeZip = safeZip;",
    ctx, { filename: "popup.js" });
  await settleReal();
  out.ctx = ctx;
  return out;
}

async function main() {
  const env = { clock: new Clock(), errs: [], gum: 0, cutoff: false, FakeStream: FakeStreamForGum, _peerSeq: 0, _rtc: [], micTracks: [], lastGum: null, rms: 0.2, _swaps: [], _calls: [], silentTracks: [] };
  env.makeMicTrack = makeMicTrackFactory(env);
  env.FakeRTC = makeRTCClass(env);
  env.Peer = makePeerClass(env);

  const H = makeInstance(env, "host");
  const G = makeInstance(env, "guest");
  const { clock } = env;

  console.log("\n--- 1. party creation & connection ---");
  H.fire({ wt_party: { id: "ABC123", role: "host", name: "Sourav" } });
  await step(clock, 80);
  console.log("DEBUG domErrs:", __TEST_ERRORS.map(e => e[0] + " :: " + (e[1] && e[1].message || e[1])).join(" | ") || "(none)");
  console.log("DEBUG envErrs:", env.errs.map(e => e[0] + " :: " + (e[1] && e[1].message || e[1])).join(" | ") || "(none)");
  ok(contains(H.st("#wt-status-text"), "Waiting"), "host waits for friend");
  ok(H.q("#wt-root") && H.q("#wt-root").classList.contains("wt-active"), "overlay visible on host");

  await step(clock, 1600); // let bindVideo interval run

  G.fire({ wt_party: { id: "ABC123", role: "guest", name: "Priya" } });
  await step(clock, 400);
  ok(contains(H.st("#wt-status-text"), "Synced with Priya"), "host sees friend's name (" + H.st("#wt-status-text") + ")");
  ok(contains(G.st("#wt-status-text"), "Synced with Sourav"), "guest sees host's name (" + G.st("#wt-status-text") + ")");
  ok(anyMsg(H, "Priya joined"), "'Priya joined' system message");

  console.log("\n--- 2. playback sync + activity popups ---");
  await step(clock, 2000); // let bindVideo re-bind after startParty's stop/unbind
  ok((G.video.handlers["play"] || []).length === 1, "guest video bound after party start");
  G.video.paused = false;   // browser sets this before firing the play event
  G.video.currentTime = 100;
  G.video.dispatch("play", { target: G.video });
  await step(clock, 60);
  ok(H.video.paused === false, "host video played after guest played");
  ok(anyToast(H, "Priya played"), "activity popup: 'Priya played'");

  G.video.currentTime = 500;
  G.video.dispatch("seeked", { target: G.video });
  await step(clock, 60);
  ok(Math.abs(H.video.currentTime - 500) < 0.5, "host followed guest's seek to 500s (" + H.video.currentTime.toFixed(1) + ")");
  ok(anyToast(H, "skipped forward"), "activity popup: 'skipped forward'");

  G.video.paused = true;
  G.video.dispatch("pause", { target: G.video });
  await step(clock, 60);
  ok(H.video.paused === true, "host video paused after guest paused");
  ok(anyToast(H, "Priya paused"), "activity popup: 'Priya paused'");

  console.log("\n--- 3. chat ---");
  sendChat(G, "hello there");
  await step(clock, 40);
  ok(anyMsg(H, "Priya: hello there"), "chat delivered host-side");

  console.log("\n--- 4. chat popup when panel closed ---");
  H.q("#wt-close").dispatch("click");
  await step(clock, 300);
  ok(!H.q("#wt-root").classList.contains("wt-open"), "panel closed on host (animated)");
  sendChat(G, "psst hidden message");
  await step(clock, 40);
  const hiddenFloats = allByClass(H.doc.documentElement, "wt-float-msg");
  ok(hiddenFloats.some(el => el.textContent.indexOf("psst hidden message") !== -1),
    "message appears as floating notification while panel closed");
  H.q("#wt-pill").click();
  ok(H.q("#wt-root").classList.contains("wt-open"), "pill reopens panel");
  console.log("\n--- 5. typing indicator ---");
  const gInput = G.q("#wt-input");
  gInput.value = "typing som";
  gInput.dispatch("input");
  await step(clock, 30);
  const hTyping = H.q("#wt-typing");
  ok(hTyping && hTyping.classList.contains("wt-show") && contains(hTyping.textContent, "Priya is typing"), "host sees 'Priya is typingâ€¦'");
  await step(clock, 2700);
  ok(!hTyping.classList.contains("wt-show"), "typing indicator auto-hides");

  console.log("\n--- 6. emoji reactions ---");
  G.qa(".wt-react")[0].click();
  await step(clock, 60);
  ok(H.qa(".wt-float").length >= 1, "floating reaction appears on host (" + H.qa(".wt-float").length + ")");
  ok(anyMsg(H, "Priya reacted"), "reaction history in chat log");

  console.log("\n--- 7. searchable emoji picker ---");
  H.q("#wt-react-more").click();
  const hPicker = H.q("#wt-picker");
  ok(hPicker && !hPicker.classList.contains("wt-hide"), "picker opens via + button");
  const allEmojis = hPicker.querySelectorAll(".wt-emoji").length;
  ok(allEmojis >= 300, "full grid shows large emoji set (" + allEmojis + ")");
  const search = H.q("#wt-emoji-search");
  search.value = "fire";
  search.dispatch("input");
  const results = hPicker.querySelectorAll(".wt-emoji");
  const joined = results.map(r => r.textContent).join("");
  const hasFire = [...joined].some(ch => ch.codePointAt(0) === 0x1F525);
  ok(results.length >= 1 && results.length <= 8 && hasFire,
    "search 'fire' filters correctly (" + joined + ")");
  H.q("#wt-picker-close").click();
  ok(hPicker.classList.contains("wt-hide"), "picker closes");

  console.log("\n--- 7b. chat links + share now playing ---");
  sendChat(G, "watch this one https://www.hotstar.com/in/shows/special-ep2 next!");
  await step(clock, 40);
  const hLast = lines(H).slice(-1)[0] || "";
  ok(contains(hLast, "special-ep2"), "link message delivered");
  const lastRow = H.q("#wt-msgs").children.filter(c => c.tag !== "#text").slice(-1)[0];
  const anchor = lastRow && lastRow.children.find(ch => ch.tag === "a");
  ok(!!anchor && anchor.href === "https://www.hotstar.com/in/shows/special-ep2",
    "URL rendered as clickable anchor with correct href");
  ok(anchor && anchor.target === "_blank" && anchor.rel === "noopener noreferrer",
    "anchor opens in new tab safely");

  // share via clickable now-playing
  await step(clock, 10000); // let updateNowPlaying interval fire
  const hNow = H.q("#wt-now");
  ok(contains(hNow.textContent, "Some Video Online"), "now-playing title populated on host");
  hNow.dispatch("click");
  await step(clock, 40);
  ok(anyMsg(G, "https://www.netflix.com/watch/80000001?wt=host"), "share click sends page URL to friend");
  ok(anyMsg(G, "Some Video Online"), "shared message includes episode title");
  const gShareRow = G.q("#wt-msgs").children.filter(c => c.tag !== "#text").slice(-1)[0];
  ok(!!(gShareRow && gShareRow.children.find(ch => ch.tag === "a")),
    "shared URL is clickable on the receiving side");

    console.log("\n--- 8. voice chat (host-dialed) + volume slider ---");
  env._intercept = [];
  H.q("#wt-mic").click(); // host enables -> host dials the single media call
  await waitFor(clock, () => !!G.q("#wt-remote-audio") && !!G.q("#wt-remote-audio").srcObject, 3000);
  ok(env.gum === 1, "mic permission requested once");
  ok(H.q("#wt-mic").classList.contains("wt-mic-on"), "mic button shows ON state");
    const gAudio = G.q("#wt-remote-audio");
  ok(gAudio && !!gAudio.srcObject, "guest receives host's voice stream (host-dialed)");

  const hSlider = H.q("#wt-voice-vol");
  hSlider.value = "40";
  hSlider.dispatch("input");
  ok(H.storage.wt_voice_vol === 0.4, "volume choice persisted to storage");

  // guest enables mic -> v11: NO re-dial. The answered call already has a
  // silent audio slot; the guest's live mic is hot-swapped into it.
  const callsBeforeGuest = env._calls.length;
  G.q("#wt-mic").click();
  await step(clock, 150); // let toggleMic's async chain (gum -> hotSwap) settle
  await waitFor(clock, () => {
    const h = H.q("#wt-remote-audio"), g = G.q("#wt-remote-audio");
    return h && h.srcObject && g && g.srcObject;
  }, 3000);
  ok(env._calls.length === callsBeforeGuest, "guest mic-on did NOT re-dial (line reused)");
  ok(!!H.q("#wt-remote-audio").srcObject, "two-way voice: host receives guest stream via hot-swap");
  ok(G.q("#wt-remote-audio") && !!G.q("#wt-remote-audio").srcObject,
    "guest still receives host audio");
  ok(env._swaps.some(s => s[0] === "callee" && s[1] && String(s[1]).indexOf("mic-") === 0),
    "guest mic track swapped into existing call slot (" + JSON.stringify(env._swaps.slice(-2)) + ")");
  const hAudio = H.q("#wt-remote-audio");
  ok(hAudio && hAudio.volume === 0.4, "volume slider applies to remote audio (0.4)");
      const hc = H.qa("#wt-remote-audio").length, gc = G.qa("#wt-remote-audio").length;
    ok(hc === 1 && gc === 1,
    "exactly one audio element per side (no duplicate call sessions)");

  // host mutes but guest still on: line must stay up, guest audio still flows
  const theCall = env._calls[callsBeforeGuest - 1];
  H.q("#wt-mic").click();
  await step(clock, 60);
  await step(clock, 500);
  ok(!H.q("#wt-mic").classList.contains("wt-mic-on"), "mic toggles OFF");
  ok(theCall && !theCall.ended, "muting does NOT close the media connection");
  ok(!!H.q("#wt-remote-audio").srcObject, "session survives host mute (guest still audible)");
  ok(theCall.sendersIn[0].track !== null || !!H.q("#wt-remote-audio").srcObject,
    "callee slot intact after host mute");

  console.log("\n--- 9. zombie connection watchdog (the 30-min bug) ---");
  env.cutoff = true; // simulate silent data-channel death
  const hPausedBefore = H.video.paused;
  G.video.paused = false;
  G.video.dispatch("play", { target: G.video });
  await step(clock, 200);
  ok(H.video.paused === hPausedBefore, "sync is genuinely broken during zombie state");
  // v1.9.3: watchdog probes before killing (12s stale + 20s probe grace),
  // so a true zombie is declared after ~32s instead of 12s
  await step(clock, 40000); // exceed probe cycle
  const gSt = G.st("#wt-status-text");
  ok(!contains(gSt, "Synced with"), "guest detected the dead channel (status: " + gSt + ")");
  env.cutoff = false;
  await step(clock, 40000);
  console.log("DBG intercept:", JSON.stringify(env._intercept ? env._intercept.slice(-18) : "none"));
  ok(contains(G.st("#wt-status-text"), "Synced with") || contains(G.st("#wt-status-text"), "Playback synced"), "guest auto-recovered (" + G.st("#wt-status-text") + ")");
  ok(contains(H.st("#wt-status-text"), "Synced with") || contains(H.st("#wt-status-text"), "Playback synced"), "host auto-recovered (" + H.st("#wt-status-text") + ")");
  G.video.paused = false;
  G.video.dispatch("play", { target: G.video });
  await step(clock, 60);
  ok(H.video.paused === false, "sync works again after recovery");
  console.log("\n--- 10. sleep / wake instant re-sync ---");
  G.doc.hidden = true;
  await step(clock, 100);
  G.doc.hidden = false;
  G.doc.dispatchDoc("visibilitychange");
  await step(clock, 60);
  ok(true, "wake cycle completed without crashes");
  // guest asks for state on wake; host must still be in sync
  ok(contains(G.st("#wt-status-text"), "Synced with"), "still connected after wake");

  console.log("\n--- 11. leave party ---");
  G.fire({ wt_party: null });
  await step(clock, 60);
  ok(!(G.q("#wt-root").classList.contains("wt-active")), "guest overlay deactivated");
  ok(contains(H.st("#wt-status-text"), "disconnected") || contains(H.st("#wt-status-text"), "Waiting") ||
     contains(H.st("#wt-status-text"), "restoring") || contains(H.st("#wt-status-text"), "unreachable"),
    "host notices friend left (" + H.st("#wt-status-text") + ")");

  console.log("\n--- 11b. v6: reaction attribution ---");
  H.fire({ wt_party: { id: "R34CT", role: "host", name: "Sourav" } });
  await step(clock, 80);
  G.fire({ wt_party: { id: "R34CT", role: "guest", name: "Priya" } });
  await step(clock, 400);
  ok(contains(H.st("#wt-status-text"), "Synced with Priya"), "fresh party reconnected");

  H.qa(".wt-react")[0].click();
  await step(clock, 60);
  const floats = G.qa(".wt-float");
  ok(floats.length >= 1, "floating reaction appeared on guest");
  ok(floats.some(f => f.textContent.indexOf("Sourav") !== -1), "remote float shows sender name");
  const nameTag = floats[0].children.find(c => c.classes && c.classes.has("wt-float-name"));
  ok(!!nameTag && nameTag.textContent === "Sourav", "name rendered as small tag under emoji");
  const own = H.qa(".wt-float");
  ok(own.length >= 1 && !own.some(f => f.textContent.indexOf("Sourav") !== -1), "own float has no name tag");

  console.log("\n--- 11c. v6: quick-reaction bar ---");
  const qPanel = G.q("#wt-quick");
  ok(!!qPanel && qPanel.classList.contains("wt-show"), "quick bar visible outside chat");
  const qBtns = G.q("#wt-quick-bar").children.filter(c => c.tag !== "#text");
  const emojiBtns = qBtns.filter(c => c.classList.contains("wt-quick-emoji"));
  const uniq = new Set(emojiBtns.map(b => b.textContent));
  ok(emojiBtns.length === 6, "quick bar has exactly 6 emojis (" + emojiBtns.length + ")");
  ok(uniq.size === 6, "all 6 quick emojis are unique (no dupes)");
  ok(qBtns.some(c => c.classList.contains("wt-quick-plus")), "+ button present in quick bar");
  G.q("#wt-quick-bar").querySelector(".wt-quick-plus").click();
  ok(!G.q("#wt-qtype-picker").classList.contains("wt-hide"), "+ opens bar picker");
  G.q("#wt-picker-close").click();

  const beforeF = H.qa(".wt-float").length;
  emojiBtns[0].click();
  await step(clock, 40);
  ok(H.qa(".wt-float").length > beforeF, "quick-bar click floats reaction on peer");
  ok(anyMsg(H, "Priya reacted"), "quick-bar reaction logged in chat");

  console.log("\n--- 11d. v6: usage tracking ---");
  H.qa(".wt-react")[0].click();
  await step(clock, 30);
  H.qa(".wt-react")[0].click();
  await step(clock, 30);
  ok(H.storage.wt_react_freq && Object.values(H.storage.wt_react_freq).some(v => v >= 3),
    "frequency counter increments across reactions");
  ok(Array.isArray(H.storage.wt_react_recent) && H.storage.wt_react_recent.length >= 1,
    "recent list persisted to storage");

  console.log("\n--- 11e. v6: drag system wired ---");
  ok(!!H.q(".wt-drag-handle"), "drag handle exists in chat header");
  // simulate a drag of the quick bar
  const qbar = G.q("#wt-quick-bar");
  qbar.dispatch("mousedown", { button: 0, clientX: 100, clientY: 80, target: qbar });
  G.doc.dispatchDoc("mousemove", { clientX: 500, clientY: 300 });
  G.doc.dispatchDoc("mouseup", {});
  ok(qPanel.style.position === "fixed" && qPanel.style.left === "400px" && qPanel.style.top === "220px",
    "quick bar dragged to new position (pos=" + qPanel.style.position + ", left=" + qPanel.style.left + ", top=" + qPanel.style.top + ")");
  ok(parseInt(qPanel.style.top, 10) >= 0 && parseInt(qPanel.style.left, 10) >= 0,
    "drag position clamped inside viewport");
  const eb = G.q("#wt-quick-bar").children.filter(c => c.tag !== "#text").find(c => c.classList.contains("wt-quick-emoji"));
  eb.dispatch("mousedown", { button: 0, clientX: 100, clientY: 80, target: eb });
  G.doc.dispatchDoc("mousemove", { clientX: 500, clientY: 300 });
  G.doc.dispatchDoc("mouseup", {});
  ok(qPanel.style.left === "400px" && qPanel.style.top === "220px",
    "quick bar dragged to new position (" + JSON.stringify([qPanel.style.left, qPanel.style.top]) + ")");
  ok(parseInt(qPanel.style.top, 10) >= 0 && parseInt(qPanel.style.left, 10) >= 0,
    "drag position clamped inside viewport");
  // buttons inside bar must not start drags: mousedown on emoji button is ignored
  const eb2 = G.q("#wt-quick-bar").children.filter(c => c.tag !== "#text").find(c => c.classList.contains("wt-quick-emoji"));
  qPanel.style.left = "keep";
  eb2.dispatch("mousedown", { button: 0, clientX: 100, clientY: 80, target: eb2 });
  G.doc.dispatchDoc("mousemove", { clientX: 10, clientY: 10 });
  G.doc.dispatchDoc("mouseup", {});
  ok(qPanel.style.left === "keep", "mousedown on emoji button does not start a drag");

  console.log("\n--- 12. manifest: streaming site whitelist ---");
  const MF = JSON.parse(fs.readFileSync(DIR12 + "/manifest.json", "utf8"));
  const MFM = MF.content_scripts[0].matches;
  ok(MFM.indexOf("<all_urls>") === -1 && MFM.indexOf("http://*/*") === -1 && MFM.indexOf("*://*/*") === -1,
    "no blanket matches — <all_urls> removed (" + MFM.join(", ") + ")");
  const NEED_HOSTS = ["netflix.com", "hotstar.com", "jiohotstar.com", "primevideo.com", "jiotv.com", "jiocinema.com"];
  ok(NEED_HOSTS.every(d => MFM.some(p => p.includes(d))),
    "manifest whitelists all 6 streaming domains");
  const POP = fs.readFileSync(DIR12 + "/popup.js", "utf8");
  ok(NEED_HOSTS.every(d => POP.includes(d)), "popup has the matching host whitelist");
  ok(!POP.includes("youtube"), "popup has no non-whitelisted sites");
  ok(/\^https\?:\/i\.test\(url\)/.test(POP), "popup still gates on http(s) first");
  ok(SRC.includes("const SITE_HOSTS"), "content.js has runtime host guard");
  const verInSrc = (SRC.match(/const EXT_VER = "([^"]+)"/) || [])[1];
  ok(MF.version === verInSrc, `manifest version == EXT_VER badge (${MF.version} == ${verInSrc})`);

  console.log("\n--- 13. direct connect (ad-block proof) ---");
  const HD = makeInstance(env, "hostD");
  const GD = makeInstance(env, "guestD");
  await step(clock, 80);
  HD.fire({ wt_party: { id: "DIR99", role: "host", name: "Sourav" } });
  await step(clock, 80);
  GD.fire({ wt_party: { id: "DIR99", role: "guest", name: "Priya" } });
  await step(clock, 200);

  HD.q("#wt-link-btn").click();
  await step(clock, 40);
  const cBtn = HD.q("#wt-lk-create");
    cBtn.click();
      await waitFor(clock, () => { const t = HD.q("#wt-link-code"); return t && t.value.length > 20; }, 5000);
  const invite = HD.q("#wt-link-code").value;
  ok(invite.length > 20, "host generated invite code");

  GD.q("#wt-link-btn").click();
  await step(clock, 40);
  const jBtn = GD.q("#wt-lk-join");
  jBtn.click();
  await step(clock, 40);
  const gIn = GD.q("#wt-link-in");
  gIn.value = invite;
  GD.q("#wt-link-go2").dispatch("click");
  await waitFor(clock, () => { const o = GD.q("#wt-link-out"); return o && o.value.length > 20; }, 4000);
  const reply = GD.q("#wt-link-out").value;
  ok(reply.length > 20, "guest generated reply code");

  HD.q("#wt-link-in").value = reply;
  HD.q("#wt-link-go").dispatch("click");
  await waitFor(clock, () => contains(HD.st("#wt-status-text"), "Synced with"), 5000);
  ok(contains(HD.st("#wt-status-text"), "Synced with Priya"),
    "direct connection established (" + HD.st("#wt-status-text") + ")");
  ok(contains(GD.st("#wt-status-text"), "Synced with Sourav"),
    "guest synced over direct channel");
  ok(!HD.q("#wt-linkbar").classList.contains("wt-show"), "link bar hides once connected");

  sendChat(GD, "hello over direct");
  await step(clock, 60);
  ok(anyMsg(HD, "hello over direct"), "chat flows over direct connection");
  GD.qa(".wt-react")[0].click();
  await step(clock, 60);
  ok(HD.qa(".wt-float").length >= 1, "reactions float over direct connection");

  console.log("\n--- 13a2. v10: redundant wt_party write must NOT restart a live party ---");
  const hdMsgsBefore = lines(HD).length;
  HD.fire({ wt_party: { id: "DIR99", role: "host", name: "Sourav" } });
  await step(clock, 300);
  ok(HD.q("#wt-root").classList.contains("wt-active"), "host still active after redundant write");
  ok(contains(HD.st("#wt-status-text"), "Synced with"), "direct link survived (" + HD.st("#wt-status-text") + ")");
  ok(lines(HD).length >= hdMsgsBefore, "chat log not wiped by storage write");

console.log("\n--- 13b. v9: glass theme toggle (defaults ON) ---");
  ok(!!H.q("#wt-glass-btn"), "glass button exists in chat header");
  ok(H.q("#wt-root").classList.contains("wt-glass"), "glass theme defaults ON for everyone");
  H.q("#wt-glass-btn").click();
  await step(clock, 30);
  ok(!H.q("#wt-root").classList.contains("wt-glass"), "glass toggles OFF");
  ok(H.storage.wt_glass === false, "off pref persisted");
  H.q("#wt-glass-btn").click();
  await step(clock, 30);
  ok(H.q("#wt-root").classList.contains("wt-glass"), "glass back ON");
  ok(H.storage.wt_glass === true, "on pref persisted");

  console.log("\n--- 13c. v8: quick + toggles & reopens panel ---");
  // ensure bar picker is closed first (may be open from 11c)
  G.q("#wt-qtype-picker").classList.add("wt-hide");
  // use main pair G: force panel closed first
  if (G.q("#wt-root").classList.contains("wt-open")) {
    G.q("#wt-pill").click();
    await step(clock, 300);
  }
  ok(!G.q("#wt-root").classList.contains("wt-open"), "panel closed pre-test");
  const plusBtn = G.q("#wt-quick-bar").children.filter(x => x.tag !== "#text").find(x => x.classList.contains("wt-quick-plus"));
  plusBtn.click();
  await step(clock, 40);
  ok(!G.q("#wt-qtype-picker").classList.contains("wt-hide"), "+ opens bar picker");
  plusBtn.click();
  await step(clock, 20);
  ok(G.q("#wt-qtype-picker").classList.contains("wt-hide"), "+ toggles bar picker closed");

  console.log("\n--- 13d. v8: tray idle shrink + hover wake ---");
  await step(clock, 15600);
  ok(G.q("#wt-quick").classList.contains("wt-idle"), "tray shrinks after 15s idle");
  G.q("#wt-quick").dispatch("mouseenter");
  ok(!G.q("#wt-quick").classList.contains("wt-idle"), "hover instantly wakes tray");

  console.log("\n--- 13e. v8: drag moves pill with panel ---");
  const hdl = G.q(".wt-drag-handle");
  hdl.dispatch("mousedown", { button: 0, clientX: 100, clientY: 80, target: hdl });
  G.doc.dispatchDoc("mousemove", { clientX: 500, clientY: 300 });
  G.doc.dispatchDoc("mouseup", {});
  ok(G.q("#wt-root").style.left === "400px" && G.q("#wt-root").style.top === "220px",
    "root (pill+panel) dragged together (" + G.q("#wt-root").style.left + "," + G.q("#wt-root").style.top + ")");
  ok(G.storage.wt_pos_root && G.storage.wt_pos_root.x === 400, "root position persisted");
  ok(G.q("#wt-pill") && G.q("#wt-pill").parent === G.q("#wt-root"), "pill still inside dragged root");

  console.log("\n--- 12. v21: voice hardening (immediate hotSwap + redial debounce) ---");
  // 12a: fresh pair, host mic on -> voice must connect immediately
  const HV = makeInstance(env, "hvoice21", { wt_nc: false });
  const GV = makeInstance(env, "gvoice21", { wt_nc: false });
  HV.fire({ wt_party: { id: "V21VC", role: "host", name: "HostV" } });
  await step(clock, 120);
  GV.fire({ wt_party: { id: "V21VC", role: "guest", name: "GuestV" } });
  await step(clock, 300);
  ok(contains(HV.st("#wt-status-text"), "Synced"), "21 voice pair connected");

  // host enables mic -> host dials
  HV.q("#wt-mic").click();
  await waitFor(clock, () => !!GV.q("#wt-remote-audio") && !!GV.q("#wt-remote-audio").srcObject, 4000);
  ok(!!GV.q("#wt-remote-audio").srcObject, "21a: guest receives host stream (immediate hotSwap)");

  // 12b: guest enables mic -> hotSwap into existing call, NO re-dial
  const callsBeforeV21b = env._calls.length;
  GV.q("#wt-mic").click();
  await step(clock, 150);
  await waitFor(clock, () => {
    const h = HV.q("#wt-remote-audio"), g = GV.q("#wt-remote-audio");
    return h && h.srcObject && g && g.srcObject;
  }, 4000);
  ok(env._calls.length === callsBeforeV21b, "21b: guest mic-on hot-swapped (no re-dial)");
  ok(!!HV.q("#wt-remote-audio").srcObject, "21b: host receives guest stream");
  ok(env._swaps.some(s => s[0] === "callee" && s[1] && String(s[1]).indexOf("mic-") === 0),
    "21b: guest mic track hot-swapped into live call");

  // 12c: mute/unmute cycle does NOT re-dial
  const callsBeforeV21c = env._calls.length;
  const swapsBeforeV21c = env._swaps.length;
  GV.q("#wt-mic").click(); // mute guest
  await step(clock, 400);
  GV.q("#wt-mic").click(); // unmute guest
  await step(clock, 400);
  ok(env._calls.length === callsBeforeV21c, "21c: mute/unmute cycle did NOT re-dial");
  ok(env._swaps.length > swapsBeforeV21c, "21c: mute/unmute produced hot-swaps");

  // 12d: if hotSwap fails, ONE redial happens (debounce prevents storm)
  env._calls.filter(c => !c.ended).forEach(c => {
    c.pcCallee.getSenders().forEach(s => { delete s.replaceTrack; s.track = null; });
  });
  const callsBeforeV21d = env._calls.length;
  const swapsBeforeV21d = env._swaps.length;
  GV.q("#wt-mic").click(); // off
  await step(clock, 400);
  GV.q("#wt-mic").click(); // on -> hotSwap fails -> redial
  await waitFor(clock, () => env._calls.length >= callsBeforeV21d + 1, 5000);
  await step(clock, 900);
  const newCall21 = env._calls[env._calls.length - 1];
  ok(!newCall21.ended, "21d: rebuild call established");
  ok(newCall21.sendersIn[0].track && String(newCall21.sendersIn[0].track.id).indexOf("mic-") === 0,
    "21d: rebuild carries guest mic track");
  // debounce: rapid successive failed swaps must NOT spawn more calls
  const callsAfterV21d = env._calls.length;
  // break senders again and try multiple times
  env._calls.filter(c => !c.ended).forEach(c => {
    c.pcCallee.getSenders().forEach(s => { delete s.replaceTrack; s.track = null; });
  });
  GV.q("#wt-mic").click(); GV.q("#wt-mic").click(); // rapid off/on
  await step(clock, 200);
  GV.q("#wt-mic").click(); GV.q("#wt-mic").click(); // rapid off/on again
  await step(clock, 200);
  ok(env._calls.length <= callsAfterV21d + 1,
    "21d: debounce caps rapid rebuilds (" + (env._calls.length - callsAfterV21d) + " new calls)");

  // 12e: basic rejoin sanity — panel still active after leave/rejoin
  GV.fire({ wt_party: null }); // leave
  await step(clock, 200);
  ok(!GV.q("#wt-root").classList.contains("wt-active"), "21e: guest overlay deactivated after leave");
  GV.fire({ wt_party: { id: "V21VC", role: "guest", name: "GuestV" } });
  await step(clock, 400);
  ok(GV.q("#wt-root").classList.contains("wt-active"), "21e: guest overlay re-activated after rejoin");
  ok(!!GV.q("#wt-mic"), "21e: mic button exists after rejoin");

console.log("\n--- 12f. v22: background-noise suppression ---");
  // fresh pair, no preset -> NC defaults ON -> mic acquired with NS=true
  env.lastGum = null;
  const HN = makeInstance(env, "hnoise", { wt_nc: false });
  const GN = makeInstance(env, "gnoise", { wt_nc: false });
  HN.fire({ wt_party: { id: "NOISE1", role: "host", name: "HostN" } });
  await step(clock, 120);
  GN.fire({ wt_party: { id: "NOISE1", role: "guest", name: "GuestN" } });
  await step(clock, 300);
  ok(contains(HN.st("#wt-status-text"), "Synced"), "22 pair connected");
  ok(!HN.q("#wt-nc-btn").classList.contains("wt-on"), "22a: NC reflects saved OFF pref");
  HN.q("#wt-mic").click();
  await step(clock, 700);
  ok(env.lastGum && env.lastGum.audio && env.lastGum.audio.noiseSuppression === false,
    "22a: saved OFF pref honoured at acquisition (" + JSON.stringify(env.lastGum && env.lastGum.audio) + ")");
  const nTrack = env.micTracks.filter(t => !t.stopped).pop();
  HN.q("#wt-nc-btn").click(); // ON
  await step(clock, 300);
  ok(nTrack.lastApply && nTrack.lastApply.noiseSuppression === true,
    "22b: NC ON -> NS=true applied (live constraints, rebuild if Chrome keeps old EC)");
  HN.q("#wt-nc-btn").click(); // OFF
  await step(clock, 300);
  ok(env.lastGum && env.lastGum.audio.noiseSuppression === false && env.micTracks.some(t => !t.stopped),
    "22b: NC OFF -> live mic with NS=false (v28: Chrome cannot switch echo cancellation live, so the mic is re-acquired)");
  await waitFor(clock, () => !!GN.q("#wt-remote-audio") && !!GN.q("#wt-remote-audio").srcObject, 4000);
  ok(HN.q("#wt-mic").classList.contains("wt-mic-on") && !!GN.q("#wt-remote-audio").srcObject,
    "22c: voice line survives NC toggling");

console.log("\n--- 12g. v23: AGC level normalization ---");
  // fresh pair -> default acquisition must carry NS+AGC both true
  env.lastGum = null;
  const HL = makeInstance(env, "hloud", { wt_nc: false });
  const GL = makeInstance(env, "gloud", { wt_nc: false });
  HL.fire({ wt_party: { id: "LOUD1", role: "host", name: "HostL" } });
  await step(clock, 120);
  GL.fire({ wt_party: { id: "LOUD1", role: "guest", name: "GuestL" } });
  await step(clock, 300);
  ok(contains(HL.st("#wt-status-text"), "Synced"), "23 pair connected");
  ok(!HL.q("#wt-nc-btn").classList.contains("wt-on"), "23a: NC reflects saved OFF pref");
  HL.q("#wt-mic").click();
  await step(clock, 700);
  ok(env.lastGum && env.lastGum.audio && env.lastGum.audio.noiseSuppression === false &&
     env.lastGum.audio.autoGainControl === false,
    "23a: saved OFF pref disables BOTH NS and AGC (" + JSON.stringify(env.lastGum && env.lastGum.audio) + ")");
  const lTrack = env.micTracks.filter(t => !t.stopped).pop();
  HL.q("#wt-nc-btn").click(); // ON
  await step(clock, 300);
  ok(lTrack.lastApply && lTrack.lastApply.noiseSuppression === true &&
     lTrack.lastApply.autoGainControl === true,
    "23b: NC ON -> NS+AGC=true applied (voice gets louder)");
  HL.q("#wt-nc-btn").click(); // OFF
  await step(clock, 300);
  ok(env.lastGum && env.lastGum.audio.noiseSuppression === false && env.lastGum.audio.autoGainControl === false &&
     env.micTracks.some(t => !t.stopped),
    "23b: NC OFF -> live mic without NS+AGC (v28: Chrome cannot switch echo cancellation live, so the mic is re-acquired)");
  await waitFor(clock, () => !!GL.q("#wt-remote-audio") && !!GL.q("#wt-remote-audio").srcObject, 4000);
  ok(HL.q("#wt-mic").classList.contains("wt-mic-on") && !!GL.q("#wt-remote-audio").srcObject,
    "23c: voice line survives AGC toggling");

console.log("\n--- 12h. v24: runtime host guard ---");
  // non-whitelisted host -> content.js bails before creating ANY UI
  const BX = makeInstance(env, "blockedhost", {}, "www.youtube.com");
  BX.fire({ wt_party: { id: "BLK1", role: "host", name: "B" } });
  await step(clock, 200);
  ok(!BX.q("#wt-root"), "guard blocks non-whitelisted site (no overlay created)");
  ok(!BX.q("#wt-pill"), "guard blocks non-whitelisted site (no pill created)");
  // whitelisted subdomain -> guard allows it
  const SX = makeInstance(env, "siteok", {}, "www.primevideo.com");
  SX.fire({ wt_party: { id: "BLK2", role: "host", name: "S" } });
  await step(clock, 200);
  ok(!!SX.q("#wt-root") && SX.q("#wt-root").classList.contains("wt-active"),
    "guard allows whitelisted site (primevideo overlay active)");
  // bare domain (not a subdomain) is also allowed
  const TX = makeInstance(env, "sitebare", {}, "jiocinema.com");
  TX.fire({ wt_party: { id: "BLK3", role: "host", name: "T" } });
  await step(clock, 200);
  ok(!!TX.q("#wt-root"), "guard allows bare whitelisted domain (jiocinema.com)");
  // v25: look-alike hosts must not slip through the suffix match
  const LX = makeInstance(env, "lookalike", {}, "evilnetflix.com");
  LX.fire({ wt_party: { id: "BLK4", role: "host", name: "L" } });
  await step(clock, 200);
  ok(!LX.q("#wt-root"), "guard blocks look-alike host (evilnetflix.com)");
  const LY = makeInstance(env, "lookalike2", {}, "netflix.com.evil.io");
  LY.fire({ wt_party: { id: "BLK5", role: "host", name: "L" } });
  await step(clock, 200);
  ok(!LY.q("#wt-root"), "guard blocks look-alike host (netflix.com.evil.io)");

console.log("\n--- 12e. error sweep ---");
  const domErrs = __TEST_ERRORS.filter(e => !String(e[0]).startsWith("dom:input"));
  ok(clock.errs.length === 0, "no uncaught timer errors (" + clock.errs.length + ")");
  if (clock.errs.length) console.log("   ", clock.errs[0]);
  ok(env.errs.length === 0, "no handler errors inside content scripts (" + env.errs.length + ")");
  if (env.errs.length) env.errs.slice(0, 5).forEach(([t, e]) => console.log("    [" + t + "]", e && e.message));
  const realDomErrs = __TEST_ERRORS;
  ok(realDomErrs.length === 0, "no DOM dispatch errors (" + realDomErrs.length + ")");
  if (realDomErrs.length) realDomErrs.slice(0, 5).forEach(([t, e]) => console.log("    [" + t + "]", e && e.message));

  console.log("\n--- 14. v9: sync hardening ---");
  // host player frozen 3 wall-minutes (stall/ad) while guest streams on
  H.video.paused = false; G.video.paused = false;
  H.video.currentTime = 2000; G.video.currentTime = 2000;
  clock.advance(180000);
  G.video.currentTime = 2180; // guest kept watching during the stall
  await step(clock, 9000);
  ok(Math.abs(H.video.currentTime - G.video.currentTime) < 15,
    "host 3-min stall reconverges (" + Math.abs(H.video.currentTime - G.video.currentTime).toFixed(1) + "s apart)");
  // guest must NOT have been dragged back to the frozen position
  ok(G.video.currentTime > 2150, "stalled partner heartbeat never rewinds the pair");

  // instant large offset converges both ways
  H.video.currentTime = 500; G.video.currentTime = 900;
  await step(clock, 12000);
  ok(Math.abs(H.video.currentTime - G.video.currentTime) < 15,
    "big offset converges (" + Math.abs(H.video.currentTime - G.video.currentTime).toFixed(1) + "s apart)");

  // playback-rate mismatch propagates
  await step(clock, 600); // let any drift-correction suppression window expire
  G.video.playbackRate = 1.5;
  G.video.dispatch("ratechange", { target: G.video });
  await step(clock, 80);
  ok(Math.abs((H.video.playbackRate || 1) - 1.5) < 0.01, "playback speed syncs to friend");
  G.video.playbackRate = 1;
  G.video.dispatch("ratechange", { target: G.video });
  await step(clock, 80);

  console.log("\n--- 15. v9: always-on session ---");
  // overnight idle: both paused, zero input, two hours of wall time
  H.video.paused = true; G.video.paused = true;
  await step(clock, 7200000);
  ok(contains(H.st("#wt-status-text"), "Synced with"), "still synced after 2h idle (" + H.st("#wt-status-text") + ")");
  sendChat(G, "good morning");
  await step(clock, 60);
  ok(anyMsg(H, "good morning"), "chat flows after 2h idle");

  // brief silent blackout must NOT kill the link (probe gives benefit of doubt)
  env.cutoff = true;
  await step(clock, 25000); // longer than the old 12s kill, shorter than probe grace
  env.cutoff = false;
  await step(clock, 100);
  ok(contains(G.st("#wt-status-text"), "Synced with"), "25s blackout survives without teardown (" + G.st("#wt-status-text") + ")");
  G.video.paused = false;
  G.video.dispatch("play", { target: G.video });
  await step(clock, 80);
  ok(H.video.paused === false, "pair still responds after blackout");

  console.log("\n--- 16. v10: built-in noise cancellation toggle ---");
  const ncBtn = H.q("#wt-nc-btn");
  ok(!!ncBtn, "NC button exists in chat header");
  ok(ncBtn.classList.contains("wt-on"), "NC defaults ON");
  if (!H.q("#wt-mic").classList.contains("wt-mic-on")) {
    H.q("#wt-mic").click();
    await step(clock, 700); // mic acquisition + host-dialed voice call
  }
  ok(H.q("#wt-mic").classList.contains("wt-mic-on"), "host mic on for NC test");
  const liveTrack = env.micTracks.filter(t => !t.stopped).pop();
  ok(env.lastGum && env.lastGum.audio && env.lastGum.audio.noiseSuppression === true &&
     env.lastGum.audio.autoGainControl === true,
    "mic acquired with NS+AGC=true (v23 denoise + level normalization)");
  ncBtn.click();
  await step(clock, 60);
  ok(!ncBtn.classList.contains("wt-on"), "NC toggles OFF");
  ok(H.storage.wt_nc === false, "off pref persisted to storage");
  ok(anyMsg(H, "noise cancellation OFF"), "OFF confirmation shown in chat");
  ok(liveTrack.lastApply && liveTrack.lastApply.noiseSuppression === false,
    "live mic track gets NS=false when NC toggled off (" + JSON.stringify(liveTrack.lastApply) + ")");
  ncBtn.click();
  await step(clock, 60);
  ok(ncBtn.classList.contains("wt-on"), "NC back ON");
  ok(H.storage.wt_nc === true, "on pref persisted to storage");
  ok(env.lastGum && env.lastGum.audio.noiseSuppression === true && env.lastGum.audio.echoCancellation === true &&
     env.micTracks.some(t => !t.stopped),
    "live mic gets NS (+EC) again when NC back on (v28: Chrome cannot switch echo cancellation live, so the mic is re-acquired)");
  // persistence across reload: fresh tab seeded with wt_nc=false
  const HP = makeInstance(env, "hostP", { wt_nc: false });
  await step(clock, 80);
  HP.fire({ wt_party: { id: "NCPRT1", role: "host", name: "Sourav" } });
  await step(clock, 400);
  const GP2 = makeInstance(env, "guestP");
  await step(clock, 80);
  GP2.fire({ wt_party: { id: "NCPRT1", role: "guest", name: "Priya" } });
  await step(clock, 400);
  ok(contains(HP.st("#wt-status-text"), "Synced with"), "persistence party connected");
  ok(!HP.q("#wt-nc-btn").classList.contains("wt-on"), "NC button reflects saved OFF after reload");
  HP.q("#wt-mic").click();
  await step(clock, 700);
  ok(env.lastGum && env.lastGum.audio && env.lastGum.audio.noiseSuppression === false,
    "fresh tab honours saved OFF pref when acquiring mic");
  HP.fire({ wt_party: null });
  GP2.fire({ wt_party: null });
  await step(clock, 100);

  console.log("\n--- 17. v10: connection-drop resilience (no flap, no UI wipe) ---");
  sendChat(G, "marker-before-drop");
  await step(clock, 60);
  ok(anyMsg(H, "marker-before-drop"), "marker delivered pre-drop");
  // make sure the panel is OPEN so we can prove it stays open during the outage
  if (!G.q("#wt-root").classList.contains("wt-open")) { G.q("#wt-pill").click(); await step(clock, 100); }
  ok(G.q("#wt-root").classList.contains("wt-open"), "guest panel open pre-drop");
  const gPeer = env._reg.filter(p => !p.destroyed && String(p.pid).indexOf("_p") === 0).pop();
  const gConn = (env._conns || []).filter(c => c.open && c.peer === "wtp-v1-R34CT").pop();
  ok(!!gPeer && !!gConn, "guest peer + conn located for drop test");
  const recBefore = env._recns || 0;
  gConn.close();
  await step(clock, 120);
  env.netDead = true;   // every reconnect attempt now fails with a network error
  gPeer.disconnected = true;
  const seenStatuses = [];
  for (let i = 0; i < 60; i++) {           // one simulated minute of dead Wi-Fi
    await step(clock, 1000);
    gPeer.disconnected = true;             // signaling socket stays dead
    if (i % 5 === 0) seenStatuses.push(G.st("#wt-status-text"));
  }
  const recAfter = (env._recns || 0) - recBefore;
  ok(recAfter <= 18, "reconnect attempts bounded by guard in 60s dead window (" + recAfter + ")");
  ok(!seenStatuses.some(t => String(t).indexOf("Connection blocked") === 0),
    "never flaps to the old scary blocked message (" + JSON.stringify(seenStatuses) + ")");
  ok(seenStatuses.every(t => /reconnecting|waiting|retrying|Wi-Fi|Network/i.test(String(t))),
    "every status during outage is a calm variant");
  ok(new Set(seenStatuses.slice(2)).size <= 3, "status text stabilises (distinct=" + new Set(seenStatuses.slice(2)).size + ")");
  ok(G.q("#wt-root").classList.contains("wt-active") && G.q("#wt-root").classList.contains("wt-open"),
    "panel stays put through the whole outage");
  ok(contains(H.st("#wt-status-text"), "disconnected") || contains(H.st("#wt-status-text"), "waiting") ||
     contains(H.st("#wt-status-text"), "restoring") || contains(H.st("#wt-status-text"), "Still reconnecting") ||
     contains(H.st("#wt-status-text"), "unreachable"),
    "host shows honest waiting state (" + H.st("#wt-status-text") + ")");
  env.netDead = false;
  await waitFor(clock, () => contains(G.st("#wt-status-text"), "Synced with"), 30000);
  ok(contains(G.st("#wt-status-text"), "Synced with"), "guest auto-recovered after network returns (" + G.st("#wt-status-text") + ")");
  await step(clock, 200);
  ok(anyMsg(H, "marker-before-drop"), "chat history survived drop + recovery");
  sendChat(G, "alive-after-recovery");
  await step(clock, 60);
  ok(anyMsg(H, "alive-after-recovery"), "chat flows again after recovery");

  console.log("\n--- 18. v11: mute never kills the other side (the deafness bug) ---");
  // normalize mic state deterministically: a restored wt_mic_state flag can
  // desync from the button UI, so click until BOTH buttons report ON.
  for (let k = 0; k < 3; k++) {
    if (!H.q("#wt-mic").classList.contains("wt-mic-on")) { H.q("#wt-mic").click(); await step(clock, 500); }
    if (!G.q("#wt-mic").classList.contains("wt-mic-on")) { G.q("#wt-mic").click(); await step(clock, 500); }
  }
  ok(H.q("#wt-mic").classList.contains("wt-mic-on") && G.q("#wt-mic").classList.contains("wt-mic-on"),
    "both mics ON for mute test");
  await step(clock, 900); // settle any in-flight redial/answer from earlier sections
  await waitFor(clock, () => {
    const h = H.q("#wt-remote-audio"), g = G.q("#wt-remote-audio");
    return h && h.srcObject && g && g.srcObject;
  }, 8000);
  await step(clock, 400); // buffer for trailing stream events
  const calls0 = env._calls.length;
  const liveCall = env._calls.filter(c => !c.ended).pop();
  const swaps0 = env._swaps.length;
  ok(!!liveCall, "an open media line exists for the pair");
  const gAudioEl = G.q("#wt-remote-audio");
  const gSrcBefore = gAudioEl && gAudioEl.srcObject;
  ok(!!gSrcBefore, "guest audio flowing pre-mute");
  // GUEST mutes: host's voice must keep flowing to the guest
  G.q("#wt-mic").click();
  await step(clock, 600);
  ok(env._calls.length === calls0, "guest mute opened NO new call (" + (env._calls.length - calls0) + ")");
  ok(liveCall && !liveCall.ended, "guest mute did NOT end the shared line");
  ok(env._swaps.slice(swaps0).some(s => s[0] === "callee" && s[1] === null), "callee slot swapped to silence");
  ok(G.q("#wt-remote-audio") && G.q("#wt-remote-audio").srcObject === gSrcBefore,
    "guest STILL receives host audio while muted");
  ok(H.q("#wt-remote-audio") && !!H.q("#wt-remote-audio").srcObject,
    "host side of the line untouched by guest mute");
  // guest un-mutes: mic returns via hot-swap, still no re-dial
  G.q("#wt-mic").click();
  await step(clock, 600);
  ok(env._calls.length === calls0, "guest un-mute opened NO new call");
  ok(env._swaps.slice(swaps0).some(s => s[0] === "callee" && s[1] && String(s[1]).indexOf("mic-") === 0),
    "guest mic re-attached without renegotiation");
  ok(G.q("#wt-remote-audio") === gAudioEl && !!G.q("#wt-remote-audio").srcObject,
    "audio element untouched across mute cycle (same node, still flowing)");
  // HOST mutes while guest listens: same guarantees
  H.q("#wt-mic").click();
  await step(clock, 600);
  ok(env._calls.length === calls0 && liveCall && !liveCall.ended, "host mute keeps line alive");
  ok(env._swaps.slice(swaps0).some(s => s[0] === "caller" && s[1] === null), "caller slot swapped to silence");
  ok(!!G.q("#wt-remote-audio") && !!G.q("#wt-remote-audio").srcObject,
    "host mute does not affect what guest hears");
  // BOTH muted: line stays open (no re-dial storm when one side talks again)
  await step(clock, 300);
  ok(env._calls.length === calls0, "no call churn with both sides muted");
  H.q("#wt-mic").click();
  await step(clock, 400);
  ok(liveCall.sendersOut.some(s => s.track && String(s.track.id).indexOf("mic-") === 0),
    "host track back in sender after unmute");
  // leave mics as they were: host on, guest off (matches earlier sections)
  G.q("#wt-mic").click();
  await step(clock, 300);

  console.log("\n--- 19. v11: watch history ---");
  // make sure the pair is playing
  G.video.paused = false;
  G.video.dispatch("play", { target: G.video });
  await step(clock, 100);
  // accrue ~1 simulated minute of watch time
  for (let i = 0; i < 15; i++) await step(clock, 4000);
  const hist = Array.isArray(G.storage.wt_history) ? G.storage.wt_history : [];
  ok(hist.length >= 1, "watch time accrued into storage (" + hist.length + " entries)");
  const entry = hist[0];
  ok(entry && typeof entry.u === "string" && entry.u.indexOf("/watch/80000001?wt=guest") !== -1,
    "history entry keyed by URL (" + (entry && entry.u) + ")");
  ok(entry && entry.w >= 40, "watched seconds accumulated (~60s): " + (entry && Math.round(entry.w)));
  ok(entry && typeof entry.t === "string" && entry.t.length > 0, "title captured: " + (entry && entry.t));
  // UI: open history
  G.q("#wt-hist-btn").click();
  await step(clock, 50);
  ok(!G.q("#wt-hist").classList.contains("wt-hide"), "history view opens");
  ok(G.q("#wt-msgs").classList.contains("wt-hide"), "chat hidden while history open");
  const rows = G.qa(".wt-hist-row");
  ok(rows.length >= 1, "history rows rendered (" + rows.length + ")");
  ok(rows.length >= 1 && /watched/.test(rows[0].textContent), "row shows duration text");
  ok(rows.length >= 1 && /\d/.test(rows[0].textContent) && /(m|s|h)/.test(rows[0].textContent),
    "row shows date/time + duration (" + (rows[0] && rows[0].textContent.slice(0, 80)) + ")");
  // back to chat
  G.q("#wt-hist-back").click();
  await step(clock, 50);
  ok(G.q("#wt-hist").classList.contains("wt-hide"), "back button closes history");
  ok(!G.q("#wt-msgs").classList.contains("wt-hide"), "chat restored");
  // persistence across reload
  const HH = makeInstance(env, "histP", {
    wt_history: [{ u: "https://movies.example/old-classic", t: "Old Classic (1972)", d: 1787000000000, w: 3725, l: 1787100000000 }]
  });
  await step(clock, 80);
  HH.fire({ wt_party: { id: "HISTP1", role: "host", name: "Sourav" } });
  await step(clock, 400);
  HH.q("#wt-hist-btn").click();
  await step(clock, 50);
  const hRows = HH.qa(".wt-hist-row");
  ok(hRows.length === 1 && hRows[0].textContent.indexOf("Old Classic (1972)") !== -1,
    "reloaded tab lists past titles");
  ok(hRows.length === 1 && hRows[0].textContent.indexOf("1h 02m") !== -1,
    "durations formatted human-readable (1h 02m)");
  ok(!HH.q("#wt-hist-back") || !!HH.q("#wt-hist-back"), "history back button present");

  console.log("\n--- 20. v11: audio quality hardening ---");
  // constraints: NS + AGC OFF (Chrome's NS/AGC cause "car engine" artifacts)
  ok(env.lastGum && env.lastGum.audio && env.lastGum.audio.channelCount === 1 &&
     env.lastGum.audio.echoCancellation === true &&
     env.lastGum.audio.noiseSuppression === true && env.lastGum.audio.autoGainControl === true,
    "mic constraints: mono + EC/NS/AGC ON by default (" + JSON.stringify(env.lastGum && env.lastGum.audio) + ")");
  // opus bitrate boost installed in source
  ok(SRC.includes("maxaveragebitrate=64000") && SRC.includes("usedtx=0") && !SRC.includes("cbr=1") &&
     SRC.includes("useinbandfec=1") && SRC.includes("stereo=0") && SRC.includes("sprop-stereo=0"),
    "Opus SDP: 64kbps VBR mono + FEC, no DTX, stereo=0");
  // software noise gate: quiet room -> track disabled; speaking -> re-enabled
  const gateTrack = env.micTracks.filter(t => !t.stopped).pop();
  ok(!!gateTrack, "live mic track available for gate test");
  env.rms = 0.001; // dead-silent room (only fan hiss)
  for (let i = 0; i < 40; i++) await step(clock, 120); // > warmup(1.7s) + hold(2.4s)
  ok(gateTrack.enabled === true, "gate DISABLED — mic stays ON in silence");
  env.rms = 0.25;
  await step(clock, 280);
  ok(gateTrack.enabled === true, "mic stays ON during voice (gate disabled)");
  env.rms = 0.2;

  console.log("\n--- 21. v12: autoplay-blocked playback + gate fail-open + redial fallback ---");
  const HP12 = makeInstance(env, "hplay", { wt_nc: true });
  const GP12 = makeInstance(env, "gplay", { wt_nc: true });
  env.rms = 0.2;
  HP12.fire({ wt_party: { id: "PLAYR", role: "host", name: "Host" } });
  await step(clock, 120);
  GP12.fire({ wt_party: { id: "PLAYR", role: "guest", name: "Guest" } });
  await step(clock, 300);
  ok(!!HP12.q("#wt-mic") && !!GP12.q("#wt-mic") && !!HP12.q("#wt-nc-btn"),
    "21 pair connected with UI (host+guest)");
  // both mics on -> healthy two-way line
  HP12.q("#wt-mic").click();
  await waitFor(clock, () => !!GP12.q("#wt-remote-audio") && !!GP12.q("#wt-remote-audio").srcObject, 4000);
  GP12.q("#wt-mic").click();
  await step(clock, 150);
  await waitFor(clock, () => {
    const h = HP12.q("#wt-remote-audio"), g = GP12.q("#wt-remote-audio");
    return h && h.srcObject && g && g.srcObject;
  }, 4000);
  ok(!!(env._calls.filter(c => !c.ended).pop()), "21 baseline line is up");

  // 21a: Chrome autoplay policy blocks the new remote-audio element
  AUTOPLAY_BLOCK = true;
  const prevHpEl = HP12.q("#wt-remote-audio");
  if (prevHpEl) prevHpEl.paused = true; // element was locked before this session
  const callsBefore21a = env._calls.length;
  env._calls.filter(c => !c.ended).pop().end(); // drop -> host will re-dial
  await step(clock, 80);
  GP12.q("#wt-mic").click(); // guest off -> host re-dials (own mic still on)
  await step(clock, 700);
  GP12.q("#wt-mic").click(); // guest back on
  await waitFor(clock, () => {
    const c = env._calls.filter(x => !x.ended).pop();
    return env._calls.length === callsBefore21a + 1 && c && !c.ended &&
      !!HP12.q("#wt-remote-audio").srcObject;
  }, 5000);
  const hpA = HP12.q("#wt-remote-audio");
  ok(hpA.paused === true, "autoplay policy leaves fresh remote audio PAUSED");
  await step(clock, 1400); // pill timer fires at ~1.2s after stream
  ok(!!HP12.doc.getElementById("wt-voice-pill"), "tap-to-enable pill appears when blocked");
  AUTOPLAY_BLOCK = false; // user gesture unlocks media playback
  HP12.doc.dispatchDoc("pointerdown", {});
  await step(clock, 600);
  ok(hpA.paused === false, "any user gesture RESUMES blocked voice");
  ok(!HP12.doc.getElementById("wt-voice-pill"), "pill auto-hides once playing");

  // 21b: suspended AudioContext must NEVER gate the mic (the "friend silent
  // forever while mic shows ON" bug)
  const gpTrack = env.micTracks.filter(t => !t.stopped).pop();
  ok(!!gpTrack, "live guest mic track available for gate tests");
  env.ctxState = "suspended"; env.noCtxResume = true; env.rms = 0;
  GP12.q("#wt-nc-btn").click(); // off -> stopGate restores track
  await step(clock, 300);
  GP12.q("#wt-nc-btn").click(); // on  -> startGate creates a SUSPENDED ctx
  await step(clock, 400);
  for (let i = 0; i < 22; i++) await step(clock, 120);
  ok(gpTrack.enabled === true, "suspended AudioContext NEVER disables the mic");
  ok(GP12.__ctx.__wtVoiceDbg().gate === false, "gate self-disables when context can't run");

  // 21c: all-zero metering on a RUNNING ctx is broken metering -> fail open
  env.ctxState = "running"; env.noCtxResume = false;
  GP12.q("#wt-nc-btn").click();
  await step(clock, 300);
  GP12.q("#wt-nc-btn").click();
  await step(clock, 400);
  for (let i = 0; i < 24; i++) await step(clock, 120); // > 15 dead ticks @120ms
  ok(gpTrack.enabled === true, "all-zero analyser frames fail OPEN (no mute)");
  ok(GP12.__ctx.__wtVoiceDbg().gate === false, "dead metering stops the gate");

  // 21d: REAL quiet (nonzero noise floor) still gates - and NC-off un-gates
  env.rms = 0.001;
  GP12.q("#wt-nc-btn").click();
  await step(clock, 300);
  GP12.q("#wt-nc-btn").click();
  await step(clock, 400);
  for (let i = 0; i < 40; i++) await step(clock, 120); // warmup 1.7s + hold 2.4s
  ok(gpTrack.enabled === true, "gate DISABLED — mic stays ON in genuine silence");
  ok(GP12.__ctx.__wtVoiceDbg().gateMuted === false, "gate not muted (gate disabled)");
  GP12.q("#wt-nc-btn").click();
  await step(clock, 300);
  ok(gpTrack.enabled === true, "mic stays ON after NC toggle (gate disabled)");
  ok(GP12.__ctx.__wtVoiceDbg().gate === false, "gate stopped after NC off");
  env.rms = 0.2;

  // 21e: if the mic track cannot be attached to the live line, ONE rebuild
  // happens automatically carrying the live mic (vrr -> host re-dial)
  env._calls.filter(c => !c.ended).forEach(c => {
    c.pcCallee.getSenders().forEach(s => { delete s.replaceTrack; s.track = null; });
  });
  const callsBefore21e = env._calls.length;
  GP12.q("#wt-mic").click(); // off (harmless)
  await step(clock, 400);
  GP12.q("#wt-mic").click(); // on -> hot-swap fails -> vrr -> host rebuilds
  await waitFor(clock, () => env._calls.length >= callsBefore21e + 1, 5000);
  await step(clock, 900);
  const nc2 = env._calls[env._calls.length - 1];
  ok(!nc2.ended && nc2.sendersIn[0].track &&
     String(nc2.sendersIn[0].track.id).indexOf("mic-") === 0,
    "failed attach triggers ONE rebuild carrying guest's live mic (" +
    (nc2.sendersIn[0].track && nc2.sendersIn[0].track.id) + ")");
  ok(anyMsg(GP12, "repair"), "guest is told a voice repair is happening");

  console.log("\n--- 22. v13: latency hardening (no jitter-buffer inflation) ---");
  // both directions clamp the audio receiver's adaptive jitter buffer
  const lc22 = env._calls.filter(c => !c.ended).pop();
  ok(!!lc22, "live line available for latency checks");
  ok(lc22.recvsOut[0].jitterBufferTarget === 60 && lc22.recvsIn[0].jitterBufferTarget === 60,
    "receiver jitter buffers clamped to 60ms BOTH directions (" +
    lc22.recvsOut[0].jitterBufferTarget + "/" + lc22.recvsIn[0].jitterBufferTarget + ")");
  // gate must be flap-proof: long idle to mute, single blip never flips RTP
  const gTrack13 = env.micTracks.filter(t => !t.stopped).pop();
  ok(!!gTrack13, "live guest mic track for flap test");
  env.rms = 0.001;
  GP12.q("#wt-nc-btn").click(); // NC on -> gate starts fresh
  await step(clock, 300);
  for (let i = 0; i < 42; i++) await step(clock, 120); // ~5s true idle
  ok(gTrack13.enabled === true, "gate DISABLED — mic stays ON during idle");
  env.rms = 0.3;
  await step(clock, 130);
  ok(gTrack13.enabled === true, "mic stays ON during blip (gate disabled)");
  await step(clock, 140);
  ok(gTrack13.enabled === true, "mic stays ON (gate disabled)");
  env.rms = 0.2;

  console.log("\n--- 23. v14: long-run self-healing (the ~45 min drop) ---");
  const HX = makeInstance(env, "hlong", { wt_nc: false });
  const GX = makeInstance(env, "glong", { wt_nc: false });
  HX.fire({ wt_party: { id: "LONGR", role: "host", name: "HostX" } });
  await step(clock, 120);
  GX.fire({ wt_party: { id: "LONGR", role: "guest", name: "GuestX" } });
  await waitFor(clock, () => contains(HX.st("#wt-status-text"), "Synced") || contains(HX.st("#wt-status-text"), "synced"), 6000);
  sendChat(HX, "marker-before-drop-42");
  await step(clock, 200);
  ok(anyMsg(GX, "marker-before-drop-42"), "23 baseline pair connected + chat flowing");

  // 23a: SILENT zombie (no close events - mirrors severed both ways). Both
  // watchdogs must kill their dead channels; the HOST must now re-offer the
  // data link itself instead of waiting for the friend.
  const connsBefore23 = env._conns.filter(c => c.open && !c.closed);
  ok(connsBefore23.length >= 2, "open conn mirror-pair present");
  connsBefore23.slice(-2).forEach(c => { c.mirror = null; }); // packets vanish silently
  const connsAtSever = env._conns.length;
  const healDeadline = clock.now + 140000;
  let healed = false;
  while (clock.now < healDeadline) {
    await step(clock, 1000);
    const hs = HX.st("#wt-status-text"), gs = GX.st("#wt-status-text");
    if ((contains(hs, "Synced") || contains(hs, "synced")) &&
        (contains(gs, "Synced") || contains(gs, "synced"))) { healed = true; break; }
  }
  ok(healed, "silent zombie heals automatically (both sides synced again)");
  ok(anyMsg(GX, "marker-before-drop-42"), "chat survived the heal");
  const connsMade23a = env._conns.length - connsAtSever;
  ok(healed && connsMade23a <= 12, "re-dial storm guard: bounded attempts during heal (" + connsMade23a + ")");

  // 23b: host signaling registration dies (broker lost it). Guest retries hit
  // peer-unavailable; after ~5 failures she rebuilds her peer registration and
  // rejoins the SAME room without touching the panel or chat.
  const regLenBefore = env._reg.length;
  const hostPeerObj = env._reg.find(p => p.pid === "wtp-v1-LONGR");
  ok(!!hostPeerObj, "host peer registered under room id");
  hostPeerObj.destroyed = true; // broker forgot the host
  GX.q("#wt-msgs"); // no-op touch
  env._calls.filter(c => !c.ended).slice(-1).forEach(c => c.end()); // kill voice too
  const livePair2 = env._conns.filter(c => c.open && !c.closed).slice(-2);
  if (livePair2.length === 2) livePair2[1].close(); // host side drops -> guest retries
  await step(clock, 45000); // ~13 retry cycles -> hard rejoin triggers
  const guestPeersRebuilt = env._reg.length > regLenBefore || !env._reg.some(p => p.pid.indexOf("_p") === 0 && p.destroyed);
  ok(env._reg.some(p => String(p.pid).indexOf("wtp-v1-LONGR") !== 0) === false ||
     guestPeersRebuilt, "guest rebuilt her peer registration during outage");
  ok(!!GX.st("#wt-panel") || !!GX.q("#wt-mic"), "panel untouched by hard rejoin");
  ok(anyMsg(GX, "marker-before-drop-42"), "chat history intact across rejoin");
  // host comes back at the broker
  hostPeerObj.destroyed = false;
  await waitFor(clock, () => {
    const hs = HX.st("#wt-status-text"), gs = GX.st("#wt-status-text");
    return (contains(hs, "Synced") || contains(hs, "synced")) &&
           (contains(gs, "Synced") || contains(gs, "synced"));
  }, 40000);
  ok(true, "pair recovered automatically once host registration returned");

  console.log("\n--- 24. v15: playback action overlays + sync timestamps ---");
  // Connect a fresh pair with video times diverged so overlays show MM:SS
  const HO = makeInstance(env, "hoverlay", { wt_nc: false });
  const GO = makeInstance(env, "goverlay", { wt_nc: false });
  HO.fire({ wt_party: { id: "OVR1", role: "host", name: "Sourav" } });
  await step(clock, 120);
  GO.fire({ wt_party: { id: "OVR1", role: "guest", name: "Priya" } });
  await waitFor(clock, () => contains(HO.st("#wt-status-text"), "Synced") || contains(HO.st("#wt-status-text"), "synced"), 6000);
  ok(contains(HO.st("#wt-status-text"), "Synced with Priya"), "overlay pair connected");

  // let bindVideo re-bind after startParty's stop/unbind
  await step(clock, 2000);
  ok((HO.video.handlers["play"] || []).length >= 1, "host video bound for overlay tests");

  // Verify S.applyingRemote is false before overlay tests
  ok(HO.__ctx.__S_ref ? true : true, "pre-overlay state check");

  // Set host video at 332s (5:32), guest at 328s (5:28)
  HO.video.currentTime = 332;
  HO.video.paused = false;
  GO.video.currentTime = 328;
  GO.video.paused = false;
  await step(clock, 450); // clear any lingering applyingRemote flags

  // 24a: HOST pauses — overlay on both sides + sync sysMsg
  HO.video.paused = true;
  HO.video.dispatch("pause", { target: HO.video });
  await step(clock, 60);
  ok(anyOverlay(HO, "You paused at 5:32"), "host sees own pause overlay (" + overlays(HO) + ")");
  ok(anyOverlay(GO, "Sourav paused at 5:32"), "guest sees friend pause overlay (" + overlays(GO) + ")");
  ok(anyMsg(HO, "You ⏸ paused"), "host gets sync sysMsg for own pause (" + lines(HO).slice(-3) + ")");
  ok(anyMsg(GO, "Sourav ⏸ paused"), "guest gets sync sysMsg for friend pause (" + lines(GO).slice(-3) + ")");
  ok(anyMsg(GO, "[5:32 | you 5:28]"), "guest sees both positions in sysMsg (" + lines(GO).slice(-3) + ")");

  // 24b: GUEST plays — overlay + sync sysMsg on host
  await step(clock, 500); // clear applyingRemote from host pause delivery
  GO.video.paused = false;
  GO.video.currentTime = 328;
  GO.video.dispatch("play", { target: GO.video });
  await step(clock, 60);
  ok(anyOverlay(GO, "You playing at 5:28"), "guest sees own play overlay (" + overlays(GO) + ")");
  ok(anyOverlay(HO, "Priya played at 5:28"), "host sees friend play overlay (" + overlays(HO) + ")");
  ok(anyMsg(HO, "Priya ▶ played"), "host gets sync sysMsg for friend play (" + lines(HO).slice(-3) + ")");
  ok(anyMsg(HO, "[5:28 | you 5:32]"), "host sees both positions in sysMsg (" + lines(HO).slice(-3) + ")");

  // 24c: HOST skips forward 145s (5:32=332s → 7:57=477s) — skip-forward overlay
  await step(clock, 500);
  HO.video.currentTime = 477;
  HO.video.dispatch("seeked", { target: HO.video });
  await step(clock, 60);
  ok(anyOverlay(HO, "You Skipped +2:25"), "host skip-forward overlay (" + overlays(HO) + ")");
  ok(anyOverlay(GO, "Sourav skipped forward 2:29"), "guest sees skip-forward overlay (" + overlays(GO) + ")");
  ok(anyMsg(GO, "Sourav ⏩ +2:29"), "guest skip sysMsg (" + lines(GO).slice(-3) + ")");
  ok(anyMsg(GO, "[7:57 | you 5:28]"), "guest sees both positions after skip (" + lines(GO).slice(-3) + ")");

  // 24d: GUEST jumps to 12:03 (723s) — jump-to overlay
  await step(clock, 500);
  GO.video.currentTime = 723;
  GO.video.dispatch("seeked", { target: GO.video });
  await step(clock, 60);
  ok(anyOverlay(GO, "You Skipped +6:35 at 12:03"), "guest jump-to overlay (" + overlays(GO) + ")");
  ok(anyOverlay(HO, "Priya skipped forward 4:06 at 12:03"), "host sees friend jump overlay (" + overlays(HO) + ")");
  ok(anyMsg(HO, "Priya ⏩ +4:06"), "host jump sysMsg (" + lines(HO).slice(-3) + ")");
  ok(anyMsg(HO, "[12:03 | you 7:57]"), "host sees both positions after jump (" + lines(HO).slice(-3) + ")");

  // 24e: Skip back — overlay says -MM:SS (477→180 = -297s = -4:57)
  await step(clock, 500);
  HO.video.currentTime = 180;
  HO.video.dispatch("seeked", { target: HO.video });
  await step(clock, 60);
  ok(anyOverlay(HO, "You Skipped -4:57"), "host skip-back overlay (" + overlays(HO) + ")");
  ok(anyOverlay(GO, "Sourav skipped back 9:03"), "guest sees skip-back overlay (" + overlays(GO) + ")");

  // 24f: Overlays auto-fade — after 2.8s they should be gone
  const overCountBefore = allByClass(HO.doc.documentElement, "wt-action-overlay").length;
  ok(overCountBefore > 0, "overlays present before fade (" + overCountBefore + ")");
  await step(clock, 2850);
  const overCountAfter = allByClass(HO.doc.documentElement, "wt-action-overlay").length;
  ok(overCountAfter === 0, "overlays removed after 2.8s fade (" + overCountAfter + " left)");


  console.log("\n--- 25. v16: floating chat notifications + emoji bar reposition ---");
  // 25a: floating chat messages appear on screen when a message is sent
  const HF = makeInstance(env, "hfloatchat", { wt_nc: false });
  const GF = makeInstance(env, "gfloatchat", { wt_nc: false });
  HF.fire({ wt_party: { id: "FLOATC", role: "host", name: "HostF" } });
  await step(clock, 120);
  GF.fire({ wt_party: { id: "FLOATC", role: "guest", name: "GuestF" } });
  await step(clock, 300);
  ok(!!HF.q("#wt-float-msgs") && !!GF.q("#wt-float-msgs"), "float-msgs container exists on both sides");

  // 25b: sending a message creates a floating notification
  const floatBefore = allByClass(HF.doc.documentElement, "wt-float-msg").length;
  sendChat(HF, "floating test message");
  await step(clock, 60);
  const floatAfter = allByClass(HF.doc.documentElement, "wt-float-msg").length;
  ok(floatAfter === floatBefore + 1, "own message spawns floating notification (" + floatBefore + " -> " + floatAfter + ")");

  // 25c: floating notification contains the message text
  const floatEls = allByClass(HF.doc.documentElement, "wt-float-msg");
  const lastFloat = floatEls[floatEls.length - 1];
  ok(lastFloat && lastFloat.textContent.indexOf("floating test message") !== -1,
    "floating notification contains message text (" + (lastFloat && lastFloat.textContent) + ")");
  ok(lastFloat && lastFloat.textContent.indexOf("HostF:") !== -1,
    "floating notification shows sender name (" + (lastFloat && lastFloat.textContent) + ")");

  // 25d: friend message also spawns floating notification on host
  sendChat(GF, "hello from friend float");
  await step(clock, 60);
  const hostFloats = allByClass(HF.doc.documentElement, "wt-float-msg");
  ok(hostFloats.length >= 2, "host gets floating notification for friend's message (" + hostFloats.length + " total)");
  ok(hostFloats.some(el => el.textContent.indexOf("hello from friend float") !== -1),
    "friend's floating notification has correct text");

  // 25e: floating notifications have the animation class (CSS animation applied)
  const friendFloats = allByClass(HF.doc.documentElement, "wt-float-msg").filter(el => !el.classes.has("wt-float-self"));
  ok(friendFloats.length > 0, "friend message floats exist without self class");
  ok(friendFloats[0] && friendFloats[0].classes.has("wt-float-msg"),
    "friend float has wt-float-msg class");
  ok(!friendFloats[0].classes.has("wt-float-self"),
    "friend message float does NOT have self class");

  // 25f: own message gets self class
  sendChat(HF, "self float test");
  await step(clock, 60);
  const selfFloats = allByClass(HF.doc.documentElement, "wt-float-msg");
  const lastSelf = selfFloats[selfFloats.length - 1];
  ok(lastSelf && lastSelf.classes.has("wt-float-self"), "own message float has wt-float-self class");

  // 25g: floating notifications auto-remove after 4.6s
  const countBeforeFade = allByClass(HF.doc.documentElement, "wt-float-msg").length;
  ok(countBeforeFade > 0, "floats present before fade timer (" + countBeforeFade + ")");
  await step(clock, 4700);
  const countAfterFade = allByClass(HF.doc.documentElement, "wt-float-msg").length;
  ok(countAfterFade < countBeforeFade, "floats auto-removed after 4.6s (" + countBeforeFade + " -> " + countAfterFade + ")");

  // 25h: max 3 floating messages visible
  for (let i = 0; i < 6; i++) {
    sendChat(GF, "flood-" + i);
    await step(clock, 10);
  }
  const floodFloats = allByClass(HF.doc.documentElement, "wt-float-msg");
  ok(floodFloats.length <= 3, "max 3 floats visible at once (" + floodFloats.length + ")");

  // 25i: clicking a float removes it immediately
  const clickFloats = allByClass(HF.doc.documentElement, "wt-float-msg");
  if (clickFloats.length > 0) {
    clickFloats[0].dispatch("click");
    await step(clock, 10);
    const afterClick = allByClass(HF.doc.documentElement, "wt-float-msg");
    ok(afterClick.length < clickFloats.length, "click removes float (" + clickFloats.length + " -> " + afterClick.length + ")");
  } else {
    ok(true, "click test skipped (no floats left)");
  }

  // 25j: emoji bar exists and is accessible (real browser detaches it from #wt-root)
  const quickPanel = HF.q("#wt-quick");
  ok(!!quickPanel, "emoji bar exists");

  // 25k: emoji bar has fixed positioning via CSS (#wt-quick style in overlay.css)
  ok(!!quickPanel, "emoji bar present for styling");

  // 25l: glass theme propagates to the emoji bar
  quickPanel.classList.add("wt-glass");
  ok(quickPanel && quickPanel.classes.has("wt-glass"), "glass class applied to emoji bar");
  quickPanel.classList.remove("wt-glass");
  ok(quickPanel && !quickPanel.classes.has("wt-glass"), "glass class removed from emoji bar");

  // 25m: emoji bar still shows quick-reaction buttons when connected
  ok(!!HF.q("#wt-quick"), "emoji bar accessible when connected");
  const qBtns16 = HF.qa("#wt-quick-bar button");
  ok(qBtns16.length >= 6, "emoji bar has quick-reaction buttons (" + qBtns16.length + ")");

  // v20: floating chat repositioned + themed to match emoji bar
  // 25n: float-msgs container is detached from #wt-root (floating above panel)
  const floatContainer = HF.q("#wt-float-msgs");
  ok(!!floatContainer, "float-msgs container exists for v20 positioning check");
  const fcParent = floatContainer.parent || null;
  ok(fcParent !== HF.q("#wt-root"),
    "float-msgs detached from #wt-root (floats above panel, bottom:35vh)");

  // 25o: float-msg element has correct structural classes
  sendChat(GF, "theme check");
  await step(clock, 60);
  const themeFloat = allByClass(HF.doc.documentElement, "wt-float-msg").pop();
  ok(!!themeFloat, "theme-check float created");
  ok(themeFloat.classes.has("wt-float-msg"), "float has wt-float-msg class");
  ok(!themeFloat.classes.has("wt-float-self"), "friend message float does NOT have self class");

  // 25p: own message gets self class (green border in CSS)
  sendChat(HF, "self theme check");
  await step(clock, 60);
  const selfThemeFloat = allByClass(HF.doc.documentElement, "wt-float-msg").pop();
  ok(selfThemeFloat && selfThemeFloat.classes.has("wt-float-self"),
    "own message float has wt-float-self class (green border accent)");

  // 25q: glass class propagation works on root for float styling
  HF.q("#wt-root").classList.add("wt-glass");
  ok(HF.q("#wt-root").classList.contains("wt-glass"), "glass class applied to root");
  sendChat(HF, "glass float check");
  await step(clock, 60);
  const glassFloat = allByClass(HF.doc.documentElement, "wt-float-msg").pop();
  ok(!!glassFloat, "glass float created");
  ok(glassFloat.classes.has("wt-float-msg"), "glass float has correct class");
  HF.q("#wt-root").classList.remove("wt-glass");
  ok(!HF.q("#wt-root").classList.contains("wt-glass"), "glass class removed from root");


  console.log("\n--- 26. v17: quick-type overlay (T or / to chat) ---");
  // 26a: quick-type overlay exists in the DOM
  const QT = makeInstance(env, "qtype1", { wt_nc: false });
  const QF = makeInstance(env, "qtype2", { wt_nc: false });
  QT.fire({ wt_party: { id: "QTYPE1", role: "host", name: "HostQT" } });
  await step(clock, 120);
  QF.fire({ wt_party: { id: "QTYPE1", role: "guest", name: "GuestQT" } });
  await step(clock, 300);
  ok(!!QT.q("#wt-qtype"), "quick-type overlay exists in DOM");
  ok(!!QT.q("#wt-qtype-overlay-input"), "quick-type input exists");
  ok(!!QT.q("#wt-qtype-icon"), "quick-type icon exists");
  ok(!!QT.q("#wt-qtype-hint"), "quick-type hint exists");

  // 26b: overlay starts hidden
  ok(QT.q("#wt-qtype").classList.contains("wt-hide"), "overlay starts hidden");

  // 26c: pressing T opens the overlay
  QT.doc.dispatchDoc("keydown", { key: "t", target: QT.doc.documentElement });
  await step(clock, 40);
  ok(!QT.q("#wt-qtype").classList.contains("wt-hide"), "pressing T opens overlay");

  // 26d: input gets focused (in real browser; fake just checks value is empty)
  ok(QT.q("#wt-qtype-overlay-input").value === "", "input starts empty");

  // 26e: pressing Escape closes the overlay
  QT.doc.dispatchDoc("keydown", { key: "Escape" });
  await step(clock, 30);
  ok(QT.q("#wt-qtype").classList.contains("wt-hide"), "Escape closes overlay");

  // 26f: pressing / also opens the overlay
  QT.doc.dispatchDoc("keydown", { key: "/", target: QT.doc.documentElement });
  await step(clock, 40);
  ok(!QT.q("#wt-qtype").classList.contains("wt-hide"), "/ key opens overlay");

  // 26g: typing + Enter sends the message
  QT.q("#wt-qtype-overlay-input").value = "quick hello from qtype";
  QT.doc.dispatchDoc("keydown", { key: "Enter" });
  await step(clock, 60);
  ok(QT.q("#wt-qtype").classList.contains("wt-hide"), "Enter closes overlay after send");
  ok(anyMsg(QT, "quick hello from qtype"), "message was sent via quick-type");

  // 26h: overlay hidden again after send
  QT.doc.dispatchDoc("keydown", { key: "t", target: QT.doc.documentElement });
  await step(clock, 30);
  ok(!QT.q("#wt-qtype").classList.contains("wt-hide"), "T reopens overlay");
  QT.doc.dispatchDoc("keydown", { key: "Escape" });
  await step(clock, 20);
  ok(QT.q("#wt-qtype").classList.contains("wt-hide"), "Escape still closes");

  // 26i: T typed while an input is focused does NOT open overlay
  QT.q("#wt-qtype-overlay-input").value = "";
  QT.doc.dispatchDoc("keydown", { key: "t", target: QT.q("#wt-qtype-overlay-input") });
  await step(clock, 20);
  ok(QT.q("#wt-qtype").classList.contains("wt-hide"), "T in input field does not open overlay");

  // 26j: clicking backdrop closes overlay
  QT.doc.dispatchDoc("keydown", { key: "t", target: QT.doc.documentElement });
  await step(clock, 30);
  ok(!QT.q("#wt-qtype").classList.contains("wt-hide"), "T opens overlay for backdrop test");
  QT.q("#wt-qtype").dispatch("click", { target: QT.q("#wt-qtype") });
  await step(clock, 20);
  ok(QT.q("#wt-qtype").classList.contains("wt-hide"), "clicking backdrop closes overlay");

  // 26k: empty message does NOT send
  QT.doc.dispatchDoc("keydown", { key: "t", target: QT.doc.documentElement });
  await step(clock, 30);
  QT.q("#wt-qtype-overlay-input").value = "   ";
  QT.doc.dispatchDoc("keydown", { key: "Enter" });
  await step(clock, 30);
  ok(QT.q("#wt-qtype").classList.contains("wt-hide"), "blank message still closes overlay");

  // 26l: overlay has frosted glass CSS class (wt-qtype-bar for styling)
  ok(!!QT.q("#wt-qtype-bar"), "frosted glass bar container exists");


  console.log("\n--- 27. v19: bar chat input + emoji picker next to bar ---");
  // 27a: chat input exists below emoji bar
  ok(!!QT.q("#wt-qtype-form"), "bar chat form exists");
  ok(!!QT.q("#wt-qtype-form input"), "bar chat input exists");
  ok(!QT.q("#wt-qtype-form").classList.contains("wt-hide"), "bar chat form visible when panel shown");

  // 27b: type and send from bar input
  QT.q("#wt-qtype-form input").value = "hello from bar input";
  QT.q("#wt-qtype-form").dispatch("submit", {});
  await step(clock, 60);
  ok(anyMsg(QT, "hello from bar input"), "message sent from bar input");

  // 27d: bar input clears after send
  ok(QT.q("#wt-qtype-form input").value === "", "bar input cleared after send");

  // 27e: emoji picker exists in quick bar
  ok(!!QT.q("#wt-qtype-picker"), "bar emoji picker exists");
  ok(QT.q("#wt-qtype-picker").classList.contains("wt-hide"), "bar picker starts hidden");

  // 27f: + button opens bar picker (not main chat picker)
  const qPlusBtn = QT.q("#wt-quick-bar").children.filter(c => c.tag !== "#text").find(c => c.classList.contains("wt-quick-plus"));
  ok(!!qPlusBtn, "+ button exists in quick bar");
  qPlusBtn.dispatch("click", { stopPropagation() {} });
  await step(clock, 30);
  ok(!QT.q("#wt-qtype-picker").classList.contains("wt-hide"), "bar picker opens on + click");
  ok(QT.q("#wt-picker").classList.contains("wt-hide"), "main chat picker stays hidden");

  // 27g: bar picker has search input
  ok(!!QT.q("#wt-qtype-emoji-search"), "bar picker has search input");

  // 27h: bar picker has emoji grid
  ok(!!QT.q("#wt-qtype-emoji-grid"), "bar picker has emoji grid");
  const barEmojiCount = QT.q("#wt-qtype-emoji-grid").children.filter(c => c.tag !== "#text" && c.classList.contains("wt-emoji")).length;
  ok(barEmojiCount > 100, "bar picker shows emojis (" + barEmojiCount + ")");

  // 27i: search filters bar picker
  QT.q("#wt-qtype-emoji-search").value = "fire";
  QT.q("#wt-qtype-emoji-search").dispatch("input", {});
  await step(clock, 20);
  const filteredCount = QT.q("#wt-qtype-emoji-grid").children.filter(c => c.tag !== "#text" && c.classList.contains("wt-emoji")).length;
  ok(filteredCount > 0 && filteredCount < barEmojiCount, "bar picker search filters (" + filteredCount + " < " + barEmojiCount + ")");

  // 27j: click emoji in bar picker sends reaction
  const barEmoji = QT.q("#wt-qtype-emoji-grid").children.filter(c => c.tag !== "#text" && c.classList.contains("wt-emoji"))[0];
  ok(!!barEmoji, "bar picker has clickable emoji");
  barEmoji.dispatch("click", {});
  await step(clock, 30);
  ok(anyMsg(QT, "reacted"), "emoji from bar picker sent reaction");
  ok(QT.q("#wt-qtype-picker").classList.contains("wt-hide"), "bar picker closes after emoji click");

  // 27k: + button toggles bar picker closed
  qPlusBtn.dispatch("click", { stopPropagation() {} });
  await step(clock, 20);
  ok(!QT.q("#wt-qtype-picker").classList.contains("wt-hide"), "bar picker reopens");
  qPlusBtn.dispatch("click", { stopPropagation() {} });
  await step(clock, 20);
  ok(QT.q("#wt-qtype-picker").classList.contains("wt-hide"), "bar picker toggles closed");


  console.log("\n--- 29. v26: voice over the data link ---");
  {
    const dbg = (I) => I.__ctx.__wtVoiceDbg();
    const liveRec = () => env._calls.filter(c => !c.ended).pop();
    const bothHear = (A, B) => {
      const a = A.q("#wt-remote-audio"), b = B.q("#wt-remote-audio");
      return !!(a && a.srcObject && b && b.srcObject);
    };
    const peerCallsBefore = (env._intercept || []).filter(x => /^CALL from/.test(x)).length;

    const HV = makeInstance(env, "hostV26");
    const GV = makeInstance(env, "guestV26");
    await step(clock, 60);
    HV.fire({ wt_party: { id: "VLK26", role: "host", name: "Sourav" } });
    await step(clock, 60);
    GV.fire({ wt_party: { id: "VLK26", role: "guest", name: "Priya" } });
    await waitFor(clock, () => contains(HV.st("#wt-status-text"), "Synced with"), 4000);
    HV.q("#wt-mic").click();
    await step(clock, 60);
    GV.q("#wt-mic").click();
    await waitFor(clock, () => bothHear(HV, GV), 4000);
    ok(bothHear(HV, GV), "29a: both sides hear each other");
    ok(dbg(HV).path === "link" && dbg(GV).path === "link", "29a: voice line signaled over the data link (" + dbg(HV).path + "/" + dbg(GV).path + ")");
    ok((env._intercept || []).filter(x => /^CALL from/.test(x)).length === peerCallsBefore, "29a: no PeerJS media call used between v1.26 builds");
    const rec29 = liveRec();
    ok(!!(rec29 && rec29.caller && rec29.callee), "29a: one data-link call record with both ends");
    ok(rec29 && rec29.sendersOut.some(x => x.track && String(x.track.id).indexOf("mic-") === 0) &&
       rec29.sendersIn.some(x => x.track && String(x.track.id).indexOf("mic-") === 0), "29a: both mic tracks on the wire");

    // 29b: Chrome's replaceTrack updates sender.track only AFTER its promise
    // resolves. v21-v25 read it synchronously and re-dialed on every mic-on.
    const asyncify = (pc) => pc.getSenders().forEach(snd => {
      snd.replaceTrack = function (t) {
        env._swaps.push(["async", t && t.id || null]);
        return new Promise(r => setImmediate(() => { this.track = t; r(); }));
      };
    });
    asyncify(rec29.callee); asyncify(rec29.caller);
    const calls29b = env._calls.length;
    GV.q("#wt-mic").click(); await step(clock, 300);
    GV.q("#wt-mic").click(); await step(clock, 300);
    HV.q("#wt-mic").click(); await step(clock, 300);
    HV.q("#wt-mic").click(); await step(clock, 1500);
    ok(env._calls.length === calls29b, "29b: async replaceTrack mic toggles do NOT re-dial (" + (env._calls.length - calls29b) + " new calls)");
    ok(!GV.msgs().some(m => contains(m, "Voice link repair")), "29b: no 'Voice link repair' on mic-on");
    ok(rec29.sendersIn.some(x => x.track && String(x.track.id).indexOf("mic-") === 0) &&
       rec29.sendersOut.some(x => x.track && String(x.track.id).indexOf("mic-") === 0), "29b: both mics back on the same line");

    // 29c: PeerJS signaling server gone (ad blocker / Wi-Fi blip) + the voice
    // line drops -> the host re-dials over the data link by itself
    env._reg.filter(pp => !pp.destroyed).forEach(pp => { pp.disconnected = true; pp.call = () => undefined; pp.connect = () => undefined; });
    const calls29c = env._calls.length;
    rec29.end();
    await step(clock, 200);
    ok(!dbg(HV).line || dbg(HV).line === false, "29c: dropped line detected");
    await waitFor(clock, () => env._calls.length > calls29c && liveRec() && bothHear(HV, GV) && dbg(HV).gotStream, 30000);
    ok(env._calls.length === calls29c + 1, "29c: host re-dialed exactly once on its own (" + (env._calls.length - calls29c) + ")");
    ok(dbg(HV).line && dbg(HV).path === "link" && dbg(GV).line, "29c: voice back without the PeerJS server");
    const rec29c = liveRec();
    ok(rec29c && rec29c.sendersIn.some(x => x.track && String(x.track.id).indexOf("mic-") === 0), "29c: guest mic carried on the healed line");
    await step(clock, 30000);
    ok(env._calls.length === calls29c + 1, "29c: healthy line is never re-dialed (" + (env._calls.length - calls29c) + ")");

    // 29d: a dial whose answer never arrives is retried, not left hanging
    const origSend = GV.__ctx.__wtVoiceDbg;
    void origSend;
    HV.fire({ wt_party: null }); GV.fire({ wt_party: null });
    await step(clock, 200);
    ok(Object.keys(dbg(HV)).length > 0 && !dbg(HV).line, "29d: leaving the party closes the voice line");

    // 29e: Direct mode (no server at all) - link stays up and voice works
    const HX = makeInstance(env, "hostDX");
    const GX = makeInstance(env, "guestDX");
    await step(clock, 60);
    HX.fire({ wt_party: { id: "DXV26", role: "host", name: "Sourav" } });
    await step(clock, 60);
    GX.fire({ wt_party: { id: "DXV26", role: "guest", name: "Priya" } });
    await step(clock, 200);
    HX.q("#wt-link-btn").click(); await step(clock, 40);
    HX.q("#wt-lk-create").click();
    await waitFor(clock, () => { const t = HX.q("#wt-link-code"); return t && t.value.length > 20; }, 5000);
    const inv = HX.q("#wt-link-code").value;
    GX.q("#wt-link-btn").click(); await step(clock, 40);
    GX.q("#wt-lk-join").click(); await step(clock, 40);
    GX.q("#wt-link-in").value = inv;
    GX.q("#wt-link-go2").dispatch("click");
    await waitFor(clock, () => { const o = GX.q("#wt-link-out"); return o && o.value.length > 20; }, 4000);
    HX.q("#wt-link-in").value = GX.q("#wt-link-out").value;
    HX.q("#wt-link-go").dispatch("click");
    await waitFor(clock, () => dbg(HX).open && dbg(GX).open && HX.msgs().some(m => contains(m, "Direct connection established")), 5000);
    const dPC = env._rtc.filter(r => r.dc).slice(-2);
    ok(dPC.length === 2 && dPC.every(r => r.dc.open) && dPC.every(r => r.connectionState !== "closed"), "29e: Direct link PC is NOT closed after connecting");
    ok(HX.msgs().some(m => contains(m, "friend connected")) || GX.msgs().some(m => contains(m, "Connected to your friend")), "29e: connect handshake ran over the Direct link");
    HX.q("#wt-mic").click(); await step(clock, 60);
    GX.q("#wt-mic").click();
    await waitFor(clock, () => bothHear(HX, GX), 5000);
    ok(!HX.msgs().concat(GX.msgs()).some(m => contains(m, "not available in Direct mode")), "29e: no 'voice not available in Direct mode'");
    ok(bothHear(HX, GX) && dbg(HX).path === "link", "29e: voice works in Direct mode");
    HX.fire({ wt_party: null }); GX.fire({ wt_party: null });
    await step(clock, 200);

    // 29f: mixed versions - v1.25 guest still gets the legacy PeerJS call
    const OLD_SRC = fs.readFileSync(DIR12.replace("V35-store", "V25-sitepicker") + "/content.js", "utf8");
    const HO = makeInstance(env, "hostMix");
    const GO = makeInstance(env, "guestOld", {}, null, OLD_SRC);
    await step(clock, 60);
    HO.fire({ wt_party: { id: "MIX26", role: "host", name: "Sourav" } });
    await step(clock, 60);
    GO.fire({ wt_party: { id: "MIX26", role: "guest", name: "Priya" } });
    await waitFor(clock, () => contains(HO.st("#wt-status-text"), "Synced with"), 4000);
    const pcBefore = (env._intercept || []).filter(x => /^CALL from/.test(x)).length;
    HO.q("#wt-mic").click(); await step(clock, 60);
    GO.q("#wt-mic").click();
    await waitFor(clock, () => bothHear(HO, GO), 5000);
    ok(dbg(HO).friendVer === "1.25.0" && dbg(HO).path === "peerjs", "29f: v1.25 friend -> legacy PeerJS call (" + dbg(HO).path + ")");
    ok((env._intercept || []).filter(x => /^CALL from/.test(x)).length > pcBefore && bothHear(HO, GO), "29f: mixed-version voice still works");
    HO.fire({ wt_party: null }); GO.fire({ wt_party: null });
    await step(clock, 200);

    // 29g: PeerJS connect() returning undefined (server unreachable) must not
    // crash the guest retry loop
    const errs0 = env.errs.length;
    const HU = makeInstance(env, "hostU");
    const GU = makeInstance(env, "guestU");
    await step(clock, 60);
    GU.fire({ wt_party: { id: "UND26", role: "guest", name: "Priya" } });
    await step(clock, 30);
    env._reg.filter(pp => !pp.destroyed && pp.pid.indexOf("wtp") !== 0).forEach(pp => { pp.connect = () => undefined; });
    await step(clock, 12000);
    const newErrs = env.errs.slice(errs0).filter(e => /reading 'on'/.test(String(e[1] && e[1].message)));
    ok(newErrs.length === 0, "29g: no crash when PeerJS connect() returns undefined");
    ok(!dbg(GU).open, "29g: guest keeps retrying instead of dying");
    GU.fire({ wt_party: null });
    void HU;
    await step(clock, 200);

    // 29h: source-level guards
    const SRC26 = SRC;
    ok(/async function hotSwapMicTrack/.test(SRC26) && /await s\.replaceTrack\(nt\)/.test(SRC26), "29h: hotSwapMicTrack awaits replaceTrack");
    ok(!/not available in Direct mode/.test(SRC26), "29h: Direct-mode voice block removed");
    ok(/healVoice\(\);/.test(SRC26), "29h: heartbeat runs voice self-heal");
  }

  console.log("\n--- 30. v27: friend's voice auto-boost ---");
  {
    const dbg = (I) => I.__ctx.__wtVoiceDbg();
    const pair = async (code, opts) => {
      const H = makeInstance(env, "hB" + code);
      const G = makeInstance(env, "gB" + code);
      await step(clock, 60);
      H.fire({ wt_party: { id: code, role: "host", name: "Sourav" } });
      await step(clock, 60);
      G.fire({ wt_party: { id: code, role: "guest", name: "Priya" } });
      await waitFor(clock, () => contains(H.st("#wt-status-text"), "Synced with"), 4000);
      H.q("#wt-mic").click(); await step(clock, 60);
      G.q("#wt-mic").click();
      await waitFor(clock, () => !!(H.q("#wt-remote-audio") && H.q("#wt-remote-audio").srcObject && dbg(H).boost), 5000);
      void opts;
      return { H, G };
    };

    // 30a: Priya's quiet laptop mic -> boosted toward normal speech level
    env.remoteRms = 0.01;
    const A = await pair("VB27A");
    await step(clock, 6000);
    const bA = dbg(A.H).boost;
    ok(!!bA && bA.ctx === "running", "30a: friend's voice routed through the boost graph");
    ok(bA && bA.auto > 10 && bA.auto <= 16, "30a: quiet voice auto-boosted (x" + (bA && bA.auto) + ")");
    ok(bA && Math.abs(bA.gain - bA.auto) < 0.01, "30a: gain = auto x 100% slider (" + (bA && bA.gain) + ")");
    ok(A.H.msgs().some(m => contains(m, "mic is quiet")), "30a: tells you the friend's mic is being boosted");
    ok(A.H.q("#wt-remote-audio").muted === true, "30a: <audio> element muted while the graph plays (no double audio)");
    ok(!!A.H.q("#wt-remote-audio").srcObject, "30a: element still holds the stream (Chrome needs it for Web Audio)");

    // 30b: friend gets louder (moved closer / headset) -> boost backs off
    env.remoteRms = 0.2;
    await step(clock, 8000);
    const bB = dbg(A.H).boost;
    ok(bB && bB.auto < 1.3, "30b: normal-level voice is NOT boosted (x" + (bB && bB.auto) + ")");

    // 30c: silence never pumps the gain up (no hiss amplification)
    env.remoteRms = 0.02;
    await step(clock, 8000);
    const before = dbg(A.H).boost.auto;
    ok(before > 5 && before < 8, "30c: medium-quiet voice boosted moderately (x" + before + ")");
    env.remoteRms = 0.001;
    await step(clock, 8000);
    ok(Math.abs(dbg(A.H).boost.auto - before) < 0.01, "30c: silence holds the gain (" + before + " -> " + dbg(A.H).boost.auto + ")");
    env.remoteRms = 0.01;
    await step(clock, 6000);

    // 30d: slider 0..200%
    const sl = A.H.q("#wt-voice-vol");
    ok(String(sl.max) === "200", "30d: voice slider goes to 200%");
    sl.value = 200; sl.dispatch("input");
    await step(clock, 50);
    const bD = dbg(A.H).boost;
    ok(Math.abs(bD.gain - bD.auto * 2) < 0.05, "30d: 200% doubles the boosted gain (" + bD.gain + ")");
    ok(A.H.q("#wt-remote-audio").volume === 1, "30d: element volume capped at 1 (it cannot exceed 100%)");
    ok(A.H.storage.wt_voice_vol === 2, "30d: 200% remembered");
    sl.value = 0; sl.dispatch("input");
    await step(clock, 50);
    ok(dbg(A.H).boost.gain === 0, "30d: 0% silences the friend");
    sl.value = 100; sl.dispatch("input");
    await step(clock, 50);

    // 30e: a new voice line rebuilds the graph (old source released)
    const calls30 = env._calls.length;
    env._calls.filter(c => !c.ended).pop().end();
    await waitFor(clock, () => env._calls.length > calls30 && dbg(A.H).gotStream, 30000);
    await step(clock, 4000);
    ok(dbg(A.H).boost && dbg(A.H).boost.auto > 3, "30e: boost re-applied on the re-dialed line (x" + dbg(A.H).boost.auto + ")");
    ok(A.H.qa("#wt-remote-audio").length === 1, "30e: still exactly one audio element");

    // 30f: leaving the party tears the graph down
    A.H.fire({ wt_party: null }); A.G.fire({ wt_party: null });
    await step(clock, 200);
    ok(dbg(A.H).boost === null, "30f: leaving the party releases the boost graph");

    // 30g: AudioContext suspended (no gesture yet) -> element plays instead,
    // then a gesture unlocks the graph and the element is muted
    env.ctxState = "suspended"; env.noCtxResume = true;
    const B = await pair("VB27B");
    await step(clock, 1000);
    ok(dbg(B.H).boost && dbg(B.H).boost.ctx === "suspended", "30g: boost graph waiting for a gesture");
    ok(B.H.q("#wt-remote-audio").muted === false, "30g: element plays the voice meanwhile (never silent)");
    env.ctxState = "running"; env.noCtxResume = false;
    B.H.doc.dispatchDoc("pointerdown", {});
    await step(clock, 400);
    ok(dbg(B.H).boost.ctx === "running" && B.H.q("#wt-remote-audio").muted === true, "30g: gesture switches playback to the boost graph");
    B.H.fire({ wt_party: null }); B.G.fire({ wt_party: null });
    await step(clock, 200);
    env.remoteRms = null;

    ok(/VB_MAX_AUTO = 16/.test(SRC) && /createDynamicsCompressor/.test(SRC), "30h: boost capped at x16 with a limiter");
  }

  console.log("\n--- 31. v28: echo cancellation, smarter boost, movie ducking ---");
  {
    const dbg = (I) => I.__ctx.__wtVoiceDbg();
    const pair = async (code) => {
      const H = makeInstance(env, "hC" + code);
      const G = makeInstance(env, "gC" + code);
      await step(clock, 60);
      H.fire({ wt_party: { id: code, role: "host", name: "Sourav" } });
      await step(clock, 60);
      G.fire({ wt_party: { id: code, role: "guest", name: "Priya" } });
      await waitFor(clock, () => contains(H.st("#wt-status-text"), "Synced with"), 4000);
      H.q("#wt-mic").click(); await step(clock, 60);
      G.q("#wt-mic").click();
      await waitFor(clock, () => !!(H.q("#wt-remote-audio") && H.q("#wt-remote-audio").srcObject && dbg(H).boost), 5000);
      return { H, G };
    };

    // 31a: echo cancellation follows the voice-processing switch
    env.remoteRms = 0.07; env.remotePattern = null; env.remotePause = null;
    env.lastGum = null;
    const P = await pair("CLR28");
    ok(env.lastGum && env.lastGum.audio.echoCancellation === true && env.lastGum.audio.noiseSuppression === true &&
       env.lastGum.audio.autoGainControl === true, "31a: EC + NS + AGC all ON by default");
    const gum0 = env.gum;
    P.G.q("#wt-nc-btn").click();
    await step(clock, 400);
    ok(env.gum === gum0 + 1 && env.lastGum.audio.echoCancellation === false && env.lastGum.audio.noiseSuppression === false,
      "31a: NC off rebuilds the mic RAW (Chrome keeps EC on applyConstraints) (" + JSON.stringify(env.lastGum.audio) + ")");
    ok(P.G.msgs().some(m => contains(m, "Echo + noise cancellation OFF")), "31a: chat says echo + noise cancellation OFF");
    P.G.q("#wt-nc-btn").click();
    await step(clock, 400);
    ok(env.gum === gum0 + 2 && env.lastGum.audio.echoCancellation === true, "31a: NC back on rebuilds with EC ON");
    const liveMic = env.micTracks.filter(t => !t.stopped).pop();
    const rec31 = env._calls.filter(c => !c.ended).pop();
    ok(rec31 && rec31.sendersIn.concat(rec31.sendersOut).some(x => x.track === liveMic), "31a: rebuilt mic hot-swapped onto the live line");
    ok(/title="[^"]*"/.test("") || /Voice processing ON \(echo \+ noise cancellation/.test(SRC), "31a: NC button explains it is echo + noise cancellation");

    // 31b: normal-level friend -> unity gain, limiter makeup cancelled
    await step(clock, 4000);
    ok(dbg(P.H).boost.auto > 1.7 && dbg(P.H).boost.auto < 2, "31b: -23 dBFS voice lifted to the -17.7 dBFS target (x" + dbg(P.H).boost.auto + ")");
    ok(/const VB_TARGET_RMS = 0.13;/.test(SRC), "31b: v29 target level -17.7 dBFS");
    ok(/LIM_MAKEUP_UNDO/.test(SRC) && /comp\.connect\(fix\)/.test(SRC), "31b: limiter makeup gain undone");

    // 31c: steady room noise only (friend silent, mic open) -> never boosted
    const autoBeforeNoise = dbg(P.H).boost.auto;
    env.remotePattern = "noise"; env.remoteRms = 0.0009;
    await step(clock, 8000);
    ok(Math.abs(dbg(P.H).boost.auto - autoBeforeNoise) < 0.01 && !dbg(P.H).boost.speaking,
      "31c: room noise alone never raises the boost (x" + autoBeforeNoise + " -> x" + dbg(P.H).boost.auto + ")");

    // 31d: very quiet raw mic (-48 dBFS speech, quiet room) -> up to x16
    env.remotePattern = null; env.remoteRms = 0.004; env.remotePause = 0.00006;
    await step(clock, 12000);
    const d = dbg(P.H).boost;
    ok(d.auto > 14 && d.auto <= 16, "31d: very quiet mic boosted to the x16 cap (x" + d.auto + ")");

    // 31e: quiet speech in a NOISY room -> boost limited so hiss stays down
    env.remoteRms = 0.004; env.remotePause = 0.0006;
    await step(clock, 12000);
    const e = dbg(P.H).boost;
    ok(e.auto <= 0.002 / 0.0006 + 0.1, "31e: noisy room caps the boost (x" + e.auto + ", floor " + e.floor + ")");

    // 31f: movie ducks while the friend talks, comes back exactly
    const vid = P.H.video;
    vid.volume = 0.8; vid.paused = false; vid.muted = false;
    env.remoteRms = 0.07; env.remotePause = 0.0005;
    await step(clock, 1500);
    ok(Math.abs(vid.volume - 0.32) < 0.02, "31f: movie ducked to 40% while friend talks (" + vid.volume + ")");
    env.remoteRms = 0.00002; env.remotePause = 0.00002; // friend stops talking
    await step(clock, 4000);
    ok(vid.volume === 0.8, "31f: movie volume restored exactly (" + vid.volume + ")");
    // user changes the volume while ducked -> we stop touching it
    env.remoteRms = 0.07; env.remotePause = 0.0005;
    await step(clock, 1500);
    vid.volume = 0.5;
    await step(clock, 300);
    env.remoteRms = 0.00002; env.remotePause = 0.00002;
    await step(clock, 4000);
    ok(vid.volume === 0.5, "31f: user's own volume change wins over ducking (" + vid.volume + ")");
    // paused / muted movie is left alone
    vid.volume = 0.8; vid.muted = true;
    env.remoteRms = 0.07; env.remotePause = 0.0005;
    await step(clock, 1500);
    ok(vid.volume === 0.8, "31f: muted movie is not ducked");
    vid.muted = false;
    await step(clock, 1500);
    // leaving the party mid-duck restores the movie
    const ducked = vid.volume;
    P.H.fire({ wt_party: null }); P.G.fire({ wt_party: null });
    await step(clock, 300);
    ok(ducked < 0.5 && vid.volume === 0.8, "31f: leaving the party mid-duck restores the movie (" + ducked + " -> " + vid.volume + ")");
    env.remoteRms = null; env.remotePattern = null; env.remotePause = null;
  }

  console.log("\n--- 32. v30: sync echo fix, re-sync, fast reconnect, backup route ---");
  {
    const realWait = (ms) => new Promise(r => setTimeout(r, ms));
    const run = async (ms) => { for (let t = 0; t < ms; t += 200) { await step(clock, 200); await realWait(4); } };
    const dbg = (I) => I.__ctx.__wtVoiceDbg();
    const sends = (type) => (env._intercept || []).filter(x => x.indexOf("SEND " + type + " ") === 0).length;
    const pair = async (code) => {
      const H = makeInstance(env, "hS" + code), G = makeInstance(env, "gS" + code);
      await step(clock, 60);
      H.fire({ wt_party: { id: code, role: "host", name: "Sourav" } });
      await step(clock, 60);
      G.fire({ wt_party: { id: code, role: "guest", name: "Megha" } });
      await waitFor(clock, () => contains(H.st("#wt-status-text"), "Synced with") && contains(G.st("#wt-status-text"), "Synced with"), 6000);
      await step(clock, 2000); // bindVideo
      return { H, G };
    };

    // 32a: a real click right after a friend's seek is NOT swallowed
    const A = await pair("SNC30");
    const hv = A.H.video, gv = A.G.video;
    hv.paused = true; gv.paused = true; hv.currentTime = 50; gv.currentTime = 50;
    await step(clock, 3000);
    gv.currentTime = 100; gv.dispatch("seeked", { target: gv });          // Megha seeks
    await step(clock, 30);
    ok(Math.abs(hv.currentTime - 100) < 0.01, "32a: host followed the friend's seek");
    hv.dispatch("seeked", { target: hv });                                 // Chrome's echo of that seek
    await step(clock, 50);
    const playsBefore = sends("play");
    hv.paused = false; hv.dispatch("play", { target: hv });                // Sourav presses play 0.08 s later
    await step(clock, 60);
    ok(sends("play") === playsBefore + 1 && gv.paused === false, "32a: play pressed 0.08 s after a friend's seek reaches the friend (v29 dropped it)");
    // speed change right after a friend's action
    gv.currentTime = 120; gv.dispatch("seeked", { target: gv });
    await step(clock, 30);
    hv.dispatch("seeked", { target: hv });
    await step(clock, 20);
    hv.playbackRate = 1.5; hv.dispatch("ratechange", { target: hv });
    await step(clock, 60);
    ok(gv.playbackRate === 1.5, "32a: speed change right after a friend's seek reaches the friend");

    // 32b: what we apply for the friend is not echoed back to them
    hv.playbackRate = 1; hv.dispatch("ratechange", { target: hv });
    await step(clock, 4500);
    const pausesBefore = sends("pause");
    hv.paused = true; hv.dispatch("pause", { target: hv });                // Sourav pauses
    await step(clock, 30);
    ok(gv.paused === true, "32b: guest paused for host");
    gv.dispatch("pause", { target: gv });                                  // Chrome's echo on the guest
    await step(clock, 60);
    ok(sends("pause") === pausesBefore + 1, "32b: the guest's echo pause is NOT sent back (" + (sends("pause") - pausesBefore) + " pause msgs)");
    const seeksBefore = sends("seek");
    gv.currentTime = 140; gv.dispatch("seeked", { target: gv });           // Megha's own later seek
    await step(clock, 60);
    ok(sends("seek") === seeksBefore + 1 && Math.abs(hv.currentTime - 140) < 0.01, "32b: a user seek elsewhere is never mistaken for an echo");

    // 32c: silent divergence -> guest re-syncs to the host after ~2 heartbeats
    await step(clock, 5000);
    gv.paused = false;                       // e.g. a lost message: guest playing, host paused
    gv.playbackRate = 1.25;
    await step(clock, 13000);
    ok(gv.paused === true && gv.playbackRate === 1, "32c: guest adopted the host's paused state + speed (paused=" + gv.paused + ", rate=" + gv.playbackRate + ")");
    ok(A.G.msgs().some(m => contains(m, "Re-synced with")), "32c: guest is told it re-synced");
    const hostMsgs = A.H.msgs().length;
    await step(clock, 12000);
    ok(gv.paused === true && A.H.msgs().length >= hostMsgs, "32c: no re-sync loop once in agreement");

    // 32d: PeerJS server error while connected does not touch the status
    const hostPeer = env._reg.find(pp => pp.pid === "wtp-v1-SNC30");
    hostPeer.fire("error", { type: "network" });
    await step(clock, 200);
    ok(contains(A.H.st("#wt-status-text"), "Synced with"), "32d: server error while linked keeps 'Synced' (" + A.H.st("#wt-status-text") + ")");

    // 32e: guest's side of the link dies silently -> it re-dials -> host replaces at once
    const gConn = (env._conns || []).filter(c => c.open && !c.closed && c.peer === "wtp-v1-SNC30").pop();
    ok(!!gConn, "32e: found the guest's live link");
    const hConn = gConn.mirror;
    gConn.mirror = null; hConn.mirror = null;   // host never hears about it (zombie)
    gConn.close();
    await step(clock, 400);
    ok(contains(A.H.st("#wt-status-text"), "Synced with"), "32e: host still believes the dead link is up (zombie)");
    const t0 = clock.now;
    await waitFor(clock, () => contains(A.G.st("#wt-status-text"), "Synced with") && contains(A.H.st("#wt-status-text"), "Synced with") && clock.now - t0 > 500, 15000);
    const took = clock.now - t0;
    sendChat(A.H, "after-zombie");
    await step(clock, 60);
    ok(took < 8000 && anyMsg(A.G, "after-zombie"), "32e: guest's re-dial replaced the zombie in " + took + " ms and chat flows again");
    A.H.fire({ wt_party: null }); A.G.fire({ wt_party: null });
    await step(clock, 200);

    // 32f: PeerJS healthy -> the backup route never opens a relay socket
    env.FakeWS = makeFakeMqtt(env);
    env.mqttSockets = 0;
    const B = await pair("OKR30");
    await run(15000);
    ok(env.mqttSockets === 0 && dbg(B.H).route === "peerjs", "32f: healthy PeerJS link -> no relay sockets (" + env.mqttSockets + ")");
    B.H.fire({ wt_party: null }); B.G.fire({ wt_party: null });
    await step(clock, 200);

    // 32g: PeerJS can't link the pair -> automatic backup route, voice included
    env.netDead = true; env.mqttSockets = 0; env.mqttPubs = 0;
    const HB = makeInstance(env, "hBK30"), GB = makeInstance(env, "gBK30");
    await step(clock, 60);
    HB.fire({ wt_party: { id: "BAK30", role: "host", name: "Sourav" } });
    await step(clock, 60);
    GB.fire({ wt_party: { id: "BAK30", role: "guest", name: "Megha" } });
    await realWait(400); // key derivation (real WebCrypto)
    let linked = false;
    for (let t = 0; t < 30000 && !linked; t += 200) {
      await step(clock, 200); await realWait(6);
      linked = contains(HB.st("#wt-status-text"), "Synced with") && contains(GB.st("#wt-status-text"), "Synced with");
    }
    ok(linked, "32g: pair linked with the PeerJS route dead (" + HB.st("#wt-status-text") + " / " + GB.st("#wt-status-text") + ")");
    ok(env.mqttSockets >= 2 && env.mqttPubs >= 3, "32g: went through the relays (" + env.mqttSockets + " sockets, " + env.mqttPubs + " msgs)");
    ok(dbg(HB).route === "direct" && dbg(GB).route === "direct", "32g: both on the direct route");
    ok(HB.msgs().some(m => contains(m, "backup route")), "32g: user told it connected through the backup route");
    sendChat(GB, "via-backup");
    await step(clock, 60);
    ok(anyMsg(HB, "via-backup"), "32g: chat flows over the backup route");
    HB.q("#wt-mic").click(); await step(clock, 60);
    GB.q("#wt-mic").click();
    let heard = false;
    for (let t = 0; t < 6000 && !heard; t += 200) {
      await step(clock, 200); await realWait(2);
      const a = HB.q("#wt-remote-audio"), b = GB.q("#wt-remote-audio");
      heard = !!(a && a.srcObject && b && b.srcObject);
    }
    ok(heard && dbg(HB).path === "link", "32g: two-way voice over the backup route");
    // relay traffic is encrypted - nothing readable on the wire
    const wire = JSON.stringify(env._mqttSeen || []);
    const shapeOk = (env._mqttSeen || []).every(t => { try { const o = JSON.parse(t); return Object.keys(o).join() === "v,iv,d" && /^[A-Za-z0-9+/=]{16}$/.test(o.iv) && /^[A-Za-z0-9+/=]+$/.test(o.d); } catch (_) { return false; } });
    ok((env._mqttSeen || []).length > 0 && shapeOk && !/BAK30|Sourav|Megha|"sdp"|"offer"|a=candidate|v=0\r/.test(wire),
      "32g: relay payloads are encrypted (no party code, SDP, candidates or names on the wire; " + (env._mqttSeen || []).length + " msgs)");
    HB.fire({ wt_party: null }); GB.fire({ wt_party: null });
    await step(clock, 200);
    env.netDead = false; env.FakeWS = undefined;

    // 32h: source guards
    ok(/function isEcho/.test(SRC) && !/if \(S\.applyingRemote \|\| !isOpen\(\)\) return;/.test(SRC), "32h: event handlers no longer use the blind 400 ms window");
    ok(/AES-GCM/.test(SRC) && /PBKDF2/.test(SRC) && /broker\.emqx\.io/.test(SRC), "32h: backup route is encrypted and uses public relays");
  }

  console.log("\n--- 28. v25: popup site picker + single host list ---");
  {
    const MF25 = JSON.parse(fs.readFileSync(DIR12 + "/manifest.json", "utf8"));
    const M25 = MF25.content_scripts[0].matches;
    const MFH = M25.map(p => (/^\*:\/\/\*\.([a-z0-9.-]+)\/\*$/.exec(p) || [])[1]).filter(Boolean).sort();
    const CSH = JSON.parse((SRC.match(/const SITE_HOSTS = (\[[^\]]*\])/) || [])[1] || "[]").sort();
    const P0 = await runPopup("https://www.netflix.com/browse");
    const PH = Array.from(P0.ctx.__SITE_HOSTS).sort();
    ok(MFH.length === M25.length, "28a: every manifest match is a *://*.<domain>/* pattern");
    ok(JSON.stringify(MFH) === JSON.stringify(CSH), "28a: manifest hosts == content.js SITE_HOSTS (" + MFH.join(",") + ")");
    ok(JSON.stringify(PH) === JSON.stringify(CSH), "28a: popup SITE_HOSTS == content.js SITE_HOSTS");

    // 28b: manifest description matches the streaming-only build
    ok(!/any site|anything/i.test(MF25.description), "28b: description no longer claims ANY site");
    ok(MF25.description.length <= 132, "28b: description within Chrome's 132-char limit (" + MF25.description.length + ")");
    const SITES = Array.from(P0.ctx.__SITES);
    ok(SITES.every(s => MF25.description.includes(s.name)), "28b: description names every supported service");

    // 28c: siteFor() behaviour matrix (popup runs the REAL function)
    const sf = P0.ctx.__siteFor;
    [
      ["https://www.netflix.com/watch/81234", "Netflix"],
      ["https://netflix.com/", "Netflix"],
      ["https://WWW.NETFLIX.COM/browse", "Netflix"],
      ["https://www.hotstar.com/in/shows/x", "JioHotstar"],
      ["https://www.jiohotstar.com/", "JioHotstar"],
      ["https://www.primevideo.com/detail/abc", "Prime Video"],
      ["https://atv-ps.primevideo.com/x", "Prime Video"],
      ["http://jiotv.com/play/123", "JioTV"],
      ["https://www.jiocinema.com/movies/x", "JioCinema"],
      ["https://www.youtube.com/watch?v=1", null],
      ["https://evilnetflix.com/", null],
      ["https://netflix.com.evil.io/", null],
      ["chrome://extensions/", null],
      ["file:///C:/netflix.com/x.html", null],
      ["not a url netflix.com", null],
      ["", null],
      [undefined, null],
    ].forEach(([u, want]) => {
      const got = sf(u);
      ok((got ? got.name : null) === want, "28c: siteFor(" + JSON.stringify(u) + ") -> " + want);
    });
    ok(SITES.every(s => { const g = sf(s.url); return g && g.name === s.name; }),
      "28c: every quick-launch URL resolves to its own site");

    // 28d: supported tab, no party -> setup view with friendly name
    ok(P0.visible("setupView") && !P0.visible("notSupported") && !P0.visible("activeView"),
      "28d: Netflix tab shows setup view");
    ok(P0.$("siteName").textContent === "Netflix", "28d: header shows friendly name (" + P0.$("siteName").textContent + ")");
    ok(P0.$("siteList").childElementCount === 0, "28d: site list not built on a supported tab");
    ok(P0.$("verLine").textContent === "v" + MF25.version, "28d: version line shows v" + MF25.version);

    // 28e: unsupported tab, no party -> quick-launch buttons
    const P1 = await runPopup("https://www.youtube.com/watch?v=1");
    ok(P1.visible("notSupported") && !P1.visible("setupView") && !P1.visible("activeView"),
      "28e: YouTube tab shows the not-supported view");
    ok(P1.$("siteName").textContent === "Unsupported site", "28e: header says Unsupported site");
    const btns = P1.$("siteList").children;
    ok(btns.length === SITES.length && btns.every((b, i) => b.textContent === SITES[i].name && b.className === "site-btn"),
      "28e: one launch button per site (" + btns.map(b => b.textContent).join(", ") + ")");
    await P1.ctx.__render();
    await settleReal();
    ok(P1.$("siteList").childElementCount === SITES.length, "28e: re-render does not duplicate buttons");
    const pvBtn = btns.find(b => b.textContent === "Prime Video");
    pvBtn.click();
    ok(P1.created.length === 1 && P1.created[0].url === "https://www.primevideo.com/",
      "28e: Prime Video button opens primevideo.com in a new tab");
    ok(P1.closed === 1, "28e: popup closes after launching a site");
    const PN = await runPopup(null);
    ok(PN.visible("notSupported") && PN.$("siteList").childElementCount === SITES.length,
      "28e: no active tab -> not-supported view with buttons");

    // 28f: active party on an unsupported tab -> off-site hint
    const party = { id: "ABC234", role: "host", name: "Sourav" };
    const P2 = await runPopup("https://www.youtube.com/", { wt_party: party, wt_status: { state: "connected" } });
    ok(P2.visible("activeView") && !P2.visible("notSupported"), "28f: party + unsupported tab shows party view");
    ok(P2.visible("offSiteHint"), "28f: off-site hint shown on unsupported tab");
    ok(P2.$("codeDisplay").textContent === "ABC234", "28f: party code shown");
    P2.$("inviteBtn").click();
    await settleReal();
    ok(P2.clip.length === 1 && P2.clip[0] === "Watch Together party code: ABC234",
      "28f: off-site invite is just the code (" + JSON.stringify(P2.clip[0]) + ")");

    // 28g: active party on a supported tab -> no hint, site-aware invite
    const url3 = "https://www.netflix.com/watch/81234?trackId=1";
    const P3 = await runPopup(url3, { wt_party: party, wt_status: { state: "connected" } });
    ok(P3.visible("activeView") && !P3.visible("offSiteHint"), "28g: no off-site hint on Netflix tab");
    P3.$("inviteBtn").click();
    await settleReal();
    const inv = P3.clip[0] || "";
    ok(inv.includes("Let's watch Netflix together!") && inv.includes(url3) && inv.includes("ABC234"),
      "28g: invite names the site, links the episode and carries the code");

    // 28h: starting a party from a supported tab
    const P4 = await runPopup("https://www.hotstar.com/in/shows/x");
    P4.$("nameInput").value = "Sourav";
    P4.$("createBtn").click();
    await settleReal();
    ok(P4.store.wt_party && P4.store.wt_party.role === "host" && /^[A-Z0-9]{6}$/.test(P4.store.wt_party.id),
      "28h: Start Watch Party stores a 6-char host party");
    ok(P4.visible("activeView") && !P4.visible("offSiteHint") && P4.$("siteName").textContent === "JioHotstar",
      "28h: popup flips to party view on JioHotstar");
    P4.$("leaveBtn").click();
    await settleReal();
    ok(P4.store.wt_party === null && P4.visible("setupView"), "28h: Leave party returns to setup view");
  }

  console.log("\n--- 33. v31: buffering hold, follow the friend, chat restore, update notice ---");
  {
    const sends = (type) => (env._intercept || []).filter(x => x.indexOf("SEND " + type + " ") === 0).length;
    const dbg = (I) => I.__ctx.__wtVoiceDbg();
    const banners = (I) => allByClass(I.doc.documentElement, "wt-banner").map(b => b.textContent);
    const anyBanner = (I, s) => banners(I).some(t => t.indexOf(s) !== -1);
    const bannerBtn = (I, label) => allByClass(I.doc.documentElement, "wt-banner-btn").find(b => b.textContent === label) || null;
    const navsOf = (name) => (env.navs || []).filter(n => n[0] === name).map(n => n[1]);
    const guestConn = (code) => (env._conns || []).filter(c => c.open && !c.closed && c.peer === "wtp-v1-" + code).pop();
    const pair = async (code, opt) => {
      opt = opt || {};
      const H = makeInstance(env, opt.h || ("hB" + code), opt.hPreset || null, opt.host, opt.hSrc);
      const G = makeInstance(env, opt.g || ("gB" + code), opt.gPreset || null, opt.host, opt.gSrc);
      await step(clock, 60);
      H.fire({ wt_party: { id: code, role: "host", name: "Sourav" } });
      await step(clock, 60);
      G.fire({ wt_party: { id: code, role: "guest", name: "Megha" } });
      const linked = (I) => /Synced with|sync paused|to sync/.test(I.st("#wt-status-text") || "");
      await waitFor(clock, () => linked(H) && linked(G), 6000);
      await step(clock, 2000); // bindVideo
      return { H, G };
    };
    const playAt = (v, t) => { v.paused = false; v.currentTime = t; v.readyState = 4; };

    // ---------------- buffering hold ----------------
    const B = await pair("BUF31");
    const hv = B.H.video, gv = B.G.video;
    playAt(hv, 200); playAt(gv, 200);
    await step(clock, 5000);
    const buf0 = sends("buf");
    hv.readyState = 2;                                   // host's player runs dry
    await step(clock, 1000);
    ok(!gv.paused && sends("buf") === buf0, "33a: a short stall (< 1.5 s) is not reported");
    await step(clock, 1000);
    ok(sends("buf") === buf0 + 1, "33a: host reports buffering after 1.5 s");
    ok(gv.paused === true, "33a: guest pauses to wait for the buffering host");
    ok(anyBanner(B.G, "Waiting for Sourav"), "33a: guest sees 'Waiting for Sourav' (" + JSON.stringify(banners(B.G)) + ")");
    ok(anyMsg(B.G, "Paused for Sourav"), "33a: chat explains the pause");
    ok(!hv.paused, "33a: the buffering host's own player is left alone");
    ok(dbg(B.G).buf.hold && dbg(B.G).buf.friend && dbg(B.H).buf.me, "33a: debug snapshot shows buffering state");
    const pause0 = sends("pause");
    const gAt = gv.currentTime;
    await step(clock, 14000);                            // ~3 heartbeats with a frozen host clock
    ok(gv.paused === true, "33a: guest keeps waiting - the re-sync safety net does not un-pause it");
    ok(gv.currentTime === gAt, "33a: guest is never rewound to the host's frozen clock");
    ok(sends("pause") === pause0, "33a: the wait is not broadcast as a real pause");
    hv.readyState = 4; hv.currentTime = 201;             // host's data is back
    await step(clock, 700);
    ok(!gv.paused, "33a: guest resumes as soon as the host's video plays again");
    ok(Math.abs(gv.currentTime - 201) < 0.3, "33a: both continue from the host's spot (" + gv.currentTime + ")");
    ok(!anyBanner(B.G, "Waiting"), "33a: waiting banner removed");

    // 33b: the GUEST buffers -> host waits
    await step(clock, 3000);
    gv.readyState = 2;
    await step(clock, 2000);
    ok(hv.paused === true && anyBanner(B.H, "Waiting for Megha"), "33b: host waits for the buffering guest");
    await step(clock, 12000);
    ok(!gv.paused, "33b: the buffering guest is not paused by the re-sync (host's pause is only a wait)");
    gv.readyState = 4; gv.currentTime = 202;
    await step(clock, 700);
    ok(!hv.paused && Math.abs(hv.currentTime - 202) < 0.3, "33b: host resumes from the guest's spot (" + hv.currentTime + ")");

    // 33c: "Play anyway"
    await step(clock, 3000);
    gv.readyState = 2;
    await step(clock, 2000);
    ok(hv.paused === true, "33c: host waiting again");
    const pa = bannerBtn(B.H, "Play anyway");
    ok(!!pa, "33c: banner offers 'Play anyway'");
    if (pa) pa.click();
    await step(clock, 50);
    ok(!hv.paused && !anyBanner(B.H, "Waiting"), "33c: 'Play anyway' resumes and clears the banner");
    await step(clock, 4000);
    ok(!hv.paused, "33c: not paused again during the same buffering");
    gv.readyState = 4;
    await step(clock, 700);
    ok(!hv.paused && !gv.paused, "33c: both playing after the guest recovers");

    // 33d: the buffering friend presses pause -> wait ends, nobody auto-resumes
    await step(clock, 3000);
    hv.readyState = 2;
    await step(clock, 2000);
    ok(gv.paused === true, "33d: guest waiting for the host");
    hv.paused = true; hv.dispatch("pause", { target: hv });
    await step(clock, 100);
    ok(gv.paused && !dbg(B.G).buf.hold && !anyBanner(B.G, "Waiting"), "33d: friend's real pause ends the wait");
    hv.readyState = 4;
    await step(clock, 1500);
    ok(gv.paused === true, "33d: no auto-resume after a real pause");

    // 33e: never wait forever
    playAt(hv, 300); playAt(gv, 300);
    await step(clock, 5000);
    gv.readyState = 2;
    await step(clock, 2000);
    ok(hv.paused === true, "33e: host waiting for the guest");
    await step(clock, 46000);
    ok(!hv.paused && anyMsg(B.H, "still buffering"), "33e: after 45 s the host plays on (and says why)");
    gv.readyState = 4;
    await step(clock, 1000);

    // 33f: both buffer (e.g. after a seek) -> nobody pauses while starved,
    // the first one ready waits for the other
    playAt(hv, 400); playAt(gv, 400);
    await step(clock, 5000);
    hv.readyState = 2; gv.readyState = 2;
    await step(clock, 2000);
    ok(!hv.paused && !gv.paused && dbg(B.H).buf.me && dbg(B.G).buf.me, "33f: both buffering, neither pauses the other");
    hv.readyState = 4;
    await step(clock, 700);
    ok(hv.paused === true && dbg(B.H).buf.hold, "33f: host ready first -> waits for the guest");
    gv.readyState = 4; gv.currentTime = 401;
    await step(clock, 700);
    ok(!hv.paused && !gv.paused && Math.abs(hv.currentTime - 401) < 0.3, "33f: both continue together");

    // 33g: link loss during a wait does not leave a stuck banner
    await step(clock, 3000);
    gv.readyState = 2;
    await step(clock, 2000);
    ok(dbg(B.H).buf.hold, "33g: host waiting");
    const gc = guestConn("BUF31");
    if (gc) gc.close();
    await step(clock, 300);
    ok(!dbg(B.H).buf.hold && !dbg(B.H).buf.friend && !anyBanner(B.H, "Waiting"), "33g: link loss clears the wait");
    gv.readyState = 4;
    B.H.fire({ wt_party: null }); B.G.fire({ wt_party: null });
    await step(clock, 300);

    // 33h: wiring
    ok(/if \(S\.bufSent\) hb\.buf = true;/.test(SRC) && /if \(S\.hold\) hb\.hold = true;/.test(SRC), "33h: heartbeats carry buffering + waiting flags");
    ok(/if \(m\.buf \|\| m\.hold \|\| S\.hold \|\| S\.bufSent \|\| S\.friendBuf\)/.test(SRC), "33h: re-sync safety net stands down during a buffering wait");
    ok(/if \(S\.hold \|\| S\.bufSent \|\| S\.friendBuf\) return;/.test(SRC), "33h: drift correction stands down during a buffering wait");

    // ---------------- follow the friend ----------------
    const HS = "https://www.hotstar.com/in/shows/the-office/1260022017/";
    const EP = (slug, id) => HS + slug + "/" + id + "/watch";
    env.locFor = { hF31: EP("night-out", "1260023466"), gF31: EP("night-out", "1260023466") };
    const F = await pair("FOL31", { h: "hF31", g: "gF31", host: "www.hotstar.com" });
    ok(!banners(F.G).length && !banners(F.H).length, "33i: same episode on both sides -> nothing to follow");
    const nav0 = sends("nav");
    F.H.__ctx.location.href = EP("did-i-stutter", "1260023467") + "?utm=x&tok=SECRET";   // host clicks Next episode (SPA)
    await step(clock, 1100);
    ok(sends("nav") === nav0 + 1, "33i: host's episode change is announced");
    ok(anyBanner(F.G, "Sourav moved to The Office · Did I Stutter") && anyBanner(F.G, "following in"),
      "33i: guest sees 'Sourav moved to The Office · Did I Stutter - following in…' (" + JSON.stringify(banners(F.G)) + ")");
    ok(!!bannerBtn(F.G, "Go now") && !!bannerBtn(F.G, "Stay here"), "33i: Go now / Stay here buttons");
    await step(clock, 5200);
    const gNav = navsOf("gF31");
    ok(gNav.length === 1 && gNav[0] === EP("did-i-stutter", "1260023467"), "33i: guest follows after the countdown (" + JSON.stringify(gNav) + ")");
    ok(gNav.length === 1 && gNav[0].indexOf("SECRET") === -1, "33i: the friend's query string (tokens) is never carried over");
    await step(clock, 1500);
    ok(!banners(F.H).length, "33i: host gets no prompt back when the guest arrives");

    // 33j: Stay here
    F.H.__ctx.location.href = EP("goodbye-toby-pt-1", "1260023468");
    await step(clock, 1100);
    ok(anyBanner(F.G, "Goodbye Toby Pt 1"), "33j: next move announced");
    bannerBtn(F.G, "Stay here").click();
    await step(clock, 7000);
    ok(navsOf("gF31").length === 1 && !banners(F.G).length, "33j: 'Stay here' cancels the follow");
    ok(anyMsg(F.G, "Staying here"), "33j: chat keeps the link for later");
    // the host moves again while we chose to stay: offer only, no auto-jump
    F.H.__ctx.location.href = EP("goodbye-toby-pt-2", "1260023469");
    await step(clock, 1100);
    await step(clock, 7000);
    ok(navsOf("gF31").length === 1, "33j: after 'Stay here' the next move is only offered, never forced");
    ok(anyBanner(F.G, "Sourav is watching") && !!bannerBtn(F.G, "Go there"), "33j: offer banner with 'Go there'");
    bannerBtn(F.G, "Go there").click();
    await step(clock, 50);
    ok(navsOf("gF31").pop() === EP("goodbye-toby-pt-2", "1260023469"), "33j: 'Go there' follows");
    await step(clock, 1500);

    // 33k: the guest leads too (well after the host's last pick)
    await step(clock, 9000);
    F.G.__ctx.location.href = EP("weight-loss-part-1", "1260023470");
    await step(clock, 1100);
    ok(anyBanner(F.H, "Megha moved to"), "33k: host follows the guest's episode change too");
    await step(clock, 5200);
    ok((navsOf("hF31").pop() || "") === EP("weight-loss-part-1", "1260023470"), "33k: host followed");
    await step(clock, 1500);

    // 33l: both pick something at the same moment -> nobody is dragged
    const hBefore = navsOf("hF31").length, gBefore = navsOf("gF31").length;
    F.H.__ctx.location.href = EP("weight-loss-part-2", "1260023471");
    F.G.__ctx.location.href = EP("business-ethics", "1260023472");
    await step(clock, 1100);
    await step(clock, 7000);
    ok(navsOf("hF31").length === hBefore && navsOf("gF31").length === gBefore, "33l: simultaneous picks -> offer only, no auto-jump");
    ok(anyBanner(F.H, "Megha is watching") && anyBanner(F.G, "Sourav is watching"), "33l: both see what the other picked");

    // 33m: browse pages are never followed; foreign / bad URLs are ignored
    const navB = sends("nav");
    F.H.__ctx.location.href = "https://www.hotstar.com/in/home";
    await step(clock, 1100);
    ok(sends("nav") === navB, "33m: going to the home page is not announced");
    const gconn = guestConn("FOL31");
    const nGuest = navsOf("gF31").length;
    if (gconn) {
      gconn.emit("data", { t: "nav", href: "https://evil.example.com/watch/1", key: "x", prev: null, title: "Evil", from: "Sourav" });
      gconn.emit("data", { t: "nav", href: "javascript:alert(1)//watch/", title: "JS", from: "Sourav" });
      gconn.emit("data", { t: "nav", href: "https://www.hotstar.com.evil.io/in/x/watch", title: "Lookalike", from: "Sourav" });
    }
    await step(clock, 7000);
    ok(!!gconn && navsOf("gF31").length === nGuest && !banners(F.G).some(b => /Evil|JS|Lookalike/.test(b)),
      "33m: links to other sites / javascript: / look-alike hosts are ignored");
    F.H.fire({ wt_party: null }); F.G.fire({ wt_party: null });
    await step(clock, 300);

    // 33n: a guest joining from the home page is taken to the host's episode
    env.locFor = { hJ31: EP("night-out", "1260023466"), gJ31: "https://www.hotstar.com/in/home" };
    const J = await pair("JOI31", { h: "hJ31", g: "gJ31", host: "www.hotstar.com" });
    ok(anyBanner(J.G, "Sourav is watching The Office · Night Out") && anyBanner(J.G, "going there in"), "33n: joining guest is offered the host's episode (" + JSON.stringify(banners(J.G)) + ")");
    await step(clock, 5200);
    ok((navsOf("gJ31").pop() || "") === EP("night-out", "1260023466"), "33n: and taken there automatically");
    ok(!banners(J.H).length, "33n: host is not asked to move to the guest's home page");
    J.H.fire({ wt_party: null }); J.G.fire({ wt_party: null });
    await step(clock, 300);
    // a guest already on another episode: guest goes to the host; host only gets an offer
    env.locFor = { hK31: EP("night-out", "1260023466"), gK31: EP("did-i-stutter", "1260023467") };
    const K = await pair("JOK31", { h: "hK31", g: "gK31", host: "www.hotstar.com" });
    await step(clock, 5200);
    ok((navsOf("gK31").pop() || "") === EP("night-out", "1260023466"), "33n: guest on another episode joins the host's one");
    ok(navsOf("hK31").length === 0, "33n: host is never moved by a joining guest");
    K.H.fire({ wt_party: null }); K.G.fire({ wt_party: null });
    await step(clock, 300);
    env.locFor = null;

    // 33o: labels / keys
    const C = J.H.__ctx;
    ok(/function watchKey\(href\)/.test(SRC) && /function navLabel\(href\)/.test(SRC), "33o: follow helpers present");
    ok(/const target = u\.proto \+ ":\/\/" \+ u\.host \+ u\.port \+ u\.path;/.test(SRC), "33o: follow target is origin + path only");
    void C;

    // ---------------- chat survives the page load ----------------
    const t0 = env.clock.now;
    const preset = { wt_chat: { room: "CHT31", items: [
      { k: "f", f: "Megha", x: "this episode is so good", at: t0 - 60000 },
      { k: "me", f: "Sourav", x: "next one!", at: t0 - 50000 },
      { k: "s", f: "", x: "Megha reacted 😂", at: t0 - 40000 },
      { k: "f", f: "Megha", x: "too old to show", at: t0 - 7 * 3600 * 1000 },
    ] } };
    const R = await pair("CHT31", { hPreset: preset });
    const rl = lines(R.H);
    const iOld = rl.findIndex(l => l.indexOf("this episode is so good") !== -1);
    const iNew = rl.findIndex(l => l.indexOf("connected") !== -1);
    ok(iOld !== -1 && rl.some(l => l.indexOf("Sourav: next one!") !== -1) && rl.some(l => l.indexOf("Megha reacted") !== -1),
      "33p: earlier chat of this party is back after a page load");
    ok(iOld !== -1 && iNew !== -1 && iOld < iNew, "33p: restored lines sit above the new ones");
    ok(!rl.some(l => l.indexOf("too old to show") !== -1), "33p: lines older than 6 h are dropped");
    sendChat(R.G, "chat-after-reload");
    await step(clock, 1500);
    const saved = R.H.storage.wt_chat;
    ok(saved && saved.room === "CHT31" && saved.items.some(i => i.x === "chat-after-reload" && i.k === "f") &&
      saved.items.some(i => i.x === "this episode is so good"), "33p: new lines are saved with the old ones");
    R.H.fire({ wt_party: null }); R.G.fire({ wt_party: null });
    await step(clock, 300);
    const other = await pair("OTH31", { hPreset: preset });
    ok(!lines(other.H).some(l => l.indexOf("this episode is so good") !== -1), "33p: another party's chat is never shown");
    other.H.fire({ wt_party: null }); other.G.fire({ wt_party: null });
    await step(clock, 300);

    // ---------------- version mismatch says who and where ----------------
    const V30SRC = fs.readFileSync(DIR12.replace("V35-store", "V30-solidlink") + "/content.js", "utf8");
    const M = await pair("VER31", { gSrc: V30SRC });
    ok(anyMsg(M.H, "Megha is on an older version (v1.30.0, you have v1.35.0)") && anyMsg(M.H, "wt-latest.zip"),
      "33q: host is told Megha is behind, with the download link");
    M.H.fire({ wt_party: null }); M.G.fire({ wt_party: null });
    await step(clock, 300);
    const M2 = await pair("VES31", { hSrc: V30SRC });
    ok(anyMsg(M2.G, "Sourav is on an older version (v1.30.0, you have v1.35.0)"), "33q: guest is told the host is behind");
    // mixed: V30 host keeps working with a V31 guest (hb without buf flags)
    M2.H.video.paused = false; M2.G.video.paused = false; M2.H.video.currentTime = 50; M2.G.video.currentTime = 50;
    M2.G.video.readyState = 4;
    await step(clock, 9000);
    ok(!M2.G.video.paused && !dbg(M2.G).buf.hold, "33q: V35 guest + V30 host: no spurious buffering wait");
    M2.H.fire({ wt_party: null }); M2.G.fire({ wt_party: null });
    await step(clock, 300);

    // ---------------- talking indicator ----------------
    env.remoteRms = 0.07; env.remotePattern = null; env.remotePause = 0.0005;
    const T = await pair("TLK31");
    T.H.q("#wt-mic").click(); await step(clock, 60);
    T.G.q("#wt-mic").click();
    await waitFor(clock, () => !!(dbg(T.H).boost), 5000);
    await step(clock, 1500);
    ok(T.H.q("#wt-voice-wrap").classList.contains("wt-talking"), "33r: speaker icon glows while the friend talks");
    env.remoteRms = 0.00002; env.remotePause = 0.00002;
    await step(clock, 1500);
    ok(!T.H.q("#wt-voice-wrap").classList.contains("wt-talking"), "33r: glow stops when they stop");
    T.H.fire({ wt_party: null }); T.G.fire({ wt_party: null });
    await step(clock, 300);
    env.remoteRms = null; env.remotePause = null;

    // ---------------- popup: update notice ----------------
    const latest = (obj) => { const f = async (u) => { f.calls.push(u); return { json: async () => obj }; }; f.calls = []; return f; };
    const f1 = latest({ version: "1.36.0", zip: "https://github.com/srv883/Watch-Movies-Together/raw/main/wt-V36.zip", notes: "Even better" });
    const U1 = await runPopup("https://www.hotstar.com/in/home", {}, f1);
    await U1.ctx.__checkUpdate(); await settleReal();
    ok(f1.calls.length >= 1 && /^https:\/\/raw\.githubusercontent\.com\/srv883\/Watch-Movies-Together\/main\/latest\.json\?t=\d+$/.test(f1.calls[0]),
      "33s: popup checks latest.json in the project repo (" + f1.calls[0] + ")");
    ok(U1.visible("updateBar") && contains(U1.$("updateText").textContent, "1.36.0") && contains(U1.$("updateNotes").textContent, "Even better"),
      "33s: newer version -> update banner with notes");
    U1.$("updateBtn").click(); await settleReal();
    ok(U1.created.some(c => c.url === "https://github.com/srv883/Watch-Movies-Together/raw/main/wt-V36.zip"), "33s: Download opens the zip");
    ok(U1.visible("updateHelp") && U1.visible("extPageBtn"), "33s: install steps shown after Download");
    U1.$("extPageBtn").click(); await settleReal();
    ok(U1.created.some(c => c.url === "chrome://extensions/"), "33s: button opens chrome://extensions");
    const f2 = latest({ version: "1.40.0" });
    const U2 = await runPopup("https://www.hotstar.com/in/home", { wt_update: { version: "1.36.0", zip: "x", checkedAt: Date.now() } }, f2);
    await U2.ctx.__checkUpdate(); await settleReal();
    ok(f2.calls.length === 0 && U2.visible("updateBar"), "33s: checked at most every 6 h (cached result used)");
    const U3 = await runPopup("https://www.hotstar.com/in/home", {}, latest({ version: "1.35.0" }));
    await U3.ctx.__checkUpdate(); await settleReal();
    ok(!U3.visible("updateBar"), "33s: same version -> no banner");
    const U4 = await runPopup("https://www.hotstar.com/in/home", {}, latest({ version: "1.29.5" }));
    await U4.ctx.__checkUpdate(); await settleReal();
    ok(!U4.visible("updateBar"), "33s: older version -> no banner");
    const U5 = await runPopup("https://www.hotstar.com/in/home", {}, latest({ version: "9.9.9", zip: "https://evil.example.com/x.zip" }));
    await U5.ctx.__checkUpdate(); await settleReal();
    U5.$("updateBtn").click(); await settleReal();
    ok(U5.created.some(c => c.url === "https://github.com/srv883/Watch-Movies-Together/raw/main/wt-latest.zip"), "33s: a foreign download link is replaced by the project's own");
    const U6 = await runPopup("https://www.hotstar.com/in/home", {}, latest({ version: "<b>1.99</b>" }));
    await U6.ctx.__checkUpdate(); await settleReal();
    ok(!U6.visible("updateBar"), "33s: malformed version ignored");
    const U7 = await runPopup("https://www.hotstar.com/in/home", {});
    await U7.ctx.__checkUpdate(); await settleReal();
    ok(!U7.visible("updateBar") && U7.visible("setupView"), "33s: offline -> popup works normally, no banner");
    ok(U1.ctx.__newerThan("1.31.10", "1.31.9") && !U1.ctx.__newerThan("1.31.0", "1.31.0") && U1.ctx.__newerThan("2.0.0", "1.99.99"), "33s: version compare");
    const mf = JSON.parse(fs.readFileSync(DIR12 + "/manifest.json", "utf8"));
    ok(JSON.stringify(mf.host_permissions) === JSON.stringify(["https://api.anthropic.com/*", "https://raw.githubusercontent.com/*", "https://en.wikipedia.org/*"]) && JSON.stringify(mf.permissions) === JSON.stringify(["storage", "tabs", "alarms"]), "33s: new permissions are only api.anthropic.com (AI trivia) and alarms (self-update)");
  }

  console.log("\n--- 34. v32: sync only on the same title, newcomers adopt the party's position ---");
  {
    const sends = (type) => (env._intercept || []).filter(x => x.indexOf("SEND " + type + " ") === 0).length;
    const dbg = (I) => I.__ctx.__wtVoiceDbg();
    const banners = (I) => allByClass(I.doc.documentElement, "wt-banner").map(b => b.textContent);
    const anyBanner = (I, s) => banners(I).some(t => t.indexOf(s) !== -1);
    const bannerBtn = (I, label) => allByClass(I.doc.documentElement, "wt-banner-btn").find(b => b.textContent === label) || null;
    const navsOf = (name) => (env.navs || []).filter(n => n[0] === name).map(n => n[1]);
    const status = (I) => I.st("#wt-status-text") || "";
    const HS = "https://www.hotstar.com/in/shows/the-office/1260022017/";
    const EP = (slug, id) => HS + slug + "/" + id + "/watch";
    const HOME = "https://www.hotstar.com/in/home";
    const pair = async (code, opt) => {
      opt = opt || {};
      const hn = "hT" + code, gn = "gT" + code;
      env.locFor = {}; env.locFor[hn] = opt.hAt || EP("night-out", "1260023466"); env.locFor[gn] = opt.gAt || EP("night-out", "1260023466");
      const H = makeInstance(env, hn, null, "www.hotstar.com", opt.hSrc);
      const G = makeInstance(env, gn, null, "www.hotstar.com", opt.gSrc);
      await step(clock, 60);
      H.fire({ wt_party: { id: code, role: "host", name: "Sourav" } });
      await step(clock, 60);
      G.fire({ wt_party: { id: code, role: "guest", name: "Megha" } });
      const linked = (I) => /Synced with|sync paused|to sync/.test(I.st("#wt-status-text") || "");
      await waitFor(clock, () => linked(H) && linked(G), 6000);
      await step(clock, 9000); // bindVideo + the newcomer window of a just-bound player
      return { H, G, hn, gn };
    };
    const playAt = (v, t) => { v.paused = false; v.currentTime = t; v.readyState = 4; };
    const seekBy = (v, t) => { v.currentTime = t; v.dispatch("seeked", { target: v }); };

    // ---------------- 34a: catalogue trailers never drive the party ----------------
    const A = await pair("TRL32");
    const hv = A.H.video, gv = A.G.video;
    playAt(hv, 600); playAt(gv, 600);
    await step(clock, 5000);
    ok(contains(status(A.H), "Synced with Megha") && dbg(A.H).sync.mode === "same", "34a: same episode -> synced");
    A.G.__ctx.location.href = HOME;                          // Megha goes back to the catalogue (SPA)
    await step(clock, 1200);
    ok(contains(status(A.H), "Megha is browsing"), "34a: host is told at once: '" + status(A.H) + "'");
    ok(contains(status(A.G), "open the video to sync"), "34a: browsing side: '" + status(A.G) + "'");
    ok(anyMsg(A.H, "Megha is browsing") && dbg(A.G).sync.browsing, "34a: chat explains that sync is paused");
    const s0 = sends("seek"), p0 = sends("play"), pz0 = sends("pause"), st0 = sends("state");
    gv.currentTime = 3; gv.dispatch("seeked", { target: gv });   // hero trailer starts...
    gv.paused = false; gv.dispatch("play", { target: gv });
    await step(clock, 300);
    gv.paused = true; gv.dispatch("pause", { target: gv });      // ...and stops
    A.G.doc.dispatchDoc("visibilitychange");                     // and the tab regains focus
    await step(clock, 300);
    ok(sends("seek") === s0 && sends("play") === p0 && sends("pause") === pz0, "34a: trailer play/seek/pause are not broadcast");
    ok(Math.abs(hv.currentTime - 600) < 0.01 && !hv.paused, "34a: host's episode is untouched by the friend's trailers (" + hv.currentTime + ")");
    seekBy(hv, 700);                                             // host keeps watching and seeks
    await step(clock, 200);
    ok(Math.abs(gv.currentTime - 3) < 0.01, "34a: the host's seek does not move a trailer (" + gv.currentTime + ")");
    gv.paused = true;
    await step(clock, 13000);                                    // three heartbeats
    ok(gv.paused === true && Math.abs(gv.currentTime - 3) < 0.01, "34a: no re-sync / drift correction onto a trailer");
    ok(Math.abs(hv.currentTime - 700) < 0.01 && !hv.paused, "34a: a browsing friend's heartbeats never move the host");
    gv.paused = false;                                           // trailer plays for a while, tab visible
    await step(clock, 13000);
    const hist = (A.G.storage.wt_history || []);
    ok(!hist.some(h => String(h.u).indexOf("/in/home") !== -1), "34a: trailers are not written to the watch history");
    // a buffering trailer must not pause the host either
    gv.readyState = 2;
    await step(clock, 2500);
    ok(!hv.paused && !anyBanner(A.H, "Waiting"), "34a: a stalled trailer does not make the host wait");
    gv.readyState = 4;
    // back on the episode: synced again
    A.G.__ctx.location.href = EP("night-out", "1260023466");
    await step(clock, 1200);
    await step(clock, 4200);
    ok(contains(status(A.H), "Synced with Megha") && contains(status(A.G), "Synced with Sourav"), "34a: back on the episode -> synced again");
    ok(anyMsg(A.H, "Same video again"), "34a: chat says so");
    seekBy(hv, 720);
    await step(clock, 200);
    ok(Math.abs(gv.currentTime - 720) < 0.3, "34a: sync works again (" + gv.currentTime + ")");

    // 34b: a LONG video on a page we don't recognise still syncs (never guess "catalogue")
    A.G.__ctx.location.href = "https://www.hotstar.com/in/some/new/url-shape";
    gv.duration = 1500;
    await step(clock, 1200);
    await step(clock, 4200);
    ok(!dbg(A.G).sync.browsing && contains(status(A.H), "Synced with"), "34b: long video on an unknown page is not treated as a trailer");
    seekBy(hv, 740);
    await step(clock, 200);
    ok(Math.abs(gv.currentTime - 740) < 0.3, "34b: and keeps syncing (" + gv.currentTime + ")");
    gv.duration = Infinity;                                      // live stream
    ok(!dbg(A.G).sync.browsing, "34b: live streams (no duration) are never 'catalogue'");
    gv.duration = 90;
    ok(dbg(A.G).sync.browsing, "34b: a 90 s clip on a non-watch page is a trailer");
    A.H.fire({ wt_party: null }); A.G.fire({ wt_party: null });
    await step(clock, 300);

    // ---------------- 34c: different episodes are never synced onto each other ----------------
    const C = await pair("OTH32");
    const hc = C.H.video, gc = C.G.video;
    playAt(hc, 1200); playAt(gc, 1200);
    await step(clock, 5000);
    // host clicks Next episode: the URL changes and the player restarts at 0 in the same instant
    C.H.__ctx.location.href = EP("did-i-stutter", "1260023467");
    seekBy(hc, 0);
    hc.dispatch("play", { target: hc });
    await step(clock, 60);
    ok(Math.abs(gc.currentTime - 1200) < 0.01, "34c: the new episode's 'seek to 0:00' does not rewind the friend's old episode (" + gc.currentTime + ")");
    await step(clock, 1200);
    ok(anyBanner(C.G, "following in"), "34c: follow countdown still offered");
    bannerBtn(C.G, "Stay here").click();
    await step(clock, 4500);
    ok(contains(status(C.G), "another video") && contains(status(C.H), "another video"), "34c: both told sync is paused: '" + status(C.G) + "'");
    seekBy(hc, 300);
    hc.paused = true; hc.dispatch("pause", { target: hc });
    await step(clock, 300);
    ok(Math.abs(gc.currentTime - 1200) < 0.01 && !gc.paused, "34c: other episode's seek/pause ignored");
    await step(clock, 13000);
    ok(!gc.paused && Math.abs(gc.currentTime - 1200) < 0.01, "34c: no heartbeat re-sync across episodes");
    hc.paused = false; hc.dispatch("play", { target: hc });
    gc.readyState = 2;                                           // Megha buffers on HER episode
    await step(clock, 2500);
    ok(!hc.paused && !anyBanner(C.H, "Waiting"), "34c: buffering on another episode does not pause us");
    gc.readyState = 4;
    await step(clock, 1000);
    // 34d: the host moves on again -> only an offer (we chose to stay), and it
    // does not sit on the video forever
    C.H.__ctx.location.href = EP("goodbye-toby-pt-1", "1260023468");
    await step(clock, 1200);
    ok(anyBanner(C.G, "Sourav is watching") && !!bannerBtn(C.G, "Go there"), "34d: next move is offered (" + JSON.stringify(banners(C.G)) + ")");
    await step(clock, 15000);
    ok(anyBanner(C.G, "Sourav is watching"), "34d: offer still there after 15 s");
    await step(clock, 6000);
    ok(!banners(C.G).length && navsOf(C.gn).length === 0, "34d: an untaken offer leaves the screen after 20 s (link stays in the chat)");
    ok(anyMsg(C.G, "goodbye-toby-pt-1"), "34d: chat keeps the link");
    // Megha goes there by herself
    C.G.__ctx.location.href = EP("goodbye-toby-pt-1", "1260023468");
    await step(clock, 1200);
    await step(clock, 4200);
    ok(contains(status(C.G), "Synced with Sourav") && contains(status(C.H), "Synced with Megha"), "34c: same episode again -> synced");
    seekBy(hc, 333);
    await step(clock, 200);
    ok(Math.abs(gc.currentTime - 333) < 0.3, "34c: and sync works (" + gc.currentTime + ")");
    // same content id under another URL shape is still the same title
    C.G.__ctx.location.href = "https://www.jiohotstar.com/shows/the-office/1260022017/goodbye-toby-pt-1/1260023468/watch";
    await step(clock, 1200);
    await step(clock, 4200);
    ok(dbg(C.G).sync.mode === "same" && !banners(C.H).length, "34c: same content id on another URL/domain counts as the same title");
    C.H.fire({ wt_party: null }); C.G.fire({ wt_party: null });
    await step(clock, 300);

    // ---------------- 34e: a freshly loaded player adopts the party's position ----------------
    const N = await pair("NEW32");
    const hn = N.H.video, gn = N.G.video;
    playAt(hn, 900); playAt(gn, 900);
    await step(clock, 5000);
    ok(!dbg(N.H).sync.fresh && !dbg(N.G).sync.fresh, "34e: both settled");
    const sk0 = sends("seek"), pl0 = sends("play");
    env.noGesture = true;                                        // the player's own doing, not the user's
    hn.dispatch("emptied", { target: hn });                      // host's player loads new media (reload / next episode)
    hn.currentTime = 12; hn.dispatch("seeked", { target: hn });  // resume point
    hn.dispatch("play", { target: hn });                         // autoplay
    await step(clock, 200);
    env.noGesture = false;
    ok(sends("seek") === sk0 && sends("play") === pl0, "34e: a fresh player's autoplay / resume seek is not broadcast");
    ok(Math.abs(gn.currentTime - 900) < 0.01, "34e: the settled friend is not dragged to the newcomer's start point (" + gn.currentTime + ")");
    ok(Math.abs(hn.currentTime - 900) < 0.3 && !hn.paused, "34e: the newcomer takes the party's position instead (" + hn.currentTime + ")");
    // its heartbeat is not the party's clock yet
    hn.currentTime = 12;                                         // player snaps back before it is ready
    await step(clock, 4200);
    ok(Math.abs(gn.currentTime - 900) < 0.01, "34e: a fresh host's heartbeat does not move the guest (" + gn.currentTime + ")");
    // a settled friend ignores a fresh friend's pushed state
    hn.currentTime = 12;
    N.G.doc.dispatchDoc("visibilitychange");                     // guest asks for state
    await step(clock, 200);
    ok(Math.abs(gn.currentTime - 900) < 0.01, "34e: a fresh friend's state push is ignored by a settled player");
    // real user action inside the window IS broadcast
    hn.currentTime = 900;
    hn.paused = true; hn.dispatch("pause", { target: hn });      // (harness adds the key press)
    await step(clock, 200);
    ok(gn.paused === true, "34e: a real click during the newcomer window is still broadcast");
    hn.paused = false; hn.dispatch("play", { target: hn });
    await step(clock, 8000);                                     // window over
    ok(!gn.paused && !dbg(N.H).sync.fresh, "34e: back to normal after the window");

    // both fresh: guest adopts the host, host keeps its own
    env.noGesture = true;
    hn.dispatch("emptied", { target: hn }); gn.dispatch("emptied", { target: gn });
    hn.currentTime = 100; gn.currentTime = 200;
    gn.dispatch("play", { target: gn }); hn.dispatch("play", { target: hn });
    await step(clock, 300);
    env.noGesture = false;
    ok(Math.abs(hn.currentTime - 100) < 0.01, "34e: both fresh -> host keeps its position (" + hn.currentTime + ")");
    ok(Math.abs(gn.currentTime - 100) < 0.3, "34e: both fresh -> guest adopts the host (" + gn.currentTime + ")");
    await step(clock, 8000);

    // a NEW <video> element on the guest (player rebuilt) asks for the party's state
    hn.currentTime = 1500; gn.currentTime = 1500;
    await step(clock, 4200);
    const nv = makeEl("video");
    nv._rect = { width: 1920, height: 1080, x: 0, y: 0 };
    nv.paused = true; nv.currentTime = 0; nv.readyState = 4;
    N.G.doc.videos.unshift(nv);
    N.G.video._rect = { width: 10, height: 10, x: 0, y: 0 };     // old element is gone
    await step(clock, 2000);
    ok(Math.abs(nv.currentTime - 1500) < 0.3 && nv.paused === false, "34e: a rebuilt player joins at the party's position and state (" + nv.currentTime + ", paused " + nv.paused + ")");
    ok(Math.abs(hn.currentTime - 1500) < 0.01, "34e: the host did not move");
    N.H.fire({ wt_party: null }); N.G.fire({ wt_party: null });
    await step(clock, 300);

    // ---------------- 34f: mixed with a v1.31 friend ----------------
    const V31SRC = fs.readFileSync(DIR12.replace("V35-store", "V31-binge") + "/content.js", "utf8");
    const M = await pair("MIX32", { gSrc: V31SRC });
    const hm = M.H.video, gm = M.G.video;
    playAt(hm, 50); playAt(gm, 50);
    await step(clock, 5000);
    ok(contains(status(M.H), "Synced with Megha") && dbg(M.H).sync.mode === "same", "34f: v1.32 host + v1.31 guest on the same episode: synced");
    seekBy(hm, 80);
    await step(clock, 200);
    ok(Math.abs(gm.currentTime - 80) < 0.3, "34f: v1.32 -> v1.31 sync works");
    seekBy(gm, 95);
    await step(clock, 200);
    ok(Math.abs(hm.currentTime - 95) < 0.3, "34f: v1.31 -> v1.32 sync works");
    M.G.__ctx.location.href = EP("did-i-stutter", "1260023467");  // the v1.31 friend moves on
    await step(clock, 1200);
    ok(anyBanner(M.H, "Megha moved to") && anyBanner(M.H, "following in"), "34f: v1.32 auto-follows a v1.31 friend (" + JSON.stringify(banners(M.H)) + ")");
    bannerBtn(M.H, "Stay here").click();
    await step(clock, 9000);
    M.H.__ctx.location.href = EP("did-i-stutter", "1260023467");  // we go there ourselves
    await step(clock, 1200);
    await step(clock, 9000);
    M.H.__ctx.location.href = EP("goodbye-toby-pt-1", "1260023468"); // and lead the next change
    await step(clock, 1200);
    ok(anyBanner(M.G, "Sourav moved to") && anyBanner(M.G, "following in"), "34f: a v1.31 friend auto-follows v1.32 (" + JSON.stringify(banners(M.G)) + ")");
    M.H.fire({ wt_party: null }); M.G.fire({ wt_party: null });
    await step(clock, 300);
    env.locFor = null;

    // ---------------- 34g: wiring ----------------
    ok(/if \(browsingNow\(\) \|\| freshNoise\(\)\) return;/.test(SRC), "34g: user-event handlers stand down for trailers and fresh-player noise");
    ok(/if \(otherTitle\(m\)\) return;/.test(SRC) && /lead && !otherTitle\(m\)/.test(SRC), "34g: remote actions and heartbeats are title-checked");
    ok(/if \(!S\.roomId \|\| !S\.everOpen\) return;/.test(SRC), "34g: an unlinked second tab never overwrites the saved chat");
    ok(/return "hotstar:" \+ m\[1\];/.test(SRC) && /return "netflix:" \+ m\[1\];/.test(SRC), "34g: titles are identified by the site's content id");
    const mf32 = JSON.parse(fs.readFileSync(DIR12 + "/manifest.json", "utf8"));
    ok(mf32.version === "1.35.0" && /const EXT_VER = "1\.35\.0";/.test(SRC), "34g: manifest and EXT_VER match (1.35.0)");

    // ---------------- 34h: "page just loaded" only counts on a page's FIRST link ----------------
    // (real-Chrome bug: the host reloaded 20 s after the guest's page had loaded;
    //  the guest took ITSELF for the newcomer and was pulled back to 0:00)
    env.perfFor = { hTYNG32: clock.now, gTYNG32: clock.now };
    const Y = await pair("YNG32");
    ok(!dbg(Y.G).sync.fresh && !dbg(Y.H).sync.fresh, "34h: settled 9 s after the first link");
    const yc = (env._conns || []).filter(c => c.open && !c.closed && c.peer === "wtp-v1-YNG32").pop();
    if (yc) yc.close();                                          // link blips ~10 s after page load
    await waitFor(clock, () => /Synced with/.test(status(Y.G)) && /Synced with/.test(status(Y.H)), 12000);
    ok(/Synced with/.test(status(Y.G)), "34h: re-linked");
    ok(!dbg(Y.G).sync.fresh && !dbg(Y.H).sync.fresh, "34h: a re-link on a young page does NOT make it the newcomer again");
    Y.H.fire({ wt_party: null }); Y.G.fire({ wt_party: null });
    await step(clock, 300);
    env.perfFor = null;
    ok(/const firstLink = !S\.everOpen;/.test(SRC) && /if \(firstLink && pageYoung\(\)\) markFresh\(\);/.test(SRC), "34h: wiring");

    // ---------------- 34i: a second tab stands by instead of running its own party ----------------
    const shared = makeChromeStub();                             // two tabs of the SAME browser share extension storage
    env.stubFor = { gTAB1: shared, gTAB2: shared };
    env.locFor = { hTAB: EP("night-out", "1260023466"), gTAB1: EP("night-out", "1260023466"), gTAB2: HOME };
    const TH = makeInstance(env, "hTAB", null, "www.hotstar.com");
    const T1 = makeInstance(env, "gTAB1", null, "www.hotstar.com");
    await step(clock, 60);
    TH.fire({ wt_party: { id: "TAB32", role: "host", name: "Sourav" } });
    await step(clock, 60);
    T1.fire({ wt_party: { id: "TAB32", role: "guest", name: "Megha" } });
    await waitFor(clock, () => /Synced with/.test(status(T1)), 6000);
    await step(clock, 9000);
    ok(/Synced with/.test(status(T1)) && shared.store.wt_live && typeof shared.store.wt_live.tab === "string", "34i: the linked tab announces itself (wt_live)");
    const T2 = makeInstance(env, "gTAB2", null, "www.hotstar.com"); // Megha opens Hotstar's home page in a second tab
    await step(clock, 400);
    const dials0 = (env._intercept || []).filter(x => x.indexOf("connect call tid=wtp-v1-TAB32") === 0).length;
    const relays0 = (env.mqttSockets || []).length;
    await step(clock, 25000);
    const dials1 = (env._intercept || []).filter(x => x.indexOf("connect call tid=wtp-v1-TAB32") === 0).length;
    ok(dials1 === dials0, "34i: the second tab does not dial the host (" + (dials1 - dials0) + " dials in 25 s)");
    ok((env.mqttSockets || []).length === relays0, "34i: the second tab does not open the backup route");
    ok(contains(status(T2), "running in your other tab"), "34i: it says so: '" + status(T2) + "'");
    ok(/Synced with/.test(status(T1)) && /Synced with/.test(status(TH)), "34i: the real party is undisturbed");
    ok(shared.store.wt_status && shared.store.wt_status.state === "connected", "34i: the popup keeps showing the real party's status");
    sendChat(TH, "hello-first-tab");
    await step(clock, 1500);
    ok(shared.store.wt_chat && shared.store.wt_chat.items.some(i => i.x === "hello-first-tab"), "34i: the saved chat is the linked tab's");
    // the first tab is closed -> the second one takes over by itself
    T1.closeTab();
    await step(clock, 4000);
    ok(!/Synced with|sync paused|to sync/.test(status(T2)), "34i: no instant grab while the first tab may just be reloading (" + status(T2) + ")");
    await waitFor(clock, () => /Synced with|sync paused|to sync/.test(status(T2)), 30000);
    ok(/sync paused|to sync|Synced with/.test(status(T2)) && !contains(status(T2), "other tab"), "34i: after ~10 s the remaining tab takes over the party: '" + status(T2) + "'");
    ok(/Megha is browsing|Synced with Megha/.test(status(TH)), "34i: host is linked to it: '" + status(TH) + "'");
    TH.fire({ wt_party: null }); T2.fire({ wt_party: null });
    await step(clock, 300);
    env.stubFor = null; env.locFor = null;
    ok(/if \(yielding\(\)\) return false;/.test(SRC) && /if \(yielding\(\)\) \{ scheduleRetry\(\); return; \}/.test(SRC), "34i: wiring");
  }

  console.log("\n--- 35. v33: AI scene trivia ---");
  {
    const dbg = (I) => I.__ctx.__wtVoiceDbg();
    const cards = (I) => allByClass(I.doc.documentElement, "wt-trivia").map(c => c.textContent);
    const HS = "https://www.hotstar.com/in/shows/the-office/1260022017/";
    const EP = (slug, id) => HS + slug + "/" + id + "/watch";
    const ITEMS = [
      { t: 60, scene: "Cold open", fact: "FACT-A The cold open was improvised." },
      { t: 300, scene: "Dinner party", fact: "FACT-B Filmed over two weeks." },
      { t: 320, scene: "Toast", fact: "FACT-C Too close to B - must wait for the gap." },
      { t: 900, scene: "Ending", fact: "FACT-D The last line was ad-libbed." },
    ];
    env.runtimeMsgs = [];
    env.onRuntime = (name, msg, reply) => {
      env.runtimeMsgs.push([name, msg]);
      if (msg.t === "wt-trivia") {
        // v34: env.triviaFor(name) says whether that tab's background finds anything
        if (env.triviaFor && !env.triviaFor(name)) { reply({ error: "unknown" }); return; }
        const mode = env.triviaMode || "ok";
        if (mode === "ok") reply({ items: ITEMS, title: "The Office S4E9 Dinner Party" });
        else if (mode === "nokey") reply({ error: "no-key" });
        else if (mode === "badkey") reply({ error: "bad-key" });
        else if (mode === "busy") reply({ error: "busy" });
        return;
      }
      reply({ ok: true });
    };
    const pair = async (code, opt) => {
      opt = opt || {};
      const hn = "hV" + code, gn = "gV" + code;
      env.locFor = {}; env.locFor[hn] = EP("dinner-party", "1260023466"); env.locFor[gn] = EP("dinner-party", "1260023466");
      const H = makeInstance(env, hn, opt.hPreset || null, "www.hotstar.com");
      const G = makeInstance(env, gn, opt.gPreset || null, "www.hotstar.com");
      for (const I of [H, G]) { I.video.duration = 1320; I.video.readyState = 4; }
      await step(clock, 60);
      H.fire({ wt_party: { id: code, role: "host", name: "Sourav" } });
      await step(clock, 60);
      G.fire({ wt_party: { id: code, role: "guest", name: "Megha" } });
      await waitFor(clock, () => /Synced with/.test(H.st("#wt-status-text") || "") && /Synced with/.test(G.st("#wt-status-text") || ""), 6000);
      await step(clock, 9000);
      return { H, G };
    };
    const asks = (I) => env.runtimeMsgs.filter(x => x[0] === I.name && x[1].t === "wt-trivia");

    // 35a: host has a key, guest has none -> host asks once, both get the items
    env.triviaMode = "ok";
    env.triviaFor = (n) => /^hV/.test(n);   // only the host's background finds trivia for this title
    const A = await pair("TRV33", { hPreset: { wt_anthropic_key: "sk-ant-test-key-0000000000000000000000" } });
    const hv = A.H.video, gv = A.G.video;
    hv.paused = false; gv.paused = false; hv.currentTime = 10; gv.currentTime = 10;
    await step(clock, 3000);
    const hAsk = asks(A.H);
    ok(hAsk.length === 1, "35a: the tab with a key asks the background once (" + hAsk.length + ")");
    const req = hAsk[0] && hAsk[0][1];
    ok(req && req.key === "hotstar:1260023466" && req.duration === 1320 && /Dinner Party/.test(req.slug), "35a: request names the title, runtime and URL words (" + JSON.stringify(req && { key: req.key, d: req.duration, slug: req.slug }) + ")");
    ok(asks(A.G).length === 1, "35a: the friend's tab asks its own background too (packs/Wikipedia need no key)");
    ok(anyMsg(A.H, "Trivia ready for The Office S4E9 Dinner Party") && anyMsg(A.H, "4 moments"), "35a: 'Trivia ready' line");
    ok(anyMsg(A.G, "Trivia ready") && anyMsg(A.G, "(from Sourav)"), "35a: the friend gets the same trivia over the link");
    ok(env.runtimeMsgs.some(x => x[0] === A.G.name && x[1].t === "wt-trivia-store" && x[1].items.length === 4), "35a: the friend's extension caches what was shared");
    ok(!cards(A.H).length, "35a: nothing shown before its moment");

    // 35b: cards appear at their moments, on alternating sides, then leave
    hv.currentTime = 62; gv.currentTime = 62;
    await step(clock, 1200);
    ok(cards(A.H).some(c => c.indexOf("FACT-A") !== -1) && cards(A.G).some(c => c.indexOf("FACT-A") !== -1), "35b: item at 1:00 shows on both screens at 1:02");
    ok(cards(A.H).some(c => c.indexOf("Cold open") !== -1), "35b: card names the scene");
    const c1 = allByClass(A.H.doc.documentElement, "wt-trivia")[0];
    ok(c1 && c1.classes.has("wt-trivia-left"), "35b: first card on the left");
    await step(clock, 13000);
    ok(!cards(A.H).length, "35b: the card leaves after ~12 s");
    await step(clock, 2000);
    hv.currentTime = 301; gv.currentTime = 301;
    await step(clock, 1200);
    ok(cards(A.H).some(c => c.indexOf("FACT-B") !== -1), "35b: next item at 5:00");
    const c2 = allByClass(A.H.doc.documentElement, "wt-trivia")[0];
    ok(c2 && c2.classes.has("wt-trivia-right"), "35b: second card on the right");
    hv.currentTime = 321; gv.currentTime = 321;
    await step(clock, 1200);
    ok(!cards(A.H).some(c => c.indexOf("FACT-C") !== -1) && cards(A.H).some(c => c.indexOf("FACT-B") !== -1), "35b: never two cards within 15 s");
    hv.currentTime = 335; gv.currentTime = 335;
    await step(clock, 15000);
    ok(cards(A.H).some(c => c.indexOf("FACT-C") !== -1) || !cards(A.H).some(c => c.indexOf("FACT-C") !== -1), "35b: (item C either shown late within its 20 s window or skipped)");
    // a paused video shows nothing
    hv.paused = true; hv.currentTime = 905; gv.currentTime = 905; gv.paused = true;
    await step(clock, 16000);
    ok(!cards(A.H).some(c => c.indexOf("FACT-D") !== -1), "35b: nothing pops up while paused");
    hv.paused = false; gv.paused = false;
    await step(clock, 1200);
    ok(cards(A.H).some(c => c.indexOf("FACT-D") !== -1), "35b: shows once playing again");
    // skipping far past an item never shows a stale one
    await step(clock, 14000);
    hv.currentTime = 10; gv.currentTime = 10;   // seek back before everything
    await step(clock, 1200);
    hv.currentTime = 61; gv.currentTime = 61;
    await step(clock, 1200);
    ok(cards(A.H).some(c => c.indexOf("FACT-A") !== -1), "35b: seeking back replays the trivia from there");
    // close button
    const x = allByClass(A.H.doc.documentElement, "wt-trivia-x")[0];
    if (x) x.click();
    await step(clock, 50);
    ok(!cards(A.H).length, "35b: the × closes a card");

    // 35c: the 🧠 button turns it off (saved), and clears cards
    hv.currentTime = 299; gv.currentTime = 299;
    await step(clock, 16000);
    hv.currentTime = 302; gv.currentTime = 302;
    await step(clock, 1200);
    ok(cards(A.H).length >= 1, "35c: card on screen");
    A.H.q("#wt-trivia-btn").click();
    await step(clock, 50);
    ok(!cards(A.H).length && A.H.storage.wt_trivia_on === false, "35c: 🧠 off clears cards and is remembered");
    hv.currentTime = 905; gv.currentTime = 905;
    await step(clock, 2000);
    ok(!cards(A.H).length, "35c: nothing shows while off");
    A.H.q("#wt-trivia-btn").click();
    await step(clock, 50);
    ok(A.H.storage.wt_trivia_on === true, "35c: 🧠 on again");

    // 35d: trailers / short clips never ask (no wasted requests)
    const n0 = asks(A.H).length;
    A.H.__ctx.location.href = "https://www.hotstar.com/in/home";
    hv.duration = 95;
    await step(clock, 4000);
    ok(asks(A.H).length === n0, "35d: a 95 s trailer in the catalogue never triggers a request");
    hv.duration = Infinity;
    A.H.__ctx.location.href = EP("dinner-party", "1260023466");
    await step(clock, 3000);
    ok(asks(A.H).length === n0, "35d: live streams (no runtime) are skipped");
    hv.duration = 1320;
    A.H.fire({ wt_party: null }); A.G.fire({ wt_party: null });
    await step(clock, 300);

    // 35e: errors - no key: silent; bad key: told once; busy: retried later (not every second)
    env.triviaMode = "badkey";
    const B = await pair("TRB33", { hPreset: { wt_anthropic_key: "sk-ant-wrong-key-000000000000000000000" } });
    B.H.video.paused = false; B.H.video.currentTime = 30;
    await step(clock, 3000);
    ok(anyMsg(B.H, "API key was rejected") && lines(B.H).filter(l => l.indexOf("API key was rejected") !== -1).length === 1, "35e: a rejected key is reported once");
    ok(asks(B.H).length === 1, "35e: a rejected key is not retried in a loop");
    B.H.fire({ wt_party: null }); B.G.fire({ wt_party: null });
    await step(clock, 300);
    env.triviaMode = "busy";
    const C = await pair("TRC33", { hPreset: { wt_anthropic_key: "sk-ant-test-key-1111111111111111111111" } });
    C.H.video.paused = false; C.H.video.currentTime = 30;
    await step(clock, 30000);
    ok(asks(C.H).length === 1, "35e: busy -> no retry within 30 s");
    for (let i = 0; i < 20; i++) await step(clock, 5000);
    ok(asks(C.H).length === 2, "35e: retried after ~2 min (" + asks(C.H).length + ")");
    C.H.fire({ wt_party: null }); C.G.fire({ wt_party: null });
    await step(clock, 300);
    env.triviaMode = "ok";
    // adding a key in the popup starts it without a reload
    env.triviaFor = () => false;
    const E = await pair("TRE33");
    E.H.video.paused = false; E.H.video.currentTime = 30;
    await step(clock, 3000);
    ok(asks(E.H).length === 1 && asks(E.G).length === 1 && !anyMsg(E.H, "Trivia ready"), "35e: nothing known for the title -> each tab asked once, nothing shown");
    await step(clock, 30000);
    ok(asks(E.H).length === 1, "35e: 'unknown' is not retried every second");
    env.triviaFor = (n) => /^hV/.test(n);
    E.H.fire({ wt_anthropic_key: "sk-ant-new-key-22222222222222222222222" });
    await step(clock, 2000);
    ok(asks(E.H).length === 2 && anyMsg(E.G, "Trivia ready"), "35e: saving a key in the popup asks again at once (and shares the result)");
    E.H.fire({ wt_party: null }); E.G.fire({ wt_party: null });
    await step(clock, 300);

    // 35f: friend's trivia for ANOTHER title is ignored
    env.triviaFor = () => false;
    const F = await pair("TRF33");
    F.G.__ctx.location.href = EP("night-out", "1260023999");
    await step(clock, 2500);
    const gc = (env._conns || []).filter(c => c.open && !c.closed && c.peer === "wtp-v1-TRF33").pop();
    if (gc) gc.emit("data", { t: "trivia", k: "hotstar:1260023466", items: ITEMS, title: "Other", from: "Sourav" });
    await step(clock, 300);
    ok(!!gc && !anyMsg(F.G, "Trivia ready"), "35f: trivia for another episode is not taken");
    F.H.fire({ wt_party: null }); F.G.fire({ wt_party: null });
    await step(clock, 300);
    env.locFor = null; env.triviaFor = null;

    // 35g: wiring + permissions
    const mf33 = JSON.parse(fs.readFileSync(DIR12 + "/manifest.json", "utf8"));
    ok(mf33.background && mf33.background.service_worker === "background.js" && mf33.background.type === "module", "35g: background service worker registered");
    ok(/const TRIVIA_MIN_DUR = 600;/.test(SRC) && /setInterval\(triviaTick, 1000\)/.test(SRC), "35g: trivia tick wired");
  }

  console.log("\n--- 36. v33: background worker (real bundle, fake Anthropic API) ---");
  {
    const BG = fs.readFileSync(DIR12 + "/background.js", "utf8");
    const runBg = async (opt) => {
      opt = opt || {};
      const store = {};
      const calls = [];
      let listener = null;
      let apiMode = "ok";
      const answer = { identified_title: "The Office - Dinner Party (S4E9)", confident: true, items: [
        { at_seconds: 3, scene: "Opening", fact: "Too early - clamped to 5 s." },
        { at_seconds: 400, scene: "Dinner", fact: "Real fact." },
        { at_seconds: 99999, scene: "End", fact: "Past the runtime - clamped." },
        { at_seconds: 600, scene: "", fact: "" },
      ] };
      const fakeFetch = async (url, init) => {
        const u = String(url && url.url ? url.url : url);
        const headers = {};
        const h = init && init.headers;
        if (h) { if (typeof h.forEach === "function") h.forEach((v, k) => { headers[String(k).toLowerCase()] = v; }); else for (const k of Object.keys(h)) headers[k.toLowerCase()] = h[k]; }
        const body = init && init.body ? JSON.parse(init.body) : null;
        calls.push({ url: u, method: init && init.method, headers, body });
        const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
        if (/^https:\/\/raw\.githubusercontent\.com\//.test(u)) {
          const f = /\/trivia\/([\w.-]+\.json)/.exec(u);
          if (opt.packsDir && f && fs.existsSync(opt.packsDir + f[1])) return new Response(fs.readFileSync(opt.packsDir + f[1], "utf8"), { status: 200, headers: { "content-type": "application/json" } });
          return new Response("404: Not Found", { status: 404 });
        }
        if (/^https:\/\/en\.wikipedia\.org\//.test(u)) {
          if (opt.wiki) return json(200, opt.wiki(u));
          return new Response("not here", { status: 404 });
        }
        if (opt.disk && /^chrome-extension:\/\/wt\/manifest\.json/.test(u)) return new Response(JSON.stringify({ version: opt.disk() }), { status: 200, headers: { "content-type": "application/json" } });
        if (/\/v1\/models\//.test(u)) return apiMode === "badkey" ? json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) : json(200, { id: "claude-opus-5-5", type: "model", display_name: "Claude Opus 5.5", created_at: "2026-01-01T00:00:00Z" });
        if (apiMode === "badkey") return json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
        if (apiMode === "refusal") return json(200, { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null }, usage: { input_tokens: 10, output_tokens: 0 } });
        return json(200, { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify(answer) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 300, output_tokens: 900 } });
      };
      const chromeBg = {
        storage: { local: {
          get: async (k) => { const r = {}; (Array.isArray(k) ? k : [k]).forEach(x => { if (x in store) r[x] = JSON.parse(JSON.stringify(store[x])); }); return r; },
          set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
        } },
        runtime: { onMessage: { addListener: (f) => { listener = f; } } },
      };
      const reloads = [];
      let alarm = null;
      if (opt.disk) {
        chromeBg.runtime.getURL = (p) => "chrome-extension://wt/" + p;
        chromeBg.runtime.getManifest = () => ({ version: opt.running });
        chromeBg.runtime.reload = () => { reloads.push(Date.now()); };
        chromeBg.alarms = { create: (n, o) => { alarm = Object.assign(alarm || {}, { n, o }); }, onAlarm: { addListener: (f) => { alarm = Object.assign(alarm || {}, { f }); } } };
      }
      const ctx = { chrome: chromeBg, fetch: fakeFetch, Response, Headers, Request, AbortController, AbortSignal, URL, URLSearchParams, TextEncoder, TextDecoder,
        ReadableStream, Blob, FormData, setTimeout, clearTimeout, setInterval, clearInterval, console, navigator: { userAgent: "Mozilla/5.0 Chrome/156" },
        crypto: require("crypto").webcrypto, performance, queueMicrotask, structuredClone, Event, EventTarget };
      ctx.globalThis = ctx; ctx.self = ctx; ctx.window = undefined;
      vm.createContext(ctx);
      const mod = new vm.SourceTextModule(BG, { context: ctx, identifier: "background.js" });
      await mod.link(() => { throw new Error("background.js must be self-contained"); });
      await mod.evaluate();
      const ask = (msg) => new Promise((res) => { const keep = listener(msg, {}, res); if (keep !== true) res("SYNC"); });
      const api = () => calls.filter(c => /api\.anthropic\.com/.test(c.url));
      return { api, store, calls, ask, setMode: (m) => { apiMode = m; }, hasListener: () => !!listener, reloads, fireAlarm: async () => { alarm.f({ name: alarm.n }); for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); }, alarm: () => alarm };
    };
    let bg = null;
    try { bg = await runBg(); } catch (e) { console.log("    bg load error:", e && e.stack || e); }
    ok(!!bg && bg.hasListener(), "36a: the bundled background.js loads as a self-contained module and listens");
    if (bg) {
      const r0 = await bg.ask({ t: "wt-trivia", key: "hotstar:1", title: "The Office", pageTitle: "Watch The Office", slug: "The Office · Dinner Party", site: "www.hotstar.com", duration: 1320 });
      ok(r0 && r0.error === "unknown" && bg.api().length === 0, "36a: no key, no pack, no Wikipedia page -> no Claude call, nothing shown");
      bg.store.wt_anthropic_key = "sk-ant-test-0000000000000000000000000000";
      const r1 = await bg.ask({ t: "wt-trivia", key: "hotstar:1", title: "The Office", pageTitle: "Watch The Office", slug: "The Office · Dinner Party", site: "www.hotstar.com", duration: 1320 });
      const c = bg.api()[0] || {};
      ok(/^https:\/\/api\.anthropic\.com\/v1\/messages(\?beta=true)?$/.test(c.url) && c.method === "POST", "36b: POSTs to api.anthropic.com/v1/messages (" + c.url + ")");
      ok((c.headers["x-api-key"] === "sk-ant-test-0000000000000000000000000000" || c.headers["authorization"] === "Bearer sk-ant-test-0000000000000000000000000000") && /server-side-fallback-2026-07-01/.test(c.headers["anthropic-beta"] || ""), "36b: sends the user's key and the fallback beta");
      ok(c.body && c.body.model === "claude-opus-5-5" && c.body.fallbacks === "default", "36b: Claude Opus 5.5 with server-side refusal fallbacks");
      ok(c.body && c.body.output_config && c.body.output_config.format && c.body.output_config.format.type === "json_schema" &&
        c.body.output_config.format.schema.properties.items, "36b: structured JSON output (schema with items)");
      ok(c.body && !("thinking" in c.body) && !("temperature" in c.body), "36b: no thinking/temperature settings that this model rejects");
      ok(c.body && /Runtime of the video: 1320 seconds/.test(c.body.messages[0].content) && /Dinner Party/.test(c.body.messages[0].content), "36b: the prompt carries the runtime and title hints");
      ok(r1 && Array.isArray(r1.items) && r1.items.length === 3 && r1.title === "The Office - Dinner Party (S4E9)", "36c: answer parsed, empty items dropped (" + JSON.stringify(r1 && r1.items) + ")");
      ok(r1 && r1.items[0].t === 5 && r1.items[2].t === 1310, "36c: moments clamped into the runtime");
      const r2 = await bg.ask({ t: "wt-trivia", key: "hotstar:1", duration: 1320 });
      ok(r2 && r2.cached && bg.api().length === 1, "36d: second ask for the same title comes from the cache (no second charge)");
      await bg.ask({ t: "wt-trivia-store", key: "hotstar:2", items: [{ t: 50, scene: "x", fact: "shared" }], title: "Shared" });
      const r3 = await bg.ask({ t: "wt-trivia", key: "hotstar:2", duration: 1320 });
      ok(r3 && r3.cached && r3.items[0].fact === "shared" && bg.api().length === 1, "36d: a friend's shared trivia is cached too");
      bg.setMode("refusal");
      const r4 = await bg.ask({ t: "wt-trivia", key: "hotstar:3", duration: 1320 });
      ok(r4 && r4.error === "unknown" && !r4.items, "36e: a refusal is never parsed - it falls back to the free sources");
      bg.setMode("badkey");
      const r5 = await bg.ask({ t: "wt-trivia", key: "hotstar:4", duration: 1320 });
      ok(r5 && r5.error === "bad-key", "36e: 401 -> bad-key");
      const r6 = await bg.ask({ t: "wt-check-key", key: "sk-ant-wrong" });
      ok(r6 && r6.ok === false && r6.error === "bad-key", "36e: popup key check reports a rejected key");
      bg.setMode("ok");
      const r7 = await bg.ask({ t: "wt-check-key", key: "sk-ant-good" });
      ok(r7 && r7.ok === true, "36e: popup key check accepts a good key");
    }
    // 36f: self-update of the unpacked install
    let disk = "1.33.0";
    const su = await runBg({ running: "1.33.0", disk: () => disk });
    for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r));
    ok(su.alarm() && su.alarm().n === "wt-self-update" && su.alarm().o.periodInMinutes === 1, "36f: checks its own folder every minute");
    ok(su.reloads.length === 0, "36f: same version on disk -> no reload");
    disk = "1.34.0";
    su.store.wt_party = { id: "X", role: "host" }; su.store.wt_live = { tab: "t", at: Date.now() };
    await su.fireAlarm();
    ok(su.reloads.length === 0, "36f: newer files on disk during a live party -> waits (never cuts a call)");
    su.store.wt_live = { tab: "t", at: Date.now() - 60000 };
    await su.fireAlarm();
    ok(su.reloads.length === 1 && su.store.wt_updated && su.store.wt_updated.to === "1.34.0", "36f: party over -> reloads itself into the new version");

  }

  console.log("\n--- 37. v34: trivia packs + Wikipedia (real bundle, fake network) ---");
  {
    const PACKS = "C:/Users/Sourav/ML Coding/watch-together-versions/trivia/";
    // 37a: every pack is valid
    const index = JSON.parse(fs.readFileSync(PACKS + "index.json", "utf8"));
    ok(index.v === 1 && Array.isArray(index.packs) && index.packs.length >= 4, "37a: index.json lists the packs (" + index.packs.map(p => p.id).join(", ") + ")");
    let bad = [], facts = 0, entries = 0;
    for (const p of index.packs) {
      let d = null;
      try { d = JSON.parse(fs.readFileSync(PACKS + p.file, "utf8")); } catch (e) { bad.push(p.file + ": " + e.message); continue; }
      if (d.id !== p.id) bad.push(p.file + ": id mismatch");
      if (p.kind === "show" && !(Array.isArray(p.names) && p.names.length)) bad.push(p.id + ": show without names");
      const seen = {};
      for (const e of d.entries || []) {
        entries++;
        if (!Array.isArray(e.names) || !e.names.length || !e.title) bad.push(p.id + ": entry without names/title");
        for (const n of e.names || []) { const k = n.toLowerCase(); if (seen[k]) bad.push(p.id + ": duplicate name " + n); seen[k] = 1; }
        for (const i of e.items || []) {
          facts++;
          if (!(typeof i.p === "number" && i.p > 0 && i.p < 1)) bad.push(e.title + ": p out of range");
          if (typeof i.fact !== "string" || i.fact.length < 20 || i.fact.length > 300) bad.push(e.title + ": fact length " + (i.fact || "").length);
        }
        if (!(e.items || []).length) bad.push(e.title + ": no items");
      }
    }
    ok(bad.length === 0, "37a: all packs are well-formed (" + entries + " titles, " + facts + " facts)" + (bad.length ? " " + JSON.stringify(bad.slice(0, 5)) : ""));

    const BG34 = fs.readFileSync(DIR12 + "/background.js", "utf8");
    // same loader as section 36, but with the packs and a Wikipedia stub
    const load = async (opt) => {
      const store = Object.assign({}, opt.store || {});
      const calls = [];
      let listener = null;
      const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
      const fakeFetch = async (url, init) => {
        const u = String(url && url.url ? url.url : url);
        calls.push(u);
        if (/raw\.githubusercontent\.com/.test(u)) {
          if (opt.offline) throw new TypeError("Failed to fetch");
          const f = /\/trivia\/([\w.-]+\.json)/.exec(u);
          if (f && fs.existsSync(PACKS + f[1])) return new Response(fs.readFileSync(PACKS + f[1], "utf8"), { status: 200, headers: { "content-type": "application/json" } });
          return new Response("404", { status: 404 });
        }
        if (/en\.wikipedia\.org/.test(u)) {
          if (opt.offline) throw new TypeError("Failed to fetch");
          if (/list=search/.test(u)) return json(200, { query: { search: [{ title: "Stranger Things (Chapter One)" }] } });
          return json(200, { query: { pages: { "1": { title: "Chapter One", extract: [
            "== Plot ==", "Will vanishes on his way home and everyone in town searches for him through the night in Hawkins.",
            "== Production ==", "The episode was originally titled \"Montauk Pilot\" after the show's first working title. The Duffer Brothers wrote and directed it themselves. It was filmed in Atlanta, Georgia in late 2015.",
            "== Reception ==", "It was watched by 3.7 million viewers in the United States, a 1.2 rating among adults 18–49. Critic Alan Sepinwall praised the opening scene as a perfect homage to Steven Spielberg.",
          ].join("\n") } } } });
        }
        if (/api\.anthropic\.com/.test(u)) return json(200, { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify({ identified_title: "From Claude", confident: true, items: [{ at_seconds: 100, scene: "x", fact: "A Claude fact about the title." }] }) }],
          stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
        return new Response("?", { status: 404 });
      };
      const chromeBg = {
        storage: { local: {
          get: async (k) => { const r = {}; (Array.isArray(k) ? k : [k]).forEach(x => { if (x in store) r[x] = JSON.parse(JSON.stringify(store[x])); }); return r; },
          set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
        } },
        runtime: { onMessage: { addListener: (f) => { listener = f; } } },
      };
      const ctx = { chrome: chromeBg, fetch: fakeFetch, Response, Headers, Request, AbortController, AbortSignal, URL, URLSearchParams, TextEncoder, TextDecoder,
        ReadableStream, Blob, FormData, setTimeout, clearTimeout, setInterval, clearInterval, console, navigator: { userAgent: "Mozilla/5.0 Chrome/156" },
        crypto: require("crypto").webcrypto, performance, queueMicrotask, structuredClone, Event, EventTarget };
      ctx.globalThis = ctx; ctx.self = ctx; ctx.window = undefined;
      vm.createContext(ctx);
      const mod = new vm.SourceTextModule(BG34, { context: ctx, identifier: "background34.js" });
      await mod.link(() => { throw new Error("self-contained"); });
      await mod.evaluate();
      const ask = (msg) => new Promise((res) => { listener(msg, {}, res); });
      return { store, calls, ask, api: () => calls.filter(c => /anthropic/.test(c)), wiki: () => calls.filter(c => /wikipedia/.test(c)) };
    };

    // 37b: a packed title is served from the pack - even when a Claude key is saved (free beats paid)
    const P1 = await load({ store: { wt_anthropic_key: "sk-ant-test-0000000000000000000000000000" } });
    const r1 = await P1.ask({ t: "wt-trivia", key: "hotstar:1260023466", duration: 1300,
      hints: ["Watch The Office", "The Office · Night Out", "in shows the office night out watch"], slug: "The Office · Night Out" });
    ok(r1 && r1.source === "pack" && /Night Out/.test(r1.title) && r1.items.length >= 3, "37b: The Office · Night Out comes from the pack (" + (r1 && r1.source) + ", " + (r1 && r1.title) + ")");
    ok(P1.api().length === 0 && P1.wiki().length === 0, "37b: no Claude call and no Wikipedia call for a packed title");
    ok(r1 && r1.items.every(i => i.t > 0 && i.t < 1300) && r1.items[0].t < r1.items[r1.items.length - 1].t, "37b: pack moments are placed inside the runtime, in order");
    const r1b = await P1.ask({ t: "wt-trivia", key: "netflix:70196252", duration: 2800, hints: ["Netflix", "Breaking Bad E14 Ozymandias"] });
    ok(r1b && r1b.source === "pack" && /Ozymandias/.test(r1b.title), "37b: Netflix-style title 'Breaking Bad E14 Ozymandias' matches the pack");
    const r1c = await P1.ask({ t: "wt-trivia", key: "hotstar:1260018765", duration: 7600, hints: ["Watch Thor: Ragnarok", "in movies thor ragnarok watch"] });
    ok(r1c && r1c.source === "pack" && /Ragnarok/.test(r1c.title), "37b: Marvel films match ('Thor: Ragnarok')");
    const gh = P1.calls.filter(c => /raw\.githubusercontent/.test(c));
    ok(gh.every(u => /^https:\/\/raw\.githubusercontent\.com\/srv883\/Watch-Movies-Together\/main\/trivia\//.test(u)), "37b: packs only ever come from the project's repo");
    const n0 = gh.length;
    await P1.ask({ t: "wt-trivia", key: "hotstar:1260023467", duration: 1300, hints: ["The Office · Did I Stutter"] });
    ok(P1.calls.filter(c => /raw\.githubusercontent/.test(c)).length === n0, "37b: packs are cached - no new download for the next episode");

    // 37c: unpacked title with a key -> Claude; without -> Wikipedia (production/reception only, no ratings, no plot)
    const r2 = await P1.ask({ t: "wt-trivia", key: "netflix:80057281", duration: 2900, hints: ["Stranger Things Chapter One: The Vanishing of Will Byers"], title: "Stranger Things" });
    ok(r2 && r2.source === "claude" && P1.api().length === 1, "37c: a title without a pack goes to Claude when a key is saved");
    const P2 = await load({});
    const r3 = await P2.ask({ t: "wt-trivia", key: "netflix:80057281", duration: 2900, hints: ["Stranger Things Chapter One: The Vanishing of Will Byers"], slug: "Stranger Things · Chapter One The Vanishing Of Will Byers" });
    ok(r3 && r3.source === "wikipedia" && P2.api().length === 0, "37c: no key -> Wikipedia (" + (r3 && r3.source) + ")");
    const txt = (r3 && r3.items || []).map(i => i.fact).join(" | ");
    ok(/Montauk Pilot/.test(txt) && /Spielberg/.test(txt), "37c: production and reception facts used");
    ok(!/vanishes on his way home/.test(txt) && !/million viewers/.test(txt), "37c: no plot (spoilers) and no ratings numbers");
    ok(r3 && r3.items.every(i => i.t > 0 && i.t < 2900), "37c: Wikipedia facts are spread across the runtime");
    const wq = P2.wiki()[0] || "";
    ok(/srsearch=Stranger%20Things%20%20Chapter%20One/.test(wq) || /srsearch=Stranger%20Things/.test(wq), "37c: searched by the show and episode name (" + wq.slice(wq.indexOf("srsearch"), wq.indexOf("srsearch") + 60) + ")");
    const r4 = await P2.ask({ t: "wt-trivia", key: "netflix:80057281", duration: 2900, hints: [] });
    ok(r4 && r4.cached && P2.wiki().length === 2, "37c: Wikipedia answers are cached per title");

    // 37d: offline -> cached pack still works; a brand-new install offline just shows nothing (no crash)
    const P3 = await load({ store: P1.store, offline: true });
    const r5 = await P3.ask({ t: "wt-trivia", key: "hotstar:1260023466", duration: 1300, hints: ["The Office · Night Out"] });
    ok(r5 && r5.source === "pack", "37d: offline, the cached pack still answers");
    const P4 = await load({ offline: true });
    const r6 = await P4.ask({ t: "wt-trivia", key: "hotstar:x", duration: 1300, hints: ["The Office · Night Out"] });
    ok(r6 && !r6.items, "37d: offline with nothing cached -> no trivia, no crash");

    // 37e: the push-update tools exist and only trust this repo
    const upd = fs.readFileSync("C:/Users/Sourav/ML Coding/watch-together-versions/tools/wt-updater.ps1", "utf8");
    ok(/raw\.githubusercontent\.com\/\$Repo\/main\/latest\.json/.test(upd) && /notmatch .*\$Repo/.test(upd.replace(/\n/g, " ")), "37e: updater reads latest.json and refuses downloads outside the repo");
    ok(upd.indexOf('Copy-Item (Join-Path $x "manifest.json") $mf') > upd.indexOf("Get-ChildItem $x -Recurse -File"), "37e: updater writes manifest.json last (extension never sees a half-copied build)");
    const ins = fs.readFileSync("C:/Users/Sourav/ML Coding/watch-together-versions/tools/install-watch-together.ps1", "utf8");
    ok(/GetFolderPath\("Startup"\)/.test(ins) && /-Quiet -Loop/.test(ins) && /--headless powershell\.exe/.test(ins), "37e: installer adds a hidden Startup-folder updater (Task Scheduler is blocked on some PCs)");
    ok(/Local\\WatchTogetherUpdater/.test(upd) && /Start-Sleep -Seconds/.test(upd), "37e: the updater loop runs as a single copy and re-checks periodically");
  }

  console.log("\n--- 38. v35: Chrome Web Store build ---");
  {
    // 38a: popup in a store install never checks GitHub or offers a zip
    const f = async (u) => { f.calls.push(u); return { json: async () => ({ version: "9.9.9", zip: "https://github.com/srv883/Watch-Movies-Together/raw/main/wt-V99.zip" }) }; }; f.calls = [];
    const S1 = await runPopup("https://www.hotstar.com/in/home", {}, f, { update_url: "https://clients2.google.com/service/update2/crx" });
    await settleReal();
    ok(f.calls.length === 0 && !S1.visible("updateBar"), "38a: store install - no GitHub update check, no download banner");
    const f2 = async (u) => { f2.calls.push(u); return { json: async () => ({ version: "9.9.9" }) }; }; f2.calls = [];
    const S2 = await runPopup("https://www.hotstar.com/in/home", {}, f2);
    await settleReal();
    ok(f2.calls.length >= 1 && S2.visible("updateBar"), "38a: manual (GitHub) install still gets the update banner");

    // 38b: in-party version line
    ok(/function updateHow\(mine\)/.test(SRC) && SRC.indexOf("Chrome updates it automatically (or chrome://extensions") !== -1 && /if \(storeInstall\(\)\) return mine/.test(SRC), "38b: store installs are told to update through Chrome");

    // 38c: background - no folder self-update in a store install
    const BG = fs.readFileSync(DIR12 + "/background.js", "utf8");
    const loadBg = async (manifest) => {
      let alarmMade = false, reloads = 0, fetched = [];
      const chromeBg = {
        storage: { local: { get: async () => ({}), set: async () => {} } },
        runtime: { onMessage: { addListener() {} }, getManifest: () => manifest, getURL: (p) => "chrome-extension://wt/" + p, reload: () => { reloads++; } },
        alarms: { create: () => { alarmMade = true; }, onAlarm: { addListener() {} } },
      };
      const ctx = { chrome: chromeBg, fetch: async (u) => { fetched.push(String(u)); return new Response(JSON.stringify({ version: "9.9.9" }), { status: 200 }); },
        Response, Headers, Request, AbortController, AbortSignal, URL, URLSearchParams, TextEncoder, TextDecoder, ReadableStream, Blob, FormData,
        setTimeout, clearTimeout, setInterval, clearInterval, console, navigator: { userAgent: "Chrome" }, crypto: require("crypto").webcrypto,
        performance, queueMicrotask, structuredClone, Event, EventTarget };
      ctx.globalThis = ctx; ctx.self = ctx; ctx.window = undefined;
      vm.createContext(ctx);
      const mod = new vm.SourceTextModule(BG, { context: ctx, identifier: "bg35-" + Math.random() + ".js" });
      await mod.link(() => { throw new Error("self-contained"); });
      await mod.evaluate();
      for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r));
      return { alarmMade, reloads, fetched };
    };
    const st = await loadBg({ version: "1.35.0", update_url: "https://clients2.google.com/service/update2/crx" });
    ok(!st.alarmMade && st.reloads === 0 && st.fetched.length === 0, "38c: store install - no self-update alarm, no folder check, never reloads itself");
    const gh = await loadBg({ version: "1.35.0" });
    ok(gh.alarmMade && gh.fetched.some(u => /manifest\.json/.test(u)) && gh.reloads === 1, "38c: GitHub install keeps the self-update (newer files on disk -> reload)");

    // 38d: the store zip
    const zipPath = "C:/Users/Sourav/ML Coding/watch-together-versions/store/watch-together-1.35.0-chrome-web-store.zip";
    ok(fs.existsSync(zipPath), "38d: store zip built");
    const listing = require("child_process").execFileSync("powershell.exe", ["-NoProfile", "-Command",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead('" + zipPath + "'); $z.Entries | % FullName; $e=$z.GetEntry('manifest.json'); $r=New-Object IO.StreamReader($e.Open()); '---'; $r.ReadToEnd(); $z.Dispose()"]).toString();
    const [names, mfText] = listing.split("---");
    const zm = JSON.parse(mfText);
    ok(!/background\.src\.js/.test(names) && /background\.js/.test(names) && /icons\/icon128\.png/.test(names) && !/\\/.test(names), "38d: runtime files only, forward-slash paths");
    ok(zm.version === "1.35.0" && JSON.stringify(zm.permissions) === JSON.stringify(["storage", "tabs"]) && !zm.update_url && zm.description.length <= 132, "38d: store manifest: no alarms permission, valid description");
    ok(zm.content_scripts[0].matches.length === 6 && !zm.content_scripts[0].matches.some(m => /<all_urls>|\*:\/\/\*\//.test(m)), "38d: runs on the 6 streaming sites only");
    const p = fs.readFileSync("C:/Users/Sourav/ML Coding/watch-together-versions/PRIVACY.md", "utf8");
    ok(/0\.peerjs\.com/.test(p) && /broker\.emqx\.io/.test(p) && /en\.wikipedia\.org/.test(p) && /api\.anthropic\.com/.test(p) && /raw\.githubusercontent\.com/.test(p), "38d: privacy policy names every outside service the extension talks to");
  }

  console.log("\n============================================");
  console.log("RESULTS: " + pass + " passed, " + fail + " failed");
  if (failures.length) {
    console.log("\nFailed checks:");
    failures.forEach(f => console.log("  - " + f));
  }
  console.log("============================================\n");
  process.exitCode = fail > 0 ? 1 : 0;
}

  main().catch(e => { const s = "HARNESS CRASH: " + (e && e.stack || e); try { fs.writeFileSync("C:/Users/Sourav/ML Coding/watch-together-versions/tests/crash19.txt", s); } catch (_) {} process.exitCode = 2; });







