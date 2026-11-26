// Synthesises the teaser's soundtrack to .work/audio.wav with the instruments in synth.js. Cues are timed from the shot list and .work/meta.json.
const fs = require('fs');
const path = require('path');
const shots = require('./shots');
const { mix } = require('./synth');
const WORK = path.join(__dirname, '.work');
const meta = JSON.parse(fs.readFileSync(path.join(WORK, 'meta.json'), 'utf8'));

const FPS = 30;
const at = {}; let total = 0;
for (const s of shots) { at[s.name] = total / FPS; total += s.n; }
const END = total / FPS;
const ev = (shot, key, fallback) => at[shot] + ((meta[shot] && meta[shot][key] != null ? meta[shot][key] : fallback) / FPS);

const { BEAT, kick, snare, hat, bass, pad, impact, riser, sweep, brass, stab, scratch, ding, siren, groove, write } = mix(END);

// --- A. open, aerial, Torget: a quiet drone, with a tick creeping in as the Volvo comes into view
const tSteal = ev('04_steal', '_', 22);
pad(0, tSteal + 0.2, [110, 164.81, 220, 261.63], 1, 2.5, 0.25);
pad(at['02_aerial'], tSteal + 0.2 - at['02_aerial'], [329.63, 493.88], 0.5, 3, 0.25);
for (let t = at['03_torget']; t < tSteal - 0.05; t += BEAT / 2) hat(t, 0.25 + 0.6 * (t - at['03_torget']) / (tSteal - at['03_torget']));

// --- B. the theft: a hit, then the pulse builds into the chase
impact(tSteal, 1);
const tChase = at['05_chase_front'];
for (let t = Math.ceil((tSteal + 0.3) / (BEAT / 2)) * (BEAT / 2), n = 0; t < tChase - 1e-6; t += BEAT / 2, n++) { const k = (t - tSteal) / (tChase - tSteal);
  bass(t, BEAT / 2 - 0.01, n % 2 ? 110 : 55, 0.35 + 0.65 * k); if (k > 0.3 && Math.abs(t / BEAT - Math.round(t / BEAT)) < 1e-6) kick(t, 0.5 + 0.5 * k); hat(t, 0.5 + 0.5 * k); }
riser(tChase - 2, 2, 1);
for (let s = 0; s < 4; s++) snare(tChase - 0.5 + s * 0.125, 0.5 + s * 0.15);

// --- C. the chase: full groove, dropping out under each title card
const tEpa = at['12_epa'], cards = ['06_card', '08_card', '10_card'].map(c => [at[c], at[c] + 1]);
groove(tChase, Math.round((tEpa - tChase) / BEAT), cards);
for (const [a, b] of cards) { impact(a, 0.8); riser(b - 0.5, 0.5, 0.7); }

// --- D. EPA-traktor: the music gives up and an oom-pah takes over at walking pace
sweep(tEpa, 0.45, 520, 55, 1);
for (let b = 1; b < 8; b++) { const t = tEpa + b * BEAT; if (b % 2) brass(t, 0.36, b % 4 === 1 ? 110 : 82.41, 1.1); else stab(t, [220, 277.18, 329.63], 1.3); }

// --- E. trisslott: scratching, then the sound of losing
const tScr = ev('13_triss', '_', 10), tRes = at['13_triss'] + ((meta['13_triss'] && meta['13_triss'].toasts && meta['13_triss'].toasts[1] ? meta['13_triss'].toasts[1][0] : 36) / FPS);
scratch(tScr, tRes - tScr, 1);
[[233.08, 0.4], [220, 0.4], [207.65, 0.4], [196, 1.3]].reduce((t, [hz, d], j) => { brass(t, d - 0.03, hz, 1, j === 3 ? 0.012 : 0, j === 3 ? 0.06 : 0); return t + d; }, tRes + 0.1);

// --- F. safehouse: heartbeat while lying low, a bell when the police give up
const tSafe = at['14_safe'], tClear = ev('14_safe', 'cleared', 119);
pad(tSafe, tClear - tSafe + 0.3, [110, 164.81, 207.65], 0.8, 1, 0.3);
for (let t = tSafe + 0.25; t < tClear - 0.3; t += 1) { kick(t, 0.5); kick(t + 0.2, 0.36); }
ding(tClear, 1);

// --- G. Gripen: sirens close in, then the bust
const tGrip = at['15_gripen'], tBust = ev('15_gripen', 'busted', 44);
siren(tGrip, tBust - tGrip, 1);
for (let t = tGrip, n = 0; t < tBust - 0.05; t += BEAT / 2, n++) { kick(t, 0.6 + 0.3 * (t - tGrip) / (tBust - tGrip)); hat(t + BEAT / 4, 0.8); }
impact(tBust, 1.1); sweep(tBust, 0.9, 620, 70, 0.8);

// --- H. title: the theme comes back for two bars and rings out
const tTitle = at['16_title'];
impact(tTitle, 1); groove(tTitle, 8); impact(tTitle + 4, 0.9);
pad(tTitle, END - tTitle, [110, 164.81, 220, 261.63, 329.63], 1.2, 0.4, 1.8);

const peak = write(path.join(WORK, 'audio.wav'));
console.log('audio.wav', END.toFixed(1) + 's', 'peak before normalise', peak.toFixed(2));
