# Watch Together – Privacy Policy

_Last updated: 20 November 2026_

Watch Together is a browser extension that lets two people watch the same video on a supported streaming site (Netflix, JioHotstar, Prime Video, JioTV, JioCinema) in sync, with chat, emoji reactions, an optional voice call and scene trivia. It has no accounts, no analytics, no ads, and the developer runs no server that receives your data.

## What stays on your computer
Stored only in your browser's extension storage: the display name you type, the current party code, your settings (voice volume, noise cancellation, theme, panel position), your watch history list, the recent chat of a party, cached trivia, and — only if you add one — your Claude API key. Uninstalling the extension deletes all of it.

## What is sent, to whom, and why
- **Your friend (peer-to-peer):** your display name, chat messages, reactions, playback state (play/pause/position/speed), the address of the episode page you are watching (so they can follow you to the next episode), and — only while you turn the microphone on — your voice. This travels directly between the two browsers over an encrypted WebRTC connection.
- **Connection helpers (to set up that connection):** the free PeerJS cloud service (0.peerjs.com) introduces the two browsers to each other; Google's public STUN server helps find a route; if a direct route is impossible, PeerJS's TURN relays forward the encrypted connection. If the PeerJS service is unreachable, the extension falls back to public MQTT relays (broker.emqx.io, test.mosquitto.org, broker.hivemq.com); everything sent through them is encrypted with a key derived from your party code, so the relays cannot read it. These services see your IP address, as any internet service does.
- **Trivia packs:** the extension downloads trivia files from this project's GitHub repository (raw.githubusercontent.com). Nothing about you or what you watch is sent – it simply downloads the published files.
- **Subtitles:** to pop a trivia card up on the right line, the extension reads the subtitle text shown on the page. That text is only compared with the trivia pack in your browser; it is never stored or sent anywhere.
- **Anthropic (api.anthropic.com) – only if you add your own Claude API key:** the title information of what you are watching (page title, words from the page address, the video's length) is sent with your key to generate trivia. Anthropic's own privacy policy applies to that request. Without a key, nothing is ever sent to Anthropic.
- **iPhone version:** the same code running in Safari through the free Userscripts app. It sends exactly the same things to the same places as above; its settings are kept in the Userscripts app on the phone, and it checks this repository for a newer iPhone version (`ios/latest.json`).
- **Update check (manual installs only):** copies installed from GitHub check this repository's `latest.json` for new versions. Copies installed from the Chrome Web Store are updated by Chrome and do not do this.

## What we never do
No selling or sharing of data, no advertising, no tracking or analytics, no access to your streaming account, no reading of pages other than the supported streaming sites.

## Microphone
The microphone is used only for the voice call, only after you press the microphone button, and Chrome asks for your permission first. Audio goes only to your friend.

## Children
The extension is not directed at children under 13.

## Contact
Questions: open an issue at https://github.com/srv883/Watch-Movies-Together/issues
