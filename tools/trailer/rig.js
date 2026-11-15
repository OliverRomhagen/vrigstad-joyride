// Capture rig: drives a hooked copy of the built game in headless Chrome on a virtual clock,
// so every frame is rendered deterministically at 30 fps regardless of how fast the machine is.
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const WORK = path.join(__dirname, '.work');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Builds .work/index.html: the game with a window.__G handle on its internals and a per-frame camera hook,
// added to src/game/main.ts as Vite transforms it. The shipped game files are not modified.
async function buildCaptureCopy() {
  const { build } = await import('vite');
  const boot = 'resize(); requestAnimationFrame(frame);', render = 'renderer.render(scene, camera);\n}';
  const hook = `window.__G = { THREE, player, cars, police, keys, joy, R, D, hAt, camera, scene, action, addStar, toast, respawn, places, nearestRoad, TYPES, addCar, removeCar, clearWanted, sun, SUN_DIR, renderer, placeCar, nodes, nodeKey, driveable,
  get inCar() { return inCar; }, get pcar() { return pcar; }, get stars() { return stars; }, get camYaw() { return camYaw; }, set camYaw(v) { camYaw = v; }, set camPitch(v) { camPitch = v; },
  set hideT(v) { hideT = v; }, get hideT() { return hideT; }, set lookOff(v) { lookOff = v; lookIdle = 0; } };\n`;
  const hooks = { name: 'capture-hooks', enforce: 'pre', transform(src, id) {
    if (!id.endsWith('/src/game/main.ts')) return;
    if (src.split(boot).length !== 2 || src.split(render).length !== 2) throw new Error('src/game/main.ts no longer matches the capture hooks in rig.js');
    return src.replace(boot, hook + boot).replace(render, 'if (window.__cam) window.__cam(camera, T);\n  renderer.render(scene, camera);\n}');
  } };
  await build({ configFile: path.join(ROOT, 'vite.config.ts'), root: path.join(ROOT, 'src'), logLevel: 'warn', plugins: [hooks],
    build: { outDir: WORK, emptyOutDir: false, rollupOptions: { input: path.join(ROOT, 'src', 'index.html') } } });
  return path.join(WORK, 'index.html');
}

async function open({ width = 1280, height = 720, scale = 1.5 } = {}) {
  const file = await buildCaptureCopy();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', `--window-size=${width},${height}`] });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  page.on('pageerror', e => console.error('PAGE ERROR', e.message));
  await page.evaluateOnNewDocument(() => {
    // virtual clock: the game only advances when __step is called
    let vt = 1000, cbs = [];
    window.requestAnimationFrame = cb => { cbs.push(cb); return cbs.length; };
    performance.now = () => vt;
    window.__pre = null;
    window.__step = (n = 1) => { for (let i = 0; i < n; i++) { vt += 1000 / 30; if (window.__pre) window.__pre(1 / 30); const l = cbs; cbs = []; for (const c of l) c(vt); } };
  });
  await page.goto('file://' + file);
  await page.waitForFunction('window.__G && document.fonts.status === "loaded"', { timeout: 60000 });
  await page.evaluate(fs.readFileSync(path.join(__dirname, 'inpage.js'), 'utf8'));
  await page.evaluate(() => document.fonts.ready);
  return { browser, page };
}

module.exports = { open, WORK, ROOT };
