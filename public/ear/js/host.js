// Host page (/ear/host): live status, settings, anonymous result counts.
(function () {
  const $ = (s) => document.querySelector(s);
  const LANG_NAMES = { en: 'English', ta: 'Tamil', si: 'Sinhala' };
  const COND_NAMES = { bppv: 'BPPV (right ear)', neuritis: 'Vestibular neuritis', menieres: "Ménière's disease", oscillopsia: 'Oscillopsia' };

  Staff.login(start);

  function start() {
    $('#main').classList.remove('hidden');
    const socket = io({ auth: { role: 'host', pin: Staff.pin } });
    socket.on('auth-error', () => {
      sessionStorage.removeItem('earPin');
      location.reload();
    });
    socket.on('status', renderStatus);
    socket.on('results', renderResults);
    socket.on('digitStatus', (st) => renderDigitAudio({ status: st, espeak: lastDigitInfo.espeak }));
    socket.on('settings', (pub) => renderLive(pub));
    hostSocket = socket;
    $('#hostStop').addEventListener('click', () => socket.emit('vr:stop', {}));
    $('#csvLink').href = '/api/host/results.csv?pin=' + encodeURIComponent(Staff.pin);

    $('#resetResults').addEventListener('click', async () => {
      if (!confirm('Delete ALL saved hearing results? This cannot be undone.')) return;
      renderResults(await Staff.api('/api/host/results', { method: 'DELETE' }));
    });
    $('#saveSettings').addEventListener('click', saveSettings);
    $('#resetSettings').addEventListener('click', async () => {
      if (!confirm('Restore all settings to their defaults? (The PIN and the headset calibration stay the same.)')) return;
      fillForm(await Staff.api('/api/host/settings/reset', { method: 'POST' }));
      flashSaved();
    });

    Staff.api('/api/host/settings').then(fillForm);
    Staff.api('/api/host/links').then(renderLinks);
    I18n.load().then(loadVoices);
    loadImages();
    socket.on('images', (m) => {
      imageFiles = m;
      renderImages();
    });
    $('#openDisplay').addEventListener('click', () => window.open('/ear/display', 'earDisplay', 'popup,width=1280,height=720'));
    $('#picMinus').addEventListener('click', () => changePicTime(-5));
    $('#picPlus').addEventListener('click', () => changePicTime(5));
    fetch('/api/ear/digits/status').then((r) => r.json()).then(renderDigitAudio);
    setupLive();
    $('#regenDigits').addEventListener('click', async () => {
      const btn = $('#regenDigits');
      btn.disabled = true;
      btn.textContent = 'Making digits…';
      try {
        const r = await Staff.api('/api/host/digits/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"force":true}' });
        renderDigitAudio({ status: r.status, espeak: true });
      } catch (e) {
        alert('Could not make the digits: ' + e.message);
      }
      btn.disabled = false;
      btn.textContent = 'Make generated digits again';
    });
  }

  let hostSocket = null;
  let lastDigitInfo = { espeak: true };
  const CONDS = ['bppv', 'neuritis', 'menieres', 'oscillopsia'];
  const LANGS = ['en', 'ta', 'si'];
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const button = (text, onClick, cls = 'mini') => {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  // "Upload MP3" button: a hidden file input inside a label.
  const fileButton = (text, onFile) => {
    const l = el('label', 'mini file-btn', text);
    const input = el('input');
    input.type = 'file';
    input.accept = 'audio/*,.mp3,.m4a,.wav,.ogg';
    input.addEventListener('change', () => input.files[0] && onFile(input.files[0]).finally(() => (input.value = '')));
    l.appendChild(input);
    return l;
  };
  function playUrl(url) {
    const a = new Audio(url);
    a.play().catch((e) => alert('Cannot play: ' + e.message));
  }

  // ---------- live VR controls (saved at once) ----------
  let saveTimer = null;
  let pending = {};
  function saveLive(patch) {
    // merge quick changes (e.g. dragging a slider) into one save every 200 ms
    pending = deepMerge(pending, patch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const body = JSON.stringify(pending);
      pending = {};
      try {
        await Staff.api('/api/host/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body });
      } catch (e) {
        alert('Could not save: ' + e.message);
      }
    }, 200);
  }
  function deepMerge(a, b) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' ? deepMerge(a[k] || {}, v) : v;
    return out;
  }

  let live = null; // last public settings
  function strengthName(v) {
    const pct = Math.round((v || 0) * 100);
    const name = v <= 0.4 ? 'Low' : v <= 0.7 ? 'Medium' : 'High';
    return `${pct}% (${name})`;
  }

  function setupLive() {
    $('#vrStrength').addEventListener('input', () => {
      const v = Number($('#vrStrength').value) / 100;
      $('#vrStrengthOut').textContent = Math.round(v * 100) + '%';
      $('#vrStrengthStatus').textContent = strengthName(v);
      saveLive({ vr: { intensity: v } });
    });
    document.querySelectorAll('[data-strength]').forEach((b) =>
      b.addEventListener('click', () => {
        const v = Number(b.dataset.strength);
        $('#vrStrength').value = Math.round(v * 100);
        $('#vrStrengthOut').textContent = Math.round(v * 100) + '%';
        saveLive({ vr: { intensity: v } });
      }),
    );
    $('#calibMode').addEventListener('change', () => saveLive({ calibrationMode: $('#calibMode').checked }));
    $('#calibClear').addEventListener('click', async () => {
      if (!confirm('Unmark all normal-listener results? (The results stay, they just count as visitors again.)')) return;
      renderResults(await Staff.api('/api/host/results/calibration', { method: 'DELETE' }));
    });
    const wrap = $('#durations');
    for (const c of CONDS) {
      const row = el('div', 'dur');
      row.append(el('span', '', COND_NAMES[c]));
      const pm = el('div', 'pm');
      const minus = button('−', () => changeDur(c, -5), '');
      const out = el('output');
      out.id = 'dur-' + c;
      const plus = button('+', () => changeDur(c, 5), '');
      minus.dataset.dur = c + ':-';
      plus.dataset.dur = c + ':+';
      pm.append(minus, out, plus);
      row.append(pm);
      wrap.append(row);
    }
    const slider = (id, outId, key, fmt, scale) => {
      $(id).addEventListener('input', () => {
        const v = Number($(id).value) / scale;
        $(outId).textContent = fmt(v);
        saveLive({ vr: { [key]: v } });
      });
    };
    slider('#tinVol', '#tinVolOut', 'tinnitusVolume', (v) => Math.round(v * 100) + '%', 100);
    slider('#mufVol', '#mufVolOut', 'muffledVolume', (v) => Math.round(v * 100) + '%', 100);
    slider('#oscSens', '#oscSensOut', 'oscillopsiaSensitivity', (v) => '×' + v.toFixed(1), 1);
    document.querySelectorAll('[data-test-sound]').forEach((b) =>
      b.addEventListener('click', () => hostSocket && hostSocket.emit('vr:testSound', { kind: b.dataset.testSound })),
    );
  }
  function changeDur(c, step) {
    if (!live) return;
    const cur = live.vr.durations[c];
    const next = Math.min(60, Math.max(10, cur + step));
    live.vr.durations[c] = next;
    renderLive(live);
    saveLive({ vr: { durations: { [c]: next } } });
  }
  function renderLive(pub) {
    live = JSON.parse(JSON.stringify(pub));
    currentBands = pub.bands;
    renderCalibration();
    $('#calibMode').checked = !!pub.calibrationMode;
    $('#calibModeWarn').classList.toggle('hidden', !pub.calibrationMode);
    const pct = Math.round((pub.vr.intensity || 0.35) * 100);
    if (document.activeElement !== $('#vrStrength')) $('#vrStrength').value = pct;
    $('#vrStrengthOut').textContent = pct + '%';
    $('#vrStrengthStatus').textContent = strengthName(pub.vr.intensity);
    const pic = (pub.display && pub.display.imageSeconds) || 15;
    $('#picSec').textContent = pic + ' s';
    $('#picMinus').disabled = pic <= 5;
    $('#picPlus').disabled = pic >= 120;
    for (const c of CONDS) {
      const v = pub.vr.durations[c];
      $('#dur-' + c).textContent = v + ' s';
      document.querySelector(`[data-dur="${c}:-"]`).disabled = v <= 10;
      document.querySelector(`[data-dur="${c}:+"]`).disabled = v >= 60;
    }
    // don't move a slider while it is being dragged
    const setSlider = (id, outId, v, scale, fmt) => {
      if (document.activeElement === $(id)) return;
      $(id).value = v * scale;
      $(outId).textContent = fmt(v);
    };
    setSlider('#tinVol', '#tinVolOut', pub.vr.tinnitusVolume, 100, (v) => Math.round(v * 100) + '%');
    setSlider('#mufVol', '#mufVolOut', pub.vr.muffledVolume, 100, (v) => Math.round(v * 100) + '%');
    setSlider('#oscSens', '#oscSensOut', pub.vr.oscillopsiaSensitivity, 1, (v) => '×' + Number(v).toFixed(1));
  }

  // ---------- head movement ----------
  function meter(bar, val, v, max, unit) {
    const f = Math.max(-1, Math.min(1, (v || 0) / max));
    const i = $(bar);
    i.style.left = (f < 0 ? 50 + f * 50 : 50) + '%';
    i.style.width = Math.abs(f) * 50 + '%';
    $(val).textContent = v === undefined ? '–' : (v > 0 ? '+' : '') + Math.round(v) + unit;
  }
  function renderMotion(vr) {
    const SRC = {
      gyro: 'Gyroscope ✓',
      orientation: 'Orientation sensor (no gyroscope – works, a little less smooth)',
      'tilt-only': 'Tilt only – this phone has no gyroscope/orientation sensor: oscillopsia cannot follow head turns',
      none: 'No data',
    };
    $('#mSource').textContent = vr.connected ? SRC[vr.sensorSource] || '–' : 'Phone not connected';
    $('#mPerm').textContent = { granted: 'Granted', denied: 'Refused', 'not-needed': 'Not needed (Android)', 'not-asked': 'Not asked yet – tap Start on the phone' }[vr.motionPermission] || '–';
    meter('#barTilt', '#valTilt', vr.tilt, 60, '°');
    meter('#barYaw', '#valYaw', vr.yawRate, 200, '');
    meter('#barPitch', '#valPitch', vr.pitchRate, 200, '');
    meter('#barRoll', '#valRoll', vr.rollRate, 200, '');
    let warn = '';
    if (vr.connected && vr.ready && (vr.sensorSource === 'none' || !vr.sensorSource)) {
      warn =
        vr.motionPermission === 'denied'
          ? '⚠ Motion sensor permission was refused on the phone. Reload /vr and allow it when asked.'
          : '⚠ No motion sensor data from the phone. On the phone in Chrome: ⋮ → Settings → Site settings → Motion sensors → Allow, then reload /vr. BPPV and oscillopsia need these sensors.';
    } else if (vr.connected && vr.sensorSource === 'tilt-only') {
      warn = '⚠ This phone reports tilt but no turning speed: BPPV works, but oscillopsia cannot respond to head turns.';
    }
    $('#sensorWarning').textContent = warn;
    $('#sensorWarning').classList.toggle('hidden', !warn);
  }

  // ---------- monitor display ----------
  let imageFiles = {};
  async function loadImages() {
    imageFiles = await fetch('/api/vr/images').then((r) => r.json());
    renderImages();
  }
  function changePicTime(step) {
    if (!live) return;
    const cur = (live.display && live.display.imageSeconds) || 15;
    const next = Math.min(120, Math.max(5, cur + step));
    live.display = { imageSeconds: next };
    renderLive(live);
    saveLive({ display: { imageSeconds: next } });
  }
  function renderImages() {
    const tbody = $('#imageTable');
    tbody.innerHTML = '';
    for (const c of CONDS) {
      const tr = el('tr');
      tr.append(el('td', '', COND_NAMES[c]));
      for (const key of [...LANGS, 'all']) {
        const td = el('td', 'voice-cell');
        const url = imageFiles[c] && imageFiles[c][key];
        if (url) {
          const img = el('img', 'thumb');
          img.src = url;
          td.append(img);
        } else {
          td.append(el('div', 'thumb empty', key === 'all' ? 'no picture' : 'uses "All" / text card'));
        }
        td.append(
          fileButton('⬆ Upload', async (file) => {
            const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
            try {
              imageFiles = await Staff.api(`/api/vr/images/${c}/${key}?ext=${encodeURIComponent(ext)}`, { method: 'PUT', body: file });
              renderImages();
            } catch (e) {
              alert('Could not upload: ' + e.message);
            }
          }),
        );
        if (url)
          td.append(
            button(
              '✕ Remove',
              async () => {
                imageFiles = await Staff.api(`/api/vr/images/${c}/${key}`, { method: 'DELETE' });
                renderImages();
              },
              'mini danger',
            ),
          );
        td.append(button('▶ Show on monitor', () => hostSocket && hostSocket.emit('display:preview', { condition: c, lang: key === 'all' ? 'en' : key })));
        tr.append(td);
      }
      tbody.append(tr);
    }
  }

  // ---------- spoken instructions ----------
  let voiceFiles = {};
  let phoneVoices = null;
  async function loadVoices() {
    voiceFiles = await fetch('/api/vr/voice').then((r) => r.json());
    renderVoices();
  }
  function renderVoices() {
    const tbody = $('#voiceTable');
    tbody.innerHTML = '';
    for (const c of CONDS) {
      const tr = el('tr');
      tr.append(el('td', '', COND_NAMES[c]));
      for (const lang of LANGS) {
        const td = el('td', 'voice-cell');
        const url = voiceFiles[c] && voiceFiles[c][lang];
        const noTts = phoneVoices && !phoneVoices[lang];
        td.append(el('span', 'src' + (url ? ' mine' : ''), url ? 'My MP3' : noTts ? 'Phone voice – NOT available' : 'Phone voice (placeholder)'));
        td.append(el('p', '', I18n.t(`vr.${c}.say`, null, lang)));
        if (url) td.append(button('▶ Play here', () => playUrl(url)));
        td.append(button('▶ On phone', () => hostSocket && hostSocket.emit('vr:say', { condition: c, lang })));
        td.append(
          fileButton('⬆ Upload MP3', async (file) => {
            const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
            voiceFiles = await Staff.api(`/api/vr/voice/${c}/${lang}?ext=${encodeURIComponent(ext)}`, { method: 'PUT', body: file });
            renderVoices();
          }),
        );
        if (url)
          td.append(
            button(
              '↺ Use phone voice',
              async () => {
                voiceFiles = await Staff.api(`/api/vr/voice/${c}/${lang}`, { method: 'DELETE' });
                renderVoices();
              },
              'mini danger',
            ),
          );
        tr.append(td);
      }
      tbody.append(tr);
    }
    if (phoneVoices) {
      const list = LANGS.map((l) => `${LANG_NAMES[l]} ${phoneVoices[l] ? '✓' : '✗'}`).join(' · ');
      $('#voiceInfo').textContent = `Phone text-to-speech voices: ${list}. Where a voice is missing (✗), the phone stays silent – upload an MP3 for that language.`;
    }
  }

  // ---------- digit audio ----------
  function renderDigitAudio(info) {
    lastDigitInfo = info;
    const st = info.status;
    const wrap = $('#digitLangs');
    wrap.innerHTML = '';
    const warnings = [];
    for (const lang of LANGS) {
      const s = st[lang];
      const block = el('div', 'lang-block');
      const h = el('h3', '', LANG_NAMES[lang]);
      block.append(h);
      const inUse =
        s.source === 'recorded'
          ? 'In use: My recordings (10/10)'
          : s.source === 'generated'
            ? `In use: Generated digits (my recordings ${s.recordedCount}/10${s.recordedCount ? ' – used when all 10 are recorded' : ''})`
            : 'In use: NONE – the hearing test cannot run in this language';
      block.append(el('p', 'in-use', inUse));
      if (!s.source) warnings.push(`${LANG_NAMES[lang]}: no complete digit set (recorded ${s.recordedCount}/10, generated ${s.generatedCount}/10).`);
      else if (s.recordedCount > 0 && s.recordedCount < 10)
        warnings.push(`${LANG_NAMES[lang]}: only ${s.recordedCount}/10 digits recorded – the generated set is used until all 10 are recorded.`);

      const table = el('table', 'digit-table');
      table.innerHTML = '<thead><tr><th>Digit</th><th>Source</th><th></th></tr></thead>';
      const tbody = el('tbody');
      for (let d = 0; d <= 9; d++) {
        const tr = el('tr');
        tr.append(el('td', '', String(d)));
        const rec = s.recorded[d];
        const gen = s.generated[d];
        const tag = rec ? ['rec', 'My recording'] : gen ? ['gen', 'Generated'] : ['none', 'Missing'];
        tr.append(el('td', 'src-tag ' + tag[0], tag[1]));
        const acts = el('td');
        if (rec || gen) acts.append(button('▶ Play', () => playUrl(rec || gen)));
        const a = el('a', 'mini', '🎙 Replace with recording');
        a.href = `/ear/record?lang=${lang}&digit=${d}`;
        acts.append(a);
        acts.append(fileButton('⬆ Upload MP3', (file) => uploadDigit(lang, d, file)));
        tr.append(acts);
        tbody.append(tr);
      }
      table.append(tbody);
      block.append(table);
      if (s.recordedCount) {
        block.append(
          button(
            '↺ Reset to generated (delete my recordings)',
            async () => {
              if (!confirm(`Delete your ${s.recordedCount} recording(s) for ${LANG_NAMES[lang]} and use the generated digits?`)) return;
              const r = await Staff.api(`/api/ear/digits/${lang}`, { method: 'DELETE' });
              renderDigitAudio({ status: r.status, espeak: lastDigitInfo.espeak });
            },
            'mini danger',
          ),
        );
      }
      wrap.append(block);
    }
    if (info.espeak === false && Object.values(st).some((s) => s.generatedCount < 10)) {
      warnings.unshift('espeak-ng is not installed on this laptop, so the generated digits cannot be made. See README → "Digit audio".');
    }
    $('#digitWarning').innerHTML = '';
    warnings.forEach((w) => $('#digitWarning').append(el('div', '', '⚠ ' + w)));
    $('#digitWarning').classList.toggle('hidden', !warnings.length);
  }

  // Uploaded MP3: trimmed and normalised in the browser exactly like a recording, then saved as WAV.
  let audioCtx = null;
  async function uploadDigit(lang, d, file) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const buf = await audioCtx.decodeAudioData(await file.arrayBuffer());
      const n = buf.length;
      const mono = new Float32Array(n);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < n; i++) mono[i] += data[i] / buf.numberOfChannels;
      }
      let mean = 0;
      for (let i = 0; i < n; i++) mean += mono[i];
      mean /= n || 1;
      for (let i = 0; i < n; i++) mono[i] -= mean;
      const processed = DSP.normalise(DSP.trimSilence(mono, buf.sampleRate), buf.sampleRate);
      const r = await Staff.api(`/api/ear/digits/${lang}/${d}?ext=wav`, {
        method: 'PUT',
        headers: { 'content-type': 'audio/wav' },
        body: DSP.encodeWav(processed, buf.sampleRate),
      });
      renderDigitAudio({ status: r.status, espeak: lastDigitInfo.espeak });
    } catch (e) {
      alert('Could not use this file: ' + e.message);
    }
  }

  // ---------- status ----------
  function ago(t) {
    if (!t) return '';
    const s = Math.round((Date.now() - t) / 1000);
    return s < 5 ? '' : ` (${s}s ago)`;
  }
  function renderStatus(s) {
    const tab = s.tablet || {};
    const vr = s.vr || {};
    $('#tabDot').className = 'dot' + (tab.connected ? ' on' : '');
    $('#tabConn').textContent = tab.connected ? `Yes (${tab.connected})` : 'No';
    $('#tabScreen').textContent = (tab.screen || '–') + ago(tab.at);
    $('#tabLang').textContent = LANG_NAMES[tab.lang] || '–';
    const disp = s.display || {};
    $('#dispDot').className = 'dot' + (disp.connected ? ' on' : '');
    $('#dispStatus').textContent = disp.connected ? 'Monitor page is open ✓' : 'Monitor page is not open';

    $('#vrDot').className = 'dot' + (vr.connected ? (vr.ready ? ' on' : ' warn') : '');
    $('#vrConn').textContent = vr.connected ? `Yes (${vr.connected})` : 'No';
    $('#vrReady').textContent = vr.ready ? 'Yes' : 'No – tap "Tap to start VR" on the phone';
    const camText = { ok: 'OK' + (vr.camRes ? ` (${vr.camRes})` : ''), error: 'Not working – retrying every 4 s', denied: 'Permission refused – allow the camera in Chrome' };
    $('#vrCam').textContent = camText[vr.camera] || '–';
    $('#vrSensors').textContent = vr.sensors ? 'OK' : 'No data';
    $('#vrFull').textContent = vr.fullscreen === undefined ? '–' : vr.fullscreen ? 'Yes' : 'No';
    renderMotion(vr);
    if (vr.voices && JSON.stringify(vr.voices) !== JSON.stringify(phoneVoices)) {
      phoneVoices = vr.voices;
      if (I18n.data['vr.bppv.say']) renderVoices();
    }
    $('#vrState').textContent = vr.state || '–';
    $('#vrCond').textContent = COND_NAMES[vr.condition] || '–';
    $('#vrTilt').textContent = vr.tilt !== undefined ? (vr.tilt > 0 ? '+' : '') + vr.tilt + '°' : '–';
    $('#vrFps').textContent = vr.fps || '–';
  }

  // ---------- QR codes ----------
  function qrBox(title, url, svg, size) {
    const box = document.createElement('div');
    box.className = 'qr ' + size;
    box.innerHTML = `<b></b><div class="code">${svg}</div><a target="_blank"></a>`;
    box.querySelector('b').textContent = title;
    const a = box.querySelector('a');
    a.href = url;
    a.textContent = url;
    return box;
  }
  function renderLinks(data) {
    const main = $('#qrMain');
    main.innerHTML = '';
    const [best, ...others] = data.addresses;
    if (!best) {
      main.textContent = 'This laptop is not connected to a network. Connect it to the Wi-Fi, then restart the server.';
      return;
    }
    main.append(
      qrBox('Tablet', best.urls.tablet, best.qr.tablet, 'big'),
      qrBox('VR phone', best.urls.vr, best.qr.vr, 'big'),
      qrBox('Record digits', best.urls.record, best.qr.record, 'small'),
    );
    $('#qrOtherWrap').classList.toggle('hidden', !others.length);
    const other = $('#qrOther');
    other.innerHTML = '';
    for (const a of others) {
      const title = document.createElement('p');
      title.className = 'adapter';
      title.textContent = `${a.ip} – ${a.adapter}${a.likely ? '' : ' (probably a virtual adapter)'}`;
      const row = document.createElement('div');
      row.className = 'qr-row';
      row.append(qrBox('Tablet', a.urls.tablet, a.qr.tablet, 'small'), qrBox('VR phone', a.urls.vr, a.qr.vr, 'small'));
      other.append(title, row);
    }
  }

  // ---------- results ----------
  function renderResults(r) {
    const c = r.counts;
    $('#cTotal').textContent = c.total;
    $('#cToday').textContent = c.today;
    $('#cGood').textContent = c.byBand.good;
    $('#cBorder').textContent = c.byBand.borderline;
    $('#cRefer').textContent = c.byBand.refer;
    $('#cLang').textContent = `${c.byLang.en} / ${c.byLang.ta} / ${c.byLang.si}`;
    const tbody = $('#recent');
    tbody.innerHTML = '';
    for (const item of r.recent) {
      const tr = document.createElement('tr');
      const cells = [new Date(item.time).toLocaleString(), LANG_NAMES[item.lang] || item.lang, item.srt.toFixed(1), item.band];
      cells.forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = v;
        if (i === 3) td.className = 'band-' + item.band;
        tr.appendChild(td);
      });
      const td = document.createElement('td');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!item.calib;
      box.title = 'Normal listener (used for calibration, not counted as a visitor)';
      box.addEventListener('change', async () => {
        try {
          renderResults(await Staff.api('/api/host/results/' + item.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ calib: box.checked }) }));
        } catch (e) {
          alert('Could not save: ' + e.message);
        }
      });
      td.appendChild(box);
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    lastResults = r;
    renderCalibration();
  }

  // ---------- calibrate with normal listeners ----------
  let lastResults = null;
  let currentBands = null; // settings.bands (from the public settings)
  function renderCalibration() {
    if (!lastResults || !currentBands) return;
    const wrap = $('#calibLangs');
    wrap.innerHTML = '';
    for (const lang of LANGS) {
      const c = lastResults.calibration[lang];
      const box = el('div', 'calib-lang');
      box.append(el('h3', '', LANG_NAMES[lang]));
      if (!c.n) {
        box.append(el('p', 'small-note', 'No normal-listener results yet.'));
      } else {
        box.append(el('p', '', `${c.n} normal listener${c.n > 1 ? 's' : ''} · average ${c.mean.toFixed(1)} dB · SD ${c.sd.toFixed(1)} dB · range ${c.min} to ${c.max} dB`));
        const vals = el('div', 'vals');
        c.values.forEach((v) => vals.append(el('span', '', v.toFixed(1))));
        box.append(vals);
      }
      const own = currentBands.perLang && currentBands.perLang[lang];
      const now = own || { good: currentBands.good, refer: currentBands.refer };
      box.append(el('p', 'current', `Now used: GOOD ≤ ${now.good} dB, REFER > ${now.refer} dB (${own ? 'own bands for ' + LANG_NAMES[lang] : 'common bands'})`));
      if (c.suggested) {
        box.append(el('p', 'suggest', `Suggested: GOOD ≤ ${c.suggested.good} dB, REFER > ${c.suggested.refer} dB`));
        if (c.n < 10) box.append(el('p', 'small-note', `Only ${c.n} people – 10 or more give a more reliable suggestion.`));
        box.append(
          button('✓ Use for ' + LANG_NAMES[lang], () => applyBands({ perLang: { [lang]: c.suggested } }), 'mini'),
          button('✓ Use for all languages', () => applyBands({ good: c.suggested.good, refer: c.suggested.refer, perLang: { en: null, ta: null, si: null } }), 'mini'),
        );
      } else if (c.n) {
        box.append(el('p', 'small-note', `At least 5 normal listeners are needed for a suggestion (${c.n} so far).`));
      }
      if (own) box.append(button('↺ Use common bands', () => applyBands({ perLang: { [lang]: null } }), 'mini danger'));
      wrap.append(box);
    }
  }
  async function applyBands(patch) {
    try {
      const saved = await Staff.api('/api/host/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bands: patch }) });
      fillForm(saved);
      flashSaved();
    } catch (e) {
      alert('Could not save: ' + e.message);
    }
  }



  // ---------- settings form (field names like "vr.durations.bppv") ----------
  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach((k) => (o = o[k] = o[k] || {}));
    o[keys[keys.length - 1]] = value;
  }
  function fillForm(s) {
    for (const el of $('#settingsForm').elements) {
      if (!el.name) continue;
      const v = getPath(s, el.name);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    }
  }
  async function saveSettings() {
    const patch = {};
    for (const el of $('#settingsForm').elements) {
      if (!el.name) continue;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number') v = Number(v);
      setPath(patch, el.name, v);
    }
    try {
      const saved = await Staff.api('/api/host/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (saved.pin !== Staff.pin) {
        sessionStorage.setItem('earPin', saved.pin);
        $('#csvLink').href = '/api/host/results.csv?pin=' + encodeURIComponent(saved.pin);
      }
      fillForm(saved); // shows values after safety limits were applied
      flashSaved();
    } catch (e) {
      alert('Could not save: ' + e.message);
    }
  }
  function flashSaved() {
    $('#savedMsg').classList.add('show');
    setTimeout(() => $('#savedMsg').classList.remove('show'), 1800);
  }
})();
