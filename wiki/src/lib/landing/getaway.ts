// The marketing page's getaway: a small top-down chase on the real map. It reads the same processed map data as the game,
// and borrows the game's Volvo numbers, evade rule and street lookup, but none of its driving: this is a toy, not the
// simulation. Browser only: it paints into a canvas and reads the keyboard and the pointer.
import { EVADE_DIST_M, EVADE_S } from '#game/police';
import { VEHICLE_SPECS } from '#game/sim/vehicle-spec';
import { ROAD_WIDTH_M as ROAD_W, type WorldData } from '#world/data';
import { clamp } from '#world/math';
import { segmentDistance } from '#world/polygon';
import { makeRnd } from '#world/random';
import { RoadNetwork } from '#world/roads';

/** What the page shows around the canvas. The getaway writes it; the page only reads it. */
export interface GetawayHud {
  phase: 'ready' | 'running' | 'caught' | 'free';
  stars: number;
  evading: boolean;
  kmh: number;
  /** the clock, or the seconds left out of sight while the police are losing you */
  time: string;
  street: string;
  /** the time the last getaway lasted, once it is over */
  lasted: string;
}

// ---------- tuning ----------

const VOLVO = VEHICLE_SPECS.volvo; // top speed, acceleration and off-road share: the game's own
export const CAR_NAME = VOLVO.name;
const VOLVO_COLOR = '#a8232d';
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
const STREET_REACH_M = 20; // the street sign names the nearest named road this close
const TORGET = { x: 0, z: 0 };

const ROAD_FILL = ['#55585a', '#5d6062', '#66696a', '#77776f', '#a08c6c', '#b8ab90'];
const LAND = ['#a6c083', '#d9cf8b', '#b9b4a8', '#8fc072', '#93b77d', '#6f9a5e', '#7cc163'];
const GRASS = '#9db87a';

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
const PROBES = [0, 0.5, -0.5, 1.1, -1.1, 1.8, -1.8];

interface Mover {
  x: number;
  z: number;
  heading: number; // radians, 0 = east, z points south
  speed: number;
}

const formatTime = (s: number) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

function trace(ctx: CanvasPath, p: number[], close: boolean) {
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  if (close) ctx.closePath();
}

// each layer traced once into a Path2D, so a frame only fills and strokes them: tracing the whole 2.2 km map every frame
// was slow on phones
function path(lines: readonly number[][], close: boolean) {
  const p = new Path2D();
  for (const l of lines) trace(p, l, close);
  return p;
}

// Turns toward an angle at a limited rate; returns the new heading.
function turnToward(heading: number, target: number, maxStep: number) {
  let d = target - heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return heading + clamp(d, -maxStep, maxStep);
}

function drawCar(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  scale: number,
  isPolice: boolean,
  t: number,
) {
  c.save();
  c.translate(x, y);
  c.rotate(heading);
  c.scale(scale, scale);
  const L = CAR_LEN_M,
    W = CAR_W_M;
  const body = isPolice ? '#f2f2ee' : VOLVO_COLOR;
  c.fillStyle = 'rgba(0,0,0,.3)';
  c.fillRect(-L / 2 + 0.3, -W / 2 + 0.3, L, W);
  c.fillStyle = body;
  c.fillRect(-L / 2, -W / 2, L, W);
  if (isPolice) {
    c.fillStyle = '#1f4fa3';
    c.fillRect(-L / 2, -W / 2, L, 0.28);
    c.fillRect(-L / 2, W / 2 - 0.28, L, 0.28);
  }
  c.fillStyle = '#1b2428';
  c.fillRect(-0.9, -W / 2 + 0.2, 2.2, W - 0.4); // glass
  c.fillStyle = body;
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

/** Sets up the getaway on `canvas`, drawn and waiting for start(). destroy() stops it and removes its listeners. */
export function createGetaway(canvas: HTMLCanvasElement, D: WorldData, hud: GetawayHud) {
  const HALF = D.size / 2;
  // its own stream, seeded fresh each visit, so the police spawn differently every time
  const rnd = makeRnd(crypto.getRandomValues(new Uint32Array(1))[0]);
  const ctx = canvas.getContext('2d')!;
  const listen = new AbortController();
  const { signal } = listen;

  // ---------- map: vectors drawn every frame (crisp at any zoom), plus a lookup mask (red = road, green = building) ----------

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
    buildings: path(
      D.b.map(b => b.p),
      true,
    ),
  };

  // Paints the map in world metres; the caller sets the transform.
  function paintMap(c: CanvasRenderingContext2D) {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.fillStyle = GRASS;
    c.fillRect(-HALF, -HALF, D.size, D.size);
    for (let k = 0; k < LAND.length; k++) {
      c.fillStyle = LAND[k];
      c.fill(layers.land[k]);
    }
    c.strokeStyle = c.fillStyle = '#4f8fb8';
    c.lineWidth = 6;
    c.stroke(layers.rivers);
    c.lineWidth = 2;
    c.stroke(layers.streams);
    c.fill(layers.lakes, 'evenodd');
    for (const verge of [true, false])
      for (let cls = 5; cls >= 0; cls--) {
        if (verge && cls > 3) continue;
        c.strokeStyle = verge ? '#b3a78c' : ROAD_FILL[cls];
        c.lineWidth = ROAD_W[cls] + (verge ? 2.4 : 0);
        c.stroke(layers.roads[cls]);
      }
    c.fillStyle = 'rgba(0,0,0,.22)';
    c.translate(0.8, 0.8);
    c.fill(layers.buildings);
    c.translate(-0.8, -0.8); // cheap drop shadow
    c.fillStyle = '#8a8378';
    c.fill(layers.buildings);
  }

  const mask = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = Math.round(D.size * MASK_PX_PER_M);
    const m = c.getContext('2d', { willReadFrequently: true })!;
    m.setTransform(MASK_PX_PER_M, 0, 0, MASK_PX_PER_M, HALF * MASK_PX_PER_M, HALF * MASK_PX_PER_M);
    m.lineCap = 'round';
    m.strokeStyle = '#f00';
    for (const r of D.r) {
      m.lineWidth = ROAD_W[r.c] + 2;
      m.beginPath();
      trace(m, r.p, false);
      m.stroke();
    }
    m.fillStyle = '#0f0';
    m.fill(layers.buildings);
    return { size: c.width, data: m.getImageData(0, 0, c.width, c.width).data };
  })();

  function maskAt(x: number, z: number, channel: 0 | 1) {
    if (x < -HALF || x > HALF || z < -HALF || z > HALF) return false;
    const i = Math.min(mask.size - 1, Math.floor((x + HALF) * MASK_PX_PER_M));
    const j = Math.min(mask.size - 1, Math.floor((z + HALF) * MASK_PX_PER_M));
    return mask.data[(j * mask.size + i) * 4 + channel] > 128;
  }
  const onRoad = (x: number, z: number) => maskAt(x, z, 0);
  const inBuilding = (x: number, z: number) => maskAt(x, z, 1);

  // the street sign: the nearest *named* road within reach, so an unnamed footpath or service road doesn't blank it
  const roads = new RoadNetwork(D, { heightAt: () => 0 }); // the page is flat: no heights needed
  function nearestStreet(x: number, z: number) {
    let name = '',
      best = STREET_REACH_M;
    roads.forEachSegmentNear(x, z, STREET_REACH_M, (ax, az, bx, bz, ri) => {
      const road = roads.lines[ri];
      if (!road.n) return;
      const d = segmentDistance(x, z, ax, az, bx, bz) - ROAD_W[road.c] / 2;
      if (d < best) {
        best = d;
        name = road.n;
      }
    });
    return name;
  }

  // ---------- state ----------

  const player: Mover = { x: TORGET.x, z: TORGET.z, heading: -0.6, speed: 0 };
  const police: Mover[] = [];
  const keys = new Set<string>();
  let pointer: { x: number; y: number } | null = null; // CSS px inside the canvas while held
  let running = false,
    visible = true,
    starTimer = 0,
    evadeTimer = 0,
    elapsed = 0,
    streetTimer = 0,
    lastFrame = 0,
    viewW = 0,
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
    hud.stars = n;
    while (police.length < n && spawnPolice());
  }

  function start() {
    Object.assign(player, { x: TORGET.x, z: TORGET.z, heading: -0.6, speed: 0 });
    police.length = 0;
    starTimer = evadeTimer = elapsed = streetTimer = 0;
    setStars(1);
    hud.phase = 'running';
    hud.evading = false;
    hud.time = formatTime(0);
    // the loop already runs while a getaway does: a second one would double its speed
    if (running) return;
    running = true;
    lastFrame = performance.now();
    canvas.focus({ preventScroll: true });
    requestAnimationFrame(frame);
  }

  function end(caught: boolean) {
    running = false;
    pointer = null;
    keys.clear();
    hud.lasted = formatTime(elapsed);
    hud.phase = caught ? 'caught' : 'free';
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
    const max = VOLVO.max * (onRoad(player.x, player.z) ? 1 : VOLVO.off);
    if (throttle > 0) player.speed = Math.min(max, player.speed + VOLVO.acc * dt);
    else if (throttle < 0) player.speed = Math.max(-max * 0.3, player.speed - VOLVO.acc * 1.8 * dt);
    else player.speed *= Math.max(0, 1 - 1.2 * dt);
    if (player.speed > max) player.speed = Math.max(max, player.speed - 20 * dt); // left the road: bog down
    const grip = Math.min(1, Math.abs(player.speed) / 5) / (1 + Math.abs(player.speed) / 30);
    player.heading += steer * 2.6 * grip * dt * Math.sign(player.speed || 1);
    move(player, dt);
  }

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
        if (evadeTimer > EVADE_S) {
          draw();
          end(false);
          return;
        }
      } else {
        evadeTimer = 0;
        starTimer += dt;
        if (starTimer > STAR_UP_S && hud.stars < 3) {
          starTimer = 0;
          setStars(hud.stars + 1);
        }
      }
      hud.evading = evadeTimer > 0;
      hud.kmh = Math.round(Math.abs(player.speed) * 3.6);
      hud.time = evadeTimer > 0 ? `Out of sight ${Math.ceil(EVADE_S - evadeTimer)} s` : formatTime(elapsed);
      streetTimer -= dt;
      if (streetTimer < 0) {
        streetTimer = 0.3;
        hud.street = nearestStreet(player.x, player.z) || 'Off-road';
      }
      draw();
    }
    requestAnimationFrame(frame);
  }

  function draw() {
    const t = performance.now() / 1000;
    ctx.fillStyle = GRASS;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.save();
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-player.x, -player.z);
    paintMap(ctx);
    ctx.restore();
    if (pointer) {
      ctx.strokeStyle = 'rgba(242,194,48,.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of police) {
      const x = viewW / 2 + (p.x - player.x) * zoom,
        y = viewH / 2 + (p.z - player.z) * zoom;
      if (x > -20 && x < viewW + 20 && y > -20 && y < viewH + 20) drawCar(ctx, x, y, p.heading, zoom, true, t);
      else {
        // off-screen: an arrow on the edge pointing at it
        const a = Math.atan2(y - viewH / 2, x - viewW / 2);
        ctx.save();
        ctx.translate(clamp(x, 18, viewW - 18), clamp(y, 18, viewH - 18));
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
    drawCar(ctx, viewW / 2, viewH / 2, player.heading, zoom, false, t);
  }

  // ---------- input ----------

  canvas.addEventListener(
    'keydown',
    e => {
      if (!running || !DRIVE_KEYS.has(e.code)) return;
      e.preventDefault();
      keys.add(e.code);
      pointer = null;
    },
    { signal },
  );
  canvas.addEventListener('keyup', e => keys.delete(e.code), { signal });
  canvas.addEventListener('blur', () => keys.clear(), { signal });
  const pointerAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener(
    'pointerdown',
    e => {
      if (!running) return;
      canvas.setPointerCapture(e.pointerId);
      pointerAt(e);
    },
    { signal },
  );
  canvas.addEventListener('pointermove', e => pointer && pointerAt(e), { signal });
  for (const ev of ['pointerup', 'pointercancel'] as const)
    canvas.addEventListener(
      ev,
      () => {
        pointer = null;
      },
      { signal },
    );
  addEventListener('resize', resize, { signal });
  // off screen it pauses, so a getaway left running below the fold doesn't end without you
  const seen = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) lastFrame = performance.now();
  });
  seen.observe(canvas);

  resize();

  return {
    start,
    destroy() {
      running = false;
      listen.abort();
      seen.disconnect();
    },
  };
}
