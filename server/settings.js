// Settings for the Ear & Balance station.
// Stored in data/settings.json; anything missing falls back to DEFAULTS.
const fs = require('fs');
const path = require('path');

const CONDITIONS = ['bppv', 'neuritis', 'menieres', 'oscillopsia'];
const INTENSITY_LEVELS = { low: 0.35, medium: 0.6, high: 0.85 };
const MAX_CONDITION_SEC = 20;

const DEFAULTS = {
  pin: '2468',
  // Result bands (PLACEHOLDERS – confirm with an ENT / audiology lecturer).
  // SRT <= good -> GOOD, good < SRT <= refer -> BORDERLINE, SRT > refer -> REFER
  bands: { good: -10, refer: -7 },
  din: {
    practiceTrials: 2,
    testTrials: 24,
    scoreFrom: 5, // SRT = mean SNR of trials scoreFrom..testTrials
    startSnr: 0,
    stepDb: 2,
    practiceSnr: 4,
    minSnr: -24,
    maxSnr: 12,
    digitGapSec: 0.5,
  },
  idleTimeoutSec: 60,
  testIdleTimeoutSec: 180, // safety net if a visitor walks away in the middle of a test (0 = never)
  vr: {
    intensity: 'low',
    durations: { bppv: 18, neuritis: 20, menieres: 20, oscillopsia: 20 },
    rampSec: 3,
    bppvTiltDeg: 30,
    bppvLatencySec: 2.5,
    bppvWaitMaxSec: 30,
    invertTilt: false,
    menieresVolume: 0.5, // 0..1, is multiplied by a hard safety cap on the phone
  },
};

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Takes any object (e.g. from the host form) and returns a complete, safe settings object.
function sanitize(input, base = DEFAULTS) {
  const s = input && typeof input === 'object' ? input : {};
  const b = s.bands || {};
  const d = s.din || {};
  const v = s.vr || {};
  const vd = v.durations || {};
  const out = {
    pin: typeof s.pin === 'string' && /^\d{4,8}$/.test(s.pin) ? s.pin : base.pin,
    bands: {
      good: clampNum(b.good, -30, 10, base.bands.good),
      refer: clampNum(b.refer, -30, 10, base.bands.refer),
    },
    din: {
      practiceTrials: Math.round(clampNum(d.practiceTrials, 0, 5, base.din.practiceTrials)),
      testTrials: Math.round(clampNum(d.testTrials, 6, 40, base.din.testTrials)),
      scoreFrom: Math.round(clampNum(d.scoreFrom, 1, 20, base.din.scoreFrom)),
      startSnr: clampNum(d.startSnr, -20, 10, base.din.startSnr),
      stepDb: clampNum(d.stepDb, 0.5, 6, base.din.stepDb),
      practiceSnr: clampNum(d.practiceSnr, -10, 15, base.din.practiceSnr),
      minSnr: clampNum(d.minSnr, -30, 0, base.din.minSnr),
      maxSnr: clampNum(d.maxSnr, 0, 20, base.din.maxSnr),
      digitGapSec: clampNum(d.digitGapSec, 0.2, 1.5, base.din.digitGapSec),
    },
    idleTimeoutSec: Math.round(clampNum(s.idleTimeoutSec, 15, 600, base.idleTimeoutSec)),
    testIdleTimeoutSec: Math.round(clampNum(s.testIdleTimeoutSec, 0, 1800, base.testIdleTimeoutSec)),
    vr: {
      intensity: Object.hasOwn(INTENSITY_LEVELS, v.intensity) ? v.intensity : base.vr.intensity,
      durations: {},
      rampSec: clampNum(v.rampSec, 1, 6, base.vr.rampSec),
      bppvTiltDeg: clampNum(v.bppvTiltDeg, 10, 60, base.vr.bppvTiltDeg),
      bppvLatencySec: clampNum(v.bppvLatencySec, 0, 5, base.vr.bppvLatencySec),
      bppvWaitMaxSec: clampNum(v.bppvWaitMaxSec, 5, 120, base.vr.bppvWaitMaxSec),
      invertTilt: typeof v.invertTilt === 'boolean' ? v.invertTilt : base.vr.invertTilt,
      menieresVolume: clampNum(v.menieresVolume, 0, 1, base.vr.menieresVolume),
    },
  };
  for (const c of CONDITIONS) {
    out.vr.durations[c] = clampNum(vd[c], 5, MAX_CONDITION_SEC, base.vr.durations[c]);
  }
  // The good limit must not be above the refer limit.
  if (out.bands.good > out.bands.refer) out.bands.good = out.bands.refer;
  if (out.din.scoreFrom > out.din.testTrials) out.din.scoreFrom = 1;
  return out;
}

// Deep-merge `patch` over `current` and sanitize the result.
function merge(current, patch) {
  const m = JSON.parse(JSON.stringify(current));
  (function walk(dst, src) {
    for (const [k, val] of Object.entries(src || {})) {
      if (val && typeof val === 'object' && !Array.isArray(val) && dst[k] && typeof dst[k] === 'object') walk(dst[k], val);
      else dst[k] = val;
    }
  })(m, patch);
  return sanitize(m, current);
}

class SettingsStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'settings.json');
    this.value = sanitize(DEFAULTS);
    try {
      this.value = sanitize(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      /* first run – keep defaults */
    }
    if (process.env.EAR_PIN && /^\d{4,8}$/.test(process.env.EAR_PIN)) this.value.pin = process.env.EAR_PIN;
  }
  get() {
    return this.value;
  }
  // Settings that the visitor pages are allowed to see (no PIN).
  publicView() {
    const { pin, ...rest } = this.value;
    return { ...rest, intensityLevels: INTENSITY_LEVELS };
  }
  update(patch) {
    this.value = merge(this.value, patch);
    this.save();
    return this.value;
  }
  reset() {
    const pin = this.value.pin;
    this.value = sanitize({ ...DEFAULTS, pin });
    this.save();
    return this.value;
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.value, null, 2));
  }
}

function bandFor(srt, bands) {
  if (srt <= bands.good) return 'good';
  if (srt <= bands.refer) return 'borderline';
  return 'refer';
}

module.exports = { SettingsStore, DEFAULTS, CONDITIONS, INTENSITY_LEVELS, MAX_CONDITION_SEC, sanitize, merge, bandFor };
