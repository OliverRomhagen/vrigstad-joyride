// The marketing page (about.html): a hero, a small top-down getaway on the real map, the garage and a trisslott.
// It reads the same processed map data as the game, but none of the game code: this is a toy, not the simulation.
import D from '../../data/vrigstad.json';
import '../fonts/barlow';
import { trissPrize } from '../game/economy';
import { EVADE_DIST_M, EVADE_S as EVADE_TIME_S } from '../game/police';
import { type CarType as GameCarType, VEHICLE_SPECS } from '../game/sim/vehicle-spec';
import { TEMPER_LINES, temper } from '../game/trisslott';
import { ROAD_WIDTH_M as ROAD_W, type WorldData } from '../world/data';
import { clamp } from '../world/math';
import { makeRnd } from '../world/random';
import { RoadNetwork } from '../world/roads';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const HALF = D.size / 2;
// its own stream, seeded fresh each visit, so the police spawn and the tickets come out differently every time
const rnd = makeRnd(crypto.getRandomValues(new Uint32Array(1))[0]);

// ---------- vehicles (name, top speed, acceleration and off-road factor are the game's own: VEHICLE_SPECS) ----------

type CarType = Exclude<GameCarType, 'polis'>;
interface CarSpec {
  name: string;
  maxSpeedMs: number;
  accelMs2: number;
  offRoad: number;
  color: string;
  blurb: string;
}
const LOOKS: Record<CarType, Pick<CarSpec, 'color' | 'blurb'>> = {
  volvo: { color: '#a8232d', blurb: 'Square, safe and parked on every other driveway. The keys are probably in it.' },
  saab: { color: '#e6e4dc', blurb: 'The fastest thing in Vrigstad. Your best bet with three stars.' },
  epa: { color: '#e8a020', blurb: 'Legally limited to 30 km/h. Good luck outrunning anyone.' },
  traktor: { color: '#2f7a3a', blurb: 'Slow on the road and exactly as slow across a field. Fields are shortcuts.' },
};
const carSpec = (type: CarType): CarSpec => {
  const { name, max, acc, off } = VEHICLE_SPECS[type];
  return { name, maxSpeedMs: max, accelMs2: acc, offRoad: off, ...LOOKS[type] };
};
const CARS: Record<CarType, CarSpec> = {
  volvo: carSpec('volvo'),
  saab: carSpec('saab'),
  epa: carSpec('epa'),
  traktor: carSpec('traktor'),
};
const FASTEST_MS = Math.max(...Object.values(CARS).map(c => c.maxSpeedMs));
let carType: CarType = 'volvo';

// ---------- getaway tuning ----------

const MASK_PX_PER_M = 0.5; // resolution of the road/building lookup
const ZOOM_PX_PER_M = 5; // CSS pixels per metre on screen (less on phones)
const CAR_LEN_M = 4.6,
  CAR_W_M = 1.9;
const POLICE_MAX_MS = 35; // a little slower than a Volvo flat out, so a clean line gets away
const POLICE_OFFROAD = 0.6;
const POLICE_TURN_RAD_S = 1.6;
const CATCH_DIST_M = 4.5;
const STAR_UP_S = 12; // a new star (and police car) every this many seconds while they can see you
const SPAWN_DIST_M = [110, 160];
const TORGET = { x: 0, z: 0 };

// ---------- map: drawn as vectors every frame (crisp at any zoom), plus a lookup mask (red = road, green = building) ----------

const ROAD_FILL = ['#55585a', '#5d6062', '#66696a', '#77776f', '#a08c6c', '#b8ab90'];
const LAND = ['#a6c083', '#d9cf8b', '#b9b4a8', '#8fc072', '#93b77d', '#6f9a5e', '#7cc163'];

function trace(ctx: CanvasPath, p: number[], close: boolean) {
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  if (close) ctx.closePath();
}

// Paints the map in world metres; the caller sets the transform.
function paintMap(ctx: CanvasRenderingContext2D) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#9db87a';
  ctx.fillRect(-HALF, -HALF, D.size, D.size);
  for (let k = 0; k < LAND.length; k++) {
    ctx.fillStyle = LAND[k];
    ctx.fill(layers.land[k]);
  }
  ctx.strokeStyle = ctx.fillStyle = '#4f8fb8';
  ctx.lineWidth = 6;
  ctx.stroke(layers.rivers);
  ctx.lineWidth = 2;
  ctx.stroke(layers.streams);
  ctx.fill(layers.lakes, 'evenodd');
  for (const verge of [true, false])
    for (let cls = 5; cls >= 0; cls--) {
      if (verge && cls > 3) continue;
      ctx.strokeStyle = verge ? '#b3a78c' : ROAD_FILL[cls];
      ctx.lineWidth = ROAD_W[cls] + (verge ? 2.4 : 0);
      ctx.stroke(layers.roads[cls]);
    }
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.translate(0.8, 0.8);
  ctx.fill(buildings);
  ctx.translate(-0.8, -0.8); // cheap drop shadow
  ctx.fillStyle = '#8a8378';
  ctx.fill(buildings);
}
// each layer traced once into a Path2D, so a frame only fills and strokes them: tracing the whole 2.2 km map every frame was
// slow on phones
const path = (lines: readonly number[][], close: boolean) => {
  const p = new Path2D();
  for (const l of lines) trace(p, l, close);
  return p;
};
const layers = {
  land: LAND.map((_, k) =>
    path(
      D.l.filter(l => l.k === k).map(l => l.p),
      true,
    ),
  ),
  rivers: path(
    D.ww.filter(w => w.k === 0).map(w => w.p),
    false,
  ),
  streams: path(
    D.ww.filter(w => w.k !== 0).map(w => w.p),
    false,
  ),
  lakes: path(D.w.flat(), true), // one even-odd fill: the lakes don't overlap, and their islands are holes
  roads: ROAD_W.map((_, cls) =>
    path(
      D.r.filter(r => r.c === cls).map(r => r.p),
      false,
    ),
  ),
};
const buildings = new Path2D();
for (const b of D.b) {
  buildings.moveTo(b.p[0], b.p[1]);
  for (let i = 2; i < b.p.length; i += 2) buildings.lineTo(b.p[i], b.p[i + 1]);
  buildings.closePath();
}

function paintMask() {
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(D.size * MASK_PX_PER_M);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(MASK_PX_PER_M, 0, 0, MASK_PX_PER_M, HALF * MASK_PX_PER_M, HALF * MASK_PX_PER_M);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#f00';
  for (const r of D.r) {
    ctx.lineWidth = ROAD_W[r.c] + 2;
    ctx.beginPath();
    trace(ctx, r.p, false);
    ctx.stroke();
  }
  ctx.fillStyle = '#0f0';
  ctx.beginPath();
  for (const b of D.b) trace(ctx, b.p, true);
  ctx.fill();
  return { size: c.width, data: ctx.getImageData(0, 0, c.width, c.width).data };
}

const mask = paintMask();

function maskAt(x: number, z: number, channel: 0 | 1) {
  if (x < -HALF || x > HALF || z < -HALF || z > HALF) return false;
  const i = Math.min(mask.size - 1, Math.floor((x + HALF) * MASK_PX_PER_M));
  const j = Math.min(mask.size - 1, Math.floor((z + HALF) * MASK_PX_PER_M));
  return mask.data[(j * mask.size + i) * 4 + channel] > 128;
}
const onRoad = (x: number, z: number) => maskAt(x, z, 0);
const inBuilding = (x: number, z: number) => maskAt(x, z, 1);

// the street sign asks the game's road lookup, as the game's own sign does
const roads = new RoadNetwork(D as unknown as WorldData, { heightAt: () => 0 }); // the page is flat: no heights needed
function nearestStreet(x: number, z: number) {
  const near = roads.nearestRoad(x, z);
  return near.ri >= 0 && near.d < 20 ? (roads.lines[near.ri].n ?? '') : '';
}

// ---------- getaway state ----------

interface Mover {
  x: number;
  z: number;
  heading: number;
  speed: number;
} // heading: radians, 0 = east, z points south
const player: Mover = { x: TORGET.x, z: TORGET.z, heading: -0.6, speed: 0 };
const police: Mover[] = [];
const keys = new Set<string>();
let pointer: { x: number; y: number } | null = null; // CSS px inside the canvas while held
let running = false,
  visible = true,
  stars = 0,
  starTimer = 0,
  evadeTimer = 0,
  elapsed = 0,
  streetTimer = 0,
  lastFrame = 0;

const canvas = $<HTMLCanvasElement>('cv');
const ctx = canvas.getContext('2d')!;
let viewW = 0,
  viewH = 0,
  zoom = ZOOM_PX_PER_M;

function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1),
    r = canvas.getBoundingClientRect();
  viewW = r.width;
  viewH = r.height;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  zoom = viewW < 600 ? ZOOM_PX_PER_M * 0.75 : ZOOM_PX_PER_M;
  if (!running) draw();
}

// on a road at the spawn distance if one is there, else anywhere outside a house; false when not even that (then no car)
function spawnPolice() {
  for (let tries = 0; tries < 400; tries++) {
    const a = rnd() * Math.PI * 2;
    const d = SPAWN_DIST_M[0] + rnd() * (SPAWN_DIST_M[1] - SPAWN_DIST_M[0]);
    const x = player.x + Math.cos(a) * d,
      z = player.z + Math.sin(a) * d;
    if (Math.abs(x) < HALF - 20 && Math.abs(z) < HALF - 20 && (tries >= 200 || onRoad(x, z)) && !inBuilding(x, z)) {
      police.push({ x, z, heading: Math.atan2(player.z - z, player.x - x), speed: 10 });
      return true;
    }
  }
  return false;
}

function setStars(n: number) {
  stars = n;
  while (police.length < stars && spawnPolice());
  const el = $('cStars');
  el.innerHTML = '<b>' + '★'.repeat(stars) + '</b>' + '☆'.repeat(3 - stars);
}

function reset() {
  Object.assign(player, { x: TORGET.x, z: TORGET.z, heading: -0.6, speed: 0 });
  police.length = 0;
  starTimer = 0;
  evadeTimer = 0;
  elapsed = 0;
  streetTimer = 0;
  setStars(1);
}

function start() {
  reset();
  $('cStart').hidden = true;
  $('cEnd').hidden = true;
  running = true;
  lastFrame = performance.now();
  canvas.focus({ preventScroll: true });
  requestAnimationFrame(frame);
}

function end(caught: boolean) {
  running = false;
  pointer = null;
  keys.clear();
  const t = formatTime(elapsed),
    car = CARS[carType].name;
  const title = $('cEndTitle');
  title.textContent = caught ? 'Gripen!' : 'You lost them.';
  title.className = caught ? 'busted' : 'free';
  $('cEndText').textContent = caught
    ? carType === 'epa'
      ? `Caught after ${t} in an EPA-traktor. To be fair, that's 30 km/h.`
      : `Caught after ${t} in a ${car}. They'll drive you back to Torget.`
    : `${t} in a ${car}, and the police went back to their coffee. In the game, they'd still remember your face.`;
  $('cEnd').hidden = false;
  $('cAgain').focus({ preventScroll: true });
}

const formatTime = (s: number) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

// Turns toward an angle at a limited rate; returns the new heading.
function turnToward(heading: number, target: number, maxStep: number) {
  let d = target - heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return heading + clamp(d, -maxStep, maxStep);
}

// Moves a car, sliding along walls rather than driving through houses.
function move(m: Mover, dt: number) {
  const nx = m.x + Math.cos(m.heading) * m.speed * dt,
    nz = m.z + Math.sin(m.heading) * m.speed * dt;
  if (!inBuilding(nx, nz)) {
    m.x = nx;
    m.z = nz;
  } else if (!inBuilding(nx, m.z)) m.x = nx;
  else if (!inBuilding(m.x, nz)) m.z = nz;
  else m.speed *= -0.3;
  m.x = clamp(m.x, -HALF + 3, HALF - 3);
  m.z = clamp(m.z, -HALF + 3, HALF - 3);
}

function updatePlayer(dt: number) {
  const spec = CARS[carType];
  let throttle = 0,
    steer = 0;
  if (pointer) {
    // steer toward the held point on the map; ease off when nearly there
    const tx = player.x + (pointer.x - viewW / 2) / zoom,
      tz = player.z + (pointer.y - viewH / 2) / zoom;
    const dist = Math.hypot(tx - player.x, tz - player.z);
    let d = Math.atan2(tz - player.z, tx - player.x) - player.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    steer = clamp(d * 2, -1, 1);
    throttle = dist > 10 ? 1 : 0;
  } else {
    if (keys.has('ArrowUp') || keys.has('KeyW')) throttle = 1;
    if (keys.has('ArrowDown') || keys.has('KeyS') || keys.has('Space')) throttle = -1;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) steer -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) steer += 1;
  }
  const max = spec.maxSpeedMs * (onRoad(player.x, player.z) ? 1 : spec.offRoad);
  if (throttle > 0) player.speed = Math.min(max, player.speed + spec.accelMs2 * dt);
  else if (throttle < 0) player.speed = Math.max(-max * 0.3, player.speed - spec.accelMs2 * 1.8 * dt);
  else player.speed *= Math.max(0, 1 - 1.2 * dt);
  if (player.speed > max) player.speed = Math.max(max, player.speed - 20 * dt); // left the road: bog down
  const grip = Math.min(1, Math.abs(player.speed) / 5) / (1 + Math.abs(player.speed) / 30);
  player.heading += steer * 2.6 * grip * dt * Math.sign(player.speed || 1);
  move(player, dt);
}

const PROBES = [0, 0.5, -0.5, 1.1, -1.1, 1.8, -1.8];
function updatePolice(p: Mover, dt: number) {
  // aim a little ahead of the player, then take the first heading that isn't straight into a house
  const lead = Math.min(1.2, Math.hypot(player.x - p.x, player.z - p.z) / 40);
  const tx = player.x + Math.cos(player.heading) * player.speed * lead,
    tz = player.z + Math.sin(player.heading) * player.speed * lead;
  const want = Math.atan2(tz - p.z, tx - p.x);
  let aim = want;
  for (const off of PROBES) {
    const a = want + off;
    if (!inBuilding(p.x + Math.cos(a) * 9, p.z + Math.sin(a) * 9)) {
      aim = a;
      break;
    }
  }
  p.heading = turnToward(p.heading, aim, POLICE_TURN_RAD_S * dt);
  const max = POLICE_MAX_MS * (onRoad(p.x, p.z) ? 1 : POLICE_OFFROAD);
  p.speed = Math.min(max, p.speed + 9 * dt);
  if (p.speed > max) p.speed = Math.max(max, p.speed - 20 * dt);
  move(p, dt);
}

function frame(now: number) {
  if (!running) return;
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (visible) {
    elapsed += dt;
    updatePlayer(dt);
    let nearest = Infinity;
    for (const p of police) {
      updatePolice(p, dt);
      nearest = Math.min(nearest, Math.hypot(p.x - player.x, p.z - player.z));
    }
    if (nearest < CATCH_DIST_M) {
      draw();
      end(true);
      return;
    }
    if (nearest > EVADE_DIST_M) {
      evadeTimer += dt;
      if (evadeTimer > EVADE_TIME_S) {
        draw();
        end(false);
        return;
      }
    } else {
      evadeTimer = 0;
      starTimer += dt;
      if (starTimer > STAR_UP_S && stars < 3) {
        starTimer = 0;
        setStars(stars + 1);
      }
    }
    $('cStars').classList.toggle('evading', evadeTimer > 0);
    $('cKmh').textContent = String(Math.round(Math.abs(player.speed) * 3.6));
    $('cTime').textContent =
      evadeTimer > 0 ? 'Out of sight ' + Math.ceil(EVADE_TIME_S - evadeTimer) + ' s' : formatTime(elapsed);
    streetTimer -= dt;
    if (streetTimer < 0) {
      streetTimer = 0.3;
      setStreet(nearestStreet(player.x, player.z));
    }
    draw();
  }
  requestAnimationFrame(frame);
}

let shownStreet = '';
function setStreet(name: string) {
  if (name === shownStreet) return;
  shownStreet = name;
  $('cStreet').innerHTML = '';
  $('cStreet').append(name || 'Off-road', Object.assign(document.createElement('small'), { textContent: 'Vrigstad' }));
}

// ---------- getaway drawing ----------

function drawCar(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  scale: number,
  color: string,
  isPolice: boolean,
  t: number,
) {
  c.save();
  c.translate(x, y);
  c.rotate(heading);
  c.scale(scale, scale);
  const L = CAR_LEN_M,
    W = CAR_W_M;
  c.fillStyle = 'rgba(0,0,0,.3)';
  c.fillRect(-L / 2 + 0.3, -W / 2 + 0.3, L, W);
  c.fillStyle = isPolice ? '#f2f2ee' : color;
  c.fillRect(-L / 2, -W / 2, L, W);
  if (isPolice) {
    c.fillStyle = '#1f4fa3';
    c.fillRect(-L / 2, -W / 2, L, 0.28);
    c.fillRect(-L / 2, W / 2 - 0.28, L, 0.28);
  }
  c.fillStyle = '#1b2428';
  c.fillRect(-0.9, -W / 2 + 0.2, 2.2, W - 0.4); // glass
  c.fillStyle = isPolice ? '#f2f2ee' : color;
  c.fillRect(-0.55, -W / 2 + 0.3, 1.5, W - 0.6); // roof
  if (isPolice) {
    const blink = Math.floor(t * 6) % 2;
    c.fillStyle = blink ? '#3a7bff' : '#e5412d';
    c.fillRect(0, -W / 2 + 0.35, 0.4, W / 2 - 0.35);
    c.fillStyle = blink ? '#e5412d' : '#3a7bff';
    c.fillRect(0, 0, 0.4, W / 2 - 0.35);
  }
  c.fillStyle = '#f6ecb0';
  c.fillRect(L / 2 - 0.15, -W / 2 + 0.15, 0.15, 0.4);
  c.fillRect(L / 2 - 0.15, W / 2 - 0.55, 0.15, 0.4);
  c.restore();
}

function draw() {
  const t = performance.now() / 1000;
  ctx.fillStyle = '#9db87a';
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.save();
  ctx.translate(viewW / 2, viewH / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-player.x, -player.z);
  paintMap(ctx);
  ctx.restore();
  const toScreen = (m: Mover) => [viewW / 2 + (m.x - player.x) * zoom, viewH / 2 + (m.z - player.z) * zoom];
  if (pointer) {
    ctx.strokeStyle = 'rgba(242,194,48,.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const p of police) {
    const [x, y] = toScreen(p);
    if (x > -20 && x < viewW + 20 && y > -20 && y < viewH + 20) drawCar(ctx, x, y, p.heading, zoom, '', true, t);
    else {
      // off-screen: an arrow on the edge pointing at it
      const a = Math.atan2(y - viewH / 2, x - viewW / 2);
      const ex = clamp(x, 18, viewW - 18),
        ey = clamp(y, 18, viewH - 18);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(a);
      ctx.fillStyle = Math.floor(t * 6) % 2 ? '#3a7bff' : '#e5412d';
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-8, -8);
      ctx.lineTo(-8, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  drawCar(ctx, viewW / 2, viewH / 2, player.heading, zoom, CARS[carType].color, false, t);
}

// ---------- getaway input ----------

const DRIVE_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
]);
canvas.addEventListener('keydown', e => {
  if (!running || !DRIVE_KEYS.has(e.code)) return;
  e.preventDefault();
  keys.add(e.code);
  pointer = null;
});
canvas.addEventListener('keyup', e => keys.delete(e.code));
canvas.addEventListener('blur', () => keys.clear());
const pointerAt = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
};
canvas.addEventListener('pointerdown', e => {
  if (!running) return;
  canvas.setPointerCapture(e.pointerId);
  pointerAt(e);
});
canvas.addEventListener('pointermove', e => {
  if (pointer) pointerAt(e);
});
for (const ev of ['pointerup', 'pointercancel'] as const)
  canvas.addEventListener(ev, () => {
    pointer = null;
  });
$('cGo').addEventListener('click', start);
$('cAgain').addEventListener('click', start);
new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  if (visible) lastFrame = performance.now();
}).observe(canvas);
addEventListener('resize', resize);

// ---------- garage ----------

const garage = $('cars');
for (const type of Object.keys(CARS) as CarType[]) {
  const spec = CARS[type],
    kmh = Math.round(spec.maxSpeedMs * 3.6);
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'car';
  card.dataset.type = type;
  card.setAttribute('aria-pressed', String(type === carType));
  card.innerHTML = `<canvas width="460" height="184" aria-hidden="true"></canvas><h3></h3>
    <div class="spd">${kmh} <small>km/h top speed</small></div>
    <div class="meter"><i style="width:${Math.round((spec.maxSpeedMs / FASTEST_MS) * 100)}%"></i></div>
    <p></p><span class="pick"></span>`;
  card.querySelector('h3')!.textContent = spec.name;
  card.querySelector('p')!.textContent = spec.blurb;
  const preview = card.querySelector('canvas')!,
    pc = preview.getContext('2d')!;
  drawCar(pc, 230, 92, -0.25, 64, spec.color, false, 0);
  card.addEventListener('click', () => pickCar(type));
  garage.append(card);
}

function pickCar(type: CarType) {
  carType = type;
  for (const card of garage.querySelectorAll<HTMLButtonElement>('.car')) {
    const on = card.dataset.type === type;
    card.setAttribute('aria-pressed', String(on));
    card.querySelector('.pick')!.textContent = on ? 'In the getaway ✓' : 'Take this one';
  }
  $('gName').textContent = (type === 'epa' ? 'an ' : 'a ') + CARS[type].name;
  if (running)
    reset(); // the loop already runs: start() would add a second one
  else draw();
}

// ---------- trisslott (the game's vinstplan and kiosk lines; the temper worsens with each loss in a row) ----------

const ticketCanvas = $<HTMLCanvasElement>('tCv');
const tctx = ticketCanvas.getContext('2d', { willReadFrequently: true })!;
let tickets = 0,
  wins = 0,
  lossStreak = 0,
  revealed = false,
  scratching = false,
  ticketW = 1, // the ticket's width in CSS px when its cover was drawn: the scratch layer's own units
  lastLine = '';
let lastScratch: { x: number; y: number } | null = null;

function newTicket() {
  revealed = false;
  const prize = trissPrize(rnd()),
    won = prize > 0;
  const head = $('tHead'),
    line = $('tLine');
  $('tSay').textContent = '';
  $('tUnder').setAttribute('aria-hidden', 'true'); // under the cover: not read out before it's scratched
  if (won) {
    head.textContent = 'Vinst! ' + prize + ' kr';
    head.className = 'win';
    line.textContent = 'Dä va som sjutton, ja visste väl dä!';
  } else {
    const lines = TEMPER_LINES[temper(lossStreak)];
    let pick = lines[Math.floor(rnd() * lines.length)];
    while (pick === lastLine) pick = lines[Math.floor(rnd() * lines.length)];
    lastLine = pick;
    head.textContent = 'Ingen vinst';
    head.className = '';
    line.textContent = pick;
  }
  ticketCanvas.dataset.won = String(won);
  const r = ticketCanvas.getBoundingClientRect(),
    dpr = Math.min(2, devicePixelRatio || 1);
  ticketCanvas.width = Math.round(r.width * dpr);
  ticketCanvas.height = Math.round(r.height * dpr);
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ticketW = r.width;
  tctx.globalCompositeOperation = 'source-over';
  const g = tctx.createLinearGradient(0, 0, r.width, r.height);
  g.addColorStop(0, '#b9bcbf');
  g.addColorStop(0.5, '#e3e5e6');
  g.addColorStop(1, '#9fa3a6');
  tctx.fillStyle = g;
  tctx.fillRect(0, 0, r.width, r.height);
  tctx.fillStyle = 'rgba(40,44,46,.55)';
  tctx.textAlign = 'center';
  tctx.textBaseline = 'middle';
  tctx.font = `700 ${Math.round(r.width / 9)}px "Barlow Condensed", Arial Narrow, sans-serif`;
  tctx.fillText('SKRAPA HÄR', r.width / 2, r.height / 2 - r.width / 28);
  tctx.font = `500 ${Math.round(r.width / 28)}px Barlow, Arial, sans-serif`;
  tctx.fillText('Trisslott · 30 kr · Kiosken på Torget', r.width / 2, r.height / 2 + r.width / 14);
  $('tNew').hidden = true;
}

// Scratches a line from the last point, so a fast swipe leaves no gaps between pointer events.
function scratchAt(e: PointerEvent) {
  // in the cover's units: after a resize or a rotation the canvas is stretched by CSS, so scale the pointer to match
  const r = ticketCanvas.getBoundingClientRect(),
    k = ticketW / (r.width || 1),
    x = (e.clientX - r.left) * k,
    y = (e.clientY - r.top) * k;
  const from = lastScratch ?? { x, y };
  tctx.globalCompositeOperation = 'destination-out';
  tctx.lineCap = 'round';
  tctx.lineWidth = Math.max(36, ticketW / 9);
  tctx.beginPath();
  tctx.moveTo(from.x, from.y);
  tctx.lineTo(x + 0.01, y);
  tctx.stroke();
  lastScratch = { x, y };
}

function scratchedShare() {
  const { data } = tctx.getImageData(0, 0, ticketCanvas.width, ticketCanvas.height);
  let clear = 0,
    n = 0;
  for (let i = 3; i < data.length; i += 4 * 37) {
    n++;
    if (data[i] < 40) clear++;
  }
  return clear / n;
}

function reveal() {
  revealed = true;
  tickets++;
  if (ticketCanvas.dataset.won === 'true') {
    wins++;
    lossStreak = 0;
  } else lossStreak++;
  tctx.clearRect(0, 0, ticketCanvas.width, ticketCanvas.height);
  $('tUnder').removeAttribute('aria-hidden');
  $('tSay').textContent = $('tHead').textContent + '. ' + $('tLine').textContent;
  $('tN').textContent = String(tickets);
  $('tW').textContent = String(wins);
  $('tNew').hidden = false;
}

ticketCanvas.addEventListener('pointerdown', e => {
  if (revealed) return;
  scratching = true;
  ticketCanvas.setPointerCapture(e.pointerId);
  scratchAt(e);
});
ticketCanvas.addEventListener('pointermove', e => {
  if (scratching) scratchAt(e);
});
for (const ev of ['pointerup', 'pointercancel'] as const)
  ticketCanvas.addEventListener(ev, () => {
    if (!scratching) return;
    scratching = false;
    lastScratch = null;
    if (scratchedShare() > 0.5) reveal();
  });
// Enter or Space on the focused card scratches it all at once, for the keyboard and screen readers
ticketCanvas.addEventListener('keydown', e => {
  if (revealed || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  reveal();
});
$('tNew').addEventListener('click', newTicket);

// ---------- hero ----------

let heroStars = 0;
const wanted = $<HTMLButtonElement>('wanted');
wanted.addEventListener('click', () => {
  heroStars = (heroStars + 1) % 4;
  wanted.querySelectorAll('b').forEach((b, i) => {
    b.classList.toggle('on', i < heroStars);
  });
  wanted.setAttribute('aria-label', `Wanted level, ${heroStars} of 3 stars. Click to change it.`);
  document.body.classList.toggle('sirens', heroStars === 3);
  wanted.nextElementSibling!.textContent = [
    'Go on. Raise your wanted level.',
    'Somebody saw that.',
    'They are calling it in.',
    'Well, now you have done it. Click once more to calm down.',
  ][heroStars];
});

// ---------- live numbers from the map data ----------

$('nB').textContent = $('sB').textContent = String(D.b.length);
$('sS').textContent = String(new Set(D.r.map(r => r.n).filter(Boolean)).size);

// ---------- go ----------

pickCar('volvo');
resize();
setStars(0);
document.fonts.ready.then(newTicket);
