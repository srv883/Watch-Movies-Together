// Build the iPhone version of Watch Together: one Safari userscript that runs
// in the free "Userscripts" app (App Store) and joins the same parties as the
// Chrome extension.
//   node tools/make-userscript.js V37-iphone
// -> ios/watch-together.user.js + ios/latest.json
//
// The extension's own files are used unchanged; a small stand-in replaces the
// chrome.* APIs (storage -> GM storage, runtime messages -> the background
// code running in the same page, tabs -> this tab) and the toolbar popup
// becomes a panel behind a round button on the page.
// Needs (once): npm i --prefix tools/.deps @anthropic-ai/sdk@1.11.0 esbuild@0.28.2
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const folder = process.argv[2];
if (!folder) { console.error("usage: node tools/make-userscript.js V<N>-name"); process.exit(1); }
const SRC = path.join(ROOT, folder);
const OUT = path.join(ROOT, "ios");
const rd = (f) => fs.readFileSync(path.join(SRC, f), "utf8");
const manifest = JSON.parse(rd("manifest.json"));
const vArg = process.argv.indexOf("--version");
const VERSION = vArg > 0 ? process.argv[vArg + 1] : manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(VERSION) || VERSION.split(".").slice(0, 2).join(".") !== manifest.version.split(".").slice(0, 2).join(".")) throw new Error("--version must be " + manifest.version.split(".").slice(0, 2).join(".") + ".x");
const RAW = "https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/ios/";
const SCRIPT_URL = RAW + "watch-together.user.js";

// ---- background worker -> plain code in the page ----
const deps = path.join(__dirname, ".deps", "node_modules");
const esbuild = require(path.join(deps, "esbuild"));
let bgSrc = rd("background.src.js");
const nA = (bgSrc.match(/new Anthropic\(\{ apiKey,/g) || []).length;
if (nA < 1) throw new Error("background.src.js: Anthropic client not found");
bgSrc = bgSrc.replace(/new Anthropic\(\{ apiKey,/g, "new Anthropic({ fetch: wtFetch, apiKey,");
const tmp = path.join(__dirname, ".deps", "bg-ios-entry.js");
fs.writeFileSync(tmp, bgSrc);
const bg = esbuild.buildSync({
  entryPoints: [tmp], bundle: true, format: "iife", platform: "browser", target: "safari15",
  minify: true, legalComments: "eof", write: false, nodePaths: [deps],
}).outputFiles[0].text;
fs.unlinkSync(tmp);

// ---- popup -> panel ----
const popupHtml = rd("popup.html");
const icon48 = "data:image/png;base64," + fs.readFileSync(path.join(SRC, "icons/icon48.png")).toString("base64");
const panelBody = /<body>([\s\S]*?)<\/body>/.exec(popupHtml)[1]
  .replace(/<script[\s\S]*?<\/script>/g, "")
  .replace(/src="icons\/icon48\.png"/g, `src="${icon48}"`);
const panelCss = rd("popup.css")
  .replace(/:root\s*\{/g, ":host {")
  .replace(/(^|\n|\})\s*body\s*\{/g, "$1 .wtp {")
  .replace(/(^|[\s,}])\*\s*\{/g, "$1.wtp, .wtp * {");
const popupJs = rd("popup.js");

const meta = [
  "// ==UserScript==",
  "// @name         Watch Together",
  "// @namespace    https://github.com/srv883/Watch-Movies-Together",
  `// @version      ${VERSION}`,
  "// @description  Watch JioHotstar (and the other supported sites) together in sync with a friend: chat, voice, reactions and scene trivia. iPhone build of the Watch Together extension.",
  ...manifest.content_scripts[0].matches.map((m) => "// @match        " + m),
  "// @run-at       document-idle",
  "// @inject-into  content",
  "// @noframes",
  "// @grant        GM.getValue",
  "// @grant        GM.setValue",
  "// @grant        GM.deleteValue",
  "// @grant        GM.listValues",
  "// @grant        GM.xmlHttpRequest",
  "// @grant        GM.openInTab",
  `// @updateURL    ${SCRIPT_URL}`,
  `// @downloadURL  ${SCRIPT_URL}`,
  "// ==/UserScript==",
].join("\n");

const shim = String.raw`
const WT_IOS_VERSION = ${JSON.stringify(VERSION)};
const WT_IOS_SCRIPT_URL = ${JSON.stringify(SCRIPT_URL)};
const WT_IOS_LATEST_URL = ${JSON.stringify(RAW + "latest.json")};
const hasGM = typeof GM !== "undefined" && GM && typeof GM.getValue === "function";

// ---- fetch: the page's own fetch; GM.xmlHttpRequest when that is refused ----
function parseHeaders(raw) {
  const h = new Headers();
  String(raw || "").trim().split(/[\r\n]+/).forEach((line) => {
    const i = line.indexOf(":");
    if (i > 0) { try { h.append(line.slice(0, i).trim(), line.slice(i + 1).trim()); } catch (_) {} }
  });
  return h;
}
function gmFetch(input, init) {
  init = init || {};
  const url = typeof input === "string" ? input : (input && input.url) || String(input);
  return new Promise((resolve, reject) => {
    const headers = {};
    const h = init.headers;
    if (h) { if (typeof h.forEach === "function") h.forEach((v, k) => { headers[k] = v; }); else Object.assign(headers, h); }
    let done = false;
    const fail = (name, msg) => { if (done) return; done = true; const e = name === "AbortError" ? new DOMException(msg, "AbortError") : new TypeError(msg); reject(e); };
    if (init.signal) {
      if (init.signal.aborted) return fail("AbortError", "aborted");
      init.signal.addEventListener("abort", () => fail("AbortError", "aborted"));
    }
    GM.xmlHttpRequest({
      method: init.method || "GET", url, headers,
      data: init.body == null ? undefined : init.body,
      onload: (r) => {
        if (done) return; done = true;
        const nobody = [101, 204, 205, 304].indexOf(r.status) !== -1;
        resolve(new Response(nobody ? null : (r.responseText != null ? r.responseText : r.response), { status: r.status || 200, statusText: r.statusText || "", headers: parseHeaders(r.responseHeaders) }));
      },
      onerror: () => fail("TypeError", "network error"),
      ontimeout: () => fail("TypeError", "timeout"),
      onabort: () => fail("AbortError", "aborted"),
    });
  });
}
const pageFetch = window.fetch.bind(window);
function wtFetch(input, init) {
  return pageFetch(input, init).catch((e) => {
    if (e && e.name === "AbortError") throw e;
    if (hasGM && typeof GM.xmlHttpRequest === "function") return gmFetch(input, init);
    throw e;
  });
}
const fetch = wtFetch;

// ---- chrome.storage.local -> GM storage (shared by every supported site) ----
const SPFX = "wt-us:";
const mem = {};
const ready = (async () => {
  try {
    if (hasGM) {
      const keys = await GM.listValues();
      for (const k of keys) { try { const v = await GM.getValue(k); mem[k] = typeof v === "string" ? JSON.parse(v) : v; } catch (_) {} }
    } else {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(SPFX) === 0) { try { mem[k.slice(SPFX.length)] = JSON.parse(localStorage.getItem(k)); } catch (_) {} }
      }
    }
  } catch (_) {}
})();
function persist(k, v) {
  try {
    if (hasGM) { if (v === undefined) GM.deleteValue(k); else GM.setValue(k, JSON.stringify(v)); }
    else if (v === undefined) localStorage.removeItem(SPFX + k); else localStorage.setItem(SPFX + k, JSON.stringify(v));
  } catch (_) {}
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const changeListeners = [];
function fireChanges(ch) {
  if (!Object.keys(ch).length) return;
  setTimeout(() => { for (const f of changeListeners.slice()) { try { f(clone(ch), "local"); } catch (e) { console.error(e); } } }, 0);
}
function cbify(p, cb) { if (typeof cb === "function") { p.then((r) => cb(r), () => cb()); return undefined; } return p; }
const storageLocal = {
  get(keys, cb) {
    return cbify(ready.then(() => {
      const out = {};
      if (keys == null) { for (const k in mem) out[k] = clone(mem[k]); return out; }
      if (typeof keys === "string") keys = [keys];
      if (Array.isArray(keys)) { for (const k of keys) if (k in mem) out[k] = clone(mem[k]); return out; }
      for (const k in keys) out[k] = k in mem ? clone(mem[k]) : keys[k];
      return out;
    }), cb);
  },
  set(obj, cb) {
    return cbify(ready.then(() => {
      const ch = {};
      for (const k in obj) {
        const nv = clone(obj[k]);
        ch[k] = { oldValue: clone(mem[k]), newValue: nv };
        mem[k] = nv; persist(k, nv);
      }
      fireChanges(ch);
    }), cb);
  },
  remove(keys, cb) {
    return cbify(ready.then(() => {
      const ch = {};
      for (const k of typeof keys === "string" ? [keys] : keys || []) {
        if (k in mem) { ch[k] = { oldValue: clone(mem[k]) }; delete mem[k]; persist(k, undefined); }
      }
      fireChanges(ch);
    }), cb);
  },
};

// ---- chrome.runtime: messages go to the background code in this page ----
const msgListeners = [];
const runtime = {
  id: "wt-ios",
  lastError: undefined,
  getManifest: () => ({ name: "Watch Together", version: WT_IOS_VERSION, update_url: "userscript", wt_ios: true }),
  getURL: (p) => String(p || ""),
  onMessage: { addListener: (f) => msgListeners.push(f) },
  sendMessage(msg, cb) {
    const p = new Promise((resolve) => {
      let done = false;
      const reply = (r) => { if (!done) { done = true; resolve(clone(r)); } };
      let pending = false;
      setTimeout(() => {
        for (const f of msgListeners.slice()) {
          try { if (f(clone(msg), { id: "wt-ios", url: location.href }, reply) === true) pending = true; } catch (e) { console.error(e); }
        }
        if (!pending) reply(undefined);
      }, 0);
    });
    return cbify(p, cb);
  },
};
const chrome = {
  storage: { local: storageLocal, onChanged: { addListener: (f) => changeListeners.push(f) } },
  runtime,
  tabs: {
    query: async () => [{ id: 1, url: location.href, active: true }],
    create: ({ url }) => { try { if (hasGM && typeof GM.openInTab === "function") GM.openInTab(url); else window.open(url, "_blank"); } catch (_) { location.href = url; } },
  },
  alarms: { create() {}, onAlarm: { addListener() {} } },
};
`;

const panel = String.raw`
// ---- the toolbar popup, as a panel behind a round button ----
(function () {
  if (window.top !== window) return;
  const host = document.createElement("div");
  host.id = "wt-ios-host";
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = "<style>" + ${JSON.stringify(panelCss)} + ${JSON.stringify(`
    .wt-bar { position: fixed; left: calc(4px + env(safe-area-inset-left)); top: 40%;
      display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 4px;
      border-radius: 24px; background: rgba(16,16,24,.72); box-shadow: 0 2px 10px rgba(0,0,0,.5);
      -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
      -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
      transition: opacity .4s; opacity: 1; }
    .wt-bar.wt-faded { opacity: .45; }
    .wt-bar.wt-dragging { transition: none; }
    .wt-grip { width: 40px; height: 16px; display: flex; align-items: center; justify-content: center; touch-action: none; cursor: grab; }
    .wt-grip::before { content: ""; width: 18px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.45); }
    .wt-b { position: relative; width: 40px; height: 40px; border-radius: 50%; border: 0; padding: 0; margin: 0;
      background: rgba(255,255,255,.08); color: #fff; font-size: 19px; line-height: 40px; text-align: center; cursor: pointer;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    .wt-b:active { transform: scale(.92); }
    .wt-b img { width: 40px; height: 40px; border-radius: 50%; display: block; pointer-events: none; -webkit-user-drag: none; }
    .wt-b.wt-on { background: #43d17a; color: #0c1a12; }
    .wt-b.wt-mic-on { background: #e53935; }
    .wt-b.wt-live::after { content: ""; position: absolute; right: 0; top: 0; width: 10px; height: 10px; border-radius: 50%; background: #43d17a; border: 2px solid #14141c; }
    .wt-sheet { position: fixed; left: 50%; top: calc(8px + env(safe-area-inset-top)); transform: translateX(-50%);
      width: min(340px, calc(100vw - 16px)); max-height: calc(100vh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
      overflow-y: auto; -webkit-overflow-scrolling: touch; border-radius: 14px; box-shadow: 0 8px 40px rgba(0,0,0,.6); }
    .wt-sheet .wtp { width: auto; }
    .wt-x { position: sticky; top: 0; float: right; margin: 6px 6px 0 0; width: 36px; height: 36px; border-radius: 50%; border: 0;
      background: #2a2a38; color: #ddd; font-size: 17px; line-height: 36px; text-align: center; padding: 0; z-index: 1; }
    .wt-hidden { display: none !important; }
    .wt-ios-note { margin: 10px 0 0; font-size: 12px; color: #9a9ab0; line-height: 1.4; }
    input, button { font-size: 16px; }
  `)} + "</style>" +
    '<div class="wt-bar" id="wtBar">' +
      '<div class="wt-grip" id="wtGrip" aria-label="Move"></div>' +
      '<button class="wt-b" id="wtBParty" aria-label="Watch Together party"><img alt="" src="${icon48}"></button>' +
      '<button class="wt-b wt-hidden" id="wtBChat" aria-label="Chat">💬</button>' +
      '<button class="wt-b wt-hidden" id="wtBMic" aria-label="Microphone">🎤</button>' +
      '<button class="wt-b wt-hidden" id="wtBFs" aria-label="Fill the screen (chat on top)">⛶</button>' +
      '<button class="wt-b wt-hidden" id="wtBTv" aria-label="Apple full screen">📺</button>' +
    '</div>' +
    '<div class="wt-sheet wt-hidden" id="wtSheet"><button class="wt-x" id="wtX" aria-label="Close">✕</button><div class="wtp">' +
    ${JSON.stringify(panelBody)} +
    '<p class="wt-ios-note">The bar on the side: logo = this panel (start / join / leave), 💬 = chat, 🎤 = your mic, ⛶ = fill the screen with chat and trivia on top, 📺 = Apple’s full screen (edge to edge; sync and voice keep going, chat shows again when you leave it). Drag the little handle on top to move the bar. Turn on English subtitles for scene trivia; earphones work best for voice.</p>' +
    '</div></div>';
  const $s = (id) => shadow.getElementById(id);
  const bar = $s("wtBar"), sheet = $s("wtSheet"), fab = $s("wtBParty");
  const bChat = $s("wtBChat"), bMic = $s("wtBMic"), bFs = $s("wtBFs"), bTv = $s("wtBTv"), grip = $s("wtGrip");
  let fadeT = 0, pos = { side: "left", top: 0.4 };
  const wake = () => { bar.classList.remove("wt-faded"); clearTimeout(fadeT); fadeT = setTimeout(() => { if (sheet.classList.contains("wt-hidden")) bar.classList.add("wt-faded"); }, 4000); };
  const open = () => { sheet.classList.remove("wt-hidden"); wake(); };
  const close = () => { sheet.classList.add("wt-hidden"); wake(); };
  bar.addEventListener("touchstart", wake, { passive: true });
  bar.addEventListener("mousedown", wake);

  // ---- one tap, one action ----
  fab.addEventListener("click", () => { if (sheet.classList.contains("wt-hidden")) open(); else close(); });
  $s("wtX").addEventListener("click", close);
  const root = () => document.getElementById("wt-root");
  bChat.addEventListener("click", () => { close(); const p = document.getElementById("wt-pill"); if (p) p.click(); setTimeout(syncState, 60); });
  bMic.addEventListener("click", () => { const m = document.getElementById("wt-mic"); if (m) m.click(); setTimeout(syncState, 300); });
  bFs.addEventListener("click", () => { close(); if (fsBox) exitFs(); else enterFs(); });
  bTv.addEventListener("click", () => { close(); appleFs(); });

  // what each button shows: party on / chat open / mic on / full screen
  async function syncState() {
    let party = null, mic = false;
    try { const r = await chrome.storage.local.get(["wt_party", "wt_mic_state"]); party = r.wt_party; mic = !!r.wt_mic_state; } catch (_) {}
    const live = !!party && !!document.querySelector("#wt-root.wt-active");
    fab.classList.toggle("wt-live", !!party);
    bChat.classList.toggle("wt-hidden", !live);
    bMic.classList.toggle("wt-hidden", !live);
    const r = root();
    bChat.classList.toggle("wt-on", !!(r && r.classList.contains("wt-open")));
    bMic.classList.toggle("wt-mic-on", live && mic);
    bFs.classList.toggle("wt-hidden", !bestVideo());
    bTv.classList.toggle("wt-hidden", !bestVideo());
    bFs.classList.toggle("wt-on", !!fsBox);
    bFs.textContent = fsBox ? "✕" : "⛶";
    bFs.setAttribute("aria-label", fsBox ? "Exit full screen" : "Full screen");
    makeRoom();
  }
  // the chat panel moves over when the bar sits on the right edge (unless the user dragged the panel)
  function makeRoom() {
    const r = root();
    if (!r || r.style.left) return;
    const want = pos.side === "right" ? "calc(62px + env(safe-area-inset-right))" : "";
    if (r.style.right !== want) r.style.right = want;
  }
  chrome.storage.onChanged.addListener((ch) => { if (ch.wt_party || ch.wt_mic_state || ch.wt_status) syncState(); });
  setInterval(syncState, 1500);
  syncState();

  // ---- move the bar: drag its handle; it snaps to the nearest side ----
  const M = 4;
  let drag = null;
  function dock(p) {
    const h = bar.offsetHeight || 200;
    bar.style.top = Math.max(M, Math.min(innerHeight - h - M, (p.top || 0.4) * innerHeight)) + "px";
    if (p.side === "right") { bar.style.right = "calc(" + M + "px + env(safe-area-inset-right))"; bar.style.left = "auto"; }
    else { bar.style.left = "calc(" + M + "px + env(safe-area-inset-left))"; bar.style.right = "auto"; }
  }
  const gDown = (x, y) => { drag = { x, y, r: bar.getBoundingClientRect() }; bar.classList.add("wt-dragging"); wake(); };
  const gMove = (x, y) => {
    if (!drag) return;
    const w = drag.r.width, h = drag.r.height;
    bar.style.left = Math.max(M, Math.min(innerWidth - w - M, drag.r.left + x - drag.x)) + "px"; bar.style.right = "auto";
    bar.style.top = Math.max(M, Math.min(innerHeight - h - M, drag.r.top + y - drag.y)) + "px";
  };
  const gUp = () => {
    if (!drag) return;
    drag = null; bar.classList.remove("wt-dragging");
    const r = bar.getBoundingClientRect();
    pos = { side: r.left + r.width / 2 < innerWidth / 2 ? "left" : "right", top: r.top / innerHeight };
    dock(pos);
    try { chrome.storage.local.set({ wt_ios_bar: pos }); } catch (_) {}
    makeRoom();
  };
  grip.addEventListener("touchstart", (e) => { const t = e.touches[0]; gDown(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  grip.addEventListener("touchmove", (e) => { const t = e.touches[0]; gMove(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  grip.addEventListener("touchend", (e) => { e.preventDefault(); gUp(); }, { passive: false });
  grip.addEventListener("touchcancel", gUp);
  grip.addEventListener("mousedown", (e) => { gDown(e.clientX, e.clientY); const mm = (ev) => gMove(ev.clientX, ev.clientY); const mu = () => { document.removeEventListener("mousemove", mm, true); document.removeEventListener("mouseup", mu, true); gUp(); }; document.addEventListener("mousemove", mm, true); document.addEventListener("mouseup", mu, true); });
  chrome.storage.local.get("wt_ios_bar").then((r) => { if (r.wt_ios_bar && r.wt_ios_bar.side) pos = r.wt_ios_bar; dock(pos); });
  addEventListener("resize", () => dock(pos));
  wake();

  // ---- full screen that works on iPhone ----
  // iPhone Safari can't make a page element full screen; the site's button ends
  // in a blank screen or in Apple's own player (which hides chat and trivia).
  // Instead the player box is stretched over the whole screen, our overlay on top.
  let fsBox = null, fsAnc = [], fsVid = null;
  function bestVideo() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect(), a = r.width * r.height;
      if (a > area) { area = a; best = v; }
    }
    return area > 1000 ? best : null;
  }
  function playerBox(v) {
    const vr = v.getBoundingClientRect(), va = Math.max(1, vr.width * vr.height);
    let best = v.parentElement || v;
    for (let p = v.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const r = p.getBoundingClientRect();
      if (r.width * r.height <= va * 1.6) best = p; else break;
    }
    return best;
  }
  function enterFs() {
    const v = bestVideo();
    if (!v) return;
    fsBox = playerBox(v);
    fsBox.classList.add("wt-ios-fsbox");
    fsAnc = [];
    for (let p = fsBox.parentElement; p && p !== document.documentElement; p = p.parentElement) { p.classList.add("wt-ios-fsanc"); fsAnc.push(p); }
    document.documentElement.classList.add("wt-ios-fs");
    try { scrollTo(0, 0); } catch (_) {}
    setTimeout(() => {
      if (!fsBox) return;
      const r = v.getBoundingClientRect();
      if (r.width * r.height < innerWidth * innerHeight * 0.8) { fsVid = v; v.classList.add("wt-ios-fsvid"); }
    }, 150);
    syncState();
  }
  function exitFs() {
    if (fsBox) fsBox.classList.remove("wt-ios-fsbox");
    if (fsVid) { fsVid.classList.remove("wt-ios-fsvid"); fsVid = null; }
    for (const p of fsAnc) p.classList.remove("wt-ios-fsanc");
    fsAnc = []; fsBox = null;
    document.documentElement.classList.remove("wt-ios-fs");
    syncState();
  }
  window.__wtIosFs = () => !!fsBox;
  // Apple's own full-screen player: really edge to edge. Our overlay can't show
  // over it, but sync and voice keep running; chat is back when you leave it.
  function appleFs() {
    const v = bestVideo();
    if (!v) return;
    if (fsBox) exitFs();
    try {
      if (typeof v.webkitEnterFullscreen === "function") v.webkitEnterFullscreen();
      else if (typeof v.requestFullscreen === "function") v.requestFullscreen();
    } catch (_) {}
    window.__wtIosAppleFs = (window.__wtIosAppleFs || 0) + 1;
  }
  // the site's own full-screen button: iPhone can't make the site's player box
  // full screen (it went blank), so it opens Apple's full screen instead
  const FS_SEL = '[aria-label*="full screen" i], [aria-label*="fullscreen" i], [title*="full screen" i], [title*="fullscreen" i], [data-testid*="fullscreen" i], [class*="fullscreen" i], [class*="full-screen" i]';
  document.addEventListener("click", (e) => {
    const t = e.target && e.target.closest ? e.target.closest(FS_SEL) : null;
    if (!t || t.closest("#wt-root, #wt-ios-host") || !bestVideo()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    appleFs();
  }, true);
  document.documentElement.appendChild(host);
  setInterval(() => { if (host.parentNode !== document.documentElement) document.documentElement.appendChild(host); }, 3000);

  // popup.js, unchanged, seeing the panel as its document
  const doc = {
    getElementById: (id) => shadow.getElementById(id),
    querySelector: (s) => shadow.querySelector(s),
    querySelectorAll: (s) => shadow.querySelectorAll(s),
    createElement: (t) => document.createElement(t),
  };
  const win = { close };
  const alert = (m) => window.alert(m);
  (function (document, window, alert) {
${popupJs}
  })(doc, win, alert);

  // ---- iPhone updates: this script's own copy on GitHub ----
  const newer = (a, b) => { const x = String(a || "").split(".").map(Number), y = String(b || "").split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  async function checkIosUpdate() {
    let { wt_ios_update: u } = await chrome.storage.local.get("wt_ios_update");
    if (!u || Date.now() - (u.checkedAt || 0) > 6 * 3600 * 1000) {
      try {
        const r = await wtFetch(WT_IOS_LATEST_URL + "?t=" + Date.now(), { cache: "no-store" });
        const j = await r.json();
        if (j && /^\d+\.\d+\.\d+$/.test(String(j.version))) {
          u = { version: j.version, notes: String(j.notes || "").slice(0, 200), checkedAt: Date.now() };
          await chrome.storage.local.set({ wt_ios_update: u });
        }
      } catch (_) {}
    }
    if (!u || !newer(u.version, WT_IOS_VERSION)) return;
    $s("updateText").textContent = "🆕 Version " + u.version + " is out (you have " + WT_IOS_VERSION + ")";
    $s("updateNotes").textContent = u.notes || "";
    $s("updateBtn").textContent = "Update";
    $s("updateHelp").innerHTML = "<li>Safari opens the new script.</li><li>Tap the <b>puzzle-piece / Aa</b> button in the address bar → <b>Userscripts</b> → <b>Update</b> (or Install).</li><li>Come back and reload this page.</li>";
    $s("extPageBtn").remove();
    $s("updateBar").classList.remove("hidden");
    fab.classList.add("wt-live");
  }
  // the popup's own buttons point at the Chrome zip; on iPhone they open the script
  const ub = $s("updateBtn");
  const nb = ub.cloneNode(true); ub.parentNode.replaceChild(nb, ub);
  nb.addEventListener("click", () => { $s("updateHelp").classList.remove("hidden"); chrome.tabs.create({ url: WT_IOS_SCRIPT_URL }); });
  checkIosUpdate();
})();
`;

const css = rd("overlay.css");
// iPhone only: nothing over the bottom of the player. The emoji bar / "Say
// something" box and the red pill go; the edge button opens the chat panel
// (its emojis and chat box are inside it).
const IOS_CSS = `
/* iPhone build: keep the player's controls free */
#wt-pill, #wt-quick { display: none !important; }
/* full screen that works on iPhone: the player box stretched over the screen */
html.wt-ios-fs, html.wt-ios-fs body { overflow: hidden !important; }
.wt-ios-fsanc { transform: none !important; filter: none !important; contain: none !important; will-change: auto !important; overflow: visible !important; }
.wt-ios-fsbox { position: fixed !important; inset: 0 !important; left: 0 !important; top: 0 !important; width: 100vw !important; height: 100vh !important; height: 100dvh !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important; z-index: 2147483000 !important; background: #000 !important; transform: none !important; }
.wt-ios-fsvid { position: fixed !important; inset: 0 !important; left: 0 !important; top: 0 !important; width: 100vw !important; height: 100vh !important; height: 100dvh !important; max-width: none !important; max-height: none !important; z-index: 2147483001 !important; object-fit: contain !important; background: #000 !important; transform: none !important; }
.wt-ios-fsbox video { width: 100% !important; height: 100% !important; max-height: none !important; object-fit: contain !important; }
`;
const out = [
  meta,
  "",
  "// Built from " + folder + " by tools/make-userscript.js - do not edit by hand.",
  "(function () {",
  "if (window.__wtIos) return; window.__wtIos = true;",
  shim,
  "// ---- overlay.css ----",
  "(function () { const st = document.createElement('style'); st.id = 'wt-ios-css'; st.textContent = " + JSON.stringify(css + IOS_CSS) + "; (document.head || document.documentElement).appendChild(st); })();",
  "// ---- background (" + folder + "/background.src.js, bundled) ----",
  bg,
  "// ---- lib/peerjs.min.js ----",
  rd("lib/peerjs.min.js").replace(/\/\/# sourceMappingURL=.*$/m, ""),
  "// ---- content.js ----",
  rd("content.js"),
  panel,
  "})();",
  "",
].join("\n");

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "watch-together.user.js"), out);
fs.writeFileSync(path.join(OUT, "latest.json"), JSON.stringify({ version: VERSION, url: SCRIPT_URL, notes: (process.argv[3] && process.argv[3] !== "--version" ? process.argv[3] : "") }, null, 1) + "\n");
console.log("ios/watch-together.user.js", (out.length / 1024).toFixed(0) + " KB", "v" + VERSION);
