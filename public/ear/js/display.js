// Monitor display (/ear/display): follows the tablet.
//   condition chosen  -> its picture (in the visitor's language) for N seconds (host setting)
//   then              -> "Put on the VR headset to experience …"
//   VR running        -> condition name + progress
//   after             -> "Take the headset off slowly" + explanation
//   otherwise         -> welcome title
(function () {
  const $ = (s) => document.querySelector(s);
  const ICONS = { bppv: '↻', neuritis: '⇢', menieres: '≈', oscillopsia: '↕' };

  const socket = io({ auth: { role: 'display' } });
  let status = { tablet: {}, vr: {} };
  let config = null;
  let images = {};
  let intro = null; // { key, condition, lang, start }
  let preview = null; // { condition, lang, start } from the host page
  let scene = null;

  const t = (key, lang) => I18n.t(key, null, lang);

  function show(name) {
    if (scene === name) return;
    scene = name;
    document.querySelectorAll('.scene').forEach((s) => s.classList.toggle('active', s.id === 'd-' + name));
    document.body.classList.toggle('dim', name !== 'idle');
  }

  function imageSeconds() {
    return (config && config.display && config.display.imageSeconds) || 15;
  }

  function fillImage(condition, lang) {
    const set = images[condition] || {};
    const url = set[lang] || set.all;
    const pic = $('#pic');
    if (url) {
      if (pic.dataset.src !== url) {
        pic.src = url;
        pic.dataset.src = url;
      }
      pic.style.display = '';
      $('#picFallback').style.display = 'none';
    } else {
      // No picture uploaded yet: a clean text card with the condition's short explanation.
      pic.style.display = 'none';
      $('#picFallback').style.display = '';
      $('#fbIcon').textContent = ICONS[condition] || '';
      $('#fbName').textContent = t(`vr.${condition}.name`, lang);
      $('#fbText').textContent = t(`vr.${condition}.intro`, lang);
    }
    $('#capName').textContent = t(`vr.${condition}.name`, lang);
  }

  function update() {
    if (!I18n.data['home.title']) return;
    const now = Date.now();
    const tab = status.tablet || {};
    const vr = status.vr || {};
    const lang = tab.lang || 'en';
    const cond = tab.condition;

    // Host page "show on monitor" check
    if (preview) {
      const el = (now - preview.start) / 1000;
      if (el < imageSeconds()) {
        fillImage(preview.condition, preview.lang);
        $('#timerBar').style.width = Math.min(100, (el / imageSeconds()) * 100) + '%';
        return show('image');
      }
      preview = null;
    }

    const vrBusy = vr.state === 'running' || vr.state === 'waiting';
    if (cond && (vrBusy || tab.screen === 'vrRunning')) {
      intro = null;
      $('#runName').textContent = t(`vr.${cond}.name`, lang);
      $('#runText').textContent = t('vr.running', lang);
      const hint = vr.state === 'waiting' && cond === 'bppv' ? 'vr.tiltHint' : cond === 'oscillopsia' ? 'vr.moveHint' : null;
      $('#runHint').textContent = hint ? t(hint, lang) : '';
      $('#runBar').style.width = vr.duration ? Math.min(100, (vr.elapsed / vr.duration) * 100) + '%' : '0%';
      return show('running');
    }

    if (cond && tab.screen === 'vrIntro') {
      const key = cond + ':' + lang;
      if (!intro || intro.key !== key) intro = { key, start: now };
      const el = (now - intro.start) / 1000;
      if (el < imageSeconds()) {
        fillImage(cond, lang);
        $('#timerBar').style.width = Math.min(100, (el / imageSeconds()) * 100) + '%';
        return show('image');
      }
      $('#wearText').textContent = t('display.wear', lang);
      $('#wearName').textContent = t(`vr.${cond}.name`, lang);
      $('#wearHint').textContent = t('display.wearHint', lang);
      return show('wear');
    }
    intro = null;

    if (cond && tab.screen === 'vrAfter') {
      $('#afterTakeOff').textContent = t('vr.takeOff', lang);
      $('#afterName').textContent = t(`vr.${cond}.name`, lang);
      $('#afterWhatH').textContent = t('vr.whatHeading', lang);
      $('#afterWhat').textContent = t(`vr.${cond}.what`, lang);
      $('#afterDocH').textContent = t('vr.doctorHeading', lang);
      $('#afterDoc').textContent = t(`vr.${cond}.doctor`, lang);
      return show('after');
    }

    show('idle');
  }

  socket.on('status', (s) => {
    status = s;
    update();
  });
  socket.on('settings', (s) => {
    config = s;
    update();
  });
  socket.on('images', (m) => {
    images = m;
    update();
  });
  socket.on('display:preview', (p) => {
    preview = { ...p, start: Date.now() };
    update();
  });
  setInterval(update, 250);

  // ---------- full screen on the external monitor ----------
  // Chrome/Edge can put the page full screen on the second screen directly (asks for "window management" once).
  $('#fsBtn').addEventListener('click', async () => {
    let target;
    try {
      if ('getScreenDetails' in window) {
        const details = await window.getScreenDetails();
        target = details.screens.find((s) => !s.isPrimary) || details.currentScreen;
      }
    } catch {
      /* permission refused – use the screen this window is on */
    }
    try {
      await document.documentElement.requestFullscreen(target ? { screen: target, navigationUI: 'hide' } : { navigationUI: 'hide' });
    } catch (e) {
      alert('Full screen did not work: drag this window onto the monitor and press F11.');
    }
  });
  document.addEventListener('fullscreenchange', () => document.body.classList.toggle('fullscreen', !!document.fullscreenElement));

  // Hide the mouse pointer when it is not moving.
  let cursorTimer = null;
  document.addEventListener('mousemove', () => {
    document.body.classList.remove('hide-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('hide-cursor'), 2500);
  });

  $('#bgVideo').addEventListener('error', () => ($('#bgVideo').style.display = 'none'));

  async function init() {
    await I18n.load();
    I18n.apply();
    images = await fetch('/api/vr/images').then((r) => r.json());
    update();
  }
  window.__display = { get scene() { return scene; } }; // for automated tests
  init();
})();
