// Ménière's sounds made in code (no files): ringing (tinnitus), muffled hearing and ear fullness.
// Levels are 0..1 of a hard safety maximum and always change gently (no sudden loud sounds).

const TINNITUS_MAX = 0.05; // sine amplitude ≈ −26 dBFS at 100 %
const MUFFLED_MAX = 0.3; // muffled sound + fullness at 100 %
const MASTER_MAX = 0.6; // final safety limit after the compressor
const FADE_TC = 0.8; // seconds (time constant) for fades in/out

export class SoundFx {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = (this.ac = new AC());

    // Safety chain: compressor (limits peaks) -> master gain (hard cap) -> speakers
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    const master = ac.createGain();
    master.gain.value = MASTER_MAX;
    comp.connect(master).connect(ac.destination);

    // --- tinnitus: steady high ringing tone with a tiny, slow wobble
    this.tinGain = ac.createGain();
    this.tinGain.gain.value = 0;
    this.tinGain.connect(comp);
    const tone = ac.createOscillator();
    tone.frequency.value = 3000;
    const tone2 = ac.createOscillator(); // faint second partial makes it sound like "ringing"
    tone2.frequency.value = 6000;
    const tone2Gain = ac.createGain();
    tone2Gain.gain.value = 0.15;
    const wobble = ac.createOscillator();
    wobble.frequency.value = 0.3;
    const wobbleDepth = ac.createGain();
    wobbleDepth.gain.value = 8;
    wobble.connect(wobbleDepth);
    wobbleDepth.connect(tone.frequency);
    tone.connect(this.tinGain);
    tone2.connect(tone2Gain).connect(this.tinGain);
    [tone, tone2, wobble].forEach((o) => o.start());

    // --- muffled hearing: babble-like noise behind a strong low-pass ("like through a wall"),
    //     with a slow syllable-like rhythm; plus fullness: a deep pressure rumble.
    this.mufGain = ac.createGain();
    this.mufGain.gain.value = 0;
    this.mufGain.connect(comp);

    const pink = this.makeNoise(ac, 'pink');
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 450;
    lp.Q.value = 0.7;
    const syllables = ac.createGain();
    syllables.gain.value = 0.6;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 3.5;
    const lfoDepth = ac.createGain();
    lfoDepth.gain.value = 0.35;
    lfo.connect(lfoDepth).connect(syllables.gain);
    pink.connect(lp).connect(syllables).connect(this.mufGain);

    const brown = this.makeNoise(ac, 'brown');
    const lp2 = ac.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 140;
    const pressure = ac.createGain();
    pressure.gain.value = 0.9;
    const slow = ac.createOscillator();
    slow.frequency.value = 0.2;
    const slowDepth = ac.createGain();
    slowDepth.gain.value = 0.3;
    slow.connect(slowDepth).connect(pressure.gain);
    brown.connect(lp2).connect(pressure).connect(this.mufGain);
    [pink, brown, lfo, slow].forEach((o) => o.start());

    this.testUntil = 0;
  }

  makeNoise(ac, kind) {
    const len = ac.sampleRate * 4;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  resume() {
    if (this.ac.state === 'suspended') this.ac.resume();
  }

  // level: 0..1 from the effect envelope; vol: { tinnitusVolume, muffledVolume } from the host settings.
  set(level, vol, instant) {
    if (this.ac.currentTime < this.testUntil && !instant) return; // a test sound is playing
    const now = this.ac.currentTime;
    const tc = instant ? 0.01 : FADE_TC;
    const l = Math.max(0, Math.min(1, level));
    const tin = l * clamp01(vol.tinnitusVolume) * TINNITUS_MAX;
    const muf = l * clamp01(vol.muffledVolume) * MUFFLED_MAX;
    // Called every frame: only schedule a change when the target really changes.
    if (!instant && this.last && Math.abs(this.last.tin - tin) < 1e-4 && Math.abs(this.last.muf - muf) < 1e-4) return;
    this.last = { tin, muf };
    this.tinGain.gain.setTargetAtTime(tin, now, tc);
    this.mufGain.gain.setTargetAtTime(muf, now, tc);
    if (instant) this.testUntil = 0;
  }

  // Host "Test sound": one layer for 3 s, fading in and out gently.
  test(kind, vol) {
    this.resume();
    const now = this.ac.currentTime;
    const g = kind === 'tinnitus' ? this.tinGain : this.mufGain;
    const other = kind === 'tinnitus' ? this.mufGain : this.tinGain;
    const target = kind === 'tinnitus' ? clamp01(vol.tinnitusVolume) * TINNITUS_MAX : clamp01(vol.muffledVolume) * MUFFLED_MAX;
    other.gain.setTargetAtTime(0, now, 0.05);
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(target, now, 0.4);
    g.gain.setTargetAtTime(0, now + 2.5, 0.4);
    this.testUntil = now + 4;
    this.last = null;
  }
}

function clamp01(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export const LIMITS = { TINNITUS_MAX, MUFFLED_MAX, MASTER_MAX };
