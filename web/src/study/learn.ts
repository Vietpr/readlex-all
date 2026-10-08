// Learn mode: a small, deterministic engine (no React). A session is cut into rounds of up to
// ROUND_SIZE words, and inside a round the whole group moves through three phases, in order:
//   meet (look at the card) -> choose (multiple choice) -> write (type it from memory)
// Every word in the round takes a phase before the next phase starts, so the learner always knows
// where they are. A miss puts the word back at the END of the current phase; nothing ever moves back.
import type { CardContent, Rating } from '../types';
import { cardMeaning, shuffle } from './answers';

export type Step = 'meet' | 'choose' | 'write';
export type StepResult = 'seen' | 'correct' | 'wrong' | 'skip';
export type ChooseKind = 'context' | 'meaning';
export const PHASES: Step[] = ['meet', 'choose', 'write'];
export const ROUND_SIZE = 6;

// `steps` are the phases this word takes part in; `pos` indexes the next one it still has to pass.
export interface LearnWord { card: CardContent; steps: Step[]; chooseKind: ChooseKind | null; pos: number; mistakes: number; tested: number; done: boolean }
export interface LearnState { words: LearnWord[]; rounds: number[][]; round: number; step: Step; queue: number[]; phase: 'question' | 'checkpoint' | 'finished'; asked: number; seed: number }
// canChoose: are there enough different wrong options to build a multiple-choice question of that kind?
export interface Caps { canChoose: (card: CardContent, what: 'word' | 'meaning') => boolean }

// Which phases a word goes through. New words start by meeting the card; Choose fills the saved
// sentence when there is one (and enough wrong options), otherwise asks the meaning; Write needs
// something to prompt with. A word with nothing to ask is at least shown.
export function stepsFor(card: CardContent, caps: Caps): { steps: Step[]; chooseKind: ChooseKind | null } {
  const meaning = !!cardMeaning(card), cloze = !!card.front.cloze;
  const chooseKind: ChooseKind | null = cloze && caps.canChoose(card, 'word') ? 'context' : meaning && caps.canChoose(card, 'meaning') ? 'meaning' : null;
  const steps: Step[] = [];
  if (card.schedule.state === 0) steps.push('meet');
  if (chooseKind) steps.push('choose');
  if (meaning || cloze) steps.push('write');
  if (!steps.length) steps.push('meet');
  return { steps, chooseKind };
}

function chunk(n: number): number[][] {
  const rounds = Math.max(1, Math.ceil(n / ROUND_SIZE));
  const size = Math.ceil(n / rounds);
  const out: number[][] = [];
  for (let i = 0; i < n; i += size) out.push(Array.from({ length: Math.min(size, n - i) }, (_, k) => i + k));
  return out;
}

// A tiny seeded generator (mulberry32), so the order inside a phase is fixed once and survives a refresh.
function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// The words of a round that still have `step` ahead of them. Meet keeps the saved order; the
// question phases are shuffled once.
function queueFor(s: Pick<LearnState, 'words' | 'rounds' | 'seed'>, round: number, step: Step): number[] {
  const due = (s.rounds[round] || []).filter((i) => { const w = s.words[i]; return !w.done && w.steps[w.pos] === step; });
  return step === 'meet' ? due : shuffle(due, rng(s.seed + round * 31 + PHASES.indexOf(step)));
}

// Enters `round` at its first phase with anything to do; rounds with nothing left are skipped.
function enter(s: LearnState, round: number): LearnState {
  for (let r = round; r < s.rounds.length; r++) {
    for (const step of PHASES) { const queue = queueFor(s, r, step); if (queue.length) return { ...s, round: r, step, queue, phase: 'question' }; }
  }
  return { ...s, round: Math.max(0, Math.min(round, s.rounds.length - 1)), queue: [], phase: 'finished' };
}

export function createLearn(cards: CardContent[], caps: Caps, seed = Date.now() % 2147483647): LearnState {
  const words = cards.map((card) => { const { steps, chooseKind } = stepsFor(card, caps); return { card, steps, chooseKind, pos: 0, mistakes: 0, tested: 0, done: false }; });
  const base: LearnState = { words, rounds: chunk(words.length), round: 0, step: 'meet', queue: [], phase: 'finished', asked: 0, seed };
  return words.length ? enter(base, 0) : base;
}

export const currentWord = (s: LearnState): LearnWord | null => (s.phase === 'question' && s.queue.length ? s.words[s.queue[0]] : null);
export const currentStep = (s: LearnState): Step | null => (currentWord(s) ? s.step : null);

export function answer(s: LearnState, result: StepResult): { state: LearnState; completed: LearnWord | null } {
  if (s.phase !== 'question' || !s.queue.length) return { state: s, completed: null };
  const index = s.queue[0];
  const w = { ...s.words[index] };
  const queue = s.queue.slice(1);
  if (result === 'wrong') {
    // the exercise has shown the answer; the word simply comes round again after the others
    w.mistakes += 1; w.tested += 1;
    queue.push(index);
  } else {
    if (result === 'correct') w.tested += 1;
    w.pos += 1;
    w.done = w.pos >= w.steps.length;
  }
  let next: LearnState = { ...s, words: s.words.map((x, i) => (i === index ? w : x)), queue, asked: s.asked + 1 };
  if (!queue.length) {
    // the phase is over for everyone: on to the next phase of this round, else the checkpoint
    const later = PHASES.slice(PHASES.indexOf(s.step) + 1).map((step) => ({ step, queue: queueFor(next, s.round, step) })).find((x) => x.queue.length);
    next = later ? { ...next, step: later.step, queue: later.queue } : { ...next, phase: s.round + 1 < s.rounds.length ? 'checkpoint' : 'finished' };
  }
  return { state: next, completed: w.done ? w : null };
}

export function nextRound(s: LearnState): LearnState {
  if (s.phase !== 'checkpoint') return s;
  return enter(s, s.round + 1);
}

// Phase-slots passed over phase-slots in the whole session. A miss leaves the slot open, so this
// can stand still but never moves backwards.
export function progress(s: LearnState): number {
  let total = 0, got = 0;
  for (const w of s.words) { total += w.steps.length; got += Math.min(w.pos, w.steps.length); }
  return total ? got / total : 1;
}

// How far the current round is through its current phase: words that have passed it / words taking it.
export function phaseCount(s: LearnState): { done: number; total: number } {
  let total = 0, done = 0;
  for (const i of s.rounds[s.round] || []) {
    const w = s.words[i], at = w.steps.indexOf(s.step);
    if (at < 0) continue;
    total += 1;
    if (w.pos > at) done += 1;
  }
  return { done, total };
}

// One FSRS rating per word per session, from how the whole round went. A word that was only looked
// at (no question could be built for it) is not rated at all.
export function ratingFor(w: LearnWord): Rating | null {
  if (!w.done || w.tested === 0) return null;
  return w.mistakes === 0 ? 3 : w.mistakes === 1 ? 2 : 1;
}
