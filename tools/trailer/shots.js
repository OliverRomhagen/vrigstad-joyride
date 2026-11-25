// Shot list for the teaser. Each setup runs inside a freshly loaded game page and defines window.__frame(i, n),
// which is called before every rendered frame. Frame counts are multiples of 15 so cuts land on the beat (120 BPM at 30 fps).
const card = html => new Function(`const X = __X; X.mode('cine'); X.fade(1); window.__frame = (i, n) => X.card(${JSON.stringify(html)}, X.io(i, 1, n - 1, 3));`);
const HERO = "'volvo', '#7a2530'";   // the dark red Volvo 240 used in every shot

module.exports = [
  { name: '01_open', n: 75, setup: () => { const X = __X; X.mode('cine'); X.fade(1);
    window.__frame = (i, n) => X.card('<p>Småland, Sweden</p><h3>57.3555° N · 14.4756° E</h3>', X.io(i, 8, n - 6, 12)); } },

  { name: '02_aerial', n: 165, setup: () => { const X = __X; X.start(); X.mode('cine'); X.wideShadows(); X.sunAt = { x: -40, z: 0 }; X.fov(46);
    X.setCam(cam => { const t = X.ss(X.k * 0.9 + 0.05); cam.position.set(X.lerp(-560, -300, t), X.lerp(190, 105, t), X.lerp(600, 350, t)); cam.lookAt(X.lerp(-60, -20, t), 6, X.lerp(40, -10, t)); });
    __step(60);
    window.__frame = (i, n) => { X.k = i / (n - 1); X.fade(1 - X.ss(i / 24));
      X.caps(i, [[22, 82, '<small>Vrigstad</small>Population 1,400'], [94, 158, 'Nothing ever happens here']]); }; } },

  { name: '03_torget', n: 105, setup: () => { const G = __G, X = __X; X.start(); X.mode('cine'); X.fov(48);
    let car = null, bd = 1e9; for (const c of G.cars) { const d = Math.hypot(c.x - G.player.x, c.z - G.player.z); if (c.mode === 'parked' && d < bd) { bd = d; car = c; } }
    for (const o of G.cars.slice()) if (o !== car && Math.hypot(o.x - car.x, o.z - car.z) < 5) G.removeCar(o);   // two Volvos overlap at the spawn point
    car = X.recolor(car, 'volvo', '#7a2530'); G.placeCar(car);
    const mx = (car.x + G.player.x) / 2, mz = (car.z + G.player.z) / 2, a0 = Math.atan2(G.player.x - car.x, G.player.z - car.z) + 1.9;
    X.setCam(cam => { const a = a0 + 0.42 * X.k, r = 15 - 3.5 * X.k, x = mx + Math.sin(a) * r, z = mz + Math.cos(a) * r; cam.position.set(x, G.hAt(x, z) + 2.1, z); cam.lookAt(mx, G.hAt(mx, mz) + 1.3, mz); });
    __step(10);
    window.__frame = (i, n) => { X.k = i / (n - 1); G.view.camYaw = Math.atan2(car.x - G.player.x, -(car.z - G.player.z)); G.joy.y = i > 24 ? 0.55 : 0;
      X.caps(i, [[12, 98, 'Until someone borrows a Volvo 240']]); }; } },

  // real gameplay: take an occupied car on a main road; the driver's line and the wanted star are the game's own
  { name: '04_steal', n: 120, setup: () => { const G = __G, X = __X; X.start(); __step(40);
    let c = null, bd = 1e9; for (const o of G.cars) { const d = Math.hypot(o.x + 20, o.z - 10); if (o.mode === 'ai' && G.R[o.ri].c <= 1 && d < bd) { bd = d; c = o; } }
    c = X.recolor(c, 'volvo', '#7a2530'); c.v = 0; let held = true; X.pre.push(() => { if (held) c.v = 0; });
    __step(2); G.player.x = c.x - Math.cos(c.h) * 2.3; G.player.z = c.z - Math.sin(c.h) * 2.3; G.player.h = c.h + Math.PI / 2;
    G.view.camYaw = Math.atan2(Math.cos(c.h), -Math.sin(c.h)) - 0.55; G.view.camPitch = 0.3; __step(12);
    window.__frame = (i, n) => { if (i === 22) { held = false; G.action(); }
      if (i === 34) X.autopilot(X.route(G.game.pcar.x, G.game.pcar.z, G.game.pcar.h, 900, 1)); }; } },

  { name: '05_chase_front', n: 60, setup: new Function(`const X = __X; X.chase(${HERO}, 230, [9, 15, 22], 33); X.mode('cine'); X.fov(60); X.setCam(X.rigFront(6.5, 1.9, 0.8, 8, 0.9));
    window.__frame = (i, n) => { X.k = i / (n - 1); };`) },

  { name: '06_card', n: 30, setup: card('<h2>881 buildings</h2>') },

  // the game's own camera and HUD, with the view dragged round to look back at the police
  { name: '07_chase_hud', n: 75, setup: new Function(`const X = __X; X.chase(${HERO}, 330, [9, 15, 22], 33);
    window.__frame = (i, n) => { X.k = i / (n - 1); __G.view.lookOff = 2.62 - 0.25 * X.k; __G.view.lookIdle = 0; };`) },

  { name: '08_card', n: 30, setup: card('<h2>Every real street</h2>') },

  { name: '09_chase_drone', n: 75, setup: new Function(`const X = __X; X.chase(${HERO}, 420, [9, 15, 22], 33); X.mode('cine'); X.fov(50); X.setCam(X.rigDrone(20, 13, 8, 10));
    window.__frame = (i, n) => { X.k = i / (n - 1); };`) },

  { name: '10_card', n: 30, setup: card('<h2>Zero permission</h2>') },

  { name: '11_chase_side', n: 60, setup: new Function(`const X = __X; X.chase(${HERO}, 520, [8, 14, 20], 33); X.mode('cine'); X.fov(62); X.setCam(X.rigSide(5.5, 3.5, 0.75));
    window.__frame = (i, n) => { X.k = i / (n - 1); };`) },

  { name: '12_epa', n: 120, setup: () => { const X = __X; X.chase('epa', '#c8372d', 620, [10, 16, 22]); X.fov(56); X.setCam(X.rigFront(7.5, 2.4, 1.15, 6, 1.0));
    window.__frame = (i, n) => { X.k = i / (n - 1); X.caps(i, [[14, 108, '<small>Getaway car: EPA-traktor</small>Top speed 30 km/h']]); }; } },

  // eight losing tickets off camera, so the ninth gets the worst of the kiosk's lines
  { name: '13_triss', n: 135, setup: () => { const G = __G, X = __X; X.start(); const k = G.places.list.find(p => p.kind === 'kiosk');
    G.player.x = k.x + 0.2; G.player.z = k.z + 0.5; G.player.h = 0; G.view.camYaw = 0.5; G.view.camPitch = 0.27; X.capLeft(); __step(4);
    for (let j = 0; j < 8; j++) { X.buyTriss(); __step(30); } __step(110); X.hideToast();
    window.__frame = (i, n) => { if (i === 10) X.buyTriss(); X.caps(i, [[52, 128, '<small>Odds of winning on a trisslott</small>0.1 %']]); }; } },

  // the one-minute wait is cut down to a few seconds for the trailer
  { name: '14_safe', n: 150, setup: () => { const G = __G, X = __X; X.start(); const p = G.places.list.find(o => o.kind === 'safe' && o.name === 'Gästgivaregatan');
    // the marker sits 1.4 m outside the door: the nearest wall point gives the outward direction, then start further out
    let qx = 0, qz = 0, bd = 1e9; for (const b of G.D.b) for (let i = 0, j = b.p.length - 2; i < b.p.length; j = i, i += 2) { const dx = b.p[i] - b.p[j], dz = b.p[i + 1] - b.p[j + 1], L = dx * dx + dz * dz;
      const t = L ? Math.min(1, Math.max(0, ((p.x - b.p[j]) * dx + (p.z - b.p[j + 1]) * dz) / L)) : 0, cx = b.p[j] + dx * t, cz = b.p[j + 1] + dz * t, d = Math.hypot(p.x - cx, p.z - cz); if (d < bd) { bd = d; qx = cx; qz = cz; } }
    const nx = (p.x - qx) / bd, nz = (p.z - qz) / bd; G.player.x = p.x + nx * 6 + nz * 1.5; G.player.z = p.z + nz * 6 - nx * 1.5; G.view.camPitch = 0.3;
    G.wanted.addStar(); G.wanted.addStar(); __step(2); X.hideToast();
    G.wanted.police.forEach((c, i) => { c.x = p.x + 430 + i * 20; c.z = p.z + 300; c.v = 0; });
    let arrived = -1, inAt = -1;
    window.__frame = (i, n) => { const d = Math.hypot(p.x - G.player.x, p.z - G.player.z);
      if (inAt < 0) { if (d > 1.2) { G.view.camYaw = Math.atan2(p.x - G.player.x, -(p.z - G.player.z)); G.joy.y = 1; } else { G.joy.y = 0; if (arrived < 0) arrived = i; if (i - arrived >= 14) { G.action(); G.wanted.hideLeft = 2.4; inAt = i; } } }
      X.caps(i, inAt >= 0 ? [[inAt + 8, inAt + 62, 'Lie low']] : []); }; } },

  // stop the car and let the police box it in; the bust is the game's own
  { name: '15_gripen', n: 105, setup: new Function(`const G = __G, X = __X; X.chase(${HERO}, 180, [16, 24, 32]); X.autopilot(null); G.keys.brake = true;
    for (let j = 0; j < 400; j++) { __step(1); const c = G.game.pcar; if (Math.abs(c.v) < 0.5 && G.wanted.police.some(p => Math.hypot(p.x - c.x, p.z - c.z) < 8.5)) break; }
    G.keys.brake = false; X.hideToast();
    window.__frame = (i, n) => {};`) },

  { name: '16_title', n: 180, setup: () => { const X = __X; X.mode('cine'); X.fov(50); X.fade(0.74); __step(200);
    window.__frame = (i, n) => { X.fade(i < 12 ? X.lerp(1, 0.74, i / 12) : i > n - 24 ? X.lerp(0.74, 1, (i - (n - 24)) / 20) : 0.74);
      X.card('<h1>Vrigstad <span>Joyride</span></h1><div class="rule"></div><p>Play it free in your browser</p><div class="url">oliverromhagen.github.io/vrigstad-joyride</div>', X.io(i, 10, n - 4, 10)); }; } }
];
