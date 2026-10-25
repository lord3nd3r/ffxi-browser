// Zone streaming. Coordinates stay in one world so saves and the optional
// server (which only stores x/z) keep working:
//   sanria     Port Sanria, the starting city, around the origin
//   sarutaria  West Sarutaria fields, the original hunting grounds
//   horutoto   Inner Horutoto, a crypt entered from the ruin altar
// City and field share the old map; the dungeon sits far away so a server
// that does not understand zones simply sees a distant position.
import { S } from './state.js';
import { mountZoneScenery } from './world.js';

export const ZONES = {
  sanria: {
    id: 'sanria',
    name: 'Port Sanria',
    region: 'The Republic Gate',
    minX: -24, maxX: 24, minZ: -19, maxZ: 28.4,
  },
  sarutaria: {
    id: 'sarutaria',
    name: 'West Sarutaria',
    region: 'The Plains',
    minX: -96, maxX: 96, minZ: -96, maxZ: 96,
  },
  horutoto: {
    id: 'horutoto',
    name: 'Inner Horutoto',
    region: 'The Crypt',
    minX: 478, maxX: 522, minZ: 492, maxZ: 556,
  },
};

let lock = false;
let hooks = { onEnter() {} };

export function setZoneHooks(h) { hooks = { ...hooks, ...h }; }
export function zoneLocked() { return lock; }

export function zoneAt(x, z) {
  if (x > 460 && x < 560 && z > 470 && z < 580) return 'horutoto';
  if (x >= ZONES.sanria.minX && x <= ZONES.sanria.maxX && z >= ZONES.sanria.minZ && z <= ZONES.sanria.maxZ) return 'sanria';
  return 'sarutaria';
}

export function activeBounds() {
  return ZONES[S.zone] || ZONES.sanria;
}

export function minimapBounds() {
  const id = S.zone || 'sanria';
  if (id === 'sanria') return { minX: -28, maxX: 28, minZ: -22, maxZ: 34 };
  if (id === 'horutoto') return { minX: 478, maxX: 522, minZ: 496, maxZ: 554 };
  return { minX: -95, maxX: 95, minZ: -95, maxZ: 95 };
}

// Walk-in zone lines. Volumes sit just past the visible arch so the
// arrival point is not still inside the trigger.
export function portalFor(zone, x, z) {
  if (zone === 'sanria') {
    if (Math.abs(x) < 4.6 && z > 26.15 && z < 28.6) return { id: 'sarutaria', x: 0, z: 39 };
  } else if (zone === 'sarutaria') {
    if (Math.abs(x) < 4.6 && z > 32.4 && z < 36.2) return { id: 'sanria', x: 0, z: 17 };
    if (Math.hypot(x + 70, z + 68) < 2.15) return { id: 'horutoto', x: 500, z: 508 };
  } else if (zone === 'horutoto') {
    if (Math.abs(x - 500) < 3.2 && z > 544 && z < 552) return { id: 'sarutaria', x: -70, z: -56 };
  }
  return null;
}

function setLabel(id) {
  const z = ZONES[id];
  const nameEl = document.getElementById('zone-name');
  if (nameEl && z) nameEl.textContent = z.name;
  const sub = document.getElementById('zone-region');
  if (sub && z) sub.textContent = z.region;
}

function showBanner(id) {
  const z = ZONES[id];
  const banner = document.getElementById('zone-banner');
  const text = document.getElementById('zone-banner-text');
  if (!banner || !text || !z) return;
  text.textContent = z.name;
  banner.classList.add('show');
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => banner.classList.remove('show'), 2400);
}

function fadeThrough(fn) {
  const el = document.getElementById('zone-fade');
  if (!el) { fn(); return; }
  el.style.opacity = '1';
  setTimeout(() => {
    fn();
    requestAnimationFrame(() => { el.style.opacity = '0'; });
  }, 260);
}

export function ensureScenery(id) {
  if (!ZONES[id]) id = 'sanria';
  if (S.zone === id && S.zoneRoot) {
    setLabel(id);
    return;
  }
  mountZoneScenery(id);
  setLabel(id);
}

// Move the party into a zone. Actor respawn is the game.js hook.
export function changeZone(id, x, z, opts = {}) {
  if (lock) return;
  if (!ZONES[id]) return;
  lock = true;
  const go = () => {
    ensureScenery(id);
    const y = S.heightAt ? S.heightAt(x, z) : 0;
    if (S.player && S.player.mesh) {
      S.player.dest = null;
      S.player.mesh.position.set(x, y, z);
      if (S.player.casting) S.player.casting = null;
    }
    if (S.party) {
      let i = 0;
      for (const c of S.party) {
        if (!c.mesh || c === S.player) continue;
        i++;
        const ox = x + Math.cos(i) * 1.6;
        const oz = z + Math.sin(i) * 1.6;
        c.mesh.position.set(ox, S.heightAt(ox, oz), oz);
        c.dest = null;
      }
    }
    if (S.target && S.target.kind === 'monster') S.target = null;
    try { hooks.onEnter(id); } catch (err) { console.error(err); }
    showBanner(id);
    setTimeout(() => { lock = false; }, 650);
  };
  if (opts.instant) go();
  else fadeThrough(go);
}

if (typeof window !== 'undefined') {
  window.__zones = { changeZone, zoneAt, ZONES };
}
