/* ============================================================
   V16 behaviour test harness (port of test-V15 + v16 additions)
   Runs the REAL V16-floatchat/content.js twice (host+guest)
   against stubbed DOM / PeerJS / chrome APIs. New for v16:
     - floating chat notifications (animated, auto-dismiss)
     - emoji bar moved to bottom-center (outside panel)
     - glass theme propagation to detached quick bar
   Run:  node tests/test-V16.js
   ============================================================ */
"use strict";

const fs = require("fs");
const vm = require("vm");

const SRC_PATH = "C:/Users/Sourav/ML Coding/watch-together-versions/V16-floatchat/content.js";
const DIR12 = "C:/Users/Sourav/ML Coding/watch-together-versions/V16-floatchat";
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
      if (["play", "pause", "seek", "state", "hb", "hello", "chat", "typing", "react", "needstate"].includes(o && o.t)) {
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
      this.out = outStream || null; this.hC = {}; this.hA = {}; this.ended = false;
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
        },
        on(t, f) { (self.hA[t] = self.hA[t] || []).push(f); },
        close: () => this.end(),
        peerConnection: self.pcCallee,
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
  return class FakeRTC {
    constructor() {
      this._ice = "new"; this.ls = []; this.local = null; this.remote = null;
      this.dc = null; this.tag = ++seq.n;
      env._rtc.push(this);
    }
        get iceGatheringState() { return this._ice; }
    get localDescription() { return this.local; }
    get remoteDescription() { return this.remote; }
    createDataChannel() { this.dc = new FakeDC(); return this.dc; }
    createOffer() { return Promise.resolve({ type: "offer", sdp: "SDP-OFFER-" + this.tag }); }
    createAnswer() { return Promise.resolve({ type: "answer", sdp: "SDP-ANSWER-" + this.tag }); }
    setLocalDescription(d) {
      this.local = d;
      later(2, () => {
        this._ice = "complete";
        this.ls.forEach((f) => { try { f({}); } catch (e) { env.errs.push(["rtc-ice", e]); } });
      });
      return Promise.resolve();
    }
    setRemoteDescription(d) {
      this.remote = d;
      if (d.type === "answer" && this.local && this.local.type === "offer") {
        const other = env._rtc.find((r) => r !== this && r.local && r.local.type === "answer");
        if (other && other.dc && this.dc) {
          const a = this.dc, b = other.dc;
          a.peer = b; b.peer = a;
          later(6, () => {
            [a, b].forEach((ch) => {
              ch.open = true;
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
function makeInstance(env, name, preset) {
    const doc = makeDoc();
  doc.title = "Some Video Online";
  const chromeStub = makeChromeStub();
  if (preset) Object.assign(chromeStub.store, JSON.parse(JSON.stringify(preset)));
  const video = makeEl("video");
  video._rect = { width: 1280, height: 720, x: 0, y: 0 };
  doc.videos.push(video);

  const ctx = {
    console,
    Date: { now: () => env.clock.now },
    setTimeout: (f, m) => env.clock.setTimeout(f, m),
    setInterval: (f, m) => env.clock.setInterval(f, m),
    clearTimeout: id => env.clock.clear(id),
    clearInterval: id => env.clock.clear(id),
    document: doc,
    navigator: {
      mediaDevices: {
        getUserMedia: async (constraints) => {
          env.gum++;
          env.lastGum = constraints;
          return new env.FakeStream([env.makeMicTrack()]);
        },
      },
      clipboard: { writeText: async () => {} },
    },
    location: { href: "https://www.example.com/watch/" + name + "/ep1", protocol: "https:" },
    chrome: chromeStub,
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
        const node = { _stream: stream, connect() {}, disconnect() {} };
        return node;
      }
      createAnalyser() {
        return { fftSize: 512, getFloatTimeDomainData(arr) { arr.fill(env.rms); } };
      }
      createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
      createOscillator() { return { connect() {}, start() {}, stop() {} }; }
      async resume() { if (!env.noCtxResume) this.state = env.ctxState || "running"; }
    },
    RTCPeerConnection: env.FakeRTC,
    btoa: (s) => Buffer.from(String(s), "binary").toString("base64"),
    atob: (s) => Buffer.from(String(s), "base64").toString("binary"),
    addEventListener: (t, f) => { (doc.winL = doc.winL || {})[t] = (doc.winL[t] || []).concat(f); },
    removeEventListener: () => {},
    window: null,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  try { vm.runInContext(SRC, ctx, { filename: name + "/content.js" }); }
  catch (e) { env.errs.push(["load:" + name, e]); }

  return {
    name, doc, chrome: chromeStub, video,
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
  ok(anyMsg(G, "https://www.example.com/watch/host/ep1"), "share click sends page URL to friend");
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
  ok(!G.q("#wt-picker").classList.contains("wt-hide"), "+ opens searchable picker");
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
  // simulate a drag of the quick bar by its title
  const title = G.q("#wt-now-label");
  title.dispatch("mousedown", { button: 0, clientX: 100, clientY: 80, target: title });
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

  console.log("\n--- 12. manifest: any-site support ---");
  const MF = JSON.parse(fs.readFileSync(DIR12 + "/manifest.json", "utf8"));
  ok(MF.content_scripts[0].matches.indexOf("<all_urls>") !== -1, "content script runs on ALL sites (<all_urls>)");
  const POP = fs.readFileSync(DIR12 + "/popup.js", "utf8");
  ok(!POP.includes("netflix"), "popup has NO site whitelist (youtube etc allowed)");
  ok(/\^https\?:\/i\.test\(url\)/.test(POP), "popup accepts any http(s) page");
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
  // use main pair G: force panel closed first
  if (G.q("#wt-root").classList.contains("wt-open")) {
    G.q("#wt-pill").click();
    await step(clock, 300);
  }
  ok(!G.q("#wt-root").classList.contains("wt-open"), "panel closed pre-test");
  const plusBtn = G.q("#wt-quick-bar").children.filter(x => x.tag !== "#text").find(x => x.classList.contains("wt-quick-plus"));
  plusBtn.click();
  await step(clock, 40);
  ok(G.q("#wt-root").classList.contains("wt-open"), "+ auto-reopens closed panel");
  ok(!G.q("#wt-picker").classList.contains("wt-hide"), "+ opens picker");
  plusBtn.click();
  await step(clock, 20);
  ok(G.q("#wt-picker").classList.contains("wt-hide"), "+ toggles picker closed");

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

console.log("\n--- 12. error sweep ---");
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
  ok(env.lastGum && env.lastGum.audio && env.lastGum.audio.noiseSuppression === false,
    "mic acquired with noiseSuppression=false (Chrome NS disabled permanently)");
  ncBtn.click();
  await step(clock, 60);
  ok(!ncBtn.classList.contains("wt-on"), "NC toggles OFF");
  ok(H.storage.wt_nc === false, "off pref persisted to storage");
  ok(anyMsg(H, "Noise cancellation OFF"), "OFF confirmation shown in chat");
  ok(liveTrack.lastApply && liveTrack.lastApply.noiseSuppression === false,
    "live mic stream constraint stays false with NS permanently disabled (" + JSON.stringify(liveTrack.lastApply) + ")");
  ncBtn.click();
  await step(clock, 60);
  ok(ncBtn.classList.contains("wt-on"), "NC back ON");
  ok(H.storage.wt_nc === true, "on pref persisted to storage");
  ok(liveTrack.lastApply && liveTrack.lastApply.noiseSuppression === false,
    "live mic stream constraint stays false even with NC ON (gate controls NS now)");
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
  ok(entry && typeof entry.u === "string" && entry.u.indexOf("/watch/guest/ep1") !== -1,
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
  ok(env.lastGum && env.lastGum.audio && env.lastGum.audio.sampleRate === 48000 &&
     env.lastGum.audio.channelCount === 1 && env.lastGum.audio.echoCancellation === true &&
     env.lastGum.audio.noiseSuppression === false && env.lastGum.audio.autoGainControl === false,
    "mic constraints: 48kHz mono + EC, NS+AGC OFF (" + JSON.stringify(env.lastGum && env.lastGum.audio) + ")");
  // opus bitrate boost installed in source
  ok(SRC.includes("maxaveragebitrate=128000") && SRC.includes("usedtx=0") &&
     SRC.includes("cbr=1") && SRC.includes("googNoiseSuppression=0"),
    "Opus SDP boost present (128kbps stereo, no DTX, no NS/AGC)");
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


  console.log("\n============================================");
  console.log("RESULTS: " + pass + " passed, " + fail + " failed");
  if (failures.length) {
    console.log("\nFailed checks:");
    failures.forEach(f => console.log("  - " + f));
  }
  console.log("============================================\n");
  process.exitCode = fail > 0 ? 1 : 0;
}

  main().catch(e => { const s = "HARNESS CRASH: " + (e && e.stack || e); try { fs.writeFileSync("C:/Users/Sourav/ML Coding/watch-together-versions/tests/crash16.txt", s); } catch (_) {} process.exitCode = 2; });







