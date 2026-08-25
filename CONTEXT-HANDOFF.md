# WATCH TOGETHER — Context Handoff (as of Aug 26, 2026)

## Objective
Maintain the personal "Watch Together" Chrome extension using strict **per-version folders** (`V1`–`V19`) inside `C:\Users\Sourav\ML Coding\watch-together-versions\`. NEVER overwrite an old version's folder; always create the next numbered folder. Deliverables are zips named `wt-V<N>.zip` in the same root and copied to `C:\Users\Sourav\Downloads\`. Push every commit to `https://github.com/srv883/Watch-Movies-Together`.

## Current Shipped State
- **V19** (`wt-V19.zip` — **delivered to `C:\Users\Sourav\Downloads\wt-V19.zip`** + canonical copy in versions root; manifest **1.19.0**, `EXT_VER="1.19.0"`): CURRENT shipping version. Folder `V19-quickchat\`. Tests `tests\test-V19.js`: **288 passed, 0 failed**. Bar chat input + emoji picker next to bar:
  - **Chat input below emoji bar:** `#wt-qtype-form` with `#wt-qtype-input` rendered below `#wt-quick-bar`, same liquid glass styling. Hides when panel not shown (`#wt-quick.wt-show`). Sends on Enter.
  - **Emoji picker next to bar:** `#wt-qtype-picker` inside `#wt-quick` (not in main chat panel). `+` button opens/closes it. Has search + grid. Emoji click sends reaction and closes picker. Main chat picker hidden by default.
  - **ID rename:** Old overlay input renamed to `#wt-qtype-overlay-input` (`ui.qtypeInput`); new bar input is `ui.qBarInput`.
- **V18** (`wt-V18.zip`, manifest 1.18.0): frozen. Folder `V18-fullscreen\`. Tests 270 passed. Voice fix (stereo=0 mono Opus) + fullscreen reparent + liquid glass emoji bar.
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
- Voice-line rules: mute ≠ close; answer always carries a slot; never redial while a line is healthy.
- Status strings during outages stay calm/stable.
- Bar input (`#wt-qtype-input`) is separate from overlay input (`#wt-qtype-overlay-input`). Tests must use correct IDs.

## Relevant Files
- `C:\Users\Sourav\ML Coding\watch-together-versions\V19-quickchat\` — current version (v1.19.0): content.js, overlay.css, manifest.json, popup.html, popup.js, lib/peerjs.min.js, icons/
- `C:\Users\Sourav\Downloads\wt-V19.zip` — deliverable
- `C:\Users\Sourav\ML Coding\watch-together-versions\tests\test-V19.js` — 288-check regression suite
- `C:\Users\Sourav\ML Coding\watch-together-versions\V18-fullscreen\` + `wt-V18.zip` — frozen
- `C:\Users\Sourav\ML Coding\watch-together-versions\V17-quicktype\` + `wt-V17.zip` — frozen
- Git push: `git add -A && git commit -m "..." && git push` from `watch-together-versions\`

## Next Move (when resumed)
Nothing pending. Any new feature request → create `V20-*` folder, port from V19, bump manifest+EXT_VER together, extend test suite, zip as wt-V20.zip, commit+push to GitHub.
