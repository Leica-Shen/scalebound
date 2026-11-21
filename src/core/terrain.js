import * as THREE from 'three';
import {
  fbm2, ridged2, valueNoise2, hash2i, smoothstep, lerp, clamp, mulberry32,
} from './noise.js';
import { sampleTerrainEdits } from './terrain-edits.js';

export const WORLD_SEED = 20261121;
export const CHUNK_SIZE = 112;
export const CHUNK_SEGMENTS = 30;
export const SEA_LEVEL = 0;
export const RENDER_RADIUS = 8;
export const DETAIL_RADIUS = 5;
export const WATER_LEVEL = SEA_LEVEL;

const S = WORLD_SEED;

// The world is one continuous height field. These frequencies are laid out in
// physical metres: a mountain range is roughly 1.2 km across, a river ~600 m
// between bends, and a coastline ~6 km.
function baseHeightAt(x, z) {
  const w1 = fbm2(x * 0.00034 + 13.7, z * 0.00034 - 6.2, 2, S + 1);
  const w2 = fbm2(x * 0.00034 - 8.4, z * 0.00034 + 17.9, 2, S + 2);
  const wx = x + w1 * 160;
  const wz = z + w2 * 160;

  const continental = fbm2(wx * 0.00017 + 3.1, wz * 0.00017 - 9.4, 4, S + 11);
  const shelf = smoothstep(-0.3, 0.1, continental);
  let h = -54 + 102 * shelf + continental * 32;

  // broad rolling land
  h += fbm2(wx * 0.00062 + 21.2, wz * 0.00062 - 4.8, 3, S + 21) * 21 * shelf;
  h += fbm2(wx * 0.0019 - 7.7, wz * 0.0019 + 31.6, 3, S + 27) * 4.2 * shelf;

  // mountain belts, kept to ranges so valleys stay green
  const belt = fbm2(wx * 0.00043 + 41.3, wz * 0.00043 + 11.8, 4, S + 31);
  const mountainMask =
    smoothstep(0.24, 0.74, belt * 0.5 + 0.5) *
    smoothstep(-0.05, 0.17, continental) *
    smoothstep(-24, 4, h);
  const ridge = ridged2(wx * 0.00125 - 17.3, wz * 0.00125 + 8.1, 5, S + 41);
  h += Math.pow(ridge, 2.2) * 112 * mountainMask;
  h += Math.pow(ridge, 5.2) * 34 * mountainMask;
  // secondary crags make the horizon line feel mountainous rather than flat
  const crag = ridged2(wx * 0.0031 + 28.4, wz * 0.0031 - 17.9, 3, S + 46);
  h += (crag - 0.5) * 21 * mountainMask * shelf;
  h += fbm2(wx * 0.0042 - 13.2, wz * 0.0042 + 5.7, 3, S + 49) * 7.5 * shelf;

  // broad forest basins and shallow lakes
  const lakeField = fbm2(wx * 0.00105 + 22.6, wz * 0.00105 - 38.4, 3, S + 51);
  const lake = smoothstep(0.18, 0.52, lakeField) * (1 - smoothstep(38, 78, h)) * shelf;
  h -= lake * 38;
  h -= smoothstep(0.42, 0.84, fbm2(wx * 0.00051 - 8.7, wz * 0.00051 + 22.5, 3, S + 56)) * 20 * shelf;

  // carve waterways toward the sea
  const riverField = Math.abs(fbm2(wx * 0.00118 - 12.1, wz * 0.00118 + 25.7, 3, S + 61));
  const riverWidth = 0.055 + 0.026 * (fbm2(x * 0.00049 + 2, z * 0.00049 - 4, 2, S + 62) * 0.5 + 0.5);
  const river = smoothstep(riverWidth, 0.007, riverField);
  const lowland = 1 - smoothstep(46, 122, h);
  const riverMask = river * lowland * (0.74 + 0.26 * smoothstep(-20, 24, h));
  h = lerp(h, -9.5, riverMask * 0.97);

  // a few soft plateaus & coastal shelves
  const terrace = smoothstep(0.18, 0.9, fbm2(wx * 0.0014 + 61, wz * 0.0014 - 12, 2, S + 71) * 0.5 + 0.5);
  h += terrace * 5.5 * shelf * (1 - mountainMask);

  return h;
}

export function heightAt(x, z) {
  return sampleTerrainEdits(x, z, baseHeightAt(x, z));
}

export function baseTerrainHeightAt(x, z) {
  return baseHeightAt(x, z);
}

export function slopeAt(x, z, step = 4) {
  const hL = heightAt(x - step, z);
  const hR = heightAt(x + step, z);
  const hD = heightAt(x, z - step);
  const hU = heightAt(x, z + step);
  return Math.hypot((hR - hL) / (step * 2), (hU - hD) / (step * 2));
}

export function moistureAt(x, z) {
  return fbm2(x * 0.0007 - 19.2, z * 0.0007 + 8.3, 3, S + 88);
}

export function surfaceHeightAt(x, z) {
  // Slight extra clearance for the low-poly mesh's diagonal interpolation.
  return heightAt(x, z);
}

export function quantizeHeight(h) {
  // Terracing gives the landscape its stepped, pixel-art silhouette.
  if (h < -14) return Math.round(h / 3) * 3;
  if (h < 2) return Math.round(h / 0.9) * 0.9;
  if (h > 62) return Math.round(h / 2) * 2;
  return Math.round(h / 1.35) * 1.35;
}

// ── palette ────────────────────────────────────────────────────────────────
const C = (hex) => new THREE.Color(hex);
const PAL = {
  abyss: [C('#0b2129'), C('#102c35'), C('#12343b')],
  seafloor: [C('#183f43'), C('#1f4b48'), C('#28574d')],
  shallow: [C('#2f7968'), C('#3b8c75'), C('#4a9a80')],
  sand: [C('#c8b47d'), C('#d5c28b'), C('#bda76f')],
  wetSand: [C('#998b64'), C('#a99a70'), C('#8e815d')],
  dry: [C('#b99254'), C('#c8a164'), C('#a17d4b')],
  dryRock: [C('#8c6d48'), C('#9c7c53'), C('#765c40')],
  grass: [C('#6f9c44'), C('#7fa94e'), C('#608c3f')],
  meadow: [C('#98ad5b'), C('#a8b968'), C('#869f55')],
  forest: [C('#376642'), C('#41754a'), C('#2d593b')],
  moss: [C('#547d42'), C('#648c4a'), C('#496d3e')],
  rock: [C('#7b705d'), C('#8c7d67'), C('#665e50')],
  alpine: [C('#8f8673'), C('#9d917d'), C('#7b7364')],
  snow: [C('#eef2e7'), C('#faf6ea'), C('#d8e1da')],
  snowDeep: [C('#cfd9d2'), C('#dde3d8'), C('#bbc8c4')],
  ash: [C('#5e5148'), C('#6d5b4d'), C('#4f4540')],
  emberRock: [C('#62453d'), C('#704c3e'), C('#503b36')],
};

const HAS = (h, arr) => arr[Math.abs(Math.floor(h)) % arr.length];

function pick(palette, n) {
  const v = n * palette.length;
  const i = clamp(Math.floor(v), 0, palette.length - 1);
  return palette[i];
}

function rgbFromColor(c) {
  return c;
}

function faceColor(h, slope, moisture, pickN, n2) {
  // rock / cliffs
  const rockiness = smoothstep(1.2, 2.55, slope + (n2 - 0.5) * 0.4);
  if (h < -1.1) {
    if (h < -22) return pick(PAL.abyss, pickN);
    if (h < -7) return pick(PAL.seafloor, pickN);
    return pick(PAL.shallow, pickN);
  }
  if (h < 2.2) {
    return pick(h < 0.8 ? PAL.wetSand : PAL.sand, pickN);
  }
  if (h > 80) {
    if (rockiness > 0.62 || slope > 1.2) return pick(PAL.alpine, pickN);
    return pick(moisture > -0.05 ? PAL.snow : PAL.snowDeep, pickN);
  }
  if (h > 62) {
    if (moisture > 0.06 && rockiness < 0.5) return pick(PAL.alpine, pickN);
    return pick(rockiness > 0.52 ? PAL.rock : PAL.alpine, pickN);
  }
  if (h > 45) {
    if (rockiness > 0.64) return pick(PAL.rock, pickN);
    if (moisture > 0.14) return pick(PAL.forest, pickN);
    return pick(PAL.moss, pickN);
  }
  if (rockiness > 0.68) return pick(moisture > 0.04 ? PAL.forest : PAL.rock, pickN);
  if (h > 34) {
    if (moisture > 0.1) return pick(PAL.forest, pickN);
    if (moisture > -0.32) return pick(PAL.moss, pickN);
    return pick(PAL.dryRock, pickN);
  }
  if (moisture < -0.36) {
    if (h > 21) return pick(PAL.dryRock, pickN);
    return pick(PAL.dry, pickN);
  }
  if (moisture > 0.38 && h < 24) return pick(PAL.moss, pickN);
  if (moisture > 0.12) return pick(PAL.forest, pickN);
  if (moisture > -0.08) return pick(PAL.grass, pickN);
  return pick(PAL.meadow, pickN);
}

export function colorAt(x, z, h, slope, out = new THREE.Color()) {
  const m = moistureAt(x, z);
  const n = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
  const c = faceColor(h, slope, m, n, hash2i(Math.floor(x / 4), Math.floor(z / 4), S + 3));
  out.copy(c);
  // tiny value variation, kept in a tight palette-friendly range
  const v = 0.92 + n2(x, z) * 0.16;
  out.multiplyScalar(v);
  return out;
}

function n2(x, z) {
  return hash2i(Math.floor(x * 0.7), Math.floor(z * 0.7), S + 77);
}

// ── chunk geometry ─────────────────────────────────────────────────────────
export function generateChunk(cx, cz) {
  const seg = CHUNK_SEGMENTS;
  const size = CHUNK_SIZE;
  const ox = cx * size;
  const oz = cz * size;
  const step = size / seg;
  const gridN = seg + 1;
  const heights = new Float32Array(gridN * gridN);
  const moistureGrid = new Float32Array(gridN * gridN);

  for (let j = 0; j < gridN; j++) {
    for (let i = 0; i < gridN; i++) {
      const x = ox + i * step;
      const z = oz + j * step;
      heights[j * gridN + i] = quantizeHeight(heightAt(x, z));
      moistureGrid[j * gridN + i] = moistureAt(x, z);
    }
  }

  const quads = seg * seg;
  const positions = new Float32Array(quads * 18);
  const normals = new Float32Array(quads * 18);
  const colors = new Float32Array(quads * 18);
  const col = new THREE.Color();
  let ptr = 0;

  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const v00 = heights[j * gridN + i];
      const v10 = heights[j * gridN + i + 1];
      const v01 = heights[(j + 1) * gridN + i];
      const v11 = heights[(j + 1) * gridN + i + 1];
      const x0 = i * step;
      const x1 = (i + 1) * step;
      const z0 = j * step;
      const z1 = (j + 1) * step;
      const avg = (v00 + v10 + v01 + v11) * 0.25;
      const dx = (v10 + v11 - v00 - v01) / (2 * step);
      const dz = (v01 + v11 - v00 - v10) / (2 * step);
      const slope = Math.hypot(dx, dz);
      const nx = -dx;
      const ny = 1;
      const nz = -dz;
      const inv = 1 / Math.hypot(nx, ny, nz);

      const wx = ox + (i + 0.5) * step;
      const wz = oz + (j + 0.5) * step;
      const m = (moistureGrid[j * gridN + i] + moistureGrid[j * gridN + i + 1] +
        moistureGrid[(j + 1) * gridN + i] + moistureGrid[(j + 1) * gridN + i + 1]) * 0.25;
      const pickN = hash2i(i + cx * 31, j + cz * 31, S + 19);
      const color = faceColor(avg, slope, m, pickN, hash2i(i, j, S + 23));
      const variation = 0.93 + hash2i(i + cx * 7, j + cz * 7, S + 29) * 0.13;
      col.copy(color).multiplyScalar(variation);

      // two triangles, uniform per-quad colour for the pixel-terrace look
      const tris = [
        [x0, v00, z0], [x0, v01, z1], [x1, v11, z1],
        [x0, v00, z0], [x1, v11, z1], [x1, v10, z0],
      ];
      for (const [px, py, pz] of tris) {
        positions[ptr] = px;
        positions[ptr + 1] = py;
        positions[ptr + 2] = pz;
        normals[ptr] = nx * inv;
        normals[ptr + 1] = ny * inv;
        normals[ptr + 2] = nz * inv;
        colors[ptr] = col.r;
        colors[ptr + 1] = col.g;
        colors[ptr + 2] = col.b;
        ptr += 3;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  const props = generateProps(cx, cz, heights, gridN);
  return {
    cx,
    cz,
    geometry,
    props,
    minHeight: geometry.boundingBox.min.y,
    maxHeight: geometry.boundingBox.max.y,
  };
}

// ── props ─────────────────────────────────────────────────────────────────
function generateProps(cx, cz, heights, gridN) {
  const rng = mulberry32(((cx * 73856093) ^ (cz * 19349663) ^ S) >>> 0);
  const step = CHUNK_SIZE / CHUNK_SEGMENTS;
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const trees = [];
  const rocks = [];
  const grass = [];
  const bushes = [];

  const treeAttempts = 108;
  for (let k = 0; k < treeAttempts; k++) {
    const lx = rng() * CHUNK_SIZE;
    const lz = rng() * CHUNK_SIZE;
    const x = ox + lx;
    const z = oz + lz;
    const h = quantizeHeight(heightAt(x, z));
    if (h < 2.2 || h > 55) continue;
    const moisture = moistureAt(x, z);
    const slope = Math.abs(heightAt(x + 4, z) - heightAt(x - 4, z)) / 8 +
      Math.abs(heightAt(x, z + 4) - heightAt(x, z - 4)) / 8;
    if (slope > 1.1) continue;
    const forest = smoothstep(-0.12, 0.34, moisture);
    const patch = 0.55 + 0.45 * smoothstep(-0.35, 0.35, fbm2(x * 0.0037 + 4, z * 0.0037 - 8, 2, S + 201));
    const chance = (0.16 + forest * 0.88) * patch;
    if (rng() > chance) continue;
    if (trees.length >= 48) break;
    const conifer = (moisture > 0.08 || h > 26) ? rng() > 0.33 : rng() > 0.7;
    trees.push({
      x,
      z,
      y: h - 0.25,
      scale: 0.88 + rng() * 1.25,
      rot: rng() * Math.PI * 2,
      tilt: (rng() - 0.5) * 0.09,
      species: conifer ? 0 : 1,
      tint: rng(),
      autumn: moisture < -0.08 && rng() > 0.7,
    });
  }

  for (let k = 0; k < 16; k++) {
    const lx = rng() * CHUNK_SIZE;
    const lz = rng() * CHUNK_SIZE;
    const x = ox + lx;
    const z = oz + lz;
    const h = quantizeHeight(heightAt(x, z));
    if (h < -3 || h > 88) continue;
    const slope = Math.abs(heightAt(x + 3, z) - heightAt(x - 3, z)) / 6;
    if (slope > 1.8) continue;
    rocks.push({
      x, z, y: h - 0.4,
      scale: 0.8 + rng() * 3.1,
      rot: rng() * Math.PI * 2,
      tint: rng(),
    });
  }

  for (let k = 0; k < 62; k++) {
    const lx = rng() * CHUNK_SIZE;
    const lz = rng() * CHUNK_SIZE;
    const x = ox + lx;
    const z = oz + lz;
    const h = quantizeHeight(heightAt(x, z));
    if (h < 1.2 || h > 52) continue;
    if (moistureAt(x, z) < -0.3) continue;
    const slope = Math.abs(heightAt(x + 3, z) - heightAt(x - 3, z)) / 6 +
      Math.abs(heightAt(x, z + 3) - heightAt(x, z - 3)) / 6;
    if (slope > 1.25) continue;
    if (grass.length >= 40) break;
    grass.push({ x, z, y: h, scale: 0.65 + rng() * 1.4, rot: rng() * Math.PI * 2, tint: rng() });
  }

  for (let k = 0; k < 18; k++) {
    const lx = rng() * CHUNK_SIZE;
    const lz = rng() * CHUNK_SIZE;
    const x = ox + lx;
    const z = oz + lz;
    const h = quantizeHeight(heightAt(x, z));
    if (h < 2.5 || h > 44) continue;
    if (moistureAt(x, z) < -0.18) continue;
    const slope = Math.abs(heightAt(x + 3, z) - heightAt(x - 3, z)) / 6 +
      Math.abs(heightAt(x, z + 3) - heightAt(x, z - 3)) / 6;
    if (slope > 1.0) continue;
    if (bushes.length >= 9) break;
    bushes.push({ x, z, y: h - 0.1, scale: 0.7 + rng() * 1.45, rot: rng() * Math.PI * 2, tint: rng() });
  }

  return { trees, rocks, grass, bushes };
}

// ── places & lore ─────────────────────────────────────────────────────────
const REGIONS = {
  sea: { name: '沉星海', sub: '无垠的蔚蓝荒原', en: 'THE DROWNED STARS' },
  reef: { name: '珊瑚浅湾', sub: '潮汐在骨白色的礁石间呼吸', en: 'CORAL SHALLOWS' },
  coast: { name: '盐风滩涂', sub: '海与陆交界的金色边缘', en: 'SALTWIND COAST' },
  plain: { name: '金穗原野', sub: '风把长草吹成一整片海', en: 'GILDED PLAINS' },
  forest: { name: '雾隐林海', sub: '古老的树冠在脚下翻涌', en: 'MISTWOOD' },
  swamp: { name: '苔泽湿地', sub: '每一寸水面都藏着低语', en: 'MOSSWATER MARSH' },
  desert: { name: '烬色荒漠', sub: '被太阳遗忘的赭红大地', en: 'CINDER DESERT' },
  mountain: { name: '苍岚山脉', sub: '风蚀的群峰与云海', en: 'THE GREYVEIL RANGE' },
  high: { name: '霜脊群峰', sub: '世界屋脊，呼吸如刀', en: 'FROSTSPINE PEAKS' },
  snow: { name: '雪寂高原', sub: '连时间都被冻住的地方', en: 'SILENT SNOWFIELD' },
};

export function regionAt(x, z) {
  const h = heightAt(x, z);
  const slope = slopeAt(x, z, 18);
  const m = moistureAt(x, z);
  let id = 'plain';
  if (h < -8) id = 'sea';
  else if (h < 0.4) id = 'reef';
  else if (h < 5.2) id = 'coast';
  else if (h > 88) id = 'snow';
  else if (h > 57) id = 'high';
  else if (h > 33 || slope > 0.62) id = 'mountain';
  else if (m > 0.35 && h < 16) id = 'swamp';
  else if (m > 0.12) id = 'forest';
  else if (m < -0.28) id = 'desert';
  return { ...REGIONS[id], id, height: h, slope, moisture: m };
}

export function biomeIdAt(x, z) {
  return regionAt(x, z).id;
}

// Find a cinematic starting ridge: a high, open point near water with real
// mountains arranged along the horizon.
export function findSpawn(seed = S) {
  const rng = mulberry32(seed ^ 0x51ed270b);
  let best = null;
  const candidates = [];
  for (let k = 0; k < 74; k++) {
    const angle = rng() * Math.PI * 2;
    const radius = 900 + rng() * 4200;
    candidates.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  candidates.push([0, 0], [1600, 1200], [-2200, 900], [900, -1800]);

  for (const [x, z] of candidates) {
    const h = heightAt(x, z);
    if (h < 12 || h > 62) continue;
    const sl = slopeAt(x, z, 30);
    if (sl > 0.62) continue;
    let water = 0;
    let peaks = 0;
    let green = 0;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      for (const [rr, weight] of [[210, 1], [380, 0.8], [620, 0.55], [930, 0.28]]) {
        const hh = heightAt(x + Math.cos(ang) * rr, z + Math.sin(ang) * rr);
        if (hh < -2) water += weight;
        if (hh > 64) peaks += weight * (hh / 90);
        if (hh > 4 && hh < 38) green += weight;
      }
    }
    const score = water * 1.5 + peaks * 7.5 + green * 0.3 - sl * 8 + h * 0.1;
    if (!best || score > best.score) best = { x, z, h, score, water, peaks, green };
  }
  if (!best) best = { x: 0, z: 0, h: heightAt(0, 0), score: 0 };

  // look toward the most photogenic bearing (peaks + water in one frame)
  let bestBearing = 0;
  let bestVista = -Infinity;
  for (let a = 0; a < 28; a++) {
    const ang = (a / 28) * Math.PI * 2;
    let peaks = 0;
    let water = 0;
    for (const [rr, weight] of [[240, 1], [420, 1], [700, 0.8], [1050, 0.55], [1500, 0.25]]) {
      const hh = heightAt(best.x + Math.cos(ang) * rr, best.z + Math.sin(ang) * rr);
      if (hh > 50) peaks += (hh / 80) * weight;
      if (hh < -1) water += weight;
    }
    const vista = peaks * 3.2 + water * 0.7;
    if (vista > bestVista) { bestVista = vista; bestBearing = ang; }
  }
  return {
    x: best.x,
    z: best.z,
    y: Math.max(38, best.h + 56),
    terrain: best.h,
    yaw: bestBearing,
    score: best.score,
  };
}

export const BIOMES = REGIONS;
