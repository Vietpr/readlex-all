// Learn mode: a small, deterministic engine (no React). Every word climbs a ladder of exercises from
// recognition to recall; a right answer moves it up, a wrong one moves it down and brings it back soon.
//   study (look at the card) -> choice (pick the meaning) -> context (pick the word for the gap)
//   -> write (type it from the meaning) -> listen (type what you hear; long-term words only)
import type { CardContent, Rating } from '../types';
import { cardMeaning } from './answers';

export type Step = 'study' | 'choice' | 'context' | 'write' | 'listen';
export type StepResult = 'seen' | 'correct' | 'wrong' | 'skip';
export const ROUND_SIZE = 6;

export interface LearnWord { card: CardContent; ladder: Step[]; start: number; pos: number; best: number; mistakes: number; tested: number; done: boolean }
export interface LearnState { words: LearnWord[]; rounds: number[][]; round: number; queue: number[]; phase: 'question' | 'checkpoint' | 'finished'; asked: number }
// canChoose: are there enough different wrong options to build a multiple-choice question of that kind?
export interface Caps { canChoose: (card: CardContent, what: 'word' | 'meaning') => boolean; listen: boolean }

export function ladderFor(card: CardContent, caps: Caps): { ladder: Step[]; start: number } {
  const meaning = !!cardMeaning(card), cloze = !!card.front.cloze;
  const ladder: Step[] = ['study'];
  if (meaning && caps.canChoose(card, 'meaning')) ladder.push('choice');
  if (cloze && caps.canChoose(card, 'word')) ladder.push('context');
  if (meaning || cloze) ladder.push('write');
  const state = card.schedule.state;
  if (state === 2 && caps.listen && ladder.length > 1) ladder.push('listen');
  // New words begin with the card itself; words already being learned go straight to a question;
  // long-term words skip recognition and start with their sentence.
  let start = 0;
  if (state === 1 || state === 3) start = Math.min(1, ladder.length - 1);
  if (state === 2) {
    const context = ladder.indexOf('context'), write = ladder.indexOf('write');
    start = context >= 0 ? context : write >= 0 ? write : Math.min(1, ladder.length - 1);
  }
  return { ladder, start };
}

function chunk(n: number): number[][] {
  const rounds = Math.max(1, Math.ceil(n / ROUND_SIZE));
  const size = Math.ceil(n / rounds);
  const out: number[][] = [];
  for (let i = 0; i < n; i += size) out.push(Array.from({ length: Math.min(size, n - i) }, (_, k) => i + k));
  return out;
}

export function createLearn(cards: CardContent[], caps: Caps): LearnState {
  const words = cards.map((card) => { const { ladder, start } = ladderFor(card, caps); return { card, ladder, start, pos: start, best: start, mistakes: 0, tested: 0, done: false }; });
  const rounds = chunk(words.length);
  return { words, rounds, round: 0, queue: [...(rounds[0] || [])], phase: words.length ? 'question' : 'finished', asked: 0 };
}

export const currentWord = (s: LearnState): LearnWord | null => (s.phase === 'question' && s.queue.length ? s.words[s.queue[0]] : null);
export const currentStep = (s: LearnState): Step | null => { const w = currentWord(s); return w ? w.ladder[w.pos] : null; };

export function answer(s: LearnState, result: StepResult): { state: LearnState; completed: LearnWord | null } {
  if (s.phase !== 'question' || !s.queue.length) return { state: s, completed: null };
  const index = s.queue[0];
  const w = { ...s.words[index] };
  const queue = s.queue.slice(1);
  if (result === 'wrong') { w.mistakes += 1; w.pos = Math.max(0, w.pos - 1); } else w.pos += 1;
  if (result === 'correct' || result === 'wrong') w.tested += 1;
  w.best = Math.max(w.best, w.pos);
  w.done = w.pos >= w.ladder.length;
  // a missed or just-studied word comes back after two other questions, a correct one after three
  if (!w.done) queue.splice(Math.min(result === 'correct' || result === 'skip' ? 3 : 2, queue.length), 0, index);
  const words = s.words.map((x, i) => (i === index ? w : x));
  const phase = queue.length ? 'question' : s.round + 1 < s.rounds.length ? 'checkpoint' : 'finished';
  return { state: { ...s, words, queue, phase, asked: s.asked + 1 }, completed: w.done ? w : null };
}

export function nextRound(s: LearnState): LearnState {
  if (s.phase !== 'checkpoint') return s;
  return { ...s, round: s.round + 1, queue: [...s.rounds[s.round + 1]], phase: 'question' };
}

// Never moves backwards: it counts the highest rung each word has reached.
export function progress(s: LearnState): number {
  let total = 0, got = 0;
  for (const w of s.words) { total += w.ladder.length - w.start; got += Math.min(w.best, w.ladder.length) - w.start; }
  return total ? got / total : 1;
}

// One FSRS rating per word per session, from how the whole climb went. A word that was only looked
// at (no question could be built for it) is not rated at all.
export function ratingFor(w: LearnWord): Rating | null {
  if (!w.done || w.tested === 0) return null;
  return w.mistakes === 0 ? 3 : w.mistakes === 1 ? 2 : 1;
}
