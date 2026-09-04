// Synthesized wake-up alarm chime (Web Audio API) — kept independent of
// ringtone.js (calls) so an alarm and an incoming call can never share
// state and silence each other.
let audioCtx = null;
let intervalId = null;

function chime(ctx, startTime) {
  [660, 880, 1100].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    const t = startTime + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.03);
    gain.gain.linearRampToValueAtTime(0, t + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  });
}

function ringOnce() {
  if (!audioCtx) return;
  chime(audioCtx, audioCtx.currentTime);
}

function start() {
  if (intervalId) return; // already ringing
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  ringOnce();
  intervalId = setInterval(ringOnce, 1800);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
}

export default { start, stop };
