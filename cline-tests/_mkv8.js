/* Create test-v8.js from test-v7.js + v8 feature checks */
const fs = require("fs");
let c = fs.readFileSync("C:/Users/Sourav/Downloads/watch-together-tests/test-v7.js", "utf8");
c = c.split("watch-together-v7/content.js").join("watch-together-v8/content.js");
c = c.split("watch-together-v7/manifest.json").join("watch-together-v8/manifest.json");
c = c.split("watch-together-v7/popup.js").join("watch-together-v8/popup.js");
c = c.replace("V7 behaviour test harness", "V8 behaviour test harness");

/* close is now animated (150ms) — wait before asserting */
c = c.replace(
  'H.q("#wt-close").dispatch("click");\n  ok(!H.q("#wt-root").classList.contains("wt-open"), "panel closed on host");',
  'H.q("#wt-close").dispatch("click");\n  await step(clock, 300);\n  ok(!H.q("#wt-root").classList.contains("wt-open"), "panel closed on host (animated)");'
);
if (!c.includes("(animated)")) throw new Error("close-anim patch failed");

/* new v8 feature sections, inserted before the error sweep */
const BS = String.fromCharCode(92);
const needle = 'console.log("' + BS + 'n--- 12. error sweep ---");';
const idx = c.indexOf(needle);
if (idx < 0) throw new Error("sweep needle missing");

const ins = [
'console.log("' + BS + 'n--- 13b. v8: glass theme toggle ---");',
'  ok(!!H.q("#wt-glass-btn"), "glass button exists in chat header");',
'  H.q("#wt-glass-btn").click();',
'  await step(clock, 30);',
'  ok(H.q("#wt-root").classList.contains("wt-glass"), "glass theme ON");',
'  ok(H.storage.wt_glass === true, "glass pref persisted");',
'  H.q("#wt-glass-btn").click();',
'  await step(clock, 30);',
'  ok(!H.q("#wt-root").classList.contains("wt-glass"), "glass theme OFF");',
'',
'  console.log("' + BS + 'n--- 13c. v8: quick + toggles & reopens panel ---");',
'  GD2 ? null : null;',
'  // use main pair G: force panel closed first',
'  if (G.q("#wt-root").classList.contains("wt-open")) {',
'    G.q("#wt-pill").click();',
'    await step(clock, 300);',
'  }',
'  ok(!G.q("#wt-root").classList.contains("wt-open"), "panel closed pre-test");',
'  const plusBtn = G.q("#wt-quick-bar").children.filter(x => x.tag !== "#text").find(x => x.classList.contains("wt-quick-plus"));',
'  plusBtn.click();',
'  await step(clock, 40);',
'  ok(G.q("#wt-root").classList.contains("wt-open"), "+ auto-reopens closed panel");',
'  ok(!G.q("#wt-picker").classList.contains("wt-hide"), "+ opens picker");',
'  plusBtn.click();',
'  await step(clock, 20);',
'  ok(G.q("#wt-picker").classList.contains("wt-hide"), "+ toggles picker closed");',
'',
'  console.log("' + BS + 'n--- 13d. v8: tray idle shrink + hover wake ---");',
'  await step(clock, 15600);',
'  ok(G.q("#wt-quick").classList.contains("wt-idle"), "tray shrinks after 15s idle");',
'  G.q("#wt-quick").dispatch("mouseenter");',
'  ok(!G.q("#wt-quick").classList.contains("wt-idle"), "hover instantly wakes tray");',
'',
'  console.log("' + BS + 'n--- 13e. v8: drag moves pill with panel ---");',
'  const hdl = G.q(".wt-drag-handle");',
'  hdl.dispatch("mousedown", { button: 0, clientX: 100, clientY: 80, target: hdl });',
'  G.doc.dispatchDoc("mousemove", { clientX: 500, clientY: 300 });',
'  G.doc.dispatchDoc("mouseup", {});',
'  ok(G.q("#wt-root").style.left === "400px" && G.q("#wt-root").style.top === "220px",',
'    "root (pill+panel) dragged together (" + G.q("#wt-root").style.left + "," + G.q("#wt-root").style.top + ")");',
'  ok(H.storage.wt_pos_root && H.storage.wt_pos_root.x === 400, "root position persisted");',
'  ok(G.q("#wt-pill") && G.q("#wt-pill").parent === G.q("#wt-root"), "pill still inside dragged root");',
'',
''
].join("\n");

c = c.slice(0, idx) + ins + c.slice(idx);

// remove a stray leftover line if present
c = c.replace(/\n\s*GD2 \? null : null;\n/, "\n");

fs.writeFileSync("C:/Users/Sourav/Downloads/watch-together-tests/test-v8.js", c, "utf8");
console.log("test-v8.js created");