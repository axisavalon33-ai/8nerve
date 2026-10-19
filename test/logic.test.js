// Unit tests for the hearing-test rules, signal processing and VR effect maths.  Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const DIN = require('../public/ear/js/din.js');
const DSP = require('../public/ear/js/dsp.js');
const Effects = require('../public/vr/effects.js');

test('triplets: 3 digits 0-9, never the same digit twice in a row', () => {
  for (let i = 0; i < 2000; i++) {
    const t = DIN.makeTriplet();
    assert.equal(t.length, 3);
    for (const d of t) assert.ok(Number.isInteger(d) && d >= 0 && d <= 9);
    assert.notEqual(t[0], t[1]);
    assert.notEqual(t[1], t[2]);
  }
});

test('scoring: correct only when all 3 digits match in order', () => {
  assert.equal(DIN.isCorrect([1, 2, 3], [1, 2, 3]), true);
  assert.equal(DIN.isCorrect([1, 2, 3], [1, 2, 4]), false);
  assert.equal(DIN.isCorrect([1, 2, 3], [3, 2, 1]), false);
});

test('staircase: 1-up/1-down, 2 dB steps, starts at 0 dB', () => {
  const s = new DIN.Staircase({ startSnr: 0, stepDb: 2, testTrials: 24, scoreFrom: 5 });
  assert.equal(s.snr, 0);
  s.record(true);
  assert.equal(s.snr, -2);
  s.record(true);
  assert.equal(s.snr, -4);
  s.record(false);
  assert.equal(s.snr, -2);
});

test('SRT = mean SNR of trials 5-24', () => {
  const s = new DIN.Staircase({ startSnr: 0, stepDb: 2, testTrials: 24, scoreFrom: 5 });
  const pattern = [true, true, true, true, true, false, true, false, false, true, true, false, true, false, true, false, true, false, true, false, true, false, true, false];
  for (const c of pattern) s.record(c);
  assert.ok(s.done);
  const expected = s.trials.slice(4).reduce((a, t) => a + t.snr, 0) / 20;
  assert.equal(s.srt(), expected);
  assert.equal(s.trials.length, 24);
});

test('simulated listener converges near their true threshold', () => {
  // Listener gets a triplet right with a logistic probability around -9 dB SNR.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const srts = [];
  for (let run = 0; run < 200; run++) {
    const s = new DIN.Staircase({ startSnr: 0, stepDb: 2, testTrials: 24, scoreFrom: 5 });
    while (!s.done) s.record(rand() < 1 / (1 + Math.exp(-(s.snr + 9) / 1.2)));
    srts.push(s.srt());
  }
  const mean = srts.reduce((a, b) => a + b, 0) / srts.length;
  assert.ok(Math.abs(mean - -9) < 1.2, `mean SRT ${mean}`);
});

test('bands: good <= -10, borderline -10..-7, refer > -7', () => {
  const b = { good: -10, refer: -7 };
  assert.equal(DIN.bandFor(-12, b), 'good');
  assert.equal(DIN.bandFor(-10, b), 'good');
  assert.equal(DIN.bandFor(-9, b), 'borderline');
  assert.equal(DIN.bandFor(-7, b), 'borderline');
  assert.equal(DIN.bandFor(-6.9, b), 'refer');
  // the gauge needle lands in the matching third
  assert.ok(DIN.gaugePosition(-12, b) < 1 / 3);
  assert.ok(DIN.gaugePosition(-8.5, b) > 1 / 3 && DIN.gaugePosition(-8.5, b) < 2 / 3);
  assert.ok(DIN.gaugePosition(-3, b) > 2 / 3);
});

test('overall loudness stays constant when the SNR changes', () => {
  for (const snr of [-20, -10, -4, 0, 6, 12]) {
    const { speech, noise } = DIN.levelsFor(snr, 0.1);
    assert.ok(Math.abs(Math.hypot(speech, noise) - 0.1) < 1e-12);
    assert.ok(Math.abs(20 * Math.log10(speech / noise) - snr) < 1e-9);
  }
});

test('FFT round trip', () => {
  const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i) + 0.3 * Math.cos(3 * i));
  const orig = re.slice();
  const im = new Float64Array(64);
  DSP.fft(re, im);
  DSP.fft(re, im, true);
  for (let i = 0; i < 64; i++) assert.ok(Math.abs(re[i] - orig[i]) < 1e-9);
});

test('trim + normalise a recording with silence around a tone', () => {
  const sr = 16000;
  const x = new Float32Array(sr * 2); // 2 s
  for (let i = 0; i < x.length; i++) x[i] = (Math.random() - 0.5) * 0.0005; // quiet room noise
  for (let i = 12000; i < 20000; i++) x[i] += 0.3 * Math.sin((2 * Math.PI * 300 * i) / sr); // 0.5 s "word"
  const t = DSP.trimSilence(x, sr);
  assert.ok(t.length < 0.7 * sr && t.length > 0.5 * sr, `trimmed length ${t.length}`);
  const n = DSP.normalise(t, sr, 0.1);
  assert.ok(Math.abs(DSP.activeRms(n, sr) - 0.1) < 0.01);
  assert.ok(DSP.peak(n) <= 0.95);
});

test('WAV encoder writes a valid header', () => {
  const buf = DSP.encodeWav(new Float32Array(100), 44100);
  const v = new DataView(buf);
  assert.equal(buf.byteLength, 244);
  assert.equal(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)), 'RIFF');
  assert.equal(v.getUint32(24, true), 44100);
});

test('speech-shaped noise has RMS 1 and more low than high frequency energy', () => {
  const sr = 16000;
  const noise = DSP.shapedNoise(sr, DSP.genericSpeechPower, 14);
  assert.ok(Math.abs(DSP.rms(noise) - 1) < 1e-6);
  const spec = DSP.averageSpectrum([noise], sr, 1024);
  const bin = (f) => Math.round((f / sr) * 1024);
  assert.ok(spec[bin(400)] > 10 * spec[bin(4000)]);
});

test('nystagmus: slow drift 0.4 s then fast snap 0.08 s (about 2 beats/s)', () => {
  assert.equal(Effects.nystagmus(0).pos, -1);
  assert.equal(Effects.nystagmus(0.2).fast, false);
  assert.ok(Math.abs(Effects.nystagmus(0.4).pos - 1) < 1e-9);
  assert.equal(Effects.nystagmus(0.44).fast, true);
  const beatsPerSec = 1 / 0.48;
  assert.ok(beatsPerSec >= 2 && beatsPerSec <= 3);
});

test('BPPV: nothing until the head tilts RIGHT, then delay, then a build-up and fade', () => {
  const ep = new Effects.Episode({ condition: 'bppv', intensity: 1, duration: 18, rampSec: 3, bppvLatencySec: 2.5 }, 0);
  let out = ep.update(1000, { tilt: -45 }); // tilting LEFT does nothing
  assert.equal(out.phase, 'waiting');
  assert.equal(out.roll, 0);
  out = ep.update(2000, { tilt: 40 });
  assert.equal(out.phase, 'latency');
  out = ep.update(3000, { tilt: 40 });
  assert.equal(out.roll, 0); // still in the 2.5 s delay
  ep.update(4600, { tilt: 40 }); // delay over -> running
  let maxRoll = 0;
  for (let t = 4600; t < 4600 + 18000; t += 16) {
    out = ep.update(t, { tilt: 40 });
    maxRoll = Math.max(maxRoll, Math.abs(out.roll));
    assert.ok(Math.abs(out.roll) <= 15);
  }
  assert.ok(maxRoll > 12, 'reaches near ±15° at full intensity');
  out = ep.update(4600 + 18001, {});
  assert.equal(out.done, true);
});

test('BPPV ends by itself if the head is never tilted', () => {
  const ep = new Effects.Episode({ condition: 'bppv', intensity: 0.35, duration: 18, bppvWaitMaxSec: 30 }, 0);
  assert.equal(ep.update(29000, { tilt: 0 }).done, false);
  assert.equal(ep.update(30001, { tilt: 0 }).done, true);
  assert.equal(ep.reason, 'noTilt');
});

test('timed conditions: gentle 3 s ramp, never longer than 20 s, limited movement', () => {
  for (const condition of ['neuritis', 'menieres', 'oscillopsia']) {
    const ep = new Effects.Episode({ condition, intensity: 0.35, duration: 60, rampSec: 3 }, 0);
    assert.equal(ep.o.duration, 20, 'duration is capped at 20 s');
    const early = ep.update(100, { yawRate: 200 });
    assert.ok(Math.abs(early.dx) < 0.01, `${condition} starts gently`);
    let done = false;
    for (let t = 116; t <= 20100; t += 16) {
      const o = ep.update(t, { yawRate: 100 * Math.sin(t / 300), pitchRate: 0 });
      assert.ok(Math.abs(o.dx) <= Effects.MAX_SHIFT && Math.abs(o.dy) <= Effects.MAX_SHIFT);
      if (o.done) done = true;
    }
    assert.ok(done, `${condition} finishes within 20 s`);
  }
});

test('oscillopsia: still head = still picture', () => {
  const ep = new Effects.Episode({ condition: 'oscillopsia', intensity: 1, duration: 20 }, 0);
  let o;
  for (let t = 0; t < 8000; t += 16) o = ep.update(t, { yawRate: 0, pitchRate: 0 });
  assert.equal(o.dx, 0);
  assert.equal(o.dy, 0);
  for (let t = 8000; t < 8500; t += 16) o = ep.update(t, { yawRate: 120, pitchRate: 0 });
  assert.ok(Math.abs(o.dx) > 0.05, 'moves when the head turns');
});

test('head roll from gravity (landscape phone in a VR box)', () => {
  // Landscape (screen angle 90): upright head -> gravity reaction along +x.
  assert.ok(Math.abs(Effects.headRoll(9.8, 0, 90)) < 1e-9);
  // Head tilted 35° to the right shoulder.
  const a = (35 * Math.PI) / 180;
  assert.ok(Math.abs(Effects.headRoll(9.8 * Math.cos(a), 9.8 * Math.sin(a), 90) - 35) < 1e-9);
  // Same physical tilt with the phone turned the other way round (screen angle 270).
  assert.ok(Math.abs(Effects.headRoll(-9.8 * Math.cos(a), -9.8 * Math.sin(a), 270) - 35) < 1e-9);
});
