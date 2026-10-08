import { Ban, Camera, X } from 'lucide-react';
import type { FeatureKey } from '../api/types';
import { FEATURE_LABEL, RISK_DESCRIPTION, observationHeadline } from '../lib/copy';
import { formatPercent, formatScore, formatTimeIST, pluralize } from '../lib/format';
import { useAppState } from '../state/AppState';
import { HowEstimatedButton } from './HowEstimated';
import { ReviewBadge, StatusBadge, Tag } from './StatusBadge';

const FEATURE_ORDER: FeatureKey[] = ['R', 'T', 'D', 'O'];

const LOW_CONFIDENCE_REASON: Record<string, string> = {
  coverage_below_threshold: 'some inputs are missing',
  weather_stale: 'the weather data is stale',
  report_stale: 'the report evidence is stale',
};

export function SegmentCard({
  segmentId,
  onReport,
  onClose,
  headingLevel = 2,
}: {
  segmentId: string;
  onReport?: () => void;
  onClose?: () => void;
  headingLevel?: 2 | 3;
}) {
  const { segmentsById, riskById, snapshot, reports } = useAppState();
  const segment = segmentsById.get(segmentId);
  const risk = riskById.get(segmentId);
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const Sub = headingLevel === 2 ? 'h3' : 'h4';
  if (!segment) return null;

  const segmentReports = reports.status === 'ready' ? reports.data.filter((r) => r.segmentId === segmentId) : [];
  const acceptedIds = snapshot.status === 'ready' ? new Set(snapshot.data.acceptedReportIds) : new Set<string>();
  const recentCount = segmentReports.filter((r) => r.reviewStatus !== 'rejected').length;
  const cls = risk?.class ?? 'unknown';
  const closed = risk?.closure?.status === 'confirmed';

  return (
    <article className="card segment-card" aria-labelledby={`seg-${segmentId}-title`}>
      <header className="card__header">
        <div>
          <H id={`seg-${segmentId}-title`} className="card__title">
            {segment.name}
          </H>
          <p className="card__subtitle mono">{segment.id}</p>
        </div>
        {onClose && (
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close segment details">
            <X aria-hidden="true" size={20} />
          </button>
        )}
      </header>

      <div className="segment-card__status">
        <StatusBadge status={cls} />
        {closed && <StatusBadge status="closed" />}
        {risk?.lowConfidence && <Tag tone="warning">Low confidence</Tag>}
        <span className="metric" aria-label={`Score ${formatScore(risk?.score)}`}>
          {formatScore(risk?.score)}
        </span>
      </div>

      <p className="segment-card__summary">
        {!risk
          ? snapshot.status === 'error'
            ? 'Unknown: no current risk data is available in this mode.'
            : 'Unknown: risk not loaded yet.'
          : cls === 'unknown'
            ? `Unknown: not enough data for this road (missing ${risk.missing.map((k) => FEATURE_LABEL[k].toLowerCase()).join(', ')}).`
            : `${RISK_DESCRIPTION[cls]}${recentCount > 0 ? ` · ${pluralize(recentCount, 'recent report')}` : ''}`}
      </p>

      {closed && risk?.closure && (
        <div className="callout callout--closed">
          <Ban aria-hidden="true" size={18} />
          <p>
            <strong>Confirmed closure.</strong>{risk.closure.reason && ` ${risk.closure.reason}.`}
            {risk.closure.setBy && ` Set by ${risk.closure.setBy}`}
            {risk.closure.setAt && <>{' '}at <time className="mono" dateTime={risk.closure.setAt}>{formatTimeIST(risk.closure.setAt)}</time></>}
            {risk.closure.expiresAt && (
              <>
                , until <time className="mono" dateTime={risk.closure.expiresAt}>{formatTimeIST(risk.closure.expiresAt)}</time>
              </>
            )}
            . Routes crossing it are excluded.
          </p>
        </div>
      )}

      {risk && (
        <>
          <p className="detail">
            Coverage {formatPercent(risk.coverage)} of inputs
            {risk.lowConfidence &&
              ` · low confidence because ${risk.lowConfidenceReasons.map((r) => LOW_CONFIDENCE_REASON[r] ?? r).join(' and ')}`}
          </p>
          <table className="data-table">
            <caption className="visually-hidden">Inputs behind this estimate</caption>
            <thead>
              <tr>
                <th scope="col">Input</th>
                <th scope="col">Value</th>
                <th scope="col">Weight</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_ORDER.map((k) => {
                const f = risk.features[k];
                return (
                  <tr key={k}>
                    <th scope="row">
                      {FEATURE_LABEL[k]}
                      <span className="detail table-source">{f.value === null ? 'Missing: left out, not counted as zero' : f.source}</span>
                    </th>
                    <td className="mono">{f.value === null ? '—' : f.value.toFixed(2)}</td>
                    <td className="mono">{f.weight.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <section className="segment-card__evidence" aria-label="Photo evidence">
        <Sub className="section-label">Photo evidence</Sub>
        {segmentReports.length === 0 ? (
          <p className="detail">No photo reports for this road.</p>
        ) : (
          <ul className="evidence-list">
            {segmentReports.map((r) => (
              <li key={r.id}>
                <div className="evidence-list__row">
                  <ReviewBadge status={r.reviewStatus} />
                  <span className="mono detail">
                    {r.id} · <time dateTime={r.createdAt}>{formatTimeIST(r.createdAt)}</time>
                  </span>
                </div>
                <p className="detail">
                  {r.observations
                    ? `${observationHeadline(r.observations.visible_water)}${r.reviewStatus === 'pending_review' ? '; awaiting review' : ''}.`
                    : r.reviewStatus === 'analysis_pending'
                      ? 'Analysis running.'
                      : 'No automated observation; responder reviews the photo directly.'}
                  {acceptedIds.has(r.id) && ' Counted in this estimate.'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="card__footer">
        <p className="detail">
          {risk ? (
            <>
              Calculated <time className="mono" dateTime={risk.computedAt}>{formatTimeIST(risk.computedAt)}</time> ·{' '}
              <span className="mono">{risk.modelVersion}</span> · {segment.source}
            </>
          ) : (
            segment.source
          )}
        </p>
        <div className="card__actions">
          {onReport && (
            <button type="button" className="btn btn--secondary" onClick={onReport}>
              <Camera aria-hidden="true" size={18} /> Report a photo for this road
            </button>
          )}
          <HowEstimatedButton />
        </div>
      </footer>
    </article>
  );
}
