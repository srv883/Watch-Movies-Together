# Real-Chrome voice rig

Two headless Chromes (temporary profiles) run the REAL `content.js` + PeerJS +
WebRTC over the internet. Each has a fake microphone fed from a WAV (Windows
TTS speech at a chosen level + room noise). The page records exactly what each
listener hears (everything the extension sends to the speakers) plus the raw
incoming stream, and `run.js` scores it against the source recording.

    powershell -File tests\rig\tts.ps1
    node tests\rig\make-variants.js          # also writes movie.wav? no - see below
    node tests\rig\matrix.js V28-clearvoice   # full scenario table
    node tests\rig\run.js --build V28-clearvoice --guest guest_quiet.wav --nc 0 --movie 1 --extra 1

`movie.wav` (pink noise) is created by: `node -e "const W=require('./tests/rig/wav');W.writeWav('tests/rig/movie.wav',W.noise(48000*30,0.1,21),48000)"`

Metrics: `speechDbfs` (active speech level heard), `envCorr` (envelope match
vs the source, 1 = perfect), `peak`/`clipSamples`, Opus kbps, jitter-buffer ms,
echo-cancellation state, auto-boost factor, movie volume while the friend talks
(`--movie 1`), and with `--extra 1` NC off/on, mic off/on and duck restore.
Options: `--gbuild` (guest on another build), `--nc 0|1`, `--long <s>`.
Generated files (wavs, prof-*, www, out-*, res-*) are git-ignored.

## End-to-end session test (`e2e.js`)

    node tests\rig\e2e.js --build V30-solidlink            # 24 checks, ~80 s
    node tests\rig\e2e.js --build V30-solidlink --gbuild V29-louder --only S2,S3,S5,S7

Needs `movie.wav` (60 s: `node -e "const W=require('./tests/rig/wav');W.writeWav('tests/rig/movie.wav',W.noise(48000*60,0.1,21),48000)"`)
plus host.wav / guest_normal.wav. Scenarios: S1 connect, S2 play/pause/seek/speed
sync both ways, S3 chat both ways, S4 two-way voice, S5 guest reload, S6 host
reload, S7 all P2P links killed (Wi-Fi blip), S8 PeerJS server dies mid-party
then link drops, S9 PeerJS server unreachable from the start (backup route),
S10 guest opens before host. Page hooks: `&block=1` (PeerJS server
unreachable), `&mic=1` (remembered mic ON), `__killLinks()`, `__killSignaling()`.

V31 adds (30 checks, ~3 min):
- **S11 follow the friend**: both tabs start on an "episode page"
  (`/<build>/shows/the-office/1001/night-out/2001/watch` is served as rig.html);
  the host changes episode the way Hotstar does (`history.pushState`), the
  guest must show the countdown banner, load the new episode by itself,
  reconnect, and still have the chat from before the page load. The rig keeps
  its query string and its storage stub in `sessionStorage`, like a real tab
  keeps chrome.storage.
- **S12 buffering**: `&stall=<id>&at=<s>` plays `stall.wav`, which the rig
  server delivers only up to `<s>` seconds of audio until `GET /__release?id=<id>`
  - a REAL stall (`readyState` 2, `waiting`). Range requests are honoured
  (without that Chrome restarts the download from 0 and the clip jumps back).
  Host stalls at 8 s, then guest at 22 s: the other side must pause with a
  "Waiting for …" banner, never rewind, and both must resume < 1 s apart.
  V30 on the same scenario: the healthy side played on and the stalled side
  then skipped ~14 s of the episode.
