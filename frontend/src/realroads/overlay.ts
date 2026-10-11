import type { RealRoadEvidence, RealRoadId } from '../../../contracts/types';
import { currentRoadMarkers, roadCondition, roads } from './model';

export function roadOverlay(selectedRoadId: RealRoadId | null, evidence: RealRoadEvidence[], now: Date) {
  return {
    type: 'FeatureCollection' as const,
    features: roads.features.map((road) => ({
      type: 'Feature' as const,
      id: road.id,
      geometry: road.geometry,
      properties: {
        roadId: road.id,
        condition: roadCondition(road.id, evidence, now).kind,
        selected: road.id === selectedRoadId,
      },
    })),
  };
}

export function reportOverlay(evidence: RealRoadEvidence[], now: Date) {
  return {
    type: 'FeatureCollection' as const,
    features: currentRoadMarkers(evidence, now).map((item) => ({
      type: 'Feature' as const,
      id: item.id,
      geometry: { type: 'Point' as const, coordinates: item.point },
      properties: { state: item.reviewState, roadId: item.roadId },
    })),
  };
}
