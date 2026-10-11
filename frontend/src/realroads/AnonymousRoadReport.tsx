import { useRef, useState, type FormEvent } from 'react';
import type { AnonymousRealRoadReportDraft, AnonymousRealRoadUploadTicket, RealRoadId, RealRoadReference } from '../../../contracts/types';
import { realRoadApi } from './api';
import type { RoadSnapshot } from './model';

type Pending = { ticket: AnonymousRealRoadUploadTicket; draft: AnonymousRealRoadReportDraft; file: File; uploaded: boolean };

export function AnonymousRoadReport({ available, roadId, point, roads }: {
  available: boolean;
  roadId: RealRoadId | null;
  point: [number, number] | null;
  roads: RoadSnapshot;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [note, setNote] = useState('');
  const [manualCoordinates, setManualCoordinates] = useState<{ selection: string; lon: string; lat: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const pending = useRef<Pending | null>(null);
  const selection = `${roadId ?? ''}:${point?.join(',') ?? ''}`;
  const lon = manualCoordinates?.selection === selection ? manualCoordinates.lon : point ? String(point[0]) : '';
  const lat = manualCoordinates?.selection === selection ? manualCoordinates.lat : point ? String(point[1]) : '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setReceipt('');
    if (!available || !roadId || !roads.metadata.geometryVersion || !file) {
      setError('Select a mapped road and photo, then wait for the versioned reporting API.'); return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size < 1 || file.size > 8 * 1024 * 1024) {
      setError('Choose a JPEG, PNG or WebP photo between 1 byte and 8 MB.'); return;
    }
    const longitude = Number(lon), latitude = Number(lat);
    if (!lon.trim() || !lat.trim() || !Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      setError('Select a point on the mapped road or enter its WGS84 longitude and latitude.'); return;
    }
    const road: RealRoadReference = { roadId, geometryVersion: roads.metadata.geometryVersion, point: [longitude, latitude] };
    setBusy(true);
    try {
      let current = pending.current;
      if (!current || current.file !== file || JSON.stringify(current.draft.road) !== JSON.stringify(road) || current.draft.note !== note || Date.parse(current.ticket.expiresAt) <= Date.now()) {
        const ticket = await realRoadApi.publicUploadTicket(road, file);
        if (!ticket.submissionToken || !ticket.uploadFields.key || !Number.isFinite(Date.parse(ticket.expiresAt))) throw new Error('The upload service returned an invalid submission ticket.');
        current = { ticket, file, uploaded: false, draft: { submissionToken: ticket.submissionToken, imageKey: ticket.uploadFields.key, road, capturedAt: null, note } };
        pending.current = current;
      }
      if (!current.uploaded) {
        await realRoadApi.upload(current.ticket, file);
        current.uploaded = true;
      }
      const result = await realRoadApi.publicCreate(current.draft);
      if (result.reviewStatus !== 'Pending Review' || !/^RR-[0-9a-f]{32}$/.test(result.id)) throw new Error('Submission receipt could not be verified.');
      setReceipt(`Receipt ${result.id}: Pending Review. The photograph remains private for responders. This submission does not mark the road blocked.`);
      pending.current = null;
      setFile(null); setFileInputKey((value) => value + 1); setNote('');
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : 'Photo submission failed.'} Your photo and note remain selected; check the road and try again.`);
    } finally { setBusy(false); }
  }

  return <section className="real-preview__detail" aria-label="Anonymous real-road photo submission">
    <h2>Report a mapped road</h2>
    {!available ? <p className="detail" role="status">Anonymous real-road reporting unavailable: the versioned /v2 API is not ready. These roads are read-only.</p> : <>
      <p className="detail">No account is required. Do not include names, phone numbers, faces, number plates, or other personal details. The photograph remains private for responder review. Submission does not mark the road blocked.</p>
      <form className="real-preview__form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
        <p className="detail">Selected road: {roadId ?? 'none'}. Choose a point on the map, or enter coordinates for keyboard access. The server checks the point against this limited road snapshot.</p>
        <label>Longitude (WGS84)<input type="number" step="any" value={lon} onChange={(event) => setManualCoordinates({ selection, lon: event.target.value, lat })} required /></label>
        <label>Latitude (WGS84)<input type="number" step="any" value={lat} onChange={(event) => setManualCoordinates({ selection, lon, lat: event.target.value })} required /></label>
        <label>Photo (JPEG, PNG or WebP; 8 MB max)<input key={fileInputKey} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /></label>
        <label>Optional observation note<input maxLength={280} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button type="submit" className="btn btn--primary" disabled={!roadId || busy}>{busy ? 'Submitting…' : 'Submit photo for review'}</button>
      </form>
    </>}
    {error && <p role="alert" className="field-error" tabIndex={-1}>{error}</p>}
    {receipt && <p role="status" aria-live="polite">{receipt}</p>}
  </section>;
}
