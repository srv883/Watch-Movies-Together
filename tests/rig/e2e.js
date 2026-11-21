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
    .replace('if (!SITE_HOSTS.some(d => host === d || host.endsWith("." + d))) return;', "void SITE_HOSTS; // rig: guard bypassed")
    // the rig's pages count as a streaming site (follow-the-friend compares hosts)
    .replace('const SITE_HOSTS = [', 'const SITE_HOSTS = ["127.0.0.1", ')
    .replace('const NAV_FAMILIES = { hotstar: [', 'const NAV_FAMILIES = { hotstar: ["127.0.0.1", ');
  fs.writeFileSync(path.join(www, "content.js"), src);
  fs.copyFileSync(path.join(VERS, b, "lib/peerjs.min.js"), path.join(www, "lib/peerjs.min.js"));
  fs.copyFileSync(path.join(VERS, b, "overlay.css"), path.join(www, "overlay.css"));
  fs.copyFileSync(path.join(__dirname, "rig.html"), path.join(www, "rig.html"));
  fs.copyFileSync(path.join(__dirname, "movie.wav"), path.join(www, "movie.wav"));
}
// stall.wav?id=X&at=S : the movie, but the download stops after S seconds of
// audio until /__release?id=X - a REAL buffering stall for the <video>
// Range requests are honoured (Chrome re-requests a stalled download from
// where it stopped); bytes past the cut wait for the release. A new page load
// (new n=) re-arms the stall.
const stallOk = {}, stallPage = {}, stallLog = [];
function serveStall(q, r, build, qp) {
  const id = qp.get("id") || "x", at = Number(qp.get("at") || 8), n = qp.get("n") || "";
  if (stallPage[id] !== n) { stallPage[id] = n; stallOk[id] = false; }
  const buf = fs.readFileSync(path.join(wwwRoot, build, "movie.wav"));
  const cut = Math.min(buf.length, 44 + Math.floor(buf.readUInt32LE(28) * at / 2) * 2);
  let start = 0, end = buf.length - 1;
  const m = /bytes=(\d+)-(\d*)/.exec(q.headers.range || "");
  if (m) { start = Math.min(+m[1], buf.length - 1); if (m[2]) end = Math.min(+m[2], end); }
  stallLog.push({ id, range: q.headers.range || null, t: Date.now() });
  const hd = { "Content-Type": "audio/wav", "Cache-Control": "no-store", "Accept-Ranges": "bytes", "Content-Length": end - start + 1 };
  if (m) hd["Content-Range"] = `bytes ${start}-${end}/${buf.length}`;
  r.writeHead(m ? 206 : 200, hd);
  const first = Math.max(start, Math.min(end + 1, stallOk[id] ? end + 1 : cut));
  if (first > start) r.write(buf.subarray(start, first));
  if (first > end) return r.end();
  const t = setInterval(() => { if (stallOk[id]) { clearInterval(t); r.end(buf.subarray(first, end + 1)); } }, 100);
  r.on("close", () => clearInterval(t));
}
const server = http.createServer((q, r) => {
  const [pth, qstr] = q.url.split("?");
  const parts = decodeURIComponent(pth).split("/").filter(Boolean);
  if (parts[0] === "__release") { stallOk[new URLSearchParams(qstr || "").get("id")] = true; r.writeHead(200); return r.end("ok"); }
  const base = parts[parts.length - 1] || "";
  if (base === "stall.wav") return serveStall(q, r, parts[0], new URLSearchParams(qstr || ""));
  let f = path.join(wwwRoot, decodeURIComponent(pth));
  // "episode" pages: /<build>/shows/<show>/<id>/<episode>/<id>/watch -> rig.html,
  // and their relative assets -> the build folder
  if (parts.length > 1 && (base === "watch" || base === "home")) f = path.join(wwwRoot, parts[0], "rig.html");
  else if (parts.length > 2 && !fs.existsSync(f)) f = path.join(wwwRoot, parts[0], parts[parts.length - 2] === "lib" ? "lib" : "", base);
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
  pcs: `(async () => { const out = []; for (const pc of (window.__pcs || [])) { const o = { st: pc.connectionState, ice: pc.iceConnectionState, local: [], remote: [], pair: null }; try { const st = await pc.getStats(); st.forEach(r => { if (r.type === "local-candidate") o.local.push(r.candidateType); if (r.type === "remote-candidate") o.remote.push(r.candidateType); if (r.type === "candidate-pair" && r.nominated) o.pair = r.state; }); } catch (_) {} out.push(o); } return out; })()`,
  banner: `[...document.querySelectorAll(".wt-banner")].map(b => b.textContent).join(" | ")`,
};
const user = (js) => `(() => { document.dispatchEvent(new Event("keydown", { bubbles: true })); return (${js}); })()`;
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
  const EP = (slug, id) => `shows/the-office/1001/${slug}/${id}/watch`;
  const url = (role, extra = "", page = EP("night-out", "2001")) => `http://127.0.0.1:${sport}/${role === "guest" ? GBUILD : BUILD}/${page}?role=${role}&code=${code}&vid=1${extra}`;
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
  async function boot(extraHost = "", extraGuest = "", page = EP("night-out", "2001")) {
    code = newCode();
    ch.forEach(c => { try { c.kill(); } catch (_) {} });
    if (ch.length) await sleep(1500);
    ch = [launch("eh", 9411, path.join(__dirname, "host.wav")), launch("eg", 9412, path.join(__dirname, "guest_normal.wav"))];
    H = await cdpPage(9411); G = await cdpPage(9412);
    for (const P of [H, G]) { await P.send("Page.enable"); await P.send("Runtime.enable"); }
    await H.send("Page.navigate", { url: url("host", extraHost, page) });
    await sleep(600);
    await G.send("Page.navigate", { url: url("guest", extraGuest, page) });
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
      await H.eval(user(`document.getElementById("vid").play().then(() => true)`), true);
      const p1 = await waitFor(G, J.vid, v => !v.paused && v.t > 0.3, 6000);
      rec("S2a", "host PLAY -> guest plays", p1.ok, { ms: p1.ms, guest: p1.v });
      await sleep(2500);
      const hv = await H.eval(J.vid), gv = await G.eval(J.vid);
      rec("S2b", "positions stay in sync while playing (<1.0 s)", Math.abs(hv.t - gv.t) < 1.0, { host: hv.t, guest: gv.t });
      await H.eval(user(`(document.getElementById("vid").pause(), true)`), true);
      const p2 = await waitFor(G, J.vid, v => v.paused, 6000);
      const hv2 = await H.eval(J.vid), gv2 = await G.eval(J.vid);
      rec("S2c", "host PAUSE -> guest pauses at same spot", p2.ok && Math.abs(hv2.t - gv2.t) < 0.8, { ms: p2.ms, host: hv2.t, guest: gv2.t });
      await H.eval(user(`(() => { const v = document.getElementById("vid"); v.currentTime = 30; return true; })()`), true);
      const p3 = await waitFor(G, J.vid, v => Math.abs(v.t - 30) < 0.8, 6000);
      rec("S2d", "host SEEK to 30 s -> guest follows", p3.ok, { ms: p3.ms, guest: p3.v });
      await G.eval(user(`document.getElementById("vid").play().then(() => true)`), true);
      const p4 = await waitFor(H, J.vid, v => !v.paused, 6000);
      rec("S2e", "guest PLAY -> host plays (both directions)", p4.ok, { ms: p4.ms, host: p4.v });
      await sleep(1500);
      await G.eval(user(`(() => { const v = document.getElementById("vid"); v.currentTime = 10; return true; })()`), true);
      const p5 = await waitFor(H, J.vid, v => Math.abs(v.t - 10) < 1.5, 6000);
      rec("S2f", "guest SEEK to 10 s -> host follows", p5.ok, { ms: p5.ms, host: p5.v });
      await H.eval(user(`(() => { document.getElementById("vid").playbackRate = 1.5; return true; })()`), true);
      const p6 = await waitFor(G, J.vid, v => Math.abs(v.rate - 1.5) < 0.01, 6000);
      rec("S2g", "host speed 1.5x -> guest 1.5x", p6.ok, { ms: p6.ms, guest: p6.v });
      await H.eval(user(`(() => { document.getElementById("vid").playbackRate = 1; return true; })()`), true);
      await sleep(3000);
      const hv7 = await H.eval(J.vid), gv7 = await G.eval(J.vid);
      rec("S2h", "still in sync after speed changes (<1.0 s)", Math.abs(hv7.t - gv7.t) < 1.0, { host: hv7, guest: gv7 });
      await H.eval(user(`(document.getElementById("vid").pause(), true)`), true);
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
      rec("S8b", "server down + link drop -> reconnects anyway", r2.ok && r3.ok, { killed: n, ms: r2.ms, host: r3.v, guest: r2.v, ...(r2.ok && r3.ok ? {} : { hDbg: await H.eval(J.dbg).catch(() => null), gDbg: await G.eval(J.dbg).catch(() => null), hLog: await H.eval(J.log).catch(() => null), gLog: await G.eval(J.log).catch(() => null) }) });
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

    // ---------------- S11: follow the friend to the next episode ----------------
    if (want("S11")) {
      await boot("&mic=0", "&mic=0", EP("night-out", "2001"));
      const r1 = await waitFor(H, J.status, synced, 30000);
      const r1g = await waitFor(G, J.status, synced, 5000);
      rec("S11a", "party on an episode page connects", r1.ok && r1g.ok, { ms: r1.ms, ...(r1.ok ? {} : { hDbg: await H.eval(J.dbg).catch(() => null), gDbg: await G.eval(J.dbg).catch(() => null), hPcs: await H.eval(J.pcs).catch(() => null), gPcs: await G.eval(J.pcs).catch(() => null), gLog: await G.eval(J.log).catch(() => null) }) });
      if (r1.ok) {
        const tag = "before-follow-" + Math.random().toString(36).slice(2, 6);
        await H.eval(chat(tag), true);
        await waitFor(G, J.msgs, m => m.some(x => x.includes(tag)), 5000);
        await sleep(1500); // let the guest save its chat
        const next = `/${BUILD}/` + EP("did-i-stutter", "2002");
        await H.eval(`history.pushState({}, "", ${JSON.stringify(next)}), true`);   // Hotstar-style SPA episode change
        const b = await waitFor(G, J.banner, t => /Sourav moved to The Office . Did I Stutter/.test(t), 6000);
        rec("S11b", "guest sees 'Sourav moved to ... Did I Stutter - following in ...'", b.ok, { ms: b.ms, banner: b.v });
        const n = await waitFor(G, `location.pathname`, p => p.endsWith("/did-i-stutter/2002/watch"), 12000);
        rec("S11c", "guest's tab follows to the new episode by itself", n.ok, { ms: n.ms, at: n.v });
        const r2 = await waitFor(G, J.status, synced, 40000);
        const r3 = await waitFor(H, J.status, synced, 8000);
        rec("S11d", "party reconnects on the new episode", r2.ok && r3.ok, { ms: r2.ms, guest: r2.v, host: r3.v });
        const m = await waitFor(G, J.msgs, ms => ms.some(x => x.includes(tag)), 5000);
        rec("S11e", "chat from before the page load is still there", m.ok, { lines: (m.v || []).length });
        await sleep(3000);
        const hb = await H.eval(J.banner);
        rec("S11f", "host is not asked to follow back", !hb, { hostBanner: hb });
      }
    }

    // ---------------- S12: buffering - host stalls, then guest stalls ----------------
    if (want("S12")) {
      await boot("&mic=0&stall=h&at=8", "&mic=0&stall=g&at=22");
      const r1 = await waitFor(H, J.status, synced, 30000);
      await waitFor(G, J.status, synced, 5000);
      if (r1.ok) {
        await sleep(1500);
        await H.eval(user(`document.getElementById("vid").play().then(() => true)`), true);
        await waitFor(G, J.vid, v => !v.paused && v.t > 0.3, 6000);
        // host's download stops at 8 s of movie -> real buffering
        const hs = await waitFor(H, J.dbg, d => d && d.buf && d.buf.me, 25000);
        const gw = await waitFor(G, J.vid, v => v.paused, 4000);
        const gb = await G.eval(J.banner);
        rec("S12a", "host buffers -> guest pauses and shows 'Waiting for Sourav'", hs.ok && gw.ok && /Waiting for Sourav/.test(gb || ""),
          { hostRs: hs.v && hs.v.buf && hs.v.buf.rs, ms: gw.ms, guest: gw.v, banner: gb });
        // no rewind loop while the host is stuck
        const samples = [];
        for (let i = 0; i < 16; i++) { samples.push(await G.eval(J.vid)); await sleep(500); }
        const back = samples.filter((s2, i) => i && s2.t < samples[i - 1].t - 1).length;
        rec("S12b", "guest waits quietly (no rewinding, stays paused) while the host buffers", back === 0 && samples.every(s2 => s2.paused),
          { backJumps: back, first: samples[0], last: samples[samples.length - 1] });
        await fetch(`http://127.0.0.1:${sport}/__release?id=h`);
        const gr = await waitFor(G, J.vid, v => !v.paused, 8000);
        await sleep(2500);
        const h2 = await H.eval(J.vid), g2 = await G.eval(J.vid);
        rec("S12c", "host's data back -> both resume together (<1.0 s apart)", gr.ok && !h2.paused && Math.abs(h2.t - g2.t) < 1.0,
          { ms: gr.ms, host: h2, guest: g2 });
        // guest's download stops at 22 s of movie -> host waits
        const gs = await waitFor(G, J.dbg, d => d && d.buf && d.buf.me, 25000);
        const hw = await waitFor(H, J.vid, v => v.paused, 4000);
        const hbn = await H.eval(J.banner);
        rec("S12d", "guest buffers -> host pauses and shows 'Waiting for Megha'", gs.ok && hw.ok && /Waiting for Megha/.test(hbn || ""),
          { ms: hw.ms, host: hw.v, banner: hbn });
        await sleep(6000);
        const g3 = await G.eval(J.vid);
        rec("S12e", "buffering guest is not paused by the host's wait", !g3.paused, { guest: g3 });
        await fetch(`http://127.0.0.1:${sport}/__release?id=g`);
        const hr = await waitFor(H, J.vid, v => !v.paused, 8000);
        await sleep(2500);
        const h4 = await H.eval(J.vid), g4 = await G.eval(J.vid);
        rec("S12f", "guest's data back -> both resume together (<1.0 s apart)", hr.ok && !g4.paused && Math.abs(h4.t - g4.t) < 1.0,
          { ms: hr.ms, host: h4, guest: g4 });
      } else rec("S12a", "buffering scenario connects", false, { hDbg: await H.eval(J.dbg).catch(() => null), gDbg: await G.eval(J.dbg).catch(() => null), hPcs: await H.eval(J.pcs).catch(() => null), gPcs: await G.eval(J.pcs).catch(() => null), gLog: await G.eval(J.log).catch(() => null) });
    }

    // ---------------- S13: catalogue trailers / another page never drive the party ----------------
    if (want("S13")) {
      await boot("&mic=0", "&mic=0&stall=t&at=999");
      const r1 = await waitFor(H, J.status, synced, 30000);
      await waitFor(G, J.status, synced, 5000);
      if (r1.ok) {
        await sleep(1500);
        await H.eval(user(`document.getElementById("vid").play().then(() => true)`), true);
        await waitFor(G, J.vid, v => !v.paused && v.t > 0.3, 6000);
        await sleep(6000);
        // Megha goes back to the catalogue (SPA, like Hotstar); the "trailer" there is this page's 60 s clip
        await G.eval(`history.pushState({}, "", ${JSON.stringify("/" + GBUILD + "/home")}), true`);
        const st = await waitFor(H, J.status, x => /browsing/i.test(x), 6000);
        rec("S13a", "friend goes to the catalogue -> host is told sync is paused", st.ok, { ms: st.ms, host: st.v, guest: await G.eval(J.status), ...(st.ok ? {} : { gSync: await G.eval(`(() => { const d = window.__wtVoiceDbg(); const v = document.getElementById("vid"); return { sync: d.sync, nav: d.nav, href: location.href, dur: v.duration, log: window.__log.slice(-5) }; })()`).catch(e => String(e)), hSync: await H.eval(`window.__wtVoiceDbg().sync`).catch(e => String(e)) }) });
        const h0 = await H.eval(J.vid);
        // trailer restarts and pauses on the guest's page (what Hotstar's hero banner does on its own)
        await G.eval(`(() => { const v = document.getElementById("vid"); v.currentTime = 1; v.pause(); return true; })()`);
        await sleep(2500);
        await G.eval(`document.getElementById("vid").play().then(() => true)`);
        await sleep(4500);
        const h1 = await H.eval(J.vid);
        rec("S13b", "trailer seek/pause/play on the friend's side do not touch the host's episode",
          !h1.paused && h1.t > h0.t + 5 && h1.t < h0.t + 9, { before: h0, after: h1 });
        // host seeks while the friend is browsing: the trailer must not follow
        const g0 = await G.eval(J.vid);
        await H.eval(user(`(() => { const v = document.getElementById("vid"); v.currentTime = 40; return true; })()`), true);
        await sleep(2000);
        const g1 = await G.eval(J.vid);
        rec("S13c", "host's seek does not move the friend's trailer", Math.abs(g1.t - 40) > 5, { guestBefore: g0, guestAfter: g1 });
        // Megha opens the episode again: back in sync at the host's position, by itself
        await G.eval(`history.pushState({}, "", ${JSON.stringify("/" + GBUILD + "/" + EP("night-out", "2001"))}), true`);
        const back = await waitFor(G, J.status, synced, 8000);
        await sleep(3000);
        const h2 = await H.eval(J.vid), g2 = await G.eval(J.vid);
        rec("S13d", "back on the episode -> synced again at the host's position (<1.0 s)", back.ok && !g2.paused && Math.abs(h2.t - g2.t) < 1.0,
          { ms: back.ms, host: h2, guest: g2 });
      } else rec("S13a", "trailer scenario connects", false, {});
    }

    // ---------------- S14: a tab that reloads mid-episode rejoins the party's position ----------------
    if (want("S14")) {
      await boot("&mic=0&auto=1", "&mic=0&auto=1");
      const r1 = await waitFor(H, J.status, synced, 30000);
      await waitFor(G, J.status, synced, 5000);
      if (r1.ok) {
        await sleep(8000);   // both settled (the players auto-started like a streaming site's)
        await H.eval(user(`(() => { const v = document.getElementById("vid"); v.currentTime = 5; return v.play().then(() => true); })()`), true);   // (the clip is only 60 s long)
        await waitFor(G, J.vid, v => !v.paused && v.t > 4.5, 6000);
        await sleep(3000);
        const g0 = await G.eval(J.vid);
        // HOST tab reloads: its player auto-starts from 0 again
        await H.send("Page.navigate", { url: url("host", "&mic=0&auto=1") });
        const samples = [];
        const t0 = Date.now();
        while (Date.now() - t0 < 14000) { try { samples.push(await G.eval(J.vid)); } catch (_) {} await sleep(400); }
        const r2 = await waitFor(H, J.status, synced, 30000);
        await sleep(2500);
        const h1 = await H.eval(J.vid), g1 = await G.eval(J.vid);
        const minG = Math.min(...samples.map(x => x.t));
        rec("S14a", "host reloads mid-episode -> the guest is never pulled back to the start", minG >= g0.t - 1.5, { guestBefore: g0.t, guestMin: minG, guestNow: g1 });
        rec("S14b", "the reloaded host rejoins at the guest's position (<1.5 s)", r2.ok && !h1.paused && !g1.paused && Math.abs(h1.t - g1.t) < 1.5, { ms: r2.ms, host: h1, guest: g1 });
        // GUEST tab reloads
        const h2 = await H.eval(J.vid);
        await G.send("Page.navigate", { url: url("guest", "&mic=0&auto=1") });
        const hs = [];
        const t1 = Date.now();
        while (Date.now() - t1 < 14000) { try { hs.push(await H.eval(J.vid)); } catch (_) {} await sleep(400); }
        const r3 = await waitFor(G, J.status, synced, 30000);
        await sleep(2500);
        const h3 = await H.eval(J.vid), g3 = await G.eval(J.vid);
        const minH = Math.min(...hs.map(x => x.t));
        rec("S14c", "guest reloads mid-episode -> the host is never pulled back", minH >= h2.t - 1.5 && !hs.some(x => x.paused), { hostBefore: h2.t, hostMin: minH, hostNow: h3 });
        rec("S14d", "the reloaded guest rejoins at the host's position (<1.5 s)", r3.ok && !g3.paused && Math.abs(h3.t - g3.t) < 1.5, { ms: r3.ms, host: h3, guest: g3 });
      } else rec("S14a", "reload scenario connects", false, {});
    }

    // ---------------- S15: AI trivia cards in the real player (fake background) ----------------
    if (want("S15")) {
      await boot("&mic=0&trivia=1&stall=th&at=999", "&mic=0&stall=tg&at=999");
      const r1 = await waitFor(H, J.status, synced, 30000);
      await waitFor(G, J.status, synced, 5000);
      if (r1.ok) {
        // runtime must be >= 10 min for trivia: stretch what the page reports (the clip is 60 s)
        for (const P of [H, G]) await P.eval(`(() => { const v = document.getElementById("vid"); Object.defineProperty(v, "duration", { get: () => 1320, configurable: true }); return true; })()`);
        const ready = await waitFor(G, J.msgs, ms => ms.some(x => /Trivia ready/.test(x)), 12000);
        rec("S15a", "host's trivia is shared with the friend (who has no key)", ready.ok, { ms: ready.ms, line: (ready.v || []).find(x => /Trivia ready/.test(x)) });
        const hAsk = await H.eval(`(window.__rtMsgs || []).filter(m => m.t === "wt-trivia").length`);
        const gAsk = await G.eval(`(window.__rtMsgs || []).filter(m => m.t === "wt-trivia").length`);
        rec("S15b", "each side asks its own background once (packs/Wikipedia need no key)", hAsk === 1 && gAsk === 1, { hostAsks: hAsk, guestAsks: gAsk });
        await H.eval(user(`document.getElementById("vid").play().then(() => true)`), true);
        const card = `[...document.querySelectorAll(".wt-trivia")].map(c => ({ text: c.textContent, left: Math.round(c.getBoundingClientRect().left), top: Math.round(c.getBoundingClientRect().top), w: Math.round(c.getBoundingClientRect().width), op: getComputedStyle(c).opacity }))`;
        const c1 = await waitFor(H, card, cs => cs.some(c => /RIG-FACT-ONE/.test(c.text)), 9000);
        const g1 = await waitFor(G, card, cs => cs.some(c => /RIG-FACT-ONE/.test(c.text)), 3000);
        const t1 = await H.eval(J.vid);
        rec("S15c", "first card appears at its moment (4 s) on both screens", c1.ok && g1.ok && t1.t < 9, { at: t1.t, host: c1.v, guest: g1.v });
        try {
          await H.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
          await H.eval(`(() => { const v = document.getElementById("vid"); v.style.width = "100vw"; v.style.height = "100vh"; v.style.position = "fixed"; v.style.left = "0"; v.style.top = "0"; return true; })()`);
          await sleep(500);
          const shot = await H.send("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(path.join(__dirname, "trivia-card.png"), Buffer.from(shot.data, "base64"));
        } catch (_) {}
        const gone = await waitFor(H, card, cs => !cs.some(c => /RIG-FACT-ONE/.test(c.text)), 16000);
        rec("S15d", "the card leaves by itself after ~12 s", gone.ok, { ms: gone.ms });
        const c2 = await waitFor(H, card, cs => cs.some(c => /RIG-FACT-TWO/.test(c.text)), 15000);
        rec("S15e", "second card at its moment (24 s), on the other side", c2.ok && c1.ok && c2.v.find(c => /TWO/.test(c.text)).left !== c1.v.find(c => /ONE/.test(c.text)).left, { first: c1.v && c1.v[0], second: c2.v && c2.v[0] });
      } else rec("S15a", "trivia scenario connects", false, {});
    }

    // ---------------- S16: trivia pops up on the line it is about (subtitles) ----------------
    if (want("S16")) {
      await boot("&mic=0&trivia=2&subs=1&stall=ch&at=999", "&mic=0&subs=1&stall=cg&at=999");
      const r1 = await waitFor(H, J.status, synced, 30000);
      await waitFor(G, J.status, synced, 5000);
      if (r1.ok) {
        for (const P of [H, G]) await P.eval(`(() => { const v = document.getElementById("vid"); Object.defineProperty(v, "duration", { get: () => 1320, configurable: true }); return true; })()`);
        await waitFor(G, J.msgs, ms => ms.some(x => /Trivia ready/.test(x)), 12000);
        await H.eval(user(`document.getElementById("vid").play().then(() => true)`), true);
        const card = `[...document.querySelectorAll(".wt-trivia")].map(c => c.textContent)`;
        const vt = async (P) => (await P.eval(J.vid)).t;
        // before the line: nothing (the old version would have shown the 10 s fact at 10 s)
        const early = await waitFor(H, J.vid, v => v.t >= 10.5, 15000);
        const c0 = await H.eval(card);
        rec("S16a", "no card before its line is on screen", early.ok && !c0.some(c => /CUE-FACT-THOR/.test(c)), { at: early.v && early.v.t, cards: c0 });
        const c1 = await waitFor(H, card, cs => cs.some(c => /CUE-FACT-THOR/.test(c)), 6000);
        const t1 = await vt(H);
        const g1 = await waitFor(G, card, cs => cs.some(c => /CUE-FACT-THOR/.test(c)), 3000);
        rec("S16b", "card pops up as 'BRING ME... THANOS!' is shown (case/punctuation ignored), on both screens", c1.ok && g1.ok && t1 >= 11 && t1 < 14.5, { at: t1, host: c1.v, guest: g1.v });
        const c2 = await waitFor(H, card, cs => cs.some(c => /CUE-FACT-PETER/.test(c)), 30000);
        const t2 = await vt(H);
        rec("S16c", "a line from the video's own text track works too ('I don't feel so good' at 33 s)", c2.ok && t2 >= 33 && t2 < 37, { at: t2 });
        await sleep(9000);
        const all = await H.eval(card);
        rec("S16d", "a line that never appears never shows its fact", !all.some(c => /CUE-FACT-NEVER/.test(c)), { cards: all });
        const hint = await H.eval(`(() => { document.querySelector("#wt-trivia-btn").click(); document.querySelector("#wt-trivia-btn").click(); return [...document.querySelectorAll(".wt-toast")].map(t => t.textContent).pop(); })()`);
        rec("S16e", "🧠 says the facts are line-anchored and that subtitles were found", /scene facts.*each pops up on its line · subtitles found/.test(hint || ""), { toast: hint });
      } else rec("S16a", "cue scenario connects", false, {});
    }
  } catch (e) {
    rec("X", "harness", false, String(e && e.message || e));
  } finally {
    try { results.push({ id: "logs", host: await H.eval(J.log), guest: await G.eval(J.log), stall: stallLog }); } catch (_) {}
    ch.forEach(c => { try { c.kill(); } catch (_) {} });
    server.close();
  }
  fs.writeFileSync(path.join(__dirname, `e2e-${BUILD}${GBUILD !== BUILD ? "-g" + GBUILD : ""}.json`), JSON.stringify(results, null, 1));
  const r = results.filter(x => x.id !== "logs");
  console.log(`\n${BUILD}: ${r.filter(x => x.pass).length}/${r.length} passed in ${Math.round((Date.now() - T0) / 1000)} s`);
  process.exit(0);
})();
