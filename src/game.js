// Core gameplay: player & party, combat, monster/companion AI, progression,
// quests, items, crafting, gathering, vendors, save/load.
import * as THREE from 'three';
import { S, clamp, lerp, rand, irand, pick } from './state.js';
import { JOBS, ACTIONS, ITEMS, MONSTERS, SPAWNS, NPCS, QUESTS, RECIPES, VENDOR_STOCK, expToNext, MAX_LEVEL, STARTER_WEAPON, jobActions } from './data.js';
import { Entity, makeNameplate, spawnMonster, makeCharacterModel, setLoopAnim, playOnce } from './entities.js';
import * as UI from './ui.js';
import { env, resolveCollision, findOpenSpot, addCollider } from './world.js';
import * as API from './api.js';
import * as Socket from './socket.js';
import * as Puppets from './puppets.js';
import * as FX from './effects.js';
import { spawnBurst } from './effects.js';
export { spawnBurst };

export const G = { now: 0, targetRing: null, pendingInteract: null, combatTimer: 0, saveTimer: 0 };

// =====================================================================
// stats
// =====================================================================
export function getStats(e) {
  const job = JOBS[e.job];
  const lv = e.level;
  const weapon = e.weaponItem ? ITEMS[e.weaponItem] : null;
  const armor = e.armorItem ? ITEMS[e.armorItem] : null;
  let atk = (weapon ? weapon.dmg : 3) + job.str * 0.55 + lv * 1.5;
  let def = (armor ? armor.def : 0) + job.vit * 0.5 + lv * 1.1;
  let matk = job.int * 1.1 + lv * 0.9 + (weapon && weapon.matk ? weapon.matk : 0);
  let mnd = job.mnd * 1.0 + lv * 0.7;
  let eva = job.agi * 0.8 + lv;
  let speedMul = 1, critCh = e.job === 'THF' ? 0.16 : 0.08;
  const b = e.buffs;
  if (b.berserk) { atk *= 1.35; def *= 0.85; }
  if (b.defender) { def *= 1.4; atk *= 0.85; }
  if (b.protect) { def *= 1.25; }
  if (b.boost) { atk *= 1.3; }
  if (b.dodge) { eva *= 1.6; }
  if (b.flee) { speedMul = 2; }
  return { atk, def, matk, mnd, eva, speedMul, critCh, delay: weapon ? weapon.delay : 2.6 };
}

function monsterStats(e) {
  const d = e.def;
  const lvB = 1 + (e.level - d.lv[0]) * 0.12;
  let def = d.def * lvB + e.level * 0.8;
  if (e.buffs.armorbreak || (e.dot && e.dot.dia)) def *= 0.75;
  return { atk: d.dmg * lvB + e.level, def, eva: e.level * 1.1 + 4, speedMul: e.buffs.slowed ? 0.55 : 1, critCh: 0.05, delay: e.attackDelay };
}

export function statsOf(e) { return e.kind === 'monster' ? monsterStats(e) : getStats(e); }

// =====================================================================
// inventory
// =====================================================================
export function addItem(id, qty = 1) {
  const row = S.inventory.find(r => r.id === id);
  if (row) row.qty += qty; else S.inventory.push({ id, qty });
}
export function countItem(id) { const r = S.inventory.find(r => r.id === id); return r ? r.qty : 0; }
export function removeItem(id, qty = 1) {
  const r = S.inventory.find(r => r.id === id);
  if (!r || r.qty < qty) return false;
  r.qty -= qty;
  if (r.qty <= 0) S.inventory.splice(S.inventory.indexOf(r), 1);
  return true;
}

// =====================================================================
// player / party creation
// =====================================================================
function applyJobStats(e, job, level, fullHeal = true) {
  const j = JOBS[job];
  e.job = job; e.level = level;
  e.maxhp = Math.round(j.baseHP + j.hpGain * (level - 1) + (e.armorItem === 'seer_tunic' ? 0 : 0));
  e.maxmp = Math.round(j.baseMP + j.mpGain * (level - 1) + (e.armorItem && ITEMS[e.armorItem].mp ? ITEMS[e.armorItem].mp : 0));
  if (fullHeal) { e.hp = e.maxhp; e.mp = e.maxmp; e.tp = 0; }
  else { e.hp = Math.min(e.hp, e.maxhp); e.mp = Math.min(e.mp, e.maxmp); }
}

// job -> KayKit model (each ships with its own textured gear and weapons)
export const JOB_MODEL = { WAR: 'Knight', MNK: 'Barbarian', WHM: 'Mage', BLM: 'Rogue_Hooded', THF: 'Rogue' };
// job -> attack animations
const JOB_ATTACK = {
  WAR: ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop'],
  MNK: ['Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B', 'Unarmed_Melee_Attack_Kick'],
  WHM: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Horizontal'],
  BLM: ['1H_Melee_Attack_Stab', '1H_Melee_Attack_Chop'],
  THF: ['1H_Melee_Attack_Stab', 'Dualwield_Melee_Attack_Slice'],
};

function giveModel(e, modelName, opts = {}) {
  const { group, mixer, anims, parts } = makeCharacterModel(modelName, opts);
  e.mesh = group; e.parts = parts; e.mixer = mixer; e.anims = anims;
  e.curAction = null; e.curLoop = null; e.oneShotAction = null;
  setLoopAnim(e, 'Idle');
  return group;
}

export function buildPlayerMesh() {
  const p = S.player;
  let px = p.savedPos ? p.savedPos.x : 3, pz = p.savedPos ? p.savedPos.z : 4;
  if (p.mesh) { px = p.pos.x; pz = p.pos.z; S.scene.remove(p.mesh); }
  const group = giveModel(p, JOB_MODEL[p.job], { appearance: S.appearance });
  const plate = makeNameplate(S.charName, '#e8edf8', '', true);
  plate.position.y = 2.05;
  group.add(plate);
  p.plate = plate;
  group.position.set(px, S.heightAt(px, pz), pz);
  S.scene.add(group);
}

function addCompanion(c, pos) {
  const lvl = S.jobs[S.job].level;
  const e = new Entity({ kind: 'companion', name: c.name, role: c.role, job: c.job, speed: 5.2 });
  const group = giveModel(e, c.model, { appearance: c.appearance });
  e.weaponItem = STARTER_WEAPON[c.job];
  applyJobStats(e, c.job, lvl);
  const plate = makeNameplate(c.name, '#cfe3f8', '', true);
  plate.position.y = 2.05;
  group.add(plate);
  e.plate = plate;
  group.position.set(pos.x, S.heightAt(pos.x, pos.z), pos.z);
  S.party.push(e);
  S.scene.add(group);
  return e;
}

function spawnAlly(c, spot) {
  spot = findOpenSpot(spot.x, spot.z);
  const e = new Entity({ kind: 'npc', name: c.name, npc: { id: 'ally_' + c.name, name: c.name, role: 'ally', ally: c, x: spot.x, z: spot.z } });
  const group = giveModel(e, c.model, { appearance: c.appearance });
  const plate = makeNameplate(c.name, '#8fd3a8');
  plate.position.y = 2.05;
  group.add(plate);
  e.plate = plate;
  group.position.set(spot.x, S.heightAt(spot.x, spot.z), spot.z);
  group.rotation.y = rand(0, Math.PI * 2);
  S.scene.add(group);
  S.npcs.push(e);
}

export function recruitCompanion(name) {
  const idx = S.npcs.findIndex(n => n.npc && n.npc.role === 'ally' && n.name === name);
  if (idx < 0) return;
  const npc = S.npcs[idx];
  const c = npc.npc.ally;
  S.npcs.splice(idx, 1);
  S.scene.remove(npc.mesh);
  S.recruited[name] = true;
  addCompanion(c, { x: npc.pos.x, z: npc.pos.z });
  UI.log(`${name} joins the party!`, 'gain');
  UI.initPartyFrames();
  UI.updateHUD();
  saveGame();
}

const COMPANIONS = [
  { name: 'Garrick', job: 'WAR', model: 'Knight', role: 'tank', appearance: { skin: 0x9a6a4a, hair: 0x23232e, hairStyle: 'Hair_Buzzed', beard: true } },
  { name: 'Lina', job: 'WHM', model: 'Mage', role: 'healer', appearance: { skin: 0xe8c8a8, hair: 0xc9a227, hairStyle: 'Hair_Long' } },
];

export function initGame(charData) {
  S.charName = charData.name;
  S.appearance = { skin: charData.skin, hair: charData.hair };
  S.job = charData.job;

  // player entity
  const p = new Entity({ kind: 'player', name: charData.name, speed: 5.2 });
  S.player = p;
  const lvl = S.jobs[S.job].level;
  p.weaponItem = S.equipPerJob[S.job].weapon;
  p.armorItem = S.equipPerJob[S.job].armor;
  applyJobStats(p, S.job, lvl);
  if (charData.savedVitals) { p.hp = charData.savedVitals.hp; p.mp = charData.savedVitals.mp; }
  buildPlayerMesh();

  // companions: recruited allies join the party; the rest wait in town
  S.party = [p];
  COMPANIONS.forEach((c, i) => {
    if (S.recruited[c.name]) addCompanion(c, { x: 3 + (i + 1) * 1.6, z: 4 - (i + 1) * 1.2 });
    else spawnAlly(c, { x: 6 - i * 6, z: 2 });   // waiting near the crystal, on clear ground
  });

  // monsters
  if (!(API.isEnabled() && API.getToken())) {
    for (const sp of SPAWNS) {
      for (let i = 0; i < sp.count; i++) {
        const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * sp.area.r;
        const spot = findOpenSpot(sp.area.x + Math.cos(a) * r, sp.area.z + Math.sin(a) * r);
        spawnMonster(sp.monster, spot.x, spot.z);
      }
    }
  }

  // npcs
  const NPC_MODEL = { eustace: 'Knight', mirelle: 'Mage', tarutaru: 'Barbarian', father_odo: 'Barbarian', galdric: 'Barbarian', scholar: 'Rogue_Hooded' };
  const SKINS = [0xe8c8a8, 0xd8a87c, 0x9a6a4a], HAIRS = [0x4a2f1d, 0xc9a227, 0x23232e, 0x8b8b94], STYLES = ['Hair_SimpleParted', 'Hair_Buzzed', 'Hair_Long', 'Hair_Buns'];
  for (const n of NPCS) {
    const e = new Entity({ kind: 'npc', name: n.name, npc: n });
    let hsh = 0;
    for (const ch of n.id) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;   // stable per-NPC look
    const appearance = { skin: SKINS[hsh % 3], hair: HAIRS[hsh % 4], hairStyle: STYLES[(hsh >> 2) % 4], beard: hsh % 5 === 0 };
    const group = giveModel(e, NPC_MODEL[n.id] || 'Rogue', { scale: n.small ? 0.55 : 0.9, appearance });
    const plate = makeNameplate(n.name, '#8fd3a8');
    plate.position.y = n.small ? 1.6 : 2.35;
    group.add(plate);
    e.plate = plate;
    const spot = findOpenSpot(n.x, n.z);   // never inside a stall, wall or boulder
    group.position.set(spot.x, S.heightAt(spot.x, spot.z), spot.z);
    group.rotation.y = rand(0, Math.PI * 2);
    S.scene.add(group);
    S.npcs.push(e);
  }

  buildNodes();

  // target ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 24), new THREE.MeshBasicMaterial({ color: 0xff4444, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  S.scene.add(ring);
  G.targetRing = ring;

  // destination marker
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.5, 20), new THREE.MeshBasicMaterial({ color: 0x4dd2ff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  S.scene.add(marker);
  G.destMarker = marker;

  UI.refreshHotbar();
  UI.updateTracker();
  UI.log(`Welcome to Vana'diel, ${S.charName}!`, 'sys');
  if (!S.recruited.Garrick || !S.recruited.Lina) UI.log('Garrick and Lina wait by the crystal — speak with them to form a party. It\'s dangerous to go alone.', 'sys');
  UI.log('Talk to Gate Guard Eustace at the north gate for work. Press M for your Magic Book, ? for help.', 'npc');
}

function buildNodes() {
  let logIdx = 1, minIdx = 1, herbIdx = 1;
  const mk = (type, x, z) => {
    ({ x, z } = findOpenSpot(x, z));   // don't bury a node inside a random boulder
    let mesh;
    if (type === 'logging') {
      mesh = new THREE.Group();
      mesh.add(env('stump_A', 4)); // simplified fallback check
    } else if (type === 'mining') {
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7), new THREE.MeshStandardMaterial({ color: 0xb87333, flatShading: true, metalness: 0.5, roughness: 0.5 }));
      mesh.position.y = 0.4; mesh.castShadow = true;
      const g = new THREE.Group(); g.add(mesh); mesh = g;
    } else {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: 0x4a9a3a, flatShading: true }));
      mesh.position.y = 0.35;
      const g = new THREE.Group(); g.add(mesh); mesh = g;
    }
    const sparkle = makeNameplate('✦', '#ffe27a');
    sparkle.scale.set(1, 0.4, 1);
    sparkle.position.y = 1.3;
    mesh.add(sparkle);
    mesh.position.set(x, S.heightAt(x, z), z);
    S.scene.add(mesh);
    const id = type === 'logging' ? `log_${logIdx++}` : type === 'mining' ? `min_${minIdx++}` : `herb_${herbIdx++}`;
    addCollider(x, z, type === 'logging' ? 1.6 : type === 'mining' ? 0.8 : 0.5);
    S.nodes.push({ id, type, x, z, mesh, sparkle, available: true, respawnT: 0 });
  };
  mk('logging', 42, 38); mk('logging', 60, 55); mk('logging', 50, 62); mk('logging', 68, 40);
  mk('mining', -48, -30); mk('mining', -58, -48); mk('mining', -42, -52);
  mk('herb', 18, -30); mk('herb', -28, 18); mk('herb', 30, -52); mk('herb', -20, -28);
}

// =====================================================================
// targeting
// =====================================================================
export function setTarget(e) {
  S.target = e;
  if (!e) { G.targetRing.visible = false; S.player.engaged = false; }
  else {
    G.targetRing.visible = true;
    G.targetRing.material.color.setHex(e.kind === 'monster' ? 0xff4444 : (e.kind === 'npc' ? 0x44ff88 : 0x44aaff));
  }
  UI.updateTargetFrame();
}

export function tabTarget() {
  const p = S.player;
  const cands = S.monsters.filter(m => m.alive && m.distTo(p) < 32).sort((a, b) => a.distTo(p) - b.distTo(p));
  if (!cands.length) return;
  const idx = cands.indexOf(S.target);
  setTarget(cands[(idx + 1) % cands.length]);
}

// =====================================================================
// combat
// =====================================================================
function tname(e) { return e.kind === 'monster' ? 'the ' + e.name : e.name; }

export function applyDamage(target, amount, src, { magic = false, crit = false, kind = 'dmg' } = {}) {
  if (!target.alive) return;
  amount = Math.max(1, Math.round(amount));
  target.hp = Math.max(0, target.hp - amount);
  FX.tintFlash(target, crit ? 0xffd43b : (magic ? 0x9775fa : 0xff5544));
  target.sleep = 0;
  if (target.kind === 'monster') {
    if (!target.aggroOn || !target.aggroOn.alive) target.aggroOn = src;
    target.tp = Math.min(100, (target.tp || 0) + 5);
  }
  if (target.kind !== 'monster') target.tp = Math.min(100, target.tp + 6);
  const cls = target === S.player ? 'dmg-in' : (magic ? 'magic' : (crit ? 'crit' : 'dmg'));
  UI.floater(target, (crit ? amount + '!' : amount), cls);
  if (src && (src === S.player || target === S.player || src.kind === 'companion' || target.kind === 'companion')) {
    const lcls = target.isFriendly() ? 'dmg-in' : 'cbt';
    if (crit) {
      UI.log(`${cap(tname(src))} scores a critical hit!`, lcls);
      UI.log(`${cap(tname(target))} takes ${amount} points of damage.`, lcls);
    } else if (magic) {
      UI.log(`${cap(tname(target))} takes ${amount} points of damage.`, lcls);
    } else {
      UI.log(`${cap(tname(src))} hits ${tname(target)} for ${amount} points of damage.`, lcls);
    }
  }
  if (target.hp <= 0) kill(target, src);
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function aAn(name) { return (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name.toLowerCase(); }

function meleeSwing(att, def) {
  const as = statsOf(att), ds = statsOf(def);
  att.attackAnim = 0.35;
  if (att.mixer) playOnce(att, attackAnimFor(att));
  att.faceToward(def.pos.x, def.pos.z);
  // hit chance
  const hitCh = clamp(0.85 + (att.level - def.level) * 0.02 - ds.eva * 0.004, 0.35, 0.97);
  if (Math.random() > hitCh) {
    UI.floater(def, 'Miss', 'miss');
    if (att === S.player || def === S.player || att.kind === 'companion' || def.kind === 'companion') {
      UI.log(`${cap(tname(att))} misses ${tname(def)}.`, def.isFriendly() ? 'dmg-in' : 'cbt');
    }
    return;
  }
  let crit = Math.random() < as.critCh;
  let dmg = as.atk * rand(0.85, 1.15) * (1 - ds.def / (ds.def + 60));
  if (crit) dmg *= 1.6;
  if (att.kind !== 'monster') att.tp = Math.min(100, att.tp + Math.round(as.delay * 5.5));
  applyDamage(def, dmg, att, { crit });
  spawnBurst(def.pos, crit ? 0xffd43b : 0xffffff, crit ? 14 : 6, 1.2);
}

function kill(e, src) {
  e.alive = false;
  e.hp = 0;
  e.casting = null;
  if (e.mixer) { e.oneShotAction = null; playOnce(e, 'Death_A', 0.15, false); }
  if (e === S.target) setTarget(null);
  if (e.kind === 'monster') {
    const victor = src && src.isFriendly() ? src.name : `${S.charName}'s party`;
    UI.log(`${victor} defeats ${tname(e)}.`, 'gain');
    e.deathT = 0;
    // detarget by other party members
    for (const m of S.party) if (m.target === e) m.target = null;
    if (src && src.isFriendly()) {
      grantKillRewards(e);
    }
    if (e.def.boss) {
      S.bossDown = true;
      UI.log('The earth itself seems to sigh in relief. Gorthak the Render is no more!', 'sys');
    }
  } else if (e === S.player) {
    UI.log('You have been knocked out…', 'dmg-in');
    document.getElementById('dead-overlay').style.display = 'flex';
    for (const m of S.monsters) if (m.aggroOn && m.aggroOn.isFriendly()) resetMonster(m);
  } else {
    UI.log(`${e.name} falls to the ground!`, 'dmg-in');
    e.deathT = 0;
  }
}

function grantKillRewards(mon) {
  const p = S.player;
  const diff = mon.level - p.level;
  let exp = Math.round(mon.def.exp * clamp(1 + diff * 0.22, 0.1, 2.2));
  if (mon.def.boss) exp = mon.def.exp;
  gainExp(exp);
  const gil = irand(mon.def.gil[0], mon.def.gil[1]);
  S.gil += gil;
  UI.log(`${S.charName} obtains ${gil} gil.`, 'loot');
  for (const d of mon.def.drops) {
    if (Math.random() < d.c) {
      addItem(d.id);
      UI.log(`You find ${aAn(ITEMS[d.id].name)} on ${tname(mon)}.`, 'loot');
      UI.log(`${S.charName} obtains ${aAn(ITEMS[d.id].name)}.`, 'loot');
    }
  }
  // quest progress
  for (const [qid, q] of Object.entries(QUESTS)) {
    const st = S.quests[qid];
    if (st && st.state === 'active' && q.type === 'kill' && q.target === mon.typeId && st.n < q.count) {
      st.n++;
      UI.log(`${q.name}: ${st.n}/${q.count} slain.`, 'npc');
      UI.updateTracker();
    }
  }
  saveGame();
}

export function gainExp(n) {
  const p = S.player;
  const jr = S.jobs[S.job];
  if (jr.level >= MAX_LEVEL) return;
  jr.exp += n;
  UI.floater(p, `+${n} EXP`, 'xp');
  UI.log(`${S.charName} gains ${n} experience points.`, 'gain');
  while (jr.level < MAX_LEVEL && jr.exp >= expToNext(jr.level)) {
    jr.exp -= expToNext(jr.level);
    jr.level++;
    applyJobStats(p, S.job, jr.level);
    for (const c of S.party) if (c.kind === 'companion') applyJobStats(c, c.job, jr.level);
    UI.log(`${S.charName} attains level ${jr.level}!`, 'gain');
    spawnBurst(p.pos, 0xffe066, 30, 2.2);
    const newActs = Object.entries(ACTIONS).filter(([, a]) => a.job === S.job && a.lv === jr.level);
    for (const [, a] of newActs) UI.log(`You have learned ${a.name}!`, 'sys');
    UI.refreshHotbar();
  }
  UI.updateHUD();
}

// =====================================================================
// actions / casting
// =====================================================================
export function hotbarList() {
  return jobActions(S.job, S.jobs[S.job].level);
}

export function useHotbarSlot(i) {
  const list = hotbarList();
  if (i >= list.length) return;
  tryAction(S.player, list[i]);
}

// returns true if the action was started (used by the auto-magic engine)
export function tryAction(actor, actionId, opts = {}) {
  const a = ACTIONS[actionId];
  const p = actor;
  const loud = actor === S.player && !opts.silent;
  if (!p.alive) return false;
  if (p.casting) { if (loud) UI.log('You are busy casting.', 'sys'); return false; }
  const readyAt = p.recasts[actionId] || 0;
  if (G.now < readyAt) {
    if (loud) UI.log(`${a.name} is not ready. (${Math.ceil(readyAt - G.now)}s)`, 'sys');
    return false;
  }
  // pick target
  let target = opts.target || S.target;
  if (a.kind === 'item') return useItemAction(a, opts);
  if (a.type === 'heal' || a.self) target = a.self ? p : (target && target.isFriendly() ? target : p);
  else if (a.type === 'buff') target = p;
  else {
    if (!target || target.kind !== 'monster' || !target.alive) { if (loud) UI.log('You must target an enemy first. (Tab)', 'sys'); return false; }
  }
  if (a.mp && p.mp < a.mp) { if (loud) UI.log('Not enough MP.', 'sys'); return false; }
  if (a.kind === 'ws' && p.tp < 100) { if (loud) UI.log(`Not enough TP. (${Math.floor(p.tp)}/100)`, 'sys'); return false; }
  if (a.range && target !== p && p.distTo(target) > a.range) { if (loud) UI.log('Target is out of range.', 'sys'); return false; }

  if (Socket.isConnected()) {
    Socket.emit('combat:use_action', { actionId, targetId: target ? target.id : null });
    return true;
  }

  if (a.kind === 'spell') {
    p.casting = { action: actionId, t: 0, total: a.cast, target };
    p.dest = null; S.autoRun = false;
    if (p === S.player) UI.showCastbar(a.name, a.cast);
    UI.log(`${p.name} starts casting ${a.name}.`, 'magic');
  } else {
    resolveAction(p, actionId, target);
  }
  return true;
}

function useItemAction(a, opts = {}) {
  const p = S.player;
  if (countItem(a.item) <= 0) { if (!opts.silent) UI.log(`You have no ${ITEMS[a.item].name}s left.`, 'sys'); return false; }
  const readyAt = p.recasts['item'] || 0;
  if (G.now < readyAt) { if (!opts.silent) UI.log('You must wait before using another item.', 'sys'); return false; }
  if (Socket.isConnected()) {
    Socket.emit('combat:use_action', { actionId: a.item === 'potion' ? 'use_potion' : 'use_ether' });
    return true;
  }
  useConsumable(a.item);
  p.recasts['item'] = G.now + 5;
  UI.refreshHotbar();
  return true;
}

// =====================================================================
// auto-magic: the player's configurable casting brain (see Magic Book UI)
// =====================================================================
export function autoCfg(job = S.job) {
  if (!S.autoMagic[job]) S.autoMagic[job] = { enabled: false, combat: {}, field: {}, order: [], healAt: 75 };
  const cfg = S.autoMagic[job];
  // keep the priority order in sync with what the job currently knows
  const known = jobActions(job, S.jobs[job].level);
  cfg.order = [...cfg.order.filter(id => known.includes(id)), ...known.filter(id => !cfg.order.includes(id))];
  return cfg;
}

function lowestAlly(belowFrac) {
  let best = null, bestFrac = belowFrac;
  for (const m of S.party) {
    if (!m.alive) continue;
    const f = m.hp / m.maxhp;
    if (f < bestFrac) { bestFrac = f; best = m; }
  }
  return best;
}

function runAutoMagic() {
  const p = S.player;
  const cfg = autoCfg();
  if (!cfg.enabled || !p.alive || p.casting || p.sitting) return;
  const fighting = p.engaged && S.target && S.target.alive && S.target.kind === 'monster';
  const mode = fighting ? 'combat' : 'field';

  for (const id of cfg.order) {
    if (!cfg[mode][id]) continue;
    const a = ACTIONS[id];
    if (!a || (a.job && a.lv > S.jobs[S.job].level)) continue;
    if (G.now < (p.recasts[a.kind === 'item' ? 'item' : id] || 0)) continue;

    if (a.kind === 'item') {
      // sip when genuinely hurting: potions on HP, ethers on MP
      const it = ITEMS[a.item];
      if (it.heal && p.hp / p.maxhp >= 0.4) continue;
      if (it.mpheal && p.mp / p.maxmp >= 0.25) continue;
      if (tryAction(p, id, { silent: true })) return;
    } else if (a.type === 'heal') {
      const tgt = a.self ? (p.hp / p.maxhp < cfg.healAt / 100 ? p : null) : lowestAlly(cfg.healAt / 100);
      if (tgt && tryAction(p, id, { target: tgt, silent: true })) return;
    } else if (a.type === 'buff') {
      if (p.buffs[a.buff]) continue;
      if (tryAction(p, id, { silent: true })) return;
    } else if (a.type === 'sleep') {
      // crowd control: put a *second* attacker to sleep, never the current target
      const extra = S.monsters.find(m => m.alive && !m.sleep && m !== S.target && m.aggroOn && m.aggroOn.isFriendly() && p.distTo(m) <= (a.range || 18));
      if (extra && tryAction(p, id, { target: extra, silent: true })) return;
    } else if (fighting) {
      // dmg / ws / debuff / enmity / steal need the enemy target
      if (a.dot && S.target.dot) continue;             // don't reapply a running DoT
      if (tryAction(p, id, { target: S.target, silent: true })) return;
    }
  }
}

export function useConsumable(id) {
  const it = ITEMS[id];
  const p = S.player;
  UI.log(`${S.charName} uses ${aAn(it.name)}.`, 'cbt');
  if (it.heal) { const n = Math.min(it.heal, p.maxhp - p.hp); p.hp += n; UI.floater(p, n, 'heal'); UI.log(`${S.charName} recovers ${n} hit points.`, 'heal'); }
  if (it.mpheal) { const n = Math.min(it.mpheal, p.maxmp - p.mp); p.mp += n; UI.floater(p, n + ' MP', 'heal'); UI.log(`${S.charName} recovers ${n} magic points.`, 'heal'); }
  removeItem(id);
  spawnBurst(p.pos, 0x69db7c, 10, 1.4);
}

function resolveAction(actor, actionId, target) {
  const a = ACTIONS[actionId];
  if (a.mp) actor.mp -= a.mp;
  if (a.recast) actor.recasts[actionId] = G.now + a.recast;
  if (actor === S.player) UI.refreshHotbar();
  const as = statsOf(actor);

  if (actor.mixer) {
    if (a.kind === 'ws') playOnce(actor, actor.anims['2H_Melee_Attack_Spin'] ? '2H_Melee_Attack_Spin' : attackAnimFor(actor));
    else if (a.kind === 'spell') playOnce(actor, 'Spellcast_Shoot');
    else if (a.kind === 'ability') playOnce(actor, a.type === 'heal' ? 'Use_Item' : 'Cheer');
  }
  if (a.kind === 'ws') {
    const tpMul = 0.85 + actor.tp / 110;
    actor.tp = 0;
    actor.attackAnim = 0.45;
    const ds = statsOf(target);
    const hits = a.hits || 1;
    let total = 0;
    const sneak = actor.buffs.sneak;
    for (let h = 0; h < hits; h++) {
      let dmg = as.atk * a.power * tpMul / hits * rand(0.9, 1.1) * (1 - ds.def / (ds.def + 60));
      if (sneak || Math.random() < as.critCh) dmg *= 1.6;
      total += dmg;
    }
    delete actor.buffs.sneak;
    UI.log(`${actor.name} uses ${a.name}.`, 'cbt');
    applyDamage(target, total, actor, { crit: !!sneak });
    if (a.debuff === 'armorbreak') { target.buffs.armorbreak = { t: 20 }; UI.log(`${cap(tname(target))}'s armor is shattered!`, 'magic'); }
    FX.weaponSkillEffect(target, a.power);
  } else if (a.type === 'dmg') {
    let dmg = a.power * (8 + as.matk * 1.6) * rand(0.92, 1.08);
    const ds = statsOf(target);
    dmg *= 1 - ds.def / (ds.def + 140);
    UI.log(`${actor.name} casts ${a.name}.`, 'magic');
    applyDamage(target, dmg, actor, { magic: true });
    if (a.dot) { target.dot = { dps: 1.2, t: a.dot, src: actor, dia: true }; }
    if (a.slow) { target.buffs.slowed = { t: 6 }; }
    FX.spellEffect(actionId, target, actor);
  } else if (a.type === 'heal') {
    const amount = Math.round(a.power * (6 + as.mnd * 1.5) * rand(0.95, 1.05));
    const healed = Math.min(amount, target.maxhp - target.hp);
    target.hp += healed;
    UI.log(`${actor.name} ${a.kind === 'spell' ? 'casts' : 'uses'} ${a.name}.`, 'magic');
    UI.log(`${cap(tname(target))} recovers ${healed} hit points.`, 'heal');
    UI.floater(target, healed, 'heal');
    FX.spellEffect(actionId, target, actor);
  } else if (a.type === 'buff') {
    const targets = a.party ? S.party.filter(m => m.alive && actor.distTo(m) < (a.range || 14)) : [actor];
    for (const t of targets) t.buffs[a.buff] = { t: a.dur };
    UI.log(`${actor.name} ${a.kind === 'spell' ? 'casts' : 'uses'} ${a.name}.`, 'magic');
    for (const t of targets) FX.spellEffect(actionId, t, actor);
  } else if (a.type === 'sleep') {
    if (target.def && target.def.boss) { UI.log(`${cap(tname(target))} resists the spell!`, 'magic'); UI.floater(target, 'Resist', 'miss'); }
    else { target.sleep = a.dur; target.aggroOn = null; UI.log(`${cap(tname(target))} falls asleep.`, 'magic'); }
    FX.spellEffect(actionId, target, actor);
  } else if (a.type === 'enmity') {
    target.aggroOn = actor;
    UI.log(`${actor.name} provokes ${tname(target)}!`, 'cbt');
    UI.floater(target, '!!', 'crit');
  } else if (a.type === 'steal') {
    if (Math.random() < 0.7) {
      const g = irand(15, 20 + target.level * 6);
      S.gil += g;
      UI.log(`${actor.name} steals ${g} gil from ${tname(target)}!`, 'loot');
    } else UI.log('You fail to steal anything.', 'cbt');
    target.aggroOn = actor;
  }
  UI.updateHUD();
}

// =====================================================================
// interactions: NPCs, nodes, crystal
// =====================================================================
export function requestInteract(thing) {
  // walk into range first, then trigger
  G.pendingInteract = thing;
  const pos = thing.mesh ? thing.mesh.position : thing;
  S.player.dest = { x: pos.x, z: pos.z };
}

function doInteract(thing) {
  G.pendingInteract = null;
  S.player.dest = null;
  if (thing.isNode) return startGather(thing);
  if (thing.isCrystal) return UI.openCrystalMenu();
  if (thing.kind === 'npc') return UI.openNpcDialog(thing);
}

function startGather(node) {
  if (!node.available) { UI.log('There is nothing left to gather here.', 'sys'); return; }
  if (Socket.isConnected()) {
    Socket.emit('gather:interact', { nodeId: node.id });
    return;
  }
  const p = S.player;
  const label = node.type === 'logging' ? 'Logging…' : node.type === 'mining' ? 'Mining…' : 'Harvesting…';
  p.casting = { gather: node, t: 0, total: 2.2 };
  UI.showCastbar(label, 2.2);
}

function finishGather(node) {
  const table = { logging: 'maple_log', mining: 'copper_ore', herb: 'wild_herb' };
  const id = table[node.type];
  addItem(id);
  UI.log(`You obtain ${ITEMS[id].name}!`, 'gain');
  if (node.type === 'mining' && Math.random() < 0.2) { addItem('worm_silica'); UI.log('You also find a Worm Silica!', 'gain'); }
  node.available = false;
  node.respawnT = 40;
  node.sparkle.visible = false;
  spawnBurst(node.mesh.position, 0xffe27a, 10, 1.4);
  UI.updateTracker();
  saveGame();
}

export function changeJob(job) {
  if (S.player.engaged || S.player.casting) { UI.log('You cannot change jobs while busy.', 'sys'); return; }
  if (Socket.isConnected()) {
    Socket.emit('job:change', { job });
    return;
  }
  S.job = job;
  const lvl = S.jobs[job].level;
  const p = S.player;
  p.weaponItem = S.equipPerJob[job].weapon;
  p.armorItem = S.equipPerJob[job].armor;
  applyJobStats(p, job, lvl);
  buildPlayerMesh();
  for (const c of S.party) if (c.kind === 'companion') applyJobStats(c, c.job, lvl);
  UI.refreshHotbar();
  UI.updateHUD();
  UI.log(`You are now a level ${lvl} ${JOBS[job].name}.`, 'sys');
  spawnBurst(p.pos, 0x57a8ff, 24, 2);
  saveGame();
}

export function craftRecipe(rid) {
  const r = RECIPES.find(x => x.id === rid);
  for (const m of r.mats) if (countItem(m.id) < m.qty) { UI.log('You lack the materials.', 'sys'); return; }
  if (Socket.isConnected()) {
    Socket.emit('craft:recipe', { rid });
    return;
  }
  for (const m of r.mats) removeItem(m.id, m.qty);
  addItem(r.result, r.qty);
  UI.log(`You synthesize ${r.qty > 1 ? r.qty + ' ' : ''}${ITEMS[r.result].name}${r.qty > 1 ? 's' : ''}!`, 'gain');
  spawnBurst(S.player.pos, 0x74c0fc, 16, 1.8);
  saveGame();
}

export function buyItem(id) {
  if (Socket.isConnected()) {
    Socket.emit('shop:buy', { id });
    return true;
  }
  const it = ITEMS[id];
  if (S.gil < it.price) { UI.log('Not enough gil.', 'sys'); return false; }
  S.gil -= it.price;
  addItem(id);
  UI.log(`You buy ${it.name} for ${it.price} gil.`, 'gain');
  UI.updateHUD();
  saveGame();
  return true;
}

export function sellItem(id) {
  if (Socket.isConnected()) {
    Socket.emit('shop:sell', { id });
    return;
  }
  const it = ITEMS[id];
  const val = Math.max(1, Math.floor((it.price || 10) * 0.3));
  if (!removeItem(id)) return;
  S.gil += val;
  UI.log(`You sell ${it.name} for ${val} gil.`, 'gain');
  UI.updateHUD();
  saveGame();
}

export function equipItem(id) {
  const it = ITEMS[id];
  const p = S.player;
  if (Socket.isConnected()) {
    Socket.emit('equip:item', { slot: it.type, id });
    return;
  }
  if (it.type === 'weapon') {
    if (it.job !== S.job) { UI.log(`Only a ${JOBS[it.job].name} can equip that.`, 'sys'); return; }
    S.equipPerJob[S.job].weapon = id;
    p.weaponItem = id;
  } else if (it.type === 'armor') {
    S.equipPerJob[S.job].armor = id;
    p.armorItem = id;
    applyJobStats(p, S.job, p.level, false);
  }
  UI.log(`${S.charName} equips the ${it.name}.`, 'sys');
  UI.updateHUD();
  saveGame();
}

// quest helpers used by UI dialogs
export function questFor(npcId) {
  for (const [qid, q] of Object.entries(QUESTS)) {
    if (q.giver !== npcId) continue;
    if (q.prereq && (!S.quests[q.prereq] || S.quests[q.prereq].state !== 'rewarded')) continue;
    const st = S.quests[qid];
    if (!st || st.state !== 'rewarded') return { qid, q, st };
  }
  return null;
}
export function acceptQuest(qid) {
  if (Socket.isConnected()) {
    Socket.emit('quest:accept', { qid });
    return;
  }
  S.quests[qid] = { state: 'active', n: 0 };
  const q = QUESTS[qid];
  UI.log(`Quest accepted: ${q.name}.`, 'npc');
  if (q.type === 'deliver') { addItem(q.item); UI.log(`You receive the ${ITEMS[q.item].name}.`, 'gain'); }
  UI.updateTracker();
  saveGame();
}
export function questComplete(qid) {
  const q = QUESTS[qid], st = S.quests[qid];
  if (!st || st.state !== 'active') return false;
  if (q.type === 'kill') return st.n >= q.count;
  if (q.type === 'collect') return countItem(q.target) >= q.count;
  if (q.type === 'deliver') return countItem(q.item) >= 1;   // completes at the receiver NPC
  return false;
}
export function rewardQuest(qid) {
  if (Socket.isConnected()) {
    Socket.emit('quest:reward', { qid });
    return;
  }
  const q = QUESTS[qid];
  if (q.type === 'collect') removeItem(q.target, q.count);
  if (q.type === 'deliver') removeItem(q.item, 1);
  S.quests[qid].state = 'rewarded';
  if (q.reward.gil) { S.gil += q.reward.gil; UI.log(`You receive ${q.reward.gil} gil.`, 'gain'); }
  if (q.reward.item) { addItem(q.reward.item); UI.log(`You receive ${ITEMS[q.reward.item].name}!`, 'gain'); }
  if (q.reward.exp) gainExp(q.reward.exp);
  UI.log(`Quest complete: ${q.name}!`, 'sys');
  spawnBurst(S.player.pos, 0xffe066, 26, 2.2);
  UI.updateTracker();
  UI.updateHUD();
  saveGame();
}

export function respawnPlayer() {
  const p = S.player;
  document.getElementById('dead-overlay').style.display = 'none';
  if (Socket.isConnected()) {
    Socket.emit('player:respawn');
    return;
  }
  p.alive = true;
  p.hp = Math.round(p.maxhp * 0.6); p.mp = Math.round(p.maxmp * 0.6); p.tp = 0;
  p.mesh.position.set(3, S.heightAt(3, 4), 4);
  p.mesh.rotation.z = 0;
  resetAnim(p);
  p.dest = null; setTarget(null);
  // anything still hunting the party (e.g. locked on a companion) goes home too
  for (const m of S.monsters) if (m.alive && m.aggroOn && m.aggroOn.isFriendly()) resetMonster(m);
  const jr = S.jobs[S.job];
  const loss = Math.min(jr.exp, Math.round(expToNext(jr.level) * 0.08));
  if (jr.level > 3 && loss > 0) { jr.exp -= loss; UI.log(`You lose ${loss} experience points.`, 'dmg-in'); }
  UI.log('You return to your home point.', 'sys');
  for (const c of S.party) if (c.kind === 'companion') {
    c.alive = true; c.hp = c.maxhp; c.mp = c.maxmp;
    c.mesh.rotation.z = 0;
    c.mesh.position.set(p.pos.x + rand(-2, 2), 0, p.pos.z + rand(-2, 2));
    c.mesh.position.y = S.heightAt(c.mesh.position.x, c.mesh.position.z);
    resetAnim(c);
  }
  UI.updateHUD();
}

export function npcBless() {
  if (Socket.isConnected()) {
    Socket.emit('npc:bless');
    return;
  }
  const p = S.player; p.hp = p.maxhp; p.mp = p.maxmp;
  for (const c of S.party) if (c.alive) { c.hp = c.maxhp; c.mp = c.maxmp; }
  UI.log('A warm light washes over the party. HP/MP fully restored.', 'magic');
  UI.updateHUD();
}

// =====================================================================
// movement & animation helpers
// =====================================================================
function moveEntity(e, dirX, dirZ, dt, speedMul = 1) {
  const sp = e.speed * speedMul * (statsOf(e).speedMul || 1);
  let nx = e.pos.x + dirX * sp * dt;
  let nz = e.pos.z + dirZ * sp * dt;
  nx = clamp(nx, -94, 94); nz = clamp(nz, -94, 94);
  // static obstacles: trees, rocks, walls, props (circle/box push from world.js)
  const rc = resolveCollision(nx, nz);
  nx = rc.x; nz = rc.z;
  e.pos.x = nx; e.pos.z = nz;
  e.pos.y = S.heightAt(nx, nz);
  e.heading = Math.atan2(dirX, dirZ);
  e.moving = true;
}

function attackAnimFor(e) {
  if (e.kind === 'monster') return e.def.family === 'orc' ? '2H_Melee_Attack_Chop' : 'Dualwield_Melee_Attack_Stab';
  return pick(JOB_ATTACK[e.job] || JOB_ATTACK.WAR);
}

function resetAnim(e) {
  e.oneShotAction = null;
  e.curLoop = null;
  setLoopAnim(e, 'Idle');
}

function animateEntity(e, dt) {
  if (e.sitting && (e.moving || e.engaged || e.casting || e.attackTimer > 0)) {
    e.sitting = false;
  }
  if (e.mixer) {
    e.mixer.update(dt);
    if (!e.alive) return;                       // hold the Death_A pose
    let loop = 'Idle';
    if (e.sitting) loop = 'Sit_Floor_Idle';
    else if (e.casting) loop = e.casting.gather ? 'Interact' : 'Spellcasting';
    else if (e.moving) loop = 'Running_A';
    setLoopAnim(e, loop);
    return;
  }
  
  // Procedural 3D animation for simple/procedural models
  e.animT += dt * (e.moving ? 12 : 3);
  
  if (!e.alive) {
    // Lie down on death
    e.mesh.rotation.z = lerp(e.mesh.rotation.z, Math.PI / 2, dt * 5);
    e.mesh.position.y = lerp(e.mesh.position.y, S.heightAt(e.pos.x, e.pos.z) + 0.1, dt * 5);
    return;
  }
  
  // Flap wings for bees
  if (e.parts && e.parts.wings) {
    for (const w of e.parts.wings) {
      w.rotation.z = Math.sin(e.animT * 10) * 0.45;
    }
  }
  
  let targetY = S.heightAt(e.pos.x, e.pos.z);
  let targetRotX = 0;
  
  if (e.moving) {
    // Hopping/bobbing motion
    if (e.def && e.def.family !== 'bee' && e.def.family !== 'bat') {
      targetY += Math.abs(Math.sin(e.animT * 0.8)) * 0.35;
      targetRotX = 0.15; // tilt forward
    }
  }
  
  // Apply attack lunge
  if (e.attackAnim > 0) {
    e.attackAnim -= dt;
    const ph = Math.sin((e.attackAnim / 0.45) * Math.PI);
    e.mesh.position.x += Math.sin(e.heading) * ph * 0.08;
    e.mesh.position.z += Math.cos(e.heading) * ph * 0.08;
    targetRotX += 0.35 * ph;
  }
  
  // Apply spell casting shake
  if (e.casting && !e.casting.gather) {
    e.mesh.position.x += Math.sin(e.animT * 40) * 0.02;
    targetRotX += 0.1;
  }
  
  e.mesh.position.y = lerp(e.mesh.position.y, targetY, dt * 8);
  e.mesh.rotation.x = lerp(e.mesh.rotation.x, targetRotX, dt * 8);
}

// face smoothly toward heading
function applyHeading(e, dt) {
  let diff = e.heading - e.mesh.rotation.y;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  e.mesh.rotation.y += diff * Math.min(1, dt * 12);
}

function resetMonster(m) {
  m.aggroOn = null;
  m.engaged = false;
  m.hp = m.maxhp;
  m.dest = { x: m.home.x, z: m.home.z };
  m.returning = true;        // walks home without aggroing anyone on the way
}

// =====================================================================
// per-frame update
// =====================================================================
export function updateGame(dt) {
  G.now += dt;
  const p = S.player;

  updatePlayer(dt);
  for (const c of S.party) if (c.kind === 'companion') updateCompanion(c, dt);
  if (Socket.isConnected()) {
    // server updates monsters and nodes authoritatively
  } else {
    for (const m of S.monsters) updateMonster(m, dt);
    updateNodes(dt);
  }
  updateCasting(dt);
  updateBuffsAndRegen(dt);
  FX.updateEffects(dt);

  // animations & headings
  if (p) p.isMoving = p.moving;
  for (const e of [...S.party, ...S.monsters]) { animateEntity(e, dt); if (e.alive) applyHeading(e, dt); e.moving = false; }
  for (const n of S.npcs) { animateEntity(n, dt); n.moving = false; }

  // target ring follows target
  if (S.target && S.target.alive) {
    G.targetRing.position.set(S.target.pos.x, S.target.pos.y + 0.06, S.target.pos.z);
    const s = S.target.def && S.target.def.boss ? 2.6 : 1;
    G.targetRing.scale.set(s, s, 1);
    G.targetRing.rotation.z += dt * 1.5;
  } else if (S.target) setTarget(null);

  // pending interaction trigger
  if (G.pendingInteract) {
    const t = G.pendingInteract;
    const pos = t.mesh ? t.mesh.position : t;
    if (Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < 3) doInteract(t);
  }

  // engage check: auto-attack if enemy targeted & in range (classic spec)
  if (Socket.isConnected()) {
    const shouldEngage = S.target && S.target.kind === 'monster' && S.target.alive && p.alive && !p.casting;
    if (shouldEngage) {
      if (p.engagedTargetId !== S.target.id) {
        p.engagedTargetId = S.target.id;
        p.engaged = true;
        Socket.emit('combat:engage', { targetId: S.target.id });
      }
    } else {
      if (p.engagedTargetId) {
        p.engagedTargetId = null;
        p.engaged = false;
        Socket.emit('combat:disengage', {});
      }
    }
  } else {
    if (S.target && S.target.kind === 'monster' && S.target.alive && p.alive && !p.casting) {
      const st = statsOf(p);
      if (p.distTo(S.target) <= 2.6) {
        p.engaged = true;
        p.attackTimer -= dt;
        if (p.attackTimer <= 0) {
          meleeSwing(p, S.target);
          p.attackTimer = st.delay;
        }
      }
    }
  }

  G.saveTimer += dt;
  if (G.saveTimer > 30) { G.saveTimer = 0; saveGame(); }

  G.autoT = (G.autoT || 0) + dt;
  if (G.autoT > 0.6) { G.autoT = 0; runAutoMagic(); }

  UI.updateHUD();
}

function updatePlayer(dt) {
  const p = S.player;
  if (!p.alive) return;
  if (p.casting && !p.casting.gather) { /* casting roots the player */ }
  else {
    // keyboard move (camera relative)
    let mx = 0, mz = 0;
    const k = S.keys;
    if (!S.chatOpen) {
      if (k['KeyW'] || k['ArrowUp'] || k['Numpad8']) mz += 1;
      if (k['KeyS'] || k['ArrowDown'] || k['Numpad2']) mz -= 1;
      if (k['KeyA'] || k['ArrowLeft'] || k['Numpad4']) mx -= 1;
      if (k['KeyD'] || k['ArrowRight'] || k['Numpad6']) mx += 1;
    }
    if (S.autoRun) mz += 1;
    if (mx || mz) {
      p.dest = null;
      if (p.casting && p.casting.gather) { p.casting = null; UI.hideCastbar(); }
      const len = Math.hypot(mx, mz);
      const sin = Math.sin(S.camYaw), cos = Math.cos(S.camYaw);
      const dx = (mx * cos - mz * sin) / len;
      const dz = (-mx * sin - mz * cos) / len;
      moveEntity(p, dx, dz, dt);
      G.destMarker.visible = false;
    } else if (p.dest) {
      const dx = p.dest.x - p.pos.x, dz = p.dest.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.35) { p.dest = null; G.destMarker.visible = false; }
      else moveEntity(p, dx / d, dz / d, dt);
    }
  }
}

function updateCompanion(c, dt) {
  const p = S.player;
  if (!c.alive) {
    c.deathT += dt;
    if (!c.mixer) c.mesh.rotation.z = lerp(c.mesh.rotation.z, Math.PI / 2, dt * 4);
    if (c.deathT > 18) {
      c.alive = true; c.hp = Math.round(c.maxhp * 0.5); c.mesh.rotation.z = 0; c.deathT = 0;
      resetAnim(c);
      UI.log(`${c.name} gets back up!`, 'sys');
    }
    return;
  }
  // find the fight: player's target if hostile, or anything attacking the party
  let foe = (S.target && S.target.kind === 'monster' && S.target.alive && p.engaged) ? S.target : null;
  if (!foe) {
    for (const m of S.monsters) if (m.alive && m.aggroOn && m.aggroOn.isFriendly() && m.distTo(c) < 30) { foe = m; break; }
  }

  if (c.casting) return; // rooted while casting

  if (c.role === 'healer') {
    // heal the most wounded ally
    const wounded = S.party.filter(m => m.alive && m.hp / m.maxhp < 0.62).sort((a, b) => a.hp / a.maxhp - b.hp / b.maxhp)[0];
    const cureId = c.level >= 11 && c.mp >= 22 ? 'cure2' : 'cure';
    const cure = ACTIONS[cureId];
    if (wounded && c.mp >= cure.mp && G.now > (c.recasts[cureId] || 0)) {
      if (c.distTo(wounded) <= cure.range) {
        c.casting = { action: cureId, t: 0, total: cure.cast, target: wounded };
        c.faceToward(wounded.pos.x, wounded.pos.z);
        return;
      }
      const dx = wounded.pos.x - c.pos.x, dz = wounded.pos.z - c.pos.z, d = Math.hypot(dx, dz);
      moveEntity(c, dx / d, dz / d, dt);
      return;
    }
    if (foe && c.level >= 3 && c.mp >= 7 && G.now > (c.recasts['dia'] || 0) && !foe.dot && c.distTo(foe) <= 16) {
      c.casting = { action: 'dia', t: 0, total: ACTIONS.dia.cast, target: foe };
      return;
    }
  }

  if (foe) {
    c.target = foe;
    const d = c.distTo(foe);
    const range = 2.4;
    if (c.role === 'tank' && c.level >= 3 && foe.aggroOn && foe.aggroOn !== c && foe.aggroOn.hp / foe.aggroOn.maxhp < 0.7 && G.now > (c.recasts['provoke'] || 0) && d < 14) {
      c.recasts['provoke'] = G.now + 22;
      foe.aggroOn = c;
      UI.log(`${c.name} provokes ${tname(foe)}!`, 'cbt');
    }
    if (d > range) {
      const dx = foe.pos.x - c.pos.x, dz = foe.pos.z - c.pos.z;
      moveEntity(c, dx / d, dz / d, dt);
    } else {
      c.attackTimer -= dt;
      if (c.attackTimer <= 0) {
        if (c.tp >= 100 && c.role === 'tank') {
          resolveAction(c, 'fast_blade', foe);
        } else meleeSwing(c, foe);
        c.attackTimer = statsOf(c).delay;
      }
    }
  } else {
    // follow the player in formation
    c.target = null;
    const slot = c.role === 'tank' ? { x: -1.6, z: -1.4 } : { x: 1.6, z: -1.4 };
    const tx = p.pos.x + slot.x, tz = p.pos.z + slot.z;
    const dx = tx - c.pos.x, dz = tz - c.pos.z, d = Math.hypot(dx, dz);
    if (d > 1.2) moveEntity(c, dx / d, dz / d, dt, d > 8 ? 1.4 : 1);
  }
}

function updateMonster(m, dt) {
  if (!m.alive) {
    m.deathT += dt;
    if (m.mixer) m.mixer.update(dt);
    if (m.deathT < 3) {
      if (!m.mixer) m.mesh.rotation.z = lerp(m.mesh.rotation.z, Math.PI / 2, dt * 3);
    } else if (m.deathT < 4.5) {
      m.mesh.position.y -= dt * 1.2;
    } else if (!m.hidden) {
      m.hidden = true;
      m.mesh.visible = false;
    }
    const respawn = m.def.boss ? 240 : 30;
    if (m.deathT > respawn) {
      m.alive = true; m.hidden = false; m.hp = m.maxhp; m.deathT = 0;
      m.mesh.visible = true; m.mesh.rotation.z = 0;
      m.aggroOn = null; m.sleep = 0; m.dot = null; m.buffs = {};
      resetAnim(m);
      m.mesh.position.set(m.home.x, S.heightAt(m.home.x, m.home.z), m.home.z);
    }
    return;
  }
  m.animT += dt;
  if (m.def.family === 'bee' || m.def.family === 'bat') {
    m.mesh.position.y = S.heightAt(m.pos.x, m.pos.z) + 0.25 + Math.sin(m.animT * 5) * 0.12;
    if (m.parts.wings) for (const w of m.parts.wings) w.rotation.z = Math.sin(m.animT * 50) * 0.45;
  }
  if (m.sleep > 0) { m.sleep -= dt; return; }
  if (m.dot) {
    m.dot.t -= dt;
    m.dot.tick = (m.dot.tick || 0) - dt;
    if (m.dot.tick <= 0) { m.dot.tick = 3; applyDamage(m, 3 + m.level * 0.4, m.dot.src, { magic: true }); }
    if (m.dot.t <= 0) m.dot = null;
    if (!m.alive) return;
  }
  for (const [k, b] of Object.entries(m.buffs)) { b.t -= dt; if (b.t <= 0) delete m.buffs[k]; }

  const distHome = Math.hypot(m.pos.x - m.home.x, m.pos.z - m.home.z);

  if (m.aggroOn && (!m.aggroOn.alive || distHome > 46)) {
    if (distHome > 46) UI.log(`${cap(tname(m))} gives up the chase.`, 'sys');
    resetMonster(m);
  }

  if (m.aggroOn) {
    const t = m.aggroOn;
    const d = m.distTo(t);
    const range = m.def.boss ? 3.4 : 1.9;
    if (d > range) {
      const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z;
      moveEntity(m, dx / d, dz / d, dt);
    } else {
      m.faceToward(t.pos.x, t.pos.z);
      m.attackTimer -= dt;
      if (m.attackTimer <= 0) {
        meleeSwing(m, t);
        m.attackTimer = m.attackDelay;
        // boss: occasional AoE stomp
        if (m.def.boss && Math.random() < 0.25) {
          UI.log('Gorthak rears up and slams the earth!', 'dmg-in');
          for (const pm of S.party) if (pm.alive && m.distTo(pm) < 6) applyDamage(pm, statsOf(m).atk * 0.8 * rand(0.9, 1.1), m, {});
          spawnBurst(m.pos, 0x9b6cd6, 26, 3);
          FX.spawnRing(m.pos, 0x9b6cd6, 5, 0.5);
          FX.addShakeAt(m.pos, 0.5);
        }
      }
    }
  } else {
    // aggro scan (suppressed while the monster is walking home after a reset)
    if (m.def.aggressive && !m.returning) {
      for (const pm of S.party) {
        if (pm.alive && m.distTo(pm) < m.def.sight) {
          m.aggroOn = pm;
          UI.log(`${cap(tname(m))} notices ${pm === S.player ? 'you' : pm.name} and attacks!`, 'dmg-in');
          UI.floater(m, '!', 'crit');
          break;
        }
      }
    }
    // wander
    m.wanderT -= dt;
    if (m.dest) {
      const dx = m.dest.x - m.pos.x, dz = m.dest.z - m.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.5) { m.dest = null; m.returning = false; }   // home again — senses back on
      else moveEntity(m, dx / d, dz / d, dt, 0.45);
    } else if (m.wanderT <= 0) {
      m.wanderT = rand(4, 10);
      const a = rand(0, Math.PI * 2), r = rand(2, 8);
      m.dest = { x: clamp(m.home.x + Math.cos(a) * r, -92, 92), z: clamp(m.home.z + Math.sin(a) * r, -92, 92) };
    }
  }
}

function updateNodes(dt) {
  for (const n of S.nodes) {
    if (!n.available) {
      n.respawnT -= dt;
      if (n.respawnT <= 0) { n.available = true; n.sparkle.visible = true; }
    } else {
      n.sparkle.material.opacity = 0.6 + Math.sin(G.now * 4 + n.x) * 0.4;
    }
  }
}

function updateCasting(dt) {
  for (const e of S.party) {
    if (!e.casting) continue;
    const c = e.casting;
    c.t += dt;
    if (e === S.player) UI.updateCastbar(c.t / c.total);
    if (c.gather) {
      if (S.player.distTo({ pos: c.gather.mesh.position }) > 4) { e.casting = null; UI.hideCastbar(); if (!Socket.isConnected()) UI.log('Interrupted.', 'sys'); continue; }
      if (c.t >= c.total) {
        e.casting = null;
        UI.hideCastbar();
        if (!Socket.isConnected()) finishGather(c.gather);
      }
      continue;
    }
    const a = ACTIONS[c.action];
    if (c.target && !c.target.alive && a.type !== 'buff') {
      e.casting = null;
      if (e === S.player) {
        UI.hideCastbar();
        if (!Socket.isConnected()) UI.log('Casting interrupted — target is gone.', 'sys');
      }
      continue;
    }
    if (c.t >= c.total) {
      e.casting = null;
      if (e === S.player) UI.hideCastbar();
      if (!Socket.isConnected()) {
        resolveAction(e, c.action, c.target);
      }
    }
  }

  if (Socket.isConnected()) {
    for (const m of S.monsters) {
      if (m.casting) {
        m.casting.t += dt;
        if (m.casting.t >= m.casting.total) {
          m.casting = null;
        }
      }
    }
  }
}

function updateBuffsAndRegen(dt) {
  const inCombat = S.monsters.some(m => m.alive && m.aggroOn && m.aggroOn.isFriendly()) || S.player.engaged;
  G.combatTimer = inCombat ? 0 : G.combatTimer + dt;
  for (const e of S.party) {
    for (const [k, b] of Object.entries(e.buffs)) {
      b.t -= dt;
      if (b.t <= 0) { delete e.buffs[k]; if (e === S.player) UI.log(`The effect of ${k} wears off.`, 'sys'); }
    }
    if (e.alive && G.combatTimer > 4) {
      e.hp = Math.min(e.maxhp, e.hp + e.maxhp * 0.018 * dt);
      e.mp = Math.min(e.maxmp, e.mp + e.maxmp * 0.02 * dt);
    }
  }
}

// =====================================================================
// save / load
// =====================================================================
const SAVE_KEY = 'vanadiel_reverie_v1';
const CLOUD_SYNC_MIN_INTERVAL = 15; // seconds between cloud saves

let lastCloudSync = 0;

function snapshot() {
  return {
    charName: S.charName, appearance: S.appearance,
    job: S.job, jobs: S.jobs, gil: S.gil,
    inventory: S.inventory, equipPerJob: S.equipPerJob,
    quests: S.quests, bossDown: S.bossDown,
    recruited: S.recruited, autoMagic: S.autoMagic,
    vitals: { hp: Math.round(S.player.hp), mp: Math.round(S.player.mp) },
    pos: { x: Math.round(S.player.pos.x), z: Math.round(S.player.pos.z) },
  };
}

export function saveGame(opts = {}) {
  if (!S.player) return;
  const data = snapshot();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* private mode */ }

  if (!API.isEnabled() || !API.getToken()) return;
  const force = !!opts.force;
  if (!force && G.now - lastCloudSync < CLOUD_SYNC_MIN_INTERVAL) return;
  lastCloudSync = G.now;
  API.saveCharacter(data, !!opts.keepalive).catch((e) => console.warn('Cloud save failed:', e.message));
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

export function findActor(id) {
  if (!id) return null;
  // 1. Is it the local player?
  if (id === 'player' || id === S.charName || (Socket.isConnected() && id === Socket.getId())) {
    return S.player;
  }
  // 2. Is it in the party/companions?
  for (const c of S.party) {
    if (c.name === id || c.id === id) return c;
  }
  // 3. Is it a server-controlled monster?
  const m = S.monsters.find(mon => mon.id === id);
  if (m) return m;

  // 4. Is it a remote player puppet?
  const puppet = Puppets.getPuppet(id);
  if (puppet) return puppet;

  return null;
}
