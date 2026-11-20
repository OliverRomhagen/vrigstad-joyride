// @ts-nocheck
// Moved as-is from the single-file prototype (#44); it gets types as it is split into modules.
import * as THREE from 'three';
import { AdoptHearts } from './render/adopt-heart';
import { DriftFx } from './render/drift-fx';
import { vehicleDefinition } from './render/vehicle-registry';
import { VehicleVisuals } from './render/vehicle-visuals';
import { BodyMotion } from './render/body-motion';
import { CarDamageFx } from './render/car-damage';
import { CarMeshes } from './render/car-meshes';
import D from '../../data/vrigstad.json';
import { LabFlags } from '../lab/flags';
import { BuildingIndex } from '../world/buildings';
import { ROAD_WIDTH_M as ROAD_W } from '../world/data';
import { Heightfield } from '../world/heightfield';
import { clamp, wrap } from '../world/math';
import { makeRnd } from '../world/random';
import { RoadNetwork } from '../world/roads';
import { buildStreetscape, sidewalkCentreM, StreetscapeIndex } from '../world/streetscape';
import { STREETSCAPE_OVERRIDES } from '../world/streetscape-overrides';
import { classifyStreetscape } from '../world/streetscape-rules';
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
import { GroundTexture } from './render/ground-texture';
import { BAR_BLUE, BAR_RED, barGeo, barMat, blob, blobTex, boxGeo, carGeo, carMat, GLASS, geoCache, PROFILES, paintMat, personParts, TRACTOR_CAB } from './render/models';
import { buildStage, col, SUN_DIR, SUN_I, setUpRenderer } from './render/stage';
import { addBuildings, addRoadRibbons, addStreetscapeMeshes, addTerrain, addTrees } from './render/world-meshes';
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

// ---------- renderer and stage: fog, lights, sky and camera (src/game/render/stage.ts) ----------
const canvas = $('gl');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
catch { $('fail').hidden = false; $('ui').hidden = true; $('intro').hidden = true; return; }
const coarse = matchMedia('(pointer: coarse)').matches;
setUpRenderer(renderer, coarse);
const { scene, camera, sun, skyDome } = buildStage(coarse, location.search);
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

// ---------- lab: opt-in experiments, switched on with ?lab=<id>,<id> (src/lab/) ----------
// each one is imported only when its flag is on, so with everything off the game runs exactly as without the lab;
// after the WebGL check, so none starts behind the fail screen, and one that fails to load or start only warns
const lab = LabFlags.fromSearch(location.search);
if (lab.on('hello')) import('../lab/hello').then(m => m.startHello()).catch(err => console.warn('Lab: hello failed', err));

// ---------- ground texture (also feeds the minimap: src/game/render/ground-texture.ts) ----------
const ground = new GroundTexture(D, { coarse, maxTextureSize: renderer.capabilities.maxTextureSize, maxAnisotropy });
const { canvas: tex2d, texture, K, P } = ground;

// ---------- terrain (its mesh, and the roads', buildings', streetscape's and trees': src/game/render/world-meshes.ts) ----------
addTerrain(scene, heightfield, texture);

// ---------- roads: crisp ribbons on the terrain + lookup grid + junction graph ----------
const roads = new RoadNetwork(D, heightfield), { lines: R } = roads;
let streetIndex = null;   // the streetscape's walkable height, built further down once the buildings and trees are known
// what people, cats and cars stand on: the road, or the curb, pavement or parking area above it
const groundAt = (x, z) => { const g = roads.groundAt(x, z), s = streetIndex && streetIndex.surfaceAt(x, z); return s !== null && s > g ? s : g; };
const roadRibbons = addRoadRibbons(scene, roads, heightfield, maxAnisotropy);

// ---------- water ----------
const water = new Water(D, roads), inWater = water.inWater.bind(water);

// ---------- buildings (painted in Swedish house colours) + collision grid ----------
const buildings = new BuildingIndex(D), { footprints: bPolys } = buildings;
const addFootprint = buildings.addFootprint.bind(buildings), collide = buildings.collide.bind(buildings);
addBuildings(scene, D, heightfield, { rnd, pick, maxAnisotropy });   // rolls rnd() for the house colours, before any tree spot

// ---------- trees: spruces and birches, each with its own shade, size and lean ----------
const TREE_M2_PER_TRY = 110, TREE_ROAD_CLEARANCE_M = 2.5;   // one try at a tree per this much of a wood's bounding box; no trunk closer to a road's edge
const forestSpots = treeSpots(D, rnd, { squareMetresPerTry: TREE_M2_PER_TRY, minScale: 0.7, scaleSpread: 0.8, roads, roadClearanceM: TREE_ROAD_CLEARANCE_M });

// ---------- streetscape: curbs, pavements, verges, crossings and parking from OSM, rules where OSM says nothing (#187) ----------
const DEBUG_STREETSCAPE = new URLSearchParams(location.search).get('debug') === 'streetscape';   // ?debug=streetscape tints by evidence
const street = (function () {
  const t0 = performance.now(), sides = classifyStreetscape(D, roads, buildings, STREETSCAPE_OVERRIDES);
  const layout = buildStreetscape({ data: D, roads, heightfield, buildings, water, sides, avoidTrees: forestSpots.filter((_, i) => i % 3 < 2), treeRoadClearanceM: TREE_ROAD_CLEARANCE_M });
  streetIndex = new StreetscapeIndex(layout, D, heightfield);
  const { meshes, tris } = addStreetscapeMeshes(scene, layout, D, heightfield, roadRibbons.materials, DEBUG_STREETSCAPE);
  return { layout, sides, meshes, tris, ms: performance.now() - t0 };
})();
// the pavement's centre line where a side has one, else today's walking line on the shoulder
const walkOffset = (ri, side) => { const sp = side < 0 ? street.sides[ri].left : street.sides[ri].right; return sidewalkCentreM(sp, R[ri].c) ?? ROAD_W[R[ri].c] / 2 + 0.8; };
// the forests' trees and the street trees, with a soft shadow under each baked into the ground texture (the minimap shows them too)
ground.bakeTreeShadows(addTrees(scene, forestSpots, street.layout.trees, heightfield, HALF), blobTex);

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
const crowd = new Crowd({ scene, roads, buildings, labels: D.labels, groundAt, walkOffset, coarse, rnd, pick, personParts, advance, cars,
  get player() { return player; }, get inCar() { return game.inCar; } });
const updateNpcs = crowd.update.bind(crowd);

// ---------- cats: lounge by the house walls, wander a little, bolt from cars and running feet (src/game/cats.ts) ----------
// the getters are read when the cats use them, so they can name things declared further down
const colony = new CatColony({ scene, buildings, inWater, groundAt, half: HALF, coarse, geoCache, boxGeo, paintMat, blob, cars, toast,
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
const wanted = new Wanted({ roads, rnd, pick, removeCar, drive, toast,
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
