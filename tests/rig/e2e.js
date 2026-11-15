// End-to-end real-Chrome test of a whole watch-party session.
//   node e2e.js --build V29-louder [--only S1,S2,...] [--gbuild X]
// Two headless Chromes (temp profiles, fake mics from TTS WAVs), the REAL
// content.js + PeerJS + WebRTC over the internet. Every step is timed and
// asserted; results -> e2e-<build>.json and a PASS/FAIL table.
const fs = require("fs"), path = require("path"), http = require("http"), cp = require("child_process");

const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const BUILD = A.build || "V29-louder", GBUILD = A.gbuild || BUILD;
const ONLY = A.only ? A.only.split(",") : null;
const VERS = "C:/Users/Sourav/ML Coding/watch-together-versions";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const wwwRoot = path.join(__dirname, "www");

for (const b of new Set([BUILD, GBUILD])) {
  const www = path.join(wwwRoot, b);
  fs.mkdirSync(path.join(www, "lib"), { recursive: true });
  const src = fs.readFileSync(path.join(VERS, b, "content.js"), "utf8")
    .replace('if (!SITE_HOSTS.some(d => host === d || host.endsWith("." + d))) return;', "void SITE_HOSTS; // rig: guard bypassed");
  fs.writeFileSync(path.join(www, "content.js"), src);
  fs.copyFileSync(path.join(VERS, b, "lib/peerjs.min.js"), path.join(www, "lib/peerjs.min.js"));
  fs.copyFileSync(path.join(VERS, b, "overlay.css"), path.join(www, "overlay.css"));
  fs.copyFileSync(path.join(__dirname, "rig.html"), path.join(www, "rig.html"));
  fs.copyFileSync(path.join(__dirname, "movie.wav"), path.join(www, "movie.wav"));
}
const server = http.createServer((q, r) => {
  const f = path.join(wwwRoot, decodeURIComponent(q.url.split("?")[0]));
  fs.readFile(f, (e, d) => {
    if (e) { r.writeHead(404); return r.end(); }
    const t = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".wav": "audio/wav" }[path.extname(f)] || "application/octet-stream";
    r.writeHead(200, { "Content-Type": t, "Cache-Control": "no-store", "Accept-Ranges": "none" }); r.end(d);
  });
});

async function cdpPage(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const pg = list.find(t => t.type === "page");
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
function launch(name, port, wav) {
  const prof = path.join(__dirname, "prof-" + name + "-" + Date.now());
  return cp.spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`,
    "--autoplay-policy=no-user-gesture-required", "--mute-audio",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "about:blank",
  ], { stdio: "ignore" });
}

// ---------- page helpers (run inside the page) ----------
const J = {
  status: `(document.querySelector("#wt-status-text")||{}).textContent||""`,
  dbg: `(window.__wtVoiceDbg ? window.__wtVoiceDbg() : null)`,
  msgs: `[...document.querySelectorAll("#wt-msgs > *")].map(e => e.textContent)`,
  vid: `(() => { const v = document.getElementById("vid"); return { t: +v.currentTime.toFixed(2), paused: v.paused, rate: v.playbackRate, vol: +v.volume.toFixed(3) }; })()`,
  inPkts: `(async () => { let n = 0; for (const pc of (window.__pcs||[])) { if (pc.connectionState !== "connected" || !pc.getTransceivers().length) continue; const st = await pc.getStats(); st.forEach(r => { if (r.type === "inbound-rtp" && r.kind === "audio") n += r.packetsReceived; }); } return n; })()`,
  inLevel: `(async () => { let lv = 0; for (const pc of (window.__pcs||[])) { if (pc.connectionState !== "connected" || !pc.getTransceivers().length) continue; const st = await pc.getStats(); st.forEach(r => { if (r.type === "inbound-rtp" && r.kind === "audio") lv = Math.max(lv, r.totalAudioEnergy || 0); }); } return lv; })()`,
  log: `window.__log.slice(-6)`,
};
const chat = (text) => `(() => { const i = document.querySelector("#wt-input"); i.value = ${JSON.stringify(text)}; const f = document.querySelector("#wt-form"); f.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); return true; })()`;

(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const sport = server.address().port;
  const results = [];
  const T0 = Date.now();
  let H, G, ch = [], code;
  const rec = (id, name, pass, detail) => { results.push({ id, name, pass: !!pass, detail }); console.log((pass ? "PASS " : "FAIL ") + id + " " + name + "  " + JSON.stringify(detail)); };
  const want = (id) => !ONLY || ONLY.includes(id);
  const waitFor = async (P, expr, pred, ms) => { const t = Date.now(); let v; while (Date.now() - t < ms) { try { v = await P.eval(expr); if (pred(v)) return { ok: true, ms: Date.now() - t, v }; } catch (_) {} await sleep(200); } return { ok: false, ms: Date.now() - t, v }; };
  const synced = (s) => /Synced with/.test(s);
  const url = (role, extra = "") => `http://127.0.0.1:${sport}/${role === "guest" ? GBUILD : BUILD}/rig.html?role=${role}&code=${code}&vid=1${extra}`;
  const twoWayVoice = async (ms) => {
    const t = Date.now();
    const a0 = await H.eval(J.inPkts).catch(() => 0), b0 = await G.eval(J.inPkts).catch(() => 0);
    while (Date.now() - t < ms) {
      await sleep(500);
      const a = await H.eval(J.inPkts).catch(() => 0), b = await G.eval(J.inPkts).catch(() => 0);
      if (a > a0 + 40 && b > b0 + 40) return { ok: true, ms: Date.now() - t, hostIn: a - a0, guestIn: b - b0 };
    }
    return { ok: false, ms: Date.now() - t, hostIn: (await H.eval(J.inPkts).catch(() => 0)) - a0, guestIn: (await G.eval(J.inPkts).catch(() => 0)) - b0 };
  };
  const newCode = () => ("E" + Math.random().toString(36).slice(2, 7)).toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 6);
  async function boot(extraHost = "", extraGuest = "") {
    code = newCode();
    ch.forEach(c => { try { c.kill(); } catch (_) {} });
    ch = [launch("eh", 9411, path.join(__dirname, "host.wav")), launch("eg", 9412, path.join(__dirname, "guest_normal.wav"))];
    H = await cdpPage(9411); G = await cdpPage(9412);
    for (const P of [H, G]) { await P.send("Page.enable"); await P.send("Runtime.enable"); }
    await H.send("Page.navigate", { url: url("host", extraHost) });
    await sleep(600);
    await G.send("Page.navigate", { url: url("guest", extraGuest) });
  }

  try {
    // ---------------- S1: connect ----------------
    await boot("&mic=0", "&mic=0");
    const s1 = await waitFor(H, J.status, synced, 30000);
    const s1g = await waitFor(G, J.status, synced, 5000);
    rec("S1", "party connects (both sides Synced)", s1.ok && s1g.ok, { ms: s1.ms, host: s1.v, guest: s1g.v });
    if (!s1.ok) throw new Error("cannot continue without a connection");

    // ---------------- S2: playback sync ----------------
    if (want("S2")) {
      await sleep(1500);
      await H.eval(`document.getElementById("vid").play().then(() => true)`, true);
      const p1 = await waitFor(G, J.vid, v => !v.paused && v.t > 0.3, 6000);
      rec("S2a", "host PLAY -> guest plays", p1.ok, { ms: p1.ms, guest: p1.v });
      await sleep(2500);
      const hv = await H.eval(J.vid), gv = await G.eval(J.vid);
      rec("S2b", "positions stay in sync while playing (<1.0 s)", Math.abs(hv.t - gv.t) < 1.0, { host: hv.t, guest: gv.t });
      await H.eval(`document.getElementById("vid").pause(), true`, true);
      const p2 = await waitFor(G, J.vid, v => v.paused, 6000);
      const hv2 = await H.eval(J.vid), gv2 = await G.eval(J.vid);
      rec("S2c", "host PAUSE -> guest pauses at same spot", p2.ok && Math.abs(hv2.t - gv2.t) < 0.8, { ms: p2.ms, host: hv2.t, guest: gv2.t });
      await H.eval(`(() => { const v = document.getElementById("vid"); v.currentTime = 30; return true; })()`, true);
      const p3 = await waitFor(G, J.vid, v => Math.abs(v.t - 30) < 0.8, 6000);
      rec("S2d", "host SEEK to 30 s -> guest follows", p3.ok, { ms: p3.ms, guest: p3.v });
      await G.eval(`document.getElementById("vid").play().then(() => true)`, true);
      const p4 = await waitFor(H, J.vid, v => !v.paused, 6000);
      rec("S2e", "guest PLAY -> host plays (both directions)", p4.ok, { ms: p4.ms, host: p4.v });
      await sleep(1500);
      await G.eval(`(() => { const v = document.getElementById("vid"); v.currentTime = 10; return true; })()`, true);
      const p5 = await waitFor(H, J.vid, v => Math.abs(v.t - 10) < 1.5, 6000);
      rec("S2f", "guest SEEK to 10 s -> host follows", p5.ok, { ms: p5.ms, host: p5.v });
      await H.eval(`(() => { document.getElementById("vid").playbackRate = 1.5; return true; })()`, true);
      const p6 = await waitFor(G, J.vid, v => Math.abs(v.rate - 1.5) < 0.01, 6000);
      rec("S2g", "host speed 1.5x -> guest 1.5x", p6.ok, { ms: p6.ms, guest: p6.v });
      await H.eval(`(() => { document.getElementById("vid").playbackRate = 1; return true; })()`, true);
      await sleep(3000);
      const hv7 = await H.eval(J.vid), gv7 = await G.eval(J.vid);
      rec("S2h", "still in sync after speed changes (<1.0 s)", Math.abs(hv7.t - gv7.t) < 1.0, { host: hv7, guest: gv7 });
      await H.eval(`document.getElementById("vid").pause(), true`, true);
      await sleep(1200);
    }

    // ---------------- S3: chat ----------------
    if (want("S3")) {
      const tag = "hello-" + Math.random().toString(36).slice(2, 7);
      await H.eval(chat(tag + "-from-host"), true);
      const c1 = await waitFor(G, J.msgs, m => m.some(x => x.includes(tag + "-from-host")), 5000);
      rec("S3a", "chat host -> guest", c1.ok, { ms: c1.ms });
      await G.eval(chat(tag + "-from-guest"), true);
      const c2 = await waitFor(H, J.msgs, m => m.some(x => x.includes(tag + "-from-guest")), 5000);
      rec("S3b", "chat guest -> host", c2.ok, { ms: c2.ms });
    }

    // ---------------- S4: voice ----------------
    await H.eval(`document.querySelector("#wt-mic").click(), true`, true);
    await sleep(300);
    await G.eval(`document.querySelector("#wt-mic").click(), true`, true);
    const v1 = await twoWayVoice(12000);
    const d1 = await H.eval(J.dbg);
    rec("S4", "two-way voice flows after both mics ON", v1.ok, { ...v1, path: d1 && d1.path });

    // ---------------- S5: guest reloads mid-movie ----------------
    if (want("S5")) {
      await G.send("Page.navigate", { url: url("guest", "&mic=1") });
      const r1 = await waitFor(H, J.status, s => !synced(s), 8000);
      const r2 = await waitFor(G, J.status, synced, 40000);
      const r3 = await waitFor(H, J.status, synced, 5000);
      rec("S5a", "guest tab reload -> party reconnects", r2.ok && r3.ok, { lostSeenOnHost: r1.ok, ms: r2.ms, host: r3.v });
      const v2 = await twoWayVoice(25000);
      rec("S5b", "voice back after guest reload (mic remembered)", v2.ok, v2);
    }

    // ---------------- S6: host reloads ----------------
    if (want("S6")) {
      await H.send("Page.navigate", { url: url("host", "&mic=1") });
      const r2 = await waitFor(H, J.status, synced, 45000);
      const r3 = await waitFor(G, J.status, synced, 8000);
      rec("S6a", "host tab reload -> party reconnects", r2.ok && r3.ok, { ms: r2.ms, host: r2.v, guest: r3.v });
      const v3 = await twoWayVoice(25000);
      rec("S6b", "voice back after host reload", v3.ok, v3);
    }

    // ---------------- S7: link dies (Wi-Fi blip) ----------------
    if (want("S7")) {
      const n = await G.eval(`__killLinks()`);
      const r1 = await waitFor(G, J.status, s => !synced(s), 8000);
      const r2 = await waitFor(G, J.status, synced, 60000);
      const r3 = await waitFor(H, J.status, synced, 8000);
      rec("S7a", "all P2P links killed on guest -> reconnects", r2.ok && r3.ok, { killed: n, noticed: r1.ok, ms: r2.ms, host: r3.v });
      const v4 = await twoWayVoice(30000);
      rec("S7b", "voice back after link drop", v4.ok, v4);
    }

    // ---------------- S8: PeerJS server dies mid-party, then link drops ----------------
    if (want("S8")) {
      await H.eval(`__killSignaling()`); await G.eval(`__killSignaling()`);
      await sleep(2000);
      const stillUp = await H.eval(J.status);
      rec("S8a", "PeerJS server loss alone does not break a live party", synced(stillUp), { host: stillUp });
      const n = await G.eval(`__killLinks()`);
      const r2 = await waitFor(G, J.status, synced, 60000);
      const r3 = await waitFor(H, J.status, synced, 8000);
      rec("S8b", "server down + link drop -> reconnects anyway", r2.ok && r3.ok, { killed: n, ms: r2.ms, host: r3.v, guest: r2.v });
      if (r2.ok) { const v5 = await twoWayVoice(30000); rec("S8c", "voice back without the PeerJS server", v5.ok, v5); }
    }

    // ---------------- S9: PeerJS server unreachable from the start ----------------
    if (want("S9")) {
      await boot("&block=1&mic=1", "&block=1&mic=1");
      const r1 = await waitFor(H, J.status, synced, 60000);
      const r2 = await waitFor(G, J.status, synced, 5000);
      rec("S9a", "PeerJS server unreachable -> party still connects (no manual codes)", r1.ok && r2.ok, { ms: r1.ms, host: r1.v, guest: r2.v });
      if (r1.ok) { const v6 = await twoWayVoice(30000); rec("S9b", "voice works without the PeerJS server", v6.ok, v6); }
    }

    // ---------------- S10: guest joins BEFORE host ----------------
    if (want("S10")) {
      code = newCode();
      await G.send("Page.navigate", { url: url("guest", "&mic=0") });
      await sleep(12000);
      await H.send("Page.navigate", { url: url("host", "&mic=0") });
      const r1 = await waitFor(G, J.status, synced, 45000);
      rec("S10", "guest opens first, host 12 s later -> connects", r1.ok, { ms: r1.ms, guest: r1.v });
    }
  } catch (e) {
    rec("X", "harness", false, String(e && e.message || e));
  } finally {
    try { results.push({ id: "logs", host: await H.eval(J.log), guest: await G.eval(J.log) }); } catch (_) {}
    ch.forEach(c => { try { c.kill(); } catch (_) {} });
    server.close();
  }
  fs.writeFileSync(path.join(__dirname, `e2e-${BUILD}${GBUILD !== BUILD ? "-g" + GBUILD : ""}.json`), JSON.stringify(results, null, 1));
  const r = results.filter(x => x.id !== "logs");
  console.log(`\n${BUILD}: ${r.filter(x => x.pass).length}/${r.length} passed in ${Math.round((Date.now() - T0) / 1000)} s`);
  process.exit(0);
})();
