// Watch Together - background service worker (v33): AI scene trivia.
// The content script asks for trivia once per episode/film; we call Claude
// with the user's own API key (stored in chrome.storage.local by the popup)
// and cache the answer per title so it is never paid for twice.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";
const CACHE_KEY = "wt_trivia_cache";
const CACHE_MAX = 40;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["identified_title", "confident", "items"],
  properties: {
    identified_title: { type: "string" },
    confident: { type: "boolean" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["at_seconds", "scene", "fact"],
        properties: {
          at_seconds: { type: "integer" },
          scene: { type: "string" },
          fact: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM = `You write pop-up trivia for people watching a film or TV episode on a streaming site, like a "behind the scenes" track.
You get what the page tells us about the title (page title, URL words, runtime). Work out which film or episode it is.
Then write 12 to 20 short trivia items spread over the whole runtime, each tied to the moment in the episode where it fits:
- at_seconds: when the item should appear, in seconds from the start of the video (0 to the runtime). Place it at the scene it is about, as best you know it; spread items out, never two within 60 seconds.
- scene: a few words that let the viewer recognise the scene ("Michael's dinner party", "Stark builds the Mark I in the cave").
- fact: one or two sentences, under 220 characters: production facts, cast, real-world references, easter eggs, callbacks, deleted lines, comic or franchise connections. Only facts you are sure of - no invented quotes, numbers or anecdotes. No spoilers for anything after the current moment.
If you cannot tell which title this is, set confident to false and give general facts about the show or film you can identify, spread evenly. If you cannot identify anything, return an empty items list.`;

async function readCache() {
  const r = await chrome.storage.local.get(CACHE_KEY);
  return r[CACHE_KEY] && typeof r[CACHE_KEY] === "object" ? r[CACHE_KEY] : {};
}

async function writeCache(key, value) {
  const c = await readCache();
  c[key] = value;
  const keys = Object.keys(c).sort((a, b) => (c[b].at || 0) - (c[a].at || 0));
  for (const k of keys.slice(CACHE_MAX)) delete c[k];
  await chrome.storage.local.set({ [CACHE_KEY]: c });
}

function clean(items, duration) {
  const max = duration > 0 ? duration : 6 * 3600;
  return (Array.isArray(items) ? items : [])
    .filter((i) => i && typeof i.fact === "string" && i.fact.trim() && Number.isFinite(i.at_seconds))
    .map((i) => ({
      t: Math.max(5, Math.min(max - 10, Math.round(i.at_seconds))),
      scene: String(i.scene || "").slice(0, 80),
      fact: String(i.fact).trim().slice(0, 300),
    }))
    .sort((a, b) => a.t - b.t)
    .slice(0, 30);
}

// ---- v34: trivia packs (hosted in the project's GitHub repo, free) ----
const PACK_BASE = "https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/trivia/";
const PACK_TTL_MS = 6 * 3600 * 1000;
const packMem = {};

export function norm(s) {
  return " " + String(s || "").toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bpart\b/g, "pt")
    .replace(/\s+/g, " ").trim() + " ";
}

async function fetchJson(url, ttl) {
  const now = Date.now();
  const m = packMem[url];
  if (m && now - m.at < ttl) return m.data;
  const store = (await chrome.storage.local.get("wt_pack_cache")).wt_pack_cache || {};
  if (store[url] && now - store[url].at < ttl) { packMem[url] = store[url]; return store[url].data; }
  try {
    const r = await fetch(url + "?t=" + Math.floor(now / 600000), { cache: "no-store" });
    if (!r.ok) throw new Error("http " + r.status);
    const data = await r.json();
    packMem[url] = { at: now, data };
    store[url] = { at: now, data };
    await chrome.storage.local.set({ wt_pack_cache: store });
    return data;
  } catch (e) {
    if (store[url]) return store[url].data; // offline: stale is better than nothing
    throw e;
  }
}

// longest name of `list` that appears as whole words in `text`
function bestName(text, names) {
  let best = "";
  for (const n of names || []) {
    const k = norm(n);
    if (k.trim().length >= 3 && text.indexOf(k) !== -1 && k.length > best.length) best = k;
  }
  return best;
}

export function matchPack(index, packs, hints) {
  const text = norm((hints || []).join(" | "));
  // shows first (their names), then film collections (entry names)
  let found = null;
  for (const p of (index && index.packs) || []) {
    if (p.kind !== "show") continue;
    const sn = bestName(text, p.names);
    if (!sn) continue;
    const pack = packs[p.id];
    if (!pack) return { needs: p };
    // episode names are matched in what is left after removing the show's name
    const rest = text.split(sn).join(" ");
    let best = null, bestLen = 0;
    for (const e of pack.entries || []) {
      const en = bestName(" " + rest + " ", e.names);
      if (en && en.length > bestLen) { best = e; bestLen = en.length; }
    }
    if (best) return { entry: best, pack };
    found = found || { pack, noEpisode: true };
  }
  if (found) return found;
  for (const p of (index && index.packs) || []) {
    if (p.kind !== "films") continue;
    const pack = packs[p.id];
    if (!pack) return { needs: p };
    let best = null, bestLen = 0;
    for (const e of pack.entries || []) {
      const en = bestName(text, e.names);
      if (en && en.length > bestLen) { best = e; bestLen = en.length; }
    }
    if (best) return { entry: best, pack };
  }
  return null;
}

async function fromPack(req, duration) {
  const index = await fetchJson(PACK_BASE + "index.json", PACK_TTL_MS);
  const packs = {};
  for (let i = 0; i < 6; i++) {
    const m = matchPack(index, packs, req.hints);
    if (!m) return null;
    if (m.needs) { packs[m.needs.id] = await fetchJson(PACK_BASE + m.needs.file, PACK_TTL_MS); continue; }
    if (!m.entry) return null;
    const d = duration > 0 ? duration : 2700;
    const items = (m.entry.items || [])
      .filter((i) => i && typeof i.fact === "string" && typeof i.p === "number")
      .map((i) => ({ t: Math.round(Math.max(0.02, Math.min(0.97, i.p)) * d), scene: String(i.scene || "").slice(0, 80), fact: String(i.fact).slice(0, 300) }))
      .sort((a, b) => a.t - b.t);
    return items.length ? { items, title: String(m.entry.title || "").slice(0, 120), source: "pack" } : null;
  }
  return null;
}

// ---- v34: Wikipedia (free, any title): production / casting / reception facts ----
const WIKI = "https://en.wikipedia.org/w/api.php";
// Wikimedia asks API clients to identify themselves (no personal details)
const WIKI_HEADERS = { "Api-User-Agent": "WatchTogetherExtension/1.34 (personal Chrome extension; trivia)" };
async function wikiJson(url) {
  const r = await fetch(url, { headers: WIKI_HEADERS });
  if (!r.ok) throw new Error("wikipedia " + r.status);
  return r.json();
}
const WIKI_SECTIONS = /^(production|development|writing|casting|filming|music|conception|cultural references|references to other works|visual effects|design|deleted scenes|easter eggs|reception|ratings|accolades|awards|trivia|analysis|themes)$/i;

export function wikiQuery(req) {
  const hints = req.hints || [];
  // "The Office · Night Out" style labels are the best search terms; else the cleanest hint
  const label = String(req.slug || "").replace(/·/g, " ").trim();
  const t = label || String(req.title || "").trim() || String(hints[0] || "").trim();
  return t.replace(/\s*[|\-–]\s*(netflix|disney\+?\s*hotstar|jiohotstar|hotstar|prime video|jiocinema|jiotv).*$/i, "").replace(/^watch\s+/i, "").slice(0, 120);
}

// sentence split that keeps "J. Robert Oppenheimer", "Mr. Smith", "U.S." together
export function splitSentences(text) {
  const out = [];
  let start = 0;
  const re = /[.!?]["”’)]?(?=\s+["“(]?[A-Z0-9])/g;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(start, m.index - 4), m.index + 1);
    if (/(\b[A-Z]\.|\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Vol|No|vs|Inc|Ltd|Co)\.)$/.test(before)) continue;
    out.push(text.slice(start, re.lastIndex));
    start = re.lastIndex;
  }
  if (start < text.length) out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

export function wikiFacts(extract, max) {
  const out = [];
  let section = "";
  for (const raw of String(extract || "").split("\n")) {
    const line = raw.trim();
    const h = /^==+\s*(.*?)\s*==+$/.exec(line);
    if (h) { section = h[1]; continue; }
    if (!section || !WIKI_SECTIONS.test(section) || line.length < 60) continue;
    for (const sent of splitSentences(line)) {
      const s = sent.trim();
      if (s.length < 50 || s.length > 260) continue;
      // dry ratings / box-office numbers
      if (/(rotten tomatoes|metacritic|nielsen|viewers|rating of|households?|18[-–\s]+(to\s+)?49|share among|box office|grossed|opening weekend)/i.test(s)) continue;
      // vague lines with no name, title or number in them after the first word
      if (!/\s(["“]?[A-Z][a-z]+|\d)/.test(s.slice(1))) continue;
      if (/^(others|these|this|they|such)\b/i.test(s)) continue;
      out.push({ scene: section, fact: s });
      if (out.length >= max * 3) break;
    }
  }
  // spread across sections: round-robin
  const by = {};
  for (const f of out) (by[f.scene] = by[f.scene] || []).push(f);
  const pick = [];
  const keys = Object.keys(by);
  for (let i = 0; pick.length < max && keys.some((k) => by[k][i]); i++) {
    for (const k of keys) if (by[k][i] && pick.length < max) pick.push(by[k][i]);
  }
  return pick;
}

async function fromWikipedia(req, duration) {
  const q = wikiQuery(req);
  if (!q || q.length < 3) return null;
  const s = await wikiJson(WIKI + "?action=query&list=search&format=json&srlimit=3&srsearch=" + encodeURIComponent(q));
  const hits = ((s.query && s.query.search) || []).filter((h) => !/disambiguation/i.test(h.title) && !/\(disambiguation\)/i.test(h.title));
  for (const hit of hits.slice(0, 2)) {
    const e = await wikiJson(WIKI + "?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&format=json&redirects=1&titles=" + encodeURIComponent(hit.title));
    const pages = (e.query && e.query.pages) || {};
    const page = pages[Object.keys(pages)[0]];
    const facts = wikiFacts(page && page.extract, 10);
    if (facts.length >= 3) {
      const d = duration > 0 ? duration : 2700;
      const items = facts.map((f, i) => ({ t: Math.round(d * (0.08 + (0.84 * i) / Math.max(1, facts.length - 1))), scene: f.scene, fact: f.fact.slice(0, 300) }));
      return { items, title: hit.title.slice(0, 120), source: "wikipedia" };
    }
  }
  return null;
}

export async function getTrivia(req) {
  const key = String(req.key || "").slice(0, 200);
  if (!key) return { error: "no-title" };
  const cache = await readCache();
  if (cache[key] && Array.isArray(cache[key].items) && cache[key].source !== "pack") {
    return { items: cache[key].items, title: cache[key].title, source: cache[key].source, cached: true };
  }
  const duration = Number(req.duration) || 0;
  // 1) a hand-written trivia pack for this title (free; refreshed from GitHub every 6 h)
  try {
    const p = await fromPack(req, duration);
    if (p) return p;
  } catch (_) { /* offline / no pack: next source */ }
  // 2) Claude, when the user has a key
  const { wt_anthropic_key: apiKey } = await chrome.storage.local.get("wt_anthropic_key");
  if (apiKey) {
    const r = await fromClaude(req, apiKey, key, duration);
    if (r && Array.isArray(r.items) && r.items.length) return r;
    if (r && r.error === "bad-key") {
      const w = await fromWikipediaCached(req, key, duration);
      return w || r;
    }
  }
  // 3) Wikipedia (free, any title)
  const w = await fromWikipediaCached(req, key, duration);
  return w || { error: "unknown" };
}

async function fromWikipediaCached(req, key, duration) {
  try {
    const w = await fromWikipedia(req, duration);
    if (!w) return null;
    await writeCache(key, { items: w.items, title: w.title, source: "wikipedia", at: Date.now() });
    return w;
  } catch (_) { return null; }
}

async function fromClaude(req, apiKey, key, duration) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 120000 });
  const about = [
    "Page title: " + String(req.pageTitle || "").slice(0, 200),
    "Title from the page: " + String(req.title || "").slice(0, 200),
    "Words from the URL: " + String(req.slug || "").slice(0, 200),
    "Site: " + String(req.site || "").slice(0, 60),
    "Other text on the page: " + (req.hints || []).join(" | ").slice(0, 400),
    "Runtime of the video: " + (duration > 0 ? Math.round(duration) + " seconds" : "unknown"),
  ].join("\n");

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: about }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: "bad-key" };
    if (e instanceof Anthropic.PermissionDeniedError) return { error: "bad-key" };
    if (e instanceof Anthropic.RateLimitError) return { error: "busy" };
    if (e instanceof Anthropic.APIConnectionError) return { error: "offline" };
    if (e instanceof Anthropic.APIError) return { error: "api", detail: String(e.message || "").slice(0, 200) };
    return { error: "failed", detail: String((e && e.message) || e).slice(0, 200) };
  }
  if (response.stop_reason === "refusal") return { error: "declined" };
  if (response.stop_reason === "max_tokens") return { error: "failed", detail: "answer too long" };
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let data;
  try { data = JSON.parse(text); } catch (_) { return { error: "failed", detail: "unreadable answer" }; }
  const items = clean(data.items, duration);
  const title = String(data.identified_title || "").slice(0, 120);
  if (!items.length) return { error: "unknown" };
  await writeCache(key, { items, title, confident: !!data.confident, source: "claude", at: Date.now() });
  return { items, title, source: "claude" };
}

// a cheap key check for the popup's Save button
export async function checkKey(apiKey) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 20000 });
  try {
    await client.models.retrieve(MODEL);
    return { ok: true };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, error: "bad-key" };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, error: "offline" };
    return { ok: false, error: "api", detail: String((e && e.message) || e).slice(0, 200) };
  }
}

// ---- self-update for the unpacked install ----
// Chrome only re-reads an unpacked extension's folder when it is reloaded.
// Once a minute we read our own manifest from disk; when a newer version has
// been copied into the folder, we reload ourselves - but never while a party
// is live in some tab (that would cut the call); then we wait until it ends.
const PARTY_FRESH_MS = 20000;

export async function checkSelfUpdate() {
  let disk = null;
  try {
    const r = await fetch(chrome.runtime.getURL("manifest.json") + "?t=" + Date.now(), { cache: "no-store" });
    disk = (await r.json()).version;
  } catch (_) { return "unreadable"; }
  const running = chrome.runtime.getManifest().version;
  if (!disk || disk === running) return "current";
  const { wt_party: party, wt_live: live } = await chrome.storage.local.get(["wt_party", "wt_live"]);
  const busy = !!party && !!live && Date.now() - (live.at || 0) < PARTY_FRESH_MS;
  if (busy) return "deferred";
  await chrome.storage.local.set({ wt_updated: { from: running, to: disk, at: Date.now() } });
  chrome.runtime.reload();
  return "reloading";
}

// v35: a Chrome Web Store install (its manifest carries an update_url) is
// updated by Chrome itself - no folder watching there
export function isStoreInstall() {
  try { return !!chrome.runtime.getManifest().update_url; } catch (_) { return false; }
}
if (!isStoreInstall()) {
  try {
    chrome.alarms.create("wt-self-update", { periodInMinutes: 1 });
    chrome.alarms.onAlarm.addListener((a) => { if (a && a.name === "wt-self-update") checkSelfUpdate(); });
  } catch (_) {}
  checkSelfUpdate();
}

const inflight = new Map();
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || typeof msg !== "object") return false;
  if (msg.t === "wt-trivia") {
    const k = String(msg.key || "");
    let p = inflight.get(k);
    if (!p) {
      p = getTrivia(msg).finally(() => inflight.delete(k));
      inflight.set(k, p);
    }
    p.then(reply, (e) => reply({ error: "failed", detail: String(e).slice(0, 200) }));
    return true; // async reply
  }
  if (msg.t === "wt-trivia-store") {
    // trivia a friend shared with us: keep it so a reload doesn't lose it
    const k = String(msg.key || "").slice(0, 200);
    const items = Array.isArray(msg.items) ? msg.items.slice(0, 30) : null;
    if (!k || !items) { reply({ ok: false }); return false; }
    readCache().then((c) => (c[k] ? null : writeCache(k, { items, title: String(msg.title || "").slice(0, 120), shared: true, at: Date.now() })))
      .then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  if (msg.t === "wt-check-key") {
    checkKey(String(msg.key || "")).then(reply);
    return true;
  }
  return false;
});
