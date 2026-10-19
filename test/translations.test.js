// Checks the translations file: every entry has en/ta/si, and the owner's exact texts are present.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const T = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/shared/translations.json'), 'utf8'));

test('every key has English, Tamil and Sinhala', () => {
  for (const [key, entry] of Object.entries(T)) {
    if (key.startsWith('_')) continue;
    for (const l of ['en', 'ta', 'si']) {
      assert.ok(entry[l] !== undefined && entry[l] !== '', `${key} is missing "${l}"`);
      if (Array.isArray(entry.en)) assert.equal(entry[l].length, entry.en.length, `${key}: list length differs in ${l}`);
    }
  }
});

test('every key used in the pages and scripts exists', () => {
  const files = ['ear/index.html', 'ear/js/app.js', 'vr/vr.js'].map((f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8'));
  const used = new Set();
  for (const src of files) {
    for (const m of src.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/I18n\.t\('([a-zA-Z.]+)'[,)]/g)) used.add(m[1]);
    for (const m of src.matchAll(/key: '([a-z.]+)'/g)) used.add(m[1]);
  }
  for (const c of ['bppv', 'neuritis', 'menieres', 'oscillopsia']) {
    for (const k of ['name', 'intro', 'what', 'doctor']) used.add(`vr.${c}.${k}`);
  }
  for (const b of ['good', 'borderline', 'refer']) used.add(`result.${b}`);
  for (const k of used) assert.ok(T[k], `missing translation key ${k}`);
});

test("owner's exact texts are used word for word", () => {
  const exact = {
    'home.title': ['Hear & Balance — Your 8th cranial nerve', 'கேட்டலும் சமநிலையும் — 8ஆவது மண்டை நரம்பு', 'ශ්‍රවණය සහ සමබරතාව — 8 වන කපාල ස්නායුව'],
    'menu.hearing': ['Test your hearing', 'உங்கள் கேட்கும் திறனைப் பரிசோதியுங்கள்', 'ඔබේ ශ්‍රවණය පරීක්ෂා කරන්න'],
    'menu.vr': ['Experience balance disorders in VR', 'சமநிலைக் குறைபாடுகளை VR இல் அனுபவியுங்கள்', 'සමබරතා ආබාධ VR හරහා අත්විඳින්න'],
    'ack.continue': ['Continue', 'தொடரவும்', 'ඉදිරියට'],
    'din.instructions': [
      'You will hear 3 numbers with noise. Type the 3 numbers you heard. If unsure, guess.',
      'சத்தத்துடன் 3 இலக்கங்கள் கேட்கும். கேட்ட 3 இலக்கங்களையும் அழுத்துங்கள். உறுதியில்லையெனில் ஊகித்து அழுத்துங்கள்.',
      'ඝෝෂාවත් සමඟ අංක 3ක් ඇසෙයි. ඇසුණු අංක 3 ඔබන්න. විශ්වාස නැත්නම් අනුමාන කරන්න.',
    ],
    'result.footer': ['Screening simulation only — not a diagnosis.', 'இது மாதிரிப் பரிசோதனை மட்டுமே — நோய் நிர்ணயம் அல்ல.', 'මෙය පරීක්ෂණ අනුකරණයක් පමණි — රෝග විනිශ්චයක් නොවේ.'],
  };
  for (const [key, [en, ta, si]] of Object.entries(exact)) {
    assert.equal(T[key].en, en);
    assert.equal(T[key].ta, ta);
    assert.equal(T[key].si, si);
  }
  assert.equal(T['home.prompt'].en, 'Choose your language · மொழியைத் தெரிவு செய்யுங்கள் · භාෂාව තෝරන්න');
  assert.deepEqual(T['lang.name'], { en: 'English', ta: 'தமிழ்', si: 'සිංහල' });
});

test('texts written by the developer are marked needsReview', () => {
  for (const k of ['vr.takeOff', 'vr.bppv.what', 'vr.oscillopsia.doctor', 'volume.text']) assert.equal(T[k].needsReview, true, k);
});
