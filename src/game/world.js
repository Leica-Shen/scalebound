import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CHUNK_SIZE, RENDER_RADIUS, DETAIL_RADIUS, SEA_LEVEL,
  generateChunk, heightAt, quantizeHeight, findSpawn, regionAt,
} from '../core/terrain.js';
import { createSky, createLighting, SUN_DIR } from '../core/sky.js';
import { mulberry32, hash2i, clamp, lerp } from '../core/noise.js';
import { Effects } from './effects.js';
import { Wildlife } from './wildlife.js';
import { Environment } from './environment.js';
import { StructureField } from './structures.js';
import { addTerrainEdit } from '../core/terrain-edits.js';


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
  uniform vec3 uSkyColor;
  uniform vec3 uSunColor;
  uniform float uUnderwater;

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

    vec3 deep = mix(vec3(0.012, 0.060, 0.092), vec3(0.012, 0.035, 0.06), uUnderwater);
    vec3 mid = mix(vec3(0.025, 0.180, 0.215), uSkyColor * 0.32, uUnderwater);
    vec3 shallow = mix(vec3(0.06, 0.34, 0.31), uSkyColor * 0.45, uUnderwater);
    vec3 col = mix(deep, mid, 0.5 + 0.16 * w);
    col = mix(col, shallow, crest * 0.15);
    col = mix(col, uSkyColor * (uUnderwater > 0.5 ? 0.52 : 0.60), fres * (0.42 + uUnderwater * 0.18));
    col += uSunColor * spec * 0.85;
    col += vec3(0.9, 0.8, 0.56) * crest * 0.03;

    float sh = hash21(q * 1.7 + floor(uTime * 2.4));
    float sparkle = step(0.992, sh) * (0.35 + 0.65 * sin(uTime * 5.0 + q.x));
    col += vec3(1.0, 0.84, 0.55) * sparkle * 0.28;

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

function buildGrassGeometry() {
  const positions = [];
  const normals = [];
  const rng = mulberry32(3517);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng() * 0.4;
    const baseX = Math.cos(a) * 0.08;
    const baseZ = Math.sin(a) * 0.08;
    const width = 0.06 + rng() * 0.06;
    const h = 0.5 + rng() * 0.9;
    const leanX = Math.cos(a) * (0.18 + rng() * 0.32);
    const leanZ = Math.sin(a) * (0.18 + rng() * 0.32);
    const tipX = baseX + leanX;
    const tipZ = baseZ + leanZ;
    const nx = Math.cos(a + 0.5);
    const nz = Math.sin(a + 0.5);
    positions.push(
      baseX - nx * width, 0, baseZ - nz * width,
      baseX + nx * width, 0, baseZ + nz * width,
      tipX, h, tipZ,
    );
    const n = [nx * 0.3, 0.8, nz * 0.3];
    for (let k = 0; k < 3; k++) normals.push(...n);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geo;
}

function buildBushGeometry() {
  const parts = [];
  const rng = mulberry32(7123);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.IcosahedronGeometry(0.55 + rng() * 0.45, 0);
    g.scale(1.1, 0.8 + rng() * 0.5, 1.1);
    g.translate((rng() - 0.5) * 0.7, 0.45 + rng() * 0.3, (rng() - 0.5) * 0.7);
    parts.push(g);
  }
  return mergeGeometries(parts, false);
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

const CN = typeof window !== 'undefined' && !!window.__SCALEBOUND_CN__;

const CN_FOLIAGE = [
  { conifer: [0x365f59, 0x3f6c64, 0x4b7a6d, 0x2e504e, 0x597f73, 0x3a615b], broad: [0x8b8a58, 0x9d9464, 0xb0a06d, 0x74805b, 0xbe9e72], bush: [0x697a63, 0x7d886b, 0x8e9274, 0x6a705b], grass: [0x73806a, 0x879077, 0x969a80] },
  { conifer: [0x345b55, 0x416b62, 0x4e776b, 0x2c4c4b, 0x5b7f73, 0x3c5f59], broad: [0x7d8058, 0x8e8a61, 0xa09269, 0xb0a06f, 0x687553], bush: [0x60705b, 0x748064, 0x85896c, 0x5a6652], grass: [0x68785f, 0x7c886b, 0x8e9477] },
  { conifer: [0x385a51, 0x45675a, 0x537566, 0x2f4c47, 0x607f70, 0x426155], broad: [0xa38a55, 0xb4965c, 0x8f754b, 0x806a46, 0xc2a66a, 0x9b754d], bush: [0x7c6d4c, 0x897953, 0x97835b, 0x6e6248], grass: [0x7d8060, 0x8e8d6b, 0x9b9676] },
  { conifer: [0x4d6661, 0x5a746c, 0x668077, 0x3e5754, 0x748b81, 0x566e68], broad: [0xa6a08b, 0xb2ab96, 0x938b77, 0x847d6b, 0xbdb6a0], bush: [0x898577, 0x969183, 0xa39e90, 0x777369], grass: [0x8d8e83, 0x9b9c91, 0xa8a89d] },
];

const SEASON_FOLIAGE = [
  {
    conifer: [0x315a42, 0x3a6b4b, 0x477b51, 0x3f7451, 0x56855b, 0x416f48],
    broad: [0x6a9e4b, 0x7eae58, 0x96ba62, 0xa8c46c, 0x74a45a, 0x5f934b, 0xe2a6a5],
    bush: [0x4c8a46, 0x5d9a51, 0x77a65b, 0xbc8d75],
    grass: [0x5b8b49, 0x76a355, 0x8eaa5e, 0x9bb061],
  },
  {
    conifer: [0x2b563b, 0x346b45, 0x3f7650, 0x315f40, 0x4a8055, 0x396945],
    broad: [0x497c43, 0x5c904c, 0x6e9f53, 0x84ac5d, 0x94b561, 0x527f40],
    bush: [0x3f783e, 0x51884a, 0x659454, 0x789f5b],
    grass: [0x4e7e3d, 0x648d46, 0x7b9b4f, 0x8ba958],
  },
  {
    conifer: [0x365b3d, 0x426b45, 0x52794d, 0x3c5c3f, 0x5a8050, 0x476846],
    broad: [0xb8823f, 0xc6944c, 0x9d733c, 0x936738, 0xd0a458, 0xb65b3b, 0xcfa653],
    bush: [0x8d6a3e, 0xa57e46, 0xb5894d, 0x7c6d42],
    grass: [0x7f8848, 0x9b9550, 0xb19a58, 0x756f41],
  },
  {
    conifer: [0x3d5d50, 0x496b59, 0x577763, 0x355045, 0x647f6b, 0x4e675a],
    broad: [0x77786a, 0x8b8d7c, 0x676b5e, 0x9b9a8a, 0x7a7764, 0xa8a89a],
    bush: [0x6f7468, 0x828779, 0x959b8b, 0x5f655d],
    grass: [0x747b64, 0x8b9070, 0xa3a481, 0x6f7964],
  },
];
const SNOW_TINT = new THREE.Color(0xe8efea);

function treeColor(tree, season, snowCover) {
  const palette = (CN ? CN_FOLIAGE[season] : SEASON_FOLIAGE[season]) || (CN ? CN_FOLIAGE[2] : SEASON_FOLIAGE[2]);
  const list = tree.species === 0 ? palette.conifer : palette.broad;
  _color.setHex(list[Math.floor(tree.tint * list.length)]);
  _color.offsetHSL(0, 0.01 * (tree.tint - 0.5), (tree.tint - 0.5) * 0.05);
  if (tree.species === 1 && season === 0 && tree.tint > 0.9) _color.setHex(0xe2a6a5);
  if (snowCover > 0.02) _color.lerp(SNOW_TINT, Math.min(0.7, snowCover * (0.26 + tree.tint * 0.35)));
  return _color;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.scene.fog = new THREE.Fog(0xa3b8b2, 300, 900);
    this.fogColorTarget = new THREE.Color(0xa3b8b2);
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
    this.terrainUniforms = { season: { value: 2 }, snow: { value: 0 } };
    this.terrainMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uSeason = this.terrainUniforms.season;
      shader.uniforms.uSnowCover = this.terrainUniforms.snow;
      shader.uniforms.uChinese = { value: CN ? 1 : 0 };
      shader.vertexShader = 'varying vec3 vTWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
      shader.fragmentShader = 'varying vec3 vTWorld;\nuniform float uSeason;\nuniform float uSnowCover;\nuniform float uChinese;\n' + shader.fragmentShader;
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
        float greenness = smoothstep(0.02, 0.2, diffuseColor.g - diffuseColor.r);
        vec3 autumnTint = diffuseColor.rgb * vec3(1.48, 0.94, 0.30) + vec3(0.11, 0.05, 0.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, autumnTint, greenness * step(1.5, uSeason) * (1.0 - step(2.5, uSeason)) * 0.92);
        float winter = step(2.5, uSeason) * uSnowCover;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.91), greenness * winter * 0.95);
        if (uChinese > 0.5) {
          // C edition: broad mineral washes and height contours replace the
          // blocky per-quad checkerboard of the pixel editions.
          float h = vTWorld.y;
          float hm = smoothstep(-4.0, 150.0, h);
          vec3 valley = vec3(0.20, 0.28, 0.23);
          vec3 mid = vec3(0.34, 0.41, 0.30);
          vec3 peak = vec3(0.58, 0.56, 0.43);
          vec3 wash = mix(valley, mid, smoothstep(0.0, 0.55, hm));
          wash = mix(wash, peak, smoothstep(0.45, 1.0, hm));
          float contour = abs(fract(h * 0.115 + 0.04) - 0.5);
          float ink = 1.0 - smoothstep(0.035, 0.095, contour);
          wash = mix(wash, vec3(0.09, 0.12, 0.10), ink * 0.30);
          float brush = sin(vTWorld.x * 0.055 + vTWorld.z * 0.037) * sin(vTWorld.z * 0.071 - vTWorld.x * 0.021);
          wash += brush * 0.018 + (tn1 - 0.5) * 0.018;
          diffuseColor.rgb = wash;
        }
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
    this.season = -1;
    this.snowCover = 0;
    this.structureClearings = [];
    this.treeRecords = [];
    this.burnedTrees = new Set();
    this.windStrength = 0.2;
    this.fogNearTarget = 300;
    this.fogFarTarget = 900;
    this._lastFocus = new THREE.Vector3(Infinity, 0, Infinity);
    this._buildWater();
    this._buildClouds();
    this._buildProps();
    this.effects = new Effects(scene);
    this.wildlife = new Wildlife(scene);
    this.environment = new Environment(this);
    this.structures = new StructureField(scene, this);
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
        uSkyColor: { value: new THREE.Color(0x9fb8b0) },
        uSunColor: { value: new THREE.Color(0xffd28a) },
        uUnderwater: { value: 0 },
      },
      side: THREE.DoubleSide,
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
    const grassGeo = buildGrassGeometry();
    const bushGeo = buildBushGeometry();

    this.trunkMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide });
    this.leafUniforms = { time: { value: 0 }, strength: { value: 0.2 }, wind: { value: new THREE.Vector2(0.7, 0.4) } };
    this.grassMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide });
    this.grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = this.leafUniforms.time;
      shader.uniforms.uWindStrength = this.leafUniforms.strength;
      shader.uniforms.uWindDir = this.leafUniforms.wind;
      shader.vertexShader = 'uniform float uWindTime;\nuniform float uWindStrength;\nuniform vec2 uWindDir;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n        #ifdef USE_INSTANCING\n          float gphase = instanceMatrix[3].x * 0.3 + instanceMatrix[3].z * 0.27;\n        #else\n          float gphase = 0.0;\n        #endif\n        float gsway = sin(uWindTime * 2.1 + gphase) * uWindStrength;\n        transformed.x += (uWindDir.x * gsway) * (0.15 + transformed.y * 0.18);\n        transformed.z += (uWindDir.y * gsway) * (0.15 + transformed.y * 0.18);\n      `);
    };
    this.leafMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = this.leafUniforms.time;
      shader.uniforms.uWindStrength = this.leafUniforms.strength;
      shader.uniforms.uWindDir = this.leafUniforms.wind;
      shader.vertexShader = 'uniform float uWindTime;\nuniform float uWindStrength;\nuniform vec2 uWindDir;\nvarying vec3 vLeafWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float leafPhase = instanceMatrix[3].x * 0.23 + instanceMatrix[3].z * 0.19;
        #else
          float leafPhase = 0.0;
        #endif
        float sway = sin(uWindTime * 1.7 + leafPhase) * uWindStrength;
        float sway2 = cos(uWindTime * 2.3 + leafPhase * 1.4) * uWindStrength;
        transformed.x += (uWindDir.x * sway + uWindDir.y * sway2) * (0.18 + transformed.y * 0.045);
        transformed.z += (uWindDir.y * sway - uWindDir.x * sway2) * (0.18 + transformed.y * 0.045);
        #ifdef USE_INSTANCING
          vLeafWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vLeafWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif
      `);
      shader.fragmentShader = 'varying vec3 vLeafWorld;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n        if (distance(vLeafWorld, cameraPosition) < 4.2) discard;\n      ');
    };
    this.rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.bushMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide });

    const opts = { instanceMatrix: { usage: THREE.DynamicDrawUsage }, frustumCulled: false };
    this.trunkMesh = new THREE.InstancedMesh(trunkGeo, this.trunkMat, 7000);
    this.coniferMesh = new THREE.InstancedMesh(coniferGeo, this.leafMat, 4500);
    this.broadleafMesh = new THREE.InstancedMesh(broadleafGeo, this.leafMat, 4500);
    this.rockMesh = new THREE.InstancedMesh(rockGeo, this.rockMat, 1500);
    this.grassMesh = new THREE.InstancedMesh(grassGeo, this.grassMat, 7000);
    this.grassMesh.castShadow = false;
    this.bushMesh = new THREE.InstancedMesh(bushGeo, this.bushMat, 2200);
    this.bushMesh.castShadow = true;
    this.bushMesh.receiveShadow = true;
    for (const m of [this.trunkMesh, this.coniferMesh, this.broadleafMesh, this.rockMesh, this.grassMesh, this.bushMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    }
    this.coniferMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(4500 * 3), 3);
    this.broadleafMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(4500 * 3), 3);
    this.trunkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(7000 * 3), 3);
    this.rockMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(1500 * 3), 3);
    this.grassMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(7000 * 3), 3);
    this.bushMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2200 * 3), 3);
    this.trunkMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.coniferMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.broadleafMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.rockMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.grassMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.bushMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }

  _addChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (this.chunks.has(key)) return false;
    const data = generateChunk(cx, cz);
    const mesh = new THREE.Mesh(data.geometry, this.terrainMaterial);
    mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
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

  _inStructureClearing(x, z, extra = 0) {
    for (let i = 0; i < this.structureClearings.length; i++) {
      const c = this.structureClearings[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const rr = c.r + extra;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
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
    let gi = 0;
    let shi = 0;
    const season = this.environment?.season ?? 2;
    const snowCover = this.snowCover || 0;
    const maxDetail = DETAIL_RADIUS + 0.35;
    for (const chunk of this.chunks.values()) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (dx * dx + dz * dz > maxDetail * maxDetail) continue;
      const treeRng = mulberry32(hash2i(chunk.cx, chunk.cz, 1901));
      for (const tree of chunk.props.trees) {
        if (ti >= 7000) break;
        if (this._inStructureClearing(tree.x, tree.z, 4)) continue;
        const species = tree.species;
        const s = tree.scale;
        _dummy.position.set(tree.x, tree.y, tree.z);
        _dummy.rotation.set(tree.tilt, tree.rot, tree.tilt * 0.7);
        _dummy.scale.setScalar(s);
        _dummy.updateMatrix();
        const burnKey = `${Math.round(tree.x * 10)}:${Math.round(tree.z * 10)}`;
        const burned = this.burnedTrees.has(burnKey);
        if (species === 0) {
          if (ci >= 4500) continue;
          this.coniferMesh.setMatrixAt(ci, _dummy.matrix);
          treeColor(tree, season, snowCover);
          if (burned) _color.setHex(0x2c2922).offsetHSL(0.04, 0.05, (tree.tint - 0.5) * 0.05);
          this.coniferMesh.setColorAt(ci, _color);
          this.treeRecords.push({ mesh: this.coniferMesh, index: ci, x: tree.x, z: tree.z, top: tree.y + 8.2 * s, scale: s, key: burnKey, species });
          ci++;
        } else {
          if (bi >= 4500) continue;
          this.broadleafMesh.setMatrixAt(bi, _dummy.matrix);
          treeColor(tree, season, snowCover);
          if (burned) _color.setHex(0x302b22).offsetHSL(0.03, 0.04, (tree.tint - 0.5) * 0.05);
          this.broadleafMesh.setColorAt(bi, _color);
          this.treeRecords.push({ mesh: this.broadleafMesh, index: bi, x: tree.x, z: tree.z, top: tree.y + 7.0 * s, scale: s, key: burnKey, species });
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
        if (this._inStructureClearing(rock.x, rock.z, 2)) continue;
        _dummy.position.set(rock.x, rock.y, rock.z);
        _dummy.rotation.set((rock.tint - 0.5) * 0.3, rock.rot, (rock.tint - 0.5) * 0.2);
        _dummy.scale.set(rock.scale * 1.4, rock.scale * 0.75, rock.scale * 1.1);
        _dummy.updateMatrix();
        this.rockMesh.setMatrixAt(ri, _dummy.matrix);
        _color.setHex(0x7d7768).offsetHSL(0, 0, (rock.tint - 0.5) * 0.14);
        this.rockMesh.setColorAt(ri, _color);
        ri++;
      }
      const foliage = (CN ? CN_FOLIAGE[season] : SEASON_FOLIAGE[season]) || (CN ? CN_FOLIAGE[2] : SEASON_FOLIAGE[2]);
      for (const g of chunk.props.grass || []) {
        if (gi >= 7000) break;
        if (this._inStructureClearing(g.x, g.z, 0)) continue;
        _dummy.position.set(g.x, g.y + 0.06, g.z);
        _dummy.rotation.set(0, g.rot, 0);
        _dummy.scale.set(0.75 + g.tint * 0.65, g.scale, 0.75 + g.tint * 0.65);
        _dummy.updateMatrix();
        this.grassMesh.setMatrixAt(gi, _dummy.matrix);
        _color.setHex(foliage.grass[Math.floor(g.tint * foliage.grass.length)]);
        if (snowCover > 0.02) _color.lerp(SNOW_TINT, Math.min(0.65, snowCover * 0.35));
        this.grassMesh.setColorAt(gi, _color);
        gi++;
      }
      for (const bush of chunk.props.bushes || []) {
        if (shi >= 2200) break;
        if (this._inStructureClearing(bush.x, bush.z, 1)) continue;
        _dummy.position.set(bush.x, bush.y, bush.z);
        _dummy.rotation.set(0, bush.rot, 0);
        _dummy.scale.setScalar(bush.scale);
        _dummy.updateMatrix();
        this.bushMesh.setMatrixAt(shi, _dummy.matrix);
        _color.setHex(foliage.bush[Math.floor(bush.tint * foliage.bush.length)]);
        if (snowCover > 0.02) _color.lerp(SNOW_TINT, Math.min(0.6, snowCover * 0.32));
        this.bushMesh.setColorAt(shi, _color);
        shi++;
      }
    }
    this.trunkMesh.count = ti;
    this.coniferMesh.count = ci;
    this.broadleafMesh.count = bi;
    this.rockMesh.count = ri;
    this.grassMesh.count = gi;
    this.bushMesh.count = shi;
    for (const m of [this.trunkMesh, this.coniferMesh, this.broadleafMesh, this.rockMesh, this.grassMesh, this.bushMesh]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.propsDirty = false;
    this.lastPropsBuild = this.time;
  }

  igniteTreesAt(x, z, radius) {
    const hit = [];
    const max = 18;
    const r2 = radius * radius;
    for (const t of this.treeRecords) {
      if (hit.length >= max) break;
      if (this.burnedTrees.has(t.key)) continue;
      const dx = t.x - x, dz = t.z - z;
      if (dx * dx + dz * dz > r2) continue;
      this.burnedTrees.add(t.key);
      t.mesh.setColorAt(t.index, _color.setHex(t.species === 0 ? 0x27241f : 0x2b261f));
      if (t.mesh.instanceColor) t.mesh.instanceColor.needsUpdate = true;
      hit.push({ x: t.x, z: t.z, top: t.top, scale: t.scale, species: t.species });
      this.effects.emit(t.x, t.top, t.z, (Math.random() - 0.5) * 1.4, 2.0 + Math.random() * 2.5, (Math.random() - 0.5) * 1.4,
        Math.random() < 0.5 ? '#ffb04a' : '#ff6234', 0.22 + Math.random() * 0.3, 0.5 + Math.random() * 0.7, 0.3, 0.8);
    }
    return hit;
  }

  _updateFog(dt) {
    const fog = this.scene.fog;
    fog.near = lerp(fog.near, this.fogNearTarget, 1 - Math.exp(-1.4 * dt));
    fog.far = lerp(fog.far, this.fogFarTarget, 1 - Math.exp(-1.4 * dt));
    if (this.fogColorTarget) fog.color.lerp(this.fogColorTarget, 1 - Math.exp(-1.2 * dt));
    this.waterMaterial.uniforms.uFogNear.value = fog.near;
    this.waterMaterial.uniforms.uFogFar.value = fog.far;
    this.waterMaterial.uniforms.uFogColor.value.copy(fog.color);
  }

  setWind(strength, yaw = 0.8) {
    this.windStrength = strength;
    if (!this.leafUniforms) return;
    this.leafUniforms.strength.value = strength * 0.38;
    this.leafUniforms.wind.value.set(Math.sin(yaw), Math.cos(yaw));
    this.leafUniforms.time.value = this.time;
  }

  setSeason(season, snow = 0) {
    const nextSeason = season | 0;
    const seasonalChange = nextSeason !== this.season;
    const snowChange = Math.abs(snow - this.snowCover) > 0.18;
    if (!seasonalChange && !snowChange) return;
    this.season = nextSeason;
    this.snowCover = snow;
    if (this.terrainUniforms) {
      this.terrainUniforms.season.value = nextSeason;
      this.terrainUniforms.snow.value = snow;
    }
    this.propsDirty = true;
    this.lastPropsBuild = -1;
    this._rebuildPropsNow();
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
    this.time = time;
    this._lastFocus.copy(focusPos);
    if (this.environment) this.environment.update(dt, time, focusPos, camera, mode);
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
    this.spawnPoint = focusPos;
    this._updateFog(dt);
    this._generateNearby(focusPos);
    if (this.propsDirty && time - this.lastPropsBuild > 0.25) this._rebuildPropsNow();
    this._updateClouds(dt, time, camera);
    this.sky.update(camera, time);
    if (this.leafUniforms) this.leafUniforms.time.value = time;
    this.waterMaterial.uniforms.uTime.value = time;
    this.waterMaterial.uniforms.uSkyColor.value.copy(this.environment.colors.horizon);
    this.waterMesh.position.x = camera.position.x;
    this.waterMesh.position.z = camera.position.z;
    this.effects.update(dt);
    if (this.structures) { this.structures.update(focusPos, camera); this.structures.updateSmoke(dt, time); }
    return {};
  }

  setGameplayVisible(visible) {
    this.wildlife.setVisible(visible);
  }

  resetCreatures() {
    this.wildlife.reset(this.spawnPoint || this.spawn);
  }

  applyTerrainEdit(x, z, radius, amount, kind = 'raise') {
    addTerrainEdit(x, z, radius, amount, kind);
    const cs = CHUNK_SIZE;
    const affected = [];
    for (const [key, chunk] of [...this.chunks]) {
      const dx = (chunk.cx + 0.5) * cs - x;
      const dz = (chunk.cz + 0.5) * cs - z;
      if (Math.hypot(dx, dz) > radius + cs * 1.1) continue;
      affected.push([chunk.cx, chunk.cz]);
      this._removeChunk(key);
    }
    // Rebuild touched chunks immediately so the crater/mound is visible at once.
    for (const [cx, cz] of affected) this._addChunk(cx, cz);
    this.propsDirty = true;
    this.lastPropsBuild = -1;
    this._rebuildPropsNow();
  }

  sampleRegion(pos) {
    if (this.time - this.biomeCache.t > 0.55) {
      this.biomeCache = { t: this.time, data: regionAt(pos.x, pos.z) };
    }
    return this.biomeCache.data;
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
