# Watch-Movies-Together
A free P2P watch party for JioHotstar, Netflix, Prime Video, JioTV and JioCinema: playback in sync, chat, voice, reactions and scene trivia. Works across devices - one of you on a laptop, the other on a phone is fine.

## Watch together across devices
- Start a party on any device, then **Copy invite** (laptop) or **Share invite** (phone). The invite is a link to the episode you're on.
- Your friend opens that link where Watch Together is installed - laptop, iPhone or Android - and joins the party by itself. No code to type (the code is in the invite too, for **Join Party**).
- Phones: Netflix and Prime Video don't play in phone browsers (they push their apps), so phones are for **JioHotstar**.

## Install
### Laptop (Windows, Chrome) - updates itself from then on
In PowerShell:

```
irm https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/tools/install-watch-together.ps1 | iex
```

Then, once: Chrome -> `chrome://extensions` -> Developer mode -> **Load unpacked** -> the folder it prints.
A hidden updater (started with Windows from your Startup folder) checks this repo every 10 minutes and keeps itself up to date; the extension switches to a new version by itself as soon as no video or party is running (or right away with **Switch now** in the popup). Nothing to download, ever.

Manual install instead: [wt-latest.zip](https://github.com/srv883/Watch-Movies-Together/raw/main/wt-latest.zip) (unzip -> Load unpacked; remove the old one first).

### iPhone (Safari)
1. Install **Userscripts** from the App Store (free, by Justin Wasack) and open it once.
2. iPhone **Settings → Apps → Safari → Extensions → Userscripts**: turn it on and set **All Websites → Allow**.
3. In Safari open [watch-together.user.js](https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/ios/watch-together.user.js), tap the **aA / puzzle** button in the address bar → **Userscripts** → **Install**. (Or **⋯ → Share → Save to Files → On My iPhone → Userscripts**.)
4. Open **hotstar.com** in **Safari itself** (not a Home Screen icon). Invite links must open in Safari too (if they open in another browser, copy them into Safari).

### Android (Firefox)
Chrome on Android can't run add-ons; Firefox can.
1. Install **Firefox** from the Play Store, then in Firefox: **⋮ → Add-ons → Tampermonkey** (or **Violentmonkey**) → **Add**.
2. In Firefox open [watch-together.user.js](https://raw.githubusercontent.com/srv883/Watch-Movies-Together/main/ios/watch-together.user.js) → Tampermonkey shows its install page → **Install**.
3. Open **hotstar.com** in Firefox (invite links too - if they open in Chrome, copy them into Firefox). If Hotstar only offers its app, use **⋮ → Desktop site**.

### On a phone
A slim Watch Together bar sits on the left edge: the **logo** for Start / Join / Leave and the invite, **💬** chat, **🎤** your mic, **😀** a quick reaction, **⛶** full screen with chat and trivia on top (iPhone: swipe up once to hide Safari's bar; Android: real full screen), **📺** the phone's own full-screen player (edge to edge; sync and voice keep going, chat shows again when you leave it). Drag the little handle on top of the bar to move it.
Tips: turn on English subtitles for trivia; earphones work best for voice; tap the screen once if your friend's voice doesn't start. Phones update themselves: the script fetches new versions from this repo (checked against a SHA-256) and uses them from the next time you open Hotstar - or right away with **Switch now** in the panel. Install it once; never again.

## Publishing updates
- **New version:** make the next `V<N>-name` folder, bump `manifest.json` + `EXT_VER`, test, then
  `node tools/release.js V<N>-name "what's new"` - zips it, updates `latest.json` + `wt-latest.zip`, commits and pushes. Installed copies update themselves.
- **Phone build:** `node tools/make-userscript.js V<N>-name "notes"` (→ `ios/watch-together.user.js`, `ios/wt-phone.js`, `ios/latest.json` with its SHA-256; `--version X.Y.Z` for a phone-only fix), then commit and push - installed phones pick it up by themselves.
- **New trivia:** add or edit a pack in `trivia/` (listed in `trivia/index.json`) and push - every extension picks it up within 6 hours, no new version needed.

## Trivia
Trivia cards pop up the moment the line of dialogue they are about appears in the subtitles (turn on English subtitles). Sources: the hand-written packs in `trivia/` (each fact has a `cue` line), or Claude if a Claude API key is saved in the popup.
