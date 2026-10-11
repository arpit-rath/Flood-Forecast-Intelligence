import { describe, expect, it } from 'vitest';
import type { PublicRoadAlert } from '../../../contracts/types';
import { currentConfirmedAlert, roads } from './model';
import { roadOverlay } from './overlay';

const roadId = roads.features[0].id;
const current: PublicRoadAlert = {
  id: 'RA-test', sourceName: 'Delhi Traffic Police', canonicalSourceUrl: 'https://traffic.delhipolice.gov.in/en',
  advisoryUrl: null, sourceType: 'traffic_alert', publishedAtText: '2026-10-11T11:00:00Z',
  publishedAt: '2026-10-11T11:00:00Z', publishedPrecision: 'datetime', retrievedAt: '2026-10-11T11:05:00Z',
  originalHeadline: 'Waterlogging reported', statedCause: 'waterlogging',
  affectedLocation: 'limited mapped road', validFromText: null, validUntilText: null, sourceAvailability: 'available',
  freshness: 'Current', state: 'Confirmed Flood Blockage', resolutionState: 'matched_candidate', proposal: null,
  matchedRoadId: roadId, reviewedAt: '2026-10-11T11:10:00Z',
};

describe('source alert road labels', () => {
  it('requires a current reviewed confirmation on the exact covered way', () => {
    expect(currentConfirmedAlert(roadId, [current])).toEqual(current);
    expect(currentConfirmedAlert(roads.features[1].id, [current])).toBeNull();
    for (const changed of [
      { state: 'Reported / Unverified' as const }, { state: 'Cleared' as const },
      { state: 'Rejected' as const }, { state: 'Expired' as const },
      { freshness: 'Expired' as const }, { freshness: 'Unavailable' as const },
      { reviewedAt: null }, { matchedRoadId: null },
    ]) expect(currentConfirmedAlert(roadId, [{ ...current, ...changed }])).toBeNull();
  });

  it('never adds an alert marker or overlays an unverified road', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    const unverified = { ...current, state: 'Reported / Unverified' as const };
    expect(roadOverlay(null, [], now, roads, [unverified]).features.find((road) => road.id === roadId)?.properties.condition).toBe('unknown');
    expect(roadOverlay(null, [], now, roads, [current]).features.find((road) => road.id === roadId)?.properties.condition).toBe('confirmed_blockage');
    expect(roadOverlay(null, [], now, roads, [current]).features).toHaveLength(roads.features.length);
  });
});
