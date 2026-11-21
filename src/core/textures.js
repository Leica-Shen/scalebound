import * as THREE from 'three';

function pixelGlow(size = 32, steps = 6) {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / (size * 0.5);
      let a = Math.max(0, 1 - d);
      a = Math.pow(a, 1.8);
      a = Math.round(a * steps) / steps;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function shadowTexture(size = 96, steps = 5) {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - c) / (size * 0.48);
      const ny = (y - c) / (size * 0.34);
      const d = Math.hypot(nx, ny);
      let a = Math.max(0, 1 - d);
      a = Math.pow(a, 1.4) * 0.75;
      a = Math.round(a * steps) / steps;
      const i = (y * size + x) * 4;
      data[i] = 4;
      data[i + 1] = 8;
      data[i + 2] = 7;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let _glow = null;
let _shadow = null;
export function getGlowTexture() {
  if (!_glow) _glow = pixelGlow(32, 6);
  return _glow;
}
export function getShadowTexture() {
  if (!_shadow) _shadow = shadowTexture();
  return _shadow;
}

// Small radiating burst sprite for soul halos.
export function getHaloTexture() {
  if (!_glow) _glow = pixelGlow(32, 6);
  return _glow;
}
