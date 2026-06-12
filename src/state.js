// Central mutable game state, shared by all modules. No imports here (keeps the
// module graph cycle-safe at load time).
export const S = {
  // three.js
  scene: null, renderer: null, camera: null,

  // world
  heightAt: (x, z) => 0,
  worldSize: 200,          // playable square is [-95, 95]
  time: 8.0,               // in-game hour 0..24
  day: 1,

  // entities
  player: null,
  party: [],               // [player, companion, companion]
  monsters: [],
  npcs: [],
  nodes: [],               // gathering nodes
  corpses: [],

  // targeting / input
  target: null,
  keys: {},
  mouse: { x: 0, y: 0 },
  camYaw: Math.PI,         // camera behind player facing north
  camPitch: 0.32,
  camDist: 9,
  firstPerson: false,
  autoRun: false,
  chatOpen: false,
  uiOpen: false,           // a dialog window is open

  // character sheet
  job: 'WAR',
  jobs: {
    WAR: { level: 1, exp: 0 },
    MNK: { level: 1, exp: 0 },
    WHM: { level: 1, exp: 0 },
    BLM: { level: 1, exp: 0 },
    THF: { level: 1, exp: 0 },
  },
  gil: 300,
  inventory: [],           // [{ id, qty }]
  equipment: { weapon: null, armor: null },   // per current job, item ids
  quests: {},              // id -> { state: 'active'|'done'|'rewarded', n: progress }
  bossDown: false,
  recruited: {},           // companion name -> joined the party at least once
  autoMagic: {},           // per-job auto-cast config (see autoCfg in game.js)
};

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const rand = (a, b) => a + Math.random() * (b - a);
export const irand = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
