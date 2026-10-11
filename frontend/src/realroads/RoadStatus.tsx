import { CircleCheck, CircleHelp, Clock3, ShieldAlert } from 'lucide-react';
import type { PublicRoadAlert, RealRoadEvidence } from '../../../contracts/types';
import { currentConfirmedAlert, roadCondition, type RoadFeature } from './model';

function formatTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) + ' IST';
}

export function RoadStatus({ road, evidence, alerts = [], now }: { road: RoadFeature; evidence: RealRoadEvidence[]; alerts?: PublicRoadAlert[]; now: Date }) {
  const condition = roadCondition(road.id, evidence, now);
  const sourceAlert = currentConfirmedAlert(road.id, alerts);
  return (
    <div className="real-road-status">
      {sourceAlert || condition.kind === 'confirmed_blockage' ? (
        <p className="real-road-status__badge real-road-status__badge--blocked"><ShieldAlert aria-hidden="true" size={18} /> Responder-confirmed blockage</p>
      ) : (
        <p className="real-road-status__badge"><CircleHelp aria-hidden="true" size={18} /> Unknown flood condition</p>
      )}
      {condition.latestReviewed?.reviewState === 'Cleared' && (
        <p className="real-road-status__evidence"><CircleCheck aria-hidden="true" size={17} /> Source: {condition.latestReviewed.source === 'responder_field_check' ? 'responder field check' : 'responder-reviewed photo'}; responder-cleared report observed {formatTime(condition.latestReviewed.observedAt)}. Review decision: cleared at {formatTime(condition.latestReviewed.reviewedAt)}; evidence expires {formatTime(condition.latestReviewed.expiresAt)}. This does not establish current safety.</p>
      )}
      {condition.latestReviewed?.reviewState === 'Confirmed Blockage' && (
        <p className="real-road-status__evidence">Source: {condition.latestReviewed.source === 'responder_field_check' ? 'responder field check' : 'responder-reviewed photo'}; observed {formatTime(condition.latestReviewed.observedAt)}. Review decision: confirmed blockage at {formatTime(condition.latestReviewed.reviewedAt)}; evidence expires {formatTime(condition.latestReviewed.expiresAt)}.</p>
      )}
      {condition.pending.length > 0 && (
        <p className="real-road-status__evidence"><Clock3 aria-hidden="true" size={17} /> {condition.pending.length} unreviewed report{condition.pending.length === 1 ? '' : 's'}; source: resident photo; Pending Review, not evidence of a blockage. Observation time: {formatTime(condition.pending[0].observedAt)}; evidence expires {formatTime(condition.pending[0].expiresAt)}.</p>
      )}
      {sourceAlert && <p className="real-road-status__evidence">Source: <a href={sourceAlert.advisoryUrl || sourceAlert.canonicalSourceUrl} target="_blank" rel="noopener noreferrer">{sourceAlert.sourceName} advisory</a>. Stated cause: {sourceAlert.statedCause || 'not stated'}. Published {formatTime(sourceAlert.publishedAt)}; retrieved {formatTime(sourceAlert.retrievedAt)}. Responder-confirmed flood blockage reviewed {formatTime(sourceAlert.reviewedAt)}. Ground instructions take precedence.</p>}
      {!sourceAlert && !condition.latestReviewed && condition.pending.length === 0 && <p className="real-road-status__evidence">No current, reviewed flood or blockage observation for this road.</p>}
    </div>
  );
}
