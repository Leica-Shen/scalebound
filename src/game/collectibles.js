import * as THREE from 'three';
import { hash2i, mulberry32 } from '../core/noise.js';
import { heightAt, SEA_LEVEL } from '../core/terrain.js';
import { getGlowTexture } from '../core/textures.js';

const _dummy = new THREE.Object3D();
const _p = new THREE.Vector3();

// ─────────────────────────────── Dragon souls ───────────────────────────────
export class SoulField {
  constructor(scene, seed = 1229) {
    this.scene = scene;
    this.seed = seed;
    this.cell = 246;
    this.range = 4;
    this.orbs = [];
    this.collected = new Set();
    this.gridKey = '';
    this.nearest = null;
    this.nearestDist = Infinity;
    this.pickupRadius = 7.2;
    this.totalSpawned = 0;

    const coreGeo = new THREE.OctahedronGeometry(1, 0);
    coreGeo.scale(1.1, 2.2, 1.1);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    this.core = new THREE.InstancedMesh(coreGeo, this.coreMat, 96);
    this.core.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.core.count = 0;
    this.core.frustumCulled = false;
    this.core.renderOrder = 2;
    scene.add(this.core);

    const haloGeo = new THREE.OctahedronGeometry(1, 0);
    haloGeo.scale(1.9, 3.1, 1.9);
    this.haloMat = new THREE.MeshBasicMaterial({
      color: 0xffcc72,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
      fog: true,
    });
    this.halo = new THREE.InstancedMesh(haloGeo, this.haloMat, 96);
    this.halo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halo.count = 0;
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 2;
    scene.add(this.halo);

    // one-draw-call glow sprites
    const haloPositions = new Float32Array(96 * 3);
    const haloGeoPoints = new THREE.BufferGeometry();
    haloGeoPoints.setAttribute('position', new THREE.BufferAttribute(haloPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.pointPositions = haloPositions;
    this.points = new THREE.Points(haloGeoPoints, new THREE.PointsMaterial({
      map: getGlowTexture(),
      color: 0xffd57b,
      size: 19,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.82,
      alphaTest: 0.02,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);

    // A tall, soft beacon makes souls readable across the whole valley.
    const beamGeo = new THREE.CylinderGeometry(0.55, 1.15, 30, 5, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.11,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.beacon = new THREE.InstancedMesh(beamGeo, beamMat, 96);
    this.beacon.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beacon.count = 0;
    this.beacon.frustumCulled = false;
    this.beacon.renderOrder = 2;
    scene.add(this.beacon);

    this.dirty = true;
    this.time = 0;
    this._tmpMatrix = new THREE.Matrix4();
    this._colors = [0xffe3a0, 0xffd274, 0xffc063, 0xf9e3b2];
  }

  _cellOrb(cx, cz) {
    const key = `${cx},${cz}`;
    if (this.collected.has(key)) return null;
    const r = mulberry32(hash2i(cx, cz, this.seed + 41));
    if (r() > 0.8) return null;
    const x = (cx + 0.18 + r() * 0.64) * this.cell;
    const z = (cz + 0.18 + r() * 0.64) * this.cell;
    const terrain = heightAt(x, z);
    const y = Math.max(SEA_LEVEL, terrain) + 24 + r() * 54;
    const phase = r() * Math.PI * 2;
    const tint = this._colors[Math.floor(r() * this._colors.length)];
    return { key, x, z, y, phase, tint };
  }

  rebuild(px, pz) {
    const gx = Math.floor(px / this.cell);
    const gz = Math.floor(pz / this.cell);
    this.gridKey = `${gx}:${gz}`;
    this.orbs = [];
    for (let z = gz - this.range; z <= gz + this.range; z++) {
      for (let x = gx - this.range; x <= gx + this.range; x++) {
        const orb = this._cellOrb(x, z);
        if (orb) this.orbs.push(orb);
      }
    }
    this.totalSpawned = Math.max(this.totalSpawned, this.orbs.length);
    this.core.count = this.orbs.length;
    this.halo.count = this.orbs.length;
    this.beacon.count = this.orbs.length;
    this.points.geometry.setDrawRange(0, this.orbs.length);
    for (let i = 0; i < this.orbs.length; i++) {
      this.core.setColorAt(i, new THREE.Color(this.orbs[i].tint));
    }
    if (this.core.instanceColor) this.core.instanceColor.needsUpdate = true;
    this.dirty = false;
  }

  update(dt, time, pos, pickupRadius = this.pickupRadius) {
    this.time = time;
    const gx = Math.floor(pos.x / this.cell);
    const gz = Math.floor(pos.z / this.cell);
    if (`${gx}:${gz}` !== this.gridKey) this.dirty = true;
    if (this.dirty) this.rebuild(pos.x, pos.z);

    const n = this.orbs.length;
    this.nearest = null;
    this.nearestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const o = this.orbs[i];
      const bob = Math.sin(time * 1.25 + o.phase) * 1.25;
      const y = o.y + bob;
      _dummy.position.set(o.x, y, o.z);
      _dummy.rotation.set(0, time * 0.8 + o.phase, time * 0.35 + o.phase);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.core.setMatrixAt(i, _dummy.matrix);
      _dummy.scale.set(1.04 + Math.sin(time * 2.6 + o.phase) * 0.06, 1.04 + Math.sin(time * 2.2 + o.phase) * 0.05, 1.04);
      _dummy.updateMatrix();
      this.halo.setMatrixAt(i, _dummy.matrix);
      _dummy.position.set(o.x, y + 13.5, o.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1 + Math.sin(time * 1.1 + o.phase) * 0.04, 1);
      _dummy.updateMatrix();
      this.beacon.setMatrixAt(i, _dummy.matrix);
      this.pointPositions[i * 3] = o.x;
      this.pointPositions[i * 3 + 1] = y;
      this.pointPositions[i * 3 + 2] = o.z;
      const dx = o.x - pos.x;
      const dy = y - pos.y;
      const dz = o.z - pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < this.nearestDist) { this.nearestDist = d; this.nearest = o; }
      if (d < pickupRadius + 3) {
        // gently draw the soul toward the dragon when very close
        const pull = (1 - Math.min(1, d / (pickupRadius + 3))) * dt * 8;
        o.x -= dx * pull;
        o.z -= dz * pull;
        o.y -= dy * pull * 0.5;
      }
    }
    this.core.instanceMatrix.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
    this.beacon.instanceMatrix.needsUpdate = true;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.haloMat.opacity = 0.13 + Math.sin(time * 2.2) * 0.035;

    for (let i = n - 1; i >= 0; i--) {
      const o = this.orbs[i];
      const dx = o.x - pos.x;
      const dy = (o.y + Math.sin(time * 1.25 + o.phase) * 1.25) - pos.y;
      const dz = o.z - pos.z;
      if (dx * dx + dy * dy + dz * dz < pickupRadius * pickupRadius) {
        this.collected.add(o.key);
        this.orbs.splice(i, 1);
        this.dirty = true;
        return { orb: o, remaining: this.orbs.length };
      }
    }
    return null;
  }

  get count() {
    return this.collected.size;
  }

  setVisible(visible) {
    this.core.visible = visible;
    this.halo.visible = visible;
    this.points.visible = visible;
    this.beacon.visible = visible;
  }

  reset() {
    this.collected.clear();
    this.gridKey = '';
    this.dirty = true;
    this.nearest = null;
    this.nearestDist = Infinity;
  }

  clearProximity(pos) {
    for (const o of this.orbs) {
      if (o.x - pos.x < 30 && o.z - pos.z < 30) return false;
    }
    return true;
  }
}

// ─────────────────────────────── Wind rings ─────────────────────────────────
export class RingField {
  constructor(scene, seed = 771) {
    this.scene = scene;
    this.seed = seed;
    this.cell = 470;
    this.range = 3;
    this.rings = [];
    this.gridKey = '';
    this.dirty = true;
    this.time = 0;
    this.nearest = null;
    this.nearestDist = Infinity;

    const geo = new THREE.TorusGeometry(5.4, 0.34, 4, 14);
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffd587,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, 64);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    const innerGeo = new THREE.TorusGeometry(4.6, 0.12, 4, 12);
    this.innerMesh = new THREE.InstancedMesh(innerGeo, new THREE.MeshBasicMaterial({
      color: 0x9ef3d9, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    }), 64);
    this.innerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.innerMesh.count = 0;
    this.innerMesh.frustumCulled = false;
    this.innerMesh.renderOrder = 2;
    scene.add(this.innerMesh);
    this._dummy = new THREE.Object3D();
  }

  _cellRing(cx, cz, t) {
    const r = mulberry32(hash2i(cx, cz, this.seed + 13));
    if (r() > 0.58) return null;
    const x = (cx + 0.2 + r() * 0.6) * this.cell;
    const z = (cz + 0.2 + r() * 0.6) * this.cell;
    const h = heightAt(x, z);
    const y = Math.max(SEA_LEVEL, h) + 26 + r() * 38;
    return {
      key: `${cx},${cz}`,
      x, z, y,
      yaw: r() * Math.PI * 2,
      phase: r() * Math.PI * 2,
      disabledUntil: 0,
      cx, cz,
    };
  }

  rebuild(px, pz, time) {
    const gx = Math.floor(px / this.cell);
    const gz = Math.floor(pz / this.cell);
    this.gridKey = `${gx}:${gz}`;
    this.rings = [];
    for (let z = gz - this.range; z <= gz + this.range; z++) {
      for (let x = gx - this.range; x <= gx + this.range; x++) {
        const ring = this._cellRing(x, z, time);
        if (ring) this.rings.push(ring);
      }
    }
    this.mesh.count = this.rings.length;
    this.innerMesh.count = this.rings.length;
    this.dirty = false;
  }

  update(dt, time, pos) {
    this.time = time;
    const gx = Math.floor(pos.x / this.cell);
    const gz = Math.floor(pos.z / this.cell);
    if (`${gx}:${gz}` !== this.gridKey) this.dirty = true;
    if (this.dirty) this.rebuild(pos.x, pos.z, time);
    this.nearest = null;
    this.nearestDist = Infinity;
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      const active = time >= ring.disabledUntil;
      const bob = Math.sin(time * 0.85 + ring.phase) * 1.2;
      this._dummy.position.set(ring.x, ring.y + bob, ring.z);
      this._dummy.rotation.set(0, ring.yaw + Math.sin(time * 0.44 + ring.phase) * 0.13, time * 0.24 + ring.phase);
      const s = active ? 1 : 0;
      this._dummy.scale.setScalar(s);
      this._dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this._dummy.matrix);
      this._dummy.rotation.y = ring.yaw;
      this._dummy.rotation.z = -time * 0.3;
      this._dummy.updateMatrix();
      this.innerMesh.setMatrixAt(i, this._dummy.matrix);
      if (!active) continue;
      const dx = ring.x - pos.x;
      const dy = ring.y + bob - pos.y;
      const dz = ring.z - pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < this.nearestDist) { this.nearestDist = d; this.nearest = ring; }
      if (d < 8.2) {
        ring.disabledUntil = time + 34;
        return { ring, remaining: 0 };
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.innerMesh.instanceMatrix.needsUpdate = true;
    return null;
  }

  setVisible(visible) {
    this.mesh.visible = visible;
    this.innerMesh.visible = visible;
  }

  reset() {
    for (const ring of this.rings) ring.disabledUntil = 0;
    this.gridKey = '';
    this.dirty = true;
    this.nearest = null;
    this.nearestDist = Infinity;
  }
}
