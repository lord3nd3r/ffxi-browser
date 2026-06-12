import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--in-process-gpu'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => { if (errors.length < 3) errors.push((e.stack || e.message).split('\n').slice(0, 4).join(' || ')); });
await page.goto('http://localhost:4399/', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 2500));
await page.evaluate(() => {
  localStorage.clear();
  const b = [...document.querySelectorAll('#dlg-opts .btn')].find(b => /Begin|Continue/.test(b.textContent));
  if (b) b.click();
});
await new Promise(r => setTimeout(r, 4000));
console.log(errors.length ? errors.join('\n---\n') : 'no errors');
await browser.close();
