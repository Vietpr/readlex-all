import { useEffect, useState } from 'react';
import { useRoute, navigate } from './router';
import { flushReviewQueue, isConfigured } from './api';
import { Icon, type IconName } from './components/Icon';
import { Today } from './pages/Today';
import { Review } from './pages/Review';
import { Library } from './pages/Library';
import { SetDetail } from './pages/SetDetail';
import { CustomSetDetail } from './pages/CustomSetDetail';
import { VocabDetail } from './pages/VocabDetail';
import { Progress } from './pages/Progress';
import { Settings } from './pages/Settings';
import { Auth } from './pages/Auth';

const NAV: Array<{ path: string; label: string; icon: IconName }> = [
  { path: '/', label: 'Today', icon: 'home' },
  { path: '/library', label: 'Library', icon: 'library' },
  { path: '/progress', label: 'Progress', icon: 'chart' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];
// The name with "Lex" under a highlighter stroke: the mark of the whole product.
export const Wordmark = () => <span className="wordmark">Read<span>Lex</span></span>;

const AUTH_ROUTES = ['login', 'register', 'forgot', 'reset'];

export function App() {
  const route = useRoute();
  const [configured, setConfigured] = useState(isConfigured());
  const [first, second, third] = route.parts;

  useEffect(() => {
    flushReviewQueue().catch(() => {});
    const onOnline = () => { flushReviewQueue().catch(() => {}); };
    const onLogout = () => setConfigured(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('readlex:logout', onLogout);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('readlex:logout', onLogout); };
  }, []);

  useEffect(() => {
    if (!configured && !AUTH_ROUTES.includes(first || '')) navigate('/login');
    if (configured && AUTH_ROUTES.includes(first || '')) navigate('/');
  }, [configured, first]);

  const onLoggedIn = () => { setConfigured(isConfigured()); navigate('/'); };
  let page;
  if (!configured) page = <Auth key={first} mode={(AUTH_ROUTES.includes(first || '') ? first : 'login') as 'login' | 'register' | 'forgot' | 'reset'} onLoggedIn={onLoggedIn} />;
  else if (first === 'settings') page = <Settings onConfigured={() => setConfigured(isConfigured())} />;
  else if (first === 'review') page = <Review key={route.query.toString()} />;
  else if (first === 'library' && second === 'sets' && third) page = <SetDetail date={third} />;
  else if (first === 'library' && second === 'my' && third) page = <CustomSetDetail key={third} id={third} />;
  else if (first === 'library' && second && second !== 'sets' && second !== 'my') page = <VocabDetail key={second} id={second} />;
  else if (first === 'library') page = <Library />;   // /library, /library/sets and /library/my are all the one page
  else if (first === 'progress') page = <Progress />;
  else page = <Today />;

  const isActive = (path: string) => (path === '/' ? route.path === '/' : route.path.startsWith(path));
  const chrome = configured && first !== 'review';
  return (
    <div className={`app${chrome ? '' : ' app-bare'}`}>
      {chrome && (
        <header className="topbar">
          <div className="topbar-inner">
            <a href="#/" className="topbar-brand" aria-label="ReadLex, back to Today"><Wordmark /></a>
            <nav className="topnav" aria-label="Main">{NAV.map((n) => <a key={n.path} href={`#${n.path}`} className={isActive(n.path) ? 'active' : ''} aria-current={isActive(n.path) ? 'page' : undefined}>{n.label}</a>)}</nav>
          </div>
        </header>
      )}
      <main className="page">{page}</main>
      {chrome && (
        <nav className="bottom-nav" aria-label="Main">
          {NAV.map((n) => <a key={n.path} href={`#${n.path}`} className={isActive(n.path) ? 'active' : ''} aria-current={isActive(n.path) ? 'page' : undefined}><i><Icon name={n.icon} size={21} /></i><span>{n.label}</span></a>)}
        </nav>
      )}
    </div>
  );
}
