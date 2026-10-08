import { Ban, Route as RouteIcon } from 'lucide-react';
import type { RouteCandidate, RouteComparison as RouteComparisonData } from '../api/types';
import { TRAVEL_MODE_LABEL } from '../lib/copy';
import { formatExposure, formatExtraMinutes, formatMinutes, formatPercent, formatTimeIST, pluralize } from '../lib/format';
import { useAppState } from '../state/AppState';
import { HowEstimatedButton } from './HowEstimated';
import { StatusBadge, Tag } from './StatusBadge';

function outcomeSummary(data: RouteComparisonData) {
  const fastest = data.candidates.find((c) => c.id === data.fastestCandidateId)!;
  const rec = data.candidates.find((c) => c.id === data.recommendedCandidateId);
  switch (data.outcome) {
    case 'lower_exposure_recommended':
      if (!rec) break;
      return {
        title: `Lower estimated exposure · ${formatExtraMinutes(rec.travelMinutes - fastest.travelMinutes)}`,
        body:
          rec.id === fastest.id
            ? `${rec.label} has the lowest estimated exposure among the eligible routes.`
            : fastest.blocked
              ? `${rec.label} is recommended because the fastest route crosses a confirmed closure.`
              : `${rec.label} lowers estimated exposure from ${formatExposure(fastest.exposure)} to ${formatExposure(rec.exposure)} compared with the fastest route, which meets the ${data.exposureThreshold.toFixed(2)} threshold.`,
      };
    case 'fastest_default':
      return {
        title: 'Fastest route shown as default',
        body: `No alternative lowers estimated exposure by ${data.exposureThreshold.toFixed(2)} or more. Exposure note: ${fastest.label} has exposure ${formatExposure(fastest.exposure)}${fastest.flaggedSegmentIds.length ? ` with ${pluralize(fastest.flaggedSegmentIds.length, 'flagged segment')}` : ''}.`,
      };
    case 'no_lower_exposure':
      return {
        title: 'No lower-exposure route found',
        body: 'Every returned route is high, unknown or blocked. Consider whether the journey is needed.',
      };
  }
  return { title: 'Route comparison', body: '' };
}

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

  const summary = outcomeSummary(currentRoutes);
  return (
    <section className="route-results" aria-labelledby="route-results-title" aria-busy={routes.status === 'loading'}>
      <div className={`route-summary route-summary--${currentRoutes.outcome}`}>
        <h2 id="route-results-title" className="route-summary__title">
          {summary.title}
        </h2>
        <p>{summary.body}</p>
      </div>
      <RouteOptions data={currentRoutes} />
      <p className="detail">
        {currentRoutes.provenance.label} · {TRAVEL_MODE_LABEL[currentRoutes.travelMode]} · risk snapshot{' '}
        <span className="mono">{currentRoutes.snapshotId}</span> ·{' '}
        <time className="mono" dateTime={currentRoutes.computedAt}>{formatTimeIST(currentRoutes.computedAt)}</time>
      </p>
      <p className="detail">
        Lower estimated exposure is not a safety guarantee. Roads without recent evidence may still be impassable.
      </p>
      <HowEstimatedButton topic="routes" />
    </section>
  );
}

function RouteOptions({ data }: { data: RouteComparisonData }) {
  const { selectedRouteId, setSelectedRouteId } = useAppState();
  const fastest = data.candidates.find((c) => c.id === data.fastestCandidateId)!;
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
          onSelect={() => setSelectedRouteId(c.id)}
        />
      ))}
    </fieldset>
  );
}

function RouteOptionCard({
  candidate: c,
  extraMinutes,
  recommended,
  isDefaultOnly,
  selected,
  onSelect,
}: {
  candidate: RouteCandidate;
  extraMinutes: number;
  recommended: boolean;
  isDefaultOnly: boolean;
  selected: boolean;
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
            <span>
              <span className="metric">{formatMinutes(c.travelMinutes)}</span>
              <span className="detail">{c.isFastest ? 'fastest' : formatExtraMinutes(extraMinutes)}</span>
            </span>
            <span>
              <span className="metric">{formatExposure(c.exposure)}</span>
              <span className="detail">exposure</span>
            </span>
            <span className="route-option__max">
              <StatusBadge status={c.maxClass} size="sm" />
              <span className="detail">highest</span>
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
