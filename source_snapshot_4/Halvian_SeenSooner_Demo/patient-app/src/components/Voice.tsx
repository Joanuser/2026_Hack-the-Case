import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { Shield } from '../ui/icons';

type Rec = {
  lang: string; interimResults: boolean; continuous: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const SPEECH_LANG: Record<string, string> = { en: 'en-US', es: 'es-US', zh: 'zh-TW', vi: 'vi-VN', ar: 'ar-SA', fr: 'fr-FR', ko: 'ko-KR' };

function getRecognizer(): (new () => Rec) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * Microphone button for free-text symptom fields. Speech is turned into text and
 * appended to the field; the patient can edit it before continuing. The first use
 * shows a HIPAA privacy note.
 */
export function VoiceInput({ value, onChange, fieldId }: { value: string; onChange: (v: string) => void; fieldId: string }) {
  const { t, lang } = useApp();
  const [listening, setListening] = useState(false);
  const [used, setUsed] = useState(false);
  const [err, setErr] = useState(false);
  const rec = useRef<Rec | null>(null);
  const base = useRef('');
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => () => rec.current?.abort(), []);

  const start = () => {
    setUsed(true);
    setErr(false);
    const R = getRecognizer();
    if (!R) { setErr(true); return; }
    const r = new R();
    r.lang = SPEECH_LANG[lang] || 'en-US';
    r.interimResults = true;
    r.continuous = true;
    base.current = valueRef.current.trim();
    r.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onChange([base.current, text.trim()].filter(Boolean).join(' '));
    };
    r.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') setErr(true); };
    r.onend = () => setListening(false);
    rec.current = r;
    try { r.start(); setListening(true); } catch { setErr(true); }
  };
  const stop = () => { rec.current?.stop(); setListening(false); document.getElementById(fieldId)?.focus(); };

  return (
    <div className="voice">
      <button type="button" className={`voice-btn ${listening ? 'on' : ''}`} onClick={listening ? stop : start} aria-pressed={listening} aria-controls={fieldId} data-testid={`voice-${fieldId}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        <span>{listening ? t.voiceStop : t.voiceStart}</span>
      </button>
      {listening && <span className="voice-live" role="status"><span className="dot" />{t.voiceListening}</span>}
      {err && <p className="hint" role="alert">{t.voiceUnavailable}</p>}
      {used && (
        <div className="hipaa" role="note">
          <Shield size={16} />
          <div><p className="hipaa-t">{t.voiceHipaaTitle}</p><p>{t.voiceHipaa}</p></div>
        </div>
      )}
    </div>
  );
}
