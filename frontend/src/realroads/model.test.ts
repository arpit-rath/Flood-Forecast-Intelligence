import { describe, expect, it } from 'vitest';
import type { RealRoadEvidence } from '../../../contracts/types';
import { currentRoadMarkers, roadCondition, roads } from './model';

const roadId = roads.features[0].id;
const now = new Date('2026-10-11T12:00:00Z');

function evidence(reviewState: RealRoadEvidence['reviewState'], overrides: Partial<RealRoadEvidence> = {}): RealRoadEvidence {
  return {
    id: `test-${reviewState}`,
    roadId,
    point: roads.features[0].geometry.coordinates[0],
    reviewState,
    observedAt: '2026-10-11T11:00:00Z',
    reviewedAt: reviewState === 'Pending Review' ? null : '2026-10-11T11:15:00Z',
    expiresAt: '2026-10-12T11:00:00Z',
    source: 'resident_photo',
    ...overrides,
  };
}

describe('static real-road snapshot', () => {
  it('contains sourced OSM way geometry, not synthetic pilot IDs or flood scores', () => {
    expect(roads.features.length).toBeGreaterThan(50);
    expect(roads.metadata.licence).toBe('ODbL 1.0');
    expect(roads.metadata.sourceUrl).toContain('api.openstreetmap.org/api/0.6/map');
    expect(roads.features.every((road) => /^osm:way\/\d+$/.test(road.id))).toBe(true);
    expect(roads.features.every((road) => road.geometry.coordinates.length >= 2)).toBe(true);
    expect(roads.features.every((road) => road.geometry.coordinates.every(([lon, lat]) => lon > 76.8 && lon < 77.5 && lat > 28.3 && lat < 29))).toBe(true);
    expect(JSON.stringify(roads)).not.toMatch(/"(risk|score|route|drain)"/i);
  });

  it('keeps pending, rejected, cleared, and expired evidence from claiming a blockage', () => {
    expect(roadCondition(roadId, [], now).kind).toBe('unknown');
    expect(roadCondition(roadId, [evidence('Pending Review')], now)).toMatchObject({ kind: 'unknown', pending: [{ reviewState: 'Pending Review' }] });
    expect(roadCondition(roadId, [evidence('Rejected')], now).kind).toBe('unknown');
    expect(roadCondition(roadId, [evidence('Cleared')], now)).toMatchObject({ kind: 'unknown', latestReviewed: { reviewState: 'Cleared' } });
    expect(roadCondition(roadId, [evidence('Confirmed Blockage', { expiresAt: '2026-10-11T11:30:00Z' })], now).kind).toBe('unknown');
    expect(roadCondition(roadId, [evidence('Confirmed Blockage', { reviewedAt: null })], now).kind).toBe('unknown');
  });

  it('shows only current reviewed blockage and allows a later clearance to supersede it', () => {
    const blocked = evidence('Confirmed Blockage');
    expect(roadCondition(roadId, [blocked], now).kind).toBe('confirmed_blockage');
    const cleared = evidence('Cleared', { observedAt: '2026-10-11T11:30:00Z', reviewedAt: '2026-10-11T11:40:00Z' });
    expect(roadCondition(roadId, [blocked, cleared], now)).toMatchObject({ kind: 'unknown', latestReviewed: { reviewState: 'Cleared' } });
    expect(currentRoadMarkers([blocked, evidence('Pending Review')], now)).toHaveLength(2);
    expect(currentRoadMarkers([evidence('Rejected'), evidence('Confirmed Blockage', { roadId: 'osm:way/999999999' })], now)).toHaveLength(0);
  });
});
