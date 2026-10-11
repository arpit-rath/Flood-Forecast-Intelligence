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
  note?: string;
  imageUrl?: string | null;
  review?: { decision: "accept" | "reject"; reviewedAt: string; reviewer: string } | null;
  analysis?: { status: "pending" | "complete" | "failed" | "not_configured"; provider: "fixture" | "none" | "bedrock"; model: string | null; completedAt: string | null; failureReason: string | null };
  manualVisibleWater?: "none" | "possible" | "clear" | "uncertain" | null;
  scenarioValidAt?: string | null;
  /** Pilot uploads expire seven days after submission; fixture examples have no expiry. */
  expiresAt?: string;
}

/** Separate v2 limited-coverage OSM evidence contract; /v1 Scenario remains unchanged. */
export type RealRoadId = `osm:way/${number}`;

/** Source alerts are separate from resident photo reports and /v1 Scenario. */
export type RoadAlertState = "Reported / Unverified" | "Confirmed Flood Blockage" | "Cleared" | "Rejected" | "Expired";
export interface RoadAlertSourceStatus {
  state: "current" | "degraded" | "stale" | "unavailable";
  lastCheckedAt: string | null;
  lastSuccessfulAt: string | null;
  message: string;
}
export type RoadAlertResolution = "matched_candidate" | "ambiguous" | "unlocated" | "outside_coverage" | "stale_snapshot" | "invalid_source_location";
export interface RoadAlertProposal {
  displayLabel: string;
  method: string;
  confidenceCategory: "high" | "moderate" | "low";
  explanation: string;
}
export interface RoadAlertCandidate extends RoadAlertProposal {
  roadId: RealRoadId;
  matchedEvidence: string[];
  distanceMeters: number | null;
  ambiguityMarginMeters: number | null;
  sourceContext: { source: string; sourceUrl: string; alertSourceUrl: string | null;
    publishedAt: string | null; retrievedAt: string | null; statedCause: string | null };
  snapshotGeometryVersion: string;
  reason: string;
  confidence: number;
}
export interface PublicRoadAlert {
  id: string;
  sourceName: string;
  canonicalSourceUrl: string;
  advisoryUrl: string | null;
  sourceType: "traffic_alert" | "traffic_advisory";
  publishedAtText: string | null;
  publishedAt: string | null;
  publishedPrecision: "datetime" | "date" | "missing" | "invalid";
  retrievedAt: string;
  originalHeadline: string;
  statedCause: string | null;
  affectedLocation: string | null;
  validFromText: string | null;
  validUntilText: string | null;
  sourceAvailability: "available" | "unavailable" | "error";
  freshness: "Current" | "Expired" | "Unavailable" | "Unverified time" | "Not yet valid";
  state: RoadAlertState;
  resolutionState: RoadAlertResolution;
  /** Only a current unique proposal; no road ID or private source/review fields. */
  proposal: RoadAlertProposal | null;
}
export interface PrivateRoadAlert extends PublicRoadAlert {
  matchedRoadId: RealRoadId | null;
  originalText: string;
  sourceIdentifier: string | null;
  sourceError: string | null;
  locationHints: Record<string, unknown>;
  candidateRoads: RoadAlertCandidate[];
  matchAmbiguity: "unlocated" | "unique_candidate" | "multiple_candidates";
  reviewState: "Imported" | "Confirmed Flood Blockage" | "Cleared" | "Rejected";
  reviewHistory: Array<{ decision: string; state: string; roadId: RealRoadId | null; reviewerSub: string; reviewedAt: string; reason: string }>;
}
export type RealRoadReviewState = "Pending Review" | "Confirmed Blockage" | "Cleared" | "Rejected";

export interface RealRoadReference {
  roadId: RealRoadId;
  /** Versioned OSM extract identifier; the server must resolve geometry itself. */
  geometryVersion: string;
  /** User-selected WGS84 point, never authoritative without server-side snapping. */
  point: Point;
}

export interface RealRoadReportDraft {
  idempotencyKey: string;
  road: RealRoadReference;
  imageKey: string;
  capturedAt: string | null;
  note?: string;
}

/** Public, anonymous v2 intake is separate from the signed-in report contract. */
export interface AnonymousRealRoadReportDraft {
  submissionToken: string;
  imageKey: string;
  road: RealRoadReference;
  capturedAt: string | null;
  note?: string;
}

export interface AnonymousRealRoadUploadTicket {
  uploadUrl: string;
  uploadFields: Record<string, string>;
  submissionToken: string;
  expiresAt: string;
  maxBytes: number;
}

export interface AnonymousRealRoadReceipt {
  id: string;
  reviewStatus: "Pending Review";
}

/** Submitter-only receipt; a retry must not expose responder review details. */
export interface RealRoadSubmissionReceipt {
  id: string;
  reviewStatus: RealRoadReviewState;
}

export interface RealRoadEvidence {
  /** Internal marker identity is optional; the public feed never returns a report ID. */
  id?: string;
  roadId: RealRoadId;
  /** Pending/rejected states are only available in the protected responder report API. */
  point: Point | null;
  reviewState: RealRoadReviewState;
  observedAt: string;
  reviewedAt: string | null;
  reviewDecision?: "confirm_blockage" | "clear" | "reject" | null;
  expiresAt: string;
  source: "resident_photo" | "responder_field_check";
}

/** Strict public feed: current, reviewed outcomes only, without private report fields. */
export type PublicRealRoadEvidence = Omit<RealRoadEvidence, "id" | "point" | "reviewState" | "reviewedAt" | "reviewDecision"> & {
  point: Point;
  reviewState: "Confirmed Blockage" | "Cleared";
  reviewedAt: string;
  reviewDecision: "confirm_blockage" | "clear";
};

export interface RealRoadReport {
  id: string;
  roadId: RealRoadId;
  geometryVersion: string;
  point: Point;
  reviewStatus: RealRoadReviewState;
  source: "resident_photo";
  observedAt: string;
  createdAt: string;
  reviewedAt: string | null;
  evidenceExpiresAt: string;
  expiresAt: string;
  note: string;
  review: { decision: "confirm_blockage" | "clear" | "reject"; reviewedAt: string; reviewer: string } | null;
  photoUrl?: string;
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
