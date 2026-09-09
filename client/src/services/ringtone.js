// Synthesized call tones (Web Audio API) — no audio asset file needed.
//   start()/stop()          — incoming ring: classic two-beep, every 2s
//   startDial()/stopDial()  — outgoing ringback ("dialing" tone): a single
//                             lower tone, 1s on / 2s off, while the far end rings
// The two use fully separate module-level state (own AudioContext + interval)
// so an incoming ring and an outgoing ringback can never silence each other —
// same reasoning as keeping alarm.js independent of this file.
let audioCtx = null;
let intervalId = null;
let dialCtx = null;
let dialIntervalId = null;

function beep(ctx, startTime, freq, duration = 0.4, peak = 0.3) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + 0.02);
  gain.gain.linearRampToValueAtTime(0, startTime + duration - 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
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

function dialOnce() {
  if (!dialCtx) return;
  beep(dialCtx, dialCtx.currentTime, 440, 1.0, 0.2);
}

function startDial() {
  if (dialIntervalId) return; // already dialing
  dialCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (dialCtx.state === 'suspended') dialCtx.resume().catch(() => {});
  dialOnce();
  dialIntervalId = setInterval(dialOnce, 3000);
}

function stopDial() {
  if (dialIntervalId) {
    clearInterval(dialIntervalId);
    dialIntervalId = null;
  }
  if (dialCtx) {
    dialCtx.close().catch(() => {});
    dialCtx = null;
  }
}

export default { start, stop, startDial, stopDial };
