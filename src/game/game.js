import * as THREE from 'three';
import { buildDragon } from '../dragon/model.js';
import { DragonAnimator } from '../dragon/animation.js';
import { clamp, damp, lerp, smootherstep, smoothstep } from '../core/noise.js';
import { SEA_LEVEL, regionAt } from '../core/terrain.js';
import { getShadowTexture } from '../core/textures.js';
import { AbilitySystem } from './abilities.js';
import { heightAt } from '../core/terrain.js';

const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _v = new THREE.Vector3();
const _target = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
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
  constructor({ scene, camera, world, ui, audio, catalog, renderer }) {
    this.scene = scene;
    this.renderer = renderer;
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
    this.maxStamina = 100;
    this.satiety = 100;
    this.bodyTemp = 36.6;
    this.ambientTemp = 20;
    this.preyCaught = 0;
    this.flightState = 'flying';
    this.underwater = false;
    this.autoFlapLift = 0;
    this.abilityCooldown = 0;
    this.abilityName = '';
    this.abilityElement = null;
    this.feedCooldown = 0;
    this.landT = 0;
    this.landData = null;
    this.surfaceInfo = { water: false, ground: SEA_LEVEL, y: SEA_LEVEL };
    this.restLabel = '';
    this.recoveryHint = '';
    this.promptLand = null;
    this.promptFeed = null;
    this.feedTargets = null;
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
    this.camZoom = 1;
    this.freeCam = { yaw: Math.PI * 0.2, pitch: 0.35, distance: 1.0 };
    this.menuView = { yaw: 0, pitch: 0, zoom: 1, tYaw: 0, tPitch: 0, tZoom: 1 };
    this.mouseSteer = { active: false, x: 0, y: 0, startX: 0, startY: 0 };
    this.lookDrag = { active: false, yaw: 0, pitch: 0 };
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
      onAbility: () => this.castAbility(),
    });

    this._bindInput();
    this._bindTouch();
    this._bindPointerOrbit();
    this._bindPointerSteering();
    this._bindMenuView();

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
    this.wildlife = this.world.wildlife;
    this.environment = this.world.environment;
    this.abilities = new AbilitySystem({
      scene: this.scene, world: this.world, effects: this.world.effects,
      wildlife: this.world.wildlife, audio: this.audio,
    });
    this.environment.onLightning = () => this._onLightning();
    this.world.setGameplayVisible(false);
    this.ui.setSoundEnabled(this.soundEnabled);

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
    const visualLength = this.rig.visualLength || (this.rig.dimensions.L + this.rig.dimensions.L * 1.4);
    this.menuDistance = Math.max(this.rig.cameraDistance * 1.03 + 4.6, visualLength * 0.92 + 5);
    this.menuHeight = this.rig.dimensions.H * 1.8 + 5.4;
    this.maxStamina = Math.round(72 + (this.dragon.stats?.endurance || 80) * 0.38);
    this.stamina = this.maxStamina;
    this.abilityName = this.dragon.ability?.name || '龙赋';
    this.menuView.yaw = 0;
    this.menuView.pitch = 0;
    this.menuView.zoom = 1;
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
      this.menuView.tYaw = 0;
      this.menuView.tPitch = 0;
      this.menuView.tZoom = 1;
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
    const camAngle = this.menuCameraAngle + Math.sin(t * 0.07) * 0.08 + this.menuView.yaw;
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
    const view = this.menuView;
    view.yaw = damp(view.yaw, view.tYaw, 6.5, dt);
    view.pitch = damp(view.pitch, view.tPitch, 6.5, dt);
    view.zoom = damp(view.zoom, view.tZoom, 4.0, dt);
    // The selection camera is fully interactive: drag to orbit, wheel to zoom.
    const angle = this.menuCameraAngle + Math.sin(this.time * 0.07) * 0.06 + view.yaw;
    const distance = this.menuDistance * view.zoom * (1 + Math.sin(this.time * 0.16) * 0.012);
    const height = this.menuHeight + view.pitch * 13 + Math.sin(this.time * 0.27) * 0.3;
    _target.set(
      this.menuAnchor.x + Math.sin(angle) * distance,
      this.menuAnchor.y + height,
      this.menuAnchor.z + Math.cos(angle) * distance,
    );
    const camera = this.camera;
    camera.position.lerp(_target, 1 - Math.exp(-3.2 * dt));
    const ground = this.world.getHeight(camera.position.x, camera.position.z);
    if (camera.position.y < Math.max(ground, SEA_LEVEL) + 2.5) {
      camera.position.y = Math.max(ground, SEA_LEVEL) + 2.5;
    }
    const focusY = this.menuAnchor.y + (this.rig ? this.rig.dimensions.H * 0.42 : 1.3);
    this.chaseLook.lerp(_tmp.set(this.menuAnchor.x, focusY, this.menuAnchor.z), 1 - Math.exp(-4.0 * dt));
    camera.up.copy(UP);
    camera.lookAt(this.chaseLook);
    camera.rotateY(0.08 + Math.sin(this.time * 0.21) * 0.008);
    camera.rotateZ(-0.012);
    camera.fov = damp(camera.fov, 46, 2.0, dt);
    camera.updateProjectionMatrix();

    if (!this.ui.transitioning) this._emitMenuAura(dt);
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
      this.world.environment.setUnderwater(false);
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
    this.preyCaught = 0;
    this.lastPickup = -99;
    this.maxStamina = Math.round(72 + (this.dragon.stats?.endurance || 80) * 0.38);
    this.stamina = this.maxStamina;
    this.satiety = 100;
    this.bodyTemp = 36.6;
    this.ambientTemp = this.world.environment?.temperature ?? 20;
    this.preyCaught = 0;
    this.abilityCooldown = 0;
    this.feedCooldown = 0;
    this.flightState = 'flying';
    this.underwater = false;
    this.landData = null;
    this.feedTargets = [];
    this.autoFlapLift = 0;
    this.flapLift = 0;
    this.speedKick = 0;
    this.stall = 0;
    this.regenDelay = 0;
    this.boostActive = false;
    this.touchInput = { x: 0, y: 0, active: false };
    this.touchFlap = false;
    this.touchBoost = false;
    this.mouseSteer = { active: false, x: 0, y: 0, startX: 0, startY: 0 };
    this.lookDrag = { active: false, yaw: 0, pitch: 0 };
    this.controlsHintShown = 0;
    this.lastCollision = -10;
    this._roarCooldown = 0;
    this.cameraMode = 0;
    this.camZoom = 1;
    this.freeCam = { yaw: Math.PI * 0.2, pitch: 0.35, distance: 1.0 };
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
    this.world.environment.setUnderwater(false);
    this.abilities.clear();
    this.wildlife.reset(this.menuAnchor);
    this.wildlife.setVisible(true);
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
    this.animator.onFlapDown = () => {
      this.autoFlapLift = Math.min(1.5, this.autoFlapLift + 0.28);
    };
    this.world.effects.clear();
    this._refreshRegion(true);
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
      this.world.environment.setUnderwater(false);
      this.abilities.clear();
      this.wildlife.setVisible(false);
      this.underwater = false;
      this.flightState = 'flying';
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
    this.ui.toast('风已起 · 猎食、栖落，或继续飞向无界山海', { duration: 3200 });
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
      preyCaught: this.preyCaught,
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
        preyCaught: this.preyCaught,
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
          this.castAbility();
          e.preventDefault();
          return;
        }
        if (code === 'KeyQ') {
          this.tryFeed();
          e.preventDefault();
          return;
        }
        if (code === 'KeyE') {
          this.toggleLand();
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
          if (this.flightState === 'grounded' || this.flightState === 'floating' || this.flightState === 'swimming') {
            this.toggleLand();
          } else {
            this.flapHeld = true;
            if (!e.repeat) this.doFlap(false);
          }
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
    const land = document.getElementById('touchLand');
    const ability = document.getElementById('touchAbility');
    const feed = document.getElementById('touchFeed');
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
    if (land) {
      land.addEventListener('pointerdown', (e) => { e.preventDefault(); this.toggleLand(); });
    }
    if (ability) {
      ability.addEventListener('pointerdown', (e) => { e.preventDefault(); this.castAbility(); });
    }
    if (feed) {
      feed.addEventListener('pointerdown', (e) => { e.preventDefault(); this.tryFeed(); });
    }
  }

  _pointerOverUI(e) {
    const el = e.target;
    if (!el || !el.closest) return false;
    return !!el.closest('button, a, input, select, textarea, .modal-panel, .pause-panel, .help-panel, .dragon-chip, .dragon-list, .touch-pad, .touch-buttons, .menu-tools, .menu-actions, .carousel');
  }

  _bindPointerOrbit() {
    window.addEventListener('contextmenu', (e) => {
      if (e.target?.id === 'scene' || e.target?.closest?.('#stage')) e.preventDefault();
    });
    let active = false;
    let lastX = 0;
    let lastY = 0;
    const down = (e) => {
      if (e.button !== 2 || this._pointerOverUI(e)) return;
      if (this.mode === 'menu' && !this.ui.transitioning) {
        active = true;
        lastX = e.clientX;
        lastY = e.clientY;
        this.menuView.dragging = true;
        e.preventDefault();
      } else if (this.mode === 'flight' && !this.paused) {
        active = true;
        lastX = e.clientX;
        lastY = e.clientY;
        this.orbit.dragging = true;
        e.preventDefault();
      }
    };
    const move = (e) => {
      if (!active) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (this.mode === 'menu') {
        this.menuView.tYaw = clamp(this.menuView.tYaw - dx * 0.0065, -Math.PI * 2.5, Math.PI * 2.5);
        this.menuView.tPitch = clamp(this.menuView.tPitch + dy * 0.0042, -0.4, 0.62);
      } else if (this.cameraMode === 2) {
        this.freeCam.yaw -= dx * 0.006;
        this.freeCam.pitch = clamp(this.freeCam.pitch + dy * 0.004, -0.55, 1.25);
      } else {
        this.orbit.targetYaw = clamp(this.orbit.targetYaw + dx * 0.0055, -2.4, 2.4);
        this.orbit.targetPitch = clamp(this.orbit.targetPitch + dy * 0.0035, -0.55, 0.8);
      }
    };
    const end = () => {
      if (!active) return;
      active = false;
      this.orbit.dragging = false;
      this.menuView.dragging = false;
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  _bindPointerSteering() {
    let active = false;
    let freeLook = false;
    let pointerId = null;
    let lastX = 0;
    let lastY = 0;
    const down = (e) => {
      if (e.button !== 0 || e.pointerType === 'touch' && this._pointerOverUI(e)) return;
      if (this._pointerOverUI(e)) return;
      if (this.mode === 'menu') {
        if (this.ui.transitioning) return;
        active = true;
        pointerId = e.pointerId;
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      if (this.mode !== 'flight' || this.paused) return;
      active = true;
      pointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      if (this.cameraMode === 2) {
        freeLook = true;
        this._cancelMouseSteer();
      } else {
        this.mouseSteer.active = true;
        this.mouseSteer.startX = e.clientX;
        this.mouseSteer.startY = e.clientY;
        this.mouseSteer.x = 0;
        this.mouseSteer.y = 0;
      }
    };
    const move = (e) => {
      if (!active || (pointerId != null && e.pointerId !== pointerId)) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (this.mode === 'menu') {
        this.menuView.tYaw = clamp(this.menuView.tYaw - dx * 0.0065, -Math.PI * 2.5, Math.PI * 2.5);
        this.menuView.tPitch = clamp(this.menuView.tPitch + dy * 0.0042, -0.4, 0.62);
      } else if (this.mode === 'flight') {
        if (freeLook) {
          this.freeCam.yaw -= dx * 0.006;
          this.freeCam.pitch = clamp(this.freeCam.pitch + dy * 0.004, -0.55, 1.25);
        } else {
          const spanX = Math.max(80, window.innerWidth * 0.12);
          const spanY = Math.max(70, window.innerHeight * 0.14);
          this.mouseSteer.x = clamp((e.clientX - this.mouseSteer.startX) / spanX, -1, 1);
          this.mouseSteer.y = clamp(-(e.clientY - this.mouseSteer.startY) / spanY, -1, 1);
        }
      }
    };
    const end = () => {
      active = false;
      freeLook = false;
      pointerId = null;
      this._cancelMouseSteer();
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
  }

  _bindMenuView() {
    window.addEventListener('wheel', (e) => {
      if (this._pointerOverUI(e)) return;
      if (this.mode === 'menu') {
        this.menuView.tZoom = clamp(this.menuView.tZoom + e.deltaY * 0.001, 0.62, 1.5);
        e.preventDefault();
      } else if (this.mode === 'flight' && !this.paused) {
        this.camZoom = clamp(this.camZoom + e.deltaY * 0.001, 0.62, 1.8);
        if (this.cameraMode === 2) this.freeCam.distance = this.camZoom;
        e.preventDefault();
      }
    }, { passive: false });
    const reset = (e) => {
      if (this._pointerOverUI(e)) return;
      if (this.mode === 'menu') {
        this.menuView.tYaw = 0;
        this.menuView.tPitch = 0;
        this.menuView.tZoom = 1;
      } else if (this.mode === 'flight') {
        this.orbit.targetYaw = 0;
        this.orbit.targetPitch = 0;
        this.camZoom = 1;
        this.freeCam.distance = 1;
      }
    };
    document.addEventListener('dblclick', reset);
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
    this.cameraMode = (this.cameraMode + 1) % 4;
    if (this.cameraMode === 2) {
      const dx = this.camera.position.x - this.playerPos.x;
      const dz = this.camera.position.z - this.playerPos.z;
      const dy = this.camera.position.y - this.playerPos.y - (this.rig?.dimensions.H || 1) * 0.15;
      const horiz = Math.hypot(dx, dz) || 1;
      this.freeCam.yaw = Math.atan2(dx, dz);
      this.freeCam.pitch = clamp(Math.atan2(dy, horiz), -0.35, 1.15);
      this.freeCam.distance = 1.0;
      this._cancelMouseSteer();
    }
    if (this.cameraMode === 0 || this.cameraMode === 3) {
      this.orbit.targetYaw = 0;
      this.orbit.targetPitch = 0;
    }
    this.audio.uiClick();
    const names = ['追随视角 · CHASE', '御龙视角 · ON DRAGONBACK', '自由视角 · 360° ORBIT', '电影视角 · CINEMATIC'];
    const hints = ['', ' · 龙背之上', ' · 拖拽可 360° 环视', ' · 远方机位'];
    this.ui.toast(names[this.cameraMode] + hints[this.cameraMode], { duration: 1900 });
  }

  resetSafe() {
    if (this.mode !== 'flight') return;
    const si = this._surfaceAt(this.playerPos.x, this.playerPos.z);
    this.flightState = 'flying';
    this.underwater = false;
    this.world.environment.setUnderwater(false);
    this.playerPos.y = Math.max(this.playerPos.y + 18, si.surfaceY + 74);
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
  _surfaceAt(x, z) {
    const ground = this.world.getHeight(x, z);
    const water = ground < SEA_LEVEL - 0.18;
    const surfaceY = water ? SEA_LEVEL : Math.max(ground, 0);
    return { ground, water, surfaceY, depth: Math.max(0, SEA_LEVEL - ground) };
  }

  _clearance() {
    return 2.5 + (this.rig?.dimensions?.H || 1.2) * 0.72;
  }

  _standOffset(water) {
    const rig = this.rig;
    if (!rig) return 2;
    if (water) return rig.floatOffset || 0.5;
    return rig.standOffset || 2;
  }

  _readFlightControls(locked) {
    let pitchIn = 0;
    let turnIn = 0;
    if (!locked) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) pitchIn += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) pitchIn -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) turnIn += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) turnIn -= 1;
      turnIn += this.touchInput.x;
      pitchIn += -this.touchInput.y;
      if (this.mouseSteer.active && this.cameraMode !== 2) {
        turnIn += this.mouseSteer.x * 0.9;
        pitchIn += this.mouseSteer.y;
      }
      pitchIn = clamp(pitchIn, -1, 1);
      turnIn = clamp(turnIn, -1, 1);
    }
    return { pitchIn, turnIn };
  }

  _refreshGroup() {
    if (!this.rig) return;
    this.rig.group.position.copy(this.playerPos);
    this.rig.group.updateMatrixWorld(true);
    _forward.set(0, 0, 1).applyQuaternion(this.rig.group.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.rig.group.quaternion);
    _right.crossVectors(_forward, _up).normalize();
  }

  updateFlight(dt) {
    this.time += dt;
    if (this.paused) {
      this.audio.setWind(0, false, false);
      return;
    }
    this.runTime += dt;
    this.abilityCooldown = Math.max(0, this.abilityCooldown - dt);
    this.feedCooldown = Math.max(0, this.feedCooldown - dt);
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

    const locked = this.controlsLocked || this.introActive;
    const input = this._readFlightControls(locked);

    if (this.flightState === 'landing') {
      this._updateLanding(dt);
      this._finishFlightFrame(dt);
      return;
    }
    if (this.flightState === 'grounded' || this.flightState === 'floating') {
      this._updateRested(dt, input, locked);
      this._finishFlightFrame(dt);
      return;
    }
    if (this.flightState === 'swimming') {
      this._updateSwimming(dt, input, locked);
      this._finishFlightFrame(dt);
      return;
    }
    this._updateFlying(dt, input, locked);
    this._finishFlightFrame(dt);
  }

  _updateFlying(dt, input, locked) {
    const f = this.flight;
    this._updateInputAxes(input, dt);
    this._updateCommonFlightSystems(dt, locked);
    const speedNorm = clamp(this.speed / f.cruise, 0, 1.5);
    this.stall = damp(this.stall, clamp(1 - this.speed / 16.5, 0, 1), 2.4, dt);
    this.stamina = clamp(this.stamina, 0, this.maxStamina);

    const shiftHeld = !locked && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchBoost);
    const brakeHeld = !locked && (this.keys.has('ControlLeft') || this.keys.has('ControlRight'));
    this.brake = damp(this.brake, brakeHeld ? 1 : 0, 5, dt);
    const canBoost = shiftHeld && this.stamina > 1.2 && !this.introActive;
    const wasBoosting = this.boostActive;
    this.boostActive = canBoost && this.stamina > 0.4;
    if (this.boostActive) {
      this.stamina = Math.max(0, this.stamina - 21 * dt * (0.9 + 0.1 * f.boost));
      this.regenDelay = 1.0;
    } else if (this.stamina <= 0.4 && shiftHeld) {
      this.stamina = 0;
    }
    if (this.boostActive && !wasBoosting) {
      this.shake = Math.max(this.shake, 0.2);
      this.audio.flap(0.65);
      this.ui.toast('疾风 · 起飞', { duration: 1300 });
    }
    if (!locked && (this.flapHeld || this.touchFlap) && this.time >= this.nextFlapAt) {
      this.doFlap(this.flapHeld && !this.touchFlap);
    }

    const turnControl = (1 - this.stall * 0.55) * (0.3 + 0.7 * clamp(this.speed / 26, 0.2, 1.3));
    this.yaw += this.turnAxis * f.turn * turnControl * dt;
    this.pitch += this.pitchAxis * (0.76 - this.stall * 0.28) * dt;
    if (Math.abs(this.pitchAxis) < 0.035) this.pitch = damp(this.pitch, 0.018, 0.75, dt);
    if (this.stall > 0.16) this.pitch = damp(this.pitch, -0.36, 1.0 + this.stall * 1.6, dt);
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

    const dive = -_forward.y;
    const climb = _forward.y;
    const baseThrust = 5.25 * (f.cruise / 33);
    const boostThrust = this.boostActive ? 11.5 * (f.boost || 1) : 0;
    const brakeDrag = this.brake * 4.2;
    const turnDrag = Math.abs(this.turnAxis) * 0.42 + Math.abs(this.roll) * 0.18;
    const drag = 0.00365 * this.speed * this.speed + 0.016 * this.speed + brakeDrag + turnDrag;
    let accel = baseThrust + boostThrust - drag + dive * 7.6 * (f.dive || 1) - Math.max(0, climb) * 0.7;
    const tempPenalty = (this.bodyTemp < 34.5 || this.bodyTemp > 39.4) ? 0.88 : 1;
    const hungerPenalty = this.satiety <= 0.2 ? 0.9 : 1;
    if (this.speed < 7) accel += (7 - this.speed) * 1.5;
    this.speedKick = damp(this.speedKick, 0, 3.2, dt);
    accel += this.speedKick * 4.0;
    this.speed = clamp(this.speed + accel * dt, 2, f.max * 1.46 * tempPenalty * hungerPenalty);
    if (this.stall > 0.25) this.speed = Math.min(this.speed, f.max);
    if (this.brake) this.speed = Math.min(this.speed, f.cruise * 1.5);

    const liftQuality = clamp(this.speed / 18, 0, 1.25);
    const bankLoss = Math.abs(Math.sin(this.roll)) * (1.1 + this.speed * 0.045);
    const windLift = Math.sin(this.time * 0.36 + this.playerPos.x * 0.006) * 0.16;
    let sink = (0.64 + (1 - Math.min(1, liftQuality)) * 8.5) / Math.max(0.75, f.lift);
    sink += bankLoss + this.stall * 11.0;
    sink -= this.flapLift;
    sink -= this.autoFlapLift;
    sink += windLift;
    this.autoFlapLift = damp(this.autoFlapLift, 0, 2.6, dt);
    this.flapLift = damp(this.flapLift, 0, 2.8, dt);
    if (this.speed < 10 && this.pitch > 0.3) this.pitch = damp(this.pitch, 0.3, 3.0, dt);

    _target.copy(_forward).multiplyScalar(this.speed);
    _target.y -= Math.max(0, sink);
    _target.x += Math.sin(this.time * 0.4) * 0.05;
    _target.z += Math.cos(this.time * 0.31) * 0.04;
    const align = 1 - Math.exp(-(this.stall > 0.3 ? 2.0 : 3.25) * dt);
    this.playerVelocity.lerp(_target, align);
    this.distance += this.playerVelocity.length() * dt;
    this.playerPos.addScaledVector(this.playerVelocity, dt);
    this.surfaceInfo = this._surfaceAt(this.playerPos.x, this.playerPos.z);

    this._resolveCollision(dt);
    this._refreshGroup();

    const si = this.surfaceInfo;
    this.distanceToGround = this.playerPos.y - si.surfaceY;
    this.groundY = Math.max(si.ground, SEA_LEVEL);
    this.skimmish = si.water && this.distanceToGround < 15 && this.speed > 24;
    if (this.skimmish) {
      this.speed = Math.min(f.max * 1.5, this.speed + 1.4 * dt * (f.water || 1));
      if (Math.random() < dt * 8) this._emitWaterSpray();
    }
    if (si.water && this.dragon.landing?.dive && this.playerPos.y < SEA_LEVEL - 0.8) {
      this._enterWater();
      return;
    }
    this.underwater = false;
    this.flightState = 'flying';
    this.condition = 'flying';
  }

  _updateInputAxes(input, dt) {
    this.pitchAxis = damp(this.pitchAxis, input.pitchIn, input.pitchIn === 0 ? 3.6 : 5.0, dt);
    this.turnAxis = damp(this.turnAxis, input.turnIn, 4.8, dt);
  }

  _updateCommonFlightSystems(dt, locked) {
    if (this.regenDelay > 0) this.regenDelay = Math.max(0, this.regenDelay - dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * (this.shake > 0.5 ? 3.5 : 2.2));
  }

  _updateLanding(dt) {
    const d = this.landData;
    if (!d) { this.flightState = 'flying'; return; }
    d.time += dt;
    const t = clamp(d.time / d.duration, 0, 1);
    const ease = t * t * (3 - 2 * t);
    this.playerPos.y = lerp(d.startY, d.targetY, ease);
    if (d.startX != null) {
      this.playerPos.x = lerp(d.startX, d.targetX, ease);
      this.playerPos.z = lerp(d.startZ, d.targetZ, ease);
    }
    this.speed = lerp(d.startSpeed, 0, ease);
    this.playerVelocity.set(0, -Math.max(0, (d.startY - d.targetY)) * 0.22, 0);
    this.pitch = damp(this.pitch, 0, 3.2, dt);
    this.roll = damp(this.roll, 0, 3.2, dt);
    const targetQ = this._surfaceQuaternion(d.water, new THREE.Quaternion());
    const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
    targetQ.slerp(yawQ, d.water ? 0 : 0.22);
    this.rig.group.quaternion.slerp(targetQ, 1 - Math.exp(-3.6 * dt));
    this.rig.group.position.copy(this.playerPos);
    this.rig.group.updateMatrixWorld(true);
    if (t >= 1) this._completeLanding(d);
  }

  _completeLanding(d) {
    this.speed = 0;
    this.playerVelocity.set(0, 0, 0);
    this.pitch = 0;
    this.roll = 0;
    this.flightState = d.water ? 'floating' : 'grounded';
    this.condition = d.water ? 'floating' : 'grounded';
    this.playerPos.y = d.targetY;
    this.surfaceQuaternion = this._surfaceQuaternion(d.water, new THREE.Quaternion());
    this.rig.group.quaternion.copy(this.surfaceQuaternion);
    this.rig.group.position.copy(this.playerPos);
    this.rig.group.updateMatrixWorld(true);
    this.landData = null;
    this.underwater = false;
    this.world.environment.setUnderwater(false);
    const water = d.water;
    this.audio.groundHit(water ? 0.22 : 0.4);
    if (water) this._emitWaterSpray();
    else {
      _tmp.copy(this.playerPos);
      _tmp.y = this.surfaceInfo.surfaceY + 0.25;
      this.world.effects.burst(_tmp, this.dragon.palette.belly || '#d7c7a0', 18, 5, 0.3, 0.8);
    }
    this.ui.toast(water ? '浮于海面 · 水栖龙种正在回息' : '栖落 · 体力正在恢复', { duration: 2600 });
  }

  _surfaceQuaternion(water, out) {
    _q.setFromEuler(_euler.set(0, this.yaw, 0, 'YXZ'));
    if (water) return out.copy(_q);
    const eps = 2.4;
    const x = this.playerPos.x;
    const z = this.playerPos.z;
    const hx = (this.world.getHeight(x + eps, z) - this.world.getHeight(x - eps, z)) / (eps * 2);
    const hz = (this.world.getHeight(x, z + eps) - this.world.getHeight(x, z - eps)) / (eps * 2);
    _tmp.set(-hx, 1, -hz).normalize();
    _q2.setFromUnitVectors(UP, _tmp);
    _q2.slerp(new THREE.Quaternion(), 0.14);
    return out.copy(_q2).multiply(_q);
  }

  _landingSpot(allowWater, allowGround) {
    const originX = this.playerPos.x;
    const originZ = this.playerPos.z;
    const isWaterSpot = (ground) => ground < SEA_LEVEL - 0.18;
    const candidates = [];
    const add = (x, z) => {
      const ground = this.world.getHeight(x, z);
      const water = isWaterSpot(ground);
      if (water ? !allowWater : !allowGround) return;
      const elevation = Math.max(ground, SEA_LEVEL);
      if (this.playerPos.y - elevation > 65) return;
      let slope = 0;
      if (!water) {
        const eps = 3.5;
        const hx = (this.world.getHeight(x + eps, z) - this.world.getHeight(x - eps, z)) / (eps * 2);
        const hz = (this.world.getHeight(x, z + eps) - this.world.getHeight(x, z - eps)) / (eps * 2);
        slope = Math.hypot(hx, hz);
        if (slope > 0.32) return;
      }
      const dist = Math.hypot(x - originX, z - originZ);
      candidates.push({ x, z, ground, water, elevation, slope, score: slope * 2 + dist * 0.02 + (this.playerPos.y - elevation) * 0.004 });
    };
    add(originX, originZ);
    for (let ring = 1; ring <= 10; ring++) {
      const r = ring * 6;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + ring * 0.17;
        add(originX + Math.cos(a) * r, originZ + Math.sin(a) * r);
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0];
  }

  startLanding() {
    if (this.mode !== 'flight' || this.paused) return;
    const spot = this._landingSpot(this.dragon.landing?.water, this.dragon.landing?.ground);
    if (!spot) {
      if (this.surfaceInfo?.water && !this.dragon.landing?.water) this.ui.toast('此龙无法在海面栖落 · 寻找陆地', { duration: 2200 });
      else if (!this.surfaceInfo?.water && !this.dragon.landing?.ground) this.ui.toast('此龙不喜落地 · 继续翱翔', { duration: 2000 });
      else this.ui.toast('附近没有足够平坦的栖地 · 再飞低一些', { duration: 2200 });
      return;
    }
    const targetY = spot.elevation + this._standOffset(spot.water);
    this.landData = {
      water: spot.water, startY: this.playerPos.y, targetY,
      startSpeed: this.speed, time: 0, duration: 1.35,
      startX: this.playerPos.x, startZ: this.playerPos.z, targetX: spot.x, targetZ: spot.z,
      slope: spot.slope,
    };
    this.flightState = 'landing';
    this.condition = 'landing';
    this.flapHeld = false;
    this.mouseSteer.active = false;
    this.mouseSteer.x = 0;
    this.mouseSteer.y = 0;
    this.audio.flap(0.5);
    this.ui.toast(spot.water ? '正在贴近海面…' : '正在寻找落点…', { duration: 1300 });
  }

  toggleLand() {
    if (this.mode !== 'flight' || this.paused) return;
    if (this.flightState === 'flying') this.startLanding();
    else if (this.flightState === 'grounded' || this.flightState === 'floating') this._takeOff();
    else if (this.flightState === 'swimming') this._surfaceFromSwim();
  }

  _takeOff() {
    if (this.mode !== 'flight') return;
    const water = this.flightState === 'floating' || this.underwater;
    const si = this._surfaceAt(this.playerPos.x, this.playerPos.z);
    this.flightState = 'flying';
    this.landData = null;
    this.underwater = false;
    this.speed = Math.max(10, this.speed);
    this.playerPos.y = Math.max(this.playerPos.y, si.surfaceY + this._standOffset(water) + 1.4);
    this.pitch = 0.22;
    this.roll = 0;
    this.playerVelocity.copy(_forward.set(0, 0, 1).applyQuaternion(this.rig.group.quaternion)).multiplyScalar(this.speed);
    this.animator.triggerFlap(1.15);
    this.audio.flap(0.9);
    this.shake = Math.max(this.shake, 0.22);
    this.world.effects.burst(this._centerOfDragon(_tmp), water ? '#a2f2e9' : this.dragon.palette.belly || '#d7c7a0', water ? 30 : 20, 7, 0.25, 0.9);
    this.ui.toast('振翅 · 起飞', { duration: 1500 });
    this.condition = 'flying';
  }

  _updateRested(dt, input, locked) {
    const water = this.flightState === 'floating';
    const si = this._surfaceAt(this.playerPos.x, this.playerPos.z);
    this.surfaceInfo = si;
    this.speed = 0;
    this.playerVelocity.set(0, 0, 0);
    if (!locked) {
      const turn = input.turnIn;
      if (Math.abs(turn) > 0.02) this.yaw += turn * 0.55 * dt;
      if (water && this.dragon.landing?.dive && (this.keys.has('KeyS') || this.keys.has('ControlLeft'))) {
        this._enterWaterFromFloat();
        return;
      }
    }
    this.pitch = 0;
    this.roll = 0;
    const stand = this._standOffset(water);
    const bob = water ? Math.sin(this.time * 1.2) * 0.14 : 0;
    this.playerPos.y = si.surfaceY + stand + bob;
    this._surfaceQuaternion(water, this.surfaceQuaternion);
    this.rig.group.quaternion.copy(this.surfaceQuaternion);
    this.rig.group.position.copy(this.playerPos);
    this.rig.group.updateMatrixWorld(true);
    this.condition = water ? 'floating' : 'grounded';
    this.underwater = false;
    if (water && Math.random() < dt * 0.8) this._emitWaterSpray();
  }

  _enterWaterFromFloat() {
    this.flightState = 'swimming';
    this.playerPos.y = SEA_LEVEL - 1.2;
    this.speed = Math.max(5, this.flight.cruise * 0.35);
    this.pitch = -0.08;
    this.underwater = true;
    this.world.environment.setUnderwater(true);
    this._emitWaterSpray();
    this.ui.toast('下潜 · 水中捕鱼与探索', { duration: 2200 });
  }

  _updateSwimming(dt, input, locked) {
    const f = this.flight;
    if (!this.dragon.landing?.dive) {
      this._surfaceFromSwim();
      return;
    }
    this._updateInputAxes(input, dt);
    this._updateCommonFlightSystems(dt, locked);
    this.turnAxis = input.turnIn;
    this.pitchAxis = input.pitchIn;
    this.yaw += this.turnAxis * (f.turn * 0.94) * (0.75 + 0.2 * clamp(this.speed / f.cruise, 0, 1)) * dt;
    this.pitch += this.pitchAxis * 0.75 * dt;
    this.pitch = clamp(this.pitch, -0.95, 0.9);
    this.roll = damp(this.roll, -this.turnAxis * 0.4, 4, dt);
    this.stall = damp(this.stall, 0, 3, dt);
    _q.setFromEuler(_euler.set(-this.pitch, this.yaw, this.roll, 'YXZ'));
    this.rig.group.quaternion.copy(_q);
    _forward.set(0, 0, 1).applyQuaternion(this.rig.group.quaternion);
    const shift = !locked && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchBoost);
    const targetSpeed = (shift ? f.cruise * 1.12 : f.cruise * 0.58) * (this.boostActive ? 1.1 : 1);
    this.speed = damp(this.speed, targetSpeed, 1.8, dt);
    this.boostActive = shift && this.stamina > 1;
    if (this.boostActive) this.stamina = Math.max(0, this.stamina - 5.5 * dt);
    _target.copy(_forward).multiplyScalar(this.speed);
    this.playerVelocity.lerp(_target, 1 - Math.exp(-2.2 * dt));
    this.playerPos.addScaledVector(this.playerVelocity, dt);
    const ground = this.world.getHeight(this.playerPos.x, this.playerPos.z);
    const clearance = this._clearance() * 0.58;
    if (this.playerPos.y < ground + clearance) {
      this.playerPos.y = ground + clearance;
      this.pitch = damp(this.pitch, 0.22, 3, dt);
      this.playerVelocity.y = Math.max(0, this.playerVelocity.y);
    }
    if (this.playerPos.y > SEA_LEVEL - 0.8) this.playerPos.y = SEA_LEVEL - 0.8;
    this.underwater = this.playerPos.y < SEA_LEVEL - 0.5;
    this.world.environment.setUnderwater(this.underwater);
    this.surfaceInfo = this._surfaceAt(this.playerPos.x, this.playerPos.z);
    this.distanceToGround = Math.max(0, this.playerPos.y - Math.max(ground, SEA_LEVEL));
    this.flightState = 'swimming';
    this.condition = 'swimming';
    if (Math.random() < dt * 9) {
      this.world.effects.emit(
        this.playerPos.x + (Math.random() - 0.5) * 3,
        this.playerPos.y + 1.5,
        this.playerPos.z + (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 1.2, 1.4 + Math.random() * 2.2, (Math.random() - 0.5) * 1.2,
        '#bcecf2', 0.1 + Math.random() * 0.12, 1.2, -1.2, 0.9,
      );
    }
  }

  _surfaceFromSwim() {
    const si = this._surfaceAt(this.playerPos.x, this.playerPos.z);
    this.flightState = 'flying';
    this.underwater = false;
    this.world.environment.setUnderwater(false);
    this.playerPos.y = Math.max(SEA_LEVEL + this._clearance(), this.playerPos.y);
    this.pitch = 0.24;
    this.roll = 0;
    this.speed = Math.max(12, this.speed);
    this.animator.triggerFlap(1);
    this.audio.flap(0.8);
    this._emitWaterSpray();
    this.ui.toast('破水 · 继续翱翔', { duration: 1600 });
  }

  _enterWater() {
    if (!this.dragon.landing?.dive) return;
    this.flightState = 'swimming';
    this.underwater = true;
    this.world.environment.setUnderwater(true);
    this.playerPos.y = Math.min(this.playerPos.y, SEA_LEVEL - 1.2);
    this.speed *= 0.52;
    this.pitch = clamp(this.pitch, -0.45, 0.05);
    this.roll *= 0.4;
    this.animator.triggerFlap(0.5);
    this.audio.groundHit(0.55);
    this._emitWaterSpray();
    this.ui.toast('入水 · 按 E 浮出水面', { duration: 2200 });
  }

  _finishFlightFrame(dt) {
    const pose = this.flightState === 'grounded' ? 'landed'
      : (this.flightState === 'floating' || this.flightState === 'swimming') ? 'swim' : 'flight';
    const animState = {
      mode: 'flight',
      pose,
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
    this.animator.update(dt, animState);
    this.rig.group.position.copy(this.playerPos);
    this.rig.group.updateMatrixWorld(true);
    this.world.environment.setUnderwater(this.underwater);
    this.world.update(dt, this.time, this.playerPos, this.camera, 'flight', true);
    this.abilities.update(dt, this.time, this.world.environment, this.playerPos, this.underwater);
    this.wildlife.update(dt, this.time, this.playerPos, {
      underwater: this.underwater,
      firePositions: this.abilities.firePositions,
    });
    this._updateSurvival(dt);
    this._updateInteractions();
    this._updateFlightCamera(dt);
    this._updateShadow(this.playerPos);
    this._emitFlightTrails(dt);
    this._updateRegion(dt);
    this._updateHud(dt);
    this.audio.update(dt, { mode: 'flight', speed: this.speed, active: true });
    this.audio.setWind(this.underwater ? 0 : this.speed, this.boostActive, true);
  }

  _updateSurvival(dt) {
    const env = this.world.environment;
    const f = this.flight;
    const survival = this.dragon.survival || {};
    this.ambientTemp = env?.temperature ?? 20;
    const flying = this.flightState === 'flying' || this.flightState === 'landing';
    const grounded = this.flightState === 'grounded';
    const floating = this.flightState === 'floating';
    const swimming = this.flightState === 'swimming';
    const active = flying || swimming;
    const restMult = grounded ? (survival.groundRest ?? 1)
      : floating ? (survival.waterRest ?? 0.8)
      : swimming ? (survival.waterRest ?? 0.8) * 0.65
      : (survival.skyRest ?? 0.15) * 0.32;
    let special = 1;
    const region = this.regionInfo?.id;
    if (survival.special === 'night' && (env.night > 0.45 || this.regionInfo?.id === 'sea')) special *= 1.3;
    if (survival.special === 'moon' && env.night > 0.45) special *= 1.35;
    if (survival.special === 'sun' && env.night < 0.3 && env.cloudiness < 0.55) special *= 1.22;
    if (survival.special === 'rain' && (env.rain > 0.15 || this.surfaceInfo.water)) special *= 1.28;
    if (survival.special === 'forest' && region === 'forest' && !flying) special *= 1.3;
    if (survival.special === 'warmth') {
      const temp = this.ambientTemp;
      if (temp > 24 || this.abilities.fires.some((fi) => Math.hypot(fi.x - this.playerPos.x, fi.z - this.playerPos.z) < 35)) special *= 1.25;
    }
    if (survival.special === 'any') special *= 1.1;
    const satietyFactor = this.satiety < 12 ? 0.42 : (this.satiety < 32 ? 0.78 : 1);
    const tempFactor = (this.bodyTemp < 34.3 || this.bodyTemp > 39.4) ? 0.55 : 1;
    const comfort = survival.comfort || [0, 33];
    const comfortMid = (comfort[0] + comfort[1]) * 0.5;
    const nearFire = this.abilities.fires.some((fi) => Math.hypot(fi.x - this.playerPos.x, fi.z - this.playerPos.z) < 32);
    let targetTemp = 36.6 + clamp((this.ambientTemp - comfortMid) * 0.085, -4.8, 4.8);
    if (this.ambientTemp < comfort[0]) targetTemp -= 1.8;
    else if (this.ambientTemp > comfort[1]) targetTemp += 1.8;
    if (nearFire) targetTemp += 3.0;
    if (this.underwater) targetTemp -= 1.8;
    if (env.rain > 0.3) targetTemp -= 1.2;
    if (flying) targetTemp -= clamp(this.speed * 0.022, 0, 1.3);
    this.bodyTemp = damp(this.bodyTemp, clamp(targetTemp, 30.5, 41.5), grounded || floating ? 0.12 : 0.055, dt);
    const restDelay = grounded || floating || swimming ? 0 : this.regenDelay;
    if (restDelay <= 0 && !this.boostActive) {
      const canRecover = saturatedRecovery(this.stamina, this.maxStamina);
      if (canRecover) {
        const rate = f.regen * restMult * special * satietyFactor * tempFactor;
        this.stamina = Math.min(this.maxStamina, this.stamina + rate * dt);
        this.recoveryRate = rate;
        this.recoveryHint = restLabel(this.dragon, this.flightState, survival);
        this.recovering = rate > 0.3;
      } else {
        this.recoveryRate = 0;
        this.recoveryHint = this.resting ? '体力充盈 · 可以起飞' : '体力充盈 · 状态良好';
        this.recovering = false;
      }
    } else {
      this.recoveryRate = 0;
      if (this.stamina >= this.maxStamina - 0.15 && !this.boostActive) {
        this.recoveryHint = this.resting ? '体力充盈 · 可以起飞' : '体力充盈 · 状态良好';
      } else {
        this.recoveryHint = this.boostActive ? '疾风消耗中' : '振翅后喘息';
      }
      this.recovering = false;
    }
    const hungerScale = (flying ? 1 : 0.45) * (survival.hungerRate || 1);
    this.satiety = Math.max(0, this.satiety - 0.065 * hungerScale * dt);
    if (this.satiety > 55 && grounded && this.bodyTemp > 34) this.bodyTemp = Math.min(37.4, this.bodyTemp + 0.01 * dt);
    this.resting = grounded || floating || swimming;
    this.restLabel = grounded ? '地面栖伏' : (floating ? '海面浮息' : (swimming ? '深水潜息' : ''));
    // Warnings, in priority order.
    let warning = null;
    if (this.stall > 0.23) warning = '失速警告 · 按 SPACE 振翅';
    else if (this.flightState === 'flying' && this.distanceToGround < 7 && this.playerVelocity.y < -1.5) warning = '地形接近 · 拉升';
    else if (this.bodyTemp < 34.2) warning = '失温 · 靠近火源或降落休憩';
    else if (this.bodyTemp > 39.5) warning = '过热 · 下水或等待夜间';
    else if (this.satiety < 9) warning = '饥饿 · 捕食或进食';
    else if (this.stamina < 7) warning = '耐力耗尽 · 栖落休息';
    this.warning = warning;
  }

  _updateInteractions() {
    this.promptLand = null;
    this.promptFeed = null;
    if (this.paused || this.introActive) return;
    const state = this.flightState;
    const si = this.surfaceInfo;
    if (state === 'landing') return;
    if (state === 'flying') {
      if (this.distanceToGround <= 65) {
        const canWater = this.dragon.landing?.water;
        const canGround = this.dragon.landing?.ground;
        if ((si.water && canWater) || (!si.water && canGround)) {
          this.promptLand = si.water ? '降落 · 海面' : '降落 · 地面';
        }
      }
    } else if (state === 'grounded' || state === 'floating') {
      this.promptLand = '起飞';
    } else if (state === 'swimming') {
      this.promptLand = '浮出水面';
    }
    const diet = this.dragon.survival?.diet || [];
    const target = this.wildlife.getHuntTarget(this.playerPos, diet, {
      underwater: this.underwater,
      grounded: state === 'grounded' || state === 'floating',
    });
    this.feedTargets = target;
    if (target && target.distance < 60) {
      this.promptFeed = `捕食 · ${target.name} ${Math.round(target.distance)}m`;
      this.feedKind = 'hunt';
      return;
    }
    const feed = this._specialFeed();
    if (feed) {
      this.promptFeed = feed.label;
      this.feedKind = 'special';
      this.feedSpecial = feed.kind;
    } else {
      this.feedKind = null;
      this.feedSpecial = null;
    }
  }

  _specialFeed() {
    const env = this.world.environment;
    const since = this.time - (this._lastSpecialFeed || -99);
    if (since < 8) return null;
    if (this.dragon.id === 'wuzhao' && this.flightState === 'flying' && this.playerPos.y - SEA_LEVEL > 55 && env.night < 0.35 && env.weatherIndex < 2) {
      return { kind: 'dew', label: '饮露 · 高空清风' };
    }
    if (this.dragon.id === 'lilong' && env.night > 0.4 && this.playerPos.y - SEA_LEVEL > 25) {
      return { kind: 'moon', label: '凝月 · 夜穹清辉' };
    }
    if (this.dragon.id === 'ladon' && (this.flightState === 'grounded' || this.flightState === 'floating') && this.regionInfo?.id === 'forest') {
      return { kind: 'fruit', label: '觅果 · 林间' };
    }
    if ((this.flightState === 'floating' || this.flightState === 'grounded' || this.underwater) && this.surfaceInfo.water) {
      return { kind: 'drink', label: '饮水' };
    }
    return null;
  }

  tryFeed() {
    if (this.mode !== 'flight' || this.paused || this.introActive || this.time < this.feedCooldown) return;
    this.feedCooldown = this.time + 1.2;
    const diet = this.dragon.survival?.diet || [];
    const target = this.wildlife.getHuntTarget(this.playerPos, diet, {
      underwater: this.underwater,
      grounded: this.flightState === 'grounded' || this.flightState === 'floating',
    });
    if (target) {
      const caught = this.wildlife.catchTarget(target, this.playerPos);
      if (caught) {
        const nutrition = { fish: 18, bird: 13, sheep: 34 }[caught.type] || 12;
        this.satiety = Math.min(100, this.satiety + nutrition);
        this.stamina = Math.min(this.maxStamina, this.stamina + (caught.type === 'fish' ? 7 : 5));
        this.preyCaught += 1;
        this.bodyTemp = Math.min(38.4, this.bodyTemp + 0.35);
        this.world.effects.burst(caught.pos, caught.color, 18, 6, 0.24, 0.9);
        this.world.effects.burst(this._headPosition(_tmp), '#f4dfad', 8, 4, 0.18, 0.7);
        this.audio.collect(2);
        this.ui.toast(`捕食 · ${caught.name} · 饱食 +${nutrition}`, { duration: 2200 });
        this.animator.triggerFlap(0.35);
        if (this.world.wildlife.scareAt) this.world.wildlife.scareAt(caught.pos, 55, 0.6);
      }
      return;
    }
    const feed = this._specialFeed();
    if (feed) {
      this._lastSpecialFeed = this.time;
      if (feed.kind === 'dew') {
        this.satiety = Math.min(100, this.satiety + 22);
        this.stamina = Math.min(this.maxStamina, this.stamina + 9);
        this.ui.toast('饮露 · 清气入喉', { duration: 2000 });
      } else if (feed.kind === 'moon') {
        this.satiety = Math.min(100, this.satiety + 14);
        this.stamina = Math.min(this.maxStamina, this.stamina + 15);
        this.bodyTemp = Math.max(34.8, this.bodyTemp - 0.2);
        this.ui.toast('凝月 · 琉璃翼泛起月华', { duration: 2200 });
      } else if (feed.kind === 'fruit') {
        this.satiety = Math.min(100, this.satiety + 26);
        this.stamina = Math.min(this.maxStamina, this.stamina + 8);
        this.ui.toast('觅果 · 林间的金苹果', { duration: 2200 });
      } else {
        this.satiety = Math.min(100, this.satiety + 8);
        this.ui.toast('饮水 · 清冽甘甜', { duration: 1500 });
      }
      this.audio.collect(1);
      this.world.effects.burst(this._headPosition(_tmp), '#dff7df', 10, 4, 0.15, 0.7);
      return;
    }
    this.ui.toast('附近没有可捕食的猎物', { duration: 1700 });
  }

  castAbility() {
    if (this.mode !== 'flight' || this.paused || this.introActive) return;
    if (this.abilityCooldown > 0.05) {
      this.ui.toast(`龙赋冷却 · ${this.abilityCooldown.toFixed(1)}s`, { duration: 1200 });
      return;
    }
    const cost = 15;
    if (this.stamina < cost) {
      this.ui.toast('耐力不足 · 无法释放龙赋', { duration: 1600 });
      this.audio.warning();
      return;
    }
    const origin = this._headPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.rig.group.quaternion);
    fwd.y += 0.07;
    fwd.normalize();
    this.stamina = Math.max(0, this.stamina - cost);
    this.regenDelay = 1.3;
    this.abilityCooldown = this.dragon.ability?.cooldown || 9;
    this.animator.triggerRoar();
    this.audio.roar();
    const result = this.abilities.cast({
      dragon: this.dragon, origin, forward: fwd,
      environment: this.world.environment,
    });
    this.abilityElement = result.element;
    const names = { fire: '赤焰龙息', shadowfire: '冥焰吐息', frost: '琉璃霜息', water: '翻江倒海', nature: '金苹果藤蔓', star: '星陨天罚', storm: '九霄天雷' };
    this.ui.flash(0.16, 260);
    this.ui.toast(`龙赋 · ${names[result.element] || this.dragon.ability?.name}`, { duration: 2200, strong: true });
    this.shake = Math.max(this.shake, 0.55);
  }

  _onLightning() {
    this.flash = Math.max(this.flash, 0.18);
    this.ui.flash(0.1, 180);
    this.audio.groundHit(0.35);
    this.shake = Math.max(this.shake, 0.2);
  }

  _cancelMouseSteer() {
    this.mouseSteer.active = false;
    this.mouseSteer.x = 0;
    this.mouseSteer.y = 0;
  }
  _resolveCollision(dt) {
    const groundRaw = this.world.getHeight(this.playerPos.x, this.playerPos.z);
    const water = groundRaw < SEA_LEVEL - 0.18;
    this.surfaceInfo = { ground: groundRaw, water, surfaceY: water ? SEA_LEVEL : Math.max(groundRaw, 0), depth: Math.max(0, SEA_LEVEL - groundRaw) };
    const clearance = this._clearance();
    let floor;
    if (this.flightState === 'swimming' || this.underwater) floor = groundRaw + clearance * 0.55;
    else if (water) floor = this.dragon.landing?.dive ? SEA_LEVEL - 2.4 : SEA_LEVEL + clearance;
    else floor = groundRaw + clearance;
    if (this.playerPos.y < floor) {
      const impact = clamp((floor - this.playerPos.y) * 0.36 + Math.max(0, -this.playerVelocity.y) * 0.06, 0, 1.4);
      this.playerPos.y = floor;
      if (this.playerVelocity.y < 1.0) this.playerVelocity.y = Math.max(1.6, -this.playerVelocity.y * 0.08);
      this.speed *= Math.max(0.52, 1 - impact * 0.25);
      this.pitch = Math.max(this.pitch, 0.06);
      this.stall = Math.max(this.stall, 0.08);
      this.shake = Math.max(this.shake, 0.25 + impact * 0.45);
      if (this.time - this.lastCollision > 0.45) {
        this.lastCollision = this.time;
        const splash = water && this.flightState !== 'swimming';
        this.audio.groundHit(Math.min(1, impact + 0.25) * (splash ? 0.55 : 1));
        _tmp.copy(this.playerPos);
        _tmp.y = (water ? SEA_LEVEL : groundRaw) + 0.3;
        this.world.effects.burst(_tmp, splash ? '#bdeff2' : (this.dragon.palette?.belly || '#d7c7a0'), splash ? 26 : 16, splash ? 9 : 5, 0.32, 0.9);
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
    const dims = rig.dimensions;
    const speedNorm = clamp(this.speed / this.flight.max, 0, 1.2);
    const camera = this.camera;
    const cinematic = this.cameraMode === 3;
    const rider = this.cameraMode === 1;
    const free = this.cameraMode === 2;
    const grounded = this.flightState === 'grounded' || this.flightState === 'floating';
    const maxGround = (x, z) => this.underwater
      ? this.world.getHeight(x, z) + 1.4
      : Math.max(this.world.getHeight(x, z), SEA_LEVEL);

    if (free) {
      // A full 360 orbit unconstrained by the dragon's heading.
      const dist = Math.max(6, rig.cameraDistance * this.freeCam.distance * this.camZoom * (1 + speedNorm * 0.08));
      const cp = Math.cos(this.freeCam.pitch);
      _target.set(
        this.playerPos.x + Math.sin(this.freeCam.yaw) * cp * dist,
        this.playerPos.y + Math.sin(this.freeCam.pitch) * dist + dims.H * 0.15,
        this.playerPos.z + Math.cos(this.freeCam.yaw) * cp * dist,
      );
      const ground = maxGround(_target.x, _target.z);
      if (_target.y < ground + 2.2) _target.y = ground + 2.2;
      if (this.underwater) _target.y = Math.min(_target.y, SEA_LEVEL - 0.5);
      this._clampCameraThroughTerrain(_target, _tmp2.copy(this.playerPos).setY(this.playerPos.y + dims.H * 0.15));
      camera.position.lerp(_target, 1 - Math.exp(-7.5 * dt));
      this.chaseLook.lerp(_tmp2.set(this.playerPos.x, this.playerPos.y + dims.H * 0.12, this.playerPos.z), 1 - Math.exp(-7 * dt));
      camera.up.copy(UP);
      camera.lookAt(this.chaseLook);
      camera.fov = damp(camera.fov, 48 + speedNorm * 5, 2.2, dt);
      camera.updateProjectionMatrix();
      this._applyCameraShake();
      return;
    }

    if (rider) {
      const local = _tmp.set(0, dims.H * 1.65 + 4.2, -dims.L * 0.42);
      rig.group.localToWorld(local);
      camera.position.lerp(local, 1 - Math.exp(-13 * dt));
      const dragonUp = _up.set(0, 1, 0).applyQuaternion(rig.group.quaternion);
      const upBlend = _tmp2.copy(UP).lerp(dragonUp, 0.38).normalize();
      const lookAhead = 15 + speedNorm * 8;
      const look = new THREE.Vector3().copy(_forward).multiplyScalar(lookAhead).add(this.playerPos);
      look.y -= dims.H * 0.1;
      this.chaseLook.lerp(look, 1 - Math.exp(-12 * dt));
      camera.up.copy(upBlend);
      camera.lookAt(this.chaseLook);
      camera.rotateY(-this.orbit.yaw * 0.7);
      camera.rotateX(this.orbit.pitch * 0.5);
      camera.rotateZ(this.roll * 0.2);
      camera.fov = damp(camera.fov, 64 + speedNorm * 4, 3, dt);
      camera.updateProjectionMatrix();
      this._applyCameraShake();
      return;
    }

    if (this.underwater) {
      const dist = (rig.cameraDistance * 0.78 + 4) * this.camZoom + speedNorm * 1.5;
      const up = Math.max(3.2, dims.H * 1.7 + 2.2);
      _target.copy(this.playerPos)
        .addScaledVector(_forward, -dist)
        .addScaledVector(UP, up);
      const floor = this.world.getHeight(_target.x, _target.z) + 2.6;
      if (_target.y < floor) _target.y = floor;
      const ceiling = SEA_LEVEL - 1.2;
      if (_target.y > ceiling) _target.y = ceiling;
      if (_target.y < floor) _target.y = Math.min(ceiling, floor);
      camera.position.lerp(_target, 1 - Math.exp(-4.6 * dt));
      const look = new THREE.Vector3().copy(this.playerPos);
      look.y += dims.H * 0.35;
      this.chaseLook.lerp(look, 1 - Math.exp(-6 * dt));
      camera.up.copy(UP);
      camera.lookAt(this.chaseLook);
      camera.fov = damp(camera.fov, 54 + speedNorm * 4, 2.5, dt);
      camera.updateProjectionMatrix();
      this._applyCameraShake();
      this._decayOrbit(dt, false);
      return;
    }

    const orbitYaw = this.orbit.yaw + (cinematic ? 0.25 : 0);
    const dist = rig.cameraDistance * (cinematic ? 1.52 : (grounded ? 0.73 : 0.95)) * this.camZoom * (1 + speedNorm * 0.1) +
      (this.boostActive ? 1.3 : 0);
    const height = rig.cameraHeight * (cinematic ? 1.25 : (grounded ? 1.08 : 0.92)) + 0.9 + speedNorm * 0.9 + this.orbit.pitch * 5 +
      (grounded ? 1.9 : 0);
    const behindAngle = Math.atan2(-_forward.x, -_forward.z) + orbitYaw;
    _target.set(
      this.playerPos.x + Math.sin(behindAngle) * dist,
      this.playerPos.y + height,
      this.playerPos.z + Math.cos(behindAngle) * dist,
    );
    const groundAtCam = maxGround(_target.x, _target.z);
    if (_target.y < groundAtCam + 2.4) _target.y = groundAtCam + 2.4;
    if (this.underwater) _target.y = Math.min(_target.y, SEA_LEVEL - 0.55);
    this._clampCameraThroughTerrain(_target, _tmp2.copy(this.playerPos).setY(this.playerPos.y + dims.H * 0.3));
    const desiredFov = (cinematic ? 44 : 48) + speedNorm * 7 + (this.boostActive ? 3.5 : 0) + (this.introActive ? 2 : 0) + (this.underwater ? 5 : 0);
    camera.fov = damp(camera.fov, desiredFov, 2, dt);
    camera.updateProjectionMatrix();
    camera.position.lerp(_target, 1 - Math.exp(-(this.introActive ? 3.2 : 4.2) * dt));
    const camGround = maxGround(camera.position.x, camera.position.z);
    if (camera.position.y < camGround + (this.underwater ? 0.8 : 2)) camera.position.y = camGround + (this.underwater ? 0.8 : 2);
    if (this.underwater) camera.position.y = Math.min(camera.position.y, SEA_LEVEL - 0.5);
    const lookAhead = (cinematic ? 7.5 : (grounded ? 5 : 10.5)) + this.speed * 0.12;
    const look = new THREE.Vector3().copy(_forward).multiplyScalar(lookAhead).add(this.playerPos);
    look.y += dims.H * 0.38;
    const freeLook = Math.min(1, Math.abs(this.orbit.yaw) * 1.4);
    look.lerp(this.playerPos, freeLook * 0.4);
    this.chaseLook.lerp(look, 1 - Math.exp(-6.5 * dt));
    camera.up.copy(UP);
    camera.lookAt(this.chaseLook);
    camera.rotateZ(this.roll * 0.18 + Math.sin(this.time * 0.6) * 0.003);
    this._applyCameraShake();
    this._decayOrbit(dt, false);
  }

  _clampCameraThroughTerrain(desired, focus) {
    const steps = 10;
    let hit = -1;
    for (let i = 2; i <= steps; i++) {
      const u = i / steps;
      _v.lerpVectors(focus, desired, u);
      const floor = Math.max(this.world.getHeight(_v.x, _v.z), SEA_LEVEL) + (this.underwater ? 1.1 : 2.0);
      if (_v.y < floor) { hit = i; break; }
    }
    if (hit > 0) {
      const u = Math.max(0.16, (hit - 1.15) / steps);
      desired.lerpVectors(focus, desired, u);
    }
    return desired;
  }

  _applyCameraShake() {
    if (this.shake <= 0.001) return;
    this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.65;
    this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
    this.camera.rotateZ((Math.random() - 0.5) * this.shake * 0.02);
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
    const f = this.flight;
    const env = this.world.environment?.state || {};
    const speed = this.speed;
    const lift = clamp(Math.pow(clamp(speed / 18, 0, 1.25), 2) * f.lift * (1 - this.stall) * 100, 0, 100);
    const condition = this.flightState === 'grounded' ? '栖 地'
      : this.flightState === 'floating' ? '浮 海'
      : this.flightState === 'swimming' ? '潜 游'
      : this.flightState === 'landing' ? '降 落'
      : this.underwater ? '潜 游'
      : this.boostActive ? '疾 风' : '翱 翔';
    return {
      speed,
      maxSpeed: f.max,
      altitude: this.playerPos.y - SEA_LEVEL,
      lift,
      stamina: this.stamina,
      maxStamina: this.maxStamina,
      boostActive: this.boostActive,
      boosting: this.boostActive,
      wind: env.wind || 0,
      headingDeg: normDeg(this.yaw),
      region: this.regionInfo || { name: '苍岚山脉' },
      distanceKm: this.distance / 1000,
      timeSec: this.runTime,
      worldTime: this.world.time,
      preyCaught: this.preyCaught,
      satiety: this.satiety,
      bodyTemp: this.bodyTemp,
      ambientTemp: this.ambientTemp,
      env,
      condition,
      recoveryHint: this.recoveryHint,
      resting: this.resting,
      restLabel: this.restLabel,
      abilityName: this.abilityName,
      abilityCooldown: this.abilityCooldown,
      abilityCooldownMax: this.dragon.ability?.cooldown || 9,
      abilityReady: this.stamina >= 15,
      abilityNoStamina: this.stamina < 15,
      promptLand: this.promptLand,
      promptFeed: this.promptFeed,
      warning: this.warning,
      position: this.playerPos,
      minimap: {
        wildlife: this.wildlife ? this.wildlife.markers(this.playerPos) : [],
        fires: this.abilities ? this.abilities.firePositions : [],
      },
      controlsHintDim: this.runTime > 20,
      cameraMode: this.cameraMode,
      underwater: this.underwater,
    };
  }

  // getters used by the render pipeline
  get postEffects() {
    const speedNorm = clamp(this.speed / Math.max(1, this.flight?.max || 48), 0, 1.3);
    return {
      speed: this.mode === 'flight' ? Math.max(0, speedNorm - 0.25) + (this.boostActive ? 0.3 : 0) : 0,
      flash: this.flash,
      warmth: this.world.environment ? (this.world.environment.night > 0.52 ? 0.25 : (this.world.environment.sunDir.y < 0.16 ? 0.9 : 0.5)) : 1,
      underwater: this.underwater ? 1 : 0,
      night: this.world.environment?.night || 0,
      rain: this.world.environment?.rain || 0,
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
      maxStamina: this.maxStamina,
      satiety: this.satiety,
      bodyTemp: this.bodyTemp,
      environmentTemp: this.world.environment?.temperature,
      flightState: this.flightState,
      underwater: this.underwater,
      preyCaught: this.preyCaught,
      region: this.regionInfo?.id,
      yaw: this.yaw,
      pitch: this.pitch,
      roll: this.roll,
      cameraMode: this.cameraMode,
      hudVisible: this.hudVisible,
      chunks: this.world?.chunks?.size,
      weather: this.world.environment?.weatherName,
      time: this.world.environment?.clockLabel,
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


function saturatedRecovery(stamina, max) {
  return stamina < max - 0.05;
}

function restLabel(dragon, state, survival) {
  if (state === 'grounded') return dragon.id === 'ladon' ? '林间栖地 · 体力恢复' : '地面栖伏 · 体力恢复';
  if (state === 'floating') return '海面浮息 · 体力恢复';
  if (state === 'swimming') return '深水潜息 · 体力恢复';
  if (survival?.rest === 'sky') return '高空滑翔 · 缓慢回息';
  return '振翅飞行 · 缓慢回息';
}
