import type { VarunaApi } from './client';
import type * as Wire from '../../../contracts/types';
import { ApiError, type ApiErrorBody } from './types';
import { adaptInterventions, adaptPilot, adaptRoutes, adaptSnapshot, toWireTravelMode } from './wireAdapter';

// Fixture API client. No browser credentials or simulated fallback in HTTP mode.

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

function unavailable(): Promise<never> {
  return Promise.reject(new ApiError({
    code: 'reports_unavailable',
    message: 'Photo upload and persistent report review are unavailable in the fixture API.',
    retryable: false,
    requestId: '',
  }));
}

export function createHttpApi(baseUrl: string): VarunaApi {
  const root = baseUrl.replace(/\/$/, '');
  let pilotPromise: Promise<Wire.PilotResponse> | null = null;
  let snapshot: Wire.RiskSnapshot | null = null;
  let routes: ReturnType<typeof adaptRoutes> | null = null;
  let routeQuery: Wire.RouteQuery | null = null;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${root}${path}`, {
        method,
        credentials: 'omit',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
    async getPilot() {
      return adaptPilot(await ensurePilot());
    },
    async getCurrentSnapshot(mode) {
      snapshot = await request<Wire.RiskSnapshot>('GET', `/v1/snapshots/current?mode=${mode === 'scenario' ? 'Scenario' : 'Live'}`);
      return adaptSnapshot(snapshot, await ensurePilot());
    },
    listReports: unavailable,
    getReport: unavailable,
    requestUploadUrl: unavailable,
    uploadImage: unavailable,
    createReport: unavailable,
    reviewReport: unavailable,
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
