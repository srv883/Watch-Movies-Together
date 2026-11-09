// builds the fake-mic WAVs: speech at a target active level + room noise,
// with a 4 s silent (noise-only) tail so pauses / pumping can be measured
const path = require("path");
const W = require("./wav");
const dir = __dirname;

function build(src, out, speechDbfs, noiseDbfs, seed) {
  const { sr, x } = W.readWav(path.join(dir, src));
  const lvl = W.activeLevel(x, sr);
  const g = Math.pow(10, speechDbfs / 20) / lvl.rms;
  const tail = sr * 4, n = x.length + tail;
  const y = new Float32Array(n);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
  if (noiseDbfs != null) {
    const nz = W.noise(n, Math.pow(10, noiseDbfs / 20), seed);
    for (let i = 0; i < n; i++) y[i] += nz[i];
  }
  W.writeWav(path.join(dir, out), y, sr);
  const chk = W.activeLevel(y, sr);
  console.log(out, "speech", speechDbfs, "dBFS noise", noiseDbfs, "-> measured active", chk.dbfs.toFixed(1), "len", (n / sr).toFixed(1) + "s");
}

build("host_raw.wav", "host.wav", -20, -70, 3);
build("guest_raw.wav", "guest_normal.wav", -20, -70, 5);
build("guest_raw.wav", "guest_quiet.wav", -38, -72, 7);
build("guest_raw.wav", "guest_vquiet.wav", -48, -75, 9);
// noise only (mic open, friend silent): pink noise at -58 dBFS
{
  const sr = 48000, n = sr * 20;
  W.writeWav(path.join(dir, "guest_noise.wav"), W.noise(n, Math.pow(10, -58 / 20), 11), sr);
  console.log("guest_noise.wav noise -58 dBFS");
}
