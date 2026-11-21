import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, slopeAt, moistureAt, SEA_LEVEL } from '../core/terrain.js';
import { mulberry32 } from '../core/noise.js';

const _c = new THREE.Color();

const STONE = {
  base: '#777566', dark: '#4d5048', light: '#9a9482', moss: '#59674e',
  banner: '#813b32', banner2: '#c69b56', fire: '#ffb052', char: '#3b342e',
};

function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
function stoneBox(w, h, d, x, y, z, color = STONE.base, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z);
  return paint(g, color);
}
function stoneCylinder(rt, rb, h, x, y, z, color = STONE.base, sides = 8) {
  const g = new THREE.CylinderGeometry(rt, rb, h, sides, 1);
  g.translate(x, y, z);
  return paint(g, color);
}
function stoneCone(r, h, x, y, z, color = STONE.dark, sides = 6) {
  const g = new THREE.ConeGeometry(r, h, sides, 1);
  g.translate(x, y, z);
  return paint(g, color);
}

function makeWatchtower(rng, scale = 1) {
  const g = [];
  const s = scale;
  // foundation and platform
  g.push(stoneBox(4.6 * s, 1.2 * s, 4.6 * s, 0, 0.6 * s, 0, STONE.dark));
  g.push(stoneBox(3.9 * s, 0.6 * s, 3.9 * s, 0, 1.4 * s, 0, STONE.light));
  // main shaft
  for (let i = 0; i < 3; i++) {
    const y = (2.0 + i * 2.2) * s;
    const w = (3.0 - i * 0.25) * s;
    g.push(stoneBox(w, 2.2 * s, w, 0, y, 0, i % 2 ? STONE.base : STONE.light));
    // stone banding
    g.push(stoneBox(w * 1.04, 0.16 * s, w * 1.04, 0, y + 1.0 * s, 0, STONE.dark));
    // arrow slit
    g.push(stoneBox(0.22 * s, 0.7 * s, 0.2 * s, 0, y, w * 0.5, STONE.char));
    g.push(stoneBox(0.2 * s, 0.7 * s, 0.22 * s, w * 0.5, y, 0, STONE.char));
  }
  const topY = 8.1 * s;
  // crenellated crown
  const size = 2.9 * s;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.push(stoneBox(0.7 * s, 0.9 * s, 0.55 * s, Math.cos(a) * size * 0.48, topY + 0.45 * s, Math.sin(a) * size * 0.48, STONE.base, -a));
  }
  g.push(stoneBox(3.2 * s, 0.35 * s, 3.2 * s, 0, topY, 0, STONE.dark));
  // broken corner + rubble
  g.push(stoneBox(1.3 * s, 1.0 * s, 1.2 * s, 1.3 * s, 1.8 * s, 1.7 * s, STONE.dark, 0.3, 0.2));
  // doorway
  g.push(stoneBox(1.1 * s, 2.0 * s, 0.24 * s, 0, 2.1 * s, 2.0 * s, STONE.char));
  // wall stub
  for (let i = 0; i < 3; i++) {
    g.push(stoneBox(2.8 * s, (1.6 + i * 0.7) * s, 0.75 * s, (-2.7 - i * 2.4) * s, 0.8 + i * 0.35, 0.4 * s, i % 2 ? STONE.base : STONE.dark, 0.1 * i));
  }
  for (let i = 0; i < 5; i++) {
    const a = rng() * 6.28;
    const r = (2.5 + rng() * 3.5) * s;
    g.push(stoneBox((0.5 + rng() * 0.8) * s, (0.4 + rng() * 0.8) * s, (0.5 + rng() * 0.8) * s, Math.cos(a) * r, 0.4, Math.sin(a) * r, rng() > 0.5 ? STONE.base : STONE.dark, rng() * 3));
  }
  // banner poles and tattered cloth
  for (const side of [-1, 1]) {
    const px = side * 1.8 * s;
    g.push(stoneBox(0.1 * s, 4.0 * s, 0.1 * s, px, topY + 2.2 * s, 0.2 * s, '#4a3828'));
    g.push(stoneBox(1.1 * s, 1.5 * s, 0.05 * s, px + side * 0.5 * s, topY + 3.4 * s, 0.2 * s, side > 0 ? STONE.banner : STONE.banner2));
  }
  // brazier
  g.push(stoneBox(0.7 * s, 0.4 * s, 0.7 * s, -1.2 * s, topY + 0.3 * s, 1.2 * s, STONE.dark));
  g.push(stoneBox(0.4 * s, 0.2 * s, 0.4 * s, -1.2 * s, topY + 0.6 * s, 1.2 * s, STONE.fire));
  return mergeGeometries(g, false);
}

function makeGate(rng, scale = 1) {
  const g = [];
  const s = scale;
  g.push(stoneBox(6.5 * s, 0.7 * s, 3.2 * s, 0, 0.35 * s, 0, STONE.dark));
  for (const side of [-1, 1]) {
    g.push(stoneBox(1.5 * s, 5.4 * s, 2.4 * s, side * 3.1 * s, 2.7 * s, 0, side < 0 ? STONE.base : STONE.light));
    for (let i = 0; i < 3; i++) g.push(stoneBox(0.32 * s, 0.7 * s, 0.25 * s, side * 3.1 * s, (2.0 + i * 1.1) * s, 1.24 * s, STONE.char));
    g.push(stoneBox(0.8 * s, 1.2 * s, 1.0 * s, side * 3.1 * s, 5.4 * s, 0.3 * s, STONE.dark, 0, side * 0.15));
  }
  // lintel and arch pieces
  g.push(stoneBox(8.4 * s, 1.0 * s, 2.5 * s, 0, 5.2 * s, 0, STONE.base));
  g.push(stoneBox(3.4 * s, 0.8 * s, 0.8 * s, 1.5 * s, 5.8 * s, 0.6 * s, STONE.light, 0, 0.15));
  g.push(stoneBox(2.2 * s, 0.7 * s, 0.7 * s, -1.2 * s, 6.1 * s, 0.5 * s, STONE.dark, 0, -0.25));
  // side wall
  for (let i = 0; i < 4; i++) {
    g.push(stoneBox(2.2 * s, (1.2 + i * 0.35) * s, 0.7 * s, (4.8 + i * 2.1) * s, 0.6 + i * 0.18, -0.2 * s, i % 2 ? STONE.base : STONE.dark));
  }
  for (let i = 0; i < 7; i++) {
    const a = rng() * 6.28; const r = (2 + rng() * 5) * s;
    g.push(stoneBox((0.4 + rng() * 0.8) * s, (0.3 + rng() * 0.6) * s, (0.4 + rng() * 0.8) * s, Math.cos(a) * r, 0.25, Math.sin(a) * r, rng() > 0.5 ? STONE.base : STONE.light, rng() * 3));
  }
  return mergeGeometries(g, false);
}

function makeFort(rng, scale = 1) {
  const g = [];
  const s = scale;
  g.push(stoneBox(9.5 * s, 0.8 * s, 8.2 * s, 0, 0.4 * s, 0, STONE.dark));
  const corner = 4.0 * s;
  for (const x of [-corner, corner]) for (const z of [-3.3 * s, 3.3 * s]) {
    for (let i = 0; i < 3; i++) g.push(stoneBox((1.5 - i * 0.1) * s, 2.0 * s, (1.5 - i * 0.1) * s, x, 1.8 + i * 1.9, z, i % 2 ? STONE.base : STONE.light));
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * 6.28;
      g.push(stoneBox(0.5 * s, 0.75 * s, 0.4 * s, x + Math.cos(a) * 0.7 * s, 7.9, z + Math.sin(a) * 0.7 * s, STONE.dark, -a));
    }
  }
  // walls
  for (const z of [-3.4 * s, 3.4 * s]) for (let i = 0; i < 4; i++) {
    g.push(stoneBox(2.0 * s, (1.4 + rng() * 0.8) * s, 0.65 * s, (-3 + i * 2.0) * s, 1.0, z, i % 2 ? STONE.base : STONE.dark));
  }
  for (let i = 0; i < 8; i++) {
    const a = rng() * 6.28; const r = (3 + rng() * 6) * s;
    g.push(stoneBox((0.5 + rng() * 1.0) * s, (0.4 + rng() * 0.8) * s, (0.5 + rng() * 1.0) * s, Math.cos(a) * r, 0.3, Math.sin(a) * r, rng() > 0.5 ? STONE.base : STONE.dark, rng() * 3));
  }
  return mergeGeometries(g, false);
}

export class StructureField {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'stone-ruins';
    scene.add(this.group);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: true });
    this.entries = [];
    this.center = new THREE.Vector3(Infinity, 0, Infinity);
    this.seed = 8817;
    this.builtLandmark = false;
    this.smokeTimer = 0;
  }

  clear() {
    if (this.world?.structureClearings) this.world.structureClearings.length = 0;
    for (const e of this.entries) {
      this.group.remove(e.mesh);
      e.mesh.geometry.dispose();
    }
    this.entries.length = 0;
  }

  _addAt(x, z, type, scale, rot) {
    const rng = mulberry32(((x * 13.7 + z * 71.3 + this.seed) * 1e6) >>> 0);
    let geo;
    if (type === 'gate') geo = makeGate(rng, scale);
    else if (type === 'fort') geo = makeFort(rng, scale);
    else geo = makeWatchtower(rng, scale);
    const mesh = new THREE.Mesh(geo, this.material);
    const y = heightAt(x, z);
    mesh.position.set(x, y - 0.25, z);
    mesh.rotation.y = rot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.entries.push({ mesh, x, z, type, top: y + (type === 'gate' ? 7 : 11) * scale });
    if (this.world?.structureClearings) {
      this.world.structureClearings.push({ x, z, r: (type === 'fort' ? 18 : 14) * scale });
    }
  }

  update(focusPos, camera = null) {
    if (!Number.isFinite(this.center.x) || this.center.distanceToSquared(focusPos) > 780 * 780) {
      this.center.copy(focusPos);
      this.clear();
      this._generate(focusPos, camera);
    }
  }

  _validSpot(x, z, minH = 4, maxH = 68) {
    const h = heightAt(x, z);
    if (h < minH || h > maxH) return false;
    if (h < SEA_LEVEL + 1.5) return false;
    if (slopeAt(x, z, 12) > 0.58) return false;
    return true;
  }

  _generate(center, camera = null) {
    // Landmark watchtower near the opening vista: always visible if terrain allows.
    let landmark = null;
    for (let ring = 0; ring < 8 && !landmark; ring++) {
      const r = 70 + ring * 24;
      const baseA = camera ? Math.atan2(center.z - camera.position.z, center.x - camera.position.x) : 0.4;
      for (let i = 0; i < 14; i++) {
        const a = baseA + (i / 14 - 0.5) * Math.PI * 1.1 + ring * 0.11;
        const x = center.x + Math.cos(a) * r;
        const z = center.z + Math.sin(a) * r;
        if (this._validSpot(x, z, 8, 48) && moistureAt(x, z) > -0.32) { landmark = { x, z }; break; }
      }
    }
    if (landmark) this._addAt(landmark.x, landmark.z, 'watchtower', 1.8, 0.6);
    this.builtLandmark = true;

    // Sparse ruins across the local landscape, on a deterministic grid.
    const cell = 520;
    const cx = Math.floor(center.x / cell);
    const cz = Math.floor(center.z / cell);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (dx === 0 && dz === 0) continue;
        const seed = ((gx * 928371 + gz * 19349 + this.seed) >>> 0);
        const h = (seed ^ (seed >>> 13)) >>> 0;
        if ((h % 100) > 34) continue;
        const rng = mulberry32(h);
        let spot = null;
        for (let k = 0; k < 12; k++) {
          const x = gx * cell + cell * (0.15 + rng() * 0.7);
          const z = gz * cell + cell * (0.15 + rng() * 0.7);
          if (this._validSpot(x, z)) { spot = { x, z }; break; }
        }
        if (!spot) continue;
        const type = (h % 7 === 0) ? 'gate' : (h % 5 === 0 ? 'fort' : 'watchtower');
        const scale = (type === 'fort' ? 0.7 : 0.78) + rng() * 0.32;
        if (this.entries.length >= 9) break;
        this._addAt(spot.x, spot.z, type, scale, rng() * 6.28);
      }
    }
    if (this.entries.length && this.world?._rebuildPropsNow) {
      this.world.propsDirty = true;
      this.world.lastPropsBuild = -1;
      this.world._rebuildPropsNow();
    }
  }

  updateSmoke(dt, time) {
    if (!this.entries.length || !this.world?.effects) return;
    this.smokeTimer -= dt;
    if (this.smokeTimer > 0) return;
    this.smokeTimer = 0.22;
    for (const e of this.entries) {
      if (!e.top) continue;
      const x = e.x + (Math.random() - 0.5) * 1.2;
      const z = e.z + (Math.random() - 0.5) * 1.2;
      this.world.effects.emit(
        x, e.top + 2.0, z,
        (Math.random() - 0.5) * 0.35, 0.9 + Math.random() * 1.2, (Math.random() - 0.5) * 0.35,
        Math.random() < 0.22 ? '#ffc16b' : '#58615c',
        0.3 + Math.random() * 0.28, 1.8 + Math.random() * 1.4, 0.4, 0.7,
      );
    }
  }
}
