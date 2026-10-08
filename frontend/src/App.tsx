import { Droplets, UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ModeBanner } from './components/ModeBanner';
import { useAppState } from './state/AppState';
import { ResidentView } from './views/ResidentView';
import { ResponderView } from './views/ResponderView';

type View = 'resident' | 'responder';

function viewFromHash(): View {
  return window.location.hash.startsWith('#/responder') ? 'responder' : 'resident';
}

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const { announcement, pilot, api } = useAppState();

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.title = `${view === 'resident' ? 'Routes' : 'Responder console'} · Varuna`;
  }, [view]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="app-header__brand">
          <Droplets aria-hidden="true" size={24} />
          <span className="app-header__name">Varuna</span>
          <span className="app-header__pilot detail">{pilot.status === 'ready' ? pilot.data.name : 'Pilot'}</span>
        </div>
        <nav aria-label="Views" className="view-nav">
          <a href="#/resident" aria-current={view === 'resident' ? 'page' : undefined}>
            Resident
          </a>
          <a href="#/responder" aria-current={view === 'responder' ? 'page' : undefined}>
            Responder
          </a>
        </nav>
        {view === 'responder' && (
          <span className="operator-chip">
            <UserCheck aria-hidden="true" size={16} />
            {api.kind === 'mock' ? 'Demo operator (mock session)' : 'Operator'}
          </span>
        )}
      </header>
      <ModeBanner />
      <main id="main" className="app-main" tabIndex={-1}>
        <h1 className="visually-hidden">{view === 'resident' ? 'Resident route view' : 'Responder console'}</h1>
        {pilot.status === 'error' ? (
          <div className="callout callout--muted page-error" role="alert">
            <p>
              <strong>The pilot map could not load.</strong> {pilot.error.message} Reload the page to try again.
            </p>
          </div>
        ) : view === 'resident' ? (
          <ResidentView />
        ) : (
          <ResponderView />
        )}
      </main>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}
