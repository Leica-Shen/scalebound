import { clamp, damp, lerp } from '../core/noise.js';

// A fully procedural, phase-locked animation system. Wings, neck, tail,
// claws and frills all read the same aerodynamic state, so a single flap
// travels through the whole body over a few beats.
export class DragonAnimator {
  constructor(rig) {
    this.rig = rig;
    this.time = 0;
    this.wingPhase = Math.PI * 0.5;
    this.flapEnergy = 0.3;
    this.flapImpulse = 0;
    this.roarAge = 99;
    this.roarDuration = 1.55;
    this.roarActive = false;
    this.breathAge = 99;
    this.breathDuration = 1.35;
    this.breathActive = false;
    this.blinkAmount = 1;
    this.blinkProgress = 1;
    this.nextBlink = 2.6 + Math.random() * 3.2;
    this.blinkCount = 0;

    this._look = 0;
    this.smooth = {
      turn: 0,
      pitch: 0,
      roll: 0,
      speed: 0,
      climb: 0,
      boost: 0,
      stall: 0,
      brake: 0,
      lookYaw: 0,
      water: 0,
    };
    this.mode = 'showcase';
    this._lastFlapCross = 0;
    this.bodyLift = 0;
    this.bodyLagYaw = 0;
    this.bodyLagPitch = 0;
    this.bodyRoll = 0;
    this.neckLag = 0;
    this.onFlapDown = null;
    this._first = true;
  }

  triggerFlap(strength = 1) {
    this.flapEnergy = Math.min(1.35, this.flapEnergy + 0.9 * strength);
    this.flapImpulse = Math.min(1, this.flapImpulse + strength);
    this.wingPhase = Math.PI * 0.52;
  }

  triggerRoar() {
    this.roarAge = 0;
    this.roarActive = true;
  }

  triggerBreath(strength = 1) {
    this.breathAge = 0;
    this.breathDuration = 1.25;
    this.breathActive = true;
    this.flapEnergy = Math.min(1.35, this.flapEnergy + 0.25 * strength);
  }

  _roarCurve() {
    if (!this.roarActive) return 0;
    const t = clamp(this.roarAge / this.roarDuration, 0, 1);
    return Math.pow(Math.sin(Math.PI * t), 1.35);
  }

  _updateBlink(dt) {
    if (this.blinkProgress < 1) {
      this.blinkProgress = Math.min(1, this.blinkProgress + dt / 0.16);
      const t = this.blinkProgress;
      const open = 1 - Math.sin(Math.PI * t) * 0.94;
      this.blinkAmount = open;
      if (this.blinkProgress >= 1) {
        this.blinkAmount = 1;
        this.nextBlink = this.time + 2.2 + Math.random() * 4.3;
        this.blinkCount++;
        // occasional double blink
        if (this.blinkCount % 6 === 0) this.nextBlink = this.time + 0.22;
      }
    } else if (this.time > this.nextBlink) {
      this.blinkProgress = 0;
    } else {
      this.blinkAmount = 1;
    }
    const eyes = this.rig.eyes.concat(this.rig.extraEyes || []);
    for (const eye of eyes) {
      const baseY = eye.userData.baseScaleY ?? eye.scale.y;
      const open = Math.max(0.04, this.blinkAmount);
      eye.scale.y = baseY * open;
      if (eye.userData.isGlow) {
        const baseX = eye.userData.baseScaleX ?? eye.scale.x;
        const baseGlowY = eye.userData.baseScaleY ?? baseY;
        const glowOpen = 0.28 + open * 0.72;
        eye.scale.x = baseX * glowOpen;
        eye.scale.y = baseGlowY * glowOpen;
      }
    }
  }

  update(dt, state = {}) {
    const rig = this.rig;
    const catalog = rig.catalog;
    const cfg = catalog.model;
    dt = Math.min(dt, 0.06);
    this.time += dt;
    const t = this.time;
    this.mode = state.mode || 'showcase';
    const showcase = this.mode === 'showcase';

    const speed = Math.max(0, state.speed ?? (showcase ? 0 : 27));
    const speedNorm = clamp(speed / 48, 0, 1.25);
    const pitch = state.pitch ?? 0; // positive = nose up
    const roll = state.roll ?? 0;
    const turnIn = clamp(state.turn ?? 0, -1, 1);
    const climbIn = clamp(state.climb ?? 0, -1, 1);
    const boostIn = clamp(state.boost ?? 0, 0, 1);
    const stallIn = clamp(state.stall ?? 0, 0, 1);
    const brakeIn = clamp(state.brake ?? 0, 0, 1);
    const look = clamp(state.lookYaw ?? 0, -1.2, 1.2);
    const waterIn = state.water ? 1 : 0;

    const k = showcase ? 2.4 : 5.2;
    this.smooth.turn = damp(this.smooth.turn, turnIn, k, dt);
    this.smooth.pitch = damp(this.smooth.pitch, pitch, 4.3, dt);
    this.smooth.roll = damp(this.smooth.roll, roll, 4.6, dt);
    this.smooth.speed = damp(this.smooth.speed, speedNorm, 2.4, dt);
    this.smooth.climb = damp(this.smooth.climb, climbIn, 3.8, dt);
    this.smooth.boost = damp(this.smooth.boost, boostIn, 3.2, dt);
    this.smooth.stall = damp(this.smooth.stall, stallIn, 4.4, dt);
    this.smooth.brake = damp(this.smooth.brake, brakeIn, 4.0, dt);
    this.smooth.lookYaw = damp(this.smooth.lookYaw, look, 2.6, dt);
    this.smooth.water = damp(this.smooth.water, waterIn, 4.0, dt);

    const ss = this.smooth;
    const restStyle = rig.modelCfg?.restPose || (rig.archetype === 'eastern' ? 'coil' : 'crouch');
    this.bodyLagYaw = damp(this.bodyLagYaw, -ss.turn * 0.075, 2.1, dt);
    this.bodyLagPitch = damp(this.bodyLagPitch, ss.pitch * 0.025, 2.4, dt);
    this.bodyRoll = damp(this.bodyRoll, -ss.turn * 0.045, 2.2, dt);
    this.neckLag = damp(this.neckLag, -ss.turn * 0.03, 1.6, dt);

    // ── wing beat clock ─────────────────────────────────────────────────────
    if (this.roarActive) {
      this.roarAge += dt;
      if (this.roarAge >= this.roarDuration) this.roarActive = false;
    }
    if (this.breathActive) {
      this.breathAge += dt;
      if (this.breathAge >= this.breathDuration) this.breathActive = false;
    }
    const breathProgress = this.breathActive ? clamp(this.breathAge / this.breathDuration, 0, 1) : 1;
    const breathCharge = this.breathActive ? clamp(breathProgress / 0.32, 0, 1) : 0;
    const breathRelease = this.breathActive ? clamp((breathProgress - 0.3) / 0.38, 0, 1) : 0;
    const breathJaw = this.breathActive ? Math.sin(Math.min(1, breathProgress * 1.25) * Math.PI) : 0;
    const breathRecoil = breathCharge * (1 - breathRelease * 0.9);
    const roar = this._roarCurve();
    this._updateBlink(dt);

    this.flapEnergy = Math.max(0, this.flapEnergy - dt * (showcase ? 0.24 : 1.22));
    this.flapImpulse = Math.max(0, this.flapImpulse - dt * 2.8);
    const activeBeat = this.flapEnergy > 0.06;
    const isCloud = cfg.wing.sail === false;
    const pose = state.pose || 'flight';
    const coiled = pose === 'landed' && restStyle === 'coil';
    const gliding = !showcase && pose === 'flight' && speedNorm > 0.9 && ss.climb < 0.12 && !activeBeat;

    // Flight always breathes through the wings. Even at cruise the dragon beats
    // automatically; SPACE layers a deeper, audible power stroke on top.
    const autoStrength = showcase ? 0 : clamp(
      0.23 + (1 - clamp(speedNorm, 0, 1.35)) * 0.16 + Math.max(0, ss.climb) * 0.19 +
      (gliding ? -0.10 : 0) + ss.boost * 0.08,
      0.10, 0.55,
    );
    const beatRate = showcase ? 1.45 : (isCloud ? 2.35 : 4.55 + speedNorm * 1.15 + Math.max(0, ss.climb) * 1.9 + (activeBeat ? 2.2 : 0));
    const prevBeat = Math.sin(this.wingPhase);
    this.wingPhase += dt * beatRate;
    const osc = Math.sin(this.wingPhase);
    const oscLagA = Math.sin(this.wingPhase - 0.56);
    const oscLagB = Math.sin(this.wingPhase - 1.1);
    const upStroke = Math.max(0, osc);
    const downStroke = Math.max(0, -osc);
    const idle = Math.sin(t * (showcase ? 1.6 : 1.15));
    const energy = this.flapEnergy;
    if (!showcase && prevBeat > 0 && osc <= 0) {
      // one downstroke signal per beat, used by the controller for a soft lift
      if (this.onFlapDown) this.onFlapDown();
    }

    const autoWing = isCloud
      ? Math.sin(this.wingPhase * 0.55 + 0.4) * 0.10
      : osc * autoStrength;
    const flapAmplitude = 0.48 + energy * 0.42;
    const powerWing = activeBeat ? (upStroke * 0.70 - downStroke * 0.27) * flapAmplitude : 0;
    const wingLift = showcase
      ? -0.105 + Math.sin(t * 0.85) * 0.055 + Math.sin(t * 0.33 + 1.2) * 0.018
      : 0.045 + autoWing + powerWing;
    const catchDrag = ss.brake * 0.28 + ss.stall * 0.12;
    const sweep = ss.speed * 0.14 + ss.boost * 0.08 + catchDrag;
    const twist = ss.turn * 0.09;

    for (const w of rig.wings) {
      const s = w.side;
      const sideBank = -s * ss.turn * 0.04;
      let rootX;
      let rootY;
      let rootZ;
      let midY;
      let midZ;
      let tipY;
      let tipZ;
      let midX;
      let tipX;
      if (pose === 'landed' || pose === 'swim') {
        // Fold the wings back against the flanks when resting or floating.
        const breathe = Math.sin(t * 0.9) * 0.014;
        const settle = pose === 'landed' ? 1 : 0.62;
        rootX = -0.04;
        rootY = w.baseRootY + s * (0.92 * settle + 0.02);
        rootZ = w.baseRootZ + s * (0.015 * settle + breathe * 0.5);
        midY = s * (0.52 * settle);
        midZ = w.baseMidZ + s * (0.1 * settle + breathe * 0.35);
        tipY = s * (0.42 * settle);
        tipZ = w.baseTipZ + s * (0.16 * settle + breathe * 0.3);
        midX = -0.03;
        tipX = -0.05;
      } else {
        rootZ = w.baseRootZ + s * (wingLift + roar * 0.16 + sideBank);
        rootY = w.baseRootY + s * sweep;
        rootX = -0.035 - Math.abs(ss.turn) * 0.02 + downStroke * 0.028 * energy + osc * 0.022 * autoStrength;
        const autoLagA = isCloud ? Math.sin(this.wingPhase * 0.55 - 0.3) * 0.05 : oscLagA * autoStrength * 0.42;
        const autoLagB = isCloud ? Math.sin(this.wingPhase * 0.55 - 0.8) * 0.08 : oscLagB * autoStrength * 0.65;
        const lagA = showcase ? Math.sin(t * 0.85 - 0.6) * 0.035 : autoLagA + (activeBeat ? oscLagA * 0.17 * flapAmplitude : 0);
        const lagB = showcase ? Math.sin(t * 0.85 - 1.1) * 0.055 : autoLagB + (activeBeat ? oscLagB * 0.26 * flapAmplitude : 0);
        midZ = w.baseMidZ + s * (lagA + ss.turn * twist * 0.5);
        tipZ = w.baseTipZ + s * (lagB + ss.turn * twist * 0.7);
        midY = -s * (sweep * 0.28 + ss.brake * 0.16 + (isCloud ? 0.04 : 0));
        tipY = -s * (sweep * 0.15 + ss.brake * 0.1 + (isCloud ? 0.06 : 0));
        midX = downStroke * 0.035 * (energy + autoStrength * 0.3);
        tipX = -0.02 + upStroke * 0.04 * (energy + autoStrength * 0.35);
      }
      const rate = pose === 'landed' || pose === 'swim' ? 3.2 : 12;
      w.root.rotation.x = damp(w.root.rotation.x, rootX, rate, dt);
      w.root.rotation.y = damp(w.root.rotation.y, rootY, rate, dt);
      w.root.rotation.z = damp(w.root.rotation.z, rootZ, rate, dt);
      w.mid.rotation.x = damp(w.mid.rotation.x, midX, rate, dt);
      w.mid.rotation.y = damp(w.mid.rotation.y, midY, rate, dt);
      w.mid.rotation.z = damp(w.mid.rotation.z, midZ, rate, dt);
      w.tip.rotation.x = damp(w.tip.rotation.x, tipX, rate, dt);
      w.tip.rotation.y = damp(w.tip.rotation.y, tipY, rate, dt);
      w.tip.rotation.z = damp(w.tip.rotation.z, tipZ, rate, dt);
    }

    // ── body bob, breathing, bank ──────────────────────────────────────────
    const breath = Math.sin(t * 1.25 + 0.4);
    const flapLift = activeBeat ? Math.sin(this.wingPhase - 0.8) * 0.11 * energy : Math.sin(this.wingPhase - 0.8) * 0.028 * autoStrength;
    this.bodyLift = damp(this.bodyLift, flapLift, 9, dt);
    const hover = showcase ? Math.sin(t * 0.9) * 0.08 : 0;
    rig.inner.position.y = this.bodyLift + hover + breath * 0.022 - ss.stall * 0.06 - (coiled ? 0.16 : (pose === 'landed' ? 0.05 : 0));
    rig.inner.position.x = 0;
    rig.inner.rotation.z = -ss.turn * 0.028 + Math.sin(this.wingPhase) * 0.015 * energy;
    rig.inner.rotation.x = -ss.pitch * 0.012 + Math.sin(t * 0.8) * 0.006;
    const easternWave = rig.archetype === 'eastern' ? Math.sin(t * 1.05) * 0.022 + Math.sin(this.wingPhase * 0.5) * 0.012 : 0;
    rig.inner.rotation.y = -ss.turn * 0.055 + easternWave + this.bodyLagYaw;
    if (rig.bodyGroup) {
      const serpent = rig.catalog.id === 'wuzhao' ? 1.4 : (rig.archetype === 'eastern' ? 1.0 : 0.25);
      const sway = Math.sin(t * 1.55 + this.wingPhase * 0.18) * (0.04 + ss.speed * 0.035) * serpent;
      rig.bodyGroup.rotation.y = damp(rig.bodyGroup.rotation.y, sway, 2.2, dt);
      rig.bodyGroup.rotation.z = damp(rig.bodyGroup.rotation.z, Math.sin(t * 1.08 + 0.4) * 0.03 * serpent, 1.8, dt);
      rig.bodyGroup.position.x = damp(rig.bodyGroup.position.x, Math.sin(t * 1.55 + 0.7) * 0.11 * serpent, 2.2, dt);
      rig.bodyGroup.position.y = damp(rig.bodyGroup.position.y, coiled ? -0.12 : 0, 2.0, dt);
    }
    rig.inner.rotation.x += this.bodyLagPitch;
    rig.inner.rotation.z += this.bodyRoll;
    if (rig.bodyGroup) {
      rig.bodyGroup.scale.set(1 + breath * 0.012, 1 + Math.abs(breath) * 0.008, 1 + breath * 0.006);
    }

    // ── neck / head look and stability ─────────────────────────────────────
    const lookTarget = showcase
      ? Math.sin(t * 0.32) * 0.36 + Math.sin(t * 0.71) * 0.08
      : ss.turn * 0.18;
    const lookSway = damp(this._look || 0, lookTarget, 1.5, dt);
    this._look = lookSway;
    const headLift = roar * 0.3 + ss.stall * 0.22;
    const headCounter = ss.pitch * 0.16 + ss.climb * 0.02;
    const nCount = rig.neck.length;
    for (let i = 0; i < nCount; i++) {
      const seg = rig.neck[i];
      const tFrac = nCount <= 1 ? 0 : i / (nCount - 1);
      const breathSway = Math.sin(t * 1.1 + i * 0.42) * 0.006;
      seg.rotation.x = rig.neckBaseX[i] - roar * 0.05 * (0.35 + tFrac) - headCounter * 0.12 * (1 - tFrac * 0.5) + breathSway + breathRecoil * 0.12 * (0.3 + tFrac * 0.7) - breathRelease * 0.09 * tFrac + (coiled ? 0.10 * (0.35 + tFrac) : 0);
      seg.rotation.y = (lookSway * 0.22 + ss.lookYaw * 0.22) * (0.25 + tFrac * 0.6) + Math.sin(t * 0.7 + i * 0.3) * 0.006 + (rig.archetype === 'eastern' ? Math.sin(t * 0.9 - i * 0.25) * 0.018 + Math.sin(t * 1.7 - i * 0.52) * 0.045 : 0) + this.neckLag * (0.2 + tFrac * 0.5) + (coiled ? Math.sin(t * 0.35 + i * 0.22) * 0.055 : 0);
      seg.rotation.z = -ss.roll * 0.022 * (0.4 + tFrac);
    }
    if (rig.head) {
      rig.head.rotation.x = rig.headBaseX + headCounter * 0.5 + headLift * 0.24 + Math.sin(t * 0.9) * 0.012 - ss.stall * 0.1 - breathRecoil * 0.18 + breathRelease * 0.12 + (coiled ? 0.20 : 0);
      rig.head.rotation.y = rig.headBaseY + lookSway * 0.58 + ss.lookYaw * 0.45 + ss.turn * 0.09;
      rig.head.rotation.z = -ss.roll * 0.1 + Math.sin(t * 0.6) * 0.007;
    }
    if (rig.jaw) {
      const jawOpen = roar * 0.62 + ss.boost * 0.045 + ss.stall * 0.06 + Math.max(0, Math.sin(t * 0.37)) * 0.006 + breathJaw * 0.42;
      rig.jaw.rotation.x = rig.jawBase + jawOpen;
    }
    if (rig.frills) {
      for (const frill of rig.frills) {
        const flare = 0.04 + Math.abs(ss.turn) * 0.1 + roar * 0.3 + ss.speed * 0.07 + breathCharge * 0.18;
        frill.group.rotation.z = frill.baseZ + frill.side * flare;
        frill.group.rotation.y = frill.baseY + frill.side * (0.04 + roar * 0.12);
      }
    }
    // whiskers trail and respond to the head
    for (let wi = 0; wi < rig.whiskers.length; wi++) {
      const wh = rig.whiskers[wi];
      const wave = Math.sin(t * 1.55 + wi * 1.7) * 0.09 + Math.sin(t * 0.63 + wi) * 0.035;
      wh.root.rotation.y = wh.baseYaw + wave * (0.6 + ss.speed * 0.9) - lookSway * 0.06;
      wh.root.rotation.x = wh.baseX + Math.sin(t * 0.9 + wi * 2.1) * 0.05;
      for (let j = 0; j < wh.segments.length; j++) {
        const seg = wh.segments[j];
        const phase = t * 1.9 - j * 0.8 + wi * 1.1;
        seg.rotation.y = Math.sin(phase) * (0.06 + ss.speed * 0.045);
        seg.rotation.x = Math.sin(phase + 1.2) * 0.04;
        seg.rotation.z = Math.sin(phase + 0.3) * 0.025 + wh.side * 0.02;
      }
    }

    // extra heads, each on their own serpentine clock
    for (let hi = 0; hi < rig.extraHeads.length; hi++) {
      const eh = rig.extraHeads[hi];
      const sign = hi % 2 === 0 ? -1 : 1;
      for (let i = 0; i < eh.segments.length; i++) {
        const seg = eh.segments[i];
        const base = eh.baseRot[i];
        seg.rotation.x = base + Math.sin(t * 1.05 + hi * 1.9 + i * 0.35) * 0.028;
        seg.rotation.y = sign * (0.06 + Math.sin(t * 0.53 + hi * 2.2 + i * 0.25) * 0.08) + ss.turn * 0.035;
        seg.rotation.z = sign * Math.sin(t * 0.42 + i * 0.2 + hi) * 0.02;
      }
      eh.head.rotation.y = sign * Math.sin(t * 0.36 + hi * 2.1) * 0.3 + ss.lookYaw * 0.2;
      eh.head.rotation.x = 0.48 + Math.sin(t * 0.7 + hi) * 0.03 - ss.pitch * 0.05;
      if (eh.jaw) eh.jaw.rotation.x = Math.sin(t * 0.27 + hi * 1.7) * 0.035 + roar * 0.22 + ss.boost * 0.02 + breathJaw * 0.18;
    }

    // ── legs: active tuck, wing-driven pump, planted stance and paddling ──
    for (const leg of rig.legs) {
      const front = leg.front;
      const side = leg.side;
      const phase = (front ? 0 : 1.55) + (side > 0 ? 0.36 : -0.14);
      const isEastern = rig.archetype === 'eastern';
      const fastTuck = clamp(0.30 + ss.speed * 1.18 + ss.boost * 0.22, 0, 1);
      const waterTuck = pose === 'swim' ? clamp(0.25 + ss.speed * 1.35 + ss.water * 0.35, 0, 1) : 0;
      const tuck = showcase ? 1 : Math.max(fastTuck, waterTuck);
      const pump = Math.sin(this.wingPhase + phase) * (0.035 + Math.max(0, 1 - ss.speed) * 0.03 + autoStrength * 0.045);
      const spread = Math.sin(t * 0.8 + phase) * 0.018 + side * Math.abs(ss.turn) * 0.035;
      let rootTarget;
      let kneeTarget;
      let ankleTarget;
      let footTarget;
      let rate = 5.0;
      if (coiled) {
        const fold = 0.92;
        rootTarget = lerp(leg.baseX, (isEastern ? 1.5 : 1.27) + (front ? 0.02 : 0.18), fold);
        kneeTarget = lerp(leg.baseKneeX, (isEastern ? -2.22 : -1.92) - 0.16, fold);
        ankleTarget = lerp(leg.baseAnkleX, (isEastern ? 1.65 : 1.42), fold);
        footTarget = -0.22 + Math.sin(t * 0.45 + phase) * 0.012;
        rate = 2.2;
      } else if (pose === 'landed') {
        // Planted: elbows open, wrists settle, weight shifts slowly between feet.
        const settle = Math.sin(t * 0.8 + phase) * 0.022;
        rootTarget = leg.baseX + (front ? -0.04 : 0.06) + settle;
        kneeTarget = leg.baseKneeX + (front ? 0.08 : -0.08) + settle * 0.5;
        ankleTarget = leg.baseAnkleX - 0.04 - settle * 0.4;
        footTarget = -0.05 + Math.sin(t * 0.6 + phase) * 0.018;
        rate = 3.2;
      } else if (pose === 'swim' && tuck < 0.62) {
        const paddle = Math.sin(t * 3.1 + phase) * 0.34;
        rootTarget = leg.baseX + paddle;
        kneeTarget = leg.baseKneeX - 0.18 + paddle * 0.5;
        ankleTarget = leg.baseAnkleX + 0.22 - paddle * 0.35;
        footTarget = -0.08 + Math.sin(t * 3.1 + phase + 1) * 0.08;
        rate = 6.0;
      } else {
        const targetRoot = (isEastern ? 1.50 : 1.27) + (front ? 0.02 : 0.18);
        const targetKnee = (isEastern ? -2.22 : -1.92) - (front ? 0.10 : 0.22);
        const targetAnkle = (isEastern ? 1.65 : 1.42);
        rootTarget = lerp(leg.baseX, targetRoot, tuck) + pump + Math.sin(t * 0.9 + phase) * 0.02;
        kneeTarget = lerp(leg.baseKneeX, targetKnee, tuck) + pump * 0.65;
        ankleTarget = lerp(leg.baseAnkleX, targetAnkle, tuck) - pump * 0.9;
        footTarget = -0.04 + Math.sin(t * 1.35 + phase) * 0.035 + ss.turn * side * 0.02 - tuck * 0.16;
      }
      leg.root.rotation.x = damp(leg.root.rotation.x, rootTarget, rate, dt);
      leg.root.rotation.z = damp(leg.root.rotation.z, leg.baseZ + side * (0.02 + Math.abs(ss.turn) * 0.06) + spread, 4.5, dt);
      leg.knee.rotation.x = damp(leg.knee.rotation.x, kneeTarget, rate, dt);
      leg.ankle.rotation.x = damp(leg.ankle.rotation.x, ankleTarget, rate, dt);
      leg.foot.rotation.x = damp(leg.foot.rotation.x, footTarget, rate, dt);
      leg.foot.rotation.y = damp(leg.foot.rotation.y, side * 0.03 + Math.sin(t * 1.1 + phase) * 0.02, 4, dt);
    }

    // ── tail: a travelling wave, slower and broader on turns ───────────────
    const tailAmp = (rig.archetype === 'eastern' ? 0.105 : 0.07) + (1 - Math.min(1, ss.speed)) * 0.06 + ss.stall * 0.07 + showcase * 0.03;
    const tailClock = t * (2.4 + ss.speed * 2.2);
    for (let i = 0; i < rig.tail.length; i++) {
      const seg = rig.tail[i];
      const frac = i / Math.max(1, rig.tail.length - 1);
      const lateral =
        Math.sin(tailClock - i * 0.58) * tailAmp * (0.25 + frac * 0.95) +
        ss.turn * (0.075 + frac * 0.08) +
        sinSafe(i * 0.5 + t * 0.6) * 0.008 +
        (coiled ? Math.sin(t * 0.28 + i * 0.32) * 0.06 + (0.10 + frac * 0.18) : 0);
      seg.rotation.y = lateral;
      seg.rotation.x = rig.tailBaseX[i] - ss.climb * 0.022 * frac + Math.sin(tailClock * 0.5 - i * 0.3) * 0.012 + (coiled ? 0.045 * frac : 0);
      seg.rotation.z = Math.sin(tailClock * 0.62 - i * 0.4) * 0.018 * (0.3 + frac) - ss.roll * 0.008;
    }
    if (rig.tailTipGroup) {
      rig.tailTipGroup.rotation.y = Math.sin(tailClock - 0.6) * 0.1 + ss.turn * 0.08;
      rig.tailTipGroup.rotation.z = Math.sin(tailClock * 0.8) * 0.03;
    }

    // ── ribbons and pennants ───────────────────────────────────────────────
    for (const ribbon of rig.ribbons) {
      for (let i = 0; i < ribbon.segments.length; i++) {
        const seg = ribbon.segments[i];
        const phase = t * (1.2 + ss.speed * 0.8) + ribbon.phase + i * 0.62;
        seg.rotation.y = Math.sin(phase) * (0.09 + ss.speed * 0.05) - ribbon.side * 0.02;
        seg.rotation.x = 0.03 + Math.sin(phase * 0.72 + 0.8) * (0.07 + ss.speed * 0.035);
        seg.rotation.z = Math.cos(phase * 0.58) * 0.045;
      }
    }

    // ── glow pulse ─────────────────────────────────────────────────────────
    if (rig.mats.glow) {
      rig.mats.glow.opacity = 0.72 + Math.sin(t * 2.1) * 0.12 + roar * 0.16;
    }
    this._first = false;
  }
}

function sinSafe(x) {
  return Math.sin(x);
}
