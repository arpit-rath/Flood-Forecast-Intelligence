import { useAppState } from '../state/AppState';

export type View = 'landing' | 'resident' | 'responder';

/** Droplet drawn with two contour lines: rain meeting terrain. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        d="M16 3.5C11 10.1 7.4 14.7 7.4 19.3a8.6 8.6 0 0 0 17.2 0C24.6 14.7 21 10.1 16 3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M11.3 19.6c1.6-1.4 3.1-1.4 4.7 0s3.1 1.4 4.7 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12.9 23.4c1-.8 2.1-.8 3.1 0s2.1.8 3.1 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function AppHeader({ view }: { view: View }) {
  const { pilot } = useAppState();
  return (
    <header className={`app-header${view === 'landing' ? ' app-header--inverse' : ''}`}>
      <a className="brand" href="#/" aria-label="Varuna home" aria-current={view === 'landing' ? 'page' : undefined}>
        <BrandMark />
        <span className="brand__name">Varuna</span>
      </a>
      <span className="app-header__pilot">{pilot.status === 'ready' ? pilot.data.name : 'Pilot'}</span>
      <nav aria-label="Views" className="view-nav">
        <a href="#/resident" aria-current={view === 'resident' ? 'page' : undefined}>
          Resident
        </a>
        <a href="#/responder" aria-current={view === 'responder' ? 'page' : undefined}>
          Responder
        </a>
      </nav>
    </header>
  );
}
