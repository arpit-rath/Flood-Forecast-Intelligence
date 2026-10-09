import { useEffect, useState } from 'react';
import { AppHeader, type View } from './components/AppHeader';
import { ModeBanner } from './components/ModeBanner';
import { useAppState } from './state/AppState';
import { LandingView } from './views/LandingView';
import { ResidentView } from './views/ResidentView';
import { ResponderView } from './views/ResponderView';

const TITLES: Record<View, string> = {
  landing: 'Varuna · Rain exposure on pilot roads',
  resident: 'Routes · Varuna',
  responder: 'Responder console · Varuna',
};

function viewFromHash(): View {
  const hash = window.location.hash;
  if (hash.startsWith('#/responder')) return 'responder';
  if (hash.startsWith('#/resident')) return 'resident';
  return 'landing';
}

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const { announcement, pilot } = useAppState();

  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.title = TITLES[view];
  }, [view]);

  const workspace = view !== 'landing';

  return (
    <div className={`app app--${view}`}>
      <a className="skip-link" href="#main" onClick={(e) => {
        // Hash routing owns location.hash, so move focus without navigating.
        e.preventDefault();
        document.getElementById('main')?.focus();
      }}>
        Skip to main content
      </a>
      <AppHeader view={view} />
      {workspace && <ModeBanner />}
      <main id="main" className={workspace ? 'app-main' : 'app-main app-main--landing'} tabIndex={-1}>
        {workspace && <h1 className="visually-hidden">{view === 'resident' ? 'Resident route view' : 'Responder console'}</h1>}
        {view === 'landing' ? (
          <LandingView />
        ) : pilot.status === 'error' ? (
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
