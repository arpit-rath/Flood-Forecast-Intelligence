import type { VarunaApi } from './client';
import { ApiError, type ApiErrorBody } from './types';

// Thin fetch client for the deployed API (Architecture.md §7). It holds no
// credentials: operator auth is expected to be a session cookie or a token
// issued by the backend, never an AWS key.

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

export function createHttpApi(baseUrl: string): VarunaApi {
  const root = baseUrl.replace(/\/$/, '');

  async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${root}${path}`, {
        method,
        credentials: 'include',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError({ code: 'NETWORK_ERROR', message: 'Could not reach the Varuna API.', retryable: true, requestId: '' });
    }
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      if (isErrorBody(data)) throw new ApiError(data);
      throw new ApiError({ code: `HTTP_${res.status}`, message: res.statusText, retryable: res.status >= 500, requestId: '' });
    }
    return data as T;
  }

  return {
    kind: 'http',
    getPilot: () => request('GET', '/v1/pilot'),
    getCurrentSnapshot: (mode) => request('GET', `/v1/snapshots/current?mode=${encodeURIComponent(mode)}`),
    listReports: () => request('GET', '/v1/reports'),
    getReport: (id) => request('GET', `/v1/reports/${encodeURIComponent(id)}`),
    requestUploadUrl: (req) => request('POST', '/v1/reports/upload-url', req),
    async uploadImage(upload, file) {
      const res = await fetch(upload.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!res.ok) {
        throw new ApiError({ code: 'UPLOAD_FAILED', message: 'The photo upload did not complete.', retryable: true, requestId: '' });
      }
    },
    createReport: (req) => request('POST', '/v1/reports', req, { 'Idempotency-Key': req.idempotencyKey }),
    reviewReport: (id, req) => request('PATCH', `/v1/reports/${encodeURIComponent(id)}/review`, req),
    compareRoutes: (req) => request('POST', '/v1/routes/compare', req),
    compareInterventions: (req) =>
      request('POST', '/v1/interventions/compare', req, { 'Idempotency-Key': req.idempotencyKey }),
  };
}
