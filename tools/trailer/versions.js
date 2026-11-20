// Playable, hooked copies of every release (git tags v*), for the timelapse. Each is unpacked into .work/versions/<tag>/ once and kept.
// Releases that committed the built index.html (until #45) get the hooks added to that file; later ones are built from their own
// source with their own dependencies (npm ci), with the hooks added as Vite transforms src/game/main.ts unless the release has
// src/game/capture-hook.ts, which ?capture switches on.
const fs = require('fs');
const path = require('path');
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
const MARKS = { BOOT, RENDER, RENDER_HOOKED, HOOK };

/** A release's main script with the hooks added; throws when it doesn't have the lines they go next to. */
function hookSource(src, what) {
  if (src.split(BOOT).length !== 2 || src.split(RENDER).length !== 2) throw new Error(what + ' no longer matches the capture hooks in versions.js');
  return src.replace(BOOT, () => HOOK + BOOT).replace(RENDER, () => RENDER_HOOKED);
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/** The releases, oldest first: { tag, date } with date as YYYY-MM-DD. */
function releases() {
  return git('tag', '--list', 'v*', '--sort=creatordate').split('\n').filter(Boolean).map(tag => ({ tag, date: git('log', '-1', '--format=%cs', tag) }));
}

// Vite config for a release's build: its own config plus the hooks plugin (the same as hookSource), into capture-dist/.
// Written into the unpacked release, with the hook's text inlined, so it doesn't load anything from this folder.
const viteConfig = (outDir, spliced) => `import base from './vite.config.ts';
const b = typeof base === 'function' ? base({ command: 'build', mode: 'production' }) : base;
const { BOOT, RENDER, RENDER_HOOKED, HOOK } = ${JSON.stringify(MARKS)};
const hooks = { name: 'capture-hooks', enforce: 'pre', transform(src, id) {
  if (!id.endsWith('/src/game/main.ts')) return;
  if (src.split(BOOT).length !== 2 || src.split(RENDER).length !== 2) throw new Error('src/game/main.ts no longer matches the capture hooks in tools/trailer/versions.js');
  return src.replace(BOOT, () => HOOK + BOOT).replace(RENDER, () => RENDER_HOOKED);
} };
export default { ...b, logLevel: 'warn', plugins: [...(b.plugins || []), ...(${JSON.stringify(spliced)} ? [hooks] : [])], build: { ...b.build, outDir: ${JSON.stringify(outDir)}, emptyOutDir: true } };
`;

/** Path to the hooked index.html of a release, building it the first time. */
function prepare(tag) {
  const dir = path.join(WORK, 'versions', tag), built = path.join(dir, 'capture-dist', 'index.html'), patched = path.join(dir, 'capture.html');
  if (fs.existsSync(patched)) return patched;
  if (fs.existsSync(built)) return built;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('sh', ['-c', 'git archive "$1" | tar -x -C "$2"', 'sh', tag, dir], { cwd: ROOT, stdio: 'inherit' });
  const page = path.join(dir, 'index.html');
  if (fs.existsSync(page)) {
    fs.writeFileSync(patched, hookSource(fs.readFileSync(page, 'utf8'), tag + ' index.html'));
    return patched;
  }
  console.log(tag, 'npm ci and build…');
  execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: 'inherit' });
  fs.writeFileSync(path.join(dir, 'capture.vite.config.mjs'), viteConfig(path.dirname(built), !fs.existsSync(path.join(dir, 'src', 'game', 'capture-hook.ts'))));
  execFileSync(process.execPath, [path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'capture.vite.config.mjs'], { cwd: dir, stdio: 'inherit' });
  return built;
}

module.exports = { releases, prepare };
