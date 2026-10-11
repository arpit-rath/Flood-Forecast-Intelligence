import type { PublicRoadAlert, RealRoadEvidence, RealRoadId } from '../../../contracts/types';
import { currentConfirmedAlert, currentRoadMarkers, roadCondition, roads, type RoadSnapshot } from './model';

export function roadOverlay(selectedRoadId: RealRoadId | null, evidence: RealRoadEvidence[], now: Date, snapshot: RoadSnapshot = roads, alerts: PublicRoadAlert[] = []) {
  return {
    type: 'FeatureCollection' as const,
    features: snapshot.features.map((road) => ({
      type: 'Feature' as const,
      id: road.id,
      geometry: road.geometry,
      properties: {
        roadId: road.id,
        condition: currentConfirmedAlert(road.id, alerts) ? 'confirmed_blockage' : roadCondition(road.id, evidence, now).kind,
        selected: road.id === selectedRoadId,
      },
    })),
  };
}

export function reportOverlay(evidence: RealRoadEvidence[], now: Date, snapshot: RoadSnapshot = roads) {
  return {
    type: 'FeatureCollection' as const,
    features: currentRoadMarkers(evidence, now, snapshot).map((item) => ({
      type: 'Feature' as const,
      id: item.id ?? `${item.roadId}:${item.observedAt}`,
      geometry: { type: 'Point' as const, coordinates: item.point! },
      properties: { state: item.reviewState, roadId: item.roadId },
    })),
  };
}
