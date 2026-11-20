// Watch Together - publish a version to every installed copy.
//
//   node tools/release.js V34-packs "What's new, in one line"
//
// 1. zips the folder (runtime files only) as wt-V<N>.zip + wt-latest.zip
// 2. points latest.json at it (version from the folder's manifest.json)
// 3. copies the zip to Downloads
// 4. commits and pushes to GitHub
// Every laptop that ran tools/install-watch-together.ps1 installs it within
// 30 minutes, and the extension reloads itself into it once no party is
// running. Trivia packs (trivia/*.json) need no release at all: commit and
// push them, every extension picks them up within 6 hours.
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const folder = process.argv[2];
const notes = String(process.argv[3] || "").trim();
const dryRun = process.argv.includes("--dry-run");
if (!folder || !notes) {
  console.error('usage: node tools/release.js V<N>-name "release notes" [--dry-run]');
  process.exit(2);
}
const src = path.join(ROOT, folder);
const m = /^V(\d+)-/.exec(folder);
if (!m || !fs.existsSync(path.join(src, "manifest.json"))) throw new Error("not a version folder: " + folder);
const N = m[1];
const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
const content = fs.readFileSync(path.join(src, "content.js"), "utf8");
const ver = manifest.version;
if (!new RegExp('const EXT_VER = "' + ver.replace(/\./g, "\\.") + '";').test(content)) throw new Error("manifest " + ver + " and EXT_VER differ");
const latest = JSON.parse(fs.readFileSync(path.join(ROOT, "latest.json"), "utf8"));
const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
if (!newer(ver, latest.version)) throw new Error("version " + ver + " is not newer than the published " + latest.version + " - bump manifest.json and EXT_VER first");

const zipName = "wt-V" + N + ".zip";
const zip = path.join(ROOT, zipName);
const stage = path.join(require("os").tmpdir(), "wt-release-" + Date.now());
fs.cpSync(src, stage, { recursive: true });
for (const f of ["background.src.js"]) { try { fs.rmSync(path.join(stage, f)); } catch (_) {} }
if (fs.existsSync(zip)) fs.rmSync(zip);
cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}'`], { stdio: "inherit" });
fs.rmSync(stage, { recursive: true, force: true });
fs.copyFileSync(zip, path.join(ROOT, "wt-latest.zip"));
try { fs.copyFileSync(zip, path.join(process.env.USERPROFILE || "", "Downloads", zipName)); } catch (_) {}

const next = { version: ver, zip: "https://github.com/srv883/Watch-Movies-Together/raw/main/" + zipName, notes: notes.slice(0, 200) };
fs.writeFileSync(path.join(ROOT, "latest.json"), JSON.stringify(next, null, 2) + "\n");
console.log("built " + zipName + " (" + fs.statSync(zip).size + " bytes) -> latest.json " + ver);

if (dryRun) { console.log("dry run: not committing"); process.exit(0); }
const git = (...a) => cp.execFileSync("git", a, { cwd: ROOT, stdio: "inherit" });
git("add", "-A");
git("commit", "-q", "-m", "Release " + ver + " (" + folder + "): " + notes + "\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>");
git("push", "-q", "origin", "main");
console.log("pushed - installed copies update within 30 minutes");
