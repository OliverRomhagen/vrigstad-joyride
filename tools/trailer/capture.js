// Renders shots to .work/frames/<shot>/0000.jpg and records per-frame game events in .work/meta.json.
// Usage: node capture.js [shot-name-prefix ...]   (no arguments renders every shot)
const fs = require('fs');
const path = require('path');
const { open, modelsReady, WORK } = require('./rig');
const shots = require('./shots');

(async () => {
  const want = process.argv.slice(2), metaFile = path.join(WORK, 'meta.json');
  fs.mkdirSync(WORK, { recursive: true });
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
  for (const s of shots) {
    if (want.length && !want.some(w => s.name.startsWith(w))) continue;
    const dir = path.join(WORK, 'frames', s.name);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const t0 = Date.now(), { browser, page } = await open(), ev = {};
    await page.evaluate(s.setup);
    await modelsReady(page);
    for (let i = 0; i < s.n; i++) {
      const st = await page.evaluate((i, n) => { window.__frame(i, n); window.__step(1);
        return { busted: !document.getElementById('title-card').hidden, stars: window.__G.wanted.stars, toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent }; }, i, s.n);
      if (st.busted && ev.busted == null) ev.busted = i;
      if (st.stars > 0) ev.wanted = i; else if (ev.wanted != null && ev.cleared == null && !st.busted) ev.cleared = i;
      if (st.toast && st.toast !== ev.lastToast) { (ev.toasts = ev.toasts || []).push([i, st.toast]); } ev.lastToast = st.toast;
      await page.screenshot({ path: path.join(dir, String(i).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 93, optimizeForSpeed: true });
    }
    await browser.close();
    delete ev.lastToast; meta[s.name] = ev;
    console.log(s.name, s.n, 'frames', ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(ev));
  }
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
