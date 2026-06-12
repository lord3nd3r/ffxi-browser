import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--in-process-gpu'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:4399/', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 2500));
await page.evaluate(() => {
  localStorage.clear();
  const b = [...document.querySelectorAll('#dlg-opts .btn')].find(b => /Begin|Continue/.test(b.textContent));
  if (b) b.click();
});
await new Promise(r => setTimeout(r, 1500));
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 400));
// teleport party to the beach, face the ocean, late morning sun
await page.evaluate(() => {
  const S = window.__S;
  S.time = 10.5;
  S.player.mesh.position.set(-30, S.heightAt(-30, 68), 68);
  for (const c of S.party) if (c.kind === 'companion') {
    c.mesh.position.set(-30 + (Math.random() * 4 - 2), 0, 66 + Math.random() * 2);
    c.mesh.position.y = S.heightAt(c.mesh.position.x, c.mesh.position.z);
  }
  S.camYaw = Math.PI;  // camera south of player, looking north over the sea
  S.camPitch = 0.18; S.camDist = 8;
});
await new Promise(r => setTimeout(r, 1000));
await page.screenshot({ path: '/tmp/beach.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
