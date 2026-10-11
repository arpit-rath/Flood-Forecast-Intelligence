import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RealRoadId, RealRoadReport } from '../../../contracts/types';
import { beginCognitoSignIn, completeCognitoSignIn, endCognitoSignIn, type SignedInUser } from '../auth/cognito';
import { realRoadApi } from './api';
import type { RoadSnapshot } from './model';

let callbackPromise: ReturnType<typeof completeCognitoSignIn> | null = null;

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST' : 'Not recorded';
}

export function RealRoadReporting({ available, roadId, point, roads, view, onChanged }: {
  available: boolean;
  roadId: RealRoadId | null;
  point: [number, number] | null;
  roads: RoadSnapshot;
  view: 'resident' | 'responder';
  onChanged: () => Promise<void>;
}) {
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [note, setNote] = useState('');
  const [manualCoordinates, setManualCoordinates] = useState<{ selection: string; lon: string; lat: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reports, setReports] = useState<RealRoadReport[]>([]);
  const [detail, setDetail] = useState<RealRoadReport | null>(null);
  const key = useRef(crypto.randomUUID());
  const cognito = Boolean(import.meta.env.VITE_COGNITO_DOMAIN && import.meta.env.VITE_COGNITO_CLIENT_ID);
  const local = import.meta.env.VITE_LOCAL_AUTH === 'true';
  const responder = user?.roles.includes('varuna-responder') ?? false;
  const selection = `${roadId ?? ''}:${point?.join(',') ?? ''}`;
  const lon = manualCoordinates?.selection === selection ? manualCoordinates.lon : point ? String(point[0]) : '';
  const lat = manualCoordinates?.selection === selection ? manualCoordinates.lat : point ? String(point[1]) : '';

  useEffect(() => {
    if (!cognito || !window.location.search.includes('code=') && !window.location.search.includes('error=')) return;
    callbackPromise ??= completeCognitoSignIn();
    void callbackPromise.then((session) => { if (session) setUser(session); }).catch((cause) => setError(String(cause)));
  }, [cognito]);

  useEffect(() => {
    if (!available || !responder || view !== 'responder' || !user) return;
    void realRoadApi.list(user.accessToken).then((result) => setReports(result.reports)).catch((cause) => setError(String(cause)));
  }, [available, responder, view, user]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setMessage('');
    if (!available || !user || !roadId || !roads.metadata.geometryVersion || !file) {
      setError('Sign in, select a mapped road, choose a photo, and wait for the versioned real-road API.'); return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 8 * 1024 * 1024) {
      setError('Choose a JPEG, PNG or WebP photo between 1 byte and 8 MB.'); return;
    }
    const longitude = Number(lon), latitude = Number(lat);
    if (!lon.trim() || !lat.trim() || !Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      setError('Select a point on the mapped road or enter its WGS84 longitude and latitude.'); return;
    }
    setBusy(true);
    try {
      const ticket = await realRoadApi.uploadTicket(user.accessToken, key.current, file);
      await realRoadApi.upload(ticket, file);
      const created = await realRoadApi.create(user.accessToken, {
        idempotencyKey: key.current,
        imageKey: ticket.imageKey,
        road: { roadId, geometryVersion: roads.metadata.geometryVersion, point: [longitude, latitude] },
        capturedAt: null, note,
      });
      setMessage(created.reviewStatus === 'Pending Review'
        ? `Report ${created.id} submitted as Pending Review. Only responders can see it until review. This submission does not change the public road condition.`
        : `Report ${created.id} was already received. Its review status is ${created.reviewStatus}; only current reviewed outcomes appear on the public map.`);
      setFile(null); setFileInputKey((current) => current + 1); setNote(''); key.current = crypto.randomUUID();
      try {
        await onChanged();
        if (responder) setReports((await realRoadApi.list(user.accessToken)).reports);
      } catch { setError('Report submitted, but the evidence view could not refresh. Reload before relying on its status.'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Report submission failed.'); }
    finally { setBusy(false); }
  }

  async function review(id: string, decision: 'confirm_blockage' | 'clear' | 'reject') {
    if (!user || !responder) return;
    setBusy(true); setError('');
    try {
      const report = await realRoadApi.review(user.accessToken, id, decision);
      setDetail(report);
      setMessage(`Review decision recorded: ${report.reviewStatus}. No Scenario risk score was changed.`);
      try {
        setReports((await realRoadApi.list(user.accessToken)).reports);
        await onChanged();
      } catch { setError('Review was recorded, but the evidence view could not refresh. Reload before relying on its status.'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review failed.'); }
    finally { setBusy(false); }
  }

  return <>
    <section className="real-preview__detail" aria-label="Real-road photo submission">
      <h2>Report a mapped road</h2>
      {!available ? <p className="detail" role="status">Real-road reporting unavailable: the versioned /v2 API is not ready. The displayed OSM roads are read-only; no photo is attached to a synthetic road.</p> : <>
        <p className="detail">Authenticated photos stay private. New reports are Pending Review and do not change the road’s Unknown condition.</p>
        {user ? <p className="detail">Signed in as {user.displayName}. {responder ? 'Responder review access.' : 'Resident submission access.'} <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setUser(null); setReports([]); setDetail(null); if (cognito) endCognitoSignIn(); }}>Sign out</button></p> : <>
          {cognito && <button type="button" className="btn btn--secondary" onClick={() => void beginCognitoSignIn().catch((cause) => setError(String(cause)))}>Sign in or create account</button>}
          {local && !cognito && <form className="real-preview__form" onSubmit={async (event) => { event.preventDefault(); setError(''); try { setUser(await realRoadApi.signInLocal(username, password)); setPassword(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed.'); } }}>
            <label>Demo account<input value={username} autoComplete="username" onChange={(event) => setUsername(event.target.value)} required /></label>
            <label>Password<input type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required /></label>
            <button type="submit" className="btn btn--secondary">Sign in to local demo</button>
          </form>}
          {!cognito && !local && <p className="detail" role="status">Sign-in is not configured; submission and private review are unavailable.</p>}
        </>}
        <form className="real-preview__form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
          <p className="detail">Selected road: {roadId ?? 'none'}. Choose a point on the map, or enter coordinates for keyboard access. The server checks the point against every way in this limited snapshot.</p>
          <label>Longitude (WGS84)<input type="number" step="any" value={lon} onChange={(event) => setManualCoordinates({ selection, lon: event.target.value, lat })} required /></label>
          <label>Latitude (WGS84)<input type="number" step="any" value={lat} onChange={(event) => setManualCoordinates({ selection, lon, lat: event.target.value })} required /></label>
          <label>Photo (JPEG, PNG or WebP; 8 MB max)<input key={fileInputKey} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /></label>
          <label>Optional observation note<input maxLength={280} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button type="submit" className="btn btn--primary" disabled={!user || !roadId || busy}>{busy ? 'Submitting…' : 'Submit photo for review'}</button>
        </form>
      </>}
      {error && <p role="alert" className="field-error" tabIndex={-1}>{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
    {view === 'responder' && <section className="real-preview__review" aria-label="Real-road review">
      <h2>Private real-road review</h2>
      {!available ? <p>The /v2 review service is unavailable. The legacy Scenario queue is never overlaid here.</p> : !responder ? <p>Only varuna-responder members may list, view photos, confirm, clear or reject reports.</p> : <>
        <p>Only current, responder-confirmed blockages change a covered road’s condition label. Clearance means Unknown, not safe.</p>
        <ul className="real-preview__queue">{reports.map((report) => <li key={report.id}>
          <button type="button" onClick={() => { if (!user) return; void realRoadApi.detail(user.accessToken, report.id).then(setDetail).catch((cause) => setError(String(cause))); }}>{report.id} · {report.roadId} · {report.reviewStatus}</button>
        </li>)}</ul>
        {reports.length === 0 && <p>No active real-road reports in the private queue.</p>}
        {detail && <div className="real-preview__review-detail">
          <h3>{detail.id} · {detail.reviewStatus}</h3>
          <p>Source: resident photo. Observed {formatTime(detail.observedAt)}. Decision: {detail.review?.decision ?? 'Pending Review'}; reviewed {formatTime(detail.reviewedAt)}. Evidence expires {formatTime(detail.evidenceExpiresAt)}; metadata expires {formatTime(detail.expiresAt)}.</p>
          <p>Road: {detail.roadId}. Note: {detail.note || 'None supplied'}.</p>
          {detail.photoUrl && <a href={detail.photoUrl} target="_blank" rel="noopener noreferrer">Open private photo (short-lived link)</a>}
          {detail.reviewStatus === 'Pending Review' && <div className="real-preview__decision-actions">
            <button type="button" disabled={busy} onClick={() => void review(detail.id, 'confirm_blockage')}>Confirm blockage</button>
            <button type="button" disabled={busy} onClick={() => void review(detail.id, 'clear')}>Mark cleared report</button>
            <button type="button" disabled={busy} onClick={() => void review(detail.id, 'reject')}>Reject evidence</button>
          </div>}
        </div>}
      </>}
    </section>}
  </>;
}
