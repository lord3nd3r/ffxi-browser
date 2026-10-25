// World: painted tile textures on a coarse heightfield, matte Lambert materials,
// card foliage, and low-poly rocks. The expensive photo PBR set, reflective
// water shader, and scanned boulders were the frame-time cost.
import * as THREE from 'three';
import { S, clamp, lerp, rand } from './state.js';
import * as TEX from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attachWind, updateBlobs, windUniform } from './look.js';
import { quality } from './quality.js';

export function preloadWorldModels(onProgress) {
  if (onProgress) onProgress(1, 1);
  return Promise.resolve();
}

export function env(name, scale = 1) {
  if (name.startsWith('stump')) return makeStump(scale * 0.22);
  return makePaintedRock(scale);
}

function makePaintedRock(scale) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  geo.userData.owned = true;
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const n = 0.82 + hash(i * 3 + 1, i * 5 + 2) * 0.18;
    cols[i * 3] = n;
    cols[i * 3 + 1] = n * 0.97;
    cols[i * 3 + 2] = n * 0.9;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.Mesh(geo, M.rock);
  m.castShadow = m.receiveShadow = quality().shadows;
  m.scale.set(scale * rand(1.05, 1.5), scale * rand(0.5, 0.8), scale * rand(0.95, 1.4));
  m.rotation.set(rand(-0.15, 0.15), rand(0, 6), rand(-0.15, 0.15));
  return m;
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
  // Inner Horutoto is a flat crypt far from the field map.
  if (x > 450 && z > 470) return 0;
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
export function clearColliders() { circles.length = 0; boxes.length = 0; }

// Zone scenery is parented here so a zone line can drop the whole set.
let zoneParent = null;
function Z() { return zoneParent || S.scene; }
function own(geo) { geo.userData.owned = true; return geo; }
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
  geo.userData.owned = true;
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  const sh = quality().shadows;
  m.castShadow = m.receiveShadow = sh;
  return m;
}

function initMaterials() {
  // Matte Lambert. The painted maps are the color; a multiply tint would hide them.
  const lambert = (o) => new THREE.MeshLambertMaterial({ color: 0xffffff, ...o });
  M = {
    plaster: lambert({ map: TEX.pbr('plaster') }),
    planks:  lambert({ map: TEX.pbr('planks') }),
    roof:    lambert({ map: TEX.pbr('roof') }),
    bricks:  lambert({ map: TEX.pbr('bricks') }),
    paving:  lambert({ map: TEX.pbr('paving') }),
    bark:    lambert({ map: TEX.pbr('bark') }),
    rock:    lambert({ map: TEX.pbr('rock'), vertexColors: true }),
    water:   lambert({ map: TEX.pbr('water', 12, 6) }),
  };
  const card = (tex) => {
    const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.35, side: THREE.DoubleSide });
    attachWind(m);
    return m;
  };
  M.leaf = card(TEX.foliageSprite());
  M.pine = card(TEX.pineSprite());
  M.frond = card(TEX.frondSprite());
}

function leafCard(mat, w, h) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.castShadow = false;
  m.receiveShadow = quality().shadows;
  return m;
}

function lampLight(parent, y, color, intensity, dist) {
  if (!quality().pointLights) return null;
  const light = new THREE.PointLight(color, intensity, dist, 2);
  light.position.y = y;
  parent.add(light);
  return light;
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
  for (let i = 0; i < 4; i++) {
    const c = leafCard(M.leaf, rand(2.2, 3.1) * s, rand(1.9, 2.7) * s);
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
    for (const ry of [0, Math.PI / 2]) {
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

  scene.fog = new THREE.Fog(0xc5daf0, 72, 210);

  // ---------- lights: warm key, cool sky, ochre ground (painted, not HDR) ----------
  hemi = new THREE.HemisphereLight(0x8ec4f8, 0xc4884a, 0.55);
  scene.add(hemi);
  ambient = new THREE.AmbientLight(0xfff3e2, 0.26);
  scene.add(ambient);
  sun = new THREE.DirectionalLight(0xffe0a8, 1.35);
  const q = quality();
  sun.castShadow = q.shadows;
  sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
  sun.shadow.camera.left = -26; sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 2; sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.002;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // ---------- sky dome: gradient driven by the day cycle ----------
  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x2a74d8) },
      horizon: { value: new THREE.Color(0xf4d2a4) },
      sunset: { value: new THREE.Color(0xf0a06a) },
      sunsetAmt: { value: 0 },
      sunDir: { value: new THREE.Vector3(0.2, 0.8, 0.3) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
      fragmentShader: `
      uniform vec3 zenith, horizon, sunset, sunDir;
      uniform float sunsetAmt;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y, 0.0, 1.0);
        float elev = smoothstep(0.0, 0.62, h);
        vec3 col = mix(horizon, zenith, elev);
        float band = pow(1.0 - smoothstep(0.0, 0.28, h), 1.35);
        col = mix(col, sunset, band * (0.42 + sunsetAmt * 0.35));
        float sunD = max(dot(dir, normalize(sunDir)), 0.0);
        col += sunset * pow(sunD, 7.0) * 0.42;
        col += vec3(1.0, 0.93, 0.78) * pow(sunD, 64.0) * 0.85;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(420, 28, 16), skyMat));

  buildSky(scene);
  buildRidges(scene);
  buildDust(scene);
  mountZoneScenery('sanria');
}

function buildField() {
  // ---------- terrain: 4-way PBR texture splat (grass / dirt / sand / stone) ----------
  const size = S.worldSize, segs = quality().terrainSegs;
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
    let r = 0.97 + (noise2(x * 0.09 + 50, z * 0.09) - 0.5) * 0.06;
    let cr = r, cg = r, cb = r;
    const dF = Math.hypot(x - 55, z - 48);                       // NE woods: somber gray-brown floor (ss-1)
    if (dF < 34) {
      const f = 1 - THREE.MathUtils.smoothstep(dF, 18, 34);
      cr *= 1 - 0.16 * f; cg *= 1 - 0.14 * f; cb *= 1 - 0.12 * f;
    }
    colors.push(cr, cg, cb);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('splat', new THREE.Float32BufferAttribute(splat, 4));
  geo.computeVertexNormals();

  const tGrass = TEX.pbr('grass'), tDirt = TEX.pbr('dirt'), tSand = TEX.pbr('sand'), tStone = TEX.pbr('paving');
  const tMat = new THREE.MeshLambertMaterial({ vertexColors: true });
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
  vec2 uv = vXZ * 0.09;
  vec3 ter = texture2D(tGrass, uv).rgb * w.x
           + texture2D(tDirt, uv).rgb * w.y
           + texture2D(tSand, uv).rgb * w.z
           + texture2D(tStone, uv).rgb * w.w;
  diffuseColor.rgb *= ter;
}`);
  };
  geo.userData.owned = true;
  const terrain = new THREE.Mesh(geo, tMat);
  terrain.receiveShadow = quality().shadows;
  terrain.castShadow = false;
  terrain.name = 'terrain';
  Z().add(terrain);
  S.terrain = terrain;

  // ---------- pond ----------
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(11, 28),
    new THREE.MeshLambertMaterial({ map: TEX.pbr('water', 3, 3), color: 0xffffff, transparent: true, opacity: 0.92 }),
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(44, -0.55, -34);
  Z().add(pond);

  buildVegetation(S.scene);
  buildRuins(S.scene);
  buildBeach(S.scene);
  buildFieldGate();
  // keep hunters out of the unloaded city interior
  addBox(0, 4.5, 46, 48, 0);
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
  const qv = quality();
  let placed = 0;
  const treeCap = qv.trees;
  const forestCap = Math.round(treeCap * 0.55);
  for (let i = 0; i < 900 && placed < treeCap; i++) {
    let x, z;
    const inForest = placed < forestCap;
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

  for (let i = 0; i < qv.rocks; i++) {
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
  const tuftMat = new THREE.MeshLambertMaterial({ map: bladeTex, alphaTest: 0.4, side: THREE.DoubleSide, color: 0xffffff });
  attachWind(tuftMat);
  const tuftCap = qv.tufts;
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, tuftCap);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), s4 = new THREE.Vector3();
  let ti = 0;
  for (let i = 0; i < tuftCap * 4 && ti < tuftCap; i++) {
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
  tuftGeo.userData.owned = true;
  Z().add(tufts);

  // forest ferns: bigger, darker tuft cards under the canopy
  const fernMat = new THREE.MeshLambertMaterial({ map: bladeTex, alphaTest: 0.4, side: THREE.DoubleSide, color: 0x8aaa55 });
  attachWind(fernMat);
  const fernCap = qv.ferns;
  const ferns = new THREE.InstancedMesh(tuftGeo, fernMat, Math.max(1, fernCap));
  let fi = 0;
  for (let i = 0; i < fernCap * 5 && fi < fernCap; i++) {
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
  Z().add(ferns);

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
  Z().add(group);

  // fireflies: drift over the meadows after dark
  const fGeo = new THREE.BufferGeometry();
  const fPos = [];
  for (let i = 0; i < 90; i++) {
    const x = rand(-60, 70), z = rand(-60, 60);
    fPos.push(x, terrainHeight(x, z) + rand(0.5, 2.2), z);
  }
  fGeo.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
  fGeo.userData.owned = true;
  fireflies = new THREE.Points(fGeo, new THREE.PointsMaterial({ color: 0xd6f08a, size: 0.16, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  Z().add(fireflies);
}
let fireflies = null;

// ---------- town: plaster & timber cottages with tiled roofs ----------
const windowMats = []; // cleared on zone unload via .length
function buildCity(scene) {
  const g = new THREE.Group();

  // cobbled plaza — the clickable city floor. Slightly under the building bases.
  {
    const geo = own(new THREE.PlaneGeometry(50, 50, 18, 18));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const cols = [];
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)) - 0.02);
      const n = 0.97 + (noise2(pos.getX(i) * 0.35, pos.getZ(i) * 0.35) - 0.5) * 0.06;
      cols.push(n * 1.02, n * 0.99, n * 0.95);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const plaza = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      map: TEX.pbr('paving', 12, 12),
      vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    plaza.receiveShadow = true;
    plaza.name = 'terrain';
    g.add(plaza);
    S.terrain = plaza;
  }

  // corner houses — pitched roofs, timber, lit windows. Kept off the NPC spots.
  const winMat = new THREE.MeshLambertMaterial({ color: 0xffe2a8, emissive: 0xffaa44, emissiveIntensity: 0.4 });
  windowMats.push(winMat);
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  function part(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    const mx = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(mx);
    return { geo, mat };
  }
  function bake(parent, parts) {
    const buckets = new Map();
    for (const p of parts) {
      let list = buckets.get(p.mat);
      if (!list) buckets.set(p.mat, list = []);
      list.push(p.geo);
    }
    const sh = quality().shadows;
    for (const [mat, geos] of buckets) {
      let merged = null;
      try { merged = mergeGeometries(geos, false); } catch (e) { merged = null; }
      if (!merged) {
        for (const geo of geos) parent.add(mesh(geo, mat));
        continue;
      }
      for (const geo of geos) geo.dispose();
      merged.userData.owned = true;
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = m.receiveShadow = sh;
      parent.add(m);
    }
  }
  function house(x, z, rot, w = 4.4, d = 3.6, wallH = 2.75, roofHex = 0xffffff) {
    const roof = M.roof.clone();
    roof.color.setHex(roofHex);
    const parts = [];
    const P = (geo, mat, x, y, z, rx, ry, rz) => parts.push(part(geo, mat, x, y, z, rx, ry, rz));
    const base = 0.28;
    P(uvBox(w + 0.4, base, d + 0.34, 1.2), M.bricks, 0, base / 2, 0);
    P(uvBox(1.15, 0.1, 0.42, 0.8), M.paving, 0, 0.06, d / 2 + 0.22);
    P(uvBox(0.9, 0.1, 0.36, 0.8), M.paving, 0, 0.16, d / 2 + 0.48);
    P(uvBox(w, wallH, d, 1.5), M.plaster, 0, base + wallH / 2, 0);
    const jH = wallH * 0.38;
    P(uvBox(w + 0.7, jH, d + 0.55, 1.4), M.plaster, 0, base + wallH - jH / 2, 0.06);
    for (const px of [-w / 2, -w / 6, w / 6, w / 2]) {
      P(uvBox(0.12, wallH + 0.15, 0.14, 0.6), M.planks, px, base + wallH / 2, d / 2 + 0.02);
    }
    P(uvBox(w + 0.08, 0.1, 0.12, 0.5), M.planks, 0, base + wallH * 0.46, d / 2 + 0.04);
    P(uvBox(w + 0.55, 0.12, 0.16, 0.5), M.planks, 0, base + wallH - jH, d / 2 + 0.22);
    P(uvBox(0.72, 1.35, 0.08, 0.45), M.planks, 0, base + 0.7, d / 2 + 0.05);
    P(new THREE.TorusGeometry(0.4, 0.07, 5, 8, Math.PI), M.bricks, 0, base + 1.38, d / 2 + 0.08);
    P(uvBox(0.58, 0.66, 0.06, 0.4), winMat, w * 0.26, base + wallH * 0.62, d / 2 + 0.1);
    P(uvBox(0.08, 0.74, 0.08, 0.3), M.planks, w * 0.26 - 0.36, base + wallH * 0.62, d / 2 + 0.12);
    P(uvBox(0.08, 0.74, 0.08, 0.3), M.planks, w * 0.26 + 0.36, base + wallH * 0.62, d / 2 + 0.12);
    P(uvBox(w + 1.15, 0.12, d * 0.78, 0.85), roof, 0, base + wallH + 0.62, d * 0.2, 0.52);
    P(uvBox(w + 1.15, 0.12, d * 0.78, 0.85), roof, 0, base + wallH + 0.62, -d * 0.2, -0.52);
    P(uvBox(w + 0.3, 0.14, 0.2, 0.4), M.planks, 0, base + wallH + 1.05, 0);
    P(uvBox(0.1, 0.14, d + 0.2, 0.4), M.planks, -w / 2 - 0.28, base + wallH + 0.45, 0);
    P(uvBox(0.1, 0.14, d + 0.2, 0.4), M.planks, w / 2 + 0.28, base + wallH + 0.45, 0);
    P(uvBox(0.36, 1.15, 0.36, 0.45), M.bricks, w * 0.3, base + wallH + 0.85, -d * 0.12);
    P(uvCyl(0.14, 0.18, 0.22, 6, 0.35), M.bricks, w * 0.3, base + wallH + 1.5, -d * 0.12);
    const h = new THREE.Group();
    bake(h, parts);
    placeOnGround(h, x, z);
    h.rotation.y = rot;
    g.add(h);
    addCollider(x, z, Math.max(w, d) * 0.46);
  }
  house(-15, 12, 0.15, 4.4, 3.6, 2.75, 0xffe0c2);
  house(15, 13, -0.2, 4.6, 3.6, 2.7, 0xf3c9a4);
  house(-15, -4, 1.1, 3.8, 3.2, 2.4, 0xfff0dc);
  house(15, -13, 0.4, 4.4, 3.4, 2.6, 0xe8b48a);
  house(-8, 16, 0.05, 3.6, 3.2, 2.3, 0xf7d7b0);

  // cathedral behind Father Odo: nave, aisles, steps, arch, crenellated towers
  {
    const parts = [];
    const P = (geo, mat, x, y, z, rx, ry, rz) => parts.push(part(geo, mat, x, y, z, rx, ry, rz));
    P(uvBox(7.6, 0.16, 1.15, 1.2), M.paving, 0, 0.08, 2.7);
    P(uvBox(6.8, 0.16, 0.95, 1.2), M.paving, 0, 0.24, 2.25);
    P(uvBox(6.2, 3.7, 4.5, 1.6), M.plaster, 0, 2.1, -0.15);
    P(uvBox(1.35, 2.35, 3.7, 1.4), M.plaster, -3.6, 1.4, -0.1);
    P(uvBox(1.35, 2.35, 3.7, 1.4), M.plaster, 3.6, 1.4, -0.1);
    P(uvBox(6.55, 0.12, 4.75, 0.8), M.paving, 0, 2.45, -0.15);
    P(uvBox(6.4, 0.1, 0.18, 0.5), M.paving, 0, 3.55, 2.12);
    for (const bx of [-2.35, -0.8, 0.75, 2.3]) {
      P(uvBox(0.32, 2.3, 0.48, 0.6), M.bricks, bx, 1.25, 2.2);
    }
    P(uvBox(1.05, 1.85, 0.1, 0.45), M.planks, 0, 1.15, 2.16);
    P(new THREE.TorusGeometry(0.62, 0.09, 5, 10, Math.PI), M.bricks, 0, 2.02, 2.22);
    P(new THREE.CircleGeometry(0.42, 10), winMat, 0, 2.95, 2.28);
    for (const wx of [-1.55, 1.55]) P(uvBox(0.26, 0.72, 0.06, 0.3), winMat, wx, 3.2, 2.24);
    P(uvBox(7.8, 0.14, 3.0, 1.1), M.roof, 0, 4.25, 0.85, 0.48);
    P(uvBox(7.8, 0.14, 3.0, 1.1), M.roof, 0, 4.25, -1.2, -0.48);
    P(uvBox(1.8, 0.1, 3.9, 0.8), M.roof, -3.6, 2.7, -0.1, 0, 0, 0.4);
    P(uvBox(1.8, 0.1, 3.9, 0.8), M.roof, 3.6, 2.7, -0.1, 0, 0, -0.4);
    P(uvBox(0.16, 0.14, 4.4, 0.3), M.planks, 0, 4.95, -0.15);
    for (const tx of [-2.75, 2.75]) {
      P(uvCyl(0.55, 0.78, 5.8, 8, 1.2), M.bricks, tx, 3.0, 1.45);
      P(uvCyl(0.85, 0.85, 0.16, 8, 0.6), M.paving, tx, 5.85, 1.45);
      for (const [mx, mz] of [[0.42, 0], [-0.42, 0], [0, 0.42], [0, -0.42]]) {
        P(uvBox(0.26, 0.42, 0.26, 0.3), M.bricks, tx + mx, 6.12, 1.45 + mz);
      }
      P(new THREE.ConeGeometry(0.7, 1.7, 8), M.roof, tx, 7.15, 1.45);
      P(new THREE.ConeGeometry(0.1, 0.42, 5), M.roof, tx, 8.15, 1.45);
    }
    const cat = new THREE.Group();
    bake(cat, parts);
    placeOnGround(cat, -3, -16.2);
    g.add(cat);
    addCollider(-3, -16.2, 2.5);
  }

  // market fountain
  {
    const f = new THREE.Group();
    f.add(mesh(uvCyl(1.5, 1.7, 0.45, 12, 1.2), M.paving, 0, 0.22, 0));
    f.add(mesh(uvCyl(1.15, 1.15, 0.35, 12, 1), M.bricks, 0, 0.55, 0));
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.05, 16), new THREE.MeshLambertMaterial({ map: TEX.pbr('water', 1, 1), transparent: true, opacity: 0.92 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.74;
    f.add(water);
    f.add(mesh(uvCyl(0.18, 0.22, 0.9, 8, 0.6), M.paving, 0, 1.15, 0));
    const rim = mesh(new THREE.TorusGeometry(1.12, 0.07, 6, 18), M.paving, 0, 0.78, 0);
    rim.rotation.x = Math.PI / 2;
    f.add(rim);
    const spout = mesh(new THREE.ConeGeometry(0.12, 0.45, 6), M.bricks, 0, 1.7, 0);
    f.add(spout);
    placeOnGround(f, 0, 9);
    g.add(f);
    addCollider(0, 9, 1.5);
  }

  // ---------- FFXI-style outpost: market stalls, tents, banners ----------
  const awningRed = new THREE.MeshLambertMaterial({ map: TEX.awningStripes(), side: THREE.DoubleSide });
  const awningBlue = new THREE.MeshLambertMaterial({ map: TEX.awningStripes('#3a5a8e', '#e8e0d0'), side: THREE.DoubleSide });
  const canvasMat = new THREE.MeshLambertMaterial({ color: 0xd8cdb4, side: THREE.DoubleSide });
  const bannerMat = new THREE.MeshLambertMaterial({ map: TEX.bannerSprite(), side: THREE.DoubleSide });

  function stall(x, z, rot, awn) {
    const parts = [];
    const P = (geo, mat, x, y, z, rx, ry, rz) => parts.push(part(geo, mat, x, y, z, rx, ry, rz));
    for (const [px, pz] of [[-1.45, -0.95], [1.45, -0.95], [-1.45, 0.95], [1.45, 0.95]])
      P(uvCyl(0.05, 0.07, 2.55, 6, 1), M.planks, px, 1.28, pz);
    P(uvBox(3.05, 0.08, 0.08, 0.4), M.planks, 0, 2.52, -0.95);
    P(uvBox(3.05, 0.08, 0.08, 0.4), M.planks, 0, 2.52, 0.95);
    P(uvBox(0.08, 0.08, 2.05, 0.4), M.planks, -1.45, 2.52, 0);
    P(uvBox(0.08, 0.08, 2.05, 0.4), M.planks, 1.45, 2.52, 0);
    P(uvBox(2.7, 0.1, 0.9, 1.1), M.planks, 0, 1.0, 0.32);
    P(uvBox(2.7, 0.62, 0.08, 0.5), M.planks, 0, 0.66, 0.74);
    P(uvBox(0.52, 0.38, 0.42, 0.45), M.planks, -0.72, 1.24, 0.28);
    P(uvBox(0.38, 0.26, 0.36, 0.4), M.planks, -0.18, 1.18, 0.38);
    P(uvBox(0.62, 0.3, 0.38, 0.45), M.bricks, 0.62, 1.2, 0.26);
    P(new THREE.PlaneGeometry(2.55, 0.72), awn, 0, 2.12, 1.02);
    P(new THREE.PlaneGeometry(3.35, 2.35), awn, 0, 2.64, 0, -Math.PI / 2 + 0.16);
    P(uvBox(0.05, 0.32, 0.05, 0.2), M.planks, 0, 2.28, 1.2);
    P(new THREE.PlaneGeometry(0.72, 0.4), bannerMat, 0, 1.92, 1.24);
    const s = new THREE.Group();
    bake(s, parts);
    placeOnGround(s, x, z);
    s.rotation.y = rot;
    g.add(s);
    addCollider(x, z, 1.6);
  }
  function tent(x, z, rot, sc = 1) {
    const parts = [];
    const P = (geo, mat, x, y, z, rx, ry, rz) => parts.push(part(geo, mat, x, y, z, rx, ry, rz));
    P(uvCyl(0.045, 0.05, 3.1 * sc, 5, 1), M.planks, 0, 1.55 * sc, 0);
    for (const sgn of [1, -1]) {
      P(new THREE.PlaneGeometry(3.15 * sc, 2.15 * sc), canvasMat, 0, 1.02 * sc, sgn * 0.62 * sc, sgn * -0.95);
    }
    P(new THREE.PlaneGeometry(1.35 * sc, 1.45 * sc), canvasMat, 0.15 * sc, 0.72 * sc, 1.25 * sc, 0, 0.4);
    P(new THREE.PlaneGeometry(2.2 * sc, 1.5 * sc), canvasMat, 0, 0.03, 0, -Math.PI / 2);
    P(uvBox(0.03, 1.25 * sc, 0.03, 0.2), M.planks, 1.35 * sc, 0.62 * sc, 1.05 * sc);
    P(uvBox(0.03, 1.25 * sc, 0.03, 0.2), M.planks, -1.35 * sc, 0.62 * sc, 1.05 * sc);
    const t = new THREE.Group();
    bake(t, parts);
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

  stall(-14, 10, 0.5, awningRed);     // beside Mirelle
  stall(14, 8, -0.7, awningBlue);     // beside Pikko-Wikko
  stall(16, -3, -1.5, awningRed);     // beside Galdric
  tent(-7, 14, 0.5); tent(-13, -4, 1.8); tent(5, 17, -0.4, 1.2);
  banner(-7, 21); banner(7, 21); banner(-3, 8); banner(9, -2);

  // Father Odo's wayside shrine: stone dais, twin pillars, votive crystal
  const shrine = new THREE.Group();
  shrine.add(mesh(uvCyl(1.8, 2.1, 0.5, 12, 1.8), M.paving, 0, 0.25, 0));
  for (const px of [-1.1, 1.1]) shrine.add(mesh(uvCyl(0.22, 0.26, 2.6, 8, 1.6), M.bricks, px, 1.8, 0));
  shrine.add(mesh(uvBox(3.0, 0.35, 0.7, 1.6), M.paving, 0, 3.25, 0));
  const votiveMat = new THREE.MeshLambertMaterial({ color: 0xc5e4ff, emissive: 0x3d8cff, emissiveIntensity: 0.9, transparent: true, opacity: 0.86 });
  const votive = makeCrystalShard(votiveMat, 0.85, 0.16);
  votive.position.y = 1.55;
  shrine.add(votive);
  const votiveGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: TEX.glowSprite('rgba(150,200,255,1)', 'rgba(90,150,255,0)'),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  votiveGlow.scale.set(1.4, 1.8, 1);
  votiveGlow.position.y = 2.05;
  shrine.add(votiveGlow);
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
  const fl = lampLight(fire, 0.7, 0xff9d4d, 0, 10);
  if (fl) lampLights.push({ light: fl, head: null });
  placeOnGround(fire, -9, 12);
  g.add(fire);
  addCollider(-9, 12, 0.8);

  // stone wall + north gatehouse (San d'Oria-style masonry)
  function wallSeg(x, z, len, rot) {
    const parts = [];
    const P = (geo, mat, x, y, z, rx, ry, rz) => parts.push(part(geo, mat, x, y, z, rx, ry, rz));
    P(uvBox(len, 0.28, 1.55, 1.1), M.paving, 0, 0.14, 0);
    P(uvBox(len, 3.15, 1.05, 2.2), M.bricks, 0, 1.75, 0);
    P(uvBox(len, 0.14, 1.28, 1), M.paving, 0, 2.15, 0);
    P(uvBox(len, 0.22, 1.4, 1), M.paving, 0, 3.35, 0);
    const merlons = Math.max(2, Math.floor(len / 1.25));
    for (let i = 0; i < merlons; i++) {
      const mx = -len / 2 + 0.62 + i * (len / merlons);
      P(uvBox(0.48, 0.78, 0.95, 0.7), M.bricks, mx, 3.82, 0);
      P(uvBox(0.62, 0.1, 1.08, 0.4), M.paving, mx, 4.24, 0);
    }
    const nB = Math.max(1, Math.floor(len / 6));
    for (let i = 0; i < nB; i++) {
      const bx = -len / 2 + (i + 0.5) * (len / nB);
      P(uvBox(0.42, 1.7, 0.38, 0.7), M.bricks, bx, 1.0, -0.62);
    }
    const w = new THREE.Group();
    bake(w, parts);
    placeOnGround(w, x, z);
    w.rotation.y = rot;
    g.add(w);
    if (rot === 0) addBox(x, z, len, 1.5); else addBox(x, z, 1.5, len);
  }
  wallSeg(-12.4, 24, 16.5, 0);
  wallSeg(12.4, 24, 16.5, 0);
  wallSeg(-20.5, 4, 40, Math.PI / 2);
  wallSeg(20.5, 4, 40, Math.PI / 2);
  wallSeg(0, -18.4, 40, 0);
  for (const tx of [-4.6, 4.6]) {
    const tw = new THREE.Group();
    tw.add(mesh(uvCyl(1.85, 2.05, 0.45, 12, 1.4), M.paving, 0, 0.22, 0));
    tw.add(mesh(uvCyl(1.35, 1.7, 5.4, 12, 1.6), M.bricks, 0, 2.9, 0));
    tw.add(mesh(uvCyl(1.85, 1.85, 0.28, 12, 1.2), M.paving, 0, 4.55, 0));
    tw.add(mesh(uvCyl(1.55, 1.7, 0.7, 12, 1.2), M.bricks, 0, 5.0, 0));
    const hoard = mesh(uvCyl(2.05, 2.05, 0.16, 12, 1), M.planks, 0, 5.4, 0);
    tw.add(hoard);
    tw.add(mesh(new THREE.ConeGeometry(1.7, 2.3, 12), M.roof, 0, 6.7, 0));
    tw.add(mesh(new THREE.ConeGeometry(0.28, 0.7, 6), M.roof, 0, 8.15, 0));
    for (const ay of [1.6, 3.1]) {
      tw.add(mesh(uvBox(0.12, 0.55, 0.08, 0.3), M.planks, 1.15, ay, 0));
      tw.add(mesh(uvBox(0.12, 0.55, 0.08, 0.3), M.planks, -1.15, ay, 0));
    }
    placeOnGround(tw, tx, 24);
    g.add(tw);
    addCollider(tx, 24, 1.9);
  }
  const arch = new THREE.Group();
  arch.add(mesh(uvBox(9.6, 0.85, 1.55, 1.6), M.bricks, 0, 5.15, 0));
  arch.add(mesh(uvBox(9.8, 0.18, 1.85, 0.8), M.paving, 0, 5.6, 0));
  const gateArch = mesh(new THREE.TorusGeometry(2.05, 0.2, 6, 16, Math.PI), M.bricks, 0, 3.15, 0);
  arch.add(gateArch);
  for (const bx of [-1.35, 1.35]) {
    arch.add(mesh(uvBox(0.08, 0.45, 0.08, 0.2), M.planks, bx, 4.55, 0.7));
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 1.35), bannerMat);
    ban.position.set(bx, 3.65, 0.78);
    arch.add(ban);
  }
  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 3.3),
    new THREE.MeshBasicMaterial({ color: 0xb9dcff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  );
  veil.position.set(0, 2.05, 0);
  arch.add(veil);
  placeOnGround(arch, 0, 25.2);
  g.add(arch);

  // lamp posts (lit at night)
  for (const [lx, lz] of [[6, 12], [-8, -6], [10, -4], [3, 21]]) {
    const lamp = new THREE.Group();
    lamp.add(mesh(uvCyl(0.07, 0.09, 2.7, 6, 1.0), M.planks, 0, 1.35, 0));
    lamp.add(mesh(uvBox(0.34, 0.06, 0.34, 0.3), M.planks, 0, 2.72, 0));
    for (const [px, pz] of [[0.12, 0.12], [-0.12, 0.12], [0.12, -0.12], [-0.12, -0.12]]) {
      lamp.add(mesh(uvBox(0.04, 0.32, 0.04, 0.2), M.planks, px, 2.92, pz));
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.18), new THREE.MeshLambertMaterial({ color: 0xffe2a0, emissive: 0xff9d2e, emissiveIntensity: 0.85 }));
    head.position.y = 2.9;
    lamp.add(head);
    const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glowSprite('rgba(255,200,120,1)', 'rgba(255,150,50,0)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7,
    }));
    lampGlow.scale.set(1.35, 1.35, 1);
    lampGlow.position.y = 2.9;
    lamp.add(lampGlow);
    lamp.add(mesh(uvBox(0.28, 0.06, 0.28, 0.2), M.planks, 0, 3.12, 0));
    const light = lampLight(lamp, 3, 0xffb35c, 0, 14);
    lampLights.push({ light, head });
    placeOnGround(lamp, lx, lz);
    g.add(lamp);
    addCollider(lx, lz, 0.25);
  }

  // market clutter: barrels, slatted crates, a handcart
  function slatCrate(x, z, s, yOff, rot) {
    const c = new THREE.Group();
    c.add(mesh(uvBox(s, s * 0.82, s, 0.55), M.planks, 0, s * 0.41, 0));
    c.add(mesh(uvBox(s + 0.04, 0.06, 0.05, 0.25), M.planks, 0, s * 0.22, s * 0.5));
    c.add(mesh(uvBox(s + 0.04, 0.06, 0.05, 0.25), M.planks, 0, s * 0.58, s * 0.5));
    c.add(mesh(uvBox(0.05, 0.06, s + 0.04, 0.25), M.planks, s * 0.5, s * 0.4, 0));
    placeOnGround(c, x, z, yOff);
    c.rotation.y = rot;
    g.add(c);
  }
  for (const [bx, bz] of [[10.5, 2.5], [11.4, 3.3]]) {
    const b = mesh(uvCyl(0.38, 0.42, 0.85, 10, 0.8), M.planks);
    placeOnGround(b, bx, bz, 0.42);
    b.add(mesh(uvCyl(0.44, 0.44, 0.06, 10, 0.5), M.planks, 0, 0.28, 0));
    b.add(mesh(uvCyl(0.44, 0.44, 0.06, 10, 0.5), M.planks, 0, -0.28, 0));
    g.add(b);
    addCollider(bx, bz, 0.55);
  }
  slatCrate(13.2, 3.6, 0.85, 0, 0.4);
  slatCrate(13.45, 3.35, 0.55, 0.7, 0.9);
  slatCrate(-12.2, 8.4, 0.7, 0, 0.2);
  addCollider(13.2, 3.6, 0.7);
  addCollider(-12.2, 8.4, 0.5);
  {
    const cart = new THREE.Group();
    cart.add(mesh(uvBox(1.7, 0.1, 0.9, 0.6), M.planks, 0, 0.62, 0));
    cart.add(mesh(uvBox(1.7, 0.28, 0.08, 0.4), M.planks, 0, 0.78, 0.42));
    cart.add(mesh(uvBox(1.7, 0.28, 0.08, 0.4), M.planks, 0, 0.78, -0.42));
    cart.add(mesh(uvBox(0.08, 0.7, 0.08, 0.3), M.planks, -0.7, 0.4, 0));
    for (const wx of [-0.55, 0.55]) {
      const wheel = mesh(uvCyl(0.28, 0.28, 0.08, 10, 0.4), M.planks, wx, 0.28, 0);
      wheel.rotation.z = Math.PI / 2;
      cart.add(wheel);
    }
    cart.add(mesh(uvBox(0.45, 0.32, 0.4, 0.4), M.planks, 0.35, 0.84, 0));
    placeOnGround(cart, 8.4, 5.2);
    cart.rotation.y = 0.6;
    g.add(cart);
    addCollider(8.4, 5.2, 0.95);
  }

  Z().add(g);
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
  const veil = new THREE.Mesh(
    new THREE.CircleGeometry(1.7, 28),
    new THREE.MeshBasicMaterial({ color: 0xc9b6ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
  );
  veil.rotation.x = -Math.PI / 2;
  veil.position.y = 1.15;
  altar.add(veil);
  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshLambertMaterial({ color: 0x9b6cd6, emissive: 0x6a30b0, emissiveIntensity: 0.55 }));
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
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshLambertMaterial({ color: 0xffd27a, emissive: 0xff9d2e, emissiveIntensity: 0.5 }));
    head.position.y = 1.5;
    t.add(head);
    const light = lampLight(t, 1.5, 0xffb35c, 0, 12);
    placeOnGround(t, -70 + dx, -65.5);
    lampLights.push({ light, head });
    g.add(t);
    addCollider(-70 + dx, -65.5, 0.2);
  }
  Z().add(g);
  // altar dais is the zone line into Inner Horutoto — leave the center walkable
}

function makeCrystalShard(mat, h, r) {
  const shard = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r, h * 0.62, 6), mat);
  body.position.y = h * 0.31;
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, r * 0.55, h * 0.42, 6), mat);
  tip.position.y = h * 0.62 + h * 0.19;
  body.geometry.userData.owned = tip.geometry.userData.owned = true;
  shard.add(body, tip);
  return shard;
}

function buildHomePoint(scene) {
  // Mothercrystal: hexagonal quartz cluster, emissive, with a cheap sprite halo
  crystalMat = new THREE.MeshLambertMaterial({
    color: 0xb7dcff, emissive: 0x3a86f0, emissiveIntensity: 0.9,
    transparent: true, opacity: 0.84,
  });
  const coreMat = new THREE.MeshLambertMaterial({
    color: 0xeaf6ff, emissive: 0x8fd0ff, emissiveIntensity: 1.25,
    transparent: true, opacity: 0.9,
  });
  const grp = new THREE.Group();
  grp.add(mesh(uvCyl(4.6, 5.2, 0.45, 8, 1.6), M.paving, 0, 0.22, 0));
  grp.add(mesh(uvCyl(3.3, 3.8, 0.4, 8, 1.4), M.paving, 0, 0.62, 0));
  grp.add(mesh(uvCyl(2.15, 2.45, 0.28, 8, 1.2), M.paving, 0, 0.95, 0));
  const placeShard = (h, r, x, z, rx, ry, rz, mat) => {
    const shard = makeCrystalShard(mat, h, r);
    shard.position.set(x, 1.05, z);
    shard.rotation.set(rx, ry, rz);
    grp.add(shard);
  };
  placeShard(6.6, 0.62, 0, 0, 0.04, 0.5, 0.02, coreMat);
  placeShard(3.5, 0.36, -1.15, 0.4, -0.28, 0.9, 0.1, crystalMat);
  placeShard(4.0, 0.4, 1.05, -0.5, 0.22, 1.8, -0.08, crystalMat);
  placeShard(2.7, 0.28, 0.65, 1.0, 0.32, 0.4, 0.14, crystalMat);
  placeShard(2.3, 0.24, -0.7, -1.05, -0.24, 2.1, -0.12, crystalMat);
  placeShard(1.8, 0.18, 1.25, 0.65, 0.4, 1.2, 0.18, crystalMat);
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(1.7, 20),
    new THREE.MeshBasicMaterial({ color: 0x8ec4ff, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  pool.geometry.userData.owned = true;
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 1.12;
  grp.add(pool);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: TEX.glowSprite('rgba(170,214,255,1)', 'rgba(70,140,255,0)'),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.72,
  }));
  halo.scale.set(8.5, 11, 1);
  halo.position.set(0, 4.1, 0);
  grp.add(halo);
  S.crystalHalo = halo;
  const glow = lampLight(grp, 4, 0x6fb4ff, 0.8, 16);
  if (glow) glow.intensity = 0.8;
  placeOnGround(grp, 3, -5);
  Z().add(grp);
  addCollider(3, -5, 2.3);
  const crystal = makeCrystalShard(coreMat, 1.25, 0.26);
  const floatGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: TEX.glowSprite('rgba(180,220,255,1)', 'rgba(80,150,255,0)'),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8,
  }));
  floatGlow.scale.set(1.8, 2.2, 1);
  floatGlow.position.y = 0.7;
  crystal.add(floatGlow);
  crystal.position.set(3, terrainHeight(3, -3) + 2.05, -2.2);
  Z().add(crystal);
  S.crystal = crystal;
}

// ---------- beach: reflective ocean + palms ----------
let ocean;
function buildBeach(scene) {
  const sea = M.water.clone();
  sea.map = M.water.map.clone();
  sea.map.needsUpdate = true;
  ocean = new THREE.Mesh(own(new THREE.PlaneGeometry(900, 380)), sea);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(-100, -1.15, 270);
  Z().add(ocean);

  // breaking-surf shimmer along the shore
  const surf = new THREE.Mesh(
    new THREE.PlaneGeometry(130, 7),
    new THREE.MeshBasicMaterial({ color: 0xeaf4f8, transparent: true, opacity: 0.15, depthWrite: false }),
  );
  surf.rotation.x = -Math.PI / 2;
  surf.position.set(-32, -1.0, 82);
  Z().add(surf);
  S.surf = surf;

  // palms: real bark trunks + painterly frond cards
  let placed = 0;
  const palmCap = quality().palms;
  for (let tries = 0; tries < 400 && placed < palmCap; tries++) {
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
    Z().add(palm);
    addCollider(x, z, 0.4 * s);
    placed++;
  }
}

// ---------- sky: billboard clouds, stars, sun & moon ----------
let clouds = [], stars, sunSprite, moonSprite;
function buildSky(scene) {
  const cloudTex = TEX.cloudSprite();
  const cloudN = quality().id === 'low' ? 5 : quality().id === 'high' ? 10 : 7;
  for (let i = 0; i < cloudN; i++) {
    const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.7, fog: false, depthWrite: false });
    const c = new THREE.Sprite(mat);
    const s = rand(36, quality().id === 'low' ? 64 : 88);
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
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  };
  ridge(122, 38, 0x3f7a48, 0x7eae6a, 3);
  ridge(156, 62, 0x6a9ec8, 0xc5dff5, 11);
}

// ---------- zone streaming ----------
let dust = null;
const sunDirV = new THREE.Vector3();
const _focus = new THREE.Vector3();

function buildDust(scene) {
  const n = quality().dust;
  if (!n) return;
  const geo = new THREE.BufferGeometry();
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = rand(-18, 18);
    arr[i * 3 + 1] = rand(0.25, 3.6);
    arr[i * 3 + 2] = rand(-18, 18);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  dust = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xfff3c4, size: 0.055, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true,
  }));
  scene.add(dust);
}

function disposeOwned(root) {
  const seen = new Set();
  root.traverse(o => {
    if (o.geometry && o.geometry.userData.owned && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
  });
}

function unmountZoneScenery() {
  if (S.zoneRoot) {
    disposeOwned(S.zoneRoot);
    S.scene.remove(S.zoneRoot);
  }
  S.zoneRoot = null;
  zoneParent = null;
  S.terrain = null;
  S.crystal = null;
  S.crystalHalo = null;
  S.surf = null;
  ocean = null;
  fireflies = null;
  lampLights = [];
  windowMats.length = 0;
  clearColliders();
}

export function mountZoneScenery(id) {
  unmountZoneScenery();
  const root = new THREE.Group();
  root.name = 'zone:' + id;
  zoneParent = root;
  S.zoneRoot = root;
  S.zone = id;
  S.scene.add(root);
  if (id === 'sanria') {
    buildCity(S.scene);
    buildHomePoint(S.scene);
  } else if (id === 'horutoto') {
    buildDungeon();
  } else {
    buildField();
  }
}

function buildFieldGate() {
  const g = new THREE.Group();
  // the city as seen from the plains: a wall and a shimmering arch, not the interior
  g.add(mesh(uvBox(16, 3.2, 1.4, 2), M.bricks, -13, 1.6, 30.2));
  g.add(mesh(uvBox(16, 3.2, 1.4, 2), M.bricks, 13, 1.6, 30.2));
  g.add(mesh(uvBox(10, 1.3, 1.7, 1.6), M.bricks, 0, 4.5, 30.2));
  for (const tx of [-5.2, 5.2]) {
    g.add(mesh(uvCyl(1.3, 1.5, 5, 10, 1.8), M.bricks, tx, 2.5, 30.2));
    g.add(mesh(new THREE.ConeGeometry(1.7, 1.8, 10), M.roof, tx, 5.6, 30.2));
  }
  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(6.2, 3.2),
    new THREE.MeshBasicMaterial({ color: 0xb9dcff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  );
  veil.position.set(0, 2.0, 32.4);
  g.add(veil);
  Z().add(g);
  addBox(-13, 30.2, 16, 1.6, 0.2);
  addBox(13, 30.2, 16, 1.6, 0.2);
}

function buildDungeon() {
  const ox = 500, oz = 500;
  const g = new THREE.Group();
  const floor = new THREE.Mesh(own(new THREE.PlaneGeometry(28, 62)), M.bricks);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(ox, 0, oz + 24);
  floor.name = 'terrain';
  floor.receiveShadow = true;
  g.add(floor);
  S.terrain = floor;
  const ceilMat = M.bricks;
  const ceil = new THREE.Mesh(own(new THREE.PlaneGeometry(28, 62)), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(ox, 4.3, oz + 24);
  g.add(ceil);

  function dwall(x, z, w, d, h = 4.2) {
    const m = mesh(uvBox(w, h, d, 2), M.bricks, x, h / 2, z);
    g.add(m);
  }
  // corridor shell
  dwall(ox - 6, oz + 24, 1.2, 58);
  dwall(ox + 6, oz + 24, 1.2, 58);
  dwall(ox, oz + 52, 12, 1.2);
  dwall(ox, oz - 2, 12, 1.2, 4.2);
  // side chamber
  dwall(ox - 12, oz + 30, 1.1, 12);
  dwall(ox - 9, oz + 36, 6, 1.1);
  dwall(ox - 9, oz + 24, 6, 1.1);
  // end dais
  g.add(mesh(uvBox(4, 0.4, 4, 1.4), M.paving, ox, 0.2, oz + 46));
  const relic = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshLambertMaterial({ color: 0x9b6cd6, emissive: 0x6a30b0, emissiveIntensity: 0.55 }));
  relic.position.set(ox, 1.3, oz + 46);
  g.add(relic);

  const exitVeil = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 3),
    new THREE.MeshBasicMaterial({ color: 0xd9ccff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  );
  exitVeil.position.set(ox, 1.7, oz + 48.5);
  g.add(exitVeil);

  for (const [lx, lz] of [[ox - 4.2, oz + 12], [ox + 4.2, oz + 22], [ox - 4.2, oz + 34], [ox + 4.2, oz + 44]]) {
    const torch = new THREE.Group();
    torch.add(mesh(uvCyl(0.06, 0.08, 1.1, 5, 0.4), M.planks, 0, 0.7, 0));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshLambertMaterial({ color: 0xffd27a, emissive: 0xff9d2e, emissiveIntensity: 0.7 }));
    head.position.y = 1.25;
    torch.add(head);
    const light = lampLight(torch, 1.3, 0xffb35c, 0.8, 9);
    torch.position.set(lx, 0, lz);
    g.add(torch);
    lampLights.push({ light, head });
  }
  for (let i = 0; i < 6; i++) {
    const rock = env(i % 2 ? 'boulder' : 'rockset', rand(0.35, 0.7));
    rock.position.set(ox + rand(-4, 4), 0, oz + rand(8, 44));
    rock.rotation.y = rand(0, 6);
    g.add(rock);
  }
  Z().add(g);
  addBox(ox - 6, oz + 24, 1.4, 58, 0.1);
  addBox(ox + 6, oz + 24, 1.4, 58, 0.1);
  addBox(ox, oz + 52, 12, 1.4, 0.1);
  addCollider(ox - 10, oz + 30, 2.2);
}

// ---------- day / night ----------
const SKY_DAY = new THREE.Color(0xc5ddf2), SKY_NIGHT = new THREE.Color(0x101628);
const SKY_DAWN = new THREE.Color(0xf0a06a);
const SKY_ZENITH = new THREE.Color(0x2a74d8);
const HORIZON_DAY = new THREE.Color(0xf4d2a4);
const HORIZON_NIGHT = new THREE.Color(0x1a2748);
const SUN_DAY = new THREE.Color(0xffe0a8), SUN_DAWN = new THREE.Color(0xff8a45);
const HEMI_DAY = new THREE.Color(0x8ec4f8), HEMI_DAWN = new THREE.Color(0xffb088);
const AMBIENT_DAY = new THREE.Color(0xfff3e2), AMBIENT_NIGHT = new THREE.Color(0x1a2744);
const CLOUD_DAY = new THREE.Color(0xfff6ea), CLOUD_NIGHT = new THREE.Color(0x8e98b8);
const _cloudTint = new THREE.Color();
export function updateDayCycle(dt) {
  if (!sun) return;                  // world not built yet (still on loading screen)
  S.time += dt / 25;                 // 1 in-game hour ≈ 25s → full day 10 min
  if (S.time >= 24) { S.time -= 24; S.day++; }
  const t = S.time;
  const dayF = clamp((Math.sin((t - 6) / 24 * Math.PI * 2) + 0.25) / 1.25, 0, 1);
  const dawnF = Math.max(0, 1 - Math.abs(t - 6.5) / 1.6) + Math.max(0, 1 - Math.abs(t - 18.5) / 1.6);

  const ang = ((t - 6) / 24) * Math.PI * 2;
  sunDirV.set(Math.cos(ang), Math.sin(ang), 0.34).normalize();
  const focus = S.player ? _focus.copy(S.player.pos) : _focus.set(0, 0.6, 4);
  sun.position.copy(focus).addScaledVector(sunDirV, 48);
  sun.target.position.copy(focus);
  sun.intensity = lerp(0.06, 1.4, dayF);
  sun.color.copy(SUN_DAY).lerp(SUN_DAWN, clamp(dawnF, 0, 1) * 0.75);
  hemi.intensity = lerp(0.2, 0.55, dayF);
  hemi.color.copy(HEMI_DAY).lerp(HEMI_DAWN, clamp(dawnF, 0, 1) * 0.55);
  ambient.intensity = lerp(0.14, 0.26, dayF);
  ambient.color.copy(AMBIENT_DAY).lerp(AMBIENT_NIGHT, 1 - dayF);

  const fogC = SKY_NIGHT.clone().lerp(SKY_DAY, dayF).lerp(SKY_DAWN, clamp(dawnF, 0, 1) * 0.45);
  if (S.zone === 'horutoto') fogC.set(0x141820);
  else if (S.zone === 'sanria') fogC.copy(SKY_NIGHT).lerp(new THREE.Color(0xd4e6f8), dayF).lerp(HORIZON_DAY, 0.22 * dayF);
  S.scene.fog.color.copy(fogC);
  if (S.zone === 'horutoto') { S.scene.fog.near = 6; S.scene.fog.far = 36; }
  else if (S.zone === 'sanria') { S.scene.fog.near = lerp(60, 85, dayF); S.scene.fog.far = lerp(170, 240, dayF); }
  else { S.scene.fog.near = lerp(36, 55, dayF); S.scene.fog.far = lerp(130, 190, dayF); }

  if (skyMat && skyMat.uniforms) {
    const u = skyMat.uniforms;
    u.sunDir.value.copy(sunDirV);
    u.sunsetAmt.value = 0.4 + clamp(dawnF, 0, 1) * 0.6;
    u.zenith.value.copy(SKY_NIGHT).lerp(SKY_ZENITH, dayF);
    u.horizon.value.copy(HORIZON_NIGHT).lerp(HORIZON_DAY, dayF);
    if (S.zone === 'horutoto') {
      u.zenith.value.set(0x10141c);
      u.horizon.value.set(0x1a2030);
    }
  }
  if (S.grade) {
    S.grade.warmth.value = 0.22 + dawnF * 0.35;
    S.grade.dusk.value = clamp(dawnF, 0, 1);
    S.grade.night.value = 1 - dayF;
  }
  windUniform.value += dt;
  updateBlobs();
  if (dust) {
    const anchor = S.player ? S.player.pos : _focus;
    dust.position.set(anchor.x, anchor.y, anchor.z);
    dust.material.opacity = S.zone === 'horutoto' ? 0.05 : lerp(0.02, 0.28, dayF);
    const dp = dust.geometry.attributes.position;
    const tt = performance.now() / 1000;
    for (let i = 0; i < dp.count; i++) {
      const y = dp.getY(i) + Math.sin(tt * 0.35 + i) * 0.004;
      dp.setY(i, y > 4 ? 0.3 : y);
    }
    dp.needsUpdate = true;
  }

  for (const { light, head } of lampLights) {
    if (light) light.intensity = lerp(1.1, 0, dayF);
    if (head && head.material) head.material.emissiveIntensity = lerp(0.65, 0.12, dayF);
  }
  for (const wm of windowMats) wm.emissiveIntensity = lerp(0.42, 0.06, dayF);

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
    sunSprite.position.copy(sunDirV).multiplyScalar(340);
    sunSprite.material.opacity = S.zone === 'horutoto' ? 0 : clamp(dayF * 1.4, 0, 1);
  }
  if (moonSprite) {
    moonSprite.position.copy(sunDirV).multiplyScalar(-340);
    moonSprite.position.x += 40;
    moonSprite.material.opacity = S.zone === 'horutoto' ? 0 : clamp(1 - dayF * 1.8, 0, 0.9);
  }
  for (const c of clouds) {
    c.obj.position.x += c.drift * dt;
    if (c.obj.position.x > 280) c.obj.position.x = -280;
    const cloudOp = S.zone === 'horutoto' ? 0 : lerp(0.1, 0.72, dayF);
    for (const m of c.mats) {
      m.opacity = cloudOp;
      m.color.copy(_cloudTint.copy(CLOUD_DAY).lerp(CLOUD_NIGHT, 1 - dayF));
    }
  }

  if (ocean && ocean.material && ocean.material.map) {
    ocean.material.map.offset.x += dt * 0.01;
  }
  if (S.surf) S.surf.material.opacity = (0.08 + (Math.sin(performance.now() / 1300) + 1) * 0.05) * (0.3 + dayF * 0.7);
  if (S.crystal) {
    S.crystal.rotation.y += dt * 0.6;
    S.crystal.position.y = terrainHeight(3, -3) + 2.05 + Math.sin(performance.now() / 700) * 0.12;
  }
  if (S.crystalHalo) {
    const pulse = 0.55 + Math.sin(performance.now() / 900) * 0.18;
    S.crystalHalo.material.opacity = pulse;
    S.crystalHalo.scale.set(8.2 + pulse, 10.4 + pulse * 1.4, 1);
  }
}
