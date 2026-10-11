import type { VarunaApi } from './client';
import type * as Wire from '../../../contracts/types';
import { ApiError, type ApiErrorBody, type Report, type ReviewResponse } from './types';
import { adaptInterventions, adaptPilot, adaptRoutes, adaptSnapshot, toWireTravelMode } from './wireAdapter';

// Fixture API client. No browser credentials or simulated fallback in HTTP mode.

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

function adaptReport(raw: Wire.Report): Report {
  const status: Record<Wire.ReportStatus, Report['reviewStatus']> = {
    'Pending Review': 'pending_review', 'Needs Manual Review': 'needs_manual_review', Accepted: 'accepted', Rejected: 'rejected',
  };
  const fixture = raw.source !== 'resident_upload';
  return {
    ...raw,
    source: fixture ? 'fixture' : 'resident_upload',
    reviewStatus: status[raw.reviewStatus],
    note: raw.note ?? '',
    imageUrl: raw.imageUrl ?? null,
    observations: Object.keys(raw.observations ?? {}).length ? raw.observations as Report['observations'] : null,
    analysis: raw.analysis ?? { status: fixture ? 'complete' : 'not_configured', provider: fixture ? 'fixture' : 'none', model: null, completedAt: null, failureReason: null },
    review: raw.review ?? null,
  };
}

export function createHttpApi(baseUrl: string): VarunaApi {
  const root = baseUrl.replace(/\/$/, '');
  let pilotPromise: Promise<Wire.PilotResponse> | null = null;
  let snapshot: Wire.RiskSnapshot | null = null;
  let routes: ReturnType<typeof adaptRoutes> | null = null;
  let routeQuery: Wire.RouteQuery | null = null;
  let accessToken = '';
  const authMode: VarunaApi['authMode'] = import.meta.env.VITE_COGNITO_DOMAIN && import.meta.env.VITE_COGNITO_CLIENT_ID
    ? 'cognito' : import.meta.env.VITE_LOCAL_AUTH === 'true' ? 'local' : 'unavailable';

  async function request<T>(method: string, path: string, body?: unknown, protectedRoute = false): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${root}${path}`, {
        method,
        credentials: 'omit',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(protectedRoute && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError({ code: 'NETWORK_ERROR', message: 'Could not reach the Varuna API.', retryable: true, requestId: '' });
    }
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      if (isErrorBody(data)) throw new ApiError(data);
      if (typeof data === 'object' && data !== null && 'error' in data && isErrorBody(data.error)) {
        throw new ApiError(data.error);
      }
      throw new ApiError({ code: `HTTP_${res.status}`, message: res.statusText, retryable: res.status >= 500, requestId: '' });
    }
    return data as T;
  }

  async function ensurePilot(): Promise<Wire.PilotResponse> {
    if (!pilotPromise) pilotPromise = request<Wire.PilotResponse>('GET', '/v1/pilot');
    try {
      return await pilotPromise;
    } catch (error) {
      pilotPromise = null;
      throw error;
    }
  }

  return {
    kind: 'http',
    authMode,
    setAccessToken(token) { accessToken = token.trim(); },
    signInLocal(username, password) {
      if (authMode !== 'local') throw new Error('Local sign-in is not configured.');
      return request('POST', '/v1/auth/local-session', { username, password });
    },
    async getPilot() {
      return adaptPilot(await ensurePilot());
    },
    async getCurrentSnapshot(mode) {
      snapshot = await request<Wire.RiskSnapshot>('GET', `/v1/snapshots/current?mode=${mode === 'scenario' ? 'Scenario' : 'Live'}`);
      return adaptSnapshot(snapshot, await ensurePilot());
    },
    async listReports() {
      const data = await request<{ reports: Wire.Report[] }>('GET', '/v1/reports', undefined, true);
      return data.reports.map(adaptReport);
    },
    async getReport(id) {
      return adaptReport(await request<Wire.Report>('GET', `/v1/reports/${encodeURIComponent(id)}`, undefined, true));
    },
    requestUploadUrl(req) {
      return request('POST', '/v1/reports/upload-url', req, true);
    },
    async uploadImage(upload, file) {
      let res: Response;
      try {
        const form = new FormData();
        for (const [key, value] of Object.entries(upload.uploadFields)) form.append(key, value);
        form.append('file', file);
        res = await fetch(upload.uploadUrl, { method: 'POST', body: form, credentials: 'omit' });
      } catch {
        throw new ApiError({ code: 'UPLOAD_NETWORK_ERROR', message: 'Could not upload the photo.', retryable: true, requestId: '' });
      }
      if (!res.ok) throw new ApiError({ code: 'UPLOAD_FAILED', message: `Photo upload failed (${res.status}).`, retryable: res.status >= 500, requestId: '' });
    },
    async createReport(req) {
      return adaptReport(await request<Wire.Report>('POST', '/v1/reports', req, true));
    },
    async reviewReport(id, req) {
      const data = await request<{ report: Wire.Report; snapshotId: string | null; note?: string }>('PATCH', `/v1/reports/${encodeURIComponent(id)}/review`, req, true);
      return { ...data, report: adaptReport(data.report) } satisfies ReviewResponse;
    },
    async compareRoutes(req) {
      if (!snapshot || snapshot.id !== req.snapshotId) {
        throw new ApiError({ code: 'stale_snapshot', message: 'Refresh the risk snapshot before comparing routes.', retryable: true, requestId: '' });
      }
      routeQuery = {
        originNodeId: req.originPlaceId,
        destinationNodeId: req.destinationPlaceId,
        travelMode: toWireTravelMode(req.travelMode),
      };
      const raw = await request<Wire.RouteComparison>('POST', '/v1/routes/compare', {
        ...routeQuery,
        snapshotId: req.snapshotId,
      });
      if (raw.snapshotId !== req.snapshotId) throw new ApiError({ code: 'stale_snapshot', message: 'Route results do not match the current risk snapshot.', retryable: true, requestId: '' });
      routes = adaptRoutes(raw, req, snapshot);
      return routes;
    },
    async compareInterventions(req) {
      if (!routeQuery || !routes || !snapshot || routes.comparisonId !== req.routeComparisonId || routes.snapshotId !== req.baselineSnapshotId) {
        throw new ApiError({ code: 'stale_route', message: 'Compare routes again before comparing interventions.', retryable: true, requestId: '' });
      }
      const raw = await request<Wire.InterventionComparison>('POST', '/v1/interventions/compare', {
        ...routeQuery,
        snapshotId: req.baselineSnapshotId,
        selectedRouteId: req.selectedRouteId,
        drainIds: req.drainIds,
      });
      if (!raw.simulated || raw.baselineSnapshotId !== req.baselineSnapshotId) {
        throw new ApiError({ code: 'invalid_simulation', message: 'Intervention results do not match the selected baseline.', retryable: false, requestId: '' });
      }
      return adaptInterventions(raw, req, routes, snapshot);
    },
  };
}
