// End-to-end smoke test: launches real Chrome with the unpacked extension and exercises
// hover, selection, save, context-menu path, Gemini enrichment (mocked) and the extension pages.
//
//   node scripts/smoke-test.mjs            # mocks Google / Dictionary / Gemini inside the service worker
//   node scripts/smoke-test.mjs --live     # real network (needs internet + a Gemini key in settings)
//
// Requires google-chrome and puppeteer-core (npm i puppeteer-core in ./scripts or set NODE_PATH).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const LIVE = process.argv.includes('--live');
const HEADLESS = !process.argv.includes('--headed');

async function loadPuppeteer() {
  // 1) normal resolution (installed in the project or a parent directory)
  try { return (await import('puppeteer-core')).default; } catch (_) { /* fall through */ }
  // 2) explicit directory containing node_modules (PUPPETEER_DIR=/path/to/dir)
  const dirs = [process.env.PUPPETEER_DIR, path.join(__dirname, '..'), __dirname].filter(Boolean);
  for (const dir of dirs) {
    const pkgPath = path.join(dir, 'node_modules', 'puppeteer-core', 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    let entry = pkg.exports?.['.']?.import ?? pkg.exports?.['.']?.default ?? pkg.module ?? pkg.main;
    if (entry && typeof entry === 'object') entry = entry.default || entry.node;
    const mod = await import(pathToFileURL(path.join(path.dirname(pkgPath), entry)).href);
    return mod.default || mod;
  }
  throw new Error('puppeteer-core not found. Run: npm i puppeteer-core (or set PUPPETEER_DIR=/dir/with/node_modules)');
}
const puppeteer = await loadPuppeteer();
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- static server for the fixture article ---
const server = http.createServer((req, res) => {
  const file = path.join(__dirname, 'fixtures', 'article.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PAGE_URL = `http://127.0.0.1:${server.address().port}/article.html`;

const userDataDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'readlex-profile-'));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: HEADLESS,
  userDataDir,
  pipe: true,                       // Extensions.loadUnpacked needs the pipe transport
  enableExtensions: true,
  args: ['--enable-unsafe-extension-debugging', '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--window-size=1200,900'],
  defaultViewport: { width: 1200, height: 900 },
});

try {
  const installedId = await browser.installExtension(EXT);
  check('extension installed via CDP', !!installedId, installedId);
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  check('service worker started', true, extId);
  const worker = await swTarget.worker();

  // settings: fake key so the enrichment queue runs (mocked)
  await worker.evaluate(async (live) => {
    const { settings } = await chrome.storage.local.get('settings');
    const next = { ...(settings || {}), hoverDelay: 300 };
    if (!live) next.geminiApiKey = 'TEST-KEY';
    await chrome.storage.local.set({ settings: next });
  }, LIVE);

  if (!LIVE) {
    await worker.evaluate(() => {
      const real = self.fetch.bind(self);
      const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
      self.__mockCalls = { google: 0, dict: 0, gemini: 0 };
      self.fetch = async (url, init) => {
        const u = String(url);
        if (u.startsWith('https://api.readlex.test/')) {
          self.__mockCalls.backend = self.__mockCalls.backend || [];
          const path = new URL(u).pathname;
          const auth = (init && init.headers && init.headers.Authorization) || '';
          self.__mockCalls.backend.push({ path, method: (init && init.method) || 'GET', auth, body: init && init.body ? JSON.parse(init.body) : null });
          if (path === '/api/v1/auth/login') { const b = init && init.body ? JSON.parse(init.body) : {}; return b.password === 'pw12345678' ? json({ ok: true, token: 'test-token', user: { email: b.email, hasGeminiKey: true } }) : json({ ok: false, error: 'Incorrect email or password' }, 401); }
          if (path === '/api/v1/health') return json({ ok: true, version: '0.2.0', mock: false, signup: 'invite' });
          if (auth !== 'Bearer test-token') return json({ ok: false, error: 'Chưa đăng nhập' }, 401);
          if (path === '/api/v1/auth/me') return json({ ok: true, user: { email: 'me@example.com', hasGeminiKey: true }, session: { kind: 'extension' } });
          if (path === '/api/v1/sync') return json({ ok: true, vocabularyId: 'srv-' + (self.__mockCalls.backend.length), created: true });
          if (path.startsWith('/api/v1/vocabulary/srv-')) return json({ ok: true, vocabulary: { id: path.split('/').pop(), enrichmentStatus: 'done', ipa: '/srv/', reading: '', enrichment: { lemma: 'server', meaningVi: 'nghĩa từ server', meaningInContext: 'nghĩa server trong câu', cefr: 'C1', collocations: [], example: '', exampleVi: '', synonyms: [], wordFamily: [], notes: '', learningPriority: 5, isProperNoun: false, partOfSpeech: 'noun', ipa: '/srv/', sentenceVi: '', definitionEn: '', reading: '', level: '' } } });
          return json({ ok: false, error: 'not mocked' }, 404);
        }
        if (u.includes('clients5.google.com')) {
          self.__mockCalls.google++;
          const params = new URL(u).searchParams;
          return json([(params.get('sl') === 'ja' ? 'MOCKJA ' : 'MOCK ') + params.get('q')]);
        }
        if (u.includes('translate.googleapis.com')) {
          self.__mockCalls.google++;
          const q = new URL(u).searchParams.get('q');
          return json({ sentences: [{ trans: 'MOCK ' + q, orig: q }], dict: q.includes(' ') ? [] : [{ pos: 'verb', terms: ['duy trì', 'giữ vững'], base_form: q }], src: 'en' });
        }
        if (u.includes('dictionaryapi.dev')) {
          self.__mockCalls.dict++;
          return json([{ word: 'x', phonetics: [{ text: '/mɒk/', audio: 'https://example.com/a-us.mp3' }], meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'mock definition' }] }] }]);
        }
        if (u.includes('generativelanguage.googleapis.com')) {
          self.__mockCalls.gemini++;
          const prompt = JSON.parse(init.body).contents[0].parts[0].text;
          const m = prompt.match(/Target[^:]*: "([^"]+)"/);
          const g = prompt.match(/(?:Guessed base form|Dictionary form guess): "([^"]+)"/);
          const target = (m ? m[1] : 'word').toLowerCase();
          const lemma = g ? g[1] : target.endsWith('s') ? target.slice(0, -1) : target;
          const data = { lemma, partOfSpeech: 'noun', ipa: '/ˈmɒk/', meaningVi: 'nghĩa mock', meaningInContext: 'nghĩa mock trong câu', sentenceVi: 'Câu dịch mock.', definitionEn: 'mock definition', cefr: 'B2', collocations: [lemma + ' growth'], example: 'Mock example sentence here.', exampleVi: 'Ví dụ mock.', synonyms: ['x'], wordFamily: [lemma + 'able'], notes: 'Ghi chú mock.', learningPriority: 4, isProperNoun: false };
          return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP' }] });
        }
        return real(url, init);
      };
    });
    check('network mocked in service worker', true);
  }

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await sleep(800);

  // helper: center of a word inside a paragraph
  const wordCenter = (pid, word) => page.evaluate((pid, word) => {
    const p = document.getElementById(pid);
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.data.indexOf(word);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(node, i); r.setEnd(node, i + word.length);
        const b = r.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }
    }
    return null;
  }, pid, word);

  const readUi = () => page.evaluate(() => {
    const host = document.getElementById('readlex-host');
    if (!host || !host.shadowRoot) return { host: false };
    const popup = host.shadowRoot.querySelector('.rl-popup');
    const toast = host.shadowRoot.querySelector('.rl-toast');
    const btn = host.shadowRoot.querySelector('.rl-btn');
    return {
      host: true,
      popupVisible: popup && !popup.hidden,
      popupText: popup ? popup.textContent : '',
      popupStyle: popup ? { left: popup.style.left, top: popup.style.top } : null,
      toastVisible: toast && !toast.hidden,
      toastText: toast ? toast.textContent : '',
      buttonVisible: btn && !btn.hidden,
    };
  });
  const clickShadow = (selector) => page.evaluate((sel) => {
    const el = document.getElementById('readlex-host')?.shadowRoot?.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);

  // 0. sentence hover (default target, tudienjp style): one Google call per sentence, cached
  let ui;
  const cs = await wordCenter('p1', 'government');
  await page.mouse.move(cs.x - 30, cs.y - 30);
  await sleep(60);
  await page.mouse.move(cs.x, cs.y);
  await sleep(60);
  await page.mouse.move(cs.x + 1, cs.y);
  await sleep(1500);
  ui = await readUi();
  check('sentence hover shows the whole sentence translated', ui.host && ui.popupVisible && (LIVE ? ui.popupText.length > 20 : /^MOCK The economy remains resilient even as the government imposed sweeping tariffs on imports\.$/.test(ui.popupText.trim())), ui.popupText.slice(0, 120));
  if (!LIVE) {
    const calls = await worker.evaluate(() => self.__mockCalls);
    check('sentence hover: exactly one Google call, no dictionary API, no Gemini', calls.google === 1 && calls.dict === 0 && calls.gemini === 0, JSON.stringify(calls));
  }
  const cs2 = await wordCenter('p1', 'Officials');
  await page.mouse.move(cs2.x, cs2.y);
  await sleep(60);
  await page.mouse.move(cs2.x + 1, cs2.y);
  await sleep(1500);
  ui = await readUi();
  check('moving to the next sentence replaces the translation', ui.popupVisible && /Officials said the measures/.test(ui.popupText), ui.popupText.slice(0, 80));
  await page.mouse.move(20, 850);
  await sleep(500);
  ui = await readUi();
  check('sentence popup hides when leaving the text', !ui.popupVisible);

  // Japanese sentence: Google with sl=ja
  const cj = await wordCenter('p4', '本を');
  await page.mouse.move(cj.x, cj.y);
  await sleep(60);
  await page.mouse.move(cj.x + 1, cj.y);
  await sleep(1500);
  ui = await readUi();
  check('Japanese sentence hover translated with sl=ja', ui.popupVisible && (LIVE ? ui.popupText.length > 5 : /^MOCKJA 私は昨日新しい本を買いました。$/.test(ui.popupText.trim())), ui.popupText.slice(0, 80));
  await page.mouse.move(20, 850);
  await sleep(400);

  // "both" mode: sentence + hovered word line (offline)
  await worker.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, hoverTarget: 'both' } }); });
  await sleep(300);
  await page.mouse.move(cs.x, cs.y);
  await sleep(60);
  await page.mouse.move(cs.x + 1, cs.y);
  await sleep(1200);
  ui = await readUi();
  check('both mode: sentence translation + word line', ui.popupVisible && /MOCK The economy remains/.test(ui.popupText) && /government/.test(ui.popupText) && /chính phủ/.test(ui.popupText), ui.popupText.slice(0, 160));
  await page.mouse.move(20, 850);
  await sleep(400);

  // rest of the test exercises word hover
  await worker.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, hoverTarget: 'word' } }); });
  await sleep(300);
  const beforeJa = LIVE ? null : await worker.evaluate(() => ({ ...self.__mockCalls }));

  // Japanese word hover: 買 inside 買いました -> 買う【かう】, fully offline
  const cjw = await wordCenter('p4', '買');
  await page.mouse.move(cjw.x - 30, cjw.y - 30);
  await sleep(60);
  await page.mouse.move(cjw.x, cjw.y);
  await sleep(60);
  await page.mouse.move(cjw.x + 1, cjw.y);
  await sleep(1200);
  ui = await readUi();
  check('Japanese word hover: 買いました -> 買う【かう】 with inflection trail and Vietnamese gloss', ui.popupVisible && /買う/.test(ui.popupText) && /【かう】/.test(ui.popupText) && /quá khứ lịch sự/.test(ui.popupText) && /mua/.test(ui.popupText), ui.popupText.slice(0, 120));
  const jaHighlight = await page.evaluate(() => { try { return CSS.highlights && CSS.highlights.has('readlex-word'); } catch (_) { return false; } });
  check('matched Japanese word is highlighted in the page', jaHighlight === true);
  if (!LIVE) {
    const calls = await worker.evaluate(() => self.__mockCalls);
    check('Japanese word hover is fully offline', calls.google === beforeJa.google && calls.dict === beforeJa.dict && calls.gemini === beforeJa.gemini, JSON.stringify(calls));
  }
  await clickShadow('.rl-save');
  await sleep(700);
  ui = await readUi();
  check('Japanese word saved under its dictionary form', /Đã lưu “買う”/.test(ui.toastText), ui.toastText);
  await page.mouse.move(20, 850);
  await sleep(400);
  const before = LIVE ? null : await worker.evaluate(() => ({ ...self.__mockCalls }));

  // 1. hover
  const c1 = await wordCenter('p1', 'resilient');
  check('fixture word located', !!c1);
  await page.mouse.move(c1.x - 30, c1.y - 30);
  await sleep(60);
  await page.mouse.move(c1.x, c1.y);
  await sleep(60);
  await page.mouse.move(c1.x + 1, c1.y);
  await sleep(1200);
  ui = await readUi();
  check('hover popup appears', ui.host && ui.popupVisible, ui.popupText.slice(0, 80));
  check('hover popup shows offline entry (IPA + part of speech + meaning)', /resilient/.test(ui.popupText) && ui.popupText.includes("/ri'ziliənt/") && /tính từ/.test(ui.popupText) && /đàn hồi/.test(ui.popupText));
  if (!LIVE) {
    const calls = await worker.evaluate(() => self.__mockCalls);
    check('word hover is fully offline (no translate / dictionary call)', calls.google === before.google && calls.dict === before.dict, JSON.stringify(calls));
  }

  // 2. save from hover popup
  check('save button present', await clickShadow('.rl-save'));
  await sleep(700);
  ui = await readUi();
  check('toast confirms save', ui.toastVisible && /Đã lưu/.test(ui.toastText), ui.toastText);

  // 3. move away → popup hides
  await page.mouse.move(20, 850);
  await sleep(500);
  ui = await readUi();
  check('popup hides when mouse leaves', !ui.popupVisible);

  // 4. double-click selection
  const c2 = await wordCenter('p1', 'tariffs');
  await page.mouse.move(c2.x, c2.y);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
  await sleep(1000);
  const selText = await page.evaluate(() => window.getSelection().toString());
  check('double-click selects the word', selText.trim() === 'tariffs', JSON.stringify(selText));
  ui = await readUi();
  check('double-click selection popup (inflected form resolved offline)', ui.popupVisible && /tariffs/.test(ui.popupText) && /thuế quan/.test(ui.popupText), ui.popupText.slice(0, 80));
  await clickShadow('.rl-save');
  await sleep(600);
  ui = await readUi();
  check('phrase/word saved from selection popup', /tariff/.test(ui.toastText), ui.toastText);

  // 5. phrase selection via programmatic selection + mouseup
  await page.mouse.click(20, 850); // clear
  await sleep(200);
  await page.evaluate(() => {
    const p = document.getElementById('p1');
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.data.indexOf('curb inflation');
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(node, i); r.setEnd(node, i + 'curb inflation'.length);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 10, clientY: 10 }));
        return;
      }
    }
  });
  await sleep(1000);
  ui = await readUi();
  check('phrase selection popup (network translation)', ui.popupVisible && /MOCK curb inflation/.test(ui.popupText), ui.popupText.slice(0, 60));
  await clickShadow('.rl-save');
  await sleep(600);

  // 6. context-menu path (message from background to the tab). No "tabs" permission → find the active tab.
  await page.bringToFront();
  await page.mouse.click(20, 850);
  await sleep(200);
  const ctx = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return { ok: false, error: 'no active tab' };
    return chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_MENU', action: 'save', text: 'undersecretary' });
  });
  check('context menu save handled by content script', ctx && ctx.ok && ctx.handled, JSON.stringify(ctx));
  await sleep(400);

  // 7. verify stored data through the real message API (from an extension page)
  const api = await browser.newPage();
  await api.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'load' });
  const rpc = (type, payload = {}) => api.evaluate((type, payload) => new Promise((resolve) => chrome.runtime.sendMessage({ type, ...payload }, resolve)), type, payload);
  const list = await rpc('LIST_VOCABULARY', { params: {} });
  const lemmas = list.ok ? list.data.items.map((v) => v.lemma).sort() : [];
  check('vocabulary rows saved', ['curb inflation', 'resilient', 'tariff', 'undersecretary', '買う'].every((l) => lemmas.includes(l)), lemmas.join(', '));
  const jaRow = list.ok ? list.data.items.find((v) => v.lemma === '買う') : null;
  check('Japanese row has language, reading, surface and quick meaning', !!jaRow && jaRow.language === 'ja' && jaRow.reading === 'かう' && jaRow.surface === '買いました' && /mua/.test(jaRow.quickMeaning || ''), JSON.stringify(jaRow && { language: jaRow.language, reading: jaRow.reading, surface: jaRow.surface, quickMeaning: jaRow.quickMeaning }));
  const resilientRow = list.ok ? list.data.items.find((v) => v.lemma === 'resilient') : null;
  const detail = resilientRow ? await rpc('GET_VOCABULARY', { id: resilientRow.id }) : { ok: false };
  const exposure = detail.ok ? detail.data.exposures[0] : null;
  check('exposure has sentence + url + title', !!exposure && /resilient/.test(exposure.sentence) && exposure.url.includes('article.html') && exposure.pageTitle.includes('Test article'), exposure ? exposure.sentence : JSON.stringify(detail));
  check('lookup counted', detail.ok && detail.data.lookups && detail.data.lookups.count >= 1, JSON.stringify(detail.data?.lookups));
  const stats = await rpc('STATS');
  check('stats report today\'s saves', stats.ok && stats.data.today >= 4, JSON.stringify(stats.data));

  // 8. enrichment (mock Gemini answers instantly; the queue paces itself ~6.5 s per word)
  if (!LIVE) {
    const enriched = resilientRow ? await rpc('ENRICH_ONE', { id: resilientRow.id }) : { ok: false };
    const row = enriched.ok ? enriched.data.vocabulary : null;
    check('gemini enrichment applied', !!row && row.enrichmentStatus === 'done' && row.enrichment?.cefr === 'B2', row ? row.enrichment?.meaningInContext : JSON.stringify(enriched));
    const calls = await worker.evaluate(() => self.__mockCalls);
    check('gemini called once per saved word at most (+1 forced)', calls.gemini >= 1 && calls.gemini <= 6, JSON.stringify(calls));
    check('google only used for sentences and the phrase, never for dictionary words', calls.google === before.google + 1 && calls.dict === 0, JSON.stringify(calls));
    const info = await rpc('DICT_INFO');
    check('offline dictionaries loaded (EN + JA)', info.ok && info.data && info.data.en.words > 100000 && info.data.ja.entries > 200000, JSON.stringify(info.data));
    const undo = await rpc('UNDO_SAVE', { vocabularyId: list.data.items.find((v) => v.lemma === 'undersecretary')?.id, created: true });
    const after = await rpc('LIST_VOCABULARY', { params: {} });
    check('undo removes a freshly saved word', undo.ok && !after.data.items.some((v) => v.lemma === 'undersecretary'));
  }
  // 8b. backend sync: configure a (mocked) server, save a word, outbox flushes, enrichment pulled back
  const badLogin = await rpc('BACKEND_LOGIN', { url: 'https://api.readlex.test', email: 'me@example.com', password: 'wrong' });
  check('login with wrong password reports the server message', !badLogin.ok && /Incorrect email/.test(badLogin.error), JSON.stringify(badLogin));
  const login = await rpc('BACKEND_LOGIN', { url: 'https://api.readlex.test', email: 'me@example.com', password: 'pw12345678' });
  check('extension login stores the session token', login.ok && login.data.email === 'me@example.com', JSON.stringify(login));
  const me = await rpc('BACKEND_ME');
  check('me through the stored token', me.ok && me.data.user.hasGeminiKey === true, JSON.stringify(me));
  const saved = await rpc('SAVE_VOCABULARY', { surface: 'geopolitical', sentence: 'Geopolitical tensions weighed on exports.', paragraph: '', url: 'https://example.com/x', pageTitle: 'X' });
  check('save with backend configured', saved.ok && saved.data.created, JSON.stringify(saved.data?.vocabulary?.lemma));
  await sleep(1200);
  const st = await rpc('SYNC_STATE');
  const backendCalls = await worker.evaluate(() => self.__mockCalls.backend || []);
  const syncCall = backendCalls.find((c) => c.path === '/api/v1/sync');
  check('outbox flushed to /api/v1/sync with vocabulary + exposure', !!syncCall && syncCall.body.op === 'vocabulary.save' && syncCall.body.payload.vocabulary.lemma === 'geopolitical' && syncCall.body.payload.exposure.sentence.includes('Geopolitical'), JSON.stringify(syncCall && syncCall.body.payload.vocabulary.lemma));
  check('sync state clean', st.ok && st.data.configured && st.data.pending === 0 && !st.data.lastError, JSON.stringify(st.data));
  const localRow = (await rpc('LIST_VOCABULARY', { params: { query: 'geopolitical' } })).data.items[0];
  check('local row remembers the server id and skipped local Gemini', localRow && localRow.serverId && localRow.serverId.startsWith('srv-') && localRow.enrichmentStatus === 'pending', JSON.stringify({ serverId: localRow?.serverId, status: localRow?.enrichmentStatus }));
  const pulled = await rpc('PULL_ENRICHED');
  const after = (await rpc('GET_VOCABULARY', { id: localRow.id })).data.vocabulary;
  check('server enrichment pulled into the local copy', pulled.ok && pulled.data.pulled >= 1 && after.enrichmentStatus === 'done' && after.enrichment.cefr === 'C1' && after.ipa === '/srv/', JSON.stringify({ pulled: pulled.data, cefr: after.enrichment?.cefr }));
  await rpc('SET_SETTINGS', { patch: { backendUrl: '', backendToken: '', backendEmail: '' } });
  await api.close();

  // 9. extension pages
  for (const [name, url, expectSel] of [
    ['popup page', `chrome-extension://${extId}/popup/popup.html`, '#list li'],
    ['vocabulary page', `chrome-extension://${extId}/vocabulary/vocabulary.html`, '#list li .w'],
    ['options page', `chrome-extension://${extId}/options/options.html`, '#geminiApiKey'],
  ]) {
    const p = await browser.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(url, { waitUntil: 'load' });
    try { await p.waitForSelector(expectSel, { timeout: 5000 }); } catch (_) { /* reported below */ }
    const found = await p.$$eval(expectSel, (els) => els.length).catch(() => 0);
    check(`${name} renders`, found > 0 && errs.length === 0, errs.join(' | ').slice(0, 200) || `${found} elements`);
    if (name === 'vocabulary page') {
      await p.click('#list li');
      await sleep(400);
      const detail = await p.$eval('#detail', (d) => d.textContent);
      check('vocabulary detail shows exposures', /Bạn đã gặp từ này ở đâu/.test(detail));
    }
    await p.close();
  }

  check('no page errors on article', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));
} catch (err) {
  check('unexpected error', false, err.stack || String(err));
} finally {
  await browser.close().catch(() => {});
  server.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
