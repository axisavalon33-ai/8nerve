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
    socket.on('digits', renderDigits);
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
    fetch('/api/ear/digits').then((r) => r.json()).then(renderDigits);
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

    $('#vrDot').className = 'dot' + (vr.connected ? (vr.ready ? ' on' : ' warn') : '');
    $('#vrConn').textContent = vr.connected ? `Yes (${vr.connected})` : 'No';
    $('#vrReady').textContent = vr.ready ? 'Yes' : 'No – tap "Tap to start VR" on the phone';
    const camText = { ok: 'OK' + (vr.camRes ? ` (${vr.camRes})` : ''), error: 'Not working – retrying every 4 s', denied: 'Permission refused – allow the camera in Chrome' };
    $('#vrCam').textContent = camText[vr.camera] || '–';
    $('#vrSensors').textContent = vr.sensors ? 'OK' : 'No data';
    $('#vrState').textContent = vr.state || '–';
    $('#vrCond').textContent = COND_NAMES[vr.condition] || '–';
    $('#vrTilt').textContent = vr.tilt !== undefined ? (vr.tilt > 0 ? '+' : '') + vr.tilt + '°' : '–';
    $('#vrFps').textContent = vr.fps || '–';
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
      tbody.appendChild(tr);
    }
  }

  function renderDigits(m) {
    const tbody = $('#digitTable');
    tbody.innerHTML = '';
    for (const lang of ['en', 'ta', 'si']) {
      const have = Object.keys(m[lang] || {}).map(Number).sort();
      const missing = [...Array(10).keys()].filter((d) => !have.includes(d));
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${LANG_NAMES[lang]}</td><td></td>`;
      tr.lastChild.textContent = missing.length ? `${have.length}/10 – missing: ${missing.join(', ')}` : '10/10 ✓';
      tr.lastChild.className = missing.length ? 'band-refer' : 'band-good';
      tbody.appendChild(tr);
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
