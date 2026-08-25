# WATCH TOGETHER — Context Handoff (as of Aug 25, 2026)

## Objective
Maintain the personal "Watch Together" Chrome extension using strict **per-version folders** (`V1`–`V17`) inside `C:\Users\Sourav\ML Coding\watch-together-versions\`. NEVER overwrite an old version's folder; always create the next numbered folder. Deliverables are zips named `wt-V<N>.zip` in the same root and copied to `C:\Users\Sourav\Downloads\`.

## Current Shipped State
- **V17** (`wt-V17.zip` — **delivered to `C:\Users\Sourav\Downloads\wt-V17.zip`** + canonical copy in versions root; manifest **1.17.0**, `EXT_VER="1.17.0"`): CURRENT shipping version. Folder `V17-quicktype\`. Tests `tests\test-V17.js`: **270 passed, 0 failed**. Adds quick-type overlay:
  - **Quick-type overlay** (`initQtype`): press `T` or `/` anywhere (when no input/button focused) → centered frosted-glass overlay slides up with input field → type message → `Enter` sends → `Escape` closes. Click backdrop closes. Empty/whitespace messages don't send. Guard: `T`/`/` ignored when `INPUT`/`TEXTAREA`/`BUTTON` is focused (`e.target.tagName || e.target.tag` for fake DOM compatibility).
  - Backdrop click listener registered inside `ensureUi()` (not at script load) so `ui.qtype` exists.
  - `try { e.preventDefault(); } catch (_) {}` wraps all keydown preventDefault calls (fake DOM events lack native methods).
  - Includes all V16 + V15 fixes.
- **V16** (`wt-V16.zip`, manifest 1.16.0): frozen. Folder `V16-floatchat\`. Tests 252 passed. Floating chat notifications + emoji bar repositioned to bottom-center + glass propagation + detached element queries.
- **V15** (`wt-V15.zip`, manifest 1.15.0): frozen. Folder `V15-overlays\`. Tests 232 passed. Action overlays + sync timestamps + voice fix (NS/AGC off at constraint level) + gate disabled + friendTime sync bug fix.
- **V14** (`wt-V14.zip`, manifest 1.14.0): frozen. Folder `V14-longrun\`. Tests 208 passed. Fixed ~45-minute silent drop (host re-offer + 10s dial timeout + guest hard-rejoin + symmetric inbound dedup).
- **V13** (`wt-V13.zip`, manifest 1.13.0): frozen. Folder `V13-lowlatency\`. Tests 198 passed. Fixed ~2s asymmetric voice lag (gate flapping inflated jitter buffer); `clampVoiceJitter()` pins both receivers to 60ms.
- **V12** (`wt-V12.zip`, manifest 1.12.0): frozen. Folder `V12-remote-audio\`. Tests 192 passed. Gate fail-open + autoplay-blocked playback + redial fallback.
- **V11** (`wt-V11.zip`, manifest 1.11.0): frozen. Folder `V11-hist-voice\`. Tests 175 passed. Mute-keeps-line-open + watch history + voice quality hardening.
- **V10** (`wt-V10.zip`, manifest 1.10.0): frozen. Folder `V10-dropfix-nc\`. Tests 136 passed. Connection-drop resilience + noise cancellation toggle.

## Architecture Notes
- Core logic in `content.js` of each version folder. Popup + background alongside.
- Test harness: `tests\test-V17.js` — plain node script. Per-instance `makeInstance(env, name, preset)` seeds storage pre-boot. Heartbeats fire via `S.hbTimer`→`sendHb`.
- Version alignment rule: manifest version == EXT_VER badge string (currently 1.17.0).

## Conventions & Gotchas
- PowerShell `.Split(string)` splits per-char — use `.Replace()` or regex instead.
- npm.ps1 blocked by execution policy → use `cmd /c npm ...`.
- Fake DOM elements use `.tag` not `.tagName` — always check both in content scripts.
- `dispatchDoc` on fake doc calls handlers via stored listener array; fake events need `preventDefault` wrapped in try/catch.
- In the harness, a lone HOST cannot acquire the mic — pair a guest first.
- Voice-line rules that must NEVER regress: mute ≠ close; answer always carries a slot; never redial while a line is healthy; reconcile on attach.
- Status strings during outages stay calm/stable; never blame ad blockers for Wi-Fi loss.
- This machine may have OTHER agent sessions editing sibling repos — verify paths before blaming tooling.

## Relevant Files
- `C:\Users\Sourav\ML Coding\watch-together-versions\V17-quicktype\` — current version (v1.17.0): manifest.json, content.js, overlay.css, popup.html, popup.js
- `C:\Users\Sourav\Downloads\wt-V17.zip` — deliverable
- `C:\Users\Sourav\ML Coding\watch-together-versions\tests\test-V17.js` — 270-check regression suite
- `C:\Users\Sourav\ML Coding\watch-together-versions\V16-floatchat\` + `wt-V16.zip` — frozen (252 checks)
- `C:\Users\Sourav\ML Coding\watch-together-versions\V15-overlays\` + `wt-V15.zip` — frozen (232 checks)
- `C:\Users\Sourav\ML Coding\watch-together-versions\V14-longrun\` + `wt-V14.zip` — frozen (208 checks)
- `C:\Users\Sourav\ML Coding\watch-together-versions\V13-lowlatency\` + `wt-V13.zip` — frozen (198 checks)
- `C:\Users\Sourav\ML Coding\watch-together-versions\V12-remote-audio\` + `wt-V12.zip` — frozen (192 checks)
- `C:\Users\Sourav\ML Coding\watch-together-versions\V11-hist-voice\` + `wt-V11.zip` — frozen (175 checks)
- `C:\Users\Sourav\ML Coding\watch-together-versions\V10-dropfix-nc\` + `wt-V10.zip` — frozen (136 checks)

## Next Move (when resumed)
Nothing pending. Any new feature request → create `V18-*` folder, port from V17, bump manifest+EXT_VER together, extend test suite, zip as wt-V18.zip.
