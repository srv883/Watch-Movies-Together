/* ============================================================
   V2-simple-voice behaviour harness
   Runs the REAL V2-simple-voice/content.js twice (host+guest)
   against stubbed DOM / PeerJS / chrome APIs.
   Verifies: connection, playback sync, chat, AUTO voice,
   mute/unmute, leave cleanup.
   Run:  node test-V2.js
   ============================================================ */
"use strict";

const fs = require("fs");
const vm = require("vm");

const SRC_PATH = "C:/Users/Sourav/ML Coding/watch-together-versions/V2-simple-voice/content.js";
const SRC = fs.readFileSync(SRC_PATH, "utf8");

const __TEST_ERRORS = [];
globalThis.__TEST_ERRORS = __TEST_ERRORS;

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

function makeEl(tag) {
  const el = {
    tag: (tag || "div").toLowerCase(), id: "", classes: new Set(), children: [], parent: null,
    handlers: {}, dataset: {}, value: "", title: "", type: "", placeholder: "",
    srcObject: null, volume: 1, muted: false, paused: true, currentTime: 0, playbackRate: 1,
    scrollTop: 0, scrollHeight: 0,
    style: {},
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

function makeDoc() {
  const listeners = {};
  const docEl = makeEl("html");
  const body = makeEl("body");
  const videos = [];
  docEl.appendChild(body);
  const doc = {
    hidden: false, fullscreenElement: null,
    documentElement: docEl, body, videos,
    createElement: t => makeEl(t),
    createTextNode: t => ({ tag: "#text", text: String(t) }),
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener() {},
    querySelectorAll(s) { if (s === "video") return videos.slice(); return qsa(docEl, s); },
    querySelector(s) { return doc.querySelectorAll(s)[0] || null; },
  };
  return doc;
}

function makeChromeStub(ls) {
  const store = {};
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

function makePeerClass(env) {
  const reg = [];
  const later = (ms, fn) => env.clock.setTimeout(fn, ms);

  class Conn {
    constructor() { this.h = {}; this.open = false; this.closed = false; this.mirror = null; this.peer = ""; }
    on(t, f) { (this.h[t] = this.h[t] || []).push(f); }
    emit(t, ...x) {
      (this.h[t] || []).slice().forEach(f => {
        try { f(...x); } catch (e) { env.errs.push(["conn:" + t, e]); }
      });
    }
    removeAllListeners() { this.h = {}; }
    send(o) {
      if (!this.open || this.closed || !this.mirror) return;
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
          self.inS = s || null;
          later(8, () => self.emitTo(self.hA, "stream", self.out));
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
      this.h = {}; this.open = false; this.destroyed = false;
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
      const ci = new Conn(); const ct = new Conn();
      ci.mirror = ct; ct.mirror = ci;
      later(15, () => {
        if (!target || this.destroyed) { this.fire("error", { type: "peer-unavailable" }); return; }
        ci.open = true; ct.open = true;
        ci.peer = target.pid; ct.peer = this.pid;
        ci.emit("open");
        target.fire("connection", ct);
        ct.emit("open");
      });
      return ci;
    }
    call(tid, stream) {
      const target = reg.find(p => p !== this && !p.destroyed && p.pid === tid);
      if (!target) return null;
      const call = new Call(stream);
      later(25, () => { if (!this.destroyed) target.fire("call", call.calleeView()); });
      return call.callerView();
    }
    reconnect() {}
    destroy() {
      this.destroyed = true; this.open = false;
      const i = reg.indexOf(this); if (i >= 0) reg.splice(i, 1);
      this.h = {};
    }
  }
  return PeerCls;
}

class FakeStreamForGum {
  constructor(ts) { this.tracks = ts || []; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
  getVideoTracks() { return []; }
}

function makeInstance(env, name) {
  const doc = makeDoc();
  const ls = [];
  const chromeStub = makeChromeStub(ls);
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
          return new FakeStreamForGum([{ stopped: false, enabled: true, stop() { this.stopped = true; } }]);
        },
      },
      clipboard: { writeText: async () => {} },
    },
    location: { href: "https://www.example.com/watch/" + name + "/ep1", protocol: "https:" },
    chrome: chromeStub,
    Peer: env.Peer,
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
  };
}

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; failures.push(label); console.log("  FAIL  " + label); }
}
function contains(hay, needle) { return String(hay || "").indexOf(needle) !== -1; }
const tick = async () => { for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r)); };
async function step(clock, ms) { clock.advance(ms); await tick(); }
const lines = I => {
  const m = I.q("#wt-msgs");
  return m ? m.children.filter(c => c.tag !== "#text").map(c => c.textContent.trim()).filter(Boolean) : [];
};
const anyMsg = (I, s) => lines(I).some(t => t.indexOf(s) !== -1);

async function main() {
  const env = { clock: new Clock(), errs: [], gum: 0, _peerSeq: 0 };
  env.Peer = makePeerClass(env);

  const H = makeInstance(env, "host");
  const G = makeInstance(env, "guest");
  const { clock } = env;

  console.log("\n--- 1. party creation & connection ---");
  H.fire({ wt_party: { id: "ABC123", role: "host", name: "Sourav" } });
  await step(clock, 80);
  ok(contains(H.st("#wt-status-text"), "Waiting"), "host waits for friend");
  ok(H.q("#wt-root") && H.q("#wt-root").classList.contains("wt-active"), "overlay visible on host");

  await step(clock, 1600);

  G.fire({ wt_party: { id: "ABC123", role: "guest", name: "Priya" } });
  await step(clock, 500);
  ok(contains(H.st("#wt-status-text"), "Playback synced"), "host connected (" + H.st("#wt-status-text") + ")");
  ok(contains(G.st("#wt-status-text"), "Playback synced"), "guest connected (" + G.st("#wt-status-text") + ")");
  ok(anyMsg(H, "Priya says hi"), "'Priya says hi' system message");

  console.log("\n--- 2. playback sync ---");
  await step(clock, 2000);
  ok((G.video.handlers["play"] || []).length === 1, "guest video bound once");
  G.video.paused = false;
  G.video.currentTime = 100;
  G.video.dispatch("play", { target: G.video });
  await step(clock, 60);
  ok(H.video.paused === false, "host played after guest played");

  G.video.currentTime = 500;
  G.video.dispatch("seeked", { target: G.video });
  await step(clock, 60);
  ok(Math.abs(H.video.currentTime - 500) < 0.5, "host followed seek to 500s (" + H.video.currentTime.toFixed(1) + ")");

  G.video.paused = true;
  G.video.dispatch("pause", { target: G.video });
  await step(clock, 60);
  ok(H.video.paused === true, "host paused after guest paused");

  console.log("\n--- 3. chat ---");
  const inp = G.q("#wt-input");
  inp.value = "hello there";
  G.q("#wt-form").dispatch("submit");
  await step(clock, 40);
  ok(anyMsg(H, "Priya: hello there"), "chat delivered host-side");

  console.log("\n--- 4. auto voice (guest dialed, host answered) ---");
  ok(env.gum === 2, "mic requested exactly once per side (" + env.gum + ")");
  const hA = H.q("audio"), gA = G.q("audio");
  ok(!!hA && !!hA.srcObject, "host receives guest's voice stream");
  ok(!!gA && !!gA.srcObject, "guest receives host's voice stream");

  console.log("\n--- 5. mute / unmute ---");
  H.q("#wt-mic").click();
  await step(clock, 20);
  ok(H.q("#wt-mic").textContent === "Unmute", "mute flips label to Unmute");
  ok(H.q("#wt-mic").classList.contains("wt-muted"), "muted styling applied");
  ok(!!H.q("audio") && !!H.q("audio").srcObject, "session survives mute (line stays up)");
  H.q("#wt-mic").click();
  await step(clock, 20);
  ok(H.q("#wt-mic").textContent === "Mute", "unmute restores label");
  ok(!H.q("#wt-mic").classList.contains("wt-muted"), "muted styling cleared");

  console.log("\n--- 6. leave party cleanup ---");
  G.fire({ wt_party: null });
  await step(clock, 80);
  ok(!(G.q("#wt-root").classList.contains("wt-active")), "guest overlay deactivated");
  ok(!G.q("audio"), "guest audio element removed");
  ok(
    contains(H.st("#wt-status-text"), "disconnected") || contains(H.st("#wt-status-text"), "Waiting"),
    "host notices friend left (" + H.st("#wt-status-text") + ")"
  );

  console.log("\n--- 7. error sweep ---");
  ok(clock.errs.length === 0, "no uncaught timer errors (" + clock.errs.length + ")");
  if (clock.errs.length) console.log("   ", clock.errs[0]);
  ok(env.errs.length === 0, "no handler errors inside content scripts (" + env.errs.length + ")");
  if (env.errs.length) env.errs.slice(0, 5).forEach(([t, e]) => console.log("    [" + t + "]", e && e.message));
  ok(__TEST_ERRORS.length === 0, "no DOM dispatch errors (" + __TEST_ERRORS.length + ")");
  if (__TEST_ERRORS.length) __TEST_ERRORS.slice(0, 5).forEach(([t, e]) => console.log("    [" + t + "]", e && e.message));

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
