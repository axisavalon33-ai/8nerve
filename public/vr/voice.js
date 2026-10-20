// Spoken instruction at the start of a condition: my uploaded MP3 if there is one,
// otherwise the phone's own text-to-speech reads the text from translations.json (placeholder).

const SPEECH_LANG = { en: 'en-GB', ta: 'ta-IN', si: 'si-LK' };
let current = null;

function voiceFor(lang) {
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(lang)) || null;
}

// Which languages the phone can speak, e.g. { en: true, ta: true, si: false }
export function availableVoices() {
  const out = {};
  for (const l of Object.keys(SPEECH_LANG)) out[l] = !!voiceFor(l);
  return out;
}
if ('speechSynthesis' in window) speechSynthesis.getVoices(); // starts loading the voice list

export function stopVoice() {
  if (current) {
    current.pause();
    current = null;
  }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// text: the instruction in the visitor's language; url: uploaded file or null
export function sayInstruction(text, lang, url) {
  stopVoice();
  if (url) {
    current = new Audio(url);
    current.volume = 1;
    current.play().catch(() => speak(text, lang));
    return 'file';
  }
  return speak(text, lang) ? 'tts' : 'none';
}

function speak(text, lang) {
  const voice = voiceFor(lang);
  // No voice for this language on the phone: stay silent rather than read it with a wrong-language voice.
  if (!voice || !text) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.9;
  speechSynthesis.speak(u);
  return true;
}
