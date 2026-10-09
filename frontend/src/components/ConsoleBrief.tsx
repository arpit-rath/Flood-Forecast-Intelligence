import { ArrowRight } from 'lucide-react';
import type { RiskClass } from '../api/types';
import { formatScore, formatTimeIST, pluralize } from '../lib/format';
import { useAppState } from '../state/AppState';
import { StatusBadge } from './StatusBadge';

const CLASS_RANK: Record<RiskClass, number> = { high: 0, watch: 1, low: 2, unknown: 3 };
const TALLY_ORDER: RiskClass[] = ['high', 'watch', 'low', 'unknown'];

/**
 * Drawer content before anything is selected: the next steps of the
 * responder flow and a text tally of the current estimate. Counts come from
 * the snapshot on screen; nothing is invented when data is missing.
 */
export function ConsoleBrief({
  onOpenReport,
  onOpenSegment,
  onOpenSimulation,
}: {
  onOpenReport: (id: string) => void;
  onOpenSegment: (id: string) => void;
  onOpenSimulation: () => void;
}) {
  const { reports, snapshot, segmentsById } = useAppState();
  const list = 'data' in reports && reports.data ? reports.data : [];
  const awaiting = list
    .filter((r) => r.reviewStatus === 'pending_review' || r.reviewStatus === 'needs_manual_review')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const next = awaiting[0];

  const segments = snapshot.status === 'ready' ? snapshot.data.segments : [];
  const top = [...segments].sort(
    (a, b) => CLASS_RANK[a.class] - CLASS_RANK[b.class] || (b.score ?? -1) - (a.score ?? -1) || a.segmentId.localeCompare(b.segmentId),
  )[0];
  const tally = new Map<RiskClass, number>();
  for (const s of segments) tally.set(s.class, (tally.get(s.class) ?? 0) + 1);
  const closedCount = segments.filter((s) => s.closure?.status === 'confirmed').length;

  return (
    <section className="brief" aria-labelledby="brief-title">
      <div className="panel-intro">
        <p className="eyebrow">Nothing selected</p>
        <h2 id="brief-title" className="panel-title">
          Where to start
        </h2>
      </div>

      <ol className="brief-steps">
        <li>
          <span className="brief-steps__index mono" aria-hidden="true">
            1
          </span>
          <div className="brief-steps__body">
            <h3>Review photo evidence</h3>
            {reports.status === 'error' ? (
              <p className="detail">Photo reports are unavailable from this data source.</p>
            ) : (
              <p className="detail">
                {awaiting.length === 0
                  ? 'No photo reports are waiting for review.'
                  : `${pluralize(awaiting.length, 'report')} waiting. Accepting one adds it to the estimate for that road only.`}
              </p>
            )}
            {next && (
              <div className="brief-steps__action">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => onOpenReport(next.id)}>
                  Open next report <ArrowRight aria-hidden="true" size={16} />
                </button>
                <span className="detail">
                  <span className="mono">{next.id}</span> · {segmentsById.get(next.segmentId)?.name ?? next.segmentId}
                </span>
              </div>
            )}
          </div>
        </li>
        <li>
          <span className="brief-steps__index mono" aria-hidden="true">
            2
          </span>
          <div className="brief-steps__body">
            <h3>Inspect the highest-ranked road</h3>
            {top ? (
              <div className="brief-steps__action">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => onOpenSegment(top.segmentId)}>
                  Open road <ArrowRight aria-hidden="true" size={16} />
                </button>
                <span className="detail">
                  {segmentsById.get(top.segmentId)?.name ?? top.segmentId} · <StatusBadge status={top.class} size="sm" />{' '}
                  <span className="mono">{formatScore(top.score)}</span>
                </span>
              </div>
            ) : (
              <p className="detail">No current risk estimate is available.</p>
            )}
          </div>
        </li>
        <li>
          <span className="brief-steps__index mono" aria-hidden="true">
            3
          </span>
          <div className="brief-steps__body">
            <h3>Compare two drain actions</h3>
            <p className="detail">Simulates clearing each modelled drain against the same baseline. Advisory only.</p>
            <div className="brief-steps__action">
              <button type="button" className="btn btn--secondary btn--sm" onClick={onOpenSimulation}>
                Go to drain action <ArrowRight aria-hidden="true" size={16} />
              </button>
            </div>
          </div>
        </li>
      </ol>

      {snapshot.status === 'ready' && (
        <div className="tally">
          <h3 className="section-label">
            Pilot roads by estimate ·{' '}
            <time className="mono" dateTime={snapshot.data.computedAt}>
              {formatTimeIST(snapshot.data.computedAt)}
            </time>
          </h3>
          <dl className="tally__list">
            {TALLY_ORDER.map((cls) => (
              <div key={cls} className="tally__item">
                <dt>
                  <StatusBadge status={cls} size="sm" />
                </dt>
                <dd className="mono">{tally.get(cls) ?? 0}</dd>
              </div>
            ))}
            <div className="tally__item">
              <dt>
                <StatusBadge status="closed" size="sm" />
              </dt>
              <dd className="mono">{closedCount}</dd>
            </div>
          </dl>
          <p className="detail">Closed roads also carry a risk class; they are excluded from routes.</p>
        </div>
      )}
    </section>
  );
}
