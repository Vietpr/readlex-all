// Unit tests for the web app's study logic (answer checking, diff, options, the Learn engine).
// The sources are TypeScript, so they are bundled with the esbuild that ships with Vite:
//   node scripts/test-study-logic.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'web', 'package.json'));
const esbuild = require('esbuild');
const outDir = path.join(ROOT, '.cache', 'study-logic');
fs.mkdirSync(outDir, { recursive: true });
const entry = path.join(outDir, 'entry.ts');
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(ROOT, 'web/src/study/answers.ts'))};\nexport * from ${JSON.stringify(path.join(ROOT, 'web/src/study/learn.ts'))};\n`);
const outfile = path.join(outDir, 'bundle.mjs');
esbuild.buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
const L = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); } };
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const card = (over = {}) => {
  const base = { cardId: 'c-' + (over.lemma || 'contemplate'), vocabularyId: 'v', language: 'en', lemma: 'contemplate', reading: '', surface: 'contemplated', ipa: '/ˈkɒntəmpleɪt/', audio: '', status: 'new', enrichmentStatus: 'done',
    front: { sentence: 'She had never contemplated leaving the company.', cloze: 'She had never ______ leaving the company.', answer: 'contemplated', pageTitle: 'The Economist', url: '', hint: '' },
    back: { meaning: 'cân nhắc, suy ngẫm kỹ', meaningVi: '', meaningInContext: '', sentenceVi: '', definitionEn: 'to contemplate something is to think carefully about it', partOfSpeech: 'verb', level: 'B2', collocations: [], example: '', exampleVi: '', synonyms: [], wordFamily: [], notes: '', learningPriority: 3, isProperNoun: false, quickDict: [] },
    exposureCount: 1, savedAt: 0, schedule: { state: 0, due: 0, reps: 0, lapses: 0, lastReview: null, scheduledDays: 0 } };
  return { ...base, ...over, front: { ...base.front, ...(over.front || {}) }, back: { ...base.back, ...(over.back || {}) }, schedule: { ...base.schedule, ...(over.schedule || {}) } };
};
const ja = card({ language: 'ja', lemma: '買う', reading: 'かう', surface: '買いました', front: { sentence: '私は本を買いました。', cloze: '私は本を______。', answer: '買いました' }, back: { meaning: 'mua', partOfSpeech: 'động từ' } });

// ---- normalisation and checking ----
eq('norm: case, spaces, punctuation', L.norm('  Shrug-Off!  '), 'shrug off');
eq('norm: full-width and katakana fold', L.norm('ＡＢＣ コーヒー'), 'abc こーひー');
check('write accepts the dictionary form', L.isCorrect(card(), 'Contemplate'));
check('write accepts the form used in the sentence', L.isCorrect(card(), 'contemplated '));
check('write rejects another inflection', !L.isCorrect(card(), 'contemplating'));
check('write rejects a near miss (no fuzzy matching)', !L.isCorrect(card(), 'contemplat'));
check('write rejects an unrelated word', !L.isCorrect(card(), 'consider'));
check('write rejects an empty answer', !L.isCorrect(card(), '   '));
check('phrasal verb: hyphen or space both fine', L.isCorrect(card({ lemma: 'shrug off', surface: 'shrugged off', front: { answer: 'shrugged off' } }), 'shrug-off'));
check('Japanese: kanji accepted', L.isCorrect(ja, '買う'));
check('Japanese: reading accepted', L.isCorrect(ja, 'かう'));
check('Japanese: katakana reading accepted', L.isCorrect(ja, 'カウ'));
check('Japanese: sentence form accepted when writing', L.isCorrect(ja, '買いました'));
// filling a gap: the sentence needs the form the sentence used, not just any form of the word
check('context: the form the sentence used is the only answer', L.isCorrect(card(), 'contemplated', 'context') && !L.isCorrect(card(), 'contemplate', 'context'));
check('context: still forgiving about case and spacing', L.isCorrect(card(), '  Contemplated ', 'context'));
check('context (ja): the inflected filler counts, its kana does not', L.isCorrect(ja, '買いました', 'context') && !L.isCorrect(ja, 'かう', 'context') && !L.isCorrect(ja, '買う', 'context'));
check('context (ja): when the gap IS the dictionary form, the kana counts', L.isCorrect(card({ language: 'ja', lemma: '維持', reading: 'いじ', surface: '維持', front: { answer: '維持', cloze: '経済成長を______する。' } }), 'いじ', 'context'));
eq('context: the correction shown is the gap form', L.closestAnswer(card(), 'contemplate', 'context'), 'contemplated');
check('a word with no sentence falls back to its surface form', L.isCorrect(card({ front: { answer: '', sentence: '', cloze: null } }), 'contemplated', 'context'));
check('listen: only what was spoken counts', L.isCorrect(card(), 'contemplate', 'listen') && !L.isCorrect(card(), 'contemplated', 'listen'));
check('listen (ja): word or reading', L.isCorrect(ja, 'かう', 'listen') && L.isCorrect(ja, '買う', 'listen') && !L.isCorrect(ja, '買いました', 'listen'));

// ---- diff ----
const d = L.diffAnswer('contemplait', 'contemplate');
eq('diff marks the wrong letters in the given answer', d.given.filter((p) => !p.ok).map((p) => p.text), ['i']);
eq('diff marks the missing letters in the expected answer', d.expected.filter((p) => !p.ok).map((p) => p.text), ['e']);
eq('diff keeps the text intact', [d.given.map((p) => p.text).join(''), d.expected.map((p) => p.text).join('')], ['contemplait', 'contemplate']);
eq('diff ignores case', L.diffAnswer('Curb', 'curb').given, [{ text: 'Curb', ok: true }]);
eq('closest accepted form is shown', L.closestAnswer(card(), 'contemplatd'), 'contemplated');
eq('closest falls back to the dictionary form', L.closestAnswer(card(), ''), 'contemplate');
eq('closest (ja): a kana attempt is compared with the reading', L.closestAnswer(ja, 'かお'), 'かう');
eq('closest (ja): a kanji attempt is not "corrected" to kana', L.closestAnswer(ja, '買る'), '買う');

// ---- masking / splitting ----
eq('definition does not leak the word', L.maskWord('to contemplate something is to think carefully about it', card()), 'to _____ something is to think carefully about it');
eq('sentence split around the saved form', L.splitAround('She had never contemplated leaving.', 'contemplated'), ['She had never ', 'contemplated', ' leaving.']);
eq('split returns null when the word is absent', L.splitAround('Nothing here', 'curb'), null);

// ---- choices ----
const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };
const pool = [card(), card({ lemma: 'curb', back: { meaning: 'kiềm chế', partOfSpeech: 'verb' } }), card({ lemma: 'resilient', back: { meaning: 'kiên cường', partOfSpeech: 'adjective' } }), card({ lemma: 'amid', back: { meaning: 'giữa lúc', partOfSpeech: 'preposition' } }),
  card({ lemma: 'sustain', back: { meaning: 'duy trì', partOfSpeech: 'verb' } }), card({ lemma: 'Curb', back: { meaning: 'kiềm chế', partOfSpeech: 'verb' } }), ja].map(L.toDistractor);
const words = L.buildChoices(card(), pool, 'word', seq([0.3, 0.7, 0.1, 0.9, 0.5]));
check('word choices: four options with the answer', words.length === 4 && words.includes('contemplate'), JSON.stringify(words));
check('word choices: no duplicates, same language only', new Set(words.map((w) => w.toLowerCase())).size === 4 && !words.includes('買う'), JSON.stringify(words));
check('word choices prefer the same part of speech', words.includes('curb') || words.includes('Curb'), JSON.stringify(words));
check('word choices prefer the same part of speech (2)', words.includes('sustain'), JSON.stringify(words));
const meanings = L.buildChoices(card(), pool, 'meaning', seq([0.2, 0.8, 0.4]));
check('meaning choices contain the right meaning once', meanings.filter((m) => m === 'cân nhắc, suy ngẫm kỹ').length === 1 && new Set(meanings).size === meanings.length, JSON.stringify(meanings));
eq('no choices without a meaning', L.buildChoices(card({ back: { meaning: '', definitionEn: '' } }), pool, 'meaning'), []);
eq('a lonely word gets only itself', L.buildChoices(ja, pool, 'word'), ['買う']);
eq('distinct lemmas per language', [L.distinctLemmas(pool, 'en'), L.distinctLemmas(pool, 'ja')], [5, 1]);
const match = L.pickMatchCards([card(), card({ lemma: 'curb', back: { meaning: 'kiềm chế' } }), card({ lemma: 'restrain', back: { meaning: 'Kiềm chế' } }), card({ lemma: 'blank', back: { meaning: '', definitionEn: '' } }), card({ lemma: 'amid', back: { meaning: 'giữa lúc' } })], 6, seq([0.5]));
check('match board: no empty or repeated meanings', match.length === 3 && !match.some((c) => c.lemma === 'blank') && match.filter((c) => /kiềm chế/i.test(c.back.meaning)).length === 1, JSON.stringify(match.map((c) => c.lemma)));
check('match board is capped', L.pickMatchCards(Array.from({ length: 20 }, (_, i) => card({ lemma: 'w' + i, back: { meaning: 'm' + i } })), 6).length === 6);

// ---- Learn engine: rounds of up to 6 words, each round in three phases (meet -> choose -> write) ----
const caps = { canChoose: () => true };
eq('new word: meet, choose (the sentence), write', L.stepsFor(card(), caps), { steps: ['meet', 'choose', 'write'], chooseKind: 'context' });
eq('learning word skips meet', L.stepsFor(card({ schedule: { state: 1 } }), caps).steps, ['choose', 'write']);
eq('long-term word skips meet too', L.stepsFor(card({ schedule: { state: 2 } }), caps).steps, ['choose', 'write']);
eq('relearning word skips meet', L.stepsFor(card({ schedule: { state: 3 } }), caps).steps, ['choose', 'write']);
eq('no sentence: choose asks the meaning instead', L.stepsFor(card({ front: { cloze: null } }), caps), { steps: ['meet', 'choose', 'write'], chooseKind: 'meaning' });
eq('no distractors: no choose phase', L.stepsFor(card(), { canChoose: () => false }), { steps: ['meet', 'write'], chooseKind: null });
eq('identical meanings in the pool but distinct words: the sentence question still works', L.stepsFor(card(), { canChoose: (_c, what) => what === 'word' }).chooseKind, 'context');
eq('distinct meanings but no other word: fall back to the meaning question', L.stepsFor(card(), { canChoose: (_c, what) => what === 'meaning' }).chooseKind, 'meaning');
eq('a sentence but no meaning: no meaning question possible, write still asks', L.stepsFor(card({ back: { meaning: '', definitionEn: '' } }), { canChoose: (_c, what) => what === 'meaning' }).steps, ['meet', 'write']);
eq('nothing to ask: meet only', L.stepsFor(card({ front: { cloze: null }, back: { meaning: '', definitionEn: '' } }), caps).steps, ['meet']);
eq('nothing to ask on a learning word: still shown once rather than skipped silently', L.stepsFor(card({ front: { cloze: null }, back: { meaning: '', definitionEn: '' }, schedule: { state: 1 } }), caps).steps, ['meet']);

// plays a script of results; records the step and word asked before each answer
const run = (state, script) => { const done = [], trail = []; let s = state; for (const r of script) { trail.push(`${L.currentStep(s)}:${L.currentWord(s)?.card.lemma}`); const out = L.answer(s, r); s = out.state; if (out.completed) done.push(out.completed); } return { s, done, trail }; };
const three = [card({ lemma: 'alpha', cardId: 'a' }), card({ lemma: 'beta', cardId: 'b' }), card({ lemma: 'gamma', cardId: 'c' })];
const s3 = L.createLearn(three, caps, 7);
eq('a round starts with meet, in saved order', [L.currentStep(s3), s3.queue], ['meet', [0, 1, 2]]);
const clean3 = run(s3, ['seen', 'seen', 'seen', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct']);
eq('phase order: every word meets, then every word chooses, then every word writes', clean3.trail.map((t) => t.split(':')[0]), ['meet', 'meet', 'meet', 'choose', 'choose', 'choose', 'write', 'write', 'write']);
check('each phase covers each word exactly once on a clean run', ['choose', 'write'].every((p) => new Set(clean3.trail.filter((t) => t.startsWith(p)).map((t) => t.split(':')[1])).size === 3) && clean3.s.phase === 'finished' && clean3.done.length === 3 && clean3.s.asked === 9, clean3.trail.join(' '));
check('the question phases are shuffled, the same way for the same seed', JSON.stringify(L.createLearn(three, caps, 7).queue) === JSON.stringify(s3.queue) && [1, 2, 3, 4, 5, 6, 7, 8].some((seed) => { const t = run(L.createLearn(three, caps, seed), ['seen', 'seen', 'seen']).s; return t.queue.join() !== '0,1,2'; }));
eq('progress reaches 100%', L.progress(clean3.s), 1);
eq('every clean word is rated Good', clean3.done.map(L.ratingFor), [3, 3, 3]);

// a miss: the word goes to the back of the current phase, never to an earlier one
const atChoose = run(s3, ['seen', 'seen', 'seen']).s;
const first = L.currentWord(atChoose).card.lemma;
const missed = L.answer(atChoose, 'wrong').state;
check('a miss on choose re-appends the word to the end of the choose queue', missed.step === 'choose' && missed.queue.length === 3 && missed.queue[2] === atChoose.queue[0] && L.currentWord(missed).card.lemma !== first, JSON.stringify([atChoose.queue, missed.queue]));
const back = run(missed, ['correct', 'correct']);
check('after the others it is asked again, still in choose', L.currentStep(back.s) === 'choose' && L.currentWord(back.s).card.lemma === first && back.s.words[atChoose.queue[0]].pos === 1);
check('a miss never increases the word\'s position', missed.words[atChoose.queue[0]].pos === 1 && missed.words[atChoose.queue[0]].mistakes === 1);
check('progress stands still on a miss, never goes back', L.progress(missed) === L.progress(atChoose), `${L.progress(missed)} vs ${L.progress(atChoose)}`);
const toWrite = run(back.s, ['correct']).s;
eq('once everyone has passed choose, the round moves on to write', L.currentStep(toWrite), 'write');
const writeMiss = L.answer(toWrite, 'wrong').state;
check('a miss on write stays in write and never falls back to choose', writeMiss.step === 'write' && writeMiss.queue.length === 3 && writeMiss.queue[2] === toWrite.queue[0] && L.progress(writeMiss) === L.progress(toWrite));
const twoMisses = run(writeMiss, ['correct', 'correct', 'correct']);
check('two misses in the round (one in choose, one in write) still end with every word finished', twoMisses.s.phase === 'finished' && twoMisses.done.length === 3 && twoMisses.s.asked === 11, `${twoMisses.s.phase} ${twoMisses.done.length} ${twoMisses.s.asked}`);
const choseMiss = first, wroteMiss = L.currentWord(toWrite).card.lemma;
const wantRating = Object.fromEntries(three.map((c) => [c.lemma, 3]));
wantRating[choseMiss] -= 1; wantRating[wroteMiss] -= 1;   // 3 Good, 2 Hard (one miss), 1 Again (two misses)
eq('ratings follow the miss count: none Good, one Hard, two Again', three.map((c) => L.ratingFor(twoMisses.done.find((w) => w.card.lemma === c.lemma))), three.map((c) => wantRating[c.lemma]));
// progress is monotone through a run with mistakes
{ let s = s3, last = 0, monotone = true; for (const r of ['seen', 'seen', 'seen', 'wrong', 'correct', 'wrong', 'correct', 'correct', 'wrong', 'correct', 'correct', 'correct']) { const p = L.progress(s); if (p < last - 1e-9) monotone = false; last = p; s = L.answer(s, r).state; } check('progress never decreases through a run with three misses', monotone && s.phase === 'finished' && L.progress(s) === 1); }

// skipping meet for words already being learned, mixed with a new one
const mixed = L.createLearn([card({ lemma: 'fresh', cardId: 'f' }), card({ lemma: 'known', cardId: 'k', schedule: { state: 1 } })], caps, 3);
eq('only the new word is met; the phase then moves on with both', run(mixed, ['seen']).trail.concat([`${L.currentStep(run(mixed, ['seen']).s)}`]), ['meet:fresh', 'choose']);
check('the learning word joins at choose', run(mixed, ['seen']).s.queue.length === 2);
eq('a learning-only session starts straight at choose', L.currentStep(L.createLearn([card({ schedule: { state: 1 } })], caps)), 'choose');
const meetOnly = run(L.createLearn([card({ front: { cloze: null }, back: { meaning: '', definitionEn: '' } })], caps), ['seen']);
check('a word that could not be tested is finished but never rated', meetOnly.s.phase === 'finished' && meetOnly.done.length === 1 && L.ratingFor(meetOnly.done[0]) === null);
eq('unfinished words are not rated', L.ratingFor(run(s3, ['seen', 'seen', 'seen', 'correct']).s.words[0]), null);
const skipped = run(L.createLearn([card({ schedule: { state: 1 } })], caps), ['skip', 'correct']);
check('a skipped question passes the slot without counting as tested', skipped.s.phase === 'finished' && skipped.done[0].tested === 1 && L.ratingFor(skipped.done[0]) === 3);
eq('phaseCount: how many of the round have taken the current phase', [L.phaseCount(s3), L.phaseCount(run(s3, ['seen']).s), L.phaseCount(run(mixed, ['seen']).s)], [{ done: 0, total: 3 }, { done: 1, total: 3 }, { done: 0, total: 2 }]);

// rounds and checkpoints
const many = Array.from({ length: 14 }, (_, i) => card({ lemma: 'word' + i, cardId: 'c' + i }));
let big = L.createLearn(many, caps, 11);
eq('14 words are split into balanced rounds', big.rounds.map((r) => r.length), [5, 5, 4]);
eq('7 words avoid a one-word round', L.createLearn(many.slice(0, 7), caps).rounds.map((r) => r.length), [4, 3]);
let guard = 0, checkpoints = 0, finished = [], roundsSeen = [];
while (big.phase !== 'finished' && guard++ < 500) {
  if (big.phase === 'checkpoint') { checkpoints++; roundsSeen.push(big.round); big = L.nextRound(big); continue; }
  const w = L.currentWord(big);
  check(`word ${w.card.lemma} is asked inside its own round`, big.rounds[big.round].includes(big.words.indexOf(w)));
  const out = L.answer(big, L.currentStep(big) === 'meet' ? 'seen' : 'correct');
  big = out.state; if (out.completed) finished.push(out.completed.card.lemma);
}
check('a full session: 2 checkpoints, every word finished once, 3 questions per new word', checkpoints === 2 && roundsSeen.join() === '0,1' && finished.length === 14 && new Set(finished).size === 14 && big.asked === 42, `${checkpoints} checkpoints, ${finished.length} words, ${big.asked} questions`);
check('a checkpoint only continues from a checkpoint', L.nextRound(big) === big);
check('an empty session is finished from the start', L.createLearn([], caps).phase === 'finished');
check('answers after the end are ignored', L.answer(big, 'correct').state === big);
// the state is plain data: a JSON round trip (what a refresh does) behaves exactly like the original
const mid = run(s3, ['seen', 'seen', 'seen', 'wrong']).s;
const thawed = JSON.parse(JSON.stringify(mid));
eq('a serialised state continues identically', run(thawed, ['correct', 'correct', 'correct']).trail, run(mid, ['correct', 'correct', 'correct']).trail);

console.log(`${pass}/${pass + fail} study-logic tests passed`);
process.exit(fail ? 1 : 0);
