import {test,expect} from '@playwright/test';
import {watchErrors} from './render-helpers.js';
test('a failed GLB remains an explicitly failed procedural fallback',async({page})=>{
 await page.route('**/media/vehicles/micra-k11.glb',route=>route.abort());
 await page.goto('/index.html?vehicle=micra-k11');
 await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().vehicle?.status)).toBe('failed');
 expect(await page.evaluate(()=>window.__joyride.state().vehicle)).toMatchObject({fallback:true,detailed:false,wheels:[]});
});
test('the default fleet is enabled without URL parameters',async({page})=>{
 const errors=watchErrors(page);await page.setViewportSize({width:640,height:360});await page.goto('/index.html');
 await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().vehicle?.detailed)).toBe(true);
 const s=await page.evaluate(()=>window.__joyride.state());expect(s.vehicle.id).toBe('volvo240');expect(s.traffic.length).toBeGreaterThan(0);
 const expected={volvo:['volvo240','impala1970'],saab:['saab900','xc70','micra-k11'],epa:['duett-epa']};
 for(const c of s.traffic)expect(expected[c.type]??[null]).toContain(c.vehicle?.id??null);
 await expect(page.getByRole('link',{name:'CC BY 4.0'})).toBeVisible();
 const notice=await page.request.get('/media/vehicles/NOTICE.txt');expect(notice.ok()).toBe(true);expect(await notice.text()).toContain('Vehicle models by Axel Tidehorn');
 expect(errors).toEqual([]);
});
