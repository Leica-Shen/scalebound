// A small procedural soundscape: wind, a low drone, wing beats and the roar.
// Everything is synthesized in the browser; there are no audio files.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.enabled = true;
    this.master = null;
    this.padBus = null;
    this.windBus = null;
    this.reverb = null;
    this.delay = null;
    this.mode = 'menu';
    this._lastWind = 0;
    this._nextPluck = 0;
    this._now = 0;
    this._notes = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46];
    this._flapCooldown = 0;
  }

  async init() {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') {
        try { await this.ctx.resume(); } catch { /* ignored */ }
      }
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.started = true;
      const ctx = this.ctx;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -16;
      this.comp.knee.value = 22;
      this.comp.ratio.value = 4;
      this.comp.attack.value = 0.006;
      this.comp.release.value = 0.28;
      this.comp.connect(ctx.destination);

      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.comp);
      this.master.gain.linearRampToValueAtTime(this.enabled ? 0.7 : 0, ctx.currentTime + 1.5);

      // luscious procedural reverb
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._makeImpulse(2.8, 2.6);
      const reverbGain = ctx.createGain();
      reverbGain.gain.value = 0.34;
      this.reverb.connect(reverbGain);
      reverbGain.connect(this.master);

      // a long dotted delay for distant chimes
      this.delay = ctx.createDelay(1.2);
      this.delay.delayTime.value = 0.42;
      const fb = ctx.createGain();
      fb.gain.value = 0.26;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 2300;
      this.delay.connect(damp);
      damp.connect(fb);
      fb.connect(this.delay);
      damp.connect(reverbGain);
      this.delaySend = ctx.createGain();
      this.delaySend.gain.value = 0.22;
      this.delaySend.connect(this.delay);

      this._buildWind();
      this._buildPad();
      this._noiseBuffer = this._makeNoise(3.8);
      this._nextPluck = ctx.currentTime + 3;
    } catch (e) {
      this.started = false;
      this.ctx = null;
    }
  }

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.96 + white * 0.04;
      data[i] = last * 3.2 + white * 0.25;
    }
    return buffer;
  }

  _makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (0.55 + Math.random() * 0.45);
      }
    }
    return buffer;
  }

  _buildWind() {
    const ctx = this.ctx;
    const noise = this._makeNoise(5.2);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 740;
    low.Q.value = 0.45;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    this.windFilter = low;
    src.connect(hp);
    hp.connect(low);
    low.connect(this.windGain);
    this.windGain.connect(this.master);
    // a second, breathier gust layer
    const gust = ctx.createBufferSource();
    gust.buffer = noise;
    gust.loop = true;
    gust.playbackRate.value = 1.7;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1600;
    bp.Q.value = 0.7;
    this.gustGain = ctx.createGain();
    this.gustGain.gain.value = 0;
    gust.connect(bp);
    bp.connect(this.gustGain);
    this.gustGain.connect(this.master);
    src.start();
    gust.start();
    this.windGain.gain.value = 0.02;
  }

  _buildPad() {
    const ctx = this.ctx;
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.075;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 620;
    this.padFilter.Q.value = 0.8;
    this.padFilter.connect(this.padBus);
    this.padBus.connect(this.master);
    this.padBus.connect(this.reverb);

    const chord = [73.42, 110.0, 146.83, 220.0, 293.66];
    this.padOscillators = [];
    chord.forEach((freq, i) => {
      const g = ctx.createGain();
      g.gain.value = 0.036 / (1 + i * 0.2);
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = (i - 2) * 4.6;
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 2.006;
      const g2 = ctx.createGain();
      g2.gain.value = 0.012;
      osc.connect(g);
      osc2.connect(g2);
      g.connect(this.padFilter);
      g2.connect(this.padFilter);
      osc.start();
      osc2.start();
      this.padOscillators.push({ osc, osc2, gain: g, base: freq });
    });

    // slow filter breathing
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(this.padFilter.frequency);
    lfo.start();
  }

  setMode(mode) {
    if (!this.started) return;
    this.mode = mode;
    const now = this.ctx.currentTime;
    const menu = mode === 'menu';
    this.padBus.gain.cancelScheduledValues(now);
    this.padBus.gain.linearRampToValueAtTime(menu ? 0.095 : 0.062, now + 1.4);
    this.padFilter.frequency.cancelScheduledValues(now);
    this.padFilter.frequency.linearRampToValueAtTime(menu ? 620 : 470, now + 1.4);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.started || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(on ? 0.7 : 0.0001, now + 0.4);
  }

  setWind(speed, boosting, active = true) {
    if (!this.started) return;
    const now = this.ctx.currentTime;
    const target = active ? Math.min(0.3, speed / 60 * 0.19) : 0.0;
    this.windGain.gain.setTargetAtTime(target, now, 0.25);
    this.gustGain.gain.setTargetAtTime(active ? Math.min(0.12, speed / 80 * 0.08 + (boosting ? 0.05 : 0)) : 0, now, 0.3);
    this.windFilter.frequency.setTargetAtTime(560 + speed * 17 + (boosting ? 360 : 0), now, 0.4);
  }

  _env(gainNode, when, attack, hold, release, peak) {
    const g = gainNode.gain;
    g.cancelScheduledValues(when);
    g.setValueAtTime(0.0001, when);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
    g.setValueAtTime(Math.max(0.0002, peak), when + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, when + attack + hold + release);
  }

  _note(freq, when, duration, gain = 0.12, type = 'sine', sendDelay = false, pan = 0) {
    if (!this.started) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    const g = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) panner.pan.value = pan;
    this._env(g, when, 0.012, duration * 0.15, duration, gain);
    osc.connect(g);
    if (panner) { g.connect(panner); panner.connect(this.master); panner.connect(this.reverb); if (sendDelay) panner.connect(this.delaySend); }
    else { g.connect(this.master); g.connect(this.reverb); if (sendDelay) g.connect(this.delaySend); }
    osc.start(when);
    osc.stop(when + duration + 0.12);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.996), when + duration);
  }

  uiHover() {
    if (!this.started || !this.enabled) return;
    const now = this.ctx.currentTime;
    this._note(1040 + Math.random() * 80, now, 0.035, 0.017, 'triangle', false, 0.1);
  }

  uiClick() {
    if (!this.started || !this.enabled) return;
    const now = this.ctx.currentTime;
    this._note(660, now, 0.08, 0.055, 'triangle', false, 0.05);
    this._note(990, now + 0.045, 0.11, 0.03, 'sine', true, -0.05);
  }

  flap(strength = 1) {
    if (!this.started || !this.enabled) return;
    if (this._now - this._flapCooldown < 0.22) return;
    this._flapCooldown = this._now;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700 * strength, now);
    filter.frequency.exponentialRampToValueAtTime(160, now + 0.22);
    const g = ctx.createGain();
    this._env(g, now, 0.012, 0.04, 0.22, 0.18 * strength);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(now, Math.random() * 2, 0.45);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.22);
    const og = ctx.createGain();
    this._env(og, now, 0.01, 0.02, 0.2, 0.11 * strength);
    osc.connect(og);
    og.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  roar() {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.02;
    // throat: FM growl
    const carrier = ctx.createOscillator();
    carrier.type = 'sawtooth';
    carrier.frequency.setValueAtTime(96, now);
    carrier.frequency.exponentialRampToValueAtTime(48, now + 1.5);
    const mod = ctx.createOscillator();
    mod.frequency.setValueAtTime(39, now);
    mod.frequency.linearRampToValueAtTime(24, now + 1.4);
    const modGain = ctx.createGain();
    modGain.gain.value = 34;
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 5;
    filter.frequency.setValueAtTime(300, now);
    filter.frequency.linearRampToValueAtTime(760, now + 0.4);
    filter.frequency.exponentialRampToValueAtTime(220, now + 1.7);
    const g = ctx.createGain();
    this._env(g, now, 0.14, 0.8, 0.65, 0.36);
    carrier.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    g.connect(this.reverb);
    carrier.start(now);
    mod.start(now);
    carrier.stop(now + 1.9);
    mod.stop(now + 1.9);

    // breath / grit
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    noise.playbackRate.value = 0.75;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(340, now);
    bp.frequency.linearRampToValueAtTime(740, now + 0.45);
    bp.frequency.exponentialRampToValueAtTime(190, now + 1.65);
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    this._env(ng, now, 0.11, 0.68, 0.72, 0.16);
    noise.connect(bp);
    bp.connect(ng);
    ng.connect(this.master);
    noise.start(now, 0, 2.0);

    // high airy shriek
    const high = ctx.createOscillator();
    high.type = 'triangle';
    high.frequency.setValueAtTime(520, now);
    high.frequency.exponentialRampToValueAtTime(190, now + 1.2);
    const hg = ctx.createGain();
    this._env(hg, now, 0.4, 0.25, 0.8, 0.035);
    high.connect(hg);
    hg.connect(this.reverb);
    high.start(now);
    high.stop(now + 1.8);
  }

  collect(streak = 1) {
    if (!this.started || !this.enabled) return;
    const now = this.ctx.currentTime;
    const base = 523.25 * Math.pow(2, Math.min(2, Math.max(0, streak - 1)) / 12);
    [1, 1.25, 1.5, 2].forEach((mult, i) => {
      this._note(base * mult, now + i * 0.055, 0.5 - i * 0.05, 0.06 - i * 0.009, i % 2 ? 'triangle' : 'sine', true, (i - 1.5) * 0.12);
    });
  }

  ring() {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.playbackRate.value = 1.35;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(600, now);
    bp.frequency.exponentialRampToValueAtTime(2900, now + 0.7);
    bp.Q.value = 1.5;
    const g = ctx.createGain();
    this._env(g, now, 0.06, 0.18, 0.65, 0.1);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    g.connect(this.reverb);
    src.start(now, 0, 1.1);
    [784, 1046.5, 1318.5].forEach((f, i) => this._note(f, now + 0.02 + i * 0.06, 0.6, 0.043, 'sine', true, (i - 1) * 0.2));
  }

  groundHit(strength = 1) {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(82, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.35);
    const g = ctx.createGain();
    this._env(g, now, 0.006, 0.05, 0.32, 0.22 * Math.min(1, strength));
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.45);
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    noise.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const ng = ctx.createGain();
    this._env(ng, now, 0.008, 0.02, 0.25, 0.12 * strength);
    noise.connect(lp);
    lp.connect(ng);
    ng.connect(this.master);
    noise.start(now, 0, 0.4);
  }

  warning() {
    if (!this.started || !this.enabled) return;
    const now = this.ctx.currentTime;
    this._note(440, now, 0.08, 0.022, 'square');
  }

  startRiser() {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.playbackRate.setValueAtTime(0.5, now);
    src.playbackRate.exponentialRampToValueAtTime(1.8, now + 1.8);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(150, now);
    bp.frequency.exponentialRampToValueAtTime(3600, now + 1.8);
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    this._env(g, now, 1.2, 0.1, 0.5, 0.13);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.reverb);
    g.connect(this.master);
    src.start(now, 0, 2.2);
  }

  update(dt, { mode = 'menu', speed = 0, active = false } = {}) {
    if (!this.started) return;
    this._now += dt;
    this.setWind(speed, false, active);
    const now = this.ctx.currentTime;
    if (this._now > this._nextPluck) {
      this._nextPluck = this._now + (mode === 'menu' ? 4.5 : 6.5) + Math.random() * 4;
      if (this.enabled) {
        const freq = this._notes[Math.floor(Math.random() * this._notes.length)];
        this._note(freq * (Math.random() < 0.35 ? 2 : 1), now, 1.7, 0.023, 'sine', true, Math.random() * 0.7 - 0.35);
      }
    }
  }
}
