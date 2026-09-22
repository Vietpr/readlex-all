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

// ---- Learn engine ----
const caps = { canChoose: () => true, listen: true };
eq('new word: study -> choice -> context -> write', L.ladderFor(card(), caps), { ladder: ['study', 'choice', 'context', 'write'], start: 0 });
eq('learning word skips the study card', L.ladderFor(card({ schedule: { state: 1 } }), caps).start, 1);
eq('relearning word skips the study card', L.ladderFor(card({ schedule: { state: 3 } }), caps).start, 1);
eq('long-term word: starts at its sentence, ends with listening', L.ladderFor(card({ schedule: { state: 2 } }), caps), { ladder: ['study', 'choice', 'context', 'write', 'listen'], start: 2 });
eq('no sentence: no context step', L.ladderFor(card({ front: { cloze: null } }), caps).ladder, ['study', 'choice', 'write']);
eq('long-term word without a sentence starts at write', L.ladderFor(card({ front: { cloze: null }, schedule: { state: 2 } }), caps), { ladder: ['study', 'choice', 'write', 'listen'], start: 2 });
eq('no distractors: no multiple choice', L.ladderFor(card(), { canChoose: () => false, listen: true }).ladder, ['study', 'write']);
eq('identical meanings in the pool: skip the meaning question only', L.ladderFor(card(), { canChoose: (_c, what) => what === 'word', listen: true }).ladder, ['study', 'context', 'write']);
eq('no audio: no listen step', L.ladderFor(card({ schedule: { state: 2 } }), { canChoose: () => true, listen: false }).ladder, ['study', 'choice', 'context', 'write']);
eq('nothing to ask: study only', L.ladderFor(card({ front: { cloze: null }, back: { meaning: '', definitionEn: '' } }), caps).ladder, ['study']);

const run = (state, script) => { const done = []; let s = state; for (const r of script) { const out = L.answer(s, r); s = out.state; if (out.completed) done.push(out.completed); } return { s, done }; };
let s0 = L.createLearn([card()], caps);
eq('first step of a new word', L.currentStep(s0), 'study');
let r1 = run(s0, ['seen', 'correct', 'correct', 'correct']);
check('a clean climb finishes the word and the session', r1.s.phase === 'finished' && r1.done.length === 1 && r1.done[0].mistakes === 0);
eq('clean climb rates Good', L.ratingFor(r1.done[0]), 3);
eq('progress reaches 100%', L.progress(r1.s), 1);
r1 = run(s0, ['seen', 'wrong']);
eq('a miss on the first question goes back to the card', L.currentStep(r1.s), 'study');
r1 = run(s0, ['seen', 'correct', 'wrong']);
eq('a miss moves one rung down', L.currentStep(r1.s), 'choice');
check('progress never moves backwards', L.progress(r1.s) === L.progress(run(s0, ['seen', 'correct']).s) && L.progress(r1.s) === 0.5, String(L.progress(r1.s)));
r1 = run(s0, ['seen', 'correct', 'wrong', 'correct', 'correct', 'correct']);
eq('one miss rates Hard', L.ratingFor(r1.done[0]), 2);
r1 = run(s0, ['seen', 'wrong', 'seen', 'wrong', 'seen', 'correct', 'correct', 'correct']);
eq('two misses rate Again', L.ratingFor(r1.done[0]), 1);
const studyOnly = run(L.createLearn([card({ front: { cloze: null }, back: { meaning: '', definitionEn: '' } })], caps), ['seen']);
check('a word that could not be tested is finished but never rated', studyOnly.s.phase === 'finished' && L.ratingFor(studyOnly.done[0]) === null);
eq('unfinished words are not rated', L.ratingFor(run(s0, ['seen', 'correct']).s.words[0]), null);
const skipped = run(L.createLearn([card({ schedule: { state: 2 } })], caps), ['correct', 'correct', 'skip']);
check('skipping the listening step still finishes the word', skipped.s.phase === 'finished' && L.ratingFor(skipped.done[0]) === 3);

const many = Array.from({ length: 14 }, (_, i) => card({ lemma: 'word' + i, cardId: 'c' + i }));
let big = L.createLearn(many, caps);
eq('14 words are split into balanced rounds', big.rounds.map((r) => r.length), [5, 5, 4]);
eq('7 words avoid a one-word round', L.createLearn(many.slice(0, 7), caps).rounds.map((r) => r.length), [4, 3]);
// spacing: after the study card the same word must not come straight back while others are waiting
const afterSeen = L.answer(big, 'seen').state;
check('a word returns after other questions, not immediately', afterSeen.queue[0] !== 0 && afterSeen.queue.indexOf(0) === 2, JSON.stringify(afterSeen.queue));
const afterWrong = L.answer(L.answer(afterSeen, 'seen').state, 'wrong').state;
check('a wrong answer stays inside the round', afterWrong.queue.length === 5 && afterWrong.phase === 'question');
// play everything correctly: rounds end with a checkpoint, then the session finishes
let guard = 0, checkpoints = 0, finished = [];
while (big.phase !== 'finished' && guard++ < 500) {
  if (big.phase === 'checkpoint') { checkpoints++; big = L.nextRound(big); continue; }
  const out = L.answer(big, L.currentStep(big) === 'study' ? 'seen' : 'correct');
  big = out.state; if (out.completed) finished.push(out.completed.card.lemma);
}
check('a full session: 2 checkpoints, every word finished once, 4 questions per new word', checkpoints === 2 && finished.length === 14 && new Set(finished).size === 14 && big.asked === 56, `${checkpoints} checkpoints, ${finished.length} words, ${big.asked} questions`);
check('an empty session is finished from the start', L.createLearn([], caps).phase === 'finished');
check('answers after the end are ignored', L.answer(big, 'correct').state === big);

console.log(`${pass}/${pass + fail} study-logic tests passed`);
process.exit(fail ? 1 : 0);
