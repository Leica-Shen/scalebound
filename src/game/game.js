import * as THREE from 'three';
import { buildDragon } from '../dragon/model.js';
import { DragonAnimator } from '../dragon/animation.js';
import { clamp, damp, lerp, smootherstep, smoothstep } from '../core/noise.js';
import { SEA_LEVEL, regionAt } from '../core/terrain.js';
import { getShadowTexture } from '../core/textures.js';

const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _target = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

const TAU = Math.PI * 2;
const normAngle = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};
const normDeg = (a) => {
  const d = (a * 180 / Math.PI) % 360;
  return d < 0 ? d + 360 : d;
};

function loadNumber(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v;
  } catch {
    return def;
  }
}
function save(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}

export class Game {
  constructor({ scene, camera, world, ui, audio, catalog }) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.ui = ui;
    this.audio = audio;
    this.catalog = catalog;

    this.time = 0;
    this.mode = 'menu';
    this.paused = false;
    this.introActive = false;
    this.controlsLocked = true;
    this.transitioning = false;
    this.runTime = 0;
    this.distance = 0;

    this.cache = new Map();
    this.selectedIndex = 0;
    this.rig = null;
    this.animator = null;
    this.dragon = null;

    this.spawn = world.spawn;
    this.vistaYaw = normAngle(Math.PI / 2 - this.spawn.yaw);
    this.world.setSunForYaw(this.vistaYaw);
    const terrain = world.getHeight(this.spawn.x, this.spawn.z);
    this.menuAnchor = new THREE.Vector3(
      this.spawn.x,
      Math.max(this.spawn.y, terrain + 52, 58),
      this.spawn.z,
    );
    this.menuCameraAngle = this.vistaYaw + Math.PI + 0.26;
    this.menuYaw = this.menuCameraAngle + 0.34;
    this.menuDistance = 28;
    this.menuHeight = 8;
    this.menuOrbit = 0;
    this.menuOrbitTarget = 0;

    this.playerPos = new THREE.Vector3().copy(this.menuAnchor);
    this.playerVelocity = new THREE.Vector3();
    this.yaw = this.menuYaw;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.stamina = 100;
    this.flapHeld = false;
    this.nextFlapAt = 0;
    this.flapLift = 0;
    this.speedKick = 0;
    this.stall = 0;
    this.regenDelay = 0;
    this.boostActive = false;
    this.wasBoosting = false;
    this.brake = false;
    this.skimmish = false;
    this.groundY = SEA_LEVEL;
    this.distanceToGround = 100;
    this.shake = 0;
    this.flash = 0;

    this.pitchAxis = 0;
    this.turnAxis = 0;
    this.introElapsed = 0;
    this.introRoared = false;
    this.cameraMode = 0;
    this.orbit = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, dragging: false, lastX: 0, lastY: 0 };
    this.chaseLook = new THREE.Vector3().copy(this.menuAnchor);
    this.touchInput = { x: 0, y: 0, active: false };
    this.touchFlap = false;
    this.touchBoost = false;
    this.lastCollision = -10;
    this.lastFlapSound = -10;
    this.lastPickup = -99;
    this.combo = 1;
    this.comboTimer = 0;
    this.souls = 0;
    this.rings = 0;
    this.ringBlessing = 0;
    this.auraTier = 0;
    this.auraTimer = 0;
    this.trailTimer = 0;
    this.regionInfo = null;
    this._regionCheck = -10;
    this.regionCandidate = null;
    this.regionHold = 0;
    this.lastAnnounce = -100;
    this.controlsHintShown = 0;
    this.hudVisible = false;
    this._lastGroundWarning = -10;
    this._roarCooldown = 0;
    this._boostGesture = false;
    this._wasFlapKey = false;
    this.soundEnabled = loadNumber('scalebound.audio', '1') !== '0';
    this._audioInitialized = false;
    this._winBlurPause = false;

    let savedId = null;
    try { savedId = localStorage.getItem('scalebound.dragon'); } catch { /* ignore */ }
    const savedIndex = this.catalog.findIndex((d) => d.id === savedId);
    this.selectedIndex = savedIndex >= 0 ? savedIndex : 0;

    this.ui.setCallbacks({
      onSelect: (i) => this.selectDragon(i),
      onCycle: (dir) => this.cycleDragon(dir),
      onRandom: () => this.randomDragon(),
      onStart: () => this.startRun(),
      onToggleAudio: () => this.toggleAudio(),
      onHoverCard: () => {
        this.ensureAudio();
        this.audio.uiHover();
      },
      onPause: () => this.pauseGame(),
      onResume: () => this.resumeGame(),
      onPauseHelpRequested: () => this.requestHelp(true),
      onHelpRequested: () => this.requestHelp(false),
      onHelpCloseRequested: () => this.closeHelp(),
      onBackToMenu: () => this.backToMenu(),
    });

    this._bindInput();
    this._bindTouch();
    this._bindPointerOrbit();

    this.ui.selectIndex(this.selectedIndex, { scroll: false });
    this.ui.setSoundEnabled(this.soundEnabled);
    this.ui.setAsideCoord(this.menuAnchor.x, this.menuAnchor.z);
    this.selectDragon(this.selectedIndex, { initial: true, silent: true });
    this.world.setMode('menu');
    this.world.setGameplayVisible(false);
    this._placeMenuCameraImmediate();
    this._refreshRegion();
    this.ui.updateHud(this._buildHudState(), 0);

    this._createShadow();

    this._onFirstGesture = () => this.ensureAudio();
    window.addEventListener('pointerdown', this._onFirstGesture, { capture: true });
    window.addEventListener('keydown', this._onFirstGesture, { capture: true });
  }

  _createShadow() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: getShadowTexture(),
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      depthTest: true,
      color: 0x131c18,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: true,
    });
    this.shadow = new THREE.Mesh(geo, mat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
    this.shadow.visible = false;
    this.scene.add(this.shadow);
  }

  _updateShadow(pos) {
    if (!this.shadow) return;
    const ground = Math.max(this.world.getHeight(pos.x, pos.z), SEA_LEVEL);
    const altitude = Math.max(0, pos.y - ground);
    if (altitude > 260) {
      this.shadow.visible = false;
      return;
    }
    this.shadow.visible = true;
    const water = this.world.getHeight(pos.x, pos.z) < SEA_LEVEL;
    this.shadow.position.set(pos.x, ground + (water ? 0.24 : 0.18), pos.z);
    const size = clamp(4.2 + altitude * 0.12, 4.2, 24) * (this.rig ? clamp(this.rig.wingSpan / 16, 0.8, 1.2) : 1);
    this.shadow.scale.set(size, size * 0.68, 1);
    this.shadow.material.opacity = 0.4 * clamp(1 - altitude / 250, 0.08, 1);
  }

  // ── audio ──────────────────────────────────────────────────────────────
  ensureAudio() {
    if (!this._audioInitialized) {
      this._audioInitialized = true;
      this.audio.init().then(() => {
        this.audio.setEnabled(this.soundEnabled);
        this.audio.setMode(this.mode === 'flight' ? 'flight' : 'menu');
      }).catch(() => {});
    }
  }

  toggleAudio() {
    this.ensureAudio();
    this.soundEnabled = !this.soundEnabled;
    save('scalebound.audio', this.soundEnabled ? '1' : '0');
    this.ui.setSoundEnabled(this.soundEnabled);
    this.audio.setEnabled(this.soundEnabled);
    if (this.mode === 'flight') {
      this.ui.toast(this.soundEnabled ? '声音已开启' : '声音已静音', { duration: 1600 });
    }
  }

  // ── dragon selection ───────────────────────────────────────────────────
  _getEntry(index) {
    const db = this.catalog[index];
    if (this.cache.has(db.id)) return this.cache.get(db.id);
    const rig = buildDragon(db);
    const animator = new DragonAnimator(rig);
    const entry = { dragon: db, rig, animator };
    this.cache.set(db.id, entry);
    return entry;
  }

  selectDragon(index, { initial = false, silent = false } = {}) {
    const i = ((index % this.catalog.length) + this.catalog.length) % this.catalog.length;
    if (this.rig && i === this.selectedIndex && !initial) return;
    if (this.mode !== 'menu' && !initial) return;
    const entry = this._getEntry(i);
    if (this.rig) this.scene.remove(this.rig.group);
    this.selectedIndex = i;
    this.dragon = entry.dragon;
    this.rig = entry.rig;
    this.animator = entry.animator;
    this.scene.add(this.rig.group);
    this.rig.group.position.copy(this.menuAnchor);
    this.rig.group.rotation.set(0, this.menuYaw, 0);
    this.rig.group.scale.setScalar(1);
    this.menuDistance = this.rig.cameraDistance * 1.03 + 4.6;
    this.menuHeight = this.rig.dimensions.H * 1.8 + 5.4;
    this.world.souls.pickupRadius = 7.2 * (this.dragon.flight.pickup || 1);
    this.ui.selectIndex(i, { scroll: !initial });
    this.ui.setSoundEnabled(this.soundEnabled);
    save('scalebound.dragon', this.dragon.id);
    this.ui.setAsideCoord(this.menuAnchor.x, this.menuAnchor.z);
    for (const w of this.rig.wings) {
      if (w.tipMarker) w.tipMarker.updateWorldMatrix(true, false);
    }
    if (!silent) {
      this.world.effects.clear();
      _tmp.copy(this.menuAnchor);
      _tmp.y += this.rig.dimensions.H * 0.2;
      this.world.effects.burst(_tmp, this.dragon.palette.glow, 26, 8, 0.28, 1.6);
      if (this._audioInitialized) this.audio.uiClick();
      this.ui.flash(0.13, 240);
      this.menuOrbitTarget = 0;
      this.menuOrbit = 0;
    }
    this.rig.group.updateMatrixWorld(true);
    this._animateMenuDragon(0, true);
  }

  cycleDragon(dir) {
    if (this.ui.transitioning || this.transitioning || this.mode !== 'menu') return;
    this.ensureAudio();
    this.selectDragon(this.selectedIndex + (dir < 0 ? -1 : 1));
  }

  randomDragon() {
    if (this.ui.transitioning || this.transitioning || this.mode !== 'menu') return;
    this.ensureAudio();
    let next = this.selectedIndex;
    while (next === this.selectedIndex && this.catalog.length > 1) {
      next = Math.floor(Math.random() * this.catalog.length);
    }
    this.selectDragon(next);
  }

  // ── menu ───────────────────────────────────────────────────────────────
  _placeMenuCameraImmediate() {
    const angle = this.menuCameraAngle;
    const camera = this.camera;
    camera.position.set(
      this.menuAnchor.x + Math.sin(angle) * this.menuDistance,
      this.menuAnchor.y + this.menuHeight,
      this.menuAnchor.z + Math.cos(angle) * this.menuDistance,
    );
    this.chaseLook.copy(this.menuAnchor);
    this.chaseLook.y += this.rig ? this.rig.dimensions.H * 0.22 : 1.4;
    camera.up.copy(UP);
    camera.lookAt(this.chaseLook);
    camera.rotateY(0.1);
    camera.fov = 46;
    camera.updateProjectionMatrix();
  }

  _animateMenuDragon(dt, immediate = false) {
    if (!this.rig) return;
    const t = this.time;
    this.rig.group.position.copy(this.menuAnchor);
    this.rig.group.rotation.set(0, this.menuYaw + Math.sin(t * 0.15) * 0.035, -0.09 + Math.sin(t * 0.21) * 0.014);
    if (immediate) this.rig.group.updateMatrixWorld(true);
    const camAngle = this.menuCameraAngle + Math.sin(t * 0.07) * 0.11 + this.menuOrbit;
    const toCam = normAngle(camAngle - this.rig.group.rotation.y);
    const lookYaw = clamp(toCam * 2.15, -1.2, 1.2);
    this.animator.update(dt, {
      mode: 'showcase',
      speed: 0,
      pitch: 0,
      roll: 0,
      turn: 0,
      climb: 0,
      boost: 0,
      stall: 0,
      brake: 0,
      lookYaw,
    });
  }

  updateMenu(dt) {
    this.time += dt;
    this._animateMenuDragon(dt);
    // The orbiting camera gives the selection screen life even when idle.
    const angle = this.menuCameraAngle + Math.sin(this.time * 0.07) * 0.11 + this.menuOrbit;
    const distance = this.menuDistance * (1 + Math.sin(this.time * 0.16) * 0.015);
    const height = this.menuHeight + Math.sin(this.time * 0.27) * 0.38 + this.orbit.pitch * 6;
    _target.set(
      this.menuAnchor.x + Math.sin(angle) * distance,
      this.menuAnchor.y + height,
      this.menuAnchor.z + Math.cos(angle) * distance,
    );
    const camera = this.camera;
    camera.position.lerp(_target, 1 - Math.exp(-3.0 * dt));
    const ground = this.world.getHeight(camera.position.x, camera.position.z);
    if (camera.position.y < Math.max(ground, SEA_LEVEL) + 2.5) {
      camera.position.y = Math.max(ground, SEA_LEVEL) + 2.5;
    }
    this.chaseLook.lerp(_tmp.set(
      this.menuAnchor.x,
      this.menuAnchor.y + (this.rig ? this.rig.dimensions.H * 0.42 : 1.3),
      this.menuAnchor.z,
    ), 1 - Math.exp(-4.0 * dt));
    camera.up.copy(UP);
    camera.lookAt(this.chaseLook);
    camera.rotateY(0.1 + Math.sin(this.time * 0.21) * 0.012);
    camera.rotateZ(-0.012);
    camera.fov = damp(camera.fov, 46, 2.0, dt);
    camera.updateProjectionMatrix();

    if (!this.ui.transitioning) this._emitMenuAura(dt);
    this._decayOrbit(dt, true);
    this._updateShadow(this.menuAnchor);
    this.world.update(dt, this.time, this.menuAnchor, camera, 'menu', false);
    this.audio.update(dt, { mode: 'menu', speed: 0, active: false });
    this.audio.setWind(0, false, false);
  }

  _emitMenuAura(dt) {
    if (!this.rig) return;
    this.auraTimer += dt;
    if (this.auraTimer < 0.055) return;
    this.auraTimer = 0;
    const p = this.dragon.palette;
    const colors = [p.glow, p.accent, p.accent, p.membraneLight];
    const wing = this.rig.wings[Math.random() < 0.5 ? 0 : 1];
    let pos;
    if (wing?.tipMarker && Math.random() < 0.65) {
      pos = _tmp;
      wing.tipMarker.getWorldPosition(pos);
    } else {
      pos = _tmp;
      const seg = this.rig.tail[Math.floor(Math.random() * this.rig.tail.length)];
      if (seg) seg.getWorldPosition(pos);
      else pos.copy(this.menuAnchor);
      pos.y += (Math.random() - 0.3) * 1.8;
    }
    const color = colors[Math.floor(Math.random() * colors.length)];
    this.world.effects.emit(
      pos.x + (Math.random() - 0.5) * 1.4,
      pos.y + (Math.random() - 0.5) * 1.1,
      pos.z + (Math.random() - 0.5) * 1.4,
      (Math.random() - 0.5) * 1.3,
      0.45 + Math.random() * 1.1,
      (Math.random() - 0.5) * 1.3,
      color,
      0.075 + Math.random() * 0.1,
      1.6 + Math.random() * 1.8,
      0.16,
      0.9,
    );
  }

  // ── run lifecycle ──────────────────────────────────────────────────────
  async startRun() {
    if (this.mode !== 'menu' || this.ui.transitioning || this.transitioning) return;
    this.ensureAudio();
    this.audio.uiClick();
    this.transitioning = true;
    if (this.introActive) return;
    await this.ui.transition(async () => {
      this._prepareRun();
      this.ui.showHud();
      this.ui.el.hud.classList.add('is-cinematic');
      this.mode = 'flight';
      this.paused = false;
      this.world.setMode('flight');
      this.world.setGameplayVisible(true);
      this.audio.setMode('flight');
    }, '缔 结 龙 契');
    this.transitioning = false;
    this.introActive = true;
    this.controlsLocked = true;
    this.introElapsed = 0;
    this.introRoared = false;
    this.hudVisible = true;
    this.helpContext = null;
    this.ui.showIntro(this.dragon);
    this.ui.announceBiome(this.regionInfo || { name: '苍岚山脉', sub: '风蚀的群峰与云海' });
    this.animator.triggerFlap(1.2);
    this.audio.flap(1);
    this.audio.startRiser();
    this._emitWingBurst();
    this.world.effects.clear();
    this.world.effects.burst(this._centerOfDragon(_tmp), this.dragon.palette.glow, 26, 9, 0.3, 1.3);
    this.shake = Math.max(this.shake, 0.2);
  }

  _prepareRun() {
    this.runTime = 0;
    this.distance = 0;
    this.souls = 0;
    this.rings = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.lastPickup = -99;
    this.stamina = 100;
    this.flapLift = 0;
    this.speedKick = 0;
    this.stall = 0;
    this.regenDelay = 0;
    this.boostActive = false;
    this.touchInput = { x: 0, y: 0, active: false };
    this.touchFlap = false;
    this.touchBoost = false;
    this.ringBlessing = 0;
    this.auraTier = 0;
    this.controlsHintShown = 0;
    this.lastCollision = -10;
    this._roarCooldown = 0;
    this.cameraMode = 0;
    this.orbit.targetYaw = 0;
    this.orbit.targetPitch = 0;
    this.orbit.yaw = 0;
    this.orbit.pitch = 0;
    this.flapHeld = false;
    this.keys?.clear?.();
    this.ui.closePause();
    this.ui.closeHelp();
    this.ui.hideIntro();
    this.world.setGameplayVisible(true);
    this.world.resetCollectibles();
    this.world.effects.clear();
    this.playerPos.copy(this.menuAnchor);
    this.yaw = this.vistaYaw;
    this.pitch = 0.015;
    this.roll = 0;
    this.speed = 24;
    this.rig.group.position.copy(this.playerPos);
    _q.setFromEuler(_euler.set(-this.pitch, this.yaw, this.roll, 'YXZ'));
    this.rig.group.quaternion.copy(_q);
    this.rig.group.rotation.set(-this.pitch, this.yaw, this.roll, 'YXZ');
    this.rig.group.updateMatrixWorld(true);
    _forward.set(0, 0, 1).applyQuaternion(this.rig.group.quaternion);
    this.playerVelocity.copy(_forward).multiplyScalar(this.speed);
    this.chaseLook.copy(this.menuAnchor);
    this.chaseLook.y += this.rig.dimensions.H * 0.2;
    this.world.souls.pickupRadius = 7.2 * (this.dragon.flight.pickup || 1);
    this._refreshRegion(true);
    this.lastPickup = -99;
    this.ui.updateHud(this._buildHudState(), 0.016);
  }

  async backToMenu() {
    if (this.mode !== 'flight' || this.transitioning) return;
    this.transitioning = true;
    this.paused = true;
    this.ui.closePause();
    this.ui.closeHelp();
    this.audio.uiClick();
    await this.ui.transition(async () => {
      this.mode = 'menu';
      this.paused = false;
      this.introActive = false;
      this.controlsLocked = true;
      this.hudVisible = false;
      this.ui.el.hud.classList.remove('is-cinematic');
      this.ui.hideIntro();
      this.ui.showMenu();
      this.ui.closePause();
      this.ui.closeHelp();
      this.helpContext = null;
      this.playerPos.copy(this.menuAnchor);
      this.yaw = this.menuYaw;
      this.pitch = 0;
      this.roll = 0;
      this.speed = 0;
      this.playerVelocity.set(0, 0, 0);
      this.rig.group.position.copy(this.menuAnchor);
      this.rig.group.rotation.set(0, this.menuYaw, 0);
      this.rig.group.quaternion.setFromEuler(_euler.set(0, this.menuYaw, 0, 'YXZ'));
      this.world.setMode('menu');
      this.world.setGameplayVisible(false);
      this.world.resetCollectibles();
      this.world.effects.clear();
      this.audio.setMode('menu');
      this.audio.setWind(0, false, false);
      this.ui.setAsideCoord(this.menuAnchor.x, this.menuAnchor.z);
      this._placeMenuCameraImmediate();
    }, '返 回 龙 契');
    this.transitioning = false;
  }

  finishIntro() {
    if (!this.introActive) return;
    this.introActive = false;
    this.controlsLocked = false;
    this.ui.hideIntro();
    this.ui.el.hud.classList.remove('is-cinematic');
    this.ui.toast('风已起 · 循着龙魂飞向无界山海', { duration: 3000 });
  }

  pauseGame() {
    if (this.mode !== 'flight' || this.paused || this.ui.transitioning) return;
    this.paused = true;
    this.flapHeld = false;
    this.keys?.clear?.();
    this.audio.setWind(0, false, true);
    this.audio.uiClick();
    this.ui.openPause({
      dragon: this.dragon,
      region: this.regionInfo?.name || '苍茫云海',
      souls: this.souls,
      distanceKm: this.distance / 1000,
      timeSec: this.runTime,
    });
  }

  resumeGame() {
    if (this.mode !== 'flight' || !this.paused) return;
    this.paused = false;
    this.ui.closePause();
    this.audio.uiClick();
    this.audio.setMode('flight');
  }

  requestHelp(fromPause = false) {
    this.ensureAudio();
    this.ui.closePause();
    if (fromPause && this.mode === 'flight') {
      this.helpContext = 'pause';
      this.ui.openHelp();
      return;
    }
    if (this.mode === 'flight' && !this.paused) {
      this.paused = true;
      this.flapHeld = false;
      this.keys?.clear?.();
      this.helpContext = 'flight';
      this.audio.setWind(0, false, true);
      this.ui.openHelp();
      return;
    }
    if (this.mode === 'flight' && this.paused) {
      this.helpContext = 'pause';
      this.ui.openHelp();
      return;
    }
    this.helpContext = 'menu';
    this.ui.openHelp();
  }

  closeHelp() {
    this.ui.closeHelp();
    const context = this.helpContext;
    this.helpContext = null;
    if (context === 'pause') {
      this.ui.openPause({
        dragon: this.dragon,
        region: this.regionInfo?.name || '苍茫云海',
        souls: this.souls,
        distanceKm: this.distance / 1000,
        timeSec: this.runTime,
      });
    } else if (context === 'flight') {
      this.paused = false;
      this.audio.setMode('flight');
    }
  }

  // ── input ──────────────────────────────────────────────────────────────
  _bindInput() {
    this.keys = new Set();
    const down = (e) => {
      this.ensureAudio();
      if (this.helpContext && !this.ui.el.helpModal.classList.contains('is-hidden')) {
        return;
      }
      const code = e.code;
      if (code === 'Escape') {
        if (this.ui.el.pauseModal && !this.ui.el.pauseModal.classList.contains('is-hidden')) {
          this.resumeGame();
          e.preventDefault();
          return;
        }
        if (this.mode === 'flight' && !this.paused) {
          this.pauseGame();
          e.preventDefault();
          return;
        }
      }
      if (code === 'KeyM') {
        this.toggleAudio();
        e.preventDefault();
        return;
      }
      if (code === 'KeyH') {
        this.requestHelp(false);
        e.preventDefault();
        return;
      }
      if (this.mode === 'menu') {
        if (e.repeat) return;
        if (code === 'ArrowLeft' || code === 'KeyA') { this.cycleDragon(-1); e.preventDefault(); return; }
        if (code === 'ArrowRight' || code === 'KeyD') { this.cycleDragon(1); e.preventDefault(); return; }
        if (code === 'Enter' || code === 'Space') { this.startRun(); e.preventDefault(); return; }
        return;
      }
      if (this.mode === 'flight') {
        if (this.paused) {
          return;
        }
        if (code === 'KeyF') {
          this.roar();
          e.preventDefault();
          return;
        }
        if (code === 'KeyV') {
          this.toggleCameraMode();
          e.preventDefault();
          return;
        }
        if (code === 'KeyR') {
          this.resetSafe();
          e.preventDefault();
          return;
        }
        if (this.introActive && ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(code)) {
          this.finishIntro();
        }
        if (code === 'Space') {
          this.flapHeld = true;
          if (!e.repeat) this.doFlap(false);
          e.preventDefault();
          return;
        }
        if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight'].includes(code)) {
          this.keys.add(code);
          e.preventDefault();
          return;
        }
      }
    };
    const up = (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.flapHeld = false;
    };
    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    window.addEventListener('blur', () => {
      this.keys?.clear?.();
      this.flapHeld = false;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'flight' && !this.paused) this.pauseGame();
    });
    this._keyDownHandler = down;
    this._keyUpHandler = up;
  }

  _bindTouch() {
    const pad = document.getElementById('touchPad');
    const stick = document.getElementById('touchStick');
    const flap = document.getElementById('touchFlap');
    const boost = document.getElementById('touchBoost');
    if (!pad) return;
    let pointerId = null;
    const setStick = (clientX, clientY) => {
      const rect = pad.getBoundingClientRect();
      let dx = (clientX - rect.left - rect.width / 2) / (rect.width * 0.38);
      let dy = (clientY - rect.top - rect.height / 2) / (rect.height * 0.38);
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.touchInput.x = clamp(dx, -1, 1);
      this.touchInput.y = clamp(dy, -1, 1);
      this.touchInput.active = true;
      if (stick) stick.style.transform = `translate(calc(-50% + ${dx * 27}px), calc(-50% + ${dy * 27}px))`;
    };
    pad.addEventListener('pointerdown', (e) => {
      pointerId = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      setStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    pad.addEventListener('pointermove', (e) => {
      if (pointerId !== e.pointerId) return;
      setStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    const endStick = (e) => {
      if (pointerId !== e.pointerId) return;
      pointerId = null;
      this.touchInput.x = 0;
      this.touchInput.y = 0;
      this.touchInput.active = false;
      if (stick) stick.style.transform = 'translate(-50%, -50%)';
    };
    pad.addEventListener('pointerup', endStick);
    pad.addEventListener('pointercancel', endStick);
    if (flap) {
      flap.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.touchFlap = true;
        this.doFlap(false);
      });
      const end = () => { this.touchFlap = false; };
      flap.addEventListener('pointerup', end);
      flap.addEventListener('pointercancel', end);
      flap.addEventListener('pointerleave', end);
    }
    if (boost) {
      boost.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.touchBoost = true;
      });
      const end = () => { this.touchBoost = false; };
      boost.addEventListener('pointerup', end);
      boost.addEventListener('pointercancel', end);
      boost.addEventListener('pointerleave', end);
    }
  }

  _bindPointerOrbit() {
    const canvas = document.getElementById('scene');
    let active = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 2) return;
      active = true;
      lastX = e.clientX;
      lastY = e.clientY;
      this.orbit.dragging = true;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!active) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.orbit.targetYaw = clamp(this.orbit.targetYaw + dx * 0.0055, -1.9, 1.9);
      this.orbit.targetPitch = clamp(this.orbit.targetPitch + dy * 0.0035, -0.55, 0.8);
    });
    const end = (e) => {
      if (!active) return;
      active = false;
      this.orbit.dragging = false;
      if (e && e.pointerId != null) {
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  _decayOrbit(dt, menu = false) {
    if (!this.orbit.dragging) {
      const rate = menu ? 0.8 : 1.6;
      this.orbit.targetYaw = damp(this.orbit.targetYaw, 0, rate, dt);
      this.orbit.targetPitch = damp(this.orbit.targetPitch, 0, rate, dt);
    }
    this.orbit.yaw = damp(this.orbit.yaw, this.orbit.targetYaw, 4.5, dt);
    this.orbit.pitch = damp(this.orbit.pitch, this.orbit.targetPitch, 4.5, dt);
    if (menu) {
      this.menuOrbit = damp(this.menuOrbit, this.orbit.yaw * 0.6, 4.0, dt);
    }
  }

  // ── flight actions ─────────────────────────────────────────────────────
  get flight() {
    return this.dragon.flight;
  }

  doFlap(auto = false) {
    if (this.mode !== 'flight' || this.paused || this.controlsLocked) return;
    const f = this.flight;
    const cost = f.flapCost;
    if (this.stamina < cost * 0.5) {
      this.audio.warning();
      return;
    }
    if (this.time < this.nextFlapAt) return;
    this.nextFlapAt = this.time + 0.63;
    this.stamina = Math.max(0, this.stamina - cost);
    this.regenDelay = 1.2;
    this.flapLift = Math.min(4.5, this.flapLift + 2.2 * f.lift);
    this.speedKick = Math.min(3.0, this.speedKick + 1.8);
    this.speed = Math.min(f.max * 1.5, this.speed + 1.4);
    this.animator.triggerFlap(1);
    this.audio.flap(1);
    this.shake = Math.max(this.shake, auto ? 0.13 : 0.24);
    this._emitWingBurst();
  }

  roar() {
    if (this.mode !== 'flight' || this.paused || this.time < this._roarCooldown) return;
    this._roarCooldown = this.time + 3.0;
    this.animator.triggerRoar();
    this.audio.roar();
    const head = this._headPosition(_tmp);
    this.world.effects.roar(head, this.dragon.palette.glow);
    this.world.effects.burst(head, this.dragon.palette.accent, 24, 14, 0.32, 1.0);
    this.shake = Math.max(this.shake, 0.5);
    this.flash = Math.max(this.flash, 0.13);
    this.ui.flash(0.09, 320);
  }

  toggleCameraMode() {
    this.cameraMode = this.cameraMode === 0 ? 1 : 0;
    this.audio.uiClick();
    this.ui.toast(this.cameraMode === 1 ? '电影视角 · CINEMATIC' : '追随视角 · CHASE', { duration: 1500 });
  }

  resetSafe() {
    if (this.mode !== 'flight') return;
    const ground = Math.max(this.world.getHeight(this.playerPos.x, this.playerPos.z), SEA_LEVEL);
    this.playerPos.y = Math.max(this.playerPos.y + 16, ground + 74);
    this.pitch = 0.03;
    this.roll = 0;
    this.stall = 0;
    this.speed = Math.max(this.speed, 20);
    this.animator.triggerFlap(1);
    this.playerVelocity.set(0, 0, 1).applyQuaternion(this.rig.group.quaternion).multiplyScalar(this.speed);
    this.audio.flap(0.8);
    this.ui.toast('已回到安全高度', { duration: 1600 });
  }

  _headPosition(out) {
    if (this.rig?.head) this.rig.head.getWorldPosition(out);
    else out.copy(this.playerPos);
    return out;
  }

  _centerOfDragon(out) {
    out.copy(this.playerPos);
    out.y += this.rig ? this.rig.dimensions.H * 0.1 : 0.5;
    return out;
  }

  _emitWingBurst() {
    if (!this.rig) return;
    for (const w of this.rig.wings) {
      if (!w.tipMarker) continue;
      w.tipMarker.getWorldPosition(_tmp);
      this.world.effects.trailBurst(_tmp, this.dragon.palette.glow, w.side);
    }
  }

  // ── flight step ────────────────────────────────────────────────────────
  updateFlight(dt) {
    this.time += dt;
    if (this.paused) {
      this.audio.setWind(0, false, false);
      return;
    }
    const f = this.flight;
    this.runTime += dt;

    if (this.introActive) {
      this.introElapsed += dt;
      if (!this.introRoared && this.introElapsed > 0.55) {
        this.introRoared = true;
        this.animator.triggerRoar();
        this.audio.roar();
        this.world.effects.roar(this._headPosition(_tmp), this.dragon.palette.glow);
        this.shake = Math.max(this.shake, 0.42);
        this.ui.flash(0.1, 420);
      }
      if (this.introElapsed > 2.95) this.finishIntro();
    }

    // ── read input ───────────────────────────────────────────────────────
    const locked = this.controlsLocked || this.introActive;
    let pitchIn = 0;
    let turnIn = 0;
    if (!locked) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) pitchIn += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) pitchIn -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) turnIn += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) turnIn -= 1;
      turnIn += this.touchInput.x;
      pitchIn += -this.touchInput.y;
      pitchIn = clamp(pitchIn, -1, 1);
      turnIn = clamp(turnIn, -1, 1);
    }

    this.pitchAxis = damp(this.pitchAxis, pitchIn, pitchIn === 0 ? 3.6 : 5.0, dt);
    this.turnAxis = damp(this.turnAxis, turnIn, 4.8, dt);

    const speedNorm = clamp(this.speed / f.cruise, 0, 1.5);
    this.stall = damp(this.stall, clamp(1 - this.speed / 16.5, 0, 1), 2.4, dt);

    this.stamina = clamp(this.stamina, 0, 100);
    const shiftHeld = !locked && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchBoost);
    const brakeHeld = !locked && (this.keys.has('ControlLeft') || this.keys.has('ControlRight'));
    this.brake = damp(this.brake, brakeHeld ? 1 : 0, 5, dt);
    const canBoost = shiftHeld && this.stamina > 0.8 && !this.introActive;
    const wasBoosting = this.boostActive;
    this.boostActive = canBoost && this.stamina > 0.3;
    if (this.boostActive) {
      this.stamina = Math.max(0, this.stamina - 21 * dt * (0.9 + 0.1 * f.boost));
      this.regenDelay = 1.0;
    } else if (this.stamina <= 0.3 && shiftHeld) {
      this.stamina = 0;
    }
    if (this.boostActive && !wasBoosting) {
      this.shake = Math.max(this.shake, 0.2);
      this.audio.flap(0.65);
      this.ui.toast('疾风 · 起飞', { duration: 1300 });
    }

    // auto wing beats while SPACE is held
    if (!locked && (this.flapHeld || this.touchFlap) && this.time >= this.nextFlapAt) {
      this.doFlap(this.flapHeld && !this.touchFlap);
    }

    // stamina recovery after the wing rests
    if (this.regenDelay > 0) {
      this.regenDelay -= dt;
    } else if (!this.boostActive) {
      const overWater = this.world.getHeight(this.playerPos.x, this.playerPos.z) < SEA_LEVEL;
      const waterBonus = overWater ? 1.4 * (f.water || 1) : 1;
      const blessingBonus = this.ringBlessing > 0 ? 1.7 : 1;
      this.stamina = Math.min(100, this.stamina + f.regen * waterBonus * blessingBonus * dt);
    }
    if (this.ringBlessing > 0) this.ringBlessing = Math.max(0, this.ringBlessing - dt);

    // ── attitude ─────────────────────────────────────────────────────────
    const turnControl = (1 - this.stall * 0.55) * (0.3 + 0.7 * clamp(this.speed / 26, 0.2, 1.3));
    this.yaw += this.turnAxis * f.turn * turnControl * dt;
    this.pitch += this.pitchAxis * (0.76 - this.stall * 0.28) * dt;
    if (Math.abs(this.pitchAxis) < 0.035) {
      this.pitch = damp(this.pitch, 0.018, 0.75, dt);
    }
    if (this.stall > 0.16) {
      this.pitch = damp(this.pitch, -0.36, 1.0 + this.stall * 1.6, dt);
    }
    this.pitch = clamp(this.pitch, -1.02, 0.92);
    const targetRoll = -this.turnAxis * (0.48 + 0.16 * clamp(speedNorm, 0, 1)) + this.pitchAxis * -0.015;
    this.roll = damp(this.roll, targetRoll, 3.8, dt);
    if (Math.abs(this.turnAxis) < 0.02) this.roll = damp(this.roll, 0, 2.0, dt);

    this.rig.group.position.copy(this.playerPos);
    _q.setFromEuler(_euler.set(-this.pitch, this.yaw, this.roll, 'YXZ'));
    this.rig.group.quaternion.copy(_q);
    this.rig.group.rotation.set(-this.pitch, this.yaw, this.roll, 'YXZ');
    this.rig.group.updateMatrixWorld(true);
    _forward.set(0, 0, 1).applyQuaternion(this.rig.group.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.rig.group.quaternion);
    _right.crossVectors(_forward, _up).normalize();

    // ── speed / thrust / drag ────────────────────────────────────────────
    const dive = -_forward.y;
    const climb = _forward.y;
    const baseThrust = 5.25 * (f.cruise / 33);
    const boostThrust = this.boostActive ? 11.5 * (f.boost || 1) : 0;
    const brakeDrag = this.brake * 4.2;
    const turnDrag = Math.abs(this.turnAxis) * 0.42 + Math.abs(this.roll) * 0.18;
    const drag = 0.00365 * this.speed * this.speed + 0.016 * this.speed + brakeDrag + turnDrag;
    let accel = baseThrust + boostThrust - drag + dive * 7.6 * (f.dive || 1) - Math.max(0, climb) * 0.7;
    if (this.ringBlessing > 0) accel += 1.9;
    if (this.speed < 7) accel += (7 - this.speed) * 1.5;
    this.speedKick = damp(this.speedKick, 0, 3.2, dt);
    accel += this.speedKick * 4.0;
    this.speed = clamp(this.speed + accel * dt, 2, f.max * 1.46);
    if (this.stall > 0.25) this.speed = Math.min(this.speed, f.max);
    if (this.brake) this.speed = Math.min(this.speed, f.cruise * 1.5);

    // ── vertical motion: lift, bank, flap, wind ──────────────────────────
    const liftQuality = clamp(this.speed / 18, 0, 1.25);
    const bankLoss = Math.abs(Math.sin(this.roll)) * (1.1 + this.speed * 0.045);
    const windLift = Math.sin(this.time * 0.36 + this.playerPos.x * 0.006) * 0.16;
    let sink = (0.64 + (1 - Math.min(1, liftQuality)) * 8.5) / Math.max(0.75, f.lift);
    sink += bankLoss + this.stall * 11.0;
    sink -= this.flapLift;
    sink -= this.ringBlessing > 0 ? 0.55 : 0;
    sink += windLift;
    this.flapLift = damp(this.flapLift, 0, 2.8, dt);

    // If the player pulls up too hard at low speed, lose the nose.
    if (this.speed < 10 && this.pitch > 0.3) this.pitch = damp(this.pitch, 0.3, 3.0, dt);

    _target.copy(_forward).multiplyScalar(this.speed);
    _target.y -= Math.max(0, sink);
    // A tiny amount of lateral inertia makes hard banked turns feel weighty.
    _target.x += Math.sin(this.time * 0.4) * 0.05;
    _target.z += Math.cos(this.time * 0.31) * 0.04;
    const align = 1 - Math.exp(-(this.stall > 0.3 ? 2.0 : 3.25) * dt);
    this.playerVelocity.lerp(_target, align);

    this.distance += this.playerVelocity.length() * dt;
    this.playerPos.addScaledVector(this.playerVelocity, dt);

    // terrain / water collision
    this._resolveCollision(dt);
    this.rig.group.position.copy(this.playerPos);
    this.rig.group.updateMatrixWorld(true);

    // water skim check and visual flag
    const groundNow = this.world.getHeight(this.playerPos.x, this.playerPos.z);
    const waterLine = Math.max(groundNow, SEA_LEVEL);
    this.distanceToGround = this.playerPos.y - waterLine;
    this.groundY = waterLine;
    this.skimmish = groundNow < SEA_LEVEL && this.distanceToGround < 15 && this.speed > 24;
    if (this.skimmish) {
      this.speed = Math.min(f.max * 1.5, this.speed + 1.4 * dt * (f.water || 1));
      this.stamina = Math.min(100, this.stamina + 2.2 * dt);
      if (Math.random() < dt * 8) this._emitWaterSpray();
    }

    // combo timer decays
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 1;
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * (this.shake > 0.5 ? 3.5 : 2.2));

    // animate and move the camera
    const state = {
      mode: 'flight',
      speed: this.speed,
      pitch: this.pitch,
      roll: this.roll,
      turn: this.turnAxis,
      climb: clamp(this.playerVelocity.y / 16, -1, 1),
      boost: this.boostActive ? 1 : 0,
      stall: this.stall,
      brake: this.brake,
      lookYaw: 0,
    };
    this.animator.update(dt, state);
    this.rig.group.position.copy(this.playerPos);
    this.rig.group.updateMatrixWorld(true);

    // world & pickups
    const events = this.world.update(dt, this.time, this.playerPos, this.camera, 'flight', true);
    if (events?.soulHit) this._onSoulPicked(events.soulHit.orb);
    if (events?.ringHit) this._onRingPassed(events.ringHit.ring);
    this._updateShadow(this.playerPos);
    this._updateFlightCamera(dt);
    this._emitFlightTrails(dt);
    this._updateRegion(dt);
    this._updateHud(dt);

    this.audio.update(dt, { mode: 'flight', speed: this.speed, active: true });
    this.audio.setWind(this.speed, this.boostActive, true);
  }

  _resolveCollision(dt) {
    const clearance = 3.1 + (this.rig?.dimensions?.H || 1.2) * 0.8;
    const ground = Math.max(this.world.getHeight(this.playerPos.x, this.playerPos.z), SEA_LEVEL);
    this.groundY = ground;
    if (this.playerPos.y < ground + clearance) {
      const impact = clamp((ground + clearance - this.playerPos.y) * 0.36 + Math.max(0, -this.playerVelocity.y) * 0.06, 0, 1.4);
      this.playerPos.y = ground + clearance;
      if (this.playerVelocity.y < 1.0) this.playerVelocity.y = Math.max(1.6, -this.playerVelocity.y * 0.08);
      this.speed *= Math.max(0.52, 1 - impact * 0.25);
      this.pitch = Math.max(this.pitch, 0.06);
      this.stall = Math.max(this.stall, 0.08);
      this.shake = Math.max(this.shake, 0.25 + impact * 0.45);
      if (this.time - this.lastCollision > 0.45) {
        this.lastCollision = this.time;
        this.audio.groundHit(Math.min(1, impact + 0.25));
        const water = ground < SEA_LEVEL + 0.4;
        const color = water ? '#8fe7dc' : (this.dragon.palette?.belly || '#d7c7a0');
        _tmp.copy(this.playerPos);
        _tmp.y = ground + 0.3;
        this.world.effects.burst(_tmp, color, water ? 22 : 16, water ? 8 : 5, 0.32, 0.9);
        if (impact > 0.65) this.ui.flash(0.045, 120);
      }
      this.playerVelocity.y = Math.max(this.playerVelocity.y, 1.2);
    }
  }

  _emitWaterSpray() {
    const p = this.dragon.palette;
    for (let i = 0; i < 3; i++) {
      this.world.effects.emit(
        this.playerPos.x + (Math.random() - 0.5) * 6,
        SEA_LEVEL + 0.2,
        this.playerPos.z + (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 4,
        1.2 + Math.random() * 3.5,
        (Math.random() - 0.5) * 4,
        i === 0 ? p.accent2 : '#d9f7ee',
        0.2 + Math.random() * 0.18,
        0.7 + Math.random() * 0.5,
        -5.5,
        0.8,
      );
    }
  }

  _onSoulPicked(orb) {
    const now = this.time;
    if (now - this.lastPickup < 12) {
      this.combo = Math.min(4.0, this.combo + 0.25);
    } else {
      this.combo = 1;
    }
    this.lastPickup = now;
    this.comboTimer = 12;
    this.souls += 1;
    this.stamina = Math.min(100, this.stamina + 8);
    this.speed = Math.min(this.flight.max * 1.5, this.speed + 1.2);
    this.audio.collect(this.combo);
    this.ui.flash(0.08, 220);
    _tmp.set(orb.x, orb.y, orb.z);
    this.world.effects.burst(_tmp, '#ffe2a0', 24, 11, 0.28, 1.2);
    this.ui.toast(`龙魂 +1${this.combo > 1 ? `  ·  连续 ×${this.combo.toFixed(1)}` : ''}`, { duration: 2200 });
    this.shake = Math.max(this.shake, 0.1);
    if (this.souls % 9 === 0) {
      this.auraTier += 1;
      this.ui.flash(0.2, 480);
      this.animator.triggerRoar();
      this.audio.roar();
      this.world.effects.roar(this._headPosition(_tmp), this.dragon.palette.glow);
      this.ui.toast('九曜共鸣 · 龙威加身', { duration: 3600, strong: true });
      this.stamina = 100;
      this.ringBlessing = Math.max(this.ringBlessing, 5);
    }
  }

  _onRingPassed(ring) {
    this.rings += 1;
    this.ringBlessing = Math.max(this.ringBlessing, 7.0 * (this.flight.ring || 1));
    this.stamina = Math.min(100, this.stamina + 38);
    this.speed = Math.min(this.flight.max * 1.5, this.speed + 4.2);
    this.audio.ring();
    _tmp.set(ring.x, ring.y, ring.z);
    this.world.effects.burst(_tmp, '#8ff5dd', 20, 9, 0.25, 1.0);
    this.ui.toast('风环祝福 · 耐力恢复 / 速度提升', { duration: 2500 });
    this.shake = Math.max(this.shake, 0.13);
  }

  _emitFlightTrails(dt) {
    if (!this.rig) return;
    this.trailTimer += dt;
    const speed = this.speed;
    if (speed < 9) return;
    const interval = this.boostActive ? 0.025 : 0.055;
    if (this.trailTimer < interval) return;
    this.trailTimer = 0;
    const p = this.dragon.palette;
    const color = this.boostActive ? p.accent : p.glow;
    for (const w of this.rig.wings) {
      if (!w.tipMarker) continue;
      w.tipMarker.getWorldPosition(_tmp);
      this.world.effects.wingTrail(_tmp, Math.random() < 0.16 ? p.accent2 : color, speed, w.side);
    }
    if (Math.random() < 0.35) {
      const tailSeg = this.rig.tail[Math.floor(this.rig.tail.length * 0.7)];
      if (tailSeg) {
        tailSeg.getWorldPosition(_tmp);
        this.world.effects.emit(_tmp.x, _tmp.y, _tmp.z, (Math.random() - 0.5) * 1.5, 0.2, (Math.random() - 0.5) * 1.5, p.glow, 0.09, 1.0, 0.2, 1.1);
      }
    }
    if (this.boostActive && Math.random() < 0.4) {
      this.world.effects.emit(
        this.playerPos.x + (Math.random() - 0.5) * 4,
        this.playerPos.y + (Math.random() - 0.5) * 2,
        this.playerPos.z + (Math.random() - 0.5) * 4,
        -this.playerVelocity.x * 0.12,
        -this.playerVelocity.y * 0.12 + 0.5,
        -this.playerVelocity.z * 0.12,
        p.accent,
        0.12, 0.75, 0.3, 1.2,
      );
    }
  }

  _updateFlightCamera(dt) {
    const rig = this.rig;
    const speedNorm = clamp(this.speed / this.flight.max, 0, 1.2);
    const cinematic = this.cameraMode === 1;
    const dist = rig.cameraDistance * (cinematic ? 1.52 : 1.0) * (1 + speedNorm * 0.1) +
      (this.boostActive ? 1.3 : 0);
    const height = rig.cameraHeight * (cinematic ? 1.25 : 1.0) + 1.4 + speedNorm * 0.9 + this.orbit.pitch * 5;
    const orbitYaw = this.orbit.yaw + (cinematic ? 0.25 : 0);
    const behindAngle = Math.atan2(-_forward.x, -_forward.z) + orbitYaw;
    _target.set(
      this.playerPos.x + Math.sin(behindAngle) * dist,
      this.playerPos.y + height,
      this.playerPos.z + Math.cos(behindAngle) * dist,
    );

    // Don't let the camera push through a mountainside when skimming.
    const groundAtCam = Math.max(this.world.getHeight(_target.x, _target.z), SEA_LEVEL);
    if (_target.y < groundAtCam + 2.4) _target.y = groundAtCam + 2.4;
    const rayGround = Math.max(this.world.getHeight(
      lerp(this.playerPos.x, _target.x, 0.55),
      lerp(this.playerPos.z, _target.z, 0.55),
    ), SEA_LEVEL);
    if (_target.y < rayGround + 3.0) _target.y = rayGround + 3.0;

    const desiredFov = (cinematic ? 44 : 48) + speedNorm * 7 + (this.boostActive ? 3.5 : 0) + (this.introActive ? 2 : 0);
    this.camera.fov = damp(this.camera.fov, desiredFov, 2.0, dt);
    this.camera.updateProjectionMatrix();

    const lerpPos = 1 - Math.exp(-(this.introActive ? 3.2 : 4.2) * dt);
    this.camera.position.lerp(_target, lerpPos);
    const camGround = Math.max(this.world.getHeight(this.camera.position.x, this.camera.position.z), SEA_LEVEL);
    if (this.camera.position.y < camGround + 2.0) this.camera.position.y = camGround + 2.0;

    const lookAhead = (cinematic ? 7.5 : 10.5) + this.speed * 0.12;
    _tmp.copy(_forward).multiplyScalar(lookAhead);
    _tmp2.set(0, 1.35, 0);
    _tmp.add(_tmp2).add(this.playerPos);
    // during a free-look drag, keep the dragon more centered in frame
    const freeLook = Math.min(1, Math.abs(this.orbit.yaw) * 1.4);
    _tmp.lerp(this.playerPos, freeLook * 0.4);
    this.chaseLook.lerp(_tmp, 1 - Math.exp(-6.5 * dt));
    this.camera.up.copy(UP);
    this.camera.lookAt(this.chaseLook);
    this.camera.rotateZ(this.roll * 0.18 + Math.sin(this.time * 0.6) * 0.003);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.65;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.camera.rotateZ((Math.random() - 0.5) * this.shake * 0.02);
    }
    this._decayOrbit(dt, false);
  }

  // ── world / HUD state ─────────────────────────────────────────────────
  _updateRegion(dt) {
    this._refreshRegion(false);
    const id = this.regionInfo?.id;
    if (this.regionCandidate?.id !== id) {
      this.regionCandidate = this.regionInfo;
      this.regionHold = 0;
    } else {
      this.regionHold += dt;
      if (this.regionHold > 1.5 && this.regionInfo.id !== this.lastAnnounced && this.time - this.lastAnnounce > 8) {
        this.lastAnnounced = this.regionInfo.id;
        this.lastAnnounce = this.time;
        this.ui.announceBiome(this.regionInfo);
      }
    }
  }

  _refreshRegion(force = false) {
    if (!force && this.time - this._regionCheck < 0.38) return;
    this._regionCheck = this.time;
    this.regionInfo = regionAt(this.playerPos.x, this.playerPos.z);
    if (force) this.lastAnnounced = this.regionInfo.id;
  }

  _updateHud(dt) {
    const state = this._buildHudState();
    this.ui.updateHud(state, dt);
  }

  _buildHudState() {
    const nearest = this.world.souls.nearest;
    const target = this._computeTargetMarker(nearest);
    const f = this.flight;
    const speed = this.speed;
    const lift = clamp(Math.pow(clamp(speed / 18, 0, 1.25), 2) * f.lift * (1 - this.stall) * 100, 0, 100);
    let warning = null;
    if (this.mode === 'flight' && !this.introActive) {
      if (this.stall > 0.23) warning = '失速警告 · 按 SPACE 振翅';
      else if (this.distanceToGround < 7 && this.playerVelocity.y < -1.5) warning = '地形接近 · 拉升';
      else if (this.stamina < 7) warning = '耐力耗尽 · 松开 SHIFT';
    }
    return {
      speed,
      maxSpeed: f.max,
      altitude: this.playerPos.y - SEA_LEVEL,
      lift,
      stamina: this.stamina,
      boostActive: this.boostActive,
      boosting: this.boostActive,
      ringBlessing: this.ringBlessing,
      wind: 0.4 + Math.sin(this.time * 0.21) * 0.18,
      headingDeg: normDeg(this.yaw),
      region: this.regionInfo || { name: '苍岚山脉' },
      souls: this.souls,
      rings: this.rings,
      distanceKm: this.distance / 1000,
      timeSec: this.runTime,
      worldTime: this.world.time,
      combo: this.combo,
      nearestSoulDist: nearest ? this.world.souls.nearestDist : null,
      warning,
      target,
      position: this.playerPos,
      minimap: {
        orbs: this.world.souls.orbs,
        rings: this.world.rings.rings,
      },
      controlsHintDim: this.runTime > 20,
      ringMode: this.cameraMode,
    };
  }

  _computeTargetMarker(nearest) {
    if (!nearest || this.mode !== 'flight' || this.paused) return { visible: false };
    this.camera.updateMatrixWorld();
    _tmp.set(nearest.x, nearest.y, nearest.z);
    const dist = _tmp.distanceTo(this.playerPos);
    const cameraSpace = _tmp2.copy(_tmp).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = cameraSpace.z > 0;
    _tmp.project(this.camera);
    let x = (_tmp.x * 0.5 + 0.5) * window.innerWidth;
    let y = (-_tmp.y * 0.5 + 0.5) * window.innerHeight;
    let offscreen = behind || _tmp.x < -0.92 || _tmp.x > 0.92 || _tmp.y < -0.9 || _tmp.y > 0.9;
    if (behind) {
      const len = Math.hypot(cameraSpace.x, cameraSpace.y) || 1;
      x = window.innerWidth * (0.5 - clamp(cameraSpace.x / len, -1, 1) * 0.4);
      y = window.innerHeight * (0.5 + clamp(cameraSpace.y / len, -1, 1) * 0.34);
    }
    const margin = 96;
    x = clamp(x, margin, window.innerWidth - margin);
    y = clamp(y, margin + 46, window.innerHeight - 196);
    return {
      visible: this.hudVisible,
      x,
      y,
      distance: dist,
      offscreen,
      near: dist < 80,
    };
  }

  // getters used by the render pipeline
  get postEffects() {
    const speedNorm = clamp(this.speed / Math.max(1, this.flight?.max || 48), 0, 1.3);
    return {
      speed: this.mode === 'flight' ? Math.max(0, speedNorm - 0.25) + (this.boostActive ? 0.3 : 0) : 0,
      flash: this.flash,
      warmth: 1,
    };
  }

  get currentRegionName() {
    return this.regionInfo?.name || '苍茫云海';
  }

  debugState() {
    return {
      mode: this.mode,
      paused: this.paused,
      introActive: this.introActive,
      controlsLocked: this.controlsLocked,
      selected: this.dragon?.id,
      position: this.playerPos ? { x: this.playerPos.x, y: this.playerPos.y, z: this.playerPos.z } : null,
      speed: this.speed,
      stamina: this.stamina,
      souls: this.souls,
      rings: this.rings,
      region: this.regionInfo?.id,
      yaw: this.yaw,
      pitch: this.pitch,
      roll: this.roll,
      cameraMode: this.cameraMode,
      hudVisible: this.hudVisible,
      chunks: this.world?.chunks?.size,
    };
  }

  // Called from the render loop after Game.update; keeps post FX in sync.
  updateCommon(dt) {
    this.flash = Math.max(0, this.flash - dt * 2.6);
  }

  update(dt) {
    if (this.mode === 'menu') {
      this.updateMenu(dt);
    } else if (this.mode === 'flight') {
      this.updateFlight(dt);
    }
    this.updateCommon(dt);
  }
}
