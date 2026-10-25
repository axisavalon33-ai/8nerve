// Only inside the tablet's own hearing-test file (no laptop): keeps the results on the tablet
// and adds a hidden staff panel – hold the top-right corner of the start screen for 3 s, then the PIN.
(function () {
  const S = window.EAR_STANDALONE;
  if (!S) return;
  const LANGS = ['en', 'ta', 'si'];
  const LANG_NAMES = { en: 'English', ta: 'Tamil', si: 'Sinhala' };
  const KEY = { results: 'ear.results.v1', calib: 'ear.calibMode', bands: 'ear.bandsPerLang' };

  // ---------- storage on the tablet (falls back to memory, with a warning, if the browser blocks it) ----------
  const memory = {};
  let storageOk = true;
  try {
    localStorage.setItem('ear.check', '1');
    storageOk = localStorage.getItem('ear.check') === '1';
  } catch {
    storageOk = false;
  }
  function load(key, fallback) {
    try {
      const raw = storageOk ? localStorage.getItem(key) : memory[key];
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function store(key, value) {
    const raw = JSON.stringify(value);
    memory[key] = raw;
    if (!storageOk) return;
    try {
      localStorage.setItem(key, raw);
    } catch {
      storageOk = false;
    }
  }

  // Bands calibrated on this tablet replace the ones from the laptop (per language).
  const fileBands = JSON.parse(JSON.stringify(S.config.bands));
  function applyBands() {
    const own = load(KEY.bands, {});
    S.config.bands.perLang = { ...(fileBands.perLang || {}) };
    for (const l of LANGS) if (own[l]) S.config.bands.perLang[l] = own[l];
  }
  applyBands();

  function newId() {
    return 'tab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  // Called by the visitor app at the end of a test. Anonymous: time, language, SRT and band only.
  function saveResult({ lang, srt, band }) {
    const entry = { id: newId(), time: new Date().toISOString(), lang, srt: Math.round(srt * 10) / 10, band };
    if (load(KEY.calib, false)) entry.calib = true;
    const all = load(KEY.results, []);
    all.push(entry);
    store(KEY.results, all);
    return { calib: !!entry.calib };
  }

  // ---------- hidden opener ----------
  const css = document.createElement('style');
  css.textContent = `
    #staffHot{position:fixed;top:0;right:0;width:110px;height:110px;z-index:900;-webkit-tap-highlight-color:transparent}
    #staffWarn{position:fixed;left:12px;bottom:12px;z-index:900;padding:8px 14px;border-radius:12px;background:#b42318;color:#fff;font-size:15px}
    #staffPin,#staffPanel{position:fixed;inset:0;z-index:2000;background:rgba(10,20,40,.6);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px}
    #staffPin[hidden],#staffPanel[hidden],#staffWarn[hidden]{display:none}
    .sp-card{background:#fff;color:#12233d;border-radius:20px;padding:24px 28px;width:100%;max-width:980px;font-size:18px;margin:auto}
    .sp-card h2{margin:0 0 12px;font-size:26px;color:#1f5fa8}.sp-card h3{margin:22px 0 8px;font-size:21px}
    .sp-card button{font:inherit;font-size:17px;padding:10px 18px;border-radius:12px;border:none;background:#1f5fa8;color:#fff;margin:4px 6px 4px 0;cursor:pointer}
    .sp-card button.ghost{background:#e6edf7;color:#12233d}.sp-card button.danger{background:#b42318}
    .sp-card button:disabled{opacity:.45}
    .sp-card table{width:100%;border-collapse:collapse;font-size:16px}.sp-card td,.sp-card th{padding:6px 8px;border-bottom:1px solid #e6edf7;text-align:left}
    .sp-card .warn{background:#fff4e5;border:1px solid #f5b25b;border-radius:12px;padding:10px 14px;margin:10px 0}
    .sp-card .bad{background:#fde8e7;border:1px solid #e5847c;border-radius:12px;padding:10px 14px;margin:10px 0}
    .sp-counts{display:flex;flex-wrap:wrap;gap:10px}.sp-counts div{background:#f1f5fb;border-radius:12px;padding:8px 14px}.sp-counts b{display:block;font-size:24px}
    .sp-note{color:#4a5b75;font-size:15px}
    #staffPin input{font-size:28px;padding:10px 14px;width:220px;border-radius:12px;border:2px solid #c8d4e6;letter-spacing:.2em}
    .sp-cal{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.sp-cal>div{background:#f1f5fb;border-radius:14px;padding:12px 14px}`;
  document.head.appendChild(css);

  const html = (s) => {
    const t = document.createElement('template');
    t.innerHTML = s.trim();
    return t.content.firstElementChild;
  };
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const hot = html('<div id="staffHot" aria-hidden="true"></div>');
  const warn = html('<div id="staffWarn" hidden>Results are NOT being saved on this tablet – staff: see the staff panel</div>');
  const pinBox = html(`<div id="staffPin" hidden><form class="sp-card" style="max-width:420px">
      <h2>Staff panel</h2><p>Enter the PIN</p>
      <input type="password" inputmode="numeric" autocomplete="off" id="spPin" />
      <p class="sp-note" id="spPinErr"></p>
      <button type="submit">Open</button><button type="button" class="ghost" id="spPinCancel">Cancel</button></form></div>`);
  const panel = html('<div id="staffPanel" hidden><div class="sp-card" id="spBody"></div></div>');
  document.body.append(hot, warn, pinBox, panel);
  warn.hidden = storageOk;

  const onHome = () => !window.__ear || window.__ear.state.screen === 'home';
  // Only on the start screen, so it never covers the buttons of the other screens.
  setInterval(() => (hot.style.display = onHome() ? '' : 'none'), 300);
  let holdTimer = null;
  hot.addEventListener('pointerdown', () => {
    if (!onHome()) return;
    holdTimer = setTimeout(openPin, 3000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => hot.addEventListener(ev, () => clearTimeout(holdTimer)));
  hot.addEventListener('contextmenu', (e) => e.preventDefault());

  function openPin() {
    pinBox.hidden = false;
    pinBox.querySelector('#spPinErr').textContent = '';
    const input = pinBox.querySelector('#spPin');
    input.value = '';
    input.focus();
  }
  pinBox.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (pinBox.querySelector('#spPin').value !== String(S.pin)) {
      pinBox.querySelector('#spPinErr').textContent = 'Wrong PIN';
      return;
    }
    pinBox.hidden = true;
    openPanel();
  });
  pinBox.querySelector('#spPinCancel').addEventListener('click', () => (pinBox.hidden = true));

  // ---------- panel ----------
  function openPanel() {
    panel.hidden = false;
    render();
  }
  function closePanel() {
    panel.hidden = true;
  }

  function csvText(all) {
    const rows = ['time,lang,srt_db,band,normal_listener,id'];
    for (const r of all) rows.push([r.time, r.lang, r.srt, r.band, r.calib ? 'yes' : '', r.id].join(','));
    return rows.join('\n') + '\n';
  }
  function downloadCsv() {
    const blob = new Blob([csvText(load(KEY.results, []))], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hearing_results_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
  }

  function render() {
    const all = load(KEY.results, []);
    const visitors = all.filter((r) => !r.calib);
    const today = new Date().toISOString().slice(0, 10);
    const count = (band) => visitors.filter((r) => r.band === band).length;
    const calibMode = !!load(KEY.calib, false);
    const own = load(KEY.bands, {});
    const made = new Date(S.builtAt);
    const missing = LANGS.filter((l) => !S.digitSource || S.digitSource[l] === 'none' || Object.keys(S.manifest[l] || {}).length < 10);

    const calibCards = LANGS.map((l) => {
      const st = DIN.stats(all.filter((r) => r.calib && r.lang === l).map((r) => r.srt));
      const sug = DIN.suggestBands(st);
      const cur = DIN.bandsFor(S.config.bands, l);
      return `<div><b>${LANG_NAMES[l]}</b><br>
        Normal listeners: ${st.n}${st.n ? ` · mean ${st.mean} dB · SD ${st.sd}` : ''}<br>
        Now: GOOD ≤ ${cur.good} dB, REFER &gt; ${cur.refer} dB ${own[l] ? '(set on this tablet)' : '(from the laptop)'}<br>
        ${sug ? `Suggested: GOOD ≤ ${sug.good}, REFER &gt; ${sug.refer}<br><button data-use="${l}">Use for ${LANG_NAMES[l]}</button>` : `<span class="sp-note">Needs at least 5 normal listeners for a suggestion.</span>`}
      </div>`;
    }).join('');

    const rows = all
      .slice(-40)
      .reverse()
      .map(
        (r) => `<tr><td>${esc(new Date(r.time).toLocaleString())}</td><td>${esc(r.lang.toUpperCase())}</td><td>${esc(r.srt)} dB</td><td>${esc(r.band)}</td>
        <td><label><input type="checkbox" data-calib="${esc(r.id)}" ${r.calib ? 'checked' : ''}/> normal listener</label></td></tr>`,
      )
      .join('');

    const body = panel.querySelector('#spBody');
    body.innerHTML = `
      <h2>Staff panel – hearing test on this tablet</h2>
      <p class="sp-note">File made on ${esc(made.toLocaleString())}. Digit voices: ${LANGS.map((l) => `${LANG_NAMES[l]} – ${esc((S.digitSource && S.digitSource[l]) || 'none')}`).join(' · ')}</p>
      ${missing.length ? `<p class="bad">No digit recordings for: ${missing.map((l) => LANG_NAMES[l]).join(', ')}. Visitors choosing that language see "please ask a helper". Make the digits on the laptop, then download a new file.</p>` : ''}
      ${storageOk ? '' : '<p class="bad"><b>This browser does not let the file keep results.</b> Results are lost when the page closes. Open the file in Chrome (see the README), or download the CSV after every few visitors.</p>'}

      <h3>Results (anonymous, kept on this tablet)</h3>
      <div class="sp-counts">
        <div><b>${visitors.length}</b>Visitors</div>
        <div><b>${visitors.filter((r) => String(r.time).startsWith(today)).length}</b>Today</div>
        <div><b>${count('good')}</b>Good</div><div><b>${count('borderline')}</b>Borderline</div><div><b>${count('refer')}</b>Refer</div>
        <div><b>${all.length - visitors.length}</b>Normal listeners</div>
      </div>
      <p>
        <button id="spCsv" ${all.length ? '' : 'disabled'}>⬇ Download results (CSV)</button>
        <button id="spClear" class="danger" ${all.length ? '' : 'disabled'}>Delete all results…</button>
      </p>
      <p class="sp-note">The CSV opens in Excel. To add it to the laptop: host page → Hearing results → "Import results from a tablet".</p>
      ${rows ? `<table><thead><tr><th>Time</th><th>Lang</th><th>SRT</th><th>Result</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="sp-note">No results yet.</p>'}

      <h3>Calibrate with normal listeners</h3>
      <label><input type="checkbox" id="spCalibMode" ${calibMode ? 'checked' : ''}/> <b>Calibration mode</b> – every new test is saved as a normal listener (the result screen also shows the dB value)</label>
      ${calibMode ? '<p class="warn">⚠ Calibration mode is ON – switch it OFF before visitors arrive.</p>' : ''}
      <div class="sp-cal">${calibCards}</div>
      <p><button id="spBandsReset" class="ghost" ${Object.keys(own).length ? '' : 'disabled'}>Use the laptop's bands again</button></p>

      <p style="margin-top:24px"><button id="spClose">Close the staff panel</button></p>`;

    body.querySelector('#spClose').onclick = closePanel;
    body.querySelector('#spCsv').onclick = downloadCsv;
    body.querySelector('#spClear').onclick = () => {
      if (!confirm('Delete ALL results on this tablet? Download the CSV first if you need them.')) return;
      store(KEY.results, []);
      render();
    };
    body.querySelector('#spCalibMode').onchange = (e) => {
      store(KEY.calib, e.target.checked);
      render();
    };
    body.querySelectorAll('[data-calib]').forEach(
      (cb) =>
        (cb.onchange = () => {
          const list = load(KEY.results, []);
          const r = list.find((x) => x.id === cb.dataset.calib);
          if (r) {
            if (cb.checked) r.calib = true;
            else delete r.calib;
            store(KEY.results, list);
          }
          render();
        }),
    );
    body.querySelectorAll('[data-use]').forEach(
      (b) =>
        (b.onclick = () => {
          const l = b.dataset.use;
          const sug = DIN.suggestBands(DIN.stats(load(KEY.results, []).filter((r) => r.calib && r.lang === l).map((r) => r.srt)));
          if (!sug) return;
          store(KEY.bands, { ...load(KEY.bands, {}), [l]: sug });
          applyBands();
          render();
        }),
    );
    body.querySelector('#spBandsReset').onclick = () => {
      store(KEY.bands, {});
      applyBands();
      render();
    };
  }

  window.TabletStaff = { saveResult, openPanel, storageOk: () => storageOk };
})();
