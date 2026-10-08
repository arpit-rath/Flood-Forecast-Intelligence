import { CloudOff, CloudRain, FlaskConical, RefreshCw } from 'lucide-react';
import type { WeatherMode } from '../api/types';
import { formatTimeIST } from '../lib/format';
import { useAppState } from '../state/AppState';

/**
 * Mode banner (Design-System.md §6): Scenario or Live weather, valid time,
 * source, and loading / stale / provider-unavailable states. Scenario data
 * is never labelled Live; unavailable live data is never shown as current.
 */
export function ModeBanner() {
  const { mode, setMode, snapshot, refreshSnapshot, pilot, api } = useAppState();
  const data = snapshot.status === 'ready' ? snapshot.data : snapshot.status === 'loading' ? snapshot.data : undefined;

  return (
    <section className={`mode-banner mode-banner--${mode}`} aria-label="Data mode and timestamps">
      <fieldset className="mode-switch">
        <legend className="visually-hidden">Weather mode</legend>
        {(['scenario', 'live'] as WeatherMode[]).map((m) => (
          <label key={m} className="mode-switch__option">
            <input
              type="radio"
              name="weather-mode"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
            />
            <span>{m === 'scenario' ? 'Scenario' : 'Live weather'}</span>
          </label>
        ))}
      </fieldset>

      <div className="mode-banner__status">
        {snapshot.status === 'loading' && !data && <p className="mode-banner__line">Loading {mode === 'live' ? 'live weather' : 'scenario'}…</p>}

        {snapshot.status === 'error' && (
          <div className="mode-banner__unavailable">
            <CloudOff aria-hidden="true" size={18} />
            <p className="mode-banner__line">
              <strong>{mode === 'live' ? 'Live weather unavailable.' : 'Scenario unavailable.'}</strong>{' '}
              {snapshot.error.message}
            </p>
            <div className="mode-banner__actions">
              {snapshot.error.retryable && (
                <button type="button" className="btn btn--quiet btn--sm" onClick={refreshSnapshot}>
                  <RefreshCw aria-hidden="true" size={16} /> Retry
                </button>
              )}
              {mode === 'live' && (
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setMode('scenario')}>
                  Switch to Scenario
                </button>
              )}
            </div>
          </div>
        )}

        {data && data.weather.mode === 'scenario' && (
          <p className="mode-banner__line">
            <span className="mode-pill mode-pill--scenario">
              <FlaskConical aria-hidden="true" size={14} /> Scenario
            </span>
            <strong>{data.weather.scenarioLabel ?? `Scenario: ${data.weather.precipitationMmH} mm/h rainfall`}</strong>
            <span className="mode-banner__meta">
              Rain valid <time className="mono" dateTime={data.weather.validAt}>{formatTimeIST(data.weather.validAt)}</time> ·
              synthetic replay, not live
            </span>
          </p>
        )}

        {data && data.weather.mode === 'live' && (
          <p className="mode-banner__line">
            <span className="mode-pill mode-pill--live">
              <CloudRain aria-hidden="true" size={14} /> Live weather
            </span>
            <strong>
              {data.weather.precipitationMmH === null ? 'Rainfall not reported' : `${data.weather.precipitationMmH} mm/h forecast`}
            </strong>
            <span className="mode-banner__meta">
              {data.weather.provider} · forecast valid{' '}
              <time className="mono" dateTime={data.weather.validAt}>{formatTimeIST(data.weather.validAt)}</time> · fetched{' '}
              <time className="mono" dateTime={data.weather.fetchedAt}>{formatTimeIST(data.weather.fetchedAt)}</time>
            </span>
            {(data.stale || data.weather.stale) && <span className="tag tag--warning">Stale: last available forecast</span>}
          </p>
        )}
      </div>

      <dl className="mode-banner__times">
        <div>
          <dt>Risk calculated</dt>
          <dd>{data ? <time className="mono" dateTime={data.computedAt}>{formatTimeIST(data.computedAt)}</time> : '—'}</dd>
        </div>
        <div>
          <dt>Map data</dt>
          <dd>
            {pilot.status === 'ready' ? (
              <time className="mono" dateTime={pilot.data.mapUpdatedAt}>{formatTimeIST(pilot.data.mapUpdatedAt)}</time>
            ) : (
              '—'
            )}
          </dd>
        </div>
        {api.kind === 'mock' && (
          <div>
            <dt>Data source</dt>
            <dd>
              <span className="tag tag--neutral">Local fixtures (no AWS calls)</span>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
