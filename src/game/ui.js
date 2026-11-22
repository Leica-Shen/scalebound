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
      hudFocusBtn: $('hudFocusBtn'),
      hudAutoBtn: $('hudAutoBtn'),
      betaFlag: $('betaFlag'),
      cnFlag: $('cnFlag'),
      cnOrnament: $('cnOrnament'),
      combatPanel: $('combatPanel'),
      combatTargetName: $('combatTargetName'),
      combatPlayerBar: $('combatPlayerBar'),
      combatPlayerHp: $('combatPlayerHp'),
      combatTargetBar: $('combatTargetBar'),
      combatTargetHp: $('combatTargetHp'),
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
      conditionLabel: $('conditionLabel'),
      satietyBar: $('satietyBar'),
      satietyVal: $('satietyVal'),
      tempBar: $('tempBar'),
      tempVal: $('tempVal'),
      recoveryHint: $('recoveryHint'),
      clockValue: $('clockValue'),
      dateValue: $('dateValue'),
      weatherMini: $('weatherMini'),
      distanceVal: $('distanceVal'),
      preyCount: $('preyCount'),
      timeVal: $('timeVal'),
      promptLand: $('promptLand'),
      promptLandText: $('promptLandText'),
      promptFeed: $('promptFeed'),
      promptFeedText: $('promptFeedText'),
      abilitySlot: $('abilitySlot'),
      abilityName: $('abilityName'),
      abilityState: $('abilityState'),
      abilityGlyph: $('abilityGlyph'),
      abilityCooldown: $('abilityCooldown'),
      selArchetype: $('selArchetype'),
      selRest: $('selRest'),
      selDiet: $('selDiet'),
      selAbility: $('selAbility'),
      minimap: $('minimap'),
      miniCoord: $('miniCoord'),
      mapBiome: $('mapBiome'),
      mapWeather: $('mapWeather'),
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
      pausePrey: $('pausePrey'),
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
    this.el.mapWeather.textContent = '晴 · 18°';
  }

  setChina(on) {
    document.documentElement.classList.toggle('is-cn', !!on);
    if (this.el.cnFlag) this.el.cnFlag.classList.toggle('is-hidden', !on);
    if (this.el.cnOrnament) this.el.cnOrnament.classList.toggle('is-hidden', !on);
    if (!on) return;
    const eyebrow = document.querySelector('.eyebrow');
    if (eyebrow) eyebrow.innerHTML = '<span class="eyebrow-dot"></span>山河龙谱<i></i>EIGHT DRAGON SCROLL';
    const tagline = document.querySelector('.tagline');
    if (tagline) tagline.textContent = '一卷山河，八龙入画。以水墨为骨，以龙吟为声。';
    const ribbon = document.querySelector('.menu-ribbon span');
    if (ribbon) ribbon.textContent = '山河入卷 · 八龙行天';
    const kicker = document.querySelector('.loader-kicker');
    if (kicker) kicker.textContent = 'THE EIGHT DRAGON SCROLL';
    const center = document.querySelector('.menu-footer .footer-center');
    if (center) center.textContent = '山 河 无 尽 · 笔 墨 有 灵';
    const start = document.querySelector('#startBtn .start-label');
    if (start) start.innerHTML = '<small>ENTER THE SCROLL</small>启 程';
    const random = document.getElementById('randomBtn');
    if (random) random.innerHTML = '<span>随 缘</span>';
    document.title = '鳞界 · 山河龙谱 C5 · SCALEBOUND';
  }

  setBeta(on) {
    document.documentElement.classList.toggle('is-beta', !!on);
    document.documentElement.classList.toggle('is-f', !!on);
    [this.el.betaFlag, ...document.querySelectorAll('.beta-only')].forEach((el) => el?.classList.toggle('is-hidden', !on));
    if (!on) this.el.combatPanel?.classList.add('is-hidden');
  }

  setAutoFlight(on) {
    this.el.hudAutoBtn?.classList.toggle('is-active', !!on);
    if (this.el.hudAutoBtn) this.el.hudAutoBtn.title = on ? '自由飞行：开 (B)' : '自由飞行：关 (B)';
  }

  setCombatState({ health = 100, target = null, auto = false } = {}) {
    const panel = this.el.combatPanel;
    if (!panel) return;
    const show = document.documentElement.classList.contains('is-beta') && (auto || !!target);
    panel.classList.toggle('is-hidden', !show);
    if (!show) return;
    const hp = Math.max(0, Math.round(health));
    this.el.combatPlayerBar.style.width = `${hp}%`;
    this.el.combatPlayerHp.textContent = String(hp);
    this.el.combatTargetName.textContent = target ? `${target.name} · ${Math.round(target.distance)}m` : '无目标 · X 锁定';
    this.el.combatTargetBar.style.width = target ? `${Math.max(0, Math.round(target.hp / target.maxHp * 100))}%` : '0%';
    this.el.combatTargetHp.textContent = target ? String(Math.max(0, Math.round(target.hp))) : '--';
  }

  setFocusMode(on) {
    this.el.hud.classList.toggle('is-focus', !!on);
    if (this.el.hudFocusBtn) {
      this.el.hudFocusBtn.classList.toggle('is-active', !!on);
      this.el.hudFocusBtn.style.opacity = on ? '1' : '';
      this.el.hudFocusBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
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
    this.el.hudFocusBtn?.addEventListener('click', () => this._emit('onToggleHudFocus'));
    this.el.hudAutoBtn?.addEventListener('click', () => this._emit('onToggleAutoFlight'));
    this.el.helpBtn.addEventListener('click', () => this._emit('onHelpRequested'));
    this.el.prevBtn.addEventListener('click', () => this._emit('onCycle', -1));
    this.el.nextBtn.addEventListener('click', () => this._emit('onCycle', 1));
    this.el.randomBtn.addEventListener('click', () => this._emit('onRandom'));
    this.el.hudPauseBtn.addEventListener('click', () => this._emit('onPause'));
    if (this.el.abilitySlot) this.el.abilitySlot.addEventListener('click', () => this._emit('onAbility'));
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
    const archLabel = dragon.archetype === 'eastern' ? '东方龙' : (dragon.archetype === 'western' ? '西方龙' : '蛇翼龙');
    const rest = dragon.survival?.rest;
    const restLabel = rest === 'water' ? '水面' : (rest === 'sky' ? '高空' : (rest === 'forest' ? '林间' : (rest === 'any' ? '全地形' : '地面')));
    const dietNames = { fish: '游鱼', birds: '飞鸟', sheep: '岩羊' };
    let dietLabel = (dragon.survival?.diet || []).map((d) => dietNames[d]).join(' · ');
    if (!dietLabel) dietLabel = '云露 · 日光';
    this.el.selArchetype.textContent = archLabel;
    this.el.selRest.textContent = restLabel;
    this.el.selDiet.textContent = dietLabel;
    this.el.selAbility.textContent = dragon.ability?.name || '龙赋';
    this.el.abilityName.textContent = dragon.ability?.name || '龙赋';
    this.el.abilityGlyph.textContent = dragon.ability?.name?.[0] || dragon.glyph;


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
      this._updateSpeedFx(state);
      return;
    }
    this.hudTimer = 0;

    this._field('speedVal', String(Math.round(state.speed || 0)).padStart(3, '0'));
    this._field('altitudeVal', String(Math.round(state.altitude || 0)));
    this._field('liftVal', String(Math.round(state.lift ?? 0)));
    this._field('distanceVal', (state.distanceKm || 0).toFixed(1));
    this._field('preyCount', String(state.preyCaught || 0));
    this._field('timeVal', formatTime(state.timeSec || 0));
    this._field('clockValue', state.env?.clock || '--:--');
    this._field('dateValue', `${state.env?.date || '—'} · ${state.env?.seasonName || '—'}`);
    this._field('weatherMini', `${state.env?.weatherName || '晴'} ${Math.round(state.env?.temperature ?? 18)}°`);
    this._field('conditionLabel', state.condition || '翱翔');
    this._field('recoveryHint', state.recoveryHint || '滑翔 · 缓慢回息');
    const sat = Math.max(0, Math.min(100, state.satiety ?? 100));
    this.el.satietyBar.style.width = `${sat}%`;
    this._field('satietyVal', String(Math.round(sat)));
    const bodyTemp = state.bodyTemp ?? 36.5;
    this._field('tempVal', `${bodyTemp.toFixed(1)}°`);
    const tPct = Math.max(0, Math.min(100, (bodyTemp - 28) / 14 * 100));
    this.el.tempBar.style.width = `${tPct}%`;
    this.el.tempBar.classList.toggle('is-cold', bodyTemp < 34.4);
    this.el.tempBar.classList.toggle('is-hot', bodyTemp > 39.2);
    this.el.abilityName.textContent = state.abilityName || this.dragon.ability?.name || '龙赋';
    const cd = Math.max(0, state.abilityCooldown || 0);
    const cdMax = Math.max(0.1, state.abilityCooldownMax || 9);
    this.el.abilityCooldown.style.width = cd > 0.05 ? `${(1 - cd / cdMax) * 100}%` : '0%';
    if (cd > 0.05) {
      this._field('abilityState', `${cd.toFixed(1)}s`);
      this.el.abilitySlot.classList.add('is-cooldown');
    } else {
      this._field('abilityState', state.abilityReady === false ? '未就绪' : '就绪');
      this.el.abilitySlot.classList.remove('is-cooldown');
    }
    this.el.abilitySlot.classList.toggle('is-warning', !!state.abilityNoStamina);
    const showE = !!state.promptLand;
    const showQ = !!state.promptFeed;
    this.el.promptLand.classList.toggle('is-hidden', !showE);
    this.el.promptFeed.classList.toggle('is-hidden', !showQ);
    if (showE) this.el.promptLandText.textContent = state.promptLand;
    if (showQ) this.el.promptFeedText.textContent = state.promptFeed;
    this._field('mapWeather', `${state.env?.weatherName || '晴'} · ${Math.round(state.env?.temperature ?? 18)}°`);
    this._field('miniCoord', `${Math.round(state.position?.x || 0)} : ${Math.round(state.position?.z || 0)}`);
    this._field('mapBiome', state.region?.name || '未知之地');

    const staminaMax = Math.max(1, state.maxStamina || 100);
    const stamina = Math.max(0, Math.min(staminaMax, state.stamina ?? staminaMax));
    const staminaPct = stamina / staminaMax * 100;
    const staminaDisplay = Math.round(stamina);
    this.el.staminaBar.style.width = `${staminaPct}%`;
    this.el.staminaGhost.style.width = `${staminaPct}%`;
    this.el.staminaBar.classList.toggle('is-low', staminaPct < 24);
    this._field('staminaText', String(staminaDisplay));
    if (state.resting) {
      this._field('boostState', state.restLabel || '栖地回息');
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
    this._field('windState', state.env ? `${state.env.weatherName} · ${state.env.seasonName}` : '顺风');

    const lit = Math.round(Math.min(1, (state.speed || 0) / Math.max(1, state.maxSpeed || 50)) * 20);
    for (let i = 0; i < this.speedTickEls.length; i++) {
      const el = this.speedTickEls[i];
      const isLit = i < lit;
      const isHot = isLit && i >= 16;
      if (el._lit !== isLit) { el.classList.toggle('is-lit', isLit); el._lit = isLit; }
      if (el._hot !== isHot) { el.classList.toggle('is-hot', isHot); el._hot = isHot; }
    }


    if (state.warning) {
      this.el.warning.classList.add('is-live');
      this.el.warning.querySelector('span').textContent = state.warning;
    } else {
      this.el.warning.classList.remove('is-live');
    }

    this._updateSpeedFx(state);

    // minimap at ~4 Hz
    if (this.miniTimer > 0.28 && state.position) {
      this.miniTimer = 0;
      this._drawMinimap(state);
    }

    if (state.controlsHintDim) this.el.controlRibbon.classList.add('is-dim');
    else this.el.controlRibbon.classList.remove('is-dim');
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
    const animalColors = { fish: '#78dbe5', birds: '#f0e1b8', sheep: '#ecd9a7' };
    if (state.minimap?.wildlife) {
      for (const a of state.minimap.wildlife) {
        const [mx, my] = mapPoint(a.x, a.z);
        if ((mx - 56) ** 2 + (my - 56) ** 2 > 52 * 52) continue;
        ctx.fillStyle = animalColors[a.type] || '#ffdc8e';
        ctx.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 2, 2);
      }
    }
    if (state.minimap?.fires) {
      ctx.fillStyle = 'rgba(255, 132, 67, 0.9)';
      for (const f of state.minimap.fires) {
        const [mx, my] = mapPoint(f.x, f.z);
        if ((mx - 56) ** 2 + (my - 56) ** 2 > 52 * 52) continue;
        ctx.fillRect(Math.round(mx) - 2, Math.round(my) - 2, 4, 4);
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
    this.el.pausePrey.textContent = String(data.preyCaught || 0).padStart(2, '0');
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
