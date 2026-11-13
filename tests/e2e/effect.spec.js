import {test,expect} from '@playwright/test';
test('scene finish ?grain=off',async({page})=>{await page.goto('/index.html?grain=off');await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().visual)).toMatchObject({enabled:false,targets:0,framebufferTextures:0,fullscreenPasses:0})});
test('scene finish ?grain=0',async({page})=>{await page.goto('/index.html?grain=0');await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().visual)).toMatchObject({enabled:false,targets:0,framebufferTextures:0,fullscreenPasses:0})});
test('scene finish ?grain=subtle',async({page})=>{await page.goto('/index.html?grain=subtle');await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().visual)).toMatchObject({enabled:true,targets:0,framebufferTextures:1,fullscreenPasses:1})});
test('scene finish ?grain=1.2',async({page})=>{await page.goto('/index.html?grain=1.2');await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().visual)).toMatchObject({enabled:true,targets:0,framebufferTextures:1,fullscreenPasses:1})});

test('enabled scene finish follows drawing-buffer resize',async({page})=>{
 await page.goto('/index.html?grain=subtle');
 await page.setViewportSize({width:800,height:600});
 await expect.poll(()=>page.evaluate(()=>{const c=document.querySelector('#gl'),s=window.__joyride?.state().visual;return !!s&&s.width===c.width&&s.height===c.height})).toBe(true);
});
