// Server tests: API, PIN protection, result saving, and the tablet -> phone STOP link.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { createApp } = require('../server/app');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ear-test-'));
const dataDir = path.join(tmp, 'data');
const mediaDir = path.join(tmp, 'media');
let server;
let base;

test.before(async () => {
  const { app, attach } = createApp({ dataDir, mediaDir });
  server = http.createServer(app);
  attach(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => {
  server.closeAllConnections?.();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const json = (url, opts = {}) => fetch(base + url, opts).then(async (r) => ({ status: r.status, body: await r.json() }));
const PIN = { 'x-pin': '2468' };

test('pages are served', async () => {
  for (const p of ['/ear', '/vr', '/ear/host', '/ear/record', '/shared/translations.json']) {
    assert.equal((await fetch(base + p)).status, 200, p);
  }
});

test('public config does not leak the PIN', async () => {
  const { body } = await json('/api/config');
  assert.equal(body.pin, undefined);
  assert.deepEqual(body.bands, { good: -10, refer: -7, perLang: { en: null, ta: null, si: null } });
  assert.equal(body.vr.intensity, 0.35);
});

test('results are saved anonymously with the band worked out on the server', async () => {
  const post = (b) => json('/api/ear/results', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await post({ lang: 'ta', srt: -11.2 })).body.band, 'good');
  assert.equal((await post({ lang: 'en', srt: -8 })).body.band, 'borderline');
  assert.equal((await post({ lang: 'si', srt: -3, name: 'Should be ignored' })).body.band, 'refer');
  assert.equal((await post({ lang: 'xx', srt: 1 })).status, 400);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'ear_results.json'), 'utf8'));
  assert.equal(saved.length, 3);
  assert.deepEqual(Object.keys(saved[2]).sort(), ['band', 'id', 'lang', 'srt', 'time']); // no names
});

test('host API needs the PIN', async () => {
  assert.equal((await json('/api/host/results')).status, 401);
  assert.equal((await json('/api/host/results', { headers: { 'x-pin': '0000' } })).status, 401);
  const { body } = await json('/api/host/results', { headers: PIN });
  assert.equal(body.counts.total, 3);
  assert.equal(body.counts.byBand.refer, 1);
});

test('settings are saved and kept within safe limits', async () => {
  const { body } = await json('/api/host/settings', {
    method: 'PUT',
    headers: { ...PIN, 'content-type': 'application/json' },
    body: JSON.stringify({ vr: { durations: { menieres: 99, bppv: 3, neuritis: 45 }, intensity: 'medium', tinnitusVolume: 5 }, bands: { good: -11 } }),
  });
  assert.equal(body.vr.durations.menieres, 60); // max 60 s
  assert.equal(body.vr.durations.bppv, 10); // min 10 s
  assert.equal(body.vr.durations.neuritis, 45);
  assert.equal(body.vr.durations.oscillopsia, 30); // default 30 s
  assert.equal(body.vr.tinnitusVolume, 1); // never above 100 %
  assert.equal(body.vr.intensity, 0.6); // the old word 'medium' still works
  assert.equal(body.bands.good, -11);
  assert.equal(body.bands.refer, -7);
  const reset = await json('/api/host/settings/reset', { method: 'POST', headers: PIN });
  assert.equal(reset.body.vr.intensity, 0.35);
});

test('digit upload (PIN); a language uses one complete set – never mixed', async () => {
  const put = (lang, d, ext, headers = PIN) => fetch(`${base}/api/ear/digits/${lang}/${d}?ext=${ext}`, { method: 'PUT', headers, body: Buffer.from('RIFFtest') });
  assert.equal((await put('si', 7, 'wav', {})).status, 401);
  assert.equal((await put('si', 7, 'mp3')).status, 200);
  assert.equal((await put('si', 7, 'wav')).status, 200);
  assert.deepEqual(fs.readdirSync(path.join(mediaDir, 'ear', 'digits', 'si')), ['7.wav']); // old format replaced

  // Generated set for Tamil (as espeak-ng would make it)
  const gdir = path.join(mediaDir, 'ear', 'digits-generated', 'ta');
  fs.mkdirSync(gdir, { recursive: true });
  for (let d = 0; d <= 9; d++) fs.writeFileSync(path.join(gdir, `${d}.wav`), 'RIFFgen');
  for (const d of [1, 2, 3]) await put('ta', d, 'wav');

  let st = (await json('/api/ear/digits/status')).body.status;
  assert.equal(st.ta.recordedCount, 3);
  assert.equal(st.ta.source, 'generated', '3/10 recorded -> generated set is used');
  assert.equal(st.si.source, null, 'nothing complete for Sinhala');
  let m = (await json('/api/ear/digits')).body;
  assert.equal(Object.keys(m.ta).length, 10);
  assert.ok(Object.values(m.ta).every((u) => u.includes('/digits-generated/ta/')), 'no mixing');
  assert.deepEqual(m.si, {});

  for (let d = 0; d <= 9; d++) await put('ta', d, 'wav');
  m = (await json('/api/ear/digits')).body;
  assert.ok(Object.values(m.ta).every((u) => u.includes('/ear/digits/ta/')), 'all 10 recorded -> my recordings');
  assert.equal((await fetch(base + m.ta[4])).status, 200);

  // Reset to generated
  assert.equal((await fetch(`${base}/api/ear/digits/ta`, { method: 'DELETE' })).status, 401);
  st = (await json('/api/ear/digits/ta', { method: 'DELETE', headers: PIN })).body.status;
  assert.equal(st.ta.recordedCount, 0);
  assert.equal(st.ta.source, 'generated');
});

test('spoken instruction MP3: upload, used at START, back to the phone voice', async () => {
  assert.equal((await fetch(`${base}/api/vr/voice/bppv/ta?ext=mp3`, { method: 'PUT', body: 'ID3' })).status, 401);
  let v = (await json('/api/vr/voice/bppv/ta?ext=mp3', { method: 'PUT', headers: PIN, body: 'ID3fake' })).body;
  assert.match(v.bppv.ta, /^\/media\/vr\/voice\/bppv\/ta\.mp3\?v=/);
  assert.equal(v.bppv.en, null);

  const phone = ioClient(base, { auth: { role: 'vr' }, transports: ['websocket'] });
  const tablet = ioClient(base, { auth: { role: 'tablet' }, transports: ['websocket'] });
  try {
    await Promise.all([phone, tablet].map((c) => new Promise((r) => c.on('connect', r))));
    const got = new Promise((r) => phone.once('vr:start', r));
    tablet.emit('vr:start', { condition: 'bppv', lang: 'ta' });
    const msg = await got;
    assert.equal(msg.voiceUrl, v.bppv.ta);
    assert.equal(msg.duration, 30);
    const got2 = new Promise((r) => phone.once('vr:start', r));
    tablet.emit('vr:start', { condition: 'bppv', lang: 'en' });
    assert.equal((await got2).voiceUrl, null, 'no MP3 -> phone text-to-speech');
  } finally {
    phone.close();
    tablet.close();
  }
  v = (await json('/api/vr/voice/bppv/ta', { method: 'DELETE', headers: PIN })).body;
  assert.equal(v.bppv.ta, null);
});

test('old settings files get the new 30 s lengths', () => {
  const { SettingsStore } = require('../server/settings');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ear-old-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ pin: '1111', vr: { durations: { bppv: 18, neuritis: 20 }, menieresVolume: 0.9 } }));
  const s = new SettingsStore(dir).get();
  assert.equal(s.pin, '1111');
  assert.equal(s.vr.durations.bppv, 30);
  assert.equal(s.vr.tinnitusVolume, 0.3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('STOP on the tablet reaches the VR phone; START carries the settings', async () => {
  const connect = (auth) =>
    new Promise((resolve) => {
      const s = ioClient(base, { auth, transports: ['websocket'] });
      s.on('connect', () => resolve(s));
    });
  const phone = await connect({ role: 'vr' });
  const tablet = await connect({ role: 'tablet' });
  const host = await connect({ role: 'host', pin: '2468' });

  const started = new Promise((r) => phone.once('vr:start', r));
  tablet.emit('vr:start', { condition: 'bppv', lang: 'ta' });
  const s = await started;
  assert.equal(s.condition, 'bppv');
  assert.equal(s.lang, 'ta');
  assert.equal(s.intensity, 0.35);
  assert.equal(s.duration, 30);

  const statusSeen = new Promise((r) => host.on('status', (st) => st.vr.state === 'running' && r(st)));
  phone.emit('vr:status', { state: 'running', ready: true, tilt: 12 });
  assert.equal((await statusSeen).vr.tilt, 12);

  const stopped = new Promise((r) => phone.once('vr:stop', r));
  tablet.emit('vr:stop', { lang: 'ta' });
  assert.equal((await stopped).lang, 'ta');

  const ended = new Promise((r) => tablet.once('vr:ended', r));
  phone.emit('vr:ended', { condition: 'bppv', reason: 'complete' });
  assert.equal((await ended).condition, 'bppv');

  // A host with the wrong PIN is refused.
  const bad = ioClient(base, { auth: { role: 'host', pin: '1' }, transports: ['websocket'] });
  await new Promise((r) => bad.on('auth-error', r));
  for (const c of [phone, tablet, host, bad]) c.close();
});

test('headset calibration: live to the phone, clamped to the allowed ranges, saved, kept on settings reset', async () => {
  const connect = (auth) =>
    new Promise((resolve) => {
      const s = ioClient(base, { auth, transports: ['websocket'] });
      s.on('connect', () => resolve(s));
    });
  const phone = await connect({ role: 'vr' });
  const tablet = await connect({ role: 'tablet' });

  const got = new Promise((r) => phone.on('vr:cal', (m) => m.testPattern && r(m)));
  tablet.emit('vr:cal', { cal: { distortion: 5, ipd: 0.6, zoom: 0.1 }, testPattern: true });
  const m = await got;
  assert.equal(m.cal.distortion, 1); // max 1
  assert.equal(m.cal.zoom, 0.4); // min 0.4
  assert.equal(m.cal.ipd, 0.6);
  assert.equal(m.cal.eyeSize, 0.92); // untouched default
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
  assert.equal(saved.vrCal.ipd, 0.6);

  await json('/api/host/settings/reset', { method: 'POST', headers: PIN });
  assert.equal((await json('/api/config')).body.vrCal.ipd, 0.6, 'calibration survives "Restore defaults"');

  const reset = new Promise((r) => phone.on('vr:cal', (msg) => msg.cal.ipd === 0.5 && r(msg)));
  tablet.emit('vr:cal', { reset: true, testPattern: false });
  const r = await reset;
  assert.equal(r.testPattern, false);
  assert.equal(r.cal.distortion, 0.25);

  // A newly connected phone gets the current calibration straight away.
  const late = ioClient(base, { auth: { role: 'vr' }, transports: ['websocket'] });
  const first = await new Promise((res) => late.once('vr:cal', res));
  assert.equal(first.cal.ipd, 0.5);
  for (const c of [phone, tablet, late]) c.close();
});

test('Three.js is served locally (offline)', async () => {
  assert.equal((await fetch(base + '/vendor/three/three.module.min.js')).status, 200);
  assert.equal((await fetch(base + '/vendor/three/three.core.min.js')).status, 200);
});

test('host page gets the laptop addresses with QR codes (PIN only)', async () => {
  assert.equal((await json('/api/host/links')).status, 401);
  const { body } = await json('/api/host/links', { headers: PIN });
  assert.ok(Array.isArray(body.addresses));
  for (const a of body.addresses) {
    assert.match(a.urls.tablet, /^https:\/\/[\d.]+:8443\/ear$/);
    assert.match(a.urls.vr, /\/vr$/);
    assert.match(a.qr.tablet, /^<svg/);
  }
});

test('real Wi-Fi addresses are preferred over virtual adapters', () => {
  const { score } = require('../server/network');
  assert.ok(score('192.168.1.20', 'Wi-Fi') > score('172.24.48.1', 'vEthernet (WSL)'));
  assert.ok(score('192.168.0.5', 'wlan0') > score('192.168.56.1', 'VirtualBox Host-Only Network'));
  assert.ok(score('10.0.0.8', 'Ethernet') > score('10.8.0.2', 'OpenVPN TAP'));
});

test('placeholder digits made with espeak-ng are trimmed and normalised', { skip: !require('child_process').spawnSync('espeak-ng', ['--version']).stdout?.length && 'espeak-ng not installed' }, async () => {
  const { generateDigits, readWav } = require('../server/digit-tts');
  const DSP = require('../public/ear/js/dsp.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ear-gen-'));
  try {
    const r = await generateDigits(dir, { langs: ['en', 'ta', 'si'] });
    assert.equal(r.made, 30, JSON.stringify(r.failed));
    for (const lang of ['en', 'ta', 'si']) {
      for (let d = 0; d <= 9; d++) {
        const { data, sampleRate } = readWav(fs.readFileSync(path.join(dir, 'ear', 'digits-generated', lang, `${d}.wav`)));
        assert.ok(data.length / sampleRate > 0.15 && data.length / sampleRate < 1.6, `${lang}/${d} length`);
        assert.ok(Math.abs(DSP.activeRms(data, sampleRate) - 0.1) < 0.02, `${lang}/${d} loudness`);
      }
    }
    const again = await generateDigits(dir);
    assert.equal(again.made, 0, 'existing files are kept');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('calibrate with normal listeners: mode, marking, statistics, suggested and per-language bands', async () => {
  const put = (body) => json('/api/host/settings', { method: 'PUT', headers: { ...PIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const post = (b) => json('/api/ear/results', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const before = (await json('/api/host/results', { headers: PIN })).body.counts.total;

  await put({ calibrationMode: true });
  const srts = [-8, -7.5, -8.5, -7, -8, -9];
  for (const srt of srts) assert.equal((await post({ lang: 'ta', srt })).body.calib, true);
  await put({ calibrationMode: false });
  assert.equal((await post({ lang: 'ta', srt: -6 })).body.calib, false);

  let sum = (await json('/api/host/results', { headers: PIN })).body;
  assert.equal(sum.counts.total, before + 1, 'normal listeners are not counted as visitors');
  const c = sum.calibration.ta;
  assert.equal(c.n, 6);
  assert.equal(c.mean, -8);
  assert.ok(c.sd > 0.6 && c.sd < 0.8);
  assert.deepEqual(c.suggested, { good: -6.5, refer: -3.5 }); // -8 + 2*0.71 = -6.58 -> rounded up to -6.5

  // tick / untick a single result
  const visitor = sum.recent.find((r) => !r.calib);
  sum = (await json('/api/host/results/' + visitor.id, { method: 'PATCH', headers: { ...PIN, 'content-type': 'application/json' }, body: '{"calib":true}' })).body;
  assert.equal(sum.calibration.ta.n, 7);
  sum = (await json('/api/host/results/' + visitor.id, { method: 'PATCH', headers: { ...PIN, 'content-type': 'application/json' }, body: '{"calib":false}' })).body;
  assert.equal(sum.calibration.ta.n, 6);

  // own bands for Tamil only
  const s = (await put({ bands: { perLang: { ta: c.suggested } } })).body;
  assert.deepEqual(s.bands.perLang.ta, { good: -6.5, refer: -3.5 });
  assert.equal(s.bands.perLang.en, null);
  assert.equal((await post({ lang: 'ta', srt: -6 })).body.band, 'borderline', 'Tamil uses its own bands');
  assert.equal((await post({ lang: 'en', srt: -6 })).body.band, 'refer', 'English still uses the common bands');
  assert.equal((await put({ bands: { perLang: { ta: null } } })).body.bands.perLang.ta, null);

  await json('/api/host/results/calibration', { method: 'DELETE', headers: PIN });
  assert.equal((await json('/api/host/results', { headers: PIN })).body.calibration.ta.n, 0);
});

test('no tablet: host chooses the condition for the visitor screen, START uses the visitor language, pictures + picture time', async () => {
  assert.equal((await fetch(base + '/ear/display')).status, 404, 'separate monitor page removed – the visitor app runs on the monitor');
  // picture time: 3–120 s, default 15
  assert.equal((await json('/api/config')).body.display.imageSeconds, 15);
  const put = (body) => json('/api/host/settings', { method: 'PUT', headers: { ...PIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await put({ display: { imageSeconds: 999 } })).body.display.imageSeconds, 120);
  assert.equal((await put({ display: { imageSeconds: 20 } })).body.display.imageSeconds, 20);

  // pictures
  assert.equal((await fetch(`${base}/api/vr/images/menieres/ta?ext=png`, { method: 'PUT', body: 'x' })).status, 401);
  assert.equal((await fetch(`${base}/api/vr/images/menieres/ta?ext=exe`, { method: 'PUT', headers: PIN, body: 'x' })).status, 400);
  let imgs = (await json('/api/vr/images/menieres/ta?ext=png', { method: 'PUT', headers: PIN, body: 'PNGfake' })).body;
  assert.match(imgs.menieres.ta, /^\/media\/vr\/images\/menieres\/ta\.png\?v=/);
  imgs = (await json('/api/vr/images/menieres/all?ext=jpg', { method: 'PUT', headers: PIN, body: 'JPGfake' })).body;
  assert.match(imgs.menieres.all, /all\.jpg/);
  assert.equal((await fetch(base + imgs.menieres.all)).status, 200);
  imgs = (await json('/api/vr/images/menieres/ta', { method: 'DELETE', headers: PIN })).body;
  assert.equal(imgs.menieres.ta, null);

  const connect = (auth) =>
    new Promise((resolve) => {
      const s = ioClient(base, { auth, transports: ['websocket'] });
      s.on('connect', () => resolve(s));
    });
  const visitor = await connect({ role: 'tablet' }); // the visitor app on the monitor
  const phone = await connect({ role: 'vr' });
  const host = await connect({ role: 'host', pin: '2468' });
  try {
    // host chooses a condition -> visitor screen
    const sel = new Promise((r) => visitor.once('visitor:select', r));
    host.emit('visitor:select', { condition: 'oscillopsia' });
    assert.deepEqual(await sel, { condition: 'oscillopsia' });

    // visitor screen reports consent + stage -> host sees it
    const seen = new Promise((r) => host.on('status', (st) => st.tablet.stage === 'wear' && r(st)));
    visitor.emit('tablet:status', { screen: 'vrIntro', lang: 'si', condition: 'oscillopsia', consent: true, stage: 'wear' });
    const st = await seen;
    assert.equal(st.tablet.consent, true);
    assert.equal(st.tablet.condition, 'oscillopsia');

    // host presses START without a language -> the visitor's language is used; visitor screen is told
    const started = new Promise((r) => phone.once('vr:start', r));
    const told = new Promise((r) => visitor.once('vr:started', r));
    host.emit('vr:start', { condition: 'oscillopsia' });
    assert.equal((await started).lang, 'si');
    assert.deepEqual(await told, { condition: 'oscillopsia', lang: 'si' });

    // host STOP reaches the phone and the visitor screen
    const stopped = new Promise((r) => phone.once('vr:stop', r));
    const back = new Promise((r) => visitor.once('vr:stopped', r));
    host.emit('vr:stop', {});
    await stopped;
    await back;
  } finally {
    for (const c of [visitor, phone, host]) c.close();
  }
  await put({ display: { imageSeconds: 15 } });
});
