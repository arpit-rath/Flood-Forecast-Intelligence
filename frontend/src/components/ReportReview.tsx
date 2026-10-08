import { Check, ImageOff, X } from 'lucide-react';
import { useState } from 'react';
import { ApiError, type Report, type ReviewStatus } from '../api/types';
import {
  ACCESS_LABEL,
  DRAIN_STATE_LABEL,
  HAZARD_LABEL,
  REVIEW_DESCRIPTION,
  VISIBLE_WATER_LABEL,
  observationHeadline,
} from '../lib/copy';
import { formatScore, formatTimeIST, pluralize } from '../lib/format';
import { useAppState } from '../state/AppState';
import { ReviewBadge, StatusBadge } from './StatusBadge';

const REVIEWABLE: ReviewStatus[] = ['pending_review', 'needs_manual_review'];

export function ReportQueue({ onOpen, activeId }: { onOpen: (id: string) => void; activeId: string | null }) {
  const { reports, segmentsById } = useAppState();
  const [filter, setFilter] = useState<'awaiting' | 'all'>('awaiting');
  const list = reports.status === 'ready' || reports.status === 'error' ? (reports.data ?? []) : [];
  const awaiting = list.filter((r) => REVIEWABLE.includes(r.reviewStatus) || r.reviewStatus === 'analysis_pending');
  const shown = filter === 'awaiting' ? awaiting : list;

  return (
    <section className="report-queue" aria-labelledby="report-queue-title">
      <div className="queue-header">
        <h2 id="report-queue-title" className="panel-heading">
          Photo reports
        </h2>
        <fieldset className="chip-group">
          <legend className="visually-hidden">Show reports</legend>
          <label className="chip">
            <input type="radio" name="report-filter" checked={filter === 'awaiting'} onChange={() => setFilter('awaiting')} />
            <span>Awaiting review ({awaiting.length})</span>
          </label>
          <label className="chip">
            <input type="radio" name="report-filter" checked={filter === 'all'} onChange={() => setFilter('all')} />
            <span>All ({list.length})</span>
          </label>
        </fieldset>
      </div>
      {reports.status === 'loading' && <p className="detail">Loading reports…</p>}
      {reports.status === 'error' && <p className="field-error">Reports could not be refreshed: {reports.error.message}</p>}
      {shown.length === 0 && reports.status !== 'loading' && <p className="detail">No reports awaiting review.</p>}
      <ul className="queue-list">
        {shown.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={`queue-item${activeId === r.id ? ' queue-item--active' : ''}`}
              aria-current={activeId === r.id ? 'true' : undefined}
              onClick={() => onOpen(r.id)}
            >
              <span className="queue-item__top">
                <ReviewBadge status={r.reviewStatus} />
                <span className="mono detail">{formatTimeIST(r.createdAt)}</span>
              </span>
              <span className="queue-item__name">{segmentsById.get(r.segmentId)?.name ?? r.segmentId}</span>
              <span className="detail">
                {r.id}
                {r.observations ? ` · ${VISIBLE_WATER_LABEL[r.observations.visible_water]}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReportReviewCard({ reportId, onClose }: { reportId: string; onClose?: () => void }) {
  const { reports, segmentsById, riskById, previousSnapshot, reviewReport, selectSegment } = useAppState();
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const list = 'data' in reports && reports.data ? reports.data : [];
  const report = list.find((r) => r.id === reportId);
  if (!report) return <p className="detail">Report not found.</p>;

  const segmentName = segmentsById.get(report.segmentId)?.name ?? report.segmentId;
  const reviewable = REVIEWABLE.includes(report.reviewStatus);

  const decide = async (decision: 'accept' | 'reject') => {
    setBusy(decision);
    setError(null);
    try {
      const res = await reviewReport(report.id, decision);
      setOutcome(res.note ?? (res.snapshotId ? 'Risk estimate recalculated with this evidence.' : null));
    } catch (err) {
      setError(`${err instanceof ApiError ? err.message : 'The review could not be saved.'} Nothing was changed; try again.`);
    } finally {
      setBusy(null);
    }
  };

  const risk = riskById.get(report.segmentId);
  const before = previousSnapshot?.segments.find((s) => s.segmentId === report.segmentId);
  const changed = report.reviewStatus === 'accepted' && before && risk && before.score !== risk.score;

  return (
    <article className="card review-card" aria-labelledby={`review-${report.id}-title`}>
      <header className="card__header">
        <div>
          <h2 id={`review-${report.id}-title`} className="card__title">
            Review {report.id}
          </h2>
          <p className="card__subtitle">
            <button type="button" className="link-button" onClick={() => selectSegment(report.segmentId)}>
              {segmentName}
            </button>{' '}
            <span className="mono">{report.segmentId}</span>
          </p>
        </div>
        {onClose && (
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close report review">
            <X aria-hidden="true" size={20} />
          </button>
        )}
      </header>

      <div className="review-card__status">
        <ReviewBadge status={report.reviewStatus} />
        <p className="detail">{REVIEW_DESCRIPTION[report.reviewStatus]}</p>
      </div>

      <ReportImage report={report} />

      <dl className="meta-list">
        <div>
          <dt>Uploaded</dt>
          <dd className="mono">{formatTimeIST(report.createdAt)}</dd>
        </div>
        <div>
          <dt>Captured</dt>
          <dd className="mono">{report.capturedAt ? formatTimeIST(report.capturedAt) : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd className="mono">
            {report.point[1].toFixed(5)}, {report.point[0].toFixed(5)}
          </dd>
        </div>
      </dl>

      {report.note && (
        <div className="reporter-note">
          <p className="section-label">Reporter note (unverified)</p>
          <p>{report.note}</p>
        </div>
      )}

      <ObservationPanel report={report} />

      {reviewable && (
        <div className="review-card__actions">
          <p className="detail">
            Accepting adds this observation to the risk estimate for {segmentName} only. Rejecting keeps it in history without
            affecting scores.
          </p>
          <div className="button-row">
            <button type="button" className="btn btn--primary" aria-disabled={busy !== null} onClick={() => busy || decide('accept')}>
              <Check aria-hidden="true" size={18} />
              {busy === 'accept' ? 'Accepting…' : 'Accept as evidence'}
            </button>
            <button type="button" className="btn btn--destructive" aria-disabled={busy !== null} onClick={() => busy || decide('reject')}>
              <X aria-hidden="true" size={18} />
              {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        </div>
      )}

      {report.reviewStatus === 'analysis_pending' && (
        <p className="detail">Review opens when image analysis finishes or times out.</p>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {report.review && (
        <p className="detail">
          {report.review.decision === 'accept' ? 'Accepted' : 'Rejected'} by {report.review.reviewer} at{' '}
          <time className="mono" dateTime={report.review.reviewedAt}>{formatTimeIST(report.review.reviewedAt)}</time>.
        </p>
      )}

      {(outcome || changed) && (
        <div className="callout callout--info" role="status">
          <p>{outcome}</p>
          {changed && before && risk && (
            <p className="change-line">
              {segmentName}: <StatusBadge status={before.class} size="sm" /> {formatScore(before.score)} →{' '}
              <StatusBadge status={risk.class} size="sm" /> {formatScore(risk.score)}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function ReportImage({ report }: { report: Report }) {
  if (report.imageUrl) {
    return (
      <figure className="review-card__image">
        <img src={report.imageUrl} alt={`Photo submitted for ${report.segmentId}`} />
        <figcaption className="detail">Private review copy. Public display requires consent and strips metadata.</figcaption>
      </figure>
    );
  }
  return (
    <div className="review-card__image review-card__image--empty">
      <ImageOff aria-hidden="true" size={28} />
      <p className="detail">
        {report.source === 'fixture' ? 'Fixture report: no photo is bundled with the demo data.' : 'Photo not available.'}
      </p>
    </div>
  );
}

function ObservationPanel({ report }: { report: Report }) {
  const obs = report.observations;
  if (!obs) {
    return (
      <section className="observation-panel" aria-label="Photo analysis">
        <p className="section-label">Photo analysis</p>
        <p>
          {report.analysis.status === 'pending'
            ? 'Analysis running…'
            : `No automated observation${report.analysis.failureReason ? `: ${report.analysis.failureReason.toLowerCase()}` : ''}. Review the photo directly.`}
        </p>
      </section>
    );
  }
  return (
    <section className="observation-panel" aria-label="Photo analysis">
      <p className="section-label">
        Photo analysis {report.analysis.provider === 'fixture' ? '(fixture response, not a model call)' : `(${report.analysis.model ?? 'Bedrock'})`}
      </p>
      <p className="observation-panel__headline">
        {observationHeadline(obs.visible_water)}
        {report.reviewStatus === 'pending_review' ? '; awaiting review.' : '.'}
      </p>
      <blockquote className="observation-panel__summary">{obs.evidence_summary}</blockquote>
      <dl className="meta-list meta-list--grid">
        <div>
          <dt>Visible water</dt>
          <dd>{VISIBLE_WATER_LABEL[obs.visible_water]}</dd>
        </div>
        <div>
          <dt>Drain</dt>
          <dd>{DRAIN_STATE_LABEL[obs.drain_state]}</dd>
        </div>
        <div>
          <dt>Access</dt>
          <dd>{ACCESS_LABEL[obs.access_concern]}</dd>
        </div>
        <div>
          <dt>Hazards</dt>
          <dd>{obs.visible_hazards.length ? obs.visible_hazards.map((h) => HAZARD_LABEL[h]).join(', ') : 'None identified'}</dd>
        </div>
        <div>
          <dt>Model confidence</dt>
          <dd>
            <span className="mono">{obs.confidence.toFixed(2)}</span>{' '}
            <span className="detail">model's own indicator, not a calibrated probability</span>
          </dd>
        </div>
      </dl>
      <p className="detail">
        Observations describe what is visible only. No water depth, flood extent or passability is inferred from one photo.
        {obs.visible_hazards.length > 0 && ` ${pluralize(obs.visible_hazards.length, 'hazard')} noted.`}
      </p>
    </section>
  );
}
