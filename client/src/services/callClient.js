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
  if (!fetchTurnServers) return STUN_SERVERS;
  try {
    const turnServers = await fetchTurnServers();
    return turnServers?.length ? [...STUN_SERVERS, ...turnServers] : STUN_SERVERS;
  } catch {
    return STUN_SERVERS;
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

function setupPeerConnection({ onIceCandidate, onConnectionStateChange, iceServers }) {
  pc = new RTCPeerConnection({ iceServers });
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
  const iceServers = await getIceServers();
  setupPeerConnection({ onIceCandidate, onConnectionStateChange, iceServers });
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  return { type: offer.type, sdp: offer.sdp };
}

async function createAnswer(offerSdp, { onIceCandidate, onConnectionStateChange }) {
  remoteDescSet = false;
  pendingCandidates = [];
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const iceServers = await getIceServers();
  setupPeerConnection({ onIceCandidate, onConnectionStateChange, iceServers });
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
  if (!pc) return;
  if (!remoteDescSet) { pendingCandidates.push(candidate); return; }
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
