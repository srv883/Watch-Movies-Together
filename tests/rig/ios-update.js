// Phones update themselves: the installed script downloads a newer version
// (ios/latest.json + ios/wt-phone.js, SHA-256 checked) and runs it from the
// next page load; broken or tampered code never runs. One emulated iPhone
// (Chrome), the "GitHub" side served locally.
//   node ios-update.js
const fs = require("fs"), path = require("path"), http = require("http"), cp = require("child_process"), crypto = require("crypto");
const VERS = "C:/Users/Sourav/ML Coding/watch-together-versions";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";
const rigify = (s) => s
  .replace('if (!SITE_HOSTS.some(d => host === d || host.endsWith("." + d))) return;', "void SITE_HOSTS; // rig: guard bypassed")
  .replace('const SITE_HOSTS = [', 'const SITE_HOSTS = ["127.0.0.1", ')
  .replace('const NAV_FAMILIES = { hotstar: [', 'const NAV_FAMILIES = { hotstar: ["127.0.0.1", ')
  .replace('const SITES = [', 'const SITES = [\n  { name: "JioHotstar", url: "/", hosts: ["127.0.0.1"] },');
const userscript = rigify(fs.readFileSync(path.join(VERS, "ios/watch-together.user.js"), "utf8"));
const body = rigify(fs.readFileSync(path.join(VERS, "ios/wt-phone.js"), "utf8"));
const BUILT = /const BUILT_IN = "([\d.]+)";/.exec(userscript)[1];
const sha = (t) => crypto.createHash("sha256").update(t, "utf8").digest("hex");
const remoteBody = (v) => body.replace(/const WT_IOS_VERSION = "[\d.]+";/, `const WT_IOS_VERSION = "${v}";`) + `\nwindow.__wtRemoteMark = ${JSON.stringify(v)};\n`;
let remote = { meta: null, code: "" }; const hits = { latest: 0, code: 0 };
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Avengers: Infinity War - Disney+ Hotstar</title>
<script>
window.__log = []; for (const k of ["error"]) { const o = console[k].bind(console); console[k] = (...a) => { window.__log.push(a.map(String).join(" ")); o(...a); }; }
window.addEventListener("error", e => window.__log.push("uncaught: " + e.message));
window.__wtPhoneBase = "/ios-remote/";
const P = "gm:";
window.GM = {
  getValue: async (k, d) => { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); },
  setValue: async (k, v) => { localStorage.setItem(P + k, JSON.stringify(v)); },
  deleteValue: async (k) => { localStorage.removeItem(P + k); },
  listValues: async () => Object.keys(localStorage).filter(k => k.indexOf(P) === 0).map(k => k.slice(P.length)),
  xmlHttpRequest: (d) => { fetch(d.url).then(async r => d.onload({ status: r.status, responseText: await r.text(), responseHeaders: "" })).catch(() => d.onerror && d.onerror({})); },
  openInTab: (u) => { window.__opened = (window.__opened || []).concat([u]); },
};
</script></head><body><header>JioHotstar</header><div id="player"><video id="vid" playsinline></video></div>
<script src="/ios/watch-together.user.js"></script></body></html>`;
const server = http.createServer((q, r) => {
  const u = q.url.split("?")[0];
  const send = (t, b, code) => { r.writeHead(code || 200, { "Content-Type": t, "Cache-Control": "no-store" }); r.end(b); };
  if (u.endsWith("/watch")) return send("text/html", page);
  if (u === "/ios/watch-together.user.js") return send("text/javascript", userscript);
  if (u === "/ios-remote/latest.json") { hits.latest++; return remote.meta ? send("application/json", JSON.stringify(remote.meta)) : send("text/plain", "", 404); }
  if (u === "/ios-remote/wt-phone.js") { hits.code++; return send("text/plain", remote.code); }
  r.writeHead(404); r.end();
});
function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url); let id = 0; const pend = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    ws.onopen = () => res({
      send: (method, params = {}) => new Promise((r2, j2) => { const i = ++id; pend.set(i, { res: r2, rej: j2 }); ws.send(JSON.stringify({ id: i, method, params })); }),
      eval: async function (expr) { const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text)); return r.result.value; },
    });
    ws.onerror = rej;
  });
}
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const URL = `http://127.0.0.1:${port}/in/movies/avengers-infinity-war/1660010677/watch`;
  const results = [];
  const rec = (id, name, pass, d) => { results.push({ id, pass: !!pass }); console.log((pass ? "PASS " : "FAIL ") + id + " " + name + "  " + JSON.stringify(d === undefined ? "" : d).slice(0, 400)); };
  const prof = path.join(process.cwd(), "prof-upd-" + Date.now());
  const ch = cp.spawn(CHROME, ["--headless=new", "--remote-debugging-port=9431", `--user-data-dir=${prof}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank"], { stdio: "ignore" });
  try {
    let P = null;
    for (let i = 0; i < 80 && !P; i++) { try { const l = await (await fetch("http://127.0.0.1:9431/json/list")).json(); const pg = l.find((t) => t.type === "page"); if (pg) P = await connect(pg.webSocketDebuggerUrl); } catch (_) {} if (!P) await sleep(250); }
    await P.send("Page.enable"); await P.send("Runtime.enable");
    await P.send("Network.enable"); await P.send("Network.setUserAgentOverride", { userAgent: IPHONE_UA });
    await P.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const load = async () => { await P.send("Page.navigate", { url: URL }); for (let i = 0; i < 60; i++) { await sleep(250); try { if (await P.eval("!!window.__wtPhoneRan")) break; } catch (_) {} } await sleep(800); };
    const stored = () => P.eval(`(() => { const v = localStorage.getItem("gm:wt_phone_code"); if (!v) return null; const o = JSON.parse(JSON.parse(v)); return { v: o.v, len: o.code.length }; })()`);
    const ui = () => P.eval(`(() => { const h = document.getElementById("wt-ios-host"); const sr = h && h.shadowRoot; return { bar: !!(sr && sr.getElementById("wtBar")), ver: sr ? sr.getElementById("verLine").textContent : null, ran: window.__wtPhoneRan, mark: window.__wtRemoteMark || null, errs: window.__log }; })()`);

    // U1: a newer version on "GitHub" -> downloaded on this visit, running from the next one
    remote = { meta: { version: "9.9.9", sha256: sha(remoteBody("9.9.9")) }, code: remoteBody("9.9.9") };
    await load();
    const a = await ui();
    let st = null; for (let i = 0; i < 20 && !(st = await stored()); i++) await sleep(250);
    rec("U1a", "first visit runs the built-in version and downloads the newer one", a.ran === BUILT && a.bar && st && st.v === "9.9.9", { ran: a.ran, stored: st });
    await load();
    const b = await ui();
    rec("U1b", "next visit runs the downloaded version (no reinstall), bar works, no errors", b.ran === "9.9.9" && b.mark === "9.9.9" && b.bar && b.ver === "v9.9.9" && !b.errs.length, b);
    // U2: at most one check every 10 minutes
    const before = { ...hits };
    await load();
    rec("U2", "update check at most every 10 minutes (no extra requests on a quick reload)", hits.latest === before.latest && hits.code === before.code, { before, after: hits });
    // U3: tampered download (hash mismatch) is never kept or run
    await P.eval(`(localStorage.removeItem("gm:wt_phone_code"), localStorage.removeItem("gm:wt_phone_checked"), true)`);
    remote = { meta: { version: "9.9.10", sha256: sha(remoteBody("9.9.10")) }, code: remoteBody("9.9.10") + "\nwindow.__evil = 1;\n" };
    await load();
    const c = await ui(); const st3 = await stored();
    rec("U3", "a download that doesn't match its SHA-256 is thrown away", c.ran === BUILT && !st3 && !(await P.eval("!!window.__evil")), { ran: c.ran, stored: st3 });
    // U4: kept code that fails to start -> the built-in version runs
    await P.eval(`(localStorage.setItem("gm:wt_phone_code", JSON.stringify(JSON.stringify({ v: "9.9.11", code: "this is not javascript (", at: Date.now() }))), true)`);
    await load();
    const d = await ui();
    rec("U4", "a broken downloaded version never leaves you without Watch Together (built-in runs)", d.ran === BUILT && d.bar, { ran: d.ran, bar: d.bar });
    // U5: the panel's "Update now" downloads and reloads by itself
    await P.eval(`(localStorage.removeItem("gm:wt_phone_code"), localStorage.setItem("gm:wt_phone_checked", JSON.stringify(String(Date.now()))), localStorage.setItem("gm:wt_ios_update", JSON.stringify(JSON.stringify({ version: "9.9.12", notes: "x", checkedAt: Date.now() }))), true)`);
    remote = { meta: { version: "9.9.12", sha256: sha(remoteBody("9.9.12")) }, code: remoteBody("9.9.12") };
    await load();
    const btn = await P.eval(`(() => { const sr = document.getElementById("wt-ios-host").shadowRoot; sr.getElementById("wtBParty").click(); const b = sr.getElementById("updateBtn"); const t = b.textContent; b.click(); return t; })()`);
    for (let i = 0; i < 40; i++) { await sleep(250); try { if ((await P.eval("window.__wtPhoneRan")) === "9.9.12") break; } catch (_) {} }
    await sleep(800);
    const e = await ui();
    rec("U5", "panel 'Switch now' -> downloads, reloads, runs the new version", btn === "Switch now" && e.ran === "9.9.12" && e.bar, { button: btn, ran: e.ran });
  } catch (err) {
    rec("X", "harness", false, String((err && err.stack) || err).slice(0, 400));
  } finally {
    try { ch.kill(); } catch (_) {}
    console.log(results.filter((r) => r.pass).length + "/" + results.length + " passed");
    setTimeout(() => process.exit(0), 300);
  }
})();
