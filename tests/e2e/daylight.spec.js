import {test,expect} from '@playwright/test';
test('solar date changes altitude and Visual Lab keeps driving keys',async({page})=>{
 await page.goto('/index.html?dev=lighting&time=13&date=2026-06-21');
 await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().daylight?.elevation)).toBeGreaterThan(54);
 await page.locator('#go').click();
 await page.locator('#lab-date').fill('2026-12-21');
 await page.locator('#lab-date').dispatchEvent('change');
 await expect.poll(()=>page.evaluate(()=>window.__joyride.state().daylight.elevation)).toBeLessThan(10);
 await page.locator('#lab-time').focus();
 const before=await page.evaluate(()=>window.__joyride.state());
 await page.keyboard.down('w');await page.waitForTimeout(300);await page.keyboard.up('w');
 const after=await page.evaluate(()=>window.__joyride.state());
 expect(after.x).toBeCloseTo(before.x,5);expect(after.z).toBeCloseTo(before.z,5);
});
