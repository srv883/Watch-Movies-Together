# Chrome Web Store – everything you need to publish

Files in this folder:
- `watch-together-1.35.0-chrome-web-store.zip` – the package to upload
- `store-shot-1-trivia.png`, `store-shot-2-follow.png`, `store-shot-3-chat.png` – screenshots (1280×800)
- `promo-tile-440x280.png` – small promo tile
- `icon-src/icon128.png` – store icon (also inside the zip)

## Steps (about 15 minutes, then a few days of review)
1. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account you want to publish under.
2. Register as a developer: accept the agreement and pay the one-time $5 fee (Google asks for this; it's yours to do).
3. **Add new item** → upload `watch-together-1.35.0-chrome-web-store.zip`.
4. **Store listing** tab: paste the texts below, upload the icon, the 3 screenshots and the promo tile. Category: *Social & Communication*. Language: English.
5. **Privacy** tab: paste the single-purpose text and the permission justifications below, tick the data boxes listed below, and set the privacy policy URL:
   `https://github.com/srv883/Watch-Movies-Together/blob/main/PRIVACY.md`
6. **Distribution** tab: Visibility **Unlisted** (only people with the link can install). Regions: all.
7. **Submit for review.** When approved you get a link like `https://chromewebstore.google.com/detail/<id>` – send that to friends and family: one click on "Add to Chrome" and it's installed, and Chrome keeps it updated.
8. Later versions: build the next folder as usual, then `node tools/make-store-zip.js V<N>-name` and upload the new zip on the item's **Package** tab → Submit.

Mixing installs is fine: a store copy (1.35.0) and your and Megha's GitHub copies (1.34.0) join the same party, sync, chat and talk normally (tested). The chat will just note that the versions differ.

Your and Megha's installs are NOT changed by any of this: GitHub's `latest.json` stays at 1.34.0, so the updater and the popup offer nothing new.

## Name
Watch Together

## Summary (max 132 characters – this is the manifest description)
Watch Netflix, JioHotstar, Prime Video, JioTV and JioCinema together in sync with a friend, with live AI scene trivia.

## Description
Watch a show or film with someone far away as if you were on the same sofa.

▶ PERFECT SYNC
Play, pause, seek and speed changes happen on both screens at once. If one of you buffers, the other waits, and you continue together from the same moment.

⏭ THE NEXT EPISODE, TOGETHER
When one of you moves to the next episode, the other follows automatically (with a 5-second "Stay here" option). Joining a party takes you straight to the episode your friend is on.

🎙 VOICE AND CHAT
A built-in voice call with echo and noise cancellation – the movie lowers its volume while your friend talks. Chat, floating messages and emoji reactions on top of the video, even in full screen.

🧠 SCENE TRIVIA
Behind-the-scenes facts float in at the matching moments: hand-written packs for The Office, Game of Thrones, Breaking Bad and the Marvel films, Wikipedia facts for everything else. Optionally add your own Claude API key for trivia written for any title.

🔒 PRIVATE BY DESIGN
No accounts, no ads, no tracking. Everything goes directly between your two browsers over an encrypted peer-to-peer connection.

HOW TO USE
1. Open the same episode on a supported site.
2. Click the Watch Together icon → Start Watch Party, and send your friend the 6-letter code.
3. Your friend clicks the icon → enters the code → Join. That's it.

Supported sites: Netflix, JioHotstar (Disney+ Hotstar), Prime Video, JioTV, JioCinema. Each person needs their own subscription to the streaming service.

Watch Together is an independent project and is not affiliated with Netflix, JioHotstar, Amazon, JioTV or JioCinema.

## Single purpose (Privacy tab)
Lets two people watch the same video on supported streaming sites in sync, with chat, voice and trivia shown on top of the video.

## Permission justifications (Privacy tab)
- **storage** – saves the user's display name, current party code, settings, recent party chat, watch history and cached trivia locally.
- **tabs** – the popup reads the address of the active tab to show which supported site it is on, and opens a supported site in a new tab when the user picks one.
- **Host permission api.anthropic.com** – only used when the user adds their own Claude API key in the popup, to generate scene trivia for the title they are watching.
- **Host permission raw.githubusercontent.com** – downloads the extension's trivia packs (JSON files) from the project's GitHub repository.
- **Host permission en.wikipedia.org** – looks up trivia for titles that have no trivia pack.
- **Content scripts on netflix.com, hotstar.com, jiohotstar.com, primevideo.com, jiotv.com, jiocinema.com** – needed to read and control the video player (play/pause/seek) for syncing and to show the chat/trivia overlay. They run on no other sites.
- **Remote code:** No. All code is in the package; trivia packs are plain JSON data.

## Data usage (Privacy tab checkboxes)
Tick these data types as collected/transmitted:
- **Personal communications** – chat messages and the voice call (sent only to the friend in the party, peer-to-peer).
- **Website content** – the title/address of the episode being watched (sent to the friend for "follow", and to Wikipedia / Anthropic to look up trivia).
- **Authentication information** – only the user's own Claude API key, if they add one (sent only to Anthropic).
Leave unticked: personally identifiable information, health, financial, location, web history, user activity.
Then tick all three certifications: not sold to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending.
