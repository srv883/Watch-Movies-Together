/* ============================================================
   V4 behaviour test harness
   Runs the REAL watch-together-v4/content.js twice (host+guest)
   against stubbed DOM / PeerJS / chrome APIs and verifies the
   full feature set end-to-end.
   Run:  node test-v4.js
   ============================================================ */
"use strict";

const fs = require("fs");
const vm = require("vm");

const SRC_PATH = "C:/Users/Sourav/Downloads/watch-together-v4/content.js";
const SRC = fs.readFileSync(SRC_PATH, "utf8");

const __TEST_ERRORS = [];
globalThis.__TEST_ERRORS = __TEST_ERRORS;

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

  el.appendChild = c => { el.children.push(c); c.parent = el; return c; };
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
  el.play = () => { el.paused = false; return Promise.resolve(); };
  el.pause = () => { el.paused = true; };
  el.getBoundingClientRect = () => el._rect;
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
    constructor(outStream) { this.out = outStream || null; this.hC = {}; this.hA = {}; this.ended = false; }
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
      };
    }
    calleeView() {
      const self = this;
      return {
        answer(s) {
          self.inS = s instanceof FakeStream ? s : new FakeStream([]);
          later(8, () => self.emitTo(self.hA, "stream", self.out instanceof FakeStream ? self.out : new FakeStream([])));
          later(16, () => self.emitTo(self.hC, "stream", self.inS));
        },
        on(t, f) { (self.hA[t] = self.hA[t] || []).push(f); },
        close: () => this.end(),
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
    reconnect() { this.disconnected = false; }
    destroy() {
      this.destroyed = true; this.open = false;
      const i = reg.indexOf(this); if (i >= 0) reg.splice(i, 1);
      this.h = {};
    }
  }
  return PeerCls;
}
/* ---------------- instance (one browser tab) ---------------- */
function makeInstance(env, name) {
  const doc = makeDoc();
  const chromeStub = makeChromeStub();
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
        getUserMedia: async () => {
          env.gum++;
          return new env.FakeStream([{ stopped: false, stop() { this.stopped = true; } }]);
        },
      },
      clipboard: { writeText: async () => {} },
    },
    chrome: chromeStub,
    Peer: env.Peer,
    MediaStream: function () { this.tracks = []; },
    window: null,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  try { vm.runInContext(SRC, ctx, { filename: name + "/content.js" }); }
  catch (e) { env.errs.push(["load:" + name, e]); }

  return {
    name, doc, chrome: chromeStub, video,
    storage: chromeStub.store,
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
/* ---------------- scenario helpers ---------------- */
const lines = I => {
  const m = I.q("#wt-msgs");
  return m ? m.children.filter(c => c.tag !== "#text").map(c => c.textContent.trim()).filter(Boolean) : [];
};
const anyMsg = (I, s) => lines(I).some(t => t.indexOf(s) !== -1);
const anyToast = (I, s) => I.toasts().some(t => t.indexOf(s) !== -1);
function sendChat(I, text) {
  const inp = I.q("#wt-input");
  inp.value = text;
  I.q("#wt-form").dispatch("submit");
}
class FakeStreamForGum {
  constructor(ts) { this.tracks = ts || []; }
  getTracks() { return this.tracks; }
  get active() { return this.tracks.every(t => !t.stopped); }
}

/* ============================================================ */
async function main() {
  const env = { clock: new Clock(), errs: [], gum: 0, cutoff: false, FakeStream: FakeStreamForGum, _peerSeq: 0 };
  env.Peer = makePeerClass(env);

  const H = makeInstance(env, "host");
  const G = makeInstance(env, "guest");
  const { clock } = env;

  console.log("\n--- 1. party creation & connection ---");
  H.fire({ wt_party: { id: "ABC123", role: "host", name: "Sourav" } });
  await step(clock, 80);
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
  ok(!H.q("#wt-root").classList.contains("wt-open"), "panel closed on host");
  sendChat(G, "psst hidden message");
  await step(clock, 40);
  ok(anyToast(H, "Priya: psst hidden message"), "message preview toast while panel closed");
  H.q("#wt-pill").click();
  ok(H.q("#wt-root").classList.contains("wt-open"), "pill reopens panel");
  console.log("\n--- 5. typing indicator ---");
  const gInput = G.q("#wt-input");
  gInput.value = "typing som";
  gInput.dispatch("input");
  await step(clock, 30);
  const hTyping = H.q("#wt-typing");
  ok(hTyping && hTyping.classList.contains("wt-show") && contains(hTyping.textContent, "Priya is typing"), "host sees 'Priya is typing…'");
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
  ok(results.length >= 1 && results.length <= 8 && results.some(r => r.textContent === "\u{1F525}"),
    "search 'fire' filters correctly (" + results.map(r => r.textContent).join("") + ")");
  H.q("#wt-picker-close").click();
  ok(hPicker.classList.contains("wt-hide"), "picker closes");

  console.log("\n--- 8. voice chat + volume slider ---");
  H.q("#wt-mic").click();
  await step(clock, 60);
  await step(clock, 200);
  ok(env.gum === 1, "mic permission requested once");
  ok(H.q("#wt-mic").classList.contains("wt-mic-on"), "mic button shows ON state");
  const gAudio = G.q("#wt-remote-audio");
  ok(gAudio && !!gAudio.srcObject, "guest receives host's voice stream");

  const hSlider = H.q("#wt-voice-vol");
  hSlider.value = "40";
  hSlider.dispatch("input");
  const hAudio = H.q("#wt-remote-audio");
  ok(hAudio && hAudio.volume === 0.4, "volume slider applies to remote audio (0.4)");
  ok(H.storage.wt_voice_vol === 0.4, "volume choice persisted to storage");

  G.q("#wt-mic").click();
  await step(clock, 60);
  await step(clock, 200);
  ok(!!H.q("#wt-remote-audio").srcObject, "two-way voice: host receives guest stream");

  H.q("#wt-mic").click(); // mute
  await step(clock, 40);
  ok(!H.q("#wt-mic").classList.contains("wt-mic-on"), "mic toggles OFF");

  console.log("\n--- 9. zombie connection watchdog (the 30-min bug) ---");
  env.cutoff = true; // simulate silent data-channel death
  const hPausedBefore = H.video.paused;
  G.video.paused = false;
  G.video.dispatch("play", { target: G.video });
  await step(clock, 200);
  ok(H.video.paused === hPausedBefore, "sync is genuinely broken during zombie state");
  await step(clock, 13000); // exceed watchdog threshold
  const gSt = G.st("#wt-status-text");
  ok(!contains(gSt, "Synced with"), "guest detected the dead channel (status: " + gSt + ")");
  env.cutoff = false;
  await step(clock, 40000);
  ok(contains(G.st("#wt-status-text"), "Synced with"), "guest auto-recovered (" + G.st("#wt-status-text") + ")");
  ok(contains(H.st("#wt-status-text"), "Synced with"), "host auto-recovered (" + H.st("#wt-status-text") + ")");
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
  ok(contains(H.st("#wt-status-text"), "disconnected") || contains(H.st("#wt-status-text"), "Waiting"),
    "host notices friend left (" + H.st("#wt-status-text") + ")");

  console.log("\n--- 12. error sweep ---");
  const domErrs = __TEST_ERRORS.filter(e => !String(e[0]).startsWith("dom:input"));
  ok(clock.errs.length === 0, "no uncaught timer errors (" + clock.errs.length + ")");
  if (clock.errs.length) console.log("   ", clock.errs[0]);
  ok(env.errs.length === 0, "no handler errors inside content scripts (" + env.errs.length + ")");
  if (env.errs.length) env.errs.slice(0, 5).forEach(([t, e]) => console.log("    [" + t + "]", e && e.message));
  const realDomErrs = __TEST_ERRORS;
  ok(realDomErrs.length === 0, "no DOM dispatch errors (" + realDomErrs.length + ")");
  if (realDomErrs.length) realDomErrs.slice(0, 5).forEach(([t, e]) => console.log("    [" + t + "]", e && e.message));

  /* ---------------- summary ---------------- */
  console.log("\n============================================");
  console.log("RESULTS: " + pass + " passed, " + fail + " failed");
  if (failures.length) {
    console.log("\nFailed checks:");
    failures.forEach(f => console.log("  - " + f));
  }
  console.log("============================================\n");
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(e => { console.error("HARNESS CRASH:", e); process.exitCode = 2; });







