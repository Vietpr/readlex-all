import { useEffect, useState, type ReactNode } from 'react';
import { auth, api, getConfig, setConfig, queuedReviewCount, flushReviewQueue, relativeTime, timeZoneLabel, type AuthUser } from '../api';
import { speak, speechAvailable, voicesFor } from '../speech';
import { Icon } from '../components/Icon';

function Section({ title, children, danger = false }: { title: string; children: ReactNode; danger?: boolean }) {
  return <section className={`settings-section${danger ? ' danger-zone' : ''}`}><h2>{title}</h2><div className="card settings-card">{children}</div></section>;
}
function Row({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return <div className="setting-row"><div className="grow"><div className="setting-label">{label}</div>{hint && <div className="muted small">{hint}</div>}</div>{children && <div className="setting-control">{children}</div>}</div>;
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}><span /></button>;
}

export function Settings({ onConfigured }: { onConfigured: () => void }) {
  const [cfg, setCfg] = useState(getConfig());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [extension, setExtension] = useState<{ last: number } | null | undefined>(undefined);
  const [status, setStatus] = useState<{ where: string; text: string; ok: boolean } | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [geminiKey, setGeminiKey] = useState('');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [danger, setDanger] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [queued, setQueued] = useState(queuedReviewCount());
  const [demoAi, setDemoAi] = useState(false);

  useEffect(() => {
    auth.me().then((r) => { setUser(r.user); setModel(r.user.geminiModel || 'gemini-2.5-flash'); }).catch(() => {});
    auth.health(cfg.apiUrl).then((r) => setDemoAi(!!r.mock)).catch(() => {});
    api.sessions().then((r) => { const ext = r.sessions.filter((s) => s.kind === 'extension').sort((a, b) => b.last_used_at - a.last_used_at)[0]; setExtension(ext ? { last: ext.last_used_at } : null); }).catch(() => setExtension(null));
    const load = () => setVoices(voicesFor('en'));
    load();
    if (speechAvailable()) window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => { if (speechAvailable()) window.speechSynthesis.removeEventListener('voiceschanged', load); };
  }, []);

  const save = (patch: Partial<typeof cfg>) => setCfg(setConfig(patch));
  const say = (where: string, text: string, ok = true) => setStatus({ where, text, ok });
  const note = (where: string) => (status?.where === where ? <p className={`small ${status.ok ? 'ok-text' : 'error'}`}>{status.text}</p> : null);

  const langs = { en: cfg.language !== 'ja', ja: cfg.language !== 'en' };
  const setLang = (lang: 'en' | 'ja', on: boolean) => {
    const next = { ...langs, [lang]: on };
    if (!next.en && !next.ja) return; // keep at least one
    save({ language: next.en && next.ja ? '' : next.en ? 'en' : 'ja' });
  };

  const saveKey = async () => {
    if (!geminiKey.trim()) { say('ai', 'Paste your Gemini API key first.', false); return; }
    setBusy(true);
    say('ai', 'Checking the key with Gemini…');
    try {
      const r = await auth.setGemini(geminiKey.trim(), model.trim());
      say('ai', r.mock
        ? `Key ${r.masked} saved, but this server runs a fake Gemini (GEMINI_MOCK) — it was NOT checked and AI answers will be placeholders.`
        : `Key ${r.masked} saved. Waiting words will be explained shortly.`, !r.mock);
      setGeminiKey(''); setKeyOpen(false);
      setUser((u) => (u ? { ...u, hasGeminiKey: true, geminiModel: r.model } : u));
    } catch (err) { say('ai', (err as Error).message, false); }
    setBusy(false);
  };

  return (
    <div className="settings">
      <h1>Settings</h1>

      <Section title="Account">
        <Row label={user?.email || cfg.email || '…'} hint={user ? (user.role === 'admin' ? 'Administrator' : 'Member') : ''}>
          <button className="btn small" onClick={async () => { await auth.logout(); onConfigured(); }}><Icon name="logout" size={16} />Sign out</button>
        </Row>
      </Section>

      <Section title="AI assistance">
        <Row label="Gemini API key" hint="Explains the words you save (meaning in context, example sentence, collocations) and powers the “Fill with AI” buttons when you type words by hand. Your key is encrypted on the server and never shown again.">
          <span className={`badge ${user?.hasGeminiKey ? 'ok' : 'warn'}`}>{user ? (user.hasGeminiKey ? 'Connected ✓' : 'Not set') : '…'}</span>
        </Row>
        {demoAi && <p className="small error">This server runs a fake Gemini (<code>GEMINI_MOCK</code>): keys are not checked and every explanation is a placeholder. Restart the backend with <code>npm run dev:real</code> to use your own key.</p>}
        {!keyOpen ? (
          <div className="row"><button className="btn small" onClick={() => setKeyOpen(true)}>{user?.hasGeminiKey ? 'Update API key' : 'Add API key'}</button>
            {user?.hasGeminiKey && <button className="btn small" onClick={async () => { await auth.removeGemini(); setUser((u) => (u ? { ...u, hasGeminiKey: false } : u)); say('ai', 'Key removed.'); }}>Remove</button>}</div>
        ) : (
          <div className="inline-form">
            <input className="input" type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} placeholder="AIza…" autoComplete="off" />
            <p className="muted small">Get a free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Google AI Studio</a>.</p>
            <details><summary className="muted small">Advanced</summary>
              <div className="field"><label>Model</label><input className="input" value={model} onChange={(e) => setModel(e.target.value)} list="models" /><datalist id="models"><option value="gemini-2.5-flash" /><option value="gemini-3.6-flash" /><option value="gemini-3.5-flash-lite" /><option value="gemini-2.5-pro" /></datalist><span className="muted small">If a model answers “busy / high demand”, try another one here.</span></div>
            </details>
            <div className="row"><button className="btn primary small" onClick={saveKey} disabled={busy}>Check &amp; save</button><button className="btn small" onClick={() => setKeyOpen(false)}>Cancel</button></div>
          </div>
        )}
        {note('ai')}
      </Section>

      <Section title="Learning">
        <Row label="English" hint="Show English words in reviews"><Toggle label="English" checked={langs.en} onChange={(v) => setLang('en', v)} /></Row>
        <Row label="Japanese" hint="Show Japanese words in reviews"><Toggle label="Japanese" checked={langs.ja} onChange={(v) => setLang('ja', v)} /></Row>
        <Row label="Review algorithm · FSRS" hint="Automatically schedules each word based on how well you remember it. Save as many words as you like; there is no daily limit." />
      </Section>

      <Section title="Pronunciation">
        <Row label="English accent">
          <select className="input auto" value={cfg.accent} onChange={(e) => save({ accent: e.target.value as typeof cfg.accent, voiceEn: '' })}><option value="en-US">US English</option><option value="en-GB">British English</option><option value="en-AU">Australian English</option></select>
        </Row>
        {voices.length > 0 && (
          <Row label="Voice">
            <select className="input auto" value={cfg.voiceEn} onChange={(e) => save({ voiceEn: e.target.value })}><option value="">System default</option>{voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}</select>
          </Row>
        )}
        <Row label="Playback speed">
          <select className="input auto" value={String(cfg.speechRate)} onChange={(e) => save({ speechRate: Number(e.target.value) })}><option value="0.75">Slow</option><option value="1">Normal</option><option value="1.25">Fast</option></select>
        </Row>
        <Row label="Auto-play pronunciation" hint="Say the word when a card is revealed"><Toggle label="Auto-play pronunciation" checked={cfg.autoPlay} onChange={(v) => save({ autoPlay: v })} /></Row>
        <div className="row"><button className="btn small" onClick={() => { if (!speak('Turn words you meet into words you remember.', 'en')) say('voice', 'This browser has no built-in voices; recorded audio will be used when available.', false); }}><Icon name="volume" size={16} />Test voice</button></div>
        {note('voice')}
      </Section>

      <Section title="Data & Sync">
        <Row label="Sync status" hint={queued ? `${queued} ${queued === 1 ? 'review is' : 'reviews are'} waiting to be sent` : 'Everything is up to date'}>
          {queued ? <button className="btn small" onClick={async () => { await flushReviewQueue(); setQueued(queuedReviewCount()); }}>Send now</button> : <span className="badge ok">✓</span>}
        </Row>
        <Row label="Browser extension" hint={extension === undefined ? '' : extension ? `Connected · last active ${relativeTime(extension.last)}` : 'Not connected yet'}>
          {extension ? <span className="badge ok">Connected</span> : null}
        </Row>
        <details><summary className="muted small">Set up the extension</summary>
          <ol className="muted small steps"><li>Install the ReadLex extension in Chrome on the computer where you read.</li><li>Open its Settings and sign in with <b>{user?.email || 'this account'}</b>.</li><li>Hover or select words while reading and press Save. They appear here within seconds.</li></ol>
        </details>
      </Section>

      <Section title="App">
        <Row label="Time zone" hint={`Automatic · ${timeZoneLabel()}`} />
        <Row label="Install ReadLex" hint="Add ReadLex to your Home Screen to open it like an app" />
        <details><summary className="muted small">How to install</summary>
          <ul className="muted small steps"><li><b>iPhone / iPad:</b> Safari → Share → Add to Home Screen.</li><li><b>Android:</b> Chrome → ⋮ menu → Install app.</li><li><b>Desktop Chrome:</b> the install icon at the right of the address bar.</li></ul>
        </details>
      </Section>

      <Section title="Danger zone" danger>
        <div className="setting-label">Change password</div>
        <div className="inline-form">
          <input className="input" type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
          <input className="input" type="password" placeholder="New password (at least 8 characters)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
          <div className="row"><button className="btn small" disabled={!pw.current || pw.next.length < 8} onClick={async () => { try { await auth.changePassword(pw.current, pw.next); say('pw', 'Password changed.'); setPw({ current: '', next: '' }); } catch (err) { say('pw', (err as Error).message, false); } }}>Change password</button></div>
          {note('pw')}
        </div>
        <hr />
        <div className="setting-label">Delete account</div>
        <div className="muted small">Permanently delete your account and all data: words, sentences and review history.</div>
        <div className="inline-form">
          <input className="input" type="password" placeholder="Enter your password to confirm" value={danger} onChange={(e) => setDanger(e.target.value)} autoComplete="off" />
          <div className="row"><button className="btn small danger" disabled={!danger} onClick={async () => { if (!confirm('Permanently delete your account and all of its data?')) return; try { await auth.deleteAccount(danger); setConfig({ token: '', email: '' }); onConfigured(); } catch (err) { say('del', (err as Error).message, false); } }}>Delete account</button></div>
          {note('del')}
        </div>
      </Section>
    </div>
  );
}
