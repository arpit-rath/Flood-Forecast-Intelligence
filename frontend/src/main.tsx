import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createApi } from './api/client';
import { AppStateProvider } from './state/AppState';
import { RealRoadApp } from './realroads/RealRoadApp';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/map.css';
import './styles/landing.css';

// Feature preview defaults to real roads. A branch-only "false" is a rollback
// switch; the untouched legacy /v1 app still serves main's Scenario contract.
const realRoadPreview = import.meta.env.VITE_REAL_ROADS_PREVIEW !== 'false';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {realRoadPreview ? <RealRoadApp /> : <AppStateProvider api={createApi()}><App /></AppStateProvider>}
  </StrictMode>,
);
