import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, moistureAt, slopeAt, SEA_LEVEL } from '../core/terrain.js';
import { mulberry32, clamp } from '../core/noise.js';

const _obj = new THREE.Object3D();
const _wing = new THREE.Object3D();
const _m = new THREE.Matrix4();
const _color = new THREE.Color();
const _vec = new THREE.Vector3();

const FISH_COLORS = ['#7fb7a8', '#d9a05b', '#8c9fb1', '#d77f6d', '#96c6a3', '#c7b26b'];
const BIRD_COLORS = ['#e6e0cf', '#6f7f86', '#c18a55', '#ccd6d4', '#8b6e5a'];
const SHEEP_COLORS = ['#e8e0cc', '#d8cebb', '#c7bca6', '#e2d6bf'];

function colorGeometry(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const count = g.attributes.position.count;
  const arr = new Float32Array(count * 3);
  _color.set(hex);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = _color.r;
    arr[i * 3 + 1] = _color.g;
    arr[i * 3 + 2] = _color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function boxPart(w, h, d, x, y, z, hex, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  g.translate(x, y, z);
  return colorGeometry(g, hex);
}

function triPart(vertices, hex) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.computeVertexNormals();
  return colorGeometry(g, hex);
}

function buildFishGeometry() {
  const parts = [];
  parts.push(boxPart(0.55, 0.42, 1.25, 0, 0, 0, '#e5e0c8'));
  parts.push(boxPart(0.42, 0.28, 0.5, 0, 0.02, 0.82, '#d9a05b'));
  parts.push(boxPart(0.5, 0.11, 0.9, 0, -0.2, 0.08, '#f3e7c8'));
  // tail fan
  parts.push(triPart([
    0, 0, -0.62, 0.42, 0.02, -1.22, 0, 0, -1.36,
    -0.42, 0.02, -1.22, 0, 0, -0.62, 0, 0, -1.36,
  ], '#c88a57'));
  // dorsal fin
  parts.push(triPart([
    0, 0.18, -0.12, 0, 0.62, -0.48, 0, 0.16, -0.7,
  ], '#e6b86c'));
  // side fins
  parts.push(triPart([0.23, -0.03, 0.25, 0.7, -0.14, -0.12, 0.25, -0.1, -0.1], '#e0c08e'));
  parts.push(triPart([-0.23, -0.03, 0.25, -0.7, -0.14, -0.12, -0.25, -0.1, -0.1], '#e0c08e'));
  return mergeGeometries(parts, false);
}

function buildBirdGeometry() {
  const parts = [];
  parts.push(boxPart(0.28, 0.26, 0.72, 0, 0, 0, '#d9d2c0'));
  parts.push(boxPart(0.23, 0.23, 0.28, 0, 0.06, 0.48, '#7f8a88'));
  parts.push(triPart([0, 0.02, 0.62, 0.08, 0, 0.88, -0.08, 0, 0.88], '#d9a252'));
  parts.push(triPart([0, 0.08, -0.32, 0.3, 0.02, -0.78, 0, 0.04, -0.92], '#aaa497'));
  parts.push(triPart([0, 0.08, -0.32, -0.3, 0.02, -0.78, 0, 0.04, -0.92], '#aaa497'));
  return mergeGeometries(parts, false);
}

function buildWingGeometry() {
  // A flat low-poly wing; mirrored by a negative x scale for the far wing.
  return triPart([
    0.0, 0, 0.26, 1.85, 0.02, -0.12, 0.35, 0, -0.66,
    0.0, 0, 0.26, 0.35, 0, -0.66, 0.0, 0, -0.2,
    0.0, 0, 0.0, 1.5, 0.01, 0.1, 0.55, 0, -0.4,
  ], '#e7dfcb');
}

function buildSheepGeometry() {
  const parts = [];
  parts.push(boxPart(0.92, 0.7, 1.35, 0, 0.42, 0, '#e5deca'));
  parts.push(boxPart(0.38, 0.38, 0.5, 0, 0.43, 0.83, '#777064'));
  parts.push(boxPart(0.12, 0.1, 0.18, -0.23, 0.5, 1.05, '#cbbd9f'));
  parts.push(boxPart(0.12, 0.1, 0.18, 0.23, 0.5, 1.05, '#cbbd9f'));
  parts.push(boxPart(0.09, 0.4, 0.11, -0.3, 0.12, 0.4, '#6d6254'));
  parts.push(boxPart(0.09, 0.4, 0.11, 0.3, 0.12, 0.4, '#6d6254'));
  parts.push(boxPart(0.09, 0.4, 0.11, -0.3, 0.12, -0.4, '#6d6254'));
  parts.push(boxPart(0.09, 0.4, 0.11, 0.3, 0.12, -0.4, '#6d6254'));
  parts.push(boxPart(0.16, 0.1, 0.1, 0, 0.23, -0.66, '#6d6254'));
  // fat tail
  parts.push(boxPart(0.22, 0.24, 0.28, 0, 0.35, -0.72, '#d1c8b5'));
  // curled horns
  parts.push(triPart([-0.15, 0.63, 0.88, -0.38, 0.74, 0.78, -0.28, 0.56, 0.72], '#a99a80'));
  parts.push(triPart([0.15, 0.63, 0.88, 0.38, 0.74, 0.78, 0.28, 0.56, 0.72], '#a99a80'));
  return mergeGeometries(parts, false);
}

export class Wildlife {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.center = new THREE.Vector3(Infinity, 0, Infinity);
    this.lastPopulate = -10;
    this.seed = 0;
    this.counts = { fish: 0, birds: 0, sheep: 0 };

    this.fishMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: true, side: THREE.DoubleSide });
    this.birdMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: true, side: THREE.DoubleSide });
    this.wingMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: true, side: THREE.DoubleSide, transparent: true, opacity: 0.96 });
    this.sheepMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: true });

    this.fish = new THREE.InstancedMesh(buildFishGeometry(), this.fishMat, 80);
    this.birdBody = new THREE.InstancedMesh(buildBirdGeometry(), this.birdMat, 40);
    this.birdWings = new THREE.InstancedMesh(buildWingGeometry(), this.wingMat, 80);
    this.sheep = new THREE.InstancedMesh(buildSheepGeometry(), this.sheepMat, 34);
    this.meshes = [this.fish, this.birdBody, this.birdWings, this.sheep];
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    this.fish.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(80 * 3), 3);
    this.birdBody.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(40 * 3), 3);
    this.birdWings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(80 * 3), 3);
    this.sheep.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(34 * 3), 3);
    for (const m of this.meshes) if (m.instanceColor) m.instanceColor.setUsage(THREE.DynamicDrawUsage);

    this.animals = [];
    this.nextId = 1;
    this.stats = { caught: 0 };
  }

  setVisible(visible) {
    for (const m of this.meshes) m.visible = visible;
    if (!visible) return;
    this.syncCounts();
  }

  syncCounts() {
    this.fish.count = this.counts.fish;
    this.birdBody.count = this.counts.birds;
    this.birdWings.count = this.counts.birds * 2;
    this.sheep.count = this.counts.sheep;
  }

  clear() {
    this.animals.length = 0;
    this.counts = { fish: 0, birds: 0, sheep: 0 };
    this.syncCounts();
  }

  reset(playerPos) {
    this.center.copy(playerPos);
    this.lastPopulate = this.time;
    this.clear();
    this._populate();
  }

  _makeFish(x, y, z, i) {
    const rng = (this._rng = this._rng || mulberry32(1));
    return {
      id: this.nextId++, type: 'fish', name: '游鱼', idx: this.counts.fish++,
      alive: true, home: new THREE.Vector3(x, y, z), pos: new THREE.Vector3(x, y, z),
      phase: rng() * Math.PI * 2, radius: 3 + rng() * 8, speed: 0.18 + rng() * 0.22,
      angle: rng() * Math.PI * 2, scale: 0.95 + rng() * 0.85,
      tint: FISH_COLORS[Math.floor(rng() * FISH_COLORS.length)],
      respawn: 0, yaw: 0, pitch: 0,
    };
  }

  _makeBird(x, y, z) {
    const rng = this._rng;
    return {
      id: this.nextId++, type: 'bird', name: '海鸟', idx: this.counts.birds++,
      alive: true, home: new THREE.Vector3(x, y, z), pos: new THREE.Vector3(x, y, z),
      phase: rng() * Math.PI * 2, radius: 14 + rng() * 28, speed: 0.09 + rng() * 0.09,
      angle: rng() * Math.PI * 2, scale: 1.35 + rng() * 0.85,
      tint: BIRD_COLORS[Math.floor(rng() * BIRD_COLORS.length)],
      flap: 5 + rng() * 3.2, respawn: 0, yaw: 0, pitch: 0, bank: 0,
    };
  }

  _makeSheep(x, y, z) {
    const rng = this._rng;
    return {
      id: this.nextId++, type: 'sheep', name: '岩羊', idx: this.counts.sheep++,
      alive: true, home: new THREE.Vector3(x, y, z), pos: new THREE.Vector3(x, y, z),
      target: new THREE.Vector3(x, y, z), phase: rng() * 6.28,
      speed: 0.6 + rng() * 0.5, graze: rng() * 4,
      scale: 0.85 + rng() * 0.4, tint: SHEEP_COLORS[Math.floor(rng() * SHEEP_COLORS.length)],
      respawn: 0, yaw: rng() * 6.28, pitch: 0,
    };
  }

  _populate() {
    const c = this.center;
    const seed = (Math.round(c.x / 97) * 73856093) ^ (Math.round(c.z / 97) * 19349663) ^ 0x5f3759df;
    this._rng = mulberry32(seed >>> 0);
    const rng = this._rng;
    this.clear();
    this._rng = rng;
    this.lastPopulate = this.time;

    // Fish schools in deep water.
    let schools = 0;
    for (let attempt = 0; attempt < 80 && schools < 5; attempt++) {
      const a = rng() * Math.PI * 2;
      const r = 55 + rng() * 300;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      const h = heightAt(x, z);
      if (h > SEA_LEVEL - 4) continue;
      const y = clamp(SEA_LEVEL - 2 - rng() * Math.min(18, -h * 0.55), h + 2, SEA_LEVEL - 2);
      const n = 5 + Math.floor(rng() * 5);
      for (let i = 0; i < n; i++) {
        const fish = this._makeFish(x + (rng() - 0.5) * 16, y + (rng() - 0.5) * 3, z + (rng() - 0.5) * 16);
        fish.home.set(x + (rng() - 0.5) * 10, y, z + (rng() - 0.5) * 10);
        this.animals.push(fish);
      }
      schools++;
    }

    // Flocks above the terrain.
    let flocks = 0;
    for (let attempt = 0; attempt < 70 && flocks < 4; attempt++) {
      const a = rng() * Math.PI * 2;
      const r = 80 + rng() * 260;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      const ground = heightAt(x, z);
      const y = Math.max(SEA_LEVEL + 22, ground + 20 + rng() * 32);
      const n = 5 + Math.floor(rng() * 5);
      for (let i = 0; i < n; i++) {
        const bird = this._makeBird(x + (rng() - 0.5) * 30, y + (rng() - 0.5) * 7, z + (rng() - 0.5) * 30);
        this.animals.push(bird);
      }
      flocks++;
    }

    // Sheep on gentle green ground.
    let flocks2 = 0;
    for (let attempt = 0; attempt < 100 && flocks2 < 4; attempt++) {
      const a = rng() * Math.PI * 2;
      const r = 45 + rng() * 280;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      const h = heightAt(x, z);
      if (h < 4 || h > 46 || slopeAt(x, z, 10) > 0.45) continue;
      if (moistureAt(x, z) < -0.2) continue;
      const n = 4 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const sx = x + (rng() - 0.5) * 20;
        const sz = z + (rng() - 0.5) * 20;
        const sh = heightAt(sx, sz);
        if (sh < 1 || slopeAt(sx, sz, 7) > 1.0) continue;
        const sheep = this._makeSheep(sx, sh, sz);
        sheep.home.set(sx, sh, sz);
        sheep.target.copy(sheep.home);
        this.animals.push(sheep);
      }
      flocks2++;
    }
    this.syncCounts();
    for (const a of this.animals) {
      if (a.type === 'fish') this.fish.setColorAt(a.idx, _color.set(a.tint));
      else if (a.type === 'bird') {
        this.birdBody.setColorAt(a.idx, _color.set(a.tint));
        this.birdWings.setColorAt(a.idx * 2, _color.set(a.tint));
        this.birdWings.setColorAt(a.idx * 2 + 1, _color.set(a.tint));
      } else this.sheep.setColorAt(a.idx, _color.set(a.tint));
    }
    for (const m of this.meshes) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  _ensurePopulated(playerPos) {
    if (!Number.isFinite(this.center.x) || this.center.distanceToSquared(playerPos) > 430 * 430) {
      this.center.copy(playerPos);
      this._populate();
    }
  }

  update(dt, time, playerPos, ctx = {}) {
    this.time = time;
    this._ensurePopulated(playerPos);
    const underwater = !!ctx.underwater;
    const player = playerPos;
    const fire = ctx.firePositions || null;
    for (const a of this.animals) {
      if (!a.alive) {
        a.respawn -= dt;
        if (a.respawn <= 0) this._respawn(a, player);
        continue;
      }
      if (a.type === 'fish') this._updateFish(a, dt, player, underwater);
      else if (a.type === 'bird') this._updateBird(a, dt, player, fire);
      else this._updateSheep(a, dt, player, fire);
    }
    this._writeMatrices(time);
    for (const m of this.meshes) {
      if (!m.visible) continue;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  _updateFish(a, dt, player, underwater) {
    a.angle += dt * a.speed;
    const baseX = a.home.x + Math.cos(a.angle) * a.radius;
    const baseZ = a.home.z + Math.sin(a.angle) * a.radius;
    const ground = heightAt(baseX, baseZ);
    let y = Math.min(a.home.y + Math.sin(a.angle * 2.7 + a.phase) * 1.8, SEA_LEVEL - 1.4);
    y = Math.max(y, Math.max(ground + 1.1, SEA_LEVEL - 45));
    let x = baseX;
    let z = baseZ;
    const dx = x - player.x;
    const dz = z - player.z;
    const dist = Math.hypot(dx, dz);
    const close = underwater ? 22 : 11;
    if (dist < close && Math.abs(player.y - y) < 26) {
      const inv = 1 / Math.max(1, dist);
      x += dx * inv * (close - dist) * 0.9;
      z += dz * inv * (close - dist) * 0.9;
      y -= dt * 2.2;
    }
    a.pos.set(x, y, z);
    a.yaw = Math.atan2(Math.cos(a.angle), -Math.sin(a.angle)) + Math.sin(a.phase + this.time) * 0.15;
    a.pitch = Math.sin(a.angle * 2 + a.phase) * 0.1;
  }

  _updateBird(a, dt, player, fire) {
    a.angle += dt * a.speed;
    a.home.y = Math.max(SEA_LEVEL + 16, heightAt(a.home.x, a.home.z) + 36);
    let x = a.home.x + Math.cos(a.angle) * a.radius;
    let z = a.home.z + Math.sin(a.angle) * a.radius;
    let y = a.home.y + Math.sin(this.time * 0.7 + a.phase) * 3.5;
    const dx = x - player.x;
    const dz = z - player.z;
    const dy = y - player.y;
    const dist = Math.hypot(dx, dz);
    if (dist < 55 && Math.abs(dy) < 35) {
      const inv = 1 / Math.max(1, dist);
      x += dx * inv * (55 - dist) * 0.6;
      z += dz * inv * (55 - dist) * 0.6;
      y += 5;
    }
    if (fire) {
      for (const p of fire) {
        const fd = Math.hypot(x - p.x, z - p.z);
        if (fd < 45) y += dt * 4;
      }
    }
    a.pos.set(x, Math.max(SEA_LEVEL + 6, y), z);
    a.yaw = -a.angle + Math.PI * 0.5;
  }

  _updateSheep(a, dt, player, fire) {
    a.graze -= dt;
    const dxP = a.pos.x - player.x;
    const dzP = a.pos.z - player.z;
    const distP = Math.hypot(dxP, dzP);
    const fleeing = distP < 65 || (fire && fire.some((p) => Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < 26));
    if (fleeing) {
      const inv = 1 / Math.max(1, distP);
      a.target.set(a.pos.x + dxP * inv * 12, 0, a.pos.z + dzP * inv * 12);
      a.speed = 3.2;
    } else if (a.graze <= 0) {
      a.graze = 2.5 + Math.random() * 5;
      const ang = Math.random() * Math.PI * 2;
      const d = 3 + Math.random() * 12;
      a.target.set(a.home.x + Math.cos(ang) * d, 0, a.home.z + Math.sin(ang) * d);
      a.speed = 0.55;
    }
    const tx = a.target.x - a.pos.x;
    const tz = a.target.z - a.pos.z;
    const td = Math.hypot(tx, tz);
    if (td > 0.5) {
      const sp = a.speed * (fleeing ? 1.4 : 1);
      a.pos.x += (tx / td) * sp * dt;
      a.pos.z += (tz / td) * sp * dt;
      a.yaw = Math.atan2(tx, tz);
    }
    const g = heightAt(a.pos.x, a.pos.z);
    a.pos.y = g;
    a.home.x = clamp(a.home.x, this.center.x - 390, this.center.x + 390);
    a.home.z = clamp(a.home.z, this.center.z - 390, this.center.z + 390);
  }

  _respawn(a, player) {
    const rng = this._rng;
    for (let tries = 0; tries < 20; tries++) {
      const ang = rng() * Math.PI * 2;
      const r = 120 + rng() * 260;
      const x = player.x + Math.cos(ang) * r;
      const z = player.z + Math.sin(ang) * r;
      if (a.type === 'fish') {
        const h = heightAt(x, z);
        if (h > SEA_LEVEL - 4) continue;
        a.home.set(x, clamp(SEA_LEVEL - 4, h + 1, SEA_LEVEL - 1), z);
      } else if (a.type === 'bird') {
        const h = Math.max(heightAt(x, z), SEA_LEVEL);
        a.home.set(x, h + 42 + rng() * 30, z);
      } else {
        const h = heightAt(x, z);
        if (h < 3 || h > 46 || slopeAt(x, z, 8) > 0.8) continue;
        a.home.set(x, h, z);
      }
      a.pos.copy(a.home);
      a.alive = true;
      a.respawn = 0;
      a.phase = rng() * 6.28;
      return;
    }
    a.respawn = 8;
  }

  _writeMatrices(time) {
    let fi = 0; let bi = 0; let si = 0;
    for (const a of this.animals) {
      if (a.type === 'fish' && a.idx < 80) {
        if (!a.alive) {
          _obj.position.set(0, -9999, 0); _obj.scale.setScalar(0.001); _obj.rotation.set(0, 0, 0);
        } else {
          _obj.position.copy(a.pos);
          _obj.rotation.set(a.pitch, a.yaw, Math.sin(time * 4 + a.phase) * 0.18);
          _obj.scale.setScalar(a.scale);
        }
        _obj.updateMatrix();
        this.fish.setMatrixAt(a.idx, _obj.matrix);
      } else if (a.type === 'bird' && a.idx < 40) {
        const flap = a.alive ? Math.sin(time * a.flap + a.phase) : 0;
        const bank = a.alive ? Math.cos(a.angle) * 0.25 : 0;
        _obj.position.copy(a.pos);
        _obj.rotation.set(-0.05 + (a.alive ? Math.sin(time * 2 + a.phase) * 0.04 : 0), a.yaw, bank);
        _obj.scale.setScalar(a.scale);
        if (!a.alive) _obj.scale.setScalar(0.0001);
        _obj.updateMatrix();
        this.birdBody.setMatrixAt(a.idx, _obj.matrix);
        for (let side = -1; side <= 1; side += 2) {
          _wing.position.set(0, 0.04, 0.12);
          _wing.rotation.set(0, 0, side * (0.12 + flap * 0.62));
          _wing.scale.set(side, 1, 1);
          _wing.updateMatrix();
          _m.multiplyMatrices(_obj.matrix, _wing.matrix);
          this.birdWings.setMatrixAt(a.idx * 2 + (side > 0 ? 1 : 0), _m);
        }
      } else if (a.type === 'sheep' && a.idx < 34) {
        const bob = a.alive ? Math.abs(Math.sin(time * 3 + a.phase)) * (a.speed > 1.6 ? 0.12 : 0.02) : 0;
        _obj.position.set(a.pos.x, a.pos.y + bob, a.pos.z);
        _obj.rotation.set(0, a.alive ? a.yaw : 0, 0);
        _obj.scale.setScalar(a.alive ? a.scale : 0.0001);
        _obj.updateMatrix();
        this.sheep.setMatrixAt(a.idx, _obj.matrix);
      }
    }
  }

  getHuntTarget(playerPos, diet, ctx = {}) {
    if (!diet || !diet.length) return null;
    let best = null;
    for (const a of this.animals) {
      if (!a.alive || !diet.includes(a.type)) continue;
      const dist = a.pos.distanceTo(playerPos);
      let max = a.type === 'fish' ? 34 : (a.type === 'bird' ? 46 : 42);
      if (ctx.underwater && a.type === 'fish') max = 42;
      if (ctx.grounded && a.type === 'sheep') max = 55;
      if (dist <= max && (!best || dist < best.distance)) best = { animal: a, type: a.type, name: a.name, distance: dist, pos: a.pos };
    }
    return best;
  }

  catchTarget(target, playerPos) {
    if (!target?.animal || !target.animal.alive) return false;
    const a = target.animal;
    a.alive = false;
    a.respawn = 18 + Math.random() * 16;
    this.stats.caught++;
    _vec.copy(a.pos);
    _vec.lerp(playerPos, 0.55);
    // Hide immediately and leave a respawn timer.
    if (a.type === 'fish') this.fish.setMatrixAt(a.idx, new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001));
    else if (a.type === 'bird') {
      this.birdBody.setMatrixAt(a.idx, new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001));
      this.birdWings.setMatrixAt(a.idx * 2, new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001));
      this.birdWings.setMatrixAt(a.idx * 2 + 1, new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001));
    } else this.sheep.setMatrixAt(a.idx, new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001));
    this.fish.instanceMatrix.needsUpdate = true;
    this.birdBody.instanceMatrix.needsUpdate = true;
    this.birdWings.instanceMatrix.needsUpdate = true;
    this.sheep.instanceMatrix.needsUpdate = true;
    return { type: a.type, name: a.name, pos: _vec.clone(), color: a.tint };
  }

  scareAt(pos, radius, strength = 1) {
    for (const a of this.animals) {
      if (!a.alive) continue;
      const dx = a.pos.x - pos.x;
      const dz = a.pos.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      const inv = 1 / Math.max(1, d);
      if (a.type === 'sheep') {
        a.target.set(a.pos.x + dx * inv * 20, 0, a.pos.z + dz * inv * 20);
        a.speed = 4.2;
        a.graze = 4;
      } else if (a.type === 'bird') {
        a.home.y += 8 * strength;
      }
    }
  }

  markers(playerPos, radius = 1300) {
    const out = [];
    for (const a of this.animals) {
      if (!a.alive) continue;
      const x = a.pos.x - playerPos.x;
      const z = a.pos.z - playerPos.z;
      if (x * x + z * z > radius * radius) continue;
      out.push({ x: a.pos.x, z: a.pos.z, type: a.type });
    }
    return out;
  }
}
