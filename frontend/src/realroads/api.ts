import type { PublicRealRoadEvidence, RealRoadReport, RealRoadReportDraft, RealRoadSubmissionReceipt } from '../../../contracts/types';
import type { RoadSnapshot } from './model';

export interface UploadTicket {
  uploadUrl: string;
  uploadFields: Record<string, string>;
  imageKey: string;
  expiresAt: string;
  maxBytes: number;
}

const root = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const publicEvidenceFields = ['expiresAt', 'observedAt', 'point', 'reviewDecision', 'reviewState', 'reviewedAt', 'roadId', 'source'];

function publicEvidence(value: unknown): value is PublicRealRoadEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).sort().join(',') !== publicEvidenceFields.join(',')) return false;
  if (item.reviewState !== 'Confirmed Blockage' && item.reviewState !== 'Cleared') return false;
  if (item.reviewDecision !== (item.reviewState === 'Confirmed Blockage' ? 'confirm_blockage' : 'clear')) return false;
  if (typeof item.roadId !== 'string' || !/^osm:way\/[1-9][0-9]*$/.test(item.roadId)) return false;
  if (!Array.isArray(item.point) || item.point.length !== 2 || !item.point.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))) return false;
  if (item.source !== 'resident_photo' && item.source !== 'responder_field_check') return false;
  return ['observedAt', 'reviewedAt', 'expiresAt'].every((field) => typeof item[field] === 'string' && Number.isFinite(Date.parse(item[field] as string)));
}

async function request<T>(path: string, method = 'GET', body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${root}${path}`, {
    method, credentials: 'omit',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error;
    throw new Error(typeof error?.message === 'string' ? error.message : `Real-road API unavailable (${response.status}).`);
  }
  return payload as T;
}

export const realRoadApi = {
  roads: () => request<RoadSnapshot>('/v2/roads'),
  async evidence(): Promise<{ evidence: PublicRealRoadEvidence[] }> {
    const response = await request<{ evidence: unknown }>('/v2/real-road-evidence');
    if (!Array.isArray(response?.evidence) || !response.evidence.every(publicEvidence)) {
      throw new Error('Public real-road evidence contract mismatch; road conditions are unavailable.');
    }
    return { evidence: response.evidence };
  },
  signInLocal: (username: string, password: string) => request<{ accessToken: string; displayName: string; roles: string[]; expiresAt: string }>('/v1/auth/local-session', 'POST', { username, password }),
  uploadTicket: (token: string, idempotencyKey: string, file: File) => request<UploadTicket>('/v2/real-road-reports/upload-url', 'POST', { idempotencyKey, contentType: file.type, sizeBytes: file.size }, token),
  async upload(ticket: UploadTicket, file: File) {
    const form = new FormData();
    Object.entries(ticket.uploadFields).forEach(([key, value]) => form.append(key, value));
    form.append('file', file);
    const response = await fetch(ticket.uploadUrl, { method: 'POST', body: form, credentials: 'omit' });
    if (!response.ok) throw new Error(`Private photo upload failed (${response.status}).`);
  },
  create: (token: string, draft: RealRoadReportDraft) => request<RealRoadSubmissionReceipt>('/v2/real-road-reports', 'POST', draft, token),
  list: (token: string) => request<{ reports: RealRoadReport[] }>('/v2/real-road-reports', 'GET', undefined, token),
  detail: (token: string, id: string) => request<RealRoadReport>(`/v2/real-road-reports/${encodeURIComponent(id)}`, 'GET', undefined, token),
  review: (token: string, id: string, decision: 'confirm_blockage' | 'clear' | 'reject') => request<RealRoadReport>(`/v2/real-road-reports/${encodeURIComponent(id)}/review`, 'PATCH', { decision }, token),
};
