import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--in-process-gpu','--window-size=1280,800'],
  defaultViewport: { width: 1280, height: 800 } });
const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.goto('http://localhost:4399/', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 2500));
await pg.evaluate(() => { localStorage.clear();
  const btn = [...document.querySelectorAll('#dlg-opts .btn')].find(x => /Begin|Continue/.test(x.textContent));
  // pick WHM job if char-create offers it
  const whm = [...document.querySelectorAll('.cc-job')].find(x => x.dataset.job === 'WHM'); if (whm) whm.click();
  if (btn) btn.click(); });
await new Promise(r => setTimeout(r, 2500));
await pg.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 300));
await pg.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 300));
await pg.evaluate(() => { window.__S.time = 11; });
await new Promise(r => setTimeout(r, 500));
await pg.screenshot({ path: '/tmp/allies.png' });
await pg.keyboard.press('KeyM'); await new Promise(r => setTimeout(r, 500));
await pg.screenshot({ path: '/tmp/book.png' });
console.log('errors:', errs.length ? errs.slice(0,5) : 'none');
await b.close();
