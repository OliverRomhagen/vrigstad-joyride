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

const hasWebGL = page => page.evaluate(() => {
  const gl = document.getElementById('gl');
  return !!(gl.getContext('webgl2') || gl.getContext('webgl'));
});

test.describe('game (index.html)', () => {
  test('loads with no console errors and a WebGL canvas', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await expect(page.locator('#intro')).toBeVisible();
    await expect(page.locator('#fail')).toBeHidden();
    expect(await hasWebGL(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('game.png') });
    expect(errors).toEqual([]);
  });

  test('Start hides the intro and shows the HUD', async ({ page }) => {
    await page.goto('/index.html');
    await page.locator('#go').click();
    await expect(page.locator('#intro')).toBeHidden();
    await expect(page.locator('#street')).toContainText('Torget');
    await expect(page.locator('#stars')).toHaveText('★★★');
    await expect(page.locator('#stars b')).toHaveCount(0);       // <b> is a lit star: none when not wanted
    await expect(page.locator('#mini')).toBeVisible();
  });

  test('W moves the player, and E next to the parked Volvo gets you in', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await page.locator('#go').click();
    const state = () => page.evaluate(() => window.__joyride.state());
    const from = await state();
    expect(from).toMatchObject({ started: true, inCar: false, car: null });

    await page.keyboard.down('KeyW');
    await expect.poll(async () => { const s = await state(); return Math.hypot(s.x - from.x, s.z - from.z); }).toBeGreaterThan(1);
    await page.keyboard.up('KeyW');
    await page.keyboard.press('KeyR');                            // back to the spawn point at Torget

    // With the camera as Start leaves it, the parked Volvo is about 7 m to the player's right.
    await page.keyboard.down('KeyD');
    await expect(page.locator('#prompt')).toHaveText('ESteal the Volvo 240');
    await page.keyboard.up('KeyD');
    await page.keyboard.press('KeyE');

    await expect(page.locator('#speed')).toBeVisible();
    await expect(page.locator('#carname')).toHaveText('Volvo 240');
    expect(await state()).toMatchObject({ inCar: true, car: 'volvo' });
    await page.screenshot({ path: testInfo.outputPath('game-in-volvo.png') });
    expect(errors).toEqual([]);
  });
});

test.describe('map (map.html)', () => {
  test('loads with no console errors and a WebGL canvas', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto('/map.html');
    await page.waitForLoadState('load');
    expect(await hasWebGL(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('map.png') });
    expect(errors).toEqual([]);
  });
});
