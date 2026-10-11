import { afterEach, describe, expect, it, vi } from 'vitest';
import { realRoadApi } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('real-road HTTP adapter', () => {
  it('rejects unavailable v2 without returning static or pilot data', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network unavailable'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(realRoadApi.roads()).rejects.toThrow('network unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v2/roads');
  });

  it('sends a bearer token only to protected v2 operations', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ evidence: [], reports: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await realRoadApi.evidence();
    await realRoadApi.list('access-token-test');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer access-token-test');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/v2/real-road-reports');
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('/v1/reports');
  });

  it('uses only public v2 endpoints and no JWT for anonymous intake', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ uploadUrl: 'https://example.test/upload', uploadFields: { key: 'uploads/real-road/anonymous/test' }, submissionToken: 'opaque', expiresAt: '2026-10-12T10:00:00Z', maxBytes: 8388608 }) });
    vi.stubGlobal('fetch', fetchMock);
    const road = { roadId: 'osm:way/171708731' as const, geometryVersion: 'sha256:test', point: [77.1, 28.7] as [number, number] };
    const file = new File(['test'], 'road.png', { type: 'image/png' });
    await realRoadApi.publicUploadTicket(road, file);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v2/public/real-road-reports/upload-url');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).road).toEqual(road);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'RR-opaque', reviewStatus: 'Pending Review' }) });
    await realRoadApi.publicCreate({ submissionToken: 'opaque', imageKey: 'uploads/real-road/anonymous/test', road, capturedAt: null, note: '' });
    expect(String(fetchMock.mock.calls[1][0])).toContain('/v2/public/real-road-reports');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });

  it('fails closed if the public endpoint returns pending or private fields', async () => {
    const reviewed = {
      roadId: 'osm:way/171708731', point: [77.1116, 28.7582], reviewState: 'Confirmed Blockage',
      observedAt: '2026-10-11T10:00:00Z', reviewedAt: '2026-10-11T10:05:00Z',
      reviewDecision: 'confirm_blockage', expiresAt: '2026-10-12T10:00:00Z', source: 'resident_photo',
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ evidence: [reviewed] }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(realRoadApi.evidence()).resolves.toEqual({ evidence: [reviewed] });
    for (const item of [{ ...reviewed, reviewState: 'Pending Review', reviewedAt: null }, { ...reviewed, note: 'private' }, { ...reviewed, id: 'RR-private' }]) {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ evidence: [item] }) });
      await expect(realRoadApi.evidence()).rejects.toThrow('Public real-road evidence contract mismatch');
    }
  });
});
