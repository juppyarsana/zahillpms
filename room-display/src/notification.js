// Synthesized one-shot notification chime (Web Audio API) — plays once when
// a front-desk message arrives. Deliberately NOT looping like ringtone.js
// (incoming call) or alarm.js (wake-up) — those need an active response and
// keep ringing until handled, but a message is already a must-dismiss
// full-screen overlay; a repeating sound on top of that would be excessive
// if the guest doesn't notice it right away.
function play() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const now = ctx.currentTime;
  [880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    const t = now + i * 0.14;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.28, t + 0.02);
    gain.gain.linearRampToValueAtTime(0, t + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
  setTimeout(() => ctx.close().catch(() => {}), 600);
}

export default { play };
