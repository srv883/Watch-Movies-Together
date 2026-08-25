/* V8 patch C: CSS — glass theme, animations, idle shrink, buttons */
const fs = require("fs");
const MF = "C:/Users/Sourav/Downloads/watch-together-v8/manifest.json";
const CS = "C:/Users/Sourav/Downloads/watch-together-v8/overlay.css";

let m = fs.readFileSync(MF, "utf8");
m = m.replace(/"version": "[^"]+"/, '"version": "1.9.0"');
fs.writeFileSync(MF, m, "utf8");

const cssAdd = `
/* ---------- v8: glass theme ---------- */
#wt-root.wt-glass #wt-panel,
#wt-root.wt-glass #wt-picker,
#wt-root.wt-glass #wt-linkbox {
  background: rgba(18, 18, 28, 0.42);
  backdrop-filter: blur(20px) saturate(170%);
  -webkit-backdrop-filter: blur(20px) saturate(170%);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.14);
}
#wt-root.wt-glass .wt-head { background: rgba(255, 255, 255, 0.07); }
#wt-root.wt-glass #wt-input,
#wt-root.wt-glass #wt-emoji-search {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.2);
}
#wt-root.wt-glass #wt-quick-bar,
#wt-root.wt-glass #wt-now-label {
  background: rgba(20, 20, 32, 0.4);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  border-color: rgba(255, 255, 255, 0.15);
}
#wt-root.wt-glass .wt-statusline { border-bottom-color: rgba(255, 255, 255, 0.08); }
#wt-root.wt-glass .wt-msg { color: #f3f5ff; }

#wi-glass-btn, #wt-glass-btn, .wt-quick-glass {
  background: none;
  border: none;
  color: #9aa3b8;
  font-size: 13px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 6px;
  cursor: pointer;
}
#wt-glass-btn:hover, .wt-quick-glass:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
#wt-glass-btn.wt-on, .wt-quick-glass.wt-on { color: #7fd7ff; text-shadow: 0 0 8px rgba(127, 215, 255, 0.6); }

/* ---------- v8: panel open/close animation + pill micro-shrink ---------- */
@keyframes wt-panel-in {
  from { opacity: 0; transform: translateY(12px) scale(0.95); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes wt-panel-out {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to   { opacity: 0; transform: translateY(10px) scale(0.95); }
}
#wt-root.wt-open #wt-panel { animation: wt-panel-in 0.18s ease-out; }
#wt-root.wt-shut #wt-panel { animation: wt-panel-out 0.14s ease-in forwards; }
#wt-pill { transition: transform 0.18s ease; }
#wt-root.wt-open #wt-pill { transform: scale(0.93); opacity: 0.85; }

/* ---------- v8: quick tray idle shrink ---------- */
#wt-quick-bar, #wt-quick { transition: transform 0.25s ease, opacity 0.25s ease; }
#wt-quick.wt-idle { transform: scale(0.78); opacity: 0.55; }
#wt-quick.wt-idle:hover { transform: scale(1); opacity: 1; }
`;
let css = fs.readFileSync(CS, "utf8");
if (!css.includes("v8: glass theme")) { fs.writeFileSync(CS, css + cssAdd, "utf8"); }
else console.log("css already patched");
console.log("patch C applied");