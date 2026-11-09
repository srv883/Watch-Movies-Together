// runs the scenario matrix for one or more builds and prints a comparison table
//   node matrix.js V27-voiceboost V28-clearvoice
const cp = require("child_process"), path = require("path"), fs = require("fs");
const builds = process.argv.slice(2);
const scen = [
  { label: "normal", args: ["--guest", "guest_normal.wav"] },
  { label: "quiet", args: ["--guest", "guest_quiet.wav"] },
  { label: "vquiet", args: ["--guest", "guest_vquiet.wav"] },
  { label: "quiet_nc0", args: ["--guest", "guest_quiet.wav", "--nc", "0"] },
  { label: "vquiet_nc0", args: ["--guest", "guest_vquiet.wav", "--nc", "0"] },
  { label: "noise", args: ["--guest", "guest_noise.wav"] },
  { label: "movie", args: ["--guest", "guest_normal.wav", "--movie", "1"] },
];
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const rows = [];
for (const b of builds) {
  for (const s of scen) {
    if (only && !only.includes(s.label)) continue;
    let tries = 0, r = null;
    while (tries++ < 2) {
      cp.spawnSync(process.execPath, [path.join(__dirname, "run.js"), "--build", b, "--label", s.label, "--secs", "12", "--settle", "8", ...s.args], { stdio: "ignore", timeout: 150000 });
      try { r = JSON.parse(fs.readFileSync(path.join(__dirname, `res-${b}-${s.label}.json`), "utf8")); } catch (_) { r = null; }
      if (r && r.connected && !r.error) break;
    }
    const y = r && r.youHear, raw = r && r.youHearRaw, f = r && r.friendHears;
    const hs = r && r.hostStats, line = hs && hs.lines && hs.lines[0];
    const tl = r && r.duckTimeline || [];
    rows.push({
      build: b.replace(/-.*/, ""), scen: s.label, ok: !!(r && r.connected && !r.error),
      rawDb: raw && raw.speechDbfs, heardDb: y && y.speechDbfs, peak: y && y.peak, clip: y && y.clipSamples,
      envHeard: y && y.envCorr, envRaw: raw && raw.envCorr, bandHeard: y && y.bandCorr,
      friendHearsDb: f && f.speechDbfs, friendEnv: f && f.envCorr,
      auto: hs && hs.dbg && hs.dbg.boost && hs.dbg.boost.auto,
      ec: hs && hs.mic && hs.mic.settings && hs.mic.settings.echoCancellation,
      kbps: line && line.in && line.in.bytes ? Math.round(line.in.bytes * 8 / 1000 / ((line.in.pkts || 1) * 0.02)) : null,
      jbMs: line && line.in && line.in.jbMs, conceal: line && line.in && line.in.concealPct,
      duckMin: tl.length ? Math.min(...tl.map(d => d.vol)) : null,
      duckEnd: tl.length ? tl[tl.length - 1].vol : null,
      err: r && r.error ? String(r.error).slice(0, 80) : (r ? "" : "no result"),
    });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
}
fs.writeFileSync(path.join(__dirname, "matrix-" + builds.join("+") + ".json"), JSON.stringify(rows, null, 1));
console.table(rows.map(r => ({ b: r.build, scen: r.scen, rawDb: r.rawDb, heardDb: r.heardDb, peak: r.peak, envH: r.envHeard, envR: r.envRaw, fHearsDb: r.friendHearsDb, auto: r.auto, ec: r.ec, kbps: r.kbps, jb: r.jbMs, duckMin: r.duckMin, duckEnd: r.duckEnd, err: r.err })));
