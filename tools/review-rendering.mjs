// Vite transforms apply only to a disposable capture build; production stays read-only.
import {build} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=process.cwd(),kind=process.env.REVIEW_KIND||'grain',port=Number(process.env.REVIEW_PORT)||8810;
const out=path.join(root,'docs/review-r187'),buildOut=path.join(root,'work/review-build');
fs.mkdirSync(out,{recursive:true});
const baseline=kind==='baseline',isDay=kind==='daylight',isGrade=kind==='grades';
const draw=baseline||isDay?'renderer.render(scene, camera);':'sceneFinish.render();';
const result={kind,base:'4a8be71bfe38aadcd5fdc07e6fe2df5aa5702be4',viewport:[960,540],errors:[],captures:[],notes:'Chromium SwiftShader, full production shadows/ground, one fixed seeded world; browser-only uniform/clock/camera hooks in a disposable Vite build.'};
await build({plugins:[{name:'review-only',enforce:'pre',transform(code,id){
 if(id.endsWith('/render/photographic-grain.ts'))return code.replace('return createSceneFinish',`window.__setReviewGrain=value=>{uniforms.uStrength.value=value;window.__reviewOff=value==='off'};return createSceneFinish`);
 if(id.endsWith('/render/photographic-grades.ts'))return code.replace('return createSceneFinish',`window.__setReviewGrade=name=>{window.__reviewOff=name==='off';if(name==='identity'){for(const [key,u] of Object.entries(uniforms)){if(key==='uScene')continue;if(u.value?.isVector3)u.value.set(0,0,0);else u.value=0}uniforms.uCurve.value.set(0,1,0);uniforms.uSaturation.value=1;return}const p=FILM_PRESETS[name]||FILM_PRESETS.negative;for(const key of ['curve','shadow','highlight','mid','green','blue','red','yellow','cyan'])uniforms['u'+key[0].toUpperCase()+key.slice(1)].value.fromArray(p[key]);for(const key of ['shoulder','greenMix','saturation','neutral'])uniforms['u'+key[0].toUpperCase()+key.slice(1)].value=p[key]};return createSceneFinish`);
 if(!id.endsWith('/game/main.ts'))return;
 code=code.replaceAll('requestAnimationFrame(frame)','window.__queue(frame)').replace('let last = performance.now();','let last = 0;').replace('  '+draw,'  /* explicit review render */');
 const api=`window.__review={
 pose(){camera.position.set(24,hAt(24,-15)+6,-15);camera.lookAt(-30,hAt(-30,50)+4,50);sun.target.position.set(0,hAt(0,0),0);${isDay?'daylight.update(0);streetLighting.update(0,daylight.getHour(),daylight.getSolarElevation());':''}dome.position.copy(camera.position)},
 render(){dome.position.copy(camera.position);if(window.__reviewOff)renderer.render(scene,camera);else ${draw}},
 state(){const gl=renderer.getContext();return {camera:camera.position.toArray(),quaternion:camera.quaternion.toArray(),world:cars.map(c=>[c.type,c.x,c.z]),sun:sun.intensity,exposure:renderer.toneMappingExposure,version:THREE.REVISION,outputColorSpace:renderer.outputColorSpace,colorManagement:THREE.ColorManagement.enabled,toneMapping:renderer.toneMapping,canvasAA:gl.getContextAttributes().antialias,glError:gl.getError(),...window.__joyride.state()}},
 conditions(time){const h=scene.children.find(o=>o.isHemisphereLight);SUN_DIR.set(-.55,.75,.37).normalize();sun.color.copy(col(0xfff4dd));sun.intensity=.95*LEGACY_LIGHT;h.intensity=.62*LEGACY_LIGHT;dome.material.uniforms.top.value.set(0x5f97c9);dome.material.uniforms.hor.value.set(0xd6e4e6);dome.material.uniforms.sunC.value.set(0xfff1d0);if(time==='sunset'){SUN_DIR.set(-.85,.18,.49).normalize();sun.color.copy(col(0xff9b48));sun.intensity=.50*LEGACY_LIGHT;h.intensity=.30*LEGACY_LIGHT;dome.material.uniforms.top.value.set(0xa37583);dome.material.uniforms.hor.value.set(0xd69f7c)}if(time==='night'){sun.intensity=0;h.intensity=.10*LEGACY_LIGHT;dome.material.uniforms.top.value.set(0x101e32);dome.material.uniforms.hor.value.set(0x1d3046);dome.material.uniforms.sunC.value.set(0x000000)}sun.position.copy(sun.target.position).addScaledVector(SUN_DIR,400);scene.fog.color.copy(dome.material.uniforms.hor.value)},
 async measure(){const gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');let q;if(ext){q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q)}renderer.info.autoReset=false;renderer.info.reset();this.render();const calls=renderer.info.render.calls,triangles=renderer.info.render.triangles;renderer.info.autoReset=true;if(ext)gl.endQuery(ext.TIME_ELAPSED_EXT);let gpuMs=null,disjoint=null;if(ext){const start=performance.now();while(!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)){if(performance.now()-start>120000)throw Error('GPU timer timeout');await new Promise(r=>setTimeout(r,20))}disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);gpuMs=disjoint?null:gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6;gl.deleteQuery(q)}return {gpuMs,disjoint,calls,triangles}}
 };`;
 return code.replace('resize(); window.__queue(frame);',api+'resize(); window.__queue(frame);');
 }}],build:{outDir:buildOut,emptyOutDir:true,rollupOptions:{input:path.join(root,'src/index.html')}}});
const server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{cwd:buildOut,stdio:'ignore'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:960,height:540}}),cdp=await page.context().newCDPSession(page);
 page.on('pageerror',e=>result.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')result.errors.push(m.text())});
 await page.route('**/favicon.ico',r=>r.fulfill({status:204,body:''}));
 await page.addInitScript(()=>{let cb,n=0;window.__queue=f=>cb=f;window.__step=count=>{for(let i=0;i<count;i++){n++;cb(n*1000/60)}}});
 await page.goto(`http://127.0.0.1:${port}/index.html`+(isDay?'?dev=lighting&time=13&date=2026-08-15':isGrade?'?film=negative':baseline?'':'?grain=subtle'),{waitUntil:'load',timeout:300000});
 await page.locator('#go').evaluate(e=>e.click());await page.evaluate(()=>{window.__step(12);window.__review.pose()});
 async function shot(name){await page.evaluate(()=>window.__review.render());const png=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(png.data,'base64'));const state=await page.evaluate(()=>window.__review.state());result.captures.push({name,state});console.log(name);save()}
 function save(){fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n')}
 if(baseline||isGrade){for(const time of ['day','sunset','night']){await page.evaluate(t=>window.__review.conditions(t),time);for(const p of baseline?['baseline']:['off','identity','chrome','negative','gold','portra']){if(!baseline)await page.evaluate(p=>window.__setReviewGrade(p),p);await shot(time+'-'+p)}}}
 else if(kind==='grain'){
  const values={direct:'off',identity:0,subtle:.62,strong:1.35};
  for(const [name,value]of Object.entries(values)){await page.evaluate(v=>window.__setReviewGrain(v),value);await shot(name)}
  result.measurements=[];
  // Warm each path; rotate order to reduce (not eliminate) cache/order bias.
  for(const value of Object.values(values)){await page.evaluate(v=>window.__setReviewGrain(v),value);await page.evaluate(()=>window.__review.measure())}
  for(let round=0;round<4;round++){const keys=Object.keys(values);for(let i=0;i<4;i++){const name=keys[(i+round)%4];await page.evaluate(v=>window.__setReviewGrain(v),values[name]);result.measurements.push({round,name,...await page.evaluate(()=>window.__review.measure())});save()}}
 } else if(isDay){
  async function control(id,value,event='input'){await page.locator('#lab-'+id).evaluate((e,{value,event})=>{e.value=value;e.dispatchEvent(new Event(event,{bubbles:true}))},{value,event});await page.evaluate(()=>window.__review.pose())}
  await page.locator('#visual-lab').evaluate(e=>e.open=false);
  for(const hour of [13,17,19,20.5,22]){await control('time',hour);await shot('time-'+hour)}
  for(const date of ['2026-06-21','2026-12-21']){await control('date',date,'change');await control('time',13);await shot(date)}
  await control('time',22);for(const mode of ['off','on']){await control('street',mode,'change');await shot('street-'+mode)}
  await page.locator('#visual-lab').evaluate(e=>e.open=true);await page.locator('#lab-time').focus();const before=await page.evaluate(()=>window.__joyride.state());await page.keyboard.down('w');await page.evaluate(()=>window.__step(10));await page.keyboard.up('w');const after=await page.evaluate(()=>window.__joyride.state());result.panelBlocksDriving=before.x===after.x&&before.z===after.z;
 }
 if(result.errors.length)throw Error(result.errors.join('\n'));
 if(result.captures.some(c=>c.state.glError!==0))throw Error('WebGL error in capture');
}finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');await browser.close();server.kill()}
