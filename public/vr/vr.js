// VR phone (/vr): rear camera in a two-eye headset view (Three.js shader) with balance-disorder effects.
import { HeadsetRenderer } from './renderer.js';
import { openCamera, isPermissionError } from './camera.js';

const Effects = window.Effects;
const I18n = window.I18n;
const video = document.getElementById('cam');
const setup = document.getElementById('setup');
const setupStatus = document.getElementById('setupStatus');
const exitBtn = document.getElementById('exitBtn');

const AUDIO_CAP = 0.25; // hard safety limit for Ménière's sounds (0..1 of full scale)
const CAMERA_RETRY_MS = 4000;
const FONT = "'Noto Sans', 'Noto Sans Tamil', 'Noto Sans Sinhala', sans-serif";

const view = new HeadsetRenderer(document.getElementById('view'));
const socket = io({ auth: { role: 'vr' } });
const st = {
  ready: false,
  camera: 'off', // off | ok | error | denied
  camRes: null,
  sensors: false,
  episode: null,
  state: 'idle', // idle | waiting | running | stopped | ended
  condition: null,
  lang: 'en',
  tilt: 0,
  yawRate: 0,
  pitchRate: 0,
  fps: 0,
  message: null, // { key, since, position }
  lastOffset: { x: 0, y: 0 },
  settings: null,
  cal: null,
  testPattern: false,
};
let wakeLock = null;
let audio = null;
let retryTimer = null;

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

  await document.fonts.ready;
  await startCamera();
  st.ready = true;
  setup.classList.add('hidden');
  exitBtn.classList.remove('hidden');
  sendStatus();
}

async function keepAwake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    /* ignore */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && st.ready) keepAwake();
});

// ---------------- camera ----------------
async function startCamera() {
  clearTimeout(retryTimer);
  try {
    const cam = await openCamera();
    video.srcObject = cam.stream;
    await video.play();
    cam.track.addEventListener('ended', () => cameraFailed(new Error('Camera track ended')));
    st.camera = 'ok';
    st.camRes = `${video.videoWidth || cam.width}×${video.videoHeight || cam.height}`;
    view.setVideo(video);
  } catch (err) {
    cameraFailed(err);
  }
  sendStatus();
}

// Clear error inside both eyes, try again every 4 seconds.
function cameraFailed(err) {
  console.warn('Camera problem', err);
  view.setVideo(null);
  if (video.srcObject) video.srcObject.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  st.camera = isPermissionError(err) ? 'denied' : 'error';
  st.camRes = null;
  sendStatus();
  clearTimeout(retryTimer);
  retryTimer = setTimeout(startCamera, CAMERA_RETRY_MS);
}
video.addEventListener('error', () => st.camera === 'ok' && cameraFailed(new Error('Video element error')));

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
socket.on('settings', (s) => {
  st.settings = s;
  if (!st.cal && s.vrCal) applyCal(s.vrCal, st.testPattern);
});
socket.on('vr:cal', (msg) => applyCal(msg.cal, msg.testPattern));
function applyCal(cal, testPattern) {
  st.cal = cal;
  st.testPattern = !!testPattern;
  view.setCalibration(cal, st.testPattern);
}

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
  st.message = msg.condition === 'bppv' ? { key: 'vr.tiltHint', since: performance.now(), position: 'low' } : null;
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
    camRes: st.camRes,
    sensors: st.sensors,
    tilt: Math.round(st.tilt),
    fps: st.fps,
    elapsed: Math.round(p.elapsed * 10) / 10,
    duration: p.duration,
  });
}
setInterval(sendStatus, 1000);

// ---------------- drawing ----------------
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

  // Fast jumps (nystagmus snap-back, oscillopsia bounce) get a slight motion blur.
  const jx = (fx.dx - st.lastOffset.x) * 2;
  const jy = -(fx.dy - st.lastOffset.y) * 2;
  const blur = Math.hypot(jx, jy) > 0.012 ? { x: jx, y: jy } : null;
  st.lastOffset = { x: fx.dx, y: fx.dy };
  view.setEffects(fx, blur);

  // Text inside the headset: camera problems first, otherwise the current message (fades in slowly).
  let key = null;
  let position = 'centre';
  let alpha = 1;
  if (st.ready && (st.camera === 'error' || st.camera === 'denied')) {
    key = st.camera === 'denied' ? 'vr.cameraDenied' : 'vr.cameraError';
  } else if (st.message) {
    key = st.message.key;
    position = st.message.position || 'centre';
    alpha = Math.min(1, (now - st.message.since) / 1000);
  }
  view.setMessage(key && I18n.data[key] ? I18n.t(key, null, st.lang) : null, position, alpha, FONT);

  if (st.ready) view.render();
}

I18n.load().catch(() => {});
requestAnimationFrame(frame);
window.__vr = st; // for automated tests
