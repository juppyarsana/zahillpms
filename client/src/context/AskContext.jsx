import { createContext, useContext, useState, useRef, useCallback } from 'react';
import api from '../services/api';
import { speak, stopSpeaking, primeSpeech } from '../lib/speech';

// The Ask conversation, kept above the pages so it survives closing the panel
// and moving between pages (it is gone on Clear, log out or a reload).
// Used by the floating panel (components/AskFab.jsx) and the /ask page.
const AskContext = createContext(null);

// Remembered on this device only: whether replies are read aloud.
function pref(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function savePref(key, value) { try { localStorage.setItem(key, value); } catch { /* private window */ } }

export function AskProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState([]);       // { role, text, understood?, cards? }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [voiceOn, setVoiceOn] = useState(() => pref('askVoice', '0') === '1');
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const busyRef = useRef(false);
  const voiceRef = useRef(voiceOn);
  voiceRef.current = voiceOn;

  // → true when answered; false when it could not be sent (the caller keeps the text).
  const send = useCallback(async question => {
    const q = (question || '').trim();
    if (!q || busyRef.current) return false;
    stopSpeaking();
    setNotice('');
    const next = [...turnsRef.current, { role: 'user', text: q }];
    setTurns(next);
    busyRef.current = true; setBusy(true);
    try {
      const { data } = await api.post('/api/assistant/ask', { messages: next.map(t => ({ role: t.role, text: t.text })) });
      setTurns(t => [...t, { role: 'assistant', text: data.reply, understood: data.understood, cards: data.cards || [] }]);
      if (voiceRef.current) speak(data.reply);
      return true;
    } catch (e) {
      setTurns(t => t.slice(0, -1));
      setNotice(e.response?.data?.error || 'Could not reach the server — try again.');
      return false;
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }, []);

  const toggleVoice = useCallback(() => {
    const on = !voiceRef.current;
    setVoiceOn(on);
    savePref('askVoice', on ? '1' : '0');
    if (on) primeSpeech(); else stopSpeaking();
  }, []);

  const clear = useCallback(() => { stopSpeaking(); setTurns([]); setNotice(''); }, []);
  const close = useCallback(() => { stopSpeaking(); setOpen(false); }, []);

  return (
    <AskContext.Provider value={{ open, setOpen, close, turns, busy, notice, setNotice, voiceOn, toggleVoice, send, clear }}>
      {children}
    </AskContext.Provider>
  );
}

export function useAsk() { return useContext(AskContext); }
