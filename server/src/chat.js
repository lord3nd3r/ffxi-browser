// Real-time chat, presence, authoritative combat, and world simulation via Socket.IO.
import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { JOBS, ACTIONS, ITEMS, MONSTERS, SPAWNS, QUESTS, STARTER_WEAPON, expToNext, MAX_LEVEL } from './data.js';

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Player object shape:
 * {
 *   accountId, charName, job, jobs, gil, inventory, equipment, quests, appearance, recruited, autoMagic, bossDown,
 *   hp, mp, tp, maxhp, maxmp, x, z, heading, moving, buffs, recasts, casting, engagedTargetId, attackTimer, lastUpdate, companions
 * }
 */
const players = new Map();
const trackedPlayers = new Map();
const trackedMonsters = new Map();

// Authoritative Monsters Map
const monsters = new Map();
let monsterNextId = 1;

// Authoritative Gathering Nodes Map
const nodes = new Map([
  ['log_1', { id: 'log_1', type: 'logging', x: 42, z: 38, available: true, respawnT: 0 }],
  ['log_2', { id: 'log_2', type: 'logging', x: 60, z: 55, available: true, respawnT: 0 }],
  ['log_3', { id: 'log_3', type: 'logging', x: 50, z: 62, available: true, respawnT: 0 }],
  ['log_4', { id: 'log_4', type: 'logging', x: 68, z: 40, available: true, respawnT: 0 }],
  ['min_1', { id: 'min_1', type: 'mining', x: -48, z: -30, available: true, respawnT: 0 }],
  ['min_2', { id: 'min_2', type: 'mining', x: -58, z: -48, available: true, respawnT: 0 }],
  ['min_3', { id: 'min_3', type: 'mining', x: -42, z: -52, available: true, respawnT: 0 }],
  ['herb_1', { id: 'herb_1', type: 'herb', x: 18, z: -30, available: true, respawnT: 0 }],
  ['herb_2', { id: 'herb_2', type: 'herb', x: -28, z: 18, available: true, respawnT: 0 }],
  ['herb_3', { id: 'herb_3', type: 'herb', x: 30, z: -52, available: true, respawnT: 0 }],
  ['herb_4', { id: 'herb_4', type: 'herb', x: -20, z: -28, available: true, respawnT: 0 }],
]);

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function irand(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function aAn(name) { return (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name.toLowerCase(); }

// Spawn monsters authoritatively
function initMonsters() {
  for (const sp of SPAWNS) {
    for (let i = 0; i < sp.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * sp.area.r;
      const x = sp.area.x + Math.cos(a) * r;
      const z = sp.area.z + Math.sin(a) * r;

      const typeId = sp.monster;
      const def = MONSTERS[typeId];
      const level = irand(def.lv[0], def.lv[1]);
      const maxhp = Math.round(def.hp * (1 + (level - def.lv[0]) * 0.18));

      const id = `mon_${monsterNextId++}`;
      monsters.set(id, {
        id,
        typeId,
        level,
        hp: maxhp,
        maxhp,
        x,
        z,
        heading: Math.random() * Math.PI * 2,
        moving: false,
        dest: null,
        aggroOn: null,
        returning: false,
        sleep: 0,
        dot: null,
        buffs: {},
        deathT: 0,
        home: { x, z },
        attackTimer: 0,
        attackDelay: def.boss ? 2.2 : 3.0,
        def,
      });
    }
  }
  console.log(`[server] Autoritatively spawned ${monsters.size} monsters.`);
}

initMonsters();

function broadcastCount(io) {
  io.emit('player:count', { count: players.size });
}

function getPlayerStats(p) {
  const job = JOBS[p.job];
  const lv = p.level;
  const weapon = p.equipment[p.job]?.weapon ? ITEMS[p.equipment[p.job].weapon] : null;
  const armor = p.equipment[p.job]?.armor ? ITEMS[p.equipment[p.job].armor] : null;

  let atk = (weapon ? weapon.dmg : 3) + job.str * 0.55 + lv * 1.5;
  let def = (armor ? armor.def : 0) + job.vit * 0.5 + lv * 1.1;
  let matk = job.int * 1.1 + lv * 0.9 + (weapon && weapon.matk ? weapon.matk : 0);
  let mnd = job.mnd * 1.0 + lv * 0.7;
  let eva = job.agi * 0.8 + lv;
  let speedMul = 1;
  let critCh = p.job === 'THF' ? 0.16 : 0.08;

  const b = p.buffs || {};
  if (b.berserk) { atk *= 1.35; def *= 0.85; }
  if (b.defender) { def *= 1.4; atk *= 0.85; }
  if (b.protect) { def *= 1.25; }
  if (b.boost) { atk *= 1.3; }
  if (b.dodge) { eva *= 1.6; }

  return { atk, def, matk, mnd, eva, speedMul, critCh, delay: weapon ? weapon.delay : 2.6 };
}

function getCompanionStats(c, playerLevel) {
  const job = JOBS[c.job];
  const lv = playerLevel;
  const weaponItem = STARTER_WEAPON[c.job];
  const weapon = ITEMS[weaponItem];

  let atk = (weapon ? weapon.dmg : 3) + job.str * 0.55 + lv * 1.5;
  let def = job.vit * 0.5 + lv * 1.1;
  let matk = job.int * 1.1 + lv * 0.9 + (weapon && weapon.matk ? weapon.matk : 0);
  let mnd = job.mnd * 1.0 + lv * 0.7;
  let eva = job.agi * 0.8 + lv;
  let speedMul = 1;
  let critCh = 0.08;

  const b = c.buffs || {};
  if (b.protect) { def *= 1.25; }

  return { atk, def, matk, mnd, eva, speedMul, critCh, delay: weapon ? weapon.delay : 2.6 };
}

function monsterStats(m) {
  const d = m.def;
  const lvB = 1 + (m.level - d.lv[0]) * 0.12;
  let def = d.def * lvB + m.level * 0.8;
  if (m.buffs.armorbreak || (m.dot && m.dot.dia)) def *= 0.75;
  return { atk: d.dmg * lvB + m.level, def, eva: m.level * 1.1 + 4, speedMul: m.buffs.slowed ? 0.55 : 1, critCh: 0.05, delay: m.attackDelay };
}

function getPlayerMaxStats(job, level, armorItem) {
  const j = JOBS[job];
  const maxhp = Math.round(j.baseHP + j.hpGain * (level - 1));
  const maxmp = Math.round(j.baseMP + j.mpGain * (level - 1) + (armorItem && ITEMS[armorItem]?.mp ? ITEMS[armorItem].mp : 0));
  return { maxhp, maxmp };
}

function syncPlayerMaxHPMP(p) {
  const armorItem = p.equipment[p.job]?.armor || null;
  const { maxhp, maxmp } = getPlayerMaxStats(p.job, p.level, armorItem);
  p.maxhp = maxhp;
  p.maxmp = maxmp;
  p.hp = Math.min(p.hp, p.maxhp);
  p.mp = Math.min(p.mp, p.maxmp);
}

function applyJobStats(e, job, level) {
  const j = JOBS[job];
  if (!j) return;
  e.maxhp = Math.round(j.baseHP + j.hpGain * (level - 1));
  e.maxmp = Math.round(j.baseMP + j.mpGain * (level - 1));
  e.hp = e.maxhp;
  e.mp = e.maxmp;
}

function sendPlayerStatus(socket, p) {
  if (!socket) return;
  socket.emit('player:status', {
    hp: p.hp,
    maxhp: p.maxhp,
    mp: p.mp,
    maxmp: p.maxmp,
    tp: p.tp,
    level: p.level,
    gil: p.gil,
    inventory: p.inventory,
    quests: p.quests,
    bossDown: p.bossDown,
    recruited: p.recruited,
    companions: p.companions.map(c => ({ name: c.name, hp: c.hp, maxhp: c.maxhp, mp: c.mp, maxmp: c.maxmp, tp: c.tp })),
  });
}

function savePlayerToDb(p) {
  db.prepare(`
    INSERT INTO characters (
      account_id, name, current_job, gil, jobs_json, inventory_json,
      equipment_json, quests_json, appearance_json, recruited_json,
      auto_magic_json, boss_down, hp, mp, pos_x, pos_z, updated_at
    ) VALUES (
      @account_id, @name, @current_job, @gil, @jobs_json, @inventory_json,
      @equipment_json, @quests_json, @appearance_json, @recruited_json,
      @auto_magic_json, @boss_down, @hp, @mp, @pos_x, @pos_z, datetime('now')
    )
    ON CONFLICT(account_id) DO UPDATE SET
      name = excluded.name, current_job = excluded.current_job, gil = excluded.gil,
      jobs_json = excluded.jobs_json, inventory_json = excluded.inventory_json,
      equipment_json = excluded.equipment_json, quests_json = excluded.quests_json,
      appearance_json = excluded.appearance_json, recruited_json = excluded.recruited_json,
      auto_magic_json = excluded.auto_magic_json, boss_down = excluded.boss_down,
      hp = excluded.hp, mp = excluded.mp, pos_x = excluded.pos_x, pos_z = excluded.pos_z,
      updated_at = datetime('now')
  `).run({
    account_id: p.accountId,
    name: p.charName,
    current_job: p.job,
    gil: p.gil,
    jobs_json: JSON.stringify(p.jobs),
    inventory_json: JSON.stringify(p.inventory),
    equipment_json: JSON.stringify(p.equipment),
    quests_json: JSON.stringify(p.quests),
    appearance_json: JSON.stringify(p.appearance),
    recruited_json: JSON.stringify(p.recruited),
    auto_magic_json: JSON.stringify(p.autoMagic || {}),
    boss_down: p.bossDown ? 1 : 0,
    hp: p.hp,
    mp: p.mp,
    pos_x: p.x,
    pos_z: p.z,
  });
}

function gainExp(p, amount, socket, io) {
  if (p.level >= MAX_LEVEL) return;
  const currentJob = p.job;
  const jobState = p.jobs[currentJob];
  if (!jobState) return;

  jobState.exp += amount;
  socket.emit('log:message', { text: `You gain ${amount} experience points.`, channel: 'gain' });

  while (jobState.exp >= expToNext(jobState.level) && jobState.level < MAX_LEVEL) {
    jobState.exp -= expToNext(jobState.level);
    jobState.level++;
    p.level = jobState.level;

    syncPlayerMaxHPMP(p);
    p.hp = p.maxhp;
    p.mp = p.maxmp;
    p.tp = 0;

    for (const c of p.companions) {
      applyJobStats(c, c.job, p.level);
    }

    io.emit('visual:burst', { x: p.x, z: p.z, color: 0x57a8ff, count: 24, size: 2 });
    socket.emit('log:message', { text: `${p.charName} reaches level ${p.level}!`, channel: 'sys' });
  }
}

function addItem(p, itemId, qty = 1) {
  const row = p.inventory.find(r => r.id === itemId);
  if (row) row.qty += qty; else p.inventory.push({ id: itemId, qty });
}

function countItem(p, itemId) {
  const r = p.inventory.find(r => r.id === itemId);
  return r ? r.qty : 0;
}

function removeItem(p, itemId, qty = 1) {
  const r = p.inventory.find(r => r.id === itemId);
  if (!r || r.qty < qty) return false;
  r.qty -= qty;
  if (r.qty <= 0) p.inventory.splice(p.inventory.indexOf(r), 1);
  return true;
}

function tname(e) {
  return e.kind === 'monster' ? 'the ' + e.def.name : e.name;
}

function applyDamageToMonster(m, amount, actorSid, crit, magic, io) {
  if (m.hp <= 0) return;
  m.hp = Math.max(0, m.hp - amount);
  m.sleep = 0; // wake up

  if (!m.aggroOn) {
    m.aggroOn = actorSid;
  }

  const p = players.get(actorSid);
  io.emit('visual:hit', { actorId: actorSid, targetId: m.id, damage: amount, crit, magic });

  if (p) {
    const lcls = 'cbt';
    if (crit) {
      io.to(actorSid).emit('log:message', { text: `${p.charName} scores a critical hit!`, channel: lcls });
      io.to(actorSid).emit('log:message', { text: `The ${m.def.name} takes ${amount} points of damage.`, channel: lcls });
    } else {
      io.to(actorSid).emit('log:message', { text: `${p.charName} hits the ${m.def.name} for ${amount} points of damage.`, channel: lcls });
    }
  }

  if (m.hp <= 0) {
    m.hp = 0;
    m.alive = false;
    m.deathT = 0;
    m.aggroOn = null;

    io.emit('visual:kill', { targetId: m.id });

    if (p) {
      io.to(actorSid).emit('log:message', { text: `${p.charName}'s party defeats the ${m.def.name}.`, channel: 'gain' });
      gainKillRewards(p, m, io.sockets.sockets.get(actorSid), io);
    }
  }
}

function gainKillRewards(p, m, socket, io) {
  const diff = m.level - p.level;
  let exp = Math.round(m.def.exp * clamp(1 + diff * 0.22, 0.1, 2.2));
  if (m.def.boss) exp = m.def.exp;
  gainExp(p, exp, socket, io);

  const gil = irand(m.def.gil[0], m.def.gil[1]);
  p.gil += gil;
  socket.emit('log:message', { text: `You obtain ${gil} gil.`, channel: 'loot' });

  for (const d of m.def.drops) {
    if (Math.random() < d.c) {
      addItem(p, d.id);
      socket.emit('log:message', { text: `You find ${aAn(ITEMS[d.id].name)} on the ${m.def.name}.`, channel: 'loot' });
      socket.emit('log:message', { text: `${p.charName} obtains ${aAn(ITEMS[d.id].name)}.`, channel: 'loot' });
    }
  }

  // quest progress
  for (const [qid, q] of Object.entries(QUESTS)) {
    const st = p.quests[qid];
    if (st && st.state === 'active' && q.type === 'kill' && q.target === m.typeId && st.n < q.count) {
      st.n++;
      socket.emit('log:message', { text: `${q.name}: ${st.n}/${q.count} slain.`, channel: 'npc' });
      socket.emit('visual:tracker_update', {});
    }
  }

  if (m.def.boss) {
    p.bossDown = true;
    io.to(socket.id).emit('log:message', { text: 'The earth itself seems to sigh in relief. Gorthak the Render is no more!', channel: 'sys' });
  }

  savePlayerToDb(p);
  sendPlayerStatus(socket, p);
}

function meleeSwingPlayer(p, m, socket, io) {
  const as = getPlayerStats(p);
  const ds = monsterStats(m);

  const hitCh = clamp(0.85 + (p.level - m.level) * 0.02 - ds.eva * 0.004, 0.35, 0.97);
  if (Math.random() > hitCh) {
    io.to(socket.id).emit('visual:hit', { actorId: socket.id, targetId: m.id, damage: 0, miss: true });
    io.to(socket.id).emit('log:message', { text: `${p.charName} misses the ${m.def.name}.`, channel: 'cbt' });
    return;
  }

  let crit = Math.random() < as.critCh;
  let dmg = as.atk * (0.85 + Math.random() * 0.3) * (1 - ds.def / (ds.def + 60));
  if (crit) dmg *= 1.6;
  dmg = Math.max(1, Math.round(dmg));

  p.tp = Math.min(100, p.tp + Math.round(as.delay * 5.5));
  applyDamageToMonster(m, dmg, socket.id, crit, false, io);
}

function meleeSwingCompanion(c, p, m, socket, io) {
  const as = getCompanionStats(c, p.level);
  const ds = monsterStats(m);

  const hitCh = clamp(0.85 + (p.level - m.level) * 0.02 - ds.eva * 0.004, 0.35, 0.97);
  if (Math.random() > hitCh) {
    io.to(socket.id).emit('visual:hit', { actorId: c.name, targetId: m.id, damage: 0, miss: true });
    io.to(socket.id).emit('log:message', { text: `${c.name} misses the ${m.def.name}.`, channel: 'cbt' });
    return;
  }

  let crit = Math.random() < as.critCh;
  let dmg = as.atk * (0.85 + Math.random() * 0.3) * (1 - ds.def / (ds.def + 60));
  if (crit) dmg *= 1.6;
  dmg = Math.max(1, Math.round(dmg));

  applyDamageToMonster(m, dmg, socket.id, crit, false, io);
  io.to(socket.id).emit('log:message', { text: `${c.name} hits the ${m.def.name} for ${dmg} points of damage.`, channel: 'cbt' });
}

function resolveAction(p, actionId, targetId, socket, io) {
  const a = ACTIONS[actionId];
  if (!a) return;

  if (a.mp) p.mp -= a.mp;

  p.recasts[actionId] = Date.now() + (a.recast ? a.recast * 1000 : 0);

  const as = getPlayerStats(p);

  if (a.kind === 'ws') {
    const tpMul = 0.85 + p.tp / 110;
    p.tp = 0;
    
    // Resolve Weapon Skill damage authoritatively
    const target = monsters.get(targetId);
    if (!target || target.hp <= 0) return;
    const ds = monsterStats(target);
    const hits = a.hits || 1;
    let total = 0;
    const sneak = p.buffs.sneak;

    for (let h = 0; h < hits; h++) {
      let dmg = as.atk * a.power * tpMul / hits * (0.9 + Math.random() * 0.2) * (1 - ds.def / (ds.def + 60));
      if (sneak || Math.random() < as.critCh) dmg *= 1.6;
      total += dmg;
    }

    delete p.buffs.sneak;

    io.to(socket.id).emit('log:message', { text: `${p.charName} uses ${a.name}.`, channel: 'cbt' });
    applyDamageToMonster(target, total, socket.id, !!sneak, false, io);

    if (a.debuff === 'armorbreak') {
      target.buffs.armorbreak = { t: 20 };
      io.to(socket.id).emit('log:message', { text: `${target.def.name}'s armor is shattered!`, channel: 'magic' });
    }
  } else if (a.type === 'dmg') {
    const target = monsters.get(targetId);
    if (!target || target.hp <= 0) return;
    const ds = monsterStats(target);

    let dmg = a.power * (8 + as.matk * 1.6) * (0.92 + Math.random() * 0.16);
    dmg *= 1 - ds.def / (ds.def + 140);
    dmg = Math.max(1, Math.round(dmg));

    io.to(socket.id).emit('log:message', { text: `${p.charName} casts ${a.name}.`, channel: 'magic' });
    applyDamageToMonster(target, dmg, socket.id, false, true, io);

    if (a.dot) {
      target.dot = { dps: 1.2, t: a.dot, src: socket.id, dia: true, tick: 3 };
    }
    if (a.slow) {
      target.buffs.slowed = { t: 6 };
    }
  } else if (a.type === 'heal') {
    // Find target
    let target = p;
    if (targetId && targetId !== socket.id) {
      // Could be companion
      const comp = p.companions.find(c => c.name === targetId);
      if (comp) target = comp;
    }

    const amount = Math.round(a.power * (6 + as.mnd * 1.5) * (0.95 + Math.random() * 0.1));
    const healed = Math.min(amount, target.maxhp - target.hp);
    target.hp += healed;

    io.to(socket.id).emit('log:message', { text: `${p.charName} casts ${a.name}.`, channel: 'magic' });
    io.to(socket.id).emit('log:message', { text: `${target === p ? p.charName : target.name} recovers ${healed} hit points.`, channel: 'heal' });
    io.emit('visual:hit', { actorId: socket.id, targetId: target === p ? socket.id : target.name, damage: healed, heal: true, actionId });
  } else if (a.type === 'buff') {
    const targets = a.party ? [p, ...p.companions] : [p];
    for (const t of targets) {
      t.buffs[a.buff] = { t: a.dur };
    }
    io.to(socket.id).emit('log:message', { text: `${p.charName} casts ${a.name}.`, channel: 'magic' });
    io.emit('visual:hit', { actorId: socket.id, targetId: socket.id, damage: 0, buff: true, actionId });
  } else if (a.type === 'sleep') {
    const target = monsters.get(targetId);
    if (!target || target.hp <= 0) return;

    io.to(socket.id).emit('log:message', { text: `${p.charName} casts ${a.name}.`, channel: 'magic' });
    if (target.def.boss) {
      io.to(socket.id).emit('log:message', { text: `Gorthak the Render resists the spell!`, channel: 'magic' });
    } else {
      target.sleep = a.dur;
      target.aggroOn = null;
      io.to(socket.id).emit('log:message', { text: `The ${target.def.name} falls asleep.`, channel: 'magic' });
    }
    io.emit('visual:hit', { actorId: socket.id, targetId: target.id, damage: 0, sleep: true, actionId });
  } else if (a.type === 'enmity') {
    const target = monsters.get(targetId);
    if (target) {
      target.aggroOn = socket.id;
      io.to(socket.id).emit('log:message', { text: `${p.charName} provokes the ${target.def.name}!`, channel: 'cbt' });
      io.to(socket.id).emit('visual:floater', { targetId: target.id, text: '!!', style: 'crit' });
    }
  } else if (a.type === 'steal') {
    const target = monsters.get(targetId);
    if (target && target.hp > 0) {
      if (Math.random() < 0.7) {
        const g = irand(15, 20 + target.level * 6);
        p.gil += g;
        io.to(socket.id).emit('log:message', { text: `${p.charName} steals ${g} gil from the ${target.def.name}!`, channel: 'loot' });
      } else {
        io.to(socket.id).emit('log:message', { text: 'You fail to steal anything.', channel: 'cbt' });
      }
    }
  }

  savePlayerToDb(p);
  sendPlayerStatus(socket, p);
}

/**
 * Attach Socket.IO event handlers to the server.
 * @param {import('socket.io').Server} io
 */
export function initChat(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Missing auth token'));
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      socket.accountId = payload.accountId;
      socket.username = payload.username;
      next();
    } catch (e) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[ws] connected: ${socket.username} (${socket.id})`);
    trackedPlayers.set(socket.id, new Set());
    trackedMonsters.set(socket.id, new Set());

    // ── player:enter — client reports character name & details ───
    socket.on('player:enter', ({ charName, job, appearance, x, z, heading, moving }) => {
      if (typeof charName !== 'string' || charName.length === 0) return;

      let charRow = db.prepare('SELECT * FROM characters WHERE account_id = ?').get(socket.accountId);

      if (!charRow) {
        db.prepare(`
          INSERT INTO characters (account_id, name, current_job, gil, jobs_json, inventory_json, equipment_json, quests_json, appearance_json, recruited_json, auto_magic_json, boss_down, hp, mp, pos_x, pos_z, updated_at)
          VALUES (?, ?, ?, 300, '{"WAR":{"level":1,"exp":0},"MNK":{"level":1,"exp":0},"WHM":{"level":1,"exp":0},"BLM":{"level":1,"exp":0},"THF":{"level":1,"exp":0}}', '[]', '{"WAR":{"weapon":"onion_sword","armor":"tunic"},"MNK":{"weapon":"cesti","armor":"tunic"},"WHM":{"weapon":"bronze_rod","armor":"tunic"},"BLM":{"weapon":"ash_staff","armor":"tunic"},"THF":{"weapon":"bronze_knife","armor":"tunic"}}', '{}', ?, '{}', '{}', 0, 38, 0, ?, ?, datetime('now'))
        `).run(
          socket.accountId,
          charName.slice(0, 14),
          job || 'WAR',
          JSON.stringify(appearance || { skin: 0xd8a87c, hair: 0x4a2f1d }),
          Number(x) || 3,
          Number(z) || 4
        );
        charRow = db.prepare('SELECT * FROM characters WHERE account_id = ?').get(socket.accountId);
      }

      const jobs = JSON.parse(charRow.jobs_json);
      const currentJob = charRow.current_job;
      const level = jobs[currentJob]?.level || 1;

      const p = {
        accountId: socket.accountId,
        charName: charRow.name,
        job: currentJob,
        jobs,
        gil: charRow.gil,
        inventory: JSON.parse(charRow.inventory_json),
        equipment: JSON.parse(charRow.equipment_json),
        quests: JSON.parse(charRow.quests_json),
        appearance: JSON.parse(charRow.appearance_json),
        recruited: JSON.parse(charRow.recruited_json),
        autoMagic: JSON.parse(charRow.auto_magic_json),
        bossDown: !!charRow.boss_down,
        hp: charRow.hp !== null ? charRow.hp : 38,
        mp: charRow.mp !== null ? charRow.mp : 0,
        tp: 0,
        x: Number(x) || Number(charRow.pos_x) || 3,
        z: Number(z) || Number(charRow.pos_z) || 4,
        heading: Number(heading) || 0,
        moving: !!moving,
        buffs: {},
        recasts: {},
        casting: null,
        engagedTargetId: null,
        attackTimer: 0,
        lastUpdate: Date.now(),
        companions: [],
      };

      p.level = level;
      syncPlayerMaxHPMP(p);

      for (const compName of ['Garrick', 'Lina']) {
        if (p.recruited[compName]) {
          const cJob = compName === 'Garrick' ? 'WAR' : 'WHM';
          const comp = {
            name: compName,
            job: cJob,
            hp: 10, maxhp: 10, mp: 0, maxmp: 0, tp: 0,
            x: p.x, z: p.z,
            buffs: {},
            casting: null,
            attackTimer: 0,
          };
          applyJobStats(comp, cJob, level);
          p.companions.push(comp);
        }
      }

      players.set(socket.id, p);
      broadcastCount(io);
      sendPlayerStatus(socket, p);
      console.log(`[ws] ${charName} entered at (${p.x|0}, ${p.z|0}) — ${players.size} online`);
    });

    // ── player:position — updates player and companion coordinates ───
    socket.on('player:position', ({ x, z, heading, moving, companions }) => {
      const entry = players.get(socket.id);
      if (entry) {
        entry.x = Number(x) || 0;
        entry.z = Number(z) || 0;
        if (heading !== undefined) entry.heading = Number(heading) || 0;
        if (moving !== undefined) entry.moving = !!moving;
        entry.lastUpdate = Date.now();

        if (Array.isArray(companions)) {
          for (const cData of companions) {
            const comp = entry.companions.find(c => c.name === cData.name);
            if (comp) {
              comp.x = cData.x;
              comp.z = cData.z;
              comp.hp = cData.hp;
              comp.mp = cData.mp;
            }
          }
        }
      }
    });

    // ── combat events ───────────────────────────────────────────────
    socket.on('combat:engage', ({ targetId }) => {
      const p = players.get(socket.id);
      if (p) {
        p.engagedTargetId = targetId;
        p.attackTimer = 0; // strike instantly on engage
        for (const c of p.companions) c.attackTimer = 0;
      }
    });

    socket.on('combat:disengage', () => {
      const p = players.get(socket.id);
      if (p) {
        p.engagedTargetId = null;
      }
    });

    socket.on('combat:use_action', ({ actionId, targetId }) => {
      const p = players.get(socket.id);
      if (!p || p.hp <= 0) return;

      const a = ACTIONS[actionId];
      if (!a) return;

      const readyAt = p.recasts[actionId] || 0;
      if (Date.now() < readyAt) {
        socket.emit('log:message', { text: `${a.name} is not ready.`, channel: 'sys' });
        return;
      }

      if (a.mp && p.mp < a.mp) {
        socket.emit('log:message', { text: 'Not enough MP.', channel: 'sys' });
        return;
      }

      if (a.kind === 'ws' && p.tp < 100) {
        socket.emit('log:message', { text: 'Not enough TP.', channel: 'sys' });
        return;
      }

      if (p.casting) {
        socket.emit('log:message', { text: 'You are busy casting.', channel: 'sys' });
        return;
      }

      // Resolve consumable directly
      if (a.kind === 'item') {
        if (countItem(p, a.item) <= 0) {
          socket.emit('log:message', { text: `You have no ${ITEMS[a.item].name}s left.`, channel: 'sys' });
          return;
        }

        const itemReadyAt = p.recasts['item'] || 0;
        if (Date.now() < itemReadyAt) {
          socket.emit('log:message', { text: 'You must wait before using another item.', channel: 'sys' });
          return;
        }

        const it = ITEMS[a.item];
        removeItem(p, a.item);
        p.recasts['item'] = Date.now() + 5000;

        socket.emit('log:message', { text: `You use ${aAn(it.name)}.`, channel: 'cbt' });
        if (it.heal) {
          const n = Math.min(it.heal, p.maxhp - p.hp);
          p.hp += n;
          io.emit('visual:hit', { actorId: socket.id, targetId: socket.id, damage: n, heal: true, actionId });
          socket.emit('log:message', { text: `You recover ${n} hit points.`, channel: 'heal' });
        }
        if (it.mpheal) {
          const n = Math.min(it.mpheal, p.maxmp - p.mp);
          p.mp += n;
          io.emit('visual:hit', { actorId: socket.id, targetId: socket.id, damage: n, heal: true, actionId });
          socket.emit('log:message', { text: `You recover ${n} magic points.`, channel: 'heal' });
        }

        savePlayerToDb(p);
        sendPlayerStatus(socket, p);
        return;
      }

      if (a.kind === 'spell') {
        p.casting = { actionId, targetId, t: 0, total: a.cast };
        io.emit('visual:cast_start', { actorId: socket.id, actionId, targetId, castTime: a.cast });
      } else {
        resolveAction(p, actionId, targetId, socket, io);
      }
    });

    // ── gathering interacts ─────────────────────────────────────────
    socket.on('gather:interact', ({ nodeId }) => {
      const p = players.get(socket.id);
      const node = nodes.get(nodeId);
      if (!p || p.hp <= 0 || !node || !node.available) return;

      const dist = Math.hypot(node.x - p.x, node.z - p.z);
      if (dist > 5) {
        socket.emit('log:message', { text: 'Node is too far away.', channel: 'sys' });
        return;
      }

      p.casting = { gather: nodeId, t: 0, total: 2.2 };
      io.emit('visual:cast_start', { actorId: socket.id, actionId: 'gather', targetId: nodeId, castTime: 2.2 });
    });

    // ── quest actions ───────────────────────────────────────────────
    socket.on('quest:accept', ({ qid }) => {
      const p = players.get(socket.id);
      if (!p || p.hp <= 0) return;

      const q = QUESTS[qid];
      if (!q) return;

      p.quests[qid] = { state: 'active', n: 0 };
      socket.emit('log:message', { text: `Quest accepted: ${q.name}.`, channel: 'npc' });

      if (q.type === 'deliver') {
        addItem(p, q.item);
        socket.emit('log:message', { text: `You receive the ${ITEMS[q.item].name}.`, channel: 'gain' });
      }

      savePlayerToDb(p);
      sendPlayerStatus(socket, p);
    });

    socket.on('quest:reward', ({ qid }) => {
      const p = players.get(socket.id);
      if (!p || p.hp <= 0) return;

      const q = QUESTS[qid];
      const st = p.quests[qid];
      if (!q || !st || st.state !== 'active') return;

      if (q.type === 'collect' && countItem(p, q.target) < q.count) return;
      if (q.type === 'deliver' && countItem(p, q.item) < 1) return;

      if (q.type === 'collect') removeItem(p, q.target, q.count);
      if (q.type === 'deliver') removeItem(p, q.item, 1);

      st.state = 'rewarded';

      if (q.reward.gil) {
        p.gil += q.reward.gil;
        socket.emit('log:message', { text: `You receive ${q.reward.gil} gil.`, channel: 'gain' });
      }

      if (q.reward.item) {
        addItem(p, q.reward.item);
        socket.emit('log:message', { text: `You receive ${ITEMS[q.reward.item].name}!`, channel: 'gain' });
      }

      socket.emit('log:message', { text: `Quest complete: ${q.name}!`, channel: 'sys' });
      io.emit('visual:burst', { x: p.x, z: p.z, color: 0xffe066, count: 26, size: 2.2 });

      if (q.reward.exp) {
        gainExp(p, q.reward.exp, socket, io);
      }

      savePlayerToDb(p);
      sendPlayerStatus(socket, p);
    });

    // ── shop trades ──────────────────────────────────────────────────
    socket.on('shop:buy', ({ id }) => {
      const p = players.get(socket.id);
      const it = ITEMS[id];
      if (!p || !it || p.gil < it.price) return;

      p.gil -= it.price;
      addItem(p, id);
      socket.emit('log:message', { text: `You buy ${it.name} for ${it.price} gil.`, channel: 'gain' });

      savePlayerToDb(p);
      sendPlayerStatus(socket, p);
    });

    socket.on('shop:sell', ({ id }) => {
      const p = players.get(socket.id);
      const it = ITEMS[id];
      if (!p || !it || it.type === 'key') return;

      if (removeItem(p, id)) {
        const val = Math.max(1, Math.floor((it.price || 10) * 0.3));
        p.gil += val;
        socket.emit('log:message', { text: `You sell ${it.name} for ${val} gil.`, channel: 'gain' });
        savePlayerToDb(p);
        sendPlayerStatus(socket, p);
      }
    });

    // ── job changes, crafting, equip ─────────────────────────────────
    socket.on('job:change', ({ job }) => {
      const p = players.get(socket.id);
      if (!p || p.hp <= 0 || p.engagedTargetId || p.casting) return;

      p.job = job;
      p.level = p.jobs[job]?.level || 1;
      syncPlayerMaxHPMP(p);

      for (const c of p.companions) {
        applyJobStats(c, c.job, p.level);
      }

      io.emit('visual:burst', { x: p.x, z: p.z, color: 0x57a8ff, count: 24, size: 2 });
      socket.emit('log:message', { text: `You are now a level ${p.level} ${JOBS[job].name}.`, channel: 'sys' });

      savePlayerToDb(p);
      sendPlayerStatus(socket, p);
    });

    socket.on('craft:recipe', ({ rid }) => {
      const p = players.get(socket.id);
      const r = RECIPES.find(x => x.id === rid);
      if (!p || !r) return;

      for (const m of r.mats) {
        if (countItem(p, m.id) < m.qty) {
          socket.emit('log:message', { text: 'You lack the materials.', channel: 'sys' });
          return;
        }
      }

      for (const m of r.mats) removeItem(p, m.id, m.qty);
      addItem(p, r.result, r.qty);

      socket.emit('log:message', { text: `You synthesize ${r.qty > 1 ? r.qty + ' ' : ''}${ITEMS[r.result].name}${r.qty > 1 ? 's' : ''}!`, channel: 'gain' });
      io.emit('visual:burst', { x: p.x, z: p.z, color: 0x74c0fc, count: 16, size: 1.8 });

      savePlayerToDb(p);
      sendPlayerStatus(socket, p);
    });

    socket.on('equip:item', ({ slot, id }) => {
      const p = players.get(socket.id);
      if (!p) return;

      p.equipment[p.job] = p.equipment[p.job] || {};
      p.equipment[p.job][slot] = id;

      syncPlayerMaxHPMP(p);
      savePlayerToDb(p);
      sendPlayerStatus(socket, p);
    });

    socket.on('npc:bless', () => {
      const p = players.get(socket.id);
      if (!p || p.hp <= 0) return;

      p.hp = p.maxhp;
      p.mp = p.maxmp;
      for (const c of p.companions) {
        c.hp = c.maxhp;
        c.mp = c.maxmp;
      }

      socket.emit('log:message', { text: 'A warm light washes over the party. HP/MP fully restored.', channel: 'magic' });
      io.emit('visual:burst', { x: p.x, z: p.z, color: 0x69db7c, count: 16, size: 1.5 });

      sendPlayerStatus(socket, p);
    });

    socket.on('player:respawn', () => {
      const p = players.get(socket.id);
      if (!p || p.hp > 0) return;

      p.hp = Math.round(p.maxhp * 0.4);
      p.mp = 0;
      p.tp = 0;
      p.x = 3;
      p.z = 4;
      p.engagedTargetId = null;

      socket.emit('visual:respawn', { x: 3, z: 4 });
      sendPlayerStatus(socket, p);
    });

    // ── chat events ──────────────────────────────────────────────────
    socket.on('chat:say', ({ text }) => {
      const sender = players.get(socket.id);
      if (!sender || typeof text !== 'string' || !text.trim()) return;
      const msg = {
        from: sender.charName,
        text: text.trim().slice(0, 200),
        channel: 'say',
        timestamp: Date.now(),
      };
      const RADIUS = 20;
      for (const [sid, p] of players) {
        const dx = p.x - sender.x;
        const dz = p.z - sender.z;
        if (dx * dx + dz * dz <= RADIUS * RADIUS) {
          io.to(sid).emit('chat:message', msg);
        }
      }
    });

    socket.on('chat:shout', ({ text }) => {
      const sender = players.get(socket.id);
      if (!sender || typeof text !== 'string' || !text.trim()) return;
      io.emit('chat:message', {
        from: sender.charName,
        text: text.trim().slice(0, 200),
        channel: 'shout',
        timestamp: Date.now(),
      });
    });

    socket.on('chat:party', ({ text }) => {
      const sender = players.get(socket.id);
      if (!sender || typeof text !== 'string' || !text.trim()) return;
      socket.emit('chat:message', {
        from: sender.charName,
        text: text.trim().slice(0, 200),
        channel: 'party',
        timestamp: Date.now(),
      });
    });

    // ── disconnect ───────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      const entry = players.get(socket.id);
      if (entry) {
        savePlayerToDb(entry);
      }
      players.delete(socket.id);
      trackedPlayers.delete(socket.id);
      trackedMonsters.delete(socket.id);
      broadcastCount(io);
      io.emit('player:left', { id: socket.id });
      console.log(`[ws] disconnected: ${entry?.charName || socket.username} (${reason}) — ${players.size} online`);
    });
  });

  // ── Authoritative 10Hz World Loop (AI & tick) ──────────────────
  setInterval(() => {
    // 1. Update Gathering Nodes
    for (const [id, n] of nodes) {
      if (!n.available) {
        n.respawnT -= 0.1;
        if (n.respawnT <= 0) {
          n.available = true;
          io.emit('node:state', { id, available: true });
        }
      }
    }

    // 2. Update Players (casting timer increments)
    for (const [sid, p] of players) {
      if (p.casting) {
        // Casting interrupts if they move
        if (p.moving && !p.casting.gather) {
          p.casting = null;
          io.to(sid).emit('visual:cast_cancel', {});
          io.to(sid).emit('log:message', { text: 'Casting interrupted.', channel: 'sys' });
        } else {
          p.casting.t += 0.1;
          if (p.casting.t >= p.casting.total) {
            const cast = p.casting;
            p.casting = null;
            if (cast.gather) {
              // Node harvest completes
              const node = nodes.get(cast.gather);
              if (node && node.available) {
                const table = { logging: 'maple_log', mining: 'copper_ore', herb: 'wild_herb' };
                const itemId = table[node.type];
                addItem(p, itemId);
                io.to(sid).emit('log:message', { text: `You obtain ${ITEMS[itemId].name}!`, channel: 'gain' });
                
                if (node.type === 'mining' && Math.random() < 0.2) {
                  addItem(p, 'worm_silica');
                  io.to(sid).emit('log:message', { text: 'You also find a Worm Silica!', channel: 'gain' });
                }

                node.available = false;
                node.respawnT = 40;
                io.emit('node:state', { id: node.id, available: false, harvestX: node.x, harvestZ: node.z });

                // Update active quests
                for (const [qid, q] of Object.entries(QUESTS)) {
                  const st = p.quests[qid];
                  if (st && st.state === 'active' && q.type === 'collect' && q.target === itemId && st.n < q.count) {
                    io.to(sid).emit('visual:tracker_update', {});
                  }
                }

                savePlayerToDb(p);
                sendPlayerStatus(io.sockets.sockets.get(sid), p);
              }
            } else {
              resolveAction(p, cast.actionId, cast.targetId, io.sockets.sockets.get(sid), io);
            }
          }
        }
      }

      // Tick player auto-attack
      if (p.engagedTargetId && p.hp > 0) {
        const m = monsters.get(p.engagedTargetId);
        if (!m || m.hp <= 0) {
          p.engagedTargetId = null;
        } else {
          const dist = Math.hypot(m.x - p.x, m.z - p.z);
          if (dist <= 2.6) {
            p.attackTimer -= 0.1;
            if (p.attackTimer <= 0) {
              meleeSwingPlayer(p, m, io.sockets.sockets.get(sid), io);
              p.attackTimer = getPlayerStats(p).delay;
            }
          }

          // Companion auto-attacks
          for (const c of p.companions) {
            if (c.hp > 0) {
              if (c.job === 'WHM') {
                // Healer companion ticks
                c.attackTimer -= 0.1;
                if (c.attackTimer <= 0) {
                  let mostWounded = p;
                  let lowestFrac = p.hp / p.maxhp;
                  for (const comp of p.companions) {
                    const frac = comp.hp / comp.maxhp;
                    if (frac < lowestFrac) { lowestFrac = frac; mostWounded = comp; }
                  }

                  if (lowestFrac < 0.65) {
                    const cureId = p.level >= 11 ? 'cure2' : 'cure';
                    const a = ACTIONS[cureId];
                    c.recasts = c.recasts || {};
                    const readyAt = c.recasts[cureId] || 0;
                    if (Date.now() >= readyAt) {
                      c.recasts[cureId] = Date.now() + (a.recast * 1000 || 4000);
                      c.attackTimer = a.cast || 2.0;

                      io.to(sid).emit('visual:cast_start', { actorId: c.name, actionId: cureId, targetId: mostWounded === p ? sid : mostWounded.name, castTime: a.cast });

                      setTimeout(() => {
                        if (!players.get(sid)) return;
                        if (c.hp <= 0 || !mostWounded) return;

                        const stats = getCompanionStats(c, p.level);
                        const amount = Math.round(a.power * (6 + stats.mnd * 1.5) * (0.95 + Math.random() * 0.1));
                        const healed = Math.min(amount, mostWounded.maxhp - mostWounded.hp);
                        mostWounded.hp += healed;

                        io.to(sid).emit('log:message', { text: `${c.name} casts ${a.name}.`, channel: 'magic' });
                        io.to(sid).emit('log:message', { text: `${mostWounded === p ? p.charName : mostWounded.name} recovers ${healed} hit points.`, channel: 'heal' });
                        io.emit('visual:hit', { actorId: c.name, targetId: mostWounded === p ? sid : mostWounded.name, damage: healed, heal: true, actionId: cureId });
                        sendPlayerStatus(io.sockets.sockets.get(sid), p);
                      }, a.cast * 1000);
                    }
                  }
                }
              } else {
                // Combat companion auto-attack
                const cDist = Math.hypot(m.x - c.x, m.z - c.z);
                if (cDist <= 2.6) {
                  c.attackTimer -= 0.1;
                  if (c.attackTimer <= 0) {
                    meleeSwingCompanion(c, p, m, io.sockets.sockets.get(sid), io);
                    c.attackTimer = getCompanionStats(c, p.level).delay;
                  }
                }
              }
            }
          }
        }
      }
    }

    // 3. Update Monsters AI & Tick
    for (const [mid, m] of monsters) {
      if (m.hp <= 0) {
        m.deathT += 0.1;
        const respawnTime = m.def.boss ? 240 : 30;
        if (m.deathT >= respawnTime) {
          m.hp = m.maxhp;
          m.alive = true;
          m.deathT = 0;
          m.sleep = 0;
          m.dot = null;
          m.buffs = {};
          m.aggroOn = null;
          m.dest = null;
          m.returning = false;
          m.x = m.home.x;
          m.z = m.home.z;
          m.heading = Math.random() * Math.PI * 2;
        }
        continue;
      }

      // Check sleep
      if (m.sleep > 0) {
        m.sleep -= 0.1;
        continue;
      }

      // Check DoT
      if (m.dot) {
        m.dot.t -= 0.1;
        m.dot.tick -= 0.1;
        if (m.dot.tick <= 0) {
          m.dot.tick = 3.0;
          const dotDmg = Math.round(3 + m.level * 0.4);
          applyDamageToMonster(m, dotDmg, m.dot.src, false, true, io);
        }
        if (m.dot.t <= 0) m.dot = null;
        if (m.hp <= 0) continue;
      }

      // Check armor break debuff
      for (const [k, b] of Object.entries(m.buffs)) {
        b.t -= 0.1;
        if (b.t <= 0) delete m.buffs[k];
      }

      // Find if aggro target exists and is alive
      let aggroTarget = null;
      if (m.aggroOn) {
        if (m.aggroOn.includes(':')) {
          const [sid, compName] = m.aggroOn.split(':');
          const p = players.get(sid);
          if (p) {
            aggroTarget = p.companions.find(c => c.name === compName && c.hp > 0);
          }
        } else {
          const p = players.get(m.aggroOn);
          if (p && p.hp > 0) aggroTarget = p;
        }

        // Drop aggro if target dead or player logged out
        if (!aggroTarget) {
          m.aggroOn = null;
          m.dest = { x: m.home.x, z: m.home.z };
          m.returning = true;
        }
      }

      const distHome = Math.hypot(m.x - m.home.x, m.z - m.home.z);
      if (aggroTarget && distHome > 46) {
        // Leash break
        m.aggroOn = null;
        m.dest = { x: m.home.x, z: m.home.z };
        m.returning = true;
        const pSid = m.aggroOn?.includes(':') ? m.aggroOn.split(':')[0] : m.aggroOn;
        if (pSid) io.to(pSid).emit('log:message', { text: `The ${m.def.name} gives up the chase.`, channel: 'sys' });
      }

      if (aggroTarget) {
        // Chase and Attack
        const dx = aggroTarget.x - m.x;
        const dz = aggroTarget.z - m.z;
        const d = Math.hypot(dx, dz);
        const range = m.def.boss ? 3.4 : 1.9;

        if (d > range) {
          // Move towards target
          const speed = m.def.speed * (m.buffs.slowed ? 0.55 : 1);
          const step = speed * 0.1;
          if (d > step) {
            m.x += (dx / d) * step;
            m.z += (dz / d) * step;
            m.heading = Math.atan2(dx, dz);
            m.moving = true;
          }
        } else {
          // In range, face and attack
          m.moving = false;
          m.heading = Math.atan2(dx, dz);
          m.attackTimer -= 0.1;

          if (m.attackTimer <= 0) {
            m.attackTimer = m.attackDelay;

            // Attack!
            const as = monsterStats(m);
            const isPlayer = !aggroTarget.name || aggroTarget.name !== m.aggroOn?.split(':')[1];
            const pSid = isPlayer ? m.aggroOn : m.aggroOn.split(':')[0];
            const p = players.get(pSid);

            if (p) {
              const ds = isPlayer ? getPlayerStats(p) : getCompanionStats(aggroTarget, p.level);
              const targetLevel = isPlayer ? p.level : p.level;

              // Hit check
              const hitCh = clamp(0.85 + (m.level - targetLevel) * 0.02 - ds.eva * 0.004, 0.35, 0.97);
              if (Math.random() > hitCh) {
                // Miss
                io.to(pSid).emit('visual:hit', { actorId: m.id, targetId: isPlayer ? pSid : aggroTarget.name, damage: 0, miss: true });
                io.to(pSid).emit('log:message', { text: `The ${m.def.name} misses ${isPlayer ? 'you' : aggroTarget.name}.`, channel: 'dmg-in' });
              } else {
                let crit = Math.random() < 0.05;
                let dmg = as.atk * (0.85 + Math.random() * 0.3) * (1 - ds.def / (ds.def + 60));
                if (crit) dmg *= 1.6;
                dmg = Math.max(1, Math.round(dmg));

                if (isPlayer) {
                  p.hp = Math.max(0, p.hp - dmg);
                  p.tp = Math.min(100, p.tp + 6);
                  p.sleep = 0; // wakes up

                  io.to(pSid).emit('visual:hit', { actorId: m.id, targetId: pSid, damage: dmg, crit });
                  io.to(pSid).emit('log:message', { text: `The ${m.def.name} hits you for ${dmg} points of damage.`, channel: 'dmg-in' });

                  if (p.hp <= 0) {
                    p.hp = 0;
                    io.to(pSid).emit('log:message', { text: 'You have been knocked out…', channel: 'dmg-in' });
                    io.to(pSid).emit('visual:kill', { targetId: pSid });
                    
                    // Reset all monsters aggroed on this player
                    p.engagedTargetId = null;
                    for (const otherM of monsters.values()) {
                      if (otherM.aggroOn?.startsWith(pSid)) {
                        otherM.aggroOn = null;
                        otherM.dest = { x: otherM.home.x, z: otherM.home.z };
                        otherM.returning = true;
                      }
                    }
                  }
                } else {
                  // Hit companion
                  aggroTarget.hp = Math.max(0, aggroTarget.hp - dmg);
                  aggroTarget.sleep = 0;

                  io.to(pSid).emit('visual:hit', { actorId: m.id, targetId: aggroTarget.name, damage: dmg, crit });
                  io.to(pSid).emit('log:message', { text: `The ${m.def.name} hits ${aggroTarget.name} for ${dmg} points of damage.`, channel: 'dmg-in' });

                  if (aggroTarget.hp <= 0) {
                    aggroTarget.hp = 0;
                    io.to(pSid).emit('log:message', { text: `${aggroTarget.name} falls to the ground!`, channel: 'dmg-in' });
                    
                    // Switch monster aggro to player
                    m.aggroOn = pSid;
                  }
                }
              }

              // Boss AoE stomp
              if (m.def.boss && Math.random() < 0.25) {
                io.to(pSid).emit('log:message', { text: 'Gorthak rears up and slams the earth!', channel: 'dmg-in' });
                
                // Stomp player
                if (p.hp > 0 && Math.hypot(p.x - m.x, p.z - m.z) < 6) {
                  const sDmg = Math.round(as.atk * 0.8 * (0.9 + Math.random() * 0.2));
                  p.hp = Math.max(0, p.hp - sDmg);
                  io.to(pSid).emit('visual:hit', { actorId: m.id, targetId: pSid, damage: sDmg, magic: true });
                  io.to(pSid).emit('log:message', { text: `You take ${sDmg} points of damage.`, channel: 'dmg-in' });
                }

                // Stomp companions
                for (const c of p.companions) {
                  if (c.hp > 0 && Math.hypot(c.x - m.x, c.z - m.z) < 6) {
                    const sDmg = Math.round(as.atk * 0.8 * (0.9 + Math.random() * 0.2));
                    c.hp = Math.max(0, c.hp - sDmg);
                    io.to(pSid).emit('visual:hit', { actorId: m.id, targetId: c.name, damage: sDmg, magic: true });
                    io.to(pSid).emit('log:message', { text: `${c.name} takes ${sDmg} points of damage.`, channel: 'dmg-in' });
                  }
                }

                io.emit('visual:burst', { x: m.x, z: m.z, color: 0x9b6cd6, count: 26, size: 3 });
              }

              sendPlayerStatus(io.sockets.sockets.get(pSid), p);
            }
          }
        }
      } else {
        // Wandering / Sight aggro scan
        // Senses are disabled while returning home
        if (m.def.aggressive && !m.returning) {
          for (const [sid, p] of players) {
            if (p.hp > 0 && Math.hypot(p.x - m.x, p.z - m.z) < m.def.sight) {
              m.aggroOn = sid;
              io.to(sid).emit('log:message', { text: `The ${m.def.name} notices you and attacks!`, channel: 'dmg-in' });
              io.to(sid).emit('visual:floater', { targetId: m.id, text: '!', style: 'crit' });
              break;
            }
            
            for (const c of p.companions) {
              if (c.hp > 0 && Math.hypot(c.x - m.x, c.z - m.z) < m.def.sight) {
                m.aggroOn = `${sid}:${c.name}`;
                io.to(sid).emit('log:message', { text: `The ${m.def.name} notices ${c.name} and attacks!`, channel: 'dmg-in' });
                io.to(sid).emit('visual:floater', { targetId: m.id, text: '!', style: 'crit' });
                break;
              }
            }
          }
        }

        // Wander AI
        m.wanderT = (m.wanderT || 0) - 0.1;
        if (m.dest) {
          const dx = m.dest.x - m.x;
          const dz = m.dest.z - m.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.5) {
            m.dest = null;
            m.returning = false;
            m.moving = false;
          } else {
            const speed = m.def.speed * 0.45;
            const step = speed * 0.1;
            m.x += (dx / d) * step;
            m.z += (dz / d) * step;
            m.heading = Math.atan2(dx, dz);
            m.moving = true;
          }
        } else if (m.wanderT <= 0) {
          m.wanderT = irand(4, 10);
          const a = Math.random() * Math.PI * 2;
          const r = irand(2, 8);
          m.dest = {
            x: clamp(m.home.x + Math.cos(a) * r, -92, 92),
            z: clamp(m.home.z + Math.sin(a) * r, -92, 92),
          };
        }
      }
    }

    // 4. Send Player snapshots (culling players)
    const AOI_RADIUS = 50;
    for (const [sid1, p1] of players) {
      const prevTracked = trackedPlayers.get(sid1) || new Set();
      const currentTracked = new Set();
      const snapshot = [];

      for (const [sid2, p2] of players) {
        if (sid1 === sid2) continue;

        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        if (dx * dx + dz * dz <= AOI_RADIUS * AOI_RADIUS) {
          currentTracked.add(sid2);
          snapshot.push({
            id: sid2,
            charName: p2.charName,
            job: p2.job,
            appearance: p2.appearance,
            x: p2.x,
            z: p2.z,
            heading: p2.heading,
            moving: p2.moving,
          });
        }
      }

      for (const oldSid of prevTracked) {
        if (!currentTracked.has(oldSid)) {
          snapshot.push({ id: oldSid, gone: true });
        }
      }

      trackedPlayers.set(sid1, currentTracked);

      if (snapshot.length > 0) {
        io.to(sid1).emit('players:snapshot', snapshot);
      }
    }

    // 5. Send Monster snapshots (AOI culling for monsters)
    for (const [sid, p] of players) {
      const prevTracked = trackedMonsters.get(sid) || new Set();
      const currentTracked = new Set();
      const snapshot = [];

      for (const m of monsters.values()) {
        const dx = m.x - p.x;
        const dz = m.z - p.z;
        if (dx * dx + dz * dz <= AOI_RADIUS * AOI_RADIUS) {
          currentTracked.add(m.id);
          snapshot.push({
            id: m.id,
            typeId: m.typeId,
            level: m.level,
            hp: m.hp,
            maxhp: m.maxhp,
            x: Number(m.x.toFixed(2)),
            z: Number(m.z.toFixed(2)),
            heading: Number(m.heading.toFixed(2)),
            moving: m.moving,
            alive: m.hp > 0,
            sleep: m.sleep > 0,
          });
        }
      }

      for (const oldMid of prevTracked) {
        if (!currentTracked.has(oldMid)) {
          snapshot.push({ id: oldMid, gone: true });
        }
      }

      trackedMonsters.set(sid, currentTracked);

      if (snapshot.length > 0) {
        io.to(sid).emit('monsters:snapshot', snapshot);
      }
    }
  }, 100);
}
