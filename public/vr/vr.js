// VR phone (/vr): camera passthrough drawn twice (left/right eye) with balance-disorder effects.
(function () {
  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const video = document.getElementById('cam');
  const setup = document.getElementById('setup');
  const setupStatus = document.getElementById('setupStatus');
  const exitBtn = document.getElementById('exitBtn');

  const ZOOM = 1.3; // constant zoom so shifted / rotated picture never shows empty edges
  const AUDIO_CAP = 0.25; // hard safety limit for Ménière's sounds (0..1 of full scale)

  const socket = io({ auth: { role: 'vr' } });
  const st = {
    ready: false,
    camera: 'off', // off | ok | error
    sensors: false,
    episode: null,
    state: 'idle', // idle | waiting | running | stopped | ended
    condition: null,
    lang: 'en',
    tilt: 0,
    yawRate: 0,
    pitchRate: 0,
    fps: 0,
    message: null, // { key, since }
    lastOffset: { x: 0, y: 0 },
    settings: null,
  };
  let source = null; // video or fallback scene canvas
  let wakeLock = null;
  let audio = null;

  // ---------------- setup ----------------
  document.getElementById('startBtn').addEventListener('click', start);
  exitBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setup.classList.remove('hidden');
    exitBtn.classList.add('hidden');
  });

  async function start() {
    setupStatus.textContent = 'Starting…';
    // Fullscreen + landscape + keep the screen awake.
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      /* not supported (e.g. iPhone) */
    }
    try {
      await screen.orientation.lock('landscape');
    } catch {
      /* not supported */
    }
    await keepAwake();

    // Motion sensors (iPhone needs permission; Android just works over HTTPS).
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        await DeviceMotionEvent.requestPermission();
      }
    } catch {
      /* ignore */
    }
    window.addEventListener('devicemotion', onMotion);

    // Sound (unlocked by this tap).
    try {
      setupAudio();
    } catch (e) {
      console.warn(e);
    }

    // Rear camera.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      source = video;
      st.camera = 'ok';
    } catch (err) {
      console.warn('Camera not available, using a calm drawn scene instead', err);
      source = makeScene();
      st.camera = 'error';
    }

    await document.fonts.ready;
    st.ready = true;
    setup.classList.add('hidden');
    exitBtn.classList.remove('hidden');
    sendStatus();
  }

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      /* ignore */
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && st.ready) keepAwake();
  });

  // A calm synthetic room, used when the camera is not available (e.g. testing on a laptop).
  function makeScene() {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 400);
    sky.addColorStop(0, '#9ed8f0');
    sky.addColorStop(1, '#e8f6fb');
    g.fillStyle = sky;
    g.fillRect(0, 0, 1280, 400);
    g.fillStyle = '#cfe9d8';
    g.fillRect(0, 400, 1280, 320);
    g.strokeStyle = 'rgba(15,155,142,0.5)';
    g.lineWidth = 3;
    for (let i = -10; i <= 10; i++) {
      g.beginPath();
      g.moveTo(640 + i * 30, 400);
      g.lineTo(640 + i * 220, 720);
      g.stroke();
    }
    for (let y = 420; y < 720; y *= 1.12) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(1280, y);
      g.stroke();
    }
    const blobs = [
      [250, 300, 70, '#7c3aed'],
      [640, 330, 50, '#2563eb'],
      [1030, 290, 80, '#0f9b8e'],
    ];
    for (const [x, y, r, col] of blobs) {
      g.fillStyle = col;
      g.globalAlpha = 0.75;
      g.fillRect(x - r / 2, y - r, r, r * 2 + 70);
      g.globalAlpha = 1;
    }
    return c;
  }

  // ---------------- sensors ----------------
  let lastSensorSend = 0;
  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    if (a && a.x !== null) {
      st.sensors = true;
      let roll = Effects.headRoll(a.x, a.y, angle);
      if (st.settings && st.settings.vr.invertTilt) roll = -roll;
      st.tilt = st.tilt * 0.8 + roll * 0.2; // smooth
    }
    const r = e.rotationRate;
    if (r && r.beta !== null) {
      const rates = Effects.headRates(r.beta, r.gamma, angle);
      st.yawRate = rates.yawRate;
      st.pitchRate = rates.pitchRate;
    }
    if (performance.now() - lastSensorSend > 500) {
      lastSensorSend = performance.now();
      sendStatus();
    }
  }

  // ---------------- sound (Ménière's) ----------------
  function setupAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const master = ac.createGain();
    master.gain.value = 0;
    master.connect(ac.destination);
    // Muffled roar: brown noise through a low-pass filter.
    const len = ac.sampleRate * 4;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const noise = ac.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const noiseGain = ac.createGain();
    noiseGain.gain.value = 0.7;
    noise.connect(lp).connect(noiseGain).connect(master);
    noise.start();
    // Soft ringing tone with a slow wobble.
    const tone = ac.createOscillator();
    tone.frequency.value = 2200;
    const wobble = ac.createOscillator();
    wobble.frequency.value = 0.4;
    const wobbleDepth = ac.createGain();
    wobbleDepth.gain.value = 6;
    wobble.connect(wobbleDepth).connect(tone.frequency);
    const toneGain = ac.createGain();
    toneGain.gain.value = 0.08;
    tone.connect(toneGain).connect(master);
    tone.start();
    wobble.start();
    audio = { ac, master };
  }
  function setAudioLevel(level, instant) {
    if (!audio) return;
    const vol = st.settings ? st.settings.vr.menieresVolume : 0.5;
    const target = Math.max(0, Math.min(1, level)) * vol * AUDIO_CAP;
    audio.master.gain.setTargetAtTime(target, audio.ac.currentTime, instant ? 0.01 : 0.25);
  }

  // ---------------- control from the tablet ----------------
  socket.on('settings', (s) => (st.settings = s));
  socket.on('connect', () => {
    setupStatus.textContent = 'Connected to the station ✓';
    sendStatus();
  });
  socket.on('disconnect', () => (setupStatus.textContent = 'Not connected – check Wi-Fi'));

  socket.on('vr:start', (msg) => {
    if (!st.ready) return;
    const levels = (st.settings && st.settings.intensityLevels) || { low: 0.35, medium: 0.6, high: 0.85 };
    const v = msg.vr || {};
    st.lang = msg.lang || 'en';
    st.condition = msg.condition;
    st.episode = new Effects.Episode(
      {
        condition: msg.condition,
        intensity: levels[msg.intensity] || levels.low,
        duration: msg.duration,
        rampSec: v.rampSec,
        bppvTiltDeg: v.bppvTiltDeg,
        bppvLatencySec: v.bppvLatencySec,
        bppvWaitMaxSec: v.bppvWaitMaxSec,
      },
      performance.now(),
    );
    if (audio && audio.ac.state === 'suspended') audio.ac.resume();
    st.state = msg.condition === 'bppv' ? 'waiting' : 'running';
    st.message = msg.condition === 'bppv' ? { key: 'vr.tiltHint', since: performance.now() } : null;
    sendStatus();
  });

  // STOP: immediately calm and still. No fade of the picture; sound off at once.
  socket.on('vr:stop', (msg) => {
    if (msg && msg.lang) st.lang = msg.lang;
    const was = st.state;
    st.episode = null;
    setAudioLevel(0, true);
    st.state = 'stopped';
    st.lastOffset = { x: 0, y: 0 };
    if (was !== 'idle') st.message = { key: 'vr.takeOff', since: performance.now() };
    sendStatus();
  });

  function endEpisode(reason) {
    const cond = st.condition;
    st.episode = null;
    setAudioLevel(0, false);
    st.state = 'ended';
    st.message = { key: 'vr.takeOff', since: performance.now() };
    socket.emit('vr:ended', { condition: cond, reason });
    sendStatus();
  }

  function sendStatus() {
    const p = st.episode ? st.episode.progress(performance.now()) : { elapsed: 0, duration: 0 };
    socket.emit('vr:status', {
      ready: st.ready,
      state: st.state,
      condition: st.condition,
      camera: st.camera,
      sensors: st.sensors,
      tilt: Math.round(st.tilt),
      fps: st.fps,
      elapsed: Math.round(p.elapsed * 10) / 10,
      duration: p.duration,
    });
  }
  setInterval(sendStatus, 1000);

  // ---------------- drawing ----------------
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // limit for speed
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  let frames = 0;
  let fpsStart = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    frames++;
    if (now - fpsStart > 1000) {
      st.fps = frames;
      frames = 0;
      fpsStart = now;
    }

    let fx = { dx: 0, dy: 0, roll: 0, audio: 0 };
    if (st.episode) {
      fx = st.episode.update(now, { tilt: st.tilt, yawRate: st.yawRate, pitchRate: st.pitchRate });
      if (fx.phase === 'running' && st.state === 'waiting') {
        st.state = 'running';
        st.message = null;
        sendStatus();
      }
      setAudioLevel(fx.audio, false);
      if (fx.done) endEpisode(st.episode.reason);
    }

    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (!source || !st.ready) return;

    const eyeW = W / 2;
    // Fast jumps (nystagmus snap-back, oscillopsia bounce) get a slight motion blur (ghost copies).
    const jumpX = fx.dx - st.lastOffset.x;
    const jumpY = fx.dy - st.lastOffset.y;
    const blur = Math.hypot(jumpX, jumpY) > 0.006;
    for (let eye = 0; eye < 2; eye++) {
      const x0 = eye * eyeW;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, eyeW, H);
      ctx.clip();
      drawSource(x0, eyeW, H, fx.dx, fx.dy, fx.roll, 1);
      if (blur) {
        drawSource(x0, eyeW, H, fx.dx - jumpX * 0.33, fx.dy - jumpY * 0.33, fx.roll, 0.35);
        drawSource(x0, eyeW, H, fx.dx - jumpX * 0.66, fx.dy - jumpY * 0.66, fx.roll, 0.2);
      }
      drawVignette(x0, eyeW, H);
      drawMessage(x0, eyeW, H, now);
      ctx.restore();
    }
    st.lastOffset = { x: fx.dx, y: fx.dy };
    // Divider between the eyes.
    ctx.fillStyle = '#000';
    ctx.fillRect(eyeW - 2, 0, 4, H);
  }

  function drawSource(x0, w, h, dx, dy, roll, alpha) {
    const sw = source.videoWidth || source.width;
    const sh = source.videoHeight || source.height;
    if (!sw || !sh) return;
    const scale = Math.max(w / sw, h / sh) * ZOOM; // "cover" the eye view
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x0 + w / 2 + dx * w, h / 2 + dy * h);
    ctx.rotate((roll * Math.PI) / 180);
    ctx.drawImage(source, (-sw * scale) / 2, (-sh * scale) / 2, sw * scale, sh * scale);
    ctx.restore();
  }

  function drawVignette(x0, w, h) {
    const g = ctx.createRadialGradient(x0 + w / 2, h / 2, Math.min(w, h) * 0.35, x0 + w / 2, h / 2, Math.max(w, h) * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, w, h);
  }

  // Calm text inside the headset (fades in slowly; never flashes).
  function drawMessage(x0, w, h, now) {
    if (!st.message || !I18n.data[st.message.key]) return;
    const alpha = Math.min(1, (now - st.message.since) / 1000);
    const text = I18n.t(st.message.key, null, st.lang);
    const size = Math.round(h * 0.055);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `700 ${size}px 'Noto Sans', 'Noto Sans Tamil', 'Noto Sans Sinhala', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = wrap(text, w * 0.62);
    const lh = size * 1.35;
    const boxH = lines.length * lh + size;
    const y = st.message.key === 'vr.tiltHint' ? h * 0.75 : h / 2;
    ctx.fillStyle = 'rgba(18, 35, 61, 0.72)';
    roundRect(x0 + w * 0.16, y - boxH / 2, w * 0.68, boxH, size * 0.6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    lines.forEach((ln, i) => ctx.fillText(ln, x0 + w / 2, y - ((lines.length - 1) * lh) / 2 + i * lh));
    ctx.restore();
  }
  function wrap(text, maxW) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  I18n.load().catch(() => {});
  requestAnimationFrame(frame);
  window.__vr = st; // for automated tests
})();
