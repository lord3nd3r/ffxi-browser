// Shared FFXI-era look: soft wrap shading, blob shadows, grade, target cursor.
// Procedural only — no new texture downloads.
import * as THREE from 'three';
import { ShaderChunk } from 'three';

const WRAP_CHUNK = ShaderChunk.lights_physical_pars_fragment.replace(
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) * 0.8 + 0.2 );',
);

// Matte painted miniatures. Specular, metal, clearcoat and normal maps are
// what made the scene read as glossy plastic, and they are expensive.
// Safe to call more than once.
export function painterlyStandard(mat) {
  const list = Array.isArray(mat) ? mat : [mat];
  for (const m of list) {
    if (!m || !m.isMeshStandardMaterial) continue;
    // Clones copy userData but not onBeforeCompile, so a flagged clone still
    // needs the shader hooks (hit-flash materials are cloned per actor).
    if (m.userData.painterly && Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile')) continue;
    m.userData.painterly = true;
    m.metalness = 0;
    m.metalnessMap = null;
    m.roughness = 1;
    m.roughnessMap = null;
    m.envMapIntensity = 0;
    m.envMap = null;
    m.normalMap = null;
    if ('clearcoat' in m) m.clearcoat = 0;
    if ('sheen' in m) m.sheen = 0;
    if ('transmission' in m) m.transmission = 0;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader) => {
      if (prev && prev !== m.onBeforeCompile) prev(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <lights_physical_pars_fragment>', WRAP_CHUNK)
        .replace(
          'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
          `totalSpecular *= 0.02;
	totalDiffuse = mix(vec3(dot(totalDiffuse, vec3(0.3, 0.59, 0.11))), totalDiffuse, 1.22);
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;`,
        );
    };
    m.customProgramCacheKey = () => m.userData.shaderKey || 'vana-matte-v3';
    m.needsUpdate = true;
  }
  return mat;
}

// Shared clock for foliage sway. Updated from the day cycle.
export const windUniform = { value: 0 };

export function attachWind(mat) {
  if (!mat || mat.userData.wind) return mat;
  mat.userData.wind = true;
  mat.userData.shaderKey = 'vana-leaf-wind-v1';
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uTime = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
	float sway = sin(uTime * 1.25 + position.x * 1.6 + position.z * 0.7) * 0.04;
	transformed.x += sway * (position.y + 0.35);
	transformed.z += cos(uTime * 0.9 + position.y) * 0.018;`,
      );
  };
  return mat;
}

export const VanaGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    warmth: { value: 0.18 },
    dusk: { value: 0 },
    night: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float warmth;
    uniform float dusk;
    uniform float night;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 0.86);
      c = pow(max(c, 0.0), vec3(0.94));
      vec3 warmTint = vec3(1.06, 1.02, 0.94);
      vec3 duskTint = vec3(1.12, 0.94, 0.82);
      vec3 nightTint = vec3(0.78, 0.84, 1.08);
      c *= mix(warmTint, duskTint, clamp(dusk, 0.0, 1.0));
      c = mix(c, c * nightTint, clamp(night, 0.0, 1.0));
      c *= mix(vec3(1.0), vec3(1.04, 1.01, 0.96), clamp(warmth, 0.0, 1.0));
      float v = smoothstep(1.05, 0.28, length(vUv - 0.5));
      c *= mix(0.82, 1.0, v);
      gl_FragColor = vec4(c, src.a);
    }
  `,
};

// ---------- blob shadows (the FFXI contact shadow) ----------
const blobs = [];
const _inv = new THREE.Quaternion();
const _flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const _up = new THREE.Vector3();
let blobGeo = null;
let blobMat = null;

function blobResources() {
  if (blobMat) return;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  g.addColorStop(0, 'rgba(20,16,10,0.55)');
  g.addColorStop(0.45, 'rgba(20,16,10,0.32)');
  g.addColorStop(1, 'rgba(20,16,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  blobGeo = new THREE.CircleGeometry(1, 20);
  blobGeo.userData.keep = true;
  blobMat = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c),
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
  });
  blobMat.userData.shared = true;
}

export function attachBlob(object3d, radius = 0.62) {
  blobResources();
  const blob = new THREE.Mesh(blobGeo, blobMat);
  const s = Math.abs(object3d.scale.x) || 1;
  blob.scale.setScalar(radius / s);
  blob.name = 'blobShadow';
  blob.renderOrder = 2;
  blob.frustumCulled = false;
  object3d.add(blob);
  blobs.push(blob);
  return blob;
}

export function updateBlobs() {
  for (let i = blobs.length - 1; i >= 0; i--) {
    const b = blobs[i];
    if (!b.parent) { blobs.splice(i, 1); continue; }
    b.parent.updateWorldMatrix(true, false);
    b.parent.getWorldQuaternion(_inv);
    _inv.invert();
    b.quaternion.copy(_inv).multiply(_flat);
    const sy = Math.abs(b.parent.scale.y) || 1;
    _up.set(0, 0.045 / sy, 0).applyQuaternion(_inv);
    b.position.copy(_up);
    b.visible = b.parent.visible;
  }
}

// White so MeshBasicMaterial.color can tint enemy / NPC / PC.
export function targetCursorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(128, 128, 96, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(128, 128, 74, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate((i * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(0, -118);
    ctx.lineTo(16, -92);
    ctx.lineTo(-16, -92);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(128, 128, 58, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
