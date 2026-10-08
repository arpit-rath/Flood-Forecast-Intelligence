import { Eye, EyeOff, Loader, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { InterventionComparison, InterventionOption, RouteOutcome } from '../api/types';
import { formatExposure, formatScore, formatTimeIST, pluralize } from '../lib/format';
import { useAppState } from '../state/AppState';
import { HowEstimatedButton } from './HowEstimated';
import { SimulatedTag, StatusBadge } from './StatusBadge';

const OUTCOME_SHORT: Record<RouteOutcome, string> = {
  lower_exposure_recommended: 'lower-exposure route recommended',
  fastest_default: 'fastest route default',
  no_lower_exposure: 'no lower-exposure route',
  unavailable: 'routes unavailable',
};

export function InterventionPanel() {
  const { pilot, currentRoutes, selectedRouteId, intervention, interventionIsStale, runIntervention, snapshot } = useAppState();
  const eligible = useMemo(() => currentRoutes?.candidates.filter((c) => !c.blocked) ?? [], [currentRoutes]);
  const [routeId, setRouteId] = useState('');

  useEffect(() => {
    if (eligible.some((c) => c.id === routeId)) return;
    const preferred = eligible.find((c) => c.id === selectedRouteId) ?? eligible.find((c) => c.isFastest) ?? eligible[0];
    setRouteId(preferred?.id ?? '');
  }, [eligible, selectedRouteId, routeId]);

  const drains = pilot.status === 'ready' ? pilot.data.drains.features : [];
  const loading = intervention.status === 'loading';
  const result = intervention.status === 'ready' && !interventionIsStale ? intervention.data : null;
  const blockedReason =
    snapshot.status !== 'ready'
      ? 'Needs a current risk snapshot.'
      : !currentRoutes
        ? 'Compare routes first; the ranking uses exposure on a selected route.'
        : eligible.length === 0
          ? 'Every route candidate is blocked by a closure.'
          : drains.length < 2
            ? 'Two modelled drains are required.'
            : null;

  return (
    <section className="intervention-panel" aria-labelledby="intervention-title">
      <div className="intervention-panel__header">
        <h2 id="intervention-title" className="panel-heading">
          <Wrench aria-hidden="true" size={20} /> Compare drain clearance
        </h2>
        <SimulatedTag label="Simulation" />
      </div>
      <p className="detail">
        Estimates the effect of clearing one of two modelled drains. Advisory only: nothing is dispatched and the baseline
        stays unchanged.
      </p>

      <ul className="drain-list">
        {drains.map((d) => (
          <li key={d.id}>
            <span className="drain-chip mono">{d.id}</span>
            <span>
              <strong>{d.properties.label}</strong>
              <span className="detail">
                {' '}
                · affects {pluralize(d.properties.affectedSegmentIds.length, 'segment')}
                {d.properties.illustrative ? ' · illustrative location' : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <div className="field">
        <label htmlFor="intervention-route">Route to evaluate</label>
        <select
          id="intervention-route"
          value={routeId}
          onChange={(e) => setRouteId(e.target.value)}
          disabled={eligible.length === 0}
        >
          {eligible.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
              {c.isFastest ? ' (fastest)' : ''}
              {c.id === currentRoutes?.recommendedCandidateId ? ' (recommended)' : ''}
            </option>
          ))}
        </select>
        <p className="detail">Actions are ranked by the reduction in estimated exposure on this route.</p>
      </div>

      <button
        type="button"
        className="btn btn--primary btn--block"
        aria-disabled={Boolean(blockedReason) || loading}
        aria-describedby={blockedReason ? 'intervention-blocked' : undefined}
        onClick={() => {
          if (!blockedReason && !loading && routeId) runIntervention(routeId);
        }}
      >
        {loading && <Loader aria-hidden="true" size={18} className="spin" />}
        Compare both actions
      </button>
      {loading && (
        <p className="detail" role="status">
          Calculating the two simulations against the same baseline…
        </p>
      )}
      {blockedReason && (
        <p id="intervention-blocked" className="detail">
          {blockedReason}
        </p>
      )}

      {interventionIsStale && (
        <p className="callout callout--muted">The risk baseline changed since the last comparison. Compare again to update it.</p>
      )}

      {intervention.status === 'error' && (
        <p className="field-error" role="alert">
          Simulation failed: {intervention.error.message} The baseline is unchanged.
        </p>
      )}

      {result && <InterventionResult data={result} />}
    </section>
  );
}

function rankReason(data: InterventionComparison, routeLabel: string): string {
  const [first, second] = data.options;
  if (data.noEstimatedBenefit) return `Neither action has an estimated benefit on ${routeLabel} or on segments in High.`;
  switch (data.rankBasis) {
    case 'route_exposure_reduction':
      return `${first.drainId} ranks first because it lowers estimated exposure on ${routeLabel} by ${first.exposureReduction.toFixed(2)}, against ${second.exposureReduction.toFixed(2)} for ${second.drainId}.`;
    case 'segments_leaving_high':
      return `Both actions change exposure on ${routeLabel} equally. ${first.drainId} ranks first because ${pluralize(first.segmentsLeavingHigh, 'segment')} move out of High, against ${second.segmentsLeavingHigh}.`;
    default:
      return 'The two actions tie on route exposure and on segments leaving High, so they are listed by drain ID.';
  }
}

function InterventionResult({ data }: { data: InterventionComparison }) {
  const { currentRoutes, simulationPreview, setSimulationPreview } = useAppState();
  const [viewDrain, setViewDrain] = useState(data.options[0].drainId);
  useEffect(() => setViewDrain(data.options[0].drainId), [data]);

  const routeLabel = (id: string | null) => currentRoutes?.candidates.find((c) => c.id === id)?.label ?? 'no route';
  const selectedLabel = routeLabel(data.selectedRouteId);
  const option = data.options.find((o) => o.drainId === viewDrain) ?? data.options[0];
  const previewOn = simulationPreview?.comparisonId === data.comparisonId && simulationPreview.drainId === option.drainId;

  return (
    <div className="intervention-result" aria-labelledby="intervention-result-title">
      <h3 id="intervention-result-title" className="section-heading">
        Ranked result <SimulatedTag />
      </h3>
      <p className="rank-reason">{rankReason(data, selectedLabel)}</p>

      <ol className="rank-list">
        {data.options.map((o) => (
          <li key={o.drainId} className={`rank-item${o.rank === 1 && !data.noEstimatedBenefit ? ' rank-item--first' : ''}`}>
            <span className="rank-item__rank" aria-hidden="true">
              {o.rank}
            </span>
            <span className="rank-item__body">
              <span className="rank-item__title">
                <span className="visually-hidden">Rank {o.rank}: </span>
                Clear {o.drainId} · {o.drainLabel}
              </span>
              <span className="detail">
                Route exposure {formatExposure(o.routeExposureBefore)} → {formatExposure(o.routeExposureAfter)} (
                {o.exposureReduction > 0 ? `−${o.exposureReduction.toFixed(2)}` : 'no change'}) · {pluralize(o.segmentsLeavingHigh, 'segment')} out of High ·{' '}
                {pluralize(o.affectedRouteCount, 'route')} affected
                {!o.hasEstimatedBenefit && ' · no estimated benefit'}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <fieldset className="segmented segmented--compact">
        <legend>Inspect simulation</legend>
        {data.options.map((o) => (
          <label key={o.drainId} className="segmented__option">
            <input type="radio" name="inspect-drain" checked={viewDrain === o.drainId} onChange={() => setViewDrain(o.drainId)} />
            <span>Clear {o.drainId}</span>
          </label>
        ))}
      </fieldset>

      <BeforeAfter data={data} option={option} routeLabel={routeLabel} />

      <button
        type="button"
        className="btn btn--secondary btn--block"
        aria-pressed={previewOn}
        onClick={() => setSimulationPreview(previewOn ? null : { comparisonId: data.comparisonId, drainId: option.drainId })}
      >
        {previewOn ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
        {previewOn ? 'Show baseline on map' : `Show ${option.drainId} simulation on map`}
      </button>

      <details className="assumptions" open>
        <summary>Assumptions</summary>
        <ul>
          {data.assumptions.statements.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p className="detail">
          Baseline snapshot <span className="mono">{data.baselineSnapshotId}</span> · {data.modelVersion} ·{' '}
          <time className="mono" dateTime={data.createdAt}>{formatTimeIST(data.createdAt)}</time>
        </p>
      </details>
      <HowEstimatedButton topic="simulation" />
    </div>
  );
}

function BeforeAfter({
  data,
  option,
  routeLabel,
}: {
  data: InterventionComparison;
  option: InterventionOption;
  routeLabel: (id: string | null) => string;
}) {
  const { segmentsById } = useAppState();
  const highBefore = option.segmentChanges.filter((c) => c.beforeClass === 'high').length;
  const highAfter = option.segmentChanges.filter((c) => c.afterClass === 'high').length;
  const recBefore = data.baselineRouteOutcome.recommendedCandidateId;
  const recAfter = option.routeOutcomeAfter.recommendedCandidateId;
  const routeChanges = recBefore !== recAfter;

  return (
    <>
      <div className="before-after">
        <section className="before-after__card" aria-labelledby="ba-baseline">
          <h4 id="ba-baseline" className="before-after__title">
            Baseline
          </h4>
          <dl>
            <div>
              <dt>Selected route exposure</dt>
              <dd className="metric">{formatExposure(option.routeExposureBefore)}</dd>
            </div>
            <div>
              <dt>Affected segments in High</dt>
              <dd className="metric">{highBefore}</dd>
            </div>
            <div>
              <dt>Route advice</dt>
              <dd>
                {routeLabel(recBefore)} <span className="detail">({OUTCOME_SHORT[data.baselineRouteOutcome.outcome]})</span>
              </dd>
            </div>
          </dl>
        </section>
        <section className="before-after__card before-after__card--simulated" aria-labelledby="ba-simulated">
          <h4 id="ba-simulated" className="before-after__title">
            <SimulatedTag /> Clear {option.drainId}
          </h4>
          <dl>
            <div>
              <dt>Selected route exposure</dt>
              <dd className="metric">{formatExposure(option.routeExposureAfter)}</dd>
            </div>
            <div>
              <dt>Affected segments in High</dt>
              <dd className="metric">{highAfter}</dd>
            </div>
            <div>
              <dt>Route advice</dt>
              <dd>
                {routeLabel(recAfter)} <span className="detail">({OUTCOME_SHORT[option.routeOutcomeAfter.outcome]})</span>
              </dd>
            </div>
          </dl>
        </section>
      </div>
      {routeChanges && (
        <p className="callout callout--simulated">
          In this simulation, route advice changes from {routeLabel(recBefore)} to {routeLabel(recAfter)}.
        </p>
      )}
      <table className="data-table">
        <caption>
          Affected segments: drain clearance may lower risk on {pluralize(option.segmentChanges.filter((c) => (c.afterScore ?? 0) < (c.beforeScore ?? 0)).length, 'segment')}
        </caption>
        <thead>
          <tr>
            <th scope="col">Segment</th>
            <th scope="col">Baseline</th>
            <th scope="col">Simulated</th>
          </tr>
        </thead>
        <tbody>
          {option.segmentChanges.map((c) => (
            <tr key={c.segmentId}>
              <th scope="row">
                {segmentsById.get(c.segmentId)?.name ?? c.segmentId}
                <span className="detail table-source mono">{c.segmentId}</span>
              </th>
              <td>
                <StatusBadge status={c.beforeClass} size="sm" /> <span className="mono">{formatScore(c.beforeScore)}</span>
              </td>
              <td>
                <StatusBadge status={c.afterClass} size="sm" /> <span className="mono">{formatScore(c.afterScore)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
