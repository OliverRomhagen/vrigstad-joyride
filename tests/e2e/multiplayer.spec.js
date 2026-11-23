// The two-tab multiplayer prototype (?lab=multiplayer, docs/multiplayer.md): two pages of one browser see each other.
import { expect, test } from '@playwright/test';
import { watchErrors } from './render-helpers.js';

const state = page => page.evaluate(() => window.__joyride.state());

test('two tabs in one room show each other, on foot and in a car', async ({ context }, info) => {
  test.setTimeout(120_000);
  const room = 'test-' + info.workerIndex + '-' + Date.now();
  const pages = [await context.newPage(), await context.newPage()];
  const errors = pages.map(watchErrors);
  for (const page of pages) {
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto('/index.html?lab=multiplayer&room=' + room);
    await page.waitForFunction(() => window.__joyride);
    await page.locator('#go').click();
  }
  const [a, b] = pages;
  const carCount = (await state(b)).carCount;
  for (const page of pages) await expect.poll(async () => (await state(page)).remotePlayers).toBe(1);

  // a walks to the parked car beside Torget and gets in; b keeps showing one remote player through the change
  await a.bringToFront();
  await a.keyboard.down('KeyD');
  await expect.poll(async () => (await state(a)).near, { intervals: [50] }).not.toBeNull();
  await a.keyboard.up('KeyD');
  await a.waitForTimeout(400); // let b catch up: it draws a a little in the past
  await info.attach('tab-b-sees-tab-a-on-foot', {
    body: await b.screenshot({ path: info.outputPath('tab-b-sees-tab-a-on-foot.png') }),
    contentType: 'image/png',
  });
  await a.keyboard.press('KeyE');
  await expect.poll(async () => (await state(a)).inCar).toBe(true);
  await a.keyboard.down('KeyW');
  await a.waitForTimeout(1500);
  await a.keyboard.up('KeyW');
  expect((await state(b)).remotePlayers).toBe(1);
  // the car a drives is the same car in b: b moves its own one, and has no car more than before
  await expect.poll(async () => (await state(b)).remoteCars.length).toBe(1);
  await a.waitForTimeout(600); // a's car has stopped, and b has caught up
  const [at, seen] = [await state(a), await state(b)];
  expect(seen.carCount).toBe(carCount);
  expect(Math.hypot(seen.remoteCars[0].x - at.x, seen.remoteCars[0].z - at.z)).toBeLessThan(1);
  await info.attach('tab-b-sees-tab-a', {
    body: await b.screenshot({ path: info.outputPath('tab-b-sees-tab-a.png') }),
    contentType: 'image/png',
  });

  // a closed tab leaves the others' world
  await a.close();
  await expect.poll(async () => (await state(b)).remotePlayers).toBe(0);
  expect(await state(b)).toMatchObject({ remoteCars: [], carCount }); // the car stays, with nobody in it
  expect(errors.flat()).toEqual([]);
});
