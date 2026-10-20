// Express routes + Socket.IO live link between the tablet (/ear), the VR phone (/vr) and the host page.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { SettingsStore, CONDITIONS, CAL_DEFAULTS, bandFor } = require('./settings');
const { ResultsStore } = require('./results');
const { lanAddresses } = require('./network');

const LANGS = ['en', 'ta', 'si'];
const AUDIO_EXTS = ['mp3', 'wav', 'webm', 'ogg', 'm4a']; // first one found is used
const ROOT = path.join(__dirname, '..');

function pinMatches(given, pin) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(pin));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// links: how other devices reach this server, e.g. { protocol: 'https', port: 8443 }
function createApp({ dataDir, mediaDir, links = { protocol: 'https', port: 8443 } }) {
  const settings = new SettingsStore(dataDir);
  const results = new ResultsStore(dataDir);
  const app = express();
  app.disable('x-powered-by');

  const requirePin = (req, res, next) => {
    if (pinMatches(req.get('x-pin'), settings.get().pin)) return next();
    res.status(401).json({ error: 'Wrong PIN' });
  };

  // ---------- pages ----------
  const page = (file) => (req, res) => res.sendFile(path.join(ROOT, 'public', file));
  app.get('/', page('index.html'));
  app.get(['/ear', '/ear/'], page('ear/index.html'));
  app.get(['/ear/record', '/ear/record/'], page('ear/record.html'));
  app.get(['/ear/host', '/ear/host/'], page('ear/host.html'));
  app.get(['/vr', '/vr/'], page('vr/index.html'));
  app.use(express.static(path.join(ROOT, 'public'), { index: false, maxAge: 0 }));
  app.use('/media', express.static(mediaDir, { maxAge: 0 }));
  // Three.js comes from node_modules (installed once with npm install) – no internet needed later.
  app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three', 'build')));

  // ---------- public API ----------
  app.get('/api/config', (req, res) => res.json(settings.publicView()));

  app.get('/api/ear/digits', (req, res) => res.json(digitManifest(mediaDir)));

  app.post('/api/ear/results', express.json({ limit: '10kb' }), (req, res) => {
    const { lang, srt } = req.body || {};
    const n = Number(srt);
    if (!LANGS.includes(lang) || !Number.isFinite(n) || n < -40 || n > 40) {
      return res.status(400).json({ error: 'Bad result' });
    }
    const value = Math.round(n * 10) / 10;
    const entry = results.add({ time: new Date().toISOString(), lang, srt: value, band: bandFor(value, settings.get().bands) });
    io.to('host').emit('results', results.summary());
    res.json({ band: entry.band });
  });

  app.post('/api/pin', express.json({ limit: '1kb' }), (req, res) => {
    res.json({ ok: pinMatches(req.body && req.body.pin, settings.get().pin) });
  });

  // ---------- PIN-protected API ----------
  app.put(
    '/api/ear/digits/:lang/:digit',
    requirePin,
    express.raw({ type: () => true, limit: '5mb' }),
    (req, res) => {
      const { lang, digit } = req.params;
      const ext = String(req.query.ext || 'wav');
      if (!LANGS.includes(lang) || !/^[0-9]$/.test(digit) || !AUDIO_EXTS.includes(ext)) {
        return res.status(400).json({ error: 'Bad language, digit or file type' });
      }
      if (!req.body || !req.body.length) return res.status(400).json({ error: 'Empty recording' });
      const dir = path.join(mediaDir, 'ear', 'digits', lang);
      fs.mkdirSync(dir, { recursive: true });
      // Remove older recordings of this digit in other formats so there is exactly one.
      for (const e of AUDIO_EXTS) fs.rmSync(path.join(dir, `${digit}.${e}`), { force: true });
      fs.writeFileSync(path.join(dir, `${digit}.${ext}`), req.body);
      io.emit('digits', digitManifest(mediaDir));
      res.json({ ok: true, manifest: digitManifest(mediaDir) });
    },
  );

  app.get('/api/host/settings', requirePin, (req, res) => res.json(settings.get()));
  app.put('/api/host/settings', requirePin, express.json({ limit: '20kb' }), (req, res) => {
    const value = settings.update(req.body);
    io.emit('settings', settings.publicView());
    res.json(value);
  });
  app.post('/api/host/settings/reset', requirePin, (req, res) => {
    const value = settings.reset();
    io.emit('settings', settings.publicView());
    res.json(value);
  });
  // Addresses of this laptop with QR codes, so the tablet and phone can simply scan to connect.
  app.get('/api/host/links', requirePin, async (req, res) => {
    const pages = { tablet: '/ear', vr: '/vr', record: '/ear/record', host: '/ear/host' };
    const out = [];
    for (const a of lanAddresses()) {
      const base = `${links.protocol}://${a.ip}:${links.port}`;
      const entry = { ip: a.ip, adapter: a.name, likely: a.likely, urls: {}, qr: {} };
      for (const [k, p] of Object.entries(pages)) {
        entry.urls[k] = base + p;
        entry.qr[k] = await QRCode.toString(base + p, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      }
      out.push(entry);
    }
    res.json({ addresses: out, port: links.port, protocol: links.protocol });
  });

  app.get('/api/host/results', requirePin, (req, res) => res.json(results.summary()));
  app.get('/api/host/results.csv', (req, res) => {
    // Opened as a normal link, so the PIN comes in the query string.
    if (!pinMatches(req.query.pin, settings.get().pin)) return res.status(401).send('Wrong PIN');
    res.type('text/csv').attachment('ear_results.csv').send(results.csv());
  });
  app.delete('/api/host/results', requirePin, (req, res) => {
    results.clear();
    io.to('host').emit('results', results.summary());
    res.json(results.summary());
  });

  // ---------- Socket.IO ----------
  let io; // attached in attach()
  const status = {
    tablet: { connected: 0, screen: null, lang: null, at: null },
    vr: { connected: 0, at: null },
  };
  let testPattern = false; // calibration test pattern on the phone (not saved)
  const broadcastStatus = () => {
    io.to('host').emit('status', status);
    io.to('tablet').emit('status', status);
  };

  function attach(httpServer) {
    io = new Server(httpServer, { serveClient: true });
    io.on('connection', (socket) => {
      const { role, pin } = socket.handshake.auth || {};
      if (role === 'host' && !pinMatches(pin, settings.get().pin)) {
        socket.emit('auth-error');
        socket.disconnect(true);
        return;
      }
      if (!['tablet', 'vr', 'host'].includes(role)) {
        socket.disconnect(true);
        return;
      }
      socket.join(role);
      if (role === 'tablet' || role === 'vr') {
        status[role].connected++;
        status[role].at = Date.now();
      }
      socket.emit('settings', settings.publicView());
      socket.emit('status', status);
      if (role === 'host') socket.emit('results', results.summary());
      if (role === 'vr') socket.emit('vr:cal', { cal: settings.get().vrCal, testPattern });
      broadcastStatus();

      socket.on('tablet:status', (s) => {
        if (role !== 'tablet' || !s) return;
        status.tablet.screen = String(s.screen || '').slice(0, 40);
        status.tablet.lang = LANGS.includes(s.lang) ? s.lang : null;
        status.tablet.at = Date.now();
        broadcastStatus();
      });

      socket.on('vr:status', (s) => {
        if (role !== 'vr' || !s || typeof s !== 'object') return;
        const allowed = ['state', 'condition', 'camera', 'camRes', 'sensors', 'tilt', 'fps', 'ready', 'elapsed', 'duration'];
        for (const k of allowed) if (k in s) status.vr[k] = s[k];
        status.vr.at = Date.now();
        broadcastStatus();
      });

      socket.on('vr:start', (msg) => {
        if (role !== 'tablet' && role !== 'host') return;
        const condition = msg && msg.condition;
        if (!CONDITIONS.includes(condition)) return;
        const s = settings.get();
        io.to('vr').emit('vr:start', {
          condition,
          lang: LANGS.includes(msg.lang) ? msg.lang : 'en',
          intensity: s.vr.intensity,
          duration: s.vr.durations[condition],
          vr: s.vr,
        });
      });

      // STOP from the tablet or the host: the phone goes to a calm, still view immediately.
      socket.on('vr:stop', (msg) => {
        if (role !== 'tablet' && role !== 'host') return;
        io.to('vr').emit('vr:stop', { lang: msg && LANGS.includes(msg.lang) ? msg.lang : undefined });
        io.to('tablet').emit('vr:stopped', { by: role });
      });

      // Headset calibration from the hidden tablet panel: sent to the phone at once and saved.
      socket.on('vr:cal', (msg) => {
        if ((role !== 'tablet' && role !== 'host') || !msg || typeof msg !== 'object') return;
        if (msg.reset) settings.update({ vrCal: CAL_DEFAULTS });
        else if (msg.cal) settings.update({ vrCal: msg.cal });
        if (typeof msg.testPattern === 'boolean') testPattern = msg.testPattern;
        const payload = { cal: settings.get().vrCal, testPattern };
        io.to('vr').emit('vr:cal', payload);
        socket.emit('vr:cal', payload); // echo the cleaned-up values back to the panel
      });

      // Forwarded from the phone when a condition ends by itself.
      socket.on('vr:ended', (msg) => {
        if (role !== 'vr') return;
        io.to('tablet').emit('vr:ended', { condition: msg && msg.condition, reason: msg && msg.reason });
      });

      socket.on('disconnect', () => {
        if (role === 'tablet' || role === 'vr') {
          status[role].connected = Math.max(0, status[role].connected - 1);
          status[role].at = Date.now();
          if (role === 'vr' && status.vr.connected === 0) status.vr.state = 'offline';
        }
        broadcastStatus();
      });
    });
    return io;
  }

  return { app, attach, settings, results };
}

function digitManifest(mediaDir) {
  const out = {};
  for (const lang of LANGS) {
    out[lang] = {};
    const dir = path.join(mediaDir, 'ear', 'digits', lang);
    for (let d = 0; d <= 9; d++) {
      for (const ext of AUDIO_EXTS) {
        const f = path.join(dir, `${d}.${ext}`);
        if (fs.existsSync(f)) {
          // ?v= changes when the file changes, so the browser never plays an old cached recording.
          const v = Math.round(fs.statSync(f).mtimeMs);
          out[lang][d] = `/media/ear/digits/${lang}/${d}.${ext}?v=${v}`;
          break;
        }
      }
    }
  }
  return out;
}

module.exports = { createApp, digitManifest, LANGS };
