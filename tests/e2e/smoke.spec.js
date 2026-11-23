// Smoke tests for the built pages. They assert on the DOM and on the window.__joyride test hook, never on pixels:
// headless WebGL output varies between machines. The screenshots are attached for humans to look at.
import { expect, test } from '@playwright/test';
import { watchErrors } from './render-helpers.js';

// True when the page itself gave #gl a WebGL context. A canvas keeps one context type for life, so asking for '2d'
// returns null only if a WebGL context already exists. (Asking for 'webgl' here would create one and always pass.)
async function expectWebGL(page) {
  await expect(page.locator('#fail')).toBeHidden();
  expect(await page.evaluate(() => document.getElementById('gl').getContext('2d'))).toBeNull();
}

const state = page => page.evaluate(() => window.__joyride.state());
// Resolves after n rendered frames, so a test can let the game loop run a known number of times.
const frames = (page, n) =>
  page.evaluate(
    n =>
      new Promise(r => {
        const f = () => (--n ? requestAnimationFrame(f) : r());
        requestAnimationFrame(f);
      }),
    n,
  );
// Key events dispatched in one evaluate land between two frames, so the loop never sees the state in between.
const keysNow = (page, events) =>
  page.evaluate(events => {
    for (const [type, code] of events) document.body.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  }, events);

// From Start, walks to the parked car next to Torget (the Volvo 240, or the model `?vehicle=` picks) and gets in.
async function getInParkedCar(page, name = 'Volvo 240') {
  // With the camera as Start leaves it, the parked Volvo is about 7 m to the player's right.
  // Release D as soon as any car is in reach, so a slow runner can't walk past it between polls.
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await state(page)).near, { intervals: [50] }).not.toBeNull();
  await page.keyboard.up('KeyD');
  // The parked Volvo, not AI traffic passing through Torget (that would be a carjack and a star). Check the nearest car
  // and press E in one browser task: E acts in its keydown handler, so no frame can bring a passing car closer in between.
  await expect
    .poll(() =>
      page.evaluate(want => {
        if (window.__joyride.state().near !== 'parked') return null;
        const prompt = document.getElementById('prompt').textContent;
        if (prompt === want)
          for (const type of ['keydown', 'keyup'])
            document.body.dispatchEvent(new KeyboardEvent(type, { code: 'KeyE', bubbles: true }));
        return prompt;
      }, 'ESteal the ' + name),
    )
    .toBe('ESteal the ' + name);
  await expect.poll(async () => (await state(page)).inCar).toBe(true);
}

test.describe('game (index.html)', () => {
  // Start and clicks on the game ask for the pointer lock. Headless Chromium grants it on Linux (CI) but not on macOS, and once
  // locked, Playwright's mouse moves arrive as erratic movementX and turn the camera, so walk-relative steps miss their target.
  // Take the lock away, so every run uses the drag fallback that touch and lock-refusing browsers get.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.requestPointerLock = undefined;
    });
  });

  test('builds the streetscape and reports it on the hook, also in the debug view', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html?debug=streetscape');
    await expectWebGL(page);
    const { streetscape: s } = await state(page);
    // every count is there; what is mapped depends on the OSM snapshot, but the centre always gets inferred pavement
    for (const k of ['mapped', 'derived', 'inferred']) expect(s.sidewalkM[k]).toBeGreaterThanOrEqual(0);
    expect(s.sidewalkM.inferred).toBeGreaterThan(0);
    for (const k of ['parkingAreas', 'crossings', 'meshes', 'triangles']) expect(s[k]).toBeGreaterThanOrEqual(0);
    expect(s.streetTrees).toEqual({ mapped: expect.any(Number), inferred: expect.any(Number) });
    expect(s.meshes).toBeGreaterThan(0);
    expect(s.debug).toBe(true);
    await page.locator('#go').click();
    await frames(page, 5);
    await page.screenshot({ path: testInfo.outputPath('game-streetscape-debug.png') });
    expect(errors).toEqual([]);
  });

  // In Vrigstadsån's channel west of the bridge: the player starts in the water, below the bank either side (#263).
  test('builds the lakes, the rivers in their channels and the shore, and starts you wet in the river', async ({
    page,
  }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html?at=-60,-518,1.6,0.3');
    await page.setViewportSize({ width: 640, height: 360 }); // keep software WebGL affordable
    await expectWebGL(page);
    const { water: w } = await state(page);
    expect(w.lakes).toBe(4);
    expect(w.courses).toBeGreaterThan(0);
    expect(w.meshes).toBeGreaterThan(0);
    expect(w.triangles).toBeGreaterThan(0);
    expect(w.refinedCells).toBeGreaterThan(0);
    expect(w.reeds).toBeGreaterThan(0);
    expect(w.stones).toBeGreaterThan(0);
    expect(w.shore.stony + w.shore.reedy + w.shore.sandy + w.shore.grassy).toBeGreaterThan(0);
    // the ground under the player is under the river's level, and the game calls it water
    expect(w.level).not.toBeNull();
    expect(w.ground).toBeLessThan(w.level);
    expect(w.wet).toBe(true);
    await page.locator('#go').click();
    await frames(page, 5);
    await page.screenshot({ path: testInfo.outputPath('game-river-channel.png') });
    expect(errors).toEqual([]);
  });

  test('builds the six mapped bridges and starts you on the Jönköpingsvägen deck', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html?at=-33.9,-8.4,1.6,0.3');
    await page.setViewportSize({ width: 640, height: 360 }); // keep software WebGL affordable
    await expectWebGL(page);
    const { bridges: b, water: w } = await state(page);
    expect(b.count).toBe(6);
    // over Vrigstadsån's channel, but on the deck: dry (#263)
    expect(w.level).not.toBeNull();
    expect(w.wet).toBe(false);
    expect(b.byArchetype).toEqual({ 'road-slab': 1, 'path-steel': 4, 'path-timber': 1 });
    expect(b.onDeck).toBe(true);
    // the player stands on groundAt, so on the deck's surface rather than the terrain under it
    expect(b.groundY).toBeCloseTo(b.deckY, 5);
    expect(b.meshes).toBe(12);
    expect(b.triangles).toBeLessThan(15000);
    await page.locator('#go').click();
    await frames(page, 5);
    await page.screenshot({ path: testInfo.outputPath('game-bridge.png') });
    expect(errors).toEqual([]);
  });

  test('places street lamps, benches and bins and reports them on the hook, also in the debug view', async ({
    page,
  }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html?debug=furniture&at=-30,48,2.3,0.35');
    await expectWebGL(page);
    const { furniture: f } = await state(page);
    // what is mapped depends on the OSM snapshot; the rules always light the centre and furnish Torget
    expect(f.byKind['street-lamp']).toBeGreaterThan(0);
    expect(f.byKind.bench).toBeGreaterThanOrEqual(4);
    expect(f.byKind['waste-bin']).toBeGreaterThanOrEqual(2);
    expect(f.bySource.osm + f.bySource.override + f.bySource.procedural).toBe(f.total);
    expect(f.meshes).toBeGreaterThan(0);
    expect(f.meshes).toBeLessThanOrEqual(6 * 36); // at most six per 400 m cell, and the 2200 m world spans 6 × 6 cells
    expect(f.debug).toBe(true);
    await page.locator('#go').click();
    await frames(page, 5);
    await page.screenshot({ path: testInfo.outputPath('game-furniture-debug.png') });
    expect(errors).toEqual([]);
  });

  // The sky with each kind of query, one page load per test: each load renders in software WebGL, so three in one test
  // ran into the timeout on CI. The sky is a full-screen shader, so the page is kept small. Cloudy skies must drift,
  // and let through at least minSun of the sunlight.
  for (const { query, clouds, minSun } of [
    { query: '', clouds: { cover: 'partly', seed: 1, quality: 'high' }, minSun: 0.4 },
    {
      query: 'clouds=mostly&cloudSeed=3&wind=90,12&cloudQuality=low',
      clouds: { cover: 'mostly', seed: 3, quality: 'low', windFromDeg: 90, windSpeedMps: 12 },
      minSun: 0,
    },
    { query: 'clouds=off', clouds: { cover: 'off', sunFactor: 1 } },
  ])
    test(`draws the clouds without shader errors${query ? ' with ?' + query : ''}${minSun === undefined ? '' : ', and they drift'}`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width: 640, height: 360 });
      await page.goto('/index.html' + (query && '?' + query));
      await expectWebGL(page);
      const first = (await state(page)).clouds;
      expect(first).toMatchObject(clouds);
      if (minSun !== undefined) {
        await frames(page, 3);
        const later = (await state(page)).clouds;
        expect(later.timeS).toBeGreaterThan(first.timeS);
        expect(later.sunFactor).toBeGreaterThan(minSun);
        expect(later.sunFactor).toBeLessThanOrEqual(1);
      }
      expect(errors).toEqual([]);
    });

  test('ragdolls are on for everyone, without a lab flag', async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 640, height: 360 }); // checks only the hook; keep software WebGL affordable
    // One page load: the old lab flag is ignored, so ragdolls are on without it and the lab list stays empty.
    await page.goto('/index.html?lab=ragdoll');
    await page.locator('#go').click();
    expect(await state(page)).toMatchObject({ lab: [], ragdolls: 0 }); // nobody knocked over yet
    expect(errors).toEqual([]);
  });

  test('loads with no console errors, a WebGL canvas and the default fleet, and Start shows the HUD', async ({
    page,
  }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await expect(page.locator('#intro')).toBeVisible(); // covers the whole view, HUD included
    await expectWebGL(page);
    expect(await state(page)).toMatchObject({ started: false, inCar: false });
    await expect(page.getByRole('link', { name: 'CC BY 4.0' })).toBeVisible(); // in the intro, so before Start
    await page.screenshot({ path: testInfo.outputPath('game-intro.png') });

    // Start and the HUD come before the fleet details, so a fleet failure can't hide a broken Start.
    await page.locator('#go').click();
    await expect(page.locator('#intro')).toBeHidden();
    expect(await state(page)).toMatchObject({ started: true });
    await expect(page.locator('#toast')).toContainText('Find a car'); // only Start shows this
    await expect(page.locator('#sign')).toBeVisible();
    await expect(page.locator('#street')).toContainText('Torget');
    await expect(page.locator('#stars')).toHaveText('★★★');
    await expect(page.locator('#stars b')).toHaveCount(0); // <b> is a lit star: none when not wanted
    await expect(page.locator('#mini')).toBeVisible();
    await expect(page.locator('#hp')).toHaveAttribute('aria-valuenow', '100'); // full health
    expect(await state(page)).toMatchObject({ hp: 100, carDmg: null });

    // The Blender fleet is on without URL parameters, and each traffic type only wears its own models.
    await expect.poll(async () => (await state(page)).vehicle?.detailed).toBe(true);
    const s = await state(page);
    expect(s.vehicle.id).toBe('volvo240');
    expect(s.traffic.length).toBeGreaterThan(0);
    const fleet = { volvo: ['volvo240', 'impala1970'], saab: ['saab900', 'xc70', 'micra-k11'], epa: ['duett-epa'] };
    for (const c of s.traffic) expect(fleet[c.type] ?? [null]).toContain(c.vehicle?.id ?? null);
    const notice = await page.request.get('/media/vehicles/NOTICE.txt');
    expect(notice.ok()).toBe(true);
    expect(await notice.text()).toContain('Vehicle models by Axel Tidehorn');
    expect(errors).toEqual([]);
  });

  test('?lab=toon draws the cel-shaded style without errors', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html?lab=toon');
    await page.locator('#go').click();
    expect(await state(page)).toMatchObject({ started: true, lab: ['toon'] });
    await frames(page, 10); // the toon shaders compile and the ink lines are built on the first frames; an error there is logged
    expect(await page.evaluate(() => document.getElementById('gl').getContext('webgl2').getError())).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('game-toon.png') });
    expect(errors).toEqual([]);
  });

  test('the wheel zooms the camera, and the browser zoom is blocked', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await expect(page.locator('#intro')).toBeHidden();
    expect(await state(page)).toMatchObject({ zoom: 1 });

    await page.mouse.move(320, 200);
    await page.mouse.wheel(0, 300); // away from you: further out
    await expect.poll(async () => (await state(page)).zoom).toBeGreaterThan(1);
    // ctrl + wheel is also how a trackpad pinch arrives; the page must not zoom, whatever the target
    const prevented = await page.evaluate(() =>
      [
        new WheelEvent('wheel', { deltaY: -50, ctrlKey: true, bubbles: true, cancelable: true }),
        new KeyboardEvent('keydown', { code: 'Equal', ctrlKey: true, bubbles: true, cancelable: true }),
      ].map(ev => !document.body.dispatchEvent(ev)),
    );
    expect(prevented).toEqual([true, true]);
    expect(errors).toEqual([]);
  });

  test('W moves the player, E next to the parked Volvo gets you in, it drives on its wheels, and a crash damages it', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000); // the simulation caps dt while software WebGL advances slowly
    await page.setViewportSize({ width: 640, height: 360 }); // keep software WebGL affordable with detailed cars
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    const from = await state(page);
    expect(from).toMatchObject({ started: true, inCar: false, car: null });

    await page.keyboard.down('KeyW');
    await expect
      .poll(async () => {
        const s = await state(page);
        return Math.hypot(s.x - from.x, s.z - from.z);
      })
      .toBeGreaterThan(1);
    await page.keyboard.up('KeyW');
    await page.keyboard.press('KeyR'); // back to the spawn point at Torget

    await getInParkedCar(page);
    await expect(page.locator('#speed')).toBeVisible();
    await expect(page.locator('#carname')).toHaveText('Volvo 240');
    await expect(page.locator('#dmg')).toHaveAttribute('aria-valuenow', '0'); // the car's damage bar, empty
    const s = await state(page);
    expect(s).toMatchObject({ inCar: true, car: 'volvo', carDmg: 0 });
    // a neighbour sees a parked car taken on rnd() < 0.35, so whether this one does depends on how many rolls the world
    // took before it: any change to world generation can flip it (AGENTS.md rule 5). A carjack would be a star for
    // sure, but getInVolvo already made sure the car was a parked one.
    expect(s.stars).toBeLessThanOrEqual(1);
    // Every model shares the loader, materials and controller, and the unit tests decode each GLB, so one is driven here.
    await expect
      .poll(async () => (await state(page)).activeVehicle)
      .toMatchObject({ id: 'volvo240', status: 'loaded', detailed: true });
    expect((await state(page)).activeVehicle.wheels).toHaveLength(4);
    const parked = await state(page);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await expect
      .poll(async () => (await state(page)).activeVehicle.wheels.slice(0, 2).some(w => Math.abs(w.steer) > 0.001))
      .toBe(true);
    await expect
      .poll(async () => {
        const s = await state(page);
        return Math.hypot(s.x - parked.x, s.z - parked.z);
      })
      .toBeGreaterThan(2);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyD');
    const {
      activeVehicle: { wheels },
    } = await state(page);
    expect(wheels.some(w => Math.abs(w.spin) > 0.1)).toBe(true);
    expect(wheels.slice(2).every(w => w.steer === 0)).toBe(true); // only the front wheels steer
    expect(await page.evaluate(() => document.getElementById('gl').getContext('webgl2').getError())).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('game-in-volvo.png') });

    // Held straight on, the Volvo soon hits something hard enough to dent it: traffic crossing Torget, or the house past it.
    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await state(page)).carDmg, { intervals: [100], timeout: 90_000 }).toBeGreaterThan(0); // inside the test's 240 s, so a miss fails here
    await page.keyboard.up('KeyW');
    await expect(page.locator('#dmg')).not.toHaveAttribute('aria-valuenow', '0');
    await page.screenshot({ path: testInfo.outputPath('game-crash.png') });
    expect(errors).toEqual([]);
  });

  test('Space and steering at speed drifts the car, and letting go after a long slide boosts', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000); // the simulation caps dt while software WebGL advances slowly
    await page.setViewportSize({ width: 640, height: 360 }); // keep software WebGL affordable with detailed cars
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await getInParkedCar(page);

    // The body rides along: it squats under throttle and leans out of the slide. Peaks are kept between polls.
    let pitch = 0,
      roll = 0;
    await page.keyboard.down('KeyW');
    await expect
      .poll(
        async () => {
          const q = await state(page);
          pitch = Math.max(pitch, q.body.pitch);
          return q.speed;
        },
        { intervals: [100], timeout: 60_000 },
      )
      .toBeGreaterThan(9);
    expect(pitch).toBeGreaterThan(0.003); // nose up
    await page.keyboard.down('KeyD');
    await page.keyboard.down('Space');
    await expect.poll(async () => (await state(page)).drift, { intervals: [50] }).toBe(1);
    // past the first spark colour (1 s of sliding, in game time: headless frames are slow), then let go at once: the slide
    // circles on Torget, and held longer it reaches the parked tractor, whose contact bleeds the speed and ends the drift unboosted
    await expect
      .poll(
        async () => {
          const q = await state(page);
          expect(q.drift).toBe(1);
          roll = Math.max(roll, q.body.roll);
          return q.charge;
        },
        { intervals: [100], timeout: 60_000 },
      )
      .toBeGreaterThan(1.05);
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
    expect(roll).toBeGreaterThan(0.01); // roof out to the left of a right-hand slide
    await expect.poll(async () => (await state(page)).drift, { intervals: [20] }).toBe(0);
    const q = await state(page);
    expect(q.boost).toBeGreaterThan(0);
    expect(q.loose).toBeGreaterThan(0); // the rear stays loose for a moment after letting go instead of snapping straight
    await page.screenshot({ path: testInfo.outputPath('game-drift.png') }); // after the checks: a screenshot takes seconds in CI, and the car drives on
    expect(errors).toEqual([]);
  });

  test('flicking the steering left then right at speed breaks the rear loose', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 640, height: 360 });
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await getInParkedCar(page);

    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await state(page)).speed, { intervals: [50], timeout: 60_000 }).toBeGreaterThan(9);
    expect((await state(page)).loose).toBe(0);
    await page.keyboard.down('KeyA');
    await expect.poll(async () => (await state(page)).flickHeld, { intervals: [20] }).toBeGreaterThanOrEqual(0.3); // held long enough to load the car up (FLICK_LOAD_S)
    await page.keyboard.up('KeyA');
    await page.keyboard.down('KeyD');
    await expect.poll(async () => (await state(page)).loose, { intervals: [20] }).toBeGreaterThan(0);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
    expect(errors).toEqual([]);
  });

  test('dragging the view turns the camera', async ({ page }) => {
    // The pointer lock is taken away (see beforeEach), so this covers the drag that touch and lock-refusing browsers fall back to.
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    const { yaw } = await state(page);

    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(400, 300, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await state(page)).yaw).toBeGreaterThan(yaw);
    expect(errors).toEqual([]);
  });

  test('Space jumps once per press, a tap between two frames still jumps, and R mid-jump lands at Torget', async ({
    page,
  }) => {
    test.setTimeout(180_000); // three jump phases in one test, and software WebGL advances slowly in CI
    await page.setViewportSize({ width: 640, height: 360 }); // keep software WebGL affordable with detailed cars
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    expect(await state(page)).toMatchObject({ y: 0 });

    await page.keyboard.down('Space');
    await expect.poll(async () => (await state(page)).y, { intervals: [30] }).toBeGreaterThan(0.2);
    await page.keyboard.up('Space');
    await expect.poll(async () => (await state(page)).y).toBe(0);

    await frames(page, 30); // held through a whole hop: one jump per press, no re-hop
    await page.keyboard.down('Space');
    await expect.poll(async () => (await state(page)).y, { intervals: [30] }).toBeGreaterThan(0.2);
    await expect.poll(async () => (await state(page)).y).toBe(0);
    await frames(page, 10);
    expect(await state(page)).toMatchObject({ y: 0 });
    await page.keyboard.up('Space');

    await frames(page, 30);
    await keysNow(page, [
      ['keydown', 'Space'],
      ['keyup', 'Space'],
    ]); // down and up between the same two frames
    await expect.poll(async () => (await state(page)).y, { intervals: [30] }).toBeGreaterThan(0.2);
    await page.keyboard.press('KeyR'); // still in the air: back on the ground at Torget
    expect(await state(page)).toMatchObject({ y: 0 });
    await frames(page, 5);
    expect(await state(page)).toMatchObject({ y: 0 });
    expect(errors).toEqual([]);
  });

  test('Space held from braking does not jump on getting out', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await getInParkedCar(page);

    // Space held for a few car frames, then E.
    await keysNow(page, [['keydown', 'Space']]);
    await frames(page, 3);
    await keysNow(page, [
      ['keydown', 'KeyE'],
      ['keyup', 'KeyE'],
    ]);
    await frames(page, 10);
    expect(await state(page)).toMatchObject({ inCar: false, y: 0 });
    await keysNow(page, [['keyup', 'Space']]);

    // Space and E between the same two frames.
    await page.keyboard.press('KeyE');
    await expect.poll(async () => (await state(page)).inCar).toBe(true);
    await frames(page, 3); // a few car frames with Space up
    await keysNow(page, [
      ['keydown', 'Space'],
      ['keydown', 'KeyE'],
      ['keyup', 'KeyE'],
    ]);
    await frames(page, 10);
    expect(await state(page)).toMatchObject({ inCar: false, y: 0 });
    await keysNow(page, [['keyup', 'Space']]);
    expect(errors).toEqual([]);
  });

  test('cats are around, and the kiosk sells cat treats and food from its menu, for money', async ({
    page,
  }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await expect.poll(async () => (await state(page)).cats).toBeGreaterThan(0); // Torget is built-up, so cats spawn at once
    expect(await state(page)).toMatchObject({ treats: 0, kr: 200 });
    await expect(page.locator('#kr')).toHaveText('200 riksdaler');

    // With the camera as Start leaves it, the kiosk lucka is about 4.6 m to the player's left.
    await page.keyboard.down('KeyA');
    await expect.poll(async () => page.locator('#prompt').textContent(), { intervals: [50] }).toBe('EHandla i kiosken');
    await page.keyboard.up('KeyA');

    await page.keyboard.press('KeyE');
    await expect(page.locator('#kmenu')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('game-kiosk-menu.png') });
    await page.keyboard.press('Digit2');
    await expect(page.locator('#kmenu')).toBeHidden();
    await expect(page.locator('#treats')).toHaveText('Cat treats: 3');
    expect(await state(page)).toMatchObject({ treats: 3, kr: 195 });
    await expect(page.locator('#kr')).toHaveText('195 riksdaler');

    await page.keyboard.press('KeyE');
    await expect(page.locator('#kmenu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#kmenu')).toBeHidden();
    expect(await state(page)).toMatchObject({ treats: 3 });

    await page.keyboard.press('KeyE'); // food: at full health the kiosk won't sell it, and health stays full
    await expect(page.locator('#kmenu')).toBeVisible();
    await page.keyboard.press('Digit3');
    await expect(page.locator('#kmenu')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('mätt');
    expect(await state(page)).toMatchObject({ hp: 100, kr: 195 }); // and it costs nothing
    expect(errors).toEqual([]);
  });

  test('the day ends at 19:00 and blends into the night skip', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html?time=18.99');
    await expectWebGL(page);
    await frames(page, 5);
    expect(await state(page)).toMatchObject({ hour: 18.99, night: 0 }); // the clock waits on the title screen
    await page.locator('#go').click();
    // 0.01 h of day is well under a second of game time, and the skip lasts NIGHT_S = 10 s: a fast runner can be through
    // it by the next poll, so either the skip has started or the clock has wrapped to the next morning
    const begun = s => s.night > 0 || s.hour < 6;
    await expect.poll(async () => begun(await state(page))).toBe(true);
    const s = await state(page);
    if (s.night > 0) expect(s.hour).toBe(19);
    else expect(s.hour).toBeGreaterThanOrEqual(5);
    expect(errors).toEqual([]);
  });

  test('with ?dev, the console opens with §, its keys never move the player, Tab completes, kr and mynt add money, tune set changes a tunable, stars and god work, adopt cat gives you a cat, fps shows frame times and errors, errors clear empties them (and L makes it rain)', async ({
    page,
  }) => {
    await page.goto('/index.html');
    await page.locator('#go').click();
    await page.keyboard.press('Backquote'); // no dev mode: no console
    expect(await state(page)).toMatchObject({ devcon: false });
    await expect(page.locator('#debug')).toHaveCount(0); // nor the errors box
    await page.goto('/index.html?dev');
    await page.locator('#go').click();
    const { x, z } = await state(page);
    await page.keyboard.press('Backquote');
    expect(await state(page)).toMatchObject({ devcon: true });
    await page.keyboard.down('KeyW'); // held in the console: the player stays put
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyW');
    expect(await state(page)).toMatchObject({ x, z });
    await page.locator('#devcon input').fill(''); // the held W typed a w
    await page.locator('#devcon').click({ position: { x: 4, y: 4 } }); // focus off the input, console still open: keys still don't reach the game
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyW');
    expect(await state(page)).toMatchObject({ x, z, devcon: true });
    await page.keyboard.type('kr 500');
    await page.keyboard.press('Enter');
    await expect(page.locator('#kr')).toHaveText('700 riksdaler');
    await expect(page.locator('#devcon li').last()).toHaveText('Wallet: 700 riksdaler.');
    await page.keyboard.type('mynt'); // the old cheat word, now a command: 1 000 kr
    await page.keyboard.press('Enter');
    await expect(page.locator('#kr')).toHaveText('1 700 riksdaler');
    const run = async line => {
      await page.keyboard.type(line);
      await page.keyboard.press('Enter');
      return page.locator('#devcon li').last();
    };
    await expect(await run('adopt dog')).toHaveText('No pet called dog. Usage: adopt <cat>');
    await expect(await run('adopt cat')).toHaveText('Adopted a cat.');
    const setLine = await run('tune set driving.grip 8'); // the tunables (#357)
    await expect(setLine).toHaveText(/^driving\.grip = 8 1\/s \(was [\d.]+\)$/);
    const was = (await setLine.textContent()).match(/was ([\d.]+)/)[1];
    await expect(await run('tune reset driving.grip')).toHaveText(`driving.grip = ${was} 1/s`);
    await expect(await run('stars 2')).toHaveText('Wanted: 2 stars.'); // #356
    expect(await state(page)).toMatchObject({ stars: 2 });
    await expect(await run('stars 0')).toHaveText('Not wanted.');
    await expect(await run('god')).toHaveText('God mode on.');
    await expect(await run('adopt --help')).toHaveText(
      'adopt <cat>: adopt a new random pet of that kind\nExamples:\n  adopt cat',
    ); // every command answers --help
    expect(await state(page)).toMatchObject({ ownCat: true });
    await expect(page.locator('#pets')).toBeVisible();
    await expect(await run('adopt cat')).toHaveText('You already have a cat, Kisse. Set it free first (P).');
    const line = page.locator('#devcon input');
    await page.keyboard.type('ado');
    await page.keyboard.press('Tab'); // completes the name, keeps focus, and shows how to use the command
    await expect(line).toHaveValue('adopt ');
    await expect(line).toBeFocused();
    await expect(page.locator('#devcon .hint')).toHaveText('adopt <cat>');
    await line.fill('ado cat');
    await line.evaluate(el => el.setSelectionRange(3, 3)); // the caret after "ado": Tab completes there, keeping the rest
    await page.keyboard.press('Tab');
    await expect(line).toHaveValue('adopt cat'); // the space already there, not a second one
    expect(await line.evaluate(el => el.selectionStart)).toBe(6);
    await line.fill('help ');
    const lines = page.locator('#devcon li');
    const before = await lines.count();
    await page.keyboard.press('Tab'); // nothing shared to fill in: the first Tab lists nothing yet
    await expect(lines).toHaveCount(before);
    await page.keyboard.press('Tab'); // the second lists what could follow
    await expect(lines.last()).toHaveText(/^adopt {2}.*god {2}help {2}kr {2}.*mynt {2}.*stars/);
    await page.keyboard.press('Tab'); // and a third doesn't list it again
    await expect(lines).toHaveCount(before + 1);
    await expect(line).toHaveValue('help ');
    await line.fill('');
    await page.keyboard.press('Tab');
    await page.keyboard.type('x');
    await page.keyboard.press('Backspace'); // typing away and back starts over: the next Tab is a first one again
    await page.keyboard.press('Tab');
    await expect(lines).toHaveCount(before + 1);
    await page.keyboard.press('Tab');
    await expect(lines).toHaveCount(before + 2);
    await line.fill('');
    await expect(page.locator('#debug-stats')).toBeHidden();
    await expect(await run('fps')).toHaveText('Frame times on.'); // #356, from #257
    const { build } = await state(page);
    expect(build).toMatch(/^([0-9a-f]{7,}|unknown)$/);
    await expect(page.locator('#debug-stats')).toContainText(/\d+ fps · worst [\d.]+ ms/);
    await expect(page.locator('#debug-stats')).toContainText(/\d+ calls · \d+k tris/);
    await expect(page.locator('#debug-stats')).toContainText('build ' + build);
    await expect(page.locator('#debug-errors')).toBeEmpty();
    // an error thrown outside the game shows in the red box in dev mode; twice counts up
    await page.evaluate(() => {
      for (let i = 0; i < 2; i++)
        setTimeout(() => {
          throw new Error('smoke test boom');
        });
    });
    await expect(page.locator('#debug-errors')).toContainText(/^2× .*smoke test boom/);
    await expect(await run('errors clear')).toHaveText('Errors cleared.');
    await expect(page.locator('#debug-errors')).toBeEmpty();
    await expect(await run('fps')).toHaveText('Frame times off.');
    expect(await state(page)).toMatchObject({ fps: false });
    await page.keyboard.press('Escape');
    expect(await state(page)).toMatchObject({ devcon: false });
    await page.keyboard.press('KeyL'); // låt det regna: 1 000 kr in the air
    await expect(page.locator('#kr')).toHaveText('700 riksdaler');
    expect((await state(page)).banknotes).toBeGreaterThan(0);
    await page.keyboard.press('KeyL'); // not enough left: nothing is taken
    expect(await state(page)).toMatchObject({ kr: 700 });
  });

  test('Skroten buys the car you drive onto its ring', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html?dev');
    await page.locator('#go').click();
    await page.keyboard.press('Backquote');
    await page.keyboard.type('go skroten'); // onto Skroten's ring (SKROTEN in src/game/places.ts)
    await page.keyboard.press('Enter');
    await expect(page.locator('#devcon li').last()).toHaveText('You are at Skroten.');
    await page.keyboard.type('car volvo240'); // yours, so no star when you get in; parked 3.5 m away, still on the ring
    await page.keyboard.press('Enter');
    await expect(page.locator('#devcon li').last()).toHaveText('Parked a Volvo 240 next to you.');
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyE');
    expect(await state(page)).toMatchObject({ inCar: true, kr: 200 });
    await expect(page.locator('#prompt')).toHaveText('ESell the Volvo 240 at Skroten');
    await page.keyboard.press('KeyE');
    await expect(page.locator('#kmenu')).toContainText('800 riksdaler');
    await page.screenshot({ path: testInfo.outputPath('game-skroten-menu.png') });
    await page.keyboard.press('Digit1');
    await expect(page.locator('#kr')).toHaveText('1 000 riksdaler');
    expect(await state(page)).toMatchObject({ inCar: false, car: null });
    expect(errors).toEqual([]);
  });
});

// The real pointer lock is unreliable headless, so these fake it: requestPointerLock / exitPointerLock set a fake
// pointerLockElement and fire pointerlockchange, and moves are dispatched with exact movementX, so the yaw change is exact.
test.describe('game with the pointer locked (faked)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      let el = null;
      const changed = () => setTimeout(() => document.dispatchEvent(new Event('pointerlockchange')));
      Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get: () => el });
      HTMLCanvasElement.prototype.requestPointerLock = function () {
        el = this;
        changed();
        return Promise.resolve();
      };
      Document.prototype.exitPointerLock = () => {
        el = null;
        changed();
      };
    });
  });

  const isLocked = page => page.evaluate(() => document.pointerLockElement === document.getElementById('gl'));
  // Dispatches pointer events on the canvas; returns how much the camera yaw changed.
  const turn = (page, events) =>
    page.evaluate(evs => {
      const c = document.getElementById('gl'),
        y0 = window.__joyride.state().yaw;
      for (const [type, init] of evs)
        c.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, ...init }));
      return window.__joyride.state().yaw - y0;
    }, events);

  test('a mouse Start locks the pointer, and the mouse turns the camera with no button held', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await expect.poll(() => isLocked(page)).toBe(true);
    const d = await turn(page, [['pointermove', { pointerId: 1, pointerType: 'mouse', movementX: 50 }]]);
    expect(d).toBeCloseTo(50 * 0.4 * 0.006, 5); // LOCK_K and the look rate in src/game/main.ts
    expect(errors).toEqual([]);
  });

  test('a touch drag while the mouse holds the lock turns at drag speed', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await expect.poll(() => isLocked(page)).toBe(true);
    const touch = { pointerId: 7, pointerType: 'touch' };
    const d = await turn(page, [
      ['pointerdown', { ...touch, clientX: 300, clientY: 300 }],
      ['pointermove', { pointerId: 1, pointerType: 'mouse', movementX: 0, clientX: 640, clientY: 360 }], // a locked mouse move in between
      ['pointermove', { ...touch, clientX: 400, clientY: 300, movementX: 100 }],
      ['pointerup', { ...touch, clientX: 400, clientY: 300 }],
    ]);
    expect(d).toBeCloseTo(100 * 0.006, 5);
    expect(await isLocked(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('the kiosk menu frees the cursor, a click beside it keeps it free, and closing it locks again', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await expect.poll(() => isLocked(page)).toBe(true);

    await page.keyboard.down('KeyA'); // the kiosk is to the left, as in the treats test
    await expect.poll(async () => page.locator('#prompt').textContent(), { intervals: [50] }).toBe('EHandla i kiosken');
    await page.keyboard.up('KeyA');
    await page.keyboard.press('KeyE');
    await expect(page.locator('#kmenu')).toBeVisible();
    expect(await isLocked(page)).toBe(false);

    await page.mouse.click(20, 300); // on the game, beside the menu
    await expect(page.locator('#kmenu')).toBeVisible();
    expect(await isLocked(page)).toBe(false);

    await page.keyboard.press('Escape');
    await expect(page.locator('#kmenu')).toBeHidden();
    expect(await isLocked(page)).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('map (map.html)', () => {
  test('loads with no console errors and draws the map', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/map.html');
    await expectWebGL(page);
    // A place label only gets a screen position once a frame has been drawn with the camera.
    await expect(page.locator('#labels .lbl', { hasText: /^Torget$/ })).toHaveAttribute('style', /translate/);
    await page.screenshot({ path: testInfo.outputPath('map.png') });
    expect(errors).toEqual([]);
  });
});
