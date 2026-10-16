// Graphics presets. Low is the default: no post-processing, no shadow map,
// no image-based reflections. Meant for a modest integrated GPU.
const KEY = 'vanadiel_quality_v1';

export const PRESETS = {
  low: {
    id: 'low',
    label: 'Low',
    pixelRatio: 1,
    antialias: false,
    shadows: false,
    shadowSize: 512,
    shadowType: 'basic',
    post: false,
    terrainSegs: 80,
    trees: 28,
    rocks: 14,
    tufts: 280,
    ferns: 50,
    palms: 8,
    dust: 0,
    pointLights: false,
    anisotropy: 1,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    pixelRatio: 1,
    antialias: false,
    shadows: true,
    shadowSize: 512,
    shadowType: 'basic',
    post: false,
    terrainSegs: 110,
    trees: 48,
    rocks: 22,
    tufts: 700,
    ferns: 100,
    palms: 14,
    dust: 40,
    pointLights: false,
    anisotropy: 2,
  },
  high: {
    id: 'high',
    label: 'High',
    pixelRatio: 1.25,
    antialias: false,
    shadows: true,
    shadowSize: 1024,
    shadowType: 'pcf',
    post: true,
    terrainSegs: 140,
    trees: 72,
    rocks: 30,
    tufts: 1100,
    ferns: 160,
    palms: 20,
    dust: 70,
    pointLights: true,
    anisotropy: 4,
  },
};

const ORDER = ['low', 'medium', 'high'];

export function qualityId() {
  try {
    const v = localStorage.getItem(KEY);
    if (PRESETS[v]) return v;
  } catch (e) { /* private mode */ }
  return 'low';
}

export function quality() {
  return PRESETS[qualityId()];
}

export function qualityName() {
  return quality().label;
}

export function cycleQuality() {
  const i = ORDER.indexOf(qualityId());
  const next = ORDER[(i + 1) % ORDER.length];
  try { localStorage.setItem(KEY, next); } catch (e) { /* private mode */ }
  return next;
}
