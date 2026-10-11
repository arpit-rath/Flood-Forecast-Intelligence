import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicRoadAlert } from '../../../contracts/types';
import { roadAlertApi } from './alertApi';

afterEach(() => vi.unstubAllGlobals());

const alert: PublicRoadAlert = {
  id: 'RA-test', sourceName: 'Delhi Traffic Police', canonicalSourceUrl: 'https://traffic.delhipolice.gov.in/en',
  advisoryUrl: null, sourceType: 'traffic_alert', publishedAtText: '2026-10-11T10:00:00Z',
  publishedAt: '2026-10-11T10:00:00Z', publishedPrecision: 'datetime', retrievedAt: '2026-10-11T10:05:00Z',
  originalHeadline: 'Fixture headline', statedCause: 'waterlogging', affectedLocation: null,
  validFromText: null, validUntilText: null, sourceAvailability: 'available', freshness: 'Current',
  state: 'Reported / Unverified', resolutionState: 'unlocated', proposal: null,
};

describe('local source alert HTTP boundary', () => {
  it('allows only the public field list and fails closed on private or invalid outcomes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alerts: [alert] }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(roadAlertApi.publicList()).resolves.toEqual({ alerts: [alert] });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    for (const changed of [
      { ...alert, sourceError: 'private' }, { ...alert, reviewerSub: 'private' },
      { ...alert, matchedRoadId: 'osm:way/171708731' }, { ...alert, reviewedAt: null },
      { ...alert, candidateRoads: [{ roadId: 'osm:way/171708731' }] },
      { ...alert, proposal: { displayLabel: 'Test', method: 'reviewed_alias', confidenceCategory: 'high', explanation: 'alias', roadId: 'osm:way/171708731' } },
      { ...alert, resolutionState: 'made_up' },
    ]) {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ alerts: [changed] }) });
      await expect(roadAlertApi.publicList()).rejects.toThrow('Public road-alert contract mismatch');
    }
  });

  it('accepts a reviewed outcome without private road or reviewer keys', async () => {
    const reviewed = { ...alert, state: 'Confirmed Flood Blockage' as const };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alerts: [reviewed] }) }));
    await expect(roadAlertApi.publicList()).resolves.toEqual({ alerts: [reviewed] });
  });

  it('accepts a bounded public proposal without a candidate road ID', async () => {
    const proposed = { ...alert, resolutionState: 'matched_candidate' as const,
      proposal: { displayLabel: 'Unnamed road near Delhi Technological University campus boundary',
        method: 'landmark_locality', confidenceCategory: 'moderate' as const, explanation: 'landmark locality' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alerts: [proposed] }) }));
    await expect(roadAlertApi.publicList()).resolves.toEqual({ alerts: [proposed] });
  });

  it('accepts only the bounded public source-health envelope', async () => {
    const sourceStatus = { state: 'stale', lastCheckedAt: '2026-10-11T12:00:00Z',
      lastSuccessfulAt: '2026-10-11T11:30:00Z', message: 'Some details could not be checked.' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alerts: [alert], sourceStatus }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(roadAlertApi.publicList()).resolves.toEqual({ alerts: [alert], sourceStatus });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ alerts: [alert], sourceStatus: { ...sourceStatus, state: 'degraded' } }) });
    await expect(roadAlertApi.publicList()).resolves.toEqual({ alerts: [alert], sourceStatus: { ...sourceStatus, state: 'degraded' } });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ alerts: [alert], sourceStatus: { ...sourceStatus, candidateIds: ['private'] } }) });
    await expect(roadAlertApi.publicList()).rejects.toThrow('Public road-alert contract mismatch');
  });

  it('requires the caller token for responder operations and never falls back on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alerts: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await roadAlertApi.privateList('test-access-token');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-access-token');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v2/road-alerts/review');
    fetchMock.mockRejectedValueOnce(new TypeError('network unavailable'));
    await expect(roadAlertApi.publicList()).rejects.toThrow('network unavailable');
  });
});
