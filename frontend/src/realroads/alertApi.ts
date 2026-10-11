import type { PrivateRoadAlert, PublicRoadAlert, RealRoadReference, RoadAlertSourceStatus } from '../../../contracts/types';

const root = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const publicFields = [
  'advisoryUrl', 'affectedLocation', 'canonicalSourceUrl', 'freshness', 'id', 'matchedRoadId',
  'originalHeadline', 'publishedAt', 'publishedAtText', 'publishedPrecision', 'retrievedAt',
  'resolutionState', 'proposal', 'reviewedAt', 'sourceAvailability', 'sourceName', 'sourceType', 'statedCause', 'state',
  'validFromText', 'validUntilText',
].sort();

function publicAlert(value: unknown): value is PublicRoadAlert {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).sort().join(',') !== publicFields.join(',')) return false;
  if (item.sourceName !== 'Delhi Traffic Police' || typeof item.originalHeadline !== 'string' || typeof item.id !== 'string') return false;
  try {
    const url = new URL(String(item.canonicalSourceUrl));
    if (url.protocol !== 'https:' || !['traffic.delhipolice.gov.in', 'trafficupdates.delhipolice.gov.in'].includes(url.hostname)) return false;
  } catch { return false; }
  if (typeof item.retrievedAt !== 'string' || !Number.isFinite(Date.parse(item.retrievedAt))) return false;
  if (!['Reported / Unverified', 'Confirmed Flood Blockage', 'Cleared', 'Rejected', 'Expired'].includes(String(item.state))) return false;
  if (!['Current', 'Expired', 'Unavailable', 'Unverified time', 'Not yet valid'].includes(String(item.freshness))) return false;
  if (!['available', 'unavailable', 'error'].includes(String(item.sourceAvailability))) return false;
  if (!['matched_candidate', 'ambiguous', 'unlocated', 'outside_coverage', 'stale_snapshot', 'invalid_source_location'].includes(String(item.resolutionState))) return false;
  if (item.proposal !== null) {
    if (item.state !== 'Reported / Unverified' || item.freshness !== 'Current' || item.resolutionState !== 'matched_candidate') return false;
    if (!item.proposal || typeof item.proposal !== 'object' || Array.isArray(item.proposal)) return false;
    const proposal = item.proposal as Record<string, unknown>;
    if (Object.keys(proposal).sort().join(',') !== ['confidenceCategory', 'displayLabel', 'explanation', 'method'].join(',')) return false;
    if (typeof proposal.displayLabel !== 'string' || typeof proposal.method !== 'string' || typeof proposal.explanation !== 'string'
      || !['high', 'moderate', 'low'].includes(String(proposal.confidenceCategory))) return false;
  }
  if (!['traffic_alert', 'traffic_advisory'].includes(String(item.sourceType))) return false;
  if (item.state === 'Confirmed Flood Blockage' || item.state === 'Cleared') {
    if (item.state === 'Confirmed Flood Blockage' && item.freshness !== 'Current') return false;
    if (typeof item.matchedRoadId !== 'string' || !/^osm:way\/[1-9]\d*$/.test(item.matchedRoadId)) return false;
    if (typeof item.reviewedAt !== 'string' || !Number.isFinite(Date.parse(item.reviewedAt))) return false;
  } else if (item.matchedRoadId !== null || item.reviewedAt !== null) return false;
  return true;
}

function sourceStatus(value: unknown): value is RoadAlertSourceStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join(',') === 'lastCheckedAt,lastSuccessfulAt,message,state'
    && ['current', 'stale', 'unavailable'].includes(String(item.state))
    && typeof item.message === 'string' && item.message.length <= 160
    && [item.lastCheckedAt, item.lastSuccessfulAt].every((time) => time === null || (typeof time === 'string' && Number.isFinite(Date.parse(time))));
}

async function request<T>(path: string, method = 'GET', token?: string, body?: unknown): Promise<T> {
  const response = await fetch(`${root}${path}`, {
    method, credentials: 'omit',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.error?.message === 'string' ? payload.error.message : `Road-alert API unavailable (${response.status}).`);
  return payload as T;
}

export const roadAlertApi = {
  async publicList(): Promise<{ alerts: PublicRoadAlert[]; sourceStatus?: RoadAlertSourceStatus }> {
    const result = await request<{ alerts: unknown; sourceStatus?: unknown }>('/v2/road-alerts');
    if (!Array.isArray(result?.alerts) || !result.alerts.every(publicAlert)
      || (result.sourceStatus !== undefined && !sourceStatus(result.sourceStatus))) {
      throw new Error('Public road-alert contract mismatch; source conditions are unavailable.');
    }
    return result.sourceStatus === undefined ? { alerts: result.alerts } :
      { alerts: result.alerts, sourceStatus: result.sourceStatus as RoadAlertSourceStatus };
  },
  privateList: (token: string) => request<{ alerts: PrivateRoadAlert[] }>('/v2/road-alerts/review', 'GET', token),
  importDocument: (token: string, document: Record<string, unknown>) => request<PrivateRoadAlert>('/v2/road-alerts/import', 'POST', token, document),
  review: (token: string, id: string, decision: 'confirm_flood_blockage' | 'clear' | 'reject', reason: string, road?: RealRoadReference) =>
    request<PrivateRoadAlert>(`/v2/road-alerts/${encodeURIComponent(id)}/review`, 'PATCH', token, { decision, reason, ...(road ? { road } : {}) }),
};
