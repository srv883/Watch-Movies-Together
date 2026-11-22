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

## iPhone (Safari)
The same Watch Together runs on iPhone in Safari through the free **Userscripts** app, and joins the same parties as the Chrome extension (sync, chat, voice, reactions, trivia).
1. Install **Userscripts** from the App Store (free, by Justin Wasack) and open it once.
2. iPhone **Settings → Apps → Safari → Extensions → Userscripts**: turn it on and set **All Websites → Allow**.
3. In Safari open [watch-together.user.js](https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/ios/watch-together.user.js), tap the **aA / puzzle** button in the address bar → **Userscripts** → **Install**.
4. Open **hotstar.com** in **Safari itself** (not a Home Screen icon) and start the film or episode. A slim Watch Together bar sits on the left edge: tap the **logo** for Start / Join / Leave, **💬** for chat, **🎤** for your mic, **😀** for a quick reaction, **⛶** to fill the screen with chat and trivia on top (swipe up once to hide Safari's bar), **📺** for Apple's edge-to-edge full screen (also what Hotstar's own full-screen button does; sync and voice keep going, chat shows again when you leave it). Drag the little handle on top of the bar to move it.

Tips: turn on English subtitles for trivia; tap the screen once if your friend's voice doesn't start. Netflix and Prime Video don't play in phone browsers (they push their apps), so on iPhone this is for JioHotstar. If JioHotstar only offers its app, try Safari's **aA → Request Desktop Website**.
New iPhone versions show an **Update** button in the panel. Build it with `node tools/make-userscript.js V<N>-name "notes"` (→ `ios/`), then commit and push.

## Publishing updates
- **New version:** make the next `V<N>-name` folder, bump `manifest.json` + `EXT_VER`, test, then
  `node tools/release.js V<N>-name "what's new"` - zips it, updates `latest.json` + `wt-latest.zip`, commits and pushes. Installed copies update themselves.
- **New trivia:** add or edit a pack in `trivia/` (listed in `trivia/index.json`) and push - every extension picks it up within 6 hours, no new version needed.

## Trivia
Trivia cards pop up the moment the line of dialogue they are about appears in the subtitles (turn on English subtitles). Sources: the hand-written packs in `trivia/` (each fact has a `cue` line), or Claude if a Claude API key is saved in the popup.
