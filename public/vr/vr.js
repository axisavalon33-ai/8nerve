// VR phone (/vr): rear camera in a two-eye headset view (Three.js shader) with balance-disorder effects.
import { HeadsetRenderer } from './renderer.js';
import { openCamera, isPermissionError } from './camera.js';
import { SoundFx } from './sound.js';
import { sayInstruction, stopVoice, availableVoices } from './voice.js';

const Effects = window.Effects;
const I18n = window.I18n;
const Kiosk = window.Kiosk;
const video = document.getElementById('cam');
const setup = document.getElementById('setup');
const setupStatus = document.getElementById('setupStatus');
const sensorWarn = document.getElementById('sensorWarn');
const exitBtn = document.getElementById('exitBtn');

const CAMERA_RETRY_MS = 4000;
const SENSOR_STALE_MS = 1500;
const FONT = "'Noto Sans', 'Noto Sans Tamil', 'Noto Sans Sinhala', sans-serif";

const view = new HeadsetRenderer(document.getElementById('view'));
const socket = io({ auth: { role: 'vr' } });
const st = {
  ready: false,
  camera: 'off', // off | ok | error | denied
  camRes: null,
  episode: null,
  state: 'idle', // idle | waiting | running | stopped | ended
  condition: null,
  lang: 'en',
  // head movement
  tilt: 0,
  yawRate: 0,
  pitchRate: 0,
  rollRate: 0,
  lastGyroAt: 0,
  lastOrientAt: 0,
  lastAccelAt: 0,
  motionPermission: 'not-asked', // not-asked | granted | denied | not-needed
  fps: 0,
  message: null, // { key, since, position }
  lastOffset: { x: 0, y: 0 },
  settings: null,
  cal: null,
  testPattern: false,
};
let sound = null;
let retryTimer = null;
const orientationRates = Effects.orientationRateTracker();

// ---------------- setup ----------------
Kiosk.init({ landscape: true, auto: false, label: () => I18n.t('fullscreen.return', null, st.lang) });
Kiosk.suppress(true); // no "return to fullscreen" button on the setup screen
document.getElementById('startBtn').addEventListener('click', start);
exitBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  setup.classList.remove('hidden');
  exitBtn.classList.add('hidden');
  Kiosk.suppress(true);
});

async function start() {
  setupStatus.textContent = 'Starting…';
  // Everything that needs a tap happens here: motion sensor permission, sound, fullscreen, landscape, wake lock.
  await askMotionPermission();
  window.addEventListener('devicemotion', onMotion);
  window.addEventListener('deviceorientation', onOrientation);
  try {
    if (!sound) sound = new SoundFx();
    sound.resume();
  } catch (e) {
    console.warn('No sound', e);
  }
  await Kiosk.enter();
  Kiosk.suppress(false);

  await document.fonts.ready;
  if (st.camera !== 'ok') await startCamera();
  st.ready = true;
  setup.classList.add('hidden');
  exitBtn.classList.remove('hidden');
  sendStatus();
  // Warn on the setup screen (seen when the helper comes back to it) if no motion data arrives.
  setTimeout(() => {
    const ok = sensorSource() !== 'none';
    sensorWarn.classList.toggle('hidden', ok);
    sendStatus();
  }, 2500);
}

async function askMotionPermission() {
  // iPhone/iPad: an explicit permission request is needed (only allowed inside a tap).
  const needs = [window.DeviceMotionEvent, window.DeviceOrientationEvent].filter((E) => E && typeof E.requestPermission === 'function');
  if (!needs.length) {
    st.motionPermission = 'not-needed'; // Android Chrome: allowed for HTTPS pages unless blocked in site settings
    return;
  }
  try {
    const results = await Promise.all(needs.map((E) => E.requestPermission()));
    st.motionPermission = results.every((r) => r === 'granted') ? 'granted' : 'denied';
  } catch {
    st.motionPermission = 'denied';
  }
}

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
function screenAngle() {
  return (screen.orientation && screen.orientation.angle) || window.orientation || 0;
}

function onMotion(e) {
  const now = performance.now();
  const a = e.accelerationIncludingGravity;
  if (a && a.x !== null && a.y !== null) {
    st.lastAccelAt = now;
    let roll = Effects.headRoll(a.x, a.y, screenAngle());
    if (st.settings && st.settings.vr.invertTilt) roll = -roll;
    st.tilt = st.tilt * 0.8 + roll * 0.2; // smooth
  }
  const r = e.rotationRate;
  if (r && r.beta !== null && r.gamma !== null) {
    st.lastGyroAt = now;
    const rates = Effects.headRates(r.beta, r.gamma, screenAngle(), r.alpha);
    smoothRates(rates, 0.5);
  }
}

// Phones without a gyroscope: work out turning speed from orientation changes instead.
function onOrientation(e) {
  const now = performance.now();
  if (e.alpha === null && e.beta === null) return;
  st.lastOrientAt = now;
  if (now - st.lastGyroAt < SENSOR_STALE_MS) return; // the gyroscope is better
  const rates = orientationRates(e, now, screenAngle());
  if (rates) smoothRates(rates, 0.4);
}

function smoothRates(r, k) {
  st.yawRate += (r.yawRate - st.yawRate) * k;
  st.pitchRate += (r.pitchRate - st.pitchRate) * k;
  st.rollRate += (r.rollRate - st.rollRate) * k;
}

function sensorSource() {
  const now = performance.now();
  if (now - st.lastGyroAt < SENSOR_STALE_MS) return 'gyro';
  if (now - st.lastOrientAt < SENSOR_STALE_MS) return 'orientation';
  if (now - st.lastAccelAt < SENSOR_STALE_MS) return 'tilt-only';
  return 'none';
}

// ---------------- control from the tablet / host ----------------
function vol() {
  const v = (st.settings && st.settings.vr) || {};
  return { tinnitusVolume: v.tinnitusVolume ?? 0.3, muffledVolume: v.muffledVolume ?? 0.5 };
}

socket.on('settings', (s) => {
  st.settings = s;
  if (!st.cal && s.vrCal) applyCal(s.vrCal, st.testPattern);
  // The sensitivity slider works while oscillopsia is running.
  if (st.episode) st.episode.o.sensitivity = s.vr.oscillopsiaSensitivity;
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
      sensitivity: v.oscillopsiaSensitivity,
    },
    performance.now(),
  );
  if (sound) sound.resume();
  sayInstruction(I18n.t(`vr.${msg.condition}.say`, null, st.lang), st.lang, msg.voiceUrl);
  st.state = msg.condition === 'bppv' ? 'waiting' : 'running';
  st.message = msg.condition === 'bppv' ? { key: 'vr.tiltHint', since: performance.now(), position: 'low' } : null;
  sendStatus();
});

// STOP: immediately calm and still. No fade of the picture; sound and voice off at once.
socket.on('vr:stop', (msg) => {
  if (msg && msg.lang) st.lang = msg.lang;
  const was = st.state;
  st.episode = null;
  if (sound) sound.set(0, vol(), true);
  stopVoice();
  st.state = 'stopped';
  st.lastOffset = { x: 0, y: 0 };
  if (was !== 'idle') st.message = { key: 'vr.takeOff', since: performance.now() };
  sendStatus();
});

// Host page checks
socket.on('vr:testSound', (msg) => {
  if (!sound || st.episode) return; // never during a condition
  sound.test(msg.kind, vol());
});
socket.on('vr:say', (msg) => {
  if (st.episode) return;
  sayInstruction(I18n.t(`vr.${msg.condition}.say`, null, msg.lang), msg.lang, msg.voiceUrl);
});

function endEpisode(reason) {
  const cond = st.condition;
  st.episode = null;
  if (sound) sound.set(0, vol(), false); // gentle fade out
  st.state = 'ended';
  st.message = { key: 'vr.takeOff', since: performance.now() };
  socket.emit('vr:ended', { condition: cond, reason });
  sendStatus();
}

const r1 = (x) => Math.round(x * 10) / 10;
function sendStatus() {
  const p = st.episode ? st.episode.progress(performance.now()) : { elapsed: 0, duration: 0 };
  const src = sensorSource();
  socket.emit('vr:status', {
    ready: st.ready,
    state: st.state,
    condition: st.condition,
    camera: st.camera,
    camRes: st.camRes,
    sensors: src !== 'none',
    sensorSource: src,
    motionPermission: st.motionPermission,
    tilt: Math.round(st.tilt),
    yawRate: r1(st.yawRate),
    pitchRate: r1(st.pitchRate),
    rollRate: r1(st.rollRate),
    voices: availableVoices(),
    fullscreen: Kiosk.isFullscreen(),
    fps: st.fps,
    elapsed: r1(p.elapsed),
    duration: p.duration,
  });
}
setInterval(sendStatus, 250); // live head-movement values on the host page

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
  // Rates decay to zero if the sensors go quiet, so the picture never stays shifted.
  if (sensorSource() === 'none' || sensorSource() === 'tilt-only') smoothRates({ yawRate: 0, pitchRate: 0, rollRate: 0 }, 0.2);

  let fx = { dx: 0, dy: 0, roll: 0, audio: 0 };
  if (st.episode) {
    fx = st.episode.update(now, { tilt: st.tilt, yawRate: st.yawRate, pitchRate: st.pitchRate, rollRate: st.rollRate });
    if (fx.phase === 'running' && st.state === 'waiting') {
      st.state = 'running';
      st.message = null;
      sendStatus();
    }
    if (sound) sound.set(fx.audio, vol(), false);
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
window.__snd = () => sound && { tinnitus: sound.tinGain.gain.value, muffled: sound.mufGain.gain.value, testing: sound.ac.currentTime < sound.testUntil };
