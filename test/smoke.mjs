// Headless smoke test: loads the game, creates a character, walks, targets a
// monster, fights it, uses the hotbar — and reports any console errors.
import puppeteer from 'puppeteer-core';

const URL = process.env.GAME_URL || 'http://localhost:4399/';
const shot = (p, n) => p.screenshot({ path: `/tmp/game-${n}.png` });

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--in-process-gpu', '--window-size=1280,800'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1500));
await shot(page, '1-charcreate');

// character creation visible?
const dlgVisible = await page.$eval('#dialog', el => el.style.display === 'block');
console.log('char-create dialog visible:', dlgVisible);

// pick BLM job, name, begin
await page.evaluate(() => {
  const job = document.querySelector('.cc-job[data-j="WAR"]');
  if (job) job.click();
});
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('#dlg-opts .btn')];
  const b = btns.find(b => b.textContent.includes('Begin') || b.textContent.includes('Continue'));
  if (b) b.click();
});
await new Promise(r => setTimeout(r, 1200));
// close help dialog
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 500));
await shot(page, '2-ingame');

const state1 = await page.evaluate(() => {
  const log = [...document.querySelectorAll('#log div')].map(d => d.textContent);
  return {
    hud: document.getElementById('job-name').textContent,
    hotbarSlots: document.querySelectorAll('#hotbar .slot').length,
    partyFrames: document.querySelectorAll('.pmember').length,
    logLines: log.length,
    lastLog: log.slice(-3),
  };
});
console.log('state after spawn:', JSON.stringify(state1));

// world sanity
const world = await page.evaluate(() => {
  const S = window.__S;
  return {
    monsters: S.monsters.length, npcs: S.npcs.length, nodes: S.nodes.length,
    playerPos: { x: +S.player.pos.x.toFixed(1), z: +S.player.pos.z.toFixed(1) },
    nearestMon: Math.min(...S.monsters.map(m => Math.hypot(m.pos.x - S.player.pos.x, m.pos.z - S.player.pos.z))).toFixed(1),
  };
});
console.log('world:', JSON.stringify(world));

// walk forward 2s
await page.keyboard.down('KeyW');
await new Promise(r => setTimeout(r, 2000));
await page.keyboard.up('KeyW');
const pos2 = await page.evaluate(() => ({ x: +window.__S.player.pos.x.toFixed(1), z: +window.__S.player.pos.z.toFixed(1) }));
console.log('pos after W:', JSON.stringify(pos2));

// tab target + report
await page.keyboard.press('Tab');
await new Promise(r => setTimeout(r, 300));
const tgt = await page.evaluate(() => ({
  visible: document.getElementById('target-frame').style.display,
  name: document.getElementById('tgt-name').textContent,
  target: window.__S.target ? window.__S.target.name : null,
}));
console.log('tab target:', JSON.stringify(tgt));

// teleport next to the nearest hare (swiftshader is too slow to walk there) and fight
await page.evaluate(() => {
  const S = window.__S;
  const mons = S.monsters.filter(m => m.alive).sort((a, b) =>
    Math.hypot(a.pos.x - S.player.pos.x, a.pos.z - S.player.pos.z) - Math.hypot(b.pos.x - S.player.pos.x, b.pos.z - S.player.pos.z));
  const m = mons[0];
  S.player.mesh.position.set(m.pos.x + 1.5, S.heightAt(m.pos.x + 1.5, m.pos.z), m.pos.z);
});
await page.keyboard.press('Escape');   // clear old target so Tab picks the nearest
await page.keyboard.press('Tab');
const tgt2 = await page.evaluate(() => {
  const S = window.__S;
  return { target: S.target ? S.target.name : null, dist: S.target ? Math.hypot(S.target.pos.x - S.player.pos.x, S.target.pos.z - S.player.pos.z).toFixed(1) : null };
});
console.log('combat target:', JSON.stringify(tgt2));
await new Promise(r => setTimeout(r, 20000));   // let auto-attack & companions fight
await shot(page, '3-combat');

const state2 = await page.evaluate(() => {
  const log = [...document.querySelectorAll('#log div')].map(d => d.textContent);
  return { lastLog: log.slice(-8), hp: document.getElementById('p-hp-txt').textContent, xp: document.getElementById('p-xp-txt').textContent };
});
console.log('state after combat window:', JSON.stringify(state2, null, 1));

// hotbar key (ability) — may log "not ready"/"target" messages, just ensure no crash
await page.keyboard.press('Digit1');
await new Promise(r => setTimeout(r, 1000));

// ---- quest flow: talk to Eustace, accept, slay 4 hares, claim reward ----
const questResult = await page.evaluate(async () => {
  const S = window.__S, g = window.__game;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const eustace = S.npcs.find(n => n.npc.id === 'eustace');
  S.player.mesh.position.set(eustace.pos.x + 1, 0, eustace.pos.z + 1);
  g.requestInteract(eustace);
  await sleep(600);
  const dlgOpen1 = document.getElementById('dialog').style.display === 'block';
  const accept = [...document.querySelectorAll('#dlg-opts .btn')].find(b => b.textContent.includes('Accept'));
  if (accept) accept.click();
  await sleep(300);
  const questActive = S.quests.q_hares && S.quests.q_hares.state === 'active';
  // slay 4 hares
  const hares = S.monsters.filter(m => m.typeId === 'hare' && m.alive).slice(0, 4);
  for (const h of hares) g.applyDamage(h, 99999, S.player);
  await sleep(300);
  const progress = S.quests.q_hares.n;
  const gilBefore = S.gil;
  g.requestInteract(eustace);
  await sleep(600);
  const claim = [...document.querySelectorAll('#dlg-opts .btn')].find(b => b.textContent.includes('Claim'));
  if (claim) claim.click();
  await sleep(300);
  return { dlgOpen1, questActive, progress, rewarded: S.quests.q_hares.state === 'rewarded', gilGain: S.gil - gilBefore, tracker: document.getElementById('tracker').textContent };
});
console.log('quest flow:', JSON.stringify(questResult));

// ---- gathering + crafting + job change ----
const sysResult = await page.evaluate(async () => {
  const S = window.__S, g = window.__game;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // gather a herb node
  const node = S.nodes.find(n => n.type === 'herb');
  S.player.mesh.position.set(node.x + 1, 0, node.z + 1);
  g.requestInteract({ ...node, isNode: true });
  await sleep(8000);          // swiftshader runs game-time ~0.4x real-time
  const herbs = g.countItem('wild_herb');
  // craft potions (need 2 herbs — add one more)
  g.addItem('wild_herb', 2);
  const potBefore = g.countItem('potion');
  g.craftRecipe('r_potion');
  const potGain = g.countItem('potion') - potBefore;
  // job change
  g.changeJob('BLM');
  await sleep(300);
  const hud = document.getElementById('job-name').textContent;
  const slots = document.querySelectorAll('#hotbar .slot').length;
  // cast Stone on a monster
  const mon = S.monsters.filter(m => m.alive).sort((a, b) => Math.hypot(a.pos.x - S.player.pos.x, a.pos.z - S.player.pos.z) - Math.hypot(b.pos.x - S.player.pos.x, b.pos.z - S.player.pos.z))[0];
  S.player.mesh.position.set(mon.pos.x + 4, 0, mon.pos.z);
  g.setTarget(mon);
  const hpBefore = mon.hp;
  g.useHotbarSlot(0);   // Stone
  await sleep(9000);
  return { herbs, potGain, hud, slots, spellDamage: Math.round(hpBefore - mon.hp), castLog: [...document.querySelectorAll('#log div')].slice(-4).map(d => d.textContent) };
});
console.log('systems:', JSON.stringify(sysResult, null, 1));

// FPS estimate
const fps = await page.evaluate(() => new Promise(res => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res((n / 2).toFixed(0)); };
  requestAnimationFrame(tick);
}));
console.log('approx FPS (swiftshader):', fps);

await shot(page, '4-final');
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
