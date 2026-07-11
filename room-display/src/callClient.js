// Thin WebRTC wrapper for the room's outgoing (offer) side of a call.
// Public STUN only, no TURN — assumes caller and callee are on the same
// hotel network. Cross-network answering is a known limitation.
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

let pc = null;
let localStream = null;
let remoteAudioEl = null;
let remoteDescSet = false;
let pendingCandidates = [];

function getRemoteAudioEl() {
  if (!remoteAudioEl) {
    remoteAudioEl = document.createElement('audio');
    remoteAudioEl.autoplay = true;
    document.body.appendChild(remoteAudioEl);
  }
  return remoteAudioEl;
}

async function createOffer({ onIceCandidate, onConnectionStateChange }) {
  remoteDescSet = false;
  pendingCandidates = [];
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) onIceCandidate?.(e.candidate.toJSON());
  };
  pc.onconnectionstatechange = () => onConnectionStateChange?.(pc.connectionState);
  pc.ontrack = (e) => {
    getRemoteAudioEl().srcObject = e.streams[0];
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  return { type: offer.type, sdp: offer.sdp };
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

export default { createOffer, handleAnswer, addIceCandidate, setMuted, close };
