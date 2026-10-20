// Which audio files exist in media/ and which ones are used.
//   media/ear/digits/<lang>/N.*            my recordings (from /ear/record or uploaded on the host page)
//   media/ear/digits-generated/<lang>/N.wav placeholders made with espeak-ng
//   media/vr/voice/<condition>/<lang>.*     my own spoken instruction for a VR condition
const fs = require('fs');
const path = require('path');

const LANGS = ['en', 'ta', 'si'];
const AUDIO_EXTS = ['mp3', 'wav', 'webm', 'ogg', 'm4a']; // first one found is used

// URL of dir/base.<ext> (first existing extension), with ?v= so browsers never play an old cached copy.
function findAudio(mediaDir, relDir, base) {
  for (const ext of AUDIO_EXTS) {
    const f = path.join(mediaDir, relDir, `${base}.${ext}`);
    if (fs.existsSync(f)) {
      const v = Math.round(fs.statSync(f).mtimeMs);
      return `/media/${relDir.split(path.sep).join('/')}/${base}.${ext}?v=${v}`;
    }
  }
  return null;
}

function removeAudio(mediaDir, relDir, base) {
  for (const ext of AUDIO_EXTS) fs.rmSync(path.join(mediaDir, relDir, `${base}.${ext}`), { force: true });
}

// Per language: my recordings, generated digits, and which complete set is used.
// Rule: my recordings only when all 10 exist, otherwise the generated set. Never mixed.
function digitStatus(mediaDir) {
  const out = {};
  for (const lang of LANGS) {
    const recorded = {};
    const generated = {};
    for (let d = 0; d <= 9; d++) {
      const r = findAudio(mediaDir, path.join('ear', 'digits', lang), String(d));
      const g = findAudio(mediaDir, path.join('ear', 'digits-generated', lang), String(d));
      if (r) recorded[d] = r;
      if (g) generated[d] = g;
    }
    const nRec = Object.keys(recorded).length;
    const nGen = Object.keys(generated).length;
    const source = nRec === 10 ? 'recorded' : nGen === 10 ? 'generated' : null;
    out[lang] = { recorded, generated, recordedCount: nRec, generatedCount: nGen, source };
  }
  return out;
}

// What the tablet plays: { lang: {0: url, …, 9: url} } – a complete set, or {} if none is complete.
function digitManifest(mediaDir) {
  const status = digitStatus(mediaDir);
  const out = {};
  for (const lang of LANGS) {
    const s = status[lang];
    out[lang] = s.source === 'recorded' ? s.recorded : s.source === 'generated' ? s.generated : {};
  }
  return out;
}

function voiceStatus(mediaDir, conditions) {
  const out = {};
  for (const c of conditions) {
    out[c] = {};
    for (const lang of LANGS) out[c][lang] = findAudio(mediaDir, path.join('vr', 'voice', c), lang);
  }
  return out;
}

module.exports = { LANGS, AUDIO_EXTS, findAudio, removeAudio, digitStatus, digitManifest, voiceStatus };
