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
import { initGame, updateGame, loadGame, saveGame, respawnPlayer, setTarget, spawnBurst, findActor } from './game.js';
import { initControls, updateCamera } from './controls.js';
import * as UI from './ui.js';
import { STARTER_WEAPON, ACTIONS } from './data.js';
import * as API from './api.js';
import * as Socket from './socket.js';
import * as Puppets from './puppets.js';
import * as MonsterPuppets from './monsterPuppets.js';
import { playOnce } from './entities.js';

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
  window.addEventListener('beforeunload', () => saveGame({ force: true, keepalive: true }));
  running = true;

  // ── multiplayer: connect WebSocket if logged in ──────────────
  if (API.isEnabled() && API.getToken()) {
    Socket.connect(API.getToken()).then(() => {
      Socket.enter(
        S.charName,
        S.job,
        S.appearance,
        S.player.pos.x,
        S.player.pos.z,
        S.player.heading,
        S.player.isMoving || false
      );
      Socket.startPositionUpdates(() => ({
        x: Number(S.player.pos.x.toFixed(2)),
        z: Number(S.player.pos.z.toFixed(2)),
        heading: S.player.heading,
        moving: S.player.isMoving || false,
      }));
      Socket.on('players:snapshot', (snapshot) => {
        Puppets.applySnapshot(snapshot);
      });
      Socket.on('player:left', ({ id }) => {
        Puppets.removePuppet(id);
      });
      Socket.on('disconnect', () => {
        Puppets.clearPuppets();
        MonsterPuppets.clearMonsters();
        UI.updatePlayerCount(1);
      });
      Socket.on('chat:message', (msg) => {
        const CHAN_CSS = { say: 'say', shout: 'shout', party: 'party-chat' };
        const prefix = msg.channel === 'shout' ? '[Shout] ' : msg.channel === 'party' ? '[Party] ' : '';
        UI.log(`${prefix}${msg.from} : ${msg.text}`, CHAN_CSS[msg.channel] || 'say');
      });
      Socket.on('player:count', ({ count }) => UI.updatePlayerCount(count));
      Socket.on('monsters:snapshot', (snapshot) => {
        MonsterPuppets.applySnapshot(snapshot);
      });
      Socket.on('player:status', (status) => {
        if (!S.player) return;
        S.player.hp = status.hp;
        S.player.maxhp = status.maxhp;
        S.player.mp = status.mp;
        S.player.maxmp = status.maxmp;
        S.player.tp = status.tp;
        S.player.level = status.level;
        if (S.jobs[S.job]) {
          S.jobs[S.job].level = status.level;
        }
        S.gil = status.gil;
        S.inventory = status.inventory || [];
        S.quests = status.quests || {};
        S.bossDown = !!status.bossDown;
        S.recruited = status.recruited || {};
        if (Array.isArray(status.companions)) {
          for (const sc of status.companions) {
            const partyMember = S.party.find(m => m.name === sc.name);
            if (partyMember) {
              partyMember.hp = sc.hp;
              partyMember.maxhp = sc.maxhp;
              partyMember.mp = sc.mp;
              partyMember.maxmp = sc.maxmp;
              partyMember.tp = sc.tp;
              partyMember.alive = sc.hp > 0;
            }
          }
        }
        UI.updateHUD();
        UI.initPartyFrames();
      });
      Socket.on('node:state', ({ id, available, harvestX, harvestZ }) => {
        const n = S.nodes.find(node => node.id === id);
        if (n) {
          n.available = available;
          n.sparkle.visible = available;
          if (!available && harvestX !== undefined && harvestZ !== undefined) {
            spawnBurst(new THREE.Vector3(harvestX, S.heightAt(harvestX, harvestZ) + 0.5, harvestZ), 0xffe27a, 10, 1.4);
          }
        }
      });
      Socket.on('visual:cast_start', ({ actorId, actionId, targetId, castTime }) => {
        const actor = findActor(actorId);
        if (actor) {
          actor.casting = { action: actionId, t: 0, total: castTime };
          if (actor === S.player) {
            UI.showCastbar(ACTIONS[actionId]?.name || actionId);
          }
        }
        const actorName = actor ? actor.name : actorId;
        const aName = ACTIONS[actionId]?.name || actionId;
        UI.log(`${actorName} starts casting ${aName}.`, 'magic');
      });
      Socket.on('visual:cast_cancel', () => {
        if (S.player.casting) {
          S.player.casting = null;
          UI.hideCastbar();
          UI.log('Casting interrupted.', 'sys');
        }
      });
      Socket.on('visual:hit', ({ actorId, targetId, damage, crit, magic, heal, buff, sleep, miss, actionId }) => {
        const actor = findActor(actorId);
        const target = findActor(targetId);
        if (actor && actor.mixer) {
          if (heal || buff) {
            playOnce(actor, 'Cheer');
          } else if (actionId && ACTIONS[actionId]) {
            const a = ACTIONS[actionId];
            if (a.kind === 'spell') playOnce(actor, 'Spellcast_Shoot');
            else if (a.kind === 'ws') playOnce(actor, actor.anims['2H_Melee_Attack_Spin'] ? '2H_Melee_Attack_Spin' : 'Melee_Attack_Slice');
            else playOnce(actor, 'Cheer');
          } else {
            playOnce(actor, 'Melee_Attack_Slice');
          }
        }
        if (target) {
          let floaterText = damage;
          let floaterStyle = 'dmg';
          if (miss) {
            floaterText = 'miss';
            floaterStyle = 'miss';
          } else if (heal) {
            floaterText = damage;
            floaterStyle = 'heal';
          } else if (magic) {
            floaterStyle = 'magic';
          } else if (crit) {
            floaterText = damage + '!';
            floaterStyle = 'crit';
          } else if (sleep) {
            floaterText = 'Sleep';
            floaterStyle = 'magic';
          } else if (buff) {
            floaterText = 'Buff';
            floaterStyle = 'heal';
          }
          if (target === S.player && !heal && !buff && !miss) {
            floaterStyle = 'dmg-in';
          }
          UI.floater(target, floaterText, floaterStyle);
          if (!miss && !heal && !buff) {
            target.hitFlash = 0.18;
            const color = magic ? 0x9b6cd6 : (crit ? 0xffea7a : 0xffffff);
            spawnBurst(target.mesh.position, color, crit ? 16 : 8, 1.2);
          }
        }
        const actorName = actor ? actor.name : (actorId || 'Someone');
        const targetName = target ? target.name : (targetId || 'something');
        if (miss) {
          UI.log(`${actorName} attacks ${targetName} but misses.`, 'cbt');
        } else if (heal) {
          const aName = actionId && ACTIONS[actionId] ? ACTIONS[actionId].name : 'Cure';
          UI.log(`${actorName} casts ${aName} on ${targetName} for ${damage} HP.`, 'heal');
        } else if (buff) {
          const aName = actionId && ACTIONS[actionId] ? ACTIONS[actionId].name : 'ability';
          UI.log(`${actorName} gains the effect of ${aName}.`, 'magic');
        } else if (sleep) {
          UI.log(`${actorName} casts Sleep on ${targetName}.`, 'magic');
        } else {
          const wsName = actionId && ACTIONS[actionId] ? ACTIONS[actionId].name : null;
          if (wsName) {
            UI.log(`${actorName} uses ${wsName} on ${targetName} for ${damage} damage.`, 'cbt');
          } else {
            UI.log(`${actorName} hits ${targetName} for ${damage} damage. ${crit ? '(Critical Hit!)' : ''}`, target === S.player ? 'dmg-in' : 'cbt');
          }
        }
      });
      Socket.on('visual:kill', ({ targetId }) => {
        const target = findActor(targetId);
        if (target) {
          target.alive = false;
          target.hp = 0;
          if (target.mixer) {
            target.oneShotAction = null;
            playOnce(target, 'Death_A', 0.15, false);
          } else if (target.mesh) {
            target.mesh.rotation.z = Math.PI / 2;
          }
          UI.log(`${target.name} is defeated.`, 'sys');
        }
      });
      Socket.on('visual:burst', ({ x, z, color, count, size }) => {
        spawnBurst(new THREE.Vector3(x, S.heightAt(x, z) + 0.5, z), color, count || 12, size || 1.5);
      });
      Socket.on('visual:floater', ({ targetId, text, style }) => {
        const actor = findActor(targetId);
        if (actor) {
          UI.floater(actor, text, style);
        }
      });
      Socket.on('visual:respawn', ({ x, z }) => {
        const p = S.player;
        if (p) {
          p.alive = true;
          p.hp = p.maxhp;
          p.mp = p.maxmp;
          p.mesh.rotation.z = 0;
          p.mesh.position.set(x, S.heightAt(x, z), z);
          p.pos.set(x, S.heightAt(x, z), z);
          if (p.mixer) {
            p.oneShotAction = null;
            p.curLoop = null;
          }
          for (const c of S.party) {
            if (c.kind === 'companion') {
              c.alive = true;
              c.hp = c.maxhp;
              c.mp = c.maxmp;
              c.mesh.rotation.z = 0;
              c.mesh.position.set(x + (Math.random() - 0.5) * 4, 0, z + (Math.random() - 0.5) * 4);
              c.mesh.position.y = S.heightAt(c.mesh.position.x, c.mesh.position.z);
              if (c.mixer) {
                c.oneShotAction = null;
                c.curLoop = null;
              }
            }
          }
          setTarget(null);
          UI.updateHUD();
          UI.initPartyFrames();
          UI.log('You have been revived.', 'sys');
        }
      });
    }).catch((e) => {
      console.warn('[socket] failed to connect:', e.message);
    });
  }
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

    const localSaved = loadGame();
    let cloudChar = null;
    let cloudActive = false;

    if (API.isEnabled()) {
      if (API.getToken()) {
        try { cloudChar = await API.fetchCharacter(); cloudActive = true; }
        catch (e) { API.clearToken(); }
      }
      if (!cloudActive) {
        const offline = await UI.loginScreen();
        if (!offline) {
          try { cloudChar = await API.fetchCharacter(); cloudActive = true; }
          catch (e) { API.clearToken(); }
        }
      }
    }

    const saved = cloudChar || (!cloudActive ? localSaved : null);
    UI.charCreate(saved, (fresh) => {
      if (fresh) startGame(fresh, null);
      else startGame(null, saved);
      if (cloudActive) saveGame({ force: true });
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
    Puppets.updatePuppets(dt);
    MonsterPuppets.updateMonsters(dt);
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
