# WATCH TOGETHER — Context Handoff (as of Aug 26, 2026)

## Objective
Maintain the personal "Watch Together" Chrome extension using strict **per-version folders** (`V1`–`V18`) inside `C:\Users\Sourav\ML Coding\watch-together-versions\`. NEVER overwrite an old version's folder; always create the next numbered folder. Deliverables are zips named `wt-V<N>.zip` in the same root and copied to `C:\Users\Sourav\Downloads\`. Push every commit to `https://github.com/srv883/Watch-Movies-Together`.

## Current Shipped State
- **V18** (`wt-V18.zip` — **delivered to `C:\Users\Sourav\Downloads\wt-V18.zip`** + canonical copy in versions root; manifest **1.18.0**, `EXT_VER="1.18.0"`): CURRENT shipping version. Folder `V18-fullscreen\`. Tests `tests\test-V18.js`: **270 passed, 0 failed**. Voice quality fix + fullscreen support + liquid glass emoji bar:
  - **Voice fix (root cause):** `mungeOpus()` was setting `stereo=1;sprop-stereo=1` in SDP but mic captures mono (`channelCount: 1`). Opus encoder tried to encode mono as stereo → garbled output on receiver. Fixed: `stereo=0;sprop-stereo=0`, removed `cbr=1` (now VBR), removed broken `googNoiseSuppression=0;googAutoGainControl=0;googHighpassFilter=0` (Chrome ignores these legacy SDP params), reduced `maxaveragebitrate` from 128kbps to 96kbps (sufficient for voice), removed invalid `sampleSize:16` from getUserMedia constraints.
  - **Fullscreen:** Floating elements (`#wt-quick`, `#wt-float-msgs`, `#wt-qtype`) are reparented into the fullscreen container on `fullscreenchange` event so they remain visible when the video goes native fullscreen. Elements return to `documentElement` when fullscreen exits.
  - **Liquid glass emoji bar:** Semi-transparent (`rgba(16,16,24,0.45)`) with `backdrop-filter: blur(18px) saturate(1.4)`. Scales to 0.82 opacity by default, expands to full on hover. Idle shrink scales bar only (not container). Hover restores.
  - **Removed "what's playing" label** from emoji bar — cleaner look.
  - **Floating chat notifications** also get liquid glass backdrop blur.
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
- Test harness: `tests\test-V18.js` — plain node script. Per-instance `makeInstance(env, name, preset)` seeds storage pre-boot.
- Version alignment rule: manifest version == EXT_VER badge string (currently 1.18.0).
- Git repo: `https://github.com/srv883/Watch-Movies-Together` — every version commit pushed here.

## Conventions & Gotchas
- Fake DOM elements use `.tag` not `.tagName` — always check both (`e.target.tagName || e.target.tag`).
- `dispatchDoc` on fake doc calls handlers via stored listener array; fake events need `preventDefault` wrapped in try/catch.
- Opus SDP must match mic capture: mono mic → `stereo=0` in SDP. Never set stereo=1 with mono capture.
- `position: fixed` elements don't automatically appear in fullscreen — must reparent into fullscreen container.
- In the harness, a lone HOST cannot acquire the mic — pair a guest first.
- Voice-line rules: mute ≠ close; answer always carries a slot; never redial while a line is healthy.
- Status strings during outages stay calm/stable.

## Relevant Files
- `C:\Users\Sourav\ML Coding\watch-together-versions\V18-fullscreen\` — current version (v1.18.0)
- `C:\Users\Sourav\Downloads\wt-V18.zip` — deliverable
- `C:\Users\Sourav\ML Coding\watch-together-versions\tests\test-V18.js` — 270-check regression suite
- `C:\Users\Sourav\ML Coding\watch-together-versions\V17-quicktype\` + `wt-V17.zip` — frozen
- `C:\Users\Sourav\ML Coding\watch-together-versions\V16-floatchat\` + `wt-V16.zip` — frozen
- Git push: `git add -A && git commit -m "..." && git push` from `watch-together-versions\`

## Next Move (when resumed)
Nothing pending. Any new feature request → create `V19-*` folder, port from V18, bump manifest+EXT_VER together, extend test suite, zip as wt-V19.zip, commit+push to GitHub.
