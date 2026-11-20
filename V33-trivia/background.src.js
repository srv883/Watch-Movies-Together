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

export async function getTrivia(req) {
  const key = String(req.key || "").slice(0, 200);
  if (!key) return { error: "no-title" };
  const cache = await readCache();
  if (cache[key] && Array.isArray(cache[key].items)) return { items: cache[key].items, title: cache[key].title, cached: true };

  const { wt_anthropic_key: apiKey } = await chrome.storage.local.get("wt_anthropic_key");
  if (!apiKey) return { error: "no-key" };

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 120000 });
  const duration = Number(req.duration) || 0;
  const about = [
    "Page title: " + String(req.pageTitle || "").slice(0, 200),
    "Title from the page: " + String(req.title || "").slice(0, 200),
    "Words from the URL: " + String(req.slug || "").slice(0, 200),
    "Site: " + String(req.site || "").slice(0, 60),
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
  await writeCache(key, { items, title, confident: !!data.confident, at: Date.now() });
  return { items, title };
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

try {
  chrome.alarms.create("wt-self-update", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((a) => { if (a && a.name === "wt-self-update") checkSelfUpdate(); });
} catch (_) {}
checkSelfUpdate();

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
