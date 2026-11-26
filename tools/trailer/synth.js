// Synth for the trailer soundtracks (audio.js, timelapse.js): drums, bass, pads and effects made from oscillators and noise,
// so there is no third-party music or samples to license. Moved out of audio.js unchanged.
const fs = require('fs');

const SR = 44100;

/** A stereo mix `seconds` long: the instruments place sounds at a time (s), write() masters it to a 16-bit WAV and returns the peak before normalising. */
function mix(seconds) {
  const N = Math.ceil(seconds * SR), L = new Float32Array(N), R = new Float32Array(N);
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  const TAU = Math.PI * 2;
  // render a voice: fn(t, i) returns a sample for t seconds after t0
  function voice(t0, dur, gain, pan, fn) {
    const a = Math.max(0, Math.floor(t0 * SR)), b = Math.min(N, Math.floor((t0 + dur) * SR)), gl = gain * Math.min(1, 1 - pan), gr = gain * Math.min(1, 1 + pan);
    for (let i = a; i < b; i++) { const s = fn((i - a) / SR, i - a); L[i] += s * gl; R[i] += s * gr; }
  }
  const lp = cutoff => { let y = 0; const k = 1 - Math.exp(-TAU * cutoff / SR); return x => (y += (x - y) * k); };
  const saw = ph => 2 * (ph - Math.floor(ph + 0.5));
  const sq = ph => (ph - Math.floor(ph)) < 0.5 ? 1 : -1;

  const kick = (t, g = 1) => { let ph = 0; voice(t, 0.32, 0.9 * g, 0, x => { ph += (46 + 110 * Math.exp(-x * 34)) / SR; return Math.sin(TAU * ph) * Math.exp(-x * 11); }); };
  const snare = (t, g = 1) => { const f = lp(1800); voice(t, 0.2, 0.42 * g, 0.05, x => { const n = rnd(); return (n - f(n)) * Math.exp(-x * 26) + Math.sin(TAU * 185 * x) * Math.exp(-x * 40) * 0.5; }); };
  const hat = (t, g = 1, open = false) => { const f = lp(6500); voice(t, open ? 0.16 : 0.05, 0.16 * g, 0.3, x => { const n = rnd(); return (n - f(n)) * Math.exp(-x * (open ? 22 : 90)); }); };
  const bass = (t, dur, hz, g = 1) => { const f = lp(320); let ph = 0; voice(t, dur, 0.34 * g, 0, x => { ph += hz / SR; return f(saw(ph) * 0.7 + sq(ph * 0.5) * 0.3) * Math.min(1, x * 400) * Math.exp(-x * 5) * Math.min(1, (dur - x) * 200); }); };
  const pluck = (t, hz, g = 1, pan = 0) => { const f = lp(2400); let ph = 0; voice(t, 0.24, 0.11 * g, pan, x => { ph += hz / SR; return f(sq(ph) * 0.5 + saw(ph * 1.003) * 0.5) * Math.min(1, x * 600) * Math.exp(-x * 16); }); };
  const pad = (t, dur, freqs, g = 1, attack = 1.5, release = 1) => { for (const [j, hz] of freqs.entries()) for (const det of [-0.0025, 0.0025]) {
    const f = hz * (1 + det), trem = 0.13 + j * 0.05; voice(t, dur, 0.05 * g, det > 0 ? 0.35 : -0.35, x => Math.sin(TAU * f * x) * Math.min(1, x / attack) * Math.min(1, (dur - x) / release) * (0.8 + 0.2 * Math.sin(TAU * trem * x))); } };
  const impact = (t, g = 1) => { let ph = 0; const f = lp(700); voice(t, 1.6, 0.85 * g, 0, x => { ph += (34 + 30 * Math.exp(-x * 9)) / SR; return Math.sin(TAU * ph) * Math.exp(-x * 3.2) + f(rnd()) * Math.exp(-x * 7) * 0.7; }); };
  const riser = (t, dur, g = 1) => { let y = 0; voice(t, dur, 0.2 * g, 0, x => { const k = x / dur, n = rnd(); y += (n - y) * (0.02 + 0.5 * k * k); return (n - y * (1 - k)) * k * k; }); };
  const sweep = (t, dur, f0, f1, g = 1) => { let ph = 0; voice(t, dur, 0.3 * g, 0, x => { const k = x / dur; ph += (f0 * Math.pow(f1 / f0, k)) / SR; return Math.sin(TAU * ph) * (1 - k) * Math.min(1, x * 200); }); };
  const brass = (t, dur, hz, g = 1, vib = 0, fall = 0) => { const f = lp(950); let ph = 0; voice(t, dur, 0.26 * g, -0.1, x => { const k = x / dur; ph += hz * (1 + vib * Math.sin(TAU * 5.5 * x) * k) * (1 - fall * k * k) / SR;
    return f(saw(ph)) * Math.min(1, x * 40) * Math.min(1, (dur - x) * 14); }); };
  const stab = (t, freqs, g = 1) => { for (const hz of freqs) { const f = lp(1700); let ph = 0; voice(t, 0.16, 0.07 * g, 0.2, x => { ph += hz / SR; return f(sq(ph)) * Math.min(1, x * 500) * Math.exp(-x * 20); }); } };
  const scratch = (t, dur, g = 1) => { const f = lp(3200); voice(t, dur, 0.13 * g, 0.1, x => { const n = rnd(); return (n - f(n)) * Math.pow(Math.abs(Math.sin(TAU * 6.5 * x)), 3) * Math.min(1, (dur - x) * 30); }); };
  const ding = (t, g = 1) => { for (const hz of [880, 1108.73, 1318.5]) voice(t, 1.4, 0.07 * g, 0.2, x => Math.sin(TAU * hz * x) * Math.exp(-x * 3.4) * Math.min(1, x * 300)); };
  const siren = (t, dur, g = 1) => { let ph = 0; const f = lp(1400); voice(t, dur, 0.1 * g, -0.25, x => { ph += (760 + 190 * Math.sin(TAU * 1.1 * x)) / SR; return f(saw(ph) * 0.5 + Math.sin(TAU * ph)) * Math.min(1, x / dur * 1.6) * Math.min(1, (dur - x) * 40); }); };

  const BEAT = 0.5, A = 55;
  const CH = [   // [bass root, arpeggio notes] per bar: Am, Am, F, G, Am, E
    [A, [440, 523.25, 659.25, 523.25]], [A, [440, 523.25, 659.25, 880]], [43.65, [440, 523.25, 698.46, 523.25]],
    [49, [392, 493.88, 587.33, 493.88]], [A, [440, 523.25, 659.25, 523.25]], [41.2, [415.3, 493.88, 659.25, 493.88]]];
  // full groove from t0 for a number of beats, skipping anything that starts inside a muted span
  function groove(t0, beats, muted = [], g = 1) {
    const off = t => muted.some(([a, b]) => t >= a - 1e-6 && t < b - 1e-6);
    for (let b = 0; b < beats; b++) { const t = t0 + b * BEAT, [root, arp] = CH[Math.floor(b / 4) % CH.length];
      if (off(t)) continue;
      kick(t, g); if (b % 2) snare(t, g);
      for (let e = 0; e < 2; e++) { const te = t + e * BEAT / 2; hat(te, e ? 1 : 0.6, e === 1 && b % 4 === 3); bass(te, BEAT / 2 - 0.01, root * (e ? 2 : 1), g); }
      for (let s = 0; s < 4; s++) pluck(t + s * BEAT / 4, arp[(b * 4 + s) % 4] * (s === 3 && b % 2 ? 2 : 1), g * (s % 2 ? 0.7 : 1), s % 2 ? 0.45 : -0.45); }
  }

  function write(file) {
    // master: soft clip, normalise, short fades
    let peak = 0; for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 1.15); R[i] = Math.tanh(R[i] * 1.15); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
    const norm = 0.89 / (peak || 1), fade = Math.floor(0.5 * SR);
    const out = Buffer.alloc(44 + N * 4);
    out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
    out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(N * 4, 40);
    for (let i = 0; i < N; i++) { const g = norm * Math.min(1, i / 400, (N - i) / fade);
      out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), 44 + i * 4); out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), 46 + i * 4); }
    fs.writeFileSync(file, out);
    return peak;
  }
  return { BEAT, kick, snare, hat, bass, pluck, pad, impact, riser, sweep, brass, stab, scratch, ding, siren, groove, write };
}

module.exports = { mix };
