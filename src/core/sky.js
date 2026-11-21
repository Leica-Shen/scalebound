import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.58, 0.2, 0.78).normalize();

const vertexShader = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uSunDir;
  uniform float uTime;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += noise(p) * a;
      p = p * 2.03 + vec2(3.7, 8.1);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float y = dir.y;
    float h = max(y, 0.0);

    vec3 zenith = vec3(0.105, 0.27, 0.415);
    vec3 high = vec3(0.32, 0.53, 0.62);
    vec3 haze = vec3(0.92, 0.60, 0.36);
    vec3 horizon = vec3(1.16, 0.75, 0.42);
    vec3 below = vec3(0.12, 0.145, 0.15);

    vec3 col = mix(horizon, haze, smoothstep(0.0, 0.11, h));
    col = mix(col, high, smoothstep(0.08, 0.38, h));
    col = mix(col, zenith, smoothstep(0.3, 0.88, h));
    col = mix(col, below, smoothstep(0.0, -0.16, y));

    // broad cloud streaks, painted with a coarse brush
    vec2 skyUV = vec2(atan(dir.z, dir.x) * 1.8, dir.y * 7.0 - 0.8);
    float cloud = fbm(skyUV * vec2(1.35, 0.55) + vec2(uTime * 0.003, 0.0));
    cloud = smoothstep(0.47, 0.7, cloud) * smoothstep(-0.03, 0.12, y) * smoothstep(0.9, 0.18, h);
    vec3 cloudCol = mix(vec3(0.35, 0.34, 0.35), vec3(1.0, 0.69, 0.43), smoothstep(0.08, 0.54, h));
    col = mix(col, cloudCol, cloud * 0.42);

    // sun: a deliberately chunky disc with a soft pixel halo
    float sunDot = max(dot(dir, uSunDir), 0.0);
    float disc = smoothstep(0.99918, 0.99944, sunDot);
    float core = smoothstep(0.99956, 0.99972, sunDot);
    float halo = pow(sunDot, 180.0) * 0.55 + pow(sunDot, 26.0) * 0.075;
    col += vec3(1.0, 0.68, 0.32) * halo;
    col = mix(col, vec3(1.1, 0.96, 0.7), disc * 0.94);
    col = mix(col, vec3(1.24, 1.1, 0.86), core);
    float flare = pow(max(0.0, 1.0 - abs(dir.x * 0.45 + dir.y * 0.3 - 0.2)), 26.0);
    col += vec3(0.9, 0.45, 0.2) * flare * 0.09;

    // atmospheric banding at the horizon, quantised by the pixel pass
    float band = step(0.0, sin(y * 120.0 + fbm(dir.xz * 11.0) * 3.0));
    col += vec3(0.02, 0.012, 0.0) * band * smoothstep(0.12, 0.0, abs(y)) * 0.25;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSky(scene) {
  const geo = new THREE.SphereGeometry(1800, 32, 18);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uSunDir: { value: SUN_DIR.clone() },
      uTime: { value: 0 },
    },
    vertexShader,
    fragmentShader,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  scene.add(mesh);
  return {
    mesh,
    setSunDirection(dir) {
      mat.uniforms.uSunDir.value.copy(dir);
    },
    update(camera, time) {
      mesh.position.copy(camera.position);
      mat.uniforms.uTime.value = time;
    },
  };
}

export function createLighting(scene) {
  const ambient = new THREE.AmbientLight(0xbfd4cf, 0.42);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xc4e4e4, 0x66523b, 1.22);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffc384, 3.55);
  sun.position.copy(SUN_DIR).multiplyScalar(420);
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x79a9c5, 0.62);
  fill.position.set(120, 90, -180);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xff9a70, 0.5);
  rim.position.set(-180, 50, 120);
  scene.add(rim);

  // A soft "camera-side" fill keeps the dragon legible against the sunset.
  const hero = new THREE.DirectionalLight(0xd3e6df, 1.45);
  hero.position.set(60, 80, 140);
  hero.target.position.set(0, 0, 0);
  scene.add(hero);
  scene.add(hero.target);

  return { ambient, hemi, sun, fill, rim, hero };
}
