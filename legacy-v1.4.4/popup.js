const CODE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";

const KNOWN_VIDEO_SITES =
  /netflix\.com\/watch|hotstar\.com|jiohotstar\.com|primevideo\.com|amazon\.(in|com)\/gp\/video|youtube\.com\/watch|youtu\.be\//i;

const $ = (id) => document.getElementById(id);
let activeTab = null;

function genCode(n = 6) {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
  ]);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function show(el, on) {
  el.classList.toggle("hidden", !on);
}

async function render() {
  activeTab = await getActiveTab();
  const ok = !!(activeTab && /^https?:/i.test(activeTab.url || ""));

  let pong = null;
  if (ok) {
    try {
      pong = await withTimeout(chrome.tabs.sendMessage(activeTab.id, { type: "WT_PING" }), 800);
    } catch (_) {}
  }
  const supported = ok && !!pong && pong.ok;

  $("siteName").textContent = ok
    ? new URL(activeTab.url).hostname.replace("www.", "")
    : "Unsupported page";

  const { wt_party: party } = await chrome.storage.local.get("wt_party");

  if (!supported) {
    const warn = "";
    $("pageWarn").textContent = warn;
    $("pageWarn").classList.add("hidden");
    if (party) {
      show($("notSupported"), true);
      show($("activeView"), true);
      fillActive(party);
    } else {
      show($("notSupported"), true);
    }
    show($("setupView"), false);
    return;
  }

  show($("notSupported"), false);

  const warn =
    !pong.hasVideo && !KNOWN_VIDEO_SITES.test(activeTab.url)
      ? "No video found on this page yet \u2013 open your show first."
      : "";
  $("pageWarn").textContent = warn;
  show($("pageWarn"), !!warn);

  show($("setupView"), true);
  if (party) {
    show($("activeView"), true);
    fillActive(party);
  } else {
    show($("activeView"), false);
  }
}

function fillActive(party) {
  $("codeDisplay").textContent = party.id;
  refreshStatus();
}

function setDot(state) {
  const dot = document.querySelector(".dot");
  dot.className = "dot";
  if (state === "connected") dot.classList.add("ok");
  else if (state === "connecting" || state === "waiting") dot.classList.add("warn");
  else if (state === "error") dot.classList.add("err");
}

async function refreshStatus() {
  const { wt_status: status } = await chrome.storage.local.get("wt_status");
  const text = $("statusText");
  setDot(status?.state);
  switch (status?.state) {
    case "connected": text.textContent = status.detail || "Connected - playback synced"; break;
    case "waiting": text.textContent = status.detail || "Waiting for your friend to join\u2026"; break;
    case "connecting": text.textContent = "Connecting\u2026"; break;
    case "error": text.textContent = status.detail || "Connection error"; break;
    default: text.textContent = "Idle";
  }
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.wt_status && !$("activeView").classList.contains("hidden")) refreshStatus();
  if (ch.wt_party) render();
});

$("createBtn").addEventListener("click", async () => {
  const name = $("nameInput").value.trim() || "Host";
  const id = genCode();
  const party = { id, role: "host", name, tabId: activeTab.id };
  await chrome.storage.local.set({
    wt_name: name,
    wt_party: party,
    wt_status: { state: "connecting" }
  });
  try { await chrome.tabs.sendMessage(activeTab.id, { type: "WT_START", party }); } catch (_) {}
});

$("joinBtn").addEventListener("click", async () => {
  const code = $("codeInput").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    alert("Code must be 6 characters (letters/numbers).");
    return;
  }
  const name = $("nameInput").value.trim() || "Guest";
  const party = { id: code, role: "guest", name, tabId: activeTab.id };
  await chrome.storage.local.set({
    wt_name: name,
    wt_party: party,
    wt_status: { state: "connecting" }
  });
  try { await chrome.tabs.sendMessage(activeTab.id, { type: "WT_START", party }); } catch (_) {}
});

$("copyBtn").addEventListener("click", async () => {
  const { wt_party: party } = await chrome.storage.local.get("wt_party");
  if (!party) return;
  await navigator.clipboard.writeText(party.id);
  $("copyBtn").textContent = "Copied!";
  setTimeout(() => ($("copyBtn").textContent = "Copy code"), 1200);
});

$("codeDisplay").addEventListener("click", () => $("copyBtn").click());

$("linkBtn").addEventListener("click", async () => {
  const { wt_party: party } = await chrome.storage.local.get("wt_party");
  if (!party || !activeTab || !activeTab.url) return;
  const base = activeTab.url.split("#")[0];
  await navigator.clipboard.writeText(base + "#wt=" + party.id);
  $("linkBtn").textContent = "Link copied!";
  setTimeout(() => ($("linkBtn").textContent = "Copy invite link"), 1400);
});

$("leaveBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({ wt_party: null, wt_status: null });
  render();
});

(async () => {
  const { wt_name: savedName } = await chrome.storage.local.get("wt_name");
  $("nameInput").value = savedName || "";
  await render();
})();
