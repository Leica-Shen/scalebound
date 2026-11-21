import { heightAt, moistureAt } from '../core/terrain.js';

const TICK_W = 22;
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class UI {
  constructor(catalog) {
    this.catalog = catalog;
    this.callbacks = {};
    this.selectedIndex = 0;
    this.dragon = catalog[0];
    this.transitioning = false;
    this.hudTimer = 0;
    this.miniTimer = 0;
    this.biomeTimer = null;
    this.toastTimeouts = [];
    this.menuReady = false;
    this.soundOn = true;
    this._last = {};

    this.el = {
      loader: $('loader'),
      loaderBar: $('loaderBar'),
      loaderPct: $('loaderPct'),
      loaderStatus: $('loaderStatus'),
      menu: $('menu'),
      menuCopy: $('menuCopy'),
      hud: $('hud'),
      startBtn: $('startBtn'),
      audioBtn: $('audioBtn'),
      hudAudioBtn: $('hudAudioBtn'),
      helpBtn: $('helpBtn'),
      prevBtn: $('prevBtn'),
      nextBtn: $('nextBtn'),
      randomBtn: $('randomBtn'),
      dragonList: $('dragonList'),
      selIndex: $('selIndex'),
      selRoman: $('selRoman'),
      selTitle: $('selTitle'),
      selName: $('selName'),
      selEn: $('selEn'),
      selLoreMark: $('selLoreMark'),
      selQuote: $('selQuote'),
      selDesc: $('selDesc'),
      traitName: $('traitName'),
      traitDesc: $('traitDesc'),
      statSpeed: $('statSpeed'),
      statAgility: $('statAgility'),
      statEndurance: $('statEndurance'),
      statMajesty: $('statMajesty'),
      statSpeedVal: $('statSpeedVal'),
      statAgilityVal: $('statAgilityVal'),
      statEnduranceVal: $('statEnduranceVal'),
      statMajestyVal: $('statMajestyVal'),
      seedLabel: $('seedLabel'),
      asideCoord: $('asideCoord'),
      hudCrest: $('hudCrest'),
      hudTitle: $('hudTitle'),
      hudName: $('hudName'),
      hudTrait: $('hudTrait'),
      compassStrip: $('compassStrip'),
      compassHeading: $('compassHeading'),
      regionLabel: $('regionLabel'),
      altitudeTop: $('altitudeTop'),
      speedVal: $('speedVal'),
      speedTicks: $('speedTicks'),
      altitudeVal: $('altitudeVal'),
      liftVal: $('liftVal'),
      staminaBar: $('staminaBar'),
      staminaGhost: $('staminaGhost'),
      staminaText: $('staminaText'),
      boostState: $('boostState'),
      windState: $('windState'),
      soulCount: $('soulCount'),
      soulPips: $('soulPips'),
      soulNearest: $('soulNearest'),
      soulCombo: $('soulCombo'),
      distanceVal: $('distanceVal'),
      ringCount: $('ringCount'),
      timeVal: $('timeVal'),
      minimap: $('minimap'),
      miniCoord: $('miniCoord'),
      mapBiome: $('mapBiome'),
      mapWeather: $('mapWeather'),
      targetMarker: $('targetMarker'),
      targetDistance: $('targetDistance'),
      toastLayer: $('toastLayer'),
      biomeTitle: $('biomeTitle'),
      warning: $('flightWarning'),
      controlRibbon: $('controlRibbon'),
      introCard: $('introCard'),
      introPretitle: $('introPretitle'),
      introName: $('introName'),
      introEn: $('introEn'),
      introQuote: $('introQuote'),
      introHint: $('introHint'),
      helpModal: $('helpModal'),
      pauseModal: $('pauseModal'),
      pauseSubName: $('pauseSubName'),
      pauseSouls: $('pauseSouls'),
      pauseDistance: $('pauseDistance'),
      pauseTime: $('pauseTime'),
      resumeBtn: $('resumeBtn'),
      pauseHelpBtn: $('pauseHelpBtn'),
      backMenuBtn: $('backMenuBtn'),
      transition: $('transition'),
      transitionText: $('transitionText'),
      flash: $('flash'),
      speedFx: $('speedFx'),
      hudPauseBtn: $('hudPauseBtn'),
      noWebgl: $('noWebgl'),
    };

    this._buildDragonCards();
    this._buildCompass();
    this._buildPips();
    this._buildSpeedTicks();
    this._bindEvents();
    this.miniCtx = this.el.minimap.getContext('2d');
    this.miniCtx.imageSmoothingEnabled = false;
    this.miniBuffer = document.createElement('canvas');
    this.miniBuffer.width = 56;
    this.miniBuffer.height = 56;
    this.miniBufferCtx = this.miniBuffer.getContext('2d');
    this.miniImage = this.miniBufferCtx.createImageData(56, 56);
    this.el.seedLabel.textContent = '20261121';
    this.el.mapWeather.textContent = '西风 · 3级';
  }

  setCallbacks(callbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  _emit(name, ...args) {
    const fn = this.callbacks[name];
    if (fn) fn(...args);
  }

  _bindEvents() {
    this.el.startBtn.addEventListener('click', () => this._emit('onStart'));
    this.el.audioBtn.addEventListener('click', () => this._emit('onToggleAudio'));
    this.el.hudAudioBtn.addEventListener('click', () => this._emit('onToggleAudio'));
    this.el.helpBtn.addEventListener('click', () => this._emit('onHelpRequested'));
    this.el.prevBtn.addEventListener('click', () => this._emit('onCycle', -1));
    this.el.nextBtn.addEventListener('click', () => this._emit('onCycle', 1));
    this.el.randomBtn.addEventListener('click', () => this._emit('onRandom'));
    this.el.hudPauseBtn.addEventListener('click', () => this._emit('onPause'));
    this.el.resumeBtn.addEventListener('click', () => this._emit('onResume'));
    this.el.pauseHelpBtn.addEventListener('click', () => this._emit('onPauseHelpRequested'));
    this.el.backMenuBtn.addEventListener('click', () => this._emit('onBackToMenu'));

    for (const close of this.el.helpModal.querySelectorAll('[data-close-modal]')) {
      close.addEventListener('click', () => this._emit('onHelpCloseRequested'));
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.helpModal.classList.contains('is-hidden')) {
        e.preventDefault();
        e.stopPropagation();
        this._emit('onHelpCloseRequested');
      }
    }, true);
  }

  _buildDragonCards() {
    this.cards = [];
    this.el.dragonList.innerHTML = '';
    this.catalog.forEach((d, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dragon-chip';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', 'false');
      btn.style.setProperty('--tint', d.tint);
      btn.innerHTML = `
        <span class="chip-top"><span class="chip-num">${d.index} / ${d.roman}</span><span class="chip-glyph">${d.glyph}</span></span>
        <span class="chip-name">${d.name}</span>
        <span class="chip-en">${d.en}</span>`;
      btn.addEventListener('click', () => this._emit('onSelect', i));
      btn.addEventListener('mouseenter', () => this._emit('onHoverCard', i));
      btn.addEventListener('focus', () => this._emit('onHoverCard', i));
      this.el.dragonList.appendChild(btn);
      this.cards.push(btn);
    });
  }

  _buildCompass() {
    const frag = document.createDocumentFragment();
    this.compassTicks = [];
    for (let deg = -360; deg <= 720; deg += 15) {
      const span = document.createElement('span');
      const norm = ((deg % 360) + 360) % 360;
      let label = '';
      let cls = 'compass-tick';
      if (norm % 90 === 0) {
        label = CARDINALS[norm / 45] || '';
        cls += ' cardinal';
      } else if (norm % 45 === 0) {
        label = CARDINALS[norm / 45] || '';
        cls += ' major';
      } else if (norm % 15 === 0 && deg % 3 === 0) {
        label = String(norm).padStart(3, '0');
      }
      span.className = cls;
      span.textContent = label;
      frag.appendChild(span);
      this.compassTicks.push({ deg, el: span });
    }
    this.el.compassStrip.appendChild(frag);
    this.compassZeroIndex = 24; // -360..0 step 15
    this.heading = 0;
  }

  _buildPips() {
    this.el.soulPips.innerHTML = '';
    this.pips = [];
    for (let i = 0; i < 9; i++) {
      const pip = document.createElement('i');
      this.el.soulPips.appendChild(pip);
      this.pips.push(pip);
    }
  }

  _buildSpeedTicks() {
    this.el.speedTicks.innerHTML = '';
    this.speedTickEls = [];
    for (let i = 0; i < 20; i++) {
      const t = document.createElement('i');
      this.el.speedTicks.appendChild(t);
      this.speedTickEls.push(t);
    }
  }

  setSoundEnabled(on) {
    this.soundOn = on;
    this.el.audioBtn.classList.toggle('is-muted', !on);
    this.el.hudAudioBtn.classList.toggle('is-muted', !on);
    this.el.hudAudioBtn.style.opacity = on ? '' : '0.5';
  }

  setLoading(progress, status = '') {
    const pct = Math.max(0, Math.min(1, progress));
    this.el.loaderBar.style.width = `${(pct * 100).toFixed(1)}%`;
    this.el.loaderPct.textContent = `${pad2(Math.round(pct * 100))}%`;
    if (status) this.el.loaderStatus.textContent = status;
  }

  revealMenu() {
    this.el.loader.classList.add('is-hidden');
    this.el.menu.classList.remove('is-hidden');
    this.el.menu.classList.add('is-ready');
    this.menuReady = true;
  }

  setAsideCoord(x, z) {
    this.el.asideCoord.textContent = `X ${Math.round(x).toString().padStart(4, '0')} · Z ${Math.round(z).toString().padStart(4, '0')}`;
  }

  selectIndex(index, { scroll = true } = {}) {
    const i = ((index % this.catalog.length) + this.catalog.length) % this.catalog.length;
    const dragon = this.catalog[i];
    this.selectedIndex = i;
    this.dragon = dragon;
    document.documentElement.style.setProperty('--accent', dragon.tint);
    document.documentElement.style.setProperty('--accent-rgb', dragon.tintRgb);

    this.cards.forEach((card, ci) => {
      const active = ci === i;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (scroll) {
      const card = this.cards[i];
      const list = this.el.dragonList;
      const target = card.offsetLeft - list.clientWidth / 2 + card.clientWidth / 2;
      list.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
    }

    this.el.selIndex.textContent = dragon.index;
    this.el.selRoman.textContent = dragon.roman;
    this.el.selTitle.textContent = dragon.pretitle;
    this.el.selName.textContent = dragon.name;
    this.el.selEn.textContent = `${dragon.en} · ${dragon.epithet}`;
    this.el.selLoreMark.textContent = dragon.glyph;
    this.el.selQuote.textContent = dragon.quote;
    this.el.selDesc.textContent = dragon.desc;
    this.el.traitName.textContent = dragon.traitName;
    this.el.traitDesc.textContent = dragon.traitDesc;
    this.el.statSpeed.style.width = `${dragon.stats.speed}%`;
    this.el.statAgility.style.width = `${dragon.stats.agility}%`;
    this.el.statEndurance.style.width = `${dragon.stats.endurance}%`;
    this.el.statMajesty.style.width = `${dragon.stats.majesty}%`;
    this.el.statSpeedVal.textContent = dragon.stats.speed;
    this.el.statAgilityVal.textContent = dragon.stats.agility;
    this.el.statEnduranceVal.textContent = dragon.stats.endurance;
    this.el.statMajestyVal.textContent = dragon.stats.majesty;
    this.el.hudCrest.textContent = dragon.glyph;
    this.el.hudTitle.textContent = dragon.shortTitle;
    this.el.hudName.textContent = dragon.name;
    this.el.hudTrait.textContent = dragon.traitName;
    this.el.biomeTitle.querySelector('h3').textContent = '苍岚山脉';

    // Restart the detail entrance animation without bouncing the whole menu.
    if (this.menuReady) {
      const animated = [this.el.selTitle, this.el.selName, this.el.selEn, this.el.selQuote, this.el.selDesc, this.el.traitName];
      for (const el of animated) {
        el.animate(
          [{ opacity: 0.25, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 380, easing: 'cubic-bezier(.16,1,.3,1)' },
        );
      }
    }
  }

  showHud() {
    this.el.hud.classList.remove('is-hidden');
    this.el.menu.classList.add('is-hidden');
  }

  hideHud() {
    this.el.hud.classList.add('is-hidden');
  }

  showMenu() {
    this.el.menu.classList.remove('is-hidden');
    this.el.menu.classList.add('is-ready');
    this.hideHud();
    this.el.pauseModal.classList.add('is-hidden');
    this.el.helpModal.classList.add('is-hidden');
  }

  showIntro(dragon) {
    clearTimeout(this._introHideTimer);
    this.el.introPretitle.textContent = dragon.pretitle;
    this.el.introName.textContent = dragon.name;
    this.el.introEn.textContent = `${dragon.en} · ${dragon.epithet}`;
    this.el.introQuote.textContent = dragon.quote;
    this.el.introHint.textContent = '按 WASD / SPACE 唤醒双翼';
    this.el.introCard.classList.remove('is-hidden', 'is-leaving');
    this.el.introCard.classList.add('is-live');
    this.el.introCard.animate(
      [{ opacity: 0, transform: 'translate(-50%, -48%)' }, { opacity: 1, transform: 'translate(-50%, -52%)' }],
      { duration: 900, easing: 'cubic-bezier(.16,1,.3,1)' },
    );
  }

  hideIntro() {
    const card = this.el.introCard;
    if (card.classList.contains('is-hidden')) return;
    card.classList.add('is-leaving');
    clearTimeout(this._introHideTimer);
    this._introHideTimer = setTimeout(() => {
      card.classList.add('is-hidden');
      card.classList.remove('is-live', 'is-leaving');
    }, 800);
  }

  _field(id, text) {
    const el = this.el[id];
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
  }

  updateHud(state, dt = 0) {
    this.heading = ((state.headingDeg ?? 0) % 360 + 360) % 360;
    // compass is updated every frame for buttery tracking
    const idxOffset = this.heading / 15 * TICK_W;
    this.el.compassStrip.style.transform = `translateX(${-(this.compassZeroIndex * TICK_W + TICK_W / 2 + idxOffset)}px)`;
    const cardinal = CARDINALS[Math.round(this.heading / 45) % 8];
    this._field('compassHeading', `${cardinal} · ${String(Math.round(this.heading)).padStart(3, '0')}°`);
    this.el.regionLabel.textContent = state.region?.name || '苍岚山脉';
    this._field('altitudeTop', `海拔 ${Math.round(state.altitude || 0)} m`);

    this.hudTimer += dt;
    this.miniTimer += dt;
    if (this.hudTimer < 0.05) {
      this._updateTarget(state);
      this._updateSpeedFx(state);
      return;
    }
    this.hudTimer = 0;

    this._field('speedVal', String(Math.round(state.speed || 0)).padStart(3, '0'));
    this._field('altitudeVal', String(Math.round(state.altitude || 0)));
    this._field('liftVal', String(Math.round(state.lift ?? 0)));
    this._field('distanceVal', (state.distanceKm || 0).toFixed(1));
    this._field('ringCount', String(state.rings || 0));
    this._field('timeVal', formatTime(state.timeSec || 0));
    this._field('soulCount', pad2(state.souls || 0));
    this._field('soulNearest', state.nearestSoulDist != null && isFinite(state.nearestSoulDist)
      ? `${Math.max(0, Math.round(state.nearestSoulDist))} m` : '— m');
    this._field('miniCoord', `${Math.round(state.position?.x || 0)} : ${Math.round(state.position?.z || 0)}`);
    this._field('mapBiome', state.region?.name || '未知之地');

    const stamina = Math.max(0, Math.min(100, state.stamina ?? 100));
    const staminaDisplay = Math.round(stamina);
    this.el.staminaBar.style.width = `${stamina}%`;
    this.el.staminaGhost.style.width = `${stamina}%`;
    this.el.staminaBar.classList.toggle('is-low', stamina < 24);
    this._field('staminaText', String(staminaDisplay));
    if (state.ringBlessing > 0) {
      this._field('boostState', '风环祝福 ' + Math.ceil(state.ringBlessing) + 's');
      this.el.boostState.classList.add('is-active');
      this.el.boostState.classList.remove('is-empty');
    } else if (state.boostActive) {
      this._field('boostState', '疾风 · 喷射中');
      this.el.boostState.classList.add('is-active');
      this.el.boostState.classList.remove('is-empty');
    } else if (stamina < 10) {
      this._field('boostState', '耐力不足');
      this.el.boostState.classList.remove('is-active');
      this.el.boostState.classList.add('is-empty');
    } else {
      this._field('boostState', '疾风就绪');
      this.el.boostState.classList.remove('is-active', 'is-empty');
    }
    this._field('windState', state.boosting ? '疾风 +2.40' : `顺风 +${(state.wind || 0).toFixed(2)}`);

    const lit = Math.round(Math.min(1, (state.speed || 0) / Math.max(1, state.maxSpeed || 50)) * 20);
    for (let i = 0; i < this.speedTickEls.length; i++) {
      const el = this.speedTickEls[i];
      const isLit = i < lit;
      const isHot = isLit && i >= 16;
      if (el._lit !== isLit) { el.classList.toggle('is-lit', isLit); el._lit = isLit; }
      if (el._hot !== isHot) { el.classList.toggle('is-hot', isHot); el._hot = isHot; }
    }

    const pipsLit = Math.min(9, state.souls || 0);
    for (let i = 0; i < this.pips.length; i++) this.pips[i].classList.toggle('is-lit', i < pipsLit);

    const combo = state.combo || 1;
    if (combo > 1.01) {
      this.el.soulCombo.classList.add('is-live');
      this.el.soulCombo.querySelector('b').textContent = `×${combo.toFixed(1)}`;
    } else {
      this.el.soulCombo.classList.remove('is-live');
    }

    if (state.warning) {
      this.el.warning.classList.add('is-live');
      this.el.warning.querySelector('span').textContent = state.warning;
    } else {
      this.el.warning.classList.remove('is-live');
    }

    this._updateTarget(state);
    this._updateSpeedFx(state);

    // minimap at ~4 Hz
    if (this.miniTimer > 0.28 && state.position) {
      this.miniTimer = 0;
      this._drawMinimap(state);
    }

    if (state.controlsHintDim) this.el.controlRibbon.classList.add('is-dim');
    else this.el.controlRibbon.classList.remove('is-dim');
  }

  _updateTarget(state) {
    const t = state.target;
    const el = this.el.targetMarker;
    if (!t || !t.visible) {
      el.classList.add('is-hidden');
      return;
    }
    el.classList.remove('is-hidden');
    el.style.left = `${t.x}px`;
    el.style.top = `${t.y}px`;
    el.classList.toggle('is-offscreen', !!t.offscreen);
    el.classList.toggle('is-near', !!t.near);
    this.el.targetDistance.textContent = t.distance != null ? `${Math.round(t.distance)}m` : '—';
  }

  _updateSpeedFx(state) {
    const intensity = Math.max(0, Math.min(1, ((state.speed || 0) - (state.maxSpeed || 50) * 0.62) / 28));
    const boost = state.boosting ? 0.2 : 0;
    this.el.speedFx.style.opacity = String(Math.max(0, intensity * 0.45 + boost));
  }

  _drawMinimap(state) {
    const ctx = this.miniCtx;
    const bctx = this.miniBufferCtx;
    const img = this.miniImage;
    const data = img.data;
    const N = 56;
    const radius = 1300;
    const p = state.position;
    if (!p) return;
    const step = (radius * 2) / (N - 1);
    const heights = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = p.x + (i / (N - 1) - 0.5) * radius * 2;
        const z = p.z - (j / (N - 1) - 0.5) * radius * 2;
        heights[j * N + i] = heightAt(x, z);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const h = heights[j * N + i];
        let r, g, b;
        if (h < 0) {
          const d = Math.min(1, -h / 80);
          r = 15 + (1 - d) * 10; g = 44 + (1 - d) * 24; b = 60 + (1 - d) * 20;
          if (h > -5) { r = 92; g = 112; b = 88; }
        } else if (h < 2.4) {
          r = 172; g = 153; b = 104;
        } else if (h > 74) {
          r = 212; g = 211; b = 197;
        } else if (h > 48) {
          r = 108; g = 101; b = 82;
        } else {
          const x = p.x + (i / (N - 1) - 0.5) * radius * 2;
          const z = p.z - (j / (N - 1) - 0.5) * radius * 2;
          const m = moistureAt(x, z);
          if (m < -0.34) { r = 146; g = 121; b = 80; }
          else if (m > 0.12) { r = 62; g = 91; b = 57; }
          else { r = 98; g = 124; b = 69; }
          const hl = i > 0 ? h - heights[j * N + i - 1] : 0;
          const hs = 1 + Math.max(-0.22, Math.min(0.22, hl * 0.09));
          r *= hs; g *= hs; b *= hs;
        }
        const idx = (j * N + i) * 4;
        data[idx] = Math.max(0, Math.min(255, r));
        data[idx + 1] = Math.max(0, Math.min(255, g));
        data[idx + 2] = Math.max(0, Math.min(255, b));
        data[idx + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, 112, 112);
    ctx.save();
    ctx.beginPath();
    ctx.arc(56, 56, 55, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.miniBuffer, 0, 0, 112, 112);

    // objective dots
    const mapPoint = (x, z) => [56 + ((x - p.x) / radius) * 55, 56 - ((z - p.z) / radius) * 55];
    if (state.minimap?.orbs) {
      ctx.fillStyle = '#ffdc8e';
      for (const orb of state.minimap.orbs) {
        const [mx, my] = mapPoint(orb.x, orb.z);
        if ((mx - 56) ** 2 + (my - 56) ** 2 > 52 * 52) continue;
        ctx.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 2, 2);
      }
    }
    if (state.minimap?.rings) {
      ctx.strokeStyle = 'rgba(125, 240, 211, 0.78)';
      ctx.lineWidth = 1;
      for (const ring of state.minimap.rings) {
        if (ring.disabledUntil > (state.worldTime ?? state.timeSec)) continue;
        const [mx, my] = mapPoint(ring.x, ring.z);
        if ((mx - 56) ** 2 + (my - 56) ** 2 > 52 * 52) continue;
        ctx.beginPath();
        ctx.arc(Math.round(mx), Math.round(my), 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // player arrow
    ctx.translate(56, 56);
    ctx.rotate(this.heading * Math.PI / 180);
    ctx.fillStyle = '#fff1c9';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(0, 3);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // soft inner vignette
    const grad = ctx.createRadialGradient(56, 56, 30, 56, 56, 56);
    grad.addColorStop(0, 'rgba(3,9,9,0)');
    grad.addColorStop(1, 'rgba(3,9,9,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 112, 112);
    ctx.strokeStyle = 'rgba(232,219,190,0.18)';
    ctx.beginPath();
    ctx.arc(56, 56, 55, 0, Math.PI * 2);
    ctx.stroke();
  }

  announceBiome(data) {
    const el = this.el.biomeTitle;
    el.querySelector('span').textContent = 'NOW ENTERING';
    el.querySelector('h3').textContent = data.name;
    el.querySelector('p').textContent = data.sub;
    el.classList.add('is-live');
    clearTimeout(this.biomeTimer);
    this.biomeTimer = setTimeout(() => el.classList.remove('is-live'), 3800);
    this._field('regionLabel', data.name);
    this._field('mapBiome', data.name);
  }

  toast(text, { duration = 2600, strong = false } = {}) {
    const el = document.createElement('div');
    el.className = 'toast';
    const dot = document.createElement('i');
    el.appendChild(dot);
    const span = document.createElement('span');
    if (strong) {
      const b = document.createElement('b');
      b.textContent = text;
      span.appendChild(b);
    } else {
      span.textContent = text;
    }
    el.appendChild(span);
    this.el.toastLayer.appendChild(el);
    while (this.el.toastLayer.children.length > 3) {
      this.el.toastLayer.firstElementChild.remove();
    }
    const timeout = setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 380);
    }, duration);
    this.toastTimeouts.push(timeout);
    if (this.toastTimeouts.length > 16) this.toastTimeouts.shift();
  }

  flash(strength = 0.35, duration = 260) {
    this.el.flash.animate(
      [{ opacity: strength }, { opacity: 0 }],
      { duration, easing: 'ease-out' },
    );
  }

  showWarning(text) {
    // deprecated in favour of state.warning; kept for API completeness
    this.el.warning.classList.add('is-live');
    this.el.warning.querySelector('span').textContent = text;
  }

  openHelp() {
    this.el.helpModal.classList.remove('is-hidden');
  }

  closeHelp() {
    this.el.helpModal.classList.add('is-hidden');
  }

  openPause(data) {
    this.el.pauseSubName.textContent = `${data.dragon.name} · ${data.region}`;
    this.el.pauseSouls.textContent = String(data.souls).padStart(2, '0');
    this.el.pauseDistance.innerHTML = `${data.distanceKm.toFixed(1)}<small>km</small>`;
    this.el.pauseTime.textContent = formatTime(data.timeSec);
    this.el.pauseModal.classList.remove('is-hidden');
  }

  closePause() {
    this.el.pauseModal.classList.add('is-hidden');
  }

  async transition(callback, text = '缔 结 龙 契') {
    if (this.transitioning) return;
    this.transitioning = true;
    const tr = this.el.transition;
    this.el.transitionText.textContent = text;
    tr.classList.remove('is-revealing');
    tr.classList.add('is-covering');
    tr.setAttribute('aria-hidden', 'false');
    await wait(620);
    if (callback) await callback();
    await wait(80);
    tr.classList.remove('is-covering');
    tr.classList.add('is-revealing');
    await wait(90);
    // remain visible while the strips peel away
    await wait(560);
    tr.classList.remove('is-revealing');
    tr.setAttribute('aria-hidden', 'true');
    this.transitioning = false;
  }

  setTouchEnabled() {
    // CSS shows the controls automatically; Game owns their input wiring.
  }
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
