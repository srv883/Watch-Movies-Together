// Load the REAL extension (manifest, background service worker, popup) into a
// headless Chrome and talk to its background worker.
//   node ext-real.js --build V35-store
// Branded Chrome ignores --load-extension, but CDP's Extensions.loadUnpacked
// works over --remote-debugging-pipe with --enable-unsafe-extension-debugging.
const cp = require("child_process"), path = require("path"), fs = require("fs");
const A = {}; for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const BUILD = A.build || "V35-store";
const DIR = "C:/Users/Sourav/ML Coding/watch-together-versions/" + BUILD;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const prof = path.join(__dirname, "prof-ext-" + Date.now());
const ch = cp.spawn(CHROME, ["--headless=new", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", `--user-data-dir=${prof}`,
  "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const out = ch.stdio[3], inp = ch.stdio[4];
let id = 0; const pend = new Map(); let buf = "";
inp.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\0")) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (msg.id && pend.has(msg.id)) { const p = pend.get(msg.id); pend.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); }
  }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); out.write(JSON.stringify({ id: i, method, params, sessionId }) + "\0"); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const rec = (name, pass, detail) => { results.push({ name, pass }); console.log((pass ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(detail).slice(0, 700)); };

(async () => {
  try {
    const { id: extId } = await send("Extensions.loadUnpacked", { path: DIR });
    rec("extension loads (manifest accepted)", !!extId, { extId });
    // background service worker target
    let sw = null;
    for (let i = 0; i < 40 && !sw; i++) {
      const { targetInfos } = await send("Target.getTargets");
      sw = targetInfos.find(t => t.type === "service_worker" && t.url.indexOf(extId) !== -1);
      if (!sw) await sleep(250);
    }
    rec("background service worker starts", !!sw, { url: sw && sw.url });
    // an extension page to talk to the worker from (like a content script would)
    const { targetId } = await send("Target.createTarget", { url: `chrome-extension://${extId}/popup.html` });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Runtime.enable", {}, sessionId);
    await sleep(1500);
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r.result.value;
    };
    const ask = (msg) => ev(`new Promise((res) => { chrome.runtime.sendMessage(${JSON.stringify(msg)}, (r) => res(r === undefined ? { undefinedReply: true, lastError: chrome.runtime.lastError && chrome.runtime.lastError.message } : r)); setTimeout(() => res({ timeout: true }), 45000); })`);
    // what the content script sends on Hotstar's Infinity War page
    const r1 = await ask({ t: "wt-trivia", key: "hotstar:1660010677", duration: 8940,
      hints: ["Avengers: Infinity War - Disney+ Hotstar", "Avengers: Infinity War", "in movies avengers infinity war watch"],
      title: "Avengers: Infinity War", pageTitle: "Avengers: Infinity War - Disney+ Hotstar", slug: "Avengers Infinity War", site: "www.hotstar.com" });
    rec("Infinity War (Hotstar) -> line-anchored trivia from the pack", r1 && r1.source === "pack" && r1.items && r1.items.length >= 10 && r1.items.every(i => i.cue && i.cue.length), { source: r1 && r1.source, title: r1 && r1.title, n: r1 && r1.items && r1.items.length, err: r1 && (r1.error || r1.lastError || r1.timeout) });
    const r2 = await ask({ t: "wt-trivia", key: "hotstar:1260023466", duration: 1300, hints: ["The Office · Night Out", "in shows the office night out watch"], slug: "The Office · Night Out" });
    rec("The Office - Night Out -> pack", r2 && r2.source === "pack", { source: r2 && r2.source, title: r2 && r2.title, err: r2 && r2.error });
    const r3 = await ask({ t: "wt-trivia", key: "netflix:80057281", duration: 2900, hints: ["Stranger Things"], slug: "Stranger Things · Chapter One The Vanishing Of Will Byers" });
    rec("Stranger Things (no pack, no key) -> nothing (Wikipedia no longer used)", r3 && r3.error === "unknown", { source: r3 && r3.source, title: r3 && r3.title, first: r3 && r3.items && r3.items[0] && r3.items[0].fact, err: r3 && r3.error });
    const logs = await ev(`(async () => { const s = await chrome.storage.local.get(null); return Object.keys(s); })()`);
    rec("worker stored its caches", logs.indexOf("wt_pack_cache") !== -1, { keys: logs });
  } catch (e) {
    rec("harness", false, String(e && e.message || e));
  } finally {
    try { ch.kill(); } catch (_) {}
    console.log(results.filter(r => r.pass).length + "/" + results.length + " passed");
    setTimeout(() => process.exit(0), 300);
  }
})();
