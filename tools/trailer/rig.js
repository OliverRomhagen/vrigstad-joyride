// Capture rig: drives a hooked copy of the built game in headless Chrome on a virtual clock,
// so every frame is rendered deterministically at 30 fps regardless of how fast the machine is.
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const WORK = path.join(__dirname, '.work');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// The game's internals the shots use, as a window.__G handle, plus a per-frame camera hook. The same hook goes into every
// release (tools/trailer/versions.js), so a name that doesn't exist in a version reads as undefined instead of failing,
// and what later moved into its own module (the police and stars into `wanted`, the safehouses into `places`) is read from there.
const BOOT = 'resize(); requestAnimationFrame(frame);', RENDER = 'renderer.render(scene, camera);\n}', RENDER_HOOKED = 'if (window.__cam) window.__cam(camera, T);\n  ' + RENDER;
const NAMES = ['THREE', 'player', 'cars', 'keys', 'joy', 'R', 'D', 'hAt', 'camera', 'scene', 'action', 'toast', 'respawn', 'nearestRoad', 'addCar', 'removeCar',
  'carGeo', 'sun', 'SUN_DIR', 'renderer', 'placeCar', 'nodes', 'nodeKey', 'driveable', 'inCar', 'pcar', 'vehicleVisuals'];
const has = n => `typeof ${n} !== 'undefined'`;
const HOOK = `window.__G = { ${NAMES.map(n => `get ${n}() { return ${has(n)} ? ${n} : undefined; }`).join(', ')},
  get police() { return ${has('wanted')} ? wanted.police : police; }, get stars() { return ${has('wanted')} ? wanted.stars : stars; },
  get places() { return ${has('places')} ? places.list || places : undefined; },
  addStar(msg) { return ${has('wanted')} ? wanted.addStar(msg) : addStar(msg); }, clearWanted() { return ${has('wanted')} ? wanted.clear() : clearWanted(); },
  get hideT() { return ${has('wanted')} ? wanted.hideLeft : hideT; }, set hideT(v) { if (${has('wanted')}) wanted.hideLeft = v; else hideT = v; },
  get camYaw() { return camYaw; }, set camYaw(v) { camYaw = v; }, set camPitch(v) { camPitch = v; }, set lookOff(v) { lookOff = v; lookIdle = 0; } };\n`;

/** The game's main script with the capture hooks added; throws when the script no longer has the lines they go next to. */
function hookSource(src, what = 'src/game/main.ts') {
  if (src.split(BOOT).length !== 2 || src.split(RENDER).length !== 2) throw new Error(what + ' no longer matches the capture hooks in rig.js');
  return src.replace(BOOT, () => HOOK + BOOT).replace(RENDER, () => RENDER_HOOKED);
}

// Builds .work/index.html: the game from this checkout, with the hooks added to src/game/main.ts as Vite transforms it.
// The shipped game files are not modified.
async function buildCaptureCopy() {
  const { build } = await import('vite');
  const hooks = { name: 'capture-hooks', enforce: 'pre', transform(src, id) { if (id.endsWith('/src/game/main.ts')) return hookSource(src); } };
  await build({ configFile: path.join(ROOT, 'vite.config.ts'), root: path.join(ROOT, 'src'), logLevel: 'warn', plugins: [hooks],
    build: { outDir: WORK, emptyOutDir: false, rollupOptions: { input: path.join(ROOT, 'src', 'index.html') } } });
  return path.join(WORK, 'index.html');
}

/** Opens a hooked game page: `file` if given (a release from versions.js), else a fresh build of this checkout. */
async function open({ width = 1280, height = 720, scale = 1.5, file = null } = {}) {
  file = file || await buildCaptureCopy();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--allow-file-access-from-files', `--window-size=${width},${height}`] });
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
  // an error while the game boots (a renamed internal, say) fails now instead of after the timeout
  let onError;
  const failed = new Promise((_, reject) => { onError = reject; page.once('pageerror', onError); });
  failed.catch(() => {});
  try { await Promise.race([page.waitForFunction('window.__G && window.__G.player && document.fonts.status === "loaded"', { timeout: 60000 }), failed]); }
  catch (e) { await browser.close(); throw e; }
  finally { page.off('pageerror', onError); }
  await page.evaluate(fs.readFileSync(path.join(__dirname, 'inpage.js'), 'utf8'));
  await page.evaluate(() => document.fonts.ready);
  return { browser, page };
}

// Detailed car models load in the background (src/game/render/vehicle-visuals.ts) while the virtual clock stands still, so a shot
// waits until no car is still loading one, then renders a frame to show them; otherwise it can catch the box cars they replace.
async function modelsReady(page, timeout = 30000) {
  await page.waitForFunction(() => { const V = __G.vehicleVisuals; if (!V || !V.state) return true;
    return __G.cars.every(c => { const s = V.state(c); return !s || s.status !== 'loading'; }); }, { timeout, polling: 100 });
  await page.evaluate(() => __step(1));
}

module.exports = { open, modelsReady, hookSource, MARKS: { BOOT, RENDER, RENDER_HOOKED, HOOK }, WORK, ROOT };
