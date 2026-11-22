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
    .wt-fab { position: fixed; right: calc(4px + env(safe-area-inset-right)); top: 30%;
      width: 40px; height: 40px; border-radius: 50%; border: 0; padding: 0; background: #14141c; opacity: .9;
      box-shadow: 0 2px 8px rgba(0,0,0,.5); cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: none;
      -webkit-user-select: none; user-select: none; transition: opacity .4s, left .2s, right .2s; }
    .wt-fab.wt-dragging { transition: none; opacity: 1; }
    .wt-fab.wt-faded { opacity: .5; }
    .wt-fab img { width: 40px; height: 40px; border-radius: 50%; display: block; pointer-events: none; -webkit-user-drag: none; }
    .wt-fab.wt-live::after { content: ""; position: absolute; right: 0; top: 0; width: 9px; height: 9px; border-radius: 50%; background: #43d17a; border: 2px solid #14141c; }
    .wt-sheet { position: fixed; left: 50%; top: calc(8px + env(safe-area-inset-top)); transform: translateX(-50%);
      width: min(340px, calc(100vw - 16px)); max-height: calc(100vh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
      overflow-y: auto; -webkit-overflow-scrolling: touch; border-radius: 14px; box-shadow: 0 8px 40px rgba(0,0,0,.6); }
    .wt-sheet .wtp { width: auto; }
    .wt-x { position: sticky; top: 0; float: right; margin: 6px 6px 0 0; width: 32px; height: 32px; border-radius: 50%; border: 0;
      background: #2a2a38; color: #ddd; font-size: 16px; line-height: 32px; text-align: center; padding: 0; z-index: 1; }
    .wt-hidden { display: none !important; }
    .wt-chat-btn { display: block; width: 100%; margin: 0 0 12px; padding: 12px; border: 0; border-radius: 10px; background: #43d17a; color: #0c1a12; font-weight: 700; font-size: 16px; }
    .wt-ios-note { margin: 10px 0 0; font-size: 12px; color: #9a9ab0; line-height: 1.4; }
    input, button { font-size: 16px; }
  `)} + "</style>" +
    '<button class="wt-fab" id="wtFab" aria-label="Watch Together"><img alt="" src="${icon48}"></button>' +
    '<div class="wt-sheet wt-hidden" id="wtSheet"><button class="wt-x" id="wtX" aria-label="Close">✕</button><div class="wtp"><button class="wt-chat-btn wt-hidden" id="wtChat">💬 Open chat</button>' +
    ${JSON.stringify(panelBody)} +
    '<p class="wt-ios-note">The round button: tap = this panel, drag = move it. iPhone tips: turn the phone sideways and keep the video in the page (not the full-screen player) so chat and trivia can show. Turn on English subtitles for scene trivia. For voice chat, earphones work best.</p>' +
    '</div></div>';
  const $s = (id) => shadow.getElementById(id);
  const fab = $s("wtFab"), sheet = $s("wtSheet");
  const open = () => { sheet.classList.remove("wt-hidden"); };
  const close = () => { sheet.classList.add("wt-hidden"); try { wake(); } catch (_) {} };
  // a small button docked to a screen edge: drag it anywhere (it snaps to the
  // nearest side and remembers the spot), tap to open; it fades when untouched
  const SZ = 40, M = 4;
  let drag = null, fadeT = 0;
  const wake = () => { fab.classList.remove("wt-faded"); clearTimeout(fadeT); fadeT = setTimeout(() => { if (sheet.classList.contains("wt-hidden")) fab.classList.add("wt-faded"); }, 3500); };
  function dock(pos) {
    const top = Math.max(M, Math.min(innerHeight - SZ - M, (pos.top || 0.3) * innerHeight));
    fab.style.top = top + "px";
    if (pos.side === "left") { fab.style.left = "calc(" + M + "px + env(safe-area-inset-left))"; fab.style.right = "auto"; }
    else { fab.style.right = "calc(" + M + "px + env(safe-area-inset-right))"; fab.style.left = "auto"; }
  }
  let pos = { side: "right", top: 0.3 };
  // in a party: tap = chat panel (the red pill's job), long press = this party panel
  const inParty = () => !!document.querySelector("#wt-root.wt-active");
  let pressT = 0, pressed = false;
  const down = (x, y) => {
    drag = { x, y, moved: false, r: fab.getBoundingClientRect() }; wake();
    pressed = false; clearTimeout(pressT);
    pressT = setTimeout(() => { if (drag && !drag.moved) { pressed = true; open(); } }, 550);
  };
  const move = (x, y) => {
    if (!drag) return;
    const dx = x - drag.x, dy = y - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 8) return;
    drag.moved = true; fab.classList.add("wt-dragging"); clearTimeout(pressT);
    const l = Math.max(M, Math.min(innerWidth - SZ - M, drag.r.left + dx)), t = Math.max(M, Math.min(innerHeight - SZ - M, drag.r.top + dy));
    fab.style.left = l + "px"; fab.style.right = "auto"; fab.style.top = t + "px";
  };
  const up = () => {
    const d = drag; drag = null; fab.classList.remove("wt-dragging"); wake(); clearTimeout(pressT);
    if (pressed) { pressed = false; return; }
    if (d && d.moved) {
      const r = fab.getBoundingClientRect();
      pos = { side: r.left + SZ / 2 < innerWidth / 2 ? "left" : "right", top: r.top / innerHeight };
      dock(pos);
      try { chrome.storage.local.set({ wt_ios_fab2: pos }); } catch (_) {}
      return;
    }
    if (!sheet.classList.contains("wt-hidden")) return close();
    open();
  };
  // touch first (iPhone); the touch handlers stop the page scrolling while dragging
  let touchAt = 0; // a touch is followed by emulated mouse events: ignore those
  fab.addEventListener("touchstart", (e) => { touchAt = Date.now(); const t = e.touches[0]; down(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  fab.addEventListener("touchmove", (e) => { const t = e.touches[0]; move(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  fab.addEventListener("touchend", (e) => { e.preventDefault(); up(); }, { passive: false });
  fab.addEventListener("touchcancel", () => { drag = null; fab.classList.remove("wt-dragging"); });
  fab.addEventListener("mousedown", (e) => { if (Date.now() - touchAt < 800) return; down(e.clientX, e.clientY); const mm = (ev) => move(ev.clientX, ev.clientY); const mu = () => { document.removeEventListener("mousemove", mm, true); document.removeEventListener("mouseup", mu, true); up(); }; document.addEventListener("mousemove", mm, true); document.addEventListener("mouseup", mu, true); });
  $s("wtX").addEventListener("click", close);
  chrome.storage.local.get("wt_ios_fab2").then((r) => { if (r.wt_ios_fab2 && r.wt_ios_fab2.side) pos = r.wt_ios_fab2; dock(pos); });
  addEventListener("resize", () => dock(pos));
  wake();
  const liveDot = () => chrome.storage.local.get("wt_party").then((r) => { fab.classList.toggle("wt-live", !!r.wt_party); $s("wtChat").classList.toggle("wt-hidden", !r.wt_party); });
  // during a party: the chat panel (the red pill is hidden on iPhone)
  $s("wtChat").addEventListener("click", () => { close(); const root = document.getElementById("wt-root"); const pill = document.getElementById("wt-pill"); if (pill && root && !root.classList.contains("wt-open")) pill.click(); });
  chrome.storage.onChanged.addListener((ch) => { if (ch.wt_party) liveDot(); });
  liveDot();
  // keep the button on top of the page's own full-screen element
  function place() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    const parent = fs && fs.tagName !== "VIDEO" ? fs : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }
  document.addEventListener("fullscreenchange", place);
  document.addEventListener("webkitfullscreenchange", place);
  place();
  setInterval(place, 3000);

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
