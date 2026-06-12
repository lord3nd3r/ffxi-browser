import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--in-process-gpu','--window-size=1280,800'],
  defaultViewport: { width: 1280, height: 800 } });
const pg = await b.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto('http://localhost:4399/', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 2500));
await pg.evaluate(() => { localStorage.clear();
  const btn = [...document.querySelectorAll('#dlg-opts .btn')].find(x => /Begin|Continue/.test(x.textContent));
  if (btn) btn.click(); });
await new Promise(r => setTimeout(r, 2500));
await pg.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 300));
await pg.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 300));
await pg.evaluate(() => {
  window.__game.recruitCompanion('Garrick');
  window.__game.recruitCompanion('Lina');
  const S = window.__S;
  S.time = 11;
  // stand the party on the beach looking out over the sea, like the reference
  
  let i = 0;
  for (const c of S.party.slice(1)) {
    c.mesh.position.set(52 + i * 2.5, 0, 46 + (i % 2) * 2); 
    c.mesh.position.y = S.heightAt(c.mesh.position.x, c.mesh.position.z);
    c.dest = null; i++;
  }
  S.camYaw = 0.6;            // camera south of the party, facing the ocean
  S.camPitch = 0.1; S.camDist = 9; S.player.mesh.position.set(50, S.heightAt(50, 44), 44);
});
await new Promise(r => setTimeout(r, 1200));
await pg.screenshot({ path: '/tmp/forest.png' });
console.log('errors:', errs.length ? errs.slice(0,4) : 'none');
await b.close();
