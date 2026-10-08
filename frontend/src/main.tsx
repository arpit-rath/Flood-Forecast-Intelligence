import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createApi } from './api/client';
import { AppStateProvider } from './state/AppState';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

const api = createApi();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppStateProvider api={api}>
      <App />
    </AppStateProvider>
  </StrictMode>,
);
