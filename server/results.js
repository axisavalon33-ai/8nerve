// Anonymous hearing results: { time, lang, srt, band } – no names, nothing personal.
const fs = require('fs');
const path = require('path');

class ResultsStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'ear_results.json');
    this.items = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(parsed)) this.items = parsed;
    } catch {
      /* no results yet */
    }
  }
  add(entry) {
    this.items.push(entry);
    this.save();
    return entry;
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
    for (const r of this.items) {
      counts.total++;
      if (String(r.time).startsWith(today)) counts.today++;
      if (r.band in counts.byBand) counts.byBand[r.band]++;
      if (r.lang in counts.byLang) counts.byLang[r.lang]++;
    }
    return { counts, recent: this.items.slice(-30).reverse() };
  }
  csv() {
    const rows = ['time,lang,srt_db,band'];
    for (const r of this.items) rows.push([r.time, r.lang, r.srt, r.band].join(','));
    return rows.join('\n') + '\n';
  }
}

module.exports = { ResultsStore };
