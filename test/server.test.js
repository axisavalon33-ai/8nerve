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
  assert.deepEqual(body.bands, { good: -10, refer: -7 });
  assert.equal(body.vr.intensity, 'low');
});

test('results are saved anonymously with the band worked out on the server', async () => {
  const post = (b) => json('/api/ear/results', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await post({ lang: 'ta', srt: -11.2 })).body.band, 'good');
  assert.equal((await post({ lang: 'en', srt: -8 })).body.band, 'borderline');
  assert.equal((await post({ lang: 'si', srt: -3, name: 'Should be ignored' })).body.band, 'refer');
  assert.equal((await post({ lang: 'xx', srt: 1 })).status, 400);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'ear_results.json'), 'utf8'));
  assert.equal(saved.length, 3);
  assert.deepEqual(Object.keys(saved[2]).sort(), ['band', 'lang', 'srt', 'time']);
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
    body: JSON.stringify({ vr: { durations: { menieres: 99 }, intensity: 'medium' }, bands: { good: -11 } }),
  });
  assert.equal(body.vr.durations.menieres, 20); // max 20 s
  assert.equal(body.vr.intensity, 'medium');
  assert.equal(body.bands.good, -11);
  assert.equal(body.bands.refer, -7);
  const reset = await json('/api/host/settings/reset', { method: 'POST', headers: PIN });
  assert.equal(reset.body.vr.intensity, 'low');
});

test('digit upload (PIN) appears in the manifest; old formats are replaced', async () => {
  const put = (ext, headers = PIN) => fetch(`${base}/api/ear/digits/si/7?ext=${ext}`, { method: 'PUT', headers, body: Buffer.from('RIFFtest') });
  assert.equal((await put('wav', {})).status, 401);
  assert.equal((await put('mp3')).status, 200);
  assert.equal((await put('wav')).status, 200);
  const files = fs.readdirSync(path.join(mediaDir, 'ear', 'digits', 'si'));
  assert.deepEqual(files, ['7.wav']);
  const { body } = await json('/api/ear/digits');
  assert.match(body.si[7], /^\/media\/ear\/digits\/si\/7\.wav\?v=\d+$/);
  assert.equal((await fetch(base + body.si[7])).status, 200);
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
  assert.equal(s.intensity, 'low');
  assert.ok(s.duration <= 20);

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
