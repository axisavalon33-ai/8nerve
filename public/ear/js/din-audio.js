// Plays digit triplets mixed with speech-shaped steady noise (Web Audio API).
(function (global) {
  const TOTAL_RMS = 0.1; // combined speech + noise level before the volume control (about -20 dBFS)

  class DinAudio {
    constructor() {
      this.ctx = null;
      this.digits = {}; // digit -> { buffer, rms }
      this.noise = null;
      this.lang = null;
      this.volume = 0.5;
      this.current = []; // playing sources (so they can be stopped)
    }

    // Must be called from a tap (browsers only allow sound after a user gesture).
    unlock() {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.setVolume(this.volume);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    // Slider 0..1 -> gain on a dB scale from -40 dB to +6 dB, so the slider feels even.
    setVolume(v) {
      this.volume = Math.min(1, Math.max(0, v));
      if (!this.master) return;
      const db = -40 + this.volume * 46;
      this.master.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.03);
    }

    // Load the 10 digit recordings of one language and build matching speech-shaped noise.
    async load(lang, manifest) {
      this.unlock();
      const urls = manifest[lang] || {};
      if (Object.keys(urls).length < 10) return false;
      // Same set of files as last time (the URLs change when a file changes): nothing to reload.
      const key = lang + JSON.stringify(urls);
      if (this.loadedKey === key && this.noise) return true;
      const ctx = this.ctx;
      const entries = await Promise.all(
        Object.entries(urls).map(async ([d, url]) => {
          const res = await fetch(url);
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          const mono = buf.getChannelData(0);
          return [d, { buffer: buf, rms: DSP.activeRms(mono, buf.sampleRate) || 0.1 }];
        }),
      );
      this.digits = Object.fromEntries(entries);
      const signals = entries.map(([, e]) => e.buffer.getChannelData(0));
      const sr = ctx.sampleRate;
      const spec = DSP.averageSpectrum(signals, entries[0][1].buffer.sampleRate);
      const powerAt = spec ? DSP.spectrumFunction(spec, entries[0][1].buffer.sampleRate) : DSP.genericSpeechPower;
      const data = DSP.shapedNoise(sr, powerAt, 17);
      this.noise = ctx.createBuffer(1, data.length, sr);
      this.noise.copyToChannel(data, 0);
      this.lang = lang;
      this.loadedKey = key;
      return true;
    }

    stop() {
      for (const s of this.current) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      this.current = [];
    }

    // Play 3 digits in noise at the given SNR. Resolves when the sound has finished.
    playTriplet(digits, snrDb, gapSec = 0.5) {
      const ctx = this.ctx;
      this.stop();
      const { speech, noise } = DIN.levelsFor(snrDb, TOTAL_RMS);
      const t0 = ctx.currentTime + 0.05;
      const lead = 0.5; // noise starts a little before the first digit
      const fade = 0.12;

      let t = t0 + lead;
      for (const d of digits) {
        const info = this.digits[d];
        const src = ctx.createBufferSource();
        src.buffer = info.buffer;
        const g = ctx.createGain();
        g.gain.value = speech / info.rms;
        src.connect(g).connect(this.master);
        src.start(t);
        this.current.push(src);
        t += info.buffer.duration + gapSec;
      }
      const end = t - gapSec + 0.4;

      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      n.loop = true;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, t0);
      ng.gain.linearRampToValueAtTime(noise, t0 + fade);
      ng.gain.setValueAtTime(noise, end - fade);
      ng.gain.linearRampToValueAtTime(0, end);
      n.connect(ng).connect(this.master);
      n.start(t0, Math.random() * this.noise.duration);
      n.stop(end + 0.05);
      this.current.push(n);

      return new Promise((resolve) => {
        n.onended = () => resolve();
      });
    }
  }

  global.DinAudio = DinAudio;
})(window);
