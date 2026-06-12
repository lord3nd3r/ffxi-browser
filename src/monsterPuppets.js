import * as THREE from 'three';
import { S } from './state.js';
import { Entity, makeNameplate } from './entities.js';
import { MONSTERS } from './data.js';
import { makeMonsterMesh, setLoopAnim } from './entities.js';

/**
 * Apply server-authoritative snapshot of nearby monsters.
 * Spawns new puppets, updates coordinates/HP of existing ones, and culls out-of-range ones.
 * @param {Array<Object>} snapshot
 */
export function applySnapshot(snapshot) {
  if (!Array.isArray(snapshot)) return;

  for (const p of snapshot) {
    if (p.gone) {
      removeMonster(p.id);
      continue;
    }

    let e = S.monsters.find(m => m.id === p.id);
    if (!e) {
      // Spawn new monster puppet
      const def = MONSTERS[p.typeId];
      if (!def) continue;

      const { group, parts, mixer, anims } = makeMonsterMesh(def.family);

      const plate = makeNameplate(def.name, def.aggressive ? '#ff9d9d' : '#f3e9c8');
      plate.position.y = def.family === 'boss' ? 4.6 : (def.family === 'orc' ? 2.6 : 1.6);
      group.add(plate);

      group.position.set(p.x, S.heightAt(p.x, p.z), p.z);
      group.rotation.y = p.heading;
      S.scene.add(group);

      e = new Entity({
        kind: 'monster',
        id: p.id,
        typeId: p.typeId,
        def,
        name: def.name,
        level: p.level,
        hp: p.hp,
        maxhp: p.maxhp,
        speed: def.speed,
        mesh: group,
        parts,
        mixer,
        anims,
        home: { x: p.x, z: p.z },
        targetX: p.x,
        targetZ: p.z,
        targetHeading: p.heading,
        moving: !!p.moving,
        alive: p.hp > 0,
        plate,
      });

      if (mixer) setLoopAnim(e, p.hp > 0 ? (p.moving ? 'Running_A' : 'Idle') : 'Death_A');
      S.monsters.push(e);
    } else {
      // Update targets for interpolation
      e.targetX = p.x;
      e.targetZ = p.z;
      e.targetHeading = p.heading;
      e.moving = !!p.moving;
      e.hp = p.hp;
      e.maxhp = p.maxhp;
      e.alive = p.hp > 0;
      e.sleep = p.sleep;
    }
  }
}

/**
 * Despawn and clean up a monster by ID.
 * @param {string} id
 */
export function removeMonster(id) {
  const idx = S.monsters.findIndex(m => m.id === id);
  if (idx >= 0) {
    const e = S.monsters[idx];
    if (e.mesh) S.scene.remove(e.mesh);
    S.monsters.splice(idx, 1);
  }
}

/**
 * Remove all monsters from the scene.
 */
export function clearMonsters() {
  for (const m of [...S.monsters]) {
    if (m.mesh) S.scene.remove(m.mesh);
  }
  S.monsters.length = 0;
}

/**
 * Smoothly interpolate position/rotation and tick animations.
 * Called every frame in the main render loop.
 * @param {number} dt Delta time in seconds
 */
export function updateMonsters(dt) {
  for (const m of S.monsters) {
    // Skip offline monsters
    if (typeof m.id === 'number') continue;

    if (!m.alive) {
      if (m.mixer) {
        m.mixer.update(dt);
      } else {
        m.mesh.rotation.z = THREE.MathUtils.lerp(m.mesh.rotation.z, Math.PI / 2, dt * 3);
      }
      continue;
    }

    // Wings flap for bee/bat
    if (m.def.family === 'bee' || m.def.family === 'bat') {
      m.animT = (m.animT || 0) + dt;
      m.mesh.position.y = S.heightAt(m.pos.x, m.pos.z) + 0.25 + Math.sin(m.animT * 5) * 0.12;
      if (m.parts.wings) {
        for (const w of m.parts.wings) {
          w.rotation.z = Math.sin(m.animT * 50) * 0.45;
        }
      }
    }

    // Interpolate position
    const posLerp = Math.min(dt * 10, 1);
    m.pos.x = THREE.MathUtils.lerp(m.pos.x, m.targetX, posLerp);
    m.pos.z = THREE.MathUtils.lerp(m.pos.z, m.targetZ, posLerp);

    if (m.def.family !== 'bee' && m.def.family !== 'bat') {
      m.pos.y = S.heightAt(m.pos.x, m.pos.z);
    }

    // Interpolate rotation
    m.heading = m.targetHeading;
    let diff = m.heading - m.mesh.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    m.mesh.rotation.y += diff * Math.min(1, dt * 12);

    // Set loop animations
    const currentSpeedDist = Math.hypot(m.pos.x - m.targetX, m.pos.z - m.targetZ);
    const isMoving = m.moving || currentSpeedDist > 0.1;

    let loop = 'Idle';
    if (m.sleep) loop = 'Sit_Floor_Idle'; // map sleep to sitting
    else if (isMoving) loop = 'Running_A';

    if (m.mixer) {
      setLoopAnim(m, loop);
      m.mixer.update(dt);
    }
  }
}
