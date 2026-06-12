import * as THREE from 'three';
import { S } from './state.js';
import { Entity, makeCharacterModel, makeNameplate, setLoopAnim } from './entities.js';
import { JOB_MODEL } from './game.js';

/**
 * Puppet entry shape:
 * {
 *   entity: Entity,
 *   targetX: number,
 *   targetZ: number,
 *   targetHeading: number,
 *   moving: boolean,
 *   lastSeen: number,
 *   job: string,
 *   appearance: any
 * }
 */
const puppets = new Map();

/**
 * Apply a multiplayer snapshot of nearby players.
 * Spawns new puppets, updates existing ones, and despawns gone/out-of-range ones.
 * @param {Array<Object>} snapshot
 */
export function applySnapshot(snapshot) {
  if (!Array.isArray(snapshot)) return;

  const activeIds = new Set();

  for (const p of snapshot) {
    if (p.gone) {
      removePuppet(p.id);
      continue;
    }

    activeIds.add(p.id);
    const existing = puppets.get(p.id);

    if (!existing) {
      // Spawn new puppet
      const e = new Entity({
        kind: 'player',
        name: p.charName,
        speed: 5.2,
      });

      const { group, mixer, anims, parts } = makeCharacterModel(JOB_MODEL[p.job] || 'Knight', {
        appearance: p.appearance,
      });

      const plate = makeNameplate(p.charName, '#e8edf8');
      plate.position.y = 2.05;
      group.add(plate);

      e.mesh = group;
      e.parts = parts;
      e.mixer = mixer;
      e.anims = anims;
      e.curAction = null;
      e.curLoop = null;
      e.oneShotAction = null;

      group.position.set(p.x, S.heightAt(p.x, p.z), p.z);
      group.rotation.y = p.heading;
      S.scene.add(group);

      setLoopAnim(e, p.moving ? 'Running_A' : 'Idle');

      puppets.set(p.id, {
        entity: e,
        targetX: p.x,
        targetZ: p.z,
        targetHeading: p.heading,
        moving: !!p.moving,
        lastSeen: Date.now(),
        job: p.job,
        appearance: p.appearance,
      });
    } else {
      // Rebuild if job or appearance changed
      if (existing.job !== p.job || JSON.stringify(existing.appearance) !== JSON.stringify(p.appearance)) {
        S.scene.remove(existing.entity.mesh);

        const { group, mixer, anims, parts } = makeCharacterModel(JOB_MODEL[p.job] || 'Knight', {
          appearance: p.appearance,
        });

        const plate = makeNameplate(p.charName, '#e8edf8');
        plate.position.y = 2.05;
        group.add(plate);

        // Keep current position and rotation for smooth interpolation
        group.position.copy(existing.entity.mesh.position);
        group.rotation.copy(existing.entity.mesh.rotation);
        S.scene.add(group);

        existing.entity.mesh = group;
        existing.entity.parts = parts;
        existing.entity.mixer = mixer;
        existing.entity.anims = anims;
        existing.entity.curAction = null;
        existing.entity.curLoop = null;
        existing.entity.oneShotAction = null;
        existing.job = p.job;
        existing.appearance = p.appearance;
      }

      // Update target positions for interpolation
      existing.targetX = p.x;
      existing.targetZ = p.z;
      existing.targetHeading = p.heading;
      existing.moving = !!p.moving;
      existing.lastSeen = Date.now();
    }
  }
}

/**
 * Remove/despawn a puppet immediately.
 * @param {string} id Socket ID
 */
export function removePuppet(id) {
  const p = puppets.get(id);
  if (p) {
    if (p.entity?.mesh) {
      S.scene.remove(p.entity.mesh);
    }
    puppets.delete(id);
  }
}

/**
 * Update all puppets: interpolate positions/headings, update animations.
 * Called every frame in the main game loop.
 * @param {number} dt Delta time in seconds
 */
export function updatePuppets(dt) {
  const now = Date.now();

  for (const [id, p] of puppets) {
    // Timeout stale puppets (fallback for missed disconnects)
    if (now - p.lastSeen > 5000) {
      removePuppet(id);
      continue;
    }

    const entity = p.entity;
    if (!entity || !entity.mesh) continue;

    // Interpolate position: cover the gap in ~100ms
    const posLerp = Math.min(dt * 10, 1);
    entity.pos.x = THREE.MathUtils.lerp(entity.pos.x, p.targetX, posLerp);
    entity.pos.z = THREE.MathUtils.lerp(entity.pos.z, p.targetZ, posLerp);
    entity.pos.y = S.heightAt(entity.pos.x, entity.pos.z);

    // Interpolate heading (shortest-arc rotation)
    entity.heading = p.targetHeading;
    let diff = entity.heading - entity.mesh.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    entity.mesh.rotation.y += diff * Math.min(1, dt * 12);

    // Update casting timer
    if (entity.casting) {
      entity.casting.t += dt;
      if (entity.casting.t >= entity.casting.total) {
        entity.casting = null;
      }
    }

    // Update animations based on actual movement speed or moving flag
    const currentSpeedDist = Math.hypot(entity.pos.x - p.targetX, entity.pos.z - p.targetZ);
    const isMoving = p.moving || currentSpeedDist > 0.1;
    let loop = 'Idle';
    if (entity.casting) loop = entity.casting.gather ? 'Interact' : 'Spellcasting';
    else if (isMoving) loop = 'Running_A';
    setLoopAnim(entity, loop);

    // Update animation mixer
    if (entity.mixer) {
      entity.mixer.update(dt);
    }
  }
}

/**
 * Get total number of active remote players.
 * @returns {number}
 */
export function getCount() {
  return puppets.size;
}

/**
 * Remove and cleanup all puppets from the scene and map.
 */
export function clearPuppets() {
  for (const id of puppets.keys()) {
    removePuppet(id);
  }
}

export function getPuppet(id) {
  return puppets.get(id)?.entity;
}
