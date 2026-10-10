import { Camera, Upload } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError, type Report } from '../api/types';
import { REVIEW_DESCRIPTION, observationHeadline } from '../lib/copy';
import { formatTimeIST } from '../lib/format';
import { newIdempotencyKey } from '../lib/hooks';
import { useAppState } from '../state/AppState';
import { ReviewBadge } from './StatusBadge';

const MAX_NOTE = 280;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const POLL_MS = 1500;
const POLL_LIMIT = 40;

type Phase = { kind: 'idle' } | { kind: 'uploading'; step: string } | { kind: 'error'; message: string };

export function ReportForm({ headingRef }: { headingRef?: React.Ref<HTMLHeadingElement> }) {
  const { api, pilot, selectedSegmentId, reports, upsertReport } = useAppState();
  const formId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [segmentId, setSegmentId] = useState(selectedSegmentId ?? '');
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [fieldErrors, setFieldErrors] = useState<{ photo?: string; location?: string }>({});
  const [myReportIds, setMyReportIds] = useState<string[]>([]);
  const idempotencyKey = useRef(newIdempotencyKey());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedSegmentId) setSegmentId(selectedSegmentId);
  }, [selectedSegmentId]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const segments = useMemo(
    () =>
      pilot.status === 'ready'
        ? [...pilot.data.segments.features].sort((a, b) => a.properties.name.localeCompare(b.properties.name))
        : [],
    [pilot],
  );

  const myReports: Report[] = useMemo(() => {
    const list = reports.status === 'ready' ? reports.data : [];
    return myReportIds.map((id) => list.find((r) => r.id === id)).filter((r): r is Report => Boolean(r));
  }, [reports, myReportIds]);

  // Poll reports still in analysis until they settle.
  const pendingIds = myReports.filter((r) => r.reviewStatus === 'analysis_pending').map((r) => r.id).join(',');
  useEffect(() => {
    if (!pendingIds) return;
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      for (const id of pendingIds.split(',')) {
        try {
          upsertReport(await api.getReport(id));
        } catch {
          /* keep last known state; the status card stays visible */
        }
      }
      if (attempts >= POLL_LIMIT) window.clearInterval(timer);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [api, pendingIds, upsertReport]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!file) errors.photo = 'Add a photo of the road.';
    else if (!ACCEPTED_TYPES.includes(file.type)) errors.photo = 'Use a JPEG, PNG or WebP photo.';
    if (!segmentId) errors.location = 'Choose the road where the photo was taken.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !file) return;

    const feature = pilot.status === 'ready' ? pilot.data.segments.features.find((f) => f.id === segmentId) : undefined;
    if (!feature) return;
    const [a, b] = feature.geometry.coordinates;
    const point: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

    try {
      setPhase({ kind: 'uploading', step: 'Preparing uploadâ€¦' });
      const upload = await api.requestUploadUrl({ contentType: file.type, sizeBytes: file.size });
      setPhase({ kind: 'uploading', step: 'Uploading photoâ€¦' });
      await api.uploadImage(upload, file);
      setPhase({ kind: 'uploading', step: 'Sending reportâ€¦' });
      const report = await api.createReport({
        imageKey: upload.imageKey,
        segmentId,
        point,
        note: note.trim(),
        capturedAt: null,
        consentPublicDerivative: consent,
        idempotencyKey: idempotencyKey.current,
      });
      upsertReport(report);
      setMyReportIds((ids) => [report.id, ...ids.filter((id) => id !== report.id)]);
      setPhase({ kind: 'idle' });
      setFile(null);
      setNote('');
      setConsent(false);
      if (fileInput.current) fileInput.current.value = '';
      idempotencyKey.current = newIdempotencyKey();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The report could not be sent.';
      setPhase({ kind: 'error', message: `${message} Your photo and note are kept; try again when ready.` });
    }
  };

  const busy = phase.kind === 'uploading';

  if (api.kind === 'http') {
    return (
      <section className="report-flow" aria-labelledby={`${formId}-title`}>
        <h2 id={`${formId}-title`} className="panel-title" ref={headingRef} tabIndex={-1}>Report a road condition</h2>
        <p className="callout callout--muted">Photo upload and report submission are unavailable in the fixture API. No report has been sent.</p>
      </section>
    );
  }

  return (
    <section className="report-flow" aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`} className="panel-title" ref={headingRef} tabIndex={-1}>
        Report a road condition
      </h2>
      <p className="detail">
        A responder reviews every photo before it can change route advice. Varuna does not send alerts or dispatch help;
        in an emergency, call 112.
      </p>

      <form className="report-form" onSubmit={submit} noValidate aria-busy={busy}>
        <div className="field">
          <label htmlFor={`${formId}-photo`}>Photo</label>
          <div className="file-input">
            <input
              ref={fileInput}
              id={`${formId}-photo`}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              capture="environment"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-invalid={Boolean(fieldErrors.photo)}
              aria-describedby={`${formId}-photo-hint${fieldErrors.photo ? ` ${formId}-photo-error` : ''}`}
            />
            <span className="btn btn--secondary" aria-hidden="true">
              <Camera size={18} /> {file ? 'Change photo' : 'Take or choose photo'}
            </span>
          </div>
          <p id={`${formId}-photo-hint`} className="detail">
            JPEG, PNG or WebP, up to 8 MB. Location and camera data are removed from any displayed copy.
          </p>
          {fieldErrors.photo && (
            <p id={`${formId}-photo-error`} className="field-error">
              {fieldErrors.photo}
            </p>
          )}
          {preview && <img className="report-form__preview" src={preview} alt="Selected photo preview" />}
        </div>

        <div className="field">
          <label htmlFor={`${formId}-segment`}>Road</label>
          <select
            id={`${formId}-segment`}
            value={segmentId}
            onChange={(e) => setSegmentId(e.target.value)}
            aria-invalid={Boolean(fieldErrors.location)}
            aria-describedby={`${formId}-segment-hint${fieldErrors.location ? ` ${formId}-segment-error` : ''}`}
          >
            <option value="">Choose a road</option>
            {segments.map((f) => (
              <option key={f.id} value={f.id}>
                {f.properties.name} ({f.id})
              </option>
            ))}
          </select>
          <p id={`${formId}-segment-hint`} className="detail">
            Selecting a road on the map fills this in.
          </p>
          {fieldErrors.location && (
            <p id={`${formId}-segment-error`} className="field-error">
              {fieldErrors.location}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={`${formId}-note`}>
            Note <span className="detail">(optional)</span>
          </label>
          <textarea
            id={`${formId}-note`}
            value={note}
            maxLength={MAX_NOTE}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby={`${formId}-note-count`}
          />
          <p id={`${formId}-note-count`} className="detail">
            {note.length}/{MAX_NOTE} characters. Do not include names or phone numbers.
          </p>
        </div>

        <div className="checkbox">
          <input id={`${formId}-consent`} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <label htmlFor={`${formId}-consent`}>
            Allow a public copy of this photo, with location and camera data removed. Responders see the photo either way.
          </label>
        </div>

        {phase.kind === 'error' && (
          <p className="field-error" role="alert">
            {phase.message}
          </p>
        )}

        <div className="sticky-action">
          <button type="submit" className="btn btn--primary btn--block" aria-disabled={busy} onClick={(e) => busy && e.preventDefault()}>
            <Upload aria-hidden="true" size={18} />
            {busy ? phase.step : 'Send report'}
          </button>
        </div>
      </form>

      {myReports.length > 0 && (
        <section className="my-reports" aria-labelledby={`${formId}-mine`}>
          <h3 id={`${formId}-mine`} className="section-label">
            Your reports
          </h3>
          <ul aria-live="polite">
            {myReports.map((r) => (
              <ReportStatusItem key={r.id} report={r} />
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function ReportStatusItem({ report: r }: { report: Report }) {
  const { segmentsById } = useAppState();
  return (
    <li className="card report-status">
      <div className="evidence-list__row">
        <ReviewBadge status={r.reviewStatus} />
        <span className="mono detail">
          {r.id} Â· <time dateTime={r.createdAt}>{formatTimeIST(r.createdAt)}</time>
        </span>
      </div>
      <p className="detail">{segmentsById.get(r.segmentId)?.name ?? r.segmentId}</p>
      <p>
        {r.observations && r.reviewStatus === 'pending_review'
          ? `${observationHeadline(r.observations.visible_water)}; awaiting review.`
          : REVIEW_DESCRIPTION[r.reviewStatus]}
      </p>
      {r.analysis.provider === 'fixture' && r.analysis.status !== 'pending' && (
        <p className="detail">Mock analysis: fixture response, not a model call.</p>
      )}
    </li>
  );
}
