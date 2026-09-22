// The question types shared by Multiple choice, Context challenge, Write, Listen and Learn.
// Each one shows feedback itself and reports a single result when the learner continues.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getConfig } from '../api';
import { pronounce } from '../speech';
import { CardBack, SpeakButton } from '../components/CardView';
import { Icon } from '../components/Icon';
import type { CardContent } from '../types';
import { buildChoices, cardMeaning, closestAnswer, diffAnswer, isCorrect, maskWord, type AnswerKind, type DiffPart, type Distractor } from './answers';

export type ExerciseResult = 'correct' | 'wrong' | 'skip';
interface Common { card: CardContent; onDone: (result: ExerciseResult) => void }
const autoPlay = (card: CardContent) => { if (getConfig().autoPlay) pronounce(card.lemma, card.language, card.audio); };

// Enter continues once feedback is showing (inputs are disabled by then, so listen on the window).
function useContinueKey(active: boolean, go: () => void) {
  const latest = useRef(go);
  latest.current = go;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); latest.current(); } };
    const t = setTimeout(() => window.addEventListener('keydown', onKey), 150);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [active]);
}

function Shell({ label, children, footer }: { label: string; children: ReactNode; footer: ReactNode }) {
  return (
    <>
      <div className="flashcard static"><div className="card-face"><div className="hint">{label}</div>{children}</div></div>
      <div className="exercise-foot">{footer}</div>
    </>
  );
}

// ---------- multiple choice ----------
export type ChoiceKind = 'pickWord' | 'pickMeaning' | 'context';
const CHOICE_LABEL: Record<ChoiceKind, string> = { pickWord: 'Which word fits?', pickMeaning: 'What does it mean?', context: 'Which word completes the sentence?' };

export function ChoiceExercise({ card, pool, kind, onDone }: Common & { pool: Distractor[]; kind: ChoiceKind }) {
  const [picked, setPicked] = useState<string | null>(null);
  const right = kind === 'pickMeaning' ? cardMeaning(card) : card.lemma;
  const options = useMemo(() => buildChoices(card, pool, kind === 'pickMeaning' ? 'meaning' : 'word'), [card.cardId, kind]);
  const correct = picked === right;
  const pick = (o: string) => { if (picked === null) { setPicked(o); autoPlay(card); } };
  useEffect(() => {
    if (picked !== null) return;
    const onKey = (e: KeyboardEvent) => { const i = Number(e.key) - 1; if (i >= 0 && i < options.length && !e.metaKey && !e.ctrlKey) pick(options[i]); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useContinueKey(picked !== null, () => onDone(correct ? 'correct' : 'wrong'));
  const definition = card.back.definitionEn && card.back.definitionEn !== cardMeaning(card) ? maskWord(card.back.definitionEn, card) : '';
  return (
    <Shell label={CHOICE_LABEL[kind]} footer={picked !== null && <button className="btn primary block" onClick={() => onDone(correct ? 'correct' : 'wrong')}>{correct ? 'Correct — continue' : "Not quite — we'll come back to it"}</button>}>
      {kind === 'pickWord' && <><div className="quiz-q">{cardMeaning(card) || '(no meaning yet)'}</div>{definition && <div className="muted">{definition}</div>}{card.front.cloze && <p className="cloze small-cloze">{card.front.cloze}</p>}</>}
      {kind === 'pickMeaning' && <div className={`quiz-word${card.language === 'ja' ? ' ja' : ''}`}><span>{card.lemma}</span><SpeakButton label="Play pronunciation" onClick={() => pronounce(card.lemma, card.language, card.audio)} /></div>}
      {kind === 'context' && <p className="cloze">{card.front.cloze}</p>}
      <div className={`options${kind === 'pickMeaning' ? ' meanings' : ''}`} role="group" aria-label="Answers">
        {options.map((o, i) => (
          <button key={o} disabled={picked !== null} className={picked !== null ? (o === right ? 'correct' : o === picked ? 'wrong' : '') : ''} onClick={() => pick(o)}><kbd>{i + 1}</kbd><span>{o}</span></button>
        ))}
      </div>
      {picked !== null && <div className="reveal"><CardBack card={card} compact /></div>}
    </Shell>
  );
}

// ---------- typed answers (Write, Context challenge by typing, Listen) ----------
const Diff = ({ parts, tone }: { parts: DiffPart[]; tone: 'miss' | 'fix' }) => <span className="diff">{parts.map((p, i) => (p.ok ? <span key={i}>{p.text}</span> : <em key={i} className={tone}>{p.text}</em>))}</span>;

function useTypedAnswer(card: CardContent, kind: AnswerKind, onDone: (r: ExerciseResult) => void) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<'correct' | 'wrong' | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const check = (giveUp = false) => {
    if (result) return;
    setGaveUp(giveUp);
    setResult(!giveUp && isCorrect(card, value, kind) ? 'correct' : 'wrong');
    autoPlay(card);
  };
  useContinueKey(!!result, () => onDone(result === 'correct' ? 'correct' : 'wrong'));
  return { value, setValue, result, gaveUp, check, override: () => setResult('correct') };
}

function TypedFeedback({ card, kind, value, result, gaveUp, onOverride }: { card: CardContent; kind: AnswerKind; value: string; result: 'correct' | 'wrong'; gaveUp: boolean; onOverride: () => void }) {
  if (result === 'correct') return <div className="type-result correct" role="status"><Icon name="check" size={18} />Correct!</div>;
  const expected = closestAnswer(card, gaveUp ? '' : value, kind);
  const diff = diffAnswer(gaveUp ? '' : value, expected);
  return (
    <div className="type-result wrong" role="status">
      <div className="type-verdict">{gaveUp ? "No problem — here's the answer" : 'Not quite'}</div>
      <dl className="answer-compare">
        {!gaveUp && <><dt>Your answer</dt><dd><Diff parts={diff.given} tone="miss" /></dd></>}
        <dt>Correct answer</dt><dd>{gaveUp ? expected : <Diff parts={diff.expected} tone="fix" />}</dd>
      </dl>
      {!gaveUp && <button type="button" className="link-btn override" onClick={onOverride}>I was right</button>}
    </div>
  );
}

function TypedFooter({ result, canCheck, onCheck, onGiveUp, onContinue, extra }: { result: 'correct' | 'wrong' | null; canCheck: boolean; onCheck: () => void; onGiveUp: () => void; onContinue: () => void; extra?: ReactNode }) {
  if (result) return <button className="btn primary block" onClick={onContinue}>Continue</button>;
  return <><div className="row"><button className="btn primary grow" onClick={onCheck} disabled={!canCheck}>Check</button><button className="btn" onClick={onGiveUp}>I don't know</button></div>{extra}</>;
}

export function WriteExercise({ card, onDone, variant = 'write' }: Common & { variant?: 'write' | 'context' }) {
  // filling a gap has one right answer (the form the sentence used); writing from the meaning accepts any form
  const t = useTypedAnswer(card, variant, onDone);
  const [hint, setHint] = useState(false);
  const meaning = cardMeaning(card);
  const definition = card.back.definitionEn && card.back.definitionEn !== meaning ? maskWord(card.back.definitionEn, card) : '';
  const finish = () => onDone(t.result === 'correct' ? 'correct' : 'wrong');
  return (
    <Shell label={variant === 'context' ? 'Type the missing word' : 'Write the word'} footer={<TypedFooter result={t.result} canCheck={!!t.value.trim()} onCheck={() => t.check()} onGiveUp={() => t.check(true)} onContinue={finish} />}>
      {variant === 'context' ? (
        <>
          <p className="cloze">{card.front.cloze}</p>
          {meaning && (hint || t.result ? <div className="muted">{meaning}</div> : <button type="button" className="link-btn hint-btn" onClick={() => setHint(true)}>Show a hint</button>)}
        </>
      ) : (
        <>
          <div className="quiz-q">{meaning || 'Complete the sentence'}</div>
          {definition && <div className="muted">{definition}</div>}
          {card.front.cloze && <p className="cloze small-cloze">{card.front.cloze}</p>}
        </>
      )}
      <input className={`input type-input ${t.result || ''}`} value={t.value} onChange={(e) => t.setValue(e.target.value)} disabled={!!t.result} autoFocus autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false}
        lang={card.language} aria-label="Your answer" placeholder={card.language === 'ja' ? 'Word or reading' : 'Type your answer'} onKeyDown={(e) => { if (e.key === 'Enter' && !t.result && t.value.trim()) { e.stopPropagation(); t.check(); } }} />
      {t.result && <TypedFeedback card={card} kind={variant} value={t.value} result={t.result} gaveUp={t.gaveUp} onOverride={t.override} />}
      {t.result && <div className="reveal"><CardBack card={card} compact /></div>}
    </Shell>
  );
}

export function ListenExercise({ card, onDone }: Common) {
  const t = useTypedAnswer(card, 'listen', onDone);
  const play = (rate?: number) => pronounce(card.lemma, card.language, card.audio, rate);
  useEffect(() => { const timer = setTimeout(() => play(), 250); return () => { clearTimeout(timer); window.speechSynthesis?.cancel(); }; }, [card.cardId]);
  const finish = () => onDone(t.result === 'correct' ? 'correct' : 'wrong');
  return (
    <Shell label="Listen" footer={<TypedFooter result={t.result} canCheck={!!t.value.trim()} onCheck={() => t.check()} onGiveUp={() => t.check(true)} onContinue={finish}
      extra={<button type="button" className="link-btn skip-listen" onClick={() => onDone('skip')}>I can't listen right now</button>} />}>
      <div className="listen-stage">
        <button type="button" className="listen-btn" onClick={() => play()} aria-label="Play the word"><Icon name="volume" size={34} /></button>
        <div className="row listen-actions"><button type="button" className="btn small" onClick={() => play()}><Icon name="play" size={14} />Play again</button><button type="button" className="btn small" onClick={() => play(0.6)}>Slower</button></div>
      </div>
      <label className="listen-label" htmlFor="listen-input">Type what you hear</label>
      <input id="listen-input" className={`input type-input ${t.result || ''}`} value={t.value} onChange={(e) => t.setValue(e.target.value)} disabled={!!t.result} autoFocus autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false}
        lang={card.language} placeholder={card.language === 'ja' ? 'Word or reading' : 'Type your answer'} onKeyDown={(e) => { if (e.key === 'Enter' && !t.result && t.value.trim()) { e.stopPropagation(); t.check(); } }} />
      {t.result && <TypedFeedback card={card} kind="listen" value={t.value} result={t.result} gaveUp={t.gaveUp} onOverride={t.override} />}
      {t.result && <div className="reveal"><CardBack card={card} compact /></div>}
    </Shell>
  );
}
