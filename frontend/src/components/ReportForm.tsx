import { Camera, Upload } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError, type Report } from '../api/types';
import { REVIEW_DESCRIPTION, observationHeadline } from '../lib/copy';
import { formatTimeIST } from '../lib/format';
import { newIdempotencyKey } from '../lib/hooks';
import { useAppState } from '../state/AppState';
import { ReviewBadge } from './StatusBadge';
import { SignInPanel } from './SignInPanel';

const MAX_NOTE = 280;
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const POLL_MS = 1500;
const POLL_LIMIT = 40;

type Phase = { kind: 'idle' } | { kind: 'uploading'; step: string } | { kind: 'error'; message: string };

export function ReportForm({ headingRef }: { headingRef?: React.Ref<HTMLHeadingElement> }) {
  const { api, auth, pilot, selectedSegmentId, upsertReport } = useAppState();
  const formId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [segmentId, setSegmentId] = useState(selectedSegmentId ?? '');
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [fieldErrors, setFieldErrors] = useState<{ photo?: string; location?: string }>({});
  const [submitted, setSubmitted] = useState<{ session: string; reports: Report[] }>({ session: '', reports: [] });
  const session = auth.status === 'signed_in' ? auth.user?.accessToken ?? '' : null;
  const myReports = session !== null && submitted.session === session ? submitted.reports : [];
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

  // Poll reports still in analysis until they settle.
  const pendingIds = myReports.filter((r) => r.reviewStatus === 'analysis_pending').map((r) => r.id).join(',');
  useEffect(() => {
    if (!pendingIds) return;
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      for (const id of pendingIds.split(',')) {
        try {
          const updated = await api.getReport(id);
          setSubmitted((current) => current.session === session ? { ...current, reports: current.reports.map((item) => item.id === id ? updated : item) } : current);
          if (api.kind === 'mock') upsertReport(updated);
        } catch {
          /* keep last known state; the status card stays visible */
        }
      }
      if (attempts >= POLL_LIMIT) window.clearInterval(timer);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [api, pendingIds, session, upsertReport]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (api.kind === 'http' && auth.status !== 'signed_in') {
      setPhase({ kind: 'error', message: 'Sign in before sending a pilot report.' });
      return;
    }
    const errors: typeof fieldErrors = {};
    if (!file) errors.photo = 'Add a photo of the road.';
    else if (!ACCEPTED_TYPES.includes(file.type)) errors.photo = 'Use a JPEG, PNG or WebP photo.';
    else if (file.size === 0 || file.size > MAX_BYTES) errors.photo = 'Photo must be between 1 byte and 8 MB.';
    if (!segmentId) errors.location = 'Choose the road where the photo was taken.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !file) return;

    const feature = pilot.status === 'ready' ? pilot.data.segments.features.find((f) => f.id === segmentId) : undefined;
    if (!feature) return;
    const [a, b] = feature.geometry.coordinates;
    const point: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

    try {
      setPhase({ kind: 'uploading', step: 'Preparing upload...' });
      const upload = await api.requestUploadUrl({ contentType: file.type, sizeBytes: file.size, idempotencyKey: idempotencyKey.current });
      setPhase({ kind: 'uploading', step: 'Uploading photo...' });
      await api.uploadImage(upload, file);
      setPhase({ kind: 'uploading', step: 'Sending report...' });
      const report = await api.createReport({
        imageKey: upload.imageKey,
        segmentId,
        point,
        note: note.trim(),
        capturedAt: null,
        consentPublicDerivative: consent,
        idempotencyKey: idempotencyKey.current,
      });
      if (api.kind === 'mock' || auth.user?.roles.includes('varuna-responder')) upsertReport(report);
      setSubmitted((current) => ({ session: session ?? '', reports: [report, ...(current.session === session ? current.reports.filter((item) => item.id !== report.id) : [])] }));
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

  return (
    <section className="report-flow" aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`} className="panel-title" ref={headingRef} tabIndex={-1}>
        Report a road condition
      </h2>
      <p className="detail">
        This is a synthetic DTU-area Scenario, not the Delhi basemap. A responder reviews every photo before it can affect the Scenario estimate. Varuna does not send alerts or dispatch help;
        in an emergency, call 112.
      </p>

      <SignInPanel />

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
            JPEG, PNG or WebP, up to 8 MB. The private responder review copy is re-encoded without camera metadata.
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

        {api.kind === 'mock' && <div className="checkbox">
          <input id={`${formId}-consent`} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <label htmlFor={`${formId}-consent`}>
            Allow a public copy of this photo, with location and camera data removed. Responders see the photo either way.
          </label>
        </div>}

        {phase.kind === 'error' && (
          <p className="field-error" role="alert">
            {phase.message}
          </p>
        )}

        <div className="sticky-action">
          <button type="submit" className="btn btn--primary btn--block" disabled={busy || (api.kind === 'http' && auth.status !== 'signed_in')}>
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
          {r.id} | <time dateTime={r.createdAt}>{formatTimeIST(r.createdAt)}</time>
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
