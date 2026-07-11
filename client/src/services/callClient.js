// Thin WebRTC wrapper for the staff (answer) side of a call.
// Public STUN only, no TURN — assumes caller and callee are on the same
// hotel network. Cross-network answering is a known limitation.
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

let pc = null;
let localStream = null;
let remoteAudioEl = null;

function getRemoteAudioEl() {
  if (!remoteAudioEl) {
    remoteAudioEl = document.createElement('audio');
    remoteAudioEl.autoplay = true;
    document.body.appendChild(remoteAudioEl);
  }
  return remoteAudioEl;
}

async function createAnswer(offerSdp, { onIceCandidate, onConnectionStateChange }) {
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

  await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  return { type: answer.type, sdp: answer.sdp };
}

async function addIceCandidate(candidate) {
  if (!pc) return;
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
  if (remoteAudioEl) {
    remoteAudioEl.srcObject = null;
    remoteAudioEl.remove();
    remoteAudioEl = null;
  }
}

export default { createAnswer, addIceCandidate, setMuted, close };
