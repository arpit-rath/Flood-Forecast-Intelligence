import { Ban, Route as RouteIcon } from 'lucide-react';
import type { RouteCandidate, RouteComparison as RouteComparisonData } from '../api/types';
import { TRAVEL_MODE_LABEL } from '../lib/copy';
import { formatExposure, formatExtraMinutes, formatMinutes, formatPercent, formatTimeIST, pluralize } from '../lib/format';
import { outcomeSummary } from '../lib/routeCopy';
import { useAppState } from '../state/AppState';
import { HowEstimatedButton } from './HowEstimated';
import { StatusBadge, Tag } from './StatusBadge';

export function RouteComparisonPanel() {
  const { routes, currentRoutes, snapshot } = useAppState();

  if (snapshot.status === 'error') {
    return (
      <section className="route-results" aria-label="Route comparison">
        <p className="callout callout--muted">Route comparison is paused until a current risk estimate is available.</p>
      </section>
    );
  }

  if (routes.status === 'error') {
    return (
      <section className="route-results" aria-label="Route comparison">
        <div className="callout callout--muted">
          <RouteIcon aria-hidden="true" size={18} />
          <p>
            <strong>Route comparison unavailable.</strong> {routes.error.message} The map and road list remain available; no
            route is invented.
          </p>
        </div>
      </section>
    );
  }

  if (!currentRoutes) {
    return (
      <section className="route-results" aria-label="Route comparison" aria-busy={routes.status === 'loading'}>
        <p className="detail">{routes.status === 'loading' ? 'Comparing routes…' : 'Choose a start and destination to compare routes.'}</p>
      </section>
    );
  }

  if (currentRoutes.status === 'unavailable' || currentRoutes.candidates.length === 0) {
    return (
      <section className="route-results" aria-label="Route comparison">
        <p className="callout callout--muted">No route is available between these pilot points. The map and road list remain available.</p>
      </section>
    );
  }

  const summary = outcomeSummary(currentRoutes);
  return (
    <section className="route-results" aria-labelledby="route-results-title" aria-busy={routes.status === 'loading'}>
      <div className={`decision decision--${currentRoutes.outcome}`}>
        <p className="eyebrow">Route advice</p>
        <h2 id="route-results-title" className="decision__title">
          {summary.title}
        </h2>
        <p className="decision__body">{summary.body}</p>
      </div>
      <RouteOptions data={currentRoutes} />
      <p className="provenance">
        {currentRoutes.provenance.label} · {TRAVEL_MODE_LABEL[currentRoutes.travelMode]} · risk snapshot{' '}
        <span className="mono">{currentRoutes.snapshotId}</span> ·{' '}
        <time className="mono" dateTime={currentRoutes.computedAt}>{formatTimeIST(currentRoutes.computedAt)}</time>
      </p>
      <p className="detail trust-note">
        Lower estimated exposure is not a safety guarantee. Roads without recent evidence may still be impassable.
      </p>
      <HowEstimatedButton topic="routes" />
    </section>
  );
}

function RouteOptions({ data }: { data: RouteComparisonData }) {
  const { selectedRouteId, setSelectedRouteId, snapshot } = useAppState();
  const fastest = data.candidates.find((c) => c.id === data.fastestCandidateId) ?? data.candidates[0];
  const thresholds = snapshot.status === 'ready' ? snapshot.data.thresholds : null;
  const ordered = [...data.candidates].sort((a, b) => {
    const rank = (c: RouteCandidate) => (c.id === data.recommendedCandidateId ? 0 : c.blocked ? 2 : 1);
    return rank(a) - rank(b) || a.travelMinutes - b.travelMinutes;
  });
  return (
    <fieldset className="route-options">
      <legend className="visually-hidden">Route candidates</legend>
      {ordered.map((c) => (
        <RouteOptionCard
          key={c.id}
          candidate={c}
          extraMinutes={c.travelMinutes - fastest.travelMinutes}
          recommended={c.id === data.recommendedCandidateId}
          isDefaultOnly={data.outcome === 'fastest_default'}
          selected={c.id === selectedRouteId}
          thresholds={thresholds}
          onSelect={() => setSelectedRouteId(c.id)}
        />
      ))}
    </fieldset>
  );
}

/** Exposure on a 0–1 track with the Watch and High boundaries marked; the number is always shown beside it. */
function ExposureMeter({ value, thresholds }: { value: number | null; thresholds: { watch: number; high: number } | null }) {
  if (value === null) return <span className="exposure-meter exposure-meter--empty" aria-hidden="true" />;
  return (
    <span className="exposure-meter" aria-hidden="true">
      <span className="exposure-meter__fill" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
      {thresholds && (
        <>
          <span className="exposure-meter__tick" style={{ left: `${thresholds.watch * 100}%` }} />
          <span className="exposure-meter__tick exposure-meter__tick--high" style={{ left: `${thresholds.high * 100}%` }} />
        </>
      )}
    </span>
  );
}

function RouteOptionCard({
  candidate: c,
  extraMinutes,
  recommended,
  isDefaultOnly,
  selected,
  thresholds,
  onSelect,
}: {
  candidate: RouteCandidate;
  extraMinutes: number;
  recommended: boolean;
  isDefaultOnly: boolean;
  selected: boolean;
  thresholds: { watch: number; high: number } | null;
  onSelect: () => void;
}) {
  const { segmentsById, riskById, selectSegment } = useAppState();
  const descId = `route-${c.id}-desc`;
  return (
    <div className={`route-option${selected ? ' route-option--selected' : ''}${c.blocked ? ' route-option--blocked' : ''}`}>
      <label className="route-option__main">
        <input
          type="radio"
          name="route-candidate"
          value={c.id}
          checked={selected}
          disabled={c.blocked}
          onChange={onSelect}
          aria-describedby={descId}
        />
        <span className="route-option__body">
          <span className="route-option__title">
            <span className="route-option__marker" aria-hidden="true" />
            <span className="route-option__label">{c.label}</span>
            {recommended && <Tag tone="action">{isDefaultOnly ? 'Default' : 'Recommended'}</Tag>}
            {c.isFastest && <Tag>Fastest</Tag>}
            {c.blocked && (
              <span className="badge badge--closed badge--sm">
                <Ban aria-hidden="true" size={14} /> Blocked
              </span>
            )}
            {c.unassessed && <Tag tone="warning">Unassessed</Tag>}
          </span>
          <span className="route-option__metrics">
            <span className="route-metric">
              <span className="route-metric__value">{formatMinutes(c.travelMinutes)}</span>
              <span className="route-metric__label">{c.isFastest ? 'fastest' : formatExtraMinutes(extraMinutes)}</span>
            </span>
            <span className="route-metric route-metric--exposure">
              <span className="route-metric__value">{formatExposure(c.exposure)}</span>
              <span className="route-metric__label">exposure</span>
              <ExposureMeter value={c.exposure} thresholds={thresholds} />
            </span>
            <span className="route-metric route-metric--class">
              <StatusBadge status={c.maxClass} size="sm" />
              <span className="route-metric__label">highest</span>
            </span>
          </span>
          <span id={descId} className="detail route-option__desc">
            {c.blocked
              ? `Excluded: crosses a confirmed closure on ${c.blockedSegmentIds.map((id) => segmentsById.get(id)?.name ?? id).join(', ')}.`
              : `${pluralize(c.flaggedSegmentIds.length, 'flagged segment')} · ${formatPercent(c.unknownShare)} of route has unknown risk`}
          </span>
        </span>
      </label>
      {c.flaggedSegmentIds.length > 0 && (
        <details className="route-option__flagged">
          <summary>Flagged segments on this route</summary>
          <ul>
            {c.flaggedSegmentIds.map((id) => {
              const risk = riskById.get(id);
              return (
                <li key={id}>
                  <button type="button" className="link-button" onClick={() => selectSegment(id)}>
                    {segmentsById.get(id)?.name ?? id}
                  </button>
                  <StatusBadge status={risk?.class ?? 'unknown'} size="sm" />
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
