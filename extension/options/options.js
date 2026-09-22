import { send, getSettings, toast } from '../shared/rpc.js';

const $ = (id) => document.getElementById(id);
const DEFAULTS = {
  hoverMode: 'hover', hoverTarget: 'sentence', hoverDelay: 300, selectionMode: 'auto', skipCommonWords: true, showIpa: true, showDefinition: true,
  popupTheme: 'auto', targetLang: 'vi', geminiApiKey: '', geminiModel: 'gemini-2.5-flash', autoEnrich: true,
  disabledSites: [], backendUrl: '', backendToken: '', backendEmail: '', serverEnrich: true,
};
let settings = {};

function fill() {
  const hm = document.querySelector(`input[name="hoverMode"][value="${settings.hoverMode}"]`); if (hm) hm.checked = true;
  const sm = document.querySelector(`input[name="selectionMode"][value="${settings.selectionMode}"]`); if (sm) sm.checked = true;
  const ht = document.querySelector(`input[name="hoverTarget"][value="${settings.hoverTarget}"]`); if (ht) ht.checked = true;
  $('hoverDelay').value = settings.hoverDelay;
  $('hoverDelayValue').textContent = settings.hoverDelay;
  $('skipCommonWords').checked = !!settings.skipCommonWords;
  $('showIpa').checked = !!settings.showIpa;
  $('showDefinition').checked = !!settings.showDefinition;
  $('popupTheme').value = settings.popupTheme;
  $('targetLang').value = settings.targetLang;
  $('geminiApiKey').value = settings.geminiApiKey;
  $('geminiModel').value = settings.geminiModel;
  $('autoEnrich').checked = !!settings.autoEnrich;
  $('disabledSites').value = (settings.disabledSites || []).join('\n');
  $('backendUrl').value = settings.backendUrl || '';
  $('backendEmail').value = settings.backendEmail || '';
  $('serverEnrich').checked = settings.serverEnrich !== false;
  renderSyncStatus();
}

let saveTimer = null;
function save(patch) {
  settings = { ...settings, ...patch };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await send('SET_SETTINGS', { patch });
    $('status').textContent = `Đã lưu lúc ${new Date().toLocaleTimeString('vi-VN')}`;
    if (patch.geminiApiKey !== undefined || patch.autoEnrich !== undefined) send('PROCESS_QUEUE').catch(() => {});
  }, 250);
}

document.querySelectorAll('input[name="hoverMode"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) save({ hoverMode: r.value, lastHoverMode: r.value === 'off' ? settings.lastHoverMode : r.value }); }));
document.querySelectorAll('input[name="hoverTarget"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) save({ hoverTarget: r.value }); }));
document.querySelectorAll('input[name="selectionMode"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) save({ selectionMode: r.value }); }));
$('hoverDelay').addEventListener('input', () => { $('hoverDelayValue').textContent = $('hoverDelay').value; });
$('hoverDelay').addEventListener('change', () => save({ hoverDelay: Number($('hoverDelay').value) }));
for (const id of ['skipCommonWords', 'showIpa', 'showDefinition', 'autoEnrich', 'serverEnrich']) {
  $(id).addEventListener('change', () => save({ [id]: $(id).checked }));
}
$('popupTheme').addEventListener('change', () => save({ popupTheme: $('popupTheme').value }));
$('targetLang').addEventListener('change', () => save({ targetLang: $('targetLang').value.trim().toLowerCase() || 'vi' }));
$('geminiApiKey').addEventListener('change', () => save({ geminiApiKey: $('geminiApiKey').value.trim() }));
$('geminiModel').addEventListener('change', () => save({ geminiModel: $('geminiModel').value.trim() || 'gemini-2.5-flash' }));
$('disabledSites').addEventListener('change', () => save({ disabledSites: $('disabledSites').value.split('\n').map((s) => s.trim().toLowerCase()).filter(Boolean) }));


$('btn-show-key').addEventListener('click', () => {
  const i = $('geminiApiKey');
  i.type = i.type === 'password' ? 'text' : 'password';
  $('btn-show-key').textContent = i.type === 'password' ? 'Hiện' : 'Ẩn';
});

$('btn-test-key').addEventListener('click', async () => {
  const apiKey = $('geminiApiKey').value.trim();
  const model = $('geminiModel').value.trim() || 'gemini-2.5-flash';
  if (!apiKey) { $('test-result').textContent = 'Hãy dán API key trước.'; return; }
  $('btn-test-key').disabled = true;
  $('test-result').textContent = 'Đang gọi Gemini…';
  try {
    await send('SET_SETTINGS', { patch: { geminiApiKey: apiKey, geminiModel: model } });
    settings = { ...settings, geminiApiKey: apiKey, geminiModel: model };
    const r = await send('TEST_GEMINI', { apiKey, model });
    $('test-result').textContent = r && r.ok ? `✓ Kết nối OK (${model})` : `Phản hồi lạ: ${JSON.stringify(r)}`;
    send('PROCESS_QUEUE').catch(() => {});
  } catch (err) {
    $('test-result').textContent = `✗ ${err.message}`;
  }
  $('btn-test-key').disabled = false;
});

async function renderSyncStatus() {
  try {
    const st = await send('SYNC_STATE');
    const loggedIn = st.configured;
    $('backend-logged-out').classList.toggle('hidden', loggedIn);
    $('backend-logged-in').classList.toggle('hidden', !loggedIn);
    if (!loggedIn) { $('backend-status').textContent = st.lastError || (st.hasUrl ? 'Chưa đăng nhập.' : ''); return; }
    $('backend-email-label').textContent = st.email || '';
    const parts = [`${st.pending} thay đổi đang chờ gửi`];
    if (st.lastSyncAt) parts.push(`đồng bộ lần cuối ${new Date(st.lastSyncAt).toLocaleString('vi-VN')}`);
    if (st.lastError) parts.push(`lỗi gần nhất: ${st.lastError}`);
    $('backend-status').textContent = parts.join(' · ');
    send('BACKEND_ME').then((me) => {
      const b = $('gemini-server-status');
      b.textContent = me.user.hasGeminiKey ? 'đã có key' : 'chưa có key';
      b.className = 'badge ' + (me.user.hasGeminiKey ? 'ok' : 'warn');
    }).catch(() => {});
  } catch (err) { $('backend-status').textContent = err.message; }
}

async function ensureHostPermission(url) {
  let origin;
  try { origin = new URL(url).origin + '/*'; } catch (_) { throw new Error('Địa chỉ server không hợp lệ'); }
  const has = await chrome.permissions.contains({ origins: [origin] });
  if (has) return true;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error('Bạn chưa cho phép extension truy cập ' + origin);
  return true;
}

async function doLogin(register) {
  const url = $('backendUrl').value.trim().replace(/\/$/, '');
  const email = $('backendEmail').value.trim();
  const password = $('backendPassword').value;
  const inviteCode = $('backendInvite').value.trim();
  if (!url) { $('backend-status').textContent = '✗ Nhập địa chỉ server trước (thử local: http://localhost:8787)'; return; }
  if (!email || !password) { $('backend-status').textContent = '✗ Nhập email và mật khẩu'; return; }
  if (register && !inviteCode) {
    try {
      const h = await send('BACKEND_HEALTH', { url });
      if (h.signup === 'closed') { $('backend-status').textContent = '✗ Server này hiện không nhận đăng ký mới'; return; }
      if (h.signup === 'invite') { $('invite-field').classList.remove('hidden'); $('backend-status').textContent = 'Server này cần mã mời: nhập mã rồi bấm Đăng ký lần nữa'; return; }
    } catch (err) { $('backend-status').textContent = `✗ Không kết nối được server: ${err.message}`; return; }
  }
  $('btn-backend-login').disabled = $('btn-backend-register').disabled = true;
  $('backend-status').textContent = register ? 'Đang tạo tài khoản…' : 'Đang đăng nhập…';
  try {
    await ensureHostPermission(url);
    const user = await send('BACKEND_LOGIN', { url, email, password, register, inviteCode });
    settings = await send('GET_SETTINGS');
    $('backendPassword').value = '';
    $('backend-status').textContent = `✓ Đã đăng nhập ${user.email}`;
    send('FLUSH_OUTBOX').catch(() => {});
  } catch (err) {
    $('backend-status').textContent = `✗ ${err.message}`;
  }
  $('btn-backend-login').disabled = $('btn-backend-register').disabled = false;
  renderSyncStatus();
}

$('btn-backend-login').addEventListener('click', () => doLogin(false));
$('btn-backend-register').addEventListener('click', () => doLogin(true));
$('btn-backend-logout').addEventListener('click', async () => {
  await send('BACKEND_LOGOUT');
  settings = await send('GET_SETTINGS');
  $('backend-status').textContent = 'Đã đăng xuất.';
  renderSyncStatus();
});
$('btn-gemini-server-save').addEventListener('click', async () => {
  const apiKey = $('geminiServerKey').value.trim();
  if (!apiKey) { $('backend-status').textContent = '✗ Dán Gemini key vào ô trước'; return; }
  $('btn-gemini-server-save').disabled = true;
  $('backend-status').textContent = 'Đang kiểm tra key với Gemini…';
  try {
    const r = await send('BACKEND_SET_GEMINI', { apiKey, model: $('geminiModel').value.trim() || 'gemini-2.5-flash' });
    $('geminiServerKey').value = '';
    $('backend-status').textContent = `✓ Đã lưu key ${r.masked} trên server`;
  } catch (err) { $('backend-status').textContent = `✗ ${err.message}`; }
  $('btn-gemini-server-save').disabled = false;
  renderSyncStatus();
});

$('btn-backend-import').addEventListener('click', async () => {
  if (!confirm('Đẩy toàn bộ từ vựng và ngữ cảnh ở máy này lên server? Server tự bỏ qua từ trùng.')) return;
  $('btn-backend-import').disabled = true;
  $('backend-status').textContent = 'Đang đẩy dữ liệu…';
  try {
    const r = await send('BACKEND_IMPORT');
    $('backend-status').textContent = `✓ Đã đẩy ${r.vocabulary} từ (${r.created} mới, ${r.exposures} ngữ cảnh mới)`;
  } catch (err) { $('backend-status').textContent = `✗ ${err.message}`; }
  $('btn-backend-import').disabled = false;
});

$('btn-backend-flush').addEventListener('click', async () => {
  try {
    const r = await send('FLUSH_OUTBOX');
    const p = await send('PULL_ENRICHED');
    toast(`Đã gửi ${r.sent || 0}, còn ${r.remaining || 0} · nhận ${p.pulled || 0} kết quả AI`);
  } catch (err) { toast(err.message, 5000); }
  renderSyncStatus();
});

$('btn-clear-cache').addEventListener('click', async () => {
  await send('CLEAR_CACHE');
  toast('Đã xóa cache dịch');
});
$('btn-clear-all').addEventListener('click', async () => {
  if (!confirm('Xóa TOÀN BỘ từ vựng, ngữ cảnh và lịch sử tra? Không thể hoàn tác. Hãy export trước nếu cần.')) return;
  await send('CLEAR_ALL_DATA');
  toast('Đã xóa toàn bộ dữ liệu');
});

(async () => {
  settings = { ...DEFAULTS, ...(await getSettings()) };
  fill();
})();
