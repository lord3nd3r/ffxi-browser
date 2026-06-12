// Entity class + character models (KayKit CC0 rigged GLBs with animations)
// + procedural meshes for creatures and props.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { S, rand, irand } from './state.js';
import { MONSTERS } from './data.js';

// ---------- rigged character models (Quaternius Universal rig, realistic proportions) ----------
// Outfits + base bodies share one skeleton; the Universal Animation Library drives them all.
const MODELS = {};            // key -> { scene, animations }
const CHAR_FILES = {
  Male_Ranger: 'models/chars/Male_Ranger.gltf',
  Male_Peasant: 'models/chars/Male_Peasant.gltf',
  Female_Ranger: 'models/chars/Female_Ranger.gltf',
  Female_Peasant: 'models/chars/Female_Peasant.gltf',
  Base_Male: 'models/chars/Superhero_Male_FullBody.gltf',
  Base_Female: 'models/chars/Superhero_Female_FullBody.gltf',
};
let UAL_CLIPS = [];           // shared animation clips for the universal rig
const HAIR = {};              // hairstyle meshes, recolored per character
const HAIR_FILES = ['Hair_Buzzed', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', 'Hair_Beard'];

// ---------- rigged monster models (used when a good free model exists) ----------
const OVERRIDES = {};         // family -> { scene, animations }

export function preloadModels(onProgress) {
  const loader = new GLTFLoader();
  const required = Object.entries(CHAR_FILES).map(([key, path]) => ({ key, path, isRequired: true }));
  required.push({ key: '__ual', path: 'models/chars/UAL1_Standard.glb', isRequired: true });

  const overrideKeys = ['sheep', 'bee', 'boss', 'spider', 'bat'];
  const overrideModels = overrideKeys.map(key => ({ key, path: `models/${key}.glb`, isRequired: false }));
  const hairModels = HAIR_FILES.map(key => ({ key, path: `models/chars/hair/${key}.gltf`, isRequired: false, isHair: true }));

  const allToLoad = [...required, ...overrideModels, ...hairModels];

  let loadedBase = 0;

  return Promise.all(allToLoad.map(item => new Promise((resolve) => {
    loader.load(item.path, (gltf) => {
      if (item.key === '__ual') {
        UAL_CLIPS = gltf.animations;
        loadedBase++;
      } else if (item.isHair) {
        HAIR[item.key] = gltf.scene;
      } else if (item.isRequired) {
        MODELS[item.key] = { scene: gltf.scene, animations: gltf.animations };
        loadedBase++;
      } else {
        OVERRIDES[item.key] = { scene: gltf.scene, animations: gltf.animations };
      }
      if (onProgress) onProgress(loadedBase, required.length);
      resolve();
    }, undefined, (err) => {
      if (item.isRequired) {
        console.error(`Failed to load required base model: ${item.path}`, err);
      }
      // If optional overrides fail to load (404), that's expected and we proceed
      resolve();
    });
  })));
}

function resolveAnimationAliases(anims, srcAnimations) {
  // Populate standard clips
  srcAnimations.forEach(clip => {
    anims[clip.name] = clip;
  });

  const getMatch = (patterns) => {
    for (const pat of patterns) {
      // Direct match
      if (anims[pat]) return anims[pat];
      // Case-insensitive direct match
      const lowerPat = pat.toLowerCase();
      const direct = srcAnimations.find(c => c.name.toLowerCase() === lowerPat);
      if (direct) return direct;
      // Substring match
      const match = srcAnimations.find(c => c.name.toLowerCase().includes(lowerPat));
      if (match) return match;
    }
    return null;
  };

  // Define fallback mappings (Universal Animation Library names first, then legacy patterns)
  const mapping = {
    'Idle': ['Idle_Loop', 'Idle', 'Pose', 'Standing', 'T-Pose', 'Unarmed_Idle', 'Flying', 'Fly'],
    'Running_A': ['Jog_Fwd_Loop', 'Running_A', 'Run', 'Running', 'Walking_A', 'Walk', 'Walking', 'Flying', 'Fly', 'Jump', 'Idle'],
    'Death_A': ['Death01', 'Death_A', 'Death', 'Die', 'Lie_Down', 'Lie_Pose', 'Idle'],
    'Spellcasting': ['Spell_Simple_Idle_Loop', 'Spellcasting', 'Spellcast_Long', 'Cast', 'Magic', 'Interact', 'Idle'],
    'Spellcast_Shoot': ['Spell_Simple_Shoot', 'Spellcast_Shoot', 'Spellcasting', 'Cast', 'Attack', 'Idle'],
    'Interact': ['Interact', 'Use', 'PickUp', 'Spellcasting', 'Idle'],
    'Cheer': ['Dance_Loop', 'Cheer', 'Interact', 'Idle'],
    'Use_Item': ['Use_Item', 'Interact', 'Cheer', 'Idle'],
    '2H_Melee_Attack_Spin': ['Sword_Attack', '2H_Melee_Attack_Spin', 'Attack_Spin', 'Spin', 'Attack', 'Slash', 'Chop', 'Idle'],
    'Sit_Floor_Idle': ['Sitting_Idle_Loop', 'Sit_Floor_Idle', 'Sit_Floor_Pose', 'Sit_Floor', 'Sit_Chair_Idle', 'Sit_Chair', 'Sit', 'Idle'],
    'Sit_Floor_Down': ['Sitting_Enter', 'Sit_Floor_Down', 'Sit_Chair_Down', 'Sit', 'Idle'],
    'Sit_Floor_StandUp': ['Sitting_Exit', 'Sit_Floor_StandUp', 'Sit_Chair_StandUp', 'Stand', 'Idle'],
    '1H_Melee_Attack_Chop': ['Sword_Attack', 'Attack'],
    '1H_Melee_Attack_Slice_Diagonal': ['Sword_Attack', 'Attack'],
    '1H_Melee_Attack_Slice_Horizontal': ['Sword_Attack', 'Attack'],
    '1H_Melee_Attack_Stab': ['Sword_Attack', 'Attack'],
    'Unarmed_Melee_Attack_Punch_A': ['Punch_Jab', 'Punch', 'Attack'],
    'Unarmed_Melee_Attack_Punch_B': ['Punch_Cross', 'Punch', 'Attack'],
    'Unarmed_Melee_Attack_Kick': ['Punch_Cross', 'Kick', 'Attack'],
    'Dualwield_Melee_Attack_Slice': ['Sword_Attack', 'Attack'],
    'Dualwield_Melee_Attack_Stab': ['Sword_Attack', 'Attack'],
  };

  // Resolve standard groups
  for (const [key, patterns] of Object.entries(mapping)) {
    if (!anims[key]) {
      const match = getMatch(patterns);
      if (match) anims[key] = match;
    }
  }

  // Resolve attack animations (job-specific attacks)
  const attackKeys = [
    '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab',
    'Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B', 'Unarmed_Melee_Attack_Kick', 'Dualwield_Melee_Attack_Slice',
    'Dualwield_Melee_Attack_Stab'
  ];

  const genericAttackPatterns = ['Attack', 'Slash', 'Chop', 'Stab', 'Punch', 'Kick', 'Melee', 'Idle'];
  attackKeys.forEach(key => {
    if (!anims[key]) {
      const specificMatch = getMatch([key]);
      if (specificMatch) {
        anims[key] = specificMatch;
      } else {
        const genericMatch = getMatch(genericAttackPatterns);
        if (genericMatch) anims[key] = genericMatch;
      }
    }
  });
}

// FFXI-flavored loadouts on the universal rig. Keys keep the old model names so
// callers don't change: Knight=WAR, Barbarian=MNK, Mage=WHM, Rogue_Hooded=BLM, Rogue=THF.
const CHAR_CONFIG = {
  Knight:       { outfit: 'Male_Ranger',    base: 'Base_Male',   hide: ['Male_Ranger_Head_Hood'], weapon: 'sword', hair: 'Hair_SimpleParted' },
  Barbarian:    { outfit: 'Male_Peasant',   base: 'Base_Male',   hide: [], weapon: null, hair: 'Hair_Buzzed' },
  Mage:         { outfit: 'Female_Peasant', base: 'Base_Female', hide: [], weapon: 'club', hair: 'Hair_Long' },
  Rogue_Hooded: { outfit: 'Male_Ranger',    base: 'Base_Male',   hide: ['Male_Ranger_Acc_Pauldron'], weapon: 'staff', hair: null },   // hooded
  Rogue:        { outfit: 'Female_Ranger',  base: 'Base_Female', hide: ['Female_Ranger_Head_Hood', 'Female_Ranger_Acc_Pauldrons'], weapon: 'dagger', hair: 'Hair_Long' },
};

const SKIN_REF = new THREE.Color(0xd8a87c);   // the base texture's mid skin tone

// clone a rigged character; returns { group, mixer, anims, parts }
// appearance: { skin, hair } colors (char-create choices), hairStyle override, beard flag
export function makeCharacterModel(name, { scale = 0.9, appearance = null } = {}) {
  const cfg = CHAR_CONFIG[name] || CHAR_CONFIG.Knight;
  const src = MODELS[cfg.outfit];
  if (!src) {
    console.error("Model source not preloaded: " + name);
    return { group: new THREE.Group(), mixer: null, anims: {}, parts: {} };
  }

  const rig = SkeletonUtils.clone(src.scene);
  rig.scale.setScalar(scale);

  // bones by name (universal UE-style skeleton: root/pelvis/spine_01/.../hand_r)
  const boneByName = {};
  rig.traverse(o => { if (o.isBone) boneByName[o.name] = o; });

  // graft the base body (head, eyes, skin) onto the outfit's skeleton
  const skinTint = appearance && appearance.skin
    ? new THREE.Color(appearance.skin).multiply(new THREE.Color(1 / SKIN_REF.r, 1 / SKIN_REF.g, 1 / SKIN_REF.b))
    : null;
  const hairColor = new THREE.Color((appearance && appearance.hair) || 0x4a2f1d);
  const baseSrc = MODELS[cfg.base];
  if (baseSrc) {
    const baseClone = SkeletonUtils.clone(baseSrc.scene);
    const grafts = [];
    baseClone.traverse(o => { if (o.isSkinnedMesh) grafts.push(o); });
    for (const m of grafts) {
      const mapped = m.skeleton.bones.map(b => boneByName[b.name]);
      if (mapped.some(b => !b)) continue;            // skeleton mismatch — skip mesh
      m.skeleton = new THREE.Skeleton(mapped, m.skeleton.boneInverses);
      m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
      const nm = m.name.toLowerCase();
      if (nm.includes('eyebrow')) {
        m.material = m.material.clone();
        m.material.color.copy(hairColor).multiplyScalar(1.4);
      } else if (skinTint && !nm.includes('eye')) {
        m.material = m.material.clone();
        m.material.color.copy(skinTint);
      }
      rig.add(m);
    }
  }

  // hairstyle: rigid mesh attached to the head bone (it's modeled in body space)
  const style = appearance && appearance.hairStyle !== undefined ? appearance.hairStyle : cfg.hair;
  const headBone = boneByName.head || boneByName.Head;
  const attachToHead = (styleName) => {
    if (!styleName || !HAIR[styleName] || !headBone) return;
    const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.72 });
    const h = HAIR[styleName].clone(true);
    h.traverse(o => { if (o.isMesh) { o.material = hairMat; o.castShadow = true; } });
    rig.add(h);
    rig.updateMatrixWorld(true);
    headBone.attach(h);                              // keeps placement, follows the head
  };
  attachToHead(style);
  if (appearance && appearance.beard) attachToHead('Hair_Beard');

  const hideSet = new Set(cfg.hide);
  rig.traverse(o => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;          // skinned bounds are unreliable mid-anim
    }
    if (hideSet.has(o.name)) o.visible = false;
  });

  const mixer = new THREE.AnimationMixer(rig);
  const anims = {};
  resolveAnimationAliases(anims, UAL_CLIPS);

  // weapon in the right hand
  let hand = boneByName.hand_r || boneByName.Hand_R || null;
  if (!hand) {
    rig.traverse(o => { if (!hand && o.isBone && o.name.toLowerCase().includes('hand') && /(_r|r)$/.test(o.name.toLowerCase())) hand = o; });
  }
  if (!hand) { hand = new THREE.Group(); rig.add(hand); }
  if (cfg.weapon) {
    const w = makeWeapon(cfg.weapon);
    w.rotation.set(0.15, 0, 0);          // blade along the grip axis, slight forward tilt
    hand.add(w);
  }

  const parts = { body: rig, hand };
  return { group: rig, mixer, anims, parts };
}

// loop-animation state machine helpers
export function setLoopAnim(e, name, fade = 0.22) {
  if (!e.mixer || e.curLoop === name || e.oneShotAction) { e.pendingLoop = name; return; }
  const clip = e.anims[name] || e.anims.Idle;
  if (!clip) return;
  const action = e.mixer.clipAction(clip);
  if (e.curAction) e.curAction.fadeOut(fade);
  action.reset().fadeIn(fade).play();
  e.curAction = action;
  e.curLoop = name;
  e.pendingLoop = name;
}

export function playOnce(e, name, fade = 0.12, lock = true) {
  if (!e.mixer) return;
  const clip = e.anims[name];
  if (!clip) return;
  const action = e.mixer.clipAction(clip);
  action.reset().setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  if (e.curAction) e.curAction.fadeOut(fade);
  action.fadeIn(fade).play();
  if (lock) {
    e.oneShotAction = action;
    const onDone = (ev) => {
      if (ev.action !== action) return;
      e.mixer.removeEventListener('finished', onDone);
      e.oneShotAction = null;
      e.curLoop = null;                  // force loop re-entry
      const back = e.pendingLoop || 'Idle';
      setLoopAnim(e, back, 0.18);
    };
    e.mixer.addEventListener('finished', onDone);
  }
  e.curAction = action;
}

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: false, ...opts }));
  return matCache.get(key);
}

// ---------- nameplate sprite ----------
export function makeNameplate(text, color = '#ffffff', sub = '', disc = false) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 80;
  const cx = cv.getContext('2d');
  let ty = 36;
  if (disc) {
    // FFXI party-member disc: gold orb above the name
    const g = cx.createRadialGradient(124, 12, 2, 128, 16, 13);
    g.addColorStop(0, '#fff3c4');
    g.addColorStop(0.5, '#f5c842');
    g.addColorStop(1, '#9a6a14');
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(128, 16, 12, 0, 7); cx.fill();
    cx.strokeStyle = '#4a3608'; cx.lineWidth = 2;
    cx.beginPath(); cx.arc(128, 16, 12, 0, 7); cx.stroke();
    ty = 54;
  }
  cx.font = 'bold 22px Verdana';
  cx.textAlign = 'center';
  cx.shadowColor = '#000'; cx.shadowBlur = 5;
  cx.fillStyle = color;
  cx.fillText(text.slice(0, 22), 128, ty);
  if (sub) { cx.font = '15px Verdana'; cx.fillStyle = '#ffd43b'; cx.fillText(sub, 128, ty + 22); }
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(3.2, 1.0, 1);
  sp.renderOrder = 10;
  return sp;
}

// ---------- weapons ----------
export function makeWeapon(kind) {
  const g = new THREE.Group();
  const box = (w, h, d, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.castShadow = true; return o; };
  const cyl = (rt, rb, h, m, seg = 7) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.castShadow = true; return o; };
  const sph = (r, m) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), m); o.castShadow = true; return o; };
  
  if (kind === 'sword') {
    const blade = box(0.09, 0.95, 0.03, mat(0xc8ccd4, { metalness: 0.7, roughness: 0.3 }));
    blade.position.y = 0.62;
    const guard = box(0.26, 0.05, 0.06, mat(0xc9a227, { metalness: 0.6 }));
    guard.position.y = 0.14;
    const grip = cyl(0.035, 0.035, 0.24, mat(0x4a2f1d));
    g.add(blade, guard, grip);
  } else if (kind === 'dagger') {
    const blade = box(0.07, 0.5, 0.025, mat(0xc8ccd4, { metalness: 0.7, roughness: 0.3 }));
    blade.position.y = 0.38;
    const grip = cyl(0.03, 0.03, 0.2, mat(0x333));
    g.add(blade, grip);
  } else if (kind === 'club') {
    const head = cyl(0.12, 0.07, 0.45, mat(0x8a6a3f));
    head.position.y = 0.55;
    const grip = cyl(0.04, 0.04, 0.5, mat(0x5a4028));
    grip.position.y = 0.1;
    g.add(head, grip);
  } else if (kind === 'staff') {
    const pole = cyl(0.035, 0.045, 1.5, mat(0x6b4a2f));
    pole.position.y = 0.45;
    const gem = sph(0.1, mat(0x9b6cd6, { emissive: 0x6a30b0, emissiveIntensity: 0.7 }));
    gem.position.y = 1.25;
    g.add(pole, gem);
  }
  return g;
}

// ---------- humanoid fallback generator ----------
export function makeHumanoid({ skin = 0xd8a87c, cloth = 0x8a4f2d, trim = 0xc9a227, hair = 0x4a2f1d, scale = 1, small = false } = {}) {
  const g = new THREE.Group();
  return { group: g, parts: { body: g, hand: g }, scale };
}

// ---------- monsters ----------
export function makeMonsterMesh(family) {
  // If an authentic GLTF model override was loaded, use it directly!
  if (OVERRIDES[family]) {
    const src = OVERRIDES[family];
    const rig = SkeletonUtils.clone(src.scene);
    // normalize: each pack ships at arbitrary native size — measure and scale
    // to an FFXI-style height relative to the ~1.6u player characters
    const TARGET_H = { sheep: 1.0, bee: 0.7, boss: 3.2, spider: 1.0, bat: 0.65 };
    const bbox = new THREE.Box3().setFromObject(rig);
    const nativeH = Math.max(bbox.max.y - bbox.min.y, 0.001);
    rig.scale.setScalar((TARGET_H[family] || 1.2) / nativeH);
    
    const mixer = new THREE.AnimationMixer(rig);
    const anims = {};
    resolveAnimationAliases(anims, src.animations);
    
    rig.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    
    return { group: rig, mixer, anims, parts: { bob: rig } };
  }
  
  // Otherwise, construct a custom organic low-poly 3D representation
  const g = new THREE.Group();
  const parts = {};
  
  const box = (w, h, d, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.castShadow = o.receiveShadow = true; return o; };
  const sph = (r, m, ws = 12, hs = 10) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m); o.castShadow = o.receiveShadow = true; return o; };
  const cyl = (rt, rb, h, m, seg = 10) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.castShadow = o.receiveShadow = true; return o; };
  const cone = (r, h, m, seg = 8) => { const o = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m); o.castShadow = o.receiveShadow = true; return o; };
  
  if (family === 'hare' || family === 'sheep') {
    // Wild Hare (bunny) — also the fallback if the sheep model fails to load
    const body = sph(0.35, mat(0xdfd5c6));
    body.scale.set(1.3, 1, 1);
    body.position.y = 0.35;
    
    const head = sph(0.24, mat(0xdfd5c6));
    head.position.set(0.3, 0.55, 0);
    
    const earL = cone(0.06, 0.4, mat(0xdfd5c6));
    earL.position.set(0.25, 0.85, 0.08);
    earL.rotation.z = -0.2;
    earL.rotation.x = -0.1;
    
    const earR = cone(0.06, 0.4, mat(0xdfd5c6));
    earR.position.set(0.25, 0.85, -0.08);
    earR.rotation.z = -0.2;
    earR.rotation.x = 0.1;
    
    const earInsideL = cone(0.04, 0.3, mat(0xffa6b9));
    earInsideL.position.set(0.01, 0.05, 0);
    earL.add(earInsideL);
    
    const earInsideR = cone(0.04, 0.3, mat(0xffa6b9));
    earInsideR.position.set(0.01, 0.05, 0);
    earR.add(earInsideR);
    
    const eyeL = sph(0.03, mat(0x111111));
    eyeL.position.set(0.42, 0.62, 0.1);
    const eyeR = sph(0.03, mat(0x111111));
    eyeR.position.set(0.42, 0.62, -0.1);
    
    const nose = sph(0.02, mat(0xff7da0));
    nose.position.set(0.52, 0.56, 0);
    
    const tail = sph(0.09, mat(0xffffff));
    tail.position.set(-0.45, 0.45, 0);
    
    for (const [fx, fz] of [[0.18, 0.22], [0.18, -0.22], [-0.22, 0.22], [-0.22, -0.22]]) {
      const foot = sph(0.09, mat(0xdfd5c6));
      foot.position.set(fx, 0.09, fz);
      g.add(foot);
    }
    
    g.add(body, head, earL, earR, eyeL, eyeR, nose, tail);
    parts.bob = g;
    
  } else if (family === 'bee') {
    // Stinger Wasp
    const thorax = sph(0.2, mat(0xfab818));
    thorax.position.y = 0.4;
    
    const head = sph(0.16, mat(0x1a1a1a));
    head.position.set(0.22, 0.45, 0);
    
    const eyeL = sph(0.05, mat(0xcc1a1a));
    eyeL.position.set(0.3, 0.52, 0.08);
    const eyeR = sph(0.05, mat(0xcc1a1a));
    eyeR.position.set(0.3, 0.52, -0.08);
    
    const abdoGroup = new THREE.Group();
    abdoGroup.position.set(-0.25, 0.35, 0);
    abdoGroup.rotation.z = -0.2;
    
    const segments = 4;
    for (let i = 0; i < segments; i++) {
      const radius = 0.22 - i * 0.03;
      const segMesh = sph(radius, mat(i % 2 === 0 ? 0x1a1a1a : 0xfab818));
      segMesh.position.x = -i * 0.15;
      abdoGroup.add(segMesh);
    }
    
    const stinger = cone(0.04, 0.2, mat(0x1a1a1a));
    stinger.position.set(-segments * 0.15 - 0.02, 0, 0);
    stinger.rotation.z = -Math.PI / 2;
    abdoGroup.add(stinger);
    
    const wingL = sph(0.12, mat(0xffffff, { transparent: true, opacity: 0.65 }));
    wingL.scale.set(2.8, 0.2, 0.8);
    wingL.position.set(0, 0.56, 0.18);
    wingL.rotation.y = 0.3;
    wingL.rotation.z = 0.2;
    
    const wingR = sph(0.12, mat(0xffffff, { transparent: true, opacity: 0.65 }));
    wingR.scale.set(2.8, 0.2, 0.8);
    wingR.position.set(0, 0.56, -0.18);
    wingR.rotation.y = -0.3;
    wingR.rotation.z = -0.2;
    
    g.add(thorax, head, eyeL, eyeR, abdoGroup, wingL, wingR);
    parts.wings = [wingL, wingR];
    parts.bob = thorax;
    
  } else if (family === 'mandra') {
    // Mandragora (classic turnip-creature)
    const body = sph(0.35, mat(0xfaf7f0));
    body.scale.set(1, 1.25, 1);
    body.position.y = 0.45;
    
    const eyeL = sph(0.03, mat(0x111111));
    eyeL.position.set(0.24, 0.55, 0.14);
    const eyeR = sph(0.03, mat(0x111111));
    eyeR.position.set(0.24, 0.55, -0.14);
    
    const blushL = sph(0.05, mat(0xa3c495));
    blushL.position.set(0.25, 0.45, 0.16);
    blushL.scale.set(0.5, 0.5, 1);
    const blushR = sph(0.05, mat(0xa3c495));
    blushR.position.set(0.25, 0.45, -0.16);
    blushR.scale.set(0.5, 0.5, 1);
    
    const stem = cyl(0.03, 0.03, 0.2, mat(0x6b4c35));
    stem.position.set(0, 0.95, 0);
    
    const leaf = cone(0.12, 0.45, mat(0x40944b));
    leaf.position.set(0, 1.15, 0);
    leaf.rotation.z = 0.4;
    
    const armL = cyl(0.035, 0.02, 0.22, mat(0xdfd3be));
    armL.position.set(0.3, 0.35, 0.24);
    armL.rotation.z = 0.6;
    armL.rotation.y = 0.4;
    
    const armR = cyl(0.035, 0.02, 0.22, mat(0xdfd3be));
    armR.position.set(0.3, 0.35, -0.24);
    armR.rotation.z = 0.6;
    armR.rotation.y = -0.4;
    
    const legL = cyl(0.05, 0.04, 0.2, mat(0xdfd3be));
    legL.position.set(0.08, 0.1, 0.14);
    
    const legR = cyl(0.05, 0.04, 0.2, mat(0xdfd3be));
    legR.position.set(0.08, 0.1, -0.14);
    
    g.add(body, eyeL, eyeR, blushL, blushR, stem, leaf, armL, armR, legL, legR);
    parts.bob = g;
    
  } else if (family === 'worm') {
    // Segmented Rising Worm (Stone Eater)
    const segments = 5;
    const wormGroup = new THREE.Group();
    for (let i = 0; i < segments; i++) {
      const radius = 0.32 - i * 0.04;
      const segment = cyl(radius - 0.02, radius, 0.3, mat(0x6b5a4b));
      segment.position.y = i * 0.28 + 0.15;
      segment.position.x = Math.sin(i * 0.4) * 0.08;
      segment.position.z = Math.cos(i * 0.4) * 0.08 - 0.08;
      wormGroup.add(segment);
      
      if (i === segments - 1) {
        const mouth = sph(radius - 0.01, mat(0x111111));
        mouth.position.set(segment.position.x, segment.position.y + 0.12, segment.position.z);
        wormGroup.add(mouth);
        
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
          const tooth = cone(0.02, 0.06, mat(0xffffff));
          tooth.position.set(
            segment.position.x + Math.cos(a) * (radius - 0.04),
            segment.position.y + 0.12,
            segment.position.z + Math.sin(a) * (radius - 0.04)
          );
          tooth.rotation.x = Math.sin(a) * 0.5;
          tooth.rotation.z = -Math.cos(a) * 0.5;
          wormGroup.add(tooth);
        }
      }
    }
    g.add(wormGroup);
    parts.bob = g;
    
  } else if (family === 'goblin') {
    // Goblin Mugger (brown hood, glowing eyes)
    const body = cyl(0.24, 0.28, 0.7, mat(0x6e4e3b));
    body.position.y = 0.6;
    
    const hood = sph(0.26, mat(0x8c6249));
    hood.position.set(0, 1.05, 0.02);
    
    const mask = sph(0.2, mat(0x1a1a1a));
    mask.position.set(0.06, 1.02, 0.02);
    
    const eyeL = sph(0.035, mat(0xffe066, { emissive: 0xffaa00, emissiveIntensity: 1.5 }));
    eyeL.position.set(0.2, 1.05, 0.07);
    const eyeR = sph(0.035, mat(0xffe066, { emissive: 0xffaa00, emissiveIntensity: 1.5 }));
    eyeR.position.set(0.2, 1.05, -0.07);
    
    const earL = cone(0.04, 0.35, mat(0x6e7d5a));
    earL.position.set(-0.12, 1.1, 0.24);
    earL.rotation.set(0.2, -0.4, 1.1);
    
    const earR = cone(0.04, 0.35, mat(0x6e7d5a));
    earR.position.set(-0.12, 1.1, -0.24);
    earR.rotation.set(-0.2, 0.4, 1.1);
    
    const armL = cyl(0.04, 0.03, 0.4, mat(0x6e7d5a));
    armL.position.set(0, 0.7, 0.34);
    armL.rotation.z = -0.3;
    
    const armR = cyl(0.04, 0.03, 0.4, mat(0x6e7d5a));
    armR.position.set(0, 0.7, -0.34);
    armR.rotation.z = -0.3;
    
    const bag = box(0.2, 0.35, 0.32, mat(0x4d3324));
    bag.position.set(-0.24, 0.65, 0);
    
    g.add(body, hood, mask, eyeL, eyeR, earL, earR, armL, armR, bag);
    parts.bob = g;
    
  } else if (family === 'orc' || family === 'boss') {
    // Orc / Field Boss (muscular bulky beast)
    const isBoss = family === 'boss';
    const skinColor = isBoss ? 0x9e2d26 : 0x476635;
    const armorColor = 0x2e3238;
    
    const torso = cyl(0.35, 0.42, 0.9, mat(skinColor));
    torso.position.y = 0.75;
    
    const head = sph(0.32, mat(skinColor));
    head.position.set(0.15, 1.3, 0);
    
    const shoulderL = sph(0.24, mat(armorColor));
    shoulderL.position.set(0, 1.1, 0.5);
    const shoulderR = sph(0.24, mat(armorColor));
    shoulderR.position.set(0, 1.1, -0.5);
    
    const armL = cyl(0.1, 0.08, 0.6, mat(skinColor));
    armL.position.set(0.05, 0.75, 0.58);
    armL.rotation.z = -0.2;
    
    const armR = cyl(0.1, 0.08, 0.6, mat(skinColor));
    armR.position.set(0.05, 0.75, -0.58);
    armR.rotation.z = -0.2;
    
    const snout = cyl(0.08, 0.09, 0.15, mat(skinColor));
    snout.position.set(0.35, 1.3, 0);
    snout.rotation.z = Math.PI / 2;
    
    const tuskL = cone(0.025, 0.12, mat(0xffffff));
    tuskL.position.set(0.38, 1.22, 0.09);
    tuskL.rotation.set(0.4, 0, -0.3);
    const tuskR = cone(0.025, 0.12, mat(0xffffff));
    tuskR.position.set(0.38, 1.22, -0.09);
    tuskR.rotation.set(-0.4, 0, -0.3);
    
    head.add(snout, tuskL, tuskR);
    
    if (isBoss) {
      const hornL = cone(0.08, 0.5, mat(0x111111));
      hornL.position.set(-0.15, 1.6, 0.18);
      hornL.rotation.set(0.3, 0.2, 0.6);
      
      const hornR = cone(0.08, 0.5, mat(0x111111));
      hornR.position.set(-0.15, 1.6, -0.18);
      hornR.rotation.set(-0.3, -0.2, 0.6);
      
      g.add(hornL, hornR);
      
      for (let i = 0; i < 4; i++) {
        const spike = cone(0.05, 0.25, mat(0x1a1a1a));
        spike.position.set(-0.25, 0.95 - i * 0.18, 0);
        spike.rotation.set(0, 0, -1.2);
        g.add(spike);
      }
    }
    
    const legL = cyl(0.12, 0.14, 0.4, mat(armorColor));
    legL.position.set(0, 0.2, 0.26);
    const legR = cyl(0.12, 0.14, 0.4, mat(armorColor));
    legR.position.set(0, 0.2, -0.26);
    
    g.add(torso, head, shoulderL, shoulderR, armL, armR, legL, legR);
    parts.bob = g;
  }
  
  // size the hand-built monsters against the ~1.6u realistic characters
  const PROC_SCALE = { hare: 0.85, sheep: 0.85, mandra: 0.7, worm: 0.9, goblin: 0.95, bee: 0.9, orc: 1.15, boss: 1.25 };
  g.scale.setScalar(PROC_SCALE[family] || 1);

  g.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return { group: g, parts };
}

let nextId = 1;

export class Entity {
  constructor(opts) {
    Object.assign(this, {
      id: nextId++,
      kind: 'monster',          // player | companion | monster | npc
      name: '???',
      level: 1,
      hp: 10, maxhp: 10, mp: 0, maxmp: 0, tp: 0,
      speed: 4.2,
      heading: 0,
      dest: null,               // {x,z} click-to-move destination
      target: null,
      attackTimer: 0,
      attackDelay: 2.8,
      casting: null,            // { action, t, total, target }
      recasts: {},              // actionId -> readyAt (S.now-based seconds)
      buffs: {},                // name -> { t } remaining seconds + data
      sleep: 0,
      dot: null,                // { dps, t, src }
      animT: Math.random() * 10,
      attackAnim: 0,
      hitFlash: 0,
      alive: true,
      aggroOn: null,
      home: null,
      wanderT: rand(2, 6),
      engaged: false,
      deathT: 0,
    }, opts);
  }
  get pos() { return this.mesh.position; }
  distTo(e) { return Math.hypot(this.pos.x - e.pos.x, this.pos.z - e.pos.z); }
  faceToward(x, z) { this.heading = Math.atan2(x - this.pos.x, z - this.pos.z); }
  isEnemy() { return this.kind === 'monster'; }
  isFriendly() { return this.kind === 'player' || this.kind === 'companion'; }
}

export function spawnMonster(typeId, x, z) {
  const def = MONSTERS[typeId];
  const { group, parts, mixer, anims } = makeMonsterMesh(def.family);
  const level = irand(def.lv[0], def.lv[1]);
  const hp = Math.round(def.hp * (1 + (level - def.lv[0]) * 0.18));
  const e = new Entity({
    kind: 'monster', typeId, def, name: def.name, level,
    hp, maxhp: hp, speed: def.speed,
    mesh: group, parts, mixer, anims,
    home: { x, z },
    attackDelay: def.boss ? 2.2 : 3.0,
  });
  if (mixer) setLoopAnim(e, 'Idle');
  const plate = makeNameplate(def.name, def.aggressive ? '#ff9d9d' : '#f3e9c8');
  plate.position.y = def.family === 'boss' ? 4.6 : (def.family === 'orc' ? 2.6 : 1.6);
  group.add(plate);
  e.plate = plate;
  group.position.set(x, S.heightAt(x, z), z);
  S.scene.add(group);
  S.monsters.push(e);
  return e;
}
