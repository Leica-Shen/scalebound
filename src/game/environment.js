import * as THREE from 'three';

const CN = typeof window !== 'undefined' && !!window.__SCALEBOUND_CN__;
import { SEA_LEVEL, heightAt, moistureAt } from '../core/terrain.js';
import { clamp, lerp, damp } from '../core/noise.js';

const SEASONS = ['春', '夏', '秋', '冬'];
const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];
const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEATHERS = [
  { id: 'clear', name: '晴', cloud: 0.1, rain: 0, snow: 0, fog: 0.06, wind: 0.25, dark: 0, temp: 1.5 },
  { id: 'cloudy', name: '多云', cloud: 0.62, rain: 0, snow: 0, fog: 0.12, wind: 0.45, dark: 0.12, temp: -0.5 },
  { id: 'rain', name: '雨', cloud: 0.85, rain: 0.7, snow: 0, fog: 0.38, wind: 0.7, dark: 0.28, temp: -3.5 },
  { id: 'storm', name: '雷暴', cloud: 1.0, rain: 1.0, snow: 0, fog: 0.5, wind: 1.1, dark: 0.45, temp: -5.5 },
  { id: 'snow', name: '雪', cloud: 0.75, rain: 0, snow: 0.8, fog: 0.35, wind: 0.55, dark: 0.18, temp: -9 },
  { id: 'fog', name: '雾', cloud: 0.45, rain: 0, snow: 0, fog: 1.0, wind: 0.15, dark: 0.12, temp: -2 },
];
const WEATHER_INDEX = Object.fromEntries(WEATHERS.map((w, i) => [w.id, i]));
const SEASON_PRESETS = [
  { base: 16, amp: 5.5, maxElev: 55, sunrise: 6.0, sunset: 18.2, weathers: ['clear', 'cloudy', 'rain', 'fog'] },
  { base: 27, amp: 4.5, maxElev: 68, sunrise: 5.2, sunset: 19.0, weathers: ['clear', 'clear', 'cloudy', 'rain', 'storm'] },
  { base: 18, amp: 5.0, maxElev: 52, sunrise: 6.2, sunset: 17.8, weathers: ['clear', 'cloudy', 'fog', 'rain'] },
  { base: 6, amp: 4.0, maxElev: 35, sunrise: 7.0, sunset: 17.0, weathers: ['clear', 'cloudy', 'fog', 'snow', 'snow'] },
];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function seasonForMonth(month) {
  if (month >= 2 && month <= 4) return 0;
  if (month >= 5 && month <= 7) return 1;
  if (month >= 8 && month <= 10) return 2;
  return 3;
}

function makeCircleTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(8, 8, 1, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

export class Environment {
  constructor(world) {
    this.world = world;
    this.scene = world.scene;
    this.real = true;
    this.underwater = false;
    this.time = 0;
    this.flash = 0;
    this.onLightning = null;

    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    this.hourOverride = params.has('hour') ? clamp(Number(params.get('hour')) || 0, 0, 24) : null;
    this.seasonOverride = params.has('season') ? ['spring', 'summer', 'autumn', 'winter'].indexOf(params.get('season')) : -1;
    this.weatherOverride = params.has('weather') ? (WEATHER_INDEX[params.get('weather')] ?? -1) : -1;
    this.staticClock = params.has('static') || this.hourOverride !== null;
    this.forcedClearUntil = this.weatherOverride < 0 ? 85 : 0;

    const now = new Date();
    this.season = this.seasonOverride >= 0 ? this.seasonOverride : seasonForMonth(now.getMonth());
    this.weatherIndex = this.weatherOverride >= 0 ? this.weatherOverride : 0;
    this.weatherTarget = this.weatherIndex;
    this.weatherTimer = this.forcedClearUntil;
    this.day = new Date();
    this.hour = this.hourOverride ?? (now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600);
    this.minuteKey = -1;
    this.weatherSerial = 0;
    this.lightningTimer = 6;

    this.cloudiness = WEATHERS[this.weatherIndex].cloud;
    this.rain = WEATHERS[this.weatherIndex].rain;
    this.snow = WEATHERS[this.weatherIndex].snow;
    this.fogAmount = WEATHERS[this.weatherIndex].fog;
    this.windStrength = WEATHERS[this.weatherIndex].wind;
    this.darkness = WEATHERS[this.weatherIndex].dark;
    this.temperature = 20;
    this.snowCover = this.season === 3 ? 0.92 : 0;

    this.colors = {
      sun: new THREE.Color('#ffe1aa'),
      moon: new THREE.Color('#d8e8f3'),
      zenith: new THREE.Color('#407fa3'),
      horizon: new THREE.Color('#dbcaaa'),
      haze: new THREE.Color('#b8c5bd'),
      ground: new THREE.Color('#18231f'),
    };
    this.sunDir = new THREE.Vector3(0.2, 0.7, 0.4).normalize();
    this.moonDir = new THREE.Vector3(-0.2, 0.6, -0.4).normalize();
    this.night = 0;
    this.starStrength = 0;
    this.envTemp = 20;
    this.windYaw = 0.8;

    this._buildRain();
    this._buildSnow();
    this._lastAppliedSeason = -1;
  }

  _buildRain() {
    this.rainCount = 780;
    const geo = new THREE.BufferGeometry();
    this.rainPositions = new Float32Array(this.rainCount * 6);
    this.rainDrops = [];
    const rng = Math.random;
    for (let i = 0; i < this.rainCount; i++) {
      this.rainDrops.push({
        x: (rng() - 0.5) * 110, y: rng() * 90, z: (rng() - 0.5) * 110,
        len: 1.2 + rng() * 2.8, speed: 38 + rng() * 25,
      });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0xbfe0e4, transparent: true, opacity: 0, depthWrite: false, fog: true,
    }));
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    this.rainMesh.renderOrder = 5;
    this.scene.add(this.rainMesh);
    this.rainGeo = geo;
  }

  _buildSnow() {
    this.snowCount = 760;
    const geo = new THREE.BufferGeometry();
    this.snowPositions = new Float32Array(this.snowCount * 3);
    this.snowFlakes = [];
    const rng = Math.random;
    for (let i = 0; i < this.snowCount; i++) {
      this.snowFlakes.push({
        x: (rng() - 0.5) * 90, y: rng() * 60, z: (rng() - 0.5) * 90,
        speed: 1.4 + rng() * 2.3, phase: rng() * 6.28,
      });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.snowPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.snowMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xf2f6f4, size: 0.42, map: makeCircleTexture(), transparent: true,
      opacity: 0, depthWrite: false, sizeAttenuation: true, fog: true,
    }));
    this.snowMesh.frustumCulled = false;
    this.snowMesh.visible = false;
    this.snowMesh.renderOrder = 5;
    this.scene.add(this.snowMesh);
    this.snowGeo = geo;
  }

  setUnderwater(active) {
    this.underwater = !!active;
  }

  _clockTick() {
    if (this.staticClock || this.real === false) return;
    const now = new Date();
    this.day = now;
    this.hour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    this.minuteKey = now.getMinutes();
    if (this.seasonOverride < 0) {
      const s = seasonForMonth(now.getMonth());
      if (s !== this.season) {
        this.season = s;
        this.weatherTimer = Math.min(this.weatherTimer, 20);
      }
    }
  }

  _pickWeather() {
    const presets = SEASON_PRESETS[this.season];
    const pool = presets.weathers;
    const day = this.day.getDate();
    const bucket = Math.floor(this.time / 210);
    const seed = (day * 928371 + bucket * 19349 + this.weatherSerial * 7717 + this.season * 13) >>> 0;
    let h = seed;
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5; h >>>= 0;
    const next = pool[h % pool.length];
    this.weatherIndex = WEATHER_INDEX[next];
    this.weatherSerial++;
    this.weatherTimer = 180 + (h % 150);
  }

  _sunAndMoon() {
    const sp = SEASON_PRESETS[this.season];
    const hour = ((this.hour % 24) + 24) % 24;
    const dayFrac = (hour - sp.sunrise) / (sp.sunset - sp.sunrise);
    const daylight = dayFrac > 0 && dayFrac < 1;
    const elevRad = Math.sin(clamp(dayFrac, 0, 1) * Math.PI) * (sp.maxElev * Math.PI / 180);
    const yaw = Math.PI / 2 - clamp(dayFrac, 0, 1) * Math.PI;
    if (daylight) {
      _v.set(Math.sin(yaw) * Math.cos(elevRad), Math.sin(elevRad), Math.cos(yaw) * Math.cos(elevRad)).normalize();
    } else {
      // Sun below the horizon; keep it there so the sky knows it is night.
      _v.set(Math.sin(yaw) * 0.64, -0.55, Math.cos(yaw) * 0.64).normalize();
    }
    this.sunDir.copy(_v);
    this.moonDir.set(-_v.x, Math.max(0.16, -_v.y * 0.9), -_v.z).normalize();
    this.night = clamp((0.06 - _v.y) / 0.38, 0, 1);
    this.starStrength = clamp(this.night * 1.4 - this.cloudiness * 0.8, 0, 1);
  }

  _pickColors(wDark) {
    const sunElev = clamp(this.sunDir.y, 0, 1);
    const twilight = clamp(1 - Math.abs(sunElev - 0.04) / 0.3, 0, 1);
    const day = this.night >= 0.92 ? 0 : clamp(1 - this.night, 0, 1);
    const daylight = 1 - this.night;
    const horizon = this.colors.horizon.setHSL(0.09, 0.24, 0.62).lerp(new THREE.Color('#d7bb94'), 0.55);
    // Build direct colours instead of stacking too many mixes.
    this.colors.sun.set('#fff4dd').lerp(new THREE.Color('#ff9b5b'), twilight * 0.78);
    this.colors.moon.set('#c8dce9');
    this.colors.zenith.set('#2f76ad').lerp(new THREE.Color('#07172b'), this.night);
    this.colors.horizon.set('#a9d4d8').lerp(new THREE.Color('#263b52'), this.night * 0.9);
    this.colors.haze.set('#9fc7cb').lerp(new THREE.Color('#2d4156'), this.night * 0.82);
    this.colors.ground.set('#1a2421').lerp(new THREE.Color('#050b12'), this.night);
    if (twilight > 0.45) {
      this.colors.horizon.lerp(new THREE.Color('#e2945f'), twilight * 0.55);
      this.colors.haze.lerp(new THREE.Color('#c7916b'), twilight * 0.25);
    }
    const overcast = clamp(this.cloudiness * 0.72 + this.rain * 0.34 + this.fogAmount * 0.42, 0, 1);
    if (overcast > 0.01) {
      const gray = this.night > 0.5 ? new THREE.Color('#1b2836') : new THREE.Color('#819195');
      const grayLow = this.night > 0.5 ? new THREE.Color('#2d3b47') : new THREE.Color('#b3bdbb');
      this.colors.zenith.lerp(gray, overcast * 0.78);
      this.colors.horizon.lerp(grayLow, overcast * 0.58);
      this.colors.haze.lerp(grayLow, overcast * 0.72);
      this.colors.sun.lerp(new THREE.Color('#c6c6b9'), overcast * 0.45);
      this.colors.zenith.multiplyScalar(1 - overcast * 0.22);
      this.colors.horizon.multiplyScalar(1 - overcast * 0.12);
    }
    if (this.snow > 0.2) {
      this.colors.horizon.lerp(new THREE.Color('#d7dcda'), this.snow * 0.35);
      this.colors.haze.lerp(new THREE.Color('#d5d9d6'), this.snow * 0.4);
    }
    const dark = wDark * 0.5;
    this.colors.zenith.multiplyScalar(1 - dark);
    this.colors.horizon.multiplyScalar(1 - dark * 0.8);
    this.colors.haze.multiplyScalar(1 - dark * 0.8);
    this.colors.sun.multiplyScalar(1 - dark * 0.4);
  }

  _applyLighting() {
    const l = this.world.lights;
    if (!l) return;
    const focus = this.world._lastFocus || new THREE.Vector3();
    const sunY = Math.max(0, this.sunDir.y);
    const dayFactor = clamp(sunY * 3.2, 0, 1) * (1 - this.cloudiness * 0.55);
    const night = this.night;
    // A single celestial key light drives both daylight and moonlit shadows.
    const keyDir = night > 0.52 ? this.moonDir : this.sunDir;
    const keyColor = night > 0.52 ? new THREE.Color('#a8caed') : this.colors.sun;
    const keyIntensity = night > 0.52 ? night * 1.2 * (1 - this.cloudiness * 0.42) : dayFactor * 3.8;
    l.sun.color.copy(keyColor);
    l.sun.intensity = keyIntensity;
    l.sun.position.copy(focus).addScaledVector(keyDir, 320);
    l.sun.target.position.copy(focus);
    l.sun.target.updateMatrixWorld();
    if (l.moon) l.moon.intensity = 0;
    l.hemi.color.copy(this.colors.zenith).lerp(new THREE.Color('#a9d3e8'), 0.3 + this.night * 0.08);
    l.hemi.groundColor.copy(this.night > 0.5 ? new THREE.Color('#0c1722') : new THREE.Color('#5b5038'));
    l.hemi.intensity = (0.78 + dayFactor * 0.78) * (1 - this.cloudiness * 0.2);
    l.ambient.color.copy(this.colors.zenith).lerp(new THREE.Color('#b8d4e2'), night * 0.38);
    l.ambient.intensity = 0.4 + dayFactor * 0.24;
    l.fill.color.copy(this.colors.haze).lerp(new THREE.Color('#6795b8'), 0.35);
    l.fill.intensity = 0.28 + dayFactor * 0.36 + night * 0.16;
    l.rim.color.copy(this.colors.sun);
    l.rim.intensity = dayFactor * 0.35 + this.night * 0.1;
    l.hero.intensity = 0.72 + (1 - dayFactor) * 0.18;
    if (CN) {
      l.sun.intensity *= 0.68;
      l.hemi.intensity = 1.15;
      l.ambient.intensity = 0.64;
      l.fill.intensity = 0.55;
      l.rim.intensity *= 0.55;
    }
    if (this.underwater) {
      // Clear, readable lagoon light: enough ambient to read scales and seabed
      // silhouettes, with a cool fill that keeps depth without going pitch dark.
      l.sun.intensity *= 0.32;
      l.hemi.intensity *= 0.82;
      l.ambient.intensity *= 0.9;
      l.hemi.color.set('#5ac6d8');
      l.fill.color.set('#3dabc4');
      l.fill.intensity = 1.0;
      l.rim.color.set('#7ee8f1');
      l.rim.intensity = 0.28;
    }
    if (this.world.renderer) {
      const exposure = this.underwater ? 1.36 : (CN ? 1.24 : (1.34 + this.night * 0.16 + this.rain * 0.04));
      this.world.renderer.toneMappingExposure = exposure;
    }
  }

  _applyWorld() {
    const w = this.world;
    if (CN) {
      // The C edition reads as a hanging scroll: warm paper light, mineral
      // ink-wash colour and long atmospheric layers rather than crisp noon.
      this.colors.zenith.set('#b9c7c5');
      this.colors.horizon.set('#efe5cf');
      this.colors.haze.set('#d9cfb9');
      this.colors.sun.set('#d9bd89');
      this.cloudiness = Math.max(this.cloudiness, 0.18);
    }
    const fog = this.scene.fog;
    const wet = this.rain * 0.4 + this.snow * 0.17 + this.fogAmount * 0.9;
    if (this.underwater) {
      w.sky.mesh.visible = false;
      if (w.waterMesh) w.waterMesh.visible = false;
      this.scene.background = this.scene.background || new THREE.Color('#073a4d');
      this.scene.background.set('#073a4d');
      w.fogNearTarget = 16;
      w.fogFarTarget = 215 - this.fogAmount * 34;
      w.fogColorTarget = new THREE.Color('#0a5061');
      w.sky.mesh.visible = false;
    } else {
      w.sky.mesh.visible = true;
      if (w.waterMesh) w.waterMesh.visible = true;
      this.scene.background = null;
      w.fogNearTarget = 440 - this.fogAmount * 280 - this.rain * 180 - this.snow * 200;
      w.fogFarTarget = 1600 - this.fogAmount * 950 - this.rain * 500 - this.snow * 500;
      const haze = this.colors.haze.clone();
      if (this.fogAmount > 0.2) haze.lerp(new THREE.Color('#d4d6c9').multiplyScalar(1 - this.night * 0.8), this.fogAmount * 0.35);
      if (this.rain > 0.1) haze.multiplyScalar(1 - this.rain * 0.18);
      w.fogColorTarget = haze;
    }
    if (CN && !this.underwater) {
      w.fogNearTarget = 280;
      w.fogFarTarget = 1180;
      w.fogColorTarget = new THREE.Color('#ded4bf');
    }
    w.sky.applyEnvironment(this);
    w.sky.materials?.clouds?.forEach?.((m) => {
      m.opacity = 0.18 + this.cloudiness * 0.3;
    });
    if (w.clouds) {
      const tint = this.night > 0.5 ? 0x58616d : (this.rain > 0.25 ? 0xaeb6b3 : 0xffe6c8);
      for (const c of w.clouds) {
        c.sprite.visible = !this.underwater;
        c.sprite.material.opacity = this.underwater ? 0 : 0.16 + this.cloudiness * 0.4;
        c.sprite.material.color.lerp(new THREE.Color(tint), 0.03);
      }
    }
    if (w.waterMaterial) {
      const u = w.waterMaterial.uniforms;
      if (u.uSkyColor) u.uSkyColor.value.copy(this.colors.horizon).lerp(this.colors.zenith, 0.35);
      if (u.uSunColor) u.uSunColor.value.copy(this.colors.sun);
      if (u.uUnderwater) u.uUnderwater.value = this.underwater ? 1 : 0;
    }
    if (w.setSeason) w.setSeason(this.season, this.snowCover);
    if (w.setWind) w.setWind(this.windStrength, this.windYaw);
    this._applyLighting();
  }

  update(dt, time, focusPos, camera, mode = 'flight') {
    this.time = time;
    if (this.weatherOverride >= 0) {
      this.weatherIndex = this.weatherOverride;
      this.weatherTimer = 99999;
    } else if (time > this.weatherTimer) {
      this._pickWeather();
    }
    this._clockTick();
    this._sunAndMoon();
    const wp = WEATHERS[this.weatherIndex];
    const transition = 1 - Math.exp(-0.12 * dt);
    this.cloudiness = lerp(this.cloudiness, wp.cloud, transition);
    this.rain = lerp(this.rain, this.underwater ? 0 : wp.rain, transition);
    this.snow = lerp(this.snow, this.underwater ? 0 : wp.snow, transition);
    this.fogAmount = lerp(this.fogAmount, wp.fog, transition);
    this.windStrength = lerp(this.windStrength, wp.wind, transition);
    this.darkness = lerp(this.darkness, wp.dark, transition);
    const snowSeason = (this.season === 3 ? 1 : 0) + this.snow * 0.8;
    this.snowCover = lerp(this.snowCover, clamp(snowSeason, 0, 1), dt * 0.13);
    const sp = SEASON_PRESETS[this.season];
    const hour = this.hour;
    const minuteKey = Math.floor(hour * 60);
    if (minuteKey !== this.minuteKey) this.minuteKey = minuteKey;
    const altitude = Math.max(0, focusPos.y - SEA_LEVEL);
    const diurnal = -Math.cos((hour - 15) / 24 * Math.PI * 2) * sp.amp;
    const h = heightAt(focusPos.x, focusPos.z);
    const m = moistureAt(focusPos.x, focusPos.z);
    const biome = h < SEA_LEVEL + 1 ? -2.5 : (m < -0.33 ? 3.5 : (h > 72 ? -5 : 0));
    const under = this.underwater ? 8 : 0;
    this.envTemp = sp.base + diurnal + wp.temp + biome - altitude * 0.0062 + under;
    this.temperature = Math.round(this.envTemp * 10) / 10;
    this._pickColors(this.darkness);
    this._applyWorld();
    this._updateWeatherParticles(dt, camera);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3.5);
    if (this.world.sky?.material?.uniforms?.uLightning) {
      this.world.sky.material.uniforms.uLightning.value = this.flash;
    }
    if (this.rain > 0.3 && !this.underwater) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0 && this.weatherIndex === 3) {
        this.lightningTimer = 4.5 + Math.random() * 8;
        this.flash = 0.8 + Math.random() * 0.4;
        if (this.onLightning) this.onLightning();
      }
    }
  }

  _updateWeatherParticles(dt, camera) {
    const cam = camera.position;
    const wind = this.windStrength;
    if (this.rain > 0.015 && !this.underwater) {
      this.rainMesh.visible = true;
      this.rainMesh.material.opacity = this.rain * 0.72;
      const positions = this.rainPositions;
      for (let i = 0; i < this.rainCount; i++) {
        const d = this.rainDrops[i];
        d.y -= d.speed * dt;
        d.x += wind * 9 * dt;
        if (d.y < 0) {
          d.y = 70 + Math.random() * 20;
          d.x = (Math.random() - 0.5) * 110;
          d.z = (Math.random() - 0.5) * 110;
        }
        const px = cam.x + d.x;
        const pz = cam.z + d.z;
        const py = cam.y + d.y - 25;
        const i6 = i * 6;
        positions[i6] = px;
        positions[i6 + 1] = py;
        positions[i6 + 2] = pz;
        positions[i6 + 3] = px - wind * 1.2;
        positions[i6 + 4] = py + d.len;
        positions[i6 + 5] = pz;
      }
      this.rainGeo.attributes.position.needsUpdate = true;
    } else this.rainMesh.visible = false;

    if (this.snow > 0.02 && !this.underwater) {
      this.snowMesh.visible = true;
      this.snowMesh.material.opacity = this.snow * 0.95;
      const positions = this.snowPositions;
      for (let i = 0; i < this.snowCount; i++) {
        const f = this.snowFlakes[i];
        f.y -= f.speed * dt;
        f.phase += dt * 0.9;
        f.x += (wind * 2.2 + Math.sin(f.phase) * 0.6) * dt;
        if (f.y < 0) {
          f.y = 48 + Math.random() * 20;
          f.x = (Math.random() - 0.5) * 90;
          f.z = (Math.random() - 0.5) * 90;
        }
        positions[i * 3] = cam.x + f.x;
        positions[i * 3 + 1] = cam.y + f.y - 18;
        positions[i * 3 + 2] = cam.z + f.z;
      }
      this.snowGeo.attributes.position.needsUpdate = true;
    } else this.snowMesh.visible = false;
  }

  get clockLabel() {
    const total = Math.floor((this.hour % 24) * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  get dateLabel() {
    const d = this.day || new Date();
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  get seasonName() { return ['春', '夏', '秋', '冬'][this.season]; }
  get weatherName() { return WEATHERS[this.weatherIndex]?.name || '晴'; }
  get state() {
    return {
      hour: this.hour,
      clock: this.clockLabel,
      date: this.dateLabel,
      season: this.season,
      seasonName: this.seasonName,
      weather: this.weatherIndex,
      weatherName: this.weatherName,
      rain: this.rain,
      snow: this.snow,
      cloud: this.cloudiness,
      fog: this.fogAmount,
      wind: this.windStrength,
      windYaw: this.windYaw,
      temperature: this.temperature,
      underwater: this.underwater,
      lightning: this.flash,
      night: this.night,
    };
  }

  flashLightning() {
    this.flash = Math.min(1.2, this.flash + 0.9);
  }
}
