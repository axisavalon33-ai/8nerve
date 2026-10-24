// Settings for the Ear & Balance station.
// Stored in data/settings.json; anything missing falls back to DEFAULTS.
const fs = require('fs');
const path = require('path');

const CONDITIONS = ['bppv', 'neuritis', 'menieres', 'oscillopsia'];
const INTENSITY_LEVELS = { low: 0.35, medium: 0.6, high: 0.85 };
const MIN_CONDITION_SEC = 10;
const MAX_CONDITION_SEC = 60;
const SETTINGS_VERSION = 2; // version 2: 30 s conditions, separate tinnitus / muffled volumes

// VR headset calibration (set live from the hidden panel on the tablet). [min, max, default]
const CAL_LIMITS = {
  distortion: [0, 1, 0.25],
  zoom: [0.4, 2.5, 1.0],
  ipd: [0.3, 0.7, 0.5],
  vertical: [-0.25, 0.25, 0],
  eyeSize: [0.4, 1.3, 0.92],
  roundness: [0, 1, 1.0],
  noseWidth: [0, 0.4, 0.12],
  noseHeight: [0, 0.6, 0.22],
  divider: [0, 0.06, 0.006],
  pictureSize: [0.8, 2.2, 1.6],
};
const CAL_DEFAULTS = Object.fromEntries(Object.entries(CAL_LIMITS).map(([k, v]) => [k, v[2]]));

const DEFAULTS = {
  pin: '2468',
  // Result bands (PLACEHOLDERS – confirm with an ENT / audiology lecturer).
  // SRT <= good -> GOOD, good < SRT <= refer -> BORDERLINE, SRT > refer -> REFER
  // perLang: optional own bands per language (set from "Calibrate with normal listeners"); null = use the common ones.
  bands: { good: -10, refer: -7, perLang: { en: null, ta: null, si: null } },
  calibrationMode: false, // ON: new results are marked as "normal listener" (calibration), not visitors
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
    intensity: 0.35, // 0.1–1 (Low 0.35 / Medium 0.6 / High 0.85)
    durations: { bppv: 30, neuritis: 30, menieres: 30, oscillopsia: 30 }, // 10–60 s, + / − on the host page
    rampSec: 3,
    bppvTiltDeg: 30,
    bppvLatencySec: 2.5,
    bppvWaitMaxSec: 30,
    invertTilt: false,
    // Ménière's sounds, 0..1 of a hard safety maximum on the phone
    tinnitusVolume: 0.3,
    muffledVolume: 0.5,
    oscillopsiaSensitivity: 1, // 0..3
  },
  vrCal: CAL_DEFAULTS,
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
      perLang: {},
    },
    calibrationMode: typeof s.calibrationMode === 'boolean' ? s.calibrationMode : !!base.calibrationMode,
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
      intensity: intensityValue(v.intensity, base.vr.intensity),
      durations: {},
      rampSec: clampNum(v.rampSec, 1, 6, base.vr.rampSec),
      bppvTiltDeg: clampNum(v.bppvTiltDeg, 10, 60, base.vr.bppvTiltDeg),
      bppvLatencySec: clampNum(v.bppvLatencySec, 0, 5, base.vr.bppvLatencySec),
      bppvWaitMaxSec: clampNum(v.bppvWaitMaxSec, 5, 120, base.vr.bppvWaitMaxSec),
      invertTilt: typeof v.invertTilt === 'boolean' ? v.invertTilt : base.vr.invertTilt,
      tinnitusVolume: clampNum(v.tinnitusVolume, 0, 1, base.vr.tinnitusVolume),
      muffledVolume: clampNum(v.muffledVolume, 0, 1, base.vr.muffledVolume),
      oscillopsiaSensitivity: clampNum(v.oscillopsiaSensitivity, 0, 3, base.vr.oscillopsiaSensitivity),
    },
  };
  out.vrCal = sanitizeCal(s.vrCal, base.vrCal);
  for (const c of CONDITIONS) {
    out.vr.durations[c] = Math.round(clampNum(vd[c], MIN_CONDITION_SEC, MAX_CONDITION_SEC, base.vr.durations[c]));
  }
  // The good limit must not be above the refer limit.
  if (out.bands.good > out.bands.refer) out.bands.good = out.bands.refer;
  const pl = b.perLang || {};
  const basePl = (base.bands && base.bands.perLang) || {};
  for (const lang of ['en', 'ta', 'si']) {
    const src = lang in pl ? pl[lang] : basePl[lang];
    if (src && typeof src === 'object' && Number.isFinite(Number(src.good)) && Number.isFinite(Number(src.refer))) {
      const good = clampNum(src.good, -30, 10, out.bands.good);
      const refer = clampNum(src.refer, -30, 10, out.bands.refer);
      out.bands.perLang[lang] = { good: Math.min(good, refer), refer };
    } else {
      out.bands.perLang[lang] = null;
    }
  }
  if (out.din.scoreFrom > out.din.testTrials) out.din.scoreFrom = 1;
  return out;
}

function sanitizeCal(input, base = CAL_DEFAULTS) {
  const c = input && typeof input === 'object' ? input : {};
  const b = base || CAL_DEFAULTS;
  const out = {};
  for (const [k, [min, max, def]] of Object.entries(CAL_LIMITS)) {
    out[k] = clampNum(c[k], min, max, b[k] !== undefined ? b[k] : def);
  }
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
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // Older settings files: take the new default lengths (30 s) and sound levels.
      if ((saved.version || 1) < SETTINGS_VERSION && saved.vr) {
        delete saved.vr.durations;
        delete saved.vr.menieresVolume;
      }
      this.value = sanitize(saved);
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
    // Keeps the PIN and the headset calibration (those belong to this hardware).
    const { pin, vrCal } = this.value;
    this.value = sanitize({ ...DEFAULTS, pin, vrCal });
    this.save();
    return this.value;
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ version: SETTINGS_VERSION, ...this.value }, null, 2));
  }
}

// Intensity as a number 0.1–1; older settings used the words low / medium / high.
function intensityValue(v, fallback) {
  if (typeof v === 'string' && Object.hasOwn(INTENSITY_LEVELS, v)) return INTENSITY_LEVELS[v];
  const fb = typeof fallback === 'string' ? INTENSITY_LEVELS[fallback] || 0.35 : fallback;
  return Math.round(clampNum(v, 0.1, 1, fb) * 100) / 100;
}

// The bands that apply to one language: its own calibrated bands, or the common ones.
function bandsFor(bands, lang) {
  const own = bands.perLang && bands.perLang[lang];
  return own || { good: bands.good, refer: bands.refer };
}

function bandFor(srt, bands) {
  if (srt <= bands.good) return 'good';
  if (srt <= bands.refer) return 'borderline';
  return 'refer';
}

module.exports = { SettingsStore, DEFAULTS, bandsFor, intensityValue, CAL_LIMITS, CAL_DEFAULTS, sanitizeCal, CONDITIONS, INTENSITY_LEVELS, MIN_CONDITION_SEC, MAX_CONDITION_SEC, sanitize, merge, bandFor };
