// Anonymous hearing results: { id, time, lang, srt, band, calib } – no names, nothing personal.
// calib = true: a test by a person with normal hearing, used to calibrate the result bands (not counted as a visitor).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LANGS = ['en', 'ta', 'si'];

function stats(values) {
  const n = values.length;
  if (!n) return { n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean: round1(mean), sd: round1(sd), min: Math.min(...values), max: Math.max(...values) };
}
const round1 = (x) => Math.round(x * 10) / 10;

// Suggested bands from normal listeners: GOOD up to mean + 2 SD (rounded up to 0.5 dB), REFER above GOOD + 3 dB.
function suggestBands(st) {
  if (!st || st.n < 5) return null;
  const good = Math.ceil((st.mean + 2 * Math.max(st.sd, 0.5)) * 2) / 2;
  return { good, refer: good + 3 };
}

class ResultsStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'ear_results.json');
    this.items = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(parsed)) this.items = parsed;
      for (const r of this.items) if (!r.id) r.id = crypto.randomUUID(); // older files had no ids
    } catch {
      /* no results yet */
    }
  }
  add(entry) {
    entry = { id: crypto.randomUUID(), ...entry };
    this.items.push(entry);
    this.save();
    return entry;
  }
  setCalib(id, calib) {
    const r = this.items.find((x) => x.id === id);
    if (!r) return null;
    if (calib) r.calib = true;
    else delete r.calib;
    this.save();
    return r;
  }
  clearCalibration() {
    for (const r of this.items) delete r.calib;
    this.save();
  }
  clear() {
    this.items = [];
    this.save();
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // Write to a temp file first so a power cut cannot leave a half-written file.
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.items, null, 1));
    fs.renameSync(tmp, this.file);
  }
  summary() {
    const today = new Date().toISOString().slice(0, 10);
    const counts = { total: 0, today: 0, byBand: { good: 0, borderline: 0, refer: 0 }, byLang: { en: 0, ta: 0, si: 0 } };
    const calibration = {};
    for (const lang of LANGS) {
      const values = this.items.filter((r) => r.calib && r.lang === lang).map((r) => r.srt);
      const st = stats(values);
      calibration[lang] = { ...st, values, suggested: suggestBands(st) };
    }
    for (const r of this.items) {
      if (r.calib) continue; // normal-listener tests are not visitors
      counts.total++;
      if (String(r.time).startsWith(today)) counts.today++;
      if (r.band in counts.byBand) counts.byBand[r.band]++;
      if (r.lang in counts.byLang) counts.byLang[r.lang]++;
    }
    return { counts, recent: this.items.slice(-40).reverse(), calibration };
  }
  csv() {
    const rows = ['time,lang,srt_db,band,normal_listener'];
    for (const r of this.items) rows.push([r.time, r.lang, r.srt, r.band, r.calib ? 'yes' : ''].join(','));
    return rows.join('\n') + '\n';
  }
}

module.exports = { ResultsStore, stats, suggestBands };
