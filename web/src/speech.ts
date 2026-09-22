// Pronunciation. Order: real dictionary audio -> the device's speech synthesis (free, offline,
// accent + speed control) -> whatever URL the server suggested.
import { getConfig } from './api';

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function voicesFor(prefix: string): SpeechSynthesisVoice[] {
  if (!speechAvailable()) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(prefix));
}

export function speak(text: string, language: string, rate?: number): boolean {
  if (!speechAvailable() || !text) return false;
  const cfg = getConfig();
  // When the device lists its voices and none of them speaks this language (Japanese on many desktops),
  // say so instead of "speaking" silently, so the caller can fall back to an audio URL.
  const voices = window.speechSynthesis.getVoices();
  const prefix = language === 'ja' ? 'ja' : 'en';
  if (voices.length && !voices.some((v) => v.lang.toLowerCase().startsWith(prefix))) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = language === 'ja' ? 'ja-JP' : cfg.accent;
  u.rate = rate ?? cfg.speechRate;
  const wanted = language === 'ja' ? '' : cfg.voiceEn;
  const voice = wanted ? voices.find((v) => v.voiceURI === wanted) : undefined;
  if (voice) u.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  return true;
}

function playUrl(url: string, onFail: () => void, rate?: number) {
  try {
    const a = new Audio(url);
    a.playbackRate = rate ?? getConfig().speechRate;
    a.addEventListener('error', onFail, { once: true });
    a.play().catch(onFail);
  } catch { onFail(); }
}

// A word: `audioUrl` may be a dictionary recording or the unofficial Google TTS fallback.
// `rate` overrides the speed from Settings (the Listen exercise has a "Slower" button).
export function pronounce(text: string, language: string, audioUrl?: string | null, rate?: number) {
  const isRecording = !!audioUrl && !audioUrl.includes('translate_tts');
  if (isRecording) { playUrl(audioUrl!, () => { speak(text, language, rate); }, rate); return; }
  if (speak(text, language, rate)) return;
  if (audioUrl) playUrl(audioUrl, () => {}, rate);
}

export const pronounceSentence = (sentence: string, language: string) => { speak(sentence, language); };
