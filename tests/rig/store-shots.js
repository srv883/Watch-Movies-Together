// Chrome Web Store screenshots (1280x800) of the real extension UI.
//   node store-shots.js --build V35-store      (run from the rig dir with the WAVs)
// Two headless Chromes join a party on an "episode page"; the video area gets
// a neutral cinematic backdrop (no real show frames). Writes store-shot-*.png.
const fs = require("fs"), path = require("path"), http = require("http"), cp = require("child_process");
const A = {}; for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const BUILD = A.build || "V35-store";
const VERS = "C:/Users/Sourav/ML Coding/watch-together-versions";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = A.out || path.join(VERS, "store");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const www = path.join(__dirname, "www", BUILD);
fs.mkdirSync(path.join(www, "lib"), { recursive: true });
const src = fs.readFileSync(path.join(VERS, BUILD, "content.js"), "utf8")
  .replace('if (!SITE_HOSTS.some(d => host === d || host.endsWith("." + d))) return;', "void SITE_HOSTS;")
  .replace('const SITE_HOSTS = [', 'const SITE_HOSTS = ["127.0.0.1", ')
  .replace('const NAV_FAMILIES = { hotstar: [', 'const NAV_FAMILIES = { hotstar: ["127.0.0.1", ');
fs.writeFileSync(path.join(www, "content.js"), src);
fs.copyFileSync(path.join(VERS, BUILD, "lib/peerjs.min.js"), path.join(www, "lib/peerjs.min.js"));
fs.copyFileSync(path.join(VERS, BUILD, "overlay.css"), path.join(www, "overlay.css"));
let rig = fs.readFileSync(path.join(__dirname, "rig.html"), "utf8");
// store-shot trivia: real facts from the pack (The Office - Dinner Party)
rig = rig.replace(/\{ t: 4, scene: "Cold open", fact: "RIG-FACT-ONE[^}]*\},\s*\{ t: 24, scene: "Dinner party", fact: "RIG-FACT-TWO[^}]*\}/,
  '{ t: 3, scene: "Michael\'s tiny TV", fact: "Michael\'s prized plasma TV is famously tiny - the camera keeps catching it." }, { t: 40, scene: "Snip snap", fact: "\'Snip snap, snip snap\' - Michael reveals he has had three vasectomies." }')
  .replace('title: "Rig Episode"', 'title: "The Office – Dinner Party"');
rig = rig.replace('role === "host" ? "Sourav" : "Megha"', 'role === "host" ? "Alex" : "Sam"');
fs.writeFileSync(path.join(www, "rig.html"), rig);
fs.copyFileSync(path.join(__dirname, "movie.wav"), path.join(www, "movie.wav"));

const server = http.createServer((q, r) => {
  const [pth] = q.url.split("?");
  const parts = decodeURIComponent(pth).split("/").filter(Boolean);
  const base = parts[parts.length - 1] || "";
  let f = path.join(__dirname, "www", decodeURIComponent(pth));
  if (parts.length > 1 && (base === "watch" || base === "home")) f = path.join(__dirname, "www", parts[0], "rig.html");
  else if (parts.length > 2 && !fs.existsSync(f)) f = path.join(__dirname, "www", parts[0], parts[parts.length - 2] === "lib" ? "lib" : "", base);
  fs.readFile(f, (e, d) => {
    if (e) { r.writeHead(404); return r.end(); }
    const t = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".wav": "audio/wav" }[path.extname(f)] || "application/octet-stream";
    r.writeHead(200, { "Content-Type": t, "Cache-Control": "no-store" }); r.end(d);
  });
});
function launch(name, port, wav) {
  return cp.spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(__dirname, "prof-shot-" + name + "-" + Date.now())}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
}
async function cdpPage(port) {
  for (let i = 0; i < 80; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const pg = list.find(t => t.type === "page"); if (pg) return connect(pg.webSocketDebuggerUrl); } catch (_) {}
    await sleep(250);
  }
  throw new Error("no CDP");
}
function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url); let id = 0; const pend = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    ws.onopen = () => res({
      send: (method, params = {}) => new Promise((r2, j2) => { const i = ++id; pend.set(i, { res: r2, rej: j2 }); ws.send(JSON.stringify({ id: i, method, params })); }),
      eval: async function (expr) { const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; },
    });
    ws.onerror = rej;
  });
}
const BACKDROP = `(() => {
  const v = document.getElementById("vid");
  Object.assign(v.style, { position: "fixed", left: 0, top: 0, width: "100vw", height: "100vh", objectFit: "cover", zIndex: 0 });
  Object.defineProperty(v, "duration", { get: () => 1320, configurable: true });
  document.getElementById("hdr").style.display = "none";
  document.title = "The Office · Dinner Party | Hotstar";
  const bd = document.createElement("div");
  bd.style.cssText = "position:fixed;inset:0;z-index:1;pointer-events:none;background:radial-gradient(ellipse at 30% 40%, #3b4a6b 0%, #1b2236 45%, #07090f 100%);";
  const glow = document.createElement("div");
  glow.style.cssText = "position:absolute;left:8%;right:8%;bottom:16%;height:34%;border-radius:50%;background:radial-gradient(ellipse at center, rgba(255,190,120,.28), rgba(0,0,0,0) 70%);filter:blur(20px)";
  bd.appendChild(glow);
  const bar = document.createElement("div");
  bar.style.cssText = "position:absolute;left:4%;right:4%;bottom:5%;height:4px;border-radius:2px;background:rgba(255,255,255,.25)";
  const fill = document.createElement("div"); fill.style.cssText = "width:38%;height:100%;border-radius:2px;background:#e53935"; bar.appendChild(fill); bd.appendChild(bar);
  document.body.appendChild(bd);
  return true;
})()`;

(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const code = ("S" + Math.random().toString(36).slice(2, 7)).toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 6);
  const EP = (slug, id) => `shows/the-office/1001/${slug}/${id}/watch`;
  const url = (role, extra, page) => `http://127.0.0.1:${port}/${BUILD}/${page || EP("dinner-party", "2001")}?role=${role}&code=${code}&vid=1${extra || ""}`;
  const ch = [launch("h", 9431, path.join(__dirname, "host.wav")), launch("g", 9432, path.join(__dirname, "guest_normal.wav"))];
  try {
    const H = await cdpPage(9431), G = await cdpPage(9432);
    for (const P of [H, G]) {
      await P.send("Page.enable");
      await P.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    }
    await H.send("Page.navigate", { url: url("host", "&mic=0&trivia=1") });
    await sleep(600);
    await G.send("Page.navigate", { url: url("guest", "&mic=0") });
    for (let i = 0; i < 120; i++) { const s = await H.eval(`(document.querySelector("#wt-status-text")||{}).textContent||""`).catch(() => ""); if (/Synced with/.test(s)) break; await sleep(250); }
    for (const P of [H, G]) await P.eval(BACKDROP);
    await sleep(11000); // the panel refreshes the now-playing title every 10 s
    const chat = (P, text) => P.eval(`(() => { const i = document.querySelector("#wt-input"); i.value = ${JSON.stringify(text)}; document.querySelector("#wt-form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); return true; })()`);
    const openPanel = (P) => P.eval(`(() => { const r = document.querySelector("#wt-root"); if (!r.classList.contains("wt-open")) document.querySelector("#wt-pill").click(); return true; })()`);
    await openPanel(H); await openPanel(G);
    await chat(G, "this episode 😂😂");
    await sleep(400);
    await chat(H, "wait for the snip snap part");
    await sleep(400);
    await G.eval(`(() => { document.querySelector('.wt-react[data-e="😂"]').click(); return true; })()`);
    await sleep(300);
    // 1) trivia card + panel
    await H.eval(`(() => { document.dispatchEvent(new Event("keydown")); return document.getElementById("vid").play().then(() => true); })()`);
    for (let i = 0; i < 40; i++) { const n = await H.eval(`document.querySelectorAll(".wt-trivia").length`); if (n) break; await sleep(250); }
    await sleep(700);
    const shot = async (P, name) => { const s = await P.send("Page.captureScreenshot", { format: "png" }); const f = path.join(OUT, name); fs.writeFileSync(f, Buffer.from(s.data, "base64")); console.log("wrote " + f); };
    await shot(H, "store-shot-1-trivia.png");
    // 2) the friend sees the follow banner when the host moves to the next episode
    await H.eval(`history.pushState({}, "", ${JSON.stringify("/" + BUILD + "/" + EP("chair-model", "2002"))}), true`);
    for (let i = 0; i < 30; i++) { const b = await G.eval(`document.querySelectorAll(".wt-banner").length`); if (b) break; await sleep(200); }
    await sleep(300);
    await shot(G, "store-shot-2-follow.png");
    // 3) synced playback: the friend's view with chat + floating reactions
    await sleep(6500);
    for (let i = 0; i < 60; i++) { const s = await G.eval(`(document.querySelector("#wt-status-text")||{}).textContent||""`).catch(() => ""); if (/Synced with/.test(s)) break; await sleep(250); }
    await G.eval(BACKDROP).catch(() => {});
    await openPanel(G).catch(() => {});
    await sleep(800);
    await chat(H, "ok next one, it's following you 👀");
    await sleep(300);
    await H.eval(`(() => { document.querySelector('.wt-react[data-e="🔥"]').click(); return true; })()`);
    await sleep(500);
    await shot(G, "store-shot-3-chat.png");
  } finally {
    ch.forEach(c => { try { c.kill(); } catch (_) {} });
    server.close();
  }
})();
