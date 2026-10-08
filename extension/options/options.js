import { send, getSettings, toast, plural } from '../shared/rpc.js';

const $ = (id) => document.getElementById(id);
const DEFAULTS = {
  hoverMode: 'hover', hoverTarget: 'sentence', hoverDelay: 300, selectionMode: 'auto', skipCommonWords: true, showIpa: true, showDefinition: true,
  popupTheme: 'auto', targetLang: 'vi', geminiApiKey: '', geminiModel: 'gemini-2.5-flash', autoEnrich: true,
  disabledSites: [], backendUrl: '', backendToken: '', backendEmail: '', serverEnrich: true,
};
let settings = {};
let syncInfo = { configured: false, hasUrl: false };  // last SYNC_STATE answer
let serverHasKey = false;                             // account already holds a Gemini key
let serverKeyMasked = '';                             // only known right after saving one
let editingKey = false;                               // "Change key" was pressed: show the key fields again

// Status lines: plain words plus a colour, no text glyphs.
function say(node, text, kind = '') {
  node.textContent = text;
  node.classList.toggle('say-ok', kind === 'ok');
  node.classList.toggle('say-err', kind === 'err');
}

function formatDelay(ms) {
  const seconds = Number(ms) / 1000;
  return `${seconds.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${seconds === 1 ? 'second' : 'seconds'}`;
}

// The language list is a <select>; a stored code that is not in the list stays selectable.
function fillTargetLang(code) {
  const select = $('targetLang');
  const want = String(code || 'vi');
  let option = [...select.options].find((o) => o.value.toLowerCase() === want.toLowerCase());
  if (!option) {
    option = new Option(`Other (${want})`, want);
    select.add(option);
  }
  select.value = option.value;
}

// Remember which local key passed "Test" (a short hash in this page's own storage, never the key).
const KEY_OK_STORE = 'readlex.geminiKeyOk';
const keyPrint = (key) => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${key.length}:${(h >>> 0).toString(16)}`;
};
const maskKey = (key) => (key.length > 8 ? `${key.slice(0, 4)}••••••••${key.slice(-3)}` : '••••••••');
function localKeyVerified() {
  try { return !!settings.geminiApiKey && localStorage.getItem(KEY_OK_STORE) === keyPrint(settings.geminiApiKey); } catch (_) { return false; }
}
function markLocalKey(ok) {
  try {
    if (ok) localStorage.setItem(KEY_OK_STORE, keyPrint(settings.geminiApiKey));
    else localStorage.removeItem(KEY_OK_STORE);
  } catch (_) { /* storage blocked: the green state just will not survive a reload */ }
}

// Which Gemini key is in use, mirrored from background/enrich.js:
//   a server address is set and "Run AI on the server" is on -> the key stored in the account
//   otherwise                                               -> the key stored on this machine
function renderAiState() {
  const { configured, hasUrl } = syncInfo;
  const serverOn = settings.serverEnrich !== false;
  const usingServer = configured && serverOn;
  const paused = !configured && hasUrl && serverOn;
  const ok = usingServer ? serverHasKey : !paused && localKeyVerified();

  $('ai-key-ok').classList.toggle('hidden', !ok);
  if (ok) {
    $('ai-key-ok-detail').textContent = usingServer
      ? `${serverKeyMasked ? serverKeyMasked + ' · ' : ''}${serverKeyMasked ? 'stored' : 'Stored'} in your ReadLex account`
      : `${maskKey(settings.geminiApiKey)} · stored on this device`;
  }

  const source = $('ai-key-source');
  source.classList.toggle('paused', paused);
  source.classList.toggle('muted', !paused);
  if (usingServer) source.textContent = 'You are signed in, so AI runs on the server with the key stored in your ReadLex account.';
  else if (configured) source.textContent = '“Run AI on the server” is off, so ReadLex uses the key stored on this device.';
  else if (paused) source.textContent = 'You are not signed in to the server, so AI is paused. Sign in under “Account & sync”, or turn off “Run AI on the server” below to use the key on this device.';
  else source.textContent = 'You are not signed in, so ReadLex uses the key stored on this device.';

  $('ai-key-fields').classList.toggle('hidden', ok && !editingKey);
  $('ai-server-field').classList.toggle('hidden', !configured);
  $('server-enrich-row').classList.toggle('hidden', !(configured || hasUrl));
  const badge = $('ai-local-badge');
  badge.textContent = usingServer ? 'backup' : 'in use';
  badge.className = `badge ${usingServer ? 'gray' : 'ok'}${configured ? '' : ' hidden'}`;
  $('ai-local-note').textContent = usingServer
    ? 'Used only when you sign out or turn off “Run AI on the server”.'
    : 'The key is stored only in this browser.';
}

function fill() {
  const hm = document.querySelector(`input[name="hoverMode"][value="${settings.hoverMode}"]`); if (hm) hm.checked = true;
  const sm = document.querySelector(`input[name="selectionMode"][value="${settings.selectionMode}"]`); if (sm) sm.checked = true;
  const ht = document.querySelector(`input[name="hoverTarget"][value="${settings.hoverTarget}"]`); if (ht) ht.checked = true;
  $('hoverDelay').value = settings.hoverDelay;
  $('hoverDelayValue').textContent = formatDelay(settings.hoverDelay);
  $('skipCommonWords').checked = !!settings.skipCommonWords;
  $('showIpa').checked = !!settings.showIpa;
  $('showDefinition').checked = !!settings.showDefinition;
  $('popupTheme').value = settings.popupTheme;
  fillTargetLang(settings.targetLang);
  $('geminiApiKey').value = settings.geminiApiKey;
  $('geminiModel').value = settings.geminiModel;
  $('autoEnrich').checked = !!settings.autoEnrich;
  $('disabledSites').value = (settings.disabledSites || []).join('\n');
  $('backendUrl').value = settings.backendUrl || '';
  $('backendEmail').value = settings.backendEmail || '';
  $('serverEnrich').checked = settings.serverEnrich !== false;
  renderAiState();
  renderSyncStatus();
}

let saveTimer = null;
function save(patch) {
  settings = { ...settings, ...patch };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await send('SET_SETTINGS', { patch });
    $('status').textContent = `Saved at ${new Date().toLocaleTimeString('en-US')}`;
    if (patch.geminiApiKey !== undefined || patch.serverEnrich !== undefined) renderAiState();
    if (patch.geminiApiKey !== undefined || patch.autoEnrich !== undefined) send('PROCESS_QUEUE').catch(() => {});
  }, 250);
}

document.querySelectorAll('input[name="hoverMode"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) save({ hoverMode: r.value, lastHoverMode: r.value === 'off' ? settings.lastHoverMode : r.value }); }));
document.querySelectorAll('input[name="hoverTarget"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) save({ hoverTarget: r.value }); }));
document.querySelectorAll('input[name="selectionMode"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) save({ selectionMode: r.value }); }));
$('hoverDelay').addEventListener('input', () => { $('hoverDelayValue').textContent = formatDelay($('hoverDelay').value); });
$('hoverDelay').addEventListener('change', () => save({ hoverDelay: Number($('hoverDelay').value) }));
for (const id of ['skipCommonWords', 'showIpa', 'showDefinition', 'autoEnrich', 'serverEnrich']) {
  $(id).addEventListener('change', () => save({ [id]: $(id).checked }));
}
$('popupTheme').addEventListener('change', () => save({ popupTheme: $('popupTheme').value }));
$('targetLang').addEventListener('change', () => save({ targetLang: $('targetLang').value || 'vi' }));
$('geminiApiKey').addEventListener('change', () => save({ geminiApiKey: $('geminiApiKey').value.trim() }));
$('geminiModel').addEventListener('change', () => save({ geminiModel: $('geminiModel').value.trim() || 'gemini-2.5-flash' }));
$('disabledSites').addEventListener('change', () => save({ disabledSites: $('disabledSites').value.split('\n').map((s) => s.trim().toLowerCase()).filter(Boolean) }));


$('btn-show-key').addEventListener('click', () => {
  const i = $('geminiApiKey');
  i.type = i.type === 'password' ? 'text' : 'password';
  $('btn-show-key').textContent = i.type === 'password' ? 'Show' : 'Hide';
});

$('btn-test-key').addEventListener('click', async () => {
  const apiKey = $('geminiApiKey').value.trim();
  const model = $('geminiModel').value.trim() || 'gemini-2.5-flash';
  if (!apiKey) { say($('test-result'), 'Paste a Gemini key first.', 'err'); return; }
  $('btn-test-key').disabled = true;
  say($('test-result'), 'Calling Gemini…');
  try {
    await send('SET_SETTINGS', { patch: { geminiApiKey: apiKey, geminiModel: model } });
    settings = { ...settings, geminiApiKey: apiKey, geminiModel: model };
    const r = await send('TEST_GEMINI', { apiKey, model });
    const ok = !!(r && r.ok);
    markLocalKey(ok);
    if (ok) editingKey = false;
    say($('test-result'), ok ? `The key works (${model}).` : `Unexpected reply from Gemini: ${JSON.stringify(r)}`, ok ? 'ok' : 'err');
    send('PROCESS_QUEUE').catch(() => {});
  } catch (err) {
    markLocalKey(false);
    say($('test-result'), `The key did not work: ${err.message}`, 'err');
  }
  $('btn-test-key').disabled = false;
  renderAiState();
});

$('btn-change-key').addEventListener('click', () => {
  editingKey = true;
  renderAiState();
  const field = syncInfo.configured && settings.serverEnrich !== false ? $('geminiServerKey') : $('geminiApiKey');
  field.focus();
});

async function renderSyncStatus() {
  try {
    const st = await send('SYNC_STATE');
    const loggedIn = st.configured;
    syncInfo = { configured: !!st.configured, hasUrl: !!st.hasUrl };
    if (!loggedIn) { serverHasKey = false; serverKeyMasked = ''; }
    $('backend-logged-out').classList.toggle('hidden', loggedIn);
    $('backend-logged-in').classList.toggle('hidden', !loggedIn);
    renderAiState();
    if (!loggedIn) { say($('backend-status'), st.lastError || (st.hasUrl ? 'Not signed in.' : ''), st.lastError ? 'err' : ''); return; }
    $('backend-email-label').textContent = st.email || '';
    const parts = [];
    if (st.lastSyncAt) {
      const at = new Date(st.lastSyncAt);
      const sameDay = at.toDateString() === new Date().toDateString();
      parts.push(`synced ${sameDay ? 'at ' + at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'on ' + at.toLocaleString('en-US', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`);
    }
    parts.push(st.pending ? `${plural(st.pending, 'change')} waiting to send` : 'nothing waiting to send');
    if (st.lastError) parts.push(`last error: ${st.lastError}`);
    const line = parts.join(', ');
    say($('backend-sync-line'), line.charAt(0).toUpperCase() + line.slice(1), st.lastError ? 'err' : '');
    send('BACKEND_ME').then((me) => {
      serverHasKey = !!me.user.hasGeminiKey;
      const b = $('gemini-server-status');
      b.textContent = serverHasKey ? 'key saved' : 'no key yet';
      b.className = 'badge ' + (serverHasKey ? 'ok' : 'warn');
      renderAiState();
    }).catch(() => {});
  } catch (err) { say($('backend-status'), err.message, 'err'); }
}

async function ensureHostPermission(url) {
  let origin;
  try { origin = new URL(url).origin + '/*'; } catch (_) { throw new Error('The server address is not valid'); }
  const has = await chrome.permissions.contains({ origins: [origin] });
  if (has) return true;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error('You have not allowed the extension to access ' + origin);
  return true;
}

async function doLogin(register) {
  const url = $('backendUrl').value.trim().replace(/\/$/, '');
  const email = $('backendEmail').value.trim();
  const password = $('backendPassword').value;
  const inviteCode = $('backendInvite').value.trim();
  if (!url) { say($('backend-status'), 'Enter the server address first (to try it locally: http://localhost:8787).', 'err'); return; }
  if (!email || !password) { say($('backend-status'), 'Enter your email and password.', 'err'); return; }
  if (register && !inviteCode) {
    try {
      const h = await send('BACKEND_HEALTH', { url });
      if (h.signup === 'closed') { say($('backend-status'), 'This server is not accepting new accounts.', 'err'); return; }
      if (h.signup === 'invite') { $('invite-field').classList.remove('hidden'); say($('backend-status'), 'This server needs an invite code. Enter it, then press “Create account” again.'); $('backendInvite').focus(); return; }
    } catch (err) { say($('backend-status'), `Could not reach the server: ${err.message}`, 'err'); return; }
  }
  $('btn-backend-login').disabled = $('btn-backend-register').disabled = true;
  say($('backend-status'), register ? 'Creating your account…' : 'Signing in…');
  try {
    await ensureHostPermission(url);
    const user = await send('BACKEND_LOGIN', { url, email, password, register, inviteCode });
    settings = await send('GET_SETTINGS');
    $('backendPassword').value = '';
    say($('backend-status'), `Signed in as ${user.email}.`, 'ok');
    send('FLUSH_OUTBOX').catch(() => {});
  } catch (err) {
    say($('backend-status'), `Could not sign in: ${err.message}`, 'err');
  }
  $('btn-backend-login').disabled = $('btn-backend-register').disabled = false;
  renderSyncStatus();
}

$('btn-backend-login').addEventListener('click', () => doLogin(false));
$('btn-backend-register').addEventListener('click', () => doLogin(true));
$('btn-backend-logout').addEventListener('click', async () => {
  await send('BACKEND_LOGOUT');
  settings = await send('GET_SETTINGS');
  say($('backend-status'), 'Signed out.');
  renderSyncStatus();
});
$('btn-gemini-server-save').addEventListener('click', async () => {
  const apiKey = $('geminiServerKey').value.trim();
  const result = $('gemini-server-result');
  if (!apiKey) { say(result, 'Paste a Gemini key first.', 'err'); return; }
  $('btn-gemini-server-save').disabled = true;
  say(result, 'Checking the key with Gemini…');
  try {
    const r = await send('BACKEND_SET_GEMINI', { apiKey, model: $('geminiModel').value.trim() || 'gemini-2.5-flash' });
    $('geminiServerKey').value = '';
    serverHasKey = true;
    serverKeyMasked = r.masked || '';
    editingKey = false;
    say(result, `Saved key ${r.masked} to your account.`, 'ok');
  } catch (err) { say(result, `Could not save the key: ${err.message}`, 'err'); }
  $('btn-gemini-server-save').disabled = false;
  renderSyncStatus();
});

$('btn-backend-import').addEventListener('click', async () => {
  if (!confirm('Upload all vocabulary and sentences on this device to the server? The server skips duplicates.')) return;
  $('btn-backend-import').disabled = true;
  say($('backend-status'), 'Uploading…');
  try {
    const r = await send('BACKEND_IMPORT');
    say($('backend-status'), `Uploaded ${plural(r.vocabulary, 'word')} (${r.created} new, ${plural(r.exposures, 'new sentence')}).`, 'ok');
  } catch (err) { say($('backend-status'), `Upload failed: ${err.message}`, 'err'); }
  $('btn-backend-import').disabled = false;
});

$('btn-backend-flush').addEventListener('click', async () => {
  try {
    const r = await send('FLUSH_OUTBOX');
    const p = await send('PULL_ENRICHED');
    toast(`Sent ${r.sent || 0}, ${r.remaining || 0} left · received ${plural(p.pulled || 0, 'AI result')}`);
  } catch (err) { toast(err.message, 5000); }
  renderSyncStatus();
});

$('btn-clear-cache').addEventListener('click', async () => {
  await send('CLEAR_CACHE');
  toast('Translation cache cleared');
});
$('btn-clear-all').addEventListener('click', async () => {
  if (!confirm('Delete ALL vocabulary, sentences and lookup history? This cannot be undone. Export a backup first if you need one.')) return;
  await send('CLEAR_ALL_DATA');
  toast('All data deleted');
});

// Left menu: mark the section currently in view.
function watchSections() {
  const links = [...document.querySelectorAll('#section-menu a')];
  const sections = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  const mark = (id) => links.forEach((a) => {
    if (a.getAttribute('href') === `#${id}`) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  });
  const pick = () => {
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    let current = sections[0];
    for (const s of sections) { if (s.getBoundingClientRect().top <= 120) current = s; }
    if (atBottom && window.scrollY > 0) current = sections[sections.length - 1];
    if (current) mark(current.id);
  };
  let queued = false;
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; pick(); });
  }, { passive: true });
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (document.getElementById(id)) mark(id); });
  pick();
  if (location.hash && document.getElementById(location.hash.slice(1))) mark(location.hash.slice(1));
}

(async () => {
  settings = { ...DEFAULTS, ...(await getSettings()) };
  fill();
  watchSections();
})();
