// Voice for the Ask page, using what the browser has built in — nothing is
// sent to the PMS server but the recognised text.
//   listen()  speech → text (Chrome, Android, Safari; not Firefox)
//   speak()   text → the device's own voice
// Both are optional: the page works with typing (or the phone keyboard's mic)
// when a browser has neither.

const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export const LANGS = { id: 'id-ID', en: 'en-US' };

export function canListen() { return !!Recognition; }
export function canSpeak() { return typeof window !== 'undefined' && 'speechSynthesis' in window; }

const ERRORS = {
  'not-allowed': 'Microphone blocked — allow it for this site in the browser settings, or use the mic on your keyboard.',
  'service-not-allowed': 'Voice input is not available here — use the mic on your keyboard.',
  'audio-capture': 'No microphone found.',
  network: 'Voice input needs an internet connection.',
};

// Starts listening for one sentence. onPartial(text) while the person talks,
// onFinal(text) once when they stop ('' when nothing was heard), onError(msg).
// Returns stop().
export function listen({ lang = LANGS.id, onPartial, onFinal, onError }) {
  if (!Recognition) { onError?.('Voice input is not available in this browser.'); return () => {}; }
  const rec = new Recognition();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let text = '', failed = false, done = false;
  rec.onresult = e => {
    text = Array.from(e.results).map(r => r[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
    onPartial?.(text);
  };
  rec.onerror = e => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;   // just ends with nothing heard
    failed = true;
    onError?.(ERRORS[e.error] || 'Voice input stopped — try again or type the question.');
  };
  rec.onend = () => {
    if (done) return;
    done = true;
    if (!failed) onFinal?.(text);
  };
  try { rec.start(); } catch { onError?.('Voice input could not start — try again.'); }
  return () => { try { rec.stop(); } catch { /* already stopped */ } };
}

// iPhone only lets a page speak after a tap: call this from the tap that turns
// spoken replies on (or starts the mic), so later replies may be read aloud.
export function primeSpeech() {
  if (!canSpeak()) return;
  try { window.speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch { /* not supported */ }
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}

// Indonesian text read by an English voice is unintelligible, so pick the
// voice from the text when the device has one for it.
function looksIndonesian(text) {
  return /\b(yang|dan|untuk|kamar|malam|tanggal|masih|ada|tidak|bisa|dari|sampai|tersedia|harga|tamu|besok|maaf)\b/i.test(text);
}

export function speak(text, onEnd) {
  if (!canSpeak() || !text) { onEnd?.(); return; }
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\bRp\.?\s?/g, 'Rupiah '));
  const lang = looksIndonesian(text) ? 'id' : 'en';
  u.lang = LANGS[lang];
  const voice = synth.getVoices().find(v => v.lang?.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  u.onend = u.onerror = () => onEnd?.();
  synth.speak(u);
}
