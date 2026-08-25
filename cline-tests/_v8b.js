/* V8 patch B: drag system rewrite (grouped root drag, persistence), toggleGlass, applySavedPos */
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

/* B1: rewire handles — chat header drags the WHOLE root (pill follows) */
rep(/makeDraggable\(ui\.root\.querySelector\("\.wt-drag-handle"\), ui\.panel\);\s*makeDraggable\(ui\.quickTitle, ui\.quickPanel\);\s*makeDraggable\(ui\.quickBar, ui\.quickPanel\);/,
`makeDraggable(ui.root.querySelector(".wt-drag-handle"), ui.root, "wt_pos_root");
    makeDraggable(ui.quickTitle, ui.quickPanel, "wt_pos_quick");
    makeDraggable(ui.quickBar, ui.quickPanel, "wt_pos_quick");`, "wiring");

/* B2: replace entire makeDraggable implementation */
const start = c.indexOf("function makeDraggable(");
if (start < 0) throw new Error("makeDraggable not found");

const impl = `function makeDraggable(dragHandle, target, posKey) {
    if (!dragHandle || !target) return;
    let dragging = false;
    let offsetX = 0, offsetY = 0;
    let tw = 300, th = 60;
    let lastX = null, lastY = null, moved = false;

    const isInteractive = (e) => {
      const t = e.target;
      if (!t) return false;
      const tag = t.tag || t.tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return true;
      const cls = t.classList;
      return !!(cls && cls.contains && (cls.contains("wt-input") ||
        cls.contains("wt-emoji-search") || cls.contains("wt-emoji") ||
        cls.contains("wt-react") || cls.contains("wt-quick-emoji")));
    };
    const vw = () => (typeof window !== "undefined" && window.innerWidth) || 1920;
    const vh = () => (typeof window !== "undefined" && window.innerHeight) || 1080;

    dragHandle.addEventListener("mousedown", (e) => {
      if (isInteractive(e)) return;
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true; moved = false;
      try {
        const r = target.getBoundingClientRect();
        tw = r.width || tw;
        th = r.height || th;
        offsetX = e.clientX - (r.left || 0);
        offsetY = e.clientY - (r.top || 0);
      } catch (_) {}
      if (e.preventDefault) e.preventDefault();
      try { document.body.style.userSelect = "none"; } catch (_) {}
    });

    const onMove = (e) => {
      if (!dragging) return;
      let nx = Math.max(0, Math.min(e.clientX - offsetX, vw() - tw));
      let ny = Math.max(0, Math.min(e.clientY - offsetY, vh() - th));
      moved = true; lastX = nx; lastY = ny;
      target.style.position = "fixed";
      target.style.left = nx + "px";
      target.style.top = ny + "px";
      target.style.right = "auto";
      target.style.bottom = "auto";
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      try { document.body.style.userSelect = ""; } catch (_) {}
      if (moved && posKey && lastX !== null) {
        const o = { x: lastX, y: lastY };
        try { chrome.storage.local.set({ [posKey]: o }); } catch (_) {}
        bumpQuickActivity();
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function applySavedPos(el, saved) {
    if (!el || !saved || typeof saved.x !== "number") return;
    el.style.position = "fixed";
    el.style.left = saved.x + "px";
    el.style.top = saved.y + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
  }

  function toggleGlass() {
    S.glass = !S.glass;
    try { chrome.storage.local.set({ wt_glass: !!S.glass }); } catch (_) {}
    applyGlass();
    bumpQuickActivity();
  }

  function applyGlass() {
    if (!ui.root) return;
    ui.root.classList.toggle("wt-glass", !!S.glass);
    if (ui.glassBtn) ui.glassBtn.classList.toggle("wt-on", !!S.glass);
    ui.root.querySelectorAll(".wt-quick-glass").forEach((b) => b.classList.toggle("wt-on", !!S.glass));
  }

`;

c = c.slice(0, start) + impl + c.slice(c.indexOf("// ---------- boot ----------"));

fs.writeFileSync(DST, c, "utf8");
console.log("patch B applied: " + n);