// Real-Chrome voice rig: two headless Chromes (separate temp profiles), each
// with a fake mic fed from a WAV, run the REAL content.js + PeerJS + WebRTC
// over the internet, record what each listener hears, and score it.
//   node run.js --build V27-voiceboost --guest guest_quiet.wav [--host host.wav]
//               [--secs 14] [--settle 8] [--nc 1] [--block 0] [--label x]
const fs = require("fs"), path = require("path"), http = require("http"), cp = require("child_process");
const W = require("./wav");

const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const BUILD = A.build || "V27-voiceboost";
const GBUILD = A.gbuild || BUILD;
const HOST_WAV = path.join(__dirname, A.host || "host.wav");
const GUEST_WAV = path.join(__dirname, A.guest || "guest_normal.wav");
const SECS = Number(A.secs || 14), SETTLE = Number(A.settle || 8);
const LABEL = A.label || path.basename(GUEST_WAV, ".wav");
const VERS = "C:/Users/Sourav/ML Coding/watch-together-versions";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- serve www/<build> ----------
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
    const t = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" }[path.extname(f)] || "application/octet-stream";
    r.writeHead(200, { "Content-Type": t, "Cache-Control": "no-store" }); r.end(d);
  });
});

// ---------- minimal CDP client ----------
async function cdpPage(port) {
  for (let i = 0; i < 60; i++) {
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
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    };
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
  const prof = path.join(__dirname, "prof-" + name);
  fs.rmSync(prof, { recursive: true, force: true });
  return cp.spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`,
    "--autoplay-policy=no-user-gesture-required", "--mute-audio",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "about:blank",
  ], { stdio: "ignore" });
}

// ---------- analysis ----------
function fromB64(s) { const b = Buffer.from(s, "base64"); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); }
function resample(x, from, to) {
  if (from === to) return x;
  const n = Math.floor(x.length * to / from), y = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) { const p = i * r, k = Math.floor(p), f = p - k; y[i] = (x[k] || 0) * (1 - f) + (x[k + 1] || 0) * f; }
  return y;
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// 16 log-spaced bands 150..8000 Hz, 32 ms frames, 10 ms hop -> log energies
const SR = 48000, FR = 1536, HOP = 480, NB = 16;
const EDGES = Array.from({ length: NB + 1 }, (_, i) => 150 * Math.pow(8000 / 150, i / NB));
function bands(x) {
  const out = []; const win = new Float32Array(FR).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FR));
  const N = 2048;
  for (let s = 0; s + FR <= x.length; s += HOP) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < FR; i++) re[i] = x[s + i] * win[i];
    fft(re, im);
    const e = new Float64Array(NB); let hf = 0, tot = 0;
    for (let k = 1; k < N / 2; k++) {
      const f = k * SR / N, p = re[k] * re[k] + im[k] * im[k];
      tot += p; if (f >= 4000 && f < 12000) hf += p;
      for (let b = 0; b < NB; b++) if (f >= EDGES[b] && f < EDGES[b + 1]) { e[b] += p; break; }
    }
    out.push({ e: Array.from(e, v => Math.log10(v + 1e-12)), tot, hf });
  }
  return out;
}
function corr(a, b) {
  const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb + 1e-30);
}
// received x vs looping source s: align on the log-envelope (10 ms hop, circular)
function score(rx, srcWav, label) {
  const S = W.readWav(srcWav).x;
  const lv = W.activeLevel(rx, SR);
  let clip = 0, peak = 0; for (const v of rx) { const a = Math.abs(v); if (a > peak) peak = a; if (a >= 0.99) clip++; }
  const R = bands(rx), Sb = bands(S);
  const envR = R.map(f => Math.log10(f.tot + 1e-12)), envS = Sb.map(f => Math.log10(f.tot + 1e-12));
  // circular search over the whole loop
  let best = { lag: 0, c: -2 };
  const L = envS.length, n = Math.min(envR.length, L - 1);
  for (let lag = 0; lag < L; lag++) {
    const sv = new Array(n); for (let i = 0; i < n; i++) sv[i] = envS[(i + lag) % L];
    const c = corr(envR.slice(0, n), sv); if (c > best.c) best = { lag, c };
  }
  // band-wise correlation over speech frames (crude intelligibility proxy)
  const speech = [];
  for (let i = 0; i < n; i++) { const j = (i + best.lag) % L; if (envS[j] > Math.max(...envS) - 3.5) speech.push([i, j]); }
  let bc = 0; for (let b = 0; b < NB; b++) bc += corr(speech.map(([i]) => R[i].e[b]), speech.map(([, j]) => Sb[j].e[b]));
  bc /= NB;
  const hfR = R.reduce((a, f) => a + f.hf, 0) / R.reduce((a, f) => a + f.tot, 1e-30);
  const hfS = Sb.reduce((a, f) => a + f.hf, 0) / Sb.reduce((a, f) => a + f.tot, 1e-30);
  // level of the received signal while the source is SILENT (pauses / tail)
  const quiet = []; for (let i = 0; i < n; i++) { const j = (i + best.lag) % L; if (envS[j] < Math.max(...envS) - 6) quiet.push(R[i].tot); }
  const qs = quiet.slice().sort((a, b) => a - b); const quietDb = qs.length ? 10 * Math.log10(qs[Math.floor(qs.length / 2)] / (FR * FR / 4) + 1e-12) : null;
  return {
    label, speechDbfs: +lv.dbfs.toFixed(1), peak: +peak.toFixed(3), clipSamples: clip,
    envCorr: +best.c.toFixed(3), bandCorr: +bc.toFixed(3), hfRatio: +(hfR / (hfS + 1e-12)).toFixed(2),
    pauseDbfs: quietDb != null ? +quietDb.toFixed(1) : null,
  };
}

(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const sport = server.address().port;
  const code = ("R" + Math.random().toString(36).slice(2, 7)).toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 6);
  const q = (role) => `http://127.0.0.1:${sport}/${role === "guest" ? GBUILD : BUILD}/rig.html?role=${role}&code=${code}` + (role === "host" && A.movie === "1" ? "&movie=1" : "") + (A.nc != null ? `&nc=${A.nc}` : "") + (A.block === "1" ? "&block=1" : "") + (A.vol ? `&vol=${A.vol}` : "");
  const ch = [launch("host", 9311, HOST_WAV), launch("guest", 9312, GUEST_WAV)];
  const out = { build: BUILD, gbuild: GBUILD, label: LABEL, guestWav: path.basename(GUEST_WAV) };
  try {
    const H = await cdpPage(9311), G = await cdpPage(9312);
    for (const P of [H, G]) { await P.send("Page.enable"); await P.send("Runtime.enable"); }
    await H.send("Page.navigate", { url: q("host") });
    await sleep(800);
    await G.send("Page.navigate", { url: q("guest") });
    const synced = async (P) => { for (let i = 0; i < 80; i++) { const t = await P.eval(`(document.querySelector("#wt-status-text")||{}).textContent||""`); if (/Synced/.test(t)) return true; await sleep(250); } return false; };
    out.connected = (await synced(H)) && (await synced(G));
    if (!out.connected) throw new Error("not connected");
    await H.eval(`document.querySelector("#wt-mic").click(), true`, true);
    await sleep(400);
    await G.eval(`document.querySelector("#wt-mic").click(), true`, true);
    await sleep(SETTLE * 1000);
    await Promise.all([H.eval("__rec.start()"), G.eval("__rec.start()")]);
    const duckTl = [];
    for (let t = 0; t < SECS * 4; t++) { await sleep(250); if (A.movie === "1") { try { duckTl.push(await H.eval(`(() => { const v = document.getElementById("vid"); const d = window.__wtVoiceDbg && window.__wtVoiceDbg(); return { vol: +v.volume.toFixed(3), sp: !!(d && d.boost && d.boost.speaking) }; })()`)); } catch (_) {} } }
    out.duckTimeline = duckTl;
    const [hr, gr] = await Promise.all([H.eval("__rec.stop()"), G.eval("__rec.stop()")]);
    if (A.extra === "1") {
      const lvl = async (ms) => { await H.eval("__rec.start()"); await sleep(ms); const z = await H.eval("__rec.stop()"); const x = resample(fromB64(z.heard), z.sr, SR); return x.length ? +W.activeLevel(x, SR).dbfs.toFixed(1) : null; };
      const gmic = async () => { const s = await G.eval("__stats()"); return s.mic && s.mic.settings ? { ec: s.mic.settings.echoCancellation, ns: s.mic.settings.noiseSuppression, agc: s.mic.settings.autoGainControl, live: s.mic.readyState, gums: s.mic.count, path: s.dbg && s.dbg.path, line: s.dbg && s.dbg.line } : null; };
      const vid = async () => H.eval("+document.getElementById('vid').volume.toFixed(3)");
      const ex = out.extra = {};
      ex.start = { mic: await gmic(), hears: await lvl(4000) };
      await G.eval("document.querySelector('#wt-nc-btn').click(), true", true); await sleep(3500);
      ex.ncOff = { mic: await gmic(), hears: await lvl(4000), msgs: (await G.eval("[...document.querySelectorAll('#wt-msgs > *')].slice(-2).map(e => e.textContent)")) };
      await G.eval("document.querySelector('#wt-nc-btn').click(), true", true); await sleep(3500);
      ex.ncOn = { mic: await gmic(), hears: await lvl(4000) };
      await G.eval("document.querySelector('#wt-mic').click(), true", true); await sleep(3000);
      ex.micOff = { hears: await lvl(3000), hostVideoVol: A.movie === "1" ? await vid() : null, mic: await gmic() };
      await G.eval("document.querySelector('#wt-mic').click(), true", true); await sleep(4000);
      ex.micOn = { hears: await lvl(4000), mic: await gmic() };
      if (A.long) { await sleep(Number(A.long) * 1000); ex.afterLong = { hears: await lvl(4000), stats: (await H.eval("__stats()")).lines.map(l => l.in) }; }
      ex.hostLog = (await H.eval("__log")).slice(-5); ex.guestLog = (await G.eval("__log")).slice(-5);
    }
    out.hostStats = await H.eval("__stats()");
    out.guestStats = await G.eval("__stats()");
    out.hostLog = (await H.eval("__log")).slice(-8);
    out.guestLog = (await G.eval("__log")).slice(-8);
    const hh = resample(fromB64(hr.heard), hr.sr, SR), hraw = resample(fromB64(hr.raw), hr.rawSr || SR, SR);
    const gh = resample(fromB64(gr.heard), gr.sr, SR), graw = resample(fromB64(gr.raw), gr.rawSr || SR, SR);
    out.sourceGuest = (() => { const l = W.activeLevel(W.readWav(GUEST_WAV).x, SR); return +l.dbfs.toFixed(1); })();
    out.youHear = hh.length ? score(hh, GUEST_WAV, "host hears guest (after boost)") : "no heard audio";
    out.youHearRaw = hraw.length ? score(hraw, GUEST_WAV, "host raw incoming") : "no raw audio";
    out.friendHears = gh.length ? score(gh, HOST_WAV, "guest hears host (after boost)") : "no heard audio";
    out.friendHearsRaw = graw.length ? score(graw, HOST_WAV, "guest raw incoming") : "no raw audio";
    W.writeWav(path.join(__dirname, `out-${BUILD}-${LABEL}-hostHears.wav`), hh, SR);
    W.writeWav(path.join(__dirname, `out-${BUILD}-${LABEL}-guestHears.wav`), gh, SR);
    H.close(); G.close();
  } catch (e) {
    out.error = String(e && e.stack || e);
  } finally {
    ch.forEach(c => { try { c.kill(); } catch (_) {} });
    server.close();
  }
  fs.writeFileSync(path.join(__dirname, `res-${BUILD}-${LABEL}.json`), JSON.stringify(out, null, 1));
  const pick = (s) => s && s.lines && s.lines[0] ? { codec: s.lines[0].codec && s.lines[0].codec.fmtp, in: s.lines[0].in, rtt: s.lines[0].rtt, outBytes: s.lines[0].out && s.lines[0].out.bytes } : null;
  console.log(JSON.stringify({
    build: out.build, label: out.label, connected: out.connected, error: out.error, sourceGuest: out.sourceGuest,
    youHear: out.youHear, youHearRaw: out.youHearRaw, friendHears: out.friendHears,
    hostMic: out.hostStats && out.hostStats.mic && out.hostStats.mic.settings, guestMic: out.guestStats && out.guestStats.mic && out.guestStats.mic.settings,
    hostBoost: out.hostStats && out.hostStats.dbg && out.hostStats.dbg.boost, hostPath: out.hostStats && out.hostStats.dbg && out.hostStats.dbg.path,
    extra: out.extra, gbuild: out.gbuild,
    hostLine: pick(out.hostStats), duck: out.duckTimeline && out.duckTimeline.length ? { min: Math.min(...out.duckTimeline.map(d => d.vol)), max: Math.max(...out.duckTimeline.map(d => d.vol)), duckedPct: Math.round(100 * out.duckTimeline.filter(d => d.vol < 0.75).length / out.duckTimeline.length), speakingPct: Math.round(100 * out.duckTimeline.filter(d => d.sp).length / out.duckTimeline.length), last: out.duckTimeline.slice(-1)[0] } : null, hostEl: out.hostStats && out.hostStats.el, logs: [].concat(out.hostLog || [], out.guestLog || []).slice(-6),
  }, null, 1));
  process.exit(0);
})();
