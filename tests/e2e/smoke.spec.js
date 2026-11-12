// Smoke tests for the built pages. They assert on the DOM and on the window.__joyride test hook, never on pixels:
// headless WebGL output varies between machines. The screenshots are attached for humans to look at.
import { test, expect } from '@playwright/test';

// Collects console errors and uncaught exceptions from the moment the page starts loading.
function watchErrors(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
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

test.describe('game (index.html)', () => {
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

    // With the camera as Start leaves it, the parked Volvo is about 7 m to the player's right.
    await page.keyboard.down('KeyD');
    await expect(page.locator('#prompt')).toHaveText('ESteal the Volvo 240');
    await page.keyboard.up('KeyD');
    await page.keyboard.press('KeyE');

    await expect(page.locator('#speed')).toBeVisible();
    await expect(page.locator('#carname')).toHaveText('Volvo 240');
    expect(await state(page)).toMatchObject({ inCar: true, car: 'volvo' });
    await page.screenshot({ path: testInfo.outputPath('game-in-volvo.png') });
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
