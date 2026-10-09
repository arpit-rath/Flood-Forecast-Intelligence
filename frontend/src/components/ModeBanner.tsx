import { CloudOff, CloudRain, FlaskConical, LoaderCircle, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { WeatherMode } from '../api/types';
import { formatTimeIST } from '../lib/format';
import { useAppState } from '../state/AppState';

/**
 * Status strip (Design-System.md §6, mode banner): Scenario or Live weather,
 * valid time, source, and loading / stale / provider-unavailable states, in
 * one compact band. Scenario data is never labelled Live; unavailable live
 * data is never shown as current.
 */
export function ModeBanner() {
  const { mode, setMode, snapshot, refreshSnapshot, pilot, api } = useAppState();
  const data = snapshot.status === 'ready' ? snapshot.data : snapshot.status === 'loading' ? snapshot.data : undefined;
  const tone = snapshot.status === 'error' ? 'unavailable' : mode;
  const weather = data?.weather;

  return (
    <section className={`status-strip status-strip--${tone}`} aria-label="Data mode and timestamps">
      <fieldset className="mode-toggle">
        <legend className="visually-hidden">Weather mode</legend>
        {(['scenario', 'live'] as WeatherMode[]).map((m) => (
          <label key={m} className="mode-toggle__option">
            <input type="radio" name="weather-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
            <span>{m === 'scenario' ? 'Scenario' : 'Live weather'}</span>
          </label>
        ))}
      </fieldset>

      <div className="status-strip__statement">
        {snapshot.status === 'loading' && !data && (
          <p className="status-strip__line">
            <LoaderCircle aria-hidden="true" size={16} className="spin" /> Loading {mode === 'live' ? 'live weather' : 'scenario'}…
          </p>
        )}

        {snapshot.status === 'error' && (
          <div className="status-strip__unavailable">
            <p className="status-strip__line">
              <span className="mode-pill mode-pill--unavailable">
                <CloudOff aria-hidden="true" size={14} /> {mode === 'live' ? 'Live' : 'Scenario'}
              </span>
              <strong>{mode === 'live' ? 'Live weather unavailable.' : 'Scenario unavailable.'}</strong>{' '}
              <span className="status-strip__qualifier">{snapshot.error.message}</span>
            </p>
            <div className="status-strip__actions">
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

        {weather && weather.mode === 'scenario' && (
          <p className="status-strip__line">
            <span className="mode-pill mode-pill--scenario">
              <FlaskConical aria-hidden="true" size={14} /> Scenario
            </span>
            <strong>{weather.scenarioLabel ?? `Scenario: ${weather.precipitationMmH} mm/h rainfall`}</strong>
            <span className="status-strip__qualifier">synthetic replay, not live</span>
          </p>
        )}

        {weather && weather.mode === 'live' && (
          <p className="status-strip__line">
            <span className="mode-pill mode-pill--live">
              <CloudRain aria-hidden="true" size={14} /> Live weather
            </span>
            <strong>{weather.precipitationMmH === null ? 'Rainfall not reported' : `${weather.precipitationMmH} mm/h forecast`}</strong>
            {(data?.stale || weather.stale) && <span className="tag tag--warning">Stale: last available forecast</span>}
          </p>
        )}
      </div>

      <dl className="status-strip__facts">
        <Fact label={weather?.mode === 'live' ? 'Forecast valid' : 'Rain valid'}>
          {weather ? <Time iso={weather.validAt} /> : '—'}
        </Fact>
        {weather?.mode === 'live' && (
          <Fact label="Fetched">
            <Time iso={weather.fetchedAt} />
          </Fact>
        )}
        <Fact label="Risk calculated">{data ? <Time iso={data.computedAt} /> : '—'}</Fact>
        <Fact label="Map data">{pilot.status === 'ready' ? <Time iso={pilot.data.mapUpdatedAt} /> : '—'}</Fact>
        <Fact label="Source">
          {api.kind === 'mock'
            ? 'Local fixtures (no AWS calls)'
            : weather?.mode === 'live'
              ? weather.provider
              : data?.mode === 'scenario'
                ? 'Synthetic Scenario API'
                : '—'}
        </Fact>
      </dl>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="status-strip__fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Time({ iso }: { iso: string }) {
  return (
    <time className="mono" dateTime={iso}>
      {formatTimeIST(iso)}
    </time>
  );
}
