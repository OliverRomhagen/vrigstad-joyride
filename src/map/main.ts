// @ts-nocheck
// Moved as-is from the single-file prototype (#44); it gets types as it is split into modules.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import D from '../../data/vrigstad.json';
import { ROAD_WIDTH_M as ROAD_W } from '../world/data';
import { Heightfield } from '../world/heightfield';
import { BuildingShellsByMaterial } from '../world/mesh/building-shells';
import { TerrainMesh } from '../world/mesh/terrain';
import { makeRnd } from '../world/random';
import { LEGACY_LIGHT } from '../world/three-legacy';
import { treeSpots } from '../world/trees';

(function () {
'use strict';
const S = D.size, HALF = S / 2, N = D.n, EX = 2;
const heightfield = new Heightfield(D, { exaggeration: EX, interpolation: 'bilinear' }), hAt = heightfield.heightAt.bind(heightfield);
const minE = heightfield.minElevationM, maxE = heightfield.maxElevationM;
document.getElementById('relief').textContent = Math.round(minE) + '–' + Math.round(maxE) + ' m above sea level';

const PAL = {
  light: { streetSw: '#9a9a8e', sky: '#dfe9ea', ground: '#eef0d2', land: ['#f1e9d8', '#f7edb0', '#e3dcd6', '#d5e8b8', '#cfe0bd', '#bcd9a2', '#a9d48f'],
    water: '#9fcdea', waterLine: '#6fb0dc', contour: 'rgba(150,95,50,.42)',
    road: [['#f0a03c', '#8a5a1e'], ['#f7d774', '#9a8440'], ['#ffffff', '#9a9a8e'], ['#ffffff', '#b0b0a4']], track: '#9c7a52', path: '#6b5a48',
    text: '#2b2b26', halo: 'rgba(255,255,255,.85)', tree: '#5f9150', earth: '#b79f7c',
    wall: '#e9e2d3', roof: '#7b6a5e', lmWall: '#a8392a', lmRoof: '#5b2a22' },
  dark: { streetSw: '#5b6660', sky: '#0e1513', ground: '#232d27', land: ['#2b2f2b', '#353522', '#2e2c2f', '#26372a', '#26352b', '#1c3a26', '#2c4a2c'],
    water: '#163d57', waterLine: '#2a6289', contour: 'rgba(200,150,100,.26)',
    road: [['#c98a3a', '#3a2a12'], ['#a8914a', '#332d16'], ['#5b6660', '#151a17'], ['#4b5550', '#151a17']], track: '#7a6548', path: '#8a7b68',
    text: '#dfe5dd', halo: 'rgba(10,14,12,.85)', tree: '#2f5a3a', earth: '#3a3229',
    wall: '#a9a497', roof: '#5f5a55', lmWall: '#c5543f', lmRoof: '#6b3028' }
};
const isDark = () => { const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };

// ---- renderer ----
const canvas = document.getElementById('gl');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
catch (err) { document.getElementById('fail').hidden = false; document.getElementById('ui').hidden = true; return; }
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // as in r128: the map's look was tuned without sRGB output encoding
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 10, 12000);
const controls = new OrbitControls(camera, canvas);
const centerY = hAt(0, 0);
controls.target.set(0, centerY, 0);
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 120; controls.maxDistance = 5200;
controls.screenSpacePanning = false;
function setView(top) {
  controls.target.set(0, centerY, 0);
  if (top) camera.position.set(0, 3400, 0.5); else camera.position.set(-1300, 1550, 2650);
  controls.update(); requestRender();
}

scene.add(new THREE.AmbientLight(0xffffff, 0.64 * LEGACY_LIGHT));
const sun = new THREE.DirectionalLight(0xffffff, 0.56 * LEGACY_LIGHT);
sun.position.set(-1500, 1700, 1100);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -1750, right: 1750, top: 1750, bottom: -1750, near: 200, far: 5200 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 1.2;
scene.add(sun);

// ---- map texture ----
const CW = (Math.min(innerWidth, innerHeight) < 600 || renderer.capabilities.maxTextureSize < 4096) ? 2048 : 4096;
const K = CW / S;
const tex2d = document.createElement('canvas'); tex2d.width = tex2d.height = CW;
const ctx = tex2d.getContext('2d');
const texture = new THREE.CanvasTexture(tex2d);
texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
const P = v => (v + HALF) * K;
function trace(p, close) {
  ctx.moveTo(P(p[0]), P(p[1]));
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(P(p[i]), P(p[i + 1]));
  if (close) ctx.closePath();
}
function contours(step) {
  const e = D.elev, c = S / (N - 1) * K;
  ctx.beginPath();
  for (let lev = Math.ceil(minE / step) * step; lev < maxE; lev += step) {
    const L = lev * 10 + 0.01;
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = e[j * N + i], b = e[j * N + i + 1], d = e[(j + 1) * N + i], cc = e[(j + 1) * N + i + 1];
      const pts = [];
      if ((a > L) !== (b > L)) pts.push(i + (L - a) / (b - a), j);
      if ((b > L) !== (cc > L)) pts.push(i + 1, j + (L - b) / (cc - b));
      if ((d > L) !== (cc > L)) pts.push(i + (L - d) / (cc - d), j + 1);
      if ((a > L) !== (d > L)) pts.push(i, j + (L - a) / (d - a));
      for (let k = 0; k + 3 < pts.length; k += 4) { ctx.moveTo(pts[k] * c, pts[k + 1] * c); ctx.lineTo(pts[k + 2] * c, pts[k + 3] * c); }
    }
  }
  ctx.stroke();
}
function streetNames(pal) {
  const best = {};
  for (const r of D.r) {
    if (!r.n || r.c > 2 || r.n.length < 3) continue;
    let len = 0; for (let i = 2; i < r.p.length; i += 2) len += Math.hypot(r.p[i] - r.p[i - 2], r.p[i + 1] - r.p[i - 1]);
    if (!best[r.n] || best[r.n].len < len) best[r.n] = { r, len };
  }
  const fs = Math.round(9.5 * K);
  ctx.font = '600 ' + fs + 'px "Barlow Condensed","Arial Narrow",Arial,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const at = (p, dist) => { let acc = 0;
    for (let i = 2; i < p.length; i += 2) { const l = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
      if (acc + l >= dist) { const t = (dist - acc) / l; return [p[i - 2] + t * (p[i] - p[i - 2]), p[i - 1] + t * (p[i + 1] - p[i - 1])]; } acc += l; }
    return [p[p.length - 2], p[p.length - 1]]; };
  for (const name in best) {
    const { r, len } = best[name], w = ctx.measureText(name).width / K;
    if (len < w * 1.15) continue;
    const a = at(r.p, len / 2 - w / 2), b = at(r.p, len / 2 + w / 2), m = at(r.p, len / 2);
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    ctx.save(); ctx.translate(P(m[0]), P(m[1])); ctx.rotate(ang);
    ctx.lineWidth = fs * 0.32; ctx.strokeStyle = pal.halo; ctx.strokeText(name, 0, 0);
    ctx.fillStyle = pal.text; ctx.fillText(name, 0, 0); ctx.restore();
  }
}
function paint(pal) {
  ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.fillStyle = pal.ground; ctx.fillRect(0, 0, CW, CW);
  for (const k of [0, 1, 2, 3, 4, 5, 6]) {
    ctx.fillStyle = pal.land[k]; ctx.beginPath();
    for (const l of D.l) if (l.k === k) trace(l.p, true);
    ctx.fill();
  }
  ctx.strokeStyle = pal.contour; ctx.lineWidth = Math.max(1, 0.9 * K); contours(5);
  ctx.strokeStyle = pal.waterLine;
  for (const w of D.ww) { ctx.lineWidth = (w.k === 0 ? 7 : 2.5) * K; ctx.beginPath(); trace(w.p); ctx.stroke(); }
  ctx.fillStyle = pal.water; ctx.lineWidth = Math.max(1, 0.8 * K);
  for (const w of D.w) { ctx.beginPath(); for (const ring of w) trace(ring, true); ctx.fill('evenodd'); ctx.stroke(); }
  ctx.strokeStyle = pal.water;
  for (const w of D.ww) { ctx.lineWidth = (w.k === 0 ? 5.5 : 1.5) * K; ctx.beginPath(); trace(w.p); ctx.stroke(); }
  // paths and tracks
  ctx.lineCap = 'butt';
  ctx.setLineDash([4 * K, 3 * K]); ctx.strokeStyle = pal.path; ctx.lineWidth = Math.max(1.2, 1.1 * K);
  ctx.beginPath(); for (const r of D.r) if (r.c === 5) trace(r.p); ctx.stroke();
  ctx.setLineDash([8 * K, 4 * K]); ctx.strokeStyle = pal.track; ctx.lineWidth = Math.max(1.5, 2 * K);
  ctx.beginPath(); for (const r of D.r) if (r.c === 4) trace(r.p); ctx.stroke();
  ctx.setLineDash([]); ctx.lineCap = 'round';
  // roads: all casings first, then fills, minor to major
  for (const pass of [1, 0]) for (const c of [3, 2, 1, 0]) {
    ctx.strokeStyle = pal.road[c][pass]; ctx.lineWidth = (ROAD_W[c] + (pass ? 2 : 0)) * K;
    ctx.beginPath(); for (const r of D.r) if (r.c === c) trace(r.p); ctx.stroke();
  }
  streetNames(pal);
  texture.needsUpdate = true;
}

// ---- terrain mesh with a solid base ----
const terrainMat = new THREE.MeshLambertMaterial({ map: texture }), earthMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
const BASE_DEPTH_M = 45;   // how far the solid base reaches below the lowest ground
const terrain = new TerrainMesh(heightfield, { skirtDepthM: BASE_DEPTH_M, material: terrainMat, skirtMaterial: earthMat });
scene.add(terrain.surface, terrain.skirt);

// ---- buildings ----
// one mesh per material, so a theme change only recolours them
const mats = { wall: new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), roof: new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
  lmWall: new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), lmRoof: new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }) };
const HOUSE = { walls: 'wall', roof: 'roof' }, LANDMARK = { walls: 'lmWall', roof: 'lmRoof' };   // landmarks: the church and the inn
const shells = new BuildingShellsByMaterial(D, heightfield, { materials: mats, materialsFor: b => b.k ? LANDMARK : HOUSE });
scene.add(...shells.meshes);

// ---- trees in mapped woodland ----
const treeMat = new THREE.MeshLambertMaterial();
const TREE_M2_PER_TRY = 95;   // one try at a tree per this much of a wood's bounding box
(function () {
  const spots = treeSpots(D, makeRnd(57355), { squareMetresPerTry: TREE_M2_PER_TRY, minScale: 0.7, scaleSpread: 0.7 });
  const geo = new THREE.ConeGeometry(3.4, 13, 6); geo.translate(0, 6.5, 0);
  const mesh = new THREE.InstancedMesh(geo, treeMat, spots.length / 3), m4 = new THREE.Matrix4();
  for (let i = 0; i < spots.length / 3; i++) { const s = spots[i * 3 + 2];
    m4.makeScale(s, s, s); m4.setPosition(spots[i * 3], hAt(spots[i * 3], spots[i * 3 + 1]) - 0.5, spots[i * 3 + 1]); mesh.setMatrixAt(i, m4); }
  mesh.castShadow = true; scene.add(mesh);
})();

// ---- place-name labels ----
const labelBox = document.getElementById('labels');
const labels = D.labels.map(l => { const el = document.createElement('div');
  el.className = 'lbl ' + l.k; el.textContent = l.t; if (l.k !== 'w') el.appendChild(document.createElement('i'));
  labelBox.appendChild(el);
  return { el, k: l.k, v: new THREE.Vector3(l.x, hAt(l.x, l.z) + (l.k === 'w' ? 1 : 26), l.z) }; });
const tmp = new THREE.Vector3();
function placeLabels() {
  const w = canvas.clientWidth, h = canvas.clientHeight, taken = [];
  for (const l of labels) {
    tmp.copy(l.v).project(camera);
    const ok = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
    l.el.hidden = !ok;
    if (ok) { const x = (tmp.x + 1) / 2 * w, y = (1 - tmp.y) / 2 * h;
      if (!l.w) l.w = l.el.offsetWidth || 90;
      const bx = [x - l.w / 2 - 4, y - (l.k === 'w' ? 12 : 36), x + l.w / 2 + 4, y + (l.k === 'w' ? 12 : 0)];
      if (taken.some(t => bx[0] < t[2] && bx[2] > t[0] && bx[1] < t[3] && bx[3] > t[1])) { l.el.hidden = true; continue; }
      taken.push(bx);
      l.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,' + (l.k === 'w' ? '-50%' : '-100%') + ')'; }
  }
}

// ---- legend ----
function legend(pal) {
  const rows = [['Building', pal.wall], ['Church, inn', pal.lmWall], ['Main road', pal.road[0][0], 'ln'], ['Street', pal.streetSw, 'ln'],
    ['Path, track', pal.track, 'ln dash'], ['Water', pal.water], ['Woodland', pal.land[5]], ['Farmland', pal.land[1]],
    ['Built-up area', pal.land[0]], ['Sports pitch', pal.land[6]], ['Contour, 5 m', pal.contour, 'ln']];
  const ul = document.getElementById('legend-list'); ul.textContent = '';
  for (const r of rows) { const li = document.createElement('li'), sw = document.createElement('span');
    sw.className = 'sw ' + (r[2] || ''); if (r[2]) sw.style.borderTopColor = r[1]; else sw.style.background = r[1];
    li.appendChild(sw); li.appendChild(document.createTextNode(r[0])); ul.appendChild(li); }
}

// ---- theme, render loop ----
let queued = false;
function requestRender() { if (!queued) { queued = true; requestAnimationFrame(render); } }
function render() {
  queued = false;
  renderer.render(scene, camera);
  placeLabels();
  document.getElementById('north-g').setAttribute('transform', 'rotate(' + (controls.getAzimuthalAngle() * 180 / Math.PI).toFixed(1) + ')');
}
function applyTheme() {
  const pal = PAL[isDark() ? 'dark' : 'light'];
  scene.background = new THREE.Color(pal.sky);
  earthMat.color.set(pal.earth); treeMat.color.set(pal.tree);
  for (const k in mats) mats[k].color.set(pal[k]);
  paint(pal); legend(pal); requestRender();
}
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); requestRender();
}
controls.addEventListener('change', requestRender);
addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyTheme);

document.getElementById('b-reset').onclick = () => setView(false);
document.getElementById('b-top').onclick = () => setView(true);
function zoom(f) { const d = camera.position.clone().sub(controls.target);
  d.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, d.length() * f)));
  camera.position.copy(controls.target).add(d); controls.update(); requestRender(); }
document.getElementById('b-in').onclick = () => zoom(0.7);
document.getElementById('b-out').onclick = () => zoom(1 / 0.7);
document.getElementById('c-labels').onchange = e => { labelBox.hidden = !e.target.checked; requestRender(); };
if (innerWidth < 700) document.getElementById('legend').open = false;

resize(); applyTheme(); setView(false);
renderer.shadowMap.needsUpdate = true;
})();
