import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, mulberry32 } from '../core/noise.js';
import { getGlowTexture } from '../core/textures.js';

// ───────────────────────────────────────────────────────────────────────────
// Shared sculpting primitives. Every dragon is assembled from the same
// vocabulary of chunky voxel parts, which keeps the nine silhouettes coherent.
// ───────────────────────────────────────────────────────────────────────────

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const SPIKE_GEO = new THREE.ConeGeometry(0.5, 1, 4, 1);
SPIKE_GEO.translate(0, 0.5, 0);
const OCTA_GEO = new THREE.OctahedronGeometry(0.5, 0);
const ICO_GEO = new THREE.IcosahedronGeometry(0.5, 0);

function addMesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.frustumCulled = true;
  parent.add(mesh);
  return mesh;
}

function box(parent, w, h, d, x, y, z, material, rx = 0, ry = 0, rz = 0) {
  const mesh = addMesh(parent, UNIT_BOX, material, x, y, z);
  mesh.scale.set(w, h, d);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

function spike(parent, w, h, d, x, y, z, material, rx = 0, ry = 0, rz = 0) {
  const mesh = addMesh(parent, SPIKE_GEO, material, x, y, z);
  mesh.scale.set(w, h, d);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

function shard(parent, scale, x, y, z, material, rx = 0, ry = 0, rz = 0) {
  const mesh = addMesh(parent, OCTA_GEO, material, x, y, z);
  mesh.scale.set(scale * 0.5, scale, scale * 0.42);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

function addMembraneOutline(parent, points, color, opacity = 0.55) {
  const pts = points.map(([x, y, z]) => new THREE.Vector3(x, y + 0.055, z));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    depthWrite: false,
    fog: true,
  });
  const line = new THREE.LineLoop(geo, mat);
  line.renderOrder = 1;
  parent.add(line);
}

function trianglePanel(parent, points, faces, material) {
  const positions = [];
  for (const [a, b, c] of faces) {
    positions.push(...points[a], ...points[b], ...points[c]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = true;
  parent.add(mesh);
  return mesh;
}

function finPanel(parent, length, height, material, thickness = 0.08) {
  // A vertical triangular sail along -Z.
  const pts = [
    [0, 0, 0],
    [0, 0, -length],
    [0, height, -length * 0.38],
    [0.001, 0, 0],
    [0.001, 0, -length],
    [0.001, height, -length * 0.38],
  ];
  const faces = [
    [0, 1, 2], [3, 4, 5],
    [0, 3, 4], [0, 4, 1],
    [1, 4, 5], [1, 5, 2],
    [2, 5, 3], [2, 3, 0],
  ];
  return trianglePanel(parent, pts, faces, material);
}

function polygonPanel(parent, points, material) {
  // convex-ish fan in the XZ plane, with a tiny vertical extrusion
  const pts = points.map(([x, z]) => [x, 0, z]);
  const top = pts.map(([x, , z]) => [x, 0.045, z]);
  const bottom = pts.map(([x, , z]) => [x, -0.045, z]);
  const all = [...top, ...bottom];
  const n = points.length;
  const faces = [];
  for (let i = 1; i < n - 1; i++) faces.push([0, i, i + 1]);
  for (let i = 1; i < n - 1; i++) faces.push([n, n + i + 1, n + i]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, n + i, n + j], [i, n + j, j]);
  }
  return trianglePanel(parent, all, faces, material);
}

function createFeatherGeometry() {
  // +X points to the feather tip. Root is at x=0.
  const p = [
    0, -0.04, -0.5, // 0 root bottom left
    0, 0.04, -0.5, // 1 root top left
    0, 0.04, 0.5, // 2 root top right
    0, -0.04, 0.5, // 3 root bottom right
    0.56, -0.028, -0.29, // 4 mid bottom left
    0.56, 0.028, -0.29, // 5 mid top left
    0.56, 0.028, 0.29, // 6 mid top right
    0.56, -0.028, 0.29, // 7 mid bottom right
    1.0, 0, 0.06, // 8 tip
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], // root cap
    [0, 4, 5], [0, 5, 1], // left side
    [1, 5, 6], [1, 6, 2], // top
    [2, 6, 7], [2, 7, 3], // right
    [3, 7, 4], [3, 4, 0], // bottom
    [4, 8, 5], [5, 8, 6], [6, 8, 7], [7, 8, 4], // tip pyramid
  ];
  const positions = [];
  for (const [a, b, c] of faces) {
    positions.push(p[a * 3], p[a * 3 + 1], p[a * 3 + 2]);
    positions.push(p[b * 3], p[b * 3 + 1], p[b * 3 + 2]);
    positions.push(p[c * 3], p[c * 3 + 1], p[c * 3 + 2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

const FEATHER_GEO = createFeatherGeometry();

function coloredFeather(originX, originZ, yaw, length, width, color, y = 0, thickness = 0.11) {
  const geo = FEATHER_GEO.clone();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
  m.compose(
    new THREE.Vector3(originX, y, originZ),
    q,
    new THREE.Vector3(length, thickness, width),
  );
  geo.applyMatrix4(m);
  geo.computeVertexNormals();
  const c = new THREE.Color(color);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function mergeColored(geos, material) {
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, material);
  mesh.frustumCulled = true;
  return mesh;
}

// ───────────────────────────────────────────────────────────────────────────
// Materials
// ───────────────────────────────────────────────────────────────────────────
function makeMaterials(catalog) {
  const p = catalog.palette;
  const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({
    color: new THREE.Color(color),
    flatShading: true,
    fog: true,
    ...extra,
  });
  const membraneOpacity =
    catalog.model.wing.type === 'crystal' ? 0.42 :
    catalog.model.wing.type === 'ribbon' ? 0.55 :
    catalog.model.wing.type === 'fin' ? 0.72 : 1.0;
  const membrane = lambert(p.membrane, {
    transparent: membraneOpacity < 1,
    opacity: membraneOpacity,
    side: THREE.DoubleSide,
    depthWrite: membraneOpacity > 0.65,
    emissive: new THREE.Color(p.accent).multiplyScalar(0.17),
  });
  const featherMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  const crystalMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
    transparent: true,
    opacity: 0.84,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: true,
  });
  const eye = new THREE.MeshBasicMaterial({
    color: new THREE.Color(p.eye),
    toneMapped: false,
    fog: true,
  });
  const glow = new THREE.MeshBasicMaterial({
    color: new THREE.Color(p.glow),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: new THREE.Color(p.metal || p.accent),
    flatShading: true,
    roughness: 0.48,
    metalness: 0.38,
    fog: true,
  });
  const bands = (p.bands || []).map((color) => lambert(color));

  return {
    base: lambert(p.base, { emissive: new THREE.Color(p.base).multiplyScalar(0.1) }),
    dark: lambert(p.dark, { emissive: new THREE.Color(p.dark).multiplyScalar(0.06) }),
    light: lambert(p.light),
    belly: lambert(p.belly),
    accent: lambert(p.accent),
    accent2: lambert(p.accent2),
    horn: lambert(p.horn),
    membrane,
    membraneLight: lambert(p.membraneLight, {
      transparent: membraneOpacity < 1,
      opacity: Math.min(1, membraneOpacity + 0.14),
      side: THREE.DoubleSide,
      depthWrite: membraneOpacity > 0.65,
    }),
    feather: featherMaterial,
    crystal: crystalMaterial,
    eye,
    glow,
    metal,
    bands,
    palette: p,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Body
// ───────────────────────────────────────────────────────────────────────────
function buildBody(inner, cfg, mats, rig) {
  const bodyGroup = new THREE.Group();
  inner.add(bodyGroup);
  rig.bodyGroup = bodyGroup;
  const L = cfg.body.length;
  const W = cfg.body.width;
  const H = cfg.body.height;
  const N = cfg.body.segments;
  const segLen = L / N;
  const serpentine = !!cfg.body.serpentine;
  const muscular = !!cfg.body.muscular;
  rig.dimensions = { L, W, H, segLen };

  const widths = [];
  const bodyMats = [];
  if (cfg.pattern === 'iridescent' && mats.bands.length) {
    const base = new THREE.Color(mats.palette.base);
    for (let i = 0; i < 5; i++) {
      const c = base.clone().lerp(new THREE.Color(mats.palette.bands[i]), 0.34);
      bodyMats.push(new THREE.MeshLambertMaterial({ color: c, flatShading: true, fog: true }));
    }
  }

  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N; // 0 = tail, 1 = head
    const z = -L * 0.5 + u * L;
    let wf;
    if (serpentine) {
      wf = 0.78 + u * 0.18 + Math.sin(u * Math.PI * 2) * 0.035;
    } else if (muscular) {
      wf = 0.78 + u * 0.28 + Math.sin(u * Math.PI) * 0.06;
    } else {
      wf = 0.74 + u * 0.26;
    }
    const hf = (serpentine ? 0.86 : 0.82) + Math.sin(u * Math.PI) * 0.12 + u * 0.10;
    const w = W * wf;
    const h = H * hf;
    widths.push(w);

    let material = mats.base;
    if (cfg.pattern === 'iridescent' && bodyMats.length) {
      material = bodyMats[i % bodyMats.length];
    } else if (cfg.pattern === 'stripes' && i % 2 === 1) {
      material = mats.dark;
    } else if (i < 2) {
      material = mats.dark;
    }
    box(bodyGroup, w, h, segLen * 1.05, 0, 0, z, material);
    // angular, stepped scales along the flanks
    box(bodyGroup, w * 0.52, h * 0.13, segLen * 0.98, 0, h * 0.5, z, mats.light);
    box(bodyGroup, w * 0.72, h * 0.2, segLen * 0.92, 0, -h * 0.51, z, mats.belly);
    box(bodyGroup, w * 0.34, h * 0.13, segLen * 0.86, 0, h * 0.59, z, i % 3 === 0 ? mats.dark : mats.base);

    // side scutes
    for (const s of [-1, 1]) {
      box(
        bodyGroup,
        w * 0.06, h * 0.38, segLen * 0.78,
        s * w * 0.49, h * 0.02, z,
        i % 2 ? mats.light : mats.dark,
        0, 0, s * 0.12,
      );
    }

    // broad shoulder / hip plates
    if (u > 0.72 && !serpentine) {
      for (const s of [-1, 1]) {
        box(bodyGroup, w * 0.18, h * 0.55, segLen * 0.9, s * w * 0.48, h * 0.02, z, mats.dark, 0, 0, s * 0.18);
      }
    }
    if (u < 0.24) {
      for (const s of [-1, 1]) {
        box(bodyGroup, w * 0.3, h * 0.72, segLen * 1.05, s * w * 0.3, -h * 0.04, z, mats.base);
      }
    }

    if (u > 0.54) {
      // keel of the chest
      box(bodyGroup, w * 0.55, h * 0.24, segLen * 0.9, 0, -h * 0.57, z, mats.belly);
    }
  }

  // shoulder musculature under the wing roots
  for (const s of [-1, 1]) {
    box(bodyGroup, W * 0.3, H * 0.38, L * 0.18, s * W * 0.27, H * 0.15, L * 0.18, mats.dark, 0, 0, s * 0.22);
  }
  // hips
  for (const s of [-1, 1]) {
    box(bodyGroup, W * 0.24, H * 0.5, L * 0.2, s * W * 0.33, -H * 0.05, -L * 0.29, mats.base, 0, 0, s * 0.12);
  }

  // chest keel
  const chest = new THREE.Group();
  chest.position.set(0, H * 0.22, L * 0.49);
  inner.add(chest);
  rig.chest = chest;

  // scale accents / back plates
  if (cfg.pattern === 'scales' || cfg.pattern === 'iridescent' || cfg.pattern === 'leaf') {
    const scaleMat = cfg.pattern === 'leaf' ? mats.accent2 : mats.light;
    for (let i = 1; i < N - 1; i++) {
      const u = (i + 0.5) / N;
      const z = -L * 0.5 + u * L;
      for (const s of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          box(
            bodyGroup,
            W * 0.035, H * 0.12, segLen * 0.3,
            s * (widths[i] * 0.4 + k * 0.04), H * (0.18 - k * 0.2), z + (k - 0.5) * segLen * 0.3,
            scaleMat, 0, s * 0.18, s * 0.25,
          );
        }
      }
    }
  } else if (cfg.pattern === 'stars') {
    const rng = mulberry32(5519);
    for (let i = 0; i < 18; i++) {
      const onSide = i % 2 === 0;
      const s = i % 4 === 0 ? 1 : -1;
      const z = (rng() - 0.7) * L * 0.8;
      const y = H * (rng() * 0.5 - 0.1);
      if (onSide) {
        box(bodyGroup, 0.025, 0.11, 0.11, s * W * 0.51, y, z, i % 3 === 0 ? mats.accent2 : mats.metal, 0, 0, 0);
      } else {
        box(bodyGroup, 0.1, 0.025, 0.1, (rng() - 0.5) * W * 0.5, H * 0.5, z, mats.metal);
      }
    }
  } else if (cfg.pattern === 'embers') {
    const rng = mulberry32(9157);
    for (let i = 0; i < 13; i++) {
      const s = i % 2 === 0 ? 1 : -1;
      const z = (rng() - 0.5) * L * 0.84;
      const y = H * (rng() * 0.42 - 0.12);
      const mesh = box(
        bodyGroup,
        0.035, 0.055 + rng() * 0.08, 0.28 + rng() * 0.55,
        s * W * (0.43 + rng() * 0.08), y, z,
        mats.glow, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.5,
      );
      mesh.renderOrder = 2;
    }
    // larger charred plates with ember seams
    for (const s of [-1, 1]) {
      box(bodyGroup, 0.06, H * 0.1, L * 0.34, s * W * 0.5, H * 0.27, -L * 0.07, mats.dark, 0, 0, s * 0.25);
    }
  }

  if (cfg.pattern === 'stripes') {
    for (const zf of [-0.28, 0.02, 0.3]) {
      box(bodyGroup, W * 0.88, H * 0.06, 0.12, 0, H * 0.45, L * zf, mats.accent);
      box(bodyGroup, W * 0.64, H * 0.06, 0.1, 0, -H * 0.45, L * zf, mats.accent2);
    }
  }
  if (cfg.pattern === 'stars') {
    // golden collarbands of the Babylonian gate
    for (const zf of [-0.28, 0.0, 0.26]) {
      box(bodyGroup, W * 0.92, H * 0.95, 0.1, 0, 0, L * zf, mats.metal);
    }
  }

  // ribs for gaunt or muscular silhouettes
  if (cfg.extra.ribs) {
    for (let i = 0; i < 5; i++) {
      const u = 0.25 + i * 0.11;
      const z = -L * 0.5 + u * L;
      for (const s of [-1, 1]) {
        box(bodyGroup, 0.055, H * 0.4, 0.06, s * W * 0.53, -H * 0.1, z, i % 2 ? mats.horn : mats.light, 0, -s * 0.25, s * 0.55);
      }
    }
  }

  // shoulder base plates for wing roots
  for (const s of [-1, 1]) {
    box(bodyGroup, W * 0.2, H * 0.22, L * 0.2, s * W * 0.35, H * 0.34, L * 0.17, mats.accent, 0, 0, s * 0.1);
  }

  buildDorsalSpines(bodyGroup, cfg, mats, L, H);
  rig.dorsalMaterial = mats.accent;
}

function buildDorsalSpines(parent, cfg, mats, L, H) {
  const style = cfg.back.spikes;
  if (!style || style === 'none') return;
  const count = cfg.back.count;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const z = -L * 0.42 + t * L * 0.82;
    const falloff = 0.45 + Math.sin(t * Math.PI) * 0.75;
    if (style === 'fin' || style === 'leaf') {
      const mat = style === 'leaf' ? mats.accent2 : mats.accent;
      const fin = finPanel(parent, L * 0.066, H * (0.34 + 0.2 * falloff), mat);
      fin.position.set(0, H * 0.48, z);
      fin.scale.set(0.9, falloff, 1);
      if (style === 'leaf') fin.rotation.z = 0.08;
    } else if (style === 'crystal') {
      const c = shard(parent, H * 0.4, 0, H * 0.57, z, mats.crystal || mats.accent2, -0.2 + t * 0.08, 0.2, 0);
      c.rotation.x = -0.15;
      if (i % 2) shard(parent, H * 0.24, 0, H * 0.67, z - L * 0.02, mats.membraneLight);
    } else if (style === 'gold') {
      const sp = spike(parent, H * 0.1, H * (0.3 + 0.24 * falloff), H * 0.22, 0, H * 0.48, z, mats.metal, -0.18, 0, 0);
      sp.rotation.x = -0.2;
    } else if (style === 'bone') {
      const sp = spike(parent, H * 0.09, H * (0.4 + 0.38 * falloff), H * 0.2, 0, H * 0.48, z, mats.horn, -0.2, 0, 0);
      sp.rotation.z = (i % 2 ? 1 : -1) * 0.08;
    } else {
      const sp = spike(parent, H * 0.12, H * (0.32 + 0.3 * falloff), H * 0.26, 0, H * 0.48, z, mats.accent, -0.18, 0, 0);
      sp.rotation.z = (i % 2 ? 1 : -1) * 0.04;
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Neck & head
// ───────────────────────────────────────────────────────────────────────────
function buildNeck(inner, cfg, mats, rig) {
  const { W, H, L } = rig.dimensions;
  const nCfg = cfg.neck;
  const root = new THREE.Group();
  root.position.set(0, H * 0.24, L * 0.48);
  inner.add(root);
  let parent = root;
  const segLen = nCfg.length / nCfg.count;
  const segments = [];
  const basePitch = [];
  for (let i = 0; i < nCfg.count; i++) {
    const t = nCfg.count === 1 ? 0 : i / (nCfg.count - 1);
    const g = new THREE.Group();
    if (i > 0) g.position.z = segLen * 0.96;
    const baseX = lerp(-0.37, 0.13, t) * nCfg.curve;
    g.rotation.x = baseX;
    parent.add(g);
    parent = g;
    segments.push(g);
    basePitch.push(baseX);

    const taper = 1 - t * 0.42;
    const w = nCfg.width * taper;
    const h = nCfg.width * 1.1 * taper;
    box(g, w, h, segLen * 1.08, 0, 0, segLen * 0.5, i % 2 ? mats.base : mats.light);
    box(g, w * 0.64, h * 0.2, segLen * 0.94, 0, -h * 0.52, segLen * 0.5, mats.belly);
    box(g, w * 0.24, h * 0.15, segLen * 0.8, 0, h * 0.56, segLen * 0.5, i % 2 ? mats.dark : mats.base);
    for (const s of [-1, 1]) {
      box(g, w * 0.07, h * 0.3, segLen * 0.66, s * w * 0.46, 0, segLen * 0.5, mats.light, 0, 0, s * 0.18);
    }
    // scale plates
    if (i % 2 === 0 && cfg.pattern !== 'none') {
      box(g, w * 0.5, 0.035, segLen * 0.22, 0, h * 0.51, segLen * 0.48, mats.accent, 0, 0, 0);
    }
    addNeckMane(g, nCfg.mane, mats, cfg, w, h, segLen, t);
    // little throat whiskers / frills
    if (nCfg.mane === 'fin' || nCfg.mane === 'golden') {
      for (const s of [-1, 1]) {
        const fin = finPanel(g, segLen * 0.7, h * 0.8, nCfg.mane === 'golden' ? mats.accent : mats.accent2);
        fin.position.set(s * w * 0.32, -h * 0.15, segLen * 0.3);
        fin.scale.x = 0.7;
      }
    }
  }

  // head pivot at the end of the chain
  const head = new THREE.Group();
  head.position.z = segLen * 0.98;
  const cumulative = basePitch.reduce((a, b) => a + b, 0);
  head.rotation.x = -cumulative + 0.06;
  head.rotation.y = 0;
  parent.add(head);
  rig.neck = segments;
  rig.neckBaseX = basePitch;
  rig.neckRoot = root;
  rig.head = head;
  rig.headBaseX = head.rotation.x;
  rig.headBaseY = head.rotation.y;
  rig.neckCumulative = cumulative;

  const headParts = buildHead(head, cfg, mats, cfg.head.scale);
  rig.jaw = headParts.jaw;
  rig.jawBase = headParts.jaw.rotation.x;
  rig.eyes = headParts.eyes;
  rig.frills = headParts.frills;
  rig.hornGroups = headParts.hornGroups;
  rig.headParts = headParts;
  rig.whiskers = headParts.whiskers;

  buildExtraHeads(inner, cfg, mats, rig);
  return head;
}

function addNeckMane(parent, type, mats, cfg, w, h, segLen, t) {
  if (!type || type === 'none') return;
  const count = type === 'spines' ? 1 : 2;
  for (let k = 0; k < count; k++) {
    const s = k === 0 ? 1 : -1;
    const z = segLen * (0.4 + k * 0.16);
    if (type === 'spines' || type === 'fin') {
      const m = finPanel(parent, segLen * 0.85, h * (1.0 - t * 0.25), type === 'fin' ? mats.accent2 : mats.accent);
      m.position.set(s * w * 0.28, h * 0.38, z + segLen * 0.1);
      m.rotation.x = 0.32;
      m.rotation.z = s * (type === 'fin' ? 0.42 : 0.2);
    } else if (type === 'crystal') {
      shard(parent, h * 0.72, s * w * 0.48, h * 0.24, z, mats.membraneLight, 0.2, s * 0.3, 0.2);
      if (k === 0) box(parent, 0.028, h * 0.6, 0.05, s * w * 0.46, h * 0.1, z, mats.glow, 0.2, 0, 0.2);
    } else {
      const colorMat = type === 'golden' ? mats.accent : (type === 'leaf' ? mats.accent2 : mats.feather);
      if (type === 'feathers' || type === 'golden' || type === 'leaf' || !colorMat.isMeshLambertMaterial) {
        const yaw = s > 0 ? 1.25 : Math.PI - 1.25;
        const geos = [];
        for (let j = 0; j < 2; j++) {
          const c = type === 'golden' ? (j ? mats.palette.accent : mats.palette.metal) :
            type === 'leaf' ? (j ? mats.palette.accent2 : mats.palette.accent) :
            (j ? mats.palette.accent2 : mats.palette.light);
          geos.push(coloredFeather(s * w * 0.3, z + j * 0.1, yaw, segLen * (1.05 + j * 0.15), h * 0.34, c, h * 0.28 + j * 0.06, 0.08));
        }
        const mesh = mergeColored(geos, mats.feather);
        if (mesh) parent.add(mesh);
      } else {
        const mesh = spike(parent, 0.1, h * 0.7, 0.12, s * w * 0.4, h * 0.25, z, mats.accent, -0.15, 0, s * 0.5);
        mesh.rotation.x = 0.35;
      }
    }
  }
}

function buildHead(parent, cfg, mats, scale) {
  const hc = cfg.head;
  const s = scale * 1.1;
  const head = new THREE.Group();
  parent.add(head);
  const parts = { group: head, eyes: [], frills: [], hornGroups: [], whiskers: [], jaw: null, teeth: [] };

  const headW = 0.86 * s;
  const headH = 0.68 * s;
  const snoutKind = hc.snout;
  const snoutLen = (snoutKind === 'croc' ? 1.1 : snoutKind === 'imperial' ? 0.88 : snoutKind === 'serpent' ? 0.82 : 0.94) * s;

  // cranium and cheeks
  box(head, headW, headH, 0.82 * s, 0, 0, 0.25 * s, mats.base);
  box(head, headW * 0.86, headH * 0.72, 0.5 * s, 0, 0.12 * s, 0.53 * s, mats.light);
  box(head, headW * 0.34, headH * 0.75, 0.3 * s, 0, 0.03 * s, 0.68 * s, mats.dark);
  for (const sd of [-1, 1]) {
    box(head, headW * 0.24, headH * 0.52, 0.52 * s, sd * headW * 0.44, 0.0, 0.2 * s, mats.base);
    box(head, headW * 0.19, headH * 0.16, 0.35 * s, sd * headW * 0.36, headH * 0.3, 0.35 * s, mats.accent);
  }

  // upper snout
  box(head, headW * 0.58, headH * 0.47, snoutLen, 0, -0.04 * s, 0.57 * s + snoutLen * 0.5, mats.base);
  box(head, headW * 0.46, headH * 0.2, snoutLen * 0.96, 0, 0.16 * s, 0.57 * s + snoutLen * 0.5, mats.light);
  box(head, headW * 0.5, headH * 0.18, snoutLen * 0.5, 0, -0.25 * s, 0.57 * s + snoutLen * 0.42, mats.dark);
  // nose tip
  box(head, headW * 0.44, headH * 0.32, 0.14 * s, 0, -0.03 * s, 0.57 * s + snoutLen + 0.02 * s, mats.dark);
  for (const sd of [-1, 1]) {
    box(head, 0.06 * s, 0.06 * s, 0.06 * s, sd * headW * 0.17, 0.05 * s, 0.57 * s + snoutLen - 0.03 * s, mats.glow);
  }
  if (snoutKind === 'croc') {
    for (let i = 0; i < 4; i++) {
      for (const sd of [-1, 1]) {
        box(head, 0.09 * s, 0.035 * s, 0.08 * s, sd * headW * 0.21, 0.13 * s, 0.72 * s + i * snoutLen * 0.18, mats.light);
      }
    }
  }

  // brow & eyes
  const eyeGlowMat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color: new THREE.Color(mats.palette.eye),
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: true,
  });
  for (const sd of [-1, 1]) {
    box(head, 0.25 * s * hc.eye, 0.2 * s * hc.eye, 0.23 * s, sd * headW * 0.35, headH * 0.2, 0.47 * s, mats.dark, 0, 0, sd * -0.16);
    const eye = box(head, 0.15 * s * hc.eye, 0.085 * s * hc.eye, 0.055 * s, sd * headW * 0.46, headH * 0.22, 0.58 * s, mats.eye, 0, 0, sd * -0.1);
    eye.userData.baseScaleY = eye.scale.y;
    parts.eyes.push(eye);
    const glow = new THREE.Sprite(eyeGlowMat);
    glow.position.set(sd * headW * 0.53, headH * 0.22, 0.64 * s);
    glow.scale.setScalar(0.44 * s * hc.eye);
    glow.userData.isGlow = true;
    glow.userData.baseScaleX = glow.scale.x;
    glow.userData.baseScaleY = glow.scale.y;
    head.add(glow);
    parts.eyes.push(glow);
    box(head, 0.045 * s, 0.08 * s, 0.03 * s, sd * headW * 0.51, headH * 0.22, 0.605 * s, mats.dark, 0, 0, 0);
    box(head, headW * 0.32, headH * 0.13, 0.28 * s, sd * headW * 0.3, headH * 0.38, 0.42 * s, mats.horn, 0, 0, sd * -0.32);
    box(head, 0.045 * s, headH * 0.22, 0.46 * s, sd * headW * 0.49, -headH * 0.13, 0.28 * s, mats.accent);
    // cheek spike / dewclaw of the jaw
    spike(head, 0.075 * s, 0.34 * s, 0.075 * s, sd * headW * 0.48, -headH * 0.12, 0.17 * s, mats.horn, 0.4, 0, sd * 1.25);
    spike(head, 0.055 * s, 0.23 * s, 0.055 * s, sd * headW * 0.43, -headH * 0.16, -0.03 * s, mats.horn, 0.8, 0, sd * 1.1);
  }
  // upper lip and a hint of a mouth gap
  box(head, headW * 0.62, 0.055 * s, snoutLen * 0.85, 0, -headH * 0.22, 0.58 * s + snoutLen * 0.48, mats.dark);
  box(head, headW * 0.56, 0.08 * s, snoutLen * 0.65, 0, -headH * 0.27, 0.6 * s + snoutLen * 0.38, mats.dark, 0.02, 0, 0);

  // lower jaw
  const jaw = new THREE.Group();
  jaw.position.set(0, -headH * 0.4, 0.08 * s);
  head.add(jaw);
  jaw.rotation.x = 0.03;
  box(jaw, headW * 0.56, headH * 0.26, snoutLen * 0.9, 0, -0.03 * s, 0.36 * s + snoutLen * 0.44, mats.base);
  box(jaw, headW * 0.48, headH * 0.11, snoutLen * 0.72, 0, -0.115 * s, 0.36 * s + snoutLen * 0.4, mats.belly);
  box(jaw, headW * 0.44, headH * 0.12, snoutLen * 0.64, 0, 0.05 * s, 0.4 * s + snoutLen * 0.38, mats.dark);
  box(jaw, headW * 0.24, 0.06 * s, snoutLen * 0.5, 0, 0.02 * s, 0.44 * s + snoutLen * 0.34, mats.accent2);
  // jaw tendrils
  for (const sd of [-1, 1]) {
    box(jaw, 0.06 * s, 0.12 * s, 0.22 * s, sd * headW * 0.25, -0.13 * s, 0.1 * s, mats.accent, 0, 0, sd * 0.25);
  }
  // teeth
  const toothCount = snoutKind === 'croc' ? 5 : 4;
  for (let i = 0; i < toothCount; i++) {
    for (const sd of [-1, 1]) {
      const t = spike(jaw, 0.05 * s, 0.12 * s, 0.05 * s, sd * headW * 0.18, 0.13 * s, 0.54 * s + i * snoutLen * 0.12, mats.horn, Math.PI, 0, 0);
      t.visible = hc.teeth !== false;
    }
  }
  for (let i = 0; i < 3; i++) {
    for (const sd of [-1, 1]) {
      spike(head, 0.04 * s, 0.1 * s, 0.04 * s, sd * headW * 0.2, -0.26 * s, 0.72 * s + i * snoutLen * 0.18, mats.horn, Math.PI, 0, 0);
    }
  }
  parts.jaw = jaw;

  // horns
  buildHorns(head, hc, mats, s, parts);

  // frills / ears
  buildFrills(head, hc, mats, s, parts);

  // mane
  buildHeadMane(head, hc, mats, s, cfg);

  // crest
  if (hc.horn === 'crest' || hc.frill === 'fin') {
    finPanel(head, 0.6 * s, 0.34 * s, mats.accent).position.set(0, headH * 0.45, 0.15 * s);
  }
  // beard
  if (hc.beard) {
    for (const sd of [-1, 1]) {
      const geos = [];
      geos.push(coloredFeather(sd * headW * 0.18, -headH * 0.32, sd > 0 ? Math.PI * 0.85 : Math.PI * 0.15, 0.65 * s, 0.28 * s, mats.palette.accent, 0, 0.08));
      const mesh = mergeColored(geos, mats.feather);
      if (mesh) {
        mesh.position.z = 0.55 * s;
        head.add(mesh);
      }
    }
  }
  buildWhiskers(head, hc, mats, s, cfg, parts);
  return parts;
}

function buildHorns(head, hc, mats, s, parts) {
  const type = hc.horn;
  const count = hc.hornCount || 2;
  const scale = hc.hornScale || 1;
  const hw = 0.86 * s;
  const hh = 0.68 * s;
  const makeBranch = (parent, len, thick, mat, x, y, z, tiltX, tiltZ) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.x = tiltX;
    g.rotation.z = tiltZ;
    parent.add(g);
    box(g, thick, len, thick * 0.9, 0, len * 0.5, 0, mat);
    return g;
  };
  if (type === 'antler') {
    for (const sd of [-1, 1]) {
      const root = new THREE.Group();
      root.position.set(sd * hw * 0.25, hh * 0.44, 0.12 * s);
      root.rotation.z = sd * 0.38;
      root.rotation.x = -0.42;
      head.add(root);
      const b1 = makeBranch(root, 0.8 * s * scale, 0.12 * s, mats.horn, 0, 0, 0, 0, 0);
      const b2 = makeBranch(b1, 0.72 * s * scale, 0.085 * s, mats.horn, 0, 0.8 * s * scale, 0, -0.35, sd * -0.4);
      makeBranch(b2, 0.48 * s * scale, 0.06 * s, mats.horn, 0, 0.7 * s * scale, 0, -0.2, sd * 0.18);
      const branch = makeBranch(b1, 0.55 * s * scale, 0.07 * s, mats.horn, 0, 0.42 * s * scale, 0, 0, sd * 0.6);
      makeBranch(branch, 0.36 * s * scale, 0.05 * s, mats.horn, 0, 0.52 * s * scale, 0, -0.2, sd * 0.2);
      // little rough prongs
      for (let k = 0; k < 2; k++) {
        const b = makeBranch(b2, 0.26 * s, 0.045 * s, mats.dark, 0, (0.15 + k * 0.2) * s * scale, 0, 0.2, sd * (0.8 + k * 0.2));
        b.rotation.x += 0.3;
      }
      parts.hornGroups.push(root);
    }
  } else if (type === 'ram') {
    for (const sd of [-1, 1]) {
      const root = new THREE.Group();
      root.position.set(sd * hw * 0.4, hh * 0.25, -0.1 * s);
      root.rotation.z = sd * 0.5;
      root.rotation.x = -0.25;
      head.add(root);
      let parent = root;
      for (let i = 0; i < 5; i++) {
        const seg = makeBranch(parent, 0.28 * s * scale, (0.16 - i * 0.018) * s, mats.horn, 0, i === 0 ? 0 : 0.28 * s * scale, 0, 0, sd * 0.58);
        if (i >= 2) seg.rotation.x = 0.35;
        if (i >= 3) seg.rotation.x = 0.9;
        parent = seg;
      }
      parts.hornGroups.push(root);
    }
  } else if (type === 'swept') {
    for (const sd of [-1, 1]) {
      const root = new THREE.Group();
      root.position.set(sd * hw * 0.3, hh * 0.38, 0.02 * s);
      root.rotation.x = -0.9;
      root.rotation.z = sd * 0.3;
      head.add(root);
      const a = makeBranch(root, 0.72 * s * scale, 0.12 * s, mats.horn, 0, 0, 0, 0, 0);
      makeBranch(a, 0.5 * s * scale, 0.07 * s, mats.horn, 0, 0.7 * s * scale, 0, 0.15, sd * -0.25);
      parts.hornGroups.push(root);
    }
  } else if (type === 'crown') {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const sd = i % 2 === 0 ? 1 : -1;
      const x = count === 2 ? sd * hw * 0.25 : lerp(-hw * 0.42, hw * 0.42, t);
      const height = (0.55 + Math.sin(t * Math.PI) * 0.5) * s * scale;
      const spr = spike(head, 0.14 * s, height, 0.16 * s, x, hh * 0.35, 0.05 * s + Math.abs(x) * 0.2, mats.horn, -0.3, 0, (x / hw) * 0.3);
      if (i === 0 && count > 2) spike(head, 0.1 * s, height * 0.8, 0.12 * s, x * 0.5, hh * 0.4, 0.2 * s, mats.metal, -0.4, 0, 0);
    }
    parts.hornGroups.push(head);
  } else if (type === 'crystal') {
    for (const sd of [-1, 1]) {
      const root = new THREE.Group();
      root.position.set(sd * hw * 0.28, hh * 0.35, 0.05 * s);
      root.rotation.z = sd * 0.36;
      root.rotation.x = -0.5;
      head.add(root);
      shard(root, 0.9 * s * scale, 0, 0.35 * s, 0, mats.membraneLight, 0, 0, sd * 0.1);
      shard(root, 0.55 * s * scale, sd * 0.12 * s, 0.55 * s, -0.04 * s, mats.crystalMaterial || mats.accent2, 0.1, 0, sd * 0.2);
      box(root, 0.03 * s, 0.6 * s, 0.03 * s, sd * 0.06 * s, 0.5 * s, 0, mats.glow);
      parts.hornGroups.push(root);
    }
  } else if (type === 'crest') {
    for (let i = 0; i < 4; i++) {
      const f = finPanel(head, 0.2 * s, (0.25 + i * 0.07) * s, i % 2 ? mats.accent2 : mats.accent);
      f.position.set(0, hh * 0.35, -i * 0.1 * s);
    }
  } else {
    // simple back-swept horns
    for (const sd of [-1, 1]) {
      const root = new THREE.Group();
      root.position.set(sd * hw * 0.3, hh * 0.32, 0.0);
      root.rotation.x = -0.55;
      root.rotation.z = sd * 0.4;
      head.add(root);
      const a = makeBranch(root, 0.55 * s * scale, 0.11 * s, mats.horn, 0, 0, 0, 0, 0);
      makeBranch(a, 0.4 * s * scale, 0.06 * s, mats.horn, 0, 0.55 * s * scale, 0, -0.2, 0);
      parts.hornGroups.push(root);
    }
  }
}

function buildFrills(head, hc, mats, s, parts) {
  const type = hc.frill;
  const hw = 0.86 * s;
  const hh = 0.68 * s;
  const addFrill = (sd, mat, height, length, extraRot = 0) => {
    const g = new THREE.Group();
    g.position.set(sd * hw * 0.37, hh * 0.1, 0.05 * s);
    g.rotation.z = sd * (0.35 + extraRot);
    g.rotation.y = sd * 0.2;
    head.add(g);
    const f = finPanel(g, length, height, mat);
    f.rotation.x = 0.18;
    f.position.y = 0.02 * s;
    f.scale.x = 0.55;
    parts.frills.push({ group: g, side: sd, baseZ: g.rotation.z, baseY: g.rotation.y });
  };
  if (type === 'fin') {
    for (const sd of [-1, 1]) {
      addFrill(sd, mats.membraneLight, 0.52 * s, 0.65 * s);
      addFrill(sd, mats.accent, 0.32 * s, 0.38 * s, 0.28);
    }
  } else if (type === 'webbed') {
    for (const sd of [-1, 1]) {
      addFrill(sd, mats.membrane, 0.58 * s, 0.72 * s);
      addFrill(sd, mats.accent, 0.28 * s, 0.34 * s, 0.35);
      // ribs
      for (let i = 0; i < 2; i++) {
        const rib = box(head, 0.025 * s, 0.04 * s, 0.35 * s, sd * hw * 0.45, hh * (0.12 + i * 0.1), -0.08 * s, mats.horn);
        rib.rotation.y = sd * (0.15 + i * 0.18);
      }
    }
  } else if (type === 'ragged') {
    for (const sd of [-1, 1]) {
      addFrill(sd, mats.membrane, 0.5 * s, 0.58 * s);
      addFrill(sd, mats.dark, 0.34 * s, 0.42 * s, 0.4);
    }
  } else if (type === 'leaf' || type === 'feather') {
    for (const sd of [-1, 1]) {
      addFrill(sd, type === 'leaf' ? mats.accent2 : mats.accent2, 0.38 * s, 0.62 * s);
      const geos = [];
      for (let i = 0; i < 3; i++) {
        const yaw = sd > 0 ? Math.PI - 0.6 - i * 0.16 : 0.6 + i * 0.16;
        geos.push(coloredFeather(sd * hw * 0.32, 0.02 * s, yaw, 0.45 * s, 0.26 * s, i % 2 ? mats.palette.accent : mats.palette.accent2, hh * (0.06 + i * 0.05), 0.08));
      }
      const mesh = mergeColored(geos, mats.feather);
      if (mesh) head.add(mesh);
    }
  } else if (type === 'crystal') {
    for (const sd of [-1, 1]) {
      shard(head, 0.6 * s, sd * hw * 0.45, hh * 0.15, 0, mats.membraneLight, 0.2, sd * 0.5, sd * 0.4);
      const g = new THREE.Group();
      g.position.set(sd * hw * 0.4, hh * 0.1, 0.02 * s);
      g.rotation.z = sd * 0.5;
      head.add(g);
      finPanel(g, 0.5 * s, 0.42 * s, mats.accent2);
      parts.frills.push({ group: g, side: sd, baseZ: g.rotation.z, baseY: 0 });
    }
  }
}

function buildHeadMane(head, hc, mats, s, cfg) {
  if (!hc.mane || hc.mane === 'none') return;
  const hw = 0.86 * s;
  const hh = 0.68 * s;
  const type = hc.mane;
  const count = type === 'spines' ? 3 : 4;
  for (let i = 0; i < count; i++) {
    const sd = i % 2 === 0 ? 1 : -1;
    const z = -0.1 * s - i * 0.09 * s;
    if (type === 'spines') {
      spike(head, 0.1 * s, (0.32 + i * 0.03) * s, 0.12 * s, sd * hw * 0.28, hh * 0.28, z, mats.accent, -0.25, 0, sd * 0.45);
    } else if (type === 'crystal') {
      shard(head, (0.38 + i * 0.04) * s, sd * hw * 0.34, hh * 0.25, z, i % 2 ? mats.membraneLight : mats.accent2, 0.1, 0, sd * 0.4);
    } else if (type === 'fin') {
      const f = finPanel(head, 0.42 * s, 0.26 * s, mats.accent2);
      f.position.set(sd * hw * 0.3, hh * 0.1, z);
      f.rotation.y = sd * 0.4;
      f.scale.set(0.7, 1, 1);
    } else {
      const geos = [];
      const col = type === 'golden' ? mats.palette.accent : (type === 'feathers' ? (i % 2 ? mats.palette.accent2 : mats.palette.light) : mats.palette.accent);
      const yaw = sd > 0 ? 1.25 : Math.PI - 1.25;
      geos.push(coloredFeather(sd * hw * 0.2, z, yaw, (0.55 + i * 0.04) * s, 0.3 * s, col, hh * 0.18 + i * 0.05, 0.08));
      const mesh = mergeColored(geos, mats.feather);
      if (mesh) head.add(mesh);
    }
  }
}

function buildWhiskers(head, hc, mats, s, cfg, parts) {
  const count = hc.whiskers || 0;
  if (!count) return;
  const hw = 0.86 * s;
  for (let i = 0; i < count; i++) {
    const sd = i % 2 === 0 ? 1 : -1;
    const upper = i < 2;
    const root = new THREE.Group();
    root.position.set(sd * hw * (upper ? 0.22 : 0.28), upper ? -0.02 * s : -0.28 * s, 0.42 * s + (upper ? 0.24 * s : 0));
    root.rotation.y = sd * (upper ? 0.22 : 0.48);
    root.rotation.x = upper ? 0.15 : 0.5;
    head.add(root);
    const segments = [];
    let parent = root;
    for (let k = 0; k < 3; k++) {
      const g = new THREE.Group();
      if (k > 0) g.position.z = 0.52 * s;
      g.rotation.z = sd * 0.08;
      parent.add(g);
      box(g, 0.028 * s, 0.03 * s, 0.56 * s, 0, 0, 0.28 * s, upper ? mats.horn : mats.accent);
      if (k === 2) shard(g, 0.1 * s, 0, 0, 0.56 * s, mats.glow);
      parent = g;
      segments.push(g);
    }
    // The whisker trails backwards in world space; each segment points +Z.
    root.rotation.y += Math.PI;
    parts.whiskers.push({ segments, root, side: sd, upper, baseYaw: root.rotation.y, baseX: root.rotation.x });
  }
}

// Two smaller heads for the many-eyed guardian of the golden apples.
function buildExtraHeads(inner, cfg, mats, rig) {
  const count = cfg.extra.extraHeads || 0;
  if (!count) return;
  const { W, H, L } = rig.dimensions;
  rig.extraHeads = [];
  for (let i = 0; i < count; i++) {
    const sd = i % 2 === 0 ? -1 : 1;
    const anchor = new THREE.Group();
    anchor.position.set(sd * W * 0.34, H * 0.3, L * 0.24);
    anchor.rotation.y = sd * 0.5;
    anchor.rotation.z = -sd * 0.15;
    inner.add(anchor);
    let parent = anchor;
    const segments = [];
    const countSeg = 4;
    const size = 0.62;
    const segLen = 0.58;
    for (let k = 0; k < countSeg; k++) {
      const g = new THREE.Group();
      if (k > 0) g.position.z = segLen * 0.94;
      g.rotation.x = -0.18 + k * 0.035;
      parent.add(g);
      parent = g;
      segments.push(g);
      const taper = 1 - k * 0.07;
      box(g, 0.34 * size, 0.34 * size, segLen * taper, 0, 0, segLen * 0.5, mats.base);
      box(g, 0.24 * size, 0.08 * size, segLen * 0.9, 0, -0.11 * size, segLen * 0.5, mats.belly);
      if (k > 0) {
        const f = finPanel(g, 0.3 * size, 0.22 * size, mats.accent);
        f.position.set(sd * 0.14, 0.1, segLen * 0.4);
      }
    }
    const head = new THREE.Group();
    head.position.z = segLen * 0.96;
    head.rotation.x = 0.48;
    parent.add(head);
    const hp = buildHead(head, cfg, mats, 0.55 * size);
    for (const e of hp.eyes) rig.extraEyes.push(e);
    const mini = { anchor, segments, head, jaw: hp.jaw, eyes: hp.eyes, frills: hp.frills, baseRot: segments.map((s2) => s2.rotation.x) };
    rig.extraHeads.push(mini);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Legs
// ───────────────────────────────────────────────────────────────────────────
function buildLegs(inner, cfg, mats, rig) {
  const { W, H, L } = rig.dimensions;
  const legs = [];
  const spec = cfg.legs;
  for (const front of [true, false]) {
    for (const side of [-1, 1]) {
      const root = new THREE.Group();
      const z = front ? L * 0.31 : -L * 0.28;
      root.position.set(side * W * 0.39, -H * 0.32, z);
      const upperLen = (front ? 0.68 : 0.9) * (H + 0.5) * spec.fore;
      const lowerLen = (front ? 0.68 : 0.86) * (H + 0.4) * spec.fore;
      const baseX = front ? 0.26 : 0.48;
      const baseZ = side * 0.08;
      root.rotation.x = baseX;
      root.rotation.z = baseZ;
      inner.add(root);

      const thigh = box(root, (front ? 0.37 : 0.44) * spec.fore, upperLen, 0.42 * spec.fore, 0, -upperLen * 0.5, 0, mats.base);
      box(root, (front ? 0.28 : 0.34) * spec.fore, upperLen * 0.6, 0.3 * spec.fore, side * 0.05, -upperLen * 0.3, 0.04, mats.light);

      const knee = new THREE.Group();
      knee.position.y = -upperLen;
      knee.rotation.x = -0.58 - (front ? 0 : 0.18);
      root.add(knee);
      box(knee, 0.3 * spec.fore, 0.27 * spec.fore, 0.3 * spec.fore, 0, 0, 0, mats.dark);
      box(knee, (front ? 0.27 : 0.31) * spec.fore, lowerLen, 0.3 * spec.fore, 0, -lowerLen * 0.5, 0, mats.base);
      box(knee, 0.22 * spec.fore, lowerLen * 0.6, 0.22 * spec.fore, 0, -lowerLen * 0.4, 0.04, mats.light);

      const ankle = new THREE.Group();
      ankle.position.y = -lowerLen;
      ankle.rotation.x = 0.65 + (front ? 0 : 0.2);
      knee.add(ankle);
      box(ankle, 0.24 * spec.fore, 0.16 * spec.fore, 0.26 * spec.fore, 0, 0, 0, mats.dark);
      const foot = new THREE.Group();
      foot.position.set(0, -0.06, 0.04);
      ankle.add(foot);
      box(foot, 0.32 * spec.fore, 0.16, 0.5 * spec.fore, 0, -0.05, 0.2, mats.light);
      const clawMat = front && cfg.legs.style === 'imperial' ? mats.metal : mats.horn;
      const clawCount = cfg.legs.claws;
      for (let i = 0; i < clawCount; i++) {
        const t = clawCount === 1 ? 0.5 : i / (clawCount - 1);
        const x = lerp(-0.16, 0.16, t) * spec.fore;
        const len = (0.23 + Math.sin(t * Math.PI) * 0.08) * spec.fore;
        const claw = spike(foot, 0.06 * spec.fore, len, 0.06 * spec.fore, x, -0.08, 0.45 * spec.fore, clawMat, Math.PI / 2, 0, 0);
        claw.rotation.z = (t - 0.5) * 0.2;
      }
      // thumb
      spike(foot, 0.05 * spec.fore, 0.2 * spec.fore, 0.05 * spec.fore, side * 0.15 * spec.fore, -0.08, 0.02, clawMat, Math.PI * 0.42, 0, side * 0.5);
      if (spec.style === 'eagle') {
        for (let i = 0; i < 3; i++) {
          const f = finPanel(root, 0.3 * spec.fore, 0.16, mats.accent);
          f.position.set(side * (0.14 + i * 0.03), -0.16 - i * 0.16, 0.08 + i * 0.04);
          f.rotation.y = side * 0.45;
          f.scale.x = 0.6;
        }
        for (let i = 0; i < 3; i++) {
          spike(root, 0.06, 0.2 * spec.fore, 0.06, side * 0.1, -0.1, -0.06, mats.horn, Math.PI * 0.5, 0, 0);
        }
      }
      legs.push({
        root, knee, ankle, foot, side, front,
        baseX, baseZ,
        baseKneeX: knee.rotation.x,
        baseAnkleX: ankle.rotation.x,
        upperLen, lowerLen,
      });
    }
  }
  rig.legs = legs;
}

// ───────────────────────────────────────────────────────────────────────────
// Tail
// ───────────────────────────────────────────────────────────────────────────
function buildTail(inner, cfg, mats, rig) {
  const { W, H, L } = rig.dimensions;
  const tcfg = cfg.tail;
  const root = new THREE.Group();
  root.position.set(0, H * 0.01, -L * 0.48);
  inner.add(root);
  const segments = [];
  const segLen = tcfg.length / tcfg.segments;
  let parent = root;
  const basePitches = [];
  for (let i = 0; i < tcfg.segments; i++) {
    const t = i / tcfg.segments;
    const g = new THREE.Group();
    if (i > 0) g.position.z = -segLen * 0.96;
    const baseX = (i === 0 ? 0.04 : 0.012) + Math.sin(t * 2.2) * 0.02 * tcfg.curve;
    g.rotation.x = baseX;
    parent.add(g);
    parent = g;
    segments.push(g);
    basePitches.push(baseX);
    const taper = 1 - t * 0.78;
    const w = tcfg.width * (0.7 + taper * 1.2);
    const h = tcfg.width * (0.8 + taper * 0.75);
    box(g, w, h, segLen * 1.04, 0, 0, -segLen * 0.5, t < 0.3 ? mats.light : mats.base);
    box(g, w * 0.64, h * 0.2, segLen * 0.92, 0, -h * 0.51, -segLen * 0.5, mats.belly);
    if (i % 2 === 0) {
      box(g, w * 0.26, h * 0.18, segLen * 0.65, 0, h * 0.55, -segLen * 0.5, mats.dark);
    }
    // dorsal tail fins / spines
    if (i < tcfg.segments - 2 && i > 1) {
      const backStyle = cfg.back.spikes;
      if (backStyle === 'fin' || backStyle === 'leaf') {
        const fin = finPanel(g, segLen * 1.1, h * 1.5, backStyle === 'leaf' ? mats.accent2 : mats.accent);
        fin.position.set(0, h * 0.3, -segLen * 0.2);
        fin.scale.x = 0.7;
      } else if (i % 2 === 0) {
        spike(g, 0.06, h * 0.9, 0.1, 0, h * 0.35, -segLen * 0.5, mats.accent, -0.2, 0, 0);
      }
    }
    // small side scales
    for (const s of [-1, 1]) {
      box(g, 0.035, h * 0.28, segLen * 0.5, s * w * 0.47, 0, -segLen * 0.5, mats.accent, 0, 0, s * 0.2);
    }
  }

  const tip = new THREE.Group();
  tip.position.z = -segLen * 0.96;
  parent.add(tip);
  rig.tailTipGroup = tip;
  buildTailTip(tip, cfg, mats, rig);
  rig.tail = segments;
  rig.tailBaseX = basePitches;
  // a marker at the end of the tail for particles
  const marker = new THREE.Object3D();
  marker.position.set(0, 0, -segLen * 0.8);
  tip.add(marker);
  rig.tailMarker = marker;
}

function buildTailTip(tip, cfg, mats, rig) {
  const p = mats.palette;
  const type = cfg.tail.tip;
  if (type === 'spade') {
    const mat = mats.accent;
    polygonPanel(tip, [[0, 0.2], [-0.95, -0.5], [-0.28, -0.75], [0, -1.8], [0.28, -0.75], [0.95, -0.5]], mats.membraneLight);
    polygonPanel(tip, [[0, 0.15], [-0.7, -0.55], [0, -1.35], [0.7, -0.55]], mats.membrane);
    box(tip, 0.14, 0.12, 1.4, 0, 0.02, -0.65, mats.horn);
    finPanel(tip, 0.9, 0.36, mat).position.set(0, 0, -0.2);
  } else if (type === 'whale') {
    finPanel(tip, 1.35, 0.85, mats.membraneLight).position.set(0, 0.05, 0);
    finPanel(tip, 1.35, -0.7, mats.membrane).position.set(0, 0, 0);
    box(tip, 0.1, 0.1, 1.5, 0, 0, -0.5, mats.horn);
    // vertical fish-tail lobes
    for (const sd of [-1, 1]) {
      const lobe = new THREE.Group();
      lobe.rotation.z = sd * 0.55;
      tip.add(lobe);
      polygonPanel(lobe, [[0.05, -0.1], [0.9, -0.3], [1.3, -1.0], [0.35, -0.9], [-0.05, -0.4]], mats.membraneLight);
      box(lobe, 0.05, 0.05, 0.8, 0.1, 0, -0.45, mats.accent);
    }
  } else if (type === 'fan') {
    const geos = [];
    const colors = p.bands || [p.accent, p.accent2, p.light, p.metal, p.membraneLight];
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const yaw = (t - 0.5) * 1.9;
      const len = 1.25 + Math.sin(t * Math.PI) * 0.55;
      geos.push(coloredFeather((t - 0.5) * 0.3, -0.1, yaw, len, 0.32, colors[i % colors.length], 0.04 + i * 0.008, 0.1));
    }
    const mesh = mergeColored(geos, mats.feather);
    if (mesh) tip.add(mesh);
    box(tip, 0.12, 0.1, 0.9, 0, 0, -0.35, mats.metal);
  } else if (type === 'crystal') {
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      shard(tip, 0.5 + Math.sin(t * Math.PI) * 0.4, (t - 0.5) * 0.45, (t - 0.5) * 0.24, -0.3 - Math.sin(t * Math.PI) * 0.8, i % 2 ? mats.membraneLight : mats.accent2, 0, yawFor(t), (t - 0.5) * 0.4);
    }
    shard(tip, 0.3, 0, 0, -1.2, mats.glow);
  } else if (type === 'spear') {
    spike(tip, 0.3, 1.1, 0.18, 0, 0, -0.1, mats.metal, -Math.PI * 0.5, 0, 0);
    shard(tip, 0.25, 0, 0.1, -1.2, mats.accent2);
    polygonPanel(tip, [[0, 0], [-0.3, -0.45], [0, -0.8], [0.3, -0.45]], mats.accent);
  } else if (type === 'leaf') {
    polygonPanel(tip, [[0, 0.1], [-0.7, -0.35], [-0.42, -1.3], [0, -1.65], [0.42, -1.3], [0.7, -0.35]], mats.accent2);
    box(tip, 0.06, 0.06, 1.5, 0, 0.03, -0.7, mats.accent);
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const leaf = finPanel(tip, 0.5, 0.3, mats.accent2);
        leaf.position.set(sd * 0.2, 0, -0.4 - i * 0.2);
        leaf.rotation.z = sd * (0.6 + i * 0.1);
      }
    }
  } else {
    // tuft
    const geos = [];
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const yaw = (t - 0.5) * 1.4;
      geos.push(coloredFeather(0, 0, yaw, 0.8 + Math.sin(t * Math.PI) * 0.4, 0.28, i % 2 ? p.accent : p.accent2, 0.03, 0.1));
    }
    const mesh = mergeColored(geos, mats.feather);
    if (mesh) tip.add(mesh);
  }
}

function yawFor(t) {
  return (t - 0.5) * 1.5;
}

// ───────────────────────────────────────────────────────────────────────────
// Wings
// ───────────────────────────────────────────────────────────────────────────
function buildWings(inner, cfg, mats, rig) {
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = buildWing(inner, cfg, mats, rig, side);
    wings.push(wing);
  }
  rig.wings = wings;
  rig.ribbons = [];
  for (const w of wings) if (w.ribbons) rig.ribbons.push(...w.ribbons);
  if (cfg.extra.ribbons) buildBodyRibbons(inner, cfg, mats, rig);
}

function buildWing(inner, cfg, mats, rig, side) {
  const s = side;
  const { W, H, L } = rig.dimensions;
  const wcfg = cfg.wing;
  const root = new THREE.Group();
  root.position.set(s * W * 0.42, H * 0.3, L * 0.14);
  root.rotation.z = s * 0.16;
  root.rotation.y = s * 0.08;
  root.rotation.x = -0.03;
  inner.add(root);
  const half = wcfg.span * 0.5;
  const shoulderOffset = W * 0.42;
  const available = Math.max(4, half - shoulderOffset);
  const armLen = available * 0.23;
  const foreLen = available * 0.27;
  const handLen = available * 0.5;
  const mid = new THREE.Group();
  mid.position.x = s * armLen;
  mid.rotation.z = s * -0.04;
  root.add(mid);
  const tip = new THREE.Group();
  tip.position.x = s * foreLen;
  tip.rotation.z = s * -0.08;
  mid.add(tip);

  const wing = {
    side: s, root, mid, tip, armLen, foreLen, handLen, type: wcfg.type, catalogId: rig.catalog.id,
    baseRootZ: root.rotation.z, baseRootY: root.rotation.y,
    baseMidZ: mid.rotation.z, baseTipZ: tip.rotation.z,
    feathers: [], ribbons: [],
  };

  // leading arm bones (shared by all wing types)
  const boneMat = wcfg.type === 'feather' ? mats.dark : (wcfg.type === 'bat' ? mats.dark : mats.horn);
  const armMesh = box(root, armLen, 0.24, 0.42, s * armLen * 0.5, 0.03, 0, boneMat);
  box(root, 0.36, 0.34, 0.4, s * 0.03, 0.02, 0.02, mats.dark);
  box(root, 0.42, 0.18, 0.58, s * armLen * 0.47, 0.13, 0.04, mats.accent);
  const foreMesh = box(mid, foreLen, 0.16, 0.24, s * foreLen * 0.5, 0.02, 0.04, boneMat);
  box(mid, 0.24, 0.28, 0.3, 0, 0, 0.02, mats.accent);
  box(tip, 0.18, 0.2, 0.4, s * 0.08, 0.02, 0.06, mats.accent);
  // wrist claw
  const claw = spike(tip, 0.09, 0.42, 0.09, s * 0.1, 0.02, 0.28, mats.horn, 0.9, 0, s * 0.2);
  claw.rotation.z = s * 0.2;

  if (wcfg.type === 'feather') {
    buildFeatherWing(root, mid, tip, wing, cfg, mats, s, armLen, foreLen, handLen);
    // a few soft feathers over the shoulder, hiding the join
    const geos = [];
    for (let i = 0; i < 4; i++) {
      geos.push(coloredFeather(s * (0.08 + i * 0.1), 0.16 - i * 0.03, s > 0 ? 2.1 : Math.PI - 2.1, 0.4 + i * 0.07, 0.2, i % 2 ? mats.palette.light : mats.palette.base, 0.05, 0.08));
    }
    const m = mergeColored(geos, mats.feather);
    if (m) root.add(m);
    // wingtip marker
    const marker = new THREE.Object3D();
    marker.position.set(s * Math.cos(0.14) * handLen * 1.0, 0, -Math.sin(0.14) * handLen * 1.0);
    tip.add(marker);
    wing.tipMarker = marker;
  } else if (wcfg.type === 'bat') {
    buildBatWing(root, mid, tip, wing, cfg, mats, s, armLen, foreLen, handLen);
  } else if (wcfg.type === 'fin' || wcfg.type === 'ribbon') {
    buildFinWing(root, mid, tip, wing, cfg, mats, s, armLen, foreLen, handLen);
    if (wcfg.type === 'ribbon') buildWingRibbons(tip, wing, cfg, mats, s, handLen);
  } else if (wcfg.type === 'crystal') {
    buildCrystalWing(root, mid, tip, wing, cfg, mats, s, armLen, foreLen, handLen);
  }

  // edge glow trim
  if (wcfg.glowEdge) {
    const glowMat = mats.glow;
    box(root, armLen * 0.8, 0.025, 0.055, s * armLen * 0.45, 0.19, 0.16, glowMat);
    box(mid, foreLen * 0.7, 0.025, 0.045, s * foreLen * 0.35, 0.14, 0.12, glowMat);
  }
  box(root, 0.5, 0.2, 0.5, 0, 0, -0.04, mats.dark);
  wing.armMesh = armMesh;
  wing.foreMesh = foreMesh;
  return wing;
}

function addBatMembranes(root, mid, tip, cfg, mats, s, armLen, foreLen, handLen) {
  const p = mats.palette;
  const ragged = cfg.wing.ragged || 0;
  const L = cfg.body.length;
  const y = 0.0;
  // Broad, bat-like sails. The trailing edge is intentionally deeper than the
  // leading arm so the wing reads as a membrane rather than a row of sticks.
  const chord0 = L * (0.58 + ragged * 0.1);
  const chord1 = foreLen * (1.5 + ragged * 0.25);

  {
    const pts = [
      [s * 0.14, y + 0.02, 0.34],
      [s * armLen * 0.55, y + 0.025, 0.2],
      [s * armLen, y + 0.02, 0.08],
      [s * armLen * 1.02, y - 0.02, -armLen * (0.72 + ragged * 0.15)],
      [s * armLen * 0.91, y - 0.03, -chord0 - armLen * (0.42 + ragged * 0.25)],
      [s * armLen * 0.72, y - 0.02, -chord0 - armLen * (0.26 + ragged * 0.3)],
      [s * armLen * 0.58, y - 0.02, -chord0 - armLen * 0.1],
      [s * armLen * 0.36, y - 0.02, -chord0 * 0.92],
      [s * 0.04, y - 0.02, -L * (0.3 + ragged * 0.03)],
    ];
    const faces = [];
    for (let i = 1; i < pts.length - 1; i++) faces.push([0, i, i + 1]);
    faces.push([0, pts.length - 1, 1]);
    trianglePanel(root, pts, faces, mats.membrane);
    addMembraneOutline(root, pts, mats.palette.accent, 0.6);
    // ribs that follow the sail's folds
    for (let i = 2; i < pts.length - 2; i += 2) {
      box(root, 0.032, 0.045, Math.hypot(pts[i][0] - pts[0][0], pts[i][2] - pts[0][2]), (pts[i][0] + pts[0][0]) * 0.5, 0.045, (pts[i][2] + pts[0][2]) * 0.5, i === 2 ? mats.accent : mats.dark, 0, -Math.atan2(pts[i][2] - pts[0][2], pts[i][0] - pts[0][0]), 0);
    }
    for (let i = 3; i < pts.length - 2; i += 2) {
      box(root, 0.02, 0.02, 0.9 + i * 0.15, (pts[i][0] + pts[0][0]) * 0.45, 0.02, (pts[i][2] + pts[0][2]) * 0.45, mats.glow, 0, -Math.atan2(pts[i][2] - pts[0][2], pts[i][0] - pts[0][0]), 0);
    }
  }
  {
    const pts = [
      [0, y + 0.02, 0.07],
      [s * foreLen * 0.55, y + 0.02, 0.05],
      [s * foreLen, y + 0.025, 0.04],
      [s * foreLen * 1.04, y - 0.02, -foreLen * (0.64 + ragged * 0.12)],
      [s * foreLen * 0.95, y - 0.03, -chord1 - foreLen * (0.38 + ragged * 0.22)],
      [s * foreLen * 0.76, y - 0.025, -chord1 - foreLen * (0.2 + ragged * 0.26)],
      [s * foreLen * 0.55, y - 0.02, -chord1 - foreLen * 0.08],
      [s * foreLen * 0.28, y - 0.02, -chord1 * 0.82 - foreLen * 0.2],
      [s * 0.02, y - 0.02, -foreLen * 0.78],
    ];
    const faces = [];
    for (let i = 1; i < pts.length - 1; i++) faces.push([0, i, i + 1]);
    trianglePanel(mid, pts, faces, mats.membrane);
    addMembraneOutline(mid, pts, mats.palette.accent, 0.54);
    for (let i = 2; i < pts.length - 2; i += 2) {
      box(mid, 0.028, 0.04, Math.hypot(pts[i][0], pts[i][2]), pts[i][0] * 0.5, 0.04, pts[i][2] * 0.5, i === 2 ? mats.accent : mats.dark, 0, -Math.atan2(pts[i][2], pts[i][0]), 0);
    }
  }
  {
    const fingers = [
      { a: 0.04, len: handLen * 1.02 },
      { a: 0.24, len: handLen * 1.04 },
      { a: 0.48, len: handLen * 0.98 },
      { a: 0.74, len: handLen * 0.86 },
      { a: 1.02, len: handLen * 0.7 },
      { a: 1.28, len: handLen * 0.48 },
    ];
    const pts = [[0, y + 0.02, 0.03]];
    for (let i = 0; i < fingers.length; i++) {
      const f = fingers[i];
      const x = s * Math.cos(f.a) * f.len;
      const z = -Math.sin(f.a) * f.len;
      pts.push([x, y - 0.01 - i * 0.004, z]);
      if (i < fingers.length - 1) {
        const notchA = (f.a + fingers[i + 1].a) * 0.5;
        const notchLen = Math.min(f.len, fingers[i + 1].len) * (0.66 - ragged * 0.08);
        pts.push([s * Math.cos(notchA) * notchLen, y - 0.02, -Math.sin(notchA) * notchLen]);
      }
    }
    pts.push([s * Math.cos(1.45) * handLen * 0.24, y - 0.02, -Math.sin(1.45) * handLen * 0.24]);
    pts.push([s * 0.02, y - 0.01, -handLen * 0.1]);
    const faces = [];
    for (let i = 1; i < pts.length - 1; i++) faces.push([0, i, i + 1]);
    trianglePanel(tip, pts, faces, mats.membrane);
    addMembraneOutline(tip, pts, mats.palette.accent, 0.58);

    for (let i = 0; i < fingers.length; i++) {
      const f = fingers[i];
      const boneLen = Math.hypot(f.len, 0.001);
      const boneYaw = s > 0 ? f.a : Math.PI - f.a;
      box(tip, boneLen, 0.07, 0.08, s * Math.cos(f.a) * f.len * 0.5, 0.04, -Math.sin(f.a) * f.len * 0.5, i === 0 ? mats.accent : mats.dark, 0, boneYaw, 0);
      if (i === 0 || i === fingers.length - 1) {
        spike(tip, 0.08, 0.36, 0.08, s * Math.cos(f.a) * f.len, 0.03, -Math.sin(f.a) * f.len, mats.horn, 0.3, 0, s * 0.2);
      }
    }
    box(tip, 0.18, 0.16, 0.2, 0, 0.02, 0.08, mats.dark);
    const marker = new THREE.Object3D();
    marker.position.set(s * Math.cos(0.09) * handLen * 0.99, 0.05, -Math.sin(0.09) * handLen * 0.99);
    tip.add(marker);
    root.userData.marker = marker;
  }
}

function buildBatWing(root, mid, tip, wing, cfg, mats, s, armLen, foreLen, handLen) {
  addBatMembranes(root, mid, tip, cfg, mats, s, armLen, foreLen, handLen);
  wing.tipMarker = root.userData.marker;
  // ragged trailing fringe
  if (cfg.wing.ragged > 0.4) {
    const rng = mulberry32(3947);
    for (let i = 0; i < 6; i++) {
      const len = 0.25 + rng() * 0.7;
      const fin = finPanel(tip, len, 0.35 + rng() * 0.35, mats.membrane);
      fin.position.set(s * (handLen * (0.2 + rng() * 0.7)), -0.03, -handLen * (0.2 + rng() * 0.65));
      fin.rotation.z = s * 0.2;
    }
  }
}

function buildFeatherWing(root, mid, tip, wing, cfg, mats, s, armLen, foreLen, handLen) {
  const p = mats.palette;
  const rainbow = cfg.wing.rainbow;
  const gold = cfg.wing.gold;
  const leaf = cfg.wing.leaf;
  const bands = p.bands || [];
  const colorFor = (layer, i, under = false) => {
    if (rainbow) return bands[(i + layer * 2) % bands.length] || p.accent;
    if (gold) return under ? p.dark : (i % 3 === 0 ? p.accent2 : (i % 3 === 1 ? p.metal : p.accent));
    if (leaf) return under ? p.accent2 : (i % 3 === 0 ? p.accent2 : (i % 3 === 1 ? p.accent : p.light));
    if (wing.catalogId === 'yinglong') return under ? p.base : (i % 3 === 0 ? p.light : (i % 3 === 1 ? p.accent2 : p.accent));
    if (layer === 0) return under ? p.dark : p.base;
    if (layer === 1) return i % 2 ? p.base : p.light;
    return i % 2 ? p.accent : p.light;
  };

  // root layer: secondaries
  for (let layer = 0; layer < 2; layer++) {
    const geos = [];
    const n = layer === 0 ? 11 : 6;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const rootX = s * (0.12 + t * 0.92) * armLen;
      const rootZ = -0.06 - t * 0.04;
      const angle = 0.84 + t * 0.36 + layer * 0.12;
      const len = handLen * (0.62 + t * 0.32) + layer * 0.12;
      const yaw = s > 0 ? angle : Math.PI - angle;
      const y = layer === 0 ? 0 : 0.045;
      geos.push(coloredFeather(rootX, rootZ, yaw, len, (layer === 0 ? 0.38 : 0.28) + t * 0.07, colorFor(0, i, layer === 0), y, 0.1));
    }
    const mesh = mergeColored(geos, mats.feather);
    if (mesh) { root.add(mesh); wing.feathers.push(mesh); }
  }

  // mid layer: primaries over the forearm
  for (let layer = 0; layer < 2; layer++) {
    const geos = [];
    const n = layer === 0 ? 11 : 6;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const rootX = s * (0.03 + t * 0.9) * foreLen;
      const angle = 0.62 + t * 0.4 + layer * 0.13;
      const len = handLen * (0.7 + t * 0.26) + layer * 0.1;
      const yaw = s > 0 ? angle : Math.PI - angle;
      const y = layer === 0 ? 0.005 : 0.05;
      geos.push(coloredFeather(rootX, 0.02, yaw, len, (layer === 0 ? 0.34 : 0.25) + t * 0.05, colorFor(1, i, layer === 0), y, 0.095));
    }
    const mesh = mergeColored(geos, mats.feather);
    if (mesh) { mid.add(mesh); wing.feathers.push(mesh); }
  }

  // distal primaries fan
  for (let layer = 0; layer < 2; layer++) {
    const geos = [];
    const n = layer === 0 ? 11 : 6;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const angle = 0.05 + t * 1.25 + layer * 0.06;
      const len = handLen * (1.22 - t * 0.28) * (layer === 0 ? 1 : 0.72);
      const rootX = s * (0.02 + t * 0.05);
      const yaw = s > 0 ? angle : Math.PI - angle;
      const y = layer === 0 ? 0.02 : 0.065;
      geos.push(coloredFeather(rootX, 0.01, yaw, len, (layer === 0 ? 0.3 : 0.23) + (1 - t) * 0.07, colorFor(2, i, layer === 0), y, 0.09));
    }
    const mesh = mergeColored(geos, mats.feather);
    if (mesh) { tip.add(mesh); wing.feathers.push(mesh); }
  }

  // leading edge coverts
  const geos = [];
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const rootX = s * t * (armLen + foreLen * 0.2);
    const yaw = s > 0 ? 0.48 : Math.PI - 0.48;
    geos.push(coloredFeather(rootX, 0.1, yaw, 0.55 + t * 0.32, 0.18, rainbow ? bands[i % bands.length] : (gold ? p.metal : p.light), 0.1, 0.08));
  }
  const mesh = mergeColored(geos, mats.feather);
  if (mesh) root.add(mesh);
}

function buildFinWing(root, mid, tip, wing, cfg, mats, s, armLen, foreLen, handLen) {
  const W = cfg.body.width;
  const p = mats.palette;
  const ragged = cfg.wing.ragged || 0;
  // proximal sail
  {
    const pts = [
      [s * 0.15, 0.02, 0.2],
      [s * armLen, 0.02, 0.12],
      [s * armLen * (1.0 + ragged * 0.1), -0.03, -armLen * (1.2 + ragged * 0.5)],
      [s * armLen * 0.7, -0.02, -armLen * (1.9 + ragged * 0.3)],
      [s * armLen * 0.25, -0.01, -armLen * 1.35],
      [s * 0.02, -0.01, -W * 0.7],
    ];
    const faces = [];
    for (let i = 1; i < pts.length - 1; i++) faces.push([0, i, i + 1]);
    trianglePanel(root, pts, faces, mats.membrane);
    addMembraneOutline(root, pts, mats.palette.accent, 0.45);
    box(root, armLen * 0.9, 0.05, 0.05, s * armLen * 0.45, 0.05, 0.1, mats.accent, 0, 0, 0);
  }
  {
    const pts = [
      [0, 0.02, 0.06],
      [s * foreLen, 0.02, 0.06],
      [s * foreLen * 1.06, -0.02, -foreLen * 0.82],
      [s * foreLen * 0.75, -0.02, -foreLen * 1.28],
      [s * foreLen * 0.32, -0.02, -foreLen * 1.08],
      [s * 0.02, -0.01, -foreLen * 0.7],
    ];
    const faces = [];
    for (let i = 1; i < pts.length - 1; i++) faces.push([0, i, i + 1]);
    trianglePanel(mid, pts, faces, mats.membrane);
    addMembraneOutline(mid, pts, mats.palette.accent, 0.42);
    box(mid, foreLen * 0.8, 0.05, 0.04, s * foreLen * 0.4, 0.04, 0.06, mats.accent);
  }
  // distal fan
  {
    const rays = [
      { a: 0.03, len: handLen * 1.02 },
      { a: 0.26, len: handLen * 0.97 },
      { a: 0.5, len: handLen * 0.88 },
      { a: 0.76, len: handLen * 0.75 },
      { a: 1.02, len: handLen * 0.62 },
      { a: 1.28, len: handLen * 0.45 },
    ];
    const pts = [[0, 0.02, 0.03]];
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i];
      pts.push([s * Math.cos(r.a) * r.len, 0.005 - i * 0.003, -Math.sin(r.a) * r.len]);
      if (i < rays.length - 1) {
        const a2 = (r.a + rays[i + 1].a) * 0.5;
        const len2 = Math.min(r.len, rays[i + 1].len) * (0.55 - ragged * 0.06);
        pts.push([s * Math.cos(a2) * len2, -0.01, -Math.sin(a2) * len2]);
      }
    }
    pts.push([s * 0.03, -0.01, -handLen * 0.15]);
    const faces = [];
    for (let i = 1; i < pts.length - 1; i++) faces.push([0, i, i + 1]);
    trianglePanel(tip, pts, faces, mats.membrane);
    addMembraneOutline(tip, pts, mats.palette.accent, 0.5);
    // rays
    for (const r of rays) {
      const boneYaw = s > 0 ? r.a : Math.PI - r.a;
      box(tip, r.len, 0.055, 0.06, s * Math.cos(r.a) * r.len * 0.5, 0.025, -Math.sin(r.a) * r.len * 0.5, r.a < 0.4 ? mats.accent2 : mats.accent, 0, boneYaw, 0);
    }
    // decorative trailing fin edges
    for (let i = 0; i < 3; i++) {
      const fin = finPanel(tip, 0.4 + i * 0.12, 0.26, mats.accent2);
      fin.position.set(s * (0.3 + i * 0.2) * handLen, -0.03, -handLen * (0.2 + i * 0.14));
      fin.rotation.z = s * 0.4;
      fin.scale.x = 0.6;
    }
    const marker = new THREE.Object3D();
    marker.position.set(s * Math.cos(0.03) * handLen * 1.02, 0.03, -Math.sin(0.03) * handLen * 1.02);
    tip.add(marker);
    wing.tipMarker = marker;
  }
}

function buildWingRibbons(tip, wing, cfg, mats, s, handLen) {
  const p = mats.palette;
  for (let i = 0; i < 3; i++) {
    const root = new THREE.Group();
    root.position.set(s * (0.05 + i * 0.05), -0.02 - i * 0.02, -handLen * (0.12 + i * 0.05));
    root.rotation.y = -s * (0.12 + i * 0.05);
    tip.add(root);
    let parent = root;
    const segments = [];
    for (let k = 0; k < 4; k++) {
      const g = new THREE.Group();
      if (k > 0) g.position.z = -1.15;
      g.rotation.x = -0.06 + k * 0.04;
      parent.add(g);
      const w = (0.2 - k * 0.03) * (1 + i * 0.1);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, 1.35, 1, 1),
        new THREE.MeshLambertMaterial({
          color: new THREE.Color(k % 2 ? p.membraneLight : p.accent),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.62 - k * 0.05,
          fog: true,
          depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0, -0.65);
      mesh.rotation.z = 0.03 * i;
      g.add(mesh);
      parent = g;
      segments.push(g);
    }
    wing.ribbons.push({ root, segments, side: s, phase: i * 1.7 });
  }
  // long golden pennants from the shoulder
  for (let i = 0; i < 2; i++) {
    const root = new THREE.Group();
    root.position.set(s * (0.18 + i * 0.1), 0.06, 0.25);
    wing.root.add(root);
    let parent = root;
    const segments = [];
    for (let k = 0; k < 5; k++) {
      const g = new THREE.Group();
      if (k > 0) g.position.z = -1.15;
      parent.add(g);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.26 - k * 0.03, 1.2, 1, 1),
        new THREE.MeshLambertMaterial({
          color: new THREE.Color(i ? p.metal : p.accent),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.6 - k * 0.07,
          fog: true,
          depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0, -0.58);
      g.add(mesh);
      parent = g;
      segments.push(g);
    }
    wing.ribbons.push({ root, segments, side: s, phase: 2.5 + i * 1.1 });
  }
}

function buildCrystalWing(root, mid, tip, wing, cfg, mats, s, armLen, foreLen, handLen) {
  const p = mats.palette;
  // translucent under-membrane
  {
    const pts = [
      [s * 0.12, 0.02, 0.18],
      [s * (armLen + foreLen), 0.02, 0.05],
      [s * (armLen + foreLen + handLen * 0.85), -0.02, -handLen * 0.55],
      [s * (armLen + foreLen) * 0.72, -0.03, -foreLen * 0.9],
      [s * (armLen * 0.6), -0.02, -armLen * 0.95],
      [s * 0.02, -0.02, -armLen * 0.5],
    ];
    const faces = [];
    for (let i = 1; i < pts.length - 1; i++) faces.push([0, i, i + 1]);
    trianglePanel(root, pts, faces, mats.membrane);
  }
  const layers = [[], [], []];
  const addShardAt = (layer, x, z, len, width, color, angle) => {
    const geo = OCTA_GEO.clone();
    const m = new THREE.Matrix4();
    m.compose(
      new THREE.Vector3(x, 0.02, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s * angle, 0)),
      new THREE.Vector3(width, 0.08, len),
    );
    geo.applyMatrix4(m);
    geo.computeVertexNormals();
    const c = new THREE.Color(color);
    const count = geo.attributes.position.count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    layers[layer].push(geo);
  };
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    addShardAt(0, s * (0.15 + t * armLen * 0.9), -t * armLen * 0.28, (0.6 + t * 0.35) * (armLen + foreLen), 0.32 + t * 0.1, i % 2 ? p.membraneLight : p.accent2, 0.35 + t * 0.3);
  }
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    addShardAt(1, s * (0.1 + t * foreLen * 0.9), -t * foreLen * 0.3, (0.75 + t * 0.5) * (foreLen + handLen), 0.28 + t * 0.11, i % 2 ? p.membraneLight : p.accent, 0.3 + t * 0.4);
  }
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const angle = 0.1 + t * 0.95;
    addShardAt(2, s * Math.cos(angle) * handLen * 0.65, -Math.sin(angle) * handLen * 0.7, handLen * (1.15 - t * 0.25), 0.24 + (1 - t) * 0.08, i % 3 === 0 ? p.accent2 : (i % 2 ? p.membraneLight : p.accent), angle);
  }
  const parents = [root, mid, tip];
  for (let i = 0; i < layers.length; i++) {
    const merged = mergeColored(layers[i], mats.crystal);
    if (merged) parents[i].add(merged);
  }
  // a few additive crystal glints
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const g = box(root, 0.025, 0.025, 0.35 + t * 0.4, s * (0.6 + t * armLen * 0.8), 0.09, -armLen * (0.1 + t * 0.25), mats.glow, 0, -s * (0.6 + t * 0.4), 0);
  }
  box(root, armLen * 0.85, 0.02, 0.04, s * armLen * 0.45, 0.1, 0.03, mats.glow);
  box(mid, foreLen * 0.8, 0.02, 0.03, s * foreLen * 0.4, 0.1, 0.03, mats.glow);
  const marker = new THREE.Object3D();
  marker.position.set(s * (armLen + foreLen + handLen * 0.85), 0.06, -handLen * 0.55);
  tip.add(marker);
  wing.tipMarker = marker;
}

function buildBodyRibbons(inner, cfg, mats, rig) {
  const { W, H, L } = rig.dimensions;
  const p = mats.palette;
  const colors = p.bands || [p.accent, p.accent2, p.metal, p.light];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const root = new THREE.Group();
      root.position.set(s * (W * 0.25 + i * 0.1), H * 0.2, -L * 0.1 - i * 0.1);
      inner.add(root);
      let parent = root;
      const segments = [];
      for (let k = 0; k < 5; k++) {
        const g = new THREE.Group();
        if (k > 0) g.position.z = -0.9;
        parent.add(g);
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(0.22 - k * 0.025, 1.0, 1, 1),
          new THREE.MeshLambertMaterial({
            color: new THREE.Color(colors[(i + k) % colors.length]),
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.55 - k * 0.06,
            fog: true,
            depthWrite: false,
          }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(0, 0, -0.5);
        g.add(mesh);
        parent = g;
        segments.push(g);
      }
      rig.ribbons.push({ root, segments, side: s, phase: i * 2 + (s > 0 ? 0 : 3) });
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Assembly
// ───────────────────────────────────────────────────────────────────────────
export function buildDragon(catalog) {
  const group = new THREE.Group();
  group.name = `dragon:${catalog.id}`;
  const inner = new THREE.Group();
  group.add(inner);
  const mats = makeMaterials(catalog);
  const rig = {
    catalog,
    group,
    inner,
    mats,
    root: inner,
    dimensions: null,
    wings: [],
    legs: [],
    tail: [],
    neck: [],
    whiskers: [],
    extraHeads: [],
    frills: [],
    eyes: [],
    extraEyes: [],
    ribbons: [],
    time: 0,
    blink: 0,
    nextBlink: 3 + Math.random() * 3,
  };
  const cfg = catalog.model;
  // The outermost body root gives us secondary bob and roll without touching
  // the physics orientation.
  buildBody(inner, cfg, mats, rig);
  buildNeck(inner, cfg, mats, rig);
  buildLegs(inner, cfg, mats, rig);
  buildTail(inner, cfg, mats, rig);
  buildWings(inner, cfg, mats, rig);

  // eye glints, slightly enlarged so they read at pixel resolution
  for (const eye of rig.eyes) {
    eye.material = mats.eye;
  }
  // subtle emissive gems on the body
  if (cfg.extra.embers || cfg.extra.crystal) {
    const glowCfg = cfg.extra.embers ? [0.9, 0.35, 0.18] : [0.55, 0.9, 0.9];
    const rng = mulberry32(2213);
    for (let i = 0; i < 8; i++) {
      const s = i % 2 ? 1 : -1;
      box(
        inner,
        0.03, 0.045, 0.2 + rng() * 0.3,
        s * rig.dimensions.W * 0.43,
        rig.dimensions.H * (rng() * 0.35 - 0.12),
        (rng() - 0.5) * rig.dimensions.L * 0.7,
        mats.glow,
      );
    }
  }

  // Centre the rig vertically around the body plane and store a comfortable
  // camera distance for the controller.
  rig.wingSpan = cfg.wing.span;
  rig.bodyLength = cfg.body.length;
  rig.cameraDistance = Math.max(14.5, cfg.wing.span * 1.08);
  rig.cameraHeight = cfg.body.height * 2.9 + 4.0;

  // Useful world-space markers.
  rig.markers = {
    wingL: rig.wings[0]?.tipMarker,
    wingR: rig.wings[1]?.tipMarker,
    tail: rig.tailMarker,
    head: rig.head,
  };

  // initial showcase pose; animation.js refines it every frame
  rig.wings.forEach((w) => {
    w.root.rotation.z = w.baseRootZ;
    w.mid.rotation.z = w.baseMidZ;
    w.tip.rotation.z = w.baseTipZ;
  });

  optimizeRig(rig);
  group.userData.rig = rig;
  return rig;
}

// ───────────────────────────────────────────────────────────────────────────
// Draw-call diet: within each articulated group, bake direct static child
// meshes into one mesh per material. Animation still lives on the groups.
// ───────────────────────────────────────────────────────────────────────────
function normalizeForMerge(geometry) {
  let g = geometry.clone();
  if (g.index) g = g.toNonIndexed();
  for (const attr of ['uv', 'uv1', 'uv2', 'uv3', 'tangent']) g.deleteAttribute(attr);
  g.morphAttributes = {};
  g.clearGroups();
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function mergeDirectMeshes(group, protectedIds) {
  if (!group) return;
  const buckets = new Map();
  const originals = [];
  for (const child of [...group.children]) {
    if (!child.isMesh || child.children.length > 0) continue;
    if (protectedIds.has(child.uuid)) continue;
    const mat = child.material;
    if (Array.isArray(mat)) continue;
    const hasColor = !!child.geometry.attributes.color;
    const key = `${mat.uuid}|${hasColor ? 1 : 0}|${child.renderOrder}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material: mat, geos: [], renderOrder: child.renderOrder, hasColor };
      buckets.set(key, bucket);
    }
    child.updateMatrix();
    const g = normalizeForMerge(child.geometry);
    g.applyMatrix4(child.matrix);
    bucket.geos.push(g);
    originals.push(child);
  }
  if (!originals.length) return;
  let mergedAny = false;
  for (const bucket of buckets.values()) {
    if (bucket.geos.length < 2) {
      for (const g of bucket.geos) g.dispose();
      continue;
    }
    const merged = mergeGeometries(bucket.geos, false);
    for (const g of bucket.geos) g.dispose();
    if (merged) {
      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.renderOrder = bucket.renderOrder;
      mesh.frustumCulled = true;
      group.add(mesh);
      mergedAny = true;
    }
  }
  if (mergedAny) {
    // Only remove originals whose material bucket actually merged.
    const stillNeeded = new Set();
    for (const bucket of buckets.values()) {
      if (bucket.geos.length === 1) {
        // The single mesh was left untouched; find it among originals by identity
        // is not possible from geometry, so keep all single-bucket meshes.
      }
    }
    // Simpler and safe: remove any mesh whose material bucket had >1 meshes.
    const counts = new Map();
    for (const child of originals) {
      const key = `${child.material.uuid}|${child.geometry.attributes.color ? 1 : 0}|${child.renderOrder}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const child of originals) {
      const key = `${child.material.uuid}|${child.geometry.attributes.color ? 1 : 0}|${child.renderOrder}`;
      if ((counts.get(key) || 0) > 1) group.remove(child);
    }
  }
}

function optimizeRig(rig) {
  const protectedIds = new Set();
  for (const e of rig.eyes) protectedIds.add(e.uuid);
  for (const e of rig.extraEyes) protectedIds.add(e.uuid);
  const groups = new Set();
  groups.add(rig.bodyGroup);
  for (const n of rig.neck) groups.add(n);
  groups.add(rig.head);
  if (rig.jaw) groups.add(rig.jaw);
  for (const w of rig.wings) {
    groups.add(w.root);
    groups.add(w.mid);
    groups.add(w.tip);
  }
  for (const t of rig.tail) groups.add(t);
  if (rig.tailTipGroup) groups.add(rig.tailTipGroup);
  for (const l of rig.legs) {
    groups.add(l.root);
    groups.add(l.knee);
    groups.add(l.ankle);
    groups.add(l.foot);
  }
  for (const f of rig.frills) groups.add(f.group);
  for (const h of rig.hornGroups) groups.add(h);
  for (const wh of rig.whiskers) for (const s of wh.segments) groups.add(s);
  for (const eh of rig.extraHeads) {
    for (const s of eh.segments) groups.add(s);
    groups.add(eh.head);
    if (eh.jaw) groups.add(eh.jaw);
  }
  for (const g of groups) mergeDirectMeshes(g, protectedIds);
  for (const w of rig.wings) w.feathers = [];
}
