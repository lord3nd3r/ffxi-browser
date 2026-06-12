// Bootstrap: renderer, world, character creation / save restore, main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { ColorCorrectionShader } from 'three/addons/shaders/ColorCorrectionShader.js';
import { HueSaturationShader } from 'three/addons/shaders/HueSaturationShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { S } from './state.js';
import { initWorld, updateDayCycle } from './world.js';
import { initGame, updateGame, loadGame, saveGame, respawnPlayer } from './game.js';
import { initControls, updateCamera } from './controls.js';
import * as UI from './ui.js';
import { STARTER_WEAPON } from './data.js';

const app = document.getElementById('app');
window.__S = S; // debug/testing handle
import('./game.js').then(g => { window.__game = g; });

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.classList.add('webgl');
app.appendChild(renderer.domElement);
S.renderer = renderer;

S.scene = new THREE.Scene();
S.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 600);
S.camera.position.set(0, 8, 14);

// soft daylight environment reflections for PBR materials
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x9fc4e0);
  const hemiE = new THREE.HemisphereLight(0xcfe2f5, 0x8a7f5e, 3);
  envScene.add(hemiE);
  S.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  S.scene.environmentIntensity = 0.45;
}

// post: gentle bloom + soft grade, rendered with 4x MSAA
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { samples: 4, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(S.scene, S.camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.25, 0.7, 0.8);
composer.addPass(bloom);
const grade = new ShaderPass(ColorCorrectionShader);
grade.uniforms.powRGB.value.set(0.88, 0.88, 0.92);   // lift shadows / soften contrast
grade.uniforms.mulRGB.value.set(1.06, 1.05, 1.0);
composer.addPass(grade);
const vivid = new ShaderPass(HueSaturationShader);
vivid.uniforms.saturation.value = 0.06;
composer.addPass(vivid);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  S.camera.aspect = window.innerWidth / window.innerHeight;
  S.camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById('load-status').textContent = 'Shaping the plains…';

// default per-job equipment
function defaultEquip() {
  const eq = {};
  for (const j of Object.keys(STARTER_WEAPON)) eq[j] = { weapon: STARTER_WEAPON[j], armor: 'tunic' };
  return eq;
}

function startGame(charData, saved) {
  if (saved) {
    S.jobs = saved.jobs; S.job = saved.job; S.gil = saved.gil;
    S.inventory = saved.inventory || [];
    S.equipPerJob = saved.equipPerJob || defaultEquip();
    S.quests = saved.quests || {};
    S.bossDown = !!saved.bossDown;
    S.recruited = saved.recruited || {};
    S.autoMagic = saved.autoMagic || {};
    charData = {
      name: saved.charName, skin: saved.appearance.skin, hair: saved.appearance.hair,
      job: saved.job, savedVitals: saved.vitals,
    };
    if (saved.pos) S.savedPos = saved.pos;
  } else {
    S.equipPerJob = defaultEquip();
    S.inventory = [{ id: 'potion', qty: 3 }];
  }
  if (S.savedPos) S.player ? null : null;
  initGame(charData);
  if (saved && saved.pos) {
    S.player.mesh.position.set(saved.pos.x, S.heightAt(saved.pos.x, saved.pos.z), saved.pos.z);
  }
  UI.initPartyFrames();
  UI.initDraggables();
  UI.updateHUD();
  initControls(renderer.domElement);
  document.getElementById('btn-homepoint').addEventListener('click', respawnPlayer);
  window.addEventListener('beforeunload', saveGame);
  running = true;
}

// preload all models, build the world, then char create / continue
let running = false;
import('./entities.js').then(async ({ preloadModels }) => {
  const { preloadWorldModels } = await import('./world.js');
  let total = 0, done = 0;
  const prog = () => { document.getElementById('load-status').textContent = `Summoning Vana'diel… ${done}/${total || '?'}`; };
  try {
    await Promise.all([
      preloadModels((d, t) => { done++; total = Math.max(total, t + 33); prog(); }),
      preloadWorldModels((d, t) => { done++; total = Math.max(total, t + 5); prog(); }),
    ]);
    initWorld();
    document.getElementById('loading').style.display = 'none';
    const saved = loadGame();
    UI.charCreate(saved, (fresh) => {
      if (fresh) startGame(fresh, null);
      else startGame(null, saved);
      setTimeout(() => UI.openHelp(), 400);
    });
  } catch (err) {
    document.getElementById('load-status').textContent = 'Failed to load models: ' + err.message;
  }
});

// main loop
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  updateDayCycle(dt);
  if (running) {
    updateGame(dt);
    updateCamera(dt);
    UI.updateFloaters(dt);
  } else {
    // gentle establishing shot over the town during character creation
    const t = clock.elapsedTime * 0.08;
    S.camera.position.set(Math.sin(t) * 26, 12, Math.cos(t) * 26);
    S.camera.lookAt(0, 2, 0);
  }
  composer.render();
}
loop();
