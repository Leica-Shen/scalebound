import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CHUNK_SIZE, RENDER_RADIUS, DETAIL_RADIUS, SEA_LEVEL,
  generateChunk, heightAt, quantizeHeight, findSpawn, regionAt,
} from '../core/terrain.js';
import { createSky, createLighting, SUN_DIR } from '../core/sky.js';
import { mulberry32, hash2i, clamp, lerp } from '../core/noise.js';
import { Effects } from './effects.js';
import { SoulField, RingField } from './collectibles.js';

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

function makeCloudTexture(seed, variant = 0) {
  const W = 96;
  const H = 48;
  const rng = mulberry32(seed);
  // A chunky pixel cumulus: a horizontal bar of soft lobes with a bright crown.
  const puffs = [
    { cx: 0.18, cy: 0.65, rx: 0.15, ry: 0.2 },
    { cx: 0.32, cy: 0.52, rx: 0.24, ry: 0.32 },
    { cx: 0.51, cy: 0.44, rx: 0.27, ry: 0.4 },
    { cx: 0.7, cy: 0.52, rx: 0.23, ry: 0.31 },
    { cx: 0.83, cy: 0.63, rx: 0.14, ry: 0.2 },
    { cx: 0.63, cy: 0.7, rx: 0.2, ry: 0.16 },
    { cx: 0.4, cy: 0.72, rx: 0.19, ry: 0.13 },
  ];
  for (const p of puffs) {
    p.rx *= 0.9 + rng() * 0.3;
    p.ry *= 0.9 + rng() * 0.25;
    p.cx += (rng() - 0.5) * 0.035;
    p.cy += (rng() - 0.5) * 0.035;
  }
  const data = new Uint8Array(W * H * 4);
  const top = variant === 2 ? [255, 244, 225] : [255, 241, 220];
  const mid = variant === 1 ? [241, 202, 185] : [248, 218, 194];
  const low = variant === 2 ? [198, 164, 166] : [215, 177, 165];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const v = (y + 0.5) / H;
      let cover = 0;
      for (const p of puffs) {
        const dx = (u - p.cx) / p.rx;
        const dy = (v - p.cy) / p.ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1) cover = Math.max(cover, 1 - Math.pow(d, 5) * 0.48);
      }
      let alpha = Math.max(0, Math.min(1, (cover - 0.18) / 0.55));
      alpha = Math.round(alpha * 5) / 5;
      if (alpha < 0.15) {
        const i = (y * W + x) * 4;
        data[i + 3] = 0;
        continue;
      }
      const t = Math.max(0, Math.min(1, (v - 0.22) / 0.6));
      let r;
      let g;
      let b;
      if (t < 0.45) {
        const q = t / 0.45;
        r = top[0] + (mid[0] - top[0]) * q;
        g = top[1] + (mid[1] - top[1]) * q;
        b = top[2] + (mid[2] - top[2]) * q;
      } else {
        const q = (t - 0.45) / 0.55;
        r = mid[0] + (low[0] - mid[0]) * q;
        g = mid[1] + (low[1] - mid[1]) * q;
        b = mid[2] + (low[2] - mid[2]) * q;
      }
      // pixel dithering and sun-kissed upper-left edges
      const n = (Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453) % 1;
      const grain = Math.abs(n) * 10 - 5;
      const lit = Math.max(0, (0.5 - u) * (0.55 - v)) * 30;
      r += grain + lit;
      g += grain + lit * 0.85;
      b += grain + lit * 0.7;
      const i = (y * W + x) * 4;
      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
      data[i + 3] = Math.round(alpha * 255 * (variant === 1 ? 0.78 : 0.93));
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const waterVert = /* glsl */`
  precision highp float;
  varying vec3 vWorldPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const waterFrag = /* glsl */`
  precision highp float;
  varying vec3 vWorldPos;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 p = vWorldPos.xz;
    vec2 q = floor(p * 0.7) / 0.7;
    float w = sin(q.x * 0.12 + uTime * 0.8) + sin(q.y * 0.16 - uTime * 0.57) + sin((q.x + q.y) * 0.075 + uTime * 1.1);
    float w2 = sin(q.x * 0.46 - uTime * 1.7) * sin(q.y * 0.38 + uTime * 1.2);
    vec3 view = normalize(cameraPosition - vWorldPos);
    vec3 n = normalize(vec3(w2 * 0.02, 1.0, w2 * 0.015));
    float fres = pow(1.0 - max(dot(n, view), 0.0), 2.4);
    float crest = smoothstep(1.85, 2.85, w);
    float spec = pow(max(dot(reflect(-uSunDir, n), view), 0.0), 110.0);

    vec3 deep = vec3(0.022, 0.085, 0.13);
    vec3 mid = vec3(0.035, 0.215, 0.255);
    vec3 shallow = vec3(0.08, 0.40, 0.36);
    vec3 sky = vec3(0.78, 0.55, 0.30);
    vec3 col = mix(deep, mid, 0.5 + 0.16 * w);
    col = mix(col, shallow, crest * 0.15);
    col = mix(col, sky * 0.88, fres * 0.55);
    col += vec3(1.0, 0.72, 0.35) * spec * 1.8;
    col += vec3(0.9, 0.8, 0.56) * crest * 0.045;

    float sh = hash21(q * 1.7 + floor(uTime * 2.4));
    float sparkle = step(0.992, sh) * (0.35 + 0.65 * sin(uTime * 5.0 + q.x));
    col += vec3(1.0, 0.84, 0.55) * sparkle * 0.5;

    float dist = length(cameraPosition - vWorldPos);
    float fog = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFogColor, fog);
    gl_FragColor = vec4(col, mix(0.89, 1.0, fog));
  }
`;

function buildConiferGeometry() {
  const pieces = [];
  const tiers = [
    [1.9, 4.4, 4.2, 0],
    [1.55, 3.7, 5.6, 0.4],
    [1.15, 3.1, 6.9, 0.8],
    [0.72, 2.4, 8.0, 0.2],
  ];
  for (const [r, h, y, rot] of tiers) {
    const g = new THREE.ConeGeometry(r, h, 5, 1);
    g.rotateY(rot);
    g.translate(0, y, 0);
    pieces.push(g);
  }
  return mergeGeometries(pieces, false);
}

function buildBroadleafGeometry() {
  const pieces = [];
  const rng = mulberry32(9821);
  for (let i = 0; i < 7; i++) {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const sx = 1.2 + rng() * 1.0;
    const sy = 0.85 + rng() * 0.7;
    g.scale(sx, sy, sx * (0.85 + rng() * 0.25));
    g.rotateY(rng() * Math.PI);
    g.translate((rng() - 0.5) * 2.5, 4.0 + rng() * 2.2, (rng() - 0.5) * 2.1);
    pieces.push(g);
  }
  return mergeGeometries(pieces, false);
}

const CONIFER_COLORS = [0x315a42, 0x3a6b4b, 0x477b51, 0x2c4f3a, 0x56855b, 0x416f48];
const BROADLEAF_COLORS = [0x4d7a46, 0x649150, 0x7da158, 0x8ca958, 0x9cab5f, 0x557e42];
const AUTUMN_COLORS = [0xb8823f, 0xc6944c, 0x9d733c, 0x936738, 0xd0a458];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.scene.fog = new THREE.Fog(0xa3b8b2, 300, 900);
    this.lights = createLighting(scene);
    this.lights.hero.intensity = 0.8;
    this.charLight = new THREE.PointLight(0xffd4ae, 680, 86, 1.75);
    this.scene.add(this.charLight);
    this.sky = createSky(scene);

    this.terrainMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
      fog: true,
    });
    // Add close-range pixel grain and grass/stone speckles without another
    // geometry tier. The terrain still reads as one clean, infinite surface.
    this.terrainMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec3 vTWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
      shader.fragmentShader = 'varying vec3 vTWorld;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 tcell = floor(vTWorld.xz * 0.9);
        float tn1 = fract(sin(dot(tcell, vec2(12.9898, 78.233))) * 43758.5453);
        float tn2 = fract(sin(dot(floor(vTWorld.xz * 2.4), vec2(39.346, 11.135))) * 24634.6345);
        float tdist = length(vViewPosition);
        float tfade = 1.0 - smoothstep(55.0, 430.0, tdist);
        float grain = (tn1 - 0.5) * 0.2 + (tn2 - 0.5) * 0.13;
        diffuseColor.rgb *= 1.0 + grain * tfade;
        float grassy = smoothstep(0.015, 0.13, diffuseColor.g - diffuseColor.r);
        float blade = step(0.72, tn2) * grassy * tfade;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.82, 1.08, 0.78) + vec3(0.012, 0.025, 0.0), blade * 0.42);
        `,
      );
    };

    this.chunks = new Map();
    this.centerCX = null;
    this.centerCZ = null;
    this.required = [];
    this.requiredIndex = 0;
    this.lastUnload = 0;
    this.propsDirty = true;
    this.lastPropsBuild = -1;
    // A hand-picked opening vista: a wooded river valley looking into a
    // golden sea horizon. The rest of the world remains entirely procedural.
    const handPicked = { x: -2120, z: -2960, yaw: 2.23 };
    const handH = heightAt(handPicked.x, handPicked.z);
    this.spawn = { ...handPicked, h: handH, terrain: handH, y: Math.max(58, handH + 56), score: 0 };
    if (typeof window !== 'undefined') {
      try {
        const q = new URLSearchParams(window.location.search);
        if (q.has('spawn')) {
          const [sx, sz, syaw] = q.get('spawn').split(',').map(Number);
          if (Number.isFinite(sx) && Number.isFinite(sz)) {
            const sh = heightAt(sx, sz);
            this.spawn = {
              x: sx, z: sz, h: sh,
              y: Math.max(58, sh + 56),
              terrain: sh,
              yaw: Number.isFinite(syaw) ? syaw : 2.23,
              score: 0,
            };
          }
        }
      } catch { /* ignore */ }
    }
    this.mode = 'menu';
    this.fogNearTarget = 300;
    this.fogFarTarget = 900;
    this._lastFocus = new THREE.Vector3(Infinity, 0, Infinity);
    this._buildWater();
    this._buildClouds();
    this._buildProps();
    this.effects = new Effects(scene);
    this.souls = new SoulField(scene);
    this.rings = new RingField(scene);
    this.waterMesh.position.y = SEA_LEVEL;
    this.heroDirection = new THREE.Vector3();

    this.time = 0;
    this.stats = { chunks: 0 };
    this.biomeCache = { t: -1, data: null };
  }

  getHeight(x, z) { return heightAt(x, z); }

  setMode(mode) {
    this.mode = mode;
    this.fogNearTarget = mode === 'menu' ? 300 : 380;
    this.fogFarTarget = mode === 'menu' ? 900 : 1000;
  }

  setSunForYaw(yaw) {
    // The sun is placed a little to the left of the chosen vista, so it hangs
    // in the sky behind the dragon and carves a warm rim around its wings.
    const sunYaw = yaw + 0.12;
    const elevation = 0.08;
    const cosE = Math.cos(elevation);
    const dir = new THREE.Vector3(Math.sin(sunYaw) * cosE, Math.sin(elevation), Math.cos(sunYaw) * cosE).normalize();
    this.sky.setSunDirection(dir);
    this.lights.sun.position.copy(dir).multiplyScalar(420);
    this.waterMaterial.uniforms.uSunDir.value.copy(dir);
    this.sunDirection = dir;
  }

  regenerateSpawn() {
    // A hand-picked opening vista: a wooded river valley looking into a
    // golden sea horizon. The rest of the world remains entirely procedural.
    const handPicked = { x: -2120, z: -2960, yaw: 2.23 };
    const handH = heightAt(handPicked.x, handPicked.z);
    this.spawn = { ...handPicked, h: handH, terrain: handH, y: Math.max(58, handH + 56), score: 0 };
    return this.spawn;
  }

  _buildWater() {
    const geo = new THREE.PlaneGeometry(5200, 5200, 1, 1);
    this.waterMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: SUN_DIR.clone() },
        uFogColor: { value: new THREE.Color(0xa3b8b2) },
        uFogNear: { value: 170 },
        uFogFar: { value: 640 },
      },
      vertexShader: waterVert,
      fragmentShader: waterFrag,
    });
    this.waterMesh = new THREE.Mesh(geo, this.waterMaterial);
    this.waterMesh.rotation.x = -Math.PI / 2;
    this.waterMesh.position.y = SEA_LEVEL + 0.03;
    this.waterMesh.renderOrder = 1;
    this.waterMesh.frustumCulled = false;
    this.scene.add(this.waterMesh);
  }

  _buildClouds() {
    this.cloudTextures = [
      makeCloudTexture(4121, 0),
      makeCloudTexture(1149, 1),
      makeCloudTexture(8821, 2),
    ];
    this.cloudMaterials = this.cloudTextures.map((tex, i) => new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: i === 1 ? 0.4 : 0.5,
      depthWrite: false,
      depthTest: true,
      fog: false,
      color: i === 1 ? 0xffd8c7 : (i === 2 ? 0xf3e0e8 : 0xfff0db),
      alphaTest: 0.02,
    }));
    this.clouds = [];
    const cr = mulberry32(7712);
    for (let i = 0; i < 16; i++) {
      const ang = cr() * Math.PI * 2;
      const radius = 900 + cr() * 1400;
      const variant = i % 3;
      const material = this.cloudMaterials[variant];
      const sprite = new THREE.Sprite(material);
      const w = 95 + cr() * 145;
      sprite.scale.set(w, w * 0.5, 1);
      sprite.renderOrder = 1;
      this.scene.add(sprite);
      this.clouds.push({
        sprite,
        bx: Math.cos(ang) * radius,
        bz: Math.sin(ang) * radius,
        by: 300 + cr() * 230,
        w,
        h: w * 0.5,
        speed: 0.7 + cr() * 1.7,
        phase: cr() * 6.28,
        variant,
        minR: 950,
      });
    }
  }

  _buildProps() {
    const trunkGeo = new THREE.BoxGeometry(1, 1, 1);
    trunkGeo.translate(0, 0.5, 0);
    const coniferGeo = buildConiferGeometry();
    const broadleafGeo = buildBroadleafGeometry();
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    // A gentler, flatter rock silhouette
    rockGeo.scale(1.15, 0.72, 0.95);

    this.trunkMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide });
    this.rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });

    const opts = { instanceMatrix: { usage: THREE.DynamicDrawUsage }, frustumCulled: false };
    this.trunkMesh = new THREE.InstancedMesh(trunkGeo, this.trunkMat, 7000);
    this.coniferMesh = new THREE.InstancedMesh(coniferGeo, this.leafMat, 4500);
    this.broadleafMesh = new THREE.InstancedMesh(broadleafGeo, this.leafMat, 4500);
    this.rockMesh = new THREE.InstancedMesh(rockGeo, this.rockMat, 1500);
    for (const m of [this.trunkMesh, this.coniferMesh, this.broadleafMesh, this.rockMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.receiveShadow = false;
      this.scene.add(m);
    }
    this.coniferMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(4500 * 3), 3);
    this.broadleafMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(4500 * 3), 3);
    this.trunkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(7000 * 3), 3);
    this.rockMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(1500 * 3), 3);
    this.trunkMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.coniferMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.broadleafMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.rockMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }

  _addChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (this.chunks.has(key)) return false;
    const data = generateChunk(cx, cz);
    const mesh = new THREE.Mesh(data.geometry, this.terrainMaterial);
    mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.frustumCulled = true;
    this.scene.add(mesh);
    this.chunks.set(key, {
      cx, cz, mesh, geometry: data.geometry, props: data.props,
      minHeight: data.minHeight, maxHeight: data.maxHeight,
    });
    this.propsDirty = true;
    return true;
  }

  _removeChunk(key) {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    this.scene.remove(chunk.mesh);
    chunk.geometry.dispose();
    this.chunks.delete(key);
    this.propsDirty = true;
  }

  _computeRequired(cx, cz) {
    const list = [];
    const r = RENDER_RADIUS;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > (r + 0.2) * (r + 0.2)) continue;
        list.push({ cx: cx + dx, cz: cz + dz, d: dx * dx + dz * dz });
      }
    }
    list.sort((a, b) => a.d - b.d);
    this.required = list;
    this.requiredIndex = 0;
  }

  async warmup(focus, radius = 6, onProgress = null) {
    this.setMode('menu');
    this._lastFocus.copy(focus);
    const cx = Math.floor(focus.x / CHUNK_SIZE);
    const cz = Math.floor(focus.z / CHUNK_SIZE);
    this.centerCX = cx;
    this.centerCZ = cz;
    const coords = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > (radius + 0.25) * (radius + 0.25)) continue;
        coords.push({ cx: cx + dx, cz: cz + dz, d: dx * dx + dz * dz });
      }
    }
    coords.sort((a, b) => a.d - b.d);
    for (let i = 0; i < coords.length; i++) {
      this._addChunk(coords[i].cx, coords[i].cz);
      if (onProgress) onProgress(i / coords.length);
      if (i % 7 === 0) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
    this._computeRequired(cx, cz);
    this._rebuildPropsNow();
    if (onProgress) onProgress(1);
  }

  _generateNearby(centerPos) {
    const cx = Math.floor(centerPos.x / CHUNK_SIZE);
    const cz = Math.floor(centerPos.z / CHUNK_SIZE);
    if (cx !== this.centerCX || cz !== this.centerCZ) {
      this.centerCX = cx;
      this.centerCZ = cz;
      this._computeRequired(cx, cz);
      this.propsDirty = true;
    }
    const budgetStart = performance.now();
    let built = 0;
    let scanned = 0;
    while (this.requiredIndex < this.required.length && built < 3 && scanned < 40) {
      const c = this.required[this.requiredIndex++];
      scanned++;
      const key = `${c.cx},${c.cz}`;
      if (this.chunks.has(key)) continue;
      this._addChunk(c.cx, c.cz);
      built++;
      if (performance.now() - budgetStart > 7.2) break;
    }
    this.stats.chunks = this.chunks.size;

    const now = performance.now();
    if (now - this.lastUnload > 900) {
      this.lastUnload = now;
      const maxD = (RENDER_RADIUS + 2.4) * CHUNK_SIZE;
      for (const [key, chunk] of this.chunks) {
        const dx = (chunk.cx + 0.5) * CHUNK_SIZE - centerPos.x;
        const dz = (chunk.cz + 0.5) * CHUNK_SIZE - centerPos.z;
        if (dx * dx + dz * dz > maxD * maxD) this._removeChunk(key);
      }
      this.propsDirty = true;
    }
  }

  _rebuildPropsNow() {
    if (!this.trunkMesh) return;
    const focus = this._lastFocus;
    const pcx = Math.floor(focus.x / CHUNK_SIZE);
    const pcz = Math.floor(focus.z / CHUNK_SIZE);
    let ti = 0;
    let ci = 0;
    let bi = 0;
    let ri = 0;
    const maxDetail = DETAIL_RADIUS + 0.35;
    for (const chunk of this.chunks.values()) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (dx * dx + dz * dz > maxDetail * maxDetail) continue;
      const treeRng = mulberry32(hash2i(chunk.cx, chunk.cz, 1901));
      for (const tree of chunk.props.trees) {
        if (ti >= 7000) break;
        const species = tree.species;
        const s = tree.scale;
        _dummy.position.set(tree.x, tree.y, tree.z);
        _dummy.rotation.set(tree.tilt, tree.rot, tree.tilt * 0.7);
        _dummy.scale.setScalar(s);
        _dummy.updateMatrix();
        if (species === 0) {
          if (ci >= 4500) continue;
          this.coniferMesh.setMatrixAt(ci, _dummy.matrix);
          _color.setHex(CONIFER_COLORS[Math.floor(tree.tint * CONIFER_COLORS.length)]);
          _color.offsetHSL(0, 0.01 * (tree.tint - 0.5), (tree.tint - 0.5) * 0.04);
          this.coniferMesh.setColorAt(ci, _color);
          ci++;
        } else {
          if (bi >= 4500) continue;
          this.broadleafMesh.setMatrixAt(bi, _dummy.matrix);
          const palette = tree.autumn ? AUTUMN_COLORS : BROADLEAF_COLORS;
          _color.setHex(palette[Math.floor(tree.tint * palette.length)]);
          _color.offsetHSL(0, 0.01 * (tree.tint - 0.5), (tree.tint - 0.5) * 0.05);
          this.broadleafMesh.setColorAt(bi, _color);
          bi++;
        }
        _dummy.position.y = tree.y;
        _dummy.rotation.set(tree.tilt, tree.rot, tree.tilt * 0.7);
        _dummy.scale.set(0.33 * s, (species === 0 ? 3.7 : 3.2) * s, 0.33 * s);
        _dummy.updateMatrix();
        this.trunkMesh.setMatrixAt(ti, _dummy.matrix);
        _color.setHex(0x624b34).offsetHSL(0, 0, (treeRng() - 0.5) * 0.1);
        this.trunkMesh.setColorAt(ti, _color);
        ti++;
      }
      for (const rock of chunk.props.rocks) {
        if (ri >= 1500) break;
        _dummy.position.set(rock.x, rock.y, rock.z);
        _dummy.rotation.set((rock.tint - 0.5) * 0.3, rock.rot, (rock.tint - 0.5) * 0.2);
        _dummy.scale.set(rock.scale * 1.4, rock.scale * 0.75, rock.scale * 1.1);
        _dummy.updateMatrix();
        this.rockMesh.setMatrixAt(ri, _dummy.matrix);
        _color.setHex(0x7d7768).offsetHSL(0, 0, (rock.tint - 0.5) * 0.14);
        this.rockMesh.setColorAt(ri, _color);
        ri++;
      }
    }
    this.trunkMesh.count = ti;
    this.coniferMesh.count = ci;
    this.broadleafMesh.count = bi;
    this.rockMesh.count = ri;
    for (const m of [this.trunkMesh, this.coniferMesh, this.broadleafMesh, this.rockMesh]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.propsDirty = false;
    this.lastPropsBuild = this.time;
  }

  _updateFog(dt) {
    const fog = this.scene.fog;
    fog.near = lerp(fog.near, this.fogNearTarget, 1 - Math.exp(-1.4 * dt));
    fog.far = lerp(fog.far, this.fogFarTarget, 1 - Math.exp(-1.4 * dt));
    this.waterMaterial.uniforms.uFogNear.value = fog.near;
    this.waterMaterial.uniforms.uFogFar.value = fog.far;
    this.waterMaterial.uniforms.uFogColor.value.copy(fog.color);
  }

  _updateClouds(dt, time, camera) {
    if (!this.clouds) return;
    const R = 2400;
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      let x = (c.bx + time * c.speed - cx + R) % (R * 2);
      if (x < 0) x += R * 2;
      x += cx - R;
      let z = (c.bz - cz + R) % (R * 2);
      if (z < 0) z += R * 2;
      z += cz - R;
      // Keep the nearest huge sprite from swallowing the camera.
      const dx = x - cx;
      const dz = z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist < c.minR) {
        const push = c.minR / Math.max(1, dist);
        x = cx + dx * push;
        z = cz + dz * push;
      }
      c.sprite.position.set(x, c.by + Math.sin(time * 0.035 + c.phase) * 6, z);
      const pulse = 1 + Math.sin(time * 0.05 + c.phase) * 0.025;
      c.sprite.scale.set(c.w * pulse, c.h * pulse, 1);
    }
  }

  update(dt, time, focusPos, camera, mode = this.mode, gameplay = true) {
    if (this.lights?.hero) {
      // Keep a soft fill on the camera side of the dragon.
      this.lights.hero.position.copy(camera.position);
      this.lights.hero.position.y += 35;
      this.lights.hero.target.position.copy(focusPos);
      this.lights.hero.target.updateMatrixWorld();
    }
    if (this.charLight) {
      this.charLight.position.copy(camera.position);
      this.charLight.position.y += 2;
      this.charLight.intensity = mode === 'menu' ? 680 : 560;
    }
    this.time = time;
    this._lastFocus.copy(focusPos);
    this._updateFog(dt);
    this._generateNearby(focusPos);
    if (this.propsDirty && time - this.lastPropsBuild > 0.25) this._rebuildPropsNow();
    this._updateClouds(dt, time, camera);
    this.sky.update(camera, time);
    this.waterMaterial.uniforms.uTime.value = time;
    this.waterMesh.position.x = camera.position.x;
    this.waterMesh.position.z = camera.position.z;
    this.effects.update(dt);
    let soulHit = null;
    let ringHit = null;
    if (gameplay) {
      soulHit = this.souls.update(dt, time, focusPos);
      ringHit = this.rings.update(dt, time, focusPos);
    }
    return { soulHit, ringHit };
  }

  setGameplayVisible(visible) {
    this.souls.setVisible(visible);
    this.rings.setVisible(visible);
  }

  resetCollectibles() {
    this.souls.reset();
    this.rings.reset();
  }

  sampleRegion(pos) {
    if (this.time - this.biomeCache.t > 0.55) {
      this.biomeCache = { t: this.time, data: regionAt(pos.x, pos.z) };
    }
    return this.biomeCache.data;
  }

  setPickupRadius(r) {
    this.souls.pickupRadius = r;
  }

  addPlayerTrails(rig, accent, speed, dt, flapPulse = 0, state = null) {
    // magic motes trailing from the wingtips and tail
    if (!rig || !rig.wings || !rig.wings.length) return;
    if (!this._trailClock) this._trailClock = 0;
    this._trailClock += dt;
    if (this._trailClock > 0.035 && speed > 8) {
      this._trailClock = 0;
      const w0 = rig.wings[0];
      const w1 = rig.wings[1];
      const p = new THREE.Vector3();
      if (w0.tip) {
        w0.tip.getWorldPosition(p);
        this.effects.wingTrail(p, accent, speed, -1);
      }
      if (w1.tip) {
        w1.tip.getWorldPosition(p);
        this.effects.wingTrail(p, accent, speed, 1);
      }
      const tail = rig.tail[rig.tail.length - 1];
      if (tail && Math.random() < 0.5) {
        tail.getWorldPosition(p);
        this.effects.wingTrail(p, accent, speed * 0.5, 0);
      }
    }
  }
}
