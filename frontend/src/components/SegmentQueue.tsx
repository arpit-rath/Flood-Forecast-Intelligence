import { useMemo, useState } from 'react';
import type { RiskClass } from '../api/types';
import { formatScore, pluralize } from '../lib/format';
import { useAppState } from '../state/AppState';
import { StatusBadge, Tag } from './StatusBadge';

const CLASS_RANK: Record<RiskClass, number> = { high: 0, watch: 1, low: 2, unknown: 3 };

/** Ranked segment list: the text equivalent of the map (Design-System.md §6). */
export function SegmentQueue({ onOpen }: { onOpen: (id: string) => void }) {
  const { pilot, riskById, reports, selectedSegmentId, snapshot } = useAppState();
  const [recentOnly, setRecentOnly] = useState(false);
  const [lowConfidenceOnly, setLowConfidenceOnly] = useState(false);

  const reportCount = useMemo(() => {
    const counts = new Map<string, number>();
    const list = 'data' in reports && reports.data ? reports.data : [];
    for (const r of list) if (r.reviewStatus !== 'rejected') counts.set(r.segmentId, (counts.get(r.segmentId) ?? 0) + 1);
    return counts;
  }, [reports]);

  const rows = useMemo(() => {
    if (pilot.status !== 'ready') return [];
    return pilot.data.segments.features
      .map((f) => ({ segment: f.properties, risk: riskById.get(f.id) }))
      .filter(({ segment, risk }) => {
        if (recentOnly && !reportCount.get(segment.id)) return false;
        if (lowConfidenceOnly && !(risk?.lowConfidence || !risk || risk.class === 'unknown')) return false;
        return true;
      })
      .sort((a, b) => {
        const ca = a.risk?.class ?? 'unknown';
        const cb = b.risk?.class ?? 'unknown';
        return CLASS_RANK[ca] - CLASS_RANK[cb] || (b.risk?.score ?? -1) - (a.risk?.score ?? -1) || a.segment.id.localeCompare(b.segment.id);
      });
  }, [pilot, riskById, recentOnly, lowConfidenceOnly, reportCount]);

  return (
    <section className="segment-queue" aria-labelledby="segment-queue-title">
      <div className="queue-header">
        <h2 id="segment-queue-title" className="panel-heading">
          Road segments
        </h2>
        <fieldset className="chip-group">
          <legend className="visually-hidden">Filter segments</legend>
          <label className="chip">
            <input type="checkbox" checked={recentOnly} onChange={(e) => setRecentOnly(e.target.checked)} />
            <span>Recent reports</span>
          </label>
          <label className="chip">
            <input type="checkbox" checked={lowConfidenceOnly} onChange={(e) => setLowConfidenceOnly(e.target.checked)} />
            <span>Low confidence</span>
          </label>
        </fieldset>
        <p className="detail" aria-live="polite">
          {pluralize(rows.length, 'segment')} · ranked by estimated risk
          {snapshot.status === 'error' ? ' · no current risk data, all shown as Unknown' : ''}
        </p>
      </div>
      <ol className="queue-list">
        {rows.map(({ segment, risk }) => {
          const count = reportCount.get(segment.id) ?? 0;
          const active = selectedSegmentId === segment.id;
          return (
            <li key={segment.id}>
              <button
                type="button"
                className={`queue-item${active ? ' queue-item--active' : ''}`}
                aria-current={active ? 'true' : undefined}
                onClick={() => onOpen(segment.id)}
              >
                <span className="queue-item__top">
                  <StatusBadge status={risk?.class ?? 'unknown'} size="sm" />
                  <span className="mono metric-sm">{formatScore(risk?.score)}</span>
                </span>
                <span className="queue-item__name">{segment.name}</span>
                <span className="queue-item__tags">
                  <span className="mono detail">{segment.id}</span>
                  {risk?.closure?.status === 'confirmed' && <StatusBadge status="closed" size="sm" />}
                  {risk?.lowConfidence && <Tag tone="warning">Low confidence</Tag>}
                  {count > 0 && <Tag>{pluralize(count, 'report')}</Tag>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
