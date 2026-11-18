import { test, expect } from '@playwright/test';
import { watchErrors } from './render-helpers.js';

const layer = page => page.locator('#iso800-grain');
async function expectCoverage(page) {
  const viewport = page.viewportSize();
  expect(await layer(page).boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
  expect(await layer(page).getAttribute('aria-hidden')).toBe('true');
  expect(await layer(page).evaluate(element => {
    const style = getComputedStyle(element);
    return { pointerEvents: style.pointerEvents, blend: style.mixBlendMode, animation: style.animationName, parent: element.parentElement.tagName };
  })).toEqual({ pointerEvents: 'none', blend: 'soft-light', animation: 'none', parent: 'BODY' });
  // Temporarily hit-test the final layer to prove it is above actual UI/canvas,
  // then restore pointer transparency before performing any interactions.
  expect(await page.evaluate(() => {
    const grain = document.querySelector('#iso800-grain');
    grain.style.pointerEvents = 'auto';
    try {
      return ['#gl', '#mini', '#card', '#go'].every(selector => {
        const box = document.querySelector(selector).getBoundingClientRect();
        const x = Math.max(1, Math.min(innerWidth - 1, box.x + box.width / 2));
        const y = Math.max(1, Math.min(innerHeight - 1, box.y + box.height / 2));
        return document.elementFromPoint(x, y) === grain;
      });
    } finally { grain.style.pointerEvents = 'none'; }
  })).toBe(true);
}

test('grain covers canvas and UI, boils through resize, and preserves mouse/keyboard input', async ({ page }, info) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => { HTMLCanvasElement.prototype.requestPointerLock = undefined; });
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/index.html?grain=on');
  await expect(layer(page)).toBeVisible();
  await expectCoverage(page);
  const texture = await layer(page).evaluate(element => element.style.backgroundImage);
  const position = await layer(page).evaluate(element => getComputedStyle(element).backgroundPosition);
  await expect.poll(() => layer(page).evaluate(element => getComputedStyle(element).backgroundPosition)).not.toBe(position);
  expect(await layer(page).evaluate(element => element.getAnimations().length)).toBe(1);
  await page.setViewportSize({ width: 640, height: 480 });
  await expectCoverage(page);
  expect(await layer(page).evaluate(element => element.style.backgroundImage)).toBe(texture);
  await page.screenshot({ path: info.outputPath('iso800-menu.png') });
  await page.locator('#go').click();
  await expect(page.locator('#intro')).toBeHidden();
  const before = await page.evaluate(() => window.__joyride.state());
  await page.keyboard.down('KeyW');
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__joyride.state());
    return Math.hypot(state.x - before.x, state.z - before.z);
  }).toBeGreaterThan(0.5);
  await page.keyboard.up('KeyW');
  // standing still, the grain keeps boiling at a third of the rate rather than freezing
  await expect.poll(() => layer(page).evaluate(element => element.getAnimations()[0].playbackRate)).toBeCloseTo(1 / 3);
  const stopped = await layer(page).evaluate(element => element.getAnimations()[0].currentTime);
  await expect.poll(() => layer(page).evaluate(element => element.getAnimations()[0].currentTime)).toBeGreaterThan(stopped);
  await page.mouse.move(300, 250); await page.mouse.down();
  await page.mouse.move(380, 250, { steps: 3 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__joyride.state().yaw)).not.toBe(before.yaw);
  await expectCoverage(page);
  expect(await layer(page).evaluate(element => element.style.backgroundImage)).toBe(texture);
  await page.screenshot({ path: info.outputPath('iso800-game.png') });
  expect(errors).toEqual([]);
});

test('grain=off allocates no overlay and preserves Start', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/index.html?grain=off');
  await expect(page.locator('#go')).toBeVisible();
  await expect(layer(page)).toHaveCount(0);
  await page.locator('#go').click();
  await expect(page.locator('#intro')).toBeHidden();
  expect(errors).toEqual([]);
});

test('grain is absent by default and reduced motion keeps an enabled texture static', async ({ page }) => {
  await page.goto('/index.html');
  await expect(layer(page)).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/index.html?grain=on');
  await expect(layer(page)).toBeVisible();
  expect(await layer(page).evaluate(element => element.getAnimations().length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => layer(page).evaluate(element => element.getAnimations().length)).toBe(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => layer(page).evaluate(element => element.getAnimations().length)).toBe(0);
});

test('grain keeps CSS-pixel scale and touch controls on a high-DPR viewport', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage(), errors = watchErrors(page);
    await page.goto('/index.html?grain=on');
    await expect(layer(page)).toBeVisible();
    await expectCoverage(page);
    expect(await layer(page).evaluate(element => getComputedStyle(element).backgroundSize)).toMatch(/^256px 256px,/);
    await page.locator('#go').tap();
    await expect(page.locator('#intro')).toBeHidden();
    await expect(page.locator('#joy')).toBeVisible();
    await page.locator('#p-brake').tap();
    await expect.poll(() => page.evaluate(() => window.__joyride.state().y)).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath('iso800-touch.png') });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
