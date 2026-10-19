// Recording helper (/ear/record): record digits 0–9 with the tablet microphone, trim, normalise, save as WAV.
(function () {
  const $ = (s) => document.querySelector(s);
  const MAX_REC_MS = 3000;

  let lang = null;
  let stream = null;
  let ctx = null;
  let manifest = {};
  const cards = {}; // digit -> { el, processed: Float32Array|null }

  Staff.login(() => $('#main').classList.remove('hidden'));

  document.querySelectorAll('[data-lang]').forEach((b) =>
    b.addEventListener('click', async () => {
      document.querySelectorAll('[data-lang]').forEach((x) => x.classList.toggle('selected', x === b));
      lang = b.dataset.lang;
      if (!(await ensureMic())) return;
      manifest = await fetch('/api/ear/digits').then((r) => r.json());
      buildCards();
      $('#recArea').classList.remove('hidden');
    }),
  );

  async function ensureMic() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();
    if (stream) return true;
    try {
      // Turn off phone-call style processing so the recording is natural.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      $('#micErr').textContent = '';
      return true;
    } catch (e) {
      $('#micErr').textContent = 'Microphone not available: ' + e.message + ' (the page must be opened with https://)';
      return false;
    }
  }

  function buildCards() {
    const wrap = $('#digits');
    wrap.innerHTML = '';
    for (let d = 0; d <= 9; d++) {
      const el = document.createElement('div');
      el.className = 'digit';
      el.innerHTML = `
        <div class="num">${d}</div>
        <canvas width="300" height="46"></canvas>
        <div class="acts">
          <button class="btn small rec" type="button">● Record</button>
          <button class="btn ghost small play" type="button">▶ Play</button>
          <button class="btn violet small save" type="button" disabled>Save</button>
        </div>
        <div class="state"></div>`;
      wrap.appendChild(el);
      cards[d] = { el, processed: null };
      el.querySelector('.rec').addEventListener('click', () => toggleRecord(d));
      el.querySelector('.play').addEventListener('click', () => play(d));
      el.querySelector('.save').addEventListener('click', () => save(d));
      refreshCard(d);
    }
  }

  function refreshCard(d) {
    const c = cards[d];
    const has = !!(manifest[lang] && manifest[lang][d]);
    c.el.classList.toggle('has-file', has);
    c.el.querySelector('.state').textContent = c.processed ? 'New recording – not saved yet' : has ? 'Saved' : 'Not recorded yet';
    c.el.querySelector('.save').disabled = !c.processed;
    c.el.querySelector('.play').disabled = !c.processed && !has;
  }

  // ---------- record ----------
  let recorder = null;
  let recDigit = null;
  let stopTimer = null;

  function toggleRecord(d) {
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      return;
    }
    const chunks = [];
    recDigit = d;
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      clearTimeout(stopTimer);
      const c = cards[d];
      c.el.classList.remove('recording');
      c.el.querySelector('.rec').textContent = '● Record';
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
        c.processed = process(decoded);
        c.sampleRate = decoded.sampleRate;
        drawWave(c.el.querySelector('canvas'), c.processed);
        refreshCard(d);
        play(d);
      } catch (e) {
        c.el.querySelector('.state').textContent = 'Could not process the recording: ' + e.message;
      }
      recorder = null;
    };
    recorder.start();
    cards[d].el.classList.add('recording');
    cards[d].el.querySelector('.rec').textContent = '■ Stop';
    cards[d].el.querySelector('.state').textContent = 'Speak now…';
    stopTimer = setTimeout(() => recorder && recorder.state === 'recording' && recorder.stop(), MAX_REC_MS);
  }

  // Mono -> cut silence -> even loudness.
  function process(buf) {
    const n = buf.length;
    const mono = new Float32Array(n);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) mono[i] += data[i] / buf.numberOfChannels;
    }
    // Remove any DC offset from the microphone.
    let mean = 0;
    for (let i = 0; i < n; i++) mean += mono[i];
    mean /= n || 1;
    for (let i = 0; i < n; i++) mono[i] -= mean;
    const trimmed = DSP.trimSilence(mono, buf.sampleRate);
    return DSP.normalise(trimmed, buf.sampleRate);
  }

  function drawWave(canvas, x) {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#7c3aed';
    const step = Math.max(1, Math.floor(x.length / canvas.width));
    for (let px = 0; px < canvas.width; px++) {
      let m = 0;
      for (let i = px * step; i < Math.min(x.length, (px + 1) * step); i++) m = Math.max(m, Math.abs(x[i]));
      const h = Math.max(1, m * canvas.height);
      g.fillRect(px, (canvas.height - h) / 2, 1, h);
    }
  }

  // ---------- play ----------
  async function play(d) {
    const c = cards[d];
    let buffer;
    if (c.processed) {
      buffer = ctx.createBuffer(1, c.processed.length, c.sampleRate);
      buffer.copyToChannel(c.processed, 0);
    } else if (manifest[lang] && manifest[lang][d]) {
      const res = await fetch(manifest[lang][d]);
      buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      drawWave(c.el.querySelector('canvas'), buffer.getChannelData(0));
    } else return;
    return playBuffer(buffer);
  }
  function playBuffer(buffer) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    return new Promise((r) => (src.onended = r));
  }

  $('#playAll').addEventListener('click', async () => {
    await ctx.resume();
    for (let d = 0; d <= 9; d++) {
      if (!manifest[lang] || !manifest[lang][d]) continue;
      cards[d].el.classList.add('recording');
      const buf = await ctx.decodeAudioData(await (await fetch(manifest[lang][d])).arrayBuffer());
      await playBuffer(buf);
      cards[d].el.classList.remove('recording');
      await new Promise((r) => setTimeout(r, 400));
    }
  });

  // ---------- save ----------
  async function save(d) {
    const c = cards[d];
    if (!c.processed) return;
    const wav = DSP.encodeWav(c.processed, c.sampleRate);
    try {
      const res = await Staff.api(`/api/ear/digits/${lang}/${d}?ext=wav`, {
        method: 'PUT',
        headers: { 'content-type': 'audio/wav' },
        body: wav,
      });
      manifest = res.manifest;
      c.processed = null;
      refreshCard(d);
    } catch (e) {
      c.el.querySelector('.state').textContent = 'Save failed: ' + e.message;
    }
  }

  window.__rec = { cards, get lang() { return lang; } }; // for automated tests
})();
