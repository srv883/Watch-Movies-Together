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
