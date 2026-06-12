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
// teleport to a hare, fight, drink a potion -> populate the battle log
await page.evaluate(() => {
  const S = window.__S, g = window.__game;
  S.time = 10.5;
  const m = S.monsters.filter(m => m.alive).sort((a, b) =>
    Math.hypot(a.pos.x - S.player.pos.x, a.pos.z - S.player.pos.z) - Math.hypot(b.pos.x - S.player.pos.x, b.pos.z - S.player.pos.z))[0];
  S.player.mesh.position.set(m.pos.x + 1.5, S.heightAt(m.pos.x + 1.5, m.pos.z), m.pos.z);
  g.setTarget(m);
});
await new Promise(r => setTimeout(r, 22000));
await page.evaluate(() => window.__game.useConsumable('potion'));
await new Promise(r => setTimeout(r, 800));
const logs = await page.evaluate(() => ({
  battle: [...document.querySelectorAll('#battlelog div')].slice(-10).map(d => d.className + ' | ' + d.textContent),
  chat: [...document.querySelectorAll('#log div')].slice(-4).map(d => d.className + ' | ' + d.textContent),
}));
console.log(JSON.stringify(logs, null, 1));
await page.screenshot({ path: '/tmp/ffxi-logs.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
