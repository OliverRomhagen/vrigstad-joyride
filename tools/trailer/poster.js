// Renders media/poster.png (2000x3000, portrait) from a staged chase in the real game, with the title set over it.
const path = require('path');
const fs = require('fs');
const { open, ROOT } = require('./rig');

(async () => {
  const { browser, page } = await open({ width: 1000, height: 1500, scale: 2 });
  await page.evaluate(() => { const G = __G, X = __X;
    X.chase('volvo', '#7a2530', 236, [8, 13.5, 19], 33); X.mode('cine'); X.bars(false); X.fov(50);
    X.setCam(X.rigFront(10.5, 2.0, 1.5, 9, 0, -2.6)); __step(6);
    const css = document.createElement('style');
    css.textContent = `
    #gl { filter: saturate(1.18) contrast(1.06); }
    #po { position: absolute; inset: 0; z-index: 60; color: #f4f1e6; font-family: var(--display); text-align: center; text-transform: uppercase; }
    #po .sky { position: absolute; inset: 0 0 auto 0; height: 34%; background: linear-gradient(to bottom, rgba(14,32,48,.82), rgba(14,32,48,0)); }
    #po .ground { position: absolute; inset: auto 0 0 0; height: 50%; background: linear-gradient(to top, #0b0f0e 0%, rgba(11,15,14,.97) 42%, rgba(11,15,14,.55) 72%, rgba(11,15,14,0) 100%); }
    #po .top { position: absolute; top: 5.2%; left: 0; right: 0; }
    #po .top small { display: block; font: 500 21px var(--body); letter-spacing: .3em; color: #f2c230; }
    #po .top b { display: block; margin-top: 14px; font-weight: 700; font-size: 64px; letter-spacing: .05em; line-height: 1; text-shadow: 0 3px 18px rgba(0,0,0,.35); }
    #po .bot { position: absolute; bottom: 4.2%; left: 0; right: 0; }
    #po h1 { margin: 0; font-weight: 700; font-size: 208px; line-height: .84; letter-spacing: .005em; }
    #po h1 span { display: block; color: #f2c230; }
    #po .rule { width: 150px; height: 7px; background: #f2c230; margin: 34px auto 0; }
    #po .facts { margin-top: 28px; font-weight: 600; font-size: 27px; letter-spacing: .13em; }
    #po .facts i { font-style: normal; color: #f2c230; padding: 0 .5em; }
    #po .play { margin-top: 22px; font: 500 21px var(--body); letter-spacing: .2em; color: rgba(244,241,230,.82); }
    #po .play u { text-decoration: none; text-transform: none; letter-spacing: .05em; color: #f4f1e6; }
    #po .fine { margin-top: 18px; font: 400 13px var(--body); letter-spacing: .08em; text-transform: none; color: rgba(244,241,230,.45); }`;
    document.head.appendChild(css);
    const po = document.createElement('div'); po.id = 'po';
    po.innerHTML = `<div class="sky"></div><div class="ground"></div>
      <div class="top"><small>Småland, Sweden · 57.3555° N</small><b>Nothing ever<br>happens here</b></div>
      <div class="bot"><h1>Vrigstad <span>Joyride</span></h1><div class="rule"></div>
        <div class="facts">881 buildings<i>·</i>Every real street<i>·</i>One borrowed Volvo 240</div>
        <div class="play">Play it free in your browser &nbsp;—&nbsp; <u>oliverromhagen.github.io/vrigstad-joyride</u></div>
        <div class="fine">Map data © OpenStreetMap contributors. Elevation: Mapzen terrain tiles.</div></div>`;
    document.getElementById('stage').appendChild(po);
    __step(1); });
  const out = path.join(ROOT, 'media', 'poster.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, type: 'png' });
  await browser.close();
  console.log(out, (fs.statSync(out).size / 1e6).toFixed(1) + ' MB');
})().catch(e => { console.error(e); process.exit(1); });
