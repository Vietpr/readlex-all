import { useEffect, useState } from 'react';
import { auth, getConfig, setConfig, DEFAULT_API_URL } from '../api';
import { navigate } from '../router';
import { Icon, type IconName } from '../components/Icon';

type Mode = 'login' | 'register' | 'forgot' | 'reset';

// Password field with a show / hide toggle.
function PasswordInput({ value, onChange, onKeyDown, autoComplete, placeholder }: { value: string; onChange: (v: string) => void; onKeyDown?: (e: React.KeyboardEvent) => void; autoComplete?: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} autoComplete={autoComplete} placeholder={placeholder} />
      <button type="button" className="pw-toggle" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>
        {show ? (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-6.06" /><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-3.17 4.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
        )}
      </button>
    </div>
  );
}

function Brand() {
  return (
    <div className="auth-brand">
      <img src="icons/icon-192.png" alt="" width={56} height={56} />
      <div>
        <div className="auth-name">ReadLex</div>
        <div className="auth-tagline">Turn words you meet into words you remember.</div>
      </div>
    </div>
  );
}

const FEATURES: Array<[IconName, string]> = [
  ['book', 'Save words as you read with the browser extension, right from the sentence where you found them.'],
  ['sparkles', 'Understand words in context with AI-powered definitions, examples, and collocations using your own Gemini API key.'],
  ['repeat', 'Review words with cloze cards built from the original sentence, scheduled with FSRS across desktop and mobile.'],
];

export function Auth({ mode, onLoggedIn }: { mode: Mode; onLoggedIn: () => void }) {
  const cfg = getConfig();
  const [apiUrl, setApiUrl] = useState(cfg.apiUrl || DEFAULT_API_URL);
  const [email, setEmail] = useState(cfg.email || '');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [status, setStatus] = useState<{ kind: 'error' | 'info' | 'ok'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<{ signup: string; mail: boolean } | null>(null);
  const resetToken = new URLSearchParams(window.location.hash.split('?')[1] || '').get('token') || '';

  useEffect(() => { setStatus(null); setPassword(''); setPassword2(''); }, [mode]);
  useEffect(() => {
    const url = apiUrl.trim().replace(/\/$/, '');
    if (!url) { setServer(null); return; }
    auth.health(url).then((h) => setServer({ signup: h.signup || 'open', mail: !!(h as { mail?: boolean }).mail })).catch(() => setServer(null));
  }, [apiUrl]);

  const url = apiUrl.trim().replace(/\/$/, '');
  const fail = (text: string) => setStatus({ kind: 'error', text });

  const submit = async () => {
    if (!url) { fail('No server address configured.'); return; }
    setBusy(true);
    setStatus(null);
    try {
      if (mode === 'login') {
        if (!email.trim() || !password) { fail('Enter your email and password.'); setBusy(false); return; }
        await auth.login(url, email.trim(), password);
        onLoggedIn();
      } else if (mode === 'register') {
        if (!email.trim() || !password) { fail('Enter your email and password.'); setBusy(false); return; }
        if (password.length < 8) { fail('Password must be at least 8 characters.'); setBusy(false); return; }
        if (password !== password2) { fail("Passwords don't match."); setBusy(false); return; }
        await auth.register(url, email.trim(), password, invite.trim(), name.trim());
        onLoggedIn();
      } else if (mode === 'forgot') {
        if (!email.trim()) { fail('Enter the email of your account.'); setBusy(false); return; }
        const r = await auth.forgot(url, email.trim());
        if (r.mail) setStatus({ kind: 'ok', text: `If ${email.trim()} has an account, we've sent a password reset email. The link works for 60 minutes.` });
        else if (r.devToken) { navigate(`/reset?token=${r.devToken}`); }
        else setStatus({ kind: 'info', text: 'This server cannot send email yet. Contact the server admin to reset your password.' });
      } else if (mode === 'reset') {
        if (password.length < 8) { fail('Password must be at least 8 characters.'); setBusy(false); return; }
        if (password !== password2) { fail("Passwords don't match."); setBusy(false); return; }
        await auth.reset(url, resetToken, password);
        onLoggedIn();
      }
    } catch (err) {
      fail((err as Error).message);
    }
    setBusy(false);
  };
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') submit(); };

  const title = { login: 'Sign in', register: 'Create your account', forgot: 'Forgot password', reset: 'Set a new password' }[mode];
  const action = { login: 'Sign in', register: 'Create account', forgot: 'Send reset link', reset: 'Save new password' }[mode];
  return (
    <div className={`auth auth-${mode}`}>
      <div className="auth-side">
        <Brand />
        <ul className="auth-features">{FEATURES.map(([icon, text]) => <li key={text}><span className="feature-icon"><Icon name={icon} size={18} /></span><span>{text}</span></li>)}</ul>
      </div>
      <div className="auth-main">
      <div className="card auth-card">
        <h1>{title}</h1>
        {mode === 'forgot' && <p className="muted small">Enter your account email and we'll send you a link to set a new password.</p>}
        {mode === 'reset' && !resetToken && <p className="error">This link is missing its reset code. Please open it from the email again.</p>}
        {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
          <div className="field"><label>Email</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} autoCapitalize="off" autoComplete="email" placeholder="you@example.com" /></div>
        )}
        {mode === 'register' && (
          <div className="field"><label>Display name <span className="muted">Optional</span></label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></div>
        )}
        {mode !== 'forgot' && (
          <div className="field"><label>{mode === 'reset' ? 'New password' : 'Password'}</label><PasswordInput value={password} onChange={setPassword} onKeyDown={onEnter} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? '' : 'At least 8 characters'} /></div>
        )}
        {(mode === 'register' || mode === 'reset') && (
          <div className="field"><label>Confirm password</label><PasswordInput value={password2} onChange={setPassword2} onKeyDown={onEnter} autoComplete="new-password" /></div>
        )}
        {mode === 'register' && server?.signup === 'invite' && (
          <div className="field"><label>Invite code</label><input className="input" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Ask the server admin" autoCapitalize="off" /></div>
        )}
        {mode === 'register' && server?.signup === 'closed' && <p className="error">This server is not accepting new accounts right now.</p>}
        {mode === 'login' && <div className="auth-links"><a href="#/forgot">Forgot password?</a></div>}
        <button className="btn primary block" onClick={submit} disabled={busy || (mode === 'reset' && !resetToken)}>{busy ? 'Please wait…' : action}</button>
        {status && <p className={`auth-status ${status.kind}`}>{status.text}</p>}
        <p className="auth-switch">
          {mode === 'login' && <>New to ReadLex? <a href="#/register">Create a free account</a></>}
          {mode === 'register' && <>Already have an account? <a href="#/login">Sign in</a></>}
          {(mode === 'forgot' || mode === 'reset') && <a href="#/login">← Back to sign in</a>}
        </p>
      </div>
      {!DEFAULT_API_URL && (
        <div className="card auth-server">
          <div className="field">
            <label>ReadLex server address</label>
            <input className="input" value={apiUrl} onChange={(e) => { setApiUrl(e.target.value); setConfig({ apiUrl: e.target.value.trim() }); }} placeholder="https://readlex-api.xxx.workers.dev" inputMode="url" autoCapitalize="off" />
            <span className="muted small">This build has no server preset. Your server admin will give you this address.</span>
          </div>
        </div>
      )}
      <p className="auth-foot muted small">Open source · Your data stays on the server you sign in to</p>
      </div>
    </div>
  );
}
