import {test,expect} from '@playwright/test';
import {watchErrors} from './render-helpers.js';
const ids=['volvo240','saab900','xc70','xc70-police','impala1970','micra-k11','duett-epa'];
for(const id of ids)test(`${id} loads, renders, can be entered and drives`,async({page},info)=>{
 const errors=watchErrors(page);await page.setViewportSize({width:640,height:360});
 await page.goto('/index.html?vehicle='+id);await page.locator('#go').click();
 const state=()=>page.evaluate(()=>window.__joyride.state());
 await expect.poll(async()=>(await state()).vehicle?.status).toBe('loaded');
 await expect.poll(async()=>(await state()).vehicle.detailed).toBe(true);
 expect((await state()).vehicle.wheels).toHaveLength(4);
 await page.keyboard.down('KeyD');await expect.poll(async()=>(await state()).near,{intervals:[50]}).not.toBeNull();await page.keyboard.up('KeyD');
 await page.keyboard.press('KeyE');await expect.poll(async()=>(await state()).inCar).toBe(true);
 if(id==='micra-k11')await expect(page.locator('#toast')).toContainText('Nissan Micra K11');
 if(id==='impala1970')await expect(page.locator('#toast')).toContainText('Chevrolet Impala 1970 hardtop');
 const before=await state();await page.keyboard.down('KeyW');await page.keyboard.down('KeyD');
 await expect.poll(async()=>(await state()).vehicle.wheels.slice(0,2).some(w=>Math.abs(w.steer)>0.001)).toBe(true);
 await expect.poll(async()=>{const s=await state();return Math.hypot(s.x-before.x,s.z-before.z);}).toBeGreaterThan(2);
 await page.keyboard.up('KeyW');await page.keyboard.up('KeyD');
 const after=await state();expect(after.vehicle.wheels.some(w=>Math.abs(w.spin)>0.1)).toBe(true);
 expect(after.vehicle.wheels.slice(2).every(w=>w.steer===0)).toBe(true);
 expect(await page.evaluate(()=>document.querySelector('#gl').getContext('webgl2').getError())).toBe(0);
 await page.screenshot({path:info.outputPath(id+'.png')});expect(errors).toEqual([]);
});
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
 const expected={volvo:'volvo240',saab:'saab900',epa:'duett-epa'};
 for(const c of s.traffic)expect(c.vehicle?.id??null).toBe(expected[c.type]??null);
 await expect(page.getByRole('link',{name:'CC BY 4.0'})).toBeVisible();
 const notice=await page.request.get('/media/vehicles/NOTICE.txt');expect(notice.ok()).toBe(true);expect(await notice.text()).toContain('Vehicle models by Axel Tidehorn');
 expect(errors).toEqual([]);
});
