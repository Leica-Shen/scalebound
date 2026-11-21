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
    };
    this.mode = 'showcase';
    this._lastFlapCross = 0;
    this.bodyLift = 0;
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

    const ss = this.smooth;

    // ── wing beat clock ─────────────────────────────────────────────────────
    if (this.roarActive) {
      this.roarAge += dt;
      if (this.roarAge >= this.roarDuration) this.roarActive = false;
    }
    const roar = this._roarCurve();
    this._updateBlink(dt);

    this.flapEnergy = Math.max(0, this.flapEnergy - dt * (showcase ? 0.24 : 1.22));
    this.flapImpulse = Math.max(0, this.flapImpulse - dt * 2.8);
    const activeBeat = this.flapEnergy > 0.06;
    if (activeBeat) {
      this.wingPhase += dt * (5.6 + this.flapEnergy * 1.8 + speedNorm * 0.8);
    } else {
      this.wingPhase += dt * (showcase ? 1.5 : 0.85);
    }
    const osc = Math.sin(this.wingPhase);
    const oscLagA = Math.sin(this.wingPhase - 0.56);
    const oscLagB = Math.sin(this.wingPhase - 1.1);
    const upStroke = Math.max(0, osc);
    const downStroke = Math.max(0, -osc);
    const idle = Math.sin(t * (showcase ? 1.6 : 1.15));
    const energy = this.flapEnergy;

    const flapAmplitude = 0.48 + energy * 0.42;
    const wingLift = showcase
      ? -0.105 + Math.sin(t * 0.85) * 0.055 + Math.sin(t * 0.33 + 1.2) * 0.018
      : (0.045 + idle * 0.02) +
        (activeBeat ? (upStroke * 0.78 - downStroke * 0.32) * flapAmplitude : idle * 0.024);
    const catchDrag = ss.brake * 0.28 + ss.stall * 0.12;
    const sweep = ss.speed * 0.14 + ss.boost * 0.08 + catchDrag;
    const twist = ss.turn * 0.09;

    for (const w of rig.wings) {
      const s = w.side;
      const sideBank = -s * ss.turn * 0.04;
      w.root.rotation.z = w.baseRootZ + s * (wingLift + roar * 0.16 + sideBank);
      w.root.rotation.y = w.baseRootY + s * sweep;
      w.root.rotation.x = -0.035 - Math.abs(ss.turn) * 0.02 + downStroke * 0.028 * energy;
      const lagA = showcase ? Math.sin(t * 0.85 - 0.6) * 0.035 : (activeBeat ? oscLagA * 0.17 * flapAmplitude : idle * 0.014);
      const lagB = showcase ? Math.sin(t * 0.85 - 1.1) * 0.055 : (activeBeat ? oscLagB * 0.26 * flapAmplitude : idle * 0.02);
      w.mid.rotation.z = w.baseMidZ + s * (lagA + ss.turn * twist * 0.5);
      w.tip.rotation.z = w.baseTipZ + s * (lagB + ss.turn * twist * 0.7);
      w.mid.rotation.y = -s * (sweep * 0.28 + ss.brake * 0.16);
      w.tip.rotation.y = -s * (sweep * 0.15 + ss.brake * 0.1);
      w.mid.rotation.x = downStroke * 0.035 * energy;
      w.tip.rotation.x = -0.02 + upStroke * 0.04 * energy;
    }

    // ── body bob, breathing, bank ──────────────────────────────────────────
    const breath = Math.sin(t * 1.25 + 0.4);
    const flapLift = activeBeat ? Math.sin(this.wingPhase - 0.8) * 0.11 * energy : 0;
    this.bodyLift = damp(this.bodyLift, flapLift, 9, dt);
    const hover = showcase ? Math.sin(t * 0.9) * 0.08 : 0;
    rig.inner.position.y = this.bodyLift + hover + breath * 0.022 - ss.stall * 0.06;
    rig.inner.position.x = 0;
    rig.inner.rotation.z = -ss.turn * 0.028 + Math.sin(this.wingPhase) * 0.015 * energy;
    rig.inner.rotation.x = -ss.pitch * 0.012 + Math.sin(t * 0.8) * 0.006;
    rig.inner.rotation.y = -ss.turn * 0.055;
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
      seg.rotation.x = rig.neckBaseX[i] - roar * 0.05 * (0.35 + tFrac) - headCounter * 0.12 * (1 - tFrac * 0.5) + breathSway;
      seg.rotation.y = (lookSway * 0.22 + ss.lookYaw * 0.22) * (0.25 + tFrac * 0.6) + Math.sin(t * 0.7 + i * 0.3) * 0.006;
      seg.rotation.z = -ss.roll * 0.022 * (0.4 + tFrac);
    }
    if (rig.head) {
      rig.head.rotation.x = rig.headBaseX + headCounter * 0.5 + headLift * 0.24 + Math.sin(t * 0.9) * 0.012 - ss.stall * 0.1;
      rig.head.rotation.y = rig.headBaseY + lookSway * 0.58 + ss.lookYaw * 0.45 + ss.turn * 0.09;
      rig.head.rotation.z = -ss.roll * 0.1 + Math.sin(t * 0.6) * 0.007;
    }
    if (rig.jaw) {
      const jawOpen = roar * 0.62 + ss.boost * 0.045 + ss.stall * 0.06 + Math.max(0, Math.sin(t * 0.37)) * 0.006;
      rig.jaw.rotation.x = rig.jawBase + jawOpen;
    }
    if (rig.frills) {
      for (const frill of rig.frills) {
        const flare = 0.04 + Math.abs(ss.turn) * 0.1 + roar * 0.3 + ss.speed * 0.07;
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
      if (eh.jaw) eh.jaw.rotation.x = Math.sin(t * 0.27 + hi * 1.7) * 0.035 + roar * 0.22 + ss.boost * 0.02;
    }

    // ── legs: tuck, sway, and claw articulation ───────────────────────────
    for (const leg of rig.legs) {
      const front = leg.front;
      const side = leg.side;
      const flightTuck = clamp(0.5 + ss.speed * 0.95 + ss.boost * 0.18, 0, 1);
      const tuck = showcase ? 1 : flightTuck;
      const targetRoot = 1.25 + (front ? 0.02 : 0.16);
      const targetKnee = -1.95 - (front ? 0.12 : 0.22);
      const targetAnkle = 1.48;
      const pump = activeBeat ? Math.sin(this.wingPhase - 0.25) * 0.06 * energy : 0;
      const spread = Math.sin(t * 0.8 + (front ? 0 : 1.4) + side) * 0.015;
      leg.root.rotation.x = lerp(leg.baseX, targetRoot, tuck) + pump + Math.sin(t * 0.9 + (front ? 0 : 1)) * 0.015;
      leg.root.rotation.z = leg.baseZ + side * (0.02 + Math.abs(ss.turn) * 0.06) + spread;
      leg.knee.rotation.x = lerp(leg.baseKneeX, targetKnee, tuck) + pump * 0.5;
      leg.ankle.rotation.x = lerp(leg.baseAnkleX, targetAnkle, tuck) - pump * 0.7;
      leg.foot.rotation.x = -0.05 + Math.sin(t * 1.25 + front * 2.1 + side) * 0.025;
      leg.foot.rotation.y = side * 0.03;
    }

    // ── tail: a travelling wave, slower and broader on turns ───────────────
    const tailAmp = 0.055 + (1 - Math.min(1, ss.speed)) * 0.055 + ss.stall * 0.06 + showcase * 0.025;
    const tailClock = t * (2.4 + ss.speed * 2.2);
    for (let i = 0; i < rig.tail.length; i++) {
      const seg = rig.tail[i];
      const frac = i / Math.max(1, rig.tail.length - 1);
      const lateral =
        Math.sin(tailClock - i * 0.58) * tailAmp * (0.25 + frac * 0.95) +
        ss.turn * (0.055 + frac * 0.06) +
        sinSafe(i * 0.5 + t * 0.6) * 0.008;
      seg.rotation.y = lateral;
      seg.rotation.x = rig.tailBaseX[i] - ss.climb * 0.022 * frac + Math.sin(tailClock * 0.5 - i * 0.3) * 0.012;
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
