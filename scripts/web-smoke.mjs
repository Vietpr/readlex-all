// End-to-end: local backend (wrangler dev + mocked Gemini) + built web app (vite preview) driven by Puppeteer.
//   cd web && npm run build && cd .. && node scripts/web-smoke.mjs
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const WEB = path.join(ROOT, 'web');
const API_PORT = 8791;
const WEB_PORT = 4174;
const API = `http://127.0.0.1:${API_PORT}`;
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let TOKEN = '';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 200) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadPuppeteer() {
  try { return (await import('puppeteer-core')).default; } catch { /* fall through */ }
  const dir = process.env.PUPPETEER_DIR || ROOT;
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules/puppeteer-core/package.json'), 'utf8'));
  let entry = pkg.exports?.['.']?.import ?? pkg.main;
  if (entry && typeof entry === 'object') entry = entry.default;
  return (await import(pathToFileURL(path.join(dir, 'node_modules/puppeteer-core', entry)).href)).default;
}
const puppeteer = await loadPuppeteer();

const STATE = path.join(BACKEND, '.wrangler', 'test-web');
fs.rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply readlex --local --persist-to "${STATE}"`, { cwd: BACKEND, stdio: 'pipe' });
const childOptions = (cwd) => ({
  cwd,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
  shell: process.platform === 'win32',
});
const api = spawn(NPX, ['wrangler', 'dev', '--port', String(API_PORT), '--ip', '127.0.0.1', '--persist-to', STATE, '--var', 'GEMINI_MOCK:1', '--log-level', 'warn'], childOptions(BACKEND));
const web = spawn(NPX, ['vite', 'preview', '--port', String(WEB_PORT), '--host', '127.0.0.1', '--strictPort'], childOptions(WEB));
let logs = '';
for (const p of [api, web]) { p.stdout.on('data', (d) => { logs += d; }); p.stderr.on('data', (d) => { logs += d; }); }

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.status < 500) return true; } catch { /* retry */ } await sleep(500); }
  return false;
}
// clear a React-controlled input so the next page.type() starts from empty
const clearInput = (handle) => handle.evaluate((el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); });
// scroll an element to the middle of the screen first, so the sticky top bar or the bottom nav can't swallow the click
const clickCentered = async (page, sel) => { await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await page.click(sel); };
const call = (method, p, body) => fetch(API + p, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

let browser = null;
const stopProcessTree = (child, force = false) => {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try { execSync(`taskkill /PID ${child.pid} /T${force ? ' /F' : ''}`, { stdio: 'ignore' }); } catch { /* already gone */ }
    return;
  }
  try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); } catch { try { child.kill(force ? 'SIGKILL' : 'SIGTERM'); } catch { /* already gone */ } }
};
try {
  check('backend up', await waitFor(`${API}/`));
  check('web preview up', await waitFor(`http://127.0.0.1:${WEB_PORT}/`));
  // an account for seeding through the API (the browser will register its own)
  const reg = await fetch(`${API}/api/v1/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'seed@example.com', password: 'seedpass1', inviteCode: 'letmein' }) }).then((r) => r.json());
  TOKEN = reg.token;
  check('seed account registered', !!TOKEN);
  // seed 3 words like the extension would
  const SEEDS = [['sustain', 'sustain', 'The company struggled to sustain growth.'], ['resilient', 'resilient', 'The economy remains resilient.'], ['curb', 'curb', 'Officials tried to curb inflation.']];
  let known = [...SEEDS];
  const lemmaForCloze = (cloze) => (known.find(([, surface, sentence]) => sentence.replace(surface, '______') === cloze.trim()) || [''])[0];
  for (const [lemma, surface, sentence] of SEEDS) {
    await call('POST', '/api/v1/sync', { op: 'vocabulary.save', payload: { vocabulary: { language: 'en', lemma, surface, quickMeaning: 'nghĩa nhanh' }, exposure: { surface, sentence, url: 'https://example.com/' + lemma, pageTitle: 'Example ' + lemma } } });
  }
  await call('POST', '/api/v1/sync', { op: 'vocabulary.save', payload: { vocabulary: { language: 'ja', lemma: '買う', surface: '買いました', reading: 'かう', quickMeaning: 'mua' }, exposure: { surface: '買いました', sentence: '私は本を買いました。', url: 'https://example.jp/1', pageTitle: 'JP' } } });
  await sleep(800);
  await call('POST', '/api/v1/enrich/run');

  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'], defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());   // every confirm() in the app is a delete the test means to go through with
  const failedResponses = [];
  page.on('response', (r) => { if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, '')}`); });
  await page.goto(`http://127.0.0.1:${WEB_PORT}/`, { waitUntil: 'load' });
  await sleep(500);
  check('logged-out app opens the login page without bottom nav', /Sign in/.test(await page.$eval('h1', (h) => h.textContent)) && (await page.$('.bottom-nav')) === null && (await page.$('.auth-brand')) !== null);
  // point the web at the test backend (the dev build defaults to :8787)
  await page.evaluate((api) => { localStorage.setItem('readlex.config', JSON.stringify({ apiUrl: api })); }, API);
  await page.reload({ waitUntil: 'load' });
  await sleep(400);
  await page.click('a[href="#/register"]');
  await sleep(300);
  check('register screen is distinct (features, name, confirm password, no invite)', /Create your account/.test(await page.$eval('h1', (h) => h.textContent)) && (await page.$$('.auth-features li')).length === 3 && (await page.$$('input[type="password"]')).length === 2 && (await page.$('input[placeholder^="Ask the"]')) === null);
  await page.type('input[type="email"]', 'web@example.com');
  const pws = await page.$$('input[type="password"]');
  await pws[0].type('webpass123');
  await pws[1].type('webpass124');
  await page.click('button.btn.primary.block');
  await sleep(400);
  check('mismatched passwords are caught client-side', /don't match/.test(await page.$eval('.auth-status', (e) => e.textContent)));
  await clearInput(pws[1]);
  await pws[1].type('webpass123');
  await page.click('button.btn.primary.block');
  await sleep(1500);
  check('a brand-new account gets a first-run card, not an empty plan or "all done"', /Nothing to study yet/.test(await page.$eval('[data-testid="first-run"]', (e) => e.textContent).catch(() => '')) && (await page.$('[data-testid="review-card"]')) === null && (await page.$('[data-testid="plan"]')) === null && (await page.$('[data-testid="all-done"]')) === null, await page.$eval('.page', (e) => e.textContent.replace(/\s+/g, ' ').slice(0, 120)).catch(() => ''));
  check('register succeeds and goes to Today (with top bar + nav)', /Good (morning|afternoon|evening)/.test(await page.$eval('h1', (h) => h.textContent)) && (await page.$('.topbar')) !== null && (await page.$('.bottom-nav')) !== null, (await page.$eval('h1', (h) => h.textContent)) + ' | ' + (await page.$eval('.auth-status', (e) => e.textContent).catch(() => '')));
  // this browser account has no words yet: log out, log in as the seeded account
  await page.goto(`http://127.0.0.1:${WEB_PORT}/#/settings`, { waitUntil: 'load' });
  await sleep(500);
  const gem = await page.$eval('.settings .badge', (b) => b.textContent);
  check('settings show Gemini key status', /Not set|Connected/.test(gem), gem);
  const aiSection = await page.$$eval('.settings-section', (els) => els.map((e) => e.textContent).join(' ')).catch(() => '');
  check('a demo server says so instead of pretending the AI is real', /fake Gemini/.test(aiSection) && /npm run dev:real/.test(aiSection), aiSection.slice(0, 160));
  await page.click('.settings-section .btn.small');   // Sign out
  await sleep(600);
  check('logout returns to login', /Sign in/.test(await page.$eval('h1', (h) => h.textContent)));
  // forgot -> (mock: token returned) -> reset page -> new password -> logged in
  await page.click('a[href="#/forgot"]');
  await sleep(300);
  check('forgot page', /Forgot password/.test(await page.$eval('h1', (h) => h.textContent)));
  await clearInput(await page.$('input[type="email"]'));
  await page.type('input[type="email"]', 'web@example.com');
  await page.click('button.btn.primary.block');
  await sleep(1200);
  check('mock mode jumps to the reset page with a token', /Set a new password/.test(await page.$eval('h1', (h) => h.textContent)) && /token=/.test(page.url()));
  const rp = await page.$$('input[type="password"]');
  await rp[0].type('newpass999');
  await rp[1].type('newpass999');
  await page.click('button.btn.primary.block');
  await sleep(1500);
  check('reset logs the user in', /Good (morning|afternoon|evening)/.test(await page.$eval('h1', (h) => h.textContent)));
  await page.goto(`http://127.0.0.1:${WEB_PORT}/#/settings`, { waitUntil: 'load' });
  await sleep(500);
  await page.click('.settings-section .btn.small');   // Sign out
  await sleep(600);
  await clearInput(await page.$('input[type="email"]'));
  await page.type('input[type="email"]', 'seed@example.com');
  await page.type('input[type="password"]', 'seedpass1');
  await page.click('button.btn.primary.block');
  await sleep(1500);
  check('login as seeded account', /Good (morning|afternoon|evening)/.test(await page.$eval('h1', (h) => h.textContent)));
  const text = async (sel) => (await page.$eval(sel, (e) => e.textContent).catch(() => '')).replace(/\s+/g, ' ');
  const navLabels = await page.$$eval('.bottom-nav a span', (els) => els.map((e) => e.textContent));
  check('English navigation with SVG icons', JSON.stringify(navLabels) === JSON.stringify(['Today', 'Library', 'Progress', 'Settings']) && (await page.$$('.bottom-nav svg')).length === 4, JSON.stringify(navLabels));
  const uiText = {};   // what each page says, kept for the "no Vietnamese left" check at the end
  uiText.today = await page.evaluate(() => document.body.innerText);
  // on pages that also show the learner's own (Vietnamese) meanings, only the labels of controls and headings are kept
  const uiLabels = () => page.$$eval('.btn, .tabs a, h2, label, .segmented button, .back-link, .block-label, .state-pill', (els) => els.map((e) => e.textContent).join(' | '));
  const hasClass = (sel, cls) => page.$eval(sel, (e, cls) => e.classList.contains(cls), cls).catch(() => false);
  // nothing is due and nothing was reviewed, so the plan has no review step at all: the 4 saved words are step 1
  check('Today: nothing due yet, 4 words saved today', (await page.$('[data-testid="review-card"]')) === null && (await page.$('[data-testid="all-done"]')) === null && (await page.$$('[data-testid="plan"] .plan-step')).length === 1
    && (await hasClass('[data-testid="saved-card"]', 'is-next')) && /Learn 4 new words saved today/.test(await text('[data-testid="saved-card"] .plan-title')) && /4 ?words saved/.test(await text('[data-testid="today-stats"]')) && /0 ?reviews/.test(await text('[data-testid="today-stats"]')),
    (await text('[data-testid="saved-card"]')) + ' | ' + (await text('[data-testid="today-stats"]')));
  const planButtons = await page.$$eval('[data-testid="plan"] button', (els) => els.map((e) => e.textContent));
  check('Today: one default action plus a single "another way" link instead of a wall of mode buttons', (await page.$('.tile')) === null && (await page.$('[data-testid="plan"] .quick-modes')) === null && (await page.$$('[data-testid="plan"] .btn.primary')).length === 1
    && /^Start learning$/.test((await text('[data-testid="saved-card"] .btn.primary')).trim()) && JSON.stringify(planButtons) === JSON.stringify(['Start learning', 'Study another way']), JSON.stringify(planButtons));
  const chips = await page.$$eval('[data-testid="saved-card"] .today-word-preview a', (els) => els.map((e) => e.textContent));
  check('Today: the next step previews its words', chips.length === 4 && chips.includes('sustain') && chips.includes('買う'), JSON.stringify(chips));
  check('Today: the week strip has seven days and today is not ticked before any review', (await page.$$('[data-testid="week-card"] .week-strip li')).length === 7 && (await page.$$('[data-testid="week-card"] .week-strip li.today')).length === 1 && (await page.$('[data-testid="week-card"] .week-strip li.studied')) === null, await text('[data-testid="week-card"]'));

  // study mode picker
  await page.click('[data-testid="saved-card"] .more-modes');
  await sleep(400);
  const modes = await page.$$eval('[data-mode] .mode-title b', (els) => els.map((e) => e.textContent));
  const groups = await page.$$eval('.mode-section-label', (els) => els.map((e) => e.textContent));
  check('mode picker: Learn on top, then three practice modes and two games (no quiz or context mode); games marked practice-only', (await page.$('.sheet[role="dialog"][aria-modal="true"]')) !== null && JSON.stringify(modes) === JSON.stringify(['Learn', 'Flashcards', 'Write', 'Listen', 'Match', 'Recall sprint']) && JSON.stringify(groups) === JSON.stringify(['Practice one skill', 'Games']) && /never change a card's review schedule/.test(await text('.sheet-note')) && /· 4 words/.test(await text('.sheet-head')) && !/\d+ words? · \d+ words?/.test(await text('.sheet-head')), JSON.stringify(modes) + ' ' + (await text('.sheet-head')));
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Escape closes the picker', (await page.$('.sheet')) === null);

  // ---- the end of a session: what is still open today, and a way to carry straight on ----
  // The summary first asks the server for today's plan, then shows either the next open step or the way back.
  const sessionExit = async () => {
    await page.waitForFunction(() => !!document.querySelector('.summary .next-step, .summary > .btn.primary'), { timeout: 15000 });
    return (await page.$('.summary .next-step')) ? 'next' : 'back';
  };
  // Listen can be skipped card by card, which ends a session without sending a single review.
  const skipThroughListen = async (n) => {
    await page.click('[data-testid="saved-card"] .more-modes');
    await sleep(400);
    await page.click('[data-mode="listen"]');
    await page.waitForSelector('.skip-listen', { timeout: 15000 });
    for (let i = 0; i < n; i++) { await clickCentered(page, '.skip-listen'); await sleep(350); }
    await page.waitForSelector('.summary', { timeout: 15000 });
  };
  await skipThroughListen(4);
  const exitOpen = await sessionExit();
  check('a session that leaves a step open ends by offering that step, with a way to postpone it', exitOpen === 'next' && /Up next/.test(await text('.next-step')) && /Learn 4 new words saved today/.test(await text('.next-step .plan-title')) && /^Start learning$/.test((await text('.next-step .btn.primary')).trim())
    && /^Later, back to Today$/.test((await text('.next-step .text-btn')).trim()) && (await page.$('.summary > .btn.primary')) === null && (await call('GET', '/api/v1/stats')).totals.reviews === 0, await text('.summary'));
  check('a session in which every card was skipped says so instead of celebrating', /No more cards/.test(await text('.summary h1')) && /You skipped all 4, so nothing was rated/.test(await text('.summary')) && !/remembered/.test(await text('.summary')), await text('.summary'));
  await clickCentered(page, '.next-step .text-btn');
  await sleep(900);
  check('"Later" goes back to Today and the step is still the next one', /#\/$/.test(page.url()) && (await hasClass('[data-testid="saved-card"]', 'is-next')) && (await page.$('.summary')) === null, page.url());

  // ---- flashcards: a real two-sided card ----
  const isBack = () => page.$eval('.flip-card', (e) => e.classList.contains('is-back'));
  const cardPoint = async () => { const b = await (await page.$('.flip-card')).boundingBox(); return { x: b.x + 40, y: b.y + 70 }; };
  const tapCard = async () => { const c = await cardPoint(); await page.mouse.click(c.x, c.y); };
  await page.click('[data-testid="saved-card"] .more-modes');           // Today has no quick links any more: Flashcards is in the picker
  await sleep(400);
  await page.click('[data-mode="flash"]');
  await sleep(700);
  const frontWord = (await text('.front-word')).trim();
  check('front is the word, its IPA, a speak button and "Tap to flip"', ['sustain', 'resilient', 'curb', '買う'].includes(frontWord) && /Tap to flip/.test(await text('.front-face')) && /\/mɒk\/|English · /.test(await text('.front-face')) && !/nghĩa mock/.test(await text('.front-face')) && (await page.$('.front-face .icon-btn.speak')) !== null && !(await isBack()) && (await page.$('.ratings')) === null, frontWord);
  await page.click('.flip-card');                                       // dead centre of the card = the word, not the speaker
  await sleep(400);
  const backText = await text('.back-face');
  // a rating button is <b>label</b><span>what it means</span><small>when the card comes back, spelled out ("in 10 min")</small>
  const ratingLabels = await page.$$eval('.ratings button', (els) => els.map((e) => e.querySelector('b').textContent));
  const ratingHints = await page.$$eval('.ratings button', (els) => els.map((e) => e.querySelector('span').textContent));
  const backFace = await page.$eval('.back-face', (el) => { const c = el.cloneNode(true); const d = c.querySelector('.more'); if (d) d.remove(); return c.textContent.replace(/\s+/g, ' '); });
  check('tap flips to the back: meaning, context, FSRS labels and intervals', (await isBack()) && backText.includes(`nghĩa mock trong câu (${frontWord})`) && /Where you met it/.test(backText) && !/Mock usage note/.test(backFace) && JSON.stringify(ratingLabels) === JSON.stringify(['Again', 'Hard', 'Good', 'Easy']) && /^in \d+ (min|hours?|days?|months?)$/.test((await text('.ratings .r3 small')).trim()), JSON.stringify([await isBack(), ratingLabels, await text('.ratings .r3 small'), await text('.exercise-foot')]));
  // the old one-line legend under the buttons is gone: each button now explains itself, under a question
  check('every rating button says what it means, and the row asks the question', JSON.stringify(ratingHints) === JSON.stringify(['forgot it', 'with effort', 'recalled it', 'instantly']) && /How well did you remember it\?/.test(await text('.rating-ask')) && (await page.$('.rating-legend')) === null
    && (await page.$$eval('.ratings button small', (els) => els.every((e) => /^in <?\d+(\.\d+)? (min|hours?|days?|months?|years?)$/.test(e.textContent)))), JSON.stringify([ratingHints, await text('.ratings')]));
  check('back: word and sentence both have a speak button; the saved form is highlighted; no flip hint repeated on the back', (await page.$$('.back-face .icon-btn.speak')).length >= 2 && (await page.$('.back-face .sentence-box mark')) !== null && (await page.$('.back-face .back-foot')) === null);
  await page.click('.back-face .more summary');
  await sleep(250);
  const more = await text('.back-face .more');
  check('"More details" holds usage guidance and collocations, never a bare "Notes" box', (await isBack()) && (await page.$eval('.back-face .more', (d) => d.open)) && /When to use it/.test(more) && /Collocations/.test(more) && /AI example/.test(more) && !/^.*\bNotes\b/.test(more.replace('When to use it', '')), JSON.stringify([await isBack(), more.slice(0, 140)]));
  await page.click('.back-face .icon-btn.speak');
  await sleep(250);
  check('audio buttons never flip the card', await isBack());
  const pt0 = await cardPoint();
  await page.mouse.click(pt0.x, pt0.y);
  await sleep(400);
  check('a second tap flips back to the front; rating stays available', !(await isBack()) && (await page.$('.ratings')) !== null);
  await page.keyboard.press('Space');
  await sleep(350);
  const afterSpace = await isBack();
  await page.keyboard.press('Space');
  await sleep(350);
  check('Space toggles front and back', afterSpace && !(await isBack()));
  await page.click('.ratings .r3');                                     // card 1: Good
  await sleep(600);
  // a refresh mid-session used to end it; now it picks up where it left off
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.flip-card', { timeout: 15000 });
  await sleep(400);
  check('a refresh keeps the session and the place in it', /2\/4/.test(await text('.review-top')) && !/No study session/.test(await text('.page')), await text('.review-top'));
  check('and it is really the same session, not a new one', /Flashcards · /.test(await text('.session-label')) && (await page.$('.ratings')) === null, await text('.session-label'));

  // card 2: press and hold = peek, with the mouse and with a finger
  check('next card starts on its front with no rating buttons', !(await isBack()) && (await page.$('.ratings')) === null);
  const pt = await cardPoint();
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await sleep(500);
  const peeking = await page.$eval('.flip-card', (e) => e.classList.contains('is-back') && e.classList.contains('is-peek'));
  await page.mouse.up();
  await sleep(400);
  check('press and hold peeks at the back; releasing returns to the front (and is not a tap)', peeking && !(await isBack()) && (await page.$('.ratings')) !== null);
  await page.touchscreen.touchStart(pt.x, pt.y);
  await sleep(500);
  const touchPeek = await page.$eval('.flip-card', (e) => e.classList.contains('is-peek'));
  await page.touchscreen.touchEnd();
  await sleep(400);
  check('long-press works with touch too', touchPeek && !(await isBack()));
  await page.touchscreen.tap(pt.x, pt.y);
  await sleep(400);
  check('a quick touch tap flips', await isBack());

  // the card's direction is a setting now (Settings -> Flashcard front), not a control on the study screen
  check('no direction or "answer by" control on the study screen', (await page.$('.review .segmented')) === null && (await isBack()) && (await page.$('.ratings')) !== null);
  await page.keyboard.press('1');     // Again -> comes back later in the session
  await sleep(600);
  for (let i = 0; i < 6; i++) {
    if (await page.$('.summary')) break;
    if (!(await page.$('.ratings'))) { await tapCard(); await sleep(350); }
    await page.click('.ratings .r4');
    await sleep(500);
  }
  const summary = await text('.summary');
  const summaryGrid = await page.$$eval('.summary-grid > div', (els) => els.map((e) => e.textContent));
  check('session ends with an English summary (Again card repeated once)', /4 cards done!/.test(summary) && /You remembered 4 of 5 answers\./.test(summary) && JSON.stringify(summaryGrid) === JSON.stringify(['1Again', '0Hard', '1Good', '3Easy']), summary.slice(0, 120) + ' ' + JSON.stringify(summaryGrid));
  // all four words are now scheduled and none is due, so nothing is open today: the summary only offers the way back
  const exitDone = await sessionExit();
  const stats = await call('GET', '/api/v1/stats');
  check('server recorded 5 reviews', stats.totals.reviews === 5, JSON.stringify(stats.totals));
  check('with nothing left open today, the summary offers only the way back', exitDone === 'back' && /^Back to Today$/.test((await text('.summary > .btn.primary')).trim()) && (await page.$('.summary .text-btn')) === null, await text('.summary'));
  await clickCentered(page, '.summary > .btn.primary');
  await sleep(900);
  check('Today then shows the plan as finished: both steps ticked, practice still on offer', /#\/$/.test(page.url()) && /You're done for today/.test(await text('[data-testid="all-done"]')) && (await hasClass('[data-testid="review-card"]', 'is-done')) && (await hasClass('[data-testid="saved-card"]', 'is-done'))
    && /Due cards reviewed/.test(await text('[data-testid="review-card"]')) && /5 reviews today/.test(await text('[data-testid="review-card"]')) && /Learned 4 words saved today/.test(await text('[data-testid="saved-card"]')) && (await page.$('[data-testid="plan"] .btn.primary')) === null && /^Practice again$/.test((await text('[data-testid="saved-card"] .btn')).trim())
    && /5 ?reviews/.test(await text('[data-testid="today-stats"]')), (await text('[data-testid="plan"]')) + ' | ' + (await text('[data-testid="today-stats"]')));
  check('Today: the week strip ticks today and the streak starts', (await page.$$('[data-testid="week-card"] .week-strip li.studied.today')).length === 1 && /1-day streak/.test(await text('[data-testid="week-card"]')) && /You have studied today/.test(await text('[data-testid="week-card"]')), await text('[data-testid="week-card"]'));

  // ---- Library -> today's Daily Set -> set detail: progress, then Write / Listen / Match as practice ----
  await page.goto(`http://127.0.0.1:${WEB_PORT}/#/library`, { waitUntil: 'load' });
  await sleep(700);
  const libCols = await page.$$eval('.library-cols > section > h2', (els) => els.map((e) => e.textContent));
  check('Library is one page: no tabs, no word list, My Sets and Daily Sets side by side', (await page.$('.tabs')) === null && (await page.$('.word-list')) === null && /Create your own set/.test(await text('.page')) && (await page.$$('.set-item')).length === 1
    && JSON.stringify(libCols) === JSON.stringify(['My Sets', 'Daily Sets']) && (await page.$$('.library-cols > section:nth-child(2) .set-item')).length === 1 && (await page.$('.library-cols > section:nth-child(1) .set-create-bar')) !== null, JSON.stringify(libCols));
  await page.type('.search-box input', 'resil');
  await sleep(600);
  check('searching finds words across the library and replaces the set view', (await page.$$('.word-list li')).length === 1 && /resilient/.test(await text('.word-list')) && (await page.$('.library-cols')) === null && /1 word matches/.test(await text('.list-count')), await text('.list-count'));
  await page.click('.search-box .icon-btn');
  await sleep(300);
  check('clearing the search brings the sets back', (await page.$('.library-cols')) !== null && (await page.$('.word-list')) === null);
  await page.goto(`http://127.0.0.1:${WEB_PORT}/#/library/sets`, { waitUntil: 'load' });
  await sleep(700);
  const setText = await text('.library-cols > section:nth-child(2) .set-item');
  check('/library/sets still opens the Library; the Daily Set for today is all studied', (await page.$('.library-cols')) !== null && (await page.$$('.set-item')).length === 1 && /Today/.test(setText) && /4 words/.test(setText) && /all studied/.test(setText), setText);
  await page.click('.set-item');
  await sleep(800);
  const progressText = await text('[data-testid="set-progress"]');
  check('set detail: progress summary, a state on every word, one primary action, a back link to the Library', /4 words saved/.test(await text('.lead')) && /4studied/.test(progressText) && /0new/.test(progressText) && /100%/.test(progressText) && (await page.$$('.word-list .state-pill')).length === 4
    && /Practice again|Continue learning/.test(await text('.study-cta .btn.primary')) && (await page.$$('.study-cta .quick-modes button')).length === 4 && /^Library$/.test((await text('.back-link')).trim()), progressText + ' | ' + (await text('.study-cta .btn.primary')));
  uiText.dailySet = await uiLabels();
  // a throwaway word, so deleting it cannot disturb the four words the rest of the run studies
  await call('POST', '/api/v1/sync', { op: 'vocabulary.save', payload: { vocabulary: { language: 'en', lemma: 'scratchword', surface: 'scratchword', quickMeaning: 'bỏ đi' } } });
  const wordsBefore = (await call('GET', '/api/v1/vocabulary')).total;
  await page.reload({ waitUntil: 'load' });
  // wait for the RE-RENDERED list, not the pre-reload one, or the handles below are detached
  await page.waitForFunction(() => !!document.querySelector('.word-list') && document.querySelector('.word-list').textContent.includes('scratchword'), { timeout: 15000 });
  const rowsBefore = (await page.$$('.word-list li')).length;
  const scratchAt = await page.$$eval('.word-list li', (els) => els.findIndex((e) => e.textContent.includes('scratchword')));
  const scratchBtn = (await page.$$('.word-list li .icon-btn.danger'))[scratchAt];
  await scratchBtn.evaluate((el) => el.scrollIntoView({ block: 'center' }));   // else the fixed bottom nav eats the click
  await scratchBtn.click();
  await sleep(1300);
  check('a word can be deleted straight from its daily set, and leaves Today with it', (await page.$$('.word-list li')).length === rowsBefore - 1 && (await call('GET', '/api/v1/vocabulary')).total === wordsBefore - 1 && !/scratchword/.test(await text('.word-list')) && /4 words saved/.test(await text('.lead')), JSON.stringify([rowsBefore, (await page.$$('.word-list li')).length, wordsBefore, (await call('GET', '/api/v1/vocabulary')).total, await text('.lead')]));
  const before = (await call('GET', '/api/v1/stats')).totals.reviews;
  await (await page.$$('.study-cta .quick-modes button'))[1].click();        // Write
  await sleep(600);
  check('Write: meaning + sentence with a gap, flagged as practice only', (await page.$('.type-input')) !== null && /Write the word/.test(await text('.review .hint')) && /Practice only/.test(await text('.review')) && /nghĩa mock/.test(await text('.quiz-q')));
  await page.type('.type-input', 'definitely-wrong');
  await page.keyboard.press('Enter');
  await sleep(400);
  const wrongText = await text('.type-result');
  check('wrong answer: your answer and the correct answer side by side, differences marked', /Not quite/.test(wrongText) && /Your answer/.test(wrongText) && /Correct answer/.test(wrongText) && (await page.$('.answer-compare .diff em.miss')) !== null, wrongText);
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.click('.exercise-foot .btn:not(.primary)');   // I don't know
  await sleep(400);
  check('"I don\'t know" shows the answer without a fake diff', /here's the answer/.test(await text('.type-result')) && (await page.$('.answer-compare .diff')) === null);
  await page.click('.exercise-foot .btn.primary');
  await sleep(500);
  await page.type('.type-input', 'almost');
  await page.keyboard.press('Enter');
  await sleep(300);
  await page.click('.override');
  await sleep(300);
  check('"I was right" overrides a wrong verdict', /Correct!/.test(await text('.type-result')));
  await page.keyboard.press('Enter');
  await sleep(500);
  const asked = ((await text('.quiz-q')).match(/\(([^)]+)\)\s*$/) || [])[1] || '';
  await page.type('.type-input', ` ${asked.toUpperCase()} `);
  await page.keyboard.press('Enter');
  await sleep(400);
  check('the right word is accepted whatever the case or spacing', /Correct!/.test(await text('.type-result')), asked);
  await page.keyboard.press('Enter');
  await sleep(500);
  check('missed words come back later in the session', (await page.$('.type-input')) !== null && /5\/6/.test(await text('.review-top')), await text('.review-top'));
  await page.click('.review-top .icon-btn');
  await sleep(600);
  check('closing a set session returns to the set', /library\/sets\//.test(page.url()), page.url());

  // Listen: capture what the page asks the browser to say
  await page.evaluate(() => { window.__spoken = []; window.speechSynthesis.speak = (u) => { window.__spoken.push({ text: u.text, rate: u.rate }); }; window.speechSynthesis.cancel = () => {}; });
  await (await page.$$('.study-cta .quick-modes button'))[2].click();        // Listen
  await sleep(900);
  let spoken = await page.evaluate(() => window.__spoken);
  check('Listen: says the word on its own and never shows it', spoken.length === 1 && (await page.$('.listen-btn')) !== null && /Type what you hear/.test(await text('.review')) && !(await text('.review .flashcard')).includes(spoken[0]?.text), JSON.stringify(spoken));
  await page.click('.listen-actions .btn:nth-child(2)');                 // Slower
  await sleep(300);
  spoken = await page.evaluate(() => window.__spoken);
  check('"Slower" repeats the word at a lower speed', spoken.length === 2 && spoken[1].text === spoken[0].text && spoken[1].rate < 1, JSON.stringify(spoken));
  await page.type('.type-input', spoken[0].text);
  await page.keyboard.press('Enter');
  await sleep(400);
  check('typing what was said is correct, and the card is revealed', /Correct!/.test(await text('.type-result')) && /nghĩa mock/.test(await text('.reveal')));
  await page.keyboard.press('Enter');
  await sleep(600);
  await page.click('.skip-listen');
  await sleep(500);
  check('"I can\'t listen right now" skips without an answer', /3\/4/.test(await text('.review-top')), await text('.review-top'));
  await page.click('.review-top .icon-btn');
  await sleep(600);

  // Match: a timed game that must never touch the schedule
  await page.click('.study-cta .more-modes');
  await sleep(400);
  await page.click('[data-mode="match"]');
  await sleep(600);
  check('Match opens with a start screen', /Ready to play/.test(await text('.match-intro')) && /never changes your review schedule/.test(await text('.match-intro')));
  await page.click('.match-intro .btn.primary');
  await sleep(400);
  const pairIds = await page.$$eval('.match-tile.is-word', (els) => els.map((e) => e.dataset.pair));
  check('board: four words and four meanings', pairIds.length === 4 && (await page.$$('.match-tile.is-meaning')).length === 4);
  await page.click(`.match-tile.is-word[data-pair="${pairIds[0]}"]`);
  await page.click(`.match-tile.is-meaning[data-pair="${pairIds[1]}"]`);
  await sleep(200);
  check('a wrong pair is flagged and costs two seconds', /1 wrong · \+2s/.test(await text('.match-status')) && (await page.$$('.match-tile.wrong')).length === 2, await text('.match-status'));
  await sleep(500);
  for (const id of pairIds) { await page.click(`.match-tile.is-word[data-pair="${id}"]`); await page.click(`.match-tile.is-meaning[data-pair="${id}"]`); await sleep(120); }
  await sleep(500);
  const matchDone = await text('.summary');
  check('Match ends with a time and says it was practice only', /^\d\d:\d\d\.\d\d$/.test((await text('.match-time')).trim()) && /4 pairs · 1 wrong pair/.test(matchDone) && /Practice only/.test(matchDone) && Number((await text('.match-time')).slice(3, 5)) >= 2, matchDone.slice(0, 140));
  check('personal best is kept on the device', (await page.evaluate(() => JSON.parse(localStorage.getItem('readlex.matchBest') || '{}')['4'])) > 2000);
  await page.click('.summary-actions .btn.primary');                    // Play again
  await sleep(400);
  check('play again shows the time to beat', /Your best for 4 pairs/.test(await text('.match-intro')));
  await page.click('.review-top .icon-btn');
  await sleep(600);

  // Recall sprint: a 45-second speed round, also practice only
  await page.click('.study-cta .more-modes');
  await sleep(400);
  await page.click('[data-mode="sprint"]');
  await sleep(900);
  check('Sprint opens with rules and says it will not touch the schedule', /45-second recall sprint/.test(await text('.sprint-intro')) && /0\s*effect on your schedule/.test(await text('.sprint-rules')), await text('.sprint-rules'));
  await page.click('.sprint-intro .btn.primary');
  await sleep(400);
  const sprintAnswer = async () => {
    const hint = await text('.sprint-card .hint');
    if (/sentence/.test(hint)) return lemmaForCloze(await text('.sprint-card .cloze'));
    return ((await text('.sprint-prompt')).match(/\(([^)]+)\)\s*$/) || [])[1] || '';
  };
  const sprintOptions = await page.$$eval('.sprint-options button span', (els) => els.map((e) => e.textContent));
  check('Sprint asks for the word behind a meaning or a saved sentence, options in one language', /\d+s/.test(await text('.sprint-clock')) && sprintOptions.length >= 3 && !sprintOptions.includes('買う') && sprintOptions.includes(await sprintAnswer()), JSON.stringify(sprintOptions));
  for (let i = 0; i < 3; i++) {
    const want = await sprintAnswer();
    for (const o of await page.$$('.sprint-options button')) { if ((await o.evaluate((e) => e.querySelector('span').textContent)) === want) { await o.click(); break; } }
    await sleep(600);
  }
  check('three right answers in a row: 100 + 110 + 120 points and a streak', /330\s*pts/.test(await text('.sprint-hud')) && /3 streak/.test(await text('.sprint-hud')), await text('.sprint-hud'));
  const wrongOption = (await page.$$('.sprint-options button'))[(await page.$$eval('.sprint-options button span', (els) => els.map((e) => e.textContent))).indexOf(await sprintAnswer()) === 0 ? 1 : 0];
  await wrongOption.click();
  await sleep(600);
  check('a miss resets the streak and keeps the score', /330\s*pts/.test(await text('.sprint-hud')) && /0 streak/.test(await text('.sprint-hud')), await text('.sprint-hud'));
  await page.evaluate(() => { performance.now = ((orig) => () => orig.call(performance) + 46000)(performance.now); });   // fast-forward the clock
  await sleep(400);
  const sprintDone = await text('.summary');
  check('Sprint ends with score, accuracy, the missed word, and says it was practice only', /Sprint complete|New best/.test(sprintDone) && /330/.test(await text('.sprint-score')) && /3 correct · 75% accuracy · best streak 3/.test(sprintDone) && /Review these next/.test(sprintDone) && /Practice only/.test(sprintDone), sprintDone.slice(0, 160));
  check('Sprint best score is kept on the device', Number(await page.evaluate(() => localStorage.getItem('readlex.sprintBest'))) === 330);
  await page.click('.summary-actions .btn:not(.primary)');   // Done
  await sleep(600);
  const afterPractice = (await call('GET', '/api/v1/stats')).totals.reviews;
  check('Write, Listen, Match and Sprint on words that are not due leave the schedule alone', afterPractice === before, `${before} -> ${afterPractice}`);

  // ---- Learn: two brand-new words climb study -> meaning -> sentence -> write ----
  const fresh = [['hedge', 'hedged', 'Investors hedged against inflation.'], ['bolster', 'bolster', 'The data will bolster confidence.']];
  const freshIds = {};
  for (const [lemma, surface, sentence] of fresh) {
    const r = await call('POST', '/api/v1/sync', { op: 'vocabulary.save', payload: { vocabulary: { language: 'en', lemma, surface, quickMeaning: 'nghĩa nhanh' }, exposure: { surface, sentence, url: 'https://example.com/' + lemma, pageTitle: 'Example ' + lemma } } });
    freshIds[lemma] = r.vocabularyId;
  }
  await sleep(500);
  await call('POST', '/api/v1/enrich/run');
  known = [...SEEDS, ...fresh];
  await page.goto(`http://127.0.0.1:${WEB_PORT}/#/`, { waitUntil: 'load' });
  await sleep(1000);
  check('Today offers to continue with just the new words', /6 ?words saved/.test(await text('[data-testid="today-stats"]')) && (await hasClass('[data-testid="saved-card"]', 'is-next')) && /Keep learning 2 words saved today/.test(await text('[data-testid="saved-card"] .plan-title'))
    && /^Continue learning$/.test((await text('[data-testid="saved-card"] .btn.primary')).trim()) && (await hasClass('[data-testid="review-card"]', 'is-done')) && (await page.$('[data-testid="all-done"]')) === null && (await page.$$('[data-testid="saved-card"] .today-word-preview a:not(.more-chip)')).length === 5 && /^\+1 more$/.test((await text('[data-testid="saved-card"] .more-chip')).trim()),
    (await text('[data-testid="saved-card"]')) + ' | ' + (await text('[data-testid="today-stats"]')));
  // another session from Today that leaves the step open: its summary carries straight on into the step
  await skipThroughListen(6);
  const exitNext = await sessionExit();
  check('the summary names the step that is still open', exitNext === 'next' && /Keep learning 2 words saved today/.test(await text('.next-step .plan-title')) && /^Continue learning$/.test((await text('.next-step .btn.primary')).trim()) && (await call('GET', '/api/v1/stats')).totals.reviews === before, await text('.summary'));
  await clickCentered(page, '.next-step .btn.primary');
  await sleep(900);
  check('its button starts that step without a detour through Today: Learn, with only the 2 new words', /\/review/.test(page.url()) && /^\s*Learn · /.test(await text('.session-label')) && /Meet · 1\/2/.test(await text('.review-top')) && (await page.$('.flip-card')) !== null && (await page.$('.summary')) === null, (await text('.review-top')) + ' ' + (await text('.session-label')));
  await page.click('.review-top .icon-btn');
  await sleep(900);
  check('closing it returns to Today with the step still open', /#\/$/.test(page.url()) && (await hasClass('[data-testid="saved-card"]', 'is-next')), page.url());
  await page.click('[data-testid="saved-card"] .btn.primary');          // and the same step from Today itself
  await sleep(900);
  const steps = [], askedWords = [], ticks = [], chooseKinds = [];
  let tripped = false, writeShowsSentence = false;
  let learnFirstChecks = 0;
  for (let i = 0; i < 30 && !(await page.$('.summary')); i++) {
    const label = (await text('.phase-bar li.now')).trim();
    steps.push(label);
    ticks.push((await page.$$('.phase-bar li.done')).length);
    if (await page.$('.flip-card')) {
      askedWords.push((await text('.front-word')).trim());
      if (i === 0) learnFirstChecks += 1;
      if (i === 0) check('Learn starts with the first word\'s card, a three-phase bar on Meet, a "Meet · 1/2" counter and nothing to grade yet', label === 'Meet' && (await page.$$('.phase-bar li')).length === 3 && /Meet · 1\/2/.test(await text('.review-top')) && /Learn · /.test(await text('.session-label')) && (await page.$('.ratings')) === null && (await page.$('.exercise-foot .btn')) === null, (await text('.phase-bar')) + ' | ' + (await text('.review-top')));
      await tapCard();
      await sleep(350);
      if (i === 0) learnFirstChecks += 1;
      if (i === 0) check('after flipping, the only button is a plain "Got it"', /^Got it$/.test((await text('.exercise-foot .btn.primary')).trim()) && (await page.$$('.exercise-foot .btn')).length === 1, await text('.exercise-foot .btn.primary'));
      await page.click('.exercise-foot .btn.primary');
    } else if (await page.$('.options')) {
      const kind = await text('.review .hint');
      const askMeaning = /What does it mean/.test(kind);   // "What does it mean?" vs "Which word completes the sentence?"
      chooseKinds.push(askMeaning ? 'meaning' : /completes the sentence/.test(kind) ? 'sentence' : kind.trim());
      const word = askMeaning ? (await text('.quiz-word span')).trim() : lemmaForCloze(await text('.review .cloze'));
      askedWords.push(word);
      const wanted = askMeaning ? `(${word})` : word;
      const options = await page.$$('.options button');
      let target = null, other = null;
      for (const o of options) { const l = await o.evaluate((e) => e.querySelector('span').textContent); if (askMeaning ? l.includes(wanted) : l === wanted) target = o; else other = o; }
      if (!tripped && word === 'hedge') { tripped = true; await other.click(); } else await target.click();   // one deliberate mistake
      await sleep(300);
      await page.click('.exercise-foot .btn.primary');
    } else if (await page.$('.type-input')) {
      const word = ((await text('.quiz-q')).match(/\(([^)]+)\)\s*$/) || [])[1] || '';
      askedWords.push(word);
      if (!writeShowsSentence) writeShowsSentence = /______/.test(await text('.review .small-cloze'));
      await page.type('.type-input', word);
      await page.keyboard.press('Enter');
      await sleep(300);
      await page.keyboard.press('Enter');
    }
    await sleep(450);
  }
  check('the Learn first-step assertions actually ran', learnFirstChecks === 2, String(learnFirstChecks));
  const learnSummary = await text('.summary');
  // the whole round meets, then the whole round chooses, then the whole round writes; the missed Choose is re-asked at the end of Choose
  check('Learn runs the round in phases: Meet ×2, Choose ×3 (the miss re-asked last), Write ×2 — never back to an earlier phase', steps.join(' > ') === 'Meet > Meet > Choose > Choose > Choose > Write > Write', steps.join(' > '));
  const both = (a) => [...a].sort().join() === 'bolster,hedge';
  check('each phase covers both words; hedge comes back at the end of Choose after its miss', both(askedWords.slice(0, 2)) && both(askedWords.slice(2, 4)) && askedWords[4] === 'hedge' && both(askedWords.slice(5, 7)) && askedWords.length === 7, askedWords.join(' > '));
  check('the phase bar ticks a phase off once the whole group has passed it', ticks.join() === '0,0,1,1,1,2,2', ticks.join());
  check('Choose fills the saved sentence when the word has one; Write shows the meaning with the sentence as a hint', chooseKinds.every((k) => k === 'sentence') && chooseKinds.length === 3 && writeShowsSentence, JSON.stringify(chooseKinds));
  check('Learn summary names the word that needs another look', /Nice work/.test(learnSummary) && /2 words practiced · 7 questions · 1 without a mistake/.test(learnSummary) && /hedge\s*1 miss · rated Hard/.test(learnSummary), learnSummary.slice(0, 160));
  const hedge = await call('GET', `/api/v1/vocabulary/${freshIds.hedge}`);
  const bolster = await call('GET', `/api/v1/vocabulary/${freshIds.bolster}`);
  check('Learn sends exactly one review per word: Hard after a miss, Good after a clean run', hedge.reviews.length === 1 && hedge.reviews[0].rating === 2 && bolster.reviews.length === 1 && bolster.reviews[0].rating === 3 && (await call('GET', '/api/v1/stats')).totals.reviews === before + 2, JSON.stringify([hedge.reviews.map((r) => r.rating), bolster.reviews.map((r) => r.rating)]));
  // both new words are scheduled now, so today's plan is finished again and the summary just leads back
  const exitLearn = await sessionExit();
  check('Learn summary: nothing left open, so only the way back (the "Worth another look" practice stays a secondary button)', exitLearn === 'back' && /^Back to Today$/.test((await text('.summary > .btn.primary')).trim()) && /Practice this word again$/.test(await text('.summary-list .btn')) && (await page.$$('.summary .btn.primary')).length === 1, await text('.summary'));
  await clickCentered(page, '.summary > .btn.primary');
  await sleep(900);

  // ---- a finished step still offers practice, through the slimmer picker ----
  check('a finished step keeps a "Practice again" button that opens the picker for all of today\'s words', (await hasClass('[data-testid="saved-card"]', 'is-done')) && /Learned 6 words saved today/.test(await text('[data-testid="saved-card"]')) && (await page.$('[data-testid="saved-card"] .more-modes')) === null && /^Practice again$/.test((await text('[data-testid="saved-card"] .btn')).trim()), await text('[data-testid="saved-card"]'));
  await page.click('[data-testid="saved-card"] .btn');                  // Practice again
  await sleep(400);
  check('…and the picker is for those 6 words: six modes, all available, no quiz or context mode', /· 6 words/.test(await text('.sheet-head')) && (await page.$$('[data-mode]:not([disabled])')).length === 6 && (await page.$('[data-mode="quiz"]')) === null && (await page.$('[data-mode="context"]')) === null, await text('.sheet-head'));
  await page.keyboard.press('Escape');
  await sleep(300);

  // ---- Progress ----
  const todaysCards = (await call('GET', `/api/v1/sets/${(await call('GET', '/api/v1/sets')).today}`)).cards;
  const curbCard = todaysCards.find((k) => k.lemma === 'curb');
  await call('POST', '/api/v1/reviews', { reviews: [{ cardId: curbCard.cardId, rating: 1 }, { cardId: curbCard.cardId, rating: 1 }] });
  await page.goto(`http://127.0.0.1:${WEB_PORT}/#/progress`, { waitUntil: 'load' });
  await sleep(1200);
  const tiles = await text('[data-testid="progress-summary"]');
  // the words that need attention are listed with their meanings, which are Vietnamese content, not UI
  uiText.progress = await page.evaluate(() => { const c = document.body.cloneNode(true); c.querySelectorAll('.attention-list .m').forEach((e) => e.remove()); return c.textContent; });
  check('Progress: streak, words learned, recall rate, reviews this week', /1day streak/.test(tiles) && /6words learned/.test(tiles) && /\d+%recall rate/.test(tiles) && /\d+reviews this week/.test(tiles), tiles);
  check('Progress: learning stages without calling anything "mastered"', /New/.test(await text('[data-testid="learning-progress"]')) && /Learning/.test(await text('[data-testid="learning-progress"]')) && /Long-term review/.test(await text('[data-testid="learning-progress"]')) && !/master/i.test(await text('.page')));
  const gridCards = await page.$$eval('.progress-grid > section.card', (els) => els.map((e) => e.dataset.testid || ''));
  check('Progress: every card after the summary tiles sits in one grid', JSON.stringify(gridCards) === JSON.stringify(['learning-progress', 'activity', 'recall', 'needs-attention']) && (await page.$$('.progress-page section.card')).length === gridCards.length && (await page.$('.progress-grid .summary-tiles')) === null && (await page.$('.progress-page > .summary-tiles')) !== null, JSON.stringify(gridCards));
  check('Progress: a 12-week activity heatmap with today filled in', (await page.$$('.heat-week i:not(.pad)')).length === 84 && (await page.$$('.heat-week i.l4')).length === 1);
  check('Progress: recall rate shows the three windows without a footnote', /Last 7 days/.test(await text('[data-testid="recall"]')) && !/not an exact measure/.test(await text('[data-testid="recall"]')));
  const attention = await text('[data-testid="needs-attention"]');
  check('Progress: words missed repeatedly need attention', /curb/.test(attention) && /Again [23]×/.test(attention), attention.slice(0, 160));
  await page.click('[data-testid="needs-attention"] .btn.primary');
  await sleep(400);
  check('"Practice difficult words" opens the mode picker for those words', /^Practice difficult words$/.test((await text('[data-testid="needs-attention"] .btn.primary')).trim()) && /Difficult words · \d+ words?/.test(await text('.sheet-head')) && (await page.$$('[data-mode]')).length === 6);
  await page.keyboard.press('Escape');
  await sleep(300);

  // word detail, progress, settings
  await page.goto(`http://127.0.0.1:${WEB_PORT}/#/library`, { waitUntil: 'load' });
  await sleep(800);
  await page.type('.search-box input', 'sustain');
  await sleep(600);
  check('search results offer the same delete', (await page.$$('.word-list li.with-action .icon-btn.danger')).length === 1);
  await page.click('.word-list li .w');
  await sleep(700);
  const detail = await text('.page');
  check('word detail in English with exposure + schedule', /Where you met this word 1/.test(detail) && /Review schedule/.test(detail) && /\d+ reviews?/.test(detail), detail.slice(0, 80));

  // edit the word
  await page.click('button[aria-label="Edit word"]');
  await sleep(300);
  uiText.wordEdit = await uiLabels();
  const meaningInput = (await page.$$('.edit-word input'))[1];
  await clearInput(meaningInput);
  await meaningInput.type('my own meaning');
  await page.type('.edit-word textarea', 'remember this one');
  await page.click('.edit-word .btn.primary');
  await sleep(800);
  check('edited meaning and note are shown', /my own meaning/.test(await text('.meaning')) && /remember this one/.test(await text('.page')) && (await page.$('.edit-word')) === null, await text('.meaning'));

  // My Sets: create, add words, rename, remove a word, membership chip, delete
  await page.goto(`http://127.0.0.1:${WEB_PORT}/#/library/my`, { waitUntil: 'load' });
  await sleep(600);
  check('/library/my opens the Library with an empty My Sets section (no tabs)', /No sets yet/.test(await text('.library-cols > section:nth-child(1)')) && (await page.$('.tabs')) === null && (await page.$('.library-cols')) !== null && (await page.$('.set-composer')) === null);
  await page.click('.set-create-bar .btn.primary');
  await sleep(300);
  check('Create set opens a term–meaning composer with two empty rows', (await page.$$('.composer-row')).length === 2 && /Create flashcards/.test(await text('.set-composer')) && (await page.$$('.composer-columns span')).length === 3);
  await page.type('.set-composer input.input', 'Economy words');
  const rowInputs = async (i) => page.$$eval('.composer-row', (rows, i) => rows[i] && [...rows[i].querySelectorAll('input')].length, i);
  await page.type('.composer-row:nth-child(1) .composer-input:nth-of-type(1)', 'ledger');
  const rowMeaning = async (n) => page.$eval(`.composer-row:nth-child(${n}) .composer-input:nth-of-type(2)`, (i) => i.value);
  check('the AI button waits for a term, and each row has one', (await page.$$('.composer-magic')).length === 2 && (await page.$eval('.composer-row:nth-child(2) .composer-magic', (b) => b.disabled)) === true && (await page.$eval('.composer-row:nth-child(1) .composer-magic', (b) => b.disabled)) === false);
  await page.click('.composer-row:nth-child(1) .composer-magic');
  await sleep(1200);
  check('the per-row AI button fills only its own row', (await rowMeaning(1)) === 'nghĩa mock của ledger' && (await rowMeaning(2)) === '', JSON.stringify([await rowMeaning(1), await rowMeaning(2)]));
  check('and warns that a demo server is answering, not the user\'s key', /fake Gemini/.test(await text('.set-composer .ai-notice')), await text('.set-composer .ai-notice'));
  const insight = await text('.set-composer .word-insight');
  check('the AI also explains when to use the word and when not to', /mock definition/.test(insight) && /When to use it · Mock usage note for ledger/.test(insight) && /When not to · Do not use ledger/.test(insight) && /A mock sentence with ledger/.test(insight), insight.slice(0, 200));
  await page.click('.set-composer .insight-close');
  await sleep(200);
  check('the explanation can be dismissed without touching the meaning', (await page.$('.set-composer .word-insight')) === null && (await rowMeaning(1)) === 'nghĩa mock của ledger');
  await clearInput(await page.$('.composer-row:nth-child(1) .composer-input:nth-of-type(2)'));
  await page.type('.composer-row:nth-child(1) .composer-input:nth-of-type(2)', 'sổ cái');
  await page.keyboard.press('Enter');
  await sleep(150);
  check('Enter in the last field moves to the next row', await page.evaluate(() => document.activeElement === document.querySelectorAll('.composer-row .composer-input')[2]));
  await page.keyboard.type('audit');
  await page.type('.composer-row:nth-child(2) .composer-input:nth-of-type(2)', 'kiểm toán');
  await page.keyboard.press('Enter');
  await sleep(150);
  check('Enter on the last row adds a new one', (await page.$$('.composer-row')).length === 3 && (await rowInputs(2)) === 2);
  await page.select('.composer-language select', 'ja');
  await sleep(150);
  check('Japanese sets get a reading column', (await page.$$('.composer-columns span')).length === 4 && (await rowInputs(0)) === 3);
  await page.select('.composer-language select', 'en');
  // the button can end up behind the fixed bottom nav (it did once the label got longer); a person would scroll, so does the test
  await clickCentered(page, '.composer-foot .btn.primary');
  await sleep(1500);
  check('creating a set with two typed cards opens it with those words in the library too', /library\/my\//.test(page.url()) && /Economy words/.test(await text('h1')) && (await page.$$('.word-list li.with-action')).length === 2 && /ledger/.test(await text('.word-list')) && /sổ cái/.test(await text('.word-list')) && (await call('GET', '/api/v1/vocabulary')).total === 8, JSON.stringify([page.url(), await text('.lead'), (await page.$$('.word-list li.with-action')).length, await text('.word-list'), (await call('GET', '/api/v1/vocabulary')).total, await text('.set-composer .error'), await text('.composer-foot'), failedResponses.slice(-3)]));
  await page.click('.section-head .btn');
  await sleep(500);
  check('"Add words" opens on typing new words, with the library as the other option', (await page.$('.add-words .word-rows')) !== null && /Type new words/.test(await text('.add-words .segmented')) && /Pick from library/.test(await text('.add-words .segmented')) && (await page.$('.pick-list')) === null && (await page.$('.section-head .btn')) === null);
  await page.type('.add-words .composer-row:nth-child(1) .composer-input:nth-of-type(1)', 'invoice');
  await page.type('.add-words .composer-row:nth-child(2) .composer-input:nth-of-type(1)', 'xxxxx');
  check('the bulk button counts the rows still missing a meaning', /Fill 2 meanings with AI/.test(await text('.add-words .composer-ai')), await text('.add-words .composer-ai'));
  await clickCentered(page, '.add-words .composer-ai');
  await sleep(1500);
  const addWordsMeaning = async (n) => page.$eval(`.add-words .composer-row:nth-child(${n}) .composer-input:nth-of-type(2)`, (i) => i.value);
  check('one call fills every empty meaning and says which word it could not place', (await addWordsMeaning(1)) === 'nghĩa mock của invoice' && (await addWordsMeaning(2)) === '' && /No meaning came back for “xxxxx”/.test(await text('.add-words .ai-notice')) && /fake Gemini/.test(await text('.add-words .ai-notice')), JSON.stringify([await addWordsMeaning(1), await addWordsMeaning(2), await text('.add-words .ai-notice')]));
  await clearInput(await page.$('.add-words .composer-row:nth-child(2) .composer-input:nth-of-type(1)'));
  await clearInput(await page.$('.add-words .composer-row:nth-child(1) .composer-input:nth-of-type(2)'));
  await page.type('.add-words .composer-row:nth-child(1) .composer-input:nth-of-type(2)', 'hóa đơn');
  // a meaning typed by hand is never sent and never overwritten
  await page.type('.add-words .composer-row:nth-child(2) .composer-input:nth-of-type(1)', 'receipt');
  check('only the rows still missing a meaning are offered to the AI', /Fill the meaning with AI/.test(await text('.add-words .composer-ai')), await text('.add-words .composer-ai'));
  await clickCentered(page, '.add-words .composer-ai');
  await sleep(1500);
  check('the AI fills the empty row and leaves the typed meaning alone', (await addWordsMeaning(1)) === 'hóa đơn' && (await addWordsMeaning(2)) === 'nghĩa mock của receipt', JSON.stringify([await addWordsMeaning(1), await addWordsMeaning(2)]));
  await clearInput(await page.$('.add-words .composer-row:nth-child(2) .composer-input:nth-of-type(1)'));
  await clearInput(await page.$('.add-words .composer-row:nth-child(2) .composer-input:nth-of-type(2)'));
  await page.$eval('.add-words .composer-foot .btn.primary', (b) => b.scrollIntoView({ block: 'center' }));
  check('the button counts the typed words', /Add 1 word/.test(await text('.add-words .composer-foot .btn.primary')));
  await page.click('.add-words .composer-foot .btn.primary');
  await sleep(1500);
  check('a typed word joins the set and the library, panel stays open for more', (await page.$$('.word-list li.with-action')).length === 3 && /invoice/.test(await text('.word-list')) && /hóa đơn/.test(await text('.word-list')) && /1 word added to this set so far/.test(await text('.add-words')) && (await call('GET', '/api/v1/vocabulary')).total === 9 && (await page.$('.add-words .word-rows')) !== null, JSON.stringify([await text('.lead'), await text('.add-words .composer-foot')]));
  await clickCentered(page, '.add-words .segmented button:nth-child(2)');
  await sleep(700);
  await page.type('.picker input.input', 'adds');
  await sleep(600);
  check('a library search with no match offers to type that word', /Nothing in your library matches “adds”/.test(await text('.pick-list')) && /Add “adds” as a new word/.test(await text('.pick-empty .btn')));
  uiText.picker = await uiLabels();
  await clickCentered(page, '.pick-empty .btn');
  await sleep(300);
  check('…which switches back to typing with the term filled in', (await page.$eval('.add-words .composer-row:nth-child(1) .composer-input:nth-of-type(1)', (i) => i.value)) === 'adds');
  await clickCentered(page, '.add-words .segmented button:nth-child(2)');
  await sleep(700);
  const boxes = await page.$$('.pick-list input[type="checkbox"]');
  await boxes[0].click(); await boxes[1].click();
  // the short list leaves the Add button behind the fixed bottom nav; a person would scroll, so does the test
  await page.$eval('.picker .btn.primary', (b) => b.scrollIntoView({ block: 'center' }));
  const pickLabel = await text('.picker .btn.primary');
  await page.click('.picker .btn.primary');
  await sleep(1200);
  check('two more words added from the library', (await page.$$('.word-list li.with-action')).length === 5 && /^\s*5 words\s*$/.test(await text('.lead')) && /^\s*Add 2 words\s*$/.test(pickLabel) && (await page.$('.add-words')) === null, JSON.stringify([await text('.lead'), pickLabel, failedResponses]));
  check('custom set has the same study actions and progress', (await page.$('.study-cta .btn.primary:not([disabled])')) !== null && (await page.$$('.study-cta .quick-modes button')).length === 4 && (await page.$('[data-testid="set-progress"]')) !== null);
  await call('POST', '/api/v1/enrich/run');
  await sleep(600);
  await page.reload({ waitUntil: 'load' });
  await sleep(900);
  await (await page.$$('.study-cta .quick-modes button'))[0].click();     // Flashcards
  await sleep(800);
  await tapCard();
  await sleep(500);
  const typedBack = await text('.back-face');
  check('a hand-typed word shows the AI example instead of an empty context slot', /AI example/.test(typedBack) && /Mock example sentence/.test(typedBack) && !/Where you met it/.test(typedBack), typedBack.slice(0, 160));
  await page.click('.review-top .icon-btn');
  await sleep(700);
  await page.click('button[aria-label="Rename set"]');
  await sleep(200);
  await clearInput(await page.$('.title-edit input'));
  await page.type('.title-edit input', 'Markets');
  await page.keyboard.press('Enter');
  await sleep(600);
  check('set renamed', /^Markets$/.test((await text('h1')).trim()));
  await page.click('.word-list li.with-action .icon-btn');
  await sleep(600);
  check('removing a word from the set', (await page.$$('.word-list li.with-action')).length === 4);
  await page.click('.word-list li.with-action .w');
  await sleep(800);
  check('word page shows its set as selected', (await page.$$('.chips.selectable button.on')).length === 1 && /Markets/.test(await text('.chips.selectable')));
  await page.goBack(); await sleep(700);
  await page.click('button[aria-label="Delete set"]');
  await sleep(400);
  check('deleting a set says what happens to its words and offers both ways', /Its 4 words stay in your Library/.test(await text('.delete-confirm')) && (await page.$$('.delete-confirm .btn')).length === 3 && /^Delete set, keep the words$/.test((await text('.delete-confirm .btn')).trim()) && /^Delete set and its 4 words$/.test((await text('.delete-confirm .btn.danger')).trim()), await text('.delete-confirm'));
  await page.click('.delete-confirm .btn');   // "Delete set, keep the words"
  await sleep(900);
  check('deleting the set returns to the Library and keeps the words', /#\/library/.test(page.url()) && /No sets yet/.test(await text('.page')) && (await call('GET', '/api/v1/vocabulary')).total === 9, page.url());

  // add a word by hand, then delete it
  await page.goto(`http://127.0.0.1:${WEB_PORT}/#/library`, { waitUntil: 'load' });
  await sleep(600);
  await page.click('.library-search .btn');
  await sleep(300);
  uiText.addWord = await uiLabels();
  await page.type('.add-word input', 'Tariff');
  await (await page.$$('.add-word input'))[1].type('The new tariff hit exporters hard.');
  await page.click('.add-word .ai-btn');
  await sleep(1200);
  check('Add word can fill its meaning with AI too', (await page.$eval('.add-word .ai-field input', (i) => i.value)) === 'nghĩa mock của Tariff', await page.$eval('.add-word .ai-field input', (i) => i.value));
  await page.click('.add-word .btn.primary');
  await sleep(1200);
  check('hand-added word opens its page with the sentence', /^tariff/.test((await text('.detail-word')).trim()) && /hit exporters/.test(await text('.exposure')) && (await call('GET', '/api/v1/vocabulary')).total === 10, await text('.detail-word'));
  await page.click('button[aria-label="Delete word"]');
  await sleep(1000);
  check('deleting a word returns to the library', /#\/library$/.test(page.url()) && (await call('GET', '/api/v1/vocabulary')).total === 9, page.url());

  await page.goto(`http://127.0.0.1:${WEB_PORT}/#/settings`, { waitUntil: 'load' });
  await sleep(800);
  // the queue belongs to an account: another user's unsent ratings must be invisible here, and must
  // not be shipped off under this login
  const fakeEntry = JSON.stringify([{ id: 'x1', cardId: 'someone-elses-card', rating: 3, durationMs: 100, reviewedAt: Date.now() }]);
  await page.evaluate((v) => localStorage.setItem('readlex.reviewQueue:someone.else@example.com', v), fakeEntry);
  await page.reload({ waitUntil: 'load' });
  await sleep(900);
  check("another account's queued ratings are not visible or sent under this login", /Everything is up to date/.test(await text('.settings')) && (await page.evaluate(() => localStorage.getItem('readlex.reviewQueue:someone.else@example.com'))) === fakeEntry, await text('.settings'));
  await page.evaluate((v) => localStorage.setItem('readlex.reviewQueue:seed@example.com', v), fakeEntry);
  await page.reload({ waitUntil: 'load' });
  await sleep(900);
  check('this account\'s own queue is shown and can be sent', /1 review is waiting to be sent/.test(await text('.settings')) && /Send now/.test(await text('.settings')), await text('.settings'));
  await page.evaluate(() => { localStorage.removeItem('readlex.reviewQueue:someone.else@example.com'); localStorage.removeItem('readlex.reviewQueue:seed@example.com'); });
  await page.reload({ waitUntil: 'load' });
  await sleep(800);
  const settingsText = await text('.page');
  const sections = await page.$$eval('.settings-section h2', (els) => els.map((e) => e.textContent));
  check('Settings sections (no App section)', JSON.stringify(sections) === JSON.stringify(['Account', 'AI assistance', 'Learning', 'Pronunciation', 'Data & Sync', 'Danger zone']), JSON.stringify(sections));
  check('no information-only rows: no time zone, no algorithm blurb, no daily new-word limit, no extension or install how-tos', !/Time zone/.test(settingsText) && !/FSRS/.test(settingsText) && !/420/.test(settingsText) && !/per day/i.test(settingsText)
    && !/Browser extension/.test(settingsText) && !/Set up the extension/.test(settingsText) && !/Install ReadLex/.test(settingsText) && /Sync status/.test(settingsText));
  check('the flashcard front is a Learning setting, Word by default', /Flashcard front/.test(settingsText) && (await page.$eval('select[aria-label="Flashcard front"]', (el) => el.value)) === 'word');
  // The UI is English: no Vietnamese label may be left. Today, Progress and Settings are checked whole; the
  // other screens show the learner's own Vietnamese meanings (content, not UI), so only their labels are checked.
  uiText.settings = await page.evaluate(() => document.body.innerText);
  const VIETNAMESE = /\S*([ăâđêôơưĂÂĐÊÔƠƯ]|[àáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]|[ằắẳẵặầấẩẫậềếểễệồốổỗộờớởỡợừứửữự])\S*/;
  const leftovers = Object.entries(uiText).map(([where, body]) => [where, (body.match(VIETNAMESE) || [''])[0]]).filter(([, hit]) => hit);
  check('no Vietnamese UI labels left (Today, Progress, Settings; control labels on set, word, picker and add-word screens)', Object.keys(uiText).length === 7 && Object.values(uiText).every((body) => body.length > 40) && leftovers.length === 0, JSON.stringify(leftovers));
  await page.select('select[aria-label="Flashcard front"]', 'meaning');
  await sleep(200);
  check('choosing Meaning is kept in the config', (await page.evaluate(() => JSON.parse(localStorage.getItem('readlex.config')).flashDirection)) === 'meaning');
  await page.goto(`http://127.0.0.1:${WEB_PORT}/#/library/sets/${(await call('GET', '/api/v1/sets')).today}`, { waitUntil: 'load' });
  await sleep(900);
  await (await page.$$('.study-cta .quick-modes button'))[0].click();     // Flashcards
  await sleep(800);
  check('Flashcards then start on the meaning side, still with no direction control on the screen', (await page.$('.front-meaning')) !== null && (await page.$('.front-word')) === null && (await page.$('.review .segmented')) === null && !(await isBack()), await text('.front-face'));
  await page.click('.review-top .icon-btn');
  await sleep(500);
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
} catch (err) {
  check('unexpected error', false, err.stack || String(err));
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const p of [api, web]) stopProcessTree(p);
  await sleep(800);
  for (const p of [api, web]) stopProcessTree(p, true);
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed) console.log('--- logs ---\n' + logs.slice(-1200));
process.exit(failed ? 1 : 0);
