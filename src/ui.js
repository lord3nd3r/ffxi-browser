// All DOM UI: HUD, hotbar, minimap, chat, dialogs (quests/shops/inventory/
// crafting/jobs), floating combat text, character creation.
import * as THREE from 'three';
import { S, clamp } from './state.js';
import { JOBS, ACTIONS, ITEMS, QUESTS, RECIPES, VENDOR_STOCK, expToNext, MAX_LEVEL } from './data.js';
import {
  G, hotbarList, useHotbarSlot, countItem, questFor, acceptQuest, questComplete, rewardQuest,
  buyItem, sellItem, equipItem, useConsumable, craftRecipe, changeJob, gainExp, requestInteract,
  tryAction, autoCfg, recruitCompanion,
} from './game.js';

const $ = (id) => document.getElementById(id);

// =====================================================================
// chat log
// =====================================================================
// battle-flavored messages go to the right-hand battle log (FFXI layout);
// chat / system / NPC lines stay in the left chat window
const BATTLE_CLASSES = new Set(['cbt', 'dmg-in', 'gain', 'loot', 'heal', 'magic']);
export function log(msg, cls = 'cbt') {
  const el = $(BATTLE_CLASSES.has(cls) ? 'battlelog' : 'log');
  const line = document.createElement('div');
  line.className = cls;
  line.innerHTML = msg;
  el.appendChild(line);
  while (el.children.length > 120) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

export function openChat() { S.chatOpen = true; const i = $('chat-input'); i.style.display = 'block'; i.focus(); }
export function closeChat() { S.chatOpen = false; const i = $('chat-input'); i.value = ''; i.style.display = 'none'; i.blur(); }
function handleChatCommand(cmd) {
  const parts = cmd.trim().split(' ');
  const main = parts[0].toLowerCase();
  if (main === '/sit') {
    const p = S.player;
    if (p && p.alive) {
      p.sitting = !p.sitting;
      if (p.sitting) {
        log(`${S.charName} sits down.`, 'sys');
      } else {
        log(`${S.charName} stands up.`, 'sys');
      }
    }
  } else {
    log(`Unknown command: ${main}`, 'sys');
  }
}

export function submitChat() {
  const i = $('chat-input');
  const text = i.value.trim();
  if (text) {
    if (text.startsWith('/')) {
      handleChatCommand(text);
    } else {
      log(`${S.charName} : ${text}`, 'say');
      if (/hello|hi|hey/i.test(text)) setTimeout(() => log('Lina : Hello! Stay close to Garrick out there, okay?', 'say'), 600);
      else if (Math.random() < 0.25) setTimeout(() => log('Garrick : Hm. Keep your blade sharp.', 'say'), 800);
    }
  }
  closeChat();
}

// =====================================================================
// floating combat text
// =====================================================================
const floaters = [];
export function floater(entOrPos, text, cls = 'dmg') {
  const el = document.createElement('div');
  el.className = `floater ${cls}`;
  el.textContent = text;
  document.body.appendChild(el);
  const pos = entOrPos.pos ? entOrPos.pos : entOrPos;
  floaters.push({ el, x: pos.x, y: (pos.y || 0) + 1.9, z: pos.z, t: 0, life: 1.1, jx: (Math.random() - 0.5) * 40 });
}

const v3 = new THREE.Vector3();
export function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt;
    if (f.t >= f.life) { f.el.remove(); floaters.splice(i, 1); continue; }
    v3.set(f.x, f.y + f.t * 1.4, f.z).project(S.camera);
    if (v3.z > 1) { f.el.style.display = 'none'; continue; }
    f.el.style.display = 'block';
    f.el.style.left = ((v3.x * 0.5 + 0.5) * window.innerWidth + f.jx * f.t) + 'px';
    f.el.style.top = ((-v3.y * 0.5 + 0.5) * window.innerHeight) + 'px';
    f.el.style.opacity = f.t > f.life * 0.6 ? String(1 - (f.t - f.life * 0.6) / (f.life * 0.4)) : '1';
  }
}

// =====================================================================
// HUD: vitals, party, target, exp, clock
// =====================================================================
function setBar(fillEl, frac) { fillEl.style.transform = `scaleX(${clamp(frac, 0, 1)})`; }

let partyEls = [];
export function initPartyFrames() {
  $('auto-chip').onclick = openSpellbook;
  const wrap = $('party');
  wrap.innerHTML = '';
  partyEls = S.party.map((m) => {
    const d = document.createElement('div');
    d.className = 'pmember panel';
    d.innerHTML = `<div class="name"><span>${m.name}</span><span class="lv"></span></div>
      <div class="bar hp"><div class="fill"></div><div class="txt"></div></div>
      <div class="bar mp"><div class="fill"></div><div class="txt"></div></div>`;
    wrap.appendChild(d);
    return { root: d, lv: d.querySelector('.lv'), hp: d.querySelector('.hp .fill'), hpt: d.querySelector('.hp .txt'), mp: d.querySelector('.mp .fill'), mpt: d.querySelector('.mp .txt'), hpbar: d.querySelector('.hp') };
  });
}

export function updateHUD() {
  const p = S.player;
  if (!p) return;
  const jr = S.jobs[S.job];
  $('job-name').textContent = `${S.charName} — ${S.job} Lv.${jr.level}`;
  $('auto-chip').classList.toggle('on', !!(S.autoMagic[S.job] && S.autoMagic[S.job].enabled));
  $('gil').textContent = `${S.gil} G`;
  setBar($('p-hp'), p.hp / p.maxhp);
  $('p-hp-txt').textContent = `${Math.round(p.hp)} / ${p.maxhp}`;
  setBar($('p-mp'), p.maxmp ? p.mp / p.maxmp : 0);
  $('p-mp-txt').textContent = p.maxmp ? `${Math.round(p.mp)} / ${p.maxmp}` : '—';
  setBar($('p-tp'), p.tp / 100);
  $('p-tp-txt').textContent = `${Math.floor(p.tp)} / 100`;
  document.querySelector('#vitals .bar.tp').classList.toggle('ready', p.tp >= 100);
  const need = expToNext(jr.level);
  setBar($('p-xp'), jr.level >= MAX_LEVEL ? 1 : jr.exp / need);
  $('p-xp-txt').textContent = jr.level >= MAX_LEVEL ? 'MAX' : `${jr.exp} / ${need}`;
  const hpbar = document.querySelector('#vitals .bar.hp');
  hpbar.classList.toggle('low', p.hp / p.maxhp < 0.5 && p.hp / p.maxhp >= 0.25);
  hpbar.classList.toggle('crit', p.hp / p.maxhp < 0.25);

  // party frames
  S.party.forEach((m, i) => {
    const f = partyEls[i];
    if (!f) return;
    f.lv.textContent = `Lv.${m.level} ${m.job}`;
    setBar(f.hp, m.hp / m.maxhp);
    f.hpt.textContent = `${Math.round(m.hp)}/${m.maxhp}`;
    setBar(f.mp, m.maxmp ? m.mp / m.maxmp : 0);
    f.mpt.textContent = m.maxmp ? `${Math.round(m.mp)}/${m.maxmp}` : '—';
    f.hpbar.classList.toggle('crit', m.hp / m.maxhp < 0.25);
    f.root.style.opacity = m.alive ? '1' : '.45';
    f.root.classList.toggle('selected', S.target === m);
  });

  // target frame
  if (S.target) {
    setBar($('tgt-hp'), S.target.hp / S.target.maxhp);
    $('tgt-hp-txt').textContent = `${Math.max(0, Math.round(S.target.hp))} / ${S.target.maxhp}`;
  }

  // clock
  const h = Math.floor(S.time), mn = Math.floor((S.time - h) * 60);
  const phase = S.time >= 6 && S.time < 18 ? '☀️ Day' : '🌙 Night';
  $('clock').textContent = `${phase} ${S.day} · ${h}:${mn.toString().padStart(2, '0')}`;

  updateHotbarCooldowns();
  updateMinimap();
}

export function updateTargetFrame() {
  const f = $('target-frame');
  if (!S.target) { f.style.display = 'none'; return; }
  f.style.display = 'block';
  $('tgt-name').textContent = S.target.name;
  const t = S.target;
  $('tgt-lv').textContent = t.kind === 'monster' ? `Lv.${t.level}` : (t.kind === 'npc' ? 'NPC' : `Lv.${t.level} ${t.job}`);
  $('tgt-name').style.color = t.kind === 'monster' ? (t.def.aggressive ? '#ff9d9d' : '#f3e9c8') : '#8fd3a8';
}

// =====================================================================
// hotbar
// =====================================================================
let hotbarSlots = [];
export function refreshHotbar() {
  const bar = $('hotbar');
  bar.innerHTML = '';
  hotbarSlots = [];
  const list = hotbarList();
  list.forEach((id, i) => {
    const a = ACTIONS[id];
    const d = document.createElement('div');
    d.className = 'slot';
    d.innerHTML = `<span class="key">${(i + 1) % 10}</span><span class="ico">${a.icon}</span><span class="nm">${a.name}</span><span class="cd"></span>`;
    d.title = `${a.name} — ${a.desc}${a.mp ? ` (${a.mp} MP)` : ''}${a.kind === 'ws' ? ' (100 TP)' : ''}`;
    d.addEventListener('click', () => useHotbarSlot(i));
    bar.appendChild(d);
    hotbarSlots.push({ el: d, cd: d.querySelector('.cd'), id });
  });
}

function updateHotbarCooldowns() {
  const p = S.player;
  for (const s of hotbarSlots) {
    const a = ACTIONS[s.id];
    const key = a.kind === 'item' ? 'item' : s.id;
    const left = (p.recasts[key] || 0) - G.now;
    if (left > 0) { s.cd.style.display = 'flex'; s.cd.textContent = Math.ceil(left); }
    else { s.cd.style.display = 'none'; }
    let dis = false;
    if (a.mp && p.mp < a.mp) dis = true;
    if (a.kind === 'ws' && p.tp < 100) dis = true;
    if (a.kind === 'item' && countItem(a.item) <= 0) dis = true;
    s.el.classList.toggle('disabled', dis);
  }
}

// =====================================================================
// cast bar
// =====================================================================
export function showCastbar(name, total) { $('castbar').style.display = 'block'; $('cast-name').textContent = name; setBar($('cast-fill'), 0); }
export function updateCastbar(frac) { setBar($('cast-fill'), frac); }
export function hideCastbar() { $('castbar').style.display = 'none'; }

// =====================================================================
// minimap
// =====================================================================
const mmCtx = () => $('minimap').getContext('2d');
export function updateMinimap() {
  const cx = mmCtx();
  const W = 140, scale = W / 190;
  const px = (x) => (x + 95) * scale, pz = (z) => (z + 95) * scale;
  cx.fillStyle = '#243a1e'; cx.fillRect(0, 0, W, W);
  // zones
  cx.fillStyle = '#3a5a2e'; cx.beginPath(); cx.arc(px(55), pz(48), 26 * scale, 0, 7); cx.fill();   // forest
  cx.fillStyle = '#4a4a44'; cx.beginPath(); cx.arc(px(-70), pz(-68), 16 * scale, 0, 7); cx.fill(); // ruins
  cx.fillStyle = '#2e4a6a'; cx.beginPath(); cx.arc(px(44), pz(-34), 11 * scale, 0, 7); cx.fill();  // pond
  // coast (NW edge): sand strip + ocean
  cx.fillStyle = '#cbb88c'; cx.fillRect(0, pz(58), px(28), pz(95) - pz(58));
  cx.fillStyle = '#3a6a9a'; cx.fillRect(0, pz(80), px(28), pz(95) - pz(80));
  cx.fillStyle = '#6a5a3e'; cx.beginPath(); cx.arc(px(0), pz(0), 20 * scale, 0, 7); cx.fill();     // town
  // road
  cx.strokeStyle = '#6a5a3e'; cx.lineWidth = 2;
  cx.beginPath(); cx.moveTo(px(0), pz(0)); cx.lineTo(px(-70), pz(-68)); cx.stroke();

  for (const n of S.npcs) { cx.fillStyle = '#ffe066'; cx.fillRect(px(n.pos.x) - 1.5, pz(n.pos.z) - 1.5, 3, 3); }
  for (const nd of S.nodes) if (nd.available) { cx.fillStyle = '#4dd2ff'; cx.fillRect(px(nd.x) - 1, pz(nd.z) - 1, 2, 2); }
  for (const m of S.monsters) if (m.alive) {
    cx.fillStyle = m.def.boss ? '#d946ef' : (m.aggroOn ? '#ff4444' : '#cc7777');
    cx.fillRect(px(m.pos.x) - 1.5, pz(m.pos.z) - 1.5, 3, 3);
  }
  for (const c of S.party) if (c.kind === 'companion') { cx.fillStyle = '#69db7c'; cx.fillRect(px(c.pos.x) - 2, pz(c.pos.z) - 2, 4, 4); }
  // player arrow
  const p = S.player;
  cx.save();
  cx.translate(px(p.pos.x), pz(p.pos.z));
  cx.rotate(-p.mesh.rotation.y);
  cx.fillStyle = '#ffffff';
  cx.beginPath(); cx.moveTo(0, -5); cx.lineTo(3.5, 4); cx.lineTo(-3.5, 4); cx.closePath(); cx.fill();
  cx.restore();
}

// =====================================================================
// quest tracker
// =====================================================================
export function updateTracker() {
  const el = $('tracker');
  let html = '';
  for (const [qid, st] of Object.entries(S.quests)) {
    if (st.state !== 'active') continue;
    const q = QUESTS[qid];
    let prog;
    if (q.type === 'kill') prog = `${st.n}/${q.count} slain`;
    else if (q.type === 'collect') prog = `${Math.min(countItem(q.target), q.count)}/${q.count} ${ITEMS[q.target].name}s`;
    else prog = `Deliver to ${q.target === 'scholar' ? 'Renn at the ruins (SW)' : q.target}`;
    const done = questComplete(qid);
    html += `<div class="q"><div class="qn">◆ ${q.name}</div><div class="qp ${done ? 'done' : ''}">${done ? '✓ Return to quest giver' : prog}</div></div>`;
  }
  el.innerHTML = html;
}

// =====================================================================
// context menu
// =====================================================================
export function showCtxMenu(x, y, items) {
  const m = $('ctxmenu');
  m.innerHTML = '';
  for (const it of items) {
    const d = document.createElement('div');
    d.className = 'item';
    d.textContent = it.label;
    d.addEventListener('click', () => { hideCtxMenu(); it.fn(); });
    m.appendChild(d);
  }
  m.style.display = 'block';
  m.style.left = Math.min(x, window.innerWidth - 140) + 'px';
  m.style.top = Math.min(y, window.innerHeight - items.length * 30 - 10) + 'px';
}
export function hideCtxMenu() { $('ctxmenu').style.display = 'none'; }

// =====================================================================
// dialog windows
// =====================================================================
export function showDialog(title, bodyHtml, opts) {
  S.uiOpen = true;
  $('dialog').style.display = 'block';
  $('dlg-title').textContent = title;
  $('dlg-body').innerHTML = bodyHtml;
  const o = $('dlg-opts');
  o.innerHTML = '';
  for (const op of opts) {
    const b = document.createElement('button');
    b.className = 'btn' + (op.gold ? ' gold' : '');
    b.textContent = op.label;
    b.addEventListener('click', () => { if (op.keep !== true) closeDialog(); op.fn && op.fn(); });
    o.appendChild(b);
  }
}
export function closeDialog() { $('dialog').style.display = 'none'; $('dlg-body').onclick = null; S.uiOpen = false; }

// ---------- NPC conversation ----------
const FLAVOR = {
  eustace: 'Halt! …Ah, an adventurer. Good. The plains have grown dangerous of late.',
  mirelle: 'Sharp steel for sharp minds. See anything you like?',
  tarutaru: 'Welcome, welcome-welcome! Pikko-Wikko has potions galore, yes-yes!',
  father_odo: 'May the Goddess watch over you, child.',
  galdric: 'Mind the sawdust. A carpenter\'s work is never done.',
  scholar: 'Careful where you step! These stones predate the town by a thousand years.',
};

const ALLY_FLAVOR = {
  Garrick: 'The name\'s Garrick. Twenty years behind a shield, and these plains still find ways to surprise me. You look like you could use a wall between you and the wildlife.',
  Lina: 'Oh! An adventurer! I\'m Lina — I\'ve studied the healing arts at the chapel. The Goddess frowns on those who travel alone, you know…',
};

export function openNpcDialog(npc) {
  const id = npc.npc.id;
  npc.faceToward(S.player.pos.x, S.player.pos.z);

  // companion recruitment (FFXI trust-style)
  if (npc.npc.role === 'ally') {
    const c = npc.npc.ally;
    showDialog(`${npc.name} — ${JOBS[c.job].name}`, `<p><i>${ALLY_FLAVOR[npc.name] || 'Care to travel together?'}</i></p>
      <p style="margin-top:8px;color:#9bb0e8">${npc.name} will fight alongside you as a ${JOBS[c.job].name} (${c.role}), matching your level.</p>`, [
      { label: `Invite ${npc.name} to the party`, gold: true, fn: () => recruitCompanion(npc.name) },
      { label: 'Maybe later' },
    ]);
    return;
  }

  const opts = [];
  let body = `<p><i>${FLAVOR[id]}</i></p>`;

  // quest logic
  const qinfo = questFor(id);
  if (qinfo) {
    const { qid, q, st } = qinfo;
    if (!st) {
      body += `<p style="margin-top:8px"><b style="color:#ffe066">[${q.name}]</b><br/>${q.offer}</p>`;
      opts.push({ label: 'Accept Quest', gold: true, fn: () => acceptQuest(qid) });
    } else if (st.state === 'active') {
      if (q.type !== 'deliver' && questComplete(qid)) {
        body += `<p style="margin-top:8px"><b style="color:#69db7c">[${q.name} — Complete]</b><br/>${q.done}</p>`;
        opts.push({ label: 'Claim Reward', gold: true, fn: () => rewardQuest(qid) });
      } else {
        const prog = q.type === 'kill' ? `${st.n}/${q.count}` : q.type === 'collect' ? `${countItem(q.target)}/${q.count}` : 'undelivered';
        body += `<p style="margin-top:8px"><b style="color:#ffe066">[${q.name}]</b> — in progress (${prog}).</p>`;
      }
    }
  }
  // deliver-quest receiver
  for (const [qid, q] of Object.entries(QUESTS)) {
    if (q.type === 'deliver' && q.target === id && S.quests[qid] && S.quests[qid].state === 'active' && countItem(q.item) > 0) {
      body += `<p style="margin-top:8px"><b style="color:#69db7c">[${q.name}]</b><br/>${q.done}</p>`;
      opts.push({ label: `Hand over the ${ITEMS[q.item].name}`, gold: true, fn: () => rewardQuest(qid) });
    }
  }

  if (npc.npc.role === 'weapons') opts.push({ label: 'Browse Wares', fn: () => openShop('weapons') });
  if (npc.npc.role === 'items') opts.push({ label: 'Browse Wares', fn: () => openShop('items') });
  if (id === 'father_odo') opts.push({ label: 'Receive Blessing (free heal)', fn: () => {
    const p = S.player; p.hp = p.maxhp; p.mp = p.maxmp;
    for (const c of S.party) if (c.alive) { c.hp = c.maxhp; c.mp = c.maxmp; }
    log('A warm light washes over the party. HP/MP fully restored.', 'magic');
  }});
  if (id === 'eustace') opts.push({ label: 'Where should I hunt?', keep: true, fn: () => {
    $('dlg-body').innerHTML = '<p><i>Hares and wasps roam just outside the gate — fine prey for a fresh adventurer. Mandragoras lurk in the eastern woods. The goblin camps southwest are for seasoned fighters, and past them… orcs. Stay clear of the old ruins until you\'re strong, friend.</i></p>';
  }});
  opts.push({ label: 'Farewell' });
  showDialog(npc.name, body, opts);
}

// ---------- shops ----------
function openShop(stockKey) {
  const stock = VENDOR_STOCK[stockKey];
  let body = '<div>';
  for (const id of stock) {
    const it = ITEMS[id];
    const sub = it.type === 'weapon' ? `${JOBS[it.job].abbr} · DMG ${it.dmg}${it.matk ? ` · MATK+${it.matk}` : ''}` : it.type === 'armor' ? `DEF ${it.def}${it.mp ? ` · MP+${it.mp}` : ''}` : (it.heal ? `Restores ${it.heal} HP` : `Restores ${it.mpheal} MP`);
    body += `<div class="listrow"><span>${it.icon} ${it.name}<br/><span class="sub">${sub}</span></span><span><span class="price">${it.price} G</span><button class="btn" data-buy="${id}">Buy</button></span></div>`;
  }
  body += '</div><p style="margin-top:8px;color:#8a96b8">Your goods (sell for 30% value):</p><div>';
  for (const row of S.inventory) {
    const it = ITEMS[row.id];
    if (it.type === 'key') continue;
    body += `<div class="listrow"><span>${it.icon} ${it.name} ×${row.qty}</span><span><span class="price">${Math.max(1, Math.floor((it.price || 10) * 0.3))} G</span><button class="btn" data-sell="${row.id}">Sell</button></span></div>`;
  }
  body += '</div>';
  showDialog(stockKey === 'weapons' ? 'Mirelle\'s Armory' : 'Pikko-Wikko\'s Goods', body, [{ label: 'Done Shopping' }]);
  $('dlg-body').addEventListener('click', (e) => {
    const buy = e.target.getAttribute && e.target.getAttribute('data-buy');
    const sell = e.target.getAttribute && e.target.getAttribute('data-sell');
    if (buy) buyItem(buy);
    if (sell) sellItem(sell);
    if (buy || sell) openShop(stockKey); // re-render
  }, { once: true });
}

// ---------- inventory ----------
export function openInventory() {
  if (S.uiOpen) { closeDialog(); return; }
  const eq = S.equipPerJob[S.job];
  let body = `<p>Equipped: ${eq.weapon ? ITEMS[eq.weapon].icon + ' ' + ITEMS[eq.weapon].name : '—'} / ${eq.armor ? ITEMS[eq.armor].icon + ' ' + ITEMS[eq.armor].name : 'no armor'}</p><div style="margin-top:6px">`;
  if (!S.inventory.length) body += '<p style="color:#8a96b8">Your bags are empty.</p>';
  for (const row of S.inventory) {
    const it = ITEMS[row.id];
    let btn = '';
    if (it.type === 'consumable') btn = `<button class="btn" data-use="${row.id}">Use</button>`;
    else if (it.type === 'weapon' && it.job === S.job && eq.weapon !== row.id) btn = `<button class="btn" data-eq="${row.id}">Equip</button>`;
    else if (it.type === 'armor' && eq.armor !== row.id) btn = `<button class="btn" data-eq="${row.id}">Equip</button>`;
    const sub = it.type === 'weapon' ? `${JOBS[it.job].abbr} weapon · DMG ${it.dmg}` : it.type === 'armor' ? `DEF ${it.def}` : it.type === 'material' ? 'material' : it.type === 'key' ? 'key item' : (it.heal ? `+${it.heal} HP` : `+${it.mpheal} MP`);
    body += `<div class="listrow"><span>${it.icon} ${it.name} ×${row.qty}<br/><span class="sub">${sub}</span></span><span>${btn}</span></div>`;
  }
  body += '</div>';
  showDialog(`Inventory — ${S.gil} G`, body, [{ label: 'Close' }]);
  $('dlg-body').addEventListener('click', (e) => {
    const use = e.target.getAttribute && e.target.getAttribute('data-use');
    const eqi = e.target.getAttribute && e.target.getAttribute('data-eq');
    if (use) { useConsumable(use); closeDialog(); openInventory(); }
    if (eqi) { equipItem(eqi); closeDialog(); openInventory(); }
  }, { once: true });
}

// ---------- crystal: job change & crafting ----------
export function openCrystalMenu() {
  const body = '<p><i>The crystal hums softly. Its light knows you.</i></p>';
  showDialog('Home Point Crystal', body, [
    { label: 'Change Job', fn: openJobMenu },
    { label: 'Synthesis (Crafting)', fn: openCrafting },
    { label: 'Rest until morning', fn: () => { S.time = 6.5; log('You rest by the crystal until dawn.', 'sys'); } },
    { label: 'Leave' },
  ]);
}

function openJobMenu() {
  let body = '<div>';
  for (const [jid, j] of Object.entries(JOBS)) {
    const jr = S.jobs[jid];
    const cur = S.job === jid;
    body += `<div class="listrow"><span>${j.icon} <b>${j.name}</b> — Lv.${jr.level}<br/><span class="sub">${j.desc}</span></span><span>${cur ? '<span style="color:#69db7c">current</span>' : `<button class="btn" data-job="${jid}">Select</button>`}</span></div>`;
  }
  body += '</div>';
  showDialog('Change Job', body, [{ label: 'Back', fn: openCrystalMenu }]);
  $('dlg-body').addEventListener('click', (e) => {
    const j = e.target.getAttribute && e.target.getAttribute('data-job');
    if (j) { closeDialog(); changeJob(j); }
  }, { once: true });
}

function openCrafting() {
  let body = '<p style="color:#8a96b8">Combine materials gathered in the field:</p><div>';
  for (const r of RECIPES) {
    const it = ITEMS[r.result];
    const mats = r.mats.map(m => `${ITEMS[m.id].name} ${countItem(m.id)}/${m.qty}`).join(', ');
    const can = r.mats.every(m => countItem(m.id) >= m.qty);
    body += `<div class="listrow"><span>${it.icon} <b>${it.name}</b>${r.qty > 1 ? ' ×' + r.qty : ''} <span class="sub">(${r.skill})</span><br/><span class="sub">${mats}</span></span><span><button class="btn" data-craft="${r.id}" ${can ? '' : 'disabled'}>Synth</button></span></div>`;
  }
  body += '</div>';
  showDialog('Synthesis', body, [{ label: 'Back', fn: openCrystalMenu }]);
  $('dlg-body').addEventListener('click', (e) => {
    const r = e.target.getAttribute && e.target.getAttribute('data-craft');
    if (r) { craftRecipe(r); closeDialog(); openCrafting(); }
  }, { once: true });
}

// ---------- help ----------
// =====================================================================
// Magic Book: every spell/ability/WS of the job, with auto-cast config.
// Toggle each action for combat and/or field (wandering) auto-use, order
// them by priority, set the heal threshold, and flip the master switch.
// =====================================================================
export function openSpellbook() {
  if (!S.player) return;
  const cfg = autoCfg();
  const lvl = S.jobs[S.job].level;
  const KINDS = [
    ['spell', `${S.job === 'BLM' ? 'Black' : S.job === 'WHM' ? 'White' : ''} Magic`.trim()],
    ['ability', 'Job Abilities'],
    ['ws', 'Weapon Skills'],
    ['item', 'Items'],
  ];

  let body = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
    <button class="btn ${cfg.enabled ? 'gold' : ''}" id="mb-master">${cfg.enabled ? '⚡ Auto-magic: ON' : 'Auto-magic: OFF'}</button>
    <label style="font-size:11px;color:#9bb0e8">Heal allies under
      <select id="mb-heal" style="background:#15182a;color:#fff;border:1px solid #3d4f7d;border-radius:3px;font-size:11px">
        ${[50, 60, 70, 75, 80, 90].map(v => `<option value="${v}" ${cfg.healAt === v ? 'selected' : ''}>${v}%</option>`).join('')}
      </select> HP
    </label>
  </div>
  <div style="font-size:10px;color:#8a96b8;margin-bottom:6px">⚔ = use while fighting · 🌿 = use while wandering · ▲▼ = priority · top of the list casts first. Click a name to cast it now.</div>`;

  // every action this job will ever know, in priority order, locked ones last
  const all = Object.entries(ACTIONS).filter(([, a]) => a.job === S.job || !a.job);
  const order = [...cfg.order, ...all.map(([id]) => id).filter(id => !cfg.order.includes(id))];

  for (const [kind, title] of KINDS) {
    const rows = order.filter(id => ACTIONS[id] && ACTIONS[id].kind === kind && (ACTIONS[id].job === S.job || !ACTIONS[id].job));
    if (!rows.length) continue;
    body += `<div class="mb-head">${title}</div>`;
    for (const id of rows) {
      const a = ACTIONS[id];
      const locked = a.job && a.lv > lvl;
      const cost = [a.mp ? `${a.mp} MP` : '', a.kind === 'ws' ? '100 TP' : '', a.cast ? `cast ${a.cast}s` : '', a.recast ? `recast ${a.recast}s` : '', a.range ? `range ${a.range}` : ''].filter(Boolean).join(' · ');
      body += `<div class="mb-row ${locked ? 'locked' : ''}" data-id="${id}">
        <span class="mb-ico">${a.icon}</span>
        <div class="mb-main">
          <div class="mb-name"><a href="#" class="mb-castlink" style="color:inherit;text-decoration:none">${a.name}</a> <span class="lv">${a.lv ? `Lv.${a.lv}` : ''}${locked ? ' 🔒' : ''}</span></div>
          <div class="mb-sub">${cost ? cost + ' — ' : ''}${a.desc}</div>
        </div>
        ${locked ? '' : `
        <span class="mb-tgl ${cfg.combat[id] ? 'on' : ''}" data-mode="combat" title="Auto-use while fighting">⚔</span>
        <span class="mb-tgl ${cfg.field[id] ? 'on' : ''}" data-mode="field" title="Auto-use while wandering">🌿</span>
        <div class="mb-pri"><span data-dir="-1" title="Higher priority">▲</span><span data-dir="1" title="Lower priority">▼</span></div>`}
      </div>`;
    }
  }

  showDialog(`Magic Book — ${JOBS[S.job].name} Lv.${lvl}`, body, [{ label: 'Close' }]);

  const bodyEl = $('dlg-body');
  $('mb-master').addEventListener('click', () => { cfg.enabled = !cfg.enabled; openSpellbook(); updateHUD(); });
  $('mb-heal').addEventListener('change', (e) => { cfg.healAt = +e.target.value; });
  // onclick (not addEventListener): #dlg-body persists across dialogs, so this self-replaces
  bodyEl.onclick = (e) => {
    const row = e.target.closest('.mb-row');
    if (!row) return;
    const id = row.dataset.id;
    const tgl = e.target.closest('.mb-tgl');
    const pri = e.target.closest('.mb-pri span');
    const cast = e.target.closest('.mb-castlink');
    if (tgl) {
      const m = tgl.dataset.mode;
      cfg[m][id] = !cfg[m][id];
      tgl.classList.toggle('on', !!cfg[m][id]);
    } else if (pri) {
      const dir = +pri.dataset.dir;
      const i = cfg.order.indexOf(id);
      const j = i + dir;
      if (i >= 0 && j >= 0 && j < cfg.order.length) {
        [cfg.order[i], cfg.order[j]] = [cfg.order[j], cfg.order[i]];
        const scroll = bodyEl.scrollTop;
        openSpellbook();
        $('dlg-body').scrollTop = scroll;
      }
    } else if (cast) {
      e.preventDefault();
      tryAction(S.player, id);
    }
  };
}

export function openHelp() {
  showDialog('Adventurer\'s Handbook', `
    <p><b>Movement</b> — Left-click the ground to walk there. Hold <b>W A S D</b> (or arrows / numpad) to move. Hold <b>both mouse buttons</b> to run forward. Drag with the right mouse button to orbit the camera; mouse wheel zooms; <b>F</b> toggles first person.</p>
    <p style="margin-top:6px"><b>Combat</b> — Click a monster or press <b>Tab</b> to target it. Walk into range and you will auto-attack. Keys <b>1–0</b> trigger your hotbar: weapon skills need 100 TP, spells cost MP. Right-click a target for its menu. <b>Esc</b> cancels casting / clears target.</p>
    <p style="margin-top:6px"><b>Party</b> — Garrick (tank) and Lina (healer) fight alongside you and match your level. If you fall, you return to the Home Point crystal.</p>
    <p style="margin-top:6px"><b>Progression</b> — Earn EXP, learn abilities as you level, buy gear in town, gather <span style="color:#4dd2ff">✦ glowing nodes</span> (logs, ore, herbs) and craft at the crystal. Change jobs at the crystal — each job levels separately!</p>
    <p style="margin-top:6px"><b>Quests</b> — NPCs with work for you are in town. Start with Gate Guard Eustace at the north gate. <b>I</b> opens inventory.</p>
    <p style="margin-top:6px"><b>HUD</b> — Drag any panel (minimap, party, stats, chat, hotbar) to rearrange the interface. Your layout is saved.</p>
  `, [{ label: 'Adventure awaits!' }, { label: 'Reset UI Layout', fn: resetLayout }]);
}

export function toggleHint() { const h = $('hint'); h.style.display = h.style.display === 'none' ? 'block' : 'none'; }

// =====================================================================
// draggable HUD panels (positions persist in localStorage)
// =====================================================================
const UIPOS_KEY = 'vanadiel_ui_layout_v1';
export function initDraggables() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(UIPOS_KEY) || '{}'); } catch (e) {}
  const persist = () => { try { localStorage.setItem(UIPOS_KEY, JSON.stringify(saved)); } catch (e) {} };
  const place = (el, p) => {
    el.style.left = clamp(p.x, 0, window.innerWidth - 60) + 'px';
    el.style.top = clamp(p.y, 0, window.innerHeight - 40) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';
  };
  for (const id of ['minimap-wrap', 'party', 'vitals', 'chat', 'battlelog-wrap', 'hotbar', 'tracker', 'target-frame']) {
    const el = $(id);
    el.classList.add('draggable');
    if (saved[id]) place(el, saved[id]);
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, input, .slot, .item')) return;
      const rect = el.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY;
      let moved = false;
      const mm = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        moved = true;
        el.classList.add('dragging');
        const p = { x: rect.left + ev.clientX - sx, y: rect.top + ev.clientY - sy };
        place(el, p);
        saved[id] = p;
      };
      const mu = () => {
        window.removeEventListener('pointermove', mm);
        window.removeEventListener('pointerup', mu);
        el.classList.remove('dragging');
        if (moved) persist();
      };
      window.addEventListener('pointermove', mm);
      window.addEventListener('pointerup', mu);
    });
  }
}
export function resetLayout() {
  try { localStorage.removeItem(UIPOS_KEY); } catch (e) {}
  location.reload();
}

// =====================================================================
// character creation
// =====================================================================
export function charCreate(saved, onDone) {
  if (saved) {
    // returning player
    showDialog('Welcome back!', `<p>Resume your adventure as <b>${saved.charName}</b> (${saved.job} Lv.${saved.jobs[saved.job].level})?</p>`, [
      { label: 'Continue', gold: true, fn: () => onDone(null) },
      { label: 'New Character (erases save)', fn: () => { localStorage.removeItem('vanadiel_reverie_v1'); location.reload(); } },
    ]);
    return;
  }
  const skins = [0xe8c8a8, 0xd8a87c, 0x9a6a4a];
  const hairs = [0x4a2f1d, 0xc9a227, 0x333344];
  let sel = { skin: skins[1], hair: hairs[0], job: 'WAR' };
  const sw = (c) => `#${c.toString(16).padStart(6, '0')}`;
  let body = `<p>Name your adventurer:</p>
    <input id="cc-name" maxlength="14" value="Aldric" style="width:100%;margin:6px 0;padding:6px;background:#10142a;border:1px solid #4a5a8a;border-radius:4px;color:#fff;font-size:13px" />
    <p>Skin: ${skins.map((c, i) => `<span class="cc-skin" data-i="${i}" style="display:inline-block;width:26px;height:26px;background:${sw(c)};border:2px solid ${i === 1 ? '#ffd43b' : '#333'};border-radius:4px;cursor:pointer;margin:2px"></span>`).join('')}
    &nbsp; Hair: ${hairs.map((c, i) => `<span class="cc-hair" data-i="${i}" style="display:inline-block;width:26px;height:26px;background:${sw(c)};border:2px solid ${i === 0 ? '#ffd43b' : '#333'};border-radius:4px;cursor:pointer;margin:2px"></span>`).join('')}</p>
    <p style="margin-top:6px">Starting job:</p><div>`;
  for (const [jid, j] of Object.entries(JOBS)) {
    body += `<div class="listrow cc-job" data-j="${jid}" style="cursor:pointer;border-left:3px solid ${jid === 'WAR' ? '#ffd43b' : 'transparent'}"><span>${j.icon} <b>${j.name}</b><br/><span class="sub">${j.desc}</span></span></div>`;
  }
  body += '</div>';
  showDialog('Create Your Adventurer', body, [
    { label: 'Begin Adventure', gold: true, keep: true, fn: () => {
      const name = ($('cc-name').value.trim() || 'Aldric').slice(0, 14);
      closeDialog();
      onDone({ name, skin: sel.skin, hair: sel.hair, job: sel.job });
    } },
  ]);
  $('dlg-body').addEventListener('click', (e) => {
    const t = e.target.closest ? e.target : null;
    if (!t) return;
    const skinEl = e.target.closest('.cc-skin'), hairEl = e.target.closest('.cc-hair'), jobEl = e.target.closest('.cc-job');
    if (skinEl) { sel.skin = skins[+skinEl.dataset.i]; document.querySelectorAll('.cc-skin').forEach((el, i) => el.style.borderColor = i === +skinEl.dataset.i ? '#ffd43b' : '#333'); }
    if (hairEl) { sel.hair = hairs[+hairEl.dataset.i]; document.querySelectorAll('.cc-hair').forEach((el, i) => el.style.borderColor = i === +hairEl.dataset.i ? '#ffd43b' : '#333'); }
    if (jobEl) { sel.job = jobEl.dataset.j; document.querySelectorAll('.cc-job').forEach(el => el.style.borderLeftColor = el.dataset.j === sel.job ? '#ffd43b' : 'transparent'); }
  });
}
