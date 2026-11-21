import './styles.css';
import * as THREE from 'three';
import { PixelPipeline } from './core/postfx.js';
import { World } from './game/world.js';
import { UI } from './game/ui.js';
import { AudioEngine } from './core/audio.js';
import { Game } from './game/game.js';
import { DRAGONS } from './dragon/catalog.js';
import { WORLD_SEED } from './core/terrain.js';

const canvas = document.getElementById('scene');
const app = document.getElementById('app');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
} catch (err) {
  console.error(err);
  document.getElementById('noWebgl').classList.remove('is-hidden');
  document.getElementById('loader').classList.add('is-hidden');
  throw err;
}
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.5;
renderer.shadowMap.enabled = false;
renderer.autoClear = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.5, 2800);
camera.position.set(0, 100, 200);

const pipeline = new PixelPipeline(renderer);
const ui = new UI(DRAGONS);
const audio = new AudioEngine();
const world = new World(scene);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  pipeline.resize(w, h);
  world.effects.setViewSize(pipeline.renderHeight);
}
resize();
window.addEventListener('resize', resize);

const game = new Game({
  scene,
  camera,
  world,
  ui,
  audio,
  catalog: DRAGONS,
});
ui.setSoundEnabled(game.soundEnabled);

window.__SCALEBOUND__ = {
  game, world, ui, audio, scene, camera, renderer, pipeline,
  ready: false,
  finishIntro: () => game.finishIntro(),
  start: () => game.startRun(),
  state: () => game.debugState(),
};

let last = performance.now();
let running = false;

function frame(now) {
  const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
  last = now;
  game.update(dt);
  const fx = game.postEffects;
  pipeline.render(scene, camera, now / 1000, fx);
  requestAnimationFrame(frame);
}

const LOADING_LINES = [
  [0.0, '铺 展 山 海 骨 骼'],
  [0.22, '唤 醒 河 川 与 风'],
  [0.48, '点 亮 九 曜 龙 魂'],
  [0.72, '展 开 无 界 长 天'],
  [0.9, '缔 结 龙 契 中'],
];

function loadingStatus(p) {
  let text = LOADING_LINES[0][1];
  for (const [threshold, line] of LOADING_LINES) {
    if (p >= threshold) text = line;
  }
  return text;
}

async function boot() {
  const bootStarted = performance.now();
  ui.setLoading(0.035, '铺 展 山 海 骨 骼');
  try {
    const fontPromise = document.fonts?.load ? document.fonts.load('12px Zpix') : Promise.resolve();
    await Promise.race([fontPromise, wait(2400)]);
    await Promise.race([document.fonts?.ready || Promise.resolve(), wait(2400)]);
  } catch { /* font fallback is fine */ }

  ui.setLoading(0.08, '唤 醒 河 川 与 风');
  await world.warmup(world.spawn, 6, (p) => {
    const progress = 0.08 + p * 0.78;
    ui.setLoading(progress, loadingStatus(progress));
  });

  ui.setLoading(0.9, '点 亮 九 曜 龙 魂');
  // Let the browser paint the loader before the dragon rig is assembled.
  await wait(40);
  game._placeMenuCameraImmediate();
  // Render one frame while still covered: warms shaders and populates the
  // terrain buffers before the player sees the menu.
  game.update(1 / 60);
  pipeline.render(scene, camera, performance.now() / 1000, game.postEffects);

  const elapsed = performance.now() - bootStarted;
  if (elapsed < 1700) await wait(1700 - elapsed);
  ui.setLoading(1, '龙 契 已 成');
  await wait(260);
  ui.revealMenu();
  ui.setAsideCoord(game.menuAnchor.x, game.menuAnchor.z);
  document.getElementById('seedLabel').textContent = String(WORLD_SEED);
  last = performance.now();
  running = true;
  requestAnimationFrame(frame);
  window.__SCALEBOUND__.ready = true;
  console.info('[鳞界] world ready · spawn', world.spawn, '· chunks', world.chunks.size);
}

boot().catch((err) => {
  console.error('[鳞界] boot failed', err);
  document.getElementById('loader').classList.add('is-hidden');
  const no = document.getElementById('noWebgl');
  no.classList.remove('is-hidden');
  no.querySelector('h2').textContent = '山海未能展开';
  no.querySelector('p').textContent = '初始化失败，请刷新页面或检查浏览器控制台。';
});

// Keep rendering responsive across hidden-tab wakeups.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) last = performance.now();
});

window.addEventListener('beforeunload', () => {
  try { audio.ctx?.close(); } catch { /* ignore */ }
});
