// Thin WebRTC wrapper for either side of a call — offering (placing a call)
// or answering (receiving one). STUN alone only works when both sides can
// reach each other directly, which fails across a NAT/firewall boundary
// (e.g. a MikroTik between the property and staff off-site) — the app
// injects a TURN-credential fetcher via configure() to cover that case;
// without one, calling stays STUN-only same as before.
const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

let pc = null;
let localStream = null;
let remoteAudioEl = null;
let remoteDescSet = false;
let pendingCandidates = [];
let fetchTurnServers = null;

function configure({ fetchTurnServers: fn } = {}) {
  fetchTurnServers = fn || null;
}

async function getIceServers() {
  if (!fetchTurnServers) return { iceServers: STUN_SERVERS, iceTransportPolicy: 'all' };
  try {
    const turnServers = await fetchTurnServers();
    // Relay candidates are always the lowest ICE priority, so a mixed
    // host+srflx+relay candidate list means the one pair that can actually
    // work across a restrictive NAT sits behind a pile of guaranteed-to-fail
    // ones — coturn's own logs showed the answering side never even got as
    // far as attempting its relay candidate before the browser gave up.
    // Forcing relay-only when TURN is actually available removes every
    // other pair from consideration, so there's nothing to work through
    // first. Falls back to 'all' (STUN + host, same as before any of this)
    // if TURN isn't configured/reachable, so a TURN outage doesn't also
    // break same-network calling.
    return turnServers?.length
      ? { iceServers: [...STUN_SERVERS, ...turnServers], iceTransportPolicy: 'relay' }
      : { iceServers: STUN_SERVERS, iceTransportPolicy: 'all' };
  } catch {
    return { iceServers: STUN_SERVERS, iceTransportPolicy: 'all' };
  }
}

function getRemoteAudioEl() {
  if (!remoteAudioEl) {
    remoteAudioEl = document.createElement('audio');
    remoteAudioEl.autoplay = true;
    document.body.appendChild(remoteAudioEl);
  }
  return remoteAudioEl;
}

function setupPeerConnection({ onIceCandidate, onConnectionStateChange, iceServers, iceTransportPolicy }) {
  pc = new RTCPeerConnection({ iceServers, iceTransportPolicy });
  pc.onicecandidate = (e) => {
    if (e.candidate) onIceCandidate?.(e.candidate.toJSON());
  };
  pc.onconnectionstatechange = () => onConnectionStateChange?.(pc.connectionState);
  pc.ontrack = (e) => {
    getRemoteAudioEl().srcObject = e.streams[0];
  };
}

async function createOffer({ onIceCandidate, onConnectionStateChange }) {
  remoteDescSet = false;
  pendingCandidates = [];
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const { iceServers, iceTransportPolicy } = await getIceServers();
  setupPeerConnection({ onIceCandidate, onConnectionStateChange, iceServers, iceTransportPolicy });
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  return { type: offer.type, sdp: offer.sdp };
}

async function createAnswer(offerSdp, { onIceCandidate, onConnectionStateChange }) {
  remoteDescSet = false;
  pendingCandidates = [];
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const { iceServers, iceTransportPolicy } = await getIceServers();
  setupPeerConnection({ onIceCandidate, onConnectionStateChange, iceServers, iceTransportPolicy });
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
  remoteDescSet = true;
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  for (const candidate of pendingCandidates) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  }
  pendingCandidates = [];
  return { type: answer.type, sdp: answer.sdp };
}

async function handleAnswer(answerSdp) {
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
  remoteDescSet = true;
  for (const candidate of pendingCandidates) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  }
  pendingCandidates = [];
}

async function addIceCandidate(candidate) {
  // A candidate can arrive before pc even exists yet — the answering side
  // doesn't create it until after a human taps "Answer" plus an async
  // getUserMedia + TURN-credential fetch chain, while the caller starts
  // sending candidates immediately. Queue rather than drop in both cases;
  // createOffer/createAnswer flush this same queue once pc exists and the
  // remote description is set.
  if (!pc || !remoteDescSet) { pendingCandidates.push(candidate); return; }
  try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
}

function setMuted(muted) {
  localStream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
}

function close() {
  localStream?.getTracks().forEach(t => t.stop());
  pc?.close();
  pc = null;
  localStream = null;
  remoteDescSet = false;
  pendingCandidates = [];
  if (remoteAudioEl) {
    remoteAudioEl.srcObject = null;
    remoteAudioEl.remove();
    remoteAudioEl = null;
  }
}

export default { configure, createOffer, createAnswer, handleAnswer, addIceCandidate, setMuted, close };
