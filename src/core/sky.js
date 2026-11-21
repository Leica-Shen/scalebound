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
  uniform vec3 uMoonDir;
  uniform vec3 uSunColor;
  uniform vec3 uMoonColor;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uGround;
  uniform float uNight;
  uniform float uCloudiness;
  uniform float uWeather;
  uniform float uTime;
  uniform float uLightning;
  uniform float uStarStrength;

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

    vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.13, h));
    col = mix(col, uHaze, smoothstep(0.09, 0.01, h) * 0.24);
    col = mix(col, uGround, smoothstep(0.01, -0.18, y));

    // faint high cloud streaks; density reacts to weather
    vec2 skyUV = vec2(atan(dir.z, dir.x) * 1.9, dir.y * 6.3 - 0.6);
    float cloud = fbm(skyUV * vec2(1.45, 0.62) + vec2(uTime * 0.007, uTime * 0.001));
    cloud = smoothstep(0.48 - uCloudiness * 0.16, 0.77 - uCloudiness * 0.12, cloud);
    cloud *= smoothstep(-0.05, 0.2, y) * smoothstep(0.95, 0.05, h);
    vec3 cloudCol = mix(uSunColor * 0.55, uHorizon * 1.1, 0.52);
    if (uWeather > 1.5 && uWeather < 3.5) cloudCol *= 0.56;
    if (uWeather > 3.5) cloudCol = mix(cloudCol, vec3(0.64, 0.64, 0.67), 0.35);
    col = mix(col, cloudCol, cloud * (0.22 + uCloudiness * 0.72));

    // stars appear when the sun drops behind the world
    vec3 s = floor(dir * 260.0);
    float star = hash(s.xz + s.y * 7.1);
    star = smoothstep(0.994, 1.0, star) * smoothstep(-0.02, 0.24, y);
    float twinkle = 0.65 + 0.35 * sin(uTime * 2.0 + dot(s.xz, vec2(2.1, 1.7)));
    col += vec3(0.9, 0.95, 1.0) * star * uStarStrength * twinkle;

    // sun disc and chunky halo
    float sunDot = max(dot(dir, uSunDir), 0.0);
    float sunAbove = smoothstep(0.0, 0.1, uSunDir.y);
    float disc = smoothstep(0.99912, 0.99942, sunDot);
    float core = smoothstep(0.99954, 0.99972, sunDot);
    float halo = pow(sunDot, 180.0) * 0.55 + pow(sunDot, 26.0) * 0.07;
    col += uSunColor * halo * sunAbove * (1.0 - uCloudiness * 0.5);
    col = mix(col, mix(uSunColor, vec3(1.12, 0.99, 0.8), 0.55), disc * 0.9 * sunAbove * (1.0 - uCloudiness * 0.55));
    col = mix(col, vec3(1.2, 1.08, 0.86), core * sunAbove * (1.0 - uCloudiness * 0.7));

    // Afterglow even after the disc has gone below the horizon.
    vec2 dirH = normalize(dir.xz + vec2(0.0001));
    vec2 sunH = normalize(uSunDir.xz + vec2(0.0001));
    float towardSun = pow(max(dot(dirH, sunH), 0.0), 5.0);
    float twilightBand = smoothstep(0.3, 0.0, h) * smoothstep(0.0, 0.12, 0.2 - abs(uSunDir.y + 0.08));
    col += mix(uSunColor, vec3(0.95, 0.42, 0.28), 0.35) * towardSun * twilightBand * 0.42;

    // moon: a smaller pale disc with pixel crater bites
    float moonDot = max(dot(dir, uMoonDir), 0.0);
    float moonAbove = smoothstep(-0.03, 0.06, uMoonDir.y);
    float moonDisc = smoothstep(0.99962, 0.99983, moonDot);
    float moonCore = smoothstep(0.99986, 0.99994, moonDot);
    float craters = noise(dir.xz * 90.0) * 0.12 + noise(dir.xz * 220.0) * 0.08;
    col = mix(col, uMoonColor * (0.82 + craters), moonDisc * moonAbove * (0.65 + uNight * 0.45));
    col = mix(col, uMoonColor * 1.15, moonCore * moonAbove);

    // horizon fog / heavy weather veil
    float veil = smoothstep(0.22, 0.0, h);
    if (uWeather > 4.5) veil *= 1.0;
    col = mix(col, uHaze, veil * (uWeather > 4.5 ? 0.55 : 0.16));
    col += uLightning * vec3(0.65, 0.72, 0.8);

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
      uMoonDir: { value: new THREE.Vector3(0.4, 0.4, -0.8) },
      uSunColor: { value: new THREE.Color(0xffd08a) },
      uMoonColor: { value: new THREE.Color(0xd7e6f2) },
      uZenith: { value: new THREE.Color(0x17476b) },
      uHorizon: { value: new THREE.Color(0xe3b47c) },
      uHaze: { value: new THREE.Color(0xc9b28d) },
      uGround: { value: new THREE.Color(0x121918) },
      uNight: { value: 0 },
      uCloudiness: { value: 0.18 },
      uWeather: { value: 0 },
      uTime: { value: 0 },
      uLightning: { value: 0 },
      uStarStrength: { value: 0 },
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
    material: mat,
    setSunDirection(dir) { mat.uniforms.uSunDir.value.copy(dir); },
    applyEnvironment(env) {
      mat.uniforms.uSunDir.value.copy(env.sunDir);
      mat.uniforms.uMoonDir.value.copy(env.moonDir);
      mat.uniforms.uSunColor.value.copy(env.colors.sun);
      mat.uniforms.uMoonColor.value.copy(env.colors.moon);
      mat.uniforms.uZenith.value.copy(env.colors.zenith);
      mat.uniforms.uHorizon.value.copy(env.colors.horizon);
      mat.uniforms.uHaze.value.copy(env.colors.haze);
      mat.uniforms.uGround.value.copy(env.colors.ground);
      mat.uniforms.uNight.value = env.night;
      mat.uniforms.uCloudiness.value = env.cloudiness;
      mat.uniforms.uWeather.value = env.weatherIndex;
      mat.uniforms.uStarStrength.value = env.starStrength;
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
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -170;
  sun.shadow.camera.right = 170;
  sun.shadow.camera.top = 170;
  sun.shadow.camera.bottom = -170;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);

  const moon = new THREE.DirectionalLight(0x9fc4e8, 0.0);
  moon.position.set(120, 200, -160);
  scene.add(moon);

  const fill = new THREE.DirectionalLight(0x79a9c5, 0.62);
  fill.position.set(120, 90, -180);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xff9a70, 0.5);
  rim.position.set(-180, 50, 120);
  scene.add(rim);

  // A soft "camera-side" fill keeps the dragon legible against any sky.
  const hero = new THREE.DirectionalLight(0xd3e6df, 1.45);
  hero.position.set(60, 80, 140);
  hero.target.position.set(0, 0, 0);
  scene.add(hero);
  scene.add(hero.target);

  return { ambient, hemi, sun, moon, fill, rim, hero };
}
