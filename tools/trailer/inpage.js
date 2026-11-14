// Runs inside the game page: helpers for scripted shots (overlays, autopilot, staging, camera rigs).
(() => {
  const G = window.__G;
  const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const X = window.__X = {};

  // ----- overlay layer: letterbox bars, fades, captions, title cards -----
  const css = document.createElement('style');
  css.textContent = `
  #tx { position: absolute; inset: 0; pointer-events: none; z-index: 50; font-family: "Barlow Condensed", "Arial Narrow", sans-serif; color: #f4f1e6; }
  #tx .bar { position: absolute; left: 0; right: 0; height: 9.5%; background: #000; }
  #tx .bar.t { top: 0; } #tx .bar.b { bottom: 0; }
  #tx .fade { position: absolute; inset: 0; background: #0b0f0e; opacity: 0; }
  #tx .cap { position: absolute; left: 0; right: 0; bottom: 19%; text-align: center; font-weight: 700; font-size: 46px; letter-spacing: .06em; text-transform: uppercase;
    text-shadow: 0 2px 0 rgba(0,0,0,.55), 0 0 24px rgba(0,0,0,.6); opacity: 0; }
  #tx .cap small { display: block; font: 500 19px "Barlow", sans-serif; letter-spacing: .22em; color: #f2c230; margin-bottom: 6px; }
  #tx .card { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; opacity: 0; }
  #tx .card h1 { margin: 0; font-weight: 700; font-size: 150px; line-height: .86; letter-spacing: .01em; text-transform: uppercase; }
  #tx .card h1 span { color: #f2c230; display: block; }
  #tx .card h2 { margin: 0; font-weight: 700; font-size: 96px; letter-spacing: .05em; text-transform: uppercase; }
  #tx .card h3 { margin: 14px 0 0; font-weight: 600; font-size: 54px; letter-spacing: .08em; }
  #tx .card p { margin: 18px 0 0; font: 500 22px "Barlow", sans-serif; letter-spacing: .24em; text-transform: uppercase; color: #f2c230; }
  #tx .card .rule { width: 120px; height: 5px; background: #f2c230; margin: 26px auto 0; }
  #tx .card .url { margin-top: 22px; font: 500 20px "Barlow", sans-serif; letter-spacing: .06em; color: rgba(244,241,230,.75); }
  body.cine #ui, body.cine #prompt, body.cine #toast, body.cine #hide, body.cine #intro { display: none !important; }
  /* keep the game's HUD inside the letterbox */
  #ui { padding-block: calc(9.5vh + 12px) !important; }
  #prompt { bottom: calc(9.5vh + 14px) !important; }
  #toast { top: 25% !important; }
  #hide { top: 14% !important; }
  #big { z-index: 40; }
  #toast, #stars b { transition: none !important; animation: none !important; }
  `;
  document.head.appendChild(css);
  const tx = document.createElement('div'); tx.id = 'tx';
  tx.innerHTML = '<div class="fade"></div><div class="cap"></div><div class="card"></div><div class="bar t"></div><div class="bar b"></div>';
  document.getElementById('stage').appendChild(tx);
  const q = s => tx.querySelector(s);
  X.fade = v => { q('.fade').style.opacity = v; };
  X.cap = (html, op) => { const c = q('.cap'); if (html != null) c.innerHTML = html; c.style.opacity = op == null ? 1 : op; };
  X.capLeft = () => { const c = q('.cap'); c.style.left = '7%'; c.style.right = 'auto'; c.style.textAlign = 'left'; c.style.bottom = '24%'; };
  X.card = (html, op) => { const c = q('.card'); if (html != null) c.innerHTML = html; c.style.opacity = op == null ? 1 : op; };
  X.mode = m => { document.body.classList.toggle('cine', m === 'cine'); };
  X.bars = on => { for (const b of tx.querySelectorAll('.bar')) b.style.display = on ? '' : 'none'; };
  X.ss = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  X.lerp = (a, b, t) => a + (b - a) * t;
  X.io = (i, a, b, f = 6) => clamp(Math.min((i - a) / f, (b - i) / f), 0, 1);
  X.caps = (i, list) => { let on = false; for (const [a, b, html] of list) if (i >= a && i <= b) { X.cap(html, X.io(i, a, b, 5)); on = true; } if (!on) X.cap(null, 0); };

  X.start = () => { document.getElementById('go').click(); document.getElementById('toast').hidden = true; };
  X.hideToast = () => { document.getElementById('toast').hidden = true; };

  // ----- route along the street network, always taking the straightest continuation -----
  X.route = (x, z, heading, length, maxClass = 2) => {
    const R = G.R; let best = null, bd = 1e9;
    for (const ri of G.driveable) { if (R[ri].c > maxClass) continue; R[ri].p.forEach((p, vi) => { const d = Math.hypot(p[0] - x, p[1] - z); if (d < bd) { bd = d; best = { ri, vi }; } }); }
    let { ri, vi } = best; const pts = [R[ri].p[vi]]; let h = heading, total = 0; const seen = new Set();
    for (let guard = 0; guard < 4000 && total < length; guard++) {
      const here = R[ri].p[vi], l = G.nodes.get(G.nodeKey(here)) || []; let opt = null, od = 1e9;
      for (let i = 0; i < l.length; i += 2) { const r2 = l[i], v2 = l[i + 1], len = R[r2].p.length;
        if (R[r2].c > maxClass) continue;
        for (const dir of [1, -1]) { const nv = v2 + dir; if (nv < 0 || nv >= len) continue; const np = R[r2].p[nv];
          const key = r2 + ':' + Math.min(v2, nv); if (seen.has(key)) continue;
          const d = Math.abs(wrap(Math.atan2(np[0] - here[0], -(np[1] - here[1])) - h)) + R[r2].c * 0.25;
          if (d < od) { od = d; opt = { ri: r2, vi: nv, key, np }; } } }
      if (!opt || od > 2.4) break;
      seen.add(opt.key); h = Math.atan2(opt.np[0] - here[0], -(opt.np[1] - here[1])); total += Math.hypot(opt.np[0] - here[0], opt.np[1] - here[1]);
      ri = opt.ri; vi = opt.vi; pts.push(opt.np);
    }
    return pts;
  };
  // point at distance s along a polyline
  X.along = (pts, s) => { for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (s <= L || i === pts.length - 1) { const t = clamp(s / (L || 1), 0, 1); return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, h: Math.atan2(b[0] - a[0], -(b[1] - a[1])) }; } s -= L; } };

  // ----- autopilot: steers the player's car along a route through the game's normal input path -----
  let auto = null;
  X.autopilot = (pts, opts = {}) => { auto = pts ? Object.assign({ pts, s: 0, throttle: 1, look: 13 }, opts) : null; if (!pts) { G.joy.x = G.joy.y = 0; G.keys.brake = false; } };
  X.autoS = () => auto ? auto.s : 0;
  function nearestS(pts, x, z, from) { let acc = 0, best = from, bd = 1e9;
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      if (acc + L >= from - 5 && acc <= from + 60) { const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (L * L), 0, 1), d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); if (d < bd) { bd = d; best = acc + L * t; } }
      acc += L; }
    return best; }
  X.pre = [];
  window.__pre = dt => {
    if (auto && G.inCar) { const c = G.pcar; auto.s = nearestS(auto.pts, c.x, c.z, auto.s);
      const look = auto.look + Math.abs(c.v) * 0.35, t = X.along(auto.pts, auto.s + look), far = X.along(auto.pts, auto.s + look * 2.6);
      const diff = wrap(Math.atan2(t.x - c.x, -(t.z - c.z)) - c.h), bend = Math.abs(wrap(far.h - c.h));
      G.joy.x = clamp(diff * 2.4, -1, 1);
      const want = Math.min(auto.max || 1e9, c.T.max * clamp(1.05 - bend * 0.75, 0.42, 1));
      G.joy.y = c.v > want ? 0 : auto.throttle; G.keys.brake = c.v > want + 4; }
    for (const f of X.pre) f(dt);
  };

  // ----- staging -----
  // a car of a given type and paint colour (the game picks colours at random, so keep trying)
  X.makeCar = (type, hex, x, z, h) => { const want = new G.THREE.Color(hex).convertSRGBToLinear();   // vertex colours are linear (see mergeGeo)
    for (let t = 0; t < 80; t++) { const c = G.addCar(type, x, z, h, 'parked'), col = c.mesh.geometry.attributes.color.array, k = 144 * 3;
      if (Math.abs(col[k] - want.r) + Math.abs(col[k + 1] - want.g) + Math.abs(col[k + 2] - want.b) < 0.02) return c; G.removeCar(c); }
    return G.addCar(type, x, z, h, 'parked'); };
  X.recolor = (c, type, hex) => { const t = X.makeCar(type, hex, c.x, c.z, c.h); c.mesh.geometry = t.mesh.geometry; c.type = type; c.T = G.TYPES[type]; G.removeCar(t); return c; };
  X.getIn = (car, silent) => { G.player.x = car.x - Math.cos(car.h) * 2.2; G.player.z = car.z - Math.sin(car.h) * 2.2; if (silent) car.owned = true; G.action(); };
  X.clearTraffic = pts => { for (const c of G.cars.slice()) { if (c.mode !== 'ai' && c.mode !== 'parked') continue;
    let near = false; for (let i = 1; i < pts.length && !near; i++) { const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz, t = L ? clamp(((c.x - a[0]) * dx + (c.z - a[1]) * dz) / L, 0, 1) : 0; if (Math.hypot(c.x - a[0] - dx * t, c.z - a[1] - dz * t) < (c.mode === 'ai' ? 30 : 4.5)) near = true; }
    if (near) G.removeCar(c); } };
  X.stagePolice = (pts, dists) => { const c = G.pcar; G.police.forEach((p, i) => { const o = X.along(pts, Math.max(0, X.autoS() - dists[i])), side = (i % 2 ? -1 : 1) * 1.5;
    p.x = o.x + Math.cos(o.h) * side; p.z = o.z + Math.sin(o.h) * side; p.h = o.h; p.v = Math.min(c.v, p.T.max); G.placeCar(p); }); };
  // full chase: hero car on a main-road route out of Torget with three police cars on its tail
  X.chase = (type, hex, warm, dists, vmax = 0) => {
    X.start(); const pts = X.route(18.1, 32.7, 0, 1800, 1), h0 = Math.atan2(pts[1][0] - pts[0][0], -(pts[1][1] - pts[0][1]));
    X.clearTraffic(pts);
    const car = X.makeCar(type, hex, pts[0][0], pts[0][1], h0); X.getIn(car, true); X.autopilot(pts, vmax ? { max: vmax } : {}); X.pts = pts;
    // oncoming traffic would end the take in a pile-up, so clear what is directly ahead
    X.pre.push(() => { for (const c of G.cars.slice()) if (c.mode === 'ai') { const d = Math.hypot(c.x - car.x, c.z - car.z); if (d < 70 && (d < 12 || Math.abs(wrap(Math.atan2(c.x - car.x, -(c.z - car.z)) - car.h)) < 0.5)) G.removeCar(c); } });
    __step(warm); G.addStar(); G.addStar(); G.addStar(); __step(2); X.hideToast(); X.stagePolice(pts, dists); __step(10); X.hideToast();
    return car; };

  // ----- cameras -----
  X.setCam = fn => { window.__cam = fn ? (cam, T) => { fn(cam, T); const s = X.sunAt || T; G.sun.target.position.set(s.x, G.hAt(s.x, s.z), s.z); G.sun.position.copy(G.sun.target.position).addScaledVector(G.SUN_DIR, 400); } : null; };
  X.fov = f => { G.camera.fov = f; G.camera.updateProjectionMatrix(); };
  X.wideShadows = () => { const s = G.sun.shadow; Object.assign(s.camera, { left: -900, right: 900, top: 900, bottom: -900, near: 10, far: 1800 }); s.camera.updateProjectionMatrix(); s.bias = -0.003; };
  let sh = null; const head = T => { sh = sh == null ? T.h : sh + wrap(T.h - sh) * 0.12; return sh; };
  // low, ahead of the hero, looking back at the pursuit
  X.rigFront = (ahead = 9, side = 2.5, up = 1.1, back = 6, drift = 0, lift = 1.1) => (cam, T) => { const h = head(T), fx = Math.sin(h), fz = -Math.cos(h), s = side + drift * (X.k || 0);
    const x = T.x + fx * ahead - fz * s, z = T.z + fz * ahead + fx * s; cam.position.set(x, G.hAt(x, z) + up, z); cam.lookAt(T.x - fx * back, G.hAt(T.x, T.z) + lift, T.z - fz * back); };
  // high and ahead, looking back down the road
  X.rigDrone = (ahead = 20, up = 15, side = 7, back = 9) => (cam, T) => { const h = head(T), fx = Math.sin(h), fz = -Math.cos(h), k = X.k || 0;
    const x = T.x + fx * (ahead - 5 * k) - fz * side, z = T.z + fz * (ahead - 5 * k) + fx * side; cam.position.set(x, G.hAt(T.x, T.z) + up - 4 * k, z); cam.lookAt(T.x - fx * back, G.hAt(T.x, T.z) + 1, T.z - fz * back); };
  // wheel height, alongside
  X.rigSide = (side = 7, fwd = 2, up = 0.9) => (cam, T) => { const h = head(T), fx = Math.sin(h), fz = -Math.cos(h), k = X.k || 0;
    const x = T.x - fz * side + fx * (fwd + 5 * k), z = T.z + fx * side + fz * (fwd + 5 * k); cam.position.set(x, G.hAt(x, z) + up, z); cam.lookAt(T.x - fx * 7, G.hAt(T.x, T.z) + 1.0, T.z - fz * 7); };
})();
