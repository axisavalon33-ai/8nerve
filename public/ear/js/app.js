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
  // vrIntro is included: the visitor may be putting on the headset, waiting for the helper to press START.
  const TEST_SCREENS = ['volume', 'instructions', 'test', 'practiceDone', 'loading', 'vrIntro'];
  const NO_IDLE_SCREENS = ['vrRunning'];
  const PANEL_SCREENS = ['ackHearing', 'loading', 'missing', 'volume', 'instructions', 'practiceDone', 'test', 'result', 'ackVr', 'vrChoose', 'vrIntro', 'vrRunning'];
  const VR_SCREENS = ['vrIntro', 'vrRunning'];

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
    sendTabletStatus();
    touch();
  }

  function setLang(lang) {
    state.lang = lang;
    I18n.lang = lang;
    I18n.apply();
    Kiosk.update();
    if (state.vrCondition) fillVrTexts();
    sendTabletStatus();
  }

  function resetVisitor() {
    $('#tickHearing').checked = false;
    $('#tickVr').checked = false;
    $('#contHearing').disabled = true;
    $('#contVr').disabled = true;
    state.vrCondition = null;
    state.consent = false;
    $('#afterBanner').classList.add('hidden');
    $('#langPopup').classList.add('hidden');
    audio.setVolume(0.5);
    $('#volSlider').value = 50;
  }

  // Screen, language and chosen VR condition -> server (host page + monitor display follow this).
  function sendTabletStatus() {
    socket.emit('tablet:status', {
      screen: state.screen,
      lang: state.screen === 'home' ? null : state.lang,
      condition: VR_SCREENS.includes(state.screen) ? state.vrCondition : null,
      consent: !!state.consent,
      stage: state.screen === 'vrIntro' ? readStage() : null,
    });
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
    const bands = DIN.bandsFor(state.config.bands, state.lang);
    const band = DIN.bandFor(srt, bands);
    $('#calibNote').classList.add('hidden');
    showResult(band, DIN.gaugePosition(srt, bands));
    try {
      // Saved anonymously: time, language, SRT and band only.
      const res = await fetch('/api/ear/results', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lang: state.lang, srt }),
      });
      const saved = await res.json();
      // Calibration mode (staff only): show the measured value so the tester can note it.
      if (saved.calib) {
        $('#calibNote').textContent = `Calibration test (normal listener) – SRT ${srt.toFixed(1)} dB`;
        $('#calibNote').classList.remove('hidden');
      }
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
  // Visitor: consent -> choose a condition -> read about it (picture time) -> put on the headset.
  // The helper starts and stops the experience on the host page.
  $('#contVr').addEventListener('click', () => {
    state.consent = true;
    show('vrChoose');
  });
  $$('[data-cond]').forEach((b) => b.addEventListener('click', () => chooseCondition(b.dataset.cond)));
  $('#bannerClose').addEventListener('click', () => $('#afterBanner').classList.add('hidden'));

  let images = {};
  let readStart = 0;
  function chooseCondition(c) {
    state.vrCondition = c;
    $('#afterBanner').classList.add('hidden');
    fillVrTexts();
    readStart = Date.now();
    $('#vrRead').classList.remove('hidden');
    $('#vrWear').classList.add('hidden');
    $('#readBar').style.width = '0%';
    if (state.screen === 'vrIntro') sendTabletStatus();
    else show('vrIntro');
  }
  function readStage() {
    return $('#vrWear').classList.contains('hidden') ? 'read' : 'wear';
  }
  function pictureSeconds() {
    return (state.config && state.config.display && state.config.display.imageSeconds) || 15;
  }
  // After the picture time: "Put on the VR headset".
  setInterval(() => {
    if (state.screen !== 'vrIntro' || readStage() !== 'read') return;
    const el = (Date.now() - readStart) / 1000;
    $('#readBar').style.width = Math.min(100, (el / pictureSeconds()) * 100) + '%';
    if (el >= pictureSeconds()) {
      $('#vrRead').classList.add('hidden');
      $('#vrWear').classList.remove('hidden');
      sendTabletStatus();
    }
  }, 200);

  function fillVrTexts() {
    const c = state.vrCondition;
    if (!c) return;
    $('#vrIntroName').textContent = I18n.t(`vr.${c}.name`);
    $('#vrIntroText').textContent = I18n.t(`vr.${c}.intro`);
    $('#vrWearName').textContent = I18n.t(`vr.${c}.name`);
    $('#vrRunName').textContent = I18n.t(`vr.${c}.name`);
    const hint = c === 'bppv' ? 'vr.tiltHint' : c === 'oscillopsia' ? 'vr.moveHint' : null;
    $('#vrRunHint').textContent = hint ? I18n.t(hint) : '';
    $('#bannerDoctor').textContent = I18n.t(`vr.${c}.doctor`);
    // Picture for this condition in the visitor's language (or for all languages)
    const set = images[c] || {};
    const url = set[state.lang] || set.all;
    $('#vrPic').classList.toggle('hidden', !url);
    if (url) $('#vrPic').src = url;
    showStrength();
  }

  // Effect strength (set on the host page), shown on the VR screens for the helper.
  function showStrength() {
    const v = state.config && state.config.vr ? state.config.vr.intensity : null;
    const pct = typeof v === 'number' ? Math.round(v * 100) : null;
    document.querySelectorAll('.strength').forEach((el) => {
      el.textContent = pct === null ? '' : `${I18n.t('vr.strength')}: ${pct}%`;
      el.style.setProperty('--pct', (pct || 0) + '%');
    });
  }

  // The helper chose a condition on the host page (optionally also the language, for checking pictures).
  socket.on('visitor:select', (msg) => {
    if (msg.lang && msg.lang !== state.lang) setLang(msg.lang);
    if (state.screen === 'home') I18n.apply();
    chooseCondition(msg.condition);
  });

  // The helper pressed START on the host page.
  function startedVr(condition) {
    if (condition && condition !== state.vrCondition) {
      state.vrCondition = condition;
      fillVrTexts();
    }
    state.vrActive = true;
    $('#vrProgress').style.width = '0%';
    show('vrRunning');
  }
  socket.on('vr:started', (msg) => startedVr(msg && msg.condition));

  // Finished or stopped: back to the condition menu with "take the headset off slowly".
  function endVr() {
    const wasActive = state.vrActive || state.screen === 'vrRunning';
    state.vrActive = false;
    if (!wasActive) return;
    $('#afterBanner').classList.remove('hidden');
    show('vrChoose');
    touch();
  }
  socket.on('vr:ended', endVr);
  socket.on('vr:stopped', endVr);

  // Progress bar while running (from the phone's reports).
  function updateVrProgress() {
    const vr = state.status.vr || {};
    if (state.screen !== 'vrRunning') return;
    if (vr.state === 'running' && vr.duration) {
      $('#vrProgress').style.width = Math.min(100, (vr.elapsed / vr.duration) * 100) + '%';
    }
  }

  // ---------------- socket ----------------
  socket.on('settings', (cfg) => {
    state.config = cfg;
    showStrength();
  });
  socket.on('vr:cal', (msg) => state.config && (state.config.vrCal = msg.cal));
  socket.on('digits', (m) => (state.manifest = m));
  socket.on('status', (s) => {
    state.status = s;
    // Safety net: if the phone is running but this screen missed the start message
    const vrState = (s.vr || {}).state;
    if ((vrState === 'running' || vrState === 'waiting') && state.screen === 'vrIntro') startedVr(s.vr.condition);
    updateVrProgress();
  });
  socket.on('images', (m) => {
    images = m;
    fillVrTexts();
  });
  socket.on('connect', sendTabletStatus);

  // ---------------- keyboard for the number pad ----------------
  document.addEventListener('keydown', (e) => {
    if (state.screen !== 'test') return;
    const k = /^[0-9]$/.test(e.key) ? e.key : e.key === 'Backspace' ? 'del' : e.key === 'Enter' ? 'ok' : null;
    if (!k) return;
    e.preventDefault();
    const b = $(`#keypad [data-k="${k}"]`);
    if (b && !b.disabled) b.click();
  });

  // ---------------- full screen on the external monitor ----------------
  // Chrome/Edge can open the page full screen on the second screen directly (asks for "window management" once).
  $('#monitorFs').addEventListener('click', async (e) => {
    e.stopPropagation();
    let target;
    try {
      if ('getScreenDetails' in window) {
        const details = await window.getScreenDetails();
        target = details.screens.find((sc) => !sc.isPrimary) || details.currentScreen;
      }
    } catch {
      /* permission refused – use the screen this window is on */
    }
    try {
      await document.documentElement.requestFullscreen(target ? { screen: target, navigationUI: 'hide' } : { navigationUI: 'hide' });
    } catch {
      alert('Full screen did not work: drag this window onto the monitor and press F11.');
    }
  });
  document.addEventListener('fullscreenchange', () => document.body.classList.toggle('is-fullscreen', !!document.fullscreenElement));
  // Touch tablets use the automatic full screen instead.
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) $('#monitorFs').classList.add('hidden');

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
    images = await fetch('/api/vr/images').then((r) => r.json());
    I18n.lang = 'en';
    I18n.apply();
    show('home');
    // Missing background video -> keep the animated gradient.
    $('#bgVideo').addEventListener('error', () => ($('#bgVideo').style.display = 'none'));
    $('#bgVideo').play().catch(() => {});
  }

  // Exposed for automated tests only.
  window.__ear = { state, audio, show };
  init();
})();
