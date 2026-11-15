const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const $ = (id) => document.getElementById(id);
let activeTab = null;

function genCode(n = 6) {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// v25: one entry per brand. The union of `hosts` must equal the manifest
// matches and the SITE_HOSTS guard at the top of content.js (tests enforce it).
const SITES = [
  { name: "Netflix", url: "https://www.netflix.com/", hosts: ["netflix.com"] },
  { name: "JioHotstar", url: "https://www.hotstar.com/", hosts: ["hotstar.com", "jiohotstar.com"] },
  { name: "Prime Video", url: "https://www.primevideo.com/", hosts: ["primevideo.com"] },
  { name: "JioTV", url: "https://www.jiotv.com/", hosts: ["jiotv.com"] },
  { name: "JioCinema", url: "https://www.jiocinema.com/", hosts: ["jiocinema.com"] },
];
const SITE_HOSTS = SITES.flatMap(s => s.hosts);

function siteFor(url) {
  if (!url || !/^https?:/i.test(url)) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return SITES.find(s => s.hosts.some(d => host === d || host.endsWith("." + d))) || null;
  } catch (_) { return null; }
}

function isSupported(url) {
  return !!siteFor(url);
}

function buildSiteList() {
  const list = $("siteList");
  if (list.childElementCount) return;
  for (const s of SITES) {
    const b = document.createElement("button");
    b.className = "site-btn";
    b.textContent = s.name;
    b.addEventListener("click", () => {
      chrome.tabs.create({ url: s.url });
      window.close();
    });
    list.appendChild(b);
  }
}

function show(view) {
  for (const v of ["notSupported", "setupView", "activeView"]) {
    $(v).classList.add("hidden");
  }
  $(view).classList.remove("hidden");
}

function setDot(state) {
  const dot = document.querySelector(".dot");
  dot.className = "dot";
  if (state === "connected") dot.classList.add("ok");
  else if (state === "connecting" || state === "waiting") dot.classList.add("warn");
  else if (state === "error") dot.classList.add("err");
}

async function render() {
  activeTab = await getActiveTab();
  const site = siteFor(activeTab?.url);

  $("siteName").textContent = site ? site.name : "Unsupported site";

  const { wt_party: party } = await chrome.storage.local.get("wt_party");
  if (!site && !party) {
    buildSiteList();
    return show("notSupported");
  }
  if (party) {
    show("activeView");
    // The party lives in the streaming tab; this tab has no content script.
    $("offSiteHint").classList.toggle("hidden", !!site);
    $("codeDisplay").textContent = party.id;
    refreshStatus();
  } else {
    show("setupView");
    const { wt_recent: rec } = await chrome.storage.local.get("wt_recent");
    if (rec && rec.id) {
      $("resumeLine").classList.remove("hidden");
      $("resumeCode").textContent = rec.id;
    } else {
      $("resumeLine").classList.add("hidden");
    }
  }
}

async function refreshStatus() {
  const { wt_status: status } = await chrome.storage.local.get("wt_status");
  const text = $("statusText");
  setDot(status?.state);
  switch (status?.state) {
    case "connected": text.textContent = status.detail || "Connected - playback synced"; break;
    case "waiting": text.textContent = status.detail || "Waiting for your friend to join…"; break;
    case "connecting": text.textContent = "Connecting…"; break;
    case "error": text.textContent = status.detail || "Connection error"; break;
    default: text.textContent = "Idle"; 
  }
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.wt_status) refreshStatus();
  if (ch.wt_party) render();
});

function saveRecent(party) {
  if (!party) return;
  chrome.storage.local.set({ wt_recent: { id: party.id, role: party.role, name: party.name } });
}

// ---- actions ----

$("createBtn").addEventListener("click", async () => {
  const name = $("nameInput").value.trim() || "Host";
  const id = genCode();
  const party = { id, role: "host", name };
  saveRecent(party);
  await chrome.storage.local.set({ wt_name: name, wt_party: party, wt_status: { state: "connecting" } });
});

$("joinBtn").addEventListener("click", async () => {
  const code = $("codeInput").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    $("statusText").textContent = "";
    alert("Code must be 6 characters (letters/numbers).");
    return;
  }
  const name = $("nameInput").value.trim() || "Guest";
  const party = { id: code, role: "guest", name };
  saveRecent(party);
  await chrome.storage.local.set({ wt_name: name, wt_party: party, wt_status: { state: "connecting" } });
});

$("resumeBtn").addEventListener("click", async () => {
  const { wt_recent: rec, wt_name: saved } = await chrome.storage.local.get(["wt_recent", "wt_name"]);
  if (!rec || !rec.id) return;
  const name = saved || rec.name || "Guest";
  saveRecent({ ...rec, name });
  await chrome.storage.local.set({ wt_name: name, wt_party: { id: rec.id, role: rec.role || "guest", name }, wt_status: { state: "connecting" } });
});

$("copyBtn").addEventListener("click", async () => {
  const { wt_party: party } = await chrome.storage.local.get("wt_party");
  if (!party) return;
  await navigator.clipboard.writeText(party.id);
  $("copyBtn").textContent = "Copied!";
  setTimeout(() => ($("copyBtn").textContent = "Copy code"), 1200);
});

$("inviteBtn").addEventListener("click", async () => {
  const { wt_party: party } = await chrome.storage.local.get("wt_party");
  if (!party) return;
  const site = siteFor(activeTab?.url);
  const text = site
    ? `Let's watch ${site.name} together! Open this:\n${activeTab.url}\n\nThen click the Watch Together icon and enter party code: ${party.id}`
    : `Watch Together party code: ${party.id}`;
  await navigator.clipboard.writeText(text);
  $("inviteBtn").textContent = "Invite copied!";
  setTimeout(() => ($("inviteBtn").textContent = "Copy invite"), 1600);
});

$("codeDisplay").addEventListener("click", () => $("copyBtn").click());

$("leaveBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({ wt_party: null, wt_status: null });
  render();
});

(async () => {
  const { wt_name: savedName } = await chrome.storage.local.get("wt_name");
  $("nameInput").value = savedName || "";
  await render();
})();

(function () { const vl = document.getElementById("verLine"); if (vl) vl.textContent = "v" + chrome.runtime.getManifest().version; })();

// ---- v31: tell the user when a newer version is out ----
// latest.json lives next to the zips in the project's GitHub repo; checked at
// most every 6 hours (cached in storage). Nothing about the user is sent.
const LATEST_URL = "https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/latest.json";
const DEFAULT_ZIP = "https://github.com/srv883/Watch-Movies-Together/raw/main/wt-latest.zip";
const UPDATE_EVERY_MS = 6 * 3600 * 1000;

function newerThan(a, b) {
  const x = String(a || "").split(".").map(n => parseInt(n, 10) || 0);
  const y = String(b || "").split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

// only ever send the user to this project's own downloads
function safeZip(u) {
  const s = String(u || "");
  return /^https:\/\/(github\.com|raw\.githubusercontent\.com)\/srv883\/Watch-Movies-Together\/[\w./-]+\.zip$/.test(s) ? s : DEFAULT_ZIP;
}

function showUpdate(u) {
  $("updateText").textContent = "🆕 Version " + u.version + " is out (you have " + chrome.runtime.getManifest().version + ")";
  $("updateNotes").textContent = u.notes || "";
  $("updateBar").classList.remove("hidden");
}

async function checkUpdate() {
  const mine = chrome.runtime.getManifest().version;
  let { wt_update: u } = await chrome.storage.local.get("wt_update");
  if (!u || !(Date.now() - (u.checkedAt || 0) < UPDATE_EVERY_MS)) {
    try {
      if (typeof fetch !== "function") throw new Error("no fetch");
      const r = await fetch(LATEST_URL + "?t=" + Date.now(), { cache: "no-store" });
      const j = await r.json();
      if (j && typeof j.version === "string" && /^\d+\.\d+\.\d+$/.test(j.version)) {
        u = { version: j.version, zip: safeZip(j.zip), notes: String(j.notes || "").slice(0, 200), checkedAt: Date.now() };
        await chrome.storage.local.set({ wt_update: u });
      }
    } catch (_) { /* offline / blocked: try again next time */ }
  }
  if (u && newerThan(u.version, mine)) showUpdate(u);
  return u || null;
}

$("updateBtn").addEventListener("click", async () => {
  const { wt_update: u } = await chrome.storage.local.get("wt_update");
  chrome.tabs.create({ url: safeZip(u && u.zip) });
  $("updateHelp").classList.remove("hidden");
  $("extPageBtn").classList.remove("hidden");
});
$("updateHelpBtn").addEventListener("click", () => {
  $("updateHelp").classList.toggle("hidden");
  $("extPageBtn").classList.toggle("hidden", $("updateHelp").classList.contains("hidden"));
});
$("extPageBtn").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/" }));

checkUpdate();
