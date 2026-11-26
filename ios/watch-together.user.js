// ==UserScript==
// @name         Watch Together
// @namespace    https://github.com/srv883/Watch-Movies-Together
// @version      1.39.1
// @description  Watch JioHotstar (and the other supported sites) together in sync with a friend: chat, voice, reactions and scene trivia. Phone build of the Watch Together extension (iPhone Safari with Userscripts, Android Firefox with Tampermonkey or Violentmonkey).
// @match        *://*.netflix.com/*
// @match        *://*.hotstar.com/*
// @match        *://*.jiohotstar.com/*
// @match        *://*.primevideo.com/*
// @match        *://*.jiotv.com/*
// @match        *://*.jiocinema.com/*
// @run-at       document-idle
// @inject-into  content
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.listValues
// @grant        GM.xmlHttpRequest
// @grant        GM.openInTab
// @connect      raw.githubusercontent.com
// @connect      api.anthropic.com
// @updateURL    https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/ios/watch-together.user.js
// @downloadURL  https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/ios/watch-together.user.js
// ==/UserScript==

// Watch Together for phones - updates itself from the project's GitHub repo.
function WT_BUILT_IN(GM) {
// Built from V39-autoupdate by tools/make-userscript.js - do not edit by hand.
(function () {
if (window.__wtIos) return; window.__wtIos = true;

const WT_IOS_VERSION = "1.39.1";
const WT_IOS_SCRIPT_URL = "https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/ios/watch-together.user.js";
const WT_IOS_LATEST_URL = "https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/ios/latest.json";
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

// ---- overlay.css ----
(function () { const st = document.createElement('style'); st.id = 'wt-ios-css'; st.textContent = "#wt-root {\n  position: fixed;\n  right: 18px;\n  bottom: 18px;\n  z-index: 2147483647;\n  display: flex;\n  flex-direction: column;\n  align-items: flex-end;\n  gap: 10px;\n  font-family: \"Segoe UI\", system-ui, sans-serif;\n}\n\n#wt-root:not(.wt-active) { display: none; }\n#wt-root:not(.wt-open) #wt-panel { display: none; }\n\n#wt-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 14px;\n  border: none;\n  border-radius: 999px;\n  background: #e53935;\n  color: #fff;\n  font-size: 13px;\n  font-weight: 600;\n  cursor: pointer;\n  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);\n}\n#wt-pill:hover { filter: brightness(1.1); }\n\n.wt-dot {\n  width: 9px;\n  height: 9px;\n  border-radius: 50%;\n  background: #888;\n  flex: none;\n}\n.wt-dot[data-s=\"connected\"] { background: #43d17a; box-shadow: 0 0 6px rgba(67, 209, 122, 0.6); }\n.wt-dot[data-s=\"waiting\"],\n.wt-dot[data-s=\"connecting\"] { background: #ffb300; }\n.wt-dot[data-s=\"error\"] { background: #ff5252; }\n\n#wt-panel {\n  width: 300px;\n  height: 400px;\n  display: flex;\n  flex-direction: column;\n  background: rgba(16, 16, 24, 0.97);\n  color: #eee;\n  border-radius: 14px;\n  overflow: hidden;\n  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.55);\n}\n\n.wt-head {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 10px 12px;\n  background: rgba(255, 255, 255, 0.04);\n}\n.wt-title { font-size: 13px; font-weight: 700; margin-right: auto; }\n#wt-code {\n  font-family: Consolas, monospace;\n  font-size: 13px;\n  letter-spacing: 2px;\n  color: #ffd54f;\n  background: none;\n  border: none;\n  cursor: pointer;\n}\n#wt-close {\n  background: none;\n  border: none;\n  color: #999;\n  font-size: 16px;\n  cursor: pointer;\n  padding: 0 4px;\n}\n#wt-close:hover { color: #fff; }\n\n.wt-statusline {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  padding: 8px 12px;\n  font-size: 11.5px;\n  color: #9a9ab0;\n  border-bottom: 1px solid rgba(255, 255, 255, 0.06);\n}\n\n#wt-now {\n  display: none;\n  padding: 4px 12px;\n  font-size: 11px;\n  color: #9aabce;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n#wt-now.wt-show { display: block; }\n\n#wt-msgs {\n  flex: 1;\n  overflow-y: auto;\n  padding: 10px 12px;\n  font-size: 13px;\n  line-height: 1.45;\n  scrollbar-width: thin;\n}\n#wt-msgs::-webkit-scrollbar { width: 5px; }\n#wt-msgs::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }\n\n.wt-msg { margin: 3px 0; color: #e8e8ee; word-wrap: break-word; }\n.wt-msg b { color: #8ab4f8; }\n.wt-msg.wt-me b { color: #43d17a; }\n.wt-sys { margin: 6px 0; font-size: 11.5px; color: #77778c; font-style: italic; }\n\n#wt-form {\n  display: flex;\n  gap: 8px;\n  padding: 10px;\n  border-top: 1px solid rgba(255, 255, 255, 0.06);\n}\n#wt-input {\n  flex: 1;\n  min-width: 0;\n  background: #23232f;\n  border: 1px solid #33333f;\n  border-radius: 8px;\n  color: #fff;\n  font-size: 13px;\n  padding: 7px 10px;\n  outline: none;\n}\n#wt-input:focus { border-color: #e53935; }\n#wt-send {\n  background: #e53935;\n  color: #fff;\n  border: none;\n  border-radius: 8px;\n  font-size: 12.5px;\n  font-weight: 600;\n  padding: 0 12px;\n  cursor: pointer;\n}\n\n#wt-mic {\n  background: #23232f;\n  border: 1px solid #33333f;\n  border-radius: 8px;\n  font-size: 15px;\n  line-height: 1;\n  padding: 0 9px;\n  cursor: pointer;\n  flex: none;\n}\n#wt-mic:hover { filter: brightness(1.25); }\n#wt-mic.wt-mic-on {\n  background: #43d17a;\n  border-color: #43d17a;\n  animation: wt-pulse 1.6s ease-in-out infinite;\n}\n@keyframes wt-pulse {\n  0%, 100% { box-shadow: 0 0 0 0 rgba(67, 209, 122, 0.55); }\n  50% { box-shadow: 0 0 0 5px rgba(67, 209, 122, 0); }\n}\n\n.wt-toast {\n  position: static;\n  max-width: 300px;\n  background: rgba(20, 20, 30, 0.95);\n  border: 1px solid rgba(255, 255, 255, 0.15);\n  color: #fff;\n  font-size: 12.5px;\n  padding: 8px 12px;\n  border-radius: 10px;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);\n}\n\n#wt-toasts {\n  position: absolute;\n  top: 46px;\n  right: 0;\n  display: flex;\n  flex-direction: column;\n  align-items: flex-end;\n  gap: 6px;\n  pointer-events: none;\n  z-index: 3;\n}\n\n/* typing indicator */\n#wt-typing {\n  display: none;\n  padding: 2px 12px 4px;\n  font-size: 11px;\n  font-style: italic;\n  color: #9a9ab0;\n}\n#wt-typing.wt-show { display: block; }\n\n/* friend's voice volume */\n.wt-statusline { position: relative; }\n#wt-voice-wrap {\n  margin-left: auto;\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  flex: none;\n  font-size: 11px;\n}\n#wt-voice-vol {\n  width: 56px;\n  height: 3px;\n  accent-color: #e53935;\n  cursor: pointer;\n}\n\n/* ---------- emoji reactions ---------- */\n\n#wt-react-bar {\n  display: flex;\n  align-items: center;\n  gap: 2px;\n  padding: 6px 8px 0;\n}\n.wt-react {\n  flex: 1;\n  background: none;\n  border: none;\n  border-radius: 7px;\n  font-size: 17px;\n  line-height: 1;\n  padding: 4px 0;\n  cursor: pointer;\n  transition: transform 0.12s ease, background 0.12s ease;\n}\n.wt-react:hover {\n  background: rgba(255, 255, 255, 0.08);\n  transform: scale(1.25);\n}\n#wt-react-more {\n  flex: none;\n  width: 26px;\n  background: none;\n  border: none;\n  border-radius: 7px;\n  color: #9a9ab0;\n  font-size: 16px;\n  font-weight: 700;\n  line-height: 1;\n  padding: 4px 0;\n  cursor: pointer;\n}\n#wt-react-more:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }\n\n#wt-picker {\n  position: absolute;\n  bottom: 54px;\n  left: 8px;\n  right: 8px;\n  height: 260px;\n  display: flex;\n  flex-direction: column;\n  background: rgba(14, 14, 22, 0.98);\n  border: 1px solid rgba(255, 255, 255, 0.12);\n  border-radius: 12px;\n  overflow: hidden;\n  box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.55);\n  z-index: 2;\n}\n#wt-picker.wt-hide { display: none; }\n\n#wt-picker-head {\n  display: flex;\n  gap: 6px;\n  padding: 8px;\n  border-bottom: 1px solid rgba(255, 255, 255, 0.07);\n}\n#wt-emoji-search {\n  flex: 1;\n  min-width: 0;\n  background: #23232f;\n  border: 1px solid #33333f;\n  border-radius: 8px;\n  color: #fff;\n  font-size: 13px;\n  padding: 6px 9px;\n  outline: none;\n}\n#wt-emoji-search:focus { border-color: #e53935; }\n#wt-picker-close {\n  background: none;\n  border: none;\n  color: #999;\n  font-size: 16px;\n  cursor: pointer;\n  padding: 0 4px;\n}\n#wt-picker-close:hover { color: #fff; }\n\n#wt-emoji-grid {\n  flex: 1;\n  overflow-y: auto;\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(34px, 1fr));\n  align-content: start;\n  gap: 1px;\n  padding: 6px;\n  scrollbar-width: thin;\n}\n#wt-emoji-grid::-webkit-scrollbar { width: 5px; }\n#wt-emoji-grid::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }\n.wt-emoji {\n  background: none;\n  border: none;\n  border-radius: 7px;\n  font-size: 19px;\n  line-height: 1;\n  padding: 4px 0;\n  cursor: pointer;\n}\n.wt-emoji:hover { background: rgba(255, 255, 255, 0.1); transform: scale(1.2); }\n\n/* floating reactions over the video */\n.wt-float {\n  position: fixed;\n  bottom: -48px;\n  z-index: 2147483646;\n  pointer-events: none;\n  user-select: none;\n  animation-name: wt-float-up;\n  animation-timing-function: ease-out;\n  animation-fill-mode: forwards;\n  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.45));\n}\n@keyframes wt-float-up {\n  0%   { transform: translate(0, 0) scale(0.5) rotate(-8deg); opacity: 0; }\n  8%   { opacity: 1; transform: translate(calc(var(--wt-sway) * -0.15), -6vh) scale(1.2) rotate(6deg); }\n  25%  { transform: translate(var(--wt-sway), -22vh) scale(1.05) rotate(-5deg); }\n  50%  { opacity: 1; transform: translate(calc(var(--wt-sway) * -0.8), -44vh) scale(1.15) rotate(5deg); }\n  75%  { transform: translate(var(--wt-sway), -64vh) scale(1) rotate(-4deg); }\n  100% { transform: translate(calc(var(--wt-sway) * -0.3), -88vh) scale(0.85) rotate(3deg); opacity: 0; }\n}\n\n/* floating reaction name attribution */\n.wt-float-emoji { display: block; }\n.wt-float-name {\n  display: block;\n  font-size: 9px;\n  color: rgba(255, 255, 255, 0.75);\n  text-align: center;\n  margin-top: 2px;\n  font-weight: 500;\n  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);\n}\n\n/* quick-reaction panel (floating outside chat) */\n#wt-quick {\n  position: fixed;\n  left: 50%;\n  right: auto;\n  bottom: 24px;\n  transform: translateX(-50%);\n  z-index: 2147483647;\n  display: none;\n  flex-direction: column;\n  align-items: center;\n  gap: 4px;\n}\n#wt-quick.wt-show { display: flex; }\n\n#wt-quick-bar {\n  display: none;\n  align-items: center;\n  gap: 4px;\n  background: rgba(16, 16, 24, 0.65);\n  backdrop-filter: blur(18px) saturate(1.4);\n  -webkit-backdrop-filter: blur(18px) saturate(1.4);\n  border: 1px solid rgba(255, 255, 255, 0.12);\n  border-radius: 14px;\n  padding: 5px 8px;\n  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);\n  transition: transform 0.22s ease, opacity 0.22s ease, background 0.22s ease, padding 0.22s ease;\n  transform: scale(0.92);\n  opacity: 0.85;\n}\n#wt-quick.wt-show #wt-quick-bar { display: inline-flex; }\n#wt-quick:hover #wt-quick-bar {\n  transform: scale(1);\n  opacity: 1;\n  background: rgba(16, 16, 24, 0.88);\n  padding: 6px 10px;\n}\n\n/* v19: chat input below emoji bar */\n.wt-qtype-form {\n  display: none;\n  width: 100%;\n  box-sizing: border-box;\n}\n#wt-quick.wt-show .wt-qtype-form { display: flex; }\n.wt-qtype-form input {\n  flex: 1;\n  min-width: 0;\n  width: 220px;\n  background: rgba(16, 16, 24, 0.75);\n  backdrop-filter: blur(18px) saturate(1.4);\n  -webkit-backdrop-filter: blur(18px) saturate(1.4);\n  border: 1px solid rgba(255, 255, 255, 0.15);\n  border-radius: 10px;\n  color: #fff;\n  font: 500 14px/1.3 \"Segoe UI\", system-ui, sans-serif;\n  padding: 7px 14px;\n  outline: none;\n  opacity: 1;\n  transition: background 0.22s ease, border-color 0.22s ease;\n}\n#wt-quick:hover .wt-qtype-form input {\n  background: rgba(16, 16, 24, 0.88);\n  border-color: rgba(255, 255, 255, 0.20);\n}\n.wt-qtype-form input::placeholder { color: rgba(255,255,255,0.4); }\n.wt-qtype-form input:focus {\n  border-color: rgba(229, 57, 53, 0.6);\n  background: rgba(16, 16, 24, 0.92);\n}\n\n/* v19: emoji picker attached to quick bar */\n.wt-qtype-picker {\n  display: none;\n  flex-direction: column;\n  width: 280px;\n  max-height: 320px;\n  background: rgba(16, 16, 24, 0.92);\n  backdrop-filter: blur(18px) saturate(1.4);\n  -webkit-backdrop-filter: blur(18px) saturate(1.4);\n  border: 1px solid rgba(255, 255, 255, 0.10);\n  border-radius: 12px;\n  overflow: hidden;\n  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);\n  margin-top: 6px;\n}\n.wt-qtype-picker:not(.wt-hide) { display: flex; }\n.wt-qtype-picker input {\n  background: rgba(255, 255, 255, 0.07);\n  border: 1px solid rgba(255, 255, 255, 0.12);\n  border-radius: 8px;\n  color: #fff;\n  font-size: 13px;\n  padding: 6px 10px;\n  margin: 6px 6px 4px;\n  outline: none;\n}\n.wt-qtype-picker input:focus { border-color: rgba(229, 57, 53, 0.6); }\n#wt-qtype-emoji-grid {\n  flex: 1;\n  overflow-y: auto;\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(32px, 1fr));\n  gap: 2px;\n  padding: 4px 6px 6px;\n}\n\n.wt-quick-emoji {\n  background: none;\n  border: none;\n  border-radius: 7px;\n  font-size: 20px;\n  line-height: 1;\n  padding: 4px 3px;\n  cursor: pointer;\n  transition: transform 0.12s ease, background 0.12s ease;\n}\n.wt-quick-emoji:hover { background: rgba(255, 255, 255, 0.1); transform: scale(1.25); }\n\n.wt-quick-sep {\n  width: 1px;\n  height: 24px;\n  background: rgba(255, 255, 255, 0.10);\n}\n\n.wt-quick-plus {\n  background: none;\n  border: none;\n  border-radius: 7px;\n  font-size: 18px;\n  font-weight: 700;\n  line-height: 1;\n  padding: 4px 6px;\n  cursor: pointer;\n  color: #c8c8dd;\n  transition: color 0.12s ease, background 0.12s ease;\n}\n.wt-quick-plus:hover { color: #fff; background: rgba(255, 255, 255, 0.12); }\n\n/* drag handle + draggable panels */\n.wt-drag-handle {\n  cursor: move;\n  color: #8888a0;\n  font-size: 13px;\n  line-height: 1;\n  padding: 2px 3px;\n  border-radius: 5px;\n  user-select: none;\n  flex: none;\n}\n.wt-drag-handle:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }\n#wt-quick { cursor: default; }\n#wt-quick-bar { cursor: move; }\n#wt-quick-bar .wt-quick-emoji,\n#wt-quick-bar .wt-quick-plus { cursor: pointer; }\n\n/* shared links in chat + clickable now-playing */\n.wt-link {\n  color: #8ab4f8;\n  text-decoration: underline;\n  word-break: break-all;\n}\n.wt-link:hover { color: #aecbfa; }\n#wt-now.wt-show { cursor: pointer; }\n#wt-now.wt-show:hover { color: #cdd8f0; }\n\n/* ---------- direct connect ---------- */\n#wt-linkbar {\n  display: none;\n  align-items: center;\n  gap: 8px;\n  padding: 6px 12px;\n}\n#wt-linkbar.wt-show { display: flex; }\n#wt-link-btn {\n  background: rgba(67, 209, 122, 0.15);\n  border: 1px solid rgba(67, 209, 122, 0.5);\n  color: #43d17a;\n  border-radius: 8px;\n  font-size: 12px;\n  font-weight: 600;\n  padding: 5px 10px;\n  cursor: pointer;\n}\n#wt-link-btn:hover { background: rgba(67, 209, 122, 0.28); }\n#wt-link-hint { font-size: 10.5px; color: #77778c; }\n#wi-lk-body, #wt-lk-body { min-height: 20px; }\n#wt-linkbox {\n  position: absolute;\n  top: 44px; left: 8px; right: 8px;\n  max-height: 300px;\n  overflow-y: auto;\n  background: rgba(14, 14, 22, 0.98);\n  border: 1px solid rgba(255, 255, 255, 0.14);\n  border-radius: 12px;\n  padding: 10px;\n  z-index: 3;\n}\n#wt-linkbox.wt-hide { display: none; }\n.wt-lk-title { font-size: 13px; font-weight: 700; margin-bottom: 8px; }\n#wt-linkbox textarea {\n  width: 100%;\n  box-sizing: border-box;\n  height: 64px;\n  background: #23232f;\n  border: 1px solid #33333f;\n  border-radius: 8px;\n  color: #cde;\n  font-size: 10px;\n  font-family: Consolas, monospace;\n  resize: none;\n  margin: 4px 0;\n  padding: 6px;\n  outline: none;\n}\n#wt-linkbox button {\n  background: #2b2b38;\n  color: #eee;\n  border: none;\n  border-radius: 7px;\n  font-size: 12px;\n  padding: 6px 10px;\n  cursor: pointer;\n  margin: 2px 4px 6px 0;\n}\n#wt-linkbox button:hover { background: #383848; }\n\n/* ---------- v8: glass theme ---------- */\n#wt-root.wt-glass #wt-panel,\n#wt-root.wt-glass #wt-picker,\n#wt-root.wt-glass #wt-linkbox {\n  background: rgba(18, 18, 28, 0.42);\n  backdrop-filter: blur(20px) saturate(170%);\n  -webkit-backdrop-filter: blur(20px) saturate(170%);\n  border: 1px solid rgba(255, 255, 255, 0.16);\n  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.14);\n}\n#wt-root.wt-glass .wt-head { background: rgba(255, 255, 255, 0.07); }\n#wt-root.wt-glass #wt-input,\n#wt-root.wt-glass #wt-emoji-search {\n  background: rgba(255, 255, 255, 0.09);\n  border-color: rgba(255, 255, 255, 0.2);\n}\n#wt-quick.wt-glass #wt-quick-bar {\n  background: rgba(20, 20, 32, 0.4);\n  backdrop-filter: blur(16px) saturate(150%);\n  -webkit-backdrop-filter: blur(16px) saturate(150%);\n  border-color: rgba(255, 255, 255, 0.15);\n}\n#wt-root.wt-glass .wt-statusline { border-bottom-color: rgba(255, 255, 255, 0.08); }\n#wt-root.wt-glass .wt-msg { color: #f3f5ff; }\n#wt-root.wt-glass .wt-float-msg {\n  background: rgba(20, 20, 32, 0.4);\n  backdrop-filter: blur(16px) saturate(150%);\n  -webkit-backdrop-filter: blur(16px) saturate(150%);\n  border-color: rgba(255, 255, 255, 0.15);\n}\n\n#wi-glass-btn, #wt-glass-btn, .wt-quick-glass {\n  background: none;\n  border: none;\n  color: #9aa3b8;\n  font-size: 13px;\n  line-height: 1;\n  padding: 3px 5px;\n  border-radius: 6px;\n  cursor: pointer;\n}\n#wt-glass-btn:hover, .wt-quick-glass:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }\n#wt-glass-btn.wt-on, .wt-quick-glass.wt-on { color: #7fd7ff; text-shadow: 0 0 8px rgba(127, 215, 255, 0.6); }\n\n/* ---------- v10: noise cancellation toggle ---------- */\n#wt-nc-btn {\n  background: none;\n  border: none;\n  color: #9aa3b8;\n  font-size: 13px;\n  line-height: 1;\n  padding: 3px 5px;\n  border-radius: 6px;\n  cursor: pointer;\n}\n#wt-nc-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }\n#wt-nc-btn.wt-on { color: #8ff0a4; text-shadow: 0 0 8px rgba(143, 240, 164, 0.55); }\n\n/* ---------- v11: watch history ---------- */\n#wi-hist-btn, #wt-hist-btn {\n  background: none;\n  border: none;\n  color: #9aa3b8;\n  font-size: 13px;\n  line-height: 1;\n  padding: 3px 5px;\n  border-radius: 6px;\n  cursor: pointer;\n}\n#wt-hist-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }\n#wi-hist-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }\n#wt-hist {\n  flex: 1;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n}\n#wt-hist.wt-hide { display: none !important; }\n#wt-hist-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 4px 8px;\n  font-size: 12px;\n  font-weight: 600;\n  color: #cdd6ea;\n  border-bottom: 1px solid rgba(255, 255, 255, 0.07);\n}\n#wt-hist-back {\n  background: none;\n  border: 1px solid rgba(255, 255, 255, 0.14);\n  color: #9aa3b8;\n  font-size: 11px;\n  padding: 2px 8px;\n  border-radius: 999px;\n  cursor: pointer;\n}\n#wt-hist-back:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }\n#wt-hist-list {\n  flex: 1;\n  min-height: 0;\n  overflow-y: auto;\n  padding: 4px;\n}\n.wt-hist-row {\n  padding: 7px 8px;\n  margin: 3px 2px;\n  border-radius: 10px;\n  background: rgba(255, 255, 255, 0.045);\n  cursor: pointer;\n  transition: background 0.15s ease;\n}\n.wt-hist-row:hover { background: rgba(255, 255, 255, 0.1); }\n.wt-hist-title {\n  font-size: 12px;\n  font-weight: 600;\n  color: #eef2fb;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.wt-hist-meta {\n  margin-top: 2px;\n  font-size: 10.5px;\n  opacity: 0.62;\n  color: #cdd6ea;\n}\n.wt-hist-empty {\n  padding: 14px 10px;\n  font-size: 12px;\n  opacity: 0.65;\n  text-align: center;\n}\n\n/* ---------- v8: panel open/close animation + pill micro-shrink ---------- */\n@keyframes wt-panel-in {\n  from { opacity: 0; transform: translateY(12px) scale(0.95); }\n  to   { opacity: 1; transform: translateY(0) scale(1); }\n}\n@keyframes wt-panel-out {\n  from { opacity: 1; transform: translateY(0) scale(1); }\n  to   { opacity: 0; transform: translateY(10px) scale(0.95); }\n}\n#wt-root.wt-open #wt-panel { animation: wt-panel-in 0.18s ease-out; }\n#wt-root.wt-shut #wt-panel { animation: wt-panel-out 0.14s ease-in forwards; }\n#wt-pill { transition: transform 0.18s ease; }\n#wt-root.wt-open #wt-pill { transform: scale(0.93); opacity: 0.85; }\n\n/* ---------- v8: quick tray idle shrink ---------- */\n#wt-quick.wt-idle #wt-quick-bar { transform: scale(0.80); opacity: 0.55; }\n#wt-quick.wt-idle:hover #wt-quick-bar { transform: scale(1); opacity: 1; }\n\n/* version badge */\n.wt-head #wt-ver{font-size:10px;opacity:.55;margin-left:2px;font-weight:600}\n\n/* v12: tap-to-enable voice pill (autoplay-blocked remote audio) */\n#wt-voice-pill {\n  position: fixed;\n  left: 50%;\n  bottom: 84px;\n  transform: translateX(-50%);\n  z-index: 2147483600;\n  background: #1f6feb;\n  color: #fff;\n  font: 600 13px/1 system-ui, sans-serif;\n  padding: 10px 16px;\n  border-radius: 999px;\n  cursor: pointer;\n  box-shadow: 0 4px 14px rgba(0,0,0,.45);\n  user-select: none;\n}\n\n/* ---------- v15: center-screen playback action overlay ---------- */\n.wt-action-overlay {\n  position: fixed;\n  left: 50%;\n  top: 50%;\n  transform: translate(-50%, -50%);\n  z-index: 2147483645;\n  background: rgba(0, 0, 0, 0.72);\n  backdrop-filter: blur(6px);\n  -webkit-backdrop-filter: blur(6px);\n  color: #fff;\n  font: 600 18px/1.35 \"Segoe UI\", system-ui, sans-serif;\n  padding: 12px 24px;\n  border-radius: 14px;\n  pointer-events: none;\n  user-select: none;\n  white-space: nowrap;\n  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);\n  animation: wt-action-fade 2.6s ease forwards;\n}\n@keyframes wt-action-fade {\n  0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }\n  8%   { opacity: 1; transform: translate(-50%, -50%) scale(1); }\n  78%  { opacity: 1; transform: translate(-50%, -50%) scale(1); }\n  100% { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }\n}\n\n/* ---------- v16/v20: floating chat notification ---------- */\n#wt-float-msgs {\n  position: fixed;\n  bottom: 35vh;\n  left: 50%;\n  transform: translateX(-50%);\n  z-index: 2147483646;\n  display: flex;\n  flex-direction: column-reverse;\n  align-items: center;\n  gap: 8px;\n  pointer-events: none;\n}\n.wt-float-msg {\n  max-width: 420px;\n  background: rgba(16, 16, 24, 0.65);\n  backdrop-filter: blur(18px) saturate(1.4);\n  -webkit-backdrop-filter: blur(18px) saturate(1.4);\n  border: 1px solid rgba(255, 255, 255, 0.12);\n  color: #eee;\n  padding: 10px 18px;\n  border-radius: 14px;\n  font: 500 14px/1.4 \"Segoe UI\", system-ui, sans-serif;\n  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);\n  pointer-events: auto;\n  cursor: pointer;\n  animation: wt-float-in 4.5s ease forwards;\n}\n.wt-float-msg .wt-float-from {\n  color: #8ab4f8;\n  font-weight: 700;\n  margin-right: 6px;\n}\n.wt-float-msg .wt-float-self .wt-float-from {\n  color: #43d17a;\n}\n.wt-float-msg.wt-float-self {\n  border-color: rgba(67, 209, 122, 0.25);\n}\n@keyframes wt-float-in {\n  0%   { opacity: 0; transform: scale(0.92); }\n  10%  { opacity: 1; transform: scale(1); }\n  82%  { opacity: 1; transform: scale(1); }\n  100% { opacity: 0; transform: scale(0.92); }\n}\n\n/* ---------- v17: quick-type overlay (T or / to chat) ---------- */\n#wt-qtype {\n  position: fixed;\n  inset: 0;\n  z-index: 2147483646;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: rgba(0, 0, 0, 0.35);\n  backdrop-filter: blur(3px);\n  -webkit-backdrop-filter: blur(3px);\n  animation: wt-qtype-in 0.18s ease;\n}\n#wt-qtype.wt-hide { display: none; }\n@keyframes wt-qtype-in {\n  from { opacity: 0; }\n  to   { opacity: 1; }\n}\n#wt-qtype-bar {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  width: min(480px, 88vw);\n  background: rgba(18, 18, 28, 0.94);\n  backdrop-filter: blur(14px);\n  -webkit-backdrop-filter: blur(14px);\n  border: 1px solid rgba(255, 255, 255, 0.14);\n  border-radius: 14px;\n  padding: 10px 16px;\n  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);\n  animation: wt-qtype-bar-in 0.22s ease;\n}\n@keyframes wt-qtype-bar-in {\n  from { opacity: 0; transform: translateY(12px) scale(0.97); }\n  to   { opacity: 1; transform: translateY(0) scale(1); }\n}\n#wt-qtype-icon {\n  font-size: 20px;\n  flex: none;\n  opacity: 0.7;\n}\n#wt-qtype-input {\n  flex: 1;\n  background: none;\n  border: none;\n  outline: none;\n  color: #eee;\n  font: 500 15px/1.35 \"Segoe UI\", system-ui, sans-serif;\n  caret-color: #8ab4f8;\n}\n#wt-qtype-input::placeholder { color: #666680; }\n#wt-qtype-hint {\n  font-size: 11px;\n  color: #555570;\n  flex: none;\n  white-space: nowrap;\n}\n#wt-root.wt-glass #wt-qtype-bar {\n  background: rgba(20, 20, 32, 0.45);\n  border-color: rgba(255, 255, 255, 0.18);\n}\n\n/* ---------- v31: banners (buffering wait, follow the friend) ---------- */\n#wt-banners {\n  position: fixed;\n  top: 18px;\n  left: 50%;\n  transform: translateX(-50%);\n  z-index: 2147483646;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 8px;\n  pointer-events: none;\n  max-width: calc(100vw - 32px);\n}\n.wt-banner {\n  pointer-events: auto;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 9px 12px 9px 16px;\n  border-radius: 14px;\n  background: rgba(16, 16, 24, 0.82);\n  backdrop-filter: blur(14px) saturate(1.4);\n  -webkit-backdrop-filter: blur(14px) saturate(1.4);\n  border: 1px solid rgba(255, 255, 255, 0.14);\n  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);\n  color: #fff;\n  font: 600 13.5px/1.35 \"Segoe UI\", system-ui, sans-serif;\n  animation: wt-banner-in 0.2s ease-out;\n}\n.wt-banner-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60vw; }\n.wt-banner-btn {\n  flex: none;\n  border: none;\n  border-radius: 999px;\n  padding: 5px 12px;\n  background: rgba(255, 255, 255, 0.14);\n  color: #fff;\n  font: 600 12.5px \"Segoe UI\", system-ui, sans-serif;\n  cursor: pointer;\n}\n.wt-banner-btn:first-of-type { background: #e53935; }\n.wt-banner-btn:hover { filter: brightness(1.15); }\n@keyframes wt-banner-in {\n  from { opacity: 0; transform: translateY(-8px); }\n  to   { opacity: 1; transform: translateY(0); }\n}\n\n/* ---------- v31: friend is talking ---------- */\n#wt-voice-wrap.wt-talking { color: #43d17a; text-shadow: 0 0 8px rgba(67, 209, 122, 0.8); }\n#wt-pill.wt-talking { box-shadow: 0 0 0 3px rgba(67, 209, 122, 0.75), 0 4px 14px rgba(0, 0, 0, 0.45); }\n\n/* ---------- v31: chat lines restored after a page load ---------- */\n.wt-restored { opacity: 0.6; }\n\n/* ---------- v33: AI scene trivia ---------- */\n.wt-trivia {\n  position: fixed;\n  top: 22vh;\n  z-index: 2147483645;\n  width: min(340px, 34vw);\n  padding: 10px 12px 12px;\n  border-radius: 14px;\n  background: rgba(16, 16, 24, 0.78);\n  backdrop-filter: blur(14px) saturate(1.4);\n  -webkit-backdrop-filter: blur(14px) saturate(1.4);\n  border: 1px solid rgba(255, 255, 255, 0.14);\n  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);\n  color: #fff;\n  font: 13.5px/1.45 \"Segoe UI\", system-ui, sans-serif;\n  animation: wt-trivia-in 0.35s ease-out;\n  pointer-events: auto;\n}\n.wt-trivia-left { left: 24px; }\n.wt-trivia-right { right: 24px; }\n.wt-trivia-head {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 11.5px;\n  font-weight: 700;\n  letter-spacing: 0.3px;\n  color: #ffd54f;\n  margin-bottom: 4px;\n}\n.wt-trivia-x {\n  margin-left: auto;\n  border: none;\n  background: none;\n  color: rgba(255, 255, 255, 0.6);\n  font-size: 16px;\n  line-height: 1;\n  cursor: pointer;\n  padding: 0 2px;\n}\n.wt-trivia-x:hover { color: #fff; }\n.wt-trivia-out { animation: wt-trivia-out 0.6s ease-in forwards; }\n@keyframes wt-trivia-in { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: none; } }\n@keyframes wt-trivia-out { to { opacity: 0; transform: translateY(-6px); } }\n#wt-trivia-btn { background: none; border: none; color: #9aa3b8; font-size: 13px; line-height: 1; padding: 3px 5px; border-radius: 6px; cursor: pointer; opacity: 0.45; }\n#wt-trivia-btn:hover { background: rgba(255, 255, 255, 0.1); }\n#wt-trivia-btn.wt-on { opacity: 1; }\n\n/* v33: one more header button - keep the header on one line, code fully visible */\n.wt-head { gap: 4px; padding: 10px 10px; }\n.wt-head .wt-title { display: none; } /* the pill above already says Watch Together */\n.wt-head #wt-ver { margin-right: auto; }\n.wt-head #wt-ver { flex: none; }\n.wt-head button { flex: none; }\n.wt-head #wt-code { letter-spacing: 1px; }\n\n/* v37: phones (the iPhone build) - everything fits the screen */\n@media (max-height: 500px) and (orientation: landscape) {\n  #wt-root { right: calc(10px + env(safe-area-inset-right)); bottom: calc(8px + env(safe-area-inset-bottom)); gap: 6px; }\n  #wt-pill { padding: 6px 12px; font-size: 12px; }\n  #wt-panel { width: 290px; height: calc(100vh - 60px); max-height: 400px; }\n  .wt-trivia { top: 10vh; width: min(320px, 38vw); font-size: 12.5px; }\n}\n@media (max-width: 520px) and (orientation: portrait) {\n  #wt-root { right: calc(10px + env(safe-area-inset-right)); bottom: calc(10px + env(safe-area-inset-bottom)); }\n  #wt-panel { width: min(320px, calc(100vw - 20px)); height: min(400px, 50vh); }\n  .wt-trivia { top: 10vh; width: calc(100vw - 32px); box-sizing: border-box; }\n  .wt-trivia-left, .wt-trivia-right { left: 16px; right: auto; }\n}\n\n/* iPhone build: keep the player's controls free */\n#wt-pill, #wt-quick { display: none !important; }\n/* full screen that works on iPhone: the player box stretched over the screen */\n/* the page stays scrollable so one swipe up hides Safari's bar */\nhtml.wt-ios-fs body { min-height: calc(100vh + 160px) !important; }\n.wt-ios-fsanc { transform: none !important; filter: none !important; contain: none !important; will-change: auto !important; overflow: visible !important; }\n.wt-ios-fsbox { position: fixed !important; inset: 0 !important; left: 0 !important; top: 0 !important; width: 100vw !important; height: 100vh !important; height: 100dvh !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important; z-index: 2147483000 !important; background: #000 !important; transform: none !important; }\n.wt-ios-fsvid { position: fixed !important; inset: 0 !important; left: 0 !important; top: 0 !important; width: 100vw !important; height: 100vh !important; height: 100dvh !important; max-width: none !important; max-height: none !important; z-index: 2147483001 !important; object-fit: contain !important; background: #000 !important; transform: none !important; }\n.wt-ios-fsbox video { width: 100% !important; height: 100% !important; max-height: none !important; object-fit: contain !important; }\n"; (document.head || document.documentElement).appendChild(st); })();
// ---- background (V39-autoupdate/background.src.js, bundled) ----
(()=>{var Uf=Object.create;var tu=Object.defineProperty;var Hf=Object.getOwnPropertyDescriptor;var Wf=Object.getOwnPropertyNames;var jf=Object.getPrototypeOf,Kf=Object.prototype.hasOwnProperty;var Ln=(t,i,e)=>()=>{if(e)throw e[0];try{return t&&(i=t(t=0)),i}catch(r){throw e=[r],r}};var Zo=(t,i)=>()=>{try{return i||t((i={exports:{}}).exports,i),i.exports}catch(e){throw i=0,e}},np=(t,i)=>{for(var e in i)tu(t,e,{get:i[e],enumerable:!0})},Df=(t,i,e,r)=>{if(i&&typeof i=="object"||typeof i=="function")for(let n of Wf(i))!Kf.call(t,n)&&n!==e&&tu(t,n,{get:()=>i[n],enumerable:!(r=Hf(i,n))||r.enumerable});return t};var Gf=(t,i,e)=>(e=t!=null?Uf(jf(t)):{},Df(i||!t||!t.__esModule?tu(e,"default",{value:t,enumerable:!0}):e,t));function we(t){return typeof t=="object"&&t!==null&&("name"in t&&t.name==="AbortError"||"message"in t&&String(t.message).includes("FetchRequestCanceledException"))}var dt,pt=Ln(()=>{dt=t=>{if(t instanceof Error)return t;if(typeof t=="object"&&t!==null){try{let i=Object.prototype.toString.call(t);if(i==="[object Error]"||i==="[object DOMException]"){let e=new Error(t.message,t.cause?{cause:t.cause}:{});return t.stack&&(e.stack=t.stack),t.cause&&!e.cause&&(e.cause=t.cause),t.name&&(e.name=t.name),e}}catch{}try{return new Error(JSON.stringify(t))}catch{}}return new Error(t)}});var E,$,ie,rt,$n,sp,P,ru,tr,D,ae,iu,pe,Fn,Un,nu,Nt,su,ou,Ot,au,ht,cu,Hn,Vf,z=Ln(()=>{pt();E=(()=>{class t extends Error{constructor(e,r){super(e,r),Object.defineProperty(this,"name",{value:new.target._errorName,writable:!0,configurable:!0})}}return t._errorName="AnthropicError",t})(),$=(()=>{class t extends E{constructor(e,r,n,s,o){super(`${t.makeMessage(e,r,n)}`),this.status=e,this.headers=s,this.requestID=s?.get("request-id"),this.workspaceID=s?.get("anthropic-workspace-id"),this.error=r;let l=r??{};this.apiMessage=l.error?.message??null,this.type=o??l.error?.type??null;let p=l.error?.details?.error_code;this.errorCode=typeof p=="string"?p:null,this.details=l.error?.details??null}static makeMessage(e,r,n){let s=r?.message?typeof r.message=="string"?r.message:JSON.stringify(r.message):r?JSON.stringify(r):n;return e&&s?`${e} ${s}`:e?`${e} status code (no body)`:s||"(no status code or body)"}static generate(e,r,n,s){if(!e||!s)return new rt({message:n,cause:dt(r)});let o=r,l=Vf.get(e);return l?new l(e,o,n,s):e>=500?new Ot(e,o,n,s):new t(e,o,n,s)}}return t._errorName="APIError",t})(),ie=(()=>{class t extends ${constructor({message:e}={}){super(void 0,void 0,e||"Request was aborted.",void 0)}}return t._errorName="APIUserAbortError",t})(),rt=(()=>{class t extends ${constructor({message:e,cause:r}){super(void 0,void 0,e||"Connection error.",void 0),r&&(this.cause=r)}}return t._errorName="APIConnectionError",t})(),$n=(()=>{class t extends rt{constructor({message:e}={}){super({message:e??"Request timed out."})}}return t._errorName="APIConnectionTimeoutError",t})(),sp=(()=>{class t extends E{constructor(e,{cause:r}={}){super(e??"Retryable error."),r!==void 0&&(this.cause=r)}}return t._errorName="RetryableError",t})(),P=(()=>{class t extends ${}return t._errorName="BadRequestError",t})(),ru=(()=>{class t extends ${}return t._errorName="AuthenticationError",t})(),tr=(()=>{class t extends ${}return t._errorName="PaymentRequiredError",t})(),D=(()=>{class t extends ${}return t._errorName="PermissionDeniedError",t})(),ae=(()=>{class t extends ${}return t._errorName="NotFoundError",t})(),iu=(()=>{class t extends ${}return t._errorName="RequestTimeoutError",t})(),pe=(()=>{class t extends ${}return t._errorName="ConflictError",t})(),Fn=(()=>{class t extends ${}return t._errorName="PreconditionFailedError",t})(),Un=(()=>{class t extends ${}return t._errorName="ContentTooLargeError",t})(),nu=(()=>{class t extends ${}return t._errorName="UnprocessableEntityError",t})(),Nt=(()=>{class t extends ${}return t._errorName="RateLimitError",t})(),su=(()=>{class t extends ${}return t._errorName="RequestHeaderFieldsTooLargeError",t})(),ou=(()=>{class t extends ${}return t._errorName="ClientClosedRequestError",t})(),Ot=(()=>{class t extends ${}return t._errorName="InternalServerError",t})(),au=(()=>{class t extends Ot{}return t._errorName="NotImplementedError",t})(),ht=(()=>{class t extends Ot{}return t._errorName="ServiceUnavailableError",t})(),cu=(()=>{class t extends Ot{}return t._errorName="GatewayTimeoutError",t})(),Hn=(()=>{class t extends Ot{}return t._errorName="OverloadedError",t})(),Vf=new Map([[400,P],[401,ru],[402,tr],[403,D],[404,ae],[408,iu],[409,pe],[412,Fn],[413,Un],[422,nu],[429,Nt],[431,su],[499,ou],[501,au],[503,ht],[504,cu],[529,Hn]])});var jh=Zo(Pe=>{"use strict";var pg=Pe&&Pe.__extends||(function(){var t=function(i,e){return t=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(r,n){r.__proto__=n}||function(r,n){for(var s in n)n.hasOwnProperty(s)&&(r[s]=n[s])},t(i,e)};return function(i,e){t(i,e);function r(){this.constructor=i}i.prototype=e===null?Object.create(e):(r.prototype=e.prototype,new r)}})();Object.defineProperty(Pe,"__esModule",{value:!0});var te=256,Du=(function(){function t(i){i===void 0&&(i="="),this._paddingCharacter=i}return t.prototype.encodedLength=function(i){return this._paddingCharacter?(i+2)/3*4|0:(i*8+5)/6|0},t.prototype.encode=function(i){for(var e="",r=0;r<i.length-2;r+=3){var n=i[r]<<16|i[r+1]<<8|i[r+2];e+=this._encodeByte(n>>>18&63),e+=this._encodeByte(n>>>12&63),e+=this._encodeByte(n>>>6&63),e+=this._encodeByte(n>>>0&63)}var s=i.length-r;if(s>0){var n=i[r]<<16|(s===2?i[r+1]<<8:0);e+=this._encodeByte(n>>>18&63),e+=this._encodeByte(n>>>12&63),s===2?e+=this._encodeByte(n>>>6&63):e+=this._paddingCharacter||"",e+=this._paddingCharacter||""}return e},t.prototype.maxDecodedLength=function(i){return this._paddingCharacter?i/4*3|0:(i*6+7)/8|0},t.prototype.decodedLength=function(i){return this.maxDecodedLength(i.length-this._getPaddingLength(i))},t.prototype.decode=function(i){if(i.length===0)return new Uint8Array(0);for(var e=this._getPaddingLength(i),r=i.length-e,n=new Uint8Array(this.maxDecodedLength(r)),s=0,o=0,l=0,p=0,_=0,m=0,h=0;o<r-4;o+=4)p=this._decodeChar(i.charCodeAt(o+0)),_=this._decodeChar(i.charCodeAt(o+1)),m=this._decodeChar(i.charCodeAt(o+2)),h=this._decodeChar(i.charCodeAt(o+3)),n[s++]=p<<2|_>>>4,n[s++]=_<<4|m>>>2,n[s++]=m<<6|h,l|=p&te,l|=_&te,l|=m&te,l|=h&te;if(o<r-1&&(p=this._decodeChar(i.charCodeAt(o)),_=this._decodeChar(i.charCodeAt(o+1)),n[s++]=p<<2|_>>>4,l|=p&te,l|=_&te),o<r-2&&(m=this._decodeChar(i.charCodeAt(o+2)),n[s++]=_<<4|m>>>2,l|=m&te),o<r-3&&(h=this._decodeChar(i.charCodeAt(o+3)),n[s++]=m<<6|h,l|=h&te),l!==0)throw new Error("Base64Coder: incorrect characters for decoding");return n},t.prototype._encodeByte=function(i){var e=i;return e+=65,e+=25-i>>>8&6,e+=51-i>>>8&-75,e+=61-i>>>8&-15,e+=62-i>>>8&3,String.fromCharCode(e)},t.prototype._decodeChar=function(i){var e=te;return e+=(42-i&i-44)>>>8&-te+i-43+62,e+=(46-i&i-48)>>>8&-te+i-47+63,e+=(47-i&i-58)>>>8&-te+i-48+52,e+=(64-i&i-91)>>>8&-te+i-65+0,e+=(96-i&i-123)>>>8&-te+i-97+26,e},t.prototype._getPaddingLength=function(i){var e=0;if(this._paddingCharacter){for(var r=i.length-1;r>=0&&i[r]===this._paddingCharacter;r--)e++;if(i.length<4||e>2)throw new Error("Base64Coder: incorrect padding")}return e},t})();Pe.Coder=Du;var us=new Du;function hg(t){return us.encode(t)}Pe.encode=hg;function _g(t){return us.decode(t)}Pe.decode=_g;var Hh=(function(t){pg(i,t);function i(){return t!==null&&t.apply(this,arguments)||this}return i.prototype._encodeByte=function(e){var r=e;return r+=65,r+=25-e>>>8&6,r+=51-e>>>8&-75,r+=61-e>>>8&-13,r+=62-e>>>8&49,String.fromCharCode(r)},i.prototype._decodeChar=function(e){var r=te;return r+=(44-e&e-46)>>>8&-te+e-45+62,r+=(94-e&e-96)>>>8&-te+e-95+63,r+=(47-e&e-58)>>>8&-te+e-48+52,r+=(64-e&e-91)>>>8&-te+e-65+0,r+=(96-e&e-123)>>>8&-te+e-97+26,r},i})(Du);Pe.URLSafeCoder=Hh;var Wh=new Hh;function fg(t){return Wh.encode(t)}Pe.encodeURLSafe=fg;function mg(t){return Wh.decode(t)}Pe.decodeURLSafe=mg;Pe.encodedLength=function(t){return us.encodedLength(t)};Pe.maxDecodedLength=function(t){return us.maxDecodedLength(t)};Pe.decodedLength=function(t){return us.decodedLength(t)}});var Dh=Zo((Kh,ec)=>{(function(t,i){var e={};i(e);var r=e.default;for(var n in e)r[n]=e[n];typeof ec=="object"&&typeof ec.exports=="object"?ec.exports=r:typeof define=="function"&&define.amd?define(function(){return r}):t.sha256=r})(Kh,function(t){"use strict";t.__esModule=!0,t.digestLength=32,t.blockSize=64;var i=new Uint32Array([1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298]);function e(h,g,y,w,k){for(var S,R,A,C,T,x,B,L,U,W,Q,Ce,zt;k>=64;){for(S=g[0],R=g[1],A=g[2],C=g[3],T=g[4],x=g[5],B=g[6],L=g[7],W=0;W<16;W++)Q=w+W*4,h[W]=(y[Q]&255)<<24|(y[Q+1]&255)<<16|(y[Q+2]&255)<<8|y[Q+3]&255;for(W=16;W<64;W++)U=h[W-2],Ce=(U>>>17|U<<15)^(U>>>19|U<<13)^U>>>10,U=h[W-15],zt=(U>>>7|U<<25)^(U>>>18|U<<14)^U>>>3,h[W]=(Ce+h[W-7]|0)+(zt+h[W-16]|0);for(W=0;W<64;W++)Ce=(((T>>>6|T<<26)^(T>>>11|T<<21)^(T>>>25|T<<7))+(T&x^~T&B)|0)+(L+(i[W]+h[W]|0)|0)|0,zt=((S>>>2|S<<30)^(S>>>13|S<<19)^(S>>>22|S<<10))+(S&R^S&A^R&A)|0,L=B,B=x,x=T,T=C+Ce|0,C=A,A=R,R=S,S=Ce+zt|0;g[0]+=S,g[1]+=R,g[2]+=A,g[3]+=C,g[4]+=T,g[5]+=x,g[6]+=B,g[7]+=L,w+=64,k-=64}return w}var r=(function(){function h(){this.digestLength=t.digestLength,this.blockSize=t.blockSize,this.state=new Int32Array(8),this.temp=new Int32Array(64),this.buffer=new Uint8Array(128),this.bufferLength=0,this.bytesHashed=0,this.finished=!1,this.reset()}return h.prototype.reset=function(){return this.state[0]=1779033703,this.state[1]=3144134277,this.state[2]=1013904242,this.state[3]=2773480762,this.state[4]=1359893119,this.state[5]=2600822924,this.state[6]=528734635,this.state[7]=1541459225,this.bufferLength=0,this.bytesHashed=0,this.finished=!1,this},h.prototype.clean=function(){for(var g=0;g<this.buffer.length;g++)this.buffer[g]=0;for(var g=0;g<this.temp.length;g++)this.temp[g]=0;this.reset()},h.prototype.update=function(g,y){if(y===void 0&&(y=g.length),this.finished)throw new Error("SHA256: can't update because hash was finished.");var w=0;if(this.bytesHashed+=y,this.bufferLength>0){for(;this.bufferLength<64&&y>0;)this.buffer[this.bufferLength++]=g[w++],y--;this.bufferLength===64&&(e(this.temp,this.state,this.buffer,0,64),this.bufferLength=0)}for(y>=64&&(w=e(this.temp,this.state,g,w,y),y%=64);y>0;)this.buffer[this.bufferLength++]=g[w++],y--;return this},h.prototype.finish=function(g){if(!this.finished){var y=this.bytesHashed,w=this.bufferLength,k=y/536870912|0,S=y<<3,R=y%64<56?64:128;this.buffer[w]=128;for(var A=w+1;A<R-8;A++)this.buffer[A]=0;this.buffer[R-8]=k>>>24&255,this.buffer[R-7]=k>>>16&255,this.buffer[R-6]=k>>>8&255,this.buffer[R-5]=k>>>0&255,this.buffer[R-4]=S>>>24&255,this.buffer[R-3]=S>>>16&255,this.buffer[R-2]=S>>>8&255,this.buffer[R-1]=S>>>0&255,e(this.temp,this.state,this.buffer,0,R),this.finished=!0}for(var A=0;A<8;A++)g[A*4+0]=this.state[A]>>>24&255,g[A*4+1]=this.state[A]>>>16&255,g[A*4+2]=this.state[A]>>>8&255,g[A*4+3]=this.state[A]>>>0&255;return this},h.prototype.digest=function(){var g=new Uint8Array(this.digestLength);return this.finish(g),g},h.prototype._saveState=function(g){for(var y=0;y<this.state.length;y++)g[y]=this.state[y]},h.prototype._restoreState=function(g,y){for(var w=0;w<this.state.length;w++)this.state[w]=g[w];this.bytesHashed=y,this.finished=!1,this.bufferLength=0},h})();t.Hash=r;var n=(function(){function h(g){this.inner=new r,this.outer=new r,this.blockSize=this.inner.blockSize,this.digestLength=this.inner.digestLength;var y=new Uint8Array(this.blockSize);if(g.length>this.blockSize)new r().update(g).finish(y).clean();else for(var w=0;w<g.length;w++)y[w]=g[w];for(var w=0;w<y.length;w++)y[w]^=54;this.inner.update(y);for(var w=0;w<y.length;w++)y[w]^=106;this.outer.update(y),this.istate=new Uint32Array(8),this.ostate=new Uint32Array(8),this.inner._saveState(this.istate),this.outer._saveState(this.ostate);for(var w=0;w<y.length;w++)y[w]=0}return h.prototype.reset=function(){return this.inner._restoreState(this.istate,this.inner.blockSize),this.outer._restoreState(this.ostate,this.outer.blockSize),this},h.prototype.clean=function(){for(var g=0;g<this.istate.length;g++)this.ostate[g]=this.istate[g]=0;this.inner.clean(),this.outer.clean()},h.prototype.update=function(g){return this.inner.update(g),this},h.prototype.finish=function(g){return this.outer.finished?this.outer.finish(g):(this.inner.finish(g),this.outer.update(g,this.digestLength).finish(g)),this},h.prototype.digest=function(){var g=new Uint8Array(this.digestLength);return this.finish(g),g},h})();t.HMAC=n;function s(h){var g=new r().update(h),y=g.digest();return g.clean(),y}t.hash=s,t.default=s;function o(h,g){var y=new n(h).update(g),w=y.digest();return y.clean(),w}t.hmac=o;function l(h,g,y,w){var k=w[0];if(k===0)throw new Error("hkdf: cannot expand more");g.reset(),k>1&&g.update(h),y&&g.update(y),g.update(w),g.finish(h),w[0]++}var p=new Uint8Array(t.digestLength);function _(h,g,y,w){g===void 0&&(g=p),w===void 0&&(w=32);for(var k=new Uint8Array([1]),S=o(g,h),R=new n(S),A=new Uint8Array(R.digestLength),C=A.length,T=new Uint8Array(w),x=0;x<w;x++)C===A.length&&(l(A,R,y,k),C=0),T[x]=A[C++];return R.clean(),A.fill(0),k.fill(0),T}t.hkdf=_;function m(h,g,y,w){for(var k=new n(h),S=k.digestLength,R=new Uint8Array(4),A=new Uint8Array(S),C=new Uint8Array(S),T=new Uint8Array(w),x=0;x*S<w;x++){var B=x+1;R[0]=B>>>24&255,R[1]=B>>>16&255,R[2]=B>>>8&255,R[3]=B>>>0&255,k.reset(),k.update(g),k.update(R),k.finish(C);for(var L=0;L<S;L++)A[L]=C[L];for(var L=2;L<=y;L++){k.reset(),k.update(C).finish(C);for(var U=0;U<S;U++)A[U]^=C[U]}for(var L=0;L<S&&x*S+L<w;L++)T[x*S+L]=A[L]}for(var x=0;x<S;x++)A[x]=C[x]=0;for(var x=0;x<4;x++)R[x]=0;return k.clean(),T}t.pbkdf2=m})});var Vh=Zo(Gu=>{"use strict";Object.defineProperty(Gu,"__esModule",{value:!0});Gu.timingSafeEqual=gg;function Gh(t,i=""){if(!t)throw new Error(i)}function gg(t,i){if(t.byteLength!==i.byteLength)return!1;t instanceof DataView||(t=new DataView(ArrayBuffer.isView(t)?t.buffer:t)),i instanceof DataView||(i=new DataView(ArrayBuffer.isView(i)?i.buffer:i)),Gh(t instanceof DataView),Gh(i instanceof DataView);let e=t.byteLength,r=0,n=-1;for(;++n<e;)r|=t.getUint8(n)^i.getUint8(n);return r===0}});var Xh=Zo(br=>{"use strict";Object.defineProperty(br,"__esModule",{value:!0});br.Webhook=br.WebhookVerificationError=void 0;var Vu=jh(),Ju=Dh(),Jh=Vh(),Yh=300,Yu=class t extends Error{constructor(i){super(i),Object.setPrototypeOf(this,t.prototype),this.name="ExtendableError",this.stack=new Error(i).stack}},Ke=class t extends Yu{constructor(i){super(i),Object.setPrototypeOf(this,t.prototype),this.name="WebhookVerificationError"}};br.WebhookVerificationError=Ke;function Qh(t){if(typeof t=="string")return new TextEncoder().encode(t);if(ArrayBuffer.isView(t)&&t.BYTES_PER_ELEMENT===1)return new Uint8Array(t.buffer,t.byteOffset,t.byteLength);throw new Error("Expected payload to be of type string, Buffer or Uint8Array.")}var tc=class t{constructor(i,e){if(e?.format==="raw")i instanceof Uint8Array?this.key=i:this.key=Uint8Array.from(i,r=>r.charCodeAt(0));else{if(typeof i!="string")throw new Error("Expected secret to be of type string");i.startsWith(t.prefix)&&(i=i.substring(t.prefix.length)),this.key=Vu.decode(i)}if(this.key.length===0)throw new Error("Secret can't be empty.")}verify(i,e,r){var n;let s=(n=r?.jsonParse)!==null&&n!==void 0?n:!0,o={};for(let k of Object.keys(e))o[k.toLowerCase()]=e[k];let l=o["webhook-id"],p=o["webhook-signature"],_=o["webhook-timestamp"];if(!p||!l||!_)throw new Ke("Missing required headers");let m=this.verifyTimestamp(_),h=Qh(i),g=new globalThis.TextEncoder,y=g.encode(this.sign(l,m,h));if(!p.split(" ").some(k=>(0,Jh.timingSafeEqual)(g.encode(k),y)))throw new Ke("No matching signature found");if(h.length!==0&&s)return JSON.parse(typeof i=="string"?i:new TextDecoder().decode(h))}sign(i,e,r){let n=Qh(r),s=Math.floor(e.getTime()/1e3),o=new TextEncoder().encode(`${i}.${s}.`),l=new Uint8Array(o.length+n.length);return l.set(o),l.set(n,o.length),`v1,${Vu.encode(Ju.hmac(this.key,l))}`}endpointVerificationResponse(i){let e=new TextEncoder,r=Ju.hmac(this.key,e.encode("wev-v1"));return`v1,${Vu.encode(Ju.hmac(r,e.encode(i)))}`}verifyEndpointVerificationResponse(i,e){if(!e)throw new Ke("Missing challenge response");let r=new globalThis.TextEncoder,n=r.encode(this.endpointVerificationResponse(i));if(!(0,Jh.timingSafeEqual)(r.encode(e),n))throw new Ke("No matching signature found")}verifyTimestamp(i){let e=Math.floor(Date.now()/1e3),r=parseInt(i,10);if(Number.isNaN(r))throw new Ke("Invalid Signature Headers");if(e-r>Yh)throw new Ke("Message timestamp too old");if(r>e+Yh)throw new Ke("Message timestamp too new");return new Date(r*1e3)}};br.Webhook=tc;tc.prefix="whsec_"});function b_(t,i){if(!(t>=Ac))throw new E(`${i} must be at least ${Ac}ms (got ${t}); to run without memory sync, pass \`memorySyncIntervalMs: null\` to the worker instead`)}var g_,Ac,td=Ln(()=>{z();g_=15e3,Ac=5e3});var y_={};np(y_,{BashSession:()=>id,BashTimeoutError:()=>Zg,DEFAULT_MEMORY_SYNC_INTERVAL_MS:()=>g_,MARKER_PATH:()=>Gg,MEMORY_FLUSH_TIMEOUT_MS:()=>Dg,MIN_MEMORY_SYNC_INTERVAL_MS:()=>Ac,SessionMemoryError:()=>Vg,SessionMemoryStores:()=>rd,betaAgentToolset20260401:()=>Qg,betaBashTool:()=>eb,betaEditTool:()=>ib,betaGlobTool:()=>nb,betaGrepTool:()=>sb,betaReadTool:()=>tb,betaWriteTool:()=>rb,extractSkillArchive:()=>Yg,resolvePath:()=>Xg,setupSkills:()=>Jg});function G(t){throw new E(`${t} requires Node.js or a Node-compatible runtime`)}function Jg(t){return G("setupSkills")}function Yg(t,i){return G("extractSkillArchive")}function Qg(t){return G("betaAgentToolset20260401")}function Xg(t,i){return G("resolvePath")}function eb(t){return G("betaBashTool")}function tb(t){return G("betaReadTool")}function rb(t){return G("betaWriteTool")}function ib(t){return G("betaEditTool")}function nb(t){return G("betaGlobTool")}function sb(t){return G("betaGrepTool")}var Dg,Gg,Vg,rd,Zg,id,v_=Ln(()=>{z();td();Dg=3e4,Gg=".anthropic-memory-store",Vg=(()=>{class t extends E{constructor(e,r){super(e),r!==void 0&&(this.cause=r)}}return t._errorName="SessionMemoryError",t})(),rd=class{constructor(i,e){G("SessionMemoryStores")}get roots(){return G("SessionMemoryStores")}get readOnlyRoots(){return G("SessionMemoryStores")}download(i){return G("SessionMemoryStores")}finish(){return G("SessionMemoryStores")}syncAll(i){return G("SessionMemoryStores")}syncIfDue(){return G("SessionMemoryStores")}flushWrites(i){return G("SessionMemoryStores")}dispose(){return G("SessionMemoryStores")}};Zg=(()=>{class t extends E{constructor(e){super(`bash command timed out after ${e}ms`),this.timeoutMs=e}}return t._errorName="BashTimeoutError",t})(),id=class{constructor(i,e){G("BashSession")}get closed(){return G("BashSession")}exec(i,e={}){return G("BashSession")}close(){G("BashSession")}}});var et={};np(et,{child_process:()=>Xv,crypto:()=>Zv,fs:()=>ew,os:()=>tw,path:()=>rw,stream:()=>iw,util:()=>nw});function Qt(t){return new Proxy({},{get(i,e){if(typeof e!="symbol")throw new E(`\`${t}.${e}\` is not available in this environment; it needs a Node.js-compatible runtime`)}})}var Xv,Zv,ew,tw,rw,iw,nw,tt=Ln(()=>{z();Xv=Qt("child_process"),Zv=Qt("crypto"),ew=Qt("fs"),tw=Qt("os"),rw=Qt("path"),iw=Qt("stream"),nw=Qt("util")});function b(t,i,e,r,n){if(r==="m")throw new TypeError("Private method is not writable");if(r==="a"&&!n)throw new TypeError("Private accessor was defined without a setter");if(typeof i=="function"?t!==i||!n:!i.has(t))throw new TypeError("Cannot write private member to an object whose class did not declare it");return r==="a"?n.call(t,e):n?n.value=e:i.set(t,e),e}function a(t,i,e,r){if(e==="a"&&!r)throw new TypeError("Private accessor was defined without a getter");if(typeof i=="function"?t!==i||!r:!i.has(t))throw new TypeError("Cannot read private member from an object whose class did not declare it");return e==="m"?r:e==="a"?r.call(t):r?r.value:i.get(t)}z();var Yf=/^[a-z][a-z0-9+.-]*:/i,op=t=>Yf.test(t),le=t=>(le=Array.isArray,le(t)),Wn=le;function rr(t){return typeof t!="object"?{}:t??{}}function lu(t){if(!t)return!0;for(let i in t)return!1;return!0}function ap(t,i){return Object.prototype.hasOwnProperty.call(t,i)}function X(t){return t!=null&&typeof t=="object"&&!Array.isArray(t)}var ea=(t,i)=>{if(typeof i!="number"||!Number.isInteger(i))throw new E(`${t} must be an integer`);if(i<0)throw new E(`${t} must be a positive integer`);return i},Mt=["apiKey","authToken","credentials","config","profile"];var ta=t=>{try{return JSON.parse(t)}catch{return}};var Be=(t,i)=>new Promise(e=>{if(i?.aborted)return e();let r=()=>{clearTimeout(n),e()},n=setTimeout(()=>{i?.removeEventListener("abort",r),e()},t);i?.addEventListener("abort",r,{once:!0})});pt();var Ee="1.11.0";var dp=()=>typeof window<"u"&&typeof window.document<"u"&&typeof navigator<"u";function Qf(){return typeof Deno<"u"&&Deno.build!=null?"deno":typeof EdgeRuntime<"u"?"edge":Object.prototype.toString.call(typeof globalThis.process<"u"?globalThis.process:0)==="[object process]"?"node":"unknown"}var Xf=()=>{let t=Qf();if(t==="deno")return{"X-Stainless-Lang":"js","X-Stainless-Package-Version":Ee,"X-Stainless-OS":lp(Deno.build.os),"X-Stainless-Arch":cp(Deno.build.arch),"X-Stainless-Runtime":"deno","X-Stainless-Runtime-Version":typeof Deno.version=="string"?Deno.version:Deno.version?.deno??"unknown"};if(typeof EdgeRuntime<"u")return{"X-Stainless-Lang":"js","X-Stainless-Package-Version":Ee,"X-Stainless-OS":"Unknown","X-Stainless-Arch":`other:${EdgeRuntime}`,"X-Stainless-Runtime":"edge","X-Stainless-Runtime-Version":globalThis.process?.version??"unknown"};if(t==="node")return{"X-Stainless-Lang":"js","X-Stainless-Package-Version":Ee,"X-Stainless-OS":lp(globalThis.process.platform??"unknown"),"X-Stainless-Arch":cp(globalThis.process.arch??"unknown"),"X-Stainless-Runtime":"node","X-Stainless-Runtime-Version":globalThis.process.version??"unknown"};let i=Zf();return i?{"X-Stainless-Lang":"js","X-Stainless-Package-Version":Ee,"X-Stainless-OS":"Unknown","X-Stainless-Arch":"unknown","X-Stainless-Runtime":`browser:${i.browser}`,"X-Stainless-Runtime-Version":i.version}:{"X-Stainless-Lang":"js","X-Stainless-Package-Version":Ee,"X-Stainless-OS":"Unknown","X-Stainless-Arch":"unknown","X-Stainless-Runtime":"unknown","X-Stainless-Runtime-Version":"unknown"}};function Zf(){if(typeof navigator>"u"||!navigator)return null;let t=[{key:"edge",pattern:/Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/},{key:"ie",pattern:/MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/},{key:"ie",pattern:/Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/},{key:"chrome",pattern:/Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/},{key:"firefox",pattern:/Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/},{key:"safari",pattern:/(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/}];for(let{key:i,pattern:e}of t){let r=e.exec(navigator.userAgent);if(r){let n=r[1]||0,s=r[2]||0,o=r[3]||0;return{browser:i,version:`${n}.${s}.${o}`}}}return null}var cp=t=>t==="x32"?"x32":t==="x86_64"||t==="x64"?"x64":t==="arm"?"arm":t==="aarch64"||t==="arm64"?"arm64":t?`other:${t}`:"unknown",lp=t=>(t=t.toLowerCase(),t.includes("ios")?"iOS":t==="android"?"Android":t==="darwin"?"MacOS":t==="win32"?"Windows":t==="freebsd"?"FreeBSD":t==="openbsd"?"OpenBSD":t==="linux"?"Linux":t?`Other:${t}`:"Unknown"),up,jn=()=>up??(up=Xf());var ra=new WeakMap,pp=typeof globalThis.FinalizationRegistry=="function"?new globalThis.FinalizationRegistry(t=>He(t)):null;function em(t,i){return()=>t.removeEventListener("abort",i)}function hp(t,i,e){ra.set(t,em(i,e))}function _p(t,i){ra.has(i)&&pp?.register(t,i,i)}function He(t){let i=ra.get(t);i&&(ra.delete(t),pp?.unregister(t),i())}function mp(){if(typeof fetch<"u")return fetch;throw new Error("`fetch` is not defined as a global; Either pass `fetch` to the client, `new Anthropic({ fetch })` or polyfill the global, `globalThis.fetch = fetch`")}function uu(...t){let i=globalThis.ReadableStream;if(typeof i>"u")throw new Error("`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`");return new i(...t)}function ia(t){let i=Symbol.asyncIterator in t?t[Symbol.asyncIterator]():t[Symbol.iterator]();return uu({start(){},async pull(e){let{done:r,value:n}=await i.next();r?e.close():e.enqueue(n)},async cancel(){await i.return?.()}})}function tm(t){if(t[Symbol.asyncIterator])return t[Symbol.asyncIterator]();let i=t.getReader();return{async next(){try{let e=await i.read();return e?.done&&i.releaseLock(),e}catch(e){throw i.releaseLock(),e}},async return(){let e=i.cancel();return i.releaseLock(),await e,{done:!0,value:void 0}}}}var fp=typeof FinalizationRegistry>"u"?void 0:new FinalizationRegistry(async t=>{try{await t.return?.()}catch{}});async function*Kn(t){let i=tm(t),e={};fp?.register(e,i,e);try{for await(let r of{[Symbol.asyncIterator]:()=>i})yield r}finally{fp?.unregister(e)}}async function gp(t){if(t===null||typeof t!="object")return;if(t[Symbol.asyncIterator]){await t[Symbol.asyncIterator]().return?.();return}let i=t.getReader(),e=i.cancel();i.releaseLock(),await e}var bp=({headers:t,body:i})=>({bodyHeaders:{"content-type":"application/json"},body:JSON.stringify(i)});var _t="1.10.0";var yp=/^(\d+)\.(\d+)\.(\d+)(-(.+))?$/;function nm(t){let i=new Set([t]),e=new Set,r=t.match(yp);if(!r)return()=>!1;let n={major:+r[1],minor:+r[2],patch:+r[3],prerelease:r[4]};if(n.prerelease!=null)return function(p){return p===t};function s(l){return e.add(l),!1}function o(l){return i.add(l),!0}return function(p){if(i.has(p))return!0;if(e.has(p))return!1;let _=p.match(yp);if(!_)return s(p);let m={major:+_[1],minor:+_[2],patch:+_[3],prerelease:_[4]};return m.prerelease!=null||n.major!==m.major?s(p):n.major===0?n.minor===m.minor&&n.patch<=m.patch?o(p):s(p):n.minor<=m.minor?o(p):s(p)}}var vp=nm(_t);var sm=_t.split(".")[0],na=Symbol.for(`opentelemetry.js.api.${sm}`),sa=typeof globalThis=="object"?globalThis:typeof self=="object"?self:typeof window=="object"?window:typeof global=="object"?global:{};function om(){return Object.defineProperty({},"version",{value:_t,enumerable:!0,writable:!1,configurable:!1})}function ft(t,i,e,r=!1){var n;let s=sa[na]=(n=sa[na])!==null&&n!==void 0?n:om();if(!r&&s[t]){let o=new Error(`@opentelemetry/api: Attempted duplicate registration of API: ${t}`);return e.error(o.stack||o.message),!1}if(s.version!=="1.10.0"){let o=new Error(`@opentelemetry/api: Registration of version v${s.version} for ${t} does not match previously registered API v${_t}`);return e.error(o.stack||o.message),!1}return s[t]=i,e.debug(`@opentelemetry/api: Registered a global for ${t} v${_t}.`),!0}var wp;function qe(t){let i=sa[na];if(i!=null){if(i!==wp){if(!i.version||!vp(i.version))return;wp=i}return i[t]}}function mt(t,i){i.debug(`@opentelemetry/api: Unregistering a global for ${t} v${_t}.`);let e=sa[na];e&&delete e[t]}var Ep=class{constructor(t){this._namespace=t.namespace||"DiagComponentLogger"}debug(...t){return Dn("debug",this._namespace,t)}error(...t){return Dn("error",this._namespace,t)}info(...t){return Dn("info",this._namespace,t)}warn(...t){return Dn("warn",this._namespace,t)}verbose(...t){return Dn("verbose",this._namespace,t)}};function Dn(t,i,e){let r=qe("diag");if(r)return r[t](i,...e)}function kp(t,i){t<0?t=0:t>9999&&(t=9999),i=i||{};function e(r,n){let s=i[r];return typeof s=="function"&&t>=n?s.bind(i):function(){}}return{error:e("error",30),warn:e("warn",50),info:e("info",60),debug:e("debug",70),verbose:e("verbose",80)}}var am="diag",Ie=class Sp{static instance(){return this._instance||(this._instance=new Sp),this._instance}constructor(){function i(n){return function(...s){let o=qe("diag");if(o)return o[n](...s)}}let e=this,r=(n,s={logLevel:60})=>{var o;if(n===e){var l;let h=new Error("Cannot use diag as the logger for itself. Please use a DiagLogger implementation like ConsoleDiagLogger or a custom implementation");return e.error((l=h.stack)!==null&&l!==void 0?l:h.message),!1}typeof s=="number"&&(s={logLevel:s});let p=qe("diag"),_=kp((o=s.logLevel)!==null&&o!==void 0?o:60,n);if(p&&!s.suppressOverrideMessage){var m;let h=(m=new Error().stack)!==null&&m!==void 0?m:"<failed to generate stacktrace>";p.warn(`Current logger will be overwritten from ${h}`),_.warn(`Current logger will overwrite one already registered from ${h}`)}return ft("diag",_,e,!0)};e.setLogger=r,e.disable=()=>{mt(am,e)},e.createComponentLogger=n=>new Ep(n),e.verbose=i("verbose"),e.debug=i("debug"),e.info=i("info"),e.warn=i("warn"),e.error=i("error")}};var Ap=class Gn{constructor(i){this._entries=i?new Map(i):new Map}getEntry(i){let e=this._entries.get(i);if(e)return Object.assign({},e)}getAllEntries(){return Array.from(this._entries.entries())}setEntry(i,e){let r=new Gn(this._entries);return r._entries.set(i,e),r}removeEntry(i){let e=new Gn(this._entries);return e._entries.delete(i),e}removeEntries(...i){let e=new Gn(this._entries);for(let r of i)e._entries.delete(r);return e}clear(){return new Gn}};var cE=Ie.instance();function xp(t={}){return new Ap(new Map(Object.entries(t)))}function oa(t){return Symbol.for(t)}var Pp=new class du{constructor(i){let e=this;e._currentContext=i?new Map(i):new Map,e.getValue=r=>e._currentContext.get(r),e.setValue=(r,n)=>{let s=new du(e._currentContext);return s._currentContext.set(r,n),s},e.deleteValue=r=>{let n=new du(e._currentContext);return n._currentContext.delete(r),n}}};var Tp={get(t,i){if(t!=null)return t[i]},keys(t){return t==null?[]:Object.keys(t)}},Rp={set(t,i,e){t!=null&&(t[i]=e)}};var cm="0000000000000000",lm="00000000000000000000000000000000",Cp={traceId:lm,spanId:cm,traceFlags:0};var gt=class{constructor(t=Cp){this._spanContext=t}spanContext(){return this._spanContext}setAttribute(t,i){return this}setAttributes(t){return this}addEvent(t,i){return this}addLink(t){return this}addLinks(t){return this}setStatus(t){return this}updateName(t){return this}end(t){}isRecording(){return!1}recordException(t,i){}};var aa=new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1]);function Ip(t,i){if(typeof t!="string"||t.length!==i)return!1;let e=0;for(let r=0;r<t.length;r+=4)e+=(aa[t.charCodeAt(r)]|0)+(aa[t.charCodeAt(r+1)]|0)+(aa[t.charCodeAt(r+2)]|0)+(aa[t.charCodeAt(r+3)]|0);return e===i}function um(t){return Ip(t,32)&&t!=="00000000000000000000000000000000"}function dm(t){return Ip(t,16)&&t!=="0000000000000000"}function ca(t){return um(t.traceId)&&dm(t.spanId)}function zp(t){return new gt(t)}var Np=class{active(){return Pp}with(t,i,e,...r){return i.call(e,...r)}bind(t,i){return i}enable(){return this}disable(){return this}attach(t){return{dispose(){}}}};var pu="context",pm=new Np,hm=Object.freeze({dispose:()=>{}}),bt=class Op{constructor(){this._attachUnsupportedWarned=!1}static getInstance(){return this._instance||(this._instance=new Op),this._instance}setGlobalContextManager(i){return ft(pu,i,Ie.instance())}active(){return this._getContextManager().active()}with(i,e,r,...n){return this._getContextManager().with(i,e,r,...n)}bind(i,e){return this._getContextManager().bind(i,e)}attach(i){let e=this._getContextManager();return e.attach?e.attach(i):(this._attachUnsupportedWarned||(this._attachUnsupportedWarned=!0,Ie.instance().warn("The current ContextManager does not implement attach(). The context will not be attached. Use a ContextManager that supports attach() (e.g. AsyncLocalStorageContextManager) or use with()/bind() instead.")),hm)}_getContextManager(){return qe(pu)||pm}disable(){this._getContextManager().disable(),mt(pu,Ie.instance())}};var hu=oa("OpenTelemetry Context Key SPAN");function la(t){return t.getValue(hu)||void 0}function Mp(){return la(bt.getInstance().active())}function Vn(t,i){return t.setValue(hu,i)}function Bp(t){return t.deleteValue(hu)}function qp(t,i){return Vn(t,new gt(i))}function ua(t){var i;return(i=la(t))===null||i===void 0?void 0:i.spanContext()}var _u=bt.getInstance(),da=class{startSpan(t,i,e=_u.active()){if(i?.root)return new gt;let r=e&&ua(e);return _m(r)&&ca(r)?new gt(r):new gt}startActiveSpan(t,i,e,r){var n;let s,o,l;if(arguments.length<2)return;arguments.length===2?l=i:arguments.length===3?(s=i,l=e):(s=i,o=e,l=r);let p=(n=o)!==null&&n!==void 0?n:_u.active(),_=this.startSpan(t,s,p),m=Vn(p,_);return _u.with(m,l,void 0,_)}};function _m(t){return t!==null&&typeof t=="object"&&"spanId"in t&&typeof t.spanId=="string"&&"traceId"in t&&typeof t.traceId=="string"&&"traceFlags"in t&&typeof t.traceFlags=="number"}var fm=new da,Lp=class{constructor(t,i,e,r){this._provider=t,this.name=i,this.version=e,this.options=r}startSpan(t,i,e){return this._getTracer().startSpan(t,i,e)}startActiveSpan(t,i,e,r){let n=this._getTracer();return Reflect.apply(n.startActiveSpan,n,arguments)}_getTracer(){if(this._delegate)return this._delegate;let t=this._provider.getDelegateTracer(this.name,this.version,this.options);return t?(this._delegate=t,this._delegate):fm}};var yt=(function(t){return t[t.INTERNAL=0]="INTERNAL",t[t.SERVER=1]="SERVER",t[t.CLIENT=2]="CLIENT",t[t.PRODUCER=3]="PRODUCER",t[t.CONSUMER=4]="CONSUMER",t})({});var ke=(function(t){return t[t.UNSET=0]="UNSET",t[t.OK=1]="OK",t[t.ERROR=2]="ERROR",t})({});var $p=class{getTracer(t,i,e){return new da}};var mm=new $p,fu=class{getTracer(t,i,e){var r;return(r=this.getDelegateTracer(t,i,e))!==null&&r!==void 0?r:new Lp(this,t,i,e)}getDelegate(){var t;return(t=this._delegate)!==null&&t!==void 0?t:mm}setDelegate(t){this._delegate=t}getDelegateTracer(t,i,e){var r;return(r=this._delegate)===null||r===void 0?void 0:r.getTracer(t,i,e)}};var Z=bt.getInstance();var Fp=class{inject(t,i){}extract(t,i){return t}fields(){return[]}};var mu=oa("OpenTelemetry Baggage Key");function gu(t){return t.getValue(mu)||void 0}function Up(){return gu(bt.getInstance().active())}function Hp(t,i){return t.setValue(mu,i)}function Wp(t){return t.deleteValue(mu)}var bu="propagation",gm=new Fp,jp=class Kp{constructor(){this.createBaggage=xp,this.getBaggage=gu,this.getActiveBaggage=Up,this.setBaggage=Hp,this.deleteBaggage=Wp}static getInstance(){return this._instance||(this._instance=new Kp),this._instance}setGlobalPropagator(i){return ft(bu,i,Ie.instance())}inject(i,e,r=Rp){return this._getGlobalPropagator().inject(i,e,r)}extract(i,e,r=Tp){return this._getGlobalPropagator().extract(i,e,r)}fields(){return this._getGlobalPropagator().fields()}disable(){mt(bu,Ie.instance())}_getGlobalPropagator(){return qe(bu)||gm}};var Jn=jp.getInstance();var yu="trace",Dp=class Gp{constructor(){this._proxyTracerProvider=new fu,this.wrapSpanContext=zp,this.isSpanContextValid=ca,this.deleteSpan=Bp,this.getSpan=la,this.getActiveSpan=Mp,this.getSpanContext=ua,this.setSpan=Vn,this.setSpanContext=qp}static getInstance(){return this._instance||(this._instance=new Gp),this._instance}setGlobalTracerProvider(i){let e=ft(yu,this._proxyTracerProvider,Ie.instance());return e&&this._proxyTracerProvider.setDelegate(i),e}getTracerProvider(){return qe(yu)||this._proxyTracerProvider}getTracer(i,e){return this.getTracerProvider().getTracer(i,e)}disable(){mt(yu,Ie.instance()),this._proxyTracerProvider=new fu}};var Se=Dp.getInstance();z();z();function Yp(t){let i=0;for(let n of t)i+=n.length;let e=new Uint8Array(i),r=0;for(let n of t)e.set(n,r),r+=n.length;return e}var Vp;function Yn(t){let i;return(Vp??(i=new globalThis.TextEncoder,Vp=i.encode.bind(i)))(t)}var Jp;function Qn(t){let i;return(Jp??(i=new globalThis.TextDecoder,Jp=i.decode.bind(i)))(t)}var Ae,xe,pa=(()=>{class t{constructor(){Ae.set(this,void 0),xe.set(this,void 0),b(this,Ae,new Uint8Array,"f"),b(this,xe,null,"f")}decode(e){if(e==null)return[];let r=e instanceof ArrayBuffer?new Uint8Array(e):typeof e=="string"?Yn(e):e;b(this,Ae,Yp([a(this,Ae,"f"),r]),"f");let n=[],s;for(;(s=bm(a(this,Ae,"f"),a(this,xe,"f")))!=null;){if(s.carriage&&a(this,xe,"f")==null){b(this,xe,s.index,"f");continue}if(a(this,xe,"f")!=null&&(s.index!==a(this,xe,"f")+1||s.carriage)){n.push(Qn(a(this,Ae,"f").subarray(0,a(this,xe,"f")-1))),b(this,Ae,a(this,Ae,"f").subarray(a(this,xe,"f")),"f"),b(this,xe,null,"f");continue}let o=a(this,xe,"f")!==null?s.preceding-1:s.preceding,l=Qn(a(this,Ae,"f").subarray(0,o));n.push(l),b(this,Ae,a(this,Ae,"f").subarray(s.index),"f"),b(this,xe,null,"f")}return n}flush(){return a(this,Ae,"f").length?this.decode(`
`):[]}}return Ae=new WeakMap,xe=new WeakMap,t.NEWLINE_CHARS=new Set([`
`,"\r"]),t.NEWLINE_REGEXP=/\r\n|[\n\r]/g,t})();function bm(t,i){for(let n=i??0;n<t.length;n++){if(t[n]===10)return{preceding:n,index:n+1,carriage:!1};if(t[n]===13)return{preceding:n,index:n+1,carriage:!0}}return null}pt();var N=t=>{if(typeof globalThis.process<"u")return globalThis.process.env?.[t]?.trim()||void 0;if(typeof globalThis.Deno<"u")return globalThis.Deno.env?.get?.(t)?.trim()||void 0};var Xn="warn",_a={off:0,error:200,warn:300,info:400,debug:500},fa=(t,i,e)=>{if(t){if(ap(_a,t))return t;e.warn(`${i} was set to ${JSON.stringify(t)}, expected one of ${JSON.stringify(Object.keys(_a))}`)}};function ir(){}function ha(t,i,e){return!i||_a[t]>_a[e]?ir:i[t].bind(i)}var ym={error:ir,warn:ir,info:ir,debug:ir},Qp=new WeakMap;function wu(t,i){let e=Qp.get(t);if(e&&e[0]===i)return e[1];let r={error:ha("error",t,i),warn:ha("warn",t,i),info:ha("info",t,i),debug:ha("debug",t,i)};return Qp.set(t,[i,r]),r}function I(t){let i=t.logger,e=t.logLevel??"off";return i?wu(i,e):ym}var Xp,vu;function ma(){let t=N("ANTHROPIC_LOG");return(!vu||t!==Xp)&&(Xp=t,vu=wu(console,fa(t,"process.env['ANTHROPIC_LOG']",wu(console,Xn))??Xn)),vu}function We(t,i,e){t.debug!==ir&&t.debug(i,vm(e))}var vm=t=>(t.options&&(t.options={...t.options},delete t.options.headers,delete t.options.__span),t.headers&&(t.headers=Object.fromEntries((t.headers instanceof Headers?[...t.headers]:Object.entries(t.headers)).map(([i,e])=>[i,i.toLowerCase()==="authorization"||i.toLowerCase()==="proxy-authorization"||i.toLowerCase()==="api-key"||i.toLowerCase()==="x-api-key"||i.toLowerCase()==="x-amz-security-token"||i.toLowerCase()==="cookie"||i.toLowerCase()==="set-cookie"?"***":e]))),"retryOfRequestLogID"in t&&(t.retryOfRequestLogID&&(t.retryOf=t.retryOfRequestLogID),delete t.retryOfRequestLogID),t);z();var Zn,ue=(()=>{class t{constructor(e,r,n){this.iterator=e,Zn.set(this,void 0),this.controller=r,b(this,Zn,n,"f")}static rawEvents(e,r=new AbortController){return Zp(e,r)}static fromSSEResponse(e,r,n){let s=!1,o=n?I(n):console;async function*l(){if(s)throw new E("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");s=!0;let p=!1;try{for await(let _ of Zp(e,r))if(_.event!=="ping"&&_.event!==null)if(_.event==="error"){let m=ta(_.data)??_.data,h=m?.error?.type;throw new $(void 0,m,void 0,e.headers,h)}else{if(!_.data)continue;try{yield JSON.parse(_.data)}catch(m){throw o.error("Could not parse message into JSON:",_.data),o.error("From chunk:",_.raw),m}}p=!0}catch(_){if(we(_))return;throw _}finally{p||r.abort(),He(r)}}return new t(l,r,n)}static fromReadableStream(e,r,n){let s=!1;async function*o(){let p=new pa,_=Kn(e);for await(let m of _)for(let h of p.decode(m))yield h;for(let m of p.flush())yield m}async function*l(){if(s)throw new E("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");s=!0;let p=!1;try{for await(let _ of o())p||_&&(yield JSON.parse(_));p=!0}catch(_){if(we(_))return;throw _}finally{p||r.abort(),He(r)}}return new t(l,r,n)}[(Zn=new WeakMap,Symbol.asyncIterator)](){return this.iterator()}tee(){let e=[],r=[],n=this[Symbol.asyncIterator](),s=o=>({next:()=>{if(o.length===0){let l=n.next();e.push(l),r.push(l)}return o.shift()}});return[new t(()=>s(e),this.controller,a(this,Zn,"f")),new t(()=>s(r),this.controller,a(this,Zn,"f"))]}toReadableStream(){let e=this,r;return uu({async start(){r=e[Symbol.asyncIterator]()},async pull(n){try{let{value:s,done:o}=await r.next();if(o)return n.close();let l=Yn(JSON.stringify(s)+`
`);n.enqueue(l)}catch(s){n.error(s)}},async cancel(){await r.return?.()}})}}return t})();async function*Zp(t,i){if(!t.body)throw i.abort(),typeof globalThis.navigator<"u"&&globalThis.navigator.product==="ReactNative"?new E("The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api"):new E("Attempted to iterate over a response with no body");let e=new TextDecoder("utf-8",{ignoreBOM:!0}),r="",n=!1,s=null,o=[],l=[],p=_=>{if(_.charCodeAt(0)===65279&&(_=_.slice(1)),!_){if(!s&&!o.length)return null;let y={event:s,data:o.join(`
`),raw:l};return s=null,o=[],l=[],y}l.push(_);let m=_.indexOf(":");if(m===0)return null;let h=m===-1?_:_.slice(0,m);if(h!=="event"&&h!=="data")return null;let g=m===-1?"":_.slice(_.charCodeAt(m+1)===32?m+2:m+1);return h==="event"?s=g:o.push(g),null};for await(let _ of Kn(t.body)){if(_==null)continue;let m=e.decode(typeof _=="string"?Yn(_):_,{stream:!0});if(r+=m,!n&&!m.includes(`
`)&&!m.includes("\r"))continue;let h=0;if(r.includes("\r"))for(let g=0;g<r.length;g++){let y=r[g];if(y!==`
`&&y!=="\r")continue;if(y==="\r"&&g+1===r.length)break;let w=p(r.slice(h,g));y==="\r"&&r[g+1]===`
`&&g++,h=g+1,w&&(yield w)}else{let g;for(;(g=r.indexOf(`
`,h))!==-1;){let y=p(r.slice(h,g));h=g+1,y&&(yield y)}}r=r.slice(h),n=r.endsWith("\r")}if(r+=e.decode(),r)for(let _ of r.replace(/\r$/,"").split(/\r\n|[\n\r]/)){let m=p(_);m&&(yield m)}}pt();var eh=Symbol.for("brand.privateNullableHeaders");function*wm(t){if(!t)return;if(eh in t){let{values:r,nulls:n}=t;yield*r.entries();for(let s of n)yield[s,null];return}let i=!1,e;t instanceof Headers?e=t.entries():Wn(t)?e=t:(i=!0,e=Object.entries(t??{}));for(let r of e){let n=r[0];if(typeof n!="string")throw new TypeError("expected header name to be a string");let s=Wn(r[1])?r[1]:[r[1]],o=!1;for(let l of s)l!==void 0&&(i&&!o&&(o=!0,yield[n,ga]),yield[n,l])}}var ga=Symbol("clear"),Em=new Set(["x-stainless-helper"]),Eu=(t,i)=>{let e=t?t.split(",").map(r=>r.trim()).filter(Boolean):[];for(let r of i.split(",").map(n=>n.trim()))r&&!e.includes(r)&&e.push(r);return e.join(", ")},d=t=>{let i=new Headers,e=new Set;for(let r of t){let n=new Set;for(let[s,o]of wm(r)){let l=s.toLowerCase();if(Em.has(l)){if(o===ga)continue;o===null?(i.delete(s),e.add(l)):(i.set(s,Eu(i.get(s),o)),e.delete(l));continue}(o===ga||!n.has(l))&&(i.delete(s),n.add(l),o===ga)||(o===null?(i.delete(s),e.add(l)):(i.append(s,o),e.delete(l)))}}return{[eh]:!0,values:i,nulls:e}};var th="com.anthropic.sdk.typescript",km="error.type",es="gen_ai.conversation.id",Bt="gen_ai.provider.name",Sm="http.request.method",Am="http.request.resend_count",ba="http.response.status_code",xm="http.route",Pm="server.address",Tm="server.port",Rm="url.full",Cm="url.path",Im="url.query",zm="url.scheme",Nm="anthropic.session.thread.id",Om=75e4;function rh(t){let{tracerProvider:i,propagation:e,traces:r}=t===!1?{traces:!1}:t??Mm(),{enabled:n,contentMode:s,maxContentBytes:o}=typeof r=="boolean"?{enabled:r}:r??{};return Object.freeze({tracerProvider:i,propagation:e??!0,traces:Object.freeze({enabled:n??!0,contentMode:s==="content"?"content":"metadata_only",maxContentBytes:o!==void 0&&Number.isInteger(o)&&o>=1?o:Om})})}function Mm(){return{propagation:N("ANTHROPIC_OPEN_TELEMETRY_PROPAGATION")?.toLowerCase()!=="false",traces:{enabled:N("ANTHROPIC_OPEN_TELEMETRY")?.toLowerCase()!=="false",contentMode:N("ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE")?.toLowerCase()==="content"?"content":"metadata_only",maxContentBytes:Number(/^\d+$/.exec(N("ANTHROPIC_OPEN_TELEMETRY_TRACES_MAX_CONTENT_BYTES")??"")?.[0]??NaN)}}}function ih(t,i,e){if(!t.traces.enabled)return;let r=e!==void 0?`${th}.${e}`:th;return(t.tracerProvider??Se.getTracerProvider()).getTracer(r,i)}function M(t,i){try{return i()}catch(e){t&&I(t).debug("could not record telemetry",e);return}}function c(t,i,e,r){if(e?.__span)return e.__span;let n=t._tracer;if(n)return M(t,()=>{let s=Date.now(),o=r?.attributes?.[Nm],l=e?.openTelemetry?.conversationId??(typeof o=="string"?o:void 0),p=n.startSpan(i,{kind:yt.CLIENT,attributes:{[Bt]:t._genAIProviderName,...Lm(t.baseURL),...l!=null?{[es]:l}:void 0,...r?.route!=null?{[xm]:r.route}:void 0,...Bm(t,i,r?.request),...r?.attributes}});if(!p.isRecording()&&!(t.openTelemetry.propagation?Object.keys(lh(p)).length>0:Se.isSpanContextValid(p.spanContext())))return;let{request:_,...m}=r??{};return{...m,span:p,name:i,startTime:s}})}function nh(t,i){if(t.createdIDAttribute===void 0||typeof i!="object"||i===null)return;let e=i[t.createdIDField??"id"];typeof e=="string"&&t.span.setAttribute(t.createdIDAttribute,e)}var ya={"anthropic.messages.create":{constants:{"gen_ai.operation.name":"chat"},request:[["gen_ai.request.model",["model"],"string"],["gen_ai.request.max_tokens",["max_tokens"],"integer"],["gen_ai.request.reasoning.level",["output_config","effort"],"string"],["anthropic.request.service_tier",["service_tier"],"string"],["anthropic.thinking.type",["thinking","type"],"string"],["anthropic.thinking.budget_tokens",["thinking","budget_tokens"],"integer"]],requestHeaders:[["anthropic.beta","anthropic-beta",{array:"string"}]],stream:"gen_ai.request.stream",response:[["gen_ai.response.id",["id"],"string"],["gen_ai.response.model",["model"],"string"],["gen_ai.usage.cache_write.input_tokens",["usage","cache_creation_input_tokens"],"integer"],["gen_ai.usage.cache_read.input_tokens",["usage","cache_read_input_tokens"],"integer"],["anthropic.usage.cache_creation.ephemeral_5m_input_tokens",["usage","cache_creation","ephemeral_5m_input_tokens"],"integer"],["anthropic.usage.cache_creation.ephemeral_1h_input_tokens",["usage","cache_creation","ephemeral_1h_input_tokens"],"integer"],["anthropic.response.service_tier",["usage","service_tier"],"string"],["gen_ai.usage.output_tokens",["usage","output_tokens"],"integer"],["gen_ai.usage.reasoning.output_tokens",["usage","output_tokens_details","thinking_tokens"],"integer"],["anthropic.message.stop_reason",["stop_reason"],"string"]]},"anthropic.messages.count_tokens":{request:[["gen_ai.request.model",["model"],"string"]],response:[["anthropic.message.count_tokens.input_tokens",["input_tokens"],"integer"]]},"anthropic.sessions.create":{request:[["anthropic.session.environment.id",["environment_id"],"string"]],response:[["gen_ai.agent.name",["agent","name"],"string"],["gen_ai.request.model",["agent","model","id"],"string"]]}};function Bm(t,i,e){let r=ya[i];if(!r)return{};let n={...r.constants};for(let[o,l,p]of r.request??[]){let _=M(t,()=>Su(sh(e?.body,l),p));_!==void 0&&(n[o]=_)}let{requestHeaders:s}=r;return s&&M(t,()=>{let o=d([t._options.defaultHeaders,e?.headers]).values;for(let[l,p,_]of s){let m=qm(o.get(p),_);m!==void 0&&(n[l]=m)}}),r.stream!==void 0&&e?.stream&&(n[r.stream]=!0),n}function ku(t,i,e){for(let[r,n,s]of ya[i]?.response??[])try{let o=Su(sh(e,n),s);o!==void 0&&t.setAttribute(r,o)}catch{}}function sh(t,i){let e=t;for(let r of i){if(typeof e!="object"||e===null)return;e=e[r]}return e}function Su(t,i){if(typeof i=="object")return Array.isArray(t)&&t.every(e=>Su(e,i.array)!==void 0)?[...t]:void 0;switch(typeof t){case"string":return i==="string"||i==="unknown"?t:void 0;case"boolean":return i==="boolean"||i==="unknown"?t:void 0;case"number":return i==="integer"||i==="number"||i==="unknown"?t:void 0;default:return}}function qm(t,i){let e=(t??"").split(",").map(r=>r.trim()).filter(Boolean);if(!(t==null||e.length===0))return typeof i=="object"?e:t}function Lm(t){try{let{hostname:i,port:e,protocol:r}=new URL(t);return{[Pm]:i.replace(/^\[(.*)\]$/,"$1"),[Tm]:e?Number(e):r==="http:"?80:443}}catch{return{}}}function oh(t,i,e,r=!1){if(t.attempts=(t.attempts??0)+1,t.attempts>1){t.span.setAttribute(Am,t.attempts-1);return}t.span.setAttribute(Sm,i);try{let{protocol:n,host:s,pathname:o,search:l}=new URL(e),p=Fm(l.slice(1),t.queryParams,t.contentQueryParams);if(t.span.setAttributes({[zm]:n.slice(0,-1),[Cm]:o}),p?.content&&!r)return;t.span.setAttributes({...p!==void 0?{[Im]:p.value}:void 0,[Rm]:`${n}//${s}${o}${p!==void 0?`?${p.value}`:""}`})}catch{}}var $m=["email","path_prefix","expected_content_sha256"];function Fm(t,i,e){if(!t||!i?.length)return;let r=!1,n=t.split("&").filter(s=>{try{let o=decodeURIComponent(s.split("=",1)[0]),l=i.includes(o)||!o.endsWith("[]")?o:o.slice(0,-2);return i.includes(l)?(r||(r=$m.includes(l)||!!e?.includes(l)),!0):!1}catch{return!1}});return n.length?{value:n.join("&"),content:r}:void 0}function ah(t,i){let e=d([i]).values;for(let[r,n]of Object.entries(lh(t)))e.set(r,n);return e}function vt(t,i){if(t.isRecording())try{switch(Um(t,i),va(t,i.response??(i.status==="error"&&i.error instanceof $?i.error:void 0)),i.status){case"success":i.options.__span&&ku(t,i.options.__span.name,i.data),t.setStatus({code:ke.OK});break;case"error":ze(t,i.error);break}}finally{t.end()}}function Au(t,i,e){let r=t[Symbol.asyncIterator],n=!1,s=p=>{if(!n){n=!0,i.removeEventListener("abort",o);try{e.onEnd(p)}catch{}}},o=()=>s({reason:"canceled"});if(i.aborted)return o();i.addEventListener("abort",o,{once:!0});let l=!1;t[Symbol.asyncIterator]=function(){let p=r.call(this);if(l)return p;l=!0,i.removeEventListener("abort",o);let _={async next(){let m;try{m=await p.next()}catch(h){throw s({reason:"failed",error:h}),h}if(m.done)s({reason:i.aborted?"canceled":"completed"});else if(!n)try{e.onItem?.(m.value)}catch{}return m},async return(m){return o(),await p.return?.(m)??{done:!0,value:m}},async throw(m){if(o(),p.throw)return p.throw(m);throw m},[Symbol.asyncIterator]:()=>_};return _}}function ch(t,i,e){if(!t.isRecording())return;t.setAttribute(ba,e.response.status),va(t,e.response);let r=i instanceof ue;Au(i,e.controller.signal,{onEnd(n){n.reason==="failed"?ze(t,n.error):n.reason==="completed"&&!r&&t.setStatus({code:ke.OK}),t.end()}})}function Um(t,i){let e=i.response?.status??(i.status==="error"&&i.error instanceof $?i.error.status:void 0);e!==void 0&&t.setAttribute(ba,e)}var Hm=[["anthropic.request.id","request-id"],["anthropic.organization.id","anthropic-organization-id"],["anthropic.workspace.id","anthropic-workspace-id"]];function va(t,i){let e;try{e=i?.headers}catch{return}for(let[r,n]of Hm)try{let s=e?.get(n);s&&t.setAttribute(r,s)}catch{}}function ze(t,i,e){i instanceof ie||we(i)||(t.setStatus({code:ke.ERROR}),t.setAttribute(km,e??Wm(i)))}function lh(t){let i={};return Jn.inject(Se.setSpan(Z.active(),t),i),i}function Wm(t){if(t instanceof $n)return"client_timeout_error";if(t instanceof rt)return"connection_error";if(t instanceof $){if(t.type)return t.type;if(t.status!==void 0)return String(t.status)}return"client_error"}var xu="RFC3986",Pu=t=>String(t),Tu={RFC1738:t=>String(t).replace(/%20/g,"+"),RFC3986:Pu},uh="RFC1738";var wa=(t,i)=>(wa=Object.hasOwn??Function.prototype.call.bind(Object.prototype.hasOwnProperty),wa(t,i)),je=(()=>{let t=[];for(let i=0;i<256;++i)t.push("%"+((i<16?"0":"")+i.toString(16)).toUpperCase());return t})();var Ru=1024,dh=(t,i,e,r,n)=>{if(t.length===0)return t;let s=t;if(typeof t=="symbol"?s=Symbol.prototype.toString.call(t):typeof t!="string"&&(s=String(t)),e==="iso-8859-1")return escape(s).replace(/%u[0-9a-f]{4}/gi,function(l){return"%26%23"+parseInt(l.slice(2),16)+"%3B"});let o="";for(let l=0;l<s.length;l+=Ru){let p=s.length>=Ru?s.slice(l,l+Ru):s,_=[];for(let m=0;m<p.length;++m){let h=p.charCodeAt(m);if(h===45||h===46||h===95||h===126||h>=48&&h<=57||h>=65&&h<=90||h>=97&&h<=122||n===uh&&(h===40||h===41)){_[_.length]=p.charAt(m);continue}if(h<128){_[_.length]=je[h];continue}if(h<2048){_[_.length]=je[192|h>>6]+je[128|h&63];continue}if(h<55296||h>=57344){_[_.length]=je[224|h>>12]+je[128|h>>6&63]+je[128|h&63];continue}m+=1,h=65536+((h&1023)<<10|p.charCodeAt(m)&1023),_[_.length]=je[240|h>>18]+je[128|h>>12&63]+je[128|h>>6&63]+je[128|h&63]}o+=_.join("")}return o};function ph(t){return!t||typeof t!="object"?!1:!!(t.constructor&&t.constructor.isBuffer&&t.constructor.isBuffer(t))}function Cu(t,i){if(le(t)){let e=[];for(let r=0;r<t.length;r+=1)e.push(i(t[r]));return e}return i(t)}var _h={brackets(t){return String(t)+"[]"},comma:"comma",indices(t,i){return String(t)+"["+i+"]"},repeat(t){return String(t)}},fh=function(t,i){Array.prototype.push.apply(t,le(i)?i:[i])},hh,re={addQueryPrefix:!1,allowDots:!1,allowEmptyArrays:!1,arrayFormat:"indices",charset:"utf-8",charsetSentinel:!1,delimiter:"&",encode:!0,encodeDotInKeys:!1,encoder:dh,encodeValuesOnly:!1,format:xu,formatter:Pu,indices:!1,serializeDate(t){return(hh??(hh=Function.prototype.call.bind(Date.prototype.toISOString)))(t)},skipNulls:!1,strictNullHandling:!1};function jm(t){return typeof t=="string"||typeof t=="number"||typeof t=="boolean"||typeof t=="symbol"||typeof t=="bigint"}var Iu={};function mh(t,i,e,r,n,s,o,l,p,_,m,h,g,y,w,k,S,R){let A=t,C=R,T=0,x=!1;for(;(C=C.get(Iu))!==void 0&&!x;){let Q=C.get(t);if(T+=1,typeof Q<"u"){if(Q===T)throw new RangeError("Cyclic object value");x=!0}typeof C.get(Iu)>"u"&&(T=0)}if(typeof _=="function"?A=_(i,A):A instanceof Date?A=g?.(A):e==="comma"&&le(A)&&(A=Cu(A,function(Q){return Q instanceof Date?g?.(Q):Q})),A===null){if(s)return p&&!k?p(i,re.encoder,S,"key",y):i;A=""}if(jm(A)||ph(A)){if(p){let Q=k?i:p(i,re.encoder,S,"key",y);return[w?.(Q)+"="+w?.(p(A,re.encoder,S,"value",y))]}return[w?.(i)+"="+w?.(String(A))]}let B=[];if(typeof A>"u")return B;let L;if(e==="comma"&&le(A))k&&p&&(A=Cu(A,p)),L=[{value:A.length>0?A.join(",")||null:void 0}];else if(le(_))L=_;else{let Q=Object.keys(A);L=m?Q.sort(m):Q}let U=l?String(i).replace(/\./g,"%2E"):String(i),W=r&&le(A)&&A.length===1?U+"[]":U;if(n&&le(A)&&A.length===0)return W+"[]";for(let Q=0;Q<L.length;++Q){let Ce=L[Q],zt=typeof Ce=="object"&&typeof Ce.value<"u"?Ce.value:A[Ce];if(o&&zt===null)continue;let eu=h&&l?Ce.replace(/\./g,"%2E"):Ce,Ff=le(A)?typeof e=="function"?e(W,eu):W:W+(h?"."+eu:"["+eu+"]");R.set(t,T);let ip=new WeakMap;ip.set(Iu,R),fh(B,mh(zt,Ff,e,r,n,s,o,l,e==="comma"&&k&&le(A)?null:p,_,m,h,g,y,w,k,S,ip))}return B}function Km(t=re){if(typeof t.allowEmptyArrays<"u"&&typeof t.allowEmptyArrays!="boolean")throw new TypeError("`allowEmptyArrays` option can only be `true` or `false`, when provided");if(typeof t.encodeDotInKeys<"u"&&typeof t.encodeDotInKeys!="boolean")throw new TypeError("`encodeDotInKeys` option can only be `true` or `false`, when provided");if(t.encoder!==null&&typeof t.encoder<"u"&&typeof t.encoder!="function")throw new TypeError("Encoder has to be a function.");let i=t.charset||re.charset;if(typeof t.charset<"u"&&t.charset!=="utf-8"&&t.charset!=="iso-8859-1")throw new TypeError("The charset option must be either utf-8, iso-8859-1, or undefined");let e=xu;if(typeof t.format<"u"){if(!wa(Tu,t.format))throw new TypeError("Unknown format option provided.");e=t.format}let r=Tu[e],n=re.filter;(typeof t.filter=="function"||le(t.filter))&&(n=t.filter);let s;if(t.arrayFormat&&t.arrayFormat in _h?s=t.arrayFormat:"indices"in t?s=t.indices?"indices":"repeat":s=re.arrayFormat,"commaRoundTrip"in t&&typeof t.commaRoundTrip!="boolean")throw new TypeError("`commaRoundTrip` must be a boolean, or absent");let o=typeof t.allowDots>"u"?t.encodeDotInKeys?!0:re.allowDots:!!t.allowDots;return{addQueryPrefix:typeof t.addQueryPrefix=="boolean"?t.addQueryPrefix:re.addQueryPrefix,allowDots:o,allowEmptyArrays:typeof t.allowEmptyArrays=="boolean"?!!t.allowEmptyArrays:re.allowEmptyArrays,arrayFormat:s,charset:i,charsetSentinel:typeof t.charsetSentinel=="boolean"?t.charsetSentinel:re.charsetSentinel,commaRoundTrip:!!t.commaRoundTrip,delimiter:typeof t.delimiter>"u"?re.delimiter:t.delimiter,encode:typeof t.encode=="boolean"?t.encode:re.encode,encodeDotInKeys:typeof t.encodeDotInKeys=="boolean"?t.encodeDotInKeys:re.encodeDotInKeys,encoder:typeof t.encoder=="function"?t.encoder:re.encoder,encodeValuesOnly:typeof t.encodeValuesOnly=="boolean"?t.encodeValuesOnly:re.encodeValuesOnly,filter:n,format:e,formatter:r,serializeDate:typeof t.serializeDate=="function"?t.serializeDate:re.serializeDate,skipNulls:typeof t.skipNulls=="boolean"?t.skipNulls:re.skipNulls,sort:typeof t.sort=="function"?t.sort:null,strictNullHandling:typeof t.strictNullHandling=="boolean"?t.strictNullHandling:re.strictNullHandling}}function gh(t,i={}){let e=t,r=Km(i),n,s;typeof r.filter=="function"?(s=r.filter,e=s("",e)):le(r.filter)&&(s=r.filter,n=s);let o=[];if(typeof e!="object"||e===null)return"";let l=_h[r.arrayFormat],p=l==="comma"&&r.commaRoundTrip;n||(n=Object.keys(e)),r.sort&&n.sort(r.sort);let _=new WeakMap;for(let g=0;g<n.length;++g){let y=n[g];r.skipNulls&&e[y]===null||fh(o,mh(e[y],y,l,p,r.allowEmptyArrays,r.strictNullHandling,r.skipNulls,r.encodeDotInKeys,r.encode?r.encoder:null,r.filter,r.sort,r.allowDots,r.serializeDate,r.format,r.formatter,r.encodeValuesOnly,r.charset,_))}let m=o.join(r.delimiter),h=r.addQueryPrefix===!0?"?":"";return r.charsetSentinel&&(r.charset==="iso-8859-1"?h+="utf8=%26%2310003%3B&":h+="utf8=%E2%9C%93&"),m.length>0?h+m:""}function bh(t){return gh(t,{arrayFormat:"brackets"})}var f=class{constructor(i){this._client=i}};z();z();async function Ea(t,i){let{response:e,requestLogID:r,retryOfRequestLogID:n,startTime:s}=i,o=await(async()=>{if(i.options.stream)return I(t).debug("response",e.status,e.url,e.headers,e.body),ue.fromSSEResponse(e,i.controller,t);if(e.status===204)return null;if(i.options.__binaryResponse)return e;let p=e.headers.get("content-type")?.split(";")[0]?.trim();if(p?.includes("application/json")||p?.endsWith("+json")){if(e.headers.get("content-length")==="0")return;let g=await e.json();return qt(g,e)}return await e.text()})().finally(()=>{!i.options.stream&&!i.options.__binaryResponse&&He(i.controller)});return We(I(t),`[${r}] response parsed`,{retryOfRequestLogID:n,url:e.url,status:e.status,body:o,durationMs:Date.now()-s}),o}function qt(t,i){return!t||typeof t!="object"||Array.isArray(t)?t:Object.defineProperties(t,{_request_id:{value:i.headers.get("request-id"),enumerable:!1},_workspace_id:{value:i.headers.get("anthropic-workspace-id"),enumerable:!1}})}var Nu=()=>{if(typeof File>"u"){let{process:t}=globalThis,i=typeof t?.versions?.node=="string"&&parseInt(t.versions.node.split("."))<20;throw new Error("`File` is not defined as a global, which is required for file uploads."+(i?" Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`.":""))}};function Lt(t,i,e){return Nu(),new File(t,i??"",e)}function ts(t,i){let e=typeof t=="object"&&t!==null&&("name"in t&&t.name&&String(t.name)||"url"in t&&t.url&&String(t.url)||"filename"in t&&t.filename&&String(t.filename)||"path"in t&&t.path&&String(t.path))||"";return i?e.split(/[\\/]/).pop()||void 0:e}var rs=t=>t!=null&&typeof t=="object"&&typeof t[Symbol.asyncIterator]=="function";var ne=async(t,i,e=!0)=>{try{return{...t,body:await Vm(t.body,i,e)}}catch(r){let n=t.__span?.span;throw n&&M(typeof i=="function"?void 0:i,()=>vt(n,{status:"error",options:t,error:r})),r}},yh=new WeakMap;function Gm(t){let i=typeof t=="function"?t:t.fetch,e=yh.get(i);if(e)return e;let r=(async()=>{try{let n="Response"in i?i.Response:(await i("data:,")).constructor,s=new FormData;return s.toString()!==await new n(s).text()}catch{return!0}})();return yh.set(i,r),r}var Vm=async(t,i,e=!0)=>{if(!await Gm(i))throw new TypeError("The provided fetch function does not support file uploads with the current global FormData class.");let r=new FormData;return await Promise.all(Object.entries(t||{}).map(([n,s])=>zu(r,n,s,e))),r};var zu=async(t,i,e,r)=>{if(e!==void 0){if(e==null)throw new TypeError(`Received null for "${i}"; to pass null in FormData, you must use the string 'null'`);if(typeof e=="string"||typeof e=="number"||typeof e=="boolean")t.append(i,String(e));else if(e instanceof Response){let n={},s=e.headers.get("Content-Type");s&&(n={type:s}),t.append(i,Lt([await e.blob()],ts(e,r),n))}else if(rs(e))t.append(i,Lt([await new Response(ia(e)).blob()],ts(e,r)));else if(e instanceof Blob){let s=typeof File<"u"&&e instanceof File?e.name:ts(e,r);t.append(i,Lt([e],s,{type:e.type}))}else if(Array.isArray(e))await Promise.all(e.map(n=>zu(t,i+"[]",n,r)));else{if(typeof e.then=="function")throw new TypeError(`Received a Promise for "${i}"; await it first, e.g. \`await toFile(...)\``);if(e instanceof ArrayBuffer||ArrayBuffer.isView(e))throw new TypeError(`Received ${e.constructor.name} for "${i}"; to upload raw bytes, wrap them with \`await toFile(bytes, 'filename')\``);if(typeof e=="object")await Promise.all(Object.entries(e).map(([n,s])=>zu(t,`${i}[${n}]`,s,r)));else throw new TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${e} instead`)}}};var vh="gen_ai.agent.id",nr="gen_ai.input.messages",Ou="gen_ai.operation.name",$t="gen_ai.output.messages",ka="gen_ai.output.type",wh="gen_ai.request.model",Sa="gen_ai.request.stop_sequences",Eh="gen_ai.response.time_to_first_chunk",sr="gen_ai.system_instructions",kh="gen_ai.tool.call.arguments",Sh="gen_ai.tool.call.id",Ah="gen_ai.tool.description",xh="gen_ai.tool.name",Ph="gen_ai.tool.type",Th="gen_ai.usage.input_tokens",Rh="execute_tool",Ch="invoke_agent",Aa="json",Ih="function",zh="anthropic.content.truncated",is="anthropic.tool_result.content",Nh="anthropic.toolset.name",Oh="anthropic.usage.compaction.input_tokens",Mh="anthropic.usage.compaction.output_tokens";function ss(t,i,e,r){let n=t.span,s=t.requestContentSize;if(e!==void 0&&s!==void 0){let l=JSON.stringify([{role:"assistant",parts:xa(e)}]);if(s+3*l.length<=r||s+Pa(l)<=r){n.setAttribute($t,l);return}}let o=qu(n,{[Sa]:i.stop_sequences?.length?[...i.stop_sequences]:void 0,[sr]:i.system===void 0?void 0:xa(i.system),[nr]:i.messages.map(l=>({role:l.role,parts:xa(l.content)})),[$t]:e===void 0?void 0:[{role:"assistant",parts:xa(e)}]},r);e===void 0&&(t.requestContentSize=o)}function xa(t){return typeof t=="string"?[{type:"text",content:t}]:t?.map(Jm)??[]}function Jm(t){switch(t.type){case"text":return{type:"text",content:t.text};case"thinking":return{type:"reasoning",content:t.thinking};case"tool_use":return{type:"tool_call",id:t.id,name:t.name,arguments:t.input,...typeof t.toolset_name=="string"?{anthropic_toolset_name:t.toolset_name}:void 0};case"server_tool_use":return{type:"tool_call",id:t.id,name:t.name,arguments:t.input};case"mcp_tool_use":return{type:"tool_call",id:t.id,name:t.name,arguments:t.input,anthropic_mcp_server_name:t.server_name};case"tool_result":return{type:"tool_call_response",id:t.tool_use_id,response:Bu(t.content)};default:return typeof t.type!="string"?{type:"anthropic_unknown"}:t.type.endsWith("_tool_result")&&"tool_use_id"in t?{type:"tool_call_response",id:t.tool_use_id,response:Ym(t.content)}:{type:`anthropic_${t.type}`}}}function Bu(t){return t==null?[]:typeof t=="string"?[{type:"text",text:t}]:t.map(i=>i.type==="text"||i.type==="search_result"?ns(i):typeof i.type!="string"?{type:"unknown"}:{type:i.type})}function Ym(t){return t==null?[]:typeof t=="string"?[{type:"text",text:t}]:Array.isArray(t)?t.map(i=>i.type==="text"||i.type==="search_result"||i.type==="web_search_result"?ns(i):typeof i.type!="string"?{type:"unknown"}:{type:i.type}):[ns(t)]}function ns(t){if(Array.isArray(t))return t.map(ns);if(typeof t!="object"||t===null)return t;let{type:i,file_type:e}=t;if(i==="image"||i==="document")return{type:i};let r=i==="text_editor_code_execution_view_result"&&(e==="image"||e==="pdf");return Object.fromEntries(Object.entries(t).filter(([n])=>!n.startsWith("encrypted_")&&!(n==="content"&&r)).map(([n,s])=>[n,ns(s)]))}function qu(t,i,e){let{[Sa]:r,[sr]:n,[nr]:s,[$t]:o,[is]:l,...p}=i,_={[sr]:n,[nr]:s,[$t]:o},m={},h=l?.map(T=>JSON.stringify(T)),y=3*([...r??[],...h??[]].reduce((T,x)=>T+x.length+1,2)+Mu(p,m)+Mu(_,m))<=e?T=>3*T.length:Pa,w=()=>Object.keys(_).reduce((T,x)=>T+y(m[x]??""),0),k=r?.reduce((T,x)=>T+y(x),0)??0,S=r!==void 0&&k<=e,R=S?k:0,A=r!==void 0&&!S;for(let T of Object.keys(p)){let x=y(m[T]??"");x>e?(delete m[T],A=!0):R+=x}let C=w();if(R+C>e){let{truncated:T,...x}=Qm(_,R+C-e);A||(A=T),Mu(x,m),C=w()}if(R+=C,h!==void 0){let T=Zm(h,e-R,y);m[is]=T.json,R+=T.size,A||(A=T.truncated)}A&&t.setAttribute(zh,!0),S&&t.setAttribute(Sa,r);for(let[T,x]of Object.entries(m))t.setAttribute(T,x);return R}function Mu(t,i){let e=0;for(let[r,n]of Object.entries(t))n!==void 0&&(i[r]=JSON.stringify(n),e+=i[r].length);return e}function Qm(t,i){let e=_=>_?.map(m=>({...m,parts:[...m.parts]})),r=t[sr]?.slice(),n=e(t[nr]),s=e(t[$t]),o=[r??[],...[...n??[],...s??[]].map(({parts:_})=>_)],l=o.reduce((_,m)=>_+m.length,0),p=!1;for(let _ of o){let m=0;for(;i>0&&m<_.length;){let h=_[m],g=Pa(JSON.stringify(h)),y=h.content;if(l===1&&h.type==="text"&&typeof y=="string"){let w=Xm(h,y,g-i);w!==y&&(_[m]={...h,content:w},p=!0);break}i-=g+(m+1<_.length?1:0),m++,l--,p=!0}_.splice(0,m)}return{[sr]:r,[nr]:n,[$t]:s,truncated:p}}function Xm(t,i,e){let r=e-Pa(JSON.stringify({...t,content:""})),n=i.slice(0,Math.max(r,0)),s=JSON.stringify(n),o=0,l=0,p=0;for(;o<n.length;){let _=s.codePointAt(1+l),m=_>65535?2:1,h=_!==92?m:s[2+l]==="u"?6:2;if(p+=_<128?h:_<2048?2:_<65536?3:4,p>r)break;l+=h,o+=m}return i.slice(0,o)}function Zm(t,i,e){let r=[],n=2;for(let s of t){let o=n+(r.length===0?0:1)+e(s);if(o>i)break;r.push(s),n=o}return{json:"["+r.join(",")+"]",size:n,truncated:r.length<t.length}}function Pa(t){let i=0;for(let e=0;e<t.length;e++){let r=t.charCodeAt(e);r<128?i+=1:r<2048?i+=2:r>=55296&&r<56320&&(t.charCodeAt(e+1)&64512)===56320?(i+=4,e++):i+=3}return i}function Ta(t,i,e){if(!X(i)||(typeof i.input_tokens=="number"&&t.setAttribute(Th,Bh(i)),!e))return;let n=(Array.isArray(i.iterations)?i.iterations:[]).filter(s=>X(s)&&s.type==="compaction");n.length>0&&(t.setAttribute(Oh,n.reduce((s,o)=>s+Bh(o),0)),t.setAttribute(Mh,n.reduce((s,o)=>s+qh(o,"output_tokens"),0)))}var eg=["input_tokens","cache_read_input_tokens","cache_creation_input_tokens"];function Bh(t){return eg.reduce((i,e)=>i+qh(t,e),0)}function qh(t,i){let e=t[i];return typeof e=="number"?e:0}function it(t,i){let e=M(t,()=>{let r=X(i.body)?i.body.output_config:void 0,n=X(r)?r.format:void 0;return X(n)&&n.type==="json_schema"?{[ka]:Aa}:{}});return{route:"/v1/messages",request:i,attributes:e}}function Lu(t){return M(void 0,()=>{let i=X(t)?t.agent:void 0,e=X(i)?i.id:i;return typeof e=="string"?{[vh]:e}:{}})}function os(t,i,e){if(!i?.span.isRecording())return i;try{let{contentMode:r,maxContentBytes:n}=t.openTelemetry.traces;r==="content"&&ss(i,e,void 0,n)}catch(r){I(t).debug("could not record the request on its span",r)}return i}function as(t,i,e,r){if(!(!i?.span.isRecording()||r instanceof ue))try{Ta(i.span,r.usage,!0);let{contentMode:n,maxContentBytes:s}=t.openTelemetry.traces;n==="content"&&ss(i,e,r.content,s)}catch(n){I(t).debug("could not record the response on its span",n)}}function Lh(){let t=new Set(["traceparent","tracestate","baggage"]);try{for(let i of Jn.fields())t.add(i.toLowerCase())}catch(i){ma().debug("could not record telemetry",i)}return t}function Ra(t){let i=Lh(),e=Array.from(t.entries()).filter(([r])=>i.has(r));for(let[r]of e)t.delete(r);return e}function $u(t){return(i,e,r)=>{let n=new Headers(i.headers),s=Ra(n);return t({...i,headers:n},o=>{let l=new Headers(o.headers);for(let[p,_]of s)l.set(p,_);return e({...o,headers:l})},r)}}z();function or(t,i,e,r){if(!(!i.span.isRecording()||t.openTelemetry.traces.contentMode!=="content"))try{ss(i,e,r.content,t.openTelemetry.traces.maxContentBytes)}catch(n){I(t).debug("could not record the streamed message on its span",n)}}function Fu(t,i,e,r){r.options.__span?.name==="anthropic.messages.create"&&e instanceof ue?rg(t,i,e,r):ch(i,e,r)}function rg(t,i,e,r){if(!i.isRecording())return;i.setAttribute(ba,r.response.status),va(i,r.response);let n=r.options.__span,s=n?.startTime,o,l,p=!1,_=!1,m=!1;Au(e,r.controller.signal,{onItem(h){try{switch(h.type){case"message_start":{let g={...h.message};l={...h.message.usage},o={};for(let[,[y]]of ya[n?.name??""]?.response??[])y!==void 0&&y!=="usage"&&(o[y]=g[y]);break}case"content_block_start":{let g=h.content_block;o&&X(g)&&g.type==="fallback"&&X(g.to)&&(o.model=g.to.model);break}case"message_delta":if(o&&l){let g=X(h.usage)?h.usage:{};l.output_tokens=g.output_tokens;for(let y of ng)g[y]!=null&&(l[y]=g[y]);h.delta.stop_reason!=null&&(o.stop_reason=h.delta.stop_reason),_=!0}break;case"message_stop":m=!0;break;case"content_block_delta":!p&&s!==void 0&&i.setAttribute(Eh,(Date.now()-s)/1e3),p=!0;break;case"content_block_stop":break;default:}}catch(g){I(t).debug("could not record the stream on its span",g)}},onEnd(h){try{if(o&&l&&n){let y=_||m,w={...o,usage:l};if(!y)for(let k of ig)w=$h(w,k);ku(i,n.name,w),Ta(i,l,y)}}catch(y){I(t).debug("could not record the stream on its span",y)}let g=n?.failure;!m&&n?.streamed&&g===void 0&&or(t,n,n.streamed.body,n.streamed.message),h.reason==="failed"?ze(i,h.error):g!==void 0?ze(i,g,"client_error"):h.reason==="completed"&&(m?i.setStatus({code:ke.OK}):ze(i,new E("The stream ended before message_stop."),"api_error")),M(t,()=>i.end())}})}var ig=[["stop_reason"],["usage","output_tokens"],["usage","output_tokens_details"]],ng=["input_tokens","cache_creation_input_tokens","cache_read_input_tokens","output_tokens_details","iterations"];function $h(t,i){let[e,...r]=i;if(e===void 0||!(e in t))return t;if(r.length===0){let{[e]:s,...o}=t;return o}let n=t[e];return X(n)?{...t,[e]:$h(n,r)}:t}function Uu(t,i,e){return t._tracer?.startSpan("anthropic.environment.work",{kind:yt.INTERNAL,attributes:{[Bt]:t._genAIProviderName,"anthropic.environment.id":i.environment_id,"anthropic.environment.work.id":i.id,"anthropic.session.id":i.data.id}},e)}function Ca(t,i){t?.isRecording()&&(i.aborted||t.setStatus({code:ke.OK}),t.end())}function Ia(t,i,e){t?.isRecording()&&(i.aborted||ze(t,e),t.end())}async function Hu(t,i,e,r){if(!i)return r();try{await Z.with(Se.setSpan(Z.active(),i),r)}catch(n){throw M(t,()=>Ia(i,e,n)),n}M(t,()=>Ca(i,e))}var Ft="x-stainless-helper",ar="x-stainless-helper-method";function cr(t){return{[Ft]:t}}var Le=Symbol("anthropic.sdk.stainlessHelper");function nt(t){return typeof t=="object"&&t!==null&&Le in t}function Wu(t,i){let e=new Set;if(t)for(let r of t)nt(r)&&e.add(r[Le]);if(i)for(let r of i){nt(r)&&e.add(r[Le]);let n=r.content;if(Array.isArray(n))for(let s of n){nt(s)&&e.add(s[Le]);let o=s?.tool?.definition;nt(o)&&e.add(o[Le])}}return Array.from(e)}function za(t,i){let e=Wu(t,i);return e.length===0?{}:{[Ft]:e.join(", ")}}function Na(t){return nt(t)?{[Ft]:t[Le]}:{}}function ju(t,i,e){if(!t._tracer)return;let r=i.output_config?.format?.type==="json_schema"||i.output_format?.type==="json_schema";return t._tracer.startSpan("anthropic.messages.tool_runner",{kind:yt.INTERNAL,attributes:{[Ou]:Ch,[Bt]:t._genAIProviderName,[wh]:i.model,...r?{[ka]:Aa}:void 0,...e!=null?{[es]:e}:void 0}})}async function lr(t,i,e,r,n){let s=t._tracer;if(!s)return n();let{signal:o,conversationId:l,sessionID:p,parentContext:_=Z.active()}=r,m="description"in i?i.description:void 0,h={[Ou]:Rh,[Bt]:t._genAIProviderName,[xh]:e.name,..."toolset_name"in e&&typeof e.toolset_name=="string"?{[Nh]:e.toolset_name}:void 0,...m?{[Ah]:m}:void 0,[Sh]:e.id,[Ph]:Ih,...l!=null?{[es]:l}:void 0,...p!=null?{"anthropic.session.id":p}:void 0,..."session_thread_id"in e&&e.session_thread_id!=null?{"anthropic.session.thread.id":e.session_thread_id}:void 0},g=e.type==="agent.tool_use"?"anthropic.tool_use":nt(i)&&i[Le]==="mcpTool"?"anthropic.mcp_tool_use":"anthropic.custom_tool_use",y=M(t,()=>s.startSpan(`${g} ${e.name}`,{kind:yt.INTERNAL,attributes:h},_));if(!y)return n();let w;try{return w=await Z.with(Se.setSpan(_,y),n),w}finally{let k=w!==void 0&&!w.isError,S=!k&&o?.aborted===!0,{contentMode:R,maxContentBytes:A}=t.openTelemetry.traces;if(R==="content"&&y.isRecording())try{qu(y,{[kh]:e.input,[is]:w&&!S?Bu(w.content):void 0},A)}catch(C){I(t).debug("could not record the tool run on its span",C)}M(t,()=>{k?y.setStatus({code:ke.OK}):S||ze(y,w,"tool_error"),y.end()})}}var Ne,wt=(()=>{class t extends Promise{constructor(e,r,n=Ea){super(s=>{s(null)}),this.responsePromise=r,this.parseResponse=n,Ne.set(this,void 0),b(this,Ne,e,"f")}_responseProps(){return this.responsePromise}_thenUnwrap(e){return new t(a(this,Ne,"f"),this.responsePromise,async(r,n)=>qt(e(await this.parseResponse(r,n),n),n.response))}asResponse(){return this.responsePromise.then(e=>{let r=e.options.__span?.span;if(r&&!this.parsedPromise){let n={status:"success",...e,data:void 0};M(a(this,Ne,"f"),()=>vt(r,n))}return e.response})}async withResponse(){let[e,r]=await Promise.all([this.parse(),this.asResponse()]);return{data:e,response:r,request_id:r.headers.get("request-id"),workspace_id:r.headers.get("anthropic-workspace-id")}}parse(){return this.parsedPromise||(this.parsedPromise=this.responsePromise.then(e=>this.parseResponseTraced(e))),this.parsedPromise}async parseResponseTraced(e){let r=e.options.__span;if(!r)return this.parseResponse(a(this,Ne,"f"),e);let{span:n}=r,s;try{s=await this.parseResponse(a(this,Ne,"f"),e)}catch(l){let p={status:"error",...e,error:l};throw M(a(this,Ne,"f"),()=>vt(n,p)),l}let o={status:"success",...e,data:s};return M(a(this,Ne,"f"),()=>nh(r,s)),e.options.stream&&rs(s)?M(a(this,Ne,"f"),()=>Fu(a(this,Ne,"f"),n,s,e)):M(a(this,Ne,"f"),()=>vt(n,o)),s}then(e,r){return this.parse().then(e,r)}catch(e){return this.parse().catch(e)}finally(e){return this.parse().finally(e)}}return Ne=new WeakMap,t})();var cs,Ma=(()=>{class t{constructor(e,r,n,s){cs.set(this,void 0),b(this,cs,e,"f"),this.options=s,this.response=r,this.body=n}hasNextPage(){return this.getPaginatedItems().length?this.nextPageRequestOptions()!=null:!1}async getNextPage(){let e=this.nextPageRequestOptions();if(!e)throw new E("No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.");let r=this.options.__span;return await a(this,cs,"f").requestAPIList(this.constructor,{...e,__span:r&&c(a(this,cs,"f"),r.name,{openTelemetry:this.options.openTelemetry},{route:r.route,queryParams:r.queryParams,contentQueryParams:r.contentQueryParams,attributes:r.attributes,request:e})})}async*iterPages(){let e=this;for(yield e;e.hasNextPage();)e=await e.getNextPage(),yield e}async*[(cs=new WeakMap,Symbol.asyncIterator)](){for await(let e of this.iterPages())for(let r of e.getPaginatedItems())yield r}}return t})(),Ku=(()=>{class t extends wt{constructor(e,r,n){super(e,r,async(s,o)=>new n(s,o.response,await Ea(s,o),o.options))}async*[Symbol.asyncIterator](){let e=await this;for await(let r of e)yield r}}return t})(),F=class extends Ma{constructor(i,e,r,n){super(i,e,r,n),this.data=r.data||[],this.has_more=r.has_more||!1,this.first_id=r.first_id||null,this.last_id=r.last_id||null}getPaginatedItems(){return this.data??[]}hasNextPage(){return this.has_more===!1?!1:super.hasNextPage()}nextPageRequestOptions(){if(this.options.query?.before_id){let e=this.first_id;return e?{...this.options,query:{...rr(this.options.query),before_id:e}}:null}let i=this.last_id;return i?{...this.options,query:{...rr(this.options.query),after_id:i}}:null}};var v=class extends Ma{constructor(i,e,r,n){super(i,e,r,n),this.data=r.data||[],this.next_page=r.next_page||null}getPaginatedItems(){return this.data??[]}hasNextPage(){return this.nextPageRequestOptions()!=null}nextPageRequestOptions(){let i=this.next_page;return i?{...this.options,query:{...rr(this.options.query),page:i}}:null}},Oa=class extends Ma{constructor(i,e,r,n){super(i,e,r,n),this.data=r.data||[],this.next_page=r.next_page||null,this.prev_page=r.prev_page||null}getPaginatedItems(){return this.data??[]}hasNextPage(){return this.nextPageRequestOptions()!=null}nextPageRequestOptions(){let i=this.next_page;return i?{...this.options,query:{...rr(this.options.query),page:i}}:null}},fe=class extends Ma{constructor(i,e,r,n){super(i,e,r,n),this.data=r.data||[],this.next_page=r.next_page||null,this.has_more=r.has_more||!1,this.data_refreshed_at=r.data_refreshed_at||null}getPaginatedItems(){return this.data??[]}hasNextPage(){return this.has_more===!1?!1:this.nextPageRequestOptions()!=null}nextPageRequestOptions(){let i=this.next_page;return i?{...this.options,query:{...rr(this.options.query),page:i}}:null}};z();function Uh(t){return t.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g,encodeURIComponent)}var Fh=Object.freeze(Object.create(null)),og=(t=Uh)=>function(e,...r){if(e.length===1)return e[0];let n=!1,s=[],o=e.reduce((m,h,g)=>{/[?#]/.test(h)&&(n=!0);let y=r[g],w=(n?encodeURIComponent:t)(""+y);return g!==r.length&&(y==null||typeof y=="object"&&y.toString===Object.getPrototypeOf(Object.getPrototypeOf(y.hasOwnProperty??Fh)??Fh)?.toString)&&(w=y+"",s.push({start:m.length+h.length,length:w.length,error:`Value of type ${Object.prototype.toString.call(y).slice(8,-1)} is not a valid path parameter`})),!n&&(w===""||w.startsWith(";"))&&s.push({start:m.length+h.length,length:w.length,error:`Value "${w}" can't be safely passed as a path parameter`}),m+h+(g===r.length?"":w)},""),l=o.split(/[?#]/,1)[0],p=new RegExp("(?<=^|\\/)(?:\\.|%2e){1,2}(?:;[^/]*)?(?=\\/|$)","gi"),_;for(;(_=p.exec(l))!==null;)s.push({start:_.index,length:_[0].length,error:`Value "${_[0]}" can't be safely passed as a path parameter`});if(s.sort((m,h)=>m.start-h.start),s.length>0){let m=[];for(let g of s)for(let y=g.start;y<g.start+Math.max(1,g.length);y++)m[y]="^";let h=Array.from(m,g=>g??" ").join("");throw new E(`Path parameters result in path with invalid segments:
${s.map(g=>g.error).join(`
`)}
${o}
${h}`)}return o},u=og(Uh);var ur=(()=>{class t extends P{}return t._errorName="FileNotDownloadableError",t})(),dr=(()=>{class t extends P{}return t._errorName="StorageQuotaExceededError",t})(),pr=(()=>{class t extends ae{}return t._errorName="FileExpiredError",t})(),ls=(()=>{class t extends f{list(e={},r){let{workspace_id:n,...s}=e??{};return this._client.getAPIList("/v1/files",v,{query:s,...r,headers:d([{...n!=null?{"anthropic-workspace-id":n}:void 0},r?.headers]),__span:c(this._client,"anthropic.files.list",r,{route:"/v1/files",queryParams:["ids","limit","page"]})})}delete(e,r={},n){let{workspace_id:s}=r??{};return this._client.delete(u`/v1/files/${e}`,{...n,headers:d([{...s!=null?{"anthropic-workspace-id":s}:void 0},n?.headers]),__span:c(this._client,"anthropic.files.delete",n,{route:"/v1/files/{file_id}",attributes:{"anthropic.file.id":e}})})}download(e,r={},n){let{workspace_id:s}=r??{};return this._client.get(u`/v1/files/${e}/content`,{...n,headers:d([{Accept:"application/binary",...s!=null?{"anthropic-workspace-id":s}:void 0},n?.headers]),__binaryResponse:!0,__span:c(this._client,"anthropic.files.download",n,{route:"/v1/files/{file_id}/content",attributes:{"anthropic.file.id":e}})})}retrieveMetadata(e,r={},n){let{workspace_id:s}=r??{};return this._client.get(u`/v1/files/${e}`,{...n,headers:d([{...s!=null?{"anthropic-workspace-id":s}:void 0},n?.headers]),__span:c(this._client,"anthropic.files.retrieve_metadata",n,{route:"/v1/files/{file_id}",attributes:{"anthropic.file.id":e}})})}upload(e,r){let{workspace_id:n,...s}=e;return this._client.post("/v1/files",ne({body:s,...r,headers:d([{...n!=null?{"anthropic-workspace-id":n}:void 0},Na(s.file),r?.headers]),__span:c(this._client,"anthropic.files.upload",r,{route:"/v1/files",createdIDAttribute:"anthropic.file.id"})},this._client))}}return t.FileNotDownloadableError=ur,t.StorageQuotaExceededError=dr,t.FileExpiredError=pr,t})();z();var Ba=(()=>{class t extends P{}return t._errorName="ClaudeCodeKeyCreatorNotMemberError",t})(),qa=(()=>{class t extends P{}return t._errorName="ClaudeCodeVersionTooOldError",t})(),La=(()=>{class t extends P{}return t._errorName="CMEKKeyDisabledError",t})(),$a=(()=>{class t extends P{}return t._errorName="CMEKKeyNetworkBlockedError",t})(),Fa=(()=>{class t extends P{}return t._errorName="OrganizationOnHoldError",t})(),Ua=(()=>{class t extends P{}return t._errorName="OrganizationTypeNotSupportedError",t})(),Ha=(()=>{class t extends P{}return t._errorName="ParentOrganizationRequiredError",t})(),Wa=(()=>{class t extends P{}return t._errorName="RequestBodyEncodingInvalidError",t})(),ja=(()=>{class t extends P{}return t._errorName="RequestBodyEncodingUnsupportedError",t})(),Ka=(()=>{class t extends tr{}return t._errorName="LinkedOrganizationBillingUnavailableError",t})(),Da=(()=>{class t extends tr{}return t._errorName="LinkedOrganizationSpendLimitReachedError",t})(),Ga=(()=>{class t extends D{}return t._errorName="SandboxEgressRestrictedError",t})(),Va=(()=>{class t extends Un{}return t._errorName="RequestBodyTooLargeAfterDecodingError",t})(),Ja=(()=>{class t extends Nt{}return t._errorName="ContractSpendLimitReachedError",t})(),Ya=(()=>{class t extends Nt{}return t._errorName="EnforcedSpendLimitReachedError",t})(),Qa=(()=>{class t extends Nt{}return t._errorName="RampLimitExceededError",t})(),Xa=(()=>{class t extends ht{}return t._errorName="CMEKContextUnavailableError",t})(),Za=(()=>{class t extends ht{}return t._errorName="CMEKKeyUnreachableError",t})();var hr=class extends f{retrieve(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.get(u`/v1/deployment_runs/${i}`,{...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.deployment_runs.retrieve",r,{route:"/v1/deployment_runs/{deployment_run_id}",attributes:{"anthropic.deployment_run.id":i}})})}list(i={},e){let{betas:r,workspace_id:n,...s}=i??{};return this._client.getAPIList("/v1/deployment_runs",v,{query:s,...e,headers:d([{"anthropic-beta":[...r??[],"managed-agents-2026-04-01"].toString(),...n!=null?{"anthropic-workspace-id":n}:void 0},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.deployment_runs.list",e,{route:"/v1/deployment_runs",queryParams:["created_at[gt]","created_at[gte]","created_at[lt]","created_at[lte]","deployment_id","has_error","limit","page","trigger_type"]})})}};var _r=class extends f{create(i,e){let{betas:r,workspace_id:n,...s}=i;return this._client.post("/v1/deployments",{body:s,...e,headers:d([{"anthropic-beta":[...r??[],"managed-agents-2026-04-01"].toString(),...n!=null?{"anthropic-workspace-id":n}:void 0},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.deployments.create",e,{route:"/v1/deployments",createdIDAttribute:"anthropic.deployment.id"})})}retrieve(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.get(u`/v1/deployments/${i}`,{...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.deployments.retrieve",r,{route:"/v1/deployments/{deployment_id}",attributes:{"anthropic.deployment.id":i}})})}update(i,e,r){let{betas:n,workspace_id:s,...o}=e;return this._client.post(u`/v1/deployments/${i}`,{body:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.deployments.update",r,{route:"/v1/deployments/{deployment_id}",attributes:{"anthropic.deployment.id":i}})})}list(i={},e){let{betas:r,workspace_id:n,...s}=i??{};return this._client.getAPIList("/v1/deployments",v,{query:s,...e,headers:d([{"anthropic-beta":[...r??[],"managed-agents-2026-04-01"].toString(),...n!=null?{"anthropic-workspace-id":n}:void 0},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.deployments.list",e,{route:"/v1/deployments",queryParams:["agent_id","created_at[gte]","created_at[lte]","include_archived","limit","page","status"]})})}archive(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.post(u`/v1/deployments/${i}/archive`,{...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.deployments.archive",r,{route:"/v1/deployments/{deployment_id}/archive",attributes:{"anthropic.deployment.id":i}})})}pause(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.post(u`/v1/deployments/${i}/pause`,{...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.deployments.pause",r,{route:"/v1/deployments/{deployment_id}/pause",attributes:{"anthropic.deployment.id":i}})})}run(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.post(u`/v1/deployments/${i}/run`,{...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.deployments.run",r,{route:"/v1/deployments/{deployment_id}/run",attributes:{"anthropic.deployment.id":i}})})}unpause(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.post(u`/v1/deployments/${i}/unpause`,{...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.deployments.unpause",r,{route:"/v1/deployments/{deployment_id}/unpause",attributes:{"anthropic.deployment.id":i}})})}};var fr=class extends f{create(i,e){let{betas:r,workspace_id:n,...s}=i;return this._client.post("/v1/dreams",{body:s,...e,headers:d([{"anthropic-beta":[...r??[],"dreaming-2026-04-21"].toString(),...n!=null?{"anthropic-workspace-id":n}:void 0},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.dreams.create",e,{route:"/v1/dreams",createdIDAttribute:"anthropic.dream.id"})})}retrieve(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.get(u`/v1/dreams/${i}`,{...r,headers:d([{"anthropic-beta":[...n??[],"dreaming-2026-04-21"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.dreams.retrieve",r,{route:"/v1/dreams/{dream_id}",attributes:{"anthropic.dream.id":i}})})}list(i={},e){let{betas:r,workspace_id:n,...s}=i??{};return this._client.getAPIList("/v1/dreams",v,{query:s,...e,headers:d([{"anthropic-beta":[...r??[],"dreaming-2026-04-21"].toString(),...n!=null?{"anthropic-workspace-id":n}:void 0},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.dreams.list",e,{route:"/v1/dreams",queryParams:["created_at[gt]","created_at[lt]","include_archived","limit","page","statuses"]})})}archive(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.post(u`/v1/dreams/${i}/archive`,{...r,headers:d([{"anthropic-beta":[...n??[],"dreaming-2026-04-21"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.dreams.archive",r,{route:"/v1/dreams/{dream_id}/archive",attributes:{"anthropic.dream.id":i}})})}cancel(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.post(u`/v1/dreams/${i}/cancel`,{...r,headers:d([{"anthropic-beta":[...n??[],"dreaming-2026-04-21"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.dreams.cancel",r,{route:"/v1/dreams/{dream_id}/cancel",attributes:{"anthropic.dream.id":i}})})}};var mr=class extends f{list(i={},e){let{betas:r,workspace_id:n,...s}=i??{};return this._client.getAPIList("/v1/files",v,{query:s,...e,headers:d([{...r?.toString()!=null?{"anthropic-beta":r?.toString()}:void 0,...n!=null?{"anthropic-workspace-id":n}:void 0},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.files.list",e,{route:"/v1/files",queryParams:["ids","limit","page","scope_id"]})})}delete(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.delete(u`/v1/files/${i}`,{...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0,...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.files.delete",r,{route:"/v1/files/{file_id}",attributes:{"anthropic.file.id":i}})})}download(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.get(u`/v1/files/${i}/content`,{...r,headers:d([{Accept:"application/binary",...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0,...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__binaryResponse:!0,__span:c(this._client,"anthropic.files.download",r,{route:"/v1/files/{file_id}/content",attributes:{"anthropic.file.id":i}})})}retrieveMetadata(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.get(u`/v1/files/${i}`,{...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0,...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.files.retrieve_metadata",r,{route:"/v1/files/{file_id}",attributes:{"anthropic.file.id":i}})})}upload(i,e){let{betas:r,workspace_id:n,...s}=i;return this._client.post("/v1/files",ne({body:s,...e,headers:d([{...r?.toString()!=null?{"anthropic-beta":r?.toString()}:void 0,...n!=null?{"anthropic-workspace-id":n}:void 0},Na(s.file),e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.files.upload",e,{route:"/v1/files",createdIDAttribute:"anthropic.file.id"})},this._client))}};var gr=class extends f{retrieve(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.get(u`/v1/models/${i}`,{...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0,...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.models.retrieve",r,{route:"/v1/models/{model_id}",attributes:{"anthropic.model.id":i}})})}list(i={},e){let{betas:r,workspace_id:n,...s}=i??{};return this._client.getAPIList("/v1/models",F,{query:s,...e,headers:d([{...r?.toString()!=null?{"anthropic-beta":r?.toString()}:void 0,...n!=null?{"anthropic-workspace-id":n}:void 0},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.models.list",e,{route:"/v1/models",queryParams:["after_id","before_id","lifecycle","limit"]})})}};var Zh=Gf(Xh(),1),yr=class extends f{parseUnverified(i){return JSON.parse(i)}unwrap(i,e){let r=e?.headers;if(r==null)throw new Error("Webhook headers are required in order to verify the signature");let n=e.key===void 0?this._client.webhookKey:e.key;if(!n)throw new Error("Webhook key must not be null or empty in order to unwrap");return new Zh.Webhook(n).verify(i,r),JSON.parse(i)}};var vr=class extends f{list(i,e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList(u`/v1/agents/${i}/versions`,v,{query:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.agents.versions.list",r,{route:"/v1/agents/{agent_id}/versions",queryParams:["limit","page"],attributes:{"gen_ai.agent.id":i}})})}};var rc=(()=>{class t extends f{constructor(){super(...arguments),this.versions=new vr(this._client)}create(e,r){let{betas:n,workspace_id:s,...o}=e;return this._client.post("/v1/agents",{body:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.agents.create",r,{route:"/v1/agents",createdIDAttribute:"gen_ai.agent.id"})})}retrieve(e,r={},n){let{betas:s,workspace_id:o,...l}=r??{};return this._client.get(u`/v1/agents/${e}`,{query:l,...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.agents.retrieve",n,{route:"/v1/agents/{agent_id}",queryParams:["version"],attributes:{"gen_ai.agent.id":e}})})}update(e,r,n){let{betas:s,workspace_id:o,...l}=r;return this._client.post(u`/v1/agents/${e}`,{body:l,...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.agents.update",n,{route:"/v1/agents/{agent_id}",attributes:{"gen_ai.agent.id":e}})})}list(e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList("/v1/agents",v,{query:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.agents.list",r,{route:"/v1/agents",queryParams:["created_at[gte]","created_at[lte]","include_archived","limit","page"]})})}archive(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.post(u`/v1/agents/${e}/archive`,{...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.agents.archive",n,{route:"/v1/agents/{agent_id}/archive",attributes:{"gen_ai.agent.id":e}})})}}return t.Versions=vr,t})();z();z();var ic=function(){let{crypto:t}=globalThis;if(t?.randomUUID)return ic=t.randomUUID.bind(t),t.randomUUID();let i=new Uint8Array(1),e=t?()=>t.getRandomValues(i)[0]:()=>Math.random()*255&255;return"10000000-1000-4000-8000-100000000000".replace(/[018]/g,r=>(+r^e()&15>>+r/4).toString(16))};function Et(t,i){if(!t)return()=>{};if(t.aborted)return i.abort(),()=>{};let e=()=>i.abort();return t.addEventListener("abort",e),()=>t.removeEventListener("abort",e)}z();function kt(t,i){return t instanceof $&&t.status===i}function wg(t){return t instanceof $&&typeof t.status=="number"&&t.status>=400&&t.status<500}function Ut(t){return wg(t)&&!kt(t,408)&&!kt(t,409)&&!kt(t,429)}function nc(t,i,e){return Math.min(i*2**t,e)}function e_(t,i){return t+Math.random()*(i-t)}function sc(t){return t*(1-Math.random()*.25)}z();function oc(t,{authToken:i,helper:e}){if(!i)throw new E(`copyClientForHelper: expected a non-empty authToken but received ${JSON.stringify(i)}`);let r=t._options.defaultHeaders,n=t._authState?.extraHeaders,s=n?Object.fromEntries(Object.entries(n).filter(([l])=>{let p=l.toLowerCase();return p!=="authorization"&&p!=="x-api-key"})):void 0,o=d([s,r,{[Ft]:e}]);return o.values.delete("x-api-key"),o.values.delete("authorization"),o.nulls.delete("authorization"),t.withOptions({authToken:i,baseURL:t.baseURL,defaultHeaders:o})}var wr,ac,me,cc,lc,uc,ds,ps,Er,kr,dc,Sr,hs,Eg=999,kg=1e3,Sg=6e4,Ag=3e5,_s=(()=>{class t{constructor(e){wr.set(this,void 0),ac.set(this,!1),me.set(this,void 0),cc.set(this,void 0),lc.set(this,void 0),uc.set(this,void 0),ds.set(this,void 0),ps.set(this,void 0),Er.set(this,void 0),this.client=e.client,this.environmentId=e.environmentId,this.environmentKey=e.environmentKey,this.workerId=e.workerId??Tg(),b(this,wr,oc(e.client,{authToken:e.environmentKey,helper:"environments-work-poller"}),"f"),b(this,lc,e.autoStop??!0,"f"),b(this,uc,e.drain??!1,"f"),b(this,ds,e.blockMs===void 0?Eg:e.blockMs,"f"),b(this,ps,e.reclaimOlderThanMs??null,"f"),b(this,Er,e.requestOptions,"f"),b(this,me,new AbortController,"f"),b(this,cc,Et(e.signal,a(this,me,"f")),"f")}get signal(){return a(this,me,"f").signal}abort(){a(this,me,"f").abort()}async*[(wr=new WeakMap,ac=new WeakMap,me=new WeakMap,cc=new WeakMap,lc=new WeakMap,uc=new WeakMap,ds=new WeakMap,ps=new WeakMap,Er=new WeakMap,Symbol.asyncIterator)](){if(a(this,ac,"f"))throw new E("Cannot iterate over a consumed WorkPoller");b(this,ac,!0,"f");let e=Z.active(),r=I(this.client);r.info("poller starting",{component:"work-poller",environment_id:this.environmentId});let n=new Pg(r,this.environmentId);try{let s=0;for(;!a(this,me,"f").signal.aborted;){let o;try{o=await a(this,wr,"f").beta.environments.work.poll(this.environmentId,{"Anthropic-Worker-ID":this.workerId,...a(this,ds,"f")!==null?{block_ms:a(this,ds,"f")}:{},...a(this,ps,"f")!==null?{reclaim_older_than_ms:a(this,ps,"f")}:{}},{headers:d([a(this,Er,"f")?.headers]),signal:a(this,me,"f").signal})}catch(l){if(a(this,me,"f").signal.aborted)return;if(Ut(l))throw r.error("poll failed permanently, stopping poller",{error:String(l)}),l;let p=sc(xg(s));r.warn("poll failed, backing off",{error:String(l),backoff_ms:p}),s++,await Be(p,a(this,me,"f").signal);continue}if(s=0,o==null){if(a(this,uc,"f"))return;n.onEmptyPoll(),await Be(e_(1e3,3e3),a(this,me,"f").signal);continue}n.onClaim(),this._workSpan=M(this.client,()=>Uu(this.client,o,e)),r.info("claimed work",{component:"work-poller",environment_id:this.environmentId,work_id:o.id,work_type:o.data.type});try{await a(this,wr,"f").beta.environments.work.ack(o.id,{environment_id:o.environment_id},{headers:d([a(this,Er,"f")?.headers]),signal:a(this,me,"f").signal})}catch(l){r.error("ack failed",{work_id:o.id,error:String(l)}),M(this.client,()=>Ia(this._workSpan,a(this,me,"f").signal,l));continue}try{yield o,e=Z.active()}finally{if(a(this,lc,"f"))try{await a(this,wr,"f").beta.environments.work.stop(o.id,{environment_id:o.environment_id},{headers:d([a(this,Er,"f")?.headers])})}catch(l){kt(l,409)||r.warn("stop failed",{work_id:o.id,error:String(l)})}M(this.client,()=>Ca(this._workSpan,a(this,me,"f").signal))}}}finally{a(this,cc,"f").call(this)}}}return t})();function xg(t){return nc(t,kg,Sg)}var Pg=(()=>{class t{constructor(e,r){kr.set(this,void 0),dc.set(this,void 0),Sr.set(this,void 0),hs.set(this,0),b(this,kr,e,"f"),b(this,dc,r,"f")}onEmptyPoll(){let e=Date.now(),r={component:"work-poller",environment_id:a(this,dc,"f")};a(this,Sr,"f")===void 0?(b(this,Sr,b(this,hs,e,"f"),"f"),a(this,kr,"f").info("idle; polling for work",r)):e-a(this,hs,"f")>=Ag?(b(this,hs,e,"f"),a(this,kr,"f").info(`still polling; idle for ${Math.round((e-a(this,Sr,"f"))/1e3)}s`,r)):a(this,kr,"f").debug("poll returned no work",r)}onClaim(){b(this,Sr,void 0,"f")}}return kr=new WeakMap,dc=new WeakMap,Sr=new WeakMap,hs=new WeakMap,t})();function Tg(){let i=globalThis.process?.env?.HOSTNAME;return i?`${i}-${ic()}`:ic()}z();z();var t_=t=>{if(typeof globalThis.Buffer<"u"){let i=globalThis.Buffer.from(t,"base64");return new Uint8Array(i.buffer,i.byteOffset,i.byteLength)}if(typeof atob<"u"){let i=atob(t),e=new Uint8Array(i.length);for(let r=0;r<i.length;r++)e[r]=i.charCodeAt(r);return e}throw new E("Cannot decode base64 string; Expected `Buffer` or `atob` to be defined")};z();var Ar,St,xr,r_=(()=>{class t{constructor(){Ar.set(this,[]),St.set(this,[]),xr.set(this,!1)}push(e){if(a(this,xr,"f"))return!1;let r=a(this,St,"f").shift();return r?r({done:!1,value:e}):a(this,Ar,"f").push(e),!0}close(){if(!a(this,xr,"f"))for(b(this,xr,!0,"f");a(this,St,"f").length>0;)a(this,St,"f").shift()({done:!0,value:void 0})}next(e){return a(this,Ar,"f").length>0?Promise.resolve({done:!1,value:a(this,Ar,"f").shift()}):a(this,xr,"f")||e?.aborted?Promise.resolve({done:!0,value:void 0}):new Promise(r=>{let n=o=>{e?.removeEventListener("abort",s),r(o)},s=()=>{let o=a(this,St,"f").indexOf(n);o>=0&&a(this,St,"f").splice(o,1),r({done:!0,value:void 0})};a(this,St,"f").push(n),e?.addEventListener("abort",s,{once:!0})})}tryShift(){return a(this,Ar,"f").shift()}}return Ar=new WeakMap,St=new WeakMap,xr=new WeakMap,t})();var Pr=(()=>{class t extends Error{constructor(e){let r=typeof e=="string"?e:e.map(n=>n.type==="text"?n.text:`[${n.type}]`).join(" ");super(r),this.name="ToolError",this.content=e}}return t})();var Rg="\\x00-\\x1f\\x7f-\\x9f\\u061c\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069",Cg=new RegExp(`[${Rg}]+`,"g"),Ig=/[\uD800-\uDFFF]/gu;function fs(t){return t.replace(Ig,"\uFFFD")}var i_=4096,zg=200;function Ng(t,i=i_){return s_(fs(t).replace(Cg," ").trim(),i)}function Og(t){return Ng(t,zg)}function st(t){return Og(t).replace(/[' ]+/g," ").trim()}function pc(t){return`Error: ${t instanceof Error?t.message:String(t)}`}function n_(t){return s_(fs(pc(t)),i_)}function s_(t,i){if(t.length<=i)return t;let e=0,r=0;for(let n of t){if(r===i)break;r+=1,e+=n.length}return t.slice(0,e)}function o_(t){return typeof t=="string"?fs(t):t.filter(i=>i.type==="text"&&i.text!=="").map(i=>({...i,text:fs(i.text)}))}function Qu(t){return"name"in t?t.name:"mcp_server_name"in t?t.mcp_server_name:t.type}function Mg(t){return t instanceof Pr?t.content:pc(t)}async function hc(t,i,e){try{let r=t.parse?t.parse(i):i;return{content:await t.run(r,e),isError:!1}}catch(r){return{content:Mg(r),isError:!0}}}var ms,_c,Tr,Ht,Rr,$e,H,fc,se,mc,Cr,gc,J,Ir,Te,zr,De,gs,Nr,ot,bc,bs,de,yc,ys,vs,vc,a_,c_,l_,Xu,u_,wc,Ec,Zu,d_,kc,Sc,ed,p_,h_;var __=500,Bg=1e4,qg=12e4,Lg=3e4,$g=1e3,Fg=3e4,Ug=5*6e4,Hg=6e4;function f_(t){return t.type!=="session.status_idle"?!1:t.stop_reason?.type!=="requires_action"}function m_(t){return t.type==="user.tool_confirmation"||t.type==="session.thread_status_terminated"}var Wg=(()=>{class t{constructor(e,r){ms.set(this,void 0),_c.set(this,void 0),Tr.set(this,new Set),Ht.set(this,!1),Rr.set(this,!1),$e.set(this,void 0),b(this,ms,e,"f"),b(this,_c,r,"f")}noteEvent(e){a(this,Rr,"f")&&e.type==="session.thread_status_terminated"&&this.disarm(),!m_(e)&&(b(this,Rr,!1,"f"),f_(e)?this.arm():this.disarm())}noteHistoryRead(e){b(this,Rr,!e,"f")}block(e){a(this,Tr,"f").add(e),a(this,$e,"f")!==void 0&&(b(this,Ht,!0,"f"),clearTimeout(a(this,$e,"f")),b(this,$e,void 0,"f"))}unblock(e){a(this,Tr,"f").delete(e),a(this,Tr,"f").size===0&&a(this,Ht,"f")&&this.arm()}abandon(e){a(this,Rr,"f")&&this.disarm(),this.unblock(e)}arm(){if(!(a(this,ms,"f")<=0)){if(a(this,Tr,"f").size>0){b(this,Ht,!0,"f");return}b(this,Ht,!1,"f"),a(this,$e,"f")!==void 0&&clearTimeout(a(this,$e,"f")),b(this,$e,setTimeout(a(this,_c,"f"),a(this,ms,"f")),"f")}}disarm(){b(this,Ht,!1,"f"),a(this,$e,"f")!==void 0&&(clearTimeout(a(this,$e,"f")),b(this,$e,void 0,"f"))}}return ms=new WeakMap,_c=new WeakMap,Tr=new WeakMap,Ht=new WeakMap,Rr=new WeakMap,$e=new WeakMap,t})(),ws=(()=>{class t{constructor(e,r){H.add(this),fc.set(this,!1),se.set(this,void 0),mc.set(this,void 0),Cr.set(this,void 0),gc.set(this,void 0),J.set(this,void 0),Ir.set(this,new Set),Te.set(this,new Set),zr.set(this,new Map),De.set(this,new Map),gs.set(this,new Set),Nr.set(this,new r_),ot.set(this,0),bc.set(this,Ug),bs.set(this,null),de.set(this,void 0),yc.set(this,void 0),ys.set(this,void 0),vs.set(this,!1),this.client=r.client,this.sessionId=e,this.tools=r.tools,this.maxIdleMs=r.maxIdleMs??Hg,b(this,J,I(r.client),"f"),b(this,gc,new Map(r.tools.map(n=>[Qu(n),n])),"f"),b(this,se,new AbortController,"f"),b(this,mc,Et(r.signal,a(this,se,"f")),"f"),b(this,Cr,r.requestOptions,"f"),b(this,de,new Wg(this.maxIdleMs,()=>{a(this,J,"f").info("session idle after its turn ended; stopping",{component:"session-tool-runner",session_id:this.sessionId,max_idle_ms:this.maxIdleMs}),a(this,se,"f").abort()}),"f")}get signal(){return a(this,se,"f").signal}abort(){a(this,se,"f").abort()}_setSendRetryWindow(e){b(this,bc,e,"f")}async*[(fc=new WeakMap,se=new WeakMap,mc=new WeakMap,Cr=new WeakMap,gc=new WeakMap,J=new WeakMap,Ir=new WeakMap,Te=new WeakMap,zr=new WeakMap,De=new WeakMap,gs=new WeakMap,Nr=new WeakMap,ot=new WeakMap,bc=new WeakMap,bs=new WeakMap,de=new WeakMap,yc=new WeakMap,ys=new WeakMap,vs=new WeakMap,H=new WeakSet,Symbol.asyncIterator)](){if(a(this,fc,"f"))throw new E("Cannot iterate over a consumed SessionToolRunner");b(this,fc,!0,"f"),b(this,yc,this.client._tracer?Z.active():void 0,"f"),a(this,J,"f").info("session tool runner starting",{component:"session-tool-runner",session_id:this.sessionId});let e=a(this,H,"m",a_).call(this).catch(r=>{a(this,se,"f").signal.aborted||a(this,J,"f").error("stream loop failed",{error:String(r)}),a(this,se,"f").abort()});try{for(;;){let n=await a(this,Nr,"f").next(a(this,se,"f").signal);if(n.done)break;yield n.value}await e;let r;for(;(r=a(this,Nr,"f").tryShift())!==void 0;)yield r}finally{a(this,se,"f").abort(),a(this,de,"f").disarm(),await e;try{await a(this,H,"m",h_).call(this)}catch(r){a(this,J,"f").warn("drain failed",{error:String(r)})}a(this,Nr,"f").close();for(let r of this.tools)try{await r.close?.()}catch(n){a(this,J,"f").warn("tool.close failed",{tool:Qu(r),error:String(n)})}a(this,mc,"f").call(this)}}}return vc=function(){return{...a(this,Cr,"f"),headers:d([cr("session-tool-runner"),a(this,Cr,"f")?.headers]),signal:a(this,se,"f").signal}},a_=async function(){let e=a(this,se,"f"),r=__;for(;!e.signal.aborted;){try{let n=await this.client.beta.sessions.events.stream(this.sessionId,{},a(this,H,"m",vc).call(this));await a(this,H,"m",c_).call(this);for await(let s of n)if(r=__,await a(this,H,"m",u_).call(this,s))return}catch(n){if(e.signal.throwIfAborted(),Ut(n))throw a(this,J,"f").error("permanent stream failure, shutting down",{error:String(n)}),e.abort(),n;a(this,J,"f").warn("stream disconnected, reconnecting",{error:String(n),backoff_ms:r})}e.signal.throwIfAborted(),await Be(r,e.signal),r=Math.min(r*2,Bg)}},c_=async function(){let e=a(this,se,"f"),r=[],n=!1;b(this,vs,!1,"f");try{for await(let l of this.client.beta.sessions.events.list(this.sessionId,{limit:1e3},a(this,H,"m",vc).call(this)))a(this,H,"m",l_).call(this,l,r),m_(l)||(n=f_(l))}catch(l){e.signal.throwIfAborted(),a(this,J,"f").warn("reconcile list failed",{error:String(l)});for(let p of r)a(this,Ir,"f").delete(p.id);a(this,de,"f").noteHistoryRead(!1),a(this,H,"m",Ec).call(this);return}b(this,vs,!0,"f"),a(this,de,"f").noteHistoryRead(!0),a(this,H,"m",Ec).call(this);let s=r.filter(l=>!a(this,Te,"f").has(l.id));a(this,de,"f").disarm();for(let l of s)await a(this,H,"m",Zu).call(this,l);for(let l of[...a(this,De,"f").values()]){let p=a(this,zr,"f").get(l.id);p!==void 0&&await a(this,H,"m",kc).call(this,l,p)}let o=s.filter(l=>!a(this,Te,"f").has(l.id)&&!a(this,H,"m",wc).call(this,l)&&!a(this,De,"f").has(l.id));n&&o.length===0?a(this,de,"f").arm():a(this,de,"f").disarm()},l_=function(e,r){a(this,H,"m",Xu).call(this,e),e.type==="agent.tool_use"||e.type==="agent.custom_tool_use"?(a(this,Ir,"f").add(e.id),a(this,Te,"f").has(e.id)||r.push(e)):e.type==="user.tool_result"?a(this,Te,"f").add(e.tool_use_id):e.type==="user.custom_tool_result"?a(this,Te,"f").add(e.custom_tool_use_id):e.type==="user.tool_confirmation"?a(this,Te,"f").has(e.tool_use_id)||a(this,zr,"f").set(e.tool_use_id,e.result):e.type==="session.thread_status_terminated"&&a(this,gs,"f").add(e.session_thread_id)},Xu=function(e){if(!(!this.client._tracer||a(this,ys,"f")!==void 0))switch(e.type){case"session.thread_status_running":case"session.thread_status_idle":case"session.thread_status_rescheduled":case"session.thread_status_terminated":b(this,ys,e.session_thread_id,"f")}},u_=async function(e){switch(a(this,de,"f").noteEvent(e),a(this,vs,"f")&&a(this,H,"m",Xu).call(this,e),e.type){case"agent.tool_use":case"agent.custom_tool_use":return a(this,Ir,"f").has(e.id)||(a(this,Ir,"f").add(e.id),await a(this,H,"m",Zu).call(this,e)),!1;case"user.tool_confirmation":return await a(this,H,"m",d_).call(this,e),!1;case"user.tool_result":return a(this,Te,"f").add(e.tool_use_id),!1;case"user.custom_tool_result":return a(this,Te,"f").add(e.custom_tool_use_id),!1;case"session.thread_status_terminated":return a(this,gs,"f").add(e.session_thread_id),a(this,H,"m",Ec).call(this),!1;case"session.status_terminated":case"session.deleted":return a(this,J,"f").info("session terminated",{component:"session-tool-runner",session_id:this.sessionId}),a(this,se,"f").abort(),!0;default:return!1}},wc=function(e){return!!e.session_thread_id&&a(this,gs,"f").has(e.session_thread_id)},Ec=function(){for(let e of a(this,De,"f").values())a(this,H,"m",wc).call(this,e)&&(a(this,J,"f").info("session thread terminated; not executing",{component:"session-tool-runner",session_id:this.sessionId,session_thread_id:e.session_thread_id,tool:e.name,tool_use_id:e.id}),a(this,De,"f").delete(e.id),a(this,de,"f").abandon(e.id))},Zu=async function(e){if(a(this,H,"m",wc).call(this,e)){a(this,J,"f").debug("session thread terminated; not executing",{component:"session-tool-runner",session_id:this.sessionId,session_thread_id:e.session_thread_id,tool:e.name,tool_use_id:e.id});return}let r=e.evaluated_permission,n=r==="deny"?"deny":a(this,zr,"f").get(e.id);if(n===void 0){r===void 0||r==="allow"?await a(this,H,"m",ed).call(this,e,void 0):a(this,De,"f").has(e.id)||(a(this,J,"f").info("tool call awaiting confirmation; holding",{component:"session-tool-runner",session_id:this.sessionId,tool:e.name,tool_use_id:e.id}),a(this,De,"f").set(e.id,e),a(this,de,"f").block(e.id));return}await a(this,H,"m",kc).call(this,e,n)},d_=async function(e){a(this,zr,"f").set(e.tool_use_id,e.result);let r=a(this,De,"f").get(e.tool_use_id);r!==void 0&&await a(this,H,"m",kc).call(this,r,e.result)},kc=async function(e,r){let n=a(this,De,"f").delete(e.id);if(r==="allow"){a(this,J,"f").info("tool call confirmed",{component:"session-tool-runner",session_id:this.sessionId,tool:e.name,tool_use_id:e.id}),n||a(this,de,"f").block(e.id);try{await a(this,H,"m",ed).call(this,e,"allow")}finally{a(this,de,"f").unblock(e.id)}return}n&&a(this,de,"f").unblock(e.id),a(this,Te,"f").add(e.id),a(this,J,"f").info("tool call denied; not executing",{component:"session-tool-runner",session_id:this.sessionId,tool:e.name,tool_use_id:e.id}),a(this,H,"m",Sc).call(this,{event:e,toolUseId:e.id,name:e.name,isError:!1,posted:!1,confirmation:"deny"})},Sc=function(e){a(this,Nr,"f").push(e)},ed=async function(e,r){var n,s;if(!a(this,Te,"f").has(e.id)){a(this,J,"f").info("executing tool",{component:"session-tool-runner",session_id:this.sessionId,tool:e.name,tool_use_id:e.id}),b(this,ot,(n=a(this,ot,"f"),n++,n),"f");try{let o=a(this,gc,"f").get(e.name);if(!o){a(this,J,"f").info("tool not owned by this runner; leaving the tool_use_id pending for its owner",{component:"session-tool-runner",session_id:this.sessionId,tool:e.name,tool_use_id:e.id}),r==="allow"&&a(this,de,"f").disarm(),a(this,H,"m",Sc).call(this,{event:e,toolUseId:e.id,name:e.name,isError:!1,posted:!1,confirmation:r});return}let l,p,_=a(this,Cr,"f")?.openTelemetry?.conversationId??(e.session_thread_id||a(this,ys,"f")),m=new AbortController,h=Et(a(this,se,"f").signal,m),g=setTimeout(()=>m.abort(),qg);try{let k={signal:a(this,se,"f").signal,conversationId:_,sessionID:this.sessionId,parentContext:a(this,yc,"f")},S=await lr(this.client,o,e,k,async()=>{let R=await hc(o,e.input,{toolUse:e,toolUseBlock:e,signal:m.signal}),A=Kg(R.content),C=this.client._tracer?A.map((T,x)=>{let B=typeof R.content=="string"?void 0:R.content[x];return B&&B.type!=="text"&&T.type==="text"?B:T}):A;return{sent:A,content:C,isError:R.isError}});l=S.sent,p=S.isError}finally{clearTimeout(g),h()}let y=jg(e,p,l),w=await a(this,H,"m",p_).call(this,y,e.id,_);a(this,H,"m",Sc).call(this,{event:e,result:y,toolUseId:e.id,name:e.name,isError:p,posted:w,confirmation:r})}finally{b(this,ot,(s=a(this,ot,"f"),s--,s),"f"),a(this,ot,"f")===0&&a(this,bs,"f")?.call(this)}}},p_=async function(e,r,n){let s=a(this,se,"f"),o=Date.now(),l,p=0;for(;;){p++,s.signal.throwIfAborted();try{return await this.client.beta.sessions.events.send(this.sessionId,{events:[e]},{...a(this,H,"m",vc).call(this),openTelemetry:{conversationId:n}}),a(this,Te,"f").add(r),!0}catch(_){if(l=_,Ut(_))break;let m=a(this,bc,"f")-(Date.now()-o);if(m<=0)break;let h=Math.min(sc(nc(p-1,$g,Fg)),m);a(this,J,"f").warn("tool result send failed; retrying",{tool_use_id:r,attempt:p,backoff_ms:h,error:String(_)}),await Be(h,s.signal)}}return a(this,J,"f").error("failed to send tool result",{tool_use_id:r,attempts:p,error:String(l)}),!1},h_=async function(){a(this,ot,"f")!==0&&(await Promise.race([new Promise(e=>b(this,bs,e,"f")),Be(Lg)]),b(this,bs,null,"f"),a(this,ot,"f")>0&&a(this,J,"f").warn("drain timeout exceeded"))},t})();function jg(t,i,e){return t.type==="agent.custom_tool_use"?{type:"user.custom_tool_result",custom_tool_use_id:t.id,is_error:i,content:e}:{type:"user.tool_result",tool_use_id:t.id,is_error:i,content:e}}function Kg(t){if(typeof t=="string")return[{type:"text",text:t||"(no output)"}];let i=t.map(e=>e.type==="text"?{type:"text",text:e.text||"(no output)"}:e.type==="image"||e.type==="document"?e:e.type==="search_result"?{type:"search_result",source:e.source,title:e.title,content:e.content.map(r=>({type:"text",text:r.text})),citations:{enabled:e.citations?.enabled??!1}}:{type:"text",text:JSON.stringify(e)});return i.length>0?i:[{type:"text",text:"(no output)"}]}td();var xc,Es,nd,ks,Wt,w_=3e4,ob=9e4,ab="NO_HEARTBEAT";function cb(t){return t.resources.some(i=>i.type==="memory_store")}function lb(t){if(!t)return null;let i;try{let r=t.replace(/-/g,"+").replace(/_/g,"/"),n=r.padEnd(Math.ceil(r.length/4)*4,"=");i=JSON.parse(Qn(t_(n)))}catch{return null}if(i===null||typeof i!="object"||Array.isArray(i))return null;let e=i.sessions_token;return typeof e=="string"&&e!==""?e:null}var sd=(()=>{class t{constructor(e){if(xc.add(this),Es.set(this,void 0),e.unrestrictedPaths!==void 0)throw new E("The `unrestrictedPaths` option you passed to EnvironmentWorker (or client.beta.environments.work.worker()) is no longer supported. The worker's file tools (read, write, edit, glob, grep) are now always confined to `workdir` plus the session's memory folders. Remove `unrestrictedPaths` from your options; to let the file tools reach any other directory, add it to `AgentToolContext.allowedRoots` from a `tools` factory.");this.client=e.client,this.environmentId=e.environmentId,this.environmentKey=e.environmentKey,this.tools=e.tools,this.workdir=e.workdir??process.cwd(),this.maxFileBytes=e.maxFileBytes,this.maxIdleMs=e.maxIdleMs,e.memorySyncIntervalMs!=null&&b_(e.memorySyncIntervalMs,"memorySyncIntervalMs"),this.memorySyncIntervalMs=e.memorySyncIntervalMs,this.memorySyncDeletions=e.memorySyncDeletions??"enabled",this.workerId=e.workerId,this.requestOptions=e.requestOptions,b(this,Es,e.signal,"f")}async run(e){let{environmentId:r,environmentKey:n}=this;if(r===void 0||n===void 0)throw new E("EnvironmentWorker.run: environmentId and environmentKey are required to poll for work");let s=e??a(this,Es,"f"),o=new _s({client:this.client,environmentId:r,environmentKey:n,...this.workerId!==void 0?{workerId:this.workerId}:{},...s?{signal:s}:{},...this.requestOptions!==void 0?{requestOptions:this.requestOptions}:{},autoStop:!1});for await(let l of o){let p=o._workSpan;try{await Hu(this.client,p,o.signal,()=>a(this,xc,"m",nd).call(this,l,n,o.signal,p))}catch(_){if(o.signal?.aborted)throw _;I(this.client).error("work item failed",{work_id:l.id,error:String(_)})}}}async handleItem(e){let r=e?.workId??N("ANTHROPIC_WORK_ID"),n=e?.environmentId??N("ANTHROPIC_ENVIRONMENT_ID"),s=e?.sessionId??N("ANTHROPIC_SESSION_ID"),o=(e?.environmentKey??this.environmentKey??N("ANTHROPIC_ENVIRONMENT_KEY"))||void 0,l=e?.workSecret||N("ANTHROPIC_WORK_SECRET")||null;if(!r)throw new E("handleItem: workId is required \u2014 pass it or set ANTHROPIC_WORK_ID");if(!n)throw new E("handleItem: environmentId is required \u2014 pass it or set ANTHROPIC_ENVIRONMENT_ID");if(!s)throw new E("handleItem: sessionId is required \u2014 pass it or set ANTHROPIC_SESSION_ID");if(!o&&!l)throw new E("handleItem: environmentKey is required when there is no work secret \u2014 pass it, construct the worker with it, or set ANTHROPIC_ENVIRONMENT_KEY");let p={id:r,environment_id:n,secret:l,data:{type:"session",id:s}};await a(this,xc,"m",nd).call(this,p,o,e?.signal??a(this,Es,"f"))}}return Es=new WeakMap,xc=new WeakSet,nd=async function(e,r,n,s){let o=I(this.client),l=lb(e.secret),p=l??r;if(p===void 0)throw new E("handleItem: the work item carried a secret payload but no sessions token could be extracted, and there is no environment key to fall back to; the poller must issue a secret whose payload carries `sessions_token`, or provide the environment key (pass it, construct the worker with it, or set ANTHROPIC_ENVIRONMENT_KEY)");e.secret&&l===null&&o.warn("work item carried a secret payload but no sessions token could be extracted; falling back to the environment key",{work_id:e.id});let _=oc(this.client,{authToken:p,helper:"environments-worker"}),m=e.data.id,h=new AbortController,g=Et(n,h),y=new db(h),w=await Promise.resolve().then(()=>(v_(),y_)),k,S,R=hb(_,e,y,o,this.requestOptions,x=>{k=x,S?._setSendRetryWindow(x)}).catch(x=>{h.signal.aborted||o.error("heartbeat loop failed",{work_id:e.id,error:String(x)}),h.abort()}),A=async()=>{},C,T=!1;try{if(e.data.type!=="session"){o.debug("skipping non-session work item",{work_id:e.id,type:e.data.type});return}let x=await _.beta.sessions.retrieve(m);if(x.status==="terminated"){o.info("skipping the work item of a terminated session",{session_id:m,work_id:e.id});return}if(l===null&&this.memorySyncIntervalMs!==null&&cb(x))throw new w.SessionMemoryError(`cannot mount the session's memories: the work item carried no sessions token (work_id=${e.id}, session_id=${m}); the memory endpoints reject the environment key, so the poller must issue a per-item \`secret\` carrying \`sessions_token\`, or set \`memorySyncIntervalMs: null\` to run without memory`);let B={workdir:this.workdir,client:_,session:x,...this.maxFileBytes!==void 0?{maxFileBytes:this.maxFileBytes}:{}};try{A=await w.setupSkills(B)}catch(U){o.warn("skill setup failed",{session_id:m,work_id:e.id,error:String(U)})}l!==null&&this.memorySyncIntervalMs!==null?(C=new w.SessionMemoryStores(_,{workdir:this.workdir,...this.memorySyncIntervalMs!==void 0?{syncIntervalMs:this.memorySyncIntervalMs}:{},syncDeletions:this.memorySyncDeletions}),await C.download(x),B.allowedRoots=C.roots,B.readOnlyRoots=C.readOnlyRoots):o.debug("memory stores disabled for this item",{work_id:e.id});let L=typeof this.tools=="function"?this.tools(B):this.tools??w.betaAgentToolset20260401(B);S=new ws(m,{client:_,tools:L,...this.maxIdleMs!==void 0?{maxIdleMs:this.maxIdleMs}:{},...this.requestOptions!==void 0?{requestOptions:this.requestOptions}:{},signal:h.signal}),k!==void 0&&S._setSendRetryWindow(k);for await(let U of S)C&&await C.syncIfDue();T=!h.signal.aborted}finally{try{await A().catch(x=>{o.warn("skill cleanup failed",{session_id:m,work_id:e.id,error:String(x)})})}finally{if(C){let x=w.MEMORY_FLUSH_TIMEOUT_MS;T&&await E_(C.finish(),x)&&o.warn(`final memory sync cut off after ${x}ms; the flush that follows still uploads changed files`,{session_id:m,work_id:e.id});let B=new AbortController;await E_(C.flushWrites(B.signal),x)&&(B.abort(),o.warn(`memory flush cut off after ${x}ms; changed files it had not uploaded yet are not saved`,{session_id:m,work_id:e.id})),await C.dispose().catch(U=>{o.warn("memory store cleanup failed",{session_id:m,work_id:e.id,error:String(U)})})}}y.finish("runner_done"),g(),await R,y.lost?o.info("lease lost; released without stopping it",{session_id:m,work_id:e.id}):await ub(_,e,o,this.requestOptions),(y.lost||y.rejected)&&M(this.client,()=>s?.end())}},t})();async function E_(t,i){let e;try{return await Promise.race([t.then(()=>!1,()=>!1),new Promise(r=>{e=setTimeout(()=>r(!0),i)})])}finally{e!==void 0&&clearTimeout(e)}}async function ub(t,i,e,r){try{await t.beta.environments.work.stop(i.id,{environment_id:i.environment_id,force:!0},{...r,headers:d([r?.headers])})}catch(n){kt(n,409)||e.error("force-stop on exit failed",{work_id:i.id,error:String(n)})}}var db=(()=>{class t{constructor(e){ks.set(this,void 0),Wt.set(this,void 0),b(this,ks,e,"f")}get signal(){return a(this,ks,"f").signal}finish(e){b(this,Wt,a(this,Wt,"f")??e,"f"),a(this,ks,"f").abort()}get lost(){return a(this,Wt,"f")==="lease_lost"||a(this,Wt,"f")==="assumed_lost"}get rejected(){return a(this,Wt,"f")==="heartbeat_rejected"}}return ks=new WeakMap,Wt=new WeakMap,t})();function pb(t){let i=t instanceof $?t.error:void 0;for(let e of["error","details","current_state"]){if(!X(i))return{};i=i[e]}return X(i)?i:{}}async function hb(t,i,e,r,n,s){let o=w_,l=ob,p=Date.now(),_=ab,m=async()=>{let h=new AbortController,g=Et(e.signal,h),y=setTimeout(()=>h.abort(),o);try{let w=await t.beta.environments.work.heartbeat(i.id,{environment_id:i.environment_id,expected_last_heartbeat:_},{...n,headers:d([n?.headers]),signal:h.signal});p=Date.now(),_=w.last_heartbeat,w.ttl_seconds>0&&(l=w.ttl_seconds*1e3,o=Math.max(1e3,Math.min(l/2,w_)),s?.(l)),(w.state==="stopping"||w.state==="stopped")&&(r.info("heartbeat signals shutdown",{work_id:i.id,state:w.state}),e.finish("heartbeat_stop")),w.lease_extended||(r.warn("lease not extended, shutting down",{work_id:i.id}),e.finish("heartbeat_stop"))}catch(w){if(e.signal.throwIfAborted(),kt(w,412)){let k=pb(w);r.error("lease lost: heartbeat precondition failed",{work_id:i.id,server_state:k.state,server_ttl_seconds:k.ttl_seconds,server_last_heartbeat:k.last_heartbeat}),e.finish("lease_lost");return}if(Ut(w))throw r.error("permanent heartbeat failure",{work_id:i.id,error:String(w)}),e.finish("heartbeat_rejected"),w;if(Date.now()-p>l){r.error("lease assumed lost: no successful heartbeat in ttl",{work_id:i.id,ttl_ms:l,error:String(w)}),e.finish("assumed_lost");return}r.warn("transient heartbeat failure",{work_id:i.id,error:String(w)})}finally{clearTimeout(y),g()}};for(await m();!e.signal.aborted;)await Be(o,e.signal),e.signal.throwIfAborted(),await m()}var Ss=(()=>{class t extends Fn{}return t._errorName="BetaHeartbeatPreconditionFailedError",t})(),Pc=(()=>{class t extends f{retrieve(e,r,n){let{environment_id:s,betas:o,workspace_id:l}=r;return this._client.get(u`/v1/environments/${s}/work/${e}`,{...n,headers:d([{"anthropic-beta":[...o??[],"managed-agents-2026-04-01"].toString(),...l!=null?{"anthropic-workspace-id":l}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.work.retrieve",n,{route:"/v1/environments/{environment_id}/work/{work_id}",attributes:{"anthropic.environment.id":s,"anthropic.environment.work.id":e}})})}update(e,r,n){let{environment_id:s,betas:o,workspace_id:l,...p}=r;return this._client.post(u`/v1/environments/${s}/work/${e}`,{body:p,...n,headers:d([{"anthropic-beta":[...o??[],"managed-agents-2026-04-01"].toString(),...l!=null?{"anthropic-workspace-id":l}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.work.update",n,{route:"/v1/environments/{environment_id}/work/{work_id}",attributes:{"anthropic.environment.id":s,"anthropic.environment.work.id":e}})})}list(e,r={},n){let{betas:s,...o}=r??{};return this._client.getAPIList(u`/v1/environments/${e}/work`,v,{query:o,...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString()},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.work.list",n,{route:"/v1/environments/{environment_id}/work",queryParams:["limit","page"],attributes:{"anthropic.environment.id":e}})})}ack(e,r,n){let{environment_id:s,betas:o}=r;return this._client.post(u`/v1/environments/${s}/work/${e}/ack`,{...n,headers:d([{"anthropic-beta":[...o??[],"managed-agents-2026-04-01"].toString()},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.work.ack",n,{route:"/v1/environments/{environment_id}/work/{work_id}/ack",attributes:{"anthropic.environment.id":s,"anthropic.environment.work.id":e}})})}heartbeat(e,r,n){let{environment_id:s,desired_ttl_seconds:o,expected_last_heartbeat:l,betas:p}=r;return this._client.post(u`/v1/environments/${s}/work/${e}/heartbeat`,{query:{desired_ttl_seconds:o,expected_last_heartbeat:l},...n,headers:d([{"anthropic-beta":[...p??[],"managed-agents-2026-04-01"].toString()},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.work.heartbeat",n,{route:"/v1/environments/{environment_id}/work/{work_id}/heartbeat",queryParams:["desired_ttl_seconds","expected_last_heartbeat"],attributes:{"anthropic.environment.id":s,"anthropic.environment.work.id":e}})})}poll(e,r={},n){let{betas:s,"Anthropic-Worker-ID":o,...l}=r??{};return this._client.get(u`/v1/environments/${e}/work/poll`,{query:l,...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"Anthropic-Worker-ID":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.work.poll",n,{route:"/v1/environments/{environment_id}/work/poll",queryParams:["block_ms","reclaim_older_than_ms"],attributes:{"anthropic.environment.id":e}})})}stats(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.get(u`/v1/environments/${e}/work/stats`,{...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.work.stats",n,{route:"/v1/environments/{environment_id}/work/stats",attributes:{"anthropic.environment.id":e}})})}stop(e,r,n){let{environment_id:s,betas:o,workspace_id:l,...p}=r;return this._client.post(u`/v1/environments/${s}/work/${e}/stop`,{body:p,...n,headers:d([{"anthropic-beta":[...o??[],"managed-agents-2026-04-01"].toString(),...l!=null?{"anthropic-workspace-id":l}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.work.stop",n,{route:"/v1/environments/{environment_id}/work/{work_id}/stop",attributes:{"anthropic.environment.id":s,"anthropic.environment.work.id":e}})})}poller(e){return new _s({...e,client:this._client})}worker(e){return new sd({...e,client:this._client})}}return t.BetaHeartbeatPreconditionFailedError=Ss,t.WorkPoller=_s,t.EnvironmentWorker=sd,t})();z();var As=(()=>{class t extends P{}return t._errorName="BetaEnvironmentArchivedError",t})(),xs=(()=>{class t extends P{}return t._errorName="BetaInvalidConfigTypeChangeError",t})(),Ps=(()=>{class t extends P{}return t._errorName="BetaInvalidMetadataError",t})(),Ts=(()=>{class t extends D{}return t._errorName="BetaEnvironmentCreateDisabledError",t})(),Rs=(()=>{class t extends D{}return t._errorName="BetaEnvironmentUpdateDisabledError",t})(),Cs=(()=>{class t extends ae{}return t._errorName="BetaEnvironmentNotFoundError",t})(),Tc=(()=>{class t extends f{constructor(){super(...arguments),this.work=new Pc(this._client)}create(e,r){let{betas:n,workspace_id:s,...o}=e;return this._client.post("/v1/environments",{body:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.create",r,{route:"/v1/environments",createdIDAttribute:"anthropic.environment.id"})})}retrieve(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.get(u`/v1/environments/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.retrieve",n,{route:"/v1/environments/{environment_id}",attributes:{"anthropic.environment.id":e}})})}update(e,r,n){let{betas:s,workspace_id:o,...l}=r;return this._client.post(u`/v1/environments/${e}`,{body:l,...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.update",n,{route:"/v1/environments/{environment_id}",attributes:{"anthropic.environment.id":e}})})}list(e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList("/v1/environments",v,{query:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.list",r,{route:"/v1/environments",queryParams:["include_archived","limit","page"]})})}delete(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.delete(u`/v1/environments/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.delete",n,{route:"/v1/environments/{environment_id}",attributes:{"anthropic.environment.id":e}})})}archive(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.post(u`/v1/environments/${e}/archive`,{...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.environments.archive",n,{route:"/v1/environments/{environment_id}/archive",attributes:{"anthropic.environment.id":e}})})}}return t.BetaEnvironmentArchivedError=As,t.BetaInvalidConfigTypeChangeError=xs,t.BetaInvalidMetadataError=Ps,t.BetaEnvironmentCreateDisabledError=Ts,t.BetaEnvironmentUpdateDisabledError=Rs,t.BetaEnvironmentNotFoundError=Cs,t.Work=Pc,t.BetaHeartbeatPreconditionFailedError=Ss,t})();var Or=class extends f{create(i,e,r){let{view:n,betas:s,workspace_id:o,...l}=e;return this._client.post(u`/v1/memory_stores/${i}/memories`,{query:{view:n},body:l,...r,headers:d([{"anthropic-beta":[...s??[],"agent-memory-2026-07-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.memories.create",r,{route:"/v1/memory_stores/{memory_store_id}/memories",queryParams:["view"],attributes:{"gen_ai.memory.store.id":i},createdIDAttribute:"gen_ai.memory.record.id"})})}retrieve(i,e,r){let{memory_store_id:n,betas:s,workspace_id:o,...l}=e;return this._client.get(u`/v1/memory_stores/${n}/memories/${i}`,{query:l,...r,headers:d([{"anthropic-beta":[...s??[],"agent-memory-2026-07-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.memories.retrieve",r,{route:"/v1/memory_stores/{memory_store_id}/memories/{memory_id}",queryParams:["view"],attributes:{"gen_ai.memory.store.id":n,"gen_ai.memory.record.id":i}})})}update(i,e,r){let{memory_store_id:n,view:s,betas:o,workspace_id:l,...p}=e;return this._client.post(u`/v1/memory_stores/${n}/memories/${i}`,{query:{view:s},body:p,...r,headers:d([{"anthropic-beta":[...o??[],"agent-memory-2026-07-22"].toString(),...l!=null?{"anthropic-workspace-id":l}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.memories.update",r,{route:"/v1/memory_stores/{memory_store_id}/memories/{memory_id}",queryParams:["view"],attributes:{"gen_ai.memory.store.id":n,"gen_ai.memory.record.id":i}})})}list(i,e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList(u`/v1/memory_stores/${i}/memories`,v,{query:o,...r,headers:d([{"anthropic-beta":[...n??[],"agent-memory-2026-07-22"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.memories.list",r,{route:"/v1/memory_stores/{memory_store_id}/memories",queryParams:["depth","limit","page","path_prefix","view"],contentQueryParams:["page"],attributes:{"gen_ai.memory.store.id":i}})})}delete(i,e,r){let{memory_store_id:n,expected_content_sha256:s,betas:o,workspace_id:l}=e;return this._client.delete(u`/v1/memory_stores/${n}/memories/${i}`,{query:{expected_content_sha256:s},...r,headers:d([{"anthropic-beta":[...o??[],"agent-memory-2026-07-22"].toString(),...l!=null?{"anthropic-workspace-id":l}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.memories.delete",r,{route:"/v1/memory_stores/{memory_store_id}/memories/{memory_id}",queryParams:["expected_content_sha256"],attributes:{"gen_ai.memory.store.id":n,"gen_ai.memory.record.id":i}})})}};var Mr=class extends f{retrieve(i,e,r){let{memory_store_id:n,betas:s,workspace_id:o,...l}=e;return this._client.get(u`/v1/memory_stores/${n}/memory_versions/${i}`,{query:l,...r,headers:d([{"anthropic-beta":[...s??[],"agent-memory-2026-07-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.memory_versions.retrieve",r,{route:"/v1/memory_stores/{memory_store_id}/memory_versions/{memory_version_id}",queryParams:["view"],attributes:{"gen_ai.memory.store.id":n,"anthropic.memory_store.memory_version.id":i}})})}list(i,e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList(u`/v1/memory_stores/${i}/memory_versions`,v,{query:o,...r,headers:d([{"anthropic-beta":[...n??[],"agent-memory-2026-07-22"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.memory_versions.list",r,{route:"/v1/memory_stores/{memory_store_id}/memory_versions",queryParams:["api_key_id","created_at[gte]","created_at[lte]","limit","memory_id","operation","page","service_account_id","session_id","view"],attributes:{"gen_ai.memory.store.id":i}})})}redact(i,e,r){let{memory_store_id:n,betas:s,workspace_id:o}=e;return this._client.post(u`/v1/memory_stores/${n}/memory_versions/${i}/redact`,{...r,headers:d([{"anthropic-beta":[...s??[],"agent-memory-2026-07-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.memory_versions.redact",r,{route:"/v1/memory_stores/{memory_store_id}/memory_versions/{memory_version_id}/redact",attributes:{"gen_ai.memory.store.id":n,"anthropic.memory_store.memory_version.id":i}})})}};var Rc=(()=>{class t extends f{constructor(){super(...arguments),this.memories=new Or(this._client),this.memoryVersions=new Mr(this._client)}create(e,r){let{betas:n,workspace_id:s,...o}=e;return this._client.post("/v1/memory_stores",{body:o,...r,headers:d([{"anthropic-beta":[...n??[],"agent-memory-2026-07-22"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.create",r,{route:"/v1/memory_stores",createdIDAttribute:"gen_ai.memory.store.id"})})}retrieve(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.get(u`/v1/memory_stores/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"agent-memory-2026-07-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.retrieve",n,{route:"/v1/memory_stores/{memory_store_id}",attributes:{"gen_ai.memory.store.id":e}})})}update(e,r,n){let{betas:s,workspace_id:o,...l}=r;return this._client.post(u`/v1/memory_stores/${e}`,{body:l,...n,headers:d([{"anthropic-beta":[...s??[],"agent-memory-2026-07-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.update",n,{route:"/v1/memory_stores/{memory_store_id}",attributes:{"gen_ai.memory.store.id":e}})})}list(e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList("/v1/memory_stores",v,{query:o,...r,headers:d([{"anthropic-beta":[...n??[],"agent-memory-2026-07-22"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.list",r,{route:"/v1/memory_stores",queryParams:["created_at[gte]","created_at[lte]","include_archived","limit","page"]})})}delete(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.delete(u`/v1/memory_stores/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"agent-memory-2026-07-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.delete",n,{route:"/v1/memory_stores/{memory_store_id}",attributes:{"gen_ai.memory.store.id":e}})})}archive(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.post(u`/v1/memory_stores/${e}/archive`,{...n,headers:d([{"anthropic-beta":[...s??[],"agent-memory-2026-07-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.memory_stores.archive",n,{route:"/v1/memory_stores/{memory_store_id}/archive",attributes:{"gen_ai.memory.store.id":e}})})}}return t.Memories=Or,t.MemoryVersions=Mr,t})();z();var Cc=(()=>{class t{constructor(e,r,n){this.iterator=e,this.response=n,this.controller=r}async*decoder(){let e=this.iterator;if(!e)throw new E("Cannot iterate over a consumed stream.");this.iterator=void 0;let r=new pa;for await(let n of e)for(let s of r.decode(n))yield JSON.parse(s);for(let n of r.flush())yield JSON.parse(n)}[Symbol.asyncIterator](){return this.decoder()}static fromResponse(e,r){if(!e.body)throw r.abort(),typeof globalThis.navigator<"u"&&globalThis.navigator.product==="ReactNative"?new E("The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api"):new E("Attempted to iterate over a response with no body");return new t(Kn(e.body),r,e)}}return t})();var Br=class extends f{create(i,e){let{betas:r,user_profile_id:n,workspace_id:s,...o}=i;return this._client.post("/v1/messages/batches",{body:o,...e,headers:d([{...r?.toString()!=null?{"anthropic-beta":r?.toString()}:void 0,...n!=null?{"anthropic-user-profile-id":n}:void 0,...s!=null?{"anthropic-workspace-id":s}:void 0},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.messages.batches.create",e,{route:"/v1/messages/batches",attributes:{"anthropic.message.batch.request_count":o.requests?.length},createdIDAttribute:"anthropic.message.batch.id"})})}retrieve(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.get(u`/v1/messages/batches/${i}`,{...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0,...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.messages.batches.retrieve",r,{route:"/v1/messages/batches/{message_batch_id}",attributes:{"anthropic.message.batch.id":i}})})}list(i={},e){let{betas:r,workspace_id:n,...s}=i??{};return this._client.getAPIList("/v1/messages/batches",F,{query:s,...e,headers:d([{...r?.toString()!=null?{"anthropic-beta":r?.toString()}:void 0,...n!=null?{"anthropic-workspace-id":n}:void 0},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.messages.batches.list",e,{route:"/v1/messages/batches",queryParams:["after_id","before_id","limit"]})})}delete(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.delete(u`/v1/messages/batches/${i}`,{...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0,...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.messages.batches.delete",r,{route:"/v1/messages/batches/{message_batch_id}",attributes:{"anthropic.message.batch.id":i}})})}cancel(i,e={},r){let{betas:n,workspace_id:s}=e??{};return this._client.post(u`/v1/messages/batches/${i}/cancel`,{...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0,...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.messages.batches.cancel",r,{route:"/v1/messages/batches/{message_batch_id}/cancel",attributes:{"anthropic.message.batch.id":i}})})}async results(i,e={},r){let n=await this.retrieve(i,e,r);if(!n.results_url)throw new E(`No batch \`results_url\`; Has it finished processing? ${n.processing_status} - ${n.id}`);let{betas:s,workspace_id:o}=e??{};return this._client.get(n.results_url,{...r,headers:d([{Accept:"application/binary",...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0,...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),stream:!0,__qualifiers:{beta:"true"},__binaryResponse:!0,__span:c(this._client,"anthropic.messages.batches.results",r,{route:"/v1/messages/batches/{message_batch_id}/results",attributes:{"anthropic.message.batch.id":i}})})._thenUnwrap((l,p)=>Cc.fromResponse(p.response,p.controller))}};var Ic={"claude-opus-4@20250514":8192,"anthropic.claude-opus-4-1-20250805-v1:0":8192,"claude-opus-4-1@20250805":8192};z();function k_(t){return t?.output_format??t?.output_config?.format}function od(t,i,e){let r=k_(i);return!i||!("parse"in(r??{}))?{...t,content:t.content.map(n=>{if(n.type==="text"){let s=Object.defineProperty({...n},"parsed_output",{value:null,enumerable:!1});return Object.defineProperty(s,"parsed",{get(){return e.logger.warn("The `parsed` property on `text` blocks is deprecated, please use `parsed_output` instead."),null},enumerable:!1})}return n}),parsed_output:null}:Is(t,i,e)}function Is(t,i,e){let r=null,n=t.content.map(s=>{if(s.type==="text"){let o=vb(i,s.text);r===null&&(r=o);let l=Object.defineProperty({...s},"parsed_output",{value:o,enumerable:!1});return Object.defineProperty(l,"parsed",{get(){return e.logger.warn("The `parsed` property on `text` blocks is deprecated, please use `parsed_output` instead."),o},enumerable:!1})}return s});return{...t,content:n,parsed_output:r}}function vb(t,i){let e=k_(t);if(e?.type!=="json_schema")return null;try{return"parse"in e?e.parse(i):JSON.parse(i)}catch(r){throw new E(`Failed to parse structured output: ${r}`)}}pt();function ad(t,i){let{betas:e,user_profile_id:r,workspace_id:n,tools:s,messages:o}=t;return d([{...e?.toString()!=null?{"anthropic-beta":e?.toString()}:void 0,...r!=null?{"anthropic-user-profile-id":r}:void 0,...n!=null?{"anthropic-workspace-id":n}:void 0},za(s,o),i?.headers])}function S_(t,i,e){if(!t._tracer)return;let r=ad(i,e);return c(t,"anthropic.messages.create",e,it(t,{body:zc(i),headers:r,stream:!0}))}function zc(t){if(!t.output_format)return t;zs(t);let{output_format:i,...e}=t;return{...e,output_config:{...t.output_config,format:i}}}function zs(t){if(t.output_format&&t.output_config?.format)throw new E("Both output_format and output_config.format were provided. Please use only output_config.format (output_format is deprecated).")}var x_=["true","false","null"],P_=t=>t===" "||t==="	"||t===`
`||t==="\r",wb=(t,i)=>x_.some(e=>e!==t&&e.startsWith(t))&&[...i].every(P_),Eb=t=>{let i=0,e=[];for(;i<t.length;){let r=t[i];if(r==="{"){e.push({type:"brace",value:"{"}),i++;continue}if(r==="}"){e.push({type:"brace",value:"}"}),i++;continue}if(r==="["){e.push({type:"paren",value:"["}),i++;continue}if(r==="]"){e.push({type:"paren",value:"]"}),i++;continue}if(r===":"){e.push({type:"separator",value:":"}),i++;continue}if(r===","){e.push({type:"delimiter",value:","}),i++;continue}if(r==='"'){let o=i+1,l=o,p=!1;for(;;){if(l=t.indexOf('"',l),l===-1){p=!0;break}let _=0,m=l-1;for(;m>=o&&t[m]==="\\";)_++,m--;if(_%2===0)break;l++}p?i=t.length:(e.push({type:"string",value:t.slice(o,l)}),i=l+1);continue}if(P_(r)){i++;continue}let n=/[0-9]/;if(r&&n.test(r)||r==="-"||r==="."){let o="";for(r==="-"&&(o+=r,r=t[++i]);r&&(n.test(r)||r==="."||r==="e"||r==="E"||(r==="-"||r==="+")&&(o[o.length-1]==="e"||o[o.length-1]==="E"));)o+=r,r=t[++i];e.push({type:"number",value:o,unterminated:i===t.length});continue}let s=/[a-z]/i;if(r&&s.test(r)){let o="";for(;r&&s.test(r)&&i!==t.length;)o+=r,r=t[++i];if(x_.includes(o))e.push({type:"name",value:o});else if(!wb(o,t.slice(i)))return null;continue}return null}return e},kb=t=>{let i=[];for(let s of t)(s.type==="brace"||s.type==="paren")&&(s.value==="{"||s.value==="["?i.push(s.value):i.pop());let e=i[i.length-1],r=t.length,n=/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?$/;for(;r>0;){let s=t[r-1];switch(s.type){case"separator":r--;continue;case"number":if(s.unterminated||!n.test(s.value)){r--;continue}break;case"string":let o=t[r-2];if(e==="{"&&(o?.type==="delimiter"||o?.type==="brace"&&o.value==="{")){r--;continue}break;case"delimiter":r--;break}break}return t.slice(0,r)},Sb=t=>{let i=[];for(let e of t)if(!(e.type!=="brace"&&e.type!=="paren")){if(e.value==="{")i.push("}");else if(e.value==="[")i.push("]");else if(i.pop()!==e.value)return null}return i.length>0&&i.reverse().map(e=>{e==="}"?t.push({type:"brace",value:"}"}):e==="]"&&t.push({type:"paren",value:"]"})}),t},A_=t=>t?.type==="string"||t?.type==="number"||t?.type==="name",Ab=t=>{let i="";return t.map((e,r)=>{A_(t[r-1])&&A_(e)&&(i+=" "),e.type==="string"?i+='"'+e.value+'"':i+=e.value}),i},T_=t=>{let i=Eb(t),e=i&&Sb(kb(i));return JSON.parse(e?Ab(e):t)};var At="__json_buf";function Nc(t,i){let e={};for(let s of Object.keys(t))s!=="input"&&(e[s]=t[s]);Object.defineProperty(e,At,{value:i,enumerable:!1,writable:!0});let r,n=!1;return Object.defineProperty(e,"input",{enumerable:!0,configurable:!0,get(){return n||(r=i?T_(i):{},n=!0),r}}),e}var ge,xt,Ge,Ns,Oc,Os,Ms,Mc,Bs,Ve,qs,Bc,qc,jt,Lc,$c,Fc,Ls,Je,he,$s,cd,R_,Fs,ld,ud,dd,C_,pd;function hd(t){return t.type==="tool_use"||t.type==="server_tool_use"||t.type==="mcp_tool_use"}var qr=(()=>{class t{constructor(e,r){ge.add(this),this.messages=[],this.receivedMessages=[],xt.set(this,void 0),Ge.set(this,null),this.controller=new AbortController,Ns.set(this,void 0),Oc.set(this,()=>{}),Os.set(this,()=>{}),Ms.set(this,void 0),Mc.set(this,()=>{}),Bs.set(this,()=>{}),Ve.set(this,{}),qs.set(this,!1),Bc.set(this,!1),qc.set(this,!1),jt.set(this,!1),Lc.set(this,void 0),$c.set(this,void 0),Fc.set(this,void 0),Ls.set(this,void 0),Je.set(this,void 0),he.set(this,void 0),$s.set(this,void 0),Fs.set(this,n=>{if(b(this,Bc,!0,"f"),a(this,he,"f")&&(a(this,he,"f").streamed=void 0),we(n)&&(n=new ie),n instanceof ie)return b(this,qc,!0,"f"),this._emit("abort",n);if(n instanceof E)return this._emit("error",n);if(n instanceof Error){let s=new E(n.message);return s.cause=n,this._emit("error",s)}return this._emit("error",new E(String(n)))}),b(this,Ns,new Promise((n,s)=>{b(this,Oc,n,"f"),b(this,Os,s,"f")}),"f"),b(this,Ms,new Promise((n,s)=>{b(this,Mc,n,"f"),b(this,Bs,s,"f")}),"f"),a(this,Ns,"f").catch(()=>{}),a(this,Ms,"f").catch(()=>{}),b(this,Ge,e,"f"),b(this,Ls,r?.logger??console,"f"),b(this,Je,r?.client,"f")}get response(){return a(this,Lc,"f")}get request_id(){return a(this,$c,"f")}get workspace_id(){return a(this,Fc,"f")}async withResponse(){b(this,jt,!0,"f");let e=await a(this,Ns,"f");if(!e)throw new Error("Could not resolve a `Response` object");return{data:this,response:e,request_id:e.headers.get("request-id"),workspace_id:e.headers.get("anthropic-workspace-id")}}static fromReadableStream(e){let r=new t(null);return r._run(()=>r._fromReadableStream(e)),r}static createMessage(e,r,n,{logger:s,client:o}={}){let l=new t(r,{logger:s,client:o});for(let p of r.messages)l._addMessageParam(p);return b(l,Ge,{...r,stream:!0},"f"),l._run(()=>l._createMessage((p,_)=>e.create(p,_),{...r,stream:!0},{...n,headers:{...n?.headers,[ar]:"stream"}})),l}_start(e,r,n,s){for(let p of r.messages)this._addMessageParam(p);let o=a(this,Je,"f");b(this,Je,void 0,"f");let l=(p,_)=>e(p,_)._thenUnwrap((m,{options:h})=>(b(this,Je,o,"f"),b(this,he,h.__span,"f"),b(this,$s,h.body,"f"),m));this._run(()=>this._createMessage(l,{...r,stream:!0},n).finally(s))}_run(e){e().then(()=>{this._emitFinal(),this._emit("end")},a(this,Fs,"f"))}_addMessageParam(e){this.messages.push(e)}_addMessage(e,r=!0){this.receivedMessages.push(e),r&&this._emit("message",e)}async _createMessage(e,r,n){let s=n?.signal,o;s&&(s.aborted&&this.controller.abort(),o=this.controller.abort.bind(this.controller),s.addEventListener("abort",o));try{a(this,ge,"m",ld).call(this),b(this,he,n?.__span??(a(this,Je,"f")&&S_(a(this,Je,"f"),r,n)),"f");let{response:l,data:p}=await e({...r,stream:!0},{...n,__span:a(this,he,"f"),signal:this.controller.signal}).withResponse();try{this._connected(l)}catch(_){throw a(this,he,"f")&&(a(this,he,"f").failure=_),p.controller.abort(),_}for await(let _ of p)try{a(this,ge,"m",ud).call(this,_)}catch(m){throw a(this,he,"f")&&(a(this,he,"f").failure=m),m}if(p.controller.signal?.aborted)throw new ie;a(this,ge,"m",dd).call(this)}finally{s&&o&&s.removeEventListener("abort",o)}}_connected(e){this.ended||(b(this,Lc,e,"f"),b(this,$c,e?.headers.get("request-id"),"f"),b(this,Fc,e?.headers.get("anthropic-workspace-id"),"f"),a(this,Oc,"f").call(this,e),this._emit("connect"))}get ended(){return a(this,qs,"f")}get errored(){return a(this,Bc,"f")}get aborted(){return a(this,qc,"f")}abort(){this.controller.abort()}on(e,r){return(a(this,Ve,"f")[e]||(a(this,Ve,"f")[e]=[])).push({listener:r}),this}off(e,r){let n=a(this,Ve,"f")[e];if(!n)return this;let s=n.findIndex(o=>o.listener===r);return s>=0&&n.splice(s,1),this}once(e,r){return(a(this,Ve,"f")[e]||(a(this,Ve,"f")[e]=[])).push({listener:r,once:!0}),this}emitted(e){return new Promise((r,n)=>{b(this,jt,!0,"f"),e!=="error"&&this.once("error",n),this.once(e,r)})}async done(){b(this,jt,!0,"f"),await a(this,Ms,"f")}get currentMessage(){return a(this,xt,"f")}async finalMessage(){return await this.done(),a(this,ge,"m",cd).call(this)}async finalText(){return await this.done(),a(this,ge,"m",R_).call(this)}_emit(e,...r){if(a(this,qs,"f"))return;e==="end"&&(b(this,qs,!0,"f"),a(this,Mc,"f").call(this));let n=a(this,Ve,"f")[e];if(n&&(a(this,Ve,"f")[e]=n.filter(s=>!s.once),n.forEach(({listener:s})=>s(...r))),e==="abort"){let s=r[0];!a(this,jt,"f")&&!n?.length&&Promise.reject(s),a(this,Os,"f").call(this,s),a(this,Bs,"f").call(this,s),this._emit("end");return}if(e==="error"){let s=r[0];!a(this,jt,"f")&&!n?.length&&Promise.reject(s),a(this,Os,"f").call(this,s),a(this,Bs,"f").call(this,s),this._emit("end")}}_emitFinal(){this.receivedMessages.at(-1)&&this._emit("finalMessage",a(this,ge,"m",cd).call(this))}_deliverEvent(e,r){this._emit("_rawEvent",e),r&&this._emit("streamEvent",e,r)}async _fromReadableStream(e,r){let n=r?.signal,s;n&&(n.aborted&&this.controller.abort(),s=this.controller.abort.bind(this.controller),n.addEventListener("abort",s));try{a(this,ge,"m",ld).call(this),this._connected(null);let o=ue.fromReadableStream(e,this.controller);for await(let l of o)a(this,ge,"m",ud).call(this,l);if(o.controller.signal?.aborted)throw new ie;a(this,ge,"m",dd).call(this)}finally{n&&s&&n.removeEventListener("abort",s)}}[(xt=new WeakMap,Ge=new WeakMap,Ns=new WeakMap,Oc=new WeakMap,Os=new WeakMap,Ms=new WeakMap,Mc=new WeakMap,Bs=new WeakMap,Ve=new WeakMap,qs=new WeakMap,Bc=new WeakMap,qc=new WeakMap,jt=new WeakMap,Lc=new WeakMap,$c=new WeakMap,Fc=new WeakMap,Ls=new WeakMap,Je=new WeakMap,he=new WeakMap,$s=new WeakMap,Fs=new WeakMap,ge=new WeakSet,cd=function(){if(this.receivedMessages.length===0)throw new E("stream ended without producing a Message with role=assistant");return this.receivedMessages.at(-1)},R_=function(){if(this.receivedMessages.length===0)throw new E("stream ended without producing a Message with role=assistant");let r=this.receivedMessages.at(-1).content.filter(n=>n.type==="text").map(n=>n.text);if(r.length===0)throw new E("stream ended without producing a content block with type=text");return r.join(" ")},ld=function(){this.ended||b(this,xt,void 0,"f")},ud=function(r){if(this.ended)return;let n=a(this,ge,"m",C_).call(this,r);if(this._deliverEvent(r,n),!!n)switch(r.type){case"content_block_delta":{let s=n.content.at(-1);switch(r.delta.type){case"text_delta":{s.type==="text"&&this._emit("text",r.delta.text,s.text||"");break}case"citations_delta":{s.type==="text"&&this._emit("citation",r.delta.citation,s.citations??[]);break}case"input_json_delta":{if(hd(s)&&a(this,Ve,"f").inputJson?.length){let o;try{o=s.input}catch(l){a(this,Fs,"f").call(this,a(this,ge,"m",pd).call(this,s,l));break}this._emit("inputJson",r.delta.partial_json,o)}break}case"thinking_delta":{s.type==="thinking"&&this._emit("thinking",r.delta.thinking,s.thinking);break}case"signature_delta":{s.type==="thinking"&&this._emit("signature",s.signature);break}case"compaction_delta":{s.type==="compaction"&&s.content&&this._emit("compaction",s.content);break}default:r.delta}break}case"message_stop":{a(this,Je,"f")&&a(this,he,"f")&&a(this,Ge,"f")&&or(a(this,Je,"f"),a(this,he,"f"),a(this,$s,"f")??a(this,Ge,"f"),n),this._addMessageParam(n),this._addMessage(od(n,a(this,Ge,"f"),{logger:a(this,Ls,"f")}),!0);break}case"content_block_stop":{this._emit("contentBlock",n.content.at(-1));break}case"message_start":{b(this,xt,n,"f"),a(this,he,"f")&&a(this,Ge,"f")&&(a(this,he,"f").streamed={body:a(this,$s,"f")??a(this,Ge,"f"),message:n});break}case"content_block_start":case"message_delta":break}},dd=function(){if(this.ended)throw new E("stream has ended, this shouldn't happen");let r=a(this,xt,"f");if(!r)throw new E("request ended without sending any chunks");return b(this,xt,void 0,"f"),od(r,a(this,Ge,"f"),{logger:a(this,Ls,"f")})},C_=function(r){let n=a(this,xt,"f");if(r.type==="message_start"){if(n)throw new E(`Unexpected event order, got ${r.type} before receiving "message_stop"`);return r.message}if(n)switch(r.type){case"message_stop":return n;case"message_delta":return n.stop_reason=r.delta.stop_reason,n.stop_sequence=r.delta.stop_sequence,n.stop_details=r.delta.stop_details,n.usage.output_tokens=r.usage.output_tokens,r.delta.container!=null&&(n.container=r.delta.container),r.context_management!=null&&(n.context_management=r.context_management),r.input_transformations!=null&&(n.input_transformations=r.input_transformations),r.usage.input_tokens!=null&&(n.usage.input_tokens=r.usage.input_tokens),r.usage.cache_creation_input_tokens!=null&&(n.usage.cache_creation_input_tokens=r.usage.cache_creation_input_tokens),r.usage.cache_read_input_tokens!=null&&(n.usage.cache_read_input_tokens=r.usage.cache_read_input_tokens),r.usage.server_tool_use!=null&&(n.usage.server_tool_use=r.usage.server_tool_use),r.usage.iterations!=null&&(n.usage.iterations=r.usage.iterations),r.usage.fallback_credit!=null&&(n.usage.fallback_credit=r.usage.fallback_credit),r.usage.output_tokens_details!=null&&(n.usage.output_tokens_details=r.usage.output_tokens_details),n;case"content_block_start":return n.content.push(r.content_block),r.content_block.type==="fallback"&&(n.model=r.content_block.to.model),n;case"content_block_delta":{let s=n.content.at(r.index);switch(r.delta.type){case"text_delta":{s?.type==="text"&&(n.content[r.index]={...s,text:(s.text||"")+r.delta.text});break}case"citations_delta":{s?.type==="text"&&(n.content[r.index]={...s,citations:[...s.citations??[],r.delta.citation]});break}case"input_json_delta":{if(s&&hd(s)){let o=(s[At]||"")+r.delta.partial_json;n.content[r.index]=Nc(s,o)}break}case"thinking_delta":{s?.type==="thinking"&&(n.content[r.index]={...s,thinking:s.thinking+r.delta.thinking});break}case"signature_delta":{s?.type==="thinking"&&(n.content[r.index]={...s,signature:r.delta.signature});break}case"compaction_delta":{if(s?.type==="compaction"){let o={...s,content:r.delta.content};"encrypted_content"in r.delta&&(o.encrypted_content=r.delta.encrypted_content),n.content[r.index]=o}break}default:r.delta}return n}case"content_block_stop":{let s=n.content.at(r.index);if(s&&hd(s)&&At in s){let o;try{o=s.input}catch(l){o={},a(this,Fs,"f").call(this,a(this,ge,"m",pd).call(this,s,l))}Object.defineProperty(s,"input",{value:o,enumerable:!0,configurable:!0,writable:!0})}return n}default:return n}},pd=function(r,n){let s=r[At];return new E(`Unable to parse tool parameter JSON from model. Please retry your request or adjust your prompt. Error: ${n}. JSON: ${s}`)},Symbol.asyncIterator)](){let e=[],r=[],n=!1;return this.on("_rawEvent",s=>{let o=r.shift();o?o.resolve(s):e.push(s)}),this.on("end",()=>{n=!0;for(let s of r)s.resolve(void 0);r.length=0}),this.on("abort",s=>{n=!0;for(let o of r)o.reject(s);r.length=0}),this.on("error",s=>{n=!0;for(let o of r)o.reject(s);r.length=0}),{next:async()=>e.length?{value:e.shift(),done:!1}:n?{value:void 0,done:!0}:new Promise((o,l)=>r.push({resolve:o,reject:l})).then(o=>o?{value:o,done:!1}:{value:void 0,done:!0}),return:async()=>(this.abort(),{value:void 0,done:!0})}}toReadableStream(){return new ue(this[Symbol.asyncIterator].bind(this),this.controller).toReadableStream()}}return t})();z();var I_={browser_toolset_20260801:"browser",computer_toolset_20260801:"computer"};function Pt(t){return I_[t.type]}function Lr(t){return"run"in t&&t.type!=null&&Object.prototype.hasOwnProperty.call(I_,t.type)}z();z();var _d=(()=>{class t extends E{constructor(e,r){super(e),r&&"cause"in r&&(this.cause=r.cause)}}return t._errorName="ToolsetUsageError",t})();var $r=(()=>{class t extends _d{}return t._errorName="ToolsetContractError",t})();var N_="Not executed: an earlier action in this turn failed.",z_={browser:N_,computer:"Not executed: an earlier computer action in this turn failed."};function O_(t){return Object.prototype.hasOwnProperty.call(z_,t)?z_[t]:N_}function Us(t,i,e=!1){return e&&(i===""||Array.isArray(i)&&i.length===0)&&(i="The tool call failed with an empty error message."),{type:"tool_result",tool_use_id:t.id,toolset_name:t.toolset_name??null,content:i,...e?{is_error:!0}:{}}}function xb(t,i){if(t instanceof _d)throw t;Pb(i.signal)}function Pb(t){if(t?.aborted)throw new ie}async function M_(t,i,e={}){let r=Pt(t);if(i.toolset_name!==r)throw new $r(`tool_use ${JSON.stringify(i.id)} (toolset_name=${JSON.stringify(i.toolset_name??null)}, name=${JSON.stringify(i.name)}) is not a member call of the ${JSON.stringify(r)} toolset`);let n={...e,toolUse:i,toolUseBlock:i};try{return Us(i,await t.run(n,i))}catch(s){return xb(s,n),Us(i,o_(s instanceof Pr?s.content:n_(s)),!0)}}z();var Ur=class extends f{retrieve(i,e){return this._client.get(u`/v1/organizations/api_keys/${i}`,{...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.api_keys.retrieve",e,{route:"/v1/organizations/api_keys/{api_key_id}",attributes:{"anthropic.organization.api_key.id":i}})})}update(i,e,r){return this._client.post(u`/v1/organizations/api_keys/${i}`,{body:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.api_keys.update",r,{route:"/v1/organizations/api_keys/{api_key_id}",attributes:{"anthropic.organization.api_key.id":i}})})}list(i={},e){return this._client.getAPIList("/v1/organizations/api_keys",F,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.api_keys.list",e,{route:"/v1/organizations/api_keys",queryParams:["after_id","before_id","created_by_user_id","limit","status","workspace_id"]})})}};var Hr=class extends f{list(i,e){return this._client.getAPIList("/v1/organizations/analytics/artifacts",v,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.analytics.artifacts.list",e,{route:"/v1/organizations/analytics/artifacts",queryParams:["date","filter","group_by","limit","page"]})})}};var Wr=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/analytics/connectors",v,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.analytics.connectors.list",e,{route:"/v1/organizations/analytics/connectors",queryParams:["date","ending_date","filter","group_by","limit","order","order_by","page","starting_date"],contentQueryParams:["filter"]})})}};var jr=class extends f{list(i,e){let{betas:r,...n}=i;return this._client.getAPIList("/v1/organizations/analytics/cost",fe,{query:n,...e,headers:d([{"anthropic-beta":[...r??[],"analytics-usage-cost-2026-08-24"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.analytics.cost.list",e,{route:"/v1/organizations/analytics/cost",queryParams:["actor_ids","actor_types","agent_ids","api_key_ids","claude_tag_categories","claude_tag_user_ids","context_windows","deployment_ids","ending_at","environment_ids","exclude_deleted_users","group_by","inference_geos","limit","models","order","order_by","organization_ids","page","products","rbac_group_ids","service_tiers","session_ids","slack_channel_ids","speeds","starting_at","time_bucket_width","user_profile_ids","workspace_ids"]})})}};var Kr=class extends f{list(i,e){return this._client.getAPIList("/v1/organizations/analytics/cost_report",fe,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.analytics.cost_report.list",e,{route:"/v1/organizations/analytics/cost_report",queryParams:["bucket_width","claude_tag_categories","claude_tag_user_ids","context_windows","ending_at","group_by","inference_geos","limit","models","page","products","rbac_group_ids","slack_channel_ids","speeds","starting_at","user_ids"]})})}};var Dr=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/analytics/plugins",v,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.analytics.plugins.list",e,{route:"/v1/organizations/analytics/plugins",queryParams:["date","ending_date","filter","group_by","limit","order","order_by","page","starting_date"],contentQueryParams:["filter"]})})}};var Gr=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/analytics/skills",v,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.analytics.skills.list",e,{route:"/v1/organizations/analytics/skills",queryParams:["date","ending_date","filter","group_by","limit","order","order_by","page","starting_date"],contentQueryParams:["filter"]})})}};var Vr=class extends f{list(i,e){return this._client.getAPIList("/v1/organizations/analytics/summaries",v,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.analytics.summaries.list",e,{route:"/v1/organizations/analytics/summaries",queryParams:["ending_date","filter","limit","page","starting_date"]})})}};var Jr=class extends f{list(i,e){let{betas:r,...n}=i;return this._client.getAPIList("/v1/organizations/analytics/usage",fe,{query:n,...e,headers:d([{"anthropic-beta":[...r??[],"analytics-usage-cost-2026-08-24"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.analytics.usage.list",e,{route:"/v1/organizations/analytics/usage",queryParams:["actor_ids","actor_types","agent_ids","api_key_ids","claude_tag_categories","claude_tag_user_ids","context_windows","deployment_ids","ending_at","environment_ids","exclude_deleted_users","group_by","inference_geos","limit","models","order","order_by","organization_ids","page","products","rbac_group_ids","service_tiers","session_ids","slack_channel_ids","speeds","starting_at","time_bucket_width","user_profile_ids","workspace_ids"]})})}};var Yr=class extends f{list(i,e){return this._client.getAPIList("/v1/organizations/analytics/usage_report",fe,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.analytics.usage_report.list",e,{route:"/v1/organizations/analytics/usage_report",queryParams:["bucket_width","claude_tag_categories","claude_tag_user_ids","context_windows","ending_at","group_by","inference_geos","limit","models","page","products","rbac_group_ids","slack_channel_ids","speeds","starting_at","user_ids"]})})}};var Qr=class extends f{list(i,e){return this._client.getAPIList("/v1/organizations/analytics/user_cost_report",fe,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.analytics.user_cost_report.list",e,{route:"/v1/organizations/analytics/user_cost_report",queryParams:["bucket_width","claude_tag_categories","claude_tag_user_ids","context_windows","ending_at","exclude_deleted_users","group_by","inference_geos","limit","models","order","order_by","page","products","rbac_group_ids","slack_channel_ids","speeds","starting_at","user_ids"]})})}};var Xr=class extends f{list(i,e){return this._client.getAPIList("/v1/organizations/analytics/user_usage_report",fe,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.analytics.user_usage_report.list",e,{route:"/v1/organizations/analytics/user_usage_report",queryParams:["bucket_width","claude_tag_categories","claude_tag_user_ids","context_windows","ending_at","exclude_deleted_users","group_by","inference_geos","limit","models","order","order_by","page","products","rbac_group_ids","slack_channel_ids","speeds","starting_at","user_ids"]})})}};var Zr=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/analytics/users",v,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.analytics.users.list",e,{route:"/v1/organizations/analytics/users",queryParams:["date","ending_date","filter","group_by","limit","order","order_by","page","starting_date"],contentQueryParams:["page"]})})}};var ei=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/analytics/apps/chat/projects",v,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.analytics.apps.chat.projects.list",e,{route:"/v1/organizations/analytics/apps/chat/projects",queryParams:["date","ending_date","filter","group_by","limit","order","order_by","page","starting_date"]})})}};var Hc=(()=>{class t extends f{constructor(){super(...arguments),this.projects=new ei(this._client)}}return t.Projects=ei,t})();var Wc=(()=>{class t extends f{constructor(){super(...arguments),this.chat=new Hc(this._client)}}return t.Chat=Hc,t})();var jc=(()=>{class t extends f{constructor(){super(...arguments),this.summaries=new Vr(this._client),this.users=new Zr(this._client),this.apps=new Wc(this._client),this.connectors=new Wr(this._client),this.plugins=new Dr(this._client),this.skills=new Gr(this._client),this.artifacts=new Hr(this._client),this.usage=new Jr(this._client),this.cost=new jr(this._client),this.usageReport=new Yr(this._client),this.userUsageReport=new Xr(this._client),this.costReport=new Kr(this._client),this.userCostReport=new Qr(this._client)}}return t.Summaries=Vr,t.Users=Zr,t.Apps=Wc,t.Connectors=Wr,t.Plugins=Dr,t.Skills=Gr,t.Artifacts=Hr,t.Usage=Jr,t.Cost=jr,t.UsageReport=Yr,t.UserUsageReport=Xr,t.CostReport=Kr,t.UserCostReport=Qr,t})();var ti=class extends f{create(i,e){let{betas:r,...n}=i;return this._client.post("/v1/organizations/claude_tag/slack_channels",{body:n,...e,headers:d([{"anthropic-beta":[...r??[],"experimental-claude-tag-2026-10-21"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.slack_channels.create",e,{route:"/v1/organizations/claude_tag/slack_channels",createdIDAttribute:"anthropic.organization.claude_tag.slack_channel.id"})})}retrieve(i,e={},r){let{betas:n,...s}=e??{};return this._client.get(u`/v1/organizations/claude_tag/slack_channels/${i}`,{query:s,...r,headers:d([{"anthropic-beta":[...n??[],"experimental-claude-tag-2026-10-21"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.slack_channels.retrieve",r,{route:"/v1/organizations/claude_tag/slack_channels/{id}",queryParams:["include_inherited"],attributes:{"anthropic.organization.claude_tag.slack_channel.id":i}})})}update(i,e,r){let{betas:n,...s}=e;return this._client.post(u`/v1/organizations/claude_tag/slack_channels/${i}`,{body:s,...r,headers:d([{"anthropic-beta":[...n??[],"experimental-claude-tag-2026-10-21"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.slack_channels.update",r,{route:"/v1/organizations/claude_tag/slack_channels/{id}",attributes:{"anthropic.organization.claude_tag.slack_channel.id":i}})})}list(i,e){let{betas:r,...n}=i;return this._client.getAPIList("/v1/organizations/claude_tag/slack_channels",v,{query:n,...e,headers:d([{"anthropic-beta":[...r??[],"experimental-claude-tag-2026-10-21"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.slack_channels.list",e,{route:"/v1/organizations/claude_tag/slack_channels",queryParams:["include_inherited","limit","page","slack_channel_id","slack_workspace_id"]})})}delete(i,e={},r){let{betas:n}=e??{};return this._client.delete(u`/v1/organizations/claude_tag/slack_channels/${i}`,{...r,headers:d([{"anthropic-beta":[...n??[],"experimental-claude-tag-2026-10-21"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.slack_channels.delete",r,{route:"/v1/organizations/claude_tag/slack_channels/{id}",attributes:{"anthropic.organization.claude_tag.slack_channel.id":i}})})}};var ri=class extends f{retrieve(i,e={},r){let{betas:n,...s}=e??{};return this._client.get(u`/v1/organizations/claude_tag/slack_workspaces/${i}`,{query:s,...r,headers:d([{"anthropic-beta":[...n??[],"experimental-claude-tag-2026-10-21"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.slack_workspaces.retrieve",r,{route:"/v1/organizations/claude_tag/slack_workspaces/{id}",queryParams:["include_inherited"],attributes:{"anthropic.organization.claude_tag.slack_workspace.id":i}})})}update(i,e,r){let{betas:n,...s}=e;return this._client.post(u`/v1/organizations/claude_tag/slack_workspaces/${i}`,{body:s,...r,headers:d([{"anthropic-beta":[...n??[],"experimental-claude-tag-2026-10-21"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.slack_workspaces.update",r,{route:"/v1/organizations/claude_tag/slack_workspaces/{id}",attributes:{"anthropic.organization.claude_tag.slack_workspace.id":i}})})}list(i={},e){let{betas:r,...n}=i??{};return this._client.getAPIList("/v1/organizations/claude_tag/slack_workspaces",v,{query:n,...e,headers:d([{"anthropic-beta":[...r??[],"experimental-claude-tag-2026-10-21"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.slack_workspaces.list",e,{route:"/v1/organizations/claude_tag/slack_workspaces",queryParams:["include_inherited","limit","page","slack_workspace_id"]})})}};var ii=class extends f{create(i,e,r){let{target:n,betas:s}=e;return this._client.post(u`/v1/organizations/claude_tag/bundles/${i}/targets`,{body:n,...r,headers:d([{"anthropic-beta":[...s??[],"experimental-claude-tag-2026-10-21"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.bundles.targets.create",r,{route:"/v1/organizations/claude_tag/bundles/{bundle_id}/targets",attributes:{"anthropic.organization.claude_tag.bundle.id":i}})})}retrieve(i,e,r){let{bundle_id:n,betas:s}=e;return this._client.get(u`/v1/organizations/claude_tag/bundles/${n}/targets/${i}`,{...r,headers:d([{"anthropic-beta":[...s??[],"experimental-claude-tag-2026-10-21"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.bundles.targets.retrieve",r,{route:"/v1/organizations/claude_tag/bundles/{bundle_id}/targets/{target_id}",attributes:{"anthropic.organization.claude_tag.bundle.id":n,"anthropic.organization.claude_tag.bundle.target.id":i}})})}list(i,e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList(u`/v1/organizations/claude_tag/bundles/${i}/targets`,v,{query:s,...r,headers:d([{"anthropic-beta":[...n??[],"experimental-claude-tag-2026-10-21"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.bundles.targets.list",r,{route:"/v1/organizations/claude_tag/bundles/{bundle_id}/targets",queryParams:["limit","page"],attributes:{"anthropic.organization.claude_tag.bundle.id":i}})})}delete(i,e,r){let{bundle_id:n,betas:s}=e;return this._client.delete(u`/v1/organizations/claude_tag/bundles/${n}/targets/${i}`,{...r,headers:d([{"anthropic-beta":[...s??[],"experimental-claude-tag-2026-10-21"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.bundles.targets.delete",r,{route:"/v1/organizations/claude_tag/bundles/{bundle_id}/targets/{target_id}",attributes:{"anthropic.organization.claude_tag.bundle.id":n,"anthropic.organization.claude_tag.bundle.target.id":i}})})}};var Kc=(()=>{class t extends f{constructor(){super(...arguments),this.targets=new ii(this._client)}retrieve(e,r={},n){let{betas:s}=r??{};return this._client.get(u`/v1/organizations/claude_tag/bundles/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"experimental-claude-tag-2026-10-21"].toString()},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.bundles.retrieve",n,{route:"/v1/organizations/claude_tag/bundles/{bundle_id}",attributes:{"anthropic.organization.claude_tag.bundle.id":e}})})}update(e,r,n){let{betas:s,...o}=r;return this._client.post(u`/v1/organizations/claude_tag/bundles/${e}`,{body:o,...n,headers:d([{"anthropic-beta":[...s??[],"experimental-claude-tag-2026-10-21"].toString()},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.bundles.update",n,{route:"/v1/organizations/claude_tag/bundles/{bundle_id}",attributes:{"anthropic.organization.claude_tag.bundle.id":e}})})}list(e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList("/v1/organizations/claude_tag/bundles",v,{query:s,...r,headers:d([{"anthropic-beta":[...n??[],"experimental-claude-tag-2026-10-21"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_tag.bundles.list",r,{route:"/v1/organizations/claude_tag/bundles",queryParams:["limit","page"]})})}}return t.Targets=ii,t})();z();var Hs=(()=>{class t extends P{}return t._errorName="BetaBundleAttachmentNotSupportedError",t})(),Ws=(()=>{class t extends P{}return t._errorName="BetaBundleOnCallError",t})(),js=(()=>{class t extends P{}return t._errorName="BetaSlackChannelSetUpSettingsRefusedError",t})(),Ks=(()=>{class t extends D{}return t._errorName="BetaAPIKeyScopeMissingError",t})(),Ds=(()=>{class t extends D{}return t._errorName="BetaClaudeTagWritesNotEnabledError",t})(),Gs=(()=>{class t extends D{}return t._errorName="BetaComplianceConfigurationRestrictedError",t})(),Vs=(()=>{class t extends D{}return t._errorName="BetaOrganizationLevelScopedAPIKeyRequiredError",t})(),Js=(()=>{class t extends ae{}return t._errorName="BetaSlackChannelSetUpEnvironmentNotFoundError",t})(),Ys=(()=>{class t extends pe{}return t._errorName="BetaSlackChannelSetUpSettingsConflictError",t})(),Dc=(()=>{class t extends f{constructor(){super(...arguments),this.slackChannels=new ti(this._client),this.slackWorkspaces=new ri(this._client),this.bundles=new Kc(this._client)}}return t.BetaBundleAttachmentNotSupportedError=Hs,t.BetaBundleOnCallError=Ws,t.BetaSlackChannelSetUpSettingsRefusedError=js,t.BetaAPIKeyScopeMissingError=Ks,t.BetaClaudeTagWritesNotEnabledError=Ds,t.BetaComplianceConfigurationRestrictedError=Gs,t.BetaOrganizationLevelScopedAPIKeyRequiredError=Vs,t.BetaSlackChannelSetUpEnvironmentNotFoundError=Js,t.BetaSlackChannelSetUpSettingsConflictError=Ys,t.SlackChannels=ti,t.SlackWorkspaces=ri,t.Bundles=Kc,t})();z();var Qs=(()=>{class t extends P{}return t._errorName="BetaCannotSignOutPrimaryOwnerError",t})(),Xs=(()=>{class t extends P{}return t._errorName="BetaCannotSignOutSelfError",t})(),Zs=(()=>{class t extends D{}return t._errorName="BetaCannotSignOutManagedMemberError",t})(),eo=(()=>{class t extends D{}return t._errorName="BetaCannotSignOutMembershipAdminError",t})(),to=(()=>{class t extends D{}return t._errorName="BetaCannotSignOutOwnerError",t})(),ro=(()=>{class t extends D{}return t._errorName="BetaCannotSignOutPrivilegedMemberError",t})(),Gc=(()=>{class t extends f{retrieve(e,r){return this._client.get(u`/v1/organizations/users/${e}`,{...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.users.retrieve",r,{route:"/v1/organizations/users/{user_id}",attributes:{"anthropic.organization.user.id":e}})})}update(e,r,n){return this._client.post(u`/v1/organizations/users/${e}`,{body:r,...n,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.users.update",n,{route:"/v1/organizations/users/{user_id}",attributes:{"anthropic.organization.user.id":e}})})}list(e={},r){return this._client.getAPIList("/v1/organizations/users",F,{query:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.users.list",r,{route:"/v1/organizations/users",queryParams:["after_id","before_id","email","limit","roles"]})})}remove(e,r){return this._client.delete(u`/v1/organizations/users/${e}`,{...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.users.remove",r,{route:"/v1/organizations/users/{user_id}",attributes:{"anthropic.organization.user.id":e}})})}signOut(e,r={},n){let{betas:s}=r??{};return this._client.post(u`/v1/organizations/users/${e}/sign_out`,{...n,headers:d([{"anthropic-beta":[...s??[],"admin-user-sign-out-2026-10-08"].toString()},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.users.sign_out",n,{route:"/v1/organizations/users/{user_id}/sign_out",attributes:{"anthropic.organization.user.id":e}})})}}return t.BetaCannotSignOutPrimaryOwnerError=Qs,t.BetaCannotSignOutSelfError=Xs,t.BetaCannotSignOutManagedMemberError=Zs,t.BetaCannotSignOutMembershipAdminError=eo,t.BetaCannotSignOutOwnerError=to,t.BetaCannotSignOutPrivilegedMemberError=ro,t})();var ni=class extends f{list(i,e={},r){return this._client.getAPIList(u`/v1/organizations/rbac_groups/${i}/members`,v,{query:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.rbac_groups.members.list",r,{route:"/v1/organizations/rbac_groups/{rbac_group_id}/members",queryParams:["limit","page"],attributes:{"anthropic.organization.rbac_group.id":i}})})}add(i,e,r){return this._client.post(u`/v1/organizations/rbac_groups/${i}/members`,{body:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.rbac_groups.members.add",r,{route:"/v1/organizations/rbac_groups/{rbac_group_id}/members",attributes:{"anthropic.organization.rbac_group.id":i},createdIDAttribute:"anthropic.organization.rbac_group.member.id",createdIDField:"user_id"})})}remove(i,e,r){let{rbac_group_id:n}=e;return this._client.delete(u`/v1/organizations/rbac_groups/${n}/members/${i}`,{...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.rbac_groups.members.remove",r,{route:"/v1/organizations/rbac_groups/{rbac_group_id}/members/{user_id}",attributes:{"anthropic.organization.rbac_group.id":n,"anthropic.organization.rbac_group.member.id":i}})})}};z();var io=(()=>{class t extends ae{}return t._errorName="BetaRBACGroupNotFoundError",t})(),Vc=(()=>{class t extends f{constructor(){super(...arguments),this.members=new ni(this._client)}create(e,r){return this._client.post("/v1/organizations/rbac_groups",{body:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.rbac_groups.create",r,{route:"/v1/organizations/rbac_groups",createdIDAttribute:"anthropic.organization.rbac_group.id"})})}retrieve(e,r){return this._client.get(u`/v1/organizations/rbac_groups/${e}`,{...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.rbac_groups.retrieve",r,{route:"/v1/organizations/rbac_groups/{rbac_group_id}",attributes:{"anthropic.organization.rbac_group.id":e}})})}update(e,r,n){return this._client.post(u`/v1/organizations/rbac_groups/${e}`,{body:r,...n,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.rbac_groups.update",n,{route:"/v1/organizations/rbac_groups/{rbac_group_id}",attributes:{"anthropic.organization.rbac_group.id":e}})})}list(e={},r){return this._client.getAPIList("/v1/organizations/rbac_groups",v,{query:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.rbac_groups.list",r,{route:"/v1/organizations/rbac_groups",queryParams:["limit","page"]})})}delete(e,r){return this._client.delete(u`/v1/organizations/rbac_groups/${e}`,{...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.rbac_groups.delete",r,{route:"/v1/organizations/rbac_groups/{rbac_group_id}",attributes:{"anthropic.organization.rbac_group.id":e}})})}}return t.BetaRBACGroupNotFoundError=io,t.Members=ni,t})();var si=class extends f{list(i,e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList(u`/v1/organizations/plugins/${i}/installation_settings`,v,{query:s,...r,headers:d([{"anthropic-beta":[...n??[],"ce-plugins-2026-09-01"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugins.installation_settings.list",r,{route:"/v1/organizations/plugins/{plugin_id}/installation_settings",queryParams:["limit","organization_id","page","target_type"],attributes:{"anthropic.organization.plugin.id":i}})})}remove(i,e,r){let{plugin_id:n,betas:s}=e;return this._client.delete(u`/v1/organizations/plugins/${n}/installation_settings/${i}`,{...r,headers:d([{"anthropic-beta":[...s??[],"ce-plugins-2026-09-01"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugins.installation_settings.remove",r,{route:"/v1/organizations/plugins/{plugin_id}/installation_settings/{target}",attributes:{"anthropic.organization.plugin.id":n,"anthropic.organization.plugin.installation_setting.id":i}})})}set(i,e,r){let{plugin_id:n,betas:s,...o}=e;return this._client.post(u`/v1/organizations/plugins/${n}/installation_settings/${i}`,{body:o,...r,headers:d([{"anthropic-beta":[...s??[],"ce-plugins-2026-09-01"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugins.installation_settings.set",r,{route:"/v1/organizations/plugins/{plugin_id}/installation_settings/{target}",attributes:{"anthropic.organization.plugin.id":n,"anthropic.organization.plugin.installation_setting.id":i}})})}};var oi=class extends f{list(i,e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList(u`/v1/organizations/plugins/${i}/shares`,v,{query:s,...r,headers:d([{"anthropic-beta":[...n??[],"ce-plugins-2026-09-01"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugins.shares.list",r,{route:"/v1/organizations/plugins/{plugin_id}/shares",queryParams:["limit","organization_id","page","target_type"],attributes:{"anthropic.organization.plugin.id":i}})})}};var ai=class extends f{create(i,e,r){let{betas:n,...s}=e;return this._client.post(u`/v1/organizations/plugins/${i}/versions`,ne({body:s,...r,headers:d([{"anthropic-beta":[...n??[],"ce-plugins-2026-09-01"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugins.versions.create",r,{route:"/v1/organizations/plugins/{plugin_id}/versions",attributes:{"anthropic.organization.plugin.id":i},createdIDAttribute:"anthropic.organization.plugin.version.id"})},this._client))}retrieve(i,e,r){let{plugin_id:n,betas:s,...o}=e;return this._client.get(u`/v1/organizations/plugins/${n}/versions/${i}`,{query:o,...r,headers:d([{"anthropic-beta":[...s??[],"ce-plugins-2026-09-01"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugins.versions.retrieve",r,{route:"/v1/organizations/plugins/{plugin_id}/versions/{version}",queryParams:["organization_id"],attributes:{"anthropic.organization.plugin.id":n,"anthropic.organization.plugin.version.id":i}})})}list(i,e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList(u`/v1/organizations/plugins/${i}/versions`,v,{query:s,...r,headers:d([{"anthropic-beta":[...n??[],"ce-plugins-2026-09-01"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugins.versions.list",r,{route:"/v1/organizations/plugins/{plugin_id}/versions",queryParams:["limit","organization_id","page"],attributes:{"anthropic.organization.plugin.id":i}})})}download(i,e,r){let{plugin_id:n,betas:s,...o}=e;return this._client.get(u`/v1/organizations/plugins/${n}/versions/${i}/content`,{query:o,...r,headers:d([{"anthropic-beta":[...s??[],"ce-plugins-2026-09-01"].toString(),Accept:"application/binary"},r?.headers]),__qualifiers:{beta:"true"},__binaryResponse:!0,__span:c(this._client,"anthropic.organization.plugins.versions.download",r,{route:"/v1/organizations/plugins/{plugin_id}/versions/{version}/content",queryParams:["organization_id"],attributes:{"anthropic.organization.plugin.id":n,"anthropic.organization.plugin.version.id":i}})})}};z();var no=(()=>{class t extends P{}return t._errorName="BetaScanFailedError",t})(),so=(()=>{class t extends pe{}return t._errorName="BetaPluginNameTakenError",t})(),oo=(()=>{class t extends pe{}return t._errorName="BetaScanPendingError",t})(),ao=(()=>{class t extends pe{}return t._errorName="BetaSkillNameTakenError",t})(),co=(()=>{class t extends ht{}return t._errorName="BetaRegistrationPendingError",t})(),Jc=(()=>{class t extends f{constructor(){super(...arguments),this.versions=new ai(this._client),this.installationSettings=new si(this._client),this.shares=new oi(this._client)}create(e,r){let{betas:n,...s}=e;return this._client.post("/v1/organizations/plugins",ne({body:s,...r,headers:d([{"anthropic-beta":[...n??[],"ce-plugins-2026-09-01"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugins.create",r,{route:"/v1/organizations/plugins",createdIDAttribute:"anthropic.organization.plugin.id"})},this._client))}retrieve(e,r={},n){let{betas:s,...o}=r??{};return this._client.get(u`/v1/organizations/plugins/${e}`,{query:o,...n,headers:d([{"anthropic-beta":[...s??[],"ce-plugins-2026-09-01"].toString()},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugins.retrieve",n,{route:"/v1/organizations/plugins/{plugin_id}",queryParams:["organization_id"],attributes:{"anthropic.organization.plugin.id":e}})})}update(e,r,n){let{betas:s,...o}=r;return this._client.post(u`/v1/organizations/plugins/${e}`,{body:o,...n,headers:d([{"anthropic-beta":[...s??[],"ce-plugins-2026-09-01"].toString()},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugins.update",n,{route:"/v1/organizations/plugins/{plugin_id}",attributes:{"anthropic.organization.plugin.id":e}})})}list(e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList("/v1/organizations/plugins",v,{query:s,...r,headers:d([{"anthropic-beta":[...n??[],"ce-plugins-2026-09-01"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugins.list",r,{route:"/v1/organizations/plugins",queryParams:["created_at[gt]","created_at[gte]","created_at[lt]","created_at[lte]","limit","marketplace_id","organization_id","owner_type","owner_user_id","page"]})})}delete(e,r={},n){let{betas:s}=r??{};return this._client.delete(u`/v1/organizations/plugins/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"ce-plugins-2026-09-01"].toString()},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugins.delete",n,{route:"/v1/organizations/plugins/{plugin_id}",attributes:{"anthropic.organization.plugin.id":e}})})}}return t.BetaScanFailedError=no,t.BetaPluginNameTakenError=so,t.BetaScanPendingError=oo,t.BetaSkillNameTakenError=ao,t.BetaRegistrationPendingError=co,t.Versions=ai,t.InstallationSettings=si,t.Shares=oi,t})();var ci=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/spend_limits/effective",v,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.spend_limits.effective.list",e,{route:"/v1/organizations/spend_limits/effective",queryParams:["limit","page","period","user_ids"]})})}};var li=class extends f{retrieve(i,e){return this._client.get(u`/v1/organizations/spend_limit_increase_requests/${i}`,{...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.spend_limits.increase_requests.retrieve",e,{route:"/v1/organizations/spend_limit_increase_requests/{spend_limit_increase_request_id}",attributes:{"anthropic.organization.spend_limit_increase_request.id":i}})})}list(i={},e){return this._client.getAPIList("/v1/organizations/spend_limit_increase_requests",v,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.spend_limits.increase_requests.list",e,{route:"/v1/organizations/spend_limit_increase_requests",queryParams:["actor_ids","limit","page","status"]})})}approve(i,e,r){return this._client.post(u`/v1/organizations/spend_limit_increase_requests/${i}/approve`,{body:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.spend_limits.increase_requests.approve",r,{route:"/v1/organizations/spend_limit_increase_requests/{spend_limit_increase_request_id}/approve",attributes:{"anthropic.organization.spend_limit_increase_request.id":i}})})}deny(i,e,r){return this._client.post(u`/v1/organizations/spend_limit_increase_requests/${i}/deny`,{body:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.spend_limits.increase_requests.deny",r,{route:"/v1/organizations/spend_limit_increase_requests/{spend_limit_increase_request_id}/deny",attributes:{"anthropic.organization.spend_limit_increase_request.id":i}})})}};z();var lo=(()=>{class t extends D{}return t._errorName="BetaSpendLimitsAdminAPIWritesNotEnabledError",t})(),Yc=(()=>{class t extends f{constructor(){super(...arguments),this.effective=new ci(this._client),this.increaseRequests=new li(this._client)}retrieve(e,r){return this._client.get(u`/v1/organizations/spend_limits/${e}`,{...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.spend_limits.retrieve",r,{route:"/v1/organizations/spend_limits/{spend_limit_id}",attributes:{"anthropic.organization.spend_limit.id":e}})})}list(e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList("/v1/organizations/spend_limits",v,{query:s,...r,headers:d([{"anthropic-beta":[...n??[],"spend-limit-reads-2026-09-26"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.spend_limits.list",r,{route:"/v1/organizations/spend_limits",queryParams:["limit","page","scope_type","workspace_id"]})})}delete(e,r){return this._client.delete(u`/v1/organizations/spend_limits/${e}`,{...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.spend_limits.delete",r,{route:"/v1/organizations/spend_limits/{spend_limit_id}",attributes:{"anthropic.organization.spend_limit.id":e}})})}set(e,r){let{betas:n,...s}=e;return this._client.post("/v1/organizations/spend_limits",{body:s,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.spend_limits.set",r,{route:"/v1/organizations/spend_limits",createdIDAttribute:"anthropic.organization.spend_limit.id"})})}}return t.BetaSpendLimitsAdminAPIWritesNotEnabledError=lo,t.Effective=ci,t.IncreaseRequests=li,t})();var ui=class extends f{retrieve(i={},e){let{betas:r}=i??{};return this._client.get("/v1/organizations/claude_code/managed_settings/configuration",{...e,headers:d([{"anthropic-beta":[...r??[],"ce-claude-code-managed-settings-2026-10-06"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_code.managed_settings.configuration.retrieve",e,{route:"/v1/organizations/claude_code/managed_settings/configuration"})})}update(i,e){let{betas:r,...n}=i;return this._client.post("/v1/organizations/claude_code/managed_settings/configuration",{body:n,...e,headers:d([{"anthropic-beta":[...r??[],"ce-claude-code-managed-settings-2026-10-06"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_code.managed_settings.configuration.update",e,{route:"/v1/organizations/claude_code/managed_settings/configuration"})})}};var di=class extends f{retrieve(i={},e){let{betas:r}=i??{};return this._client.get("/v1/organizations/claude_code/managed_settings/rbac_group_default",{...e,headers:d([{"anthropic-beta":[...r??[],"ce-claude-code-managed-settings-2026-10-06"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_code.managed_settings.rbac_group_default.retrieve",e,{route:"/v1/organizations/claude_code/managed_settings/rbac_group_default"})})}update(i,e){let{betas:r,...n}=i;return this._client.post("/v1/organizations/claude_code/managed_settings/rbac_group_default",{body:n,...e,headers:d([{"anthropic-beta":[...r??[],"ce-claude-code-managed-settings-2026-10-06"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_code.managed_settings.rbac_group_default.update",e,{route:"/v1/organizations/claude_code/managed_settings/rbac_group_default"})})}};var pi=class extends f{retrieve(i,e={},r){let{betas:n}=e??{};return this._client.get(u`/v1/organizations/claude_code/managed_settings/rbac_groups/${i}`,{...r,headers:d([{"anthropic-beta":[...n??[],"ce-claude-code-managed-settings-2026-10-06"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_code.managed_settings.rbac_groups.retrieve",r,{route:"/v1/organizations/claude_code/managed_settings/rbac_groups/{rbac_group_id}",attributes:{"anthropic.organization.claude_code.managed_setting.rbac_group.id":i}})})}list(i={},e){let{betas:r,...n}=i??{};return this._client.getAPIList("/v1/organizations/claude_code/managed_settings/rbac_groups",v,{query:n,...e,headers:d([{"anthropic-beta":[...r??[],"ce-claude-code-managed-settings-2026-10-06"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_code.managed_settings.rbac_groups.list",e,{route:"/v1/organizations/claude_code/managed_settings/rbac_groups",queryParams:["limit","page"]})})}delete(i,e={},r){let{betas:n}=e??{};return this._client.delete(u`/v1/organizations/claude_code/managed_settings/rbac_groups/${i}`,{...r,headers:d([{"anthropic-beta":[...n??[],"ce-claude-code-managed-settings-2026-10-06"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_code.managed_settings.rbac_groups.delete",r,{route:"/v1/organizations/claude_code/managed_settings/rbac_groups/{rbac_group_id}",attributes:{"anthropic.organization.claude_code.managed_setting.rbac_group.id":i}})})}set(i,e,r){let{betas:n,...s}=e;return this._client.post(u`/v1/organizations/claude_code/managed_settings/rbac_groups/${i}`,{body:s,...r,headers:d([{"anthropic-beta":[...n??[],"ce-claude-code-managed-settings-2026-10-06"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.claude_code.managed_settings.rbac_groups.set",r,{route:"/v1/organizations/claude_code/managed_settings/rbac_groups/{rbac_group_id}",attributes:{"anthropic.organization.claude_code.managed_setting.rbac_group.id":i}})})}};z();var uo=(()=>{class t extends P{}return t._errorName="BetaCMEKFeatureUnsupportedError",t})(),po=(()=>{class t extends P{}return t._errorName="BetaRBACGroupOrderLimitExceededError",t})(),ho=(()=>{class t extends P{}return t._errorName="BetaSettingsDocumentLimitExceededError",t})(),_o=(()=>{class t extends P{}return t._errorName="BetaSettingsHistoryLimitExceededError",t})(),fo=(()=>{class t extends ae{}return t._errorName="BetaRBACGroupManagedSettingsNotFoundError",t})(),Qc=(()=>{class t extends f{constructor(){super(...arguments),this.configuration=new ui(this._client),this.rbacGroups=new pi(this._client),this.rbacGroupDefault=new di(this._client)}}return t.BetaCMEKFeatureUnsupportedError=uo,t.BetaRBACGroupOrderLimitExceededError=po,t.BetaSettingsDocumentLimitExceededError=ho,t.BetaSettingsHistoryLimitExceededError=_o,t.BetaRBACGroupManagedSettingsNotFoundError=fo,t.Configuration=ui,t.RBACGroups=pi,t.RBACGroupDefault=di,t})();var Xc=(()=>{class t extends f{constructor(){super(...arguments),this.managedSettings=new Qc(this._client)}}return t.ManagedSettings=Qc,t.BetaCMEKFeatureUnsupportedError=uo,t.BetaRBACGroupOrderLimitExceededError=po,t.BetaSettingsDocumentLimitExceededError=ho,t.BetaSettingsHistoryLimitExceededError=_o,t.BetaRBACGroupManagedSettingsNotFoundError=fo,t})();var hi=class extends f{retrieve(i){return this._client.get("/v1/organizations/compliance_settings",{...i,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.compliance_settings.retrieve",i,{route:"/v1/organizations/compliance_settings"})})}update(i,e){return this._client.post("/v1/organizations/compliance_settings",{body:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.compliance_settings.update",e,{route:"/v1/organizations/compliance_settings"})})}};var _i=class extends f{create(i,e){return this._client.post("/v1/organizations/external_keys",{body:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.external_keys.create",e,{route:"/v1/organizations/external_keys",createdIDAttribute:"anthropic.organization.external_key.id"})})}retrieve(i,e){return this._client.get(u`/v1/organizations/external_keys/${i}`,{...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.external_keys.retrieve",e,{route:"/v1/organizations/external_keys/{external_key_id}",attributes:{"anthropic.organization.external_key.id":i}})})}update(i,e,r){return this._client.post(u`/v1/organizations/external_keys/${i}`,{body:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.external_keys.update",r,{route:"/v1/organizations/external_keys/{external_key_id}",attributes:{"anthropic.organization.external_key.id":i}})})}list(i={},e){return this._client.getAPIList("/v1/organizations/external_keys",v,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.external_keys.list",e,{route:"/v1/organizations/external_keys",queryParams:["limit","page"]})})}delete(i,e){return this._client.delete(u`/v1/organizations/external_keys/${i}`,{...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.external_keys.delete",e,{route:"/v1/organizations/external_keys/{external_key_id}",attributes:{"anthropic.organization.external_key.id":i}})})}validate(i,e){return this._client.post(u`/v1/organizations/external_keys/${i}/validate`,{...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.external_keys.validate",e,{route:"/v1/organizations/external_keys/{external_key_id}/validate",attributes:{"anthropic.organization.external_key.id":i}})})}};var fi=class extends f{create(i,e){let{betas:r,...n}=i;return this._client.post("/v1/organizations/federation_issuers",{body:n,...e,headers:d([{...r?.toString()!=null?{"anthropic-beta":r?.toString()}:void 0},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.federation.issuers.create",e,{route:"/v1/organizations/federation_issuers",createdIDAttribute:"anthropic.organization.federation_issuer.id"})})}retrieve(i,e={},r){let{betas:n}=e??{};return this._client.get(u`/v1/organizations/federation_issuers/${i}`,{...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.federation.issuers.retrieve",r,{route:"/v1/organizations/federation_issuers/{federation_issuer_id}",attributes:{"anthropic.organization.federation_issuer.id":i}})})}update(i,e,r){let{betas:n,...s}=e;return this._client.post(u`/v1/organizations/federation_issuers/${i}`,{body:s,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.federation.issuers.update",r,{route:"/v1/organizations/federation_issuers/{federation_issuer_id}",attributes:{"anthropic.organization.federation_issuer.id":i}})})}list(i={},e){let{betas:r,...n}=i??{};return this._client.getAPIList("/v1/organizations/federation_issuers",v,{query:n,...e,headers:d([{...r?.toString()!=null?{"anthropic-beta":r?.toString()}:void 0},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.federation.issuers.list",e,{route:"/v1/organizations/federation_issuers",queryParams:["include_archived","limit","page"]})})}archive(i,e={},r){let{betas:n}=e??{};return this._client.post(u`/v1/organizations/federation_issuers/${i}/archive`,{...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.federation.issuers.archive",r,{route:"/v1/organizations/federation_issuers/{federation_issuer_id}/archive",attributes:{"anthropic.organization.federation_issuer.id":i}})})}};var mi=class extends f{list(i,e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList(u`/v1/organizations/federation_rules/${i}/workspaces`,v,{query:s,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.federation.rules.workspaces.list",r,{route:"/v1/organizations/federation_rules/{federation_rule_id}/workspaces",queryParams:["limit","page"],attributes:{"anthropic.organization.federation_rule.id":i}})})}add(i,e,r){let{betas:n,...s}=e;return this._client.post(u`/v1/organizations/federation_rules/${i}/workspaces`,{body:s,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.federation.rules.workspaces.add",r,{route:"/v1/organizations/federation_rules/{federation_rule_id}/workspaces",attributes:{"anthropic.organization.federation_rule.id":i},createdIDAttribute:"anthropic.organization.federation_rule.workspace.id",createdIDField:"workspace_id"})})}remove(i,e,r){let{federation_rule_id:n,betas:s}=e;return this._client.delete(u`/v1/organizations/federation_rules/${n}/workspaces/${i}`,{...r,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.federation.rules.workspaces.remove",r,{route:"/v1/organizations/federation_rules/{federation_rule_id}/workspaces/{workspace_id}",attributes:{"anthropic.organization.federation_rule.id":n,"anthropic.organization.federation_rule.workspace.id":i}})})}};var Zc=(()=>{class t extends f{constructor(){super(...arguments),this.workspaces=new mi(this._client)}create(e,r){let{betas:n,...s}=e;return this._client.post("/v1/organizations/federation_rules",{body:s,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.federation.rules.create",r,{route:"/v1/organizations/federation_rules",createdIDAttribute:"anthropic.organization.federation_rule.id"})})}retrieve(e,r={},n){let{betas:s}=r??{};return this._client.get(u`/v1/organizations/federation_rules/${e}`,{...n,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.federation.rules.retrieve",n,{route:"/v1/organizations/federation_rules/{federation_rule_id}",attributes:{"anthropic.organization.federation_rule.id":e}})})}update(e,r,n){let{betas:s,...o}=r;return this._client.post(u`/v1/organizations/federation_rules/${e}`,{body:o,...n,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.federation.rules.update",n,{route:"/v1/organizations/federation_rules/{federation_rule_id}",attributes:{"anthropic.organization.federation_rule.id":e}})})}list(e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList("/v1/organizations/federation_rules",v,{query:s,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.federation.rules.list",r,{route:"/v1/organizations/federation_rules",queryParams:["include_archived","issuer_id","limit","page"]})})}archive(e,r={},n){let{betas:s}=r??{};return this._client.post(u`/v1/organizations/federation_rules/${e}/archive`,{...n,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.federation.rules.archive",n,{route:"/v1/organizations/federation_rules/{federation_rule_id}/archive",attributes:{"anthropic.organization.federation_rule.id":e}})})}}return t.Workspaces=mi,t})();var el=(()=>{class t extends f{constructor(){super(...arguments),this.issuers=new fi(this._client),this.rules=new Zc(this._client)}}return t.Issuers=fi,t.Rules=Zc,t})();var gi=class extends f{create(i,e){return this._client.post("/v1/organizations/invites",{body:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.invites.create",e,{route:"/v1/organizations/invites",createdIDAttribute:"anthropic.organization.invite.id"})})}retrieve(i,e){return this._client.get(u`/v1/organizations/invites/${i}`,{...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.invites.retrieve",e,{route:"/v1/organizations/invites/{invite_id}",attributes:{"anthropic.organization.invite.id":i}})})}list(i={},e){return this._client.getAPIList("/v1/organizations/invites",F,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.invites.list",e,{route:"/v1/organizations/invites",queryParams:["after_id","before_id","email","limit","roles","statuses"]})})}delete(i,e){return this._client.delete(u`/v1/organizations/invites/${i}`,{...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.invites.delete",e,{route:"/v1/organizations/invites/{invite_id}",attributes:{"anthropic.organization.invite.id":i}})})}};var bi=class extends f{retrieve(i,e={},r){let{betas:n,...s}=e??{};return this._client.get(u`/v1/organizations/plugin_marketplaces/${i}`,{query:s,...r,headers:d([{"anthropic-beta":[...n??[],"ce-plugins-2026-09-01"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugin_marketplaces.retrieve",r,{route:"/v1/organizations/plugin_marketplaces/{marketplace_id}",queryParams:["organization_id"],attributes:{"anthropic.organization.plugin_marketplace.id":i}})})}update(i,e,r){let{betas:n,...s}=e;return this._client.post(u`/v1/organizations/plugin_marketplaces/${i}`,{body:s,...r,headers:d([{"anthropic-beta":[...n??[],"ce-plugins-2026-09-01"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugin_marketplaces.update",r,{route:"/v1/organizations/plugin_marketplaces/{marketplace_id}",attributes:{"anthropic.organization.plugin_marketplace.id":i}})})}list(i={},e){let{betas:r,...n}=i??{};return this._client.getAPIList("/v1/organizations/plugin_marketplaces",v,{query:n,...e,headers:d([{"anthropic-beta":[...r??[],"ce-plugins-2026-09-01"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugin_marketplaces.list",e,{route:"/v1/organizations/plugin_marketplaces",queryParams:["limit","organization_id","owner_type","page","source"]})})}validateArchive(i,e){let{betas:r,...n}=i;return this._client.post("/v1/organizations/plugin_marketplaces/validate_archive",ne({body:n,...e,headers:d([{"anthropic-beta":[...r??[],"ce-plugins-2026-09-01"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugin_marketplaces.validate_archive",e,{route:"/v1/organizations/plugin_marketplaces/validate_archive"})},this._client))}validateRepository(i,e){let{betas:r,...n}=i;return this._client.post("/v1/organizations/plugin_marketplaces/validate_repository",{body:n,...e,headers:d([{"anthropic-beta":[...r??[],"ce-plugins-2026-09-01"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.plugin_marketplaces.validate_repository",e,{route:"/v1/organizations/plugin_marketplaces/validate_repository"})})}};var yi=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/rate_limits",v,{query:i,...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.rate_limits.list",e,{route:"/v1/organizations/rate_limits",queryParams:["group_type","limit","model","page"]})})}};var vi=class extends f{create(i,e){let{betas:r,...n}=i;return this._client.post("/v1/organizations/webhooks",{body:n,...e,headers:d([{"anthropic-beta":[...r??[],"webhooks-2026-10-07"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.webhooks.create",e,{route:"/v1/organizations/webhooks",createdIDAttribute:"anthropic.organization.webhook.id"})})}retrieve(i,e={},r){let{betas:n}=e??{};return this._client.get(u`/v1/organizations/webhooks/${i}`,{...r,headers:d([{"anthropic-beta":[...n??[],"webhooks-2026-10-07"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.webhooks.retrieve",r,{route:"/v1/organizations/webhooks/{webhook_endpoint_id}",attributes:{"anthropic.organization.webhook.id":i}})})}update(i,e,r){let{betas:n,...s}=e;return this._client.post(u`/v1/organizations/webhooks/${i}`,{body:s,...r,headers:d([{"anthropic-beta":[...n??[],"webhooks-2026-10-07"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.webhooks.update",r,{route:"/v1/organizations/webhooks/{webhook_endpoint_id}",attributes:{"anthropic.organization.webhook.id":i}})})}list(i={},e){let{betas:r,...n}=i??{};return this._client.getAPIList("/v1/organizations/webhooks",F,{query:n,...e,headers:d([{"anthropic-beta":[...r??[],"webhooks-2026-10-07"].toString()},e?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.webhooks.list",e,{route:"/v1/organizations/webhooks",queryParams:["after_id","before_id","limit","order"]})})}delete(i,e={},r){let{betas:n}=e??{};return this._client.delete(u`/v1/organizations/webhooks/${i}`,{...r,headers:d([{"anthropic-beta":[...n??[],"webhooks-2026-10-07"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.webhooks.delete",r,{route:"/v1/organizations/webhooks/{webhook_endpoint_id}",attributes:{"anthropic.organization.webhook.id":i}})})}regenerateSigningSecret(i,e={},r){let{betas:n}=e??{};return this._client.post(u`/v1/organizations/webhooks/${i}/regenerate_signing_secret`,{...r,headers:d([{"anthropic-beta":[...n??[],"webhooks-2026-10-07"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.webhooks.regenerate_signing_secret",r,{route:"/v1/organizations/webhooks/{webhook_endpoint_id}/regenerate_signing_secret",attributes:{"anthropic.organization.webhook.id":i}})})}};var wi=class extends f{list(i,e={},r){return this._client.getAPIList(u`/v1/organizations/rbac_roles/${i}/permissions`,v,{query:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.rbac_roles.permissions.list",r,{route:"/v1/organizations/rbac_roles/{rbac_role_id}/permissions",queryParams:["limit","page"],attributes:{"anthropic.organization.rbac_role.id":i}})})}};var tl=(()=>{class t extends f{constructor(){super(...arguments),this.permissions=new wi(this._client)}retrieve(e,r){return this._client.get(u`/v1/organizations/rbac_roles/${e}`,{...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.rbac_roles.retrieve",r,{route:"/v1/organizations/rbac_roles/{rbac_role_id}",attributes:{"anthropic.organization.rbac_role.id":e}})})}list(e={},r){return this._client.getAPIList("/v1/organizations/rbac_roles",v,{query:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.rbac_roles.list",r,{route:"/v1/organizations/rbac_roles",queryParams:["limit","page"]})})}}return t.Permissions=wi,t})();var Ei=class extends f{list(i,e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList(u`/v1/organizations/service_accounts/${i}/workspaces`,v,{query:s,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.service_accounts.workspaces.list",r,{route:"/v1/organizations/service_accounts/{service_account_id}/workspaces",queryParams:["limit","page"],attributes:{"anthropic.organization.service_account.id":i}})})}add(i,e,r){let{betas:n,...s}=e;return this._client.post(u`/v1/organizations/service_accounts/${i}/workspaces`,{body:s,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.service_accounts.workspaces.add",r,{route:"/v1/organizations/service_accounts/{service_account_id}/workspaces",attributes:{"anthropic.organization.service_account.id":i},createdIDAttribute:"anthropic.organization.service_account.workspace.id",createdIDField:"workspace_id"})})}remove(i,e,r){let{service_account_id:n,betas:s}=e;return this._client.delete(u`/v1/organizations/service_accounts/${n}/workspaces/${i}`,{...r,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.service_accounts.workspaces.remove",r,{route:"/v1/organizations/service_accounts/{service_account_id}/workspaces/{workspace_id}",attributes:{"anthropic.organization.service_account.id":n,"anthropic.organization.service_account.workspace.id":i}})})}};var rl=(()=>{class t extends f{constructor(){super(...arguments),this.workspaces=new Ei(this._client)}create(e,r){let{betas:n,...s}=e;return this._client.post("/v1/organizations/service_accounts",{body:s,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.service_accounts.create",r,{route:"/v1/organizations/service_accounts",createdIDAttribute:"anthropic.organization.service_account.id"})})}retrieve(e,r={},n){let{betas:s}=r??{};return this._client.get(u`/v1/organizations/service_accounts/${e}`,{...n,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.service_accounts.retrieve",n,{route:"/v1/organizations/service_accounts/{service_account_id}",attributes:{"anthropic.organization.service_account.id":e}})})}update(e,r,n){let{betas:s,...o}=r;return this._client.post(u`/v1/organizations/service_accounts/${e}`,{body:o,...n,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.service_accounts.update",n,{route:"/v1/organizations/service_accounts/{service_account_id}",attributes:{"anthropic.organization.service_account.id":e}})})}list(e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList("/v1/organizations/service_accounts",v,{query:s,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.service_accounts.list",r,{route:"/v1/organizations/service_accounts",queryParams:["include_archived","limit","page"]})})}archive(e,r={},n){let{betas:s}=r??{};return this._client.post(u`/v1/organizations/service_accounts/${e}/archive`,{...n,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.service_accounts.archive",n,{route:"/v1/organizations/service_accounts/{service_account_id}/archive",attributes:{"anthropic.organization.service_account.id":e}})})}}return t.Workspaces=Ei,t})();var ki=class extends f{list(i,e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList(u`/v1/organizations/telemetry_destinations/${i}/workspaces`,v,{query:s,...r,headers:d([{"anthropic-beta":[...n??[],"telemetry-destinations-2026-08-11"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.telemetry_destinations.workspaces.list",r,{route:"/v1/organizations/telemetry_destinations/{destination_id}/workspaces",queryParams:["limit","page"],attributes:{"anthropic.organization.telemetry_destination.id":i}})})}add(i,e,r){let{destination_id:n,betas:s}=e;return this._client.post(u`/v1/organizations/telemetry_destinations/${n}/workspaces/${i}`,{...r,headers:d([{"anthropic-beta":[...s??[],"telemetry-destinations-2026-08-11"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.telemetry_destinations.workspaces.add",r,{route:"/v1/organizations/telemetry_destinations/{destination_id}/workspaces/{workspace_id}",attributes:{"anthropic.organization.telemetry_destination.id":n,"anthropic.organization.telemetry_destination.workspace.id":i}})})}remove(i,e,r){let{destination_id:n,betas:s}=e;return this._client.delete(u`/v1/organizations/telemetry_destinations/${n}/workspaces/${i}`,{...r,headers:d([{"anthropic-beta":[...s??[],"telemetry-destinations-2026-08-11"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.telemetry_destinations.workspaces.remove",r,{route:"/v1/organizations/telemetry_destinations/{destination_id}/workspaces/{workspace_id}",attributes:{"anthropic.organization.telemetry_destination.id":n,"anthropic.organization.telemetry_destination.workspace.id":i}})})}};var il=(()=>{class t extends f{constructor(){super(...arguments),this.workspaces=new ki(this._client)}create(e,r){let{betas:n,...s}=e;return this._client.post("/v1/organizations/telemetry_destinations",{body:s,...r,headers:d([{"anthropic-beta":[...n??[],"telemetry-destinations-2026-08-11"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.telemetry_destinations.create",r,{route:"/v1/organizations/telemetry_destinations",createdIDAttribute:"anthropic.organization.telemetry_destination.id"})})}retrieve(e,r={},n){let{betas:s}=r??{};return this._client.get(u`/v1/organizations/telemetry_destinations/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"telemetry-destinations-2026-08-11"].toString()},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.telemetry_destinations.retrieve",n,{route:"/v1/organizations/telemetry_destinations/{destination_id}",attributes:{"anthropic.organization.telemetry_destination.id":e}})})}update(e,r,n){let{betas:s,...o}=r;return this._client.post(u`/v1/organizations/telemetry_destinations/${e}`,{body:o,...n,headers:d([{"anthropic-beta":[...s??[],"telemetry-destinations-2026-08-11"].toString()},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.telemetry_destinations.update",n,{route:"/v1/organizations/telemetry_destinations/{destination_id}",attributes:{"anthropic.organization.telemetry_destination.id":e}})})}list(e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList("/v1/organizations/telemetry_destinations",v,{query:s,...r,headers:d([{"anthropic-beta":[...n??[],"telemetry-destinations-2026-08-11"].toString()},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.telemetry_destinations.list",r,{route:"/v1/organizations/telemetry_destinations",queryParams:["limit","page","workspace_ids"]})})}delete(e,r={},n){let{betas:s}=r??{};return this._client.delete(u`/v1/organizations/telemetry_destinations/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"telemetry-destinations-2026-08-11"].toString()},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.telemetry_destinations.delete",n,{route:"/v1/organizations/telemetry_destinations/{destination_id}",attributes:{"anthropic.organization.telemetry_destination.id":e}})})}test(e,r={},n){let{betas:s}=r??{};return this._client.post(u`/v1/organizations/telemetry_destinations/${e}/test`,{...n,headers:d([{"anthropic-beta":[...s??[],"telemetry-destinations-2026-08-11"].toString()},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.telemetry_destinations.test",n,{route:"/v1/organizations/telemetry_destinations/{destination_id}/test",attributes:{"anthropic.organization.telemetry_destination.id":e}})})}}return t.Workspaces=ki,t})();var Si=class extends f{retrieve(i,e,r){let{workspace_id:n}=e;return this._client.get(u`/v1/organizations/workspaces/${n}/members/${i}`,{...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.members.retrieve",r,{route:"/v1/organizations/workspaces/{workspace_id}/members/{user_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.member.id":i}})})}update(i,e,r){let{workspace_id:n,...s}=e;return this._client.post(u`/v1/organizations/workspaces/${n}/members/${i}`,{body:s,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.members.update",r,{route:"/v1/organizations/workspaces/{workspace_id}/members/{user_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.member.id":i}})})}list(i,e={},r){return this._client.getAPIList(u`/v1/organizations/workspaces/${i}/members`,F,{query:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.members.list",r,{route:"/v1/organizations/workspaces/{workspace_id}/members",queryParams:["after_id","before_id","limit"],attributes:{"anthropic.organization.workspace.id":i}})})}add(i,e,r){return this._client.post(u`/v1/organizations/workspaces/${i}/members`,{body:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.members.add",r,{route:"/v1/organizations/workspaces/{workspace_id}/members",attributes:{"anthropic.organization.workspace.id":i},createdIDAttribute:"anthropic.organization.workspace.member.id",createdIDField:"user_id"})})}remove(i,e,r){let{workspace_id:n}=e;return this._client.delete(u`/v1/organizations/workspaces/${n}/members/${i}`,{...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.members.remove",r,{route:"/v1/organizations/workspaces/{workspace_id}/members/{user_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.member.id":i}})})}};var Ai=class extends f{update(i,e,r){let{workspace_id:n,...s}=e;return this._client.post(u`/v1/organizations/workspaces/${n}/rate_limits/${i}`,{body:s,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.rate_limits.update",r,{route:"/v1/organizations/workspaces/{workspace_id}/rate_limits/{rate_limit_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.rate_limit.id":i}})})}list(i,e={},r){return this._client.getAPIList(u`/v1/organizations/workspaces/${i}/rate_limits`,v,{query:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.rate_limits.list",r,{route:"/v1/organizations/workspaces/{workspace_id}/rate_limits",queryParams:["group_type","include_inherited","limit","page"],attributes:{"anthropic.organization.workspace.id":i}})})}};var xi=class extends f{retrieve(i,e,r){let{workspace_id:n,betas:s}=e;return this._client.get(u`/v1/organizations/workspaces/${n}/service_accounts/${i}`,{...r,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.service_accounts.retrieve",r,{route:"/v1/organizations/workspaces/{workspace_id}/service_accounts/{service_account_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.service_account.id":i}})})}update(i,e,r){let{workspace_id:n,betas:s,...o}=e;return this._client.post(u`/v1/organizations/workspaces/${n}/service_accounts/${i}`,{body:o,...r,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.service_accounts.update",r,{route:"/v1/organizations/workspaces/{workspace_id}/service_accounts/{service_account_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.service_account.id":i}})})}list(i,e={},r){let{betas:n,...s}=e??{};return this._client.getAPIList(u`/v1/organizations/workspaces/${i}/service_accounts`,v,{query:s,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.service_accounts.list",r,{route:"/v1/organizations/workspaces/{workspace_id}/service_accounts",queryParams:["limit","page"],attributes:{"anthropic.organization.workspace.id":i}})})}add(i,e,r){let{betas:n,...s}=e;return this._client.post(u`/v1/organizations/workspaces/${i}/service_accounts`,{body:s,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.service_accounts.add",r,{route:"/v1/organizations/workspaces/{workspace_id}/service_accounts",attributes:{"anthropic.organization.workspace.id":i},createdIDAttribute:"anthropic.organization.workspace.service_account.id",createdIDField:"service_account_id"})})}remove(i,e,r){let{workspace_id:n,betas:s}=e;return this._client.delete(u`/v1/organizations/workspaces/${n}/service_accounts/${i}`,{...r,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.service_accounts.remove",r,{route:"/v1/organizations/workspaces/{workspace_id}/service_accounts/{service_account_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.service_account.id":i}})})}};var nl=(()=>{class t extends f{constructor(){super(...arguments),this.rateLimits=new Ai(this._client),this.members=new Si(this._client),this.serviceAccounts=new xi(this._client)}create(e,r){let{betas:n,...s}=e;return this._client.post("/v1/organizations/workspaces",{body:s,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.create",r,{route:"/v1/organizations/workspaces",createdIDAttribute:"anthropic.organization.workspace.id"})})}retrieve(e,r){return this._client.get(u`/v1/organizations/workspaces/${e}`,{...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.retrieve",r,{route:"/v1/organizations/workspaces/{workspace_id}",attributes:{"anthropic.organization.workspace.id":e}})})}update(e,r,n){return this._client.post(u`/v1/organizations/workspaces/${e}`,{body:r,...n,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.update",n,{route:"/v1/organizations/workspaces/{workspace_id}",attributes:{"anthropic.organization.workspace.id":e}})})}list(e={},r){return this._client.getAPIList("/v1/organizations/workspaces",F,{query:e,...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.list",r,{route:"/v1/organizations/workspaces",queryParams:["after_id","before_id","ids","include_archived","include_default","limit"]})})}archive(e,r){return this._client.post(u`/v1/organizations/workspaces/${e}/archive`,{...r,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.workspaces.archive",r,{route:"/v1/organizations/workspaces/{workspace_id}/archive",attributes:{"anthropic.organization.workspace.id":e}})})}}return t.RateLimits=Ai,t.Members=Si,t.ServiceAccounts=xi,t})();var sl=(()=>{class t extends f{constructor(){super(...arguments),this.apiKeys=new Ur(this._client),this.externalKeys=new _i(this._client),this.federation=new el(this._client),this.invites=new gi(this._client),this.serviceAccounts=new rl(this._client),this.users=new Gc(this._client),this.workspaces=new nl(this._client),this.rateLimits=new yi(this._client),this.complianceSettings=new hi(this._client),this.analytics=new jc(this._client),this.spendLimits=new Yc(this._client),this.rbacGroups=new Vc(this._client),this.rbacRoles=new tl(this._client),this.plugins=new Jc(this._client),this.pluginMarketplaces=new bi(this._client),this.telemetryDestinations=new il(this._client),this.webhooks=new vi(this._client),this.claudeCode=new Xc(this._client),this.claudeTag=new Dc(this._client)}retrieve(e){return this._client.get("/v1/organizations/me",{...e,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.organization.retrieve",e,{route:"/v1/organizations/me"})})}}return t.APIKeys=Ur,t.ExternalKeys=_i,t.Federation=el,t.Invites=gi,t.ServiceAccounts=rl,t.Users=Gc,t.BetaCannotSignOutPrimaryOwnerError=Qs,t.BetaCannotSignOutSelfError=Xs,t.BetaCannotSignOutManagedMemberError=Zs,t.BetaCannotSignOutMembershipAdminError=eo,t.BetaCannotSignOutOwnerError=to,t.BetaCannotSignOutPrivilegedMemberError=ro,t.Workspaces=nl,t.RateLimits=yi,t.ComplianceSettings=hi,t.Analytics=jc,t.SpendLimits=Yc,t.BetaSpendLimitsAdminAPIWritesNotEnabledError=lo,t.RBACGroups=Vc,t.BetaRBACGroupNotFoundError=io,t.RBACRoles=tl,t.Plugins=Jc,t.BetaScanFailedError=no,t.BetaPluginNameTakenError=so,t.BetaScanPendingError=oo,t.BetaSkillNameTakenError=ao,t.BetaRegistrationPendingError=co,t.PluginMarketplaces=bi,t.TelemetryDestinations=il,t.Webhooks=vi,t.ClaudeCode=Xc,t.ClaudeTag=Dc,t.BetaBundleAttachmentNotSupportedError=Hs,t.BetaBundleOnCallError=Ws,t.BetaSlackChannelSetUpSettingsRefusedError=js,t.BetaAPIKeyScopeMissingError=Ks,t.BetaClaudeTagWritesNotEnabledError=Ds,t.BetaComplianceConfigurationRestrictedError=Gs,t.BetaOrganizationLevelScopedAPIKeyRequiredError=Vs,t.BetaSlackChannelSetUpEnvironmentNotFoundError=Js,t.BetaSlackChannelSetUpSettingsConflictError=Ys,t})();var ol=(()=>{class t extends f{list(e,r={},n){let{betas:s,workspace_id:o,...l}=r??{};return this._client.getAPIList(u`/v1/sessions/${e}/events`,v,{query:l,...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.events.list",n,{route:"/v1/sessions/{session_id}/events",queryParams:["created_at[gt]","created_at[gte]","created_at[lt]","created_at[lte]","limit","order","page","types"],attributes:{"anthropic.session.id":e}})})}send(e,r,n){let{betas:s,workspace_id:o,...l}=r;return this._client.post(u`/v1/sessions/${e}/events`,{body:l,...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.events.send",n,{route:"/v1/sessions/{session_id}/events",attributes:{"anthropic.session.id":e}})})}stream(e,r={},n){let{betas:s,workspace_id:o,...l}=r??{};return this._client.get(u`/v1/sessions/${e}/events/stream`,{query:l,...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),stream:!0,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.events.stream",n,{route:"/v1/sessions/{session_id}/events/stream",queryParams:["event_deltas"],attributes:{"anthropic.session.id":e}})})}toolRunner(e,r){return new ws(e,{...r,client:this._client})}}return t.SessionToolRunner=ws,t})();var Pi=class extends f{retrieve(i,e,r){let{session_id:n,betas:s,workspace_id:o}=e;return this._client.get(u`/v1/sessions/${n}/resources/${i}`,{...r,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.resources.retrieve",r,{route:"/v1/sessions/{session_id}/resources/{resource_id}",attributes:{"anthropic.session.id":n,"anthropic.session.resource.id":i}})})}update(i,e,r){let{session_id:n,betas:s,workspace_id:o,...l}=e;return this._client.post(u`/v1/sessions/${n}/resources/${i}`,{body:l,...r,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.resources.update",r,{route:"/v1/sessions/{session_id}/resources/{resource_id}",attributes:{"anthropic.session.id":n,"anthropic.session.resource.id":i}})})}list(i,e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList(u`/v1/sessions/${i}/resources`,v,{query:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.resources.list",r,{route:"/v1/sessions/{session_id}/resources",queryParams:["limit","page"],attributes:{"anthropic.session.id":i}})})}delete(i,e,r){let{session_id:n,betas:s,workspace_id:o}=e;return this._client.delete(u`/v1/sessions/${n}/resources/${i}`,{...r,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.resources.delete",r,{route:"/v1/sessions/{session_id}/resources/{resource_id}",attributes:{"anthropic.session.id":n,"anthropic.session.resource.id":i}})})}add(i,e,r){let{betas:n,workspace_id:s,...o}=e;return this._client.post(u`/v1/sessions/${i}/resources`,{body:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.resources.add",r,{route:"/v1/sessions/{session_id}/resources",attributes:{"anthropic.session.id":i},createdIDAttribute:"anthropic.session.resource.id"})})}};var Ti=class extends f{list(i,e,r){let{session_id:n,betas:s,workspace_id:o,...l}=e;return this._client.getAPIList(u`/v1/sessions/${n}/threads/${i}/events`,v,{query:l,...r,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.threads.events.list",r,{route:"/v1/sessions/{session_id}/threads/{thread_id}/events",queryParams:["limit","page"],attributes:{"anthropic.session.id":n,"anthropic.session.thread.id":i}})})}stream(i,e,r){let{session_id:n,betas:s,workspace_id:o,...l}=e;return this._client.get(u`/v1/sessions/${n}/threads/${i}/stream`,{query:l,...r,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),stream:!0,__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.threads.events.stream",r,{route:"/v1/sessions/{session_id}/threads/{thread_id}/stream",queryParams:["event_deltas"],attributes:{"anthropic.session.id":n,"anthropic.session.thread.id":i}})})}};var al=(()=>{class t extends f{constructor(){super(...arguments),this.events=new Ti(this._client)}retrieve(e,r,n){let{session_id:s,betas:o,workspace_id:l}=r;return this._client.get(u`/v1/sessions/${s}/threads/${e}`,{...n,headers:d([{"anthropic-beta":[...o??[],"managed-agents-2026-04-01"].toString(),...l!=null?{"anthropic-workspace-id":l}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.threads.retrieve",n,{route:"/v1/sessions/{session_id}/threads/{thread_id}",attributes:{"anthropic.session.id":s,"anthropic.session.thread.id":e}})})}list(e,r={},n){let{betas:s,workspace_id:o,...l}=r??{};return this._client.getAPIList(u`/v1/sessions/${e}/threads`,v,{query:l,...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.threads.list",n,{route:"/v1/sessions/{session_id}/threads",queryParams:["limit","page","statuses"],attributes:{"anthropic.session.id":e}})})}archive(e,r,n){let{session_id:s,betas:o,workspace_id:l}=r;return this._client.post(u`/v1/sessions/${s}/threads/${e}/archive`,{...n,headers:d([{"anthropic-beta":[...o??[],"managed-agents-2026-04-01"].toString(),...l!=null?{"anthropic-workspace-id":l}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.threads.archive",n,{route:"/v1/sessions/{session_id}/threads/{thread_id}/archive",attributes:{"anthropic.session.id":s,"anthropic.session.thread.id":e}})})}}return t.Events=Ti,t})();var cl=(()=>{class t extends f{constructor(){super(...arguments),this.events=new ol(this._client),this.resources=new Pi(this._client),this.threads=new al(this._client)}create(e,r){let{betas:n,workspace_id:s,...o}=e,l={body:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"}};return this._client.post("/v1/sessions",{...l,__span:c(this._client,"anthropic.sessions.create",r,{route:"/v1/sessions",attributes:Lu(o),createdIDAttribute:"anthropic.session.id",request:l})})}retrieve(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.get(u`/v1/sessions/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.retrieve",n,{route:"/v1/sessions/{session_id}",attributes:{"anthropic.session.id":e}})})}update(e,r,n){let{betas:s,workspace_id:o,...l}=r;return this._client.post(u`/v1/sessions/${e}`,{body:l,...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.update",n,{route:"/v1/sessions/{session_id}",attributes:{"anthropic.session.id":e}})})}list(e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList("/v1/sessions",Oa,{query:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.list",r,{route:"/v1/sessions",queryParams:["agent_id","agent_version","created_at[gt]","created_at[gte]","created_at[lt]","created_at[lte]","deployment_id","include_archived","limit","memory_store_id","order","page","statuses"]})})}delete(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.delete(u`/v1/sessions/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.delete",n,{route:"/v1/sessions/{session_id}",attributes:{"anthropic.session.id":e}})})}archive(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.post(u`/v1/sessions/${e}/archive`,{...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.sessions.archive",n,{route:"/v1/sessions/{session_id}/archive",attributes:{"anthropic.session.id":e}})})}}return t.Events=ol,t.Resources=Pi,t.Threads=al,t})();var Ri=class extends f{create(i,e,r){let{betas:n,workspace_id:s,...o}=e;return this._client.post(u`/v1/skills/${i}/versions`,ne({body:o,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0,...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.skills.versions.create",r,{route:"/v1/skills/{skill_id}/versions",attributes:{"anthropic.skill.id":i},createdIDAttribute:"anthropic.skill.version.id"})},this._client,!1))}retrieve(i,e,r){let{skill_id:n,betas:s,workspace_id:o}=e;return this._client.get(u`/v1/skills/${n}/versions/${i}`,{...r,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0,...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.skills.versions.retrieve",r,{route:"/v1/skills/{skill_id}/versions/{version}",attributes:{"anthropic.skill.id":n,"anthropic.skill.version.id":i}})})}list(i,e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList(u`/v1/skills/${i}/versions`,v,{query:o,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0,...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.skills.versions.list",r,{route:"/v1/skills/{skill_id}/versions",queryParams:["limit","page"],attributes:{"anthropic.skill.id":i}})})}delete(i,e,r){let{skill_id:n,betas:s,workspace_id:o}=e;return this._client.delete(u`/v1/skills/${n}/versions/${i}`,{...r,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0,...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.skills.versions.delete",r,{route:"/v1/skills/{skill_id}/versions/{version}",attributes:{"anthropic.skill.id":n,"anthropic.skill.version.id":i}})})}download(i,e,r){let{skill_id:n,betas:s,workspace_id:o}=e;return this._client.get(u`/v1/skills/${n}/versions/${i}/content`,{...r,headers:d([{Accept:"application/binary",...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0,...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__binaryResponse:!0,__span:c(this._client,"anthropic.skills.versions.download",r,{route:"/v1/skills/{skill_id}/versions/{version}/content",attributes:{"anthropic.skill.id":n,"anthropic.skill.version.id":i}})})}};var ll=(()=>{class t extends f{constructor(){super(...arguments),this.versions=new Ri(this._client)}create(e,r){let{betas:n,workspace_id:s,...o}=e;return this._client.post("/v1/skills",ne({body:o,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0,...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.skills.create",r,{route:"/v1/skills",createdIDAttribute:"anthropic.skill.id"})},this._client,!1))}retrieve(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.get(u`/v1/skills/${e}`,{...n,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0,...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.skills.retrieve",n,{route:"/v1/skills/{skill_id}",attributes:{"anthropic.skill.id":e}})})}list(e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList("/v1/skills",v,{query:o,...r,headers:d([{...n?.toString()!=null?{"anthropic-beta":n?.toString()}:void 0,...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.skills.list",r,{route:"/v1/skills",queryParams:["limit","page","source"]})})}delete(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.delete(u`/v1/skills/${e}`,{...n,headers:d([{...s?.toString()!=null?{"anthropic-beta":s?.toString()}:void 0,...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.skills.delete",n,{route:"/v1/skills/{skill_id}",attributes:{"anthropic.skill.id":e}})})}}return t.Versions=Ri,t})();var Ci=class extends f{create(i,e,r){let{betas:n,workspace_id:s,...o}=e;return this._client.post(u`/v1/tunnels/${i}/certificates`,{body:o,...r,headers:d([{"anthropic-beta":[...n??[],"mcp-tunnels-2026-06-22"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.tunnels.certificates.create",r,{route:"/v1/tunnels/{tunnel_id}/certificates",attributes:{"anthropic.tunnel.id":i},createdIDAttribute:"anthropic.tunnel.certificate.id"})})}retrieve(i,e,r){let{tunnel_id:n,betas:s,workspace_id:o}=e;return this._client.get(u`/v1/tunnels/${n}/certificates/${i}`,{...r,headers:d([{"anthropic-beta":[...s??[],"mcp-tunnels-2026-06-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.tunnels.certificates.retrieve",r,{route:"/v1/tunnels/{tunnel_id}/certificates/{certificate_id}",attributes:{"anthropic.tunnel.id":n,"anthropic.tunnel.certificate.id":i}})})}list(i,e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList(u`/v1/tunnels/${i}/certificates`,v,{query:o,...r,headers:d([{"anthropic-beta":[...n??[],"mcp-tunnels-2026-06-22"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.tunnels.certificates.list",r,{route:"/v1/tunnels/{tunnel_id}/certificates",queryParams:["include_archived","limit","page"],attributes:{"anthropic.tunnel.id":i}})})}archive(i,e,r){let{tunnel_id:n,betas:s,workspace_id:o}=e;return this._client.post(u`/v1/tunnels/${n}/certificates/${i}/archive`,{...r,headers:d([{"anthropic-beta":[...s??[],"mcp-tunnels-2026-06-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.tunnels.certificates.archive",r,{route:"/v1/tunnels/{tunnel_id}/certificates/{certificate_id}/archive",attributes:{"anthropic.tunnel.id":n,"anthropic.tunnel.certificate.id":i}})})}};var ul=(()=>{class t extends f{constructor(){super(...arguments),this.certificates=new Ci(this._client)}create(e,r){let{betas:n,workspace_id:s,...o}=e;return this._client.post("/v1/tunnels",{body:o,...r,headers:d([{"anthropic-beta":[...n??[],"mcp-tunnels-2026-06-22"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.tunnels.create",r,{route:"/v1/tunnels",createdIDAttribute:"anthropic.tunnel.id"})})}retrieve(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.get(u`/v1/tunnels/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"mcp-tunnels-2026-06-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.tunnels.retrieve",n,{route:"/v1/tunnels/{tunnel_id}",attributes:{"anthropic.tunnel.id":e}})})}list(e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList("/v1/tunnels",v,{query:o,...r,headers:d([{"anthropic-beta":[...n??[],"mcp-tunnels-2026-06-22"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.tunnels.list",r,{route:"/v1/tunnels",queryParams:["include_archived","limit","page"]})})}archive(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.post(u`/v1/tunnels/${e}/archive`,{...n,headers:d([{"anthropic-beta":[...s??[],"mcp-tunnels-2026-06-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.tunnels.archive",n,{route:"/v1/tunnels/{tunnel_id}/archive",attributes:{"anthropic.tunnel.id":e}})})}revealToken(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.post(u`/v1/tunnels/${e}/reveal_token`,{...n,headers:d([{"anthropic-beta":[...s??[],"mcp-tunnels-2026-06-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.tunnels.reveal_token",n,{route:"/v1/tunnels/{tunnel_id}/reveal_token",attributes:{"anthropic.tunnel.id":e}})})}rotateToken(e,r,n){let{betas:s,workspace_id:o,...l}=r;return this._client.post(u`/v1/tunnels/${e}/rotate_token`,{body:l,...n,headers:d([{"anthropic-beta":[...s??[],"mcp-tunnels-2026-06-22"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.tunnels.rotate_token",n,{route:"/v1/tunnels/{tunnel_id}/rotate_token",attributes:{"anthropic.tunnel.id":e}})})}}return t.Certificates=Ci,t})();var Ii=class extends f{create(i,e,r){let{betas:n,workspace_id:s,...o}=e;return this._client.post(u`/v1/user_profiles/${i}/action_urls`,{body:o,...r,headers:d([{"anthropic-beta":[...n??[],"user-profiles-2026-08-18"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.user_profiles.action_urls.create",r,{route:"/v1/user_profiles/{user_profile_id}/action_urls",attributes:{"anthropic.user_profile.id":i}})})}};var dl=(()=>{class t extends f{constructor(){super(...arguments),this.actionURLs=new Ii(this._client)}create(e,r){let{betas:n,workspace_id:s,...o}=e;return this._client.post("/v1/user_profiles",{body:o,...r,headers:d([{"anthropic-beta":[...n??[],"user-profiles-2026-08-18"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.user_profiles.create",r,{route:"/v1/user_profiles",createdIDAttribute:"anthropic.user_profile.id"})})}retrieve(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.get(u`/v1/user_profiles/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"user-profiles-2026-08-18"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.user_profiles.retrieve",n,{route:"/v1/user_profiles/{user_profile_id}",attributes:{"anthropic.user_profile.id":e}})})}update(e,r,n){let{betas:s,workspace_id:o,...l}=r;return this._client.post(u`/v1/user_profiles/${e}`,{body:l,...n,headers:d([{"anthropic-beta":[...s??[],"user-profiles-2026-08-18"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.user_profiles.update",n,{route:"/v1/user_profiles/{user_profile_id}",attributes:{"anthropic.user_profile.id":e}})})}list(e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList("/v1/user_profiles",v,{query:o,...r,headers:d([{"anthropic-beta":[...n??[],"user-profiles-2026-08-18"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.user_profiles.list",r,{route:"/v1/user_profiles",queryParams:["limit","order","order_by","page"]})})}delete(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.delete(u`/v1/user_profiles/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"user-profiles-2026-08-18"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.user_profiles.delete",n,{route:"/v1/user_profiles/{user_profile_id}",attributes:{"anthropic.user_profile.id":e}})})}createEnrollmentURL(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.post(u`/v1/user_profiles/${e}/enrollment_url`,{...n,headers:d([{"anthropic-beta":[...s??[],"user-profiles-2026-08-18"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.user_profiles.create_enrollment_url",n,{route:"/v1/user_profiles/{user_profile_id}/enrollment_url",attributes:{"anthropic.user_profile.id":e}})})}}return t.ActionURLs=Ii,t})();var zi=class extends f{create(i,e,r){let{betas:n,workspace_id:s,...o}=e;return this._client.post(u`/v1/vaults/${i}/credentials`,{body:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.vaults.credentials.create",r,{route:"/v1/vaults/{vault_id}/credentials",attributes:{"anthropic.vault.id":i},createdIDAttribute:"anthropic.vault.credential.id"})})}retrieve(i,e,r){let{vault_id:n,betas:s,workspace_id:o}=e;return this._client.get(u`/v1/vaults/${n}/credentials/${i}`,{...r,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.vaults.credentials.retrieve",r,{route:"/v1/vaults/{vault_id}/credentials/{credential_id}",attributes:{"anthropic.vault.id":n,"anthropic.vault.credential.id":i}})})}update(i,e,r){let{vault_id:n,betas:s,workspace_id:o,...l}=e;return this._client.post(u`/v1/vaults/${n}/credentials/${i}`,{body:l,...r,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.vaults.credentials.update",r,{route:"/v1/vaults/{vault_id}/credentials/{credential_id}",attributes:{"anthropic.vault.id":n,"anthropic.vault.credential.id":i}})})}list(i,e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList(u`/v1/vaults/${i}/credentials`,v,{query:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.vaults.credentials.list",r,{route:"/v1/vaults/{vault_id}/credentials",queryParams:["include_archived","limit","page"],attributes:{"anthropic.vault.id":i}})})}delete(i,e,r){let{vault_id:n,betas:s,workspace_id:o}=e;return this._client.delete(u`/v1/vaults/${n}/credentials/${i}`,{...r,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.vaults.credentials.delete",r,{route:"/v1/vaults/{vault_id}/credentials/{credential_id}",attributes:{"anthropic.vault.id":n,"anthropic.vault.credential.id":i}})})}archive(i,e,r){let{vault_id:n,betas:s,workspace_id:o}=e;return this._client.post(u`/v1/vaults/${n}/credentials/${i}/archive`,{...r,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.vaults.credentials.archive",r,{route:"/v1/vaults/{vault_id}/credentials/{credential_id}/archive",attributes:{"anthropic.vault.id":n,"anthropic.vault.credential.id":i}})})}mcpOAuthValidate(i,e,r){let{vault_id:n,betas:s,workspace_id:o}=e;return this._client.post(u`/v1/vaults/${n}/credentials/${i}/mcp_oauth_validate`,{...r,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.vaults.credentials.mcp_oauth_validate",r,{route:"/v1/vaults/{vault_id}/credentials/{credential_id}/mcp_oauth_validate",attributes:{"anthropic.vault.id":n,"anthropic.vault.credential.id":i}})})}};var pl=(()=>{class t extends f{constructor(){super(...arguments),this.credentials=new zi(this._client)}create(e,r){let{betas:n,workspace_id:s,...o}=e;return this._client.post("/v1/vaults",{body:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.vaults.create",r,{route:"/v1/vaults",createdIDAttribute:"anthropic.vault.id"})})}retrieve(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.get(u`/v1/vaults/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.vaults.retrieve",n,{route:"/v1/vaults/{vault_id}",attributes:{"anthropic.vault.id":e}})})}update(e,r,n){let{betas:s,workspace_id:o,...l}=r;return this._client.post(u`/v1/vaults/${e}`,{body:l,...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.vaults.update",n,{route:"/v1/vaults/{vault_id}",attributes:{"anthropic.vault.id":e}})})}list(e={},r){let{betas:n,workspace_id:s,...o}=e??{};return this._client.getAPIList("/v1/vaults",v,{query:o,...r,headers:d([{"anthropic-beta":[...n??[],"managed-agents-2026-04-01"].toString(),...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.vaults.list",r,{route:"/v1/vaults",queryParams:["include_archived","limit","page"]})})}delete(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.delete(u`/v1/vaults/${e}`,{...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.vaults.delete",n,{route:"/v1/vaults/{vault_id}",attributes:{"anthropic.vault.id":e}})})}archive(e,r={},n){let{betas:s,workspace_id:o}=r??{};return this._client.post(u`/v1/vaults/${e}/archive`,{...n,headers:d([{"anthropic-beta":[...s??[],"managed-agents-2026-04-01"].toString(),...o!=null?{"anthropic-workspace-id":o}:void 0},n?.headers]),__qualifiers:{beta:"true"},__span:c(this._client,"anthropic.vaults.archive",n,{route:"/v1/vaults/{vault_id}/archive",attributes:{"anthropic.vault.id":e}})})}}return t.Credentials=zi,t})();var at,hl,Kt,Ni,_l,Dt,Oi,fl,B_,ml,gl,fd=(()=>{class t extends qr{constructor(e,r,n){super(e,{client:n}),at.add(this),hl.set(this,void 0),Kt.set(this,0),Ni.set(this,[]),_l.set(this,[]),Dt.set(this,void 0),Oi.set(this,[]),fl.set(this,!1),b(this,hl,r,"f")}get toolCalls(){return a(this,_l,"f")}_deliverEvent(e,r){var n;b(this,Kt,(n=a(this,Kt,"f"),n++,n),"f");let s=e.type==="content_block_stop"?r?.content[e.index]:void 0,o=s?.type==="tool_use"?s:void 0;o&&a(this,_l,"f").push(o),super._deliverEvent(e,r),a(this,at,"m",B_).call(this,e,o),a(this,at,"m",ml).call(this)}[(hl=new WeakMap,Kt=new WeakMap,Ni=new WeakMap,_l=new WeakMap,Dt=new WeakMap,Oi=new WeakMap,fl=new WeakMap,at=new WeakSet,Symbol.asyncIterator)](){let e=super[Symbol.asyncIterator](),r={handled:a(this,Kt,"f")};a(this,Ni,"f").push(r);let n=!1;return{next:async()=>{n&&(n=!1,r.handled++,a(this,at,"m",ml).call(this));try{let s=await e.next();return n=!s.done,s.done&&a(this,at,"m",gl).call(this,r),s}catch(s){throw a(this,at,"m",gl).call(this,r),s}},return:async()=>{let s=e.return?.();return a(this,at,"m",gl).call(this,r),await s??{value:void 0,done:!0}}}}}return B_=function(e,r){if(a(this,fl,"f"))return;if(e.type==="content_block_start"&&e.content_block.type==="fallback"){b(this,fl,!0,"f"),b(this,Dt,void 0,"f");return}let n=e.type==="content_block_start"||e.type==="message_delta"&&e.delta.stop_reason==="tool_use";a(this,Dt,"f")&&n&&(a(this,Oi,"f").push({toolUse:a(this,Dt,"f"),event:a(this,Kt,"f")}),b(this,Dt,void 0,"f")),r&&b(this,Dt,r,"f")},ml=function(){if(this.errored||this.controller.signal.aborted)return;let e=Math.min(a(this,Kt,"f"),...a(this,Ni,"f").map(r=>r.handled));for(;a(this,Oi,"f")[0]&&a(this,Oi,"f")[0].event<=e;)a(this,hl,"f").call(this,a(this,Oi,"f").shift().toolUse)},gl=function(e){let r=a(this,Ni,"f").indexOf(e);r>=0&&(a(this,Ni,"f").splice(r,1),a(this,at,"m",ml).call(this))},t})();function md(){let t,i;return{promise:new Promise((r,n)=>{t=r,i=n}),resolve:t,reject:i}}z();var oe,ce,ee,Y,K,V,Tt,q_,gd,mo,L_,bd,yd,$_,vd,F_,Ed=class{constructor(i,e,r){this.fields=i,this.ownMessages=e,this.ownCreateOnly=r,this.deferredMessages=[],this.replacementHistory=null,this.createOnly=H_(i)}},bl=(()=>{class t{constructor({params:e,options:r,threading:n,logger:s}){oe.add(this),ce.set(this,void 0),ee.set(this,[]),Y.set(this,[]),K.set(this,void 0),V.set(this,null),Tt.set(this,void 0);let{messages:o,unsupportedRequestBehavior:l,...p}=e;go(p),this.options=r,this.unsupportedRequestBehavior=l??"error",b(this,ce,p,"f"),b(this,K,n?{type:"create",replacesLostThread:!1}:{type:"never_threaded"},"f"),b(this,Tt,s,"f"),this.push(o??[])}get threading(){return a(this,K,"f").type==="create"||a(this,K,"f").type==="continue"}get previousMessageId(){return a(this,K,"f").type==="continue"?a(this,K,"f").previousMessageId:null}get messages(){let e=a(this,V,"f")?.replacementHistory?.slice()??[...a(this,ee,"f"),...a(this,Y,"f")].map(r=>r.param);return a(this,V,"f")&&e.push(...a(this,V,"f").deferredMessages.map(Mi)),e}get params(){let e=a(this,K,"f").type==="create"?a(this,V,"f")?.ownCreateOnly:void 0;return{...a(this,ce,"f"),...e,messages:this.messages}}push(e){if(a(this,V,"f")){a(this,V,"f").deferredMessages.push(...e);return}for(let r of e)a(this,oe,"m",gd).call(this,r)||a(this,Y,"f").push({param:Mi(r),reply:null})}update(e={},r={}){go(e),b(this,ce,{...a(this,ce,"f"),...Rt(e)},"f"),this.options={...this.options,...Rt(r)};for(let n of wd)e[n]!==void 0&&delete a(this,V,"f")?.ownCreateOnly[n]}fork(e=a(this,ce,"f")){let r=new t({params:{...e,unsupportedRequestBehavior:this.unsupportedRequestBehavior},options:this.options,threading:a(this,K,"f").type!=="never_threaded",logger:a(this,Tt,"f")});return this.threading||r.stopThreading(),a(this,V,"f")?.replacementHistory?b(r,Y,a(this,V,"f").replacementHistory.map(n=>({param:n,reply:null})),"f"):(b(r,ee,[...a(this,ee,"f")],"f"),b(r,Y,[...a(this,Y,"f")],"f")),a(this,V,"f")&&r.push(a(this,V,"f").deferredMessages),r}setParams({messages:e,...r}){b(this,ce,r,"f"),a(this,V,"f")&&(a(this,V,"f").ownCreateOnly={}),this.setMessages(e)}setMessages(e){let r=[...a(this,ee,"f"),...a(this,Y,"f")];if(a(this,V,"f")){let s=r.map(o=>o.param);U_(e,s)?(a(this,V,"f").replacementHistory=null,a(this,V,"f").deferredMessages=e.slice(s.length)):(a(this,V,"f").replacementHistory=e,a(this,V,"f").deferredMessages=[]);return}U_(e,a(this,ee,"f").map(s=>s.param))||(b(this,ee,[],"f"),this.threading&&b(this,K,{type:"create",replacesLostThread:!1},"f")),b(this,Y,[],"f");let n=new Map(r.filter(s=>s.reply).map(s=>[s.param.content,s]));for(let s of e.slice(a(this,ee,"f").length))a(this,oe,"m",gd).call(this,s)||a(this,Y,"f").push({...n.get(s.content)??{reply:null},param:Mi(s)})}get hasTurnToSend(){return a(this,Y,"f").length>0||Ad(a(this,ee,"f").at(-1)?.reply?.stop_reason)}startTurn(e,r){if(a(this,V,"f"))throw new E("Another `send()`, `parse()` or `stream()` is already in progress on this thread");go(r);let n=a(this,Y,"f").length;this.push(e);let s=a(this,Y,"f").slice(n);a(this,oe,"m",L_).call(this);let o={};return r.system!==void 0&&(o.system=r.system),r.tools!==void 0&&(o.tools=r.tools),b(this,V,new Ed({...a(this,ce,"f"),...Rt(r)},s,o),"f")}endTurn(e){b(this,V,null,"f"),b(this,Y,a(this,Y,"f").filter(r=>!e.ownMessages.includes(r)),"f"),e.replacementHistory&&this.setMessages(e.replacementHistory),this.push(e.deferredMessages)}recoversFrom(e){if(!(e instanceof $))return!1;let r=this.unsupportedRequestBehavior==="continue_unthreaded",n=Jy(e);if(n!==null&&a(this,K,"f").type==="continue")return n==="thread_not_found"&&a(this,K,"f").replacesLostThread&&r?(a(this,Tt,"f").info(`The server lost the thread again right after a replay; continuing without a thread: previous_message_id=${a(this,K,"f").previousMessageId}`),this.stopThreading()):a(this,oe,"m",mo).call(this,n),!0;let s=Qy(e);return s!==null&&this.threading&&r?(a(this,Tt,"f").info(`The server cannot thread this request; continuing without a thread: unsupported=${s.join(",")}`),this.stopThreading(),!0):!1}stopThreading(){this.threading&&b(this,K,{type:"unthreaded"},"f")}recordPartialReply(e,r){a(this,oe,"m",bd).call(this,e)||(a(this,oe,"m",yd).call(this,Xy(e,r),{partial:!0}),this.previousMessageId!==null&&a(this,oe,"m",mo).call(this,"stream_ended_before_message_stop"))}recordReply(e,r){a(this,oe,"m",bd).call(this,r)||(a(this,oe,"m",yd).call(this,r,{partial:!1}),a(this,K,"f").type==="create"&&b(this,ce,{...a(this,ce,"f"),...e.ownCreateOnly},"f"),this.threading&&(b(this,K,{type:"continue",previousMessageId:r.id,createdWith:e.createOnly,replacesLostThread:a(this,K,"f").type==="create"&&a(this,K,"f").replacesLostThread},"f"),r.usage.iterations?.some(n=>n.type==="fallback_message")&&a(this,oe,"m",mo).call(this,"fallback_message")),r.container&&a(this,oe,"m",$_).call(this,r.container.id))}buildCreateArguments(e,r,{stream:n}){a(this,oe,"m",vd).call(this,e.createOnly);let s=a(this,K,"f"),o=s.type==="continue"?[]:a(this,ee,"f").map(p=>p.param);if(s.type!=="never_threaded"){let p=a(this,ee,"f").map(_=>_.reply!==null).lastIndexOf(!0)+1;o=o.map((_,m)=>m<p?Sd(_):_)}let l={...e.fields,messages:[...o,...a(this,Y,"f").map(p=>p.param)]};if(this.threading&&!l.betas?.includes(kd)&&(l.betas=[...l.betas??[],kd]),s.type==="create")l.thread={type:"create"};else if(s.type==="continue"){l.thread={type:"continue",previous_message_id:s.previousMessageId};for(let p of wd)delete l[p]}return{params:l,options:a(this,oe,"m",F_).call(this,r,{stream:n})}}checkNextTurn(e){a(this,oe,"m",vd).call(this,H_({...a(this,ce,"f"),...Rt(e)}))}}return ce=new WeakMap,ee=new WeakMap,Y=new WeakMap,K=new WeakMap,V=new WeakMap,Tt=new WeakMap,oe=new WeakSet,q_=function(){for(let e of[a(this,Y,"f"),a(this,ee,"f")])for(let r=e.length-1;r>=0;r--)if(e[r].reply)return e[r].reply;return null},gd=function(e){if("id"in e)return e.id===a(this,oe,"a",q_)?.id;let r=a(this,Y,"f").at(-1)??a(this,ee,"f").at(-1);return r?.reply!=null&&bo(e,r.param)},mo=function(e){a(this,Tt,"f").info(`Replaying the full message history under a new thread: reason=${e} previous_message_id=${this.previousMessageId}`),b(this,K,{type:"create",replacesLostThread:e==="thread_not_found"},"f")},L_=function(){let e=a(this,ee,"f").at(-1);if(a(this,Y,"f").length||!e||e.reply&&!e.partial)return;e.reply&&a(this,ee,"f").pop();let r=a(this,ee,"f").length;for(;r>0&&!a(this,ee,"f")[r-1].reply;)r-=1;b(this,Y,a(this,ee,"f").splice(r),"f"),a(this,Tt,"f").info(`Re-sending the turn whose reply ended before \`message_stop\`: partial_reply_id=${e.reply?.id??null}`)},bd=function(e){return e.stop_reason!=="refusal"||a(this,K,"f").type==="never_threaded"?!1:(this.previousMessageId!==null&&a(this,oe,"m",mo).call(this,"refusal"),!0)},yd=function(e,{partial:r}){a(this,ee,"f").push(...a(this,Y,"f")),b(this,Y,[],"f"),e&&a(this,ee,"f").push({param:Mi(e),reply:e,partial:r})},$_=function(e){let{container:r}=a(this,ce,"f");r==null?b(this,ce,{...a(this,ce,"f"),container:e},"f"):typeof r=="object"&&r.id==null&&b(this,ce,{...a(this,ce,"f"),container:{...r,id:e}},"f")},vd=function(e){if(a(this,K,"f").type!=="continue")return;let{createdWith:r}=a(this,K,"f"),n=wd.filter(s=>e[s]!==r[s]);if(n.length){let s=n.map(o=>`\`${o}\``).join(" and ");throw new E(`Cannot change ${s} on a thread: the server keeps the \`system\` and \`tools\` the thread was created with. To change them, start a new thread from \`thread.params\`.`+(n.includes("tools")?" To add or remove tools on this thread, send `tool_addition` or `tool_removal` blocks in a `system` message.":""))}},F_=function(e,{stream:r}){let n={...this.options,...Rt(e)};return r&&(n.headers=d([{[ar]:"stream"},n.headers])),a(this,K,"f").type!=="never_threaded"&&(n.headers=d([n.headers,cr("message-thread")])),this.threading&&(n.headers=Vy(n.headers)),n},t})(),Gy=["pause_turn","compaction"];function Ad(t){return Gy.some(i=>i===t)}var kd="message-threads-2026-08-12",wd=["system","tools"];function H_(t){return{system:JSON.stringify(t.system),tools:JSON.stringify(t.tools)}}function Vy(t){let i=d([t]).values.get("anthropic-beta");return i===null?t:d([t,{"anthropic-beta":Eu(i,kd)}])}function Jy(t){let i=W_(t)?.error_code;return Yy.find(e=>e===i)??null}var Yy=["thread_not_found","thread_already_continued","thread_continue_in_flight"];function Qy(t){let i=W_(t);if(i?.error_code!=="thread_unsupported_request")return null;let e=i.unsupported;return Array.isArray(e)?e.map(String):[]}function W_(t){let e=t.error?.error?.details;return X(e)?e:null}function go(t){if("thread"in t&&t.thread!==void 0)throw new TypeError("`thread` cannot be set here. The message thread sets it for each request itself.")}function Rt(t){return Object.fromEntries(Object.entries(t).filter(([,i])=>i!==void 0))}function Xy(t,i){let e=t.content.slice(0,i),r=t.content[i];return r?.type==="text"&&r.text&&e.push(r),e.length?{...t,content:e}:null}function Sd(t){if(!X(t))return t;let{cache_control:i,...e}=t;for(let r of["content","source","tool","definition","tool_references"]){let n=e[r];Array.isArray(n)?e[r]=n.map(Sd):X(n)&&(e[r]=Sd(n))}return e}function U_(t,i){return i.length<=t.length&&i.every((e,r)=>bo(e,t[r]))}function bo(t,i){let[e,r]=[Mi(t),Mi(i)];return Object.keys({...e,...r}).every(s=>e[s]===r[s]||JSON.stringify(e[s])===JSON.stringify(r[s]))}function Mi(t){return"id"in t?{role:t.role,content:t.content}:t}function xd(t){return t===void 0?[]:Wn(t)?t:[t]}function yl(t){let{stream:i,max_iterations:e,runToolsEagerly:r,thread:n,...s}=t;if(n!==void 0&&n!==!1)throw new TypeError("`thread` cannot be set in the params of a tool runner. The runner sets it for each request itself. To run without a message thread, pass `thread: false`.");return{settings:{stream:i,max_iterations:e,runToolsEagerly:r},thread:n,threadParams:s}}var q,Bi,Gt,O,ct,_e,vl,Fe,be,lt,Ye,Ct,yo,ut,Re,Qe,qi,Li,Vt,vo,Pd,wl,j_,Td,Rd,K_,wo,El,D_,G_,Cd,kl,Sl,V_,Id,J_="a tool runner's toolsets come only from its tools param; change them with setMessagesParams(), or build a new runner",Zy="a tool runner's toolsets come only from its tools param; remove it there with setMessagesParams(), or build a new runner without it",ko=(()=>{class t{constructor(e,r,n){q.add(this),Bi.set(this,!1),Gt.set(this,!1),O.set(this,void 0),ct.set(this,void 0),_e.set(this,void 0),vl.set(this,void 0),Fe.set(this,void 0),be.set(this,void 0),lt.set(this,void 0),Ye.set(this,void 0),Ct.set(this,void 0),yo.set(this,0),ut.set(this,void 0),Re.set(this,{status:"idle"}),Qe.set(this,void 0),qi.set(this,null),Li.set(this,new Map),Vt.set(this,[]);let{thread:s,settings:o}="_state"in e?{thread:e,settings:r}:e.beta.messages._toolRunnerThread(r);Y_(s._state.params),Q_(o),b(this,O,s,"f"),b(this,ct,Rt(o),"f");let{tools:l,messages:p}=s._state.params,_=Wu(l,p);"_state"in e||s._state.setMessages(JSON.parse(JSON.stringify(X_(p)))),b(this,_e,{...n},"f"),b(this,vl,d([cr("BetaToolRunner"),_.length?{[Ft]:_.join(", ")}:void 0]),"f"),b(this,Ct,md(),"f")}async*[(Bi=new WeakMap,Gt=new WeakMap,O=new WeakMap,ct=new WeakMap,_e=new WeakMap,vl=new WeakMap,Fe=new WeakMap,be=new WeakMap,lt=new WeakMap,Ye=new WeakMap,Ct=new WeakMap,yo=new WeakMap,ut=new WeakMap,Re=new WeakMap,Qe=new WeakMap,qi=new WeakMap,Li=new WeakMap,Vt=new WeakMap,q=new WeakSet,vo=function(r){return a(this,ut,"f")?Z.with(a(this,ut,"f"),r):r()},Symbol.asyncIterator)](){var e;if(a(this,Bi,"f"))throw new E("Cannot iterate over a consumed stream");b(this,Bi,!0,"f"),b(this,Gt,!0,"f"),b(this,Ye,void 0,"f");let r=M(a(this,O,"f")._client,()=>ju(a(this,O,"f")._client,this.params,a(this,_e,"f").openTelemetry?.conversationId));b(this,ut,r&&Se.setSpan(Z.active(),r),"f");try{for(;;)try{if(a(this,ct,"f").max_iterations&&a(this,yo,"f")>=a(this,ct,"f").max_iterations)break;if(a(this,q,"m",V_).call(this),a(this,Re,"f").status==="scheduled"&&tf(a(this,qi,"f"))!=="resume"){yield*a(this,q,"m",Rd).call(this,a(this,Re,"f").config);continue}b(this,Gt,!1,"f"),b(this,Ye,void 0,"f"),b(this,yo,(e=a(this,yo,"f"),e++,e),"f"),b(this,be,void 0,"f"),yield*a(this,q,"m",Pd).call(this,a(this,O,"f"));let n=a(this,Fe,"f");if(b(this,Fe,void 0,"f"),await a(this,q,"m",vo).call(this,async()=>{let o;if(a(this,Gt,"f"))b(this,qi,null,"f"),a(this,lt,"f")?.abort(),a(this,O,"f")._state.checkNextTurn(Eo(a(this,O,"f"))),a(this,O,"f")._state.setMessages(n),o=n.at(-1);else{let p=await a(this,be,"f"),_=tf(p.stop_reason);if(b(this,qi,p.stop_reason,"f"),_==="stop")return"stop";if(_==="resume")return"continue";o=sv(a(this,O,"f").messages)}Z_(o)&&a(this,O,"f")._state.checkNextTurn(Eo(a(this,O,"f")));let l=await a(this,q,"m",Cd).call(this,o,a(this,_e,"f").signal,a(this,ut,"f"));if(l){let p=a(this,O,"f").messages,_=p.map(m=>m.role).lastIndexOf("assistant")+1;a(this,O,"f")._state.setMessages([...p.slice(0,_),l,...p.slice(_)])}else if(!a(this,Gt,"f")&&!a(this,O,"f")._state.hasTurnToSend)return"stop";return"continue"})==="stop"){yield*a(this,q,"m",G_).call(this);break}}finally{a(this,lt,"f")?.abort(),b(this,lt,void 0,"f")}if(await a(this,q,"m",Td).call(this),!a(this,be,"f"))throw new E("ToolRunner concluded without a message from the server");a(this,Ct,"f").resolve(await a(this,be,"f")),M(a(this,O,"f")._client,()=>r?.setStatus({code:ke.OK}))}catch(n){throw r&&M(a(this,O,"f")._client,()=>ze(r,n)),b(this,Bi,!1,"f"),b(this,Fe,void 0,"f"),a(this,Ct,"f").promise.catch(()=>{}),a(this,Ct,"f").reject(n),b(this,Ct,md(),"f"),n}finally{M(a(this,O,"f")._client,()=>r?.end()),b(this,ut,void 0,"f")}}setMessagesParams(e){let r=typeof e=="function"?e(this.params):e;if(Y_(r),a(this,Re,"f").status!=="idle"&&zd(r),a(this,Re,"f").status==="in_flight"&&!tv(r.messages,a(this,O,"f").messages))throw new E(ev);let{settings:n,threadParams:s}=yl(r);Q_(n),b(this,ct,Rt(n),"f"),a(this,Fe,"f")?(b(this,Fe,s.messages,"f"),a(this,O,"f")._state.setParams({...s,messages:a(this,O,"f").messages})):a(this,O,"f")._state.setParams(s),b(this,Gt,!0,"f"),b(this,Ye,void 0,"f")}setRequestOptions(e){typeof e=="function"?b(this,_e,e(a(this,_e,"f")),"f"):b(this,_e,{...a(this,_e,"f"),...e},"f")}async generateToolResponse(e=a(this,_e,"f").signal){let r=a(this,O,"f")._client._tracer?Z.active():void 0,n=await a(this,be,"f")??a(this,O,"f").messages.at(-1);return n?a(this,q,"m",Cd).call(this,n,e,r):null}deferToolCall(e){let r=typeof e=="string"?e:e.id;a(this,Qe,"f")&&!a(this,Qe,"f").has(r)&&a(this,Qe,"f").set(r,{status:"held"})}get deferredToolCalls(){let e=a(this,lt,"f"),r=a(this,Qe,"f");return!(e instanceof fd)||!r?[]:e.toolCalls.filter(n=>r.get(n.id)?.status==="held")}done(){return a(this,Ct,"f").promise}async runUntilDone(){if(!a(this,Bi,"f"))for await(let e of this);return this.done()}get params(){return{...a(this,O,"f")._state.params,...a(this,Fe,"f")&&{messages:[...a(this,Fe,"f")]},...a(this,ct,"f")}}pushMessages(...e){this.setMessagesParams(r=>({...r,messages:[...r.messages,...e]}))}compactBeforeNextTurn(e){a(this,Re,"f").status!=="in_flight"&&(zd(this.params),b(this,Re,{status:"scheduled",config:e??{type:"summarize"}},"f"))}addTools(...e){let r=a(this,q,"m",kl).call(this);for(let n of e){if(Lr(n))throw new $r(`addTools() can't add the '${st(Pt(n))}' toolset: ${J_}`);let s=ov(n);if(r.has(s))throw new $r(`addTools() can't replace the '${st(s)}' toolset: ${J_}`)}for(let n of e)"name"in n&&a(this,Li,"f").set(n.name,"run"in n?n:null),a(this,Vt,"f").push({type:"addition",tool:n})}removeTools(...e){let r=a(this,q,"m",kl).call(this);for(let n of e){let s=typeof n=="string"?n:n.name;if(r.has(s))throw new $r(`removeTools() can't remove the '${st(s)}' toolset: ${Zy}`)}for(let n of e){let s=typeof n=="string"?n:n.name;a(this,Li,"f").set(s,null),a(this,Vt,"f").push({type:"removal",name:s})}}then(e,r){return this.runUntilDone().then(e,r)}}return Pd=async function*(e){await a(this,q,"m",Td).call(this),b(this,Qe,void 0,"f");let r=e.messages;r.some(iv)&&a(this,q,"m",vo).call(this,()=>e._state.setMessages(X_(r)));let{tools:n}=e._state.params;a(this,ct,"f").stream?(b(this,lt,a(this,q,"m",vo).call(this,()=>a(this,ct,"f").runToolsEagerly?a(this,q,"m",j_).call(this,e):e.stream(void 0,Eo(e),a(this,q,"m",wl).call(this,e))),"f"),n&&e.update({tools:n}),e===a(this,O,"f")&&b(this,Fe,e.messages,"f"),b(this,be,a(this,lt,"f").finalMessage(),"f"),a(this,be,"f").catch(()=>{}),yield a(this,lt,"f")):(b(this,be,a(this,q,"m",vo).call(this,()=>e.send(void 0,Eo(e),a(this,q,"m",wl).call(this,e))),"f"),n&&e.update({tools:n}),e===a(this,O,"f")&&b(this,Fe,e.messages,"f"),yield a(this,be,"f"))},wl=function(e){let{headers:r=e._state.options.headers}=a(this,_e,"f");return{...a(this,_e,"f"),headers:d([a(this,vl,"f"),r])}},j_=function(e){let r=new Map;b(this,Qe,r,"f");let n=new Map,s=l=>{let p=r.has(l.id),_=!l.toolset_name&&a(this,q,"m",kl).call(this).has(l.name),m=_?l.name:l.toolset_name;if(m){if(p||_||n.has(m)){n.set(m,"waiting");return}n.set(m,"running");let g=rf(a(this,q,"m",Sl).call(this),m,l,a(this,_e,"f"),a(this,O,"f")._client,a(this,ut,"f"));r.set(l.id,{status:"started",result:g}),g.then(({is_error:y})=>{y||n.get(m)==="waiting"?n.set(m,"waiting"):n.delete(m)},()=>n.set(m,"waiting"));return}if(p)return;let h=nf(a(this,q,"m",wo).call(this),a(this,q,"m",El).call(this),l,a(this,_e,"f"),a(this,O,"f")._client,a(this,ut,"f"));h.catch(()=>{}),r.set(l.id,{status:"started",result:h})},o=new fd(e._state.params,s,e._client);return e._stream(o,void 0,Eo(e),a(this,q,"m",wl).call(this,e)),o},Td=async function(){let e=[...a(this,Qe,"f")?.values()??[]].filter(r=>r.status==="started");await Promise.allSettled(e.map(r=>r.result))},Rd=async function*(e){zd(this.params),b(this,Re,{status:"in_flight"},"f"),b(this,Ye,void 0,"f");let r=a(this,be,"f"),n=a(this,q,"m",K_).call(this,e),s=a(this,O,"f").messages.length;try{yield*a(this,q,"m",Pd).call(this,n);let o=await a(this,be,"f");if(o.content.some(l=>l.type==="compaction"&&l.content)){a(this,q,"m",D_).call(this);let l={role:o.role,content:o.content},p=a(this,O,"f").messages.slice(s).filter(_=>!bo(_,l));a(this,O,"f")._state.setMessages([l,...p])}else I(a(this,O,"f")._client).warn("Compaction produced no summary; keeping the conversation as it is."),b(this,be,r,"f")}finally{b(this,Re,{status:"idle"},"f"),n._state.threading||a(this,O,"f")._state.stopThreading()}},K_=function(e){let{messages:r,...n}=rv(a(this,O,"f")._state.params),s=a(this,O,"f").fork();return s._state=a(this,O,"f")._state.fork({...n,compaction:e}),s},wo=function(){let e=new Map;for(let r of a(this,O,"f")._state.params.tools??[])"run"in r&&"name"in r&&e.set(r.name,r);for(let[r,n]of a(this,Li,"f"))n?e.set(r,n):e.delete(r);return e},El=function(){let e=new Set(a(this,q,"m",wo).call(this).keys());for(let r of[...this.params.messages,a(this,q,"m",Id).call(this)])if(Array.isArray(r.content)){for(let n of r.content)if(r.role==="system")ef(n,e);else if(r.role==="assistant"&&n.type==="compaction")for(let s of n.tool_changes??[])ef(s,e)}return e},D_=function(){let e=a(this,q,"m",El).call(this);for(let r of a(this,q,"m",wo).call(this).keys())e.has(r)||a(this,Li,"f").set(r,null)},G_=async function*(){if(a(this,Re,"f").status==="scheduled"){if(Z_(a(this,O,"f").messages.at(-1))){I(a(this,O,"f")._client).warn("The pending compaction was skipped because the last turn ended with tool calls that were not run. Call `compactBeforeNextTurn()` again if you continue the conversation."),b(this,Re,{status:"idle"},"f");return}yield*a(this,q,"m",Rd).call(this,a(this,Re,"f").config)}},Cd=async function(e,r,n){return a(this,Ye,"f")!==void 0?a(this,Ye,"f"):(b(this,Ye,nv(a(this,q,"m",Sl).call(this),a(this,q,"m",wo).call(this),a(this,q,"m",El).call(this),e,{...a(this,_e,"f"),signal:r},a(this,Qe,"f"),a(this,O,"f")._client,n),"f"),a(this,Ye,"f"))},kl=function(){return new Set(a(this,q,"m",Sl).call(this).tools.filter(Lr).map(Pt))},Sl=function(){return{...this.params,tools:a(this,O,"f")._state.params.tools??[]}},V_=function(){a(this,qi,"f")==="pause_turn"||a(this,Vt,"f").length===0||(a(this,O,"f").append(a(this,q,"m",Id).call(this)),b(this,Vt,[],"f"))},Id=function(){let e=[];for(let r of a(this,Vt,"f")){if(r.type==="removal"){e.push({type:"tool_removal",tool:{type:"tool_reference",name:r.name}});continue}let n=Nd(r.tool);e.push({type:"tool_addition",tool:{type:"tool_definition",definition:n}})}return{role:"system",content:e}},t})(),ev="Message params can't be changed while the conversation is being compacted, because the compaction response is about to replace them. Change them after this iteration instead.";function tv(t,i){return t.length===i.length&&t.every((e,r)=>bo(e,i[r]))}function Y_(t){if("compaction"in t&&t.compaction!=null)throw new E("`compaction` cannot be set on a tool runner: every request in the loop would compact again. Call `runner.compactBeforeNextTurn()` when the conversation should be compacted instead.")}function Q_(t){if(t.runToolsEagerly&&!t.stream)throw new TypeError("`runToolsEagerly: true` needs `stream: true` in the tool runner's params, because a reply that isn't streamed arrives whole.")}function zd(t){if(t.context_management?.edits?.some(i=>i.type.startsWith("compact_")))throw new E("`compactBeforeNextTurn()` can't be used while `context_management` has a compaction edit, because the API doesn't accept a compaction block together with one. Remove the edit first.")}function rv(t){let{context_management:i,stop_sequences:e,output_format:r,...n}=t,s=({format:o,...l})=>l;return(n.tool_choice?.type==="any"||n.tool_choice?.type==="tool")&&delete n.tool_choice,n.output_config&&(n.output_config=s(n.output_config)),Array.isArray(n.fallbacks)&&(n.fallbacks=n.fallbacks.map(o=>o.output_config?{...o,output_config:s(o.output_config)}:o)),n}function Nd(t){if(!("run"in t))return t;let i=Uc,e="toJSON"in t&&typeof t.toJSON=="function"?t.toJSON():t;return{...Object.fromEntries(Object.entries(e).filter(([r])=>i.includes(r))),...nt(t)&&{[Le]:t[Le]}}}function Eo(t){let{tools:i}=t._state.params;return i?{tools:i.map(Nd)}:{}}function X_(t){return t.map(i=>{if(i.role!=="system"||!Array.isArray(i.content))return i;let e=i.content.map(r=>r.type==="tool_addition"&&r.tool.type==="tool_definition"?{...r,tool:{...r.tool,definition:Nd(r.tool.definition)}}:r);return{...i,content:e}})}function iv(t){return t.role==="system"&&Array.isArray(t.content)&&t.content.some(i=>i.type==="tool_addition"&&i.tool.type==="tool_definition"&&"run"in i.tool.definition)}async function nv(t,i,e,r,n,s,o,l){if(!r||r.role!=="assistant"||!r.content||typeof r.content=="string")return null;let p=r.content.filter(h=>h.type==="tool_use");if(p.length===0)return null;let _=new Map;return{role:"user",content:await Promise.all(p.map(async h=>{let g=s?.get(h.id),y=g?.status==="started"?g.result:void 0;if(h.toolset_name){let S=h.toolset_name,R=_.get(S)??{tail:Promise.resolve(),failed:!1};_.set(S,R);let A=t.tools.some(T=>Lr(T)&&Pt(T)===S),C=y??R.tail.then(()=>R.failed?Us(h,O_(S),!0):rf(t,S,h,n,o,l));return R.tail=C.then(({is_error:T})=>{T&&A&&(R.failed=!0)},()=>{R.failed=!0}),s?.set(h.id,{status:"started",result:C}),C}if(y)return y;if(!(e.has(h.name)?i.get(h.name):void 0)&&t.tools.some(S=>Lr(S)&&Pt(S)===h.name)){let S=_.get(h.name)??{tail:Promise.resolve(),failed:!1};return _.set(h.name,S),S.tail=S.tail.then(()=>{S.failed=!0}),cv(h)}let k=nf(i,e,h,n,o,l);return s?.set(h.id,{status:"started",result:k}),k}))}}async function rf(t,i,e,r,n,s){let o=t.tools.find(_=>Lr(_)&&Pt(_)===i);if(!o)return Us(e,`Error: Toolset '${st(i)}' member '${st(e.name)}' not found`,!0);let l={signal:r?.signal,conversationId:r?.openTelemetry?.conversationId,parentContext:s};return(await lr(n,o,e,l,async()=>{let _=await M_(o,e,{signal:r?.signal});return{block:_,content:_.content??[],isError:_.is_error===!0}})).block}async function nf(t,i,e,r,n,s){let o=i.has(e.name)?t.get(e.name):void 0;if(!o)return av(e);let l={signal:r?.signal,conversationId:r?.openTelemetry?.conversationId,parentContext:s},p=await lr(n,o,e,l,()=>hc(o,e.input,{toolUse:e,toolUseBlock:e,signal:r?.signal}));return{type:"tool_result",tool_use_id:e.id,content:p.content,...p.isError?{is_error:!0}:void 0}}function sv(t){for(let i=t.length-1;i>=0;i--){let e=t[i];if(e.role==="assistant")return e;if(e.role==="user"&&Array.isArray(e.content)&&e.content.some(r=>r.type==="tool_result"))return}}function Z_(t){return Array.isArray(t?.content)&&t.content.some(i=>i.type==="tool_use")}function ov(t){return(t.type??"custom").replace(/_\d{8}$/,"").replace(/_toolset$/,"")}function av(t){return{type:"tool_result",tool_use_id:t.id,content:`Error: Tool '${t.name}' not found`,is_error:!0}}function cv(t){return{type:"tool_result",tool_use_id:t.id,content:`Error: the '${st(t.name)}' toolset could not run this call${lv(t.input)}; nothing in the batch was executed`,is_error:!0}}function lv(t){let i=typeof t=="object"&&t!==null?t:{};if(!("actions"in i)){let s="action"in i?i.action:void 0;return typeof s=="string"?`: the call has no 'actions' list (action: '${st(s)}')`:": the call has no 'actions' list"}let{actions:e}=i;if(typeof e=="string")return": 'actions' is text, not a list of actions";if(!Array.isArray(e))return": 'actions' is not a list of actions";if(e.length===0)return": the 'actions' list is empty";let r=[];for(let[s,o]of e.entries()){let l=typeof o=="object"&&o!==null&&"action"in o?o.action:void 0;if(typeof l!="string")return`: action ${s} must be an object with a string 'action' field`;r.push(`'${st(l)}'`)}let n=r.length>10?`, and ${r.length-10} more`:"";return`: its actions could not be run as sent (actions: ${r.slice(0,10).join(", ")}${n})`}function ef(t,i){switch(t.type){case"tool_removal":case"tool_addition":uv(t,i);break}}function uv(t,i){let e=dv(t.tool);e!==void 0&&(t.type==="tool_removal"?i.delete(e):i.add(e))}function dv(t){switch(t.type){case"tool_reference":return t.name;case"tool_definition":return"name"in t.definition?t.definition.name:void 0;default:return}}function tf(t){if(t===null)return"stop";if(Ad(t))return"resume";switch(t){case"tool_use":return"run_tools";case"end_turn":case"stop_sequence":case"max_tokens":case"model_context_window_exceeded":case"refusal":return"stop";default:return"stop"}}var So=class t{constructor(i,e,r){if(!i._supportsMessageThreads)throw new E("Message threads are not available on this client; use `client.beta.messages.create()` with the full `messages` instead");zs(e),this._client=i,this._state=new bl({params:e,options:r??{},threading:!0,logger:I(i)})}static _fromState(i,e){let r=Object.create(t.prototype);return Object.assign(r,{_client:i,_state:e})}get messages(){return this._state.messages}get previousMessageId(){return this._state.previousMessageId}get params(){return{...this._state.params,unsupportedRequestBehavior:this._state.unsupportedRequestBehavior}}append(...i){this._state.push(i)}send(i,e={},r={}){return this._send(i,e,r,n=>n)}parse(i,e={},r={}){return this._send(i,e,r,n=>Is(n,this._state.params,{logger:I(this._client)}))}_send(i,e,r,n){let s=this._state.startTurn(xd(i),e),o=(async()=>{try{let{request:l,props:p}=await this._createWithRecovery(s,r,{stream:!1}),_=await l;return this._state.recordReply(s,_),{props:p,reply:_}}finally{this._state.endTurn(s)}})();return new wt(this._client,o.then(({props:l})=>l),async()=>{let{props:l,reply:p}=await o;return qt(n(p),l.response)})}stream(i,e={},r={}){let n=new qr(this._state.params,{logger:I(this._client),client:this._client});return this._stream(n,i,e,r),n}_stream(i,e,r,n){let s=this._state.startTurn(xd(e),r),o,l=0,p=!1;i.on("streamEvent",(h,g)=>{p||(o=g,h.type==="content_block_stop"&&(l+=1),h.type==="message_stop"&&(p=!0,this._state.recordReply(s,g),this._state.endTurn(s)))});let _=()=>{p||(p=!0,o&&this._state.recordPartialReply(o,l),this._state.endTurn(s))};i.controller.signal.addEventListener("abort",_,{once:!0});let m=(h,g)=>new wt(this._client,this._createWithRecovery(s,{...n,signal:g?.signal},{stream:!0}).then(({props:y})=>y));i._start(m,this._state.params,{signal:n.signal??this._state.options.signal},_)}update(i={},e={}){this._state.update(i,e)}toolRunner(i={},e={}){return go(i),new ko(this,i,e)}fork(){return t._fromState(this._client,this._state.fork())}async _createWithRecovery(i,e,{stream:r}){for(;;){let{params:n,options:s}=this._state.buildCreateArguments(i,e,{stream:r}),o=this._client.beta.messages.create({...n,stream:r},s);try{return{request:o,props:await o._responseProps()}}catch(l){if(!this._state.recoversFrom(l))throw l}}}};var sf={"claude-sonnet-4-5":"November 30th, 2026","claude-sonnet-4-5-20250929":"November 30th, 2026"},pv=["claude-mythos-preview","claude-opus-4-6"],Fr=(()=>{class t extends f{constructor(){super(...arguments),this.batches=new Br(this._client)}create(e,r){let n=zc(e),{betas:s,user_profile_id:o,workspace_id:l,...p}=n;p.model in sf&&console.warn(`The model '${p.model}' is deprecated and will reach end-of-life on ${sf[p.model]}
Please migrate to a newer model. Visit https://docs.anthropic.com/en/docs/resources/model-deprecations for more information.`),pv.includes(p.model)&&p.thinking&&p.thinking.type==="enabled"&&console.warn(`Using Claude with ${p.model} and 'thinking.type=enabled' is deprecated. Use 'thinking.type=adaptive' instead which results in better model performance in our testing: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking`);let _=r?.timeout??this._client._options.timeout;if(!p.stream&&_==null){let y=Ic[p.model]??void 0;_=this._client.calculateNonstreamingTimeout(p.max_tokens,y)}let m={body:p,timeout:_??6e5,...r,headers:ad(n,r),stream:n.stream??!1,__qualifiers:{beta:"true"}},h=this._client._tracer&&c(this._client,"anthropic.messages.create",r,it(this._client,m));os(this._client,h,p);let g=this._client.post("/v1/messages",{...m,__span:h});return h?g._thenUnwrap(y=>(as(this._client,h,p,y),y)):g}parse(e,r){return r={...r,headers:d([{"anthropic-beta":[...e.betas??[],"structured-outputs-2025-12-15"].toString()},r?.headers])},this.create(e,r).then(n=>Is(n,e,{logger:this._client.logger??console}))}stream(e,r){return qr.createMessage(this,e,r,{client:this._client})}countTokens(e,r){let n=zc(e),{betas:s,user_profile_id:o,workspace_id:l,...p}=n,_={body:p,...r,headers:d([{"anthropic-beta":[...s??[],"token-counting-2024-11-01"].toString(),...o!=null?{"anthropic-user-profile-id":o}:void 0,...l!=null?{"anthropic-workspace-id":l}:void 0},r?.headers]),__qualifiers:{beta:"true"}};return this._client.post("/v1/messages/count_tokens",{..._,__span:c(this._client,"anthropic.messages.count_tokens",r,{route:"/v1/messages/count_tokens",request:_})})}toolRunner(e,r){return new ko(this._client,e,r)}_toolRunnerThread(e){zs(e);let{settings:r,thread:n,threadParams:s}=yl(e),o=new bl({params:{...s,unsupportedRequestBehavior:"continue_unthreaded"},options:{},threading:n!==!1&&this._client._supportsMessageThreads,logger:I(this._client)});return{thread:So._fromState(this._client,o),settings:r}}thread(e,r){return new So(this._client,e,r)}}return t.Batches=Br,t.BetaToolRunner=ko,t.ToolError=Pr,t})();var Uc=["input_schema","name","allowed_callers","cache_control","defer_loading","description","eager_input_streaming","input_examples","strict","type","configs","display_height_px","display_width_px","display_number","enable_zoom","max_characters"];z();var $i=(()=>{class t extends P{}return t._errorName="BetaOrganizationNotEnrolledInBetaError",t})(),Fi=(()=>{class t extends P{}return t._errorName="BetaRequestBodyTimeoutError",t})(),Ui=(()=>{class t extends P{}return t._errorName="BetaUnsupportedCharsetError",t})(),Ao=(()=>{class t extends f{constructor(){super(...arguments),this.models=new gr(this._client),this.messages=new Fr(this._client),this.agents=new rc(this._client),this.environments=new Tc(this._client),this.sessions=new cl(this._client),this.deployments=new _r(this._client),this.deploymentRuns=new hr(this._client),this.vaults=new pl(this._client),this.memoryStores=new Rc(this._client),this.files=new mr(this._client),this.skills=new ll(this._client),this.webhooks=new yr(this._client),this.userProfiles=new dl(this._client),this.dreams=new fr(this._client),this.tunnels=new ul(this._client),this.organization=new sl(this._client)}}return t.BetaOrganizationNotEnrolledInBetaError=$i,t.BetaRequestBodyTimeoutError=Fi,t.BetaUnsupportedCharsetError=Ui,t.Models=gr,t.Messages=Fr,t.Agents=rc,t.Environments=Tc,t.BetaEnvironmentArchivedError=As,t.BetaInvalidConfigTypeChangeError=xs,t.BetaInvalidMetadataError=Ps,t.BetaEnvironmentCreateDisabledError=Ts,t.BetaEnvironmentUpdateDisabledError=Rs,t.BetaEnvironmentNotFoundError=Cs,t.Sessions=cl,t.Deployments=_r,t.DeploymentRuns=hr,t.Vaults=pl,t.MemoryStores=Rc,t.Files=mr,t.Skills=ll,t.Webhooks=yr,t.UserProfiles=dl,t.Dreams=fr,t.Tunnels=ul,t.Organization=sl,t})();function Od(t,i){let{user_profile_id:e,workspace_id:r,tools:n,messages:s}=t;return d([{...e!=null?{"anthropic-user-profile-id":e}:void 0,...r!=null?{"anthropic-workspace-id":r}:void 0},za(n,s),i?.headers])}function of(t,i,e){if(!t._tracer)return;let r=Od(i,e);return c(t,"anthropic.messages.create",e,it(t,{body:i,headers:r,stream:!0}))}pt();z();function af(t){return t?.output_config?.format}function Md(t,i,e){let r=af(i);return!i||!("parse"in(r??{}))?{...t,content:t.content.map(n=>n.type==="text"?Object.defineProperty({...n},"parsed_output",{value:null,enumerable:!1}):n),parsed_output:null}:Bd(t,i,e)}function Bd(t,i,e){let r=null,n=t.content.map(s=>{if(s.type==="text"){let o=_v(i,s.text);return r===null&&(r=o),Object.defineProperty({...s},"parsed_output",{value:o,enumerable:!1})}return s});return{...t,content:n,parsed_output:r}}function _v(t,i){let e=af(t);if(e?.type!=="json_schema")return null;try{return"parse"in e?e.parse(i):JSON.parse(i)}catch(r){throw new E(`Failed to parse structured output: ${r}`)}}var Oe,It,Xe,xo,Al,Po,To,xl,Ro,Ze,Co,Pl,Tl,Jt,Rl,Cl,Il,Io,Yt,ye,qd,cf,Ld,$d,Fd,Ud,lf;function Hd(t){return t.type==="tool_use"||t.type==="server_tool_use"}var uf=(()=>{class t{constructor(e,r){Oe.add(this),this.messages=[],this.receivedMessages=[],It.set(this,void 0),Xe.set(this,null),this.controller=new AbortController,xo.set(this,void 0),Al.set(this,()=>{}),Po.set(this,()=>{}),To.set(this,void 0),xl.set(this,()=>{}),Ro.set(this,()=>{}),Ze.set(this,{}),Co.set(this,!1),Pl.set(this,!1),Tl.set(this,!1),Jt.set(this,!1),Rl.set(this,void 0),Cl.set(this,void 0),Il.set(this,void 0),Io.set(this,void 0),Yt.set(this,void 0),ye.set(this,void 0),Ld.set(this,n=>{if(b(this,Pl,!0,"f"),a(this,ye,"f")&&(a(this,ye,"f").streamed=void 0),we(n)&&(n=new ie),n instanceof ie)return b(this,Tl,!0,"f"),this._emit("abort",n);if(n instanceof E)return this._emit("error",n);if(n instanceof Error){let s=new E(n.message);return s.cause=n,this._emit("error",s)}return this._emit("error",new E(String(n)))}),b(this,xo,new Promise((n,s)=>{b(this,Al,n,"f"),b(this,Po,s,"f")}),"f"),b(this,To,new Promise((n,s)=>{b(this,xl,n,"f"),b(this,Ro,s,"f")}),"f"),a(this,xo,"f").catch(()=>{}),a(this,To,"f").catch(()=>{}),b(this,Xe,e,"f"),b(this,Io,r?.logger??console,"f"),b(this,Yt,r?.client,"f")}get response(){return a(this,Rl,"f")}get request_id(){return a(this,Cl,"f")}get workspace_id(){return a(this,Il,"f")}async withResponse(){b(this,Jt,!0,"f");let e=await a(this,xo,"f");if(!e)throw new Error("Could not resolve a `Response` object");return{data:this,response:e,request_id:e.headers.get("request-id"),workspace_id:e.headers.get("anthropic-workspace-id")}}static fromReadableStream(e){let r=new t(null);return r._run(()=>r._fromReadableStream(e)),r}static createMessage(e,r,n,{logger:s,client:o}={}){let l=new t(r,{logger:s,client:o});for(let p of r.messages)l._addMessageParam(p);return b(l,Xe,{...r,stream:!0},"f"),l._run(()=>l._createMessage(e,{...r,stream:!0},{...n,headers:{...n?.headers,[ar]:"stream"}})),l}_run(e){e().then(()=>{this._emitFinal(),this._emit("end")},a(this,Ld,"f"))}_addMessageParam(e){this.messages.push(e)}_addMessage(e,r=!0){this.receivedMessages.push(e),r&&this._emit("message",e)}async _createMessage(e,r,n){let s=n?.signal,o;s&&(s.aborted&&this.controller.abort(),o=this.controller.abort.bind(this.controller),s.addEventListener("abort",o));try{a(this,Oe,"m",$d).call(this),b(this,ye,n?.__span??(a(this,Yt,"f")&&of(a(this,Yt,"f"),r,n)),"f");let{response:l,data:p}=await e.create({...r,stream:!0},{...n,__span:a(this,ye,"f"),signal:this.controller.signal}).withResponse();try{this._connected(l)}catch(_){throw a(this,ye,"f")&&(a(this,ye,"f").failure=_),p.controller.abort(),_}for await(let _ of p)try{a(this,Oe,"m",Fd).call(this,_)}catch(m){throw a(this,ye,"f")&&(a(this,ye,"f").failure=m),m}if(p.controller.signal?.aborted)throw new ie;a(this,Oe,"m",Ud).call(this)}finally{s&&o&&s.removeEventListener("abort",o)}}_connected(e){this.ended||(b(this,Rl,e,"f"),b(this,Cl,e?.headers.get("request-id"),"f"),b(this,Il,e?.headers.get("anthropic-workspace-id"),"f"),a(this,Al,"f").call(this,e),this._emit("connect"))}get ended(){return a(this,Co,"f")}get errored(){return a(this,Pl,"f")}get aborted(){return a(this,Tl,"f")}abort(){this.controller.abort()}on(e,r){return(a(this,Ze,"f")[e]||(a(this,Ze,"f")[e]=[])).push({listener:r}),this}off(e,r){let n=a(this,Ze,"f")[e];if(!n)return this;let s=n.findIndex(o=>o.listener===r);return s>=0&&n.splice(s,1),this}once(e,r){return(a(this,Ze,"f")[e]||(a(this,Ze,"f")[e]=[])).push({listener:r,once:!0}),this}emitted(e){return new Promise((r,n)=>{b(this,Jt,!0,"f"),e!=="error"&&this.once("error",n),this.once(e,r)})}async done(){b(this,Jt,!0,"f"),await a(this,To,"f")}get currentMessage(){return a(this,It,"f")}async finalMessage(){return await this.done(),a(this,Oe,"m",qd).call(this)}async finalText(){return await this.done(),a(this,Oe,"m",cf).call(this)}_emit(e,...r){if(a(this,Co,"f"))return;e==="end"&&(b(this,Co,!0,"f"),a(this,xl,"f").call(this));let n=a(this,Ze,"f")[e];if(n&&(a(this,Ze,"f")[e]=n.filter(s=>!s.once),n.forEach(({listener:s})=>s(...r))),e==="abort"){let s=r[0];!a(this,Jt,"f")&&!n?.length&&Promise.reject(s),a(this,Po,"f").call(this,s),a(this,Ro,"f").call(this,s),this._emit("end");return}if(e==="error"){let s=r[0];!a(this,Jt,"f")&&!n?.length&&Promise.reject(s),a(this,Po,"f").call(this,s),a(this,Ro,"f").call(this,s),this._emit("end")}}_emitFinal(){this.receivedMessages.at(-1)&&this._emit("finalMessage",a(this,Oe,"m",qd).call(this))}async _fromReadableStream(e,r){let n=r?.signal,s;n&&(n.aborted&&this.controller.abort(),s=this.controller.abort.bind(this.controller),n.addEventListener("abort",s));try{a(this,Oe,"m",$d).call(this),this._connected(null);let o=ue.fromReadableStream(e,this.controller);for await(let l of o)a(this,Oe,"m",Fd).call(this,l);if(o.controller.signal?.aborted)throw new ie;a(this,Oe,"m",Ud).call(this)}finally{n&&s&&n.removeEventListener("abort",s)}}[(It=new WeakMap,Xe=new WeakMap,xo=new WeakMap,Al=new WeakMap,Po=new WeakMap,To=new WeakMap,xl=new WeakMap,Ro=new WeakMap,Ze=new WeakMap,Co=new WeakMap,Pl=new WeakMap,Tl=new WeakMap,Jt=new WeakMap,Rl=new WeakMap,Cl=new WeakMap,Il=new WeakMap,Io=new WeakMap,Yt=new WeakMap,ye=new WeakMap,Ld=new WeakMap,Oe=new WeakSet,qd=function(){if(this.receivedMessages.length===0)throw new E("stream ended without producing a Message with role=assistant");return this.receivedMessages.at(-1)},cf=function(){if(this.receivedMessages.length===0)throw new E("stream ended without producing a Message with role=assistant");let r=this.receivedMessages.at(-1).content.filter(n=>n.type==="text").map(n=>n.text);if(r.length===0)throw new E("stream ended without producing a content block with type=text");return r.join(" ")},$d=function(){this.ended||b(this,It,void 0,"f")},Fd=function(r){if(this.ended)return;let n=a(this,Oe,"m",lf).call(this,r);if(this._emit("_rawEvent",r),!!n)switch(this._emit("streamEvent",r,n),r.type){case"content_block_delta":{let s=n.content.at(-1);switch(r.delta.type){case"text_delta":{s.type==="text"&&this._emit("text",r.delta.text,s.text||"");break}case"citations_delta":{s.type==="text"&&this._emit("citation",r.delta.citation,s.citations??[]);break}case"input_json_delta":{Hd(s)&&a(this,Ze,"f").inputJson?.length&&this._emit("inputJson",r.delta.partial_json,s.input);break}case"thinking_delta":{s.type==="thinking"&&this._emit("thinking",r.delta.thinking,s.thinking);break}case"signature_delta":{s.type==="thinking"&&this._emit("signature",s.signature);break}default:r.delta}break}case"message_stop":{a(this,Yt,"f")&&a(this,ye,"f")&&a(this,Xe,"f")&&or(a(this,Yt,"f"),a(this,ye,"f"),a(this,Xe,"f"),n),this._addMessageParam(n),this._addMessage(Md(n,a(this,Xe,"f"),{logger:a(this,Io,"f")}),!0);break}case"content_block_stop":{this._emit("contentBlock",n.content.at(-1));break}case"message_start":{b(this,It,n,"f"),a(this,ye,"f")&&a(this,Xe,"f")&&(a(this,ye,"f").streamed={body:a(this,Xe,"f"),message:n});break}case"content_block_start":case"message_delta":break}},Ud=function(){if(this.ended)throw new E("stream has ended, this shouldn't happen");let r=a(this,It,"f");if(!r)throw new E("request ended without sending any chunks");return b(this,It,void 0,"f"),Md(r,a(this,Xe,"f"),{logger:a(this,Io,"f")})},lf=function(r){let n=a(this,It,"f");if(r.type==="message_start"){if(n)throw new E(`Unexpected event order, got ${r.type} before receiving "message_stop"`);return r.message}if(n)switch(r.type){case"message_stop":return n;case"message_delta":return n.stop_reason=r.delta.stop_reason,n.stop_sequence=r.delta.stop_sequence,n.stop_details=r.delta.stop_details,n.usage.output_tokens=r.usage.output_tokens,r.delta.container!=null&&(n.container=r.delta.container),r.usage.input_tokens!=null&&(n.usage.input_tokens=r.usage.input_tokens),r.usage.cache_creation_input_tokens!=null&&(n.usage.cache_creation_input_tokens=r.usage.cache_creation_input_tokens),r.usage.cache_read_input_tokens!=null&&(n.usage.cache_read_input_tokens=r.usage.cache_read_input_tokens),r.usage.server_tool_use!=null&&(n.usage.server_tool_use=r.usage.server_tool_use),r.usage.output_tokens_details!=null&&(n.usage.output_tokens_details=r.usage.output_tokens_details),n;case"content_block_start":return n.content.push({...r.content_block}),n;case"content_block_delta":{let s=n.content.at(r.index);switch(r.delta.type){case"text_delta":{s?.type==="text"&&(n.content[r.index]={...s,text:(s.text||"")+r.delta.text});break}case"citations_delta":{s?.type==="text"&&(n.content[r.index]={...s,citations:[...s.citations??[],r.delta.citation]});break}case"input_json_delta":{if(s&&Hd(s)){let o=(s[At]||"")+r.delta.partial_json;n.content[r.index]=Nc(s,o)}break}case"thinking_delta":{s?.type==="thinking"&&(n.content[r.index]={...s,thinking:s.thinking+r.delta.thinking});break}case"signature_delta":{s?.type==="thinking"&&(n.content[r.index]={...s,signature:r.delta.signature});break}default:r.delta}return n}case"content_block_stop":{let s=n.content.at(r.index);return s&&Hd(s)&&At in s&&Object.defineProperty(s,"input",{value:s.input,enumerable:!0,configurable:!0,writable:!0}),n}default:return n}},Symbol.asyncIterator)](){let e=[],r=[],n=!1;return this.on("_rawEvent",s=>{let o=r.shift();o?o.resolve(s):e.push(s)}),this.on("end",()=>{n=!0;for(let s of r)s.resolve(void 0);r.length=0}),this.on("abort",s=>{n=!0;for(let o of r)o.reject(s);r.length=0}),this.on("error",s=>{n=!0;for(let o of r)o.reject(s);r.length=0}),{next:async()=>e.length?{value:e.shift(),done:!1}:n?{value:void 0,done:!0}:new Promise((o,l)=>r.push({resolve:o,reject:l})).then(o=>o?{value:o,done:!1}:{value:void 0,done:!0}),return:async()=>(this.abort(),{value:void 0,done:!0})}}toReadableStream(){return new ue(this[Symbol.asyncIterator].bind(this),this.controller).toReadableStream()}}return t})();var Hi=class extends f{create(i,e){let{user_profile_id:r,workspace_id:n,...s}=i;return this._client.post("/v1/messages/batches",{body:s,...e,headers:d([{...r!=null?{"anthropic-user-profile-id":r}:void 0,...n!=null?{"anthropic-workspace-id":n}:void 0},e?.headers]),__span:c(this._client,"anthropic.messages.batches.create",e,{route:"/v1/messages/batches",attributes:{"anthropic.message.batch.request_count":s.requests?.length},createdIDAttribute:"anthropic.message.batch.id"})})}retrieve(i,e={},r){let{workspace_id:n}=e??{};return this._client.get(u`/v1/messages/batches/${i}`,{...r,headers:d([{...n!=null?{"anthropic-workspace-id":n}:void 0},r?.headers]),__span:c(this._client,"anthropic.messages.batches.retrieve",r,{route:"/v1/messages/batches/{message_batch_id}",attributes:{"anthropic.message.batch.id":i}})})}list(i={},e){let{workspace_id:r,...n}=i??{};return this._client.getAPIList("/v1/messages/batches",F,{query:n,...e,headers:d([{...r!=null?{"anthropic-workspace-id":r}:void 0},e?.headers]),__span:c(this._client,"anthropic.messages.batches.list",e,{route:"/v1/messages/batches",queryParams:["after_id","before_id","limit"]})})}delete(i,e={},r){let{workspace_id:n}=e??{};return this._client.delete(u`/v1/messages/batches/${i}`,{...r,headers:d([{...n!=null?{"anthropic-workspace-id":n}:void 0},r?.headers]),__span:c(this._client,"anthropic.messages.batches.delete",r,{route:"/v1/messages/batches/{message_batch_id}",attributes:{"anthropic.message.batch.id":i}})})}cancel(i,e={},r){let{workspace_id:n}=e??{};return this._client.post(u`/v1/messages/batches/${i}/cancel`,{...r,headers:d([{...n!=null?{"anthropic-workspace-id":n}:void 0},r?.headers]),__span:c(this._client,"anthropic.messages.batches.cancel",r,{route:"/v1/messages/batches/{message_batch_id}/cancel",attributes:{"anthropic.message.batch.id":i}})})}async results(i,e={},r){let n=await this.retrieve(i,e,r);if(!n.results_url)throw new E(`No batch \`results_url\`; Has it finished processing? ${n.processing_status} - ${n.id}`);let{workspace_id:s}=e??{};return this._client.get(n.results_url,{...r,headers:d([{Accept:"application/binary",...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),stream:!0,__binaryResponse:!0,__span:c(this._client,"anthropic.messages.batches.results",r,{route:"/v1/messages/batches/{message_batch_id}/results",attributes:{"anthropic.message.batch.id":i}})})._thenUnwrap((o,l)=>Cc.fromResponse(l.response,l.controller))}};z();var Wi=(()=>{class t extends P{}return t._errorName="AvailableToolsLimitExceededError",t})(),ji=(()=>{class t extends P{}return t._errorName="CompactionBlockAmbiguousError",t})(),Ki=(()=>{class t extends P{}return t._errorName="CompactionBlockMisplacedError",t})(),Di=(()=>{class t extends P{}return t._errorName="CompactionContentMismatchError",t})(),Gi=(()=>{class t extends P{}return t._errorName="CompactionIncompleteTurnError",t})(),Vi=(()=>{class t extends P{}return t._errorName="CompactionNothingToSummarizeError",t})(),Ji=(()=>{class t extends P{}return t._errorName="CompactionSignatureInvalidError",t})(),Yi=(()=>{class t extends P{}return t._errorName="CompactionTooManyToolReferencesError",t})(),Qi=(()=>{class t extends P{}return t._errorName="CompactionToolChangesMismatchError",t})(),Xi=(()=>{class t extends P{}return t._errorName="ThreadAlreadyContinuedError",t})(),Zi=(()=>{class t extends P{}return t._errorName="ThreadContinueInFlightError",t})(),en=(()=>{class t extends P{}return t._errorName="ThreadFingerprintMismatchError",t})(),tn=(()=>{class t extends P{}return t._errorName="ThreadUnsupportedRequestError",t})(),rn=(()=>{class t extends P{}return t._errorName="ToolNameConflictError",t})(),nn=(()=>{class t extends P{}return t._errorName="ToolReferenceUnresolvedError",t})(),sn=(()=>{class t extends ae{}return t._errorName="ThreadNotFoundError",t})(),on=(()=>{class t extends Hn{}return t._errorName="CompactionUnavailableError",t})(),zo=(()=>{class t extends f{constructor(){super(...arguments),this.batches=new Hi(this._client)}create(e,r){let{user_profile_id:n,workspace_id:s,...o}=e;o.model in df&&console.warn(`The model '${o.model}' is deprecated and will reach end-of-life on ${df[o.model]}
Please migrate to a newer model. Visit https://docs.anthropic.com/en/docs/resources/model-deprecations for more information.`),mv.includes(o.model)&&o.thinking&&o.thinking.type==="enabled"&&console.warn(`Using Claude with ${o.model} and 'thinking.type=enabled' is deprecated. Use 'thinking.type=adaptive' instead which results in better model performance in our testing: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking`);let l=r?.timeout??this._client._options.timeout;if(!o.stream&&l==null){let h=Ic[o.model]??void 0;l=this._client.calculateNonstreamingTimeout(o.max_tokens,h)}let p={body:o,timeout:l??6e5,...r,headers:Od(e,r),stream:e.stream??!1},_=this._client._tracer&&c(this._client,"anthropic.messages.create",r,it(this._client,p));os(this._client,_,o);let m=this._client.post("/v1/messages",{...p,__span:_});return _?m._thenUnwrap(h=>(as(this._client,_,o,h),h)):m}parse(e,r){return this.create(e,r).then(n=>Bd(n,e,{logger:this._client.logger??console}))}stream(e,r){let n=e;return uf.createMessage(this,n,r,{logger:this._client.logger??console,client:this._client})}countTokens(e,r){let{user_profile_id:n,workspace_id:s,...o}=e,l={body:o,...r,headers:d([{...n!=null?{"anthropic-user-profile-id":n}:void 0,...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers])};return this._client.post("/v1/messages/count_tokens",{...l,__span:c(this._client,"anthropic.messages.count_tokens",r,{route:"/v1/messages/count_tokens",request:l})})}}return t.AvailableToolsLimitExceededError=Wi,t.CompactionBlockAmbiguousError=ji,t.CompactionBlockMisplacedError=Ki,t.CompactionContentMismatchError=Di,t.CompactionIncompleteTurnError=Gi,t.CompactionNothingToSummarizeError=Vi,t.CompactionSignatureInvalidError=Ji,t.CompactionTooManyToolReferencesError=Yi,t.CompactionToolChangesMismatchError=Qi,t.ThreadAlreadyContinuedError=Xi,t.ThreadContinueInFlightError=Zi,t.ThreadFingerprintMismatchError=en,t.ThreadUnsupportedRequestError=tn,t.ToolNameConflictError=rn,t.ToolReferenceUnresolvedError=nn,t.ThreadNotFoundError=sn,t.CompactionUnavailableError=on,t.Batches=Hi,t})();var df={"claude-sonnet-4-5":"November 30th, 2026","claude-sonnet-4-5-20250929":"November 30th, 2026"},mv=["claude-mythos-preview","claude-opus-4-6"];z();var No=(()=>{class t extends P{}return t._errorName="OrgAPIKeyLimitExceededError",t})(),Oo=(()=>{class t extends P{}return t._errorName="WorkspaceAPIKeyLimitExceededError",t})(),zl=(()=>{class t extends f{retrieve(e,r){return this._client.get(u`/v1/organizations/api_keys/${e}`,{...r,__span:c(this._client,"anthropic.organization.api_keys.retrieve",r,{route:"/v1/organizations/api_keys/{api_key_id}",attributes:{"anthropic.organization.api_key.id":e}})})}update(e,r,n){return this._client.post(u`/v1/organizations/api_keys/${e}`,{body:r,...n,__span:c(this._client,"anthropic.organization.api_keys.update",n,{route:"/v1/organizations/api_keys/{api_key_id}",attributes:{"anthropic.organization.api_key.id":e}})})}list(e={},r){return this._client.getAPIList("/v1/organizations/api_keys",F,{query:e,...r,__span:c(this._client,"anthropic.organization.api_keys.list",r,{route:"/v1/organizations/api_keys",queryParams:["after_id","before_id","created_by_user_id","limit","status","workspace_id"]})})}}return t.OrgAPIKeyLimitExceededError=No,t.WorkspaceAPIKeyLimitExceededError=Oo,t})();z();var Mo=(()=>{class t extends P{}return t._errorName="ExternalKeyInWorkspacePolicyError",t})(),Bo=(()=>{class t extends P{}return t._errorName="ExternalKeyValidationFailedError",t})(),qo=(()=>{class t extends P{}return t._errorName="ExternalKeyValidationTimedOutError",t})(),Lo=(()=>{class t extends pe{}return t._errorName="ExternalKeyChangedError",t})(),Nl=(()=>{class t extends f{create(e,r){return this._client.post("/v1/organizations/external_keys",{body:e,...r,__span:c(this._client,"anthropic.organization.external_keys.create",r,{route:"/v1/organizations/external_keys",createdIDAttribute:"anthropic.organization.external_key.id"})})}retrieve(e,r){return this._client.get(u`/v1/organizations/external_keys/${e}`,{...r,__span:c(this._client,"anthropic.organization.external_keys.retrieve",r,{route:"/v1/organizations/external_keys/{external_key_id}",attributes:{"anthropic.organization.external_key.id":e}})})}update(e,r,n){return this._client.post(u`/v1/organizations/external_keys/${e}`,{body:r,...n,__span:c(this._client,"anthropic.organization.external_keys.update",n,{route:"/v1/organizations/external_keys/{external_key_id}",attributes:{"anthropic.organization.external_key.id":e}})})}list(e={},r){return this._client.getAPIList("/v1/organizations/external_keys",v,{query:e,...r,__span:c(this._client,"anthropic.organization.external_keys.list",r,{route:"/v1/organizations/external_keys",queryParams:["limit","page"]})})}delete(e,r){return this._client.delete(u`/v1/organizations/external_keys/${e}`,{...r,__span:c(this._client,"anthropic.organization.external_keys.delete",r,{route:"/v1/organizations/external_keys/{external_key_id}",attributes:{"anthropic.organization.external_key.id":e}})})}validate(e,r){return this._client.post(u`/v1/organizations/external_keys/${e}/validate`,{...r,__span:c(this._client,"anthropic.organization.external_keys.validate",r,{route:"/v1/organizations/external_keys/{external_key_id}/validate",attributes:{"anthropic.organization.external_key.id":e}})})}}return t.ExternalKeyInWorkspacePolicyError=Mo,t.ExternalKeyValidationFailedError=Bo,t.ExternalKeyValidationTimedOutError=qo,t.ExternalKeyChangedError=Lo,t})();z();var $o=(()=>{class t extends P{}return t._errorName="AlreadyMemberError",t})(),Fo=(()=>{class t extends P{}return t._errorName="CannotInviteEmailsWithUnverifiedDomainsError",t})(),Uo=(()=>{class t extends P{}return t._errorName="EmailDomainNotAllowedError",t})(),Ho=(()=>{class t extends P{}return t._errorName="InviteAlreadyExistsError",t})(),Ol=(()=>{class t extends f{create(e,r){return this._client.post("/v1/organizations/invites",{body:e,...r,__span:c(this._client,"anthropic.organization.invites.create",r,{route:"/v1/organizations/invites",createdIDAttribute:"anthropic.organization.invite.id"})})}retrieve(e,r){return this._client.get(u`/v1/organizations/invites/${e}`,{...r,__span:c(this._client,"anthropic.organization.invites.retrieve",r,{route:"/v1/organizations/invites/{invite_id}",attributes:{"anthropic.organization.invite.id":e}})})}list(e={},r){return this._client.getAPIList("/v1/organizations/invites",F,{query:e,...r,__span:c(this._client,"anthropic.organization.invites.list",r,{route:"/v1/organizations/invites",queryParams:["after_id","before_id","email","limit","roles","statuses"]})})}delete(e,r){return this._client.delete(u`/v1/organizations/invites/${e}`,{...r,__span:c(this._client,"anthropic.organization.invites.delete",r,{route:"/v1/organizations/invites/{invite_id}",attributes:{"anthropic.organization.invite.id":e}})})}}return t.AlreadyMemberError=$o,t.CannotInviteEmailsWithUnverifiedDomainsError=Fo,t.EmailDomainNotAllowedError=Uo,t.InviteAlreadyExistsError=Ho,t})();var an=class extends f{retrieve(i){return this._client.get("/v1/organizations/compliance_settings",{...i,__span:c(this._client,"anthropic.organization.compliance_settings.retrieve",i,{route:"/v1/organizations/compliance_settings"})})}update(i,e){return this._client.post("/v1/organizations/compliance_settings",{body:i,...e,__span:c(this._client,"anthropic.organization.compliance_settings.update",e,{route:"/v1/organizations/compliance_settings"})})}};var cn=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/rate_limits",v,{query:i,...e,__span:c(this._client,"anthropic.organization.rate_limits.list",e,{route:"/v1/organizations/rate_limits",queryParams:["group_type","limit","model","page"]})})}};z();var Wo=(()=>{class t extends P{}return t._errorName="CannotRemoveLastMemberError",t})(),Ml=(()=>{class t extends f{retrieve(e,r){return this._client.get(u`/v1/organizations/users/${e}`,{...r,__span:c(this._client,"anthropic.organization.users.retrieve",r,{route:"/v1/organizations/users/{user_id}",attributes:{"anthropic.organization.user.id":e}})})}update(e,r,n){return this._client.post(u`/v1/organizations/users/${e}`,{body:r,...n,__span:c(this._client,"anthropic.organization.users.update",n,{route:"/v1/organizations/users/{user_id}",attributes:{"anthropic.organization.user.id":e}})})}list(e={},r){return this._client.getAPIList("/v1/organizations/users",F,{query:e,...r,__span:c(this._client,"anthropic.organization.users.list",r,{route:"/v1/organizations/users",queryParams:["after_id","before_id","email","limit","roles"]})})}remove(e,r){return this._client.delete(u`/v1/organizations/users/${e}`,{...r,__span:c(this._client,"anthropic.organization.users.remove",r,{route:"/v1/organizations/users/{user_id}",attributes:{"anthropic.organization.user.id":e}})})}}return t.CannotRemoveLastMemberError=Wo,t})();var ln=class extends f{list(i,e){return this._client.getAPIList("/v1/organizations/analytics/artifacts",v,{query:i,...e,__span:c(this._client,"anthropic.organization.analytics.artifacts.list",e,{route:"/v1/organizations/analytics/artifacts",queryParams:["date","filter","group_by","limit","page"]})})}};var un=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/analytics/connectors",v,{query:i,...e,__span:c(this._client,"anthropic.organization.analytics.connectors.list",e,{route:"/v1/organizations/analytics/connectors",queryParams:["date","ending_date","filter","group_by","limit","order","order_by","page","starting_date"],contentQueryParams:["filter"]})})}};var dn=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/analytics/plugins",v,{query:i,...e,__span:c(this._client,"anthropic.organization.analytics.plugins.list",e,{route:"/v1/organizations/analytics/plugins",queryParams:["date","ending_date","filter","group_by","limit","order","order_by","page","starting_date"],contentQueryParams:["filter"]})})}};var pn=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/analytics/skills",v,{query:i,...e,__span:c(this._client,"anthropic.organization.analytics.skills.list",e,{route:"/v1/organizations/analytics/skills",queryParams:["date","ending_date","filter","group_by","limit","order","order_by","page","starting_date"],contentQueryParams:["filter"]})})}};var hn=class extends f{list(i,e){return this._client.getAPIList("/v1/organizations/analytics/summaries",v,{query:i,...e,__span:c(this._client,"anthropic.organization.analytics.summaries.list",e,{route:"/v1/organizations/analytics/summaries",queryParams:["ending_date","filter","limit","page","starting_date"]})})}};var _n=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/analytics/users",v,{query:i,...e,__span:c(this._client,"anthropic.organization.analytics.users.list",e,{route:"/v1/organizations/analytics/users",queryParams:["date","ending_date","filter","group_by","limit","order","order_by","page","starting_date"],contentQueryParams:["page"]})})}};var fn=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/analytics/apps/chat/projects",v,{query:i,...e,__span:c(this._client,"anthropic.organization.analytics.apps.chat.projects.list",e,{route:"/v1/organizations/analytics/apps/chat/projects",queryParams:["date","ending_date","filter","group_by","limit","order","order_by","page","starting_date"]})})}};var Bl=(()=>{class t extends f{constructor(){super(...arguments),this.projects=new fn(this._client)}}return t.Projects=fn,t})();var ql=(()=>{class t extends f{constructor(){super(...arguments),this.chat=new Bl(this._client)}}return t.Chat=Bl,t})();var Ll=(()=>{class t extends f{constructor(){super(...arguments),this.summaries=new hn(this._client),this.users=new _n(this._client),this.apps=new ql(this._client),this.connectors=new un(this._client),this.plugins=new dn(this._client),this.skills=new pn(this._client),this.artifacts=new ln(this._client)}}return t.Summaries=hn,t.Users=_n,t.Apps=ql,t.Connectors=un,t.Plugins=dn,t.Skills=pn,t.Artifacts=ln,t})();var mn=class extends f{create(i,e){return this._client.post("/v1/organizations/federation_issuers",{body:i,...e,__span:c(this._client,"anthropic.organization.federation.issuers.create",e,{route:"/v1/organizations/federation_issuers",createdIDAttribute:"anthropic.organization.federation_issuer.id"})})}retrieve(i,e){return this._client.get(u`/v1/organizations/federation_issuers/${i}`,{...e,__span:c(this._client,"anthropic.organization.federation.issuers.retrieve",e,{route:"/v1/organizations/federation_issuers/{federation_issuer_id}",attributes:{"anthropic.organization.federation_issuer.id":i}})})}update(i,e,r){return this._client.post(u`/v1/organizations/federation_issuers/${i}`,{body:e,...r,__span:c(this._client,"anthropic.organization.federation.issuers.update",r,{route:"/v1/organizations/federation_issuers/{federation_issuer_id}",attributes:{"anthropic.organization.federation_issuer.id":i}})})}list(i={},e){return this._client.getAPIList("/v1/organizations/federation_issuers",v,{query:i,...e,__span:c(this._client,"anthropic.organization.federation.issuers.list",e,{route:"/v1/organizations/federation_issuers",queryParams:["include_archived","limit","page"]})})}archive(i,e){return this._client.post(u`/v1/organizations/federation_issuers/${i}/archive`,{...e,__span:c(this._client,"anthropic.organization.federation.issuers.archive",e,{route:"/v1/organizations/federation_issuers/{federation_issuer_id}/archive",attributes:{"anthropic.organization.federation_issuer.id":i}})})}};var gn=class extends f{list(i,e={},r){return this._client.getAPIList(u`/v1/organizations/federation_rules/${i}/workspaces`,v,{query:e,...r,__span:c(this._client,"anthropic.organization.federation.rules.workspaces.list",r,{route:"/v1/organizations/federation_rules/{federation_rule_id}/workspaces",queryParams:["limit","page"],attributes:{"anthropic.organization.federation_rule.id":i}})})}add(i,e,r){return this._client.post(u`/v1/organizations/federation_rules/${i}/workspaces`,{body:e,...r,__span:c(this._client,"anthropic.organization.federation.rules.workspaces.add",r,{route:"/v1/organizations/federation_rules/{federation_rule_id}/workspaces",attributes:{"anthropic.organization.federation_rule.id":i},createdIDAttribute:"anthropic.organization.federation_rule.workspace.id",createdIDField:"workspace_id"})})}remove(i,e,r){let{federation_rule_id:n}=e;return this._client.delete(u`/v1/organizations/federation_rules/${n}/workspaces/${i}`,{...r,__span:c(this._client,"anthropic.organization.federation.rules.workspaces.remove",r,{route:"/v1/organizations/federation_rules/{federation_rule_id}/workspaces/{workspace_id}",attributes:{"anthropic.organization.federation_rule.id":n,"anthropic.organization.federation_rule.workspace.id":i}})})}};var $l=(()=>{class t extends f{constructor(){super(...arguments),this.workspaces=new gn(this._client)}create(e,r){return this._client.post("/v1/organizations/federation_rules",{body:e,...r,__span:c(this._client,"anthropic.organization.federation.rules.create",r,{route:"/v1/organizations/federation_rules",createdIDAttribute:"anthropic.organization.federation_rule.id"})})}retrieve(e,r){return this._client.get(u`/v1/organizations/federation_rules/${e}`,{...r,__span:c(this._client,"anthropic.organization.federation.rules.retrieve",r,{route:"/v1/organizations/federation_rules/{federation_rule_id}",attributes:{"anthropic.organization.federation_rule.id":e}})})}update(e,r,n){return this._client.post(u`/v1/organizations/federation_rules/${e}`,{body:r,...n,__span:c(this._client,"anthropic.organization.federation.rules.update",n,{route:"/v1/organizations/federation_rules/{federation_rule_id}",attributes:{"anthropic.organization.federation_rule.id":e}})})}list(e={},r){return this._client.getAPIList("/v1/organizations/federation_rules",v,{query:e,...r,__span:c(this._client,"anthropic.organization.federation.rules.list",r,{route:"/v1/organizations/federation_rules",queryParams:["include_archived","issuer_id","limit","page"]})})}archive(e,r){return this._client.post(u`/v1/organizations/federation_rules/${e}/archive`,{...r,__span:c(this._client,"anthropic.organization.federation.rules.archive",r,{route:"/v1/organizations/federation_rules/{federation_rule_id}/archive",attributes:{"anthropic.organization.federation_rule.id":e}})})}}return t.Workspaces=gn,t})();var Fl=(()=>{class t extends f{constructor(){super(...arguments),this.issuers=new mn(this._client),this.rules=new $l(this._client)}}return t.Issuers=mn,t.Rules=$l,t})();var bn=class extends f{list(i,e={},r){return this._client.getAPIList(u`/v1/organizations/rbac_groups/${i}/members`,v,{query:e,...r,__span:c(this._client,"anthropic.organization.rbac_groups.members.list",r,{route:"/v1/organizations/rbac_groups/{rbac_group_id}/members",queryParams:["limit","page"],attributes:{"anthropic.organization.rbac_group.id":i}})})}add(i,e,r){return this._client.post(u`/v1/organizations/rbac_groups/${i}/members`,{body:e,...r,__span:c(this._client,"anthropic.organization.rbac_groups.members.add",r,{route:"/v1/organizations/rbac_groups/{rbac_group_id}/members",attributes:{"anthropic.organization.rbac_group.id":i},createdIDAttribute:"anthropic.organization.rbac_group.member.id",createdIDField:"user_id"})})}remove(i,e,r){let{rbac_group_id:n}=e;return this._client.delete(u`/v1/organizations/rbac_groups/${n}/members/${i}`,{...r,__span:c(this._client,"anthropic.organization.rbac_groups.members.remove",r,{route:"/v1/organizations/rbac_groups/{rbac_group_id}/members/{user_id}",attributes:{"anthropic.organization.rbac_group.id":n,"anthropic.organization.rbac_group.member.id":i}})})}};z();var jo=(()=>{class t extends P{}return t._errorName="RBACGroupGrantsOwnerAccessError",t})(),Ko=(()=>{class t extends P{}return t._errorName="RBACGroupOwnerAccessUnconfirmedError",t})(),Ul=(()=>{class t extends f{constructor(){super(...arguments),this.members=new bn(this._client)}create(e,r){return this._client.post("/v1/organizations/rbac_groups",{body:e,...r,__span:c(this._client,"anthropic.organization.rbac_groups.create",r,{route:"/v1/organizations/rbac_groups",createdIDAttribute:"anthropic.organization.rbac_group.id"})})}retrieve(e,r){return this._client.get(u`/v1/organizations/rbac_groups/${e}`,{...r,__span:c(this._client,"anthropic.organization.rbac_groups.retrieve",r,{route:"/v1/organizations/rbac_groups/{rbac_group_id}",attributes:{"anthropic.organization.rbac_group.id":e}})})}update(e,r,n){return this._client.post(u`/v1/organizations/rbac_groups/${e}`,{body:r,...n,__span:c(this._client,"anthropic.organization.rbac_groups.update",n,{route:"/v1/organizations/rbac_groups/{rbac_group_id}",attributes:{"anthropic.organization.rbac_group.id":e}})})}list(e={},r){return this._client.getAPIList("/v1/organizations/rbac_groups",v,{query:e,...r,__span:c(this._client,"anthropic.organization.rbac_groups.list",r,{route:"/v1/organizations/rbac_groups",queryParams:["limit","page"]})})}delete(e,r){return this._client.delete(u`/v1/organizations/rbac_groups/${e}`,{...r,__span:c(this._client,"anthropic.organization.rbac_groups.delete",r,{route:"/v1/organizations/rbac_groups/{rbac_group_id}",attributes:{"anthropic.organization.rbac_group.id":e}})})}}return t.RBACGroupGrantsOwnerAccessError=jo,t.RBACGroupOwnerAccessUnconfirmedError=Ko,t.Members=bn,t})();var yn=class extends f{list(i,e={},r){return this._client.getAPIList(u`/v1/organizations/rbac_roles/${i}/permissions`,v,{query:e,...r,__span:c(this._client,"anthropic.organization.rbac_roles.permissions.list",r,{route:"/v1/organizations/rbac_roles/{rbac_role_id}/permissions",queryParams:["limit","page"],attributes:{"anthropic.organization.rbac_role.id":i}})})}};var Hl=(()=>{class t extends f{constructor(){super(...arguments),this.permissions=new yn(this._client)}retrieve(e,r){return this._client.get(u`/v1/organizations/rbac_roles/${e}`,{...r,__span:c(this._client,"anthropic.organization.rbac_roles.retrieve",r,{route:"/v1/organizations/rbac_roles/{rbac_role_id}",attributes:{"anthropic.organization.rbac_role.id":e}})})}list(e={},r){return this._client.getAPIList("/v1/organizations/rbac_roles",v,{query:e,...r,__span:c(this._client,"anthropic.organization.rbac_roles.list",r,{route:"/v1/organizations/rbac_roles",queryParams:["limit","page"]})})}}return t.Permissions=yn,t})();var vn=class extends f{list(i,e={},r){return this._client.getAPIList(u`/v1/organizations/service_accounts/${i}/workspaces`,v,{query:e,...r,__span:c(this._client,"anthropic.organization.service_accounts.workspaces.list",r,{route:"/v1/organizations/service_accounts/{service_account_id}/workspaces",queryParams:["limit","page"],attributes:{"anthropic.organization.service_account.id":i}})})}add(i,e,r){return this._client.post(u`/v1/organizations/service_accounts/${i}/workspaces`,{body:e,...r,__span:c(this._client,"anthropic.organization.service_accounts.workspaces.add",r,{route:"/v1/organizations/service_accounts/{service_account_id}/workspaces",attributes:{"anthropic.organization.service_account.id":i},createdIDAttribute:"anthropic.organization.service_account.workspace.id",createdIDField:"workspace_id"})})}remove(i,e,r){let{service_account_id:n}=e;return this._client.delete(u`/v1/organizations/service_accounts/${n}/workspaces/${i}`,{...r,__span:c(this._client,"anthropic.organization.service_accounts.workspaces.remove",r,{route:"/v1/organizations/service_accounts/{service_account_id}/workspaces/{workspace_id}",attributes:{"anthropic.organization.service_account.id":n,"anthropic.organization.service_account.workspace.id":i}})})}};var Wl=(()=>{class t extends f{constructor(){super(...arguments),this.workspaces=new vn(this._client)}create(e,r){return this._client.post("/v1/organizations/service_accounts",{body:e,...r,__span:c(this._client,"anthropic.organization.service_accounts.create",r,{route:"/v1/organizations/service_accounts",createdIDAttribute:"anthropic.organization.service_account.id"})})}retrieve(e,r){return this._client.get(u`/v1/organizations/service_accounts/${e}`,{...r,__span:c(this._client,"anthropic.organization.service_accounts.retrieve",r,{route:"/v1/organizations/service_accounts/{service_account_id}",attributes:{"anthropic.organization.service_account.id":e}})})}update(e,r,n){return this._client.post(u`/v1/organizations/service_accounts/${e}`,{body:r,...n,__span:c(this._client,"anthropic.organization.service_accounts.update",n,{route:"/v1/organizations/service_accounts/{service_account_id}",attributes:{"anthropic.organization.service_account.id":e}})})}list(e={},r){return this._client.getAPIList("/v1/organizations/service_accounts",v,{query:e,...r,__span:c(this._client,"anthropic.organization.service_accounts.list",r,{route:"/v1/organizations/service_accounts",queryParams:["include_archived","limit","page"]})})}archive(e,r){return this._client.post(u`/v1/organizations/service_accounts/${e}/archive`,{...r,__span:c(this._client,"anthropic.organization.service_accounts.archive",r,{route:"/v1/organizations/service_accounts/{service_account_id}/archive",attributes:{"anthropic.organization.service_account.id":e}})})}}return t.Workspaces=vn,t})();var wn=class extends f{list(i={},e){return this._client.getAPIList("/v1/organizations/spend_limits/effective",v,{query:i,...e,__span:c(this._client,"anthropic.organization.spend_limits.effective.list",e,{route:"/v1/organizations/spend_limits/effective",queryParams:["limit","page","period","user_ids"]})})}};var En=class extends f{retrieve(i,e){return this._client.get(u`/v1/organizations/spend_limit_increase_requests/${i}`,{...e,__span:c(this._client,"anthropic.organization.spend_limits.increase_requests.retrieve",e,{route:"/v1/organizations/spend_limit_increase_requests/{spend_limit_increase_request_id}",attributes:{"anthropic.organization.spend_limit_increase_request.id":i}})})}list(i={},e){return this._client.getAPIList("/v1/organizations/spend_limit_increase_requests",v,{query:i,...e,__span:c(this._client,"anthropic.organization.spend_limits.increase_requests.list",e,{route:"/v1/organizations/spend_limit_increase_requests",queryParams:["actor_ids","limit","page","status"]})})}approve(i,e,r){return this._client.post(u`/v1/organizations/spend_limit_increase_requests/${i}/approve`,{body:e,...r,__span:c(this._client,"anthropic.organization.spend_limits.increase_requests.approve",r,{route:"/v1/organizations/spend_limit_increase_requests/{spend_limit_increase_request_id}/approve",attributes:{"anthropic.organization.spend_limit_increase_request.id":i}})})}deny(i,e,r){return this._client.post(u`/v1/organizations/spend_limit_increase_requests/${i}/deny`,{body:e,...r,__span:c(this._client,"anthropic.organization.spend_limits.increase_requests.deny",r,{route:"/v1/organizations/spend_limit_increase_requests/{spend_limit_increase_request_id}/deny",attributes:{"anthropic.organization.spend_limit_increase_request.id":i}})})}};var jl=(()=>{class t extends f{constructor(){super(...arguments),this.effective=new wn(this._client),this.increaseRequests=new En(this._client)}}return t.Effective=wn,t.IncreaseRequests=En,t})();var kn=class extends f{retrieve(i,e,r){let{workspace_id:n}=e;return this._client.get(u`/v1/organizations/workspaces/${n}/members/${i}`,{...r,__span:c(this._client,"anthropic.organization.workspaces.members.retrieve",r,{route:"/v1/organizations/workspaces/{workspace_id}/members/{user_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.member.id":i}})})}update(i,e,r){let{workspace_id:n,...s}=e;return this._client.post(u`/v1/organizations/workspaces/${n}/members/${i}`,{body:s,...r,__span:c(this._client,"anthropic.organization.workspaces.members.update",r,{route:"/v1/organizations/workspaces/{workspace_id}/members/{user_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.member.id":i}})})}list(i,e={},r){return this._client.getAPIList(u`/v1/organizations/workspaces/${i}/members`,F,{query:e,...r,__span:c(this._client,"anthropic.organization.workspaces.members.list",r,{route:"/v1/organizations/workspaces/{workspace_id}/members",queryParams:["after_id","before_id","limit"],attributes:{"anthropic.organization.workspace.id":i}})})}add(i,e,r){return this._client.post(u`/v1/organizations/workspaces/${i}/members`,{body:e,...r,__span:c(this._client,"anthropic.organization.workspaces.members.add",r,{route:"/v1/organizations/workspaces/{workspace_id}/members",attributes:{"anthropic.organization.workspace.id":i},createdIDAttribute:"anthropic.organization.workspace.member.id",createdIDField:"user_id"})})}remove(i,e,r){let{workspace_id:n}=e;return this._client.delete(u`/v1/organizations/workspaces/${n}/members/${i}`,{...r,__span:c(this._client,"anthropic.organization.workspaces.members.remove",r,{route:"/v1/organizations/workspaces/{workspace_id}/members/{user_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.member.id":i}})})}};var Sn=class extends f{update(i,e,r){let{workspace_id:n,...s}=e;return this._client.post(u`/v1/organizations/workspaces/${n}/rate_limits/${i}`,{body:s,...r,__span:c(this._client,"anthropic.organization.workspaces.rate_limits.update",r,{route:"/v1/organizations/workspaces/{workspace_id}/rate_limits/{rate_limit_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.rate_limit.id":i}})})}list(i,e={},r){return this._client.getAPIList(u`/v1/organizations/workspaces/${i}/rate_limits`,v,{query:e,...r,__span:c(this._client,"anthropic.organization.workspaces.rate_limits.list",r,{route:"/v1/organizations/workspaces/{workspace_id}/rate_limits",queryParams:["group_type","include_inherited","limit","page"],attributes:{"anthropic.organization.workspace.id":i}})})}};var An=class extends f{retrieve(i,e,r){let{workspace_id:n}=e;return this._client.get(u`/v1/organizations/workspaces/${n}/service_accounts/${i}`,{...r,__span:c(this._client,"anthropic.organization.workspaces.service_accounts.retrieve",r,{route:"/v1/organizations/workspaces/{workspace_id}/service_accounts/{service_account_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.service_account.id":i}})})}update(i,e,r){let{workspace_id:n,...s}=e;return this._client.post(u`/v1/organizations/workspaces/${n}/service_accounts/${i}`,{body:s,...r,__span:c(this._client,"anthropic.organization.workspaces.service_accounts.update",r,{route:"/v1/organizations/workspaces/{workspace_id}/service_accounts/{service_account_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.service_account.id":i}})})}list(i,e={},r){return this._client.getAPIList(u`/v1/organizations/workspaces/${i}/service_accounts`,v,{query:e,...r,__span:c(this._client,"anthropic.organization.workspaces.service_accounts.list",r,{route:"/v1/organizations/workspaces/{workspace_id}/service_accounts",queryParams:["limit","page"],attributes:{"anthropic.organization.workspace.id":i}})})}add(i,e,r){return this._client.post(u`/v1/organizations/workspaces/${i}/service_accounts`,{body:e,...r,__span:c(this._client,"anthropic.organization.workspaces.service_accounts.add",r,{route:"/v1/organizations/workspaces/{workspace_id}/service_accounts",attributes:{"anthropic.organization.workspace.id":i},createdIDAttribute:"anthropic.organization.workspace.service_account.id",createdIDField:"service_account_id"})})}remove(i,e,r){let{workspace_id:n}=e;return this._client.delete(u`/v1/organizations/workspaces/${n}/service_accounts/${i}`,{...r,__span:c(this._client,"anthropic.organization.workspaces.service_accounts.remove",r,{route:"/v1/organizations/workspaces/{workspace_id}/service_accounts/{service_account_id}",attributes:{"anthropic.organization.workspace.id":n,"anthropic.organization.workspace.service_account.id":i}})})}};z();var Do=(()=>{class t extends P{}return t._errorName="KeyProfileMismatchError",t})(),Go=(()=>{class t extends P{}return t._errorName="WorkspaceMemberLimitExceededError",t})(),Vo=(()=>{class t extends P{}return t._errorName="WorkspacePolicyViolationError",t})(),Kl=(()=>{class t extends f{constructor(){super(...arguments),this.rateLimits=new Sn(this._client),this.members=new kn(this._client),this.serviceAccounts=new An(this._client)}create(e,r){return this._client.post("/v1/organizations/workspaces",{body:e,...r,__span:c(this._client,"anthropic.organization.workspaces.create",r,{route:"/v1/organizations/workspaces",createdIDAttribute:"anthropic.organization.workspace.id"})})}retrieve(e,r){return this._client.get(u`/v1/organizations/workspaces/${e}`,{...r,__span:c(this._client,"anthropic.organization.workspaces.retrieve",r,{route:"/v1/organizations/workspaces/{workspace_id}",attributes:{"anthropic.organization.workspace.id":e}})})}update(e,r,n){return this._client.post(u`/v1/organizations/workspaces/${e}`,{body:r,...n,__span:c(this._client,"anthropic.organization.workspaces.update",n,{route:"/v1/organizations/workspaces/{workspace_id}",attributes:{"anthropic.organization.workspace.id":e}})})}list(e={},r){return this._client.getAPIList("/v1/organizations/workspaces",F,{query:e,...r,__span:c(this._client,"anthropic.organization.workspaces.list",r,{route:"/v1/organizations/workspaces",queryParams:["after_id","before_id","ids","include_archived","include_default","limit"]})})}archive(e,r){return this._client.post(u`/v1/organizations/workspaces/${e}/archive`,{...r,__span:c(this._client,"anthropic.organization.workspaces.archive",r,{route:"/v1/organizations/workspaces/{workspace_id}/archive",attributes:{"anthropic.organization.workspace.id":e}})})}}return t.KeyProfileMismatchError=Do,t.WorkspaceMemberLimitExceededError=Go,t.WorkspacePolicyViolationError=Vo,t.RateLimits=Sn,t.Members=kn,t.ServiceAccounts=An,t})();z();var xn=(()=>{class t extends P{}return t._errorName="OrgMemberLimitExceededError",t})(),Pn=(()=>{class t extends ae{}return t._errorName="RBACRoleNotFoundError",t})(),Tn=(()=>{class t extends pe{}return t._errorName="ConcurrentMembershipChangeError",t})(),Jo=(()=>{class t extends f{constructor(){super(...arguments),this.apiKeys=new zl(this._client),this.externalKeys=new Nl(this._client),this.federation=new Fl(this._client),this.invites=new Ol(this._client),this.serviceAccounts=new Wl(this._client),this.users=new Ml(this._client),this.workspaces=new Kl(this._client),this.rateLimits=new cn(this._client),this.complianceSettings=new an(this._client),this.analytics=new Ll(this._client),this.spendLimits=new jl(this._client),this.rbacGroups=new Ul(this._client),this.rbacRoles=new Hl(this._client)}retrieve(e){return this._client.get("/v1/organizations/me",{...e,__span:c(this._client,"anthropic.organization.retrieve",e,{route:"/v1/organizations/me"})})}}return t.OrgMemberLimitExceededError=xn,t.RBACRoleNotFoundError=Pn,t.ConcurrentMembershipChangeError=Tn,t.APIKeys=zl,t.OrgAPIKeyLimitExceededError=No,t.WorkspaceAPIKeyLimitExceededError=Oo,t.ExternalKeys=Nl,t.ExternalKeyInWorkspacePolicyError=Mo,t.ExternalKeyValidationFailedError=Bo,t.ExternalKeyValidationTimedOutError=qo,t.ExternalKeyChangedError=Lo,t.Federation=Fl,t.Invites=Ol,t.AlreadyMemberError=$o,t.CannotInviteEmailsWithUnverifiedDomainsError=Fo,t.EmailDomainNotAllowedError=Uo,t.InviteAlreadyExistsError=Ho,t.ServiceAccounts=Wl,t.Users=Ml,t.CannotRemoveLastMemberError=Wo,t.Workspaces=Kl,t.KeyProfileMismatchError=Do,t.WorkspaceMemberLimitExceededError=Go,t.WorkspacePolicyViolationError=Vo,t.RateLimits=cn,t.ComplianceSettings=an,t.Analytics=Ll,t.SpendLimits=jl,t.RBACGroups=Ul,t.RBACGroupGrantsOwnerAccessError=jo,t.RBACGroupOwnerAccessUnconfirmedError=Ko,t.RBACRoles=Hl,t})();var Rn=class extends f{create(i,e,r){let{workspace_id:n,...s}=e;return this._client.post(u`/v1/skills/${i}/versions`,ne({body:s,...r,headers:d([{...n!=null?{"anthropic-workspace-id":n}:void 0},r?.headers]),__span:c(this._client,"anthropic.skills.versions.create",r,{route:"/v1/skills/{skill_id}/versions",attributes:{"anthropic.skill.id":i},createdIDAttribute:"anthropic.skill.version.id"})},this._client,!1))}retrieve(i,e,r){let{skill_id:n,workspace_id:s}=e;return this._client.get(u`/v1/skills/${n}/versions/${i}`,{...r,headers:d([{...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__span:c(this._client,"anthropic.skills.versions.retrieve",r,{route:"/v1/skills/{skill_id}/versions/{version}",attributes:{"anthropic.skill.id":n,"anthropic.skill.version.id":i}})})}list(i,e={},r){let{workspace_id:n,...s}=e??{};return this._client.getAPIList(u`/v1/skills/${i}/versions`,v,{query:s,...r,headers:d([{...n!=null?{"anthropic-workspace-id":n}:void 0},r?.headers]),__span:c(this._client,"anthropic.skills.versions.list",r,{route:"/v1/skills/{skill_id}/versions",queryParams:["limit","page"],attributes:{"anthropic.skill.id":i}})})}delete(i,e,r){let{skill_id:n,workspace_id:s}=e;return this._client.delete(u`/v1/skills/${n}/versions/${i}`,{...r,headers:d([{...s!=null?{"anthropic-workspace-id":s}:void 0},r?.headers]),__span:c(this._client,"anthropic.skills.versions.delete",r,{route:"/v1/skills/{skill_id}/versions/{version}",attributes:{"anthropic.skill.id":n,"anthropic.skill.version.id":i}})})}};z();var Cn=(()=>{class t extends pe{}return t._errorName="SkillReadBlockedUndecryptableError",t})(),Yo=(()=>{class t extends f{constructor(){super(...arguments),this.versions=new Rn(this._client)}create(e,r){let{workspace_id:n,...s}=e;return this._client.post("/v1/skills",ne({body:s,...r,headers:d([{...n!=null?{"anthropic-workspace-id":n}:void 0},r?.headers]),__span:c(this._client,"anthropic.skills.create",r,{route:"/v1/skills",createdIDAttribute:"anthropic.skill.id"})},this._client,!1))}retrieve(e,r={},n){let{workspace_id:s}=r??{};return this._client.get(u`/v1/skills/${e}`,{...n,headers:d([{...s!=null?{"anthropic-workspace-id":s}:void 0},n?.headers]),__span:c(this._client,"anthropic.skills.retrieve",n,{route:"/v1/skills/{skill_id}",attributes:{"anthropic.skill.id":e}})})}list(e={},r){let{workspace_id:n,...s}=e??{};return this._client.getAPIList("/v1/skills",v,{query:s,...r,headers:d([{...n!=null?{"anthropic-workspace-id":n}:void 0},r?.headers]),__span:c(this._client,"anthropic.skills.list",r,{route:"/v1/skills",queryParams:["limit","page","source"]})})}delete(e,r={},n){let{workspace_id:s}=r??{};return this._client.delete(u`/v1/skills/${e}`,{...n,headers:d([{...s!=null?{"anthropic-workspace-id":s}:void 0},n?.headers]),__span:c(this._client,"anthropic.skills.delete",n,{route:"/v1/skills/{skill_id}",attributes:{"anthropic.skill.id":e}})})}}return t.SkillReadBlockedUndecryptableError=Cn,t.Versions=Rn,t})();var In=class extends f{create(i,e,r){let{workspace_id:n,...s}=e;return this._client.post(u`/v1/user_profiles/${i}/action_urls`,{body:s,...r,headers:d([{...n!=null?{"anthropic-workspace-id":n}:void 0},r?.headers]),__span:c(this._client,"anthropic.user_profiles.action_urls.create",r,{route:"/v1/user_profiles/{user_profile_id}/action_urls",attributes:{"anthropic.user_profile.id":i}})})}};z();var zn=(()=>{class t extends P{}return t._errorName="UserProfileNotFoundError",t})(),Nn=(()=>{class t extends P{}return t._errorName="UserProfileRequiredError",t})(),On=(()=>{class t extends D{}return t._errorName="UserProfileBillingNotAuthorizedError",t})(),Mn=(()=>{class t extends D{}return t._errorName="UserProfileNotBillableError",t})(),Qo=(()=>{class t extends f{constructor(){super(...arguments),this.actionURLs=new In(this._client)}create(e,r){let{workspace_id:n,...s}=e;return this._client.post("/v1/user_profiles",{body:s,...r,headers:d([{...n!=null?{"anthropic-workspace-id":n}:void 0},r?.headers]),__span:c(this._client,"anthropic.user_profiles.create",r,{route:"/v1/user_profiles",createdIDAttribute:"anthropic.user_profile.id"})})}retrieve(e,r={},n){let{workspace_id:s}=r??{};return this._client.get(u`/v1/user_profiles/${e}`,{...n,headers:d([{...s!=null?{"anthropic-workspace-id":s}:void 0},n?.headers]),__span:c(this._client,"anthropic.user_profiles.retrieve",n,{route:"/v1/user_profiles/{user_profile_id}",attributes:{"anthropic.user_profile.id":e}})})}update(e,r,n){let{workspace_id:s,...o}=r;return this._client.post(u`/v1/user_profiles/${e}`,{body:o,...n,headers:d([{...s!=null?{"anthropic-workspace-id":s}:void 0},n?.headers]),__span:c(this._client,"anthropic.user_profiles.update",n,{route:"/v1/user_profiles/{user_profile_id}",attributes:{"anthropic.user_profile.id":e}})})}list(e={},r){let{workspace_id:n,...s}=e??{};return this._client.getAPIList("/v1/user_profiles",v,{query:s,...r,headers:d([{...n!=null?{"anthropic-workspace-id":n}:void 0},r?.headers]),__span:c(this._client,"anthropic.user_profiles.list",r,{route:"/v1/user_profiles",queryParams:["enforcement_status","limit","order","order_by","page"]})})}delete(e,r={},n){let{workspace_id:s}=r??{};return this._client.delete(u`/v1/user_profiles/${e}`,{...n,headers:d([{...s!=null?{"anthropic-workspace-id":s}:void 0},n?.headers]),__span:c(this._client,"anthropic.user_profiles.delete",n,{route:"/v1/user_profiles/{user_profile_id}",attributes:{"anthropic.user_profile.id":e}})})}}return t.UserProfileNotFoundError=zn,t.UserProfileRequiredError=Nn,t.UserProfileBillingNotAuthorizedError=On,t.UserProfileNotBillableError=Mn,t.ActionURLs=In,t})();var pf=new Map([["400 already_member",$o],["400 available_tools_limit_exceeded",Wi],["400 bundle_attachment_not_supported",Hs],["400 bundle_on_call",Ws],["400 cannot_invite_emails_with_unverified_domains",Fo],["400 cannot_remove_last_member",Wo],["400 cannot_sign_out_primary_owner",Qs],["400 cannot_sign_out_self",Xs],["400 claude_code_key_creator_not_member",Ba],["400 claude_code_version_too_old",qa],["400 cmek_feature_unsupported",uo],["400 cmek_key_disabled",La],["400 cmek_key_network_blocked",$a],["400 compaction_block_ambiguous",ji],["400 compaction_block_misplaced",Ki],["400 compaction_content_mismatch",Di],["400 compaction_incomplete_turn",Gi],["400 compaction_nothing_to_summarize",Vi],["400 compaction_signature_invalid",Ji],["400 compaction_too_many_tool_references",Yi],["400 compaction_tool_changes_mismatch",Qi],["400 email_domain_not_allowed",Uo],["400 environment_archived",As],["400 external_key_in_workspace_policy",Mo],["400 external_key_validation_failed",Bo],["400 external_key_validation_timed_out",qo],["400 file_not_downloadable",ur],["400 invalid_config_type_change",xs],["400 invalid_metadata",Ps],["400 invite_already_exists",Ho],["400 key_profile_mismatch",Do],["400 org_api_key_limit_exceeded",No],["400 org_member_limit_exceeded",xn],["400 organization_not_enrolled_in_beta",$i],["400 organization_on_hold",Fa],["400 organization_type_not_supported",Ua],["400 parent_organization_required",Ha],["400 rbac_group_grants_owner_access",jo],["400 rbac_group_order_limit_exceeded",po],["400 rbac_group_owner_access_unconfirmed",Ko],["400 request_body_encoding_invalid",Wa],["400 request_body_encoding_unsupported",ja],["400 request_body_timeout",Fi],["400 scan_failed",no],["400 settings_document_limit_exceeded",ho],["400 settings_history_limit_exceeded",_o],["400 slack_channel_set_up_settings_refused",js],["400 storage_quota_exceeded",dr],["400 thread_already_continued",Xi],["400 thread_continue_in_flight",Zi],["400 thread_fingerprint_mismatch",en],["400 thread_unsupported_request",tn],["400 tool_name_conflict",rn],["400 tool_reference_unresolved",nn],["400 unsupported_charset",Ui],["400 user_profile_not_found",zn],["400 user_profile_required",Nn],["400 workspace_api_key_limit_exceeded",Oo],["400 workspace_member_limit_exceeded",Go],["400 workspace_policy_violation",Vo],["402 linked_organization_billing_unavailable",Ka],["402 linked_organization_spend_limit_reached",Da],["403 api_key_scope_missing",Ks],["403 cannot_sign_out_managed_member",Zs],["403 cannot_sign_out_membership_admin",eo],["403 cannot_sign_out_owner",to],["403 cannot_sign_out_privileged_member",ro],["403 claude_tag_writes_not_enabled",Ds],["403 compliance_configuration_restricted",Gs],["403 environment_create_disabled",Ts],["403 environment_update_disabled",Rs],["403 organization_level_scoped_api_key_required",Vs],["403 sandbox_egress_restricted",Ga],["403 spend_limits_admin_api_writes_not_enabled",lo],["403 user_profile_billing_not_authorized",On],["403 user_profile_not_billable",Mn],["404 environment_not_found",Cs],["404 file_expired",pr],["404 rbac_group_managed_settings_not_found",fo],["404 rbac_group_not_found",io],["404 rbac_role_not_found",Pn],["404 slack_channel_set_up_environment_not_found",Js],["404 thread_not_found",sn],["409 concurrent_membership_change",Tn],["409 external_key_changed",Lo],["409 plugin_name_taken",so],["409 scan_pending",oo],["409 skill_name_taken",ao],["409 skill_read_blocked_undecryptable",Cn],["409 slack_channel_set_up_settings_conflict",Ys],["412 heartbeat_precondition_failed",Ss],["413 request_body_too_large_after_decoding",Va],["429 contract_spend_limit_reached",Ja],["429 enforced_spend_limit_reached",Ya],["429 ramp_limit_exceeded",Qa],["503 cmek_context_unavailable",Xa],["503 cmek_key_unreachable",Za],["503 registration_pending",co],["529 compaction_unavailable",on]]);z();z();var _f="urn:ietf:params:oauth:grant-type:jwt-bearer",ff="refresh_token",Dl="/v1/oauth/token",Xt="oauth-2025-04-20",mf="oidc-federation-2026-04-01",gf=120,Bn=30,bf=5,hf=1<<20;function Gl(t){if(!t)return;let i;try{i=new URL(t)}catch(r){throw new j(`Invalid token endpoint base URL "${t}": ${r}`)}if(i.protocol==="https:")return;let e=i.hostname.toLowerCase().replace(/^\[|\]$/g,"");if(!(i.protocol==="http:"&&(e==="localhost"||e==="127.0.0.1"||e==="::1")))throw new j(`Refusing to send credential over non-https token endpoint "${t}"`)}async function Vl(t,i){let e=await ow(t),r;try{r=JSON.parse(e)}catch{throw new j(`Token endpoint returned non-JSON response (status ${t.status})`,t.status,ve(e),i)}if(!r.access_token)throw new j(`Token endpoint response missing access_token: ${JSON.stringify(ve(r))}`,t.status,ve(r),i);if(r.token_type&&r.token_type.toLowerCase()!=="bearer")throw new j(`Token endpoint response: unsupported token_type "${r.token_type}" (want Bearer)`,t.status,ve(r),i);return r}var Wd=2e3,sw=new Set(["error","error_description","error_uri"]);function ve(t){if(t==null)return t;if(typeof t=="string"){let i;try{i=JSON.parse(t)}catch{return t.length<=Wd?t:t.slice(0,Wd)+`... <${t.length-Wd} more chars>`}return JSON.stringify(ve(i))}if(typeof t=="object"&&!Array.isArray(t)){let i={};for(let[e,r]of Object.entries(t))sw.has(e)&&(i[e]=r);return i}return null}async function Jl(t,i=e=>console.warn(`anthropic-sdk: ${e}`)){if(typeof process>"u"||process.platform==="win32")return;let{fs:e}=await Promise.resolve().then(()=>(tt(),et)),r=t,n;try{r=await e.promises.realpath(t),n=await e.promises.stat(r)}catch{return}let s=n.mode&511;if(s&18)throw new j(`Credentials file at ${r} is group/world-writable (mode 0o${s.toString(8)}); this allows other local users to plant tokens. Run \`chmod 600 ${r}\`.`);if(s&36)throw new j(`Credentials file at ${r} is group/world-readable (mode 0o${s.toString(8)}); run \`chmod 600 ${r}\` before retrying.`);typeof process.getuid=="function"&&n.uid!==process.getuid()&&i(`credentials file at ${r} is owned by uid ${n.uid} (current process uid ${process.getuid()}); verify this is intentional.`)}async function Yl(t,i){let{fs:e,path:r}=await Promise.resolve().then(()=>(tt(),et)),n=r.dirname(t);await e.promises.mkdir(n,{recursive:!0,mode:448});let s=`${t}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;try{let o=await e.promises.open(s,"w",384);try{await o.writeFile(JSON.stringify(i,null,2)),await o.sync()}finally{await o.close()}await e.promises.rename(s,t)}catch(o){throw await e.promises.unlink(s).catch(()=>{}),o}try{let o=await e.promises.open(n,"r");try{await o.sync()}finally{await o.close()}}catch{}}async function ow(t){if(!t.body)return"";let i=t.body.getReader(),e=[],r=0;for(;;){let{done:s,value:o}=await i.read();if(s)break;if(r+o.length>hf){let l=hf-r;l>0&&e.push(o.subarray(0,l)),await i.cancel();break}e.push(o),r+=o.length}let n;if(e.length===1)n=e[0];else{n=new Uint8Array(e.reduce((o,l)=>o+l.length,0));let s=0;for(let o of e)n.set(o,s),s+=o.length}return new TextDecoder("utf-8").decode(n)}var j=(()=>{class t extends E{constructor(e,r=null,n=null,s=null){super(e),this.statusCode=r,this.body=n,this.requestId=s}}return t._errorName="WorkloadIdentityError",t})();function Ue(){return Math.floor(Date.now()/1e3)}var Ql=class{constructor(i,e){this.cached=null,this.pendingRefresh=null,this.nextForce=!1,this.lastAdvisoryError=0,this.provider=i,this.onAdvisoryRefreshError=e}async getToken(){let i=this.nextForce;this.nextForce=!1;let e=this.cached;if(i||e==null)return(await this.refresh(i)).token;if(e.expiresAt==null)return e.token;let r=e.expiresAt-Ue();return r>gf?e.token:r>Bn?(this.backgroundRefresh(),e.token):(await this.refresh()).token}invalidate(){this.cached=null,this.nextForce=!0}refresh(i=!1){return this.pendingRefresh&&!i?this.pendingRefresh:this.doRefresh(i)}backgroundRefresh(){this.pendingRefresh||Ue()-this.lastAdvisoryError<bf||this.doRefresh().catch(i=>{this.lastAdvisoryError=Ue(),this.onAdvisoryRefreshError?.(i)})}doRefresh(i=!1){return this.pendingRefresh=this.provider(i?{forceRefresh:!0}:void 0).then(e=>(this.cached=e,this.pendingRefresh=null,e),e=>{throw this.pendingRefresh=null,e}),this.pendingRefresh}};z();var Xl="1.0",aw=/^[A-Za-z0-9_.-]+$/;function yf(t){if(!t)throw new Error("profile name is empty");if(t==="."||t==="..")throw new Error(`profile name "${t}" is not allowed`);if(t.includes("/")||t.includes("\\"))throw new Error(`profile name "${t}" must not contain path separators`);if(!aw.test(t))throw new Error(`profile name "${t}" contains disallowed characters (allowed: letters, digits, '_', '.', '-')`)}var vf=async t=>{var i,e;let r=await jd();if(r===null)return null;let n=t==null&&N("ANTHROPIC_PROFILE")!=null,s=null;if(t==null&&!n){let y=N("ANTHROPIC_ORGANIZATION_ID"),w=N("ANTHROPIC_IDENTITY_TOKEN_FILE"),k=N("ANTHROPIC_FEDERATION_RULE_ID");if(k&&y&&(s={fromFile:!1,config:{organization_id:y,workspace_id:N("ANTHROPIC_WORKSPACE_ID"),base_url:N("ANTHROPIC_BASE_URL"),authentication:{type:"oidc_federation",federation_rule_id:k,service_account_id:N("ANTHROPIC_SERVICE_ACCOUNT_ID"),identity_token:w?{source:"file",path:w}:void 0,scope:N("ANTHROPIC_SCOPE")}}},w||N("ANTHROPIC_IDENTITY_TOKEN")))return s}let o=t??await Ef();if(o===null)return null;yf(o);let{fs:l,path:p}=await Promise.resolve().then(()=>(tt(),et)),_=p.join(r,"configs",`${o}.json`),m;try{m=await l.promises.readFile(_,"utf-8")}catch(y){if(y?.code!=="ENOENT")throw new Error(`failed to read config file ${_}: ${y}`);if(n)throw new E(`ANTHROPIC_PROFILE names the profile "${o}", but ${_} does not exist. Set ANTHROPIC_PROFILE to a profile that exists, or unset it.`,{cause:y});return s}let h;try{h=JSON.parse(m)}catch(y){throw new Error(`failed to parse config file ${_}: ${y}`)}if(!h.authentication)throw new Error(`config file ${_} is missing "authentication"`);let g=h.authentication.type;if(g!=="oidc_federation"&&g!=="user_oauth")throw new Error(`authentication.type "${g}" is not a known authentication type`);if(h.organization_id??(h.organization_id=N("ANTHROPIC_ORGANIZATION_ID")),h.workspace_id??(h.workspace_id=N("ANTHROPIC_WORKSPACE_ID")),h.base_url??(h.base_url=N("ANTHROPIC_BASE_URL")),(i=h.authentication).scope??(i.scope=N("ANTHROPIC_SCOPE")),h.authentication.type==="oidc_federation"){if(!h.authentication.identity_token){let y=N("ANTHROPIC_IDENTITY_TOKEN_FILE");y&&(h.authentication.identity_token={source:"file",path:y})}h.authentication.federation_rule_id||(h.authentication.federation_rule_id=N("ANTHROPIC_FEDERATION_RULE_ID")??""),(e=h.authentication).service_account_id??(e.service_account_id=N("ANTHROPIC_SERVICE_ACCOUNT_ID"))}return{config:h,fromFile:!0}};var wf=async(t,i)=>{if(t?.authentication.credentials_path)return t.authentication.credentials_path;let e=await jd();if(!e)return null;let r=i??await Ef();if(!r)return null;yf(r);let{path:n}=await Promise.resolve().then(()=>(tt(),et));return n.join(e,"credentials",`${r}.json`)},jd=async()=>{if(!cw())return null;let{path:t}=await Promise.resolve().then(()=>(tt(),et)),i=N("ANTHROPIC_CONFIG_DIR");if(i)return i;if(jn()["X-Stainless-OS"]==="Windows"){let s=N("APPDATA");if(s)return t.join(s,"Anthropic");let o=N("USERPROFILE");return o?t.join(o,"AppData","Roaming","Anthropic"):null}let r=N("XDG_CONFIG_HOME");if(r)return t.join(r,"anthropic");let n=N("HOME");return n?t.join(n,".config","anthropic"):null},cw=()=>{let t=jn()["X-Stainless-Runtime"];return t==="node"||t==="deno"},Ef=async()=>{let t=await jd();if(!t)return null;let i=N("ANTHROPIC_PROFILE");if(i)return i;let{fs:e,path:r}=await Promise.resolve().then(()=>(tt(),et)),n=r.join(t,"active_config");try{return(await e.promises.readFile(n,"utf-8")).trim()||"default"}catch(s){if(s?.code!=="ENOENT")throw new Error(`failed to read ${n}: ${s}`);return"default"}};z();function Kd(t){if(!t)throw new E("Identity token file path is empty");return async()=>{let{fs:i}=await Promise.resolve().then(()=>(tt(),et)),e;try{e=await i.promises.readFile(t,"utf-8")}catch(n){throw new E(`Failed to read identity token file at ${t}: ${n}`)}let r=e.trim();if(!r)throw new E(`Identity token file at ${t} is empty`);return r}}function kf(t){if(!t)throw new E("Identity token value is empty");return()=>t}function Sf(t){return async()=>{Gl(t.baseURL);let i=await t.identityTokenProvider();if(i.length>16*1024)throw new j(`Identity token is ${Math.ceil(i.length/1024)} KiB, exceeds the 16 KiB assertion limit`);let e={grant_type:_f,assertion:i,federation_rule_id:t.federationRuleId,organization_id:t.organizationId};t.serviceAccountId&&(e.service_account_id=t.serviceAccountId),t.workspaceId&&(e.workspace_id=t.workspaceId);let r=`${t.baseURL}${Dl}`,n;try{n=await t.fetch(r,{method:"POST",redirect:"manual",headers:{"Content-Type":"application/json","anthropic-beta":`${Xt},${mf}`,"User-Agent":t.userAgent||`anthropic-sdk-typescript/${Ee} oidcFederationProvider`},body:JSON.stringify(e)})}catch(p){throw new j(`Failed to reach token endpoint ${r}: ${p}`)}let s=n.headers.get("Request-Id");if(!n.ok){let p=await n.text().catch(()=>""),_=ve(p),m="";throw n.status===401&&(m=` Ensure your federation rule matches your identity token. ${t.workspaceId?"":"If your federation rule is scoped to multiple workspaces, set the ANTHROPIC_WORKSPACE_ID environment variable, the 'workspace_id' config key, or the `workspaceId` option. "}View your authentication events in the Workload identity page of Claude Console for more details.`),new j(`Token exchange failed with status ${n.status}${s?` (request-id ${s})`:""}: ${_}${m}`,n.status,_,s)}let o=await Vl(n,s),l=Number(o.expires_in);if(!Number.isFinite(l))throw new j(`Token endpoint response missing required fields: ${JSON.stringify(ve(o))}`,n.status,ve(o),s);return{token:o.access_token,expiresAt:Ue()+l}}}function Af(t){return async i=>{let{fs:e}=await Promise.resolve().then(()=>(tt(),et));await Jl(t.credentialsPath,t.onSafetyWarning);let r;try{r=await e.promises.readFile(t.credentialsPath,"utf-8")}catch(S){throw new j(`Credentials file not found at ${t.credentialsPath}: ${S}`)}let n;try{n=JSON.parse(r)}catch(S){throw new j(`Credentials file at ${t.credentialsPath} is not valid JSON: ${S}`)}let s=n.access_token;if(!s)throw new j(`Credentials file at ${t.credentialsPath} must include 'access_token'`);let o=n.expires_at;if(!i?.forceRefresh&&(o==null||Ue()<o-Bn))return{token:s,expiresAt:o??null};let l=n.refresh_token;if(!t.clientId||!l)throw new j(`Access token at ${t.credentialsPath} has expired and no refresh is available (client_id ${t.clientId?"set":"empty"}, refresh_token ${l?"set":"empty"})`);Gl(t.baseURL);let p={grant_type:ff,refresh_token:l,client_id:t.clientId},_=`${t.baseURL}${Dl}`,m;try{m=await t.fetch(_,{method:"POST",redirect:"manual",headers:{"Content-Type":"application/json","anthropic-beta":Xt,"User-Agent":t.userAgent||`anthropic-sdk-typescript/${Ee} userOAuthProvider`},body:JSON.stringify(p)})}catch(S){throw new j(`User OAuth refresh failed to reach token endpoint: ${S}`)}let h=m.headers.get("Request-Id");if(!m.ok){let S=await m.text().catch(()=>"");throw new j(`User OAuth refresh failed (HTTP ${m.status}): ${ve(S)}`,m.status,ve(S),h)}let g=await Vl(m,h),y=Number(g.expires_in);if(!Number.isFinite(y))throw new j(`User OAuth refresh response missing or invalid expires_in: ${JSON.stringify(ve(g))}`,m.status,ve(g),h);let w=Ue()+y,k=g.refresh_token||l;return await Yl(t.credentialsPath,{...n,version:Xl,type:"oauth_token",access_token:g.access_token,expires_at:w,refresh_token:k}),{token:g.access_token,expiresAt:w}}}function Dd(t,i){let e=t.authentication.credentials_path??null,r=(t.base_url||i.baseURL).replace(/\/+$/,""),n=lw(t,e,r,i),s={};return t.workspace_id&&t.authentication.type==="user_oauth"&&(s["anthropic-workspace-id"]=t.workspace_id),{provider:n,extraHeaders:s,baseURL:t.base_url||void 0}}async function xf(t,i){let e=await vf(i);if(!e)return null;let{config:r,fromFile:n}=e,s=r.authentication.credentials_path||!n?r:{...r,authentication:{...r.authentication,credentials_path:await wf(r,i)??void 0}};return Dd(s,t)}function lw(t,i,e,r){switch(t.authentication.type){case"oidc_federation":{let n=t.authentication,s=uw(n);if(!s)throw new j("oidc_federation config requires an identity token (set authentication.identity_token, ANTHROPIC_IDENTITY_TOKEN_FILE, or ANTHROPIC_IDENTITY_TOKEN)");if(!n.federation_rule_id)throw new j("oidc_federation config requires 'federation_rule_id'. Set it in authentication.federation_rule_id in your profile, or via ANTHROPIC_FEDERATION_RULE_ID (profile takes precedence).");if(!t.organization_id)throw new j("oidc_federation config requires organization_id (set ANTHROPIC_ORGANIZATION_ID or config.organization_id)");let o=Sf({identityTokenProvider:s,federationRuleId:n.federation_rule_id,organizationId:t.organization_id,serviceAccountId:n.service_account_id,workspaceId:t.workspace_id,baseURL:e,fetch:r.fetch,userAgent:r.userAgent});return i?dw(o,i,r.onCacheWriteError,r.onSafetyWarning):o}case"user_oauth":{if(!i)throw new j("user_oauth config requires authentication.credentials_path (or load via a profile so it defaults to <config_dir>/credentials/<profile>.json)");return Af({credentialsPath:i,clientId:t.authentication.client_id,baseURL:e,fetch:r.fetch,userAgent:r.userAgent,onSafetyWarning:r.onSafetyWarning})}default:{let n=t.authentication.type;throw new j(`authentication.type "${n}" is not a known authentication type`)}}}function uw(t){if(t.identity_token){let r=t.identity_token.source;if(r!=="file")throw new j(`identity_token.source "${r}" is not supported by this SDK version (only "file")`);if(!t.identity_token.path)throw new j('identity_token.source "file" requires a non-empty path');return Kd(t.identity_token.path)}let i=N("ANTHROPIC_IDENTITY_TOKEN_FILE");if(i)return Kd(i);let e=N("ANTHROPIC_IDENTITY_TOKEN");return e?kf(e):null}function dw(t,i,e,r){return async n=>{let{fs:s}=await Promise.resolve().then(()=>(tt(),et));await Jl(i,r);let o;try{let p=await s.promises.readFile(i,"utf-8");o=JSON.parse(p);let _=o?.access_token;if(_&&!n?.forceRefresh){let m=o?.expires_at;if(m==null||Ue()<m-Bn)return{token:_,expiresAt:m??null}}}catch(p){p?.code!=="ENOENT"&&!(p instanceof SyntaxError)&&e?.(p)}let l=await t(n);try{await Yl(i,{...o??{},version:Xl,type:"oauth_token",access_token:l.token,expires_at:l.expiresAt})}catch(p){e?.(p)}return l}}pt();z();var Tf=new WeakSet;function Gd(t){return typeof t=="object"&&t!==null&&Tf.has(t)}function Rf(t){let i=new Set;for(;typeof t=="object"&&t!==null&&!i.has(t);){if(i.add(t),Gd(t)||we(t)||t instanceof rt||t instanceof sp)return!0;t=t.cause}return!1}function Vd(t,i,e,r){return async(n,s={})=>{if(i.length===0)return t.call(void 0,n,s);let o=s.headers instanceof Headers?s.headers:new Headers(s.headers),l=await hw(t,i,e,r)({...s,headers:o,url:typeof n=="string"?n:n instanceof URL?n.href:n.url});if(l.bodyUsed||l.body?.locked)throw new E("middleware consumed the response body; use response.clone() to inspect it, or return new Response(body, response) to consume and replace it");return l}}function pw(t,i){let e=new WeakMap;return{options:t,logger:i?I(i):ma(),parse(r){if(t?.stream&&r.ok)return Pf(r,t,i);let n=e.get(r);return n||(n=Pf(r,t,i),e.set(r,n)),n}}}async function Pf(t,i,e){if(t.bodyUsed||t.body?.locked)throw new E("cannot ctx.parse() a response whose body was already consumed; call ctx.parse() instead of reading the body, or read via response.clone()");if(i?.stream&&t.ok)return ue.fromSSEResponse(t.clone(),new AbortController,e);if(t.status===204)return null;if(i?.__binaryResponse)return t;let n=t.headers.get("content-type")?.split(";")[0]?.trim();return n?.includes("application/json")||n?.endsWith("+json")?t.headers.get("content-length")==="0"?void 0:qt(await t.clone().json(),t):await t.clone().text()}function hw(t,i,e,r){let n=async({url:o,...l})=>{try{return await t.call(void 0,o,l)}catch(p){let _=dt(p);throw Tf.add(_),_}},s=pw(e,r);for(let o=i.length-1;o>=0;o--){let l=i[o],p=n;n=async _=>l(_,p,s)}return n}var Cf=t=>t!=null&&typeof t=="object"&&typeof t.size=="number"&&typeof t.type=="string"&&typeof t.text=="function"&&typeof t.slice=="function"&&typeof t.arrayBuffer=="function",_w=t=>t!=null&&typeof t=="object"&&typeof t.name=="string"&&typeof t.lastModified=="number"&&Cf(t),fw=t=>t!=null&&typeof t=="object"&&typeof t.url=="string"&&typeof t.blob=="function";async function Yd(t,i,e){if(Nu(),t=await t,i||(i=t instanceof File?t.name:ts(t,!0)),_w(t))return t instanceof File&&i==null&&e==null?t:Lt([await t.arrayBuffer()],i??t.name,{type:t.type,lastModified:t.lastModified,...e});if(fw(t)){let n=await t.blob();return i||(i=new URL(t.url).pathname.split(/[\\/]/).pop()),Lt(await Jd(n),i,e)}let r=await Jd(t);if(!e?.type){let n=r.find(s=>typeof s=="object"&&"type"in s&&s.type);typeof n=="string"&&(e={...e,type:n})}return Lt(r,i,e)}async function Jd(t){let i=[];if(typeof t=="string"||ArrayBuffer.isView(t)||t instanceof ArrayBuffer)i.push(t);else if(Cf(t))i.push(t instanceof Blob?t:await t.arrayBuffer());else if(rs(t))for await(let e of t)i.push(...await Jd(e));else{let e=t?.constructor?.name;throw new Error(`Unexpected data type: ${typeof t}${e?`; constructor: ${e}`:""}${mw(t)}`)}return i}function mw(t){return typeof t!="object"||t===null?"":`; props: [${Object.getOwnPropertyNames(t).map(e=>`"${e}"`).join(", ")}]`}var Zt=class extends f{retrieve(i,e={},r){let{workspace_id:n}=e??{};return this._client.get(u`/v1/models/${i}`,{...r,headers:d([{...n!=null?{"anthropic-workspace-id":n}:void 0},r?.headers]),__span:c(this._client,"anthropic.models.retrieve",r,{route:"/v1/models/{model_id}",attributes:{"anthropic.model.id":i}})})}list(i={},e){let{workspace_id:r,...n}=i??{};return this._client.getAPIList("/v1/models",F,{query:n,...e,headers:d([{...r!=null?{"anthropic-workspace-id":r}:void 0},e?.headers]),__span:c(this._client,"anthropic.models.list",e,{route:"/v1/models",queryParams:["after_id","before_id","lifecycle","limit"]})})}};var Qd,Xd,Zl,qn,er,If,zf=!1,yw=(()=>{class t{get credentials(){return this._authState.provider}get openTelemetry(){return a(this,er,"f")}_instrumentationScope(){return{version:Ee}}constructor({baseURL:e=N("ANTHROPIC_BASE_URL"),apiKey:r,authToken:n,webhookKey:s=N("ANTHROPIC_WEBHOOK_SIGNING_KEY")??null,...o}={}){Qd.add(this),this._requestAuthFlags=new WeakMap,Zl.set(this,void 0),qn.set(this,void 0),er.set(this,void 0),this._genAIProviderName="anthropic",this._supportsMessageThreads=!1;let l={apiKey:r,authToken:n,...o},p=Mt.filter(S=>l[S]!=null);if(p.length>1){let S=R=>R.map(A=>`\`${A}\``).join(", ");throw new TypeError(`Pass at most one of ${S(Mt)}. Received ${S(p)}.`)}let[_]=p,m=_!=null?null:{apiKey:r===void 0?N("ANTHROPIC_API_KEY"):void 0,authToken:n===void 0?N("ANTHROPIC_AUTH_TOKEN"):void 0},h=_!=null?{type:_,value:l[_]}:m?.apiKey!=null?{type:"apiKey",value:m.apiKey}:m?.authToken!=null?{type:"authToken",value:m.authToken}:{type:"defaultChain"},g={apiKey:h.type==="apiKey"?h.value:null,authToken:h.type==="authToken"?h.value:null,webhookKey:s,...o,baseURL:e||"https://api.anthropic.com"};if(!g.dangerouslyAllowBrowser&&dp())throw new E(`It looks like you're running in a browser-like environment.

This is disabled by default, as it risks exposing your secret API credentials to attackers.
If you understand the risks and have appropriate mitigations in place,
you can set the \`dangerouslyAllowBrowser\` option to \`true\`, e.g.,

new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
`);this.baseURL=g.baseURL,this._baseURLIsExplicit=o.__baseURLIsExplicit??!!e,this.timeout=g.timeout??Xd.DEFAULT_TIMEOUT,this.logger=g.logger??console,this.logLevel=Xn,this.logLevel=fa(g.logLevel,"ClientOptions.logLevel",I(this))??fa(N("ANTHROPIC_LOG"),"process.env['ANTHROPIC_LOG']",I(this))??Xn,m?.apiKey!=null&&m.authToken!=null&&!zf&&(zf=!0,I(this).warn("Anthropic: ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are both set. Using ANTHROPIC_API_KEY.")),this.fetchOptions=g.fetchOptions,this.maxRetries=ea("maxRetries",g.maxRetries??2);let y=this._instrumentationScope();b(this,er,rh(g.openTelemetry),"f"),g.openTelemetry=a(this,er,"f"),this._tracer=M(this,()=>ih(a(this,er,"f"),y.version,y.platform)),this.fetch=g.fetch??mp(),b(this,Zl,bp,"f"),this.middleware=[...g.middleware??[]];let w=N("ANTHROPIC_CUSTOM_HEADERS");if(w){let S={};for(let R of w.split(`
`)){let A=R.indexOf(":");A>=0&&(S[R.substring(0,A).trim()]=R.substring(A+1).trim())}g.defaultHeaders={...S,...g.defaultHeaders}}let k=o.__auth;if(delete g.__auth,delete g.__baseURLIsExplicit,this._options=g,this.apiKey=typeof g.apiKey=="string"?g.apiKey:null,b(this,qn,typeof g.apiKey=="function"?g.apiKey:null,"f"),this.authToken=g.authToken??null,this.webhookKey=s,k)this._authState=k,!this._baseURLIsExplicit&&k.baseURL&&(this.baseURL=k.baseURL);else switch(this._authState={provider:null,tokenCache:null,resolution:null,error:null,extraHeaders:{}},h.type){case"apiKey":case"authToken":break;case"credentials":this._authState.provider=h.value,this._authState.tokenCache=this._makeTokenCache(h.value);break;case"config":{let S=Dd(h.value,this._credentialResolverOptions());this._authState.provider=S.provider,this._authState.tokenCache=this._makeTokenCache(S.provider),this._authState.extraHeaders=S.extraHeaders,this._applyCredentialBaseURL(S.baseURL);break}case"profile":this._authState.resolution=this._resolveDefaultCredentials(h.value);break;case"defaultChain":this._shouldResolveDefaultCredentials()&&(this._authState.resolution=this._resolveDefaultCredentials());break;default:}}_shouldResolveDefaultCredentials(){return!0}_applyCredentialBaseURL(e){if(!e)return;let r=e.replace(/\/+$/,"");this._authState.baseURL=r,this._baseURLIsExplicit||(this.baseURL=r)}_credentialResolverOptions(){return{baseURL:this.baseURL,fetch:this._credentialsFetch(),userAgent:this.getUserAgent(),onCacheWriteError:e=>{I(this).debug("credential cache write failed (best-effort)",e)},onSafetyWarning:e=>{I(this).warn(e)}}}_credentialsFetch(){return Vd(this.fetch,this.middleware,void 0,this)}_makeTokenCache(e){return new Ql(e,r=>{I(this).debug("advisory token refresh failed; serving cached token",r)})}withOptions(e){e={...e};for(let o of Mt)e[o]===void 0&&delete e[o];let r=Mt.some(o=>o in e),n=Mt.some(o=>e[o]!=null),s={...this._options,...this._baseURLIsExplicit?{baseURL:this.baseURL}:{},maxRetries:this.maxRetries,timeout:this.timeout,logger:this.logger,logLevel:this.logLevel,fetch:this.fetch,fetchOptions:this.fetchOptions,middleware:this.middleware,apiKey:this.apiKey??a(this,qn,"f"),authToken:this.authToken,webhookKey:this.webhookKey,...n?Object.fromEntries(Mt.map(o=>[o,null])):{},...e,openTelemetry:e.openTelemetry??a(this,er,"f"),__auth:r?void 0:this._authState,__baseURLIsExplicit:"baseURL"in e?!0:this._baseURLIsExplicit};return new this.constructor(s)}async _resolveDefaultCredentials(e){try{let r=await xf(this._credentialResolverOptions(),e);if(r)this._authState.provider=r.provider,this._authState.tokenCache=this._makeTokenCache(r.provider),this._authState.extraHeaders=r.extraHeaders,this._applyCredentialBaseURL(r.baseURL);else if(e!=null)throw new E(`Profile "${e}" could not be resolved (no <config_dir>/configs/${e}.json found).`)}catch(r){this._authState.error=r}finally{this._authState.resolution=null}}defaultQuery(){return this._options.defaultQuery}validateHeaders({values:e,nulls:r}){if(!(e.get("x-api-key")||e.get("authorization"))){if(this._authState.error)throw this._authState.error;if(!(this._authState.tokenCache||this._authState.resolution)&&!(this.apiKey&&e.get("authorization"))&&!r.has("authorization")&&!(this.authToken&&e.get("authorization"))&&!r.has("authorization"))throw new Error('Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set. Or for the "Authorization" header to be explicitly omitted')}}_authFlags(e){let r=this._requestAuthFlags.get(e);return r||(r={usedTokenCache:!1,didRefreshFor401:!1},this._requestAuthFlags.set(e,r)),r}async authHeaders(e){if(this._authState.resolution&&await this._authState.resolution,!this._authState.error){if(a(this,qn,"f")&&this.apiKey==null){let r;try{r=await a(this,qn,"f").call(this)}catch(n){throw new E(`The \`apiKey\` function failed: ${dt(n).message}`,{cause:n})}if(!r)throw new E(`The \`apiKey\` function must return a non-empty string. It returned ${JSON.stringify(r)}.`);return d([{Authorization:`Bearer ${r}`}])}if(this._authState.tokenCache&&this.apiKey==null){let r=await this._authState.tokenCache.getToken();return this._authFlags(e).usedTokenCache=!0,d([{Authorization:`Bearer ${r}`}])}return d([await this.bearerAuth(e),await this.apiKeyAuth(e)])}}async apiKeyAuth(e){if(this.apiKey!=null)return d([{Authorization:`Bearer ${this.apiKey}`}])}async bearerAuth(e){if(this.authToken!=null)return d([{Authorization:`Bearer ${this.authToken}`}])}stringifyQuery(e){return bh(e)}getUserAgent(){return`Anthropic/JS ${Ee}`}makeStatusError(e,r,n,s){let l=(r??{}).error?.details?.error_code,p=typeof l=="string"?pf.get(`${e} ${l}`):void 0;return p?new p(e,r,n,s):$.generate(e,r,n,s)}buildURL(e,r,n){let s=!a(this,Qd,"m",If).call(this)&&n||this.baseURL,o=op(e)?new URL(e):new URL(s+(s.endsWith("/")&&e.startsWith("/")?e.slice(1):e)),l=this.defaultQuery(),p=Object.fromEntries(o.searchParams);return(!lu(l)||!lu(p))&&(r={...p,...l,...r}),typeof r=="object"&&r&&!Array.isArray(r)&&(o.search=this.stringifyQuery(r)),o.toString()}_calculateNonstreamingTimeout(e){if(3600*e/128e3>600)throw new E("Streaming is required for operations that may take longer than 10 minutes. See https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript#streaming-responses for more details");return 600*1e3}async prepareOptions(e){}async prepareRequest(e,{url:r,options:n}){if(this._authState.tokenCache&&this.apiKey==null){let s=e.headers instanceof Headers?e.headers:new Headers(e.headers);for(let[l,p]of Object.entries(this._authState.extraHeaders))s.has(l)||s.set(l,p);let o=s.get("anthropic-beta")?.split(",").map(l=>l.trim());o?.includes(Xt)||s.set("anthropic-beta",[...o??[],Xt].join(",")),e.headers=s}}backendMiddleware(){return[]}get(e,r){return this.methodRequest("get",e,r)}post(e,r){return this.methodRequest("post",e,r)}patch(e,r){return this.methodRequest("patch",e,r)}put(e,r){return this.methodRequest("put",e,r)}delete(e,r){return this.methodRequest("delete",e,r)}methodRequest(e,r,n){return this.request(Promise.resolve(n).then(s=>({method:e,path:r,...s})))}request(e,r=null){return this._tracer?new wt(this,this.makeTracedRequest(e,r)):new wt(this,this.makeRequest(e,r,void 0))}async makeTracedRequest(e,r){let n=await e,s=n.__span?.span;if(!s)return this.makeRequest(n,r,void 0);try{return await Z.with(Se.setSpan(Z.active(),s),()=>this.makeRequest(n,r,void 0,s))}catch(o){let l={status:"error",options:n,error:o};throw M(this,()=>vt(s,l)),o}}async makeRequest(e,r,n,s){let o=await e,l=ea("maxRetries",o.maxRetries??this.maxRetries);this.isStreamBody(o.body)&&(l=0),r==null&&(r=l,this._requestAuthFlags.delete(o)),await this.prepareOptions(o);let{req:p,url:_,timeout:m}=await this.buildRequest(o,{retryCount:l-r}),h="log_"+(Math.random()*(1<<24)|0).toString(16).padStart(6,"0"),g=n===void 0?"":`, retryOf: ${n}`;s&&this.openTelemetry.propagation&&(p.headers=M(this,()=>ah(s,p.headers))??p.headers);let y=Date.now();if(o.signal?.aborted)throw new ie;let w=new AbortController,k=await this.fetchWithTimeout(_,p,m,w,o,{requestLogID:h,retryOfRequestLogID:n}).catch(dt),S=Date.now();if(k instanceof globalThis.Error){He(w);let C=`retrying, ${r} attempts remaining`;if(o.signal?.aborted)throw new ie;let T=we(k)||/timed? ?out/i.test(String(k)+("cause"in k?String(k.cause):"")),x=this.middleware.length>0||!!o.middleware?.length||this.backendMiddleware().length>0;if(x&&!T&&!Rf(k))throw I(this).info(`[${h}] middleware error (not retryable)`),We(I(this),`[${h}] middleware error (not retryable)`,{retryOfRequestLogID:n,url:_,durationMs:S-y,message:k.message}),k;if(r)return I(this).info(`[${h}] connection ${T?"timed out":"failed"} - ${C}`),We(I(this),`[${h}] connection ${T?"timed out":"failed"} (${C})`,{retryOfRequestLogID:n,url:_,durationMs:S-y,message:k.message}),this.retryRequest(o,r,n??h,s);throw I(this).info(`[${h}] connection ${T?"timed out":"failed"} - error; no more retries left`),We(I(this),`[${h}] connection ${T?"timed out":"failed"} (error; no more retries left)`,{retryOfRequestLogID:n,url:_,durationMs:S-y,message:k.message}),T?new $n:x&&!Gd(k)?k:new rt({cause:k})}let R=[...k.headers.entries()].filter(([C])=>C==="request-id"||C==="anthropic-workspace-id").map(([C,T])=>", "+C+": "+JSON.stringify(T)).join(""),A=`[${h}${g}${R}] ${p.method} ${_} ${k.ok?"succeeded":"failed"} with status ${k.status} in ${S-y}ms`;if(!k.ok){let C=await this.shouldRetry(k,o);if(r&&C){let W=`retrying, ${r} attempts remaining`;return await gp(k.body),He(w),I(this).info(`${A} - ${W}`),We(I(this),`[${h}] response error (${W})`,{retryOfRequestLogID:n,url:k.url,status:k.status,headers:k.headers,durationMs:S-y}),this.retryRequest(o,r,n??h,s,k.headers)}let T=C?"error; no more retries left":"error; not retryable";I(this).info(`${A} - ${T}`);let x=await k.text().catch(W=>dt(W).message),B=ta(x),L=B?void 0:x;throw We(I(this),`[${h}] response error (${T})`,{retryOfRequestLogID:n,url:k.url,status:k.status,headers:k.headers,body:B??x,durationMs:Date.now()-y}),He(w),this.makeStatusError(k.status,B,L,k.headers)}return I(this).info(A),We(I(this),`[${h}] response start`,{retryOfRequestLogID:n,url:k.url,status:k.status,headers:k.headers,durationMs:S-y}),_p(k.body??k,w),{response:k,options:o,controller:w,requestLogID:h,retryOfRequestLogID:n,startTime:y}}getAPIList(e,r,n){return this.requestAPIList(r,n&&"then"in n?n.then(s=>({method:"get",path:e,...s})):{method:"get",path:e,...n})}requestAPIList(e,r){if(!this._tracer){let s=this.makeRequest(r,null,void 0);return new Ku(this,s,e)}let n=this.makeTracedRequest(r,null);return new Ku(this,n,e)}async fetchWithTimeout(e,r,n,s,o,l){let{signal:p,method:_,...m}=r||{},h=this._makeAbort(s);p&&(p.addEventListener("abort",h,{once:!0}),hp(s,p,h));let g=globalThis.ReadableStream&&m.body instanceof globalThis.ReadableStream||typeof m.body=="object"&&m.body!==null&&Symbol.asyncIterator in m.body,y={signal:s.signal,...g?{duplex:"half"}:{},method:"GET",...m};_&&(y.method=_.toUpperCase());let w=this.fetch,k=async(T,x)=>{let B=setTimeout(h,n);try{return await w.call(void 0,T,x)}finally{clearTimeout(B)}},S=o===void 0?k:(async(T,x={})=>{let B=typeof T=="string"?T:T instanceof URL?T.href:T.url;x.headers=x.headers instanceof Headers?x.headers:new Headers(x.headers);let L=[];o.__span&&(x.headers=new Headers(x.headers),L=Ra(x.headers)),await this.prepareRequest(x,{url:B,options:o}),L.length&&(x.headers=d([x.headers,L]).values);let U=o.__span;return U&&M(this,()=>oh(U,x.method??"GET",B,this.openTelemetry.traces.contentMode==="content")),l&&We(I(this),`[${l.requestLogID}] sending request`,{retryOfRequestLogID:l.retryOfRequestLogID,method:x.method,url:B,options:o,headers:x.headers}),k(T,x)}),R=o?.middleware,A=o?.__span?this.backendMiddleware().map($u):this.backendMiddleware(),C=R?.length||A.length?[...this.middleware,...R??[],...A]:this.middleware;return await Vd(S,C,o,this)(e,y)}async shouldRetry(e,r){let n=this._authFlags(r);if(e.status===401&&this._authState.tokenCache&&n.usedTokenCache&&!n.didRefreshFor401)return n.didRefreshFor401=!0,this._authState.tokenCache.invalidate(),!0;let s=e.headers.get("x-should-retry");return s==="true"?!0:s==="false"?!1:e.status===408||e.status===409||e.status===429||e.status>=500}async retryRequest(e,r,n,s,o){let l,p=o?.get("retry-after-ms");if(p){let m=parseFloat(p);Number.isNaN(m)||(l=m)}let _=o?.get("retry-after");if(_&&!l){let m=parseFloat(_);Number.isNaN(m)?l=Date.parse(_)-Date.now():l=m*1e3}if(l===void 0||!(l>0&&l<=2**31-1)){let m=e.maxRetries??this.maxRetries;l=this.calculateDefaultRetryTimeoutMillis(r,m)}return await Be(l,e.signal??void 0),this.makeRequest(e,r-1,n,s)}calculateDefaultRetryTimeoutMillis(e,r){let o=r-e,l=Math.min(.5*Math.pow(2,o),8),p=1-Math.random()*.25;return l*p*1e3}calculateNonstreamingTimeout(e,r){if(36e5*e/128e3>6e5||r!=null&&e>r)throw new E("Streaming is required for operations that may take longer than 10 minutes. See https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript#long-requests for more details");return 6e5}async buildRequest(e,{retryCount:r=0}={}){let n={...e},{method:s,path:o,query:l,defaultBaseURL:p}=n;this._authState.resolution&&await this._authState.resolution,!this._baseURLIsExplicit&&this._authState.baseURL&&this.baseURL!==this._authState.baseURL&&(this.baseURL=this._authState.baseURL);let _=this.buildURL(o,l,p);"timeout"in n&&ea("timeout",n.timeout),n.timeout=n.timeout??this.timeout;let{bodyHeaders:m,body:h}=this.buildBody({options:n}),g=await this.buildHeaders({options:e,method:s,bodyHeaders:m,retryCount:r,timeout:n.timeout});return{req:{method:s,headers:g,...n.signal&&{signal:n.signal},...globalThis.ReadableStream&&h instanceof globalThis.ReadableStream&&{duplex:"half"},...h&&{body:h},...this.fetchOptions??{},...n.fetchOptions??{}},url:_,timeout:n.timeout}}async buildHeaders({options:e,method:r,bodyHeaders:n,retryCount:s,timeout:o}){let l=d([{Accept:"application/json","User-Agent":this.getUserAgent(),"X-Stainless-Retry-Count":String(s),"X-Stainless-Timeout":String(Math.trunc(o/1e3)),...jn(),...this._options.dangerouslyAllowBrowser?{"anthropic-dangerous-direct-browser-access":"true"}:void 0,"anthropic-version":"2026-10-21"},await this.authHeaders(e),this._options.defaultHeaders,n,e.headers]);return this.validateHeaders(l),l.values}_makeAbort(e){return()=>e.abort()}buildBody({options:{body:e,headers:r}}){if(!e)return{bodyHeaders:void 0,body:void 0};let n=d([r]);return ArrayBuffer.isView(e)||e instanceof ArrayBuffer||e instanceof DataView||typeof e=="string"&&n.values.has("content-type")||globalThis.Blob&&e instanceof globalThis.Blob||e instanceof FormData||e instanceof URLSearchParams||globalThis.ReadableStream&&e instanceof globalThis.ReadableStream?{bodyHeaders:void 0,body:e}:this.isStreamBody(e)?{bodyHeaders:void 0,body:ia(e)}:typeof e=="object"&&n.values.get("content-type")==="application/x-www-form-urlencoded"?{bodyHeaders:{"content-type":"application/x-www-form-urlencoded"},body:this.stringifyQuery(e)}:a(this,Zl,"f").call(this,{body:e,headers:n})}isStreamBody(e){return globalThis.ReadableStream&&e instanceof globalThis.ReadableStream?!0:typeof e=="object"&&e!==null&&(Symbol.asyncIterator in e||Symbol.iterator in e&&"next"in e&&typeof e.next=="function")}}return Xd=t,Zl=new WeakMap,qn=new WeakMap,er=new WeakMap,Qd=new WeakSet,If=function(){return this.baseURL!=="https://api.anthropic.com"},t.Anthropic=Xd,t.DEFAULT_TIMEOUT=6e5,t.AnthropicError=E,t.APIError=$,t.APIConnectionError=rt,t.APIConnectionTimeoutError=$n,t.APIUserAbortError=ie,t.NotFoundError=ae,t.ConflictError=pe,t.RateLimitError=Nt,t.BadRequestError=P,t.OverloadedError=Hn,t.AuthenticationError=ru,t.RequestTimeoutError=iu,t.InternalServerError=Ot,t.NotImplementedError=au,t.GatewayTimeoutError=cu,t.PaymentRequiredError=tr,t.ContentTooLargeError=Un,t.PermissionDeniedError=D,t.PreconditionFailedError=Fn,t.ServiceUnavailableError=ht,t.UnprocessableEntityError=nu,t.ClientClosedRequestError=ou,t.RequestHeaderFieldsTooLargeError=su,t.toFile=Yd,t})(),Me=(()=>{class t extends yw{constructor(){super(...arguments),this._supportsMessageThreads=!0,this.messages=new zo(this),this.models=new Zt(this),this.files=new ls(this),this.skills=new Yo(this),this.userProfiles=new Qo(this),this.organization=new Jo(this),this.beta=new Ao(this)}}return t.Messages=zo,t.AvailableToolsLimitExceededError=Wi,t.CompactionBlockAmbiguousError=ji,t.CompactionBlockMisplacedError=Ki,t.CompactionContentMismatchError=Di,t.CompactionIncompleteTurnError=Gi,t.CompactionNothingToSummarizeError=Vi,t.CompactionSignatureInvalidError=Ji,t.CompactionTooManyToolReferencesError=Yi,t.CompactionToolChangesMismatchError=Qi,t.ThreadAlreadyContinuedError=Xi,t.ThreadContinueInFlightError=Zi,t.ThreadFingerprintMismatchError=en,t.ThreadUnsupportedRequestError=tn,t.ToolNameConflictError=rn,t.ToolReferenceUnresolvedError=nn,t.ThreadNotFoundError=sn,t.CompactionUnavailableError=on,t.Models=Zt,t.Files=ls,t.FileNotDownloadableError=ur,t.StorageQuotaExceededError=dr,t.FileExpiredError=pr,t.Skills=Yo,t.SkillReadBlockedUndecryptableError=Cn,t.UserProfiles=Qo,t.UserProfileNotFoundError=zn,t.UserProfileRequiredError=Nn,t.UserProfileBillingNotAuthorizedError=On,t.UserProfileNotBillableError=Mn,t.Organization=Jo,t.OrgMemberLimitExceededError=xn,t.RBACRoleNotFoundError=Pn,t.ConcurrentMembershipChangeError=Tn,t.Beta=Ao,t.BetaOrganizationNotEnrolledInBetaError=$i,t.BetaRequestBodyTimeoutError=Fi,t.BetaUnsupportedCharsetError=Ui,t.ClaudeCodeKeyCreatorNotMemberError=Ba,t.ClaudeCodeVersionTooOldError=qa,t.CMEKKeyDisabledError=La,t.CMEKKeyNetworkBlockedError=$a,t.OrganizationOnHoldError=Fa,t.OrganizationTypeNotSupportedError=Ua,t.ParentOrganizationRequiredError=Ha,t.RequestBodyEncodingInvalidError=Wa,t.RequestBodyEncodingUnsupportedError=ja,t.LinkedOrganizationBillingUnavailableError=Ka,t.LinkedOrganizationSpendLimitReachedError=Da,t.SandboxEgressRestrictedError=Ga,t.RequestBodyTooLargeAfterDecodingError=Va,t.ContractSpendLimitReachedError=Ja,t.EnforcedSpendLimitReachedError=Ya,t.RampLimitExceededError=Qa,t.CMEKContextUnavailableError=Xa,t.CMEKKeyUnreachableError=Za,t})();var qf="claude-opus-5-5",Xo="wt_trivia_cache",vw=40,ww={type:"object",additionalProperties:!1,required:["identified_title","confident","items"],properties:{identified_title:{type:"string"},confident:{type:"boolean"},items:{type:"array",items:{type:"object",additionalProperties:!1,required:["at_seconds","cue","scene","fact"],properties:{at_seconds:{type:"integer"},cue:{type:"string"},scene:{type:"string"},fact:{type:"string"}}}}}},Ew=`You write pop-up trivia for people watching a film or TV episode on a streaming site.
Each item pops up the moment its line of dialogue appears in the subtitles, so every item must belong to one specific moment of THIS episode or film.
You get what the page tells us about the title (page title, URL words, runtime). Work out which film or episode it is.
Write 10 to 20 items, spread over the whole runtime, each with:
- cue: a short line of dialogue (3 to 8 words) that is actually spoken at that moment, as it would read in English subtitles. Pick distinctive lines that appear once; never a generic line like "what are you doing".
- at_seconds: roughly when that line is spoken, in seconds from the start (0 to the runtime).
- scene: a few words naming the scene ("Thor arrives in Wakanda").
- fact: one or two sentences, under 220 characters, about what is on screen right then: how this scene was made, an improvised line, an easter egg or comic reference in it, a callback, something about the actor in this moment. Not box office, not ratings, not general production facts. Only facts you are sure of - no invented quotes, numbers or anecdotes. No spoilers beyond this moment.
If you cannot tell which title this is, or you do not know its dialogue well enough to quote lines, return an empty items list.`;async function rp(){let t=await chrome.storage.local.get(Xo);return t[Xo]&&typeof t[Xo]=="object"?t[Xo]:{}}async function Lf(t,i){let e=await rp();e[t]=i;let r=Object.keys(e).sort((n,s)=>(e[s].at||0)-(e[n].at||0));for(let n of r.slice(vw))delete e[n];await chrome.storage.local.set({[Xo]:e})}function kw(t,i){let e=i>0?i:21600;return(Array.isArray(t)?t:[]).filter(r=>r&&typeof r.fact=="string"&&r.fact.trim()&&Number.isFinite(r.at_seconds)).map(r=>({t:Math.max(5,Math.min(e-10,Math.round(r.at_seconds))),scene:String(r.scene||"").slice(0,80),fact:String(r.fact).trim().slice(0,300),cue:typeof r.cue=="string"&&r.cue.trim()?[r.cue.trim().slice(0,120)]:[]})).filter(r=>r.cue.length).sort((r,n)=>r.t-n.t).slice(0,30)}var Nf="https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/trivia/",Of=6*3600*1e3,Zd={};function $f(t){return" "+String(t||"").toLowerCase().replace(/&/g," and ").replace(/['’`]/g,"").replace(/[^a-z0-9]+/g," ").replace(/\bpart\b/g,"pt").replace(/\s+/g," ").trim()+" "}async function Mf(t,i){let e=Date.now(),r=Zd[t];if(r&&e-r.at<i)return r.data;let n=(await chrome.storage.local.get("wt_pack_cache")).wt_pack_cache||{};if(n[t]&&e-n[t].at<i)return Zd[t]=n[t],n[t].data;try{let s=await fetch(t+"?t="+Math.floor(e/6e5),{cache:"no-store"});if(!s.ok)throw new Error("http "+s.status);let o=await s.json();return Zd[t]={at:e,data:o},n[t]={at:e,data:o},await chrome.storage.local.set({wt_pack_cache:n}),o}catch(s){if(n[t])return n[t].data;throw s}}function ep(t,i){let e="";for(let r of i||[]){let n=$f(r);n.trim().length>=3&&t.indexOf(n)!==-1&&n.length>e.length&&(e=n)}return e}function Sw(t,i,e){let r=$f((e||[]).join(" | ")),n=null;for(let s of t&&t.packs||[]){if(s.kind!=="show")continue;let o=ep(r,s.names);if(!o)continue;let l=i[s.id];if(!l)return{needs:s};let p=r.split(o).join(" "),_=null,m=0;for(let h of l.entries||[]){let g=ep(" "+p+" ",h.names);g&&g.length>m&&(_=h,m=g.length)}if(_)return{entry:_,pack:l};n=n||{pack:l,noEpisode:!0}}if(n)return n;for(let s of t&&t.packs||[]){if(s.kind!=="films")continue;let o=i[s.id];if(!o)return{needs:s};let l=null,p=0;for(let _ of o.entries||[]){let m=ep(r,_.names);m&&m.length>p&&(l=_,p=m.length)}if(l)return{entry:l,pack:o}}return null}async function Aw(t,i){let e=await Mf(Nf+"index.json",Of),r={};for(let n=0;n<6;n++){let s=Sw(e,r,t.hints);if(!s)return null;if(s.needs){r[s.needs.id]=await Mf(Nf+s.needs.file,Of);continue}if(!s.entry)return null;let o=i>0?i:2700,l=(s.entry.items||[]).filter(p=>p&&typeof p.fact=="string"&&typeof p.p=="number"&&p.cue&&(typeof p.cue=="string"||Array.isArray(p.cue)&&p.cue.length)).map(p=>({t:Math.round(Math.max(.02,Math.min(.97,p.p))*o),scene:String(p.scene||"").slice(0,80),fact:String(p.fact).slice(0,300),cue:(Array.isArray(p.cue)?p.cue:[p.cue]).map(_=>String(_).slice(0,120)).slice(0,4),w:typeof p.w=="number"?p.w:void 0})).sort((p,_)=>p.t-_.t);return l.length?{items:l,title:String(s.entry.title||"").slice(0,120),source:"pack"}:null}return null}var xw=/^(production|development|writing|casting|filming|music|conception|cultural references|references to other works|visual effects|design|deleted scenes|easter eggs|reception|ratings|accolades|awards|trivia|analysis|themes)$/i;function rF(t){let i=t.hints||[];return(String(t.slug||"").replace(/·/g," ").trim()||String(t.title||"").trim()||String(i[0]||"").trim()).replace(/\s*[|\-–]\s*(netflix|disney\+?\s*hotstar|jiohotstar|hotstar|prime video|jiocinema|jiotv).*$/i,"").replace(/^watch\s+/i,"").slice(0,120)}function Pw(t){let i=[],e=0,r=/[.!?]["”’)]?(?=\s+["“(]?[A-Z0-9])/g,n;for(;n=r.exec(t);){let s=t.slice(Math.max(e,n.index-4),n.index+1);/(\b[A-Z]\.|\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Vol|No|vs|Inc|Ltd|Co)\.)$/.test(s)||(i.push(t.slice(e,r.lastIndex)),e=r.lastIndex)}return e<t.length&&i.push(t.slice(e)),i.map(s=>s.trim()).filter(Boolean)}function iF(t,i){let e=[],r="";for(let l of String(t||"").split(`
`)){let p=l.trim(),_=/^==+\s*(.*?)\s*==+$/.exec(p);if(_){r=_[1];continue}if(!(!r||!xw.test(r)||p.length<60))for(let m of Pw(p)){let h=m.trim();if(!(h.length<50||h.length>260)&&!/(rotten tomatoes|metacritic|nielsen|viewers|rating of|households?|18[-–\s]+(to\s+)?49|share among|box office|grossed|opening weekend)/i.test(h)&&/\s(["“]?[A-Z][a-z]+|\d)/.test(h.slice(1))&&!/^(others|these|this|they|such)\b/i.test(h)&&(e.push({scene:r,fact:h}),e.length>=i*3))break}}let n={};for(let l of e)(n[l.scene]=n[l.scene]||[]).push(l);let s=[],o=Object.keys(n);for(let l=0;s.length<i&&o.some(p=>n[p][l]);l++)for(let p of o)n[p][l]&&s.length<i&&s.push(n[p][l]);return s}async function Tw(t){let i=String(t.key||"").slice(0,200);if(!i)return{error:"no-title"};let e=await rp();if(e[i]&&Array.isArray(e[i].items)&&e[i].source!=="pack")return{items:e[i].items,title:e[i].title,source:e[i].source,cached:!0};let r=Number(t.duration)||0;try{let s=await Aw(t,r);if(s)return s}catch{}let{wt_anthropic_key:n}=await chrome.storage.local.get("wt_anthropic_key");if(n){let s=await Rw(t,n,i,r);if(s&&Array.isArray(s.items)&&s.items.length||s&&s.error==="bad-key")return s}return{error:"unknown"}}async function Rw(t,i,e,r){let n=new Me({fetch:wtFetch,apiKey:i,dangerouslyAllowBrowser:!0,maxRetries:2,timeout:12e4}),s=["Page title: "+String(t.pageTitle||"").slice(0,200),"Title from the page: "+String(t.title||"").slice(0,200),"Words from the URL: "+String(t.slug||"").slice(0,200),"Site: "+String(t.site||"").slice(0,60),"Other text on the page: "+(t.hints||[]).join(" | ").slice(0,400),"Runtime of the video: "+(r>0?Math.round(r)+" seconds":"unknown")].join(`
`),o;try{o=await n.beta.messages.create({model:qf,max_tokens:16e3,betas:["server-side-fallback-2026-07-01"],fallbacks:"default",system:Ew,output_config:{format:{type:"json_schema",schema:ww}},messages:[{role:"user",content:s}]})}catch(h){return h instanceof Me.AuthenticationError?{error:"bad-key"}:h instanceof Me.PermissionDeniedError?{error:"bad-key"}:h instanceof Me.RateLimitError?{error:"busy"}:h instanceof Me.APIConnectionError?{error:"offline"}:h instanceof Me.APIError?{error:"api",detail:String(h.message||"").slice(0,200)}:{error:"failed",detail:String(h&&h.message||h).slice(0,200)}}if(o.stop_reason==="refusal")return{error:"declined"};if(o.stop_reason==="max_tokens")return{error:"failed",detail:"answer too long"};let l=o.content.filter(h=>h.type==="text").map(h=>h.text).join(""),p;try{p=JSON.parse(l)}catch{return{error:"failed",detail:"unreadable answer"}}let _=kw(p.items,r),m=String(p.identified_title||"").slice(0,120);return _.length?(await Lf(e,{items:_,title:m,confident:!!p.confident,source:"claude",at:Date.now()}),{items:_,title:m,source:"claude"}):{error:"unknown"}}async function Cw(t){let i=new Me({fetch:wtFetch,apiKey:t,dangerouslyAllowBrowser:!0,maxRetries:1,timeout:2e4});try{return await i.models.retrieve(qf),{ok:!0}}catch(e){return e instanceof Me.AuthenticationError||e instanceof Me.PermissionDeniedError?{ok:!1,error:"bad-key"}:e instanceof Me.APIConnectionError?{ok:!1,error:"offline"}:{ok:!1,error:"api",detail:String(e&&e.message||e).slice(0,200)}}}var Iw=2e4,zw=6e4;async function Bf(){let t=null;try{t=(await(await fetch(chrome.runtime.getURL("manifest.json")+"?t="+Date.now(),{cache:"no-store"})).json()).version}catch{return"unreadable"}let i=chrome.runtime.getManifest().version;if(!t||t===i)return"current";let{wt_party:e,wt_live:r,wt_watching:n}=await chrome.storage.local.get(["wt_party","wt_live","wt_watching"]);return!!e&&!!r&&Date.now()-(r.at||0)<Iw||!!n&&Date.now()-(n.at||0)<zw?"deferred":(await chrome.storage.local.set({wt_updated:{from:i,to:t,at:Date.now()}}),chrome.runtime.reload(),"reloading")}function Nw(){try{return!!chrome.runtime.getManifest().update_url}catch{return!1}}if(!Nw()){try{chrome.alarms.create("wt-self-update",{periodInMinutes:1}),chrome.alarms.onAlarm.addListener(t=>{t&&t.name==="wt-self-update"&&Bf()})}catch{}Bf()}var tp=new Map;chrome.runtime.onMessage.addListener((t,i,e)=>{if(!t||typeof t!="object")return!1;if(t.t==="wt-trivia"){let r=String(t.key||""),n=tp.get(r);return n||(n=Tw(t).finally(()=>tp.delete(r)),tp.set(r,n)),n.then(e,s=>e({error:"failed",detail:String(s).slice(0,200)})),!0}if(t.t==="wt-trivia-store"){let r=String(t.key||"").slice(0,200),n=Array.isArray(t.items)?t.items.slice(0,30):null;return!r||!n?(e({ok:!1}),!1):(rp().then(s=>s[r]?null:Lf(r,{items:n,title:String(t.title||"").slice(0,120),shared:!0,at:Date.now()})).then(()=>e({ok:!0}),()=>e({ok:!1})),!0)}return t.t==="wt-update-state"?((async()=>{let r=null;try{r=(await(await fetch(chrome.runtime.getURL("manifest.json")+"?t="+Date.now(),{cache:"no-store"})).json()).version}catch{}e({running:chrome.runtime.getManifest().version,disk:r})})(),!0):t.t==="wt-reload-now"?(e({ok:!0}),setTimeout(()=>{try{chrome.runtime.reload()}catch{}},150),!1):t.t==="wt-check-key"?(Cw(String(t.key||"")).then(e),!0):!1});})();

// ---- lib/peerjs.min.js ----
(()=>{function e(e,t,n,r){Object.defineProperty(e,t,{get:n,set:r,enumerable:!0,configurable:!0})}function t(e){return e&&e.__esModule?e.default:e}class n{constructor(){this.chunkedMTU=16300,this._dataCount=1,this.chunk=e=>{let t=[],n=e.byteLength,r=Math.ceil(n/this.chunkedMTU),i=0,o=0;for(;o<n;){let s=Math.min(n,o+this.chunkedMTU),a=e.slice(o,s),c={__peerData:this._dataCount,n:i,data:a,total:r};t.push(c),o=s,i++}return this._dataCount++,t}}}class r{append_buffer(e){this.flush(),this._parts.push(e)}append(e){this._pieces.push(e)}flush(){if(this._pieces.length>0){let e=new Uint8Array(this._pieces);this._parts.push(e),this._pieces=[]}}toArrayBuffer(){let e=[];for(let t of this._parts)e.push(t);return function(e){let t=0;for(let n of e)t+=n.byteLength;let n=new Uint8Array(t),r=0;for(let t of e){let e=new Uint8Array(t.buffer,t.byteOffset,t.byteLength);n.set(e,r),r+=t.byteLength}return n}(e).buffer}constructor(){this.encoder=new TextEncoder,this._pieces=[],this._parts=[]}}function i(e){return new s(e).unpack()}function o(e){let t=new a,n=t.pack(e);return n instanceof Promise?n.then(()=>t.getBuffer()):t.getBuffer()}class s{unpack(){let e;let t=this.unpack_uint8();if(t<128)return t;if((224^t)<32)return(224^t)-32;if((e=160^t)<=15)return this.unpack_raw(e);if((e=176^t)<=15)return this.unpack_string(e);if((e=144^t)<=15)return this.unpack_array(e);if((e=128^t)<=15)return this.unpack_map(e);switch(t){case 192:return null;case 193:case 212:case 213:case 214:case 215:return;case 194:return!1;case 195:return!0;case 202:return this.unpack_float();case 203:return this.unpack_double();case 204:return this.unpack_uint8();case 205:return this.unpack_uint16();case 206:return this.unpack_uint32();case 207:return this.unpack_uint64();case 208:return this.unpack_int8();case 209:return this.unpack_int16();case 210:return this.unpack_int32();case 211:return this.unpack_int64();case 216:return e=this.unpack_uint16(),this.unpack_string(e);case 217:return e=this.unpack_uint32(),this.unpack_string(e);case 218:return e=this.unpack_uint16(),this.unpack_raw(e);case 219:return e=this.unpack_uint32(),this.unpack_raw(e);case 220:return e=this.unpack_uint16(),this.unpack_array(e);case 221:return e=this.unpack_uint32(),this.unpack_array(e);case 222:return e=this.unpack_uint16(),this.unpack_map(e);case 223:return e=this.unpack_uint32(),this.unpack_map(e)}}unpack_uint8(){let e=255&this.dataView[this.index];return this.index++,e}unpack_uint16(){let e=this.read(2),t=(255&e[0])*256+(255&e[1]);return this.index+=2,t}unpack_uint32(){let e=this.read(4),t=((256*e[0]+e[1])*256+e[2])*256+e[3];return this.index+=4,t}unpack_uint64(){let e=this.read(8),t=((((((256*e[0]+e[1])*256+e[2])*256+e[3])*256+e[4])*256+e[5])*256+e[6])*256+e[7];return this.index+=8,t}unpack_int8(){let e=this.unpack_uint8();return e<128?e:e-256}unpack_int16(){let e=this.unpack_uint16();return e<32768?e:e-65536}unpack_int32(){let e=this.unpack_uint32();return e<2147483648?e:e-4294967296}unpack_int64(){let e=this.unpack_uint64();return e<0x7fffffffffffffff?e:e-18446744073709552e3}unpack_raw(e){if(this.length<this.index+e)throw Error(`BinaryPackFailure: index is out of range ${this.index} ${e} ${this.length}`);let t=this.dataBuffer.slice(this.index,this.index+e);return this.index+=e,t}unpack_string(e){let t,n;let r=this.read(e),i=0,o="";for(;i<e;)(t=r[i])<160?(n=t,i++):(192^t)<32?(n=(31&t)<<6|63&r[i+1],i+=2):(224^t)<16?(n=(15&t)<<12|(63&r[i+1])<<6|63&r[i+2],i+=3):(n=(7&t)<<18|(63&r[i+1])<<12|(63&r[i+2])<<6|63&r[i+3],i+=4),o+=String.fromCodePoint(n);return this.index+=e,o}unpack_array(e){let t=Array(e);for(let n=0;n<e;n++)t[n]=this.unpack();return t}unpack_map(e){let t={};for(let n=0;n<e;n++)t[this.unpack()]=this.unpack();return t}unpack_float(){let e=this.unpack_uint32();return(0==e>>31?1:-1)*(8388607&e|8388608)*2**((e>>23&255)-127-23)}unpack_double(){let e=this.unpack_uint32(),t=this.unpack_uint32(),n=(e>>20&2047)-1023;return(0==e>>31?1:-1)*((1048575&e|1048576)*2**(n-20)+t*2**(n-52))}read(e){let t=this.index;if(t+e<=this.length)return this.dataView.subarray(t,t+e);throw Error("BinaryPackFailure: read index out of range")}constructor(e){this.index=0,this.dataBuffer=e,this.dataView=new Uint8Array(this.dataBuffer),this.length=this.dataBuffer.byteLength}}class a{getBuffer(){return this._bufferBuilder.toArrayBuffer()}pack(e){if("string"==typeof e)this.pack_string(e);else if("number"==typeof e)Math.floor(e)===e?this.pack_integer(e):this.pack_double(e);else if("boolean"==typeof e)!0===e?this._bufferBuilder.append(195):!1===e&&this._bufferBuilder.append(194);else if(void 0===e)this._bufferBuilder.append(192);else if("object"==typeof e){if(null===e)this._bufferBuilder.append(192);else{let t=e.constructor;if(e instanceof Array){let t=this.pack_array(e);if(t instanceof Promise)return t.then(()=>this._bufferBuilder.flush())}else if(e instanceof ArrayBuffer)this.pack_bin(new Uint8Array(e));else if("BYTES_PER_ELEMENT"in e)this.pack_bin(new Uint8Array(e.buffer,e.byteOffset,e.byteLength));else if(e instanceof Date)this.pack_string(e.toString());else if(e instanceof Blob)return e.arrayBuffer().then(e=>{this.pack_bin(new Uint8Array(e)),this._bufferBuilder.flush()});else if(t==Object||t.toString().startsWith("class")){let t=this.pack_object(e);if(t instanceof Promise)return t.then(()=>this._bufferBuilder.flush())}else throw Error(`Type "${t.toString()}" not yet supported`)}}else throw Error(`Type "${typeof e}" not yet supported`);this._bufferBuilder.flush()}pack_bin(e){let t=e.length;if(t<=15)this.pack_uint8(160+t);else if(t<=65535)this._bufferBuilder.append(218),this.pack_uint16(t);else if(t<=4294967295)this._bufferBuilder.append(219),this.pack_uint32(t);else throw Error("Invalid length");this._bufferBuilder.append_buffer(e)}pack_string(e){let t=this._textEncoder.encode(e),n=t.length;if(n<=15)this.pack_uint8(176+n);else if(n<=65535)this._bufferBuilder.append(216),this.pack_uint16(n);else if(n<=4294967295)this._bufferBuilder.append(217),this.pack_uint32(n);else throw Error("Invalid length");this._bufferBuilder.append_buffer(t)}pack_array(e){let t=e.length;if(t<=15)this.pack_uint8(144+t);else if(t<=65535)this._bufferBuilder.append(220),this.pack_uint16(t);else if(t<=4294967295)this._bufferBuilder.append(221),this.pack_uint32(t);else throw Error("Invalid length");let n=r=>{if(r<t){let t=this.pack(e[r]);return t instanceof Promise?t.then(()=>n(r+1)):n(r+1)}};return n(0)}pack_integer(e){if(e>=-32&&e<=127)this._bufferBuilder.append(255&e);else if(e>=0&&e<=255)this._bufferBuilder.append(204),this.pack_uint8(e);else if(e>=-128&&e<=127)this._bufferBuilder.append(208),this.pack_int8(e);else if(e>=0&&e<=65535)this._bufferBuilder.append(205),this.pack_uint16(e);else if(e>=-32768&&e<=32767)this._bufferBuilder.append(209),this.pack_int16(e);else if(e>=0&&e<=4294967295)this._bufferBuilder.append(206),this.pack_uint32(e);else if(e>=-2147483648&&e<=2147483647)this._bufferBuilder.append(210),this.pack_int32(e);else if(e>=-0x8000000000000000&&e<=0x7fffffffffffffff)this._bufferBuilder.append(211),this.pack_int64(e);else if(e>=0&&e<=18446744073709552e3)this._bufferBuilder.append(207),this.pack_uint64(e);else throw Error("Invalid integer")}pack_double(e){let t=0;e<0&&(t=1,e=-e);let n=Math.floor(Math.log(e)/Math.LN2),r=Math.floor((e/2**n-1)*4503599627370496),i=t<<31|n+1023<<20|r/4294967296&1048575;this._bufferBuilder.append(203),this.pack_int32(i),this.pack_int32(r%4294967296)}pack_object(e){let t=Object.keys(e),n=t.length;if(n<=15)this.pack_uint8(128+n);else if(n<=65535)this._bufferBuilder.append(222),this.pack_uint16(n);else if(n<=4294967295)this._bufferBuilder.append(223),this.pack_uint32(n);else throw Error("Invalid length");let r=n=>{if(n<t.length){let i=t[n];if(e.hasOwnProperty(i)){this.pack(i);let t=this.pack(e[i]);if(t instanceof Promise)return t.then(()=>r(n+1))}return r(n+1)}};return r(0)}pack_uint8(e){this._bufferBuilder.append(e)}pack_uint16(e){this._bufferBuilder.append(e>>8),this._bufferBuilder.append(255&e)}pack_uint32(e){let t=4294967295&e;this._bufferBuilder.append((4278190080&t)>>>24),this._bufferBuilder.append((16711680&t)>>>16),this._bufferBuilder.append((65280&t)>>>8),this._bufferBuilder.append(255&t)}pack_uint64(e){let t=e/4294967296,n=e%4294967296;this._bufferBuilder.append((4278190080&t)>>>24),this._bufferBuilder.append((16711680&t)>>>16),this._bufferBuilder.append((65280&t)>>>8),this._bufferBuilder.append(255&t),this._bufferBuilder.append((4278190080&n)>>>24),this._bufferBuilder.append((16711680&n)>>>16),this._bufferBuilder.append((65280&n)>>>8),this._bufferBuilder.append(255&n)}pack_int8(e){this._bufferBuilder.append(255&e)}pack_int16(e){this._bufferBuilder.append((65280&e)>>8),this._bufferBuilder.append(255&e)}pack_int32(e){this._bufferBuilder.append(e>>>24&255),this._bufferBuilder.append((16711680&e)>>>16),this._bufferBuilder.append((65280&e)>>>8),this._bufferBuilder.append(255&e)}pack_int64(e){let t=Math.floor(e/4294967296),n=e%4294967296;this._bufferBuilder.append((4278190080&t)>>>24),this._bufferBuilder.append((16711680&t)>>>16),this._bufferBuilder.append((65280&t)>>>8),this._bufferBuilder.append(255&t),this._bufferBuilder.append((4278190080&n)>>>24),this._bufferBuilder.append((16711680&n)>>>16),this._bufferBuilder.append((65280&n)>>>8),this._bufferBuilder.append(255&n)}constructor(){this._bufferBuilder=new r,this._textEncoder=new TextEncoder}}let c=!0,l=!0;function p(e,t,n){let r=e.match(t);return r&&r.length>=n&&parseInt(r[n],10)}function d(e,t,n){if(!e.RTCPeerConnection)return;let r=e.RTCPeerConnection.prototype,i=r.addEventListener;r.addEventListener=function(e,r){if(e!==t)return i.apply(this,arguments);let o=e=>{let t=n(e);t&&(r.handleEvent?r.handleEvent(t):r(t))};return this._eventMap=this._eventMap||{},this._eventMap[t]||(this._eventMap[t]=new Map),this._eventMap[t].set(r,o),i.apply(this,[e,o])};let o=r.removeEventListener;r.removeEventListener=function(e,n){if(e!==t||!this._eventMap||!this._eventMap[t]||!this._eventMap[t].has(n))return o.apply(this,arguments);let r=this._eventMap[t].get(n);return this._eventMap[t].delete(n),0===this._eventMap[t].size&&delete this._eventMap[t],0===Object.keys(this._eventMap).length&&delete this._eventMap,o.apply(this,[e,r])},Object.defineProperty(r,"on"+t,{get(){return this["_on"+t]},set(e){this["_on"+t]&&(this.removeEventListener(t,this["_on"+t]),delete this["_on"+t]),e&&this.addEventListener(t,this["_on"+t]=e)},enumerable:!0,configurable:!0})}function h(e){return"boolean"!=typeof e?Error("Argument type: "+typeof e+". Please use a boolean."):(c=e,e?"adapter.js logging disabled":"adapter.js logging enabled")}function u(e){return"boolean"!=typeof e?Error("Argument type: "+typeof e+". Please use a boolean."):(l=!e,"adapter.js deprecation warnings "+(e?"disabled":"enabled"))}function f(){"object"!=typeof window||c||"undefined"==typeof console||"function"!=typeof console.log||console.log.apply(console,arguments)}function m(e,t){l&&console.warn(e+" is deprecated, please use "+t+" instead.")}function g(e){return"[object Object]"===Object.prototype.toString.call(e)}function y(e,t,n){let r=n?"outbound-rtp":"inbound-rtp",i=new Map;if(null===t)return i;let o=[];return e.forEach(e=>{"track"===e.type&&e.trackIdentifier===t.id&&o.push(e)}),o.forEach(t=>{e.forEach(n=>{n.type===r&&n.trackId===t.id&&function e(t,n,r){!n||r.has(n.id)||(r.set(n.id,n),Object.keys(n).forEach(i=>{i.endsWith("Id")?e(t,t.get(n[i]),r):i.endsWith("Ids")&&n[i].forEach(n=>{e(t,t.get(n),r)})}))}(e,n,i)})}),i}var _,C,b,v,k,T,S,R,P,w,E,D,x,I,M,O,j={};function L(e,t){let n=e&&e.navigator;if(!n.mediaDevices)return;let r=function(e){if("object"!=typeof e||e.mandatory||e.optional)return e;let t={};return Object.keys(e).forEach(n=>{if("require"===n||"advanced"===n||"mediaSource"===n)return;let r="object"==typeof e[n]?e[n]:{ideal:e[n]};void 0!==r.exact&&"number"==typeof r.exact&&(r.min=r.max=r.exact);let i=function(e,t){return e?e+t.charAt(0).toUpperCase()+t.slice(1):"deviceId"===t?"sourceId":t};if(void 0!==r.ideal){t.optional=t.optional||[];let e={};"number"==typeof r.ideal?(e[i("min",n)]=r.ideal,t.optional.push(e),(e={})[i("max",n)]=r.ideal):e[i("",n)]=r.ideal,t.optional.push(e)}void 0!==r.exact&&"number"!=typeof r.exact?(t.mandatory=t.mandatory||{},t.mandatory[i("",n)]=r.exact):["min","max"].forEach(e=>{void 0!==r[e]&&(t.mandatory=t.mandatory||{},t.mandatory[i(e,n)]=r[e])})}),e.advanced&&(t.optional=(t.optional||[]).concat(e.advanced)),t},i=function(e,i){if(t.version>=61)return i(e);if((e=JSON.parse(JSON.stringify(e)))&&"object"==typeof e.audio){let t=function(e,t,n){t in e&&!(n in e)&&(e[n]=e[t],delete e[t])};t((e=JSON.parse(JSON.stringify(e))).audio,"autoGainControl","googAutoGainControl"),t(e.audio,"noiseSuppression","googNoiseSuppression"),e.audio=r(e.audio)}if(e&&"object"==typeof e.video){let o=e.video.facingMode;o=o&&("object"==typeof o?o:{ideal:o});let s=t.version<66;if(o&&("user"===o.exact||"environment"===o.exact||"user"===o.ideal||"environment"===o.ideal)&&!(n.mediaDevices.getSupportedConstraints&&n.mediaDevices.getSupportedConstraints().facingMode&&!s)){let t;if(delete e.video.facingMode,"environment"===o.exact||"environment"===o.ideal?t=["back","rear"]:("user"===o.exact||"user"===o.ideal)&&(t=["front"]),t)return n.mediaDevices.enumerateDevices().then(n=>{let s=(n=n.filter(e=>"videoinput"===e.kind)).find(e=>t.some(t=>e.label.toLowerCase().includes(t)));return!s&&n.length&&t.includes("back")&&(s=n[n.length-1]),s&&(e.video.deviceId=o.exact?{exact:s.deviceId}:{ideal:s.deviceId}),e.video=r(e.video),f("chrome: "+JSON.stringify(e)),i(e)})}e.video=r(e.video)}return f("chrome: "+JSON.stringify(e)),i(e)},o=function(e){return t.version>=64?e:{name:({PermissionDeniedError:"NotAllowedError",PermissionDismissedError:"NotAllowedError",InvalidStateError:"NotAllowedError",DevicesNotFoundError:"NotFoundError",ConstraintNotSatisfiedError:"OverconstrainedError",TrackStartError:"NotReadableError",MediaDeviceFailedDueToShutdown:"NotAllowedError",MediaDeviceKillSwitchOn:"NotAllowedError",TabCaptureError:"AbortError",ScreenCaptureError:"AbortError",DeviceCaptureError:"AbortError"})[e.name]||e.name,message:e.message,constraint:e.constraint||e.constraintName,toString(){return this.name+(this.message&&": ")+this.message}}};if(n.getUserMedia=(function(e,t,r){i(e,e=>{n.webkitGetUserMedia(e,t,e=>{r&&r(o(e))})})}).bind(n),n.mediaDevices.getUserMedia){let e=n.mediaDevices.getUserMedia.bind(n.mediaDevices);n.mediaDevices.getUserMedia=function(t){return i(t,t=>e(t).then(e=>{if(t.audio&&!e.getAudioTracks().length||t.video&&!e.getVideoTracks().length)throw e.getTracks().forEach(e=>{e.stop()}),new DOMException("","NotFoundError");return e},e=>Promise.reject(o(e))))}}}function A(e){e.MediaStream=e.MediaStream||e.webkitMediaStream}function B(e){if("object"!=typeof e||!e.RTCPeerConnection||"ontrack"in e.RTCPeerConnection.prototype)d(e,"track",e=>(e.transceiver||Object.defineProperty(e,"transceiver",{value:{receiver:e.receiver}}),e));else{Object.defineProperty(e.RTCPeerConnection.prototype,"ontrack",{get(){return this._ontrack},set(e){this._ontrack&&this.removeEventListener("track",this._ontrack),this.addEventListener("track",this._ontrack=e)},enumerable:!0,configurable:!0});let t=e.RTCPeerConnection.prototype.setRemoteDescription;e.RTCPeerConnection.prototype.setRemoteDescription=function(){return this._ontrackpoly||(this._ontrackpoly=t=>{t.stream.addEventListener("addtrack",n=>{let r;r=e.RTCPeerConnection.prototype.getReceivers?this.getReceivers().find(e=>e.track&&e.track.id===n.track.id):{track:n.track};let i=new Event("track");i.track=n.track,i.receiver=r,i.transceiver={receiver:r},i.streams=[t.stream],this.dispatchEvent(i)}),t.stream.getTracks().forEach(n=>{let r;r=e.RTCPeerConnection.prototype.getReceivers?this.getReceivers().find(e=>e.track&&e.track.id===n.id):{track:n};let i=new Event("track");i.track=n,i.receiver=r,i.transceiver={receiver:r},i.streams=[t.stream],this.dispatchEvent(i)})},this.addEventListener("addstream",this._ontrackpoly)),t.apply(this,arguments)}}}function F(e){if("object"==typeof e&&e.RTCPeerConnection&&!("getSenders"in e.RTCPeerConnection.prototype)&&"createDTMFSender"in e.RTCPeerConnection.prototype){let t=function(e,t){return{track:t,get dtmf(){return void 0===this._dtmf&&("audio"===t.kind?this._dtmf=e.createDTMFSender(t):this._dtmf=null),this._dtmf},_pc:e}};if(!e.RTCPeerConnection.prototype.getSenders){e.RTCPeerConnection.prototype.getSenders=function(){return this._senders=this._senders||[],this._senders.slice()};let n=e.RTCPeerConnection.prototype.addTrack;e.RTCPeerConnection.prototype.addTrack=function(e,r){let i=n.apply(this,arguments);return i||(i=t(this,e),this._senders.push(i)),i};let r=e.RTCPeerConnection.prototype.removeTrack;e.RTCPeerConnection.prototype.removeTrack=function(e){r.apply(this,arguments);let t=this._senders.indexOf(e);-1!==t&&this._senders.splice(t,1)}}let n=e.RTCPeerConnection.prototype.addStream;e.RTCPeerConnection.prototype.addStream=function(e){this._senders=this._senders||[],n.apply(this,[e]),e.getTracks().forEach(e=>{this._senders.push(t(this,e))})};let r=e.RTCPeerConnection.prototype.removeStream;e.RTCPeerConnection.prototype.removeStream=function(e){this._senders=this._senders||[],r.apply(this,[e]),e.getTracks().forEach(e=>{let t=this._senders.find(t=>t.track===e);t&&this._senders.splice(this._senders.indexOf(t),1)})}}else if("object"==typeof e&&e.RTCPeerConnection&&"getSenders"in e.RTCPeerConnection.prototype&&"createDTMFSender"in e.RTCPeerConnection.prototype&&e.RTCRtpSender&&!("dtmf"in e.RTCRtpSender.prototype)){let t=e.RTCPeerConnection.prototype.getSenders;e.RTCPeerConnection.prototype.getSenders=function(){let e=t.apply(this,[]);return e.forEach(e=>e._pc=this),e},Object.defineProperty(e.RTCRtpSender.prototype,"dtmf",{get(){return void 0===this._dtmf&&("audio"===this.track.kind?this._dtmf=this._pc.createDTMFSender(this.track):this._dtmf=null),this._dtmf}})}}function U(e){if(!("object"==typeof e&&e.RTCPeerConnection&&e.RTCRtpSender&&e.RTCRtpReceiver))return;if(!("getStats"in e.RTCRtpSender.prototype)){let t=e.RTCPeerConnection.prototype.getSenders;t&&(e.RTCPeerConnection.prototype.getSenders=function(){let e=t.apply(this,[]);return e.forEach(e=>e._pc=this),e});let n=e.RTCPeerConnection.prototype.addTrack;n&&(e.RTCPeerConnection.prototype.addTrack=function(){let e=n.apply(this,arguments);return e._pc=this,e}),e.RTCRtpSender.prototype.getStats=function(){let e=this;return this._pc.getStats().then(t=>y(t,e.track,!0))}}if(!("getStats"in e.RTCRtpReceiver.prototype)){let t=e.RTCPeerConnection.prototype.getReceivers;t&&(e.RTCPeerConnection.prototype.getReceivers=function(){let e=t.apply(this,[]);return e.forEach(e=>e._pc=this),e}),d(e,"track",e=>(e.receiver._pc=e.srcElement,e)),e.RTCRtpReceiver.prototype.getStats=function(){let e=this;return this._pc.getStats().then(t=>y(t,e.track,!1))}}if(!("getStats"in e.RTCRtpSender.prototype&&"getStats"in e.RTCRtpReceiver.prototype))return;let t=e.RTCPeerConnection.prototype.getStats;e.RTCPeerConnection.prototype.getStats=function(){if(arguments.length>0&&arguments[0]instanceof e.MediaStreamTrack){let e,t,n;let r=arguments[0];return(this.getSenders().forEach(t=>{t.track===r&&(e?n=!0:e=t)}),this.getReceivers().forEach(e=>(e.track===r&&(t?n=!0:t=e),e.track===r)),n||e&&t)?Promise.reject(new DOMException("There are more than one sender or receiver for the track.","InvalidAccessError")):e?e.getStats():t?t.getStats():Promise.reject(new DOMException("There is no sender or receiver for the track.","InvalidAccessError"))}return t.apply(this,arguments)}}function z(e){e.RTCPeerConnection.prototype.getLocalStreams=function(){return this._shimmedLocalStreams=this._shimmedLocalStreams||{},Object.keys(this._shimmedLocalStreams).map(e=>this._shimmedLocalStreams[e][0])};let t=e.RTCPeerConnection.prototype.addTrack;e.RTCPeerConnection.prototype.addTrack=function(e,n){if(!n)return t.apply(this,arguments);this._shimmedLocalStreams=this._shimmedLocalStreams||{};let r=t.apply(this,arguments);return this._shimmedLocalStreams[n.id]?-1===this._shimmedLocalStreams[n.id].indexOf(r)&&this._shimmedLocalStreams[n.id].push(r):this._shimmedLocalStreams[n.id]=[n,r],r};let n=e.RTCPeerConnection.prototype.addStream;e.RTCPeerConnection.prototype.addStream=function(e){this._shimmedLocalStreams=this._shimmedLocalStreams||{},e.getTracks().forEach(e=>{if(this.getSenders().find(t=>t.track===e))throw new DOMException("Track already exists.","InvalidAccessError")});let t=this.getSenders();n.apply(this,arguments);let r=this.getSenders().filter(e=>-1===t.indexOf(e));this._shimmedLocalStreams[e.id]=[e].concat(r)};let r=e.RTCPeerConnection.prototype.removeStream;e.RTCPeerConnection.prototype.removeStream=function(e){return this._shimmedLocalStreams=this._shimmedLocalStreams||{},delete this._shimmedLocalStreams[e.id],r.apply(this,arguments)};let i=e.RTCPeerConnection.prototype.removeTrack;e.RTCPeerConnection.prototype.removeTrack=function(e){return this._shimmedLocalStreams=this._shimmedLocalStreams||{},e&&Object.keys(this._shimmedLocalStreams).forEach(t=>{let n=this._shimmedLocalStreams[t].indexOf(e);-1!==n&&this._shimmedLocalStreams[t].splice(n,1),1===this._shimmedLocalStreams[t].length&&delete this._shimmedLocalStreams[t]}),i.apply(this,arguments)}}function N(e,t){if(!e.RTCPeerConnection)return;if(e.RTCPeerConnection.prototype.addTrack&&t.version>=65)return z(e);let n=e.RTCPeerConnection.prototype.getLocalStreams;e.RTCPeerConnection.prototype.getLocalStreams=function(){let e=n.apply(this);return this._reverseStreams=this._reverseStreams||{},e.map(e=>this._reverseStreams[e.id])};let r=e.RTCPeerConnection.prototype.addStream;e.RTCPeerConnection.prototype.addStream=function(t){if(this._streams=this._streams||{},this._reverseStreams=this._reverseStreams||{},t.getTracks().forEach(e=>{if(this.getSenders().find(t=>t.track===e))throw new DOMException("Track already exists.","InvalidAccessError")}),!this._reverseStreams[t.id]){let n=new e.MediaStream(t.getTracks());this._streams[t.id]=n,this._reverseStreams[n.id]=t,t=n}r.apply(this,[t])};let i=e.RTCPeerConnection.prototype.removeStream;function o(e,t){let n=t.sdp;return Object.keys(e._reverseStreams||[]).forEach(t=>{let r=e._reverseStreams[t],i=e._streams[r.id];n=n.replace(RegExp(i.id,"g"),r.id)}),new RTCSessionDescription({type:t.type,sdp:n})}e.RTCPeerConnection.prototype.removeStream=function(e){this._streams=this._streams||{},this._reverseStreams=this._reverseStreams||{},i.apply(this,[this._streams[e.id]||e]),delete this._reverseStreams[this._streams[e.id]?this._streams[e.id].id:e.id],delete this._streams[e.id]},e.RTCPeerConnection.prototype.addTrack=function(t,n){if("closed"===this.signalingState)throw new DOMException("The RTCPeerConnection's signalingState is 'closed'.","InvalidStateError");let r=[].slice.call(arguments,1);if(1!==r.length||!r[0].getTracks().find(e=>e===t))throw new DOMException("The adapter.js addTrack polyfill only supports a single  stream which is associated with the specified track.","NotSupportedError");if(this.getSenders().find(e=>e.track===t))throw new DOMException("Track already exists.","InvalidAccessError");this._streams=this._streams||{},this._reverseStreams=this._reverseStreams||{};let i=this._streams[n.id];if(i)i.addTrack(t),Promise.resolve().then(()=>{this.dispatchEvent(new Event("negotiationneeded"))});else{let r=new e.MediaStream([t]);this._streams[n.id]=r,this._reverseStreams[r.id]=n,this.addStream(r)}return this.getSenders().find(e=>e.track===t)},["createOffer","createAnswer"].forEach(function(t){let n=e.RTCPeerConnection.prototype[t];e.RTCPeerConnection.prototype[t]=({[t](){let e=arguments,t=arguments.length&&"function"==typeof arguments[0];return t?n.apply(this,[t=>{let n=o(this,t);e[0].apply(null,[n])},t=>{e[1]&&e[1].apply(null,t)},arguments[2]]):n.apply(this,arguments).then(e=>o(this,e))}})[t]});let s=e.RTCPeerConnection.prototype.setLocalDescription;e.RTCPeerConnection.prototype.setLocalDescription=function(){var e,t;let n;return arguments.length&&arguments[0].type&&(arguments[0]=(e=this,t=arguments[0],n=t.sdp,Object.keys(e._reverseStreams||[]).forEach(t=>{let r=e._reverseStreams[t],i=e._streams[r.id];n=n.replace(RegExp(r.id,"g"),i.id)}),new RTCSessionDescription({type:t.type,sdp:n}))),s.apply(this,arguments)};let a=Object.getOwnPropertyDescriptor(e.RTCPeerConnection.prototype,"localDescription");Object.defineProperty(e.RTCPeerConnection.prototype,"localDescription",{get(){let e=a.get.apply(this);return""===e.type?e:o(this,e)}}),e.RTCPeerConnection.prototype.removeTrack=function(e){let t;if("closed"===this.signalingState)throw new DOMException("The RTCPeerConnection's signalingState is 'closed'.","InvalidStateError");if(!e._pc)throw new DOMException("Argument 1 of RTCPeerConnection.removeTrack does not implement interface RTCRtpSender.","TypeError");if(e._pc!==this)throw new DOMException("Sender was not created by this connection.","InvalidAccessError");this._streams=this._streams||{},Object.keys(this._streams).forEach(n=>{this._streams[n].getTracks().find(t=>e.track===t)&&(t=this._streams[n])}),t&&(1===t.getTracks().length?this.removeStream(this._reverseStreams[t.id]):t.removeTrack(e.track),this.dispatchEvent(new Event("negotiationneeded")))}}function $(e,t){!e.RTCPeerConnection&&e.webkitRTCPeerConnection&&(e.RTCPeerConnection=e.webkitRTCPeerConnection),e.RTCPeerConnection&&t.version<53&&["setLocalDescription","setRemoteDescription","addIceCandidate"].forEach(function(t){let n=e.RTCPeerConnection.prototype[t];e.RTCPeerConnection.prototype[t]=({[t](){return arguments[0]=new("addIceCandidate"===t?e.RTCIceCandidate:e.RTCSessionDescription)(arguments[0]),n.apply(this,arguments)}})[t]})}function J(e,t){d(e,"negotiationneeded",e=>{let n=e.target;if(!(t.version<72)&&(!n.getConfiguration||"plan-b"!==n.getConfiguration().sdpSemantics)||"stable"===n.signalingState)return e})}e(j,"shimMediaStream",()=>A),e(j,"shimOnTrack",()=>B),e(j,"shimGetSendersWithDtmf",()=>F),e(j,"shimSenderReceiverGetStats",()=>U),e(j,"shimAddTrackRemoveTrackWithNative",()=>z),e(j,"shimAddTrackRemoveTrack",()=>N),e(j,"shimPeerConnection",()=>$),e(j,"fixNegotiationNeeded",()=>J),e(j,"shimGetUserMedia",()=>L);var V={};function G(e,t){let n=e&&e.navigator,r=e&&e.MediaStreamTrack;if(n.getUserMedia=function(e,t,r){m("navigator.getUserMedia","navigator.mediaDevices.getUserMedia"),n.mediaDevices.getUserMedia(e).then(t,r)},!(t.version>55&&"autoGainControl"in n.mediaDevices.getSupportedConstraints())){let e=function(e,t,n){t in e&&!(n in e)&&(e[n]=e[t],delete e[t])},t=n.mediaDevices.getUserMedia.bind(n.mediaDevices);if(n.mediaDevices.getUserMedia=function(n){return"object"==typeof n&&"object"==typeof n.audio&&(e((n=JSON.parse(JSON.stringify(n))).audio,"autoGainControl","mozAutoGainControl"),e(n.audio,"noiseSuppression","mozNoiseSuppression")),t(n)},r&&r.prototype.getSettings){let t=r.prototype.getSettings;r.prototype.getSettings=function(){let n=t.apply(this,arguments);return e(n,"mozAutoGainControl","autoGainControl"),e(n,"mozNoiseSuppression","noiseSuppression"),n}}if(r&&r.prototype.applyConstraints){let t=r.prototype.applyConstraints;r.prototype.applyConstraints=function(n){return"audio"===this.kind&&"object"==typeof n&&(e(n=JSON.parse(JSON.stringify(n)),"autoGainControl","mozAutoGainControl"),e(n,"noiseSuppression","mozNoiseSuppression")),t.apply(this,[n])}}}}function W(e,t){e.navigator.mediaDevices&&"getDisplayMedia"in e.navigator.mediaDevices||!e.navigator.mediaDevices||(e.navigator.mediaDevices.getDisplayMedia=function(n){if(!(n&&n.video)){let e=new DOMException("getDisplayMedia without video constraints is undefined");return e.name="NotFoundError",e.code=8,Promise.reject(e)}return!0===n.video?n.video={mediaSource:t}:n.video.mediaSource=t,e.navigator.mediaDevices.getUserMedia(n)})}function H(e){"object"==typeof e&&e.RTCTrackEvent&&"receiver"in e.RTCTrackEvent.prototype&&!("transceiver"in e.RTCTrackEvent.prototype)&&Object.defineProperty(e.RTCTrackEvent.prototype,"transceiver",{get(){return{receiver:this.receiver}}})}function Y(e,t){if("object"!=typeof e||!(e.RTCPeerConnection||e.mozRTCPeerConnection))return;!e.RTCPeerConnection&&e.mozRTCPeerConnection&&(e.RTCPeerConnection=e.mozRTCPeerConnection),t.version<53&&["setLocalDescription","setRemoteDescription","addIceCandidate"].forEach(function(t){let n=e.RTCPeerConnection.prototype[t];e.RTCPeerConnection.prototype[t]=({[t](){return arguments[0]=new("addIceCandidate"===t?e.RTCIceCandidate:e.RTCSessionDescription)(arguments[0]),n.apply(this,arguments)}})[t]});let n={inboundrtp:"inbound-rtp",outboundrtp:"outbound-rtp",candidatepair:"candidate-pair",localcandidate:"local-candidate",remotecandidate:"remote-candidate"},r=e.RTCPeerConnection.prototype.getStats;e.RTCPeerConnection.prototype.getStats=function(){let[e,i,o]=arguments;return r.apply(this,[e||null]).then(e=>{if(t.version<53&&!i)try{e.forEach(e=>{e.type=n[e.type]||e.type})}catch(t){if("TypeError"!==t.name)throw t;e.forEach((t,r)=>{e.set(r,Object.assign({},t,{type:n[t.type]||t.type}))})}return e}).then(i,o)}}function K(e){if(!("object"==typeof e&&e.RTCPeerConnection&&e.RTCRtpSender)||e.RTCRtpSender&&"getStats"in e.RTCRtpSender.prototype)return;let t=e.RTCPeerConnection.prototype.getSenders;t&&(e.RTCPeerConnection.prototype.getSenders=function(){let e=t.apply(this,[]);return e.forEach(e=>e._pc=this),e});let n=e.RTCPeerConnection.prototype.addTrack;n&&(e.RTCPeerConnection.prototype.addTrack=function(){let e=n.apply(this,arguments);return e._pc=this,e}),e.RTCRtpSender.prototype.getStats=function(){return this.track?this._pc.getStats(this.track):Promise.resolve(new Map)}}function X(e){if(!("object"==typeof e&&e.RTCPeerConnection&&e.RTCRtpSender)||e.RTCRtpSender&&"getStats"in e.RTCRtpReceiver.prototype)return;let t=e.RTCPeerConnection.prototype.getReceivers;t&&(e.RTCPeerConnection.prototype.getReceivers=function(){let e=t.apply(this,[]);return e.forEach(e=>e._pc=this),e}),d(e,"track",e=>(e.receiver._pc=e.srcElement,e)),e.RTCRtpReceiver.prototype.getStats=function(){return this._pc.getStats(this.track)}}function q(e){!e.RTCPeerConnection||"removeStream"in e.RTCPeerConnection.prototype||(e.RTCPeerConnection.prototype.removeStream=function(e){m("removeStream","removeTrack"),this.getSenders().forEach(t=>{t.track&&e.getTracks().includes(t.track)&&this.removeTrack(t)})})}function Q(e){e.DataChannel&&!e.RTCDataChannel&&(e.RTCDataChannel=e.DataChannel)}function Z(e){if(!("object"==typeof e&&e.RTCPeerConnection))return;let t=e.RTCPeerConnection.prototype.addTransceiver;t&&(e.RTCPeerConnection.prototype.addTransceiver=function(){this.setParametersPromises=[];let e=arguments[1]&&arguments[1].sendEncodings;void 0===e&&(e=[]);let n=(e=[...e]).length>0;n&&e.forEach(e=>{if("rid"in e&&!/^[a-z0-9]{0,16}$/i.test(e.rid))throw TypeError("Invalid RID value provided.");if("scaleResolutionDownBy"in e&&!(parseFloat(e.scaleResolutionDownBy)>=1))throw RangeError("scale_resolution_down_by must be >= 1.0");if("maxFramerate"in e&&!(parseFloat(e.maxFramerate)>=0))throw RangeError("max_framerate must be >= 0.0")});let r=t.apply(this,arguments);if(n){let{sender:t}=r,n=t.getParameters();"encodings"in n&&(1!==n.encodings.length||0!==Object.keys(n.encodings[0]).length)||(n.encodings=e,t.sendEncodings=e,this.setParametersPromises.push(t.setParameters(n).then(()=>{delete t.sendEncodings}).catch(()=>{delete t.sendEncodings})))}return r})}function ee(e){if(!("object"==typeof e&&e.RTCRtpSender))return;let t=e.RTCRtpSender.prototype.getParameters;t&&(e.RTCRtpSender.prototype.getParameters=function(){let e=t.apply(this,arguments);return"encodings"in e||(e.encodings=[].concat(this.sendEncodings||[{}])),e})}function et(e){if(!("object"==typeof e&&e.RTCPeerConnection))return;let t=e.RTCPeerConnection.prototype.createOffer;e.RTCPeerConnection.prototype.createOffer=function(){return this.setParametersPromises&&this.setParametersPromises.length?Promise.all(this.setParametersPromises).then(()=>t.apply(this,arguments)).finally(()=>{this.setParametersPromises=[]}):t.apply(this,arguments)}}function en(e){if(!("object"==typeof e&&e.RTCPeerConnection))return;let t=e.RTCPeerConnection.prototype.createAnswer;e.RTCPeerConnection.prototype.createAnswer=function(){return this.setParametersPromises&&this.setParametersPromises.length?Promise.all(this.setParametersPromises).then(()=>t.apply(this,arguments)).finally(()=>{this.setParametersPromises=[]}):t.apply(this,arguments)}}e(V,"shimOnTrack",()=>H),e(V,"shimPeerConnection",()=>Y),e(V,"shimSenderGetStats",()=>K),e(V,"shimReceiverGetStats",()=>X),e(V,"shimRemoveStream",()=>q),e(V,"shimRTCDataChannel",()=>Q),e(V,"shimAddTransceiver",()=>Z),e(V,"shimGetParameters",()=>ee),e(V,"shimCreateOffer",()=>et),e(V,"shimCreateAnswer",()=>en),e(V,"shimGetUserMedia",()=>G),e(V,"shimGetDisplayMedia",()=>W);var er={};function ei(e){if("object"==typeof e&&e.RTCPeerConnection){if("getLocalStreams"in e.RTCPeerConnection.prototype||(e.RTCPeerConnection.prototype.getLocalStreams=function(){return this._localStreams||(this._localStreams=[]),this._localStreams}),!("addStream"in e.RTCPeerConnection.prototype)){let t=e.RTCPeerConnection.prototype.addTrack;e.RTCPeerConnection.prototype.addStream=function(e){this._localStreams||(this._localStreams=[]),this._localStreams.includes(e)||this._localStreams.push(e),e.getAudioTracks().forEach(n=>t.call(this,n,e)),e.getVideoTracks().forEach(n=>t.call(this,n,e))},e.RTCPeerConnection.prototype.addTrack=function(e,...n){return n&&n.forEach(e=>{this._localStreams?this._localStreams.includes(e)||this._localStreams.push(e):this._localStreams=[e]}),t.apply(this,arguments)}}"removeStream"in e.RTCPeerConnection.prototype||(e.RTCPeerConnection.prototype.removeStream=function(e){this._localStreams||(this._localStreams=[]);let t=this._localStreams.indexOf(e);if(-1===t)return;this._localStreams.splice(t,1);let n=e.getTracks();this.getSenders().forEach(e=>{n.includes(e.track)&&this.removeTrack(e)})})}}function eo(e){if("object"==typeof e&&e.RTCPeerConnection&&("getRemoteStreams"in e.RTCPeerConnection.prototype||(e.RTCPeerConnection.prototype.getRemoteStreams=function(){return this._remoteStreams?this._remoteStreams:[]}),!("onaddstream"in e.RTCPeerConnection.prototype))){Object.defineProperty(e.RTCPeerConnection.prototype,"onaddstream",{get(){return this._onaddstream},set(e){this._onaddstream&&(this.removeEventListener("addstream",this._onaddstream),this.removeEventListener("track",this._onaddstreampoly)),this.addEventListener("addstream",this._onaddstream=e),this.addEventListener("track",this._onaddstreampoly=e=>{e.streams.forEach(e=>{if(this._remoteStreams||(this._remoteStreams=[]),this._remoteStreams.includes(e))return;this._remoteStreams.push(e);let t=new Event("addstream");t.stream=e,this.dispatchEvent(t)})})}});let t=e.RTCPeerConnection.prototype.setRemoteDescription;e.RTCPeerConnection.prototype.setRemoteDescription=function(){let e=this;return this._onaddstreampoly||this.addEventListener("track",this._onaddstreampoly=function(t){t.streams.forEach(t=>{if(e._remoteStreams||(e._remoteStreams=[]),e._remoteStreams.indexOf(t)>=0)return;e._remoteStreams.push(t);let n=new Event("addstream");n.stream=t,e.dispatchEvent(n)})}),t.apply(e,arguments)}}}function es(e){if("object"!=typeof e||!e.RTCPeerConnection)return;let t=e.RTCPeerConnection.prototype,n=t.createOffer,r=t.createAnswer,i=t.setLocalDescription,o=t.setRemoteDescription,s=t.addIceCandidate;t.createOffer=function(e,t){let r=arguments.length>=2?arguments[2]:arguments[0],i=n.apply(this,[r]);return t?(i.then(e,t),Promise.resolve()):i},t.createAnswer=function(e,t){let n=arguments.length>=2?arguments[2]:arguments[0],i=r.apply(this,[n]);return t?(i.then(e,t),Promise.resolve()):i};let a=function(e,t,n){let r=i.apply(this,[e]);return n?(r.then(t,n),Promise.resolve()):r};t.setLocalDescription=a,a=function(e,t,n){let r=o.apply(this,[e]);return n?(r.then(t,n),Promise.resolve()):r},t.setRemoteDescription=a,a=function(e,t,n){let r=s.apply(this,[e]);return n?(r.then(t,n),Promise.resolve()):r},t.addIceCandidate=a}function ea(e){let t=e&&e.navigator;if(t.mediaDevices&&t.mediaDevices.getUserMedia){let e=t.mediaDevices,n=e.getUserMedia.bind(e);t.mediaDevices.getUserMedia=e=>n(ec(e))}!t.getUserMedia&&t.mediaDevices&&t.mediaDevices.getUserMedia&&(t.getUserMedia=(function(e,n,r){t.mediaDevices.getUserMedia(e).then(n,r)}).bind(t))}function ec(e){return e&&void 0!==e.video?Object.assign({},e,{video:function e(t){return g(t)?Object.keys(t).reduce(function(n,r){let i=g(t[r]),o=i?e(t[r]):t[r],s=i&&!Object.keys(o).length;return void 0===o||s?n:Object.assign(n,{[r]:o})},{}):t}(e.video)}):e}function el(e){if(!e.RTCPeerConnection)return;let t=e.RTCPeerConnection;e.RTCPeerConnection=function(e,n){if(e&&e.iceServers){let t=[];for(let n=0;n<e.iceServers.length;n++){let r=e.iceServers[n];void 0===r.urls&&r.url?(m("RTCIceServer.url","RTCIceServer.urls"),(r=JSON.parse(JSON.stringify(r))).urls=r.url,delete r.url,t.push(r)):t.push(e.iceServers[n])}e.iceServers=t}return new t(e,n)},e.RTCPeerConnection.prototype=t.prototype,"generateCertificate"in t&&Object.defineProperty(e.RTCPeerConnection,"generateCertificate",{get:()=>t.generateCertificate})}function ep(e){"object"==typeof e&&e.RTCTrackEvent&&"receiver"in e.RTCTrackEvent.prototype&&!("transceiver"in e.RTCTrackEvent.prototype)&&Object.defineProperty(e.RTCTrackEvent.prototype,"transceiver",{get(){return{receiver:this.receiver}}})}function ed(e){let t=e.RTCPeerConnection.prototype.createOffer;e.RTCPeerConnection.prototype.createOffer=function(e){if(e){void 0!==e.offerToReceiveAudio&&(e.offerToReceiveAudio=!!e.offerToReceiveAudio);let t=this.getTransceivers().find(e=>"audio"===e.receiver.track.kind);!1===e.offerToReceiveAudio&&t?"sendrecv"===t.direction?t.setDirection?t.setDirection("sendonly"):t.direction="sendonly":"recvonly"===t.direction&&(t.setDirection?t.setDirection("inactive"):t.direction="inactive"):!0!==e.offerToReceiveAudio||t||this.addTransceiver("audio",{direction:"recvonly"}),void 0!==e.offerToReceiveVideo&&(e.offerToReceiveVideo=!!e.offerToReceiveVideo);let n=this.getTransceivers().find(e=>"video"===e.receiver.track.kind);!1===e.offerToReceiveVideo&&n?"sendrecv"===n.direction?n.setDirection?n.setDirection("sendonly"):n.direction="sendonly":"recvonly"===n.direction&&(n.setDirection?n.setDirection("inactive"):n.direction="inactive"):!0!==e.offerToReceiveVideo||n||this.addTransceiver("video",{direction:"recvonly"})}return t.apply(this,arguments)}}function eh(e){"object"!=typeof e||e.AudioContext||(e.AudioContext=e.webkitAudioContext)}e(er,"shimLocalStreamsAPI",()=>ei),e(er,"shimRemoteStreamsAPI",()=>eo),e(er,"shimCallbacksAPI",()=>es),e(er,"shimGetUserMedia",()=>ea),e(er,"shimConstraints",()=>ec),e(er,"shimRTCIceServerUrls",()=>el),e(er,"shimTrackEventTransceiver",()=>ep),e(er,"shimCreateOfferLegacy",()=>ed),e(er,"shimAudioContext",()=>eh);var eu={};e(eu,"shimRTCIceCandidate",()=>eg),e(eu,"shimRTCIceCandidateRelayProtocol",()=>ey),e(eu,"shimMaxMessageSize",()=>e_),e(eu,"shimSendThrowTypeError",()=>eC),e(eu,"shimConnectionState",()=>eb),e(eu,"removeExtmapAllowMixed",()=>ev),e(eu,"shimAddIceCandidateNullOrEmpty",()=>ek),e(eu,"shimParameterlessSetLocalDescription",()=>eT);var ef={};let em={};function eg(e){if(!e.RTCIceCandidate||e.RTCIceCandidate&&"foundation"in e.RTCIceCandidate.prototype)return;let n=e.RTCIceCandidate;e.RTCIceCandidate=function(e){if("object"==typeof e&&e.candidate&&0===e.candidate.indexOf("a=")&&((e=JSON.parse(JSON.stringify(e))).candidate=e.candidate.substring(2)),e.candidate&&e.candidate.length){let r=new n(e),i=t(ef).parseCandidate(e.candidate);for(let e in i)e in r||Object.defineProperty(r,e,{value:i[e]});return r.toJSON=function(){return{candidate:r.candidate,sdpMid:r.sdpMid,sdpMLineIndex:r.sdpMLineIndex,usernameFragment:r.usernameFragment}},r}return new n(e)},e.RTCIceCandidate.prototype=n.prototype,d(e,"icecandidate",t=>(t.candidate&&Object.defineProperty(t,"candidate",{value:new e.RTCIceCandidate(t.candidate),writable:"false"}),t))}function ey(e){!e.RTCIceCandidate||e.RTCIceCandidate&&"relayProtocol"in e.RTCIceCandidate.prototype||d(e,"icecandidate",e=>{if(e.candidate){let n=t(ef).parseCandidate(e.candidate.candidate);"relay"===n.type&&(e.candidate.relayProtocol=({0:"tls",1:"tcp",2:"udp"})[n.priority>>24])}return e})}function e_(e,n){if(!e.RTCPeerConnection)return;"sctp"in e.RTCPeerConnection.prototype||Object.defineProperty(e.RTCPeerConnection.prototype,"sctp",{get(){return void 0===this._sctp?null:this._sctp}});let r=function(e){if(!e||!e.sdp)return!1;let n=t(ef).splitSections(e.sdp);return n.shift(),n.some(e=>{let n=t(ef).parseMLine(e);return n&&"application"===n.kind&&-1!==n.protocol.indexOf("SCTP")})},i=function(e){let t=e.sdp.match(/mozilla...THIS_IS_SDPARTA-(\d+)/);if(null===t||t.length<2)return -1;let n=parseInt(t[1],10);return n!=n?-1:n},o=function(e){let t=65536;return"firefox"===n.browser&&(t=n.version<57?-1===e?16384:2147483637:n.version<60?57===n.version?65535:65536:2147483637),t},s=function(e,r){let i=65536;"firefox"===n.browser&&57===n.version&&(i=65535);let o=t(ef).matchPrefix(e.sdp,"a=max-message-size:");return o.length>0?i=parseInt(o[0].substring(19),10):"firefox"===n.browser&&-1!==r&&(i=2147483637),i},a=e.RTCPeerConnection.prototype.setRemoteDescription;e.RTCPeerConnection.prototype.setRemoteDescription=function(){if(this._sctp=null,"chrome"===n.browser&&n.version>=76){let{sdpSemantics:e}=this.getConfiguration();"plan-b"===e&&Object.defineProperty(this,"sctp",{get(){return void 0===this._sctp?null:this._sctp},enumerable:!0,configurable:!0})}if(r(arguments[0])){let e;let t=i(arguments[0]),n=o(t),r=s(arguments[0],t);e=0===n&&0===r?Number.POSITIVE_INFINITY:0===n||0===r?Math.max(n,r):Math.min(n,r);let a={};Object.defineProperty(a,"maxMessageSize",{get:()=>e}),this._sctp=a}return a.apply(this,arguments)}}function eC(e){if(!(e.RTCPeerConnection&&"createDataChannel"in e.RTCPeerConnection.prototype))return;function t(e,t){let n=e.send;e.send=function(){let r=arguments[0],i=r.length||r.size||r.byteLength;if("open"===e.readyState&&t.sctp&&i>t.sctp.maxMessageSize)throw TypeError("Message too large (can send a maximum of "+t.sctp.maxMessageSize+" bytes)");return n.apply(e,arguments)}}let n=e.RTCPeerConnection.prototype.createDataChannel;e.RTCPeerConnection.prototype.createDataChannel=function(){let e=n.apply(this,arguments);return t(e,this),e},d(e,"datachannel",e=>(t(e.channel,e.target),e))}function eb(e){if(!e.RTCPeerConnection||"connectionState"in e.RTCPeerConnection.prototype)return;let t=e.RTCPeerConnection.prototype;Object.defineProperty(t,"connectionState",{get(){return({completed:"connected",checking:"connecting"})[this.iceConnectionState]||this.iceConnectionState},enumerable:!0,configurable:!0}),Object.defineProperty(t,"onconnectionstatechange",{get(){return this._onconnectionstatechange||null},set(e){this._onconnectionstatechange&&(this.removeEventListener("connectionstatechange",this._onconnectionstatechange),delete this._onconnectionstatechange),e&&this.addEventListener("connectionstatechange",this._onconnectionstatechange=e)},enumerable:!0,configurable:!0}),["setLocalDescription","setRemoteDescription"].forEach(e=>{let n=t[e];t[e]=function(){return this._connectionstatechangepoly||(this._connectionstatechangepoly=e=>{let t=e.target;if(t._lastConnectionState!==t.connectionState){t._lastConnectionState=t.connectionState;let n=new Event("connectionstatechange",e);t.dispatchEvent(n)}return e},this.addEventListener("iceconnectionstatechange",this._connectionstatechangepoly)),n.apply(this,arguments)}})}function ev(e,t){if(!e.RTCPeerConnection||"chrome"===t.browser&&t.version>=71||"safari"===t.browser&&t.version>=605)return;let n=e.RTCPeerConnection.prototype.setRemoteDescription;e.RTCPeerConnection.prototype.setRemoteDescription=function(t){if(t&&t.sdp&&-1!==t.sdp.indexOf("\na=extmap-allow-mixed")){let n=t.sdp.split("\n").filter(e=>"a=extmap-allow-mixed"!==e.trim()).join("\n");e.RTCSessionDescription&&t instanceof e.RTCSessionDescription?arguments[0]=new e.RTCSessionDescription({type:t.type,sdp:n}):t.sdp=n}return n.apply(this,arguments)}}function ek(e,t){if(!(e.RTCPeerConnection&&e.RTCPeerConnection.prototype))return;let n=e.RTCPeerConnection.prototype.addIceCandidate;n&&0!==n.length&&(e.RTCPeerConnection.prototype.addIceCandidate=function(){return arguments[0]?("chrome"===t.browser&&t.version<78||"firefox"===t.browser&&t.version<68||"safari"===t.browser)&&arguments[0]&&""===arguments[0].candidate?Promise.resolve():n.apply(this,arguments):(arguments[1]&&arguments[1].apply(null),Promise.resolve())})}function eT(e,t){if(!(e.RTCPeerConnection&&e.RTCPeerConnection.prototype))return;let n=e.RTCPeerConnection.prototype.setLocalDescription;n&&0!==n.length&&(e.RTCPeerConnection.prototype.setLocalDescription=function(){let e=arguments[0]||{};if("object"!=typeof e||e.type&&e.sdp)return n.apply(this,arguments);if(!(e={type:e.type,sdp:e.sdp}).type)switch(this.signalingState){case"stable":case"have-local-offer":case"have-remote-pranswer":e.type="offer";break;default:e.type="answer"}return e.sdp||"offer"!==e.type&&"answer"!==e.type?n.apply(this,[e]):("offer"===e.type?this.createOffer:this.createAnswer).apply(this).then(e=>n.apply(this,[e]))})}em.generateIdentifier=function(){return Math.random().toString(36).substring(2,12)},em.localCName=em.generateIdentifier(),em.splitLines=function(e){return e.trim().split("\n").map(e=>e.trim())},em.splitSections=function(e){return e.split("\nm=").map((e,t)=>(t>0?"m="+e:e).trim()+"\r\n")},em.getDescription=function(e){let t=em.splitSections(e);return t&&t[0]},em.getMediaSections=function(e){let t=em.splitSections(e);return t.shift(),t},em.matchPrefix=function(e,t){return em.splitLines(e).filter(e=>0===e.indexOf(t))},em.parseCandidate=function(e){let t;let n={foundation:(t=0===e.indexOf("a=candidate:")?e.substring(12).split(" "):e.substring(10).split(" "))[0],component:{1:"rtp",2:"rtcp"}[t[1]]||t[1],protocol:t[2].toLowerCase(),priority:parseInt(t[3],10),ip:t[4],address:t[4],port:parseInt(t[5],10),type:t[7]};for(let e=8;e<t.length;e+=2)switch(t[e]){case"raddr":n.relatedAddress=t[e+1];break;case"rport":n.relatedPort=parseInt(t[e+1],10);break;case"tcptype":n.tcpType=t[e+1];break;case"ufrag":n.ufrag=t[e+1],n.usernameFragment=t[e+1];break;default:void 0===n[t[e]]&&(n[t[e]]=t[e+1])}return n},em.writeCandidate=function(e){let t=[];t.push(e.foundation);let n=e.component;"rtp"===n?t.push(1):"rtcp"===n?t.push(2):t.push(n),t.push(e.protocol.toUpperCase()),t.push(e.priority),t.push(e.address||e.ip),t.push(e.port);let r=e.type;return t.push("typ"),t.push(r),"host"!==r&&e.relatedAddress&&e.relatedPort&&(t.push("raddr"),t.push(e.relatedAddress),t.push("rport"),t.push(e.relatedPort)),e.tcpType&&"tcp"===e.protocol.toLowerCase()&&(t.push("tcptype"),t.push(e.tcpType)),(e.usernameFragment||e.ufrag)&&(t.push("ufrag"),t.push(e.usernameFragment||e.ufrag)),"candidate:"+t.join(" ")},em.parseIceOptions=function(e){return e.substring(14).split(" ")},em.parseRtpMap=function(e){let t=e.substring(9).split(" "),n={payloadType:parseInt(t.shift(),10)};return t=t[0].split("/"),n.name=t[0],n.clockRate=parseInt(t[1],10),n.channels=3===t.length?parseInt(t[2],10):1,n.numChannels=n.channels,n},em.writeRtpMap=function(e){let t=e.payloadType;void 0!==e.preferredPayloadType&&(t=e.preferredPayloadType);let n=e.channels||e.numChannels||1;return"a=rtpmap:"+t+" "+e.name+"/"+e.clockRate+(1!==n?"/"+n:"")+"\r\n"},em.parseExtmap=function(e){let t=e.substring(9).split(" ");return{id:parseInt(t[0],10),direction:t[0].indexOf("/")>0?t[0].split("/")[1]:"sendrecv",uri:t[1],attributes:t.slice(2).join(" ")}},em.writeExtmap=function(e){return"a=extmap:"+(e.id||e.preferredId)+(e.direction&&"sendrecv"!==e.direction?"/"+e.direction:"")+" "+e.uri+(e.attributes?" "+e.attributes:"")+"\r\n"},em.parseFmtp=function(e){let t;let n={},r=e.substring(e.indexOf(" ")+1).split(";");for(let e=0;e<r.length;e++)n[(t=r[e].trim().split("="))[0].trim()]=t[1];return n},em.writeFmtp=function(e){let t="",n=e.payloadType;if(void 0!==e.preferredPayloadType&&(n=e.preferredPayloadType),e.parameters&&Object.keys(e.parameters).length){let r=[];Object.keys(e.parameters).forEach(t=>{void 0!==e.parameters[t]?r.push(t+"="+e.parameters[t]):r.push(t)}),t+="a=fmtp:"+n+" "+r.join(";")+"\r\n"}return t},em.parseRtcpFb=function(e){let t=e.substring(e.indexOf(" ")+1).split(" ");return{type:t.shift(),parameter:t.join(" ")}},em.writeRtcpFb=function(e){let t="",n=e.payloadType;return void 0!==e.preferredPayloadType&&(n=e.preferredPayloadType),e.rtcpFeedback&&e.rtcpFeedback.length&&e.rtcpFeedback.forEach(e=>{t+="a=rtcp-fb:"+n+" "+e.type+(e.parameter&&e.parameter.length?" "+e.parameter:"")+"\r\n"}),t},em.parseSsrcMedia=function(e){let t=e.indexOf(" "),n={ssrc:parseInt(e.substring(7,t),10)},r=e.indexOf(":",t);return r>-1?(n.attribute=e.substring(t+1,r),n.value=e.substring(r+1)):n.attribute=e.substring(t+1),n},em.parseSsrcGroup=function(e){let t=e.substring(13).split(" ");return{semantics:t.shift(),ssrcs:t.map(e=>parseInt(e,10))}},em.getMid=function(e){let t=em.matchPrefix(e,"a=mid:")[0];if(t)return t.substring(6)},em.parseFingerprint=function(e){let t=e.substring(14).split(" ");return{algorithm:t[0].toLowerCase(),value:t[1].toUpperCase()}},em.getDtlsParameters=function(e,t){return{role:"auto",fingerprints:em.matchPrefix(e+t,"a=fingerprint:").map(em.parseFingerprint)}},em.writeDtlsParameters=function(e,t){let n="a=setup:"+t+"\r\n";return e.fingerprints.forEach(e=>{n+="a=fingerprint:"+e.algorithm+" "+e.value+"\r\n"}),n},em.parseCryptoLine=function(e){let t=e.substring(9).split(" ");return{tag:parseInt(t[0],10),cryptoSuite:t[1],keyParams:t[2],sessionParams:t.slice(3)}},em.writeCryptoLine=function(e){return"a=crypto:"+e.tag+" "+e.cryptoSuite+" "+("object"==typeof e.keyParams?em.writeCryptoKeyParams(e.keyParams):e.keyParams)+(e.sessionParams?" "+e.sessionParams.join(" "):"")+"\r\n"},em.parseCryptoKeyParams=function(e){if(0!==e.indexOf("inline:"))return null;let t=e.substring(7).split("|");return{keyMethod:"inline",keySalt:t[0],lifeTime:t[1],mkiValue:t[2]?t[2].split(":")[0]:void 0,mkiLength:t[2]?t[2].split(":")[1]:void 0}},em.writeCryptoKeyParams=function(e){return e.keyMethod+":"+e.keySalt+(e.lifeTime?"|"+e.lifeTime:"")+(e.mkiValue&&e.mkiLength?"|"+e.mkiValue+":"+e.mkiLength:"")},em.getCryptoParameters=function(e,t){return em.matchPrefix(e+t,"a=crypto:").map(em.parseCryptoLine)},em.getIceParameters=function(e,t){let n=em.matchPrefix(e+t,"a=ice-ufrag:")[0],r=em.matchPrefix(e+t,"a=ice-pwd:")[0];return n&&r?{usernameFragment:n.substring(12),password:r.substring(10)}:null},em.writeIceParameters=function(e){let t="a=ice-ufrag:"+e.usernameFragment+"\r\na=ice-pwd:"+e.password+"\r\n";return e.iceLite&&(t+="a=ice-lite\r\n"),t},em.parseRtpParameters=function(e){let t={codecs:[],headerExtensions:[],fecMechanisms:[],rtcp:[]},n=em.splitLines(e)[0].split(" ");t.profile=n[2];for(let r=3;r<n.length;r++){let i=n[r],o=em.matchPrefix(e,"a=rtpmap:"+i+" ")[0];if(o){let n=em.parseRtpMap(o),r=em.matchPrefix(e,"a=fmtp:"+i+" ");switch(n.parameters=r.length?em.parseFmtp(r[0]):{},n.rtcpFeedback=em.matchPrefix(e,"a=rtcp-fb:"+i+" ").map(em.parseRtcpFb),t.codecs.push(n),n.name.toUpperCase()){case"RED":case"ULPFEC":t.fecMechanisms.push(n.name.toUpperCase())}}}em.matchPrefix(e,"a=extmap:").forEach(e=>{t.headerExtensions.push(em.parseExtmap(e))});let r=em.matchPrefix(e,"a=rtcp-fb:* ").map(em.parseRtcpFb);return t.codecs.forEach(e=>{r.forEach(t=>{e.rtcpFeedback.find(e=>e.type===t.type&&e.parameter===t.parameter)||e.rtcpFeedback.push(t)})}),t},em.writeRtpDescription=function(e,t){let n="";n+="m="+e+" "+(t.codecs.length>0?"9":"0")+" "+(t.profile||"UDP/TLS/RTP/SAVPF")+" "+t.codecs.map(e=>void 0!==e.preferredPayloadType?e.preferredPayloadType:e.payloadType).join(" ")+"\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\n",t.codecs.forEach(e=>{n+=em.writeRtpMap(e)+em.writeFmtp(e)+em.writeRtcpFb(e)});let r=0;return t.codecs.forEach(e=>{e.maxptime>r&&(r=e.maxptime)}),r>0&&(n+="a=maxptime:"+r+"\r\n"),t.headerExtensions&&t.headerExtensions.forEach(e=>{n+=em.writeExtmap(e)}),n},em.parseRtpEncodingParameters=function(e){let t;let n=[],r=em.parseRtpParameters(e),i=-1!==r.fecMechanisms.indexOf("RED"),o=-1!==r.fecMechanisms.indexOf("ULPFEC"),s=em.matchPrefix(e,"a=ssrc:").map(e=>em.parseSsrcMedia(e)).filter(e=>"cname"===e.attribute),a=s.length>0&&s[0].ssrc,c=em.matchPrefix(e,"a=ssrc-group:FID").map(e=>e.substring(17).split(" ").map(e=>parseInt(e,10)));c.length>0&&c[0].length>1&&c[0][0]===a&&(t=c[0][1]),r.codecs.forEach(e=>{if("RTX"===e.name.toUpperCase()&&e.parameters.apt){let r={ssrc:a,codecPayloadType:parseInt(e.parameters.apt,10)};a&&t&&(r.rtx={ssrc:t}),n.push(r),i&&((r=JSON.parse(JSON.stringify(r))).fec={ssrc:a,mechanism:o?"red+ulpfec":"red"},n.push(r))}}),0===n.length&&a&&n.push({ssrc:a});let l=em.matchPrefix(e,"b=");return l.length&&(l=0===l[0].indexOf("b=TIAS:")?parseInt(l[0].substring(7),10):0===l[0].indexOf("b=AS:")?950*parseInt(l[0].substring(5),10)-16e3:void 0,n.forEach(e=>{e.maxBitrate=l})),n},em.parseRtcpParameters=function(e){let t={},n=em.matchPrefix(e,"a=ssrc:").map(e=>em.parseSsrcMedia(e)).filter(e=>"cname"===e.attribute)[0];n&&(t.cname=n.value,t.ssrc=n.ssrc);let r=em.matchPrefix(e,"a=rtcp-rsize");t.reducedSize=r.length>0,t.compound=0===r.length;let i=em.matchPrefix(e,"a=rtcp-mux");return t.mux=i.length>0,t},em.writeRtcpParameters=function(e){let t="";return e.reducedSize&&(t+="a=rtcp-rsize\r\n"),e.mux&&(t+="a=rtcp-mux\r\n"),void 0!==e.ssrc&&e.cname&&(t+="a=ssrc:"+e.ssrc+" cname:"+e.cname+"\r\n"),t},em.parseMsid=function(e){let t;let n=em.matchPrefix(e,"a=msid:");if(1===n.length)return{stream:(t=n[0].substring(7).split(" "))[0],track:t[1]};let r=em.matchPrefix(e,"a=ssrc:").map(e=>em.parseSsrcMedia(e)).filter(e=>"msid"===e.attribute);if(r.length>0)return{stream:(t=r[0].value.split(" "))[0],track:t[1]}},em.parseSctpDescription=function(e){let t;let n=em.parseMLine(e),r=em.matchPrefix(e,"a=max-message-size:");r.length>0&&(t=parseInt(r[0].substring(19),10)),isNaN(t)&&(t=65536);let i=em.matchPrefix(e,"a=sctp-port:");if(i.length>0)return{port:parseInt(i[0].substring(12),10),protocol:n.fmt,maxMessageSize:t};let o=em.matchPrefix(e,"a=sctpmap:");if(o.length>0){let e=o[0].substring(10).split(" ");return{port:parseInt(e[0],10),protocol:e[1],maxMessageSize:t}}},em.writeSctpDescription=function(e,t){let n=[];return n="DTLS/SCTP"!==e.protocol?["m="+e.kind+" 9 "+e.protocol+" "+t.protocol+"\r\n","c=IN IP4 0.0.0.0\r\n","a=sctp-port:"+t.port+"\r\n"]:["m="+e.kind+" 9 "+e.protocol+" "+t.port+"\r\n","c=IN IP4 0.0.0.0\r\n","a=sctpmap:"+t.port+" "+t.protocol+" 65535\r\n"],void 0!==t.maxMessageSize&&n.push("a=max-message-size:"+t.maxMessageSize+"\r\n"),n.join("")},em.generateSessionId=function(){return Math.random().toString().substr(2,22)},em.writeSessionBoilerplate=function(e,t,n){return"v=0\r\no="+(n||"thisisadapterortc")+" "+(e||em.generateSessionId())+" "+(void 0!==t?t:2)+" IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"},em.getDirection=function(e,t){let n=em.splitLines(e);for(let e=0;e<n.length;e++)switch(n[e]){case"a=sendrecv":case"a=sendonly":case"a=recvonly":case"a=inactive":return n[e].substring(2)}return t?em.getDirection(t):"sendrecv"},em.getKind=function(e){return em.splitLines(e)[0].split(" ")[0].substring(2)},em.isRejected=function(e){return"0"===e.split(" ",2)[1]},em.parseMLine=function(e){let t=em.splitLines(e)[0].substring(2).split(" ");return{kind:t[0],port:parseInt(t[1],10),protocol:t[2],fmt:t.slice(3).join(" ")}},em.parseOLine=function(e){let t=em.matchPrefix(e,"o=")[0].substring(2).split(" ");return{username:t[0],sessionId:t[1],sessionVersion:parseInt(t[2],10),netType:t[3],addressType:t[4],address:t[5]}},em.isValidSDP=function(e){if("string"!=typeof e||0===e.length)return!1;let t=em.splitLines(e);for(let e=0;e<t.length;e++)if(t[e].length<2||"="!==t[e].charAt(1))return!1;return!0},ef=em;let eS=function({window:e}={},t={shimChrome:!0,shimFirefox:!0,shimSafari:!0}){let n=function(e){let t={browser:null,version:null};if(void 0===e||!e.navigator||!e.navigator.userAgent)return t.browser="Not a browser.",t;let{navigator:n}=e;if(n.userAgentData&&n.userAgentData.brands){let e=n.userAgentData.brands.find(e=>"Chromium"===e.brand);if(e)return{browser:"chrome",version:parseInt(e.version,10)}}return n.mozGetUserMedia?(t.browser="firefox",t.version=p(n.userAgent,/Firefox\/(\d+)\./,1)):n.webkitGetUserMedia||!1===e.isSecureContext&&e.webkitRTCPeerConnection?(t.browser="chrome",t.version=p(n.userAgent,/Chrom(e|ium)\/(\d+)\./,2)):e.RTCPeerConnection&&n.userAgent.match(/AppleWebKit\/(\d+)\./)?(t.browser="safari",t.version=p(n.userAgent,/AppleWebKit\/(\d+)\./,1),t.supportsUnifiedPlan=e.RTCRtpTransceiver&&"currentDirection"in e.RTCRtpTransceiver.prototype):t.browser="Not a supported browser.",t}(e),r={browserDetails:n,commonShim:eu,extractVersion:p,disableLog:h,disableWarnings:u,sdp:ef};switch(n.browser){case"chrome":if(!j||!j.shimPeerConnection||!t.shimChrome){f("Chrome shim is not included in this adapter release.");break}if(null===n.version){f("Chrome shim can not determine version, not shimming.");break}f("adapter.js shimming chrome."),r.browserShim=j,ek(e,n),eT(e,n),j.shimGetUserMedia(e,n),j.shimMediaStream(e,n),j.shimPeerConnection(e,n),j.shimOnTrack(e,n),j.shimAddTrackRemoveTrack(e,n),j.shimGetSendersWithDtmf(e,n),j.shimSenderReceiverGetStats(e,n),j.fixNegotiationNeeded(e,n),eg(e,n),ey(e,n),eb(e,n),e_(e,n),eC(e,n),ev(e,n);break;case"firefox":if(!V||!V.shimPeerConnection||!t.shimFirefox){f("Firefox shim is not included in this adapter release.");break}f("adapter.js shimming firefox."),r.browserShim=V,ek(e,n),eT(e,n),V.shimGetUserMedia(e,n),V.shimPeerConnection(e,n),V.shimOnTrack(e,n),V.shimRemoveStream(e,n),V.shimSenderGetStats(e,n),V.shimReceiverGetStats(e,n),V.shimRTCDataChannel(e,n),V.shimAddTransceiver(e,n),V.shimGetParameters(e,n),V.shimCreateOffer(e,n),V.shimCreateAnswer(e,n),eg(e,n),eb(e,n),e_(e,n),eC(e,n);break;case"safari":if(!er||!t.shimSafari){f("Safari shim is not included in this adapter release.");break}f("adapter.js shimming safari."),r.browserShim=er,ek(e,n),eT(e,n),er.shimRTCIceServerUrls(e,n),er.shimCreateOfferLegacy(e,n),er.shimCallbacksAPI(e,n),er.shimLocalStreamsAPI(e,n),er.shimRemoteStreamsAPI(e,n),er.shimTrackEventTransceiver(e,n),er.shimGetUserMedia(e,n),er.shimAudioContext(e,n),eg(e,n),ey(e,n),e_(e,n),eC(e,n),ev(e,n);break;default:f("Unsupported browser!")}return r}({window:"undefined"==typeof window?void 0:window}),eR=eS.default||eS,eP=new class{isWebRTCSupported(){return"undefined"!=typeof RTCPeerConnection}isBrowserSupported(){let e=this.getBrowser(),t=this.getVersion();return!!this.supportedBrowsers.includes(e)&&("chrome"===e?t>=this.minChromeVersion:"firefox"===e?t>=this.minFirefoxVersion:"safari"===e&&!this.isIOS&&t>=this.minSafariVersion)}getBrowser(){return eR.browserDetails.browser}getVersion(){return eR.browserDetails.version||0}isUnifiedPlanSupported(){let e;let t=this.getBrowser(),n=eR.browserDetails.version||0;if("chrome"===t&&n<this.minChromeVersion)return!1;if("firefox"===t&&n>=this.minFirefoxVersion)return!0;if(!window.RTCRtpTransceiver||!("currentDirection"in RTCRtpTransceiver.prototype))return!1;let r=!1;try{(e=new RTCPeerConnection).addTransceiver("audio"),r=!0}catch(e){}finally{e&&e.close()}return r}toString(){return`Supports:
    browser:${this.getBrowser()}
    version:${this.getVersion()}
    isIOS:${this.isIOS}
    isWebRTCSupported:${this.isWebRTCSupported()}
    isBrowserSupported:${this.isBrowserSupported()}
    isUnifiedPlanSupported:${this.isUnifiedPlanSupported()}`}constructor(){this.isIOS="undefined"!=typeof navigator&&["iPad","iPhone","iPod"].includes(navigator.platform),this.supportedBrowsers=["firefox","chrome","safari"],this.minFirefoxVersion=59,this.minChromeVersion=72,this.minSafariVersion=605}},ew=e=>!e||/^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/.test(e),eE=()=>Math.random().toString(36).slice(2),eD={iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:["turn:eu-0.turn.peerjs.com:3478","turn:us-0.turn.peerjs.com:3478"],username:"peerjs",credential:"peerjsp"}],sdpSemantics:"unified-plan"},ex=new class extends n{noop(){}blobToArrayBuffer(e,t){let n=new FileReader;return n.onload=function(e){e.target&&t(e.target.result)},n.readAsArrayBuffer(e),n}binaryStringToArrayBuffer(e){let t=new Uint8Array(e.length);for(let n=0;n<e.length;n++)t[n]=255&e.charCodeAt(n);return t.buffer}isSecure(){return"https:"===location.protocol}constructor(...e){super(...e),this.CLOUD_HOST="0.peerjs.com",this.CLOUD_PORT=443,this.chunkedBrowsers={Chrome:1,chrome:1},this.defaultConfig=eD,this.browser=eP.getBrowser(),this.browserVersion=eP.getVersion(),this.pack=o,this.unpack=i,this.supports=function(){let e;let t={browser:eP.isBrowserSupported(),webRTC:eP.isWebRTCSupported(),audioVideo:!1,data:!1,binaryBlob:!1,reliable:!1};if(!t.webRTC)return t;try{let n;e=new RTCPeerConnection(eD),t.audioVideo=!0;try{n=e.createDataChannel("_PEERJSTEST",{ordered:!0}),t.data=!0,t.reliable=!!n.ordered;try{n.binaryType="blob",t.binaryBlob=!eP.isIOS}catch(e){}}catch(e){}finally{n&&n.close()}}catch(e){}finally{e&&e.close()}return t}(),this.validateId=ew,this.randomToken=eE}};(_=P||(P={}))[_.Disabled=0]="Disabled",_[_.Errors=1]="Errors",_[_.Warnings=2]="Warnings",_[_.All=3]="All";var eI=new class{get logLevel(){return this._logLevel}set logLevel(e){this._logLevel=e}log(...e){this._logLevel>=3&&this._print(3,...e)}warn(...e){this._logLevel>=2&&this._print(2,...e)}error(...e){this._logLevel>=1&&this._print(1,...e)}setLogFunction(e){this._print=e}_print(e,...t){let n=["PeerJS: ",...t];for(let e in n)n[e]instanceof Error&&(n[e]="("+n[e].name+") "+n[e].message);e>=3?console.log(...n):e>=2?console.warn("WARNING",...n):e>=1&&console.error("ERROR",...n)}constructor(){this._logLevel=0}},eM={},eO=Object.prototype.hasOwnProperty,ej="~";function eL(){}function eA(e,t,n){this.fn=e,this.context=t,this.once=n||!1}function eB(e,t,n,r,i){if("function"!=typeof n)throw TypeError("The listener must be a function");var o=new eA(n,r||e,i),s=ej?ej+t:t;return e._events[s]?e._events[s].fn?e._events[s]=[e._events[s],o]:e._events[s].push(o):(e._events[s]=o,e._eventsCount++),e}function eF(e,t){0==--e._eventsCount?e._events=new eL:delete e._events[t]}function eU(){this._events=new eL,this._eventsCount=0}Object.create&&(eL.prototype=Object.create(null),new eL().__proto__||(ej=!1)),eU.prototype.eventNames=function(){var e,t,n=[];if(0===this._eventsCount)return n;for(t in e=this._events)eO.call(e,t)&&n.push(ej?t.slice(1):t);return Object.getOwnPropertySymbols?n.concat(Object.getOwnPropertySymbols(e)):n},eU.prototype.listeners=function(e){var t=ej?ej+e:e,n=this._events[t];if(!n)return[];if(n.fn)return[n.fn];for(var r=0,i=n.length,o=Array(i);r<i;r++)o[r]=n[r].fn;return o},eU.prototype.listenerCount=function(e){var t=ej?ej+e:e,n=this._events[t];return n?n.fn?1:n.length:0},eU.prototype.emit=function(e,t,n,r,i,o){var s=ej?ej+e:e;if(!this._events[s])return!1;var a,c,l=this._events[s],p=arguments.length;if(l.fn){switch(l.once&&this.removeListener(e,l.fn,void 0,!0),p){case 1:return l.fn.call(l.context),!0;case 2:return l.fn.call(l.context,t),!0;case 3:return l.fn.call(l.context,t,n),!0;case 4:return l.fn.call(l.context,t,n,r),!0;case 5:return l.fn.call(l.context,t,n,r,i),!0;case 6:return l.fn.call(l.context,t,n,r,i,o),!0}for(c=1,a=Array(p-1);c<p;c++)a[c-1]=arguments[c];l.fn.apply(l.context,a)}else{var d,h=l.length;for(c=0;c<h;c++)switch(l[c].once&&this.removeListener(e,l[c].fn,void 0,!0),p){case 1:l[c].fn.call(l[c].context);break;case 2:l[c].fn.call(l[c].context,t);break;case 3:l[c].fn.call(l[c].context,t,n);break;case 4:l[c].fn.call(l[c].context,t,n,r);break;default:if(!a)for(d=1,a=Array(p-1);d<p;d++)a[d-1]=arguments[d];l[c].fn.apply(l[c].context,a)}}return!0},eU.prototype.on=function(e,t,n){return eB(this,e,t,n,!1)},eU.prototype.once=function(e,t,n){return eB(this,e,t,n,!0)},eU.prototype.removeListener=function(e,t,n,r){var i=ej?ej+e:e;if(!this._events[i])return this;if(!t)return eF(this,i),this;var o=this._events[i];if(o.fn)o.fn!==t||r&&!o.once||n&&o.context!==n||eF(this,i);else{for(var s=0,a=[],c=o.length;s<c;s++)(o[s].fn!==t||r&&!o[s].once||n&&o[s].context!==n)&&a.push(o[s]);a.length?this._events[i]=1===a.length?a[0]:a:eF(this,i)}return this},eU.prototype.removeAllListeners=function(e){var t;return e?(t=ej?ej+e:e,this._events[t]&&eF(this,t)):(this._events=new eL,this._eventsCount=0),this},eU.prototype.off=eU.prototype.removeListener,eU.prototype.addListener=eU.prototype.on,eU.prefixed=ej,eU.EventEmitter=eU,eM=eU,(C=w||(w={})).Data="data",C.Media="media",(b=E||(E={})).BrowserIncompatible="browser-incompatible",b.Disconnected="disconnected",b.InvalidID="invalid-id",b.InvalidKey="invalid-key",b.Network="network",b.PeerUnavailable="peer-unavailable",b.SslUnavailable="ssl-unavailable",b.ServerError="server-error",b.SocketError="socket-error",b.SocketClosed="socket-closed",b.UnavailableID="unavailable-id",b.WebRTC="webrtc",(v=D||(D={})).NegotiationFailed="negotiation-failed",v.ConnectionClosed="connection-closed",(k=x||(x={})).NotOpenYet="not-open-yet",k.MessageToBig="message-too-big",(T=I||(I={})).Binary="binary",T.BinaryUTF8="binary-utf8",T.JSON="json",T.None="raw",(S=M||(M={})).Message="message",S.Disconnected="disconnected",S.Error="error",S.Close="close",(R=O||(O={})).Heartbeat="HEARTBEAT",R.Candidate="CANDIDATE",R.Offer="OFFER",R.Answer="ANSWER",R.Open="OPEN",R.Error="ERROR",R.IdTaken="ID-TAKEN",R.InvalidKey="INVALID-KEY",R.Leave="LEAVE",R.Expire="EXPIRE";var ez={};ez=JSON.parse('{"name":"peerjs","version":"1.5.4","keywords":["peerjs","webrtc","p2p","rtc"],"description":"PeerJS client","homepage":"https://peerjs.com","bugs":{"url":"https://github.com/peers/peerjs/issues"},"repository":{"type":"git","url":"https://github.com/peers/peerjs"},"license":"MIT","contributors":["Michelle Bu <michelle@michellebu.com>","afrokick <devbyru@gmail.com>","ericz <really.ez@gmail.com>","Jairo <kidandcat@gmail.com>","Jonas Gloning <34194370+jonasgloning@users.noreply.github.com>","Jairo Caro-Accino Viciana <jairo@galax.be>","Carlos Caballero <carlos.caballero.gonzalez@gmail.com>","hc <hheennrryy@gmail.com>","Muhammad Asif <capripio@gmail.com>","PrashoonB <prashoonbhattacharjee@gmail.com>","Harsh Bardhan Mishra <47351025+HarshCasper@users.noreply.github.com>","akotynski <aleksanderkotbury@gmail.com>","lmb <i@lmb.io>","Jairooo <jairocaro@msn.com>","Moritz Stückler <moritz.stueckler@gmail.com>","Simon <crydotsnakegithub@gmail.com>","Denis Lukov <denismassters@gmail.com>","Philipp Hancke <fippo@andyet.net>","Hans Oksendahl <hansoksendahl@gmail.com>","Jess <jessachandler@gmail.com>","khankuan <khankuan@gmail.com>","DUODVK <kurmanov.work@gmail.com>","XiZhao <kwang1imsa@gmail.com>","Matthias Lohr <matthias@lohr.me>","=frank tree <=frnktrb@googlemail.com>","Andre Eckardt <aeckardt@outlook.com>","Chris Cowan <agentme49@gmail.com>","Alex Chuev <alex@chuev.com>","alxnull <alxnull@e.mail.de>","Yemel Jardi <angel.jardi@gmail.com>","Ben Parnell <benjaminparnell.94@gmail.com>","Benny Lichtner <bennlich@gmail.com>","fresheneesz <bitetrudpublic@gmail.com>","bob.barstead@exaptive.com <bob.barstead@exaptive.com>","chandika <chandika@gmail.com>","emersion <contact@emersion.fr>","Christopher Van <cvan@users.noreply.github.com>","eddieherm <edhermoso@gmail.com>","Eduardo Pinho <enet4mikeenet@gmail.com>","Evandro Zanatta <ezanatta@tray.net.br>","Gardner Bickford <gardner@users.noreply.github.com>","Gian Luca <gianluca.cecchi@cynny.com>","PatrickJS <github@gdi2290.com>","jonnyf <github@jonathanfoss.co.uk>","Hizkia Felix <hizkifw@gmail.com>","Hristo Oskov <hristo.oskov@gmail.com>","Isaac Madwed <i.madwed@gmail.com>","Ilya Konanykhin <ilya.konanykhin@gmail.com>","jasonbarry <jasbarry@me.com>","Jonathan Burke <jonathan.burke.1311@googlemail.com>","Josh Hamit <josh.hamit@gmail.com>","Jordan Austin <jrax86@gmail.com>","Joel Wetzell <jwetzell@yahoo.com>","xizhao <kevin.wang@cloudera.com>","Alberto Torres <kungfoobar@gmail.com>","Jonathan Mayol <mayoljonathan@gmail.com>","Jefferson Felix <me@jsfelix.dev>","Rolf Erik Lekang <me@rolflekang.com>","Kevin Mai-Husan Chia <mhchia@users.noreply.github.com>","Pepijn de Vos <pepijndevos@gmail.com>","JooYoung <qkdlql@naver.com>","Tobias Speicher <rootcommander@gmail.com>","Steve Blaurock <sblaurock@gmail.com>","Kyrylo Shegeda <shegeda@ualberta.ca>","Diwank Singh Tomer <singh@diwank.name>","Sören Balko <Soeren.Balko@gmail.com>","Arpit Solanki <solankiarpit1997@gmail.com>","Yuki Ito <yuki@gnnk.net>","Artur Zayats <zag2art@gmail.com>"],"funding":{"type":"opencollective","url":"https://opencollective.com/peer"},"collective":{"type":"opencollective","url":"https://opencollective.com/peer"},"files":["dist/*"],"sideEffects":["lib/global.ts","lib/supports.ts"],"main":"dist/bundler.cjs","module":"dist/bundler.mjs","browser-minified":"dist/peerjs.min.js","browser-unminified":"dist/peerjs.js","browser-minified-msgpack":"dist/serializer.msgpack.mjs","types":"dist/types.d.ts","engines":{"node":">= 14"},"targets":{"types":{"source":"lib/exports.ts"},"main":{"source":"lib/exports.ts","sourceMap":{"inlineSources":true}},"module":{"source":"lib/exports.ts","includeNodeModules":["eventemitter3"],"sourceMap":{"inlineSources":true}},"browser-minified":{"context":"browser","outputFormat":"global","optimize":true,"engines":{"browsers":"chrome >= 83, edge >= 83, firefox >= 80, safari >= 15"},"source":"lib/global.ts"},"browser-unminified":{"context":"browser","outputFormat":"global","optimize":false,"engines":{"browsers":"chrome >= 83, edge >= 83, firefox >= 80, safari >= 15"},"source":"lib/global.ts"},"browser-minified-msgpack":{"context":"browser","outputFormat":"esmodule","isLibrary":true,"optimize":true,"engines":{"browsers":"chrome >= 83, edge >= 83, firefox >= 102, safari >= 15"},"source":"lib/dataconnection/StreamConnection/MsgPack.ts"}},"scripts":{"contributors":"git-authors-cli --print=false && prettier --write package.json && git add package.json package-lock.json && git commit -m \\"chore(contributors): update and sort contributors list\\"","check":"tsc --noEmit && tsc -p e2e/tsconfig.json --noEmit","watch":"parcel watch","build":"rm -rf dist && parcel build","prepublishOnly":"npm run build","test":"jest","test:watch":"jest --watch","coverage":"jest --coverage --collectCoverageFrom=\\"./lib/**\\"","format":"prettier --write .","format:check":"prettier --check .","semantic-release":"semantic-release","e2e":"wdio run e2e/wdio.local.conf.ts","e2e:bstack":"wdio run e2e/wdio.bstack.conf.ts"},"devDependencies":{"@parcel/config-default":"^2.9.3","@parcel/packager-ts":"^2.9.3","@parcel/transformer-typescript-tsc":"^2.9.3","@parcel/transformer-typescript-types":"^2.9.3","@semantic-release/changelog":"^6.0.1","@semantic-release/git":"^10.0.1","@swc/core":"^1.3.27","@swc/jest":"^0.2.24","@types/jasmine":"^4.3.4","@wdio/browserstack-service":"^8.11.2","@wdio/cli":"^8.11.2","@wdio/globals":"^8.11.2","@wdio/jasmine-framework":"^8.11.2","@wdio/local-runner":"^8.11.2","@wdio/spec-reporter":"^8.11.2","@wdio/types":"^8.10.4","http-server":"^14.1.1","jest":"^29.3.1","jest-environment-jsdom":"^29.3.1","mock-socket":"^9.0.0","parcel":"^2.9.3","prettier":"^3.0.0","semantic-release":"^21.0.0","ts-node":"^10.9.1","typescript":"^5.0.0","wdio-geckodriver-service":"^5.0.1"},"dependencies":{"@msgpack/msgpack":"^2.8.0","eventemitter3":"^4.0.7","peerjs-js-binarypack":"^2.1.0","webrtc-adapter":"^9.0.0"},"alias":{"process":false,"buffer":false}}');class eN extends eM.EventEmitter{start(e,t){this._id=e;let n=`${this._baseUrl}&id=${e}&token=${t}`;!this._socket&&this._disconnected&&(this._socket=new WebSocket(n+"&version="+ez.version),this._disconnected=!1,this._socket.onmessage=e=>{let t;try{t=JSON.parse(e.data),eI.log("Server message received:",t)}catch(t){eI.log("Invalid server message",e.data);return}this.emit(M.Message,t)},this._socket.onclose=e=>{this._disconnected||(eI.log("Socket closed.",e),this._cleanup(),this._disconnected=!0,this.emit(M.Disconnected))},this._socket.onopen=()=>{this._disconnected||(this._sendQueuedMessages(),eI.log("Socket open"),this._scheduleHeartbeat())})}_scheduleHeartbeat(){this._wsPingTimer=setTimeout(()=>{this._sendHeartbeat()},this.pingInterval)}_sendHeartbeat(){if(!this._wsOpen()){eI.log("Cannot send heartbeat, because socket closed");return}let e=JSON.stringify({type:O.Heartbeat});this._socket.send(e),this._scheduleHeartbeat()}_wsOpen(){return!!this._socket&&1===this._socket.readyState}_sendQueuedMessages(){let e=[...this._messagesQueue];for(let t of(this._messagesQueue=[],e))this.send(t)}send(e){if(this._disconnected)return;if(!this._id){this._messagesQueue.push(e);return}if(!e.type){this.emit(M.Error,"Invalid message");return}if(!this._wsOpen())return;let t=JSON.stringify(e);this._socket.send(t)}close(){this._disconnected||(this._cleanup(),this._disconnected=!0)}_cleanup(){this._socket&&(this._socket.onopen=this._socket.onmessage=this._socket.onclose=null,this._socket.close(),this._socket=void 0),clearTimeout(this._wsPingTimer)}constructor(e,t,n,r,i,o=5e3){super(),this.pingInterval=o,this._disconnected=!0,this._messagesQueue=[],this._baseUrl=(e?"wss://":"ws://")+t+":"+n+r+"peerjs?key="+i}}class e${startConnection(e){let t=this._startPeerConnection();if(this.connection.peerConnection=t,this.connection.type===w.Media&&e._stream&&this._addTracksToConnection(e._stream,t),e.originator){let n=this.connection,r={ordered:!!e.reliable},i=t.createDataChannel(n.label,r);n._initializeDataChannel(i),this._makeOffer()}else this.handleSDP("OFFER",e.sdp)}_startPeerConnection(){eI.log("Creating RTCPeerConnection.");let e=new RTCPeerConnection(this.connection.provider.options.config);return this._setupListeners(e),e}_setupListeners(e){let t=this.connection.peer,n=this.connection.connectionId,r=this.connection.type,i=this.connection.provider;eI.log("Listening for ICE candidates."),e.onicecandidate=e=>{e.candidate&&e.candidate.candidate&&(eI.log(`Received ICE candidates for ${t}:`,e.candidate),i.socket.send({type:O.Candidate,payload:{candidate:e.candidate,type:r,connectionId:n},dst:t}))},e.oniceconnectionstatechange=()=>{switch(e.iceConnectionState){case"failed":eI.log("iceConnectionState is failed, closing connections to "+t),this.connection.emitError(D.NegotiationFailed,"Negotiation of connection to "+t+" failed."),this.connection.close();break;case"closed":eI.log("iceConnectionState is closed, closing connections to "+t),this.connection.emitError(D.ConnectionClosed,"Connection to "+t+" closed."),this.connection.close();break;case"disconnected":eI.log("iceConnectionState changed to disconnected on the connection with "+t);break;case"completed":e.onicecandidate=()=>{}}this.connection.emit("iceStateChanged",e.iceConnectionState)},eI.log("Listening for data channel"),e.ondatachannel=e=>{eI.log("Received data channel");let r=e.channel;i.getConnection(t,n)._initializeDataChannel(r)},eI.log("Listening for remote stream"),e.ontrack=e=>{eI.log("Received remote stream");let r=e.streams[0],o=i.getConnection(t,n);o.type===w.Media&&this._addStreamToMediaConnection(r,o)}}cleanup(){eI.log("Cleaning up PeerConnection to "+this.connection.peer);let e=this.connection.peerConnection;if(!e)return;this.connection.peerConnection=null,e.onicecandidate=e.oniceconnectionstatechange=e.ondatachannel=e.ontrack=()=>{};let t="closed"!==e.signalingState,n=!1,r=this.connection.dataChannel;r&&(n=!!r.readyState&&"closed"!==r.readyState),(t||n)&&e.close()}async _makeOffer(){let e=this.connection.peerConnection,t=this.connection.provider;try{let n=await e.createOffer(this.connection.options.constraints);eI.log("Created offer."),this.connection.options.sdpTransform&&"function"==typeof this.connection.options.sdpTransform&&(n.sdp=this.connection.options.sdpTransform(n.sdp)||n.sdp);try{await e.setLocalDescription(n),eI.log("Set localDescription:",n,`for:${this.connection.peer}`);let r={sdp:n,type:this.connection.type,connectionId:this.connection.connectionId,metadata:this.connection.metadata};if(this.connection.type===w.Data){let e=this.connection;r={...r,label:e.label,reliable:e.reliable,serialization:e.serialization}}t.socket.send({type:O.Offer,payload:r,dst:this.connection.peer})}catch(e){"OperationError: Failed to set local offer sdp: Called in wrong state: kHaveRemoteOffer"!=e&&(t.emitError(E.WebRTC,e),eI.log("Failed to setLocalDescription, ",e))}}catch(e){t.emitError(E.WebRTC,e),eI.log("Failed to createOffer, ",e)}}async _makeAnswer(){let e=this.connection.peerConnection,t=this.connection.provider;try{let n=await e.createAnswer();eI.log("Created answer."),this.connection.options.sdpTransform&&"function"==typeof this.connection.options.sdpTransform&&(n.sdp=this.connection.options.sdpTransform(n.sdp)||n.sdp);try{await e.setLocalDescription(n),eI.log("Set localDescription:",n,`for:${this.connection.peer}`),t.socket.send({type:O.Answer,payload:{sdp:n,type:this.connection.type,connectionId:this.connection.connectionId},dst:this.connection.peer})}catch(e){t.emitError(E.WebRTC,e),eI.log("Failed to setLocalDescription, ",e)}}catch(e){t.emitError(E.WebRTC,e),eI.log("Failed to create answer, ",e)}}async handleSDP(e,t){t=new RTCSessionDescription(t);let n=this.connection.peerConnection,r=this.connection.provider;eI.log("Setting remote description",t);try{await n.setRemoteDescription(t),eI.log(`Set remoteDescription:${e} for:${this.connection.peer}`),"OFFER"===e&&await this._makeAnswer()}catch(e){r.emitError(E.WebRTC,e),eI.log("Failed to setRemoteDescription, ",e)}}async handleCandidate(e){eI.log("handleCandidate:",e);try{await this.connection.peerConnection.addIceCandidate(e),eI.log(`Added ICE candidate for:${this.connection.peer}`)}catch(e){this.connection.provider.emitError(E.WebRTC,e),eI.log("Failed to handleCandidate, ",e)}}_addTracksToConnection(e,t){if(eI.log(`add tracks from stream ${e.id} to peer connection`),!t.addTrack)return eI.error("Your browser does't support RTCPeerConnection#addTrack. Ignored.");e.getTracks().forEach(n=>{t.addTrack(n,e)})}_addStreamToMediaConnection(e,t){eI.log(`add stream ${e.id} to media connection ${t.connectionId}`),t.addStream(e)}constructor(e){this.connection=e}}class eJ extends eM.EventEmitter{emitError(e,t){eI.error("Error:",t),this.emit("error",new eV(`${e}`,t))}}class eV extends Error{constructor(e,t){"string"==typeof t?super(t):(super(),Object.assign(this,t)),this.type=e}}class eG extends eJ{get open(){return this._open}constructor(e,t,n){super(),this.peer=e,this.provider=t,this.options=n,this._open=!1,this.metadata=n.metadata}}class eW extends eG{get type(){return w.Media}get localStream(){return this._localStream}get remoteStream(){return this._remoteStream}_initializeDataChannel(e){this.dataChannel=e,this.dataChannel.onopen=()=>{eI.log(`DC#${this.connectionId} dc connection success`),this.emit("willCloseOnRemote")},this.dataChannel.onclose=()=>{eI.log(`DC#${this.connectionId} dc closed for:`,this.peer),this.close()}}addStream(e){eI.log("Receiving stream",e),this._remoteStream=e,super.emit("stream",e)}handleMessage(e){let t=e.type,n=e.payload;switch(e.type){case O.Answer:this._negotiator.handleSDP(t,n.sdp),this._open=!0;break;case O.Candidate:this._negotiator.handleCandidate(n.candidate);break;default:eI.warn(`Unrecognized message type:${t} from peer:${this.peer}`)}}answer(e,t={}){if(this._localStream){eI.warn("Local stream already exists on this MediaConnection. Are you answering a call twice?");return}for(let n of(this._localStream=e,t&&t.sdpTransform&&(this.options.sdpTransform=t.sdpTransform),this._negotiator.startConnection({...this.options._payload,_stream:e}),this.provider._getMessages(this.connectionId)))this.handleMessage(n);this._open=!0}close(){this._negotiator&&(this._negotiator.cleanup(),this._negotiator=null),this._localStream=null,this._remoteStream=null,this.provider&&(this.provider._removeConnection(this),this.provider=null),this.options&&this.options._stream&&(this.options._stream=null),this.open&&(this._open=!1,super.emit("close"))}constructor(e,t,n){super(e,t,n),this._localStream=this.options._stream,this.connectionId=this.options.connectionId||eW.ID_PREFIX+ex.randomToken(),this._negotiator=new e$(this),this._localStream&&this._negotiator.startConnection({_stream:this._localStream,originator:!0})}}eW.ID_PREFIX="mc_";class eH{_buildRequest(e){let t=this._options.secure?"https":"http",{host:n,port:r,path:i,key:o}=this._options,s=new URL(`${t}://${n}:${r}${i}${o}/${e}`);return s.searchParams.set("ts",`${Date.now()}${Math.random()}`),s.searchParams.set("version",ez.version),fetch(s.href,{referrerPolicy:this._options.referrerPolicy})}async retrieveId(){try{let e=await this._buildRequest("id");if(200!==e.status)throw Error(`Error. Status:${e.status}`);return e.text()}catch(t){eI.error("Error retrieving ID",t);let e="";throw"/"===this._options.path&&this._options.host!==ex.CLOUD_HOST&&(e=" If you passed in a `path` to your self-hosted PeerServer, you'll also need to pass in that same path when creating a new Peer."),Error("Could not get an ID from the server."+e)}}async listAllPeers(){try{let e=await this._buildRequest("peers");if(200!==e.status){if(401===e.status){let e="";throw e=this._options.host===ex.CLOUD_HOST?"It looks like you're using the cloud server. You can email team@peerjs.com to enable peer listing for your API key.":"You need to enable `allow_discovery` on your self-hosted PeerServer to use this feature.",Error("It doesn't look like you have permission to list peers IDs. "+e)}throw Error(`Error. Status:${e.status}`)}return e.json()}catch(e){throw eI.error("Error retrieving list peers",e),Error("Could not get list peers from the server."+e)}}constructor(e){this._options=e}}class eY extends eG{get type(){return w.Data}_initializeDataChannel(e){this.dataChannel=e,this.dataChannel.onopen=()=>{eI.log(`DC#${this.connectionId} dc connection success`),this._open=!0,this.emit("open")},this.dataChannel.onmessage=e=>{eI.log(`DC#${this.connectionId} dc onmessage:`,e.data)},this.dataChannel.onclose=()=>{eI.log(`DC#${this.connectionId} dc closed for:`,this.peer),this.close()}}close(e){if(e?.flush){this.send({__peerData:{type:"close"}});return}this._negotiator&&(this._negotiator.cleanup(),this._negotiator=null),this.provider&&(this.provider._removeConnection(this),this.provider=null),this.dataChannel&&(this.dataChannel.onopen=null,this.dataChannel.onmessage=null,this.dataChannel.onclose=null,this.dataChannel=null),this.open&&(this._open=!1,super.emit("close"))}send(e,t=!1){if(!this.open){this.emitError(x.NotOpenYet,"Connection is not open. You should listen for the `open` event before sending messages.");return}return this._send(e,t)}async handleMessage(e){let t=e.payload;switch(e.type){case O.Answer:await this._negotiator.handleSDP(e.type,t.sdp);break;case O.Candidate:await this._negotiator.handleCandidate(t.candidate);break;default:eI.warn("Unrecognized message type:",e.type,"from peer:",this.peer)}}constructor(e,t,n){super(e,t,n),this.connectionId=this.options.connectionId||eY.ID_PREFIX+eE(),this.label=this.options.label||this.connectionId,this.reliable=!!this.options.reliable,this._negotiator=new e$(this),this._negotiator.startConnection(this.options._payload||{originator:!0,reliable:this.reliable})}}eY.ID_PREFIX="dc_",eY.MAX_BUFFERED_AMOUNT=8388608;class eK extends eY{get bufferSize(){return this._bufferSize}_initializeDataChannel(e){super._initializeDataChannel(e),this.dataChannel.binaryType="arraybuffer",this.dataChannel.addEventListener("message",e=>this._handleDataMessage(e))}_bufferedSend(e){(this._buffering||!this._trySend(e))&&(this._buffer.push(e),this._bufferSize=this._buffer.length)}_trySend(e){if(!this.open)return!1;if(this.dataChannel.bufferedAmount>eY.MAX_BUFFERED_AMOUNT)return this._buffering=!0,setTimeout(()=>{this._buffering=!1,this._tryBuffer()},50),!1;try{this.dataChannel.send(e)}catch(e){return eI.error(`DC#:${this.connectionId} Error when sending:`,e),this._buffering=!0,this.close(),!1}return!0}_tryBuffer(){if(!this.open||0===this._buffer.length)return;let e=this._buffer[0];this._trySend(e)&&(this._buffer.shift(),this._bufferSize=this._buffer.length,this._tryBuffer())}close(e){if(e?.flush){this.send({__peerData:{type:"close"}});return}this._buffer=[],this._bufferSize=0,super.close()}constructor(...e){super(...e),this._buffer=[],this._bufferSize=0,this._buffering=!1}}class eX extends eK{close(e){super.close(e),this._chunkedData={}}_handleDataMessage({data:e}){let t=i(e),n=t.__peerData;if(n){if("close"===n.type){this.close();return}this._handleChunk(t);return}this.emit("data",t)}_handleChunk(e){let t=e.__peerData,n=this._chunkedData[t]||{data:[],count:0,total:e.total};if(n.data[e.n]=new Uint8Array(e.data),n.count++,this._chunkedData[t]=n,n.total===n.count){delete this._chunkedData[t];let e=function(e){let t=0;for(let n of e)t+=n.byteLength;let n=new Uint8Array(t),r=0;for(let t of e)n.set(t,r),r+=t.byteLength;return n}(n.data);this._handleDataMessage({data:e})}}_send(e,t){let n=o(e);if(n instanceof Promise)return this._send_blob(n);if(!t&&n.byteLength>this.chunker.chunkedMTU){this._sendChunks(n);return}this._bufferedSend(n)}async _send_blob(e){let t=await e;if(t.byteLength>this.chunker.chunkedMTU){this._sendChunks(t);return}this._bufferedSend(t)}_sendChunks(e){let t=this.chunker.chunk(e);for(let e of(eI.log(`DC#${this.connectionId} Try to send ${t.length} chunks...`),t))this.send(e,!0)}constructor(e,t,r){super(e,t,r),this.chunker=new n,this.serialization=I.Binary,this._chunkedData={}}}class eq extends eK{_handleDataMessage({data:e}){super.emit("data",e)}_send(e,t){this._bufferedSend(e)}constructor(...e){super(...e),this.serialization=I.None}}class eQ extends eK{_handleDataMessage({data:e}){let t=this.parse(this.decoder.decode(e)),n=t.__peerData;if(n&&"close"===n.type){this.close();return}this.emit("data",t)}_send(e,t){let n=this.encoder.encode(this.stringify(e));if(n.byteLength>=ex.chunkedMTU){this.emitError(x.MessageToBig,"Message too big for JSON channel");return}this._bufferedSend(n)}constructor(...e){super(...e),this.serialization=I.JSON,this.encoder=new TextEncoder,this.decoder=new TextDecoder,this.stringify=JSON.stringify,this.parse=JSON.parse}}class eZ extends eJ{get id(){return this._id}get options(){return this._options}get open(){return this._open}get socket(){return this._socket}get connections(){let e=Object.create(null);for(let[t,n]of this._connections)e[t]=n;return e}get destroyed(){return this._destroyed}get disconnected(){return this._disconnected}_createServerConnection(){let e=new eN(this._options.secure,this._options.host,this._options.port,this._options.path,this._options.key,this._options.pingInterval);return e.on(M.Message,e=>{this._handleMessage(e)}),e.on(M.Error,e=>{this._abort(E.SocketError,e)}),e.on(M.Disconnected,()=>{this.disconnected||(this.emitError(E.Network,"Lost connection to server."),this.disconnect())}),e.on(M.Close,()=>{this.disconnected||this._abort(E.SocketClosed,"Underlying socket is already closed.")}),e}_initialize(e){this._id=e,this.socket.start(e,this._options.token)}_handleMessage(e){let t=e.type,n=e.payload,r=e.src;switch(t){case O.Open:this._lastServerId=this.id,this._open=!0,this.emit("open",this.id);break;case O.Error:this._abort(E.ServerError,n.msg);break;case O.IdTaken:this._abort(E.UnavailableID,`ID "${this.id}" is taken`);break;case O.InvalidKey:this._abort(E.InvalidKey,`API KEY "${this._options.key}" is invalid`);break;case O.Leave:eI.log(`Received leave message from ${r}`),this._cleanupPeer(r),this._connections.delete(r);break;case O.Expire:this.emitError(E.PeerUnavailable,`Could not connect to peer ${r}`);break;case O.Offer:{let e=n.connectionId,t=this.getConnection(r,e);if(t&&(t.close(),eI.warn(`Offer received for existing Connection ID:${e}`)),n.type===w.Media){let i=new eW(r,this,{connectionId:e,_payload:n,metadata:n.metadata});t=i,this._addConnection(r,t),this.emit("call",i)}else if(n.type===w.Data){let i=new this._serializers[n.serialization](r,this,{connectionId:e,_payload:n,metadata:n.metadata,label:n.label,serialization:n.serialization,reliable:n.reliable});t=i,this._addConnection(r,t),this.emit("connection",i)}else{eI.warn(`Received malformed connection type:${n.type}`);return}for(let n of this._getMessages(e))t.handleMessage(n);break}default:{if(!n){eI.warn(`You received a malformed message from ${r} of type ${t}`);return}let i=n.connectionId,o=this.getConnection(r,i);o&&o.peerConnection?o.handleMessage(e):i?this._storeMessage(i,e):eI.warn("You received an unrecognized message:",e)}}}_storeMessage(e,t){this._lostMessages.has(e)||this._lostMessages.set(e,[]),this._lostMessages.get(e).push(t)}_getMessages(e){let t=this._lostMessages.get(e);return t?(this._lostMessages.delete(e),t):[]}connect(e,t={}){if(t={serialization:"default",...t},this.disconnected){eI.warn("You cannot connect to a new Peer because you called .disconnect() on this Peer and ended your connection with the server. You can create a new Peer to reconnect, or call reconnect on this peer if you believe its ID to still be available."),this.emitError(E.Disconnected,"Cannot connect to new Peer after disconnecting from server.");return}let n=new this._serializers[t.serialization](e,this,t);return this._addConnection(e,n),n}call(e,t,n={}){if(this.disconnected){eI.warn("You cannot connect to a new Peer because you called .disconnect() on this Peer and ended your connection with the server. You can create a new Peer to reconnect."),this.emitError(E.Disconnected,"Cannot connect to new Peer after disconnecting from server.");return}if(!t){eI.error("To call a peer, you must provide a stream from your browser's `getUserMedia`.");return}let r=new eW(e,this,{...n,_stream:t});return this._addConnection(e,r),r}_addConnection(e,t){eI.log(`add connection ${t.type}:${t.connectionId} to peerId:${e}`),this._connections.has(e)||this._connections.set(e,[]),this._connections.get(e).push(t)}_removeConnection(e){let t=this._connections.get(e.peer);if(t){let n=t.indexOf(e);-1!==n&&t.splice(n,1)}this._lostMessages.delete(e.connectionId)}getConnection(e,t){let n=this._connections.get(e);if(!n)return null;for(let e of n)if(e.connectionId===t)return e;return null}_delayedAbort(e,t){setTimeout(()=>{this._abort(e,t)},0)}_abort(e,t){eI.error("Aborting!"),this.emitError(e,t),this._lastServerId?this.disconnect():this.destroy()}destroy(){this.destroyed||(eI.log(`Destroy peer with ID:${this.id}`),this.disconnect(),this._cleanup(),this._destroyed=!0,this.emit("close"))}_cleanup(){for(let e of this._connections.keys())this._cleanupPeer(e),this._connections.delete(e);this.socket.removeAllListeners()}_cleanupPeer(e){let t=this._connections.get(e);if(t)for(let e of t)e.close()}disconnect(){if(this.disconnected)return;let e=this.id;eI.log(`Disconnect peer with ID:${e}`),this._disconnected=!0,this._open=!1,this.socket.close(),this._lastServerId=e,this._id=null,this.emit("disconnected",e)}reconnect(){if(this.disconnected&&!this.destroyed)eI.log(`Attempting reconnection to server with ID ${this._lastServerId}`),this._disconnected=!1,this._initialize(this._lastServerId);else if(this.destroyed)throw Error("This peer cannot reconnect to the server. It has already been destroyed.");else if(this.disconnected||this.open)throw Error(`Peer ${this.id} cannot reconnect because it is not disconnected from the server!`);else eI.error("In a hurry? We're still trying to make the initial connection!")}listAllPeers(e=e=>{}){this._api.listAllPeers().then(t=>e(t)).catch(e=>this._abort(E.ServerError,e))}constructor(e,t){let n;if(super(),this._serializers={raw:eq,json:eQ,binary:eX,"binary-utf8":eX,default:eX},this._id=null,this._lastServerId=null,this._destroyed=!1,this._disconnected=!1,this._open=!1,this._connections=new Map,this._lostMessages=new Map,e&&e.constructor==Object?t=e:e&&(n=e.toString()),t={debug:0,host:ex.CLOUD_HOST,port:ex.CLOUD_PORT,path:"/",key:eZ.DEFAULT_KEY,token:ex.randomToken(),config:ex.defaultConfig,referrerPolicy:"strict-origin-when-cross-origin",serializers:{},...t},this._options=t,this._serializers={...this._serializers,...this.options.serializers},"/"===this._options.host&&(this._options.host=window.location.hostname),this._options.path&&("/"!==this._options.path[0]&&(this._options.path="/"+this._options.path),"/"!==this._options.path[this._options.path.length-1]&&(this._options.path+="/")),void 0===this._options.secure&&this._options.host!==ex.CLOUD_HOST?this._options.secure=ex.isSecure():this._options.host==ex.CLOUD_HOST&&(this._options.secure=!0),this._options.logFunction&&eI.setLogFunction(this._options.logFunction),eI.logLevel=this._options.debug||0,this._api=new eH(t),this._socket=this._createServerConnection(),!ex.supports.audioVideo&&!ex.supports.data){this._delayedAbort(E.BrowserIncompatible,"The current browser does not support WebRTC");return}if(n&&!ex.validateId(n)){this._delayedAbort(E.InvalidID,`ID "${n}" is invalid`);return}n?this._initialize(n):this._api.retrieveId().then(e=>this._initialize(e)).catch(e=>this._abort(E.ServerError,e))}}eZ.DEFAULT_KEY="peerjs",window.peerjs={Peer:eZ,util:ex},window.Peer=eZ})();


// ---- content.js ----
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
  const EXT_VER = "1.39.0";
  const HB_MS = 4000;
  const GUEST_RETRY_MS = 3500;
  const MAX_GUEST_RETRIES = 20;
  const CONNECT_TIMEOUT_MS = 10000; // v14: a dial that never opens = zombie signaling
  // v26: voice calls are signaled over our own data link (PeerJS conn or the
  // Direct-connect channel) instead of the PeerJS cloud server. Friends on
  // older builds still get the legacy PeerJS call.
  const DC_VOICE_MIN_VER = "1.26.0";
  // v31: always the newest build (the popup checks latest.json next to it)
  const UPDATE_URL = "https://github.com/srv883/Watch-Movies-Together/raw/main/wt-latest.zip"; // (manual installs only; not shown any more)
  // v35: Chrome Web Store installs update through Chrome, not the GitHub zip
  function storeInstall() { try { return !!chrome.runtime.getManifest().update_url; } catch (_) { return false; } }
  // v37: the iPhone build (a Safari userscript) says so in its manifest stand-in
  function iosBuild() { try { return !!chrome.runtime.getManifest().wt_ios; } catch (_) { return false; } }
  function updateHow(mine) {
    // v39: every install updates itself (laptop updater, phone script, Chrome Web Store)
    if (storeInstall() && !iosBuild()) return mine ? "Chrome updates it automatically" : "Chrome updates theirs automatically";
    return mine ? "yours updates itself within minutes" : "theirs updates itself within minutes";
  }
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
    // v37: on iPhone a touch only counts as a user gesture at touchend / click
    // (not pointerdown), so audio can only be unlocked there
    document.addEventListener("touchend", () => { try { resumeRemoteAudio(); } catch (_) {} }, opts);
    document.addEventListener("click", () => { try { resumeRemoteAudio(); } catch (_) {} }, opts);
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
  // v35: noise gate on the friend's voice. Every 20 ms: their level over
  // (floor x GATE_OPEN_OVER) -> open at once; quiet for GATE_HOLD_MS -> fade the
  // gaps down so the boosted chain plays them at half their arriving level
  // (never louder). Hidden tab (timers throttled) -> gate stays open.
  const GATE_TICK_MS = 20;
  const GATE_OPEN_OVER = 4;        // +12 dB over their noise floor counts as voice
  const GATE_HOLD_MS = 250;        // keep open through short pauses inside words
  const GATE_GAP_LEVEL = 0.35;     // gaps end up at x0.35 of what arrived (-9 dB)
  const GATE_MIN = 0.02;           // (x16 boost x 0.02 = x0.32: even maximum boost never lifts the gaps)
  const GATE_SPREAD_FRAMES = 15;   // ~300 ms of 20 ms levels
  const GATE_SPEECH_SPREAD_DB = 5; // speech varies >= 4 dB frame to frame; steady noise ~1-2 dB
  const GATE_LOUD_OVER = 8;        // anything 18 dB over the open threshold opens anyway (shouting)
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
    clearInterval(vb.gateTimer);
    for (const n of [vb.src, vb.analyser, vb.gain, vb.gate, vb.comp, vb.fix, vb.post]) {
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

  function gateTick(vb) {
    if (S.vb !== vb || !vb.gate) return;
    const now = Date.now();
    let target = 1;
    let hidden = false;
    try { hidden = !!document.hidden; } catch (_) {}
    if (!hidden) {
      let rms = 0;
      try {
        vb.analyser.getFloatTimeDomainData(vb.gateBuf);
        let s = 0;
        for (let i = 0; i < vb.gateBuf.length; i++) s += vb.gateBuf[i] * vb.gateBuf[i];
        rms = Math.sqrt(s / vb.gateBuf.length);
      } catch (_) { rms = 1; }
      const thr = Math.max(VB_SPEECH_MIN * 0.7, (vb.floor || 0) * GATE_OPEN_OVER);
      // speech flickers syllable by syllable; a fan / TV hiss / traffic is steady.
      // Spread of the last ~300 ms of 20 ms levels (dB) tells them apart.
      const db = 20 * Math.log10(rms + 1e-9);
      const L = vb.gateLev || (vb.gateLev = []);
      L.push(db); if (L.length > GATE_SPREAD_FRAMES) L.shift();
      let mean = 0; for (const x of L) mean += x; mean /= L.length;
      let v = 0; for (const x of L) v += (x - mean) * (x - mean);
      const spread = Math.sqrt(v / L.length);
      const loud = rms >= thr;
      if (loud && (spread >= GATE_SPEECH_SPREAD_DB || rms >= thr * GATE_LOUD_OVER)) vb.gateOpenAt = now;
      if (now - (vb.gateOpenAt || 0) > GATE_HOLD_MS) {
        // the boosted chain plays the gap at GATE_GAP_LEVEL of what arrived
        target = Math.max(GATE_MIN, Math.min(1, GATE_GAP_LEVEL / Math.max(1, vb.applied || 1)));
      }
    }
    if (target === vb.gateTarget) return;
    const opening = target > vb.gateTarget;
    vb.gateTarget = target;
    try {
      const t = vb.ctx.currentTime;
      vb.gate.gain.cancelScheduledValues(t);
      vb.gate.gain.setTargetAtTime(target, t, opening ? 0.004 : 0.06); // open in ~10 ms, fade over ~150 ms
    } catch (_) { try { vb.gate.gain.value = target; } catch (__) {} }
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
      // v35: noise gate after the boost - the gaps between words (fan, TV,
      // traffic) are turned DOWN instead of being boosted along with the voice
      const gate = ctx.createGain();
      gate.gain.value = 1;
      src.connect(analyser);
      src.connect(gain);
      gain.connect(gate);
      let out = gate;
      if (comp) { gate.connect(comp); comp.connect(fix); out = fix; }
      out.connect(ctx.destination);
      out.connect(post);
      const vb = {
        ctx, src, analyser, gain, gate, comp, fix, post,
        auto: 1, level: 0, floor: 0, hist: [], run: 0, speaking: false, applied: 1, told: false, lastState: ctx.state,
        buf: new Float32Array(analyser.fftSize), timer: null,
        gateBuf: new Float32Array(512), gateOpenAt: 0, gateTarget: 1, gateTimer: null
      };
      S.vb = vb;
      applyVbGain();
      vb.timer = setInterval(() => vbTick(vb), 100);
      vb.gateTimer = setInterval(() => gateTick(vb), GATE_TICK_MS);
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
              sysMsg("\u26a0 " + fw + " has a newer version (v" + hv + ", you have v" + EXT_VER + ") \u2013 " + updateHow(true));
            } else {
              sysMsg("\u26a0 " + fw + " is on an older version (v" + hv + ", you have v" + EXT_VER + ") \u2013 " + updateHow(false));
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
      toast(TV.on ? "🧠 Trivia ON – " + triviaStatus() : "🧠 Trivia OFF");
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
      .map((i) => ({
        t: Math.max(0, i.t), scene: String(i.scene || "").slice(0, 80), fact: String(i.fact).slice(0, 300),
        // v36: the line of dialogue the fact belongs to (one or more spellings)
        cue: (Array.isArray(i.cue) ? i.cue : (typeof i.cue === "string" ? [i.cue] : [])).map((c) => String(c).slice(0, 120)).filter(Boolean).slice(0, 4),
        w: typeof i.w === "number" && i.w > 0 && i.w < 1 ? i.w : null, // how far (fraction of runtime) from its moment the line may match
      }))
      .sort((a, b) => a.t - b.t)
      .slice(0, 40);
  }

  // ---------- v36: subtitles drive the trivia ----------
  // Guessed timings ("about 40% in") were late and the facts weren't about
  // what was on screen. Now every fact is tied to a line of dialogue and pops
  // up when the subtitles show that line. Captions are read from the
  // video's text tracks or from the player's caption element.
  const CAP_SELECTORS = [
    ".player-timedtext",                 // Netflix
    ".shaka-text-container",             // Shaka player (JioHotstar and others)
    ".atvwebplayersdk-captions-text",    // Prime Video
    '[class*="subtitle" i]', '[class*="caption" i]', '[data-testid*="subtitle" i]', '[aria-live]'
  ];
  const CUE_WINDOW_FRAC = 0.25;          // a line only counts in its part of the film (+-25% of the runtime)
  const CAP_HINT_AFTER_S = 120;          // playing this long with line-anchored trivia but no subtitles -> say so

  function normWords(s) {
    return String(s || "").toLowerCase()
      .replace(/<[^>]*>/g, " ")
      .replace(/[‘’'`]/g, "")
      .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
      .trim();
  }

  function captionText() {
    const v = S.video;
    if (!v) return "";
    const parts = [];
    try {
      for (const tr of Array.from(v.textTracks || [])) {
        if (tr.mode === "disabled" || !tr.activeCues) continue;
        for (const c of Array.from(tr.activeCues)) if (c && c.text) parts.push(c.text);
      }
    } catch (_) {}
    let vr = null;
    try { vr = v.getBoundingClientRect(); } catch (_) {}
    const seen = new Set();
    for (const sel of CAP_SELECTORS) {
      let els = [];
      try { els = document.querySelectorAll(sel); } catch (_) { continue; }
      for (const el of els) {
        if (seen.has(el) || (el.closest && el.closest("#wt-root, #wt-quick, #wt-qtype, .wt-trivia, #wt-float-msgs"))) continue;
        seen.add(el);
        const txt = String(el.innerText || el.textContent || "").trim();
        if (!txt || txt.length > 300) continue;
        if (vr) {
          let r = null; try { r = el.getBoundingClientRect(); } catch (_) {}
          if (r && (r.width === 0 || r.bottom < vr.top || r.top > vr.bottom)) continue; // not over the video
        }
        parts.push(txt);
      }
    }
    return normWords(parts.join(" "));
  }

  function cueMatches(capWords, cue) {
    const c = normWords(cue);
    if (!c) return false;
    if ((" " + capWords + " ").indexOf(" " + c + " ") !== -1) return true;
    // subtitles often differ a little ("gonna"/"going to", split lines): >= 80% of the line's words
    const cw = c.split(" ");
    if (cw.length < 3) return false;
    const have = new Set(capWords.split(" "));
    let n = 0; for (const w of cw) if (have.has(w)) n++;
    return n / cw.length >= 0.8;
  }

  function captionTick() {
    if (!TV.on || !TV.items || !TV.items.length) return;
    const v = S.video;
    if (!v || v.paused) return;
    const cap = captionText();
    const now = Date.now();
    if (cap) TV.capSeenAt = now;
    if (!TV.playSince) TV.playSince = now;
    const cued = TV.items.some((it) => it.cue && it.cue.length);
    if (cued && !cap && !TV.capHinted && now - TV.playSince > CAP_HINT_AFTER_S * 1000 && now - (TV.capSeenAt || 0) > CAP_HINT_AFTER_S * 1000) {
      TV.capHinted = true;
      triviaTellOnce("subs:" + TV.key, "🧠 Turn on English subtitles – trivia pops up on the exact line it's about");
    }
    if (!cap) return;
    TV.lastCap = cap; // (checked every tick: the same line can come back at the right moment)
    const t = v.currentTime, d = v.duration;
    for (const it of TV.items) {
      if (TV.shown[it.t] || !it.cue || !it.cue.length) continue;
      if (d > 0 && isFinite(d) && Math.abs(t - it.t) > (it.w || CUE_WINDOW_FRAC) * d) continue; // wrong part of the film
      if (!it.cue.some((c) => cueMatches(cap, c))) continue;
      TV.shown[it.t] = true;
      TV.lastShowAt = now;
      showTriviaCard(it);
      return;
    }
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
    if (err === "no-key" || err === "unknown") { TV.unknown = key; return; } // nothing for this title (a friend may still share)
    if (err === "bad-key") { triviaTellOnce("badkey", "🧠 AI trivia: the API key was rejected – check it in the extension popup"); return; }
    if (err === "declined") return;
    // busy / offline / failed: try again later
    setTimeout(() => { delete TV.asked[key]; }, TRIVIA_RETRY_MS);
  }

  // v35: what the 🧠 button says - so "no trivia" is never a mystery
  function triviaStatus() {
    const v = S.video;
    if (!v) return "start a video";
    if (orphaned()) return "refresh this page to finish the update";
    if (!triviaKey()) {
      if (browsingNow()) return "open an episode or film";
      return v.duration === Infinity ? "no trivia for live TV" : "waiting for the video to load";
    }
    if (TV.items && TV.items.length) {
      const src = { pack: "trivia pack", wikipedia: "Wikipedia", claude: "Claude" }[TV.source] || "";
      const cued = TV.items.filter((it) => it.cue && it.cue.length).length;
      if (cued) {
        // v36: line-anchored - say whether we can read the subtitles
        const subs = Date.now() - (TV.capSeenAt || 0) < 15000 ? "subtitles found" : "turn on English subtitles";
        return cued + " scene facts" + (TV.title ? " for " + TV.title : "") + (src ? " (" + src + ")" : "") + " – each pops up on its line · " + subs;
      }
      const t = v.currentTime;
      const next = TV.items.find((it) => it.t > t && !TV.shown[it.t]);
      return TV.items.length + " facts" + (TV.title ? " for " + TV.title : "") + (src ? " (" + src + ")" : "") +
        (next ? " – next in " + Math.max(1, Math.round((next.t - t) / 60)) + " min" : " – no more after this point");
    }
    if (TV.unknown === TV.key) return "nothing found for this title";
    return "looking up this title…";
  }

  // v35: an extension reload (update) leaves this page running the OLD script,
  // which can no longer reach the extension (no trivia, nothing saved).
  function orphaned() {
    try { return !(chrome && chrome.runtime && chrome.runtime.id); } catch (_) { return true; }
  }
  function orphanTick() {
    if (S.orphanTold || !orphaned()) return;
    S.orphanTold = true;
    showBanner("orphan", "✨ Watch Together was updated – refresh this page to finish (the party rejoins where your friend is)", [
      { label: "Refresh", act: () => { try { location.reload(); } catch (_) {} } },
      { label: "×", act: () => hideBanner("orphan") },
    ]);
  }
  // v35: tell the background a video is playing, so it never reloads itself
  // (self-update) in the middle of a movie - party or not
  function watchingTick() {
    const v = S.video;
    if (!v || v.paused || orphaned() || browsingNow()) return;
    try { chrome.storage.local.set({ wt_watching: { at: Date.now() } }); } catch (_) {}
  }

  function triviaTick() {
    if (!TV.on) return;
    const key = triviaKey();
    if (!key) return;
    if (key !== TV.key) {
      TV.key = key; TV.items = null; TV.shown = {}; TV.title = ""; TV.lastT = 0;
      TV.lastCap = ""; TV.playSince = 0; TV.capHinted = false; // v36
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
      if (it.cue && it.cue.length) continue; // v36: line-anchored facts wait for their line (captionTick)
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

  // v38: invite links join the party on any device (laptop or phone):
  // ".../watch#wt-join=ABC123" -> this tab joins party ABC123 as a guest, under
  // the saved name. The hash never reaches the site's server.
  const JOIN_RE = /[#&]wt-join=([A-Z0-9]{6})(?![A-Z0-9])/i;
  async function joinFromLink() {
    let m = null;
    try { m = JOIN_RE.exec(String(location.hash || "")); } catch (_) {}
    if (!m) return false;
    const code = m[1].toUpperCase();
    try { history.replaceState(history.state, "", location.href.replace(/#.*$/, "")); } catch (_) {}
    try {
      const got = await chrome.storage.local.get(["wt_party", "wt_name"]);
      const cur = got.wt_party;
      if (cur && String(cur.id || "").toUpperCase() === code) return true; // already in it
      const name = String(got.wt_name || "").trim() || "Friend";
      const party = { id: code, role: "guest", name };
      await chrome.storage.local.set({ wt_name: name, wt_party: party, wt_recent: { id: code, role: "guest", name }, wt_status: { state: "connecting" } });
      try { toast("\ud83d\udd17 Joining party " + code + "\u2026"); } catch (_) {}
      return true;
    } catch (_) { return false; }
  }
  window.addEventListener("hashchange", () => { joinFromLink(); });

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
        floor: +S.vb.floor.toFixed(5), speaking: !!S.vb.speaking, gate: +(S.vb.gateTarget || 1).toFixed(3), duck: S.duck ? { base: S.duck.base, vol: S.video ? +S.video.volume.toFixed(3) : null } : null,
        outRms: (() => { try { return +rmsOf(S.vb.post, new Float32Array(S.vb.post.fftSize)).toFixed(4); } catch (_) { return null; } })() } : null,
      gate: !!S.gateTimer, gateMuted: !!S.gateMuted,
      histEntries: S.hist.length,
      // v31
      buf: { me: !!S.bufSent, friend: !!S.friendBuf, hold: !!S.hold, ignore: !!S.holdIgnore,
        rs: S.video && typeof S.video.readyState === "number" ? S.video.readyState : null },
      nav: { key: S.navKey, follow: S.follow ? { key: S.follow.key, left: S.follow.left } : null },
      trivia: { on: TV.on, n: TV.items ? TV.items.length : null, cap: (() => { try { return captionText(); } catch (e) { return "ERR " + e.message; } })(), capSeenAt: TV.capSeenAt || 0 },
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
    setInterval(captionTick, 400); // v36: trivia on the line it is about
    setInterval(orphanTick, 3000); // v35: refresh banner after an update
    setInterval(watchingTick, 20000); // v35: no self-update mid-movie
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
    try { await joinFromLink(); } catch (_) {} // v38: before reading the party
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
    // v38: a join link may already have started it (storage change event)
    if (party && !(S.roomId && !S.stopping && String(party.id || "").toUpperCase() === S.roomId && party.role === S.role)) startParty(party);
  })();
})();


// ---- the toolbar popup, as a panel behind a round button ----
(function () {
  if (window.top !== window) return;
  const host = document.createElement("div");
  host.id = "wt-ios-host";
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = "<style>" + ":host { color-scheme: dark; }\r\n.wtp, .wtp * { box-sizing: border-box; margin: 0; } .wtp {\r\n  width: 320px;\r\n  font-family: \"Segoe UI\", system-ui, sans-serif;\r\n  background: #14141c;\r\n  color: #eee;\r\n  padding: 14px;\r\n}\r\n.hidden { display: none !important; }\r\n\r\nheader {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 10px;\r\n  margin-bottom: 12px;\r\n}\r\nheader img { width: 34px; height: 34px; border-radius: 8px; }\r\nh1 { font-size: 16px; }\r\n#siteName { font-size: 11px; color: #8f8fa3; }\r\n\r\nlabel {\r\n  display: block;\r\n  font-size: 12px;\r\n  color: #aab;\r\n  margin: 10px 0 4px;\r\n}\r\ninput {\r\n  width: 100%;\r\n  padding: 8px 10px;\r\n  border-radius: 8px;\r\n  border: 1px solid #333;\r\n  background: #1e1e2a;\r\n  color: #fff;\r\n  font-size: 14px;\r\n  outline: none;\r\n}\r\ninput:focus { border-color: #e53935; }\r\n\r\nbutton {\r\n  width: 100%;\r\n  padding: 9px;\r\n  margin-top: 8px;\r\n  border: none;\r\n  border-radius: 8px;\r\n  font-size: 13px;\r\n  font-weight: 600;\r\n  cursor: pointer;\r\n  background: #262636;\r\n  color: #eee;\r\n}\r\nbutton:hover { filter: brightness(1.15); }\r\nbutton.primary { background: #e53935; color: #fff; }\r\nbutton.secondary { background: #2d6cdf; color: #fff; }\r\nbutton.danger { background: transparent; color: #ff7b7b; border: 1px solid #55333a; }\r\nbutton.link {\r\n  background: none;\r\n  border: none;\r\n  color: #8ab4f8;\r\n  font-size: 12px;\r\n  padding: 2px 0;\r\n  margin-top: 4px;\r\n  text-align: left;\r\n  width: auto;\r\n}\r\nbutton.link:hover { text-decoration: underline; filter: brightness(1.15); }\r\n#resumeCode { color: #ffd54f; font-family: Consolas, monospace; font-weight: 700; }\r\n\r\n.or {\r\n  text-align: center;\r\n  font-size: 11px;\r\n  color: #667;\r\n  margin: 10px 0 0;\r\n}\r\n\r\n.code-label { font-size: 11px; color: #8f8fa3; text-transform: uppercase; letter-spacing: 1px; }\r\n#codeDisplay {\r\n  font-family: Consolas, monospace;\r\n  font-size: 30px;\r\n  letter-spacing: 5px;\r\n  color: #ffd54f;\r\n  cursor: pointer;\r\n  user-select: all;\r\n}\r\n.small { font-size: 11px; }\r\n\r\n#statusLine { display: flex; align-items: center; gap: 7px; margin: 12px 0 6px; font-size: 13px; }\r\n.dot { width: 9px; height: 9px; border-radius: 50%; background: #888; flex: none; }\r\n.dot.ok { background: #43d17a; box-shadow: 0 0 6px #43d17a88; }\r\n.dot.warn { background: #ffb300; }\r\n.dot.err { background: #e53935; }\r\n\r\n.muted { color: #9a9ab0; font-size: 12px; line-height: 1.45; }\r\nsection p.muted { margin-top: 4px; }\r\n\n/* v25: quick-launch buttons for the supported sites */\n.site-list {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 6px;\n  margin-top: 10px;\n}\n.site-list .site-btn { margin-top: 0; }\n.site-list .site-btn:last-child:nth-child(odd) { grid-column: 1 / -1; }\n\n.off-site {\n  margin: 8px 0 0;\n  padding: 7px 9px;\n  border-radius: 8px;\n  background: #3a2e12;\n  color: #ffd54f;\n  line-height: 1.4;\n}\n\n/* v31: update available */\n.update-bar {\n  margin: 4px 0 10px;\n  padding: 9px 10px 8px;\n  border-radius: 10px;\n  background: #1d2a1f;\n  border: 1px solid #2f5a37;\n}\n.update-bar #updateText { font-size: 13px; font-weight: 600; color: #8ff0a9; }\n.update-bar #updateNotes { margin-top: 3px; }\n.update-bar ol { margin: 6px 0 0 18px; padding: 0; color: #c8c8d8; line-height: 1.5; }\n\n/* v33: AI trivia */\n.trivia-box { margin-top: 14px; padding-top: 10px; border-top: 1px solid #2a2a3a; }\n.trivia-row { display: flex; align-items: center; gap: 8px; margin: 0; color: #eee; font-size: 13px; font-weight: 600; }\n.trivia-row input { width: auto; }\n.key-row { display: flex; gap: 6px; margin-top: 8px; }\n.key-row input { flex: 1; font-size: 12px; }\n.key-row button { width: auto; margin-top: 0; padding: 7px 12px; }\n#keyStatus { margin-top: 6px; color: #9a9ab0; }\n#keyStatus.ok { color: #8ff0a9; }\n#keyStatus.err { color: #ff8a80; }\n" + "\n    .wt-bar { position: fixed; left: calc(4px + env(safe-area-inset-left)); top: 40%;\n      display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 4px;\n      border-radius: 24px; background: rgba(16,16,24,.72); box-shadow: 0 2px 10px rgba(0,0,0,.5);\n      -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);\n      -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;\n      transition: opacity .4s; opacity: 1; }\n    .wt-bar.wt-faded { opacity: .45; }\n    .wt-bar.wt-dragging { transition: none; }\n    .wt-grip { width: 40px; height: 16px; display: flex; align-items: center; justify-content: center; touch-action: none; cursor: grab; }\n    .wt-grip::before { content: \"\"; width: 18px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.45); }\n    .wt-b { position: relative; width: 40px; height: 40px; border-radius: 50%; border: 0; padding: 0; margin: 0;\n      background: rgba(255,255,255,.08); color: #fff; font-size: 19px; line-height: 40px; text-align: center; cursor: pointer;\n      -webkit-tap-highlight-color: transparent; touch-action: manipulation; }\n    .wt-b:active { transform: scale(.92); }\n    .wt-b img { width: 40px; height: 40px; border-radius: 50%; display: block; pointer-events: none; -webkit-user-drag: none; }\n    .wt-b.wt-on { background: #43d17a; color: #0c1a12; }\n    .wt-b.wt-mic-on { background: #e53935; }\n    .wt-b.wt-live::after { content: \"\"; position: absolute; right: 0; top: 0; width: 10px; height: 10px; border-radius: 50%; background: #43d17a; border: 2px solid #14141c; }\n    .wt-sheet { position: fixed; left: 50%; top: calc(8px + env(safe-area-inset-top)); transform: translateX(-50%);\n      width: min(340px, calc(100vw - 16px)); max-height: calc(100vh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom));\n      overflow-y: auto; -webkit-overflow-scrolling: touch; border-radius: 14px; box-shadow: 0 8px 40px rgba(0,0,0,.6); }\n    .wt-sheet .wtp { width: auto; }\n    .wt-x { position: sticky; top: 0; float: right; margin: 6px 6px 0 0; width: 36px; height: 36px; border-radius: 50%; border: 0;\n      background: #2a2a38; color: #ddd; font-size: 17px; line-height: 36px; text-align: center; padding: 0; z-index: 1; }\n    .wt-hidden { display: none !important; }\n    .wt-emo { position: fixed; display: flex; gap: 4px; padding: 5px; border-radius: 26px; background: rgba(16,16,24,.85);\n      -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); box-shadow: 0 2px 10px rgba(0,0,0,.5); }\n    .wt-emo button { width: 42px; height: 42px; border: 0; border-radius: 50%; background: rgba(255,255,255,.08); font-size: 24px; line-height: 42px; padding: 0; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }\n    .wt-emo button:active { transform: scale(1.25); }\n    .wt-hint { position: fixed; left: 50%; top: calc(14px + env(safe-area-inset-top)); transform: translateX(-50%); padding: 8px 14px; border-radius: 18px;\n      background: rgba(16,16,24,.85); color: #fff; font: 14px -apple-system, system-ui, sans-serif; pointer-events: none; }\n    .wt-ios-note { margin: 10px 0 0; font-size: 12px; color: #9a9ab0; line-height: 1.4; }\n    input, button { font-size: 16px; }\n  " + "</style>" +
    '<div class="wt-bar" id="wtBar">' +
      '<div class="wt-grip" id="wtGrip" aria-label="Move"></div>' +
      '<button class="wt-b" id="wtBParty" aria-label="Watch Together party"><img alt="" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAHiElEQVR4nNRaXWxURRT+5u5ud5d2aSm2oLUGgkgxWCAgL0TSBIzxB42SEiSEACZGQmJCUYMhak3A4IN/AY0+EGJ8IiQKBOKDoFWMYPyhAjE+YGpCiybF0m5l2/2bcXbv3Htn7p17d+8CD0zSvb1z7sw55zvfOTN3dg3c5i1azUO9m1hiPFtYGiFsNhi7G4zGDUlugJpXKveVGjWvop/YUqffec4AYWyS/w0xwgZ2ftH8PapoJEj40oZ8F6PFXQRkFTfcVMavhPBhrKSUmPei3yDiynuY9LwzzpF7xlGdnJwEKex5+UhLXygHetblFpMI3uWTdJUeIJYymFfCYCuvSl7qZ45CIhlvy83hjrNSP6GsjxHas+NY67mKDmzfmGkzitGjfJIlNkKhkHfkRvlxVe6PvGq8PC8xx/0cjZGnX/x8+qCvA9u7WdKI5c7yfzstpCAj4YusqUSLrA/yhhQxj/GwQHPmEPOdKyYml/ccbp+wbDYUb2K5zyzjVXqoyBGPMi+yxGUM8UfWi7xy74DG2+LoRPygNgI9G3ILOdf6w3FeRehmcd7RA8cOEQ3+WYgYbP62Y62XlAhw41/1IuyDPIEUZh2y/sgT5kMbj154Im06RaOsyHqVCLyyhaXoZG6IT54Cbg3ng5D347yMPFHlYy31w61rDy/ImeMm83P4ZKmaOY/KnCc6jhMEcl5GXqEVQePw9db7bQoxsA67KghlspGkUqIpCAXQroy8a14Crx649Woiytgs2wH+0VEd5035nM4IDEPP+Se3JbB25xQkG3BDnCd65O37CCQHQKkeeSVRrZJHMH9ZBI9sjKN5JiSETHlTq4G5D0bxwv4UZnFHtYsULOfhizzxQ17c848mJwIGQnGeVwGkhymWPhzHPO6MmgNmSzQQrHujASu3JBGNBtCvOs47uWbJxQbR2gz6cB6+SkttfISi7d4IHuquQ/1Uc7xYcATtgCWPxbHlg6mYdqdhRrRWzhOvficCbuRtzkNb5yEpnRhnoAWG5WviaO+IQAlDyQg+SdNMA5v3NWLRo3FUqvN+nCcKjaUtPEQIgjjvCT8E54XSYh5IX6W4b1kMqWYD7lZyIsJptPL5eqx5c6qZ4NUir7l3QLQdMBCmzquImUiVnL8+SsuG+jb+3D0PxLDp42lo74yG47xth5DLOWBQGrLOQ+WihAgtIrDx9wzEeYI/s7sRK56rFwlemfNEZx+U3Sjz3ec7kRElzJqUWBssz2TBTog8Wbg6ifUfNqPprkhFzrsj49EZyHn3CgsfLjKEaqXcaJwZwfqPmrHg8WQg5611yu2EtgpV2s9b/VbJqcV42QmD02jF1hRW756GRAp6zrsj465C+mXeZ29jN6YYbydcTZ4AbZ11ePZAK2Z0xLQJ7psD9umBD+fdkYE8WJPItTYqKktxkilbeccOJyesKmQWPYpgznsWOTdtmL3nqbnxsX9fyOHrvSPIpR3Ow0Uf+2FIDnhXYE01oprl3NMfnkD8EKP898MnY/jj+ISmhFrIU3t+EyvqOAAgmPOMufbzYowLobAhKBme/qeIL18bwfiVgucN0OOEe7cK5Wgx/LkNiHfyqgwXleXisQx+PDAGFIi0wrpPLcQ5kyuhmeoA9SCvvvZ59/NWv1ItILbmQcbzlTqXYfjqrWu40p9zEK3AeeXeAtdyQFdtTOQlBHzD6tCvnm/kioUAGnHR0PkcTu29hmya2nT05XxJQH3klDkOyFVI5bz3DU2HfCRGMKWR4NLpScyYGy1vDRS77URN4/cTGW/k/MCRV2BJLq83dgSq4bzllNVKtwl+lkELwE+HMmVU3XlsJ+rrI0hfoRIo0t6mCs57IqNWIap4XPEdVvw1TDcwdDGPgbNZqYoJw4WBF47yRD2YBitI8ho47yBPFBBFBAzhGVTaaKuCuXdJtRg4f2ICo0NF9SVItOx/DKfeHsXgr1mpMFTgvJJTfsgzG0A1AjbyREHEu5EC/jyT5cmYL7/cu9+krl0uID9B8c17Y8iOUTUyjIWr8xrk7cjIVYjb/5cZCWg57y6xl/vzLiVOHf9uf1pKPLmKhavzpn4ijnxMuXl4IuTC5rIDvGb0y1zzcF7qVxGCHjGmX8lDc14DngUyl/bboGcWNZ3nvSPuh7Thr/UdVmcUAfRH98RXn1m1yGh336zfbAd6ewnlwtM389zGT7mamEw6EYTC+QrnVN8ScQ5uL/z8nGWfOnn1yLuRs5FXIuGSI8Apoc/vXIr3vO/YLdqOI3ec4olxKDTyQFXvsMG5pEfeS+dyYn/a3Te7z+NAqZFEZjN/6Nwt4zycRTAM5809WXncGZqNbVVshqu989S/7ZEi/YULWjTfjARUo0pyx1kv8pC++dHMa44drENh8eq+eVdlez2b3x1Hp19OJiNz+ejjoTkvR6YazpPqOM8vJ+rGk/PcxmsjILd9Twx3GYzu4nOvspFlsjES8sSp40RyGpBRdsl9kTed53Of5P/tkTkfygGrHewaSGQS9Uv5tzKz+Uraxq8J+Yca1qX8MqP8gEOIy/3mDzr8fuhRvjJk+Tf7g9yTgbV9c278xx63Q/sfAAD//zKZBcEAAAAGSURBVAMAUtCSHuOXTIwAAAAASUVORK5CYII="></button>' +
      '<button class="wt-b wt-hidden" id="wtBChat" aria-label="Chat">💬</button>' +
      '<button class="wt-b wt-hidden" id="wtBMic" aria-label="Microphone">🎤</button>' +
      '<button class="wt-b wt-hidden" id="wtBEmo" aria-label="Quick reaction">😀</button>' +
      '<button class="wt-b wt-hidden" id="wtBFs" aria-label="Fill the screen (chat on top)">⛶</button>' +
      '<button class="wt-b wt-hidden" id="wtBTv" aria-label="The phone’s own full screen">📺</button>' +
    '</div>' +
    '<div class="wt-emo wt-hidden" id="wtEmo"></div>' +
    '<div class="wt-hint wt-hidden" id="wtHint">Swipe up once to hide the browser bar</div>' +
    '<div class="wt-sheet wt-hidden" id="wtSheet"><button class="wt-x" id="wtX" aria-label="Close">✕</button><div class="wtp">' +
    "\n  <header>\n    <img src=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAHiElEQVR4nNRaXWxURRT+5u5ud5d2aSm2oLUGgkgxWCAgL0TSBIzxB42SEiSEACZGQmJCUYMhak3A4IN/AY0+EGJ8IiQKBOKDoFWMYPyhAjE+YGpCiybF0m5l2/2bcXbv3Htn7p17d+8CD0zSvb1z7sw55zvfOTN3dg3c5i1azUO9m1hiPFtYGiFsNhi7G4zGDUlugJpXKveVGjWvop/YUqffec4AYWyS/w0xwgZ2ftH8PapoJEj40oZ8F6PFXQRkFTfcVMavhPBhrKSUmPei3yDiynuY9LwzzpF7xlGdnJwEKex5+UhLXygHetblFpMI3uWTdJUeIJYymFfCYCuvSl7qZ45CIhlvy83hjrNSP6GsjxHas+NY67mKDmzfmGkzitGjfJIlNkKhkHfkRvlxVe6PvGq8PC8xx/0cjZGnX/x8+qCvA9u7WdKI5c7yfzstpCAj4YusqUSLrA/yhhQxj/GwQHPmEPOdKyYml/ccbp+wbDYUb2K5zyzjVXqoyBGPMi+yxGUM8UfWi7xy74DG2+LoRPygNgI9G3ILOdf6w3FeRehmcd7RA8cOEQ3+WYgYbP62Y62XlAhw41/1IuyDPIEUZh2y/sgT5kMbj154Im06RaOsyHqVCLyyhaXoZG6IT54Cbg3ng5D347yMPFHlYy31w61rDy/ImeMm83P4ZKmaOY/KnCc6jhMEcl5GXqEVQePw9db7bQoxsA67KghlspGkUqIpCAXQroy8a14Crx649Woiytgs2wH+0VEd5035nM4IDEPP+Se3JbB25xQkG3BDnCd65O37CCQHQKkeeSVRrZJHMH9ZBI9sjKN5JiSETHlTq4G5D0bxwv4UZnFHtYsULOfhizzxQ17c848mJwIGQnGeVwGkhymWPhzHPO6MmgNmSzQQrHujASu3JBGNBtCvOs47uWbJxQbR2gz6cB6+SkttfISi7d4IHuquQ/1Uc7xYcATtgCWPxbHlg6mYdqdhRrRWzhOvficCbuRtzkNb5yEpnRhnoAWG5WviaO+IQAlDyQg+SdNMA5v3NWLRo3FUqvN+nCcKjaUtPEQIgjjvCT8E54XSYh5IX6W4b1kMqWYD7lZyIsJptPL5eqx5c6qZ4NUir7l3QLQdMBCmzquImUiVnL8+SsuG+jb+3D0PxLDp42lo74yG47xth5DLOWBQGrLOQ+WihAgtIrDx9wzEeYI/s7sRK56rFwlemfNEZx+U3Sjz3ec7kRElzJqUWBssz2TBTog8Wbg6ifUfNqPprkhFzrsj49EZyHn3CgsfLjKEaqXcaJwZwfqPmrHg8WQg5611yu2EtgpV2s9b/VbJqcV42QmD02jF1hRW756GRAp6zrsj465C+mXeZ29jN6YYbydcTZ4AbZ11ePZAK2Z0xLQJ7psD9umBD+fdkYE8WJPItTYqKktxkilbeccOJyesKmQWPYpgznsWOTdtmL3nqbnxsX9fyOHrvSPIpR3Ow0Uf+2FIDnhXYE01oprl3NMfnkD8EKP898MnY/jj+ISmhFrIU3t+EyvqOAAgmPOMufbzYowLobAhKBme/qeIL18bwfiVgucN0OOEe7cK5Wgx/LkNiHfyqgwXleXisQx+PDAGFIi0wrpPLcQ5kyuhmeoA9SCvvvZ59/NWv1ItILbmQcbzlTqXYfjqrWu40p9zEK3AeeXeAtdyQFdtTOQlBHzD6tCvnm/kioUAGnHR0PkcTu29hmya2nT05XxJQH3klDkOyFVI5bz3DU2HfCRGMKWR4NLpScyYGy1vDRS77URN4/cTGW/k/MCRV2BJLq83dgSq4bzllNVKtwl+lkELwE+HMmVU3XlsJ+rrI0hfoRIo0t6mCs57IqNWIap4XPEdVvw1TDcwdDGPgbNZqYoJw4WBF47yRD2YBitI8ho47yBPFBBFBAzhGVTaaKuCuXdJtRg4f2ICo0NF9SVItOx/DKfeHsXgr1mpMFTgvJJTfsgzG0A1AjbyREHEu5EC/jyT5cmYL7/cu9+krl0uID9B8c17Y8iOUTUyjIWr8xrk7cjIVYjb/5cZCWg57y6xl/vzLiVOHf9uf1pKPLmKhavzpn4ijnxMuXl4IuTC5rIDvGb0y1zzcF7qVxGCHjGmX8lDc14DngUyl/bboGcWNZ3nvSPuh7Thr/UdVmcUAfRH98RXn1m1yGh336zfbAd6ewnlwtM389zGT7mamEw6EYTC+QrnVN8ScQ5uL/z8nGWfOnn1yLuRs5FXIuGSI8Apoc/vXIr3vO/YLdqOI3ec4olxKDTyQFXvsMG5pEfeS+dyYn/a3Te7z+NAqZFEZjN/6Nwt4zycRTAM5809WXncGZqNbVVshqu989S/7ZEi/YULWjTfjARUo0pyx1kv8pC++dHMa44drENh8eq+eVdlez2b3x1Hp19OJiNz+ejjoTkvR6YazpPqOM8vJ+rGk/PcxmsjILd9Twx3GYzu4nOvspFlsjES8sSp40RyGpBRdsl9kTed53Of5P/tkTkfygGrHewaSGQS9Uv5tzKz+Uraxq8J+Yca1qX8MqP8gEOIy/3mDzr8fuhRvjJk+Tf7g9yTgbV9c278xx63Q/sfAAD//zKZBcEAAAAGSURBVAMAUtCSHuOXTIwAAAAASUVORK5CYII=\" alt=\"\" />\n    <div>\n      <h1>Watch Together</h1>\n      <p id=\"siteName\">Checking site…</p>\n    </div>\n  </header>\n  <p id=\"verLine\" class=\"muted small\" style=\"margin:4px 14px\"></p>\n\n  <!-- v31: a newer version is out -->\n  <div id=\"updateBar\" class=\"update-bar hidden\">\n    <p id=\"updateText\">🆕 A new version is out</p>\n    <p id=\"updateNotes\" class=\"small muted\"></p>\n    <button id=\"updateBtn\" class=\"primary hidden\">Switch now</button>\n    <button id=\"updateHelpBtn\" class=\"link\">Not updating by itself?</button>\n    <ol id=\"updateHelp\" class=\"small hidden\">\n      <li>Watch Together updates itself through its updater (installed with the one-line installer from the GitHub page). Without it:</li>\n      <li><a id=\"updateZip\" href=\"#\">Download the new version</a>, unzip it, then <b>chrome://extensions</b> → Developer mode → remove the old one → <b>Load unpacked</b>.</li>\n    </ol>\n    <button id=\"extPageBtn\" class=\"link hidden\">Open chrome://extensions</button>\n  </div>\n\n  <section id=\"notSupported\" class=\"hidden\">\n    <p class=\"muted\">Watch Together works on these sites. Open one, start a video, then click this icon again.</p>\n    <div id=\"siteList\" class=\"site-list\"></div>\n  </section>\n\n  <!-- No active party -->\n  <section id=\"setupView\" class=\"hidden\">\n    <label>Your name\n      <input id=\"nameInput\" type=\"text\" maxlength=\"20\" placeholder=\"e.g. Sourav\" />\n    </label>\n\n    <button id=\"createBtn\" class=\"primary\">Start Watch Party</button>\n\n    <p id=\"resumeLine\" class=\"hidden small\">\n      <button id=\"resumeBtn\" class=\"link\">↺ Resume last party</button>\n      <span id=\"resumeCode\"></span>\n    </p>\n\n    <div class=\"or\"><span>or join a friend</span></div>\n\n    <label>Party code\n      <input id=\"codeInput\" type=\"text\" maxlength=\"6\" placeholder=\"ABC123\" autocomplete=\"off\" spellcheck=\"false\" />\n    </label>\n    <button id=\"joinBtn\">Join Party</button>\n  </section>\n\n  <!-- Active party -->\n  <section id=\"activeView\" class=\"hidden\">\n    <p class=\"code-label\">Party code</p>\n    <p id=\"codeDisplay\" title=\"Click to copy\">------</p>\n    <p class=\"muted small\">Your friend: open the same episode → click the icon → enter this code.</p>\n    <p id=\"offSiteHint\" class=\"hidden small off-site\">Not running on this tab — switch to your Netflix / JioHotstar / Prime Video / JioTV / JioCinema tab.</p>\n\n    <p id=\"statusLine\"><span class=\"dot\"></span><span id=\"statusText\">…</span></p>\n\n    <button id=\"copyBtn\" class=\"secondary\">Copy code</button>\n    <button id=\"inviteBtn\" class=\"secondary\">Copy invite</button>\n    <button id=\"leaveBtn\" class=\"danger\">Leave party</button>\n  </section>\n\n  <!-- v33: AI scene trivia -->\n  <section id=\"triviaBox\" class=\"trivia-box\">\n    <label class=\"trivia-row\"><input id=\"triviaOn\" type=\"checkbox\" checked /> <span>🧠 AI scene trivia</span></label>\n    <p class=\"muted small\">Facts float in at the matching moments of the episode or film. Uses your Claude API key (about one request per episode); one of you is enough - it is shared with your friend.</p>\n    <div id=\"keyRow\" class=\"key-row\">\n      <input id=\"keyInput\" type=\"password\" placeholder=\"Claude API key (sk-ant-…)\" autocomplete=\"off\" spellcheck=\"false\" />\n      <button id=\"keySave\" class=\"secondary\">Save</button>\n    </div>\n    <p id=\"keyStatus\" class=\"small\"></p>\n    <button id=\"keyForget\" class=\"link hidden\">Remove key</button>\n  </section>\n\n  \n" +
    '<p class="wt-ios-note">The bar on the side: logo = this panel (start / join / leave), 💬 = chat, 🎤 = your mic, 😀 = quick reaction, ⛶ = fill the screen with chat and trivia on top, 📺 = the phone’s own full-screen player (edge to edge; sync and voice keep going, chat shows again when you leave it). Drag the little handle on top to move the bar. Turn on English subtitles for scene trivia; earphones work best for voice.</p>' +
    '</div></div>';
  const $s = (id) => shadow.getElementById(id);
  const UA = String(navigator.userAgent || "");
  const ANDROID = /Android/i.test(UA);
  // iPhone / iPad (also in "desktop website" mode, which reports a Mac)
  const APPLE_TOUCH = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  // Android browsers can put a page element in full screen; iPhone Safari can't
  const ELEMENT_FS = !APPLE_TOUCH && !!(document.fullscreenEnabled && Element.prototype.requestFullscreen);
  const bar = $s("wtBar"), sheet = $s("wtSheet"), fab = $s("wtBParty");
  const bEmo = $s("wtBEmo"), emo = $s("wtEmo"), bChat = $s("wtBChat"), bMic = $s("wtBMic"), bFs = $s("wtBFs"), bTv = $s("wtBTv"), grip = $s("wtGrip");
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
  // quick reactions: the chat panel's own emoji buttons, one tap each, chat stays closed
  let emoT = 0;
  const emoHide = () => { emo.classList.add("wt-hidden"); bEmo.classList.remove("wt-on"); };
  function emoShow() {
    const src = Array.prototype.slice.call(document.querySelectorAll("#wt-root .wt-react"));
    if (!src.length) return;
    emo.innerHTML = "";
    for (const b of src) {
      const e = document.createElement("button");
      e.textContent = b.dataset.e || b.textContent;
      e.setAttribute("aria-label", "React " + e.textContent);
      e.addEventListener("click", () => { b.click(); window.__wtIosReacts = (window.__wtIosReacts || 0) + 1; clearTimeout(emoT); emoT = setTimeout(emoHide, 3000); wake(); });
      emo.appendChild(e);
    }
    emo.classList.remove("wt-hidden"); bEmo.classList.add("wt-on");
    const br = bar.getBoundingClientRect(), bb = bEmo.getBoundingClientRect(), w = emo.offsetWidth;
    emo.style.top = Math.max(4, Math.min(innerHeight - emo.offsetHeight - 4, bb.top - 6)) + "px";
    emo.style.left = (pos.side === "right" ? Math.max(4, br.left - w - 8) : Math.min(innerWidth - w - 4, br.right + 8)) + "px";
    clearTimeout(emoT); emoT = setTimeout(emoHide, 4000);
  }
  bEmo.addEventListener("click", () => { close(); if (emo.classList.contains("wt-hidden")) emoShow(); else emoHide(); });

  // what each button shows: party on / chat open / mic on / full screen
  async function syncState() {
    let party = null, mic = false;
    try { const r = await chrome.storage.local.get(["wt_party", "wt_mic_state"]); party = r.wt_party; mic = !!r.wt_mic_state; } catch (_) {}
    const live = !!party && !!document.querySelector("#wt-root.wt-active");
    fab.classList.toggle("wt-live", !!party);
    bChat.classList.toggle("wt-hidden", !live);
    bMic.classList.toggle("wt-hidden", !live);
    bEmo.classList.toggle("wt-hidden", !live);
    if (!live) emoHide();
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
  let fsBox = null, fsAnc = [], fsVid = null, fsReal = false;
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
    if (ELEMENT_FS) {
      // Android: the player box itself goes full screen; the bar and chat move inside it
      fsBox = playerBox(v); fsReal = true;
      Promise.resolve().then(() => fsBox.requestFullscreen({ navigationUI: "hide" })).then(placeHost, () => { fsReal = false; fsBox = null; stretchFs(v); });
      syncState();
      return;
    }
    stretchFs(v);
  }
  function stretchFs(v) {
    fsBox = playerBox(v);
    fsBox.classList.add("wt-ios-fsbox");
    fsAnc = [];
    for (let p = fsBox.parentElement; p && p !== document.documentElement; p = p.parentElement) { p.classList.add("wt-ios-fsanc"); fsAnc.push(p); }
    document.documentElement.classList.add("wt-ios-fs");
    try { scrollTo(0, 0); } catch (_) {}
    const hint = $s("wtHint"); hint.classList.remove("wt-hidden"); setTimeout(() => hint.classList.add("wt-hidden"), 3500);
    setTimeout(() => {
      if (!fsBox) return;
      const r = v.getBoundingClientRect();
      if (r.width * r.height < innerWidth * innerHeight * 0.8) { fsVid = v; v.classList.add("wt-ios-fsvid"); }
    }, 150);
    syncState();
  }
  function exitFs() {
    if (fsReal) {
      fsReal = false; fsBox = null;
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
      syncState();
      return;
    }
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
    if (!APPLE_TOUCH || !t || t.closest("#wt-root, #wt-ios-host") || !bestVideo()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    appleFs();
  }, true);
  function placeHost() {
    const el = document.fullscreenElement || document.webkitFullscreenElement;
    const parent = el && el.tagName !== "VIDEO" ? el : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }
  const onFsChange = () => {
    const el = document.fullscreenElement || document.webkitFullscreenElement;
    if (!el && fsReal) { fsReal = false; fsBox = null; }
    placeHost(); syncState();
  };
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);
  placeHost();
  setInterval(placeHost, 3000);
  window.__wtFsMode = () => (fsReal ? "element" : fsBox ? "stretch" : "off");

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
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const $ = (id) => document.getElementById(id);
let activeTab = null;

function genCode(n = 6) {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// v25: one entry per brand. The union of `hosts` must equal the manifest
// matches and the SITE_HOSTS guard at the top of content.js (tests enforce it).
const SITES = [
  { name: "Netflix", url: "https://www.netflix.com/", hosts: ["netflix.com"] },
  { name: "JioHotstar", url: "https://www.hotstar.com/", hosts: ["hotstar.com", "jiohotstar.com"] },
  { name: "Prime Video", url: "https://www.primevideo.com/", hosts: ["primevideo.com"] },
  { name: "JioTV", url: "https://www.jiotv.com/", hosts: ["jiotv.com"] },
  { name: "JioCinema", url: "https://www.jiocinema.com/", hosts: ["jiocinema.com"] },
];
const SITE_HOSTS = SITES.flatMap(s => s.hosts);

function siteFor(url) {
  if (!url || !/^https?:/i.test(url)) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return SITES.find(s => s.hosts.some(d => host === d || host.endsWith("." + d))) || null;
  } catch (_) { return null; }
}

function isSupported(url) {
  return !!siteFor(url);
}

function buildSiteList() {
  const list = $("siteList");
  if (list.childElementCount) return;
  for (const s of SITES) {
    const b = document.createElement("button");
    b.className = "site-btn";
    b.textContent = s.name;
    b.addEventListener("click", () => {
      chrome.tabs.create({ url: s.url });
      window.close();
    });
    list.appendChild(b);
  }
}

function show(view) {
  for (const v of ["notSupported", "setupView", "activeView"]) {
    $(v).classList.add("hidden");
  }
  $(view).classList.remove("hidden");
}

function setDot(state) {
  const dot = document.querySelector(".dot");
  dot.className = "dot";
  if (state === "connected") dot.classList.add("ok");
  else if (state === "connecting" || state === "waiting") dot.classList.add("warn");
  else if (state === "error") dot.classList.add("err");
}

async function render() {
  activeTab = await getActiveTab();
  const site = siteFor(activeTab?.url);

  $("siteName").textContent = site ? site.name : "Unsupported site";

  const { wt_party: party } = await chrome.storage.local.get("wt_party");
  if (!site && !party) {
    buildSiteList();
    return show("notSupported");
  }
  if (party) {
    show("activeView");
    // The party lives in the streaming tab; this tab has no content script.
    $("offSiteHint").classList.toggle("hidden", !!site);
    $("codeDisplay").textContent = party.id;
    refreshStatus();
  } else {
    show("setupView");
    const { wt_recent: rec } = await chrome.storage.local.get("wt_recent");
    if (rec && rec.id) {
      $("resumeLine").classList.remove("hidden");
      $("resumeCode").textContent = rec.id;
    } else {
      $("resumeLine").classList.add("hidden");
    }
  }
}

async function refreshStatus() {
  const { wt_status: status } = await chrome.storage.local.get("wt_status");
  const text = $("statusText");
  setDot(status?.state);
  switch (status?.state) {
    case "connected": text.textContent = status.detail || "Connected - playback synced"; break;
    case "waiting": text.textContent = status.detail || "Waiting for your friend to join…"; break;
    case "connecting": text.textContent = "Connecting…"; break;
    case "error": text.textContent = status.detail || "Connection error"; break;
    default: text.textContent = "Idle"; 
  }
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.wt_status) refreshStatus();
  if (ch.wt_party) render();
});

function saveRecent(party) {
  if (!party) return;
  chrome.storage.local.set({ wt_recent: { id: party.id, role: party.role, name: party.name } });
}

// ---- actions ----

$("createBtn").addEventListener("click", async () => {
  const name = $("nameInput").value.trim() || "Host";
  const id = genCode();
  const party = { id, role: "host", name };
  saveRecent(party);
  await chrome.storage.local.set({ wt_name: name, wt_party: party, wt_status: { state: "connecting" } });
});

$("joinBtn").addEventListener("click", async () => {
  const code = $("codeInput").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    $("statusText").textContent = "";
    alert("Code must be 6 characters (letters/numbers).");
    return;
  }
  const name = $("nameInput").value.trim() || "Guest";
  const party = { id: code, role: "guest", name };
  saveRecent(party);
  await chrome.storage.local.set({ wt_name: name, wt_party: party, wt_status: { state: "connecting" } });
});

$("resumeBtn").addEventListener("click", async () => {
  const { wt_recent: rec, wt_name: saved } = await chrome.storage.local.get(["wt_recent", "wt_name"]);
  if (!rec || !rec.id) return;
  const name = saved || rec.name || "Guest";
  saveRecent({ ...rec, name });
  await chrome.storage.local.set({ wt_name: name, wt_party: { id: rec.id, role: rec.role || "guest", name }, wt_status: { state: "connecting" } });
});

$("copyBtn").addEventListener("click", async () => {
  const { wt_party: party } = await chrome.storage.local.get("wt_party");
  if (!party) return;
  await navigator.clipboard.writeText(party.id);
  $("copyBtn").textContent = "Copied!";
  setTimeout(() => ($("copyBtn").textContent = "Copy code"), 1200);
});

$("inviteBtn").addEventListener("click", async () => {
  const { wt_party: party } = await chrome.storage.local.get("wt_party");
  if (!party) return;
  const site = siteFor(activeTab?.url);
  const text = inviteText(party, site, activeTab && activeTab.url);
  await navigator.clipboard.writeText(text);
  $("inviteBtn").textContent = "Invite copied!";
  setTimeout(() => ($("inviteBtn").textContent = "Copy invite"), 1600);
});

$("codeDisplay").addEventListener("click", () => $("copyBtn").click());

// v38: one invite for every device - a link to this episode that joins the party
// by itself wherever Watch Together is installed (laptop, iPhone, Android), plus
// the code and where to get Watch Together.
const INSTALL_URL = "https://github.com/srv883/Watch-Movies-Together#install";
function joinLink(url, code) {
  const u = String(url || "").replace(/#.*$/, "");
  return /^https?:\/\//i.test(u) ? u + "#wt-join=" + code : "";
}
function inviteText(party, site, url) {
  const link = site ? joinLink(url, party.id) : "";
  return (link
    ? `Let's watch ${site.name} together! Tap to join my party (${party.id}):\n${link}\n\n`
    : `Join my Watch Together party - code: ${party.id}\n\n`) +
    `Laptop, iPhone or Android - no Watch Together yet? ${INSTALL_URL}`;
}

$("leaveBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({ wt_party: null, wt_status: null });
  render();
});

(async () => {
  const { wt_name: savedName } = await chrome.storage.local.get("wt_name");
  $("nameInput").value = savedName || "";
  await render();
})();

(function () { const vl = document.getElementById("verLine"); if (vl) vl.textContent = "v" + chrome.runtime.getManifest().version; })();

// ---- v31: tell the user when a newer version is out ----
// latest.json lives next to the zips in the project's GitHub repo; checked at
// most every 6 hours (cached in storage). Nothing about the user is sent.
const LATEST_URL = "https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/latest.json";
const DEFAULT_ZIP = "https://github.com/srv883/Watch-Movies-Together/raw/main/wt-latest.zip";
const UPDATE_EVERY_MS = 6 * 3600 * 1000;

function newerThan(a, b) {
  const x = String(a || "").split(".").map(n => parseInt(n, 10) || 0);
  const y = String(b || "").split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

// only ever send the user to this project's own downloads
function safeZip(u) {
  const s = String(u || "");
  return /^https:\/\/(github\.com|raw\.githubusercontent\.com)\/srv883\/Watch-Movies-Together\/[\w./-]+\.zip$/.test(s) ? s : DEFAULT_ZIP;
}

// v39: nobody downloads anything. The updater puts the new files in place;
// the extension switches over by itself when no video or party is running
// ("Switch now" does it right away).
function askBg(msg) {
  return new Promise((res) => {
    try { chrome.runtime.sendMessage(msg, (r) => { try { void chrome.runtime.lastError; } catch (_) {} res(r || null); }); }
    catch (_) { res(null); }
  });
}
async function showUpdate(u) {
  const mine = chrome.runtime.getManifest().version;
  const st = await askBg({ t: "wt-update-state" });
  const installed = !!(st && st.disk && newerThan(st.disk, mine));
  $("updateText").textContent = installed
    ? "🆕 Version " + st.disk + " is installed - it switches on by itself when no video or party is running"
    : "🆕 Version " + u.version + " is on its way - Watch Together updates itself in a few minutes";
  $("updateNotes").textContent = u.notes || "";
  $("updateBtn").textContent = "Switch now";
  $("updateBtn").classList.toggle("hidden", !installed);
  $("updateHelpBtn").classList.toggle("hidden", installed);
  $("updateBar").classList.remove("hidden");
  return installed;
}

async function checkUpdate() {
  const mine = chrome.runtime.getManifest().version;
  let { wt_update: u } = await chrome.storage.local.get("wt_update");
  if (!u || !(Date.now() - (u.checkedAt || 0) < UPDATE_EVERY_MS)) {
    try {
      if (typeof fetch !== "function") throw new Error("no fetch");
      const r = await fetch(LATEST_URL + "?t=" + Date.now(), { cache: "no-store" });
      const j = await r.json();
      if (j && typeof j.version === "string" && /^\d+\.\d+\.\d+$/.test(j.version)) {
        u = { version: j.version, zip: safeZip(j.zip), notes: String(j.notes || "").slice(0, 200), checkedAt: Date.now() };
        await chrome.storage.local.set({ wt_update: u });
      }
    } catch (_) { /* offline / blocked: try again next time */ }
  }
  if (u && newerThan(u.version, mine)) await showUpdate(u);
  else {
    // the files may already be newer than what runs (updater was quicker than latest.json's cache)
    const st = await askBg({ t: "wt-update-state" });
    if (st && st.disk && newerThan(st.disk, mine)) await showUpdate({ version: st.disk, notes: "" });
  }
  return u || null;
}

$("updateBtn").addEventListener("click", async () => {
  $("updateBtn").textContent = "Switching…";
  await askBg({ t: "wt-reload-now" });   // the extension restarts on the new version
  window.close();
});
$("updateHelpBtn").addEventListener("click", () => {
  $("updateHelp").classList.toggle("hidden");
  $("extPageBtn").classList.toggle("hidden", $("updateHelp").classList.contains("hidden"));
});
$("updateZip").addEventListener("click", async (e) => {
  if (e && typeof e.preventDefault === "function") e.preventDefault();
  const { wt_update: u } = await chrome.storage.local.get("wt_update");
  chrome.tabs.create({ url: safeZip(u && u.zip) });
});
$("extPageBtn").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/" }));

// v35: Chrome Web Store installs are updated by Chrome - no download notice there
if (!chrome.runtime.getManifest().update_url) checkUpdate();

// ---- v33: AI scene trivia settings ----
// The key stays in this browser's extension storage; only the extension's
// background worker sends it, and only to api.anthropic.com.
function keyStatus(text, cls) {
  const el = $("keyStatus");
  el.textContent = text;
  el.className = "small" + (cls ? " " + cls : "");
}

async function renderTrivia() {
  const { wt_trivia_on: on, wt_anthropic_key: key } = await chrome.storage.local.get(["wt_trivia_on", "wt_anthropic_key"]);
  $("triviaOn").checked = on !== false;
  const has = typeof key === "string" && key.length > 0;
  $("keyForget").classList.toggle("hidden", !has);
  $("keyInput").value = "";
  $("keyInput").placeholder = has ? "Key saved (…" + key.slice(-4) + ") - paste a new one to replace" : "Claude API key (sk-ant-…)";
  if (has) keyStatus("Key saved - trivia is generated for each new episode.", "ok");
  else keyStatus("No key: you'll still see trivia your friend's extension shares.");
}

$("triviaOn").addEventListener("change", () => {
  chrome.storage.local.set({ wt_trivia_on: $("triviaOn").checked });
});

$("keySave").addEventListener("click", async () => {
  const key = $("keyInput").value.trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) { keyStatus("That doesn't look like a Claude API key (it starts with sk-ant-).", "err"); return; }
  keyStatus("Checking the key…");
  let res = null;
  try { res = await chrome.runtime.sendMessage({ t: "wt-check-key", key }); } catch (_) {}
  if (res && res.ok === false && res.error === "bad-key") { keyStatus("Anthropic rejected this key.", "err"); return; }
  await chrome.storage.local.set({ wt_anthropic_key: key });
  await renderTrivia();
  if (!res || !res.ok) keyStatus("Saved, but the key couldn't be checked right now (" + ((res && res.error) || "no answer") + ").", "err");
});

$("keyForget").addEventListener("click", async () => {
  await chrome.storage.local.remove("wt_anthropic_key");
  renderTrivia();
});

renderTrivia();

    // phones: the invite goes out through the share sheet (WhatsApp, Messages ...)
    if (typeof inviteText === "function" && typeof navigator.share === "function") {
      const ib = $("inviteBtn"), nb = ib.cloneNode(true);
      ib.parentNode.replaceChild(nb, ib);
      nb.textContent = "Share invite";
      nb.addEventListener("click", async () => {
        const { wt_party: party } = await chrome.storage.local.get("wt_party");
        if (!party) return;
        const text = inviteText(party, siteFor(location.href), location.href);
        window.__wtShared = text;
        try { await navigator.share({ text }); }
        catch (e) {
          if (e && e.name === "AbortError") return;
          try { await navigator.clipboard.writeText(text); nb.textContent = "Invite copied!"; setTimeout(() => { nb.textContent = "Share invite"; }, 1600); } catch (_) {}
        }
      });
    }
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
    const auto = typeof window.__wtPhoneUpdate === "function";
    $s("updateText").textContent = auto ? "🆕 Version " + u.version + " is ready - Watch Together updates itself" : "🆕 Version " + u.version + " is out (you have " + WT_IOS_VERSION + ")";
    $s("updateNotes").textContent = (u.notes || "") + (auto ? " It switches over the next time you open Hotstar, or now:" : "");
    $s("updateBtn").textContent = auto ? "Switch now" : "Update";
    $s("updateHelp").innerHTML = ANDROID
      ? "<li>The new script opens.</li><li>Tampermonkey / Violentmonkey shows its install page → tap <b>Update</b> (or Install).</li><li>Come back and reload this page.</li>"
      : "<li>Safari opens the new script.</li><li>Tap the <b>puzzle-piece / Aa</b> button in the address bar → <b>Userscripts</b> → <b>Update</b> (or Install).</li><li>Come back and reload this page.</li>";
    $s("extPageBtn").remove();
    if (auto) { const hb = $s("updateHelpBtn"); if (hb) hb.remove(); }
    $s("updateBar").classList.remove("hidden");
    fab.classList.add("wt-live");
  }
  // the popup's own buttons point at the Chrome zip; on iPhone they open the script
  const ub = $s("updateBtn");
  const nb = ub.cloneNode(true); ub.parentNode.replaceChild(nb, ub);
  nb.textContent = typeof window.__wtPhoneUpdate === "function" ? "Switch now" : "Update";
  nb.addEventListener("click", async () => {
    if (typeof window.__wtPhoneUpdate === "function") {
      nb.textContent = "Switching…"; nb.disabled = true;
      let v = null;
      try { v = await window.__wtPhoneUpdate(); } catch (_) {}
      if (v) { nb.textContent = "Reloading…"; setTimeout(() => location.reload(), 300); return; }
      // never send anyone to reinstall: it simply updates itself on a later visit
      nb.textContent = "Can't reach GitHub now - it updates itself later"; nb.disabled = false;
      return;
    }
    $s("updateHelp").classList.remove("hidden"); chrome.tabs.create({ url: WT_IOS_SCRIPT_URL });
  });
  checkIosUpdate();
})();

})();

}

(async function (GM) {
  const BUILT_IN = "1.39.1";
  const BASE = (location.hostname === "127.0.0.1" && window.__wtPhoneBase) || "https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/ios/";
  const newer = (a, b) => { const x = String(a || "").split(".").map(Number), y = String(b || "").split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  const gmGet = async (k) => { try { return GM && GM.getValue ? await GM.getValue(k) : null; } catch (_) { return null; } };
  const gmSet = async (k, v) => { try { if (GM && GM.setValue) await GM.setValue(k, v); } catch (_) {} };
  function get(url) {
    return fetch(url, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error("http " + r.status); return r.text(); }).catch((e) => {
      if (!GM || typeof GM.xmlHttpRequest !== "function") throw e;
      return new Promise((res, rej) => GM.xmlHttpRequest({ method: "GET", url, onload: (r) => (r.status >= 200 && r.status < 300 ? res(r.responseText) : rej(new Error("http " + r.status))), onerror: () => rej(new Error("network")), ontimeout: () => rej(new Error("timeout")) }));
    });
  }
  async function sha256(text) {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.prototype.map.call(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
  }
  let cached = null;
  try { cached = JSON.parse((await gmGet("wt_phone_code")) || "null"); } catch (_) {}
  const running = () => (cached && cached.code && newer(cached.v, BUILT_IN) ? cached.v : BUILT_IN);
  // download a newer version (if any) for the next page load; returns its version
  async function update(force) {
    const last = Number((await gmGet("wt_phone_checked")) || 0);
    if (!force && Date.now() - last < 10 * 60 * 1000) return null;
    await gmSet("wt_phone_checked", String(Date.now()));
    const meta = JSON.parse(await get(BASE + "latest.json?t=" + Date.now()));
    const kept = async () => { try { const c = JSON.parse((await gmGet("wt_phone_code")) || "null"); return c && c.code && newer(c.v, running()) ? c.v : null; } catch (_) { return null; } };
    if (!meta || !/^\d+\.\d+\.\d+$/.test(String(meta.version)) || !/^[0-9a-f]{64}$/.test(String(meta.sha256)) || !newer(meta.version, running())) return force ? kept() : null;
    if (force && (await kept()) === meta.version) return meta.version;
    const code = await get(BASE + "wt-phone.js?v=" + meta.version);
    if ((await sha256(code)) !== meta.sha256) return null;
    await gmSet("wt_phone_code", JSON.stringify({ v: meta.version, code, at: Date.now() }));
    return meta.version;
  }
  window.__wtPhoneUpdate = () => update(true);
  let ran = null;
  if (cached && cached.code && newer(cached.v, BUILT_IN)) {
    try { new Function("GM", cached.code)(GM); ran = cached.v; } catch (e) { console.error("[Watch Together] downloaded version failed, using the built-in one", e); }
  }
  if (!ran) { WT_BUILT_IN(GM); ran = BUILT_IN; }
  window.__wtPhoneRan = ran;
  try { await update(false); } catch (_) {}
})(typeof GM !== "undefined" ? GM : undefined);
