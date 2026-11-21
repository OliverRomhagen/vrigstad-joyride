// The game page: creates the modules and connects them (#177). What each does is in its own file; the sections below
// say where.
import * as THREE from 'three';
import { AdoptHearts } from './render/adopt-heart';
import { Banknotes } from './render/banknotes';
import { DriftFx } from './render/drift-fx';
import { type VehicleId, vehicleDefinition } from './render/vehicle-registry';
import { VehicleVisuals } from './render/vehicle-visuals';
import { BodyMotion } from './render/body-motion';
import { CarDamageFx } from './render/car-damage';
import { CarMeshes, type RenderedCar } from './render/car-meshes';
import { CameraRig } from './render/camera-rig';
import { ShoutingDrivers } from './render/shouting-drivers';
import data from '../../data/vrigstad.json';
import { LabFlags } from '../lab/flags';
import { BuildingIndex } from '../world/buildings';
import { ROAD_WIDTH_M as ROAD_W, type WorldData } from '../world/data';
import { Heightfield } from '../world/heightfield';
import { clamp, wrap } from '../world/math';
import { makeRnd } from '../world/random';
import { RoadNetwork } from '../world/roads';
import { buildStreetscape, sidewalkCentreM, StreetscapeIndex } from '../world/streetscape';
import { STREETSCAPE_OVERRIDES } from '../world/streetscape-overrides';
import { classifyStreetscape } from '../world/streetscape-rules';
import { col } from '../world/three-legacy';
import { treeSpots } from '../world/trees';
import { Water } from '../world/water';
import { type Car, type CarMode, Fleet, newCar, TURBO_AT } from './cars';
import { CatColony } from './cats';
import { Hud } from './hud';
import { Input } from './input';
import { Actions, WANTED_LINES } from './actions';
import { Crowd } from './pedestrians';
import { ActionPrompt } from './prompt';
import { Crashes } from './crashes';
import { GameLoop } from './loop';
import { installTestHook } from './test-hook';
import { esc, MenuPlate } from './menu';
import { KioskCatMenus } from './kiosk-cat-menus';
import { Pets } from './pets';
import { Commands, parseKr, UsageError } from './commands';
import { Confetti } from './confetti';
import { DevConsole, isConsoleKey } from './devconsole';
import { earn, fmtKr, newWallet, pay, RAIN_KR } from './economy';
import { KIOSK, type Place, Places } from './places';
import { CAT_SCRATCH_HP, LOW_HP, hurt, newHealth } from './health';
import { HOME } from './player';
import { Wanted } from './police';
import { PlaceMeshes } from './render/places';
import { GroundTexture } from './render/ground-texture';
import { BAR_BLUE, BAR_RED, barGeo, barMat, blob, blobTex, boxGeo, carGeo, carMat, GLASS, geoCache, PROFILES, paintMat, personParts, TRACTOR_CAB } from './render/models';
import { buildStage, setUpRenderer } from './render/stage';
import { addBuildings, addRoadRibbons, addStreetscapeMeshes, addTerrain, addTrees } from './render/world-meshes';
import { type CarType, specFor } from './sim/vehicle-spec';
import { newGameState, newViewState } from './state';
import { Trisslott, trisslottSeed } from './trisslott';

(function () {
'use strict';
// the optional fields are absent from the JSON's inferred type when the snapshot has none, so read it as WorldData
const D = data as unknown as WorldData;
// every id asked for is in index.html
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const S = D.size, HALF = S / 2;
// seeded streams: rnd() drives the world and gameplay; side systems get their own stream so they don't shift its rolls
const rnd = makeRnd(57355);
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
// the shared state that the sections below and the modules read and write (src/game/state.ts)
const game = newGameState();
const START_CAM: [yaw: number, pitch: number] = [0.6, 0.34];   // camera yaw and pitch at Start
const view = newViewState(START_CAM[0], START_CAM[1]);

// ---------- terrain height (matches the mesh triangles exactly) ----------
// the world's queries are bound once, so the code below calls them as plain functions
const heightfield = new Heightfield(D), hAt = heightfield.heightAt.bind(heightfield);
const _n = new THREE.Vector3();
const normalAt = (x: number, z: number) => heightfield.normalAt(x, z, _n);

// ---------- renderer and stage: fog, lights, sky and camera (src/game/render/stage.ts) ----------
const canvas = $('gl') as HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
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
let streetIndex: StreetscapeIndex | null = null;   // the streetscape's walkable height, built further down once the buildings and trees are known
// what people, cats and cars stand on: the road, or the curb, pavement or parking area above it
const groundAt = (x: number, z: number) => { const g = roads.groundAt(x, z), s = streetIndex && streetIndex.surfaceAt(x, z); return s !== null && s > g ? s : g; };
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
const walkOffset = (ri: number, side: number) => { const sp = side < 0 ? street.sides[ri].left : street.sides[ri].right; return sidewalkCentreM(sp, R[ri].c) ?? ROAD_W[R[ri].c] / 2 + 0.8; };
// the forests' trees and the street trees, with a soft shadow under each baked into the ground texture (the minimap shows them too)
ground.bakeTreeShadows(addTrees(scene, forestSpots, street.layout.trees, heightfield, HALF), blobTex);

// ---------- cars ----------
// the rules (driving, traffic, the parked cars) are in src/game/cars.ts; the meshes in src/game/render/car-meshes.ts
// the getters are read when they are used, so they can name things declared further down
const bodyMotion = new BodyMotion();
const vehicleVisuals = new VehicleVisuals(coarse, (c, body) => bodyMotion.addNode(c as RenderedCar, body));
const carMeshes = new CarMeshes({ scene, groundAt, normalAt, carGeo, carMat, blob, barGeo, barMat, vehicleVisuals, bodyMotion });
const placeCar = carMeshes.placeCar.bind(carMeshes);
// every car has its meshes: addCar attaches them before the Fleet holds it, so the sim's Car is a RenderedCar here
const meshed = (c: Car) => c as RenderedCar;
// the car gets its meshes, then the Fleet holds it, so a car in the list always has them; the rolls keep their order: the model (its own stream), then the colour (rnd)
function addCar(type: CarType, x: number, z: number, h: number, mode: CarMode, assetId: VehicleId | undefined = carMeshes.pickModel(type)) {
  const T = specFor(type, vehicleDefinition(assetId ?? null));
  return fleet.add(carMeshes.attach(newCar(type, x, z, h, mode, T, pick(T.cols)), assetId));
}
function removeCar(c: Car) { carMeshes.detach(meshed(c)); fleet.remove(c); }
const fleet = new Fleet({ roads, buildings, water, half: HALF, rnd, pick, addCar, placeCar: c => placeCar(meshed(c)), crash: (c, o, impact) => crashes.crash(c, o, impact),
  canPark: (x, z) => streetIndex!.surfaceAt(x, z) === null,   // streetIndex is built before parkCars runs
  rammed: c => { if (c === game.pcar && game.ramCool <= 0) { game.ramCool = 6; wanted.addStar(pickLine(WANTED_LINES) + ' Ramming a police car. That will not help.'); } },
  get player() { return player; }, get inCar() { return game.inCar; } });
const cars = fleet.cars as RenderedCar[], drive = fleet.drive.bind(fleet), advance = fleet.advance.bind(fleet), spawnTraffic = fleet.spawnTraffic.bind(fleet), updateTraffic = fleet.updateTraffic.bind(fleet);
const selectedVehicle = vehicleDefinition(new URLSearchParams(location.search).get('vehicle'));
// dev mode (#218): on with npm run dev, or with ?dev on any build (preview links too). § or ` then opens the dev console.
const DEV = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');
const calmMotion = matchMedia('(prefers-reduced-motion: reduce)');
let displayCar: RenderedCar | null = null;
function carName(c: Car) { return vehicleVisuals.definition(meshed(c))?.name || c.T.name; }
fleet.parkCars();   // parked cars along streets and driveways
for (let i = 0; i < 18; i++) spawnTraffic(null);

// ---------- camera: follows you, shakes on a crash; the sun and sky follow it (src/game/render/camera-rig.ts) ----------
// the getters are read every frame, so they can name things declared further down
const dmgRnd = makeRnd(808);                   // own stream for the shake and the smoke puffs, which roll every frame
const cameraRig = new CameraRig({ camera, sun, skyDome, game, view, get dragging() { return input.dragging; }, get inside() { return !!places.inside; },
  groundAt, heightAt: hAt, rnd: dmgRnd, calmMotion });
const shake = cameraRig.shake;

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
  get player() { return player; }, get keys() { return keys; }, get joy() { return joy; }, get kmenu() { return kmenu; }, get inCar() { return game.inCar; }, get pcar() { return game.pcar && meshed(game.pcar); }, get inside() { return places.inside; },
  useTreat() { if (game.treats <= 0) return false; game.treats--; drawTreats(); return true; }, scratched() { hurtPlayer(CAT_SCRATCH_HP); } });
const { cats } = colony, updateCats = colony.update.bind(colony), catFirst = colony.catFirst.bind(colony), nearCat = colony.nearest.bind(colony);

// ---------- crashes: what you say and feel when you hit something, and what you say to your cat riding along (src/game/crashes.ts) ----------
const crashes = new Crashes({ game, colony, get viewer() { return camera.position; }, toast, hurtPlayer, shake });
const { pickLine } = crashes;

// ---------- your pets: P (or the Pets button) calls them, sends them home or sets them free (src/game/pets.ts) ----------
// small menus on one plate (the kiosk, a cat, your pets, naming a pet: src/game/menu.ts)
// the getters are read when the plate uses them, so they can name things declared further down
const kmenu = $('kmenu');
const menuPlate = new MenuPlate({ kmenu, canvas, doc: document, get input() { return input; }, get hasPets() { return !!colony.owned; }, openPets: () => openPets(), toast,
  get consoleRelock() { return conRelock; }, closeConsole: () => devcon.close() });
const { openMenu, closeMenu, openRename, menuKey } = menuPlate;
// the getter is read when a pet is called, so it can name things declared further down
const pets = new Pets({ colony, button: $('pets'), openMenu, openRename, esc, get caller() { return game.inCar && game.pcar ? game.pcar : player; } });
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
const wallet = newWallet();
const wanted = new Wanted({ roads, rnd, pick, removeCar, drive, toast,
  spawnCar: (x, z, h) => addCar('polis', x, z, h, 'police'),
  drawStars: () => drawStars(), showEvading: on => $('stars').classList.toggle('evading', on), caught: n => busted(n),
  get lyingLow() { return !!places.inside; } });

// ---------- places: safehouses (lie low to lose your stars) and the trisslott kiosk ----------
// the getter is read when a place uses it, so it follows the stars
const places = new Places({ footprints: bPolys, roads: R, police: wanted.police, lieLow: secs => wanted.lieLow(secs), toast, get stars() { return wanted.stars; } });
const placeMeshes = new PlaceMeshes({ scene, places, heightAt: hAt, col, boxGeo, paintMat, glass: GLASS });
addFootprint([KIOSK.x - KIOSK.w / 2, KIOSK.z - KIOSK.d / 2, KIOSK.x + KIOSK.w / 2, KIOSK.z - KIOSK.d / 2, KIOSK.x + KIOSK.w / 2, KIOSK.z + KIOSK.d / 2, KIOSK.x - KIOSK.w / 2, KIOSK.z + KIOSK.d / 2]);   // the kiosk collides like a building
// the kiosk's and the cats' menus (src/game/kiosk-cat-menus.ts); trisslott is declared further down
const kioskCatMenus = new KioskCatMenus({ game, player, colony, health, openMenu, esc, toast, scratch: () => trisslott.scratch(), wallet, nearPlace, showHeart, drawPets, drawTreats, drawHealth });
const { openKiosk, petCat, openOwnCat } = kioskCatMenus;
function nearPlace() { return game.inCar ? null : places.nearest(player.x, player.z); }
function enterHouse(p: Place) { if (places.enter(p, player)) player.mesh.visible = false; }
function leaveHouse() { if (!places.leave()) return; player.mesh.visible = true; $('hide').hidden = true; }
// ---------- car damage: cracked glass, and smoke from the bonnet (src/game/render/car-damage.ts) ----------
const carDamage = new CarDamageFx({ scene, groundAt, profiles: PROFILES, tractorCab: TRACTOR_CAB, vehicleVisuals, rnd: dmgRnd, cars }), updateSmoke = carDamage.updateSmoke.bind(carDamage);

// ---------- låt det regna: an easter egg, L throws RAIN_KR in the air as banknotes that flutter down around you (src/game/render/banknotes.ts) ----------
const cashRnd = makeRnd(1000);                               // own stream for the banknotes and the confetti, so they don't shift the world's rolls
const banknotes = new Banknotes({ scene, doc: document, groundAt, rnd: cashRnd, calmMotion });
const RAIN_SEEN_M = 20, RAIN_GAWK_S = 5;                     // walkers this close (m) stop and stare this long (s)
const RAIN_LINES = ['”Låt dä regna!”', '”Pengar ä bara papper, dä.”', '”Hôll i hatten, nu regnar dä sedlar!”'];
const GAWK_LINES = ['”Va i hela friden!”', '”Ä du inte klok, människa?!”', '”Hörru, ja tar en sån där!”'];
function makeItRain() {
  if (!game.started || game.bigT > 0 || places.inside || !kmenu.hidden) return;
  if (!pay(wallet, RAIN_KR)) { toast('”Låta dä regna? Mä ' + fmtKr(wallet.kr) + '? Nä.”', 2.5); return; }
  const you = game.inCar && game.pcar ? game.pcar : player; banknotes.drop(you);
  const seen = crowd.stare(you, RAIN_SEEN_M, RAIN_GAWK_S);
  toast(pickLine(RAIN_LINES), 2.5); if (seen) loop.sayLater(pickLine(GAWK_LINES));
}

// trisslott (src/game/trisslott.ts): the vinstplan is in economy.ts; a win fires confetti (src/game/confetti.ts), and a big one rains banknotes too
const confetti = new Confetti($('confetti') as HTMLCanvasElement, cashRnd, calmMotion);
// the tickets' own stream, so scratching doesn't shift the world's rolls; ?seed=n pins it
const trissRnd = makeRnd(trisslottSeed(new URLSearchParams(location.search), () => crypto.getRandomValues(new Uint32Array(1))[0]));
const trisslott = new Trisslott({ random: trissRnd, pick, now: () => performance.now() / 1000, toast, wallet,
  celebrate: kr => confetti.celebrate(kr), rainNotes: () => { if (!calmMotion.matches) banknotes.drop(player); },
  draw: (bought, won, wonKr) => hud.drawTrisslott(bought, won, wonKr) });
// ?at=x,z[,yaw[,pitch]] starts the player there, looking that way: for review screenshots, such as the streetscape's (#187)
(function () { const at = (new URLSearchParams(location.search).get('at') || '').split(',').map(Number);
  if (at.length < 2 || !at.every(Number.isFinite)) return; player.x = at[0]; player.z = at[1]; if (at.length > 2) view.camYaw = START_CAM[0] = at[2]; if (at.length > 3) START_CAM[1] = clamp(at[3], 0.06, 1.25); })();

// ---------- input: keys, mouse look and the touch controls (src/game/input.ts) ----------
// the dev console sees each key first, then the menus (src/game/menu.ts)
function consoleKey(e: KeyboardEvent) {
  // keys typed in the console stop there and never get here; with the console open and focus elsewhere (a click on its output, Tab), keys go back to it
  if (devcon.isOpen) { e.preventDefault(); if ((isConsoleKey(e) || e.code === 'Escape') && !e.repeat) devcon.close(); else devcon.focus(); return true; }   // the key that takes focus back isn't typed
  if (DEV && !e.repeat && kmenu.hidden && isConsoleKey(e)) { e.preventDefault(); devcon.open(); return true; }
  return menuKey(e);
}
canvas.addEventListener('pointerdown', () => devcon.close());   // before the input's own, so a click that closes the console can take the mouse back
const input = new Input({ win: window, doc: document, canvas, $, coarse, menuKey: consoleKey,
  get started() { return game.started; }, get menuOpen() { return !kmenu.hidden; },
  action: () => action(), respawn: () => respawn(), rain: () => makeItRain(),
  jump: () => { if (jumpOk()) game.jumpQ = true; },   // queue only where a jump can start (see jumpOk)
  look: (dx, dy) => { if (game.inCar) { view.lookOff = wrap(view.lookOff + dx * 0.006); view.lookIdle = 0; } else view.camYaw = wrap(view.camYaw + dx * 0.006);
    view.camPitch = clamp(view.camPitch + dy * 0.004, 0.06, 1.25); },
  lockLost: () => { if (!devcon.isOpen && !hud.toasting) toast('Click the game to look around with the mouse again.', 3); } });
const { keys, joy } = input;

// ---------- HUD (src/game/hud.ts) ----------
// the getters are read when the HUD uses them, so they can name things that change during play
const hud = new Hud({ $, ground: tex2d, P, K, roads, labels: D.labels, cars, places: places.list,
  get stars() { return wanted.stars; }, get pcar() { return game.pcar; }, get blink() { return loop.blink; }, get kr() { return wallet.kr; } });
// a declaration, not a bound const, so the sections above can pass toast on before the HUD exists
function toast(msg: string, secs?: number, cls?: string) { hud.toast(msg, secs, cls); }
const drawStars = hud.drawStars.bind(hud), drawMini = hud.drawMini.bind(hud), updateSign = hud.updateSign.bind(hud);
drawStars();
function drawHealth() { hud.drawHealth(health.hp, game.inCar && game.pcar ? game.pcar.dmg : null); }
// the big screen (Gripen!, Däckad!) stays up this long
function bigScreen(title: string, msg: string) { hud.showBig(title, msg); game.bigT = 3; }
hud.drawKr();   // the HUD keeps the money plate in step with the wallet from here on

// ---------- dev console ----------
// Each module's commands are registered here until main.ts is split up; a module that owns its state can register its own.
const commands = new Commands();
let conRelock = false;
const devcon = new DevConsole({ root: $('devcon'), commands,
  onOpen: () => { input.releaseKeys(); conRelock = input.locked(); if (conRelock) document.exitPointerLock(); },
  onClose: () => { canvas.focus(); if (conRelock && kmenu.hidden) input.lockMouse(); conRelock = false; } });   // an open menu needs the cursor
const MYNT_KR = 1000;   // what the mynt cheat adds
function addKr(kr: number) { if (kr >= 0) earn(wallet, kr); else pay(wallet, Math.min(-kr, wallet.kr)); return 'Wallet: ' + fmtKr(wallet.kr) + '.'; }
commands.register('kr', { usage: '<amount>', help: 'add riksdaler to your wallet; a negative amount takes them', run: a => addKr(parseKr(a[0])) });
// adopt <pet>: a new random pet of that kind, right by you. Only cats so far; another kind of pet adds its entry here.
const ADOPT = new Map([['cat', () => { if (colony.owned) return 'You already have a cat, ' + colony.owned.name + '. Set it free first (P).';
  if (game.inCar) return 'Get out of the car first.';   // a cat made by the car would land inside it
  const cat = colony.spawnNear(player); colony.adopt(cat); showHeart(cat); drawPets(); return 'Adopted a cat.'; }]]);
commands.register('adopt', { usage: '<' + [...ADOPT.keys()].join(' | ') + '>', help: 'adopt a new random pet of that kind',
  run: a => { const f = a[0] && ADOPT.get(a[0].toLowerCase()); if (!f) throw new UsageError(a[0] ? 'No pet called ' + a[0] + '.' : ''); return f(); } });
commands.register('mynt', { help: 'add ' + fmtKr(MYNT_KR) + ' to your wallet', run: () => addKr(MYNT_KR) });

// ---------- stealing and getting caught (the wanted level and the police: src/game/police.ts) ----------
// the driver of a car you steal gets out, and stands there shouting for a while (src/game/render/shouting-drivers.ts)
const drivers = new ShoutingDrivers({ scene, groundAt, personParts, pick }), driverOut = drivers.driverOut;
// what E does, and putting you back on your feet after Gripen! or a knock-out (src/game/actions.ts)
const actions = new Actions({ game, view, player, cars, places, wanted, health, wallet, menuOpen: () => !kmenu.hidden, closeMenu, showPlayer: v => { player.mesh.visible = v; }, nearPlace, enterHouse, leaveHouse, nearCat, catFirst, openOwnCat, petCat, openKiosk, collide, placeCar, rnd, pick, toast, carName,
  spokenName: c => vehicleVisuals.definition(meshed(c))?.spokenName, driverOut, spawnTraffic, drawStolen: () => { $('count').textContent = 'Cars stolen: ' + game.stolen; }, drawHealth, bigScreen, sayLater: line => loop.sayLater(line), pickLine });
const { nearestCar, action, respawn, busted, knockedOut } = actions;
function hurtPlayer(n: number) { if (n <= 0) return; const was = health.hp;
  hud.flashHurt(n); hurt(health, n); drawHealth();
  if (was >= LOW_HP && health.hp < LOW_HP && health.hp > 0) loop.sayLater('”Ja behöver nog en korv me brö.”'); }   // a hint at the kiosk

// ---------- the E prompt and the speed plate (src/game/prompt.ts) ----------
const prompt = new ActionPrompt({ $, game, places, wanted, get menuOpen() { return !kmenu.hidden; }, coarse, nearPlace, nearCat, nearestCar, catFirst, carName, esc });

// ---------- main loop (src/game/loop.ts) ----------
const loop = new GameLoop({ $, renderer, scene, camera, canvas, coarse, half: HALF, game, view, player, health, input, places, wanted, cars, startCam: START_CAM, barMat, barColours: [BAR_BLUE, BAR_RED], cameraRig,
  get toasting() { return hud.toasting; }, inWater, collide, groundAt, drive, updateTraffic, knockedOut, hurtPlayer, shake, toast,
  updateTrisslott: dt => trisslott.update(dt), updatePlaces: dt => placeMeshes.update(dt), updateDriftFx, updateVehicles: (T, dt) => vehicleVisuals.update(T, dt), updateSmoke, updateBanknotes: dt => banknotes.update(dt), updateConfetti: dt => confetti.update(dt), updateNpcs, updateCats,
  updateDrivers: (T, dt) => drivers.update(T, dt), updateBodies: (T, dt) => bodyMotion.update(T, dt), drawHearts, updateHud: dt => hud.update(dt), drawMini,
  updateSign, catRideLines: () => crashes.catRideLines(), closeMenuIfLeft: () => menuPlate.closeIfLeft(), updatePrompt: () => prompt.update(), drawHealth });
$('go').addEventListener('click', loop.startGame);
loop.start();

// ---------- test hook: read-only state for the smoke tests (src/game/test-hook.ts) ----------
installTestHook({ game, view, player, health, cars, labs: lab.list(), get stars() { return wanted.stars; }, get cats() { return cats.length; }, get ownCat() { return !!colony.owned; }, get displayCar() { return displayCar; },
  vehicleVisuals: { state: c => vehicleVisuals.state(meshed(c)) }, bodyMotion: { state: c => bodyMotion.state(meshed(c)) }, skyDome, street, debugStreetscape: DEBUG_STREETSCAPE, nearestCar,
  get kr() { return wallet.kr; }, get banknotes() { return banknotes.live; }, get confetti() { return confetti.live; }, get devcon() { return devcon.isOpen; } });
})();
