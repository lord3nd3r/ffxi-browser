// Quick visual check: spawn, close help, take day + character close-up shots.
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--in-process-gpu', '--window-size=1280,800'],
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
await new Promise(r => setTimeout(r, 2500));
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 400));
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 300));
// fix time to late morning for a sunny shot, zoom in a bit
await page.evaluate(() => { window.__S.time = 10.5; window.__S.camDist = 7; window.__S.camPitch = 0.22; });
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: '/tmp/gfx-day.png' });
// close-up of the character
await page.evaluate(() => { window.__S.camDist = 3.4; window.__S.camYaw += 2.6; window.__S.camPitch = 0.1; });
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: '/tmp/gfx-closeup.png' });
// dusk shot
await page.evaluate(() => { window.__S.time = 18.6; window.__S.camDist = 9; });
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: '/tmp/gfx-dusk.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
