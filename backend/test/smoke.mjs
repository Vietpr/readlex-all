// Backend smoke test (multi-user): migrations on a local D1, `wrangler dev` with mocked Gemini, then
// register/login -> sync -> enrichment -> today -> reviews -> stats -> import, plus isolation between users.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 220) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STATE = path.join(ROOT, '.wrangler', 'test-backend');
fs.rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply readlex --local --persist-to "${STATE}"`, { cwd: ROOT, stdio: 'pipe' });
const dev = spawn(NPX, ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', STATE, '--var', 'GEMINI_MOCK:1', '--var', 'SIGNUP_MODE:invite', '--var', 'INVITE_CODE:letmein', '--test-scheduled', '--log-level', 'warn'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true, shell: process.platform === 'win32' });
let devLog = '';
dev.stdout.on('data', (d) => { devLog += d; });
dev.stderr.on('data', (d) => { devLog += d; });

let token = '';
async function api(method, url, body, { auth = token } = {}) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
}

try {
  let up = false;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/`); if (r.ok) { up = true; break; } } catch { /* not yet */ } await sleep(500); }
  check('wrangler dev started', up, up ? '' : devLog.slice(-400));
  if (!up) throw new Error('dev server did not start');

  let r = await api('GET', '/api/v1/health', null, { auth: '' });
  check('health is public', r.status === 200 && r.data.mock === true && r.data.signup === 'invite', JSON.stringify(r.data));
  r = await api('GET', '/api/v1/today', null, { auth: '' });
  check('protected route without token -> 401', r.status === 401);

  // register / login
  r = await api('POST', '/api/v1/auth/register', { email: 'a@example.com', password: 'secret123', inviteCode: 'wrong' }, { auth: '' });
  check('register with wrong invite code rejected', r.status === 403);
  r = await api('POST', '/api/v1/auth/register', { email: 'a@example.com', password: 'short', inviteCode: 'letmein' }, { auth: '' });
  check('short password rejected', r.status === 400);
  r = await api('POST', '/api/v1/auth/register', { email: 'A@Example.com', password: 'secret123', inviteCode: 'letmein', displayName: 'A' }, { auth: '' });
  check('register first user (admin)', r.status === 200 && r.data.token && r.data.user.email === 'a@example.com' && r.data.user.role === 'admin', JSON.stringify(r.data.user));
  token = r.data.token;
  r = await api('POST', '/api/v1/auth/register', { email: 'a@example.com', password: 'secret123', inviteCode: 'letmein' }, { auth: '' });
  check('duplicate email rejected', r.status === 409);
  r = await api('POST', '/api/v1/auth/login', { email: 'a@example.com', password: 'nope' }, { auth: '' });
  check('wrong password rejected', r.status === 401);
  r = await api('POST', '/api/v1/auth/login', { email: 'a@example.com', password: 'secret123', kind: 'extension', label: 'máy công ty' }, { auth: '' });
  check('login creates an extension session', r.status === 200 && r.data.token && r.data.token !== token);
  const extToken = r.data.token;
  r = await api('GET', '/api/v1/auth/me', null, { auth: extToken });
  check('me via extension token', r.data.user.email === 'a@example.com' && r.data.session.kind === 'extension' && r.data.user.hasGeminiKey === false);
  r = await api('GET', '/api/v1/auth/tokens');
  check('sessions listed', r.data.sessions.length === 2);

  // gemini key (mock accepts anything)
  r = await api('PUT', '/api/v1/me/gemini', { apiKey: 'AIzaFAKE-KEY-1234', model: 'gemini-2.5-flash' });
  check('set gemini key (encrypted server side)', r.status === 200 && r.data.hasGeminiKey && r.data.masked === 'AIza…1234', JSON.stringify(r.data));
  r = await api('GET', '/api/v1/auth/me');
  check('key never returned, only flag', r.data.user.hasGeminiKey === true && JSON.stringify(r.data).includes('FAKE') === false);

  // sync from the "extension"
  const save = (surface, sentence, extra = {}, auth = extToken) => api('POST', '/api/v1/sync', {
    op: 'vocabulary.save', clientCreatedAt: Date.now(),
    payload: { vocabulary: { language: 'en', lemma: surface.toLowerCase(), surface, quickMeaning: 'nghĩa nhanh', ipa: '/x/', ...extra }, exposure: { surface, sentence, paragraph: sentence, url: 'https://example.com/a', pageTitle: 'Example article', encounteredAt: Date.now() } },
  }, { auth });
  r = await save('sustain', 'The company struggled to sustain growth.');
  check('sync vocabulary.save creates word', r.status === 200 && r.data.ok && r.data.created === true && r.data.vocabularyId, JSON.stringify(r.data));
  const sustainId = r.data.vocabularyId;
  r = await save('sustain', 'The company struggled to sustain growth.');
  check('same sentence again is a no-op exposure', r.data.created === false && r.data.exposureAdded === false);
  r = await api('POST', '/api/v1/sync', { op: 'vocabulary.save', payload: { vocabulary: { language: 'en', lemma: 'sustain', surface: 'sustained' }, exposure: { surface: 'sustained', sentence: 'Growth was sustained for years.', url: 'https://example.com/b', pageTitle: 'B' } } }, { auth: extToken });
  check('second exposure for the same lemma', r.data.created === false && r.data.exposureAdded === true);
  await save('resilient', 'The economy remains resilient.');
  r = await api('POST', '/api/v1/sync', { ops: [
    { op: 'vocabulary.save', payload: { vocabulary: { language: 'ja', lemma: '買う', surface: '買いました', reading: 'かう', quickMeaning: 'mua' }, exposure: { surface: '買いました', sentence: '私は本を買いました。', url: 'https://example.jp/1', pageTitle: 'JP' } } },
    { op: 'lookup.record', payload: { language: 'en', lemma: 'tariff', surface: 'tariffs', site: 'example.com' } },
  ] }, { auth: extToken });
  check('batch ops (ja save + lookup.record)', r.status === 200 && r.data.ok && r.data.results.length === 2, JSON.stringify(r.data.results));

  let detail = null;
  for (let i = 0; i < 20; i++) { detail = (await api('GET', `/api/v1/vocabulary/${sustainId}`)).data; if (detail.vocabulary.enrichmentStatus === 'done') break; await sleep(300); }
  check('mock enrichment applied after save', detail.vocabulary.enrichmentStatus === 'done' && detail.vocabulary.enrichment.cefr === 'B2', detail.vocabulary.enrichmentError || detail.vocabulary.enrichment?.meaningInContext);
  check('detail has 2 exposures + card with cloze', detail.exposures.length === 2 && detail.card && detail.card.front.cloze === 'The company struggled to ______ growth.' && detail.card.intervals.good, JSON.stringify({ cloze: detail.card?.front.cloze }));

  // second user cannot see the first user's data
  r = await api('POST', '/api/v1/auth/register', { email: 'b@example.com', password: 'secret456', inviteCode: 'letmein' }, { auth: '' });
  const tokenB = r.data.token;
  check('second user registered as normal user', r.data.user.role === 'user');
  r = await api('GET', '/api/v1/vocabulary', null, { auth: tokenB });
  check('user B sees an empty vocabulary', r.data.total === 0);
  r = await api('GET', `/api/v1/vocabulary/${sustainId}`, null, { auth: tokenB });
  check("user B cannot read user A's word", r.status === 404);
  r = await api('POST', '/api/v1/reviews', { cardId: detail.card.cardId, rating: 3 }, { auth: tokenB });
  check("user B cannot review user A's card", r.data.ok === false);
  await save('sustain', 'B also saved sustain.', {}, tokenB);
  r = await api('GET', '/api/v1/vocabulary?query=sust', null, { auth: tokenB });
  check('same lemma exists independently for user B', r.data.total === 1 && r.data.items[0].exposureCount === 1 && r.data.items[0].id !== sustainId);

  const cron = await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*`);
  check('scheduled handler reachable', cron.ok);
  await sleep(600);
  r = await api('GET', '/api/v1/vocabulary?enrichment=done');
  check('all of user A words enriched', r.data.total === 3, `enriched ${r.data.total}`);

  r = await api('GET', '/api/v1/today?tz=420');
  check('today lists new cards for user A only', r.data.ok && r.data.new.length === 3 && r.data.due.length === 0 && r.data.counts.savedToday === 3 && r.data.hasGeminiKey === true, JSON.stringify(r.data.counts));
  const setsBefore = await api('GET', '/api/v1/sets?tz=420');
  check('daily sets: one set for today with 3 new words', setsBefore.data.sets.length === 1 && setsBefore.data.sets[0].date === r.data.today && setsBefore.data.sets[0].words === 3 && setsBefore.data.sets[0].fresh === 3, JSON.stringify(setsBefore.data.sets));
  const setToday = await api('GET', `/api/v1/sets/${r.data.today}?tz=420`);
  check('daily set detail returns card contents', setToday.data.cards.length === 3 && setToday.data.cards.every((k) => k.cardId && k.savedAt) && setToday.data.studied === 0, `${setToday.data.cards.length} cards`);
  check('bad set date rejected', (await api('GET', '/api/v1/sets/yesterday')).status === 400);
  const card = r.data.new.find((c) => c.lemma === 'sustain');
  r = await api('POST', '/api/v1/reviews', { cardId: card.cardId, rating: 3, durationMs: 4200 });
  check('review Good schedules the card', r.data.ok && r.data.state !== 0 && r.data.due > Date.now(), JSON.stringify({ state: r.data.state, in: r.data.intervals }));
  r = await api('POST', '/api/v1/reviews', { reviews: [{ cardId: card.cardId, rating: 1 }, { cardId: card.cardId, rating: 4 }] });
  check('batch reviews', r.data.ok && r.data.results.length === 2);
  // a rating the device already sent must not be applied twice when the answer was lost on the way back
  {
    const before = (await api('GET', `/api/v1/vocabulary/${sustainId}`)).data;
    const once = await api('POST', '/api/v1/reviews', { reviews: [{ id: 'retry-1', cardId: card.cardId, rating: 3 }] });
    const twice = await api('POST', '/api/v1/reviews', { reviews: [{ id: 'retry-1', cardId: card.cardId, rating: 3 }] });
    const after = (await api('GET', `/api/v1/vocabulary/${sustainId}`)).data;
    check('a resent rating is answered, not applied again', once.data.ok && twice.data.ok && twice.data.results[0].duplicate === true && after.reviews.length === before.reviews.length + 1 && after.card.schedule.reps === before.card.schedule.reps + 1, JSON.stringify({ reviews: [before.reviews.length, after.reviews.length], reps: [before.card.schedule.reps, after.card.schedule.reps] }));
    const bDetail = (await api('GET', '/api/v1/vocabulary', null, { auth: tokenB })).data;
    const bCard = bDetail.items[0] && (await api('GET', `/api/v1/vocabulary/${bDetail.items[0].id}`, null, { auth: tokenB })).data.card;
    if (bCard) {
      const bBefore = (await api('GET', `/api/v1/vocabulary/${bDetail.items[0].id}`, null, { auth: tokenB })).data.reviews.length;
      await api('POST', '/api/v1/reviews', { reviews: [{ id: 'retry-1', cardId: bCard.cardId, rating: 3 }] }, { auth: tokenB });
      const bAfter = (await api('GET', `/api/v1/vocabulary/${bDetail.items[0].id}`, null, { auth: tokenB })).data.reviews.length;
      check('the same client id on another account is its own rating', bAfter === bBefore + 1, `${bBefore} -> ${bAfter}`);
    }
    check('a rating for a card that is gone is reported, not applied', (await api('POST', '/api/v1/reviews', { reviews: [{ id: 'retry-gone', cardId: 'nope', rating: 3 }] })).data.results[0].error.includes('Card not found'));
  }
  r = await api('GET', `/api/v1/vocabulary/${sustainId}`);
  check('reviews recorded + status learning', r.data.reviews.length === 4 && r.data.vocabulary.status === 'learning' && r.data.card.schedule.reps === 4, JSON.stringify({ reviews: r.data.reviews.length, reps: r.data.card.schedule.reps }));
  const setsAfter = await api('GET', '/api/v1/sets?tz=420');
  check('daily set counts studied words', setsAfter.data.sets[0].studied === 1 && setsAfter.data.sets[0].fresh === 2, JSON.stringify(setsAfter.data.sets[0]));
  r = await api('PATCH', `/api/v1/vocabulary/${sustainId}`, { status: 'known', note: 'ghi chú' });
  check('patch status + note', r.data.vocabulary.status === 'known' && r.data.vocabulary.note === 'ghi chú');
  r = await api('GET', '/api/v1/stats?tz=420');
  check('stats scoped to user A', r.data.ok && r.data.totals.total === 3 && r.data.totals.reviews === 4 && r.data.streak === 1 && r.data.byLevel.B2 >= 1, JSON.stringify(r.data.totals));
  check('stats carry recall-rate inputs and words first studied this week', r.data.recall.d7.reviews === 4 && r.data.recall.d7.again === 1 && r.data.recall.all.again === 1 && r.data.totals.learnedWeek === 1 && Object.keys(r.data.perDay).length === 30, JSON.stringify(r.data.recall));
  const wide = await api('GET', '/api/v1/stats?tz=420&days=84');
  check('stats accept a 12-week window for the heatmap', Object.keys(wide.data.perDay).length === 84 && Object.keys(wide.data.savedPerDay).length === 84 && wide.data.streak === 1);
  r = await api('GET', '/api/v1/difficult');
  check('difficult words: one Again is not enough, known words are left out', r.data.ok && r.data.items.length === 0, JSON.stringify(r.data.items));
  const slippery = setToday.data.cards.find((k) => k.lemma !== 'sustain');
  await api('POST', '/api/v1/reviews', { reviews: [{ cardId: slippery.cardId, rating: 1 }, { cardId: slippery.cardId, rating: 1 }, { cardId: slippery.cardId, rating: 3 }] });
  r = await api('GET', '/api/v1/difficult');
  check('difficult words: two Again answers surface the card with its content', r.data.items.length === 1 && r.data.items[0].again === 2 && r.data.items[0].reviews === 3 && r.data.items[0].card.lemma === slippery.lemma && !!r.data.items[0].card.back, JSON.stringify(r.data.items.map((i) => [i.card?.lemma, i.again])));
  check('difficult words are per user', (await api('GET', '/api/v1/difficult', null, { auth: tokenB })).data.items.length === 0);
  r = await api('POST', '/api/v1/import', { app: 'readlex', version: 1, vocabulary: [
    { id: 'old-1', language: 'en', lemma: 'curb', surface: 'curb', quickMeaning: 'kiềm chế', createdAt: Date.now() - 86400000 * 3, enrichment: { lemma: 'curb', meaningVi: 'kiềm chế', cefr: 'B2', collocations: [], example: '', exampleVi: '', synonyms: [], wordFamily: [], notes: '', learningPriority: 4, isProperNoun: false, partOfSpeech: 'verb', ipa: '', meaningInContext: 'kiềm chế', sentenceVi: '', definitionEn: '', reading: '', level: '' } },
    { id: 'old-2', language: 'en', lemma: 'resilient', surface: 'resilient' },
  ], exposures: [{ id: 'e1', vocabularyId: 'old-1', surface: 'curb', sentence: 'to curb inflation', url: 'https://example.com/c', pageTitle: 'C', encounteredAt: Date.now() }], lookups: [{ lemma: 'amid', count: 4, firstSeenAt: 1, lastSeenAt: 2, surfaces: ['amid'], sites: ['x'] }] });
  check('import export JSON (1 new, 1 merged) with id map', r.data.ok && r.data.created === 1 && r.data.exposures === 1 && r.data.idMap['old-1'], JSON.stringify(r.data));
  r = await api('GET', '/api/v1/lookups/frequent?min=3');
  check('frequent lookups excludes saved words', r.data.items.length === 1 && r.data.items[0].lemma === 'amid');

  // a meaning typed by the user (web Add word / set composer) is kept as their own meaning and beats the AI one
  r = await api('POST', '/api/v1/sync', { op: 'vocabulary.save', payload: { vocabulary: { language: 'en', lemma: 'ledger', surface: 'ledger', quickMeaning: 'sổ cái', userMeaning: 'sổ cái' } } });
  await sleep(600);
  r = await api('GET', `/api/v1/vocabulary/${r.data.vocabularyId}`);
  check('hand-typed meaning survives enrichment and shows on the card', r.data.vocabulary.userMeaning === 'sổ cái' && r.data.card.back.meaning === 'sổ cái' && r.data.vocabulary.enrichmentStatus === 'done', JSON.stringify([r.data.vocabulary.userMeaning, r.data.card.back.meaning]));
  await api('DELETE', `/api/v1/vocabulary/${r.data.vocabulary.id}`);

  // a request-triggered enrichment run stays on the caller's own words (and so their own Gemini quota)
  {
    const mine = await api('POST', '/api/v1/sync', { op: 'vocabulary.save', payload: { vocabulary: { language: 'en', lemma: 'quota-mine', surface: 'quota-mine' } } });
    const theirs = await api('POST', '/api/v1/sync', { op: 'vocabulary.save', payload: { vocabulary: { language: 'en', lemma: 'quota-theirs', surface: 'quota-theirs' } } }, { auth: tokenB });
    await api('PATCH', `/api/v1/vocabulary/${theirs.data.vocabularyId}`, { status: 'new' }, { auth: tokenB });
    await api('POST', '/api/v1/enrich/run?max=50');
    const after = await api('GET', `/api/v1/vocabulary/${theirs.data.vocabularyId}`, null, { auth: tokenB });
    check('enrich/run never spends another account\'s Gemini quota', after.data.vocabulary.enrichmentStatus !== 'processing', JSON.stringify({ theirs: after.data.vocabulary.enrichmentStatus }));
    await api('DELETE', `/api/v1/vocabulary/${mine.data.vocabularyId}`);
    await api('DELETE', `/api/v1/vocabulary/${theirs.data.vocabularyId}`, null, { auth: tokenB });
  }

  // AI meaning fill for words the learner types in by hand (mock Gemini here)
  r = await api('POST', '/api/v1/define', { language: 'en', terms: [] });
  check('define needs at least one word', r.status === 400);
  check('define needs a session', (await api('POST', '/api/v1/define', { language: 'en', terms: ['ledger'] }, { auth: '' })).status === 401);
  r = await api('POST', '/api/v1/define', { language: 'en', terms: ['  ledger  ', 'audit', 'xxxxx'] });
  check('define answers one item per word, in order, trimmed', r.data.ok && r.data.items.length === 3 && r.data.items.map((i) => i.term).join(',') === 'ledger,audit,xxxxx', JSON.stringify(r.data.items?.map((i) => i.term)));
  check('each item carries its own word\'s meaning, not a neighbour\'s', r.data.items.slice(0, 2).every((i) => i.meaningVi.includes(i.term) && i.example.includes(i.term)), JSON.stringify(r.data.items.map((i) => [i.term, i.meaningVi])));
  check('define explains how the word is used, not just what it means', !!r.data.items[0].usage && !!r.data.items[0].notUsed && !!r.data.items[0].definitionEn && !!r.data.items[0].example, JSON.stringify({ usage: r.data.items[0].usage, notUsed: r.data.items[0].notUsed }));
  check('a word the AI does not know carries no invented usage', r.data.items[2].notUsed === '', JSON.stringify(r.data.items[2]));
  check('define fills the meaning a flashcard needs', /nghĩa mock của ledger/.test(r.data.items[0].meaningVi) && r.data.items[0].unknown === false && !!r.data.items[0].example && r.data.items[0].level === 'B1', JSON.stringify(r.data.items[0]));
  check('a word the AI does not know is flagged instead of invented', r.data.items[2].unknown === true && r.data.items[2].meaningVi === '', JSON.stringify(r.data.items[2]));
  r = await api('POST', '/api/v1/define', { language: 'ja', terms: ['買う'] });
  check('define returns a reading for Japanese', r.data.items[0].reading === 'よみ' && r.data.items[0].ipa === '', JSON.stringify(r.data.items[0]));
  r = await api('POST', '/api/v1/define', { language: 'en', terms: Array.from({ length: 30 }, (_, i) => `word${i}`) });
  check('define caps a batch at 20 words', r.data.items.length === 20);
  check('define stores nothing', (await api('GET', '/api/v1/vocabulary?query=ledger')).data.total === 0, JSON.stringify((await api('GET', '/api/v1/vocabulary?query=ledger')).data.items?.map((v) => v.lemma)));

  // custom sets + editing
  r = await api('POST', '/api/v1/custom-sets', { name: '  ' });
  check('set needs a name', r.status === 400);
  r = await api('POST', '/api/v1/custom-sets', { name: 'Economy words' });
  const setId = r.data.set.id;
  const allWords = (await api('GET', '/api/v1/vocabulary')).data.items;
  r = await api('POST', `/api/v1/custom-sets/${setId}/items`, { vocabularyIds: [...allWords.map((v) => v.id), 'not-mine'] });
  check('add words to a set (unknown ids ignored)', r.data.added === allWords.length, JSON.stringify(r.data));
  r = await api('GET', `/api/v1/custom-sets?vocabularyId=${sustainId}`);
  check('set list has counts and membership flag', r.data.sets.length === 1 && r.data.sets[0].words === allWords.length && r.data.sets[0].studied >= 1 && r.data.sets[0].containsWord === 1, JSON.stringify(r.data.sets[0]));
  r = await api('GET', `/api/v1/custom-sets/${setId}`);
  check('set detail returns cards', r.data.cards.length === allWords.length && r.data.set.name === 'Economy words');
  r = await api('PATCH', `/api/v1/custom-sets/${setId}`, { name: 'Economy & markets' });
  check('rename set', r.data.set.name === 'Economy & markets');
  r = await api('DELETE', `/api/v1/custom-sets/${setId}/items/${sustainId}`);
  r = await api('GET', `/api/v1/custom-sets/${setId}`);
  check('remove one word from the set keeps the word itself', r.data.cards.length === allWords.length - 1 && (await api('GET', `/api/v1/vocabulary/${sustainId}`)).status === 200);
  check("another user cannot open the set", (await api('GET', `/api/v1/custom-sets/${setId}`, null, { auth: tokenB })).status === 404);
  r = await api('PATCH', `/api/v1/vocabulary/${sustainId}`, { meaning: 'giữ vững (nghĩa của tôi)', reading: '', lemma: 'sustain' });
  check('edit own meaning; card uses it', r.data.vocabulary.userMeaning === 'giữ vững (nghĩa của tôi)' && (await api('GET', `/api/v1/vocabulary/${sustainId}`)).data.card.back.meaning === 'giữ vững (nghĩa của tôi)');
  r = await api('PATCH', `/api/v1/vocabulary/${sustainId}`, { lemma: 'resilient' });
  check('renaming to an existing word is refused', r.status === 409, r.data.error);
  const exps = (await api('GET', `/api/v1/vocabulary/${sustainId}`)).data.exposures;
  r = await api('DELETE', `/api/v1/exposures/${exps[0].id}`);
  check('delete one sentence', r.status === 200 && (await api('GET', `/api/v1/vocabulary/${sustainId}`)).data.vocabulary.exposureCount === exps.length - 1);
  check("cannot delete someone else's sentence", (await api('DELETE', `/api/v1/exposures/${exps[1].id}`, null, { auth: tokenB })).status === 404);
  r = await api('DELETE', `/api/v1/custom-sets/${setId}`);
  check('deleting a set keeps its words', r.status === 200 && (await api('GET', '/api/v1/vocabulary')).data.total === allWords.length && (await api('GET', '/api/v1/custom-sets')).data.sets.length === 0);

  // forgot / reset (mock mode returns the token instead of emailing it)
  r = await api('POST', '/api/v1/auth/forgot', { email: 'nobody@example.com' }, { auth: '' });
  check('forgot for unknown email still answers ok', r.status === 200 && r.data.ok);
  r = await api('POST', '/api/v1/auth/forgot', { email: 'a@example.com' }, { auth: '' });
  check('forgot returns a dev token when mail is not configured', r.data.ok && r.data.devToken, JSON.stringify(r.data).slice(0, 80));
  const resetToken = r.data.devToken;
  r = await api('POST', '/api/v1/auth/reset', { token: 'bad', password: 'whatever1' }, { auth: '' });
  check('reset with a bad token rejected', r.status === 400);
  r = await api('POST', '/api/v1/auth/reset', { token: resetToken, password: 'reset12345' }, { auth: '' });
  check('reset sets a new password and logs in', r.status === 200 && r.data.token, JSON.stringify(r.data.user?.email));
  r = await api('GET', '/api/v1/auth/me');
  check('old sessions revoked after reset', r.status === 401);
  token = (await api('POST', '/api/v1/auth/login', { email: 'a@example.com', password: 'reset12345' }, { auth: '' })).data.token;
  r = await api('POST', '/api/v1/auth/reset', { token: resetToken, password: 'again12345' }, { auth: '' });
  check('reset token is single-use', r.status === 400);

  // password change, logout, key removal, account deletion
  r = await api('PATCH', '/api/v1/me', { password: 'newsecret1', currentPassword: 'reset12345' });
  check('password changed', r.status === 200);
  r = await api('POST', '/api/v1/auth/login', { email: 'a@example.com', password: 'newsecret1' }, { auth: '' });
  check('login with new password', r.status === 200);
  r = await api('POST', '/api/v1/auth/logout', null, { auth: extToken });
  r = await api('GET', '/api/v1/auth/me', null, { auth: extToken });
  check('logged-out token rejected', r.status === 401);
  r = await api('DELETE', '/api/v1/me/gemini');
  r = await api('GET', '/api/v1/auth/me');
  check('gemini key removed', r.data.user.hasGeminiKey === false);
  r = await api('DELETE', '/api/v1/me', { password: 'wrong' }, { auth: tokenB });
  check('delete account needs the right password', r.status === 401);
  r = await api('DELETE', '/api/v1/me', { password: 'secret456' }, { auth: tokenB });
  check('user B deleted with all data', r.data.deleted === true && (await api('GET', '/api/v1/auth/me', null, { auth: tokenB })).status === 401);
  r = await api('GET', '/api/v1/stats');
  check('user A data intact after B deletion', r.data.totals.total === 4, JSON.stringify(r.data.totals));
} catch (err) {
  check('unexpected error', false, err.stack || String(err));
} finally {
  try { process.kill(-dev.pid, 'SIGTERM'); } catch { dev.kill('SIGTERM'); }
  await sleep(800);
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed && devLog) console.log('--- wrangler log tail ---\n' + devLog.slice(-1500));
process.exit(failed ? 1 : 0);
