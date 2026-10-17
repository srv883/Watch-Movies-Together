# WATCH TOGETHER — Context Handoff (as of Oct 18, 2026)

## Objective
Maintain the personal "Watch Together" Chrome extension using strict **per-version folders** (`V1`–`V26`) inside `C:\Users\Sourav\ML Coding\watch-together-versions\`. NEVER overwrite an old version's folder; always create the next numbered folder. Deliverables are zips named `wt-V<N>.zip` in the same root and copied to `C:\Users\Sourav\Downloads\`. Push every commit to `https://github.com/srv883/Watch-Movies-Together`.

## Current Shipped State
- **V26** (`wt-V26.zip` — **delivered to `C:\Users\Sourav\Downloads\wt-V26.zip`** + canonical copy in versions root; manifest **1.26.0**, `EXT_VER="1.26.0"`): CURRENT shipping version. Folder `V26-voicelink\`. Tests `tests\test-V26.js`: **401 passed, 0 failed**. Fixes "voice not working at all" (both sides must install V26):
  - **Voice signaled over the data link** (`voffer`/`vanswer`/`vice`/`vbye`) via `makeDcCall`/`dialDcCall`/`answerDcCall` — no longer needs the PeerJS cloud server (ad blockers like the user's AdBlocker Ultimate / Wi-Fi blips used to kill voice while sync kept working). Uses PeerJS's STUN+TURN set (`VOICE_ICE`). Friends older than 1.26 (hello `v`) still get the legacy `peer.call`; a legacy line dialed before hello is migrated once hello arrives.
  - **hotSwapMicTrack is async and awaits replaceTrack**: Chrome updates `sender.track` only after the promise resolves; the old sync check reported failure on EVERY mic-on and rebuilt the line (root cause of the V18–V21 "redial storm"). `swapMicOrRedial()` wraps the redial fallback.
  - **healVoice()** from the host heartbeat re-dials a failed/closed line, or one with no remote stream after 15s (8s guard). Before, a dropped line stayed dead until someone toggled a mic.
  - **Direct mode fixed**: `finishLink` closed the very RTCPeerConnection carrying the channel (link died instantly in real Chrome) and never ran `onConnOpen` (channel already open). Now kept as `S.directPC`, handshake runs, voice allowed in Direct mode.
  - **connectToHost**: PeerJS `connect()` returns undefined while its server is unreachable — old code crashed on `c.on` and stopped retrying.
  - Specific mic errors (blocked / no mic / busy in another app) + hint after 2.5s while the permission prompt is pending. `__wtVoiceDbg()` now shows `path` (link/peerjs), `gotStream`, `friendVer`.
  - Harness: FakeRTC carries audio (records in `env._calls` keep the old Call shape) and simulates Direct mode for real (the old fake never linked the guest's channel, so Direct tests rode the PeerJS link). Section 29 covers all of the above, incl. a real V25 guest for mixed versions.
  - **Real-browser voice test**: `tests\live\live.html` + `serve.js` run the real content.js + PeerJS + WebRTC in two tabs with a fake tone mic. Put a copy of content.js (guard line replaced by `void SITE_HOSTS;`), overlay.css and `lib\peerjs.min.js` next to it, `node serve.js <dir> 8766`, open `live.html?role=host&code=XXXXXX` and `?role=guest&code=XXXXXX` (`&block=1` kills PeerJS signaling). Probe with `__flow()` / `__probe()` (getStats packets + levels). Real clicks are needed for the mic (AudioContext gesture).
- **V25** (`wt-V25.zip`, manifest 1.25.0): frozen. Folder `V25-sitepicker\`. Tests 376 passed. Polish on top of the V24 streams-only build:
  - **Manifest description** no longer claims "Watch ANYTHING on ANY site" — names the 5 supported services (123 chars, under Chrome's 132 limit).
  - **popup.js `SITES`** table (`name`, launch `url`, `hosts`) replaces the bare host list; `siteFor(url)` returns the brand, `isSupported()` wraps it. `SITE_HOSTS` is derived from `SITES`.
  - **Popup header** shows the friendly name ("Netflix", "JioHotstar", …) instead of the raw hostname.
  - **Unsupported tab** → one quick-launch button per site (`#siteList`, opens the site in a new tab via `chrome.tabs.create`, then closes the popup).
  - **Party active on an unsupported tab** → amber `#offSiteHint` ("Not running on this tab — switch to your … tab"); hidden on supported tabs.
  - **Copy invite** names the site: "Let's watch Netflix together! Open this: <url> … enter party code: X"; off-site it is just "Watch Together party code: X".
  - **Tests (28a–h)** run the REAL popup.js against a fake popup DOM, and enforce manifest hosts == content.js `SITE_HOSTS` == popup `SITE_HOSTS`. 12h also checks look-alike hosts (`evilnetflix.com`, `netflix.com.evil.io`) are blocked.
  - content.js unchanged apart from `EXT_VER`.
- **V24** (`wt-V24.zip`, manifest 1.24.0): frozen. Folder `V24-sitewhitelist\`. Tests 330 passed. Streams-only build:
  - **Manifest `content_scripts.matches`** limited to 6 domains: `netflix.com`, `hotstar.com`, `jiohotstar.com`, `primevideo.com`, `jiotv.com`, `jiocinema.com` (was `<all_urls>`).
  - **popup.js** `isSupported()` enforces the same host whitelist (was: any http(s) page).
  - **content.js** runtime host guard (`const SITE_HOSTS`) bails before creating any UI if the host is not whitelisted (defence-in-depth behind the manifest).
- **V23** (`wt-V23.zip`, manifest 1.23.0): frozen. Folder `V23-loudmic\`. Tests 323 passed. autoGainControl follows NC toggle — fixes "clear but low" friend voice.
- **V22** (`wt-V22.zip`, manifest 1.22.0): frozen. Folder `V22-denoise\`. Tests 317 passed. Background-noise fix — noiseSuppression follows NC toggle. NS-only, no AGC → "clear but low" on quiet mics → led to V23.
- **V21** (`wt-V21.zip`, manifest 1.21.0): frozen. Folder `V21-voicefix\`. Tests 311 passed. Fixed total voice failure: PeerJS `MediaConnection` never emits `"open"`, so V19's deferred hot-swap was dead code. Restored immediate `hotSwapMicTrack` in `attachVoiceCall` (redial fallback) and removed the `callOpen` guards in `toggleMic` / `ensureMicIfWanted`.
- **V20** (`wt-V20.zip`, manifest 1.20.0): frozen. Folder `V20-floatcenter\`. Tests 298 passed. Floating chat repositioned to screen center + themed to match emoji bar:
  - **Floating chat repositioned:** `#wt-float-msgs` moved from `bottom: 72px` to `bottom: 35vh` — floats near the center of the screen instead of near the controls.
  - **Theme matched to emoji bar:** `.wt-float-msg` background changed from `rgba(18,18,28,0.55)` to `rgba(16,16,24,0.65)`, saturate 1.3→1.4, box-shadow lightened to `0 4px 20px rgba(0,0,0,0.35)` — identical glass language as the emoji bar.
  - **Animation matched to emoji bar:** New `wt-float-in` keyframes use `scale(0.92)→scale(1)→scale(0.92)` with matching opacity — mirrors the bar's idle/hover transition (0.92 scale, 0.85 opacity) instead of the old translateY-based animation.
  - **Glass mode:** Added `.wt-glass` override for `.wt-float-msg` — lighter bg `rgba(20,20,32,0.4)`, lighter border — consistent with `#wt-quick.wt-glass #wt-quick-bar`.
- **V19** (`wt-V19.zip`, manifest 1.19.0): frozen. Folder `V19-quickchat\`. Tests 288 passed. Bar chat input + emoji picker next to bar + voice fix #3 + visibility fix.
- **V17** (`wt-V17.zip`, manifest 1.17.0): frozen. Folder `V17-quicktype\`. Tests 270 passed. Quick-type overlay (T or / shortcut).
- **V16** (`wt-V16.zip`, manifest 1.16.0): frozen. Folder `V16-floatchat\`. Tests 252 passed. Floating chat notifications + emoji bar reposition.
- **V15** (`wt-V15.zip`, manifest 1.15.0): frozen. Folder `V15-overlays\`. Tests 232 passed. Action overlays + voice fix (NS/AGC off at constraint level) + gate disabled.
- **V14** (`wt-V14.zip`, manifest 1.14.0): frozen. Folder `V14-longrun\`. Tests 208 passed. Fixed ~45-minute silent drop.
- **V13** (`wt-V13.zip`, manifest 1.13.0): frozen. Folder `V13-lowlatency\`. Tests 198 passed. Fixed ~2s asymmetric voice lag.
- **V12** (`wt-V12.zip`, manifest 1.12.0): frozen. Folder `V12-remote-audio\`. Tests 192 passed. Gate fail-open + autoplay-blocked playback.
- **V11** (`wt-V11.zip`, manifest 1.11.0): frozen. Folder `V11-hist-voice\`. Tests 175 passed. Mute-keeps-line-open + watch history.
- **V10** (`wt-V10.zip`, manifest 1.10.0): frozen. Folder `V10-dropfix-nc\`. Tests 136 passed. Connection-drop resilience + NC toggle.

## Architecture Notes
- Core logic in `content.js` of each version folder; popup (`popup.html/js/css`) alongside. No background service worker.
- Supported sites live in THREE places that must match: manifest `content_scripts.matches`, `SITE_HOSTS` at the top of content.js, and `SITES[].hosts` in popup.js. test-V26 section 28a fails if they drift.
- Test harness: `tests\test-V26.js` — plain node script. Per-instance `makeInstance(env, name, preset, host, src)` (src = another build's content.js, e.g. V25 for mixed-version tests) seeds storage pre-boot (host defaults to `www.netflix.com`). `runPopup(url, store)` runs the real popup.js against a fake DOM built from popup.html ids.
- Version alignment rule: manifest version == EXT_VER badge string (currently 1.26.0).
- Git repo: `https://github.com/srv883/Watch-Movies-Together` — every version commit pushed here.

## Conventions & Gotchas
- Fake DOM elements use `.tag` not `.tagName` — always check both (`e.target.tagName || e.target.tag`).
- `dispatchDoc` on fake doc calls handlers via stored listener array; fake events need `preventDefault` wrapped in try/catch.
- Opus SDP must match mic capture: mono mic → `stereo=0` in SDP. Never set stereo=1 with mono capture.
- `position: fixed` elements don't automatically appear in fullscreen — must reparent into fullscreen container.
- In the harness, a lone HOST cannot acquire the mic — pair a guest first.
- Voice-line rules: mute ≠ close; answer always carries a slot; never redial while a line is healthy. `attachVoiceCall` hot-swaps the mic IMMEDIATELY (redial fallback) — PeerJS `MediaConnection` never emits `"open"`, so never defer to it and never gate `toggleMic` / `ensureMicIfWanted` on `callOpen` (that was the V19/V20 total-voice-failure bug, fixed in V21). The 5s debounce in `requestVoiceRedial` prevents redial storms. `replaceTrack` is async — always await it before reading `sender.track` (V26).
- Both sides must run the same version when testing voice fixes (user + friend were once on V21 vs V22).
- Status strings during outages stay calm/stable.
- Bar input (`#wt-qtype-input`) is separate from overlay input (`#wt-qtype-overlay-input`). Tests must use correct IDs.

## Relevant Files
- `C:\Users\Sourav\ML Coding\watch-together-versions\V26-voicelink\` — current version (v1.26.0): content.js, overlay.css, manifest.json, popup.html, popup.js, popup.css, lib/peerjs.min.js, icons/
- `C:\Users\Sourav\Downloads\wt-V26.zip` — deliverable
- `C:\Users\Sourav\ML Coding\watch-together-versions\tests\test-V26.js` — 401-check regression suite; `tests\live\` — real-browser voice test
- `C:\Users\Sourav\ML Coding\watch-together-versions\V25-sitepicker\` + `wt-V25.zip` — frozen
- Git push: `git add -A && git commit -m "..." && git push` from `watch-together-versions\`

## Next Move (when resumed)
Nothing pending. Any new feature request → create `V27-*` folder, port from V26, bump manifest+EXT_VER together, extend test suite, zip as wt-V27.zip, commit+push to GitHub.
