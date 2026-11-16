// Smoke tests for the built pages. They assert on the DOM and on the window.__joyride test hook, never on pixels:
// headless WebGL output varies between machines. The screenshots are attached for humans to look at.
import { test, expect } from '@playwright/test';

// Collects console errors and uncaught exceptions from the moment the page starts loading.
function watchErrors(page) {
  const errors = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    // A CDN or font outage is not our bug; failed loads from our own origin still count.
    const url = m.location().url;
    if (m.text().startsWith('Failed to load resource') && url && new URL(url).origin !== new URL(page.url()).origin) return;
    errors.push(m.text());
  });
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}

// True when the page itself gave #gl a WebGL context. A canvas keeps one context type for life, so asking for '2d'
// returns null only if a WebGL context already exists. (Asking for 'webgl' here would create one and always pass.)
async function expectWebGL(page) {
  await expect(page.locator('#fail')).toBeHidden();
  expect(await page.evaluate(() => document.getElementById('gl').getContext('2d'))).toBeNull();
}

const state = page => page.evaluate(() => window.__joyride.state());
// Resolves after n rendered frames, so a test can let the game loop run a known number of times.
const frames = (page, n) => page.evaluate(n => new Promise(r => { const f = () => (--n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); }), n);
// Key events dispatched in one evaluate land between two frames, so the loop never sees the state in between.
const keysNow = (page, events) => page.evaluate(events => { for (const [type, code] of events) document.body.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true })); }, events);

// From Start, walks to the parked Volvo next to Torget and gets in.
async function getInVolvo(page) {
  // With the camera as Start leaves it, the parked Volvo is about 7 m to the player's right.
  // Release D as soon as any car is in reach, so a slow runner can't walk past it between polls.
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await state(page)).near, { intervals: [50] }).not.toBeNull();
  await page.keyboard.up('KeyD');
  // The parked Volvo, not AI traffic passing through Torget (that would be a carjack and a star).
  await expect.poll(async () => (await state(page)).near).toBe('parked');
  await expect(page.locator('#prompt')).toHaveText('ESteal the Volvo 240');
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await state(page)).inCar).toBe(true);
}

test.describe('game (index.html)', () => {
  // Start and clicks on the game ask for the pointer lock. Headless Chromium grants it on Linux (CI) but not on macOS, and once
  // locked, Playwright's mouse moves arrive as erratic movementX and turn the camera, so walk-relative steps miss their target.
  // Take the lock away, so every run uses the drag fallback that touch and lock-refusing browsers get.
  test.beforeEach(async ({ page }) => { await page.addInitScript(() => { HTMLCanvasElement.prototype.requestPointerLock = undefined; }); });

  test('loads with no console errors and a WebGL canvas', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await expect(page.locator('#intro')).toBeVisible();
    await expectWebGL(page);
    expect(await state(page)).toMatchObject({ started: false, inCar: false });
    await page.screenshot({ path: testInfo.outputPath('game-intro.png') });
    expect(errors).toEqual([]);
  });

  test('Start hides the intro and shows the HUD', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await expect(page.locator('#intro')).toBeVisible();                 // covers the whole view, HUD included
    expect(await state(page)).toMatchObject({ started: false });

    await page.locator('#go').click();
    await expect(page.locator('#intro')).toBeHidden();
    expect(await state(page)).toMatchObject({ started: true });
    await expect(page.locator('#toast')).toContainText('Find a car');   // only Start shows this
    await expect(page.locator('#sign')).toBeVisible();
    await expect(page.locator('#street')).toContainText('Torget');
    await expect(page.locator('#stars')).toHaveText('★★★');
    await expect(page.locator('#stars b')).toHaveCount(0);              // <b> is a lit star: none when not wanted
    await expect(page.locator('#mini')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('W moves the player, and E next to the parked Volvo gets you in', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    const from = await state(page);
    expect(from).toMatchObject({ started: true, inCar: false, car: null });

    await page.keyboard.down('KeyW');
    await expect.poll(async () => { const s = await state(page); return Math.hypot(s.x - from.x, s.z - from.z); }).toBeGreaterThan(1);
    await page.keyboard.up('KeyW');
    await page.keyboard.press('KeyR');                            // back to the spawn point at Torget

    await getInVolvo(page);
    await expect(page.locator('#speed')).toBeVisible();
    await expect(page.locator('#carname')).toHaveText('Volvo 240');
    expect(await state(page)).toMatchObject({ inCar: true, car: 'volvo', stars: 0 });
    await page.screenshot({ path: testInfo.outputPath('game-in-volvo.png') });
    expect(errors).toEqual([]);
  });

  test('Space and steering at speed drifts the car, and letting go after a long slide boosts', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await page.keyboard.down('KeyD');                             // into the parked Volvo, as in the test above
    await expect.poll(async () => (await state(page)).near, { intervals: [50] }).not.toBeNull();
    await page.keyboard.up('KeyD');
    await expect.poll(async () => (await state(page)).near).toBe('parked');
    await page.keyboard.press('KeyE');
    await expect.poll(async () => (await state(page)).inCar).toBe(true);

    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await state(page)).speed, { intervals: [50] }).toBeGreaterThan(9);
    await page.keyboard.down('KeyD');
    await page.keyboard.down('Space');
    await expect.poll(async () => (await state(page)).drift, { intervals: [50] }).toBe(1);
    // past the first spark colour (1 s of sliding, in game time: headless frames are slow); the slide circles on Torget, clear of walls
    await expect.poll(async () => { const q = await state(page); expect(q.drift).toBe(1); return q.charge; }, { intervals: [100], timeout: 60_000 }).toBeGreaterThan(1.05);
    await page.screenshot({ path: testInfo.outputPath('game-drift.png') });
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
    await expect.poll(async () => (await state(page)).drift, { intervals: [20] }).toBe(0);
    const q = await state(page);
    expect(q.boost).toBeGreaterThan(0);
    expect(q.loose).toBeGreaterThan(0);   // the rear stays loose for a moment after letting go instead of snapping straight
    expect(errors).toEqual([]);
  });

  test('flicking the steering left then right at speed breaks the rear loose', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await page.keyboard.down('KeyD');                             // into the parked Volvo, as in the tests above
    await expect.poll(async () => (await state(page)).near, { intervals: [50] }).not.toBeNull();
    await page.keyboard.up('KeyD');
    await expect.poll(async () => (await state(page)).near).toBe('parked');
    await page.keyboard.press('KeyE');
    await expect.poll(async () => (await state(page)).inCar).toBe(true);

    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await state(page)).speed, { intervals: [50] }).toBeGreaterThan(9);
    expect((await state(page)).loose).toBe(0);
    await page.keyboard.down('KeyA');
    await expect.poll(async () => (await state(page)).flickDir, { intervals: [20] }).toBe(-1);   // a frame has seen the left turn (CI frames are slow)
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

  test('Space makes the player jump and land again', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    expect(await state(page)).toMatchObject({ y: 0 });

    await page.keyboard.down('Space');
    await expect.poll(async () => (await state(page)).y, { intervals: [30] }).toBeGreaterThan(0.2);
    await page.keyboard.up('Space');
    await expect.poll(async () => (await state(page)).y).toBe(0);

    await frames(page, 30);                                       // held through a whole hop: one jump per press, no re-hop
    await page.keyboard.down('Space');
    await expect.poll(async () => (await state(page)).y, { intervals: [30] }).toBeGreaterThan(0.2);
    await expect.poll(async () => (await state(page)).y).toBe(0);
    await frames(page, 10);
    expect(await state(page)).toMatchObject({ y: 0 });
    await page.keyboard.up('Space');
    expect(errors).toEqual([]);
  });

  test('a tap between two frames still jumps', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await keysNow(page, [['keydown', 'Space'], ['keyup', 'Space']]);
    await expect.poll(async () => (await state(page)).y, { intervals: [30] }).toBeGreaterThan(0.2);
    expect(errors).toEqual([]);
  });

  test('Space held from braking does not jump on getting out', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await getInVolvo(page);

    // Space held for a few car frames, then E.
    await keysNow(page, [['keydown', 'Space']]);
    await frames(page, 3);
    await keysNow(page, [['keydown', 'KeyE'], ['keyup', 'KeyE']]);
    await frames(page, 10);
    expect(await state(page)).toMatchObject({ inCar: false, y: 0 });
    await keysNow(page, [['keyup', 'Space']]);

    // Space and E between the same two frames.
    await page.keyboard.press('KeyE');
    await expect.poll(async () => (await state(page)).inCar).toBe(true);
    await frames(page, 3);                                        // a few car frames with Space up
    await keysNow(page, [['keydown', 'Space'], ['keydown', 'KeyE'], ['keyup', 'KeyE']]);
    await frames(page, 10);
    expect(await state(page)).toMatchObject({ inCar: false, y: 0 });
    await keysNow(page, [['keyup', 'Space']]);
    expect(errors).toEqual([]);
  });

  test('R in the middle of a jump puts the player on the ground at Torget', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await state(page)).y, { intervals: [30] }).toBeGreaterThan(0.2);
    await page.keyboard.press('KeyR');
    expect(await state(page)).toMatchObject({ y: 0 });
    await frames(page, 5);
    expect(await state(page)).toMatchObject({ y: 0 });
    expect(errors).toEqual([]);
  });

  test('cats are around, and the kiosk sells cat treats from its menu', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await expect.poll(async () => (await state(page)).cats).toBeGreaterThan(0);   // Torget is built-up, so cats spawn at once
    expect(await state(page)).toMatchObject({ treats: 0 });

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
    expect(await state(page)).toMatchObject({ treats: 3 });

    await page.keyboard.press('KeyE');
    await expect(page.locator('#kmenu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#kmenu')).toBeHidden();
    expect(await state(page)).toMatchObject({ treats: 3 });
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
      HTMLCanvasElement.prototype.requestPointerLock = function () { el = this; changed(); return Promise.resolve(); };
      Document.prototype.exitPointerLock = function () { el = null; changed(); };
    });
  });

  const isLocked = page => page.evaluate(() => document.pointerLockElement === document.getElementById('gl'));
  // Dispatches pointer events on the canvas; returns how much the camera yaw changed.
  const turn = (page, events) => page.evaluate(evs => {
    const c = document.getElementById('gl'), y0 = window.__joyride.state().yaw;
    for (const [type, init] of evs) c.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, ...init }));
    return window.__joyride.state().yaw - y0;
  }, events);

  test('a mouse Start locks the pointer, and the mouse turns the camera with no button held', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await expect.poll(() => isLocked(page)).toBe(true);
    const d = await turn(page, [['pointermove', { pointerId: 1, pointerType: 'mouse', movementX: 50 }]]);
    expect(d).toBeCloseTo(50 * 0.4 * 0.006, 5);                     // LOCK_K and the look rate in src/game/main.ts
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
      ['pointermove', { pointerId: 1, pointerType: 'mouse', movementX: 0, clientX: 640, clientY: 360 }],   // a locked mouse move in between
      ['pointermove', { ...touch, clientX: 400, clientY: 300, movementX: 100 }],
      ['pointerup', { ...touch, clientX: 400, clientY: 300 }]
    ]);
    expect(d).toBeCloseTo(100 * 0.006, 5);
    expect(await isLocked(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('the kiosk menu frees the cursor, a click beside it keeps it free, and closing it locks again', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    await expect.poll(() => isLocked(page)).toBe(true);

    await page.keyboard.down('KeyA');                                   // the kiosk is to the left, as in the treats test
    await expect.poll(async () => page.locator('#prompt').textContent(), { intervals: [50] }).toBe('EHandla i kiosken');
    await page.keyboard.up('KeyA');
    await page.keyboard.press('KeyE');
    await expect(page.locator('#kmenu')).toBeVisible();
    expect(await isLocked(page)).toBe(false);

    await page.mouse.click(20, 300);                                    // on the game, beside the menu
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
