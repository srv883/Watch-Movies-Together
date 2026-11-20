// Build the Chrome Web Store upload from a version folder.
//   node tools/make-store-zip.js V35-store
// Output: store/watch-together-<version>-chrome-web-store.zip
// Differences from the GitHub build: no "alarms" permission (the folder
// self-update is for unpacked installs; Chrome updates store installs, and
// the code skips self-update when the manifest has an update_url, which the
// store adds), no background.src.js (the bundled background.js is what runs).
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const folder = process.argv[2];
if (!folder) { console.error("usage: node tools/make-store-zip.js V<N>-name"); process.exit(2); }
const src = path.join(ROOT, folder);
const m = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
const stage = path.join(require("os").tmpdir(), "wt-store-" + Date.now());
fs.cpSync(src, stage, { recursive: true });
fs.rmSync(path.join(stage, "background.src.js"), { force: true });

m.permissions = (m.permissions || []).filter((p) => p !== "alarms");
delete m.key;
delete m.update_url;
if (m.description.length > 132) throw new Error("description over 132 characters");
for (const s of ["16", "48", "128"]) if (!fs.existsSync(path.join(stage, m.icons[s]))) throw new Error("missing icon " + s);
fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(m, null, 2) + "\n");

const outDir = path.join(ROOT, "store");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "watch-together-" + m.version + "-chrome-web-store.zip");
if (fs.existsSync(out)) fs.rmSync(out);
// forward-slash entry names (the store's unzip is stricter than Windows Explorer)
cp.execFileSync("powershell.exe", ["-NoProfile", "-Command",
  "Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem; " +
  `$z = [System.IO.Compression.ZipFile]::Open('${out}', 'Create'); ` +
  `Get-ChildItem -Path '${stage}' -Recurse -File | ForEach-Object { ` +
  `$rel = $_.FullName.Substring(${stage.length + 1}).Replace('\\', '/'); ` +
  `[void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $_.FullName, $rel) }; $z.Dispose()`], { stdio: "inherit" });
fs.rmSync(stage, { recursive: true, force: true });
console.log("store zip: " + out + " (" + fs.statSync(out).size + " bytes), version " + m.version + ", permissions " + JSON.stringify(m.permissions) + ", hosts " + JSON.stringify(m.host_permissions));
