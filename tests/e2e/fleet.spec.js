import {test,expect} from '@playwright/test';
test('a failed GLB remains an explicitly failed procedural fallback',async({page})=>{
 await page.route('**/media/vehicles/micra-k11.glb',route=>route.abort());
 await page.goto('/index.html?vehicle=micra-k11');
 await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().vehicle?.status)).toBe('failed');
 expect(await page.evaluate(()=>window.__joyride.state().vehicle)).toMatchObject({fallback:true,detailed:false,wheels:[]});
});
