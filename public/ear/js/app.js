// Tablet app (/ear): screens, hearing test flow, VR remote control.
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const state = {
    screen: null,
    lang: 'en',
    config: null,
    manifest: {},
    status: { tablet: {}, vr: {} },
    lastActivity: Date.now(),
    test: null, // running hearing test
    vrCondition: null,
    vrActive: false,
    vrStoppedByStop: false,
  };

  const audio = new DinAudio();
  const socket = io({ auth: { role: 'tablet' } });

  // Screens where the idle timer is longer (visitor is doing the test) or switched off (VR running).
  const TEST_SCREENS = ['volume', 'instructions', 'test', 'practiceDone', 'loading'];
  const NO_IDLE_SCREENS = ['vrRunning'];
  const PANEL_SCREENS = ['ackHearing', 'loading', 'missing', 'volume', 'instructions', 'practiceDone', 'test', 'result', 'ackVr', 'vrChoose', 'vrIntro', 'vrRunning', 'vrAfter'];
  const VR_SCREENS = ['vrIntro', 'vrRunning', 'vrAfter'];

  // ---------------- screens ----------------
  function show(name) {
    if (state.screen === name) return;
    if (state.screen === 'volume' && name !== 'volume') stopSample();
    if (state.screen === 'test' && name !== 'test') abortTest();
    state.screen = name;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 's-' + name));
    document.body.classList.toggle('panel-mode', PANEL_SCREENS.includes(name));
    document.body.classList.toggle('no-nav', name === 'home' || name === 'vrRunning' || name === 'test');
    if (name === 'home') resetVisitor();
    updateStopButton();
    socket.emit('tablet:status', { screen: name, lang: state.screen === 'home' ? null : state.lang });
    touch();
  }

  function setLang(lang) {
    state.lang = lang;
    I18n.lang = lang;
    I18n.apply();
    Kiosk.update();
    if (state.vrCondition) fillVrTexts();
    socket.emit('tablet:status', { screen: state.screen, lang });
  }

  function resetVisitor() {
    $('#tickHearing').checked = false;
    $('#tickVr').checked = false;
    $('#contHearing').disabled = true;
    $('#contVr').disabled = true;
    state.vrCondition = null;
    $('#langPopup').classList.add('hidden');
    audio.setVolume(0.5);
    $('#volSlider').value = 50;
  }

  // ---------------- idle timeout ----------------
  function touch() {
    state.lastActivity = Date.now();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, touch, { passive: true }));
  setInterval(() => {
    if (!state.config || state.screen === 'home') return;
    if (NO_IDLE_SCREENS.includes(state.screen) || state.vrActive) return;
    const limit = TEST_SCREENS.includes(state.screen) ? state.config.testIdleTimeoutSec : state.config.idleTimeoutSec;
    if (!limit) return;
    if (Date.now() - state.lastActivity > limit * 1000) show('home');
  }, 1000);

  // ---------------- navigation ----------------
  $$('[data-lang-choice]').forEach((b) =>
    b.addEventListener('click', () => {
      audio.unlock(); // first tap: allow sound
      setLang(b.dataset.langChoice);
      show('menu');
    }),
  );
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
  $('#navHome').addEventListener('click', () => show('home'));
  $('#navLang').addEventListener('click', () => $('#langPopup').classList.remove('hidden'));
  $('#langPopup').addEventListener('click', (e) => {
    if (e.target === $('#langPopup')) $('#langPopup').classList.add('hidden');
  });
  $$('[data-setlang]').forEach((b) =>
    b.addEventListener('click', () => {
      setLang(b.dataset.setlang);
      $('#langPopup').classList.add('hidden');
      // The digit sounds are language specific: restart the hearing flow if it was in progress.
      if (TEST_SCREENS.includes(state.screen)) show('ackHearing');
    }),
  );

  $('#goHearing').addEventListener('click', () => show('ackHearing'));
  $('#goVr').addEventListener('click', () => show('ackVr'));

  // Tick box -> Continue becomes active
  $('#tickHearing').addEventListener('change', (e) => ($('#contHearing').disabled = !e.target.checked));
  $('#tickVr').addEventListener('change', (e) => ($('#contVr').disabled = !e.target.checked));

  // ---------------- hearing test ----------------
  $('#contHearing').addEventListener('click', async () => {
    audio.unlock();
    show('loading');
    let ok = false;
    try {
      ok = await audio.load(state.lang, state.manifest);
    } catch (err) {
      console.error(err);
    }
    if (state.screen !== 'loading') return; // visitor left meanwhile
    if (!ok) return show('missing');
    show('volume');
    startSample();
  });

  // Volume step: a sample of digits in noise keeps playing until Continue.
  let sampleOn = false;
  async function startSample() {
    sampleOn = true;
    while (sampleOn && state.screen === 'volume') {
      await audio.playTriplet(DIN.makeTriplet(), state.config.din.startSnr, state.config.din.digitGapSec);
      await wait(400);
    }
  }
  function stopSample() {
    sampleOn = false;
    audio.stop();
  }
  const volSlider = $('#volSlider');
  volSlider.addEventListener('input', () => audio.setVolume(volSlider.value / 100));
  $('#volDown').addEventListener('click', () => {
    volSlider.value = Math.max(0, +volSlider.value - 5);
    audio.setVolume(volSlider.value / 100);
  });
  $('#volUp').addEventListener('click', () => {
    volSlider.value = Math.min(100, +volSlider.value + 5);
    audio.setVolume(volSlider.value / 100);
  });
  // After Continue the volume is locked: there is no volume control on later screens.
  $('#contVolume').addEventListener('click', () => {
    stopSample();
    show('instructions');
  });

  $('#startPractice').addEventListener('click', () => {
    const din = state.config.din;
    if (din.practiceTrials > 0) runTrials('practice');
    else runTrials('test');
  });
  $('#startTest').addEventListener('click', () => runTrials('test'));
  $('#quitTest').addEventListener('click', () => show('menu'));

  // Keypad
  let answer = [];
  let acceptInput = false;
  let answerResolve = null;
  function renderSlots() {
    $$('.slots span').forEach((s, i) => {
      s.textContent = answer[i] !== undefined ? answer[i] : '';
      s.classList.toggle('filled', answer[i] !== undefined);
    });
    $('#keypad [data-k="ok"]').disabled = answer.length !== 3;
  }
  $('#keypad').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !acceptInput) return;
    const k = b.dataset.k;
    if (k === 'del') answer.pop();
    else if (k === 'ok') {
      if (answer.length === 3 && answerResolve) {
        acceptInput = false;
        $('#keypad').classList.add('disabled');
        const r = answerResolve;
        answerResolve = null;
        r(answer.slice());
      }
      return;
    } else if (answer.length < 3) answer.push(Number(k));
    renderSlots();
  });
  function askAnswer() {
    answer = [];
    renderSlots();
    acceptInput = true;
    $('#keypad').classList.remove('disabled');
    return new Promise((resolve) => (answerResolve = resolve));
  }

  function abortTest() {
    if (state.test) state.test.aborted = true;
    state.test = null;
    acceptInput = false;
    answerResolve = null;
    audio.stop();
  }

  async function runTrials(kind) {
    const din = state.config.din;
    const test = { aborted: false, kind };
    state.test = test;
    show('test');
    state.test = test; // show() may have reset it
    const practice = kind === 'practice';
    const total = practice ? din.practiceTrials : din.testTrials;
    const stair = new DIN.Staircase(din);
    $('#testLabel').textContent = I18n.t(practice ? 'din.practice' : 'din.test');
    $('#testLabel').style.background = practice ? 'var(--teal)' : 'var(--violet)';

    for (let i = 0; i < total; i++) {
      if (test.aborted) return;
      $('#progressText').textContent = I18n.t('din.progress', { n: i + 1, total });
      $('#progressBar').style.width = (i / total) * 100 + '%';
      answer = [];
      renderSlots();
      $('#keypad').classList.add('disabled');
      $('#testStatus').textContent = I18n.t('din.listen');
      await wait(500);
      if (test.aborted) return;
      const triplet = DIN.makeTriplet();
      const snr = practice ? din.practiceSnr : stair.snr;
      await audio.playTriplet(triplet, snr, din.digitGapSec);
      if (test.aborted) return;
      $('#testStatus').textContent = I18n.t('din.type');
      const response = await askAnswer();
      if (test.aborted) return;
      if (!practice) stair.record(DIN.isCorrect(triplet, response));
      touch();
      await wait(250);
    }
    $('#progressBar').style.width = '100%';
    state.test = null;
    if (practice) return show('practiceDone');
    finishTest(stair.srt());
  }

  async function finishTest(srt) {
    const band = DIN.bandFor(srt, state.config.bands);
    showResult(band, DIN.gaugePosition(srt, state.config.bands));
    try {
      // Saved anonymously: time, language, SRT and band only.
      await fetch('/api/ear/results', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lang: state.lang, srt }),
      });
    } catch (err) {
      console.warn('Could not save result', err);
    }
  }

  function showResult(band, pos) {
    const text = $('#resultText');
    text.className = 'lead result-text ' + band;
    text.dataset.i18n = 'result.' + band;
    text.textContent = I18n.t('result.' + band);
    const needle = $('#needle');
    needle.style.transition = 'none';
    needle.style.transform = 'rotate(-90deg)';
    show('result');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        needle.style.transition = '';
        needle.style.transform = `rotate(${-90 + 180 * pos}deg)`;
      }),
    );
  }
  $('#tryAgain').addEventListener('click', () => {
    $('#tickHearing').checked = true;
    $('#contHearing').disabled = false;
    show('ackHearing');
  });

  // ---------------- VR ----------------
  $('#contVr').addEventListener('click', () => show('vrChoose'));
  $$('[data-cond]').forEach((b) =>
    b.addEventListener('click', () => {
      state.vrCondition = b.dataset.cond;
      fillVrTexts();
      show('vrIntro');
      updatePhoneReady();
    }),
  );

  function fillVrTexts() {
    const c = state.vrCondition;
    if (!c) return;
    $('#vrIntroName').textContent = I18n.t(`vr.${c}.name`);
    $('#vrIntroText').textContent = I18n.t(`vr.${c}.intro`);
    $('#vrRunName').textContent = I18n.t(`vr.${c}.name`);
    const hint = c === 'bppv' ? 'vr.tiltHint' : c === 'oscillopsia' ? 'vr.moveHint' : null;
    $('#vrRunHint').textContent = hint ? I18n.t(hint) : '';
    $('#vrWhat').textContent = I18n.t(`vr.${c}.what`);
    $('#vrDoctor').textContent = I18n.t(`vr.${c}.doctor`);
  }

  function phoneReady() {
    const vr = state.status.vr || {};
    return vr.connected > 0 && !!vr.ready;
  }
  function updatePhoneReady() {
    const ready = phoneReady();
    $('#vrPhoneMissing').classList.toggle('hidden', ready);
    $('#vrStart').disabled = !ready;
  }

  $('#vrStart').addEventListener('click', () => {
    if (!phoneReady()) return;
    state.vrActive = true;
    state.vrStoppedByStop = false;
    state.vrStartedAt = Date.now();
    socket.emit('vr:start', { condition: state.vrCondition, lang: state.lang });
    $('#vrProgress').style.width = '0%';
    show('vrRunning');
  });

  $('#stopBtn').addEventListener('click', () => {
    socket.emit('vr:stop', { lang: state.lang });
    endVr(true);
  });

  function endVr(byStop) {
    const wasActive = state.vrActive;
    state.vrActive = false;
    if (byStop) state.vrStoppedByStop = true;
    $('#vrStoppedNote').classList.toggle('hidden', !state.vrStoppedByStop);
    if (wasActive || state.screen === 'vrRunning') show('vrAfter');
    updateStopButton();
  }

  socket.on('vr:ended', () => endVr(false));
  socket.on('vr:stopped', () => {
    if (state.vrActive) endVr(true);
  });

  function updateStopButton() {
    const vrState = (state.status.vr || {}).state;
    const phoneBusy = vrState === 'running' || vrState === 'waiting';
    const visible = state.vrActive || phoneBusy || state.screen === 'vrRunning';
    $('#stopBtn').classList.toggle('hidden', !visible);
    document.body.classList.toggle('stop-visible', visible);
  }

  // Progress bar while running (from the phone's reports).
  function updateVrProgress() {
    const vr = state.status.vr || {};
    if (state.screen !== 'vrRunning') return;
    if (vr.state === 'running' && vr.duration) {
      $('#vrProgress').style.width = Math.min(100, (vr.elapsed / vr.duration) * 100) + '%';
    }
  }

  // ---------------- socket ----------------
  socket.on('settings', (cfg) => (state.config = cfg));
  socket.on('vr:cal', (msg) => state.config && (state.config.vrCal = msg.cal));
  socket.on('digits', (m) => (state.manifest = m));
  socket.on('status', (s) => {
    state.status = s;
    updatePhoneReady();
    updateStopButton();
    updateVrProgress();
  });
  socket.on('connect', () => socket.emit('tablet:status', { screen: state.screen, lang: state.lang }));

  // ---------------- hidden headset calibration ----------------
  // Press and hold the top-right corner for 3 s. Values go live to the phone over Socket.IO.
  const CAL_FIELDS = [
    ['distortion', 'Distortion', 0, 1, 0.01],
    ['zoom', 'Zoom', 0.4, 2.5, 0.01],
    ['ipd', 'Distance between eye centres', 0.3, 0.7, 0.005],
    ['vertical', 'Vertical position', -0.25, 0.25, 0.005],
    ['eyeSize', 'Eye circle size', 0.4, 1.3, 0.01],
    ['roundness', 'Roundness', 0, 1, 0.01],
    ['noseWidth', 'Nose cutout width', 0, 0.4, 0.005],
    ['noseHeight', 'Nose cutout height', 0, 0.6, 0.005],
    ['divider', 'Divider width', 0, 0.06, 0.001],
    ['pictureSize', 'Picture size in screen mode', 0.8, 2.2, 0.01],
  ];
  const calInputs = {};
  for (const [key, label, min, max, step] of CAL_FIELDS) {
    const wrap = document.createElement('div');
    wrap.className = 'cal-field';
    wrap.innerHTML = `<label><span></span><output></output></label><input type="range" min="${min}" max="${max}" step="${step}" />`;
    wrap.querySelector('span').textContent = label;
    const input = wrap.querySelector('input');
    const out = wrap.querySelector('output');
    input.addEventListener('input', () => {
      out.textContent = Number(input.value).toFixed(3).replace(/\.?0+$/, '');
      queueCal();
    });
    calInputs[key] = { input, out };
    $('#calFields').appendChild(wrap);
  }
  function fillCal(cal) {
    if (!cal) return;
    for (const [key] of CAL_FIELDS) {
      const { input, out } = calInputs[key];
      input.value = cal[key];
      out.textContent = Number(cal[key]).toFixed(3).replace(/\.?0+$/, '');
    }
  }
  let calTimer = null;
  function queueCal() {
    // at most ~10 updates per second while a slider is dragged
    if (calTimer) return;
    calTimer = setTimeout(() => {
      calTimer = null;
      const cal = {};
      for (const [key] of CAL_FIELDS) cal[key] = Number(calInputs[key].input.value);
      socket.emit('vr:cal', { cal, testPattern: $('#calTest').checked });
    }, 100);
  }
  $('#calTest').addEventListener('change', () => socket.emit('vr:cal', { testPattern: $('#calTest').checked }));
  $('#calReset').addEventListener('click', () => socket.emit('vr:cal', { reset: true, testPattern: $('#calTest').checked }));
  $('#calClose').addEventListener('click', () => {
    $('#calPanel').classList.add('hidden');
    $('#calTest').checked = false;
    socket.emit('vr:cal', { testPattern: false });
  });
  socket.on('vr:cal', (msg) => fillCal(msg.cal));

  function openCal() {
    fillCal(state.config && state.config.vrCal);
    const vr = state.status.vr || {};
    $('#calPhone').textContent = vr.connected ? (vr.ready ? `Phone ready${vr.camRes ? ' · ' + vr.camRes : ''}` : 'Phone connected, not started') : 'Phone not connected';
    $('#calPanel').classList.remove('hidden');
  }
  let holdTimer = null;
  const hot = $('#calHotspot');
  hot.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    clearTimeout(holdTimer);
    holdTimer = setTimeout(openCal, 3000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => hot.addEventListener(ev, () => clearTimeout(holdTimer)));
  hot.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------- start ----------------
  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function init() {
    await I18n.load();
    // Fullscreen + screen awake from the first tap (the language choice).
    Kiosk.init({ label: () => I18n.t('fullscreen.return') });
    const [cfg, manifest] = await Promise.all([fetch('/api/config').then((r) => r.json()), fetch('/api/ear/digits').then((r) => r.json())]);
    state.config = state.config || cfg;
    state.manifest = manifest;
    I18n.lang = 'en';
    I18n.apply();
    show('home');
    // Missing background video -> keep the animated gradient.
    $('#bgVideo').addEventListener('error', () => ($('#bgVideo').style.display = 'none'));
    $('#bgVideo').play().catch(() => {});
  }

  // Exposed for automated tests only.
  window.__ear = { state, audio, show, openCal };
  init();
})();
