// Digits-in-noise test logic (no sound here – pure rules, so it can be unit-tested with Node).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DIN = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // 3 random digits 0–9, never the same digit twice in a row.
  function makeTriplet(rand = Math.random) {
    const out = [];
    while (out.length < 3) {
      const d = Math.floor(rand() * 10);
      if (out.length && out[out.length - 1] === d) continue;
      out.push(d);
    }
    return out;
  }

  function isCorrect(target, answer) {
    return target.length === answer.length && target.every((d, i) => d === answer[i]);
  }

  // Adaptive 1-up / 1-down staircase.
  // All 3 digits correct -> next trial 2 dB harder (lower SNR); otherwise 2 dB easier.
  class Staircase {
    constructor({ startSnr = 0, stepDb = 2, testTrials = 24, scoreFrom = 5, minSnr = -24, maxSnr = 12 } = {}) {
      Object.assign(this, { startSnr, stepDb, testTrials, scoreFrom, minSnr, maxSnr });
      this.snr = startSnr;
      this.trials = []; // { snr, correct }
    }
    get done() {
      return this.trials.length >= this.testTrials;
    }
    get trialNumber() {
      return this.trials.length + 1;
    }
    record(correct) {
      this.trials.push({ snr: this.snr, correct: !!correct });
      const next = correct ? this.snr - this.stepDb : this.snr + this.stepDb;
      this.snr = Math.min(this.maxSnr, Math.max(this.minSnr, next));
    }
    // Speech Reception Threshold = mean SNR of trials scoreFrom..testTrials (1-based).
    srt() {
      const used = this.trials.slice(this.scoreFrom - 1, this.testTrials);
      if (!used.length) return null;
      return used.reduce((s, t) => s + t.snr, 0) / used.length;
    }
  }

  // Bands for one language: its own calibrated bands if set, otherwise the common ones.
  function bandsFor(bands, lang) {
    const own = bands.perLang && bands.perLang[lang];
    return own || { good: bands.good, refer: bands.refer };
  }

  function bandFor(srt, bands) {
    if (srt <= bands.good) return 'good';
    if (srt <= bands.refer) return 'borderline';
    return 'refer';
  }

  // Split a constant total level between speech and noise for a given SNR (dB),
  // so the overall loudness stays the same while the SNR changes.
  // Returns RMS amplitudes for speech and noise whose combined power = total^2.
  function levelsFor(snrDb, total = 0.1) {
    const r = Math.pow(10, snrDb / 10); // speech power / noise power
    return {
      speech: total * Math.sqrt(r / (1 + r)),
      noise: total * Math.sqrt(1 / (1 + r)),
    };
  }

  // Position of the result on the coloured gauge (0 = left/best, 1 = right/worst).
  // Good band fills 0–1/3, borderline 1/3–2/3, refer 2/3–1. No dB values are shown to visitors.
  function gaugePosition(srt, bands) {
    const span = Math.max(1, bands.refer - bands.good);
    const lo = bands.good - 2 * span;
    const hi = bands.refer + 2 * span;
    let p;
    if (srt <= bands.good) p = ((srt - lo) / (bands.good - lo)) / 3;
    else if (srt <= bands.refer) p = 1 / 3 + ((srt - bands.good) / span) / 3;
    else p = 2 / 3 + ((srt - bands.refer) / (hi - bands.refer)) / 3;
    return Math.min(0.97, Math.max(0.03, p));
  }

  // Normal-listener calibration: mean / SD of their SRTs ...
  function stats(values) {
    const n = values.length;
    if (!n) return { n: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
    return { n, mean: round1(mean), sd: round1(sd), min: Math.min(...values), max: Math.max(...values) };
  }
  const round1 = (x) => Math.round(x * 10) / 10;

  // ... and the suggested bands: GOOD up to mean + 2 SD (rounded up to 0.5 dB), REFER above GOOD + 3 dB.
  function suggestBands(st) {
    if (!st || st.n < 5) return null;
    const good = Math.ceil((st.mean + 2 * Math.max(st.sd, 0.5)) * 2) / 2;
    return { good, refer: good + 3 };
  }

  return { makeTriplet, isCorrect, Staircase, bandsFor, bandFor, levelsFor, gaugePosition, stats, suggestBands };
});
