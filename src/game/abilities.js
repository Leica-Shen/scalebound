import * as THREE from 'three';
import { heightAt, SEA_LEVEL } from '../core/terrain.js';
import { clamp, mulberry32 } from '../core/noise.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _color = new THREE.Color();

const ELEMENT_STYLE = {
  fire: { core: '#ffd56a', flame: '#ff7a35', ember: '#ffb35a', smoke: '#3b3431', decal: 0x24130f, light: 0xff8a45 },
  shadowfire: { core: '#ffb86b', flame: '#c458ff', ember: '#ff7a53', smoke: '#26172b', decal: 0x190b1c, light: 0xb85cff },
  frost: { core: '#e8ffff', flame: '#7fe5ff', ember: '#bdf7ff', smoke: '#b5cfd9', decal: 0xb7dde3, light: 0x8be9ff },
  water: { core: '#e8fff9', flame: '#70d9de', ember: '#a4fff1', smoke: '#a5bebd', decal: 0x1c4c52, light: 0x75e4e2 },
  nature: { core: '#f8e8a0', flame: '#8fd85c', ember: '#d9ef7d', smoke: '#73846a', decal: 0x2e4323, light: 0xa7e06c },
  star: { core: '#fff3bd', flame: '#ffb45c', ember: '#8cc7ff', smoke: '#4f5160', decal: 0x232636, light: 0x9fc7ff },
  storm: { core: '#f6fff4', flame: '#a8d7ff', ember: '#ffe18a', smoke: '#7e8c92', decal: 0x2a302c, light: 0xbcdfff },
};

function groundDecal(cx, cz, radius, color, opacity) {
  const segs = 18;
  const positions = [];
  const centerY = Math.max(heightAt(cx, cz), SEA_LEVEL) + 0.08;
  const center = [cx, centerY, cz];
  const ring = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const z = cz + Math.sin(a) * radius;
    const y = Math.max(heightAt(x, z), SEA_LEVEL) + 0.08;
    ring.push([x, y, z]);
  }
  for (let i = 0; i < segs; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    positions.push(...center, ...a, ...b);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    positions.push(...mid, ...a, ...b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

function makeFlameTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 48;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 32, 48);
  const layers = [
    { color: 'rgba(255, 63, 16, 0.7)', w: 24, h: 44, y: 24 },
    { color: 'rgba(255, 145, 35, 0.9)', w: 17, h: 34, y: 26 },
    { color: 'rgba(255, 236, 145, 0.95)', w: 9, h: 23, y: 29 },
  ];
  for (const l of layers) {
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.moveTo(16, 2);
    ctx.quadraticCurveTo(16 + l.w * 0.5, l.y - l.h * 0.3, 16 + l.w * 0.48, l.y);
    ctx.quadraticCurveTo(16 + l.w * 0.55, 42, 16, 47);
    ctx.quadraticCurveTo(16 - l.w * 0.55, 42, 16 - l.w * 0.48, l.y);
    ctx.quadraticCurveTo(16 - l.w * 0.5, l.y - l.h * 0.3, 16, 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

export class AbilitySystem {
  constructor({ scene, world, effects, wildlife, audio }) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.wildlife = wildlife;
    this.audio = audio;
    this.group = new THREE.Group();
    this.group.name = 'elemental-fx';
    scene.add(this.group);
    this.fires = [];
    this.debris = [];
    this.flashes = [];
    this.activeCast = null;
    this.time = 0;
    this.lastElement = null;
    this.rng = mulberry32(73519);
    this.fireLight = new THREE.PointLight(0xff8a45, 0, 64, 2);
    this.group.add(this.fireLight);
    this.cycle = 0;
    this.flameTexture = makeFlameTexture();
    this.treeFires = [];
  }

  get firePositions() {
    return this.fires.map((f) => ({ x: f.x, z: f.z, radius: f.radius }));
  }

  _style(element) {
    return ELEMENT_STYLE[element] || ELEMENT_STYLE.fire;
  }

  _impactPoint(origin, forward) {
    let impact = null;
    for (let d = 3; d <= 70; d += 2) {
      _v.copy(origin).addScaledVector(forward, d);
      const surface = Math.max(heightAt(_v.x, _v.z), SEA_LEVEL);
      if (_v.y <= surface + 0.6) {
        impact = { x: _v.x, y: surface, z: _v.z, distance: d, water: heightAt(_v.x, _v.z) < SEA_LEVEL - 0.2 };
        break;
      }
    }
    if (!impact) {
      const d = 30;
      _v.copy(origin).addScaledVector(forward, d);
      const surface = Math.max(heightAt(_v.x, _v.z), SEA_LEVEL);
      impact = { x: _v.x, y: surface, z: _v.z, distance: d, water: heightAt(_v.x, _v.z) < SEA_LEVEL - 0.2 };
    }
    return impact;
  }

  cast({ dragon, origin, forward, environment }) {
    let element = dragon.ability?.element || 'fire';
    if (element === 'elements') {
      const cycle = ['storm', 'nature', 'frost', 'water', 'fire'];
      element = cycle[this.cycle % cycle.length];
      this.cycle++;
    }
    const impact = this._impactPoint(origin, forward);
    const style = this._style(element);
    const dir = _v2.copy(forward).clone();
    this.activeCast = {
      element, style, age: 0, duration: 0.72, origin: origin.clone(),
      dir, impact, applied: false, dragonName: dragon.name,
    };
    this.lastElement = element;
    this._emitBreath(origin, dir, style, 1.0);
    if (this.audio) {
      if (this.audio.roar) this.audio.roar();
      if (this.audio.flap) this.audio.flap(1.2);
    }
    if (element === 'star' || element === 'storm') {
      this._meteor(impact, style, element);
    }
    return { element, impact, style };
  }

  _emitBreath(origin, dir, style, strength = 1) {
    for (let i = 0; i < 22; i++) {
      const path = i / 22;
      const spread = 0.5 + path * 2.4;
      const px = origin.x + dir.x * path * 16 + (this.rng() - 0.5) * spread;
      const py = origin.y + dir.y * path * 16 + (this.rng() - 0.5) * spread;
      const pz = origin.z + dir.z * path * 16 + (this.rng() - 0.5) * spread;
      this.effects.emit(
        px, py, pz,
        dir.x * (8 + this.rng() * 10) + (this.rng() - 0.5) * 2,
        dir.y * (8 + this.rng() * 8) + (this.rng() - 0.5) * 2 + 0.4,
        dir.z * (8 + this.rng() * 10) + (this.rng() - 0.5) * 2,
        this.rng() < 0.5 ? style.core : style.flame,
        0.18 + this.rng() * 0.32, 0.32 + this.rng() * 0.3, 0.6, 1.2,
      );
    }
  }

  _meteor(impact, style, element) {
    const start = new THREE.Vector3(impact.x + (this.rng() - 0.5) * 40, impact.y + 110, impact.z + (this.rng() - 0.5) * 40);
    const geo = new THREE.OctahedronGeometry(1.2, 0);
    const mat = new THREE.MeshBasicMaterial({ color: element === 'star' ? 0x9fdcff : style.core, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(start);
    this.group.add(mesh);
    this.debris.push({ mesh, age: 0, life: 1.1, kind: 'meteor', target: new THREE.Vector3(impact.x, impact.y + 1, impact.z) });
  }

  _lightning(impact, style) {
    const pts = [];
    const x = impact.x;
    const z = impact.z;
    const top = impact.y + 110;
    for (let i = 0; i < 13; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector3(x + (this.rng() - 0.5) * 9 * (1 - t), lerp(top, impact.y, t), z + (this.rng() - 0.5) * 9 * (1 - t)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xe9ffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 6;
    this.group.add(line);
    this.debris.push({ mesh: line, age: 0, life: 0.26, kind: 'bolt', material: mat });
    for (let i = 0; i < 18; i++) {
      this.effects.emit(
        impact.x + (this.rng() - 0.5) * 8, impact.y + this.rng() * 3, impact.z + (this.rng() - 0.5) * 8,
        (this.rng() - 0.5) * 7, 4 + this.rng() * 8, (this.rng() - 0.5) * 7,
        style.core, 0.12 + this.rng() * 0.2, 0.5, -2.5, 1.1,
      );
    }
  }

  _applyImpact(impact, element, style, dragon) {
    const water = impact.water;
    if (element === 'fire' || element === 'shadowfire') {
      if (water) {
        this._steam(impact, style, 26);
      } else {
        const count = element === 'shadowfire' ? 5 : 4;
        for (let i = 0; i < count; i++) {
          const a = this.rng() * 6.28;
          const r = this.rng() * 7;
          this.spawnFire(impact.x + Math.cos(a) * r, impact.z + Math.sin(a) * r, 2.4 + this.rng() * 3.2, element, environmentNow(this));
        }
      }
      this.world.effects.burst(new THREE.Vector3(impact.x, impact.y + 2, impact.z), style.core, 30, 10, 0.28, 0.9);
      this.wildlife.scareAt(impact, 44, 1.4);
    } else if (element === 'frost') {
      if (water) this._iceSheet(impact, 12);
      else this._iceSpikes(impact, 10);
      this._snowDecal(impact, 14);
      this.effects.burst(new THREE.Vector3(impact.x, impact.y + 1, impact.z), style.core, 30, 9, 0.24, 0.9);
    } else if (element === 'water' || element === 'storm') {
      if (element === 'storm') {
        this._lightning(impact, style);
        this.world.applyTerrainEdit(impact.x, impact.z, 8, -1.5, 'crater');
        this.spawnFire(impact.x + 2.5, impact.z - 1.5, 2.2, 'fire', this.time);
      } else {
        this.world.applyTerrainEdit(impact.x, impact.z, 11, -2.8, 'crater');
      }
      this._extinguish(impact.x, impact.z, element === 'water' ? 26 : 18);
      this._waterBurst(impact, style, element === 'storm' ? 1.4 : 1);
      this.wildlife.scareAt(impact, 50, 1.8);
    } else if (element === 'nature') {
      this.world.applyTerrainEdit(impact.x, impact.z, 13, 4.2, 'mound');
      for (let i = 0; i < 14; i++) {
        const a = this.rng() * 6.28;
        const r = 2 + this.rng() * 10;
        this._sprout(impact.x + Math.cos(a) * r, impact.z + Math.sin(a) * r);
      }
      this.effects.burst(new THREE.Vector3(impact.x, impact.y + 1.5, impact.z), style.flame, 36, 7, 0.3, 1.3);
    } else if (element === 'star') {
      this.world.applyTerrainEdit(impact.x, impact.z, 13, -5.5, 'crater');
      this.world.applyTerrainEdit(impact.x + 7, impact.z + 3, 6, 3.2, 'mound');
      this._rockCluster(impact.x, impact.z, 8, style);
      this.spawnFire(impact.x + 1, impact.z, 2.6, 'fire', this.time);
      this.effects.burst(new THREE.Vector3(impact.x, impact.y + 2, impact.z), style.core, 42, 14, 0.4, 1.4);
      this.wildlife.scareAt(impact, 58, 2);
    }
  }

  _steam(impact, style, count) {
    for (let i = 0; i < count; i++) {
      this.effects.emit(
        impact.x + (this.rng() - 0.5) * 7, impact.y + 0.6 + this.rng() * 2, impact.z + (this.rng() - 0.5) * 7,
        (this.rng() - 0.5) * 3, 2 + this.rng() * 5, (this.rng() - 0.5) * 3,
        i % 3 ? style.smoke : '#d9e5df', 0.35 + this.rng() * 0.5, 1.3 + this.rng(), 0.2, 0.8,
      );
    }
  }

  _waterBurst(impact, style, strength = 1) {
    for (let i = 0; i < 42; i++) {
      const a = this.rng() * 6.28;
      const sp = 4 + this.rng() * 11;
      this.effects.emit(
        impact.x, impact.y + 1, impact.z,
        Math.cos(a) * sp, 5 + this.rng() * 11, Math.sin(a) * sp,
        i % 3 === 0 ? style.core : '#6bd8df',
        0.18 + this.rng() * 0.3, 0.7 + this.rng() * 0.7, -9, 1.2,
      );
    }
    const ringGeo = new THREE.RingGeometry(1, 1.3, 22);
    const mat = new THREE.MeshBasicMaterial({ color: 0x7ff0e9, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(impact.x, impact.y + 0.3, impact.z);
    this.group.add(ring);
    this.debris.push({ mesh: ring, age: 0, life: 1.5, kind: 'ring', material: mat, scale: 8 * strength });
  }

  _extinguish(x, z, radius) {
    for (const f of this.fires) {
      if (Math.hypot(f.x - x, f.z - z) < radius) f.life = Math.min(f.life, 0.4);
    }
    for (const tf of this.treeFires) {
      if (Math.hypot(tf.x - x, tf.z - z) < radius + 6) tf.life = Math.min(tf.life, 0.5);
    }
    this.environment?.flashLightning?.();
  }

  _iceSheet(impact, radius) {
    const geo = new THREE.CircleGeometry(radius, 20);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xbfeef2, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(impact.x, SEA_LEVEL + 0.16, impact.z);
    mesh.renderOrder = 2;
    this.group.add(mesh);
    this.debris.push({ mesh, age: 0, life: 35, kind: 'ice', material: mat });
    for (let i = 0; i < 8; i++) {
      const a = this.rng() * 6.28;
      this._iceSpike(impact.x + Math.cos(a) * radius * (0.2 + this.rng() * 0.6), SEA_LEVEL + 0.2, impact.z + Math.sin(a) * radius * (0.2 + this.rng() * 0.6), 0.7 + this.rng() * 1.5);
    }
  }

  _iceSpikes(impact, count) {
    for (let i = 0; i < count; i++) {
      const a = this.rng() * 6.28;
      const r = 1 + this.rng() * 9;
      this._iceSpike(impact.x + Math.cos(a) * r, Math.max(heightAt(impact.x + Math.cos(a) * r, impact.z + Math.sin(a) * r), SEA_LEVEL) + 0.2, impact.z + Math.sin(a) * r, 0.8 + this.rng() * 2.6);
    }
  }

  _iceSpike(x, y, z, size) {
    const geo = new THREE.ConeGeometry(size * 0.32, size * 2.2, 5);
    const mat = new THREE.MeshLambertMaterial({ color: 0xbceff2, emissive: 0x24535a, flatShading: true, transparent: true, opacity: 0.88 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + size, z);
    mesh.rotation.y = this.rng() * 6.28;
    mesh.rotation.z = (this.rng() - 0.5) * 0.3;
    this.group.add(mesh);
    this.debris.push({ mesh, age: 0, life: 28, kind: 'ice', material: mat });
  }

  _snowDecal(impact, radius) {
    const decal = groundDecal(impact.x, impact.z, radius, 0xbfe8ea, 0.35);
    this.group.add(decal);
    this.debris.push({ mesh: decal, age: 0, life: 20, kind: 'decal', material: decal.material, fade: true });
  }

  _rockCluster(x, z, count, style) {
    for (let i = 0; i < count; i++) {
      const a = this.rng() * 6.28;
      const r = 2 + this.rng() * 10;
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      const size = 0.8 + this.rng() * 2.8;
      const geo = new THREE.DodecahedronGeometry(size, 0);
      const mat = new THREE.MeshLambertMaterial({ color: i % 3 === 0 ? 0x4d5b68 : (i % 2 ? 0x5e503f : 0x77705f), flatShading: true });
      const mesh = new THREE.Mesh(geo, mat);
      const y = Math.max(heightAt(sx, sz), SEA_LEVEL);
      mesh.position.set(sx, y + size * 0.5, sz);
      mesh.rotation.set(this.rng(), this.rng() * 6.28, this.rng() * 0.5);
      this.group.add(mesh);
      this.debris.push({ mesh, age: 0, life: 45, kind: 'rock', material: mat });
    }
  }

  _sprout(x, z) {
    const y = Math.max(heightAt(x, z), SEA_LEVEL);
    const geo = new THREE.ConeGeometry(0.5, 2.2, 5);
    const mat = new THREE.MeshLambertMaterial({ color: 0x4f8b49, emissive: 0x10230c, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + 1.1, z);
    mesh.rotation.z = (this.rng() - 0.5) * 0.35;
    this.group.add(mesh);
    this.debris.push({ mesh, age: 0, life: 60, kind: 'plant', material: mat });
  }

  spawnFire(x, z, radius, element, time) {
    const water = heightAt(x, z) < SEA_LEVEL - 0.2;
    if (water) {
      this._steam({ x, y: SEA_LEVEL, z }, this._style(element), 15);
      return;
    }
    if (this.fires.length >= 12) return;
    const style = this._style(element);
    const decal = groundDecal(x, z, radius, style.decal, 0.52);
    this.group.add(decal);
    const sprites = [];
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.flameTexture, color: new THREE.Color(i ? style.core : style.flame),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
        opacity: 0.78, fog: true,
      });
      const sp = new THREE.Sprite(mat);
      const a = this.rng() * 6.28;
      const rr = this.rng() * radius * 0.6;
      sp.position.set(x + Math.cos(a) * rr, Math.max(heightAt(x, z), SEA_LEVEL) + 0.4, z + Math.sin(a) * rr);
      const scl = radius * (0.75 + this.rng() * 0.8);
      sp.scale.set(scl, scl * 1.8, 1);
      sp.renderOrder = 3;
      this.group.add(sp);
      sprites.push(sp);
    }
    this.fires.push({
      x, z, y: Math.max(heightAt(x, z), SEA_LEVEL), radius, age: 0,
      life: 13 + this.rng() * 10, emit: 0, spread: 2.5 + this.rng() * 3,
      style, decal, sprites,
    });
    this._igniteTreesNear(x, z, radius + 5, style);
  }

  _igniteTreesNear(x, z, radius, style) {
    if (!this.world?.igniteTreesAt) return;
    const spots = this.world.igniteTreesAt(x, z, radius);
    for (const t of spots) {
      if (this.treeFires.length >= 26) break;
      const mat = new THREE.SpriteMaterial({
        map: this.flameTexture, color: new THREE.Color(style?.flame || '#ff7a35'),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: true, opacity: 0.68,
      });
      const sp = new THREE.Sprite(mat);
      const scl = 1.7 + t.scale * 0.7;
      sp.position.set(t.x, t.top + scl * 1.15, t.z);
      sp.scale.set(scl, scl * 1.8, 1);
      sp.renderOrder = 3;
      this.group.add(sp);
      this.treeFires.push({ sprite: sp, x: t.x, z: t.z, top: t.top, age: 0, life: 8 + this.rng() * 8, emit: 0, scale: scl });
    }
  }

  update(dt, time, environment, playerPos, underwater) {
    this.time = time;
    this.environment = environment;
    if (this.activeCast) {
      const c = this.activeCast;
      c.age += dt;
      if (c.age < c.duration * 0.65) {
        const strength = 1 - c.age / c.duration;
        for (let i = 0; i < 3; i++) {
          const path = 0.2 + this.rng() * 0.8;
          const px = c.origin.x + c.dir.x * path * 18 + (this.rng() - 0.5) * 1.4;
          const py = c.origin.y + c.dir.y * path * 18 + (this.rng() - 0.5) * 1.2;
          const pz = c.origin.z + c.dir.z * path * 18 + (this.rng() - 0.5) * 1.4;
          this.effects.emit(px, py, pz,
            c.dir.x * 14 + (this.rng() - 0.5) * 3,
            c.dir.y * 10 + (this.rng() - 0.5) * 2,
            c.dir.z * 14 + (this.rng() - 0.5) * 3,
            this.rng() < 0.55 ? c.style.core : c.style.flame,
            0.1 + this.rng() * 0.24, 0.3 + this.rng() * 0.35, 0.8, 1.1,
          );
        }
      }
      if (!c.applied && c.age > 0.3) {
        c.applied = true;
        this._applyImpact(c.impact, c.element, c.style);
      }
      if (c.age > c.duration) this.activeCast = null;
    }

    // fire growth, spreading, smoke and embers
    const raining = environment?.rain > 0.2;
    let nearestFire = null;
    let nearestDist = Infinity;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.age += dt;
      const wet = raining ? 3.4 : 1;
      f.life -= dt * wet;
      if (f.life <= 0) {
        this.group.remove(f.decal);
        f.decal.geometry.dispose();
        f.decal.material.dispose();
        for (const sp of f.sprites) { this.group.remove(sp); sp.material.dispose(); }
        this.fires.splice(i, 1);
        continue;
      }
      const dx = f.x - playerPos.x;
      const dz = f.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < nearestDist) { nearestDist = dist; nearestFire = f; }
      f.emit -= dt;
      if (f.emit <= 0 && dist < 180) {
        f.emit = 0.07 + this.rng() * 0.06;
        const a = this.rng() * 6.28;
        const r = this.rng() * f.radius;
        const x = f.x + Math.cos(a) * r;
        const z = f.z + Math.sin(a) * r;
        const y = Math.max(heightAt(x, z), SEA_LEVEL) + 0.25;
        const s = f.style;
        this.effects.emit(x, y, z, (this.rng() - 0.5) * 1.4, 1.4 + this.rng() * 3.6, (this.rng() - 0.5) * 1.4,
          this.rng() < 0.5 ? s.core : (this.rng() < 0.55 ? s.flame : s.ember),
          0.15 + this.rng() * 0.3, 0.35 + this.rng() * 0.55, 0.8, 0.9);
        if (this.rng() < 0.24) {
          this.effects.emit(x, y + 1.1, z, (this.rng() - 0.5) * 0.7, 2.2 + this.rng() * 2.2, (this.rng() - 0.5) * 0.7,
            s.smoke, 0.3 + this.rng() * 0.4, 1.4 + this.rng(), 0.2, 0.8);
        }
      }
      for (let k = 0; k < f.sprites.length; k++) {
        const sp = f.sprites[k];
        const fl = 0.78 + Math.sin(time * (8.5 + k * 1.7) + f.x * 0.1 + k * 2.1) * 0.18;
        const nearFade = clamp(1 - Math.max(0, f.life - 2) / 2, 0.3, 1);
        sp.material.opacity = fl * nearFade * (0.5 + f.radius * 0.06);
        sp.scale.set(f.radius * (1.5 + k * 0.5), f.radius * (2.5 + k * 0.65), 1);
      }
      f.spread -= dt;
      if (f.spread <= 0 && f.life > 4 && this.fires.length < 12) {
        f.spread = 4 + this.rng() * 5;
        const a = this.rng() * 6.28;
        const r = f.radius + 3 + this.rng() * 6;
        const sx = f.x + Math.cos(a) * r;
        const sz = f.z + Math.sin(a) * r;
        if (heightAt(sx, sz) > SEA_LEVEL + 0.6) this.spawnFire(sx, sz, 1.4 + this.rng() * 2.2, f.style === ELEMENT_STYLE.shadowfire ? 'shadowfire' : 'fire', time);
      }
    }
    if (nearestFire && nearestDist < 240) {
      this.fireLight.visible = true;
      this.fireLight.position.set(nearestFire.x, nearestFire.y + 4, nearestFire.z);
      const lightScale = 0.26 + (environment?.night || 0) * 1.25;
      this.fireLight.intensity = (58 + Math.sin(time * 13) * 15 + Math.sin(time * 23) * 10) * lightScale * clamp(1 - nearestDist / 240, 0, 1);
    } else this.fireLight.intensity = 0;

    for (let i = this.treeFires.length - 1; i >= 0; i--) {
      const tf = this.treeFires[i];
      tf.age += dt;
      tf.life -= dt * (raining ? 2.8 : 1);
      if (tf.life <= 0) {
        this.group.remove(tf.sprite);
        tf.sprite.material.dispose();
        this.treeFires.splice(i, 1);
        continue;
      }
      const pulse = 0.76 + Math.sin(time * 10 + tf.x * 0.3 + tf.z * 0.2) * 0.2;
      tf.sprite.material.opacity = pulse * clamp(tf.life / 2, 0.2, 1);
      tf.sprite.scale.set(tf.scale, tf.scale * (1.7 + Math.sin(time * 7 + tf.z) * 0.18), 1);
      tf.emit -= dt;
      if (tf.emit <= 0) {
        tf.emit = 0.22 + this.rng() * 0.25;
        this.effects.emit(tf.x + (this.rng() - 0.5) * 1.5, tf.top + 1.4, tf.z + (this.rng() - 0.5) * 1.5,
          (this.rng() - 0.5) * 0.8, 2.8 + this.rng() * 2.5, (this.rng() - 0.5) * 0.8,
          this.rng() < 0.25 ? '#ffd17a' : '#59625d', 0.35 + this.rng() * 0.45, 1.5 + this.rng() * 1.4, 0.2, 0.8);
      }
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;
      if (d.kind === 'meteor') {
        const t = clamp(d.age / d.life, 0, 1);
        d.mesh.position.lerp(d.target, 1 - Math.exp(-5.5 * dt));
        d.mesh.scale.setScalar(1 + Math.sin(t * Math.PI) * 2);
        this.effects.emit(d.mesh.position.x, d.mesh.position.y, d.mesh.position.z,
          (this.rng() - 0.5) * 3, -5 - this.rng() * 5, (this.rng() - 0.5) * 3,
          '#ffdb92', 0.2 + this.rng() * 0.3, 0.4, 0, 0.6);
      } else if (d.kind === 'bolt') {
        d.material.opacity = Math.max(0, 1 - d.age / d.life);
      } else if (d.kind === 'ring') {
        d.mesh.scale.setScalar(1 + d.age * d.scale);
        d.material.opacity = Math.max(0, 0.65 * (1 - d.age / d.life));
      } else if (d.kind === 'ice') {
        d.material.opacity = Math.max(0, (d.life - d.age) / 3);
      } else if (d.kind === 'plant' || d.kind === 'rock') {
        d.mesh.position.y += Math.sin(d.age * 0.7) * 0.0006;
      }
      if (d.age >= d.life) {
        this.group.remove(d.mesh);
        if (d.mesh.geometry) d.mesh.geometry.dispose();
        if (d.material) d.material.dispose();
        this.debris.splice(i, 1);
      }
    }
  }

  clear() {
    for (const f of this.fires) {
      this.group.remove(f.decal);
      f.decal.geometry.dispose();
      f.decal.material.dispose();
      for (const sp of f.sprites) { this.group.remove(sp); sp.material.dispose(); }
    }
    this.fires.length = 0;
    for (const tf of this.treeFires) { this.group.remove(tf.sprite); tf.sprite.material.dispose(); }
    this.treeFires.length = 0;
    for (const d of this.debris) {
      this.group.remove(d.mesh);
      if (d.mesh.geometry) d.mesh.geometry.dispose();
      if (d.material) d.material.dispose();
    }
    this.debris.length = 0;
    this.activeCast = null;
  }
}

function environmentNow(sys) { return sys.time; }
function lerp(a, b, t) { return a + (b - a) * t; }
