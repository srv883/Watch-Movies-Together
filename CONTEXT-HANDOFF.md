# WATCH TOGETHER — Context Handoff (as of Aug 26, 2026)

## Objective
Maintain the personal "Watch Together" Chrome extension using strict **per-version folders** (`V1`–`V22`) inside `C:\Users\Sourav\ML Coding\watch-together-versions\`. NEVER overwrite an old version's folder; always create the next numbered folder. Deliverables are zips named `wt-V<N>.zip` in the same root and copied to `C:\Users\Sourav\Downloads\`. Push every commit to `https://github.com/srv883/Watch-Movies-Together`.

## Current Shipped State
- **V22** (`wt-V22.zip` — **delivered to `C:\Users\Sourav\Downloads\wt-V22.zip`** + canonical copy in versions root; manifest **1.22.0**, `EXT_VER="1.22.0"`): CURRENT shipping version. Folder `V22-denoise\`. Tests `tests\test-V22.js`: **317 passed, 0 failed**. Background-noise fix — friend could hear user's room noise:
  - **Root cause:** `noiseSuppression: false` hardcoded in getUserMedia since v15 (was blamed for "car engine" artifacts) → all fan/keyboard/room noise passed straight to the wire.
  - **Fix:** `noiseSuppression: !!S.nc` in `getMicStream()` — follows the NC toggle, default ON.
  - **Live toggle:** `applyNcToLiveStream()` now applies `{ noiseSuppression: !!S.nc }` via `track.applyConstraints` on the LIVE track (no mic restart); fallback rebuild path also uses the pref. The NC button is now a real denoise on/off switch.
  - Unchanged: EC:false + AGC:false (chirping/pumping guards), Opus SDP boost, V21 immediate-hotSwap voice logic.
- **V21** (`wt-V21.zip`, manifest 1.21.0): frozen. Folder `V21-voicefix\`. Tests 311 passed. Voice fix — restored immediate hotSwapMicTrack behavior:
  - **attachVoiceCall:** Restored immediate `hotSwapMicTrack(S.micStream)` call (V18 style). V19's deferred `call.on("open")` handler NEVER fires on PeerJS MediaConnection (confirmed via PeerJS source analysis) — the mic track was never hot-swapped into the live call after initial SDP setup.
  - **toggleMic:** Removed `callOpen` guard — redials unconditionally when hotSwap fails. The 5-second debounce inside `requestVoiceRedial` already prevents storms.
  - **ensureMicIfWanted:** Same — removed `callOpen` guard, unconditional redial on hotSwap failure.
  - **Opus SDP:** Unchanged from V19 (replaces entire fmtp line, 128kbps CBR mono).
  - **getUserMedia:** EC:false kept for laptop compatibility; NS was still false here → led to V22.
- **V20** (`wt-V20.zip`, manifest 1.20.0): frozen. Folder `V20-floatcenter\`. Tests 298 passed. Floating chat repositioned to screen center + themed to match emoji bar:
  - **Floating chat repositioned:** `#wt-float-msgs` moved from `bottom: 72px` to `bottom: 35vh` — floats near the center of the screen instead of near the controls.
  - **Theme matched to emoji bar:** `.wt-float-msg` background changed from `rgba(18,18,28,0.55)` to `rgba(16,16,24,0.65)`, saturate 1.3→1.4, box-shadow lightened to `0 4px 20px rgba(0,0,0,0.35)` — identical glass language as the emoji bar.
  - **Animation matched to emoji bar:** New `wt-float-in` keyframes use `scale(0.92)→scale(1)→scale(0.92)` with matching opacity — mirrors the bar's idle/hover transition (0.92 scale, 0.85 opacity) instead of the old translateY-based animation.
  - **Glass mode:** Added `.wt-glass` override for `.wt-float-msg` — lighter bg `rgba(20,20,32,0.4)`, lighter border — consistent with `#wt-quick.wt-glass #wt-quick-bar`.- **V19** (`wt-V19.zip`, manifest 1.19.0): frozen. Folder `V19-quickchat\`. Tests 288 passed. Bar chat input + emoji picker next to bar + voice fix #3 + visibility fix.
- **V17** (`wt-V17.zip`, manifest 1.17.0): frozen. Folder `V17-quicktype\`. Tests 270 passed. Quick-type overlay (T or / shortcut).
- **V16** (`wt-V16.zip`, manifest 1.16.0): frozen. Folder `V16-floatchat\`. Tests 252 passed. Floating chat notifications + emoji bar reposition.
- **V15** (`wt-V15.zip`, manifest 1.15.0): frozen. Folder `V15-overlays\`. Tests 232 passed. Action overlays + voice fix (NS/AGC off at constraint level) + gate disabled.
- **V14** (`wt-V14.zip`, manifest 1.14.0): frozen. Folder `V14-longrun\`. Tests 208 passed. Fixed ~45-minute silent drop.
- **V13** (`wt-V13.zip`, manifest 1.13.0): frozen. Folder `V13-lowlatency\`. Tests 198 passed. Fixed ~2s asymmetric voice lag.
- **V12** (`wt-V12.zip`, manifest 1.12.0): frozen. Folder `V12-remote-audio\`. Tests 192 passed. Gate fail-open + autoplay-blocked playback.
- **V11** (`wt-V11.zip`, manifest 1.11.0): frozen. Folder `V11-hist-voice\`. Tests 175 passed. Mute-keeps-line-open + watch history.
- **V10** (`wt-V10.zip`, manifest 1.10.0): frozen. Folder `V10-dropfix-nc\`. Tests 136 passed. Connection-drop resilience + NC toggle.

## Architecture Notes
- Core logic in `content.js` of each version folder. Popup + background alongside.
- Test harness: `tests\test-V19.js` — plain node script. Per-instance `makeInstance(env, name, preset)` seeds storage pre-boot.
- Version alignment rule: manifest version == EXT_VER badge string (currently 1.19.0).
- Git repo: `https://github.com/srv883/Watch-Movies-Together` — every version commit pushed here.

## Conventions & Gotchas
- Fake DOM elements use `.tag` not `.tagName` — always check both (`e.target.tagName || e.target.tag`).
- `dispatchDoc` on fake doc calls handlers via stored listener array; fake events need `preventDefault` wrapped in try/catch.
- Opus SDP must match mic capture: mono mic → `stereo=0` in SDP. Never set stereo=1 with mono capture.
- `position: fixed` elements don't automatically appear in fullscreen — must reparent into fullscreen container.
- In the harness, a lone HOST cannot acquire the mic — pair a guest first.
- Voice-line rules: mute ≠ close; answer always carries a slot; never redial while a line is healthy. `attachVoiceCall` must NOT hot-swap immediately (senders not ready during ICE) — defer to "open" event. `toggleMic`/`ensureMicIfWanted` must check `callOpen` before triggering redial.
- Status strings during outages stay calm/stable.
- Bar input (`#wt-qtype-input`) is separate from overlay input (`#wt-qtype-overlay-input`). Tests must use correct IDs.

## Relevant Files
- `C:\Users\Sourav\ML Coding\watch-together-versions\V20-floatcenter\` — current version (v1.20.0): content.js, overlay.css, manifest.json, popup.html, popup.js, lib/peerjs.min.js, icons/
- `C:\Users\Sourav\Downloads\wt-V20.zip` — deliverable
- `C:\Users\Sourav\ML Coding\watch-together-versions\tests\test-V20.js` — 298-check regression suite
- `C:\Users\Sourav\ML Coding\watch-together-versions\V19-quickchat\` + `wt-V19.zip` — frozen
- `C:\Users\Sourav\ML Coding\watch-together-versions\V18-fullscreen\` + `wt-V18.zip` — frozen
- Git push: `git add -A && git commit -m "..." && git push` from `watch-together-versions\`

## Next Move (when resumed)
Nothing pending. Any new feature request → create `V21-*` folder, port from V20, bump manifest+EXT_VER together, extend test suite, zip as wt-V21.zip, commit+push to GitHub.
