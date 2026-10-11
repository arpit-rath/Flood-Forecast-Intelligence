import type { RealRoadEvidence, RealRoadId } from '../../../contracts/types';
import snapshot from '../data/delhi-roads.json';

export interface RoadFeature {
  type: 'Feature';
  id: RealRoadId;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: { name: string | null; highway: string; osmEditedAt: string | null };
}

export interface RoadSnapshot {
  type: 'FeatureCollection';
  metadata: {
    source: string;
    sourceUrl: string;
    licence: string;
    licenceUrl: string;
    retrievedAt: string;
    queryBbox: [number, number, number, number];
    coverageNote: string;
    geometryVersion?: string;
    matchToleranceMeters?: number;
    ambiguityMarginMeters?: number;
  };
  features: RoadFeature[];
}

export const roads = snapshot as RoadSnapshot;

export type RoadCondition = {
  kind: 'unknown' | 'confirmed_blockage';
  latestReviewed: RealRoadEvidence | null;
  pending: RealRoadEvidence[];
};

/** Only current, responder-reviewed evidence can establish a road condition. */
export function roadCondition(roadId: RealRoadId, evidence: RealRoadEvidence[], now = new Date()): RoadCondition {
  const current = evidence.filter((item) =>
    item.roadId === roadId &&
    Number.isFinite(Date.parse(item.observedAt)) &&
    Date.parse(item.observedAt) <= now.getTime() &&
    Number.isFinite(Date.parse(item.expiresAt)) &&
    Date.parse(item.expiresAt) > now.getTime(),
  );
  const pending = current.filter((item) => item.reviewState === 'Pending Review');
  const reviewed = current
    .filter((item) =>
      (item.reviewState === 'Confirmed Blockage' || item.reviewState === 'Cleared') &&
      item.reviewedAt !== null && Number.isFinite(Date.parse(item.reviewedAt)) &&
      Date.parse(item.reviewedAt) >= Date.parse(item.observedAt) &&
      Date.parse(item.reviewedAt) <= now.getTime(),
    )
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || Date.parse(b.reviewedAt!) - Date.parse(a.reviewedAt!));
  const latestReviewed = reviewed[0] ?? null;
  return { kind: latestReviewed?.reviewState === 'Confirmed Blockage' ? 'confirmed_blockage' : 'unknown', latestReviewed, pending };
}

export function roadLabel(road: RoadFeature): string {
  return road.properties.name || `Unnamed road (${road.id})`;
}

export function roadMidpoint(road: RoadFeature): [number, number] {
  return road.geometry.coordinates[Math.floor(road.geometry.coordinates.length / 2)];
}

export function currentRoadMarkers(evidence: RealRoadEvidence[], now = new Date(), snapshot: RoadSnapshot = roads): RealRoadEvidence[] {
  const ids = new Set(snapshot.features.map((road) => road.id));
  return evidence.filter((item) => ids.has(item.roadId) && item.point !== null && item.reviewState !== 'Rejected' &&
    Date.parse(item.observedAt) <= now.getTime() && Date.parse(item.expiresAt) > now.getTime());
}
