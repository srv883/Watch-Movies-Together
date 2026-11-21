# Watch-Movies-Together
A free P2P chrome extension to watch any tv shows, or movies together in any streaming platform

## Install (Windows) - updates itself from then on
In PowerShell:

```
irm https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/tools/install-watch-together.ps1 | iex
```

Then, once: Chrome -> `chrome://extensions` -> Developer mode -> **Load unpacked** -> the folder it prints.
A hidden updater (started with Windows from your Startup folder) checks this repo every 30 minutes; the extension reloads itself into a new version as soon as no watch party is running.

Manual install instead: [wt-latest.zip](https://github.com/srv883/Watch-Movies-Together/raw/main/wt-latest.zip) (unzip -> Load unpacked; remove the old one first).

## Publishing updates
- **New version:** make the next `V<N>-name` folder, bump `manifest.json` + `EXT_VER`, test, then
  `node tools/release.js V<N>-name "what's new"` - zips it, updates `latest.json` + `wt-latest.zip`, commits and pushes. Installed copies update themselves.
- **New trivia:** add or edit a pack in `trivia/` (listed in `trivia/index.json`) and push - every extension picks it up within 6 hours, no new version needed.

## Trivia
Trivia cards pop up the moment the line of dialogue they are about appears in the subtitles (turn on English subtitles). Sources: the hand-written packs in `trivia/` (each fact has a `cue` line), or Claude if a Claude API key is saved in the popup.
