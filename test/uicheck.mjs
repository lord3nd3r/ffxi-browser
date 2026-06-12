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
await new Promise(r => setTimeout(r, 2000));
await page.evaluate(() => {
  localStorage.clear();
  const b = [...document.querySelectorAll('#dlg-opts .btn')].find(b => /Begin|Continue/.test(b.textContent));
  if (b) b.click();
});
await new Promise(r => setTimeout(r, 1200));
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 300));
// 1. no overlap between minimap and party by default
const before = await page.evaluate(() => {
  const mm = document.getElementById('minimap-wrap').getBoundingClientRect();
  const pt = document.getElementById('party').getBoundingClientRect();
  return { overlap: !(pt.top >= mm.bottom || pt.bottom <= mm.top || pt.left >= mm.right || pt.right <= mm.left), mmBottom: Math.round(mm.bottom), partyTop: Math.round(pt.top) };
});
console.log('default layout:', JSON.stringify(before));
// 2. drag the minimap to bottom-left and confirm it moves + persists
const mm = await page.$('#minimap-wrap');
const box = await mm.boundingBox();
await page.mouse.move(box.x + 75, box.y + 8);
await page.mouse.down();
await page.mouse.move(150, 500, { steps: 8 });
await page.mouse.up();
const after = await page.evaluate(() => {
  const r = document.getElementById('minimap-wrap').getBoundingClientRect();
  const saved = JSON.parse(localStorage.getItem('vanadiel_ui_layout_v1') || '{}');
  return { x: Math.round(r.left), y: Math.round(r.top), saved: !!saved['minimap-wrap'] };
});
console.log('after drag:', JSON.stringify(after));
await page.screenshot({ path: '/tmp/ui-moved.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
