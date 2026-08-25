/* V8 patch A: state, glass toggle buttons, animated panel, quick+ toggle, idle hooks */
const fs = require("fs");
const DST = "C:/Users/Sourav/Downloads/watch-together-v8/content.js";
let c = fs.readFileSync(DST, "utf8");
let n = 0;
function rep(re, to, label) {
  const before = c;
  c = c.replace(re, to);
  if (c === before) throw new Error("NO MATCH: " + label);
  n++;
}

/* A1 state */
rep(/quickHover: null,\s*directMode: false/,
`quickHover: null,
    directMode: false,
    glass: false,
    quickIdleTimer: null`, "state");

/* A2 glass button in chat header */
rep(/('<span class="wt-title">Watch Together<\/span>' \+)/,
`$1
      '<button id="wt-glass-btn" type="button" title="Liquid glass theme">\u2728</button>' +`, "glass-btn-head");

/* A3 ui refs + bindings */
rep(/(ui\.quickTitle = ui\.root\.querySelector\("#wt-now-label"\);)/,
`$1
    ui.glassBtn = ui.root.querySelector("#wt-glass-btn");
    ui.glassBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleGlass();
    });`, "uirefs");

/* A4 animated open/close for panel + pill micro-shrink */
rep(/ui\.pill\.addEventListener\("click", \(\) => ui\.root\.classList\.toggle\("wt-open"\)\);\s*ui\.root\.querySelector\("#wt-close"\)\.addEventListener\("click", \(e\) => \{\s*e\.stopPropagation\(\);\s*ui\.root\.classList\.remove\("wt-open"\);\s*\}\);/,
`ui.pill.addEventListener("click", () => {
      if (ui.root.classList.contains("wt-open")) closePanelAnimated();
      else { ui.root.classList.add("wt-open"); bumpQuickActivity(); }
    });
    ui.root.querySelector("#wt-close").addEventListener("click", (e) => {
      e.stopPropagation();
      closePanelAnimated();
    });`, "pill-close");

/* A5 showUi hooks */
rep(/function showUi\(on\) \{\s*ui\.root\.classList\.toggle\("wt-active", on\);\s*if \(on\) ui\.root\.classList\.add\("wt-open"\);\s*if \(ui\.quickPanel\) ui\.quickPanel\.classList\.toggle\("wt-show", on\);\s*if \(on\) buildQuickBar\(\);\s*\}/,
`function showUi(on) {
    ui.root.classList.toggle("wt-active", on);
    if (on) ui.root.classList.add("wt-open");
    if (ui.quickPanel) ui.quickPanel.classList.toggle("wt-show", on);
    if (on) { buildQuickBar(); applyGlass(); bumpQuickActivity(); }
  }

  function bumpQuickActivity() {
    if (!ui.quickPanel) return;
    ui.quickPanel.classList.remove("wt-idle");
    clearTimeout(S.quickIdleTimer);
    S.quickIdleTimer = setTimeout(() => {
      if (ui.quickPanel && !ui.quickPanel.matches(":hover")) ui.quickPanel.classList.add("wt-idle");
    }, 15000);
  }

  function closePanelAnimated() {
    if (!ui.root.classList.contains("wt-open")) return;
    ui.root.classList.add("wt-shut");
    setTimeout(() => {
      ui.root.classList.remove("wt-open", "wt-shut");
      try { ui.picker.classList.add("wt-hide"); } catch (_) {}
    }, 150);
  }`, "showui");

/* A6 quick-bar glass button (inside buildQuickBar tail) */
rep(/ui\.quickBar\.appendChild\(plus\);\s*\}/,
`ui.quickBar.appendChild(plus);
    const gl = document.createElement("button");
    gl.type = "button";
    gl.className = "wt-quick-glass";
    gl.textContent = "\u2728";
    gl.title = "Liquid glass theme";
    gl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleGlass();
    });
    ui.quickBar.appendChild(gl);
  }`, "quick-glass");

/* A7 quick + becomes a real toggle & auto-opens the panel */
rep(/plus\.addEventListener\("click", \(ev\) => \{\s*ev\.stopPropagation\(\);\s*openPicker\(\);\s*\}\);/,
`plus.addEventListener("click", (ev) => {
      ev.stopPropagation();
      bumpQuickActivity();
      if (!ui.picker.classList.contains("wt-hide")) { closePicker(); return; }
      if (!ui.root.classList.contains("wt-open")) ui.root.classList.add("wt-open");
      openPicker();
    });`, "plus-toggle");

/* A8 boot loads glass pref */
rep(/const \{ wt_party: party, wt_voice_vol: savedVol, wt_react_freq: savedFreq, wt_react_recent: savedRecent \} = await chrome\.storage\.local\.get\(\["wt_party", "wt_voice_vol", "wt_react_freq", "wt_react_recent"\]\);/,
`const { wt_party: party, wt_voice_vol: savedVol, wt_react_freq: savedFreq, wt_react_recent: savedRecent, wt_glass: savedGlass, wt_pos_root: posRoot, wt_pos_quick: posQuick } = await chrome.storage.local.get(["wt_party", "wt_voice_vol", "wt_react_freq", "wt_react_recent", "wt_glass", "wt_pos_root", "wt_pos_quick"]);`, "bootget");

rep(/(if \(Array\.isArray\(savedRecent\)\) S\.reactRecent = savedRecent\.slice\(0, 3\);)/,
`$1
    if (typeof savedGlass === "boolean") S.glass = savedGlass;
    applySavedPos(ui.root, posRoot);
    applySavedPos(ui.quickPanel, posQuick);`, "bootapply");

fs.writeFileSync(DST, c, "utf8");
console.log("patch A applied: " + n);