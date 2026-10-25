// Anonymous hearing results: { id, time, lang, srt, band, calib } – no names, nothing personal.
// calib = true: a test by a person with normal hearing, used to calibrate the result bands (not counted as a visitor).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LANGS = ['en', 'ta', 'si'];
const BANDS = ['good', 'borderline', 'refer'];
const { stats, suggestBands } = require('../public/ear/js/din.js'); // shared with the tablet's own hearing-test file

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
  // Results copied from a tablet that runs the hearing test on its own (its CSV file).
  // An id already here is skipped, so importing the same file twice adds nothing.
  importMany(list) {
    const known = new Set(this.items.map((r) => r.id));
    let added = 0;
    let skipped = 0;
    for (const r of Array.isArray(list) ? list : []) {
      const srt = Number(r && r.srt);
      const time = new Date(r && r.time);
      const ok = r && LANGS.includes(r.lang) && BANDS.includes(r.band) && Number.isFinite(srt) && Math.abs(srt) <= 40 && !isNaN(time);
      const id = ok && typeof r.id === 'string' && /^[\w-]{6,64}$/.test(r.id) ? r.id : null;
      if (!ok || !id || known.has(id)) {
        skipped++;
        continue;
      }
      const entry = { id, time: time.toISOString(), lang: r.lang, srt: Math.round(srt * 10) / 10, band: r.band };
      if (r.calib) entry.calib = true;
      this.items.push(entry);
      known.add(id);
      added++;
    }
    if (added) {
      this.items.sort((a, b) => String(a.time).localeCompare(String(b.time)));
      this.save();
    }
    return { added, skipped };
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
    const rows = ['time,lang,srt_db,band,normal_listener,id'];
    for (const r of this.items) rows.push([r.time, r.lang, r.srt, r.band, r.calib ? 'yes' : '', r.id].join(','));
    return rows.join('\n') + '\n';
  }
}

module.exports = { ResultsStore, stats, suggestBands };
