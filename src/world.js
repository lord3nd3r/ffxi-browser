// World: heightfield terrain with real PBR texture splatting (ambientCG CC0),
// reflective ocean (three.js Water), photoscanned rocks (Poly Haven CC0),
// painterly card-foliage trees and plaster/timber/rooftile architecture —
// the same simple-geometry + rich-texture approach FFXI's own zones use.
import * as THREE from 'three';
import { S, clamp, lerp, rand } from './state.js';
import * as TEX from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Water } from 'three/addons/objects/Water.js';

// ---------- photoscanned models (Poly Haven CC0) ----------
const WM = {};
const REAL_FILES = {
  boulder: 'real/boulder_01/boulder_01_1k.gltf',
  rockset: 'real/rock_moss_set_01/rock_moss_set_01_1k.gltf',
};

export function preloadWorldModels(onProgress) {
  const loader = new GLTFLoader();
  const names = Object.keys(REAL_FILES);
  let done = 0;
  return Promise.all(names.map(n => new Promise((resolve, reject) => {
    loader.load(`models/${REAL_FILES[n]}`, (gltf) => {
      WM[n] = gltf.scene;
      done++;
      if (onProgress) onProgress(done, names.length);
      resolve();
    }, undefined, reject);
  })));
}

export function env(name, scale = 1) {
  if (name.startsWith('stump')) return makeStump(scale * 0.22);
  const o = WM[name].clone(true);
  o.scale.setScalar(scale);
  o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return o;
}

// ---------- deterministic value noise ----------
function hash(ix, iz) {
  let h = ix * 374761393 + iz * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}
function fbm(x, z) {
  return noise2(x * 0.018, z * 0.018) * 0.62 + noise2(x * 0.05, z * 0.05) * 0.27 + noise2(x * 0.13, z * 0.13) * 0.11;
}

// Town plateau at origin; pond hollow; ruins plateau in SW.
// 0..1 how deep into the coast strip (NW edge of the map) a point is
export function coastFactor(x, z) {
  return THREE.MathUtils.smoothstep(z, 60, 92) * THREE.MathUtils.smoothstep(25 - x, 6, 32);
}

export function terrainHeight(x, z) {
  let h = (fbm(x + 310, z - 170) - 0.45) * 13;
  h = Math.max(h, -1.0);     // no random inland puddles below the ocean plane
  const dTown = Math.hypot(x, z);
  if (dTown < 34) h = lerp(0.6, h, THREE.MathUtils.smoothstep(dTown, 20, 34));
  const dRuins = Math.hypot(x + 70, z + 68);
  if (dRuins < 26) h = lerp(1.4, h, THREE.MathUtils.smoothstep(dRuins, 14, 26));
  const dPond = Math.hypot(x - 44, z + 34);
  if (dPond < 14) h = lerp(-1.6, h, THREE.MathUtils.smoothstep(dPond, 6, 14));
  // coastline: terrain slopes down into the sea
  const coast = coastFactor(x, z);
  if (coast > 0) h = lerp(h, -4.5, coast);
  return h;
}

// ---------- static obstacle colliders ----------
// circles {x,z,r} for trees/rocks/posts/columns, AABBs for the town walls.
// Everything solid registers here at build time; moveEntity resolves against it.
const circles = [];
const boxes = [];
export function addCollider(x, z, r) { circles.push({ x, z, r }); }
function addBox(x, z, w, d, pad = 0.3) { boxes.push({ minX: x - w / 2 - pad, maxX: x + w / 2 + pad, minZ: z - d / 2 - pad, maxZ: z + d / 2 + pad }); }
const _bb = new THREE.Box3(), _sz = new THREE.Vector3(), _ct = new THREE.Vector3();
function addObjectCollider(obj, shrink = 0.8) {
  _bb.setFromObject(obj);
  _bb.getSize(_sz); _bb.getCenter(_ct);
  addCollider(_ct.x, _ct.z, Math.max(0.45, (_sz.x + _sz.z) / 4 * shrink));
}
const _rc = { x: 0, z: 0 };
export function resolveCollision(nx, nz) {
  for (const c of circles) {
    const dx = nx - c.x, dz = nz - c.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < c.r * c.r && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      nx = c.x + dx / d * c.r; nz = c.z + dz / d * c.r;
    }
  }
  for (const b of boxes) {
    if (nx > b.minX && nx < b.maxX && nz > b.minZ && nz < b.maxZ) {
      // push out along the axis of least penetration (lets you slide along walls)
      const dxl = nx - b.minX, dxr = b.maxX - nx, dzl = nz - b.minZ, dzr = b.maxZ - nz;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) nx = b.minX; else if (m === dxr) nx = b.maxX;
      else if (m === dzl) nz = b.minZ; else nz = b.maxZ;
    }
  }
  _rc.x = nx; _rc.z = nz;
  return _rc;
}

// nudge a spawn position out of every collider (NPCs, allies, monsters, nodes
// can otherwise end up inside stalls, walls or randomly-placed boulders)
export function findOpenSpot(x, z, pad = 0.4) {
  for (let it = 0; it < 4; it++) {
    let moved = false;
    for (const c of circles) {
      const r = c.r + pad;
      let dx = x - c.x, dz = z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 < 0.0001) {
        // dead center (e.g. vendor placed exactly on her stall) — step out toward town
        const dd = Math.hypot(c.x, c.z) || 1;
        dx = -c.x / dd; dz = -c.z / dd;
        x = c.x + dx * r; z = c.z + dz * r;
      } else {
        const d = Math.sqrt(d2);
        x = c.x + dx / d * r; z = c.z + dz / d * r;
      }
      moved = true;
    }
    for (const b of boxes) {
      if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) {
        const dxl = x - (b.minX - pad), dxr = (b.maxX + pad) - x, dzl = z - (b.minZ - pad), dzr = (b.maxZ + pad) - z;
        const m = Math.min(dxl, dxr, dzl, dzr);
        if (m === dxl) x = b.minX - pad; else if (m === dxr) x = b.maxX + pad;
        else if (m === dzl) z = b.minZ - pad; else z = b.maxZ + pad;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x, z };
}

let sun, hemi, ambient, skyMat, crystalMat, lampLights = [];
let M = null;   // shared PBR materials, built once in initMaterials()

// box with UVs rescaled so textures tile in world units (s = meters per tile)
function uvBox(w, h, d, s = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const f = dims[Math.floor(i / 4)];
    uv.setXY(i, uv.getX(i) * f[0] / s, uv.getY(i) * f[1] / s);
  }
  return g;
}
function uvCyl(rt, rb, h, seg, s = 2) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  const circ = Math.PI * (rt + rb);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ / s, uv.getY(i) * h / s);
  return g;
}
function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function initMaterials() {
  // lifelike PBR: full color + normal maps on every built surface
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...o });
  M = {
    plaster: std({ map: TEX.pbr('plaster'), normalMap: TEX.pbrN('plaster_n'), color: 0xefe6cf }),
    planks:  std({ map: TEX.pbr('planks'),  normalMap: TEX.pbrN('planks_n') }),
    roof:    std({ map: TEX.pbr('roof'),    normalMap: TEX.pbrN('roof_n'), roughness: 0.85 }),
    bricks:  std({ map: TEX.pbr('bricks'),  normalMap: TEX.pbrN('bricks_n'), color: 0xd8ccb6, roughness: 0.96 }),
    paving:  std({ map: TEX.pbr('paving'),  normalMap: TEX.pbrN('paving_n') }),
    bark:    std({ map: TEX.pbr('bark', 1, 2), normalMap: TEX.pbrN('bark_n', 1, 2) }),
  };
  // painterly foliage cards; custom depth materials give correct leaf shadows
  const card = (tex) => {
    const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.95 });
    m.userData.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.42 });
    return m;
  };
  M.leaf = card(TEX.foliageSprite());
  M.pine = card(TEX.pineSprite());
  M.frond = card(TEX.frondSprite());
}

function leafCard(mat, w, h) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.castShadow = true;
  m.customDepthMaterial = mat.userData.depth;
  return m;
}

// ---------- trees: bark trunk + painterly alpha cards (FFXI technique) ----------
function makeBroadleaf(s) {
  const g = new THREE.Group();
  const trunkH = 2.3 * s;
  const trunk = mesh(uvCyl(0.09 * s, 0.17 * s, trunkH, 7, 1.4), M.bark, 0, trunkH / 2, 0);
  g.add(trunk);
  const branch = mesh(uvCyl(0.05 * s, 0.08 * s, 1.1 * s, 6, 1.4), M.bark, 0.22 * s, trunkH * 0.78, 0);
  branch.rotation.z = -0.7;
  g.add(branch);
  const cy = trunkH + 0.55 * s;
  for (let i = 0; i < 8; i++) {
    const c = leafCard(M.leaf, rand(2.0, 2.9) * s, rand(1.8, 2.6) * s);
    c.position.set(rand(-0.7, 0.7) * s, cy + rand(-0.45, 0.6) * s, rand(-0.7, 0.7) * s);
    c.rotation.set(rand(-0.35, 0.35), rand(0, Math.PI), rand(-0.35, 0.35));
    g.add(c);
  }
  const top = leafCard(M.leaf, 2.6 * s, 2.6 * s);
  top.position.y = cy + 0.9 * s;
  top.rotation.x = -Math.PI / 2;
  g.add(top);
  return g;
}

function makePine(s) {
  const g = new THREE.Group();
  const trunkH = 3.4 * s;
  g.add(mesh(uvCyl(0.06 * s, 0.14 * s, trunkH, 7, 1.4), M.bark, 0, trunkH / 2, 0));
  for (let t = 0; t < 4; t++) {
    const w = (2.5 - t * 0.52) * s, h = (1.6 - t * 0.18) * s;
    const y = (1.15 + t * 0.78) * s + h / 2;
    for (const ry of [0, Math.PI / 2, Math.PI / 4]) {
      const c = leafCard(M.pine, w, h);
      c.position.y = y;
      c.rotation.y = ry + rand(-0.2, 0.2);
      g.add(c);
    }
  }
  return g;
}

function makeStump(s) {
  const g = new THREE.Group();
  const st = mesh(uvCyl(0.42 * s * 4, 0.52 * s * 4, 0.5 * s * 4, 9, 1.2), M.bark, 0, 0.25 * s * 4, 0);
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.42 * s * 4, 9), M.planks);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.51 * s * 4;
  g.add(st, top);
  return g;
}

export function initWorld() {
  const scene = S.scene;
  S.heightAt = terrainHeight;
  initMaterials();

  scene.fog = new THREE.Fog(0xcfe2ef, 55, 165);

  // ---------- lights ----------
  hemi = new THREE.HemisphereLight(0xbcd8ff, 0x6a7a4f, 0.95);
  scene.add(hemi);
  ambient = new THREE.AmbientLight(0xffffff, 0.12);
  scene.add(ambient);
  sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);

  // ---------- sky dome ----------
  skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, vertexColors: true });
  const skyGeo = new THREE.SphereGeometry(420, 24, 12);
  {
    const cols = [];
    const pos = skyGeo.attributes.position;
    const top = new THREE.Color(0x4e9ade), bot = new THREE.Color(0xcfe2ef);   // FFXI's bright cyan-blue sky; horizon matches fog
    for (let i = 0; i < pos.count; i++) {
      const t = clamp(pos.getY(i) / 420, 0, 1);
      const c = bot.clone().lerp(top, Math.pow(t, 0.8));
      cols.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  }
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // ---------- terrain: 4-way PBR texture splat (grass / dirt / sand / stone) ----------
  const size = S.worldSize, segs = 220;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [], splat = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);

    // splat weights from the zone layout
    const dT = Math.hypot(x, z);
    let wDirt = dT < 20 ? 1 - THREE.MathUtils.smoothstep(dT, 8, 20) : 0;
    const t = clamp((x * -70 + z * -68) / (70 * 70 + 68 * 68), 0, 1);
    const dR = Math.hypot(x + 70 * t, z + 68 * t);
    if (dR < 5) wDirt = Math.max(wDirt, (1 - dR / 5) * 0.85);
    const dRu = Math.hypot(x + 70, z + 68);
    let wStone = dRu < 16 ? 1 - THREE.MathUtils.smoothstep(dRu, 8, 16) : 0;
    if (h > 5) wStone = Math.max(wStone, clamp((h - 5) / 7, 0, 0.8));
    const coast = coastFactor(x, z);
    let wSand = clamp(coast * 3.2, 0, 1);
    const dP = Math.hypot(x - 44, z + 34);
    if (dP < 12) wSand = Math.max(wSand, 1 - THREE.MathUtils.smoothstep(dP, 6, 12));
    // Jugner-style forest floor: packed earth with a hint of stone under the canopy
    const dForest = Math.hypot(x - 55, z - 48);
    if (dForest < 34) {
      const f = 1 - THREE.MathUtils.smoothstep(dForest, 16, 34);
      wDirt = Math.max(wDirt, f * 0.7);
      wStone = Math.max(wStone, f * 0.18);
    }
    const wGrass = Math.max(0, 1 - wDirt - wStone - wSand);
    splat.push(wGrass, wDirt, wSand, wStone);

    // vertex color is a subtle tint over the textures
    let r = 0.9 + (noise2(x * 0.09 + 50, z * 0.09) - 0.5) * 0.22;
    let cr = r, cg = r, cb = r;
    const dF = Math.hypot(x - 55, z - 48);                       // NE woods: somber gray-brown floor (ss-1)
    if (dF < 34) {
      const f = 1 - THREE.MathUtils.smoothstep(dF, 18, 34);
      cr *= 1 - 0.3 * f; cg *= 1 - 0.28 * f; cb *= 1 - 0.26 * f;
    }
    colors.push(cr, cg, cb);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('splat', new THREE.Float32BufferAttribute(splat, 4));
  geo.computeVertexNormals();

  const tGrass = TEX.pbr('grass'), tDirt = TEX.pbr('dirt'), tSand = TEX.pbr('sand'), tStone = TEX.pbr('paving');
  const tMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  tMat.onBeforeCompile = (sh) => {
    sh.uniforms.tGrass = { value: tGrass };
    sh.uniforms.tDirt = { value: tDirt };
    sh.uniforms.tSand = { value: tSand };
    sh.uniforms.tStone = { value: tStone };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat; varying vec4 vSplat; varying vec2 vXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat; vXZ = vec2(position.x, position.z);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tGrass; uniform sampler2D tDirt; uniform sampler2D tSand; uniform sampler2D tStone; varying vec4 vSplat; varying vec2 vXZ;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec4 w = vSplat / max(vSplat.x + vSplat.y + vSplat.z + vSplat.w, 1e-4);
  // dual-scale sampling kills visible tiling: fine detail blended with a broad pass
  vec3 gr = mix(texture2D(tGrass, vXZ * 0.18).rgb, texture2D(tGrass, vXZ * 0.041).rgb, 0.4);
  vec3 sa = mix(texture2D(tSand,  vXZ * 0.15).rgb, texture2D(tSand,  vXZ * 0.037).rgb, 0.4);
  vec3 ter = gr * vec3(0.98, 1.14, 0.86) * w.x
           + texture2D(tDirt,  vXZ * 0.12).rgb * vec3(1.14, 1.06, 0.94) * w.y
           + sa * vec3(1.26, 1.2, 1.02) * w.z
           + texture2D(tStone, vXZ * 0.24).rgb * vec3(1.08, 1.08, 1.08) * w.w;
  diffuseColor.rgb *= ter * 1.3;
}`);
  };
  const terrain = new THREE.Mesh(geo, tMat);
  terrain.receiveShadow = true;
  terrain.name = 'terrain';
  scene.add(terrain);
  S.terrain = terrain;

  // ---------- pond ----------
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(11, 28),
    new THREE.MeshStandardMaterial({ color: 0x356e9e, transparent: true, opacity: 0.82, roughness: 0.1, metalness: 0.25 }),
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(44, -0.55, -34);
  scene.add(pond);

  buildVegetation(scene);
  buildVillage(scene);
  buildRuins(scene);
  buildHomePoint(scene);
  buildBeach(scene);
  buildSky(scene);
  buildRidges(scene);
}

function placeOnGround(obj, x, z, yOff = 0) {
  obj.position.set(x, terrainHeight(x, z) + yOff, z);
}

function inAnyClearing(x, z) {
  if (Math.hypot(x, z) < 26) return true;                 // town
  if (Math.hypot(x + 70, z + 68) < 20) return true;       // ruins
  if (Math.hypot(x - 44, z + 34) < 14) return true;       // pond
  if (coastFactor(x, z) > 0.06) return true;              // beach (palms only)
  const t = clamp((x * -70 + z * -68) / (70 * 70 + 68 * 68), 0, 1);
  if (Math.hypot(x + 70 * t, z + 68 * t) < 5) return true; // road
  return false;
}

function buildVegetation(scene) {
  const group = new THREE.Group();

  // trees: towering Jugner-style giants in the NE woods, scattered elsewhere
  let placed = 0;
  for (let i = 0; i < 900 && placed < 110; i++) {
    let x, z;
    const inForest = placed < 60;
    if (inForest) {
      const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 32;
      x = 55 + Math.cos(a) * r; z = 48 + Math.sin(a) * r;
    } else {
      x = rand(-92, 92); z = rand(-92, 92);
    }
    if (inAnyClearing(x, z) || Math.abs(x) > 92 || Math.abs(z) > 92) continue;
    const s = inForest ? rand(3.2, 5.0) : rand(1.5, 2.4);
    const tree = Math.random() < 0.55 ? makePine(s) : makeBroadleaf(s);
    placeOnGround(tree, x, z);
    tree.rotation.y = rand(0, 6);
    group.add(tree);
    addCollider(x, z, 0.3 * s);
    placed++;
  }

  // photoscanned boulders and rock clusters (Poly Haven)
  for (let i = 0; i < 40; i++) {
    const x = rand(-92, 92), z = rand(-92, 92);
    if (inAnyClearing(x, z)) continue;
    const rock = env(Math.random() < 0.5 ? 'boulder' : 'rockset', rand(0.8, 2.2));
    placeOnGround(rock, x, z, -0.05);
    rock.rotation.y = rand(0, 6);
    group.add(rock);
    addObjectCollider(rock);
  }

  // grass tufts: crossed alpha-tested blade quads
  const bladeTex = TEX.grassBlades();
  const p1 = new THREE.PlaneGeometry(0.9, 0.55);
  const p2 = p1.clone().rotateY(Math.PI / 2);
  const tuftGeo = mergeGeometries([p1, p2]);
  tuftGeo.translate(0, 0.26, 0);
  const tuftMat = new THREE.MeshStandardMaterial({ map: bladeTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95 });
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 2600);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), s4 = new THREE.Vector3();
  let ti = 0;
  for (let i = 0; i < 9000 && ti < 2600; i++) {
    const x = rand(-90, 90), z = rand(-90, 90);
    if (inAnyClearing(x, z)) continue;
    e4.set(0, rand(0, 6), 0);
    q4.setFromEuler(e4);
    const sc = rand(0.7, 1.5);
    s4.set(sc, sc, sc);
    m4.compose(new THREE.Vector3(x, terrainHeight(x, z), z), q4, s4);
    tufts.setMatrixAt(ti++, m4);
  }
  tufts.count = ti;
  scene.add(tufts);

  // forest ferns: bigger, darker tuft cards under the canopy
  const ferns = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ map: bladeTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, color: 0x5d7a4a }), 320);
  let fi = 0;
  for (let i = 0; i < 1500 && fi < 320; i++) {
    const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 32;
    const x = 55 + Math.cos(a) * r, z = 48 + Math.sin(a) * r;
    if (inAnyClearing(x, z) || Math.abs(x) > 92 || Math.abs(z) > 92) continue;
    e4.set(0, rand(0, 6), 0);
    q4.setFromEuler(e4);
    const sc = rand(0.9, 1.5);
    s4.set(sc, sc * 0.75, sc);
    m4.compose(new THREE.Vector3(x, terrainHeight(x, z), z), q4, s4);
    ferns.setMatrixAt(fi++, m4);
  }
  ferns.count = fi;
  scene.add(ferns);

  // fallen logs on the forest floor
  for (let i = 0; i < 8; i++) {
    const a = rand(0, Math.PI * 2), r = rand(6, 30);
    const x = 55 + Math.cos(a) * r, z = 48 + Math.sin(a) * r;
    if (inAnyClearing(x, z)) continue;
    const len = rand(3, 6);
    const log = mesh(uvCyl(rand(0.22, 0.4), rand(0.26, 0.45), len, 8, 1.4), M.bark);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = rand(0, Math.PI);
    placeOnGround(log, x, z, 0.3);
    group.add(log);
  }
  scene.add(group);

  // fireflies: drift over the meadows after dark
  const fGeo = new THREE.BufferGeometry();
  const fPos = [];
  for (let i = 0; i < 90; i++) {
    const x = rand(-60, 70), z = rand(-60, 60);
    fPos.push(x, terrainHeight(x, z) + rand(0.5, 2.2), z);
  }
  fGeo.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
  fireflies = new THREE.Points(fGeo, new THREE.PointsMaterial({ color: 0xcdf07a, size: 0.12, transparent: true, opacity: 0, depthWrite: false }));
  scene.add(fireflies);
}
let fireflies = null;

// ---------- town: plaster & timber cottages with tiled roofs ----------
const windowMats = [];
function buildVillage(scene) {
  const g = new THREE.Group();

  // ---------- FFXI-style outpost: market stalls, tents, banners — not a euro village ----------
  const awningRed = new THREE.MeshStandardMaterial({ map: TEX.awningStripes(), side: THREE.DoubleSide, roughness: 0.95 });
  const awningBlue = new THREE.MeshStandardMaterial({ map: TEX.awningStripes('#3a5a8e', '#e8e0d0'), side: THREE.DoubleSide, roughness: 0.95 });
  const canvasMat = new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: 1, side: THREE.DoubleSide });
  const bannerMat = new THREE.MeshStandardMaterial({ map: TEX.bannerSprite(), side: THREE.DoubleSide, roughness: 0.9 });

  function stall(x, z, rot, awn) {
    const s = new THREE.Group();
    for (const [px, pz] of [[-1.4, -0.9], [1.4, -0.9], [-1.4, 0.9], [1.4, 0.9]])
      s.add(mesh(uvCyl(0.06, 0.07, 2.5, 6, 1), M.planks, px, 1.25, pz));
    s.add(mesh(uvBox(3.0, 0.12, 1.0, 1.2), M.planks, 0, 0.95, 0.45));     // counter
    s.add(mesh(uvBox(2.8, 0.55, 1.5, 1.2), M.planks, 0, 0.3, -0.1));      // goods crates
    const top = mesh(new THREE.PlaneGeometry(3.5, 2.5), awn, 0, 2.6, 0);
    top.rotation.x = -Math.PI / 2 + 0.2;
    s.add(top);
    placeOnGround(s, x, z);
    s.rotation.y = rot;
    g.add(s);
    addCollider(x, z, 1.6);
  }
  function tent(x, z, rot, sc = 1) {
    const t = new THREE.Group();
    t.add(mesh(uvCyl(0.05, 0.05, 3.4 * sc, 5, 1), M.planks, 0, 1.7 * sc, 0));   // ridge supports
    for (const sgn of [1, -1]) {
      const side = mesh(new THREE.PlaneGeometry(3.4 * sc, 2.5 * sc), canvasMat, 0, 1.15 * sc, sgn * 0.85 * sc);
      side.rotation.x = sgn * -0.72;
      t.add(side);
    }
    placeOnGround(t, x, z);
    t.rotation.y = rot;
    g.add(t);
    addCollider(x, z, 1.5 * sc);
  }
  function banner(x, z) {
    const b = new THREE.Group();
    b.add(mesh(uvCyl(0.05, 0.07, 4.4, 6, 1), M.planks, 0, 2.2, 0));
    b.add(mesh(uvBox(1.1, 0.06, 0.06, 1), M.planks, 0.5, 4.25, 0));
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.7), bannerMat);
    f.position.set(0.52, 3.32, 0);
    f.castShadow = true;
    b.add(f);
    placeOnGround(b, x, z);
    g.add(b);
    addCollider(x, z, 0.25);
  }

  stall(-10, 6, 1.2, awningRed);      // Mirelle's weapons
  stall(10, 4, -1.2, awningBlue);     // Pikko-Wikko's goods
  stall(14, -8, -2.0, awningRed);     // Galdric's workshop
  tent(-7, 14, 0.5); tent(-13, -4, 1.8); tent(5, 17, -0.4, 1.2);
  banner(-7, 21); banner(7, 21); banner(-3, 8); banner(9, -2);

  // Father Odo's wayside shrine: stone dais, twin pillars, votive crystal
  const shrine = new THREE.Group();
  shrine.add(mesh(uvCyl(1.8, 2.1, 0.5, 12, 1.8), M.paving, 0, 0.25, 0));
  for (const px of [-1.1, 1.1]) shrine.add(mesh(uvCyl(0.22, 0.26, 2.6, 8, 1.6), M.bricks, px, 1.8, 0));
  shrine.add(mesh(uvBox(3.0, 0.35, 0.7, 1.6), M.paving, 0, 3.25, 0));
  const votive = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), new THREE.MeshStandardMaterial({ color: 0x9fd0ff, emissive: 0x2a66e0, emissiveIntensity: 0.8, transparent: true, opacity: 0.9 }));
  votive.position.y = 2.0;
  shrine.add(votive);
  placeOnGround(shrine, -4, -13);
  g.add(shrine);
  addCollider(-5.1, -13, 0.4);   // twin pillars only — the low dais stays walkable
  addCollider(-2.9, -13, 0.4);

  // campfire ring (lit at night)
  const fire = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    fire.add(mesh(new THREE.DodecahedronGeometry(0.18), M.paving, Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55));
  }
  const fl = new THREE.PointLight(0xff9d4d, 0, 10, 2);
  fl.position.y = 0.7;
  fire.add(fl);
  lampLights.push({ light: fl, head: null });
  placeOnGround(fire, -9, 12);
  g.add(fire);
  addCollider(-9, 12, 0.8);

  // stone wall + north gatehouse (San d'Oria-style masonry)
  function wallSeg(x, z, len, rot) {
    const w = new THREE.Group();
    w.add(mesh(uvBox(len, 2.7, 1.1, 2.0), M.bricks, 0, 1.35, 0));
    w.add(mesh(uvBox(len, 0.25, 1.4, 1.6), M.paving, 0, 2.8, 0));
    placeOnGround(w, x, z);
    w.rotation.y = rot;
    g.add(w);
    if (rot === 0) addBox(x, z, len, 1.4); else addBox(x, z, 1.4, len);
  }
  wallSeg(-12.4, 24, 16.5, 0);
  wallSeg(12.4, 24, 16.5, 0);
  wallSeg(-20.5, 14, 20, Math.PI / 2);
  wallSeg(20.5, 14, 20, Math.PI / 2);
  for (const tx of [-4.6, 4.6]) {
    const tw = new THREE.Group();
    tw.add(mesh(uvCyl(1.4, 1.6, 5.2, 12, 2.0), M.bricks, 0, 2.6, 0));
    tw.add(mesh(uvCyl(1.8, 1.8, 0.5, 12, 1.6), M.paving, 0, 5.4, 0));
    const cone = mesh(new THREE.ConeGeometry(1.9, 2.0, 12), M.roof, 0, 6.6, 0);
    tw.add(cone);
    placeOnGround(tw, tx, 24);
    g.add(tw);
    addCollider(tx, 24, 1.9);
  }
  const arch = new THREE.Group();
  arch.add(mesh(uvBox(9.4, 1.4, 1.5, 2.0), M.bricks, 0, 4.7, 0));
  placeOnGround(arch, 0, 24);
  g.add(arch);

  // lamp posts (lit at night)
  for (const [lx, lz] of [[6, 12], [-8, -6], [10, -4], [3, 21]]) {
    const lamp = new THREE.Group();
    lamp.add(mesh(uvCyl(0.07, 0.09, 3, 6, 1.0), M.planks, 0, 1.5, 0));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xff9d2e, emissiveIntensity: 0.4 }));
    head.position.y = 3.05;
    const light = new THREE.PointLight(0xffb35c, 0, 14, 2);
    light.position.y = 3;
    lamp.add(head, light);
    placeOnGround(lamp, lx, lz);
    lampLights.push({ light, head });
    g.add(lamp);
    addCollider(lx, lz, 0.25);
  }

  // market clutter
  for (const [bx, bz] of [[10.5, 2.5], [11.4, 3.3]]) {
    const b = mesh(uvCyl(0.42, 0.46, 0.9, 10, 0.9), M.planks);
    placeOnGround(b, bx, bz, 0.45);
    g.add(b);
    addCollider(bx, bz, 0.55);
  }
  const crate = mesh(uvBox(0.9, 0.9, 0.9, 0.9), M.planks);
  placeOnGround(crate, 13.2, 3.6, 0.45);
  crate.rotation.y = 0.4;
  g.add(crate);
  addCollider(13.2, 3.6, 0.7);

  scene.add(g);
}

// ---------- ruins: weathered masonry columns + scanned rubble ----------
function buildRuins(scene) {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const x = -70 + Math.cos(a) * 10, z = -68 + Math.sin(a) * 10;
    const h = i % 3 === 0 ? rand(3.6, 4.6) : rand(1.2, 2.6);
    const col = new THREE.Group();
    col.add(mesh(uvBox(1.3, 0.5, 1.3, 1.6), M.paving, 0, 0.25, 0));
    col.add(mesh(uvCyl(0.42, 0.5, h, 10, 1.6), M.bricks, 0, 0.5 + h / 2, 0));
    if (h > 3.4) col.add(mesh(uvBox(1.2, 0.4, 1.2, 1.6), M.paving, 0, 0.7 + h, 0));
    placeOnGround(col, x, z);
    col.rotation.y = rand(0, 6);
    col.rotation.z = rand(-0.04, 0.04);
    g.add(col);
    addCollider(x, z, 0.85);
  }
  // central altar + relic orb
  const altar = mesh(uvBox(3, 1, 3, 1.6), M.paving);
  placeOnGround(altar, -70, -68, 0.5);
  g.add(altar);
  addCollider(-70, -68, 1.9);
  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshStandardMaterial({ color: 0x9b6cd6, emissive: 0x6a30b0, emissiveIntensity: 0.8 }));
  orb.position.set(-70, altar.position.y + 1.2, -68);
  g.add(orb);
  // scanned-rock rubble
  for (let i = 0; i < 12; i++) {
    const a = rand(0, Math.PI * 2), r = rand(3, 14);
    const b = env(Math.random() < 0.5 ? 'boulder' : 'rockset', rand(0.5, 1.1));
    placeOnGround(b, -70 + Math.cos(a) * r, -68 + Math.sin(a) * r, -0.05);
    b.rotation.y = rand(0, 6);
    g.add(b);
    addObjectCollider(b);
  }
  // braziers by the altar (lit at night like the lamps)
  for (const dx of [-2.2, 2.2]) {
    const t = new THREE.Group();
    t.add(mesh(uvCyl(0.09, 0.12, 1.4, 6, 1.0), M.planks, 0, 0.7, 0));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xff9d2e, emissiveIntensity: 0.5 }));
    head.position.y = 1.5;
    const light = new THREE.PointLight(0xffb35c, 0, 12, 2);
    light.position.y = 1.5;
    t.add(head, light);
    placeOnGround(t, -70 + dx, -65.5);
    lampLights.push({ light, head });
    g.add(t);
    addCollider(-70 + dx, -65.5, 0.2);
  }
  scene.add(g);
}

function buildHomePoint(scene) {
  // the Mother Crystal — a crag-style monument, the Final Fantasy centerpiece
  crystalMat = new THREE.MeshStandardMaterial({ color: 0x6fb4ff, emissive: 0x2a66e0, emissiveIntensity: 0.85, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.86 });
  const grp = new THREE.Group();
  grp.add(mesh(uvCyl(4.4, 5.0, 0.6, 16, 1.8), M.paving, 0, 0.3, 0));     // two-step dais
  grp.add(mesh(uvCyl(3.2, 3.7, 0.6, 16, 1.8), M.paving, 0, 0.9, 0));
  // crystal cluster: one towering spire, four leaning shards
  const spire = (sx, sz, h, r, tilt, ry) => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(1), crystalMat);
    m.scale.set(r, h, r);
    m.position.set(sx, 1.2 + h * 0.78, sz);
    m.rotation.set(tilt, ry, tilt * 0.7);
    m.castShadow = true;
    grp.add(m);
  };
  spire(0, 0, 5.6, 1.25, 0.04, 0.5);
  spire(-1.7, 0.6, 2.6, 0.62, -0.28, 1.2);
  spire(1.6, -0.8, 3.1, 0.7, 0.24, 2.4);
  spire(1.1, 1.4, 2.1, 0.5, 0.3, 0.2);
  spire(-1.0, -1.5, 1.8, 0.45, -0.22, 1.8);
  const glow = new THREE.PointLight(0x6fb4ff, 2.2, 30, 1.8);
  glow.position.y = 4;
  grp.add(glow);
  placeOnGround(grp, 3, -5);
  scene.add(grp);
  addCollider(3, -5, 2.3);   // the spire cluster — the dais steps stay walkable
  // the small floating crystal in front is the interact/respawn point
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), crystalMat.clone());
  crystal.castShadow = true;
  crystal.position.set(3, terrainHeight(3, -3) + 2.05, -2.2);
  scene.add(crystal);
  S.crystal = crystal;
}

// ---------- beach: reflective ocean + palms ----------
let ocean;
function buildBeach(scene) {
  ocean = new Water(new THREE.PlaneGeometry(900, 380), {
    textureWidth: 1024,
    textureHeight: 1024,
    waterNormals: TEX.waterNormals(),
    sunDirection: new THREE.Vector3(0.3, 0.8, 0.2),
    sunColor: 0xffffff,
    waterColor: 0x1d4e73,
    distortionScale: 2.6,
    fog: true,
  });
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(-100, -1.15, 270);
  scene.add(ocean);

  // breaking-surf shimmer along the shore
  const surf = new THREE.Mesh(
    new THREE.PlaneGeometry(130, 7),
    new THREE.MeshBasicMaterial({ color: 0xeaf4f8, transparent: true, opacity: 0.15, depthWrite: false }),
  );
  surf.rotation.x = -Math.PI / 2;
  surf.position.set(-32, -1.0, 82);
  scene.add(surf);
  S.surf = surf;

  // palms: real bark trunks + painterly frond cards
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 26; tries++) {
    const x = rand(-88, 14), z = rand(60, 84);
    const h = terrainHeight(x, z);
    if (h < -0.9 || h > 1.6 || coastFactor(x, z) < 0.05) continue;
    const palm = new THREE.Group();
    const s = rand(0.85, 1.3);
    const lean = rand(0.12, 0.3);
    let py = 0, pz = 0, ang = 0;
    for (let i = 0; i < 4; i++) {
      const seg = mesh(uvCyl((0.13 - i * 0.02) * s, (0.16 - i * 0.02) * s, 1.15 * s, 7, 0.9), M.bark);
      ang += lean * 0.5;
      seg.rotation.x = ang;
      seg.position.set(0, py + Math.cos(ang) * 0.55 * s, pz + Math.sin(ang) * 0.55 * s);
      py += Math.cos(ang) * 1.05 * s; pz += Math.sin(ang) * 1.05 * s;
      palm.add(seg);
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const frond = leafCard(M.frond, 2.6 * s, 1.1 * s);
      frond.position.set(0, py + 0.15 * s, pz);
      frond.rotation.y = a;
      frond.rotation.x = Math.PI / 2 - rand(0.45, 0.7);
      palm.add(frond);
    }
    palm.position.set(x, h, z);
    palm.rotation.y = rand(0, Math.PI * 2);
    scene.add(palm);
    addCollider(x, z, 0.4 * s);
    placed++;
  }
}

// ---------- sky: billboard clouds, stars, sun & moon ----------
let clouds = [], stars, sunSprite, moonSprite;
function buildSky(scene) {
  const cloudTex = TEX.cloudSprite();
  for (let i = 0; i < 14; i++) {
    const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.75, fog: false, depthWrite: false });
    const c = new THREE.Sprite(mat);
    const s = rand(46, 100);
    c.scale.set(s, s * 0.42, 1);
    c.position.set(rand(-260, 260), rand(58, 100), rand(-260, 260));
    scene.add(c);
    clouds.push({ obj: c, mats: [mat], drift: rand(0.6, 1.6) });
  }
  const starGeo = new THREE.BufferGeometry();
  const sv = [];
  for (let i = 0; i < 420; i++) {
    const a = rand(0, Math.PI * 2), e = rand(0.06, 1.4);
    const r = 380;
    sv.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
  stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xeef2ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  scene.add(stars);
  sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glowSprite('rgba(255,238,190,1)', 'rgba(255,238,190,0)'), transparent: true, fog: false, depthWrite: false }));
  sunSprite.scale.set(90, 90, 1);
  scene.add(sunSprite);
  moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glowSprite('rgba(214,228,255,1)', 'rgba(214,228,255,0)'), transparent: true, fog: false, depthWrite: false }));
  moonSprite.scale.set(40, 40, 1);
  scene.add(moonSprite);
}

// ---------- boundary ridges: hazy distant hills enclosing the zone ----------
function buildRidges(scene) {
  const ridge = (radius, maxH, c0, c1, seed) => {
    const segs = 160, pos = [], cols = [], idx = [];
    const A = new THREE.Color(c0), B = new THREE.Color(c1);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      let gap = Math.abs(a - 1.99); if (gap > Math.PI) gap = Math.PI * 2 - gap;
      const mask = THREE.MathUtils.smoothstep(gap, 0.55, 1.05);
      const r = radius + (noise2(Math.cos(a) * 4 + seed, Math.sin(a) * 4) - 0.5) * 26;
      const h = mask * maxH * (0.35 + 0.65 * noise2(Math.cos(a) * 2.3 + seed + 7, Math.sin(a) * 2.3 + seed));
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      pos.push(x, -8, z, x, Math.max(h, 0.4), z);
      const t = clamp(h / maxH, 0, 1);
      const cTop = A.clone().lerp(B, t);
      cols.push(A.r, A.g, A.b, cTop.r, cTop.g, cTop.b);
      if (i < segs) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })));
  };
  ridge(122, 30, 0x5d6e76, 0x7d8e96, 3);
  ridge(150, 48, 0x6c7d88, 0x97a8b1, 11);
}

// ---------- day / night ----------
const SKY_DAY = new THREE.Color(0xcfe2ef), SKY_NIGHT = new THREE.Color(0x0c1228);
const SKY_DAWN = new THREE.Color(0xe8b48a);
export function updateDayCycle(dt) {
  if (!sun) return;                  // world not built yet (still on loading screen)
  S.time += dt / 25;                 // 1 in-game hour ≈ 25s → full day 10 min
  if (S.time >= 24) { S.time -= 24; S.day++; }
  const t = S.time;
  const dayF = clamp((Math.sin((t - 6) / 24 * Math.PI * 2) + 0.25) / 1.25, 0, 1);
  const dawnF = Math.max(0, 1 - Math.abs(t - 6.5) / 1.6) + Math.max(0, 1 - Math.abs(t - 18.5) / 1.6);

  const ang = ((t - 6) / 24) * Math.PI * 2;
  sun.position.set(Math.cos(ang) * 120, Math.sin(ang) * 120, 40);
  sun.intensity = lerp(0.0, 1.9, dayF);
  sun.color.setHex(0xfff2d8).lerp(new THREE.Color(0xff9a5c), clamp(dawnF, 0, 1) * 0.7);
  hemi.intensity = lerp(0.18, 1.15, dayF);
  ambient.intensity = lerp(0.07, 0.24, dayF);

  const fogC = SKY_NIGHT.clone().lerp(SKY_DAY, dayF).lerp(SKY_DAWN, clamp(dawnF, 0, 1) * 0.45);
  S.scene.fog.color.copy(fogC);

  for (const { light, head } of lampLights) {
    light.intensity = lerp(1.6, 0, dayF);
    if (head) head.material.emissiveIntensity = lerp(1.2, 0.15, dayF);
  }
  for (const wm of windowMats) wm.emissiveIntensity = lerp(0.9, 0.05, dayF);

  if (stars) stars.material.opacity = clamp(1 - dayF * 1.6, 0, 1);
  if (fireflies) {
    fireflies.material.opacity = clamp(1 - dayF * 2.2, 0, 0.9);
    if (fireflies.material.opacity > 0) {
      const fp = fireflies.geometry.attributes.position;
      const tt = performance.now() / 1000;
      for (let i = 0; i < fp.count; i++) {
        fp.setX(i, fp.getX(i) + Math.sin(tt * 0.8 + i) * 0.004);
        fp.setY(i, fp.getY(i) + Math.cos(tt * 1.1 + i * 2.3) * 0.003);
      }
      fp.needsUpdate = true;
    }
  }
  if (sunSprite) {
    sunSprite.position.copy(sun.position).multiplyScalar(2.6);
    sunSprite.material.opacity = clamp(dayF * 1.4, 0, 1);
  }
  if (moonSprite) {
    moonSprite.position.copy(sun.position).multiplyScalar(-2.6);
    moonSprite.position.x += 60;
    moonSprite.material.opacity = clamp(1 - dayF * 1.8, 0, 0.9);
  }
  for (const c of clouds) {
    c.obj.position.x += c.drift * dt;
    if (c.obj.position.x > 280) c.obj.position.x = -280;
    for (const m of c.mats) m.opacity = lerp(0.14, 0.8, dayF);
  }

  if (ocean) {
    ocean.material.uniforms.time.value += dt * 0.5;
    ocean.material.uniforms.sunDirection.value.copy(sun.position).normalize();
    ocean.material.uniforms.sunColor.value.copy(sun.color).multiplyScalar(clamp(dayF, 0.05, 1));
    if (S.surf) S.surf.material.opacity = (0.08 + (Math.sin(performance.now() / 1300) + 1) * 0.07) * (0.3 + dayF * 0.7);
  }
  if (S.crystal) {
    S.crystal.rotation.y += dt * 0.6;
    S.crystal.position.y = terrainHeight(3, -3) + 2.05 + Math.sin(performance.now() / 700) * 0.12;
  }
}
