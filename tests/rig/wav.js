// tiny WAV + DSP helpers for the voice rig (mono 16-bit PCM, 48 kHz)
const fs = require("fs");

function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4), len = b.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === "data") data = b.subarray(p + 8, p + 8 + len);
    p += 8 + len + (len & 1);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error("unsupported wav " + file);
  const n = Math.floor(data.length / 2 / fmt.ch), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2 * fmt.ch) / 32768;
  return { sr: fmt.sr, x: out };
}

function writeWav(file, x, sr) {
  const n = x.length, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, b);
}

const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));

// active speech level: RMS over 20 ms frames within 30 dB of the loudest frames
function activeLevel(x, sr) {
  const f = Math.round(sr * 0.02), r = [];
  for (let i = 0; i + f <= x.length; i += f) {
    let s = 0; for (let j = i; j < i + f; j++) s += x[j] * x[j];
    r.push(Math.sqrt(s / f));
  }
  const sorted = r.slice().sort((a, b) => b - a);
  const ref = sorted[Math.floor(sorted.length * 0.05)] || 0;
  const act = r.filter(v => v > ref * 0.0316 && v > 1e-5);
  const rms = act.length ? Math.sqrt(act.reduce((a, v) => a + v * v, 0) / act.length) : 0;
  return { rms, dbfs: db(rms), activeFrac: act.length / Math.max(1, r.length), frames: r };
}

// deterministic pink-ish noise
function noise(n, rms, seed = 1) {
  let s = seed, b0 = 0, b1 = 0, b2 = 0; const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const w = (s / 4294967296) * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
    y[i] = b0 + b1 + b2 + w * 0.1848;
  }
  let e = 0; for (const v of y) e += v * v; const k = rms / Math.sqrt(e / n);
  for (let i = 0; i < n; i++) y[i] *= k;
  return y;
}

module.exports = { readWav, writeWav, activeLevel, noise, db };
