// iPhone build (ios/watch-together.user.js) against the desktop extension, in
// two real headless Chromes. The "iPhone" one is emulated: 390x844, touch
// taps, iPhone Safari user agent, NO autoplay exemption (audio must be
// unlocked by a tap), and a stand-in for the Userscripts app's GM.* storage.
//   node ios.js [--hbuild V37-iphone] [--shots <dir>] [--phone webkit --pw <playwright dir>]
// Run from a folder that has host.wav / guest_normal.wav / movie.wav.
const fs = require("fs"), path = require("path"), http = require("http"), cp = require("child_process");
const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const HBUILD = A.hbuild || "V37-iphone";
const VERS = "C:/Users/Sourav/ML Coding/watch-together-versions";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const WAVS = A.wavs || process.cwd();
const SHOTS = A.shots || path.join(process.cwd(), "ios-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";

// ---- files: host = rig.html + the desktop content.js; iPhone = a phone page + the userscript ----
const rigify = (s) => s
  .replace('if (!SITE_HOSTS.some(d => host === d || host.endsWith("." + d))) return;', "void SITE_HOSTS; // rig: guard bypassed")
  .replace('const SITE_HOSTS = [', 'const SITE_HOSTS = ["127.0.0.1", ')
  .replace('const NAV_FAMILIES = { hotstar: [', 'const NAV_FAMILIES = { hotstar: ["127.0.0.1", ');
const hostContent = rigify(fs.readFileSync(path.join(VERS, HBUILD, "content.js"), "utf8"));
const userscript = rigify(fs.readFileSync(path.join(VERS, "ios/watch-together.user.js"), "utf8"))
  // the panel's site list must know the rig's host too
  .replace('const SITES = [', 'const SITES = [\n  { name: "JioHotstar", url: "/", hosts: ["127.0.0.1"] },');
if (userscript.indexOf("rig: guard bypassed") === -1) throw new Error("userscript guard not found");
const rigHtml = fs.readFileSync(path.join(__dirname, "rig.html"), "utf8")
  // film-length runtime from the start, like a real film page (trivia skips short clips)
  .replace('<script>document.getElementById("hdr")', '<script>Object.defineProperty(document.getElementById("vid"), "duration", { get: () => 1320, configurable: true });</script><script>document.getElementById("hdr")');
if (rigHtml.indexOf("get: () => 1320") === -1) throw new Error("rig.html hook not found");
const GM_STUB = `
<script>
(() => {
  window.__log = [];
  for (const k of ["log", "warn", "error"]) { const o = console[k].bind(console); console[k] = (...a) => { try { window.__log.push(k + ": " + a.map(x => (x && x.stack) || String(x)).join(" ")); } catch (_) {} o(...a); }; }
  window.addEventListener("error", e => window.__log.push("uncaught: " + e.message));
  window.addEventListener("unhandledrejection", e => window.__log.push("unhandled: " + (e.reason && e.reason.stack || e.reason)));
  window.__pcs = [];
  const OrigPC = window.RTCPeerConnection;
  if (OrigPC) window.RTCPeerConnection = class extends OrigPC { constructor(...a) { super(...a); window.__pcs.push(this); } };
  // the Userscripts app's GM.* (async, string values), kept in localStorage
  const P = "gm:";
  window.__gmCalls = [];
  window.GM = {
    getValue: async (k, d) => { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); },
    setValue: async (k, v) => { localStorage.setItem(P + k, JSON.stringify(v)); },
    deleteValue: async (k) => { localStorage.removeItem(P + k); },
    listValues: async () => Object.keys(localStorage).filter(k => k.indexOf(P) === 0).map(k => k.slice(P.length)),
    xmlHttpRequest: (d) => { window.__gmCalls.push(d.url); fetch(d.url, { method: d.method, headers: d.headers, body: d.data }).then(async r => d.onload && d.onload({ status: r.status, statusText: r.statusText, responseText: await r.text(), responseHeaders: [...r.headers].map(([k, v]) => k + ": " + v).join("\\r\\n") })).catch(() => d.onerror && d.onerror({})); },
    openInTab: (u) => { window.__opened = (window.__opened || []).concat([u]); },
  };
})();
</script>`;
const phoneHtml = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Avengers: Infinity War - Disney+ Hotstar</title>${GM_STUB}
<style>body{margin:0;background:#0c0c12;color:#ccc;font:14px -apple-system,sans-serif} header{padding:10px 14px;font-weight:600}
#player{position:relative;width:100%;aspect-ratio:16/9;background:#000} #vid{width:100%;height:100%}
.shaka-text-container{position:absolute;left:0;right:0;bottom:12%;text-align:center;color:#fff;font:16px sans-serif;text-shadow:0 0 4px #000}
p{padding:0 14px}</style></head><body>
<header>JioHotstar</header>
<div id="player"><video id="vid" playsinline></video><div class="shaka-text-container"></div></div>
<p>Avengers: Infinity War · 2018 · Action</p><p>The Avengers and their allies must be willing to sacrifice all in an attempt to defeat the powerful Thanos.</p>
<script>
(() => {
  const v = document.getElementById("vid"); v.src = "/ios/movie.wav"; v.loop = false; v.volume = 0.8; v.preload = "auto";
  Object.defineProperty(v, "duration", { get: () => 1320, configurable: true }); // a film-length runtime (trivia skips short clips)
  const box = document.querySelector(".shaka-text-container");
  const lines = [[11, 14.5, "Hear me, and rejoice!"]];
  setInterval(() => { const t = v.currentTime; const l = lines.find(x => t >= x[0] && t < x[1]); const s = l ? l[2] : ""; if (box.textContent !== s) box.innerHTML = s ? "<span>" + s + "</span>" : ""; }, 150);
})();
</script>
<script src="/ios/watch-together.user.js"></script>
</body></html>`;

const server = http.createServer((q, r) => {
  const [pth] = q.url.split("?");
  const parts = decodeURIComponent(pth).split("/").filter(Boolean);
  const base = parts[parts.length - 1] || "";
  const send = (type, body) => { r.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); r.end(body); };
  if (parts[0] === "ios") {
    if (base === "watch") return send("text/html", phoneHtml);
    if (base === "watch-together.user.js") return send("text/javascript", userscript);
    if (base === "movie.wav") return send("audio/wav", fs.readFileSync(path.join(WAVS, "movie.wav")));
  } else if (parts[0] === "host") {
    if (base === "watch") return send("text/html", rigHtml);
    if (base === "content.js") return send("text/javascript", hostContent);
    if (base === "peerjs.min.js") return send("text/javascript", fs.readFileSync(path.join(VERS, HBUILD, "lib/peerjs.min.js")));
    if (base === "overlay.css") return send("text/css", fs.readFileSync(path.join(VERS, HBUILD, "overlay.css")));
    if (base === "movie.wav") return send("audio/wav", fs.readFileSync(path.join(WAVS, "movie.wav")));
  }
  r.writeHead(404); r.end();
});

async function cdpPage(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const pg = list.find((t) => t.type === "page");
      if (pg) return connect(pg.webSocketDebuggerUrl);
    } catch (_) {}
    await sleep(250);
  }
  throw new Error("no CDP on " + port);
}
function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url); let id = 0; const pend = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    ws.onopen = () => res({
      send: (method, params = {}) => new Promise((r2, j2) => { const i = ++id; pend.set(i, { res: r2, rej: j2 }); ws.send(JSON.stringify({ id: i, method, params })); }),
      eval: async function (expr, gesture) {
        const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: !!gesture });
        if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
        return r.result.value;
      },
      close: () => ws.close(),
    });
    ws.onerror = (e) => rej(e);
  });
}
function launch(name, port, wav, phone) {
  const prof = path.join(process.cwd(), "prof-ios-" + name + "-" + Date.now());
  return cp.spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`,
    ...(phone ? [] : ["--autoplay-policy=no-user-gesture-required"]), "--mute-audio",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "about:blank",
  ], { stdio: "ignore" });
}

// --phone webkit --pw <dir with node_modules/playwright>: the phone is WebKit
// (Safari's engine; Playwright's build) instead of Chrome. Same CDP-style calls.
const WEBKIT = A.phone === "webkit";
async function webkitPhone() {
  const { webkit } = require(path.join(A.pw, "node_modules", "playwright"));
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  let at = null;
  return {
    browser, page,
    eval: (expr) => page.evaluate(expr),
    send: async (method, p = {}) => {
      switch (method) {
        case "Page.navigate": await page.goto(p.url); return {};
        case "Page.reload": await page.reload(); return {};
        case "Emulation.setDeviceMetricsOverride": await page.setViewportSize({ width: p.width, height: p.height }); return {};
        case "Input.dispatchTouchEvent": if (p.type === "touchStart") at = p.touchPoints[0]; else if (at) { await page.touchscreen.tap(at.x, at.y); at = null; } return {};
        case "Input.insertText": await page.keyboard.insertText(p.text); return {};
        case "Page.captureScreenshot": return { data: (await page.screenshot()).toString("base64") };
        default: return {};
      }
    },
  };
}

const J = {
  status: `(document.querySelector("#wt-status-text")||{}).textContent||""`,
  msgs: `[...document.querySelectorAll("#wt-msgs > *")].map(e => e.textContent)`,
  vid: `(() => { const v = document.getElementById("vid"); return { t: +v.currentTime.toFixed(2), paused: v.paused, rate: v.playbackRate }; })()`,
  inPkts: `(async () => { let n = 0; for (const pc of (window.__pcs||[])) { if (pc.connectionState !== "connected" || !pc.getTransceivers().length) continue; const st = await pc.getStats(); st.forEach(r => { if (r.type === "inbound-rtp" && r.kind === "audio") n += r.packetsReceived; }); } return n; })()`,
  errs: `window.__log.filter(l => /^(uncaught|unhandled|error)/.test(l))`,
  card: `[...document.querySelectorAll(".wt-trivia")].map(c => c.textContent)`,
  sh: (id) => `document.getElementById("wt-ios-host").shadowRoot.getElementById(${JSON.stringify(id)})`,
};
const visible = (expr) => `(() => { const e = ${expr}; if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== "none"; })()`;
const chat = (text) => `(() => { const i = document.querySelector("#wt-input"); i.value = ${JSON.stringify(text)}; const f = document.querySelector("#wt-form"); f.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); return true; })()`;
const user = (js) => `(() => { document.dispatchEvent(new Event("keydown", { bubbles: true })); return (${js}); })()`;

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const results = [];
  const rec = (id, name, pass, detail) => { results.push({ id, name, pass: !!pass }); console.log((pass ? "PASS " : "FAIL ") + id + " " + name + "  " + JSON.stringify(detail === undefined ? "" : detail).slice(0, 600)); };
  const waitFor = async (P, expr, pred, ms) => { const t = Date.now(); let v; while (Date.now() - t < ms) { try { v = await P.eval(expr); if (pred(v)) return { ok: true, ms: Date.now() - t, v }; } catch (_) {} await sleep(200); } return { ok: false, ms: Date.now() - t, v }; };
  const synced = (s) => /Synced with/.test(s);
  const code = ("I" + Math.random().toString(36).slice(2, 7)).toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 6);
  const PATH = "in/movies/avengers-infinity-war/1660010677/watch";
  let ch = [];
  // a real finger tap at an element's centre (touchstart -> touchend -> click)
  async function tap(P, expr) {
    const r = await P.eval(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView && e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (!r) throw new Error("tap: no element " + expr);
    await P.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y }] });
    await sleep(60);
    await P.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(250);
    return r;
  }
  // press and hold (the edge button: hold = party panel)
  async function hold(P, expr) {
    const r = await P.eval(`(() => { const b = (${expr}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (P.page) { await P.page.mouse.move(r.x, r.y); await P.page.mouse.down(); await sleep(800); await P.page.mouse.up(); }
    else {
      await P.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y }] });
      await sleep(800);
      await P.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await sleep(250);
  }
  async function typeInto(P, expr, text) { await tap(P, expr); await P.send("Input.insertText", { text }); await sleep(100); }
  async function shot(P, name) { const s = await P.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(s.data, "base64")); }
  async function phoneView(P, landscape) {
    const w = landscape ? 844 : 390, h = landscape ? 390 : 844;
    await P.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true, screenOrientation: landscape ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 } });
  }

  try {
    ch = [launch("h", 9421, path.join(WAVS, "host.wav"), false)];
    if (!WEBKIT) ch.push(launch("p", 9422, path.join(WAVS, "guest_normal.wav"), true));
    const H = await cdpPage(9421), I = WEBKIT ? await webkitPhone() : await cdpPage(9422);
    if (WEBKIT) ch.push({ kill: () => I.browser.close().catch(() => {}) });
    for (const P of [H, I]) { await P.send("Page.enable"); await P.send("Runtime.enable"); }
    await I.send("Network.enable");
    await I.send("Network.setUserAgentOverride", { userAgent: IPHONE_UA, platform: "iPhone" });
    await I.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await phoneView(I, false);
    await H.send("Page.navigate", { url: `http://127.0.0.1:${port}/host/${PATH}?role=host&code=${code}&vid=1&mic=0` });
    await I.send("Page.navigate", { url: `http://127.0.0.1:${port}/ios/${PATH}` });

    // ---- I1: the script starts on the phone ----
    const fab = await waitFor(I, visible(J.sh("wtFab")), (v) => v === true, 15000);
    const errs0 = await I.eval(J.errs);
    rec("I1", "userscript runs on the iPhone page: round button shown, no errors", fab.ok && !errs0.length, { ms: fab.ms, errs: errs0 });
    const ua = await I.eval("navigator.userAgent");
    rec("I1b", "page sees an iPhone (Safari UA" + (WEBKIT ? ")" : ", touch)"), /iPhone/.test(ua) && (WEBKIT || (await I.eval("navigator.maxTouchPoints")) > 0), { ua: ua.slice(0, 60) });
    await shot(I, "1-phone-start");
    // I1c: the button stays out of the player's way: small, on the right edge, not in the bottom area
    const fr = await I.eval(`(() => { const r = ${J.sh("wtFab")}.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, W: innerWidth, H: innerHeight }; })()`);
    rec("I1c", "button is small and docked to the right edge, away from the bottom controls", fr.w <= 36 && fr.l > fr.W - 50 && fr.t < fr.H * 0.5, fr);
    if (!WEBKIT) {
      // I1d: drag it with a finger to the left side -> snaps to the left edge, remembered after reload
      const c = { x: fr.l + fr.w / 2, y: fr.t + fr.w / 2 };
      await I.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.x, y: c.y }] });
      for (let k = 1; k <= 10; k++) { await I.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: c.x - k * 25, y: c.y + k * 15 }] }); await sleep(20); }
      await I.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(400);
      const d1 = await I.eval(`(() => { const r = ${J.sh("wtFab")}.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), open: getComputedStyle(${J.sh("wtSheet")}).display !== "none" }; })()`);
      await I.send("Page.reload");
      await waitFor(I, visible(J.sh("wtFab")), (v) => v === true, 15000);
      await sleep(500);
      const d2 = await I.eval(`(() => { const r = ${J.sh("wtFab")}.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top) }; })()`);
      rec("I1d", "drag by finger -> snaps to the left edge, no panel opened, same spot after reload", d1.l <= 8 && !d1.open && Math.abs(d1.t - (fr.t + 150)) < 30 && d2.l <= 8 && Math.abs(d2.t - d1.t) < 3, { before: fr, after: d1, reloaded: d2 });
      await sleep(4200);
      const faded = await I.eval(`${J.sh("wtFab")}.classList.contains("wt-faded")`);
      rec("I1e", "button fades when untouched", faded, {});
    }


    // ---- I2: the popup panel, by touch ----
    await tap(I, J.sh("wtFab"));
    const sheet = await waitFor(I, visible(J.sh("setupView")), (v) => v === true, 4000);
    const ver = await I.eval(`${J.sh("verLine")}.textContent`);
    const site = await I.eval(`${J.sh("siteName")}.textContent`);
    rec("I2", "tap the button -> the Watch Together panel (name / start / join)", sheet.ok && /^v1\.37\.\d+$/.test(ver), { ver, site });
    await shot(I, "2-panel");

    if (WEBKIT) {
      // Playwright's Windows WebKit has no WebRTC / microphone / Web Audio (the
      // real iPhone has them; the Chrome run covers calls and sync). Here: the
      // rest of the script on Safari's engine, the phone on its own.
      await tap(I, J.sh("wtX"));
      const brain = `(() => { const b = document.querySelector("#wt-trivia-btn"); if (!b) return ""; b.click(); b.click(); return [...document.querySelectorAll(".wt-toast")].map(t => t.textContent).pop() || ""; })()`;
      await I.eval(`(async () => { await GM.setValue("wt_party", JSON.stringify({ id: "WKSOLO", role: "host", name: "Sourav" })); return true; })()`);
      await I.send("Page.reload");
      const ui = await waitFor(I, `!!document.querySelector("#wt-root.wt-active")`, (x) => x === true, 15000);
      rec("W3", "party overlay (chat panel, 🧠, mic) builds on WebKit", ui.ok, { ms: ui.ms });
      const tr = await waitFor(I, brain, (x) => /13 scene facts/.test(x), 20000);
      rec("W4", "trivia pack fetched from GitHub by the bundled background code on WebKit (13 facts)", tr.ok, { toast: tr.v, gm: await I.eval("window.__gmCalls") });
      await tap(I, `document.querySelector("header")`);
      const played = await I.eval(`(() => { const v = document.getElementById("vid"); v.currentTime = 10.5; return v.play().then(() => "ok", (e) => String(e)); })()`);
      const fact0 = require(path.join(VERS, "trivia/mcu.json")).entries.find((e) => /infinity/.test(e.names[0])).items.find((i) => i.cue[0] === "hear me and rejoice").fact.slice(0, 30);
      const card = await waitFor(I, J.card, (c) => c.some((x) => x.includes(fact0)), 12000);
      rec("W5", "subtitle 'Hear me, and rejoice!' -> its card pops up (WebKit)", card.ok, { play: played, t: (await I.eval(J.vid)).t, cards: card.v });
      await shot(I, "w-portrait");
      await phoneView(I, true); await sleep(700);
      const off = await I.eval(`(() => { const out = []; for (const e of document.querySelectorAll("#wt-root, #wt-root *, .wt-trivia")) { const r = e.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 2 || r.left < -2 || r.top < -2)) out.push((e.id || e.className || e.tagName) + " " + Math.round(r.left) + ".." + Math.round(r.right) + " top " + Math.round(r.top)); } return out.slice(0, 8); })()`);
      rec("W6", "overlay fits a landscape iPhone screen (WebKit layout)", !off.length, { off });
      await shot(I, "w-landscape");
      await phoneView(I, false);
      await I.eval(`(async () => { await GM.setValue("wt_ios_update", JSON.stringify({ version: "9.9.9", notes: "test", checkedAt: Date.now() })); return true; })()`);
      await I.send("Page.reload");
      await waitFor(I, visible(J.sh("wtFab")), (x) => x === true, 15000);
      await hold(I, J.sh("wtFab"));
      const ub = await waitFor(I, visible(J.sh("updateBar")), (x) => x === true, 4000);
      rec("W7", "update notice in the panel (WebKit)", ub.ok, {});
      await tap(I, J.sh("leaveBtn"));
      const left = await waitFor(I, visible(J.sh("setupView")), (x) => x === true, 4000);
      rec("W8", "Leave party from the panel (WebKit)", left.ok, {});
      const errs = await I.eval(J.errs);
      rec("W9", "no script errors on WebKit", !errs.length, { errs });
      return;
    }

    // ---- I3: join the desktop party from the panel ----
    await typeInto(I, J.sh("nameInput"), "Sourav iPhone");
    await typeInto(I, J.sh("codeInput"), code.toLowerCase());
    await tap(I, J.sh("joinBtn"));
    const act = await waitFor(I, visible(J.sh("activeView")), (v) => v === true, 4000);
    const got = await I.eval(`${J.sh("codeDisplay")}.textContent`);
    rec("I3a", "Join -> panel shows the party code", act.ok && got === code, { code: got });
    const c1 = await waitFor(H, J.status, synced, 40000);
    const c2 = await waitFor(I, J.status, synced, 8000);
    rec("I3b", "iPhone and desktop connect (both Synced)", c1.ok && c2.ok, { ms: c1.ms, host: c1.v, phone: c2.v });
    const pst = await waitFor(I, `${J.sh("statusText")}.textContent`, (s) => /Connected|Synced/i.test(s), 6000);
    rec("I3c", "panel status follows the party", pst.ok, { status: pst.v });
    await tap(I, J.sh("wtX"));
    const closed = await waitFor(I, visible(J.sh("wtSheet")), (v) => v === false, 3000);
    rec("I3d", "✕ closes the panel; button shows the live dot", closed.ok && (await I.eval(`${J.sh("wtFab")}.classList.contains("wt-live")`)), {});
    if (!c1.ok) throw new Error("no connection");
    // I3e: nothing over the bottom of the player; the edge button does the pill's job
    const hidden = await I.eval(`(() => { const v = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== "none"; }; return { pill: v("#wt-pill"), quick: v("#wt-quick") }; })()`);
    const openBefore = await I.eval(`document.querySelector("#wt-root").classList.contains("wt-open")`);
    await tap(I, J.sh("wtFab"));
    const t1 = await waitFor(I, `document.querySelector("#wt-root").classList.contains("wt-open")`, (x) => x === !openBefore, 3000);
    await tap(I, J.sh("wtFab"));
    const t2 = await waitFor(I, `document.querySelector("#wt-root").classList.contains("wt-open")`, (x) => x === openBefore, 3000);
    const sheetShut = !(await I.eval(visible(J.sh("wtSheet"))));
    rec("I3e", "no red pill / emoji bar over the player; tap the edge button = chat panel open/close", !hidden.pill && !hidden.quick && t1.ok && t2.ok && sheetShut, { hidden, openBefore });
    await hold(I, J.sh("wtFab"));
    const held = await waitFor(I, visible(J.sh("activeView")), (v) => v === true, 3000);
    rec("I3f", "hold the edge button = party panel (code, leave)", held.ok, {});
    await tap(I, J.sh("wtX"));
    if (!(await I.eval(`document.querySelector("#wt-root").classList.contains("wt-open")`))) await tap(I, J.sh("wtFab")); // chat open for the rest

    // ---- I4: playback sync both ways ----
    await sleep(1500);
    await H.eval(`(() => { const v = document.getElementById("vid"); Object.defineProperty(v, "duration", { get: () => 1320, configurable: true }); return true; })()`);
    await tap(I, `document.querySelector("header")`); // the phone user has touched the page once
    await H.eval(user(`document.getElementById("vid").play().then(() => true)`), true);
    const p1 = await waitFor(I, J.vid, (v) => !v.paused && v.t > 0.3, 8000);
    rec("I4a", "desktop PLAY -> iPhone plays", p1.ok, { ms: p1.ms, phone: p1.v });
    await sleep(2000);
    const hv = await H.eval(J.vid), iv = await I.eval(J.vid);
    rec("I4b", "in sync while playing (<1 s)", Math.abs(hv.t - iv.t) < 1, { host: hv.t, phone: iv.t });
    await tap(I, `document.querySelector("header")`);
    await I.eval(`(document.getElementById("vid").pause(), true)`);
    const p2 = await waitFor(H, J.vid, (v) => v.paused, 6000);
    rec("I4c", "iPhone PAUSE -> desktop pauses", p2.ok, { ms: p2.ms });
    await tap(I, `document.querySelector("header")`);
    await I.eval(`(() => { document.getElementById("vid").currentTime = 9; return true; })()`);
    const p3 = await waitFor(H, J.vid, (v) => Math.abs(v.t - 9) < 1, 6000);
    rec("I4d", "iPhone SEEK -> desktop follows", p3.ok, { ms: p3.ms, host: p3.v });

    // ---- I5: chat ----
    const tag = "hi-" + Math.random().toString(36).slice(2, 6);
    await H.eval(chat(tag + "-desk"), true);
    const m1 = await waitFor(I, J.msgs, (m) => m.some((x) => x.includes(tag + "-desk")), 6000);
    await I.eval(chat(tag + "-phone"), true);
    const m2 = await waitFor(H, J.msgs, (m) => m.some((x) => x.includes(tag + "-phone")), 6000);
    rec("I5", "chat both ways", m1.ok && m2.ok, {});

    // ---- I6: trivia from the live GitHub pack, fetched on the iPhone ----
    const trH = await waitFor(H, J.msgs, (m) => m.some((x) => /Trivia ready.*13 moments.*from Sourav iPhone/.test(x)), 20000);
    const brain = `(() => { const b = document.querySelector("#wt-trivia-btn"); b.click(); b.click(); return [...document.querySelectorAll(".wt-toast")].map(t => t.textContent).pop() || ""; })()`;
    const tr = await waitFor(I, brain, (x) => /13 scene facts/.test(x), 6000);
    rec("I6a", "iPhone loads the Infinity War pack itself (13 facts) and shares it with the desktop", tr.ok && trH.ok, { phone: tr.v, host: (trH.v || []).find((x) => /Trivia/.test(x)) });
    await tap(I, `document.querySelector("header")`);
    await I.eval(`(() => { const v = document.getElementById("vid"); v.currentTime = 9.5; return v.play().then(() => true); })()`);
    const fact0 = require(path.join(VERS, "trivia/mcu.json")).entries.find((e) => /infinity/.test(e.names[0])).items.find((i) => i.cue[0] === "hear me and rejoice").fact.slice(0, 30);
    const card = await waitFor(I, J.card, (c) => c.some((x) => x.includes(fact0)), 12000);
    const tt = await I.eval(J.vid);
    rec("I6b", "'Hear me, and rejoice!' subtitle -> its card pops up on the iPhone, on that line", card.ok && tt.t >= 11 && tt.t < 16, { at: tt.t, phone: card.v });
    await shot(I, "3-phone-card-portrait");
    await phoneView(I, true);
    await sleep(800);
    await shot(I, "4-phone-landscape");
    const fit = await I.eval(`(() => { const out = []; for (const e of document.querySelectorAll("#wt-root, #wt-root *, #wt-quick, .wt-trivia")) { const r = e.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 2 || r.left < -2)) out.push((e.id || e.className || e.tagName) + " " + Math.round(r.left) + ".." + Math.round(r.right)); } return out.slice(0, 8); })()`);
    rec("I6c", "nothing of the overlay sticks out of the screen (landscape)", !fit.length, { off: fit });
    await phoneView(I, false);
    await sleep(800);
    const fitP = await I.eval(`(() => { const out = []; for (const e of document.querySelectorAll("#wt-root, #wt-root *, #wt-quick, .wt-trivia")) { const r = e.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 2 || r.left < -2)) out.push((e.id || e.className || e.tagName) + " " + Math.round(r.left) + ".." + Math.round(r.right)); } return out.slice(0, 8); })()`);
    rec("I6d", "nothing of the overlay sticks out of the screen (portrait)", !fitP.length, { off: fitP });
    await I.eval(`(document.getElementById("vid").pause(), true)`);

    // ---- I7: voice, unlocked by a tap ----
    await H.eval(`document.querySelector("#wt-mic").click(), true`, true);
    await tap(I, `document.querySelector("#wt-mic")`);
    const t0 = Date.now(); const a0 = await H.eval(J.inPkts), b0 = await I.eval(J.inPkts); let v = null;
    while (Date.now() - t0 < 15000) { await sleep(500); const a = await H.eval(J.inPkts), b = await I.eval(J.inPkts); if (a > a0 + 40 && b > b0 + 40) { v = { hostIn: a - a0, phoneIn: b - b0, ms: Date.now() - t0 }; break; } }
    rec("I7a", "two-way voice iPhone <-> desktop (mic tapped on)", !!v, v || {});
    await tap(I, `document.querySelector("header")`);
    const au = await waitFor(I, `(() => { const a = document.querySelector("#wt-remote-audio"); return a ? { paused: a.paused, src: !!a.srcObject } : null; })()`, (x) => x && x.src && !x.paused, 6000);
    const pill = await I.eval(`!!document.getElementById("wt-voice-pill")`);
    rec("I7b", "friend's voice plays on the iPhone after a tap (no stuck 'enable voice' pill)", au.ok && !pill, { audio: au.v, pill });

    // ---- I8: update notice ----
    await I.eval(`(async () => { await GM.setValue("wt_ios_update", JSON.stringify({ version: "9.9.9", notes: "test", checkedAt: Date.now() })); return true; })()`);
    await I.send("Page.reload");
    await waitFor(I, visible(J.sh("wtFab")), (x) => x === true, 15000);
    await hold(I, J.sh("wtFab"));
    const ub = await waitFor(I, visible(J.sh("updateBar")), (x) => x === true, 4000);
    await tap(I, J.sh("updateBtn"));
    const opened = await I.eval(`window.__opened || []`);
    rec("I8", "newer iPhone version -> Update opens the script on GitHub", ub.ok && opened.some((u) => /\/ios\/watch-together\.user\.js$/.test(u)), { opened });
    await shot(I, "5-update");
    const back = await waitFor(I, J.status, synced, 40000);
    rec("I9", "after a page reload the iPhone rejoins the party by itself", back.ok, { ms: back.ms, status: back.v });

    // ---- I10: leave from the panel ----
    await tap(I, J.sh("leaveBtn"));
    const left = await waitFor(I, visible(J.sh("setupView")), (x) => x === true, 4000);
    const gone = await waitFor(H, J.status, (s) => !synced(s), 15000);
    rec("I10", "Leave party in the panel -> the phone leaves, desktop notices", left.ok && gone.ok, { host: gone.v });
    const errs = await I.eval(J.errs);
    rec("I11", "no script errors on the iPhone page during the whole session", !errs.length, { errs });
  } catch (e) {
    rec("X", "harness", false, String((e && e.stack) || e).slice(0, 500));
  } finally {
    ch.forEach((c) => { try { c.kill(); } catch (_) {} });
    const n = results.filter((r) => r.pass).length;
    console.log(n + "/" + results.length + " passed");
    fs.writeFileSync(path.join(process.cwd(), "ios-" + HBUILD + (WEBKIT ? "-webkit" : "") + ".json"), JSON.stringify(results, null, 1));
    setTimeout(() => process.exit(0), 500);
  }
})();
