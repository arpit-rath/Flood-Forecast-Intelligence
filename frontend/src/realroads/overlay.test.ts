import { describe, expect, it } from 'vitest';
import type { RealRoadEvidence } from '../../../contracts/types';
import { roads } from './model';
import { reportOverlay, roadOverlay } from './overlay';

const now = new Date('2026-10-11T12:00:00Z');
const roadId = roads.features[0].id;
const pending: RealRoadEvidence = {
  id: 'test-pending', roadId,
  point: roads.features[0].geometry.coordinates[0],
  reviewState: 'Pending Review', observedAt: '2026-10-11T11:00:00Z',
  reviewedAt: null, expiresAt: '2026-10-12T11:00:00Z', source: 'resident_photo',
};

describe('real-road map overlays', () => {
  it('retains selected OSM way and pending marker without converting either into risk', () => {
    const overlay = roadOverlay(roadId, [pending], now);
    expect(overlay.features.find((road) => road.id === roadId)?.properties).toEqual({ roadId, condition: 'unknown', selected: true });
    expect(reportOverlay([pending], now).features).toHaveLength(1);
  });

  it('omits synthetic, rejected, and expired markers', () => {
    const markers = reportOverlay([
      { ...pending, id: 'synthetic', roadId: 'osm:way/999999999' },
      { ...pending, id: 'rejected', reviewState: 'Rejected' },
      { ...pending, id: 'expired', expiresAt: '2026-10-11T11:30:00Z' },
    ], now);
    expect(markers.features).toHaveLength(0);
  });
});
