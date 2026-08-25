const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const SUPPORTED = [
  /https?:\/\/(www\.)?netflix\.com\/watch\//i,
  /https?:\/\/([^/]*\.)?hotstar\.com\//i,
  /https?:\/\/([^/]*\.)?jiohotstar\.com\//i,
  /https?:\/\/([^/]*\.)?primevideo\.com\//i,
  /https?:\/\/([^/]*\.)?amazon\.(in|com)\/gp\/video\//i
];

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

function isSupported(url) {
  return !!url && SUPPORTED.some((re) => re.test(url));
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
  const ok = isSupported(activeTab?.url);

  $("siteName").textContent = ok ? new URL(activeTab.url).hostname.replace("www.", "") : "Unsupported site";

  const { wt_party: party } = await chrome.storage.local.get("wt_party");
  if (!ok && !party) return show("notSupported");
  if (party) {
    show("activeView");
    $("codeDisplay").textContent = party.id;
    refreshStatus();
  } else {
    show("setupView");
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

// ---- actions ----

$("createBtn").addEventListener("click", async () => {
  const name = $("nameInput").value.trim() || "Host";
  const id = genCode();
  await chrome.storage.local.set({ wt_name: name, wt_party: { id, role: "host", name }, wt_status: { state: "connecting" } });
});

$("joinBtn").addEventListener("click", async () => {
  const code = $("codeInput").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    $("statusText").textContent = "";
    alert("Code must be 6 characters (letters/numbers).");
    return;
  }
  const name = $("nameInput").value.trim() || "Guest";
  await chrome.storage.local.set({ wt_name: name, wt_party: { id: code, role: "guest", name }, wt_status: { state: "connecting" } });
});

$("copyBtn").addEventListener("click", async () => {
  const { wt_party: party } = await chrome.storage.local.get("wt_party");
  if (!party) return;
  await navigator.clipboard.writeText(party.id);
  $("copyBtn").textContent = "Copied!";
  setTimeout(() => ($("copyBtn").textContent = "Copy code"), 1200);
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
