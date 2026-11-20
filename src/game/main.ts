// @ts-nocheck
// Moved as-is from the single-file prototype (#44); it gets types as it is split into modules.
import * as THREE from 'three';
import { AdoptHearts } from './render/adopt-heart';
import { DriftFx } from './render/drift-fx';
import { pickVariant, vehicleDefinition } from './render/vehicle-registry';
import { Sky } from './render/sky';
import { VehicleVisuals } from './render/vehicle-visuals';
import { BodyMotion } from './render/body-motion';
import { approach, rearPivotShift, yawRate } from './sim/handling';
import { specFor } from './sim/vehicle-spec';
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
import { nodeKey, RoadNetwork } from '../world/roads';
import { buildStreetscape, sidewalkCentreM, StreetscapeIndex } from '../world/streetscape';
import { STREETSCAPE_OVERRIDES } from '../world/streetscape-overrides';
import { classifyStreetscape } from '../world/streetscape-rules';
import { LEGACY_LIGHT } from '../world/three-legacy';
import { treeSpots } from '../world/trees';
import { Water } from '../world/water';
import { CatColony } from './cats';
import { Hud } from './hud';
import { Input } from './input';
import { Crowd } from './pedestrians';
import { Pets } from './pets';
import { Commands, parseKr, UsageError } from './commands';
import { Confetti, confettiCount } from './confetti';
import { DevConsole, isConsoleKey } from './devconsole';
import { earn, fine, fmtKr, KORV_KR, newWallet, pay, RAIN_KR, RULLE_KR, TREATS_KR, TRISS_KR } from './economy';
import { KIOSK, Places } from './places';
import { CAT_SCRATCH_HP, crackLevel, LOW_HP, CRASH_COOL_S, crashCars, crashDamage, driverHurt, HP_MAX, heal, hurt, KORV_HP, impactSpeed, newHealth, regen, RULLE_HP, runOverHurt, smokeLevel, topSpeedShare, wakeSpot, wrecked } from './health';
import { carInReach, HOME, hop, ride, standAt, stepOut, tooFastToGetOut, walk } from './player';
import { Wanted } from './police';
import { PlaceMeshes } from './render/places';
import { BIG_WIN_KR, Trisslott } from './trisslott';

(function () {
'use strict';
const $ = id => document.getElementById(id);
const S = D.size, HALF = S / 2;
// seeded streams: rnd() drives the world and gameplay; side systems get their own stream so they don't shift its rolls
const rnd = makeRnd(57355);
const pick = a => a[Math.floor(rnd() * a.length)];

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
const roads = new RoadNetwork(D, heightfield), { lines: R, junctions: nodes, driveable } = roads;
let streetIndex = null;   // the streetscape's walkable height, built further down once the buildings and trees are known
// what people, cats and cars stand on: the road, or the curb, pavement or parking area above it
const nearestRoad = roads.nearestRoad.bind(roads), groundAt = (x, z) => { const g = roads.groundAt(x, z), s = streetIndex && streetIndex.surfaceAt(x, z); return s !== null && s > g ? s : g; };
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
const cars = [];
const bodyMotion = new BodyMotion();
const vehicleVisuals = new VehicleVisuals(coarse, (c, body) => bodyMotion.addNode(c, body));
const modelRnd = makeRnd(240);                 // own stream: which model a car wears doesn't shift the world's rolls
const selectedVehicle = vehicleDefinition(new URLSearchParams(location.search).get('vehicle'));
// dev mode (#218): on with npm run dev, or with ?dev on any build (preview links too). § or ` then opens the dev console.
const DEV = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');
let displayCar = null;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _m = new THREE.Matrix4();
function placeCar(c) {
  const n = normalAt(c.x, c.z);
  _f.set(Math.sin(c.h), 0, -Math.cos(c.h)); _f.addScaledVector(n, -_f.dot(n)).normalize(); _r.crossVectors(_f, n);
  _m.makeBasis(_r, n, _f.negate()); c.mesh.quaternion.setFromRotationMatrix(_m);
  c.mesh.position.set(c.x, groundAt(c.x, c.z) - (c.wet ? 0.55 : 0), c.z);
  vehicleVisuals.sync(c);
}
function addCar(type, x, z, h, mode, assetId = pickVariant(type, modelRnd())) {
  const T = specFor(type, vehicleDefinition(assetId)), color = pick(T.cols), fallback = new THREE.Mesh(carGeo(type, color), carMat), mesh = new THREE.Group();
  fallback.castShadow = true; mesh.add(fallback); blob(mesh, 2.8, 5.8);   // the fallback sits apart from the blob, so it can roll on its springs
  if (type === 'polis') { const bar = new THREE.Mesh(barGeo, barMat); bar.position.set(0, 1.62, 0.2); fallback.add(bar); }
  const c = { type, T, mesh, x, z, h, vh: h, v: 0, st: 0, thr: 0, slip: 0, drift: 0, charge: 0, yr: 0, spin: 0, loose: 0, flickDir: 0, flickT: 9, flickHeld: 0, boost: 0, mode, wet: false, owned: false, blocked: 0, ghost: 0, stuck: 0, rev: 0, revSteer: 1, dmg: 0, hitAt: -9, body: fallback };
  scene.add(mesh); cars.push(c); placeCar(c); bodyMotion.add(c, T.suspension, fallback); if (assetId) { vehicleVisuals.attach(c, assetId, fallback, color); } return c;
}
function carName(c) { return vehicleVisuals.definition(c)?.name || c.T.name; }
function removeCar(c) { vehicleVisuals.dispose(c); bodyMotion.remove(c); scene.remove(c.mesh); const i = cars.indexOf(c); if (i >= 0) cars.splice(i, 1); }
const civType = () => { const r = rnd(); return r < 0.45 ? 'volvo' : r < 0.75 ? 'saab' : r < 0.9 ? 'epa' : 'traktor'; };
// parked cars along streets and driveways
(function () {
  let count = 0;
  for (let tries = 0; tries < 900 && count < 58; tries++) {
    const r = pick(R); if (r.c !== 2 && r.c !== 3) continue;
    const i = 1 + Math.floor(rnd() * (r.p.length - 1)), a = r.p[i - 1], b = r.p[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 6) continue;
    const t = rnd(), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, side = rnd() < 0.5 ? 1 : -1, off = (ROAD_W[r.c] / 2 + 1.35) * side;
    const o = { x: a[0] + (b[0] - a[0]) * t - dz * off, z: a[1] + (b[1] - a[1]) * t + dx * off };
    if (Math.abs(o.x) > HALF - 20 || Math.abs(o.z) > HALF - 20) continue;
    const ox = o.x, oz = o.z; if (collide(o, 2.6) || inWater(ox, oz) || streetIndex.surfaceAt(ox, oz) !== null) continue;   // not on a curb, verge or pavement
    if (cars.some(c => Math.hypot(c.x - ox, c.z - oz) < 7)) continue;
    addCar(civType(), ox, oz, Math.atan2(dx, -dz) + (side < 0 ? Math.PI : 0), 'parked'); count++;
  }
})();
// traffic that follows the street network
function advance(c, graph) {
  const b = c.a + c.dir, l = (graph || nodes).get(nodeKey(R[c.ri].p[b])) || [], opts = []; let straight = null;
  for (let i = 0; i < l.length; i += 2) { const ri = l[i], vi = l[i + 1], len = R[ri].p.length;
    for (const dir of [1, -1]) { if (dir > 0 ? vi >= len - 1 : vi <= 0) continue;
      if (ri === c.ri && vi === b && dir === -c.dir) continue;
      const o = { ri, a: vi, dir }; opts.push(o); if (ri === c.ri && vi === b && dir === c.dir) straight = o; } }
  const o = straight && rnd() < 0.65 ? straight : opts.length ? pick(opts) : { ri: c.ri, a: b, dir: -c.dir };
  c.ri = o.ri; c.a = o.a; c.dir = o.dir;
}
function spawnTraffic(farFrom) {
  for (let t = 0; t < 40; t++) {
    const ri = pick(driveable), r = R[ri], a = Math.floor(rnd() * (r.p.length - 1)), p = r.p[a];
    if (farFrom && Math.hypot(p[0] - farFrom.x, p[1] - farFrom.z) < 260) continue;
    const type = rnd() < 0.5 ? 'volvo' : rnd() < 0.7 ? 'saab' : 'epa', c = addCar(type, p[0], p[1], 0, 'ai');
    c.ri = ri; c.a = a; c.dir = 1; c.t = 0; c.first = true; return c;
  }
}
for (let i = 0; i < 18; i++) spawnTraffic(null);
function updateTraffic(c, dt, T) {
  const r = R[c.ri]; let A = r.p[c.a], B = r.p[c.a + c.dir], L = Math.max(0.01, Math.hypot(B[0] - A[0], B[1] - A[1]));
  const fx = Math.sin(c.h), fz = -Math.cos(c.h); let blocked = false;
  if (c.ghost > 0) c.ghost -= dt;
  else { for (const o of cars) { if (o === c) continue; const dx = o.x - c.x, dz = o.z - c.z, fw = dx * fx + dz * fz;
      if (fw > 0 && fw < 11 && Math.abs(-dx * fz + dz * fx) < 1.7) { blocked = true; break; } }
    if (!blocked && !inCar) { const dx = player.x - c.x, dz = player.z - c.z, fw = dx * fx + dz * fz; if (fw > 0 && fw < 9 && Math.abs(-dx * fz + dz * fx) < 1.8) blocked = true; } }
  c.blocked = blocked ? c.blocked + dt : 0; if (c.blocked > 6) { c.ghost = 3; c.blocked = 0; }
  const target = blocked || wrecked(c) ? 0 : Math.min(c.T.max * topSpeedShare(c.dmg), [13.9, 11, 8.3][R[c.ri].c]);
  c.v += clamp(target - c.v, -9 * dt, 3 * dt);
  c.t += c.v * dt;
  for (let g = 0; c.t >= L && g < 8; g++) { c.t -= L; advance(c); const q = R[c.ri]; A = q.p[c.a]; B = q.p[c.a + c.dir]; L = Math.max(0.01, Math.hypot(B[0] - A[0], B[1] - A[1])); }
  const dx = (B[0] - A[0]) / L, dz = (B[1] - A[1]) / L, off = R[c.ri].c === 2 ? 1.4 : 2;
  const tx = A[0] + dx * c.t - dz * off, tz = A[1] + dz * c.t + dx * off, k = c.first ? 1 : Math.min(1, dt * 7);
  c.x += (tx - c.x) * k; c.z += (tz - c.z) * k;
  c.h = c.first ? Math.atan2(dx, -dz) : c.h + wrap(Math.atan2(dx, -dz) - c.h) * Math.min(1, dt * 5); c.first = false;
  placeCar(c);
}
// Drifting (player only): brake plus steering at speed breaks the rear loose. The car keeps sliding along its line of
// travel (c.vh) while the nose (c.h) swings into the turn. Holding a slide charges a mini-turbo, fired when the brake is let go.
const DRIFT_MIN_V = 7.5, DRIFT_KEEP_V = 4;     // m/s to start a drift, and below which it fizzles out
const GRIP = 12, DRIFT_GRIP = 1.6;             // 1/s: how fast the line of travel swings round to where the nose points
const DRIFT_YAW = 1.7, DRIFT_MAX_SLIP = 1.0;   // yaw rate multiplier in a drift; rad, the most the nose can point off the line (no spin-outs)
const DRIFT_DRAG = 2.5, DRIFT_THR = 0.35;      // m/s² lost to sideways scrub; share of normal acceleration the throttle still gives
const BRAKE_MS2 = 21, COUNTER_MS2 = 17;        // m/s² of braking, and of reverse or throttle against the roll: firm, but a car still carries its weight
const RECOVER_S = 0.9, SPIN_DECAY = 2.5;       // s for grip to come back after a drift; 1/s fade of the yaw the nose carries out of it (counter-steer to catch it)
const FLICK_LOOSE = 0.5, FLICK_S = 0.6;        // s of looseness each quick left-right reversal adds (up to RECOVER_S); s apart that still counts as quick
const FLICK_LOAD_S = 0.3;                      // s the first direction must be held to load the car up: shorter taps are corrections, not a flick
const FLICK_SPIN = 1.5;                        // rad/s the rear's swing adds to the new direction at full looseness, on top of the steering
const CATCH = 0.8;                             // share of the grip that swings the nose back to the path, not the path to the nose, at full opposite lock
const TURBO_AT = [1, 2.2], TURBO_S = [0.7, 1.3];   // s of sliding for a blue / an orange spark; how long each boost lasts (s)
const TURBO_ACC = 14, TURBO_TOP = 1.2;         // m/s² of boost; top speed multiplier while boosting
// shared driving model for the player and the police; only the player passes canDrift
const _pivot = { dx: 0, dz: 0 };   // rearPivotShift writes here: no allocation per car per frame
function drive(c, thr, steer, brake, dt, canDrift) {
  c.thr = thr = Math.abs(thr - c.thr) < 0.02 ? thr : approach(c.thr, thr, c.T.handling.throttleResponseS, dt); c.st = approach(c.st, steer, c.T.handling.steerResponseS, dt);   // weight: speed and heading answer a little late
  if (wrecked(c)) { thr = c.thr = 0; c.boost = 0; }   // the engine is dead: it only rolls to a stop
  const road = nearestRoad(c.x, c.z).d < 0.6; c.wet = inWater(c.x, c.z);
  if (c.drift) { if (!brake || c.v < DRIFT_KEEP_V || c.wet) { const t = c.charge > TURBO_AT[1] ? 1 : c.charge > TURBO_AT[0] ? 0 : -1;
      if (!brake && t >= 0) c.boost = TURBO_S[t]; c.drift = 0; c.loose = RECOVER_S; c.spin = c.yr; } }
  else if (canDrift && brake && c.v > DRIFT_MIN_V && Math.abs(steer) > 0.3 && !c.wet) { c.drift = Math.sign(steer); c.charge = 0; }
  if (canDrift) { c.flickT += dt; if (Math.abs(steer) > 0.5) { const d = Math.sign(steer);   // throwing the weight left-right-left breaks the rear loose a little more each time
      if (d !== c.flickDir && c.flickT < FLICK_S && c.flickHeld >= FLICK_LOAD_S && c.v > DRIFT_MIN_V && !c.drift && !c.wet) { c.loose = Math.min(RECOVER_S, c.loose + FLICK_LOOSE); c.spin = d * (Math.abs(c.yr) + FLICK_SPIN * c.loose / RECOVER_S); }
      c.flickHeld = d === c.flickDir && c.flickT < FLICK_S ? c.flickHeld + dt : 0; c.flickDir = d; c.flickT = 0; } }
  if (c.drift) { c.v += ((thr > 0 ? c.T.acc * DRIFT_THR * thr : 0) - DRIFT_DRAG) * dt; if (Math.abs(c.slip) > 0.25) c.charge += dt; }
  else if (brake) c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), BRAKE_MS2 * dt);
  else if (c.loose > 0 && Math.abs(c.slip) > 0.1 && c.v > DRIFT_KEEP_V) c.v += ((thr > 0 ? c.T.acc * DRIFT_THR * thr : 0) - DRIFT_DRAG) * dt;   // still scrubbing sideways, or tapping Space would beat holding it
  else if (thr > 0) c.v += (c.v < 0 ? COUNTER_MS2 : c.T.acc * (1 - 0.6 * Math.max(0, c.v) / c.T.max)) * thr * dt;
  else if (thr < 0) c.v += (c.v > 0.5 ? COUNTER_MS2 : c.T.acc * 0.6) * thr * dt;
  else c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), (road ? 2 : 5) * dt);
  if (c.boost > 0) { c.boost -= dt; if (c.wet) c.boost = 0; }   // water puts the turbo out
  const max = (c.wet ? 2.5 : c.T.max * (road ? 1 : c.T.off)) * (c.boost > 0 ? TURBO_TOP : 1) * topSpeedShare(c.dmg);
  if (c.boost > 0 && c.v < max) c.v = Math.min(max, c.v + TURBO_ACC * dt);   // only up to the limit, so it never cancels the overspeed braking below
  if (c.v > max) c.v = Math.max(max, c.v - 14 * dt);
  if (c.v < -7) c.v = -7;
  const s = c.drift ? c.drift * (0.6 + 0.4 * c.st * c.drift) : c.st;   // in a drift the nose always swings the drift's way; steering tightens or widens it
  c.yr = yawRate(c.v, s, c.T.handling.wheelbaseM) * (c.drift ? DRIFT_YAW : 1);   // rad/s
  const h0 = c.h;
  if (c.loose > 0) { c.loose -= dt; c.spin *= Math.exp(-SPIN_DECAY * dt); } else c.spin = 0;
  c.h = wrap(c.h + (c.yr * c.spin > 0 ? (Math.abs(c.yr) > Math.abs(c.spin) ? c.yr : c.spin) : c.yr + c.spin) * dt);   // steering into the slide doesn't stack on the carried yaw; counter-steer cancels it
  const grip = c.drift ? DRIFT_GRIP : c.loose > 0 ? DRIFT_GRIP + (GRIP - DRIFT_GRIP) * (1 - c.loose / RECOVER_S) ** 2 : GRIP;   // rear grip comes back slowly, so the slide carries on
  if (canDrift) { const fix = wrap(c.h - c.vh) * Math.min(1, grip * dt), k = c.loose > 0 ? CATCH * Math.max(0, -steer * Math.sign(c.slip)) : 0;
    c.h = wrap(c.h - fix * k); c.vh = wrap(c.vh + fix * (1 - k));   // counter-steer catches the slide: the car straightens along its line instead of carving on
    c.slip = clamp(wrap(c.h - c.vh), -DRIFT_MAX_SLIP, DRIFT_MAX_SLIP); c.vh = wrap(c.h - c.slip); }
  else { c.vh = c.h; c.slip = 0; }
  if (!c.drift && c.loose <= 0) { const p = rearPivotShift(h0, c.h, c.T.handling.rearAxleM, _pivot); c.x += p.dx; c.z += p.dz; }   // gripping, the car turns about its rear axle; sliding, the rear swings out instead
  c.x += Math.sin(c.vh) * c.v * dt; c.z -= Math.cos(c.vh) * c.v * dt;
  c.x = clamp(c.x, -HALF + 4, HALF - 4); c.z = clamp(c.z, -HALF + 4, HALF - 4);
  const vx = Math.sin(c.vh) * c.v, vz = -Math.cos(c.vh) * c.v, bx = c.x, bz = c.z;   // velocity and place before any hit: the push out gives the hit's normal
  if (collide(c, 1.5)) { const nx = c.x - bx, nz = c.z - bz, L = Math.hypot(nx, nz); if (L > 1e-6) crash(c, null, impactSpeed(vx, vz, nx / L, nz / L));
    c.v *= Math.pow(0.02, dt); c.drift = c.loose = c.boost = 0; }     // a wall ends the slide, and the turbo with it (charged or firing)
  for (const o of cars) { if (o === c) continue; const dx = c.x - o.x, dz = c.z - o.z, d = Math.hypot(dx, dz);
    if (d < 2.7 && d > 0.01) { const push = 2.7 - d, oh = o.mode === 'ai' ? o.h : o.vh;   // traffic steers by h alone
      crash(c, o, impactSpeed(vx - Math.sin(oh) * o.v, vz + Math.cos(oh) * o.v, dx / d, dz / d)); c.x += dx / d * push; c.z += dz / d * push;
      if (Math.abs(c.v) > 6 && c === pcar && o.mode === 'police' && ramCool <= 0) { ramCool = 6; wanted.addStar('Ramming a police car. That will not help.'); }
      if (o.mode === 'parked' || o.mode === 'idle') { o.x -= dx / d * push * 0.4; o.z -= dz / d * push * 0.4; placeCar(o); }
      c.v *= Math.pow(0.05, dt); } }
  placeCar(c);
}

// one hit: both cars take the damage (crashCars in health.ts), and the player too if they're in one. This only adds what you hear and feel;
// the glass cracks in updateSmoke
const POLICE_WRECK_SEEN_M = 80;                // "the police car is wrecked" only when it happens this close to the camera
function crash(c, o, impact) {
  const hits = crashCars(clockS, impact, c, o); if (!hits.length) return;
  let said = false;   // one line per crash: wrecked, then smoke, then the crash itself
  for (const { car: k, wrecked: w, smokeUp } of hits) {
    if (w && k === pcar) { const cat = catAboard(); toast((cat ? '”Ut, ' + cat.name + '! Den här bilen ä slut.”\n”Mjäu.”' : pickLine(WRECK_LINES)) + ' The car is wrecked. Get out and find another.', 4); said = true; }
    else if (w && k.mode === 'police' && Math.hypot(k.x - camera.position.x, k.z - camera.position.z) < POLICE_WRECK_SEEN_M) { toast('The police car is wrecked.', 3); said = true; }
    else if (smokeUp && k === pcar) { toast(SMOKE_LINES[smokeLevel(k.dmg)], 3); said = true; } }
  if (hits.some(h => h.car === pcar)) { const n = driverHurt(impact); hurtPlayer(n); shake(crashDamage(impact));
    const cat = catAboard();   // with your cat along, any real crash is about the cat; without, only one that hurts you
    if ((n > 0 || cat) && !said && clockS - crashLineAt > CRASH_LINE_S) { crashLineAt = clockS; toast(cat ? '”Förlåt, ' + cat.name + '! Ä du hel?”\n”Fräs!”' : pickLine(CRASH_LINES), 2.5); } }
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
const catAboard = () => colony.owned && colony.owned.ride === pcar ? colony.owned : null;
const CAT_FAST_MS = 25, CAT_CALM_MS = 20;      // above ~90 km/h with your cat along you tell it to hold on; it can come again once you've been below ~72 km/h
let catFastSaid = false;
function catRideLines() { const cat = inCar && catAboard(), v = inCar ? Math.abs(pcar.v) : 0;
  if (cat && v > CAT_FAST_MS && !catFastSaid) { catFastSaid = true; toast('”Håll i dä, ' + cat.name + '!”\n”MJAAAU!”', 2.5); }
  else if (v < CAT_CALM_MS) catFastSaid = false; }

// camera shake on a crash: a jolt that dies away, bigger for a harder hit; none with reduced motion
const SHAKE_S = 0.45, SHAKE_MIN_M = 0.08, SHAKE_MAX_M = 0.5, SHAKE_PER_DMG_M = 1 / 150;   // s it lasts; camera offset (m) at the smallest and largest hit, and per point of car damage
const calmMotion = matchMedia('(prefers-reduced-motion: reduce)');
let shakeT = 0, shakeM = 0;
const dmgRnd = makeRnd(808);                   // own stream for the shake and the smoke puffs, which roll every frame
function shake(dmg) { if (calmMotion.matches) return; const m = Math.min(SHAKE_MAX_M, SHAKE_MIN_M + dmg * SHAKE_PER_DMG_M); if (shakeT <= 0 || m > shakeM) shakeM = m; shakeT = SHAKE_S; }

// cracked glass: a crack texture laid over the windscreen and rear window (material 0) and the side windows (material 1), worse at each crackLevel
const CRACK_OUT_M = 0.06;                      // how far the cracks sit outside the glass profile, past its bevel
function crackTex(dense) {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'), r = makeRnd(dense ? 81 : 80);
  g.lineCap = 'round';
  for (let hit = 0; hit < (dense ? 4 : 1); hit++) {   // each hit: a star of jagged rays, and broken rings round its centre
    const cx = S * (0.3 + r() * 0.4), cy = S * (0.3 + r() * 0.4), rays = dense ? 14 : 9;
    g.strokeStyle = 'rgba(235,240,245,.9)'; g.lineWidth = dense ? 2.4 : 2;
    for (let i = 0; i < rays; i++) { let a = (i / rays) * Math.PI * 2 + r() * 0.4, x = cx, y = cy; const L = S * (0.25 + r() * (dense ? 0.5 : 0.3));
      g.beginPath(); g.moveTo(x, y); for (let d = 0; d < L; d += 14) { a += (r() - 0.5) * 0.5; x += Math.cos(a) * 14; y += Math.sin(a) * 14; g.lineTo(x, y); } g.stroke(); }
    g.lineWidth = 1.5;
    for (let k = 1; k <= (dense ? 3 : 2); k++) { const R = k * S * 0.06 * (1 + r() * 0.5);
      for (let i = 0; i < rays; i++) if (r() < 0.7) { const a = (i / rays) * Math.PI * 2; g.beginPath(); g.arc(cx, cy, R * (0.9 + r() * 0.2), a, a + (Math.PI * 2) / rays * 0.8); g.stroke(); } }
    g.fillStyle = 'rgba(235,240,245,.55)'; g.beginPath(); g.arc(cx, cy, dense ? 7 : 5, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const crackMat = d => new THREE.MeshBasicMaterial({ map: crackTex(d), transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
const CRACK_OFF = new THREE.MeshBasicMaterial({ visible: false }), CRACK_LIGHT = crackMat(false), CRACK_HEAVY = crackMat(true);
const CRACK_MATS = [null, [CRACK_LIGHT, CRACK_OFF], [CRACK_HEAVY, CRACK_LIGHT], [CRACK_HEAVY, CRACK_HEAVY]];
const CRACK_REAR = { saab: 2 };                // index of the glass profile's point where the rear window starts (default 1); the Saab's is its hatch
const crackGeoCache = {};
function crackGeo(t) {
  if (crackGeoCache[t]) return crackGeoCache[t];
  const P = t === 'traktor' ? TRACTOR_CAB : PROFILES[t], G = P.glass, n = G.length, pos = [], uv = [];
  const cx = G.reduce((a, p) => a + p[0], 0) / n, cy = G.reduce((a, p) => a + p[1], 0) / n;   // profile x is the car's z (front is -z), profile y is height
  const pane = (p, q) => {                     // a quad across the car over the profile edge p–q, pushed out away from the middle of the glass
    let nx = q[1] - p[1], ny = p[0] - q[0]; const L = Math.hypot(nx, ny); nx /= L; ny /= L;
    if (nx * ((p[0] + q[0]) / 2 - cx) + ny * ((p[1] + q[1]) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const e = (a, b, k) => [a[0] + (b[0] - a[0]) * k + nx * CRACK_OUT_M, a[1] + (b[1] - a[1]) * k + ny * CRACK_OUT_M], A = e(p, q, 0.08), B = e(p, q, 0.92), w = P.gw / 2 - 0.1;
    pos.push(-w, A[1], A[0], w, A[1], A[0], w, B[1], B[0], -w, A[1], A[0], w, B[1], B[0], -w, B[1], B[0]); uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  };
  const ri = CRACK_REAR[t] || 1;
  pane(G[n - 1], G[0]); pane(G[ri], G[ri + 1]);
  const front = pos.length / 3;
  const S = G.map(p => [cx + (p[0] - cx) * 0.88, cy + (p[1] - cy) * 0.88]);   // side windows: the profile shrunk a little, so the cracks stay off the pillars
  const x0 = Math.min(...S.map(p => p[0])), x1 = Math.max(...S.map(p => p[0])), y0 = Math.min(...S.map(p => p[1])), y1 = Math.max(...S.map(p => p[1]));
  const tri = THREE.ShapeUtils.triangulateShape(S.map(p => new THREE.Vector2(p[0], p[1])), []);
  for (const side of [-1, 1]) for (const f of tri) for (const i of f) { pos.push(side * (P.gw / 2 + 0.015), S[i][1], S[i][0]); uv.push((S[i][0] - x0) / (x1 - x0), (S[i][1] - y0) / (y1 - y0)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.addGroup(0, front, 0); g.addGroup(front, pos.length / 3 - front, 1);
  return (crackGeoCache[t] = g);
}
// a car model (#176) cracks its own glass: each of its glass_ parts, with texture coordinates added, split like crackGeo into the panes
// that face forwards or backwards (material 0) and the rest (material 1); the models' glass has no texture coordinates of its own
const MODEL_GLASS_FLAT = 0.94;                 // glass whose normal is closer to straight up than this (about 20°) gets no cracks: a raked windscreen still does
const modelCrackGeos = new WeakMap(), _ga = new THREE.Vector3(), _gb = new THREE.Vector3(), _gc = new THREE.Vector3();
function modelCrackGeo(src) {
  let g = modelCrackGeos.get(src); if (g) return g;
  const s = src.index ? src.toNonIndexed() : src, P = s.attributes.position, pos = [[], []], uv = [[], []];
  s.computeBoundingBox(); const { min: m, max: M } = s.boundingBox, w = M.x - m.x, h = M.y - m.y, l = M.z - m.z;
  for (let i = 0; i < P.count; i += 3) {
    _ga.fromBufferAttribute(P, i); _gb.fromBufferAttribute(P, i + 1); _gc.fromBufferAttribute(P, i + 2);
    const n = _gc.sub(_gb).cross(_gb.clone().sub(_ga)).normalize(); if (Math.abs(n.y) > MODEL_GLASS_FLAT) continue;   // the glass's flat top, hidden under the roof
    const k = Math.abs(n.z) > Math.abs(n.x) ? 0 : 1;   // the models face -z
    for (let j = 0; j < 3; j++) { _ga.fromBufferAttribute(P, i + j); pos[k].push(_ga.x, _ga.y, _ga.z); uv[k].push(k ? (_ga.z - m.z) / l : (_ga.x - m.x) / w, (_ga.y - m.y) / h); }
  }
  g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...pos[0], ...pos[1]], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([...uv[0], ...uv[1]], 2));
  g.addGroup(0, pos[0].length / 3, 0); g.addGroup(pos[0].length / 3, pos[1].length / 3, 1);
  modelCrackGeos.set(src, g); return g;
}
// the procedural cracks go on the procedural body, so they hide with it when the model shows; the model, which loads later, gets its own
function crackGlass(c) {
  const lv = crackLevel(c.dmg); if (!lv) return;
  if (c.crack !== lv) { if (!c.crackMesh) { c.crackMesh = new THREE.Mesh(crackGeo(c.type), CRACK_MATS[lv]); c.body.add(c.crackMesh); }
    c.crackMesh.material = CRACK_MATS[lv]; if (c.modelCrack) for (const m of c.modelCrack) m.material = CRACK_MATS[lv]; c.crack = lv; }
  if (!c.modelCrack && vehicleVisuals.loaded(c) && c.mesh.getObjectByName('glass_envelope')) { c.modelCrack = [];
    c.mesh.traverse(o => { if (o.isMesh && o.name.startsWith('glass_')) c.modelCrack.push(o); });
    c.modelCrack = c.modelCrack.map(gl => { const m = new THREE.Mesh(modelCrackGeo(gl.geometry), CRACK_MATS[lv]); gl.add(m); return m; }); }
}

// ---------- drift effects: sparks at the rear wheels, a flame while boosting, skid marks (src/game/render/drift-fx.ts) ----------
const driftFx = new DriftFx({ scene, groundAt, profiles: PROFILES, turboAt: TURBO_AT }), updateDriftFx = driftFx.update.bind(driftFx);

// ---------- pedestrians: walk the streets and footpaths, now and then stop for a while (src/game/pedestrians.ts) ----------
// the getters are read when the pedestrians use them, so they can name things declared further down
const crowd = new Crowd({ scene, roads, buildings, labels: D.labels, groundAt, walkOffset, coarse, wrap, rnd, pick, personParts, advance, cars,
  get player() { return player; }, get inCar() { return inCar; } });
const updateNpcs = crowd.update.bind(crowd);

// ---------- cats: lounge by the house walls, wander a little, bolt from cars and running feet (src/game/cats.ts) ----------
const TREAT_BAG = 3, TREAT_MAX = 9;                                  // treats per bag from the kiosk; how many fit in your pockets
let treats = 0;
// the getters are read when the cats use them, so they can name things declared further down
const colony = new CatColony({ scene, buildings, inWater, groundAt, half: HALF, coarse, wrap, geoCache, boxGeo, paintMat, blob, cars, toast,
  get player() { return player; }, get keys() { return keys; }, get joy() { return joy; }, get kmenu() { return kmenu; }, get inCar() { return inCar; }, get pcar() { return pcar; }, get inside() { return places.inside; },
  useTreat() { if (treats <= 0) return false; treats--; drawTreats(); return true; }, scratched() { hurtPlayer(CAT_SCRATCH_HP); } });
const { cats } = colony, updateCats = colony.update.bind(colony), catFirst = colony.catFirst.bind(colony), nearCat = colony.nearest.bind(colony);
// a good pet that makes a cat ready to be adopted asks whether it comes home with you
const CAT_MENU_M = 4;   // a cat's menu (the adopt question, or your own cat's) closes when you get further than this from it (m), or it bolts, or you get in a car
const nearMenuCat = k => () => !inCar && k.state !== 'flee' && Math.hypot(k.x - player.x, k.z - player.z) < CAT_MENU_M;
function petCat(k) { const ready = colony.pet(k); showHeart(k); if (ready) openMenu('adopt', '”Ska du följa mä hem, kisse?”', [['adopt', 'Ja, adoptera'], ['no', 'Nä, inte nu']], c => { if (c === 'adopt') { colony.adopt(k); showHeart(k); } else colony.decline(k); drawPets(); }, nearMenuCat(k)); }
// your own cat: E opens its menu rather than petting it straight away; Ge godis shows only while you have treats
function openOwnCat(k) {
  openMenu('cat', '”' + esc(k.name) + '”', [['pet', 'Klappa'], ...(treats ? [['treat', 'Ge godis']] : []), ['play', 'Leka'], ['home', 'Skicka hem'], ['no', 'Stäng']], c => {
    if (c === 'pet') petCat(k); else if (c === 'treat') { if (colony.treat(k)) showHeart(k); } else if (c === 'play') colony.play(k); else if (c === 'home') colony.sendHome(); }, nearMenuCat(k)); }
// ---------- your pets: P (or the Pets button) calls them, sends them home or sets them free (src/game/pets.ts) ----------
// naming a pet: a text field in the menu; Enter saves, Esc cancels, and game keys don't fire while you type
const esc = t => t.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
let nameIn = null;
function openRename(p) {
  openMenu('pets', '”Va ska ' + esc(p.name) + ' heta?”', [['ok', 'Spara'], ['no', 'Avbryt']], k => { const n = nameIn.value; nameIn = null; if (k === 'ok' && n.trim()) toast('”' + p.rename(n) + '. Dä ä ett fint namn, dä.”', 2.5); });
  nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.value = p.name; nameIn.setAttribute('aria-label', 'Name');
  nameIn.autocomplete = 'off'; nameIn.spellcheck = false; kmenu.querySelector('p').after(nameIn); nameIn.focus(); nameIn.select(); }
// the getter is read when a pet is called, so it can name things declared further down
const pets = new Pets({ colony, button: $('pets'), openMenu, openRename, esc, get caller() { return inCar ? pcar : player; } });
const openPets = pets.open.bind(pets), drawPets = pets.draw.bind(pets);
// ---------- the adopt heart: hovers over a stray once it has had a good pet, a third fuller for each good pet in a row (src/game/render/adopt-heart.ts) ----------
const adoptHearts = new AdoptHearts({ scene, colony }), showHeart = adoptHearts.show.bind(adoptHearts), drawHearts = adoptHearts.update.bind(adoptHearts);
$('pets').addEventListener('click', () => { if (menuKind === 'pets') closeMenu(); else openPets(); canvas.focus(); });   // from the kiosk or adopt menu too
function buyTreats() {
  if (treats >= TREAT_MAX) { toast('”Nämen, du har ju fickera fulla redan!”', 2.5); return; }
  if (!pay(wallet, TREATS_KR)) { toast(broke(TREATS_KR), 3); return; }
  drawKr(); treats = Math.min(TREAT_MAX, treats + TREAT_BAG); drawTreats(); toast('”En påse kattgodis, varsågo. Kattera ä tôcka i dä.”', 4);
}
function drawTreats() { const el = $('treats'); el.hidden = false; el.textContent = 'Cat treats: ' + treats; }

// ---------- player (walking, jumping, getting out: src/game/player.ts) ----------
const player = { x: HOME.x, z: HOME.z, y: 0, vy: 0, h: 0, speed: 0, phase: 0, mesh: personParts('#f2c230', '#2b3a55', null, true) };   // y: metres above the ground
collide(player, 0.6); scene.add(player.mesh);
let jumpQ = false;   // set by a fresh Space / Jump press on foot, used up by the next frame: a held key (braking, then getting out) never jumps, a tap between frames isn't lost
const jumpOk = () => !inCar && !places.inside && bigT <= 0;   // queue only where a jump can start, so a press inside a safehouse or under Gripen! can't fire as it ends
(function () { const o = { x: player.x + 7, z: player.z + 3 }; collide(o, 2.6); displayCar = addCar(selectedVehicle?.archetype || 'volvo', o.x, o.z, 0.6, 'parked', selectedVehicle?.id ?? 'volvo240'); })();
let inCar = false, pcar = null, stolen = 0, ramCool = 0, started = false, bigT = 0;
let clockS = 0;                                  // s of play, for hit cool-downs
const health = newHealth();
const wallet = newWallet();
const peds = [];
const wanted = new Wanted({ roads, rnd, pick, wrap, removeCar, drive, toast,
  spawnCar: (x, z, h) => addCar('polis', x, z, h, 'police'),
  drawStars: () => drawStars(), showEvading: on => $('stars').classList.toggle('evading', on), caught: n => busted(n),
  get lyingLow() { return !!places.inside; } });

// ---------- places: safehouses (lie low to lose your stars) and the trisslott kiosk ----------
// the getter is read when a place uses it, so it follows the stars
const places = new Places({ footprints: bPolys, roads: R, police: wanted.police, lieLow: secs => wanted.lieLow(secs), toast, get stars() { return wanted.stars; } });
const placeMeshes = new PlaceMeshes({ scene, places, heightAt: hAt, col, boxGeo, paintMat, glass: GLASS });
addFootprint([KIOSK.x - KIOSK.w / 2, KIOSK.z - KIOSK.d / 2, KIOSK.x + KIOSK.w / 2, KIOSK.z - KIOSK.d / 2, KIOSK.x + KIOSK.w / 2, KIOSK.z + KIOSK.d / 2, KIOSK.x - KIOSK.w / 2, KIOSK.z + KIOSK.d / 2]);   // the kiosk collides like a building
// small menus on one plate (the kiosk's one lucka, adopting a cat): number keys / Esc, or tap; walking away closes it
const kmenu = $('kmenu');
let relock = false;                                             // a menu needs the cursor: free it while the menu is open, and take it back after
let menuKind = null, menuPick = null, menuStay = null;          // which menu is open, what a choice does, what keeps it open (checked 4 times a second; none: stays open)
// items are [key, label]; the 'no' item is last and gets Esc
function openMenu(kind, title, items, pick, stay = null) {
  nameIn = null; kmenu.innerHTML = '<p id="kmenu-t">' + title + '</p>' + items.map(([k, label], i) => '<button type="button" data-k="' + k + '"><kbd>' + (k === 'no' ? 'Esc' : k === 'ok' ? 'Enter' : i + 1) + '</kbd>' + label + '</button>').join('');
  menuKind = kind; menuPick = pick; menuStay = stay; if (kmenu.hidden) { relock = input.locked() || conRelock; if (input.locked()) document.exitPointerLock(); } kmenu.hidden = false; devcon.close(); }   // the menu takes over the console's relock
function closeMenu() { kmenu.hidden = true; nameIn = null; menuKind = menuPick = menuStay = null; if (relock) { relock = false; input.lockMouse(); } }
// a choice can open the next menu (a pet's "are you sure?"): then the menu stays up, and the cursor stays free
function menuChoose(k) { const pick = menuPick; menuPick = null; if (pick) pick(k); if (!menuPick) closeMenu(); }
const openKiosk = () => openMenu('kiosk', '”Va ska dä va?”', [['triss', 'Trisslott <small>' + TRISS_KR + ' kr</small>'], ['treats', 'Kattgodis (3 st) <small>' + TREATS_KR + ' kr</small>'], ['korv', 'Korv me brö <small>' + KORV_KR + ' kr · +' + KORV_HP + ' health</small>'], ['vego', 'Vegokorv me brö <small>' + KORV_KR + ' kr</small>'], ['rulle', 'Smålandsrulle <small>' + RULLE_KR + ' kr · +' + RULLE_HP + ' health</small>'], ['no', 'Nä tack']], k => {
  if (k === 'triss') trisslott.scratch(); else if (k === 'treats') buyTreats(); else if (k === 'korv') eat(KORV_HP, KORV_KR, '”En korv me brö, tack.”', '”Varsågod. Senap å ketchup ä på disken.”');
  else if (k === 'vego') toast('”En vegokåv me brö, tack.”\n”Vegokåv? Nä vi ha ingen vegokåv! Den ligger i frysen.”', 4);   // always sold out
  else if (k === 'rulle') eat(RULLE_HP, RULLE_KR, '”En smålandsrulle, tack.”', '”Varsågod, mos å räksallad å allt. Dä ä mat dä!”'); }, () => nearPlace()?.kind === 'kiosk');
// food from the kiosk; \n puts each speaker on their own line in the toast: you order first, then the kiosk answers
function eat(n, kr, order, reply) {
  if (health.hp >= HP_MAX) { toast(order + '\n”Du ser ju mätt ut, du. Kom tebaks när du ä hungrig.”', 3); return; }
  if (!pay(wallet, kr)) { toast(order + '\n' + broke(kr), 3.5); return; }
  drawKr(); heal(health, n); drawHealth(); toast(order + '\n' + reply + ' +' + n + ' health.', 3.5);
}
kmenu.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { menuChoose(b.dataset.k); canvas.focus(); } });
function nearPlace() { return inCar ? null : places.nearest(player.x, player.z); }
function enterHouse(p) { if (places.enter(p, player)) player.mesh.visible = false; }
function leaveHouse() { if (!places.leave()) return; player.mesh.visible = true; $('hide').hidden = true; }
// ---------- car damage: smoke from the bonnet, grey past half damage and black when nearly wrecked ----------
const SMOKE_N = 48, SMOKE_S = 1.8, SMOKE_NEAR_M = 140, SMOKE_RATE = [0, 8, 12];   // puffs in the pool; s each lasts; only cars this close smoke; puffs/s by smoke level
const SMOKE_COLS = [null, col(0x7c7c78), col(0x2a2826)];
const smokeTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); })();
const puffs = Array.from({ length: SMOKE_N }, () => { const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false }));
  p.visible = false; p.age = 0; scene.add(p); return p; });
let puffI = 0;
function updateSmoke(dt, T) {
  for (const c of cars) { const cl = crackLevel(c.dmg); if (cl && (c.crack !== cl || !c.modelCrack && vehicleVisuals.loaded(c))) crackGlass(c);   // after a crash, and once its model loads; one that failed never does
    const lv = smokeLevel(c.dmg); if (!lv || c.wet || Math.abs(c.x - T.x) > SMOKE_NEAR_M || Math.abs(c.z - T.z) > SMOKE_NEAR_M) continue;
    c.smokeT = (c.smokeT || 0) + dt * SMOKE_RATE[lv];
    for (; c.smokeT >= 1; c.smokeT--) { const p = puffs[puffI]; puffI = (puffI + 1) % SMOKE_N;   // a ring: the oldest puff goes first
      const fwd = c.type === 'traktor' ? 1.4 : 1.7, x = c.x + Math.sin(c.h) * fwd + (dmgRnd() - 0.5) * 0.5, z = c.z - Math.cos(c.h) * fwd + (dmgRnd() - 0.5) * 0.5;
      p.position.set(x, groundAt(x, z) + 1.1, z); p.age = 0; p.visible = true; p.material.color.copy(SMOKE_COLS[lv]); } }
  for (const p of puffs) { if (!p.visible) continue; p.age += dt; const t = p.age / SMOKE_S; if (t >= 1) { p.visible = false; continue; }
    p.position.y += dt * 1.3; p.scale.setScalar(0.6 + t * 2.4); p.material.opacity = 0.75 * (1 - t); }
}

// ---------- låt det regna: an easter egg, L throws RAIN_KR in the air as banknotes that flutter down around you ----------
const cashRnd = makeRnd(1000);                               // own stream for the banknotes and the confetti, so they don't shift the world's rolls
const RAIN_N = 48, RAIN_CALM_N = 12, RAIN_R_M = 4.5;          // notes in the pool; how many with reduced motion; how far around you they fall (m)
const RAIN_TOP_M = 2.5, RAIN_TOP_SPREAD_M = 2.5;             // they start 2.5–5 m above the ground
const RAIN_FALL_MS = 0.9, RAIN_FALL_SPREAD_MS = 0.6;         // and fall at 0.9–1.5 m/s, swaying: down in 2–5 s
const RAIN_LIE_S = 3, RAIN_FADE_S = 0.8;                     // s a note lies on the ground, then fades out
const RAIN_SEEN_M = 20, RAIN_GAWK_S = 5;                     // walkers this close (m) stop and stare this long (s)
const RAIN_LINES = ['”Låt dä regna!”', '”Pengar ä bara papper, dä.”', '”Hôll i hatten, nu regnar dä sedlar!”'];
const GAWK_LINES = ['”Va i hela friden!”', '”Ä du inte klok, människa?!”', '”Hörru, ja tar en sån där!”'];
const billTex = (() => { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const g = cv.getContext('2d');
  g.fillStyle = '#6f82c2'; g.fillRect(0, 0, 128, 64); g.strokeStyle = '#dfe4f4'; g.lineWidth = 4; g.strokeRect(6, 6, 116, 52);
  g.fillStyle = '#4c5d9e'; g.beginPath(); g.arc(38, 32, 16, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#eef1fa'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('100', 88, 33);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const billGeo = new THREE.PlaneGeometry(0.4, 0.2);
const bills = Array.from({ length: RAIN_N }, () => { const b = new THREE.Mesh(billGeo, new THREE.MeshBasicMaterial({ map: billTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  b.visible = false; b.lieT = 0; b.vy = 0; b.sway = 0; b.phase = 0; b.sx = b.sy = b.sz = 0; scene.add(b); return b; });
let billI = 0;
function makeItRain() {
  if (!started || bigT > 0 || places.inside || !kmenu.hidden) return;
  if (!pay(wallet, RAIN_KR)) { toast('”Låta dä regna? Mä ' + fmtKr(wallet.kr) + '? Nä.”', 2.5); return; }
  drawKr(); const o = inCar ? pcar : player; dropBills(o);
  const seen = crowd.stare(o, RAIN_SEEN_M, RAIN_GAWK_S);
  toast(pickLine(RAIN_LINES), 2.5); if (seen) sayLater(pickLine(GAWK_LINES));
}
// a shower of notes around o: for låt det regna, and for the big trisslott win
function dropBills(o) {
  const n = calmMotion.matches ? RAIN_CALM_N : RAIN_N;
  for (let i = 0; i < n; i++) { const b = bills[billI]; billI = (billI + 1) % RAIN_N;   // a ring: the oldest note goes first
    const a = cashRnd() * Math.PI * 2, d = Math.sqrt(cashRnd()) * RAIN_R_M, x = o.x + Math.sin(a) * d, z = o.z + Math.cos(a) * d;   // sqrt: evenly over the disc
    b.position.set(x, groundAt(x, z) + RAIN_TOP_M + cashRnd() * RAIN_TOP_SPREAD_M, z); b.rotation.set(cashRnd() * 6.3, cashRnd() * 6.3, cashRnd() * 6.3);
    b.vy = RAIN_FALL_MS + cashRnd() * RAIN_FALL_SPREAD_MS; b.sway = 0.4 + cashRnd() * 0.5; b.phase = cashRnd() * 6.3;
    b.sx = (cashRnd() - 0.5) * 6; b.sy = (cashRnd() - 0.5) * 4; b.sz = (cashRnd() - 0.5) * 6; b.lieT = -1; b.material.opacity = 1; b.visible = true; }
}
function updateRain(dt) {
  for (const b of bills) { if (!b.visible) continue;
    if (b.lieT < 0) { b.phase += dt * 2.2; b.position.x += Math.cos(b.phase) * b.sway * dt; b.position.z += Math.sin(b.phase * 0.7) * b.sway * dt; b.position.y -= b.vy * dt;
      b.rotation.x += b.sx * dt; b.rotation.y += b.sy * dt; b.rotation.z += b.sz * dt;
      const g = groundAt(b.position.x, b.position.z) + 0.02;
      if (b.position.y <= g) { b.position.y = g; b.rotation.set(-Math.PI / 2, 0, b.rotation.z); b.lieT = 0; } }   // lands flat, turned whichever way it fell
    else { b.lieT += dt; const f = b.lieT - RAIN_LIE_S; if (f >= RAIN_FADE_S) b.visible = false; else b.material.opacity = f > 0 ? 1 - f / RAIN_FADE_S : 1; } }
}

// trisslott (src/game/trisslott.ts): the vinstplan is in economy.ts; a win fires confetti, more for a bigger one, and a big one rains banknotes too
const confetti = new Confetti($('confetti'), cashRnd);
const trissRnd = makeRnd(2000);                              // own stream for the scratch, which changes the wallet: deterministic like other gameplay
const trisslott = new Trisslott({ random: trissRnd, pick, now: () => performance.now() / 1000, toast,
  buy: () => { if (!pay(wallet, TRISS_KR)) { toast(broke(TRISS_KR), 3); return false; } drawKr(); return true; },
  win: kr => { earn(wallet, kr); drawKr(); if (!calmMotion.matches) confetti.burst(confettiCount(kr)); if (kr >= BIG_WIN_KR) dropBills(player); },
  draw: (bought, won, wonKr) => { const el = $('triss'); el.hidden = false; el.innerHTML = 'Trisslotter: ' + bought + ' · Vinster: ' + won + '<br>Insatt: ' + fmtKr(bought * TRISS_KR) + ' · Vunnit: ' + fmtKr(wonKr); } });   // numbers only, so innerHTML is safe
const START_CAM = [0.6, 0.34];   // camera yaw and pitch at Start
let camYaw = START_CAM[0], camPitch = START_CAM[1], lookOff = 0, lookIdle = 9;
// ?at=x,z[,yaw[,pitch]] starts the player there, looking that way: for review screenshots, such as the streetscape's (#187)
(function () { const at = (new URLSearchParams(location.search).get('at') || '').split(',').map(Number);
  if (at.length < 2 || !at.every(Number.isFinite)) return; player.x = at[0]; player.z = at[1]; if (at.length > 2) camYaw = START_CAM[0] = at[2]; if (at.length > 3) START_CAM[1] = clamp(at[3], 0.06, 1.25); })();

// ---------- input: keys, mouse look and the touch controls (src/game/input.ts) ----------
// the dev console and the menus see each key first: typing a pet's name, the menu's number keys and Esc, P for your pets
function menuKey(e) {
  // keys typed in the console stop there and never get here; with the console open and focus elsewhere (a click on its output, Tab), keys go back to it
  if (devcon.isOpen) { e.preventDefault(); if ((isConsoleKey(e) || e.code === 'Escape') && !e.repeat) devcon.close(); else devcon.focus(); return true; }   // the key that takes focus back isn't typed
  if (DEV && !e.repeat && kmenu.hidden && isConsoleKey(e)) { e.preventDefault(); devcon.open(); return true; }
  if (nameIn && e.target === nameIn) { if (e.isComposing) return true; if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape') { e.preventDefault(); menuChoose(e.code === 'Escape' ? 'no' : 'ok'); canvas.focus(); } return true; }   // typing a name
  if (!kmenu.hidden) { const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code), b = n && kmenu.querySelectorAll('button')[+n[1] - 1];
    if (e.code === 'Escape' || b && b.dataset.k !== 'no') { e.preventDefault(); menuChoose(e.code === 'Escape' ? 'no' : b.dataset.k); return true; }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !kmenu.contains(e.target) && kmenu.querySelector('[data-k="ok"]')) { e.preventDefault(); menuChoose('ok'); return true; } }   // Enter is labelled on Spara, so it saves wherever focus is
  if (e.code === 'KeyP' && !e.repeat && colony.owned) { if (menuKind === 'pets') closeMenu(); else openPets(); return true; }
  return kmenu.contains(e.target);                            // Enter / Space on a focused menu button: let the button's own click handle it
}
canvas.addEventListener('pointerdown', () => devcon.close());   // before the input's own, so a click that closes the console can take the mouse back
const input = new Input({ win: window, doc: document, canvas, $, coarse, menuKey,
  get started() { return started; }, get menuOpen() { return !kmenu.hidden; },
  action: () => action(), respawn: () => respawn(), rain: () => makeItRain(),
  jump: () => { if (jumpOk()) jumpQ = true; },   // queue only where a jump can start (see jumpOk)
  look: (dx, dy) => { if (inCar) { lookOff = wrap(lookOff + dx * 0.006); lookIdle = 0; } else camYaw = wrap(camYaw + dx * 0.006);
    camPitch = clamp(camPitch + dy * 0.004, 0.06, 1.25); },
  lockLost: () => { if (!devcon.isOpen && !hud.toasting) toast('Click the game to look around with the mouse again.', 3); } });
const { keys, joy } = input;

// ---------- HUD (src/game/hud.ts) ----------
// the getters are read when the HUD uses them, so they can name things that change during play
const hud = new Hud({ $, ground: tex2d, P, K, roads, labels: D.labels, cars, places: places.list,
  get stars() { return wanted.stars; }, get pcar() { return pcar; }, get blink() { return blink; } });
// a declaration, not a bound const, so the sections above can pass toast on before the HUD exists
function toast(msg, secs, cls) { hud.toast(msg, secs, cls); }
const drawStars = hud.drawStars.bind(hud), drawMini = hud.drawMini.bind(hud), updateSign = hud.updateSign.bind(hud);
// a line that waits for the toast and any big screen to clear, so it doesn't cut off what was just said
let laterLine = null;
const sayLater = line => { laterLine = line; };
drawStars();
function drawHealth() { hud.drawHealth(health.hp, inCar ? pcar.dmg : null); }
// money on its plate (fmtKr: 10 000 kr)
function drawKr() { $('kr').textContent = fmtKr(wallet.kr); }

// ---------- dev console ----------
// Each module's commands are registered here until main.ts is split up; a module that owns its state can register its own.
const commands = new Commands();
let conRelock = false;
const devcon = new DevConsole({ root: $('devcon'), commands,
  onOpen: () => { for (const k in keys) keys[k] = false; conRelock = input.locked(); if (conRelock) document.exitPointerLock(); },
  onClose: () => { canvas.focus(); if (conRelock && kmenu.hidden) input.lockMouse(); conRelock = false; } });   // an open menu needs the cursor
const MYNT_KR = 1000;   // what the mynt cheat adds
function addKr(n) { if (n >= 0) earn(wallet, n); else pay(wallet, Math.min(-n, wallet.kr)); drawKr(); return 'Wallet: ' + fmtKr(wallet.kr) + '.'; }
commands.register('kr', { usage: '<amount>', help: 'add kronor to your wallet; a negative amount takes them', run: a => addKr(parseKr(a[0])) });
// adopt <pet>: a new random pet of that kind, right by you. Only cats so far; another kind of pet adds its entry here.
const ADOPT = new Map([['cat', () => { if (colony.owned) return 'You already have a cat, ' + colony.owned.name + '. Set it free first (P).';
  if (inCar) return 'Get out of the car first.';   // a cat made by the car would land inside it
  const k = colony.spawnNear(player); colony.adopt(k); showHeart(k); drawPets(); return 'Adopted a cat.'; }]]);
commands.register('adopt', { usage: '<' + [...ADOPT.keys()].join(' | ') + '>', help: 'adopt a new random pet of that kind',
  run: a => { const f = a[0] && ADOPT.get(a[0].toLowerCase()); if (!f) throw new UsageError(a[0] ? 'No pet called ' + a[0] + '.' : ''); return f(); } });
commands.register('mynt', { help: 'add ' + fmtKr(MYNT_KR) + ' to your wallet', run: () => addKr(MYNT_KR) });
drawKr();
const broke = kr => '”Dä blir ' + kr + ' kronor. Va, har du inga pengar? Nä, då blir dä inget.”';
let signT = 0, blink = false, blinkT = 0;

// ---------- stealing and getting caught (the wanted level and the police: src/game/police.ts) ----------
function nearestCar() { return carInReach(player, cars); }
function action() {
  if (!started || bigT > 0) return;
  if (places.inside) { leaveHouse(); return; }
  if (!kmenu.hidden) { closeMenu(); return; }
  const pl = nearPlace(), kt = nearCat();
  if (catFirst(kt, pl)) { if (kt.owned) openOwnCat(kt); else petCat(kt); return; }
  if (pl) { if (pl.kind === 'safe') enterHouse(pl); else openKiosk(); return; }
  if (inCar) {
    if (tooFastToGetOut(pcar)) { toast('Slow down before you get out.', 2); return; }
    stepOut(player, pcar); collide(player, 0.5);
    pcar.mode = 'idle'; pcar.v = pcar.slip = pcar.drift = pcar.boost = pcar.thr = pcar.st = 0; placeCar(pcar); pcar = null; inCar = false; jumpQ = false; player.mesh.visible = true; camYaw = wrap(camYaw + lookOff); lookOff = 0; return;
  }
  const c = nearestCar(); if (!c) return;
  if (c.mode === 'ai') {
    const p = personParts(pick(['#b5463a', '#3f6b8a', '#5c7a4a', '#7a5a8a']), '#3a3a3a');
    p.position.set(c.x - Math.cos(c.h) * 2.2, 0, c.z - Math.sin(c.h) * 2.2); p.position.y = groundAt(p.position.x, p.position.z); p.ttl = 14; scene.add(p); peds.push(p);
    toast(pick(['”Hörru! Det där är min bil!”', '”Men va fan gör du?!”', '”Polisen! Han tar ' + (vehicleVisuals.definition(c)?.spokenName || 'min ' + c.T.name) + '!”']) + ' The driver calls the police.');
    wanted.addStar(); spawnTraffic(player);
  } else if (!c.owned) {
    if (wanted.police.length || rnd() < 0.35) wanted.addStar('A neighbour saw you take the ' + carName(c) + ' and called the police.');
    else toast(c.type === 'epa' ? 'EPA-traktor: legally limited to 30 km/h. Good luck outrunning anyone.' : 'You took the ' + carName(c) + '. Nobody noticed.');
  }
  if (!c.owned) { c.owned = true; stolen++; $('count').textContent = 'Cars stolen: ' + stolen; }
  c.mode = 'player'; c.vh = c.h; c.slip = c.drift = c.boost = c.loose = c.thr = c.st = 0; pcar = c; inCar = true; player.y = player.vy = 0; player.mesh.visible = false; lookOff = 0; camYaw = c.h;
}
function respawn() { leaveHouse(); if (inCar) { pcar.mode = 'idle'; pcar.v = pcar.slip = pcar.drift = pcar.boost = pcar.thr = pcar.st = 0; placeCar(pcar); pcar = null; inCar = false; player.mesh.visible = true; }
  standAt(player, HOME.x, HOME.z); jumpQ = false; collide(player, 0.6); }
function bigScreen(title, msg) { $('big-t').textContent = title; $('big-p').textContent = msg; bigT = 3; $('big').hidden = false; hud.hideToast(); }   // the big screen replaces any line from the same moment
function busted(n = 0) { const f = fine(wallet.kr, n); pay(wallet, f); drawKr(); respawn(); health.hp = HP_MAX; drawHealth();
  bigScreen('Gripen!', 'Busted. The police ' + (f ? 'fine you ' + fmtKr(f) + ' and ' : '') + 'drop you off at Torget.'); }   // n: the stars you had, already cleared
// health at zero: with the police after you it's Gripen!, otherwise you come to at the nearest safehouse, or Torget
function knockedOut() {
  if (wanted.stars) { const n = wanted.stars; wanted.clear(); busted(n); return; }   // Gripen! expects the stars cleared
  const spot = wakeSpot(player.x, player.z, HOME, places.list);
  respawn(); standAt(player, spot.x, spot.z); collide(player, 0.6); health.hp = HP_MAX; drawHealth();
  bigScreen('Däckad!', 'Knocked out. You come to ' + (spot.name ? 'at the safehouse on ' + spot.name : 'at Torget') + '.'); sayLater(pickLine(WAKE_LINES));
}
const WAKE_LINES = ['”Va hände? Ja minns ingenting.”', '”Aj, mitt huve…”'];
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
  const mx = started ? clamp((keys.right ? 1 : 0) - (keys.left ? 1 : 0) + joy.x, -1, 1) : 0, my = started ? clamp((keys.up ? 1 : 0) - (keys.down ? 1 : 0) + joy.y, -1, 1) : 0;
  clockS += dt; if (started) regen(health, dt);
  if (health.hp <= 0) knockedOut();   // here, not where the hit lands: that can be halfway through moving the car
  if (bigT > 0) { bigT -= dt; if (bigT <= 0) $('big').hidden = true; }
  if (ramCool > 0) ramCool -= dt;
  trisslott.update(dt);
  placeMeshes.update(dt);

  const jump = jumpQ; jumpQ = false;
  if (inCar) { drive(pcar, my, mx, !!keys.brake, dt, true); ride(player, pcar); }
  else {
    walk(player, dt, mx, my, camYaw, { run: !!keys.run || joy.on, wet: inWater(player.x, player.z), still: bigT > 0 || !!places.inside }, HALF);
    collide(player, 0.5);
    if (!places.inside) for (const c of cars) { const dx = player.x - c.x, dz = player.z - c.z, d = Math.hypot(dx, dz); if (d < 1.6 && d > 0.01) { player.x += dx / d * (1.6 - d); player.z += dz / d * (1.6 - d);
      const a = c.mode === 'ai' ? c.h : c.vh, n = runOverHurt(impactSpeed(Math.sin(a) * c.v, -Math.cos(a) * c.v, -dx / d, -dz / d));   // the car's speed towards you
      if (n > 0 && clockS - runOverAt >= CRASH_COOL_S) { runOverAt = clockS; hurtPlayer(n); shake(n); if (health.hp <= 0) break; } } }
    const wetNow = inWater(player.x, player.z);                // after this frame's move: take-off and wading depth follow where the player stands now
    hop(player, dt, jump && !wetNow && !places.inside && bigT <= 0);   // on foot, Space and the touch Brake button jump
    // walking: arms swing against the legs and the body bobs; in the air: legs apart and both arms up
    const air = player.y > 0, sw = air ? 0.5 : Math.sin(player.phase) * 0.75, lift = player.y + (air ? 0 : Math.abs(Math.sin(player.phase)) * 0.05), m = player.mesh;
    m.legs[0].rotation.x = sw; m.legs[1].rotation.x = -sw; m.arms[0].rotation.x = air ? 2.4 : -sw * 0.8; m.arms[1].rotation.x = air ? 2.4 : sw * 0.8;
    m.blob.position.y = 0.06 - lift;                          // the blob shadow stays on the ground
    m.position.set(player.x, groundAt(player.x, player.z) - (wetNow ? 0.95 : 0) + lift, player.z); m.rotation.y = -player.h;
  }
  updateDriftFx(inCar ? pcar : null);
  const T = inCar ? pcar : player;
  vehicleVisuals.update(T, dt);
  updateSmoke(dt, T);
  updateRain(dt); confetti.update(dt);
  for (const c of cars) if (c.mode === 'ai') updateTraffic(c, dt, T);
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
  if (!started) { camYaw = wrap(camYaw + dt * 0.07); dist = 46; camPitch = 0.42; }
  else if (inCar) { lookIdle += dt; if (lookIdle > 1.2 && !input.dragging) lookOff *= Math.pow(0.02, dt);
    camYaw += wrap(pcar.h - pcar.slip * 0.6 + lookOff - camYaw) * Math.min(1, dt * 4.5); dist = 10 + Math.abs(pcar.v) * 0.09; }
  else dist = places.inside ? 15 : 6.2;
  const cp = Math.cos(camPitch), cx = T.x - Math.sin(camYaw) * dist * cp, cz = T.z + Math.cos(camYaw) * dist * cp;
  camera.position.set(cx, Math.max(ty + 1.5 + dist * Math.sin(camPitch), hAt(cx, cz) + 0.8), cz);
  camera.lookAt(T.x, ty + 1.5, T.z);
  if (shakeT > 0) { shakeT -= dt; const k = Math.max(0, shakeT / SHAKE_S) ** 2 * shakeM * 2;   // eases out, so the jolt fades instead of stopping dead
    camera.position.x += (dmgRnd() - 0.5) * k; camera.position.y += (dmgRnd() - 0.5) * k; camera.position.z += (dmgRnd() - 0.5) * k; }
  sun.target.position.set(T.x, ty, T.z); sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 400);
  skyDome.update(camera.position, now / 1000, dt); sun.intensity = SUN_I * skyDome.sunFactor;   // also centres the dome

  // HUD
  drawHearts(dt);
  hud.update(dt);
  if (!hud.toasting && laterLine && bigT <= 0) { toast(laterLine, 3); laterLine = null; }
  signT -= dt; if (signT <= 0) { signT = 0.25; updateSign(T); catRideLines();
    const pr = $('prompt'), pl = started && !places.inside ? nearPlace() : null, kt = started ? nearCat() : null, c = started && !inCar && !places.inside ? nearestCar() : null;
    $('hide').hidden = !places.inside;
    if (menuStay && !menuStay()) closeMenu();
    if (places.inside) { $('hide').innerHTML = wanted.stars ? 'Lying low<b>' + Math.floor(Math.ceil(Math.max(0, wanted.hideLeft)) / 60) + ':' + String(Math.ceil(Math.max(0, wanted.hideLeft)) % 60).padStart(2, '0') + '</b>' : 'Safehouse · ' + places.inside.name;
      pr.hidden = false; pr.innerHTML = '<kbd>E</kbd>Go outside'; }
    else if (catFirst(kt, pl)) { pr.hidden = !kmenu.hidden; pr.innerHTML = '<kbd>E</kbd>' + (kt.owned ? 'Hang out with ' + esc(kt.name) : 'Pet the cat' + (treats ? ' (offer a treat)' : '')); }
    else if (pl) { pr.hidden = !kmenu.hidden; pr.innerHTML = '<kbd>E</kbd>' + (pl.kind === 'safe' ? 'Go inside the safehouse' : 'Handla i kiosken'); }
    else if (inCar && !coarse) { pr.hidden = tooFastToGetOut(pcar); pr.innerHTML = '<kbd>E</kbd>Get out'; }
    else if (c) { pr.hidden = false; pr.innerHTML = '<kbd>E</kbd>' + (c.owned ? 'Get in the ' : 'Steal the ') + carName(c) + (wrecked(c) ? ' (wrecked)' : ''); }
    else pr.hidden = true;
    const bl = inCar ? 'Brake' : 'Jump'; if ($('p-brake').textContent !== bl) $('p-brake').textContent = bl;
    $('speed').hidden = !inCar; if (inCar) { $('kmh').textContent = Math.round(Math.abs(pcar.v) * 3.6); $('carname').textContent = carName(pcar) + (wrecked(pcar) ? ' · wrecked' : ''); }
    drawHealth(); }
  drawMini(T);
  renderer.render(scene, camera);
}
$('go').addEventListener('click', e => { started = true; $('intro').hidden = true; camYaw = START_CAM[0]; camPitch = START_CAM[1]; canvas.focus();
  if (e.pointerType ? e.pointerType === 'mouse' : !coarse) input.lockMouse();   // by how Start was pressed: a tap on a touchscreen laptop shouldn't lock
  toast('Find a car and press E to take it. Occupied cars always get you a wanted star.', 5); });
resize(); requestAnimationFrame(frame);

// ---------- test hook: read-only state for the smoke tests (tests/e2e), so they do not have to read pixels ----------
window.__joyride = { state: () => { const n = nearestCar(); return { started, lab: lab.list(), x: player.x, z: player.z, y: player.y, yaw: camYaw, inCar, car: pcar ? pcar.type : null, near: n ? n.mode : null, speed: pcar ? pcar.v : 0, drift: pcar ? pcar.drift : 0, boost: pcar ? pcar.boost : 0, charge: pcar ? pcar.charge : 0, loose: pcar ? pcar.loose : 0, flickDir: pcar ? pcar.flickDir : 0, flickHeld: pcar ? pcar.flickHeld : 0, stars: wanted.stars, cats: cats.length, treats, kr: wallet.kr, bills: bills.filter(b => b.visible).length, confetti: confetti.live, devcon: devcon.isOpen, hp: health.hp, carDmg: pcar ? pcar.dmg : null, ownCat: !!colony.owned, vehicle: displayCar ? vehicleVisuals.state(displayCar) : null, nearSelectedVehicle: n === displayCar, activeVehicle: pcar ? vehicleVisuals.state(pcar) : null, body: pcar ? bodyMotion.state(pcar) : null, wheelbase: (pcar || displayCar)?.T.handling.wheelbaseM ?? 0, traffic: cars.filter(c => c.mode === 'ai').map(c => ({ type: c.type, vehicle: vehicleVisuals.state(c) })), clouds: skyDome.state(), streetscape: streetscapeState() }; } };
function streetscapeState() { const L = street.layout, m = L.sidewalkM, r = v => Math.round(v);
  return { sidewalkM: { mapped: r(m.mapped), derived: r(m.derived), inferred: r(m.inferred) }, parkingAreas: L.lots.length, crossings: L.crossings,
    streetTrees: { mapped: L.trees.filter(t => t.source === 'mapped').length, inferred: L.trees.filter(t => t.source === 'inferred').length },
    meshes: street.meshes.length, triangles: street.tris, buildMs: Math.round(street.ms), debug: DEBUG_STREETSCAPE }; }
})();
