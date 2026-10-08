/** Wire types for the fixture API. Scores are ordinal estimates, never water depth. */

export type Point = [longitude: number, latitude: number];
export type WeatherMode = "Scenario" | "Live";
export type RiskClass = "Low" | "Watch" | "High" | "Unknown";
export type RoadStatus = RiskClass | "Closed";
export type ReportStatus = "Pending Review" | "Accepted" | "Rejected" | "Needs Manual Review";

export interface Segment {
  id: string;
  geometry: [Point, Point];
  fromNode: string;
  toNode: string;
  lengthM: number;
  terrainPrior: number | null;
  drainageVulnerability: number | null;
  source: string;
  bundleVersion: string;
}

export interface VisualObservations {
  visible_water: "none" | "possible" | "clear" | "uncertain";
  drain_state: "blocked" | "clear" | "not_visible" | "uncertain";
  visible_hazards: Array<"debris" | "open_manhole" | "stranded_vehicle" | "person_in_water" | "other">;
  access_concern: "none" | "possible" | "clear" | "uncertain";
  confidence: number;
  evidence_summary: string;
  needs_human_review: boolean;
}

export interface Report {
  id: string;
  segmentId: string;
  point: Point;
  createdAt: string;
  capturedAt: string | null;
  imageKey: string;
  reviewStatus: ReportStatus;
  observations: VisualObservations | Record<string, never>;
  modelConfidence: number | null;
  source: string;
}

export interface DrainCandidate {
  id: string;
  label: string;
  affectedSegmentIds: string[];
  drainageReduction: number;
}

export interface RouteQuery {
  originNodeId: string;
  destinationNodeId: string;
  travelMode: "Pedestrian" | "Scooter" | "Car";
}

export interface PilotResponse {
  id: string;
  bundleVersion: string;
  mode: "Scenario";
  label: string;
  source: string;
  validAt: string;
  synthetic: true;
  segments: Segment[];
  drains: [DrainCandidate, DrainCandidate];
  routeQuery: RouteQuery;
}

export interface WeatherSnapshot {
  mode: WeatherMode;
  precipitationMmH: number | null;
  validAt: string;
  fetchedAt: string;
  provider: string;
}

export interface SegmentRisk {
  segmentId: string;
  score: number | null;
  class: RiskClass;
  roadStatus: RoadStatus;
  coverage: number;
  confidence: "Low" | "Standard";
  features: { R: number | null; T: number | null; D: number | null; O: number | null };
  missingFeatures: Array<"R" | "T" | "D" | "O">;
  evidenceIds: string[];
  isClosed: boolean;
  computedAt: string;
  modelVersion: string;
}

export interface RiskSnapshot {
  id: string;
  bundleVersion: string;
  mode: WeatherMode;
  computedAt: string;
  modelVersion: string;
  weather: WeatherSnapshot;
  weatherStale: boolean;
  segments: SegmentRisk[];
}

export interface RouteCandidate {
  id: string;
  geometry: { type: "LineString"; coordinates: Point[] };
  segmentIds: string[];
  travelMinutes: number;
  exposure: number | null;
  unknownShare: number;
  blocked: boolean;
  highestClass: RiskClass;
  distanceM: number;
  provenance: string;
}

export interface RouteComparison {
  snapshotId: string;
  mode: WeatherMode;
  originNodeId: string;
  destinationNodeId: string;
  travelMode: RouteQuery["travelMode"];
  fastestRouteId: string | null;
  recommendedRouteId: string | null;
  reason: string;
  candidates: RouteCandidate[];
  provenance: string;
}

export interface InterventionResult {
  id: string;
  drainId: string;
  label: string;
  simulated: true;
  mode: WeatherMode;
  affectedSegmentIds: string[];
  assumptions: { drainageReduction: number; source: string };
  routeExposureBefore: number | null;
  routeExposureAfter: number | null;
  routeExposureReduction: number;
  segmentsMovedOutOfHigh: number;
  segments: Array<{
    segmentId: string;
    before: RiskClass;
    after: RiskClass;
    scoreBefore: number | null;
    scoreAfter: number | null;
  }>;
  rank: number;
}

export interface InterventionComparison {
  baselineSnapshotId: string;
  selectedRouteId: string;
  simulated: true;
  mode: WeatherMode;
  hasEstimatedBenefit: boolean;
  rankingRule: string;
  results: [InterventionResult, InterventionResult];
}

export interface ApiError {
  error: { code: string; message: string; retryable: boolean; requestId: string };
}
