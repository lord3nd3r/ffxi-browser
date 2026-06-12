// Texture library: real CC0 PBR textures (ambientCG) for terrain and
// architecture, three.js water normals, plus painterly canvas foliage —
// the same trunk + alpha-card technique FFXI itself uses for trees.
import * as THREE from 'three';
import { S } from './state.js';

const textureLoader = new THREE.TextureLoader();
function loadTex(url, srgb = true) {
  const tex = textureLoader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  // sharp at grazing angles — the difference between mush and detail on the ground
  tex.anisotropy = S.renderer ? S.renderer.capabilities.getMaxAnisotropy() : 8;
  return tex;
}

// color map (sRGB); pass a repeat to tile
export function pbr(name, rx = 1, ry = rx) {
  const t = loadTex(`textures/pbr/${name}.jpg`);
  t.repeat.set(rx, ry);
  return t;
}
// normal map (linear)
export function pbrN(name, rx = 1, ry = rx) {
  const t = loadTex(`textures/pbr/${name}.jpg`, false);
  t.repeat.set(rx, ry);
  return t;
}

export function waterNormals() {
  return loadTex('textures/waternormals.jpg', false);
}

export function barkTexture() {
  return pbr('bark');
}

function canvas(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const R = (a, b) => a + Math.random() * (b - a);

// painterly broadleaf canopy: hundreds of leaf daubs with radial falloff
export function foliageSprite() {
  const tex = canvas(256, 256, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    const cxr = w / 2, cyr = h / 2;
    for (let i = 0; i < 520; i++) {
      const a = R(0, Math.PI * 2), r = Math.pow(Math.random(), 0.62) * 116;
      const x = cxr + Math.cos(a) * r, y = cyr + Math.sin(a) * r * 0.92;
      const edge = r / 116;
      // darker core, brighter sunlit edge
      const hue = R(88, 112), sat = R(34, 52), lit = 20 + edge * R(16, 26);
      cx.fillStyle = `hsla(${hue},${sat}%,${lit}%,${R(0.75, 0.95)})`;
      const s = R(4, 9) * (1 - edge * 0.35);
      cx.beginPath();
      cx.ellipse(x, y, s, s * R(0.55, 0.8), R(0, 3.2), 0, 7);
      cx.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// painterly conifer tier: drooping needle strokes in a triangular fan
export function pineSprite() {
  const tex = canvas(256, 256, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const t = Math.random();                       // 0 top, 1 bottom
      const y = 18 + t * 215;
      const half = 8 + t * 112;
      const x = w / 2 + R(-half, half);
      const hue = R(95, 130), lit = R(14, 30) + (1 - Math.abs(x - w / 2) / half) * 6;
      cx.strokeStyle = `hsla(${hue},${R(28, 44)}%,${lit}%,${R(0.7, 0.95)})`;
      cx.lineWidth = R(1.2, 2.4);
      cx.beginPath();
      cx.moveTo(x, y);
      cx.lineTo(x + R(-7, 7), y + R(6, 15));
      cx.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// palm frond: feathered painterly leaflets along a curved rib
export function frondSprite() {
  const tex = canvas(256, 128, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const t = i / 60;
      const x = 10 + t * 235, y = h / 2 + Math.sin(t * 2.4) * 8;
      const len = 26 * (1 - Math.abs(t - 0.45) * 1.1);
      for (const dir of [-1, 1]) {
        cx.strokeStyle = `hsla(${R(85, 110)},${R(38, 55)}%,${R(20, 34)}%,${R(0.75, 0.95)})`;
        cx.lineWidth = R(1.6, 3);
        cx.beginPath();
        cx.moveTo(x, y);
        cx.lineTo(x + R(4, 10), y + dir * len * R(0.7, 1));
        cx.stroke();
      }
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// striped canvas for market-stall awnings and tents
export function awningStripes(a = '#b03a30', b = '#e8e0d0') {
  return canvas(128, 128, (cx, w, h) => {
    for (let x = 0, i = 0; x < w; x += 16, i++) {
      cx.fillStyle = i % 2 ? b : a;
      cx.fillRect(x, 0, 16, h);
    }
    // cloth weave shading
    for (let i = 0; i < 300; i++) {
      cx.fillStyle = `rgba(0,0,0,${R(0.02, 0.07)})`;
      cx.fillRect(R(0, w), R(0, h), R(2, 8), 1.5);
    }
  });
}

// heraldic banner: deep red field, gold trim, white crystal sigil
export function bannerSprite() {
  const tex = canvas(64, 128, (cx, w, h) => {
    cx.fillStyle = '#8e2420';
    cx.fillRect(0, 0, w, h);
    cx.strokeStyle = '#d6af38';
    cx.lineWidth = 4;
    cx.strokeRect(3, 3, w - 6, h - 6);
    // crystal sigil
    cx.fillStyle = '#efe8f4';
    cx.beginPath();
    cx.moveTo(w / 2, 28); cx.lineTo(w / 2 + 14, 60); cx.lineTo(w / 2, 92); cx.lineTo(w / 2 - 14, 60);
    cx.closePath(); cx.fill();
    cx.fillStyle = 'rgba(120,150,230,0.55)';
    cx.beginPath();
    cx.moveTo(w / 2, 34); cx.lineTo(w / 2 + 9, 60); cx.lineTo(w / 2, 86); cx.lineTo(w / 2 - 9, 60);
    cx.closePath(); cx.fill();
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function cloudSprite() {
  return canvas(128, 64, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    for (const [x, y, r] of [[34, 38, 20], [60, 30, 26], [90, 38, 19], [50, 42, 18], [75, 44, 16]]) {
      const g = cx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = g;
      cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill();
    }
  });
}

export function glowSprite(inner = 'rgba(255,244,214,1)', outer = 'rgba(255,244,214,0)') {
  return canvas(128, 128, (cx, w, h) => {
    const g = cx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, inner);
    g.addColorStop(0.25, inner.replace(',1)', ',0.85)'));
    g.addColorStop(1, outer);
    cx.fillStyle = g;
    cx.fillRect(0, 0, w, h);
  });
}

export function grassBlades() {
  const tex = canvas(64, 64, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      const x = R(4, w - 4), top = R(4, 26), wd = R(2.5, 5);
      const hue = Math.floor(R(78, 102));
      cx.fillStyle = `hsl(${hue},45%,${Math.floor(R(28, 40))}%)`;
      cx.beginPath();
      cx.moveTo(x - wd, h);
      cx.quadraticCurveTo(x - wd * 0.3, top + 14, x + R(-3, 3), top);
      cx.quadraticCurveTo(x + wd * 0.4, top + 16, x + wd, h);
      cx.closePath(); cx.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
