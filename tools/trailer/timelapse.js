// Renders media/timelapse.mp4: how the game grew, release by release (git tags v*, see versions.js), then today's checkout.
// Each version gets a title card and the same police chase out of Torget in the same red Volvo, cut fast between cameras,
// with the game's own camera and HUD in each cut list so you see each version as players did. A release that won't run is skipped.
// Usage: node timelapse.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { open, modelsReady, WORK, ROOT } = require('./rig');
const { releases, prepare } = require('./versions');
const { mix } = require('./synth');

const FPS = 30; // every length below is a multiple of 15 frames, so cuts land on the beat (120 BPM)
const OPEN_F = 60, CARD_F = 30, TITLE_F = 90;
const WARM_STEPS = 230; // frames the chase runs before the first cut: the same moment of the same route in every version
// [frames, camera] per cut; 'game' is the game's own camera and HUD, 'back' the same looking back at the police
const RELEASE_CUTS = [[30, 'game'], [15, 'front'], [15, 'side'], [30, 'drone']];
const TODAY_CUTS = [[30, 'game'], [15, 'front'], [15, 'side'], [15, 'drone'], [15, 'low'], [30, 'back'], [15, 'front'], [15, 'side'], [30, 'drone'], [30, 'game']];
const FRAMES = path.join(WORK, 'timelapse'), OUT = path.join(ROOT, 'media', 'timelapse.mp4');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = iso => { const [y, m, d] = iso.split('-').map(Number); return d + ' ' + MONTHS[m - 1] + ' ' + y; };

// runs in the page once, after the rig's inpage.js: the version label in the top letterbox bar, and the cameras
function setupPage() {
  const G = __G, X = __X, fov0 = G.camera.fov;
  const css = document.createElement('style');
  css.textContent = `#tl { position: absolute; left: 0; right: 0; top: 0; height: 9.5%; z-index: 55; display: flex; align-items: center; justify-content: space-between; padding: 0 3.5%;
    font-family: "Barlow Condensed", "Arial Narrow", sans-serif; font-weight: 700; font-size: 30px; letter-spacing: .08em; text-transform: uppercase; color: #f4f1e6; pointer-events: none; }
    #tl small { font: 500 17px "Barlow", sans-serif; letter-spacing: .22em; color: #f2c230; }`;
  document.head.appendChild(css);
  const tl = document.createElement('div'); tl.id = 'tl'; document.getElementById('stage').appendChild(tl);
  X.label = (name, when) => { tl.innerHTML = name ? `<span>${name}</span><small>${when}</small>` : ''; };
  const cine = (fov, rig) => { X.mode('cine'); X.fov(fov); X.setCam(rig); };
  const game = look => { X.mode('play'); X.fov(fov0); X.setCam(null); G.lookOff = look; };
  X.cams = {
    game: () => game(0), back: () => game(2.62),
    front: () => cine(60, X.rigFront(6.5, 1.9, 0.8, 8, 0.9)), low: () => cine(50, X.rigFront(10.5, 2.0, 1.5, 9, 0, -2.6)),
    side: () => cine(62, X.rigSide(5.5, 3.5, 0.75)), drone: () => cine(50, X.rigDrone(20, 13, 8, 10)),
  };
}

let frame = 0;
const marks = { cards: [], chases: [] };
async function shoot(page, fn, n, arg) {
  for (let i = 0; i < n; i++) {
    await page.evaluate(new Function('i', 'n', 'a', `(${fn})(i, n, a); __step(1);`), i, n, arg);
    await page.screenshot({ path: path.join(FRAMES, String(frame++).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 93, optimizeForSpeed: true });
  }
}
const card = (i, n, html) => { const X = __X; X.mode('cine'); X.fade(1); X.card(html, X.io(i, 1, n - 1, 3)); };
const cut = (i, n, [cam, back]) => { const X = __X; if (i === 0) { X.fade(0); X.card(null, 0); X.cams[cam](); } X.k = i / (n - 1); if (back) __G.lookOff = 2.62 - 0.25 * X.k; };

// one version: open it, start the chase, then its card and its cuts; the first also opens the film and the last ends it
async function version(file, v, opts) {
  const { browser, page } = await open({ file });
  try {
    await page.evaluate(setupPage);
    await page.evaluate(`__X.chase('volvo', '#7a2530', ${WARM_STEPS}, [9, 15, 22], 33); __X.label(null);`);
    await modelsReady(page);
    if (opts.first) await shoot(page, card, OPEN_F, `<h1>Vrigstad <span>Joyride</span></h1><div class="rule"></div><p>Every release, from the first to today</p>`);
    marks.cards.push(frame);
    await shoot(page, card, CARD_F, `<p>${v.when}</p><h2>${v.name}</h2>`);
    await page.evaluate((name, when) => __X.label(name, when), v.name, v.when);
    marks.chases.push(frame);
    for (const [n, cam] of v.cuts) await shoot(page, cut, n, [cam, cam === 'back']);
    if (opts.last) {
      marks.title = frame;
      await page.evaluate(() => { __X.label(null); __X.mode('cine'); });
      await shoot(page, (i, n, html) => { const X = __X; X.fade(i < 12 ? X.lerp(0, 0.74, i / 12) : i > n - 24 ? X.lerp(0.74, 1, (i - (n - 24)) / 20) : 0.74); X.card(html, X.io(i, 10, n - 4, 10)); },
        TITLE_F, `<h1>Vrigstad <span>Joyride</span></h1><div class="rule"></div><p>${opts.summary}</p><div class="url">oliverromhagen.github.io/vrigstad-joyride</div>`);
    }
  } finally { await browser.close(); }
}

function soundtrack(file) {
  const t = f => f / FPS, end = t(frame), m = mix(end), { BEAT } = m;
  const first = t(marks.chases[0]), title = t(marks.title), today = marks.cards[marks.cards.length - 1];
  m.pad(0, first + 0.2, [110, 164.81, 220, 261.63], 1, 2.5, 0.25);
  m.riser(t(marks.cards[0]) - 1.5, 1.5, 0.8);
  // the groove runs from the first chase to the title, dropping out under each card with a hit going in and a riser coming out
  const cards = marks.cards.map(c => [t(c), t(c + CARD_F)]);
  m.groove(first, Math.round((title - first) / BEAT), cards);
  for (const [a, b] of cards) { m.impact(a, a === t(today) ? 1.1 : 0.8); m.riser(b - 0.5, 0.5, 0.7); }
  m.siren(t(marks.chases[marks.chases.length - 1]), title - t(marks.chases[marks.chases.length - 1]), 0.6);
  m.impact(title, 1); m.groove(title, 8); m.impact(title + 4, 0.9);
  m.pad(title, end - title, [110, 164.81, 220, 261.63, 329.63], 1.2, 0.4, 1.8);
  return m.write(file);
}

(async () => {
  fs.rmSync(FRAMES, { recursive: true, force: true }); fs.mkdirSync(FRAMES, { recursive: true });
  const rel = releases(), first = rel.length ? rel[0].date : null, today = new Date().toISOString().slice(0, 10);
  const list = rel.map(r => ({ name: r.tag, when: day(r.date), file: () => prepare(r.tag), cuts: RELEASE_CUTS }));
  list.push({ name: 'Today', when: day(today), file: () => null, cuts: TODAY_CUTS });   // null: the rig builds this checkout
  const days = first ? Math.round((Date.parse(today) - Date.parse(first)) / 864e5) : 0;
  const summary = `${rel.length} release${rel.length === 1 ? '' : 's'} · ${days} day${days === 1 ? '' : 's'}`;
  for (const [k, v] of list.entries()) {
    const t0 = Date.now(), from = frame, cards = marks.cards.length, chases = marks.chases.length;
    try { await version(v.file(), v, { first: frame === 0, last: k === list.length - 1, summary }); }
    catch (e) {
      if (k === list.length - 1) throw e;
      // drop what this version rendered, so the film goes straight on to the next one
      console.warn(v.name, 'skipped:', e.message.split('\n')[0]);
      for (let f = from; f < frame; f++) fs.rmSync(path.join(FRAMES, String(f).padStart(5, '0') + '.jpg'), { force: true });
      frame = from; marks.cards.length = cards; marks.chases.length = chases; continue;
    }
    console.log(v.name, frame - from, 'frames', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  const wav = path.join(WORK, 'timelapse.wav'), peak = soundtrack(wav);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(FRAMES, '%05d.jpg'), '-i', wav,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
  console.log(OUT, frame, 'frames', (frame / FPS).toFixed(1) + 's', (fs.statSync(OUT).size / 1e6).toFixed(1) + ' MB', 'audio peak', peak.toFixed(2));
})().catch(e => { console.error(e); process.exit(1); });
