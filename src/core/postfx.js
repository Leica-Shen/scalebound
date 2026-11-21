import * as THREE from 'three';

const vertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform sampler2D tDither;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uFlash;
  uniform float uWarmth;
  uniform float uUnderwater;
  uniform float uNight;
  uniform float uRain;
  uniform float uChinese;

  vec3 toSRGB(vec3 c) {
    return pow(max(c, vec3(0.0)), vec3(0.454545));
  }

  void main() {
    vec2 uv = vUv;
    vec2 centered = uv - 0.5;
    float radius = length(centered);

    // A tiny radial lens push when sprinting; keeps the pixel grid intact.
    uv += centered * radius * uSpeed * 0.0075;

    vec2 texel = 1.0 / uResolution;
    float edge = smoothstep(0.1, 0.62, radius);
    vec2 ca = centered * texel * (1.0 + uSpeed * 2.4) * edge * (1.0 - uChinese * 0.92);

    vec3 c;
    c.r = texture2D(tDiffuse, uv + ca).r;
    c.g = texture2D(tDiffuse, uv).g;
    c.b = texture2D(tDiffuse, uv - ca).b;

    // A little extra gleam in the brightest pixels, sampled as a cheap bloom.
    vec3 n = texture2D(tDiffuse, uv + vec2(texel.x * 2.5, 0.0)).rgb;
    vec3 n2 = texture2D(tDiffuse, uv - vec2(0.0, texel.y * 2.5)).rgb;
    float bright = max(0.0, dot(max(c, max(n, n2)), vec3(0.3, 0.58, 0.12)) - 0.74);
    c += bright * vec3(1.0, 0.64, 0.3) * 0.18;

    // underwater grade and shimmering caustic bands
    if (uUnderwater > 0.001) {
      float caust = sin(uv.x * 74.0 + uTime * 1.3) * sin(uv.y * 93.0 - uTime * 1.7);
      float caust2 = sin((uv.x + uv.y) * 51.0 - uTime * 0.8);
      c *= mix(vec3(1.0), vec3(0.52, 0.88, 1.04), uUnderwater);
      c += vec3(0.02, 0.08, 0.11) * uUnderwater * (0.5 + 0.5 * caust + 0.25 * caust2);
    }
    c = mix(c, c * vec3(0.72, 0.84, 1.04), uNight * 0.25);
    vec3 srgb = toSRGB(c);

    // warm highlights, cool shadows — a unified dusk grade for all dragons
    float luma = dot(srgb, vec3(0.299, 0.587, 0.114));
    srgb = mix(srgb, srgb * vec3(1.06, 1.015, 0.94), uWarmth);
    srgb = mix(srgb * vec3(0.9, 0.98, 1.07), srgb, smoothstep(0.04, 0.66, luma));
    float luma2 = dot(srgb, vec3(0.299, 0.587, 0.114));
    srgb = mix(vec3(luma2), srgb, 1.14);
    srgb = clamp((srgb - 0.5) * 1.08 + 0.515, 0.0, 1.0);

    // C-edition ink wash: paper tint, soft mineral colour, and a restrained
    // brush outline sampled from local luminance. It remains a painted pixel
    // diorama rather than pretending to be a flat 2D illustration.
    if (uChinese > 0.001) {
      vec3 sL = toSRGB(texture2D(tDiffuse, uv - vec2(texel.x, 0.0)).rgb);
      vec3 sR = toSRGB(texture2D(tDiffuse, uv + vec2(texel.x, 0.0)).rgb);
      vec3 sU = toSRGB(texture2D(tDiffuse, uv - vec2(0.0, texel.y)).rgb);
      vec3 sD = toSRGB(texture2D(tDiffuse, uv + vec2(0.0, texel.y)).rgb);
      float lC = dot(srgb, vec3(0.299, 0.587, 0.114));
      float lL = dot(sL, vec3(0.299, 0.587, 0.114));
      float lR = dot(sR, vec3(0.299, 0.587, 0.114));
      float lU = dot(sU, vec3(0.299, 0.587, 0.114));
      float lD = dot(sD, vec3(0.299, 0.587, 0.114));
      float edge = max(max(abs(lL - lR), abs(lU - lD)), abs(lC - (lL + lR + lU + lD) * 0.25));
      vec3 paper = vec3(0.94, 0.91, 0.82);
      vec3 ink = vec3(0.10, 0.12, 0.11);
      vec3 wash = mix(vec3(lC), srgb, 0.84);
      wash = mix(wash, wash * vec3(0.92, 1.06, 1.02), 0.55);
      wash = mix(paper, wash, 0.32);
      float inkShadow = smoothstep(0.42, 0.02, lC) * 0.24;
      wash = mix(wash, vec3(0.16, 0.23, 0.23), inkShadow);
      wash += vec3(0.045, 0.026, 0.004) * smoothstep(0.48, 0.9, lC);
      wash = mix(wash, ink, smoothstep(0.025, 0.11, edge) * 0.84);
      float fibre = fract(sin(dot(uv * vec2(313.7, 91.1), vec2(12.9898, 78.233))) * 43758.5453);
      wash += (fibre - 0.5) * 0.014;
      srgb = mix(srgb, wash, uChinese);
    }

    // Pixel editions keep the ordered 4×4 dither; C is a continuous wash.
    if (uChinese < 0.5) {
      float d = texture2D(tDither, gl_FragCoord.xy / 4.0).r - 0.5;
      float levels = 38.0;
      srgb = floor(srgb * levels + d * 0.9 + 0.5) / levels;
    }

    // CRT / print vignette, with a faint warm glow at the horizon
    float vig = smoothstep(0.86, 0.2, radius);
    srgb *= mix(0.77, 1.0, vig);
    srgb *= 1.0 - uRain * 0.12;
    float scan = 1.0 - (0.016 - uChinese * 0.013) * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159));
    srgb *= scan;

    // Roar / pickup flash
    srgb += uFlash * vec3(0.28, 0.2, 0.1);

    gl_FragColor = vec4(clamp(srgb, 0.0, 1.0), 1.0);
  }
`;

export class PixelPipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.chinese = typeof window !== 'undefined' && !!window.__SCALEBOUND_CN__;
    this.resolution = new THREE.Vector2(640, 360);
    this.renderHeight = 340;
    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const targetOptions = {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.target = new THREE.WebGLRenderTarget(640, 340, targetOptions);
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    if (this.chinese) {
      this.target.texture.minFilter = THREE.LinearFilter;
      this.target.texture.magFilter = THREE.LinearFilter;
    }

    // 4x4 Bayer matrix in a tiny nearest-filtered texture
    const ditherData = new Uint8Array([
      0, 8, 2, 10,
      12, 4, 14, 6,
      3, 11, 1, 9,
      15, 7, 13, 5,
    ].map((v) => v * 16 + 8));
    const dither = new THREE.DataTexture(ditherData, 4, 4, THREE.RedFormat);
    dither.needsUpdate = true;
    dither.minFilter = THREE.NearestFilter;
    dither.magFilter = THREE.NearestFilter;

    this.material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.target.texture },
        tDither: { value: dither },
        uResolution: { value: this.resolution },
        uTime: { value: 0 },
        uSpeed: { value: 0 },
        uFlash: { value: 0 },
        uWarmth: { value: 1 },
        uUnderwater: { value: 0 },
        uNight: { value: 0 },
        uRain: { value: 0 },
        uChinese: { value: window.__SCALEBOUND_CN__ ? 1 : 0 },
      },
      vertexShader,
      fragmentShader,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);

    this.cssWidth = 1;
    this.cssHeight = 1;
    this.pixelScale = 1;
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(width, height) {
    this.cssWidth = width;
    this.cssHeight = height;
    // Pixel editions use a fixed low internal resolution. The C edition is
    // painted at near-native resolution with smooth filtering: no pixel grid,
    // no palette quantization, no dithering.
    const scale = this.chinese ? Math.min(1, 1440 / Math.max(1, width), 900 / Math.max(1, height)) : 1;
    const h = this.chinese
      ? Math.max(480, Math.round(height * scale))
      : Math.round(Math.max(264, Math.min(378, height * 0.395)));
    const w = this.chinese
      ? Math.round(width * scale)
      : Math.round(Math.min(940, h * (width / Math.max(1, height))));
    this.resolution.set(w, h);
    this.renderHeight = h;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.target.setSize(w, h);
    if (this.chinese) {
      this.target.texture.minFilter = THREE.LinearFilter;
      this.target.texture.magFilter = THREE.LinearFilter;
      this.target.texture.needsUpdate = true;
    }
    this.material.uniforms.uResolution.value.set(w, h);
    this.pixelScale = height / h;
  }

  render(scene, camera, time, effects = {}) {
    const renderer = this.renderer;
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uSpeed.value = effects.speed ?? 0;
    this.material.uniforms.uFlash.value = effects.flash ?? 0;
    this.material.uniforms.uWarmth.value = effects.warmth ?? 1;
    this.material.uniforms.uUnderwater.value = effects.underwater ?? 0;
    this.material.uniforms.uNight.value = effects.night ?? 0;
    this.material.uniforms.uRain.value = effects.rain ?? 0;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(this.quadScene, this.quadCamera);
  }
}
