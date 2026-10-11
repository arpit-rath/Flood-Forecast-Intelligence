import { CircleCheck, CircleHelp, Clock3, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { PrivateRoadAlert, PublicRoadAlert, RealRoadId, RealRoadReference } from '../../../contracts/types';
import type { SignedInUser } from '../auth/cognito';
import { roadAlertApi } from './alertApi';

function time(value: string | null): string {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) + ' IST'
    : value || 'Not stated';
}

export function RoadAlerts({ user, view, selectedRoadId, selectedPoint, geometryVersion, onAlertsChange, onSelectCandidate }: {
  user: SignedInUser | null;
  view: 'resident' | 'responder';
  selectedRoadId: RealRoadId | null;
  selectedPoint: [number, number] | null;
  geometryVersion: string | undefined;
  onAlertsChange?: (alerts: PublicRoadAlert[]) => void;
  onSelectCandidate?: (roadId: RealRoadId) => void;
}) {
  const [alerts, setAlerts] = useState<PublicRoadAlert[]>([]);
  const [queue, setQueue] = useState<PrivateRoadAlert[]>([]);
  const [status, setStatus] = useState(import.meta.env.VITE_USE_MOCKS === 'false' ? 'Checking the local road-alert feed…' : 'Road-alert API is not part of fixture/mock mode. No source alerts are shown.');
  const [error, setError] = useState('');
  const [document, setDocument] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const responder = view === 'responder' && Boolean(user?.roles.includes('varuna-responder'));
  const enabled = import.meta.env.VITE_USE_MOCKS === 'false';

  const refresh = useCallback(async () => {
    try {
      const publicResult = await roadAlertApi.publicList();
      if (!Array.isArray(publicResult?.alerts)) throw new Error('Invalid public road-alert response.');
      setAlerts(publicResult.alerts);
      onAlertsChange?.(publicResult.alerts);
      setStatus(publicResult.alerts.length ? 'Source-backed alerts · limited OSM coverage' : 'No source alerts imported into this local session. All mapped roads remain Unknown unless separate reviewed evidence exists.');
      if (responder && user) {
        const privateResult = await roadAlertApi.privateList(user.accessToken);
        if (!Array.isArray(privateResult?.alerts)) throw new Error('Invalid private road-alert response.');
        setQueue(privateResult.alerts);
      } else setQueue([]);
    } catch (cause) {
      setAlerts([]); setQueue([]);
      onAlertsChange?.([]);
      setStatus('Road-alert feed unavailable. Do not infer current conditions; roads remain Unknown without other reviewed evidence.');
      throw cause;
    }
  }, [onAlertsChange, responder, user]);

  useEffect(() => {
    if (!enabled) return;
    const initial = window.setTimeout(() => { void refresh().catch(() => undefined); }, 0);
    return () => { window.clearTimeout(initial); };
  }, [enabled, refresh]);

  async function importSource() {
    if (!user || !responder) return;
    setBusy(true); setError('');
    try {
      const parsed: unknown = JSON.parse(document);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Paste one normalized source-document JSON object.');
      await roadAlertApi.importDocument(user.accessToken, parsed as Record<string, unknown>);
      setDocument(''); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Source import failed.'); }
    finally { setBusy(false); }
  }

  async function decide(alert: PrivateRoadAlert, decision: 'confirm_flood_blockage' | 'clear' | 'reject') {
    if (!user || !responder) return;
    setBusy(true); setError('');
    try {
      let road: RealRoadReference | undefined;
      if (decision === 'confirm_flood_blockage') {
        if (!selectedRoadId || !selectedPoint || !geometryVersion || !alert.candidateRoads.some((candidate) => candidate.roadId === selectedRoadId)) {
          throw new Error('Select this alert’s candidate road and a precise point on that road in the map. The server will verify both.');
        }
        road = { roadId: selectedRoadId, geometryVersion, point: selectedPoint };
      }
      await roadAlertApi.review(user.accessToken, alert.id, decision, reason, road);
      setReason(''); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review failed.'); }
    finally { setBusy(false); }
  }

  return <section className="real-preview__detail real-alerts" aria-label="Delhi source alerts">
    <h2>Delhi source alerts · local review</h2>
    <p className="detail">Manually imported Delhi Traffic Police material, not a live feed or prediction. Ground instructions, police personnel, barricades and signs take precedence. “Reported / Unverified” and proposed matches leave road condition Unknown. This feed covers only the mapped extract.</p>
    <p className="detail" role="status">{status}</p>
    {alerts.length > 0 && <ul className="real-alerts__list" aria-label="Public source alerts">{alerts.map((alert) => <li key={alert.id}>
      <h3>{alert.originalHeadline}</h3>
      <p><strong>{alert.state === 'Confirmed Flood Blockage' ? <ShieldAlert aria-hidden="true" size={16} /> : alert.state === 'Cleared' ? <CircleCheck aria-hidden="true" size={16} /> : alert.state === 'Expired' ? <Clock3 aria-hidden="true" size={16} /> : <CircleHelp aria-hidden="true" size={16} />} {alert.state}</strong> · {alert.freshness} · {alert.sourceName}</p>
      <p>Stated cause: {alert.statedCause || 'Not stated'}. Affected wording: {alert.affectedLocation || 'Not stated'}.</p>
      <p>Published: {time(alert.publishedAt || alert.publishedAtText)}; retrieved: {time(alert.retrievedAt)}. Validity: {alert.validFromText || 'not stated'} to {alert.validUntilText || 'not stated'}.</p>
      <p>Source availability: {alert.sourceAvailability}. {alert.matchedRoadId ? `Reviewed road: ${alert.matchedRoadId}. Reviewed: ${time(alert.reviewedAt)}.` : 'No reviewed road match. Road condition remains Unknown.'}</p>
      {alert.proposal && <p className="real-alerts__proposal"><CircleHelp aria-hidden="true" size={16} /> Proposed match: {alert.proposal.displayLabel} · {alert.proposal.confidenceCategory} confidence · {alert.proposal.explanation}. Not a confirmed blockage.</p>}
      {alert.state === 'Reported / Unverified' && alert.resolutionState === 'ambiguous' && <p className="real-alerts__uncertain">Ambiguous match — responder selection required. Road condition remains Unknown.</p>}
      {alert.state === 'Reported / Unverified' && ['outside_coverage', 'stale_snapshot', 'invalid_source_location', 'unlocated'].includes(alert.resolutionState) && <p className="real-alerts__uncertain">Location resolution: {alert.resolutionState.replaceAll('_', ' ')}. No road condition inferred.</p>}
      <p><a href={alert.advisoryUrl || alert.canonicalSourceUrl} target="_blank" rel="noopener noreferrer">Open source advisory</a></p>
    </li>)}</ul>}
    {view === 'responder' && <div className="real-alerts__review">
      <h3>Responder source review</h3>
      {!responder ? <p>Only signed-in varuna-responder members may import and review source alerts.</p> : <>
        <p>Local session only. Paste a manually checked normalized source document; no automatic retrieval occurs. Import and review history are not durable or deployed.</p>
        <label htmlFor="alert-import">Normalized source-document JSON</label>
        <textarea id="alert-import" value={document} maxLength={12000} rows={5} onChange={(event) => setDocument(event.target.value)} />
        <button type="button" className="btn btn--secondary" disabled={busy || !document.trim()} onClick={() => void importSource()}>Import source for review</button>
        <label htmlFor="alert-reason">Review reason (at least 10 characters)</label>
        <textarea id="alert-reason" value={reason} maxLength={500} rows={2} onChange={(event) => setReason(event.target.value)} />
        <ul className="real-alerts__list" aria-label="Private source review queue">{queue.map((alert) => <li key={alert.id}>
          <h4>{alert.originalHeadline} · {alert.state}</h4>
          <p>Match: {alert.resolutionState.replaceAll('_', ' ')}. {alert.candidateRoads.length ? `${alert.candidateRoads.length} candidate way(s); these are not confirmed.` : 'Unlocated in this extract.'}</p>
          <p>Original source text: {alert.originalText}</p>
          {alert.sourceError && <p>Source retrieval note: {alert.sourceError}</p>}
          <ul className="real-alerts__candidates">{alert.candidateRoads.map((candidate) => <li key={candidate.roadId}>
            <strong>{candidate.displayLabel}</strong> ({candidate.roadId}) · {candidate.confidenceCategory} confidence
            <span>Why: {candidate.reason}; evidence: {candidate.matchedEvidence.join(', ')}.</span>
            {candidate.distanceMeters !== null && <span>Distance: {candidate.distanceMeters} m; nearest-way margin: {candidate.ambiguityMarginMeters ?? 'unknown'} m.</span>}
            <span>Context: <a href={candidate.sourceContext.sourceUrl} target="_blank" rel="noopener noreferrer">{candidate.sourceContext.source}</a>. Geometry: {candidate.snapshotGeometryVersion}.</span>
            {alert.reviewState === 'Imported' && <button type="button" className="real-alerts__choose" onClick={() => onSelectCandidate?.(candidate.roadId)}>Select this candidate on map</button>}
          </li>)}</ul>
          {alert.reviewHistory.length > 0 && <p>Latest decision: {alert.reviewHistory.at(-1)?.state} by {alert.reviewHistory.at(-1)?.reviewerSub} at {time(alert.reviewHistory.at(-1)?.reviewedAt ?? null)}. Reason: {alert.reviewHistory.at(-1)?.reason}</p>}
          {alert.reviewState === 'Imported' && <div className="real-preview__decision-actions">
            <button type="button" disabled={busy || reason.trim().length < 10 || alert.freshness !== 'Current' || !alert.candidateRoads.some((candidate) => candidate.roadId === selectedRoadId)} onClick={() => void decide(alert, 'confirm_flood_blockage')}>Confirm flood blockage on selected candidate</button>
            <button type="button" disabled={busy || reason.trim().length < 10} onClick={() => void decide(alert, 'reject')}>Reject alert</button>
          </div>}
          {alert.reviewState === 'Confirmed Flood Blockage' && <button type="button" disabled={busy || reason.trim().length < 10} onClick={() => void decide(alert, 'clear')}>Record clearance (returns Unknown)</button>}
        </li>)}</ul>
      </>}
    </div>}
    {error && <p role="alert" className="field-error">{error}</p>}
  </section>;
}
