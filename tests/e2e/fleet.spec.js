import { expect, test } from '@playwright/test';
import { watchErrors } from './render-helpers.js';

// Not the default Volvo, so this fails if ?vehicle= is ignored.
test('?vehicle= loads and selects a model other than the default', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/index.html?vehicle=saab900');
  await expect.poll(() => page.evaluate(() => window.__joyride?.state().vehicle?.status)).toBe('loaded');
  expect(await page.evaluate(() => window.__joyride.state().vehicle)).toMatchObject({ id: 'saab900', detailed: true });
  expect(errors).toEqual([]);
});
test('a failed GLB remains an explicitly failed procedural fallback', async ({ page }) => {
  await page.route('**/media/vehicles/micra-k11.glb', route => route.abort());
  await page.goto('/index.html?vehicle=micra-k11');
  await expect.poll(() => page.evaluate(() => window.__joyride?.state().vehicle?.status)).toBe('failed');
  expect(await page.evaluate(() => window.__joyride.state().vehicle)).toMatchObject({
    fallback: true,
    detailed: false,
    wheels: [],
  });
});
