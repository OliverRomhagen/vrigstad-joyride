// Playable, hooked copies of every release (git tags v*), for the timelapse. Each is unpacked into .work/versions/<tag>/ once and kept.
// Releases that committed the built index.html (until #45) get the hooks added to that file; later ones are built from their own
// source with their own dependencies (npm ci), with the hooks added as Vite transforms src/game/main.ts unless the release has
// src/game/capture-hook.ts, which ?capture switches on.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { ROOT, WORK } = require('./rig');

// Releases from before src/game/capture-hook.ts get the rig's window.__G and window.__cam spliced into their main script's text.
// The handle has the hook's shape (game, view, wanted); a name that doesn't exist in a version reads as undefined instead of
// failing, and what later moved into its own object (the police and stars into `wanted`, the camera into `view`) is read from there.
const BOOT = 'resize(); requestAnimationFrame(frame);', RENDER = 'renderer.render(scene, camera);\n}', RENDER_HOOKED = 'if (window.__cam) window.__cam(camera, T);\n  ' + RENDER;
const NAMES = ['THREE', 'player', 'cars', 'keys', 'joy', 'R', 'D', 'hAt', 'camera', 'scene', 'action', 'toast', 'respawn', 'nearestRoad', 'addCar', 'removeCar',
  'carGeo', 'sun', 'SUN_DIR', 'renderer', 'placeCar', 'nodes', 'nodeKey', 'driveable', 'vehicleVisuals'];
const has = n => `typeof ${n} !== 'undefined'`;
const HOOK = `window.__G = { ${NAMES.map(n => `get ${n}() { return ${has(n)} ? ${n} : undefined; }`).join(', ')},
  game: ${has('game')} ? game : { get inCar() { return inCar; }, get pcar() { return pcar; } },
  view: ${has('view')} ? view : { get camYaw() { return camYaw; }, set camYaw(v) { camYaw = v; }, set camPitch(v) { camPitch = v; }, set lookOff(v) { lookOff = v; }, set lookIdle(v) { lookIdle = v; } },
  wanted: ${has('wanted')} ? wanted : { get police() { return police; }, get stars() { return stars; }, addStar(msg) { return addStar(msg); } } };\n`;
// After the split of main.ts (#177) and before capture-hook.ts, main.ts builds the modules and ends with `loop.start();`. Just before
// it goes what capture-hook.ts does: the same names on window.__G, read the same way, and window.__cam called as each frame is drawn.
// The names that moved into modules or changed in these releases are read in a try (v), so one a release doesn't have reads as
// undefined; the bare ones (game, view, wanted, …) are in every release that ends with `loop.start();` (alpha.5 on, all with
// src/game/state.ts), and the rest come from the modules' own exports.
const LOOP = '\nloop.start();\n';
const SPLIT_IMPORTS = "import * as __roads from '../world/roads'; import * as __stage from './render/stage'; import * as __economy from './economy';\n";
const SPLIT_HOOK = `
{ const v = f => { try { return f(); } catch { return undefined; } }, w = window, r = renderer.render.bind(renderer);
  renderer.render = (s, c) => { if (w.__cam) w.__cam(camera, game.inCar && game.pcar ? game.pcar : player); r(s, c); };
  w.__G = { THREE, renderer, camera, game, view, player, cars, keys: v(() => input.keys), joy: v(() => input.joy), D, R, hAt,
    nodes: v(() => roads.junctions), nodeKey: __roads.nodeKey, driveable: v(() => roads.driveable), action: v(() => action), addCar, removeCar,
    placeCar: v(() => placeCar), carGeo: v(() => carGeo), sun, SUN_DIR: __stage.SUN_DIR, wanted, places: v(() => places), wallet: v(() => wallet),
    TRISS_KR: __economy.TRISS_KR, vehicleVisuals: { state: c => vehicleVisuals.state(meshed(c)) } }; }`;
const MARKS = { BOOT, RENDER, RENDER_HOOKED, HOOK, LOOP, SPLIT_IMPORTS, SPLIT_HOOK };

/** A release's main script with the hooks added; throws when it has none of the lines they go next to. Self-contained (M holds the
 * marks), because the Vite config of a release's build gets its source text. */
function addHooks(src, what, M) {
  const once = s => src.split(s).length === 2;
  if (once(M.BOOT) && once(M.RENDER)) return src.replace(M.BOOT, () => M.HOOK + M.BOOT).replace(M.RENDER, () => M.RENDER_HOOKED);
  if (once(M.LOOP)) return M.SPLIT_IMPORTS + src.replace(M.LOOP, () => M.SPLIT_HOOK + M.LOOP);
  throw new Error(what + ' matches none of the capture hooks in tools/trailer/versions.js');
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const inTag = (tag, file) => { try { execFileSync('git', ['cat-file', '-e', tag + ':' + file], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; } };

/** The releases, oldest first: { tag, date } with date as YYYY-MM-DD, the day the release was tagged. */
function releases() {
  return git('for-each-ref', '--sort=creatordate', '--format=%(refname:short) %(creatordate:short)', 'refs/tags/v*')
    .split('\n').filter(Boolean).map(line => { const [tag, date] = line.split(' '); return { tag, date }; });
}

// Vite config for a release's build: its own config plus the hooks plugin (addHooks itself), into capture-dist/.
// Written into the unpacked release, with the hook's text inlined, so it doesn't load anything from this folder.
const viteConfig = (outDir, spliced) => `import base from './vite.config.ts';
const b = typeof base === 'function' ? base({ command: 'build', mode: 'production' }) : base;
const M = ${JSON.stringify(MARKS)};
const addHooks = ${addHooks};
const hooks = { name: 'capture-hooks', enforce: 'pre', transform(src, id) { if (id.endsWith('/src/game/main.ts')) return addHooks(src, 'src/game/main.ts', M); } };
export default { ...b, logLevel: 'warn', plugins: [...(b.plugins || []), ...(${JSON.stringify(spliced)} ? [hooks] : [])], build: { ...b.build, outDir: ${JSON.stringify(outDir)}, emptyOutDir: true } };
`;

// A copy is reused only while it was made by the hooks as they are now, so a change to the marks or the config rebuilds it.
const KEY = crypto.createHash('sha1').update(JSON.stringify(MARKS) + addHooks + viteConfig('', true)).digest('hex');

/** Path to the hooked index.html of a release, building it the first time. Throws, before any download or build, for a
 * release the hooks don't fit. */
function prepare(tag) {
  const dir = path.join(WORK, 'versions', tag), keyFile = path.join(dir, 'capture.key');
  const page = inTag(tag, 'index.html'), ownHook = !page && inTag(tag, 'src/game/capture-hook.ts');
  const out = path.join(dir, page ? 'capture.html' : path.join('capture-dist', 'index.html'));
  if (fs.existsSync(out) && fs.existsSync(keyFile) && fs.readFileSync(keyFile, 'utf8') === KEY) return out;
  if (!page && !ownHook) addHooks(git('show', tag + ':src/game/main.ts'), tag + ' src/game/main.ts', MARKS);
  fs.rmSync(out, { force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('sh', ['-c', 'git archive "$1" | tar -x -C "$2"', 'sh', tag, dir], { cwd: ROOT, stdio: 'inherit' });
  if (page) fs.writeFileSync(out, addHooks(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), tag + ' index.html', MARKS));
  else {
    // the marker is written once npm ci has finished, so an install that was cut short runs again
    const installed = path.join(dir, 'node_modules', '.capture-installed');
    if (!fs.existsSync(installed)) {
      console.log(tag, 'npm ci…');
      execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: 'inherit' });
      fs.writeFileSync(installed, '');
    }
    console.log(tag, 'build…');
    fs.writeFileSync(path.join(dir, 'capture.vite.config.mjs'), viteConfig(path.dirname(out), !ownHook));
    execFileSync(process.execPath, [path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'capture.vite.config.mjs'], { cwd: dir, stdio: 'inherit' });
  }
  fs.writeFileSync(keyFile, KEY);
  return out;
}

module.exports = { releases, prepare };
