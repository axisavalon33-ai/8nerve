// Placeholder digit recordings made on this laptop with the offline text-to-speech engine espeak-ng.
// They are trimmed and loudness-normalised with exactly the same code as the recording helper.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const DSP = require('../public/ear/js/dsp.js');

const WORDS = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
  ta: ['பூஜ்ஜியம்', 'ஒன்று', 'இரண்டு', 'மூன்று', 'நான்கு', 'ஐந்து', 'ஆறு', 'ஏழு', 'எட்டு', 'ஒன்பது'],
  si: ['බිංදුව', 'එක', 'දෙක', 'තුන', 'හතර', 'පහ', 'හය', 'හත', 'අට', 'නවය'],
};
const VOICES = { en: 'en-gb', ta: 'ta', si: 'si' };

// Where espeak-ng may be installed (PATH first). ESPEAK_PATH=... overrides.
function espeakCandidates() {
  const list = [];
  if (process.env.ESPEAK_PATH) list.push(process.env.ESPEAK_PATH);
  list.push('espeak-ng');
  if (process.platform === 'win32') {
    list.push('C:\\Program Files\\eSpeak NG\\espeak-ng.exe', 'C:\\Program Files (x86)\\eSpeak NG\\espeak-ng.exe');
  } else {
    list.push('/usr/bin/espeak-ng', '/usr/local/bin/espeak-ng', '/opt/homebrew/bin/espeak-ng');
  }
  return list;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 20000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

let cachedEspeak;
async function findEspeak() {
  if (cachedEspeak !== undefined) return cachedEspeak;
  for (const c of espeakCandidates()) {
    try {
      await run(c, ['--version']);
      return (cachedEspeak = c);
    } catch {
      /* try the next one */
    }
  }
  return (cachedEspeak = null);
}

// Minimal WAV reader (16-bit PCM, as written by espeak-ng) -> { data: Float32Array mono, sampleRate }
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file');
  let pos = 12;
  let fmt = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data' && fmt) {
      // espeak-ng writing to a file may leave the size as 0x7fffffff: use what is really there.
      size = Math.min(size, buf.length - body);
      if (fmt.bits !== 16) throw new Error('Only 16-bit WAV is supported');
      const frames = Math.floor(size / 2 / fmt.channels);
      const data = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let ch = 0; ch < fmt.channels; ch++) sum += buf.readInt16LE(body + (i * fmt.channels + ch) * 2) / 32768;
        data[i] = sum / fmt.channels;
      }
      return { data, sampleRate: fmt.sampleRate };
    }
    pos = body + size + (size % 2);
  }
  throw new Error('WAV file has no audio data');
}

// Same processing as /ear/record: remove DC offset, trim silence, normalise loudness.
function processDigit(data, sampleRate) {
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length || 1;
  const x = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) x[i] = data[i] - mean;
  return DSP.normalise(DSP.trimSilence(x, sampleRate), sampleRate);
}

// Make media/ear/digits-generated/<lang>/0..9.wav. Existing files are kept unless force = true.
async function generateDigits(mediaDir, { langs = Object.keys(WORDS), force = false, log = () => {} } = {}) {
  const espeak = await findEspeak();
  if (!espeak) return { ok: false, error: 'espeak-ng is not installed', made: 0 };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ear-tts-'));
  let made = 0;
  const failed = [];
  try {
    for (const lang of langs) {
      const dir = path.join(mediaDir, 'ear', 'digits-generated', lang);
      fs.mkdirSync(dir, { recursive: true });
      for (let d = 0; d <= 9; d++) {
        const out = path.join(dir, `${d}.wav`);
        if (!force && fs.existsSync(out)) continue;
        const raw = path.join(tmp, `${lang}-${d}.wav`);
        try {
          await run(espeak, ['-v', VOICES[lang], '-s', '140', '-w', raw, WORDS[lang][d]]);
          const { data, sampleRate } = readWav(fs.readFileSync(raw));
          const processed = processDigit(data, sampleRate);
          fs.writeFileSync(out, Buffer.from(DSP.encodeWav(processed, sampleRate)));
          made++;
        } catch (err) {
          failed.push(`${lang}/${d}: ${err.message}`);
        }
      }
      log(`Generated digits for ${lang}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { ok: failed.length === 0, made, failed, espeak };
}

module.exports = { generateDigits, findEspeak, readWav, processDigit, WORDS };
