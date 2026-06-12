// Combat & spell visual effects: configurable particles, per-element spell
// composites, weapon-skill flourishes (shockwave ring + camera shake),
// damage tint flashes, and persistent buff/debuff auras.
import * as THREE from 'three';
import { S, rand } from './state.js';
import { ACTIONS } from './data.js';

const groups = [];     // particle bursts
const rings = [];      // expanding shockwave rings
const glows = [];      // additive glow sprites
const bolts = [];      // travelling spell projectiles
const flashes = [];    // material emissive tint flashes

// =====================================================================
// generic particles
// =====================================================================
export function spawnEffect(pos, opts = {}) {
  const {
    color = 0xffffff, n = 12, size = 0.22, life = 0.8,
    gravity = -3.5,        // vy change per second (negative = falls)
    spread = 1.5,          // velocity scale (matches old spawnBurst feel)
    up = [0.4, 1.6],       // vertical velocity range before spread scaling
    radius = 0,            // horizontal spawn jitter
    height = 0,            // vertical spawn span above the base point
    y = 1,                 // base height offset
    drag = 0,              // velocity damping per second
    additive = false,
  } = opts;
  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array(n * 3);
  const vels = [];
  for (let i = 0; i < n; i++) {
    verts[i * 3] = pos.x + rand(-radius, radius);
    verts[i * 3 + 1] = pos.y + y + rand(0, height);
    verts[i * 3 + 2] = pos.z + rand(-radius, radius);
    vels.push(new THREE.Vector3(rand(-1, 1), rand(up[0], up[1]), rand(-1, 1)).multiplyScalar(spread * 2));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  const mat = new THREE.PointsMaterial({
    color, size, transparent: true, opacity: 1, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  S.scene.add(pts);
  groups.push({ pts, vels, t: 0, life, gravity, drag });
}

// classic burst, kept for all the existing call sites
export function spawnBurst(pos, color, n = 12, spread = 1.5) {
  spawnEffect(pos, { color, n, spread });
}

// =====================================================================
// shockwave rings & glow flashes
// =====================================================================
export function spawnRing(pos, color, maxR = 2.5, life = 0.45) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.72, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(pos.x, S.heightAt(pos.x, pos.z) + 0.12, pos.z);
  S.scene.add(m);
  rings.push({ m, t: 0, life, maxR });
}

let glowTex = null;
function getGlowTex() {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
  }
  return glowTex;
}

function spawnGlow(pos, color, scale = 2, life = 0.3, y = 1) {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTex(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  spr.position.set(pos.x, pos.y + y, pos.z);
  spr.scale.setScalar(scale * 0.6);
  S.scene.add(spr);
  glows.push({ spr, t: 0, life, scale });
}

// =====================================================================
// camera shake (read by controls.js updateCamera)
// =====================================================================
let shakeT = 0, shakeDur = 0.35, shakeMag = 0;
const ZERO = { x: 0, y: 0, z: 0 };

export function addShake(mag) {
  if (mag <= shakeMag * (shakeT / shakeDur)) return;   // don't downgrade a live shake
  shakeMag = mag;
  shakeT = shakeDur;
}
export function addShakeAt(pos, mag) {
  const d = S.player ? Math.hypot(pos.x - S.player.pos.x, pos.z - S.player.pos.z) : 0;
  addShake(mag / (1 + d * 0.08));
}
export function getShake() {
  if (shakeT <= 0 || !shakeMag) return ZERO;
  const k = shakeMag * (shakeT / shakeDur);
  return { x: rand(-k, k), y: rand(-k, k) * 0.6, z: rand(-k, k) };
}

// =====================================================================
// damage tint flash
// =====================================================================
export function tintFlash(e, color = 0xff5544, dur = 0.18) {
  if (!e || !e.mesh) return;
  // models cloned via SkeletonUtils share materials — give this entity its
  // own copies once so the flash doesn't light up every twin on the field
  if (!e._ownMats) {
    e._ownMats = true;
    e.mesh.traverse(o => { if (o.isMesh && o.material && o.material.emissive) o.material = o.material.clone(); });
  }
  const mats = [];
  e.mesh.traverse(o => { if (o.isMesh && o.material && o.material.emissive) mats.push(o.material); });
  for (const m of mats) {
    if (m._baseEmissive === undefined) { m._baseEmissive = m.emissive.getHex(); m._baseEI = m.emissiveIntensity; }
    m.emissive.setHex(color);
    m.emissiveIntensity = 0.55;
  }
  flashes.push({ mats, t: 0, dur });
}

// =====================================================================
// spell projectiles & per-element composites
// =====================================================================
function launchBolt(caster, target, color, impact, dur = 0.28) {
  if (!caster || !caster.pos) { impact(target.pos || target); return; }
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTex(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const from = new THREE.Vector3(caster.pos.x, caster.pos.y + 1.4, caster.pos.z);
  spr.position.copy(from);
  spr.scale.setScalar(0.7);
  S.scene.add(spr);
  bolts.push({ spr, from, target, color, impact, t: 0, dur, trailT: 0 });
}

function impactStone(pos, big) {
  spawnEffect(pos, { color: 0x9c7a4d, n: big ? 24 : 14, size: 0.3, life: 0.9, gravity: -9, spread: 1.1, up: [1.5, 3], y: 0.4, radius: 0.4 });   // chunks arcing up
  spawnEffect(pos, { color: 0xcbb389, n: 10, size: 0.18, life: 0.7, gravity: 0.4, spread: 0.6, up: [0.1, 0.5], y: 0.3, radius: 0.5 });          // dust
  spawnRing(pos, 0xb08968, big ? 3.2 : 2.2);
  if (big) addShakeAt(pos, 0.25);
}
function impactBlizzard(pos) {
  spawnGlow(pos, 0xa5d8ff, 1.6, 0.25);
  spawnEffect(pos, { color: 0xd0ebff, n: 16, size: 0.2, life: 1.0, gravity: -1.2, spread: 1.2, up: [0.2, 1.2] });                               // ice shards
  spawnEffect(pos, { color: 0x74c0fc, n: 12, size: 0.26, life: 1.6, gravity: 0.15, spread: 0.25, up: [0, 0.3], additive: true, drag: 1.5, radius: 0.5 }); // lingering frost
}
function impactFire(pos) {
  spawnGlow(pos, 0xffa94d, 2.2, 0.3);
  spawnEffect(pos, { color: 0xff6b35, n: 18, size: 0.24, life: 0.9, gravity: 2.2, spread: 0.7, up: [0.8, 2.2], additive: true, radius: 0.4 });  // rising embers
  spawnEffect(pos, { color: 0xffd43b, n: 8, size: 0.3, life: 0.35, gravity: 0, spread: 1.3, additive: true });                                  // flash
}
function pillar(pos, color, n = 14) {   // cure / banish / buff light column
  spawnGlow(pos, color, 1.8, 0.4);
  spawnEffect(pos, { color, n, size: 0.2, life: 1.1, gravity: 0.5, spread: 0.15, up: [1.2, 2.4], radius: 0.55, height: 1.4, y: 0.2, additive: true });
}
function impactSleep(pos) {
  spawnEffect(pos, { color: 0xb197fc, n: 14, size: 0.22, life: 2.0, gravity: 0.35, spread: 0.2, up: [0.1, 0.4], radius: 0.6, y: 1.2, drag: 0.6 }); // drifting dust
}

const SPELL_FX = {
  stone:    (t) => impactStone(t, false),
  stone2:   (t) => impactStone(t, true),
  fire:     (t, c) => launchBolt(c, t, 0xff7b3a, impactFire),
  blizzard: (t, c) => launchBolt(c, t, 0x99d6ff, impactBlizzard),
  dia:      (t) => pillar(t.pos || t, 0xfff3bf, 12),
  banish:   (t) => pillar(t.pos || t, 0xfff9db, 18),
  cure:     (t) => pillar(t.pos || t, 0x8ce99a, 14),
  cure2:    (t) => pillar(t.pos || t, 0xb2f2bb, 22),
  chakra:   (t) => pillar(t.pos || t, 0x8ce99a, 14),
  protect:  (t) => pillar(t.pos || t, 0x99e9f2, 14),
  sleep:    (t) => impactSleep(t.pos || t),
};

export function spellEffect(actionId, target, caster) {
  const pos = target.pos || target;
  const fx = SPELL_FX[actionId];
  if (fx) { fx(actionId === 'fire' || actionId === 'blizzard' ? target : pos, caster); return; }
  const a = ACTIONS[actionId];
  if (a && a.type === 'heal') pillar(pos, 0x8ce99a, 14);
  else if (a && a.type === 'buff') pillar(pos, 0x99e9f2, 12);
  else spawnBurst(pos, 0xb197fc, 14, 1.6);
}

export function weaponSkillEffect(target, power = 2) {
  const pos = target.pos || target;
  spawnGlow(pos, 0xffd8a8, 1.2 + power * 0.5, 0.25);
  spawnEffect(pos, { color: 0xffa94d, n: Math.round(8 + power * 7), size: 0.24, life: 0.8, spread: 0.7 + power * 0.25, additive: true });
  spawnRing(pos, 0xffc078, 1.6 + power * 0.9, 0.4);
  addShakeAt(pos, 0.08 + power * 0.07);
}

// =====================================================================
// buff/debuff auras — a steady trickle of motes per active effect
// =====================================================================
const AURAS = {
  berserk:    { color: 0xff6b6b },
  boost:      { color: 0xffa94d },
  defender:   { color: 0x74a9ff },
  protect:    { color: 0x99e9f2 },
  dodge:      { color: 0x66d9e8 },
  flee:       { color: 0xe9ecef },
  sneak:      { color: 0x868e96, mist: true },
  armorbreak: { color: 0xffd43b, fall: true },
  slowed:     { color: 0x74c0fc, fall: true },
};

function auraMotes(e, def) {
  if (def.mist) spawnEffect(e.pos, { color: def.color, n: 2, size: 0.16, life: 1.4, gravity: 0.1, spread: 0.1, up: [0.05, 0.15], radius: 0.5, y: 0.15, additive: true });
  else if (def.fall) spawnEffect(e.pos, { color: def.color, n: 2, size: 0.14, life: 0.9, gravity: -2, spread: 0.12, up: [0.1, 0.3], radius: 0.45, y: 1.6 });
  else spawnEffect(e.pos, { color: def.color, n: 2, size: 0.14, life: 1.0, gravity: 0.6, spread: 0.12, up: [0.4, 0.9], radius: 0.5, y: 0.2, additive: true });
}

let auraT = 0;
function updateAuras(dt) {
  auraT += dt;
  if (auraT < 0.3 || !S.player) return;
  auraT = 0;
  for (const e of [...S.party, ...S.monsters]) {
    if (!e.alive || !e.mesh || !e.mesh.visible) continue;
    if (e.buffs) for (const k of Object.keys(e.buffs)) { if (AURAS[k]) auraMotes(e, AURAS[k]); }
    if (e.dot && e.dot.dia) auraMotes(e, { color: 0xffe27a, fall: true });   // Dia DoT golden drips
    if (e.sleep > 0) auraMotes(e, { color: 0xb197fc, mist: true });          // sleeping dust
  }
}

// =====================================================================
// per-frame update
// =====================================================================
export function updateEffects(dt) {
  // particles
  for (let i = groups.length - 1; i >= 0; i--) {
    const p = groups[i];
    p.t += dt;
    const pos = p.pts.geometry.attributes.position;
    for (let j = 0; j < p.vels.length; j++) {
      const v = p.vels[j];
      pos.array[j * 3] += v.x * dt;
      pos.array[j * 3 + 1] += v.y * dt;
      pos.array[j * 3 + 2] += v.z * dt;
      v.y += p.gravity * dt;
      if (p.drag) v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
    }
    pos.needsUpdate = true;
    p.pts.material.opacity = 1 - p.t / p.life;
    if (p.t >= p.life) {
      S.scene.remove(p.pts);
      p.pts.geometry.dispose(); p.pts.material.dispose();
      groups.splice(i, 1);
    }
  }

  // shockwave rings
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.t += dt;
    const k = r.t / r.life;
    const s = 1 + (r.maxR - 1) * (1 - (1 - k) * (1 - k));   // ease-out expand
    r.m.scale.set(s, s, 1);
    r.m.material.opacity = 0.9 * (1 - k);
    if (r.t >= r.life) {
      S.scene.remove(r.m);
      r.m.geometry.dispose(); r.m.material.dispose();
      rings.splice(i, 1);
    }
  }

  // glow sprites
  for (let i = glows.length - 1; i >= 0; i--) {
    const g = glows[i];
    g.t += dt;
    const k = g.t / g.life;
    g.spr.scale.setScalar(g.scale * (0.6 + 1.2 * k));
    g.spr.material.opacity = 1 - k;
    if (g.t >= g.life) {
      S.scene.remove(g.spr);
      g.spr.material.dispose();
      glows.splice(i, 1);
    }
  }

  // spell bolts
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.t += dt;
    const tp = b.target.pos || b.target;
    const k = Math.min(1, b.t / b.dur);
    b.spr.position.set(
      b.from.x + (tp.x - b.from.x) * k,
      b.from.y + (tp.y + 1 - b.from.y) * k + Math.sin(k * Math.PI) * 0.6,   // slight arc
      b.from.z + (tp.z - b.from.z) * k,
    );
    b.trailT += dt;
    if (b.trailT > 0.04) {
      b.trailT = 0;
      spawnEffect(b.spr.position, { color: b.color, n: 2, size: 0.14, life: 0.3, gravity: 0, spread: 0.08, up: [-0.2, 0.2], y: 0, additive: true });
    }
    if (k >= 1) {
      S.scene.remove(b.spr);
      b.spr.material.dispose();
      b.impact(tp);
      bolts.splice(i, 1);
    }
  }

  // tint flashes
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t += dt;
    if (f.t >= f.dur) {
      for (const m of f.mats) { m.emissive.setHex(m._baseEmissive); m.emissiveIntensity = m._baseEI; }
      flashes.splice(i, 1);
    }
  }

  // camera shake decay
  if (shakeT > 0) { shakeT -= dt; if (shakeT <= 0) shakeMag = 0; }

  updateAuras(dt);
}
