// Input & camera: click-to-move, drag-orbit camera, L+R autorun, tab targeting,
// hotkeys, context menus. Classic FFXI feel.
import * as THREE from 'three';
import { S, clamp, lerp } from './state.js';
import { G, setTarget, tabTarget, requestInteract, useHotbarSlot } from './game.js';
import * as UI from './ui.js';

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downPos = null, downButton = -1, dragging = false;
let buttons = 0;
let lastClickT = 0, lastClickEnt = null;

function pickables() {
  const list = [];
  for (const m of S.monsters) if (m.alive && m.mesh.visible) list.push({ root: m.mesh, ent: m });
  for (const n of S.npcs) list.push({ root: n.mesh, ent: n });
  for (const c of S.party) if (c !== S.player) list.push({ root: c.mesh, ent: c });
  for (const nd of S.nodes) list.push({ root: nd.mesh, ent: { ...nd, isNode: true, mesh: nd.mesh, ref: nd } });
  if (S.crystal) list.push({ root: S.crystal, ent: { isCrystal: true, mesh: S.crystal, name: 'Home Point Crystal' } });
  return list;
}

function pickAt(cx, cy) {
  ndc.x = (cx / window.innerWidth) * 2 - 1;
  ndc.y = -(cy / window.innerHeight) * 2 + 1;
  ray.setFromCamera(ndc, S.camera);
  const cands = pickables();
  const roots = cands.map(c => c.root);
  const hits = ray.intersectObjects(roots, true);
  if (hits.length) {
    let obj = hits[0].object;
    while (obj) {
      const c = cands.find(c => c.root === obj);
      if (c) return { ent: c.ent, point: hits[0].point };
      obj = obj.parent;
    }
  }
  const ter = ray.intersectObject(S.terrain);
  if (ter.length) return { ground: ter[0].point };
  return null;
}

function conCheck(e) {
  if (e.kind !== 'monster') { UI.log(`${e.name} seems friendly.`, 'sys'); return; }
  const d = e.level - S.player.level;
  let msg, agg = e.def.aggressive ? ' It is aggressive.' : ' It does not seem aggressive.';
  if (e.def.boss) msg = 'is an impossibly tough opponent!';
  else if (d <= -4) msg = 'is too weak to be worthwhile.';
  else if (d <= -2) msg = 'is easy prey.';
  else if (d <= 1) msg = 'looks like an even match.';
  else if (d <= 3) msg = 'is a tough opponent.';
  else msg = 'is an incredibly tough opponent!';
  UI.log(`The ${e.name} ${msg}${agg}`, 'sys');
}

function openContext(e, x, y) {
  const items = [];
  if (e.kind === 'monster') {
    items.push({ label: 'Attack', fn: () => { setTarget(e); S.player.dest = { x: e.pos.x, z: e.pos.z }; } });
    items.push({ label: 'Check', fn: () => conCheck(e) });
  } else if (e.kind === 'npc') {
    items.push({ label: 'Talk', fn: () => requestInteract(e) });
    items.push({ label: 'Check', fn: () => conCheck(e) });
  } else if (e.isNode) {
    items.push({ label: e.type === 'logging' ? 'Chop' : e.type === 'mining' ? 'Mine' : 'Harvest', fn: () => requestInteract(e.ref ? { ...e.ref, isNode: true } : e) });
  } else if (e.isCrystal) {
    items.push({ label: 'Examine Crystal', fn: () => requestInteract(e) });
  } else if (e.kind === 'companion') {
    items.push({ label: 'Check', fn: () => UI.log(`${e.name}: Lv.${e.level} — a trusty companion.`, 'sys') });
  }
  items.push({ label: 'Cancel', fn: () => {} });
  UI.showCtxMenu(x, y, items);
}

export function initControls(dom) {
  dom.addEventListener('contextmenu', e => e.preventDefault());

  dom.addEventListener('pointerdown', e => {
    if (S.uiOpen) return;
    buttons = e.buttons;
    downPos = { x: e.clientX, y: e.clientY };
    downButton = e.button;
    dragging = false;
    S.autoRun = (buttons & 3) === 3;
    UI.hideCtxMenu();
  });

  dom.addEventListener('pointermove', e => {
    S.mouse.x = e.clientX; S.mouse.y = e.clientY;
    if (downPos && (Math.abs(e.clientX - downPos.x) > 5 || Math.abs(e.clientY - downPos.y) > 5)) dragging = true;
    if (downPos && dragging && (buttons & 2 || buttons & 1)) {
      S.camYaw -= e.movementX * 0.0055;
      S.camPitch = clamp(S.camPitch + e.movementY * 0.004, -0.15, 1.25);
    }
  });

  window.addEventListener('pointerup', e => {
    buttons = e.buttons;
    S.autoRun = (buttons & 3) === 3;
    if (!downPos) return;
    const wasDrag = dragging;
    const btn = downButton;
    downPos = null;
    if (wasDrag || S.uiOpen) return;

    const hit = pickAt(e.clientX, e.clientY);
    if (!hit) return;
    if (btn === 0) {
      if (hit.ent) {
        const ent = hit.ent;
        if (ent.kind) setTarget(ent.kind === 'monster' || ent.kind === 'npc' || ent.kind === 'companion' ? ent : null);
        // double click: interact / attack-move
        const now = performance.now();
        if (lastClickEnt === (ent.ref || ent.id || ent) || (ent.id && lastClickEnt === ent.id)) {
          if (now - lastClickT < 400) {
            if (ent.kind === 'npc' || ent.isNode || ent.isCrystal) requestInteract(ent.isNode ? { ...ent.ref, isNode: true, mesh: ent.mesh } : ent);
            else if (ent.kind === 'monster') S.player.dest = { x: ent.pos.x, z: ent.pos.z };
          }
        }
        // single click on interactables when already close: just do it
        if (ent.isNode || ent.isCrystal || ent.kind === 'npc') {
          const d = Math.hypot(S.player.pos.x - ent.mesh.position.x, S.player.pos.z - ent.mesh.position.z);
          if (d < 3.5) requestInteract(ent.isNode ? { ...ent.ref, isNode: true, mesh: ent.mesh } : ent);
        }
        lastClickT = now;
        lastClickEnt = ent.ref || ent.id || ent;
      } else if (hit.ground) {
        S.player.dest = { x: hit.ground.x, z: hit.ground.z };
        G.destMarker.visible = true;
        G.destMarker.position.set(hit.ground.x, S.heightAt(hit.ground.x, hit.ground.z) + 0.08, hit.ground.z);
      }
    } else if (btn === 2 && hit.ent) {
      const ent = hit.ent;
      if (ent.kind === 'monster' || ent.kind === 'npc' || ent.kind === 'companion') setTarget(ent);
      openContext(ent, e.clientX, e.clientY);
    }
  });

  dom.addEventListener('wheel', e => {
    if (S.uiOpen) return;
    S.camDist = clamp(S.camDist + e.deltaY * 0.01, 1.2, 20);
    S.firstPerson = S.camDist <= 1.4;
  }, { passive: true });

  window.addEventListener('keydown', e => {
    if (S.chatOpen) {
      if (e.code === 'Enter') UI.submitChat();
      if (e.code === 'Escape') UI.closeChat();
      return;
    }
    S.keys[e.code] = true;
    if (e.code === 'Tab') { e.preventDefault(); tabTarget(); }
    else if (e.code === 'Escape') {
      if (S.uiOpen) UI.closeDialog();
      else if (S.player.casting && !S.player.casting.gather) { S.player.casting = null; UI.hideCastbar(); UI.log('Casting canceled.', 'sys'); }
      else setTarget(null);
      UI.hideCtxMenu();
    }
    else if (e.code === 'Enter') { if (!S.uiOpen) UI.openChat(); }
    else if (e.code === 'KeyF') { S.firstPerson = !S.firstPerson; if (!S.firstPerson) S.camDist = Math.max(S.camDist, 6); }
    else if (e.code === 'KeyI') UI.openInventory();
    else if (e.code === 'KeyM') UI.openSpellbook();
    else if (e.code === 'KeyH') UI.toggleHint();
    else if (e.shiftKey && e.code === 'Slash') UI.openHelp();
    else if (/^Digit\d$/.test(e.code)) {
      const n = parseInt(e.code.slice(5));
      useHotbarSlot(n === 0 ? 9 : n - 1);
    }
  });
  window.addEventListener('keyup', e => { S.keys[e.code] = false; });
  window.addEventListener('blur', () => { S.keys = {}; S.autoRun = false; });
}

const camPos = new THREE.Vector3();
export function updateCamera(dt) {
  const p = S.player;
  if (!p || !p.mesh) return;
  const head = new THREE.Vector3(p.pos.x, p.pos.y + 1.65, p.pos.z);

  if (S.firstPerson) {
    p.mesh.visible = false;
    const look = new THREE.Vector3(
      head.x - Math.sin(S.camYaw) * Math.cos(S.camPitch),
      head.y - Math.sin(S.camPitch) + 0.0,
      head.z - Math.cos(S.camYaw) * Math.cos(S.camPitch),
    );
    S.camera.position.copy(head);
    S.camera.lookAt(look);
    return;
  }
  p.mesh.visible = true;

  const d = S.camDist;
  camPos.set(
    p.pos.x + Math.sin(S.camYaw) * Math.cos(S.camPitch) * d,
    p.pos.y + 1.2 + Math.sin(S.camPitch) * d,
    p.pos.z + Math.cos(S.camYaw) * Math.cos(S.camPitch) * d,
  );
  // keep camera above terrain
  const ground = S.heightAt(camPos.x, camPos.z) + 0.6;
  if (camPos.y < ground) camPos.y = ground;

  S.camera.position.lerp(camPos, Math.min(1, dt * 9));
  S.camera.lookAt(p.pos.x, p.pos.y + 1.4, p.pos.z);
}
