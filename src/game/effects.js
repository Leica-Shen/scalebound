import * as THREE from 'three';

const MAX_PARTICLES = 620;

const particleVert = /* glsl */`
  precision highp float;
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uScale / max(0.2, -mv.z), 1.0, 34.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const particleFrag = /* glsl */`
  precision highp float;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = max(abs(p.x), abs(p.y)) * 2.0;
    if (d > 1.0) discard;
    float core = 1.0 - smoothstep(0.18, 1.0, d);
    gl_FragColor = vec4(vColor * (0.85 + core * 0.9), vAlpha * (0.35 + core * 0.65));
  }
`;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.alphas = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, MAX_PARTICLES);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      uniforms: { uScale: { value: 300 } },
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
    this.geo = geo;
    this.pool = new Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool[i] = {
        live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 0.2, drag: 1, gravity: 0, color: new THREE.Color(),
      };
    }
    this.cursor = 0;
    this.liveCount = 0;
    this.dirty = true;
    this._color = new THREE.Color();

    // expanding rings for roars and powerful flap pulses
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.72, 1, 28, 1);
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd37b,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      this.rings.push({ mesh, mat, time: 0, life: 0, maxLife: 1, startScale: 1, endScale: 18, active: false });
    }
    this.ringCursor = 0;
  }

  setViewSize(height) {
    // 54°-ish vertical FOV gives the particles a natural projected size.
    this.material.uniforms.uScale.value = height * 0.94;
  }

  emit(x, y, z, vx, vy, vz, color, size = 0.24, life = 1, gravity = 0, drag = 1.2) {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    p.live = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.gravity = gravity;
    p.drag = drag;
    p.color.set(color);
    this.dirty = true;
  }

  burst(pos, color, count = 16, power = 7, size = 0.32, life = 1.15) {
    const c = this._color.set(color);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = power * (0.35 + Math.random() * 0.9);
      this.emit(
        pos.x + (Math.random() - 0.5) * 1.2,
        pos.y + (Math.random() - 0.5) * 1.5,
        pos.z + (Math.random() - 0.5) * 1.5,
        Math.cos(theta) * Math.sin(phi) * speed,
        Math.cos(phi) * speed * 0.8 + 1,
        Math.sin(theta) * Math.sin(phi) * speed,
        c.getHex(), size * (0.65 + Math.random() * 0.75), life * (0.65 + Math.random() * 0.7),
        -0.8, 1.8,
      );
    }
  }

  wingTrail(pos, color, speed, side = 1) {
    const n = speed > 25 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const c = this._color.set(color);
      this.emit(
        pos.x + (Math.random() - 0.5) * 0.8,
        pos.y + (Math.random() - 0.5) * 0.5,
        pos.z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 2.5 - (Math.random() * speed * 0.08),
        (Math.random() - 0.25) * 1.4,
        (Math.random() - 0.5) * 2.5,
        c.getHex(), 0.08 + Math.random() * 0.11, 0.7 + Math.random() * 0.7, 0.2, 1.4,
      );
    }
  }

  trailBurst(pos, color, side = 1) {
    for (let i = 0; i < 11; i++) {
      this.emit(
        pos.x + (Math.random() - 0.5) * 1.2,
        pos.y + (Math.random() - 0.5) * 0.8,
        pos.z + (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 5 - side * 1.4,
        -1.2 - Math.random() * 3.2,
        (Math.random() - 0.5) * 5,
        color, 0.16 + Math.random() * 0.16, 0.7 + Math.random() * 0.45, -1.4, 0.6,
      );
    }
  }

  roar(pos, color = 0xffd995) {
    const starts = [[0, 0, 0], [-Math.PI / 2, 0, 0], [0, 0, Math.PI / 2]];
    for (let k = 0; k < 3; k++) {
      const r = this.rings[this.ringCursor];
      this.ringCursor = (this.ringCursor + 1) % this.rings.length;
      r.mesh.visible = true;
      r.mesh.position.copy(pos);
      r.mesh.rotation.set(starts[k][0] + (Math.random() - 0.5) * 0.3, starts[k][1], starts[k][2]);
      r.mat.color.set(color);
      r.mat.opacity = 0.4;
      r.time = 0;
      r.life = 0.7 + k * 0.14;
      r.maxLife = r.life;
      r.startScale = 1.0;
      r.endScale = 5.5 + k * 2.8;
      r.active = true;
      r.mesh.scale.setScalar(1);
    }
    this.burst(pos, color, 20, 9, 0.32, 1.1);
  }

  update(dt) {
    const pos = this.positions;
    const col = this.colors;
    const sizes = this.sizes;
    const alphas = this.alphas;
    let changed = this.dirty;
    this.dirty = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.pool[i];
      if (!p.live) {
        alphas[i] = 0;
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        p.live = false;
        alphas[i] = 0;
        changed = true;
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      p.vy = p.vy * d + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      col[i * 3] = p.color.r;
      col[i * 3 + 1] = p.color.g;
      col[i * 3 + 2] = p.color.b;
      const t = p.life / p.maxLife;
      alphas[i] = Math.min(1, t * 2.2) * (0.25 + t * 0.75);
      sizes[i] = p.size * (1.2 - t * 0.35);
      changed = true;
    }
    if (changed) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
    }

    for (const r of this.rings) {
      if (!r.active) continue;
      r.time += dt;
      const t = Math.min(1, r.time / r.life);
      const s = r.startScale + (r.endScale - r.startScale) * (1 - Math.pow(1 - t, 2.4));
      r.mesh.scale.setScalar(s);
      r.mesh.rotation.z += dt * 0.4;
      r.mat.opacity = (1 - t) * (1 - t) * 0.4;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
      }
    }
  }

  clear() {
    for (const p of this.pool) p.live = false;
    this.dirty = true;
    for (const r of this.rings) {
      r.active = false;
      r.mesh.visible = false;
    }
  }
}
