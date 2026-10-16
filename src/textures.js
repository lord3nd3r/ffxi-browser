// Texture library: real CC0 PBR textures (ambientCG) for terrain and
// architecture, three.js water normals, plus painterly canvas foliage —
// the same trunk + alpha-card technique FFXI itself uses for trees.
import * as THREE from 'three';
import { quality } from './quality.js';

const textureLoader = new THREE.TextureLoader();
function loadTex(url, srgb = true) {
  const tex = textureLoader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = quality().anisotropy;
  return tex;
}

// color map (sRGB); pass a repeat to tile
export function pbr(name, rx = 1, ry = rx) {
  const t = loadTex(`textures/pbr/${name}.jpg?v=painted2`);
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

// Broad painted leaves in a clump. Large shapes stay readable after mipmapping,
// which the old stipple of tiny dots did not.
export function foliageSprite() {
  const tex = canvas(256, 256, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    const leaves = [
      [128, 150, 70, 46, 0.4, '#6f9a32'],
      [90, 120, 54, 34, -0.6, '#8fb84a'],
      [168, 118, 58, 36, 0.7, '#c6d86a'],
      [120, 86, 48, 30, -0.2, '#4f7a28'],
      [150, 168, 44, 28, 0.9, '#d5e48a'],
      [78, 168, 40, 26, 0.3, '#7aa43c'],
      [180, 170, 36, 24, -0.8, '#9cba48'],
      [128, 118, 36, 50, 1.2, '#5e882c'],
    ];
    for (const [x, y, rx, ry, rot, col] of leaves) {
      cx.save();
      cx.translate(x, y);
      cx.rotate(rot);
      cx.fillStyle = col;
      cx.beginPath();
      cx.ellipse(0, 0, rx, ry, 0, 0, 7);
      cx.fill();
      cx.strokeStyle = 'rgba(40,60,16,0.45)';
      cx.lineWidth = 2;
      cx.beginPath();
      cx.moveTo(0, ry * 0.7);
      cx.lineTo(0, -ry * 0.75);
      cx.stroke();
      cx.restore();
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// painterly conifer tier: drooping needle strokes in a triangular fan
export function pineSprite() {
  const tex = canvas(256, 256, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    const cols = ['#2f6a34', '#4e8a40', '#1f4e28', '#6aa04a', '#3d7840'];
    for (let i = 0; i < 90; i++) {
      const t = Math.random();
      const y = 16 + t * 220;
      const half = 10 + t * 108;
      const x = w / 2 + R(-half, half);
      cx.strokeStyle = cols[i % cols.length];
      cx.lineWidth = R(2.5, 5);
      cx.lineCap = 'round';
      cx.beginPath();
      cx.moveTo(x, y);
      cx.lineTo(x + R(-10, 10), y + R(10, 22));
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
    const cols = ['#d5e07a', '#8aaa3c', '#f0eca0', '#5e8428', '#c6d460'];
    for (let i = 0; i < 7; i++) {
      const x = 8 + i * 8, top = R(2, 14), wd = R(3, 5.5);
      cx.fillStyle = cols[i % cols.length];
      cx.beginPath();
      cx.moveTo(x - wd, h);
      cx.quadraticCurveTo(x - wd * 0.2, top + 16, x + R(-2, 2), top);
      cx.quadraticCurveTo(x + wd * 0.3, top + 18, x + wd, h);
      cx.closePath(); cx.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
