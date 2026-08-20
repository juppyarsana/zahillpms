// Synthesized ringtone (Web Audio API) — no audio asset file needed.
// Plays a classic two-beep pattern, repeating every 2s, until stop() is called.
let audioCtx = null;
let intervalId = null;

function beep(ctx, startTime, freq) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
  gain.gain.linearRampToValueAtTime(0, startTime + 0.35);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + 0.4);
}

function ringOnce() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  beep(audioCtx, now, 880);
  beep(audioCtx, now + 0.45, 880);
}

function start() {
  if (intervalId) return; // already ringing
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  ringOnce();
  intervalId = setInterval(ringOnce, 2000);
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
