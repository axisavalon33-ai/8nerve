// Balance-disorder effect models for the VR phone (pure maths, unit-testable with Node).
// Output per frame: dx, dy = image shift (fraction of the eye view), roll = rotation in degrees,
// audio = 0..1 level for sound effects, done = episode finished.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Effects = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_ROLL_DEG = 15; // torsional tilt limit at full intensity
  const MAX_SHIFT = 0.15; // never move the picture more than 15 % of the view
  const MAX_DURATION = 60; // seconds

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smoothstep = (x) => {
    const t = clamp(x, 0, 1);
    return t * t * (3 - 2 * t);
  };

  // Nystagmus beat: slow drift for `slow` s, then a fast snap back in `fast` s.
  // pos runs -1 -> +1 during the slow phase and +1 -> -1 during the fast phase.
  function nystagmus(t, slow = 0.4, fast = 0.08) {
    const period = slow + fast;
    const ph = ((t % period) + period) % period;
    if (ph < slow) return { pos: -1 + (2 * ph) / slow, fast: false };
    return { pos: 1 - (2 * (ph - slow)) / fast, fast: true };
  }

  // Gentle start (ramp) and gentle end (last 2 s) for timed conditions.
  function rampEnvelope(t, duration, rampSec) {
    const fadeOut = Math.min(2, duration / 4);
    return smoothstep(t / rampSec) * (1 - smoothstep((t - (duration - fadeOut)) / fadeOut));
  }

  // BPPV attack: builds up, peaks at 30 %, then fades away.
  function bppvEnvelope(u) {
    if (u <= 0 || u >= 1) return 0;
    return u < 0.3 ? smoothstep(u / 0.3) : 1 - smoothstep((u - 0.3) / 0.7);
  }

  class Episode {
    // opts: { condition, intensity (0..1), duration (s), rampSec, bppvTiltDeg, bppvLatencySec, bppvWaitMaxSec, sensitivity }
    constructor(opts, now) {
      this.o = Object.assign({ rampSec: 3, bppvTiltDeg: 30, bppvLatencySec: 2.5, bppvWaitMaxSec: 30, sensitivity: 1 }, opts);
      this.o.duration = clamp(this.o.duration || 30, 1, MAX_DURATION);
      this.o.sensitivity = clamp(Number(this.o.sensitivity) || 0, 0, 3);
      this.o.intensity = clamp(this.o.intensity, 0, 1);
      this.start = now;
      this.phase = this.o.condition === 'bppv' ? 'waiting' : 'running';
      this.phaseStart = now;
      this.done = false;
      this.reason = null;
      this.spring = { x: 0, y: 0, vx: 0, vy: 0 };
      this.lastNow = now;
    }

    // Seconds of the actual effect so far and its total length (for progress bars).
    progress(now) {
      if (this.phase === 'running') return { elapsed: (now - this.phaseStart) / 1000, duration: this.o.duration };
      return { elapsed: 0, duration: this.o.duration };
    }

    // sensors: { tilt (deg, + = head tilted right), yawRate, pitchRate, rollRate (deg/s) }
    update(now, sensors = {}) {
      const o = this.o;
      const I = o.intensity;
      const dt = clamp((now - this.lastNow) / 1000, 0, 0.1);
      this.lastNow = now;
      const out = { dx: 0, dy: 0, roll: 0, audio: 0, phase: this.phase, done: false };
      if (this.done) return { ...out, done: true };

      if (this.phase === 'waiting') {
        if ((sensors.tilt || 0) > o.bppvTiltDeg) {
          this.phase = 'latency';
          this.phaseStart = now;
        } else if (now - this.start > o.bppvWaitMaxSec * 1000) {
          return this.finish('noTilt', out);
        }
        out.phase = this.phase;
        return out;
      }
      if (this.phase === 'latency') {
        if (now - this.phaseStart >= o.bppvLatencySec * 1000) {
          this.phase = 'running';
          this.phaseStart = now;
        }
        out.phase = this.phase;
        return out;
      }

      const t = (now - this.phaseStart) / 1000;
      if (t >= o.duration) return this.finish('complete', out);
      out.phase = 'running';

      switch (o.condition) {
        case 'bppv': {
          // Right posterior-canal BPPV: torsional + up-beating nystagmus that builds, peaks and fades.
          const env = bppvEnvelope(t / o.duration) * smoothstep(t / o.rampSec);
          const n = nystagmus(t, 0.4, 0.08);
          out.roll = env * I * MAX_ROLL_DEG * n.pos;
          out.dy = env * I * (0.03 * n.pos + 0.02 * Math.sin(2 * Math.PI * 0.2 * t));
          break;
        }
        case 'neuritis': {
          // Steady horizontal nystagmus: drift one way, snap back.
          const env = rampEnvelope(t, o.duration, o.rampSec);
          const n = nystagmus(t, 0.4, 0.08);
          out.dx = env * I * 0.07 * n.pos;
          out.roll = env * I * 2 * n.pos;
          out.dy = env * I * 0.015 * Math.sin(2 * Math.PI * 0.15 * t);
          break;
        }
        case 'menieres': {
          // Spinning attack: faster horizontal nystagmus + slow swaying rotation, plus sound.
          const env = rampEnvelope(t, o.duration, o.rampSec);
          const n = nystagmus(t, 0.3, 0.07);
          out.dx = env * I * 0.09 * n.pos;
          out.roll = env * I * 10 * Math.sin(2 * Math.PI * 0.12 * t);
          out.dy = env * I * 0.02 * Math.sin(2 * Math.PI * 0.17 * t);
          out.audio = env;
          break;
        }
        case 'oscillopsia': {
          // The eyes no longer stay steady when the head moves: the picture is thrown along with each
          // head movement and bounces back (under-damped spring). Head still = still picture.
          const env = rampEnvelope(t, o.duration, o.rampSec);
          const gain = 0.0025 * o.sensitivity * (0.4 + I) * env; // view fraction per deg/s
          const tx = clamp((sensors.yawRate || 0) * gain, -MAX_SHIFT, MAX_SHIFT);
          const ty = clamp(-(sensors.pitchRate || 0) * gain, -MAX_SHIFT, MAX_SHIFT);
          const tr = clamp((sensors.rollRate || 0) * gain * 40, -8, 8);
          const s = this.spring;
          const stiff = 90;
          const damp = 5;
          s.vx += (stiff * (tx - s.x) - damp * s.vx) * dt;
          s.vy += (stiff * (ty - s.y) - damp * s.vy) * dt;
          s.vr = (s.vr || 0) + (stiff * (tr - (s.r || 0)) - damp * (s.vr || 0)) * dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          s.r = (s.r || 0) + s.vr * dt;
          out.dx = s.x;
          out.dy = s.y;
          out.roll = s.r;
          break;
        }
      }
      out.dx = clamp(out.dx, -MAX_SHIFT, MAX_SHIFT);
      out.dy = clamp(out.dy, -MAX_SHIFT, MAX_SHIFT);
      out.roll = clamp(out.roll, -MAX_ROLL_DEG, MAX_ROLL_DEG);
      return out;
    }

    finish(reason, out) {
      this.done = true;
      this.reason = reason;
      return { ...out, dx: 0, dy: 0, roll: 0, audio: 0, done: true, phase: 'done' };
    }
  }

  // Head roll from the gravity vector. Returns degrees, + = head tilted towards the right shoulder.
  // ax, ay = accelerationIncludingGravity x/y (Android convention), screenAngle = screen.orientation.angle.
  function headRoll(ax, ay, screenAngle) {
    const a = (screenAngle * Math.PI) / 180;
    const sx = ax * Math.cos(a) - ay * Math.sin(a); // gravity reaction in screen coordinates
    const sy = ax * Math.sin(a) + ay * Math.cos(a);
    return (Math.atan2(-sx, sy) * 180) / Math.PI;
  }

  // Rotation rates (deg/s) about the screen axes: yaw = turning left/right, pitch = nodding,
  // roll = tilting towards a shoulder. beta/gamma/alpha = rotationRate about the device x/y/z axes.
  function headRates(beta, gamma, screenAngle, alpha = 0) {
    const a = (screenAngle * Math.PI) / 180;
    return {
      pitchRate: beta * Math.cos(a) - gamma * Math.sin(a),
      yawRate: beta * Math.sin(a) + gamma * Math.cos(a),
      rollRate: alpha || 0,
    };
  }

  // Fallback for phones without a gyroscope: turn rates from successive deviceorientation readings.
  // Returns a function (event, timeMs) -> { yawRate, pitchRate, rollRate } or null for the first reading.
  function orientationRateTracker() {
    let last = null;
    const diff = (a, b) => ((((a - b) % 360) + 540) % 360) - 180; // shortest angle difference
    return (e, now, screenAngle) => {
      if (e.alpha === null || e.beta === null) return null;
      const cur = { a: e.alpha, b: e.beta, g: e.gamma || 0, t: now };
      const prev = last;
      last = cur;
      if (!prev) return null;
      const dt = (cur.t - prev.t) / 1000;
      if (dt <= 0 || dt > 0.5) return null;
      // In landscape the compass angle (alpha) changes when turning the head left/right.
      const yaw = diff(cur.a, prev.a) / dt;
      const tiltA = diff(cur.b, prev.b) / dt;
      const tiltG = diff(cur.g, prev.g) / dt;
      const landscape = Math.abs(Math.round(screenAngle / 90)) % 2 === 1;
      return { yawRate: yaw, pitchRate: landscape ? tiltG : tiltA, rollRate: landscape ? tiltA : tiltG };
    };
  }

  return { Episode, nystagmus, bppvEnvelope, rampEnvelope, smoothstep, headRoll, headRates, orientationRateTracker, MAX_ROLL_DEG, MAX_SHIFT, MAX_DURATION };
});
