// The hearing test as ONE file for a tablet that works on its own (no laptop, no Wi-Fi).
// Everything is put inside the file: page, styles, fonts, texts, the digit recordings and the current settings.
// Results stay on the tablet (browser storage) and can be downloaded there as a CSV file.
const fs = require('fs');
const path = require('path');
const { digitStatus, digitManifest } = require('./media');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const MIME = { wav: 'audio/wav', mp3: 'audio/mpeg', webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', woff2: 'font/woff2', png: 'image/png' };

const dataUrl = (file) => `data:${MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream'};base64,${fs.readFileSync(file).toString('base64')}`;
const readPublic = (rel) => fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
// Text placed inside <script> / <style> must not close the tag early.
const safeScript = (js) => js.replace(/<\/script/gi, '<\\/script');
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

// /media/ear/digits/en/3.wav?v=123 -> data:audio/wav;base64,...
function embedDigits(mediaDir) {
  const manifest = digitManifest(mediaDir);
  const out = {};
  for (const [lang, urls] of Object.entries(manifest)) {
    out[lang] = {};
    for (const [d, url] of Object.entries(urls)) {
      const rel = decodeURIComponent(url.split('?')[0].replace(/^\/media\//, ''));
      out[lang][d] = dataUrl(path.join(mediaDir, rel));
    }
  }
  return out;
}

// settings: the full settings (incl. PIN – it opens the staff panel on the tablet).
function buildHearingFile({ mediaDir, settings }) {
  const status = digitStatus(mediaDir);
  const standalone = {
    builtAt: new Date().toISOString(),
    pin: settings.pin,
    config: {
      din: settings.din,
      bands: settings.bands,
      idleTimeoutSec: settings.idleTimeoutSec,
      testIdleTimeoutSec: settings.testIdleTimeoutSec,
    },
    // Which voice each language uses (recorded / generated / none) – shown in the staff panel.
    digitSource: Object.fromEntries(Object.entries(status).map(([l, s]) => [l, s.source])),
    manifest: embedDigits(mediaDir),
    translations: JSON.parse(readPublic('shared/translations.json')),
  };

  const fontsCss = readPublic('shared/fonts.css').replace(/url\(\/fonts\/([\w.-]+\.woff2)\)/g, (m, f) => `url(${dataUrl(path.join(PUBLIC, 'fonts', f))})`);
  const style = (css) => `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
  const script = (js) => `<script>\n${safeScript(js)}\n</script>`;
  const icon = dataUrl(path.join(PUBLIC, 'icons', 'icon-192.png'));

  let html = readPublic('ear/index.html');
  html = html
    .replace(/<title>[^<]*<\/title>/, '<title>Hearing test</title>')
    .replace(/\s*<link rel="manifest"[^>]*>/, '')
    .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
    // (functions as replacements, so a "$" inside the inserted code is kept as it is)
    .replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" href="${icon}" />`)
    .replace('<link rel="stylesheet" href="/shared/fonts.css" />', () => style(fontsCss))
    .replace('<link rel="stylesheet" href="/shared/style.css" />', () => style(readPublic('shared/style.css')))
    .replace('<link rel="stylesheet" href="/ear/ear.css" />', () => style(readPublic('ear/ear.css')))
    .replace(/\s*<script src="\/socket\.io\/socket\.io\.js"><\/script>/, () => `\n    <script>window.EAR_STANDALONE = ${safeJson(standalone)};</script>`)
    .replace(/<script src="\/([\w/.-]+\.js)"><\/script>/g, (m, rel) => script(readPublic(rel)))
    .replace('</body>', () => `${script(readPublic('ear/js/tablet-staff.js'))}\n  </body>`);
  if (/<(script|link)[^>]+(src|href)="\//.test(html)) throw new Error('hearing file still links to the server');
  return html;
}

module.exports = { buildHearingFile };
