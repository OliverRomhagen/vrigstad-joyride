import {test,expect} from '@playwright/test';
test('scene finish default',async({page})=>{await page.goto('/index.html');await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().visual)).toMatchObject({enabled:false,targets:0,framebufferTextures:0,fullscreenPasses:0})});
test('scene finish ?film=off',async({page})=>{await page.goto('/index.html?film=off');await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().visual)).toMatchObject({enabled:false,targets:0,framebufferTextures:0,fullscreenPasses:0})});
test('scene finish ?film=unknown',async({page})=>{await page.goto('/index.html?film=unknown');await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().visual)).toMatchObject({enabled:false,targets:0,framebufferTextures:0,fullscreenPasses:0})});
test('scene finish ?film=chrome',async({page})=>{await page.goto('/index.html?film=chrome');await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().visual)).toMatchObject({enabled:true,targets:0,framebufferTextures:1,fullscreenPasses:1})});
test('scene finish ?film=negative',async({page})=>{await page.goto('/index.html?film=negative');await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().visual)).toMatchObject({enabled:true,targets:0,framebufferTextures:1,fullscreenPasses:1})});
test('scene finish ?film=gold',async({page})=>{await page.goto('/index.html?film=gold');await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().visual)).toMatchObject({enabled:true,targets:0,framebufferTextures:1,fullscreenPasses:1})});
test('scene finish ?film=portra',async({page})=>{await page.goto('/index.html?film=portra');await expect.poll(()=>page.evaluate(()=>window.__joyride?.state().visual)).toMatchObject({enabled:true,targets:0,framebufferTextures:1,fullscreenPasses:1})});

test('enabled scene finish follows drawing-buffer resize',async({page})=>{
 await page.goto('/index.html?film=negative');
 await page.setViewportSize({width:800,height:600});
 await expect.poll(()=>page.evaluate(()=>{const c=document.querySelector('#gl'),s=window.__joyride?.state().visual;return !!s&&s.width===c.width&&s.height===c.height})).toBe(true);
});
