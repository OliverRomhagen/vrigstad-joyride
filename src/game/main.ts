// @ts-nocheck
// Moved as-is from the single-file prototype (#44); it gets types as it is split into modules.
import * as THREE from 'three';
import { AdoptHearts } from './render/adopt-heart';
import { DriftFx } from './render/drift-fx';
import { vehicleDefinition } from './render/vehicle-registry';
import { Sky } from './render/sky';
import { VehicleVisuals } from './render/vehicle-visuals';
import { BodyMotion } from './render/body-motion';
import { CarDamageFx } from './render/car-damage';
import { CarMeshes } from './render/car-meshes';
import D from '../../data/vrigstad.json';
import { LabFlags } from '../lab/flags';
import { BuildingIndex } from '../world/buildings';
import { ROAD_WIDTH_M as ROAD_W } from '../world/data';
import { Heightfield } from '../world/heightfield';
import { parseCloudConfig } from '../world/clouds';
import { clamp, wrap } from '../world/math';
import { PaintedBuildingShells } from '../world/mesh/building-shells';
import { ParkingMesh } from '../world/mesh/parking-mesh';
import { RoadRibbons } from '../world/mesh/road-ribbons';
import { SidewalkMesh } from '../world/mesh/sidewalk-mesh';
import { TerrainMesh } from '../world/mesh/terrain';
import { pointInPolygon as inPoly, polygonArea as polyArea } from '../world/polygon';
import { makeRnd } from '../world/random';
import { RoadNetwork } from '../world/roads';
import { buildStreetscape, sidewalkCentreM, StreetscapeIndex } from '../world/streetscape';
import { STREETSCAPE_OVERRIDES } from '../world/streetscape-overrides';
import { classifyStreetscape } from '../world/streetscape-rules';
import { LEGACY_LIGHT } from '../world/three-legacy';
import { treeSpots } from '../world/trees';
import { Water } from '../world/water';
import { Fleet, newCar, TURBO_AT } from './cars';
import { CatColony } from './cats';
import { Hud } from './hud';
import { Input } from './input';
import { Actions } from './actions';
import { Crowd } from './pedestrians';
import { esc, MenuPlate } from './menu';
import { KioskCatMenus } from './kiosk-cat-menus';
import { Pets } from './pets';
import { KIOSK, Places } from './places';
import { CAT_SCRATCH_HP, LOW_HP, CRASH_COOL_S, crashCars, crashDamage, driverHurt, hurt, impactSpeed, newHealth, regen, runOverHurt, smokeLevel, wrecked } from './health';
import { HOME, hop, ride, tooFastToGetOut, walk } from './player';
import { Wanted } from './police';
import { PlaceMeshes } from './render/places';
import { specFor } from './sim/vehicle-spec';
import { newGameState, newViewState } from './state';
import { Trisslott } from './trisslott';

(function () {
'use strict';
const $ = id => document.getElementById(id);
const S = D.size, HALF = S / 2;
// seeded streams: rnd() drives the world and gameplay; side systems get their own stream so they don't shift its rolls
const rnd = makeRnd(57355);
const pick = a => a[Math.floor(rnd() * a.length)];
// the shared state that the sections below and the modules read and write (src/game/state.ts)
const game = newGameState();

// ---------- terrain height (matches the mesh triangles exactly) ----------
// the world's queries are bound once, so the code below calls them as plain functions
const heightfield = new Heightfield(D), hAt = heightfield.heightAt.bind(heightfield);
const _n = new THREE.Vector3();
const normalAt = (x, z) => heightfield.normalAt(x, z, _n);

// ---------- renderer ----------
const canvas = $('gl');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
catch { $('fail').hidden = false; $('ui').hidden = true; $('intro').hidden = true; return; }
const coarse = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// filmic tone mapping on an sRGB pipeline: colours below are written in sRGB and converted to linear with col()
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
const col = c => new THREE.Color(c).convertSRGBToLinear();
// three applies fog after the output colour space conversion, so the fog, clear and sky colours stay in sRGB
const HORIZON = 0xd6e4e6, FOG_PER_M = 0.0007;   // FogExp2 density: about 40% haze at 1 km
const scene = new THREE.Scene();
scene.background = new THREE.Color(HORIZON);
scene.fog = new THREE.FogExp2(HORIZON, FOG_PER_M);
const camera = new THREE.PerspectiveCamera(58, 1, 0.8, 4200);
scene.add(new THREE.HemisphereLight(0xffffff, col(0x9aa58a), 0.62 * LEGACY_LIGHT));
const sun = new THREE.DirectionalLight(col(0xfff4dd), 0.95 * LEGACY_LIGHT);   // intensity: SUN_I, times the clouds' sunFactor
const SUN_DIR = new THREE.Vector3(-0.55, 0.75, 0.37).normalize();
// sky: a gradient dome with the sun's glow and drifting fair-weather clouds (src/game/render/sky.ts); it follows the camera
// and fades into the fog at the horizon. ?clouds=clear|scattered|partly|mostly|off, cloudSeed, wind=from°,m/s (see clouds.ts)
const SUN_I = 0.95 * LEGACY_LIGHT;   // the sun's intensity under a clear sky; a cloud in front of it takes some away
const skyDome = new Sky({ top: 0x5f97c9, horizon: HORIZON, sunColour: 0xfff1d0, sunDir: SUN_DIR, clouds: parseCloudConfig(new URLSearchParams(location.search), coarse) });
const dome = skyDome.mesh; scene.add(dome);
// soft round shadow under cars, people and trees, so nothing looks pasted onto the ground
const blobTex = (function () { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,.9)'); g.addColorStop(0.5, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return cv; })();
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: new THREE.CanvasTexture(blobTex), transparent: true, opacity: 0.5, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }), blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
function blob(parent, w, l) { const m = new THREE.Mesh(blobGeo, blobMat); m.scale.set(w, 1, l); m.position.y = 0.06; m.renderOrder = 3; parent.add(m); return m; }
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 50, far: 800 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

// ---------- lab: opt-in experiments, switched on with ?lab=<id>,<id> (src/lab/) ----------
// each one is imported only when its flag is on, so with everything off the game runs exactly as without the lab;
// after the WebGL check, so none starts behind the fail screen, and one that fails to load or start only warns
const lab = LabFlags.fromSearch(location.search);
if (lab.on('hello')) import('../lab/hello').then(m => m.startHello()).catch(err => console.warn('Lab: hello failed', err));

// ---------- ground texture (also feeds the minimap) ----------
const CW = (coarse || renderer.capabilities.maxTextureSize < 4096) ? 2048 : 4096, K = CW / S;
const tex2d = document.createElement('canvas'); tex2d.width = tex2d.height = CW;
const ctx = tex2d.getContext('2d');
const P = v => (v + HALF) * K;
function trace(p, close) { ctx.moveTo(P(p[0]), P(p[1])); for (let i = 2; i < p.length; i += 2) ctx.lineTo(P(p[i]), P(p[i + 1])); if (close) ctx.closePath(); }
const HOUSE_MIN_M2 = 40, HOUSE_MAX_M2 = 1500;   // footprints in this range count as homes and shops
(function paint() {
  const land = ['#a6c083', '#d9cf8b', '#b9b4a8', '#8fc072', '#93b77d', '#6f9a5e', '#7cc163'];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.fillStyle = '#9db87a'; ctx.fillRect(0, 0, CW, CW);
  const fillLand = k => { ctx.fillStyle = land[k]; ctx.beginPath(); for (const l of D.l) if (l.k === k) trace(l.p, true); ctx.fill(); };
  const GRASS = [0, 3];   // residential and grass/parks; farmland, industrial, cemetery, forest and pitches are filled over the mottling
  GRASS.forEach(fillLand);
  // mottled grass: its own generator, so the look doesn't shift the seeded rnd() sequence
  let ns = 7; const nr = () => (ns = ns * 48271 % 2147483647) / 2147483647;
  for (let i = 0; i < 2600; i++) { const cx = nr() * CW, cy = nr() * CW, r = (6 + nr() * 24) * K, g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r), c = ['143,176,111', '169,196,134', '120,150,95', '179,201,141'][i % 4];
    g.addColorStop(0, 'rgba(' + c + ',.35)'); g.addColorStop(1, 'rgba(' + c + ',0)'); ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
  ctx.globalAlpha = 0.45;
  for (const c of ['#86a866', '#b0c88e', '#7c9d5c', '#c3cf98']) { ctx.fillStyle = c; for (let i = 0; i < 40000; i++) ctx.fillRect(nr() * CW, nr() * CW, 1 + nr() * 1.5, 1 + nr() * 1.5); }
  ctx.globalAlpha = 1;
  for (let k = 0; k < 7; k++) if (!GRASS.includes(k)) fillLand(k);
  ctx.strokeStyle = 'rgba(172,199,138,.55)'; ctx.lineWidth = 9 * K; ctx.beginPath();   // mown lawns around homes (not the church, barns or halls)
  for (const b of D.b) { const a = polyArea(b.p); if (b.k !== 1 && a >= HOUSE_MIN_M2 && a <= HOUSE_MAX_M2) trace(b.p, true); } ctx.stroke();
  ctx.strokeStyle = '#4f8fb8';
  for (const w of D.ww) { ctx.lineWidth = (w.k === 0 ? 6 : 2) * K; ctx.beginPath(); trace(w.p); ctx.stroke(); }
  ctx.fillStyle = '#4f8fb8';
  for (const w of D.w) { ctx.beginPath(); for (const ring of w) trace(ring, true); ctx.fill('evenodd'); }
  const fill = ['#55585a', '#5d6062', '#66696a', '#77776f', '#a08c6c', '#b8ab90'];
  for (const pass of [2, 1, 0]) for (const c of [5, 4, 3, 2, 1, 0]) {   // 2: soft outer edge of the verge, 1: gravel verge, 0: the road
    if (pass && c > 3) continue;
    ctx.strokeStyle = pass === 2 ? 'rgba(179,167,140,.35)' : pass ? '#b3a78c' : fill[c]; ctx.lineWidth = (ROAD_W[c] + (pass === 2 ? 4.4 : pass ? 2.4 : 0)) * K;
    ctx.beginPath(); for (const r of D.r) if (r.c === c) trace(r.p); ctx.stroke();
  }
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 3 * K;   // contact shadow around every footprint
  ctx.fillStyle = '#8a8378'; ctx.beginPath(); for (const b of D.b) trace(b.p, true); ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
})();
const texture = new THREE.CanvasTexture(tex2d);
texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); texture.colorSpace = THREE.SRGBColorSpace;

// ---------- terrain ----------
const SKIRT_DEPTH_M = 1.5;   // the skirt round the edge, and the far ground plane, sit this far below height 0
const terrain = new TerrainMesh(heightfield, { skirtDepthM: SKIRT_DEPTH_M, material: new THREE.MeshLambertMaterial({ map: texture }),
  skirtMaterial: new THREE.MeshLambertMaterial({ color: col(0x6f8a58), side: THREE.DoubleSide }) });
const far = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), new THREE.MeshLambertMaterial({ color: col(0x6f9a5e) }));
far.rotation.x = -Math.PI / 2; far.position.y = -SKIRT_DEPTH_M;
scene.add(terrain.surface, far, terrain.skirt);

// ---------- roads: crisp ribbons on the terrain + lookup grid + junction graph ----------
const roads = new RoadNetwork(D, heightfield), { lines: R } = roads;
let streetIndex = null;   // the streetscape's walkable height, built further down once the buildings and trees are known
// what people, cats and cars stand on: the road, or the curb, pavement or parking area above it
const groundAt = (x, z) => { const g = roads.groundAt(x, z), s = streetIndex && streetIndex.surfaceAt(x, z); return s !== null && s > g ? s : g; };
const ROAD_COLOURS = [0x4c4f52, 0x55585b, 0x606365, 0x74746d, 0xa08c6c, 0xbcae92] as const, CENTRE_LINE_COLOUR = 0xe9e7da;   // sRGB, by road class
const asphalt = (() => {   // a light, speckled tile that the road colours tint, so asphalt and gravel aren't flat
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const x = cv.getContext('2d') as CanvasRenderingContext2D;
  let seed = 11; const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647;   // its own generator, so the look doesn't shift the seeded rnd() sequence
  x.fillStyle = '#f7f7f7'; x.fillRect(0, 0, 256, 256); x.globalAlpha = 0.7;
  for (const c of ['#ffffff', '#cdcdcd', '#dedede']) { x.fillStyle = c; for (let i = 0; i < 1600; i++) x.fillRect(next() * 256, next() * 256, 1, 1); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
})();
const roadRibbons = new RoadRibbons(roads, heightfield, { asphalt, roadColours: ROAD_COLOURS, centreLineColour: CENTRE_LINE_COLOUR });
scene.add(...roadRibbons.meshes);

// ---------- water ----------
const water = new Water(D, roads), inWater = water.inWater.bind(water);

// ---------- buildings (painted in Swedish house colours) + collision grid ----------
const buildings = new BuildingIndex(D), { footprints: bPolys } = buildings;
const addFootprint = buildings.addFootprint.bind(buildings), collide = buildings.collide.bind(buildings);
// house details: windows (a texture on a skin just outside the walls), white corner boards and eave boards, a dark plinth, and a chimney on gabled roofs
const WIN_W = 2.6, STOREY = 2.8;   // window spacing and storey height (m)
const winTex = (function () {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'), u = v => v / WIN_W * 128, y = v => 128 - v / STOREY * 128;
  x.fillStyle = '#f1efe8'; x.fillRect(u(0.8), y(2.15), u(1), y(0.9) - y(2.15));                    // frame: 1.0 x 1.25 m, sill 0.9 m up
  x.fillStyle = '#26323a'; x.fillRect(u(0.88), y(2.07), u(0.84), y(0.98) - y(2.07));
  x.fillStyle = '#f1efe8'; x.fillRect(u(1.265), y(2.07), u(0.07), y(0.98) - y(2.07)); x.fillRect(u(0.88), y(1.75), u(0.84), y(1.68) - y(1.75));   // cross bars
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return t;   // mips average the mostly transparent tile below alphaTest, so windows would vanish at a distance
})();
(function () {
  const c = new THREE.Color(), c2 = new THREE.Color(), c3 = new THREE.Color(), paint = { wall: c, wallFoot: c3, roof: c2 };
  const wp = [], wu = [], tp = [], tc = [], WHITE = col('#f1efe8'), PLINTH = col('#5b5d5b');
  const house = ['#9c3a2c', '#9c3a2c', '#a8452f', '#e8e2d2', '#e8e2d2', '#d9b65a', '#cfc8b8', '#8d9a8f'], big = ['#c9c5bb', '#b8b3a6', '#d6d0c0', '#a7aeb0'];
  // a vertical quad from (x1, z1) to (x2, z2), bottom and top heights at each end
  const quad = (out, x1, z1, x2, z2, b1, t1, b2, t2) => out.push(x1, b1, z1, x2, b2, z2, x2, t2, z2, x1, b1, z1, x2, t2, z2, x1, t1, z1);
  const trim = (k, ...q) => { quad(tp, ...q); for (let i = 0; i < 6; i++) tc.push(k.r, k.g, k.b); };
  const box = (emit, x, z, y0, y1, s, k) => { const h = s / 2, P = [[x - h, z - h], [x + h, z - h], [x + h, z + h], [x - h, z + h]], pos = [];
    for (let i = 0; i < 4; i++) { const a = P[i], d = P[(i + 1) % 4]; quad(pos, a[0], a[1], d[0], d[1], y0, y1, y0, y1); }
    pos.push(x - h, y1, z - h, x + h, y1, z + h, x + h, y1, z - h, x - h, y1, z - h, x - h, y1, z + h, x + h, y1, z + h);
    for (let i = 0; i < pos.length; i += 3) emit(pos[i], pos[i + 1], pos[i + 2], k); };
  // the colours roll rnd() once or twice per house, in data order, before any tree spot
  const colours = ({ building: b, area }) => {
    c.set(b.k === 2 ? '#9c3a2c' : b.k ? '#efece3' : area > 450 ? pick(big) : pick(house)).convertSRGBToLinear();
    c2.set(b.k === 2 ? '#a8573f' : b.k ? '#3f4447' : rnd() < 0.35 ? '#4d4a48' : '#a8573f').convertSRGBToLinear();
    c3.copy(c).multiplyScalar(0.62);   // walls darken towards the ground
    return paint;
  };
  const details = ({ building: b, ring, yAt, base, top, hi, area, winding: wind }, emit) => {
    if (b.k === 1 || area < HOUSE_MIN_M2 || area > HOUSE_MAX_M2) return;   // not the church and its tower, not sheds or barns
    const m = ring.length, yb = hi + 0.2, yt = top - 0.25, rows = Math.max(1, Math.round((yt - yb) / STOREY));
    for (let i = 0; i < m; i++) {
      const a = ring[i], d = ring[(i + 1) % m], ex = d.x - a.x, ez = d.z - a.z, len = Math.hypot(ex, ez); if (len < 0.4) continue;
      const ux = ex / len, uz = ez / len, ox = wind * uz, oz = -wind * ux, o = (k, s) => [a.x + ox * k - ux * s, a.z + oz * k - uz * s, d.x + ox * k + ux * s, d.z + oz * k + uz * s];
      const nwin = Math.round(len / WIN_W);   // whole windows only: the tile stretches a little to fit the wall
      if (len >= 1.6 && nwin > 0) { quad(wp, ...o(0.04, 0), yb, yt, yb, yt); wu.push(0, 0, nwin, 0, nwin, rows, 0, 0, nwin, rows, 0, rows); }
      trim(PLINTH, ...o(0.05, 0.05), base, hi + 0.45, base, hi + 0.45);
      trim(WHITE, ...o(0.06, 0.06), yAt(a) - 0.22, yAt(a) + 0.02, yAt(d) - 0.22, yAt(d) + 0.02);
      for (const [v, p, s] of [[a, ring[(i + m - 1) % m], 1], [d, ring[(i + 2) % m], -1]]) {   // corner boards where the outline turns
        const fx = s > 0 ? v.x - p.x : p.x - v.x, fz = s > 0 ? v.z - p.z : p.z - v.z, fl = Math.hypot(fx, fz) || 1;
        if (Math.abs((fx * uz - fz * ux) / fl) < 0.3) continue;
        const k = Math.min(0.18, len / 2), cx = v.x + ox * 0.07, cz = v.z + oz * 0.07;
        trim(WHITE, cx, cz, cx + ux * k * s, cz + uz * k * s, base, yAt(v) - 0.2, base, yAt(v) - 0.2);
      }
    }
    if (b.g) { const [ax, az, bx, bz] = b.g, cx = ax + (bx - ax) * 0.3, cz = az + (bz - az) * 0.3, ry = yAt({ x: cx, z: cz });   // chimney, in the shell's own mesh
      if (inPoly(b.p, cx, cz)) box(emit, cx, cz, ry - 0.6, ry + 0.9, 0.6, hAt(cx, cz) * 7 % 1 < 0.5 ? col('#8a3b2d') : col('#d8d2c4')); }
  };
  scene.add(new PaintedBuildingShells(D, heightfield, { material: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), colours, extra: details }).mesh);
  // window skin first, trim after: one mesh, two materials
  const sg = new THREE.BufferGeometry(), nw = wp.length / 3, nt = tp.length / 3, sc = new Float32Array((nw + nt) * 3).fill(1);
  sc.set(tc, nw * 3);
  sg.setAttribute('position', new THREE.Float32BufferAttribute(wp.concat(tp), 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(wu.concat(new Array(nt * 2).fill(0)), 2));
  sg.setAttribute('color', new THREE.BufferAttribute(sc, 3)); sg.computeVertexNormals(); sg.addGroup(0, nw, 0); sg.addGroup(nw, nt, 1);
  const skin = new THREE.Mesh(sg, [new THREE.MeshLambertMaterial({ map: winTex, alphaTest: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })]);
  skin.receiveShadow = true; scene.add(skin);
})();

// ---------- trees: spruces and birches, each with its own shade, size and lean ----------
const TREE_M2_PER_TRY = 110, TREE_ROAD_CLEARANCE_M = 2.5;   // one try at a tree per this much of a wood's bounding box; no trunk closer to a road's edge
const forestSpots = treeSpots(D, rnd, { squareMetresPerTry: TREE_M2_PER_TRY, minScale: 0.7, scaleSpread: 0.8, roads, roadClearanceM: TREE_ROAD_CLEARANCE_M });

// ---------- streetscape: curbs, pavements, verges, crossings and parking from OSM, rules where OSM says nothing (#187) ----------
const STREET_TREE_SCALE = 0.75, DEBUG_STREETSCAPE = new URLSearchParams(location.search).get('debug') === 'streetscape';   // ?debug=streetscape tints by evidence
const street = (function () {
  const t0 = performance.now(), sides = classifyStreetscape(D, roads, buildings, STREETSCAPE_OVERRIDES);
  const layout = buildStreetscape({ data: D, roads, heightfield, buildings, water, sides, avoidTrees: forestSpots.filter((_, i) => i % 3 < 2), treeRoadClearanceM: TREE_ROAD_CLEARANCE_M });
  streetIndex = new StreetscapeIndex(layout, D, heightfield);
  const surface = new THREE.MeshLambertMaterial({ vertexColors: true }), paint = new THREE.MeshLambertMaterial({ color: col(0xe9e7da), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -40 });
  const sidewalks = new SidewalkMesh(layout, { surface, markings: paint, debugSources: DEBUG_STREETSCAPE, roadMaterials: roadRibbons.materials });
  const parking = new ParkingMesh(layout, D, heightfield, { surface, markings: paint, debugSources: DEBUG_STREETSCAPE });
  const meshes = [...sidewalks.meshes, ...parking.meshes]; scene.add(...meshes);
  const tris = meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0);
  return { layout, sides, meshes, tris, ms: performance.now() - t0 };
})();
// the pavement's centre line where a side has one, else today's walking line on the shoulder
const walkOffset = (ri, side) => { const sp = side < 0 ? street.sides[ri].left : street.sides[ri].right; return sidewalkCentreM(sp, R[ri].c) ?? ROAD_W[R[ri].c] / 2 + 0.8; };

(function () {
  // street trees (mapped and inferred) join the forest's instanced meshes as birches, the deciduous kind
  const FOREST_N = forestSpots.length / 3, spots = forestSpots.slice();
  for (const t of street.layout.trees) spots.push(t.x, t.z, STREET_TREE_SCALE);
  // variety comes from a hash of the position, so the trees don't consume rnd() and shift the rest of the world
  const hash = (x, z, k) => { const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };
  const cone = (r, h, y) => new THREE.ConeGeometry(r, h, 7, 1, true).translate(0, y + h / 2, 0);
  const KINDS = [
    { crown: mergeGeo([[cone(3.2, 6.5, 1.4)], [cone(2.5, 5.6, 4.6)], [cone(1.7, 4.6, 7.9)]]), trunk: new THREE.CylinderGeometry(0.22, 0.3, 2.2, 7, 1, true).translate(0, 1.1, 0),
      bark: '#5a4632', leaf: ['#2f5a36', '#4d7d48'] },                                                           // spruce
    { crown: mergeGeo([[new THREE.SphereGeometry(2.7, 7, 5).scale(1, 1.25, 1).translate(0, 6.6, 0)], [new THREE.SphereGeometry(1.9, 6, 4).translate(0.9, 8.6, 0.4)],
      [new THREE.SphereGeometry(1.6, 6, 4).translate(-1, 7.8, -0.6)]]), trunk: new THREE.CylinderGeometry(0.14, 0.2, 6, 6, 1, true).translate(0, 3, 0),
      bark: '#e9e6dc', leaf: ['#5f8f3e', '#93b55a'] }                                                            // birch
  ];
  const BIRCH_SHARE = 0.3, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  const N = spots.length / 3, kind = i => i >= FOREST_N || hash(spots[i * 3], spots[i * 3 + 1], 1) < BIRCH_SHARE ? 1 : 0;
  // one InstancedMesh per kind and cell, so the main and shadow passes cull whole cells (three bounds an InstancedMesh by its instances)
  const TREE_CELL_M = 400, cellOf = v => Math.floor((v + HALF) / TREE_CELL_M);
  KINDS.forEach((kd, ki) => {
    const cells = new Map(); for (let i = 0; i < N; i++) if (kind(i) === ki) { const k = cellOf(spots[i * 3]) + ',' + cellOf(spots[i * 3 + 1]); let l = cells.get(k); if (!l) cells.set(k, l = []); l.push(i); }
    const crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff }), trunkMat = new THREE.MeshLambertMaterial({ color: col(kd.bark), side: THREE.DoubleSide });
    const lo = col(kd.leaf[0]), hiC = col(kd.leaf[1]);
    for (const idx of cells.values()) {
      const crown = new THREE.InstancedMesh(kd.crown, crownMat, idx.length), trunk = new THREE.InstancedMesh(kd.trunk, trunkMat, idx.length);
      idx.forEach((i, j) => { const x = spots[i * 3], z = spots[i * 3 + 1], sc = spots[i * 3 + 2];
        e.set((hash(x, z, 2) - 0.5) * 0.1, hash(x, z, 3) * 6.283, (hash(x, z, 4) - 0.5) * 0.1); q.setFromEuler(e);
        m4.compose(v.set(x, hAt(x, z) - 0.3, z), q, s.set(sc, sc * (0.85 + hash(x, z, 5) * 0.3), sc));
        crown.setMatrixAt(j, m4); trunk.setMatrixAt(j, m4); crown.setColorAt(j, c.copy(lo).lerp(hiC, hash(x, z, 6))); });
      for (const m of [crown, trunk]) { m.castShadow = true; scene.add(m); } }
  });
  // bake a soft shadow under every tree into the ground texture (the minimap shows them too)
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < N; i++) { const r = 3.4 * spots[i * 3 + 2] * K; ctx.drawImage(blobTex, P(spots[i * 3]) - r, P(spots[i * 3 + 1]) - r, r * 2, r * 2); }
  ctx.globalAlpha = 1; texture.needsUpdate = true;
})();

// ---------- low-poly models ----------
// one geometry from [geometry, sRGB colour] parts; the colour attribute is left out when the parts have no colour
function mergeGeo(parts) {
  const pos = [], nor = [], cs = [], c = new THREE.Color();
  for (const [g0, hex] of parts) { const g = g0.index ? g0.toNonIndexed() : g0, a = g.attributes.position.array, n = g.attributes.normal.array;
    if (hex) c.set(hex).convertSRGBToLinear();
    for (let i = 0; i < a.length; i += 3) { pos.push(a[i], a[i + 1], a[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]); if (hex) cs.push(c.r, c.g, c.b); } }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (cs.length) g.setAttribute('color', new THREE.Float32BufferAttribute(cs, 3)); return g;
}
const boxPart = p => [new THREE.BoxGeometry(p[0], p[1], p[2]).translate(p[3], p[4], p[5]), p[6]];   // [sx, sy, sz, x, y, z, colour]
const boxGeo = parts => mergeGeo(parts.map(boxPart));
// a side profile (z, y; the front is -z) extruded across the car, with rounded edges
function extrude(pts, width, bevel) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]);
  const depth = width - 2 * bevel, g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 4 });
  return g.rotateY(-Math.PI / 2).translate(depth / 2, 0, 0);
}
const paintMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const carMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: col(0x555555) });   // glossy paint and glass
const GLASS = '#26323a', TYRE = '#1c1c1c';
const lamps = z => [[0.34, 0.16, 0.06, -0.6, 0.72, -z, '#fff6c8'], [0.34, 0.16, 0.06, 0.6, 0.72, -z, '#fff6c8'], [0.34, 0.16, 0.06, -0.6, 0.72, z, '#c8261c'], [0.34, 0.16, 0.06, 0.6, 0.72, z, '#c8261c']];
// car bodies: a bevelled side profile, round wheels and big black bumpers
const VOLVO_BODY = [[-2.4, 0.36], [2.4, 0.36], [2.4, 0.98], [-0.9, 0.98], [-2.4, 0.9]];
const PROFILES = {
  volvo: { body: VOLVO_BODY, glass: [[-0.9, 0.97], [2.1, 0.97], [1.95, 1.48], [-0.35, 1.48]], roof: [[-0.35, 1.47], [1.95, 1.47], [1.93, 1.54], [-0.33, 1.54]],
    w: 1.74, gw: 1.56, wz: [-1.5, 1.45], len: 4.8 },
  saab: { body: [[-2.3, 0.34], [2.3, 0.34], [2.3, 0.95], [-0.8, 0.92], [-2.3, 0.84]], glass: [[-0.8, 0.91], [2.15, 0.91], [2.1, 1.02], [0.75, 1.4], [-0.3, 1.4]],
    roof: [[-0.3, 1.39], [0.75, 1.39], [0.73, 1.45], [-0.28, 1.45]], w: 1.7, gw: 1.5, wz: [-1.45, 1.35], len: 4.6 },
  epa: { body: VOLVO_BODY, glass: [[-1.1, 0.97], [0.4, 0.97], [0.35, 1.5], [-0.7, 1.5]], roof: [[-0.7, 1.49], [0.35, 1.49], [0.33, 1.56], [-0.68, 1.56]],
    w: 1.74, gw: 1.56, wz: [-1.5, 1.4], len: 4.8,
    extra: c => [[1.74, 0.3, 0.08, 0, 1.1, 2.3, c], [0.08, 0.3, 1.8, -0.83, 1.1, 1.4, c], [0.08, 0.3, 1.8, 0.83, 1.1, 1.4, c], [0.5, 0.44, 0.05, 0, 1.2, 2.37, '#ff7a1a']] }
};
PROFILES.polis = Object.assign({}, PROFILES.volvo, { extra: () => [[1.78, 0.2, 3.2, 0, 0.7, 0.2, '#1f4fa3'], [1.79, 0.08, 3.2, 0, 0.56, 0.2, '#f2d21f']] });
const tyreGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 16).rotateZ(Math.PI / 2), hubGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.26, 10).rotateZ(Math.PI / 2);
const TRACTOR_CAB = { glass: [[0.05, 1.38], [1.45, 1.38], [1.45, 2.62], [0.25, 2.62], [0.05, 2.3]], gw: 1.35 };
// tractor: big rear wheels, small front wheels, a sloped bonnet and a glass cab (same size as the old box model)
function softTractor(c) {
  const parts = [[extrude([[-2.15, 0.78], [0.35, 0.78], [0.35, 1.52], [-1.85, 1.52], [-2.15, 1.3]], 0.95, 0.08), c],
    [extrude(TRACTOR_CAB.glass, TRACTOR_CAB.gw, 0.05), GLASS],
    [extrude([[-0.02, 2.6], [1.52, 2.6], [1.52, 2.72], [-0.02, 2.72]], 1.45, 0.04), c],
    [new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8).translate(0.3, 1.85, -1.6), '#333']];
  for (const x of [-1, 1]) {
    parts.push([new THREE.CylinderGeometry(0.8, 0.8, 0.5, 20).rotateZ(Math.PI / 2).translate(x * 0.95, 0.8, 0.9), TYRE], [new THREE.CylinderGeometry(0.42, 0.42, 0.52, 12).rotateZ(Math.PI / 2).translate(x * 0.95, 0.8, 0.9), c],
      [new THREE.CylinderGeometry(0.45, 0.45, 0.32, 16).rotateZ(Math.PI / 2).translate(x * 0.75, 0.45, -1.5), TYRE], [new THREE.CylinderGeometry(0.22, 0.22, 0.34, 10).rotateZ(Math.PI / 2).translate(x * 0.75, 0.45, -1.5), c]);
  }
  return mergeGeo(parts);
}
function softCar(t, c) {
  if (t === 'traktor') return softTractor(c);
  const P = PROFILES[t];
  const parts = [[extrude(P.body, P.w, 0.07), c], [extrude(P.glass, P.gw, 0.05), GLASS], [extrude(P.roof, P.gw + 0.04, 0.03), c]];
  for (const x of [-0.8, 0.8]) for (const z of P.wz) parts.push([tyreGeo.clone().translate(x, 0.32, z), TYRE], [hubGeo.clone().translate(x, 0.32, z), '#a3a39e']);
  for (const z of [-1, 1]) parts.push(boxPart([P.w + 0.1, 0.17, 0.18, 0, 0.5, z * (P.len / 2 + 0.05), '#2b2b2b']));
  for (const p of [...lamps(P.len / 2 + 0.07), ...(P.extra ? P.extra(c) : [])]) parts.push(boxPart(p));
  return mergeGeo(parts);
}
const geoCache = {};
const carGeo = (t, c) => geoCache[t + c] || (geoCache[t + c] = softCar(t, c));
const BAR_BLUE = col(0x2f6bff), BAR_RED = col(0xff3b30);
const barMat = new THREE.MeshBasicMaterial({ color: BAR_BLUE.clone() }), barGeo = new THREE.BoxGeometry(1.1, 0.16, 0.3);
function personParts(shirt, pants, hair, arms) {     // arms: separate meshes that swing from the shoulder (two more draw calls, so only the player has them)
  hair = hair || '#5a4632';
  const bk = shirt + hair + (arms ? '+arms' : ''), body = geoCache[bk] || (geoCache[bk] = boxGeo([[0.5, 0.65, 0.28, 0, 1.13, 0, shirt], [0.27, 0.27, 0.27, 0, 1.62, 0, '#e2b796'], [0.29, 0.1, 0.29, 0, 1.78, 0, hair]]
    .concat(arms ? [] : [[0.14, 0.6, 0.16, -0.33, 1.12, 0, shirt], [0.14, 0.6, 0.16, 0.33, 1.12, 0, shirt]])));
  const leg = geoCache[pants] || (geoCache[pants] = boxGeo([[0.19, 0.8, 0.21, 0, -0.4, 0, pants]]));
  const g = new THREE.Group(), b = new THREE.Mesh(body, paintMat), l = new THREE.Mesh(leg, paintMat), r = new THREE.Mesh(leg, paintMat);
  l.position.set(-0.13, 0.8, 0); r.position.set(0.13, 0.8, 0); b.castShadow = l.castShadow = r.castShadow = true;
  g.add(b, l, r); g.legs = [l, r]; g.blob = blob(g, 0.9, 0.9);
  if (arms) { const ag = geoCache['arm' + shirt] || (geoCache['arm' + shirt] = boxGeo([[0.14, 0.6, 0.16, 0, -0.3, 0, shirt]]));
    g.arms = [-0.33, 0.33].map(x => { const a = new THREE.Mesh(ag, paintMat); a.position.set(x, 1.42, 0); a.castShadow = true; g.add(a); return a; }); }
  return g;
}

// ---------- cars ----------
// the rules (driving, traffic, the parked cars) are in src/game/cars.ts; the meshes in src/game/render/car-meshes.ts
// the getters are read when they are used, so they can name things declared further down
const bodyMotion = new BodyMotion();
const vehicleVisuals = new VehicleVisuals(coarse, (c, body) => bodyMotion.addNode(c, body));
const carMeshes = new CarMeshes({ scene, groundAt, normalAt, carGeo, carMat, blob, barGeo, barMat, vehicleVisuals, bodyMotion });
const placeCar = carMeshes.placeCar.bind(carMeshes);
// the car gets its meshes, then the Fleet holds it, so a car in the list always has them; the rolls keep their order: the model (its own stream), then the colour (rnd)
function addCar(type, x, z, h, mode, assetId = carMeshes.pickModel(type)) {
  const T = specFor(type, vehicleDefinition(assetId ?? null));
  return fleet.add(carMeshes.attach(newCar(type, x, z, h, mode, T, pick(T.cols)), assetId));
}
function removeCar(c) { carMeshes.detach(c); fleet.remove(c); }
const fleet = new Fleet({ roads, buildings, water, half: HALF, rnd, pick, addCar, placeCar, crash,
  canPark: (x, z) => streetIndex.surfaceAt(x, z) === null,   // streetIndex is built before parkCars runs
  rammed: c => { if (c === game.pcar && game.ramCool <= 0) { game.ramCool = 6; wanted.addStar('Ramming a police car. That will not help.'); } },
  get player() { return player; }, get inCar() { return game.inCar; } });
const { cars } = fleet, drive = fleet.drive.bind(fleet), advance = fleet.advance.bind(fleet), spawnTraffic = fleet.spawnTraffic.bind(fleet), updateTraffic = fleet.updateTraffic.bind(fleet);
const selectedVehicle = vehicleDefinition(new URLSearchParams(location.search).get('vehicle'));
let displayCar = null;
function carName(c) { return vehicleVisuals.definition(c)?.name || c.T.name; }
fleet.parkCars();   // parked cars along streets and driveways
for (let i = 0; i < 18; i++) spawnTraffic(null);

// one hit: both cars take the damage (crashCars in health.ts), and the player too if they're in one. This only adds what you hear and feel;
// the glass cracks in updateSmoke
const POLICE_WRECK_SEEN_M = 80;                // "the police car is wrecked" only when it happens this close to the camera
function crash(c, o, impact) {
  const hits = crashCars(game.clockS, impact, c, o); if (!hits.length) return;
  let said = false;   // one line per crash: wrecked, then smoke, then the crash itself
  for (const { car: k, wrecked: w, smokeUp } of hits) {
    if (w && k === game.pcar) { const cat = catAboard(); toast((cat ? '”Ut, ' + cat.name + '! Den här bilen ä slut.”\n”Mjäu.”' : pickLine(WRECK_LINES)) + ' The car is wrecked. Get out and find another.', 4); said = true; }
    else if (w && k.mode === 'police' && Math.hypot(k.x - camera.position.x, k.z - camera.position.z) < POLICE_WRECK_SEEN_M) { toast('The police car is wrecked.', 3); said = true; }
    else if (smokeUp && k === game.pcar) { toast(SMOKE_LINES[smokeLevel(k.dmg)], 3); said = true; } }
  if (hits.some(h => h.car === game.pcar)) { const n = driverHurt(impact); hurtPlayer(n); shake(crashDamage(impact));
    const cat = catAboard();   // with your cat along, any real crash is about the cat; without, only one that hurts you
    if ((n > 0 || cat) && !said && game.clockS - crashLineAt > CRASH_LINE_S) { crashLineAt = game.clockS; toast(cat ? '”Förlåt, ' + cat.name + '! Ä du hel?”\n”Fräs!”' : pickLine(CRASH_LINES), 2.5); } }
}
// what you say about a crash (#213 moves these into a speech bubble over you); picked from their own random stream, so they don't shift the world's rolls
const lineRnd = makeRnd(213), pickLine = a => a[Math.floor(lineRnd() * a.length)];
const CRASH_LINE_S = 6;                        // at most one "that hurt" line this often (s)
const CRASH_LINES = ['”AJ! Dä där kändes i nacken.”', '”Hoppsan. Dä där va inte meningen.”', '”Va fan, vem satte dit den där?!”'];
const WRECK_LINES = ['”Nä, nu ä den kaputt.”', '”Dä va dä, den bilen.”', '”Den rullar inte mer, den.”'];
const SMOKE_LINES = [null, '”Hörru, dä ryker ur motorn!”', '”Svart rök… dä ä inte bra, dä.”'];   // by smokeLevel
let crashLineAt = -9;
let runOverAt = -9;   // the player's own cooldown for being run over, apart from the cars' crash cooldowns
// your cat riding in your car: then the lines are about it (you first, then the cat, each on their own line)
const catAboard = () => colony.owned && colony.owned.ride === game.pcar ? colony.owned : null;
const CAT_FAST_MS = 25, CAT_CALM_MS = 20;      // above ~90 km/h with your cat along you tell it to hold on; it can come again once you've been below ~72 km/h
let catFastSaid = false;
function catRideLines() { const cat = game.inCar && catAboard(), v = game.inCar ? Math.abs(game.pcar.v) : 0;
  if (cat && v > CAT_FAST_MS && !catFastSaid) { catFastSaid = true; toast('”Håll i dä, ' + cat.name + '!”\n”MJAAAU!”', 2.5); }
  else if (v < CAT_CALM_MS) catFastSaid = false; }

// camera shake on a crash: a jolt that dies away, bigger for a harder hit; none with reduced motion
const SHAKE_S = 0.45, SHAKE_MIN_M = 0.08, SHAKE_MAX_M = 0.5, SHAKE_PER_DMG_M = 1 / 150;   // s it lasts; camera offset (m) at the smallest and largest hit, and per point of car damage
const calmMotion = matchMedia('(prefers-reduced-motion: reduce)');
let shakeT = 0, shakeM = 0;
const dmgRnd = makeRnd(808);                   // own stream for the shake and the smoke puffs, which roll every frame
function shake(dmg) { if (calmMotion.matches) return; const m = Math.min(SHAKE_MAX_M, SHAKE_MIN_M + dmg * SHAKE_PER_DMG_M); if (shakeT <= 0 || m > shakeM) shakeM = m; shakeT = SHAKE_S; }


// ---------- drift effects: sparks at the rear wheels, a flame while boosting, skid marks (src/game/render/drift-fx.ts) ----------
const driftFx = new DriftFx({ scene, groundAt, profiles: PROFILES, turboAt: TURBO_AT }), updateDriftFx = driftFx.update.bind(driftFx);

// ---------- pedestrians: walk the streets and footpaths, now and then stop for a while (src/game/pedestrians.ts) ----------
// the getters are read when the pedestrians use them, so they can name things declared further down
const crowd = new Crowd({ scene, roads, buildings, labels: D.labels, groundAt, walkOffset, coarse, wrap, rnd, pick, personParts, advance, cars,
  get player() { return player; }, get inCar() { return game.inCar; } });
const updateNpcs = crowd.update.bind(crowd);

// ---------- cats: lounge by the house walls, wander a little, bolt from cars and running feet (src/game/cats.ts) ----------
// the getters are read when the cats use them, so they can name things declared further down
const colony = new CatColony({ scene, buildings, inWater, groundAt, half: HALF, coarse, wrap, geoCache, boxGeo, paintMat, blob, cars, toast,
  get player() { return player; }, get keys() { return keys; }, get joy() { return joy; }, get kmenu() { return kmenu; }, get inCar() { return game.inCar; }, get pcar() { return game.pcar; }, get inside() { return places.inside; },
  useTreat() { if (game.treats <= 0) return false; game.treats--; drawTreats(); return true; }, scratched() { hurtPlayer(CAT_SCRATCH_HP); } });
const { cats } = colony, updateCats = colony.update.bind(colony), catFirst = colony.catFirst.bind(colony), nearCat = colony.nearest.bind(colony);
// ---------- your pets: P (or the Pets button) calls them, sends them home or sets them free (src/game/pets.ts) ----------
// small menus on one plate (the kiosk, a cat, your pets, naming a pet: src/game/menu.ts)
// the getters are read when the plate uses them, so they can name things declared further down
const kmenu = $('kmenu');
const menuPlate = new MenuPlate({ kmenu, canvas, doc: document, get input() { return input; }, get hasPets() { return !!colony.owned; }, openPets: () => openPets(), toast });
const { openMenu, closeMenu, openRename, menuKey } = menuPlate;
// the getter is read when a pet is called, so it can name things declared further down
const pets = new Pets({ colony, button: $('pets'), openMenu, openRename, esc, get caller() { return game.inCar ? game.pcar : player; } });
const openPets = pets.open.bind(pets), drawPets = pets.draw.bind(pets);
// ---------- the adopt heart: hovers over a stray once it has had a good pet, a third fuller for each good pet in a row (src/game/render/adopt-heart.ts) ----------
const adoptHearts = new AdoptHearts({ scene, colony }), showHeart = adoptHearts.show.bind(adoptHearts), drawHearts = adoptHearts.update.bind(adoptHearts);
$('pets').addEventListener('click', () => { if (menuPlate.menuKind === 'pets') closeMenu(); else openPets(); canvas.focus(); });   // from the kiosk or adopt menu too
function drawTreats() { const el = $('treats'); el.hidden = false; el.textContent = 'Cat treats: ' + game.treats; }

// ---------- player (walking, jumping, getting out: src/game/player.ts) ----------
const player = { x: HOME.x, z: HOME.z, y: 0, vy: 0, h: 0, speed: 0, phase: 0, mesh: personParts('#f2c230', '#2b3a55', null, true) };   // y: metres above the ground
collide(player, 0.6); scene.add(player.mesh);
const jumpOk = () => !game.inCar && !places.inside && game.bigT <= 0;   // queue only where a jump can start, so a press inside a safehouse or under Gripen! can't fire as it ends
(function () { const o = { x: player.x + 7, z: player.z + 3 }; collide(o, 2.6); displayCar = addCar(selectedVehicle?.archetype || 'volvo', o.x, o.z, 0.6, 'parked', selectedVehicle?.id ?? 'volvo240'); })();
const health = newHealth();
const peds = [];
const wanted = new Wanted({ roads, rnd, pick, wrap, removeCar, drive, toast,
  spawnCar: (x, z, h) => addCar('polis', x, z, h, 'police'),
  drawStars: () => drawStars(), showEvading: on => $('stars').classList.toggle('evading', on), caught: () => busted(),
  get lyingLow() { return !!places.inside; } });

// ---------- places: safehouses (lie low to lose your stars) and the trisslott kiosk ----------
// the getter is read when a place uses it, so it follows the stars
const places = new Places({ footprints: bPolys, roads: R, police: wanted.police, lieLow: secs => wanted.lieLow(secs), toast, get stars() { return wanted.stars; } });
const placeMeshes = new PlaceMeshes({ scene, places, heightAt: hAt, col, boxGeo, paintMat, glass: GLASS });
addFootprint([KIOSK.x - KIOSK.w / 2, KIOSK.z - KIOSK.d / 2, KIOSK.x + KIOSK.w / 2, KIOSK.z - KIOSK.d / 2, KIOSK.x + KIOSK.w / 2, KIOSK.z + KIOSK.d / 2, KIOSK.x - KIOSK.w / 2, KIOSK.z + KIOSK.d / 2]);   // the kiosk collides like a building
// the kiosk's and the cats' menus (src/game/kiosk-cat-menus.ts); trisslott is declared further down
const kioskCatMenus = new KioskCatMenus({ game, player, colony, health, openMenu, esc, toast, scratch: () => trisslott.scratch(), nearPlace, showHeart, drawPets, drawTreats, drawHealth });
const { openKiosk, petCat, openOwnCat } = kioskCatMenus;
function nearPlace() { return game.inCar ? null : places.nearest(player.x, player.z); }
function enterHouse(p) { if (places.enter(p, player)) player.mesh.visible = false; }
function leaveHouse() { if (!places.leave()) return; player.mesh.visible = true; $('hide').hidden = true; }
// ---------- car damage: cracked glass, and smoke from the bonnet (src/game/render/car-damage.ts) ----------
const carDamage = new CarDamageFx({ scene, groundAt, profiles: PROFILES, tractorCab: TRACTOR_CAB, vehicleVisuals, rnd: dmgRnd, cars }), updateSmoke = carDamage.updateSmoke.bind(carDamage);

// trisslott (src/game/trisslott.ts)
// biome-ignore lint/plugin/no-math-random: the known exception in AGENTS.md (rule 5); a ticket's luck isn't world state to replay
const trisslott = new Trisslott({ random: Math.random, pick, now: () => performance.now() / 1000, toast,
  draw: (bought, won) => { const el = $('triss'); el.hidden = false; el.textContent = 'Trisslotter: ' + bought + ' · Vinster: ' + won; } });
const START_CAM = [0.6, 0.34];   // camera yaw and pitch at Start
const view = newViewState(START_CAM[0], START_CAM[1]);
// ?at=x,z[,yaw[,pitch]] starts the player there, looking that way: for review screenshots, such as the streetscape's (#187)
(function () { const at = (new URLSearchParams(location.search).get('at') || '').split(',').map(Number);
  if (at.length < 2 || !at.every(Number.isFinite)) return; player.x = at[0]; player.z = at[1]; if (at.length > 2) view.camYaw = START_CAM[0] = at[2]; if (at.length > 3) START_CAM[1] = clamp(at[3], 0.06, 1.25); })();

// ---------- input: keys, mouse look and the touch controls (src/game/input.ts) ----------
const input = new Input({ win: window, doc: document, canvas, $, coarse, menuKey,
  get started() { return game.started; }, get menuOpen() { return !kmenu.hidden; },
  action: () => action(), respawn: () => respawn(),
  jump: () => { if (jumpOk()) game.jumpQ = true; },   // queue only where a jump can start (see jumpOk)
  look: (dx, dy) => { if (game.inCar) { view.lookOff = wrap(view.lookOff + dx * 0.006); view.lookIdle = 0; } else view.camYaw = wrap(view.camYaw + dx * 0.006);
    view.camPitch = clamp(view.camPitch + dy * 0.004, 0.06, 1.25); },
  lockLost: () => { if (!hud.toasting) toast('Click the game to look around with the mouse again.', 3); } });
const { keys, joy } = input;

// ---------- HUD (src/game/hud.ts) ----------
// the getters are read when the HUD uses them, so they can name things that change during play
const hud = new Hud({ $, ground: tex2d, P, K, roads, labels: D.labels, cars, places: places.list,
  get stars() { return wanted.stars; }, get pcar() { return game.pcar; }, get blink() { return blink; } });
// a declaration, not a bound const, so the sections above can pass toast on before the HUD exists
function toast(msg, secs, cls) { hud.toast(msg, secs, cls); }
const drawStars = hud.drawStars.bind(hud), drawMini = hud.drawMini.bind(hud), updateSign = hud.updateSign.bind(hud);
// a line that waits for the toast and any big screen to clear, so it doesn't cut off what was just said
let laterLine = null;
const sayLater = line => { laterLine = line; };
drawStars();
function drawHealth() { hud.drawHealth(health.hp, game.inCar ? game.pcar.dmg : null); }
let signT = 0, blink = false, blinkT = 0;

// ---------- stealing and getting caught (the wanted level and the police: src/game/police.ts) ----------
function bigScreen(title, msg) { $('big-t').textContent = title; $('big-p').textContent = msg; game.bigT = 3; $('big').hidden = false; hud.hideToast(); }   // the big screen replaces any line from the same moment
// what E does, and putting you back on your feet after Gripen! or a knock-out (src/game/actions.ts)
const actions = new Actions({ game, view, player, cars, places, wanted, health, menuOpen: () => !kmenu.hidden, closeMenu, showPlayer: v => { player.mesh.visible = v; }, nearPlace, enterHouse, leaveHouse, nearCat, catFirst, openOwnCat, petCat, openKiosk, collide, placeCar, rnd, pick, toast, carName,
  spokenName: c => vehicleVisuals.definition(c)?.spokenName, driverOut, spawnTraffic, drawStolen: () => { $('count').textContent = 'Cars stolen: ' + game.stolen; }, drawHealth, bigScreen, sayLater, pickLine });
const { nearestCar, action, respawn, busted, knockedOut } = actions;
// the driver of a car you steal gets out, and stands there shouting for a while
function driverOut(c) {
  const p = personParts(pick(['#b5463a', '#3f6b8a', '#5c7a4a', '#7a5a8a']), '#3a3a3a');
  p.position.set(c.x - Math.cos(c.h) * 2.2, 0, c.z - Math.sin(c.h) * 2.2); p.position.y = groundAt(p.position.x, p.position.z); p.ttl = 14; scene.add(p); peds.push(p);
}
function hurtPlayer(n) { if (n <= 0) return; const was = health.hp;
  const el = $('hurt'); el.style.transition = 'none'; el.style.opacity = Math.min(1, 0.45 + n / 40); void el.offsetWidth; el.style.transition = ''; el.style.opacity = 0;   // a red flash that fades
  hurt(health, n); drawHealth();
  if (was >= LOW_HP && health.hp < LOW_HP && health.hp > 0) sayLater('”Ja behöver nog en korv me brö.”'); }   // a hint at the kiosk

// ---------- main loop ----------
function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  const mx = game.started ? clamp((keys.right ? 1 : 0) - (keys.left ? 1 : 0) + joy.x, -1, 1) : 0, my = game.started ? clamp((keys.up ? 1 : 0) - (keys.down ? 1 : 0) + joy.y, -1, 1) : 0;
  game.clockS += dt; if (game.started) regen(health, dt);
  if (health.hp <= 0) knockedOut();   // here, not where the hit lands: that can be halfway through moving the car
  if (game.bigT > 0) { game.bigT -= dt; if (game.bigT <= 0) $('big').hidden = true; }
  if (game.ramCool > 0) game.ramCool -= dt;
  trisslott.update(dt);
  placeMeshes.update(dt);

  const jump = game.jumpQ; game.jumpQ = false;
  if (game.inCar) { drive(game.pcar, my, mx, !!keys.brake, dt, true); ride(player, game.pcar); }
  else {
    walk(player, dt, mx, my, view.camYaw, { run: !!keys.run || joy.on, wet: inWater(player.x, player.z), still: game.bigT > 0 || !!places.inside }, HALF);
    collide(player, 0.5);
    if (!places.inside) for (const c of cars) { const dx = player.x - c.x, dz = player.z - c.z, d = Math.hypot(dx, dz); if (d < 1.6 && d > 0.01) { player.x += dx / d * (1.6 - d); player.z += dz / d * (1.6 - d);
      const a = c.mode === 'ai' ? c.h : c.vh, n = runOverHurt(impactSpeed(Math.sin(a) * c.v, -Math.cos(a) * c.v, -dx / d, -dz / d));   // the car's speed towards you
      if (n > 0 && game.clockS - runOverAt >= CRASH_COOL_S) { runOverAt = game.clockS; hurtPlayer(n); shake(n); if (health.hp <= 0) break; } } }
    const wetNow = inWater(player.x, player.z);                // after this frame's move: take-off and wading depth follow where the player stands now
    hop(player, dt, jump && !wetNow && !places.inside && game.bigT <= 0);   // on foot, Space and the touch Brake button jump
    // walking: arms swing against the legs and the body bobs; in the air: legs apart and both arms up
    const air = player.y > 0, sw = air ? 0.5 : Math.sin(player.phase) * 0.75, lift = player.y + (air ? 0 : Math.abs(Math.sin(player.phase)) * 0.05), m = player.mesh;
    m.legs[0].rotation.x = sw; m.legs[1].rotation.x = -sw; m.arms[0].rotation.x = air ? 2.4 : -sw * 0.8; m.arms[1].rotation.x = air ? 2.4 : sw * 0.8;
    m.blob.position.y = 0.06 - lift;                          // the blob shadow stays on the ground
    m.position.set(player.x, groundAt(player.x, player.z) - (wetNow ? 0.95 : 0) + lift, player.z); m.rotation.y = -player.h;
  }
  updateDriftFx(game.inCar ? game.pcar : null);
  const T = game.inCar ? game.pcar : player;
  vehicleVisuals.update(T, dt);
  updateSmoke(dt, T);
  for (const c of cars) if (c.mode === 'ai') updateTraffic(c, dt);
  updateNpcs(T, dt);
  updateCats(T, dt);
  if (wanted.update(dt, T, player.speed)) {
    blinkT += dt; if (blinkT > 0.22) { blinkT = 0; blink = !blink; barMat.color.copy(blink ? BAR_RED : BAR_BLUE); }
  }
  for (let i = peds.length - 1; i >= 0; i--) { const p = peds[i]; p.ttl -= dt; p.rotation.y = -Math.atan2(T.x - p.position.x, -(T.z - p.position.z));
    if (p.ttl <= 0) { scene.remove(p); peds.splice(i, 1); } }
  bodyMotion.update(T, dt);                                  // after every car has moved this frame

  // camera
  let dist, ty = groundAt(T.x, T.z);
  if (!game.started) { view.camYaw = wrap(view.camYaw + dt * 0.07); dist = 46; view.camPitch = 0.42; }
  else if (game.inCar) { view.lookIdle += dt; if (view.lookIdle > 1.2 && !input.dragging) view.lookOff *= Math.pow(0.02, dt);
    view.camYaw += wrap(game.pcar.h - game.pcar.slip * 0.6 + view.lookOff - view.camYaw) * Math.min(1, dt * 4.5); dist = 10 + Math.abs(game.pcar.v) * 0.09; }
  else dist = places.inside ? 15 : 6.2;
  const cp = Math.cos(view.camPitch), cx = T.x - Math.sin(view.camYaw) * dist * cp, cz = T.z + Math.cos(view.camYaw) * dist * cp;
  camera.position.set(cx, Math.max(ty + 1.5 + dist * Math.sin(view.camPitch), hAt(cx, cz) + 0.8), cz);
  camera.lookAt(T.x, ty + 1.5, T.z);
  if (shakeT > 0) { shakeT -= dt; const k = Math.max(0, shakeT / SHAKE_S) ** 2 * shakeM * 2;   // eases out, so the jolt fades instead of stopping dead
    camera.position.x += (dmgRnd() - 0.5) * k; camera.position.y += (dmgRnd() - 0.5) * k; camera.position.z += (dmgRnd() - 0.5) * k; }
  sun.target.position.set(T.x, ty, T.z); sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 400);
  skyDome.update(camera.position, now / 1000, dt); sun.intensity = SUN_I * skyDome.sunFactor;   // also centres the dome

  // HUD
  drawHearts(dt);
  hud.update(dt);
  if (!hud.toasting && laterLine && game.bigT <= 0) { toast(laterLine, 3); laterLine = null; }
  signT -= dt; if (signT <= 0) { signT = 0.25; updateSign(T); catRideLines();
    const pr = $('prompt'), pl = game.started && !places.inside ? nearPlace() : null, kt = game.started ? nearCat() : null, c = game.started && !game.inCar && !places.inside ? nearestCar() : null;
    $('hide').hidden = !places.inside;
    menuPlate.closeIfLeft();
    if (places.inside) { $('hide').innerHTML = wanted.stars ? 'Lying low<b>' + Math.floor(Math.ceil(Math.max(0, wanted.hideLeft)) / 60) + ':' + String(Math.ceil(Math.max(0, wanted.hideLeft)) % 60).padStart(2, '0') + '</b>' : 'Safehouse · ' + places.inside.name;
      pr.hidden = false; pr.innerHTML = '<kbd>E</kbd>Go outside'; }
    else if (catFirst(kt, pl)) { pr.hidden = !kmenu.hidden; pr.innerHTML = '<kbd>E</kbd>' + (kt.owned ? 'Hang out with ' + esc(kt.name) : 'Pet the cat' + (game.treats ? ' (offer a treat)' : '')); }
    else if (pl) { pr.hidden = !kmenu.hidden; pr.innerHTML = '<kbd>E</kbd>' + (pl.kind === 'safe' ? 'Go inside the safehouse' : 'Handla i kiosken'); }
    else if (game.inCar && !coarse) { pr.hidden = tooFastToGetOut(game.pcar); pr.innerHTML = '<kbd>E</kbd>Get out'; }
    else if (c) { pr.hidden = false; pr.innerHTML = '<kbd>E</kbd>' + (c.owned ? 'Get in the ' : 'Steal the ') + carName(c) + (wrecked(c) ? ' (wrecked)' : ''); }
    else pr.hidden = true;
    const bl = game.inCar ? 'Brake' : 'Jump'; if ($('p-brake').textContent !== bl) $('p-brake').textContent = bl;
    $('speed').hidden = !game.inCar; if (game.inCar) { $('kmh').textContent = Math.round(Math.abs(game.pcar.v) * 3.6); $('carname').textContent = carName(game.pcar) + (wrecked(game.pcar) ? ' · wrecked' : ''); }
    drawHealth(); }
  drawMini(T);
  renderer.render(scene, camera);
}
$('go').addEventListener('click', e => { game.started = true; $('intro').hidden = true; view.camYaw = START_CAM[0]; view.camPitch = START_CAM[1]; canvas.focus();
  if (e.pointerType ? e.pointerType === 'mouse' : !coarse) input.lockMouse();   // by how Start was pressed: a tap on a touchscreen laptop shouldn't lock
  toast('Find a car and press E to take it. Occupied cars always get you a wanted star.', 5); });
resize(); requestAnimationFrame(frame);

// ---------- test hook: read-only state for the smoke tests (tests/e2e), so they do not have to read pixels ----------
window.__joyride = { state: () => { const n = nearestCar(); return { started: game.started, lab: lab.list(), x: player.x, z: player.z, y: player.y, yaw: view.camYaw, inCar: game.inCar, car: game.pcar ? game.pcar.type : null, near: n ? n.mode : null, speed: game.pcar ? game.pcar.v : 0, drift: game.pcar ? game.pcar.drift : 0, boost: game.pcar ? game.pcar.boost : 0, charge: game.pcar ? game.pcar.charge : 0, loose: game.pcar ? game.pcar.loose : 0, flickDir: game.pcar ? game.pcar.flickDir : 0, flickHeld: game.pcar ? game.pcar.flickHeld : 0, stars: wanted.stars, cats: cats.length, treats: game.treats, hp: health.hp, carDmg: game.pcar ? game.pcar.dmg : null, ownCat: !!colony.owned, vehicle: displayCar ? vehicleVisuals.state(displayCar) : null, nearSelectedVehicle: n === displayCar, activeVehicle: game.pcar ? vehicleVisuals.state(game.pcar) : null, body: game.pcar ? bodyMotion.state(game.pcar) : null, wheelbase: (game.pcar || displayCar)?.T.handling.wheelbaseM ?? 0, traffic: cars.filter(c => c.mode === 'ai').map(c => ({ type: c.type, vehicle: vehicleVisuals.state(c) })), clouds: skyDome.state(), streetscape: streetscapeState() }; } };
function streetscapeState() { const L = street.layout, m = L.sidewalkM, r = v => Math.round(v);
  return { sidewalkM: { mapped: r(m.mapped), derived: r(m.derived), inferred: r(m.inferred) }, parkingAreas: L.lots.length, crossings: L.crossings,
    streetTrees: { mapped: L.trees.filter(t => t.source === 'mapped').length, inferred: L.trees.filter(t => t.source === 'inferred').length },
    meshes: street.meshes.length, triangles: street.tris, buildMs: Math.round(street.ms), debug: DEBUG_STREETSCAPE }; }
})();
