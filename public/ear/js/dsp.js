// Small signal-processing helpers (pure functions on Float32Array, testable with Node).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DSP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // In-place radix-2 FFT. re/im are Float64Array of length 2^k. inverse=true gives the IFFT (scaled 1/N).
  function fft(re, im, inverse = false) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = ((inverse ? 2 : -2) * Math.PI) / len;
      const wr = Math.cos(ang);
      const wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1;
        let ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k;
          const b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci;
          const xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
          const t = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = t;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }

  function rms(x, start = 0, end = x.length) {
    let s = 0;
    for (let i = start; i < end; i++) s += x[i] * x[i];
    return end > start ? Math.sqrt(s / (end - start)) : 0;
  }

  // RMS of the "speech" part only: 20 ms frames, ignoring frames more than 30 dB below the loudest.
  // This makes the level of a short digit independent of how much silence is around it.
  function activeRms(x, sampleRate) {
    const frame = Math.max(1, Math.round(sampleRate * 0.02));
    const frames = [];
    for (let i = 0; i + frame <= x.length; i += frame) frames.push(rms(x, i, i + frame));
    if (!frames.length) return rms(x);
    const max = Math.max(...frames);
    if (max === 0) return 0;
    const thr = max * Math.pow(10, -30 / 20);
    let p = 0;
    let n = 0;
    for (const f of frames) {
      if (f >= thr) {
        p += f * f;
        n++;
      }
    }
    return Math.sqrt(p / n);
  }

  function peak(x) {
    let m = 0;
    for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
    return m;
  }

  // Cut silence at the start and end of a recording (keeps a little padding) and add tiny fades.
  function trimSilence(x, sampleRate, { thresholdDb = -30, padSec = 0.06, fadeSec = 0.01 } = {}) {
    const frame = Math.max(1, Math.round(sampleRate * 0.01));
    const levels = [];
    for (let i = 0; i < x.length; i += frame) levels.push(rms(x, i, Math.min(x.length, i + frame)));
    const max = Math.max(0, ...levels);
    if (max === 0) return x.slice(0);
    const thr = max * Math.pow(10, thresholdDb / 20);
    let first = levels.findIndex((l) => l >= thr);
    let last = levels.length - 1;
    while (last > first && levels[last] < thr) last--;
    const pad = Math.round(padSec * sampleRate);
    const start = Math.max(0, first * frame - pad);
    const end = Math.min(x.length, (last + 1) * frame + pad);
    const out = x.slice(start, end);
    const fade = Math.min(Math.round(fadeSec * sampleRate), Math.floor(out.length / 2));
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      out[i] *= g;
      out[out.length - 1 - i] *= g;
    }
    return out;
  }

  // Bring the speech level to targetRms (default -20 dBFS) without letting peaks go above 0.95.
  function normalise(x, sampleRate, targetRms = 0.1, maxPeak = 0.95) {
    const a = activeRms(x, sampleRate);
    if (!a) return x.slice(0);
    let g = targetRms / a;
    const p = peak(x) * g;
    if (p > maxPeak) g *= maxPeak / p;
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = x[i] * g;
    return out;
  }

  // 16-bit PCM mono WAV file as an ArrayBuffer.
  function encodeWav(x, sampleRate) {
    const buf = new ArrayBuffer(44 + x.length * 2);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    v.setUint32(4, 36 + x.length * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, x.length * 2, true);
    for (let i = 0; i < x.length; i++) {
      const s = Math.max(-1, Math.min(1, x[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  // Average power spectrum (frameSize bins) of the loud parts of several signals.
  function averageSpectrum(signals, sampleRate, frameSize = 1024) {
    const acc = new Float64Array(frameSize / 2 + 1);
    const win = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
    let count = 0;
    const re = new Float64Array(frameSize);
    const im = new Float64Array(frameSize);
    for (const x of signals) {
      const level = activeRms(x, sampleRate);
      if (!level) continue;
      const thr = level * 0.1; // skip frames > 20 dB below the speech level
      for (let s = 0; s + frameSize <= x.length; s += frameSize / 2) {
        if (rms(x, s, s + frameSize) < thr) continue;
        for (let i = 0; i < frameSize; i++) {
          re[i] = x[s + i] * win[i];
          im[i] = 0;
        }
        fft(re, im);
        for (let k = 0; k <= frameSize / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
        count++;
      }
    }
    if (!count) return null;
    for (let k = 0; k < acc.length; k++) acc[k] /= count;
    return acc;
  }

  // Typical long-term speech spectrum (used when there are no recordings to measure):
  // flat up to 500 Hz, then falling about 9 dB per octave, with a gentle low cut below 100 Hz.
  function genericSpeechPower(freq) {
    let db = 0;
    if (freq > 500) db = -9 * Math.log2(freq / 500);
    if (freq < 100) db -= 12 * Math.log2(100 / Math.max(freq, 20));
    return Math.pow(10, db / 10);
  }

  // Steady noise with the given power spectrum (random phase), length 2^log2n samples, RMS = 1.
  // Because it is built in the frequency domain, it loops seamlessly.
  function shapedNoise(sampleRate, powerAt, log2n = 17, rand = Math.random) {
    const n = 1 << log2n;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let k = 1; k < n / 2; k++) {
      const f = (k * sampleRate) / n;
      const mag = Math.sqrt(Math.max(0, powerAt(f)));
      const ph = rand() * 2 * Math.PI;
      re[k] = mag * Math.cos(ph);
      im[k] = mag * Math.sin(ph);
      re[n - k] = re[k];
      im[n - k] = -im[k];
    }
    fft(re, im, true);
    const out = new Float32Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) s += re[i] * re[i];
    const g = s > 0 ? 1 / Math.sqrt(s / n) : 0;
    for (let i = 0; i < n; i++) out[i] = re[i] * g;
    return out;
  }

  // Turn an averageSpectrum() result into a powerAt(freq) function (linear interpolation).
  function spectrumFunction(spec, sampleRate, frameSize = 1024) {
    return (f) => {
      const pos = (f / sampleRate) * frameSize;
      const i = Math.floor(pos);
      if (i >= spec.length - 1) return spec[spec.length - 1];
      const t = pos - i;
      return spec[i] * (1 - t) + spec[i + 1] * t;
    };
  }

  return { fft, rms, activeRms, peak, trimSilence, normalise, encodeWav, averageSpectrum, genericSpeechPower, shapedNoise, spectrumFunction };
});
